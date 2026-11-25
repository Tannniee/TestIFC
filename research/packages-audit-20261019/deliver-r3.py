from pathlib import Path
import json, hashlib, subprocess, shutil
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
audit = Path(__file__).resolve().parent
original = Path(r'F:\Steel\VBA\IFC-Lite')
release = original / 'desktop/release/10.4.0-packages-audit-20261020-r3'

def read(p):
    return json.loads(p.read_text(encoding='utf-8-sig'))

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(8 * 1024 * 1024), b''): h.update(b)
    return h.hexdigest()

def write(p, data):
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, encoding='utf-8').strip()

build = read(audit / 'build-inputs-r3.json')
assert digest(release / 'IFC-Lite.exe') == build['exe_sha256']
drift = [p for p,h in build['source_files_sha256'].items() if digest(root / p) != h]
root_dependency_changes = {'Cargo.lock','Cargo.toml','rust/export/src/parquet_bos_tests.rs','rust/export/src/parquet_bos.rs'}
assert all(p.endswith('.md') or p in root_dependency_changes or p.startswith('apps/server/') for p in drift), drift
assert digest(root / 'desktop/src-tauri/Cargo.lock') == build['source_files_sha256']['desktop/src-tauri/Cargo.lock']
desktop_tree = (audit / 'desktop-windows-dependency-tree.txt').read_text(encoding='utf-8-sig')
assert not any(name in desktop_tree for name in ['ifc-lite-server ', 'cacache ', 'zip v', 'memmap2 '])
assert digest(root / 'packages/wasm/pkg/ifc-lite_bg.wasm') == build['wasm_sha256']
for name,h in build['embedded_frontend_files_sha256'].items():
    assert digest(root / 'apps/viewer/dist' / name) == h, name
quality = read(audit / 'quality-r3-diagnostic/report.json')
native = read(audit / 'native-r3/smoke-native.json')
interactions = read(audit / 'interactions-r3/report.json')
oracle = read(audit / 'interactions-r3/five-selection-oracle.json')
svd = read(audit / 'large-svd-r3/report.json')
pvf = read(audit / 'large-pvf-r3/report.json')
assert quality['ok'] and len(quality['cases']) == 15 and not quality['errors']
assert native['passed'] and len(native['tests']) == 30 and not native['errors']
assert interactions['ok'] and len(interactions['assertions']) == 54 and not interactions['errors']
assert not any('[UnitExtractor]' in str(w) for w in interactions['warnings'])
assert oracle['red'] == 5 and oracle['gray'] == 14504 and len(oracle['geometry_samples']) == 11
for report in [svd, pvf]:
    assert report['ok'] and report['cleared'] and report['exitedAfterClose'] and not report['errors']
    assert report['hostExit']['code'] == 0
for report in [quality,interactions,svd,pvf]:
    assert Path(report['exe']).resolve() == (release / 'IFC-Lite.exe').resolve()
assert Path(native['executable']).resolve() == (release / 'IFC-Lite.exe').resolve()

old = read(audit / 'preservation.json')
fingerprints = read(root / 'research/core-upgrade-20261017/evidence.json')['source_fingerprints']
preservation = {'checked_utc':datetime.now(timezone.utc).isoformat(), 'source_files_checked':len(fingerprints),
    'source_drift':[p for p,h in fingerprints.items() if digest(original / p) != h],
    'protected_releases':{}, 'input_models':{}}
assert not preservation['source_drift']
old['protected_releases']['10.4.0-packages-audit-20261019-r2'] = {'expected_sha256':'21af960205c35f931a6ed7af7227875ec238ab0ca698043920e070acf215ec2a'}
for name,item in old['protected_releases'].items():
    h=digest(original / 'desktop/release' / name / 'IFC-Lite.exe')
    assert h == item['expected_sha256']
    preservation['protected_releases'][name]={'sha256':h,'preserved':True}
for name,item in old['input_models'].items():
    p=Path(name); h=digest(p)
    assert h == item['expected_sha256']
    preservation['input_models'][name]={'sha256':h,'bytes':p.stat().st_size,'preserved':True}
write(audit / 'preservation-final.json', preservation)

