# Tích hợp Colorizer vào IFC Lite: phủ xám, tô nhóm đỏ, xuất IFC mới

Ngày nghiên cứu: 15/10/2026. Checkout: `F:\Steel\VBA\IFC-Lite`, nhánh `codex/desktop-v10.3.0`, HEAD `471284f476d64a659ae607eeec2115ca3afcb9fe`, remote `https://github.com/LTplus-AG/ifc-lite.git`.

Đây là nghiên cứu và thử nghiệm riêng. Chưa sửa mã sản phẩm, chưa build EXE và chưa tích hợp bảng Colorizer. Checkout vốn có 93 file tracked thay đổi; danh sách trạng thái và thống kê diff tracked không đổi sau nghiên cứu. Các bằng chứng mới nằm trong thư mục này. Đánh giá áp dụng cho mã đang có trong working tree, bao gồm các thay đổi native chưa commit, không suy ra tình trạng của EXE đã phát hành.

## Kết luận

Luồng người dùng yêu cầu khả thi và nên là một khả năng chính của Colorizer:

1. Mở IFC có sẵn nhiều màu.
2. Phủ màu xám lên toàn bộ cấu kiện thuộc phạm vi đã chọn.
3. Chọn một nhóm thanh, hoặc tập thanh chọn trực tiếp, và tô đỏ.
4. Xuất một IFC mới đầy đủ mô hình, trong đó màu đã được ghi vào dữ liệu IFC.

Đã thực hiện thành công hai lần ghi/đọc lại trên IFC4 thực bằng lõi Python Colorizer hiện có. Tuy nhiên, việc ghép UI vào IFC Lite hiện tại chưa đủ để bảo đảm xuất đúng. Phải giải quyết nguồn STEP của model native, cô lập geometry/style chia sẻ, và sự khác nhau giữa style trực tiếp với màu theo mặt/texture.

## Bằng chứng trên IFC thực

Nguồn: `F:\Steel\VBA\IFC COLO\hangarvd_f10_ tan base_f01_colored.ifc`, SHA-256 `df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2`. File đã có 75 màu, 75 nhóm, 14.509 cấu kiện. Dùng IfcOpenShell 0.8.5 và đúng mã Colorizer 1.2 đang có trên máy.

| Bước | Kết quả đọc lại file trên đĩa |
| --- | --- |
| Phủ `#808080`, đục hoàn toàn | 14.509 cấu kiện, 29.018 item đều xám |
| Mở file xám, chỉ tô `PIPE-267.4X8` bằng `#FF0000` | 1.968 cấu kiện đỏ, 12.541 cấu kiện xám |
| Kiểm tra các bản ghi ngoài nhóm presentation được phép thay | 184.677 bản ghi giữ nguyên nội dung và tập ID |
| Kiểm tra độc lập geometry/material | 12 cấu kiện mẫu, gồm 6 đỏ và 6 xám; tọa độ world bằng nhau trong sai số tuyệt đối 1e-10, index tam giác giống nhau, màu vật liệu đọc qua geometry engine đúng |
| File nguồn | SHA-256 giữ nguyên |

File thử:

- `01-all-gray.ifc`: 12.087.859 byte, SHA-256 `88b7e9525aef97aa294aa55cfc14acbe6f942a01ec2238a00e795f14c733e8ae`.
- `02-gray-red.ifc`: 12.088.062 byte, SHA-256 `113f5024ce88b76489213f61903133531196b79b3ada3ed6a794c8c563572502`.
- Chi tiết: `probe-report.json`; chương trình tái hiện: `probe.py`.

Giới hạn: đây là kiểm tra lõi Colorizer và đọc lại bằng engine độc lập. Chưa mở các file này trong IFC Lite EXE/browser; chưa có screenshot, GPU/instancing parity, full-model geometry comparison hay xác nhận toàn bộ schema hợp lệ. Các số thời gian trong JSON chỉ là thời gian thử nghiệm, không phải benchmark.

File thực có 14.509 `IfcProduct` có Representation, không có `IfcMappedItem`, `IfcIndexedColourMap` hoặc `IfcSurfaceStyleWithTextures`. Vì vậy phải bổ sung fixture đối kháng để xem các trường hợp mà file này không thể chứng minh.

## Những điểm quan trọng trong mã hiện tại

### 1. Màu xem trước và màu lưu trong IFC là hai cơ chế

