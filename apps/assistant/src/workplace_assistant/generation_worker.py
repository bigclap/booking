"""Durable generation worker: SQL lease, delegated MCP auth, official Agent.run, durable result."""

import asyncio
import json
import logging
import signal
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

import httpx
import nats
from nats.errors import TimeoutError as NatsTimeoutError
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_platform.correlation import request_id as current_request_id
from workplace_platform.correlation import trace_id as current_trace_id
from workplace_platform.outbox import STREAM, ensure_stream
from workplace_platform.rpc import service_client

from workplace_assistant.config import AssistantSettings, configuration_status
from workplace_assistant.generation_models import GenerationRequest
from workplace_assistant.generation_routes import dialogue_event
from workplace_assistant.models import ChatMessage, ChatSession
from workplace_assistant.runtime import run_agent, trim_history_chunks

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
    context: dict
    history: list


async def owner_lock(session, owner_id):
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"),
        {"owner": str(owner_id)},
    )


async def terminal_failure(session, request, dialogue, code, now):
    request.status = "failed"
    request.error_code = code
    request.completed_at = request.updated_at = now
    request.lease_token = request.lease_until = None
    if dialogue.in_flight_request_id == request.id:
        dialogue.in_flight_request_id = None
    dialogue.version += 1
    dialogue_event(session, dialogue, request.id, "failed", error_code=code)


async def claim_request(sessions, request_id: UUID, settings: AssistantSettings):
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
        if request.status in {"completed", "failed"}:
            return None
        now = await session.scalar(select(func.clock_timestamp()))
        if request.status == "running" and request.lease_until and request.lease_until > now:
            raise GenerationBusy()
        dialogue = await session.scalar(
            select(ChatSession)
            .where(
                ChatSession.id == request.session_id,
            )
            .with_for_update()
        )
        if request.attempts >= settings.generation_attempt_limit:
            await terminal_failure(session, request, dialogue, "assistant_attempts_exhausted", now)
            return None
        if not configuration_status(settings)["generation_available"]:
            await terminal_failure(session, request, dialogue, "assistant_unconfigured", now)
            return None
        request.status = "running"
        request.attempts += 1
        request.lease_token = uuid4()
        request.lease_until = now + timedelta(seconds=settings.generation_timeout_seconds + 30)
        request.updated_at = now
        dialogue.version += 1
        dialogue_event(session, dialogue, request.id, "running")
        prompt = await session.scalar(
            select(ChatMessage.content).where(
                ChatMessage.id == request.user_message_id,
            )
        )
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
            lease_token=request.lease_token,
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


async def finish_request(sessions, claimed: ClaimedRequest, result=None, error_code=None):
    async with sessions() as session, session.begin():
        await owner_lock(session, claimed.actor_id)
        request = await session.scalar(
            select(GenerationRequest)
            .where(
                GenerationRequest.id == claimed.id,
            )
            .with_for_update()
        )
        if request.status != "running" or request.lease_token != claimed.lease_token:
            return False
        dialogue = await session.scalar(
            select(ChatSession)
            .where(
                ChatSession.id == claimed.session_id,
            )
            .with_for_update()
        )
        now = await session.scalar(select(func.clock_timestamp()))
        if error_code is not None:
            await terminal_failure(session, request, dialogue, error_code, now)
            return True
        reply = result.reply.model_dump(mode="json", exclude_none=True)
        session.add(
            ChatMessage(
                session_id=claimed.session_id,
                request_id=claimed.id,
                role="assistant",
                content=result.reply.message,
                proposal=reply.get("proposal"),
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


async def process_generation(
    sessions, request_id: UUID, settings, *, runner=run_agent, delegate=delegate_token
):
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


async def consume_message(message, sessions, settings):
    request_token = trace_token = None
    try:
        envelope = json.loads(message.data)
        if envelope["subject"] != SUBJECT or message.subject != SUBJECT:
            raise ValueError("Unexpected generation event subject")
        origin_id = envelope["data"].get("origin_request_id", envelope["data"]["request_id"])
        trace = envelope["data"].get("trace_id", origin_id)
        if not isinstance(origin_id, str) or not isinstance(trace, str):
            raise ValueError("Invalid generation correlation")
        request_token = current_request_id.set(origin_id)
        trace_token = current_trace_id.set(trace)
        await process_generation(sessions, UUID(envelope["data"]["request_id"]), settings)
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


async def run():
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
