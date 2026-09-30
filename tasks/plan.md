# Kế hoạch phát triển IFC Viewer 1.0.4: BIM và BIM-GIS

Ngày lập: 2026-09-28. Nguồn phát triển duy nhất: `codex/testifc-1.0.3a`.

## Mục tiêu và thứ tự

1. Nâng `web-ifc` từ `0.0.77` lên `0.0.78` cùng các tệp WASM đóng gói; chứng minh đường mở IFC còn đúng.
2. Hoàn thiện dữ liệu BIM theo chiều dọc: quan hệ không gian, nhóm và hệ thống; sau đó tìm kiếm/lọc Pset và Qto trên semantic index.
3. Bổ sung BIM-GIS từng bước: nhận diện georeference IFC, cho phép định vị thủ công có nhãn nguồn, rồi hiển thị mô hình trên bản đồ. Không thay đổi tọa độ hình học gốc để tạo hiệu ứng bản đồ.

## Nền ban đầu và quyết định kiến trúc

- Trước giai đoạn A, frontend dùng `@thatopen/fragments@3.4.7`, `web-ifc@0.0.77`, WASM nội bộ tại `frontend/public/vendor/web-ifc/`. Chuyển đổi IFC đặt `COORDINATE_TO_ORIGIN: true`; Fragments tắt `autoCoordinate`. Bất kỳ phép BIM-GIS nào cũng phải ghi rõ chuyển đổi từ hệ tọa độ IFC gốc đến hệ bản đồ, tránh chuyển gốc hai lần.
- Trước giai đoạn B, semantic index SQLite v3 có `element` hot và `element_cold` cho Pset/Qto. Cửa sổ Properties lấy thông tin này theo model hash. Tìm kiếm FTS bao phủ tên, loại, mô tả, phân loại nhưng chưa có chỉ mục Pset/Qto.
- `bim-gis-viewer` là mẫu Mapbox + Three.js: đặt mô hình bằng longitude/latitude thủ công, góc xoay cố định và glTF xuất từ IFC. Mã không đọc `IfcMapConversion`/`IfcProjectedCRS`; phiên bản `web-ifc` của mẫu là `0.0.35`. Chỉ tham khảo ý tưởng và phương pháp custom 3D layer, không sao chép kiến trúc cũ.
- IFC georeference là dữ liệu có thể thiếu hoặc mâu thuẫn. Trạng thái GIS phải phân biệt `ifc`, `manual`, `unavailable`; không suy ra độ chính xác khảo sát từ thao tác kéo thả. Giữ EPSG/CRS, trục, đơn vị, Easting/Northing/Height, phép quay và scale có nguồn gốc rõ ràng.
- Ưu tiên MapLibre GL JS để thử nghiệm bản đồ, với nguồn tile cấu hình được và khả năng dùng không có token Mapbox. Cần kiểm tra WebView2 và điều kiện tile trước khi chọn làm mặc định. Trước khi nạp model thật lên bản đồ, dùng marker/footprint để kiểm chứng vị trí và chuyển đổi tọa độ.

## Các lát triển khai

### Giai đoạn A — WebIFC 0.0.78

**A1. Nâng cặp JS/WASM.** Cập nhật `package.json`, lockfile và WASM vendor đúng cùng phiên bản. Đổi namespace cache Fragments để lần mở đầu tiên dùng hình học mới.

Chấp nhận: phiên bản phụ thuộc/lock là `0.0.78`; hash WASM vendor khớp package đã cài; không đọc cache chuyển đổi cũ. Kiểm tra: frontend test, type/Svelte check, build và cold-load fixture IFC; A2 kiểm tra tiếp trên bộ IFC thực tế.

**A2. Kiểm tra hồi quy đóng gói.** So sánh cấu kiện, GlobalId, bounds và hình học của bộ IFC hiện có; đo cold conversion riêng với cache reopen. Xác nhận WebView2 packaged smoke trước khi coi nâng cấp là sẵn sàng phát hành.

