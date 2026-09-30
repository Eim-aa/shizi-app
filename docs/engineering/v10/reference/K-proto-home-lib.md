# 第十稿原型 · 首页壳 v3 与字库墨墙屏

> 阅读范围（只读，未改任何文件）：
>
> - **H** = `docs/design/v10/extracted/首页壳-v3-第十稿交接版.dc.html`（原名 `首页壳-v3-第十稿交接版.dc.html`，242 行，全读）
> - **L** = `docs/design/v10/extracted/字库墨墙屏-第十稿交接版.dc.html`（原名 `字库墨墙屏-第十稿交接版.dc.html`，460 行，全读）
> - **PM** = `.../docs/design/v10/extracted/proto-model-第十稿交接版.js`（`proto-model-第十稿交接版.js`，演示数据与 `window.SZProto` API，L 依赖它算清单）
> - **INK** = `.../docs/design/v10/extracted/ink-第十稿交接版.js`（`ink-第十稿交接版.js`，`window.SZInk` 笔迹管线）
> - **APP** = `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/docs/design/v10/shizi-v10-交接版.html`（单文件可点原型；子文档以转义 JSON 字串嵌在少数几行里，故下文用 **@字节偏移** 定位，不用行号）
> - 决定依据：`docs/handoff/decisions.md`（D01–D25）、`docs/product/04-v10-handoff.md`、`docs/design/v10/交接备注-第十稿交接版.md`（§四写死计数、§十给工程）、`第十稿-改动清单`、`第十稿-文案修改清单`、`第十稿-边开发边改清单`。
> - 对照现有产品代码：仓库根目录 `index.html`（3102 行，无 `src/`），只做与 v10 决定矛盾的抽查。

---

## 1. 概览

1. 首页壳 v3（H）和字库墨墙屏（L）都是 dc-runtime 组件（`<x-dc>` 模板 + `class Component extends DCLogic` 的 `renderVals()`），模板用 `{{ }}` 绑定、`<sc-if>`/`<sc-for>` 控制结构，交互全部靠根节点事件委托读 `data-nav` 属性再回调 `onNavigate(key)`（L:341）；首页则给每个按钮单独绑 `onClick`（H:55、71、74、81、85、86）。
2. 两者都不持有业务状态：数据从 props 传入（`records`、`added`、`today`、`library`、`lk`、`sort/filter/fold/find/off` 等），状态变更全部由 APP 里的 `homeNav`（@346764）和 `onScrNav`（@362114 起）处理后重新渲染；因此 H/L 是**纯视图层**，可复用的是布局、文案、绘制算法和键名契约，不是状态机。
3. 首页壳按时段（早上/中午/傍晚/晚上）切光影层、三条固定题记、「拾」红块主入口（开始写字/继续写字）、S01 两行“哪一组 · 还有 N 个字没写”、今天记录了 N 个字 + 墨迹行（D12：N≤8 全显，N>8 取最近 8 个）、“自己选字 →”、三 tab。标准 393×852 与紧凑 360×640 两套绝对定位布局并存（H:37–89 / 90–127）。
4. 字库墨墙屏一个组件画 6 个屏：字库首页（墨墙 + 写错过/快忘了卡片）、有记录的字完整页（排序×3、筛选×4、按月折叠、页内查字定位）、写错过/快忘了清单（勾选 + 练这些字）、查字/自己选字底部弹层（K29/D21 合并后的统一组件，含逐字行、卡片、加入自选、不能练三态）、以及 `sheetOnly` 模式只画弹层盖在首页上。
5. 所有“数字”在传入 `records` 时都由 `SZProto.lists()`（PM:87–90）和组件内 `cntOf/latestOf/toneOf` 实时算；仍写死的是：首页日期字串“9 月 24 日”、`today` 默认 `'9-24'`、题记轮换索引 `267`、快忘了的 90 天/最多 12 个规则、墨色四档 7/30/90 天、墙最多 8 行、字库字数表 `LIBN`（已成死代码）。
6. 与 v10 决定的关系：D12、D17（5 个字）、D21/K29（明确点“加入”）、D23（写错过命名与只看最近一次有效记录）、K28（写错的字墙上显示标准楷体+红点）、L05（清单行右侧小图为那次笔迹）、S01/S02 都已在原型落地；但**iOS 同步 focus**（L:264、421 都是 `setTimeout` 异步）、**M07**（首页墨迹行点进练习记录而非今天的结果）、**K06**（清空后又说“第一次来”）、**L09/Z02** 等属交接时已知未改。
7. 现有 `index.html` 是第八稿之前的旧产品（“今日拾得/收字/收进字库/今日一字/金菱朱砂/补记/需要再练/汉字数字”），与 D02、D17、D18、D23、D24 及文案口径全面冲突，首页与字库应按原型**重写**而非改造。

