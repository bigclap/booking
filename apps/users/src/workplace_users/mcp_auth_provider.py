"""Official MCP OAuth provider with Users-owned PostgreSQL persistence."""

import base64
import hashlib
import re
from datetime import UTC, datetime, timedelta
from types import TracebackType
from typing import cast
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from cryptography.fernet import Fernet, InvalidToken
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, AsyncSessionTransaction
from workplace_platform.typing import JsonObject, SessionFactory

from workplace_users.config import UsersSettings
from workplace_users.mcp_models import (
    MCPAuthorizationCode,
    MCPAuthorizationRequest,
    MCPClient,
    MCPToken,
)
from workplace_users.models import Session, User
from workplace_users.security import issue_token, token_digest

SCOPE = "booking"
BUILTIN_CLIENT = "builtin-assistant"


def utcnow() -> datetime:
    return datetime.now(UTC)


def code_family(code_hash: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"workplace:mcp:code:{code_hash}")


class ProviderTransaction:
    """Avoid generator-context traceback mutation of the SDK's frozen error dataclasses."""

    db: AsyncSession
    transaction: AsyncSessionTransaction

    def __init__(self, sessions: SessionFactory) -> None:
        self.sessions = sessions

    async def __aenter__(self) -> AsyncSession:
        self.db = self.sessions()
        await self.db.__aenter__()
        self.transaction = self.db.begin()
        await self.transaction.__aenter__()
        return self.db

    async def __aexit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            return await self.transaction.__aexit__(kind, value, traceback)
        finally:
            await self.db.__aexit__(kind, value, traceback)


