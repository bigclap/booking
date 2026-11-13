import json
import os
from uuid import uuid4

import nats
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from workplace_platform.outbox import STREAM, OutboxMixin, ensure_stream, publish_batch


class Base(DeclarativeBase):
    pass


class Event(OutboxMixin, Base):
    __tablename__ = "outbox_events"


@pytest.mark.integration
async def test_outbox_retries_and_reuses_message_id():
    database_url = os.getenv("TEST_BOOKING_DATABASE_URL")
    if not database_url:
        pytest.skip("Use make test: isolated PostgreSQL is required")
    schema = f"outbox_test_{uuid4().hex}"
    control = create_async_engine(database_url)
    async with control.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        database_url, connect_args={"server_settings": {"search_path": schema}}
    )
    client = await nats.connect(os.environ["NATS_URL"])
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        event_id = uuid4()
        subject = f"workplace.tests.{event_id.hex}"
        async with factory.begin() as session:
            session.add(Event(id=event_id, subject=subject, payload={"user_id": "user-1"}))

        class OfflineBroker:
            async def publish(self, *args, **kwargs):
                raise ConnectionError("broker unavailable")

        assert await publish_batch(engine, OfflineBroker()) == 0
        async with factory() as session:
            stored = await session.get(Event, event_id)
            assert stored.published_at is None
            assert stored.attempts == 1

        js = client.jetstream()
        await ensure_stream(js)
        assert await publish_batch(engine, js) >= 1
        message = await js.get_last_msg(STREAM, subject)
        envelope = json.loads(message.data)
        assert envelope["id"] == str(event_id)
        assert envelope["data"] == {"user_id": "user-1"}
        before = (await js.stream_info(STREAM)).state.messages

        # A crash after broker ack but before the DB commit can publish the same row again.
        async with factory.begin() as session:
            stored = await session.scalar(select(Event).where(Event.id == event_id))
            stored.published_at = None
        assert await publish_batch(engine, js) >= 1
        assert (await js.stream_info(STREAM)).state.messages == before
        async with factory() as session:
            stored = await session.get(Event, event_id)
            assert stored.published_at is not None
    finally:
        await client.close()
        await engine.dispose()
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()
