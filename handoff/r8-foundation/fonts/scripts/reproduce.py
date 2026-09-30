#!/usr/bin/env python3
"""Rebuild the frozen F8 corpus in a fresh directory; never replace delivered assets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def verified_bytes(row, cache=None):
    if cache is None:
        with urllib.request.urlopen(row['url'], timeout=120) as response:
            data = response.read()
    else:
        data = (cache / row['path']).read_bytes()
    if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError('Pinned source mismatch: ' + row['path'])
    return data

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-cache', type=Path, help='Existing download root containing locked paths; no network')
    parser.add_argument('--diagnose', action='store_true', help='Also run the bounded GPOS explanation')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() or output.is_relative_to(ROOT.parent):
        parser.error('Output must be a new directory outside this handoff')
    # Read and validate every upstream member before creating the build directory.
    lock = json.loads((ROOT / 'provenance/download-lock.json').read_text())
    payload = [(row['path'], verified_bytes(row, args.source_cache)) for row in lock]
    output.mkdir(parents=True)
    for name in ['assets', 'reports', 'corpus', 'scripts', 'upstream']:
        (output / name).mkdir()
    for name, data in payload:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    shutil.copyfile(ROOT / 'provenance/download-lock.json', output / 'upstream/download-lock.json')
    for name in ['kai-unicodes.txt', 'serif-unicodes.txt']:
        shutil.copyfile(ROOT / 'corpus' / name, output / 'corpus' / name)
    for name in ['build-fonts.py', 'font_options.py', 'diagnose-gpos.py']:
        shutil.copyfile(ROOT / 'scripts' / name, output / 'scripts' / name)
    subprocess.run([sys.executable, str(output / 'scripts/build-fonts.py')], check=True)
    rows = []
    for path in sorted((ROOT / 'assets').glob('*')):
        if path.suffix not in ['.ttf', '.woff2']:
            continue
        expected = hashlib.sha256(path.read_bytes()).hexdigest()
        actual = hashlib.sha256((output / 'assets' / path.name).read_bytes()).hexdigest()
        rows.append({'file': path.name, 'expected': expected, 'actual': actual, 'matches': expected == actual})
    if args.diagnose:
        subprocess.run([sys.executable, str(output / 'scripts/diagnose-gpos.py')], check=True)
    result = {'corpus': 'frozen c7c8fc2 F8 corpus; no new UI/corpus approval', 'fonts': rows}
    (output / 'rebuild-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if not all(row['matches'] for row in rows):
        raise SystemExit('Rebuilt bytes differ: retain output for review; delivered fonts were not changed')

if __name__ == '__main__':
    main()
