# M6 边开发边改清单与场景回归 · 逐项勾选

M6-6 卡（场景回归与各里程碑遗留）。分支 `v10/integration` 工作区，日期 2026-10-01。设备：本机 headless Chromium（Playwright），393×852 为主，另注明的视口见各条。**全部是 Chromium 代表路径**，iOS WKWebView / 真机未测（M7）。

标注口径：

- **[x] spec 名 § 步骤 / 断言**：该条有 e2e 断言直接覆盖（断言文字取自 spec，便于 grep）。
- **[~] 部分**：一部分有断言，其余写明缺什么。
- **[ ] 未做**：界面还没有这项行为；写明为什么（待产品 / 冲突 / 不在本卡）。
- **不适用**：清单本身写「先不改」或已被决定作废。

## 1. 04 §4.3 边开发边改清单（来源：边改 L17–66）

### 冻结前复验新发现

- [x] **Z02** 写错过 / 快忘了清单 0 个字时「先选一个字」真禁用 —
  `31-lists` §「click the circle → 练这个字; 全选; 全不选 → 先选一个字 disabled + aria-disabled」断言 `Z02: 先选一个字 really disabled`；
  `60-a11y` 断言 `list-go with 0 selected is disabled + aria-disabled (Z02 / R-G08)`（含鼠标不是手形由 disabled 样式保证）。
- [x] **Z03** 紧凑版单字详情「已撤销」不盖住「从自选的字移除」副标题 —
  `63-scenarios` §10「边改 Z03 (360×640 / 360×640 + data-large)」断言 `「已撤销」 bar and the sub line do not intersect`、
  `the sub line can be scrolled fully into view`、`the sub line is not covered (hit test)`。
  **本卡发现并修复**：原实现撤销底栏 `position:absolute` 浮在正文上，360×640 下「已撤销」与副标题相交 3740px²（断言在原实现上失败、修复后通过）。
  修复与备份页 Z04 同法：撤销底栏移入页面底栏区「练这个字」上方（`src/ui/screens/detail/index.js`），正文在它上方滚动；R-D06「底栏浮在练这个字上方」仍成立（`33-detail` 断言 `undo bar floats above 练这个字` 通过）。
- [x] **Z04** 紧凑版备份页撤销后不靠自动上滚让位，用底栏和安全区排版 —
  `42-backup` §K03 断言 `R-B08: content area ends above the undo bar (no overlap)`（撤销底栏在 Page footer，`src/ui/screens/mine/backup.js` 文件头「底栏排版（R-B08 / Z04）」）。
  未覆盖：紧凑视口下没有单独跑这一条（42-backup 在 393×852）；安全区只在 Chromium 的 env() = 0 下测。

### 写字页

- [x] **W16** 跳过后底部轻提示「已跳过「警」 · 撤销」，3 秒 —
  `11-judge-correct` 断言 `bottom hint 已跳过「春」`；`17-skip-undo` 断言 `bar text 已跳过「春」` 与「3 秒后收起」一段；`23-result` 断言 `bar 已跳过「和」 on the result page`。
- [x] **W17** 书写格「清空」后给一次撤销 — `10-write` 断言 `one undo after clear restores both strokes`。
- [x] **W18** 写到一半返回首页轻提示「已保存，下次接着写」 —
  `21-session-start` 断言 `R-H10 toast`；`22-home` 断言 `R-H10 toast 「已保存，下次接着写」`；`24-scenario-sessions` 断言 `R-H10 toast`；`63-scenarios` §1 断言 `toast 已保存，下次接着写 (R-H10)`。
- [x] **W19** 描一遍开始先播一遍笔顺，可以跳过 —
  `14-answer` 断言 `preview (先播一遍) is running (走查-W19)`、`preview skipped by writing`；`12-glyph` 断言 `preview playing`、`preview skipped entirely`（减少动态效果）。
- **不适用** **W21** 「再写一遍」：清单本身写「先不改，上线后看数据」。
- [~] **W22** 拼音加大、加深一档（R-W23）— 实现按原型尺寸：拼音 15px / `--i2`，单字题 22px / `--i1`（`src/ui/screens/write/prompt.js` `.sz-prompt__py`），随 `--k` 放大；
  `m1-prompt-mask` 断言 320×568 + 大字下题面与拼音不裁切，`60-matrix` 断言拼音对比度 ≥ 4.5。**缺**：04 没有给「一档」的具体数值，没有针对「比某基准大一档 / 深一档」的断言（登记为待定，见 M6-6 报告 newPendingDecisions）。
