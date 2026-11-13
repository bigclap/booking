"""Concurrent requests use an actual TCP HTTP server and isolated PostgreSQL."""

import asyncio
import socket
from datetime import UTC, datetime, time
from uuid import uuid4

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_booking import availability as availability_module
from workplace_booking import bookings
from workplace_booking.booking_models import Booking, BookingConfirmation
from workplace_booking.booking_routes import create_availability_router, create_booking_router
from workplace_booking.config import BookingSettings
from workplace_booking.models import Building, Floor, OutboxEvent, Resource, WorkingHours

KEY = "test-booking-key-with-at-least-24-characters"
NOW = datetime(2026, 11, 12, 9, 2, 17, 123456, UTC)


@pytest.fixture
async def booking_api(migrated_booking_database, monkeypatch):
    engine = create_async_engine(migrated_booking_database, pool_size=5, max_overflow=20)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    identifiers = {
        name: f"{name}-{uuid4()}"
        for name in (
            "office",
            "floor",
            "room",
            "desk",
            "sibling",
            "nested",
            "nested_desk",
        )
    }
    async with sessions.begin() as session:
        session.add(Building(id=identifiers["office"], name="Брони: тестовый офис"))
        await session.flush()
        session.add(
            Floor(id=identifiers["floor"], building_id=identifiers["office"], name="Тестовый этаж")
        )
        session.add_all(
            WorkingHours(
                building_id=identifiers["office"],
                weekday=weekday,
                start_time=time(0),
                end_time=time(23, 59),
            )
            for weekday in range(7)
        )
        await session.flush()
        session.add(
            Resource(
                id=identifiers["room"],
                floor_id=identifiers["floor"],
                kind="meeting_room",
                name="Комната",
                shared_booking=True,
            )
        )
        await session.flush()
        session.add_all(
            [
                Resource(
                    id=identifiers[name],
                    floor_id=identifiers["floor"],
                    kind="workstation",
                    name=name,
                    parent_room_id=identifiers["room"],
                )
                for name in ("desk", "sibling")
            ]
        )
        session.add(
            Resource(
                id=identifiers["nested"],
                floor_id=identifiers["floor"],
                kind="meeting_room",
                name="Вложенная",
                shared_booking=True,
                parent_room_id=identifiers["room"],
            )
        )
        await session.flush()
        session.add(
            Resource(
                id=identifiers["nested_desk"],
                floor_id=identifiers["floor"],
                kind="workstation",
                name="Вложенное место",
                parent_room_id=identifiers["nested"],
            )
        )

    async def controlled_clock(session):
        return NOW

    monkeypatch.setattr(bookings, "database_now", controlled_clock)

    async def availability_clock(session):
        return await bookings.database_now(session)

    monkeypatch.setattr(availability_module, "database_now", availability_clock)

    async def get_session():
        async with sessions() as session:
            yield session

    app = FastAPI()
    app.state.settings = BookingSettings(internal_api_key=KEY)
    app.include_router(create_booking_router(get_session))
    app.include_router(create_availability_router(get_session))
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, lifespan="off", access_log=False, log_level="error")
    )
    task = asyncio.create_task(server.serve(sockets=[listener]))
    while not server.started:
        if task.done():
            await task
        await asyncio.sleep(0.001)
    try:
        async with httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}",
            timeout=60,
            trust_env=False,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=100),
            headers={"X-Internal-Key": KEY, "X-User-ID": "actor-1"},
        ) as client:
            yield client, sessions, identifiers
    finally:
        server.should_exit = True
        await task
        listener.close()
        await engine.dispose()


def payload(ids, resource="desk", **changes):
    body = {
        "floor_id": ids["floor"],
        "resource_id": ids[resource],
        "date": "2026-11-13",
        "start": 540,
        "end": 600,
        "owner_id": "owner-1",
    }
    if resource in {"room", "nested"}:
        body["participants"] = 3
    return {**body, **changes}


def path(ids):
    return f"/internal/offices/{ids['office']}/bookings"


async def create(client, ids, body=None, key=None):
    return await client.post(
        path(ids), json=body or payload(ids), headers={"Idempotency-Key": key or str(uuid4())}
    )


