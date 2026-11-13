"""Consistent interval availability and cursor occupancy from one catalog snapshot."""

from collections.abc import Mapping
from datetime import UTC, datetime, time, timedelta
from typing import Literal, cast

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.typing import JsonObject

from workplace_booking.booking_models import Booking
from workplace_booking.booking_schemas import AvailabilityInput
from workplace_booking.bookings import (
    ancestors,
    available_resource,
    catalog,
    database_now,
    failure,
    resource_snapshot,
    validate_interval,
)
from workplace_booking.config import BookingSettings
from workplace_booking.models import Building, Resource
from workplace_booking.policy import MOSCOW
from workplace_booking.types import AvailabilityView, AvailableResource


def conflicts(resource_id: str, other: Booking, resources: Mapping[str, Resource]) -> bool:
    parents = set(ancestors(resource_id, resources))
    other_parents = set(other.ancestor_ids) | set(ancestors(other.resource_id, resources))
    return (
        resource_id == other.resource_id
        or resource_id in other_parents
        or resource_id in other.resource_snapshot.get("descendant_ids", [])
        or other.resource_id in parents
    )


async def availability(
    session: AsyncSession, office_id: str, body: AvailabilityInput, settings: BookingSettings
) -> AvailabilityView:
    office = await session.scalar(
        select(Building)
        .where(Building.id == office_id, Building.deleted_at.is_(None))
        .with_for_update(read=True)
    )
    if office is None:
        raise failure("building_not_found", 404)
    floors, resources, hours = await catalog(session, office_id)
    floor = floors.get(body.floor_id)
    if floor is None or floor.deleted_at is not None:
        raise failure("floor_not_found", 404)
    if body.start >= body.end:
        raise failure("invalid_booking_interval")
    midnight = datetime.combine(body.date, time.min, MOSCOW)
    start = (midnight + timedelta(minutes=body.start)).astimezone(UTC)
    end = (midnight + timedelta(minutes=body.end)).astimezone(UTC)
    cursor = (
        midnight + timedelta(minutes=body.cursor if body.cursor is not None else body.start)
    ).astimezone(UTC)
    now = await database_now(session)
    policy_error: str | None = None
    try:
        validate_interval(body.date, body.start, body.end, settings, now, hours)
    except HTTPException as exc:
        policy_error = cast(str, cast(JsonObject, exc.detail)["code"])
    query = select(Booking).where(
        Booking.building_id == office_id,
        or_(Booking.status == "active", Booking.ends_at == Booking.cancelled_at),
        Booking.starts_at < max(end, cursor + timedelta(microseconds=1)),
        Booking.ends_at > min(start, cursor),
    )
    if body.exclude_booking_id is not None:
        excluded = await session.get(Booking, body.exclude_booking_id)
        if excluded is None or excluded.building_id != office_id:
            raise failure("booking_not_found", 404)
        query = query.where(Booking.id != body.exclude_booking_id)
    bookings = (await session.scalars(query)).all()
    selected = [
        item
        for item in resources.values()
        if item.floor_id == body.floor_id and item.deleted_at is None
    ]
    if body.resource_id is not None:
        selected = [item for item in selected if item.id == body.resource_id]
        if not selected:
            raise failure("resource_not_found", 404)
    result: list[AvailableResource] = []
    for resource in selected:
        usable = True
        try:
            available_resource(body.floor_id, resource.id, floors, resources)
        except HTTPException:
            usable = False
        overlaps = [
            row
            for row in bookings
            if row.starts_at < end
            and row.ends_at > start
            and conflicts(resource.id, row, resources)
        ]
        at_cursor = [row for row in bookings if row.starts_at <= cursor < row.ends_at]
        cursor_conflicts = [row for row in at_cursor if conflicts(resource.id, row, resources)]
        places = [
            item
            for item in resources.values()
            if item.deleted_at is None
            and item.kind == "workstation"
            and resource.id in ancestors(item.id, resources)
        ]
        occupied_places = sum(
            any(conflicts(place.id, row, resources) for row in at_cursor) for place in places
        )
        status: Literal["free", "partial", "occupied"] = "occupied" if cursor_conflicts else "free"
        if resource.kind == "meeting_room" and places and 0 < occupied_places < len(places):
            # A whole-room booking occupies every child through the same conflict relation.
            status = "partial"
        result.append(
            {
                **resource_snapshot(resource, floor),
                "parent_room_id": resource.parent_room_id,
                "shared_booking": resource.shared_booking,
                "available": usable and policy_error is None and not overlaps,
                "policy_error": policy_error,
                "conflicting_booking_ids": [row.id for row in overlaps],
                "cursor_status": status,
                "bookable_places": len(places),
                "occupied_places": occupied_places,
            }
        )
    return {
        "office_id": office_id,
        "floor_id": floor.id,
        "revision": office.revision,
        "resources": result,
    }
