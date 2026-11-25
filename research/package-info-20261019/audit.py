from pathlib import Path
import subprocess
import json
import re
import hashlib

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
pin = '61d209288c1b117d405628ead302d0ee700bd2a0'
current_production = '68a29e79e4f22acfce61d3e235015876bbffee92'
# Actual visible Info > About > 62 packages, read on 2026-10-19.
web_text = '''ai 0.2.0 bcf 5.0.1 bcf-api 0.3.0 cache 3.7.2 charts 0.9.0 clash 2.4.4 cli 0.41.0 codegen 1.18.1 collab 0.10.0 collab-server 0.9.0 create 5.1.0 data 6.2.0 diff 0.10.0 documents-api 0.2.1 drawing-2d 4.2.0 embed-protocol 1.15.0 embed-sdk 1.15.1 encoding 2.3.0 export 4.11.0 extensions 0.11.0 flow 0.7.0 flow-nodes 0.10.0 geometry 7.8.1 ids 3.3.6 ids-agent 0.2.6 ids-authoring 0.2.6 ifcx 4.4.0 lens 2.2.0 lists 3.1.7 load-trace 0.3.0 mcp 0.27.0 merge 0.4.7 mutations 3.2.0 oauth-pkce 0.3.0 opencde-foundation 0.3.0 parser 9.5.1 plugin-api 0.5.0 pointcloud 0.12.0 provenance 0.2.0 query 2.5.2 regex-guard 0.3.0 renderer 6.4.0 report-contract 0.1.0 rules 0.7.7 sandbox 2.12.0 sdk 9.5.0 semantic 0.2.1 server-bin 2.0.1 server-client 4.0.1 solar 1.15.5 source-autodesk 0.2.1 source-dalux 0.4.1 source-dropbox 0.4.0 source-fixture 0.3.1 source-msgraph 0.4.0 spatial 1.15.0 timing-ladder 0.1.0 viewer-core 0.2.26 wasm 10.4.0 wasm-lifecycle 0.2.0 world-frame-fixtures 0.1.4 create-ifc-lite 1.15.1'''
tokens = web_text.split()
web = {name if name == 'create-ifc-lite' else '@ifc-lite/' + name: version for name, version in zip(tokens[::2], tokens[1::2])}
local = {}
for path in (root / 'packages').glob('*/package.json'):
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('name') and data.get('version'):
        local[data['name']] = {'version': data['version'], 'path': path.relative_to(root).as_posix(), 'description': data.get('description')}
paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', pin, 'packages/'], cwd=root, text=True).splitlines()
pinned = {}
for path in paths:
    if re.fullmatch(r'packages/[^/]+/package.json', path):
        data = json.loads(subprocess.check_output(['git', 'show', f'{pin}:{path}'], cwd=root, text=True, encoding='utf-8'))
        if data.get('name') and data.get('version'):
            pinned[data['name']] = {'version': data['version'], 'path': path, 'description': data.get('description')}
rows = []
for name in sorted(set(web) | set(local)):
    lv = local.get(name, {}).get('version')
    wv = web.get(name)
    rows.append({'name': name, 'local': lv, 'production_pin_17Oct': pinned.get(name, {}).get('version'),
        'web_info_19Oct': wv, 'status': 'missing_locally' if lv is None else 'local_only' if wv is None else 'same_version' if lv == wv else 'different_version',
        'description': pinned.get(name, local.get(name, {})).get('description')})
release = Path(r'F:\Steel\VBA\IFC-Lite\desktop\release\10.4.0-native-core-20261017-r3')
manifest = json.loads((release / 'source-inputs.json').read_text(encoding='utf-8'))
info_files = []
bundle_pattern = re.compile(r'["\'`]?\bname["\'`]?\s*:\s*["\'`](@ifc-lite/[^"\'`]+|create-ifc-lite)["\'`]\s*,\s*["\'`]?version["\'`]?\s*:\s*["\'`]([^"\'`]+)["\'`]')
for path in (root / 'apps/viewer/dist/assets').glob('*.js'):
    text = path.read_text(encoding='utf-8')
    pairs = bundle_pattern.findall(text)
    if len(pairs) > 40:
        relative = path.relative_to(root / 'apps/viewer/dist').as_posix()
        info_files.append({'file': relative, 'packages': dict(pairs), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'matches_delivered_asset_hash': hashlib.sha256(path.read_bytes()).hexdigest() == manifest['embedded_frontend_files_sha256'].get(relative)})
summary = {'checked_date_local': '2026-10-19', 'web_url': 'https://www.ifclite.com/', 'web_info_build_date': 'Oct 18, 2026',
    'web_viewer_version': '5.1.5', 'desktop_viewer_version': '4.0.0',
    'original_upgrade_pin': pin, 'current_production_head': current_production,
    'local_packages': len(local), 'pinned_production_packages': len(pinned), 'live_web_info_packages': len(web),
    'same_version_count': sum(r['status'] == 'same_version' for r in rows),
    'different_version_count': sum(r['status'] == 'different_version' for r in rows),
    'missing_locally_count': sum(r['status'] == 'missing_locally' for r in rows),
    'local_only_count': sum(r['status'] == 'local_only' for r in rows),
    'web_versions_differing_from_original_pin': [name for name, version in web.items() if pinned.get(name, {}).get('version') != version],
    'delivered_asset_info_candidates': info_files, 'packages': rows}
