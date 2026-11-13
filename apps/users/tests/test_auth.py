import asyncio
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_users.models import Base, OutboxEvent, Session, User
from workplace_users.security import hash_password, token_digest

# Test-only fixture.
INTERNAL_KEY = "test-internal-key-at-least-24-characters"  # gitleaks:allow
INTERNAL_HEADERS = {"X-Internal-Key": INTERNAL_KEY}
JWT_SECRET = "test-web-jwt-secret-at-least-32-characters"


@dataclass
class LoginSession:
    token: str
    user_id: str


@pytest.fixture
async def api(monkeypatch):
    database_url = os.environ.get("USERS_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Run through compose.test.yaml for a disposable PostgreSQL database")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("INTERNAL_API_KEY", INTERNAL_KEY)
    monkeypatch.setenv("WEB_JWT_SECRET", JWT_SECRET)
    from workplace_users.config import UsersSettings
    from workplace_users.main import create_application

    schema = f"test_users_{uuid4().hex}"
    owner = create_async_engine(database_url)
    async with owner.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        database_url, connect_args={"server_settings": {"search_path": schema}}
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add(
                User(
                    login="admin",
                    first_name="Office",
                    last_name="Admin",
                    role="admin",
                    password_hash=await asyncio.to_thread(hash_password, "admin-secret"),
                    building_ids=[],
                )
            )
            await db.commit()
        app = create_application(UsersSettings(), engine=engine)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://users"
            ) as client:
                yield client, sessions
    finally:
        await engine.dispose()
        async with owner.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await owner.dispose()


async def login(client, name="admin", password="admin-secret"):
    response = await client.post(
        "/internal/auth/login",
        headers=INTERNAL_HEADERS,
        json={"login": name, "password": password},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    return LoginSession(token=result["token"], user_id=result["user"]["id"])


def session_headers(session: LoginSession):
    return {**INTERNAL_HEADERS, "X-User-ID": session.user_id}


async def employee(client, admin_token):
    response = await client.post(
        "/internal/users",
        headers=session_headers(admin_token),
        json={
            "login": "Alice",
            "first_name": "Alice",
            "last_name": "Employee",
            "password": "alice-secret",
            "building_ids": ["office-a", "office-b"],
        },
    )
    assert response.status_code == 201, response.text
    assert "password_hash" not in response.json()
    return response.json()


@pytest.mark.integration
async def test_password_change_revokes_every_session_and_preserves_other_users(api):
    client, sessions = api
    admin = await login(client)
    await employee(client, admin)
    first = await login(client, "alice", "alice-secret")
    second = await login(client, "ALICE", "alice-secret")
    response = await client.post(
        "/internal/auth/password",
        headers=session_headers(first),
        json={
            "current_password": "alice-secret",
            "password": "new-alice-secret",
        },
    )
    assert response.status_code == 204
    for token in (first, second):
        response = await client.post(
            "/internal/auth/refresh", headers=INTERNAL_HEADERS, json={"token": token.token}
        )
        assert response.status_code == 401
    assert (
        await client.get("/internal/auth/me", headers=session_headers(admin))
    ).status_code == 200
    await login(client, "alice", "new-alice-secret")
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(OutboxEvent)) == 1
        rows = (await db.scalars(select(Session))).all()
        assert all(len(row.token_hash) == 64 for row in rows)
        assert all(row.token_hash not in (first.token, second.token, admin.token) for row in rows)


@pytest.mark.integration
async def test_disable_retains_account_but_denies_login_and_refresh_and_records_outbox(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    token = await login(client, "alice", "alice-secret")
    response = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"active": False},
    )
    assert response.status_code == 200
    assert (
        await client.post(
            "/internal/auth/refresh",
            headers=INTERNAL_HEADERS,
            json={"token": token.token},
        )
    ).status_code == 401
    response = await client.post(
        "/internal/auth/login",
        headers=INTERNAL_HEADERS,
        json={"login": "alice", "password": "alice-secret"},
    )
    assert response.status_code == 401
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 2
        event = await db.scalar(select(OutboxEvent))
        assert event.subject == "workplace.users.user_disabled"
        assert event.payload["user_id"] == user["id"]
        assert event.published_at is None


