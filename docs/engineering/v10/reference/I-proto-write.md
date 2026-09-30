# I · 第十稿原型 · ShiziWriteScreen：写字页、提示、看答案、判断页、结果行、紧凑版

> 范围：`docs/design/v10/extracted/ShiziWriteScreen-第十稿交接版.dc.html`（即设计交付的 `ShiziWriteScreen-第十稿交接版.dc.html` 快照，645 行 / 77,373 字节，已通读）。下文行号 L 均指这个文件。对照文件：`docs/handoff/decisions.md`（D01–D25）、`docs/product/04-v10-handoff.md`、`docs/design/v10/交接备注-第十稿交接版.md`、`第十稿-改动清单-第十稿交接版.md`、`第十稿-文案修改清单-第十稿交接版.md`、`第十稿-边开发边改清单-第十稿交接版.md`。原型壳（拾字-可点原型）里给这个组件传参和回调的实现在 `docs/design/v10/extracted/拾字-可点原型-第十稿交接版.template.html`（字节偏移 ~74081–76603、~99962–100476），笔迹管线在 `docs/design/v10/extracted/ink-第十稿交接版.js`（`ink-第十稿交接版.js`），出题数据在 `docs/design/v10/extracted/proto-model-第十稿交接版.js`（`proto-model-第十稿交接版.js`）。

## 1. 概览

ShiziWriteScreen 是一个 dc 组件：`<x-dc>` 里是带 `{{ }}` 绑定、`sc-if` / `sc-for` 控制流、`style-active`（:active 伪类样式）的 HTML 模板（L9–L254），`<script type="text/x-dc" data-dc-script>` 里是 `class Component extends DCLogic`，用 React 的 `state / setState / forceUpdate / createRef` 写逻辑，`renderVals()`（L521–L640）返回模板要用的扁平对象。它把写字流程的所有阶段画在**同一个组件、同一个 state 机**里：`phase ∈ {recall, compare, answer, trace, retrace, saveFail, done}`，加上 `saw`（看过答案）、`hints/used/hr/dim/hout`（提示）、`line/last/sheet`（上一个字的结果行和修改判断弹层）、`ask`（看答案确认）、`strokes/cur`（笔迹）等字段（L313 `preset` 是全字段基线）。

书写格、参考字形、提示、对照缩略图**全部用 SVG 画**（`viewBox 0 0 345 345`），不是 canvas：本人笔迹是把笔迹管线 `window.SZInk.build` 产出的 `{x,y,w}` 点列用 `SZInk.outline` 变成一条 fill 路径（L465–L470、L389–L393）；参考字形和提示中线来自 jsDelivr 上的 `hanzi-writer-data@2.0/<字>.json`（L279–L283），用一个固定的 `glyphT` 变换从 1024 坐标落到 345 格（L285）。指针输入走 `onPointerDown/Move/Up/Cancel` + `setPointerCapture` + `getCoalescedEvents`（L411–L416、L514）。

组件有两套模板：标准尺寸 393×852（`isStd`，L18–L157，全部绝对定位）和更大字体的紧凑版 360×640（`isCompact`，L158–L224，flex + 可滚动，`--k:1.3` 放大字号，可点控件全是 span/div）。看答案确认框和修改判断弹层两套共用（L225–L252）。主题色靠 `TH.light / TH.dark` 两张令牌表写进 CSS 变量（L274–L277、L561）。

第十稿走查后的规则（W01–W15、K24 方案①、K25、V01–V03、X01/X02/X08/X10/X11、10.10、10.13）基本都已落在代码里；但组件还保留了几块**与 v10 决定冲突或已作废**的代码：`done` 阶段的“这一组写完了 / 查看这次练习”中间页（D20 已去掉）、K24 方案②“提示画在题面红框里”（D25 不做）、以及一批原型专用的预设、演示笔迹、调试叠层、回放。此外 `CHARS.groups`（部件分组）在 v10 代码里**完全没有被读取**，提示量纯按“总笔画的四分之一”算。

## 2. 组件/模块清单

