from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PackagingContractTests(unittest.TestCase):
    def test_spec_uses_the_application_version_and_required_runtime_data(self):
        spec = (ROOT / "IFC_Viewer.spec").read_text(encoding="utf-8")
        self.assertIn('ROOT / "src" / "version.py"', spec)
        self.assertIn("name=PACKAGE_NAME", spec)
        for required in (
            'ROOT / "frontend" / "dist"',
            'ROOT / "backend" / "reference_data"',
        ):
            self.assertIn(required, spec)

    def test_active_source_has_no_application_license_or_auth_layer(self):
        self.assertFalse((ROOT / "src" / "license_gate.py").exists())
        self.assertFalse((ROOT / "src" / "api_dependencies.py").exists())
        self.assertFalse((ROOT / "frontend" / "src" / "lib" / "AuthDialog.svelte").exists())
        self.assertFalse((ROOT / "desktop" / "build_config.json").exists())
        active_source = "\n".join(
            path.read_text(encoding="utf-8")
            for directory in (ROOT / "src", ROOT / "desktop", ROOT / "frontend" / "src")
            for path in directory.rglob("*")
            if path.is_file() and path.suffix in {".py", ".ts", ".svelte"}
        ).lower()
        for forbidden in ("license_gate", "require_license", '"/auth/', "authdialog", "authmode"):
            self.assertNotIn(forbidden, active_source)

    def test_active_package_names_do_not_use_recovery_labels(self):
        active_inputs = "\n".join(
            (ROOT / path).read_text(encoding="utf-8")
            for path in ("IFC_Viewer.spec", "BuildExe.cmd", "frontend/package.json")
        ).lower()
        self.assertNotIn("recovered", active_inputs)
        self.assertNotIn("fixed.exe", active_inputs)


if __name__ == "__main__":
    unittest.main()
