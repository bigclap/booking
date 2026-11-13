import asyncio
import json
import os
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import Depends, Request, Response
from fastapi.responses import HTMLResponse
from nats.js.errors import NotFoundError
from pydantic import ValidationError
from workplace_platform.auth import require_internal_key
from workplace_platform.config import ServiceSettings
from workplace_platform.correlation import event_metadata
from workplace_platform.http_clients import stateless_cookies
from workplace_platform.outbox import ensure_stream
from workplace_platform.rpc import RpcRequest, ServiceTransport, subject
from workplace_platform.web import create_app

KEY = "rpc-test-internal-key-with-enough-entropy"


def test_rpc_contract_cannot_address_public_routes_or_unknown_service():
    for path in (
        "/api/users",
        "https://example.org/internal/users",
        "/docs",
        "/internal/../docs",
        "/internal/%2e%2e/docs",
    ):
        with pytest.raises(ValidationError):
            RpcRequest(method="GET", path=path)
    with pytest.raises(ValueError):
        subject("gateway")


@asynccontextmanager
async def service():
    if not os.environ.get("NATS_URL"):
        pytest.skip("Use the isolated compose.test.yaml NATS server")
    settings = ServiceSettings(
        internal_api_key=KEY,
        nats_url=os.environ["NATS_URL"],
        internal_rpc_enabled=True,
        request_timeout_seconds=0.1,
    )
    app = create_app("booking", settings)
    calls = []
    simultaneous = 0
    peak = 0

    @app.post("/internal/echo", dependencies=[Depends(require_internal_key)])
    async def echo(payload: dict, request: Request):
        calls.append(payload)
        return {
            "body": payload,
            "query": request.query_params.multi_items(),
            "actor": request.headers.get("x-actor-context"),
            "cookies": dict(request.cookies),
            "authorization": request.headers.get("authorization"),
            "correlation": event_metadata(),
        }

    @app.post("/internal/slow", dependencies=[Depends(require_internal_key)])
    async def slow():
        nonlocal simultaneous, peak
        simultaneous += 1
        peak = max(peak, simultaneous)
        calls.append("slow")
        await asyncio.sleep(0.2)
        simultaneous -= 1
        return {"peak": peak}

    @app.post("/internal/logout", dependencies=[Depends(require_internal_key)])
    async def logout():
        return Response(status_code=204)

    @app.get("/internal/oversize-response", dependencies=[Depends(require_internal_key)])
    async def oversize_response():
        calls.append("oversize-response")
        return {"image": "x" * (17 * 1024 * 1024)}

    @app.post("/oauth/login")
    async def oauth_login(request: Request):
        form = await request.form()
        assert form["login"] == "Пользователь"
        assert request.cookies["csrf"] == "csrf-test"
        response = HTMLResponse("<p>Разрешить подключение</p>", status_code=302)
        response.headers["location"] = "https://client.example/callback?code=opaque"
        response.set_cookie("one", "1", httponly=True)
        response.set_cookie("two", "2", httponly=True)
        return response

    @app.options("/oauth/token")
    async def oauth_options(request: Request):
        assert request.headers["authorization"] == "Basic client-secret"
        assert request.headers["access-control-request-method"] == "POST"
        return Response(status_code=204, headers={"Access-Control-Allow-Origin": "*"})

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=ServiceTransport(app.state.nats, settings),
            headers={"X-Internal-Key": KEY},
        ) as client:
            yield app, client, calls