@pytest.mark.integration
async def test_building_grant_revocation_changes_existing_session_and_records_task(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    token = await login(client, "alice", "alice-secret")
    response = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"building_ids": ["office-b"]},
    )
    assert response.status_code == 200
    response = await client.post(
        "/internal/auth/introspect", headers=INTERNAL_HEADERS, json={"token": token.token}
    )
    assert response.json()["building_ids"] == ["office-b"]
    async with sessions() as db:
        event = await db.scalar(select(OutboxEvent))
        assert event.subject == "workplace.users.building_access_revoked"
        assert event.payload["building_ids"] == ["office-a"]


@pytest.mark.integration
async def test_admin_reset_revokes_all_employee_sessions(api):
    client, _ = api
    admin = await login(client)
    user = await employee(client, admin)
    first = await login(client, "alice", "alice-secret")
    second = await login(client, "alice", "alice-secret")
    response = await client.post(
        f"/internal/users/{user['id']}/password",
        headers=session_headers(admin),
        json={"password": "reset-password"},
    )
    assert response.status_code == 204
    for token in (first, second):
        assert (
            await client.post(
                "/internal/auth/refresh",
                headers=INTERNAL_HEADERS,
                json={"token": token.token},
            )
        ).status_code == 401
    await login(client, "alice", "reset-password")


@pytest.mark.integration
async def test_internal_key_and_identity_are_required_for_domain_routes(api):
    client, _ = api
    admin = await login(client)
    await employee(client, admin)
    token = await login(client, "alice", "alice-secret")
    # A trusted Gateway caller sends the identity after authorizing its operation.
    assert (
        await client.get("/internal/auth/me", headers=session_headers(token))
    ).status_code == 200
    assert (
        await client.get(
            "/internal/users",
            headers={
                "X-Session-Token": admin.token,
                "X-User-Role": "admin",
                "X-User-ID": admin.user_id,
            },
        )
    ).status_code == 401
    assert (await client.get("/internal/auth/me", headers=INTERNAL_HEADERS)).status_code == 422


@pytest.mark.integration
async def test_refresh_has_no_age_deadline_and_issues_two_minute_jwt(api):
    import jwt

    client, _ = api
    response = await client.post(
        "/internal/auth/login",
        headers=INTERNAL_HEADERS,
        json={"login": "admin", "password": "admin-secret"},
    )
    assert response.status_code == 200
    original = response.json()
    refreshed = await client.post(
        "/internal/auth/refresh",
        headers=INTERNAL_HEADERS,
        json={"token": original["token"]},
    )
    assert refreshed.status_code == 200
    updated = refreshed.json()
    assert updated["token"] == original["token"]
    assert updated["expires_at"] is None
    assert original["expires_at"] is None
    claims = jwt.decode(
        updated["access_token"],
        JWT_SECRET,
        algorithms=["HS256"],
        issuer="workplace-users",
        audience="workplace-web",
    )
    assert claims["sub"] == updated["user"]["id"]
    assert claims["exp"] - claims["iat"] == 120
    access_expires = datetime.fromisoformat(updated["access_expires_at"])
    assert int(access_expires.timestamp()) == claims["exp"]
    assert "password_hash" not in updated["user"]


@pytest.mark.integration
async def test_ancient_unrevoked_refresh_session_remains_valid(api):
    client, sessions = api
    session = await login(client)
    async with sessions() as db:
        await db.execute(
            update(Session)
            .where(Session.token_hash == token_digest(session.token))
            .values(created_at=datetime(2000, 1, 1, tzinfo=UTC), expires_at=None)
        )
        await db.commit()
    response = await client.post(
        "/internal/auth/refresh",
        headers=INTERNAL_HEADERS,
        json={"token": session.token},
    )
    assert response.status_code == 200
    assert response.json()["expires_at"] is None
    assert response.json()["token"] == session.token


@pytest.mark.integration
async def test_user_facts_endpoint_returns_records_without_refresh_introspection(api):
    client, _ = api
    admin = await login(client)
    employee_user = await employee(client, admin)
    response = await client.get(
        f"/internal/users/{employee_user['id']}",
        headers=INTERNAL_HEADERS,
    )
    assert response.status_code == 200
    assert response.json() == employee_user
    missing = await client.get(f"/internal/users/{uuid4()}", headers=INTERNAL_HEADERS)
    assert missing.status_code == 404


