from datetime import time

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from workplace_booking.config import BookingSettings
from workplace_booking.main import build_app, get_session
from workplace_booking.models import Building, Floor, Resource, WorkingHours

KEY = "test-key-at-least-24-characters"


@pytest.mark.integration
async def test_internal_catalog_returns_facts_without_copying_gateway_user_rights(
    migrated_booking_database,
):
    engine = create_async_engine(migrated_booking_database)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            session = AsyncSession(bind=connection, expire_on_commit=False)
            try:
                session.add_all(
                    [
                        Building(id="test-office-one", name="Первое здание"),
                        Building(id="test-office-two", name="Второе здание"),
                    ]
                )
                await session.flush()
                session.add_all(
                    [
                        WorkingHours(
                            building_id="test-office-one",
                            weekday=0,
                            start_time=time(9),
                            end_time=time(18),
                        ),
                        Floor(id="test-floor", building_id="test-office-one", name="Первый этаж"),
                    ]
                )
                await session.flush()
                session.add(
                    Resource(
                        id="test-room",
                        floor_id="test-floor",
                        kind="meeting_room",
                        name="Переговорная",
                        shared_booking=True,
                    )
                )
                await session.flush()
                session.add(
                    Resource(
                        id="test-seat",
                        floor_id="test-floor",
                        kind="workstation",
                        name="Место у окна",
                        parent_room_id="test-room",
                    )
                )
                await session.flush()
                app = build_app(BookingSettings(internal_api_key=KEY))

                async def test_session():
                    yield session

                app.dependency_overrides[get_session] = test_session
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://booking",
                    headers={"X-Internal-Key": KEY},
                ) as client:
                    response = await client.get("/internal/buildings")
                    assert response.status_code == 200
                    buildings = {row["id"]: row for row in response.json()}
                    assert {"test-office-one", "test-office-two"} <= buildings.keys()
                    assert buildings["test-office-one"]["working_hours"] == [
                        {
                            "weekday": 0,
                            "start_time": "09:00:00",
                            "end_time": "18:00:00",
                        }
                    ]
                    floors = await client.get("/internal/buildings/test-office-one/floors")
                    assert floors.status_code == 200
                    assert floors.json()[0]["id"] == "test-floor"
                    resources = await client.get(
                        "/internal/buildings/test-office-one/floors/test-floor/resources",
                    )
                    assert resources.status_code == 200
                    assert {row["id"] for row in resources.json()} == {"test-room", "test-seat"}
                    seat = next(row for row in resources.json() if row["id"] == "test-seat")
                    assert seat["parent_room_id"] == "test-room"
                    legacy = await client.get("/internal/offices/test-office-one")
                    assert legacy.status_code == 200
                    assert legacy.json()["revision"] == 1
                    assert legacy.json()["floors"][0]["plan_document"] is None
            finally:
                await session.close()
                await transaction.rollback()
    finally:
        await engine.dispose()
