# 第十稿原型 · 主模板与运行时：页面编排、流程参数、场景面板、导航、状态

> 阅读范围：`docs/design/v10/extracted/` 下解包出的第十稿可点原型。
> **行号约定**：`bundler_template.txt` 是一整行 JSON 转义字串；本文所有 `template.html:N` 行号均指 **解码后的 HTML**（已存到 `docs/design/v10/extracted/拾字-可点原型-第十稿交接版.template.html`，共 997 行，`python3 -c "json.loads(...)"` 直接得到）。其他文件按原文件行号。
> 组件页文件名对照（`bundler_ext_resources.txt`）：`83f2f17e…html` = 首页壳-v3；`cee6ca3c…html` = 字库墨墙屏；`1c6d798a…html` = ShiziWriteScreen；`2b03a433…html` = ShiziScreen；`9df10dc8…html` = 录制模式；`78904995…js` = dc-runtime；`36416a1c…js` = proto-model（`window.SZProto`/`window.SZRec`）；`989b48fc…js` = ink（`window.SZInk`）；`12d5b84c…js` = support.js（实际内容只是 `<image-slot>` 自定义元素）；`b9eeb7bb…js` / `0b901a7e…js` = React / ReactDOM 18.3.1 UMD。
> 产品决定出处：`docs/handoff/decisions.md`（D01–D25）、`docs/product/04-v10-handoff.md`、`docs/design/v10/交接备注-第十稿交接版.md`（下称《交接备注》）。

---

## 1. 概览

1. 主模板是一个 dc-runtime 设计组件（`<x-dc>` + `<script data-dc-script>` 里 `class Component extends DCLogic`，template.html:8/254/289）。dc-runtime 把 `{{ path }}`、`<sc-if>`、`<sc-for>`、`<dc-import>`、`<helmet>`、`sc-camel-*`、`ref=` 编译成 React 元素树（78904995…js:404–415、612–687、1085），每次渲染把 `props` 与 `renderVals()` 返回的扁平对象合并后喂给模板。
2. 模板是**唯一的状态容器与路由器**：`this.app`（持久化到 `localStorage['shizi-proto-v9']`）+ `this.ui`（内存态弹层/开关），所有页面都是按 `app.view.name` 从四个组件页（首页壳、ShiziWriteScreen、ShiziScreen、字库墨墙屏）挑一个 `<dc-import>` 渲染（template.html:33–51、809–909）。组件本身无路由，所有点击以 `onNavigate(key)` 字串键回给模板（`scrNav`，template.html:695–802；`homeNav`，545–557）。
3. 写入走单一 `commit(fn, explicit)` 通道（template.html:522–530）：深拷贝 → 变更 → `SZProto.save` → 视图变化时触发「克隆影子」推入/推出转场。`explicit=true` 的写入可被场景面板「下一次保存失败」拦下（D07 的原型化）。
4. 启动顺序：深链 `?flow=` → 已存进度 → 默认「今天还没记录」（template.html:461–472）；`?flow` 用后即从 URL 抹掉。`FLOWS` 共 30 个入口（255–260），另有 `demo` 属性驱动的 ~90 个静态预设 `DEMOS`（297–392）只给画布用。
5. 场景面板（144–247）、调试叠层滑杆、真人笔迹回放、录制模式、`tool` 字段、`克隆影子` 转场、系统示意弹层（658–679）都是**原型工具**，《交接备注·界面交接》明确不进产品。
6. 与 v10 决定的关系：模板已实现 D17（首次直接进写字页、5 个字）、D18（`wSaw` 记 `A` 事件不判断）、D19（结果页 `cell:N` 对照/修改）、D20（`adv` 末字直接进结果页）、D21（`ui.lk` 三模式合一，`lkAdd` 显式加入）、D22（`wEnd/endGroup`）、D23（`SZProto.lists` 写错过/快忘了）、D24（撤销在备份页常驻、`bkLast` 结论句、补记已删）。**唯一与 D25 冲突**的是面板开关 `hintBox`（K24 方案②，template.html:954）——D25 定方案①，方案②不做。
7. 数字仍有写死处：`today="9-24"` 直接写在五处 `<dc-import>` 属性里（34、35、41、44、47），`TODAY='9-24'` 也在 proto-model:4；库字数表 `LIBS`（283）、备份文件内容（proto-model:144）等见《交接备注》第四节。

---

## 2. 组件/模块清单

### 2.1 模块表

