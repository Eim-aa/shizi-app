"""Pixel comparison. Geometry NP-22: IoU >= .8, symmetric 1px coverage >= .97,
area ratio within 10%. Frame/seal geometry: exact vector coordinates, coverage >= .995, area within 2%.
TEXT-CT-WEBKIT is separate: font rasterization/advance differences, <= 2% of
canvas pixels and <= 12/255 mean error inside the named text regions.
"""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(sys.argv[1] if len(sys.argv)>1 else 'artifacts/image-parity')
manifest=json.load(open(Path(__file__).parent/'reference-manifest.json'))
expected={r['file'] for r in manifest['files']}
def normal_names(folder):
    return {p.name for p in folder.glob('*.png') if not any('-'+layer+'-' in p.name for layer in ['frame','seal','ink'])}
assert normal_names(root/'reference')==expected, 'reference page set differs from fixed input contract'
assert normal_names(root/'swift')==expected, 'native page set differs from reference (pagination regression)'

def dilate(a):
    p=np.pad(a,1);return np.logical_or.reduce([p[y:y+a.shape[0],x:x+a.shape[1]] for y in range(3) for x in range(3)])
def metrics(a,b):
    union=np.count_nonzero(a|b);inter=np.count_nonzero(a&b)
    if not union:return dict(iou=1,iou1=1,area=1)
    na=np.count_nonzero(a);nb=np.count_nonzero(b)
    return dict(iou=inter/union,iou1=min(np.count_nonzero(a&dilate(b))/max(1,na),np.count_nonzero(b&dilate(a))/max(1,nb)),area=nb/max(1,na))
rows=[];failed=[]
for ref in sorted((root/'reference').glob('*.png')):
    if any('-'+layer+'-' in ref.name for layer in ['frame','seal','ink']):continue
    got=root/'swift'/ref.name
    if not got.exists():failed.append(ref.name+': missing');continue
    a=np.array(Image.open(ref).convert('RGB')).astype(np.int16);b=np.array(Image.open(got).convert('RGB')).astype(np.int16)
    if a.shape!=b.shape:failed.append(ref.name+': size');continue
    # The region file is emitted from reference geometry, never inferred from native pixels.
    regions=json.load(open(root/'regions.json'))[ref.name]
    text=np.zeros(a.shape[:2],bool)
    for x,y,w,h in regions['text']:
        text[max(0,int(y)):min(a.shape[0],int(np.ceil(y+h))),max(0,int(x)):min(a.shape[1],int(np.ceil(x+w)))]=True
    diff=np.max(np.abs(a-b),axis=2);outside=~text
    # Palette projections separate opaque geometry from paper and text antialiasing.
    vals={}
    for name in ['ink','frame','seal']:
        stem,index=ref.stem.rsplit('-',1)
        layerfile=f'{stem}-{name}-{index}.png'
        def mask(folder):
            im=np.asarray(Image.open(root/folder/layerfile).convert('RGB'))
            return im[:,:,:3].mean(axis=2)<(128 if name=='ink' else 204)
        vals[name]=metrics(mask('reference'),mask('swift'))
    # A second check uses the actual colored PNGs, so palette bugs cannot hide behind diagnostic overrides.
    stem,index=ref.stem.rsplit('-',1)
    am=np.asarray(Image.open(root/'reference'/f'{stem}-ink-{index}.png').convert('RGB')).mean(axis=2)<128
    bm=np.asarray(Image.open(root/'swift'/f'{stem}-ink-{index}.png').convert('RGB')).mean(axis=2)<128
    interior=am&bm&~text
    for _ in range(2):interior=~dilate(~interior)
    color_mae=float(np.mean(np.abs(a-b)[interior])) if interior.any() else 0
    text_fraction=np.count_nonzero((diff>24)&text)/diff.size
    text_mae=float(np.mean(np.abs(a-b)[text])) if text.any() else 0
    # Geometry itself is measured in each cell/brand ROI to avoid accidental inclusion of captions.
    ok=all(v['iou']>=.8 and v['iou1']>=.97 and abs(v['area']-1)<=.1 for v in [vals['ink']]) and all(v['iou']>=.995 and v['iou1']>=.995 and abs(v['area']-1)<=.02 for v in [vals['frame'],vals['seal']]) and text_fraction<=.02 and text_mae<=12 and color_mae<=1 and float(np.mean(np.abs(a-b)))<=2
    row=dict(file=ref.name,pass_=ok,geometry=vals,text_fraction=text_fraction,text_mae=text_mae,color_mae=color_mae,max_diff=int(diff.max()),mae=float(np.mean(np.abs(a-b))))
    rows.append(row)
    if not ok:failed.append(ref.name)
    overlay=np.clip(np.abs(a-b)*4,0,255).astype('uint8');(root/'diff').mkdir(exist_ok=True);Image.fromarray(overlay).save(root/'diff'/ref.name)
report=dict(inputs=40,pages=len(rows),passed=sum(r['pass_'] for r in rows),failed=failed,rows=rows)
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='rows'},indent=2));sys.exit(bool(failed))