| 名称 | 位置 (file:lines) | 职责 | 对外接口（函数名/事件/存储键） | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| helmet：字体与关键帧 | L10–L15 | 动态插入 LXGW WenKai GB（jsDelivr）和 Noto Serif SC（Google Fonts）的 `<link>`（去重用 `data-szf`）；定义 `@keyframes szDraw{from{stroke-dashoffset:1.02}to{stroke-dashoffset:0}}` | 全局 CSS | CDN 网络 | 可抽取改造 | D13 要求楷体子集改名 ShiziKai 随包发布，不能再从 CDN 拉；Noto Serif SC 在本组件只用于“这一组写完了”标题（L141、L186），D20 去掉后写字页不再需要宋体 |
| 外框 `frame` | L17、L575 | 手机框：宽高 393×852 / 360×640、`--k`、圆角 42/28、纸纹（浅色两层 radial-gradient）或暖灯（深色 `lampImg`，L565）、系统无衬线字体、`userSelect:none`、`bare` 时无圆角无投影 | props `bare`、`lamp`、`theme`、`size` | TH 令牌 | 可抽取改造 | 纸纹/暖灯是视觉令牌，正式版应是页面级背景而不是组件内绝对定位框 |
| 状态栏 / Home 指示条（chrome） | L20–L24、L159、L253 | 假的 “9:41”、信号、电池、底部条 | `chrome:!P.bare` | — | 应重写（删除） | 原型示意，真机用系统状态栏 |
| 顶栏：标题 / 返回 / 计数 / 步骤点 | 标准 L26–L32；紧凑 L162–L167；数据 L586–L597、L603–L607 | 居中标题 `title`（17px/500）、左侧返回按钮（44×44 图标 + 可选 `backText`）、右侧 `counter`“3 / 5”（13px tabular）、描一遍/自己写两步的两个 5px 圆点（`dots1/dots2`，带 aria） | `onBack`、`backLabel`、`backText`、`counter`、`titles` 表 | `viewPhase()`、`total` prop | 可抽取改造 | `titleL`（L586）算了但模板没用；紧凑版返回是 `<span onClick>`（交接备注要求正式版用按钮） |
| 第一次的提示行 `tipOn` | 标准 L34–L36；紧凑 L169；逻辑 L530、L569 | 只在 `firstTip` prop（或预设 T 的 `ft`）且 `recall` 且没落笔且没有结果行时显示：红点 + “看拼音和提示，把这个字写在格子里。” | prop `first-tip`；state `tipGone`（首笔落下即 true，L395） | — | 可直接复用（逻辑）/ 可抽取改造（样式） | 替代被去掉的首题说明卡（W01、X11）；壳里 `wFirstTip = kind==='first' && i===0 && !tipSeen` |
| 上一个字的结果行 `hasLine` | 标准 L37–L42；紧凑 L170；逻辑 L554–L555、L609–L612 | “「部」记为写对 · 修改 ›”（record）、“「部」已改为写对 · 修改 ›”（changed）、“「部」记为看过答案”（saw，无修改按钮）；只在 `recall && !has && !tipOn` 显示；落笔（`touch()` L395）、跳过（L459 `ln=null`）、确认看答案（L408 `line:null`）都会收起 | state `line ∈ {record, changed, saw, null}`、`last`；`onLineAction → sheet:true` | `lines` 表 | 可直接复用 | 与 D19/V03/X01/X02 一致。注意 `tipOn` 优先级高于结果行（`hasLine` 要求 `!tipOn`），但两者不会同时为真（`tipOn` 要求 `!s.line`） |
| 题面：拼音 + 词语挖空 | 标准 L45–L60、L558–L559、L594、L599–L602；紧凑 L175–L181 | 拼音 15px 居中；词语行每格 56×54、LXGW 34px、`var(--g)` 细边；挖空格 `inset 0 0 0 1.5px var(--ar)` 红框，未揭示时画虚线十字，揭示（compare/answer/trace）后显示字并带 `data-szblank`（对照页淡入用）；`rowLeft = 168.5 − blank*56` 保证挖空格永远居中；“投影线”SVG 从挖空格两侧斜到书写格两角（`projection`，answer/done 不画） | `cells[]`（ch/plain/blank/filled/empty/boxH/bh/shown/sh）、`py`、`projection` | `ch.word/blank/py` | 可抽取改造 | 重复目标字的 □ 遮挡（D16）**不在本组件**：`cells` 只挖 `blank` 一格，其他位置原样显示 `cell.ch`（L48、L599）；壳的出题数据 `Z.item` 也没有 □ 字段。见 §6 |
| 题面：无词语（拼音 + 释义） | 标准 L61–L67；紧凑 L182；数据 L598 | `pyBig` 22px + `gloss` LXGW 19px；方案② 时下方一个红框小格 `nwBox` | `noWord`、`gloss`、`pyBig`、`nwBox/boxHint` | `ch.gloss` | 可抽取改造 | `nwBox` 属于方案②，随 D25 删 |
| 书写格容器（card / marks / bleed 三种） | 标准 L70–L78、L622–L624；紧凑 L192（`gC`） | 标准：345×345，`left:24 top:158`（帧内 y=296），`.5px` 边、16 圆角、`var(--c)` 底；`layout==='bleed'` 时通栏 393 宽只有上下边；`layout==='marks'` 只画角标；紧凑：`gC×gC`、14 圆角 | prop `layout`（数据面板只列 card/bleed，代码还认 marks） | `gridSvg()` | 可直接复用（card）/ 应重写（删 marks、bleed） | 交互设计定稿是 card；bleed/marks 是探索项 |
| 书写格 SVG `gridSvg(vp)` | L498–L516 | 依阶段叠层：十字虚线 `guides()`（L471–L482，`stroke-dasharray 4 5`、`var(--g)`）→ 描红层（trace）→ 提示层（recall + fade）→ 本人墨迹层（`dim` 时 opacity .35）→ 当前一笔 `cur`；svg 本身挂指针事件、`touchAction:none`、可写时 `cursor:crosshair` | `drawable()`（L386：interactive 且 phase ∈ recall/trace/retrace 且弹层没开） | `SZInk`、`ST.data` | 可抽取改造 | 尺寸规则：标准恒 345；紧凑 recall/trace/retrace 恒 `GMIN=258`（X08），answer 阶段才由 `fitC()` 在 200–345 间按屏高算（L382–L384）。交接备注六“每格至少 44px、字形约占 75%”是对结果页小格而言，本组件的 44px 只用在 `ZC`（写完一组的小格，L273） |
| 笔迹输入 `down/move/up/cancel` + `pDown/pMove/pUp` | L389–L393、L410–L416 | 把指针坐标按 `getBoundingClientRect` 缩到 345 空间（L410），`t` 用 `ev.timeStamp`；`SZInk.build(raw,false,tune.base,tune)` 实时出当前一笔；抬笔 `build(raw,true)` 收尖、补最后一个点、缓存 `outline` 到 `d`，`end:'up'|'cancel'`（pointercancel 不收尖，2.4）；`dbg` 记 `v30/endK/dot/single` | state `strokes:[{pts:[{x,y,w}],d,end}]`；`this.raw`、`this.cur` 不进 state（用 forceUpdate） | `SZInk.build/outline`、`tune` prop | 可抽取改造 | 落笔前先 `materialize()`（把演示笔迹变成真笔迹）和 `touch()`（收结果行/首提示/提示淡出）。落笔 0.3s 防连点见下一行 |
| 防连点：`arm/armed`、`penArm` | L347–L352、L522–L523、L525、L411 | 新页面/新状态出现后 0.4s 按钮不响应：`arm()` 在 mount、phase/ci/ask 变化时把 `_arm=now+400`；所有按钮回调都包在 `on(f)` 里查 `armed()`；换字后 0.3s 书写格不接落笔：`penArm()` 在 mount、ci 变化、以及 **renderVals 里检测到 ci 变化的那一帧**（V01）把 `_pen=max(_pen, now+300)` 并在下一帧再刷一次；`down` 同时比较 `e.timeStamp` 和 `performance.now()` | — | — | 可直接复用（规则）/ 可抽取改造（实现） | W08、V01。注意按钮那条用的是 `performance.now()` 不是事件时间戳（交接备注十.3 说“判断时间用事件自己的时间戳”，代码只在落笔那条做到） |
| 提示：量的计算 `rangeFor / hrOf / hint` | L399–L405 | 最多 2 次（`hints>=2` 直接返回）；`q=max(1, round(N/4))`，`from=clamp(已写笔数 n, 0, N−q)`，`to=from+q`；`fb`（没有部件分组）的字退回“前 1 笔 / 前 2 笔”累积；`hint()` 先 `materialize()`，写入 `hints+1, used, hr, dim(仅 fade 模式), hout:false` | state `hints`、`used`、`hr:{from,to}`；按钮文案由 `left=2−hints` 拼 | `sd(c)` 要有 `strokes.length` | 可直接复用（规则） | W04“接着已写的笔画往下给”在原型里就是 `n=当前笔数`（正式版怎么判断“已经写对了哪几笔”待工程评估，交接备注一）。**`CHARS[].groups` 从未被读取**（全文件只在 L252–L259 出现），所谓部件分组提示在 v10 代码里不存在 |
| 提示：画法（K24 方案①，fade） | L505–L510、L395–L397、L13 | 取 `medians[from..to)` 每笔一条 `path`（`medD`，L284），`stroke var(--ar)`、`strokeWidth 18`（1024 单位，≈5.3pt@345 / ≈4pt@258）、圆头、`pathLength=1` + `strokeDasharray '1 2'` + `szDraw` 动画逐笔画出：单笔时长 `dur=round(min(max(1100/n,110),240,1200/(.3+.7n)))` ms，第 j 笔延迟 `j*dur*.7`，曲线 `cubic-bezier(.4,0,.2,1)`；提示组 opacity .92；同时本人墨迹组 opacity .35（`dim`）。下一笔落下：`touch()` 置 `dim:false, hout:true`（提示组 .25s 淡出、墨迹 .2s 恢复），260ms 后 `hout:false, hr:{from:0,to:0}`（提示清空）。`interactive=false` 或 `prefers-reduced-motion` 时不动画（静态画出） | `hmode()`（L400）、`reduce` | `medians` | 可直接复用 | 即 D25。`hr` 存 {from,to} 而不是“笔序集合”，第二次提示会覆盖第一次（前一次提示画的笔已淡掉）。深色下 `ar=#D47A5D`；边开发边改 W23 要求深色提示提亮一档 |
| 提示：方案②（box）`boxHintEl / boxOn / nwBox` | L519–L520、L55、L64、L529、L563、L570、L599 | 把已给的笔画画进题面红框小格：已写过的用 `--i4`，这次给的用 `--o` | prop `hint-mode='box'`、preset `hm:'box'` | — | 与 v10 决定冲突（删） | D25：方案②不做，面板开关只是备选演示 |
| 看答案：链接 + 确认框 + `seeAnswer` | 链接 L115–L117 / L214、L576；确认 L225–L232、L577；逻辑 L407–L409 | recall 且未 saw 时左下角下划线文字“看答案”→ `ask:true` 弹居中确认“看了答案，这个字就记为看过答案。”[接着想 / 看答案]；确认后 `phase:'answer', saw:true, hr:null, dim:false, line:null`，首次触发 `onSaw({i,c,hints:max(used,hints)})` | props `on-saw`；state `ask`、`saw` | — | 可直接复用 | W03 + K25/D18。点遮罩 = 接着想。壳的 `wSaw` 立即记一条 `v:'A'` 事件并把 `s.line='saw'` |
| 看答案页（answer） | 标准 L84–L86、L136–L138；紧凑 L193、L208；按钮 L546、说明 L580–L582、L617–L618 | 与书写格同几何的卡片里画完整参考字形 `refGlyph(ci,'var(--ref)')`（有 hanzi-writer 数据时按笔画路径，否则退回 LXGW `<text>`，L485–L489）；按钮 [自己写 outline / 描一遍 solid]；按钮上方说明 `ANS='这个字记为看过答案，后面再写只算练习。'`；投影线不画；底部“下一个”下划线（`skipLabel`） | — | `refGlyphC` | 可直接复用 | 10.13 无笔画数据时同一句说明（NDA===ANS，L528） |
| 描一遍（trace） | L500–L501（描红层）、L547、L553、L564 | 参考字形描红：外描 `stroke var(--tl) 4px non-scaling` + 填 `var(--tf)`；无数据时用浅色 `var(--tf)` 的整字 `<text>`（不分笔顺，10.13）；标题“描一遍”、两步圆点第 1 步、说明“浅色是参考字形。”；按钮 [描好了，自己写]（没写时灰） | — | — | 可直接复用 | 边开发边改 W19 想加“开始时先播一遍笔顺，可跳过”，原型没有 |
| 自己写一遍（retrace） | L548、L553、L564 | 标题“自己写一遍”、第 2 步圆点；按钮 [再描一遍 outline / 写好了 或（saw 时）下一个 solid]；saw 时说明 `sawTxt='这个字看过答案了，再写只算练习。'`，底部不显示跳过 | — | — | 可直接复用 | X01：saw 后 retrace 的“下一个”走 `next(null,true)` → `onNext`，不出判断页 |
| 写好了 → 对照 `toCompare / flip` | L422–L447、L87–L100（模板）、L613–L616、L620 | 标准+动效：`fk` 控制笔宽因子从格内宽度连续过渡到卡内 0.68×（260ms，`EASE`）；用户卡从 `scale(345/166.5)` 缩到 1（260ms），右列延迟 120ms 淡入上移 8px，题面挖空字延迟 120ms 淡入；`reduce` 时克隆书写格做 120ms 交叉淡化；紧凑版克隆 `midRef` 交叉淡化 120ms；`userMini` 只在 compare 时计算（1.7），宽度因子 `fk ?? 1.41` | refs `gridRef/pageRef/cmpRef/userCardRef/rightRef/midRef` | Web Animations API | 可抽取改造 | 对照卡左“你的书写”右“参考字形”（L08）；没写时左卡“这次没写”虚线框——但 `写好了` 在没写时是灰的，所以进 compare 一定 `has`，除非 init/预设直接进 compare |
| 判断页（compare） | L128–L134（标准）、L199–L202（紧凑）、L613–L616、L603–L604、L607 | 标题“对照一下，写对了吗？”；左上返回变成“接着写”（aria“回到格子里接着写”）→ `phase:'recall'`（笔迹保留，不算记录，K31/W09）；说明“你来判断，点一下就记下。”；两枚 72px 圆角 20 的等重按钮 **写错了（左）/ 写对了（右）** → `next('wrong'|'right')`；没有主按钮行、没有跳过 | `onRight/onWrong` | `next()` | 可直接复用 | D20/D03 |
| 推进 `next(rec, sawNext)` | L453–L463 | 判断：`onJudge({i,c,verdict,strokes:pts[],hints,saw})`，返回 false/`{ok:false}` → `phase:'saveFail', prev:'compare', pend:{t:'judge',v}`（不推进）；看过答案后下一个：`onNext({i,c,strokes})`；跳过：`onSkip({i,c,saw:false,hints})`；写入 `done[]`、`last`、`line`、`cnt`（只有判断 +1）；最后一个字 → `phase:'done'`；否则 `ci+1, n+1, phase:'recall', strokes:[]` 并 `turn()`（页面从右 14px 滑入 240ms） | props `on-judge`、`on-next`、`on-skip` | `fail()` L305 | 可抽取改造 | 跳过/看过答案/下一个**不等保存**（`onSkip/onNext` 返回值被忽略，壳里 `commit(...,false)` 永不失败）。D07“保存成功才推进”只对判断生效，见 §5 |
| 撤销 / 清空 | 标准 L102–L112；紧凑 L172；逻辑 L625–L626 | `has` 且 recall/trace/retrace 时显示；撤销 = `strokes.slice(0,-1)`，清空 = `[]`（都先 `materialize()`） | `onUndo/onClear` | — | 可直接复用 | 边开发边改 W17：清空后给一次撤销（原型没有）。D07 允许本人明确撤销/清空 |
| 书写格下说明 `gridNote / noteC`、按钮上说明 `btnNote / noteB` | L564、L567–L582、L617–L618；模板 L102–L112、L136–L138、L205–L208 | 一条优先级链（见 §3）决定 recall/trace 下方那句：10.13 无提示句 → 保存失败句 → “保存好了。” → 提示说明 → 看过答案说明 → “浅色是参考字形。”；answer/done 的说明放按钮上方；`hintNote` 时前面加一个 `--o` 的小圆点 | — | — | 可直接复用（文案）/ 可抽取改造 | V04：标准尺寸说明从下往上长；边开发边改“更大字体下说明离上下只有 2px”未改 |
| 主按钮行 `buttons / btnRow / colsC` | L118–L126（标准）、L209–L212（紧凑）、L536–L551、L562 | 每阶段 0–2 个按钮，四种样式：solid（`--a` 底白字）、outline（`.5px --i5` 边 `--c` 底）、off（`disabled`，`--off` 底 `--i4` 字）、txt（13px 灰字占位）；recall 列宽 `148px 1fr`（紧凑 `auto minmax(0,1fr)`），提示按钮 15px 不折行；标准 52px 高 16 圆角，紧凑 min-height 56 | `B(label,kind,fn,sm)` | `on()` | 可抽取改造 | 紧凑版 off 按钮是 span、没有 `aria-disabled` |
| 跳过 / 结束这组 那一行 | 标准 L147–L156；紧凑 L213–L217；逻辑 L627–L633 | “跳过”下划线文字（saw 后变“下一个”）居中；“结束这组”只在 `endable && interactive && vp!=='done' && !saveFail && !sheet` 时在右侧 → `onEnd(snap(),false)`（确认框由壳画）；跳过在 compare/done/saveFail 以及 saw 后的 recall/retrace 不显示 | props `endable`、`on-end`、`end-fail` | `snap()` | 可直接复用 | 10.10/D22。壳里确认文案“还有 N 个字没写，结束后就不写了。判断过的 M 个字已经记下。”[结束这组 / 接着写]、零判断轻提示“这组结束了，没有记下字。” 都不在本组件；边开发边改 S04：主按钮应是“接着写” |
| 保存失败 `saveFail / retry / doBack` | L307–L308、L353–L356、L538–L539、L526–L527、L607 | `phase:'saveFail'` 时 `viewPhase()` 返回 `prev`，页面照旧但按钮换成 [先不保存 outline / 再试一次 solid]，说明 `FAIL='没保存上，你写的字还在。'`（写字阶段放格下，compare/answer/done 放按钮上）；`pend ∈ {back, judge, end}` 决定重试什么；`endFail` prop 计数上升时进入 end 失败态（10.10）；重试成功后 `save:'saved'` → 说明“保存好了。”（仅无 pend 的演示路径） | props `on-back` 返回 false 表示失败；`end-fail` | — | 可直接复用（规则） | 2.5/2.6/D07。`onBack` 缺省（独立打开组件）时返回就模拟一次失败（L607） |
| 修改判断弹层 `sheet / flipVerdict` | L233–L252、L309–L310、L634–L640 | 456px 底部弹层：标题“修改「X」的判断”、取消；两张 mini（上一字笔迹 ×1.41 宽 / 参考字形）；说明“刚才记的是写对。改了只换掉这一次，不会多算一次。”；主按钮“改为写错/写对”→ `onCorrect(last.id, nv)`，失败 → `sheetFail`：“没改成，还是原来的判断。”[先不改 / 再试一次]；成功 → `line:'changed'` | props `on-correct`；state `sheet/sheetFail/last.id` | `lastStrokes()` | 可直接复用 | D06 语义（同一记录、不加次数）保留；D19 把“落笔后”的入口挪到结果页，本弹层只在结果行还在时可达 |
| 写完一组 `done` 阶段 | L140–L145、L184–L189、L449–L450、L540、L553、L556、L566、L619–L621 | 标题“这一组写完了”（Noto Serif SC 26px）、44px 小格网（6/7 列）逐格 180ms 淡入、说明“这次记录了 N 个字，跳过和看过答案的字不算在内。”、按钮“查看这次练习”→ `onNavigate('result')` | props `on-navigate` | `zCell()` L492–L496 | 与 v10 决定冲突（删） | D20/W13：最后一个字判断完直接进结果页。壳的 `adv()` 已经绕开（`s.done=true` 且 view 直接切到 result，组件随之卸载），但组件代码仍在 |
| 持久化快照 `snap / chg / onStateChange / fromInit` | L297–L304、L353、L359 | 每次 `state` 关键字段变化（`chg`）就 `onStateChange(snap())`；`snap` = `{i,c,phase,hints,used,saw,strokes:pts[][],sim,line,hr}`；`init` prop 的 `key` 变化时整体 `fromInit` 重建（L357）；W10：自己保存 `_ps` 对比，因为 dc 运行时的 `componentDidUpdate` 不传 prevState | props `init`、`on-state-change`、`on-back` | — | 可直接复用（契约） | 恢复到判断页也靠这条（phase 'compare' 会被存） |
| 演示笔迹 `synthC / simStrokes / userStrokes / materialize / replay` | L362–L380、L418–L419 | 用 hanzi-writer 中线 + `SZInk.synth` 合成笔迹（或 `SZInk.pick` 的真人录制），`sim ∈ {full, part(前 3 笔), trace(9 笔), wrong(WRONG 表删笔/倾斜)}`；任何真实输入前 `materialize()` 把它变成真 `strokes`；`replay/replaySrc` 用 `SZInk.play` 按时间回放 | props `replay`、`replay-src` | `SZInk`、`WRONG`、`REAL_FIX`、`A40` | 应重写（删除） | 全部原型工具（交接备注“场景面板、调试叠层、录制模式都是原型工具”） |
| 静态预设 `preset(k)` | L313–L336、L256 `start` 枚举 | A/B/C/C2/T/H1/H2/Q/G2/R2/L/K/N/D/W/E/F/S/G/H/I/J/P/Z/Z15/Z30 各对应一屏状态（给画布用） | prop `start` | — | 应重写（删除） | 原型专用；`n` 与 `ci` 分开就是为了 P/Z15/Z30 这类假计数 |
| 调试叠层 `dbgOn/dbg1/dbg2` | L80–L82、L598–L600 | 抬笔前 30ms 均速、末端笔宽倍数 | prop `debug`、`tune` | `SZInk.build` 的 `v30/endK/dot/single` | 应重写（删除） | 交接备注列为原型专用文案 |
| 令牌表 `TH` 与 CSS 变量 | L274–L277、L561 | `--a/--ar/--g/--ref/--tf/--tl/--p/--c/--off/--i1..--i5/--o/--scrim/--hi` | prop `theme` | — | 可直接复用（数值） | 模板里的 `var(--x,#hex)` 回退值是旧稿颜色（如 `--i1` 回退 #2B2824，令牌 #3B2F28），运行时总会设变量，回退永不生效。`ho` 令牌无人使用 |
| 字形数据加载 `load / ST / sd` | L279–L283、L484 | `window.__szStore` 跨组件共享缓存 `{data:{字:json|null}, pend:{字:Promise}}`；`sd(c)`：`noStroke` 模拟当前字为 null；`null`=取不到，`undefined`=还在加载 | prop `no-stroke` | jsDelivr | 可抽取改造 | 失败即永久缓存 null，不重试；正式版应随包带字形数据或有重试 |

