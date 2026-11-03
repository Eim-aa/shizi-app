# E · index.html 壳层：三 tab、首页、字库墙、我的、印历、月帖、年报、单字详情、收字面板、分享图片、字卡 + HTML 结构与 CSS 令牌

> 阅读范围：`/Users/orange/Documents/ChatGPT/astraworld/shizi-app/index.html`（3102 行）中 CSS 19–654、HTML 655–1032，以及 JS 段「印历与补帖」1911–1934、「月帖」1934–1963、「年度报告」1963–1971、「单字详情」1971–2006、「字盒」2006–2087、「底部三 tab + 首页大印章」2792–2863、「＋加字面板」2863–2915、「今日字帖分享」2915–2923、「手写字卡」2923–2986。为解释壳层行为另外查阅了 1058–1141（存储键/形状）、1319–1376（声音/字卡偏好）、1553–1618（题记/今日一字）、1755–1800（视图切换/历史）、1840–1910（首页/我的渲染）、1262–1301（activity 形状）、1144–1180/1804–1810（recentInk 契约）以及 iOS 壳 `ios/ShiziApp/ShiziApp/WebViewController.swift` 的消息分派。v10 决定依据 `docs/handoff/decisions.md`（D01–D25）、`docs/product/04-v10-handoff.md`、`docs/design/v10/交接备注-第十稿交接版.md`、`docs/design/v10/第十稿-文案修改清单-第十稿交接版.md`（第零节统一口径）、`docs/design/v10/第十稿-改动清单-第十稿交接版.md`、`docs/design/v10/第十稿-边开发边改清单-第十稿交接版.md`。以下行号均指 index.html，除非另注。

## 1. 概览

- 整个 App 是**单文件 PWA**：一个 `<style>`（19–654）、一段 HTML（655–1032）、一段约 2060 行的内联 JS（1037–3097），外链只有 `hanzi-writer.min.js`、`fsrs6.min.js`、`deck-data.js`、`data/context-overrides.js`（1033–1036）和 SW 注册（3098–3100）。CSP 禁止一切外域（第 5 行），所以字体、噪点纸纹、图标全部内嵌或同源。
- **视图切换没有路由**：十个「视图」是 `.wrap` 下的同级 `div`（`VIEW_IDS`，1766），`displayView(view)`（1779）逐个把 `style.display` 设成 `flex`/`none`，同时决定底部 tab 是否显示、哪个 tab 高亮，并 `scrollTo(0,0)`。弹层（收字、换库、单字详情、字卡等）是 `.sheetMask` 加 `.open` 类（541–542）。焦点管理几乎没有（只在收字面板和查字框 `focus()`），历史栈只在写字页装了一层 `pushState`（1769–1778）。
- **首页**由日期+时辰（`dateCn()+timeWord()`，1844–1846，汉字数字）、竖排题记（52 条古籍语料 `DAILY_MOTTOS`，1553–1606，按日期哈希轮换 1608–1618）、大标题「今天拾十五个字」、主印章按钮（`#startBtn`，随状态显示「拾/续/再」）和底部「今日拾得/今日一字」一行（1884–1893）组成，右上角是「收字」入口（684）。
- **字库墙**（`renderBook`，2027）是六列 `.memoryChar` 按钮（349），墨色由 `memoryInkLevel()`（2010）映射到 `--memory-1/3/5`，只列有记录（`seen>0`）的字；上方是换库卡、策展句（`bookCuratorData`，2011）、查字框（2035–2041），下方是「暂不支持练习」的拍字愿望区（`renderWildWishes`，2100）与「导出月帖」。
- **我的**（`renderMe`，1904）内嵌印历（`renderCalendar`，1918，含 7 天补帖入口）、「写得不稳的字」卡、本月拾字帖缩略卡、设置/备份两行、年报脚注；设置是独立视图（876–915），含在学字库、纸墨声音、背景音、字卡提示、提醒（仅 iOS 壳）、更大字体、导出/恢复/清空、`?dev=1` 开发工具。
- **图片生成**三路：今日字帖 1080×1440+（`renderPracticeCardCanvas`，2955）、月帖 1080×1440（`renderMonthlyPostCanvas`，1943）、手写字卡 3:4 / 1:1（`renderHandCardCanvas`，2932）；分发统一为「iOS 原生桥 → Web Share（files）→ `<a download>`」三级回退，返回 `{route,...}`。
- 相对 v10：壳层骨架（三 tab、单文件、令牌系统、`displayView`、弹层机制、分享回退链）可保留；**首启页、补帖、收字/拍字 OCR、写得不稳的字页、策展句、题记轮换、汉字数字**等与 D17/D21/D23/D24 及文案第零节直接冲突；字库要改成「墨墙 + 写错过/快忘了 + 统一查字组件」，我的要改成「这一周 → 月字帖 → 练习记录/备份与恢复/设置/关于」四排结构。

## 2. 组件/模块清单

复用判断口径：**可直接复用**=逻辑与 v10 一致或与产品无关；**可抽取改造**=骨架可用但需改文案/结构/数据口径；**应重写**=结构与 v10 差异过大；**与 v10 决定冲突**=继续存在会违反 D 项或第零节口径。

### 2.1 文档头、令牌与全局样式

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 文档头/CSP/PWA meta | 1–18 | `lang=zh-CN`；CSP `default-src 'self'`、`img-src 'self' data: blob:`、`font-src 'self' data:`、`connect-src 'self'`；`viewport-fit=cover`；双 `theme-color`（浅 `#f4efe2` / 深 `#1d1a15`，8–9）；`shizi-asset-build` 版本戳（11）；manifest、apple-touch-icon | — | manifest.webmanifest、icon-*.png | 可直接复用 | CSP 禁止外域字体/CDN：v10 原型用的 unpkg/jsDelivr/Google Fonts 不能照搬，ShiziKai/Noto Serif SC（D13）必须同源打包 |
| 内嵌品牌字 `"Shizi Brand"` | 20–21 | `@font-face` woff2 base64（约 5.7KB 文本 / 4264 字节二进制），`font-weight:400 900`，`font-display:swap` | 参与 `--kai` 字体栈首位 | LXGW WenKai 1.522 子集（THIRD_PARTY_NOTICES.md 95–103；README.md 29 称 4.2KiB 固定品牌字） | 可抽取改造 | 无 `unicode-range`；子集只含品牌字形（拾/字/印章类），其他楷体字形靠系统 Kaiti/DFKai 回退。D13 要求改名 ShiziKai、完整许可随包，且宋体 Noto Serif SC 400/500 精确加载——当前 `--song` 只是系统字体栈（24），没有加载任何宋体文件 |
| `:root` 颜色/排印令牌 | 23–32 | `--font-scale:1`；字体栈 `--sans/--kai/--song`；字号四档 `--fs-caption 11 / --fs-note 12 / --fs-body 13 / --fs-emph 15`；间距 `--space-1..4 = 8/12/16/24`；字距 `--ls-label .12em / --ls-motto .26em`；纸色 `--bg #f4efe2 --card #fdfbf4 --shade #ede7d6`；墨 `--ink #29241d --muted #665d4d --faint #6a604f`；线 `--line/--dline`；`--paper-noise`（内嵌 SVG feTurbulence，opacity .045）；朱砂 `--accent #c2452c` + `--accent-rgb` 与 11 档 `--accent-aNN` 透明度；`--gold #a67c26 --blue #3f5a7d --grey --green`；`--inkPen/--paperInk`；`--memory-1..5`（墨色五档）；`--keyboard-inset`、`--safe-top/bottom` | 全文件通过 `var()` 使用；几乎每个 `font-size` 都写成 `calc(Npx * var(--font-scale))` | — | 可直接复用（令牌体系）/ 可抽取改造（取值） | v10 交接备注 106 行给出深色暖墨红实测值（按钮 #AE5A44、文字红 #D47A5D）与当前深色 `--accent #d4553a` 不同；v10 墨墙「墨色四档 7/30/90 天」与当前 `--memory-*` 五档（只用 1/3/5）口径不同 |
| 深色模式 | 33–41、653、2162 | `@media (prefers-color-scheme: dark)` 覆盖 `:root`：纸 `#1d1a15/#29241b/#241f17`、墨 `#f2ead9`、`--accent #d4553a`、`--memory-*` 反向、噪点 seed 13 opacity .08；653 行补 `.cmpBox.mine` 与 `.backupBadge` | `isDark()`（2162）供画布取色 | 系统偏好 | 可抽取改造 | **只跟随系统**，没有手动「外观：浅色/深色/跟随系统」（v10 第零节叫法「外观」、边开发边改 V01）。画布导出（字帖/月帖/字卡）一律写死浅色十六进制，不受深色影响（1943、2929、2955） |
| 更大字体 | 42、1135–1139、2165–2170、2777 | `:root.largeText{--font-scale:1.12}`；`fontScaleLarge` 从 `FONT_SCALE_KEY` 读，`applyFontScale()` 切类名并同步设置行 `aria-pressed`/「开/关」；`idealBoxSize()` 在 large 下 `fixed=236`（普通 218），即**书写格反而更小** | `FONT_SCALE_KEY` boolean；`fitBox()`（3090） | — | 与 v10 决定冲突 | v10 W15/V02/X08：更大字体下按钮区必须在第一屏、书写格不小于标准字号格子（360 宽约 258pt）、点提示前后大小不变；C083 还要求跟随手机字号。当前 `-webkit-text-size-adjust:100%`（44）+ 全 px 字号 = 忽略系统 Dynamic Type |
| 全局基础样式 | 43–51 | `*` box-sizing、去 tap highlight；`html,body` 背景色+噪点、`overscroll-behavior:none`；`.wrap` 宽 `min(100%,430px)` 居中、`min-height:100svh`、顶部 safe-area；`button` 统一 `min-height:44px`、无边框、`:active scale(.97)`、`:disabled opacity .45`；`:focus-visible` 3px 蓝色外框；`.tlock` 防连点遮罩 | `.tlock` 由写字流程加/去 | — | 可直接复用 | ≥600px 时 `.wrap` 加左右阴影模拟手机（645）。v10 要求「新状态出现后约 0.4 秒按钮不响应」（W08），`.tlock` 是现成的视觉基础 |
| 动画关键帧 | 52–66、627 | `screenIn/fadeIn/cardSwapIn/compareIn/stampIn/bigStampIn/ringOut/toastIn/tileIn/breathe/undoBarIn/inkBloom/blobBlink/paperReveal` | 各视图 `animation:` | — | 可直接复用 | 减少动态效果见下 |
| 减少动态效果 | 646–652、2699 | `prefers-reduced-motion:reduce` 下所有 animation/transition 压到 .15s、单次、无延迟；关掉印章墨晕 `::before`、吉祥物眨眼、`paperReveal`；JS `motionReduced()` 供印历落章动画与 `scrollIntoView` 行为判断 | `motionReduced()` | — | 可直接复用 | README 29 行声明「系统开启减少动态效果时关闭眨眼和墨晕」与代码一致 |
| 尺寸媒体查询 | 628–645 | `max-height:700px` 压缩写字页各段间距；`max-width:380px` 缩对照框；`min-width:600px` 外框阴影 | — | — | 可直接复用 | v10 紧凑版基准是 360×640（更大字体），当前断点按高度 700 切 |

