# Native Rust: giảm nghẽn tải và hủy tác vụ — 2026-10-10

## Phạm vi và bản chạy

Giữ native mặc định, tiếp nối hai ưu tiên đã thống nhất: giảm nghẽn giao diện
khi chuẩn bị mô hình và dừng semantic extraction sớm khi đóng mô hình. Checkout
`F:/Steel/VBA/IFC-Lite`, nhánh `codex/desktop-v10.3.0`, base
`471284f476d64a659ae607eeec2115ca3afcb9fe`, remote LTplus-AG/ifc-lite.
Giữ nguyên các thay đổi trước và các EXE đối chứng; chưa commit, merge hay push.

EXE: `release/10.3.0-native-followup-20261010/IFC-Lite.exe`.
SHA256: `62802ABCE58035684AF3E2EDAE82BD3873AEE63AEEE9260ED6B545A9D39F537B`.
`build-info.json` bên cạnh ghi source hashes và nguồn build.

## Sửa theo bằng chứng

- Profiling bản audit phát hiện một task khoảng 5,130 ms trong chuyển dữ liệu
  BIM sang entity table/CSR và một task khoảng 3,915 ms trong cây cấu trúc.
  Hai bước này được chia thành nhiều lượt trên giao diện; chỉ đưa kết quả
  hoàn chỉnh của mô hình hiện tại vào store. Cây native spatial chuẩn bị
  ngoài render, hủy khi input đổi; giữ search/reveal và việc chọn trong lúc chờ.
  Probe tiếp theo còn phát hiện first flush xảy ra trước khi model được đánh
  dấu native, khiến một cây legacy lớn vẫn dựng đồng bộ. Native load path được
  ghi trước snapshot đầu; regression React observer cho primary/federated
  tái hiện lỗi rồi đạt sau sửa.
- Chia nhỏ bounds, interleaving, quantization và LOD bên trong một GPU batch
  lớn. Sync/async chạy cùng phép tính; fixture đối chiếu byte của vertex,
  index và LOD, cả định dạng quantized. Chỉ publish batch hoàn chỉnh.
- Giữ bộ nhớ tạm riêng cho một lượt chuẩn bị qua các điểm nhường giao diện.
  Đóng scene giải phóng buffer cả khi preparation vừa xong nhưng chưa publish.
  Dịch mô hình trong lúc chờ được hòa vào placement trước publish; chỉnh hình
  học qua Scene làm lượt chuẩn bị cũ bị bỏ và chạy lại với input hiện tại.
- Canonical Rust extractor nhận cancellation token tại scan, job Rayon,
  property/quantity references và các phase tiếp theo. Không trả model dang dở.
  Đọc semantic source theo chunk, có kiểm tra hủy; dùng lại đúng pipeline server.
- Một lượt scan tạo cả entity index và metadata jobs. Index tăng theo số record
  thực tế; không ước lượng capacity từ byte của file. Rooted endpoint recovery
  đọc record theo offset đã index thay vì scan lại toàn file. Rooted class
  predicate được nhớ theo type, không tính và cấp phát lại cho từng record.
- Nhường việc nền bằng scheduler khi runtime có hỗ trợ, fallback timer khi
  thiếu; không gắn độ trễ cố định cho từng phần tử hay cắt bớt hình học.

## Kiểm tra hủy

Optimized probe dùng chính extractor và Job của desktop. Fixture có 1,600,003
record IFC, hủy tại 100/400/800 ms sau khi worker bắt đầu. Trước sửa, một lượt
hủy còn mất 2,210.69 ms để worker trả về. Sau sửa: 8.55 / 35.46 / 135.20 ms;
cả ba không publish semantic stream. Gate 500 ms được giữ nguyên.
Hủy trước khi bắt đầu, chạy không hủy, Pset/relationship/đơn vị mm và parity
rooted endpoint với canonical complete model đều đạt. Số này là probe fixture,
không phải giới hạn cứng cho mọi file hay thời gian đóng toàn ứng dụng.

Probe optimized trên chính PVF, hủy 2 giây sau khi worker semantic bắt đầu:
59.25 ms từ close đến worker return, không publish stream. Probe này không
đo thời gian đóng cửa sổ hoặc chứng minh peak memory đã trở về ngay sau close.

## PVF trên EXE

<!-- FOLLOWUP-METRICS -->
Private `IFC_PVF.ifc`, 1,411,171,948 byte; đối chứng là EXE audit đã giữ lại.
Đối chứng đo ngày 9/10, các candidate tiếp theo có fresh profile; lượt cuối
đo ngày 10/10. Mỗi lượt có CPU profiler cùng cấu hình. Máy không được chứng
nhận rảnh; đây là kiểm tra runtime cục bộ, không phải benchmark A/B xen kẽ.

| Phép đo | Audit đối chứng | Candidate 1 | Candidate 2 | EXE cuối |
|---|---:|---:|---:|---:|
| Hoàn tất pipeline, lấy mẫu | 132.865 s | 142.644 s | 142.268 s | 141.014 s |
| Spatial index sẵn sàng | 132.865 s | 142.648 s | 142.268 s | 141.014 s |
| Long task lớn nhất khi tải | 5,130 ms | 3,912 ms | 2,999 ms | 2,002 ms |
| Consolidation/finalize app ghi | 4,963 ms | 6,898 ms | 7,098 ms | 7,866 ms |
| Callback quay camera hợp lệ / 10 s | 564 | 647 | 651 | 635 |
| Khoảng callback p95, nearest-rank | 20.080 ms | 20.050 ms | 20.055 ms | 20.045 ms |
| Khoảng callback lớn nhất | 30.300 ms | 250.100 ms | 110.260 ms | 30.135 ms |

