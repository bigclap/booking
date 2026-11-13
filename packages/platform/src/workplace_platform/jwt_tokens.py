"""Short web access tokens. These are not MCP OAuth credentials."""

from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

import jwt
from pydantic import BaseModel

from workplace_platform.auth import Actor
from workplace_platform.config import ServiceSettings

ACCESS_TTL_SECONDS = 120


class TokenUser(BaseModel):
    id: str
    login: str
    first_name: str
    last_name: str
    role: Literal["employee", "admin"]
    active: bool
    building_ids: list[str]
    created_at: datetime


class AccessContext(BaseModel):
    user: TokenUser
    session_id: str
    session_expires_at: datetime | None
    access_expires_at: datetime

    def actor(self) -> Actor:
        return Actor(
            user_id=self.user.id,
            session_id=self.session_id,
            role=self.user.role,
            building_ids=self.user.building_ids,
            first_name=self.user.first_name,
            last_name=self.user.last_name,
        )


def signing_key(settings: ServiceSettings) -> str:
    if settings.web_jwt_secret is None:
        raise RuntimeError("WEB_JWT_SECRET is required by Users and Gateway")
    return settings.web_jwt_secret.get_secret_value()


def issue_access(
    user_dict: dict,
    session_id: str,
    refresh_expires_at: datetime | None,
    settings: ServiceSettings,
) -> tuple[str, datetime]:
    user = TokenUser.model_validate(user_dict)
    now = datetime.now(UTC)
    deadline = now + timedelta(seconds=ACCESS_TTL_SECONDS)
    if refresh_expires_at is not None:
        deadline = min(deadline, refresh_expires_at)
    token = jwt.encode(
        {
            "iss": settings.web_jwt_issuer,
            "aud": settings.web_jwt_audience,
            "sub": user.id,
            "sid": session_id,
            "iat": now,
            "nbf": now,
            "exp": deadline,
            "jti": str(uuid4()),
            "session_exp": int(refresh_expires_at.timestamp()) if refresh_expires_at else None,
            "user": user.model_dump(mode="json"),
        },
        signing_key(settings),
        algorithm="HS256",
        headers={"typ": "at+jwt"},
    )
    return token, deadline


def decode_access(token: str, settings: ServiceSettings) -> AccessContext:
    payload = jwt.decode(
        token,
        signing_key(settings),
        algorithms=["HS256"],
        issuer=settings.web_jwt_issuer,
        audience=settings.web_jwt_audience,
        options={"require": ["exp", "iat", "nbf", "iss", "aud", "sub", "sid"]},
    )
    user = TokenUser.model_validate(payload["user"])
    if payload["sub"] != user.id or not user.active or "session_exp" not in payload:
        raise jwt.InvalidTokenError("Invalid subject")
    return AccessContext(
        user=user,
        session_id=payload["sid"],
        session_expires_at=datetime.fromtimestamp(payload["session_exp"], UTC)
        if payload["session_exp"] is not None
        else None,
        access_expires_at=datetime.fromtimestamp(payload["exp"], UTC),
    )
