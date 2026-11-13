import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from workplace_gateway.config import GatewaySettings
from workplace_gateway.main import create_gateway
from workplace_platform.jwt_tokens import issue_access

KEY = "test-internal-key-with-enough-entropy"
JWT_KEY = "test-web-signing-key-with-at-least-32-characters"
USER = {
    "id": "user-1",
    "login": "ivan",
    "first_name": "Иван",
    "last_name": "Петров",
    "role": "employee",
    "active": True,
    "building_ids": ["office-own"],
    "created_at": "2026-11-12T12:00:00Z",
}
FLOOR = {
    "id": "floor-own",
    "name": "Этаж",
    "width": 1800,
    "height": 1100,
    "elements": [],
    "vendor_data": {"snake_key": None},
}
OFFICE = {
    "id": "office-own",
    "revision": 1,
    "name": "Наш офис",
    "address": None,
    "updated_at": "2026-11-12T12:00:00Z",
    "hours_document": {"mon": {"enabled": True, "start": "09:00", "end": "19:00"}},
    "floors": [{"id": FLOOR["id"], "name": FLOOR["name"], "position": 0, "plan_document": FLOOR}],
}
POLICY = {
    "timezone": "Europe/Moscow",
    "step_minutes": 5,
    "horizon_days": 7,
    "server_now": "2026-11-12T12:00:00+03:00",
    "earliest_start": "2026-11-12T12:00:00+03:00",
    "allowed_dates": ["2026-11-12"],
}


@pytest.fixture
def gateway():
    settings = GatewaySettings(internal_api_key=KEY, web_jwt_secret=JWT_KEY, cookie_secure=False)
    app = create_gateway(settings)
    calls = []
    state = {"offices": [deepcopy(OFFICE)], "last_payload": None, "users_offline": False}

    def token(role="employee", **changes):
        user = {**USER, "role": role, **changes}
        return issue_access(user, "session-1", datetime.now(UTC) + timedelta(days=30), settings)[0]

    def upstream(request):
        calls.append(request)
        assert request.headers["x-internal-key"] == KEY
        if state["users_offline"] and request.url.host == "users":
            raise httpx.ConnectError("offline", request=request)
        path = request.url.path
        if path in {"/internal/auth/login", "/internal/auth/refresh"}:
            access, deadline = issue_access(USER, "session-1", None, settings)
            return httpx.Response(
                200,
                json={
                    "token": "opaque-refresh",
                    "user": USER,
                    "expires_at": None,
                    "access_token": access,
                    "access_expires_at": deadline.isoformat(),
                },
            )
        if path == "/internal/auth/introspect":
            pytest.fail("Gateway must verify its short JWT locally")
        if path == "/internal/users":
            if request.method == "GET":
                return httpx.Response(200, json=[USER])
            state["last_payload"] = json.loads(request.content)
            return httpx.Response(
                201,
                json={
                    **USER,
                    **{k: v for k, v in state["last_payload"].items() if k != "password"},
                },
            )
        if path in {
            "/internal/auth/password",
            "/internal/users/user-1/password",
            "/internal/auth/logout",
        }:
            state["last_payload"] = json.loads(request.content)
            return httpx.Response(204)
        if path == "/internal/users/user-1":
            state["last_payload"] = json.loads(request.content)
            return httpx.Response(200, json={**USER, **state["last_payload"]})
        if path == "/internal/policy":
            return httpx.Response(200, json=POLICY)
        if path == "/internal/offices":
            return httpx.Response(200, json=state["offices"])
        if path.startswith("/internal/offices/office-own"):
            if request.method == "PUT":
                state["last_payload"] = json.loads(request.content)
                state["offices"][0]["floors"][0]["plan_document"] = state["last_payload"]["floors"][
                    0
                ]
            return httpx.Response(200, json=state["offices"][0])
        if request.url.host == "assistant":
            raise httpx.ConnectError("AI is offline", request=request)
        return httpx.Response(404, json={"detail": {"code": "not_found"}})

    with TestClient(app) as client:
        app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        yield client, calls, state, token


