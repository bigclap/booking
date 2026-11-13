import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import ClientDisconnect
from workplace_gateway import events
from workplace_gateway.events import EventBridge, PublicEvent, install_events, public_event
from workplace_platform.jwt_tokens import AccessContext, TokenUser


def context(role="employee", **changes):
    return AccessContext(
        user=TokenUser(
            id="user-1",
            login="anna",
            first_name="Анна",
            last_name="Иванова",
            role=role,
            active=True,
            building_ids=["office-own"],
            created_at=datetime.now(UTC),
        ),
        session_id="session-1",
        session_expires_at=None,
        access_expires_at=datetime.now(UTC) + timedelta(minutes=2),
        **changes,
    )


def envelope(subject, data, event_id="event-1"):
    return json.dumps({"id": event_id, "subject": subject, "data": data}).encode()


def office_message(event_id="event-1", office_id="office-own"):
    subject = "workplace.booking.office_changed"
    return SimpleNamespace(
        subject=subject,
        data=envelope(
            subject,
            {
                "office_id": office_id,
                "updated_at": "2026-11-12T12:00:00Z",
            },
            event_id,
        ),
    )


class FakeRequest:
    disconnected = False

    async def is_disconnected(self):
        return self.disconnected


class FakeSubscription:
    unsubscribed = False

    async def unsubscribe(self):
        self.unsubscribed = True


class FakeClient:
    def __init__(self):
        self.calls = []
        self.closed = False
        self.subscription = FakeSubscription()

    async def connect(self, url, **options):
        self.calls.append(("connect", url))
        self.options = options

    async def subscribe(self, subject, **options):
        self.calls.append(("subscribe", subject))
        self.callback = options["cb"]
        return self.subscription

    async def flush(self, **options):
        self.calls.append(("flush",))

    async def close(self):
        self.closed = True


def test_office_event_has_only_public_fields_and_access_scope():
    message = office_message()
    event = public_event(message.subject, message.data, context())
    assert event == PublicEvent(
        "office.changed",
        {
            "officeId": "office-own",
            "revision": "2026-11-12T12:00:00Z",
        },
        "event-1",
    )
    hidden = office_message(office_id="office-hidden")
    assert public_event(hidden.subject, hidden.data, context()) is None
    assert public_event(hidden.subject, hidden.data, context(role="admin")) is not None


def test_booking_event_projects_a_whitelist_instead_of_forwarding_internal_payload():
    subject = "workplace.booking.booking_changed"
    data = {
        "building_id": "office-own",
        "booking_id": "booking-1",
        "revision": 3,
        "operation": "created",
        "owner_name": "Private Name",
        "token": "private-secret",
        "debug": {"password": "private-secret"},
    }
    event = public_event(subject, envelope(subject, data), context())
    assert event.data == {
        "officeId": "office-own",
        "bookingId": "booking-1",
        "revision": 3,
        "operation": "created",
    }
    assert b"private-secret" not in event.encode()
    data["office_id"] = "office-hidden"
    assert public_event(subject, envelope(subject, data), context(role="admin")) is None


def test_chat_event_is_owner_only_including_for_administrators():
    subject = "workplace.assistant.dialog.changed"
    data = {"user_id": "user-1", "session_id": "chat-1", "archived_session_id": None, "version": 2}
    assert public_event(subject, envelope(subject, data), context()).data == {
        "sessionId": "chat-1",
        "archivedSessionId": None,
        "revision": 2,
    }
    data["user_id"] = "another-user"
    assert public_event(subject, envelope(subject, data), context()) is None
    assert public_event(subject, envelope(subject, data), context(role="admin")) is None


def test_booking_archives_current_dialogue_and_emits_owner_refresh_without_new_session():
    subject = "workplace.assistant.dialog.changed"
    data = {
        "user_id": "user-1",
        "session_id": None,
        "archived_session_id": "chat-old",
        "version": 3,
    }
    event = public_event(subject, envelope(subject, data), context())
    assert event.data == {"sessionId": None, "archivedSessionId": "chat-old", "revision": 3}
    other = context(role="admin")
    other.user.id = "another-user"
    assert public_event(subject, envelope(subject, data), other) is None
    data.pop("session_id")
    assert public_event(subject, envelope(subject, data), context()) is None


@pytest.mark.parametrize("raw", [b"invalid json", b"[]", b"null", b"\xff", b"{}"])
def test_unknown_or_invalid_envelopes_are_ignored(raw):
    assert public_event("workplace.booking.office_changed", raw, context()) is None


def test_event_identity_cannot_inject_sse_fields_and_subject_must_match():
    subject = "workplace.booking.office_changed"
    raw = envelope(subject, {"office_id": "office-own"}, event_id="id\nevent: leak")
    assert public_event(subject, raw, context()) is None
    assert public_event("workplace.unknown", envelope(subject, {}), context()) is None
    assert (
        public_event(subject, envelope("workplace.assistant.dialog.changed", {}), context()) is None
    )


