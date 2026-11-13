"""Booking-owned records; identity and rights stay in Gateway/Users."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from workplace_booking.models import Base


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'cancelled')", name="booking_status"),
        CheckConstraint("starts_at < ends_at", name="booking_time_order"),
        CheckConstraint("participants IS NULL OR participants > 0", name="booking_participants"),
        CheckConstraint("revision > 0", name="booking_revision"),
    )

    id: Mapped[str] = mapped_column(
        String(1000), primary_key=True, default=lambda: f"booking-{uuid4()}"
    )
    building_id: Mapped[str] = mapped_column(ForeignKey("buildings.id"), index=True)
    floor_id: Mapped[str] = mapped_column(ForeignKey("floors.id"), index=True)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resources.id"), index=True)
    ancestor_ids: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    owner_id: Mapped[str] = mapped_column(String(1000), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    scheduled_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    participants: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    needs_review: Mapped[bool] = mapped_column(default=False, server_default="false")
    review_reasons: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    resource_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    cancellation_reason: Mapped[str | None] = mapped_column(String(160))
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BookingConfirmation(Base):
    __tablename__ = "booking_confirmations"

    actor_id: Mapped[str] = mapped_column(String(1000), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BookingMutation(Base):
    """Append-only domain history; snapshots survive plan removals and resource renames."""

    __tablename__ = "booking_mutations"
    __table_args__ = (UniqueConstraint("booking_id", "revision", name="booking_mutation_revision"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    operation: Mapped[str] = mapped_column(String(64))
    snapshot: Mapped[dict] = mapped_column(JSONB)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