| 名称 | 位置(file:lines) | 职责 | 对外接口(函数名/事件/存储键) | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| dc-runtime | 78904995…js 全文（1911 行） | 把 `.dc.html` 编译为 React：`parseDcText`(38)、`compileTemplate`(470)、`walkIf/walkFor/walkComponent`(612–687)、`DCLogic`(820–845)、`createComponentFactory`(888)、`ensureFetched`(1643) 按 `name` 取 `./<name>.dc.html`（打包后走 `window.__resources`/`bundledBlob`，1136–1150） | 全局 `DCLogic`、`window.__dcRegistry`；`<helmet>` 子节点提升到 `<head>`(1362–) | window.React/ReactDOM | **应重写**（换成正式前端框架路由；不复用） | 关键语义：`sc-if value` 为假不渲染；`sc-for list as`；`sc-camel-on-click`→`onClick`；`dc-import` 属性 kebab→camel（`on-navigate`→`onNavigate`，`hint-size` 仅占位尺寸）；`ref="{{x}}"` 传 React ref |
| 主模板壳 `Component` | template.html:289–995 | 状态容器、路由、转场、弹层、面板 | 见 2.2/2.3；`renderVals()` 809–995 | SZProto、SZRec、SZInk、四组件 | **可抽取改造**（业务规则可搬，实现方式重写） | 所有业务判断都在这里而不是组件里 |
| `FLOWS` 深链表 | template.html:255–260 | `?flow=` 30 个入口：用户态 `us`、起始 `view`、`ui` 预设、`app(a)` 变换、`fail`、`big`、`ink` | `boot()` 461–472、`startFlow(k)` 565 | SZProto.build/session、F10/F11(264/266)、INK12(262) | **不进产品**（QA 脚本可借用其场景清单） | 见 2.2 表 |
| `DEMOS` 静态预设 | template.html:297–392；`bootDemo` 393–396 | `demo` 根属性 → 直接构造 app/ui 快照给画布"新画"一节；不读写 localStorage、无面板、无转场 | 根 props `demo`、`demoDark`、`demoLarge`（254 data-props 只声明 `demo`） | 同上 | **不进产品** | `zc*`、`ink*`、`noStroke*`、`protFail`、`undoFail*`、`endConfirm` 等 ~90 个键 |
| 舞台与缩放 | `dims` 486、`relayout` 487–499、`standalone` 484、`rootStyle/stageBox/stageInner` 818–826 | 393×852（或紧凑 360×640）舞台按视口 `scale`；桌面模式旁置面板；`visualViewport` 量键盘高度 `kb` | URL `?phone=1 ?sa=1 ?vw ?vh ?it`；`state.lay={mode,W,H,s,top,left,sa,it,kb,SW,SH}` | — | **应重写**（正式版是原生视口，不缩放） | 原型为 393 宽书写格 1:1 而用 `black-translucent` 状态栏，交接备注列为原型才有的问题 |
| 页面转场「克隆影子」 | `beginTrans` 428–430、`runTrans` 431–440、`componentDidUpdate` 416、`ghostRef` 53、`PUSH_SH` 275、`EASE/DUR` 281 | 切页前 `cloneNode(true)` 当前页（含 canvas 复制）到 ghost 层；push：新页 `translateX(100%→0)` 300ms 带左投影；pop：影子右滑出；`reduce` 时 120ms 交叉淡化 | `this._kind='push'|'pop'` 副通道 → `commit` 里 `beginTrans` | Web Animations API | **不进产品**（《交接备注》九.1：工程做真正两页切换，iOS 原生方式） | 时长/曲线/投影数值只是近似规格 |
| 弹层动效外套 | `ov` 441–446、`scrimOf` 447、`kindOf` 448、`animIn` 447–453、`leave` 454–459 | 对原型层弹层（ref）和**组件内**弹层（按 DOM `z-index:5` + `position:absolute` 探测）套升起/下落/淡入淡出 | `leave(k,fn)`：动画结束再执行关闭 | DOM 结构耦合 | **不进产品**（《交接备注》九.3：组件内自己实现） | 以 DOM 样式探测弹层非常脆弱 |
| 写入层 | `commit` 522–530、`go` 531、`push` 559、`back` 560–564、`blocked/toBlock` 520–521、`resetTo` 538–543 | 深拷贝→变更→`expireUndo`→`SZProto.save`；失败则 `blockReal` 进阻断页；`explicit` 写入可被 `failNext` 拦 | `commit` 返回 `true/false`（调用方据此留在现场） | SZProto.save | **可抽取改造**（"保存成功才推进/失败留现场"的调用约定值得保留） | D07 的骨架 |
| 页面栈 | `push(v)` 559：`v.from=a.view`；`back()` 560：`a.view=a.view.from||home`；`tabOf` 691；`viewOf` 541；`endSess` 692 | 以 `view.from` 链保存来处；tab 根页用 `go` 不记 from | — | — | **可抽取改造** | 会话 `src` 也用同一 view 形状 |
| 首页导航 | `homeNav` 545–557 | `start/pick/other/library/mine/records` | 首页壳 `on-navigate` | SZProto.session/QUEUES | **可抽取改造** | 含 D05/D17/S01 规则 |
| 会话调度 | `openWrite` 537、`startB` 595–605、`addStart` 584–590、`pickStart` 609–615、`adv` 534、`otherSlot` 587、`grpLabel/grpRest` 585–586 | A（普通/首次）与 B（这次选的字）两槽；开新 B 时旧 B 未完 → 三选确认框（S02） | — | — | **可抽取改造** | D05 会话隔离的具体实现 |
| 结束这组 | `wEnd` 567–570、`endGroup` 571–576 | 先确认；有判断→结果页；零判断→回来源+轻提示；保存失败 `ui.endFail++` 留写字页 | 写字页 `on-end`、`end-fail`、`endable` | — | **可抽取改造** | D22/10.10 |
| 写字页回调 | `slot` 617、`wBack` 618–620、`wJudge` 621–624、`wSkip` 625–626、`wCorrect` 627–628、`wState` 629–631、`wSaw` 632–633、`wNext` 634、`wNav` 635 | 记录/事件落库、会话推进、恢复快照 | 见 3.8 | — | **可抽取改造** | D18/D19/D20/W10 |
| 查字/自选弹层状态 | `ui.lk`；`lkCur` 577、`onLkInput` 578、`scrNav` 里 `lookup/addSheet/lkList/lkSel:/lkGo/lkAdd/lkAddStay/lkClose/lkPick:/lkPractice/lkDetail/addTile:/addStay/addStart` 706–722 | 三模式 `lookup|add|pick` 同一弹层（画在字库墨墙屏内；首页时 `sheet-only` 叠在首页上，35） | 字库墨墙屏 `lk`、`on-lk-input`、`kb` | HAN 正则 284、`SZProto.canPractice`、`__szStore.data` | **可抽取改造** | D21；`addTile:/addStart/addSheet` 是旧键（改动清单：不再用） |
| 旧「自己选字」弹层 | template.html:65–89（`pickOn`）、`parsePick` 607、`pickStart` 609、renderVals 912–928 | 原型层旧弹层 | 仅 `DEMOS.pick/pickFail` 与 `pickStart` 可达；`homeNav('pick')` 已改走 `ui.lk`（553） | — | **应删除** | 死代码残留 |
| ShiziScreen 导航 | `scrNav` 695–802 | 字库换库、图片、单字详情、设置、备份/恢复/清空/撤销、结果页对照/改判/难度、阻断页重试 | ShiziScreen/字库墨墙屏 `on-navigate` | — | **可抽取改造** | 0.4s 防连点（697） |
| 系统示意 | `sysRows` 658–679、`openFiles` 638、`restoreFromOnboard` 639–643、`remind` 680、模板 119–128 | 文件选择/通知权限/导出分享/图片分享/存相册 的假面板 | `ui.sys={kind:'files'|'notify'|'export'|'share'|'photos',from?}` | — | **不进产品**（真机用系统面板） | 文案原型专用 |
| 撤销机制 | `showUndo` 653–654、`expireUndo` 655、`undoDo` 682–689、`undone` 476、`fitUndone` 418–423、`ui.rm` 934 | 替换/清空后的撤销在备份页常驻、离开失效并留 `bkLast`；单字详情移除自选的撤销；`已撤销` 2.4s | `ui.undo={l1,l2,prev,kind,last,failed}` | — | **可抽取改造** | D24/K30/L07/10.15 |
| 词语反馈 | `wfOk` 648–650、`wfUndo` 651、模板 101–112 | 单字详情「不再用这个词语」→ `app.wordOff[]` + 横幅可撤销 | ShiziScreen `wordFeedback` 键 | — | 可抽取改造 | 数据字段 `wordOff` |
| W12-f 整页 | 模板 56–64、renderVals 899 | 「现在没有要写的字」原型层整页 | `ui.w12f`、`ui.noSched` | — | 可抽取改造（页面本身要做进组件） | 由面板开关触发 |
| 场景面板 | 模板 144–247；renderVals 939–991 | 用户态切换、流程起点、边界开关、外观、调试叠层、录制、重置演示、说明、诊断行 | `ui.panel`；`?panel=1`；手机两指长按左上 1s（501–504） | — | **不进产品** | 全部文字原型专用 |
| 调试叠层参数 | `tool.debug={on,lo,hi,base}` 276；滑杆 963–966；传给写字页 `debug`、`tune`（38、855） | 收笔阈值与 BASE 现场调参 | — | ShiziWriteScreen | **不进产品** | 真机阈值待定 |
| 真人笔迹与录制 | `loadRecs` 479、`realAvail` 480、`replaySrc` 481、`recExit/recSaved` 846、`vRec` 49–51/847、面板 967–975 | 回放 `data/handwriting` 或本机 IndexedDB 录制；录制模式全屏 | `SZRec.all/put/setWriter/clear`；`SZInk.pick` | proto-model:147–159、ink:62–81 | **不进产品**（研究工具） | `shizi-proto-v9-rec` |
| proto-model `SZProto` | 36416a1c…js:1–145 | 演示数据（SAMPLES/PYX/DAYS/300 字）、`build(us,opt)`、`session()`、`load/save`（含笔迹压缩 enc/dec）、`restoreData`、`lists`（写错过/快忘了） | `window.SZProto={KEY,VERSION,TODAY,SAMPLES,QUEUES,DAYS,CUSTOM,USER_STATES,item,canPractice,pyOf,PYX,build,session,load,save,enc,dec,seed,restoreData,doy,toD,ago,lists,extra300,demo300}` | localStorage | **应重写**（数据模型可参考，规则 `lists` 可抽取；演示数据不进产品） | K15/K16 规则实现在 87–90 |
| `SZRec` 录制存储 | 36416a1c…js:147–159 | IndexedDB `shizi-proto-v9-rec`（stores `recs` keyPath `key`、`writers` keyPath `id`），不可用退 localStorage 同名键 | `all/put/setWriter/clear` | indexedDB | **不进产品** | 重置演示不动它 |
| ink `SZInk` | 989b48fc…js | 笔迹管线（1€ 滤波+Catmull-Rom、速度→笔宽）、回放 `play`、`register/pick` | `window.SZInk={BASE,build,synth,atSpeed,resample,wrongFix,outline,register,pick,fromRecord,play,rev,sources}` | — | 属他人范围（写字组件）；对壳层只是 `pick` 数据源 | `SOURCES=[]` 空（67） |
| support.js | 12d5b84c…js | **只是** omelette `<image-slot>` 自定义元素（`customElements.define('image-slot')` 1223），持久化到同目录 `.image-slots.state.json`（94、174） | — | fetch/omelette bridge | **不进产品**（与拾字无关的设计工具残留） | 任务描述里的"fonts/hanzi-writer 加载/存储"并不在此文件 |
| `__szStore` 字形缓存 | 各组件页：ShiziScreen 234–238、字库墨墙屏 190–193、Write 273–276、首页壳 157–160、录制 85–86 | 共享 `window.__szStore={data:{},pend:{}}`，按字 fetch `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/<c>.json`，失败记 `null` | 模板读 `ST.data[c]===null` 判"练不了"（585、710） | jsDelivr | **应重写**（正式版本地打包笔画数据；许可 Arphic 需法务确认，《交接备注》八.4） | 每个组件各自定义同一段 |
| 字体加载 | 各组件页 `<helmet>` 第 11–13 行（ShiziScreen:11–13 等） | 动态插入 `<link data-szf>`：霞鹜文楷 GB（jsDelivr `lxgw-wenkai-gb-web@1.522.0`）、Noto Serif SC 400/500（Google Fonts） | — | 联网 | **应重写**（D13：子集改名 ShiziKai、随包分发） | 模板本身不加载字体 |

