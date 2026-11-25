import os,pathlib,subprocess,shutil,json,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'research/nhip-load-20261027'
paths=['rust/geometry/src/kernel/arrangement/'+n+'.rs' for n in ['mod','classify','surface','strict_union','finite_difference']]
saved={p:(root/p).read_bytes() for p in paths}
base={p:subprocess.check_output(['git','show',':'+p],cwd=root) for p in paths}
cargo=str(pathlib.Path.home()/'.cargo/bin/cargo.exe')
bash=str(pathlib.Path(os.environ['LOCALAPPDATA'])/'ifclite-build-tools/git/bin/bash.exe')
env={**os.environ,'RUSTUP_TOOLCHAIN':'stable','PATH':str(pathlib.Path.home()/'.cargo/bin')+os.pathsep+os.environ['PATH']}
fixtures={'house':'tests/models/ara3d/AC20-FZK-Haus.ifc','issue129':'tests/models/ara3d/ISSUE_129_N1540_17_EXE_MOD_448200_02_09_11SMC_IGC_V17.ifc'}
def run(cmd,name,env=env):
    with (out/name).open('wb') as log:
        subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
def build(label):
    run([cargo,'build','--release','--manifest-path','research/nhip-load-20261027/probe/Cargo.toml','--bins'],f'{label}-build.log',
        {**env,'CARGO_TARGET_DIR':str(root/'desktop/src-tauri/target')})
    for binary in ['nhip-load-research-20261027','selected']:
        shutil.copy2(root/f'desktop/src-tauri/target/release/{binary}.exe',out/f'{binary}-{label}.exe')
    for fixture,path in fixtures.items():
        run([bash,'scripts/perf/probe.sh',path,'--iters','5','--json','--fingerprint'],f'{label}-{fixture}-probe.log')
    shutil.copy2(root/'target/profiling/examples/perf_probe.exe',out/f'perf-probe-{label}.exe')
    print(label,'built',flush=True)
try:
    for p,b in base.items():(root/p).write_bytes(b)
    build('base')
finally:
    for p,b in saved.items():(root/p).write_bytes(b)
build('branch')
(out/'probe-provenance.json').write_text(json.dumps({
    'source':str(root),'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
    'comparisonBase':'staged r6 source before this turn; includes prior uncommitted r5/r6 repairs',
    'files':{p:{'baseSha256':hashlib.sha256(base[p]).hexdigest(),'branchSha256':hashlib.sha256(saved[p]).hexdigest()} for p in paths},
    'toolchain':subprocess.check_output([cargo,'--version'],env=env,text=True).strip(),
},indent=2))
