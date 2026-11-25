# Nâng chức năng và package IFC-Lite, giữ bản sắc TestIFC

Kiểm tra ngày **05/11/2026**, Asia/Bangkok. Đây là kết quả nghiên cứu nguồn và
ghép thử văn bản trong thư mục tạm; **chưa tích hợp thay đổi vào app hoặc tạo EXE mới**.

## Kết luận

Nên tiếp tục từ **desktop 10.4.0/r7** tại `F:/Steel/VBA/IFC-Lite-Core104`,
giữ giao diện riêng và đưa các chức năng upstream vào theo từng nhóm.
Thư mục `F:/Steel/VBA/IFC-Lite` đang mở là nền 10.3.0 cũ, không phải nguồn
đầy đủ của EXE r7. Không lấy checkout này làm điểm xuất phát nâng cấp.

Ưu tiên: **mặt cắt/Box và đo đạc → xuất IFC theo vùng cắt → bản vẽ 2D và dữ liệu
→ các tối ưu tải/vẽ đã đo được trên desktop**. Nâng core và các chỗ nối API là
điều kiện kỹ thuật của các nhóm này, không phải một lần chép đè toàn bộ viewer.
OCI/BIMcollab/buildagil để sau nếu có nhu cầu dịch vụ tương ứng.

Mốc đề xuất để tạo ứng viên đầu tiên là `production` đã khóa tại
`7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99`. Đây là mốc đối chiếu của web,
không phải chứng nhận tương thích Windows/native hoặc hình học của chúng ta.
Giữ các sửa mới hơn trên `main` thành phần xét riêng sau khi ứng viên đầu qua kiểm tra.

## 1. Mốc và phiên bản thực tế

| Thành phần | App 10.4/r7 | Upstream production | Upstream main |
| --- | --- | --- | --- |
| Giao diện viewer | 4.0.0 tùy biến | 5.5.0 | 5.5.0 |
| Rust workspace | 20.4.0 + sửa Nhịp chính | 28.2.0 | 28.2.0 |
| WASM package | 10.4.0 | 12.2.0 | 12.2.0 |
| Renderer | 6.4.0 + tùy biến | 7.1.0 | 7.1.0 |
| Geometry TS | 7.8.1 + tùy biến | 8.1.0 | 8.1.0 |
| Parser | 9.5.1 | 9.9.0 | 9.9.0 |
| Drawing 2D | 4.2.0 | 5.0.0 | 5.0.0 |
| Export TS | 4.11.0 | 4.13.3 | 4.13.3 |
| Data | 6.2.0 | 6.4.0 | 6.4.0 |
| Diff | 0.10.0 | 0.13.1 | 0.13.1 |
| Server client | 4.0.1 | 5.1.1 | 5.1.1 |
| Số package trong `packages/*` | 62 | 65 | 65 |

Mỗi package có phiên bản riêng. Không gọi cả bộ là “27.2” chỉ vì GitHub có
release retained engine 27.2.0; cũng không gọi giao diện desktop là 5.5.0 khi
chưa chuyển giao diện đó. Package tồn tại trong workspace không có nghĩa chức
năng đã được nối vào UI hoặc toàn bộ thư viện được đưa vào EXE.

- Core/package đã nhập trước đây: production `61d209288c1b117d405628ead302d0ee700bd2a0`.
- Giao diện giữ từ `v10.3.0`, `e79f27342beb01a6f30d9b63c44795ecd118f4de`.
- Nguồn desktop mới: nhánh `codex/nhip-geometry-20261024`, HEAD
  `13e402c42884c479fc22437c2e8f7a8c5dad53c5`, cộng các thay đổi staged/unstaged.
  HEAD một mình không tái tạo được r7; release có `source.patch` và hồ sơ nguồn.
