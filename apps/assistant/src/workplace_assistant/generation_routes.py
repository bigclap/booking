"""Persist a message and its generation request before returning to Gateway."""

import hashlib
import json
from typing import Annotated, TypedDict, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.auth import Actor, require_actor
from workplace_platform.correlation import event_metadata
from workplace_platform.typing import JsonObject, JsonValue, SessionDependency

from workplace_assistant.config import AssistantSettings, configuration_status
from workplace_assistant.generation_models import GenerationRequest
from workplace_assistant.generation_schemas import GenerationView, MessageInput
from workplace_assistant.models import ChatMessage, ChatSession, OutboxEvent
from workplace_assistant.repository import messages_for
from workplace_assistant.schemas import MessageView, SessionView


def error(status: int, code: str) -> HTTPException:
    return HTTPException(status, detail={"code": code})


class GenerationSnapshot(TypedDict):
    request: GenerationView
    session: SessionView
    messages: list[MessageView]


def dialogue_event(
    session: AsyncSession,
    dialogue: ChatSession,
    request_id: UUID,
    phase: str,
    **extra: JsonValue,
) -> None:
    metadata = event_metadata()
    session.add(
        OutboxEvent(
            subject="workplace.assistant.dialog.changed",
            payload={
                "user_id": str(dialogue.user_id),
                "session_id": str(dialogue.id),
                "request_id": str(request_id),
                "phase": phase,
                "version": dialogue.version,
                **(
                    {"origin_request_id": metadata["request_id"]}
                    if metadata.get("request_id")
                    else {}
                ),
                **({"trace_id": metadata["trace_id"]} if metadata.get("trace_id") else {}),
                **extra,
            },
        )
    )


async def enqueue_message(
    session: AsyncSession,
    actor: Actor,
    session_id: UUID,
    body: MessageInput,
    key: str,
    settings: AssistantSettings,
) -> GenerationRequest:
    if not configuration_status(settings)["generation_available"]:
        raise error(503, "assistant_unconfigured")
    if len(body.message) > settings.generation_message_chars:
        raise error(422, "assistant_message_too_long")
    owner_id = UUID(actor.user_id)
    context = TypeAdapter(JsonObject).validate_python(
        body.context.model_dump(mode="json", exclude_none=True)
    )
    fingerprint = hashlib.sha256(
        json.dumps(
            {"session_id": str(session_id), "message": body.message, "context": context},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    async with session.begin():
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"),
            {"owner": str(owner_id)},
        )
        previous = await session.scalar(
            select(GenerationRequest).where(
                GenerationRequest.actor_id == owner_id,
                GenerationRequest.idempotency_key == key,
            )
        )
        if previous is not None:
            if previous.fingerprint != fingerprint:
                raise error(409, "idempotency_key_conflict")
            return previous
        dialogue = await session.scalar(
            select(ChatSession)
            .where(
                ChatSession.id == session_id,
                ChatSession.user_id == owner_id,
            )
            .with_for_update()
        )
        if dialogue is None:
            raise error(404, "chat_not_found")
        if dialogue.archived_at is not None:
            raise error(409, "chat_archived")
        if dialogue.in_flight_request_id is not None:
            raise error(409, "assistant_busy")
        # A manual/new-booking archive may create another active dialogue while
        # a late reply is still running in the old one. The send slot is per user.
        busy = await session.scalar(
            select(GenerationRequest.id)
            .where(
                GenerationRequest.actor_id == owner_id,
                GenerationRequest.status.in_(["pending", "running"]),
            )
            .limit(1)
        )
        if busy is not None:
            raise error(409, "assistant_busy")
        request_id = uuid4()
        message = ChatMessage(
            id=uuid4(),
            session_id=session_id,
            role="user",
            content=body.message,
            request_id=request_id,
        )
        session.add(message)
        await session.flush()
        generation = GenerationRequest(
            id=request_id,
            actor_id=owner_id,
            gateway_session_id=UUID(actor.session_id),
            session_id=session_id,
            user_message_id=message.id,
            idempotency_key=key,
            fingerprint=fingerprint,
            context=context,
        )
        session.add(generation)
        dialogue.in_flight_request_id = request_id
        dialogue.version += 1
        session.add(
            OutboxEvent(
                subject="workplace.assistant.generation_requested",
                payload={
                    "request_id": str(request_id),
                    "user_id": str(owner_id),
                    "session_id": str(session_id),
                    **(
                        {"origin_request_id": event_metadata()["request_id"]}
                        if event_metadata().get("request_id")
                        else {}
                    ),
                    **(
                        {"trace_id": event_metadata()["trace_id"]}
                        if event_metadata().get("trace_id")
                        else {}
                    ),
                },
            )
        )
        dialogue_event(session, dialogue, request_id, "queued")
        await session.flush()
    return generation


async def request_snapshot(
    session: AsyncSession, generation: GenerationRequest
) -> GenerationSnapshot:
    dialogue = await session.get(ChatSession, generation.session_id)
    if dialogue is None:
        raise RuntimeError("Generation dialogue is missing")
    return {
        "request": GenerationView.model_validate(generation),
        "session": SessionView.model_validate(dialogue),
        "messages": [
            MessageView.model_validate(message)
            for message in await messages_for(session, dialogue.id)
        ],
    }


def create_generation_router(get_session: SessionDependency) -> APIRouter:
    router = APIRouter()

    @router.post("/internal/chats/{session_id}/messages", status_code=202, tags=["generation"])
    async def send_message(
        session_id: UUID,
        body: MessageInput,
        session: Annotated[AsyncSession, Depends(get_session)],
        actor: Annotated[Actor, Depends(require_actor)],
        request: Request,
        key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)],
    ) -> GenerationSnapshot:
        generation = await enqueue_message(
            session,
            actor,
            session_id,
            body,
            key,
            cast(AssistantSettings, request.app.state.settings),
        )
        return await request_snapshot(session, generation)

    @router.get("/internal/generations/{request_id}", tags=["generation"])
    async def generation_status(
        request_id: UUID,
        session: Annotated[AsyncSession, Depends(get_session)],
        actor: Annotated[Actor, Depends(require_actor)],
    ) -> GenerationSnapshot:
        generation = await session.scalar(
            select(GenerationRequest).where(
                GenerationRequest.id == request_id,
                GenerationRequest.actor_id == UUID(actor.user_id),
            )
        )
        if generation is None:
            raise error(404, "generation_not_found")
        return await request_snapshot(session, generation)

    return router
