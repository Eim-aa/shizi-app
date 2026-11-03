# SessionBundled/：手改的唯一真相源（D84）

`session-ui.json` 直接手改，就是唯一真相源。`scripts/core-golden/session-resources.mjs`（原来的生成器）已退役，不再写、不再核对。
改动时同步 Swift 读取处，并跑 `swift test --package-path ios/ShiziCore`。
