"""OAuth grants owned by Users; raw opaque credentials are never persisted."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from workplace_platform.typing import JsonObject

from workplace_users.models import Base


class MCPClient(Base):
    __tablename__ = "mcp_clients"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    metadata_document: Mapped[JsonObject] = mapped_column(JSONB)
    secret_ciphertext: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MCPAuthorizationRequest(Base):
    __tablename__ = "mcp_authorization_requests"

    handle_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("mcp_clients.id"))
    parameters: Mapped[JsonObject] = mapped_column(JSONB)
    csrf_hash: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MCPAuthorizationCode(Base):
    __tablename__ = "mcp_authorization_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("mcp_clients.id"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[UUID] = mapped_column(ForeignKey("sessions.id"))
    parameters: Mapped[JsonObject] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MCPToken(Base):
    __tablename__ = "mcp_tokens"
    __table_args__ = (CheckConstraint("kind IN ('access', 'refresh')", name="mcp_token_kind"),)

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    client_id: Mapped[str] = mapped_column(String(160))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("sessions.id"), index=True)
    family_id: Mapped[UUID] = mapped_column(index=True)
    resource: Mapped[str] = mapped_column(Text)
    scopes: Mapped[list[str]] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
