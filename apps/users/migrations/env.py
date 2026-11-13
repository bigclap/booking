import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
from workplace_users import mcp_models  # noqa: F401 - include MCP tables in Alembic metadata
from workplace_users.config import UsersSettings
from workplace_users.models import Base


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


async def online():
    engine = create_async_engine(UsersSettings().database_url)
    async with engine.connect() as connection:
        await connection.run_sync(migrate)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(
        url=UsersSettings().database_url, target_metadata=Base.metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
