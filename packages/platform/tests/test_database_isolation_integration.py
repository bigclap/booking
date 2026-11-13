import os

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.integration
async def test_service_role_cannot_connect_to_another_services_database():
    own_url = os.getenv("TEST_BOOKING_DATABASE_URL")
    if not own_url:
        pytest.skip("Use make test with disposable PostgreSQL")
    forbidden_url = make_url(own_url).set(database="users")
    engine = create_async_engine(forbidden_url)
    try:
        with pytest.raises(DBAPIError, match="permission denied for database"):
            async with engine.connect():
                pytest.fail("Booking role connected to Users storage")
    finally:
        await engine.dispose()
