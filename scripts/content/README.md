# scripts/content/

项目自有的题库内容，**不公开**：不在 `data/` 里，所以 `scripts/sync-open-data.sh` 不会把它同步到公开数据仓库 shizi-open（D59、D84）。

## `context-overrides.json`：语境覆盖（原 `data/context-overrides.js`，D84 迁出）

人工审校的覆盖，独立于生成题库；批准的词音与来源见 `scripts/fixtures/content-quality-approved.json`。

- `w` / `ci` / `py` 固定词音，`promptHint` 是词题可见提示；`gloss` 沿用释义模式。
- `preserveCommon` 仅显式 `true` 时保留原权重；`boost` 与未设 / `false` 的 `gloss` 行为不变。
- C1（D50 ③）：顾问审读 1.0 审定的语境词与合规全库排查的替换（round 4，清单见 `docs/legal/语境词替换清单-C1.md`）接在最后。

改完跑 `python3 scripts/build_8105_chars.py`：它把这份文件原样并入 `ios/ShiziCore/Sources/ShiziCore/Bundled/deck.json` 的 `overrides`（App 读的是 deck.json）。
`pnpm run verify:content` 核两者一致，并核审定内容（`content-quality-approved.json`、`content-quality-baseline.json`）。
