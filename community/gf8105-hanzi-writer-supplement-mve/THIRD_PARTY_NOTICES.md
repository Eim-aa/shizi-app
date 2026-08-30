# Third-party notices

## AnimCJK Hanzi graphics

- Project: [AnimCJK](https://github.com/parsimonhi/animCJK)
- Copyright: 2016–2026 FM&SH
- Frozen revision: `ec5e17cca76c87587790bcbce5ea0b4d4fb753d6`
- Source file: `graphicsZhHans.txt`
- Included characters: 抔, 拃, 馃
- Upstream license statement: [licenses/COPYING.txt](https://github.com/parsimonhi/animCJK/blob/ec5e17cca76c87587790bcbce5ea0b4d4fb753d6/licenses/COPYING.txt)
- Applicable data license: Arphic Public License
- MVE conversion date: 2026-08-08

For each included record, the `character` key was removed and the `strokes` and `medians` arrays were preserved semantically unchanged. The resulting JSON was serialized as an individual Hanzi Writer-compatible file.

A copy of the Arphic Public License is included as [LICENSE-ARPHIC.txt](LICENSE-ARPHIC.txt).

AnimCJK's official `COPYING.txt` states that the project is derived in part from Arphic PL KaitiM GB / Big5 fonts and from parts of Make Me a Hanzi. This notice identifies AnimCJK as the direct source of the three frozen records; it does not relabel them as newly drawn by Shizi or as direct Make Me a Hanzi records.

## Hanzi Writer browser runtime

- Project: [Hanzi Writer](https://github.com/chanind/hanzi-writer)
- Version: 3.7.3
- Included file: `vendor/hanzi-writer-3.7.3.min.js`
- Source URL: `https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js`
- SHA-256: `17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642`
- License: MIT

The frozen browser runtime is bundled only so the render/animation gate can run without a silent network fallback. A copy of its license is included as [LICENSE-HANZI-WRITER.txt](LICENSE-HANZI-WRITER.txt).

Hanzi Writer Data is referenced to describe the compatible JSON interface and the upstream integration question; its source code is not bundled in this directory.
