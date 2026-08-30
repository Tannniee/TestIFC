from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import app as app_module


class ApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app_module.app)

    def setUp(self):
        app_module.state.clear_selection()

    def test_health_contract(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "ifc-selection-bridge")
        self.assertEqual(payload["appVersion"], "0.4.0 ahihi")
        self.assertFalse(payload["hasSelection"])

    def test_selection_round_trip(self):
        selection = {
            "schemaVersion": 1,
            "source": "thatopen",
            "model": {"id": "model-1", "name": "Sample"},
            "element": {"globalId": "GUID-1", "expressId": 42, "ifcType": "IfcBeam", "name": "B1"},
            "selection": {"status": "selected", "selectedAt": "2026-08-30T00:00:00Z"},
            "preview": {"Name": "B1"},
        }
        posted = self.client.post("/selection", json=selection)
        self.assertEqual(posted.status_code, 200)
        self.assertTrue(posted.json()["hasSelection"])
        self.assertEqual(posted.json()["globalId"], "GUID-1")

        current = self.client.get("/selection").json()
        self.assertEqual(current["expressId"], 42)
        self.assertEqual(current["modelName"], "Sample")

        cleared = self.client.delete("/selection").json()
        self.assertFalse(cleared["hasSelection"])
        self.assertIsNone(cleared["data"])

    def test_selection_validation_contract(self):
        response = self.client.post("/selection", json={"selection": {}})
        self.assertEqual(response.status_code, 422)

    def test_openapi_preserves_the_complete_bridge_surface(self):
        paths = self.client.get("/openapi.json").json()["paths"]
        actual = {
            path: set(methods) - {"parameters"}
            for path, methods in paths.items()
        }
        expected = {
            "/auth/status": {"get"},
            "/auth/login": {"post"},
            "/auth/logout": {"post"},
            "/health": {"get"},
            "/selection": {"get", "post", "delete"},
            "/load-model": {"post"},
            "/model/fragments/{modelHash}": {"get", "post"},
            "/model/activate/{modelHash}": {"post"},
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
