import json
import logging
import re
import time
from collections.abc import Callable
from contextlib import AsyncExitStack, asynccontextmanager
from uuid import uuid4

import httpx
import nats
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from workplace_platform.config import ServiceSettings
from workplace_platform.correlation import request_id as current_request_id
from workplace_platform.correlation import trace_id as current_trace_id
from workplace_platform.http_clients import stateless_cookies
from workplace_platform.rpc import SERVICES, RpcServer, ServiceTransport

logger = logging.getLogger("workplace.http")


def create_app(
    name: str,
    settings: ServiceSettings,
    lifespan: Callable | None = None,
    *,
    docs_prefix: str = "",
) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    @asynccontextmanager
    async def platform_lifespan(app: FastAPI):
        async with AsyncExitStack() as stack:
            connection = None
            if settings.internal_rpc_enabled:
                connection = await nats.connect(settings.nats_url, max_reconnect_attempts=-1)
                stack.push_async_callback(connection.close)
                app.state.nats = connection
            app.state.http_client = await stack.enter_async_context(
                httpx.AsyncClient(
                    timeout=settings.request_timeout_seconds,
                    transport=ServiceTransport(connection, settings) if connection else None,
                    cookies=stateless_cookies(),
                )
            )
            app.state.health_engine = None
            if settings.database_url:
                engine = create_async_engine(settings.database_url, pool_pre_ping=True)
                app.state.health_engine = engine
                stack.push_async_callback(engine.dispose)
            if lifespan is not None:
                await stack.enter_async_context(lifespan(app))
            if connection is not None and name in SERVICES:
                server = RpcServer(
                    connection, app, name, settings.internal_api_key.get_secret_value()
                )
                await server.start()
                stack.push_async_callback(server.close)
            yield

    app = FastAPI(
        title=f"Workplace · {name}",
        version="0.1.0",
        lifespan=platform_lifespan,
        docs_url=f"{docs_prefix}/docs",
        redoc_url=f"{docs_prefix}/redoc",
        openapi_url=f"{docs_prefix}/openapi.json",
    )
    app.state.settings = settings

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        candidate = request.headers.get("x-request-id", "")
        request_id = candidate if re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", candidate) else str(uuid4())
        request.state.request_id = request_id
        candidate_trace = request.headers.get("x-trace-id", "")
        trace_id = (
            candidate_trace if re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", candidate_trace) else request_id
        )
        request.state.trace_id = trace_id
        request_token = current_request_id.set(request_id)
        trace_token = current_trace_id.set(trace_id)
        start = time.monotonic()
        try:
            response = await call_next(request)
        finally:
            current_request_id.reset(request_token)
            current_trace_id.reset(trace_token)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Trace-ID"] = trace_id
        if not request.url.path.startswith("/health/"):
            # Do not log request bodies, auth headers, query strings or upstream exception text.
            logger.info(
                json.dumps(
                    {
                        "service": name,
                        "request_id": request_id,
                        "trace_id": trace_id,
                        "method": request.method,
                        "path": request.url.path,
                        "status": response.status_code,
                        "duration_ms": round((time.monotonic() - start) * 1000, 2),
                    }
                )
            )
        return response

    @app.get("/health/live", tags=["health"])
    async def live():
        return {"status": "ok", "service": name}

    @app.get("/health/ready", tags=["health"])
    async def ready():
        checks = {}
        if settings.database_url:
            try:
                async with app.state.health_engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
                checks["postgres"] = "ok"
            except Exception:
                checks["postgres"] = "unavailable"
        connection = None
        try:
            connection = await nats.connect(
                settings.nats_url,
                connect_timeout=1,
                max_reconnect_attempts=0,
                allow_reconnect=False,
            )
            await connection.jetstream(timeout=1).account_info()
            checks["jetstream"] = "ok"
        except Exception:
            checks["jetstream"] = "unavailable"
        finally:
            if connection is not None:
                await connection.close()
        for dependency, url in getattr(app.state, "readiness_urls", {}).items():
            try:
                result = await app.state.http_client.get(url)
                checks[dependency] = "ok" if result.status_code == 200 else "unavailable"
            except httpx.HTTPError:
                checks[dependency] = "unavailable"
        healthy = all(value == "ok" for value in checks.values())
        return JSONResponse(
            {"status": "ok" if healthy else "unavailable", "service": name, "checks": checks},
            status_code=200 if healthy else 503,
        )

    return app
