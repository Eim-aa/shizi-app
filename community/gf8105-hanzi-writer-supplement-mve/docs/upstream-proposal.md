# Upstream proposal draft

Target: [chanind/hanzi-writer-data issue #15](https://github.com/chanind/hanzi-writer-data/issues/15)

## Proposed comment

This is a partial 3-of-10 exploratory response. It does not resolve the other seven characters, and we are not asking to close issue #15. The three included records come from AnimCJK's Simplified Chinese data at commit `ec5e17cca76c87587790bcbce5ea0b4d4fb753d6`, then underwent PRC stroke-count checks, SVG parsing, Hanzi Writer render/animation checks, and same-character human review.

To keep the first contribution small, we prepared a three-character MVE for 抔, 拃, and 馃 (26 strokes total). All three are semantically unchanged `graphicsZhHans.txt` records selected for the Simplified Chinese form, apart from removing the source `character` key and serializing individual JSON files.

Before opening a data PR, could you confirm the preferred source-of-truth path? The current repository generates `data/*.json` and `data/all.json` from `vendor/makemeahanzi`, so editing only generated JSON would be overwritten. We can adapt the contribution as one of:

1. a Make Me a Hanzi source-data change;
2. a separate Simplified Chinese extension package; or
3. a supplemental input plus regenerated Hanzi Writer Data outputs.

The MVE includes per-file hashes, source lines, an Arphic Public License notice, and a fail-closed verifier. After you confirm the route, we will prepare a route-appropriate source-level change scoped to these three characters; we will not open a generated-JSON-only PR.
