"""Booking invariants and transactions shared by the trusted HTTP/RPC adapters."""

import hashlib
import json
from collections.abc import Mapping
from datetime import UTC, date, datetime, time, timedelta
from typing import cast

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.correlation import event_metadata
from workplace_platform.typing import JsonObject, JsonValue

from workplace_booking.booking_models import Booking, BookingConfirmation, BookingMutation
from workplace_booking.booking_schemas import BookingView, CreateBookingInput, UpdateBookingInput
from workplace_booking.config import BookingSettings
from workplace_booking.models import Building, Floor, OutboxEvent, Resource, WorkingHours
from workplace_booking.offices import plan_elements
from workplace_booking.policy import MOSCOW, policy_snapshot
from workplace_booking.types import (
    BookingCandidate,
    CapacityWarning,
    EquipmentItem,
    ResourceSnapshot,
)

SEAT_COUNTS = {
    "chair": 1,
    "ergonomic-chair": 1,
    "armchair": 1,
    "beanbag": 1,
    "fitball": 1,
    "sofa-2": 2,
    "sofa-3": 3,
}


def resource_snapshot(
    resource: Resource, floor: Floor, resources: Mapping[str, Resource] | None = None
) -> ResourceSnapshot:
    """Only explicit constructor relationships; never infer equipment by proximity."""
    element = next(
        (
            item
            for item in plan_elements(floor.plan_document or {})
            if item.get("id") == resource.id
        ),
        {},
    )
    # These fields were validated when the constructor document was persisted;
    # keep extension keys rather than rebuilding or normalizing its JSON objects.
    equipment = cast(list[EquipmentItem] | None, element.get("equipment"))
    capacity = (
        sum(SEAT_COUNTS.get(item["type"], 0) * item["quantity"] for item in equipment)
        if equipment is not None
        else cast(int, element.get("seats", 0))
    )
    return {
        "id": resource.id,
        "name": resource.name,
        "kind": resource.kind,
        "floor_id": floor.id,
        "floor_name": floor.name,
        "capacity": capacity,
        "equipment": equipment or [],
        "descendant_ids": sorted(
            item.id
            for item in (resources or {}).values()
            if item.deleted_at is None and resource.id in ancestors(item.id, resources or {})
        ),
    }


def capacity_warnings(
    snapshot: ResourceSnapshot, participants: int | None
) -> list[CapacityWarning]:
    if snapshot.get("kind") == "meeting_room" and participants is not None:
        capacity = snapshot.get("capacity", 0)
        if participants > capacity:
            return [
                {"code": "capacity_exceeded", "capacity": capacity, "participants": participants}
            ]
    return []


def failure(code: str, status: int = 422, **details: JsonValue) -> HTTPException:
    return HTTPException(status, detail={"code": code, **details})


async def advisory_lock(session: AsyncSession, key: str) -> None:
    value = int.from_bytes(hashlib.blake2b(key.encode(), digest_size=8).digest(), signed=True)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": value})


