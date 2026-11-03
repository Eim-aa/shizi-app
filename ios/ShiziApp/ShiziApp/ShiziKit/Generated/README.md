# ShiziKit/Generated/：手改的唯一真相源（D84）

`ShiziKitTokens.json`（颜色、字阶、间距、动效）和 `ShiziKitCopy.json`（文案）直接手改，就是原生的唯一真相源。目录名里的 Generated 是历史遗留，现在没有生成器：`scripts/build_shizikit.mjs` 已退役。

- 颜色是浅 / 深两套，键必须一致；字阶按 12 个系统字号档位写好 pt 值（xS–XXXL 是设计字号 × 档位倍数后按 1/64 截断，AX1–AX5 是绝对值）。
- `ShiziKitCopy.json` 必须与 `ios/ShiziCore/Sources/ShiziCore/Bundled/copy.json` 逐字相同（`pnpm run verify:copy` 核对）。
- `ShiziKitTokens.json` 的 `motion` 必须与 `Bundled/motion.json` 相同（`test/ios-shizikit.test.mjs` 核对）。
- 纸色（`colors.light.paper` / `colors.dark.paper`）同时决定 `Assets.xcassets/Paper.colorset`：改了就跑 `node ios/ShiziApp/scripts/generate-paper-colorset.mjs` 重写它（`verify-local.sh` 里 `--check`）。
- Swift 一侧由 `ShiziKitTests` 核对数值。
