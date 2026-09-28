# Kế hoạch phát triển IFC Viewer 1.0.3a: BIM và BIM-GIS

Ngày lập: 2026-09-28. Nguồn phát triển duy nhất: `codex/testifc-1.0.3a`.

## Mục tiêu và thứ tự

1. Nâng `web-ifc` từ `0.0.77` lên `0.0.78` cùng các tệp WASM đóng gói; chứng minh đường mở IFC còn đúng.
2. Hoàn thiện dữ liệu BIM theo chiều dọc: quan hệ không gian, nhóm và hệ thống; sau đó tìm kiếm/lọc Pset và Qto trên semantic index.
3. Bổ sung BIM-GIS từng bước: nhận diện georeference IFC, cho phép định vị thủ công có nhãn nguồn, rồi hiển thị mô hình trên bản đồ. Không thay đổi tọa độ hình học gốc để tạo hiệu ứng bản đồ.

## Hiện trạng và quyết định kiến trúc

- Frontend dùng `@thatopen/fragments@3.4.7`, `web-ifc@0.0.77`, WASM nội bộ tại `frontend/public/vendor/web-ifc/`. Chuyển đổi IFC đặt `COORDINATE_TO_ORIGIN: true`; Fragments tắt `autoCoordinate`. Bất kỳ phép BIM-GIS nào cũng phải ghi rõ chuyển đổi từ hệ tọa độ IFC gốc đến hệ bản đồ, tránh chuyển gốc hai lần.
- Semantic index SQLite v3 có `element` hot và `element_cold` cho Pset/Qto. Cửa sổ Properties lấy thông tin này theo model hash. Tìm kiếm FTS hiện bao phủ tên, loại, mô tả, phân loại; chưa có chỉ mục Pset/Qto.
- `bim-gis-viewer` là mẫu Mapbox + Three.js: đặt mô hình bằng longitude/latitude thủ công, góc xoay cố định và glTF xuất từ IFC. Mã không đọc `IfcMapConversion`/`IfcProjectedCRS`; phiên bản `web-ifc` của mẫu là `0.0.35`. Chỉ tham khảo ý tưởng và phương pháp custom 3D layer, không sao chép kiến trúc cũ.
- IFC georeference là dữ liệu có thể thiếu hoặc mâu thuẫn. Trạng thái GIS phải phân biệt `ifc`, `manual`, `unavailable`; không suy ra độ chính xác khảo sát từ thao tác kéo thả. Giữ EPSG/CRS, trục, đơn vị, Easting/Northing/Height, phép quay và scale có nguồn gốc rõ ràng.
- Ưu tiên MapLibre GL JS để thử nghiệm bản đồ, với nguồn tile cấu hình được và khả năng dùng không có token Mapbox. Cần kiểm tra WebView2 và điều kiện tile trước khi chọn làm mặc định. Trước khi nạp model thật lên bản đồ, dùng marker/footprint để kiểm chứng vị trí và chuyển đổi tọa độ.

## Các lát triển khai

### Giai đoạn A — WebIFC 0.0.78

**A1. Nâng cặp JS/WASM.** Cập nhật `package.json`, lockfile và WASM vendor đúng cùng phiên bản. Đổi namespace cache Fragments để lần mở đầu tiên dùng hình học mới.

Chấp nhận: phiên bản phụ thuộc/lock là `0.0.78`; hash WASM vendor khớp package đã cài; không đọc cache chuyển đổi cũ. Kiểm tra: frontend test, type/Svelte check, build và cold-load IFC thật.

**A2. Kiểm tra hồi quy đóng gói.** So sánh cấu kiện, GlobalId, bounds và hình học của bộ IFC hiện có; đo cold conversion riêng với cache reopen. Xác nhận WebView2 packaged smoke trước khi coi nâng cấp là sẵn sàng phát hành.

Phát hiện trong A1: bản JS 0.0.78 gọi `StreamMeshes` của WASM với 4 tham số nhưng binding tại tag 0.78 vẫn khai báo 3. Bản vá pnpm trong `frontend/patches/` giữ đường mặc định 3 tham số, đồng thời từ chối rõ ràng yêu cầu tắt linear scaling mà binding này chưa hỗ trợ. Bỏ bản vá khi upstream sửa binding và kiểm tra lại IFC thật.

### Giai đoạn B — BIM semantic