### 2.2 视图容器与切换机制

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 视图 DOM | 658–958 | `.wrap` 下十个同级容器，均带 `data-screen-label`：`#welcome`(661 首启) `#home`(676 首页) `#card`(690 练习, `position:fixed; inset:0`) `#summary`(775 结果) `#studybook`(840 字库) `#mePanel`(854 我的) `#settingsPanel`(876 设置) `#profilePanel`(918 写得不稳的字) `#auditPanel`(928 题库质检) `#annualPanel`(947 年度报告)；`#pos` 隐藏占位（658，未见引用） | `VIEW_IDS` 键：`welcome home card summary book profile audit me settings annual`（1766） | — | 可抽取改造 | 首启视图 D17 删除；`profile` 由 D23 的写错过/快忘了清单取代；`audit` 仅 `?dev=1`；需新增 练习记录、备份与恢复、关于（隐私/开源资料·致谢/给我们写信）、写错过/快忘了清单、有记录的字完整页等视图 |
| `displayView(view)` | 1779–1789 | 逐视图设 `display`；非 card 时 `resetWritingChrome()`；`syncAmbientForView()` 控制背景音；离开 summary 清印章计时与备份提示；**底部 tab 在 card/welcome/summary/profile/audit/settings/annual 隐藏**；tab 高亮映射 `home/card/summary/welcome→tabPractice`，`book→tabBook`，`profile/audit/me/settings/annual→tabMe`；`requestAnimationFrame(scrollTopNow)` | 全局唯一切换入口；各 `renderX()` 首行调用 | `$()`、`resetWritingChrome`（2185）、`syncAmbientForView`（1368） | 可抽取改造 | 无焦点迁移、无 `aria-current`/`aria-hidden` 处理、无返回栈（除写字页）。v10 要求页面切换用 iOS 原生方式含左边缘右滑返回——单 DOM 切换无法提供，需要在 WKWebView 侧或前端实现导航栈 |
| 底部三 tab | 536–538（CSS）、952–956（HTML）、2801–2803（事件） | `.foot` `position:sticky; bottom:0; z-index:12`；三个 **`<a>` 无 href、无 role** 的 `.tab`；`tabPractice→renderHome`、`tabBook→openBook`、`tabMe→renderMe` | `#tabPractice #tabBook #tabMe` | `displayView` | 可抽取改造 | 文案「习字/字库/我的」与 D02 一致。可访问性：应改为 `<button>` + `role="tablist"`/`aria-current`；v10 要求紧凑版可点控件一律是按钮 |
| 写字页历史栈 | 1767–1778 | `armPracticeHistory()` 在进写字时 `replaceState({shiziView:"home"})`+`pushState({shiziView:"practice"})`；`popstate` 时若字卡/收字/预算弹层开着则先关弹层并 `history.forward()`，否则 `exitCurrentRound(true)`；`releasePracticeHistory()` 退出时 `history.back()` | `practiceHistoryArmed`、`restoringPracticeHistory` | 浏览器 History | 可抽取改造 | 仅覆盖写字页；其他子页（设置/年报/单字详情）按浏览器返回会直接离开 App |
| iOS 原生返回 | 2774 | 监听 `shizi-native-back`（由 WebViewController.swift 114/1185 派发）：依次关字卡→换库→单字详情弹层；设置/年报→我的；写得不稳→`closeProfile()`；质检→设置；否则 `exitCurrentRound(false)` | 事件名 `shizi-native-back` | iOS 壳 | 可抽取改造 | 是「左边缘右滑返回」的现成挂点，但只有一级；新增视图都要登记 |
| 键盘 Escape | 2775 | 只关 `libSheet`/`charSheet` | — | — | 可抽取改造 | 其他弹层无 Escape |
| 键盘避让 | 1763–1765 | `visualViewport` resize/scroll → `--keyboard-inset`，`.sheetMask` 底部 padding 使用（541） | `updateKeyboardInset()` | visualViewport | 可直接复用 | 交接备注要求 iOS 上查字框 focus 必须在点击处理里同步调用；`openAddSheet` 已这样做（2887–2889） |

### 2.3 首页

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 首启页 `#welcome` | 68–81、661–674、1865、3070 | logo 印章、标题「打字多了，有些字提笔就忘。」、按钮「先练 15 个字」、副文「约 6–8 分钟 · 写不出时会提供提示 · 无需注册…」、「练过了？恢复备份」→`requestBackupImport`；`needsCalibration()&&!resume` 时替代首页 | `#welcomeStart`(→`startMode("new")` 2800) `#welcomeRestore` `#welcomeMotto` | `needsCalibration()`（1843） | 与 v10 决定冲突 | D17：去掉介绍页，首页「开始写字」直接进写字页，第一次 5 个字。C009：第一次来主按钮下一行「第一次来，先写 5 个字试试。」 |
| 首页顶部：日期/时辰 + 题记 | 83–93、677、1844–1846、1553–1618 | `#homeGreeting` = `dateCn()`（汉字「九月三十日」）+「·」+`timeWord()`（<5 夜、<11 晨、<14 午、<19 暮、否则夜）；`#homeMotto` 竖排 `writing-mode:vertical-rl`，`applyDailyMotto()` 用 `datedSelectionIndex(today,52,"motto")`（FNV 哈希步进）选一条，`setDailyMotto()` 按「，。；！？」拆两行、加 `<small class="mSrc">——作者《出处》`，超过 9 字加 `.compactMotto` | `DAILY_MOTTOS[52]{text,author,source}`（22 条孙过庭《书谱》、7 条蔡邕《笔论》、11 条《礼记·学记》、4 条韩愈《进学解》、6 条《论语·学而》、1 条《诗经》、1 条欧阳修《试笔》） | — | 与 v10 决定冲突 | C003：日期行改「{M} 月 {D} 日 · {时段}」阿拉伯数字；C005–C008 时段字改「早上/中午/傍晚/晚上」；交接备注 134 行时段边界为 晨 5–10、午 10–15、暮 15–19、夜 19–5（当前 11/14 分界不同）。D13：宋体先固定文案+**三条题记**，题记不再 52 条日轮换；D02 题记弱于操作 |
| 大标题 + 主印章 | 88、94–101、678–682、1863–1883 | `#homeTitle` 随状态：续组「今天拾了/今日已拾 N 个字」、完成「今日已拾 N 个字」、到期「今天先复习一组」、默认「今天拾十五个字」；`#startBtn` 165px 朱砂印章，文字「拾/续/再」，`aria-label` 同步，`dueBreathe` 呼吸动画（有到期且今日未盖章）；`#startCap` 说明「继续这组 · 已练 a / b 个 · 另有 n 个字要再练」等；点击 `startMode(reviewTodayCount()>0?"review":"new")`（2793） | `#startBtn #startCap #homeTitle` | `resumableSession() reviewCount() newPool() todayStampCount() todayCompleted()` | 可抽取改造 | v10 S01：「继续写字」下写明是哪一组、还剩几个，两组都没写完时另一组在下面一行；C001/C002/C004：大标题并为一行「今天写几个字」、删副标题；数字改阿拉伯。印章按钮可留作主入口（D02 首页唯一主入口） |
| 今日拾得 / 今日一字 | 102–123、683–686、1849–1861、1884–1893 | 无记录且未续组时显示「今日一字」（`dailyCharacterIndex()` 按日哈希从候选池选一字，点击 `startFocus([idx])`）；否则显示今日练过的字 `homeRecentIndexes()`（按 `memory.last` 降序，最多 50 块 `.yTile` + 「+N」块，>4 块加渐隐遮罩可横滑）；标题 `#yesterLbl` 「今日拾得/昨日练过/上次练过」；右侧 `#homeAdd` 「收字」→`openAddSheet` | `[data-daily-index]` 点击 2794 | `CARDS`、`memory` | 与 v10 决定冲突 | D12：N≤8 显示 N 项，N>8 显示最近判断 8 项、数字仍 N（当前 50）；M07：首页那排字点进今天的记录；「收字」入口由 D21 统一查字/自选组件的「自己选字」取代；`lastDayIndexes()`（1849）已无调用 |