---

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口（props / 事件键 / 存储键） | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| 首页壳 · 模板（标准版） | H:15–89 | 393×852 绝对定位布局：纸纹(17)、光影层(19)、叶影素材位(21–23)、状态栏(26–35)、日期+时段(38)、题记(40–50)、大标题(52)、「拾」红块(54–59)/条形旧方案(60–66)、S01 两行(68–72)、墨迹行(73–77)、计数行(79)、自己选字(81)、三 tab(83–87)、Home 指示条(88) | 绑定：`periodCh q1 q2 src qCol srcCol ctaLabel resumeLine otherLine inkRow rowText pickTopC`；事件 `onStart onOther onInk onPick onTabLib onTabMine` | 字体 CDN（H:13） | **可抽取改造** | 绝对定位坐标是原型近似；正式版需响应式与安全区；旧方案 `entry=bar`/`fill` 应删 |
| 首页壳 · 模板（紧凑版） | H:90–127 | 360×640 “更大字体”版，文字大一档、间距收紧；墨迹和计数合成一行（A09，只放最近 4 个） | 同上 + `inkRowC pickTopC srcColC` | — | 可抽取改造 | 与 D12 的“N>8 显示最近 8 项”不同（只显 4 个，数字仍 N），见 §4 |
| 首页壳 · 属性面板 | H:130 | `state: first/empty/record(默认)`、`resume: bool`、`theme: base/th1`、`period: dawn/noon/dusk/night/auto(默认 dawn)`、`lamp: .04–.06`、`quote: auto/4/5/7`、`pressed`、`entry: block/bar`（旧方案）、`fill: base/f1/f2/f3`（旧方案）、`resumeLine`、`otherLine`（S01） | 未声明但实际读取的 props：`records today size bare onNavigate`（H:168、214、218、221、235） | — | 可抽取改造 | 生产版应把 `state` 改为从记录派生，见 §5 |
| 主题令牌 `TH` | H:133–138 | 浅/深两套 CSS 变量（`--p --c --i1 --i2 --i3 --i5 --ar --seal --ln --tt --tb --tm --tn --hi`）+ `btn/down` | 通过 `frame` style 注入 | — | 可直接复用（数值） | 与 L:253–256 的令牌名有重叠但取值集合不同（L 多 `--sh --off --i4 --a --g --scrim`）；主题 prop 命名 `th1` vs `dark` 不一致 |
| 题记 `QUOTES/QH` | H:140–142, 215, 224–226 | 三条等长对句 + 出处；`quote` 为 4/5/7 选对应条，`auto` = `267 % 3`；每字 18pt 竖排，列高 96/114/150 | `q1 q2 src qCol srcCol` | Noto Serif SC 400 | **可直接复用（内容）/ 应改（选句规则）** | 267 = 9 月 24 日的年内序号，等价 `doy % 3`，但写死了。D13“宋体先固定文案+三条题记” |
| 时段 `PERIOD` + `period()` | H:143, 175 | `dawn:'早上' noon:'中午' dusk:'傍晚' night:'晚上'`；`auto` 按本地小时 5–10 早/10–15 午/15–19 傍晚/其余晚上 | `periodCh` | `Date` | 可直接复用 | 文案 C005–C008 已把 晨/午/暮/夜 改为四个双字词 |
| 光影层 `lightLayer()` + 600ms 淡入 | H:145–152, 174, 196–210 | 非夜间：底光 radial + 两枝叶影（`BRANCHES` 几何、`blur`）+ 顶部日光；中午枝叶右移 126、模糊 +3、强度 ×.7；傍晚整层 `scaleX(-1)` 且色调 120,86,52；夜间浅色只留灯光 radial；深色不画底光/日光、叶影改黑 .30 模糊 12。`period` 变化时对层做 opacity 0→1 600ms ease-out，`prefers-reduced-motion` 下直接切 | 无 | Web Animations API | 可抽取改造 | 只在 **prop** 变化时动画；`auto` 模式下真实跨时段不会触发重渲染（无定时器），见 §5 |
| 「拾」主入口 | H:54–59（紧凑 104–107） | 196×190 圆角 28 红块，纸纹叠层，`拾` 64px 楷体 + `{{ctaLabel}} →`；`ctaLabel = resume ? '继续写字' : '开始写字'`（H:228） | `onStart` → `onNavigate('start')` | LXGW WenKai GB | 可抽取改造 | 生产字体按 D13 改 ShiziKai |
| S01 两行 | H:68–72（紧凑 108–111）, 229–230 | `resumeLine` 非空则显示居中说明行；`otherLine` 也非空则再显示带下划线按钮“{{otherLine}} ›” → `onNavigate('other')`。**显示 S01 时墨迹行与计数行都隐藏**（`hasInkS = record && !resumeLine`，`noResume = !resumeLine`） | 字串由 APP 拼：`grpLabel(cs)+' · 还有 '+grpRest(cs)+' 个字没写'`（APP @379350）；`grpLabel`：pick→`这次选的字`、first→`第一次练习`、其余→`今天的练习`（APP @350028）；`otherSlot()` 只在 B、A 都未完成时返回 `'A'` | — | 可直接复用（规则） | 与文案清单 N51 一致（“· 还有 {N} 个字没写”） |
| 墨迹行 + 计数 | H:73–79, 154–156, 176–194, 218, 229–236 | `todayList()`：`r.d===today && v∈{R,W}`，同字保留最后一次判断（Map 删再插）；`recs = list.slice(-8)`；`rowText.record = '今天记录了 '+list.length+' 个字'`；`hand()` 画 26×26 SVG：有 `strokes` 直接 `SZInk.outline`，否则 `SZInk.pick(c,'wrong'|'normal')` 真人样本或按 `c+d` 种子从 hanzi-writer medians 合成；写错按 `WRONG` 删笔/错位 | `onInk` → `onNavigate('records')`；aria-label “今天有记录的字，打开练习记录” | `window.__szStore` 缓存、jsDelivr `hanzi-writer-data@2.0`、`SZInk`、`szink` 事件 | 可抽取改造 | D12 ✓；M07 要求点进“今天的记录”而非练习记录；无 `records` 时退回写死 `TODAY`（H:154） |
| 自己选字入口 | H:81（紧凑 120） | 文字按钮“自己选字 →” | `onPick` → `onNavigate('pick')` → APP 开 `lk={mode:'pick',src:'home'}`（@347516） | — | 可直接复用 | D21/K29：首页自己选字与查字同一组件 |
| 三 tab | H:83–87（紧凑 121–125）; L:138–144 | 习字 / 字库 / 我的，当前 tab 用 `--ar` | `onTabLib onTabMine` / L 用 `data-nav="home|library|mine"` | — | 可直接复用（图标/文案） | L 的 tab 是 `<span>` 不是 button |
| 字库 · 首页 | L:26–79, 353–365 | 顶部：标题“字库”→ 查字框 → 说明 → 练习范围（库名 + 更换字库 ›）→ 有记录的字大数字与两条事实 → 写错过/快忘了两张卡 → 图例 + 墨墙（最多 `cols*8` 格）→ 说明 + “全部 ›”；无记录时空态 | `data-nav`: `lookup libSwitch allWritten detail:<c> wrongList forgetList`；绑定 `libLine nBig factA factB cards wall legend shiEl` | `SZProto.lists`（有 records 时）、`hollow/wrongStd/ink` | **可抽取改造** | L09 待改：大数字不可点、墙截断无“还有 N 个字 ›”、空卡仍是卡片样式 |
| 字库 · 卡片工厂 `card()` | L:358–361 | 写错过（红点，`D.wr`）、快忘了（`D.fg`）；`why`/空态文案、`n`、`act`（1 个→练这个字，否则练这些字）、`mini` 前 4 格（写错的字用 `wrongStd`） | `nav` 仅列表非空时给 | — | 可直接复用（规则） | K28 ✓ |
| 字库 · 墨墙 `cellOf()` | L:350–351, 362–363 | 顺序：自选了还没写（空心）→ 其余按最近一次判断新→旧；写错过用 `wrongStd`（标准楷体 `--i2` 缩 .9 + 红点），其余 `ink()` 按 `toneOf` 四档透明度 | `nav:'detail:'+c`、`hit` 描圈 | hanzi-writer data | 可直接复用（算法） | 无笔画数据的字空心格会画成空白（`hollow` 无 D 时返回空 svg，L:303） |
| 墨色四档 `TONES/TL/toneOf` | L:222–223, 298 | `std:[1,.78,.58,.4]`（最淡 ≥ .4，核对意见一.2）；档位 `≤7 / ≤30 / ≤90 / >90 天`；图例 `一周内写过 / 一个月内 / 三个月内 / 三个月以上` | `legend tone` | `doy()` | 可直接复用（值）/ 阈值待产品 | 交接备注 §四列为“仍写死” |
| 有记录的字完整页 | L:85–114, 367–402 | 排序 `recent/py/age`、筛选 `wrong/forget/unw/custom`（再点取消）、按月分组默认展开最近两个月（`fold` 覆盖）、收起月份列表、页内查字（`find`）命中只显示那月并描圈“在 X 月”，未命中“「X」还没有记录。”；`budget=72` 格（live/tall 不限） | `data-nav`: `sort:<k> filter:<k> fold:<m> filterGo detail:<c> back`；`onFindInput(text)` | `pyKey`（去声调）、`SZProto.SAMPLES/pyOf` | 可抽取改造 | L11 待改（排序筛选并存、0 个筛选可点、拼音分组不标拼音、不支持拼音查） |
| 写错过 / 快忘了清单 | L:116–136, 404–414 | 默认全选（`off` 记录取消项），每行：圆圈勾选（44×44 `role=checkbox`）→ 标准字 36/48 → 词语（目标字加粗）+ 两段小字 → 右侧 44×44 那次笔迹小图（写错过下标“写错那次”，快忘了无标）→ ›；空态 88×88 虚框“错/忘” | `data-nav`: `sel:<c>`（勾选）、`detail:<c>`（行）、`listGo`；绑定 `lsHead lsWhy lsRows lsNote lsHint lsGo lsBg lsFg leGlyph leTitle leWhy` | `cntOf`、`wordParts`、`md` | **可直接复用（结构与文案）** | L05/K28 ✓；Z02：底部按钮 0 个时只是灰，没有 `disabled`；S06 待改（返回保留勾选、全选/全不选） |
| 查字 / 自己选字弹层 | L:146–183, 415–452 | `lk={mode:'lookup'|'add'|'pick',text,cur,unsel,addFail}`；标题 pick→“自己选字”，否则“查字”；输入去重取汉字；单字自动成 `cur`；视图 `hint → rows → card | bad`；行尾状态；卡片“你的书写 | 参考字形”（L08）+ 字/拼音/N 画/词语/记录行 + 按钮“练这个字”“加入自选的字 | 已在自选的字里”“查看记录”；加入失败三行；不能练两态；多字底栏“练这 N 个字 / 练这个字 / 先选一个字” | `data-nav`: `lkClose lkList lkPick:<c> lkSel:<c> lkPractice lkAdd lkAddStay lkDetail lkGo`；`onLkInput(text)`；`kb`（键盘高度）抬升弹层 | `SZProto.canPractice/pyOf/SAMPLES`、hanzi-writer data、`window.__szStore` | **可抽取改造** | D21/K29 ✓（`lkGo` 不写 `added`，只有 `lkAdd` 写，APP @363299/@363660）；**focus 异步**（L:264 80ms、L:421 30ms）与交接备注“iOS 同步 focus”冲突 |
| `sheetOnly` 模式 | L:453–454；APP @278604 | 首页“自己选字”时把 L 以 `sheet-only screen="home"` 叠在首页上（z-index 3），只画弹层，frame 透明 | prop `sheetOnly`（未在 data-props 声明） | — | 可直接复用（思路） | 生产应把弹层抽成独立组件而非整屏透明叠加 |
| 有记录但无笔迹 `noInk()` | L:285–290 | `r.ink==='none'`：系统字体灰字 + “没有笔迹”（≥36pt）/“这一次没有留下笔迹”（≥110pt）；<36pt 只画字；不拿别次笔迹补位 | — | — | 可直接复用 | 10.12 / I03 ✓ |
| 取数队列 `Q/request()` + 缓存 `PC/SC/ST` | L:190–199, 265–266, 282–284 | 全页多实例共用一个 40ms 合批的 hanzi-writer 取数队列；路径缓存键 `c|d|v|floor`、笔画缓存键 `c|d|v`；实时笔迹键含 `r.id` | `window.__szStore __mqQ __mqPaths __mqStrokes` | jsDelivr | 应重写 | 全局无界 Map；生产应用本地打包数据 + LRU |
| 演示数据 `DAYS/FIX/R30/F30/H30/get300/LKS/WORDS/GLOSS/PY0/LIBN` | L:204–252 | 画布静态预设与 30/300 字探索数据；`LIBN` 四库字数表 | 无 | `SZProto.extra300` | **不复用** | `LIBN` 在 C154–158 后已无引用（死代码）；`F30` 快忘了是手工指定 |
| `SZProto`（PM） | PM:4–145 | `KEY='shizi-proto-v9' VERSION=4 TODAY='9-24'`；`SAMPLES`（30+7 字）、`PYX`（270 字拼音）、`QUEUES{first:'部主性体次',ord,again}`、`CUSTOM`、`lists()`、`canPractice/pyOf/item`、`build/session/seed/load/save/enc/dec/restoreData/doy/toD/ago/extra300/demo300` | `window.SZProto`；localStorage 单键 | — | **应重写**（算法思路可参考） | `lists()` 的 K15/K16 规则可直接作为规格；90 天/12 个是模拟 |
| `SZInk`（INK） | INK:1–80 | `{BASE:11.5, build, synth(pts,base), atSpeed, resample, wrongFix(st,W,cc), outline(pts,floor)→path d, register(list), pick(c,kind,n), fromRecord(rec,base), play, rev, sources}`；`register` 派发 `window 'szink'` | `window.SZInk` | — | 另有读者覆盖（C-ink） | H/L 只用 `outline/synth/pick/fromRecord/wrongFix` |