**Kết luận:** longest task quan sát giảm 3,128 ms (61.0%) và camera sau tải
giữ độ phản hồi. Chưa mở nhanh hơn: tổng pipeline cuối dài hơn đối chứng
8.149 s (6.13%), phần finalize dài hơn do nhường việc giữa các checkpoint.
Không bỏ kết quả trung gian hoặc đổi ngưỡng để chọn số đẹp. Còn task khoảng
2 giây trong commit/render ban đầu; mục tiêu 8 ms chưa phải giới hạn cứng.

Cả bốn lượt giữ **160,673 flat meshes, 42 IFNS / 212,340,264 byte, 14,009
templates, 1,370,547 occurrences, 552,026 instanced entity bounds**, tổng
245,093,805 vertices và 148,025,417 triangles. GPU 862,134,488 byte, CPU renderer
941,967,564 byte, 4,059 draw calls và 2,376 consolidated batches giữ nguyên.
Lượt cuối kiểm tra trực tiếp EntityTable có 2,589,544 rows; CSR forward/inverse
đều có 4,741,633 edges. Đây là census và fixture byte parity, không phải hash
toàn bộ hình học hoặc toàn bộ BIM của PVF.

BVH có 712,699 entries; bounds query của selected instance 1608 chứa đúng ID,
5 candidates. Properties có 2 Psets / 19 properties và washer diameter 20 mm.
Source trong viewer bằng 0. Ảnh scene/properties, CPU profiles và raw JSON nằm
trong `reports/native-followup` được ignore. Mọi lượt PVF clean-close, host exit 0.
Snapshot heap used cuối 2,578,695,824 byte so với 2,832,265,316 byte đối chứng;
không dùng snapshot sau GC để suy ra peak memory hay giới hạn mở file.

Packaged WebView2 smoke của đúng EXE cuối: **10 checks đạt**, native mặc định
không có URL override, 0 WASM instantiations, hai mô hình, 6 hướng camera,
Properties source-less và section box. Không có page error. Vẫn còn cảnh báo
federation EPSG:32760 và cảnh báo expressId vượt lane seam 24-bit trên PVF;
không tuyên bố geometry/GIS parity hoàn chỉnh.
<!-- /FOLLOWUP-METRICS -->

## Kiểm tra source

- Renderer: 1,989 đạt, 2 skipped đã có; kiểm tra byte parity, yielding bên trong
  một mesh lớn, hủy trước/sau GPU allocation, shared scratch và Scene.clear
  trong khoảng preparation/publication đều đạt.
- Data relationship graph: 23 đạt. Viewer: các shard BIM/native store/runtime,
  126 hierarchy checks và regression pending-selection/reveal đạt.
- Desktop Rust: 30 đạt; release cancellation: 4 đạt; server canonical data
  model: 102 đạt. Clippy all-targets với `-D warnings` đạt.
- Root typecheck: 109/109 tasks; 3,256 test files của 56 packages đều có
  typecheck program. API snapshots, module-size với base HEAD và diff check đạt.
  Không tăng allowlist, không tắt test hay giảm ngưỡng.
- Full data suite còn 10 lỗi Windows ở các generator/script không sửa trong
  lượt này: Windows ESM URL và quyền symlink. Parser broad suite trước đó còn
  lỗi đường dẫn POSIX/Windows; không tuyên bố toàn repo xanh.
- Canonical lint trên Windows bị chặn ở execFile pnpm.cmd. Bridge validation
  gọi cùng pinned pnpm CLI bằng Node, giữ nguyên mọi argument và nội dung gate.
  JSX a11y gate còn 3 cảnh báo `role="group"` của ViewCube đã có ở HEAD;
  file này không đổi. Không nâng baseline để che lỗi.
  Unused-locals gate vẫn lỗi so khớp key đường dẫn Windows (backslash) với
  baseline (slash); không tuyên bố gate này xanh. Lint runner thực sự chạy
  8,159 files / 136 rules và không có lỗi; test discovery, i18n và type-scale đạt.

## Giới hạn còn lại

Các lượt PVF dùng fresh WebView2 profile, có CPU profiler và lấy mẫu mỗi 5 giây.
Chưa có 5 lượt A/B xen kẽ trên máy rảnh; không dùng số này để chứng nhận
cold-load throughput, peak memory hay toàn bộ parity với web. Callback quay
camera không chứng minh FPS trình bày thực tế hoặc độ trễ pointer drag.

Budget nhường 8 ms là mục tiêu giữa các checkpoint; GC, một GPU call, sort,
tree projection và một record STEP lớn vẫn có thể kéo dài hơn. Mọi grouping
ngoài native spatial vẫn đi đường sync hiện tại. Whole-model yaw thay đổi
giữa preparation sẽ từ chối lượt đó để tránh sai frame. GIS/CRS, export/editing
và mọi property Unit override vẫn cần qualification riêng.
