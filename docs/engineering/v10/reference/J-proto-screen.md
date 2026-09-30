# J · 第十稿原型 · ShiziScreen（单字详情 / 我的 / 练习记录 / 备份 / 结果页 / 年度报告 / 换库 / 设置 / 关于 / 图片弹层 / 修改判断）

源文件：`docs/design/v10/extracted/ShiziScreen-第十稿交接版.dc.html`（512 行，199,367 字节；下文行号一律指这个文件，简写 `L<n>`）。
参照的决定：`docs/handoff/decisions.md`（D01–D25）、`docs/product/04-v10-handoff.md`、`docs/design/v10/交接备注-第十稿交接版.md` §4（写死的计数）与 §10（给工程）、`docs/design/v10/第十稿-文案修改清单-第十稿交接版.md`（C038–C140 对应 ShiziScreen）。

---

## 1. 概览

1. 这是一个 dc（design-component）单文件组件：`<x-dc>` 模板（L9–L229，用 `sc-if` / `sc-for` / `{{ }}` 模板 DSL）+ `<script type="text/x-dc">` 逻辑（L232–L509，`class Component extends DCLogic`，React 运行时由外部 `support.js` 提供）。它不是可运行的产品代码，而是 30 个“预设屏”的可视化规格。
2. 用一个 `screen` 枚举（L232 `data-props`）切 31 个预设：24 个整页（`MAIN`，L274）+ 7 个弹层（`OVER`，L274）；弹层用 `UNDER` 表（L275）决定压在哪个整页上（`libSwitch`/`libConfirm` 为 `'none'`，透明底，叠在“字库墨墙屏”上；图片/分享叠在 `records`；替换/清空确认叠在 `backup`）。
3. 所有可点元素统一用 `data-nav="<key>"` 属性，由根节点 `onClick` 冒泡捞取后调 `P.onNavigate(key)`（L366）；组件自身**无状态、无存储**，全部数据从 props 进（`records`、`result`、`sheet`、`settings`、`lastBackup`…），props 缺省时回落到内置演示数据 `DAYS`（L243–L253，“今天 = 2026-09-24”）。
4. 数字在传 `records` 时按记录实时算（`derive()` L263；单字详情次数/首次、我的这一周/字帖/落款、练习记录天数/墨点、结果页标题/格子、年度报告、换库“有记录 N 个”、备份状态句/替换确认字数——与《交接备注》§4 一致）；仍写死的有：单字详情“大约 10 月 3 日再练到”（D7）、四个库“可以练 N 个字”、备份文件日期“9 月 1 日”、拼音/笔画/部首/字源样本、年度报告“豕 shǐ”。
5. 参考字形与“本人笔迹”合成都依赖 CDN `hanzi-writer-data@2.0/<字>.json`（L237）和全局 `window.SZInk`（笔迹管线，L288–L303）；`data="proto"` 时依赖 `window.SZProto`（proto-model）的 `build('today')`、`SAMPLES`、`lists()`（L361、L392）。
6. 已经落实第十稿：看过答案 = `v:'A'`、不判断（D18）；修改判断入口在结果页格子 → 底部对照弹层（D19，L117 `nav:'cell:'+i`、L211–L225）；“写错过 / 快忘了”命名与 `Zp.lists` 规则（D23，L392–L394）；补记去掉、备份撤销“离开这一页前可以撤销”、结论句 `bkLast`、无记录不催导出（D24，L470–L482）；换库列表“可以练 N 个字 · 有记录 M 个”+ 一句说明（L187）。
7. 仍与第十稿冲突或残留：`onboard` 介绍页预设仍在（D17 已去掉介绍页）；日历模板保留补记视觉字段 `canBack`/`back`（虚线圈、空心点，L91）但数据永远为空；`endPicked` 文案与《改动清单》10.10 不一致；月字帖取“本月第一次”笔迹（M02）而 `decisions.md` D11 仍写“月图取月内最后判断”。
8. 全文件**没有任何 transition / animation / @keyframes**（grep 为 0），底部弹层与居中确认框只有静态位置规格，没有动效规格。

---

## 2. 组件/模块清单

### 2.1 顶层结构与公共件

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 字体注入 | L13 | 动态插 `<link>`：`lxgw-wenkai-gb-web@1.522.0 regular`（jsdelivr）、`Noto Serif SC 400;500`（Google Fonts） | — | 联网 | 应重写 | D13 要求楷体改名 ShiziKai 子集、许可随包；PWA 离线不能靠 CDN |
| 根框 `frame` | L17、L369 | 393×852（std）/ 360×640（compact，`--k:1.3`）；圆角 42/28；深色暖灯 `radial-gradient` | CSS 变量 `--k --ov --osb --fb --sbh --p --c --sh --off --i1..--i5 --a --ar --g --scrim --hi` | `TH`（L269–L272） | 可抽取改造（令牌表） | 正式版不需要手机外框，令牌表可直接进 CSS |
| 状态栏 / Home 指示条 | L19–L23、L227 | 演示用 9:41、信号、电池、底部 134×5 指示条 | `hasStatus`、`bareSp` | — | 不复用 | 原型装饰 |
| `data-nav` 事件委托 | L17、L366 | 根 `onClick` 向上找最近 `data-nav`，调 `P.onNavigate(key)` | 见 §3.5 key 全表 | — | 应重写 | `aria-disabled` 的元素仍会触发（见 §5） |
| 底部三导航 `hasTabs` | L175–L185、L276、L372 | 习字 / 字库 / 我的，只在 `mine`/`mineEmpty` 显示 | `nav('home'|'library'|'mine')` | — | 可直接复用（图标 SVG、64px 高、32px 圆角） | D02 三导航 |
| 通用页头 | 每屏首行 | 44px 高，左 44×44 返回箭头（`data-nav="back"`）或 X（`onClose`），中间标题 17px/500，右 44px 留空 | `back` / `close` | — | 可直接复用 | 关闭 X 用于结果页族与 `noChars`/`photo`（后两者无 nav） |
| 设置行（列表行）模式 | 多处 | `min-height:52px; padding:8px 0; border-bottom .5/1px --i5`，左标题 15px + 小字 15px/--i2，右值 15px/--i2 或 “›” 13px/--i3 | — | — | 可直接复用 | 单字详情写错过行为 60px |
| 说明框（note box） | 多处 | `padding:14px 16px; radius 14px; bg --off`，左 6px 圆点 + 15px/1.7 文字 | — | — | 可直接复用 | 用于结果页无图说明、备份说明、onboard note |
| 主按钮 / 次按钮 | 多处 | 主：`min-height 52; radius 16; bg --a; color #FFF9F1; 17px; letter-spacing .08em`；次：`border .5px --i5; bg --c; color --i1; .06em`；危险：`border 1px --ar; transparent; color --ar` | — | — | 可直接复用 | 禁用主按钮：`bg --off; color --i4`（L168） |
| 空态插图 | L127、L144、L174 | 88×88 虚线框 + 52px 楷体单字（尽 / 年 / 存），下标题 20px/500 + 说明 13px/1.75，max-width 290 | — | — | 可直接复用 | |

