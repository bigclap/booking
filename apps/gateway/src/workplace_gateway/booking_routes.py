import asyncio
from datetime import date as Date
from typing import Annotated, Protocol, TypedDict
from urllib.parse import quote
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter
from workplace_platform.jwt_tokens import AccessContext

from workplace_gateway.config import GatewaySettings
from workplace_gateway.contracts.booking import (
    BookingCancel,
    BookingCreate,
    BookingUpdate,
    ClientBooking,
)
from workplace_gateway.contracts.internal import InternalBooking, InternalOwner, InternalProfile
from workplace_gateway.revisions import expected_revision, idempotency_key
from workplace_gateway.upstream import Authenticate, BuildingAccess, UpstreamCall, parse_upstream


class BookingIndex(Protocol):
    async def __call__(
        self,
        request: Request,
        office_id: str,
        date: Date | None = None,
        date_from: Date | None = None,
        date_to: Date | None = None,
    ) -> list[ClientBooking]: ...


class BookingRead(Protocol):
    async def __call__(self, request: Request, office_id: str, booking_id: str) -> JSONResponse: ...


class BookingCreateHandler(Protocol):
    async def __call__(
        self, request: Request, office_id: str, payload: BookingCreate
    ) -> JSONResponse: ...


class BookingUpdateHandler(Protocol):
    async def __call__(
        self, request: Request, office_id: str, booking_id: str, payload: BookingUpdate
    ) -> JSONResponse: ...


class BookingCancelHandler(Protocol):
    async def __call__(
        self,
        request: Request,
        office_id: str,
        booking_id: str,
        payload: BookingCancel | None = None,
    ) -> JSONResponse: ...


class BookingHandlers(TypedDict):
    index: BookingIndex
    read: BookingRead
    create: BookingCreateHandler
    update: BookingUpdateHandler
    cancel: BookingCancelHandler