- [ ] **W23** 深色下提示笔画、描一遍轮廓、禁用按钮各提亮一档 — 清单本身写「与深色真机检查一起定」；03 **P58** 过渡「不提亮」（`src/config/policy.js` P58、`src/config/tokens.css` 注释）。M7 真机后定。
- [x] **（无编号）** 更大字体点提示后说明文字离格子 / 按钮约 2px：松一点，按钮不能出第一屏 —
  `16-compact` §「提示 — grid size unchanged, note has breathing room (R-W26), buttons still first screen」断言 `note ≥ 6px above the footer`、`hint note shown under the grid`（360×640 标准字号与 data-large 各一遍）。

### 几种「组」、字库、查字

- [x] **S04** 「结束这组」确认框：主按钮「接着写」，「结束这组」普通按钮 —
  `23-result` 断言 `S04: 接着写 is the primary button, 结束这组 a normal one`；`24-scenario-sessions` 断言 `S04 body`。
- [x] **S05** 从写错过 / 快忘了开的组，结果页写来源 —
  `23-result` 断言 `S05 date line …自己选的`、`S05 source line`（wrongList / forgetList / detail 三种来源）；`31-lists` 断言 `S05 source line`（从写错过 / 从快忘了）。
- [x] **S06** 清单写到一半返回时保留勾选；「全选 / 全不选」 —
  `31-lists` 断言 `S06: selection kept after returning unfinished`、`S06 toggle shows 全不选 when all selected`、`全选`。
- [x] **L04** 查字 → 练这个字 → 返回：回到查字卡片，输入不变 — `34-library-query` 断言 `back from B → the lookup card (R-Q07)`（同段断言输入不变）。
- [x] **L09** 字库首页大数字可点进完整页；墙底「还有 N 个字 ›」；快忘了空卡片去掉卡片样式 —
  `30-library` 断言 `big number ${n} (R-L10) is a button (R-L02)`、§「N chars: … truncation」（P27 截断与「还有 N 个字」）、§「wrong card empty: no card chrome, not a button (R-L02)」；`35-all` 断言 `big number → library-all (real registration, not a stub)`。
- [x] **L10** 换完字库轻提示 — `32-switch` 断言 `toast after switching`。
- [x] **L11** 有记录的字：选了筛选后排序收起；0 个的筛选变灰；拼音分组里每个字标拼音；支持拼音查 —
  `35-all` §「filters: counts, toggle off, sort collapses」、§「zero-count filters greyed & inert」、断言 `each cell shows the deck pinyin under the glyph`、§「find by pinyin (R-A04)」。
- [x] **L12** 单字详情去掉空「下一次」格子；没有字源的字整块不显示 —
  `33-detail` §「with records: … cells in order (no 「下一次」 cell)」、断言 `R-D09: no etymology → the whole source block is hidden`。
- [~] **L13** 历次笔迹点格子放大 — `33-detail` 断言 `zoom shows the stored ink`、`zoom: 「这一次没有留下笔迹」`。
  「做图片时可以选用哪一次」**不做**：与决定 D11（单字图片只用最近一份笔迹）冲突（04 §5.2-2），`44-scenario-ink-states` 断言单字图片取最近一次记录。
- [x] **L14** 深色下改成「颜色越暗，越久没写」；最淡一档提亮 — `30-library` §「dark (data-theme=dark): note reversed, oldest tone brightened (R-L03 / 边改 L14)」断言 `dark note 「颜色越暗，越久没写。…」`。

### 我的、练习记录、图片

- [x] **M03** 我的页只放字帖最近 3 行，加「全部 ›」 — `40-mine` 断言 `no 全部 › when ≤ 3 rows`、`「全部 ›」`（§「300 chars this month: mine sheet = last 3 rows + 全部 › (R-M05)」）。
- [x] **M04** 点有记录的日子列出那天写的字；字帖跟着月份走；箭头加底、到头变灰 —
  `40-mine` §3（点日子、翻月、字帖跟月份）、断言 `arrow has a background (R-P05 箭头加底)`、`both arrows grey + aria-disabled`。
- [~] **M05** 开提醒时选时间、开了给反馈；难度可以改 —
  选时间：`41-settings` 断言 `remind stored with the default time`、`time stored`；`55-reminder` 断言 `synced at 21:15, same questions`。
  反馈：只有权限状态回写（`41-settings` §「permission denied … R-S02 texts」、`55-reminder` granted → 再同步），**没有「已开提醒」的轻提示**（04 R-R08 无文案）。
  难度：依赖备注 D6，未做。两项登记见 M6-6 报告。
- [~] **M06** 这次的图片版式重排、字放大；「存下来的是图片…」只第一次出现；可以挑字 —
  版式 / 字放大：`43-images` §1（3:4 1080×1440、成员、列数口径）。
  「只第一次出现」**未做**：`src/ui/images-entry.js` 每次都显示 R-I01.imageNote（登记见 M6-6 报告）。
  「可以挑字」**不做**：与 D11 冲突（04 §5.2-2）。
