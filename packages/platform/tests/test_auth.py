from typing import Annotated

import httpx
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from workplace_platform.auth import Actor, encode_actor, require_actor
from workplace_platform.config import ServiceSettings
from workplace_platform.web import create_app

KEY = "test-internal-key-with-enough-entropy"
ACTOR = Actor(
    user_id="employee-1",
    session_id="session-1",
    role="employee",
    building_ids=["building-1"],
    first_name="Иван",
    last_name="Петров",
)


@pytest.fixture
def client():
    app = create_app("test", ServiceSettings(internal_api_key=KEY))

    @app.get("/protected")
    async def protected(actor: Annotated[Actor, Depends(require_actor)]):
        return actor

    with TestClient(app) as connection:
        yield connection, app


def test_public_identity_headers_are_not_accepted(client):
    connection, _ = client
    assert (
        connection.get(
            "/protected",
            headers={
                "X-User-ID": "admin",
                "X-Actor-Context": encode_actor(ACTOR),
            },
        ).status_code
        == 401
    )


@pytest.mark.parametrize("context", [None, "not-base64", "e30="])
def test_internal_identity_must_be_well_formed(client, context):
    connection, _ = client
    headers = {"X-Internal-Key": KEY}
    if context is not None:
        headers["X-Actor-Context"] = context
    assert connection.get("/protected", headers=headers).status_code == 401


def test_trusted_gateway_context_needs_no_users_call(client):
    connection, app = client

    def no_call(request):
        pytest.fail("Internal identity must not query Users")

    app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(no_call))
    response = connection.get(
        "/protected",
        headers={
            "X-Internal-Key": KEY,
            "X-Actor-Context": encode_actor(ACTOR),
            "X-Role": "admin",
        },
    )
    assert response.status_code == 200
    assert response.json()["role"] == "employee"
    assert response.json()["first_name"] == "Иван"
