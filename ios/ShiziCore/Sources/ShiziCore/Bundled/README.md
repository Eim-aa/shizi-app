# Bundled/：手改的唯一真相源（D84）

这个目录的 JSON 是 ShiziCore 的规则与数据资源，**直接手改，就是唯一真相源**。JSON 不能写注释，所以在这里记一笔。

- 不再有 JS 生成器写它们（`scripts/build_core_config.mjs` 不写任何文件，只剩差分 JS 引擎读数据的导出）。
- `deck.json` 例外：由 `scripts/build_8105_chars.py` 写（一行一张卡）；语境覆盖的真相源是 `scripts/content/context-overrides.json`，改完重跑该脚本。不要手改 deck.json。
- `char-order.json` 和 `credits.json` 例外地保留生成器：`scripts/build_char_order.mjs`、`scripts/build_credits.mjs` 直接写入本目录，只读 docs / `THIRD_PARTY_NOTICES.md` / 题库，不读 `src/`。这两个文件不要手改。
- `copy.json` 与 `../../../../ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitCopy.json` 必须逐字相同；`scripts/verify_copy.mjs`（`pnpm run verify:copy`）核对，并对照 `docs/engineering/v10/copy-source.json` 查 P 编号覆盖、旧词表、数字口径与占位符。
- `policy-meta.json` 冻结为手改：登记每个 policy 导出与嵌套键对应的 P 编号。新增 / 删除 policy 键时，同步改 `policy.json` 和它；`verify:copy` 与 Swift `ConfigDataTests` 会核对「每个导出都有 P 编号、P 编号都在 `03-待产品决定.md` 登记、03 的每个 P 编号都被覆盖」。
- 改动联动：改了文案要想一想字体子集（见字体门禁）；改了 policy 键要同步 Swift 读取处与 `ConfigDataTests` 的类型表。
