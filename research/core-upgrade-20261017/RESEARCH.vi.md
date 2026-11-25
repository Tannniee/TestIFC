# Nghiên cứu nâng core IFC-Lite, giữ bản desktop tùy biến

Ngày kiểm tra: **17/10/2026**, múi giờ Asia/Bangkok.

## Kết luận

Upstream hiện có **viewer 5.1.5**; bản của chúng ta là **viewer 4.0.0**.
Đó là phiên bản giao diện. Core có nhiều gói với phiên bản riêng: bản local
dùng WASM 10.3.0 và Rust 20.3.0; nhánh phục vụ web hiện dùng WASM 10.4.0
và Rust 20.4.0.

**Đề xuất nâng core theo từng lớp, lấy commit của nhánh `production`
`61d209288c1b117d405628ead302d0ee700bd2a0` làm mốc đầu tiên.** Giữ host
desktop và hành vi tùy biến hiện tại, cập nhật các chỗ nối cần thiết theo API
mới. Sau đó đánh giá phần thay đổi mới hơn trên `main` riêng. Việc chọn
`production` giúp đối chiếu với kênh web hiện tại; không phải chứng nhận rằng
toàn bộ mã ở đó đã được kiểm thử trên bản desktop của chúng ta.

Đợt này hoàn tất nghiên cứu nguồn, bản đồ xung đột và kế hoạch kiểm chứng.
Chưa ghép core, cài dependency, build EXE hay chạy lại mô hình.

## 1. Mốc nguồn đã xác minh

| Thành phần | Local hiện tại | Upstream production | Upstream main |
| --- | --- | --- | --- |
| Viewer | 4.0.0 | 5.1.5 | 5.1.5 |
| Root monorepo | 10.3.0 | 10.4.0 | 10.4.0 |
| WASM | 10.3.0 | 10.4.0 | 10.4.0 |
| Rust workspace | 20.3.0 | 20.4.0 | **21.4.0** |
| Parser | 9.2.0 | 9.5.1 | 9.5.1 |
| Geometry | 7.7.0 | 7.8.1 | 7.8.1 |
| Renderer | 6.0.1 | 6.4.0 | 6.4.0 |
| Data | 6.1.0 | 6.2.0 | 6.2.0 |
| Spatial | 1.15.0 | 1.15.0 | 1.15.0 |
| Export (TS) | 4.9.0 | 4.11.0 | 4.11.0 |

- Checkout: `F:/Steel/VBA/IFC-Lite`.
- Nhánh local: `codex/desktop-v10.3.0`.
- HEAD local: `471284f476d64a659ae607eeec2115ca3afcb9fe`.
- Nền upstream gốc: tag `v10.3.0`, commit
  `e79f27342beb01a6f30d9b63c44795ecd118f4de`, ngày 01/10/2026.
- Origin đang cấu hình: `https://github.com/LTplus-AG/ifc-lite.git`.
- `production`: `61d209288c1b117d405628ead302d0ee700bd2a0`.
- `main`: `74d097d01f96df892ffa09e69c5c82e628be7d5c`.

Nhãn ở thanh trạng thái lấy `__APP_VERSION__`; Vite lấy giá trị này từ
`apps/viewer/package.json`. Vì vậy nhãn 4.0.0 không có nghĩa Rust cũng là
4.0.0. Chỉ đổi nhãn sang 5.1.5 không nâng bất kỳ thuật toán nào.

`main` đã có thay đổi Rust phá tương thích và nâng major, trong khi các số
phiên bản npm ở bảng vẫn giống `production`. Hai nhánh khác nhau **421 tệp**.
Cần khóa SHA và nguồn artifact; số phiên bản gói không đủ xác định mã chạy.
Ngay cả `production` cũng đã có mở rộng struct xuất STEP cần kiểm tra lại.

## 2. Phạm vi thay đổi và kết quả ghép thử