(out / 'audit.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
lines = ['# Đối chiếu Info và package IFC-Lite — 19/10/2026', '',
    '## Kết luận', '',
    '- Bản desktop r3 có 56 package trong Info; web đang có 62.',
    '- 25 gói trùng phiên bản; 31 gói khác phiên bản; 6 gói chưa có trong bản desktop.',
    '- Đây là khác biệt thật giữa các package, không phải chỉ một danh sách Info bị lưu phiên bản cũ.',
    '- Đợt nâng trước cập nhật 15 gói trong chuỗi phụ thuộc của core, không đồng bộ toàn bộ sản phẩm web.',
    '- Cả 62 nhãn phiên bản trên web hôm nay đều trùng mốc production được chọn ngày 17/10. Vì thế chênh lệch này đã có từ đợt tích hợp trước, không thể quy hết cho web mới đổi sau đó.', '',
    '## Phạm vi xác minh', '',
    '- Đọc trực tiếp Info > About > 62 packages tại https://www.ifclite.com/: viewer 5.1.5, ngày build hiển thị Oct 18, 2026.',
    '- Tiến trình desktop người dùng đang mở có đường dẫn `F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-native-core-20261017-r3/IFC-Lite.exe`.',
    '- Đọc cấu hình build và các manifest ở `F:/Steel/VBA/IFC-Lite-Core104`, HEAD c95361aa; không thay đổi source ứng dụng.',
    '- Trích danh sách 56 package từ asset frontend `assets/main-BcFQ-a24.js`; SHA-256 của asset khớp bản ghi asset đã nhúng trong release r3. Danh sách này trùng các manifest hiện tại.',
    '- Info gom mọi `packages/*/package.json` có name/version lúc build. Nó gồm cả CLI, bộ tạo dự án, server và fixture; số lượng không phải số module đang chạy và không trực tiếp đo tốc độ hoặc chất lượng.',
    '- Không build EXE, không chạy model/test suite, không can thiệp model hay cửa sổ desktop đang mở.', '',
    '## Phần core đã đồng bộ về số phiên bản', '',
    '| Package | Desktop | Web |', '| --- | --- | --- |']
for name in ['wasm', 'parser', 'geometry', 'renderer', 'data', 'encoding', 'export', 'mutations', 'ifcx', 'pointcloud', 'spatial', 'load-trace', 'wasm-lifecycle', 'regex-guard', 'codegen']:
    row = next(r for r in rows if r['name'] == '@ifc-lite/' + name)
    lines.append(f"| {name} | {row['local']} | {row['web_info_19Oct']} |")
lines += ['', 'Trùng số phiên bản không chứng minh mọi dòng mã giống upstream: các gói có phần nối native/renderer tùy biến được giữ có chủ đích.', '',
    '## Các gói đang khác phiên bản', '', '| Package | Desktop | Web |', '| --- | --- | --- |']
for row in rows:
    if row['status'] == 'different_version':
        lines.append(f"| {row['name']} | {row['local']} | {row['web_info_19Oct']} |")
lines += ['', '## Sáu gói chưa tích hợp', '', '| Package | Phiên bản web | Vai trò từ manifest upstream |', '| --- | --- | --- |']
for row in rows:
    if row['status'] == 'missing_locally':
        lines.append(f"| {row['name']} | {row['web_info_19Oct']} | {row['description']} |")
lines += ['', '## Hướng nâng tiếp', '',
    'Ưu tiên các gói tính năng đang được dùng, theo chuỗi phụ thuộc: SDK/sandbox/create/flow; dữ liệu và kiểm tra IDS/rules/lens/lists/charts/drawing; rồi nhóm cloud/AI và các tính năng mới cần thiết. Gói create có đổi major 4 → 5 nên cần ghép API và hành vi thật, không chỉ sửa manifest.',
    'Info nên bổ sung phiên bản host, Rust engine và mốc nguồn để người dùng phân biệt giao diện tùy biến với core. Giữ số phiên bản và danh sách theo thành phần thực tế của build.', '',
    '## Mốc nguồn và giới hạn', '',
    f'- Mốc nâng trước: [{pin}](https://github.com/LTplus-AG/ifc-lite/tree/{pin}).',
    f'- Production hiện tại: [{current_production}](https://github.com/LTplus-AG/ifc-lite/tree/{current_production}).',
    f'- [Cách upstream thu danh sách package](https://github.com/LTplus-AG/ifc-lite/blob/{current_production}/apps/viewer/vite.config.ts).',
    f'- [Manifest Rust của production hiện tại](https://github.com/LTplus-AG/ifc-lite/blob/{current_production}/Cargo.toml) đã là 21.4.0; native desktop vẫn 20.4.0 như mốc chốt trước. Bảng npm trong Info không phản ánh khác biệt Rust này.',
    '- Không khẳng định phiên bản Rust của WASM đang chạy trên web chỉ từ nhãn npm 10.4.0. Cần đối chiếu artifact/mốc build nếu thực hiện đợt nâng tiếp.',
    '- Chi tiết từng gói và bằng chứng hash: `audit.json`.']
(out / 'REPORT.vi.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k not in ['packages', 'delivered_asset_info_candidates']}, ensure_ascii=False, indent=2))
print('MISSING:', json.dumps([r for r in rows if r['status'] == 'missing_locally'], ensure_ascii=False))
print('DIFFERENT:', json.dumps([r for r in rows if r['status'] == 'different_version'], ensure_ascii=False))
print('BUNDLE:', json.dumps(info_files, ensure_ascii=False))
