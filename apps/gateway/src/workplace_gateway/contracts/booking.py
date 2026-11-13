from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator
from pydantic.alias_generators import to_camel


class BookingPolicy(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    timezone: str
    step_minutes: int
    horizon_days: int
    server_now: datetime
    earliest_start: datetime
    allowed_dates: list[date]


class ClientBooking(BaseModel):
    """The React shape for the next booking layer, not a writable list of all records."""

    model_config = ConfigDict(alias_generator=to_camel, extra="forbid", strict=True)
    id: str
    building_id: str
    floor_id: str
    resource_id: str
    date: str
    start: int | float = Field(ge=0, lt=1440)
    end: int | float = Field(gt=0, le=1440)
    owner_id: str
    owner_name: str
    participants: int | None = Field(default=None, ge=1)
    status: Literal["active", "cancelled"]
    revision: int = Field(ge=1)
    needs_review: bool
    review_reasons: list[str] = Field(default_factory=list)
    resource_snapshot: dict = Field(default_factory=dict)
    cancellation_reason: str | None = None
    warnings: list[dict] = Field(default_factory=list)
    starts_at: str | None = None
    ends_at: str | None = None
    scheduled_ends_at: str | None = None
    cancelled_at: str | None = None

    @model_validator(mode="after")
    def valid_range(self):
        date.fromisoformat(self.date)
        if self.start >= self.end:
            raise ValueError("Окончание должно быть позже начала")
        return self


class BookingCreate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid", strict=True)
    floor_id: str = Field(min_length=1, max_length=1000)
    resource_id: str = Field(min_length=1, max_length=1000)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start: StrictInt = Field(ge=0, lt=1440)
    end: StrictInt = Field(gt=0, le=1440)
    participants: StrictInt | None = Field(default=None, ge=1)
    owner_id: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid_date_and_order(self):
        date.fromisoformat(self.date)
        if self.start >= self.end:
            raise ValueError("Окончание должно быть позже начала")
        return self


class BookingUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid", strict=True)
    floor_id: str | None = Field(default=None, min_length=1, max_length=1000)
    resource_id: str | None = Field(default=None, min_length=1, max_length=1000)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    start: StrictInt | None = Field(default=None, ge=0, lt=1440)
    end: StrictInt | None = Field(default=None, gt=0, le=1440)
    participants: StrictInt | None = Field(default=None, ge=1)
    owner_id: str | None = Field(default=None, min_length=1, max_length=1000)
    revision: StrictInt | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def required_fields_not_null(self):
        for field in self.model_fields_set - {"participants"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        if self.date is not None:
            date.fromisoformat(self.date)
        if self.start is not None and self.end is not None and self.start >= self.end:
            raise ValueError("Окончание должно быть позже начала")
        return self


class BookingCancel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: StrictInt | None = Field(default=None, ge=1)