`apps/viewer/src/sdk/adapters/viewer-adapter.ts` đưa màu vào `pendingColorUpdates`; thay đổi này phục vụ renderer. `apps/viewer/src/sdk/adapters/export-adapter.ts:377` xuất từ model store và mutation view, không tự thu màu overlay để viết style.

`packages/create/src/in-store/apply-style.ts:210` đã có cơ chế ghi style qua StoreEditor. `packages/sdk/src/namespaces/style.ts` có `bim.style`. Nhưng `apps/viewer/src/sdk/local-backend.ts` chưa cung cấp adapter `style`, nên không thể coi API đó là chức năng đã hoạt động trong viewer. Comment của StyleNamespace cũng nêu giới hạn backend này.

Thiết kế cần một trạng thái màu cuối cùng cho mỗi cấu kiện; preview và bộ ghi IFC cùng nhận trạng thái đó. Thao tác phủ xám hay tô nhóm phải vào history, không chỉ sửa map màu một lần trong renderer.

### 2. Native load chưa cung cấp nguồn đủ cho bộ ghi style/export hiện tại

Chuỗi đã kiểm tra:

- `apps/viewer/src/hooks/ingest/nativeIfcStore.ts` gọi `convertServerDataModelAsync`.
- `apps/viewer/src/utils/serverDataModel.ts:342` trả `source: EMPTY_SOURCE_BYTES`; các getter entity thô không khả dụng.
- `desktop/native-semantics.ts:14` yêu cầu semantic stream với `rootedOnly: true`, không phải một bản sao đầy đủ graph STEP.
- `apps/viewer/src/services/desktop-export.ts` chỉ trả store đang có; chưa bổ sung source/index đầy đủ.
- `packages/create/src/in-store/style-entity-reader.ts` cần source hoặc overlay-created entities để đọc Representation và item.
- `packages/export/src/step-source-iteration.ts:149` bỏ qua các source ref không đọc được, nên semantic store này không đủ chứng minh xuất nguyên model.
- Native job giữ nguồn tạm trong `desktop/src-tauri/src/native.rs`, nhưng `desktop/native-client.ts:125` đóng job trong `finally` sau load. Không thể giả định job còn tồn tại để xuất sau đó.

Đây là trở ngại kiến trúc lớn nhất cho tích hợp trên bản native của chúng ta. Model vẫn có thể có `sourceFile` snapshot (`apps/viewer/src/store/types.ts:527`), là điểm có thể dùng để bổ sung khả năng chỉnh/xuất theo yêu cầu. Cache-restored hoặc model không còn source phải báo rõ chưa đủ dữ liệu, không tạo file IFC thiếu nội dung.

Hướng đề xuất: bổ sung source/index phục vụ chỉnh sửa và xuất khi cần, gắn với đúng snapshot model và mutation revision. Không tạo một đường load geometry/federation thứ hai, không nạp lại model âm thầm, và không bỏ mất các sửa đổi đang có. Native và web dùng chung thuật toán lập kế hoạch thay đổi.

### 3. Geometry dùng chung làm cho việc tô riêng một nhóm trở nên khó

`applyStylesInStore` mặc định `followMappedItems: true` (`apply-style.ts:217`): style đặt vào leaf của representation map. Nếu chỉ đổi một phần các occurrence, những occurrence khác dùng chung leaf sẽ cùng chịu ảnh hưởng.

`followMappedItems: false` gán lên `IfcMappedItem`. Đây không phải lời giải tổng quát cho file đã có style bên trong. Fixture trong `edge-probe.py` tạo leaf xám dùng chung, sau đó đặt style đỏ lên mapped item của beam. Kết quả IfcOpenShell 0.8.5 sau ghi/đọc lại: cả beam và column vẫn xám. Chỉ thêm style ở wrapper không chứng minh ghi đè thành công.

Lõi Colorizer hiện có xử lý bằng `isolate_shared_representation`: tách representation trước khi sửa leaf. Thử hai lượt trên fixture map dùng chung đã cho beam đỏ và column xám đúng. Kết quả nằm trong `edge-report.json`, file `mapped-gray-red.ifc`.

Đề xuất cho tích hợp: phân tích các chủ sở hữu trước khi ghi; tách phần graph cần thay đổi nếu màu cuối của các chủ khác nhau. Giữ hình học tham số và placement, tái sử dụng geometry/point/profile không cần sửa. Tránh deep-copy toàn model hoặc tessellate toàn bộ chỉ để đổi màu. Cùng hình học và cùng màu cuối vẫn nên chia sẻ tài nguyên.