### 2.4 字库（字盒 / 记忆之墙）

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 字库容器 | 320–369、840–851 | `.bookHead` 标题「字库」+ `#boxCount`「N 字」；`#libCard` 换库卡（库名 + 「换库 ›」+ `#libMeta` 进度）；`#bookCurator` 策展句；`.bookSearch` 查字框 + `#bookSearchResult`（aria-live）；`#memoryWall`；`#wildWish`；`.memoryWallFoot` 「墨色即记忆 · 淡了就去写」+ `#bookSaveMonth` 「导出月帖」 | `openBook()`（2017）→`renderBook()` | — | 应重写 | v10 10.1 字库首页：顶部统一、练习范围一行只写库名、墙最多 8 行、「自选了还没写」排最前、写错过/快忘了两张卡、大数字可点进完整页、墙底「还有 N 个字 ›」（L09）；L14 深色说明反义 |
| `renderBook()` | 2027–2034 | `displayView("book")`；`seen=profileIndexes()` 按 `firstSeenAt` 降序；墙 = `<button class="memoryChar" data-idx style="color:var(--memory-L);transform:rotate(…)">`，`aria-label="字，词"`；空态「字库还空着。拾一组字，墨色会从这里长出来。」；调用 `renderLibCard/renderWildWishes/handleBookSearchInput(false)` | `#memoryWall` 点击→`openCharSheet`（2781） | `memoryInkLevel`、`ROTS`（1732） | 可抽取改造 | 六列（349）；v10 墨墙用四档「多久没写」7/30/90 天着色，**写错的字显示标准楷体加红点，不显示那次写错的笔迹**（K28）；当前墨色来自 FSRS stability/streak 而非时间 |
| `memoryInkLevel(i)` / `isStable` / `stableCount` | 2008–2010 | 墨色档：stability≥7 或 streak≥3 →1；stability≥2 或 streak≥1 或 pendingLearning →3；否则 5。`isStable`= 非高风险且 streak≥2 | 月帖「已拾回 N 字」、换库计数 deep/mid/faint | `memory[key].fsrsCard.stability/streak/pendingLearning`、`isHighRisk`（1715） | 与 v10 决定冲突 | v10 墨色=距上次写的时间四档；「已拾回」概念未出现在 v10 文案 |
| 策展句 `bookCuratorData` | 2011–2016、2782 | 优先级：有到期字→「「X」和「Y」的墨色淡了，写一遍就回来」→`startFocus`；去年今日 FSRS 日志有记录→「去年今日，你拾回了「X」」→`openCharSheet`；否则主题分组「{主题}的字，你已经收了{汉字数}个」；空「第一枚章，会在这里慢慢显出墨色」 | `bookCuratorIndexes/bookCuratorKind` | `reviewDue compareReviewPriority fsrsReviewLog fsrsReviewMonthly profileGroups cardTopic datedSelectionIndex` | 与 v10 决定冲突 | v10 字库首页没有此元素；「收了」「拾回」均非第零节口径；汉字数字违反数字口径 |
| 换库卡 / 换库弹层 | 325–336、842–845、972–976、2018–2026、2783–2785 | `libraryCounts(lib)` 遍历 `BASE_N` 张卡按 `lib.test(c)` 去重统计 total/got/deep/mid/faint/recent(30 天)；`libraryProgressText` = `已练 N / 共 M` 或 `已练 N / 共 M 可练 · 官方 X`；`openLibSheet()` 渲染 `LIBRARIES`（1121–1126：core3500 规范常用字、adv3000 规范次常用字、rare 规范专门用字、curriculum2500 **义教基础字**）；点行 `setLibrary()` 并 toast「在学：X」 | `#libSheet`（`role=dialog aria-modal`）、`LIB_KEY {id,userSelected}` | `LIBRARIES`、`currentLibrary()` | 可抽取改造 | L10/C093–C099：列表写「可以练 N 个字 · 有记录 M 个」+ 每库一句说明 + 底部来源说明；C096/C157 库名「义教基础字」→「小学初中常用字」；换库确认弹层「以后的新字从这个字库里来。已有的记录、自选的字和写错过的字都会保留。」——当前无确认步骤，直接切换 |
| 查字框 | 339–343、847、2035–2041、2787–2789 | `bookSearchTarget()` 取输入中第一个 CJK 字→`BASE_BY_CHAR`/`customIndexOf`；`handleBookSearchInput(autoOpen)`：空→清；非汉字→「请输入一个汉字」；有记录→墙上 `.searchHit`/`.searchDim` 高亮并 800ms 后自动 `openCharSheet`；库内无记录→「还未练过「X」 · 收进字库」按钮→`handleBookSearch`→`openAddSheet` 预填；库外→「字库里暂时找不到「X」」；Enter 同 `handleBookSearch` | `#bookSearchInput`（placeholder「找一个字，或把忘的字收进来」，aria-label「找字或收字」） | `BASE_BY_CHAR`（1056）、`hasMemory` | 与 v10 决定冲突 | D21：查字、添加自选、首页自己选字合并为一个组件：输入一个字或一个词逐字列出，点一个字出卡片「练这个字 / 加入自选的字」，加入必须明确点「加入」；C146 读屏标签「在有记录的字里查字」；C147/C148/C149 说明句 |
| 暂不支持练习（拍字愿望） | 344–348、849、2100、2786 | 列出 `wildState.wishes`（拍到但库内无字形的字），点击有照片则 `openWildPhoto`，否则 toast「「X」暂不支持练习，已先保存记录」 | `#wildWish #wildWishChars` | `wildState` | 与 v10 决定冲突 | 产品语境：不做新 OCR/拍字，v10 无此区块；库外字在查字卡片里只说原因（C148：「拾字还没有这个字的参考字形。」） |
| 导出月帖按钮 | 850、2790 | `shareMonthlyPost()`，防重入 `disabled` | — | 月帖 | 可抽取改造 | v10 月帖入口在「我的/练习记录」（10.6），字库页无此按钮 |
| `.legend/.stampGuide/.outcomeMark` 样式 | 356–369 | 结果标记（金菱/朱砂/圆圈）与图例样式，供结果页与墙复用 | — | — | 可抽取改造 | v10 结果标记语义变为「写对/写错/看过答案/跳过」，D18/D23 需重定义 |

