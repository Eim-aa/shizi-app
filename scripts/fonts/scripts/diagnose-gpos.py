#!/usr/bin/env python3
"""Bounded source/static/subset GPOS trace; writes new r2 evidence only.
No delivered font, helper, corpus, or historical browser evidence is changed.
"""
from pathlib import Path
from io import BytesIO
from collections import Counter
from copy import deepcopy
from types import SimpleNamespace
import hashlib
import inspect
import json
import unicodedata
from fontTools import subset, __version__
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables
from fontTools.unicodedata import script
from fontTools.varLib.instancer import instantiateVariableFont
import uharfbuzz as hb
from font_options import subset_options

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/gpos-diagnosis-r2.json'
sha = lambda b: hashlib.sha256(b).hexdigest()
record = lambda p: dict(path=str(p.relative_to(ROOT)), bytes=p.stat().st_size, sha256=sha(p.read_bytes()))
required = {int(x[2:], 16) for x in (ROOT/'corpus/serif-unicodes.txt').read_text().strip().split(',')}
source = ROOT/'upstream/NotoSerifSC-wght.ttf'
lock = next(x for x in json.loads((ROOT/'upstream/download-lock.json').read_text()) if x['path'] == str(source.relative_to(ROOT)))
assert sha(source.read_bytes()) == lock['sha256']
original = TTFont(source, recalcTimestamp=False)
reverse = {}
for cp, glyph in original.getBestCmap().items():
    reverse.setdefault(glyph, []).append(cp)

def glyph_record(glyph):
    cps = reverse.get(glyph, [])
    return dict(glyph=glyph, codepoints=[f'U+{cp:04X}' for cp in cps],
                unicode_names=[unicodedata.name(chr(cp), 'UNKNOWN') for cp in cps],
                unicode_scripts=sorted({script(chr(cp)) for cp in cps}),
                note='GSUB hist: uni3127 -> glyph01434; vert/vrt2 reverses it' if glyph=='glyph01434' else None)

def coverage(glyphs, retained):
    keep = [g for g in glyphs if g in retained]
    gone = [g for g in glyphs if g not in retained]
    return dict(source_count=len(glyphs), retained_count=len(keep), removed_count=len(gone),
                retained=[glyph_record(g) for g in keep], removed=[glyph_record(g) for g in gone])

def snapshot(font):
    result = {}
    for tag in ['GPOS','GSUB']:
        table = font[tag].table
        features = table.FeatureList.FeatureRecord
        scripts = []
        for sr in table.ScriptList.ScriptRecord:
            languages = [('default', sr.Script.DefaultLangSys)] + [(x.LangSysTag, x.LangSys) for x in sr.Script.LangSysRecord]
            scripts.append(dict(tag=sr.ScriptTag, languages=[dict(tag=name,
                feature_tags=[features[i].FeatureTag for i in ls.FeatureIndex],
                mark_feature_indices=[i for i in ls.FeatureIndex if features[i].FeatureTag=='mark']) for name, ls in languages if ls]))
        result[tag] = dict(lookup_count=table.LookupList.LookupCount,
                          feature_record_count=len(features),
                          feature_tags=sorted({x.FeatureTag for x in features}), scripts=scripts,
                          tracked_features=[dict(index=i, tag=x.FeatureTag, lookup_indices=x.Feature.LookupListIndex)
                                            for i,x in enumerate(features) if x.FeatureTag in ['mark','vert','vrt2']])
    return result

def trace_lookups(font, glyphs):
    table = font['GPOS'].table
    tracked = {i for fr in table.FeatureList.FeatureRecord if fr.FeatureTag in ['mark','vert'] for i in fr.Feature.LookupListIndex}
    result = []
    for i in sorted(tracked):
        lookup = table.LookupList.Lookup[i]
        for j, st in enumerate(lookup.SubTable):
            before = deepcopy(st)
            coverages = {k: coverage(v.glyphs, glyphs) for k,v in st.__dict__.items() if 'Coverage' in k}
            survived = before.subset_glyphs(SimpleNamespace(glyphs=glyphs))
            result.append(dict(lookup_index=i, lookup_type=lookup.LookupType, subtable_index=j,
                class_name=st.__class__.__name__, feature_tags=sorted({fr.FeatureTag for fr in table.FeatureList.FeatureRecord if i in fr.Feature.LookupListIndex}),
                coverage=coverages, actual_fonttools_subtable_return=bool(survived),
                mark_records_after_call=getattr(getattr(before,'MarkArray',None),'MarkCount',None),
                reason='No retained base glyph intersects BaseCoverage; MarkBasePos returns False before remapping bases.' if hasattr(st,'BaseCoverage') and not set(st.BaseCoverage.glyphs)&glyphs else 'No retained coverage glyph.' if not survived else 'Retained'))
    return result