@pytest.mark.integration
@pytest.mark.parametrize("room_vs_child", [False, True])
async def test_100_concurrent_real_http_requests_have_exactly_one_winner(
    booking_api, room_vs_child
):
    client, sessions, ids = booking_api
    responses = await asyncio.gather(
        *[
            create(client, ids, payload(ids, "room" if room_vs_child and index % 2 else "desk"))
            for index in range(100)
        ]
    )
    assert [response.status_code for response in responses].count(201) == 1
    assert [response.status_code for response in responses].count(409) == 99
    async with sessions() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Booking)
                .where(
                    Booking.building_id == ids["office"],
                )
            )
            == 1
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(BookingConfirmation)
                .join(
                    Booking,
                    Booking.id == BookingConfirmation.booking_id,
                )
                .where(Booking.building_id == ids["office"])
            )
            == 1
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(OutboxEvent)
                .where(
                    OutboxEvent.payload["office_id"].astext == ids["office"],
                )
            )
            == 1
        )


@pytest.mark.integration
async def test_adjacent_intervals_shared_siblings_and_nested_conflicts(booking_api):
    client, _, ids = booking_api
    assert (await create(client, ids)).status_code == 201
    assert (await create(client, ids, payload(ids, start=600, end=660))).status_code == 201
    assert (await create(client, ids, payload(ids, "sibling"))).status_code == 201
    nested = await create(client, ids, payload(ids, "nested_desk"))
    assert nested.status_code == 201
    assert (await create(client, ids, payload(ids, "nested"))).status_code == 409
    assert (await create(client, ids, payload(ids, "room"))).status_code == 409
    rows = await client.get(path(ids))
    assert len(rows.json()) == 4
    assert (await client.get(path(ids), params={"date": "2026-11-13"})).json() == rows.json()
    assert (await client.get(path(ids), params={"date_from": "2026-11-14"})).json() == []
    assert (
        await client.get(path(ids), params={"date_from": "2026-11-14", "date_to": "2026-11-12"})
    ).status_code == 422


@pytest.mark.integration
async def test_idempotency_is_bound_to_exact_payload_and_actor(booking_api):
    client, _, ids = booking_api
    key = str(uuid4())
    responses = await asyncio.gather(*[create(client, ids, key=key) for _ in range(20)])
    assert sorted(response.status_code for response in responses) == [200] * 19 + [201]
    assert len({response.json()["id"] for response in responses}) == 1
    mismatch = await create(client, ids, payload(ids, end=660), key=key)
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"]["code"] == "idempotency_key_reused"
    other_actor = await client.post(
        path(ids),
        json=payload(ids, "sibling"),
        headers={
            "Idempotency-Key": key,
            "X-User-ID": "actor-2",
        },
    )
    assert other_actor.status_code == 201


@pytest.mark.integration
@pytest.mark.parametrize(
    "changes,code",
    [
        ({"start": 541}, "invalid_booking_interval"),
        ({"start": 600, "end": 540}, "invalid_booking_interval"),
        ({"date": "2026-11-11"}, "outside_booking_horizon"),
        ({"date": "2026-11-19"}, "outside_booking_horizon"),
        ({"date": "9999-12-31", "end": 1440}, "outside_booking_horizon"),
        ({"date": "2026-11-12", "start": 720, "end": 780}, "booking_start_in_past"),
        ({"end": 1440}, "outside_working_hours"),
    ],
)
async def test_invalid_intervals_never_persist(booking_api, changes, code):
    client, _, ids = booking_api
    response = await create(client, ids, payload(ids, **changes))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert (await client.get(path(ids))).json() == []


@pytest.mark.integration
async def test_revision_prevents_lost_edits_and_cancel_releases_slot(booking_api):
    client, _, ids = booking_api
    first = (await create(client, ids)).json()
    url = f"{path(ids)}/{first['id']}"
    updates = await asyncio.gather(
        *[
            client.patch(url, json={"expected_revision": first["revision"], "end": end})
            for end in (660, 720)
        ]
    )
    assert sorted(response.status_code for response in updates) == [200, 409]
    current = (await client.get(url)).json()
    assert current["revision"] == 2
    stale = await client.post(f"{url}/cancel", json={"expected_revision": 1})
    assert stale.status_code == 409
    cancelled = await client.post(f"{url}/cancel", json={"expected_revision": 2})
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert (await create(client, ids)).status_code == 201


@pytest.mark.integration
async def test_started_booking_only_changes_end_and_cancel_retains_exact_elapsed_history(
    booking_api,
):
    client, sessions, ids = booking_api
    first = (await create(client, ids)).json()
    async with sessions.begin() as session:
        row = await session.get(Booking, first["id"])
        row.starts_at = datetime(2026, 11, 12, 9, 0, tzinfo=UTC)
        row.ends_at = row.scheduled_ends_at = datetime(2026, 11, 12, 10, 0, tzinfo=UTC)
    url = f"{path(ids)}/{first['id']}"
    moved = await client.patch(url, json={"expected_revision": 1, "start": 725})
    assert moved.status_code == 409
    changed = await client.patch(url, json={"expected_revision": 1, "end": 785})
    assert changed.status_code == 200
    cancelled = await client.post(f"{url}/cancel", json={"expected_revision": 2})
    assert cancelled.status_code == 200
    result = cancelled.json()
    assert result["start"] == 720
    assert result["end"] == 722 + 17.123456 / 60
    assert datetime.fromisoformat(result["ends_at"]) == NOW
    assert result["scheduled_ends_at"] != result["ends_at"]


