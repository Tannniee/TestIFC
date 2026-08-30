from __future__ import annotations

import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import license_gate


class LicenseGateTests(unittest.TestCase):
    def test_development_mode_is_not_enforced(self):
        with patch.object(license_gate, "_auth_mode", return_value="dev"):
            license_gate.require_license()
            status = license_gate.status()
        self.assertTrue(status["authenticated"])
        self.assertFalse(status["enforced"])
        self.assertEqual(status["authMode"], "dev")

    def test_public_mode_contract(self):
        with patch.object(license_gate, "_auth_mode", return_value="public"):
            license_gate.require_license()
            self.assertEqual(
                license_gate.status(),
                {
                    "authenticated": True,
                    "valid": True,
                    "name": "Public build",
                    "enforced": False,
                    "authMode": "public",
                },
            )
            self.assertEqual(license_gate.login(), {"ok": True, "message": "public build does not require login"})

    def test_oauth_bridge_contract(self):
        events = []
        auth = types.SimpleNamespace(
            require_license=lambda: events.append("require"),
            status=lambda: json.dumps({"authenticated": True, "valid": True}),
            login=lambda: json.dumps({"ok": True}),
            logout=lambda: events.append("logout"),
        )
        with (
            patch.object(license_gate, "_auth_mode", return_value="oauth"),
            patch.object(license_gate, "_AVAILABLE", True),
            patch.object(license_gate, "_auth", auth, create=True),
        ):
            license_gate.require_license()
            self.assertTrue(license_gate.status()["enforced"])
            self.assertEqual(license_gate.login(), {"ok": True})
            license_gate.logout()
        self.assertEqual(events, ["require", "logout"])

    def test_unavailable_oauth_contract(self):
        with (
            patch.object(license_gate, "_auth_mode", return_value="oauth"),
            patch.object(license_gate, "_AVAILABLE", False),
            patch.object(license_gate, "_IMPORT_ERROR", "missing extension"),
        ):
            with self.assertRaisesRegex(license_gate.LicenseError, "auth module unavailable"):
                license_gate.require_license()
            self.assertFalse(license_gate.status()["authenticated"])
            self.assertFalse(license_gate.login()["ok"])

    def test_oauth_errors_are_wrapped(self):
        auth = types.SimpleNamespace(require_license=lambda: (_ for _ in ()).throw(RuntimeError("expired")))
        with (
            patch.object(license_gate, "_auth_mode", return_value="oauth"),
            patch.object(license_gate, "_AVAILABLE", True),
            patch.object(license_gate, "_auth", auth, create=True),
        ):
            with self.assertRaisesRegex(license_gate.LicenseError, "expired"):
                license_gate.require_license()

    def test_packaged_build_reads_the_canonical_config(self):
        license_gate._auth_mode.cache_clear()
        try:
            with patch.object(sys, "frozen", True, create=True):
                self.assertEqual(license_gate._auth_mode(), "public")
        finally:
            license_gate._auth_mode.cache_clear()


if __name__ == "__main__":
    unittest.main()