---

## 3. 数据契约

### 3.1 记录（`records` prop，H:168、L:188 声明 `Array<{c,d,v,i,strokes?}>|null`）

实际读取的字段（H:178–194、L:284–297、PM:79–81、102–105）：

| 字段 | 类型 | 含义 | 出处 |
|---|---|---|---|
| `id` | string（`'d12'`/`'f0'`/`'x3'`/`'e-a1'`） | 记录 id；L:284 实时笔迹缓存键用到 | PM:80、110、113 |
| `c` | string（单个汉字） | 目标字 | — |
| `d` | string `'M-D'`（**无年份**，2026 不跨年） | 判断日期；`doy()` 转年内序号；`md()` → `"M 月 D 日"` | PM:83–85、L:217、220 |
| `v` | `'R'` 写对 / `'W'` 写错 / `'S'` 跳过 / `'A'` 看过答案 | 判断；`seed()` 把 R/W 放 `records`、S/A 放 `events`（PM:79–81）；H/L 只认 R/W（H:178、L:324） | PM:57 注释 |
| `i` | number | 当天/组内序号，同日排序用 | L:224–225 |
| `help` | `''`/`'answer'` | 帮助事实 | PM:80 |
| `sid` | string | 所属会话 id | PM:113 |
| `strokes?` | `[[{x,y,w}]]`（345×345 pt 空间，`w` 笔宽） | 原型里实时写下的本人笔迹；存储时压成 `"x,y,w;x,y,w|…"`（`enc/dec`，PM:118–121） | H:179、L:283–284 |
| `ink?` | `'none'` / `'shape'` | 10.12：那一次没有留下笔迹 / 只有形状无 t/p | PM:104、L:291 |