### 2.5 我的 / 印历 / 补帖 / 月帖 / 年报 / 设置

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 我的容器 | 371–446、854–873 | `h1` 我的；`#meCalendar`（月导航 ‹ › + `#calendarMonthTitle` + `#calendarMonthStat` + 周标题 一…日 + `#calendarGrid` + `#calendarHint`）；`#openProfile` 卡「写得不稳的字」+ 3 个字 `#meWeakChars` + `#meAdvice`；`.meMonthCard`（`#meMonthPreview` 缩略图 + `#meMonthTitle` + `#meMonthMeta` + `#monthlyPostLink` 「导出月帖 ›」）；`.mePrimaryRows`：`#openSettings` 设置、`#openBackupSettings` 备份（`#backupStatus`「从未备份/上次备份 · N 天前」+ `#backupUrgency` 「!」）；`#annualReportLink` 年报脚注 | `renderMe()`（1904–1907） | `renderCalendar renderBackupUI renderMeMonthCard missCount meAdviceText` | 应重写 | v10 10.6 M3：我的 = 这一周 → {月}字帖 → 菜单（练习记录 / 备份与恢复 / 设置 / 关于）；M03 字帖只放最近 3 行 + 「全部 ›」；C037 菜单行「练习设置」→「设置」；C038 备份行小字「记录只存在这台手机上」；C107 「上次备份 {日期}」/「还没有备份」；C039/C040 空态。「写得不稳的字」整块删（D23 改为字库 tab 的写错过/快忘了） |
| `renderMe()` | 1904–1907 | `displayView("me")`；`renderCalendar()`；weak = `missCount>0` 按次数/最近排序取 3；`#meAdvice` 「这些字在练习中没写出来过」或 `meAdviceText()`；`annualReady = getMonth()===11`；年报脚注文案「{年} 年拾字报告已生成 / 查看 {年} 年拾字记录」；`renderBackupUI() updateBookBadge()（空函数 1860） renderMeMonthCard()` | — | — | 与 v10 决定冲突 | 「写得不稳」用累计 `misses`，D23 只看最近一次有效记录；年报 12 月「已生成」门槛 v10 未提（C070–C076 只要求「只算今年的记录。这一页不能保存成图片。」） |
| 印历 `renderCalendar()` | 447–475（CSS）、1912–1925 | `calendarMonthKey` 状态；周一起始（`(getDay()+6)%7`）；每天 `<button class="calendarDay [future][makeable][today]" data-day data-makeup>`；有 `practiceDays` 的天落 `<i class="calendarStamp [todayStamp][makeup][land]">拾/补</i>`，首次进入该月按 `--stamp-delay` 依次落章（`calendarAnimatedMonths` 记忆，尊重 reduced motion）；标题当年用汉字月「九月」，跨年 `monthCn`「2025年九月」；`#calendarMonthStat`「盖章 N天 · 累计 M天」（`monthPracticeDays/totalPracticeDays`）；`#calendarNext` 不能超过当月；`#calendarHint` 「最近 7 天的留白日可以补写一帖。补帖要完整写完 5 个字，才会落印。」；左右滑动 55px 切月（2810–2812） | `#calendarPrev/#calendarNext/#calendarGrid` 事件 2807–2809 | `activity.practiceDays/daily/monthly`、`today()`、`numCn` | 可抽取改造 | 保留「只标当天写过的日子」（K27）；去掉补帖标记/提示/可补状态（D24）；月份阿拉伯数字（「9 月」）；M04：点有记录的日子列出那天写的字、字帖跟着月份走、箭头到头变灰；v10 日历属于「练习记录」子页而非我的首屏 |
| 补帖 | 986–990、1913、1917、1926–1933、2813–2815 | `canMakeupDay`：1–7 天前且不在 `practiceDays`；`openMakeupSheet` 若有未完成会话则 toast「手上这组写完，就能补前几天的空」；`#makeupSheet`（`role=dialog`）标题「补写 M月D日」、文案「完整写完 5 个字后，这一天会落一枚浅色「补」印。中途返回不会落印。」；`startMakeupDay` 用 `makeupCandidates()`（到期→高风险→已练难字→新字，去重取 5）进入 `activeMode="makeup"`；完成时 `markRoundComplete`（1286–1294）把 `activity.daily[过去日].makeup=true/makeupAt/completedRoundIds("makeup:<roundId>")` | `makeupPendingDay makeupTargetDay makeupInterestShown` | `reviewPool highRiskIndexes newPool` | 与 v10 决定冲突 | **D24 去掉补记**：删除弹层、`makeable/makeup` 样式（463、471）、`activeMode==="makeup"` 分支；`activity` 中 `makeup/makeupAt/makeupDays` 字段可留作兼容但不再写入 |
| 月帖数据 `monthReportData(month)` | 1935–1941 | 合并 `activity.monthly[month].targetKeys/independentTargetKeys` + 当月每日 `daily[day]` 同名字段 + `fsrsReviewLog` 中当月 `rating==="Good"` 的 `cardKey`；映射回索引；`hardest`=独立写出里 `personalDifficulty` 最高；`stable`=`isStable` 数 | 返回 `{month,days,keys,indexes,independentKeys,independentIndexes,practiced,stable,independentCount,practiceDays,hardest}` | `cardIndexForStoredKey`（线性扫 8105 张卡 ×N） | 可抽取改造 | v10 字帖只要「有笔迹的字」并按月内**第一次**笔迹（M02），落款字数随之减少，说明写出不在图里的字（10.12） |
| 月帖画布 `renderMonthlyPostCanvas` | 1943–1957 | 1080×1440，纸 `#f4efe2` + 斜细线纹、卡 `#fdfbf4` 双框；标题「{N}月拾得」（宋体 900 70px）、副题「这一月，一笔一画拾回来的字」；最多 80 格（`maxTiles`），列数 5/7/10 自适应，格内优先 `memory[key].recentInk.dataURL`（须 `recentInk.day` 以该月开头，否则**打印楷体目标字**）；>80 右侧「另有 N 字，也收在这个月里」；统计「{practiced} 当月练过 / 已拾回 N 字 / 独立写出 N 字 / 盖章 N 天」；「本月最难的一个字：X」；朱砂方章「拾字」；落款「YYYY · MM · 提笔忘字，拾回便是」；`canvas.dataset.{month,practiced,stable,independent,practiceDays,inkTiles,itemCount}` | `loadInkImage(dataURL)`（1942，走 `isRecentInkDataURL` 校验） | `ROTS`、系统字体 `"Songti SC","STSong"` / `"Kaiti SC","STKaiti"` / `-apple-system,"PingFang SC"` | 与 v10 决定冲突 | 与 D11「末次缺墨用浅参考，不用较早或别月墨迹冒充」和 10.12「只画有笔迹的字」都不一致（现在缺墨直接印楷体字）；取的是 `recentInk`（最后一次）而非 M02「月内第一次」；D12 超 80 字应返回 pending 而非截字；界面月份要阿拉伯数字，纸面落款保留汉字（C103–C105）；画布字体未用 ShiziKai/Noto Serif SC（D13） |
| `shareMonthlyPost(opts)` | 1958–1961 | 文件名 `shizi-month-YYYY-MM.png`；原生桥 `{type:"sharePracticeCard",kind:"monthly",name,dataURL}`；否则 `navigator.canShare({files})`→`share({files,title:"拾字 · 本月拾字帖"})`，toast「月帖已分享」；否则 `<a download>`，toast「月帖已存成图片」；`opts.nativeBridge/navigator/download` 可注入测试 | 返回 `{route:"native"|"share"|"cancelled"|"download",name,size|width,height}` | `practiceCardBlob`（2977） | 可直接复用（分发链） | 文案改「{月}字帖」（C140）；保存失败提示 C141 |
| 我的·本月字帖卡 `renderMeMonthCard` | 432–439、863–867、1901–1903 | 标题「{汉字月}月拾字帖」、副题「N 个字 · 其中 N 个独立写出」；后台把整张 1080×1440 月帖画到 canvas，`toDataURL("image/jpeg",.72)` 作 76×96 缩略图（token 防竞态、仅当我的页仍显示时赋值） | `#meMonthPreview` | `renderMonthlyPostCanvas` | 可抽取改造 | 每次进我的都完整渲染大图（含最多 80 张 webp 解码）——性能与内存值得注意；v10 我的页要直接显示字帖格子（可点进单字详情），不是缩略图 |
| 年报 `yearReportData/renderAnnualReport` | 476–485、947–951、1964–1966、2817–2818 | 数据：当年 `practiceDays`、按月计数、`monthly+daily` 的 `targetKeys` 合并、`busiest` 月、`rarest`（`CARDS.rank` 最大→字频最低）、`first`（`monthly.firstDay/firstTargetKey` 与 `daily[].targetKeys[0]` 取最早）；视图：`#annualSlides` 纵向 `scroll-snap` 四屏（练过的不同汉字 N 字 / 盖章天数最多的月份 / 最少见的一个字 / 这一年练的第一个字 + 日期）；空态「今年的第一枚章还没落下。…」；标题「{年} 年拾字报告」；`closeAnnual→renderMe` | — | `CARDS[i].rank/word`、`esc` | 可抽取改造 | C070–C076 文案：「一 · 今年有记录的字」「写完并判断过对错的字，写对写错都算。」「今年有记录的字里，它最不常用。」「只算今年的记录。这一页不能保存成图片。」空态「今年还没有记录」；「盖章」口径改「有记录」；数字阿拉伯 |
| 设置视图 | 442–446、876–915、1908–1909 | `renderSettings(focusData)`：`displayView("settings")`、库名、`renderSoundUI/renderHandCardPref/renderReminderUI/renderBackupUI`、`#devTools` 按 `DEV_TOOLS`；`focusData` 时滚到「数据」。分组：练习（`#settingsLibRow` 在学的字库、`#soundRow` 纸墨声音「只在盖章与描红落笔时响」、`#soundscapeBox` 练字背景音 关/雨声/炉火、`#handCardPromptRow` 字卡提示「独立写对后，每天最多提示一次」）、`#reminderSection`（仅原生桥存在时显示，1418–1420）、显示（`#fontScaleRow` 更大字体「练习、反馈和说明一起放大」）、数据（`#exportLink` 导出备份「包含练习记录和拍字照片」、`#importLink` 恢复备份、`#resetLink` 清空当前数据）、两段 `settingsNotice`（隐私说明 + `#backupReminder`）、开发工具（题库质检/实验数据） | 事件 2795–2799、2776–2777 | `sound`、`handCardPref`、`reminder`、`backupMeta` | 可抽取改造 | 第零节叫法：设置（原练习设置）、练习范围（字库行 C078）、按键音（C079）、外观（C082，需新增浅/深/跟随系统 V01）；V03 背景音选项占满一行；D10「写完提示做成图片」待确认否则删（对应现有「字卡提示」）；数据三行按 v10 迁到「备份与恢复」页（含替换/清空撤销 D24、K02 状态句）；「拍字照片」措辞随 OCR 删除；新增「关于」页：隐私、开源资料 · 致谢、给我们写信（交接备注十.7；C087–C089） |
| 备份状态 UI `renderBackupUI` | 2991–2993 | `#backupStatus` 文案（从未备份/上次备份 · 今天/昨天/N 天前）；`urgent`=（累计≥14 天且从未备份）或（≥30 天）→红字、「!」章、`mePanel.backupUrgent`（缩小今日章 469）；`#backupReminder` 在（完成≥5 天或 ≥30 字）且 ≥7 天时显示 | `backupMeta.lastExportAt` | `totalPracticeDays completedDayCount memoryCount reminder` | 与 v10 决定冲突 | D24/K02：备份页状态句只按现在的记录和上次导出时间算，**没有记录时不催导出**；C107 用日期而非「N 天前」；「催导出」的红叹号与 D01「不以…推动使用」精神相悖，需产品确认 |
| 写得不稳的字 `#profilePanel` | 486–512、918–925、2047–2064、2819–2825 | `renderProfile()`：`profileAdvice()` 总结句、最多 15 个 `.weakChar`（字号随 misses 放大）、主题/结构分组行、`#profilePractice` 「把这几个写一遍」→`startFocus(...,{returnView:"profile"})`；`openProfile(source)` 记录来源（me/summary） | `profileReturnView profilePracticeIndexes` | `missCount weaknessScore profileGroups cardTopic structureLabel` | 与 v10 决定冲突 | D23：改叫「写错过」、只看最近一次有效记录、与「快忘了」不重叠；10.4 清单每行标准字大字 + 词语 + 右侧那次笔迹小图，默认全选可勾选，「练这些字」，写完回到清单；主题/结构归因分析 v10 未要求 |
| 题库质检 `#auditPanel` | 513–533、928–946、2078–2086、2826–2833 | `?dev=1` 下从设置进入的开发面板 | — | — | 可直接复用（开发工具） | 非产品面 |

### 2.6 单字详情

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 弹层 DOM | 563–614、991–1006 | `#charSheet`（`.sheetMask.bottomSheet`，`role=dialog aria-modal aria-labelledby=charDetailWord`）内 `.charSheet` 底部抽屉（`sheetUp` 动画、可滚、圆角上沿、`.sheetHandle`）：头部 84px 字形格（优先最近墨迹图，否则楷体字）+ `h3` 词 + 拼音 + `#charDetailStory`；`#etymLine` 字源（`#etymGloss` + `#etymSource`）；`#charDetailWild` 「拾于生活」照片行；`.charDetailCompare`：「我上次写的」+ `#charDetailCompareToggle` 「对范字/收起范字」+ `#charDetailOverlayToggle` 「叠/并排」，主体 `#charDetailInk`(92px) / `#charDetailStandard`(朱砂楷体) / `#charDetailEmpty`；`#charDetailStroke` 180px hanzi-writer 容器；`#charDetailCard` 「做张字卡 ›」；`#charDetailCardLegacy` 「这份旧墨迹还不能做字卡，重新独立写一次即可。」；`.charDetailActions`：「看笔顺」「再写一遍」 | 事件 2834–2839、2844–2846 | — | 可抽取改造 | v10 L08：全 App「你的书写」在左、「参考字形」在右（当前标签「我上次写的/对范字」需改）；C041–C048：加「下次练习 · 大约 X 日再练到」（D7 待工程确认）、「把这个字做成图片」入口及无笔迹置灰说明、「换掉这个词语」反馈（D8）、「记录了 N 次」阿拉伯数字；10.5 写错过/快忘了那一行；L07 自选的字可在详情移除并撤销（D21）；L12 无字源整块不显示（已如此）；L13 历次笔迹可放大、做图片可选哪一次 |
| `openCharSheet(i)` | 1989–2000 | 取 `memory[key]`：`recentInk.dataURL`（经 `isRecentInkDataURL` 校验）、`firstSeenDay`、`suspiciousDictionaryWord`（词=「X字」或音译人名则只显示单字）；故事行 `{日期} 拾于生活` 或 `{日期} 收进字库` + `练过 N 次` + `OUTCOME_STORY[lastOutcome]`（1973：上次独立写出 / **上次需要再练** / 上次写错了 / 上次没写出来）；`cardReady=!!handCardData(i)`，`legacyInk=有图无矢量`；重置对照/笔顺状态；`renderEtymLine()` 立即 + `loadEtymology()` 异步 | `charDetailIndex` | `wildCaptureFor handCardData collectedDateText` | 可抽取改造 | 「需要再练」→「写错过」（D23）；「收进字库」→「加入自选的字」语义（D21）；「看过答案」结果（D18）在 `OUTCOME_STORY` 中没有对应键 |
| 字源 `loadEtymology` | 595–596、1980–1987 | 惰性 `fetch("data/etymology.json")` → `Map(char→{gloss,source})`，只收单字、gloss≤20 字且有 source；失败置空 Map；`renderEtymLine` 显示 `gloss ——source`，单行省略 | `etymologyData/etymologyLoading` | `data/etymology.json` 行 `{char,gloss,source}` | 可直接复用 | C088：关于页「字形和字源的出处」；L12 无字源不显示（已满足） |
| 对照/叠放/笔顺 | 2001–2005 | `toggleCharDetailCompare` 显隐范字并露出「叠」；`toggleCharDetailOverlay` 切 `.overlay`（范字 `margin-left:-104px` 透明叠在墨迹上，604）；`replayCharDetail` 用 `HanziWriter.create(el,target,{width:180,padding:10,showCharacter:false,showOutline:true,strokeColor:--accent,outlineColor:--accent-a22,charDataLoader:charLoader})` 播放，失败 toast「这个字的笔顺暂时不可用」 | `charDetailWriter` | hanzi-writer、`charLoader` | 可直接复用 | 位置/文案按 L08 调整 |
| 再写一遍 | 2837 | `returnView` 按当前哪个面板 `display==="flex"` 推断（profile/book/me/home），`closeCharSheet()` 后 `startFocus([idx],{returnView})` | `focusReturnView`（1466） | `startFocus`（1969） | 可抽取改造 | D05：临时自选会话与普通会话隔离、结束后返回来源——现有 focus 模式即「返回来源」的雏形，但只支持单字 |
| 下滑关闭 | 2841–2842 | 从 `.sheetHandle/.charDetailHead` 起手、`scrollTop<=0`、下滑 >70px 关闭 | — | touch 事件 | 可直接复用 | 无焦点归还 |

