from collections.abc import AsyncIterator
from typing import cast

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from workplace_platform.typing import SessionFactory


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    sessions = cast(SessionFactory, request.app.state.db_sessions)
    async with sessions() as session:
        yield session