Đã chạy packaged WebView2 smoke với fixture `test-fixtures/phase3-bim.ifc`, gồm hình học, semantic index và API georeference. Còn thiếu bộ IFC thực tế đủ đa dạng để đối chiếu hình học và benchmark lạnh.

Phát hiện trong A1: bản JS 0.0.78 gọi `StreamMeshes` của WASM với 4 tham số nhưng binding tại tag 0.78 vẫn khai báo 3. Bản vá pnpm trong `frontend/patches/` giữ đường mặc định 3 tham số, đồng thời từ chối rõ ràng yêu cầu tắt linear scaling mà binding này chưa hỗ trợ. Bỏ bản vá khi upstream sửa binding và kiểm tra lại IFC thật.

### Giai đoạn B — BIM semantic

**B1. Quan hệ không gian.** Trích xuất container và chuỗi cha `Project → Site → Building → Storey → element` từ IFC; không đồng nhất container với cây phân rã hoặc tọa độ hình học. Hiển thị trong tab Relations, có ID và loại IFC để truy nguồn.

Chấp nhận: IFC thiếu một cấp vẫn hiển thị phần còn lại; phần tử được tham chiếu có đường dẫn đúng; không mở lại geometry chỉ để trả lời quan hệ.

**B2. Nhóm và hệ thống.** Trích xuất `IfcRelAssignsToGroup`/`IfcSystem`/`IfcDistributionSystem`, bảo toàn nhiều nhóm và phân biệt hệ thống với nhóm thường. Hiển thị và kiểm tra mô hình có nhiều membership.

**B3. Chỉ mục Pset/Qto có điều kiện.** Thêm bảng inverted index cho cặp `set.name`, `property.name`, giá trị đã chuẩn hóa và giá trị số/đơn vị; cập nhật version schema, build cold theo batch. Không quét toàn bộ JSON khi mỗi lần tìm.

Đã triển khai `semantic_value` trong semantic index v5, cùng chỉ mục text/số và ghi theo batch cold. Giá trị Qto số dùng đơn vị chuẩn hóa từ extractor; kết quả vẫn giữ bản ghi gốc để xem chi tiết.

**B4. API và UI lọc.** Truy vấn `Pset.FireRating = 2h`, `Qto.NetVolume >= N` cùng lọc IFC type; giới hạn số kết quả và chỉ báo index đang lập. Có tests cho số, chuỗi, thiếu thuộc tính, đơn vị và giới hạn.

Đã có `/model/semantic-search` và form trong Project Browser, giới hạn 500 phần tử để tránh đưa toàn bộ kết quả vào UI. Khi cold index chưa ready, API trả trạng thái rõ ràng và chưa coi kết quả là đầy đủ.

### Giai đoạn C — BIM-GIS

**C1. Khảo sát tọa độ và nguồn dữ liệu.** Thêm bộ đọc chỉ đọc cho `IfcMapConversion`, `IfcProjectedCRS`, đơn vị và context; trả về trạng thái `unavailable` khi thiếu/không đủ CRS. Có fixture buildingSMART và IFC thực. Không biến `IfcSite.RefLatitude/RefLongitude` thành tọa độ chính xác khi thiếu phép chuyển đổi.

**C2. Manual anchor.** Lưu riêng theo model hash kinh/vĩ độ, cao độ, góc xoay và nguồn `manual`, có thao tác xem lại/sửa/xóa. Không ghi ngược vào IFC. Kiểm tra tọa độ và độ cao hữu hạn, phạm vi hợp lệ.

Đã lưu dưới thư mục `gis_anchors` riêng với bundle cache; API đọc/lưu/xóa ràng buộc active model hash. Project Browser cho nhập kinh/vĩ độ, cao độ, góc xoay, scale và ghi nhãn nguồn thủ công.

**C3. Bản đồ vị trí.** Bản đồ riêng trong WebView2 trước hết hiển thị marker/footprint từ anchor/IFC georeference, cảnh báo khi CRS chưa thể chuyển sang WGS84. Kiểm tra hành vi mất mạng và nguồn tile.