## 3. 数据契约

### 3.1 组件 props（`data-props` L256 + 代码里实际读取的）

| prop（模板属性 → camelCase） | 类型 / 默认 | 用途 | 出处 |
|---|---|---|---|
| `interactive` | boolean, true | false 时所有按钮无回调、不可落笔、不动画（画布静态图用） | L525、L386 |
| `queue` | `Array<{c, py, word:string[], blank:number, gloss?, groups?, fb?}>` | 这次要写的字；不传用内置 `CHARS`（L257–L266） | L295 |
| `init` | `{key, i, phase, hints, used, saw, strokes:pts[][], sim, hr, last, line, sheet, sheetFail, saveFail, cnt, done[]}` | 恢复到离开时的状态；`key` 变化触发重建 | L297–L302、L357 |
| `total` | number \| null | 右上角 “n / total”；不传时 = 队列长度 | L530、L595 |
| `first-tip` | boolean | 第一次的提示行 | L530 |
| `hint-mode` | `'fade' \| 'box'`，fade | K24 方案① / ②（②作废） | L400 |
| `no-stroke` | boolean | 模拟当前字笔画数据取不到（10.13） | L484 |
| `endable` / `on-end(snap, confirmed)` / `end-fail:number` | | “结束这组”入口、回调、失败计数 | L629–L630、L356 |
| `on-back(snap) → false \| {ok:false} 表示失败` | | 返回 = 保存并返回 | L307 |
| `on-judge({i,c,verdict:'right'\|'wrong',strokes,hints,saw}) → {ok:true,id} \| false` | | 判断；id 用于后续修改 | L456 |
| `on-skip({i,c,saw:false,hints})` | | 跳过（返回值被忽略） | L457 |
| `on-saw({i,c,hints})` | | 确认看答案（每字最多一次） | L409 |
| `on-next({i,c,strokes})` | | 看过答案后“下一个” | L457 |
| `on-correct(id, 'right'\|'wrong') → false 表示失败` | | 修改上一判断 | L309 |
| `on-state-change(snap)` | | 每次关键 state 变化 | L359 |
| `on-navigate('result')` | | done 阶段“查看这次练习”（作废） | L540 |
| `theme 'light'\|'dark'`、`size 'std'\|'compact'`、`layout 'card'\|'bleed'(\|'marks')`、`bare`、`lamp 0.04–0.06`、`projection`、`guides`、`debug`、`tune {base,lo,hi}`、`replay`、`replay-src(c)`、`start` | | 视觉 / 原型工具 | L524、L471、L565、L389 |

