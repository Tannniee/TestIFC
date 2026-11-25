"""Apply pinned upstream source changes in this isolated upgrade checkout only."""
from pathlib import Path
import json
import subprocess
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = '61d209288c1b117d405628ead302d0ee700bd2a0'
UI_BASE = 'e79f27342beb01a6f30d9b63c44795ecd118f4de'
LOCAL = '8c065043'
TARGET = '2cf5d2fa7f7831aa8282c944d7a2a67fa3cf878e'

def git(*args):
    return subprocess.check_output(['git', '-c', 'core.autocrlf=false', *args], cwd=ROOT)

def tree(ref):
    return {p.decode(): meta.split()[2].decode() for row in git('ls-tree','-r','-z',ref).split(b'\0') if row for meta,p in [row.split(b'\t',1)]}

def get_blobs(oids):
    proc = subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    result = {}
    try:
        for oid in set(oids):
            proc.stdin.write((oid+'\n').encode()); proc.stdin.flush()
            header=proc.stdout.readline().split(); size=int(header[2])
            result[oid]=proc.stdout.read(size)
            assert proc.stdout.read(1)==b'\n'
    finally:
        proc.stdin.close(); proc.wait()
    return result

scope = sys.argv[1]
def selected(path):
    if scope == 'packages': return path.startswith('packages/')
    if scope == 'rust': return path.startswith(('rust/','apps/server/')) or path in ('Cargo.toml','Cargo.lock','rust-toolchain.toml','rust-major-offset.json')
    if scope == 'viewer': return path.startswith('apps/viewer/')
    if scope == 'support':
        return not path.startswith(('packages/','rust/','apps/server/','apps/viewer/','desktop/','tasks/','research/','.changeset/')) and path not in ('Cargo.toml','Cargo.lock','rust-toolchain.toml','rust-major-offset.json')
    raise ValueError(scope)

base, ui, local, incoming = map(tree, (BASE,UI_BASE,LOCAL,TARGET))
all_paths = sorted(p for p in set(base)|set(ui)|set(local)|set(incoming) if selected(p))
oids = [mapping[p] for p in all_paths for mapping in (base,ui,local,incoming) if p in mapping]
blobs = get_blobs(oids)
changes=[]; conflicts=[]
for path in all_paths:
    origin = ui if path.startswith('apps/viewer/') else base
    b,l,t = (blobs.get(mapping.get(path)) for mapping in (origin,local,incoming))
    if b == t or l == t: continue
    strategy='upstream'
    if l == b: merged=t
    elif b is None and l is None: merged=t
    elif t is None:
        # Retain local-only modules; upstream-removed modified modules require review.
        if b is None: continue
        conflicts.append({'path':path,'reason':'upstream-delete-local-modified'}); continue
    elif l is None:
        # Absent upstream baseline content was never imported in the earlier partial update.
        merged=t; strategy='import-missing-upstream'
    elif b'\0' in l+t+(b or b''):
        conflicts.append({'path':path,'reason':'binary'}); continue
    else:
        with tempfile.TemporaryDirectory(prefix='ifclite-upgrade-') as folder:
            files=[Path(folder)/n for n in ('local','base','upstream')]
            for f,data in zip(files,(l,b or b'',t)): f.write_bytes(data.replace(b'\r\n',b'\n'))
            run=subprocess.run(['git','merge-file','-p','--diff3','-L','custom-r7','-L','previous-upstream','-L','github-main',*map(str,files)],capture_output=True)
        merged=run.stdout; strategy='three-way'
        if run.returncode:
            saved=OUT/'conflicts'/path; saved.parent.mkdir(parents=True,exist_ok=True); saved.write_bytes(merged)
            conflicts.append({'path':path,'reason':'content','regions':merged.count(b'<<<<<<< ')}); continue
    destination=(ROOT/path).resolve()
    assert destination.is_relative_to(ROOT.resolve())
    if '--apply' in sys.argv:
        actual=destination.read_bytes().replace(b'\r\n',b'\n') if destination.exists() else None
        expected=l.replace(b'\r\n',b'\n') if l else l
        if actual == (merged.replace(b'\r\n',b'\n') if merged else merged):
            changes.append({'path':path,'strategy':strategy,'action':'already-applied'})
            continue
        if actual != expected:
            raise RuntimeError(f'Unexpected existing modification: {path}')
        if merged is None: destination.unlink()
        else:
            destination.parent.mkdir(parents=True,exist_ok=True); destination.write_bytes(merged)
    changes.append({'path':path,'strategy':strategy,'action':'delete' if merged is None else 'write'})
report={'pin':TARGET,'snapshot':LOCAL,'scope':scope,'applied':'--apply' in sys.argv,'changes':changes,'conflicts':conflicts}
(OUT/f'{scope}-integration.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'scope':scope,'changes':len(changes),'conflicts':conflicts},indent=2))
