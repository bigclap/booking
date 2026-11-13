import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import nats
import pytest
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from sqlalchemy import func, select
from workplace_booking import user_events
from workplace_booking.booking_models import Booking
from workplace_booking.event_models import InboxEvent
from workplace_booking.models import OutboxEvent
from workplace_platform.outbox import STREAM, ensure_stream

pytestmark = pytest.mark.integration


async def prepare(booking_client):
    client, sessions = booking_client
    owner, colleague = str(uuid4()), str(uuid4())
    offices = []
    for _ in range(2):
        response = await client.post("/internal/offices", json={"name": "Офис для отзыва"})
        assert response.status_code == 201
        office = response.json()
        floor = office["floors"][0]["plan_document"]
        resource_id = f"desk-{uuid4()}"
        floor["elements"] = [{"id": resource_id, "name": "Рабочее место", "kind": "desk"}]
        saved = await client.put(
            f"/internal/offices/{office['id']}/plan",
            json={
                "expected_revision": office["revision"],
                "floors": [floor],
            },
        )
        assert saved.status_code == 200, saved.text
        offices.append((office["id"], floor["id"], resource_id))
    async with sessions.begin() as session:
        now = await session.scalar(select(func.clock_timestamp()))
        rows = {}
        for label, office_index, booking_owner, delta_start, delta_end in [
            ("past", 0, owner, -120, -60),
            ("current", 0, owner, -30, 30),
            ("future", 0, owner, 60, 120),
            ("other_office", 1, owner, 60, 120),
            ("colleague", 0, colleague, 120, 180),
        ]:
            office_id, floor_id, resource_id = offices[office_index]
            row = Booking(
                id=f"booking-{uuid4()}",
                building_id=office_id,
                floor_id=floor_id,
                resource_id=resource_id,
                owner_id=booking_owner,
                ancestor_ids=[],
                starts_at=now + timedelta(minutes=delta_start),
                ends_at=now + timedelta(minutes=delta_end),
                scheduled_ends_at=now + timedelta(minutes=delta_end),
            )
            session.add(row)
            rows[label] = row
        await session.flush()
    return sessions, owner, offices, rows


def envelope(owner, *, office_ids=None):
    subject = (
        "workplace.users.user_disabled"
        if office_ids is None
        else "workplace.users.building_access_revoked"
    )
    return {
        "id": str(uuid4()),
        "subject": subject,
        "occurred_at": datetime.now(UTC).isoformat(),
        "data": {
            "user_id": owner,
            **({"building_ids": office_ids} if office_ids is not None else {}),
        },
    }


async def row_snapshot(sessions, rows):
    async with sessions() as session:
        return {label: await session.get(Booking, row.id) for label, row in rows.items()}


async def test_user_disabled_cancels_future_and_truncates_current_once(booking_client):
    sessions, owner, _, original = await prepare(booking_client)
    event = envelope(owner)
    results = await asyncio.gather(*[user_events.handle_event(sessions, event) for _ in range(2)])
    assert sorted(results) == [False, True]
    rows = await row_snapshot(sessions, original)
    for label in ("current", "future", "other_office"):
        assert rows[label].status == "cancelled"
        assert rows[label].revision == 2
        assert rows[label].cancelled_at is not None
    current = rows["current"]
    assert original["current"].starts_at < current.ends_at < original["current"].ends_at
    assert current.ends_at == current.cancelled_at
    assert current.scheduled_ends_at == original["current"].scheduled_ends_at
    for label in ("past", "colleague"):
        assert rows[label].status == "active"
        assert rows[label].revision == 1
        assert rows[label].ends_at == original[label].ends_at
    async with sessions() as session:
        assert await session.get(InboxEvent, UUID(event["id"])) is not None
        events = (
            await session.scalars(
                select(OutboxEvent).where(
                    OutboxEvent.subject == "workplace.booking.booking_changed",
                    OutboxEvent.payload["owner_id"].astext == owner,
                )
            )
        ).all()
        assert len(events) == 3
        assert {entry.payload["operation"] for entry in events} == {"access_revoked"}


async def test_building_revocation_only_changes_that_building(booking_client):
    sessions, owner, offices, original = await prepare(booking_client)
    event = envelope(owner, office_ids=[offices[0][0]])
    assert await user_events.handle_event(sessions, event)
    rows = await row_snapshot(sessions, original)
    assert rows["current"].status == rows["future"].status == "cancelled"
    for label in ("other_office", "past", "colleague"):
        assert rows[label].status == "active"
        assert rows[label].revision == 1


async def test_delayed_command_keeps_original_effective_time_and_reports_result_once(
    booking_client,
):
    sessions, owner, offices, original = await prepare(booking_client)
    cutoff = datetime.now(UTC) - timedelta(hours=4)
    event = envelope(owner, office_ids=[offices[0][0]])
    event["occurred_at"] = cutoff.isoformat()
    event["data"]["operation_id"] = str(uuid4())
    event["data"]["reason"] = "building_access_removed"
    async with sessions.begin() as session:
        current = await session.get(Booking, original["current"].id)
        current.created_at = cutoff - timedelta(hours=1)
        current.starts_at = cutoff - timedelta(minutes=30)
        current.ends_at = current.scheduled_ends_at = cutoff + timedelta(minutes=30)
        future = await session.get(Booking, original["future"].id)
        future.created_at = cutoff - timedelta(hours=1)
        future.starts_at = cutoff + timedelta(minutes=60)
        future.ends_at = future.scheduled_ends_at = cutoff + timedelta(minutes=120)
    assert await user_events.handle_event(sessions, event)
    assert not await user_events.handle_event(sessions, event)
    async with sessions() as session:
        current = await session.get(Booking, original["current"].id)
        assert current.ends_at == current.cancelled_at == cutoff
        assert current.cancellation_reason == "building_access_removed"
        results = (
            await session.scalars(
                select(OutboxEvent).where(
                    OutboxEvent.subject == "workplace.booking.access_revocation_completed",
                    OutboxEvent.payload["operation_id"].astext == event["data"]["operation_id"],
                )
            )
        ).all()
        assert len(results) == 1
        assert results[0].payload["cancelled_count"] == 1
        assert results[0].payload["terminated_count"] == 1


