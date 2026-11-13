import asyncio
import json
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import httpx2
import mcp_types
import pytest
from fastapi import HTTPException
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import SecretStr
from workplace_gateway.mcp_server import (
    REQUIRED_CALLBACKS,
    UsersMCPTokenVerifier,
    create_mcp_server,
)

RESOURCE = "http://localhost:5178/mcp"


def settings():
    return SimpleNamespace(
        public_base_url="http://localhost:5178",
        users_url="http://users:8000",
        internal_api_key=SecretStr("test-internal-key-with-enough-characters"),
        request_timeout_seconds=2,
        allowed_origins=["http://localhost:5178"],
    )


def profile(user_id="alice", role="employee"):
    return {
        "id": user_id,
        "login": user_id,
        "first_name": user_id.title(),
        "last_name": "Employee",
        "role": role,
        "active": True,
        "building_ids": ["office-" + user_id],
        "created_at": datetime.now(UTC).isoformat(),
    }


def grant(user_id="alice", role="employee", **changes):
    return {
        "user": profile(user_id, role),
        "session_id": "session-" + user_id,
        "client_id": "external-agent",
        "scopes": ["booking"],
        "expires_at": int(time.time()) + 600,
        "resource": RESOURCE,
        **changes,
    }


@pytest.fixture
async def bundle():
    calls = []
    introspections = []

    async def invoke(current, **arguments):
        calls.append((current, arguments))
        return {"userId": current.user.id, "arguments": arguments}

    async def list_offices(current):
        calls.append((current, {}))
        return [{"id": "office-" + current.user.id}]

    async def list_bookings(current, **arguments):
        calls.append((current, arguments))
        return []

    async def prepare(current, **arguments):
        calls.append((current, arguments))
        return {
            "url": "http://localhost:5178/booking?officeId=office-alice&resourceId=desk-1",
            "proposal": {"officeId": "office-alice", "floorId": "floor-1", "resourceId": "desk-1"},
        }

    callbacks = dict.fromkeys(REQUIRED_CALLBACKS, invoke)
    callbacks.update(
        list_offices=list_offices, list_bookings=list_bookings, prepare_booking=prepare
    )

    def introspect(request):
        assert request.headers["X-Internal-Key"] == settings().internal_api_key.get_secret_value()
        body = json.loads(request.content)
        introspections.append(body)
        assert body["resource"] == RESOURCE
        known = {
            "mcp-alice": grant(),
            "mcp-bob": grant("bob"),
            "mcp-admin": grant("admin", "admin"),
            "mcp-wrong-resource": grant(resource="https://another.example/mcp"),
        }
        if body["token"] not in known:
            return httpx.Response(401, json={"detail": {"code": "mcp_token_invalid"}})
        return httpx.Response(200, json=known[body["token"]])

    async with httpx.AsyncClient(transport=httpx.MockTransport(introspect)) as users:
        server, app = create_mcp_server(settings(), callbacks, http_client=users)
        started = asyncio.Event()
        stop = asyncio.Event()

        async def lifespan():
            async with server.session_manager.run():
                started.set()
                await stop.wait()

        lifetime = asyncio.create_task(lifespan())
        await started.wait()
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:5178",
            ) as client:
                yield server, client, calls, introspections, callbacks
        finally:
            stop.set()
            await lifetime


async def rpc(client, method, params=None, token="mcp-alice"):
    headers = {
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": mcp_types.LATEST_PROTOCOL_VERSION,
        "MCP-Method": method,
    }
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    if params and "name" in params:
        headers["MCP-Name"] = params["name"]
    return await client.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": "test-request",
            "method": method,
            "params": {
                **(params or {}),
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": mcp_types.LATEST_PROTOCOL_VERSION,
                    "io.modelcontextprotocol/clientCapabilities": {},
                },
            },
        },
    )


async def test_public_resource_metadata_and_unauthenticated_http_boundary(bundle):
    _, client, calls, introspections, _ = bundle
    metadata = await client.get("/.well-known/oauth-protected-resource/mcp")
    assert metadata.status_code == 200
    assert metadata.json()["resource"] == RESOURCE
    assert metadata.json()["authorization_servers"] == ["http://localhost:5178/oauth"]
    response = await rpc(client, "tools/list", token=None)
    assert response.status_code == 401
    assert "resource_metadata=" in response.headers["www-authenticate"]
    assert calls == [] and introspections == []


async def test_web_or_wrong_audience_token_never_executes_a_tool(bundle):
    _, client, calls, introspections, _ = bundle
    for token in ("this.is.web-jwt", "mcp-wrong-resource"):
        response = await rpc(client, "tools/list", token=token)
        assert response.status_code == 401
    assert calls == []
    assert {entry["token"] for entry in introspections} == {"this.is.web-jwt", "mcp-wrong-resource"}


