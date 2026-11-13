import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine
from workplace_booking import booking_models  # noqa: F401 - register booking metadata
from workplace_booking.config import BookingSettings
from workplace_booking.event_models import Base

config = context.config
target_metadata = Base.metadata


def database_url() -> str:
    url = BookingSettings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is required for migrations")
    return url


def run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def online():
    engine = create_async_engine(database_url(), poolclass=pool.NullPool)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
