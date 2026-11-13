"""A bounded, authenticated live invalidation stream, with HTTP snapshot recovery.

Browser connections use Core NATS subscriptions to committed outbox publications.
They do not create JetStream consumers or replay event history (D-110).
"""

import asyncio
import json
import re
from collections import deque
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime

import anyio
from fastapi import FastAPI, HTTPException, Request
from nats.aio.client import Client as NATSClient
from nats.aio.msg import Msg
from nats.aio.subscription import Subscription
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send
from workplace_platform.jwt_tokens import AccessContext

from workplace_gateway.config import GatewaySettings

QUEUE_LIMIT = 128
SEEN_LIMIT = 256
HEARTBEAT_SECONDS = 15
BOOKING_OPERATIONS = frozenset(
    {"created", "updated", "cancelled", "ended", "review_required", "user_access_revoked"}
)
_EVENT_ID = re.compile(r"[A-Za-z0-9_.:-]{1,160}\Z")


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class PublicEvent:
    name: str
    data: dict[str, str | int | bool | None]
    event_id: str | None = None
    terminal: bool = False

    def encode(self) -> bytes:
        lines = [f"id: {self.event_id}"] if self.event_id is not None else []
        lines.append(f"event: {self.name}")
        lines.append("data: " + json.dumps(self.data, ensure_ascii=False, separators=(",", ":")))
        return ("\n".join(lines) + "\n\n").encode()


