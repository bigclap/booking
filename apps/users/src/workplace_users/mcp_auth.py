"""OAuth HTTP endpoints from the official MCP SDK plus our login/consent UI."""

import asyncio
import html
import re
import secrets
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlencode, urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi import Request as FastAPIRequest
from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.provider import AuthorizationParams, construct_redirect_uri
from mcp.server.auth.routes import build_metadata, cors_middleware, create_auth_routes
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.server.transport_security import RequestBodyLimitMiddleware
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import select
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse
from starlette.routing import Route
from workplace_platform.auth import require_internal_key

from workplace_users.mcp_auth_provider import SCOPE, MCPAuthProvider, utcnow
from workplace_users.mcp_models import (
    MCPAuthorizationCode,
    MCPAuthorizationRequest,
    MCPClient,
    MCPToken,
)
from workplace_users.models import Session, User
from workplace_users.schemas import UserView
from workplace_users.security import issue_token, token_digest, verify_password

COOKIE = "mcp_authorize_csrf"
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
    "frame-ancestors 'none'; base-uri 'none'",
}


def invalid_request(message="Запрос устарел. Начните подключение заново.", status=400):
    return HTMLResponse(html.escape(message), status_code=status, headers=SECURITY_HEADERS)


def consent_form(provider, handle, csrf, client_name, message=""):
    escape = html.escape
    return HTMLResponse(
        f"""<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Подключение помощника</title>
<style>body{{font:16px system-ui;background:#f5f6fa;color:#26334b;margin:0;padding:48px 20px}}
main{{max-width:400px;margin:auto;padding:28px;background:white;border-radius:18px}}
label{{display:block;margin:18px 0}}
input{{box-sizing:border-box;width:100%;padding:12px;margin-top:6px}}
button{{padding:12px;width:100%;background:#5267d7;color:white;border:0;border-radius:8px}}
.error{{color:#b32c39}}small{{color:#66748d}}</style><main><h1>Подключение помощника</h1>
<p>Приложение <strong>{escape(client_name)}</strong> запрашивает доступ к поиску и бронированию
в пределах ваших прав.</p><small>Подключайтесь только к знакомым приложениям.</small>
<p class="error">{escape(message)}</p><form method="post" action="{escape(provider.issuer)}/login">
<input type="hidden" name="request" value="{escape(handle)}">
<input type="hidden" name="csrf" value="{escape(csrf)}">
<label>Логин<input name="login" required autocomplete="username" maxlength="80"></label>
<label>Пароль<input name="password" type="password" required autocomplete="current-password"
 maxlength="1024"></label><button>Войти и разрешить доступ</button></form></main></html>""",
        headers=SECURITY_HEADERS,
    )


