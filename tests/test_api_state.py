from __future__ import annotations

import sys
import unittest
from pathlib import Path

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import api_state
from api_contracts import SelectionPayload, TakeoffRequest


def selection_payload() -> SelectionPayload:
    return SelectionPayload.model_validate(
        {
            "model": {"id": "model-1", "name": "Sample"},
            "element": {
                "globalId": "GUID-1",
                "expressId": 42,
                "ifcType": "IfcBeam",
                "name": "B1",
            },
            "selection": {
                "status": "selected",
                "selectedAt": "2026-08-30T00:00:00Z",
            },
        }
    )


class ApiStateTests(unittest.TestCase):
    def test_takeoff_request_validation(self):
        with self.assertRaises(ValidationError):
            TakeoffRequest()
        model_request = TakeoffRequest(scope="model")
        self.assertEqual(model_request.globalIds, [])
        self.assertEqual(model_request.tolerance, 0.05)

    def test_bridge_state_selection_lifecycle(self):
        state = api_state.BridgeState()
        self.assertFalse(state.get_selection().hasSelection)

        selected = state.set_selection(selection_payload())
        self.assertTrue(selected.hasSelection)
        self.assertEqual(selected.globalId, "GUID-1")
        self.assertEqual(selected.modelName, "Sample")
        self.assertTrue(state.has_selection())

        cleared = state.clear_selection()
        self.assertFalse(cleared.hasSelection)
        self.assertFalse(state.has_selection())
        self.assertIsNotNone(cleared.updatedAt)

if __name__ == "__main__":
    unittest.main()
