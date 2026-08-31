from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PackagingContractTests(unittest.TestCase):
    def test_build_config_is_explicit_and_versioned(self):
        config = json.loads(
            (ROOT / "desktop" / "build_config.json").read_text(encoding="utf-8")
        )
        self.assertEqual(config["schemaVersion"], 1)
        self.assertEqual(config["authMode"], "public")

    def test_spec_uses_the_application_version_and_required_runtime_data(self):
        spec = (ROOT / "IFC_Viewer.spec").read_text(encoding="utf-8")
        self.assertIn('ROOT / "src" / "version.py"', spec)
        self.assertIn("name=PACKAGE_NAME", spec)
        for required in (
            'ROOT / "frontend" / "dist"',
            'ROOT / "backend" / "reference_data"',
            'ROOT / "desktop" / "build_config.json"',
            'ROOT / "vendor" / "ifc_auth" / "ifc_auth.pyd"',
        ):
            self.assertIn(required, spec)

    def test_active_package_names_do_not_use_recovery_labels(self):
        active_inputs = "\n".join(
            (ROOT / path).read_text(encoding="utf-8")
            for path in ("IFC_Viewer.spec", "BuildExe.cmd", "frontend/package.json")
        ).lower()
        self.assertNotIn("recovered", active_inputs)
        self.assertNotIn("fixed.exe", active_inputs)


if __name__ == "__main__":
    unittest.main()
