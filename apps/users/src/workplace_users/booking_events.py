"""Complete access-revocation operations only after Booking's durable success event."""

import asyncio
import json
import logging
import signal
from datetime import datetime
from typing import cast
from uuid import UUID

import nats
from nats.aio.client import Client
from nats.aio.msg import Msg
from nats.errors import TimeoutError as NatsTimeoutError
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_platform.outbox import STREAM, ensure_stream
from workplace_platform.typing import JsonValue, SessionFactory

from workplace_users.config import UsersSettings
from workplace_users.models import AccessOperation, InboxEvent

SUBJECT = "workplace.booking.access_revocation_completed"
DURABLE = "users-booking-access-results-v1"
logger = logging.getLogger("workplace.users.booking_events")


def event_string(value: JsonValue) -> str:
    if not isinstance(value, str):
        raise ValueError("Invalid completion string")
    return value


async def handle_event(
    sessions: SessionFactory, envelope: JsonValue, *, subject: str | None = None
) -> bool:
    if not isinstance(envelope, dict):
        raise ValueError("Invalid completion envelope")
    event_id = UUID(event_string(envelope["id"]))
    if envelope["subject"] != SUBJECT or (subject is not None and subject != SUBJECT):
        raise ValueError("Unexpected completion subject")
    timestamp = datetime.fromisoformat(event_string(envelope["occurred_at"]))
    if timestamp.tzinfo is None:
        raise ValueError("Completion timestamp must contain timezone")
    data = envelope["data"]
    if not isinstance(data, dict):
        raise ValueError("Invalid completion data")
    operation_id = UUID(event_string(data["operation_id"]))
    user_id = UUID(event_string(data["user_id"]))
    cancelled = data["cancelled_count"]
    terminated = data["terminated_count"]
    if (
        not isinstance(cancelled, int)
        or isinstance(cancelled, bool)
        or cancelled < 0
        or not isinstance(terminated, int)
        or isinstance(terminated, bool)
        or terminated < 0
    ):
        raise ValueError("Invalid completion counts")
    async with sessions() as db:
        async with db.begin():
            receipt = await db.scalar(
                insert(InboxEvent)
                .values(event_id=event_id)
                .on_conflict_do_nothing(index_elements=[InboxEvent.event_id])
                .returning(InboxEvent.event_id)
            )
            if receipt is None:
                return False
            operation = await db.scalar(
                select(AccessOperation).where(AccessOperation.id == operation_id).with_for_update()
            )
            if operation is None or operation.user_id != user_id:
                raise ValueError("Unknown or mismatched access operation")
            if operation.status != "completed":
                operation.status = "completed"
                operation.cancelled_count = cancelled
                operation.terminated_count = terminated
                operation.completed_at = func.now()
    return True


async def consume_message(message: Msg, sessions: SessionFactory) -> bool:
    try:
        await handle_event(
            sessions, cast(JsonValue, json.loads(message.data)), subject=message.subject
        )
        await message.ack_sync(timeout=5)
        return True
    except Exception as exc:
        # No payload/token/exception text is logged.
        logger.warning("booking completion retry: %s", type(exc).__name__)
        await message.nak(delay=5)
        return False


async def run() -> None:
    settings = UsersSettings()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    client: Client | None = None
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
