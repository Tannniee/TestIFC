# Deep audit native Rust — 2026-10-09

## Kết quả và phạm vi

Giữ native làm mặc định. Audit tiếp nối bản PVF responsive, kiểm tra đường
Rust → IPC → viewer, đơn vị BIM, instance, vòng đời tác vụ và bằng chứng EXE.
Checkout `F:/Steel/VBA/IFC-Lite`, nhánh `codex/desktop-v10.3.0`, base
`471284f476d64a659ae607eeec2115ca3afcb9fe`, remote LTplus-AG/ifc-lite.
Source vẫn có các sửa đổi chưa commit từ những lượt trước; không merge/push.
`PVF-CRASH-VALIDATION.md` là bằng chứng điều tra trước, không phải chỉ thị mới.

EXE mới: `release/10.3.0-native-audit-20261009/IFC-Lite.exe`.
SHA256: `3A1F8166EEEEDE26812447F720EB966A4D80EC870DE09A7ECCA61419F51C9079`.
Các EXE trước được giữ nguyên. Mô hình riêng và log/profile nằm trong thư mục
báo cáo được ignore, không đưa vào source phát hành.

## Các lỗi đã sửa

| Mức | Phát hiện | Sửa và bằng chứng |
|---|---|---|
| P1 | Mất đơn vị trong native source-less: PVF hiển thị washer `20m`, bolt hole `22m`, bolt length `55m`. Chỉ có length scale cho hình học, bảng thuộc tính tự dùng SI mặc định. | Rust dùng resolver canonical cho toàn bộ IfcUnitAssignment và truyền metadata riêng theo project. Parser đọc metadata qua entry point hiện có. Properties, quantity summary, charts, lists, zone quantities và công cụ đo không còn bỏ qua đơn vị chỉ vì source rỗng. |
| P2 | IFNS được giải mã toàn bộ khi ingress chỉ cần đếm/thu ID, rồi lại giải mã khi cập nhật màu. Mỗi lượt tạo object, color array và transform copy cho mọi occurrence trước upload. | Dùng validator cấu trúc chung với decoder. Census và color update đọc trực tiếp các lane cần thiết; giữ full decoder tại nơi dùng hình học. Test kiểm tra v1/v2, ID, dữ liệu sau cập nhật, malformed tail và không tạo các transform copy trong hai lane này. |
| P2 | Màu không hợp lệ ở phần tử sau có thể gây lỗi sau khi đã ghi màu phần tử trước. | Kiểm tra các màu được shard tham chiếu trước lần ghi đầu. Test red tái hiện buffer bị thay đổi dở; test green yêu cầu buffer giữ nguyên khi update bị từ chối. Không duyệt color map toàn mô hình cho từng shard. |

Đơn vị chiều dài, diện tích, thể tích và tiền tệ độc lập; không lấy bình phương
length scale để suy đoán area unit. Khai báo chưa giải được giữ `null`, không
tự biến thành `kg` hoặc SI mặc định. Test đối chiếu parser đọc STEP với store
native không giữ source, bao gồm hai project, mm/m, m²/mm², USD và unresolved
mass. Rust test đọc stream theo từng 7 byte và kiểm tra wire giữ đủ assignment.
Đây là đơn vị của project; chưa phải chứng nhận mọi property Unit override.

## Bằng chứng PVF trên EXE

Source `IFC_PVF.ifc`, 1,411,171,948 byte. Cùng harness, fresh WebView2 profile,
chờ hoàn tất upload và spatial index, quay camera bằng callback trong 10 giây,
chọn entity 1608, kiểm tra thuộc tính, Home và đóng ứng dụng.

<!-- AUDIT-METRICS -->
| Phép đo | Bản responsive đối chứng | Bản audit cuối |
|---|---:|---:|
| Hoàn tất pipeline, lấy mẫu | 138.032 s | 144.060 s |
| Spatial index sẵn sàng | 139.045 s | 145.073 s |
| Callback quay camera hợp lệ / 10 s | 631 | 708 |
| Khoảng callback p95, nearest-rank | 20.085 ms | 20.050 ms |
| Khoảng callback lớn nhất | 30.310 ms | 20.385 ms |
| Consolidation/finalize do app ghi | 5,349 ms | 5,552 ms |
| Long task lớn nhất trong load | 5,687 ms | 6,320 ms |
| JS heap used sau index, byte | 2,798,293,092 | 2,812,193,128 |
| Binary backing storage, byte | 2,227,375,024 | 2,074,285,976 |
| Washer diameter trong Properties | 20m | 20mm |

**Verdict:** độ mượt sau load được giữ; bỏ được hai lượt materialize thừa và
sửa đúng đơn vị. Chưa có bằng chứng mở nhanh hơn: lượt cuối mất thêm 6.028 s
(4.37%) so với đối chứng. Snapshot backing storage thấp hơn không chứng minh
peak memory giảm; heap used gần như ngang nhau và thời điểm GC khác nhau.
Long task tải đầu vẫn hơn 6 giây, cần ưu tiên tiếp. Giữ cả probe trung gian
`audit-candidate.json` (142.606 s) trong bằng chứng, không chọn số đẹp để báo cáo.

Cả hai giữ **160,673 flat meshes, 42 IFNS / 212,340,264 byte, 14,009 templates,
1,370,547 occurrences, 552,026 instanced entity bounds**. Tổng native:
245,093,805 vertices và 148,025,417 triangles. GPU 862,134,488 byte, CPU renderer
941,967,564 byte, 4,059 draw calls và 2,376 consolidated batches giữ nguyên.
Đây là census và fixture parity, không phải hash toàn bộ hình học PVF.

