"""Consumed service responses, independent of service application packages."""

from pydantic import BaseModel, ConfigDict


class SessionTokens(BaseModel):
    model_config = ConfigDict(strict=True)

    access_token: str
    access_expires_at: str
    token: str
    expires_at: str | None


class OfficeFloorResponse(BaseModel):
    plan_document: object = None


class OfficeResponse(BaseModel):
    id: str
    revision: int
    name: str
    address: str | None = None
    updated_at: str
    hours_document: object
    floors: list[OfficeFloorResponse]


class WorkingHoursResponse(BaseModel):
    weekday: int
    start_time: str | None
    end_time: str | None


class BuildingResponse(BaseModel):
    id: str
    name: str
    address: str | None
    working_hours: list[WorkingHoursResponse]


class AssistantCapabilities(BaseModel):
    runtime: str
    llm_configured: bool
    model: str | None
    generation_available: bool
