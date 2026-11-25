from pathlib import Path
import hashlib,json,subprocess,shutil
from datetime import datetime,timezone
root=Path(__file__).resolve().parents[2]
audit=root/'research/packages-full-20261019'
original=Path('F:/Steel/VBA/IFC-Lite')
release=original/'desktop/release/10.4.0-full-packages-20261019-r1'
assert release.resolve().parent== (original/'desktop/release').resolve()
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True,encoding='utf8').strip()
head=git('rev-parse','HEAD');assert head.startswith('17bf338d')
assert not git('status','--porcelain','-uno')
exe=release/'IFC-Lite.exe';expected='9e4bfb5d6d3594172735d5b453a6f93fb56bf678e0dccd660a9734a30f3380a1';assert sha(exe)==expected
quality=json.loads((audit/'packaged-quality/report.json').read_text());assert len(quality['cases'])==15 and all(c['ok'] for c in quality['cases']) and not quality['errors']
comparison=json.loads((audit/'package-comparison.json').read_text());assert comparison['count']==62 and not comparison['version_mismatches']
preserve=json.loads((audit/'preservation.json').read_text());assert not preserve['source_drift'] and preserve['previous_r3_preserved']
old=original/'desktop/release/10.4.0-native-core-20261017-r3/IFC-Lite.exe';assert sha(old)==preserve['previous_r3_exe_sha256']
model=Path(quality['model']);assert sha(model)=='df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2'
qualified={'status':'passed with explicit scope and existing conditional skips',
 'root_package_build_tasks':{'passed':62,'total':62},
 'package_tests':{'covered_packages':62,'method':'composite full package suites plus corrected CLI cases; not a single green62-task run',
   'original_59_successful_suites':'.turbo/runs/3KtZ1xuVx51ljpbllAysWbDSH79.json',
   'mcp':{'passed':735,'conditional_skips':5,'log':'packages-tests-6.log'},
   'flow_nodes':{'passed':248,'conditional_skips':16,'log':'flow-nodes-qualified.log'},
   'cli':{'unique_passed':1471,'conditional_skips':16,'full_log':'packages-tests-6.log','corrected_cases_log':'cli-corrected-qualified.log','final_exact_process_log':'cli-exact-process-qualified.log','final_filter_excluded_previously_passed_cases':7}},
 'root_typecheck':{'passed_tasks':120,'total_tasks':120,'test_files_covered':3597,'log':'typecheck-final-handoff.log'},
 'viewer_selected_tests':{'passed':294,'skipped':0,'log':'viewer-tests.log'},
 'packaged_quality':{'passed':15,'total':15,'page_errors':0,'report':'reports/packaged-quality.json','info_packages':62},
 'documentation_snippets':{'compiled':474,'documents':115,'marked_illustrative_skips':12},
 'api_snapshot':{'published_packages':57,'export_surfaces':104,'exports':10198},
 'bim_globals_namespaces':14,'templates':'passed','readmes':'57 published packages passed',
 'module_size':{'added_budgets':0,'raised_budgets':0,'removed_obsolete_rows':6},
 'source_assertions':{'allowlisted':29,'marked':191,'new':0},'targeted_lint':'passed',
 'aggregate_lint':'not requalified; prior Windows pnpm shim ENOENT remains documented',
 'evidence_root':str(audit)}