原型壳实际传入（`template.html` ~offset 99962–100476）：`interactive=true`、`hintMode = tool.hintBox?'box':'fade'`、`wTotal = queue.length`、`wFirstTip = kind==='first' && i===0 && !tipSeen`、`wEndable = kind==='pick'`、`endFail = ui.endFail`、`noStroke = ui.noStroke`、`wQueue = ws.queue.map(Z.item)`、`wInit = {key: ws.id+':'+wkey, i, phase, hints, used, saw, strokes, sim, line, hr, cnt(=R/W 条数), sheet, sheetFail, saveFail, last, done[]}`、`size = large ? 'compact' : undefined`。

### 3.2 出题项（`Z.item`，proto-model L~4590 / 组件 `CHARS` L257–L266）

```
{ c:'数', py:'shù', word:['人','数'], blank:1, gloss?:'也；又', groups:[[0..5],[6,7,8],[9..12]], fb?:1 }
```
- `word=[]` 时走“拼音 + 释义”题面（L61–L67）。
- `blank` 是词语里挖空的下标；只挖一格，**没有重复目标字用 □ 的字段**（D16 未落地到此组件）。
- `groups` 在本组件从未被读取；`fb` 为真时提示退回“前 1 笔 / 前 2 笔”（L402）。

### 3.3 字形数据（hanzi-writer-data）

