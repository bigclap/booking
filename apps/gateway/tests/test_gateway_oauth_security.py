"""Keep public OAuth paths separate from the credential-bearing private RPC transport."""

import base64
from types import SimpleNamespace

import httpx
import pytest
from mcp.server.auth.routes import create_auth_routes
from mcp.server.auth.settings import ClientRegistrationOptions
from pydantic import AnyHttpUrl
from starlette.applications import Starlette
from starlette.routing import Mount
from workplace_gateway.application import create_gateway
from workplace_gateway.config import GatewaySettings
from workplace_platform.http_clients import stateless_cookies
from workplace_platform.rpc import RpcRequest, RpcResponse, ServiceTransport

KEY = "test-oauth-gateway-boundary-key-at-least-24"
JWT_KEY = "test-oauth-gateway-web-key-at-least-32-characters"


@pytest.fixture
async def protocol_gateway():
    settings = GatewaySettings(
        internal_api_key=KEY,
        web_jwt_secret=JWT_KEY,
        cookie_secure=False,
        public_base_url="http://localhost:5178",
        allowed_origins=["http://localhost:5178"],
    )

    # Preflight belongs to the actual SDK CORS routes and must never reach identity/storage.
    class UnusedProvider:
        async def get_client(self, client_id):
            raise AssertionError("A CORS preflight must not authenticate a client")

    sdk_app = Starlette(
        routes=create_auth_routes(
            UnusedProvider(),
            AnyHttpUrl("http://localhost:5178/oauth"),
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                default_scopes=["booking"],
                valid_scopes=["booking"],
            ),
        )
    )
    users_app = Starlette(routes=[Mount("/oauth", app=sdk_app)])
    observed = []
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=users_app),
        base_url="http://users",
        cookies=stateless_cookies(),
    ) as backend:

        class RpcBridge:
            async def request(self, subject, data, **_kwargs):
                command = RpcRequest.model_validate_json(data)
                observed.append(command)
                result = await backend.request(
                    command.method,
                    command.path,
                    headers=command.headers,
                    params=command.query,
                    content=base64.b64decode(command.body) if command.body is not None else None,
                )
                return SimpleNamespace(
                    data=RpcResponse(
                        status=result.status_code,
                        headers=dict(result.headers),
                        body=base64.b64encode(result.content).decode(),
                    )
                    .model_dump_json()
                    .encode()
                )

        async with httpx.AsyncClient(
            transport=ServiceTransport(RpcBridge(), settings),
            cookies=stateless_cookies(),
        ) as upstream:
            app = create_gateway(settings)
            app.state.http_client = upstream
            app.state.oauth_http_client = upstream
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://gateway",
            ) as browser:
                yield browser, observed


@pytest.mark.parametrize(
    "url",
    [
        "/oauth/%2e%2e/internal/users/sentinel",
        "/oauth/%252e%252e/internal/users/sentinel",
        "/oauth/authorize/%2e%2e/%2e%2e/internal/users/sentinel",
        "/oauth/..%2Finternal/users/sentinel",
        "/oauth/internal/users/sentinel",
    ],
)
async def test_public_path_cannot_become_a_credentialed_internal_rpc(protocol_gateway, url):
    browser, observed = protocol_gateway
    response = await browser.get(
        url,
        headers={
            "X-Internal-Key": "attacker-controlled",
            "X-User-ID": "attacker-controlled",
        },
    )
    assert response.status_code in {403, 404}
    assert observed == []


@pytest.mark.parametrize("endpoint", ["token", "register"])
async def test_external_oauth_preflight_reaches_official_sdk(protocol_gateway, endpoint):
    browser, observed = protocol_gateway
    response = await browser.options(
        f"/oauth/{endpoint}",
        headers={
            "Origin": "http://localhost:6274",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
            "X-Internal-Key": "attacker-controlled",
            "X-User-ID": "attacker-controlled",
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == "*"
    assert len(observed) == 1
    command = observed[0]
    assert command.path == f"/oauth/{endpoint}"
    assert command.headers["access-control-request-method"] == "POST"
    assert command.headers["access-control-request-headers"] == "content-type"
    assert "x-user-id" not in command.headers
    assert command.headers["x-internal-key"] == KEY


async def test_public_oauth_cors_does_not_relax_web_cookie_api(protocol_gateway):
    browser, observed = protocol_gateway
    response = await browser.options(
        "/api/auth/login",
        headers={
            "Origin": "http://localhost:6274",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
    assert observed == []


async def test_public_metadata_keeps_canonical_issuer_and_strips_actor_headers(protocol_gateway):
    browser, observed = protocol_gateway
    result = await browser.get(
        "/.well-known/oauth-authorization-server/oauth",
        headers={
            "X-Internal-Key": "attacker-controlled",
            "X-User-ID": "attacker-controlled",
            "X-Session-ID": "attacker-controlled",
            "X-Actor-Context": "attacker-controlled",
        },
    )
    assert result.status_code == 200
    assert result.json()["issuer"] == "http://localhost:5178/oauth"
    assert observed[0].path == "/oauth/.well-known/oauth-authorization-server"
    assert not {"x-user-id", "x-session-id", "x-actor-context"} & observed[0].headers.keys()
