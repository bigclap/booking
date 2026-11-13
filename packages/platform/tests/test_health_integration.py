import os

import pytest
from fastapi.testclient import TestClient
from workplace_platform.config import ServiceSettings
from workplace_platform.web import create_app


@pytest.mark.integration
def test_readiness_checks_actual_jetstream():
    if not os.getenv("NATS_URL"):
        pytest.skip("Use make test with the isolated NATS server")
    app = create_app(
        "test",
        ServiceSettings(
            internal_api_key="test-internal-key-with-enough-entropy",
            nats_url=os.environ["NATS_URL"],
        ),
    )
    with TestClient(app) as client:
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json()["checks"]["jetstream"] == "ok"
