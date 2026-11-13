import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from workplace_booking.models import Building, Floor, OfficeImportReceipt, OutboxEvent, Resource


def legacy_document():
    suffix = str(uuid4())
    return {
        "version": 1,
        "id": f"legacy-office-{suffix}",
        "name": "Локальный офис",
        "address": "Лесная, 1",
        "updatedAt": "2026-11-12T08:30:00.000Z",
        "hours": {"mon": {"enabled": True, "start": "09:00", "end": "19:00"}},
        "floors": [
            {
                "id": f"legacy-floor-{suffix}",
                "name": "Этаж из браузера",
                "width": 1800,
                "height": 1100,
                "elements": [
                    {
                        "id": f"legacy-room-{suffix}",
                        "kind": "room",
                        "name": "Переговорная",
                        "bookable": True,
                        "shared": True,
                        "x": 10,
                        "y": 20,
                        "width": 500,
                        "height": 400,
                        "rotation": 0,
                    },
                    {
                        "id": f"legacy-desk-{suffix}",
                        "kind": "desk",
                        "name": "Стол",
                        "roomId": f"legacy-room-{suffix}",
                        "x": 30,
                        "y": 40,
                        "width": 120,
                        "height": 70,
                        "rotation": 0,
                    },
                ],
                "background": {"src": "data:image/png;base64,YQ==", "opacity": 0.5},
                "extension": {"kept": True},
            }
        ],
    }


def import_headers(actor=None, key=None):
    return {"X-User-ID": actor or str(uuid4()), "Idempotency-Key": key or str(uuid4())}


async def create_office(client):
    response = await client.post("/internal/offices", json={"name": "Новый офис"})
    assert response.status_code == 201, response.text
    assert response.json()["revision"] == 1
    return response.json()


