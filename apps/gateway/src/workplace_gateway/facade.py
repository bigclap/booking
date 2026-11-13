"""Employee operations shared with the HTTP controllers, including MCP callers."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import date as Date
from typing import Annotated, Literal, Protocol, TypedDict
from urllib.parse import quote, urlencode
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, StrictInt, TypeAdapter, ValidationError
from workplace_platform.jwt_tokens import AccessContext

from workplace_gateway.booking_routes import BookingHandlers
from workplace_gateway.config import GatewaySettings
from workplace_gateway.contracts.booking import (
    BookingCancel,
    BookingPolicy,
    BookingUpdate,
    ClientBooking,
)
from workplace_gateway.contracts.internal import InternalBooking
from workplace_gateway.contracts.offices import FloorDocument, OfficeDocument, PlanElementDocument
from workplace_gateway.upstream import Authenticate, BuildingAccess, UpstreamCall, parse_upstream

type DateInput = Date | str | None
type ResourceKind = Literal["any", "workstation", "meeting_room"]
type PublicObject = dict[str, object]
type OfficeList = Callable[[Request], Awaitable[list[OfficeDocument]]]
type OfficeRead = Callable[[str, Request, Response], Awaitable[OfficeDocument]]
type ListOffices = Callable[[AccessContext], Awaitable[list[PublicObject]]]


class GetOffice(Protocol):
    async def __call__(self, current: AccessContext, office_id: str) -> PublicObject: ...


class ListBookings(Protocol):
    async def __call__(
        self, current: AccessContext, office_id: str, date: DateInput = None
    ) -> list[ClientBooking]: ...


class Availability(Protocol):
    async def __call__(
        self,
        current: AccessContext,
        office_id: str,
        date: DateInput = None,
        start: int | None = None,
        end: int | None = None,
        kind: ResourceKind = "any",
        participants: int | None = None,
        floor_id: str | None = None,
        cursor: int | None = None,
        resource_id: str | None = None,
        exclude_booking_id: str | None = None,
    ) -> PublicObject: ...


class PrepareBooking(Protocol):
    async def __call__(
        self,
        current: AccessContext,
        office_id: str,
        resource_id: str,
        floor_id: str | None = None,
        date: DateInput = None,
        start: int | None = None,
        end: int | None = None,
        participants: int | None = None,
    ) -> PublicObject: ...


class UpdateBooking(Protocol):
    async def __call__(
        self,
        current: AccessContext,
        office_id: str,
        booking_id: str,
        revision: int | None = None,
        *,
        date: DateInput = None,
        start: int | None = None,
        end: int | None = None,
        resource_id: str | None = None,
        floor_id: str | None = None,
        participants: int | None = None,
    ) -> PublicObject: ...


class CancelBooking(Protocol):
    async def __call__(
        self,
        current: AccessContext,
        office_id: str,
        booking_id: str,
        revision: int | None = None,
    ) -> PublicObject: ...


class FacadeCallbacks(TypedDict):
    list_offices: ListOffices
    get_office: GetOffice
    list_bookings: ListBookings
    availability: Availability
    prepare_booking: PrepareBooking
    update_booking: UpdateBooking
    cancel_booking: CancelBooking


class ResourceEquipment(BaseModel):
    type: str
    quantity: int


class Resource(BaseModel):
    """The RPC fields consumed by the employee projection, without opaque extensions."""

    id: str
    name: str
    kind: Literal["workstation", "meeting_room"]
    floor_id: str
    floor_name: str | None = None
    parent_room_id: str | None = None
    shared_booking: bool = False
    capacity: int = 0
    equipment: list[ResourceEquipment] = Field(default_factory=list)
    available: bool | None = None
    policy_error: str | None = None
    conflicting_booking_ids: list[str] = Field(default_factory=list)
    cursor_status: Literal["free", "partial", "occupied"] | None = None
    bookable_places: int = 0
    occupied_places: int = 0


class AvailabilityBatch(BaseModel):
    revision: int
    resources: list[Resource]


_RESOURCES = TypeAdapter(list[Resource])
_AVAILABILITY = TypeAdapter(AvailabilityBatch)
_POLICY = TypeAdapter(BookingPolicy)
_BOOKING = TypeAdapter(InternalBooking)
_PUBLIC_OBJECT = TypeAdapter(dict[str, object])


def resource_projection(row: Resource) -> PublicObject:
    result: PublicObject = row.model_dump(exclude_unset=True, exclude={"equipment"})
    result["equipment"] = [{"type": item.type, "quantity": item.quantity} for item in row.equipment]
    return result


def scene_element(element: PlanElementDocument) -> PublicObject:
    data: PublicObject = element.model_dump(
        mode="json", by_alias=True, exclude_none=True, include=set(type(element).model_fields)
    )
    if element.equipment is not None:
        data["equipment"] = [
            {"type": item.type, "quantity": item.quantity} for item in element.equipment
        ]
    if element.points is not None:
        data["points"] = [{"x": item.x, "y": item.y} for item in element.points]
    return data


class Selection(BaseModel):
    date: Date | None = None
    start: StrictInt | None = Field(default=None, ge=0, lt=1440)
    end: StrictInt | None = Field(default=None, gt=0, le=1440)
    participants: StrictInt | None = Field(default=None, gt=0)


def selection(
    *,
    date: DateInput = None,
    start: int | None = None,
    end: int | None = None,
    participants: int | None = None,
) -> Selection:
    try:
        result = Selection.model_validate(
            {"date": date, "start": start, "end": end, "participants": participants}
        )
    except ValidationError as exc:
        raise HTTPException(422, detail={"code": "validation_error"}) from exc
    if result.start is not None and result.end is not None and result.start >= result.end:
        raise HTTPException(422, detail={"code": "invalid_booking_interval"})
    return result


def create_facade(
    app: FastAPI,
    settings: GatewaySettings,
    authenticate: Authenticate,
    building_access: BuildingAccess,
    call: UpstreamCall,
    offices: OfficeList,
    office: OfficeRead,
    bookings: BookingHandlers,
) -> FacadeCallbacks:
    def request_for(
        current: AccessContext, method: str = "GET", *, employee_only: bool = False
    ) -> Request:
        # Only this in-process adapter constructs this state. Public headers cannot set it.
        return Request(
            {
                "type": "http",
                "method": method,
                "path": "/",
                "headers": [],
                "app": app,
                "state": {
                    "verified_context": current,
                    "request_id": str(uuid4()),
                    "employee_only": employee_only,
                },
            }
        )

    async def full_office(current: AccessContext, office_id: str) -> OfficeDocument:
        return await office(office_id, request_for(current), Response())

    async def catalog(
        current: AccessContext, office_id: str, floor_id: str | None = None
    ) -> tuple[OfficeDocument, list[FloorDocument], list[Resource]]:
        document = await full_office(current, office_id)
        floors = [floor for floor in document.floors if floor_id is None or floor.id == floor_id]
        if not floors:
            raise HTTPException(404, detail={"code": "floor_not_found"})
        batches = await asyncio.gather(
            *(
                call(
                    request_for(current),
                    settings.booking_url,
                    f"/internal/buildings/{quote(office_id, safe='')}/floors/"
                    f"{quote(floor.id, safe='')}/resources",
                    current=current,
                )
                for floor in floors
            )
        )
        return (
            document,
            floors,
            [row for batch in batches for row in parse_upstream(_RESOURCES, batch)],
        )

    async def list_offices(current: AccessContext) -> list[PublicObject]:
        return [
            {
                "id": row.id,
                "name": row.name,
                "address": row.address,
                "floors": [{"id": floor.id, "name": floor.name} for floor in row.floors],
            }
            for row in await offices(request_for(current))
        ]

    async def get_office(current: AccessContext, office_id: str) -> PublicObject:
        document, floors, resources = await catalog(current, office_id)
        return {
            "id": document.id,
            "name": document.name,
            "address": document.address,
            "revision": document.revision,
            "hours": {key: value.model_dump() for key, value in document.hours.items()},
            "resources": [resource_projection(row) for row in resources],
            # Physical surroundings help selection; raster backgrounds and opaque extensions
            # never enter model context. The browser still receives its complete document.
            "floors": [
                {
                    "id": floor.id,
                    "name": floor.name,
                    "elements": [scene_element(element) for element in floor.elements],
                }
                for floor in floors
            ],
        }

    async def list_bookings(
        current: AccessContext, office_id: str, date: DateInput = None
    ) -> list[ClientBooking]:
        day = selection(date=date).date
        return await bookings["index"](request_for(current), office_id, day, None, None)

    async def availability(
        current: AccessContext,
        office_id: str,
        date: DateInput = None,
        start: int | None = None,
        end: int | None = None,
        kind: ResourceKind = "any",
        participants: int | None = None,
        floor_id: str | None = None,
        cursor: int | None = None,
        resource_id: str | None = None,
        exclude_booking_id: str | None = None,
    ) -> PublicObject:
        params = selection(date=date, start=start, end=end, participants=participants)
        document, floors, resources = await catalog(current, office_id, floor_id)
        if resource_id is not None:
            target = next((row for row in resources if row.id == resource_id), None)
            if target is None:
                raise HTTPException(404, detail={"code": "resource_not_found"})
            floors = [floor for floor in floors if floor.id == target.floor_id]
        complete = params.date is not None and params.start is not None and params.end is not None
        if params.date is not None and params.start is not None and params.end is not None:
            batches = await asyncio.gather(
                *(
                    call(
                        request_for(current),
                        settings.booking_url,
                        f"/internal/offices/{quote(office_id, safe='')}/availability",
                        method="POST",
                        current=current,
                        payload={
                            "floor_id": floor.id,
                            "date": params.date.isoformat(),
                            "start": params.start,
                            "end": params.end,
                            **({"cursor": cursor} if cursor is not None else {}),
                            **({"resource_id": resource_id} if resource_id is not None else {}),
                            **(
                                {"exclude_booking_id": exclude_booking_id}
                                if exclude_booking_id
                                else {}
                            ),
                        },
                    )
                    for floor in floors
                )
            )
            validated = [parse_upstream(_AVAILABILITY, batch) for batch in batches]
            # Plan and availability may race; never combine different catalog revisions.
            if any(batch.revision != document.revision for batch in validated):
                raise HTTPException(409, detail={"code": "office_revision_conflict"})
            resources = [row for batch in validated for row in batch.resources]
        if resource_id is not None:
            resources = [row for row in resources if row.id == resource_id]
        if kind != "any":
            resources = [row for row in resources if row.kind == kind]
        projected: list[PublicObject] = []
        for row in resources:
            public = resource_projection(row)
            if not complete:
                public["available"] = None
            public["warnings"] = (
                [
                    {
                        "code": "capacity_exceeded",
                        "capacity": row.capacity,
                        "participants": participants,
                    }
                ]
                if participants and row.kind == "meeting_room" and participants > row.capacity
                else []
            )
            projected.append(public)
        return {
            "officeId": office_id,
            "revision": document.revision,
            "intervalComplete": complete,
            "resources": projected,
        }

    async def prepare_booking(
        current: AccessContext,
        office_id: str,
        resource_id: str,
        floor_id: str | None = None,
        date: DateInput = None,
        start: int | None = None,
        end: int | None = None,
        participants: int | None = None,
    ) -> PublicObject:
        params = selection(date=date, start=start, end=end, participants=participants)
        _, _, resources = await catalog(current, office_id, floor_id)
        resource = next((row for row in resources if row.id == resource_id), None)
        if resource is None:
            raise HTTPException(404, detail={"code": "resource_not_found"})
        if resource.kind == "workstation" and params.participants is not None:
            raise HTTPException(422, detail={"code": "participants_not_applicable"})
        policy = parse_upstream(
            _POLICY,
            await call(
                request_for(current), settings.booking_url, "/internal/policy", current=current
            ),
        )
        for minute in (params.start, params.end):
            if minute is not None and minute % policy.step_minutes:
                raise HTTPException(422, detail={"code": "invalid_booking_interval"})
        proposal: PublicObject = {
            "officeId": office_id,
            "floorId": resource.floor_id,
            "resourceId": resource_id,
            **params.model_dump(mode="json", exclude_none=True),
        }
        # D-119: opening an old link asks for a new date while retaining the time.
        if params.date is not None and params.date < policy.allowed_dates[0]:
            proposal.pop("date", None)
        url = settings.public_base_url + "/booking?" + urlencode(proposal)
        return {"url": url, "proposal": proposal}

    async def own_record(
        current: AccessContext, office_id: str, booking_id: str
    ) -> InternalBooking:
        building_access(current, office_id)
        row = parse_upstream(
            _BOOKING,
            await call(
                request_for(current),
                settings.booking_url,
                f"/internal/offices/{quote(office_id, safe='')}/bookings/"
                f"{quote(booking_id, safe='')}",
                current=current,
            ),
        )
        if row.owner_id != current.user.id:
            raise HTTPException(403, detail={"code": "booking_owner_required"})
        return row

    async def update_booking(
        current: AccessContext,
        office_id: str,
        booking_id: str,
        revision: int | None = None,
        *,
        date: DateInput = None,
        start: int | None = None,
        end: int | None = None,
        resource_id: str | None = None,
        floor_id: str | None = None,
        participants: int | None = None,
    ) -> PublicObject:
        row = await own_record(current, office_id, booking_id)
        changes = {
            "date": date,
            "start": start,
            "end": end,
            "resource_id": resource_id,
            "floor_id": floor_id,
            "participants": participants,
        }
        payload = BookingUpdate.model_validate(
            {
                **{key: value for key, value in changes.items() if value is not None},
                "revision": revision if revision is not None else row.revision,
            },
            by_name=True,
            by_alias=False,
        )
        response = await bookings["update"](
            request_for(current, "PATCH", employee_only=True), office_id, booking_id, payload
        )
        return parse_upstream(_PUBLIC_OBJECT, json.loads(bytes(response.body)))

    async def cancel_booking(
        current: AccessContext, office_id: str, booking_id: str, revision: int | None = None
    ) -> PublicObject:
        row = await own_record(current, office_id, booking_id)
        response = await bookings["cancel"](
            request_for(current, "POST", employee_only=True),
            office_id,
            booking_id,
            BookingCancel(revision=revision if revision is not None else row.revision),
        )
        return parse_upstream(_PUBLIC_OBJECT, json.loads(bytes(response.body)))

    @app.get("/api/offices/{office_id}/availability", tags=["booking"], response_model=None)
    async def http_availability(
        request: Request,
        office_id: str,
        date: Date | None = None,
        start: Annotated[int | None, Query(ge=0, lt=1440)] = None,
        end: Annotated[int | None, Query(gt=0, le=1440)] = None,
        kind: ResourceKind = "any",
        participants: Annotated[int | None, Query(gt=0)] = None,
        floor_id: Annotated[str | None, Query(alias="floorId")] = None,
        resource_id: Annotated[str | None, Query(alias="resourceId")] = None,
        cursor: Annotated[int | None, Query(ge=0, lt=1440)] = None,
        exclude_booking_id: Annotated[str | None, Query(alias="excludeBookingId")] = None,
    ) -> PublicObject:
        return await availability(
            authenticate(request),
            office_id,
            date,
            start,
            end,
            kind,
            participants,
            floor_id,
            cursor,
            resource_id,
            exclude_booking_id,
        )

    return {
        "list_offices": list_offices,
        "get_office": get_office,
        "list_bookings": list_bookings,
        "availability": availability,
        "prepare_booking": prepare_booking,
        "update_booking": update_booking,
        "cancel_booking": cancel_booking,
    }
