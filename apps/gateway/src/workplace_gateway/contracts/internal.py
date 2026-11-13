"""Consumed fields of private RPC responses, independent of service internals."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class InternalBooking(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    building_id: str
    floor_id: str
    resource_id: str
    owner_id: str
    date: str
    start: int | float
    end: int | float
    participants: int | None
    status: Literal["active", "cancelled"]
    revision: int
    needs_review: bool
    review_reasons: list[str] = Field(default_factory=list)
    resource_snapshot: dict[str, JsonValue] = Field(default_factory=dict)
    cancellation_reason: str | None = None
    warnings: list[dict[str, JsonValue]] = Field(default_factory=list)
    starts_at: str | None = None
    ends_at: str | None = None
    scheduled_ends_at: str | None = None
    cancelled_at: str | None = None


class InternalOwner(BaseModel):
    model_config = ConfigDict(strict=True)

    active: bool
    role: Literal["employee", "admin"]
    building_ids: list[str]


class InternalProfile(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    first_name: str
    last_name: str


class InternalUser(InternalOwner):
    id: str | UUID
    login: str
    first_name: str
    last_name: str
    created_at: str | datetime


class InternalFloor(BaseModel):
    id: str


class InternalOfficeFloors(BaseModel):
    floors: list[InternalFloor]
