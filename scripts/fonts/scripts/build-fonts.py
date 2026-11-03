#!/usr/bin/env python3
from pathlib import Path
import json,hashlib,unicodedata as U,platform
from fontTools.ttLib import TTFont
from fontTools import subset,__version__
from fontTools.varLib.instancer import instantiateVariableFont
from font_options import subset_options
ROOT=Path(__file__).resolve().parents[1]
def sha(b):return hashlib.sha256(b).hexdigest()
def dump(p,o): (ROOT/p).write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n')
def units(path):return {int(s[2:],16) for s in (ROOT/path).read_text().strip().split(',')}
def features(f,t):return sorted({r.FeatureTag for r in f[t].table.FeatureList.FeatureRecord}) if t in f and f[t].table.FeatureList else []
def record(path):
 b=path.read_bytes();return dict(path=str(path.relative_to(ROOT)),bytes=len(b),KiB=round(len(b)/1024,3),MiB=round(len(b)/1048576,6),sha256=sha(b))
lock=json.loads((ROOT/'upstream/download-lock.json').read_text())
for row in lock:assert sha((ROOT/row['path']).read_bytes())==row['sha256'],row['path']
coverage={};manifest=[];names={};sourceinfo={};runtime={}
for file,style,weight,corpus in [('LXGWWenKaiGB-Regular.ttf','Regular',400,'kai'),('NotoSerifSC-wght.ttf','Regular',400,'serif'),('NotoSerifSC-wght.ttf','Medium',500,'serif')]:
 src=ROOT/'upstream'/file;f=TTFont(src,recalcTimestamp=False); family='ShiziKai' if corpus=='kai' else 'ShiziSerifSC'; stem=f'{family}-{style}';required=units(f'corpus/{corpus}-unicodes.txt');srcmap=f.getBestCmap();original_names=[dict(id=n.nameID,platform=n.platformID,encoding=n.platEncID,language=n.langID,text=n.toUnicode()) for n in f['name'].names]
 sourceinfo[file]=dict(**record(src),cmap_count=len(srcmap),names=original_names,GSUB=features(f,'GSUB'),GPOS=features(f,'GPOS'),axes=[dict(tag=a.axisTag,min=a.minValue,default=a.defaultValue,max=a.maxValue) for a in f['fvar'].axes] if 'fvar' in f else [])
 missing=sorted(required-set(srcmap));coverage[stem]=dict(required=len(required),source_missing=[dict(cp=f'U+{c:04X}',char=chr(c),name=U.name(chr(c),'UNKNOWN')) for c in missing])
 if 'fvar' in f:
  # Subset first, then fully instantiate. This retains shaping closure while making the instancer faster.
  pass
 opts=subset_options()
 sub=subset.Subsetter(options=opts);sub.populate(unicodes=required);sub.subset(f)
 if 'fvar' in f:f=instantiateVariableFont(f,{'wght':weight},inplace=True,optimize=True)
 # Remove all source-facing family/full/PS/typographic/compatible/WWS/variation names,
 # including localized records. Copyright/license/designer/manufacturer remain verbatim.
 ids={1,2,3,4,6,16,17,18,20,21,22,25}
 f['name'].names=[n for n in f['name'].names if n.nameID not in ids]
 mapping={1:family if weight==400 else family+' Medium',2:'Regular',3:f'F8-20260926;{stem};{sha(src.read_bytes())[:12]}',4:family+' '+style,6:stem,16:family,17:style,18:family+' '+style,21:family,22:style}
 # Conventional legacy Windows 500 face uses its own family with Regular subfamily; typographic family links 400/500.
 for nid,value in mapping.items():
  for plat,enc,lang in [(3,1,0x409),(0,4,0)]:f['name'].setName(value,nid,plat,enc,lang)
 if 'STAT' in f:del f['STAT'] # all axes fully instantiated; no stale ExtraLight/variable instance identity
 f['OS/2'].usWeightClass=weight
 f['OS/2'].fsSelection &= ~((1<<0)|(1<<5)|(1<<6));f['OS/2'].fsSelection |= (1<<6)
 f['head'].macStyle &= ~3
 # A fixed modified timestamp ensures repeated builds have identical bytes.
 f['head'].modified=3873225600
 for ext in ['ttf','woff2']:
  f.flavor='woff2' if ext=='woff2' else None;dest=ROOT/'assets'/f'{stem}.{ext}';f.save(dest,reorderTables=True)
  check=TTFont(dest);cmap=check.getBestCmap();miss=sorted(required-set(cmap));assert miss==missing,'subset dropped a supported character'
  for n in check['name'].names:
   if n.nameID in ids:assert not any(x.lower() in n.toUnicode().lower() for x in ['WenKai','霞鹜','Klee','Noto','ExtraLight'])
  # Preserve copyright and license records byte-for-byte semantically.
  for nid in [0,13,14]:assert {n.toUnicode() for n in check['name'].names if n.nameID==nid}=={n['text'] for n in original_names if n['id']==nid}
  manifest.append(dict(**record(dest),family=family,weight=weight,glyphs=check['maxp'].numGlyphs,cmap_count=len(cmap),GSUB=features(check,'GSUB'),GPOS=features(check,'GPOS')))
  names[dest.name]=[dict(id=n.nameID,platform=n.platformID,encoding=n.platEncID,language=n.langID,text=n.toUnicode()) for n in check['name'].names]
 coverage[stem].update(supported=len(required)-len(missing),missing=coverage[stem]['source_missing'],GSUB=features(f,'GSUB'),GPOS=features(f,'GPOS'))
 runtime[family+':'+str(weight)]={'file':f'assets/{stem}.woff2','codepoints':sorted(f.getBestCmap()),'missing':coverage[stem]['missing']}
 print(stem,'required',len(required),'missing',len(missing),coverage[stem]['missing'],flush=True)
dump('reports/coverage.json',coverage);dump('corpus/coverage-manifest.json',runtime);dump('reports/names.json',names);dump('reports/source-fonts.json',sourceinfo)
dump('reports/build-manifest.json',dict(fonttools=__version__,python=platform.python_version(),files=manifest,totals={ext:sum(r['bytes'] for r in manifest if r['path'].endswith('.'+ext)) for ext in ['ttf','woff2']}))
css='/* Modified OFL fonts. Distribute both original OFL files and COPYRIGHT-NOTICES.md. */\n'
for family,style,weight in [('ShiziKai','Regular',400),('ShiziSerifSC','Regular',400),('ShiziSerifSC','Medium',500)]:
 css+=f'@font-face {{ font-family: "{family}"; src: url("./{family}-{style}.woff2") format("woff2"); font-style: normal; font-weight: {weight}; font-display: block; }}\n'
(ROOT/'assets/fonts.css').write_text(css)
