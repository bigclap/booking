"""Persistence of office settings and exact constructor documents.

The gateway authenticates users and authorizes commands. This module owns the
local transaction, stable identifiers, and the normalized catalog projection.
"""

import re
from copy import deepcopy
from datetime import UTC, datetime, time
from math import isfinite
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.correlation import event_metadata

from workplace_booking.models import Building, Floor, OutboxEvent, Resource, WorkingHours
from workplace_booking.schemas import (
    DAYS,
    OfficeCreateInput,
    OfficeDocument,
    OfficeFloorDocument,
    OfficePlanInput,
    OfficeSettingsInput,
)


def invalid_document() -> HTTPException:
    return HTTPException(422, detail={"code": "invalid_office_document"})


def id_conflict() -> HTTPException:
    return HTTPException(409, detail={"code": "office_identifier_conflict"})


async def get_building(session: AsyncSession, office_id: str, *, lock: bool = False) -> Building:
    query = select(Building).where(Building.id == office_id, Building.deleted_at.is_(None))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    building = await session.scalar(query)
    if building is None:
        raise HTTPException(404, detail={"code": "building_not_found"})
    return building


async def office_document(session: AsyncSession, building: Building) -> OfficeDocument:
    floors = (
        await session.scalars(
            select(Floor)
            .where(
                Floor.building_id == building.id,
                Floor.deleted_at.is_(None),
            )
            .order_by(Floor.position, Floor.id)
        )
    ).all()
    return OfficeDocument(
        id=building.id,
        name=building.name,
        address=building.address,
        revision=building.revision,
        updated_at=building.updated_at,
        hours_document=building.hours_document,
        floors=[
            OfficeFloorDocument(
                id=floor.id,
                name=floor.name,
                position=floor.position,
                plan_document=floor.plan_document,
            )
            for floor in floors
        ],
    )


def default_hours() -> dict[str, dict[str, Any]]:
    return {
        day: {"enabled": weekday < 5, "start": "09:00", "end": "19:00"}
        for weekday, day in enumerate(DAYS)
    }


async def replace_hours(session: AsyncSession, building: Building, hours: dict[str, Any]) -> None:
    building.hours_document = deepcopy(hours)
    await session.execute(delete(WorkingHours).where(WorkingHours.building_id == building.id))
    for weekday, day in enumerate(DAYS):
        entry = hours.get(day)
        if entry is not None and entry["enabled"]:
            session.add(
                WorkingHours(
                    building_id=building.id,
                    weekday=weekday,
                    start_time=time.fromisoformat(entry["start"]),
                    end_time=time.fromisoformat(entry["end"]),
                )
            )


async def lock_office_identifiers(session: AsyncSession) -> None:
    # Constructor IDs are unique across buildings, floors and all plan elements.
    # A global transaction lock serializes identity allocation across those tables.
    await session.execute(text("SELECT pg_advisory_xact_lock(122486597284709)"))


def check_revision(building: Building, expected_revision: int) -> None:
    if building.revision != expected_revision:
        raise HTTPException(
            409,
            detail={
                "code": "office_revision_conflict",
                "current_revision": building.revision,
            },
        )


async def record_change(
    session: AsyncSession,
    building: Building,
    change: str,
    *,
    advance_revision: bool = True,
) -> None:
    if advance_revision:
        building.revision += 1
    building.updated_at = func.clock_timestamp()
    await session.flush()
    await session.refresh(building, attribute_names=["updated_at"])
    session.add(
        OutboxEvent(
            subject="workplace.booking.office_changed",
            payload={
                **event_metadata(),
                "office_id": building.id,
                "revision": building.revision,
                "updated_at": building.updated_at.isoformat(),
                "change": change,
            },
        )
    )


async def review_changed_conditions(session: AsyncSession, office_id: str) -> None:
    from workplace_booking.bookings import review_office_bookings

    await session.flush()
    await review_office_bookings(session, office_id)


async def create_office(session: AsyncSession, body: OfficeCreateInput) -> OfficeDocument:
    async with session.begin():
        await lock_office_identifiers(session)
        building = Building(
            id=f"office-{uuid4()}", name=body.name, address=body.address, revision=1
        )
        session.add(building)
        await session.flush()
        await replace_hours(session, building, default_hours())
        floor_id = f"floor-{uuid4()}"
        session.add(
            Floor(
                id=floor_id,
                building_id=building.id,
                name="1 этаж",
                position=0,
                plan_document={
                    "id": floor_id,
                    "name": "1 этаж",
                    "width": 1800,
                    "height": 1100,
                    "elements": [],
                },
            )
        )
        await record_change(session, building, "created", advance_revision=False)
        result = await office_document(session, building)
    return result