`SZProto.lists(records, today)`（PM:87–90）→ `{latest:{[c]:record}, wrong:[record…]（v==='W'，新→旧）, forget:[record…]（v==='R' 且 ago>90，旧→新，最多 12）, forgetAll:number}`。L:324–325 把它包成 `D = {calc:true, recs(仅 R/W), L, wr, fg, hol(added 中 latest 没有的), added, first(最早 d)}`。

### 3.2 `added`（自选的字）

`string[]`（PM:64 `CUSTOM`，APP `a.added`）。L 用它算：`hol = added.filter(c=>!latest[c])`（自选了还没写）、`custom` 筛选计数 `D.added.length`（L:376）、卡片按钮 `lkAddOn=!added.has(cur)`（L:444）。写入只在 APP `lkAdd`：`if(!x.added.includes(c)) x.added.push(c)`（@363660）；移除在单字详情 `rmCustom`（@366715）。

### 3.3 会话（APP 里 `a.A`/`a.B`，H 的 S01 来源）

`session()`（PM:82）：`{id:'sN', kind:'first'|'ord'|'pick'|'again', src, queue:[c…], i, phase:'recall', hints, used, saw, strokes:[], sim, line, lastRid, items:[{c,v,rid?}], done, diff}`，另有 `ended`、`remind`、`demoFail`。S01 计算：`cs = B未完成 ? B : A未完成 ? A : null`，`grpRest = queue.length - items.length`（APP @379350、@350028）。

### 3.4 首页派生状态（APP @379350）

`hState = recs.length===0 ? 'first' : recs.some(r=>r.d===today) ? 'record' : 'empty'`；`hResume = !!resume`（有未完成 A/B）；`hResumeLine`/`hOtherLine` 见 §2。`<dc-import name="首页壳-v3-第十稿交接版" state resume resume-line other-line records today="9-24" theme period lamp bare size on-navigate>`（@278120）。

### 3.5 字库屏 props（L:188；APP @281120）

`screen: home|lkType|lkRec|lkNew|lkBad|add|all|wrong|forget`；`n: 0|5|30|300`；`data: ''|proto|proto300`；`theme: light|dark`；`size: std|compact`；`tall`；`sort: recent|py|age`；`filter: ''|wrong|forget|unw|custom`；`find: string`（`'auto'` 取 `D.find`）；`empty`；`tone: soft|std|strong`；`mark: dot|brush`；`dens: -1|0|1`；`records`；`added`；`today`（默认 `'9-24'`）；`library`（默认 `'规范常用字'`）；`libCount`（声明了但组件内未用）；`lamp`；`bare`；`fixed`；`fold: Record<month,boolean>`；`off: string[]`（清单取消勾选的字）；`lk: {mode,text,cur?,unsel?,addFail?}`（声明写作 `fail?`，代码读 `addFail`，L:444）；`kb: number`（键盘高度 px）；`onNavigate(key)`；`onLkInput(text)`；`onFindInput(text)`；未声明的 `sheetOnly`。

APP 传入：`screen="{{libScr}}" records added today="9-24" library theme lamp bare size fixed sort filter fold find off lk kb on-navigate on-lk-input on-find-input`；视图状态存在 `a.view = {name:'library'|'allWritten'|'wrongList'|'forgetList', from, sort, filter, fold, find, off}`（APP @364913–@365748）。

### 3.6 事件键（`onNavigate(key)`）

- **H 发出**：`start` `pick` `records` `library` `other` `mine`（H:235）。
- **L 发出**：`lookup` `libSwitch` `allWritten` `wrongList` `forgetList` `back` `home` `library` `mine` `detail:<c>` `sort:<recent|py|age>` `filter:<wrong|forget|unw|custom>` `fold:<month>` `filterGo` `sel:<c>` `listGo` `lkClose` `lkList` `lkPick:<c>` `lkSel:<c>` `lkPractice` `lkAdd` `lkAddStay` `lkDetail` `lkGo`。
- **APP 侧处理要点**：`start`：B 未完成→写 B；A 未完成→写 A；未 `introSeen`→新建 `first` 会话（`QUEUES.first` 5 字，D17）直接进写字页；否则新建 `ord`（@346764）。`pick`→`ui.lk={mode:'pick',src:'home'}`。`other`→写 `otherSlot()`。`records`→`push({name:'records',m:9})`。`lkGo`→`startB(sel,src)`（**不写 `added`**）；`lkAdd`→写 `added` 成功则 `note('「X」已加入自选的字。')`（3.2 s）否则 `addFail=true`；`lkDetail`→`push({name:'detail',c,lookup:{text,cur,mode,src}})`（返回时恢复弹层，L04）；`lkClose`→`leave('lk')` 无确认。`startB()`（@351810）：若 B 未完成 → `confirm{text:'上一组还有'+rest.map(c=>'「'+c+'」').join('')+'没写。', yes:'接着写那组', three:true, mid:'结束那组，开新的'}`（第三键“取消”由 `three:true` 提供），`okMid` 按 10.10 结束旧组（已判断保留、未写不算记录/跳过、不出结果页）后新建 B。`sel:<c>` 切换 `view.off`；`listGo` 用 `lists()` 重算清单减 `off` 后 `startB(list,{name:v.name,from})`；`filterGo`：wrong/forget→推清单页，unw→`startB(hol,…)`；`fold:<m>` 默认展开最近两个月再取反。

