# Kiểm chứng cải thiện PVF trong EXE native — 2026-10-09

Bản mới giữ native Rust mặc định. Lỗi đứng lâu sau khi mô hình hiện lên được
xác định bằng CPU profile của EXE và sửa ở bước dựng chỉ mục của viewer.

## EXE đã kiểm chứng

- Mới: `release/10.3.0-native-pvf-responsive-20261009/IFC-Lite.exe`.
- SHA256: `6827568D097BCC984E55178A5E8FC429B57B8F9D90EC68C2788F0B9EAA7E706F`.
- Source: `F:/Steel/VBA/IFC-Lite`, branch `codex/desktop-v10.3.0`, base
  `471284f476d64a659ae607eeec2115ca3afcb9fe`, cộng các thay đổi hiện có trong checkout.
  `build-info.json` cạnh EXE lưu các hash nguồn sửa và kết quả chạy.
- Đối chứng native trước sửa: `reports/pvf-responsiveness/baseline.exe`, SHA256
  `5334A036AD8170C01F905F4BC951B318514ECCC17B5B83876766D63821309659`.
  Đây là binary xây lúc 09:52 ngày 09/10, được sao chép trước khi sửa nguồn.
- EXE WASM đầu tiên ở `release/10.3.0/IFC-Lite.exe` và các release cũ được giữ nguyên.

## Nguyên nhân và sửa chữa

`buildPlacedSpatialIndex` gọi `withInstancedMeshes`, một helper dành cho xuất toàn
bộ hình học. Helper này gọi `Scene.getAllInstancedMeshData`, rồi bung mỗi occurrence
thành các mảng positions/normals riêng. Với PVF có hơn một triệu occurrence,
viewer mất lợi ích bộ nhớ của instancing ngay sau khi nhận mô hình native.

CPU profile trước bản sửa chỉ mục ghi rõ chuỗi:

`buildPlacedSpatialIndex → withInstancedMeshes → getAllInstancedMeshData → getInstancedMeshDataPieces → materializeInstances`.

Một tác vụ liên tục trong bản trung gian chiếm hơn 170 giây. Thu gom bộ nhớ
chiếm phần lớn mẫu CPU. Bản cuối không còn chuỗi bung hình học này trong profile tải.

Các thay đổi:

- Chỉ mục nhận hộp bao world-space của instance, đọc ma trận và anchor f64 hiện tại.
  Quyền sở hữu renderer model được kiểm tra riêng, kể cả khi hai model trùng ID.
- Thu thập hộp bao và dựng BVH theo các lát thời gian; giữ các guard chống index
  cũ xuất hiện lại sau khi dịch, xoay, thay model hoặc nhận thêm shard.
- Hộp bao bao gồm sai số làm tròn local Float32 của đường giao cắt chính xác,
  đồng thời giữ origin world-space ở f64.
- Đóng gói instance, camera RTE và normal dùng lại staging nhỏ thay cho cấp phát
  theo từng occurrence/vertex. Ghép batch dùng scratch CPU có giới hạn giữ lại;
  không giới hạn dung lượng mô hình hoặc bỏ hình học.
- Đường xuất đầy đủ và giao cắt chính xác vẫn bung tam giác khi được yêu cầu.

## Phép đo trên cùng PVF

File riêng: `F:/Working/IFC Temp/IFC_PVF.ifc`, 1.411.171.948 bytes.
Mỗi lần chạy dùng profile WebView2 mới và native mặc định. Đây là các quan sát
cục bộ trên máy này, không phải benchmark thống kê hoặc mức cam kết cho máy khác.

| Quan sát | Native trước sửa | Trung gian: giảm cấp phát | Bản cuối: thêm chỉ mục hộp bao |
|---|---:|---:|---:|
| Cảnh hoàn tất, theo lần thăm dò | 436.823 ms | 376.415 ms | 134.749 ms |
| Consolidation do renderer ghi | 69.276 ms | 43.952 ms | 4.669 ms |
| Callback xoay trong khoảng 10 giây | 66 | 412 | 606 |
| Khoảng cách khung hình p95 | 860,01 ms | 30,035 ms | 20,08 ms |
| Khoảng cách khung hình lớn nhất, bỏ callback đầu | 1.120,005 ms | 1.440,035 ms | 30,865 ms |
| Backing storage trước thao tác | Không thu | 7.222.819.677 bytes | 2.616.204.010 bytes |
| Tác vụ dài nhất trong quan sát tải | Không thu | 172.183 ms | 4.930 ms |
| Đóng cửa sổ, host exit 0 | Có | Có | Có |

Khoảng cách khung hình lấy từ requestAnimationFrame khi gọi rotateRight liên tục;
p95 dùng nearest-rank, bỏ callback đầu vì timestamp có thể trước lúc bắt đầu đo.
Bản cuối đạt khoảng 60 callback/giây trong phép đo này. Đây là phép thử xoay qua
camera callback, không phải phép đo pointer-drag FPS của PVF. Bản cuối cũng xác
nhận index đã xuất bản trước khi thao tác; hai bản trước bắt đầu sau renderer
completion và có thể còn dựng index nền. Không gán toàn bộ chênh lệch cho một hàm.

