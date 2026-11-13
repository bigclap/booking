"""Durable outcomes of Users' access revocation commands, queried by Gateway admin UI."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from workplace_platform.auth import require_internal_key

from workplace_users.models import AccessOperation, OutboxEvent


async def database(request: Request):
    async with request.app.state.sessions() as session:
        yield session


Database = Annotated[object, Depends(database)]
router = APIRouter(
    prefix="/internal/access-operations", dependencies=[Depends(require_internal_key)]
)


async def view(db, operation):
    publication = await db.scalar(
        select(OutboxEvent)
        .where(OutboxEvent.payload["operation_id"].as_string() == str(operation.id))
        .order_by(OutboxEvent.created_at, OutboxEvent.id)
        .limit(1)
    )
    return {
        "id": str(operation.id),
        "user_id": str(operation.user_id),
        "reason": operation.reason,
        "scope": operation.scope,
        "correlation_id": operation.correlation_id,
        "status": operation.status,
        "created_at": operation.created_at,
        "completed_at": operation.completed_at,
        "cancelled_count": operation.cancelled_count,
        "terminated_count": operation.terminated_count,
        "publication": {
            "published_at": publication.published_at,
            "attempts": publication.attempts,
            "last_error": publication.last_error,
        }
        if publication is not None
        else None,
    }


@router.get("")
async def list_operations(
    db: Database,
    user_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    statement = select(AccessOperation).order_by(
        AccessOperation.created_at.desc(), AccessOperation.id.desc()
    )
    if user_id is not None:
        statement = statement.where(AccessOperation.user_id == user_id)
    rows = (await db.scalars(statement.limit(limit))).all()
    return [await view(db, operation) for operation in rows]


@router.get("/{operation_id}")
async def get_operation(operation_id: UUID, db: Database):
    operation = await db.get(AccessOperation, operation_id)
    if operation is None:
        raise HTTPException(404, detail={"code": "access_operation_not_found"})
    return await view(db, operation)
