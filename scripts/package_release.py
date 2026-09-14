#!/usr/bin/env python3
"""Package committed source with its commit and SHA-256; never include live data."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--video', type=Path)
args = parser.parse_args()
dirty = subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True)
if dirty.strip(): raise SystemExit('Tracked changes are not committed; finish verification and commit first.')
commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
release = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+commit[:8]
args.output.mkdir(parents=True,exist_ok=True)
archive = args.output/(release+'.tar.gz')
plain = args.output/(release+'.tar')
subprocess.run(['git','archive','--format=tar','-o',str(plain),commit],cwd=ROOT,check=True)
with tarfile.open(plain,'r') as src, tarfile.open(archive,'w:gz') as dst:
    for member in src.getmembers():
        if member.name.startswith(('data/','.venv','outputs/','.git/')): raise SystemExit('Unexpected private payload')
        dst.addfile(member,src.extractfile(member) if member.isfile() else None)
    if args.video:
        if not args.video.is_file(): raise SystemExit('Video not found')
        dst.add(args.video,arcname='public/submission/demo.mp4',recursive=False)
plain.unlink()
meta={'release':release,'commit':commit,'archive':str(archive.resolve()),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
if args.video: meta['video_sha256']=hashlib.sha256(args.video.read_bytes()).hexdigest()
(args.output/'latest-release.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