class TracedSubsetter(subset.Subsetter):
    def _prune_pre_subset(self, font):
        super()._prune_pre_subset(font)
        self.after_pre = snapshot(font)
    def _closure_glyphs(self, font):
        super()._closure_glyphs(font)
        self.closed_glyphs = set(self.glyphs_gsubed)
        self.lookup_trace = trace_lookups(font, self.closed_glyphs)
    def _subset_glyphs(self, font):
        super()._subset_glyphs(font)
        self.after_subset = snapshot(font)
    def _prune_post_subset(self, font):
        super()._prune_post_subset(font)
        self.after_post = snapshot(font)

# Pin implementation evidence to the installed, version-locked fontTools source.
sourcefile = Path(inspect.getsourcefile(subset))
methods = [(otTables.MarkBasePos, 'subset_glyphs'), (otTables.Lookup,'subset_glyphs'),
           (otTables.LookupList,'subset_glyphs'), (type(original['GPOS']),'subset_glyphs'),
           (type(original['GPOS']),'subset_lookups'), (type(original['GPOS']),'prune_post_subset')]
implementation = []
for cls,name in methods:
    lines, lineno = inspect.getsourcelines(getattr(cls,name))
    implementation.append(dict(method=cls.__name__+'.'+name, line=lineno, source=''.join(lines)))

result = dict(version='F8-2026-09-26-r2', status='PASS_BOUNDED_EXPLANATION_NO_BINARY_REPAIR',
              scope='Locked Serif source and requested corpus only; no new visual/browser/device acceptance.',
              source=record(source), corpus=record(ROOT/'corpus/serif-unicodes.txt'),
              fonttools=__version__, harfbuzz=hb.version_string(),
              fonttools_subset_source=dict(path='fontTools/subset/__init__.py', sha256=sha(sourcefile.read_bytes()), methods=implementation),
              options={k:getattr(subset_options(), k) for k in ['layout_features','layout_scripts','layout_closure','name_IDs','name_languages','name_legacy','notdef_glyph','notdef_outline','recommended_glyphs','glyph_names','recalc_timestamp']},
              source_layout=snapshot(original), weights={})

# Verify the non-cmap Bopomofo alternate's origin in the locked source.
assert original['GSUB'].table.LookupList.Lookup[3].SubTable[0].mapping['uni3127']=='glyph01434'
assert original['GSUB'].table.LookupList.Lookup[12].SubTable[0].mapping['glyph01434']=='uni3127'

# One actual variable subset trace; the production build then instantiates this at both weights.
variable = TTFont(source, recalcTimestamp=False)
tracer = TracedSubsetter(options=subset_options())
tracer.populate(unicodes=required)
tracer.subset(variable)
result['production_pipeline'] = dict(order='subset variable source with production options, then fully instantiate wght=400/500',
    requested_codepoints=len(required), supported_requested_codepoints=len(required & set(original.getBestCmap())),
    glyphs_after_gsub_closure=len(tracer.closed_glyphs), after_prune_pre=tracer.after_pre,
    lookup_pruning=tracer.lookup_trace, after_subset_glyphs=tracer.after_subset, after_prune_post=tracer.after_post)

def hb_font(tt):
    buffer=BytesIO(); tt.save(buffer, reorderTables=True); data=buffer.getvalue()
    f=hb.Font(hb.Face(data)); f.scale=(1000,1000)
    return data,f

def shape(tt, f, text, mark):
    b=hb.Buffer();b.add_str(text);b.guess_segment_properties();b.language='zh-Hans'
    hb.shape(f,b,{'mark':mark})
    return [dict(glyph=tt.getGlyphName(i.codepoint),x_advance=p.x_advance,y_advance=p.y_advance,x_offset=p.x_offset,y_offset=p.y_offset)
            for i,p in zip(b.glyph_infos,b.glyph_positions)]

