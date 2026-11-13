from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from workplace_users.booking_events import SUBJECT, consume_message, handle_event
from workplace_users.models import AccessOperation, InboxEvent, OutboxEvent

from apps.users.tests.test_auth import (
    INTERNAL_HEADERS,
    employee,
    login,
    session_headers,
)


def completion(operation, user_id, *, cancelled=2, terminated=1):
    return {
        "id": str(uuid4()),
        "subject": SUBJECT,
        "occurred_at": datetime.now(UTC).isoformat(),
        "data": {
            "operation_id": str(operation),
            "user_id": user_id,
            "cancelled_count": cancelled,
            "terminated_count": terminated,
        },
    }


@pytest.mark.integration
async def test_access_removal_and_outbox_share_transaction_until_durable_booking_result(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    response = await client.patch(
        f"/internal/users/{user['id']}",
        headers={**session_headers(admin), "X-Request-ID": "revoke-office-a"},
        json={"building_ids": ["office-b"]},
    )
    assert response.status_code == 200
    operation_id = response.headers["X-Access-Operation-ID"]
    async with sessions() as db:
        operation = await db.scalar(select(AccessOperation))
        event = await db.scalar(select(OutboxEvent))
        assert str(operation.id) == operation_id == event.payload["operation_id"]
        assert operation.scope == {"building_ids": ["office-a"]}
        assert operation.status == "pending"
        assert event.payload["correlation_id"] == "revoke-office-a"
    status = await client.get(
        f"/internal/access-operations/{operation_id}", headers=INTERNAL_HEADERS
    )
    assert status.status_code == 200
    assert status.json()["status"] == "pending"
    assert status.json()["publication"]["published_at"] is None
    envelope = completion(operation_id, user["id"])
    assert await handle_event(sessions, envelope, subject=SUBJECT)
    assert not await handle_event(sessions, envelope, subject=SUBJECT)
    status = await client.get(
        f"/internal/access-operations/{operation_id}", headers=INTERNAL_HEADERS
    )
    assert status.json()["status"] == "completed"
    assert status.json()["cancelled_count"] == 2
    assert status.json()["terminated_count"] == 1
    assert status.json()["completed_at"]
    # A distinct duplicate result cannot rewrite a previously committed outcome.
    assert await handle_event(sessions, completion(operation_id, user["id"], cancelled=99))
    status = await client.get(
        f"/internal/access-operations/{operation_id}", headers=INTERNAL_HEADERS
    )
    assert status.json()["cancelled_count"] == 2


@pytest.mark.integration
async def test_mismatched_completion_rolls_back_receipt_and_remains_pending(api):
    client, sessions = api
    admin = await login(client)
    user = await employee(client, admin)
    response = await client.patch(
        f"/internal/users/{user['id']}", headers=session_headers(admin), json={"active": False}
    )
    operation_id = response.headers["X-Access-Operation-ID"]
    envelope = completion(operation_id, str(uuid4()))
    with pytest.raises(ValueError, match="mismatched"):
        await handle_event(sessions, envelope)
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(InboxEvent)) == 0
        assert (await db.scalar(select(AccessOperation))).status == "pending"
    envelope["data"]["user_id"] = user["id"]
    assert await handle_event(sessions, envelope)


@pytest.mark.integration
async def test_completion_worker_retries_without_ack_on_database_failure(api):
    import json

    _, sessions = api

    class Message:
        subject = SUBJECT
        data = json.dumps(completion(uuid4(), str(uuid4()))).encode()
        acknowledged = False
        retry = False

        async def ack_sync(self, **kwargs):
            self.acknowledged = True

        async def nak(self, delay):
            self.retry = True

    message = Message()
    assert not await consume_message(message, sessions)
    assert message.retry
    assert not message.acknowledged


@pytest.mark.integration
async def test_operations_are_private_and_filter_by_target_user(api):
    client, _ = api
    admin = await login(client)
    user = await employee(client, admin)
    await client.patch(
        f"/internal/users/{user['id']}", headers=session_headers(admin), json={"active": False}
    )
    assert (await client.get("/internal/access-operations")).status_code == 401
    rows = await client.get(
        "/internal/access-operations", headers=INTERNAL_HEADERS, params={"user_id": user["id"]}
    )
    assert len(rows.json()) == 1
    assert rows.json()[0]["scope"] == {"all_buildings": True}
    rows = await client.get(
        "/internal/access-operations", headers=INTERNAL_HEADERS, params={"user_id": str(uuid4())}
    )
    assert rows.json() == []