@pytest.mark.integration
async def test_stale_office_revision_rejects_write_without_changing_plan_or_events(booking_client):
    client, sessions = booking_client
    original = await create_office(client)
    office_id = original["id"]
    saved = await client.patch(
        f"/internal/offices/{office_id}/settings",
        json={
            "name": "Переименовали",
            "hours_document": original["hours_document"],
            "expected_revision": original["revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    stale = await client.put(
        f"/internal/offices/{office_id}/plan",
        json={
            "floors": [original["floors"][0]["plan_document"]],
            "expected_revision": 1,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == {
        "code": "office_revision_conflict",
        "current_revision": 2,
    }
    assert (await client.get(f"/internal/offices/{office_id}")).json() == saved.json()
    async with sessions() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(
                OutboxEvent.payload["office_id"].astext == office_id,
            )
        )
        assert count == 2


@pytest.mark.integration
async def test_concurrent_plan_and_settings_use_one_office_revision(booking_client):
    client, _ = booking_client
    original = await create_office(client)
    office_id = original["id"]
    floor = deepcopy(original["floors"][0]["plan_document"])
    floor["name"] = "Новый план"
    settings = {
        "name": "Новые настройки",
        "hours_document": original["hours_document"],
        "expected_revision": 1,
    }
    plan = {"floors": [floor], "expected_revision": 1}
    responses = await asyncio.gather(
        client.patch(f"/internal/offices/{office_id}/settings", json=settings),
        client.put(f"/internal/offices/{office_id}/plan", json=plan),
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    snapshot = (await client.get(f"/internal/offices/{office_id}")).json()
    assert snapshot["revision"] == 2
    if responses[0].status_code == 409:
        settings["expected_revision"] = 2
        retried = await client.patch(f"/internal/offices/{office_id}/settings", json=settings)
    else:
        plan["expected_revision"] = 2
        retried = await client.put(f"/internal/offices/{office_id}/plan", json=plan)
    assert retried.status_code == 200, retried.text
    assert retried.json()["revision"] == 3
    assert retried.json()["name"] == "Новые настройки"
    assert retried.json()["floors"][0]["plan_document"] == floor


@pytest.mark.integration
async def test_concurrent_import_retries_preserve_ids_and_create_one_receipt(booking_client):
    client, sessions = booking_client
    document = legacy_document()
    headers = import_headers()
    responses = await asyncio.gather(
        *[
            client.post("/internal/offices/import", headers=headers, json={"document": document})
            for _ in range(2)
        ]
    )
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    imported = responses[0].json()
    assert imported["id"] == document["id"]
    assert imported["revision"] == 1
    assert imported["hours_document"] == document["hours"]
    assert imported["floors"][0]["plan_document"] == document["floors"][0]
    async with sessions() as session:
        floor = await session.get(Floor, document["floors"][0]["id"])
        assert floor.building_id == document["id"]
        for element in document["floors"][0]["elements"]:
            assert await session.get(Resource, element["id"]) is not None
        assert (
            await session.scalar(
                select(func.count())
                .select_from(OfficeImportReceipt)
                .where(
                    OfficeImportReceipt.actor_id == headers["X-User-ID"],
                    OfficeImportReceipt.key == headers["Idempotency-Key"],
                )
            )
            == 1
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(OutboxEvent)
                .where(
                    OutboxEvent.payload["office_id"].astext == document["id"],
                )
            )
            == 1
        )


@pytest.mark.integration
async def test_import_retry_returns_current_office_and_never_overwrites_newer_settings(
    booking_client,
):
    client, _ = booking_client
    document = legacy_document()
    headers = import_headers()
    first = await client.post(
        "/internal/offices/import", headers=headers, json={"document": document}
    )
    assert first.status_code == 200, first.text
    saved = await client.patch(
        f"/internal/offices/{document['id']}/settings",
        json={
            "name": "Серверное изменение",
            "hours_document": document["hours"],
            "expected_revision": 1,
        },
    )
    assert saved.status_code == 200, saved.text
    retry = await client.post(
        "/internal/offices/import", headers=headers, json={"document": document}
    )
    assert retry.status_code == 200
    assert retry.json() == saved.json()
    other_key = await client.post(
        "/internal/offices/import",
        headers=import_headers(actor=headers["X-User-ID"]),
        json={"document": document},
    )
    assert other_key.status_code == 409
    assert other_key.json()["detail"]["code"] == "office_import_conflict"
    assert (await client.get(f"/internal/offices/{document['id']}")).json() == saved.json()


@pytest.mark.integration
async def test_import_key_is_bound_to_actor_and_exact_request(booking_client):
    client, _ = booking_client
    document = legacy_document()
    headers = import_headers()
    result = await client.post(
        "/internal/offices/import", headers=headers, json={"document": document}
    )
    assert result.status_code == 200, result.text
    different = deepcopy(document)
    different["name"] = "Другое имя"
    conflict = await client.post(
        "/internal/offices/import",
        headers=headers,
        json={"document": different},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_key_conflict"
    independent = await client.post(
        "/internal/offices/import",
        headers=import_headers(key=headers["Idempotency-Key"]),
        json={"document": document},
    )
    assert independent.status_code == 200
    assert independent.json() == result.json()


@pytest.mark.integration
@pytest.mark.parametrize("collision", ["floor", "element", "office_as_floor"])
async def test_import_identity_collisions_roll_back_everything(booking_client, collision):
    client, sessions = booking_client
    original = legacy_document()
    imported = await client.post(
        "/internal/offices/import",
        headers=import_headers(),
        json={"document": original},
    )
    assert imported.status_code == 200, imported.text
    incoming = legacy_document()
    if collision == "floor":
        incoming["floors"][0]["id"] = original["floors"][0]["id"]
    elif collision == "element":
        incoming["floors"][0]["elements"][1]["id"] = original["floors"][0]["elements"][1]["id"]
    else:
        incoming["id"] = original["floors"][0]["id"]
    response = await client.post(
        "/internal/offices/import",
        headers=import_headers(),
        json={"document": incoming},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "office_identifier_conflict"
    assert (await client.get(f"/internal/offices/{original['id']}")).json() == imported.json()
    async with sessions() as session:
        assert await session.get(Building, incoming["id"]) is None


@pytest.mark.integration
async def test_import_requires_key_actor_and_settings_require_revision(booking_client):
    client, _ = booking_client
    document = legacy_document()
    missing_key = await client.post(
        "/internal/offices/import",
        headers={"X-User-ID": str(uuid4())},
        json={"document": document},
    )
    assert missing_key.status_code == 422
    missing_actor = await client.post(
        "/internal/offices/import",
        headers={"Idempotency-Key": str(uuid4())},
        json={"document": document},
    )
    assert missing_actor.status_code == 422
    office = await create_office(client)
    missing_revision = await client.patch(
        f"/internal/offices/{office['id']}/settings",
        json={
            "name": "Без версии",
            "hours_document": office["hours_document"],
        },
    )
    assert missing_revision.status_code == 422