MapLibre hiện hiển thị marker và footprint theo manual anchor, cho bấm chọn vị trí trên bản đồ toàn cầu, dùng MapTiler Hybrid khi có `VITE_MAPTILER_API_KEY` và chuyển sang nền trống khi mất tile. Backend dùng pyproj để chuyển `IfcMapConversion` có EPSG projected CRS đơn vị mét sang WGS84, gồm gốc và ba điểm kiểm soát cách gốc một mét. CRS không giải được vẫn giữ metadata projected và chỉ cho đặt thủ công. Cao độ IFC được hiển thị nhưng luôn ghi rõ hệ quy chiếu đứng chưa được xác minh. Bản đồ không ghi ngược vị trí vào IFC.
Nền mặc định khi có key là MapTiler Hybrid vệ tinh để vị trí ít dữ liệu đường phố vẫn có ảnh nền; có nút đổi sang Streets. Chọn điểm thủ công tự đưa cả mô hình vào khung nhìn khi hình học sẵn sàng, còn nút đến vị trí dùng khung nhìn mô hình thay vì zoom cố định quá sát.

**C4. Lớp mô hình 3D.** Chỉ khi C1–C3 đúng mới đặt model lên custom 3D layer; bảo toàn hướng, kích thước, cao độ, selection/GlobalId. So sánh ít nhất hai điểm kiểm soát và bounds sau chuyển đổi; kiểm tra GPU, mô hình lớn và packaged runtime.

Đã dựng lớp MapLibre custom WebGL từ `FragmentsModel.getItemsGeometry`, giữ `localId` từng mesh và đồng bộ chọn cấu kiện/GlobalId với viewer. Manual anchor đặt tâm mặt bằng tại marker; IFC CRS khôi phục phép dời `COORDINATE_TO_ORIGIN` bằng `getCoordinationMatrix` rồi dùng các điểm kiểm soát để tạo phép chiếu địa phương. Có kiểm thử số học trục, góc, scale, cao độ, browser rendering/chọn cấu kiện, ảnh quan sát với IFC có gốc lệch 1–2 km và packaged WebView2 smoke cho cả vị trí IFC lẫn thủ công. Preview giới hạn 500.000 tam giác và hiển thị cảnh báo khi bị cắt; đây chưa phải đường hiển thị toàn bộ mô hình rất lớn. Cần thêm IFC khảo sát thực, đối chiếu mốc hiện trường, xác minh hệ cao độ và benchmark GPU với mô hình lớn trước khi gọi vị trí là chính xác khảo sát.

## Cổng kiểm tra và rủi ro

- Mỗi lát phải qua test đúng tầng và build trước khi chuyển lát tiếp theo. A2 và C4 cần kiểm tra EXE WebView2 thực; unit/build không chứng minh được hành vi đó.
- 0.78 thay đổi nhiều đường parsing/geometry hơn nội dung release note ngắn; cache cũ và hình học có thể khác. Giữ bằng chứng 0.0.77 để so sánh, không coi warm cache là cold-load.
- CRS không xác định, hệ cao độ khác nhau, `WorldCoordinateSystem` và phép dời về gốc có thể gây lệch lớn. GIS chỉ báo vị trí chính xác khi có CRS và phép biến đổi được kiểm chứng; manual anchor có nhãn thủ công.
- Pset/Qto có thể lớn và không đồng nhất. Chỉ mục cần build tăng dần, giới hạn bộ nhớ và chuẩn hóa số/đơn vị mà vẫn giữ nguyên dữ liệu nguồn.
- Project Browser hiện tải catalog gọn của toàn bộ sản phẩm một lần cho từng view, còn danh sách hiển thị được virtualize. Cần đo với IFC rất lớn trước khi coi latency/bộ nhớ đạt chuẩn sản xuất.

## Project Browser 1.0.4

