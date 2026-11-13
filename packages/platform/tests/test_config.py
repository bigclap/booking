import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url
from workplace_platform.config import ServiceSettings


def test_database_password_is_encoded_for_dsn():
    secret = "pass@word/with%reserved:characters"
    settings = ServiceSettings(
        internal_api_key="test-internal-key-with-enough-entropy",
        database_url="postgresql+asyncpg://workplace_users@postgres:5432/users",
        database_password=secret,
    )
    assert make_url(settings.database_url).password == secret


@pytest.mark.parametrize(
    "url", ["http://booking:8000/prefix", "http://booking:8000/?key=x", "file:///internal"]
)
def test_private_rpc_endpoint_must_be_an_origin(url):
    with pytest.raises(ValidationError):
        ServiceSettings(internal_api_key="test-internal-key-with-enough-entropy", booking_url=url)
