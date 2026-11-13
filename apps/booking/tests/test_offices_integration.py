import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select
from workplace_booking.models import Floor, OutboxEvent, Resource, WorkingHours


def floor_document(floor_id: str, room_id: str, desk_id: str):
    def element(identifier, kind, **extra):
        return {
            "id": identifier,
            "kind": kind,
            "type": kind,
            "name": f"Объект {kind}",
            "x": 120,
            "y": 130,
            "width": 300,
            "height": 200,
            "rotation": 0,
            "color": "#abcdef",
            "locked": False,
            **extra,
        }

    return {
        "id": floor_id,
        "name": "Этаж с геометрией",
        "width": 2400,
        "height": 1500,
        "elements": [
            element(
                room_id,
                "room",
                shared=True,
                bookable=True,
                points=[{"x": 0, "y": 0}, {"x": 280, "y": 0}, {"x": 180, "y": 200}],
            ),
            element(desk_id, "desk", roomId=room_id, resourceType="workplace"),
            element(
                f"seat-{uuid4()}",
                "furniture",
                roomId=room_id,
                resourceType="workplace",
                bookable=True,
                type="chair",
            ),
            element(f"wall-{uuid4()}", "wall"),
        ],
        "background": {
            "src": "data:image/png;base64,YQ==",
            "name": "план.png",
            "opacity": 0.4,
            "visible": True,
            "locked": True,
            "x": -12,
            "y": 24,
            "width": 1800,
            "height": 900,
        },
        "extension": {"preserve": [1, 2, 3]},
    }


async def create(client, name="Новый офис"):
    result = await client.post("/internal/offices", json={"name": name, "address": "Лесная, 1"})
    assert result.status_code == 201, result.text
    assert result.json()["revision"] == 1
    return result.json()


