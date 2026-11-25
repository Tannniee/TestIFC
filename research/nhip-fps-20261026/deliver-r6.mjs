import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir,unlink,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='F:/Steel/VBA/IFC-Lite-Core104/research/nhip-fps-20261026';
const release='F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-nhip-fps-20261026-r6';
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const candidate=await json(root+'/candidate-r6/session.json');
const baseline=await json(root+'/baseline-valid/restore-timed.json');
const ablation=await json(root+'/baseline-valid/restore-disabled.json');
const geometry=await json(root+'/candidate-r6/geometry-qualification.json');
const labels=['qualified-close','qualified-orbit-2','qualified-orbit-3','qualified-orbit-4'];
const reports=await Promise.all(labels.map(l=>json(root+'/candidate-r6/'+l+'.json')));
const orbits=reports.map(r=>r.tests.find(t=>t.gesture==='orbit'));
assert.equal(geometry.geometryDifferences.length,0);assert.equal(geometry.pendingRestores,false);
assert.equal(geometry.frame.batchesNotResident,0);assert.equal(geometry.renderer.gpuErrors,0);
assert.equal(geometry.gpuBudget,2147483648);assert.equal(geometry.hostBudget,3221225472);
assert.ok(orbits.every(r=>r.restoreCpu.max<2&&r.restoredBatches>0));
assert.equal(await hash(release+'/IFC-Lite.exe'),candidate.sha256);
const testlog=await readFile(root+'/renderer-green-final.log','utf8');
assert.match(testlog,/pass 2210/);assert.match(testlog,/fail 0/);
assert.match(await readFile(root+'/lint-r6.log','utf8'),/9,074 files across 4 targets.*no errors/);
assert.match(await readFile(root+'/typecheck-r6.log','utf8'),/all 3597 test file/);
const summary={qualifiedAt:new Date().toISOString(),sourceRoot:'F:/Steel/VBA/IFC-Lite-Core104',branch:'codex/nhip-geometry-20261024',
  baseCommit:'13e402c42884c479fc22437c2e8f7a8c5dad53c5',baseR5PatchSha256:'c8c2a29fbd7453a15922365db92a13c80577ef3d43789e252b721eab73f24fa9',
  exe:{path:release+'/IFC-Lite.exe',sha256:candidate.sha256,bytes:(await stat(release+'/IFC-Lite.exe')).size},
  sourcePatchSha256:await hash(release+'/source.patch'),
  wasmSha256:await hash('F:/Steel/VBA/IFC-Lite-Core104/packages/wasm/pkg/ifc-lite_bg.wasm'),
  model:{path:candidate.model,sha256:await hash(candidate.model)},
  cause:'Complete synchronous merge/quantize/LOD rebuild inside an animation callback despite a between-batch time budget.',
  baselineDiagnostic:baseline.tests,retentionAblation:ablation.tests,
  candidateOrbits:orbits,otherGestures:reports[0].tests,
  geometry:{selectedMeshes:67,bufferDifferences:0,settledMissingBatches:0,gpuErrors:0},
  tests:{rendererPassed:2210,rendererSkipped:2,rendererFailed:0,typecheckedTestFiles:3597,lintFiles:9074,lintErrors:0},
  sourceOnlyChanges:'Renderer cooperative restore and lifecycle guards; Rust geometry and WASM unchanged from qualified r5.',
  limits:['No interleaved foreground R5/R6 or direct PVF FPS comparison. Candidate cadence is measured at render calls, not external visible-pixel latency.',
   'Two repeated orbit cohorts retained occasional approximately 130-150 ms pauses; restoration callback stayed below 1 ms. No claim of eliminating all stutter.',
   'Some batches can be temporarily absent during asynchronous restoration; all requested batches were restored in the final settled view.',
   'Initial upload/consolidation after the first Ready signal and cold-open time are separate work. User subsequently requested load-time optimization; that work remains active.',
   'Original full-file r6 window was left open for the user. Full-model process close was not tested on r6; Scene clear/cancellation and device recovery were tested.',
   'Public web was not deployed; no commit or push.']};
await mkdir(release+'/evidence',{recursive:true});
for(const l of labels)await copyFile(root+'/candidate-r6/'+l+'.json',release+'/evidence/'+l+'.json');
for(const name of ['geometry-qualified.png','geometry-qualification.json','selected-meshes.json','session.json','system-info.json'])
 await copyFile(root+'/candidate-r6/'+name,release+'/evidence/'+name);
