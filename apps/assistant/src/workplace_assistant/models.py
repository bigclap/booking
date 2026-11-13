from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from workplace_platform.outbox import OutboxMixin


class Base(DeclarativeBase):
    pass


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index(
            "uq_chat_sessions_active_owner",
            "user_id",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index("ix_chat_sessions_owner_created", "user_id", "created_at"),
        CheckConstraint("version > 0", name="ck_chat_sessions_version_positive"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    # Cross-service identity is a reference, never an FK into Users' database.
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archive_reason: Mapped[str | None] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(BigInteger, server_default="1")
    # Future generation must acquire this slot atomically. An archived dialogue
    # keeps its slot/request identity, so a late reply cannot enter a new one.
    in_flight_request_id: Mapped[UUID | None] = mapped_column()


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_session_position", "session_id", "position"),
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chat_messages_role"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False)
    position: Mapped[int] = mapped_column(BigInteger, Identity(), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    request_id: Mapped[UUID | None] = mapped_column()
    proposal: Mapped[dict | None] = mapped_column(JSONB)


class OutboxEvent(OutboxMixin, Base):
    __tablename__ = "outbox_events"
