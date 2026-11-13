import asyncio
import os
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_assistant import generation_models  # noqa: F401 - register complete schema
from workplace_assistant.config import AssistantSettings
from workplace_assistant.db import get_session
from workplace_assistant.models import Base, ChatMessage, ChatSession, OutboxEvent
from workplace_assistant.repository import current_dialogue, messages_for, new_dialogue
from workplace_platform.auth import Actor, require_actor

pytestmark = pytest.mark.integration


@pytest_asyncio.fixture
async def sessions():
    url = os.environ.get("TEST_ASSISTANT_DATABASE_URL")
    if not url:
        pytest.skip("TEST_ASSISTANT_DATABASE_URL requires the isolated Docker test stack")
    schema = f"assistant_test_{uuid4().hex}"
    control = create_async_engine(url)
    async with control.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()


async def test_concurrent_new_dialogs_keep_one_active_and_atomic_outbox(sessions):
    owner = uuid4()

    async def open_dialogue():
        async with sessions() as db, db.begin():
            return (await new_dialogue(db, owner)).id

    await asyncio.gather(*(open_dialogue() for _ in range(8)))
    async with sessions() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .where(
                    ChatSession.user_id == owner,
                    ChatSession.archived_at.is_(None),
                )
            )
            == 1
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .where(
                    ChatSession.user_id == owner,
                    ChatSession.archived_at.is_not(None),
                )
            )
            == 7
        )
        assert await db.scalar(select(func.count()).select_from(OutboxEvent)) == 8


async def test_archiving_keeps_request_and_late_reply_in_original_dialogue(sessions):
    owner = uuid4()
    request_id = uuid4()
    async with sessions() as db, db.begin():
        old = await new_dialogue(db, owner)
        old.in_flight_request_id = request_id
        old_id = old.id
        db.add(ChatMessage(session_id=old_id, role="user", content="Нужна переговорная"))
    async with sessions() as db, db.begin():
        new = await new_dialogue(db, owner)
        new_id = new.id
    # A future generation worker must retain the session identity captured
    # before archiving, instead of resolving the owner's new active session.
    async with sessions() as db, db.begin():
        db.add(
            ChatMessage(
                session_id=old_id,
                request_id=request_id,
                role="assistant",
                content="Варианты для проверки",
            )
        )
    async with sessions() as db:
        old = await db.get(ChatSession, old_id)
        assert old.archived_at is not None
        assert old.in_flight_request_id == request_id
        assert [message.role for message in await messages_for(db, old_id)] == ["user", "assistant"]
        assert await messages_for(db, new_id) == []
        assert (await current_dialogue(db, owner)).id == new_id


async def test_chat_endpoints_never_read_another_owners_history(sessions):
    from workplace_assistant.main import create_application

    owner, other_owner = uuid4(), uuid4()
    async with sessions() as db, db.begin():
        own = await new_dialogue(db, owner)
        own_id = own.id
        other = await new_dialogue(db, other_owner)
        other_id = other.id
        db.add(ChatMessage(session_id=other_id, role="user", content="private"))

    settings = AssistantSettings(
        internal_api_key="test-internal-key-long-enough",
        database_url=os.environ["TEST_ASSISTANT_DATABASE_URL"],
    )
    app = create_application(settings)
    app.dependency_overrides[require_actor] = lambda: Actor(
        user_id=str(owner),
        session_id=str(uuid4()),
        role="admin",
        building_ids=[],
        first_name="Test",
        last_name="Owner",
    )

    async def test_session():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = test_session
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.get(f"/internal/chats/{other_id}")).status_code == 404
            current = await client.get("/internal/chats/current")
            assert current.status_code == 200
            assert current.json()["session"]["id"] == str(own_id)
            assert current.json()["messages"] == []
            assert (await client.get("/internal/chats")).json() == []