paths=[p for p in subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0') if p]
manifest={'source_commit':head,'source_files_sha256':{p:sha(root/p) for p in paths if (root/p).is_file()},
 'embedded_frontend_files_sha256':{p.relative_to(root/'apps/viewer/dist').as_posix():sha(p) for p in sorted((root/'apps/viewer/dist').rglob('*')) if p.is_file()},
 'build_base_commit':'c95361aa572694ecdd6f1e75c50e38b09d4bd593','tracked_dirty_at_build':True,
 'note':'The artifact was built from the upgraded working tree based on c95361aa. Final commit captures that production source plus later tests/docs. No production source file was modified after the artifact build; later edits were test portability/deadlines and documentation.'}
(release/'source-inputs.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
(release/'qualification.json').write_text(json.dumps(qualified,indent=2),encoding='utf8')
(release/'package-comparison.json').write_text(json.dumps(comparison,indent=2),encoding='utf8')
reports=release/'reports';reports.mkdir(exist_ok=True)
shutil.copy2(audit/'packaged-quality/report.json',reports/'packaged-quality.json')
shutil.copy2(audit/'packaged-quality/package-info.png',reports/'package-info.png')
shutil.copy2(audit/'preservation.json',reports/'preservation.json')
shutil.copy2(root/'desktop/PACKAGES-FULL-10.4.0.md',release/'PACKAGES-FULL-10.4.0.md')
provenance={'created_utc':datetime.now(timezone.utc).isoformat(),'exe':str(exe),'sha256':expected,'bytes':exe.stat().st_size,
 'source_checkout':str(root),'source_branch':git('branch','--show-current'),'source_commit':head,'source_tracked_clean_at_handoff':True,
 'origin':git('remote','get-url','origin'),'upstream_package_source_pin':comparison['source_pin'],
 'versions':{'custom_viewer':'4.0.0','host':'10.4.0','rust_engine':'20.4.0','wasm':'10.4.0','workspace_packages':62,'published_packages':57},
 'build':{'command':'node desktop/build-native-preview.mjs; VITE_IFCLITE_NATIVE=1; RUSTUP_TOOLCHAIN=stable','base_commit':manifest['build_base_commit'],'tracked_dirty_at_build':True,'production_sources_modified_after_build':[],'source_inputs_sha256':sha(release/'source-inputs.json')},
 'wasm_sha256':sha(root/'packages/wasm/pkg/ifc-lite_bg.wasm'),
 'model':{'path':str(model),'sha256':sha(model),'bytes':model.stat().st_size,'triangles':quality['loaded']['triangles']},
 'preservation':preserve,'qualification':qualified,
 'limitations':['No new Rust21.4 or complete upstream web5.1.5 interface migration.',
 'Info is the complete workspace catalogue, not a runtime SBOM; headless/provider APIs do not imply new web panels.',
 'Native BCF journal requires write-capable directory flushing through its volume ancestry; unsupported default homes fail closed. Configure IFCLITE_BCF_OUTBOX_DIR accordingly.',
 'No live cloud-account qualification, full external-fixture corpus, universal geometry parity or new SVD/PVF performance claim.',
 'Previously deferred extended Box gesture sweep remains deferred.',
 'Aggregate lint wrapper was not requalified; targeted lint and recorded structural gates passed.'],
 'publication':{'pushed':False,'github_actions_triggered':False,'deployed':False}}
assert provenance['wasm_sha256']=='06b5b05d47c7ca8744fb04da240c7c00390b11b7187e454d1f33e0daa8b106d6'
(release/'provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf8')
(release/'SHA256SUMS.txt').write_text(expected+'  IFC-Lite.exe\n',encoding='utf8')
(release/'README.txt').write_text('''IFC-Lite 10.4.0 — Full packages, 2026-10-19 r1

Mở IFC-Lite.exe. Bản này nằm trong thư mục mới; bản core r3 cũ được giữ nguyên.
Đã đồng bộ đủ62 thư viện theo nguồn61d2092, gồm6 gói mới. Info hiển thị đúng62
package và phiên bản. Viewer4.0.0 là giao diện riêng, Rust20.4/WASM10.4 là core.

Giữ Colorizer, panel/canvas, TestIFC navigation/section và native transport.
15/15 nhóm kiểm tra trên đúng EXE với mô hình hangar thật đã qua;294 test UI và
root typecheck120/120 đã qua. Kiểm tra package dùng các lượt chạy/kiểm tra lại
được ghi riêng trong qualification.json, có các ca bỏ qua có điều kiện sẵn có.

Chi tiết phạm vi và điều kiện lưu BCF trên Windows: PACKAGES-FULL-10.4.0.md.
Nguồn, hash và giới hạn: provenance.json, source-inputs.json, SHA256SUMS.txt.
Chưa kiểm tra tài khoản cloud thật hoặc đo lại toàn bộ mô hình lớn.
Không push, không Actions, không triển khai lên web.
''',encoding='utf8')
(audit/'qualification.json').write_text(json.dumps(qualified,indent=2),encoding='utf8')
print(json.dumps({'release':str(release),'sha256':expected,'bytes':exe.stat().st_size,'source_commit':head,'source_files':len(manifest['source_files_sha256']),'embedded_files':len(manifest['embedded_frontend_files_sha256']),'quality_groups_passed':15,'workspace_packages':62}))
