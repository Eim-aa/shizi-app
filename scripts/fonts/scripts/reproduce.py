#!/usr/bin/env python3
"""Rebuild the Shizi font subsets in a fresh directory and compare SHA-256 with what the app ships.

Adapted from #180 handoff/r8-foundation/fonts/scripts/reproduce.py (v10 M5-2):
  --corpus f8   the frozen #180 corpus (corpus/f8/); compares with the #180 delivered SHA
                recorded in reports/f8/build-manifest.json (TTF + WOFF2).
  --corpus v10  (default) corpus/*.txt from scripts/fonts/build_corpus.mjs; compares the WOFF2
                with fonts/*.woff2 in the app and the runtime coverage manifest with
                fonts/coverage-manifest.json.
  --install     (v10 only) after building, copy the three WOFF2 and the coverage manifest into
                fonts/ and the build reports into reports/. Never touches fonts/fonts.css,
                licenses or anything else.
build-fonts.py / font_options.py / diagnose-gpos.py are the #180 files, byte-for-byte.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]          # scripts/fonts
APP = ROOT.parents[1]                               # repository root
FONTS = APP / 'fonts'
STEMS = ('ShiziKai-Regular', 'ShiziSerifSC-Regular', 'ShiziSerifSC-Medium')
REPORTS = ('build-manifest.json', 'coverage.json', 'names.json', 'source-fonts.json')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verified_bytes(row, cache=None):
    if cache is None:
        with urllib.request.urlopen(row['url'], timeout=120) as response:
            data = response.read()
    else:
        data = (cache / row['path']).read_bytes()
    if len(data) != row['bytes'] or sha(data) != row['sha256']:
        raise ValueError('Pinned source mismatch: ' + row['path'])
    return data


def runtime_manifest(raw):
    """#180 writes file paths as assets/<stem>.woff2; the app serves them next to fonts.css."""
    out = {}
    for face, row in raw.items():
        out[face] = dict(row, file=Path(row['file']).name)
    return json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, required=True, help='New directory outside the repository')
    parser.add_argument('--source-cache', type=Path, help='Existing download root containing locked paths; no network')
    parser.add_argument('--corpus', choices=['v10', 'f8'], default='v10')
    parser.add_argument('--install', action='store_true', help='v10 only: copy WOFF2 + coverage manifest into fonts/')
    parser.add_argument('--diagnose', action='store_true', help='Also run the bounded #180 GPOS explanation')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() or output.is_relative_to(APP):
        parser.error('Output must be a new directory outside this repository')
    if args.install and args.corpus != 'v10':
        parser.error('--install only applies to the v10 corpus')
    corpus_dir = ROOT / 'corpus' if args.corpus == 'v10' else ROOT / 'corpus/f8'
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
        shutil.copyfile(corpus_dir / name, output / 'corpus' / name)
    for name in ['build-fonts.py', 'font_options.py', 'diagnose-gpos.py']:
        shutil.copyfile(ROOT / 'scripts' / name, output / 'scripts' / name)
    subprocess.run([sys.executable, str(output / 'scripts/build-fonts.py')], check=True)

    rows = []
    if args.corpus == 'f8':
        expected = {Path(r['path']).name: r['sha256'] for r in json.loads((ROOT / 'reports/f8/build-manifest.json').read_text())['files']}
        for name in sorted(expected):
            actual = sha((output / 'assets' / name).read_bytes())
            rows.append({'file': name, 'expected': expected[name], 'actual': actual, 'matches': expected[name] == actual})
    else:
        built_manifest = runtime_manifest(json.loads((output / 'corpus/coverage-manifest.json').read_text()))
        (output / 'coverage-manifest.runtime.json').write_text(built_manifest)
        for stem in STEMS:
            name = f'{stem}.woff2'
            actual = sha((output / 'assets' / name).read_bytes())
            shipped = FONTS / name
            expected = sha(shipped.read_bytes()) if shipped.exists() else None
            rows.append({'file': 'fonts/' + name, 'expected': expected, 'actual': actual, 'matches': expected == actual})
        shipped = FONTS / 'coverage-manifest.json'
        expected = sha(shipped.read_bytes()) if shipped.exists() else None
        actual = sha(built_manifest.encode())
        rows.append({'file': 'fonts/coverage-manifest.json', 'expected': expected, 'actual': actual, 'matches': expected == actual})
        if args.install:
            FONTS.mkdir(exist_ok=True)
            for stem in STEMS:
                shutil.copyfile(output / 'assets' / f'{stem}.woff2', FONTS / f'{stem}.woff2')
            (FONTS / 'coverage-manifest.json').write_text(built_manifest)
            for name in REPORTS:
                shutil.copyfile(output / 'reports' / name, ROOT / 'reports' / name)

    if args.diagnose:
        subprocess.run([sys.executable, str(output / 'scripts/diagnose-gpos.py')], check=True)
    result = {'corpus': args.corpus, 'installed': bool(args.install), 'fonts': rows}
    (output / 'rebuild-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if not args.install and not all(row['matches'] for row in rows):
        raise SystemExit('Rebuilt bytes differ: retain output for review; shipped fonts were not changed')


if __name__ == '__main__':
    main()
