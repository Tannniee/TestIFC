from __future__ import annotations
import sys
import unittest
from pathlib import Path
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import app as app_module
from internal_api import SESSION_HEADER


class InternalApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app), base_url="http://127.0.0.1:8000")
        self.headers = {SESSION_HEADER: app_module.app.state.api_session.secret}

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_all_registered_api_operations_require_session(self):
        schema = app_module.app.openapi()
        for path, methods in schema["paths"].items():
            if path == "/health":
                continue
            url = path.replace("{modelHash}", "a" * 64).replace("{globalId}", "anything")
            for method in methods:
                response = await self.client.request(method, url)
                self.assertEqual(response.status_code, 401, (method, path))
        self.assertEqual((await self.client.get("/openapi.json")).status_code, 401)

    async def test_auth_and_origin_host_checks_precede_mutation(self):
        for headers in ({}, {SESSION_HEADER: "wrong"}):
            self.assertEqual((await self.client.delete("/selection", headers=headers)).status_code, 401)
        for extra in ({"Origin": "https://evil.example"}, {"Origin": "null"}, {"Host": "evil.example:8000"}):
            response = await self.client.delete("/selection", headers=self.headers | extra)
            self.assertEqual(response.status_code, 403)
        response = await self.client.get("/selection", headers=self.headers | {"Origin": "http://127.0.0.1:8000"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn(self.headers[SESSION_HEADER], response.text)

    async def test_public_health_and_trusted_preflight(self):
        self.assertEqual((await self.client.get("/health")).status_code, 200)
        response = await self.client.options("/selection", headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": SESSION_HEADER})
        self.assertEqual(response.status_code, 200)
        remote = httpx.ASGITransport(app=app_module.app, client=("192.0.2.1", 12))
        async with httpx.AsyncClient(transport=remote, base_url="http://127.0.0.1") as client:
            self.assertEqual((await client.get("/health")).status_code, 403)
