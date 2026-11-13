import json
import time
from copy import deepcopy
from urllib.parse import urlsplit

import httpx
import mcp_types
import pytest

from apps.gateway.tests.test_gateway import USER
from apps.gateway.tests.test_gateway import gateway as gateway

OWNER_ID = "00000000-0000-4000-8000-000000000002"


@pytest.fixture
def booking_gateway(gateway):
    client, calls, state, token = gateway
    state["booking_calls"] = []
    other = {
        **USER,
        "id": OWNER_ID,
        "login": "peter",
        "first_name": "Пётр",
        "last_name": "Сидоров",
        "role": "employee",
    }
    state["bookings"] = {
        "booking-own": {
            "id": "booking-own",
            "building_id": "office-own",
            "floor_id": "floor-own",
            "resource_id": "desk-own",
            "owner_id": USER["id"],
            "date": "2026-11-15",
            "start": 600,
            "end": 660,
            "participants": None,
            "status": "active",
            "revision": 1,
            "needs_review": False,
            "review_reasons": ["working_hours_changed"],
            "resource_snapshot": {"id": "desk-own", "name": "Название на момент бронирования"},
            "warnings": [],
        },
    }
    state["bookings"]["booking-other"] = {
        **state["bookings"]["booking-own"],
        "id": "booking-other",
        "owner_id": OWNER_ID,
    }
    previous = client.app.state.http_client

    async def upstream(request):
        path = request.url.path
        if path == "/internal/mcp/introspect":
            body = json.loads(request.content)
            if body["token"] != "mcp-admin":
                return httpx.Response(401)
            return httpx.Response(
                200,
                json={
                    "user": {**USER, "role": "admin"},
                    "session_id": "mcp-session",
                    "client_id": "test-agent",
                    "scopes": ["booking"],
                    "expires_at": int(time.time()) + 600,
                    "resource": body["resource"],
                },
            )
        if path == "/internal/users/lookup":
            return httpx.Response(200, json=[other])
        if path == f"/internal/users/{OWNER_ID}":
            return httpx.Response(200, json=other)
        prefix = "/internal/offices/office-own/bookings"
        if path == prefix:
            state["booking_calls"].append(request)
            if request.method == "GET":
                return httpx.Response(200, json=list(state["bookings"].values()))
            payload = json.loads(request.content)
            state["last_booking_payload"] = payload
            record = {
                **state["bookings"]["booking-own"],
                **payload,
                "id": "booking-created",
            }
            state["bookings"][record["id"]] = record
            return httpx.Response(201, json=record)
        if path.startswith(prefix + "/"):
            state["booking_calls"].append(request)
            suffix = path[len(prefix) + 1 :]
            booking_id = suffix.removesuffix("/cancel")
            record = state["bookings"].get(booking_id)
            if record is None:
                return httpx.Response(404, json={"detail": {"code": "booking_not_found"}})
            if request.method == "GET":
                return httpx.Response(200, json=record)
            payload = json.loads(request.content)
            state["last_booking_payload"] = payload
            if payload.get("expected_revision") != record["revision"]:
                return httpx.Response(409, json={"detail": {"code": "booking_revision_conflict"}})
            if suffix.endswith("/cancel"):
                record["status"] = "cancelled"
            else:
                record.update(
                    {key: value for key, value in payload.items() if key != "expected_revision"}
                )
            record["revision"] += 1
            return httpx.Response(200, json=record)
        return await previous.request(
            request.method,
            request.url,
            headers=request.headers,
            content=request.content,
        )

    replacement = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    client.app.state.http_client = replacement
    try:
        yield client, state, token
    finally:
        client.portal.call(replacement.aclose)
        client.app.state.http_client = previous


def test_employee_cannot_assign_another_owner_or_modify_another_booking(booking_gateway):
    client, state, token = booking_gateway
    headers = {"Authorization": "Bearer " + token(), "Idempotency-Key": "create-1"}
    payload = {
        "floorId": "floor-own",
        "resourceId": "desk-own",
        "date": "2026-11-15",
        "start": 600,
        "end": 660,
        "ownerId": OWNER_ID,
    }
    response = client.post("/api/offices/office-own/bookings", headers=headers, json=payload)
    assert response.status_code == 403 and response.json()["code"] == "booking_owner_required"
    assert state["booking_calls"] == []
    response = client.patch(
        "/api/offices/office-own/bookings/booking-other",
        headers=headers,
        json={"end": 720, "revision": 1},
    )
    assert response.status_code == 403 and response.json()["code"] == "booking_owner_required"
    assert [request.method for request in state["booking_calls"]] == ["GET"]