**B1. Quan hệ không gian.** Trích xuất container và chuỗi cha `Project → Site → Building → Storey → element` từ IFC; không đồng nhất container với cây phân rã hoặc tọa độ hình học. Hiển thị trong tab Relations, có ID và loại IFC để truy nguồn.

Chấp nhận: IFC thiếu một cấp vẫn hiển thị phần còn lại; phần tử được tham chiếu có đường dẫn đúng; không mở lại geometry chỉ để trả lời quan hệ.

**B2. Nhóm và hệ thống.** Trích xuất `IfcRelAssignsToGroup`/`IfcSystem`/`IfcDistributionSystem`, bảo toàn nhiều nhóm và phân biệt hệ thống với nhóm thường. Hiển thị và kiểm tra mô hình có nhiều membership.

**B3. Chỉ mục Pset/Qto có điều kiện.** Thêm bảng inverted index cho cặp `set.name`, `property.name`, giá trị đã chuẩn hóa và giá trị số/đơn vị; cập nhật version schema, build cold theo batch. Không quét toàn bộ JSON khi mỗi lần tìm.

**B4. API và UI lọc.** Truy vấn `Pset.FireRating = 2h`, `Qto.NetVolume >= N` cùng lọc IFC type; giới hạn số kết quả và chỉ báo index đang lập. Có tests cho số, chuỗi, thiếu thuộc tính, đơn vị và giới hạn.

### Giai đoạn C — BIM-GIS

**C1. Khảo sát tọa độ và nguồn dữ liệu.** Thêm bộ đọc chỉ đọc cho `IfcMapConversion`, `IfcProjectedCRS`, đơn vị và context; trả về trạng thái `unavailable` khi thiếu/không đủ CRS. Có fixture buildingSMART và IFC thực. Không biến `IfcSite.RefLatitude/RefLongitude` thành tọa độ chính xác khi thiếu phép chuyển đổi.

**C2. Manual anchor.** Lưu riêng theo model hash kinh/vĩ độ, cao độ, góc xoay và nguồn `manual`, có thao tác xem lại/sửa/xóa. Không ghi ngược vào IFC. Kiểm tra tọa độ và độ cao hữu hạn, phạm vi hợp lệ.

**C3. Bản đồ vị trí.** Bản đồ riêng trong WebView2 trước hết hiển thị marker/footprint từ anchor/IFC georeference, cảnh báo khi CRS chưa thể chuyển sang WGS84. Kiểm tra hành vi mất mạng và nguồn tile.

**C4. Lớp mô hình 3D.** Chỉ khi C1–C3 đúng mới đặt model lên custom 3D layer; bảo toàn hướng, kích thước, cao độ, selection/GlobalId. So sánh ít nhất hai điểm kiểm soát và bounds sau chuyển đổi; kiểm tra GPU, mô hình lớn và packaged runtime.

## Cổng kiểm tra và rủi ro

- Mỗi lát phải qua test đúng tầng và build trước khi chuyển lát tiếp theo. A2 và C4 cần kiểm tra EXE WebView2 thực; unit/build không chứng minh được hành vi đó.
- 0.78 thay đổi nhiều đường parsing/geometry hơn nội dung release note ngắn; cache cũ và hình học có thể khác. Giữ bằng chứng 0.0.77 để so sánh, không coi warm cache là cold-load.
- CRS không xác định, hệ cao độ khác nhau, `WorldCoordinateSystem` và phép dời về gốc có thể gây lệch lớn. GIS chỉ báo vị trí chính xác khi có CRS và phép biến đổi được kiểm chứng; manual anchor có nhãn thủ công.
- Pset/Qto có thể lớn và không đồng nhất. Chỉ mục cần build tăng dần, giới hạn bộ nhớ và chuẩn hóa số/đơn vị mà vẫn giữ nguyên dữ liệu nguồn.

## Nguồn kỹ thuật

- WebIFC 0.78: https://github.com/ThatOpen/engine_web-ifc/releases/tag/0.78
- BIM-GIS prototype: https://github.com/helenkwok/bim-gis-viewer/blob/main/src/gis.js
- IFC georeference: https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcMapConversion.htm và https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcProjectedCRS.htm
- MapLibre custom 3D layer: https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/
- IfcOpenShell geolocation API: https://docs.ifcopenshell.org/autoapi/ifcopenshell/util/geolocation/index.html
