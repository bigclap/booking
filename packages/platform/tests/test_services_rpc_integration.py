"""Real Core NATS + PostgreSQL + outbox/JetStream lifecycle across three services."""

import os
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_platform.auth import Actor, encode_actor
from workplace_platform.outbox import STREAM, ensure_stream, publish_batch
from workplace_platform.rpc import ServiceTransport

pytestmark = pytest.mark.integration
KEY = "cross-service-internal-key-at-least-24-characters"
PASSWORD = "cross-service-test-password"


@asynccontextmanager
async def isolated_database(url, metadata):
    schema = f"cross_service_{uuid4().hex}"
    control = create_async_engine(url)
    async with control.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)
        yield engine, async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()


async def test_rpc_booking_archive_and_durable_access_revocation_roundtrip(monkeypatch):
    urls = {
        name: os.environ.get(f"TEST_{name.upper()}_DATABASE_URL")
        for name in ("users", "booking", "assistant")
    }
    if not all(urls.values()) or not os.environ.get("NATS_URL"):
        pytest.skip("Requires the isolated compose.test.yaml PostgreSQL and NATS stack")
    # The Users module constructs its default app during import; never use a dev URL.
    monkeypatch.setenv("DATABASE_URL", urls["users"])
    from workplace_assistant import booking_events as assistant_events
    from workplace_assistant import main as assistant
    from workplace_booking import main as booking
    from workplace_booking import user_events as booking_events
    from workplace_users import booking_events as users_events
    from workplace_users import main as users

    metadata = {
        "users": users.User.metadata,
        "booking": booking.Building.metadata,
        "assistant": assistant.ChatSession.metadata,
    }
    async with AsyncExitStack() as stack:
        stores = {
            name: await stack.enter_async_context(isolated_database(urls[name], tables))
            for name, tables in metadata.items()
        }
        common = {
            "internal_api_key": KEY,
            "internal_rpc_enabled": True,
            "nats_url": os.environ["NATS_URL"],
            "request_timeout_seconds": 10,
        }
        apps = {
            "users": users.create_application(
                users.UsersSettings(database_url=urls["users"], **common), stores["users"][0]
            ),
            "booking": booking.build_app(
                booking.BookingSettings(database_url=urls["booking"], **common)
            ),
            "assistant": assistant.create_application(
                assistant.AssistantSettings(database_url=urls["assistant"], **common)
            ),
        }

        def session_dependency(sessions):
            async def dependency():
                async with sessions() as session:
                    yield session

            return dependency

        apps["booking"].dependency_overrides[booking.get_session] = session_dependency(
            stores["booking"][1]
        )
        apps["assistant"].dependency_overrides[assistant.get_session] = session_dependency(
            stores["assistant"][1]
        )
        admin_id = uuid4()
        async with stores["users"][1]() as db, db.begin():
            db.add(
                users.User(
                    id=admin_id,
                    login="admin",
                    first_name="Test",
                    last_name="Admin",
                    role="admin",
                    password_hash=users.hash_password(PASSWORD),
                    building_ids=[],
                )
            )
        for app in apps.values():
            await stack.enter_async_context(app.router.lifespan_context(app))
        connection = apps["booking"].state.nats
        js = connection.jetstream()
        await ensure_stream(js)
        subscriptions = {}
        for name, subject in {
            "assistant": assistant_events.SUBJECT,
            "booking": "workplace.users.user_disabled",
            "users": users_events.SUBJECT,
        }.items():
            durable = f"cross-{name}-{uuid4().hex}"
            subscriptions[name] = await js.pull_subscribe(
                subject,
                durable=durable,
                stream=STREAM,
                config=ConsumerConfig(
                    ack_policy=AckPolicy.EXPLICIT, deliver_policy=DeliverPolicy.NEW
                ),
            )
            stack.push_async_callback(js.delete_consumer, STREAM, durable)
        client = await stack.enter_async_context(
            httpx.AsyncClient(
                transport=ServiceTransport(connection, apps["users"].state.settings),
                headers={"X-Internal-Key": KEY, "X-User-ID": str(admin_id)},
            )
        )

        async def rpc(service, method, path, *, raw=False, **kwargs):
            response = await client.request(
                method, f"http://{service}:8000/internal{path}", **kwargs
            )
            assert response.is_success, response.text
            return response if raw else response.json()

        office = await rpc("booking", "POST", "/offices", json={"name": "Integration office"})
        office_id, floor = office["id"], office["floors"][0]["plan_document"]
        desk_id = f"desk-{uuid4()}"
        floor["elements"] = [{"id": desk_id, "kind": "desk", "name": "Desk"}]
        office = await rpc(
            "booking",
            "PUT",
            f"/offices/{office_id}/plan",
            json={"expected_revision": office["revision"], "floors": [floor]},
        )
        await rpc(
            "booking",
            "PATCH",
            f"/offices/{office_id}/settings",
            json={
                "name": office["name"],
                "expected_revision": office["revision"],
                "hours_document": {
                    day: {"enabled": True, "start": "09:00", "end": "19:00"}
                    for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
                },
            },
        )
        employee = await rpc(
            "users",
            "POST",
            "/users",
            json={
                "login": "employee",
                "password": PASSWORD,
                "first_name": "Test",
                "last_name": "Employee",
                "building_ids": [office_id],
            },
        )
        login = await rpc(
            "users", "POST", "/auth/login", json={"login": "employee", "password": PASSWORD}
        )
        actor = await rpc("users", "POST", "/auth/introspect", json={"token": login["token"]})
        actor_headers = {"X-Actor-Context": encode_actor(Actor.model_validate(actor))}
        chat = (await rpc("assistant", "POST", "/chats/new", headers=actor_headers))["session"]
        tomorrow = (datetime.now(ZoneInfo("Europe/Moscow")) + timedelta(days=1)).date().isoformat()
        booking_path = f"/offices/{office_id}/bookings"
        booking = await rpc(
            "booking",
            "POST",
            booking_path,
            headers={"Idempotency-Key": str(uuid4()), "X-User-ID": employee["id"]},
            json={
                "floor_id": floor["id"],
                "resource_id": desk_id,
                "date": tomorrow,
                "start": 600,
                "end": 660,
                "owner_id": employee["id"],
            },
        )
        assert await publish_batch(stores["booking"][0], js) > 0
        message = (await subscriptions["assistant"].fetch(1, timeout=3))[0]
        assert await assistant_events.consume_message(message, stores["assistant"][1])
        archived = await rpc("assistant", "GET", f"/chats/{chat['id']}", headers=actor_headers)
        assert archived["session"]["archive_reason"] == "booking_created"

        disabled = await rpc(
            "users", "PATCH", f"/users/{employee['id']}", json={"active": False}, raw=True
        )
        operation_path = f"/access-operations/{disabled.headers['x-access-operation-id']}"
        assert (await rpc("users", "GET", operation_path))["status"] == "pending"
        assert await publish_batch(stores["users"][0], js) == 1
        message = (await subscriptions["booking"].fetch(1, timeout=3))[0]
        assert await booking_events.consume_message(message, stores["booking"][1])
        assert await publish_batch(stores["booking"][0], js) > 0
        message = (await subscriptions["users"].fetch(1, timeout=3))[0]
        assert await users_events.consume_message(message, stores["users"][1])
        operation = await rpc("users", "GET", operation_path)
        assert operation["status"] == "completed" and operation["cancelled_count"] == 1
        assert operation["terminated_count"] == 0
        retained = await rpc("booking", "GET", f"{booking_path}/{booking['id']}")
        assert retained["status"] == "cancelled" and retained["owner_id"] == employee["id"]
        history = await rpc("booking", "GET", f"{booking_path}/{booking['id']}/history")
        assert [item["operation"] for item in history] == ["created", "access_revoked"]
        refresh = await client.post(
            "http://users:8000/internal/auth/refresh", json={"token": login["token"]}
        )
        assert refresh.status_code == 401
        assert (await rpc("users", "GET", f"/users/{employee['id']}"))["active"] is False
