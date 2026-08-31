from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import license_gate


class LicenseGateTests(unittest.TestCase):
    def test_public_mode_contract(self):
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
        self.assertEqual(
            license_gate.login(),
            {"ok": True, "message": "public build does not require login"},
        )
        self.assertIsNone(license_gate.logout())

    def test_auth_mode_is_always_public(self):
        self.assertEqual(license_gate._auth_mode(), "public")


if __name__ == "__main__":
    unittest.main()
