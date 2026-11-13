import json
from uuid import uuid4

from workplace_assistant import generation_worker
from workplace_assistant.generation_routes import dialogue_event
from workplace_assistant.models import ChatSession
from workplace_platform.correlation import event_metadata, request_id, trace_id


async def test_durable_worker_restores_correlation_for_rpc_and_resets_it_after_ack(monkeypatch):
    seen = []

    async def process(sessions, generation_id, settings):
        seen.append(event_metadata())

    monkeypatch.setattr(generation_worker, "process_generation", process)

    class Message:
        subject = generation_worker.SUBJECT
        data = json.dumps(
            {
                "subject": subject,
                "data": {
                    "request_id": str(uuid4()),
                    "origin_request_id": "web-attempt-1",
                    "trace_id": "booking-trace-1",
                },
            }
        ).encode()
        acknowledged = False

        async def ack_sync(self, **kwargs):
            self.acknowledged = True

        async def nak(self, delay):
            raise AssertionError("Valid generation must be acknowledged")

    message = Message()
    assert await generation_worker.consume_message(message, None, None)
    assert seen == [{"request_id": "web-attempt-1", "trace_id": "booking-trace-1"}]
    assert message.acknowledged
    assert event_metadata() == {}


def test_dialogue_event_keeps_generation_id_separate_from_transport_attempt():
    stored = []

    class Database:
        def add(self, event):
            stored.append(event)

    first = request_id.set("http-attempt-1")
    second = trace_id.set("trace-1")
    try:
        generation = uuid4()
        dialogue_event(
            Database(), ChatSession(id=uuid4(), user_id=uuid4(), version=2), generation, "queued"
        )
    finally:
        request_id.reset(first)
        trace_id.reset(second)
    assert stored[0].payload["request_id"] == str(generation)
    assert stored[0].payload["origin_request_id"] == "http-attempt-1"
    assert stored[0].payload["trace_id"] == "trace-1"
