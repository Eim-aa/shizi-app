# GF8105 Hanzi Writer supplement — minimal viable contribution

This directory is a deliberately small, independently verifiable contribution sample. It contains Hanzi Writer-compatible stroke data for three characters named in [Hanzi Writer Data issue #15](https://github.com/chanind/hanzi-writer-data/issues/15):

| Character | Code point | GF8105 level | Strokes |
| --- | --- | ---: | ---: |
| 抔 | U+6294 | 2 | 7 |
| 拃 | U+62C3 | 2 | 8 |
| 馃 | U+9983 | 2 | 11 |

The goal is to prove the contribution route with three low-risk records before expanding it. This is not the full 440-character Shizi supplement, and `package.json` intentionally keeps the package private until an upstream maintainer confirms the preferred integration path.

## What is new here

The underlying stroke outlines and medians already exist in AnimCJK. This contribution does not claim to have drawn them from scratch. Its added value is:

- selecting the Simplified Chinese records from AnimCJK's `graphicsZhHans.txt`;
- checking each record against the PRC GF8105 level-2 stroke count;
- converting the records to the exact `strokes` + `medians` JSON shape accepted by Hanzi Writer;
- freezing the source revision, the exact three upstream JSONL rows, and per-file hashes;
- running deterministic structure, SVG-path, median, hash, and render/animation checks;
- completing same-character human review before publication.

For these three records the conversion removes AnimCJK's `character` key and preserves `strokes` and `medians` semantically unchanged. JSON whitespace differs from the upstream JSONL records.

## Why this is not a direct Hanzi Writer Data PR yet

`chanind/hanzi-writer-data` reads both `vendor/makemeahanzi/dictionary.txt` and `vendor/makemeahanzi/graphics.txt`. Its parser uses dictionary data to derive `radStrokes`, then regenerates every `data/<character>.json` file and `data/all.json`. A PR that edits only generated JSON can be overwritten by the next rebuild and can leave `all.json` inconsistent.

These three MVE files are suitable for a Hanzi Writer custom loader and for technical review. Because they intentionally omit `radStrokes`, they are neither source records for the current Hanzi Writer Data pipeline nor complete generated-output changes. This MVE is therefore published as a reviewable package first, while asking maintainers whether they prefer:

1. a source-level Make Me a Hanzi contribution;
2. a separate Simplified Chinese extension package; or
3. generated files plus a new supplemental input in Hanzi Writer Data.

## Verify

Use Node.js 20 or newer. Install the exact development dependency and either install Playwright's Chromium build or point the gate at an existing Chromium/Chrome executable:

```bash
node scripts/verify.mjs
node --test scripts/verify.test.mjs
npm install
npx playwright install chromium
npm run verify:browser
```

If a compatible browser is already installed, skip the Playwright browser download and run:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run verify:browser
```

The verifier fails closed on frozen metadata drift; source-row, data-file, or runtime hash drift; extra files in `data/`; membership changes; duplicate characters; unexpected JSON keys; stroke-count mismatches; malformed SVG paths; invalid medians; non-finite coordinates; and internal-value leakage in the raw bytes of every declared public file, regardless of extension.

Expected result:

```text
PASS 3 characters, 26 strokes, … public files
PASS browser 3 characters, 26 strokes
```

## Use with Hanzi Writer

Each file can be returned directly from a custom `charDataLoader`:

```js
const data = await fetch('./data/抔.json').then((response) => response.json());

HanziWriter.create('target', '抔', {
  charDataLoader: () => data,
});
```

These MVE files intentionally omit `radStrokes`; `strokes` and `medians` are sufficient for rendering, animation, and quiz input.

For a visual check, serve this directory over HTTP and open [review.html](review.html). The page reads its character list and expected stroke counts from `manifest.json`. The automated browser gate intercepts the pinned CDN URL with the bundled Hanzi Writer 3.7.3 bytes, verifies their SHA-256 before launch, and never falls back to the network.

## Provenance and license

The records come from AnimCJK `graphicsZhHans.txt` at commit `ec5e17cca76c87587790bcbce5ea0b4d4fb753d6`. The exact three source rows are preserved in [provenance/graphicsZhHans.mve.jsonl](provenance/graphicsZhHans.mve.jsonl); the verifier proves that removing only `character` yields the packaged geometry. AnimCJK states that its Hanzi graphics may be redistributed and modified under the Arphic Public License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSE-ARPHIC.txt](LICENSE-ARPHIC.txt).

No App source, internal task identifiers, review transcripts, local paths, Chaifen data, or unrelated character data are included.

## Next gate

Do not scale this directory beyond the three-character MVE until the upstream integration question is answered. This MVE addresses only 3 of the 10 characters named in issue #15 and makes no claim that the remaining 7 are resolved. Do not close issue #15 based on this package.
