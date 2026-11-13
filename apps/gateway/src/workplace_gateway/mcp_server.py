"""Employee MCP tools over the official SDK and the same Gateway application facade.

OAuth resource tokens are checked by Users. Neither web cookies nor model-supplied
identity fields establish the MCP caller. Preparing a booking only returns the
confirmation form; there is deliberately no direct booking-creation tool.
"""

import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, date, datetime
from typing import Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import HTTPException
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp_types import ToolAnnotations
from pydantic import AnyHttpUrl, BaseModel, ValidationError
from starlette.applications import Starlette
from workplace_platform.jwt_tokens import AccessContext, TokenUser

from workplace_gateway.errors import MESSAGES

FacadeCallback = Callable[..., Awaitable[Any]]
FacadeCallbacks = Mapping[str, FacadeCallback]
REQUIRED_CALLBACKS = frozenset(
    {
        "list_offices",
        "get_office",
        "list_bookings",
        "availability",
        "prepare_booking",
        "update_booking",
        "cancel_booking",
    }
)
logger = logging.getLogger(__name__)


class UsersMCPTokenVerifier(TokenVerifier):
    def __init__(self, settings, resource: str, http_client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.resource = resource
        self.http_client = http_client

    async def _introspect(self, client: httpx.AsyncClient, token: str) -> httpx.Response:
        return await client.post(
            self.settings.users_url + "/internal/mcp/introspect",
            headers={"X-Internal-Key": self.settings.internal_api_key.get_secret_value()},
            json={"token": token, "resource": self.resource},
        )

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            if self.http_client is not None:
                response = await self._introspect(self.http_client, token)
            else:
                async with httpx.AsyncClient(
                    timeout=self.settings.request_timeout_seconds,
                ) as client:
                    response = await self._introspect(client, token)
            if response.status_code in {401, 403}:
                return None
            response.raise_for_status()
            data = response.json()
            user = TokenUser.model_validate(data["user"])
            expires_at = data["expires_at"]
            if (
                not user.active
                or data["resource"] != self.resource
                or not isinstance(expires_at, int)
                or isinstance(expires_at, bool)
                or expires_at <= time.time()
                or not isinstance(data["scopes"], list)
                or "booking" not in data["scopes"]
                or not isinstance(data["session_id"], str)
                or not data["session_id"]
                or not isinstance(data["client_id"], str)
                or not data["client_id"]
            ):
                return None
            current = AccessContext(
                user=user,
                session_id=data["session_id"],
                session_expires_at=None,
                access_expires_at=datetime.fromtimestamp(expires_at, UTC),
            )
            return AccessToken(
                token=token,
                client_id=data["client_id"],
                subject=user.id,
                scopes=["booking"],
                expires_at=expires_at,
                resource=self.resource,
                claims={"context": current.model_dump(mode="json")},
            )
        except (httpx.HTTPError, ValidationError, KeyError, TypeError, ValueError, OverflowError):
            # Authentication fails closed without logging token or service response bodies.
            logger.warning("MCP identity could not be verified")
            return None


def _public_json(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(value, dict):
        return {key: _public_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_public_json(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def create_mcp_server(
    settings,
    facade_callbacks: FacadeCallbacks,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> tuple[MCPServer, Starlette]:
    """Return the SDK server and ASGI app; the host must run session_manager.run().

    Each facade callback receives the verified AccessContext as its first positional
    argument, with named tool arguments as keyword arguments. Mutation callbacks must
    enforce ownership even when the caller's actual role is administrator; that role
    remains intact so the employee catalog can include all buildings available to it.
    """
    missing = REQUIRED_CALLBACKS.difference(facade_callbacks)
    if missing:
        raise ValueError("Missing MCP facade callbacks: " + ", ".join(sorted(missing)))
    public_base = str(settings.public_base_url).rstrip("/")
    resource = public_base + "/mcp"
    verifier = UsersMCPTokenVerifier(settings, resource, http_client)
    server = MCPServer(
        "Workplace Booking",
        instructions=(
            "Действуй от имени подключённого сотрудника. Данные и доступность получай "
            "через инструменты. Для новой брони подготовь ссылку на нашу форму: бронь "
            "создаётся только после её подтверждения пользователем. Не сообщай о создании "
            "брони по результату prepare_booking. Изменение и отмена доступны только "
            "для собственных броней. Во внешнем чате покажи пользователю url результата "
            "prepare_booking как ссылку на нашу форму подтверждения."
        ),
        token_verifier=verifier,
        auth=AuthSettings(
            issuer_url=AnyHttpUrl(public_base + "/oauth"),
            resource_server_url=AnyHttpUrl(resource),
            required_scopes=["booking"],
            validate_token_resource=True,
        ),
    )

    def current_user() -> AccessContext:
        token = get_access_token()
        if token is None or token.resource != resource or "booking" not in token.scopes:
            raise ToolError("Для работы с бронированиями необходимо войти в систему.")
        try:
            current = AccessContext.model_validate((token.claims or {})["context"])
        except (ValidationError, KeyError, TypeError) as exc:
            raise ToolError("Недействительный пользовательский контекст.") from exc
        if (
            token.subject != current.user.id
            or not current.user.active
            or current.access_expires_at <= datetime.now(UTC)
        ):
            raise ToolError("Сессия завершена. Подключитесь повторно.")
        return current

    async def invoke(name: str, **arguments):
        current = current_user()
        try:
            return _public_json(await facade_callbacks[name](current, **arguments))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            code = detail.get("code", "request_failed")
            if not isinstance(code, str):
                code = "request_failed"
            raise ToolError(MESSAGES.get(code, "Не удалось выполнить действие.")) from None
        except Exception as exc:
            logger.warning("MCP operation failed: %s (%s)", name, type(exc).__name__)
            raise ToolError("Не удалось выполнить действие. Попробуйте ещё раз.") from None

    readonly = ToolAnnotations(read_only_hint=True, idempotent_hint=True)
    mutation = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False)

    @server.tool(annotations=readonly)
    async def list_offices() -> list[dict[str, Any]]:
        """Показать офисы, доступные подключённому сотруднику."""
        return await invoke("list_offices")

    @server.tool(annotations=readonly)
    async def get_office(office_id: str) -> dict[str, Any]:
        """Получить актуальный план офиса, этажи, ресурсы и рабочие часы."""
        return await invoke("get_office", office_id=office_id)

    @server.tool(annotations=readonly)
    async def list_bookings(office_id: str, date: str | None = None) -> list[dict[str, Any]]:
        """Показать видимые брони офиса; дата YYYY-MM-DD задаётся по Москве."""
        return await invoke("list_bookings", office_id=office_id, date=date)

    @server.tool(annotations=readonly)
    async def availability(
        office_id: str,
        date: str | None = None,
        start: int | None = None,
        end: int | None = None,
        kind: Literal["any", "workstation", "meeting_room"] = "any",
        participants: int | None = None,
    ) -> dict[str, Any]:
        """Подобрать ресурсы. start/end — минуты от полуночи по Москве.

        Без полного интервала available=null, поэтому свободное время не выдумывается.
        """
        return await invoke(
            "availability",
            office_id=office_id,
            date=date,
            start=start,
            end=end,
            kind=kind,
            participants=participants,
        )

    @server.tool(annotations=readonly)
    async def prepare_booking(
        office_id: str,
        resource_id: str,
        floor_id: str | None = None,
        date: str | None = None,
        start: int | None = None,
        end: int | None = None,
        participants: int | None = None,
    ) -> dict[str, Any]:
        """Подготовить предложение и ссылку на форму подтверждения.

        Не создаёт бронь и не удерживает ресурс. Прошедшая дата остаётся незаполненной.
        Во внешнем чате покажи пользователю url результата prepare_booking как ссылку
        на нашу форму подтверждения.
        """
        return await invoke(
            "prepare_booking",
            office_id=office_id,
            resource_id=resource_id,
            floor_id=floor_id,
            date=date,
            start=start,
            end=end,
            participants=participants,
        )

    @server.tool(annotations=mutation)
    async def update_booking(
        office_id: str,
        booking_id: str,
        revision: int | None = None,
        date: str | None = None,
        start: int | None = None,
        end: int | None = None,
        resource_id: str | None = None,
        floor_id: str | None = None,
        participants: int | None = None,
    ) -> dict[str, Any]:
        """Изменить только собственную бронь, включая для администратора.

        revision — версия из списка броней; сервер повторно проверяет состояние и занятость.
        """
        return await invoke(
            "update_booking",
            office_id=office_id,
            booking_id=booking_id,
            revision=revision,
            date=date,
            start=start,
            end=end,
            resource_id=resource_id,
            floor_id=floor_id,
            participants=participants,
        )

    @server.tool(annotations=mutation)
    async def cancel_booking(
        office_id: str,
        booking_id: str,
        revision: int | None = None,
    ) -> dict[str, Any]:
        """Отменить либо досрочно завершить только собственную бронь."""
        return await invoke(
            "cancel_booking",
            office_id=office_id,
            booking_id=booking_id,
            revision=revision,
        )

    public_url = urlsplit(public_base)
    allowed_hosts = list(
        dict.fromkeys(
            [
                public_url.netloc,
                public_url.hostname,
                "gateway:8000",
                "gateway",
            ]
        )
    )
    public_origin = f"{public_url.scheme}://{public_url.netloc}"
    allowed_origins = list(dict.fromkeys([public_origin, *settings.allowed_origins]))
    app = server.streamable_http_app(
        streamable_http_path="/mcp",
        json_response=True,
        stateless_http=True,
        transport_security=TransportSecuritySettings(
            allowed_hosts=[host for host in allowed_hosts if host],
            allowed_origins=allowed_origins,
        ),
    )
    return server, app
