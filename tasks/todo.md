# IFC Viewer 1.0.4 — BIM và BIM-GIS

- [x] A1: Nâng WebIFC JS/WASM lên 0.0.78 và đổi cache Fragments; test/build/cold-load fixture IFC.
- [ ] A2: Packaged WebView2 smoke đã qua với fixture IFC; còn so sánh hình học và thời gian cold-load trên bộ IFC thực tế.
- [x] B1: Trích xuất và hiển thị quan hệ không gian.
- [x] B2: Trích xuất và hiển thị nhóm/hệ thống IFC.
- [x] B3: Lập chỉ mục scalar Pset/Qto có thể tìm theo tên và giá trị; semantic cache v5.
- [x] B4: API và giao diện lọc Pset/Qto, trả trạng thái index và giới hạn 500 kết quả.
- [x] C1: Đọc và phân loại IFC georeference; fixture và test.
- [x] C2: Lưu manual anchor theo model hash, tách khỏi cache bundle; sửa/xóa và kiểm tra tọa độ.
- [ ] C3: Marker và footprint bounding box từ manual anchor; chọn điểm trên bản đồ, có thể dùng key MapTiler cho bản đồ đường phố. Còn kiểm tra packaged WebView2 cho luồng mới, cấu hình tile provider bền vững và IFC CRS→WGS84.
- [ ] C4: Đặt mô hình 3D có kiểm chứng tọa độ và hiệu năng.

## Project Browser

- [x] T1: View Spatial, Systems, Types, Groups, Classification, Material từ semantic index.
- [x] T2: Nhóm IFC category dưới storey, số lượng, Uncontained, icon loại và trạng thái Hidden/Selected.
- [x] T3: Tìm Name/GlobalId/IFC type; lọc type, Visible, Selected và Pset/Qto.
- [x] T4: Menu Hide, Isolate, Fit, Select children, Show Properties; thao tác cả nhóm con tầng/storey.
- [ ] T5: Đối chiếu hiệu năng và hành vi trên IFC lớn thực tế, nhất là tải catalog và nhóm nhiều membership.

Checkpoint sau A2: phiên bản và WASM khớp, cold-load IFC và packaged smoke đạt.

Checkpoint sau B4: Relations và tìm kiếm BIM làm việc trên IFC thật, kết quả được giới hạn và có trạng thái index.

Checkpoint sau C4: vị trí, hướng, scale, cao độ và lựa chọn cấu kiện còn đúng trong bản EXE.

## Phục hồi BIM-GIS Viewer và tích hợp Mapbox vào shell TestIFC (giai đoạn D)

- [x] D1: Khóa commit upstream, clone ngoài source TestIFC, build và sửa token/biến chưa khai báo; mở IFC mẫu và GIS.
- [x] D2: Geocoder, Move model to pin, random, Fly/Back to space, marker, nhà 3D và camera qua trình duyệt thật; bốn ảnh trong `reports/mapbox-reference`. Sửa fog khởi tạo ở `style.load` để hết lỗi marker opacity của Mapbox 2.10.
- [x] D3: IFC.js→glTF/JSON→Dexie→Mapbox/Three.js trong iframe cùng origin, dependencies riêng, một IFC hoạt động; hợp đồng và patch ở `frontend/gis-runtime/README.md`.
- [x] D4: Public token trong Settings theo profile: thử, lưu, thay, xóa, hiện/ẩn; WebView2 lưu thật qua desktop API, đổi key giữ camera và glTF. Token không nằm trong source/build.
- [x] D5: Icon Map sau Section Box/trước Settings; giữ globe đổi ngôn ngữ; Mapbox ở vùng chính, quay lại viewer và giữ bộ lọc Project Browser. Đổi/đóng tài liệu chỉ còn một overlay đúng hash.
- [x] D6: Chọn pin trực tiếp, yaw/scale/cao độ, preview/Save/Cancel và anchor theo hash; camera độc lập với yaw. Thay key dựng lại style; đổi file hủy iframe/worker và tài nguyên Three.
- [ ] D7: Bản đầu đã qua 199 Python + 55 frontend tests, Svelte/build, 6 Playwright regression tests, IFC.js cold/warm và EXE WebView2 với `01.ifc`. Còn bộ IFC lớn, parity hình học định lượng, đo riêng first visible pixels/semantic readiness và vị trí CRS chuẩn trước khi mở rộng engine.

Checkpoint D2: upstream chạy được, các thao tác và bốn ảnh có bằng chứng, mọi patch khác upstream được ghi rõ.

Checkpoint D5: icon Map đúng trong rail trái và mở được khi chưa có IFC; GIS không còn là popup Project Browser; viewer/Mapbox cùng xoay được; một IFC giữ đúng ghim khi camera bản đồ đổi.

Checkpoint D7: TestIFC có Mapbox hoạt động trong EXE; từng profile thay key riêng, lỗi token/mạng được báo rõ; viewer và dữ liệu BIM không hồi quy.