@pytest.mark.integration
async def test_reviewed_child_keeps_original_room_blocked_after_shared_mode_is_disabled(
    booking_api,
):
    client, sessions, ids = booking_api
    first = (await create(client, ids)).json()
    async with sessions.begin() as session:
        await session.scalar(select(Building).where(Building.id == ids["office"]).with_for_update())
        room = await session.get(Resource, ids["room"])
        desk = await session.get(Resource, ids["desk"])
        room.shared_booking = False
        desk.deleted_at = NOW
        await bookings.review_office_bookings(session, ids["office"])
    current = (await client.get(f"{path(ids)}/{first['id']}")).json()
    assert current["needs_review"] is True
    assert (current["start"], current["end"]) == (540, 600)
    assert (await create(client, ids, payload(ids, "room"))).status_code == 409
    async with sessions.begin() as session:
        room = await session.get(Resource, ids["room"])
        desk = await session.get(Resource, ids["desk"])
        room.shared_booking = True
        desk.deleted_at = None
    repaired = await client.patch(
        f"{path(ids)}/{first['id']}",
        json={
            "expected_revision": current["revision"],
            "end": 605,
        },
    )
    assert repaired.status_code == 200
    assert repaired.json()["needs_review"] is False


@pytest.mark.integration
async def test_failed_extension_does_not_change_revision_or_interval(booking_api):
    client, _, ids = booking_api
    first = (await create(client, ids)).json()
    assert (await create(client, ids, payload(ids, start=600, end=660))).status_code == 201
    url = f"{path(ids)}/{first['id']}"
    conflict = await client.patch(url, json={"expected_revision": 1, "end": 630})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "booking_conflict"
    assert (await client.get(url)).json() == first


@pytest.mark.integration
async def test_schedule_change_preserves_blocking_booking_until_valid_repair(booking_api):
    client, sessions, ids = booking_api
    first = (await create(client, ids)).json()
    async with sessions.begin() as session:
        await session.scalar(select(Building).where(Building.id == ids["office"]).with_for_update())
        weekday = await session.get(WorkingHours, (ids["office"], 4))
        weekday.start_time = time(9, 30)
        await bookings.review_office_bookings(session, ids["office"])
    url = f"{path(ids)}/{first['id']}"
    flagged = (await client.get(url)).json()
    assert flagged["needs_review"] is True
    assert (flagged["start"], flagged["end"]) == (540, 600)
    assert (await create(client, ids, payload(ids, "room", start=570))).status_code == 409
    invalid_repair = await client.patch(url, json={"expected_revision": 2, "end": 605})
    assert invalid_repair.status_code == 422
    repaired = await client.patch(url, json={"expected_revision": 2, "start": 570})
    assert repaired.status_code == 200
    assert repaired.json()["needs_review"] is False


@pytest.mark.integration
async def test_reparenting_retains_original_room_conflict_and_current_room_conflict(booking_api):
    client, sessions, ids = booking_api
    first = (await create(client, ids)).json()
    new_room_id = f"moved-room-{uuid4()}"
    async with sessions.begin() as session:
        await session.scalar(select(Building).where(Building.id == ids["office"]).with_for_update())
        session.add(
            Resource(
                id=new_room_id,
                floor_id=ids["floor"],
                kind="meeting_room",
                name="Другая комната",
                shared_booking=True,
            )
        )
        await session.flush()
        desk = await session.get(Resource, ids["desk"])
        desk.parent_room_id = new_room_id
        await bookings.review_office_bookings(session, ids["office"])
    assert (await client.get(f"{path(ids)}/{first['id']}")).json()["needs_review"] is True
    assert (await create(client, ids, payload(ids, "room"))).status_code == 409
    assert (
        await create(client, ids, payload(ids, "room", resource_id=new_room_id))
    ).status_code == 409
    assert (await create(client, ids, payload(ids, "sibling"))).status_code == 201


