"""Actual Agent → HTTP MCP Gateway transport with delegated credentials, no paid model calls."""

import asyncio
import json
import socket
import time
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import uvicorn
from pydantic import SecretStr
from pydantic_ai import models
from pydantic_ai.models.test import TestModel
from workplace_assistant.config import AssistantSettings
from workplace_assistant.runtime import run_agent
from workplace_gateway.mcp_server import REQUIRED_CALLBACKS, create_mcp_server


async def test_actual_mcp_toolset_authenticates_user_and_excludes_mutation_tools(monkeypatch):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    public_base = f"http://127.0.0.1:{port}"
    owner_id, session_id = str(uuid4()), str(uuid4())
    calls, credentials = [], []
    proposal = {
        "officeId": "office-1",
        "floorId": "floor-1",
        "resourceId": "room-1",
        "date": "2026-11-12",
        "start": 600,
        "end": 660,
        "participants": 3,
    }

    async def prepare(current, **arguments):
        calls.append((current.user.id, "prepare_booking"))
        return {"url": "/booking?officeId=office-1&resourceId=room-1", "proposal": proposal}

    async def unexpected(current, **arguments):
        raise AssertionError("The model invoked an unexpected tool")

    callbacks = dict.fromkeys(REQUIRED_CALLBACKS, unexpected)
    callbacks["prepare_booking"] = prepare

    def introspect(request):
        body = json.loads(request.content)
        credentials.append(body["token"])
        assert body["token"] == "delegated-user-secret"
        return httpx.Response(
            200,
            json={
                "user": {
                    "id": owner_id,
                    "login": "employee",
                    "first_name": "Test",
                    "last_name": "Employee",
                    "role": "employee",
                    "active": True,
                    "building_ids": ["office-1"],
                    "created_at": datetime.now(UTC).isoformat(),
                },
                "session_id": session_id,
                "client_id": "internal-assistant",
                "scopes": ["booking"],
                "expires_at": int(time.time()) + 600,
                "resource": public_base + "/mcp",
            },
        )

    gateway_settings = SimpleNamespace(
        public_base_url=public_base,
        users_url="http://users:8000",
        internal_api_key=SecretStr("test-internal-key-at-least-24-chars"),
        request_timeout_seconds=2,
        allowed_origins=[public_base],
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(introspect)) as users:
        mcp_server, app = create_mcp_server(gateway_settings, callbacks, http_client=users)
        started = asyncio.Event()

        class NotifyingServer(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets)
                started.set()

        server = NotifyingServer(uvicorn.Config(app, lifespan="off", log_level="error"))
        async with mcp_server.session_manager.run():
            task = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(5):
                    await started.wait()
                model = TestModel(
                    call_tools=["prepare_booking"],
                    custom_output_args={
                        "message": "Откройте форму для подтверждения.",
                        "proposal": proposal,
                    },
                )
                settings = AssistantSettings(
                    # Test-only fixture.
                    internal_api_key="test-internal-key-at-least-24-chars",  # gitleaks:allow
                    openrouter_api_key="not-used",
                    openrouter_model="not-used",
                    mcp_url=public_base + "/mcp",
                )
                result = await run_agent(
                    settings,
                    "Подберите переговорную",
                    [],
                    {"officeId": "office-1"},
                    "delegated-user-secret",
                    model=model,
                )
                assert result.reply.proposal.resourceId == "room-1"
                assert calls == [(owner_id, "prepare_booking")]
                assert credentials and set(credentials) == {"delegated-user-secret"}
                exposed = {tool.name for tool in model.last_model_request_parameters.function_tools}
                assert "prepare_booking" in exposed
                assert "update_booking" not in exposed and "cancel_booking" not in exposed
                assert "delegated-user-secret" not in json.dumps(result.run_messages)
            finally:
                server.should_exit = True
                await task
                listener.close()
