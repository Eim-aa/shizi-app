#!/bin/bash
set -euo pipefail

# Keep the existing command as a wrapper for the cross-platform SVG exporter.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${ROOT}/scripts/generate_app_icons.js"
