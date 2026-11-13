"""Employee operations shared with the HTTP controllers, including MCP callers."""

import asyncio
import json
from datetime import date as Date
from typing import Annotated, Literal
from urllib.parse import quote, urlencode
from uuid import uuid4

from fastapi import HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, StrictInt, ValidationError

from workplace_gateway.contracts.booking import BookingCancel, BookingUpdate


def resource_projection(row):
    known = {
        "id",
        "name",
        "kind",
        "floor_id",
        "floor_name",
        "parent_room_id",
        "shared_booking",
        "capacity",
        "available",
        "policy_error",
        "conflicting_booking_ids",
        "cursor_status",
        "bookable_places",
        "occupied_places",
    }
    result = {key: value for key, value in row.items() if key in known}
    result["equipment"] = [
        {"type": item["type"], "quantity": item["quantity"]} for item in row.get("equipment", [])
    ]
    return result


def scene_element(element):
    data = element.model_dump(
        mode="json", by_alias=True, exclude_none=True, include=set(type(element).model_fields)
    )
    if "equipment" in data:
        data["equipment"] = [
            {"type": item["type"], "quantity": item["quantity"]} for item in data["equipment"]
        ]
    if "points" in data:
        data["points"] = [{"x": item["x"], "y": item["y"]} for item in data["points"]]
    return data


class Selection(BaseModel):
    date: Date | None = None
    start: StrictInt | None = Field(default=None, ge=0, lt=1440)
    end: StrictInt | None = Field(default=None, gt=0, le=1440)
    participants: StrictInt | None = Field(default=None, gt=0)


def selection(**values):
    try:
        result = Selection.model_validate(values)
    except ValidationError as exc:
        raise HTTPException(422, detail={"code": "validation_error"}) from exc
    if result.start is not None and result.end is not None and result.start >= result.end:
        raise HTTPException(422, detail={"code": "invalid_booking_interval"})
    return result