def _identifier(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() and len(value) <= 1000 else None


def _revision(data: Mapping[str, object]) -> str | int | None:
    for field in ("revision", "version", "updated_at"):
        value = data.get(field)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
        if isinstance(value, str) and value.strip() and len(value) <= 128:
            return value
    return None


def public_event(subject: str, raw: bytes, current: AccessContext) -> PublicEvent | None:
    """Parse only known envelopes and project explicit fields within JWT-granted scope."""
    if subject not in {
        "workplace.booking.booking_changed",
        "workplace.booking.office_changed",
        "workplace.assistant.dialog.changed",
    }:
        return None
    try:
        parsed: object = json.loads(raw)
    except (UnicodeDecodeError, ValueError, TypeError, RecursionError):
        return None
    if not isinstance(parsed, dict):
        return None
    envelope: dict[str, object] = parsed
    if envelope.get("subject") != subject:
        return None
    event_id = envelope.get("id")
    payload = envelope.get("data")
    if not isinstance(event_id, str) or not _EVENT_ID.fullmatch(event_id):
        return None
    if not isinstance(payload, dict):
        return None
    data: dict[str, object] = payload

    revision = _revision(data)
    if subject == "workplace.assistant.dialog.changed":
        if data.get("user_id") != current.user.id:
            return None
        session_id = _identifier(data.get("session_id"))
        archived = data.get("archived_session_id")
        archive_only = (
            "session_id" in data
            and data["session_id"] is None
            and _identifier(archived) is not None
        )
        if session_id is None and not archive_only:
            return None
        result: dict[str, str | int | bool | None] = {"sessionId": session_id}
        if "archived_session_id" in data:
            raw_archived = data["archived_session_id"]
            archived_id = _identifier(raw_archived)
            if raw_archived is not None and archived_id is None:
                return None
            result["archivedSessionId"] = archived_id
        if revision is not None:
            result["revision"] = revision
        return PublicEvent("chat.changed", result, event_id)

    office_id = _identifier(data.get("office_id"))
    building_id = _identifier(data.get("building_id"))
    if office_id and building_id and office_id != building_id:
        return None
    office_id = office_id or building_id
    if office_id is None:
        return None
    if current.user.role != "admin" and office_id not in current.user.building_ids:
        return None

    if subject == "workplace.booking.office_changed":
        result = {"officeId": office_id}
        if revision is not None:
            result["revision"] = revision
        return PublicEvent("office.changed", result, event_id)

    booking_id = _identifier(data.get("booking_id"))
    operation = data.get("operation")
    if (
        booking_id is None
        or revision is None
        or not isinstance(operation, str)
        or operation not in BOOKING_OPERATIONS
    ):
        return None
    return PublicEvent(
        "booking.changed",
        {
            "officeId": office_id,
            "bookingId": booking_id,
            "revision": revision,
            "operation": operation,
        },
        event_id,
    )


class EventBridge:
    def __init__(
        self, current: AccessContext, client: NATSClient, *, queue_limit: int = QUEUE_LIMIT
    ) -> None:
        if queue_limit < 1:
            raise ValueError("The event queue must be bounded")
        self.current = current
        self.client = client
        self.subscription: Subscription | None = None
        self.queue: asyncio.Queue[PublicEvent] = asyncio.Queue(maxsize=queue_limit)
        self.closed = False
        self.failed = False
        self._seen: set[str] = set()
        self._seen_order: deque[str] = deque()

    def require_snapshot(self) -> None:
        if self.closed or self.failed:
            return
        self.failed = True
        while not self.queue.empty():
            self.queue.get_nowait()
        # A lost event is an explicit stream boundary, never a silent dropped update.
        self.queue.put_nowait(PublicEvent("resync", {"snapshotRequired": True}, terminal=True))

    async def on_disconnect(self) -> None:
        self.require_snapshot()

    async def on_error(self, error: Exception) -> None:
        self.require_snapshot()

    async def receive(self, message: Msg) -> None:
        if self.closed or self.failed:
            return
        event = public_event(message.subject, message.data, self.current)
        if event is None or event.event_id in self._seen:
            return
        if self.queue.full():
            self.require_snapshot()
            return
        if event.event_id is not None:
            self._seen.add(event.event_id)
            self._seen_order.append(event.event_id)
            if len(self._seen_order) > SEEN_LIMIT:
                self._seen.discard(self._seen_order.popleft())
        self.queue.put_nowait(event)

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            if self.subscription is not None:
                try:
                    await self.subscription.unsubscribe()
                except Exception:
                    pass
        finally:
            try:
                await self.client.close()
            except Exception:
                pass

    async def stream(self, request: Request) -> AsyncIterator[bytes]:
        try:
            if await request.is_disconnected():
                return
            if utc_now() >= self.current.access_expires_at:
                yield PublicEvent("auth.expired", {"refreshRequired": True}, terminal=True).encode()
                return
            yield PublicEvent("ready", {"snapshotRequired": True}).encode()
            while True:
                if await request.is_disconnected():
                    return
                remaining = (self.current.access_expires_at - utc_now()).total_seconds()
                if remaining <= 0:
                    yield PublicEvent(
                        "auth.expired", {"refreshRequired": True}, terminal=True
                    ).encode()
                    return
                try:
                    event = await asyncio.wait_for(
                        self.queue.get(), timeout=min(HEARTBEAT_SECONDS, remaining)
                    )
                except TimeoutError:
                    if utc_now() < self.current.access_expires_at:
                        yield b": heartbeat\n\n"
                    continue
                # A queued event does not outlive the context that authorized this connection.
                if utc_now() >= self.current.access_expires_at:
                    yield PublicEvent(
                        "auth.expired", {"refreshRequired": True}, terminal=True
                    ).encode()
                    return
                yield event.encode()
                if event.terminal:
                    return
        finally:
            with anyio.CancelScope(shield=True):
                await self.close()


class EventStreamResponse(StreamingResponse):
    """Also release a prepared subscription if HTTP sending fails before iteration starts."""

    def __init__(self, bridge: EventBridge, request: Request) -> None:
        self.bridge = bridge
        super().__init__(
            bridge.stream(request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-store",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                await self.bridge.close()


def install_events(
    app: FastAPI,
    settings: GatewaySettings,
    authenticate: Callable[[Request], AccessContext],
) -> None:
    @app.get("/api/events", tags=["events"], response_class=StreamingResponse)
    async def events(request: Request) -> EventStreamResponse:
        current = authenticate(request)
        client = NATSClient()
        bridge = EventBridge(current, client)
        try:
            await client.connect(
                settings.nats_url,
                connect_timeout=2,
                max_reconnect_attempts=0,
                allow_reconnect=False,
                disconnected_cb=bridge.on_disconnect,
                closed_cb=bridge.on_disconnect,
                error_cb=bridge.on_error,
            )
            bridge.subscription = await client.subscribe(
                "workplace.>",
                cb=bridge.receive,
                pending_msgs_limit=QUEUE_LIMIT,
                pending_bytes_limit=2 * 1024 * 1024,
            )
            # Establish the subscription before the browser fetches its initial snapshot.
            await client.flush(timeout=2)
            if bridge.failed:
                raise RuntimeError("Event broker disconnected during setup")
        except asyncio.CancelledError:
            with anyio.CancelScope(shield=True):
                await bridge.close()
            raise
        except Exception as exc:
            await bridge.close()
            raise HTTPException(503, detail={"code": "events_unavailable"}) from exc
        return EventStreamResponse(bridge, request)
