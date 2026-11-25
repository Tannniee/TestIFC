# Đối chiếu Info và package IFC-Lite — 19/10/2026

## Kết luận

- Bản desktop r3 có 56 package trong Info; web đang có 62.
- 25 gói trùng phiên bản; 31 gói khác phiên bản; 6 gói chưa có trong bản desktop.
- Đây là khác biệt thật giữa các package, không phải chỉ một danh sách Info bị lưu phiên bản cũ.
- Đợt nâng trước cập nhật 15 gói trong chuỗi phụ thuộc của core, không đồng bộ toàn bộ sản phẩm web.
- Cả 62 nhãn phiên bản trên web hôm nay đều trùng mốc production được chọn ngày 17/10. Vì thế chênh lệch này đã có từ đợt tích hợp trước, không thể quy hết cho web mới đổi sau đó.

## Phạm vi xác minh

- Đọc trực tiếp Info > About > 62 packages tại https://www.ifclite.com/: viewer 5.1.5, ngày build hiển thị Oct 18, 2026.
- Tiến trình desktop người dùng đang mở có đường dẫn `F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-native-core-20261017-r3/IFC-Lite.exe`.
- Đọc cấu hình build và các manifest ở `F:/Steel/VBA/IFC-Lite-Core104`, HEAD c95361aa; không thay đổi source ứng dụng.
- Trích danh sách 56 package từ asset frontend `assets/main-BcFQ-a24.js`; SHA-256 của asset khớp bản ghi asset đã nhúng trong release r3. Danh sách này trùng các manifest hiện tại.
- Info gom mọi `packages/*/package.json` có name/version lúc build. Nó gồm cả CLI, bộ tạo dự án, server và fixture; số lượng không phải số module đang chạy và không trực tiếp đo tốc độ hoặc chất lượng.
- Không build EXE, không chạy model/test suite, không can thiệp model hay cửa sổ desktop đang mở.

## Phần core đã đồng bộ về số phiên bản

| Package | Desktop | Web |
| --- | --- | --- |
| wasm | 10.4.0 | 10.4.0 |
| parser | 9.5.1 | 9.5.1 |
| geometry | 7.8.1 | 7.8.1 |
| renderer | 6.4.0 | 6.4.0 |
| data | 6.2.0 | 6.2.0 |
| encoding | 2.3.0 | 2.3.0 |
| export | 4.11.0 | 4.11.0 |
| mutations | 3.2.0 | 3.2.0 |
| ifcx | 4.4.0 | 4.4.0 |
| pointcloud | 0.12.0 | 0.12.0 |
| spatial | 1.15.0 | 1.15.0 |
| load-trace | 0.3.0 | 0.3.0 |
| wasm-lifecycle | 0.2.0 | 0.2.0 |
| regex-guard | 0.3.0 | 0.3.0 |
| codegen | 1.18.1 | 1.18.1 |

Trùng số phiên bản không chứng minh mọi dòng mã giống upstream: các gói có phần nối native/renderer tùy biến được giữ có chủ đích.

## Các gói đang khác phiên bản