class TokenPolicyGuard:
    """Resource/PKCE policy around the SDK; the SDK performs the actual OAuth exchange."""

    def __init__(self, app, resource, *, revocation=False):
        self.app = app
        self.resource = resource
        self.revocation = revocation

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        chunks = []
        size = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > 1024 * 1024:
                return await JSONResponse({"error": "invalid_request"}, status_code=413)(
                    scope,
                    receive,
                    send,
                )
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)

        def replay():
            sent = False

            async def next_message():
                nonlocal sent
                if sent:
                    return {"type": "http.disconnect"}
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}

            return next_message

        request = Request(scope, replay())
        form = await request.form()
        if self.revocation:
            # MCP SDK 2.3's revocation model requires this unused form field even
            # for public/Basic clients. Authentication remains entirely in the SDK.
            if "client_secret" not in form:
                body = urlencode({**dict(form), "client_secret": ""}).encode()
                scope = {
                    **scope,
                    "headers": [
                        (name, value)
                        for name, value in scope["headers"]
                        if name.lower() not in {b"content-type", b"content-length"}
                    ]
                    + [
                        (b"content-type", b"application/x-www-form-urlencoded"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            return await self.app(scope, replay(), send)
        error = None
        if form.get("resource") != self.resource:
            error = "invalid_target"
        elif form.get("grant_type") == "authorization_code" and not re.fullmatch(
            r"[A-Za-z0-9._~-]{43,128}",
            str(form.get("code_verifier", "")),
        ):
            error = "invalid_request"
        if error:
            return await JSONResponse(
                {"error": error},
                status_code=400,
                headers={
                    "Cache-Control": "no-store",
                    "Pragma": "no-cache",
                    "Access-Control-Allow-Origin": "*",
                },
            )(scope, replay(), send)
        return await self.app(scope, replay(), send)


def create_oauth_app(settings, sessions) -> Starlette:
    provider = MCPAuthProvider(settings, sessions)
    registration = ClientRegistrationOptions(
        enabled=True,
        valid_scopes=[SCOPE],
        default_scopes=[SCOPE],
    )
    revocation = RevocationOptions(enabled=True)
    routes = create_auth_routes(
        provider,
        issuer_url=AnyHttpUrl(provider.issuer),
        client_registration_options=registration,
        revocation_options=revocation,
    )
    metadata = build_metadata(AnyHttpUrl(provider.issuer), None, registration, revocation)
    metadata.token_endpoint_auth_methods_supported = [
        "none",
        "client_secret_post",
        "client_secret_basic",
    ]
    for route in routes:
        if route.path == "/token":
            route.app = TokenPolicyGuard(route.app, provider.resource)
        elif route.path == "/revoke":
            route.app = TokenPolicyGuard(route.app, provider.resource, revocation=True)
        elif route.path == "/.well-known/oauth-authorization-server":
            route.app = cors_middleware(MetadataHandler(metadata).handle, ["GET", "OPTIONS"])

    async def login(request: Request):
        if request.method == "GET":
            handle = request.query_params.get("request", "")
            if not handle or len(handle) > 128:
                return invalid_request()
            csrf = issue_token()
            async with provider.transaction() as db:
                pending = await db.scalar(
                    select(MCPAuthorizationRequest)
                    .where(
                        MCPAuthorizationRequest.handle_hash == token_digest(handle),
                    )
                    .with_for_update()
                )
                if (
                    pending is None
                    or pending.consumed_at is not None
                    or pending.expires_at <= utcnow()
                ):
                    return invalid_request()
                pending.csrf_hash = token_digest(csrf)
                client = await db.get(MCPClient, pending.client_id)
                if client is None:
                    return invalid_request()
            response = consent_form(
                provider, handle, csrf, client.metadata_document.get("client_name") or client.id
            )
            response.set_cookie(
                COOKIE,
                csrf,
                max_age=300,
                httponly=True,
                secure=provider.base_url.startswith("https://"),
                samesite="lax",
                path="/oauth/login",
            )
            return response

        origin = request.headers.get("origin")
        parsed_base = urlsplit(provider.base_url)
        if origin is not None and origin != f"{parsed_base.scheme}://{parsed_base.netloc}":
            return invalid_request("Запрос отклонён.", 403)
        form = await request.form(max_fields=8, max_files=0, max_part_size=16384)
        values = {name: form.get(name, "") for name in ("request", "csrf", "login", "password")}
        if any(not isinstance(value, str) for value in values.values()):
            return invalid_request()
        handle, csrf = values["request"], values["csrf"]
        cookie = request.cookies.get(COOKIE, "")
        if (
            not handle
            or len(handle) > 128
            or not csrf
            or len(csrf) > 128
            or not cookie
            or not secrets.compare_digest(csrf.encode(), cookie.encode())
        ):
            return invalid_request("Запрос отклонён.", 403)
        async with provider.transaction() as db:
            pending = await db.scalar(
                select(MCPAuthorizationRequest)
                .where(
                    MCPAuthorizationRequest.handle_hash == token_digest(handle),
                )
                .with_for_update()
            )
            if (
                pending is None
                or pending.expires_at <= utcnow()
                or pending.consumed_at is not None
                or pending.csrf_hash != token_digest(csrf)
            ):
                return invalid_request()
            user = await db.scalar(
                select(User)
                .where(
                    User.login == values["login"].strip().casefold(),
                )
                .with_for_update()
            )
            password = values["password"]
            valid = False
            if 0 < len(password) <= 1024 and len(values["login"]) <= 80:
                valid = await asyncio.to_thread(
                    verify_password, password, user.password_hash if user else None
                )
            if not valid or user is None or not user.active:
                client = await db.get(MCPClient, pending.client_id)
                return consent_form(
                    provider,
                    handle,
                    csrf,
                    (client.metadata_document.get("client_name") or client.id)
                    if client
                    else "Помощник",
                    "Неверный логин или пароль.",
                )
            now = utcnow()
            session = Session(
                user_id=user.id,
                token_hash=token_digest(issue_token()),
                expires_at=now + timedelta(days=provider.refresh_days),
            )
            db.add(session)
            await db.flush()
            code = issue_token()
            db.add(
                MCPAuthorizationCode(
                    code_hash=token_digest(code),
                    client_id=pending.client_id,
                    user_id=user.id,
                    session_id=session.id,
                    parameters=pending.parameters,
                    expires_at=now + timedelta(minutes=2),
                )
            )
            pending.consumed_at = now
            params = AuthorizationParams.model_validate(pending.parameters)
            target = construct_redirect_uri(
                str(params.redirect_uri), code=code, state=params.state, iss=provider.issuer
            )
        response = RedirectResponse(target, status_code=302, headers=SECURITY_HEADERS)
        response.delete_cookie(COOKIE, path="/oauth/login")
        return response

    login_route = Route("/login", login, methods=["GET", "POST"])
    login_route.app = RequestBodyLimitMiddleware(login_route.app, 16384)
    routes.append(login_route)
    app = Starlette(routes=routes)
    app.state.provider = provider
    return app


class IntrospectMCPToken(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: SecretStr = Field(min_length=1, max_length=4096)
    resource: str = Field(min_length=1, max_length=2048)


def create_mcp_internal_router():
    router = APIRouter(prefix="/internal/mcp", dependencies=[Depends(require_internal_key)])

    def provider_for(request):
        if request.app.state.settings.mcp_encryption_key is None:
            raise HTTPException(503, detail={"code": "mcp_auth_not_configured"})
        return MCPAuthProvider(request.app.state.settings, request.app.state.sessions)

    @router.post("/delegate")
    async def delegate(
        request: FastAPIRequest,
        user_id: Annotated[UUID, Header(alias="X-User-ID")],
        session_id: Annotated[UUID, Header(alias="X-Session-ID")],
    ):
        provider = provider_for(request)
        tokens = await provider.delegate(user_id, session_id)
        if tokens is None:
            raise HTTPException(401, detail={"code": "session_invalid"})
        return {**tokens.model_dump(exclude_none=True), "resource": provider.resource}

    @router.post("/introspect")
    async def introspect(body: IntrospectMCPToken, request: FastAPIRequest):
        provider = provider_for(request)
        token = await provider.load_access_token(body.token.get_secret_value())
        if token is None or body.resource != provider.resource:
            raise HTTPException(401, detail={"code": "mcp_token_invalid"})
        async with request.app.state.sessions() as db:
            row = await db.get(MCPToken, token_digest(token.token))
            pair = await provider.identity(db, row.session_id, row.user_id)
            if pair is None:
                raise HTTPException(401, detail={"code": "mcp_token_invalid"})
            return {
                "user": UserView.model_validate(pair[0]),
                "session_id": str(row.session_id),
                "client_id": token.client_id,
                "scopes": token.scopes,
                "expires_at": token.expires_at,
                "resource": token.resource,
            }

    return router