@pytest.mark.integration
async def test_admin_can_rename_login_and_duplicate_patch_is_atomic(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    employee_token = await login(client, "alice", "alice-secret")
    url = f"/internal/users/{user['id']}"
    response = await client.patch(
        url,
        headers=session_headers(admin),
        json={"login": "  NEW.ALICE  "},
    )
    assert response.status_code == 200
    assert response.json()["login"] == "new.alice"
    assert "password_hash" not in response.json()
    assert "password" not in response.json()
    await login(client, "new.alice", "alice-secret")
    old_login = await client.post(
        "/internal/auth/login",
        headers=INTERNAL_HEADERS,
        json={"login": "alice", "password": "alice-secret"},
    )
    assert old_login.status_code == 401
    response = await client.patch(
        url,
        headers=session_headers(admin),
        json={"login": "  ADMIN  ", "active": False, "building_ids": []},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "login_already_exists"
    # Neither disabling nor grant revocation may survive the failed rename.
    current = await client.get("/internal/auth/me", headers=session_headers(employee_token))
    assert current.status_code == 200
    assert current.json()["login"] == "new.alice"
    assert current.json()["active"] is True
    assert current.json()["building_ids"] == ["office-a", "office-b"]
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(OutboxEvent)) == 0


@pytest.mark.integration
@pytest.mark.parametrize(
    "body",
    [
        {"login": None},
        {"login": "   "},
        {"login": "a" * 81},
        {"login": "\u0130" * 41},
        {"password_hash": "not-a-supported-field"},
    ],
)
async def test_user_patch_rejects_invalid_login_or_unknown_fields(api, body):
    client, _ = api
    admin = await login(client)
    user = await employee(client, admin)
    response = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json=body,
    )
    assert response.status_code == 422


@pytest.mark.integration
async def test_admin_grant_edits_do_not_enqueue_false_access_removal(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    promoted = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"role": "admin", "building_ids": []},
    )
    assert promoted.status_code == 200
    retained_admin = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"building_ids": ["office-a"]},
    )
    assert retained_admin.status_code == 200
    retained_admin = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"building_ids": []},
    )
    assert retained_admin.status_code == 200
    async with sessions() as db:
        subjects = (await db.scalars(select(OutboxEvent.subject))).all()
        assert subjects == ["workplace.users.role_changed"]


@pytest.mark.integration
async def test_admin_downgrade_enqueues_access_removal_except_remaining_buildings(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    promoted = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"role": "admin"},
    )
    assert promoted.status_code == 200
    demoted = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"role": "employee", "building_ids": ["office-a"]},
    )
    assert demoted.status_code == 200
    async with sessions() as db:
        removal = (
            await db.scalars(
                select(OutboxEvent).where(
                    OutboxEvent.subject == "workplace.users.building_access_revoked",
                )
            )
        ).one()
        assert removal.payload["user_id"] == user["id"]
        assert removal.payload["except_building_ids"] == ["office-a"]
        assert removal.payload["operation_id"]
        assert removal.payload["reason"] == "building_access_revoked"
        assert (
            await db.scalar(
                select(func.count())
                .select_from(OutboxEvent)
                .where(
                    OutboxEvent.subject == "workplace.users.role_changed",
                )
            )
            == 2
        )