### 2.2 渲染与数据辅助（逻辑层）

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `load(c)` / `ST` | L233–L239 | 拉 `hanzi-writer-data@2.0/<c>.json`，缓存到 `window.__szStore.data[c]`，失败置 `null` | `Promise<data|null>` | fetch/CDN | 应重写 | 正式版笔画数据需本地打包（10.13 / I04） |
| 演示数据 `DAYS WORD WRONG REAL_FIX A40 B40 CUSTOM` | L243–L260 | 9 天 × 若干 `[字, v, _, help]`；`WRONG` 描述“写错”的删笔/歪斜；`A40/B40` 80 字压力样本；`CUSTOM` 自选字 | — | — | 不复用 | 仅演示 |
| `ALLREC REC LATEST AGAIN derive() D0` | L261–L266 | `REC = v∈{R,W}`；`LATEST[c]` = 数组序最后一条；`AGAIN` = 最近判断为 W 的字（**模板未用**） | `derive(all) → {ALLREC,REC,LATEST,AGAIN}` | — | 可抽取改造（选择器思想） | `LATEST` 按数组顺序而非日期比较；proto-model `lists()` 用 `doy`+`i` 比较 |
| `cn() md() fmt() signM()` | L267–L270 | 汉字数字（纸面落款专用）、“9 月 24 日”、“9·24”角标、落款 `二〇二六年九月 · 有记录N天 · N个字` | 纯函数 | — | 可直接复用 | `signM` 年月写死“二〇二六年九月”；`cn` 2 → “两” |
| `TH` 令牌 | L269–L272 | 浅色/深色全部颜色变量 | CSS vars | — | 可直接复用 | 深色 `--ar:#D47A5D`、`--a:#AE5A44`（对比度实测见交接备注 §6） |
| `componentDidMount` | L279 | 监听 `szink` 事件重绘；每 60ms 轮询等 `SZInk`（及 `SZProto`）；预加载所有涉及字的笔画数据 | — | `window.SZInk/SZProto` | 不复用 | 若全局永不出现则无限轮询（有 `_gone` 守卫） |
| `guides() svg()` | L282–L283 | 345×345 viewBox，米字格只画横竖中线（虚线 `4 5`，`--g`） | React 元素 | — | 可直接复用（格线规格） | 无对角线 |
| `ref(c)` | L284–L286 | 参考字形：hanzi-writer 路径填 `--i1`；无数据回落 78% 楷体文字 | — | `ST.data` | 可抽取改造 | 变换 `glyphT`（L241）：1024 单位→345，翻 y |
| `kai(c,col)` | L287 | 70% 楷体文字（跳过/看过答案格子用 `--i4`） | — | 字体 | 可直接复用 | |
| `live(strokes,sh)` | L288–L291 | 画实时记录的 `strokes:[[{x,y,w}]]`（345 空间）；`sh={dx,dy,s,wk,floor}` 缩放/偏移/线宽 | — | `SZInk.outline` | 可抽取改造 | 角标格子缩 0.78 并右下偏 |
| `handStrokes()/hand()` | L292–L303 | 合成“本人笔迹”：优先 `SZInk.pick(c,kind)` 真人录制，否则按 medians 加抖动、写错按 `WRONG` 删笔/歪斜 | — | `SZInk.pick/fromRecord/wrongFix/synth` | 不复用 | 纯演示合成，正式版只画真实笔迹 |
| `noInk(c,px)` | L305–L306 | 10.12 状态 2：黑体字（`--i3`）+ “没有笔迹”（格宽 ≥110 写“这一次没有留下笔迹”） | — | — | 可直接复用（规格） | 字号 `P*.34`，标签 9–12px |
| `hr(r,sh,px)` | L307 | 分发：`ink==='none'`→`noInk`；有 `strokes`→`live`；否则→`hand` | — | — | 应重写为“只画真实笔迹/缺墨” | |
| `cells(arr)` | L309 | 补默认 `{br,bb,tag,cap,ch,capC,nav}`；外框只画上/左，格子只画右/下 | — | — | 可直接复用（网格画法） | |
| `imgData(n)` | L311–L317 | 图片数据源：`imgItems`（本次/单字）> 80 字演示 > `imgMonth()`；10.12 过滤 `ink==='none'` 并按剩余数重算落款 | — | — | 可抽取改造 | |
| `imgMonth()` | L320–L324 | 9 月字帖：按“第一次出现”排序；格子取**本月第一次**那条记录（变量名 `last` 实为 first）；`days` 只算有 R/W 的天 | `{cells:[{c,d,v,tag,strokes,ink}],days,sign}` | `REC` | 可抽取改造 | 月份写死 `'9-'`；与 D11 冲突见 §4 |
| `imgGeom(ratio,N)` | L325 | 板宽 312pt，列数 5→9 自动增到放得下（`ceil(N/c)*(312/c)+118/3 ≤ IH`） | `{c,IW,IH,FOOT,cw,rows}` | — | 可直接复用（算法） | 3:4 IH=432，1:1 IH=312 |
| `imgEl(ratio,n,marks)` | L326–L337 | 月字帖/本次图片“板”：360×480 或 360×360 pt（导出 3×），边距 24，格线 `#A6533F47`，角标让位规则（格宽<42 缩到 8pt），落款 26/3 px + 26pt 红印“字” | React 元素 | `imgData` | 可抽取改造 | 永远用 `TH.light`（纸色） |
| `charEl(ratio,marks)` | L339–L355 | A05 单字图片：只画最近一份笔迹，字宽约 60%，下一行 `拼音 · 9 月 22 日`（11/13），右下 “拾字” + 印 | — | `P.imgChar` | 可抽取改造 | 无 `imgChar` 时写死取「静」 |
| `vd(v)` | L356 | R→写对，W→写错，S→跳过，其他→看过答案 | — | — | 可直接复用 | |
| `renderVals()` | L357–L507 | 所有屏的派生值 | 见 §3 | — | 应重写 | 单函数 150 行，按屏拆 |

### 2.3 预设屏清单（模板 + 逻辑）

> 每屏列：布局、读什么数据、文案（逐字）、动作、状态。字号一律 `calc(Npx*var(--k))`，正文 15、标题 Noto Serif SC 26/20、页头 17、小字 13/11。

#### 2.3.1 我的 `mine`（L24–L27；逻辑 L382–L388）

- 布局：无页头；`padding 14 24 32; gap 26`。① 大标题“我的”；② “这一周”块：标题行（左 20px 宋体 `--i2`，右 `练习记录 ›`），7 列网格（星期 11px `--i3` / 日期 34×34 15px / 6px 墨点）；③ [mSheetOn] “9 月字帖”块：标题行（右 `保存图片 ›`）+ 纸卡（`bg --c; border .5px --i5; shadow 0 12px 28px rgba(59,47,40,.08); padding 14 14 12`）内 7 列 1px 缝网格（`gap:1px; background:--g`）+ 落款行（11px/.16em）+ 24px 红印“字”（`rotate(-3deg)`）；④ 菜单：设置 / 备份与恢复 / 年度报告 / 关于拾字；⑤ 底部三导航（“我的”高亮）。
- 数据：`week`：日期写死 21–27（`n=21+i`），`has = REC.some(d==='9-'+n)`，今天 `P.today`（默认 9-24）红字 600；`mSheet = imgMonth()`（每格 `nav:'detail:'+c`，补到 7 的倍数）；`mSign`；`lastBkText`。
- 文案：

| 位置 | 文案 |
| --- | --- |
| 标题 | 我的 |
| 块标题 | 这一周 |
| 右链接 | 练习记录 › |
| 星期 | 一 二 三 四 五 六 日 |
| 块标题 | 9 月字帖 |
| 右链接 | 保存图片 › |
| 落款 | `二〇二六年九月 · 有记录{cn(days)}天 · {cn(n)}个字` |
| 印 | 字 |
| 菜单 | 设置 |
| 菜单 | 备份与恢复 / 小字：记录只存在这台手机上 / 右值：`还没有备份 ›` 或 `上次备份 9 月 1 日 ›` |
| 菜单 | 年度报告 / 小字：2026 |
| 菜单 | 关于拾字 |

- 动作：`records`、`image34`、`detail:<字>`（字帖格）、`settings`、`backup`、`annual`、`about`；tabs `home/library/mine`。
- 状态：`mineSheet=false` 隐藏字帖块；深色用 `TH.dark`；大字 `--k`。注释 L381：有记录字数与写错过一块已搬到字库（K02、K09），`mineNoAgain` 并入 `mine`。

