"""Explicit runtime membership; never derive an application payload from a directory scan."""
from pathlib import Path, PurePosixPath
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'F8-2026-09-26-r2'
LICENSES = (
    'licenses/LXGW-WenKai-GB-OFL.txt',
    'licenses/Noto-Serif-SC-OFL.txt',
    'licenses/COPYRIGHT-NOTICES.md',
)
STEMS = ('ShiziKai-Regular', 'ShiziSerifSC-Regular', 'ShiziSerifSC-Medium')
PROFILES = {
    'woff2-web': {
        'font_format': 'woff2',
        'usage': 'Default web payload; local CSS + r1 helper + caller-supplied coverage manifest; all three static faces.',
        'paths': tuple(f'assets/{stem}.woff2' for stem in STEMS) +
                 ('assets/fonts.css', 'assets/font-loader.mjs', 'corpus/coverage-manifest.json') + LICENSES,
    },
    'ttf-native': {
        'font_format': 'ttf',
        'usage': 'Optional alternative for a native/custom loader; caller implements loading/coverage policy. Does not include WOFF2 CSS/helper or claim their behavior.',
        'paths': tuple(f'assets/{stem}.ttf' for stem in STEMS) + LICENSES,
    },
}
DEFAULT_PROFILE = 'woff2-web'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'

def checked_file(root, name):
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or str(relative) != name:
        raise ValueError(f'Invalid package path: {name}')
    path = root.joinpath(*relative.parts)
    for parent in [path, *path.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError(f'Symlink is not a package member: {name}')
    if not path.is_file():
        raise ValueError(f'Missing package member: {name}')
    return path

def record(root, name):
    data = checked_file(root, name).read_bytes()
    return dict(path=name, bytes=len(data), sha256=digest(data))

def runtime_manifest(root=ROOT):
    profiles = {}
    for key, spec in PROFILES.items():
        files = [record(root,p) for p in sorted(spec['paths'])]
        profiles[key] = dict(font_format=spec['font_format'], usage=spec['usage'],
                             count=len(files), total_bytes=sum(r['bytes'] for r in files), files=files)
    return dict(schema_version=1, version=VERSION, role='runtime', paths_relative_to='fonts/',
                default_profile=DEFAULT_PROFILE, selection='Choose exactly one profile; never union both profiles.',
                exclusions=['upstream/**', 'reports/**', 'evidence/**', 'work/**', 'scripts/**', 'specimen/**', 'all unlisted files'],
                size_definition='Exact sum of listed payload files, including license notices; manifest transport file itself is not in payload bytes.',
                profiles=profiles)

def validate_runtime_manifest(manifest):
    if manifest.get('role') != 'runtime' or manifest.get('version') != VERSION:
        raise ValueError('Only the current RUNTIME-MANIFEST.json can drive packaging')
    if manifest.get('default_profile') != DEFAULT_PROFILE or set(manifest.get('profiles',{})) != set(PROFILES):
        raise ValueError('Unexpected runtime profiles')
    for key,spec in PROFILES.items():
        profile = manifest['profiles'][key]
        names = [r['path'] for r in profile['files']]
        if len(names) != len(set(names)) or set(names) != set(spec['paths']):
            raise ValueError(f'{key}: runtime membership differs from the explicit allowlist')
        if profile['font_format'] != spec['font_format'] or profile['count'] != len(names):
            raise ValueError(f'{key}: profile metadata mismatch')
        if profile['total_bytes'] != sum(r['bytes'] for r in profile['files']):
            raise ValueError(f'{key}: byte sum mismatch')
