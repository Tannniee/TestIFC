from pathlib import Path
p=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024')
text='''# Nhip chinh.ifc — nghiên cứu hình học và treo tải

Ngày kiểm tra: 24/10/2026. Phạm vi: nghiên cứu, tái hiện, thu nhỏ mẫu và đối chiếu độc lập. Chưa sửa mã sản phẩm hoặc đóng gói EXE mới.

## Kết luận

Đã xác định ba lỗi có bằng chứng riêng:

1. **Đọc sai `Reference` trên `IfcVoidingFeature`:** IFC-Lite đưa hình học tham chiếu vào cả luồng hiển thị và phép cắt CSG. Các khối này mô tả những phần khoét đã hiện diện trong Body của cấu kiện. Phép cắt lại làm tốn thời gian và có thể thay đổi bề mặt.
2. **Hiển thị feature trừ khối như vật thể đặc:** `IfcVoidingFeature` không đi qua đầy đủ chính sách dành cho openings. Các khối cắt có màu tác giả, alpha = 1 và có thể vào GPU instancing, dù `openings = false`. Đây là nguồn của các mảng xanh/tím lớn trong ảnh.
3. **CSG cho Body thật còn có kết quả hở topology:** cấu kiện `#2444` với chín feature Body cho bốn thông báo `KernelError` ở native, WASM cục bộ và web công khai. Việc sửa Reference và ẩn khối cắt chưa giải quyết lớp lỗi này.

Luồng native còn dùng lô 65.536 phần tử sau lô đầu 16 phần tử. Điều này làm bộ đếm đứng lâu khi một lô chứa nhiều phép CSG nặng. Chưa đo hiệu quả của việc giảm lô như một bản sửa độc lập.

## Dữ liệu và phiên bản đã kiểm tra

- File gốc: `F:/Working/IFC Temp/Nhip chinh.ifc`, 129.987.273 byte, IFC4, Tekla Structures 2025 SP5; header ghi `ReferenceView_V1.2`.
- SHA-256 file gốc: `110b48aeb00b183667fe5f973685100f6dbbc9375b34c10f899ca5a75b8e3085`.
- EXE: `F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-packages-audit-20261020-r3/IFC-Lite.exe`, engine Rust 20.4.0.
- SHA-256 EXE: `ede20104a6152a308bdb50fed44f870d1ac5d0539e623e150abb311325b89545`.
- Nguồn của EXE: `F:/Steel/VBA/IFC-Lite-Core104`, nhánh `codex/packages-audit-10.4.0`, HEAD `13e402c4`. Nguồn sản phẩm ở đó vẫn sạch; thư mục `research/` đã có từ trước.
- Checkout của chat: `F:/Steel/VBA/IFC-Lite`, nhánh `codex/desktop-v10.3.0`, HEAD `471284f4`, có nhiều thay đổi sẵn. Không dùng nó thay cho nguồn 20.4.0 khi suy luận về bản EXE r3.
- Web thực tế: `https://www.ifclite.com/`, UI **v5.2.0**, phiên Edge headless mới; đã kiểm tra sau trạng thái **Ready**.
- `main` và `production` upstream tại lần đọc cùng ở `b0412a0fbd5d9722c8024416545e55272d5a050d`. Đây là mốc đọc mã; chưa khẳng định asset đang triển khai được build từ chính SHA này vì site không công bố ánh xạ đó trong phép thử.
- Oracle: IfcOpenShell **0.8.5**, kernel **OpenCASCADE**. Harness native dùng nguồn 20.4.0, Rust stable **1.99.0**, và lockfile sao từ desktop; không phải một EXE sản phẩm mới.

Ảnh Trimble do người dùng cung cấp là bằng chứng đối chiếu trực quan. Chưa có dữ liệu mesh xuất từ Trimble để làm phép so sánh số toàn mô hình.

## Kiểm kê toàn file

File có 1.239.127 STEP entity. Toàn bộ 38.432 đầu mút `RelatedOpeningElement` của `IfcRelVoidsElement` là `IfcVoidingFeature`; chúng thuộc 7.679 host.

| Feature | Số quan hệ | Body của host |
| --- | ---: | --- |
| Reference / SolidModel | 12.598 | Tessellation |
| Reference / Tessellation | 1.042 | Tessellation |
| Body / SolidModel | 24.245 | SolidModel |
| Body / Tessellation | 547 | SolidModel |

Tổng **13.640 feature Reference** nằm trên **2.604 host tessellation**. Tổng **24.792 feature Body** nằm trên **5.075 host SolidModel**. Các số host trong từng hàng con có thể trùng nhau; số tổng host được tính theo ID duy nhất.

**Không được bỏ mọi quan hệ void theo header Reference View.** File này chứa cả hai cách biểu diễn. Cần xét representation của từng feature; Body thật vẫn phải được trừ khỏi host.

Bằng chứng máy đọc: `representation-census.json`, `host-reference-cross-census.json`, `void-hosts.json` của đợt chẩn đoán trước.

## Vì sao Reference không được dùng để cắt lại

[buildingSMART — IFC4 Reference Geometry](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/templates/reference-geometry.htm) quy định geometry có identifier `Reference` phục vụ tham chiếu/đánh giá, không dùng để hiển thị hay thực hiện phép Boolean ngầm qua quan hệ void. Ví dụ trong chuẩn nêu trường hợp lỗ đã có trong Body của host. [Khái niệm Reference View](https://standards.buildingsmart.org/MVD/RELEASE/IFC4/ADD2_TC1/RV1_2/HTML/schema/views/reference-view/index.htm) cũng mô tả quan hệ void mang ý nghĩa logic trong trường hợp này.

[Tài liệu Tekla](https://support.tekla.com/de/node/136758) xác nhận xuất IFC4 Reference View dùng `IfcVoidingFeature` cho part/polygon cuts. Tài liệu này giải thích tên lớp; việc quyết định cắt hay không vẫn phải dựa trên representation thực tế của từng feature.

## Bằng chứng lỗi các mảng lớn

Trong cùng phiên đóng gói r3, bản sao chẩn đoán của lần trước vẫn hiện các mảng xanh lớn. Sau khi gọi thao tác ẩn đúng 38.432 ID feature, các mảng đó biến mất. Phép thử này thay đổi visibility trong phiên, không sửa mesh và không chứng minh các lỗ Body đã đúng: bản sao đó đã bỏ quan hệ void để cô lập hiệu năng.

Một mảng cụ thể:

- `#322462`: `IfcVoidingFeature`, GlobalId `2bBKkgEY59nfNjfqqIxZa9`, Name `PLATE`, ObjectType `PL60000`.
- Representation `Reference / SolidModel`, dùng `IfcExtrudedAreaSolid #260679`.
- Host: `IfcBeam #322443`, GlobalId `2EM80o2k12nQ3EjZZBFP7f`.
- Kích thước AABB trong trục viewer: khoảng **27,261 × 2,572 × 55,670 m**.
- Native và web phát mesh màu `[0.117647, 0.262745, 0.513726, 1]` cho chính feature này.

Trong web công khai v5.2.0, mẫu nguyên trạng **10.850 byte**, 132 record, một host và ba feature đã tải đến Ready nhưng vẫn có bốn mesh: host và ba khối Reference. Bật/tắt openings đang ở false. Đây là tái hiện độc lập với việc ảnh người dùng được chụp lúc 95%.

Ảnh:

- `visible-feature-test/after-load.png`: toàn cầu trong bản sao chẩn đoán, còn các mảng lớn.
- `visible-feature-test/negative-features-hidden.png`: ẩn nhóm feature trong cùng phiên.
- `web-repro/reference-original.png`: mẫu nhỏ trên web công khai, còn khối Reference.
- `web-repro/reference-original-hidden.png`: cùng mẫu, ẩn các feature.
- `user-reference/`: hai ảnh người dùng cung cấp, sao nguyên trạng.

## Nguyên nhân trong mã

Trong nguồn 20.4.0:

| Vị trí | Hành vi hiện tại |
| --- | --- |
| `rust/geometry/src/router/rep_filter.rs::effective_element_rep_type` | Identifier Reference chỉ có quyền ưu tiên khi entity thuộc nhánh IfcOpeningElement. VoidingFeature là nhánh khác, nên type SolidModel/Tessellation thắng và bị mesh. |
| `rust/geometry/src/router/voids/representation.rs::opening_requires_subtraction` | Chỉ nhận nhánh IfcOpeningElement khi chứng minh Reference-only; VoidingFeature quay về luồng cắt. |
| `rust/processing/src/element.rs` | Lựa chọn luồng void dựa vào predicate trên; Reference VoidingFeature làm host vào CSG. |
| `rust/processing/src/style/mod.rs::fixed_display_color_for_type` | Chỉ cố định màu overlay cho IfcOpeningElement và subtype. VoidingFeature giữ màu đặc của tác giả. |
| `apps/viewer/src/store/typeVisibilityFilter.ts` | Có OpeningElement/OpeningStandardCase nhưng không có VoidingFeature; lớp không có trong map luôn được coi là visible. |
| Native `partition.rs` và WASM batch partition | Chính sách loại khỏi instancing cần theo cùng phân loại với overlay/visibility. Chỉ thêm một hàng ẩn ở UI không đủ. |

Mã upstream hiện tại đã chuyển bộ chọn representation sang [representation/select.rs](https://github.com/LTplus-AG/ifc-lite/blob/b0412a0fbd5d9722c8024416545e55272d5a050d/rust/geometry/src/representation/select.rs), vẫn có điều kiện IfcOpeningElement. [Bảng visibility upstream](https://github.com/LTplus-AG/ifc-lite/blob/b0412a0fbd5d9722c8024416545e55272d5a050d/apps/viewer/src/store/typeVisibilityFilter.ts) cũng chưa có VoidingFeature. Bản sao hai file đọc từ SHA này được lưu trong thư mục nghiên cứu.

## Phép đối chứng ngữ nghĩa và oracle

Mẫu 126.734 byte giữ nguyên ID, GlobalId, hình học, placement và styling của sáu host thật cùng 34 feature. Bản đối chứng riêng chỉ đổi lớp feature thành IfcOpeningElement và sửa enum cho phù hợp. Việc này kích hoạt đúng nhánh Reference đã tồn tại trong engine.

**Đây là đối chứng để tìm nguyên nhân, không phải cách sửa file người dùng hoặc sản phẩm.**

| Kết quả native ở mẫu nhỏ | Giữ IfcVoidingFeature | Đối chứng đổi lớp |
| --- | ---: | ---: |
| Thời gian một lần gọi | 25,068 s | 0,015 s |
| Thông báo CSG | 19 | 0 |
| Mesh xuất cho ID được chọn | 13 | 6 host |
| Tam giác | 7.277 | 3.088 |

Hai lần đo dùng input khác ngữ nghĩa lớp và không phải A/B hiệu năng cùng output. Không suy ra hệ số tăng tốc cho toàn file hay browser worker pool.

Đối chiếu hình học thực hiện ở world coordinates: hoàn nguyên site rotation, origin và RTC bằng f64; chuyển đúng Y-up/Z-up. Oracle của các host Reference-only tắt implicit opening subtraction để đọc Body theo chuẩn. Oracle của Body thật giữ phép cắt. Thể tích tính quanh tâm mesh để tránh triệt tiêu số lớn ở tọa độ hơn 1.100 km; không dùng trực tiếp tích có hướng ở tọa độ toàn cục.

Khoảng cách dưới đây là **lớn nhất trong các điểm lấy mẫu hai chiều tới tam giác**, gồm vertices và bốn điểm barycentric mỗi tam giác. Đây không phải phép đo Hausdorff chính xác hay chứng nhận toàn bộ bề mặt.

| Host Reference | Native hiện tại | Native đối chứng |
| --- | ---: | ---: |
| #64951 | 7,024 mm | 0,013 mm |
| #266636 | 39,962 mm | 0,009 mm |
| #322443 | 39,968 mm | 0,042 mm |
| #344051 | 40,491 mm | 0,047 mm |

Trên **web công khai v5.2.0**, cùng host #322443 có độ lệch lấy mẫu **39,955 mm**; bản đối chứng là **0,0019 mm**, và chỉ còn mesh host 104 tam giác thay vì host 308 tam giác cộng ba khối Reference. Các điểm còn lại của sáu host cũng được lưu, không chỉ các hàng nêu trên.

Dữ liệu: `geometry-oracle-comparison.json`, `live-web-oracle-comparison.json`, các JSON mesh và oracle đi kèm.

## Lỗi Body cần giữ thành một đầu việc riêng

Host **IfcMember #2444**, GlobalId `3N9Tak4p5C9AjdVZdC39eR`, Name `GAN NGANG`, có chín feature mang representation Body. Đây là các operand cắt thật.

- Native 20.4.0: bốn `KernelError`, 6.533 tam giác; độ lệch bề mặt lấy mẫu với OpenCASCADE khoảng **41,239 mm**.
- WASM cục bộ trên file đầy đủ: cũng bốn `KernelError`, 6.201 tam giác.
- Web công khai v5.2.0 trên mẫu nhỏ: bốn `KernelError`, 6.491 tam giác; độ lệch lấy mẫu khoảng **0,755 mm**.

Các con số thuộc các engine/RTC/input-context khác nhau, không gộp chúng thành cùng một sai số hoặc kết luận native và web có cùng output. Sự phụ thuộc vào frame/precision là một giả thuyết cần kiểm tra tiếp, chưa được xác định là nguyên nhân duy nhất.

Mẫu native **17.583 byte** tái hiện cùng positions và indices với output #2444 khi xử lý trên file gốc đầy đủ, cùng bốn thông báo. Vì vậy đã có một reproducer giữ nguyên lỗi, không cần chạy cả 130 MB để phát triển phép sửa.

Trong nguồn 20.4.0, `rust/geometry/src/csg/topology_diagnostic.rs` là nơi phát `KernelError` cho kết quả đã được nhận nhưng không qua directed-edge closure audit. Đây là chẩn đoán **informational, non-gating**; engine có thể tiếp tục trả geometry. Do đó thấy Ready hoặc không có JavaScript exception không chứng minh mesh kín/đúng.

Không bật một gate làm quay về host chưa cắt rồi coi đó là bản sửa. Cần sửa hoặc xử lý phép Boolean với oracle và kiểm tra topology; các lỗ thật phải còn đủ.

## Thứ tự sửa đề xuất

1. **Sửa quy tắc ngữ nghĩa dùng chung trong Rust.** Áp dụng chính sách Reference cho nhánh feature trừ khối phù hợp, bao gồm VoidingFeature. Reference-only không mesh và không kích hoạt CSG; trường hợp Body/Reference hỗn hợp vẫn cắt bằng Body. Giữ hành vi bảo thủ cho dữ liệu thiếu/sai/không nhận dạng và các guard sẵn có.
2. **Đồng bộ toàn bộ hiển thị feature trừ khối.** Overlay màu, alpha, visibility mặc định, instancing, picking/bounds và các consumer export/drawing phải cùng hiểu lớp này. Giữ thực thể/quan hệ IFC để kiểm tra và xuất; không xóa entity chỉ để hình đẹp.
3. **Sửa Body CSG trên mẫu #2444.** Ghim oracle, closure và sai số bề mặt cho native và WASM, gồm input đầy đủ và mẫu nhỏ, cùng nhiều RTC anchor. Mẫu #2361 là trường hợp so sánh bổ sung.
4. **Cải thiện tiến trình/hủy tải theo lô có giới hạn.** Đánh giá lại batch 65.536 sau khi bỏ công việc Reference thừa; đo cả latency phản hồi và peak memory. Không đánh đổi mất lỗ để rút thời gian.
5. **Kiểm chứng nguyên file trên bản đóng gói mới.** Mở đúng file gốc bất biến, kiểm tra các vùng mẫu, zoom/pan/rotate/chọn/Properties, hủy/đóng sạch, federation 1/N và các tính năng riêng đang có. Đo base/branch xen kẽ trên cùng output; perf verdict và giới hạn phải ghi trong repo.

Các trường hợp bắt buộc cho regression: Reference-only VoidingFeature; Body-only; hỗn hợp Body+Reference; OpeningElement/OpeningStandardCase cũ; feature có màu/alpha; subtype và metadata; cùng kết quả giữa producer native/WASM. Không đổi toàn bộ renderer hoặc kernel trước khi những mẫu này được kiểm chứng.

## Kết quả và giới hạn của đợt nghiên cứu

Đã tái hiện lỗi Reference/hiển thị trên web thực tế sau Ready, xác định từng entity, tạo hai mẫu nhỏ, đối chiếu oracle và xác định nguồn điều kiện lớp gây sai. Đã tái hiện riêng lỗi Body CSG và xác nhận mẫu nhỏ giữ nguyên mesh native bị lỗi.

Chưa có bản sửa sản phẩm, EXE mới, oracle toàn bộ mô hình, hay chứng nhận mọi lỗ đều đúng. Chưa tái hiện ứng dụng tự thoát; lần native file đầy đủ trước đó được người kiểm tra chủ động dừng sau 392 giây. Ảnh ẩn feature và đối chứng đổi lớp không thay thế các bước nghiệm thu này.

File IFC gốc và EXE r3 được kiểm tra hash sau nghiên cứu, đều giữ nguyên. Không sửa mã sản phẩm trong hai checkout; không push, mở PR hoặc đăng issue. Các browser/host do phép thử tạo đã đóng. Phép thử web dùng mẫu nhỏ, xử lý trong browser và chặn các HTTP request ghi dữ liệu; các lỗi mạng do chặn và cảnh báo hierarchy do mẫu đã rút gọn được giữ trong log, không coi là lỗi hình học.

Các file `*-class-control*` / `*-as-opening-control*` chỉ là đối chứng. Không dùng chúng làm IFC thay thế để bàn giao. `artifact-hashes.json` ghi hash các mẫu và ảnh; `research-summary.json` là kết quả máy đọc.
'''
(p/'NGHIEN-CUU-NHIP-CHINH.md').write_text(text,encoding='utf-8')
print('Report saved:',p/'NGHIEN-CUU-NHIP-CHINH.md')