packages=read(audit / 'package-test-qualification.json')
assert packages['qualified_complete_suites']['passed'] == 22410
rust_workspace = read(audit / 'rust-workspace-green-summary.json')
rust_bos = read(audit / 'rust-bos-final-summary.json')
assert rust_workspace['failed'] == 0 and rust_workspace['passed'] == 4797
assert rust_bos['failed'] == 0 and rust_bos['passed'] == 766
assert 'Finished `dev` profile' in (audit / 'rust-clippy-pinned.log').read_text(encoding='utf-8-sig')
assert read(audit / 'rust-audit-root-after.json')['vulnerabilities']['count'] == 0
assert read(audit / 'rust-audit-desktop.json')['vulnerabilities']['count'] == 0
qualification={'status':'passed with documented boundaries', 'artifact_sha256':build['exe_sha256'],
    'packages':{'complete_suites':62,'passed':22410,'conditional_skips':164,'composite':True,
                'note':'61 initial complete suites plus full mutations and create retakes; initial failed attempts retained.'},
    'root_typecheck':{'tasks':120,'test_files':3597,'log':'typecheck-resumed.log'},
    'root_lint':{'log':'lint-resumed.log','launch_regressions':'lint-regressions-resumed.log'},
    'viewer_tests':{'passed':855,'failed':0,'conditional_skips':1,'log':'viewer-resumed.log'},
    'rust_workspace_tests':rust_workspace,'rust_optional_bos_feature':rust_bos,
    'rust_clippy':{'passed':True,'toolchain':'nightly-2025-11-15 (repo pinned)','log':'rust-clippy-pinned.log',
                   'other_attempt':'Stable1.99 reports five style lints in unchanged core/clash sources; retained, no suppressions or core edits.'},
    'native_quality_groups':len(quality['cases']), 'native_box_navigation_groups':len(native['tests']),
    'native_interaction_groups':len(interactions['assertions']), 'export_oracle':oracle,
    'final_evidence':{'quality':'evidence/quality-r3-diagnostic/report.json',
        'box_navigation':'evidence/native-r3/smoke-native.json',
        'interactions':'evidence/interactions-r3/report.json',
        'export_oracle':'evidence/interactions-r3/five-selection-oracle.json',
        'large_SVD':'evidence/large-svd-r3/report.json','large_PVF':'evidence/large-pvf-r3/report.json'},
    'earlier_quality_attempt':{'report':'evidence/quality-r3/report.json',
        'disposition':'Retained failure: viewport height changed960->949px. Fresh instrumented final run passed with stable960px height and unchanged layout assertions.'},
    'large_models':{'SVD':svd,'PVF':pvf},
    'known_boundaries':['The original Box failure did not reproduce; retrospective root cause is unproven. Strengthened native pointer tests now pass.',
       'Synthetic EPSG:32760 federation refuses an unknown vertical datum, retaining local coordinates and a warning.',
       'Existing lint warning debt is retained. Registry/RustSec audits are point-in-time; async-std remains an unmaintained server dependency.',
       'Conditional fixture/cloud tests skip when prerequisites are unavailable.',
       'Native BCF durable outbox requires write/flush-capable ancestry.',
       'Optional Rust BOS retains fewer tables than the TS writer; table parity is outside this audit.',
       'Large-model counts and gestures do not establish universal geometry parity or a performance improvement.']}
write(release / 'qualification.json',qualification)
assert git('status','--porcelain','--untracked-files=no') == ''
tracked = subprocess.check_output(['git','ls-files','-z'],cwd=root).decode('utf-8').split('\0')
handoff_inputs = {p:digest(root / p) for p in tracked if p and (root / p).is_file()}
write(release / 'handoff-source-inputs.json', {'commit':git('rev-parse','HEAD'),'tracked_clean':True,'files_sha256':handoff_inputs})
shutil.copy2(audit / 'build-inputs-r3.json',release / 'source-inputs.json')
shutil.copy2(audit / 'package-inventory-final.json',release / 'package-inventory.json')
shutil.copy2(audit / 'package-test-qualification.json',release / 'package-test-qualification.json')
shutil.copy2(audit / 'preservation-final.json',release / 'preservation.json')
shutil.copy2(root / 'desktop/PACKAGES-AUDIT-10.4.0.md',release / 'PACKAGES-AUDIT-10.4.0.md')
logs=['typecheck-resumed.log','lint-resumed.log','lint-regressions-resumed.log','viewer-resumed.log',
      'create-canonical-final.log','mutations-final.log','packages-full-test.log',
      'dependency-audit-final.json','dependency-audit-resumed.json','desktop-dependency-audit.json',
      'desktop-dependency-audit-after.json','desktop-dependency-audit-resumed.json',
      'api-resumed.log','module-size-resumed.log','test-wiring-resumed.log','source-assertions-resumed.log','cesium-asset-parity-r3.json',
      'rust-audit-root.json','rust-audit-root-after.json','rust-audit-desktop.json','rust-workspace-final.log','rust-workspace-retake.log','rust-workspace-green.log',
      'rust-bos-final.log','rust-bos-golden-portable.log','rust-server-final.log',
      'rust-clippy-pinned.log','rust-clippy-stable199.log','native-root-closure-recheck.log','native-relink-comparison.json','desktop-windows-dependency-tree.txt','rust-dependency-update.log',
      'quality-r3.log','quality-r3-diagnostic.log']
