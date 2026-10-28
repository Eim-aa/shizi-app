"""Prove the geometry comparator rejects a one-pixel native frame displacement."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json,subprocess,sys
import numpy as np
from PIL import Image
source=Path('artifacts/image-parity').resolve()
with TemporaryDirectory(prefix='shizi-image-comparator-') as d:
    root=Path(d)
    (root/'reference').symlink_to(source/'reference',target_is_directory=True)
    (root/'regions.json').symlink_to(source/'regions.json')
    (root/'swift').mkdir()
    for f in (source/'swift').glob('*.png'):(root/'swift'/f.name).symlink_to(f)
    name='01-work-frame-0.png'
    im=np.asarray(Image.open(source/'swift'/name))
    (root/'swift'/name).unlink()
    Image.fromarray(np.roll(im,1,axis=1)).save(root/'swift'/name)
    p=subprocess.run([sys.executable,'scripts/image-parity/compare.py',str(root)],capture_output=True,text=True)
    assert p.returncode==1,(p.stdout,p.stderr)
    report=json.loads((root/'report.json').read_text())
    assert report['failed']==['01-work-0.png'],report['failed']
print('Comparator self-test: 1px frame displacement rejected')
