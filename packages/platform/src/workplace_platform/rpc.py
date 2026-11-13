"""Core NATS request/reply using existing typed service handlers in-process.

The HTTPX adapter is an application interface, not a network HTTP hop. Only
allowlisted internal routes are dispatched through ASGI. Public HTTP/MCP and
external provider traffic retain their own transports. RPC subjects intentionally
live outside the durable ``workplace.>`` event stream.
"""

import asyncio
import base64
import json
import logging
import secrets
from contextlib import asynccontextmanager, suppress
from typing import Any, Literal
from urllib.parse import unquote, urlsplit

import httpx
import nats
from nats.aio.client import Client
from nats.errors import MaxPayloadError, NoRespondersError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from workplace_platform.correlation import event_metadata
from workplace_platform.http_clients import stateless_cookies

logger = logging.getLogger(__name__)
SERVICES = {"users", "booking", "assistant"}
HEADER_NAMES = {
    "x-internal-key",
    "x-request-id",
    "x-trace-id",
    "x-user-id",
    "x-session-id",
    "x-actor-context",
    "x-mcp-token",
    "idempotency-key",
    "if-match",
    "content-type",
    "origin",
    "cookie",
    "authorization",
    "access-control-request-method",
    "access-control-request-headers",
}
HOP_HEADERS = {"content-length", "transfer-encoding", "connection", "keep-alive"}


class RpcRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    method: Literal["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"]
    path: str = Field(
        pattern=r"^/(internal(?:/[^?#]*)?|health/(?:live|ready)|oauth(?:/[^?#]*)?|"
        r"\.well-known/oauth-authorization-server(?:/oauth)?)$"
    )
    headers: dict[str, str] = Field(default_factory=dict)
    query: list[tuple[str, str]] = Field(default_factory=list)
    payload: Any = None
    body: str | None = None

    @field_validator("path")
    @classmethod
    def internal_path(cls, path):
        if any(part in {".", ".."} for part in unquote(path).split("/")) or "\\" in path:
            raise ValueError("RPC path traversal is not permitted")
        return path


class RpcResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    status: int = Field(ge=100, le=599)
    headers: dict[str, str] = Field(default_factory=dict)
    payload: Any = None
    body: str | None = None
    cookies: list[str] = Field(default_factory=list)


def subject(service: str) -> str:
    if service not in SERVICES:
        raise ValueError("Unknown RPC service")
    return f"rpc.workplace.{service}.v1"


@asynccontextmanager
async def service_client(settings):
    """Worker-side client with the same private RPC transport as the API lifespan."""
    connection = None
    try:
        if settings.internal_rpc_enabled:
            connection = await nats.connect(settings.nats_url, max_reconnect_attempts=-1)
        async with httpx.AsyncClient(
            timeout=settings.request_timeout_seconds,
            transport=ServiceTransport(connection, settings) if connection else None,
            cookies=stateless_cookies(),
        ) as client:
            yield client
    finally:
        if connection is not None:
            await connection.close()