### 3.7 存储键

- 原型：`localStorage['shizi-proto-v9']`，`VERSION=4`，单键整包 JSON（`pack/unpack` 把 `strokes` 压字串），版本不符自动重置（PM:4、124–134）。**不接生产存储**（PM:1）。
- 全局缓存：`window.__szStore={data:{[c]:hanziWriterJson|null}, pend:{[c]:Promise}}`（H:157、L:190）、`window.__mqQ`、`__mqPaths`、`__mqStrokes`（L:197–199）。
- 外部数据：`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/<c>.json` → `{strokes:[svgPath…], medians:[[[x,y]…]…]}`，1024 单位、y 向上（`GT` 变换 L:189）。

### 3.8 题面样本（PM:8–48）

`SAMPLES[c] = {py, word:[字…], blank:目标位下标, groups:[[笔画下标…]…], fb?:1, gloss?}`；`PYX[c]=py`（270 字只有拼音）；`canPractice(c)=!!(SAMPLES[c]||PYX[c])`。L:244–248 的 `wordOf/wordParts/pyOf/pyKey` 依赖它；缺失时退回 L:241–243 的 `WORDS/GLOSS/PY0`。

---

## 4. 与第十稿（v10）决定的关系

### 4.1 已按 v10 落地（可作规格参考）

| 决定 | 原型体现 |
|---|---|
| D02 三导航、首页唯一主入口、无记录不显示零统计 | H:83–87 三 tab；`state==='empty'` 时 `rowText=''`（H:236）；无重复续练卡 |
| D12 首页 N | H:218 `recs=list.slice(-8)`、H:231 墨迹行取 `recs`、H:236 数字用 `list.length` |
| D17 第一次 5 个字、直接进写字页 | `rowText.first='第一次来，先写 5 个字试试。'`（H:236，C009）；APP `start` 未 `introSeen` 直接建 `first` 会话（@346764） |
| D18/D23 有效记录只算 R/W | H:178、L:324、PM:87 都过滤 `v∈{R,W}`；`cntOf` 的“记录了 N 次”自然不含 S/A |
| D21/K29 加入自选须明确点“加入” | L:169 “加入自选的字”按钮；APP `lkGo`/`lkPractice` 不写 `added`，只有 `lkAdd` 写（@363299、@363660、@364192） |
| D23 “写错过”命名、只看最近一次有效记录 | `lists()` 用 `latest` 判 `v==='W'`（PM:87–89）；全部文案已是“写错过”；`againList` 键仅作兼容跳转（@366377） |
| K15/K16 两张清单不重叠 | `forget` 只取 `v==='R'`（PM:89） |
| K28 写错的字墙上/卡片预览显示标准楷体 + 红点 | `wrongStd()` L:311–313；墙 L:351、卡片 mini L:359 |
| L05 清单每行标准字大字 + 词语 + 右侧那次笔迹小图 | L:120 `stdOn` 结构；`ink(r,{px:44,guide:true})`（L:412）；写错过标“写错那次”，快忘了无标（X13） |
| L08 你的书写在左、参考字形在右 | L:163–165 |
| S01 首页写明哪一组、两组都没写完时另一组再列一行 | H:68–72；APP @379350 |
| S02 开新组统一确认框 | APP `startB()` @351810，正文与三键与文案清单零节一致 |
| 10.12 有记录无笔迹 | `noInk()` L:285–290 |
| 10.3 K19 第四个筛选“自选的字” | L:376–384 |
| 文案口径（阿拉伯数字、「」、保存失败句式） | L 全文；`cn()` 仅定义未用于界面（L:219） |

### 4.2 原型与 v10 决定 / 交接要求 **冲突或未达** 的地方

| 编号 | 问题 | 位置 | 应如何 |
|---|---|---|---|
| 交接备注 §五 | 查字框 focus 是 `setTimeout(…,80)` / `(…,30)` 异步 | L:264、L:421 | iOS 要在点击处理里**同步** `focus()` |
| 交接备注 §五 | 可点控件多为 `div/span[data-nav]`，不是 `<button>` | L:30、33、63–68、96–97、107、111、140–142、156、158；H:85–86、123–124 tab 也是 div | 正式版一律用按钮/可聚焦元素 |
| §十.1 数字一律从记录算 | 首页日期“9 月 24 日”写死；`today` 默认 `'9-24'`；APP 全部 `today="9-24"` | H:38、91、218；L:188、334；APP @278120、@281120 | 由系统日期算，格式“{M} 月 {D} 日 · {时段}”（C003） |
| 题记选句 | `auto` 固定 `267%3` | H:215 | 定义轮换规则（按日 `doy%3` 或其他），D13 三条句库不变 |
| K06（边开发边改） | 清空后 `recs.length===0` → `'first'` → “第一次来，先写 5 个字试试。” | APP @379350、H:236 | 清空后用“没有记录”的说法，`first` 应绑 `introSeen`/首次会话未完成 |
| M07 | 首页墨迹行 → 练习记录页，aria-label 也写“打开练习记录” | H:74、235；APP @347747 | 点进今天的记录/结果 |
| L09 | 大数字不可点；墙截断 `cols*8` 只有“全部 ›”；空卡片仍卡片样式且 `nav:''` | L:40、63–68、360、363 | 大数字进完整页；墙底“还有 N 个字 ›”；空卡去卡片样式 |
| Z02 | “先选一个字”只是变灰，无 `disabled/aria-disabled` | L:125（`lsGo`）、L:174（`lkGo`） | 真正禁用 |
| L11 | 排序与筛选同时生效；0 个的筛选可点；拼音分组不标拼音；不支持拼音查 | L:95–97、369、389–391 | 按清单改 |
| L14 | 深色下“墨色越浅，越久没写”说反 | L:68 | 深色改“颜色越暗，越久没写”，最淡档提亮 |
| D13 字体 | 楷体走 jsDelivr `lxgw-wenkai-gb-web`，宋体走 Google Fonts | H:13、L:13 | 打包 ShiziKai 子集 + Noto Serif SC 400/500，许可随包 |
| 离线/PWA | hanzi-writer 数据运行时从 jsDelivr 取，失败记 `null` | H:160、L:193 | 生产用仓库内数据（根目录有 `hanzi-writer.min.js`、`data/`）并处理缺失（10.13） |
| D12 与紧凑版 | 紧凑版墨迹行只放最近 4 个（A09） | H:232–233 | D12 只定义 N≤8/N>8；紧凑版取 4 是审美返修，需产品确认是否属“沿现有定义” |
| 主题 prop | H 用 `theme: base|th1`，L 用 `light|dark`，APP 分别传 `hTheme`/`sTheme` | H:212、L:331；APP @278120 | 统一 |
| 日期模型 | `'M-D'` 无年，`doy` 不跨年，`toneOf` 按年内序号差 | L:216–217、298；PM:83–85 | 生产用完整日期（ISO 或 epoch day） |
| 快忘了规则 | 90 天 / 最多 12 个是模拟；`F30` 手工指定 | PM:89、L:231–232 | 待记忆曲线（交接备注 §六）；原型阈值不是政策 |
| 死代码 | `LIBN` 四库字数表（3500/2976/818/2482）；APP `addStart()` 仍写“开始练以后才加进自选的字” | L:250；APP @350497 | 都不要移植；`addStart` 违背 K29（已无 `data-nav` 触发） |