### 2.2 页面/状态总表（模板命名）

**A. `app.view.name`（持久化的页面）**

| view.name | 附加字段 | 渲染组件 → screen | 归属 tab（`tabOf` 691） |
|---|---|---|---|
| `home` | — | 首页壳（`state=first/empty/record`，845）；`ui.noChars` 时改 ShiziScreen `noChars`（876） | home |
| `write` | `slot:'A'|'B'` | ShiziWriteScreen（848–856） | — |
| `result` | `slot` | ShiziScreen `result`(ord) / `firstResult`(first) / `endPicked`(pick)（859） | 由会话 `src` 决定 |
| `library` | — | 字库墨墙屏 `home`（878） | library |
| `allWritten` | `sort,filter,fold,find,off` | 字库墨墙屏 `all` | library |
| `wrongList` / `forgetList` | `off[]` | 字库墨墙屏 `wrong` / `forget` | library |
| `detail` | `c`, `lookup?{text,cur,mode,src}` | ShiziScreen `detail` / `detailEmpty`（868） | 随 from |
| `mine` | — | ShiziScreen `mine` / `mineEmpty`（866） | mine |
| `records` | `m:9|8` | ShiziScreen `records` / `recordsEmpty` / `recordsHistory`(m=8)（869） | mine |
| `annual` | — | `annual` / `annualEmpty`（870） | mine |
| `about` | — | `about`（871） | mine |
| `settings` | — | `settings` / `settingsDenied`（872） | mine |
| `backup` | — | `backup` / `backupDone`(有撤销时)（874） | mine |
| `onboard` | — | `onboard`（865）——**已无入口**（D17 去掉首次说明页；仅 DEMOS/`restoreOnboard` 残留） | — |
| （虚拟）`block` | `ui.blockView` 时 `curView()` 返回 | `storageBlock`（867） | — |

**B. 组件内弹层（`ui.over`，盖在当前 `under` 页上，887–898）**：`libSwitch`、`libConfirm`（`ui.libTarget/libFail`）、`clearConfirm`（`ui.clearFail`）、`restoreConfirm`、`image34`、`image11`（`ui.imgMode='session'|'today'|'month'|'char'`，`ui.imgFail`，`ui.imgMsg`）。字库页上换库弹层走 `vOver` 单独一层（46–48、881）。

