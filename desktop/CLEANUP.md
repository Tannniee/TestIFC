# Dọn các build cũ IFC-Lite

Script: `F:/Steel/VBA/IFC-Lite/desktop/Clean-OldBuilds.ps1`.
Giữ script trong thư mục desktop để nó xác định đúng checkout, không phụ thuộc
thư mục hiện tại của terminal. Không cần chạy PowerShell bằng quyền admin.

Đóng IFC-Lite và chờ các tác vụ build/dev kết thúc. Xem trước:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "F:\Steel\VBA\IFC-Lite\desktop\Clean-OldBuilds.ps1"
```

Dọn theo danh sách đã kiểm tra:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "F:\Steel\VBA\IFC-Lite\desktop\Clean-OldBuilds.ps1" -Apply
```

Mặc định chỉ xem trước. Có thể dùng `-Apply -WhatIf` để xem từng hành động.
ExecutionPolicy Bypass chỉ áp dụng cho tiến trình này, không đổi cấu hình máy.

## Phần được dọn

- `F:/Steel/VBA/IFC-Lite/desktop/src-tauri/target/debug`.
- `F:/Steel/VBA/IFC-Lite/target/debug`.
- `F:/Steel/VBA/IFC-Lite/.turbo/cache`.
- `F:/Steel/VBA/IFC-Lite/desktop/dist/assets`: asset frontend đã biên dịch cũ.
- Chín EXE/bộ cài trong tám thư mục release cũ đã liệt kê và cố định hash
  trong script. Manifest, README và ảnh kiểm tra của các bản này vẫn giữ lại.

Ước tính thu hồi **19,73 GiB**, sau khi loại các tệp build dùng chung hardlink.
Cache debug có thể tạo lại; lần biên dịch/kiểm tra Debug sau sẽ lâu hơn.
Đây là dữ liệu trung gian không cần cho các EXE phát hành được giữ lại, chứ
không có nghĩa là các cache này không bao giờ còn được dùng khi phát triển.

## Phần được giữ

- Ba release: `10.3.0`, `10.3.0-native-followup-20261010` và
  `10.3.0-native-navigation-250ms-20261010`. Hash bốn EXE/bộ cài trong ba thư
  mục này được kiểm tra trước và sau khi dọn.
- `F:/Steel/VBA/IFC-Lite/desktop/src-tauri/target/release`: các công cụ smoke
  và profiling còn tham chiếu EXE ở đây.
- `F:/Steel/VBA/IFC-Lite/target/server-release`: giữ output server release.
- `F:/Steel/VBA/IFC-Lite/desktop/dist/_fixtures`: có mô hình IFC mẫu, nên không
  xóa toàn bộ desktop/dist như đề xuất rộng hơn lúc quét ban đầu.
- Source, Git, công việc chưa commit, node_modules, bộ WASM, frontend hiện
  hành `F:/Steel/VBA/IFC-Lite/apps/viewer/dist`, mô hình và báo cáo kiểm tra.

## Điều kiện dừng

Script không tự đóng hay kill tiến trình. Nó dừng nếu thấy IFC-Lite/compiler/
dev đang hoạt động, Git theo dõi tệp trong vùng dọn, đường dẫn/junction bất
thường, mô hình/CAD trong vùng dọn, EXE đổi hash hoặc có tệp mới hơn mốc quét
2026-10-14 02:57:58 UTC. Trong trường hợp build mới hơn, cần quét lại và cập
nhật danh sách; không nên bỏ các kiểm tra để ép script chạy.

Danh sách là đường dẫn cố định; không quét rồi xóa mọi EXE hoặc mọi target.
Toàn bộ kiểm tra ban đầu hoàn tất trước khi xóa mục đầu tiên. Mỗi mục còn được
kiểm tra lại trước khi xóa. Nếu lỗi phát sinh giữa chừng, script dừng và ghi
những mục đã xóa vào `F:/Steel/VBA/IFC-Lite/desktop/reports/cleanup-run-*.json`.
Các mục đã xóa không được phục hồi tự động. Có thể chạy lại khi các điều kiện
dừng đã được giải quyết; mục không còn tồn tại sẽ được bỏ qua.

## Kiểm chứng của lượt viết script

- Đã chạy chế độ xem trước trên checkout thật, không thực hiện `-Apply` tại đó.
- Mười tình huống kiểm tra trong repo giả lập tạm: mặc định xem trước,
  WhatIf, EXE cũ đổi hash, EXE được bảo vệ đổi hash, file build mới, file được
  Git theo dõi, junction, tiến trình đang dùng, chỉ xóa đúng các mục chọn và
  chạy lại sau khi đã dọn.
- Kiểm tra nhánh xóa thực tế dùng Windows PowerShell 5.1 trên repo giả lập;
  xác nhận mô hình, source, manifest, frontend hiện hành, các output release
  và bốn EXE/bộ cài được bảo vệ còn nguyên.

Bằng chứng: `F:/Steel/VBA/IFC-Lite/desktop/reports/cleanup-script-tests.json`
và `F:/Steel/VBA/IFC-Lite/desktop/reports/cleanup-script-preview.log`.
