from pathlib import Path
import hashlib
import json
import subprocess
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
original = Path(r'F:\Steel\VBA\IFC-Lite')
release = original / 'desktop/release/10.4.0-native-core-20261017-r3'
audit = root / 'research/core-upgrade-20261017'

def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

def command(*args):
    return subprocess.check_output(args, cwd=root, text=True, encoding='utf-8').strip()

evidence = json.loads((audit / 'evidence.json').read_text(encoding='utf-8'))
preservation = {'original_source_files_checked': len(evidence['source_fingerprints']),
    'source_drift': [name for name, old in evidence['source_fingerprints'].items()
                     if digest(original / name) != old]}
old_exe = original / 'desktop/release/10.3.0-native-quality-audit-20261017/IFC-Lite.exe'
preservation['old_exe_sha256'] = digest(old_exe)
preservation['old_exe_preserved'] = preservation['old_exe_sha256'] == '1b9a8879c4ff556324cf3aaa459b58d2fcd8f1d03fda22579bd861e98fbc1d4b'
assert not preservation['source_drift'] and preservation['old_exe_preserved']
(audit / 'preservation-final.json').write_text(json.dumps(preservation, indent=2), encoding='utf-8')

head = command('git', 'rev-parse', 'HEAD')
assert head.startswith('b54d6ff7')
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf-8').split('\0')
source_inputs = {name: digest(root / name) for name in tracked if name and (root / name).is_file()}
assets = root / 'apps/viewer/dist'
embedded_inputs = {p.relative_to(assets).as_posix(): digest(p) for p in sorted(assets.rglob('*')) if p.is_file()}
input_manifest = {'source_commit': head, 'source_files_sha256': source_inputs,
    'embedded_frontend_files_sha256': embedded_inputs,
    'note': 'Recorded after the native build. Frontend was built before the layer-3 commit; application inputs were unchanged through this commit. Final native host was built from this commit.'}
(release / 'source-inputs.json').write_text(json.dumps(input_manifest, indent=2), encoding='utf-8')
exe = release / 'IFC-Lite.exe'
assert digest(exe) == 'b35d3d085edf89c776e3316d0e0e69b7f20915da72e264259a08a093865b789b'
models = [Path(r'F:\Steel\VBA\IFC COLO\hangarvd_f10_ tan base_f01_colored.ifc'),
          Path(r'F:\Working\IFC Temp\SVD TRONG DONG-22.09.2026 (8H).ifc'),
          Path(r'F:\Working\IFC Temp\IFC_PVF.ifc')]
provenance = {'created_utc': datetime.now(timezone.utc).isoformat(),
    'exe': str(exe), 'sha256': digest(exe), 'bytes': exe.stat().st_size,
    'source_checkout': str(root), 'source_branch': command('git', 'branch', '--show-current'),
    'source_commit': head, 'origin': command('git', 'remote', 'get-url', 'origin'),
    'custom_source_snapshot': '0074241838dd52f456ac88c274700c09a9754cc6',
    'upstream_production_commit': '61d209288c1b117d405628ead302d0ee700bd2a0',
    'layers': {'rust': '142de48a', 'typescript_wasm': '95dbbc37', 'host_tools': head},
    'versions': {'host': '10.4.0', 'custom_viewer': '4.0.0', 'rust_engine': '20.4.0', 'wasm': '10.4.0'},
    'build': {'native': 'cargo +stable build --manifest-path desktop/src-tauri/Cargo.toml --release --bin ifc-lite-desktop --features custom-protocol',
              'frontend': 'node desktop/build-native-preview.mjs; VITE_IFCLITE_NATIVE=1',
              'native_toolchain': command(str(Path.home() / '.cargo/bin/rustc.exe'), '+stable', '--version'),
              'frontend_build_head': '95dbbc37', 'frontend_build_tracked_dirty': True,
              'native_build_tracked_clean': True,
              'source_input_manifest_sha256': digest(release / 'source-inputs.json'),
              'source_input_manifest_scope': input_manifest['note']},
    'wasm_sha256': digest(root / 'packages/wasm/pkg/ifc-lite_bg.wasm'),
    'models': [{'path': str(p), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in models],
    'preservation': preservation,
    'qualification': {'status': 'final packaged verification running', 'evidence_root': str(audit)},
    'limitations': ['Root pnpm lint stops at the pre-existing Windows pnpm shim ENOENT.',
        'No full external fixture corpus or universal large-model geometry parity claim.',
        'Native bounded probes do not establish browser worker-pool speed, frame latency or cold load performance.',
        'Synthetic federation retains the previous EPSG:32760 alignment warning.',
        'An earlier r2 PVF page disconnect was retained; the instrumented isolated r2 rerun passed.'],
    'publication': {'pushed': False, 'github_actions_triggered': False, 'deployed': False}}
(release / 'provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')
print(json.dumps({'exe_sha256': provenance['sha256'], 'source_commit': head,
    'source_files': len(source_inputs), 'embedded_files': len(embedded_inputs), 'preservation': preservation}, indent=2))
