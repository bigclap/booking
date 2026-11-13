"""Gateway dependency signatures; transport data is validated by each consumer."""

from collections.abc import Callable, Mapping
from typing import Literal, Protocol, overload

from fastapi import HTTPException, Request, Response
from pydantic import TypeAdapter, ValidationError
from workplace_platform.jwt_tokens import AccessContext

Authenticate = Callable[[Request], AccessContext]
BuildingAccess = Callable[[AccessContext, str], None]


def parse_upstream[T](adapter: TypeAdapter[T], value: object) -> T:
    try:
        return adapter.validate_python(value)
    except ValidationError as exc:
        raise HTTPException(502, detail={"code": "upstream_contract_invalid"}) from exc


class UpstreamCall(Protocol):
    @overload
    async def __call__(
        self,
        request: Request,
        base: str,
        path: str,
        *,
        method: str = "GET",
        current: AccessContext | None = None,
        payload: object = None,
        query: Mapping[str, str] | None = None,
        extra_headers: Mapping[str, str] | None = None,
        with_status: Literal[False] = False,
        response: Response | None = None,
    ) -> object: ...

    @overload
    async def __call__(
        self,
        request: Request,
        base: str,
        path: str,
        *,
        method: str = "GET",
        current: AccessContext | None = None,
        payload: object = None,
        query: Mapping[str, str] | None = None,
        extra_headers: Mapping[str, str] | None = None,
        with_status: Literal[True],
        response: Response | None = None,
    ) -> tuple[object, int]: ...