**C. 原型层弹层/浮层（`ui.*`）**：`lk`（查字/添加/自选，画在字库墨墙屏内）、`pick`（旧，死代码）、`confirm`（两键/单键 `one`/三键 `three`+`mid`）、`wf`（词语反馈）、`wfBanner`、`sys`（系统示意 5 种）、`undo`（撤销底栏）、`undone`（已撤销 2.4s）、`rm`（移除自选可撤销）、`note`（轻提示 3.2s）、`toast`（面板级 2.6s）、`w12f`（整页）、`rec`（录制模式整页）、`panel`、`notice`（版本重置提示）、`tabHint`（"添加到主屏幕后再用"，140–142）。

**D. 边界开关（`ui`，非持久）**：`failNext`、`blockSim`、`blockReal`、`blockView/blockFrom`、`noChars`、`noSched`、`protFail`、`undoFail`、`noStroke`、`endFail`、`clearArm`、`diffFail`、`sheet`。

**E. `?flow=` 入口（255–260），共 30 个**

| flow | us | 起始 | 备注 |
|---|---|---|---|
| 2.1 | first | home | 首次使用 |
| 2.2 / 2.3 / 2.4 | noToday | home | 日常/看答案/跳过 |
| 2.5 | ordHalf | home | 离开与恢复 |
| 2.6 | noToday, `fail:true` | home | 保存失败（`failNext`） |
| 2.7 | noToday | home | 自己选字 |
| 2.8 | today | library | 字库 |
| 2.9 | today | mine | 我的与记录 |
| 2.10 | today | settings←mine | 设置与备份 |
| 2.11 | today | home | 边界 |
| 10.1 | today | library | 字库首页 |
| 10.2 | today | library + `ui.lk={mode:'lookup',text:'感慨'}` | 查字·添加 |
| 10.3 | today, `big` | allWritten←library | 300 字 |
| 10.4 | today | wrongList←library | 写错过·快忘了 |
| 10.5 | today | detail 题←library | 单字详情 |
| 10.6 | today | mine | 我的 |
| 10.7 | today, `ui.noChars` | home | 改名（noChars 页） |
| 10.8 | today | forgetList←library | 会话规则 |
| 10.9 | today, `big` | library | 300 字演示 |
| 10.10 / 10.10b / 10.10c | noToday(F10 judge) / bothHalf / noToday+fail | write B | 结束这组 有判断/零判断/保存失败 |
| 10.11 / 10.11b / 10.11c | today (F11) | result B ← wrongList/forgetList | 写对后离开等 |
| 10.12 | today, `ink` | library | 笔迹缺失 |
| 10.13 | noToday, `ui.noStroke` | write A | 笔画数据取不到 |
| 10.14 / 10.15 | today, `ui.protFail` / `ui.undoFail` | backup←mine | 保护副本失败 / 撤销失败 |

**F. `USER_STATES`（proto-model:72–75）**：`first`、`noToday`、`today`、`ordHalf`、`pickHalf`、`bothHalf`、`firstHalf`。

### 2.3 导航图（动作 → 去向；含返回与弹层）

**首页（首页壳 `on-navigate`，`homeNav` 545–557）**
- `start`：B 未完 → `openWrite('B')`；否则 A 未完 → `openWrite('A')`；`!introSeen` → 建 `first` 会话（5 字 `QUEUES.first`，`remind='ask'`）直接进写字页（D17）；`ui.noSched` → `w12f` 整页；否则建 `ord` 会话（`QUEUES.ord`）进写字页。均 `_kind='push'`。
- `pick` → `ui.lk={mode:'pick',src:'home'}`（字库墨墙屏 `sheet-only` 叠在首页，35）。
- `other` → `openWrite(otherSlot())`（两组都未完时另一组，S01）。
- `library` / `mine` → `go({name})`（tab 切换，不记 from）。
- `records` → `push({name:'records',m:9})`。

**写字页（ShiziWriteScreen 回调，617–635）**
- `on-back(snap)` → 保存快照到会话 → `view=viewOf(session.src)`，`_kind='pop'`，`explicit=true`（可失败留场）。
- `on-judge(o)` → 追加 record（`v:R|W`，`help:'answer'|'hint'|''`）→ `adv`：末字 → `view={name:'result',slot}` push（D20）。
- `on-skip(o)` → 追加 event `v:S`（或看过答案后 `A`）→ `adv`。
- `on-saw(o)` → 追加 event `v:'A'`，`items.push({c,v:'A',at:i})`，`phase='answer'`（D18/K25）。
- `on-next(o)` → 补写 `A` 项 strokes → `adv`。
- `on-correct(id,verdict)` → 改同一 record（`rev++`）（D06 保留部分）。
- `on-state-change(snap)` → 无声保存现场（W10 恢复到离开时阶段）。
- `on-navigate('result')` → push result。
- `on-end(snap,confirmed)` → `ui.confirm`（接着写/结束这组）→ `endGroup`：有判断 → result B push；零判断 → `B=null`、回 `src`（pop）+ `note('这组结束了，没有记下字。')`；保存失败 → `ui.endFail++`（D22）。

**结果页（ShiziScreen `result/firstResult/endPicked`，`scrNav` 785–801）**
- `home|library|mine`：`endSess`（清槽、回 `src`），若目标 tab ≠ `tabOf(src)` 则再切到该 tab（S03，785）。
- `close`：`endSess` pop（"回到 X" 按钮，文案 `LEAVE` 279 + `detail` 特例 861）。
- `again`：新 `ord` 会话 `QUEUES.again`（静题慢亦额）。
- `first`：新 first 会话（`onboard` 页遗留）。
- `correct` / `cell:N` → `ui.sheet={rid}|{item}`（对照/修改，D19）；`csFlip`（改判 explicit）、`csStay`、`csClose`。
- `diff:N` → `setDiff`（`diffs.push`，explicit）；`diffStay/diffRetry`。
- `resultImage` → `over=image34, imgMode=session`；`remindOn` → `sys notify`；`remindOff` → `remind('off')`。
- 0.4s 内按钮不响应（697，W08）。

