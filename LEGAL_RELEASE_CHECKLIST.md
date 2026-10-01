# Release License Checklist

This file records release gates, not legal advice. A project owner or qualified
reviewer must close every `BLOCKED` row before public App Store distribution.

Paths and versions below match the v10 rebuild (`v10/integration`). Version,
SHA-256 and source details live in `THIRD_PARTY_NOTICES.md`; full license texts
live in `licenses/` (shipped in the app bundle) and `sources/LICENSE-*`.

| Component | Repository evidence | Current state | Release action |
| --- | --- | --- | --- |
| Project-authored code and content | No root `LICENSE` has been selected | BLOCKED | Owner chooses the project license and confirms ownership/contributor permissions. |
| Preact 10.29.8 (`vendor/preact.module.js`, `vendor/preact-hooks.module.js`) | Official npm tarball ESM builds, tarball and file SHA-256 in `THIRD_PARTY_NOTICES.md`; mechanical import rewrite and source-map comment removal recorded; `node scripts/vendor_preact.mjs --check` verifies the bytes | RECORDED | Ship the notice and `licenses/preact-LICENSE.txt` (MIT). |
| htm 3.1.1 (`vendor/htm.module.js`) | Official npm tarball ESM build, unmodified, SHA-256 in `THIRD_PARTY_NOTICES.md`; checked by `vendor_preact.mjs --check` | RECORDED | Ship the notice and `licenses/htm-LICENSE.txt` (Apache-2.0). |
| `vendor/ui.js` | Project-authored re-export of the Preact, hooks and htm API | Covered by the project row | Licensed with the project once the root `LICENSE` is chosen. |
| Hanzi Writer 3.7.3 (`vendor/hanzi-writer.min.js`) | MIT notice and pinned SHA-256 in `THIRD_PARTY_NOTICES.md`; bytes unchanged since the move from the repository root | RECORDED | Ship the notice and `sources/LICENSE-MIT-HANZI-WRITER.txt`. |
| ts-fsrs 5.2.0 / FSRS-6.0 (`vendor/fsrs6.min.js`) | MIT text and pinned SHA-256 in `THIRD_PARTY_NOTICES.md`; bytes unchanged since the move from the repository root | RECORDED | Ship the notice (MIT text is reproduced in full in `THIRD_PARTY_NOTICES.md` and the in-app credits). |
| ShiziKai (`fonts/ShiziKai-Regular.woff2`), a Modified Version of LXGW WenKai GB 1.522 | SIL OFL 1.1 text unmodified at `licenses/LXGW-WenKai-GB-OFL.txt`; subsetting and renaming recorded in `licenses/Shizi-fonts-COPYRIGHT-NOTICES.md`; upstream URLs and SHA-256 in `scripts/fonts/provenance/download-lock.json`; reproducible build in `scripts/fonts/` | RECORDED | Ship both files with the font. Keep the renamed family name (the v1.522 OFL lists no Reserved Font Name, but the font is renamed regardless); do not sell or offer the font on its own. |
| ShiziSerifSC (`fonts/ShiziSerifSC-Regular.woff2`, `fonts/ShiziSerifSC-Medium.woff2`), a Modified Version of Noto Serif SC 2.003 | SIL OFL 1.1 text unmodified at `licenses/Noto-Serif-SC-OFL.txt`; instancing, subsetting and renaming recorded in `licenses/Shizi-fonts-COPYRIGHT-NOTICES.md`; upstream commit and SHA-256 in `THIRD_PARTY_NOTICES.md` | RECORDED | Ship both files with the font; keep the renamed family name; the renaming must not imply upstream endorsement. |
| Hanzi Writer Data 2.0.1 baseline (6,854 records in `data/*.json`) | Upstream identifies Arphic-derived data | RECORDED, COMPLIANCE REVIEW REQUIRED | Ship the unmodified Arphic license (`sources/LICENSE-ARPHIC-PUBLIC.txt`); confirm modified-data notice/source-availability obligations. |
| AnimCJK-derived supplement (363 records) | Exact upstream commit and transformations are in the vector audit (`audit/vector-data-460-manifest.json`); upstream classifies Hanzi graphics under Arphic Public License | RECORDED, COMPLIANCE REVIEW REQUIRED | Confirm the transformed JSON is distributed under the required terms with its modifications available. |
| MOE/stroke-order supplement (10 records) | Source pages and hashes exist, but the repository contains no captured redistribution terms | BLOCKED | Obtain and archive applicable terms or written authorization. |
| Human-generated supplement (8 records) | Technical and human acceptance exists, but authorship/rights grants are not recorded | BLOCKED | Record authors and an explicit redistribution grant. |
| Stroke-order merged supplement (59 records) | Technical provenance records transformations, but does not establish a reusable upstream license | BLOCKED | Trace each source payload and archive its applicable redistribution terms. |
| Shuowen.org data (`data/etymology.json`) | Pinned upstream commit, modifications and Apache-2.0 notice in `THIRD_PARTY_NOTICES.md` | RECORDED | Ship the notice and `sources/LICENSE-APACHE-2.0.txt`. |
| OpenCC character mappings (`sources/opencc-*.txt`) | Pinned snapshot, Apache-2.0; used only while generating `data/etymology.json`, not shipped | RECORDED | None beyond keeping the notice. |
| Make Me a Hanzi metadata | LGPL-3.0-or-later notice is present | COMPLIANCE REVIEW REQUIRED | Confirm the modified data/source offer and App distribution obligations. |

The 440 supplemental records must not be described as commercially cleared
until the four supplement rows above are closed. Technical or visual approval
does not grant copyright permission.

Issue #133 tracked exposing these notices inside the shipped app. In v10 this is
the about page (我的 → 关于 → 开源资料 · 致谢): `src/config/credits.js` is
generated from `THIRD_PARTY_NOTICES.md` and the referenced license files
(including `sources/LICENSE-*`) by `pnpm run build:credits`, so every section
above and its full license text ship in the bundle. Before release, run
`node scripts/build_credits.mjs --check` and confirm on a device that the page
lists every component; if a notice changes, regenerate the credits in the same
commit.
