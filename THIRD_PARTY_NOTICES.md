# Third-Party Notices

## Hanzi Writer 3.7.3

`vendor/hanzi-writer.min.js` (moved from the repository root in v10 M0-1,
bytes unchanged) vendors the browser distribution of
[`chanind/hanzi-writer`](https://github.com/chanind/hanzi-writer) version
3.7.3.

Vendored SHA-256: `17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642`

Hanzi Writer is licensed under the MIT License, Copyright (c) 2014 David
Chanin. The complete notice is included at
`licenses/hanzi-writer-LICENSE.txt`.

## Preact 10.29.8 (core and hooks)

`vendor/preact.module.js` and `vendor/preact-hooks.module.js` are the ES module
builds of [`preactjs/preact`](https://github.com/preactjs/preact) version
10.29.8, taken from the official npm tarball by `scripts/vendor_preact.mjs`.

- Tarball: `https://registry.npmjs.org/preact/-/preact-10.29.8.tgz`
  (SHA-256 `b18cb0a457f3d43c7bb30391a74ade7d13e03bc6e77915e061c70c0fe1123299`,
  npm integrity `sha512-ej2aVZ+vZ8WO7tvlQWRM9N63A0KzF9q4mWJfDUHgYaIofWY9hu74QdnQrjoPMmZi2/nZ5gN0bJCQF49xQqx09Q==`)
- `package/dist/preact.module.js` (upstream SHA-256
  `c30e721ebfdc6e2ad4c18c14d2dfb82667829c8aec27de1207774e3fc16858a8`)
  → `vendor/preact.module.js`, vendored SHA-256
  `25a5df7e9f628a587743c4641a368737a3b218f28ef738ba0376a2d5bdfc948c`
- `package/hooks/dist/hooks.module.js` (upstream SHA-256
  `a6ee626f2d01570592dd569a792e3f050154aa02890eead8c223fa3ed5aa3d5a`)
  → `vendor/preact-hooks.module.js`, vendored SHA-256
  `9e7eff58e0ae604583461eba1344da69a6894eab575eb591c635cc0d3f9ec57d`
- Modifications (mechanical, applied by the script): the bare import
  `from"preact"` in the hooks build is rewritten to `from"./preact.module.js"`
  so browsers can resolve it without an import map or bundler; the trailing
  `//# sourceMappingURL=…` comment is removed from both files because source
  maps are not shipped.

Preact is licensed under the MIT License, Copyright (c) 2015-present Jason
Miller. The complete license text is included at `licenses/preact-LICENSE.txt`.

## htm 3.1.1

`vendor/htm.module.js` is the ES module build of
[`developit/htm`](https://github.com/developit/htm) version 3.1.1, taken from
the official npm tarball by `scripts/vendor_preact.mjs` without modification.

- Tarball: `https://registry.npmjs.org/htm/-/htm-3.1.1.tgz`
  (SHA-256 `2425b9bee11409177bcabc7f32e319926fc6690c1701c0b257c88bdff2d5ba90`,
  npm integrity `sha512-983Vyg8NwUE7JkZ6NmOqpCZ+sh1bKv2iYTlUkzlWmA5JD2acKoxd4KVxbMmxX/85mtfdnDmTFoNKcg5DGAvxNQ==`)
- `package/dist/htm.module.js` → `vendor/htm.module.js`, SHA-256
  `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4`
  (identical to upstream)

htm is licensed under the Apache License 2.0, Copyright 2018 Google Inc. The
complete license text is included at `licenses/htm-LICENSE.txt`.

`vendor/ui.js` is project code that re-exports the Preact, hooks and
`html = htm.bind(h)` API used by `src/`.

## Hanzi Writer Data 2.0.1

The stroke outlines and stroke-order lines for 6,854 characters are taken
unmodified from [`chanind/hanzi-writer-data`](https://github.com/chanind/hanzi-writer-data)
version 2.0.1. That project converted them from the Make Me a Hanzi project,
which extracted them from fonts made by Arphic Technology
(Copyright (C) 1999 Arphic Technology Co., Ltd.). They are distributed under
the Arphic Public License; the complete, unmodified license text is included
at `licenses/ARPHICPL.TXT`.

The app only draws these outlines and animates the stroke order; pictures you
export contain your own handwriting over a rendered reference image, not the
outline data. Shizi adds no restriction to the rights the Arphic Public
License gives you. The same stroke data, including the project's modified
records below, is freely available under that license from the `data/`
folder of the public repository https://github.com/Eim-aa/shizi-open (each App
release has a matching tag).

## AnimCJK

Stroke outlines and stroke-order lines for 363 further characters are derived
from [`parsimonhi/animCJK`](https://github.com/parsimonhi/animCJK) at commit
`ec5e17cca76c87587790bcbce5ea0b4d4fb753d6` (files graphicsZhHans.txt and
graphicsJa.txt). AnimCJK's Chinese character graphics are based on the Arphic
PL KaitiM fonts and are licensed under the Arphic Public License; the complete
license text is included at `licenses/ARPHICPL.TXT`.

Modifications by the Shizi project: each record was converted to the Hanzi
Writer format on 2026-07-29 by removing the source "character" key (outlines
and stroke-order lines unchanged), and imported on 2026-08-05; for 豨 two
stroke-order lines were exchanged (5 and 7), and for 镵 the three anchor
points of stroke 13 were reordered. Every modified file states how and when it
was changed in its own "_notice" field. The modified records are freely
available under the Arphic Public License from the `data/` folder of the
public repository https://github.com/Eim-aa/shizi-open (each App release has a
matching tag).

## Shuowen.org data

`data/etymology.json` contains modified and condensed records generated from
[`shuowenjiezi/shuowen`](https://github.com/shuowenjiezi/shuowen), pinned at
commit `6553a350763ce4feca2c5d1cc2cad7e594dc2975`.

The source is licensed under Apache License 2.0. The generated records were
converted to simplified display forms, shortened to at most 20 characters,
and 50 representative rows were manually edited and checked. A copy of the
license is included at `licenses/Apache-2.0.txt`.

## OpenCC character mappings

`sources/opencc-st-characters.txt` and `sources/opencc-ts-characters.txt` are
snapshots of `STCharacters.txt` and `TSCharacters.txt` from
[`BYVoid/OpenCC`](https://github.com/BYVoid/OpenCC), pinned at commit
`8a8ef3eb10e563ed013f27628e6a46a5f0ade7d8`. They are used only while
generating the character-origin data.

OpenCC is licensed under Apache License 2.0. A copy of the license is included
at `licenses/Apache-2.0.txt`.

## Make Me a Hanzi dictionary metadata

79 short character-origin notes in the app (marked "Make Me a Hanzi") are
condensed from the dictionary metadata of
[`skishore/makemeahanzi`](https://github.com/skishore/makemeahanzi). The
component grouping used for step-by-step hints was also computed from this
metadata when the question bank was built.

This metadata is licensed under the GNU LGPL version 3 or, at your option, any
later version. The condensed notes are provided under the same license; the
complete license texts are included at `licenses/LGPL-3.0.txt` and
`licenses/GPL-3.0.txt`.

## jieba dictionary

The context words shown with each character were chosen from the dictionary
of [`fxsjy/jieba`](https://github.com/fxsjy/jieba) 0.42.1 (word list and word
frequencies) when the question bank was built.

jieba is licensed under the MIT License, Copyright (c) 2013 Sun Junyi. The
complete license text is included at `licenses/jieba-LICENSE.txt`.

## pypinyin 0.55.0

The pinyin readings were generated with
[`mozillazg/python-pinyin`](https://github.com/mozillazg/python-pinyin) 0.55.0
when the question bank was built (readings that needed it were then corrected
by hand).

pypinyin is licensed under the MIT License, Copyright (c) 2016 mozillazg, 闲耘.
The complete license text is included at `licenses/pypinyin-LICENSE.txt`.

## hanziDB

The character frequency ranks were taken from
[`ruddfawcett/hanziDB.csv`](https://github.com/ruddfawcett/hanziDB.csv)
(MIT License, by Rudd Fawcett), which is based on Jun Da's Modern Chinese
Character Frequency List. Only the ranking is used.

## wordfreq

[`rspeer/wordfreq`](https://github.com/rspeer/wordfreq) is an optional
dependency of the question-bank builder. It was not used for the question
bank shipped in the app: no wordfreq data is included. (wordfreq's code is
licensed under the Apache License 2.0, and its word-frequency data under
CC BY-SA 4.0; using it in a later build would add an attribution and
share-alike requirement for the data derived from it.)

## ts-fsrs 5.2.0

`vendor/fsrs6.min.js` (moved from the repository root in v10 M0-1, bytes
unchanged) vendors the UMD distribution of
[`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) version 5.2.0.
The bundled library identifies its scheduler as `FSRS-6.0` and is used fully
offline.

Vendored SHA-256: `368942939646b0c58b6db89e3f92b036d2101e85a5194f07d7df6fdd5ed157f4`

MIT License

Copyright (c) 2025 Open Spaced Repetition

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## LXGW WenKai GB 1.522 (renamed ShiziKai)

`fonts/ShiziKai-Regular.woff2` is a Modified Version of
[`LXGW WenKai GB`](https://github.com/lxgw/LxgwWenkaiGB) version 1.522
(`LXGWWenKaiGB-Regular.ttf`, release tag commit
`44cb0573002712c7d5c96f1b2aeea4420153f790`, upstream SHA-256
`295568c131648062107543aa159c97dd49564be791136c2abf74cad83eba3f7f`). It was
subset to the characters the app displays and renamed ShiziKai (all family,
full, PostScript and typographic name records rebuilt), then compressed to
WOFF2. The subset is used as a web font inside the app only and is not offered
as an installable desktop font. It replaces the 4,264-byte LXGW WenKai 1.522
brand-glyph subset that the legacy (pre-v10) `index.html` embedded; the v10
shell no longer ships that subset.

Copyright 2022-2026 LXGW (https://github.com/lxgw/LxgwWenkaiGB)
Copyright 2020 The Klee Project Authors (https://github.com/fontworks-fonts/Klee)

The font is licensed under the SIL Open Font License 1.1. The complete,
unmodified license text is included at `licenses/LXGW-WenKai-GB-OFL.txt`. The
modifications and renaming are documented at
`licenses/Shizi-fonts-COPYRIGHT-NOTICES.md`; the build inputs and scripts are in
`scripts/fonts/`.

The stroke data for one character in the app, 𬇕, is also derived from the
LXGW WenKai GB outline (converted into strokes and stroke-order lines by the
Shizi project) and is provided under the same SIL Open Font License 1.1; it
is not sold on its own.

## Noto Serif SC 2.003 (renamed ShiziSerifSC)

`fonts/ShiziSerifSC-Regular.woff2` (weight 400) and
`fonts/ShiziSerifSC-Medium.woff2` (weight 500) are Modified Versions of
[`Noto Serif SC`](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoserifsc)
version 2.003 (`NotoSerifSC[wght].ttf` from google/fonts commit
`8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`, upstream SHA-256
`050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9`). The
variable font was instantiated at wght 400 and 500, subset to the characters
the app displays, renamed ShiziSerifSC, and compressed to WOFF2. The renaming
distinguishes this Modified Version and does not imply endorsement by the
upstream authors.

Copyright 2012 Google Inc. All Rights Reserved.
(c) 2017-2024 Adobe (http://www.adobe.com/).

The font is licensed under the SIL Open Font License 1.1. The complete,
unmodified license text is included at `licenses/Noto-Serif-SC-OFL.txt`. The
modifications and renaming are documented at
`licenses/Shizi-fonts-COPYRIGHT-NOTICES.md`.