#### 2.3.2 我的 · 空 `mineEmpty`（L28–L31）

- 布局同上，但 ② 前插“还没有记录”块，③ 字帖块不渲染，日期 21–27 全部写死（24 红 600，25–27 `--i3`），无墨点。
- 文案新增：`还没有记录`；`写一个字并判断对错，这里就会有记录。`；备份行小字改 `还没有可以备份的记录`，右侧 `›`。
- 动作同 `mine`。

#### 2.3.3 单字详情 `detail`（L32–L48；逻辑 L389–L407）

- 布局：页头（返回，标题空）；`gap 24`。① 字卡（`border .5px --i5; radius 20; bg --c; padding 16; grid 1.5fr 1fr`）：左参考字形（`border 1px --g; radius 4`），右列拼音 24px 宋体 / `{N} 画` / `部首 · X` / 标签“词语”或“释义” + 词块（40px 宽楷体 24/38 格，目标字位 `inset 0 0 0 1.5px --ar` 红框）或释义（楷体 19/38）。② 记录块：左 `记录了 N 次`（20px `--i2`），右 `首次记录 9 月 1 日`；4 列格子（每格 1:1 + 32px 说明行 11px，`white-space:pre-line`），最后一格空 + “下一次”。③ [dSrcOn] 字源：44px 标签“字源” | 楷体 19/1.6 原句 + 13px “《说文解字》”。④ 列表：[dStOn] 写错过/快忘了行（60px，红点仅写错过）→ `wrongList`/`forgetList`；下次练习 | `大约 10 月 3 日再练到` → `schedule`；[dPhotoOk] `把这个字做成图片 ›` → `photo`；[dPhotoOff] 灰标题 + 小字；[dWfOn] `换掉这个词语 ›` → `wordFeedback`；[dRmOn] `从自选的字移除` + 小字 → `rmCustom`。⑤ 底栏（`padding 12 24 --fb; bg --p`）主按钮 `练这个字` → `practiceOne`。
- 数据：`DC = P.char || '静'`；`CH = P.chars[DC]`（`{py, word[], blank, gloss}`），无 `chars` 时写死 jìng/14 画/部首 · 青/平静；`js = REC.filter(c===DC)`；`dCount`、`dFirst` 传 records 时实时；`dl = P.list || Zp.lists(REC,today)` 决定 `dStOn`（只在 `base==='detail'`）；`lastR.ink==='none'` → `dPhotoOff`；`dRmOn = P.added.includes(DC)`；`SRC` 只有 静、亦。
- 文案：

| 位置 | 文案 |
| --- | --- |
| 字卡 | `{py}` / `{N} 画` / `部首 · {X}` / 标签 `词语` 或 `释义` |
| 记录块 | `记录了 {N} 次` / `首次记录 {M 月 D 日}` |
| 格说明 | `{m}·{d} 写对` / `写错` / 最后一格 `下一次` |
| 字源 | 字源 / `审也。从青争声`（静）、`人之臂亦也。从大，象两亦之形`（亦）/ 《说文解字》 |
| 状态行 | `写错过` + `上次你判断写错了`；`快忘了` + `有一阵没写，可能快忘了` |
| 排期行 | 下次练习 / `大约 10 月 3 日再练到` |
| 图片行 | 把这个字做成图片 / 缺墨小字：`最近一次没有笔迹，再写一次就能做图片。` |
| 词语反馈 | 换掉这个词语 |
| 自选 | 从自选的字移除 / `记录不会删掉，只是不再算自选的字。` |
| 底按钮 | 练这个字 |

- 状态：有记录（`detail`）/ 无记录（`detailEmpty`）/ 一次（`detailLong`）/ 多次（`detailMany`）；缺墨（`dPhotoOff`，`hr` 画 `noInk`）；无词语（`释义`）；自选（`dRmOn`）；写错过/快忘了行；深色/大字。**“加入自选”不在本组件**（K29 卡片属字库墨墙屏），移除后的撤销条也不在本组件（见 §6）。

#### 2.3.4 单字详情 · 无记录 `detailEmpty`（L49–L61）

- 差异：记录块标题 `还没有记录`，右说明 `判断过的每一次书写都会留在这里`；4 个空格；列表只有灰的 `把这个字做成图片` + `先写一次这个字，才能做成图片。`、[dWfOn] 换掉这个词语、[dRmOn] 从自选的字移除；**没有** 下次练习、写错过行。

#### 2.3.5 单字详情 · 一次 `detailLong`（L62–L74）/ 多次 `detailMany`（L75–L87）

- `detailLong`：亦 / yì / 6 画 / 部首 · 亠 / 词块 亦(红框)可；`记录了 1 次`、`首次记录 9 月 8 日`。
- `detailMany`：静，12 条写死（L406 `ds`/`vs='RWRRWRRWRRRR'`），`记录了 12 次`、`首次记录 8 月 12 日`。
- 两者列表：下次练习 → `schedule`；把这个字做成图片 › → `photo`（无缺墨分支）；换掉这个词语 → `wordFeedback`；[dRmOn]。标签写死“词语”。**模板没有写错过/快忘了行**（与 `detail` 不一致）。

#### 2.3.6 练习记录 `records`（L88–L94；逻辑 L408–L419）

- 布局：页头“练习记录”；`gap 26`。① 月份行：`9 月`（26px 宋体）+ `2026`（13px `--i3`），右 `‹ ›`（44×44，next `aria-disabled=true` 灰）。② 标题 `9 月有记录 N 天` + 说明。③ 日历卡（`radius 18; bg --c; border .5px --i5; padding 8 6 10`）7 列：星期行 26px 高；日期格 `min-height 44`，数字 30×30，下 5px 墨点（实心 `--i1`）；模板还有虚线圈 `canBack` 与空心点 `back`（补记残留）。④ “9 月字帖”块：右 `保存图片 ›`；纸卡（`padding 18 16 16`）5 列格子（右/下格线）+ 红角标 + 落款两行 + 26px 印；卡下说明。⑤ [recTodayOn] 列表行：`9 月 24 日写的字` / `这次的图片` / 右 `保存图片 ›` → `imageToday`。
- 数据：`rec = REC 中 '9-' 的日`；`recDaysTitle`；`days`：9 月前置 1 个空格（周二起始）、30 天、>24 灰、24 红 600；`nav:'day:9-N'` **仅当 `can.includes(i)`，而 `can=[]`（L412）→ 永不可点**；`sheet`：本月按首次出现排序、格子画**本月第一次**记录（`lastSep` 同名误导），角标 = 与前一格日期不同才标；`recSign = imgMonth().sign`；`recTodayOn = REC.some(d===today)`。
- 文案：

| 位置 | 文案 |
| --- | --- |
| 月 | 9 月 / 2026 |
| 标题 | `9 月有记录 {N} 天` |
| 说明 | 墨点表示这天有记录，不分对错。 |
| 星期 | 一 二 三 四 五 六 日 |
| 字帖块 | 9 月字帖 / 保存图片 › |
| 落款 | `二〇二六年九月 · 有记录N天 · N个字` / `按第一次写下的先后排列` / 印 字 |
| 卡下 | 点一个字看详情，红色小字是那天的日期。 |
| 今日行 | 9 月 24 日写的字 / 这次的图片 / 保存图片 › |

- 动作：`back`、`prevMonth`、`nextMonth`（禁用态仍带 nav）、`image34`、`detail:<字>`、`imageToday`。

#### 2.3.7 练习记录 · 历史月 `recordsHistory`（L95–L100）

- 差异：`8 月` 2026；prev/next 均可点；标题 `8 月有记录 N 天`（`rec` 取 `'8-'`）；31 天、前置 5 空格；字帖块仍是 `9 月字帖`（当前月），卡下说明改 `这里只能保存本月的字帖。`；无今日行。

