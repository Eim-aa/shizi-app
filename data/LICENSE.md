# Licenses of the files in `data/`

The files in this folder are **not** covered by the root `LICENSE` ("All
rights reserved"). Each file keeps the license of the work it comes from, as
listed below. Shizi adds no further restriction to the rights these licenses
give you; the App Store terms and Shizi's own terms of use do not limit them
either.

## Stroke data: `data/<character>.json`

| Files | Source | License | Modified? |
|---|---|---|---|
| 6,854 files (every stroke file not listed below) | [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 2.0.1, converted from Make Me a Hanzi, derived from fonts by Arphic Technology (Copyright (C) 1999 Arphic Technology Co., Ltd.) | Arphic Public License — `licenses/ARPHICPL.TXT` | No (JSON re-serialised only; keys and values unchanged) |
| 363 files whose first key is `"_notice"` | [AnimCJK](https://github.com/parsimonhi/animCJK) commit `ec5e17cca76c87587790bcbce5ea0b4d4fb753d6`, graphics based on Arphic PL KaitiM | Arphic Public License — `licenses/ARPHICPL.TXT` | **Yes** — each file's `_notice` field states how and when it was changed; the same list is in `audit/compliance-2026-10/arphic-modification-notices.json` |
| `data/𬇕.json` | Outline derived from [LXGW WenKai GB](https://github.com/lxgw/LxgwWenkaiGB) 1.522 (Copyright 2022-2026 LXGW; Copyright 2020 The Klee Project Authors), split into strokes by hand with the Make Me a Hanzi tooling | SIL Open Font License 1.1 — `licenses/LXGW-WenKai-GB-OFL.txt` | Yes (outline converted to stroke data); not sold on its own |

Under the Arphic Public License §2, modified files are made freely available
to everyone under the same license: the `data/` folder of the public
repository https://github.com/Eim-aa/shizi-open is that place, and each App
release has a matching git tag there so the exact files of a release stay
available.

76 records from sources without a redistribution basis (strokeorder.cc,
Taiwan MOE stroke-order site, STKaiti outlines) were removed on 2026-10-04
(decision D50; `audit/compliance-2026-10/`).

## Character origins: `data/etymology.json`

- Records with `"source": "《说文解字》"` are condensed from
  [shuowenjiezi/shuowen](https://github.com/shuowenjiezi/shuowen) (Shuowen.org,
  Apache License 2.0 — `licenses/Apache-2.0.txt`), converted to simplified
  forms, shortened, and partly edited by hand.
- Records with `"source": "Make Me a Hanzi"` (79 records) are condensed from the
  [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) dictionary
  metadata and are provided under the GNU LGPL version 3 or (at your option)
  any later version — `licenses/LGPL-3.0.txt`, which incorporates
  `licenses/GPL-3.0.txt`. This file is itself the preferred form for
  modifying these records.

## Context-word overrides: `data/context-overrides.js`

Project-authored content (reviewed context words, readings and hints); covered
by the root `LICENSE`.