### 2.7 收字面板（＋加字 / 拍字）

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 弹层 DOM | 540–562、959–970 | `#addSheet`（无 `role=dialog`）：标题「刚才哪个字不会写？」、说明「输入那个字，或它所在的词（如「蘸料」）。字库里有的字会带上拼音和语境词。」、`#addInput`（maxlength 20，楷体 22px）、`#addPreview` 芯片行、`#wildCapture`（`#wildCaptureBtn` 「拍一个字」+ `#wildCaptureNote` + 缩略图）、`#wildCandidates`（OCR 候选）、「取消」/「收进字库」 | `openAddSheet/closeAddSheet/confirmAdd`（2887–2911） | `#wildPhotoInput`（1031） | 与 v10 决定冲突 | D21 统一组件取代；OCR/拍字整体移除（产品语境「no new OCR」）；第零节：「加入自选的字」失败提示「没加进自选的字，输入的字还在。」按钮「先不加 / 再试一次」（C150–C152） |
| `renderAddPreview()` | 2881–2886 | 输入去重取 CJK（有拍字草稿时只取 1 个）；每字芯片：库内→拼音，库外→「生僻字·自定义卡」或「暂不支持练习」；已练过加「· 已练过」；确认按钮随有无字启用 | `#addConfirm.disabled` | `BASE_BY_CHAR customIndexOf memory` | 可抽取改造 | v10 查字弹层「输入一个字或一个词，再点你要的那个字」逐字列出并点选出卡片（C147），不是芯片预览 |
| `openAddSheet()` | 2887–2889 | 若在反馈阶段（`stamped`）则暂停自动推进、隐藏撤销条；清拍字草稿、清输入、`.open`、`updateKeyboardInset()`、同步 `focus()`、`scrollIntoView` | `feedbackPausedForAdd` | 写字流程全局 `stamped autoNextTimer lastStampSnapshot` | 可抽取改造 | 与写字流程耦合（在练习中加字会插入当前组 `insertIntoCurrentBatch`，2142–2155）；v10 中「自己选字」是首页/字库入口，不在写字中途 |
| `confirmAdd()` | 2891–2907 | 拍字路径：`collectWildCharacter(ch,capture)`（2137–2140）——库内字→`addWord` + `memory.source="wild"/wildDay` + `wildState.captures[ch]`；库外→`wildState.wishes[ch]`；文本路径：`addWord(text)`（2126–2136）——每个字**记一次真实「没写出」**（`recordRealWorldMiss`：`misses+1, lastOutcome="miss", streak=0, ease-16, due=今天, status="indeck"`）、库外字生成自定义卡（`pushWordCards`，2102，`custom:true, norm:"自定义", rank 999999`）并写 `CUSTOM_KEY/ADDED_KEY`、置 `queuedFront/queuedFrontAt` 下次开练优先；若正在练习则 `insertIntoCurrentBatch`；toast「已加入本组，下一题写「X」」/「已加入：X · 下次开练，第一个就是它」等；刷新 summary/me/book | `addWord collectWildCharacter insertIntoCurrentBatch` | `memory status customWords addedChars wildState` | 与 v10 决定冲突 | **D21**：加入自选只是加入列表，由用户明确点「加入」；**D23**：写错过只来自最近一次有效判断——把「加字」记成 `miss` 会直接污染写错过清单与 FSRS；D03「没有本人书写不制造有效判断」。自定义卡（库外字）在 v10 中「拾字还没有这个字的参考字形」只说原因，不生成卡 |
| 拍字 OCR 链 | 2864–2880、2909–2913 | `cropWildPhoto`：中心方裁、webp/jpeg × 256/224/192/160 × 4 档质量，找 ≤64KiB 的 dataURL；`handleWildPhoto`：建 `wildDraft{version:1,day,at,dataURL,requestId}`，若原生桥存在发 `{type:"recognizeChars",requestId,dataURL}`，否则提示手动输入；`window.shiziOCRResult({requestId,candidates})` → `showWildCandidates`（≤12 个 CJK 候选按钮，requestId 不匹配则丢弃）；`clearWildDraft` 复位 | `WILD_PHOTO_MAX 30 / WILD_PHOTO_BUDGET 420KiB / WILD_PHOTO_MAX_BYTES 64KiB`（2090） | iOS `recognizeChars`（WebViewController.swift 1578–1580, 1690–1691） | 与 v10 决定冲突 | 整体移除；`WILD_KEY` 数据与 iOS `recognizeChars` 分支同步下线或留兼容读 |
| 拾于生活照片查看 | 578–580、1008–1011、2865–2866、2838–2840 | `#wildPhotoSheet` 全图查看，「收起」 | — | — | 与 v10 决定冲突 | 随 OCR 移除 |

### 2.8 分享图片

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 画布工具 | 2916–2920 | `shareCardDebug{lastRoute,lastMessage}`；`shareRoundRect`；`shareWrappedText`（逐字换行、限行数）；`drawShareHandwriting(ctx,strokes,x,y,size,rotation)`：先画 `#c2452c38` 虚线米字格，再用 `normalizedInkStrokes` 把 0–1 归一化点缩放并 `paintBrushStroke(...,{color:"#29241d",detail:true})`，返回笔画数 | 供 字帖/持久化缩略图（1808）共用 | `normalizedInkStrokes`（1148）、`paintBrushStroke`（2215） | 可直接复用 | 米字格虚线颜色写死浅色值 |
| 今日字帖 `renderPracticeCardCanvas` | 2955–2976 | 输入 `roundStats`；5 列 × 160px 格、18px 间距，行数 >3 时画布高度 1440 起按行增加；有里程碑句则顶部加朱砂圆角条；标题取 `#sumH2` 文本（默认「今日拾得」）、「本组 N 个字」、右侧竖排 `dateCn()`；每格 `drawShareHandwriting(roundHandwritingFor(stat))`（当组笔迹或 `recentInk.strokes`）、下方标签 `已独立`/`GRADE_UI[outcome].short`（独立写对/稍后再练/写错/没写出）、右上角圆点 `OUTCOME_MARK`（补/待/再）、miss 格淡红底；右下方章「拾字」；落款「提笔忘字，拾回便是」；`dataset.itemCount/inkStrokeCount` | `sharePracticeCard()`（2978–2985）由 `#summaryShare/#calibShare`（2758–2759）触发 | `GRADE_UI`（1719）、`OUTCOME_MARK`（1725）、`ROTS`、`roundHandwriting` | 与 v10 决定冲突 | 第零节：叫「这次的图片」；D11：同字取本次最后明确判断笔迹，缺墨用浅参考；10.12 只画有笔迹的字、落款字数跟着减、都没有时换成说明；标签体系（独立写对/稍后再练/写错/没写出）与 D18/D20/D23 的「写对/写错/看过答案/跳过」不一致；D12 超 80 字返回 pending；M06 版式重排、字放大、可挑字；画布字体未按 D13 |
| `sharePracticeCard(opts)` | 2978–2985 | 无 stats→toast「这组还没有可分享的字」`{route:"empty"}`；文件名 `shizi-card-YYYY-MM-DD.png`；原生桥 `{type:"sharePracticeCard",name,dataURL}`（无 kind）；Web Share `title:"拾字 · 今日字帖"` toast「字帖已分享」；下载 toast「字帖已存成图片」 | 返回 `{route,name,size|width,height}` | iOS `sharePracticeCard`（Swift 1552–1554） | 可直接复用（分发链） | 文案随「这次的图片」改；「已分享。/已取消分享。」是原型专用句，不照抄 |
| 手写字卡 数据/画布 | 581–591、1013–1023、2924–2941 | `HAND_CARD_RATIOS{portrait 1080×1440 "3:4", square 1080×1080 "1:1"}`；`handCardData(i)` 要求 `recentInk.version>=2` 且有矢量 `strokes`；`drawHandCardPaper` 伪随机纤维纸纹；主字 `drawHandCardInk`（720/650px 大格），下方「词 · 拼音」宋体 36px、干支纪年日期 `handCardDateText`（「丙午年 九月三十」，`sexagenaryYear`）楷体 32px、右侧朱砂方框「拾」章、底部「拾字」20px；`dataset.ratio/inkSource="vector"/inkStrokeCount/signatureSize/dateSize`；`#handCardSheet` 预览 canvas + 尺寸切换（`aria-pressed`）+「取消 / 存到相册 / 分享」+「可保存到相册，也可直接分享。」 | `openHandCard(i,{fromPrompt})`、`setHandCardRatio`、`updateHandCardPreview`（token 防竞态） | `recentInk.strokes`（≤36 笔 × 24 点，1804）、`compactHandCardStrokes` | 可抽取改造 | 第零节：「手写字图片」，入口「把这个字做成图片」；交接备注「单字手写图片按 A05 的版式，工程的导出模块还没有这一版，要补」——现版式不是 A05；1:1「头像」尺寸 v10 未提；L13 可选用哪一次笔迹 |
| `exportHandCard(mode)` / `runHandCardAction` | 2947–2951 | 文件名 `shizi-<字>-portrait|square-YYYY-MM-DD.png`；原生桥：`save→{type:"savePracticeCard",kind:"character",name,dataURL}`，`share→{type:"sharePracticeCard",kind:"character",...}`；Web：share 走 `navigator.share`（title「拾字 · 手写字卡」），save 或 share 失败回退 `<a download>`；toast「字卡已存成图片」；按钮防重入 | 返回 `{route:"native-save"|"native-share"|"share"|"cancelled"|"download"|"empty",...}`；`window.shiziCardSaved({success})` 回调 toast「字卡已存到相册」/「没能保存到相册。请检查照片权限，或稍后重试」 | iOS `savePracticeCard`（Swift 1556–1557、1623–1624，仅接受 `data:image/png;base64,` ≤12MB 的 PNG） | 可直接复用（分发链） | C141 保存失败文案「没能存进相册。请到手机设置里允许拾字添加照片。」 |
| 字卡提示 `maybeOfferHandCard` | 592–594、1024、2952–2954、2848 | 独立写对（`outcome==="fast"`）且有矢量墨迹、`handCardPref.promptEnabled`、当天未提示过 → 底部 `#handCardPrompt` 「要把刚写的字做成字卡吗？ 制作」5 秒自隐；写 `handCardPref.lastPromptDay` | `HAND_CARD_KEY {promptEnabled,lastPromptDay}` | `stamped practicePhase autoNextTimer`（打开时暂停反馈推进，关闭恢复 2944–2945） | 与 v10 决定冲突（待定） | D10：设置里「写完提示做成图片」到底做什么，定不下来就删 |

