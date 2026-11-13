"""Durable receipt for at-least-once delivery; contains no user-state projection."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from workplace_booking.models import Base


class InboxEvent(Base):
    __tablename__ = "inbox_events"

    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
