from datetime import datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


class WorkingHoursView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    weekday: int
    start_time: time
    end_time: time


class BuildingView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    address: str | None
    working_hours: list[WorkingHoursView]


class FloorView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    building_id: str
    name: str
    position: int


class ResourceView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    floor_id: str
    parent_room_id: str | None
    kind: Literal["workstation", "meeting_room"]
    name: str
    shared_booking: bool
    capacity: int = 0
    equipment: list[dict] = Field(default_factory=list)


DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


class DayHours(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: StrictBool
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @model_validator(mode="after")
    def ordered_working_day(self):
        if self.enabled and self.start >= self.end:
            raise ValueError("Working day must end after it starts")
        return self


class OfficeCreateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    address: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def normalized_names(self):
        self.name = self.name.strip()
        self.address = self.address.strip() or None if self.address is not None else None
        if not self.name:
            raise ValueError("Office name is required")
        return self


class OfficeSettingsInput(OfficeCreateInput):
    expected_revision: int = Field(ge=1)
    hours_document: dict[str, DayHours]

    @model_validator(mode="after")
    def known_weekdays(self):
        if not set(self.hours_document) <= set(DAYS):
            raise ValueError("Office hours contain an unknown weekday")
        return self


class OfficePlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    floors: list[dict[str, Any]] = Field(min_length=1, max_length=40)


class OfficeImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: dict[str, Any]
    expected_revision: int | None = Field(default=None, ge=1)


class OfficeFloorDocument(BaseModel):
    id: str
    name: str
    position: int
    plan_document: dict[str, Any] | None


class OfficeDocument(BaseModel):
    id: str
    name: str
    address: str | None
    revision: int
    updated_at: datetime
    hours_document: dict[str, Any] | None
    floors: list[OfficeFloorDocument]