`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/<字>.json` → `{ strokes: string[] (SVG path, 1024 单位, y 向上, 基线 900), medians: [[x,y][]][] }`。落到 345 格用 `glyphT = translate(OFF, OFF+900*KK) scale(KK,-KK)`，`PAD=.06 → OFF=20.7`，`KK=345*(1-.12)/1024≈0.2965`（L273、L285）。

### 3.4 笔迹（组件内 / 快照 / 壳存储）

- 组件内一笔：`{ pts:[{x,y,w}], d:<outline path>, end:'up'|'cancel' }`（L393）；`cur` 是当前一笔的 `pts`（不在 state）。
- `SZInk.build(raw:[{x,y,t}], final, base=11.5, tune)` → `pts[]` 且附 `v30, dot, single, endK`；`SZInk.outline(pts, floor)` → path 字符串；坐标 pt（345 格），时间 ms（989b48fc L1–L40）。
- `snap().strokes` = `pts[][]`（只有 x,y,w，**没有 t、p**，L304）；壳 `wState/wBack` 原样写进会话，`wJudge` 把它存进记录 `strokes`；proto-model 存储时压成 `x,y,w;x,y,w|...` 字串（proto-model L~10500 `enc/dec`，保留 1 位小数）。
- 对照卡 / 弹层缩略图：`inkEls(strokes, key, wk=1.41)` 把 `w` 乘 1.41 再描边；写完一组小格用 `floor=ZFLOOR=1.6*345/42`（L273、L470）。

### 3.5 组件 state（`preset` 基线 L314）

```
ci, n, phase('recall'|'compare'|'answer'|'trace'|'retrace'|'saveFail'|'done'), prev, hints(0..2), used, saw, strokes[], sim(0|'full'|'part'|'trace'|'wrong'), hr({from,to}|null), dim, hout, ask, tipGone, last({ci,c,verdict,strokes|sim,id}|{ci,c,saw:true}|null), sheet, sheetFail, line('record'|'changed'|'saw'|null), save(null|'fail'|'saved'), pend({t:'back'|'judge'|'end', v?}|null), cnt, done[{ci,strokes}|{ci,strokes,saw:true}|{ci,none:true}], gC?, ft?, hm?
```