### 4.3 现有产品代码（`/Users/orange/Documents/ChatGPT/astraworld/shizi-app/index.html`）与 v10 的矛盾（抽查）

| index.html 位置 | 现状 | 冲突的决定 |
|---|---|---|
| 676–684、789、814、1859、2736 | 首页“今日拾得”“收字”按钮、`yesterLbl` 今日拾得 | D02（首页唯一主入口、无重复入口）、文案清单 |
| 1884–1886 | “今日一字” 每日推荐字快捷入口 | D02“无常用字快捷入口” |
| 1872、1876、2736 | `numCn(...)` 汉字数字“今日已拾 N 个字”、“续/再”印章按钮 | 文案零节“界面一律阿拉伯数字”；主入口文案应为“开始写字/继续写字” |
| 792、818、2697 | 结果图例“金菱 看过提示 / 不确定 · 朱砂 写错” | D18（看答案直接记看过答案，不再判断）、D03 |
| 1973、1722 | `OUTCOME_STORY.hinted:"上次需要再练"`、`slow.effect:"会优先回来复习"` | D23（“需要再练”改“写错过”，且只看最近一次有效记录） |
| 1442 | 里程碑“继承跳档静默补记” | D24（补记去掉） |
| 797、1438 | “明天继续练一组 / 开启提醒”结果页钩子 | D01（不以每日必须完成推动） |
| 840–841、880、954、961–983 | “字库”页 `boxCount`、“在学的字库”、“收进字库”弹层、“继续练” | 与 L 的字库首页结构/叫法（练习范围、更换字库、查字、加入自选的字）全部不同 |
| 2033 | `memoryWall` 按记忆档着色的字墙 | 与 L 墨墙（四档时间 + 写错红点 + 空心自选）口径不同 |
| 2963、2982 | 字体 `"Songti SC","STSong"`，分享“今日字帖” | D13 字体；图片叫法“{月}字帖” |

结论：`index.html` 的首页与字库不是可改造基础，按 H/L **重写**。

---

## 5. 风险与坑

1. **`state` 与 `resume`/`resumeLine` 是三个独立 prop**（H:130、218、228–230）：`ctaLabel` 看 `resume`，布局看 `resumeLine`。若上层传 `resume=true` 但 `resumeLine=''`，会出现“继续写字”配墨迹行、没有组说明。生产应从会话单一来源派生，删掉 `resume`。
2. **S01 显示时首页 N 与墨迹行被隐藏**（H:229–230 `hasInkS=…&&!resumeLine`、`noResume=!resumeLine`）。“首页两行都列出来”（交接备注 §十.5）满足了，但 D12 的“今天记录了 N 个字”在有未完成组时不可见——需产品确认这是有意取舍。
3. **`auto` 时段不会自动切换**：`period()` 每次渲染读 `new Date()`（H:175），但没有定时器触发重渲染；且 600ms 淡入只在 `props.period` 变化时触发（H:174），`auto` 模式下永不触发。生产要用定时器/可见性事件并在真实切换时做过渡。
4. **首页预取写死的 `TODAY` 字**（H:168 `TODAY.map…concat(records…)`）：即使传了 `records`，仍会去 CDN 取 数/感/警/部/主/虽 六个字。移植时删掉。
5. **`hState='first'` 仅看 `recs.length===0`**（APP @379350）：清空记录、或用户第一次只做了跳过/看答案（都不进 `records`）都会回到“第一次来”，且 `start` 会因 `introSeen` 已 true 而新建 `ord` 会话而非 5 字首练——与 D17 的“第一次练习 5 个字”语义错位。需要把“首次”绑定到首练会话是否完成，而非记录数。
6. **焦点与键盘**：`focusLk` 80ms、`lkInRef` 30ms 均异步（L:264、421）；iOS Safari 只允许用户手势同步栈内 `focus()` 弹键盘。`kb` 键盘高度由 APP 用 `visualViewport` 估算再传入（L:422、451 `bottom=kb`）；WKWebView 未验证（04-v10-handoff §五）。
7. **事件委托 + `data-nav` 字串协议**（L:341）：键名靠字串前缀 `slice()` 解析（`detail:`、`sort:`、`fold:`、`sel:`、`lkPick:`、`lkSel:`），字符本身作为 key 的一部分——若字是代理对以外的罕见字没问题，但键名不可再含 `:`；且 `fold:` 用 `+k.slice(5)` 转数字、月份无年。
8. **`budget=72` 截断**（L:378–379）：非 live/tall 时完整页最多画 72 格，300 字下静态画布只显示前 72；live 模式 `1e9` 不截，300 字 × SVG 路径可能卡顿——原型注释也提到“画布上有二十多屏，逐屏重画会卡”（L:196）。生产需虚拟滚动或分页。
9. **hanzi-writer 数据缺失的字**：墙上空心格 `hollow()` 无数据返回空 svg（L:303）→ 自选了还没写的字若无笔画数据在墙上是**空白格**且仍可点；查字弹层有 `bad` 态（L:417、438–439）但墙/清单没有兜底。
10. **同字同日多次判断**：`latestOf`/`lists()` 以 `(doy, i)` 取最新（L:225、PM:87），`i` 是组内序号；跨两组同日同字时 `i` 会重复，取哪一条依赖遍历顺序。生产记录应有单调时间戳。
11. **快忘了口径未定**：`lists()` 的 90 天/12 个只是模拟（PM:86 注释），L:231 静态 `F30` 更是手工列表；D23 只定了“写一遍就离开、两张清单不重叠”，出入条件（记忆曲线）待工程/产品。不要把 90 天当政策。
12. **查字卡片“你的书写”对写错的字画的是那次写错的真实笔迹**（L:441 `this.ink(r,…)`，未走 `wrongStd`）。K28 原文“写错的字在墙上和卡片预览里显示标准楷体加红点”——若“卡片预览”包含查字卡片，这里与 K28 冲突；若指字库首页卡片的 mini 格（已 `wrongStd`），则一致。见 §6。
13. **`custom` 筛选计数含未写的字**（L:376 `D.added.length`），而其分组显示“自选了还没写 + 有记录”两块（L:382–383）——数字与两组之和一致，但与“有记录的字”页标题语义有张力（未写的字也出现在“有记录的字”页里）。10.3 K19 已定此方案，只提醒实现别“修正”掉。
14. **`filterOn`** 在 `custom` 筛选下不显示“练这些字 →”（L:401），`unw` 且 0 个也不显示；`filterGo` 对 `custom` 无处理（APP @365378）。
15. **静态清单的默认取消项** `off=['份']`（L:406）仅演示；live 下 `off=P.off||[]` 默认全选。S06 要求返回保留勾选——APP 目前 `view.off` 随 `push` 进入写字页后再回清单会重建视图（10.4 “回来重新全选”），与 S06 冲突，交接时已列入边开发边改。
16. **两套查字**：完整页的 `find`（只在有记录的字里定位，`onFindInput`，L:89–94）与底部查字弹层（`lk`，可练/可加入）是不同能力、不同入口，文案都叫“查字”（L:87、91 占位符 / L:150 标题）。实现时注意 aria-label 已区分（“在有记录的字里查字”，C146）。
17. **全局共享缓存**（`window.__szStore/__mqQ/__mqPaths/__mqStrokes`）跨组件实例、无上限、按 `c|d|v|floor` 键增长；生产应作用域化并限制。
18. **字体加载副作用**：H:13、L:13 直接往 `document.head` 注 `<link>`，多实例靠 `data-szf` 去重；PWA 离线不可用。
19. **深色令牌**：L:255 `--g: rgba(200,110,85,.34)` 格线、`--ar #D47A5D` 红点，交接备注 §六给了对比度实测；H 的深色 `btn #AE5A44 / down #A0523E` 与 L `--a #AE5A44` 一致，可共用。
20. **`libCount` prop 声明未用**（L:188）、`LIBN` 未用（L:250）、`lkChipsOn` 恒 false（L:431）、`inkOn` 恒 false（L:412）、`entry=bar`/`fill`（H:60–66、139）——都是残留分支，移植时剔除。

