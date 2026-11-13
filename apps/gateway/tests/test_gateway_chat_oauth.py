import base64
import json
from uuid import uuid4

import httpx
import pytest

from apps.gateway.tests.test_gateway import KEY, USER
from apps.gateway.tests.test_gateway import gateway as gateway


@pytest.fixture
def chat_gateway(gateway):
    client, _, state, token = gateway
    state["assistant_requests"] = []
    previous = client.app.state.http_client

    async def upstream(request):
        if request.url.host == "assistant":
            state["assistant_requests"].append(request)
            return httpx.Response(200, json={"generationId": "generation-1", "status": "queued"})
        return await previous.request(
            request.method,
            request.url,
            headers=request.headers,
            content=request.content,
        )

    replacement = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    client.app.state.http_client = replacement
    try:
        yield client, state, token
    finally:
        client.portal.call(replacement.aclose)
        client.app.state.http_client = previous


def test_chat_send_validates_context_and_forwards_verified_user_and_request_key(chat_gateway):
    client, state, token = chat_gateway
    payload = {
        "message": "Нужна переговорная",
        "context": {
            "officeId": "office-own",
            "floorId": "floor-own",
            "date": "2026-11-15",
        },
    }
    response = client.post(
        f"/api/chats/{uuid4()}/messages",
        headers={
            "Authorization": "Bearer " + token(),
            "Idempotency-Key": "message-1",
            "X-User-ID": "spoofed-admin",
            "X-Internal-Key": "spoofed-service",
            "X-Session-ID": "spoofed-session",
            "X-Actor-Context": "spoofed-context",
        },
        json=payload,
    )
    assert response.status_code == 202, response.text
    sent = state["assistant_requests"][0]
    assert json.loads(sent.content) == payload
    assert sent.headers["Idempotency-Key"] == "message-1"
    assert sent.headers["X-Internal-Key"] == KEY
    assert sent.headers["X-User-ID"] == USER["id"]
    assert sent.headers["X-Session-ID"] == "session-1"
    actor = json.loads(base64.urlsafe_b64decode(sent.headers["X-Actor-Context"]))
    assert actor["user_id"] == USER["id"] and actor["role"] == "employee"


@pytest.mark.parametrize(
    "context,expected",
    [
        ({"officeId": "office-hidden"}, 404),
        ({"officeId": "office-own", "floorId": "floor-hidden"}, 404),
        ({"officeId": "office-own", "userId": "spoofed-admin"}, 422),
    ],
)
def test_invalid_or_hidden_chat_context_is_not_queued(chat_gateway, context, expected):
    client, state, token = chat_gateway
    response = client.post(
        f"/api/chats/{uuid4()}/messages",
        headers={
            "Authorization": "Bearer " + token(),
            "Idempotency-Key": "message-1",
        },
        json={"message": "Нужна переговорная", "context": context},
    )
    assert response.status_code == expected
    assert state["assistant_requests"] == []


def test_missing_chat_request_key_is_not_forwarded_to_assistant(chat_gateway):
    client, state, token = chat_gateway
    response = client.post(
        f"/api/chats/{uuid4()}/messages",
        headers={
            "Authorization": "Bearer " + token(),
        },
        json={"message": "Нужна переговорная", "context": {"officeId": "office-own"}},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "idempotency_key_required"
    assert state["assistant_requests"] == []


def test_oauth_proxy_preserves_protocol_cookies_and_redirect_without_actor_spoofing(gateway):
    client, _, _, _ = gateway
    sent = []
    previous = client.app.state.oauth_http_client

    def upstream(request):
        sent.append(request)
        return httpx.Response(
            302,
            headers=[
                ("Location", "https://client.example/callback?code=issued-code"),
                ("Set-Cookie", "oauth_state=one; HttpOnly"),
                ("Set-Cookie", "oauth_browser=two; HttpOnly"),
                ("Content-Type", "text/plain"),
            ],
        )

    replacement = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    client.app.state.oauth_http_client = replacement
    try:
        response = client.post(
            "/oauth/token?resource=one&resource=two",
            follow_redirects=False,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": "Basic client-secret",
                "X-Internal-Key": "spoof",
                "X-User-ID": "spoof",
                "X-Actor-Context": "spoof",
                "X-Session-ID": "spoof",
                "X-Forwarded-For": "spoof",
            },
            content="grant_type=authorization_code&code=test-code&code_verifier=test-verifier",
        )
        assert response.status_code == 302
        assert response.headers["location"] == "https://client.example/callback?code=issued-code"
        assert len(response.headers.get_list("set-cookie")) == 2
        assert response.headers["cache-control"] == "no-store"
        request = sent[0]
        assert request.url.path == "/oauth/token"
        assert request.url.params.get_list("resource") == ["one", "two"]
        assert request.headers["Authorization"] == "Basic client-secret"
        assert (
            request.content
            == b"grant_type=authorization_code&code=test-code&code_verifier=test-verifier"
        )
        assert not any(
            key in request.headers
            for key in (
                "X-Internal-Key",
                "X-User-ID",
                "X-Actor-Context",
                "X-Session-ID",
                "X-Forwarded-For",
            )
        )
    finally:
        client.portal.call(replacement.aclose)
        client.app.state.oauth_http_client = previous
