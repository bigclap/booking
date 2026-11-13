"""Durable generation worker: SQL lease, delegated MCP auth, official Agent.run, durable result."""

import asyncio
import logging
import signal
from collections.abc import Awaitable, Callable
from contextvars import Token
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import httpx
import nats
from nats.aio.msg import Msg
from nats.errors import TimeoutError as NatsTimeoutError
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from pydantic import TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from workplace_platform.correlation import request_id as current_request_id
from workplace_platform.correlation import trace_id as current_trace_id
from workplace_platform.outbox import STREAM, ensure_stream
from workplace_platform.rpc import service_client
from workplace_platform.typing import JsonObject, JsonValue, SessionFactory

from workplace_assistant.config import AssistantSettings, configuration_status
from workplace_assistant.generation_models import GenerationRequest
from workplace_assistant.generation_routes import dialogue_event
from workplace_assistant.models import ChatMessage, ChatSession
from workplace_assistant.repository import database_time
from workplace_assistant.runtime import RuntimeResult, run_agent, trim_history_chunks

SUBJECT = "workplace.assistant.generation_requested"
DURABLE = "ASSISTANT_GENERATIONS"
logger = logging.getLogger(__name__)


class GenerationBusy(Exception):
    pass


class DelegationUnavailable(Exception):
    pass


@dataclass
class ClaimedRequest:
    id: UUID
    actor_id: UUID
    gateway_session_id: UUID
    session_id: UUID
    lease_token: UUID
    prompt: str
    context: JsonObject
    history: list[JsonValue]


async def owner_lock(session: AsyncSession, owner_id: UUID) -> None:
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"),
        {"owner": str(owner_id)},
    )


async def terminal_failure(
    session: AsyncSession,
    request: GenerationRequest,
    dialogue: ChatSession,
    code: str,
    now: datetime,
) -> None:
    request.status = "failed"
    request.error_code = code
    request.completed_at = request.updated_at = now
    request.lease_token = request.lease_until = None
    if dialogue.in_flight_request_id == request.id:
        dialogue.in_flight_request_id = None
    dialogue.version += 1
    dialogue_event(session, dialogue, request.id, "failed", error_code=code)


async def claim_request(
    sessions: SessionFactory, request_id: UUID, settings: AssistantSettings
) -> ClaimedRequest | None:
    async with sessions() as session, session.begin():
        owner_id = await session.scalar(
            select(GenerationRequest.actor_id).where(
                GenerationRequest.id == request_id,
            )
        )
        if owner_id is None:
            raise LookupError("Generation request is missing")
        await owner_lock(session, owner_id)
        request = await session.scalar(
            select(GenerationRequest)
            .where(
                GenerationRequest.id == request_id,
            )
            .with_for_update()
        )
        if request is None:
            raise LookupError("Generation request is missing")
        if request.status in {"completed", "failed"}:
            return None
        now = await database_time(session)
        if request.status == "running" and request.lease_until and request.lease_until > now:
            raise GenerationBusy()
        dialogue = await session.scalar(
            select(ChatSession)
            .where(
                ChatSession.id == request.session_id,
            )
            .with_for_update()
        )
        if dialogue is None:
            raise LookupError("Generation dialogue is missing")
        if request.attempts >= settings.generation_attempt_limit:
            await terminal_failure(session, request, dialogue, "assistant_attempts_exhausted", now)
            return None
        if not configuration_status(settings)["generation_available"]:
            await terminal_failure(session, request, dialogue, "assistant_unconfigured", now)
            return None
        request.status = "running"
        request.attempts += 1
        lease_token = uuid4()
        request.lease_token = lease_token
        request.lease_until = now + timedelta(seconds=settings.generation_timeout_seconds + 30)
        request.updated_at = now
        dialogue.version += 1
        dialogue_event(session, dialogue, request.id, "running")
        prompt = await session.scalar(
            select(ChatMessage.content).where(
                ChatMessage.id == request.user_message_id,
            )
        )
        if prompt is None:
            raise LookupError("Generation message is missing")
        chunks = list(
            (
                await session.scalars(
                    select(GenerationRequest.run_messages)
                    .where(
                        GenerationRequest.session_id == request.session_id,
                        GenerationRequest.id != request.id,
                        GenerationRequest.status == "completed",
                    )
                    .order_by(GenerationRequest.created_at.desc())
                    .limit(settings.generation_history_runs)
                )
            ).all()
        )
        history = trim_history_chunks(
            [chunk for chunk in reversed(chunks) if chunk],
            settings.generation_history_runs,
            settings.generation_history_chars,
        )
        return ClaimedRequest(
            id=request.id,
            actor_id=request.actor_id,
            gateway_session_id=request.gateway_session_id,
            session_id=request.session_id,
            lease_token=lease_token,
            prompt=prompt,
            context=request.context,
            history=history,
        )


async def delegate_token(settings: AssistantSettings, claimed: ClaimedRequest) -> str:
    try:
        async with service_client(settings) as client:
            result = await client.post(
                f"{settings.users_url}/internal/mcp/delegate",
                headers={
                    "X-Internal-Key": settings.internal_api_key.get_secret_value(),
                    "X-User-ID": str(claimed.actor_id),
                    "X-Session-ID": str(claimed.gateway_session_id),
                },
            )
            result.raise_for_status()
            token = result.json()["access_token"]
            if not isinstance(token, str) or not token:
                raise ValueError("Missing delegated token")
            return token
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise DelegationUnavailable() from exc


