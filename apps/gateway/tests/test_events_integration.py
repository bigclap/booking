import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import nats
import pytest
from fastapi import FastAPI
from workplace_gateway.events import install_events
from workplace_platform.jwt_tokens import AccessContext, TokenUser
from workplace_platform.outbox import ensure_stream


class ConnectedRequest:
    async def is_disconnected(self):
        return False


@pytest.mark.integration
async def test_jetstream_publication_reaches_live_sse_without_replaying_history():
    url = os.getenv("NATS_URL")
    if not url:
        pytest.skip("Use the disposable NATS service in make test")
    office_id = "office-sse-" + uuid4().hex
    current = AccessContext(
        user=TokenUser(
            id="user-sse",
            login="sse-test",
            first_name="SSE",
            last_name="Test",
            role="employee",
            active=True,
            building_ids=[office_id],
            created_at=datetime.now(UTC),
        ),
        session_id="session-sse",
        session_expires_at=None,
        access_expires_at=datetime.now(UTC) + timedelta(seconds=10),
    )
    publisher = await nats.connect(url)
    stream = None
    try:
        js = publisher.jetstream()
        await ensure_stream(js)
        subject = "workplace.booking.office_changed"

        async def publish(event_id):
            await js.publish(
                subject,
                json.dumps(
                    {
                        "id": event_id,
                        "subject": subject,
                        "data": {"office_id": office_id, "revision": 1},
                    }
                ).encode(),
            )

        await publish("old-" + uuid4().hex)
        app = FastAPI()
        install_events(app, SimpleNamespace(nats_url=url), lambda request: current)
        response = await app.routes[-1].endpoint(ConnectedRequest())
        stream = response.body_iterator
        assert b"event: ready\n" in await anext(stream)
        event_id = "fresh-" + uuid4().hex
        await publish(event_id)
        received = await asyncio.wait_for(anext(stream), timeout=5)
        assert f"id: {event_id}\n".encode() in received
        assert b"event: office.changed\n" in received
        assert office_id.encode() in received
    finally:
        if stream is not None:
            await stream.aclose()
        await publisher.close()