def create_facade(app, settings, authenticate, building_access, call, offices, office, bookings):
    def request_for(current, method="GET", *, employee_only=False):
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

    async def full_office(current, office_id):
        return await office(office_id, request_for(current), Response())

    async def catalog(current, office_id, floor_id=None):
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
        return document, floors, [resource_projection(row) for batch in batches for row in batch]

    async def list_offices(current):
        return [
            {
                "id": row.id,
                "name": row.name,
                "address": row.address,
                "floors": [{"id": floor.id, "name": floor.name} for floor in row.floors],
            }
            for row in await offices(request_for(current))
        ]

    async def get_office(current, office_id):
        document, floors, resources = await catalog(current, office_id)
        return {
            "id": document.id,
            "name": document.name,
            "address": document.address,
            "revision": document.revision,
            "hours": {key: value.model_dump() for key, value in document.hours.items()},
            "resources": resources,
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

    async def list_bookings(current, office_id, date=None):
        day = selection(date=date).date
        return await bookings["index"](request_for(current), office_id, day, None, None)

    async def availability(
        current,
        office_id,
        date=None,
        start=None,
        end=None,
        kind="any",
        participants=None,
        floor_id=None,
        cursor=None,
        resource_id=None,
        exclude_booking_id=None,
    ):
        params = selection(date=date, start=start, end=end, participants=participants)
        document, floors, resources = await catalog(current, office_id, floor_id)
        if resource_id is not None:
            target = next((row for row in resources if row["id"] == resource_id), None)
            if target is None:
                raise HTTPException(404, detail={"code": "resource_not_found"})
            floors = [floor for floor in floors if floor.id == target["floor_id"]]
        complete = all(value is not None for value in (params.date, params.start, params.end))
        if complete:
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
            # Plan and availability may race; never combine different catalog revisions.
            if any(batch["revision"] != document.revision for batch in batches):
                raise HTTPException(409, detail={"code": "office_revision_conflict"})
            resources = [
                resource_projection(row) for batch in batches for row in batch["resources"]
            ]
        else:
            resources = [{**row, "available": None} for row in resources]
        if resource_id is not None:
            resources = [row for row in resources if row["id"] == resource_id]
        if kind != "any":
            resources = [row for row in resources if row["kind"] == kind]
        for row in resources:
            row["warnings"] = (
                [
                    {
                        "code": "capacity_exceeded",
                        "capacity": row.get("capacity", 0),
                        "participants": participants,
                    }
                ]
                if participants
                and row["kind"] == "meeting_room"
                and participants > row.get("capacity", 0)
                else []
            )
        return {
            "officeId": office_id,
            "revision": document.revision,
            "intervalComplete": complete,
            "resources": resources,
        }

    async def prepare_booking(
        current,
        office_id,
        resource_id,
        floor_id=None,
        date=None,
        start=None,
        end=None,
        participants=None,
    ):
        params = selection(date=date, start=start, end=end, participants=participants)
        _, _, resources = await catalog(current, office_id, floor_id)
        resource = next((row for row in resources if row["id"] == resource_id), None)
        if resource is None:
            raise HTTPException(404, detail={"code": "resource_not_found"})
        if resource["kind"] == "workstation" and params.participants is not None:
            raise HTTPException(422, detail={"code": "participants_not_applicable"})
        policy = await call(
            request_for(current), settings.booking_url, "/internal/policy", current=current
        )
        for minute in (params.start, params.end):
            if minute is not None and minute % policy["step_minutes"]:
                raise HTTPException(422, detail={"code": "invalid_booking_interval"})
        proposal = {
            "officeId": office_id,
            "floorId": resource["floor_id"],
            "resourceId": resource_id,
            **params.model_dump(mode="json", exclude_none=True),
        }
        # D-119: opening an old link asks for a new date while retaining the time.
        if params.date is not None and params.date.isoformat() < policy["allowed_dates"][0]:
            proposal.pop("date", None)
        url = settings.public_base_url + "/booking?" + urlencode(proposal)
        return {"url": url, "proposal": proposal}

    async def own_record(current, office_id, booking_id):
        building_access(current, office_id)
        row = await call(
            request_for(current),
            settings.booking_url,
            f"/internal/offices/{quote(office_id, safe='')}/bookings/{quote(booking_id, safe='')}",
            current=current,
        )
        if row["owner_id"] != current.user.id:
            raise HTTPException(403, detail={"code": "booking_owner_required"})
        return row

    async def update_booking(current, office_id, booking_id, revision=None, **changes):
        row = await own_record(current, office_id, booking_id)
        payload = BookingUpdate.model_validate(
            {
                **{key: value for key, value in changes.items() if value is not None},
                "revision": revision if revision is not None else row["revision"],
            },
            by_name=True,
            by_alias=False,
        )
        response = await bookings["update"](
            request_for(current, "PATCH", employee_only=True), office_id, booking_id, payload
        )
        return json.loads(response.body)

    async def cancel_booking(current, office_id, booking_id, revision=None):
        row = await own_record(current, office_id, booking_id)
        response = await bookings["cancel"](
            request_for(current, "POST", employee_only=True),
            office_id,
            booking_id,
            BookingCancel(revision=revision if revision is not None else row["revision"]),
        )
        return json.loads(response.body)

    @app.get("/api/offices/{office_id}/availability", tags=["booking"])
    async def http_availability(
        request: Request,
        office_id: str,
        date: Date | None = None,
        start: Annotated[int | None, Query(ge=0, lt=1440)] = None,
        end: Annotated[int | None, Query(gt=0, le=1440)] = None,
        kind: Literal["any", "workstation", "meeting_room"] = "any",
        participants: Annotated[int | None, Query(gt=0)] = None,
        floor_id: Annotated[str | None, Query(alias="floorId")] = None,
        resource_id: Annotated[str | None, Query(alias="resourceId")] = None,
        cursor: Annotated[int | None, Query(ge=0, lt=1440)] = None,
        exclude_booking_id: Annotated[str | None, Query(alias="excludeBookingId")] = None,
    ):
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
