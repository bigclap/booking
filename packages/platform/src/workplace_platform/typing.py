"""Shared JSON values and SQLAlchemy session dependencies at service boundaries."""

from collections.abc import AsyncIterator, Callable

from fastapi import Request
from pydantic import JsonValue as JsonValue
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

type JsonObject = dict[str, JsonValue]
type SessionFactory = async_sessionmaker[AsyncSession]
type SessionDependency = (
    Callable[[], AsyncIterator[AsyncSession]] | Callable[[Request], AsyncIterator[AsyncSession]]
)