Lưu ý kích thước: fixture rất nhỏ tăng từ 1.194 lên 3.268 byte qua hai lượt Colorizer. Đây là minh họa cho chi phí style/copy, không phải ước lượng mức tăng của file thực. Cần đo trên một model có nhiều mapped occurrence trước khi chốt chiến lược.

### 4. Màu theo mặt và texture phải nằm trong hợp đồng ghi đè

Màu IFC có thể nằm ở style của item, style ở hình học lồng trong map, màu material/layer, palette theo mặt, và texture. Thay một `IfcColourRgb` không bao phủ tất cả các trường hợp đó.

`rust/processing/src/element.rs:644` tách mesh theo `IfcIndexedColourMap` và dùng màu palette thay màu style đã resolve. `packages/renderer/src/shaders/textured.wgsl.ts:96` lấy màu texture nhân tint trước các bước shading/overlay tiếp theo. Việc renderer hiện màu overlay đúng không bảo đảm file xuất mở lại cũng giống vậy.

Thử fixture tessellation: Colorizer thay style thành xám nhưng `IfcIndexedColourMap` vẫn còn gắn vào face set. IfcOpenShell 0.8.5 không trả palette cũ thành geometry materials ngay cả ở input, nên không dùng nó làm oracle màu theo mặt trong thử nghiệm này. Chỉ kết luận map còn tồn tại; nguy cơ IFC Lite dùng lại palette được xác định từ mã Rust, chưa chạy xác nhận trên renderer IFC Lite.

Đề xuất chế độ mặc định cho yêu cầu này: **Ghi đè thành màu đồng nhất**. Với item thuộc phạm vi tô, style màu mới phải có hiệu lực và nguồn texture/palette đang tác động cần được gỡ khỏi nhánh đã tách hoặc thay bằng dữ liệu màu đồng nhất. Không xóa texture/palette dùng bởi cấu kiện ngoài phạm vi. Giữ các định nghĩa vật liệu vật lý, tiết diện, Pset, quantity và quan hệ.

Nếu bổ sung chế độ nhuộm màu có giữ texture, phải đặt tên khác; không dùng nó để thực hiện yêu cầu phủ xám đồng nhất. Khi thay surface style cũng phải giữ các thành phần presentation khác như curve style nếu chúng cùng tồn tại hợp lệ trên styled item.

### 5. IFC2X3 cần sửa cơ chế phát style trước khi công bố hỗ trợ

`packages/create/src/in-store/_emit-helpers.ts:287` luôn tạo `IfcSurfaceStyleShading` với hai thuộc tính SurfaceColour và Transparency. Với IFC2X3, Shading chỉ có SurfaceColour; Transparency thuộc subtype `IfcSurfaceStyleRendering`.

Đã xác nhận bằng schema thật của IfcOpenShell: tạo Shading hai đối số bị từ chối ở IFC2X3, chấp nhận ở IFC4. Test hiện tại ở `apply-style.test.ts:309` xác nhận wrapper `IfcPresentationStyleAssignment`, chưa chứng minh đầy đủ schema của chain này. Đây là điểm không khớp xác nhận từ source/schema, chưa phải một lần xuất IFC2X3 thực qua viewer.

Colorizer Python đã dùng Rendering nên tránh được lỗi này. Phần planner appearance đang có trong Rust (`rust/processing/src/appearance/mod.rs:123`) cũng chỉ nhận IFC4/IFC4X3; không được suy ra nó hỗ trợ IFC2X3 chỉ vì tái sử dụng history/UI của appearance.

### 6. Lens hỗ trợ được một phần, nhưng quy tắc ưu tiên khác

`packages/lens/src/engine.ts:63`: rule khớp đầu tiên thắng; phần không khớp bị ghost. `packages/lens/src/colors.ts:9`: ghost là xám alpha 0.15. Đây không tương đương phủ xám đục toàn model rồi cho nhóm đỏ đè lên.

Đề xuất dùng lại thao tác lựa chọn, phát hiện thuộc tính và thành phần UI hữu ích của Lens. Colorizer có kết quả tô cuối riêng: thao tác sau ghi đè thao tác trước trong đúng phạm vi. Không sửa semantics công khai của Lens để phục vụ một tính năng mới.