**字库 tab（字库墨墙屏 `home/all/wrong/forget`，706–735）**
- `lookup` → `lk lookup`；`lkList`（回逐字列表）；`lkSel:X`（圆圈勾选，`unsel` 反选）；`lkGo`（练勾选的字 → `startB(sel,src)`）；`lkPick:X`（出卡片）；`lkDetail` → `push detail{c,lookup}`（返回时恢复弹层，`back` 562–564）；`lkPractice` → `startB([c])`（不可练时 `note`）；`lkAdd` → `added.push`（explicit，失败 `addFail`）；`lkAddStay`；`lkClose`。
- `sort:` / `filter:` / `fold:M` / `sel:X`（写入 `view.*`）；`filterGo`：wrong/forget → push 清单，`unw` → `startB(自选未写)`。
- `listGo` → `startB(清单剩余字, {name:list,from})`。
- `allWritten|wrongList|forgetList|annual|about|settings|backup` → push；`againList` → push wrongList；`detail:X` → push detail。
- `libSwitch` → `over=libSwitch`；`lib:NAME` → `libTarget`,`over=libConfirm`；`libConfirm`（explicit，失败就地 `libFail`）；`libStay`；`closeOver`。
- `home|library|mine` → `go`。

**单字详情（ShiziScreen，761–772）**：`back`；`rmCustom` → `confirm` → 移除 `added`（explicit）→ `ui.rm` 撤销底栏（L07）；`practiceOne` → `startB([c], detail src)`；`photo` → `over=image11,imgMode=char`（末次无笔迹不开，A05）；`image34/image11` 互切（Z01 规则 771）；`imgShare/imgSave` → `sys share/photos`；`wordFeedback` → `ui.wf` → `wfOk` → 横幅 → `wfUndo`；`schedule` → toast（说明行无页面）。

**我的 / 练习记录 / 年度 / 关于 / 设置（ShiziScreen）**：`records|annual|about|settings|backup` push；`prevMonth/nextMonth` 在 9↔8 之间；`imageToday` → `imgMode=today`；`image34/image11` → `month`；`set:sound|photoHint|large|dark|bg:N|remind`（`remind` 未问过 → `sys notify`；已拒 → 无动作）；`sysSettings` → note。

**备份与恢复（775–790）**：`export`（无有效记录不可用）→ `sys export` → `lastBackup='9-24'`,`expSig`；`restore` → `sys files(backup)` → 选备份 → `over=restoreConfirm` → `restoreOk`：`protFail` 时只出说明+`bkRetry`（10.14）；否则替换 `records/events`、清 `A/B`（explicit）→ `showUndo`；`restoreRetry`；`clearAll` → `over=clearConfirm` → `clearOk`（清 `records/events/diffs/added`、`introSeen=true`）→ `showUndo`；失败就地 `clearFail`（A10）；`clearStay`；`undo` → `undoDo`（`undoFail` 时底栏改失败文案，10.15）。

**阻断页（`storageBlock`，796–797）**：`retryStore`（`blockSim` 开着不动；`blockReal` 探测 `shizi-proto-v9-probe` 成功后回 `blockFrom`）；`howFix` → note。

**首次说明页 `onboard`（遗留）**：`restoreOnboard` → `sys files(onboard)` → `restoreFromOnboard`（回 home + 撤销底栏）；`first`。

**返回/侧滑（`edgeBack` 511–518，仅 standalone 且左边缘 <20px 起手、dx>72）**：弹层开着不响应；`w12f` 关掉；`over` → `closeOver`；写字页 → 点击 DOM 里 `aria-label="保存并返回"|"回到格子里接着写"` 的按钮；结果页 → `close`；tab 根页/阻断页不动；其余 `back()`。

---

## 3. 数据契约

### 3.1 `localStorage['shizi-proto-v9']`（proto-model:4、131–140；模板 `commit` 写入）

`SZProto.save(st)` = `JSON.stringify(st, replacer)`，`strokes` 数组打包成字串 `"x,y,w;x,y,w|x,y,w…"`（1 位小数，proto-model:125–129）；`load()` 反解，`version!==4` 或 `records` 非数组 → `{state:null, reset:'演示数据的版本对不上，已自动重置演示。'}`（137–138）；写入前 `probe()` 试写 `shizi-proto-v9-probe`（132）。

顶层 `app` 字段（`build0` proto-model:108 + 模板增补）：

| 字段 | 类型/取值 | 写入处 | 代表的真实数据 |
|---|---|---|---|
| `version` | `4` | build0 | schema 版本 |
| `userState` | USER_STATES 键 | build0 | 无（面板演示态） |
| `serial` | number，id 计数 | `session`/`wJudge` 等 `++a.serial` | id 生成器 |
| `introSeen` | boolean | homeNav 548、clearOk 786、restore 640 | 首次已进过写字页 |
| `tipSeen` | boolean | wJudge/wSkip/wState 623–631 | 首题提示已看（`first-tip` 只在 `first` 会话第 0 字且 `!tipSeen` 显示，850） |
| `view` | `{name, from?, slot?, c?, m?, sort?, filter?, fold?, find?, off?, lookup?}` | 所有导航 | 当前页面与返回栈（`from` 链） |
| `A` / `B` | Session \| null | 会话调度 | 普通/首次会话 A；「这次选的字」会话 B（D05） |
| `records[]` | Record | `wJudge`、restore/clear、seed | 有效记录（写对/写错） |
| `events[]` | Event | `wSkip`、`wSaw` | 跳过 `S` / 看过答案 `A`（不算有效记录） |
| `added[]` | string[] | `lkAdd`、`addStart`、`pickStart(add)`、`rmCustom`、`clearOk` | 自选的字 |
| `lastBackup` | `'9-1'` \| `'9-24'` \| `null` | export/restore | 上次导出日期（`""`/null = 从没导出） |
| `expSig` | string `"n:len:lastId"`（656） | export 671 | 导出时记录签名 → 备份页「和这份备份一致」（`bkMatch`，874） |
| `bkLast` | string \| null | `expireUndo` 655、export、restore/clear | 撤销失效后备份页结论句（D24/K30） |
| `library` | 库名（`LIBS` 键） | `libConfirm` | 当前字库 |
| `diffs[]` | `{sid, v:0|1|2}` | `setDiff` 803 | 难度反馈（D6 待工程确认） |
| `wordOff[]` | string[]（字） | `wfOk/wfUndo` | 词语反馈：该字不再用当前词 |
| `reminder` / `reminderDenied` | boolean | `remind()` 680 | 提醒开关 / 系统拒绝 |
| `settings` | `{sound,bg:0|1|2,photoHint,large,dark:'auto'|'light'|'dark'}`（`SET0` 267） | `set:*` | 用户设置（正式版应持久化） |
| `tool` | `{scheme,period,lamp,real,reduce,debug:{on,lo,hi,base},hintBox?}`（`TOOL0` 276） | 面板 `setTool` | **原型工具态**（不进产品） |
| `big` / `inkDemo` | boolean | build opt | 300 字演示 / 笔迹缺失样例（不进产品） |

