#!/usr/bin/env bash
# Coordinator simulator etiquette: wait before EACH simulator/XCUITest invocation.
# Keep this loop in a script file: pgrep -f would match a shell -c command containing its pattern.
set -euo pipefail
cd "$(dirname "$0")/../.."
while pgrep -f verify-native-ui.sh >/dev/null; do sleep 120; done
FLOW_CLASSES=ImageFlowTests bash ios/ShiziApp/scripts/verify-native-ui.sh --flows-only
while pgrep -f verify-native-ui.sh >/dev/null; do sleep 120; done
states=$(node --input-type=module -e 'import fs from "node:fs";console.log(fs.readdirSync("ios/ShiziApp/ShiziUITests/States").filter(f=>f.endsWith(".json")&&(f.startsWith("preview-")||f==="photo.json")).map(f=>f.slice(0,-5)).join(","))')
bash ios/ShiziApp/scripts/verify-native-ui.sh --parity-only --states "$states"