for weight, style in [(400,'Regular'),(500,'Medium')]:
    print('Tracing full static source',weight,flush=True)
    static = instantiateVariableFont(TTFont(source,recalcTimestamp=False), {'wght':weight}, inplace=True,optimize=True)
    static_layout = snapshot(static)
    static_traces = trace_lookups(static, tracer.closed_glyphs)
    data,sf = hb_font(static)
    delivered_path=ROOT/f'assets/ShiziSerifSC-{style}.ttf'
    delivered=TTFont(delivered_path,recalcTimestamp=False)
    _,df=hb_font(delivered)
    actual=instantiateVariableFont(deepcopy(variable), {'wght':weight}, inplace=True,optimize=True)
    equality={tag:actual[tag].compile(actual)==delivered[tag].compile(delivered) for tag in ['GPOS','GSUB','GDEF']}
    assert all(equality.values()), equality
    assert 'mark' not in snapshot(actual)['GPOS']['feature_tags']
    # Static-first control confirms disappearance is subsetting, not static instantiation.
    control = TracedSubsetter(options=subset_options());control.populate(unicodes=required);control.subset(static)
    assert control.lookup_trace == tracer.lookup_trace
    probes={}
    for label, text in [('double_tone_nfc','ê̌'),('double_tone_nfd',unicodedata.normalize('NFD','ê̌'))]:
        probes[label]=dict(text=text,full_source_mark_on=shape(TTFont(BytesIO(data)),sf,text,True),
                          full_source_mark_off=shape(TTFont(BytesIO(data)),sf,text,False),
                          delivered_mark_on=shape(delivered,df,text,True),delivered_mark_off=shape(delivered,df,text,False))
        values=[v for k,v in probes[label].items() if k!='text'];assert all(v==values[0] for v in values)
    result['weights'][str(weight)] = dict(full_static_source=dict(bytes=len(data),sha256=sha(data),stored=False,layout=static_layout,lookup_pruning=static_traces),
        production_after_instantiation=snapshot(actual),production_layout_binary_equals_delivered=equality,
        static_first_control=dict(after_subset=control.after_subset,after_post=control.after_post,lookup_pruning_equals_production=True),
        delivered=record(delivered_path),bounded_double_tone_probe=probes)

# Counts are glyph counts; a glyph without cmap is reported separately, never fabricated as a Unicode character.
marktraces=[r for r in tracer.lookup_trace if 'mark' in r['feature_tags']]
baseglyphs={g['glyph'] for r in marktraces for g in r['coverage']['BaseCoverage']['removed']}
marks={g['glyph'] for r in marktraces for status in ['retained','removed'] for g in r['coverage']['MarkCoverage'][status]}
result['summary']=dict(unique_mark_base_glyphs=len(baseglyphs),retained_mark_base_glyphs=0,
    removed_bases_with_bopomofo_cmap=sum(bool(reverse.get(g)) and all(script(chr(cp))=='Bopo' for cp in reverse[g]) for g in baseglyphs),
    removed_bases_without_cmap=[glyph_record(g) for g in sorted(baseglyphs) if not reverse.get(g)],
    unique_mark_glyphs=len(marks),retained_mark_glyphs=[glyph_record(g) for g in sorted(marks & tracer.closed_glyphs)],
    removed_mark_glyphs=[glyph_record(g) for g in sorted(marks-tracer.closed_glyphs)],
    source_gpos_script_tags=[s['tag'] for s in result['source_layout']['GPOS']['scripts']],
    subset_gpos_script_tags=[s['tag'] for s in tracer.after_post['GPOS']['scripts']],
    source_mark_feature_records=sum(x['tag']=='mark' for x in result['source_layout']['GPOS']['tracked_features']),
    subset_mark_feature_records=sum(x['tag']=='mark' for x in tracer.after_post['GPOS']['tracked_features']),
    latin_base_mappings_in_source_mark=sum(any(script(chr(cp))=='Latn' for cp in reverse.get(g,[])) for g in baseglyphs),
    conclusion='GPOS mark loses all Bopomofo bases under the locked Serif corpus. Retained grave/acute/caron glyphs alone do not make a usable mark-to-base lookup. Empty lookups/features are correctly pruned. No requested base+mark mapping was removed; ê̌ has no source Latin-base mark anchor to restore. GSUB vert/vrt2 survives independently.')
assert result['summary']['latin_base_mappings_in_source_mark']==0
assert result['summary']['unique_mark_base_glyphs']==48
assert result['summary']['removed_bases_with_bopomofo_cmap']==47
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('Wrote', OUT, flush=True)