#### 2.3.8 练习记录 · 压力 `recordsMany`（L101–L105；L488）

- 差异：`rec` 写死 21 天 `[1,2,3,5,6,8..20,22,23,24]`；字帖 `grid-template-columns:repeat(5,minmax(44px,1fr))`，`rmSheet` = `B40` 40 字合成笔迹；网格下居中 `全部 ›`（**无 data-nav**）；落款写死 `二〇二六年九月 · 有记录二十二天 · 二百个字`（与标题 21 天不一致）、小字 `按第一次写下的先后排列，先显示前 40 个`。

#### 2.3.9 练习记录 · 空 `recordsEmpty`（L106–L110）

- 差异：prev/next 都 `aria-disabled=true`；标题 `9 月还没有记录`；说明 `写一个字并判断对错，这天就会有一个墨点。`；日历无 nav；字帖块无右链接，纸卡换成 120px 虚线框 `这个月还没有可以放进图片的字`。

#### 2.3.10 引导页 `onboard`（L111–L115；L487）

- 布局：`padding 48 28 24; gap 30`：40px 红印“字”；标题 `一本安静的<br>手写簿`；说明；三行列表（一 回忆 / 二 写 / 三 对照）；底注；底栏 [obNoteOn] 说明框 `obNoteText` + 主按钮 `开始写第一个字`（`onFirst`）+ 链接 `obLink`（`onRestore`）。
- 文案：`每次给你几个字。先回忆，再写下来，最后和参考字形放在一起，由你自己判断写对没有。`；`回忆 / 看词语，想起空着的那个字`；`写 / 卡住了可以点「提示」，一次给一部分`；`对照 / 和参考字形并排，你来判断`；`不评分，不打卡。记录只存在这台手机上。`；`开始写第一个字`；`从备份文件恢复` 或（`onboardNote.repick`）`重新选择备份`。
- **与 D17 冲突**：第十稿去掉介绍页，首页“开始写字”直接进写字页。此预设仍保留（`MAIN` 含 `onboard`）。“首次从备份恢复”（`restoreOnboard`、`onboardNote`）这条能力去哪里承载需确认（§6）。

#### 2.3.11 结果页 `result`（L116–L118；逻辑 L421–L446）

- 布局：页头 X（`onClose`）标题 `这次练习`；`gap 28; padding 14 24 calc(32px + --fth)`。① 标题 26px（`resTitle` 或两行 `titleLines` 词块换行）+ 副标 13px `--i3`。② 4 列格子：1:1 本人笔迹 / 楷体灰字（S/A）+ 34px 说明行（楷体 15px 字 + 11px 结果，写错红）+ 红角标；`cursor:pointer; nav:'cell:'+i`。③ [resImgOn] 列表行 `这次的图片` / 右 `保存图片 ›` → `resultImage`；[resNoImg]/[resNoInk] 说明框。④ “这组字难不难”块：标题 + [diffOk] `下次会照这个调整`；3 个 44px 圆角 14 选项（idle/sel/dim）；[diffFail] 说明 + `先不选` / `再试一次`。⑤ 底栏（滚动模式 `--ftp:absolute` 浮底，上沿 24px 渐隐）：[resBf] `返回练习记录`（**永远 false**，L431）；[resStd] 主按钮 `再写一组`（`onAgain`）+ 链接 `回到首页`（`onHome`）。
- 数据：`R = P.result`；无 R 时用 `dayCells('9-24')`；`resTitle = R.count ? '这次记录了 N 个字' : '这次没有记下字'`；`xs` = 「A 字」看过答案，「S 字」跳过了；`resSub = R.sub || xs+'，没算在内。' + tapT`；`resImgOn = R.img && inkN>0`；`resNoImg = R.img && count===0`；`resNoInk = R.img && count>0 && inkN===0`；`diffs` 按 `R.diff`。
- 文案：

| 位置 | 文案 |
| --- | --- |
| 页头 | 这次练习 |
| 标题 | `这次记录了 {N} 个字` / `这次没有记下字` |
| 副标 | `「X」看过答案，「Y」跳过了，没算在内。点一个格子，可以对照参考字形、修改判断。`（无 R：`跳过和看过答案的字不算在内。`） |
| 格说明 | 写对 / 写错（红）/ 跳过 / 看过答案 |
| 图片行 | 这次的图片 / 保存图片 › |
| 无图 | 这次没有记下的字，没法做这次的图片。9 月字帖可以到练习记录里保存。 |
| 无墨 | 这次记下的字都没有笔迹，没法做这次的图片。9 月字帖可以到练习记录里保存。 |
| 难度 | 这组字难不难 / 下次会照这个调整 / 偏容易 · 刚刚好 · 偏难 |
| 难度失败 | 没保存上，刚才的选择没记下。 / 先不选 / 再试一次 |
| 底栏 | 再写一组 / 回到首页 /（死分支）返回练习记录 |

- 动作：`close`、`cell:<i>`、`resultImage`、`diff:0|1|2`、`diffStay`、`diffRetry`、`again`、`home`。
- 备注：**没有独立“图例”块**，格子说明文字本身充当图例；`resLine/resLineOn/resLineOn2/onResLine`（L434、L445）仍算但模板不用（D19 后的死代码）。

#### 2.3.12 第一次结果 `firstResult`（L119–L121）

- 差异：页头 `第一次练习`；标题 `第一次，<br>记录了 {firstN} 个字`（默认 5，D17）；5 列格子；日期行 `firstDateLine`（`8 月 12 日` / `md(R.date)`）；[remindOn] `练习提醒` + `先不用` / `开启提醒`（`remindOff/remindOn`）；难度块同上；底栏只有主按钮 `回到首页`。
- `firstSub`：`{xs}，没算在内。以后写哪些字，会参考这次的结果。点一个格子，可以对照参考字形、修改判断。`。

#### 2.3.13 这次选的字 `endPicked`（L122–L124）

- 差异：页头 `这次选的字`；标题 [pickDoneT] `这次选的字<br>写完了` / [pickEndT] `这次选的字<br>先写到这里`；网格列数 `pickCols`（<3 个时按个数居中，宽度 `calc((100% - 1px) * n / 3 + 1px)`）；日期行 `{日期} · 自己选字`；底栏 `pickLeave`（默认 `回到首页`，可传 `回到「静」`）。**无难度块、无图片行。**
- `pickSub`：`「额」「鲜」「境」都记下了。`（1 个时 `记下了。`）+ `{xs}，没算在内。` + [R.ended&&R.rest] `还有 {rest} 个字没写，没有记下。` + tapT。
- 与《改动清单》10.10 文案不一致：那里写标题“这次选的字 / 结束了”、“另外 N 个字没写，不算记录。”。

#### 2.3.14 字库写完 `noChars`（L125–L127）

- 页头 X（无 nav）`习字`；空态 尽；`这个字库的字都有记录了`；`可以换一个字库，或者先练写错过的字。`；主按钮 `更换字库` → `libSwitch`；链接 `看写错过的字 ›` → `wrongList`。

#### 2.3.15 旧版本照片 `photo`（L128–L132）

- 全页深底 `#1F1B18` / 字 `#F4F0E7`；页头 X（无 nav）`「户」的旧记录`；3:4 条纹占位 `旧版本拍下的照片`；底部 `旧版本的记录` / `旧版本拍照留下的记录，只能看，不能做成图片。<br>备份时会一起存下。`。字“户”写死。注意 `data-nav="photo"` 在单字详情里既通向这页，也是“把这个字做成图片”的键（同名，见 §5）。

#### 2.3.16 年度报告 `annual`（L133–L141；逻辑 L492–L498）

