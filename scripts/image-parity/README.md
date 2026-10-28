# B4.6 image equivalence

Run from the worktree root:

```sh
pnpm exec playwright install webkit   # first use
bash scripts/image-parity/verify.sh
```

Requires macOS/Xcode, pnpm and Python `Pillow` + `numpy`. No iOS simulator is used.
`ImageRenderer` is the same Swift Package product linked into Shizi.app; the CLI
loads the repo's `fonts/` and `data/` instead of the app's copied `Web/` directory.

`inputs.json` fixes 40 inputs, producing 46 pages. It covers work and monthly sheet
layouts, portrait/square, 1/3/7/25/80 cells, partial final rows, missing ink,
wrong-member dots, date tags and single-day tag suppression, single glyph (including
a single point), annual cover/tail, unavailable outline, long-image row/month splits
at three height limits, and a reduced preview scale. `make-inputs.mjs` regenerates
this file deterministically. `reference/` contains the normal WebKit PNGs (4.25 MB);
`reference-manifest.json` records hashes. Mask-only diagnostics are generated on demand.

Geometry is checked independently of fonts:

* `geometry.mjs`: 2,486 exact field comparisons against real JS layout, glyph layout,
  pagination and date-tag functions (all 0–80 cell counts, both aspect ratios;
  sheet grids through 160 cells; pagination through 250 cells).
* `selection.mjs`: 1,500 exact plan/work comparisons against real JS, with paper,
  correct/wrong/added, skipped, answer-seen, missing ink, empty periods, folded
  months, first/last selection and ended/live slot lookup.
* Swift XCTest also consumes 324 JS-generated geometry and 50 selection/work
  fixtures. Regenerate with each script's `--fixtures` option.
* Raster diagnostics render each input again with only grid/frame, seal, or ink
  visible. Both engines receive the same palette overrides. This prevents text
  antialiasing from being misclassified as geometry. Frame/seal coordinates are
  exact; masks require IoU ≥ .995, symmetric 1px coverage ≥ .995 and area error ≤ 2%.
  `GEOMETRY-CG-WEBKIT-AA`: the 1px raster edge allowance covers CoreGraphics/WebKit
  coverage rounding, including thin lines at reduced scale. The mask cutoff is
  20% coverage for frame/seal, avoiding unstable 50%-covered half-pixel lines.
* Ink uses NP-22's luminance silhouette convention: 50% coverage, IoU ≥ .8,
  symmetric 1px coverage ≥ .97 and area error ≤ 10%. This includes reference outlines
  and unavailable-outline font fallback. No translation or rescaling is fitted.
* `TEXT-CT-WEBKIT`: CoreText/WebKit font rasterization and per-character advance
  differences are confined to named text rectangles from reference geometry.
  Pixels differing by >24 may occupy at most 2% of the full canvas, and the mean
  absolute RGB difference within text rectangles must be ≤ 12/255. Text rectangles
  never change the independent geometry masks. Every pixel is included in the
  full-image absolute-difference report and amplified diff PNG. Full-image mean RGB error must be ≤ 2/255; solid ink interiors must match within 1/255 mean RGB error, so palette mistakes cannot hide behind diagnostic layers.

Outputs: `artifacts/image-parity/report.json`, normal/layered PNGs, and amplified
`diff/` images. A missing PNG/layer or wrong image dimension fails the run.

The iOS switch is `WebEngine.raw`: `image.render` and `image.save` obtain a
serializable `image.spec`, render via CoreGraphics/CoreText, and keep the existing
save bridge (`image.persist`) and permission/error behavior. `webRenderer: true`
explicitly invokes retained JS canvas rendering. Missing/unsupported native specs
or raster errors also fall back to JS. Job selection and localized text remain in
the current session/UI job builder until B4.5; equivalent Swift selection and
pagination are available in `ImageSelection` and `ImageLayout` for that migration.
Export paper intentionally has no texture, matching current D51 §6 `palette.js`.

The reference loader awaits all three bundled font faces before its first draw. This prevents a first-frame font-swap race from mixing temporary system fallback with the loaded font in diagnostic layers.

`python3 scripts/image-parity/self-test.py` deliberately shifts a native frame by
one pixel and requires the comparison to reject it. `results.json` is the latest
passing report; the maximum single-pixel error is reported separately from the
full-image mean, so an antialiased text edge is never described as byte-identical.

Simulator gates: `bash scripts/image-parity/verify-ui.sh` runs ImageFlowTests and
the preview/photo states using dedicated, automatically deleted simulators. The
`preview-saved` fixture freezes the native saved flash through a DEBUG/test-host
proxy, matching its existing frozen web timeout; real saves retain the 1.5s flash.
`ui-results.json` records the first capture, the timing investigation, and final
zero-diff consolidation (44 unchanged captures plus 4 refreshed saved captures).