@pytest.mark.parametrize("operation", ["unknown", None, [], {"secret": "value"}])
def test_unrecognized_booking_shapes_are_ignored(operation):
    subject = "workplace.booking.booking_changed"
    assert (
        public_event(
            subject,
            envelope(
                subject,
                {
                    "office_id": "office-own",
                    "booking_id": "booking-1",
                    "revision": 1,
                    "operation": operation,
                },
            ),
            context(),
        )
        is None
    )


async def test_duplicates_are_bounded_and_overflow_requires_a_new_snapshot():
    client = FakeClient()
    bridge = EventBridge(context(), client, queue_limit=1)
    await bridge.receive(office_message("first"))
    await bridge.receive(office_message("first"))
    assert bridge.queue.qsize() == 1 and not bridge.failed
    await bridge.receive(office_message("second"))
    event = bridge.queue.get_nowait()
    assert event == PublicEvent("resync", {"snapshotRequired": True}, terminal=True)
    assert bridge.failed
    await bridge.receive(office_message("third"))
    assert bridge.queue.empty()


async def test_ready_follows_subscription_and_flush_and_closing_stream_cleans_up(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(events, "NATSClient", lambda: client)
    app = FastAPI()
    install_events(app, SimpleNamespace(nats_url="nats://fake"), lambda request: context())
    response = await app.routes[-1].endpoint(FakeRequest())
    assert client.calls == [("connect", "nats://fake"), ("subscribe", "workplace.>"), ("flush",)]
    assert response.headers["X-Accel-Buffering"] == "no"
    assert response.headers["Cache-Control"] == "no-cache, no-store"
    assert response.headers["Content-Type"].startswith("text/event-stream")
    stream = response.body_iterator
    assert await anext(stream) == b'event: ready\ndata: {"snapshotRequired":true}\n\n'
    await client.callback(office_message())
    assert b"event: office.changed\n" in await anext(stream)
    await stream.aclose()
    assert client.closed and client.subscription.unsubscribed


async def test_missing_authentication_does_not_connect_to_nats(monkeypatch):
    def unauthorized(request):
        raise HTTPException(401)

    monkeypatch.setattr(events, "NATSClient", lambda: pytest.fail("Must authenticate first"))
    app = FastAPI()
    install_events(app, SimpleNamespace(nats_url="nats://fake"), unauthorized)
    with pytest.raises(HTTPException) as raised:
        await app.routes[-1].endpoint(FakeRequest())
    assert raised.value.status_code == 401


async def test_broker_setup_failure_is503_before_stream_headers(monkeypatch):
    class OfflineClient(FakeClient):
        async def flush(self, **options):
            raise ConnectionError("Do not expose private broker connection details")

    client = OfflineClient()
    monkeypatch.setattr(events, "NATSClient", lambda: client)
    app = FastAPI()
    install_events(app, SimpleNamespace(nats_url="nats://fake"), lambda request: context())
    with pytest.raises(HTTPException) as raised:
        await app.routes[-1].endpoint(FakeRequest())
    assert raised.value.status_code == 503
    assert raised.value.detail == {"code": "events_unavailable"}
    assert client.closed and client.subscription.unsubscribed


async def test_jwt_expiry_closes_stream_even_with_pending_events(monkeypatch):
    current = context()
    client = FakeClient()
    bridge = EventBridge(current, client)
    bridge.subscription = client.subscription
    stream = bridge.stream(FakeRequest())
    assert b"event: ready\n" in await anext(stream)
    await bridge.receive(office_message())
    monkeypatch.setattr(events, "utc_now", lambda: current.access_expires_at)
    assert await anext(stream) == b'event: auth.expired\ndata: {"refreshRequired":true}\n\n'
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    assert client.closed and client.subscription.unsubscribed


async def test_heartbeat_and_broker_disconnect_are_visible_without_http_polling(monkeypatch):
    monkeypatch.setattr(events, "HEARTBEAT_SECONDS", 0.001)
    bridge = EventBridge(context(), FakeClient())
    stream = bridge.stream(FakeRequest())
    await anext(stream)
    assert await anext(stream) == b": heartbeat\n\n"
    await bridge.on_disconnect()
    assert await anext(stream) == b'event: resync\ndata: {"snapshotRequired":true}\n\n'
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    assert bridge.client.closed


async def test_request_disconnect_and_cancellation_release_resources():
    request = FakeRequest()
    client = FakeClient()
    bridge = EventBridge(context(), client)
    bridge.subscription = client.subscription
    stream = bridge.stream(request)
    await anext(stream)
    pending = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert client.closed and client.subscription.unsubscribed


async def test_response_cleans_up_even_when_http_send_fails_before_body_starts():
    client = FakeClient()
    bridge = EventBridge(context(), client)
    bridge.subscription = client.subscription
    response = events.EventStreamResponse(bridge, FakeRequest())

    async def failed_send(message):
        raise OSError("HTTP disconnected")

    async def receive():
        await asyncio.Future()

    with pytest.raises(ClientDisconnect):
        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, failed_send)
    assert client.closed and client.subscription.unsubscribed
