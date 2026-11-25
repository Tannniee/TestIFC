from pathlib import Path
import json
import shutil
import subprocess
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
audit = root / 'research/core-upgrade-20261017'
release = Path(r'F:\Steel\VBA\IFC-Lite\desktop\release\10.4.0-native-core-20261017-r3')
provenance = json.loads((release / 'provenance.json').read_text(encoding='utf-8'))
qualification = {
    'handoff_status': 'completed; additional testing stopped at the explicit user request',
    'final_r3': {'quality_groups_passed': 14, 'page_errors': 0,
        'backend_engine_version_observed': '20.4.0',
        'window_title_observed': 'IFC-Lite 10.4.0 — Native Preview',
        'extended_native_smoke': 'first Box sweep failed; subsequent attempt interrupted at user request',
        'interactions_53_rerun': 'not run; user requested stopping further testing',
        'large_models_rerun': 'not run; user requested stopping further testing'},
    'r2_prior_candidate': {'native_cases_passed': 29, 'interaction_assertions_passed': 53,
        'quality_groups_passed': 14,
        'svd_883MB': 'native load/orbit/pan/zoom/selection/clear/ordinary close passed',
        'pvf_1411MB': 'instrumented isolated native load/orbit/pan/zoom/selection/clear/ordinary close passed',
        'ifc_oracles': 'IfcOpenShell: all 14509 Body items correct; 184677 other records unchanged; world geometry samples unchanged',
        'panel_pixel_oracle': 'zero changed pixels in all three 297x178 panel regions during orbit',
        'runtime_difference_from_r3': 'only the native window title was changed to derive from the host package version'},
    'source': {'rust_workspace_passed': 4796, 'rust_ignored': 41,
        'viewer_passed': 13794, 'viewer_conditional_skips': 25,
        'other_package_tasks_passed': 57, 'typecheck_tasks_passed': 111,
        'test_files_typechecked': 3346, 'wasm_contract_passed': 193, 'wasm_optional_skips': 7,
        'desktop_tests_passed': 33, 'python_consumer_tests_passed': 4,
        'docs_snippets_compiled': 437, 'docs_documents': 102,
        'rust_workspace_and_desktop_clippy': 'passed with warnings denied',
        'aggregate_pnpm_lint': 'not green: pre-existing Windows pnpm shim ENOENT'},
    'follow_up': ['Reproduce and qualify the final Box sweep with remembered section mode and covering docks.',
        'Investigate the earlier r2 PVF page disconnect if it recurs; instrumented isolated rerun passed.',
        'Complete extra r3 native/interaction/large-model reruns when requested.',
        'Resolve the root Windows pnpm lint launcher before claiming aggregate lint green.'],
    'evidence_root': str(audit),
    'performance': 'Interleaved bounded native A/B: identical ordered mesh fingerprints/counts; no observed slowdown. No browser worker-pool or FPS claim.'}
