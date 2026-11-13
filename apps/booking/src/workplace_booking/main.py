from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from workplace_platform.auth import require_internal_key
from workplace_platform.web import create_app

from workplace_booking.booking_routes import create_availability_router, create_booking_router
from workplace_booking.bookings import resource_snapshot
from workplace_booking.config import BookingSettings
from workplace_booking.models import Building, Floor, Resource, WorkingHours
from workplace_booking.office_revision_routes import create_router as office_import_router
from workplace_booking.offices import (
    create_office,
    get_building,
    id_conflict,
    office_document,
    update_plan,
    update_settings,
)
from workplace_booking.policy import BookingPolicy, policy_snapshot
from workplace_booking.schemas import (
    BuildingView,
    FloorView,
    OfficeCreateInput,
    OfficeDocument,
    OfficePlanInput,
    OfficeSettingsInput,
    ResourceView,
    WorkingHoursView,
)


@asynccontextmanager
async def lifespan(app):
    settings = app.state.settings
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for Booking")
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    app.state.db_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield
    finally:
        await engine.dispose()


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.db_sessionmaker() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_session)]


def build_app(settings: BookingSettings | None = None):
    app = create_app("booking", settings or BookingSettings(), lifespan=lifespan)
    # Gateway owns user identity and rights (D-117). This is only the trusted service boundary.
    internal = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_key)])

    @internal.get("/policy", response_model=BookingPolicy, tags=["policy"])
    async def get_policy(request: Request):
        config = request.app.state.settings
        return policy_snapshot(config.step_minutes, config.horizon_days)

    @internal.get("/buildings", response_model=list[BuildingView], tags=["catalog"])
    async def list_buildings(session: DbSession):
        buildings = (
            await session.scalars(
                select(Building)
                .where(
                    Building.deleted_at.is_(None),
                )
                .order_by(Building.name, Building.id)
            )
        ).all()
        if not buildings:
            return []
        hours = (
            await session.scalars(
                select(WorkingHours)
                .where(
                    WorkingHours.building_id.in_([building.id for building in buildings]),
                )
                .order_by(WorkingHours.weekday)
            )
        ).all()
        return [
            BuildingView(
                id=building.id,
                name=building.name,
                address=building.address,
                working_hours=[
                    WorkingHoursView.model_validate(row)
                    for row in hours
                    if row.building_id == building.id
                ],
            )
            for building in buildings
        ]

    @internal.get(
        "/buildings/{building_id}/floors", response_model=list[FloorView], tags=["catalog"]
    )
    async def list_floors(building_id: str, session: DbSession):
        await get_building(session, building_id)
        return (
            await session.scalars(
                select(Floor)
                .where(
                    Floor.building_id == building_id,
                    Floor.deleted_at.is_(None),
                )
                .order_by(Floor.position, Floor.id)
            )
        ).all()

    @internal.get(
        "/buildings/{building_id}/floors/{floor_id}/resources",
        response_model=list[ResourceView],
        tags=["catalog"],
    )
    async def list_resources(building_id: str, floor_id: str, session: DbSession):
        await get_building(session, building_id)
        floor = await session.scalar(
            select(Floor).where(
                Floor.id == floor_id,
                Floor.building_id == building_id,
                Floor.deleted_at.is_(None),
            )
        )
        if floor is None:
            raise HTTPException(404, detail={"code": "floor_not_found"})
        resources = (
            await session.scalars(
                select(Resource)
                .where(
                    Resource.floor_id == floor_id,
                    Resource.deleted_at.is_(None),
                )
                .order_by(Resource.name, Resource.id)
            )
        ).all()
        return [
            ResourceView(
                **ResourceView.model_validate(resource).model_dump(
                    exclude={"capacity", "equipment"}
                ),
                capacity=resource_snapshot(resource, floor)["capacity"],
                equipment=resource_snapshot(resource, floor)["equipment"],
            )
            for resource in resources
        ]

    @internal.get("/offices", response_model=list[OfficeDocument], tags=["offices"])
    async def list_offices(session: DbSession):
        # Lock metadata while assembling floor documents, so a plan write cannot split the snapshot.
        buildings = (
            await session.scalars(
                select(Building)
                .where(
                    Building.deleted_at.is_(None),
                )
                .order_by(Building.name, Building.id)
                .with_for_update(read=True)
            )
        ).all()
        return [await office_document(session, building) for building in buildings]

    @internal.get("/offices/{office_id}", response_model=OfficeDocument, tags=["offices"])
    async def read_office(office_id: str, session: DbSession):
        building = await session.scalar(
            select(Building)
            .where(
                Building.id == office_id,
                Building.deleted_at.is_(None),
            )
            .with_for_update(read=True)
        )
        if building is None:
            raise HTTPException(404, detail={"code": "building_not_found"})
        return await office_document(session, building)

    @internal.post("/offices", response_model=OfficeDocument, status_code=201, tags=["offices"])
    async def add_office(body: OfficeCreateInput, session: DbSession):
        try:
            return await create_office(session, body)
        except IntegrityError as exc:
            raise id_conflict() from exc

    @internal.patch(
        "/offices/{office_id}/settings", response_model=OfficeDocument, tags=["offices"]
    )
    async def save_settings(office_id: str, body: OfficeSettingsInput, session: DbSession):
        return await update_settings(session, office_id, body)

    @internal.put("/offices/{office_id}/plan", response_model=OfficeDocument, tags=["offices"])
    async def save_plan(office_id: str, body: OfficePlanInput, session: DbSession):
        try:
            return await update_plan(session, office_id, body)
        except IntegrityError as exc:
            raise id_conflict() from exc

    app.include_router(internal)
    app.include_router(create_booking_router(get_session))
    app.include_router(create_availability_router(get_session))
    app.include_router(office_import_router(get_session))
    return app


app = build_app()