- Giữ Spatial từ Fragments và nhóm category trực tiếp dưới storey. `Uncontained` dành cho cấu kiện có geometry mà không có trong cây chứa; không đoán storey từ tọa độ.
- Các view Systems, Types, Groups, Classification và Material lấy membership đã lập chỉ mục; cấu kiện nhiều membership có thể xuất hiện ở nhiều nhóm, `Unassigned` hiển thị phần còn lại.
- Search cục bộ theo Name/GlobalId/IFC type trên catalog gọn; lọc IFC type, Visible/Selected và tập kết quả Pset/Qto. UI virtualize rows và hiển thị số lượng trong nhóm.
- Right click mở menu Hide, Isolate, Fit, Select children, Show Properties; nhóm tầng/storey áp dụng cho các product hậu duệ. Show All khôi phục visibility.
- Cần thêm bộ IFC lớn thực tế để kiểm tra độ trễ catalog, quyền số lượng thành viên, hiệu năng filter và trạng thái visibility sau chuyển view/model.

## Nguồn kỹ thuật

- WebIFC 0.78: https://github.com/ThatOpen/engine_web-ifc/releases/tag/0.78
- BIM-GIS prototype: https://github.com/helenkwok/bim-gis-viewer/blob/main/src/gis.js
- IFC georeference: https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcMapConversion.htm và https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcProjectedCRS.htm
- MapLibre custom 3D layer: https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/
- IfcOpenShell geolocation API: https://docs.ifcopenshell.org/autoapi/ifcopenshell/util/geolocation/index.html

## Giai đoạn D — Phục hồi công nghệ BIM-GIS trong giao diện TestIFC

Ngày bổ sung và điều chỉnh: 2026-09-30. Quyết định của người dùng: giữ khung giao diện TestIFC hiện tại (`codex/testifc-1.0.3a`, HEAD khi lập kế hoạch: `ec32967`) và thêm icon Mapbox vào thanh rail trái được khoanh đỏ. Công nghệ BIM-GIS dùng theo `helenkwok/bim-gis-viewer`: Mapbox GL JS, Three.js custom layer, IFC.js→glTF/JSON, IndexedDB và đặt mô hình bằng ghim. Phục hồi repo upstream riêng trước để có baseline, sau đó chuyển luồng công nghệ đó vào TestIFC phía sau shell hiện tại. Các việc A2/C3/C4/T5 cũ vẫn được giữ nguyên trong danh sách, không tự coi là hoàn tất.

### Đích và ranh giới

- **Mốc 1 — phục hồi nguyên mẫu:** checkout upstream tại commit `e3de3b97c0d37b7feb3211b30cd8fe8393c31e01`; mở IFC mẫu, vào trang GIS, tìm vị trí, đặt ghim, bay từ địa cầu đến mô hình, xem mô hình và nhà 3D trên Mapbox Light. Lưu ảnh và nhật ký lỗi của bốn trạng thái người dùng đã gửi. Ghi riêng mọi sửa đổi tối thiểu so với upstream.
- **Mốc 2 — tích hợp vào shell TestIFC:** giữ `AppRail.svelte`, WorkspaceTabs, vùng nội dung chính và Cài đặt của app. Icon Mapbox mới trong rail chuyển giữa viewer IFC và màn hình Mapbox toàn vùng chính. Bên trong màn hình GIS dùng Mapbox GL JS, geocoder, Three.js custom layer và glTF/JSON từ IFC.js theo upstream; chỉ một IFC đang hoạt động trên map. Viewer và map đều có camera xoay được; người dùng chỉnh hướng đặt mô hình và thay Mapbox key trong Cài đặt.
- **Mốc 3 — phát triển tiếp:** mở rộng độ chính xác tọa độ, Pset/Qto/quan hệ trên bản đồ, chọn cấu kiện, mô hình lớn và nhiều mô hình nếu được yêu cầu sau. Dữ liệu và chức năng TestIFC hiện có phải được đối chiếu trước khi thay engine viewer; đặc tả từng thay đổi khi bắt đầu.
- Manual pin của repo mẫu chỉ cho vị trí trình diễn do người dùng chọn; không khẳng định đó là vị trí trắc địa của IFC.
- Bản đầu chỉ hiển thị **một IFC trên bản đồ**. Mở IFC khác sẽ thay mô hình đang hoạt động trên Mapbox, hủy lớp WebGL cũ và không chồng hai IFC. Chưa làm multi-model overlay.

### Hợp đồng tương tác người dùng