async def test_tools_are_employee_only_and_do_not_accept_model_identity(bundle):
    _, client, _, _, _ = bundle
    response = await rpc(client, "tools/list")
    assert response.status_code == 200, response.text
    tools = response.json()["result"]["tools"]
    assert {tool["name"] for tool in tools} == REQUIRED_CALLBACKS
    assert "create_booking" not in {tool["name"] for tool in tools}
    for tool in tools:
        fields = tool["inputSchema"]["properties"]
        assert not {"user_id", "owner_id", "role", "token", "password"}.intersection(fields)
    for name in ("update_booking", "cancel_booking"):
        tool = next(tool for tool in tools if tool["name"] == name)
        assert {"office_id", "booking_id"}.issubset(tool["inputSchema"]["required"])


async def test_actual_http_tool_calls_bind_each_users_verified_context(bundle):
    _, client, calls, _, _ = bundle
    for token, expected in (("mcp-alice", "alice"), ("mcp-bob", "bob"), ("mcp-admin", "admin")):
        response = await rpc(client, "tools/call", {"name": "list_offices", "arguments": {}}, token)
        assert response.status_code == 200, response.text
        assert response.json()["result"].get("isError", False) is False, response.text
        assert calls[-1][0].user.id == expected
        assert calls[-1][0].session_id == "session-" + expected
        assert calls[-1][0].access_expires_at.timestamp() > time.time()
    assert calls[-1][0].user.role == "admin"


async def test_prepare_only_returns_the_form_link_and_verified_proposal(bundle):
    _, client, calls, _, _ = bundle
    response = await rpc(
        client,
        "tools/call",
        {
            "name": "prepare_booking",
            "arguments": {
                "office_id": "office-alice",
                "resource_id": "desk-1",
            },
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert result.get("isError", False) is False, response.text
    assert result["structuredContent"]["proposal"]["resourceId"] == "desk-1"
    assert "token" not in result["structuredContent"]["url"]
    assert calls[-1][0].user.id == "alice"
    assert calls[-1][1] == {
        "office_id": "office-alice",
        "resource_id": "desk-1",
        "floor_id": None,
        "date": None,
        "start": None,
        "end": None,
        "participants": None,
    }


async def test_http_facade_error_does_not_leak_internal_details(bundle):
    _, client, _, _, callbacks = bundle

    async def forbidden(current, **arguments):
        raise HTTPException(
            403, detail={"code": "administrator_required", "token": "private-token"}
        )

    callbacks["cancel_booking"] = forbidden
    response = await rpc(
        client,
        "tools/call",
        {
            "name": "cancel_booking",
            "arguments": {
                "office_id": "office-alice",
                "booking_id": "booking-other",
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["isError"] is True
    assert "private-token" not in response.text


async def test_direct_in_memory_tool_call_cannot_bypass_authentication(bundle):
    server, _, calls, _, _ = bundle
    with pytest.raises(ToolError):
        await server.call_tool("list_offices", {})
    assert calls == []


async def test_official_sdk_client_uses_the_authenticated_http_transport(bundle):
    _, configured_http, calls, introspections, _ = bundle
    # Reuse the ASGI application, while the official transport owns protocol framing.
    app = configured_http._transport.app
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app),
        headers={"Authorization": "Bearer mcp-alice"},
    ) as http_client:

        @asynccontextmanager
        async def transport():
            async with streamable_http_client(RESOURCE, http_client=http_client) as streams:
                yield streams

        async with Client(transport()) as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == REQUIRED_CALLBACKS
            result = await client.call_tool(
                "prepare_booking",
                {
                    "office_id": "office-alice",
                    "resource_id": "desk-1",
                },
            )
            assert not result.is_error
            assert result.structured_content["proposal"]["resourceId"] == "desk-1"
    assert calls[-1][0].user.id == "alice"
    assert introspections and all(row["token"] == "mcp-alice" for row in introspections)


@pytest.mark.parametrize(
    "patch",
    [
        {"expires_at": 1},
        {"scopes": []},
        {"client_id": ""},
        {"resource": "https://other/mcp"},
        {"user": profile() | {"active": False}},
    ],
)
async def test_invalid_introspection_context_is_rejected(patch):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=grant(**patch)),
        )
    ) as client:
        verifier = UsersMCPTokenVerifier(settings(), RESOURCE, client)
        assert await verifier.verify_token("mcp-token") is None


async def test_issuer_outage_fails_closed_without_exposing_token(caplog):
    def offline(request):
        raise httpx.ConnectError("private-token", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(offline)) as client:
        verifier = UsersMCPTokenVerifier(settings(), RESOURCE, client)
        assert await verifier.verify_token("private-token") is None
    assert "private-token" not in caplog.text
