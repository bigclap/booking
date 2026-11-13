from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from workplace_assistant.models import ChatMessage, ChatSession, OutboxEvent


async def current_dialogue(db: AsyncSession, user_id: UUID) -> ChatSession | None:
    return await db.scalar(
        select(ChatSession).where(
            ChatSession.user_id == user_id,
            ChatSession.archived_at.is_(None),
        )
    )


async def messages_for(db: AsyncSession, session_id: UUID) -> list[ChatMessage]:
    return list(
        (
            await db.scalars(
                select(ChatMessage)
                .where(
                    ChatMessage.session_id == session_id,
                )
                .order_by(ChatMessage.position)
            )
        ).all()
    )


async def database_time(db: AsyncSession) -> datetime:
    timestamp = await db.scalar(select(func.clock_timestamp()))
    if not isinstance(timestamp, datetime):
        raise RuntimeError("Database clock did not return a timestamp")
    return timestamp


async def new_dialogue(db: AsyncSession, user_id: UUID) -> ChatSession:
    """Caller commits the dialogue change and its outbox event atomically.

    The transaction lock covers the empty-state race as well as an existing
    dialogue. The partial unique index is the final database guard.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"), {"owner": str(user_id)}
    )
    previous = await current_dialogue(db, user_id)
    if previous is not None:
        previous.archived_at = datetime.now(UTC)
        previous.archive_reason = "new_dialog"
        previous.version += 1
        await db.flush()
    # An old booking event may arrive after the owner starts a new dialogue.
    # Timestamp creation after the lock wait instead of using transaction-start now().
    created_at = await database_time(db)
    dialogue = ChatSession(id=uuid4(), user_id=user_id, created_at=created_at)
    db.add(dialogue)
    await db.flush()
    db.add(
        OutboxEvent(
            subject="workplace.assistant.dialog.changed",
            payload={
                "user_id": str(user_id),
                "session_id": str(dialogue.id),
                "archived_session_id": str(previous.id) if previous else None,
                "version": dialogue.version,
            },
        )
    )
    return dialogue
