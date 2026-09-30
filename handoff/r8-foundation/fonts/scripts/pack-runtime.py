#!/usr/bin/env python3
"""Copy exactly one runtime profile into a new directory, verifying every source hash first."""
import argparse
import json
from pathlib import Path
from font_package import ROOT, DEFAULT_PROFILE, PROFILES, checked_file, digest, validate_runtime_manifest

def package(destination, profile=DEFAULT_PROFILE, manifest=None):
    if manifest is None:
        manifest=json.loads((ROOT/'RUNTIME-MANIFEST.json').read_text())
    validate_runtime_manifest(manifest)
    if destination.exists():
        raise ValueError('Destination must be a new directory: '+str(destination))
    files=manifest['profiles'][profile]['files']
    payload=[]
    for row in files:
        data=checked_file(ROOT,row['path']).read_bytes()
        if len(data)!=row['bytes'] or digest(data)!=row['sha256']:
            raise ValueError('Source hash/size mismatch: '+row['path'])
        payload.append((row['path'],data))
    destination.mkdir(parents=True)
    for name,data in payload:
        target=destination/name
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(data)
    return dict(profile=profile,files=len(files),total_bytes=sum(len(data) for _,data in payload))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',choices=PROFILES,default=DEFAULT_PROFILE)
    parser.add_argument('--output',type=Path,required=True,help='New directory outside the source tree')
    args=parser.parse_args()
    if args.output.resolve().is_relative_to(ROOT):
        parser.error('--output must be outside fonts/')
    print(json.dumps(package(args.output,args.profile)))

if __name__=='__main__':
    main()