### 3.6 壳侧记录形状（供新实现对照，template.html ~74390–76340）

- 判断记录：`{id:'r'+serial, c, d:'9-24', v:'R'|'W', i:当天序号, help:''|'hint'|'answer', sid, strokes, rev?}`；会话项 `{c, v, rid}`。
- 事件（不算有效记录）：`{id:'e'+serial, c, d, v:'S'|'A', i, sid}`；会话项 `{c, v:'S'}` / `{c, v:'A', at:i, strokes?}`。
- 会话：`{id, kind:'first'|'ord'|'pick', src, queue[], i, phase, hints, used, saw, strokes, sim, line, lastRid, lastC, items[], done, ended?, demoFail?}`（proto-model L~6331）。
- `adv()`：清 per-字状态；最后一个字 → `phase='done', done=true`，且 `view={name:'result'}`（W13）。

### 3.7 视觉几何（标准 393×852，帧内 y）

状态栏 0–54 → 顶栏 54–98 → 提示/结果行 98–138 → 拼音 142–164 → 词语行 168–222（56×54 格）→ 投影线 224–296 → 书写格 296–641（345）→ 格下说明 645+（min 44）→ “看答案”链接 692–728 → 主按钮 732–784（52）→ 跳过/结束这组 788–828（40）→ Home 条 bottom 8。判断页：对照卡 296–~492，说明 516，写错了/写对了 548–620。done：标题 300、格网 354。紧凑 360×640：状态 40 → 顶栏 ≥44 → 固定 36px 行（提示 / 结果行 / 撤销清空）→ 题面 → 书写格 258（answer 200–345）→ 说明 ≥28 → 按钮 ≥56 → 链接行 ≥40。

### 3.8 用户可见文案（逐字）

| 状态 / 位置 | 字串 | 出处 |
|---|---|---|
| 标题 recall | 凭记忆写出这个字 | L553 |
| 标题 compare | 对照一下，写对了吗？ | L553 |
| 标题 answer | 这个字这样写 | L553 |
| 标题 trace | 描一遍 | L553 |
| 标题 retrace | 自己写一遍 | L553 |
| 标题 done | （空） | L553 |
| 右上角计数 | `{n} / {total}`（如 3 / 5） | L595 |
| 返回按钮 aria（非 compare） | 保存并返回 | L603 |
| 返回按钮 aria / 可见字（compare） | 回到格子里接着写 / 接着写 | L603–L604 |
| trace 步骤点 aria | 第 1 步，共 2 步：描一遍 | L30、L166 |
| retrace 步骤点 aria | 第 2 步，共 2 步：自己写 | L31、L166 |
| 第一次的提示行 | 看拼音和提示，把这个字写在格子里。 | L569 |
| 结果行 record | 「{字}」记为写对 ／ 「{字}」记为写错 | L555 |
| 结果行 changed | 「{字}」已改为写对 ／ 「{字}」已改为写错 | L555 |
| 结果行 saw | 「{字}」记为看过答案 | L555 |
| 结果行动作 | 修改 ›（“·” 分隔） | L40、L611 |
| 提示按钮（还有次数） | 提示 · 还有 2 次 ／ 提示 · 还有 1 次 | L545 |
| 提示按钮（用完，禁用） | 提示已用完 | L545 |
| 提示位置（10.13 无数据，灰字） | 暂时没有提示 | L545 |
| 主按钮 recall / retrace | 写好了 | L545、L548 |
| 主按钮 recall（saw 后） | 看答案 ／ 下一个 | L544 |
| 主按钮 answer | 自己写 ／ 描一遍 | L546 |
| 主按钮 trace | 描好了，自己写 | L547 |
| 主按钮 retrace | 再描一遍 ／ 写好了 或 下一个（saw） | L548 |
| 主按钮 saveFail | 先不保存 ／ 再试一次 | L539 |
| 主按钮 done（作废） | 查看这次练习 | L540 |
| 看答案链接 | 看答案 | L117、L214 |
| 看答案确认正文 | 看了答案，这个字就记为看过答案。 | L228 |
| 看答案确认按钮 | 接着想 ／ 看答案 | L229 |
| 格下说明：提示后（方案①） | 浅红色是提示，只给一部分。接着写下一笔，提示就收起。 | L563 |
| 格下说明：提示后（方案②，作废） | 提示在上面的红框里，只给一部分。 | L563 |
| 格下说明：看过答案后 recall/retrace | 这个字看过答案了，再写只算练习。 | L563 |
| 格下说明：trace | 浅色是参考字形。 | L564、L528(NDT) |
| 格下说明：10.13 recall | 这个字暂时没有提示，可以直接看答案。 | L528 |
| 按钮上说明：answer（含 10.13） | 这个字记为看过答案，后面再写只算练习。 | L528 |
| 保存失败说明 | 没保存上，你写的字还在。 | L526 |
| 重试成功说明 | 保存好了。 | L564 |
| 判断页说明 | 你来判断，点一下就记下。 | L129、L200 |
| 判断按钮 | 写错了（左） ／ 写对了（右） | L131–L132、L201 |
| 对照左卡占位 | 这次没写 | L91、L196 |
| 对照标签 | 你的书写 ／ 参考字形 | L93、L97、L197–L198、L243–L244 |
| 撤销 / 清空 | 撤销 ／ 清空 | L108–L109、L172 |
| 跳过 | 跳过 ／ 下一个（saw 后） | L605 |
| 结束这组 | 结束这组 | L154、L216 |
| 修改判断弹层标题 | 修改「{字}」的判断 | L637 |
| 弹层取消 | 取消 | L240 |
| 弹层说明 | 刚才记的是写对。改了只换掉这一次，不会多算一次。（或“写错”） | L638 |
| 弹层失败说明 | 没改成，还是原来的判断。 | L638 |
| 弹层主按钮 | 改为写错 ／ 改为写对 | L639 |
| 弹层失败按钮 | 先不改 ／ 再试一次 | L250 |
| done 标题（作废） | 这一组写完了 | L141、L186 |
| done 说明（作废） | 这次记录了 {N} 个字，跳过和看过答案的字不算在内。 | L556 |
| 调试叠层（原型专用） | 写一笔后显示 ／ 取消 ／ 抬笔前 30ms 均速 — ／ 抬笔前 30ms 均速 {x.xx} pt/ms ／ 单点 · ×0.90 ／ 点画 · 末端 ×0.90 ／ 末端笔宽 ×{x.xx} | L598–L600 |
| 状态栏（原型专用） | 9:41 | L22、L159 |