def test_login_returns_existing_frontend_snapshot_shape_and_private_cookies(gateway):
    client, _, _, _ = gateway
    response = client.post("/api/auth/login", json={"login": "ivan", "password": "secret"})
    assert response.status_code == 200
    assert set(response.json()) == {"user", "users", "expiresAt"}
    user = response.json()["user"]
    assert user["firstName"] == "Иван" and user["buildingIds"] == ["office-own"]
    assert "first_name" not in user and response.json()["expiresAt"] is None
    assert "opaque-refresh" not in response.text and "access_token" not in response.text
    cookies = response.headers.get_list("set-cookie")
    assert len(cookies) == 2 and all("HttpOnly" in cookie for cookie in cookies)
    assert any("Path=/api/auth" in cookie for cookie in cookies)


def test_administrator_permissions_are_enforced_before_users_call(gateway):
    client, calls, _, token = gateway
    response = client.get("/api/users", headers={"Authorization": f"Bearer {token()}"})
    assert response.status_code == 403 and response.json()["code"] == "administrator_required"
    assert calls == []


def test_public_service_and_identity_headers_do_not_authorize(gateway):
    client, calls, _, _ = gateway
    assert (
        client.get(
            "/api/offices",
            headers={"X-Internal-Key": KEY, "X-User-ID": "admin", "X-Session-Token": "spoofed"},
        ).status_code
        == 401
    )
    assert calls == []


def test_valid_web_jwt_keeps_catalog_working_while_users_and_ai_are_offline(gateway):
    client, calls, state, token = gateway
    state["users_offline"] = True
    headers = {"Authorization": f"Bearer {token()}"}
    assert client.get("/api/assistant/capabilities", headers=headers).status_code == 503
    assert client.get("/api/booking/policy", headers=headers).json()["stepMinutes"] == 5
    assert client.get("/api/auth/me", headers=headers).json()["firstName"] == "Иван"
    assert client.get("/api/offices", headers=headers).status_code == 200
    assert all(request.url.host != "users" for request in calls)


def test_offices_filter_and_explicit_document_mapping_preserve_plan_keys(gateway):
    client, calls, state, token = gateway
    state["offices"].append({"id": "hidden-office", "floors": None})
    headers = {"Authorization": f"Bearer {token()}"}
    response = client.get("/api/offices", headers=headers)
    assert response.status_code == 200 and len(response.json()) == 1
    office = response.json()[0]
    assert office["version"] == 1 and "updatedAt" in office
    assert office["floors"][0] == FLOOR
    calls.clear()
    assert client.get("/api/offices/hidden-office", headers=headers).status_code == 404
    assert calls == []


def test_plan_save_preserves_opaque_extensions_and_rejects_office_id_collision(gateway):
    client, _, state, token = gateway
    headers = {"Authorization": f"Bearer {token('admin')}"}
    floor = {**FLOOR, "vendorNull": None}
    response = client.put(
        "/api/offices/office-own/plan", headers=headers, json={"floors": [floor], "revision": 1}
    )
    assert response.status_code == 200
    assert state["last_payload"] == {"floors": [floor], "expected_revision": 1}
    assert response.json()["floors"][0] == floor
    assert (
        client.put(
            "/api/offices/office-own/plan",
            headers=headers,
            json={"floors": [{**floor, "id": "office-own"}], "revision": 1},
        ).status_code
        == 422
    )


