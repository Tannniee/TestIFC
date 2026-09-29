# Nghiên cứu BIM-GIS cho IFC Viewer 1.0.3a

Ngày 2026-09-28. Tài liệu này ghi các quyết định kỹ thuật cho C1–C4 trong `plan.md`.

## Đánh giá mẫu tham khảo

`helenkwok/bim-gis-viewer` là demo hackathon dùng IFC.js đời cũ (`web-ifc` ^0.0.35), xuất IFC thành glTF và JSON thuộc tính, cất trong IndexedDB rồi nạp glTF vào Mapbox GL JS. Vị trí do người dùng chọn hoặc sinh ngẫu nhiên, lưu `localStorage`; cao độ `0`, góc xoay cố định. Mẫu chứng minh giao diện đặt model và custom Three.js layer, nhưng không giải quyết CRS, đơn vị, sai số tọa độ, hoặc selection BIM bên trong bản đồ. Không chuyển mã đó vào 1.0.3a.

Nguồn: https://github.com/helenkwok/bim-gis-viewer/blob/main/src/gis.js ; https://github.com/helenkwok/bim-gis-viewer/blob/main/src/wiv.js ; https://github.com/helenkwok/bim-gis-viewer/blob/main/package.json

## Hợp đồng tọa độ

1. IFC lưu hình học trong hệ engineering XYZ, với đơn vị dự án và các placement/context. `IfcMapConversion` mô tả dời, xoay, scale sang easting/northing/height của `IfcProjectedCRS`; `WorldCoordinateSystem` có thể dời thêm điểm gốc.
2. `IfcProjectedCRS.Name` xác định CRS đích. Tọa độ phẳng ENH chưa phải longitude/latitude. Bước bản đồ cần phép chuyển CRS sang WGS84 với thứ tự trục, đơn vị, datum ngang và datum đứng rõ ràng. `IfcMapConversion` tự nó không thực hiện phép chiếu địa lý.
3. 1.0.3a đang dời mô hình về gốc khi chuyển sang Fragments và tắt auto-coordinate thứ hai. Metadata GIS nằm ở semantic index, không sửa vertices hay placement của mô hình đang xem. Khi dựng lớp 3D cần lưu phép ánh xạ riêng từ tọa độ engineering gốc đến model-space Fragments đã dời gốc.
4. Thiếu CRS hoặc coordinate operation: báo `unavailable`. Anchor kéo thả sau này là `manual`, lưu theo model hash và luôn ghi rõ đó là vị trí do người dùng đặt. Không tự dùng `IfcSite.RefLatitude/RefLongitude` để khẳng định vị trí chính xác.

Nguồn: https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcMapConversion.htm ; https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcProjectedCRS.htm ; https://docs.ifcopenshell.org/autoapi/ifcopenshell/util/geolocation/index.html

## Lựa chọn triển khai từng bước

- **C1, đang triển khai:** dùng `ifcopenshell.util.geolocation` đọc CRS, Helmert transform và origin qua `auto_xyz2enh(0,0,0)`; trả dữ liệu project-space có nguồn IFC từ SQLite index. API có `modelHash` để từ chối phản hồi khi đã đổi tài liệu. Chưa phát longitude/latitude.
- **C2:** manual anchor với longitude, latitude, height và yaw; kiểm tra phạm vi, ghi theo hash, dùng để sửa/xóa. Phân biệt cao độ bản đồ, cao độ công trình và đơn vị.
- **C3:** marker/footprint trong tab bản đồ trước. MapLibre GL JS có custom Three.js layer và không buộc dùng token Mapbox; tile URL vẫn cần cấu hình, kiểm tra giấy phép và chế độ mất mạng của nguồn tile cụ thể. Chưa chọn nguồn tile mặc định trong bản đóng gói.
- **C4:** cân nhắc hai đường render: dùng lại Fragments với custom map GL context, hoặc sinh một bản trình diễn nhẹ cho bản đồ. Không dùng glTF mất GlobalId làm nguồn dữ liệu BIM chính. Chỉ giữ đường nào duy trì selection và đạt kiểm tra GPU/WebView2 trên model lớn.

Nguồn: https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/ ; https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/

## Chứng cứ cần có trước khi hiện model trên bản đồ

- Fixture IFC có map conversion, CRS, WCS lệch gốc, đơn vị mm → m và xoay trục; đối chiếu origin và ít nhất hai điểm kiểm soát sau chuyển đổi.
- IFC thật có georeference, IFC thiếu georeference, IFC dữ liệu mâu thuẫn; không đánh đồng nhãn CRS với tọa độ WGS84 đã chuyển.
- So sánh world-space bounds và hướng sau khi đặt lên bản đồ; chọn cấu kiện trên bản đồ phải dẫn đến cùng GlobalId/Pset/Qto trong viewer BIM.
- Đo cold load, first visible geometry, map overlay và reopen cache riêng; packaged WebView2, mất mạng, nguồn tile và vòng đời GPU đều cần kiểm tra.

## Tiến độ 2026-09-29

Đã thêm bản đồ chọn điểm thủ công trước khi có anchor, nút đến Việt Nam/toàn cầu, thao tác lưu ngay trên bản đồ và footprint từ bounding box ngang của Fragments. Tâm bounding box được đặt tại marker; góc xoay theo chiều kim đồng hồ và scale do người dùng nhập. Footprint chỉ là ước lượng mặt bằng, không phải biên dạng công trình hay kết quả trắc địa. Bản đồ demo MapLibre chỉ có dữ liệu quốc gia tới zoom 6; người dùng có thể nhập key MapTiler riêng để xem đường phố. Key chỉ giữ trong phiên mở bản đồ, không ghi vào IFC hay localStorage.

`pnpm check`, `pnpm test`, `pnpm build` và Playwright với `test-fixtures/phase3-bim.ifc` kiểm tra luồng trình duyệt. Chưa kiểm tra lớp 3D, lựa chọn cấu kiện trên bản đồ, IFC CRS→WGS84, hoặc WebView2 đóng gói cho thao tác mới. MapTiler style URL theo tài liệu chính thức: https://docs.maptiler.com/maplibre/examples/how-to-use-maplibre/ .
