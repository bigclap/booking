"""Apply Users' access-removal commands through a durable JetStream consumer.

This is a data mutation, not an authorization cache. Gateway remains the sole
owner of access policy; no disabled-user or building-grant state is copied here.
"""

import asyncio
import logging
import signal
from datetime import datetime
from typing import cast
from uuid import UUID

import nats
from fastapi import HTTPException
from nats.aio.msg import Msg
from nats.errors import TimeoutError as NatsTimeoutError
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from workplace_platform.outbox import STREAM, ensure_stream
from workplace_platform.typing import JsonObject, JsonValue, SessionFactory

from workplace_booking.booking_models import Booking
from workplace_booking.bookings import changed, locked_office
from workplace_booking.config import BookingSettings
from workplace_booking.event_models import InboxEvent
from workplace_booking.models import Building, OutboxEvent

SUBJECT = "workplace.users.>"
DURABLE = "BOOKING_USER_EVENTS"
logger = logging.getLogger(__name__)
EVENT_JSON = TypeAdapter(JsonObject)


def event_string(value: JsonValue) -> str:
    if not isinstance(value, str):
        raise ValueError("Users event field must be a string")
    return value


def event_parts(
    envelope: JsonObject, subject: str | None
) -> tuple[UUID, str, JsonObject, datetime]:
    if envelope.get("version", 1) != 1:
        raise ValueError("Unsupported Users event version")
    event_id = UUID(event_string(envelope["id"]))
    event_subject = envelope["subject"]
    if not isinstance(event_subject, str) or not event_subject.startswith("workplace.users."):
        raise ValueError("Unexpected Users event subject")
    if subject is not None and subject != event_subject:
        raise ValueError("Envelope subject differs from transport subject")
    data = envelope["data"]
    if not isinstance(data, dict):
        raise ValueError("Invalid event data")
    cutoff = datetime.fromisoformat(event_string(envelope["occurred_at"]))
    if cutoff.tzinfo is None:
        raise ValueError("Users event timestamp must contain its timezone")
    return event_id, event_subject, data, cutoff


async def lock_affected_office(session: AsyncSession, office_id: str) -> Building:
    try:
        return await locked_office(session, office_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        # The same booking namespace lock is already held. Retired catalog rows
        # still own history and must not prevent cleanup of their remaining use.
        office = await session.scalar(
            select(Building).where(Building.id == office_id).with_for_update()
        )
        if office is None:
            raise
        return office


async def handle_event(
    sessions: SessionFactory, envelope: JsonObject, *, subject: str | None = None
) -> bool:
    """Return False for a committed duplicate; all business writes commit with its inbox receipt."""
    event_id, event_subject, data, cutoff = event_parts(envelope, subject)
    correlation: JsonObject = {
        key: data.get(key, envelope.get(key))
        for key in ("request_id", "trace_id", "correlation_id")
        if data.get(key, envelope.get(key)) is not None
    }
    relevant = event_subject in {
        "workplace.users.user_disabled",
        "workplace.users.building_access_revoked",
    }
    owner_id = data.get("user_id")
    scope: list[str] | None = None
    except_scope: list[str] | None = None
    if relevant:
        if not isinstance(owner_id, str) or not owner_id or len(owner_id) > 1000:
            raise ValueError("Missing owner identifier")
        if event_subject == "workplace.users.building_access_revoked":
            if ("building_ids" in data) == ("except_building_ids" in data):
                raise ValueError("Specify revoked buildings or the remaining-building exception")
            identifiers = data.get("building_ids", data.get("except_building_ids"))
            if not isinstance(identifiers, list) or any(
                not isinstance(identifier, str) or not identifier for identifier in identifiers
            ):
                raise ValueError("Invalid revoked-building identifiers")
            if "building_ids" in data:
                scope = cast(list[str], identifiers)
            else:
                except_scope = cast(list[str], identifiers)
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
            if not relevant:
                return True
            cancellation_reason = data.get("reason", "access_revoked")
            if cancellation_reason is not None and not isinstance(cancellation_reason, str):
                raise ValueError("Invalid cancellation reason")
            # A durable replay keeps the original effective time, even after a long outage.
            # This is a domain command cutoff, not cached authorization state.
            current = cutoff
            cancelled_count = 0
            terminated_count = 0
            offices = select(Booking.building_id).where(
                Booking.owner_id == owner_id,
                Booking.status == "active",
                Booking.ends_at > current,
                Booking.created_at <= cutoff,
            )
            if scope is not None:
                offices = offices.where(Booking.building_id.in_(scope))
            if except_scope is not None:
                offices = offices.where(Booking.building_id.not_in(except_scope))
            for office_id in sorted(set((await session.scalars(offices)).all())):
                await lock_affected_office(session, office_id)
                rows = (
                    await session.scalars(
                        select(Booking)
                        .where(
                            Booking.building_id == office_id,
                            Booking.owner_id == owner_id,
                            Booking.status == "active",
                            Booking.ends_at > current,
                            # Delayed removal commands must not cancel a later re-grant's work.
                            Booking.created_at <= cutoff,
                        )
                        .order_by(Booking.id)
                        .with_for_update()
                    )
                ).all()
                for booking in rows:
                    if booking.starts_at < current:
                        booking.ends_at = current
                        terminated_count += 1
                    else:
                        cancelled_count += 1
                    booking.status = "cancelled"
                    booking.cancelled_at = current
                    booking.cancellation_reason = cancellation_reason
                    booking.revision += 1
                    await changed(session, booking, "access_revoked", correlation)
            if data.get("operation_id") is not None:
                session.add(
                    OutboxEvent(
                        subject="workplace.booking.access_revocation_completed",
                        payload={
                            **correlation,
                            "operation_id": str(UUID(event_string(data["operation_id"]))),
                            "user_id": owner_id,
                            "cancelled_count": cancelled_count,
                            "terminated_count": terminated_count,
                            "effective_at": cutoff.isoformat(),
                        },
                    )
                )
    return True


async def consume_message(message: Msg, sessions: SessionFactory) -> bool:
    try:
        envelope = EVENT_JSON.validate_json(message.data)
        await handle_event(sessions, envelope, subject=message.subject)
        # The SQL context has committed before the broker receives acknowledgement.
        await message.ack_sync(timeout=5)
        return True
    except Exception as exc:
        logger.warning("users event retry: %s", type(exc).__name__)
        await message.nak(delay=5)
        return False


async def run() -> None:
    settings = BookingSettings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for the Users-event worker")
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
