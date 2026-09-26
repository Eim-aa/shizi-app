#!/usr/bin/env python3
"""Read-only source verification; package test outputs live in a temporary directory."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'fonts/scripts'))
from font_package import validate_runtime_manifest
spec = importlib.util.spec_from_file_location('pack_runtime', ROOT / 'fonts/scripts/pack-runtime.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
reproduce_spec = importlib.util.spec_from_file_location('reproduce', ROOT / 'fonts/scripts/reproduce.py')
reproduce = importlib.util.module_from_spec(reproduce_spec)
reproduce_spec.loader.exec_module(reproduce)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

manifest = json.loads((ROOT / 'fonts/RUNTIME-MANIFEST.json').read_text())
validate_runtime_manifest(manifest)
results = []
with tempfile.TemporaryDirectory(prefix='shizi-r8-package-') as temporary:
    for name, profile in manifest['profiles'].items():
        out = Path(temporary) / name
        result = pack.package(out, name, manifest)
        assert {str(p.relative_to(out)) for p in out.rglob('*') if p.is_file()} == {r['path'] for r in profile['files']}
        for row in profile['files']:
            assert sha(out / row['path']) == row['sha256']
            assert (out / row['path']).stat().st_size == row['bytes']
        results.append(result)
        try:
            pack.package(out, name, manifest)
        except ValueError:
            pass
        else:
            raise AssertionError('Existing output was accepted')
    bad = json.loads(json.dumps(manifest))
    bad['profiles']['woff2-web']['files'][0]['sha256'] = '0' * 64
    rejected = Path(temporary) / 'bad'
    try:
        pack.package(rejected, 'woff2-web', bad)
    except ValueError:
        assert not rejected.exists()
    else:
        raise AssertionError('Damaged source hash was accepted')
    try:
        pack.package(Path(temporary) / 'archive', manifest={'role':'archive'})
    except ValueError:
        pass
    else:
        raise AssertionError('Archive accepted as runtime manifest')

source = json.loads((ROOT / 'SOURCE-MANIFEST.json').read_text())
for row in source['files']:
    assert sha(ROOT / row['path']) == row['sha256'], row['path']
for path in ROOT.rglob('*.py'):
    ast.parse(path.read_text(), filename=str(path))
for path in ROOT.rglob('*'):
    if not path.is_file():
        continue
    assert not path.is_symlink()
    assert not any(part in ['upstream','work','node_modules','__pycache__'] for part in path.relative_to(ROOT).parts)
    if path.suffix in ['.md','.mjs','.py','.json','.css']:
        text = path.read_text()
        assert not re.search(r'/[U]sers/|/[h]ome/[^/]+/|[.]codex/worktrees|[f]ile://', text), path
        if path.suffix == '.md':
            for href in re.findall(r'\]\(([^)]+)\)', text):
                if re.match(r'[a-z]+:|#', href):
                    continue
                target = path.parent / href.split('#')[0]
                assert target.exists(), (path,href)
for name in ['LXGW-WenKai-GB-OFL.txt','Noto-Serif-SC-OFL.txt']:
    assert 'SIL OPEN FONT LICENSE Version 1.1' in (ROOT / 'fonts/licenses' / name).read_text()
lock = json.loads((ROOT / 'fonts/provenance/download-lock.json').read_text())
for row in lock:
    if row['path'].startswith('licenses/'):
        assert reproduce.verified_bytes(row, ROOT / 'fonts') == (ROOT / 'fonts' / row['path']).read_bytes()
        try:
            reproduce.verified_bytes(dict(row, sha256='0' * 64), ROOT / 'fonts')
        except ValueError:
            pass
        else:
            raise AssertionError('Rebuild accepted altered source')
archive = json.loads((ROOT / 'ARCHIVE-MANIFEST.json').read_text())
assert archive['role'] == 'archive'
actual = {str(p.relative_to(ROOT)) for p in ROOT.rglob('*') if p.is_file() and p.name != 'ARCHIVE-MANIFEST.json'}
assert actual == {r['path'] for r in archive['files']}
for row in archive['files']:
    assert sha(ROOT / row['path']) == row['sha256'], row['path']
print(json.dumps({'status':'pass','runtimeProfiles':results,'sourceRecords':len(source['files']),'archiveFiles':len(archive['files']),'checks':['existing destination refused','damaged source refused before output','archive cannot drive runtime','source hashes','Python syntax','no private paths or temporary environments','Markdown links','full OFL notices','offline rebuild source validation','exact archive membership and hashes']},indent=2))