| Vùng | Thao tác bắt buộc | Trạng thái phải giữ |
| --- | --- | --- |
| BIM viewer | Orbit, pan, zoom, fit IFC và đọc thuộc tính bằng chuột/touch | Chỉ đổi camera viewer; không đổi tọa độ/góc đặt mô hình trên bản đồ. |
| Bản đồ Mapbox | Pan, zoom, xoay bearing, nghiêng pitch, compass/reset, fly globe↔model | Mô hình 3D bám ghim khi camera bản đồ thay đổi; marker và nhà 3D vẫn đúng vị trí. |
| Chỉnh vị trí mô hình | Đặt/kéo ghim, chỉnh yaw, scale và cao độ của IFC đang chọn; xem trước rồi lưu/hủy | Chỉ thay transform của mô hình đang chỉnh; xoay bản đồ không tự đổi yaw. Ghi nhãn `manual`. |
| Cài đặt Mapbox | Dán, thử, lưu, thay hoặc xóa public access token của người dùng | Key lưu theo profile trình duyệt/app, không hardcode hay ghi vào IFC/Git; thay key dựng lại map/geocoder nhưng giữ camera, ghim và mô hình. Token sai/hết quyền báo lỗi rõ. |
| Điều hướng chính | Icon Map riêng trong thanh dọc sát mép trái được khoanh đỏ ở ảnh 2026-09-30, ngang hàng Folder/Fit/Settings; bấm để chuyển viewer↔Mapbox | Rail vẫn hiện khi xem Mapbox. Trang bản đồ chiếm vùng làm việc chính, không mở trong Project Browser hay popup. Chưa có IFC thì thao tác đặt mô hình chờ file; chưa có key thì dẫn tới Cài đặt. |

Ảnh mới xác định đúng vị trí UI: thanh này hiện là `AppRail.svelte` (`.qn-rail`) trong TestIFC. Icon hình địa cầu hiện có ở gần cuối thanh đang dùng để đổi ngôn ngữ, vì vậy icon **Map** phải là một nút mới với biểu tượng khác, tên truy cập/tooltip `Mapbox` và trạng thái active. Vị trí đề xuất trong nhóm icon chính: sau Section Box và trước Settings, luôn nhìn thấy kể cả khi chưa mở IFC. Màn hình Mapbox thay phần nội dung chính bên phải rail; không lồng trong `GisAnchorPanel`/`ProjectBrowser` hiện tại. Rail và WorkspaceTabs của TestIFC tiếp tục hiển thị để người dùng quay lại viewer.

Mapbox token chạy ở client nên người dùng có thể xem được trong network tools; chỉ nhận public token với quyền tối thiểu cho style/font/geocoding cần dùng, không nhận secret token. Nếu token bị giới hạn URL, `localhost`/origin đóng gói phải được cho phép; lỗi 401/403 phải hiện trong Cài đặt. Bản khôi phục nguyên mẫu được phép nhận key cục bộ tạm thời ở D1; giao diện thay key là yêu cầu bắt buộc trước khi coi bản tích hợp dùng được.

### Những gì hiện có và khoảng cách đến mẫu

TestIFC đã có manual anchor, IFC CRS→WGS84, footprint, lớp Three.js trên MapLibre và đồng bộ selection, nhưng giao diện hiện là preview từ Project Browser. Mẫu dùng Mapbox GL JS 2.10.0, `light-v10`, globe/fog, lớp nhà 3D từ `building` vector tiles, geocoder, ghim và hành trình fly 12 giây. Giai đoạn tích hợp thay đường GIS preview bằng workspace Mapbox ở vùng chính. Giữ viewer cũ hoạt động trong lúc đưa pipeline IFC.js của mẫu vào, rồi quyết định thay engine viewer dựa trên parity chức năng và hiệu năng.

Upstream xuất IFC thành glTF/JSON rồi cất trong IndexedDB; trang GIS nạp lại glTF. Bản nguồn có `process.env.MAPBOX_API_KEY` còn nguyên trong browser bundle và gán `coordinatesData` khi chưa khai báo. Bước phục hồi phải sửa tối thiểu hai lỗi khởi động đó trong bản tham chiếu, giữ diff rõ ràng và không đưa token vào Git. Repo nguồn có Apache-2.0; dịch vụ/SDK Mapbox cần token và điều kiện sử dụng riêng.