---

## 6. 未解问题

1. **K28 的“卡片预览”范围**：是否包含查字弹层卡片的“你的书写”格？原型在那里画真实写错笔迹（L:441）。需产品/设计确认。
2. **有未完成组时首页是否仍要显示“今天记录了 N 个字”+ 墨迹行**（现被 S01 两行替代，H:229–230）。
3. **题记轮换规则**：`267%3` 显然是“按日轮换”的写死值，但没有文档写明是按日、按次还是随机；D13 只说“三条题记”。
4. **紧凑版墨迹行只取 4 个**是否算 D12 的“沿现有定义”，还是需要在 360 宽下另定规则。
5. **`first` 状态的准确定义**：按记录数为 0（原型）还是按“首练会话未完成/`introSeen`”；K06 清空后的说法也依赖此定义。
6. **墙的截断口径**：`cols*8` 行（标准 5 列 = 40 格；≥60 字后 8 列 = 64 格）之外 L09 要求“还有 N 个字 ›”，N 的分母是“有记录的字 + 自选了还没写”（`nAll`）还是仅有记录的字。
7. **快忘了正式规则**（记忆曲线）与“写一遍就离开”后的再次进入时点——工程无法从原型推出。
8. **查字弹层在“不能练”字上的“查看记录”**（L:171 `lkHas` 时显示）：一个字既无笔画数据又有记录，在生产里是否可能（例如库更新后移除）；若可能需保留此分支。
9. **`today` 的时区/日界**：原型全部字串比较 `r.d===today`，生产按本地日切还是固定时区未见决定（涉及首页 N、墨色档位、清单日期）。
10. **`libCount`/换库列表“有记录 M 个”**属 ShiziScreen 范围（X05），但 L 的“练习范围”一行只写库名（C154–158）；库切换后墙上的字是否按库过滤（原型不过滤，`lists()` 不看库）未见决定。

---

## 附录 A · 界面文案原文（逐条，含位置）

**首页壳（H）**

- `9 月 24 日 · {{ periodCh }}`（H:38、91；periodCh ∈ 早上/中午/傍晚/晚上，H:143）
- 题记：`心不厌精，` / `手不忘熟。` — `孙过庭《书谱》`；`文章千古事，` / `得失寸心知。` — `杜甫《偶题》`；`我书意造本无法，` / `点画信手烦推求。` — `苏轼《石苍舒醉墨堂》`（H:141）；闲章 `字`（H:44）
- 大标题：`今天写几个字`（H:52、103）
- 主按钮：`拾` + `开始写字` / `继续写字` + `→`（H:56–57、228）
- S01：`{{ resumeLine }}`、`{{ otherLine }} ›`（H:70–71）；APP 拼法 `{这次选的字|第一次练习|今天的练习} · 还有 {N} 个字没写`（@379350、@350028）
- 墨迹行 aria-label：`今天有记录的字，打开练习记录`（H:74、115）
- 计数行：`今天记录了 {N} 个字`（record）/ `` （empty）/ `第一次来，先写 5 个字试试。`（first）（H:236）
- 辅助入口：`自己选字 →`（H:81、120）
- tab：`习字` `字库` `我的`（H:84–86）
- 素材位占位：`素材位 · 叶影（弱）`（H:22）；状态栏 `9:41`（H:28）

**S02 确认框（APP @351810）**：`上一组还有「鲜」「境」没写。`（字随实际）；按钮 `接着写那组` / `结束那组，开新的` / （取消）

**字库首页（L）**

