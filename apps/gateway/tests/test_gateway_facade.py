import json
from functools import partial
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import HTTPException
from workplace_platform.jwt_tokens import decode_access

from apps.gateway.tests.test_gateway import gateway as gateway


def plan_element(identifier, kind, **changes):
    return {
        "id": identifier,
        "kind": kind,
        "type": kind,
        "name": identifier,
        "x": 100,
        "y": 100,
        "width": 80,
        "height": 60,
        "rotation": 0,
        "color": "#ffffff",
        "locked": False,
        **changes,
    }


@pytest.fixture
def facade_gateway(gateway):
    client, calls, state, token = gateway
    office = state["offices"][0]
    office["revision"] = 7
    floor = office["floors"][0]["plan_document"]
    floor["background"] = {
        "src": "data:image/png;base64,cHJpdmF0ZQ==",
        "name": "Подложка",
        "opacity": 0.4,
        "visible": True,
        "locked": True,
    }
    floor["vendor_data"] = {"private_extension": "not-for-llm"}
    floor["elements"] = [
        plan_element("room-1", "room", shared=True, resourceType="meeting_room"),
        plan_element(
            "desk-1",
            "desk",
            roomId="room-1",
            resourceType="workplace",
            vendor_data={"private_extension": "not-for-llm"},
            equipment=[
                {
                    "type": "monitor",
                    "quantity": 1,
                    "private_raster": "data:image/png;base64,private",
                }
            ],
            points=[{"x": 1, "y": 2, "private_raster": "data:image/png;base64,private"}],
        ),
    ]
    state["resources"] = [
        {
            "id": "desk-1",
            "floor_id": "floor-own",
            "kind": "workstation",
            "name": "Стол у окна",
            "parent_room_id": "room-1",
            "capacity": 1,
            "equipment": [
                {
                    "type": "monitor",
                    "quantity": 1,
                    "private_raster": "data:image/png;base64,private",
                }
            ],
        },
        {
            "id": "room-1",
            "floor_id": "floor-own",
            "kind": "meeting_room",
            "name": "Переговорная",
            "parent_room_id": None,
            "capacity": 4,
        },
    ]
    state["facade_calls"] = []
    previous = client.app.state.http_client

    async def upstream(request):
        state["facade_calls"].append(request)
        if request.url.path.startswith("/internal/buildings/office-own/floors/"):
            floor_id = request.url.path.split("/")[-2]
            return httpx.Response(
                200, json=[row for row in state["resources"] if row["floor_id"] == floor_id]
            )
        if request.url.path == "/internal/offices/office-own/availability":
            state["availability_payload"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "revision": state.get("availability_revision", 7),
                    "resources": [{**record, "available": False} for record in state["resources"]],
                },
            )
        return await previous.request(
            request.method,
            request.url,
            headers=request.headers,
            content=request.content,
        )

    replacement = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    client.app.state.http_client = replacement
    current = decode_access(token(), client.app.state.settings)
    try:
        yield client, calls, state, token, current
    finally:
        client.portal.call(replacement.aclose)
        client.app.state.http_client = previous


def test_partial_availability_does_not_claim_that_a_resource_is_free(facade_gateway):
    client, _, state, token, _ = facade_gateway
    response = client.get(
        "/api/offices/office-own/availability?start=600&kind=workstation",
        headers={"Authorization": "Bearer " + token()},
    )
    assert response.status_code == 200, response.text
    assert response.json()["intervalComplete"] is False
    assert len(response.json()["resources"]) == 1
    assert response.json()["resources"][0]["available"] is None
    assert all(request.method == "GET" for request in state["facade_calls"])