### Thứ tự triển khai và điều kiện đạt

**D1. Đóng băng và phục hồi upstream (nhỏ, checkout tham chiếu riêng).** Clone đúng commit ngoài source TestIFC; ghi Node/npm, lockfile, hash và ảnh baseline. `npm ci`, `npm run build`, phục vụ trang bằng HTTP. Thêm cấu hình token chạy cục bộ và sửa lỗi khai báo biến bằng patch tối thiểu, không thay các thuật toán IFC/Mapbox. Chấp nhận: `index.html` mở IFC mẫu và `gis.html` mở không có lỗi JS khởi động; token không có trong commit/log/screenshot. Kiểm tra trong trình duyệt thật, ngoài build. Checkout này là baseline kỹ thuật để port vào TestIFC.

**D2. Chứng minh luồng mẫu (nhỏ).** Kiểm tra geocoder, ghim, Move model to pin, random, Fly to model/Back to space, marker, nhà 3D và IFC viewer. Chụp bốn trạng thái và ghi tọa độ, zoom/pitch/bearing, thời gian tải và lỗi console/network. Chấp nhận: mô hình hiện đúng ở vị trí ghim; thao tác đổi vị trí và trở về địa cầu lặp lại được sau reload. Nếu CDN/tile cũ không còn dùng được, ghi giới hạn và patch tương thích riêng thay vì coi phục hồi đã đạt.

**D3. Khóa hợp đồng chuyển công nghệ vào TestIFC (nhỏ).** Lập ma trận từng yếu tố của bốn ảnh: globe, Light style, fog, building extrusion, geocoder, toolbar, marker, camera, model layer. Tài liệu hóa luồng IFC.js→glTF/JSON→IndexedDB→Three.js custom layer và phép đặt Mercator từ ghim. Xác định cách nhận đúng một IFC đang hoạt động từ shell và cô lập dependency IFC.js cũ với viewer đang chạy; ghi rõ vòng đời giải phóng khi đổi tài liệu. Chấp nhận: baseline upstream tái lập được và hợp đồng map↔shell đủ để port mà không trộn trạng thái mô hình.

**D4. Cài đặt Mapbox key theo người dùng (nhỏ).** Mở rộng panel Settings hiện có và `settings.ts`/desktop settings bằng trường public token có thể xem/ẩn, thử kết nối, lưu, thay và xóa. Lưu theo profile của app, có fallback local khi chạy browser; khi thay key, tạo lại map/geocoder mà không xóa IFC/glTF/JSON. Chấp nhận: hai profile dùng hai key khác nhau; đổi key không cần sửa source/build; key sai hoặc URL restriction trả thông báo rõ; không ghi key vào repo, log ứng dụng hay file IFC.

**D5. Hai khung nhìn tương tác và icon Map ở `AppRail.svelte` (vừa).** Thêm nút Map riêng ngay trong thanh icon dọc của ảnh, giữ nguyên nút địa cầu đổi ngôn ngữ; `App.svelte` đổi nội dung vùng làm việc chính sang Mapbox, rail vẫn hiện. Nối vòng đời một IFC đang hoạt động từ shell với glTF, geocoder, ghim, Move model to pin và fly globe↔model. Kiểm tra orbit/pan/zoom/fit trong viewer; pan/zoom/bearing/pitch/compass trên Mapbox. Three.js custom layer cập nhật theo camera Mapbox, mô hình giữ tọa độ ghim. Chấp nhận: icon mở Mapbox cả khi chưa có IFC, có tooltip/active state và lối về IFC viewer; không còn phải mở GIS từ Project Browser; người dùng xoay IFC và Mapbox độc lập; mở IFC mới chỉ thay một overlay cũ, không rò WebGL.