provenance['qualification'] = qualification
provenance['handoff_documentation_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
provenance['completed_utc'] = datetime.now(timezone.utc).isoformat()
(release / 'provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')
(release / 'qualification.json').write_text(json.dumps(qualification, indent=2), encoding='utf-8')
verification = release / 'verification'
verification.mkdir(exist_ok=True)
files = {
    'r3-quality/report.json': 'r3-quality.json',
    'r3-native/smoke-native.json': 'r3-native-box-follow-up.json',
    'r3-native/failure.png': 'r3-native-box-follow-up.png',
    'r2-native/smoke-native.json': 'r2-native.json',
    'r2-interactions/report.json': 'r2-interactions.json',
    'r2-quality/five-selection-oracle.json': 'r2-gray-ifc-oracle.json',
    'r2-interactions/five-selection-oracle.json': 'r2-selected-ifc-oracle.json',
    'r2-quality/pixel-oracle.json': 'r2-panel-pixel-oracle.json',
    'r2-svd/report.json': 'r2-svd.json',
    'r2-svd/loaded.png': 'r2-svd-loaded.png',
    'r2-pvf/report.json': 'r2-pvf-earlier-disconnect.json',
    'r2-pvf-diagnostic/report.json': 'r2-pvf-isolated-pass.json',
    'r2-pvf-diagnostic/loaded.png': 'r2-pvf-loaded.png',
    'preservation-final.json': 'preservation.json',
}
for source, destination in files.items():
    shutil.copy2(audit / source, verification / destination)
shutil.copy2(root / 'desktop/CORE-UPGRADE-10.4.0.md', release / 'CORE-UPGRADE-10.4.0.md')
(release / 'IFC-Lite.exe.sha256').write_text(provenance['sha256'] + '  IFC-Lite.exe\n', encoding='utf-8')
(release / 'README.vi.md').write_text('''# IFC-Lite — core 10.4, bản desktop tùy biến

Mở `IFC-Lite.exe` trong thư mục này. Core Rust đã nâng lên 20.4.0,
WASM 10.4.0; phiên bản giao diện riêng vẫn là 4.0.0. Các panel, theme,
Colorizer, điều hướng TestIFC, cube, section, federation/GIS và đường native
được giữ trong mã nguồn tích hợp.

Mã nguồn: `F:/Steel/VBA/IFC-Lite-Core104`, nhánh
`codex/core-10.4.0-upgrade`. Mốc upstream và mã kiểm tra nguồn/EXE nằm trong
`provenance.json` và `source-inputs.json`. Bản cũ, nguồn gốc và model được giữ nguyên.

Bản EXE r3 này đã qua 14/14 nhóm kiểm tra chất lượng, không có lỗi trang.
Bản r2 trước đó qua 29 kiểm tra native, 53 khẳng định tương tác, đọc lại IFC
bằng công cụ độc lập, cùng các thao tác thật trên SVD 883 MB và PVF 1,41 GB.
r3 chỉ đổi thêm tiêu đề cửa sổ native để theo đúng phiên bản host.

Theo yêu cầu của bạn, đã dừng các lượt kiểm tra bổ sung. Lượt Box cuối trên
r3 chưa qua; ảnh và log được giữ để xem tiếp. Lệnh lint tổng cũng còn lỗi
khởi chạy pnpm có sẵn trên Windows. Các mục này được ghi rõ trong
`CORE-UPGRADE-10.4.0.md` và `qualification.json`, không tính là đã kiểm tra đạt.

Không push, không chạy GitHub Actions, không phát hành lên mạng.
''', encoding='utf-8')
with (audit / 'EXECUTION.md').open('a', encoding='utf-8') as stream:
    stream.write('\n\n## Final handoff\n\n'
        + 'User explicitly requested completion and no further tests. The active extra smoke pipeline was interrupted and no owned test app remains. '
        + 'Native r3 was built from b54d6ff7; only the native title changed from r2. '
        + 'Final r3 quality14 passed; its first extended native attempt failed at the Box sweep. '
        + 'The unqualified harness experiment was removed; no runtime change was made to hide the result. '
        + 'R2 native29, interaction53, both independent IFC colour readbacks, panel pixels, SVD and isolated PVF native checks passed. '
        + 'The early r2 PVF page disconnect and r3 Box failure are explicitly retained as follow-up. '
        + 'Final EXE: ' + str(release / 'IFC-Lite.exe') + ', SHA256 ' + provenance['sha256'] + '. '
        + 'All three source layers committed locally; documentation handoff commit ' + provenance['handoff_documentation_commit'] + '. '
        + 'Original240 source hashes and protected old EXE matched. No push, Actions or deployment.\n')
print(json.dumps({'release': str(release), 'exe_sha256': provenance['sha256'],
    'native_build_commit': provenance['source_commit'],
    'handoff_commit': provenance['handoff_documentation_commit'],
    'evidence_files_copied': len(files)}, indent=2))
