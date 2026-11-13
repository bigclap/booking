"""Forward the public standard OAuth protocol, without forwarding trusted actor headers."""

import httpx
from fastapi import HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

OAUTH_PATHS = frozenset(
    {
        "authorize",
        "login",
        "token",
        "register",
        "revoke",
        ".well-known/oauth-authorization-server",
    }
)


class ProtocolCORSMiddleware(CORSMiddleware):
    async def __call__(self, scope, receive, send):
        if scope.get("path", "").startswith(("/oauth/", "/.well-known/")):
            # OAuth metadata/registration/token CORS belongs to the official SDK.
            # The web cookie API retains its explicit origin policy.
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


def install_oauth_proxy(app, settings):
    async def proxy(request: Request, path: str):
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower()
            in {
                "content-type",
                "accept",
                "authorization",
                "cookie",
                "origin",
                "user-agent",
                "access-control-request-method",
                "access-control-request-headers",
            }
        }
        try:
            result = await app.state.oauth_http_client.request(
                request.method,
                settings.users_url + path,
                headers=headers,
                params=request.query_params.multi_items(),
                content=await request.body(),
            )
        except httpx.HTTPError as exc:
            raise HTTPException(503, detail={"code": "upstream_unavailable"}) from exc
        response = Response(result.content, status_code=result.status_code)
        # Preserve repeated Set-Cookie, CORS and redirects, stripping hop-by-hop metadata.
        response.raw_headers = [
            (key, value)
            for key, value in result.headers.raw
            if key.lower()
            in {
                b"content-type",
                b"location",
                b"set-cookie",
                b"cache-control",
                b"pragma",
                b"www-authenticate",
                b"access-control-allow-origin",
                b"access-control-allow-methods",
                b"access-control-allow-headers",
                b"access-control-expose-headers",
                b"vary",
                b"content-security-policy",
                b"referrer-policy",
                b"x-content-type-options",
                b"x-frame-options",
            }
        ]
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.api_route(
        "/oauth/{path:path}", methods=["GET", "POST", "OPTIONS"], include_in_schema=False
    )
    async def oauth(request: Request, path: str):
        # HTTPX normalizes dot segments before the private transport sees them.
        # Never let a public path choose another trusted service handler.
        if path not in OAUTH_PATHS:
            raise HTTPException(404, detail={"code": "not_found"})
        return await proxy(request, "/oauth/" + path)

    @app.get("/.well-known/oauth-authorization-server/oauth", include_in_schema=False)
    @app.get("/.well-known/oauth-authorization-server", include_in_schema=False)
    async def metadata(request: Request):
        return await proxy(request, "/oauth/.well-known/oauth-authorization-server")