**Session**（proto-model:80 + 模板增补）：`{id:'s'+n, kind:'first'|'ord'|'pick', src:string|View, queue:string[], i, phase:'recall'|'answer'|'trace'|'compare'|'done'|…, hints, used, saw, strokes:[[{x,y,w}]], sim:0|number|'part', line:null|'record'|'saw'|'changed', hr, lastRid, lastC, items:[{c, v:'R'|'W'|'S'|'A', rid?, at?, strokes?}], done, diff:null|number, remind?:'ask'|'on'|'denied'|'off', ended?, demoSheet?, demoFail?}`。

**Record**：`{id:'r'+n|'d'+n|'x'+n|'f'+n, c, d:'M-D', v:'R'|'W', i:当日序号(dayIdx 542 = 当日 records+events 数), help:''|'hint'|'answer', sid, strokes:[[{x,y,w}]]|null, rev?:number, ink?:'none'|'shape'}`。
**Event**：`{id:'e'+n, c, d, v:'S'|'A', i, sid}`。

### 3.2 `localStorage['shizi-proto-v9-probe']`
只写后删（proto-model:132；模板 796），代表"存储是否可用"探测。

### 3.3 IndexedDB `shizi-proto-v9-rec`（proto-model:147–159）
DB v1，store `recs`（keyPath `key`）、`writers`（keyPath `id`）；不可用退 `localStorage['shizi-proto-v9-rec']=JSON {writers:{}, recs:[]}`。录制记录（录制模式 9df10dc8…html:119–121）：`{key:'<wid>:<taskId>', task, writer, char, pass, kind?:'wrong'|'trace', input:'touch'|…, canvas:{size,dpr}, clock:'event.timeStamp', ua, strokes:[{end?, points:[{x,y,t,p?}]}|[{x,y,t}]]}`。研究数据，不进产品。

### 3.4 URL 参数（`boot` 461–472、`relayout` 487–491、`standalone` 484）
`flow`（用后 `history.replaceState` 抹掉，469）、`phone=1`（或宽 ≤500 自动）、`panel=1`、`rec=1`、`scheme=dark|light`、`sa=1`（模拟 standalone）、`vw`/`vh`/`it`（自查用：视口/顶部安全区）。

### 3.5 根组件 props（254 data-props；`bootDemo` 393–396）
`demo:string|null`（DEMOS 键；有值即静态示意模式：无 localStorage、无面板、无转场）、`demoDark`、`demoLarge`（未在 data-props 声明，只在代码读）。

### 3.6 `ui`（内存态，294 初始值 + 运行时增补）
`libFail, clearFail, imgMsg, panel, toast, failNext, blockSim, blockReal, blockView, blockFrom, sheet:{rid,fail}|{item,fail}, diffFail, notice, rec, pick, confirm:{text,yes,no?,one?,three?,mid?,ok,okMid?}, sys:{kind,from?}, undo:{l1,l2,prev,kind:'restore'|'clear',last,failed?}, undone:{v}, obNote:{text,repick}, clearArm, over, libTarget, imgMode, imgFail, bf(遗留), wf:{c,word}, wfBanner:{c,word}, note, lk:{mode:'lookup'|'add'|'pick', text, cur, unsel[], src:'home'|'library', fail?, addFail?}, rm:{c}, rmAt, noChars, noSched, w12f, noStroke, protFail, undoFail, bkNote, bkRetry, endFail`。

### 3.7 `<dc-import>` 属性契约（模板 → 组件）

**首页壳-v3（34）**：`state:'first'|'empty'|'record'`、`resume:boolean`、`resume-line:string`、`other-line:string`、`records`、`today:"9-24"`（写死）、`theme:'base'|'th1'`、`period`（tool.period）、`lamp`、`bare`、`size:'compact'|undefined`、`on-navigate(k)`。组件还声明但模板未传：`quote`、`pressed`、`entry`、`fill`（83f2f17e data-props）。

**字库墨墙屏（35 sheet-only；44 正常）**：`screen:'home'|'all'|'wrong'|'forget'`、`sheet-only:true`（仅首页叠层）、`records`、`added`、`today`、`library`、`theme:'light'|'dark'`、`lamp`、`bare`、`size`、`fixed:true`、`sort:'recent'|'py'|'age'`、`filter:''|'wrong'|'forget'|'unw'|'custom'`、`fold:Record<month,boolean>|null`、`find:string`、`off:string[]|null`、`lk`（3.6 形状）、`kb:number`（键盘高度/scale）、`on-navigate`、`on-lk-input(text)`、`on-find-input(text)`。组件声明未传：`n`、`data`、`tall`、`empty`、`tone/mark/dens`、`libCount`。

**ShiziWriteScreen（38）**：`interactive:true`、`hint-mode:'fade'|'box'`、`first-tip`、`total:number`、`on-saw`、`on-next`、`endable`（仅 pick 会话）、`on-end`、`end-fail:number`、`no-stroke`、`queue:Item[]`（`SZProto.item(c)` → `{c,py,word[],blank,gloss?,groups,fb?}`）、`init`（见下）、`theme`、`lamp`、`bare`、`size`、`debug`（叠层开关）、`tune:{lo,hi,base}`、`replay`（真人笔迹开关）、`replay-src(c)→rec|null`、`on-back`、`on-judge`、`on-skip`、`on-correct`、`on-state-change`、`on-navigate`。
`init`（851–854，组件 `fromInit` 1c6d798a:293–299 消费）：`{key:'<sid>:<wkey>'(变化即重挂), i, phase, hints, used, saw, strokes, sim, line, hr, cnt:已判断数, sheet, sheetFail, saveFail, last:{id,c,ci,verdict:'right'|'wrong',strokes?|sim:true}|{ci,c,saw:true}|null, done:[{ci,none:true}|{ci,strokes}|{ci,mode:'wrong'?}]}`。

**ShiziScreen（41 正常；47 换库叠层）**：`screen`、`theme`、`lamp`、`bare`、`size`、`settings:{…SET0, remind}`、`backup-count`（备份文件字数）、`bk-note`、`bk-match`、`bk-last`、`undo:{l1,l2}`、`fixed:true`、`records`、`today`、`added`、`last-backup`（`''`=从没导出）、`library`、`chars`（`SZProto.SAMPLES`）、`result`（见下）、`sheet:{c,v,strokes,d,fail}`、`onboard-note`、`char`（detail 的字）、`under`（弹层下的页；`'none'`=只画弹层）、`lib-target`、`img-items:[{c,d,v,strokes,ink}]`、`img-title`、`img-note`、`img-sign`、`img-fail`、`img-char:{c,d,v,py,strokes}`、`img-msg`、`img-top:true`、`lib-fail`、`clear-fail`、`bk-retry`、`on-navigate`。
`result`（860–861）：`{items:[{c,v,help?,strokes?,d?,ink?}], count, inkCount, line:{c,v,changed}|null, diff, diffFail, date, leave?:string, remind?, ended, rest, img:true}`。
组件内 `UNDER` 表（2b03a433:282）：`libSwitch/libConfirm→'none'`，`image34/image11/share→records`，`restoreConfirm/clearConfirm→backup`；模板用 `under` 覆盖。

