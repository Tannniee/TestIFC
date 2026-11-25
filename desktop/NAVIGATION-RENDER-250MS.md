# Native desktop: chờ 250 ms và chế độ xem nhanh

Ngày kiểm tra: 2026-10-10. Checkout `F:/Steel/VBA/IFC-Lite`, nhánh
`codex/desktop-v10.3.0`, nền `471284f476d64a659ae607eeec2115ca3afcb9fe`.

## Hành vi

- Zoom, xoay, pan và các thay đổi camera dùng chung khoảng đứng yên 250 ms.
  Thao tác tiếp hoặc camera còn chuyển động do làm mượt sẽ bắt đầu lại khoảng
  chờ. Thả chuột không còn tự yêu cầu một khung hình chất lượng đứng yên.
- Trong khi di chuyển và chờ, viewport dùng ngưỡng bỏ chi tiết nhỏ của chế độ
  di chuyển, bỏ các lượt làm rõ bằng contact shading, separation lines và bóng
  đổ. Hết khoảng chờ, viewport vẽ lại một lần theo cài đặt hiển thị đang có.
- `Settings → Performance → Fast view` giữ chế độ nhẹ cả khi dừng. Bật/tắt áp
  dụng ngay, không cần nạp lại mô hình. Tắt tùy chọn khôi phục các cài đặt làm
  rõ trước đó. Tùy chọn được lưu trên máy; mặc định tắt.
- Native Rust vẫn là đường nạp mặc định. Thay đổi này điều khiển viewport;
  không thay chất lượng hình học được tạo lúc nạp IFC.

## EXE

`release/10.3.0-native-navigation-250ms-20261010/IFC-Lite.exe`

SHA256: `B2161DB529B151814AD0D9F3217CEDDF94C537A689BAFA1DBB450BCD49A774AA`.

Manifest `build-info.json` ghi 115 tệp nguồn có thay đổi trong checkout hiện
tại, bao gồm công việc native từ các lượt trước. Đã kiểm tra EXE khớp manifest
và không có tệp nguồn nào lệch hash sau build. EXE bản trước
`10.3.0-native-followup-20261010` còn nguyên hash
`62802ABCE58035684AF3E2EDAE82BD3873AEE63AEEE9260ED6B545A9D39F537B`.

## Kiểm chứng

- 32 kiểm tra tự động thuộc ba shard viewer đều qua: vòng render, thả chuột,
  thao tác lại trước 250 ms, camera thật có damping, Fast view trên cảnh đứng
  yên, nút Settings và lưu tùy chọn. Các kiểm tra bảo vệ vòng render khi có lỗi
  vẫn qua.
- Typecheck toàn repository: 109/109 tác vụ; toàn bộ 3.256 tệp test của 56
  package nằm trong chương trình kiểm tra kiểu dữ liệu.
- Kiểm tra module size, i18n, cỡ chữ, khoảng trắng và oxlint qua. Không nâng
  giới hạn kích thước module hay sửa baseline để đạt kiểm tra.
- EXE cuối cùng: 17 kiểm tra trực tiếp trong WebView2 đều qua, không có lỗi
  trang. Hai mô hình IFC công khai nạp bằng native, không khởi tạo WASM;
  Properties, federation và section box vẫn hoạt động.
- Đo các lượt WebGPU thật bằng quan sát `GPUCommandEncoder.beginRenderPass`,
  kết hợp mẫu viewpoint qua rAF. Lần kiểm tra cuối:

| Thao tác | Từ mẫu camera chuyển động cuối đến lượt vẽ làm rõ đầu tiên |
| --- | ---: |
| Cuộn zoom | 260,85 ms |
| Cuộn lại sau 150 ms | 260,83 ms |
| Xoay | 260,82 ms |
| Pan | 260,71 ms |

Mỗi tình huống có đúng một khung hình làm rõ. Cuộn lại trong khoảng chờ không
có lượt làm rõ chen giữa. Fast view vẫn vẽ mô hình nhưng không chạy các lượt
AO/edges khi dừng; tắt tùy chọn khôi phục lượt edges. Một lần reload trang
trong EXE thật đã xác nhận tùy chọn được khôi phục từ bộ nhớ lưu trên máy.
Ảnh Settings và ảnh so sánh cảnh đã được xem trực tiếp.

Đây là thời điểm **bắt đầu mã hóa lệnh vẽ**, không phải phép đo pixel đã xuất
hiện trên màn hình. Mốc 250 ms tính từ camera dừng, bao gồm đuôi làm mượt;
không tính đơn thuần từ mouseup. Nhịp khung hình và thời gian GPU thực hiện
có thể làm hình rõ xuất hiện muộn hơn.

Chưa đo lại riêng mô hình lớn PVF trong lượt này. Cảnh báo reprojection
EPSG:32760 của fixture federation vẫn là hạn chế đã có từ trước; kiểm tra này
không chứng minh độ chính xác GIS hay toàn bộ geometry parity.

Bằng chứng cục bộ: `reports/navigation-render/smoke-native.json`, ảnh trong
cùng thư mục và các log `navigation-*.log` ở `reports/native-followup/`.
Các phiên kiểm tra dùng profile riêng và chỉ đóng tiến trình tự khởi chạy.

## Nguồn chính

- `apps/viewer/src/components/viewer/navigationRenderQuality.ts`: một mốc
  chờ, phát hiện thay đổi camera và chuyển mức chất lượng.
- `apps/viewer/src/components/viewer/useAnimationLoop.ts`: áp dụng cùng chính
  sách cho mọi đường điều khiển camera; chỉ yêu cầu khung khôi phục khi cần.
- `apps/viewer/src/store/slices/navigationRenderSettings.ts`: mặc định và
  lưu Fast view.
- `apps/viewer/src/components/viewer/settings/PerformanceSection.tsx`: công
  tắc trong Settings.
