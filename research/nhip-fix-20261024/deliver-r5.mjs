import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source='F:/Steel/VBA/IFC-Lite-Core104';
const root=join(source,'research/nhip-fix-20261024');
const release='F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-nhip-geometry-20261026-r5';
const evidence=join(release,'evidence');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const run=await json(join(root,'packaged-r5-original/report.json'));
const exit=await json(join(root,'packaged-r5-original/exit-code-witness.json'));
const topo=await json(join(root,'packaged-r5-original/exact-topology.json'));
const all=await json(join(root,'all-hosts-packet-r5.json'));
const wasm=await json(join(root,'wasm-full-selected-r5-topology.json'));
const web=await json(join(root,'local-web-r5-verified/report.json'));
const oracle=await json(join(root,'packaged-r5-original/oracle-qualified.json'));
const sections=await json(join(root,'packaged-r5-original/independent-section-qualified.json'));
const perf=await json(join(root,'perf-interleaved-r5.json'));
assert.equal(run.passed,true);assert.equal(run.cleanExit,true);assert.equal(run.errors.length,0);
assert.equal(exit.exitCode,0);assert.equal(exit.hasExited,true);
assert.equal(topo.length,67);
assert.ok(topo.every(m=>m.unpairedOrNonmanifoldEdges===0&&m.directedMismatch===0&&m.collapsedTriangles===0));
assert.equal(all.meshes,5075);assert.equal(all.selectedHosts,5075);assert.equal(all.badPackets.length,0);
assert.equal(all.stats.total_csg_failures,0);
assert.equal(all.stats.geometry_diagnostics.totalUnsupportedItems,0);
assert.equal(wasm.meshes.length,67);
assert.ok(wasm.meshes.every(m=>m.badEdges===0&&m.directedMismatch===0&&m.collapsedTriangles===0));
assert.equal(web.passed,true);assert.equal(web.cases.length,4);assert.equal(web.errors.length,0);
const wasmHash=await hash(join(source,'packages/wasm/pkg/ifc-lite_bg.wasm'));
assert.equal(wasm.wasmSha256,wasmHash);
for(const c of web.cases)assert.ok(c.wasmHashes.some(h=>h.sha256===wasmHash));
const member=oracle.rows.find(m=>m.id===286665);
assert.ok(Math.abs(member.actual.volume-0.09050675564233114)<2e-6);
assert.ok(sections.rows.every(m=>m.maxPrecisionMarginHausdorffMm<.2));
const workspaceLog=await readFile(join(root,'workspace-tests-r5-final.log'),'utf8');
const tests={passed:0,failed:0,ignored:0,suites:0};
for(const m of workspaceLog.matchAll(/^test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;/gm)){
  tests.passed+=Number(m[1]);tests.failed+=Number(m[2]);tests.ignored+=Number(m[3]);tests.suites++;
}
assert.equal(tests.failed,0);assert.equal(tests.passed,4855);
const logGate=async(name,pattern)=>assert.match(await readFile(join(root,name),'utf8'),pattern,name);
await logGate('workspace-clippy-r5.log',/Finished/);
await logGate('native-r5-clippy.log',/Finished/);
await logGate('wasm-r5-contract.log',/193 passed, 0 failed, 7 skipped/);
await logGate('lint-r5-final.log',/lint: .*files across 4 targets.*no errors/);
await logGate('typecheck-precision-final.log',/all 3597 test file/);
assert.equal(await hash(join(release,'IFC-Lite.exe')),run.exeSha256);
assert.equal(await hash(run.model),run.modelSha256);
const originalExe='F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-packages-audit-20261020-r3/IFC-Lite.exe';
assert.equal(await hash(originalExe),'ede20104a6152a308bdb50fed44f870d1ac5d0539e623e150abb311325b89545');
const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
assert.equal(git('diff','--name-only'),'');
execFileSync('git',['diff','--cached','--check'],{cwd:source});
execFileSync('git',['diff','--cached','--binary','--output='+join(release,'source.patch')],{cwd:source});
const manifest={qualifiedAt:new Date().toISOString(),
  scope:'Original Nhip chinh load, visible Reference-feature defect, finite Body geometry and final native transport; not whole-model oracle equivalence',
  source:{root:source,branch:git('branch','--show-current'),base:git('rev-parse','HEAD'),remote:git('remote','get-url','origin'),
    committed:false,pushed:false,patchSha256:await hash(join(release,'source.patch'))},
  artifacts:{exe:{path:join(release,'IFC-Lite.exe'),bytes:(await stat(join(release,'IFC-Lite.exe'))).size,sha256:run.exeSha256},wasmSha256:wasmHash},
  preserved:{model:{path:run.model,sha256:run.modelSha256},originalExe:{path:originalExe,sha256:await hash(originalExe)}},
  packaged:{loadSeconds:run.loadSeconds,conditions:'Fresh isolated profile and native from_cache=false; Rust compilation/tests overlapped, not an idle A/B speed claim',
    cleanExit:true,exitCode:exit.exitCode,tests:run.tests,native:run.states.at(-1).state.native.stats},
  topology:{allBodyHostsAfterPacket:{selected:all.selectedHosts,meshes:all.meshes,bad:all.badPackets.length},actualPackagedSelected:{meshes:topo.length,bad:0},actualWasmSelected:{meshes:wasm.meshes.length,bad:0}},
  tests:{rustWorkspace:tests,wasmContract:{passed:193,failed:0,skipped:7},rootTypecheck:{includedTestFiles:3597,packages:63},
    typescript:{geometryPassed:649,viewerSelectedPassed:11,wasmPassed:14,wasmSkipped:7},localBrowser:{cases:4,errors:0},
    nativeTests:'passed; includes portable and original captured final-basis regressions',clippyWorkspace:'passed, all targets, warnings denied',clippyDesktop:'passed, all targets, warnings denied',lint:'passed'},
  independentOracle:{member286665:{referenceVolumeM3:0.09050675564233114,actualVolumeM3:member.actual.volume,absoluteToleranceM3:2e-6},
    comparedHosts:oracle.rows.length,sectionHosts:sections.rows.map(m=>({id:m.id,sections:m.sections.length,precisionMarginHausdorffMm:m.maxPrecisionMarginHausdorffMm}))},
  performance:perf,
  limits:['Public ifclite.dev has not been deployed or changed.',
    'Browser UI covered four reduced real-source cases; original full source was exercised through actual WASM on selected jobs, not as a complete browser UI load.',
    'Exact edge pairing and nonzero faces do not prove absence of all self-intersections or independent material equivalence on every full-model triangle.',
    'Raw OCC surface discrepancies remain. Independent material sections explicitly use a 0.1 mm opening; this is not raw Hausdorff parity and not a proof that every thin feature was preserved. Separate blind-skin regression/ray witnesses cover retained thin skins.',
    'Heavy Holter/ISSUE_053 performance fixtures were absent; native measurements exclude browser/GPU/UI.']};