### 2.9 全局提示层

| 名称 | 位置 | 职责 | 备注 |
| --- | --- | --- | --- |
| `toast(msg)` | 615–616、1025、2859–2860 | 底部 84px 上方黑色胶囊，2.2s；`role=status aria-live=polite` | 可直接复用；v10 多处「轻提示」可用它 |
| `#bootNotice` | 617、1026 | 启动时发现损坏键的提示「部分记录已损坏，已跳过；其他记录仍可正常使用」 | 可直接复用 |
| `#storageNotice` / `#storageGate` | 618–620、1027–1028、1064–1068、2861–2862 | 写失败/配额/运行时异常提示（`role=alert`）；读失败全屏阻断「暂时无法保存练习」+「重新检查」；`checkStoragePressure()` 用 `navigator.storage.estimate()`，≥85% 或剩余 <5MB 提示导出 | 可直接复用；交接备注给了存储阻断「怎么解决 ›」句（原型专用，不照抄） |
| `#safetyUndo` | 621–623、1029 | 备份替换/清空后的撤销条（`SAFETY_KEY`） | 属备份读者范围；D24 要求撤销在备份页一直有效、离开才失效 |

## 3. 数据契约

### 3.1 localStorage 键（1059–1062；形状校验 `STORED_SHAPE` 1084–1107；`BACKUP_KEYS` 2988）

| 键 | 形状 | 壳层读写点 |
| --- | --- | --- |
| `shizi.fontScale.v1` | `boolean` | 1135 读；2777 写；`applyFontScale` 1138 |
| `shizi.sound.v1` | `{enabled:boolean(默认 true), tipShown:boolean, scene:"off"|"rain"|"fire"}`（`normalizeSound` 1322） | 设置行 1369–1374 |
| `shizi.handCard.v1` | `{promptEnabled:boolean(默认 true), lastPromptDay:"YYYY-MM-DD"|""}`（1323） | 1371–1372、2953 |
| `shizi.library.v1` | `{id:"core3500"|"adv3000"|"rare"|"curriculum2500", userSelected:boolean}`；旧值 `primary/junior/senior` 或纯字符串迁移（`normalizeLibrary` 1130） | 1131–1134、2785 |
| `shizi.wild.v1` | `{version:1, captures:{[字]:{day,at,dataURL?}}, wishes:{[字]:{day,at,dataURL?}}}`；`dataURL` 仅 `image/webp|jpeg` ≤64KiB；总量 ≤30 张 / 420KiB，超出按时间淘汰 dataURL（`trimWildPhotos` 2097） | 2091–2101、2137–2140 |
| `shizi.custom.v1` | `string[]`（用户输入的词，`buildCustomCards` 追加到 `CARDS[BASE_N..]`） | 2088、2126–2136 |
| `shizi.added.v1` | `string[]`（曾加过的单字，去重） | 2118–2119、2126–2136 |
| `shizi.activity.v1` | `{version:2, migrationDate, inheritedStreak, inheritedTotalDays, practiceDays:["YYYY-MM-DD"...已排序], daily:{[day]:{stamps, attempts, targetKeys:[cardKey], independentTargetKeys, reviewTargetKeys, completedRoundIds:[], completedGroups, makeup:boolean, lastStampAt, firstCompletedAt, makeupAt}}, monthly:{[YYYY-MM]:{days, completedDays, stamps, attempts, completedGroups, targetKeys, independentTargetKeys, reviewTargetKeys, makeupDays:[], firstDay, firstTargetKey, lastStampAt}}}`；`daily` 保留 400 天后归档进 `monthly`（`compactActivity` 1279） | 印历 1918、月帖 1936、年报 1964、我的统计 1300–1301 |
| `shizi.backupMeta.v1` | `{lastExportAt:number, summaryPromptShown:boolean}`（1274） | 2989–2993 |
| `shizi.memory.v1` | `{[cardKey]: row}`；壳层读取的字段：`seen firstSeenAt streak ease fast slow hints misses due dueDay last lastOutcome("fast"|"hinted"|"slow"|"miss") pendingLearning fsrsCard.stability recentInk source("wild") wildDay queuedFront queuedFrontAt lastSystemAgree` | 2010、1989–2000、2047 等 |
| `memory[key].recentInk` | `{version:2, day:"YYYY-MM-DD", at:number, dataURL:"data:image/webp|png;base64,…"(字符串长度×2 ≤32KiB, 1176), strokes:[[{x,y(0–1),w?,v?}]...]（≤36 笔、每笔 ≤24 点，1804）}`；全局上限 `RECENT_INK_MAX=96` 份 / `RECENT_INK_BUDGET=420KiB`（1144、1178） | 字卡 2928、月帖 1947、单字详情 1989、字帖回退 1806 |
| `cardKey` 格式 | `"base:<字>"` / `"custom:<字>"`（1541）；`activity` 里还可能出现 `legacy:<n>`（1284） | 所有 `*TargetKeys` |
| 其他（非壳层主责） | `shizi.deck.*`、`opens`、`quality`、`pref`、`tuning`、`session`、`fsrsReviewLog`、`traceTutorial`、`reminder`、`funnel`、`topic`；`shizi.safety.v1` 与 `shizi.nativeSmoke.v1` 刻意不入备份；坏键隔离到 `shizi.corrupt.<key>`（1076） | — |

### 3.2 视图/DOM 契约

- `VIEW_IDS`（1766）：`welcome→#welcome, home→#home, card→#card, summary→#summary, book→#studybook, profile→#profilePanel, audit→#auditPanel, me→#mePanel, settings→#settingsPanel, annual→#annualPanel`；每个容器 `data-screen-label`（首启/首页/练习/揭晓/结果/字库/我的/设置/写得不稳的字/题库质检/年度拾字报告），iOS smoke 脚本据此识别页面。
- 弹层：`.sheetMask.open`；`#libSheet #makeupSheet #charSheet #wildPhotoSheet #handCardSheet` 带 `role=dialog aria-modal`，`#addSheet #roundBudgetSheet` 无；点遮罩空白处关闭。
- 数据属性事件协议：`[data-idx]`（墙/结果格→`openCharSheet`）、`[data-char-idx]`（我的/写得不稳→详情）、`[data-daily-index]`（今日一字）、`[data-day][data-makeup]`（印历）、`[data-lib]`（换库）、`[data-book-add]`、`[data-wild-candidate]`、`[data-wild-wish]`、`[data-hand-card-ratio]`、`[data-scene]`、`[data-pref]`、`[data-audit-*]`、`[data-quality]`、`[data-round-feedback]`。
- CSS 类状态：`:root.largeText`；`.stampBtn.dueBreathe`；`.yesterRow.scrollable/.dailyWordMode`；`.memoryChar.searchHit/.searchDim`；`.calendarDay.future/.makeable/.today`、`.calendarStamp.todayStamp/.makeup/.land`；`.me.backupUrgent`；`.meAnnualFoot.ready`；`.charDetailCompareBody.overlay`；`.handCardPreview.square`；`.card.writing/.undoActive/.chromeDirect`。

### 3.3 原生桥（`window.webkit.messageHandlers.shiziNative.postMessage`）与回调

| 方向 | 消息 | 定义处 |
| --- | --- | --- |
| JS→iOS | `{type:"sharePracticeCard", kind?:"monthly"|"character", name, dataURL:"data:image/png;base64,…"}` | 1959、2948、2980；Swift 1552–1554 |
| JS→iOS | `{type:"savePracticeCard", kind:"character", name, dataURL}` | 2948；Swift 1556–1557（PNG 头校验、≤12MB） |
| JS→iOS | `{type:"recognizeChars", requestId:number, dataURL}` | 2877；Swift 1578–1580 |
| JS→iOS | `{type:"shareBackup", name, payload}`、`{type:"pickBackup"}`、`{type:"sound",kind}`、`{type:"soundscape",kind}`、`{type:"haptic",kind}`、`{type:"syncReminder",…}`、`requestReminderPermission`、`queryReminderStatus` | 3015、3059、1341、1366、1379、1404–1406 |
| iOS→JS | `window.shiziCardSaved({success:boolean})` | 2954；Swift 1623–1624 |
| iOS→JS | `window.shiziOCRResult({requestId, candidates:string|string[]})` | 2874；Swift 1690–1691 |
| iOS→JS | `window.dispatchEvent(new Event("shizi-native-back"))` | 2774；Swift 114、1185 |
| iOS→JS | `shiziReminderStatus({permission})`、`markBackupExported()` | Swift 1930、1290 |