async def update_settings(
    session: AsyncSession,
    office_id: str,
    body: OfficeSettingsInput,
) -> OfficeDocument:
    async with session.begin():
        building = await get_building(session, office_id, lock=True)
        check_revision(building, body.expected_revision)
        building.name = body.name
        building.address = body.address
        await replace_hours(
            session,
            building,
            {day: value.model_dump() for day, value in body.hours_document.items()},
        )
        await review_changed_conditions(session, office_id)
        await record_change(session, building, "settings")
        result = await office_document(session, building)
    return result


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1000:
        raise invalid_document()
    return value


def _name(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 1000:
        raise invalid_document()
    return value


def _number(value, lower=-100000, upper=100000):
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not isfinite(value)
        or not lower <= value <= upper
    ):
        raise invalid_document()


def validate_element(element):
    """Validate present geometry without dropping forward-compatible extension fields."""
    for key in ("x", "y"):
        if key in element:
            _number(element[key])
    for key in ("width", "height"):
        if key in element:
            _number(element[key], 1, 20000)
    if "rotation" in element:
        _number(element["rotation"], -360000, 360000)
    for key in ("bookable", "shared", "walls", "locked"):
        if key in element and not isinstance(element[key], bool):
            raise invalid_document()
    if "resourceType" in element and element["resourceType"] not in {"meeting_room", "workplace"}:
        raise invalid_document()
    if "seats" in element:
        _number(element["seats"], 0, 100000)
        if not isinstance(element["seats"], int):
            raise invalid_document()
    if "equipment" in element:
        equipment = element["equipment"]
        if not isinstance(equipment, list) or len(equipment) > 1000:
            raise invalid_document()
        for item in equipment:
            if not isinstance(item, dict):
                raise invalid_document()
            _identifier(item.get("type"))
            _number(item.get("quantity"), 0, 100000)
            if not isinstance(item["quantity"], int):
                raise invalid_document()
    if "points" in element:
        points = element["points"]
        if not isinstance(points, list) or len(points) > 1000:
            raise invalid_document()
        for point in points:
            if not isinstance(point, dict):
                raise invalid_document()
            _number(point.get("x"))
            _number(point.get("y"))


def validate_plan(office_id: str, documents: list[dict[str, Any]]) -> set[str]:
    """Check identity, geometry and explicit relations at the owning storage boundary."""
    identifiers = {office_id}
    for document in documents:
        floor_id = _identifier(document.get("id"))
        if floor_id in identifiers:
            raise invalid_document()
        identifiers.add(floor_id)
        _name(document.get("name"))
        for field in ("width", "height"):
            value = document.get(field)
            if (
                isinstance(value, bool)
                or not isinstance(value, int | float)
                or not 1 <= value <= 20000
            ):
                raise invalid_document()
        elements = document.get("elements")
        if not isinstance(elements, list) or len(elements) > 10000:
            raise invalid_document()
        by_id = {}
        for element in elements:
            if not isinstance(element, dict):
                raise invalid_document()
            element_id = _identifier(element.get("id"))
            if element_id in identifiers:
                raise invalid_document()
            identifiers.add(element_id)
            _name(element.get("name"))
            if element.get("kind") not in {"room", "desk", "wall", "furniture"}:
                raise invalid_document()
            validate_element(element)
            by_id[element_id] = element
        background = document.get("background")
        if background is not None:
            if not isinstance(background, dict) or not isinstance(background.get("src"), str):
                raise invalid_document()
            if not re.fullmatch(
                r"data:image/(png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=\s]+",
                background["src"],
            ):
                raise invalid_document()
            for key in ("x", "y"):
                if key in background:
                    _number(background[key])
            for key in ("width", "height"):
                if key in background:
                    _number(background[key], 1, 20000)
            if "opacity" in background:
                _number(background["opacity"], 0, 1)
        for element in elements:
            seen = {element["id"]}
            parent_id = element.get("roomId")
            while parent_id is not None:
                if not isinstance(parent_id, str):
                    raise invalid_document()
                parent = by_id.get(parent_id)
                if parent_id in seen or parent is None or parent.get("kind") != "room":
                    raise invalid_document()
                seen.add(parent_id)
                parent_id = parent.get("roomId")
    return identifiers


