import json,pathlib,hashlib,subprocess,shutil,re,datetime
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'research/nhip-load-20261027'
ui=out/'packaged-r7'
release=pathlib.Path('F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-nhip-load-20261027-r7')
expected_model='110b48aeb00b183667fe5f973685100f6dbbc9375b34c10f899ca5a75b8e3085'
expected_exe='0a957e98ca82f23a56192313d9179dd6d4f9d71cd81c27fce0d87456dd76dff8'
def sha(path):
    h=hashlib.sha256()
    with pathlib.Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def read(path):return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))
assert sha(release/'IFC-Lite.exe')==expected_exe
assert sha('F:/Working/IFC Temp/Nhip chinh.ifc')==expected_model
assert sha('F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-nhip-fps-20261026-r6/IFC-Lite.exe')=='39f4496d873d4ff894b338a4fccde9c0fc93ba1d89672252bea8f2894eac9b2f'
assert sha('F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-nhip-geometry-20261026-r5/IFC-Lite.exe')=='551b949fcec353ea5d08877e1c538793857ab005d5467986b02ab3cff86442a7'
ab=read(out/'native-ab.json')
assert ab['allFullHashesEqual'] and len(ab['full'])==4
assert all(r['sourceSha256']==expected_model and r['stats']['total_csg_failures']==0 for r in ab['full'])
assert all(r['stats']['geometry_diagnostics']['totalUnsupportedItems']==0 for r in ab['full'])
for field in ['orderedMeshSha256','orderedPacketSha256','colorUpdatesSha256','meshes','vertices','triangles','packetBytes']:
    assert len({r[field] for r in ab['full']})==1,field
for fixture,runs in ab['fixtures'].items():
    assert len(runs)==10
    rows=[r['result'][0] for r in runs]
    for key in ['meshes','vertices','triangles','csgFailures','degenerateDropped']:
        assert len({r[key] for r in rows})==1,(fixture,key)
    assert len({h for r in rows for h in r['meshFingerprintsFnv1a64']})==1
checks=['workspace-test-exit','workspace-clippy-pinned-exit','finite-test-exit','desktop-test-exit','desktop-clippy-pinned-exit','desktop-build-exit','changeset-check-exit']
for name in checks: assert int((out/(name+'.txt')).read_text())==0,name
tests=read(out/'test-summary.json')
assert tests['workspace-tests']=={'passed':4860,'failed':0,'ignored':41}
assert tests['finite-kernel-tests']['passed']==10 and tests['desktop-tests']['passed']==36
geometry=read(ui/'geometry-qualification.json')
assert geometry['loadPath']=='native' and not geometry['loading'] and not geometry.get('error')
assert not geometry['geometryDifferences'] and not geometry['pendingRestores']
assert geometry['frame']['batchesNotResident']==0
assert geometry['renderer']['errors']==0 and geometry['renderer']['gpuErrors']==0
assert len(read(ui/'selected-meshes.json')['meshes'])==67
assert int((ui/'gesture-exit.txt').read_text())==0
gestures=read(ui/'r7-gestures.json')
assert {t['gesture'] for t in gestures['tests']}=={'orbit','pan','zoom'}
assert read(ui/'host-exit.json')['code']==0
close=read(ui/'clean-close.json');assert close['exitCode']==0 and close['closeAccepted']
session=read(ui/'session.json');assert session['sha256']==expected_exe and session['environment']['native']
ready=read(ui/'ready.json')