Poll trạng thái tải cách nhau khoảng 5 giây, nên thời điểm hoàn tất có độ trễ
thăm dò. Native payload đã sẵn sàng trước đó; thời gian mở vẫn còn khoảng hai phút.
Hai tác vụ dài nhất còn lại xảy ra trước khi cảnh hoàn tất, ở giai đoạn đưa instance
lên renderer. Chưa tuyên bố mọi bước mở đều đáp ứng liên tục hoặc tốc độ mở ngang web.

Một EXE WASM cũ do người dùng mở vẫn chạy xuyên suốt; không đóng tiến trình đó.
Các lần chạy không phải cặp đối chứng đảo thứ tự trên máy hoàn toàn rảnh.
Thử riêng bản WASM ghi nhận hình học đầu tiên sớm nhưng dừng quan sát trước full
completion; không dùng lần thử đó để kết luận so sánh full-load với web/WASM.

## Nội dung và thao tác xác nhận

Cả ba native run nhận cùng census:

- 160.673 flat meshes; 42 IFNS buffers, tổng 212.340.264 bytes.
- 14.009 templates; 1.370.547 occurrences; 552.026 instanced entity AABBs.
- 2.589.544 entities; 245.093.805 vertices; 148.025.417 triangles nguồn.
- Cùng 2.376 consolidated batches, draw census và GPU/CPU resident bytes ở Home.

Bản cuối có 712.699 phần tử hộp bao trong BVH, tương ứng flat pieces cộng
instanced entities. Hộp bao lấy từ hình học thực của entity 1608 tìm lại đúng entity
qua BVH; snapshot là instance, 7.776 corner components, 5 broad-phase candidates.
Properties hiển thị Bolt assembly, 2 Psets và 19 properties. Home, frame selection,
rotateRight và đóng app exit 0 đều được xác nhận trên PVF.

Smoke EXE native với hai IFC nhỏ vượt qua 9 kiểm tra: import, sáu hướng camera,
đồng bộ roll/phím, kéo viewcube, cạnh/góc cube, federation, BIM/Properties native
và section box. Route là `?engine=native`, không khởi tạo WASM, source IFC trong
WebView2 là 0 bytes. Đây là chứng cứ chức năng với fixture nhỏ, không thay cho
kiểm chứng PVF hoặc toàn bộ geometry parity.

Giới hạn đã quan sát: cảnh PVF còn cảnh báo seam-ID vượt 24-bit; fixture federation
nhỏ còn cảnh báo reprojection EPSG:32760. Chưa xác nhận GIS placement hoặc geometry
parity đầy đủ. Các cảnh báo này được giữ trong kết quả, không bị che để đạt pass.

## Kiểm tra nguồn

- Renderer: 1.979 pass, 2 skip sẵn có, không fail.
- Spatial: 66 pass. Test BVH zero-budget dùng task yield của Node thay cho timer
  bị làm tròn trên Windows; vẫn kiểm tra heartbeat, nhiều yield và đầy đủ query hits.
- 8 test files viewer liên quan: 75 pass, gồm placement/rotation, export instances,
  native stream và shard drain. Test indexing cấm gọi đường bung toàn bộ tam giác;
  đã fail trên implementation cũ và pass sau sửa.
- Root typecheck: 109/109 tasks; audit 3.252/3.252 test files, không bỏ coverage.
- Lint phần sửa, API surface và module-size gate qua; không tăng budget hoặc thêm suppression.
- Native EXE build thành công; EXE phát hành là bản sao đúng hash của binary đã chạy.

Shard viewer rộng dùng trong bước red còn có lỗi contrast/DOM ngoài phần sửa;
không coi đó là toàn bộ viewer suite đã xanh. Các kiểm tra liên quan và packaged
runtime bên trên được ghi riêng.

## Chứng cứ có thể đọc lại

Trong `reports/pvf-responsiveness/`:

- `baseline.json`, `candidate-1.json`, `candidate-2.json`: trạng thái, frame intervals,
  thuộc tính, bộ nhớ, camera, kết quả đóng app.
- `candidate-1-load.cpuprofile`, `candidate-2-load.cpuprofile`: mẫu CPU tải thực.
- `candidate-2-scene.png`, `candidate-2-properties.png`: ảnh chụp EXE.
- `smoke-final/smoke-native.json`: kiểm tra native/federation/camera/section.
- `build-final.log`, `typecheck-final.log`, `renderer-final-test.log`,
  `renderer-spatial-green.log`, `viewer-relevant-final.log`: build và checks.

Báo cáo cũ `PVF-CRASH-VALIDATION.md` được dùng làm ngữ cảnh sự cố; các con số ở đây
đến từ lần kiểm chứng hiện tại, không lấy kết luận thành công trong báo cáo cũ làm bằng chứng.
