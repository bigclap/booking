"""Service-local outbox table and a JetStream publisher, run as a separate container.

No domain event is acknowledged as applied by a downstream service here.
The publisher only records the broker's durable publication acknowledgement.
"""

import asyncio
import json
import logging
import signal
from datetime import datetime
from typing import TypedDict, cast
from uuid import UUID, uuid4

import nats
from nats.js.api import StorageType, StreamConfig
from nats.js.client import JetStreamContext
from nats.js.errors import NotFoundError
from sqlalchemy import DateTime, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import Mapped, mapped_column

from workplace_platform.config import ServiceSettings
from workplace_platform.typing import JsonObject

STREAM = "WORKPLACE_EVENTS"


class OutboxMixin:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    subject: Mapped[str] = mapped_column(String(255))
    payload: Mapped[JsonObject] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)


class OutboxRecord(TypedDict):
    id: UUID
    subject: str
    payload: JsonObject
    created_at: datetime


async def ensure_stream(js: JetStreamContext) -> None:
    try:
        await js.stream_info(STREAM)
    except NotFoundError:
        await js.add_stream(
            config=StreamConfig(
                name=STREAM,
                subjects=["workplace.>"],
                storage=StorageType.FILE,
                duplicate_window=120,
            )
        )


async def publish_batch(engine: AsyncEngine, js: JetStreamContext, limit: int = 50) -> int:
    """Hold row locks through the ack; duplicate publication after a crash remains safe."""
    published = 0
    async with engine.begin() as connection:
        result = await connection.execute(
            text(
                "SELECT id, subject, payload, created_at FROM outbox_events "
                "WHERE published_at IS NULL ORDER BY created_at, id "
                "LIMIT :limit FOR UPDATE SKIP LOCKED"
            ),
            {"limit": limit},
        )
        for row in result.mappings():
            # The fixed SELECT above reads columns from the service's own outbox schema.
            record = cast(OutboxRecord, row)
            envelope: JsonObject = {
                "version": 1,
                "id": str(record["id"]),
                "subject": record["subject"],
                "occurred_at": record["created_at"].isoformat(),
                "data": record["payload"],
                **{
                    key: record["payload"][key]
                    for key in ("request_id", "trace_id")
                    if key in record["payload"]
                },
            }
            try:
                await js.publish(
                    record["subject"],
                    json.dumps(envelope).encode(),
                    headers={"Nats-Msg-Id": str(record["id"])},
                    timeout=3,
                )
            except Exception as exc:
                await connection.execute(
                    text(
                        "UPDATE outbox_events SET attempts=attempts+1, last_error=:error "
                        "WHERE id=:id"
                    ),
                    {"id": record["id"], "error": type(exc).__name__},
                )
                break
            await connection.execute(
                text(
                    "UPDATE outbox_events SET published_at=now(), attempts=attempts+1, "
                    "last_error=NULL WHERE id=:id"
                ),
                {"id": record["id"]},
            )
            published += 1
    return published


async def run() -> None:
    settings = ServiceSettings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for an outbox worker")
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    client = None
    try:
        client = await nats.connect(settings.nats_url, max_reconnect_attempts=-1)
        js = client.jetstream()
        await ensure_stream(js)
        while not stop.is_set():
            try:
                count = await publish_batch(engine, js)
            except Exception as exc:
                logging.getLogger(__name__).warning("outbox retry: %s", type(exc).__name__)
                count = 0
            if not count:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=1)
                except TimeoutError:
                    pass
    finally:
        if client is not None:
            await client.close()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
