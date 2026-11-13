"""Durable generation requests; neither delegated MCP tokens nor provider secrets are stored."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from workplace_assistant.models import Base


class GenerationRequest(Base):
    __tablename__ = "generation_requests"
    __table_args__ = (
        UniqueConstraint("actor_id", "idempotency_key", name="uq_generation_actor_key"),
        CheckConstraint(
            "status IN ('pending','running','completed','failed')", name="generation_status"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    actor_id: Mapped[UUID] = mapped_column(index=True)
    gateway_session_id: Mapped[UUID] = mapped_column()
    session_id: Mapped[UUID] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    user_message_id: Mapped[UUID] = mapped_column(ForeignKey("chat_messages.id"))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    fingerprint: Mapped[str] = mapped_column(String(64))
    context: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lease_token: Mapped[UUID | None] = mapped_column()
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    run_messages: Mapped[list | None] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