@pytest.mark.integration
async def test_actual_nats_dispatch_preserves_json_headers_query_and_correlation():
    async with service() as (app, client, calls):
        response = await client.post(
            "http://booking:8000/internal/echo?x=1&x=2",
            json={"name": "Переговорная", "nested": {"five": 5}},
            headers={"X-Actor-Context": "trusted-context", "X-Request-ID": "rpc-test-1"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["body"]["name"] == "Переговорная"
        assert data["query"] == [["x", "1"], ["x", "2"]]
        assert data["actor"] == "trusted-context"
        assert data["correlation"] == {"request_id": "rpc-test-1", "trace_id": "rpc-test-1"}
        assert response.headers["x-request-id"] == "rpc-test-1"
        assert calls == [data["body"]]
        assert (await client.post("http://booking:8000/internal/logout")).content == b""
        # A readiness probe has no explicit service headers at its call site.
        async with httpx.AsyncClient(
            transport=ServiceTransport(app.state.nats, app.state.settings)
        ) as probe:
            assert (await probe.get("http://booking:8000/health/live")).status_code == 200


@pytest.mark.integration
async def test_rpc_preserves_oauth_forms_redirect_html_and_multiple_cookies():
    async with service() as (app, client, _):
        response = await client.post(
            "http://booking:8000/oauth/login",
            data={"login": "Пользователь"},
            headers={"Cookie": "csrf=csrf-test"},
        )
        assert response.status_code == 302
        assert response.text == "<p>Разрешить подключение</p>"
        assert response.headers["location"] == "https://client.example/callback?code=opaque"
        assert len(response.headers.get_list("set-cookie")) == 2
        # A different caller reuses the RPC server but must not inherit that jar.
        async with httpx.AsyncClient(
            transport=ServiceTransport(app.state.nats, app.state.settings),
            cookies=stateless_cookies(),
        ) as other:
            result = await other.post("http://booking:8000/internal/echo", json={})
            assert result.json()["cookies"] == {}
            await other.post(
                "http://booking:8000/oauth/login",
                data={"login": "Пользователь"},
                headers={"Cookie": "csrf=csrf-test"},
            )
            result = await other.post("http://booking:8000/internal/echo", json={})
            assert result.json()["cookies"] == {}
        response = await client.options(
            "http://booking:8000/oauth/token",
            headers={
                "Authorization": "Basic client-secret",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert response.status_code == 204
        assert response.headers["access-control-allow-origin"] == "*"


@pytest.mark.integration
async def test_transport_accepts_plan_above_default_nats_limit_and_rejects_oversize():
    async with service() as (app, client, calls):
        assert app.state.nats.max_payload == 16 * 1024 * 1024
        client._transport.timeout = 5
        plan = "x" * (1100 * 1024)
        response = await client.post("http://booking:8000/internal/echo", json={"image": plan})
        assert response.status_code == 200
        assert response.json()["body"]["image"] == plan
        response = await client.post(
            "http://booking:8000/internal/echo",
            json={"image": "x" * (17 * 1024 * 1024)},
        )
        assert response.status_code == 413
        assert len(calls) == 1
        response = await client.get("http://booking:8000/internal/oversize-response")
        assert response.status_code == 413
        assert response.json() == {"detail": {"code": "rpc_payload_too_large"}}
        assert calls[-1] == "oversize-response"


@pytest.mark.integration
async def test_rpc_rejects_invalid_service_key_and_malformed_contract():
    async with service() as (app, client, calls):
        response = await client.post(
            "http://booking:8000/internal/echo",
            json={"forbidden": True},
            headers={"X-Internal-Key": "invalid"},
        )
        assert response.status_code == 401 and calls == []
        for raw in (b"not-json", json.dumps({"method": "GET", "path": "/docs"}).encode()):
            message = await app.state.nats.request(subject("booking"), raw, timeout=1)
            assert json.loads(message.data)["status"] == 400


@pytest.mark.integration
async def test_no_responder_is_bounded_and_timed_out_mutation_is_not_retried():
    async with service() as (_, client, calls):
        with pytest.raises(httpx.ReadTimeout):
            await client.get("http://assistant:8000/internal/chats/active")
        with pytest.raises(httpx.ReadTimeout):
            await client.post("http://booking:8000/internal/slow", json={})
        await asyncio.sleep(0.25)
        assert calls == ["slow"]


@pytest.mark.integration
async def test_rpc_requests_execute_concurrently_and_stay_outside_jetstream():
    async with service() as (app, client, calls):
        client._transport.timeout = 1
        responses = await asyncio.gather(
            *(client.post("http://booking:8000/internal/slow") for _ in range(3))
        )
        assert all(response.status_code == 200 for response in responses)
        assert max(response.json()["peak"] for response in responses) == 3
        assert len(calls) == 3
        js = app.state.nats.jetstream()
        await ensure_stream(js)
        with pytest.raises(NotFoundError):
            await js.find_stream_name_by_subject(subject("booking"))
        # The request context is scoped to the handler, never leaked into another task.
        assert event_metadata() == {}


@pytest.mark.integration
async def test_transport_routes_external_origin_through_its_external_adapter():
    async with service() as (_, client, _):
        external_calls = []

        def external(request):
            external_calls.append(str(request.url))
            return httpx.Response(200, json={"external": True})

        await client._transport.external.aclose()
        client._transport.external = httpx.MockTransport(external)
        assert (await client.get("http://gateway:8000/mcp")).json() == {"external": True}
        assert external_calls == ["http://gateway:8000/mcp"]
