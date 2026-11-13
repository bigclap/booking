import os
import subprocess

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from workplace_booking.config import BookingSettings
from workplace_booking.main import build_app, get_session

KEY = "test-key-at-least-24-characters"


@pytest.fixture(scope="session")
def migrated_booking_database():
    url = os.environ.get("TEST_BOOKING_DATABASE_URL")
    if not url:
        pytest.skip("Requires isolated TEST_BOOKING_DATABASE_URL")
    subprocess.run(
        ["alembic", "-c", "apps/booking/alembic.ini", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    return url


@pytest.fixture
async def booking_client(migrated_booking_database):
    engine = create_async_engine(migrated_booking_database)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    app = build_app(BookingSettings(internal_api_key=KEY))

    async def database_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = database_session
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://booking",
            headers={"X-Internal-Key": KEY},
        ) as client:
            yield client, factory
    finally:
        await engine.dispose()
