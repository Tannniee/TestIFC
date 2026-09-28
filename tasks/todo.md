# IFC Viewer 1.0.4 — BIM và BIM-GIS

- [x] A1: Nâng WebIFC JS/WASM lên 0.0.78 và đổi cache Fragments; test/build/cold-load fixture IFC.
- [ ] A2: Packaged WebView2 smoke đã qua với fixture IFC; còn so sánh hình học và thời gian cold-load trên bộ IFC thực tế.
- [x] B1: Trích xuất và hiển thị quan hệ không gian.
- [x] B2: Trích xuất và hiển thị nhóm/hệ thống IFC.
- [x] B3: Lập chỉ mục scalar Pset/Qto có thể tìm theo tên và giá trị; semantic cache v5.
- [x] B4: API và giao diện lọc Pset/Qto, trả trạng thái index và giới hạn 500 kết quả.
- [x] C1: Đọc và phân loại IFC georeference; fixture và test.
- [x] C2: Lưu manual anchor theo model hash, tách khỏi cache bundle; sửa/xóa và kiểm tra tọa độ.
- [ ] C3: Marker MapLibre từ manual anchor đã qua browser và packaged WebView2; còn footprint, tile provider cấu hình được và IFC CRS→WGS84.
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
