from __future__ import annotations

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


def imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


class ArchitectureBoundaryTests(unittest.TestCase):
    def test_blocking_bridge_operations_use_sync_threadpool_endpoints(self):
        expected_sync_routes = {
            "api_routes/model.py": (
                "get_tree",
                "search_active_model",
                "get_element_by_express_id",
                "get_element",
                "get_materials",
            ),
            "api_routes/mass.py": (
                "get_material_reference",
                "post_takeoff",
                "post_takeoff_csv",
                "get_model_takeoff_csv",
            ),
            "api_routes/idea.py": ("post_member_scan", "get_member_scan_tsv"),
        }
        for relative_path, functions in expected_sync_routes.items():
            source = (SRC / relative_path).read_text(encoding="utf-8")
            for function in functions:
                with self.subTest(route=function):
                    self.assertIn(f"    def {function}(", source)
                    self.assertNotIn(f"    async def {function}(", source)

    def test_production_modules_do_not_depend_on_the_compatibility_facade(self):
        offenders = [
            path.name
            for path in SRC.glob("*.py")
            if path.name != "ifc_service.py" and "ifc_service" in imports(path)
        ]
        self.assertEqual(offenders, [])

    def test_unit_conversion_has_no_model_or_cache_dependency(self):
        dependencies = imports(SRC / "ifc_units.py")
        self.assertNotIn("model_cache", dependencies)
        self.assertNotIn("model_runtime", dependencies)

    def test_cache_has_no_active_model_dependency(self):
        self.assertNotIn("model_runtime", imports(SRC / "model_cache.py"))

    def test_bridge_state_has_no_takeoff_or_scan_dependency(self):
        dependencies = imports(SRC / "api_state.py")
        self.assertNotIn("idea_export", dependencies)
        self.assertNotIn("mass", dependencies)
        self.assertNotIn("takeoff", dependencies)
        self.assertNotIn("takeoff_service", dependencies)

    def test_feature_routes_use_application_services(self):
        forbidden = {
            "api_routes/mass.py": {"api_state", "excel_quickview", "takeoff"},
            "api_routes/idea.py": {"api_state", "idea_export"},
            "api_routes/model.py": {"model_cache"},
        }
        for relative, banned in forbidden.items():
            self.assertTrue(imports(SRC / relative).isdisjoint(banned), relative)

    def test_mass_policy_has_no_wire_or_runtime_dependency(self):
        dependencies = imports(SRC / "mass.py")
        self.assertNotIn("mass_wire", dependencies)
        self.assertNotIn("model_runtime", dependencies)
        self.assertFalse(any(name.startswith("fastapi") for name in dependencies))

    def test_application_services_do_not_import_fastapi(self):
        for name in ("takeoff_service.py", "member_scan_service.py", "fragment_service.py"):
            dependencies = imports(SRC / name)
            self.assertFalse(
                any(module.startswith("fastapi") for module in dependencies),
                name,
            )

    def test_production_code_uses_logging_instead_of_print(self):
        offenders = []
        for root in (SRC, ROOT / "desktop"):
            for path in root.glob("*.py"):
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
                if any(
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "print"
                    for node in ast.walk(tree)
                ):
                    offenders.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