- 标题 `字库`（L:28）；查字框 `查字`（L:30）；`查到的字可以直接练，也可以加入自选的字。`（L:31）
- `练习范围` `{{ libLine }}` `更换字库 ›`（L:34–35）；无记录：`每天写的新字，从这个字库里挑。`（L:37）
- `有记录的字` `{{ nBig }}` `个字`（L:39–40）；事实：`另有 {N} 个自选的字还没写` / `从 {M} 月 {D} 日开始记录`（L:357；无记录时备用 `写过并判断过对错的字。`）
- 卡片：`写错过` `你判断写错的字。` / 空 `你判断写错的字会放在这里。`；`快忘了` `有一阵没写、可能快忘了的字。` / 空 `可能快忘了的字会放在这里。`；动作 `练这个字` / `练这些字` + `→`（L:360–361）
- 图例：`一周内写过` `一个月内` `三个月内` `三个月以上`（L:223）、`写错过`、`自选了还没写`（L:64–65）
- 墙下：`墨色越浅，越久没写。点一个字，看它每次的笔迹。` `全部 ›`（L:68）
- 空态：`你写下的字会留在这里` `去「习字」写几个字，判断过对错，就会出现在这里。`（L:74–75）

**有记录的字完整页**

- 导航标题 `有记录的字` / `写错过` / `快忘了`（L:345）
- 查字框占位 `查字`，aria-label `在有记录的字里查字`，命中 `在 {M} 月`，未命中 `「{X}」还没有记录。`（L:87–92、373、394）
- 排序 `最近写的` `拼音` `多久没写`（L:374）；筛选 `写错过 {N}` `快忘了 {N}` `自选了还没写 {N}` `自选的字 {N}`（L:376–377）
- 说明：`你自己挑来常练的字。还没写的排在前面。`（custom）；`有一阵没写、可能快忘了的字。`（forget）；`你判断写错的字。`（wrong）；`加入了自选的字，还没有记录。`（unw）；`离上次写越久，排得越前。`（age）；`按拼音首字母排。多音字按第一个读音。`（py）；`按最近一次写的月份排。每格是你最近一次的笔迹。`（recent）（L:384–398）
- 分组名：`自选了还没写` `有记录` `{M} 月` 拼音首字母 / `其他`；计数 `{N} 个字`（L:380–397）；底部 `练这些字 →`（L:112）

**写错过 / 快忘了清单**

- 标题 `{N} 个字`；说明 `你判断写错的字。下次写对了，就会从这里移走。` / `有一阵没写、可能快忘了的字。写一遍，就会从这里移走。`（L:410）
- 行小字：写错过 `{M} 月 {D} 日写错` `一共写错 {N} 次`；快忘了 `最近一次 {M} 月 {D} 日` `记录了 {N} 次`（L:412）；小图标 `写错那次`（仅写错过）
- 勾选 aria-label：`选择「{X}」` / `取消选择「{X}」`（L:412）
- 列表下：`右边小图是你写错的那一次。点圆圈选字，点这一行看记录。` / `右边小图是你最近一次写的。点圆圈选字，点这一行看记录。`（L:413）
- 底部：`选了 {N} 个字 · 写完会回到这里。`（0 个时只 `写完会回到这里。`，Y05）；按钮 `练这些字`（≥2）/ `练这个字`（1）/ `先选一个字`（0）（L:414）
- 空态：`错` / `忘`；`现在没有写错过的字` / `现在没有快忘了的字`；`你判断写错的字会放在这里。` / `可能快忘了的字会放在这里。`（L:408）

**查字 / 自己选字弹层**

- 标题 `查字` / `自己选字`（pick）（L:423）；输入占位 `输入一个字或一个词`（L:151）
- 提示：`输入一个字或一个词，再点你要的那个字。`（hint）/ `点一个字，看参考字形、练这个字或加入自选的字。`（rows）（L:432）
- 说明块：`只能输入汉字。` / `只能输入汉字，已去掉 {N} 个字母或符号。` / `重复的「X」「Y」只算一次。`（L:427–428）
- 行尾：`暂时不能练` / `原型里只能看` / `自选的字 · ` + `记录了 {N} 次` / `还没有记录`（L:435）
- 返回：`‹ 回到这 {N} 个字`（L:158、437）
- 卡片：`你的书写` `参考字形`（L:164–165）；`{py} · {N} 画`；`记录了 {N} 次 · 最近一次 {M} 月 {D} 日` / `还没有记录`（L:442–443）
- 按钮：`练这个字` `加入自选的字` `已在自选的字里` `查看记录`（L:169）
- 加入失败：`没加进自选的字，输入的字还在。` `先不加` `再试一次`（L:170）
- 不能练（原型限制）：`原型里没有收这个字的拼音和词语，只能看参考字形；真机上，字库里的字都能练、能加入自选的字。`（L:171）
- 无字形：`「{X}」暂时不能练。` `拾字还没有这个字的参考字形。` `能练的字参考教育部《通用规范汉字表》，个别字暂时还不能练。`（L:173、438–439）
- 多字底栏：`练这 {N} 个字` / `练这个字` / `先选一个字`（L:446）
- 成功轻提示（APP @363660）：`「{X}」已加入自选的字。`；原型限制提示 `原型只能练演示里的字；真机上这里会进习字。`（@364192）
- 假键盘（仅静态画布）：`系统键盘 · 由系统提供，不仿制`（L:180）

**有记录无笔迹**：`没有笔迹` / `这一次没有留下笔迹`（L:288）

## 附录 B · 数字来源对照（交接备注 §四 + 本次核对）

| 数字 | 来源 | 位置 |
|---|---|---|
| 首页“今天记录了 N 个字”、墨迹行 | **算**（`records` 传入时）；否则退回写死 `TODAY` | H:154、178、218、236 |
| 首页 S01 两行“还有 N 个字没写” | **算**（会话 `queue.length - items.length`） | APP @350028 |
| 首页日期 | **写死** `9 月 24 日` | H:38、91 |
| 题记选句 | **写死** `267` | H:215 |
| 字库首页大数字、事实两条、卡片数字、墙 | **算**（`SZProto.lists`） | L:324–325、354–363 |
| 完整页分组/排序/筛选计数 | **算** | L:367–401 |
| 清单“一共写错 N 次”“记录了 N 次”、日期 | **算**（`cntOf` 于 `D.recs`） | L:239、412 |
| 查字行尾/卡片“记录了 N 次 · 最近一次” | **算** | L:433–443 |
| 墙列数 `cols`、最多 8 行、`budget 72` | **写死**布局参数 | L:339、363、378 |
| 墨色四档 7/30/90 天 | **写死** | L:298 |
| 快忘了 90 天 / 12 个；`F30` | **写死/模拟** | PM:89、L:232 |
| 字库字数表 3500/2976/818/2482 | **写死且未使用** | L:250 |
| 300 字生成参数 | 演示 | PM:92–98 |
| `today='9-24'`、状态栏 `9:41` | 写死 | H:218、28；L:188、21 |