Đối chiếu cây tệp với nền `e79f2734`, bao gồm phần local đã commit và nội dung
tracked đang sửa. Ghép thử từng tệp trong thư mục tạm bằng three-way merge,
chuẩn hóa CRLF/LF để tránh báo xung đột chỉ do xuống dòng. Không áp dụng kết
quả ghép vào checkout.

| Phép đối chiếu | production | main |
| --- | ---: | ---: |
| Tệp upstream thay đổi so với nền gốc | 8.370 | 8.686 |
| Trùng với tệp tracked đã tùy biến local | 87 | 89 |
| Tệp có xung đột văn bản khi ghép thử | 35 | 36 |
| Đường dẫn untracked local đụng tệp upstream | 0 | 0 |

Các con số toàn repo gồm mã, test, tài liệu và tính năng ngoài core.
35 xung đột của production gồm 28 tệp viewer, 4 tệp renderer, 1 tệp dịch vụ
dữ liệu server và 2 tệp snapshot/ledger. Ghép văn bản sạch vẫn có thể sai
ngữ nghĩa; đây chưa phải bằng chứng biên dịch hay chạy đúng.

Riêng production thay đổi 22 tệp Rust core, 63 geometry, 59 processing,
97 export và 18 wasm-bindings. Phía TypeScript có 96 tệp parser, 42 geometry,
124 renderer, 11 data, 2 spatial và 56 export.

Checkout hiện có **150 tệp tracked đang sửa**; delta tracked so với nền gốc
là **269 tệp**, còn có nhiều tệp untracked chứa tính năng và bằng chứng.
Chỉ tạo nhánh từ HEAD sẽ bỏ sót phần đang dùng nhưng chưa commit.
Checkout là shallow: báo cáo dùng so sánh cây tệp với SHA nền đã xác định,
không suy diễn số commit đi trước/đi sau từ một merge-base thiếu lịch sử.

## 3. Các đặc trưng phải giữ

| Đặc trưng | Điểm nối cần bảo toàn | Điều kiện kiểm chứng sau nâng |
| --- | --- | --- |
| Native Rust x64 và dữ liệu BIM theo luồng | `desktop/src-tauri`, `desktop/native-*`, `hooks/ingest/nativeIfc*`; có tái sử dụng module `apps/server/src/services/data_model` | STEP dùng native; không đưa toàn bộ source vào WebView2; tiến độ, hủy, thay model, đóng sạch |
| Colorizer và Save as | `rust/export/src/colorizer`, `desktop/src-tauri/src/colorizer.rs`, `lib/colorizer`, `ColorizerWorkspace` | Giữ draft qua đóng/mở/split panel; undo/redo; tô đúng model trong federation; xuất và mở lại IFC |
| Điều hướng TestIFC, cube, Home, pan/orbit/zoom | Camera renderer, `useTestIfcNavigation`, mouse/touch controls | Trục Y-up, pivot, damping, Home và chuyển góc nhìn đúng; thao tác thật trên EXE |
| Section box TestIFC | `lib/section/testifc-box-controller`, SectionPanel/Toolbar, state | Chọn/cắt/đổi box-plane, hủy và đổi model không dùng state cũ |
| Giao diện, Black OLED, panel và chuyển động | ViewerLayout, StableViewport, DrawingWorkspaceSplit, SidebarDock, panel-motion | Mở panel không trôi camera; nền panel kín; Drawing không hủy canvas; reduced motion và thao tác nhanh đúng |
| Khả năng xử lý model lớn | Chia gói IPC, instanced packing, queue drain, cooperative semantics, BVH pick candidates, navigation quality | Đo tải lạnh, RAM, tương tác và đóng trên đúng model; giữ parity lựa chọn và hình học |
| Federation và BIM-GIS | `loadFile`, resolveEntityRef/modelSlice, FederationRegistry, RTC và placement | Kiểm tra 1 model và nhiều model; đúng chủ sở hữu ID; màu, chọn, đơn vị, tọa độ và clipping nhất quán |