- 布局：页头 `年度报告`；`gap 30`；顶部 `2026`（13px/.2em）；四节，每节 20px 宋体标题 + 内容 + 15px 说明；页底说明。
- 数据：`V = REC(R|W)`；`annN` = 去重字数；`byM[月] = Set(日)`，`annMonth` = 天数最多月（并列取月份大的）；`annRareOn = cs.includes('豕')`（无字频表）、`annRare = ref('豕')`（**标准字形，非笔迹**）；`f` = 最早一条 → `annFirst = hr(f)`（本人笔迹）。
- 文案：

| 节 | 文案 |
| --- | --- |
| 一 | 一 · 今年有记录的字 / `{N}` 个字 / 写完并判断过对错的字，写对写错都算。 |
| 二 | 二 · 有记录天数最多的月份 / `{M} 月有记录 {N} 天`（无：`还没有记录`）/ 只看哪天有记录，不分对错。 |
| 三 | 三 · 较少见的字 / 豕 shǐ / 今年有记录的字里，它最不常用。 |
| 四 | 四 · 这一年第一个有记录的字 / `{字}` / `{M 月 D 日} · 你当时的笔迹` |
| 底 | 只算今年的记录。这一页不能保存成图片。 |

- `annualEmpty`（L142–L144）：空态 年；`今年还没有记录`；`写字并判断对错后，这里会汇总你今年的记录。`。

#### 2.3.17 设置 `settings`（L145–L152；逻辑 L463–L467）

- 布局：页头 `设置`；`gap 28`；四组（组标题 20px 宋体 `--i2` + 列表）。开关：44×26 圆角 13，on `bg --i1` 白/纸色 knob 左 21px，off `bg --i5` + `inset 0 0 0 1px --i3` knob `#FFF9F1` 左 3px；分段控件：`padding 3; radius 12; bg --off`，选中项 `bg --c; inset ring --i3; shadow`。
- 文案与动作：

| 组 | 行 | 右值 / 控件 | nav |
| --- | --- | --- | --- |
| 练习 | 练习范围 | `{库名} ›` | `libSwitch` |
| 练习 | 按键音 | 开关 | `set:sound` |
| 练习 | 练字背景音 | 分段 关 / 雨声 / 炉火 | `set:bg:0/1/2` |
| 练习（组下说明） | 背景音只在写字的时候响。 | | |
| 提醒 | 练习提醒 / 小字：通知会给一个词语和拼音，让你想想是哪个字。 | 开关 | `set:remind` |
| 提醒 | 写完提示做成图片 | 开关 | `set:photoHint` |
| 显示 | 更大字体 / 小字：打开后，文字和写字格都放大一号。<br>手机字号调大时，这里也会跟着变大。 | 开关 | `set:large` |
| 显示 | 外观 | `跟随系统 ›` / `浅色 ›` / `深色 ›` | `set:dark` |
| 数据 | 备份与恢复 | `上次备份 9 月 1 日 ›` / `还没有备份 ›` | `backup` |

- 默认 `SD = {sound:true, remind:false, photoHint:true, large:false}`，`bg:1`，`dark:'auto'`（L463）。`settings.large` **不影响本组件的 `--k`**（只由 `size==='compact'` 决定，L369）。

#### 2.3.18 设置 · 通知被拒 `settingsDenied`（L153–L160）

- 差异：练习提醒小字 `手机关了拾字的通知，收不到提醒`；提醒组下说明 `想收到提醒，请到手机设置里打开拾字的通知。<br>去手机设置 ›`（**无 nav**）。

#### 2.3.19 关于 `about`（L161–L165）

- 页头 `关于拾字`；64px 印 + `拾字` + `1.0 · 2026 年 9 月`；楷体 17/1.9 居中 `提笔忘字，不是忘了，<br>只是很久没写。`；三行：`隐私` / `记录只存在这台手机上 ›`；`字形和字源的出处` / `开源资料 · 致谢 ›`；`给我们写信` / `›`。**三行都没有 `data-nav`**——子页原型没做（交接备注 §10.7 要求做）。

#### 2.3.20 备份与恢复 `backup`（L166–L168；逻辑 L470–L482）

- 布局：页头 `备份与恢复`；`gap 28; padding-bottom var(--bkpb,32px)`。① 状态块：13px/.14em 标签 `上次备份`；26px 宋体 `lbDate`；13px `lbNote`。② 段落（有记录 / 无记录两版）。③ [bkNoteB] 说明框 `bkNote` + [bkRetryOn] 下划线链接 `再试一次` → `restoreRetry`。④ 主按钮 `导出备份文件`（无记录时 `disabled` 灰）→ `export`。⑤ 列表 `data-bk-end="1"`：`从备份文件恢复` + 小字 → `restore`；`清空所有记录`（红）→ `clearAll`（无记录时 `aria-disabled` 灰、无 nav）。
- 数据（L470–L474）：`never = lastBackup===''`；`LB = lastBackup || '9-1'`；`noRec = records && records.length===0`；`lbDate = never ? '还没有备份' : md(LB)`；`bkCanExp = !noRec`；`lbNote`：noRec → `(bkLast||'') + '现在没有记录。'`；有 `bkLast` → 原句；never → 空；否则 `(lastBackup==null ? base==='backupDone' : !!bkMatch)` → `现在的记录都已经备份了。` 否则 `上次备份以后记录有改动，还没有备份。`。
- 文案：

| 位置 | 文案 |
| --- | --- |
| 标签 | 上次备份 |
| 日期 | `还没有备份` / `9 月 1 日` |
| 状态句 | `现在的记录都已经备份了。` / `上次备份以后记录有改动，还没有备份。` / `{bkLast}现在没有记录。` / `{bkLast}` |
| 段落（有记录） | 记录只存在这台手机上。换手机、清理浏览器或删掉拾字之前，先导出一份备份文件。 |
| 段落（无记录） | 记录只存在这台手机上。 |
| 说明框 | `{bkNote}` + `再试一次` |
| 按钮 | 导出备份文件 |
| 恢复行 | 从备份文件恢复 / `会替换现在的记录，离开这一页前可以撤销`（无记录：`离开这一页前可以撤销`） |
| 清空行 | 清空所有记录 |

#### 2.3.21 备份 · 已替换/已清空 `backupDone`（L169–L171；L477）

- 差异：无“记录只存在…”段落；[bkNoteOn] 说明框；恢复行无小字；底部**撤销条**（`position:absolute; left/right 16; bottom 34; z 3; padding 14 16; radius 16; bg #3B2F28; color #F4F0E7; shadow --ubs`）两行 `undoL1` / `undoL2` + 右 `撤销`（`min-height 44`）→ `undo`。默认 `已换成备份里的记录` / `离开这一页前可以撤销`。深色阴影 `inset 0 0 0 .5px rgba(220,207,184,.18),0 10px 28px rgba(0,0,0,.45)`（L504）。

#### 2.3.22 存不了记录 `storageBlock`（L172–L174）

- 无页头；空态 存；`现在存不了记录`；`可能是存储空间不够，或者浏览器不允许保存。<br>解决之前先不能写字，免得写了存不下。`；主按钮 `再试一次`（`onRetryStore`）；链接 `怎么解决 ›` → `howFix`。对应 D07“失败留现场”。

#### 2.3.23 换库列表 `libSwitch`（L186–L188；逻辑 L459–L461）

- 弹层规格（**底部弹层通用**）：遮罩 `position:absolute; inset:0; z 4; bg --scrim`（`data-nav="closeOver"`）；面板 `absolute left/right/bottom 0; z 5; max-height 88%; overflow auto; radius 28 28 0 0; bg --sh; shadow 0 -10px 30px rgba(48,38,26,.12); padding 10 24 --fb; gap 18`；顶部把手 36×5 圆角 3 `--i5`。无动效。
- 内容：标题 `更换字库`；4 行（`min-height 62; padding 10 0`）：库名（当前 500）/ 13px 说明 / 15px 数量行（`· 可以练 N 个字` + [libNMOn] `· 有记录 M 个`，用 `margin-left:-14px` 的 `·` 悬挂对齐）/ 右 `正在用`（13px `--ar`）或 `›`（15px `--i3`）；底注。
- 文案：