@pytest.mark.integration
async def test_cursor_occupancy_is_separate_from_full_interval_availability(booking_api):
    client, _, ids = booking_api
    assert (await create(client, ids)).status_code == 201
    response = await client.post(
        f"/internal/offices/{ids['office']}/availability",
        json={
            "floor_id": ids["floor"],
            "date": "2026-11-13",
            "start": 570,
            "end": 660,
            "cursor": 630,
        },
    )
    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()["resources"]}
    assert rows[ids["desk"]]["cursor_status"] == "free"
    assert rows[ids["desk"]]["available"] is False
    assert rows[ids["room"]]["available"] is False
    assert rows[ids["sibling"]]["available"] is True
    response = await client.post(
        f"/internal/offices/{ids['office']}/availability",
        json={
            "floor_id": ids["floor"],
            "date": "2026-11-13",
            "start": 540,
            "end": 600,
            "cursor": 570,
        },
    )
    room = next(row for row in response.json()["resources"] if row["id"] == ids["room"])
    assert room["cursor_status"] == "partial"
    assert room["bookable_places"] == 3
    assert room["occupied_places"] == 1


@pytest.mark.integration
async def test_capacity_warning_and_immutable_resource_history_survive_plan_changes(booking_api):
    client, sessions, ids = booking_api
    async with sessions.begin() as session:
        floor = await session.get(Floor, ids["floor"])
        floor.plan_document = {
            "elements": [
                {
                    "id": ids["room"],
                    "seats": 99,
                    "equipment": [
                        {"type": "sofa-2", "quantity": 2},
                        {"type": "chair", "quantity": 1},
                    ],
                }
            ]
        }
    first_response = await create(client, ids, payload(ids, "room", participants=6))
    assert first_response.status_code == 201
    first = first_response.json()
    assert first["resource_snapshot"]["capacity"] == 5
    assert first["warnings"] == [{"code": "capacity_exceeded", "capacity": 5, "participants": 6}]
    async with sessions.begin() as session:
        resource = await session.get(Resource, ids["room"])
        resource.deleted_at = NOW
        resource.name = "Новое название"
        await bookings.review_office_bookings(session, ids["office"])
    current = (await client.get(f"{path(ids)}/{first['id']}")).json()
    assert current["review_reasons"] == ["resource_unavailable"]
    assert current["resource_snapshot"]["name"] == "Комната"
    assert current["start"] == first["start"]
    history = (await client.get(f"{path(ids)}/{first['id']}/history")).json()
    assert [row["operation"] for row in history] == ["created", "review_required"]
    assert history[0]["snapshot"]["needs_review"] is False
    assert history[1]["snapshot"]["needs_review"] is True


@pytest.mark.integration
async def test_repeat_cancellation_returns_same_result_even_with_original_revision(booking_api):
    client, _, ids = booking_api
    first = (await create(client, ids)).json()
    url = f"{path(ids)}/{first['id']}/cancel"
    cancelled = await client.post(url, json={"expected_revision": 1})
    repeated = await client.post(url, json={"expected_revision": 1})
    assert cancelled.status_code == repeated.status_code == 200
    assert cancelled.json() == repeated.json()
    assert cancelled.json()["cancellation_reason"] == "user_cancelled"
    history = (await client.get(f"{path(ids)}/{first['id']}/history")).json()
    assert [row["operation"] for row in history] == ["created", "cancelled"]


