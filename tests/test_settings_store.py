from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from settings_store import DEFAULT_SETTINGS, SettingsStore, normalize_settings


class SettingsStoreTests(unittest.TestCase):
    def test_missing_or_invalid_file_has_no_saved_settings(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "settings.json"
            store = SettingsStore(path)
            self.assertIsNone(store.load())
            path.write_text("not-json", encoding="utf-8")
            self.assertIsNone(store.load())

    def test_save_round_trip_normalizes_values(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "nested" / "settings.json"
            store = SettingsStore(path)
            saved = store.save(
                {
                    "locale": "en",
                    "mode": "dark",
                    "gridVisible": False,
                    "viewportBackground": "oled",
                    "wheelZoomSpeed": 2.25,
                    "ignored": "value",
                }
            )
            self.assertEqual(saved, store.load())
            self.assertEqual(saved["locale"], "en")
            self.assertEqual(saved["mode"], "dark")
            self.assertFalse(saved["gridVisible"])
            self.assertEqual(saved["viewportBackground"], "oled")
            self.assertEqual(saved["wheelZoomSpeed"], 2.25)
            self.assertNotIn("ignored", json.loads(path.read_text(encoding="utf-8")))

    def test_invalid_values_fall_back_to_defaults(self):
        self.assertEqual(
            normalize_settings(
                {
                    "locale": "fr",
                    "mode": "neon",
                    "gridVisible": "false",
                    "viewportBackground": "blue",
                    "wheelZoomSpeed": 99,
                }
            ),
            DEFAULT_SETTINGS,
        )


if __name__ == "__main__":
    unittest.main()