| 库 | 说明 | 数量 |
| --- | --- | --- |
| 规范常用字 | 日常最常用的字。大多数人从这里开始。 | 可以练 3500 个字 · 有记录 {M} 个 |
| 规范次常用字 | 看书看报会碰到的字。常用字写熟了，可以换这个。 | 可以练 2976 个字 |
| 规范专门用字 | 人名、地名和古文里的少见字。目前能练的大约一半。 | 可以练 818 个字 |
| 小学初中常用字 | 小学到初中语文课要求会写的字。适合陪孩子一起练。 | 可以练 2482 个字 |
| 底注 | 字表参考教育部《通用规范汉字表》。有些字拾字还没收进来，暂时不能练，所以能练的字比原表少。 | |

- 数据：`M = P.records 中 R/W 去重字数`（默认 30），**只给第一库**（L461 注释：原型没有逐库字表）。
- 动作：`lib:规范常用字` 等四个、`closeOver`。

#### 2.3.24 换库确认 `libConfirm`（L189–L191；L485–L486）

- 弹层规格（**居中确认通用**）：遮罩同上；面板 `absolute left/right 24; top 50%; translateY(-50%); z 5; radius 24; bg --c; shadow 0 20px 50px rgba(48,38,26,.2); padding 24 20 20; gap 14`；标题 20px/1.45 宋体；正文 15/1.75 `--i2`；4px 垫；双按钮 `grid 1fr 1fr; gap 12`。
- 文案：标题 `换成「{libTarget}」？`（默认 小学初中常用字）；[libOk] `以后的新字从这个字库里来。<br>已有的记录、自选的字和写错过的字都不变。` + `取消`（`closeOver`）/ `换成这个库`（`libConfirm`）；[libFail] `没保存上，还是原来的字库。` + `先不换`（`libStay`）/ `再试一次`（`libConfirm`）。

#### 2.3.25 图片预览 `image34` / `image11`（L192–L201；L483–L484、L489–L490）

- 底部弹层；标题行：`imgTitle`（默认 `9 月字帖`）+ 分段 `3:4` / `1:1`（选中 `bg --c; shadow`）→ `image34`/`image11`；预览：3:4 为 228×304（`scale(228/360)` 的 360×480 板），1:1 为 250×250（`scale(250/360)`）；`border .5px #DED8CD; shadow 0 10px 24px rgba(59,47,40,.08)`；说明 `imgNote`；[imgOk] `分享`（`imgShare`）/ `保存图片`（`imgSave`）；[imgFail] `分享` / `再试一次`（`imgSave`）。
- `imgNote`：失败 → `没能存进相册。请到手机设置里允许拾字添加照片。`；否则 `P.imgMsg || P.imgNote ||` (`「X」「Y」最近一次没有笔迹，不在图里。` 若本月有缺墨) + `存下来的是图片，不能用来恢复记录。`。
- 板内容：`P.imgChar` → `charEl`（单字图 A05）否则 `imgEl(ratio,26)`（月字帖 / 传 `imgItems` 时为本次图片）。
- 用途：9 月字帖（我的、练习记录）、这次的图片（结果页 `resultImage`、练习记录 `imageToday`）、单字图片（单字详情 `photo`）——三者都走这一对预设，靠 `imgTitle/imgItems/imgChar/imgSign` 区分。

#### 2.3.26 系统分享 `share`（L202–L204）

- iOS 分享面板示意（固定 `#E9E9EB` 等系统色，不随主题）：文件行 `拾字-2026年9月.png` / `PNG 图片`；5 个灰块；`系统分享面板 · 由系统提供，不仿制`。

#### 2.3.27 替换确认 `restoreConfirm`（L205–L207；L478–L481）

- 居中确认；[rcHas] 标题 `用备份替换现在的记录？`，正文 `这份备份是 9 月 1 日的，里面有 {bkN} 个字的记录。<br>现在 {curN} 个字的记录会被替换。离开这一页前可以撤销。`，按钮 `取消` / `替换`；[rcNone]（无记录，Y04）标题 `用这份备份恢复记录？`，正文只有第一句，按钮 `取消` / `恢复`。均 → `restoreOk`。
- `curN = new Set(P.records.map(r=>r.c)).size`（**含 S/A**，默认 30）；`bkN = P.backupCount ?? 20`；日期“9 月 1 日”写死。

#### 2.3.28 清空确认 `clearConfirm`（L208–L210；L482、L485）

- **底部弹层**（不是居中框）；标题 `清空所有记录？`；[clearOk] `{curN} 个字的记录都会被删掉。离开这一页前可以撤销。` + `取消` / 红边框 `清空`（`clearOk`）；[clearFail] `没保存上，记录都还在。` + `先不清空`（`clearStay`）/ `再试一次`（`clearOk`）。

#### 2.3.29 修改判断弹层 `csOn`（L211–L225；逻辑 L448–L457）

- 由 `P.sheet` 触发，可叠在任何屏上；遮罩 z 7（`onCsClose`），面板 `absolute bottom 0; height 456px; z 8; bg --p; radius 24 24 0 0`；把手；标题行 `top 24`：`csTitle` 17px/500 + 右按钮 `csX`；两格 `top 88`：左 `你的书写`、右 `参考字形`（各 1:1，`border .5px --i5; radius 12; bg --c`，标签 13px/.12em）；说明 `top 316`；[csOk] 主按钮 `top 356; height 52` `csFlip`（`onCsFlip`）；[csFail] `先不改`（`onCsStay`）/ `再试一次`（`onCsFlip`）。**所有尺寸不乘 `--k`**。
- 文案：`csTitle` = `「X」这次记为写对` / `写错` / `「X」看过答案` / `「X」跳过了`；`csX` = 判断过 `取消` 否则 `关闭`；`csFlip` = `改为写错` / `改为写对`；`csNote` = fail `没改成，还是原来的判断。` / 判断过 `改了只换掉这一次，不会多算一次。` / A `看过答案的字不判断对错，没算在内。` / S `跳过的字没算在内。`；无笔迹且未判断时左格文字 `这次没写`。
- 参考字形深色用 `--i3`、浅色 `--i2`；笔迹线宽 ×1.41。

#### 2.3.30 图片“板” `board`（L226、L374–L378）

- `board ∈ {img34,img11,char34,char11}` 时整个组件只输出 360×480 / 360×360 pt 的纸板（导出 3× = 1080×1440 / 1080×1080），`count` 26/80，`marks` 画安全区虚线。

---

## 3. 数据契约

### 3.1 dc props（`data-props` L232 + 代码里读取的 `P.*`）

