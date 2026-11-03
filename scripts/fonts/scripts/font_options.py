"""The exact production subset options, shared with the bounded GPOS diagnostic."""
from fontTools import subset


def subset_options():
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.name_legacy = True
    opts.notdef_glyph = True
    opts.notdef_outline = True
    opts.recommended_glyphs = True
    opts.glyph_names = True
    opts.recalc_timestamp = False
    return opts
