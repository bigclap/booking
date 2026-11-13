"""Read-only smoke against the running development containers; creates no demo users/data."""

import asyncio
import json
import re

import httpx
import websockets


async def main():
    async with httpx.AsyncClient(timeout=20) as client:
        frontend = await client.get("http://nginx:8080/booking", headers={"Host": "localhost:5178"})
        frontend.raise_for_status()
        assert '<div id="root">' in frontend.text
        print("OK ingress: Nginx serves the React entrypoint through Vite")
        docs = await client.get("http://nginx:8080/api/docs")
        assert docs.status_code == 200 and "/api/openapi.json" in docs.text
        assert (await client.get("http://nginx:8080/api/openapi.json")).status_code == 200
        vite = await client.get(
            "http://nginx:8080/@vite/client", headers={"Host": "localhost:5178"}
        )
        token = re.search(r'const wsToken = "([^"]+)"', vite.text).group(1)
        async with websockets.connect(
            f"ws://localhost:5178/?token={token}",
            host="nginx",
            port=8080,
            subprotocols=["vite-hmr"],
            proxy=None,
            open_timeout=5,
        ) as socket:
            assert (
                json.loads(await asyncio.wait_for(socket.recv(), timeout=5))["type"] == "connected"
            )
            assert socket.response.status_code == 101
        print("OK ingress: HMR WebSocket upgrade through the same Nginx")
        for service in ("users", "booking", "assistant", "gateway"):
            result = await client.get(f"http://{service}:8000/health/ready")
            result.raise_for_status()
            assert result.json()["status"] == "ok", service
            prefix = "/api" if service == "gateway" else ""
            schema = await client.get(f"http://{service}:8000{prefix}/openapi.json")
            schema.raise_for_status()
            assert schema.json()["openapi"].startswith("3."), service
            print(f"OK {service}: readiness + OpenAPI")

        for path in ("/api/auth/me", "/api/buildings", "/api/booking/policy", "/api/chats"):
            result = await client.get(f"http://nginx:8080{path}")
            assert result.status_code == 401, (path, result.status_code)
        internal = await client.get("http://users:8000/internal/users")
        assert internal.status_code == 401
        public = await client.get("http://nginx:8080/internal/users")
        assert public.status_code == 404
        print("OK auth: protected routes reject anonymous and forged public access")


if __name__ == "__main__":
    asyncio.run(main())