Host desktop là phần phát triển riêng của chúng ta. Upstream vẫn cung cấp
toolkit web và điểm mở rộng cho Tauri; cập nhật upstream không thay thế được
host này.

## 4. Những thay đổi đáng lấy về

Đây là nội dung từ nguồn/changelog upstream, chưa phải kết quả đo trên desktop.

1. **Renderer và picking:** giới hạn đọc depth cho point pick, giải phóng
   buffer khi lỗi, loại kết quả hover/selection đã cũ; khôi phục geometry
   streaming sau khi mất GPU device. Cần kết hợp với BVH CPU picking và
   instanced bounds riêng của chúng ta.
2. **Parser và dữ liệu:** chặn chuỗi đơn vị tự tham chiếu, thông báo record
   bị bỏ qua, đọc quantity theo mutation hiện tại và chuyển đổi đơn vị có
   offset. Cần giữ semantic streaming native và cơ chế hủy hiện có.
3. **Rust processing/geometry:** dùng pool Rayon với stack đủ lớn cho native
   geometry và sửa đặt profile của IFC4x3 sectioned solids. Hàm gọi từ desktop
   phải được kiểm tra với thay đổi bên trong này dù chữ ký vẫn giữ nguyên.
4. **Xuất IFC:** sửa liên kết property set qua IfcPropertySetDefinitionSet,
   hợp nhất đường ghi STEP và bổ sung số liệu refusal/duplicate. Colorizer
   phải đánh giá kết quả xuất đầy đủ theo hợp đồng mới.
5. **WASM và đo tải:** có tiến độ bên trong batch dài, dùng chung module WASM
   và load tracing. Các sửa lỗi worker hữu ích cho đường WASM; chúng không tự
   chứng minh đường native tải nhanh hơn.

Các tính năng mới như Scan-to-BIM hay Assistant mở rộng không phải điều kiện
để nâng core desktop. Không cần đổi cách người dùng làm việc để lấy các sửa
lỗi ở các lớp trên.

## 5. Tính tương thích và các điểm cần sửa khi triển khai

Tín hiệu thuận lợi từ nguồn:

- `packages/geometry/src/native-bridge.ts`, `platform-bridge.ts` và
  `packed-instanced-decoder.ts` không đổi giữa nền gốc, production và main.
  Local vẫn có tùy biến decoder riêng cần giữ.
- Chữ ký `process_geometry_streaming_filtered_with_baked_basis` mà desktop
  đang gọi giống nhau ở cả ba mốc. Có thể giữ đường native hiện tại, nhưng
  vẫn cần biên dịch và kiểm chứng dữ liệu mesh/basis/callback thực tế.
- Upstream không có đường dẫn đụng các tệp untracked local đã khảo sát.

Các điểm cần chủ động chuyển đổi:

- `apps/server/src/services/data_model/mod.rs`: xung đột với cancellation,
  trích xuất dữ liệu và đơn vị dùng chung cho native host. Không thể bỏ qua
  server chỉ vì sản phẩm đang chạy là desktop.
- Renderer: `camera-animation.ts`, `camera.ts`, `pick-types.ts`, `scene.ts`
  có xung đột trực tiếp; `scene-raycaster.ts` ghép sạch vẫn phải kiểm chứng
  CPU BVH, instancing, visibility/section và thứ tự chọn khi hình trùng nhau.
- Viewer: loader, streaming, animation loop, hierarchy, selection, section,
  panel registry/state là những chỗ có xung đột. Giữ UI local và cập nhật
  contract cần thiết, tránh chép đè nguyên viewer mới.
- Export: `StepStats` thêm `property_mutations_refused` và
  `duplicate_records_dropped` ở production; main còn thêm trường khác.
  Colorizer hiện kiểm tra `warnings`: cần xem cả ý nghĩa các bộ đếm mới và
  thử tình huống bị từ chối trước khi chấp nhận file xuất.