| prop | 类型 / 取值 | 用途（行） |
| --- | --- | --- |
| `screen` | 31 个枚举（见 §1.2） | 选屏 |
| `theme` | `'light'|'dark'` | `TH` 令牌 |
| `size` | `'std'|'compact'` | compact：360×640、`--k:1.3`、`--fb:20px`、`--sbh:40px`、标题允许词块换行 `--nw:normal` |
| `lamp` | 0.04–0.06 | 深色暖灯透明度 |
| `board` / `count` / `marks` | `''|img34|img11|char34|char11`；26/80；bool | 纸板输出 |
| `data` | `''|'proto'` | `'proto'` 用 `SZProto.build('today').records` 与 `SZProto.SAMPLES` |
| `list` | `''|'wrong'|'forget'` | 单字详情强制显示写错过/快忘了行 |
| `under` | `string|null` | 弹层底屏；`'none'` 只画弹层 |
| `mineSheet` | bool | 我的页是否画字帖 |
| `bkRetry` | bool | 备份说明框后的“再试一次” |
| `records` | `Record[]`（§3.2） | 一切派生数字 |
| `chars` | `{[字]: {py, word:string[], blank:number, gloss?:string, groups?}}` | 单字详情字卡 |
| `char` | 字 | 单字详情目标字 |
| `added` | `string[]` | 自选字 → `dRmOn` |
| `today` | `'m-d'` | 默认 `'9-24'` |
| `result` | `Result`（§3.3） | 结果页族 |
| `sheet` | `Sheet`（§3.4） | 修改判断弹层 |
| `settings` | `{sound,remind,photoHint,large:boolean; bg:0|1|2; dark:'auto'|'light'|'dark'}` | 设置页 |
| `library` / `libTarget` / `libFail` | 库名 / 库名 / bool | 练习范围、换库确认 |
| `lastBackup` | `'m-d'` / `''`（从未）/ `null|undefined`（默认 9-1） | 我的、设置、备份 |
| `bkMatch` / `bkLast` / `bkNote` / `backupCount` | bool / 结论句 / 说明句 / number | 备份状态句、说明框、替换确认 |
| `undo` | `{l1,l2}` | 撤销条两行 |
| `clearFail` | bool | 清空确认失败分支 |
| `imgItems` / `imgSign` / `imgChar` / `imgTitle` / `imgNote` / `imgMsg` / `imgFail` / `imgTop` | `[{c,d,v,tag,strokes,ink}]` / 落款 / `{c,d,v,py,strokes}` / 标题 / 说明 / 说明覆盖 / bool / bool | 图片弹层与板 |
| `onboardNote` | `{text, repick:boolean}` | 引导页说明框与链接 |
| `bare` / `fixed` | bool | 去外框；固定 852 高滚动模式 |
| `onNavigate` | `(key:string)=>void` | 所有动作出口 |

### 3.2 记录 `Record`（组件读取的字段；来源 proto-model `seed()` 36416a1c…js L77–L79）

```
{ id:'d12', c:'静', d:'9-8', v:'R'|'W'|'S'|'A', i:number(当天序号), help:''|'answer',
  strokes?: [[{x,y,w}]]  // 345×345 空间，实时写下的记录才有
  ink?: 'none'|'shape'   // 10.12：none = 有记录但没留下笔迹；shape = 只有形状无 t/p
}
```
- `REC` 只取 `v∈{R,W}`（L262）；S/A 不算记录（D18、D23）。
- 日期 `'m-d'` **没有年份**；`dn()`（L263）以 `m*100+d` 比较。
- 组件读 `r.help` 为布尔（L261 `help:!!hp`），proto-model 存字符串 `'answer'`。

### 3.3 结果 `Result`（L423 注释 + L429–L446）

```
{ items:[{c, v, help, strokes?, d?}], count:number, inkCount?:number, img?:boolean,
  line:{c,v,changed}|null (已无 UI), diff:0|1|2|null, diffFail?:boolean, date:'m-d',
  leave?:string, remind?:'ask', title?:string, titleLines?:[[a,b],[a,b]], sub?:string,
  ended?:boolean, rest?:number }
```

### 3.4 修改判断 `Sheet`（L448）：`{ c, v:'R'|'W'|'S'|'A', strokes?, d?, fail?:boolean }`

### 3.5 `onNavigate` key 全表（模板 `data-nav` + 代码 `nav()`）

| key | 来源屏 | 含义 |
| --- | --- | --- |
| `back` | 所有二级页 | 返回 |
| `close` / `home` / `again` | 结果页族 | 关闭 / 回首页 / 再写一组 |
| `home` `library` `mine` | tabs | 三导航 |
| `records` `settings` `backup` `annual` `about` | 我的、设置 | 进入子页 |
| `image34` `image11` `imageToday` `resultImage` `imgShare` `imgSave` | 我的、练习记录、结果页、图片弹层 | 图片预览/比例切换/分享/保存 |
| `detail:<字>` | 字帖格子 | 单字详情 |
| `day:<m-d>` | 日历（**当前永不生成**） | 日详情 |
| `prevMonth` `nextMonth` | 练习记录 | 翻月 |
| `practiceOne` `schedule` `photo` `wordFeedback` `rmCustom` `wrongList` `forgetList` | 单字详情 | 练这个字 / 排期 / 做图片 / 换词 / 移除自选 / 两张清单 |
| `cell:<i>` | 结果页格子 | 打开修改判断弹层 |
| `csClose` `csFlip` `csStay` | 修改判断 | 关闭 / 改判断 / 失败留在原判断 |
| `diff:0|1|2` `diffStay` `diffRetry` | 难度块 | D6 |
| `remindOn` `remindOff` | 第一次结果 | 提醒卡 |
| `libSwitch` `lib:<库名>` `libConfirm` `libStay` `closeOver` | 换库 | |
| `set:sound` `set:remind` `set:photoHint` `set:large` `set:dark` `set:bg:0|1|2` | 设置 | |
| `export` `restore` `restoreOk` `restoreRetry` `clearAll` `clearOk` `clearStay` `undo` | 备份 | |
| `retryStore` `howFix` | 存不了记录 | |
| `first` `restoreOnboard` | 引导页 | |

### 3.6 外部全局与资源

- `window.SZInk`（989b48fc…js）：`outline(pts,floor)→path d`、`pick(c,kind,n)`、`fromRecord(rec,base)`、`synth(pts)`、`wrongFix(st,W,cc)`；派发 `szink` 事件触发重绘。
- `window.SZProto`（36416a1c…js，`KEY='shizi-proto-v9'`, `VERSION=4`, `TODAY='9-24'`）：`build('today')`、`SAMPLES`、`lists(records,today) → {latest, wrong, forget(≤12), forgetAll}`（写错过 = 最近有效记录为 W；快忘了 = 最近为 R 且 >90 天，按最早排序）。
- `window.__szStore = {data:{[字]: hanziWriterJson|null}, pend:{}}`，来源 `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/<字>.json`（`strokes[]` 路径、`medians[][]`）。
- 组件自身**不读写任何 localStorage / IndexedDB**。

### 3.7 图片板几何常量（L325–L355）

- 板 360×480（3:4）/ 360×360（1:1）pt，导出 3×；边距 24pt；网格宽 312pt；列数 5–9；落款区 118/3 pt；印 26pt；角标 11/13（格宽 <42 时 8/9，`top 2/3, left 3/4`）；格线 `#A6533F47`；纸色 `#FBF8F2`；落款字 26/3 px、`.16em`、`#5D5952`。单字图：字宽 ≤60% 板宽，信息行 11/13，右下 `拾字` + 印。

---

## 4. 与第十稿（v10）决定的关系