def test_employee_creation_uses_context_owner_and_returns_frontend_dto(booking_gateway):
    client, state, token = booking_gateway
    headers = {"Authorization": "Bearer " + token(), "Idempotency-Key": "create-2"}
    response = client.post(
        "/api/offices/office-own/bookings",
        headers=headers,
        json={
            "floorId": "floor-own",
            "resourceId": "desk-own",
            "date": "2026-11-15",
            "start": 600,
            "end": 660,
        },
    )
    assert response.status_code == 201, response.text
    assert state["last_booking_payload"]["owner_id"] == USER["id"]
    assert response.json()["ownerName"] == "Иван Петров"
    assert response.json()["reviewReasons"] == ["working_hours_changed"]
    assert response.json()["resourceSnapshot"]["name"] == "Название на момент бронирования"
    assert response.json()["warnings"] == []
    assert response.json()["buildingId"] == "office-own"
    assert response.headers["etag"] == '"1"'


def test_admin_http_can_change_another_booking_and_revision_is_forwarded(booking_gateway):
    client, state, token = booking_gateway
    response = client.patch(
        "/api/offices/office-own/bookings/booking-other",
        headers={"Authorization": "Bearer " + token("admin"), "If-Match": '"1"'},
        json={"end": 720},
    )
    assert response.status_code == 200, response.text
    assert state["last_booking_payload"] == {
        "end": 720,
        "expected_revision": 1,
        "administrative": True,
    }
    assert response.json()["revision"] == 2
    assert response.json()["ownerName"] == "Пётр Сидоров"
    assert response.headers["etag"] == '"2"'


def test_stale_revision_does_not_mutate_the_booking(booking_gateway):
    client, state, token = booking_gateway
    before = deepcopy(state["bookings"]["booking-own"])
    response = client.patch(
        "/api/offices/office-own/bookings/booking-own",
        headers={"Authorization": "Bearer " + token()},
        json={"end": 720, "revision": 5},
    )
    assert response.status_code == 409
    assert state["bookings"]["booking-own"] == before


def test_missing_revision_and_hidden_building_fail_before_business_write(booking_gateway):
    client, state, token = booking_gateway
    headers = {"Authorization": "Bearer " + token()}
    assert (
        client.post(
            "/api/offices/office-own/bookings/booking-own/cancel",
            headers=headers,
        ).status_code
        == 428
    )
    assert client.get("/api/offices/office-hidden/bookings", headers=headers).status_code == 404
    assert state["booking_calls"] == []


@pytest.mark.parametrize("field,value", [("revision", "invalid"), ("owner_id", None)])
def test_malformed_upstream_booking_is_reported_as_a_gateway_contract_error(
    booking_gateway, field, value
):
    client, state, token = booking_gateway
    state["bookings"]["booking-own"][field] = value

    response = client.get(
        "/api/offices/office-own/bookings", headers={"Authorization": "Bearer " + token()}
    )

    assert response.status_code == 502
    assert response.json()["code"] == "upstream_contract_invalid"
    assert "owner_id" not in response.text


@pytest.mark.parametrize("tool", ["update_booking", "cancel_booking"])
def test_mcp_admin_still_cannot_mutate_another_users_booking(booking_gateway, tool):
    client, state, _ = booking_gateway
    params = {
        "name": tool,
        "arguments": {"office_id": "office-own", "booking_id": "booking-other", "revision": 1},
        "_meta": {
            "io.modelcontextprotocol/protocolVersion": mcp_types.LATEST_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
        },
    }
    response = client.post(
        "/mcp",
        headers={
            "Authorization": "Bearer mcp-admin",
            "Host": urlsplit(str(client.app.state.settings.public_base_url)).netloc,
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": mcp_types.LATEST_PROTOCOL_VERSION,
            "MCP-Method": "tools/call",
            "MCP-Name": tool,
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params},
    )
    assert response.status_code == 200, response.text
    assert response.json()["result"]["isError"] is True
    assert all(request.method == "GET" for request in state["booking_calls"])
    assert state["bookings"]["booking-other"]["revision"] == 1


def test_mcp_administrator_can_update_their_own_record(booking_gateway):
    client, state, _ = booking_gateway
    tool = "update_booking"
    response = client.post(
        "/mcp",
        headers={
            "Authorization": "Bearer mcp-admin",
            "Host": urlsplit(str(client.app.state.settings.public_base_url)).netloc,
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": mcp_types.LATEST_PROTOCOL_VERSION,
            "MCP-Method": "tools/call",
            "MCP-Name": tool,
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool,
                "arguments": {
                    "office_id": "office-own",
                    "booking_id": "booking-own",
                    "revision": 1,
                    "end": 720,
                },
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": mcp_types.LATEST_PROTOCOL_VERSION,
                    "io.modelcontextprotocol/clientCapabilities": {},
                },
            },
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["result"].get("isError", False) is False, response.text
    assert state["bookings"]["booking-own"]["end"] == 720
    assert state["bookings"]["booking-own"]["revision"] == 2
