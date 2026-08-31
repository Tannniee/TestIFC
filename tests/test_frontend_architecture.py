from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
LIB = FRONTEND / "lib"


def source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class FrontendArchitectureTests(unittest.TestCase):
    def test_app_uses_the_shell_boundary_and_extracted_components(self):
        app = source(FRONTEND / "App.svelte")
        self.assertIn('from "./lib/app-shell"', app)
        for component in (
            "AppRail",
            "AuthDialog",
            "HelpDialog",
            "InspectorDrawer",
        ):
            self.assertIn(f"<{component}", app)
        for forbidden in (
            'from "./lib/api"',
            'from "./lib/settings"',
            'from "./lib/viewer"',
            "new ViewerService",
            "localStorage.",
        ):
            self.assertNotIn(forbidden, app)
        self.assertIn("progressText(viewerProgress, t)", app)
        self.assertIn("bridgeText(bridgeProgress, locale)", app)
        self.assertLess(len(app.splitlines()), 700)

    def test_app_shell_owns_api_settings_and_viewer_lifecycle(self):
        shell = source(LIB / "app-shell.ts")
        for dependency in ('from "./api"', 'from "./settings"', 'from "./viewer"'):
            self.assertIn(dependency, shell)
        self.assertIn("export class AppShellService", shell)
        self.assertIn("async dispose()", shell)

    def test_viewer_service_delegates_external_concerns(self):
        viewer = source(LIB / "viewer.ts")
        for collaborator in (
            'from "./ifc-converter"',
            'from "./viewer-bridge"',
            'from "./viewer-camera"',
            'from "./viewer-contracts"',
            'from "./viewer-selection"',
        ):
            self.assertIn(collaborator, viewer)
        for forbidden in ('from "./api"', "new Worker", "crypto.subtle"):
            self.assertNotIn(forbidden, viewer)
        self.assertLess(len(viewer.splitlines()), 700)

    def test_api_runtime_imports_stay_in_shell_and_bridge_adapters(self):
        expected = {"app-shell.ts", "viewer-bridge.ts"}
        actual = {
            path.name
            for path in LIB.glob("*.ts")
            if any(
                'from "./api"' in line
                and not line.lstrip().startswith("import type")
                for line in source(path).splitlines()
            )
        }
        self.assertEqual(actual, expected)

    def test_settings_depends_on_viewer_contracts_not_implementation(self):
        settings = source(LIB / "settings.ts")
        self.assertIn('from "./viewer-contracts"', settings)
        self.assertNotIn('from "./viewer"', settings)

    def test_viewcube_keeps_math_outside_the_svelte_component(self):
        component = source(LIB / "ViewCube.svelte")
        math = source(LIB / "viewcube-math.ts")
        self.assertIn('from "./viewcube-math"', component)
        self.assertNotIn('from "three"', component)
        self.assertNotIn("function makeSurfaceMatrix", component)
        self.assertIn("export const VIEW_CUBE_SURFACES", math)
        self.assertIn("export function currentDirectionKey", math)
        self.assertIn('from "./viewer-contracts"', math)
        self.assertNotIn('from "./viewer"', math)
        self.assertLess(len(component.splitlines()), 350)


if __name__ == "__main__":
    unittest.main()
