import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_assistant import booking_events
from workplace_assistant.event_models import InboxEvent
from workplace_assistant.models import Base, ChatMessage, ChatSession, OutboxEvent
from workplace_assistant.repository import new_dialogue

pytestmark = pytest.mark.integration


@pytest.fixture
async def event_sessions():
    url = os.environ.get("TEST_ASSISTANT_DATABASE_URL")
    if not url:
        pytest.skip("Requires the isolated Docker test database")
    schema = f"assistant_event_test_{uuid4().hex}"
    control = create_async_engine(url)
    async with control.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()


def event(owner, cutoff, operation="created"):
    return {
        "id": str(uuid4()),
        "subject": booking_events.SUBJECT,
        "occurred_at": cutoff.isoformat(),
        "data": {
            "owner_id": str(owner),
            "booking_id": f"booking-{uuid4()}",
            "operation": operation,
            "updated_at": cutoff.isoformat(),
        },
    }


async def test_any_booking_created_archives_old_chat_once_and_retains_late_reply(event_sessions):
    owner, other_owner, request_id = uuid4(), uuid4(), uuid4()
    async with event_sessions() as session, session.begin():
        dialogue = await new_dialogue(session, owner)
        dialogue.in_flight_request_id = request_id
        old_id = dialogue.id
        other = await new_dialogue(session, other_owner)
        other_id = other.id
        cutoff = await session.scalar(select(func.clock_timestamp()))
    envelope = event(owner, cutoff)
    results = await asyncio.gather(
        *[booking_events.handle_event(event_sessions, envelope) for _ in range(2)]
    )
    assert sorted(results) == [False, True]
    async with event_sessions() as session, session.begin():
        old = await session.get(ChatSession, old_id)
        assert old.archived_at is not None
        assert old.archive_reason == "booking_created"
        assert old.version == 2
        assert old.in_flight_request_id == request_id
        assert (await session.get(ChatSession, other_id)).archived_at is None
        session.add(
            ChatMessage(
                session_id=old_id,
                role="assistant",
                request_id=request_id,
                content="Поздний ответ",
            )
        )
    async with event_sessions() as session:
        assert await session.get(InboxEvent, UUID(envelope["id"])) is not None
        assert await session.scalar(select(func.count()).select_from(ChatMessage)) == 1
        archives = (
            await session.scalars(
                select(OutboxEvent).where(
                    OutboxEvent.payload["reason"].astext == "booking_created",
                )
            )
        ).all()
        assert len(archives) == 1


async def test_delayed_booking_event_does_not_archive_a_newer_chat(event_sessions):
    owner = uuid4()
    cutoff = datetime.now(UTC) - timedelta(hours=1)
    async with event_sessions() as session, session.begin():
        dialogue = await new_dialogue(session, owner)
        newer_id = dialogue.id
    envelope = event(owner, cutoff)
    assert await booking_events.handle_event(event_sessions, envelope)
    async with event_sessions() as session:
        newer = await session.get(ChatSession, newer_id)
        assert newer.archived_at is None
        assert newer.version == 1
        assert await session.get(InboxEvent, UUID(envelope["id"])) is not None


async def test_noncreation_booking_events_leave_current_chat_active(event_sessions):
    owner = uuid4()
    async with event_sessions() as session, session.begin():
        dialogue = await new_dialogue(session, owner)
        current_id = dialogue.id
        cutoff = await session.scalar(select(func.clock_timestamp()))
    assert await booking_events.handle_event(event_sessions, event(owner, cutoff, "updated"))
    async with event_sessions() as session:
        assert (await session.get(ChatSession, current_id)).archived_at is None


async def test_archiving_and_new_dialogue_race_preserves_the_newer_dialogue(event_sessions):
    owner = uuid4()
    async with event_sessions() as session, session.begin():
        old_id = (await new_dialogue(session, owner)).id
        cutoff = await session.scalar(select(func.clock_timestamp()))
    envelope = event(owner, cutoff)

    async def create_new():
        async with event_sessions() as session, session.begin():
            return (await new_dialogue(session, owner)).id

    _, new_id = await asyncio.gather(
        booking_events.handle_event(event_sessions, envelope),
        create_new(),
    )
    async with event_sessions() as session:
        assert (await session.get(ChatSession, old_id)).archived_at is not None
        assert (await session.get(ChatSession, new_id)).archived_at is None