- Production: commit 04/11/2026 20:12:11, giờ Bangkok.
- Main: `2cf5d2fa7f7831aa8282c944d7a2a67fa3cf878e`, commit 05/11/2026 07:38:10.
  Hai cây có cùng các phiên bản package nhưng khác **158 đường dẫn** toàn repo.

Bảng đủ 65 package: [PACKAGES.md](./PACKAGES.md). Có **41 gói đổi phiên bản,
21 gói giữ số phiên bản và 3 gói mới**. Giữ số phiên bản không chứng minh mã
nguồn hoặc dependency không đổi.

## 2. Các chức năng đáng đưa vào app

Các hành vi dưới đây được xác nhận trong nguồn/changelog upstream; chưa được
kiểm thử trên EXE tùy biến của chúng ta.

| Ưu tiên | Chức năng | Giá trị và cách tích hợp |
| --- | --- | --- |
| 1 | Box tô kín mặt cắt, viền, hatch, màu theo cấu kiện, highlight | Nối renderer/cutter mới vào Box TestIFC hiện tại; giữ thao tác tạo/chọn/đổi/hủy Box. Tô mặt cắt trên màn hình không đồng nghĩa đã cắt hình học file IFC. |
| 1 | Nhiều mặt phẳng cắt, tối đa 8, và loại trừ cấu kiện khỏi section | Giữ cùng tập clipping cho hình, chọn, bóng, bắt điểm và cap; kiểm tra tương tác độc lập với crop Box và bộ lọc visibility. |
| 1 | Bắt điểm đo theo phần hình còn thấy và đường giao mặt cắt | Tránh bắt nhầm hình đã bị cắt bỏ; nối đơn vị, snap và quyền sở hữu ID về dữ liệu native hiện có. |
| 1 | Xuất STEP IFC theo vùng cắt | Có chế độ cắt cấu kiện đi qua biên hoặc giữ nguyên cấu kiện giao vùng. Giữ identity/dữ liệu theo hợp đồng xuất; thử lại federation khác đơn vị. Lỗi cắt phải báo từ chối, không giao file chưa cắt như thành công. |
| 2 | Mặt cắt 2D đúng với mặt hở | Drawing 5 không tự khép đường hở thành polygon tô kín. Cần cập nhật cả các caller của `SectionCutResult.openSurfaceSegments` và `isPolygonCutLine`. |
| 2 | Ký hiệu cửa, đường lưới và dữ liệu bản vẽ | Dùng hướng/OperationType/SameSense từ IFC; giữ Drawing workspace có canvas 3D liên tục, không đổi bố cục riêng. |
| 2 | Lists/Lens nhóm cấu kiện; lọc đúng IFC class | Cột nhóm tùy biến và sửa truy vấn class ngoài enum; hữu ích cho thống kê mô hình kết cấu. Giữ tên IFC EXPRESS chuẩn. |
| 2 | Compare/Diff và BCF | Không bỏ property set trùng tên khi so sánh; quản lý snapshot handle rõ vòng đời. BCF giữ mặt cắt ngoài bounds và tọa độ thế giới; kiểm tra với native RTC/federation. |
| 2 | Giảm CPU khi xoay model và cấp phát GPU | Renderer mới gộp uniform upload, tránh đọc layout mỗi frame, trì hoãn một số render target. Đáng thử trên Nhịp chính, nhưng chưa có số đo desktop để kết luận nhanh hơn. |
| 3 | Lens shift / phối cảnh hai điểm | Đáng thêm cho ảnh trình bày sau khi camera, picking, section và ViewCube giữ đúng hành vi cũ. |
| 3 | IFCX/IFC5, layer opinions, IDS/Flow/AI | Có tiến bộ, nhưng `ai`, `ids-agent`, `ids-authoring`, `semantic` đã có trong bộ 62 package trước đây; không quảng bá lại như package mới của đợt này. |