Index có 712,699 entries; bounds query chứa selected entity 1608. Properties
có 2 Pset / 19 properties, source bytes bằng 0. Project 37 truyền LENGTHUNIT
mm/.001, AREAUNIT m²/1, VOLUMEUNIT m³/1 độc lập. Home, frame selection và quay
camera chạy được. Không có browser exception trong các probe; host exit 0 và
cleanClose true. Hình kiểm chứng ở `reports/pvf-responsiveness/audit-final-scene.png`
và `audit-final-properties.png`.
<!-- END-AUDIT-METRICS -->

Đây là một cặp chạy nối tiếp trên máy cục bộ, không phải năm cặp interleaved
trên máy cô lập. Thời gian hoàn tất được lấy mẫu khoảng 5 giây nên không phải
first-visible-pixel chính xác. Phép quay dùng rAF/camera callback, không phải
đo pointer drag. Các kết quả không chứng minh đầy đủ geometry/GIS parity.

## Các điểm còn sót

1. **P1 — hủy extraction thuộc tính chưa ngắt CPU ngay.** `semantic_model::prepare`
   kiểm tra token trước khi bắt đầu và khi ghi stream. Canonical
   `extract_data_model_scoped` vẫn chạy đồng bộ qua scan và các nhánh Rayon;
   nó không nhận cancellation token. Close ngăn publish kết quả đã hủy,
   nhưng thread và bộ nhớ có thể sống tới khi extraction kết thúc. Bước tiếp
   cần thêm checkpoint vào extractor chung, kèm test hủy giữa quá trình và
   đo thời gian giải phóng trên mô hình lớn. Không tạo extractor desktop thứ hai.
2. **P1 — upload GPU ban đầu còn đợt main-thread dài.** Loại bỏ expansion BVH
   và các decode thừa không loại bỏ full decode/packing ở renderer. Cần tách
   công việc mỗi frame và đo first-visible/interaction-unblocked riêng, giữ
   parity transform, màu, item ID, finish và ownership. Số long task thực tế
   của bản này nằm ở bảng đo trên.
3. **P2 — cảnh báo seam ID 24-bit vẫn tồn tại.** `individual-mesh-upload.ts`
   mask các ID vượt phạm vi; log PVF còn cảnh báo đường biên có thể trùng.
   Census giữ ID native đầy đủ; chọn một ID nhỏ không chứng minh mọi đường
   biên/high-ID đều đúng. Cần test witness ID lớn trước khi sửa encoding.
4. **P2 — federation/GIS chưa đủ bằng chứng.** Smoke còn cảnh báo reprojection
   EPSG:32760 ở mẫu rev-b. Native georeference metadata và test rotated-site/
   large-RTC giữ đúng world vertices trong fixtures; điều đó chưa chứng minh
   placement địa lý của PVF hoặc mọi CRS.
5. **P2 — native import-path command còn I/O đồng bộ trong async handler.**
   Command gọi `Jobs::import_path` trực tiếp. UI hiện nạp bằng bounded raw
   chunks; caller dùng import-path cần chuyển disk copy sang blocking pool
   và kiểm tra cancellation/progress.
6. **Phạm vi source-less còn thiếu.** Project units và bảng Pset/Qto được giữ;
   các chức năng cần đọc STEP gốc, như material property density/Unit override
   hoặc edit/export nâng cao, cần audit capability riêng. Giữ source ngoài
   WebView giúp bộ nhớ; không khôi phục bản sao IFC khổng lồ chỉ để qua guard.
7. **P1 — native open còn lặp đọc/index.** Geometry worker đọc snapshot rồi
   semantic phase đọc lại; extractor dựng entity index riêng. Cần profile
   parse, extraction, IPC decode, identity hashing và GPU registration theo
   từng phase trước khi chia sẻ source/index trong host. Mọi reuse phải giữ
   snapshot isolation, lifetime/cancellation và ownership giữa các model;
   không chuyển toàn bộ source trở lại WebView để tăng tốc.

## Kiểm chứng source và giới hạn

- Root typecheck: **109/109 tasks**, test discovery/typecheck **3252/3252**.
- Geometry: **590 pass**; suite phủ wire v1/v2, stride forward-compatible,
  pool ranges và malformed references.
- Viewer, 6 file đích qua root Turbo/discovery: **80 pass**, gồm native runtime,
  native store, geometry stream, units và chart adapters.
- Desktop Rust: **26 pass** (16 library, 4 native backend, 5 product
  representation, 1 unit transport); world-vertex fixtures gồm rotated site,
  repeated IFNS và large RTC. Clippy all-targets với `-D warnings` pass.
- Packaged small-model native smoke: **9 checks pass**, cả chế độ native mặc
  định không có URL override (`IFC_NATIVE_DEFAULT=1`), không instantiate WASM;
  gồm mở hai mẫu, điều khiển góc nhìn, selection/properties, federation,
  section box và close. Cảnh báo GIS nêu trên vẫn giữ trong report.
- API snapshots, module-size ratchet, test-glob coverage, targeted lint và
  diff whitespace checks pass. Không nâng budget, không bỏ test/assertion.
- Parser rộng: **1701 pass, 11 skip, 3 fail** ở worker-url-specifiers synthetic
  POSIX path trên Windows; code/test classifier đó không đổi trong lượt này.
  Không gọi toàn bộ parser suite hoặc toàn bộ viewer suite là xanh.

Chi tiết kiểm chứng: `reports/pvf-responsiveness/audit-*.log`,
`audit-control.json`, `audit-final.json`, screenshots, smoke-audit và smoke-audit-default.
Build/source hashes được ghi cùng EXE trong `build-info.json`.
