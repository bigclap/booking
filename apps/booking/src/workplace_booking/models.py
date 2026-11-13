from datetime import datetime, time
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Time, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from workplace_platform.outbox import OutboxMixin
from workplace_platform.typing import JsonObject

from workplace_booking.types import HoursDocument, ResourceKind


class Base(DeclarativeBase):
    pass


class OutboxEvent(OutboxMixin, Base):
    __tablename__ = "outbox_events"


class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[str] = mapped_column(String(1000), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160))
    address: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    hours_document: Mapped[HoursDocument | None] = mapped_column(JSONB)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OfficeImportReceipt(Base):
    __tablename__ = "office_import_receipts"

    actor_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    office_id: Mapped[str] = mapped_column(ForeignKey("buildings.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkingHours(Base):
    __tablename__ = "building_working_hours"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="working_hours_weekday"),
        CheckConstraint("start_time < end_time", name="working_hours_order"),
    )

    building_id: Mapped[str] = mapped_column(ForeignKey("buildings.id"), primary_key=True)
    weekday: Mapped[int] = mapped_column(Integer, primary_key=True)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


class Floor(Base):
    __tablename__ = "floors"

    id: Mapped[str] = mapped_column(String(1000), primary_key=True, default=lambda: str(uuid4()))
    building_id: Mapped[str] = mapped_column(ForeignKey("buildings.id"), index=True)
    name: Mapped[str] = mapped_column(String(1000))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Exact frontend Floor document, including geometry, background and extension fields.
    plan_document: Mapped[JsonObject | None] = mapped_column(JSONB)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Resource(Base):
    __tablename__ = "resources"
    __table_args__ = (
        CheckConstraint("kind IN ('workstation', 'meeting_room')", name="resource_kind"),
        CheckConstraint("parent_room_id IS NULL OR parent_room_id <> id", name="resource_parent"),
    )

    id: Mapped[str] = mapped_column(String(1000), primary_key=True, default=lambda: str(uuid4()))
    floor_id: Mapped[str] = mapped_column(ForeignKey("floors.id"), index=True)
    parent_room_id: Mapped[str | None] = mapped_column(ForeignKey("resources.id"), index=True)
    kind: Mapped[ResourceKind] = mapped_column(String(24))
    name: Mapped[str] = mapped_column(String(1000))
    shared_booking: Mapped[bool] = mapped_column(default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