Nguồn: [renderer](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/renderer/CHANGELOG.md),
[Drawing 2D](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/drawing-2d/CHANGELOG.md),
[hướng dẫn xuất IFC theo section](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/docs/guide/exporting.md),
[Lists](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/lists/CHANGELOG.md),
[Diff](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/diff/CHANGELOG.md).

### Hai cải tiến không nên bật máy móc

**Nén source/mở lại scene từ cache:** parser 9.9 giảm bản sao IFC trong web và
nén source sau tải. Đường native của mình đã giữ source bên ngoài WebView2;
không đưa source nguyên file trở lại web chỉ để dùng cải tiến này. Scene snapshot
upstream đang mặc định tắt; chỉ thử riêng sau khi chứng minh ownership, phục hồi
GPU, metadata và cache invalidation đúng trên desktop.

**Gaussian splats/retained engine:** Gaussian adapter ở renderer 7.1 được ghi rõ
`internal-unqualified`, readiness vẫn `blocked`. Retained engine là đường tùy chọn
riêng, không thay thế mặc định exact/native của mình trong đợt nâng đầu. Việc có
asset release hoặc API không chứng minh nó đã đủ điều kiện cho model thực tế.

Nguồn: [parser](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/parser/CHANGELOG.md),
[renderer](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/renderer/CHANGELOG.md),
[WASM](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/wasm/CHANGELOG.md).

## 3. Ba package mới

| Package | Phiên bản | Vai trò | Đề xuất |
| --- | --- | --- | --- |
| `@ifc-lite/oci` | 0.2.0 | Đọc/ghi artifact qua OCI registry, kiểm tra digest, liệt kê tag | Chỉ nối khi cần kho model có phiên bản; dùng local hiện tại không cần mở thêm dịch vụ. |
| `@ifc-lite/source-bimcollab` | 0.2.0 | File source BIMcollab Documents, dùng phiên BCF do host cung cấp | Để tùy chọn; cần phiên đăng nhập và relay được host chấp nhận. Không tự có kết nối chỉ bằng thêm package. |
| `@ifc-lite/source-buildagil` | 0.2.0 | Duyệt model/thư mục/phiên bản qua buildagil openCDE | Để tùy chọn; cần client ID và callback OAuth phù hợp Windows host. |

