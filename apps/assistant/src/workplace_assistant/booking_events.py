"""Archive the existing dialogue after a successful booking, regardless of its source."""

import asyncio
import json
import logging
import signal
from datetime import datetime
from uuid import UUID

import nats
from nats.errors import TimeoutError as NatsTimeoutError
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_platform.outbox import STREAM, ensure_stream

from workplace_assistant.config import AssistantSettings
from workplace_assistant.event_models import InboxEvent
from workplace_assistant.models import ChatSession, OutboxEvent

SUBJECT = "workplace.booking.booking_changed"
DURABLE = "ASSISTANT_BOOKING_EVENTS"
logger = logging.getLogger(__name__)


def event_parts(envelope: dict, subject: str | None):
    event_id = UUID(envelope["id"])
    if envelope["subject"] != SUBJECT or subject is not None and subject != SUBJECT:
        raise ValueError("Unexpected booking event subject")
    data = envelope["data"]
    if not isinstance(data, dict):
        raise ValueError("Invalid event data")
    if data.get("operation") != "created":
        return event_id, None, None
    owner_id = UUID(data["owner_id"])
    cutoff = datetime.fromisoformat(data.get("updated_at") or envelope["occurred_at"])
    if cutoff.tzinfo is None:
        raise ValueError("Booking event timestamp must contain its timezone")
    return event_id, owner_id, cutoff


async def handle_event(sessions, envelope: dict, *, subject: str | None = None) -> bool:
    event_id, owner_id, cutoff = event_parts(envelope, subject)
    async with sessions() as session:
        async with session.begin():
            receipt = await session.scalar(
                insert(InboxEvent)
                .values(event_id=event_id)
                .on_conflict_do_nothing(index_elements=[InboxEvent.event_id])
                .returning(InboxEvent.event_id)
            )
            if receipt is None:
                return False
            if owner_id is None:
                return True
            # Same lock as new_dialogue: an empty/current/new-dialogue race is serialized.
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"),
                {"owner": str(owner_id)},
            )
            dialogue = await session.scalar(
                select(ChatSession)
                .where(
                    ChatSession.user_id == owner_id,
                    ChatSession.archived_at.is_(None),
                    ChatSession.created_at <= cutoff,
                )
                .with_for_update()
            )
            if dialogue is not None:
                dialogue.archived_at = func.clock_timestamp()
                dialogue.archive_reason = "booking_created"
                dialogue.version += 1
                # Keep in_flight_request_id: a late reply belongs to this archived dialogue (D-108).
                await session.flush()
                session.add(
                    OutboxEvent(
                        subject="workplace.assistant.dialog.changed",
                        payload={
                            "user_id": str(owner_id),
                            "session_id": None,
                            "archived_session_id": str(dialogue.id),
                            "version": dialogue.version,
                            "reason": "booking_created",
                            "booking_id": envelope["data"].get("booking_id"),
                        },
                    )
                )
    return True


async def consume_message(message, sessions) -> bool:
    try:
        envelope = json.loads(message.data)
        await handle_event(sessions, envelope, subject=message.subject)
        await message.ack_sync(timeout=5)
        return True
    except Exception as exc:
        logger.warning("booking event retry: %s", type(exc).__name__)
        await message.nak(delay=5)
        return False


async def run():
    settings = AssistantSettings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for the booking-event worker")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    client = None
    try:
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
                ack_wait=120,
                max_ack_pending=128,
            ),
        )
        while not stop.is_set():
            try:
                messages = await subscription.fetch(batch=1, timeout=1)
            except NatsTimeoutError:
                continue
            for message in messages:
                await consume_message(message, sessions)
    finally:
        if client is not None:
            await client.close()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
