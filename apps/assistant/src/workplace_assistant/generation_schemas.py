from datetime import date as Date
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class GenerationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    officeId: str = Field(min_length=1, max_length=1000)
    floorId: str | None = Field(default=None, min_length=1, max_length=1000)
    date: Date | None = None


class MessageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=32000)
    context: GenerationContext

    @field_validator("message")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message must not be blank")
        return value


class BookingProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    officeId: str = Field(min_length=1, max_length=1000)
    floorId: str = Field(min_length=1, max_length=1000)
    resourceId: str = Field(min_length=1, max_length=1000)
    date: Date | None = None
    start: StrictInt | None = Field(default=None, ge=0, lt=1440)
    end: StrictInt | None = Field(default=None, gt=0, le=1440)
    participants: StrictInt | None = Field(default=None, gt=0)
    url: str | None = Field(default=None, max_length=12000)


class StructuredReply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=32000)
    proposal: BookingProposal | None = None


class GenerationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    status: Literal["pending", "running", "completed", "failed"]
    result: StructuredReply | None
    error_code: str | None
    created_at: datetime
    updated_at: datetime