@pytest.mark.integration
async def test_plan_and_settings_roundtrip_without_overwriting_each_other(booking_client):
    client, sessions = booking_client
    original = await create(client)
    office_id = original["id"]
    original_floor = original["floors"][0]["plan_document"]
    assert original_floor == {
        "id": original["floors"][0]["id"],
        "name": "1 этаж",
        "width": 1800,
        "height": 1100,
        "elements": [],
    }
    assert original["hours_document"]["sun"] == {
        "enabled": False,
        "start": "09:00",
        "end": "19:00",
    }
    document = floor_document(original_floor["id"], f"room-{uuid4()}", f"desk-{uuid4()}")
    plan = await client.put(
        f"/internal/offices/{office_id}/plan",
        json={
            "floors": [document],
            "expected_revision": original["revision"],
        },
    )
    assert plan.status_code == 200, plan.text
    assert plan.json()["floors"][0]["plan_document"] == document
    hours = deepcopy(original["hours_document"])
    hours["mon"] = {"enabled": True, "start": "11:00", "end": "18:00"}
    hours["sun"] = {"enabled": False, "start": "06:30", "end": "17:45"}
    settings = {
        "name": "Переименованный офис",
        "address": "Новый адрес",
        "hours_document": hours,
        "expected_revision": plan.json()["revision"],
    }
    changed = await client.patch(f"/internal/offices/{office_id}/settings", json=settings)
    assert changed.status_code == 200, changed.text
    assert changed.json()["floors"][0]["plan_document"] == document
    assert changed.json()["updated_at"] != original["updated_at"]
    document["elements"][0]["points"][1]["x"] = 260
    saved = await client.put(
        f"/internal/offices/{office_id}/plan",
        json={
            "floors": [document],
            "expected_revision": changed.json()["revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    fresh = (await client.get(f"/internal/offices/{office_id}")).json()
    assert fresh["name"] == settings["name"]
    assert fresh["address"] == settings["address"]
    assert fresh["hours_document"] == hours
    assert fresh["floors"][0]["plan_document"] == document
    assert fresh["revision"] == 4
    async with sessions() as session:
        events = (
            await session.scalars(
                select(OutboxEvent).where(
                    OutboxEvent.payload["office_id"].astext == office_id,
                )
            )
        ).all()
        assert len(events) == 4
        assert {event.payload["change"] for event in events} == {"created", "settings", "plan"}
        assert {event.payload["revision"] for event in events} == {1, 2, 3, 4}


@pytest.mark.integration
async def test_concurrent_settings_and_plan_save_require_retry_to_merge(booking_client):
    client, _ = booking_client
    original = await create(client)
    office_id = original["id"]
    document = floor_document(original["floors"][0]["id"], f"room-{uuid4()}", f"desk-{uuid4()}")
    settings = {
        "name": "Одновременное изменение",
        "hours_document": original["hours_document"],
        "expected_revision": original["revision"],
    }
    plan = {"floors": [document], "expected_revision": original["revision"]}
    responses = await asyncio.gather(
        client.patch(
            f"/internal/offices/{office_id}/settings",
            json=settings,
        ),
        client.put(f"/internal/offices/{office_id}/plan", json=plan),
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    snapshot = (await client.get(f"/internal/offices/{office_id}")).json()
    assert snapshot["revision"] == 2
    if responses[0].status_code == 409:
        settings["expected_revision"] = snapshot["revision"]
        retry = await client.patch(f"/internal/offices/{office_id}/settings", json=settings)
    else:
        plan["expected_revision"] = snapshot["revision"]
        retry = await client.put(f"/internal/offices/{office_id}/plan", json=plan)
    assert retry.status_code == 200, retry.text
    fresh = (await client.get(f"/internal/offices/{office_id}")).json()
    assert fresh["revision"] == 3
    assert fresh["name"] == "Одновременное изменение"
    assert fresh["floors"][0]["plan_document"] == document


@pytest.mark.integration
async def test_resource_projection_and_soft_deleted_identities(booking_client):
    client, sessions = booking_client
    original = await create(client)
    office_id = original["id"]
    floor_id = original["floors"][0]["id"]
    room_id, desk_id = f"room-{uuid4()}", f"desk-{uuid4()}"
    document = floor_document(floor_id, room_id, desk_id)
    seat_id = document["elements"][2]["id"]
    url = f"/internal/offices/{office_id}/plan"
    saved = await client.put(
        url, json={"floors": [document], "expected_revision": original["revision"]}
    )
    assert saved.status_code == 200, saved.text
    resources_url = f"/internal/buildings/{office_id}/floors/{floor_id}/resources"
    assert {row["id"] for row in (await client.get(resources_url)).json()} == {
        room_id,
        desk_id,
        seat_id,
    }
    document["elements"][0]["shared"] = False
    saved = await client.put(
        url, json={"floors": [document], "expected_revision": saved.json()["revision"]}
    )
    assert saved.status_code == 200, saved.text
    assert [row["id"] for row in (await client.get(resources_url)).json()] == [room_id]
    async with sessions() as session:
        desk = await session.get(Resource, desk_id)
        assert desk is not None and desk.deleted_at is not None
    document["elements"][0]["shared"] = True
    saved = await client.put(
        url, json={"floors": [document], "expected_revision": saved.json()["revision"]}
    )
    assert saved.status_code == 200, saved.text
    async with sessions() as session:
        desk = await session.get(Resource, desk_id)
        assert desk is not None and desk.deleted_at is None
    new_floor = {
        "id": f"floor-{uuid4()}",
        "name": "Другой этаж",
        "width": 1200,
        "height": 900,
        "elements": [],
    }
    saved = await client.put(
        url, json={"floors": [new_floor], "expected_revision": saved.json()["revision"]}
    )
    assert saved.status_code == 200, saved.text
    async with sessions() as session:
        old_floor = await session.get(Floor, floor_id)
        old_desk = await session.get(Resource, desk_id)
        assert old_floor is not None and old_floor.deleted_at is not None
        assert old_desk is not None and old_desk.deleted_at is not None


@pytest.mark.integration
async def test_cross_office_identity_collision_cannot_overwrite_a_plan(booking_client):
    client, _ = booking_client
    first = await create(client, "Первый офис")
    second = await create(client, "Второй офис")
    collision = deepcopy(first["floors"][0]["plan_document"])
    collision["name"] = "Попытка переноса чужого этажа"
    response = await client.put(
        f"/internal/offices/{second['id']}/plan",
        json={"floors": [collision], "expected_revision": second["revision"]},
    )
    assert response.status_code == 409
    assert (await client.get(f"/internal/offices/{first['id']}")).json() == first
    assert (await client.get(f"/internal/offices/{second['id']}")).json() == second


@pytest.mark.integration
async def test_sparse_hours_document_roundtrips_without_inventing_closed_day_values(booking_client):
    client, sessions = booking_client
    original = await create(client)
    office_id = original["id"]
    hours = {
        "mon": {"enabled": True, "start": "10:00", "end": "17:30"},
        "sun": {"enabled": False, "start": "05:00", "end": "13:45"},
    }
    response = await client.patch(
        f"/internal/offices/{office_id}/settings",
        json={
            "name": original["name"],
            "hours_document": hours,
            "expected_revision": original["revision"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["hours_document"] == hours
    assert response.json()["address"] is None
    fresh = await client.get(f"/internal/offices/{office_id}")
    assert fresh.json()["hours_document"] == hours
    async with sessions() as session:
        rows = (
            await session.scalars(
                select(WorkingHours).where(
                    WorkingHours.building_id == office_id,
                )
            )
        ).all()
        assert [row.weekday for row in rows] == [0]
    unknown = await client.patch(
        f"/internal/offices/{office_id}/settings",
        json={
            "name": original["name"],
            "hours_document": {"holiday": hours["mon"]},
            "expected_revision": response.json()["revision"],
        },
    )
    assert unknown.status_code == 422
    assert (await client.get(f"/internal/offices/{office_id}")).json()["hours_document"] == hours