newfiles=['.changeset/bold-clouds-heal.md','rust/geometry/src/kernel/arrangement/source_query.rs','rust/geometry/src/kernel/arrangement/source_query_tests.rs']
newfiles += [p.relative_to(root).as_posix() for p in (root/'scripts/perf/evidence/nhip-source-query-20261027').glob('*.json')]
def patch(since):
    data=subprocess.check_output(['git','diff',*since,'--binary'],cwd=root)
    for file in newfiles:
        p=subprocess.run(['git','diff','--no-index','--binary','--','NUL',file],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        assert p.returncode==1,(file,p.stderr)
        data+=p.stdout
    return data
(release/'source.patch').write_bytes(patch(['HEAD']))
(release/'r7-from-r6.patch').write_bytes(patch([]))
evidence=release/'evidence';evidence.mkdir(exist_ok=True)
for name in ['native-ab.json','probe-provenance.json','test-summary.json','workspace-tests.log','workspace-clippy-pinned.log',
    'finite-kernel-tests.log','desktop-tests.log','desktop-clippy-pinned.log','desktop-build.log','module-size.log',
    'refwalk.log','rust-api-surface-final.log','source-query-tests.log','fixture-summary.json','changeset-check-final.log']:
    shutil.copy2(out/name,evidence/name)
for f in out.glob('full-*.json'):shutil.copy2(f,evidence/f.name)
repro=evidence/'repro';repro.mkdir(exist_ok=True)
for name in ['build-probes.py','qualify-native.py','launch-r7.mjs','probe/Cargo.toml','probe/Cargo.lock','probe/src/main.rs','probe/src/bin/selected.rs']:
    target=repro/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(out/name,target)
for name in ['session.json','ready.json','native-rpc.json','geometry-qualification.json','geometry-qualified.png',
    'selected-meshes.json','r7-gestures.json','clean-close.json','host-exit.json','loaded.png']:
    shutil.copy2(ui/name,evidence/name)
base=ab['fullSummary']['base']['medianSeconds'];branch=ab['fullSummary']['branch']['medianSeconds']
reduction=(1-branch/base)*100
q={'qualifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceRoot':str(root),'branch':'codex/nhip-geometry-20261024','baseCommit':'13e402c42884c479fc22437c2e8f7a8c5dad53c5',
    'comparisonBase':'qualified r6 staged source; prior uncommitted r5/r6 repairs included on both sides',
    'exe':{'path':str(release/'IFC-Lite.exe'),'sha256':expected_exe,'bytes':(release/'IFC-Lite.exe').stat().st_size},
    'model':{'path':'F:/Working/IFC Temp/Nhip chinh.ifc','sha256':expected_model},
    'sourcePatchSha256':sha(release/'source.patch'),'incrementalR7PatchSha256':sha(release/'r7-from-r6.patch'),
    'nativePerformance':{'interleavedPairs':2,'baseMedianSeconds':base,'branchMedianSeconds':branch,'reductionPercent':reduction,
        'scope':ab['scope'],'allOrderedMeshPacketColorHashesEqual':True,'meshes':ab['full'][0]['meshes'],
        'triangles':ab['full'][0]['triangles'],'packetBytes':ab['full'][0]['packetBytes'],'csgFailures':0},
    'packaged':{'readySampleMilliseconds':ready['elapsedMs'],'readySamplingResolutionMilliseconds':1000,
        'loadPath':geometry['loadPath'],'selectedMeshesComparedWithQualifiedR5':67,'bufferDifferences':0,
        'gpuErrors':0,'settledMissingBatches':0,'gestures':['orbit','pan','zoom'],'cleanCloseExitCode':0},
    'checks':tests,'canonicalClippyToolchain':'nightly-2025-11-15','buildAndRuntimeTestToolchain':'stable (rustc 1.99.0)',
    'wasmRuntimeSha256':sha(root/'packages/wasm/pkg/ifc-lite_bg.wasm'),
    'limits':['Native producer timing includes packet encoding and SHA256 qualification, excludes UI/IPC backpressure/semantics. OS file cache uncontrolled.',
        'Packaged Ready is one observed run, not an interleaved UI-load comparison; GPU settlement was separately verified.',
        'No WASM/browser throughput claim: Windows packaging reused the existing qualified r6 WASM runtime; the default native Rust backend was rebuilt.',
        'No claim of eliminating all prior r6 navigation pauses. No new renderer/residency/quality change.',
        'Latest stable Clippy reported pre-existing style findings outside this change. Both workspace and desktop canonical pinned Clippy passed without suppressions.',
        'Holter/ISSUE_053 absent locally. Public House and ISSUE_129 each have five fresh-process interleaved pairs; original Nhip is the supplied heavy model.',
        'No commit, push or public web deployment. Source remains in Core104; original IFC and r5/r6 EXEs re-hashed unchanged.']}
(release/'qualification.json').write_text(json.dumps(q,indent=2)+'\n')
(release/'README.md').write_text(f'''# IFC-Lite r7 — Nhip chinh

Chạy `IFC-Lite.exe` trong thư mục này. Đây là bản desktop riêng, tiếp tục bản r6.
File IFC gốc và các bản r5/r6 được giữ nguyên và đã đối chiếu lại SHA256.

## Kết quả

- Hai cặp đo xen kẽ trên đúng IFC gốc: khâu xử lý native và đóng gói hình học giảm từ trung vị **{base:.1f} xuống {branch:.1f} giây** (**{reduction:.1f}%**).
- Toàn bộ {q['nativePerformance']['meshes']:,} mesh, {q['nativePerformance']['triangles']:,} tam giác và {q['nativePerformance']['packetBytes']:,} byte gói hình học có SHA256 giữ nguyên giữa các lượt. 0 lỗi CSG/unsupported trên Nhip.
- EXE r7 thật mở file gốc đến Ready sau khoảng **{ready['elapsedMs']/1000:.1f} giây**. Đây là một lượt quan sát, không dùng để tính phần trăm tăng tốc UI. Sau đó đã đợi upload/gom nhóm GPU hoàn tất.
- 67 mesh lấy trực tiếp từ EXE giữ nguyên positions/indices/origin/color so với r5 đã kiểm chứng; 0 nhóm cần vẽ còn thiếu, 0 lỗi GPU. Xoay, pan, zoom bằng sự kiện chuột thật qua; đóng cửa sổ có exit code 0.
- Rust workspace: 4.860 passed, 0 failed, 41 ignored có sẵn. Thêm 10 kiểm tra kernel trên dữ liệu cắt thực và 36 kiểm tra desktop qua. Clippy workspace/desktop theo toolchain dự án, module-size, reference-walk và API snapshot đều qua.

## Thay đổi

Phân loại mặt của phép cắt hữu hạn dùng chỉ mục BVH sẵn có để lọc tam giác cần xét, giữ nguyên các phép kiểm tra chính xác. Mặt trùng vẫn chọn theo thứ tự gốc. Không đổi tolerance, phép cắt, tọa độ, màu, chất lượng hiển thị hay ngân sách residency. Năm kiểm thử mới đối chiếu với quét toàn bộ, bao gồm mặt nghiêng/trùng, vật thể lõm/rời và khe dương dưới lưới import.

Bản chụp API được tạo lại để ghi nhận ba hàm đã có từ phần sửa r5. Mã tối ưu mới chỉ thêm helper nội bộ.

## Phạm vi và giới hạn

Số đo native bao gồm encoder và SHA256 đối chiếu, chưa gồm truyền IPC, thuộc tính và GPU; cache hệ điều hành không kiểm soát. Ready và GPU-settled được ghi riêng. Hai mô hình công khai House/ISSUE_129 có năm cặp đo xen kẽ, giữ nguyên fingerprint; các lỗi CSG có sẵn của ISSUE_129 không tăng. Holter/ISSUE_053 không có trên máy.

Frontend được build lại; Windows dùng WASM r6 sẵn có vì không có wasm-pack trong môi trường build. Luồng mặc định **native** đã dùng Rust mới và được xác nhận trong EXE. Không tuyên bố tăng tốc WASM/web hoặc hết mọi nhịp khựng cũ của r6. Clippy stable mới có cảnh báo cũ ngoài phạm vi sửa; bộ Clippy đúng toolchain được dự án ghim đã qua, không thêm suppression.

Chưa commit/push/deploy website. Nguồn: `F:/Steel/VBA/IFC-Lite-Core104`, nhánh `codex/nhip-geometry-20261024`. `source.patch` là toàn bộ phần sửa từ HEAD; `r7-from-r6.patch` là phần bổ sung lượt này trên nền r6 đang staged. Bằng chứng và giới hạn máy đọc nằm trong `qualification.json` và `evidence/`.

EXE SHA256: `{expected_exe}`

![Nhip chinh từ EXE r7]({(evidence/'geometry-qualified.png').as_posix()})
''',encoding='utf-8')
(release/'NOT-FINAL.txt').unlink()
print(json.dumps({'release':str(release),'sha256':expected_exe,'nativeReductionPercent':reduction,'readySeconds':ready['elapsedMs']/1000}))