壳里与写字页相关但不在本组件的字串：结束这组确认“还有 {N} 个字没写，结束后就不写了。判断过的 {M} 个字已经记下。”[结束这组 / 接着写]；零判断轻提示“这组结束了，没有记下字。”（template.html ~69545、~70359）。

## 4. 与第十稿(v10)决定的关系

**已按 v10 落地、可直接沿用的规则**

- D17 / W12 / K26：计数 “n / total” 来自 `total` prop（L595）；首题说明卡换成一行 `tipOn`（L34–L36、X11 文案）。
- D18 / K25 / W05 / W06 / X01：看答案先确认（L225–L232），确认即 `saw:true` 并 `onSaw`（L407–L409）；之后描一遍 / 自己写只是练习，主按钮和底部链接都变“下一个”（L544、L548、L605），走 `onNext` 不进判断页；结果行显示“「X」记为看过答案”且无修改入口（L555、L611）。
- D19 / W11 / V03 / X02：结果行只在 `recall && !has`（L609），落笔 `touch()`、跳过、确认看答案三处收起（L395、L459、L408）；“· 修改 ›”仍能打开修改判断弹层（L614），落笔后的修改走结果页格子（不在本组件）。
- D20 / K31 / W09 / L08：判断页写错了左、写对了右、同重（L131–L132）；左上“接着写”回书写格不算记录（L607）；对照“你的书写”左、“参考字形”右（L87–L100）。
- D22 / 10.10：`endable` 时“结束这组”在跳过那一行右边（L152–L156、L216），点了交给壳确认（`onEnd(snap,false)`）；`endFail` 上升进保存失败态并在重试后 `onEnd(snap,true)`（L356、L308）。
- D25 / K24 方案①：`hmode()==='fade'` 默认（L400），墨迹 .35（L510）、暖墨红细中线逐笔动画（L505–L509）、下一笔淡出（L395–L397）。
- D07 / 2.5 / 2.6：判断、返回、结束的保存失败都留在原处，[先不保存 / 再试一次]（L538–L539、L307–L308）；撤销 / 清空按本人意图执行（L625–L626）。
- W03 / W04：提示按钮写剩余次数、每次约四分之一且至少 1 笔、接着已写笔数往下给（L401–L405、L545）。
- W08 / V01：0.4s 按钮、0.3s 落笔防连点（L347–L352、L522–L523）。
- W10：`componentDidUpdate` 自存 `_ps`，`onStateChange(snap)` 含 phase（判断页也能恢复）（L353、L359）。
- W15 / V02 / X08：紧凑版整页可滚、按钮区第一屏、书写格 recall/trace/retrace 固定 258、answer 200–345（L160、L382–L384、L568）。
- 10.13 / I04：`sd()===null` 时无部分提示（“暂时没有提示”灰字）、看答案显示完整楷体 `<text>` 并照实记看过答案、描一遍用浅色整字（L484、L488、L500、L528、L545）。

**与 v10 决定冲突 / 已作废、新实现应删**

- `done` 阶段整块：“这一组写完了”、44px 小格淡入、“这次记录了 N 个字…”、“查看这次练习”→`onNavigate('result')`（L140–L145、L184–L189、L449–L450、L540、L553、L556、L566、L619–L621、L296 `doneRef`、L492–L496 `zCell`、L271 `A40`、预设 Z/Z15/Z30）。D20：最后一个字判断完直接进结果页。壳已用 `adv()` 绕过，但组件里仍会在最后一个字时 `setState({phase:'done'})`（L461），只是随即被卸载。
- K24 方案②全部：`hint-mode='box'`、`hm`、`boxHintEl`、`boxOn/boxHint/nwBox/boxH/bh`、方案②说明句（L400、L519–L520、L529、L55、L64、L563、L570、L599）。D25 明言不做。
- Noto Serif SC 加载（L11）只服务 done 标题，随 D20 一并去掉；LXGW WenKai GB 改为随包的 ShiziKai 子集（D13），不能再由组件动态插 CDN 链接。
- `layout 'bleed' / 'marks'` 两种书写格外观（L74–L78、L473–L479、L622–L624、L558 bleed 分支）不是定稿。

**v10 明确要求但原型没有 / 交接备注标为“原型做法不是规格”**

- 页面切换（进入写字页、进结果页、返回）用 iOS 原生方式含左边缘右滑；组件里的 `turn()`（L452）、`toCompare/flip` 的克隆影子（L422–L447）是原型近似。
- 紧凑版所有可点控件（返回、撤销、清空、修改判断、看答案、跳过、结束这组、写错了/写对了、主按钮）是 `span/div`（L163、L170–L172、L201、L211、L214–L216），正式版一律用按钮并可读屏、可键盘。
- 场景面板、`start` 预设（L313–L336）、`sim` 演示笔迹（L362–L380）、`replay/replaySrc`（L418–L419）、`debug/tune` 调试叠层（L80–L82、L598–L600）、`noStroke` 开关、状态栏/Home 条（L20–L24、L253）都是原型工具，不进产品。
- 边开发边改清单二（写字页）要在实现时顺手做而原型没有：W16 跳过后 3s 轻提示“已跳过「警」 · 撤销”；W17 清空后可撤销一次；W18 返回首页轻提示“已保存，下次接着写”；W19 描一遍开始先播一遍笔顺可跳过；W22 拼音加大加深一档；W23 深色下提示笔画、描红轮廓、禁用按钮各提亮一档；更大字体下点提示后说明与上下间距过近。
- 交接备注一“仍未定”：正式版如何判断“已经写对了哪几笔”（W04）——原型按已写笔数近似，做不到就沿用已写笔数；`fb` 字前 1 / 前 2 笔已定。

**其他 v10 决定与本组件的接口关系**

- D03：由用户自判，组件不做比对评分（无任何自动判对代码）——一致。
- D06→D19：`onCorrect(id, verdict)` 更新同一记录、不加次数（壳 `wCorrect` 只改 `r.v` 与 `rev++`）——一致。
- D16：重复目标字用 □ 遮住——**组件 `cells` 只挖一格**，没有 □ 逻辑，需要出题数据加字段并在 L48/L599 增加 `cell.masked` 一类状态。
- D23：跳过、看过答案不算有效记录——组件把 `onSkip/onSaw/onNext` 与 `onJudge` 分开传，壳把前者记为事件（`v:'S'|'A'`）而非记录——一致。

## 5. 风险与坑

