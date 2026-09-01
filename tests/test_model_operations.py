from __future__ import annotations

import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import model_operations
from mass_facts import MaterialUse


class ModelOperationsTests(unittest.TestCase):
    class Lease:
        index = object()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    def test_materialize_uploaded_model_returns_a_stable_result(self):
        info = {
            "contentHashSha256": "a" * 64,
            "originalFilename": "sample.ifc",
            "sizeBytes": 123,
        }
        reader = object()
        with patch.object(
            model_operations,
            "materialize_model_stream",
            return_value=info,
        ) as materialize:
            result = model_operations.materialize_uploaded_model(
                reader,
                "sample.ifc",
            )

        self.assertEqual(result.model_hash, "a" * 64)
        self.assertEqual(result.original_filename, "sample.ifc")
        self.assertEqual(result.size_bytes, 123)
        materialize.assert_called_once_with(reader, "sample.ifc", True)

    def test_activate_cached_model_resolves_the_cached_path(self):
        model_hash = "b" * 64
        cached_path = Path("cached.ifc")
        expected = {"contentHashSha256": model_hash}
        with (
            patch.object(
                model_operations,
                "cached_model_file",
                return_value=cached_path,
            ) as cached_file,
            patch.object(
                model_operations,
                "register_model",
                return_value=expected,
            ) as register,
        ):
            result = model_operations.activate_cached_model(model_hash)

        self.assertIs(result, expected)
        cached_file.assert_called_once_with(model_hash)
        register.assert_called_once_with(str(cached_path), model_hash, True)

    def test_register_external_model_activates_in_background(self):
        expected = {"path": "sample.ifc"}
        with patch.object(
            model_operations,
            "register_model",
            return_value=expected,
        ) as register:
            result = model_operations.register_external_model(
                "sample.ifc",
                "c" * 64,
            )

        self.assertIs(result, expected)
        register.assert_called_once_with("sample.ifc", "c" * 64, True)

    def test_active_model_materials_uses_the_active_model(self):
        active_model = object()
        materials = (MaterialUse("Steel", 4, 3),)
        with (
            patch.object(
                model_operations,
                "open_model_session",
                return_value=nullcontext(
                    type("Session", (), {"ifc_file": active_model})()
                ),
            ) as open_model,
            patch.object(
                model_operations,
                "survey_materials",
                return_value=materials,
            ) as survey,
        ):
            result = model_operations.active_model_materials()

        self.assertIs(result, materials)
        open_model.assert_called_once_with()
        survey.assert_called_once_with(active_model)

    def test_query_operations_forward_domain_arguments(self):
        tree = {"roots": []}
        search = {"results": []}
        element = {"globalId": "GUID-1"}
        with (
            patch.object(
                model_operations,
                "lease_active_model",
                return_value=self.Lease(),
            ),
            patch.object(model_operations, "get_model_tree", return_value=tree),
            patch.object(
                model_operations,
                "search_model",
                return_value=search,
            ) as search_model,
            patch.object(
                model_operations,
                "extract_element",
                return_value=element,
            ) as extract,
        ):
            self.assertIs(model_operations.model_tree(), tree)
            self.assertIs(
                model_operations.search_active_model("beam", "IfcBeam", 25),
                search,
            )
            self.assertIs(
                model_operations.element_by_global_id("GUID-1"),
                element,
            )

        search_model.assert_called_once_with(
            q="beam",
            ifc_type="IfcBeam",
            limit=25,
            index=self.Lease.index,
        )
        extract.assert_called_once_with(unittest.mock.ANY, "GUID-1")


if __name__ == "__main__":
    unittest.main()