logs += ['rust-workspace-green-summary.json','rust-bos-final-summary.json','large-orbit-poses.json','large-model-qualification.json']
logs += ['EXECUTION.md','api-resumed.log','viewer-qualification.json']
logs += ['rust-parquet-export.log','rust-parquet-export-retake.log','native-wall-units-red.log','native-wall-units-green.log']
evidence=release / 'evidence'; evidence.mkdir(exist_ok=True)
for name in logs: shutil.copy2(audit / name,evidence / name)
for name in ['quality-r3','quality-r3-diagnostic','native-r3','interactions-r3','large-svd-r3','large-pvf-r3']:
    dest=evidence / name; dest.mkdir(exist_ok=True)
    for p in (audit / name).iterdir():
        if p.is_file() and p.suffix in ['.json','.png','.log']: shutil.copy2(p,dest / p.name)
drivers = evidence / 'executed-drivers'; drivers.mkdir(exist_ok=True)
for p in [audit / 'quality-diagnostic.mjs',audit / 'final-interactions.mjs',audit / 'large-model.mjs',
          root / 'desktop/quality-smoke.mjs',root / 'desktop/smoke-webview2.mjs',root / 'research/colorizer-20261015/verify-ui.py']:
    shutil.copy2(p,drivers / p.name)
provenance={'created_utc':datetime.now(timezone.utc).isoformat(),'exe':str(release / 'IFC-Lite.exe'),
    'sha256':build['exe_sha256'],'bytes':build['exe_bytes'],'source_checkout':str(root),
    'source_branch':git('branch','--show-current'),'build_source_commit':build['build_source_commit'],
    'handoff_source_commit':git('rev-parse','HEAD'),'post_build_source_drift':drift,
    'headless_validation_source_commit':git('rev-parse','d636a260'),
    'post_build_drift_scope':'Headless workspace/server security closure, server ZIP/cache compatibility, optional BOS archive writer and audit documentation only. All desktop-active Rust/TS runtime sources, embedded frontend and standalone desktop lockfile are unchanged. The Windows dependency tree excludes server/cacache/ZIP/memmap2; parquet-bos is disabled. A separate standalone Cargo relink produced a different internal binary and was NOT substituted for the exact tested Tauri EXE.',
    'origin':git('remote','get-url','origin'),'wasm_sha256':build['wasm_sha256'],
    'upstream_package_source':'61d209288c1b117d405628ead302d0ee700bd2a0',
    'versions':{'host':'10.4.0','custom_viewer':'4.0.0','rust_engine':'20.4.0','wasm':'10.4.0'},
    'local_package_patch':'@ifc-lite/create cached native wall-axis units, pending patch changeset; no relabelled package version',
    'source_input_manifest_sha256':digest(release / 'source-inputs.json'),'preservation':preservation,
    'handoff_source_manifest_sha256':digest(release / 'handoff-source-inputs.json'),
    'publication':{'pushed':False,'github_actions_triggered':False,'deployed':False}}
write(release / 'provenance.json',provenance)
(release / 'README.txt').write_text('IFC-Lite 10.4.0 - bản kiểm chứng r3, 20/10/2026\n\nMở IFC-Lite.exe để chạy. Bản này nằm trong thư mục mới; các EXE cũ và mô hình gốc được giữ nguyên.\nInfo hiển thị đủ62 package nguồn. Giao diện riêng vẫn là4.0.0, core Rust20.4.0.\nĐã kiểm tra Box, điều hướng, Colorizer/xuất màu, bố cục và hai mô hình SVD/PVF trên chính EXE này.\nXem PACKAGES-AUDIT-10.4.0.md, qualification.json và provenance.json để tra kết quả, giới hạn còn lại và mã kiểm tra tệp.\nChưa push hay triển khai.\n',encoding='utf-8')
hashes={p.relative_to(release).as_posix():digest(p) for p in sorted(release.rglob('*')) if p.is_file() and p.name!='SHA256SUMS.json'}
write(release / 'SHA256SUMS.json',hashes)
print(json.dumps({'release':str(release),'sha256':build['exe_sha256'],'preserved_source_files':len(fingerprints),'evidence_files':len(hashes)},indent=2))
