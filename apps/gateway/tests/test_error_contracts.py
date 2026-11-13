import httpx
import pytest
from fastapi import FastAPI, HTTPException
from workplace_gateway.errors import install_error_handlers


@pytest.mark.parametrize("code", [None, 17, ["unexpected"], {"unexpected": True}])
async def test_non_string_error_codes_keep_the_public_error_envelope(code):
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/failure")
    async def failure():
        raise HTTPException(409, detail={"code": code})

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://gateway"
    ) as client:
        response = await client.get("/failure")

    assert response.status_code == 409
    assert response.json() == {
        "code": "request_failed",
        "message": "Не удалось выполнить запрос.",
        "requestId": None,
    }
    assert response.headers["Cache-Control"] == "no-store"