async def test_role_downgrade_revocation_preserves_explicit_remaining_buildings(booking_client):
    sessions, owner, offices, original = await prepare(booking_client)
    event = envelope(owner, office_ids=[])
    event["data"].pop("building_ids")
    event["data"]["except_building_ids"] = [offices[1][0]]
    assert await user_events.handle_event(sessions, event)
    rows = await row_snapshot(sessions, original)
    assert rows["current"].status == rows["future"].status == "cancelled"
    assert rows["other_office"].status == "active"
    assert rows["other_office"].revision == 1


@pytest.mark.parametrize("scoped", [False, True])
async def test_delayed_removal_does_not_cancel_later_created_bookings(booking_client, scoped):
    sessions, owner, offices, original = await prepare(booking_client)
    event = envelope(owner, office_ids=[offices[0][0]] if scoped else None)
    async with sessions() as session:
        cutoff = await session.scalar(select(func.clock_timestamp()))
    event["occurred_at"] = cutoff.isoformat()
    previous = original["future"]
    async with sessions.begin() as session:
        restored_access_booking = Booking(
            building_id=previous.building_id,
            floor_id=previous.floor_id,
            resource_id=previous.resource_id,
            owner_id=owner,
            ancestor_ids=[],
            starts_at=previous.starts_at + timedelta(hours=4),
            ends_at=previous.ends_at + timedelta(hours=4),
            scheduled_ends_at=previous.ends_at + timedelta(hours=4),
        )
        session.add(restored_access_booking)
        await session.flush()
        later_id = restored_access_booking.id
        assert restored_access_booking.created_at > cutoff
    assert await user_events.handle_event(sessions, event)
    async with sessions() as session:
        later = await session.get(Booking, later_id)
        assert later.status == "active"
        assert later.revision == 1
        assert (await session.get(Booking, previous.id)).status == "cancelled"


class RecordingMessage:
    def __init__(self, event, sessions):
        self.data = json.dumps(event).encode()
        self.subject = event["subject"]
        self.event_id = UUID(event["id"])
        self.sessions = sessions
        self.acked = False
        self.nak_delay = None

    async def ack_sync(self, **kwargs):
        async with self.sessions() as session:
            # A separate connection must already see the committed receipt before ACK.
            assert await session.get(InboxEvent, self.event_id) is not None
        self.acked = True

    async def nak(self, delay):
        self.nak_delay = delay


async def test_failed_business_write_rolls_back_inbox_and_naks_before_retry(
    booking_client, monkeypatch
):
    sessions, owner, _, original = await prepare(booking_client)
    event = envelope(owner)
    message = RecordingMessage(event, sessions)
    original_changed = user_events.changed

    async def fail(*args, **kwargs):
        raise RuntimeError("simulated database write failure")

    monkeypatch.setattr(user_events, "changed", fail)
    assert not await user_events.consume_message(message, sessions)
    assert not message.acked
    assert message.nak_delay == 5
    async with sessions() as session:
        assert await session.get(InboxEvent, UUID(event["id"])) is None
        assert (await session.get(Booking, original["current"].id)).status == "active"
    monkeypatch.setattr(user_events, "changed", original_changed)
    assert await user_events.consume_message(message, sessions)
    assert message.acked
    assert (await row_snapshot(sessions, original))["current"].status == "cancelled"


async def test_missing_removal_cutoff_is_not_acknowledged(booking_client):
    sessions, owner, _, _ = await prepare(booking_client)
    event = envelope(owner)
    event.pop("occurred_at")
    message = RecordingMessage(event, sessions)
    assert not await user_events.consume_message(message, sessions)
    assert message.nak_delay == 5
    assert not message.acked
    async with sessions() as session:
        assert await session.get(InboxEvent, UUID(event["id"])) is None


async def test_real_jetstream_redelivery_keeps_one_business_result(booking_client):
    sessions, owner, _, rows = await prepare(booking_client)
    event = envelope(owner)
    client = await nats.connect(os.environ.get("NATS_URL", "nats://nats:4222"))
    durable = f"test_booking_users_{uuid4().hex}"
    try:
        js = client.jetstream()
        await ensure_stream(js)
        subscription = await js.pull_subscribe(
            event["subject"],
            durable=durable,
            stream=STREAM,
            config=ConsumerConfig(ack_policy=AckPolicy.EXPLICIT, deliver_policy=DeliverPolicy.NEW),
        )
        for _ in range(2):
            # Publish the same business event twice without broker-level deduplication.
            await js.publish(event["subject"], json.dumps(event).encode())
            message = (await subscription.fetch(batch=1, timeout=3))[0]
            assert await user_events.consume_message(message, sessions)
        info = await js.consumer_info(STREAM, durable)
        assert info.num_ack_pending == 0
        current = (await row_snapshot(sessions, rows))["current"]
        assert current.revision == 2
    finally:
        await client.jetstream().delete_consumer(STREAM, durable)
        await client.close()