| 决定 | 本组件现状 | 结论 |
| --- | --- | --- |
| D17 第一次 5 个字、去掉介绍页 | `firstResult` 默认 5、5 列 ✓；**`onboard` 介绍页预设仍在**（L111–L115、`MAIN` L274） | 冲突：需删 `onboard`，但“首次从备份恢复”（`restoreOnboard`/`onboardNote`）去处待定 |
| D18 看过答案不判断 | `v:'A'`→`vd()` “看过答案”；格子画灰楷体（L422）；`csNote` A 分支；`xs` 句 ✓ | 保留 |
| D19 修改入口移到结果页格子 | 格子 `nav:'cell:'+i` → `csOn` 对照 + `改为…`（L117、L211–L225、L448–L457）✓；旧结果行 `resLine*` 只剩死代码（L434、L445） | 保留；清理死代码 |
| D20 写完直接进结果页 | 本组件无中间页 ✓ | 保留 |
| D21 查字/加入自选合并；自选可在详情移除并撤销 | 加入不在本组件；移除行 `rmCustom` ✓（L47）；**撤销条不在本组件**（只有备份撤销条 L171） | 撤销 UI 由壳承担，需确认 |
| D22 中途结束这组 | `endPicked` 支持 `R.ended/rest`、`pickEndT` ✓；零判断轻提示不在本组件 | 文案与《改动清单》10.10 不一致（§6） |
| D23 写错过 / 快忘了 | 命名 ✓；规则走 `Zp.lists`（只看最近有效记录，S/A 不算）✓（L392–L394） | 保留；`detailLong/Many` 模板缺该行 |
| D24 去掉补记；撤销到离开页面；结论句；无记录不催 | 撤销条文案 `离开这一页前可以撤销` ✓；`bkLast` 结论句 ✓；`noRec` 禁导出/清空、状态句 `现在没有记录。` ✓；日历只标写过的日 ✓；**但模板保留 `canBack`/`back` 补记视觉（L91、L98、L104、L109）**，`resBf` 死分支 | 保留逻辑，删残留字段 |
| D11 月图取月内**最后**判断 | `imgMonth()` 取本月**第一次**（L320，注释引 M02，v10 handoff 二节“字帖格子用这个月第一次写这个字那一次的笔迹”） | **decisions.md D11 与 v10 M02 互相矛盾**，需产品裁决并回写决定表 |
| D07 保存成功才推进 | `storageBlock`、各失败分支（diffFail/libFail/clearFail/csFail/imgFail）✓ | 保留 |
| D12 超 80 字 pending | 只有 80 字演示板和 `recordsMany` “先显示前 40 个 / 全部 ›”（无 nav） | 待定不变 |
| D13 字体 | 加载 LXGW WenKai GB（未改名 ShiziKai）、Noto Serif SC 400/500 | 应按 D13 打包 |
| D14/D15 旧照片 | `photo` 预设“只能看，不能做成图片” | 是否进 v1 待定（交接备注 §6：默认不算有记录） |
| D03 / L08 对照方向 | `你的书写` 左、`参考字形` 右 ✓（L219–L220） | 保留 |
| D6 / D7 / D10 待定 | 难度块（L117/L120）、`大约 10 月 3 日再练到`（L47 写死）、`写完提示做成图片` 开关（L148） | 原型照文案写；工程定不下来就删 |
| 文案清单 | C038–C140 所列新句在本组件均已落地（抽查：C045、C052、C057、C063、C090、C099、C107–C109、C132–C140 与模板一致） | 保留 |

---

## 5. 风险与坑

1. **无年份的日期**：`d:'m-d'`（L243）→ 年度报告“只算今年”无法成立、`recordsHistory` 写死 8 月、`signM` 写死“二〇二六年九月”、`imgMonth` 写死 `'9-'`；正式版记录必须带完整日期，且跨年比较要重写。
2. **D11 vs M02**：月字帖笔迹取第一次还是最后一次，两份权威文档相反（见 §4）；`imgMonth()` 变量名 `last` 实为 first，容易被“修回去”。
3. **`aria-disabled` 仍触发导航**：`nextMonth`（L89）、`prevMonth`（L109）带 `data-nav` 又 `aria-disabled=true`，事件委托不检查禁用；壳或正式版必须拦。
4. **`curN` 口径不一致**：替换/清空确认的“N 个字”用全部记录去重（含 S/A，L478），换库“有记录 M 个”只算 R/W（L461）；D23 口径应统一为 R/W。
5. **`data-nav="photo"` 双义**：单字详情“把这个字做成图片”和旧照片页 `photo` 预设同名（L47 / L128）；正式路由要区分。
6. **默认演示值会泄漏**：不传 props 时 `lastBackup='9-1'`、`bkN=20`、`curN=30`、`libTitle='规范常用字'`、结果页“这次记录了 6 个字”等（L470、L478、L429）；正式版不得有这些回落。
7. **写死项**（交接备注 §4 已列）：`大约 10 月 3 日再练到`、四库“可以练 N 个字”、备份文件日期“9 月 1 日”、年度报告 `豕 shǐ`、`recordsMany` 落款 22 天 vs 标题 21 天（L104/L410）。
8. **CDN 依赖**：参考字形与合成笔迹都要 `hanzi-writer-data`；无网时 `ref()` 回落楷体文字、`hand()` 返回空格（历次格子空白）；正式版需本地笔画数据与 I04/10.13 的缺数据分支。
9. **大字模式只是 `--k` 缩放字号**：34px 周格、44px 触控、228/250px 预览、`csOn` 面板 456px 与绝对 `top 88/316/356`（L214–L223）都不随 `--k`；更大字体下修改判断弹层会挤压/溢出；`settings.large` 与 `--k` 无绑定（L369）。
10. **日历日详情不存在**：`can=[]`（L412）→ `day:` 永不生成；如果产品要“点某天看当天写的字”，此处没有规格。
11. **撤销条与内容重叠**：撤销条 `absolute bottom 34`（L171），页面 `padding-bottom var(--bkpb,32px)` 但组件从不设 `--bkpb`；长列表会被遮。
12. **死代码**：`AGAIN`、`resLine*`、`onResLine`、`resBf`、`libTitle`、`libCount`、`setDark`、`d.back/canBack` 数据（补记）。
13. **`LATEST` 取数组末条而非按日期**（L264），依赖 `records` 已按日期+序号排序；proto-model 的 `lists()` 用 `doy`+`i` 比较更稳。
14. **弹层层级**：`closeOver` 遮罩 z4/面板 z5；`csOn` z7/z8；撤销条 z3；Home 指示条 z6——正式版需统一 z-index 规范。
15. **底部弹层与居中框都没有动效**（无 transition/animation）；交接备注要求“页面切换一律 iOS 原生方式（含左边缘右滑返回）”，原型不提供规格。
16. **字体加载方式**：运行时向 `document.head` 注入外链（L13），PWA 离线首屏会闪回系统字体；D13 要求随包分发。
17. **`componentDidMount` 60ms 轮询** 直到全局出现（L279）；正式版不应有这种等待。
18. **紧凑版可点控件不是 `<button>`**（`span[data-nav]`），交接备注要求正式版一律用按钮并带 44px 触控。
19. **深色下图片板与分享面板固定颜色**：`imgEl/charEl` 永远 `TH.light`（纸色，预期），`share` 用 iOS 浅色系统色（示意），`photo` 固定深底；正式版分享面板由系统提供。
20. **K03（300 字导出→替换→撤销后记录数不变）**在本组件无法验证——组件无状态，所有记录操作在壳/存储层。

---

## 6. 未解问题

1. `onboard` 介绍页按 D17 删掉后，“第一次打开时从备份文件恢复”（`restoreOnboard`、`onboardNote.repick`）放哪个页面？
2. 移除自选后的撤销（D21/L07）由谁渲染、文案是什么？本组件只有备份撤销条。
3. 月字帖格子取“本月第一次”（M02）还是“月内最后判断”（D11）？两份权威文档冲突。
4. `endPicked` 文案：组件“先写到这里 / 还有 N 个字没写，没有记下。” vs 《改动清单》10.10 “结束了 / 另外 N 个字没写，不算记录。”，以哪个为准？
5. 结果页是否需要独立“图例”块？组件只用格子说明文字与红色表示写错。
6. 日历某一天可点（`day:`）是否为需求？现在永不可点，且没有日详情屏。
7. 年度报告“较少见的字”需要字频表；“今年”需要带年份的记录日期——二者数据源未定。
8. `更大字体` 与 `size=compact`（`--k:1.3`）是否同一件事？系统字号放大时的 `--k` 映射未给。
9. `schedule`（下次练习行）与 `wordFeedback`（换掉这个词语）点进去是什么页？本组件没有对应屏；`howFix`（怎么解决）同样无目标。
10. 旧版本照片页 `photo` 是否在 v1 范围（D15 无正式用户、迁移需求存疑）？