async def locked_office(session: AsyncSession, office_id: str) -> Building:
    await advisory_lock(session, f"workplace:booking:office:{office_id}")
    office = await session.scalar(
        select(Building)
        .where(
            Building.id == office_id,
            Building.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if office is None:
        raise failure("building_not_found", 404)
    return office


async def database_now(session: AsyncSession) -> datetime:
    value = await session.scalar(select(func.clock_timestamp()))
    if not isinstance(value, datetime):
        raise RuntimeError("Database clock did not return a timestamp")
    return value.astimezone(UTC)


def minute_of_day(value: datetime, day: date) -> int | float:
    minutes = (
        value.astimezone(MOSCOW) - datetime.combine(day, time.min, MOSCOW)
    ).total_seconds() / 60
    return int(minutes) if minutes.is_integer() else minutes


def booking_view(booking: Booking) -> BookingView:
    day = booking.starts_at.astimezone(MOSCOW).date()
    return BookingView(
        id=booking.id,
        building_id=booking.building_id,
        floor_id=booking.floor_id,
        resource_id=booking.resource_id,
        date=day,
        start=minute_of_day(booking.starts_at, day),
        end=minute_of_day(booking.ends_at, day),
        owner_id=booking.owner_id,
        participants=booking.participants,
        status=booking.status,
        needs_review=booking.needs_review,
        review_reasons=booking.review_reasons,
        resource_snapshot=booking.resource_snapshot,
        cancellation_reason=booking.cancellation_reason,
        warnings=capacity_warnings(booking.resource_snapshot, booking.participants),
        revision=booking.revision,
        starts_at=booking.starts_at,
        ends_at=booking.ends_at,
        scheduled_ends_at=booking.scheduled_ends_at,
        cancelled_at=booking.cancelled_at,
        created_at=booking.created_at,
        updated_at=booking.updated_at,
    )


async def catalog(
    session: AsyncSession, office_id: str
) -> tuple[dict[str, Floor], dict[str, Resource], dict[int, WorkingHours]]:
    floors = (await session.scalars(select(Floor).where(Floor.building_id == office_id))).all()
    resources = (
        await session.scalars(
            select(Resource).where(
                Resource.floor_id.in_([floor.id for floor in floors]),
            )
        )
    ).all()
    hours = (
        await session.scalars(
            select(WorkingHours).where(
                WorkingHours.building_id == office_id,
            )
        )
    ).all()
    return (
        {floor.id: floor for floor in floors},
        {resource.id: resource for resource in resources},
        {day.weekday: day for day in hours},
    )


def ancestors(resource_id: str, resources: Mapping[str, Resource]) -> list[str]:
    result: list[str] = []
    seen = {resource_id}
    resource = resources.get(resource_id)
    while resource is not None and resource.parent_room_id is not None:
        parent_id = resource.parent_room_id
        if parent_id in seen:
            raise failure("invalid_resource_hierarchy", 409)
        seen.add(parent_id)
        result.append(parent_id)
        resource = resources.get(parent_id)
    return result


def available_resource(
    floor_id: str,
    resource_id: str,
    floors: Mapping[str, Floor],
    resources: Mapping[str, Resource],
) -> Resource:
    floor = floors.get(floor_id)
    resource = resources.get(resource_id)
    if (
        floor is None
        or floor.deleted_at is not None
        or resource is None
        or resource.deleted_at is not None
        or resource.floor_id != floor_id
    ):
        raise failure("resource_unavailable", 409)
    if resource.kind == "workstation":
        for parent_id in ancestors(resource_id, resources):
            parent = resources.get(parent_id)
            if parent is None or parent.deleted_at is not None or not parent.shared_booking:
                raise failure("resource_unavailable", 409)
    return resource


def within_schedule(
    starts_at: datetime, ends_at: datetime, hours: Mapping[int, WorkingHours]
) -> bool:
    start, end = starts_at.astimezone(MOSCOW), ends_at.astimezone(MOSCOW)
    day = hours.get(start.weekday())
    return (
        start.date() == end.date()
        and day is not None
        and start.timetz().replace(tzinfo=None) >= day.start_time
        and end.timetz().replace(tzinfo=None) <= day.end_time
    )


def validate_interval(
    day: date,
    start: int | float,
    end: int | float,
    settings: BookingSettings,
    now: datetime,
    hours: Mapping[int, WorkingHours],
    *,
    started: bool = False,
    administrative: bool = False,
) -> tuple[datetime, datetime]:
    if start >= end or start % settings.step_minutes or end % settings.step_minutes:
        raise failure("invalid_booking_interval")
    policy = policy_snapshot(settings.step_minutes, settings.horizon_days, now)
    if not administrative and day not in policy.allowed_dates:
        raise failure("outside_booking_horizon")
    try:
        starts_at = datetime.combine(day, time.min, MOSCOW) + timedelta(minutes=start)
        ends_at = datetime.combine(day, time.min, MOSCOW) + timedelta(minutes=end)
    except OverflowError as exc:
        raise failure("invalid_booking_interval") from exc
    schedule_start = (
        max(starts_at, now.astimezone(MOSCOW)) if started and not administrative else starts_at
    )
    if not within_schedule(schedule_start, ends_at, hours):
        raise failure("outside_working_hours")
    if not administrative and not started and starts_at < policy.earliest_start:
        raise failure("booking_start_in_past")
    if not administrative and ends_at <= now:
        raise failure("booking_end_in_past")
    return starts_at.astimezone(UTC), ends_at.astimezone(UTC)


async def check_conflicts(
    session: AsyncSession,
    office_id: str,
    resource_id: str,
    starts_at: datetime,
    ends_at: datetime,
    resources: Mapping[str, Resource],
    exclude: str | None = None,
) -> None:
    query = select(Booking).where(
        Booking.building_id == office_id,
        Booking.status == "active",
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude is not None:
        query = query.where(Booking.id != exclude)
    target_parents = set(ancestors(resource_id, resources))
    for other in (await session.scalars(query)).all():
        other_parents = set(other.ancestor_ids) | set(ancestors(other.resource_id, resources))
        if (
            other.resource_id == resource_id
            or resource_id in other_parents
            or resource_id in other.resource_snapshot.get("descendant_ids", [])
            or other.resource_id in target_parents
        ):
            raise failure("booking_conflict", 409, conflicting_booking_id=other.id)


async def changed(
    session: AsyncSession,
    booking: Booking,
    operation: str,
    metadata: Mapping[str, JsonValue] | None = None,
) -> None:
    booking.updated_at = func.clock_timestamp()
    await session.flush()
    await session.refresh(booking, attribute_names=["updated_at"])
    snapshot = cast(JsonObject, booking_view(booking).model_dump(mode="json"))
    if metadata is not None and "administrative" in metadata:
        snapshot["administrative"] = metadata["administrative"]
    previous = await session.scalar(
        select(BookingMutation)
        .where(BookingMutation.booking_id == booking.id)
        .order_by(BookingMutation.revision.desc())
        .limit(1)
    )
    affected_resource_ids = {
        booking.resource_id,
        *booking.ancestor_ids,
        *booking.resource_snapshot.get("descendant_ids", []),
    }
    affected_floor_ids = {booking.floor_id}
    if previous is not None:
        affected_resource_ids.update(cast(list[str], previous.snapshot.get("ancestor_ids", [])))
        affected_resource_ids.add(cast(str, previous.snapshot["resource_id"]))
        affected_resource_ids.update(
            cast(ResourceSnapshot, previous.snapshot.get("resource_snapshot", {})).get(
                "descendant_ids", []
            )
        )
        affected_floor_ids.add(cast(str, previous.snapshot["floor_id"]))
    # Include child places when whole-room use changes; Gateway can invalidate the correct map rows.
    room_children = (
        await session.scalars(
            select(Resource).where(
                Resource.parent_room_id.in_(affected_resource_ids),
            )
        )
    ).all()
    pending = {item.id for item in room_children} - affected_resource_ids
    while pending:
        affected_resource_ids.update(pending)
        pending = (
            set(
                (
                    await session.scalars(
                        select(Resource.id).where(
                            Resource.parent_room_id.in_(pending),
                        )
                    )
                ).all()
            )
            - affected_resource_ids
        )
    snapshot["ancestor_ids"] = [value for value in booking.ancestor_ids]
    session.add(
        BookingMutation(
            booking_id=booking.id,
            revision=booking.revision,
            operation=operation,
            snapshot=snapshot,
        )
    )
    session.add(
        OutboxEvent(
            subject="workplace.booking.booking_changed",
            payload={
                **event_metadata(),
                **(metadata or {}),
                "office_id": booking.building_id,
                "owner_id": booking.owner_id,
                "booking_id": booking.id,
                "floor_id": booking.floor_id,
                "resource_id": booking.resource_id,
                "ancestor_ids": booking.ancestor_ids,
                "affected_resource_ids": sorted(affected_resource_ids),
                "affected_floor_ids": sorted(affected_floor_ids),
                "starts_at": booking.starts_at.isoformat(),
                "ends_at": booking.ends_at.isoformat(),
                "status": booking.status,
                "revision": booking.revision,
                "operation": operation,
                "updated_at": booking.updated_at.isoformat(),
            },
        )
    )


async def find_booking(
    session: AsyncSession, office_id: str, booking_id: str, *, lock: bool = False
) -> Booking:
    query = select(Booking).where(Booking.id == booking_id, Booking.building_id == office_id)
    if lock:
        query = query.with_for_update()
    booking = await session.scalar(query)
    if booking is None:
        raise failure("booking_not_found", 404)
    return booking


def check_revision(booking: Booking, expected: int) -> None:
    if booking.revision != expected:
        raise failure("booking_revision_conflict", 409, current_revision=booking.revision)


async def create_booking(
    session: AsyncSession,
    office_id: str,
    body: CreateBookingInput,
    actor_id: str,
    key: str,
    settings: BookingSettings,
) -> tuple[BookingView, bool]:
    command = body.model_dump(mode="json", exclude={"administrative"})
    # Preserve fingerprints of confirmations saved before this additive command flag.
    if body.administrative:
        command["administrative"] = True
    fingerprint = hashlib.sha256(
        json.dumps(
            {"office_id": office_id, **command},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    async with session.begin():
        await advisory_lock(session, f"workplace:booking:confirmation:{actor_id}:{key}")
        confirmation = await session.get(BookingConfirmation, (actor_id, key))
        if confirmation is not None:
            if confirmation.fingerprint != fingerprint:
                raise failure("idempotency_key_reused", 409)
            replay = await session.get(Booking, confirmation.booking_id)
            if replay is None:
                raise RuntimeError("Booking confirmation references a missing booking")
            return booking_view(replay), False
        await locked_office(session, office_id)
        now = await database_now(session)
        floors, resources, hours = await catalog(session, office_id)
        resource = available_resource(body.floor_id, body.resource_id, floors, resources)
        if resource.kind == "meeting_room" and body.participants is None:
            raise failure("participants_required")
        if resource.kind == "workstation" and body.participants is not None:
            raise failure("participants_not_applicable")
        starts_at, ends_at = validate_interval(
            body.date,
            body.start,
            body.end,
            settings,
            now,
            hours,
            administrative=body.administrative,
        )
        await check_conflicts(session, office_id, body.resource_id, starts_at, ends_at, resources)
        booking = Booking(
            building_id=office_id,
            floor_id=body.floor_id,
            resource_id=body.resource_id,
            ancestor_ids=ancestors(body.resource_id, resources),
            owner_id=body.owner_id,
            starts_at=starts_at,
            ends_at=ends_at,
            scheduled_ends_at=ends_at,
            participants=body.participants,
            resource_snapshot=resource_snapshot(resource, floors[body.floor_id], resources),
        )
        session.add(booking)
        await changed(session, booking, "created", {"administrative": body.administrative})
        session.add(
            BookingConfirmation(
                actor_id=actor_id, key=key, fingerprint=fingerprint, booking_id=booking.id
            )
        )
        result = booking_view(booking)
    return result, True


async def update_booking(
    session: AsyncSession,
    office_id: str,
    booking_id: str,
    body: UpdateBookingInput,
    settings: BookingSettings,
) -> BookingView:
    async with session.begin():
        await locked_office(session, office_id)
        booking = await find_booking(session, office_id, booking_id, lock=True)
        check_revision(booking, body.expected_revision)
        now = await database_now(session)
        if booking.status != "active":
            raise failure("booking_cancelled", 409)
        if booking.ends_at <= now and not body.administrative:
            raise failure("booking_completed", 409)
        old = booking_view(booking)
        candidate: BookingCandidate = {
            "floor_id": body.floor_id if body.floor_id is not None else old.floor_id,
            "resource_id": body.resource_id if body.resource_id is not None else old.resource_id,
            "date": body.date if body.date is not None else old.date,
            "start": body.start if body.start is not None else old.start,
            "end": body.end if body.end is not None else old.end,
            "owner_id": body.owner_id if body.owner_id is not None else old.owner_id,
            "participants": body.participants
            if "participants" in body.model_fields_set
            else old.participants,
        }
        started = booking.starts_at <= now
        if (
            started
            and not body.administrative
            and (
                candidate["floor_id"],
                candidate["resource_id"],
                candidate["date"],
                candidate["start"],
                candidate["owner_id"],
                candidate["participants"],
            )
            != (old.floor_id, old.resource_id, old.date, old.start, old.owner_id, old.participants)
        ):
            raise failure("current_booking_end_only", 409)
        floors, resources, hours = await catalog(session, office_id)
        resource = available_resource(
            candidate["floor_id"], candidate["resource_id"], floors, resources
        )
        if resource.kind == "workstation":
            if body.participants is not None:
                raise failure("participants_not_applicable")
            candidate["participants"] = None
        elif candidate["participants"] is None:
            raise failure("participants_required")
        starts_at, ends_at = validate_interval(
            candidate["date"],
            candidate["start"],
            candidate["end"],
            settings,
            now,
            hours,
            started=started,
            administrative=body.administrative,
        )
        await check_conflicts(
            session,
            office_id,
            candidate["resource_id"],
            starts_at,
            ends_at,
            resources,
            exclude=booking.id,
        )
        booking.floor_id = candidate["floor_id"]
        booking.resource_id = candidate["resource_id"]
        booking.owner_id = candidate["owner_id"]
        booking.participants = candidate["participants"]
        booking.starts_at, booking.ends_at = starts_at, ends_at
        booking.scheduled_ends_at = ends_at
        booking.ancestor_ids = ancestors(booking.resource_id, resources)
        booking.needs_review = False
        booking.review_reasons = []
        booking.resource_snapshot = resource_snapshot(resource, floors[booking.floor_id], resources)
        booking.revision += 1
        await changed(session, booking, "updated", {"administrative": body.administrative})
        result = booking_view(booking)
    return result


async def cancel_booking(
    session: AsyncSession,
    office_id: str,
    booking_id: str,
    expected_revision: int,
    *,
    administrative: bool = False,
) -> BookingView:
    async with session.begin():
        await locked_office(session, office_id)
        booking = await find_booking(session, office_id, booking_id, lock=True)
        if booking.status == "cancelled":
            return booking_view(booking)
        check_revision(booking, expected_revision)
        now = await database_now(session)
        if booking.ends_at <= now and not administrative:
            raise failure("booking_completed", 409)
        if booking.starts_at < now < booking.ends_at:
            booking.ends_at = now
        booking.status = "cancelled"
        booking.cancelled_at = now
        booking.cancellation_reason = "admin_cancelled" if administrative else "user_cancelled"
        booking.revision += 1
        await changed(session, booking, "cancelled", {"administrative": administrative})
        result = booking_view(booking)
    return result


async def list_bookings(
    session: AsyncSession,
    office_id: str,
    *,
    day: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[BookingView]:
    exists = await session.scalar(
        select(Building.id).where(
            Building.id == office_id,
            Building.deleted_at.is_(None),
        )
    )
    if exists is None:
        raise failure("building_not_found", 404)
    if day is not None:
        if date_from is not None or date_to is not None:
            raise failure("ambiguous_booking_dates")
        date_from = date_to = day
    if date_from is not None and date_to is not None and date_from > date_to:
        raise failure("invalid_booking_dates")
    query = select(Booking).where(Booking.building_id == office_id)
    if date_from is not None:
        query = query.where(Booking.starts_at >= datetime.combine(date_from, time.min, MOSCOW))
    if date_to is not None and date_to < date.max:
        query = query.where(
            Booking.starts_at
            < datetime.combine(
                date_to + timedelta(days=1),
                time.min,
                MOSCOW,
            )
        )
    return [
        booking_view(booking)
        for booking in (
            await session.scalars(
                query.order_by(Booking.starts_at, Booking.id),
            )
        ).all()
    ]


async def review_office_bookings(
    session: AsyncSession, office_id: str, now: datetime | None = None
) -> None:
    """Caller holds the building row lock; flush changes and flag affected bookings."""
    await session.flush()
    current = now or await database_now(session)
    floors, resources, hours = await catalog(session, office_id)
    bookings = (
        await session.scalars(
            select(Booking)
            .where(
                Booking.building_id == office_id,
                Booking.status == "active",
                Booking.ends_at > current,
            )
            .with_for_update()
        )
    ).all()
    for booking in bookings:
        reasons = []
        if not within_schedule(booking.starts_at, booking.ends_at, hours):
            reasons.append("working_hours_changed")
        if ancestors(booking.resource_id, resources) != booking.ancestor_ids:
            reasons.append("resource_hierarchy_changed")
        old_descendants = booking.resource_snapshot.get("descendant_ids")
        resource = resources.get(booking.resource_id)
        if (
            resource is not None
            and booking.resource_snapshot.get("kind", resource.kind) != resource.kind
        ):
            reasons.append("resource_type_changed")
        if old_descendants is not None and resource is not None:
            descendants = sorted(
                item.id
                for item in resources.values()
                if item.deleted_at is None and resource.id in ancestors(item.id, resources)
            )
            if descendants != old_descendants:
                reasons.append("resource_hierarchy_changed")
        try:
            available_resource(booking.floor_id, booking.resource_id, floors, resources)
        except HTTPException:
            reasons.append("resource_unavailable")
        # Returning settings to their old state is not an acknowledgement by the owner.
        reasons = sorted(set(booking.review_reasons or []) | set(reasons))
        if reasons and (not booking.needs_review or reasons != booking.review_reasons):
            booking.needs_review = True
            booking.review_reasons = reasons
            booking.revision += 1
            await changed(session, booking, "review_required")
