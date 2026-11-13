"""Exercise the official SDK authorization-code/PKCE routes over real loopback HTTP."""

import asyncio
import base64
import hashlib
import os
import re
import secrets
import socket
import subprocess
from datetime import UTC, datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_users.mcp_auth import create_mcp_internal_router, create_oauth_app
from workplace_users.mcp_models import MCPClient, MCPToken
from workplace_users.models import Session, User
from workplace_users.security import hash_password, issue_token, token_digest

# Test-only fixture.
KEY = "test-mcp-internal-key-at-least-24-characters"  # gitleaks:allow
JWT_KEY = "test-mcp-web-signing-key-at-least-32-characters"
# Test-only fixture.
ENCRYPTION_KEY = "test-mcp-encryption-key-at-least-32-characters"  # gitleaks:allow
CALLBACK = "http://127.0.0.1:9981/callback"


@pytest.fixture(scope="module")
def migrated_mcp_database():
    url = os.environ.get("TEST_USERS_DATABASE_URL")
    if not url:
        pytest.skip("Requires isolated TEST_USERS_DATABASE_URL")
    subprocess.run(
        ["alembic", "-c", "apps/users/alembic.ini", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    return url


@pytest.fixture
async def oauth_api(migrated_mcp_database, monkeypatch):
    engine = create_async_engine(migrated_mcp_database)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    login = f"mcp-{secrets.token_hex(8)}"
    async with sessions.begin() as db:
        user = User(
            login=login,
            first_name="Анна",
            last_name="Иванова",
            role="employee",
            active=True,
            building_ids=["office-a"],
            password_hash=await asyncio.to_thread(hash_password, "employee-password"),
        )
        db.add(user)
        await db.flush()
        web_session = Session(
            user_id=user.id, token_hash=token_digest(issue_token()), expires_at=None
        )
        db.add(web_session)
        await db.flush()
        user_id, session_id = user.id, web_session.id
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    base = f"http://127.0.0.1:{listener.getsockname()[1]}"
    settings = SimpleNamespace(
        public_base_url=base,
        mcp_access_ttl_seconds=600,
        mcp_refresh_days=30,
        mcp_encryption_key=SecretStr(ENCRYPTION_KEY),
        internal_api_key=SecretStr(KEY),
        web_jwt_secret=SecretStr(JWT_KEY),
        web_jwt_issuer="workplace-users",
        web_jwt_audience="workplace-web",
    )
    app = FastAPI()
    app.state.settings = settings
    app.state.sessions = sessions
    app.mount("/oauth", create_oauth_app(settings, sessions))
    app.include_router(create_mcp_internal_router())
    # Reuse the real password-change/disable endpoints to prove session-bound MCP revocation.
    monkeypatch.setenv("DATABASE_URL", migrated_mcp_database)
    monkeypatch.setenv("INTERNAL_API_KEY", KEY)
    monkeypatch.setenv("WEB_JWT_SECRET", JWT_KEY)
    monkeypatch.setenv("MCP_ENCRYPTION_KEY", ENCRYPTION_KEY)
    from workplace_users.main import router

    app.include_router(router)
    server = uvicorn.Server(
        uvicorn.Config(app, lifespan="off", access_log=False, log_level="error")
    )
    task = asyncio.create_task(server.serve(sockets=[listener]))
    while not server.started:
        if task.done():
            await task
        await asyncio.sleep(0.001)
    try:
        async with httpx.AsyncClient(base_url=base, trust_env=False, timeout=30) as client:
            yield SimpleNamespace(
                client=client,
                sessions=sessions,
                base=base,
                resource=f"{base}/mcp",
                user_id=user_id,
                session_id=session_id,
                login=login,
            )
    finally:
        server.should_exit = True
        await task
        listener.close()
        await engine.dispose()


async def register(api, method="none"):
    response = await api.client.post(
        "/oauth/register",
        json={
            "redirect_uris": [CALLBACK],
            "token_endpoint_auth_method": method,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "client_name": "Тестовый клиент",
            "scope": "booking",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def verifier_pair():
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return verifier, challenge


async def authorization(api, client, **overrides):
    verifier, challenge = verifier_pair()
    params = {
        "client_id": client["client_id"],
        "response_type": "code",
        "redirect_uri": CALLBACK,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "scope": "booking",
        "resource": api.resource,
        "state": "opaque-client-state",
        **overrides,
    }
    result = await api.client.get(f"/oauth/authorize?{urlencode(params)}")
    return result, verifier


async def code_grant(api, client):
    result, verifier = await authorization(api, client)
    assert result.status_code == 302, result.text
    consent_url = result.headers["location"]
    handle = parse_qs(urlsplit(consent_url).query)["request"][0]
    consent = await api.client.get(consent_url)
    assert consent.status_code == 200
    csrf = re.search(r'name="csrf" value="([^"]+)"', consent.text).group(1)
    login = await api.client.post(
        "/oauth/login",
        data={
            "request": handle,
            "csrf": csrf,
            "login": api.login,
            "password": "employee-password",
        },
        headers={"Origin": api.base},
    )
    assert login.status_code == 302, login.text
    callback = parse_qs(urlsplit(login.headers["location"]).query)
    assert callback["state"] == ["opaque-client-state"]
    assert callback["iss"] == [f"{api.base}/oauth"]
    return {
        "grant_type": "authorization_code",
        "client_id": client["client_id"],
        "code": callback["code"][0],
        "code_verifier": verifier,
        "redirect_uri": CALLBACK,
        "resource": api.resource,
        **({"client_secret": client["client_secret"]} if client.get("client_secret") else {}),
    }


async def grant_tokens(api, client):
    data = await code_grant(api, client)
    result = await api.client.post("/oauth/token", data=data)
    assert result.status_code == 200, result.text
    return result.json(), data


async def introspect(api, token, resource=None):
    return await api.client.post(
        "/internal/mcp/introspect",
        headers={"X-Internal-Key": KEY},
        json={"token": token, "resource": resource or api.resource},
    )


@pytest.mark.integration
@pytest.mark.parametrize("method", ["none", "client_secret_post"])
async def test_sdk_pkce_flow_persists_only_hashes_and_separates_web_tokens(oauth_api, method):
    api = oauth_api
    client = await register(api, method)
    metadata = await api.client.get("/oauth/.well-known/oauth-authorization-server")
    assert metadata.json()["issuer"] == f"{api.base}/oauth"
    assert metadata.json()["code_challenge_methods_supported"] == ["S256"]
    tokens, _ = await grant_tokens(api, client)
    assert tokens["expires_in"] == 600
    assert tokens["scope"] == "booking"
    context = await introspect(api, tokens["access_token"])
    assert context.status_code == 200
    assert context.json()["user"]["id"] == str(api.user_id)
    assert context.json()["client_id"] == client["client_id"]
    assert context.json()["resource"] == api.resource
    assert (
        await introspect(api, tokens["access_token"], "https://other.example/mcp")
    ).status_code == 401
    assert (await introspect(api, "eyJhbGciOiJIUzI1NiJ9.web-jwt.value")).status_code == 401
    async with api.sessions() as db:
        stored = await db.get(MCPToken, token_digest(tokens["access_token"]))
        assert stored is not None and stored.token_hash != tokens["access_token"]
        client_row = await db.get(MCPClient, client["client_id"])
        assert "client_secret" not in client_row.metadata_document
        if client.get("client_secret"):
            assert client_row.secret_ciphertext != client["client_secret"]


@pytest.mark.integration
async def test_sdk_rejects_wrong_verifier_redirect_resource_and_reused_code(oauth_api):
    api = oauth_api
    client = await register(api)
    data = await code_grant(api, client)
    for changes, error in [
        ({"code_verifier": "x" * 64}, "invalid_grant"),
        ({"code_verifier": "short"}, "invalid_request"),
        ({"redirect_uri": "http://127.0.0.1:9981/other"}, "invalid_request"),
        ({"resource": "https://other.example/mcp"}, "invalid_target"),
    ]:
        response = await api.client.post("/oauth/token", data={**data, **changes})
        assert response.status_code == 400
        assert response.json()["error"] == error
    success = await api.client.post("/oauth/token", data=data)
    assert success.status_code == 200
    replay = await api.client.post("/oauth/token", data=data)
    assert replay.status_code == 400
    assert replay.json()["error"] == "invalid_grant"


@pytest.mark.integration
async def test_refresh_rotates_tokens_and_replay_revokes_the_family(oauth_api):
    api = oauth_api
    client = await register(api)
    tokens, _ = await grant_tokens(api, client)
    data = {
        "grant_type": "refresh_token",
        "client_id": client["client_id"],
        "refresh_token": tokens["refresh_token"],
        "resource": api.resource,
    }
    escalation = await api.client.post("/oauth/token", data={**data, "scope": "admin"})
    assert escalation.status_code == 400
    assert escalation.json()["error"] == "invalid_scope"
    refreshed = await api.client.post("/oauth/token", data=data)
    assert refreshed.status_code == 200, refreshed.text
    new = refreshed.json()
    assert new["refresh_token"] != tokens["refresh_token"]
    assert (await introspect(api, tokens["access_token"])).status_code == 401
    assert (await introspect(api, new["access_token"])).status_code == 200
    assert (await api.client.post("/oauth/token", data=data)).status_code == 400
    assert (await introspect(api, new["access_token"])).status_code == 401


@pytest.mark.integration
async def test_delegate_is_bound_to_actual_user_session_and_password_reset_revokes_all(oauth_api):
    api = oauth_api
    client = await register(api)
    external, _ = await grant_tokens(api, client)
    headers = {
        "X-Internal-Key": KEY,
        "X-User-ID": str(api.user_id),
        "X-Session-ID": str(api.session_id),
    }
    delegated = await api.client.post("/internal/mcp/delegate", headers=headers)
    assert delegated.status_code == 200, delegated.text
    assert "refresh_token" not in delegated.json()
    builtin = delegated.json()["access_token"]
    assert (await introspect(api, builtin)).json()["client_id"] == "builtin-assistant"
    forged = await api.client.post(
        "/internal/mcp/delegate",
        headers={
            **headers,
            "X-Session-ID": str(api.user_id),
        },
    )
    assert forged.status_code == 401
    changed = await api.client.post(
        "/internal/auth/password",
        headers=headers,
        json={
            "current_password": "employee-password",
            "password": "employee-password-changed",
        },
    )
    assert changed.status_code == 204, changed.text
    assert (await introspect(api, builtin)).status_code == 401
    assert (await introspect(api, external["access_token"])).status_code == 401
    assert (await api.client.post("/internal/mcp/delegate", headers=headers)).status_code == 401


@pytest.mark.integration
async def test_expired_token_and_disabled_user_are_rejected(oauth_api):
    api = oauth_api
    client = await register(api)
    tokens, _ = await grant_tokens(api, client)
    async with api.sessions.begin() as db:
        stored = await db.get(MCPToken, token_digest(tokens["access_token"]))
        stored.expires_at = datetime(2000, 1, 1, tzinfo=UTC)
    assert (await introspect(api, tokens["access_token"])).status_code == 401
    tokens, _ = await grant_tokens(api, client)
    disabled = await api.client.patch(
        f"/internal/users/{api.user_id}",
        headers={
            "X-Internal-Key": KEY,
            "X-User-ID": str(api.user_id),
        },
        json={"active": False},
    )
    assert disabled.status_code == 200
    assert (await introspect(api, tokens["access_token"])).status_code == 401


@pytest.mark.integration
async def test_login_requires_csrf_cookie_and_unknown_client_cannot_redirect(oauth_api):
    api = oauth_api
    client = await register(api)
    authorization_result, _ = await authorization(api, client)
    login_url = authorization_result.headers["location"]
    handle = parse_qs(urlsplit(login_url).query)["request"][0]
    response = await api.client.post(
        "/oauth/login",
        data={
            "request": handle,
            "csrf": "forged",
            "login": api.login,
            "password": "employee-password",
        },
    )
    assert response.status_code == 403
    unregistered_redirect, _ = await authorization(
        api, client, redirect_uri="https://evil.example/cb"
    )
    assert unregistered_redirect.status_code == 400
    assert "location" not in unregistered_redirect.headers


@pytest.mark.integration
async def test_confidential_basic_client_uses_sdk_authentication_and_revocation(oauth_api):
    api = oauth_api
    client = await register(api, "client_secret_basic")
    data = await code_grant(api, client)
    data.pop("client_secret")
    wrong = await api.client.post(
        "/oauth/token", data=data, auth=httpx.BasicAuth(client["client_id"], "incorrect")
    )
    assert wrong.status_code == 401
    success = await api.client.post(
        "/oauth/token",
        data=data,
        auth=httpx.BasicAuth(client["client_id"], client["client_secret"]),
    )
    assert success.status_code == 200, success.text
    token = success.json()["access_token"]
    assert (await introspect(api, token)).status_code == 200
    revoked = await api.client.post(
        "/oauth/revoke",
        data={
            "token": token,
            "token_type_hint": "access_token",
            "client_id": client["client_id"],
        },
        auth=httpx.BasicAuth(client["client_id"], client["client_secret"]),
    )
    assert revoked.status_code == 200, revoked.text
    assert (await introspect(api, token)).status_code == 401


@pytest.mark.integration
async def test_concurrent_authorization_code_exchange_is_atomic(oauth_api):
    api = oauth_api
    client = await register(api)
    data = await code_grant(api, client)
    results = await asyncio.gather(*[api.client.post("/oauth/token", data=data) for _ in range(12)])
    assert [response.status_code for response in results].count(200) == 1
    assert [response.status_code for response in results].count(400) == 11


@pytest.mark.integration
@pytest.mark.parametrize(
    "redirect_uri",
    [
        "javascript:alert(1)",
        "http://remote.example/callback",
        "https://example.com/callback#fragment",
        "https://user:password@example.com/callback",
    ],
)
async def test_registration_rejects_unsafe_redirect_uri(oauth_api, redirect_uri):
    response = await oauth_api.client.post(
        "/oauth/register",
        json={
            "redirect_uris": [redirect_uri],
            "token_endpoint_auth_method": "none",
            "scope": "booking",
        },
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"


@pytest.mark.integration
async def test_wrong_password_for_unnamed_client_does_not_create_a_session(oauth_api):
    api = oauth_api
    registered = await api.client.post(
        "/oauth/register",
        json={
            "redirect_uris": [CALLBACK],
            "token_endpoint_auth_method": "none",
            "scope": "booking",
        },
    )
    assert registered.status_code == 201
    result, _ = await authorization(api, registered.json())
    consent = await api.client.get(result.headers["location"])
    assert consent.status_code == 200
    handle = parse_qs(urlsplit(result.headers["location"]).query)["request"][0]
    csrf = re.search(r'name="csrf" value="([^"]+)"', consent.text).group(1)
    wrong = await api.client.post(
        "/oauth/login",
        data={
            "request": handle,
            "csrf": csrf,
            "login": api.login,
            "password": "incorrect-password",
        },
    )
    assert wrong.status_code == 200
    assert "Неверный логин или пароль" in wrong.text
    async with api.sessions() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(Session)
                .where(
                    Session.user_id == api.user_id,
                )
            )
            == 1
        )