@pytest.mark.integration
async def test_started_booking_checks_remaining_interval_after_schedule_change(booking_api):
    client, sessions, ids = booking_api
    first = (await create(client, ids)).json()
    async with sessions.begin() as session:
        row = await session.get(Booking, first["id"])
        row.starts_at = datetime(2026, 11, 12, 8, 0, tzinfo=UTC)
        row.ends_at = row.scheduled_ends_at = datetime(2026, 11, 12, 10, 0, tzinfo=UTC)
        hours = await session.get(WorkingHours, (ids["office"], 3))
        hours.start_time = time(12)
    changed = await client.patch(
        f"{path(ids)}/{first['id']}", json={"expected_revision": 1, "end": 785}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["start"] == 660


@pytest.mark.integration
async def test_whole_room_booking_retains_original_places_when_they_are_reparented(booking_api):
    client, sessions, ids = booking_api
    first = (await create(client, ids, payload(ids, "room"))).json()
    async with sessions.begin() as session:
        place = await session.get(Resource, ids["desk"])
        place.parent_room_id = None
        room = await session.get(Resource, ids["room"])
        room.deleted_at = NOW
        await bookings.review_office_bookings(session, ids["office"])
    current = (await client.get(f"{path(ids)}/{first['id']}")).json()
    assert current["needs_review"] is True
    assert "resource_hierarchy_changed" in current["review_reasons"]
    conflict = await create(client, ids, payload(ids))
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "booking_conflict"


@pytest.mark.integration
@pytest.mark.parametrize("day", ["2026-11-11", "2026-12-30"])
async def test_trusted_administrative_create_can_correct_dates_outside_employee_horizon(
    booking_api, day
):
    client, _, ids = booking_api
    ordinary = await create(client, ids, payload(ids, date=day))
    assert ordinary.status_code == 422
    assert ordinary.json()["detail"]["code"] == "outside_booking_horizon"
    administrative = await create(client, ids, payload(ids, date=day, administrative=True))
    assert administrative.status_code == 201, administrative.text
    conflict = await create(client, ids, payload(ids, "room", date=day, administrative=True))
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "booking_conflict"
    off_grid = await create(
        client, ids, payload(ids, "sibling", date=day, start=541, administrative=True)
    )
    assert off_grid.status_code == 422
    assert off_grid.json()["detail"]["code"] == "invalid_booking_interval"
    outside_hours = await create(
        client, ids, payload(ids, "sibling", date=day, end=1440, administrative=True)
    )
    assert outside_hours.status_code == 422
    assert outside_hours.json()["detail"]["code"] == "outside_working_hours"


@pytest.mark.integration
async def test_administrative_started_edit_retains_physical_conflict_checks(booking_api):
    client, _, ids = booking_api
    current = payload(ids, date="2026-11-12", start=720, end=780)
    ordinary = await create(client, ids, current)
    assert ordinary.status_code == 422
    first_response = await create(client, ids, {**current, "administrative": True})
    assert first_response.status_code == 201
    first = first_response.json()
    url = f"{path(ids)}/{first['id']}"
    denied = await client.patch(url, json={"expected_revision": 1, "resource_id": ids["sibling"]})
    assert denied.status_code == 409
    assert denied.json()["detail"]["code"] == "current_booking_end_only"
    changed = await client.patch(
        url,
        json={
            "expected_revision": 1,
            "resource_id": ids["sibling"],
            "start": 715,
            "administrative": True,
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["resource_id"] == ids["sibling"]
    assert changed.json()["start"] == 715
    other = await create(client, ids, {**current, "administrative": True})
    assert other.status_code == 201
    blocked = await client.patch(
        url,
        json={
            "expected_revision": 2,
            "resource_id": ids["desk"],
            "administrative": True,
        },
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "booking_conflict"
    assert (await client.get(url)).json() == changed.json()
    history = (await client.get(f"{url}/history")).json()
    assert [item["snapshot"]["administrative"] for item in history] == [True, True]


@pytest.mark.integration
async def test_administrative_past_edit_and_cancel_keep_history_without_extending_use(booking_api):
    client, _, ids = booking_api
    first = (await create(client, ids, payload(ids, date="2026-11-11", administrative=True))).json()
    url = f"{path(ids)}/{first['id']}"
    denied = await client.patch(url, json={"expected_revision": 1, "end": 605})
    assert denied.status_code == 409
    assert denied.json()["detail"]["code"] == "booking_completed"
    changed = await client.patch(
        url, json={"expected_revision": 1, "end": 605, "administrative": True}
    )
    assert changed.status_code == 200, changed.text
    denied_cancel = await client.post(f"{url}/cancel", json={"expected_revision": 2})
    assert denied_cancel.status_code == 409
    cancelled = await client.post(
        f"{url}/cancel", json={"expected_revision": 2, "administrative": True}
    )
    assert cancelled.status_code == 200, cancelled.text
    row = cancelled.json()
    assert row["end"] == 605
    assert row["ends_at"] == changed.json()["ends_at"]
    assert row["cancellation_reason"] == "admin_cancelled"
    assert row["owner_id"] == first["owner_id"]
    history = (await client.get(f"{url}/history")).json()
    assert [item["operation"] for item in history] == ["created", "updated", "cancelled"]


@pytest.mark.integration
async def test_administrative_mode_is_strict_and_bound_to_idempotency(booking_api):
    client, _, ids = booking_api
    invalid = await create(client, ids, payload(ids, administrative="true"))
    assert invalid.status_code == 422
    key = str(uuid4())
    first = await create(client, ids, key=key)
    repeated = await create(client, ids, payload(ids, administrative=False), key=key)
    assert first.status_code == 201 and repeated.status_code == 200
    assert repeated.json()["id"] == first.json()["id"]
    changed_mode = await create(client, ids, payload(ids, administrative=True), key=key)
    assert changed_mode.status_code == 409
    assert changed_mode.json()["detail"]["code"] == "idempotency_key_reused"
