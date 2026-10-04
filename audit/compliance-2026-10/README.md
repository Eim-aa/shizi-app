# 合规落地记录（2026-10，卡 C1）

本目录记录 D50（2026-10-04 产品负责人「按推荐」）落到数据上的部分。依据是 [docs/legal/合规说明.md](../../docs/legal/合规说明.md)（AI 起草，不是律师意见）。

## 范围决定：移除 76 个来源授权有问题的补充字（D50 ①）

- [source-removal-76.decision.json](source-removal-76.decision.json)：范围决定。照 2026-08-06 排除 20 个生僻字的先例（[strokeorder-49-scope-closure.json](../vector-data-460-evidence/review-decisions/strokeorder-49-scope-closure.json)）记录：决定原话、依据章节、按来源分组的字表、解释边界。
- [source-removal-76.receipt.json](source-removal-76.receipt.json)：移除回执。逐字写明删除的 `data/<字>.json` 路径、SHA-256、字节数（与 2026-08 技术清单里的值一致），绑定决定记录与历史清单的哈希；被删文件可以从提交 `e702a6a7` 找回。

| 来源 | 数量 | 字 | 依据 |
|---|---|---|---|
| strokeorder.cc 网站 GIF 抽取 | 59 | 侹岠廆旞溚溞漷烶爟璲甗磏穟芃芠芣苉苾茽荁荄荓荖莝萳萹葴蒨蒱蓏蓢蔈蔊薸藟藦蟫襚豮逴遆遹邲邿郃郪鄃鄗鄜鄠鄫酂酅醨陎陑隃髢魋 | 合规说明 §1.8 |
| 台湾教育部笔顺网（CC BY-NC-ND 3.0 TW） | 10 | 嚭墘嫄尪屼崁帨踦雱龢 | 合规说明 §1.9 |
| 华文楷体 STKaitiSC 轮廓抽取 | 7 | 㧐圢庱珋衎觃𠙶 | 合规说明 §1.10 |

- 都是《通用规范汉字表》二、三级字（二级 2 个：雱、㧐），没有一个在义务教育常用 2500 字里。
- **保留**：𬇕（霞鹜文楷 GB 轮廓，SIL OFL 1.1），在 `THIRD_PARTY_NOTICES.md` 与 `data/LICENSE.md` 按 OFL 写明。
- 题库 7294 → 7218 张；二级可练 2976 → 2974、三级 818 → 744；补充数据可练 440 → 364（363 AnimCJK + 1 霞鹜文楷）。

### 历史证据不改

`audit/vector-data-460-manifest.json`、`audit/vector-data-460-evidence/` 是 2026-08 的技术与人工验收证据，哈希彼此绑定，本次**原样保留**。门禁照旧逐条核验这 440 条的验收绑定；对被移除的 76 条改为核对「回执里的删除哈希 = 清单里的 data_sha256，且文件已不在 `data/`」。

### 门禁

- `scripts/verify_vector_data_440.js`：回执 ↔ 决定 ↔ 历史清单的哈希绑定；移除成员摘要钉死；被移除的字不在 `data/`；留下的 364 条逐条从验收源字节重放、浏览器逐笔渲染。
- `scripts/verify_library_governance.py`：可练 7218、不可练 887（其中 `source_license_removed` 76）、成员与顺序摘要、被移除的字不在 `deck-data.js`。
- `scripts/build_8105_chars.py`：可练补充 = 历史清单 − 回执；回执哈希或成员不符就停。
- `scripts/verify_content_corpus.cjs`：被移除的字不得回到题库（`content-quality-baseline.json` 的 `revisions` 记下这次基线变化）。
- `test/core/compliance-removal.test.mjs`、`scripts/e2e/80-c1-removed-chars.spec.js`：数据里没有这些字；旧记录里有这些字时降级正常。

### 已有用户记录

按现有「字不在题库」路径处理，不删除用户数据：字墙、月字帖用楷体回退；详情页能打开，参考字用楷体回退、不请求笔顺数据；不再作为到期复习、新字或提醒出现；清单里照常列出但不能勾选；备份照常导出导入。

### 以后补回

1.x 用开放许可字体（如霞鹜文楷 GB）重制后补回（合规说明 §1.8.2 R2）。补回要新的验收记录与导入回执，不能沿用 2026-08 的验收。