- Nếu dùng main 21.4.0: kiểm tra thêm các API trả `Result`/`Option`, thay
  kiểu transform profile, struct xuất dữ liệu và symbol đã bị bỏ. Không
  đổi số phiên bản Cargo rồi giả định các caller vẫn tương thích.
- Không trộn Rust mới với WASM runtime cũ. Regenerate bindings qua script
  chuẩn; giữ bộ native Rust, `.wasm`, JS glue và `.d.ts` cùng nguồn.

Đã tính dependency workspace của bảy nhóm core TS: cần xét **15 package**
trong closure runtime/optional/peer; package mới so với local là
`@ifc-lite/load-trace`. Danh sách trong `dependency-closure.json`.
Đây chưa bao gồm toàn bộ dependency phát triển hoặc mọi yêu cầu gián tiếp
của viewer. Thay vài dòng version riêng lẻ không đủ cho nâng cấp đồng bộ.

## 6. Thứ tự triển khai đề xuất

1. **Chốt snapshot local đầy đủ:** gồm tracked đang sửa, file untracked liên
   quan, changeset và hash artifact; đưa sang checkout nâng cấp riêng.
   Giữ checkout đang dùng và các release hiện tại.
2. **Nâng Rust cùng bộ WASM:** core, geometry, processing, export,
   wasm-bindings, Cargo manifests/lock và dependency cần thiết từ SHA đã
   khóa. Giữ Colorizer và native transport; xử lý module data_model dùng chung.
3. **Nâng data/parser/geometry và closure:** giữ semantic streaming,
   đơn vị, hủy tải và canonical load path; kiểm tra boundary WASM thật.
4. **Nâng renderer:** giải quyết bốn xung đột, giữ camera TestIFC, scene
   placement, instanced packing và BVH picking. So sánh với EXE cũ trước
   khi nối tiếp UI.
5. **Nối viewer hiện tại:** cập nhật các caller/contract cần thiết; giữ
   ribbon, panel, themes, cube, section workflow và Colorizer. Nếu nhập
   tính năng viewer 5.x thì tách thành phần việc riêng, có tiêu chí rõ.
6. **Đóng gói ứng viên mới:** chỉ sau các kiểm tra bên dưới; tạo thư mục
   release mới, ghi SHA-256 và nguồn core. UI nên hiển thị riêng phiên bản
   desktop và nguồn core để không nhầm với số viewer upstream.

Không thay workflow CI, publish, push hoặc tự chạy Actions trong nghiên cứu này.
Khi triển khai cần changeset/API snapshot cho các package thay đổi và cập nhật
ledger hiệu năng theo quy định repo sau khi đã có phép đo.

## 7. Tiêu chí nhận ứng viên sau nâng

- Root `pnpm typecheck` và `pnpm test` qua Turbo; trên Windows dùng cơ chế
  shard viewer hiện có. Chạy các kiểm tra contract/gate liên quan đến thay đổi.
- `cargo test --workspace` và
  `cargo clippy --workspace --all-targets -- -D warnings`; native desktop
  là workspace độc lập nên phải chạy thêm test/clippy trong host đó.
- Build WASM từ đúng nguồn trước `pnpm test:wasm-contract`.
  Một lượt skip vì thiếu runtime không được tính là pass của boundary.
- Chạy packaged quality gate hiện có trên **EXE ứng viên cụ thể** với model
  hangar; kiểm tra panel/drawing, Colorizer, chọn đối tượng, federation,
  export giữa lúc chuyển panel, thay model, hủy và đóng sạch.
- IfcOpenShell làm oracle độc lập: xác minh màu, record ngoài phần được sửa,
  tọa độ và mesh sau export. Ghi rõ mẫu lấy hay toàn model.
