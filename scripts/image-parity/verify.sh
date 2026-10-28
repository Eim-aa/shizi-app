#!/usr/bin/env bash
# macOS, Node/pnpm, Xcode, Python Pillow + numpy. No simulator is used.
set -euo pipefail
cd "$(dirname "$0")/../.."
swift build --package-path ios/ShiziCore
node scripts/image-parity/geometry.mjs
node scripts/image-parity/selection.mjs
node scripts/image-parity/layers.mjs
# Only this harness's generated raster outputs are replaced.
mkdir -p artifacts/image-parity/{reference,swift,diff}
find artifacts/image-parity/reference artifacts/image-parity/swift artifacts/image-parity/diff -name '*.png' -delete
node scripts/image-parity/reference.mjs
node scripts/image-parity/check-reference.mjs --generated
ios/ShiziCore/.build/debug/shizi-image-cli . artifacts/image-parity/expanded.json artifacts/image-parity/swift
node scripts/image-parity/regions.mjs
python3 scripts/image-parity/compare.py
