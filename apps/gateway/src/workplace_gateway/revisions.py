import re

from fastapi import HTTPException, Request


def expected_revision(request: Request, body_revision: int | None = None) -> int:
    header = request.headers.get("if-match")
    value = None
    if header is not None:
        match = re.fullmatch(r'"([1-9][0-9]*)"|([1-9][0-9]*)', header.strip())
        if match is None:
            raise HTTPException(422, detail={"code": "invalid_revision"})
        value = int(match.group(1) or match.group(2))
    if value is not None and body_revision is not None and value != body_revision:
        raise HTTPException(422, detail={"code": "revision_mismatch"})
    result = body_revision if body_revision is not None else value
    if result is None:
        raise HTTPException(428, detail={"code": "revision_required"})
    return result


def idempotency_key(request: Request) -> str:
    value = request.headers.get("idempotency-key", "")
    if (
        not value.strip()
        or len(value) > 128
        or any(ord(char) < 33 or ord(char) > 126 for char in value)
    ):
        raise HTTPException(422, detail={"code": "idempotency_key_required"})
    return value