**D6. Chỉnh hướng và vị trí mô hình trên bản đồ (vừa).** Giữ Mapbox custom Three.js layer, Mercator placement, nhà 3D/fog và glTF xuất từ IFC.js. Cho kéo/chọn ghim, chỉnh yaw/scale/cao độ của IFC đang chọn bằng preview và Save/Cancel; lưu transform riêng với key Mapbox. Kiểm tra thứ tự layer, style reload và giải phóng GPU. Chấp nhận: xoay camera bản đồ không thay transform; chỉnh yaw không xoay bản đồ; cùng một glTF giữ đúng kích thước/hướng ở nhiều tọa độ, qua reload/fly/style change.

**D7. Kiểm chứng TestIFC tích hợp Mapbox (vừa).** Kiểm tra IFC mẫu và IFC thực, viewer, Pset/Qto/quan hệ hiện có, màn hình GIS, thay key, lỗi token/mạng, IndexedDB và nhiều lần mở/đóng/đổi tài liệu. Chạy `pnpm check`, `pnpm test`, `pnpm build`, Playwright với fixture, `BuildExe.cmd` và smoke WebView2 đóng gói. Đo riêng chuyển IFC lạnh, hình học đầu tiên trong viewer, hiện glTF trên Mapbox, semantic readiness và mở lại từ cache. Chấp nhận: bốn ảnh mục tiêu tái tạo được trong EXE, cả viewer lẫn map thao tác độc lập, dữ liệu BIM hiện có không hồi quy.

### Phụ thuộc và điểm dừng kiểm chứng

`D1 → D2 → D3 → D4 → D5 → D6 → D7`. Sau D2, upstream phải chạy được và có chứng cứ ảnh/console. Sau D3, hợp đồng port vào shell TestIFC phải rõ. Sau D4, mỗi profile tự đổi được Mapbox key. Sau D6, kiểm tra vị trí/kích thước/transform trên fixture trước khi thử IFC lớn. D7 là cổng hoàn thành bản desktop có Mapbox; browser build/test không thay thế smoke WebView2.

### Rủi ro cần xử lý trong từng lát

- Mapbox style/tile/geocoder cần Internet và token; đo lỗi tải thật, giữ token ngoài source và duy trì attribution. Apache-2.0 của repo không cấp quyền dùng dịch vụ Mapbox.
- Mapbox GL JS upstream 2.10.0, web-ifc 0.0.35 và IFC.js cũ được giữ để phục hồi đúng baseline. Sau khi parity đạt, nâng dependency theo từng bước và kiểm lại phép đặt/glTF; không đổi stack trong cùng bước phục hồi.
- JSON thuộc tính và glTF là hai đầu ra riêng; bản đồ upstream chủ yếu hiển thị hình học. Muốn chọn cấu kiện và xem Pset/Qto trên bản đồ phải bổ sung ánh xạ ID có kiểm chứng ở mốc 3.
- Trong giai đoạn chuyển đổi, viewer hiện tại và pipeline IFC.js→glTF cho Mapbox có thể cùng xử lý một IFC. Đo riêng thời gian và bộ nhớ của hai đường; chỉ thay viewer cũ khi đã chứng minh không mất thao tác và dữ liệu BIM.
- IFC CRS có thể thiếu/sai; cách đặt bằng ghim của upstream không đọc georeference IFC. Chỉ gắn nhãn `manual` cho mốc đầu; tính năng vị trí IFC chính xác cần đặc tả và kiểm chứng riêng ở mốc 3.
- `tasks/todo.md` hiện có việc chưa hoàn tất cho 1.0.4; giữ nguyên, theo dõi D1–D7 riêng để không đánh dấu nhầm các cổng cũ là đã xong.

### Kết quả triển khai bản đầu — 2026-09-30

