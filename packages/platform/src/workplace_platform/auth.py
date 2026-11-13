import base64
import binascii
import secrets
from typing import Literal, cast

from fastapi import HTTPException, Request
from pydantic import BaseModel, ValidationError

from workplace_platform.config import ServiceSettings


class Actor(BaseModel):
    user_id: str
    session_id: str
    role: Literal["employee", "admin"]
    building_ids: list[str]
    first_name: str
    last_name: str


def require_internal_key(request: Request) -> None:
    supplied = request.headers.get("x-internal-key", "")
    settings = cast(ServiceSettings, request.app.state.settings)
    expected = settings.internal_api_key.get_secret_value()
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(401, detail={"code": "internal_auth_required"})


async def require_actor(request: Request) -> Actor:
    # Internal services trust only a Gateway-authenticated context on the private channel.
    require_internal_key(request)
    try:
        encoded = request.headers["x-actor-context"]
        return Actor.model_validate_json(base64.urlsafe_b64decode(encoded))
    except (KeyError, ValueError, binascii.Error, ValidationError) as exc:
        raise HTTPException(401, detail={"code": "internal_context_required"}) from exc


def encode_actor(actor: Actor) -> str:
    return base64.urlsafe_b64encode(actor.model_dump_json().encode()).decode("ascii")