for(const name of ['renderer-red.log','renderer-green-final.log','typecheck-r6.log','lint-r6.log','module-size.log','api-surface.log','geometry-qualification.log'])
 await copyFile(root+'/'+name,release+'/evidence/'+name);
await copyFile(root+'/baseline-valid/restore-timed.json',release+'/evidence/r5-restore-timed.json');
await copyFile(root+'/baseline-valid/restore-disabled.json',release+'/evidence/r5-retention-diagnostic.json');
await writeFile(release+'/qualification.json',JSON.stringify(summary,null,2)+'\n');
await writeFile(release+'/README.md',`# IFC-Lite r6 — giảm khựng khi xoay Nhip chinh

Chạy IFC-Lite.exe trong thư mục này. Bản r5 và file IFC gốc được giữ nguyên. Cửa sổ r6 đã mở mô hình đầy đủ đang được để lại để bạn thử tiếp.

## Đã sửa

Nút thắt là dựng lại cả nhóm hình học đã được đưa khỏi GPU ngay trong một khung hình. Lượt r5 ghi nhận callback này tới 488,09 ms. R6 chia việc merge/quantize/LOD thành các lát nền, chỉ có một tác vụ chuẩn bị cùng lúc; chỉ công bố kết quả còn đúng cảnh/cấu kiện. Hủy và giải phóng tác vụ cũ khi xóa cảnh hoặc khôi phục thiết bị.

Giữ nguyên chất lượng và các ngân sách residency đang dùng; phép tạm giữ toàn bộ GPU chỉ là đối chứng, không phải thiết lập bản giao. Mã hình học Rust/WASM không đổi.

## Kết quả trên EXE thật

- Bốn lượt xoay cận cảnh file gốc: khoảng 116–128 lượt dựng khung/giây, p95 khoảng 14–15 ms. Callback khôi phục trong luồng giao diện luôn dưới 1 ms.
- Lượt chính xoay/pan/zoom không có long task trên 50 ms; hai lượt xoay lặp vẫn có nhịp khoảng 130–150 ms. Chưa coi là hết giật hoàn toàn.
- Một số nhóm có thể xuất hiện trễ trong lúc khôi phục bất đồng bộ; sau khi dừng thao tác đã kiểm tra 0 nhóm cần vẽ còn thiếu, 0 lỗi GPU.
- 67 mesh lấy trực tiếp từ r6 giữ nguyên positions/indices/origin/color so với r5 đã kiểm chứng. Ảnh thực và dữ liệu nằm trong evidence.
- Renderer 2.210 test qua, 2 test fixture thiếu bỏ qua; root typecheck và lint qua. Các test mới kiểm tra nhường xử lý, byte parity, hủy cảnh và xử lý kết quả hoàn tất nhưng chưa công bố.

Các lượt r5/r6 không phải A/B foreground xen kẽ, nên không tuyên bố mức tăng FPS màn hình theo phần trăm. Tần suất dựng khung không đồng nghĩa độ trễ pixel đã trình bày. Chưa đo lại PVF trực tiếp.

## Phần mở file

Thời gian mở lần đầu và giai đoạn gom nhóm GPU sau tín hiệu Ready chưa được tối ưu trong r6. Người dùng đã yêu cầu tiếp tục xử lý phần này; kết quả sẽ được lưu trong một bản mới riêng. Không dùng thời gian load dưới tải kiểm thử để so tốc độ.

## Truy lại

EXE SHA256: ${summary.exe.sha256}

Source patch SHA256: ${summary.sourcePatchSha256}

WASM SHA256: ${summary.wasmSha256}

Nguồn: ${summary.sourceRoot}; nhánh ${summary.branch}. Source patch chưa commit/push. qualification.json nêu đầy đủ phạm vi và giới hạn. Website public chưa cập nhật. Lượt này không đóng cửa sổ r6 trên file gốc để người dùng thử ngay; không tuyên bố đã kiểm chứng clean-close full-model r6.
`);
await unlink(release+'/NOT-FINAL.txt');
await writeFile(root+'/FPS-CHECKPOINT.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({release,status:'qualified navigation improvement; load optimization continues',exeSha256:candidate.sha256}));