**录制模式（50）**：`theme`、`bare`、`on-exit`、`on-saved(rec)`。

### 3.8 回调参数形状（组件 → 模板）
- `onNavigate(key:string)`：键清单见 2.3；带参键用 `:` 拼接（`lib:`、`lkSel:`、`lkPick:`、`sort:`、`filter:`、`fold:`、`sel:`、`detail:`、`set:`、`cell:`、`diff:`、`addTile:`）。
- Write `snap()`（1c6d798a:300–302）：`{i, c, phase, hints, used, saw, strokes:[[pts]], sim, line, hr}`；`onJudge({i,c,verdict:'right'|'wrong',strokes,saw?,hints?})`；`onSkip({i,c,saw,hints})`；`onSaw({i,c,hints})`；`onNext({i,c,strokes})`；`onCorrect(id,verdict)`；`onEnd(snap,confirmed)`。
- `onLkInput(text)`、`onFindInput(text)`。

### 3.9 其他全局
- `window.__szStore={data:{[c]:hanziWriterJson|null}, pend:{[c]:Promise}}`；来源 `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/<c>.json`。
- 字体：`https://cdn.jsdelivr.net/npm/lxgw-wenkai-gb-web@1.522.0/lxgwwenkaigb-regular/result.css`、`https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500`。
- `<meta name="theme-color">` 由模板随深浅色改写（816）；PWA meta 10–14。
- 主题令牌 `OV`（270–273）复制 ShiziScreen `TH`，仅供原型层弹层用；`--ubb`（撤销底栏底距）按页面算（906）。

---

## 4. 与第十稿（v10）决定的关系

| 决定 | 模板现状 | 判定 |
|---|---|---|
| D17 首次 5 字、去介绍页/首题说明卡 | `homeNav('start')` `!introSeen` 直接建 `first` 会话进写字页（548）；`QUEUES.first` 5 字（proto-model:56）；`first-tip` 仍存在（850）——是写字页内轻提示，非说明卡；`onboard` 页与 `restoreOnboard/first` 键仍在（799、865）但无入口 | **已实现**；`onboard` 相关为遗留，接入时删 |
| D18 看答案即记「看过答案」 | `wSaw` 记 event `A`、`items.push({v:'A',at})`（632）；`wNext` 只翻页（634）；`wSkip` 看过答案后记 `A` 而非 `S`（625） | **已实现** |
| D19 结果行只在未落笔时显示；修改入口移到结果页格子 | 结果行显示逻辑在写字组件（他人范围）；模板 `cell:N` → `ui.sheet`、`csFlip` 改同一 record `rev++`（788–792）；`wCorrect` 仍保留给写字页（627） | **已实现**；`wCorrect` 是否还有 UI 入口需对照写字组件 |
| D20 判断页左错右对；末字直接结果页 | `adv` 末字 `view=result` push（534）；无中间页 | **已实现**（左右在组件） |
| D21 查字/添加/自选合一；显式「加入」 | `ui.lk` 三模式；`lkAdd` 显式加入（713）；`lkGo`/`lkPractice` **不**加入自选；但 `addStart`（584）与 `pickStart(mode==='add')`（612）仍会在"开始练"时把字塞进 `added` | **主路径已实现**；`addStart/addTile:/addStay/addSheet`（709、722–724）与旧 `pick` 弹层是**与 D21 冲突的死代码**，改动清单也说"不再用" |
| D22 中途结束这组 | `wEnd/endGroup`（567–576）；三键框 `okMid` 结束旧组开新组（598–601）；提示句 `'这组结束了，没有记下字。'` 与 D22 一致 | **已实现** |
| D23 写错过/快忘了 | `SZProto.lists`（proto-model:87–90）只看最近有效记录；快忘了 = 90 天前写对、最多 12（原型模拟，正式按记忆曲线） | **规则可抽取**；90 天/12 个是占位 |
| D24 去补记；撤销常驻备份页 | 补记代码（`bf`、backfill）已删（VERSION 4，proto-model:4）；`bfRef` 引用残留（290、441）；`expireUndo` 只在离开 `backup` 时失效并写 `bkLast`（655）；`fitUndone` 处理页面变长（418） | **已实现**；`bfRef/bfOn` 残留可删 |
| D25 提示画法方案① | `tool.hintBox` → `hint-mode:'box'`（848、954） | **冲突**：方案②开关不进产品；`hint-mode` 属性可删或固定 `'fade'` |
| D05 会话隔离 | A/B 双槽；首页 B 优先（546–547）；`startB` 旧 B 未完先确认（596–603）；`restoreOk/clearOk` 直接清 `A/B`（783、786） | 已实现；替换/清空清会话是否符合"备份范围"待产品核对 |
| D06/D07 更正同一记录、保存成功才推进 | `wCorrect/csFlip` 改 `v`、`rev++` 不新增；`commit(…,true)` 失败返回 false，调用方留场（`wBack/wJudge/lkAdd/libConfirm/restoreOk/clearOk/setDiff/endGroup/startB/pickStart/addStart`） | 已实现（骨架可保留） |
| D12 首页 N | 模板只给首页壳 `state/records`，N 的展示在组件 | 无冲突 |
| 《交接备注·界面交接》"原型做法不是规格" | 克隆影子转场（428–440）、外套弹层动效（441–459）、系统示意（658–679）、面板/调试/录制、紧凑版 span 控件、查字框 focus（`focusPick` 650 只用于旧弹层） | **全部不进产品** |
| 《交接备注》十.1 数字从记录算 | `today="9-24"` 五处写死；`LIBS` 字数表；`restoreData` 固定 9 月 1 日；`sysRows` 里 `'9-24'`、`'2026-09-24'`；`imgSign` 落款硬编码 `'二〇二六年九月二十四日'`（891–893） | 接入时全部换算 |
| 《交接备注》十.3 防连点 | 结果页 0.4s（697，`_vt` 在 `commit` 视图变化时记 528）；V01 0.3s 在写字组件 | 已实现一半（仅结果页；其他"新页面/新状态"未做） |
| 《交接备注》十.7 关于页三个子页 | `about` 只有一屏，无子页导航键 | 待做 |