### 7. “Toàn bộ” phải rộng hơn danh sách thanh của Colorizer hiện tại

`colorizer_core.py:17` và `target_elements` chỉ chọn Beam, Column, Member, Plate, BuildingElementProxy. Với file hangar này chúng bao phủ mọi product có Representation, nhưng file có tường, sàn hoặc thiết bị thì không.

Phạm vi đề xuất trong UI:

- **Toàn bộ cấu kiện có bề mặt 3D trong model đang chọn**, gồm cả cấu kiện đang ẩn nếu người dùng chọn toàn model.
- **Nhóm theo tiết diện/loại/vật liệu/tầng/thuộc tính**.
- **Các cấu kiện đang chọn**.

Model khác trong federation chỉ thay đổi khi được chọn rõ. Lọc bảng chỉ ẩn các dòng, không làm đổi phạm vi xuất. Chế độ solo/isolate giúp quan sát nhóm đỏ không được làm mất các cấu kiện xám trong IFC xuất.

### 8. Nhận diện tiết diện cần giữ được nguồn và độ chắc chắn

Colorizer hiện xét thuộc tính ưu tiên, material profile, geometry profile, thuộc tính section/profile, type rồi các attribute dự phòng (`colorizer_core.py:149`). Native semantic store chưa có graph geometry/profile đầy đủ nên không thể hứa gom tiết diện tương đương nếu chỉ dùng Name.

Giữ cột nguồn nhận diện và nhóm “Chưa xác định”; cho chọn thuộc tính tiết diện ưu tiên. Không diễn giải tên cấu kiện bất kỳ là tiết diện đã được xác nhận. Palette lưu theo model scope/tiêu chí/tên nhóm ổn định, không theo thứ tự dòng hay offset ID.

## Hành vi giao diện đề xuất

Luồng ngắn: **Phạm vi: model A → Phủ toàn bộ → Xám → Chọn nhóm thanh → Đỏ → Xuất IFC mới**.

- Một lần phủ toàn bộ là một thao tác Undo. Tô một nhóm là một thao tác Undo khác.
- Thao tác tô sau thắng trên các cấu kiện được tác động. Nếu sau cùng phủ toàn model xám lần nữa, cả nhóm đỏ cũng thành xám.
- “Khôi phục màu gốc” khác với “Phủ xám”; khôi phục trả appearance gốc trước các thao tác Colorizer.
- Màu và độ trong suốt đặt rõ. Với ví dụ nghiên cứu: xám và đỏ đều đục 100%; nếu hỗ trợ giữ transparency gốc thì là lựa chọn riêng.
- Bảng nhóm hiển thị tên, nguồn tiết diện, số cấu kiện, màu, độ trong suốt và trạng thái bật/tắt. Bấm nhóm để chọn/cô lập 3D; thao tác xuất toàn model vẫn giữ tất cả cấu kiện.
- Nêu số cấu kiện áp dụng/không áp dụng và lý do. Lỗi một phần không được báo hoàn tất toàn bộ.
- File gốc giữ nguyên. Tạo file output mới; hoàn tất kiểm tra mới công bố output. Hủy/lỗi giữ output cũ nếu có.

## Trình tự triển khai đề xuất

1. Chốt hợp đồng ghi đè đồng nhất và phạm vi; dùng các IFC/fixture trong thư mục này làm acceptance cases.
2. Bảo đảm model web/native có nguồn và index đủ cho sửa style và xuất đầy đủ, giữ đúng snapshot và các mutation hiện có.
3. Dùng lõi Rust chung lập kế hoạch style theo trạng thái màu cuối; xử lý ownership, schema IFC2X3/IFC4, palette và texture. Tận dụng StoreEditor, giao dịch, history và bộ xuất hiện có thay vì viết một đường xuất IFC riêng. Chốt lại vai trò helper TypeScript hiện có để tránh hai lõi cùng làm một việc rồi lệch nhau.
4. Xem trước từ cùng kế hoạch; hỗ trợ geometry đến muộn/instancing và phối hợp với selection, Lens, clash/IDS overlay. Bỏ Colorizer/Undo phải phục hồi đúng trạng thái mà nó sở hữu.
5. Thêm bảng Colorizer và giữ bộ nhận diện tiết diện có thể truy nguồn.
6. Chứng minh bằng file thật và runtime IFC Lite trước khi đóng gói bản mới.

