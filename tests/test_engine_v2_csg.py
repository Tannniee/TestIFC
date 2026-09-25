"""CSG helper contracts used by the Engine V2 artifact pipeline."""

from __future__ import annotations

import hashlib
import json
import struct
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from engine_v2_csg import _weld_shape, write_csg_overrides
from engine_v2_jobs import EngineV2JobManager


_CSG_SOURCE = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('test.ifc','2026-09-25T00:00:00',('Codex'),('Codex'),'IFC Viewer','IFC Viewer','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCDIRECTION((0.,0.,1.));
#3=IFCDIRECTION((1.,0.,0.));
#4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
#5=IFCLOCALPLACEMENT($,#4);
#6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
#7=IFCAXIS2PLACEMENT2D(#1,#3);
#8=IFCRECTANGLEPROFILEDEF(.AREA.,'Box',#7,4.,4.);
#9=IFCEXTRUDEDAREASOLID(#8,#4,#2,4.);
#10=IFCCARTESIANPOINT((0.,0.,1.));
#11=IFCAXIS2PLACEMENT3D(#10,#2,#3);
#12=IFCEXTRUDEDAREASOLID(#8,#11,#2,2.);
#13=IFCBOOLEANRESULT(.DIFFERENCE.,#9,#12);
#14=IFCSHAPEREPRESENTATION(#6,'Body','CSG',(#13));
#15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14));
#16=IFCWALL('test-csg-guid',$,'CSG wall',$,$,#5,#15,$);
#17=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#18=IFCUNITASSIGNMENT((#17));
ENDSEC;
END-ISO-10303-21;
"""


class EngineV2CsgTests(unittest.TestCase):
    def test_welds_nearly_identical_vertices(self) -> None:
        shape = SimpleNamespace(verts=(0., 0., 0., 1., 0., 0., 0., 1., 0., 1e-12, 0., 0.),
                                faces=(0, 1, 2, 3, 1, 2))
        points, faces = _weld_shape(shape, 13)
        self.assertEqual(len(points), 3)
        self.assertEqual(faces, [0, 1, 2, 0, 1, 2])

    def test_empty_boolean_has_no_invented_faces(self) -> None:
        points, faces = _weld_shape(SimpleNamespace(verts=(), faces=()), 42)
        self.assertEqual((points, faces), ([], []))

    def test_boolean_override_is_bound_to_source_hash(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ifc-engine-v2-csg-") as directory:
            source = Path(directory) / "model.ifc"
            output = Path(directory) / "override.ifcovr"
            source.write_text(_CSG_SOURCE, encoding="ascii")
            self.assertEqual(write_csg_overrides(source, output), 1)
            data = output.read_bytes()
            self.assertEqual(data[:8], b"IFCOVR01")
            self.assertEqual(data[8:40], hashlib.sha256(source.read_bytes()).digest())
            self.assertEqual(struct.unpack_from("<i", data, 40)[0], 1)
            self.assertEqual(struct.unpack_from("<i", data, 44)[0], 13)
            self.assertEqual(write_csg_overrides(source, output), 1)
            self.assertEqual(output.read_bytes(), data)

    def test_override_conversion_releases_its_process_after_success(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ifc-engine-v2-isolated-") as directory:
            source = Path(directory) / "model.ifc"
            output = Path(directory) / "override.ifcovr"
            source.write_text(_CSG_SOURCE, encoding="ascii")
            count = EngineV2JobManager._convert_overrides_isolated(
                source, output, threading.Event(), set(), True)
            self.assertEqual(count, 1)
            self.assertEqual(output.read_bytes()[:8], b"IFCOVR01")

    def test_retry_only_when_csg_is_the_blocker(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ifc-engine-v2-csg-") as directory:
            manifest = Path(directory) / "scan.json"
            manifest.write_text(json.dumps({"tessellation": None, "coverage": {"graph": {
                "geometryPlan": {"issues": ["Nested boolean operand #42 requires a validated CSG kernel."]}
            }}}), encoding="utf-8")
            self.assertTrue(EngineV2JobManager._needs_csg_override(manifest))
            manifest.write_text(json.dumps({"tessellation": None, "coverage": {"graph": {
                "geometryPlan": {"issues": ["IfcFace #42 is invalid."]}
            }}}), encoding="utf-8")
            self.assertFalse(EngineV2JobManager._needs_csg_override(manifest))

    def test_worker_drains_large_error_without_pipe_deadlock(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "engine_v2_worker_failed"):
            EngineV2JobManager._invoke_worker(
                [sys.executable, "-c", "import sys; sys.stderr.write('x' * 100000); sys.exit(1)"],
                threading.Event(),
            )


if __name__ == "__main__":
    unittest.main()
