# Release License Checklist

This file records release gates, not legal advice. A project owner or qualified
reviewer must close every `BLOCKED` row before public App Store distribution.
The row states follow appendix A of `docs/legal/合规说明.md` (AI-drafted, not a
lawyer's opinion) as carried out by card C1 (decision D50, 2026-10-04). States:
`CLEARED` (obligations met), `CONDITIONAL` (release once the listed action is
done), `BLOCKED`, `REMOVED` (no longer shipped).

Paths and versions below match the v10 rebuild (`v10/integration`). Version,
SHA-256 and source details live in `THIRD_PARTY_NOTICES.md`; the full license
texts are files in `licenses/`, which ship in the app bundle (listed in
`scripts/shell-manifest.txt`) and are also shown in the in-app credits.

| Component | Repository evidence | Current state | Release action |
| --- | --- | --- | --- |
| Project-authored code and content | Root `LICENSE`: all rights reserved (owner decision D39, 2026-10-03), with an explicit exception for `data/` (per-file terms in `data/LICENSE.md`, A3) | CONDITIONAL | Confirm whether anyone other than the product owner contributed (written assignment if so; 合规说明 §1.17). |
| Preact 10.29.8 (`vendor/preact.module.js`, `vendor/preact-hooks.module.js`) | Official npm tarball ESM builds, tarball and file SHA-256 in `THIRD_PARTY_NOTICES.md`; mechanical import rewrite and source-map comment removal recorded; `node scripts/vendor_preact.mjs --check` verifies the bytes | CLEARED | Ship the notice and `licenses/preact-LICENSE.txt` (MIT). |
| htm 3.1.1 (`vendor/htm.module.js`) | Official npm tarball ESM build, unmodified, SHA-256 in `THIRD_PARTY_NOTICES.md`; checked by `vendor_preact.mjs --check` | CLEARED | Ship the notice and `licenses/htm-LICENSE.txt` (Apache-2.0). |
| `vendor/ui.js` | Project-authored re-export of the Preact, hooks and htm API | CLEARED | Covered by the project row (root `LICENSE`, D39). |
| Hanzi Writer 3.7.3 (`vendor/hanzi-writer.min.js`) | MIT notice and pinned SHA-256 in `THIRD_PARTY_NOTICES.md`; bytes unchanged since the move from the repository root | CLEARED | Ship the notice and `licenses/hanzi-writer-LICENSE.txt`. |
| ts-fsrs 5.2.0 / FSRS-6.0 (`vendor/fsrs6.min.js`) | MIT text (checked against the 5.2.0 npm package: Copyright (c) 2025 Open Spaced Repetition) and pinned SHA-256 in `THIRD_PARTY_NOTICES.md` | CLEARED | Ship the notice (MIT text is reproduced in full in `THIRD_PARTY_NOTICES.md` and the in-app credits). |
| ShiziKai (`fonts/ShiziKai-Regular.woff2`), a Modified Version of LXGW WenKai GB 1.522 | SIL OFL 1.1 text unmodified at `licenses/LXGW-WenKai-GB-OFL.txt`; subsetting and renaming recorded in `licenses/Shizi-fonts-COPYRIGHT-NOTICES.md`; upstream URLs and SHA-256 in `scripts/fonts/provenance/download-lock.json`; reproducible build in `scripts/fonts/` | CLEARED | Ship both files with the font. Keep the renamed family name; do not sell or offer the font on its own. |
| ShiziSerifSC (`fonts/ShiziSerifSC-Regular.woff2`, `fonts/ShiziSerifSC-Medium.woff2`), a Modified Version of Noto Serif SC 2.003 | SIL OFL 1.1 text unmodified at `licenses/Noto-Serif-SC-OFL.txt`; instancing, subsetting and renaming recorded in `licenses/Shizi-fonts-COPYRIGHT-NOTICES.md`; upstream commit and SHA-256 in `THIRD_PARTY_NOTICES.md` | CLEARED | Ship both files with the font; keep the renamed family name; the renaming must not imply upstream endorsement. |
| Arphic license file shipped in the bundle (A1) | `licenses/ARPHICPL.TXT` is a byte-identical copy of `sources/LICENSE-ARPHIC-PUBLIC.txt` and is in the shell manifest (`test/core/arphic-compliance.test.mjs`) | CLEARED | — |
| Hanzi Writer Data 2.0.1 baseline (6,854 records in `data/*.json`) | Unmodified (re-serialised only); APL file ships (A1); `data/LICENSE.md` states the APL terms per file (A3) and names the public place to get the data (A4: the `data/` folder of the public repository, one git tag per release); terms of use do not restrict these rights (A5, `docs/legal/使用条款.md` §4); user-facing credits text (A6) | CONDITIONAL | Before each release: create the release git tag and keep the repository (or a public data mirror) public. Product owner accepts in writing the residual App Store / APL §5 risk (合规说明 §1.6.5); the letter asking Arphic Technology for written confirmation is sent in parallel (D50 ②; the reply does not block release). Confirm the credits page on a device. |
| AnimCJK-derived supplement (363 records) | Upstream commit `ec5e17cc…`, APL; every modified file carries an in-file `_notice` (how and when it was changed, APL §2(a)), also listed in `audit/compliance-2026-10/arphic-modification-notices.json` (A2); NOTICES and the in-app credits now name AnimCJK (A6) | CONDITIONAL | Same release actions as the baseline row (tag, keep public, owner's risk acceptance, Arphic letter). |
| MOE stroke-order supplement (10 records: 嚭墘嫄尪屼崁帨踦雱龢) | Terms identified: CC BY-NC-ND 3.0 TW; incompatible with adaptation and app distribution | REMOVED | Removed on 2026-10-04 (D50 ①; `audit/compliance-2026-10/source-removal-76.*`). Re-adding requires a written grant from the MOE or a rebuild from an openly licensed font. |
| Font-outline extraction from STKaitiSC (7 records: 㧐圢庱珋衎觃𠙶; formerly part of "Human-generated supplement") | Outlines extracted from Apple's system font 华文楷体, whose license does not allow redistribution | REMOVED | Removed on 2026-10-04 (D50 ①). 1.x: rebuild from LXGW WenKai GB (合规说明 §1.8.2 R2). |
| Font-outline extraction from LXGW WenKai GB (1 record: 𬇕; formerly part of "Human-generated supplement") | OFL 1.1 outline, converted to stroke data; attributed in NOTICES (LXGW section) and `data/LICENSE.md`; OFL text ships | CLEARED | Do not sell the data on its own. |
| Stroke-order merged supplement (59 records from strokeorder.cc GIFs) | No open license for the source animations; 29 also contained HWD components | REMOVED | Removed on 2026-10-04 (D50 ①). 1.x: rebuild from an openly licensed font (R2). |
| Shuowen.org data (`data/etymology.json`) | Pinned upstream commit, modifications and Apache-2.0 notice in `THIRD_PARTY_NOTICES.md`; `licenses/Apache-2.0.txt` ships | CLEARED | — |
| OpenCC character mappings (`sources/opencc-*.txt`) | Pinned snapshot, Apache-2.0; used only while generating `data/etymology.json`, not shipped | CLEARED | None beyond keeping the notice. |
| Make Me a Hanzi metadata (79 etymology records; component grouping used to build the deck) | `data/LICENSE.md` and NOTICES state the 79 records are provided under LGPL-3.0-or-later; `licenses/LGPL-3.0.txt` and the GPL-3.0 text it incorporates (`licenses/GPL-3.0.txt`) ship (合规说明 §1.15 option (b); P199) | CONDITIONAL | Recommended before release or in 1.x: option (a), rewrite the 79 records (needs the shuowen clone to rerun `scripts/build_etymology.py`), then this row can be dropped. |
| Deck generation sources: jieba / pypinyin / hanziDB / wordfreq | NOTICES and the in-app credits list all four; `licenses/jieba-LICENSE.txt` and `licenses/pypinyin-LICENSE.txt` ship. wordfreq was **not** used for the shipped deck (the build environment cannot import it; `common` is the jieba-frequency digit count and the deck regenerates byte for byte), so its CC BY-SA 4.0 data terms do not attach | CONDITIONAL | Check the copyright lines of jieba's and hanziDB's upstream LICENSE files against the attributions (hanziDB: add its MIT text if required). If a later build enables wordfreq, re-review (CC BY-SA 4.0 attribution and share-alike for derived data). |

Since D50 ① the shipped supplement is 364 records (363 AnimCJK + 1 LXGW WenKai
GB), checked by `scripts/verify_vector_data_440.js`, `scripts/build_8105_chars.py`
and `scripts/verify_library_governance.py`; the 2026-08 technical evidence for
all 440 historical records stays in `audit/` unchanged. Technical or visual
approval does not grant copyright permission.

Issue #133 tracked exposing these notices inside the shipped app. In v10 this is
the about page (我的 → 关于 → 开源资料 · 致谢): `src/config/credits.js` is
generated from `THIRD_PARTY_NOTICES.md` and the referenced license files by
`pnpm run build:credits`, so every section above and its full license text ship
in the bundle. Before release, run `node scripts/build_credits.mjs --check` and
confirm on a device that the page lists every component; if a notice changes,
regenerate the credits in the same commit.

External actions still open (not code): the letter to Arphic Technology (D50 ②);
the product owner's written acceptance of the APL §5 residual risk; the release
git tag for the data; the privacy policy URL on GitHub Pages (D50 ④) and the
contact address (P21, D50 ⑧).