await mkdir(evidence,{recursive:true});
for(const name of ['report.json','exact-topology.json','oracle-qualified.json','independent-section-qualified.json','clean-close.json','exit-code-witness.json','ready.png','bridge-closeup.png','after-navigation.png','selected-meshes.json'])
  await copyFile(join(root,'packaged-r5-original',name),join(evidence,name));
for(const name of ['all-hosts-packet-r5.json','wasm-full-selected-r5-topology.json','workspace-tests-r5-final.log','workspace-clippy-r5.log','native-r5-all-tests.log','native-r5-clippy.log','wasm-r5-contract.log','typecheck-precision-final.log','ts-site-final-tests.log','lint-r5-final.log','module-size-r5-base.log','refwalk-r5.log','source-text-r5.log','perf-interleaved-r5.json','packet-precision-red.log','packet-precision-green.log','chord-precision-budget-final.log'])
  await copyFile(join(root,name),join(evidence,name));
await copyFile(join(root,'local-web-r5-verified/report.json'),join(evidence,'local-web-report.json'));
await writeFile(join(release,'qualification.json'),JSON.stringify(manifest,null,2)+'\n');
const readme=`# IFC-Lite 10.4.0 — bản sửa Nhip chinh, r5

Đã kiểm chứng bản EXE này với đúng file **F:\\Working\\IFC Temp\\Nhip chinh.ifc**. Chạy **IFC-Lite.exe** trong thư mục này rồi mở file như bình thường.

## Kết quả thực tế

- File gốc mở tới Ready sau **${run.loadSeconds.toFixed(3)} giây**, không lỗi tải hoặc thoát giữa chừng. Đây là lượt mở mới, không dùng cache; có kiểm thử/biên dịch khác chạy song song nên không dùng làm số đo tăng tốc.
- Không còn các mảng xanh khổng lồ do hiển thị nhầm hình học Reference. Các phép cắt Body thật vẫn được giữ.
- Đã thử thao tác chuột xoay, lăn bánh xe zoom và Home trên mô hình đầy đủ. Đóng cửa sổ bình thường, mã thoát **0**.
- Toàn bộ **5.075 host có Body cutter** qua kiểm tra lưới kín sau bước chuyển tọa độ truyền sang màn hình. **67 lưới** lấy trực tiếp từ EXE cũng kín, ghép cạnh đúng hướng và không còn tam giác diện tích bằng 0. Không có lỗi CSG hoặc loại hình học không hỗ trợ trong lượt tải gốc này.

## Thay đổi chính

Phân biệt Reference và Body của các đối tượng trừ; giải phép cắt hữu hạn trong hệ tọa độ cấu kiện để giảm mất chính xác; chia cung theo Precision của file. Các lớp vật liệu mỏng được bảo vệ bằng kiểm thử riêng. Bước chuyển hệ trục cuối dùng chung phép chia cạnh chính xác thay vì xóa các tam giác mỏng còn diện tích. Tiến độ native được phát đều hơn để không giấu hàng phút xử lý trong một batch lớn.

## Kiểm chứng và giới hạn

Rust workspace: **${tests.passed} qua, 0 thất bại, ${tests.ignored} bỏ qua**; clippy workspace và desktop đều qua với warnings bị coi là lỗi. Root typecheck bao phủ 3.597 tệp kiểm thử; lint qua. WASM contract: **193 qua, 0 thất bại, 7 bỏ qua do thiếu fixture**. Bộ TS liên quan và bốn mẫu thật trong trình duyệt đều qua. Binary WASM mới cũng xử lý 67 lưới chọn từ toàn bộ IFC gốc, đều kín và không suy biến.

Đối chứng IfcOpenShell/OCC chia cung 1 micromet cho Member #286665: volume thực **${member.actual.volume} m³**, tham chiếu **0,09050675564233114 m³**, giữ tolerance **2e-6 m³**. Hai Plate #448868/#460997 có sai khác bề mặt lấy mẫu khoảng 0,056 mm. Plate #490757 dùng tích phân mặt cắt độc lập vì OCC bỏ sót một cutter thật; sai khác volume khoảng 0,0154%.

Sai khác **bề mặt thô** với OCC vẫn còn trên một số host. Mặt cắt vật liệu độc lập của #178955 và #198892 qua theo Precision: 33 lớp/cấu kiện, sai khác lớn nhất sau material opening 0,1 mm lần lượt khoảng **0,00068 mm** và **0,04764 mm**. Phép lọc này chỉ phục vụ so sánh, không sửa mesh và không được diễn giải thành raw Hausdorff parity. Kiểm tra kín cũng không thay thế kiểm tra tự giao hoặc chứng minh mọi tam giác trùng Trimble/OCC.

File lớn vẫn cần chờ nhiều phút. Không cam kết tốc độ mở hoặc FPS cho mọi máy. So sánh hiệu năng native base/branch được lưu riêng: mẫu House giữ byte-identical geometry, có chi phí nhỏ gần độ phân giải đồng hồ; ISSUE_129 nhanh hơn với thay đổi hình học đã đối chứng, vẫn còn 41 lỗi CSG có sẵn ở các host khác. Chưa đo các mẫu nặng Holter/ISSUE_053.

**Website ifclite.dev chưa được cập nhật.** Kiểm tra giao diện web dùng bốn mẫu rút gọn thật; không phải lượt mở toàn bộ IFC gốc trong trình duyệt. Mã sửa WASM có trong source patch này. Không push, merge hoặc deploy.

## Bảo toàn và truy lại

File IFC gốc và EXE 10.4.0-packages-audit-20261020-r3 giữ nguyên hash. Các bản thử r1–r4 được giữ riêng; r4 chưa đủ điều kiện vì hai mesh suy biến ở bước truyền tọa độ, đã sửa ở r5.

- EXE SHA256: ${run.exeSha256}
- WASM SHA256: ${wasmHash}
- Source patch SHA256: ${manifest.source.patchSha256}
- IFC SHA256: ${run.modelSha256}
- Nguồn làm việc: ${source}, nhánh ${manifest.source.branch}, base ${manifest.source.base}.

Xem **qualification.json** để có provenance và phạm vi từng phép kiểm tra. Thư mục **evidence** chứa báo cáo tải, ảnh mô hình thực, dữ liệu lưới chọn lọc, đối chứng và log. **source.patch** chứa thay đổi mã nguồn chưa commit; không gồm model riêng, binary hoặc cache.
`;
await writeFile(join(release,'README.md'),readme);
await unlink(join(release,'NOT-FINAL.txt'));
console.log(JSON.stringify({release,exeSha256:run.exeSha256,patchSha256:manifest.source.patchSha256,loadSeconds:run.loadSeconds,rust:tests,status:'qualified within documented scope'}));
