# image-parity (frozen fixtures)

D84: the web version and the JS oracles that produced these files are gone. What is left here is **frozen data only**; there is no script to run.

| Path | What it is | Who reads it |
|---|---|---|
| `reference/*.png` (46) + `reference-manifest.json` | the normal WebKit render of each input page, from the last time the web renderer existed | frozen record; not read by any current gate |
| `comparison/*.png` | two amplified diff examples | frozen record |
| `inputs.json` | the 40 inputs (46 pages) the renderer was exercised with | frozen record |
| `results.json`, `ui-results.json` | last comparison results | frozen record |

The geometry / selection fixtures that Swift tests consume live in `ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/` (consumed by `ImageParityTests.swift`); they are frozen the same way and are not regenerated.

The generators (`geometry.mjs`, `selection.mjs`, `make-inputs.mjs`, `reference.mjs`, `regions.mjs`, `check-reference.mjs`, `verify.sh`, `verify-ui.sh`, the raster `compare.py` / `layers.mjs` / `self-test.py`) were deleted in D84. To bring them back, look at the Git history before the D84 sweep.

If the native `ImageRenderer` output changes **on purpose**, update the affected Swift test expectations and say which decision changed them in the commit message; do not try to regenerate these PNGs.
