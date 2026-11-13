from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from workplace_platform.typing import JsonObject

from workplace_assistant.generation_schemas import GenerationView


class SessionView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: datetime
    archived_at: datetime | None
    archive_reason: str | None
    version: int
    in_flight_request_id: UUID | None


class MessageView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int
    role: str
    content: str
    created_at: datetime
    proposal: JsonObject | None = None


class DialogueView(BaseModel):
    session: SessionView | None
    messages: list[MessageView]
    request: GenerationView | None = None
    processing: GenerationView | None = None
