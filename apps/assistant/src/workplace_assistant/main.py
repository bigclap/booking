from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from workplace_platform.auth import Actor, require_actor
from workplace_platform.web import create_app

from workplace_assistant.config import (
    AssistantSettings,
    CapabilityStatus,
    configuration_status,
    get_settings,
)
from workplace_assistant.db import get_session
from workplace_assistant.generation_models import GenerationRequest
from workplace_assistant.generation_schemas import GenerationView
from workplace_assistant.models import ChatSession
from workplace_assistant.repository import current_dialogue, messages_for, new_dialogue
from workplace_assistant.schemas import DialogueView, MessageView, SessionView

DB = Annotated[AsyncSession, Depends(get_session)]
CurrentActor = Annotated[Actor, Depends(require_actor)]


async def dialogue_snapshot(
    db: AsyncSession, user_id: UUID, dialogue: ChatSession | None
) -> DialogueView:
    """Reload restores both the chosen dialogue and the user's cross-dialogue send slot."""
    request: GenerationRequest | None = None
    if dialogue is not None:
        request = await db.scalar(
            select(GenerationRequest)
            .where(GenerationRequest.session_id == dialogue.id)
            .order_by(GenerationRequest.created_at.desc(), GenerationRequest.id.desc())
            .limit(1)
        )
    processing = await db.scalar(
        select(GenerationRequest)
        .where(
            GenerationRequest.actor_id == user_id,
            GenerationRequest.status.in_(["pending", "running"]),
        )
        .order_by(GenerationRequest.created_at.desc(), GenerationRequest.id.desc())
        .limit(1)
    )
    return DialogueView(
        session=SessionView.model_validate(dialogue) if dialogue else None,
        messages=[
            MessageView.model_validate(message) for message in await messages_for(db, dialogue.id)
        ]
        if dialogue
        else [],
        request=GenerationView.model_validate(request) if request else None,
        processing=GenerationView.model_validate(processing) if processing else None,
    )


def create_application(settings: AssistantSettings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is required for Assistant")
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        app.state.db_sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            yield
        finally:
            await engine.dispose()

    app = create_app("assistant", settings, lifespan=lifespan)
    from workplace_assistant.generation_routes import create_generation_router

    app.include_router(create_generation_router(get_session))

    @app.get("/internal/capabilities", tags=["assistant"])
    async def capabilities(actor: CurrentActor) -> CapabilityStatus:
        return configuration_status(settings)

    @app.get("/internal/chats/current", response_model=DialogueView, tags=["chats"])
    async def get_current(actor: CurrentActor, db: DB) -> DialogueView:
        dialogue = await current_dialogue(db, UUID(actor.user_id))
        return await dialogue_snapshot(db, UUID(actor.user_id), dialogue)

    @app.get("/internal/chats", response_model=list[SessionView], tags=["chats"])
    async def list_archived(
        actor: CurrentActor,
        db: DB,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> list[ChatSession]:
        return list(
            (
                await db.scalars(
                    select(ChatSession)
                    .where(
                        ChatSession.user_id == UUID(actor.user_id),
                        ChatSession.archived_at.is_not(None),
                    )
                    .order_by(ChatSession.created_at.desc(), ChatSession.id)
                    .limit(limit)
                    .offset(offset)
                )
            ).all()
        )

    @app.get("/internal/chats/{session_id}", response_model=DialogueView, tags=["chats"])
    async def get_dialogue(session_id: UUID, actor: CurrentActor, db: DB) -> DialogueView:
        dialogue = await db.scalar(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == UUID(actor.user_id),
            )
        )
        if dialogue is None:
            raise HTTPException(404, detail={"code": "chat_not_found"})
        return await dialogue_snapshot(db, UUID(actor.user_id), dialogue)

    @app.post("/internal/chats/new", response_model=DialogueView, status_code=201, tags=["chats"])
    async def start_dialogue(actor: CurrentActor, db: DB) -> DialogueView:
        async with db.begin():
            dialogue = await new_dialogue(db, UUID(actor.user_id))
        return await dialogue_snapshot(db, UUID(actor.user_id), dialogue)

    return app


app = create_application()