def test_user_command_translates_camel_case_and_password_form(gateway):
    client, _, state, token = gateway
    headers = {"Authorization": f"Bearer {token('admin')}"}
    payload = {
        "login": "new-user",
        "firstName": "Анна",
        "lastName": "Сидорова",
        "role": "employee",
        "buildingIds": ["office-own"],
        "password": "private-password",
    }
    response = client.post("/api/users", headers=headers, json=payload)
    assert response.status_code == 201 and response.json()["firstName"] == "Анна"
    assert (
        state["last_payload"]["first_name"] == "Анна" and "firstName" not in state["last_payload"]
    )
    assert "private-password" not in response.text
    assert (
        client.post(
            "/api/auth/password",
            headers=headers,
            json={"current": "old-password", "password": "new-password"},
        ).status_code
        == 204
    )
    assert state["last_payload"] == {"current_password": "old-password", "password": "new-password"}


def test_validation_uses_frontend_fields_and_never_echoes_password(gateway):
    client, _, _, token = gateway
    response = client.post(
        "/api/users",
        headers={"Authorization": f"Bearer {token('admin')}"},
        json={"first_name": "Ivan", "password": "private-password"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert any(item["field"] == "firstName" for item in response.json()["fields"])
    assert "private-password" not in response.text


def test_cookie_writes_require_origin_and_refresh_checks_it_too(gateway):
    client, calls, _, token = gateway
    client.cookies.set("workplace_access", token())
    client.cookies.set("workplace_refresh", "opaque-refresh")
    assert client.post("/api/auth/refresh").status_code == 403
    assert (
        client.post("/api/auth/refresh", headers={"Origin": "https://foreign.example"}).status_code
        == 403
    )
    assert calls == []
    assert (
        client.post("/api/auth/refresh", headers={"Origin": "http://localhost:5178"}).status_code
        == 200
    )


@pytest.mark.parametrize("change", ["expired", "wrong-audience", "bad-signature"])
def test_invalid_web_token_is_rejected_locally(gateway, change):
    client, calls, _, token = gateway
    encoded = token()
    claims = jwt.decode(encoded, options={"verify_signature": False})
    if change == "expired":
        claims["exp"] = int(datetime.now(UTC).timestamp()) - 1
    if change == "wrong-audience":
        claims["aud"] = "workplace-mcp"
    encoded = jwt.encode(
        claims,
        "wrong-key-with-32-characters-or-more" if change == "bad-signature" else JWT_KEY,
        algorithm="HS256",
    )
    response = client.get("/api/offices", headers={"Authorization": f"Bearer {encoded}"})
    assert response.status_code == 401 and calls == []


def test_bootstrap_assembles_frontend_data_without_ai(gateway):
    client, calls, _, token = gateway
    response = client.get("/api/bootstrap", headers={"Authorization": f"Bearer {token()}"})
    assert response.status_code == 200
    assert set(response.json()) == {"auth", "offices", "policy"}
    assert response.json()["offices"][0]["id"] == "office-own"
    assert all(request.url.host != "assistant" for request in calls)


def test_public_docs_live_under_same_api_prefix(gateway):
    client, _, _, _ = gateway
    response = client.get("/api/docs")
    assert response.status_code == 200 and "/api/openapi.json" in response.text
    schema = client.get("/api/openapi.json").json()
    assert "firstName" in schema["components"]["schemas"]["AppUser"]["properties"]
    assert "OfficeDocument" in schema["components"]["schemas"]


def test_invalid_office_response_is_reported_as_an_upstream_contract_error(gateway):
    client, _, state, token = gateway
    state["offices"][0]["revision"] = "invalid-private-value"
    response = client.get("/api/offices", headers={"Authorization": f"Bearer {token()}"})
    assert response.status_code == 502
    assert response.json()["code"] == "upstream_contract_invalid"
    assert "invalid-private-value" not in response.text


def test_invalid_session_response_does_not_set_authentication_cookies(gateway):
    client, _, _, _ = gateway
    client.app.state.http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={"access_token": 123, "token": "private-refresh-token"},
            )
        )
    )
    response = client.post("/api/auth/login", json={"login": "ivan", "password": "secret"})
    assert response.status_code == 502
    assert response.json()["code"] == "upstream_contract_invalid"
    assert "private-refresh-token" not in response.text
    assert "set-cookie" not in response.headers
