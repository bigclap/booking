"""Execute in the production Gateway container; every request enters through Nginx."""

import base64
import hashlib
import json
import re
import secrets
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import mcp_types

BASE = "http://localhost:8080"


def rpc(client, method, *, token=None, params=None):
    protocol = mcp_types.LATEST_PROTOCOL_VERSION
    headers = {
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol,
        "MCP-Method": method,
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    if params and "name" in params:
        headers["MCP-Name"] = params["name"]
    return client.post(
        BASE + "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": secrets.token_hex(8),
            "method": method,
            "params": {
                **(params or {}),
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": protocol,
                    "io.modelcontextprotocol/clientCapabilities": {},
                },
            },
        },
    )


def tool_result(response):
    response.raise_for_status()
    result = response.json()["result"]
    assert not result.get("isError"), result
    value = result.get("structuredContent")
    if value is None:
        value = json.loads(
            next(part["text"] for part in result["content"] if part["type"] == "text")
        )
    if isinstance(value, dict) and set(value) == {"result"}:
        value = value["result"]
    return value


def main():
    office = json.loads(Path("/tmp/bff-office.json").read_text())
    with httpx.Client(timeout=30, trust_env=False) as client:
        metadata = client.get(BASE + "/.well-known/oauth-protected-resource/mcp")
        metadata.raise_for_status()
        assert metadata.json()["resource"] == BASE + "/mcp"
        assert metadata.json()["authorization_servers"] == [BASE + "/oauth"]
        server = client.get(BASE + "/.well-known/oauth-authorization-server/oauth")
        server.raise_for_status()
        endpoints = server.json()
        assert endpoints["issuer"] == BASE + "/oauth"
        assert rpc(client, "tools/list").status_code == 401
        callback = "http://127.0.0.1:9981/callback"
        registered = client.post(
            endpoints["registration_endpoint"],
            json={
                "redirect_uris": [callback],
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "client_name": "Disposable production proof",
                "scope": "booking",
            },
        )
        assert registered.status_code == 201
        client_id = registered.json()["client_id"]
        verifier = secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("=")
        )
        authorization = client.get(
            endpoints["authorization_endpoint"],
            params={
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": callback,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "scope": "booking",
                "resource": BASE + "/mcp",
                "state": "production-proof-state",
            },
        )
        assert authorization.status_code == 302
        consent_url = authorization.headers["location"]
        consent = client.get(consent_url)
        consent.raise_for_status()
        csrf = re.search(r'name="csrf" value="([^"]+)"', consent.text).group(1)
        handle = parse_qs(urlsplit(consent_url).query)["request"][0]
        authenticated = client.post(
            BASE + "/oauth/login",
            headers={"Origin": BASE},
            data={
                "request": handle,
                "csrf": csrf,
                "login": "proof-admin",
                "password": "proof-admin-password",
            },
        )
        assert authenticated.status_code == 302
        redirect = parse_qs(urlsplit(authenticated.headers["location"]).query)
        assert redirect["state"] == ["production-proof-state"]
        assert redirect["iss"] == [BASE + "/oauth"]
        exchange = {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": redirect["code"][0],
            "code_verifier": verifier,
            "redirect_uri": callback,
            "resource": BASE + "/mcp",
        }
        wrong = client.post(
            endpoints["token_endpoint"], data={**exchange, "code_verifier": "x" * 64}
        )
        assert wrong.status_code == 400
        granted = client.post(endpoints["token_endpoint"], data=exchange)
        granted.raise_for_status()
        tokens = granted.json()
        assert tokens["expires_in"] == 600 and tokens["scope"] == "booking"
        access = tokens["access_token"]
        listed = rpc(client, "tools/list", token=access)
        listed.raise_for_status()
        tools = {tool["name"] for tool in listed.json()["result"]["tools"]}
        assert {
            "list_offices",
            "get_office",
            "list_bookings",
            "availability",
            "prepare_booking",
        } <= tools
        assert not any("admin" in name or name == "create_booking" for name in tools)
        offices = tool_result(
            rpc(
                client, "tools/call", token=access, params={"name": "list_offices", "arguments": {}}
            )
        )
        assert [value["id"] for value in offices] == [office["id"]]
        actual = tool_result(
            rpc(
                client,
                "tools/call",
                token=access,
                params={
                    "name": "get_office",
                    "arguments": {"office_id": office["id"]},
                },
            )
        )
        assert actual["revision"] == office["revision"]
        assert [floor["id"] for floor in actual["floors"]] == [
            floor["id"] for floor in office["floors"]
        ]
        scene = actual["floors"][0]
        assert "background" not in scene
        assert scene["elements"][0]["points"] == office["floors"][0]["elements"][0]["points"]
        assert scene["elements"][0]["equipment"] == [{"type": "chair", "quantity": 4}]
        assert "vendor_data" not in scene["elements"][0]
        assert any(resource["id"] == "room-proof" for resource in actual["resources"])
        prepared = tool_result(
            rpc(
                client,
                "tools/call",
                token=access,
                params={
                    "name": "prepare_booking",
                    "arguments": {"office_id": office["id"], "resource_id": "room-proof"},
                },
            )
        )
        target = urlsplit(prepared["url"])
        assert f"{target.scheme}://{target.netloc}" == BASE and target.path == "/booking"
        assert prepared["proposal"]["resourceId"] == "room-proof"
        assert "date" not in prepared["proposal"] and "start" not in prepared["proposal"]
        refreshed = client.post(
            endpoints["token_endpoint"],
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": tokens["refresh_token"],
                "resource": BASE + "/mcp",
            },
        )
        refreshed.raise_for_status()
        replacement = refreshed.json()
        assert replacement["refresh_token"] != tokens["refresh_token"]
        assert rpc(client, "tools/list", token=access).status_code == 401
        assert rpc(client, "tools/list", token=replacement["access_token"]).status_code == 200
        revoked = client.post(
            endpoints["revocation_endpoint"],
            data={
                "client_id": client_id,
                "token": replacement["access_token"],
                "token_type_hint": "access_token",
            },
        )
        assert revoked.status_code == 200
        assert rpc(client, "tools/list", token=replacement["access_token"]).status_code == 401
        # Reusing a consumed code revokes its token family; test it after using that family.
        assert client.post(endpoints["token_endpoint"], data=exchange).status_code == 400
        print(
            "OK sole Nginx: actual OAuth PKCE/login, MCP catalog/proposal, "
            "token rotation and revocation"
        )


if __name__ == "__main__":
    main()