async def finish_request(
    sessions: SessionFactory,
    claimed: ClaimedRequest,
    result: RuntimeResult | None = None,
    error_code: str | None = None,
) -> bool:
    async with sessions() as session, session.begin():
        await owner_lock(session, claimed.actor_id)
        request = await session.scalar(
            select(GenerationRequest)
            .where(
                GenerationRequest.id == claimed.id,
            )
            .with_for_update()
        )
        if request is None:
            raise LookupError("Generation request is missing")
        if request.status != "running" or request.lease_token != claimed.lease_token:
            return False
        dialogue = await session.scalar(
            select(ChatSession)
            .where(
                ChatSession.id == claimed.session_id,
            )
            .with_for_update()
        )
        if dialogue is None:
            raise LookupError("Generation dialogue is missing")
        now = await database_time(session)
        if error_code is not None:
            await terminal_failure(session, request, dialogue, error_code, now)
            return True
        if result is None:
            raise ValueError("A successful generation requires its result")
        reply = TypeAdapter(JsonObject).validate_python(
            result.reply.model_dump(mode="json", exclude_none=True)
        )
        proposal = reply.get("proposal")
        session.add(
            ChatMessage(
                session_id=claimed.session_id,
                request_id=claimed.id,
                role="assistant",
                content=result.reply.message,
                proposal=proposal if isinstance(proposal, dict) else None,
            )
        )
        request.run_messages = result.run_messages
        request.result = reply
        request.status = "completed"
        request.completed_at = request.updated_at = now
        request.lease_token = request.lease_until = None
        if dialogue.in_flight_request_id == request.id:
            dialogue.in_flight_request_id = None
        dialogue.version += 1
        dialogue_event(session, dialogue, request.id, "completed")
    return True


GenerationRunner = Callable[
    [AssistantSettings, str, list[JsonValue], JsonObject, str], Awaitable[RuntimeResult]
]
TokenDelegate = Callable[[AssistantSettings, ClaimedRequest], Awaitable[str]]


async def process_generation(
    sessions: SessionFactory,
    request_id: UUID,
    settings: AssistantSettings,
    *,
    runner: GenerationRunner = run_agent,
    delegate: TokenDelegate = delegate_token,
) -> bool:
    claimed = await claim_request(sessions, request_id, settings)
    if claimed is None:
        return False
    try:
        async with asyncio.timeout(settings.generation_timeout_seconds + 10):
            token = await delegate(settings, claimed)
            result = await runner(
                settings,
                claimed.prompt,
                claimed.history,
                claimed.context,
                token,
            )
    except TimeoutError:
        await finish_request(sessions, claimed, error_code="assistant_timeout")
    except DelegationUnavailable:
        await finish_request(sessions, claimed, error_code="assistant_identity_unavailable")
    except Exception as exc:
        logger.warning("generation failed: %s", type(exc).__name__)
        await finish_request(sessions, claimed, error_code="assistant_generation_failed")
    else:
        await finish_request(sessions, claimed, result=result)
    return True


async def consume_message(
    message: Msg, sessions: SessionFactory, settings: AssistantSettings
) -> bool:
    request_token: Token[str | None] | None = None
    trace_token: Token[str | None] | None = None
    try:
        envelope = TypeAdapter(JsonObject).validate_json(message.data)
        if envelope["subject"] != SUBJECT or message.subject != SUBJECT:
            raise ValueError("Unexpected generation event subject")
        data = envelope["data"]
        if not isinstance(data, dict):
            raise ValueError("Invalid generation event data")
        request_id = data["request_id"]
        if not isinstance(request_id, str):
            raise ValueError("Invalid generation identifier")
        origin_id = data.get("origin_request_id", request_id)
        trace = data.get("trace_id", origin_id)
        if not isinstance(origin_id, str) or not isinstance(trace, str):
            raise ValueError("Invalid generation correlation")
        request_token = current_request_id.set(origin_id)
        trace_token = current_trace_id.set(trace)
        await process_generation(sessions, UUID(request_id), settings)
        await message.ack_sync(timeout=5)
        return True
    except Exception as exc:
        logger.warning("generation event retry: %s", type(exc).__name__)
        await message.nak(delay=5)
        return False
    finally:
        if request_token is not None:
            current_request_id.reset(request_token)
        if trace_token is not None:
            current_trace_id.reset(trace_token)


async def run() -> None:
    settings = AssistantSettings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for the generation worker")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    client = None
    try:
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        client = await nats.connect(settings.nats_url, max_reconnect_attempts=-1)
        js = client.jetstream()
        await ensure_stream(js)
        subscription = await js.pull_subscribe(
            SUBJECT,
            durable=DURABLE,
            stream=STREAM,
            config=ConsumerConfig(
                ack_policy=AckPolicy.EXPLICIT,
                deliver_policy=DeliverPolicy.ALL,
                ack_wait=180,
                max_ack_pending=32,
            ),
        )
        while not stop.is_set():
            try:
                messages = await subscription.fetch(batch=1, timeout=1)
            except NatsTimeoutError:
                continue
            for message in messages:
                await consume_message(message, sessions, settings)
    finally:
        if client is not None:
            await client.close()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