def project_resources(document: dict[str, Any]) -> list[dict[str, Any]]:
    """Same eligibility and room ancestry as frontend bookingModel.getResources."""
    elements = document["elements"]
    by_id = {element["id"]: element for element in elements}

    def ancestors(element):
        result = []
        parent_id = element.get("roomId")
        while parent_id is not None:
            parent = by_id[parent_id]
            result.append(parent)
            parent_id = parent.get("roomId")
        return result

    def workplace(element):
        return element["kind"] == "desk" or (
            element["kind"] == "furniture"
            and element.get("resourceType") == "workplace"
            and element.get("bookable") is True
        )

    selected = [
        element
        for element in elements
        if (
            element.get("bookable") is not False
            and (
                element["kind"] == "room"
                or workplace(element)
                and all(
                    parent.get("bookable") is False or parent.get("shared") is True
                    for parent in ancestors(element)
                )
            )
        )
    ]
    selected_ids = {element["id"] for element in selected}
    return [
        {
            "id": element["id"],
            "floor_id": document["id"],
            "name": element["name"],
            "kind": "meeting_room" if element["kind"] == "room" else "workstation",
            "shared_booking": element["kind"] == "room" and element.get("shared") is True,
            "parent_room_id": next(
                (parent["id"] for parent in ancestors(element) if parent["id"] in selected_ids),
                None,
            ),
        }
        for element in selected
    ]


async def check_identifiers(
    session: AsyncSession,
    office_id: str,
    documents: list[dict[str, Any]],
    identifiers: set[str],
) -> None:
    """Never transfer identities from another office or reuse a floor as an element."""
    incoming_floor_ids = {document["id"] for document in documents}
    all_buildings = set((await session.scalars(select(Building.id))).all())
    if (identifiers - {office_id}) & all_buildings:
        raise id_conflict()
    floors = (await session.scalars(select(Floor))).all()
    own_floor_ids = {floor.id for floor in floors if floor.building_id == office_id}
    for floor in floors:
        if floor.building_id != office_id:
            occupied = {floor.id}
            if floor.plan_document:
                occupied.update(
                    element["id"]
                    for element in floor.plan_document.get("elements", [])
                    if isinstance(element, dict) and isinstance(element.get("id"), str)
                )
            if occupied & identifiers:
                raise id_conflict()
        elif floor.id in identifiers and floor.id not in incoming_floor_ids:
            raise id_conflict()
    resources = (await session.scalars(select(Resource))).all()
    for resource in resources:
        if resource.id in incoming_floor_ids or (
            resource.floor_id not in own_floor_ids and resource.id in identifiers
        ):
            raise id_conflict()


async def replace_plan_documents(
    session: AsyncSession,
    office_id: str,
    documents: list[dict[str, Any]],
    identifiers: set[str],
) -> None:
    """Apply a validated plan inside the caller's transaction and identity lock."""
    await check_identifiers(session, office_id, documents, identifiers)
    floors = (await session.scalars(select(Floor).where(Floor.building_id == office_id))).all()
    floors_by_id = {floor.id: floor for floor in floors}
    resources = (
        await session.scalars(
            select(Resource).where(
                Resource.floor_id.in_(floors_by_id),
            )
        )
    ).all()
    resources_by_id = {resource.id: resource for resource in resources}
    removed_at = datetime.now(UTC)
    for floor in floors:
        floor.deleted_at = removed_at
    for resource in resources:
        resource.deleted_at = removed_at
    for position, document in enumerate(documents):
        floor = floors_by_id.get(document["id"])
        if floor is None:
            floor = Floor(id=document["id"], building_id=office_id)
            session.add(floor)
        floor.name = document["name"]
        floor.position = position
        floor.plan_document = document
        floor.deleted_at = None
    await session.flush()
    projected = [resource for document in documents for resource in project_resources(document)]
    # Add all identities before assigning parent links, including nested rooms.
    for value in projected:
        resource = resources_by_id.get(value["id"])
        if resource is None:
            resource = Resource(id=value["id"])
            resources_by_id[resource.id] = resource
            session.add(resource)
        resource.floor_id = value["floor_id"]
        resource.name = value["name"]
        resource.kind = value["kind"]
        resource.shared_booking = value["shared_booking"]
        resource.parent_room_id = None
        resource.deleted_at = None
    await session.flush()
    for value in projected:
        resources_by_id[value["id"]].parent_room_id = value["parent_room_id"]


async def update_plan(
    session: AsyncSession,
    office_id: str,
    body: OfficePlanInput,
) -> OfficeDocument:
    documents = deepcopy(body.floors)
    identifiers = validate_plan(office_id, documents)
    async with session.begin():
        await lock_office_identifiers(session)
        building = await get_building(session, office_id, lock=True)
        check_revision(building, body.expected_revision)
        await replace_plan_documents(session, office_id, documents, identifiers)
        await review_changed_conditions(session, office_id)
        await record_change(session, building, "plan")
        result = await office_document(session, building)
    return result