1. **跳过 / 看过答案 / 下一个不等保存**：`next()` 里只有 `rec` 分支检查 `onJudge` 的返回值（L456），`onSkip/onNext` 的返回值被丢弃（L457），`seeAnswer` 也不看 `onSaw` 结果（L409）；壳侧对应 `commit(...,false)` 永不失败。D07 只写“保存成功才推进”对判断，跳过/看过答案是否也要等保存需要产品定（见 §6）。
2. **按钮防连点用的是 `performance.now()`**（L352、L525），不是事件时间戳；落笔那条才用 `e.timeStamp`（L411）。主线程忙时排队的点击可能在 0.4s 后才处理而被放过——与交接备注十.3“判断时间用事件自己的时间戳”不完全一致。
3. **字形数据三态**：`sd()` 返回 `undefined`（加载中）时，`rangeFor` 返回 null → `hint()` 静默无效（L403–L404）但按钮仍显示“提示 · 还有 2 次”；`refGlyphC` 对 `undefined` 和 `null` 都走 `<text>` 回退（L487 `!d`），看答案页可能先出字体字形再切成笔画字形（`Promise.all` 后 `forceUpdate`，L340）。`load()` 失败后永久缓存 `null`（L281），整个会话不再重试。
4. **提示宽度与颜色**：中线 `strokeWidth 18` 在 1024 空间，落到 345 格约 5.3pt、258 格约 4pt；深色 `--ar=#D47A5D`。边开发边改 W23 已指出深色下几乎看不见；交接备注八.3 真机检查项“深色下提示和自己的墨能不能一眼分开”。
5. **`hr` 是区间不是集合**：第二次提示会覆盖 `hr`（L405），且 `hrOf()` 优先用存下的 `hr`（L403），所以提示范围是在点提示那一刻按当时笔数定的；用户写了更多笔后不会重算。若用户已写笔数 ≥ N−q，`from` 被夹到 `N−q`，提示总是最后一个四分之一。
6. **`touch()` 在落笔（pointerdown）就收起结果行、首提示、提示层**（L389→L395），pointercancel 也不会恢复——符合 D19“落笔”的措辞，但要注意 iOS 上误触边缘手势产生的 cancel 也会收掉结果行。
7. **`fitC()` 只在 answer 阶段生效**（L382 `if(this.viewPhase()!=='answer') return`），且在每次 `componentDidUpdate` 里跑（L353）并可能 `setState({gC})`——靠 `|g−cur|>1` 防抖。`gC` 一旦算出会保留到下一次 answer；recall/trace/retrace 用常量 258（L568）。紧凑版书写格是否“在 258–345 之间尽量大”（L381 注释、V02）与 X08“固定 258、点提示不变大小”之间，代码取了 X08。
8. **紧凑版书写时的滚动冲突**：`touchAction:none` 只在 svg 上（L513），滚动容器 `overflow-y:auto; overscroll-behavior:contain`（L161）；Safari/WKWebView 未验证（README“没有覆盖”），落笔时页面被拖动的风险要真机测。
9. **`materialize()` 与 `sim`**：所有交互前都会把演示笔迹固化成真笔迹并 `setState`，删掉 `sim` 时要把这些调用一起清理（L389、L404、L407、L426、L456、L625），否则留下无意义的 setState。
10. **`used` 与 `hints` 冗余**：`used=max(used,hints)`，在单字内 `hints` 从不减少；`snap()`、`onJudge.hints`、`onSaw.hints` 都用 `max(used,hints)`（L304、L409、L454）。新实现可只保留一个字段，但壳/记录里的 `help:'hint'|'answer'` 只记“用过没用过”，不记次数。
11. **快照不含时间和压力**：`snap().strokes` 只有 `{x,y,w}`（L304），与 D14“历史缺 t/p 如实报告”一致；若正式版要回放或重算笔宽，需在存储契约里另加 `t`（笔迹管线的 `raw` 里有）。
12. **模板回退色是旧稿值**：`var(--i1,#2B2824)` 等回退与 `TH.light`（`#3B2F28`）不一致（L27 vs L275），运行时总会注入变量，但复制样式到新代码时不要用回退值。
13. **`n` 与 `ci` 双计数**：`n` 只为假计数预设（P/Z15/Z30）存在；恢复时 `n=i+1`（L299）。新实现用 `i+1` 即可。
14. **`onBack` 缺省时返回会模拟保存失败**（L607）——独立打开组件时的演示行为，别当规则。
15. **首帧就 `penArm()`**：`renderVals` 里检测 `_penCi!==ci` 时调用 `penArm()`（L522–L523），这是在 render 里产生副作用；React 严格模式下 render 可能执行两次，但 `Math.max` 使其幂等。
16. **`hint-size="393px,852px"` / `$preview`**：dc 运行时的尺寸提示（L256、壳 import），与产品无关。
17. **字体依赖网络**（L11）与字形数据依赖 jsDelivr（L282）：离线 PWA 下写字页会退化到系统字体、无提示、看答案是系统楷体——正式版必须随包。
18. **`props.tune.base` 覆盖 BASE**（L311、L389）：调试用；正式版笔宽 11.5pt 等真机阈值（交接备注一、八.1）。

## 6. 未解问题

1. 跳过、确认看答案、看过答案后“下一个”三个动作是否也要“保存成功才推进”（D07 只对判断写明）；原型里它们不检查返回值。
2. 正式版提示的“接着已写的笔画往下给”如何判断已写对了哪几笔（W04，交接备注一列为待定）；原型只按笔数，且 `groups` 部件分组数据完全未使用——部件提示是否还在范围内。
3. D16 重复目标字用 □ 遮住：出题数据（`Z.item`/`CHARS`）没有相应字段，`cells` 只挖一格；□ 的字段名、显示样式（是画 □ 字符还是空格）无从代码确定。
4. 紧凑版书写格：X08 的“固定 258、点提示前后不变”与 V02 注释“在 258–345 之间尽量大”哪一条是最终口径（代码取固定 258，answer 页例外）。
5. `save:'saved'` → “保存好了。”这句只在无 `pend` 的演示路径出现（L539）；正式版重试成功后要不要显示这句、显示多久，代码里没有定时消失。
6. 结果行的“saw”态（“「X」记为看过答案”）没有修改入口——是否允许把“看过答案”改成判断，或反过来，需要产品确认（K25 说看过答案不判断）。
7. 边开发边改 W16/W17 的“跳过后可撤销 3 秒”“清空后可撤销一次”与 D07“撤销按意图执行”“已发生的帮助事实不删除”如何叠加（撤销跳过后 `onSkip` 已发出的事件怎么回滚）。
8. 描一遍的“先播一遍笔顺可跳过”（W19）与 10.13 无笔画数据时“不分笔顺”的分支如何并存；原型均未实现。
9. `hint()` 在字形数据还在加载时静默无效——正式版是随包数据（无加载态）还是需要加载态文案。
10. 交接备注一“真机检查”里的收笔阈值 0.25/0.9 pt/ms、BASE 11.5pt、深色投影线与十字线加重与否，都还没有结论；本组件相关常量（L273、`tune`）应做成可配置。
