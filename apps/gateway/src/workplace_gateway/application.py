import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import httpx
import jwt
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from workplace_platform.auth import encode_actor
from workplace_platform.jwt_tokens import AccessContext, decode_access, signing_key
from workplace_platform.web import create_app

from workplace_gateway.booking_routes import install_booking_routes
from workplace_gateway.config import GatewaySettings
from workplace_gateway.contracts.booking import BookingPolicy
from workplace_gateway.contracts.bootstrap import BootstrapSnapshot
from workplace_gateway.contracts.offices import (
    OfficeCreate,
    OfficeDocument,
    OfficeImport,
    OfficePlanUpdate,
    OfficeSettingsUpdate,
)
from workplace_gateway.contracts.users import (
    AppUser,
    AuthSnapshot,
    LoginInput,
    PasswordChange,
    PasswordReset,
    UserCreate,
    UserUpdate,
)
from workplace_gateway.errors import install_error_handlers
from workplace_gateway.events import install_events
from workplace_gateway.facade import create_facade
from workplace_gateway.mcp_server import create_mcp_server
from workplace_gateway.oauth_proxy import ProtocolCORSMiddleware
from workplace_gateway.revisions import expected_revision, idempotency_key


def create_gateway(settings: GatewaySettings | None = None):
    settings = settings or GatewaySettings()
    signing_key(settings)

    @asynccontextmanager
    async def lifespan(application):
        application.state.oauth_http_client = application.state.http_client
        async with mcp_server.session_manager.run():
            yield

    app = create_app("gateway", settings, lifespan=lifespan, docs_prefix="/api")
    install_error_handlers(app)
    app.state.readiness_urls = {"booking": f"{settings.booking_url}/health/ready"}
    app.add_middleware(
        ProtocolCORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "X-Request-ID",
            "If-Match",
            "Idempotency-Key",
        ],
    )

    def check_origin(request: Request):
        if request.method in {"GET", "HEAD", "OPTIONS"}:
            return
        origin = request.headers.get("origin")
        if origin is not None and origin not in [
            str(request.base_url).rstrip("/"),
            *settings.allowed_origins,
        ]:
            raise HTTPException(403, detail={"code": "origin_not_allowed"})
        has_cookie = any(
            name in request.cookies
            for name in (
                settings.cookie_name,
                settings.refresh_cookie_name,
            )
        )
        if origin is None and has_cookie and "authorization" not in request.headers:
            raise HTTPException(403, detail={"code": "origin_required"})

    def context(request: Request) -> AccessContext:
        verified = getattr(request.state, "verified_context", None)
        if isinstance(verified, AccessContext):
            return verified
        check_origin(request)
        authorization = request.headers.get("authorization")
        token = request.cookies.get(settings.cookie_name, "")
        if authorization is not None:
            scheme, _, token = authorization.partition(" ")
            if scheme.lower() != "bearer":
                token = ""
        if not token:
            raise HTTPException(401, detail={"code": "authentication_required"})
        try:
            return decode_access(token, settings)
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(401, detail={"code": "access_expired"}) from exc
        except (jwt.InvalidTokenError, ValidationError, KeyError, ValueError) as exc:
            raise HTTPException(401, detail={"code": "access_invalid"}) from exc

    def admin(request: Request) -> AccessContext:
        current = context(request)
        if current.user.role != "admin":
            raise HTTPException(403, detail={"code": "administrator_required"})
        return current

    def building_access(current: AccessContext, office_id: str):
        if current.user.role != "admin" and office_id not in current.user.building_ids:
            raise HTTPException(404, detail={"code": "building_not_found"})

    async def call(
        request,
        base,
        path,
        *,
        method="GET",
        current=None,
        payload=None,
        query=None,
        extra_headers=None,
        with_status=False,
        response=None,
    ):
        headers = {
            "X-Internal-Key": settings.internal_api_key.get_secret_value(),
            "X-Request-ID": request.state.request_id,
        }
        if current is not None:
            headers.update(
                {
                    "X-User-ID": current.user.id,
                    "X-Session-ID": current.session_id,
                    "X-Actor-Context": encode_actor(current.actor()),
                }
            )
        if extra_headers:
            headers.update(extra_headers)
        try:
            result = await app.state.http_client.request(
                method,
                base + path,
                headers=headers,
                json=payload,
                params=query,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(503, detail={"code": "upstream_unavailable"}) from exc
        if response is not None and "X-Access-Operation-ID" in result.headers:
            response.headers["X-Access-Operation-ID"] = result.headers["X-Access-Operation-ID"]
        if result.status_code >= 400:
            try:
                error = result.json().get("detail", {})
            except ValueError:
                error = {}
            code = (
                error.get("code", "upstream_unavailable")
                if isinstance(error, dict)
                else "validation_error"
            )
            raise HTTPException(
                result.status_code if result.status_code < 500 else 503,
                detail={
                    "code": code,
                    **(
                        {"current_revision": error["current_revision"]}
                        if isinstance(error, dict)
                        and isinstance(error.get("current_revision"), int)
                        else {}
                    ),
                },
            )
        if result.status_code == 204:
            return None
        try:
            data = result.json()
            return (data, result.status_code) if with_status else data
        except ValueError as exc:
            raise HTTPException(502, detail={"code": "upstream_contract_invalid"}) from exc

    async def snapshot(request, current):
        users = []
        if current.user.role == "admin":
            rows = await call(request, settings.users_url, "/internal/users", current=current)
            users = [AppUser.from_internal(row) for row in rows]
        return AuthSnapshot.model_validate(
            {
                "user": AppUser.from_internal(current.user.model_dump()).model_dump(by_alias=True),
                "users": [user.model_dump(by_alias=True) for user in users],
                "expiresAt": int(current.session_expires_at.timestamp() * 1000)
                if current.session_expires_at is not None
                else None,
            }
        )

    def clear_cookies(response):
        for name, path in (
            (settings.cookie_name, "/"),
            (settings.refresh_cookie_name, "/api/auth"),
        ):
            response.delete_cookie(
                name, path=path, secure=settings.cookie_secure, httponly=True, samesite="lax"
            )

    async def authenticated_response(request, data):
        try:
            current = decode_access(data["access_token"], settings)
            body = await snapshot(request, current)
            response = JSONResponse(
                body.model_dump(mode="json", by_alias=True), headers={"Cache-Control": "no-store"}
            )
            for name, value, raw_deadline, path in (
                (settings.cookie_name, data["access_token"], data["access_expires_at"], "/"),
                (settings.refresh_cookie_name, data["token"], data["expires_at"], "/api/auth"),
            ):
                # Browsers cap persistent-cookie storage; renew it on every permitted refresh.
                # The server session itself has no calendar deadline (D-123).
                deadline = (
                    datetime.fromisoformat(raw_deadline.replace("Z", "+00:00"))
                    if raw_deadline is not None
                    else datetime.now(UTC) + timedelta(days=400)
                )
                response.set_cookie(
                    name,
                    value,
                    httponly=True,
                    secure=settings.cookie_secure,
                    samesite="lax",
                    path=path,
                    expires=deadline,
                    max_age=max(0, int((deadline - datetime.now(UTC)).total_seconds())),
                )
            return response
        except (jwt.InvalidTokenError, ValidationError, KeyError, ValueError) as exc:
            raise HTTPException(502, detail={"code": "upstream_contract_invalid"}) from exc

    @app.middleware("http")
    async def no_store(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/auth/login", response_model=AuthSnapshot, tags=["auth"])
    async def login(payload: LoginInput, request: Request):
        check_origin(request)
        data = await call(
            request,
            settings.users_url,
            "/internal/auth/login",
            method="POST",
            payload={"login": payload.login, "password": payload.password.get_secret_value()},
        )
        return await authenticated_response(request, data)

    @app.post("/api/auth/refresh", response_model=AuthSnapshot, tags=["auth"])
    async def refresh(request: Request):
        check_origin(request)
        token = request.cookies.get(settings.refresh_cookie_name)
        if not token:
            raise HTTPException(401, detail={"code": "authentication_required"})
        data = await call(
            request,
            settings.users_url,
            "/internal/auth/refresh",
            method="POST",
            payload={"token": token},
        )
        return await authenticated_response(request, data)

    @app.get("/api/auth/session", response_model=AuthSnapshot, tags=["auth"])
    async def session(request: Request):
        return await snapshot(request, context(request))

    @app.get("/api/auth/me", response_model=AppUser, tags=["auth"])
    async def me(request: Request):
        return AppUser.from_internal(context(request).user.model_dump())

    @app.post("/api/auth/logout", status_code=204, tags=["auth"])
    async def logout(request: Request):
        check_origin(request)
        token = request.cookies.get(settings.refresh_cookie_name)
        if token:
            await call(
                request,
                settings.users_url,
                "/internal/auth/logout",
                method="POST",
                payload={"token": token},
            )
        response = Response(status_code=204)
        clear_cookies(response)
        return response

    @app.post("/api/auth/password", status_code=204, tags=["auth"])
    async def change_password(payload: PasswordChange, request: Request):
        await call(
            request,
            settings.users_url,
            "/internal/auth/password",
            method="POST",
            current=context(request),
            payload={
                "current_password": payload.current.get_secret_value(),
                "password": payload.password.get_secret_value(),
            },
        )
        response = Response(status_code=204)
        clear_cookies(response)
        return response

    @app.get("/api/users", response_model=list[AppUser], tags=["users"])
    async def users(request: Request):
        rows = await call(request, settings.users_url, "/internal/users", current=admin(request))
        return [AppUser.from_internal(row) for row in rows]

    @app.post("/api/users", response_model=AppUser, status_code=201, tags=["users"])
    async def create_user(payload: UserCreate, request: Request):
        data = payload.model_dump(exclude={"password"})
        data["password"] = payload.password.get_secret_value()
        return AppUser.from_internal(
            await call(
                request,
                settings.users_url,
                "/internal/users",
                method="POST",
                current=admin(request),
                payload=data,
            )
        )

    @app.patch("/api/users/{user_id}", response_model=AppUser, tags=["users"])
    async def update_user(user_id: str, payload: UserUpdate, request: Request, response: Response):
        return AppUser.from_internal(
            await call(
                request,
                settings.users_url,
                f"/internal/users/{quote(user_id, safe='')}",
                method="PATCH",
                current=admin(request),
                payload=payload.model_dump(),
                response=response,
            )
        )

    @app.get("/api/access-operations", tags=["users"])
    async def access_operations(request: Request):
        return await call(
            request,
            settings.users_url,
            "/internal/access-operations",
            current=admin(request),
            query=dict(request.query_params),
        )

    @app.get("/api/access-operations/{operation_id}", tags=["users"])
    async def access_operation(operation_id: str, request: Request):
        return await call(
            request,
            settings.users_url,
            f"/internal/access-operations/{quote(operation_id, safe='')}",
            current=admin(request),
        )

    @app.post("/api/users/{user_id}/password", status_code=204, tags=["users"])
    async def reset_password(user_id: str, payload: PasswordReset, request: Request):
        current = admin(request)
        await call(
            request,
            settings.users_url,
            f"/internal/users/{quote(user_id, safe='')}/password",
            method="POST",
            current=current,
            payload={"password": payload.password.get_secret_value()},
        )
        response = Response(status_code=204)
        if user_id == current.user.id:
            clear_cookies(response)
        return response

    @app.get("/api/booking/policy", response_model=BookingPolicy, tags=["booking"])
    async def policy(request: Request):
        return BookingPolicy.model_validate(
            await call(request, settings.booking_url, "/internal/policy", current=context(request))
        )

    def office_document(row):
        if not row.get("floors") or any(
            floor.get("plan_document") is None for floor in row["floors"]
        ):
            raise HTTPException(409, detail={"code": "office_document_unavailable"})
        try:
            return OfficeDocument.model_validate(
                {
                    "version": 1,
                    "id": row["id"],
                    "revision": row["revision"],
                    "name": row["name"],
                    **({"address": row["address"]} if row.get("address") else {}),
                    "updatedAt": row["updated_at"],
                    "hours": row["hours_document"],
                    "floors": [floor["plan_document"] for floor in row["floors"]],
                }
            )
        except (ValidationError, KeyError) as exc:
            raise HTTPException(502, detail={"code": "upstream_contract_invalid"}) from exc

    async def office_list(request, current):
        rows = await call(request, settings.booking_url, "/internal/offices", current=current)
        return [
            office_document(row)
            for row in rows
            if current.user.role == "admin" or row["id"] in current.user.building_ids
        ]

    @app.get(
        "/api/offices",
        response_model=list[OfficeDocument],
        response_model_exclude_none=True,
        tags=["offices"],
    )
    async def offices(request: Request):
        return await office_list(request, context(request))

    @app.get(
        "/api/offices/{office_id}",
        response_model=OfficeDocument,
        response_model_exclude_none=True,
        tags=["offices"],
    )
    async def office(office_id: str, request: Request, response: Response):
        current = context(request)
        building_access(current, office_id)
        document = office_document(
            await call(
                request,
                settings.booking_url,
                f"/internal/offices/{quote(office_id, safe='')}",
                current=current,
            )
        )
        response.headers["ETag"] = f'"{document.revision}"'
        return document

    @app.post(
        "/api/offices",
        response_model=OfficeDocument,
        status_code=201,
        response_model_exclude_none=True,
        tags=["offices"],
    )
    async def create_office(payload: OfficeCreate, request: Request, response: Response):
        document = office_document(
            await call(
                request,
                settings.booking_url,
                "/internal/offices",
                method="POST",
                current=admin(request),
                payload=payload.model_dump(mode="json", exclude_none=True),
            )
        )
        response.headers["ETag"] = f'"{document.revision}"'
        return document

    @app.patch(
        "/api/offices/{office_id}/settings",
        response_model=OfficeDocument,
        response_model_exclude_none=True,
        tags=["offices"],
    )
    async def office_settings(
        office_id: str, payload: OfficeSettingsUpdate, request: Request, response: Response
    ):
        current = admin(request)
        data = payload.model_dump(mode="json", exclude_none=True, exclude={"revision"})
        data["hours_document"] = data.pop("hours")
        data["expected_revision"] = expected_revision(request, payload.revision)
        document = office_document(
            await call(
                request,
                settings.booking_url,
                f"/internal/offices/{quote(office_id, safe='')}/settings",
                method="PATCH",
                current=current,
                payload=data,
            )
        )
        response.headers["ETag"] = f'"{document.revision}"'
        return document

    @app.put(
        "/api/offices/{office_id}/plan",
        response_model=OfficeDocument,
        response_model_exclude_none=True,
        tags=["offices"],
    )
    async def office_plan(
        office_id: str, payload: OfficePlanUpdate, request: Request, response: Response
    ):
        current = admin(request)
        revision = expected_revision(request, payload.revision)
        try:
            payload.validate_for_office(office_id)
        except ValueError as exc:
            raise HTTPException(422, detail={"code": "invalid_office_document"}) from exc
        data = payload.model_dump(
            mode="json", by_alias=True, exclude_none=True, exclude={"revision"}
        )
        data["expected_revision"] = revision
        document = office_document(
            await call(
                request,
                settings.booking_url,
                f"/internal/offices/{quote(office_id, safe='')}/plan",
                method="PUT",
                current=current,
                payload=data,
            )
        )
        response.headers["ETag"] = f'"{document.revision}"'
        return document

    @app.post(
        "/api/offices/import",
        response_model=OfficeDocument,
        response_model_exclude_none=True,
        tags=["offices"],
    )
    async def import_office(payload: OfficeImport, request: Request, response: Response):
        current = admin(request)
        data = {
            "document": payload.document.model_dump(mode="json", by_alias=True, exclude_none=True)
        }
        if payload.revision is not None or request.headers.get("if-match"):
            data["expected_revision"] = expected_revision(request, payload.revision)
        document = office_document(
            await call(
                request,
                settings.booking_url,
                "/internal/offices/import",
                method="POST",
                current=current,
                payload=data,
                extra_headers={"Idempotency-Key": idempotency_key(request)},
            )
        )
        response.headers["ETag"] = f'"{document.revision}"'
        return document

    @app.get("/api/buildings", tags=["catalog"])
    async def buildings(request: Request):
        current = context(request)
        rows = await call(request, settings.booking_url, "/internal/buildings", current=current)
        return [
            {
                "id": row["id"],
                "name": row["name"],
                "address": row["address"],
                "workingHours": [
                    {
                        "weekday": day["weekday"],
                        "startTime": day["start_time"],
                        "endTime": day["end_time"],
                    }
                    for day in row["working_hours"]
                ],
            }
            for row in rows
            if current.user.role == "admin" or row["id"] in current.user.building_ids
        ]

    @app.get(
        "/api/bootstrap",
        response_model=BootstrapSnapshot,
        response_model_exclude_none=True,
        tags=["bootstrap"],
    )
    async def bootstrap(request: Request):
        current = context(request)
        auth, office_rows, time_policy = await asyncio.gather(
            snapshot(request, current),
            office_list(request, current),
            call(request, settings.booking_url, "/internal/policy", current=current),
        )
        return {
            "auth": auth.model_dump(mode="json", by_alias=True),
            "offices": [
                row.model_dump(mode="json", by_alias=True, exclude_none=True) for row in office_rows
            ],
            "policy": BookingPolicy.model_validate(time_policy).model_dump(
                mode="json", by_alias=True
            ),
        }

    async def assistant_call(request, path, method="GET"):
        return await call(
            request,
            settings.assistant_url,
            path,
            method=method,
            current=context(request),
            query=dict(request.query_params),
        )

    @app.get("/api/assistant/capabilities", tags=["assistant"])
    async def capabilities(request: Request):
        data = await assistant_call(request, "/internal/capabilities")
        return {
            "runtime": data["runtime"],
            "llmConfigured": data["llm_configured"],
            "model": data["model"],
            "generationAvailable": data["generation_available"],
        }

    @app.get("/api/chats/current", tags=["assistant"])
    async def current_chat(request: Request):
        return await assistant_call(request, "/internal/chats/current")

    @app.get("/api/chats", tags=["assistant"])
    async def chats(request: Request):
        return await assistant_call(request, "/internal/chats")

    @app.get("/api/chats/{chat_id}", tags=["assistant"])
    async def chat(chat_id: str, request: Request):
        return await assistant_call(request, f"/internal/chats/{quote(chat_id, safe='')}")

    @app.post("/api/chats/new", tags=["assistant"])
    async def new_chat(request: Request):
        return JSONResponse(
            await assistant_call(request, "/internal/chats/new", "POST"), status_code=201
        )

    from workplace_gateway.chat_routes import install_chat_commands
    from workplace_gateway.oauth_proxy import install_oauth_proxy

    install_chat_commands(app, settings, context, building_access, call)
    install_oauth_proxy(app, settings)
    booking_handlers = install_booking_routes(app, settings, context, building_access, call)
    install_events(app, settings, context)
    callbacks = create_facade(
        app, settings, context, building_access, call, offices, office, booking_handlers
    )
    app.state.employee_facade = callbacks

    class DeferredServiceClient:
        async def post(self, *args, **kwargs):
            return await app.state.http_client.post(*args, **kwargs)

    mcp_server, mcp_app = create_mcp_server(
        settings, callbacks, http_client=DeferredServiceClient()
    )
    app.mount("/", mcp_app)
    return app
