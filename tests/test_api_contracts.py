from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import app as app_module


class ApiContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app_module.state.clear_selection()
        app_module.member_scan_service.clear()
        transport = httpx.ASGITransport(app=app_module.app)
        self.client = httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1",
            headers={"X-IFC-Session": app_module.app.state.api_session.secret},
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_health_contract(self):
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "ifc-selection-bridge")
        self.assertEqual(payload["appVersion"], "1.0.2")
        self.assertFalse(payload["hasSelection"])

    async def test_semantic_retry_rejects_stale_activation_and_duplicate_attempt(self):
        import model_runtime
        from index_progress import IndexProgress
        from unittest.mock import Mock
        state = model_runtime._ActiveModelState()
        model_hash = "a" * 64
        state.set(model_runtime.ActiveModel("probe.ifc", model_hash, "probe.ifc", 1, "current"))
        progress = IndexProgress()
        attempt = progress.begin(model_hash)
        progress.update(attempt, {"phase": "cold", "status": "error", "error": "probe"})
        body = {"modelHash": model_hash, "loadedAt": "old", "attemptId": attempt}
        with patch.object(model_runtime, "_state", state), patch.object(model_runtime, "_index_progress", progress), patch.object(model_runtime, "_background_indexes", Mock()), patch.object(model_runtime, "_queue_index_build", side_effect=lambda _: progress.begin(model_hash)) as queue:
            self.assertEqual((await self.client.post("/model/retry-semantic", json=body)).status_code, 409)
            body["loadedAt"] = "current"
            self.assertEqual((await self.client.post("/model/retry-semantic", json=body)).status_code, 200)
            self.assertEqual((await self.client.post("/model/retry-semantic", json=body)).status_code, 409)
            queue.assert_called_once()

    async def test_runtime_exposes_separate_semantic_readiness(self):
        response = await self.client.get("/model/runtime")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn(payload["hotIndexStatus"], {"idle", "indexing", "ready", "error"})
        self.assertIn(
            payload["coldIndexStatus"],
            {"not_configured", "indexing", "ready", "error"},
        )
        if not payload["hasActiveModel"]:
            self.assertIsNone(payload["activeModelHash"])
            self.assertEqual(payload["hotIndexStatus"], "idle")

    async def test_selection_round_trip(self):
        selection = {
            "schemaVersion": 1,
            "source": "thatopen",
            "model": {"id": "model-1", "name": "Sample"},
            "element": {"globalId": "GUID-1", "expressId": 42, "ifcType": "IfcBeam", "name": "B1"},
            "selection": {"status": "selected", "selectedAt": "2026-08-30T00:00:00Z"},
            "preview": {"Name": "B1"},
        }
        posted = await self.client.post("/selection", json=selection)
        self.assertEqual(posted.status_code, 200)
        self.assertTrue(posted.json()["hasSelection"])
        self.assertEqual(posted.json()["globalId"], "GUID-1")

        current = (await self.client.get("/selection")).json()
        self.assertEqual(current["expressId"], 42)
        self.assertEqual(current["modelName"], "Sample")

        cleared = (await self.client.delete("/selection")).json()
        self.assertFalse(cleared["hasSelection"])
        self.assertIsNone(cleared["data"])

    async def test_selection_validation_contract(self):
        response = await self.client.post("/selection", json={"selection": {}})
        self.assertEqual(response.status_code, 422)

    async def test_takeoff_exports_preserve_model_state_errors(self):
        request = {
            "scope": "model",
            "densityTableRevision": "steel",
            "densityKgPerM3": {"Steel": 7850.0},
            "tolerance": 0.05,
        }
        for path in ("/mass/takeoff.csv", "/mass/takeoff/open-in-excel"):
            response = await self.client.post(path, json=request)
            self.assertEqual(response.status_code, 409, path)
            self.assertEqual(response.json()["error"], "no_active_model", path)

    async def test_member_scan_preserves_model_state_errors(self):
        response = await self.client.post(
            "/idea/member-scan",
            json={"globalIds": ["MISSING"], "joint": [0, 0, 0], "lengthUnit": "m"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "no_active_model")

    async def test_empty_fragment_upload_has_a_stable_client_error(self):
        model_hash = f"{'a' * 64}.fragments-v2-full"
        with patch.object(
            app_module.fragment_service,
            "store_stream",
            new=AsyncMock(side_effect=ValueError("empty fragments body")),
        ):
            response = await self.client.post(
                f"/model/fragments/{model_hash}",
                content=b"",
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "empty_fragments_body")

    async def test_openapi_preserves_the_complete_bridge_surface(self):
        paths = (await self.client.get("/openapi.json")).json()["paths"]
        actual = {
            path: set(methods) - {"parameters"}
            for path, methods in paths.items()
        }
        expected = {
            "/health": {"get"},
            "/selection": {"get", "post", "delete"},
            "/load-model": {"post"},
            "/model/fragments/{modelHash}": {"get", "post"},
            "/model/activate/{modelHash}": {"post"},
            "/model/cancel-load": {"post"},
            "/model/retry-semantic": {"post"},
            "/register-model": {"post"},
            "/model/runtime": {"get"},
            "/model/tree": {"get"},
            "/model/search": {"get"},
            "/element/by-express-id/{expressId}": {"get"},
            "/element/{globalId}": {"get"},
            "/model/materials": {"get"},
            "/mass/material-reference": {"get"},
            "/mass/takeoff": {"post"},
            "/mass/takeoff.csv": {"post"},
            "/mass/takeoff/open-in-excel": {"post"},
            "/mass/takeoff/model": {"get", "post"},
            "/mass/takeoff/model.csv": {"get"},
            "/mass/takeoff/model/open-in-excel": {"post"},
            "/idea/member-scan": {"get", "post", "delete"},
            "/idea/member-scan.tsv": {"get"},
        }
        self.assertEqual(actual, expected)

    def test_app_reexports_modular_contracts_and_state(self):
        self.assertEqual(app_module.SelectionPayload.__module__, "api_contracts")
        self.assertEqual(type(app_module.state).__module__, "api_state")

    def test_routes_are_composed_from_domain_modules(self):
        included_routers = (
            route.original_router
            for route in app_module.app.routes
            if hasattr(route, "original_router")
        )
        included_routes = (
            route
            for router in included_routers
            for route in router.routes
        )
        endpoint_modules = {
            route.path: route.endpoint.__module__
            for route in included_routes
            if hasattr(route, "endpoint")
        }
        expected = {
            "/health": "api_routes.core",
            "/model/runtime": "api_routes.model",
            "/mass/material-reference": "api_routes.mass",
            "/idea/member-scan": "api_routes.idea",
        }
        for path, module in expected.items():
            self.assertEqual(endpoint_modules[path], module)


if __name__ == "__main__":
    unittest.main()
