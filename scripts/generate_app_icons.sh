#!/bin/bash
set -euo pipefail

# Export the approved raster artwork without changing its design or cropping it.
# Requires macOS sips; all sizes are generated directly from the same source.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/assets/branding/app-icon-source.png"
CATALOG="${ROOT}/ios/ShiziApp/ShiziApp/Assets.xcassets/AppIcon.appiconset"

command -v sips >/dev/null || { echo "This exporter requires macOS sips." >&2; exit 1; }
test -f "${SOURCE}"

for size in 180 192 512; do
  sips --resampleHeightWidth "${size}" "${size}" "${SOURCE}" \
    --out "${ROOT}/icon-${size}.png" >/dev/null
done

for size in 40 58 60 80 87 120 180 1024; do
  sips --resampleHeightWidth "${size}" "${size}" "${SOURCE}" \
    --out "${CATALOG}/Icon-${size}.png" >/dev/null
done

echo "Exported 3 Web icons and 8 iOS icons from assets/branding/app-icon-source.png."
