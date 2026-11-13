from fastapi.testclient import TestClient
from workplace_booking.config import BookingSettings
from workplace_booking.main import build_app

KEY = "test-key-at-least-24-characters"


def test_identity_headers_alone_do_not_authorize_an_internal_request():
    app = build_app(BookingSettings(internal_api_key=KEY))
    response = TestClient(app).get(
        "/internal/policy",
        headers={
            "X-User-Id": "user-1",
            "X-Role": "admin",
        },
    )
    assert response.status_code == 401


def test_trusted_service_key_does_not_require_a_user_session_or_users_call():
    app = build_app(BookingSettings(internal_api_key=KEY))
    # No lifespan/client/Users connection: this is a trusted service route, not user authorization.
    response = TestClient(app).get("/internal/policy", headers={"X-Internal-Key": KEY})
    assert response.status_code == 200
    assert response.json()["timezone"] == "Europe/Moscow"
