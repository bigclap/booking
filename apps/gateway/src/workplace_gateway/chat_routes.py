from datetime import date as Date
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from workplace_gateway.revisions import idempotency_key


class ChatContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    officeId: str = Field(min_length=1, max_length=1000)
    floorId: str | None = Field(default=None, min_length=1, max_length=1000)
    date: Date | None = None


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=8000)
    context: ChatContext


def install_chat_commands(app, settings, authenticate, building_access, call):
    @app.post("/api/chats/{chat_id}/messages", status_code=202, tags=["assistant"])
    async def send(chat_id: UUID, payload: ChatMessage, request: Request):
        current = authenticate(request)
        building_access(current, payload.context.officeId)
        if not payload.message.strip():
            raise HTTPException(422, detail={"code": "validation_error"})
        # Resolve the office on the same authorized boundary before enqueueing context.
        office = await call(
            request,
            settings.booking_url,
            f"/internal/offices/{quote(payload.context.officeId, safe='')}",
            current=current,
        )
        if payload.context.floorId is not None and not any(
            floor["id"] == payload.context.floorId for floor in office["floors"]
        ):
            raise HTTPException(404, detail={"code": "floor_not_found"})
        result = await call(
            request,
            settings.assistant_url,
            f"/internal/chats/{chat_id}/messages",
            method="POST",
            current=current,
            payload=payload.model_dump(mode="json", exclude_none=True),
            extra_headers={"Idempotency-Key": idempotency_key(request)},
        )
        return JSONResponse(result, status_code=202)

    @app.get("/api/generations/{generation_id}", tags=["assistant"])
    async def status(generation_id: UUID, request: Request):
        return await call(
            request,
            settings.assistant_url,
            f"/internal/generations/{generation_id}",
            current=authenticate(request),
        )