| Package | Desktop | Web |
| --- | --- | --- |
| @ifc-lite/bcf | 5.0.0 | 5.0.1 |
| @ifc-lite/bcf-api | 0.2.4 | 0.3.0 |
| @ifc-lite/cache | 3.7.0 | 3.7.2 |
| @ifc-lite/charts | 0.8.0 | 0.9.0 |
| @ifc-lite/cli | 0.38.2 | 0.41.0 |
| @ifc-lite/collab-server | 0.8.1 | 0.9.0 |
| @ifc-lite/create | 4.0.0 | 5.1.0 |
| @ifc-lite/documents-api | 0.2.0 | 0.2.1 |
| @ifc-lite/drawing-2d | 4.1.0 | 4.2.0 |
| @ifc-lite/embed-sdk | 1.15.0 | 1.15.1 |
| @ifc-lite/extensions | 0.10.1 | 0.11.0 |
| @ifc-lite/flow | 0.5.0 | 0.7.0 |
| @ifc-lite/flow-nodes | 0.6.0 | 0.10.0 |
| @ifc-lite/ids | 3.2.0 | 3.3.6 |
| @ifc-lite/lens | 2.1.0 | 2.2.0 |
| @ifc-lite/lists | 3.0.1 | 3.1.7 |
| @ifc-lite/mcp | 0.23.0 | 0.27.0 |
| @ifc-lite/oauth-pkce | 0.2.0 | 0.3.0 |
| @ifc-lite/opencde-foundation | 0.2.0 | 0.3.0 |
| @ifc-lite/plugin-api | 0.4.0 | 0.5.0 |
| @ifc-lite/rules | 0.6.0 | 0.7.7 |
| @ifc-lite/sandbox | 2.10.0 | 2.12.0 |
| @ifc-lite/sdk | 9.0.0 | 9.5.0 |
| @ifc-lite/server-bin | 2.0.0 | 2.0.1 |
| @ifc-lite/server-client | 4.0.0 | 4.0.1 |
| @ifc-lite/source-dalux | 0.4.0 | 0.4.1 |
| @ifc-lite/source-dropbox | 0.3.0 | 0.4.0 |
| @ifc-lite/source-fixture | 0.3.0 | 0.3.1 |
| @ifc-lite/source-msgraph | 0.3.0 | 0.4.0 |
| @ifc-lite/viewer-core | 0.2.25 | 0.2.26 |
| create-ifc-lite | 1.15.0 | 1.15.1 |

## Sáu gói chưa tích hợp

| Package | Phiên bản web | Vai trò từ manifest upstream |
| --- | --- | --- |
| @ifc-lite/ai | 0.2.0 | Provider-independent AI request core: transport contract, typed outcomes, root budgets, usage receipts and bounded JSON output parsing |
| @ifc-lite/ids-agent | 0.2.6 | Headless IDS authoring agent: a tool-calling loop over the IDS Studio op vocabulary, grounded by the gate, producing reviewable proposals |
| @ifc-lite/ids-authoring | 0.2.6 | Headless IDS authoring core: Studio document with stable node ids, typed invertible operations, a grounding gate against the IFC schema tables, history, sidecar and re-identification |
| @ifc-lite/report-contract | 0.1.0 | Shared reviewed error report protocol |
| @ifc-lite/semantic | 0.2.1 | Portable semantic datasets, profiles, validation and IFC identity resolution |
| @ifc-lite/source-autodesk | 0.2.1 | Autodesk Forma and Data Exchange cloud-source provider for ifc-lite |

## Hướng nâng tiếp

Ưu tiên các gói tính năng đang được dùng, theo chuỗi phụ thuộc: SDK/sandbox/create/flow; dữ liệu và kiểm tra IDS/rules/lens/lists/charts/drawing; rồi nhóm cloud/AI và các tính năng mới cần thiết. Gói create có đổi major 4 → 5 nên cần ghép API và hành vi thật, không chỉ sửa manifest.
Info nên bổ sung phiên bản host, Rust engine và mốc nguồn để người dùng phân biệt giao diện tùy biến với core. Giữ số phiên bản và danh sách theo thành phần thực tế của build.

## Mốc nguồn và giới hạn

- Mốc nâng trước: [61d209288c1b117d405628ead302d0ee700bd2a0](https://github.com/LTplus-AG/ifc-lite/tree/61d209288c1b117d405628ead302d0ee700bd2a0).
- Production hiện tại: [68a29e79e4f22acfce61d3e235015876bbffee92](https://github.com/LTplus-AG/ifc-lite/tree/68a29e79e4f22acfce61d3e235015876bbffee92).
- [Cách upstream thu danh sách package](https://github.com/LTplus-AG/ifc-lite/blob/68a29e79e4f22acfce61d3e235015876bbffee92/apps/viewer/vite.config.ts).
- [Manifest Rust của production hiện tại](https://github.com/LTplus-AG/ifc-lite/blob/68a29e79e4f22acfce61d3e235015876bbffee92/Cargo.toml) đã là 21.4.0; native desktop vẫn 20.4.0 như mốc chốt trước. Bảng npm trong Info không phản ánh khác biệt Rust này.
- Không khẳng định phiên bản Rust của WASM đang chạy trên web chỉ từ nhãn npm 10.4.0. Cần đối chiếu artifact/mốc build nếu thực hiện đợt nâng tiếp.
- Chi tiết từng gói và bằng chứng hash: `audit.json`.
