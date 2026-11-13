from datetime import date as Date
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator


class CreateBookingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    floor_id: str = Field(min_length=1, max_length=1000)
    resource_id: str = Field(min_length=1, max_length=1000)
    date: Date
    start: StrictInt = Field(ge=0, lt=1440)
    end: StrictInt = Field(gt=0, le=1440)
    owner_id: str = Field(min_length=1, max_length=1000)
    participants: StrictInt | None = Field(default=None, gt=0)
    # Trusted command mode assigned by Gateway, never a role or client-supplied claim.
    administrative: StrictBool = False


class UpdateBookingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: StrictInt = Field(gt=0)
    floor_id: str | None = Field(default=None, min_length=1, max_length=1000)
    resource_id: str | None = Field(default=None, min_length=1, max_length=1000)
    date: Date | None = None
    start: StrictInt | None = Field(default=None, ge=0, lt=1440)
    end: StrictInt | None = Field(default=None, gt=0, le=1440)
    owner_id: str | None = Field(default=None, min_length=1, max_length=1000)
    participants: StrictInt | None = Field(default=None, gt=0)
    administrative: StrictBool = False

    @model_validator(mode="after")
    def no_null_required_values(self):
        for field in self.model_fields_set - {"participants"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class CancelBookingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: StrictInt = Field(gt=0)
    administrative: StrictBool = False


class BookingView(BaseModel):
    id: str
    building_id: str
    floor_id: str
    resource_id: str
    date: Date
    start: int | float
    end: int | float
    owner_id: str
    participants: int | None
    status: Literal["active", "cancelled"]
    needs_review: bool
    review_reasons: list[str] = Field(default_factory=list)
    resource_snapshot: dict = Field(default_factory=dict)
    cancellation_reason: str | None = None
    warnings: list[dict] = Field(default_factory=list)
    revision: int
    starts_at: datetime
    ends_at: datetime
    scheduled_ends_at: datetime
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AvailabilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    floor_id: str = Field(min_length=1, max_length=1000)
    date: Date
    start: StrictInt = Field(ge=0, lt=1440)
    end: StrictInt = Field(gt=0, le=1440)
    cursor: StrictInt | None = Field(default=None, ge=0, lt=1440)
    resource_id: str | None = Field(default=None, min_length=1, max_length=1000)
    exclude_booking_id: str | None = Field(default=None, min_length=1, max_length=1000)