Không ước lượng số giờ/ngày hay hứa không tăng RAM: phần nguồn native và ownership cần spike đo trước. Đổi màu không cần chạy lại tessellation toàn model; CPU/GPU/memory khi commit và export vẫn cần đo trên case mapped/large thực.

## Điều kiện nghiệm thu

| Trường hợp | Bằng chứng bắt buộc |
| --- | --- |
| File có màu → toàn xám → nhóm đỏ | Đếm đủ tập đỏ và xám sau xuất/đọc lại, ngoài nhóm không đổi |
| Chọn một phần của shared map/shared representation | Geometry và màu đúng cho cả thanh chọn và thanh không chọn |
| Có leaf style, nhiều nested map | Màu mới thực sự thắng sau mở lại; không chỉ có entity style đỏ tồn tại |
| IFC2X3/IFC4 | Đúng schema chain, transparency và Side; validate file ghi thực |
| Indexed colours/texture | Chế độ đồng nhất cho ra đồng nhất ở IFC Lite; đối chiếu engine độc lập có hỗ trợ tính năng đó |
| Toàn model, model bị ẩn, isolate nhóm | IFC xuất đầy đủ model khi chọn chế độ toàn bộ |
| Federation 1 và N model, IDs trùng giữa file | Chỉ đúng model/phần tử bị sửa, dùng resolver chuẩn |
| Undo/Redo/khôi phục gốc | Màu xem và dữ liệu xuất cùng lùi/tiến, không xóa màu của công cụ khác |
| Hủy/lỗi/model đổi trong khi lập kế hoạch | Không công bố kết quả dở dang, không ghi nhầm model/snapshot |
| Bảo toàn dữ liệu | GlobalId, geometry world, placement, profile, vật liệu, Pset/Qto, quan hệ và CRS không bị mất |

## Kiểm tra trong phiên nghiên cứu

- `probe.py`: hoàn tất với kết quả ở trên.
- `edge-probe.py`: hoàn tất; hai lượt tô shared map đúng, parent style riêng không ghi đè leaf style trong oracle này, indexed map vẫn tồn tại.
- Root `pnpm test --filter=@ifc-lite/create -- src/in-store/apply-style.test.ts`: chưa chạy được test vì prerequisite `@ifc-lite/wasm#build` thất bại; Turbo báo 0 task thành công. Không có kết luận suite IFC Lite xanh. Không chạy vòng package-local để lách dependency graph.
- Công cụ pnpm trên PATH là fallback runtime khác cấu hình pnpm 10.8.1 của repo. Lần thử đầu kiểm tra dependencies tự yêu cầu install rồi dừng vì không có TTY; đã dùng thiết lập cho riêng tiến trình để ngừng tự install trong lần chạy tiếp theo. Không cài lại dependencies hoặc sửa cấu hình dự án.
- Chưa typecheck toàn repo, chạy Rust test/clippy, benchmark, build ứng dụng, hoặc xác nhận EXE hiện có.

## Tài liệu chính thức đã đối chiếu

- [IFC2X3 IfcSurfaceStyleShading](https://standards.buildingsmart.org/IFC/RELEASE/IFC2x3/TC1/HTML/ifcpresentationappearanceresource/lexical/ifcsurfacestyleshading.htm): Shading chỉ có SurfaceColour.
- [IfcRepresentationItem](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcRepresentationItem.htm): StyledByItem có tối đa một phần tử; item style ưu tiên hơn layer style cùng loại.
- [IfcMappedItem](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcMappedItem.html): geometry nguồn có thể được dùng nhiều lần và lồng map. Link hiện chuyển đến working draft; dùng cho mô tả, đối chiếu hành vi bằng các fixture đã chạy.
- [IfcIndexedColourMap](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcIndexedColourMap.html): palette gắn theo từng mặt; Opacity ngược nghĩa với Transparency. Link working draft.
- [IfcSurfaceStyleRendering](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcSurfaceStyleRendering.html): SurfaceColour, Transparency và tương tác texture. Link working draft.
- [IfcOpenShell assign_item_style](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/style/assign_item_style/index.html): cơ chế assign style. Docs hiện hiển thị 0.9.1, còn thử nghiệm đã chạy với bản cài 0.8.5; kết luận phiên bản lấy từ chạy thực và schema cài trên máy.