Nguồn: [OCI](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/oci/README.md),
[BIMcollab](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/source-bimcollab/README.md),
[buildagil](https://github.com/LTplus-AG/ifc-lite/blob/7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99/packages/source-buildagil/README.md).

## 4. Những nét đặc trưng phải giữ

| Phần riêng | Tiêu chí chấp nhận sau nâng |
| --- | --- |
| Native Rust và IPC chia gói | Tải STEP theo đường native; không khởi tạo WASM hoặc giữ nguyên source IFC trong WebView2 cho đường tải đó; hủy/đổi model/đóng sạch. Các consumer xuất chuyên biệt được đánh giá riêng. |
| Nhịp chính r5–r7 | Giữ sửa through-cut, blind/oblique pockets, frame/precision, màu, mesh closure và BVH finite-source; không quay về hình học hoặc tốc độ trước sửa. |
| ViewCube TestIFC, sáu hướng, Home, orbit/pan/zoom | Giữ trục Y-up, target/pivot/projection/roll, damping và hủy tween; chọn phần tử hoặc mở panel không tự làm trôi camera. |
| Box/section TestIFC | Giữ thao tác tạo, tay nắm, di chuyển/đổi mode, hủy và reset; tính năng cap/multi-plane nối vào cách dùng đó. |
| Colorizer và quick colour | Giữ nhóm tiết diện/tên, màu xám, màu nhanh, shared undo, state khi đổi panel và Save as. File xuất phải đọc lại được và không làm đổi hình học ngoài phạm vi yêu cầu. |
| Ribbon, panel, Drawing, Black OLED | Giữ bố cục/canvas liên tục, panel kín, kéo chia và reduced motion; mở Drawing không hủy renderer. |
| Federation/BIM-GIS | Kiểm tra 1 và nhiều model, resolve ID chuẩn, đúng đơn vị, RTC/Y-up/Z-up/world transform, chọn/hide/section/export đúng model. |
| Model lớn/GPU | Giữ instancing, bounded picking, cooperative semantics/upload và device recovery; đo tải lẫn tương tác, không chỉ đo kernel. |
| Cách phát hành trên máy cá nhân | Tạo thư mục release mới, giữ EXE cũ, shortcut bản mới ngay đầu `F:/Steel/VBA/IFC-Lite`; không gói cả bộ thư viện. Ô nhập liệu không dùng Spinbox. |

## 5. Rủi ro đã đo từ nguồn

Ghép thử sử dụng base package/core đã nhập và base UI được giữ riêng; không
ghi kết quả ghép vào working tree. Chi tiết từng tệp trong [evidence.json](./evidence.json).

| Phép đối chiếu | Production | Main |
| --- | --- | --- |
| Đường dẫn thay đổi so với upstream đã nhập | 6.493 | 6.589 |
| Tệp local/upstream cùng thay đổi được xét ghép | 341 | 344 |
| Xung đột văn bản | 125 | 126 |
| Ghép sạch bằng văn bản | 108 | 110 |
| Thêm/xóa cần xét riêng | 104 | 104 |
| Nội dung đã giống nhau | 4 | 4 |
| Đụng tên tệp local untracked | 0 | 0 |

125 xung đột production gồm 47 ở viewer, 24 ở Rust geometry, 4 ở processing,
4 ở renderer, cùng manifests/lock/tooling và các consumer khác. Đây là bản đồ
rủi ro cho nâng cả cây, không có nghĩa mọi tệp đều thuộc đợt chức năng đầu.
Ghép sạch hoặc không đụng tên không chứng minh tương thích API/hành vi.

Các điểm nối cần xử lý rõ:

- `useIfcLoader`, `useGeometryStreaming`, `useMouseControls`, scene và GPU
  lifetime: giữ canonical load path, các adapter native và camera riêng.
- Kernel arrangement, router voids, profile và `produce_element_meshes` có
  xung đột với sửa Nhịp chính; không chọn toàn bộ “upstream” để giải quyết.
- Renderer 7 đổi `BatchedMesh.uniformBuffer` thành `uniformSlot` và mở rộng
  `SceneContents`; phải chuyển cả upload/recovery và các consumer tương ứng.
- Drawing 5 có breaking contract `openSurfaceSegments`; không chỉ đổi version.
- Native vẫn gọi `process_geometry_streaming_filtered_with_baked_basis`.
  Upstream còn hàm này nhưng đã deprecated, hướng chuẩn là `process` với
  `ProcessingRequest`/`ProcessingSink`. Phải đối chiếu basis, màu, metadata,
  progress, cancellation và ordering khi chuyển; không chỉ thêm allow deprecated.
- Export Rust có các API trả `Result`, dữ liệu receipt/refusal mới và world-frame
  contract. Colorizer cần kiểm tra lại toàn bộ đường lỗi và các loại bỏ/refusal.
- Section export upstream chạy WASM theo consumer riêng. Trên desktop cần chốt
  adapter source/native xuất phù hợp; không gán sẵn nó cho bộ native chỉ vì đã có
  package `export` mới.
- Closure runtime/optional/peer của bảy gói core gồm **15 package**, closure
  dependency viewer là **54 package**; không nâng lẻ vài manifest. Core Rust,
  WASM runtime/glue/types, lock và API snapshot cần đồng bộ theo nguồn đã khóa.

## 6. Thứ tự và điều kiện nhận bản nâng cấp

1. Tạo checkout nâng cấp riêng từ **snapshot đầy đủ của nguồn 10.4/r7**,
   gồm staged, unstaged và untracked liên quan. Giữ hai checkout và mọi release cũ.
2. Chuyển core/dependency closure và adapter native sang nguồn khóa, đồng thời
   port lại sửa hình học Nhịp chính. Qua kiểm tra nền trước khi nối chức năng mới.
3. Nối nhóm Box/cap/đo và section export vào UI riêng; cập nhật Drawing theo
   contract mới trong cùng nhóm phụ thuộc, rồi kiểm tra từng luồng hoàn chỉnh.
4. Thêm dữ liệu/Lists/Compare/BCF đã chọn. Xét tối ưu renderer riêng với đo A/B;
   không mặc định bật cache thử nghiệm, retained hoặc Gaussian.
5. Tạo EXE ứng viên và kiểm chứng trên đúng artifact. Chỉ sau khi đạt mới tạo
   shortcut bản mới ở đầu thư mục; giữ đường chạy và EXE cũ để quay lại.

Các kiểm tra bắt buộc của ứng viên, chưa chạy trong nghiên cứu này:

- Root `pnpm typecheck`, `pnpm test` qua Turbo, lint và các gate hiện hành liên
  quan; giữ Windows launcher/shard của app. Kiểm tra test wiring, module size,
  API/changeset và generated docs/types khi có thay đổi.
- `cargo test --workspace` và `cargo clippy --workspace --all-targets -- -D warnings`
  với toolchain chuẩn repo, thêm test/clippy của workspace desktop độc lập.
  Build runtime WASM đúng nguồn trước `pnpm test:wasm-contract`.
- EXE quality/interaction/Box/Colorizer: panel/theme/camera, 1 và nhiều model,
  đổi/hủy model, export/undo/Save as, mở lại IFC và đóng sạch.
- IfcOpenShell đối chiếu màu, tọa độ, hình học, dữ liệu và section export; ghi rõ
  phần lấy mẫu và toàn model. Đối chiếu các ca sửa thật Nhịp chính bên cạnh fixture nhỏ.
- A/B interleaved base r7 và ứng viên trên cùng máy: thời gian parse/geometry/total,
  RAM, upload/finalize, orbit/pan/zoom/pick và GPU recovery. Giữ mesh/triangle/hash
  hoặc giải trình thay đổi hình học được chấp nhận. Không lấy số benchmark upstream
  hoặc CI trên máy khác để kết luận tốc độ desktop.
- Với geometry: probe chuẩn house/ISSUE_129 và model nặng khi có; parity,
  determinism và reference theo workflow hiện hành. Khi làm PR phải đọc lại
  `.github/workflows/` và ruleset thực tế; danh sách ở đây không thay thế chúng.

## 7. Bằng chứng và giới hạn của đợt nghiên cứu

- [audit.py](./audit.py): đọc cây Git, kiểm kê manifest/dependency, ghép thử vào
  thư mục tạm và tính fingerprint. Đã chạy hoàn tất cho cả production/main.
- [PACKAGES.md](./PACKAGES.md): bảng phiên bản đủ 65 package.
- [evidence.json](./evidence.json): SHA, closure, danh sách từng xung đột và hash release.
- [preservation.json](./preservation.json): fingerprint trước/sau của tracked và
  nonignored untracked application files, HEAD/branch/index ở **cả hai checkout**.
  Kết quả toàn bộ giữ nguyên. Research và build cache ignored nằm ngoài tập này.
- EXE r7 45.432.320 byte được kiểm tra lại SHA-256:
  `0a957e98ca82f23a56192313d9179dd6d4f9d71cd81c27fce0d87456dd76dff8`,
  khớp hồ sơ `qualification.json` lưu cùng release.

Chỉ thêm hồ sơ nghiên cứu vào thư mục này và fetch Git objects phục vụ đối chiếu.
Không đổi source app/dependencies, index, branch hoặc EXE; không merge, cài thêm
package, build, chạy kiểm thử app, push, publish hay triển khai web. Không có ứng
viên mới để kết luận đã giữ hành vi hoặc hiệu năng sau nâng cấp.