### 3.4 分享函数返回值与文件名

- `sharePracticeCard/shareMonthlyPost/exportHandCard` 统一返回 `{route, name, size?, width?, height?, message?}`，`route ∈ native | native-save | native-share | share | cancelled | download | empty`；均支持注入 `opts.nativeBridge / opts.navigator / opts.download` 供测试。
- 文件名：`shizi-card-YYYY-MM-DD.png`、`shizi-month-YYYY-MM.png`、`shizi-<字>-portrait|square-YYYY-MM-DD.png`。
- 画布 `dataset`：字帖 `itemCount inkStrokeCount`；月帖 `month practiced stable independent practiceDays inkTiles itemCount`；字卡 `ratio inkSource inkStrokeCount signatureSize dateSize`。

### 3.5 静态数据

- `data/etymology.json`：数组 `[{char, gloss(≤20 字), source}]`（1982–1985）。
- `DAILY_MOTTOS`（1553–1606）：52 条 `{text, author, source}`；`datedSelectionIndex(key,size,salt)`（1608）以 UTC 日序 × 哈希步进取模。
- `LIBRARIES`（1121–1126）：`{id, name, desc, officialTotal, test(card)}`；`officialTotal` 3500/3000/1605/2500。
- `GRADE_UI`/`OUTCOME_MARK`/`OUTCOME_STORY`（1719–1725、1973）：四结果 `fast/hinted/slow/miss` 的印章文案与标记。

## 4. 与第十稿（v10）决定的关系

### 4.1 保留（可直接沿用或小改）

- 单文件 PWA + 严格 CSP + 同源资源策略；`:root` 令牌体系、四档字号/四档间距/两档字距、噪点纸纹、朱砂透明度阶梯；深色令牌覆盖机制；reduced-motion 全局降级；`button` 44px 最小高度与 `:focus-visible`。
- `displayView` 作为唯一切换入口（需扩展视图表与焦点/返回处理）；`.sheetMask` 弹层机制与点遮罩关闭；`shizi-native-back` 事件作为 iOS 返回挂点；`toast/bootNotice/storageNotice/storageGate`。
- 三 tab「习字 / 字库 / 我的」（D02）；首页唯一主入口（印章按钮）；印历「只标当天写过的日子」的基本渲染（K27）。
- 图片分发三级回退（原生桥 → Web Share files → 下载）与可注入测试接口；字源惰性加载；hanzi-writer 笔顺回放。
- 存储键形状校验/坏键隔离/配额提示（属基础设施，另一读者主责）。

### 4.2 改变（v10 重命名/重排/重算）

| 现状 | v10 要求 | 依据 |
| --- | --- | --- |
| 首页日期「九月三十日 · 暮」 | 「9 月 30 日 · 傍晚」；时段 早上/中午/傍晚/晚上；边界 5–10/10–15/15–19/19–5 | C003、C005–C008、交接备注 134 |
| 大标题「今天拾十五个字」两行 | 一行「今天写几个字」；续组「继续写字 + 哪一组、还剩几个」，两组都未完成时另一组在下一行 | C001/C002/C004、S01 |
| 首页那排字最多 50 块 | N≤8 显示 N，N>8 显示最近 8 项数字仍 N；点进今天的记录 | D12、M07 |
| 「收字」入口 + 收字面板 | 「自己选字」= 统一查字/加入自选组件；加入需明确点「加入」 | D21、K29、L01–L03 |
| 字库：六列墨墙（墨色=FSRS 稳定度）、策展句、查字框、暂不支持、导出月帖 | 墨墙（墨色=多久没写四档，写错=楷体+红点）、写错过/快忘了卡、查字组件、练习范围一行、有记录的字完整页；墙底「还有 N 个字 ›」 | 10.1–10.4、K28、L09、L14 |
| 换库卡「已练 N / 共 M 可练 · 官方 X」、库名「义教基础字」、直接切换 | 「可以练 N 个字 · 有记录 M 个」+ 每库说明 + 来源说明；「小学初中常用字」；换库需确认弹层；练习范围一行只写库名 | L10、C093–C099、C154–C158 |
| 我的 = 印历 + 写得不稳 + 月帖缩略 + 设置/备份 + 年报脚注 | 我的 = 这一周 → {月}字帖（最近 3 行 + 全部 ›，格子点进详情）→ 练习记录 / 备份与恢复 / 设置 / 关于 | 10.6、M03、C037–C040 |
| 印历标题汉字月「九月」、「盖章 N天 · 累计 N天」 | 「9 月有记录 N 天」阿拉伯数字；「盖章」→「有记录」；日历在练习记录子页；点日子列出那天的字；箭头到头变灰 | 第零节数字、C052、M04 |
| 月帖：取 `recentInk`（最后一次）、缺墨印楷体、80 字截断、标题「N月拾得」 | 用月内**第一次**笔迹（M02）、只画有笔迹的字并说明、超 80 返回 pending、界面「9 月字帖」纸面落款汉字 | M02、10.12、D12、C103–C105、C140 |
| 今日字帖：标签 独立写对/稍后再练/写错/没写出，全部字都画格 | 「这次的图片」：写对/写错/看过答案/跳过口径、只画有笔迹的字、版式重排、可挑字 | D18/D20/D23、10.12、M06 |
| 手写字卡「做张字卡」3:4/1:1、干支日期 | 「把这个字做成图片」、A05 版式、可选哪一次笔迹；无笔迹置灰说明 | 第零节、交接备注「和底层交接的衔接」、C043–C047、L13 |
| 单字详情「我上次写的 / 对范字」、故事「收进字库」「上次需要再练」 | 「你的书写」左 /「参考字形」右；「下次练习 · 大约 X 日再练到」（D7 待定）；写错过/快忘了行；「换掉这个词语」；移除自选可撤销；「记录了 N 次」 | L08、C041–C048、C108–C113、10.5、L07 |
| 年报文案「练过的不同汉字」「盖章天数最多」「最少见」 | 「今年有记录的字」「写完并判断过对错的字，写对写错都算。」「今年有记录的字里，它最不常用。」「只算今年的记录。这一页不能保存成图片。」空态「今年还没有记录」 | C070–C076 |
| 设置：在学的字库 / 纸墨声音 / 背景音半行 / 字卡提示 / 更大字体 / 数据三行 | 练习范围 / 按键音 / 背景音占满一行 / 「写完提示做成图片」(D10 待定) / 更大字体（跟随手机字号）/ 外观（浅色·深色·跟随系统）/ 数据迁到备份与恢复；新增关于页三子页 | 第零节叫法、C077–C089、V01、V03、交接备注十.7 |
| 备份行「从未备份 / N 天前」+ 红叹号催导出 | 「上次备份 {日期}」/「还没有备份」；没有记录时不催导出 | C107、K02、D24 |
| 汉字数字 `numCn` 遍布界面（首页标题、印历、月帖卡、字卡日期） | 界面一律阿拉伯数字，只有纸面落款保留汉字 | 第零节「数字」 |
| 题记 52 条日轮换 | 宋体固定文案 + 三条题记 | D13 |

### 4.3 移除

- 首启页 `#welcome` 及「先练 15 个字」（D17，改为首页直接进 5 字写字页）。
- 补帖：`#makeupSheet`、`canMakeupDay/openMakeupSheet/startMakeupDay/makeupCandidates`、印历 `.makeable/.makeup/「补」章`、`calendarHint` 补帖句、`activeMode="makeup"` 分支（D24）。
- 收字面板的 OCR/拍字链（`wildCapture*`、`cropWildPhoto`、`handleWildPhoto`、`shiziOCRResult`、`recognizeChars`、`#wildPhotoSheet`、`#wildWish`、`WILD_KEY` 写入）（产品语境无新 OCR；v10 无此功能）。
- `addWord` 把加字记为「没写出」并进复习队列的语义（D21/D23/D03）；自定义卡生成（v10 库外字只说明原因）。
- 「写得不稳的字」页与我的页上的卡、结果页「看看写得不稳的字 →」（D23 改为字库 tab 的写错过/快忘了清单）。
- 字库策展句 `bookCurator`、「墨色即记忆 · 淡了就去写」脚注、字库页「导出月帖」按钮（v10 字库首页无此元素）。
- 首页「今日一字」（v10 首页无此模块；D02 无重复入口）。
- 年报「12 月已生成」门槛（v10 未要求；按 C074 常年可看）。

### 4.4 可见文案 / 词汇改名清单（现有代码出处 → v10）