@pytest.mark.integration
async def test_disable_with_grant_change_enqueues_only_one_removal_command(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    response = await client.patch(
        f"/internal/users/{user['id']}",
        headers=session_headers(admin),
        json={"active": False, "building_ids": []},
    )
    assert response.status_code == 200
    async with sessions() as db:
        subjects = (await db.scalars(select(OutboxEvent.subject))).all()
        assert subjects == ["workplace.users.user_disabled"]


@pytest.mark.integration
async def test_competing_normalized_logins_create_exactly_one_stable_identity(api):
    client, sessions = api
    admin = await login(client)
    results = await asyncio.gather(
        *[
            client.post(
                "/internal/users",
                headers=session_headers(admin),
                json={
                    "login": value,
                    "first_name": "Same",
                    "last_name": "Person",
                    "password": "employee-secret",
                },
            )
            for value in [" duplicate ", "DUPLICATE", "Duplicate", "duplicate"]
        ]
    )
    assert sorted(response.status_code for response in results) == [201, 409, 409, 409]
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 2
        assert (await db.scalar(select(User).where(User.login == "duplicate"))).active


@pytest.mark.integration
async def test_password_reset_serializes_competing_old_password_login(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    login_result, reset = await asyncio.gather(
        client.post(
            "/internal/auth/login",
            headers=INTERNAL_HEADERS,
            json={"login": "alice", "password": "alice-secret"},
        ),
        client.post(
            f"/internal/users/{user['id']}/password",
            headers=session_headers(admin),
            json={"password": "reset-secret"},
        ),
    )
    assert reset.status_code == 204
    assert login_result.status_code in {200, 401}
    if login_result.status_code == 200:
        response = await client.post(
            "/internal/auth/refresh",
            headers=INTERNAL_HEADERS,
            json={"token": login_result.json()["token"]},
        )
        assert response.status_code == 401
    async with sessions() as db:
        active = await db.scalar(
            select(func.count())
            .select_from(Session)
            .where(Session.user_id == user["id"], Session.revoked_at.is_(None))
        )
        assert active == 0
    await login(client, "alice", "reset-secret")


@pytest.mark.integration
async def test_wrong_current_password_preserves_sessions_and_logout_only_revokes_one(api):
    client, sessions = api
    admin = await login(client)
    await employee(client, admin)
    first = await login(client, "alice", "alice-secret")
    second = await login(client, "alice", "alice-secret")
    incorrect = await client.post(
        "/internal/auth/password",
        headers=session_headers(first),
        json={"current_password": "wrong-secret", "password": "new-secret"},
    )
    assert incorrect.status_code == 400
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    for user_session in (first, second):
        assert (
            await client.post(
                "/internal/auth/refresh",
                headers=INTERNAL_HEADERS,
                json={"token": user_session.token},
            )
        ).status_code == 200
    for _ in range(2):
        assert (
            await client.post(
                "/internal/auth/logout", headers=INTERNAL_HEADERS, json={"token": first.token}
            )
        ).status_code == 204
    assert (
        await client.post(
            "/internal/auth/refresh", headers=INTERNAL_HEADERS, json={"token": first.token}
        )
    ).status_code == 401
    assert (
        await client.post(
            "/internal/auth/refresh", headers=INTERNAL_HEADERS, json={"token": second.token}
        )
    ).status_code == 200


@pytest.mark.integration
async def test_credential_validation_never_echoes_rejected_input(api):
    client, _ = api
    secret = "credential-must-not-be-echoed"
    response = await client.post(
        "/internal/auth/login",
        headers=INTERNAL_HEADERS,
        json={"login": "admin", "password": secret * 100},
    )
    assert response.status_code == 422
    assert secret not in response.text


@pytest.mark.integration
async def test_real_users_application_mounts_sdk_oauth_and_internal_delegation(api):
    from pydantic import SecretStr
    from workplace_users.config import UsersSettings
    from workplace_users.main import create_application

    client, sessions = api
    user_session = await login(client)
    async with sessions() as db:
        session_id = await db.scalar(
            select(Session.id).where(Session.token_hash == token_digest(user_session.token))
        )
    app = create_application(
        UsersSettings(
            mcp_encryption_key=SecretStr("test-mcp-encryption-key-at-least-32-characters")
        ),
        engine=sessions.kw["bind"],
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://users"
        ) as mounted:
            metadata = await mounted.get("/oauth/.well-known/oauth-authorization-server")
            assert metadata.status_code == 200
            assert metadata.json()["issuer"] == "http://localhost:5178/oauth"
            assert metadata.json()["code_challenge_methods_supported"] == ["S256"]
            delegated = await mounted.post(
                "/internal/mcp/delegate",
                headers={**session_headers(user_session), "X-Session-ID": str(session_id)},
            )
            assert delegated.status_code == 200, delegated.text
            token = delegated.json()
            introspected = await mounted.post(
                "/internal/mcp/introspect",
                headers=INTERNAL_HEADERS,
                json={"token": token["access_token"], "resource": token["resource"]},
            )
            assert introspected.status_code == 200
            assert introspected.json()["user"]["id"] == user_session.user_id