- Checkout chính: `F:\Steel\VBA\IFC`, `codex/testifc-1.0.3a`, baseline `ec32967`; remote `Tannniee/TestIFC`. Không đổi engine viewer hiện tại. Phiên bản nguồn hiện có là 1.0.4.
- Upstream riêng: `F:\Steel\VBA\bim-gis-reference`, commit đã khóa ở D1. Script `benchmarks/restore-bim-gis-reference.ps1` tái lập ba sửa đổi: token từ localStorage, khai báo `coordinatesData`, fog chuyển từ `load` sang `style.load`. Sửa cuối có bằng chứng lỗi Mapbox 2.10 marker opacity khi geocoder/ghim chạy; sau sửa luồng mẫu không còn page errors.
- Pipeline được giữ: Mapbox GL JS 2.10.0 + Light v10/globe/fog/buildings, Geocoder 5.0.0, Three 0.135.0, IFC.js/WebIFC 0.0.35, glTF/JSON và Dexie 3.2.2. Không giới hạn category/triangle như demo; fixture beam vẫn giữ đủ 12 tam giác. Runtime cũ ở iframe cùng origin để tách khỏi Three/WebIFC hiện tại. License/attribution được đóng gói.
- Chỉ IFC đang hoạt động được vẽ. Đổi file hủy iframe và worker; đổi key giữ scene CPU, camera, ghim và dựng lại Mapbox. Bản đồ chuyển sang Mercator khi xem IFC; custom layer gắn sau khi style/projection sẵn sàng. Viewer và bộ lọc Project Browser được giữ khi chuyển màn hình.
- Cài đặt đã thử key thật, lưu/xóa/khôi phục qua API desktop trên profile tạm; key của người dùng được cấu hình vào profile máy hiện tại, `.env.local` chỉ phục vụ test cục bộ. Quét production assets không chứa token của người dùng.

| Kiểm tra | Kết quả và phạm vi chứng minh |
| --- | --- |
| `BuildExe.cmd` | 199 Python tests, 55 frontend tests đạt; Svelte 0 lỗi/0 cảnh báo; Vite + PyInstaller thành công. |
| `node e2e/bim-gis-reference-smoke.mjs` | Repo gốc chuyển IFC mẫu, tìm HCMC, lưu tọa độ geocoder qua Move model to pin/reload, Fly/Back, marker, random và xoay camera; bốn ảnh đối chiếu. |
| `node e2e/mapbox-smoke.mjs` | Mapbox thật; GLB + JSON trong IndexedDB; layer thực sự vẽ tam giác; preview/cancel/save; key xóa/khôi phục giữ camera; cache; đổi file đúng hash, một marker, đóng hết về empty. Với `01.ifc`, viewer + GIS readiness lạnh 2670 ms, mở cache 1764 ms ở lần đo này. Đây không phải thời gian first visible pixels hoặc benchmark IFC lớn. |
| `node e2e/run-bim-gis-checks.mjs` | 6 tests đạt: Settings/public-only, lỗi WASM có hồi phục, Pset/Qto/material/relations, Project Browser/filter, đọc anchor, đổi tài liệu và chống response cũ. |
| `node e2e/webview2-smoke.mjs` | EXE mới + `01.ifc`: nền Mapbox thật, IFC.js/glTF vẽ được, yaw/save/marker/city/orbit, desktop key persistence, quay về viewer và đóng app exit 0. Profile/cache được cô lập, không mock Settings. |

EXE kiểm chứng: `F:\Steel\VBA\IFC\dist-mapbox-20260930\IFC Viewer 1.0.4.exe`.
Ảnh EXE: `reports/mapbox/04-packaged-webview2.png` và các ảnh `-globe`, `-city`, `-orbit`.
Ảnh upstream: `reports/mapbox-reference/01-globe.png` đến `04-city-orbit.png`.
Hướng dẫn build/hợp đồng/sửa dependency: `frontend/gis-runtime/README.md`.

Giới hạn còn lại của D7: đối chiếu ảnh mẫu là kiểm tra trực quan, chưa phải parity transformed vertices trên tập IFC bất kỳ. Chưa benchmark bộ nhớ/thời gian của hai pipeline trên IFC lớn; IFC.js cũ có thể không đọc được một số file, khi đó báo lỗi và viewer hiện tại vẫn dùng được. Pin là manual; chưa nâng thành georeference khảo sát hoặc chọn/đọc thuộc tính cấu kiện trực tiếp trên map. Các cổng A2/C3/C4/T5 cũ vẫn còn mở.
