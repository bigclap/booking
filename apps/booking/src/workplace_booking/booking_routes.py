from datetime import date as Date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.auth import require_internal_key

from workplace_booking.availability import availability
from workplace_booking.booking_models import BookingMutation
from workplace_booking.booking_schemas import (
    AvailabilityInput,
    BookingView,
    CancelBookingInput,
    CreateBookingInput,
    UpdateBookingInput,
)
from workplace_booking.bookings import (
    booking_view,
    cancel_booking,
    create_booking,
    find_booking,
    list_bookings,
    update_booking,
)


def create_booking_router(get_session) -> APIRouter:
    router = APIRouter(
        prefix="/internal/offices/{office_id}/bookings",
        tags=["bookings"],
        dependencies=[Depends(require_internal_key)],
    )
    DbSession = Annotated[AsyncSession, Depends(get_session)]

    @router.get("", response_model=list[BookingView])
    async def index(
        office_id: str,
        session: DbSession,
        date: Date | None = None,
        date_from: Date | None = None,
        date_to: Date | None = None,
    ):
        return await list_bookings(
            session, office_id, day=date, date_from=date_from, date_to=date_to
        )

    @router.get("/{booking_id}", response_model=BookingView)
    async def read(office_id: str, booking_id: str, session: DbSession):
        return booking_view(await find_booking(session, office_id, booking_id))

    @router.get("/{booking_id}/history")
    async def history(office_id: str, booking_id: str, session: DbSession):
        await find_booking(session, office_id, booking_id)
        rows = (
            await session.scalars(
                select(BookingMutation)
                .where(
                    BookingMutation.booking_id == booking_id,
                )
                .order_by(BookingMutation.revision)
            )
        ).all()
        return [
            {
                "revision": row.revision,
                "operation": row.operation,
                "snapshot": row.snapshot,
                "occurred_at": row.occurred_at,
            }
            for row in rows
        ]

    @router.post("", response_model=BookingView, status_code=201)
    async def add(
        office_id: str,
        body: CreateBookingInput,
        request: Request,
        response: Response,
        session: DbSession,
        key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)],
        actor_id: Annotated[str, Header(alias="X-User-ID", min_length=1, max_length=1000)],
    ):
        result, created = await create_booking(
            session,
            office_id,
            body,
            actor_id,
            key,
            request.app.state.settings,
        )
        response.status_code = 201 if created else 200
        return result

    @router.patch("/{booking_id}", response_model=BookingView)
    async def update(
        office_id: str,
        booking_id: str,
        body: UpdateBookingInput,
        request: Request,
        session: DbSession,
    ):
        return await update_booking(
            session, office_id, booking_id, body, request.app.state.settings
        )

    @router.post("/{booking_id}/cancel", response_model=BookingView)
    async def cancel(
        office_id: str,
        booking_id: str,
        body: CancelBookingInput,
        session: DbSession,
    ):
        return await cancel_booking(
            session,
            office_id,
            booking_id,
            body.expected_revision,
            administrative=body.administrative,
        )

    return router


def create_availability_router(get_session) -> APIRouter:
    router = APIRouter(
        prefix="/internal/offices/{office_id}", dependencies=[Depends(require_internal_key)]
    )
    DbSession = Annotated[AsyncSession, Depends(get_session)]

    @router.post("/availability", tags=["availability"])
    async def read(office_id: str, body: AvailabilityInput, request: Request, session: DbSession):
        return await availability(session, office_id, body, request.app.state.settings)

    return router