def test_complete_availability_uses_business_service_result_and_warns_capacity(facade_gateway):
    client, _, state, token, _ = facade_gateway
    response = client.get(
        "/api/offices/office-own/availability?date=2026-11-12&start=600&end=660&participants=8",
        headers={"Authorization": "Bearer " + token()},
    )
    assert response.status_code == 200, response.text
    assert response.json()["intervalComplete"] is True
    assert all(row["available"] is False for row in response.json()["resources"])
    room = next(row for row in response.json()["resources"] if row["kind"] == "meeting_room")
    assert room["warnings"] == [{"code": "capacity_exceeded", "capacity": 4, "participants": 8}]
    assert state["availability_payload"] == {
        "floor_id": "floor-own",
        "date": "2026-11-12",
        "start": 600,
        "end": 660,
    }


def test_availability_does_not_merge_mismatched_catalog_revisions(facade_gateway):
    client, _, state, token, _ = facade_gateway
    state["availability_revision"] = 8
    response = client.get(
        "/api/offices/office-own/availability?date=2026-11-12&start=600&end=660",
        headers={"Authorization": "Bearer " + token()},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "office_revision_conflict"


def test_prepare_url_uses_public_origin_and_clears_past_date_only(facade_gateway):
    client, _, _, _, current = facade_gateway
    result = client.portal.call(
        partial(
            client.app.state.employee_facade["prepare_booking"],
            current,
            office_id="office-own",
            resource_id="desk-1",
            date="2026-11-11",
            start=600,
            end=660,
        )
    )
    assert result["url"].startswith(client.app.state.settings.public_base_url + "/booking?")
    params = parse_qs(urlsplit(result["url"]).query)
    assert params == {
        "officeId": ["office-own"],
        "floorId": ["floor-own"],
        "resourceId": ["desk-1"],
        "start": ["600"],
        "end": ["660"],
    }
    assert result["proposal"] == {
        "officeId": "office-own",
        "floorId": "floor-own",
        "resourceId": "desk-1",
        "start": 600,
        "end": 660,
    }
    assert "token" not in result["url"]


def test_mcp_catalog_projection_omits_images_and_opaque_extensions(facade_gateway):
    client, _, _, _, current = facade_gateway
    value = client.portal.call(
        partial(
            client.app.state.employee_facade["get_office"],
            current,
            office_id="office-own",
        )
    )
    serialized = json.dumps(value, ensure_ascii=False)
    assert "data:image" not in serialized
    assert "not-for-llm" not in serialized
    assert "vendor_data" not in serialized
    assert value["floors"][0]["elements"][1]["roomId"] == "room-1"
    assert value["resources"][0]["id"] == "desk-1"
    assert value["resources"][0]["equipment"] == [{"type": "monitor", "quantity": 1}]
    assert value["floors"][0]["elements"][1]["points"] == [{"x": 1, "y": 2}]


def test_availability_resource_filter_queries_only_its_actual_floor(facade_gateway):
    client, _, state, token, _ = facade_gateway
    state["offices"][0]["floors"].append(
        {
            "id": "floor-other",
            "name": "Другой этаж",
            "position": 1,
            "plan_document": {
                "id": "floor-other",
                "name": "Другой этаж",
                "width": 1000,
                "height": 1000,
                "elements": [],
            },
        }
    )
    response = client.get(
        "/api/offices/office-own/availability?date=2026-11-12&start=600&end=660&resourceId=desk-1",
        headers={"Authorization": "Bearer " + token()},
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["resources"]] == ["desk-1"]
    reads = [
        request for request in state["facade_calls"] if request.url.path.endswith("/availability")
    ]
    assert len(reads) == 1 and json.loads(reads[0].content)["floor_id"] == "floor-own"


def test_facade_rejects_hidden_office_before_reading_its_facts(facade_gateway):
    client, calls, state, _, current = facade_gateway
    calls.clear()
    state["facade_calls"].clear()
    with pytest.raises(HTTPException) as raised:
        client.portal.call(
            partial(
                client.app.state.employee_facade["get_office"],
                current,
                office_id="office-hidden",
            )
        )
    assert raised.value.status_code == 404
    assert calls == [] and state["facade_calls"] == []
