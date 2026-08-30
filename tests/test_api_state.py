from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import api_state
from api_contracts import SelectionPayload, TakeoffRequest
from mass import DensityTable


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

    def test_scan_state_lifecycle(self):
        state = api_state.ScanState()
        marker = object()
        self.assertIsNone(state.get_scan())
        state.set_scan(marker)
        self.assertIs(state.get_scan(), marker)
        state.clear_scan()
        self.assertIsNone(state.get_scan())

    def test_model_takeoff_job_success(self):
        job = api_state.ModelTakeoffJob()
        result = {"ok": True, "rows": []}
        with (
            patch.object(api_state, "model_subject_ids", return_value=["A"]),
            patch.object(api_state, "takeoff", return_value=result) as takeoff,
        ):
            job._run(DensityTable("r1", {}), 0.05)

        self.assertEqual(job.progress()["status"], "done")
        self.assertIs(job.result(), result)
        takeoff.assert_called_once()

    def test_model_takeoff_job_failure(self):
        job = api_state.ModelTakeoffJob()
        with (
            patch.object(api_state, "model_subject_ids", return_value=["A"]),
            patch.object(api_state, "takeoff", side_effect=RuntimeError("failed")),
        ):
            job._run(DensityTable("r1", {}), 0.05)

        progress = job.progress()
        self.assertEqual(progress["status"], "failed")
        self.assertIn("RuntimeError: failed", progress["error"])
        self.assertIsNone(job.result())


if __name__ == "__main__":
    unittest.main()