---

## 5. 风险与坑

1. **全量深拷贝 + 全量 JSON 写盘**：每次 `commit` `JSON.parse(JSON.stringify(app))` 再 `save`（525–527）。300 字演示下 records 达上千条、strokes 字串很长，每一笔 `wState` 都触发（629）——正式版必须改增量存储；`localStorage` 配额（~5MB）是阻断页的真实触发源。
2. **`_kind` 副通道**：转场类型通过实例字段 `this._kind` 在 `commit` 前设置、`commit` 里清空（522–525）；若 `commit` 早退（blocked/failNext）`_kind` 已被清，若 `fn` 内部再设（`adv` 534）则覆盖。任何异步/重入都会串味。
3. **DOM 探测耦合**：`edgeBack` 靠 `aria-label="保存并返回"/"回到格子里接着写"` 找按钮（514；写字组件用 `backLabel` 绑定 1c6d798a:577）；`ov('over')` 靠 `z-index==='5'&&position==='absolute'`（443）；`ov('lk')` 靠 `[data-lksheet]`；`fitUndone` 靠 `[data-bk-end]`。组件样式一改即失效。
4. **`wkey` 重挂机制**：`init.key = sid+':'+wkey`，`openWrite/startB/again/first/undoDo/resetTo` 都 `wkey++` 强制写字页重建（537、598、605、687、542）。正式版应有明确的会话 id 变化才重建，而不是靠计数器。
5. **撤销快照 `prev` 是整份 app 深拷贝**（639、782、785），恢复时把 `tool/settings/view` 覆盖回当前（686）；`undoDo` 直接 `SZProto.save(prev)` 绕过 `commit`（688）。体量与一致性都有风险；O04 明确不承诺保护副本寿命。
6. **`expireUndo` 在任何视图变化时触发**（525 调用、655）：只要 `next.view.name!=='backup'` 就把撤销作废并写 `bkLast`——包括 `set:large` 这类非导航写入？不会（view 不变则 `next.view.name==='backup'` 仍成立）；但从备份页打开 `restoreConfirm` 是 `ui.over` 不改 view，所以安全。注意 `ui.rm`（移除自选撤销）也在此清。
7. **`dayIdx` 把 records+events 当日计数当作序号 `i`**（542），`lists` 用 `i` 做同日先后（proto-model:87）——跨设备/时区的真实实现要用时间戳。
8. **`serial` 与种子 id 前缀**：种子 `d*/x*/f*/e-a*`，运行时 `r*/e*/s*`；`clearOk` 不重置 `serial`，`restoreOk` 用 `restoreData()` 的 `d*` id 但保留当前 `serial`——id 空间靠前缀区分，脆弱。
9. **`history.replaceState` 抹 `?flow`**（469）：PWA 冷启动/刷新后不会重复重置，但 `panel/rec/scheme/vw` 等参数保留；`?rec=1` 会在每次刷新进录制模式。
10. **iOS/PWA 细节**：`black-translucent` 状态栏在浅色纸上看不清（交接备注列为原型问题）；`visualViewport` 键盘高度算法（492）只在 `phone` 且无 `vh` 时生效；`gesturestart` 阻止双指缩放（403）；`touch-action:manipulation`（23）。
11. **主题决定链**：`dark = (settings.dark==='auto' ? tool.scheme : settings.dark)==='dark'`（815）——面板 `scheme` 扮演系统外观；正式版换 `prefers-color-scheme`。`theme-color` meta 每次渲染改写（816）。
12. **`realOn` 回放**：`tool.real` 开着且有录制时，写字页 `replay-src` 返回记录，组件在 `recall` 阶段自动回放（1c6d798a:355）——纯演示，勿带入产品。
13. **组件页各自重复定义 `__szStore` 加载器**（5 处），并各自插入字体 `<link>`；打包后仍联网请求 jsDelivr/Google Fonts；hanzi-writer-data 失败记 `null` 后不重试。
14. **`restoreOk/clearOk` 清 `A/B`**（783、786）会把进行中的写字会话连同 `serial` 之外的一切丢掉；首页 `resume` 行随之消失。
15. **`LEAVE` 文案与 `tabOf`**（279、691）：`src` 为字串或 View；`detail` 特例 `'回到「X」'`（861）；`allWritten` 作为 `src` 时带 `sort/filter/fold`（733）——返回时恢复筛选靠这份快照。
16. **时间日期全为 `'M-D'` 字串（无年份）**，`doy` 假设 2026 非闰年（proto-model:82）。

---

## 6. 未解问题

1. `wCorrect`（写字页内改判，627）在 D19 之后是否还有 UI 入口——需读写字组件确认；若无，模板该回调可删。
2. `onboard` 页与 `restoreOnboard/first/obNote` 一整套是否彻底废弃（D17 去掉了首次说明页，但《交接备注》未明说"从备份恢复"在首次流程里的替代入口）。
3. 结果页 `diff:N`（难度反馈，D6）、单字详情 `schedule`（D7）、`settings.photoHint`（D10 "写完提示做成图片"）三项决定表标"工程确认"，模板已按文案实现，去留未定。
4. `restoreOk/clearOk` 清空进行中会话 `A/B` 是产品要求还是原型简化（O03–O08 备份范围未定）。
5. `today` 与 `TODAY='9-24'` 写死；正式版日界线（本地时间 0 点？）与 `lists` 的 "90 天" 参数来源未定。
6. `LIBS` 四个库的字数与 `canPractice` 范围（SAMPLES+PYX 共 300 字）只是演示；正式字库来源与"演示字表以外的字能查不能练"的真实行为待字库定稿。
7. 面板"存储阻断"对应的真实条件（配额满 / 隐私模式 / WKWebView 限制）如何探测，`retryStore` 的探测键法是否够用。
8. `expSig` 只用有效记录数量+id 串长度+末 id 判断"和备份一致"，正式版签名口径（是否含 events/added/wordOff）未定。
9. 图片落款 `imgSign` 与 `imgNote` 文案在模板里硬编码（891–893），超过 80 字取字规则仍待定（《交接备注》一）。
10. 快照里 `bfRef/bfOn`、`focusPick`、`pick` 弹层、`addTile:/addStart/addSheet/addStay` 等遗留代码是否应在交接源里再清一轮，或由工程接入时直接忽略。