- [x] **M07** 首页那排字点进今天的记录；年度报告导出放以后版本 —
  `22-home` 断言 `ink row is a button: M4-1 registered 今天的记录 (R-H08; 40-mine covers the target)`；`40-mine` §4「今天的记录」；`46-annual` §4「不导出」（页面里除了返回没有按钮）。

### 备份、设置

- [x] **K04** 替换确认写明丢失日期范围、危险操作不用主按钮、导出成功给反馈、错误用错误样式 —
  `42-backup` 断言 `loss range (P26 / K04)`、`dangerous 替换 is not a primary button (K04)`、`export feedback toast (K04)`、`${kind}: error style (K04)`。
- [x] **K06** 清空后首页用「没有记录」的说法 — `22-home` §「records cleared (R-H09 / P46)」断言 `records=empty after clear-all`、`no 「第一次来」 after clear-all`。
- [x] **V01**（B 类）外观点开选浅色 / 深色 / 跟随系统 — `41-settings` 断言 `order 浅色 / 深色 / 跟随系统 (R-S03)`、`labels`、§「appearance: sheet with three choices …」。
- [x] **V03**（B 类）背景音选项占满一行（第十稿改为「按键音」，P07）；「写完提示做成图片」见 D10 —
  `41-settings` 断言 `按键音 switch on by default`、`switch names = row titles`（行高 ≥ 44 同段）、`no 写完提示做成图片 row (P13)`。

## 2. 连续场景 1–10 / 关键反例 1–8 → spec 与断言

来源：`docs/product/03-interaction-handoff-checklist.md`「连续场景」；`docs/product/foundation/03-需求范围与验收标准.md` §6「必须保留的关键反例测试」；映射表 02 §8.1。`63-scenarios` 是本卡新增的连续回归。

| 条目 | spec § 步骤 | 代表断言 |
|---|---|---|
| 场景 1 首次开始 → 写一笔 → 自主判断 → 返回；无判断返回不制造有效记录，不要求完成 | `63-scenarios` §1；`21-session-start` §1；`22-home` §4 | `returning without judging writes no record at all`、`the group is still open at cursor 1 (not forced to finish)`、`no result page, no forced next step` |
| 场景 2 提示 → 看答案 → 描写 / 自己再试 →（下一字）判断；本人笔迹、参考、帮助事实分开 | `63-scenarios` §2；`14-answer`；`13-hint` | `help facts: hints 1, answerSeen, traced — separate fields`、`help facts of this attempt only`、`trace / retrace strokes are practice, not stored as the learner ink of a record`。按 D18 看答案后不进判断页，「判断」在下一字 |
| 场景 3 原练习有未判笔迹与帮助 → 临时选字 → 暂停 → 优先续临时组 → 明确结束 → 回来源 → 首页可续原练习、不自动进下一字 | `24-scenario-sessions` 主线与分支 | `sessions.A deep-equal after opening B`、`${label}: no auto-advance to the next character`、`${label}: sessions.A.current deep-equal to the seeded one` |
| 场景 4 临时组中途结束：零判断 / 部分判断 / 保存失败；可重新选组、不覆盖未处理现场 | `63-scenarios` §3；`23-result` §3 §4 | `A deep-equal (strokes, hint, phase untouched)`、`failed end keeps B as it was`、`S02 instead of overwriting the unfinished B`、`S02 + cancel: zero writes` |
| 场景 5 查字不预选、输入可勾选；明确开始才加入；取消无副作用；未结束临时组不妨碍只读查字 | `63-scenarios` §4；`20-query`；`34-library-query` §5 | `rows unchecked (no preselection)`、`open / type / check / cancel: zero writes`、`B created only on the explicit start`、`lookup with an unfinished B: zero writes` |
| 场景 6 写几笔后改上一判断：同一记录、不增次数、现场保留、失败可重试；入口留到当前字提交 | `11-judge-correct` | `same record id`、`corrections appended`、`no corrections after the failed write`、`session.current deep-equal before / after the correction` |
| 场景 7 末次缺墨、早次有墨、全需参考、零记录；图片与备份对象和用途 | `44-scenario-ink-states`（七处）；`43-images`；`42-backup` | `A: no ink borrowed from the older record`、`each row uses the latest record; thumbnail ink iff that record has ink, else 没有笔迹`、`46-annual` / `30-library` 零记录空态 |
| 场景 8 错 → 后来写对 / 错 → 更正为对 | `31-lists` §「scenario 8a」「scenario 8b」 | `list = records.wrongList(getState)`、8a / 8b 两段（字离开写错过、不进快忘了、记录条数不增加） |
| 场景 9 首页 N=0/1/8/9；历史月与当前月图片范围；>80 字 pending | `22-home` §「N=0」「N=1」「N=8」「N=9」；`43-images` §4 §「> 80 chars → pending」；`40-mine` §3 | `N row shown even with an unfinished group (P16)`、`no canvas for pending`、`share / save disabled + aria-disabled` |
| 场景 10 恢复取消、坏文件、保护副本失败、覆盖失败、撤销失败 | `42-backup` §R-B06 §R-B04 §「replace fails midway」§R-B05 | `cancel: deep-equal`、`R-B04 note + retry link`、`rolled back: all v2 keys deep-equal (safety removed)`、`R-B05 restore wording` |
| 反例 1 今日记录 0 / 有 × 未完成会话 无 / 有，加首次 | `22-home` §1 matrix | `data-records=${recordsCase}`、`data-resume=${resumeCase}` |
| 反例 2 没落笔就看答案 / 描写 / 跳过不算有效尝试 | `63-scenarios` §2；`14-answer`；`11-judge-correct` | `today N still 1 after 看答案 / 描一遍 without a stroke`、`today N still 1 after 跳过 without a stroke`、`14-answer`: `今日 N (judged, deduped by char) does not count answer-seen` |
| 反例 3 当前字写几笔且用过帮助再改上一判断：现场不变、旧尝试不增条数 | `11-judge-correct`（第三字用提示写了几笔时修改） | `session.current deep-equal before / after the correction`、`same record id` |
| 反例 4 A 暂停 → B 开始 → B 暂停 / 结束两支；中央入口分别续 B / 恢复 A | `24-scenario-sessions` | `A still deep-equal`、主线（结束）与分支（暂停）两段 |
| 反例 5 B 未完时只读查字允许，真正开始 C 保护 B | `34-library-query` §5；`63-scenarios` §3 §4 | `lookup + card: no S02`、`sessions.B deep-equal`、`S02 instead of overwriting the unfinished B` |
| 反例 6 保存失败与重试、重复点击 / 响应：不推进、不丢现场、不重复计数 | `63-scenarios` §5；`11-judge-correct`；`14-answer`；`15-recover` §5 | `double judge: exactly one record`、`double skip: one skipped record`、`B ended once into lastEnded.B`、`k=${k}: at most one judged record`、`exactly one item for 和 (retry did not duplicate)` |
| 反例 7 坏备份、保护副本失败、恢复失败、取消：不静默覆盖 | `42-backup` | `${kind}: all v2 keys deep-equal`、`rolled back: getState deep-equal` |
| 反例 8 短屏、大字、长文本、键盘：主操作可达、正文与底栏不遮挡 | `60-matrix`（448 格）；`16-compact`；`m1-prompt-mask`；`20-query` / `34-library-query` 键盘 | `${c.name}: overflow / overlap / reach / cover / contrast … / tap … / primary`（每格） |