class ServiceTransport(httpx.AsyncBaseTransport):
    """Route private service origins over NATS; never retry ambiguous mutations."""

    def __init__(self, connection: Client, settings):
        self.connection = connection
        self.timeout = settings.request_timeout_seconds
        self.key = settings.internal_api_key.get_secret_value()
        self.origins = {
            (parsed.scheme, parsed.netloc): name
            for name in SERVICES
            for parsed in [urlsplit(getattr(settings, f"{name}_url"))]
        }
        self.external = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        service = self.origins.get((request.url.scheme, request.url.netloc.decode()))
        if service is None:
            return await self.external.handle_async_request(request)
        try:
            body = await request.aread()
            is_json = "application/json" in request.headers.get("content-type", "")
            headers = {k: v for k, v in request.headers.items() if k in HEADER_NAMES}
            headers.setdefault("x-internal-key", self.key)
            for key, value in event_metadata().items():
                headers.setdefault(f"x-{key.replace('_', '-')}", value)
            command = RpcRequest(
                method=request.method,
                path=request.url.path,
                headers=headers,
                query=request.url.params.multi_items(),
                payload=json.loads(body) if body and is_json else None,
                body=base64.b64encode(body).decode() if body and not is_json else None,
            )
            message = await self.connection.request(
                subject(service), command.model_dump_json().encode(), timeout=self.timeout
            )
            result = RpcResponse.model_validate_json(message.data)
        except (TimeoutError, NoRespondersError) as exc:
            raise httpx.ReadTimeout("Internal RPC unavailable", request=request) from exc
        except MaxPayloadError:
            return httpx.Response(
                413, json={"detail": {"code": "rpc_payload_too_large"}}, request=request
            )
        except (ValidationError, ValueError) as exc:
            raise httpx.RemoteProtocolError(
                "Invalid internal RPC contract", request=request
            ) from exc
        except httpx.HTTPError:
            raise
        except Exception as exc:
            raise httpx.ConnectError("Internal broker unavailable", request=request) from exc
        content = (
            base64.b64decode(result.body, validate=True)
            if result.body is not None
            else json.dumps(result.payload).encode()
        )
        return httpx.Response(
            result.status,
            headers=[*result.headers.items(), *(("set-cookie", c) for c in result.cookies)],
            content=b"" if result.status == 204 else content,
            request=request,
        )

    async def aclose(self):
        await self.external.aclose()


class RpcServer:
    def __init__(self, connection: Client, app, service: str, key: str):
        self.connection = connection
        self.app = app
        self.service = service
        self.key = key
        self.pending: set[asyncio.Task] = set()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://internal",
            cookies=stateless_cookies(),
        )
        self.slots = asyncio.Semaphore(64)
        self.subscription = None

    async def start(self):
        self.subscription = await self.connection.subscribe(
            subject(self.service), queue=f"{self.service}-rpc-v1", cb=self.receive
        )
        await self.connection.flush()

    async def receive(self, message):
        # nats-py awaits a subscription callback serially. Dispatch concurrently so
        # independent requests retain real DB concurrency and do not block health.
        task = asyncio.create_task(self.handle(message))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)

    async def handle(self, message):
        async with self.slots:
            try:
                command = RpcRequest.model_validate_json(message.data)
                key = command.headers.get("x-internal-key", "")
                if not secrets.compare_digest(key, self.key):
                    result = RpcResponse(
                        status=401, payload={"detail": {"code": "internal_auth_required"}}
                    )
                else:
                    response = await self.client.request(
                        command.method,
                        command.path,
                        headers={k: v for k, v in command.headers.items() if k in HEADER_NAMES},
                        params=command.query,
                        **(
                            {"content": base64.b64decode(command.body, validate=True)}
                            if command.body is not None
                            else {"json": command.payload}
                        ),
                    )
                    is_json = "application/json" in response.headers.get("content-type", "")
                    result = RpcResponse(
                        status=response.status_code,
                        headers={
                            k: v
                            for k, v in response.headers.items()
                            if k not in HOP_HEADERS and k != "set-cookie"
                        },
                        payload=response.json() if response.content and is_json else None,
                        body=(
                            base64.b64encode(response.content).decode()
                            if response.content and not is_json
                            else None
                        ),
                        cookies=response.headers.get_list("set-cookie"),
                    )
            except (ValueError, ValidationError):
                result = RpcResponse(
                    status=400, payload={"detail": {"code": "rpc_contract_invalid"}}
                )
            except Exception as exc:
                # Never echo body, token, database URL or upstream exception text.
                logger.error("RPC handler failed: %s", type(exc).__name__)
                result = RpcResponse(status=500, payload={"detail": {"code": "rpc_internal_error"}})
            if message.reply:
                encoded = result.model_dump_json().encode()
                if len(encoded) > self.connection.max_payload:
                    encoded = (
                        RpcResponse(
                            status=413, payload={"detail": {"code": "rpc_payload_too_large"}}
                        )
                        .model_dump_json()
                        .encode()
                    )
                with suppress(Exception):
                    await message.respond(encoded)

    async def close(self):
        if self.subscription is not None:
            await self.subscription.unsubscribe()
        if self.pending:
            _, pending = await asyncio.wait(self.pending, timeout=5)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        await self.client.aclose()