def install_booking_routes(
    app: FastAPI,
    settings: GatewaySettings,
    authenticate: Authenticate,
    building_access: BuildingAccess,
    call: UpstreamCall,
) -> BookingHandlers:
    def path(office_id: str, booking_id: str | None = None) -> str:
        value = f"/internal/offices/{quote(office_id, safe='')}/bookings"
        return value if booking_id is None else value + "/" + quote(booking_id, safe="")

    def authorize(request: Request, office_id: str) -> AccessContext:
        current = authenticate(request)
        building_access(current, office_id)
        return current

    def administrative(request: Request, current: AccessContext) -> bool:
        return current.user.role == "admin" and not getattr(request.state, "employee_only", False)

    def edit_permission(request: Request, current: AccessContext, row: InternalBooking) -> None:
        if (
            current.user.role != "admin" or getattr(request.state, "employee_only", False)
        ) and row.owner_id != current.user.id:
            raise HTTPException(403, detail={"code": "booking_owner_required"})

    async def owner_for_command(
        request: Request,
        current: AccessContext,
        office_id: str,
        owner_id: str | None,
    ) -> str:
        owner_id = owner_id or current.user.id
        if owner_id == current.user.id:
            return owner_id
        if current.user.role != "admin":
            raise HTTPException(403, detail={"code": "booking_owner_required"})
        owner = parse_upstream(
            TypeAdapter(InternalOwner),
            await call(
                request,
                settings.users_url,
                f"/internal/users/{quote(owner_id, safe='')}",
                current=current,
            ),
        )
        if not owner.active:
            raise HTTPException(409, detail={"code": "booking_owner_unavailable"})
        if owner.role != "admin" and office_id not in owner.building_ids:
            raise HTTPException(403, detail={"code": "booking_owner_office_required"})
        return owner_id

    async def enrich(
        request: Request, current: AccessContext, rows: list[InternalBooking]
    ) -> list[ClientBooking]:
        names = {current.user.id: f"{current.user.first_name} {current.user.last_name}"}
        wanted = sorted({row.owner_id for row in rows} - names.keys())
        # Old unknown references stay visible as history; they are never assigned to the viewer.
        known_ids: list[str] = []
        for value in wanted:
            try:
                UUID(value)
                known_ids.append(value)
            except ValueError:
                pass
        batches = [known_ids[offset : offset + 500] for offset in range(0, len(known_ids), 500)]
        profiles = await asyncio.gather(
            *(
                call(
                    request,
                    settings.users_url,
                    "/internal/users/lookup",
                    method="POST",
                    current=current,
                    payload={"ids": batch},
                )
                for batch in batches
            )
        )
        for batch in profiles:
            for user in parse_upstream(TypeAdapter(list[InternalProfile]), batch):
                names[user.id] = f"{user.first_name} {user.last_name}"
        return [
            ClientBooking.model_validate(
                {
                    "id": row.id,
                    "buildingId": row.building_id,
                    "floorId": row.floor_id,
                    "resourceId": row.resource_id,
                    "date": row.date,
                    "start": row.start,
                    "end": row.end,
                    "ownerId": row.owner_id,
                    "ownerName": names.get(row.owner_id, "Неизвестный сотрудник"),
                    "participants": row.participants,
                    "status": row.status,
                    "revision": row.revision,
                    "needsReview": row.needs_review,
                    "reviewReasons": row.review_reasons,
                    "resourceSnapshot": row.resource_snapshot,
                    "cancellationReason": row.cancellation_reason,
                    "warnings": row.warnings,
                    "startsAt": row.starts_at,
                    "endsAt": row.ends_at,
                    "scheduledEndsAt": row.scheduled_ends_at,
                    "cancelledAt": row.cancelled_at,
                }
            )
            for row in rows
        ]

    async def result(
        request: Request, current: AccessContext, row: object, status: int = 200
    ) -> JSONResponse:
        booking = parse_upstream(TypeAdapter(InternalBooking), row)
        record = (await enrich(request, current, [booking]))[0]
        return JSONResponse(
            record.model_dump(mode="json", by_alias=True, exclude_none=True),
            status_code=status,
            headers={"ETag": f'"{record.revision}"'},
        )

    @app.get(
        "/api/offices/{office_id}/bookings",
        response_model=list[ClientBooking],
        response_model_exclude_none=True,
        tags=["bookings"],
    )
    async def index(
        request: Request,
        office_id: str,
        date: Date | None = None,
        date_from: Annotated[Date | None, Query(alias="dateFrom")] = None,
        date_to: Annotated[Date | None, Query(alias="dateTo")] = None,
    ) -> list[ClientBooking]:
        current = authorize(request, office_id)
        query = {
            key: value.isoformat()
            for key, value in (
                ("date", date),
                ("date_from", date_from),
                ("date_to", date_to),
            )
            if value is not None
        }
        rows = await call(
            request, settings.booking_url, path(office_id), current=current, query=query
        )
        bookings = parse_upstream(TypeAdapter(list[InternalBooking]), rows)
        return await enrich(request, current, bookings)

    @app.get(
        "/api/offices/{office_id}/bookings/{booking_id}",
        response_model=ClientBooking,
        response_model_exclude_none=True,
        tags=["bookings"],
    )
    async def read(request: Request, office_id: str, booking_id: str) -> JSONResponse:
        current = authorize(request, office_id)
        row = await call(
            request, settings.booking_url, path(office_id, booking_id), current=current
        )
        return await result(request, current, row)

    @app.post(
        "/api/offices/{office_id}/bookings",
        response_model=ClientBooking,
        response_model_exclude_none=True,
        tags=["bookings"],
    )
    async def create(request: Request, office_id: str, payload: BookingCreate) -> JSONResponse:
        current = authorize(request, office_id)
        key = idempotency_key(request)
        owner_id = await owner_for_command(request, current, office_id, payload.owner_id)
        data: dict[str, object] = payload.model_dump(exclude={"owner_id"}, exclude_none=True)
        data["owner_id"] = owner_id
        if administrative(request, current):
            data["administrative"] = True
        row, status = await call(
            request,
            settings.booking_url,
            path(office_id),
            method="POST",
            current=current,
            payload=data,
            extra_headers={"Idempotency-Key": key},
            with_status=True,
        )
        return await result(request, current, row, status)

    @app.patch(
        "/api/offices/{office_id}/bookings/{booking_id}",
        response_model=ClientBooking,
        response_model_exclude_none=True,
        tags=["bookings"],
    )
    async def update(
        request: Request, office_id: str, booking_id: str, payload: BookingUpdate
    ) -> JSONResponse:
        current = authorize(request, office_id)
        revision = expected_revision(request, payload.revision)
        original = parse_upstream(
            TypeAdapter(InternalBooking),
            await call(request, settings.booking_url, path(office_id, booking_id), current=current),
        )
        edit_permission(request, current, original)
        data: dict[str, object] = payload.model_dump(exclude_unset=True, exclude={"revision"})
        if "owner_id" in data:
            data["owner_id"] = await owner_for_command(
                request, current, office_id, payload.owner_id
            )
        data["expected_revision"] = revision
        if administrative(request, current):
            data["administrative"] = True
        row = await call(
            request,
            settings.booking_url,
            path(office_id, booking_id),
            method="PATCH",
            current=current,
            payload=data,
        )
        return await result(request, current, row)

    @app.post(
        "/api/offices/{office_id}/bookings/{booking_id}/cancel",
        response_model=ClientBooking,
        response_model_exclude_none=True,
        tags=["bookings"],
    )
    async def cancel(
        request: Request, office_id: str, booking_id: str, payload: BookingCancel | None = None
    ) -> JSONResponse:
        current = authorize(request, office_id)
        revision = expected_revision(request, payload.revision if payload else None)
        original = parse_upstream(
            TypeAdapter(InternalBooking),
            await call(request, settings.booking_url, path(office_id, booking_id), current=current),
        )
        edit_permission(request, current, original)
        row = await call(
            request,
            settings.booking_url,
            path(office_id, booking_id) + "/cancel",
            method="POST",
            current=current,
            payload={
                "expected_revision": revision,
                **({"administrative": True} if administrative(request, current) else {}),
            },
        )
        return await result(request, current, row)

    return {"index": index, "read": read, "create": create, "update": update, "cancel": cancel}