## 3. M6 遗留项（02 §8「M5 遗留」「M3/M4 遗留」中归本卡的）

| 遗留 | 改动 | 测试 |
|---|---|---|
| 替换 / 清空时一并清 `sessions.lastEnded` | `src/core/backup.js` `endActiveSessions` | `test/core/backup.test.mjs`（P79 / M6-6 三条）；`42-backup` 断言 `M6-6: lastEnded cleared by the replace`；`63-scenarios` §8 `A / B ended and lastEnded cleared by 清空`、`undo: every v2 key (incl. sessions.lastEnded) deep-equal` |
| `rememberInk` 缓存加测试清理接口 | `src/ui/screens/write/compare.js` `forgetRecentInk()` | `test/ui/result.test.mjs` `M6-6 forgetRecentInk…`；`result.test` / `compare.test` 用例前后清理 |
| 写字页其它本地状态接 epoch | `src/ui/screens/write/index.js`（本体按 store 替换代数重挂）；`persist.js`（`isStale` 时不写回） | `63-scenarios` §7 三段（判断页本地阶段、跳过撤销底栏、未写回的本地笔画）；去掉重挂 / 去掉 isStale 时本段失败（本卡实测） |
| 跨天作废回首页 e2e | 无代码改动 | `63-scenarios` §6 `the daily group expired (P37 discard)`、`back at the home tab root (no empty write page left)`、`B kept`（P61） |
| 桥错误回调 `shiziShareFailed`（P96 过渡） | `bridge.js` 全局；`src/ui/components/share-failed.js`；`mine/backup.js` 订阅；Swift `notifyShareFailed`；copy `X-SHARE`（copy-source extra，decision P96） | `test/ui/share-failed.test.mjs`（5 条）；`63-scenarios` §9 |
| 提醒邀请卡（P98） | **不做**（P98 过渡：槽位留空，`result-remind-slot` 仍为空） | — |