class MCPAuthProvider(
    OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]
):
    def __init__(self, settings: UsersSettings, sessions: SessionFactory) -> None:
        self.settings = settings
        self.sessions = sessions
        self.base_url = str(settings.public_base_url).rstrip("/")
        self.issuer = f"{self.base_url}/oauth"
        self.resource = f"{self.base_url}/mcp"
        self.access_ttl = getattr(settings, "mcp_access_ttl_seconds", 600)
        self.refresh_days = getattr(settings, "mcp_refresh_days", 30)
        # SDK client-secret authentication needs a recoverable value; opaque tokens do not.
        if settings.mcp_encryption_key is None:
            raise RuntimeError("MCP_ENCRYPTION_KEY is required by the OAuth authorization server")
        encryption_secret = settings.mcp_encryption_key.get_secret_value()
        key = hashlib.sha256(b"workplace:mcp:client-secret:" + encryption_secret.encode()).digest()
        self.cipher = Fernet(base64.urlsafe_b64encode(key))

    def transaction(self) -> ProviderTransaction:
        return ProviderTransaction(self.sessions)

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with self.sessions() as db:
            row = await db.get(MCPClient, client_id)
            if row is None:
                return None
            value = dict(row.metadata_document)
            if row.secret_ciphertext:
                try:
                    value["client_secret"] = self.cipher.decrypt(
                        row.secret_ciphertext.encode()
                    ).decode()
                except InvalidToken:
                    return None
            return OAuthClientInformationFull.model_validate(value)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if set((client_info.scope or "").split()) != {SCOPE}:
            raise RegistrationError("invalid_client_metadata", "Only booking scope is available")
        if (
            set(client_info.grant_types) - {"authorization_code", "refresh_token"}
            or set(client_info.response_types) != {"code"}
            or client_info.token_endpoint_auth_method
            not in {
                "none",
                "client_secret_post",
                "client_secret_basic",
            }
        ):
            raise RegistrationError(
                "invalid_client_metadata", "Only authorization code/PKCE is supported"
            )
        for redirect in client_info.redirect_uris or []:
            parsed = urlsplit(str(redirect))
            if (
                parsed.fragment
                or parsed.username
                or parsed.password
                or parsed.scheme not in {"http", "https"}
                or parsed.scheme == "http"
                and parsed.hostname
                not in {
                    "localhost",
                    "127.0.0.1",
                    "::1",
                }
            ):
                raise RegistrationError(
                    "invalid_redirect_uri", "Use HTTPS or a loopback HTTP callback"
                )
        if not client_info.redirect_uris:
            raise RegistrationError("invalid_redirect_uri", "A callback is required")
        metadata = cast(JsonObject, client_info.model_dump(mode="json", exclude={"client_secret"}))
        encrypted = (
            self.cipher.encrypt(client_info.client_secret.encode()).decode()
            if client_info.client_secret
            else None
        )
        async with self.transaction() as db:
            db.add(
                MCPClient(
                    id=client_info.client_id,
                    metadata_document=metadata,
                    secret_ciphertext=encrypted,
                )
            )

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        if params.resource != self.resource:
            raise AuthorizeError("invalid_target", "The MCP resource must match this server")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", params.code_challenge):
            raise AuthorizeError("invalid_request", "A valid S256 challenge is required")
        scopes = params.scopes if params.scopes is not None else [SCOPE]
        if set(scopes) != {SCOPE}:
            raise AuthorizeError("invalid_scope", "Only booking is available")
        params.scopes = [SCOPE]
        handle = issue_token()
        async with self.transaction() as db:
            db.add(
                MCPAuthorizationRequest(
                    handle_hash=token_digest(handle),
                    client_id=client.client_id,
                    parameters=cast(JsonObject, params.model_dump(mode="json")),
                    expires_at=utcnow() + timedelta(minutes=5),
                )
            )
        return f"{self.issuer}/login?request={handle}"

    async def identity(
        self, db: AsyncSession, session_id: UUID, user_id: UUID, *, lock: bool = False
    ) -> tuple[User, Session] | None:
        query = (
            select(User, Session)
            .join(Session, Session.user_id == User.id)
            .where(
                User.id == user_id,
                User.active.is_(True),
                Session.id == session_id,
                Session.revoked_at.is_(None),
                or_(Session.expires_at.is_(None), Session.expires_at > func.clock_timestamp()),
            )
        )
        if lock:
            query = query.with_for_update(of=User)
        pair = (await db.execute(query)).one_or_none()
        return (pair[0], pair[1]) if pair is not None else None

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        async with self.transaction() as db:
            row = await db.get(MCPAuthorizationCode, token_digest(authorization_code))
            if row is None or row.client_id != client.client_id or row.expires_at <= utcnow():
                return None
            if row.consumed_at is not None:
                await self.revoke_family(db, code_family(row.code_hash))
                return None
            if await self.identity(db, row.session_id, row.user_id) is None:
                return None
            return AuthorizationCode.model_validate(
                {
                    "code": authorization_code,
                    "client_id": row.client_id,
                    "expires_at": row.expires_at.timestamp(),
                    "subject": str(row.user_id),
                    **{key: value for key, value in row.parameters.items() if key != "state"},
                }
            )

    async def issue_pair(
        self,
        db: AsyncSession,
        *,
        client_id: str,
        user_id: UUID,
        session_id: UUID,
        family_id: UUID,
        scopes: list[str],
        refresh: bool = True,
    ) -> OAuthToken:
        now = utcnow()
        access = issue_token()
        db.add(
            MCPToken(
                token_hash=token_digest(access),
                kind="access",
                client_id=client_id,
                user_id=user_id,
                session_id=session_id,
                family_id=family_id,
                resource=self.resource,
                scopes=scopes,
                expires_at=now + timedelta(seconds=self.access_ttl),
            )
        )
        refresh_value = None
        if refresh:
            refresh_value = issue_token()
            db.add(
                MCPToken(
                    token_hash=token_digest(refresh_value),
                    kind="refresh",
                    client_id=client_id,
                    user_id=user_id,
                    session_id=session_id,
                    family_id=family_id,
                    resource=self.resource,
                    scopes=scopes,
                    expires_at=now + timedelta(days=self.refresh_days),
                )
            )
        return OAuthToken(
            access_token=access,
            refresh_token=refresh_value,
            expires_in=self.access_ttl,
            scope=" ".join(scopes),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        async with self.transaction() as db:
            row = await db.scalar(
                select(MCPAuthorizationCode)
                .where(
                    MCPAuthorizationCode.code_hash == token_digest(authorization_code.code),
                )
                .with_for_update()
            )
            if (
                row is None
                or row.client_id != client.client_id
                or row.consumed_at is not None
                or row.expires_at <= utcnow()
                or row.parameters["resource"] != self.resource
                or await self.identity(db, row.session_id, row.user_id, lock=True) is None
            ):
                raise TokenError("invalid_grant", "The authorization code is no longer valid")
            row.consumed_at = utcnow()
            parameters = AuthorizationParams.model_validate(row.parameters)
            # authorize() always persists normalized scopes, and the SDK loaded
            # this row as an AuthorizationCode with a required list of scopes.
            assert parameters.scopes is not None
            return await self.issue_pair(
                db,
                client_id=client.client_id,
                user_id=row.user_id,
                session_id=row.session_id,
                family_id=code_family(row.code_hash),
                scopes=parameters.scopes,
                refresh="refresh_token" in client.grant_types,
            )

    async def revoke_family(self, db: AsyncSession, family_id: UUID) -> None:
        await db.execute(
            update(MCPToken)
            .where(
                MCPToken.family_id == family_id,
                MCPToken.revoked_at.is_(None),
            )
            .values(revoked_at=func.clock_timestamp())
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        async with self.transaction() as db:
            row = await db.get(MCPToken, token_digest(refresh_token))
            if row is None or row.kind != "refresh" or row.client_id != client.client_id:
                return None
            if row.revoked_at is not None:
                await self.revoke_family(db, row.family_id)
                return None
            if (
                row.expires_at <= utcnow()
                or row.resource != self.resource
                or await self.identity(db, row.session_id, row.user_id) is None
            ):
                return None
            return RefreshToken(
                token=refresh_token,
                client_id=row.client_id,
                scopes=row.scopes,
                expires_at=int(row.expires_at.timestamp()),
                resource=row.resource,
                subject=str(row.user_id),
            )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        replay = False
        tokens = None
        async with self.transaction() as db:
            row = await db.scalar(
                select(MCPToken)
                .where(
                    MCPToken.token_hash == token_digest(refresh_token.token),
                )
                .with_for_update()
            )
            if row is not None and row.revoked_at is not None:
                await self.revoke_family(db, row.family_id)
                replay = True
            elif (
                row is None
                or row.kind != "refresh"
                or row.client_id != client.client_id
                or row.expires_at <= utcnow()
                or row.resource != self.resource
                or not set(scopes) <= set(row.scopes)
                or await self.identity(db, row.session_id, row.user_id, lock=True) is None
            ):
                raise TokenError("invalid_grant", "Refresh token is no longer valid")
            else:
                await self.revoke_family(db, row.family_id)
                tokens = await self.issue_pair(
                    db,
                    client_id=row.client_id,
                    user_id=row.user_id,
                    session_id=row.session_id,
                    family_id=row.family_id,
                    scopes=scopes,
                )
        if replay:
            raise TokenError("invalid_grant", "Refresh token was already used")
        assert tokens is not None
        return tokens

    async def load_access_token(self, token: str) -> AccessToken | None:
        async with self.sessions() as db:
            row = await db.get(MCPToken, token_digest(token))
            if (
                row is None
                or row.kind != "access"
                or row.revoked_at is not None
                or row.expires_at <= utcnow()
                or row.resource != self.resource
                or await self.identity(db, row.session_id, row.user_id) is None
            ):
                return None
            return AccessToken(
                token=token,
                client_id=row.client_id,
                scopes=row.scopes,
                expires_at=int(row.expires_at.timestamp()),
                resource=row.resource,
                subject=str(row.user_id),
                claims={"iss": self.issuer, "sid": str(row.session_id)},
            )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with self.transaction() as db:
            row = await db.get(MCPToken, token_digest(token.token))
            if row is not None:
                await self.revoke_family(db, row.family_id)

    async def delegate(self, user_id: UUID, session_id: UUID) -> OAuthToken | None:
        async with self.transaction() as db:
            if await self.identity(db, session_id, user_id, lock=True) is None:
                return None
            return await self.issue_pair(
                db,
                client_id=BUILTIN_CLIENT,
                user_id=user_id,
                session_id=session_id,
                family_id=uuid4(),
                scopes=[SCOPE],
                refresh=False,
            )