- Đo base-vs-candidate interleaved trên cùng máy: tải lạnh, hình đầu tiên,
  tải hoàn tất, RAM, pan/orbit/zoom/hover, long tasks và đóng. Đo SVD/PVF
  riêng; kết quả model nhỏ không thay bằng bằng chứng model lớn.
- Với thay đổi geometry: chạy probe chuẩn repo trên cả base/candidate,
  giữ số mesh/triangle/hash hoặc giải trình thay đổi hợp lệ, cùng các cổng
  parity/determinism và reference tương ứng. Không dùng baseline CI trên
  máy khác để kết luận local nhanh hơn.

Hiện xác nhận có model hangar 12.087.605 byte và PVF 1.411.171.948 byte ở
các đường dẫn đã dùng trước đây. Hai fixture AC20-FZK-Haus và ISSUE_129 mà
quy định perf yêu cầu **không có tại đường dẫn chuẩn trong checkout này**;
cần fetch khi bắt đầu kiểm chứng. Chưa tìm/xác nhận lại đường dẫn model SVD
trong đợt nghiên cứu. Chưa chạy bất kỳ phép đo hay bài test ứng viên nào.

## 8. Bằng chứng và bảo toàn

- `evidence.json`: phiên bản từ cây Git đã khóa, số tệp thay đổi, kết quả
  ghép thử từng tệp, dấu vân tay source local và hash EXE.
- `dependency-closure.json`: dependency workspace từ manifest production.
- `audit-upstream.py`: công cụ đọc nguồn và ghép thử vào thư mục tạm;
  không ghi vào source ứng dụng.
- EXE giữ nguyên:
  `desktop/release/10.3.0-native-quality-audit-20261017/IFC-Lite.exe`,
  SHA-256 `1b9a8879c4ff556324cf3aaa459b58d2fcd8f1d03fda22579bd861e98fbc1d4b`.

Đã fetch Git objects và cập nhật `origin/main` để nghiên cứu. Nhánh local,
HEAD, index, source ứng dụng và release không được ghép/sửa bởi nghiên cứu.
Chỉ bổ sung tài liệu và dữ liệu trong thư mục nghiên cứu này. Kiểm chứng
hash cuối đợt được lưu ở `preservation.json`.

## Nguồn chính thức

- [Viewer 5.1.5 tại SHA main đã kiểm tra](https://github.com/LTplus-AG/ifc-lite/blob/74d097d01f96df892ffa09e69c5c82e628be7d5c/apps/viewer/package.json)
- [Nguồn production dùng làm mốc](https://github.com/LTplus-AG/ifc-lite/tree/61d209288c1b117d405628ead302d0ee700bd2a0)
- [Cargo production 20.4.0](https://github.com/LTplus-AG/ifc-lite/blob/61d209288c1b117d405628ead302d0ee700bd2a0/Cargo.toml)
- [Cargo main 21.4.0](https://github.com/LTplus-AG/ifc-lite/blob/74d097d01f96df892ffa09e69c5c82e628be7d5c/Cargo.toml)
- [Changelog renderer](https://github.com/LTplus-AG/ifc-lite/blob/61d209288c1b117d405628ead302d0ee700bd2a0/packages/renderer/CHANGELOG.md)
- [Changelog parser](https://github.com/LTplus-AG/ifc-lite/blob/61d209288c1b117d405628ead302d0ee700bd2a0/packages/parser/CHANGELOG.md)
- [Changelog geometry](https://github.com/LTplus-AG/ifc-lite/blob/61d209288c1b117d405628ead302d0ee700bd2a0/packages/geometry/CHANGELOG.md)
- [Hướng dẫn desktop của upstream](https://ifclite.dev/docs/guide/desktop/)

Tài liệu local tham chiếu: `desktop/README.md`, `desktop/UI-QUALITY-CONTRACT.md`,
`desktop/APP-QUALITY-AUDIT.md` và nguồn tùy biến hiện tại. Kết quả test trong
các tài liệu cũ là bằng chứng của artifact cũ, không phải lượt chạy mới này.