| 现文案 | 位置 | v10 | 依据 |
| --- | --- | --- | --- |
| 点拨 | 707、1728 | 提示（「提示 · 还有 N 次」） | D04、C021 |
| 瞥一眼 | 708 | （长按看完整字形的功能取消；分成「提示」与「看答案」两个固定位置） | W03/W04 |
| 不会写 | 715、1730、2243、2275 | 看答案（记为「看过答案」） | D18、K25 |
| 收字 / 收进字库 / 收进来 | 684、847、969、1993、2039 | 加入自选的字 / 自己选字 / 查字 | D21 |
| 需要再练 / 上次需要再练 | 1973（`OUTCOME_STORY.hinted`）、`GRADE_UI.hinted` 「稍后再练」1721 | 写错过（清单）；结果口径改写对/写错/看过答案 | D23、K15 |
| 写得不稳的字 | 803、830、862、918–919、1895 | 写错过 · 快忘了（两张清单） | D23 |
| 补写一帖 / 开始补帖 / 补 | 987–989、1922–1929 | （删除） | D24 |
| 今日拾得 / 昨日练过 / 上次练过 | 684、789、814、1859、1849–1855 | 今天的记录 / 这次的图片 | 第零节「图片」、M07 |
| 存为字帖 | 804、831 | 保存图片（这次的图片） | 第零节、10.6 |
| 导出月帖 / 本月拾字帖 / N月拾字帖 / N月拾得 | 850、864–866、1901、1946 | {M} 月字帖（界面阿拉伯数字，落款汉字） | 第零节、C140 |
| 做张字卡 / 字卡 / 字卡提示 | 1004、1014、887、2949–2954 | 手写字图片 / 把这个字做成图片 / 写完提示做成图片（D10 待定） | 第零节、C043、C081 |
| 我上次写的 / 对范字 / 范字 / 你写的 | 1000、734、742、1997、2001 | 你的书写（左）/ 参考字形（右） | L08、C012 |
| 换库 › / 在学的字库 / 已练 N / 共 M 可练 · 官方 X | 843、878、2022 | 更换字库 › / 练习范围 / 可以练 N 个字 · 有记录 M 个 | C078、C093–C099 |
| 义教基础字 | 1125 | 小学初中常用字 | C096、C157 |
| 纸墨声音 | 881、1373–1375 | 按键音 | C079 |
| 盖章 N天 · 累计 N天 / 盖章天数 | 1922、1953、1966 | 有记录 N 天 | C052、C070–C072 |
| 上次备份 · N 天前 / 从未备份 | 2990 | 上次备份 {日期} / 还没有备份 | C107 |
| 练过 N 次（汉字/阿拉伯混用） | 1993 | 记录了 N 次 | C110–C113 |
| 晨 / 午 / 暮 / 夜 | 1844 | 早上 / 中午 / 傍晚 / 晚上 | C005–C008 |
| 今天拾十五个字 / 今日已拾N个字 | 678、1872–1879 | 今天写几个字 / 今天记录了 N 个字 | C001、交接备注四 |
| 先练 15 个字 / 约 6–8 分钟… | 667–668 | （首启页删除；首页「第一次来，先写 5 个字试试。」） | D17、C009 |
| 再拾一组 / 明天见 / 回首页 | 806、833–834 | 结果页离开按钮按来源「回到写错过 / 回到快忘了 / 回到有记录的字」等 | 10.4、10.7、10.8、S05 |
| 拾于生活 / 拍一个字 / 拍字照片 | 966、998、1008–1010、901、905 | （删除） | 无新 OCR |
| 墨色即记忆 · 淡了就去写 | 850 | 墨色越浅，越久没写。点一个字，看它每次的笔迹。（深色：颜色越暗，越久没写） | C144、L14 |
| 字库还空着。拾一组字，墨色会从这里长出来。 | 2033 | 去「习字」写几个字，判断过对错，就会出现在这里。 | C145 |
| 「盖章音效已开启，可在「我的」→「设置」→「纸墨声音」中关闭」 | 1375 | 路径与叫法随「设置 / 按键音」改 | 第零节 |
| 设置分组「数据」：导出备份 / 恢复备份 / 清空当前数据 | 899–903 | 备份与恢复页：导出备份文件 / 替换 / 清空 + 撤销 + 状态句 | D24、K01/K02 |

## 5. 风险与坑

1. **视图切换只是 display 切换**：没有焦点迁移、没有 `aria-hidden` 收起非活动视图、没有 `inert`，读屏可能读到隐藏视图外的内容（隐藏用 `display:none` 尚可）；弹层无焦点陷阱与焦点归还。v10 要求页面切换走 iOS 原生方式含边缘右滑返回——需在 WKWebView 侧接 `shizi-native-back`（2774）并让每个新子页登记返回目标。
2. **写字页历史栈技巧**（1767–1778）：`pushState` + `popstate` 中 `history.forward()` 的组合在 Safari/WKWebView 的手势返回上可能产生双跳或卡住；新增子页时不要复用这套逻辑而不测真机。
3. **`renderMeMonthCard` 每次进「我的」都渲染 1080×1440 大图**并解码最多 80 张 webp（1901–1903、1947），低端设备进我的页有卡顿风险；应改为按需渲染或缓存。
4. **`cardIndexForStoredKey` 线性扫描**（1935）在月帖/年报中对每个 key 遍历 8105 张卡，O(N·M)；年报/月帖字多时应先建 `Map`。
5. **画布字体写死系统字体**（`"Songti SC","STSong"` / `"Kaiti SC","STKaiti"` / `-apple-system,"PingFang SC"`，1946–1956、2934–2938、2963–2975）：非 Apple 设备回退为通用 serif/sans；且 canvas 不会等待 `@font-face` 加载，D13 引入 ShiziKai/Noto Serif SC 后必须 `document.fonts.load()` 再绘制。
6. **画布颜色写死浅色**：深色模式下预览（`#handCardPreview`、`#meMonthPreview`）与界面色调不一致，但导出图一致；v10 也未要求深色导出，需产品确认。
7. **`recentInk` 上限 96 份 / 420KiB**（1144、1178）与 `WILD` 30 张 / 420KiB：decisions.md 明示「不以旧 96 份/420KiB 当新政策」；月帖/字帖/字卡对缺墨的处理都依赖这个淘汰策略，需先定保留政策。
8. **月帖取墨口径三方不一致**：代码取 `recentInk`（最后一次，且要求 `recentInk.day` 同月）；D11 说「月图取月内最后判断」；v10 M02 说「用这个月第一次写这个字那一次的笔迹」。此外 `recentInk` 只存**最后一次**笔迹，M02「第一次」在现有存储上**算不出来**（需要逐判断笔迹存储，而 D14 已暂停该案）。
9. **超 80 字**：月帖在 `maxTiles=80` 处截字并加一句说明（1948、1951），D12 要求返回 pending 不擅自截字。
10. **`addWord` 的副作用**（2126–2136）：加字即写 `misses+1`/`lastOutcome="miss"`/`status="indeck"`/`queuedFront`，还会改变 FSRS 队列——若沿用做「加入自选」，会把「加入」当成「写错过」（违反 D21/D23/D03）。改造时要连同 `queuedFrontPool`（2156）与 `recordRealWorldMiss` 一起重新设计。
11. **`libraryCounts` 对 `BASE_N` 卡逐库遍历**（2018）在换库弹层里 ×4，每次打开都算；v10 还要求「有记录 M 个」按记录算，可以接受但应缓存。
12. **印历只按本地 `today()`**：跨时区/凌晨切换时 `practiceDays` 与 `daily` 的日键由 `dayKey(new Date())` 决定（1183），无时区字段；月帖/年报按字符串前缀过滤。
13. **`annualReady = getMonth()===11`** 与 `isDark()` 等纯客户端判断没有测试注入点；`timeWord()` 分界与 v10 不同。
14. **更大字体反而缩小书写格**（2167–2169 `large?236:218`），与 W15/V02 相反；`--font-scale:1.12` 单档且不跟随系统字号（C083）。
15. **`#addSheet` 缺 `role=dialog`**、`.foot .tab` 用无 href 的 `<a>`、`#calendarMonthStat` 用 `role="group"` 承载文本（857）——都是可访问性小坑；v10 要求可点控件一律按钮。
16. **深色下墙最浅一档 `--memory-5 #8d826e`** 与背景 `#1d1a15` 对比不足（L14 已指出），且当前墨色语义（稳定度）与 v10（时间）相反，迁移期间用户会看到含义翻转。
17. **`homeAdd` 在反馈阶段打开会暂停自动推进**（2887、2890）：`feedbackPausedForAdd` 与 `autoNextTimer` 的耦合意味着删除收字面板时要一并检查写字流程里的暂停/恢复路径。
18. **`insertIntoCurrentBatch`**（2142–2155）允许在写字中途把字插进当前组；D05 要求临时自选会话隔离、开始 C 不覆盖 B——v10 的「自己选字」应开新组而非插队。
19. **`OUTCOME_STORY`/`GRADE_UI` 只有四种结果**，没有「看过答案」「跳过」；单字详情、图片、墙的红点都会在 D18/D23 落地时需要新的结果枚举（属核心模块，但壳层文案依赖它）。
20. **iOS `savePracticeCard` 只接受 PNG 且 ≤12MB**（Swift 1589–1602），1080×1440 PNG 通常 <2MB，无虞；但若改为更高分辨率或 JPEG 需同步壳。
21. **Web Share 文件分享在 iOS PWA（非壳）里 `canShare({files})` 可能返回 false**，会退到 `<a download>`，Safari 会打开新标签而非保存——现有 toast「已存成图片」在此情形下并不准确。

## 6. 未解问题

1. 月帖/字帖到底取「月内第一次笔迹」（M02，v10 09-30）还是「月内最后判断」（D11，09-27）？现有存储只有最后一次墨迹，若按 M02 需要新的逐判断存储（D14 暂停）——需产品与工程共同裁决。
2. 我的页 v10 的「这一周」区块具体内容（是七格日历还是七天笔迹）在已读文档中没有展开；需看全套页面第 8 节。
3. 「关于」三子页（隐私 / 开源资料 · 致谢 / 给我们写信）的文案与「给我们写信」的实现方式（mailto? 复制地址?）未在仓库文档中找到。
4. 设置里「外观」三选项要不要用 `data-theme` 覆盖 `prefers-color-scheme`？现有令牌只在媒体查询内定义，需要重构为 `:root[data-theme=dark]` 双写。
5. 手写字图片是否保留 1:1「头像」尺寸？A05 版式规格在设计项目里，仓库内无副本。
6. 首页题记：D13 说「宋体先固定文案+三条题记」，三条具体是哪三条、是否仍按日轮换、`DAILY_MOTTOS` 52 条语料是否作废？
7. `activity.daily[].makeup/makeupAt/monthly.makeupDays` 字段在 D24 后是否要在导入备份时清洗，还是只停止写入？
8. 备份行「!」催导出与 `backupReminder` 阈值（14 天/30 天/5 天/30 字/7 天）在 v10 中是否全部作废，只剩 K02 的状态句？
9. `#pos`（658）与 `updateBookBadge()` 空函数（1860）、`lastDayIndexes()`（1849）疑似死代码，未在范围内找到引用，删除前需全文确认。
10. v10 要求「墙最多 8 行」「自选了还没写排最前」——「自选了还没写」的字目前不在 `memory` 里（无 `seen`），需要新的自选列表存储键；具体形状未定。
