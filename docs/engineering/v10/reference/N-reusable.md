# 可复用底层：PR #180 r8-foundation 模块与字体、PR #175 内容修订、fsrs6 / hanzi-writer 供应

> 读取范围：`origin/pr-180`（7d66339，基于 06e141b，唯一提交 `chore(handoff): archive r8 fonts and offline export modules`）下 `handoff/r8-foundation/**`；`origin/pr-175`（fe85323，基于 06e141b，唯一提交 `fix(content): correct reviewed prompts and mask repeated targets`）相对 `main` 的 diff；`main` 上的 `fsrs6.min.js`、`hanzi-writer.min.js`、`THIRD_PARTY_NOTICES.md`、`LEGAL_RELEASE_CHECKLIST.md`，以及 `index.html` 中对它们的调用点。两个 PR 均为 Draft、未合并（`docs/handoff/README.md:26-30`）；`main` 上没有 `handoff/` 目录。引用形式 `pr-180:module/x.mjs:12` 表示 `git show origin/pr-180:handoff/r8-foundation/module/x.mjs` 第 12 行；`index.html:N` 指当前 `main`。
>
> 本报告另外在临时目录里实际跑了 #180 的四组自测（Node v26.8.2 / Python 3.9.6）：`verify.mjs` 33/33、`r2-contract.mjs` 14/14、`fonts.mjs` 12/12、`package.py` 全部检查通过；并用 Node 把 #180 的 coverage-manifest 与当前 `deck-data.js`、`data/context-overrides.js`（main 与 #175 两版）、`data/etymology.json`、`docs/design/v10/*.md` 做了逐码点比对（数据见 §3.4）。

## 1. 概览

1. PR #180 交付的是 6 个很小的纯 ESM 文件（选字/取墨 45 行、布局 19 行、离屏渲染 69 行、旧笔锋 35 行、字体适配 11 行、字体 helper 30 行）加三份改名子集字体（ShiziKai 400、ShiziSerifSC 400/500，WOFF2 运行包共 2,280,766 B）和一组"只核查、不实施"的文档。模块只读、不碰 storage、不接页面，接口契约清晰，自测在本机全部通过。
2. 这些模块的**输入契约（逐判断记录 + 关联 attemptId 的归一化墨迹）在当前 `main` 上没有任何生产者**：`main` 只在写对时保存每字一份 `recentInk`（`index.html:1830`），没有 attemptId、没有 sessionId、错判无墨。所以 `resolveGlyphs` 现在只能在 `coverage:'unknown'` 下返回浅参考；要让它有用，必须先做逐判断存储——而该存储在 #180 文档和 `decisions.md` 里都标"暂停/待定"。这是复用这一层最大的前置依赖。
3. 字体：ShiziKai 覆盖当前 7294 字库全部目标/词/拼音/hint、7294 个 `data/*.json` 文件名、`etymology.json` 全部字符和 v10 文档中出现的全部 774 个汉字，只缺 #175 释义里用到的右双引号 `”`（U+201D）和 #175 遮字用的 `□`（U+25A1）。ShiziSerifSC 只按"固定文案 + 三条题记"做子集（759 个 CJK），不能承载题面/释义，v10 文案中有 129 个汉字不在其中。
4. PR #175 的产品逻辑很集中：`applyContextOverride` 新增 `py` / `promptHint` / `preserveCommon` / `sameContext` 四条规则，`promptHTML` 把重复目标字画成 `□`（`repeatBlank`），hint 行追加"空格里是同一个字，只写一次。"；数据从 56 条覆盖增到 384 条；并带一套把 `index.html` 卡片展开逻辑抠进 VM 跑的纯回归（`content-corpus.cjs`）。`main` 自 06e141b 以来 `index.html` 只改了一行 meta，所以移植成本极低，但分支上的文档/图标删除不是意图，不能整支 cherry-pick。
5. 供应库：`fsrs6.min.js` 是 ts-fsrs 5.2.0 UMD（全局 `FSRS`），`main` 只用 `fsrs/generatorParameters/createEmptyCard/Rating` 与实例 `next()`；`hanzi-writer.min.js` 3.7.3（全局 `HanziWriter`），只用 `create/animateStroke/animateCharacter/getCharacterData` 与自定义 `charDataLoader`。两者 MIT、SHA 已登记，直接沿用；笔顺数据 440 条补充记录的许可门仍是 BLOCKED。
6. 与 v10 的硬冲突有三处：D11（月图取月内**最后**判断）与 v10 M02（字帖用本月**第一次**笔迹）互相矛盾；v10 T06-C 要求 3:4 竖版从内区顶端排、落款紧跟，而 `layout.mjs:11` 是垂直居中；v10 A05 单字手写图片在 #180 里没有实现。另有 `selectors.keyFor` 的 `custom:<index>:<字>` 键格式已落后于 `main` 的稳定键 `custom:<字>`。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `selectors.mjs` | `pr-180:module/selectors.mjs:1-45` | 只读适配：本次/本月选字成员与顺序；按范围取"最后一次明确判断"的墨迹或回退浅参考 | `keyFor(card,index)`(L5)；`sessionSelection(roundStats,cards)`(L6-9)；`monthSelection({month,activity,reviews,cards})`(L10-18)；`resolveGlyphs({selection,scope,judgments=[],coverage='unknown'})`(L27-45)。抛 `INVALID_SCOPE`/`SESSION_ID_REQUIRED`/`INVALID_MONTH`/`INVALID_COLLECTION`(L28-31) | 无（`structuredClone`，Node 17+/现代浏览器） | **可抽取改造** | `keyFor` 生成 `custom:${index}:字`(L5)，与 `main` 的 `cardKey`=`custom:字`（`index.html:1541`）及 `canonicalCardKey`（`:1543`）不一致，`monthSelection` 对自选字会匹配失败；`resolveGlyphs` 逻辑与 D11/D18/D23 一致，可直接复用 |
| `layout.mjs` | `pr-180:module/layout.mjs:1-19` | 1080×1440 / 1080×1080 字帖网格几何 | `SIZES`(L1)；`sheetLayout(n,ratio='portrait')`(L2-18) 返回 `status:'ready'|'empty'|'pending'`；`dateTag(day)`→`"9·26"`(L19)。抛 `INVALID_COUNT`/`INVALID_RATIO`/`LAYOUT_DOES_NOT_FIT`(L3-4,9) | 无 | **可抽取改造（与 v10 决定局部冲突）** | 垂直居中 `top=72+(innerHeight-gridHeight-118)/2`(L11) 与 v10 交接备注 九.5（3:4 从顶端排）冲突；`>80` 返回 pending 符合 D12；`fixtures/layout-r1.mjs` 是 r1 几何基线，`r2-contract.mjs:33-36` 对 0..80×两比例 deepEqual，改布局须同步改夹具 |
| `render.mjs` | `pr-180:module/render.mjs:1-69` | 离屏 Canvas2D 画字帖：纸底、网格、每格墨迹或浅参考、日期角标、单行落款、−3° 小印 | `TOKENS`(L3)；`renderSheet({items,ratio,signature,referencePaths,sealImage,canvasFactory,labelFont,testLabel})`(L5-41) 返回 `{status,canvas,layout,cells,signature,textWidth,fonts,syntheticLabel}`；抛 `CANVAS_UNAVAILABLE`(L10)、`SINGLE_LINE_SIGNATURE_REQUIRED`(L32)、`SIGNATURE_TOO_LONG`(L35)、`SEAL_REQUIRED`(L37)、`REFERENCE_PATHS_MISSING`/`REFERENCE_CANVAS_UNAVAILABLE`/`REFERENCE_BOUNDS_UNAVAILABLE`(L44,48,53) | `legacy-brush.mjs`、`layout.mjs`、`Path2D`、`document`（默认工厂 L5）、hanzi-writer 路径坐标系（`translate(64,289) scale(.25,-.25)` L49,57） | **可抽取改造** | 参考字包围框用 384×384 探针 `getImageData` 逐像素扫描并按 `paths` 数组身份 WeakMap 缓存(L42-55)；墨迹按 345 单位空间投影(L60-69)；`labelFont` 默认 PingFang(L5)，接 D13 宋体需先 `requireFont` 再传入；不含 v10 A05 单字图 |
| `legacy-brush.mjs` | `pr-180:module/legacy-brush.mjs:1-35` | 逐字抽出的 c7 静态笔锋（速度宽、首尾收束、飞白、洇墨） | `paintBrushStroke(ctx,points,base,{color,detail,capabilities})`(L26-35) | `document.createElement`(L23)、`navigator`(L8)、`matchMedia`(L5) | **可直接复用（仅限重绘已存 w/v 墨迹）；与 D09/D10 新管线无关** | `main` 同名函数在 `index.html:2196-2215`，`main` 版 `paintBrushStroke`(2215) 多了点对象校验；模块头注释与 README 均声明它**不是** r8 新笔迹管线 |
| `font-adapter.mjs` | `pr-180:module/font-adapter.mjs:1-11` | 可选：取 coverage → 校验文本 → `FontFace` 加载 → `requireFont` 精确字重确认 | `loadCheckedText({family,weight,text,assetBase='/f8-assets/',coverageURL='/f8-coverage.json'})`(L2-11)；抛 `F8_FACE_NOT_IN_CONTRACT`/`F8_COVERAGE_UNAVAILABLE`/`F8_TEXT_UNSUPPORTED`/`F8_FONT_LOAD_FAILED` | `fetch`、动态 `import(assetBase+'font-loader.mjs')`(L6)、`FontFace`、`document.fonts` | **可抽取改造** | 路径写死为 `/f8-assets/`、`/f8-coverage.json`；face→文件映射写死(L3)；动态 import 需要 SW 缓存该 URL |
| `font-loader.mjs` | `pr-180:fonts/assets/font-loader.mjs:1-30` | 字体 helper：NFC、逐码点覆盖检查、拒绝残余组合符、要求 exact family/weight/style/loaded | `inspectText(manifest,family,weight,raw,{normalize=true})`→`{text,normalized,unreviewedCombining,missing:[{char,codepoint}]}`(L2-10)；`requireFont(manifest,family,weight,raw)`(L11-30) | `document.fonts.load/ready` | **可直接复用** | 字重判定：`f.weight==='normal'→'400'` 后与 `String(weight)` 严格相等(L25)，故 400 命中不能冒充 500（`tests/fonts.mjs:11`）；返回 NFC 文本，调用方须用返回值绘制(L29) |
| `fonts.css` | `pr-180:fonts/assets/fonts.css:1-4` | 3 个 `@font-face`，`font-display:block`，相对 URL | CSS family `"ShiziKai"`(400)、`"ShiziSerifSC"`(400/500) | — | **可直接复用**（路径按部署调整） | `block` 会有 FOIT；`main` 现有 `--kai` 栈以 `"Shizi Brand"`（4.2KiB 品牌子集，`index.html:20-24`）开头，需决定替换还是并存 |
| 字体二进制 | `pr-180:fonts/assets/*.{woff2,ttf}` | 改名静态子集 | WOFF2：Kai 1,782,120 B；SerifSC-Regular 179,840 B；SerifSC-Medium 181,100 B。TTF：4,059,112 / 403,988 / 404,020 B（`RUNTIME-MANIFEST.json`） | 上游 LXGW WenKai GB v1.522、Noto Serif SC 2.003-H1（`provenance/download-lock.json`） | **可直接复用（需增量补字重建）** | 缺 `”`、`□`；宋体缺独立 U+0302/U+0308（`reports/coverage.json`）；`ê̌`/`m̌` 定位缺陷（`reports/gpos-diagnosis-r2.md:45-49`） |
| `RUNTIME-MANIFEST.json` + `scripts/pack-runtime.py` + `scripts/font_package.py` | `pr-180:fonts/RUNTIME-MANIFEST.json`；`fonts/scripts/pack-runtime.py:8-27`；`fonts/scripts/font_package.py:1-70` | 两个互斥运行配置的白名单与逐字节校验复制 | `woff2-web`（9 文件 2,280,766 B）/`ttf-native`（6 文件 4,878,817 B）；`python3 pack-runtime.py --profile … --output <新目录>` | Python 3（`is_relative_to` 需 3.9+） | **可直接复用** | 输出目录必须不存在；拒绝存档清单；不能整目录复制进 App（`fonts/README.md:7-14`） |
| `coverage-manifest.json` | `pr-180:fonts/corpus/coverage-manifest.json`（123,488 B） | 三个 face 的码点白名单 | `{"ShiziKai:400":{file,codepoints:[int]},"ShiziSerifSC:400":…,"ShiziSerifSC:500":…}` | — | **可直接复用** | Kai 7,670 码点（7,496 URO + 2 ExtA `㧐㬎` + 3 ExtB+ `𠙶𬇕𬜯` + 拉丁/拼音/标点）；Serif 924 码点（759 CJK）。运行时每次 `requireFont` 前需先取到它 |
| 重建链 | `pr-180:fonts/scripts/{reproduce,build-fonts,diagnose-gpos}.py`、`requirements.txt`、`corpus/{kai,serif}-unicodes.txt` | 从锁定上游重建六份字体，比对 SHA | `python3 reproduce.py --output <dir> [--diagnose] [--source-cache]` | Python 3.12 + fonttools 4.66.0、uharfbuzz 0.56.2、brotli 1.2.0 等固定版本 | **可直接复用（补语料时必须走它）** | 2026-09-27 独立复核 10.0 s 六份 SHA 全同（`fonts/README.md:30`）；未验证下载分支 |
| 许可材料 | `pr-180:fonts/licenses/{COPYRIGHT-NOTICES.md,LXGW-WenKai-GB-OFL.txt,Noto-Serif-SC-OFL.txt}` | 改名说明与两份完整 OFL | 随任一运行配置一并分发 | — | **可直接复用** | 注意 GB v1.522 的 OFL 未显式列 RFN，与 `THIRD_PARTY_NOTICES.md:104-115` 里非 GB 版 WenKai 的 RFN 声明是两个版本（`COPYRIGHT-NOTICES.md:14`）；仍全面改名 |
| 测试 | `pr-180:tests/verify.mjs`(48 行)、`tests/r2-contract.mjs`(99 行)、`tests/fonts.mjs`(21 行)、`tests/package.py` | 选择/布局 33 项；r2 契约 14 项（含毒化 `document`/`Path2D` 的 pending 无分配测试）；字体桩 12 项；包清单/源码/链接检查 | `node tests/*.mjs`、`python3 tests/package.py`，结果写 stdout | Node 22+（README:17）；实测 v26.8.2 通过 | **可直接复用** | Canvas/FontFaceSet 都是观察桩，不代表像素或真机 |
| 夹具与资产 | `pr-180:fixtures/artificial.json`（27,196 B）、`fixtures/layout-r1.mjs`、`assets/zi-seal-sheet.svg`（9,528 B） | 人工判断/墨迹夹具；r1 几何基线；样章 | — | — | 夹具可复用；样章需设计确认（v10 交接备注 八.4 提到 `assets/zi-seal-sheet.svg` 轮廓取自文楷 GB） | `artificial.json` 头部声明"全是人工数据、只有五个手写字形" |
| 核查文档 | `pr-180:docs/{api,data-audit,ink-comparison,replay-field-gaps,future-ink-storage-proposal,status}.md` | 接口说明；c7 数据链核查与首页 N 方案；新旧笔迹公式对照与估时；回放字段缺口；逐判断存储提案（暂停）；状态表 | — | 行号全部指向 c7c8fc2 候选（**不在本仓库历史中**，`git cat-file` 找不到） | **作为设计输入可用；不能当实现** | `data-audit.md:47` 记录 c7 是 7314 字，`main` 是 7294（少 20 字，`docs/handoff/evidence.md:7`） |
| PR #175 `applyContextOverride` | `pr-175:index.html`（对应 `main index.html:1042-1050`） | 覆盖表 → 卡片：`boost`/`w+ci`/`gloss`/`py`/`promptHint`/`preserveCommon`/`sameContext` | 无导出；结果进 `CARDS[]`，新增 card 字段 `promptHint`（仅非空时展开）、`py` 被覆盖 | `CONTEXT_OVERRIDES` 全局 | **可直接复用（原样移植）** | 详见 §3.5 |
| PR #175 `promptHTML` + hint 行 | `pr-175:index.html`（对应 `main :2401` 与 `:2498`） | 重复目标字画 `□`（`.blank.repeatBlank`，`role="img" aria-label="同一目标字的另一处空格"`）；hint 行拼接"空格里是同一个字，只写一次。" | DOM：`#prompt` 加 `role="group" aria-label="题目" aria-describedby="hint"`；`#hint` 加 `aria-live="polite"`；CSS `#prompt .repeatBlank{color:var(--muted);border-color:var(--line)}` | `--sans` 字体栈（`.blank` 用 `var(--sans)`，`index.html:132-133`） | **可直接复用**（v10 写字页题面结构若重做，需保留同等语义） | v10 文档中没有出现"只写一次"/`□`/promptHint 的任何字样（grep 为空），题面细节以 D16 为准 |
| PR #175 `data/context-overrides.js` | `pr-175:data/context-overrides.js`（389 行 29,119 B；main 61 行 3,141 B） | 384 条覆盖（main 56 条） | 全局 `const CONTEXT_OVERRIDES` | — | **可直接复用** | 字段计数：`w` 287、`gloss` 87、`boost` 14、`py` 340、`promptHint` 170（其中 33 条为空串）、`preserveCommon` 1（嗄）；`?v=` 是文件 sha256 前 12 位（`368205b7c784`；main `11516601699b`） |
| PR #175 `scripts/content-corpus.cjs` | `pr-175:scripts/content-corpus.cjs:1-95` | 从 `index.html` 抠出 `const CARDS=[];`…`// ---- 本地存储 ----` 之间的纯展开代码 + `promptHTML`/`cardKey`/hint 行/`LIBRARIES`，在 `vm` 里跑，导出每卡 `promptHTML/visibleHint/blankPrompt/libraries/contentHint/instruction` | `loadCorpus(root,{sourcePatches,overrides})`、`originalOverrides`、`reviewedOverrides(legacy,approval)`、`protectedCardData`、`identity`、`issues`、`promptSignature`、`sha256` | `deck-data.js`、`data/context-overrides.js`、`index.html` 的行级结构（正则 L26-33） | **可抽取改造** | 强耦合 `index.html` 单行函数格式与两处字符串锚点；v10 若把卡片展开拆成模块，需要改这里的取源方式并保持同一断言 |
| PR #175 `verify_content_corpus.cjs` / `verify_content_ui.cjs` | `pr-175:scripts/verify_content_corpus.cjs:1-92`；`scripts/verify_content_ui.cjs:1-95` | 纯回归（deck SHA、7294 卡、身份 SHA、受保护字段 SHA、340 条批准逐项、拼音正则、遮字/hint 组合、泄题 0、冲突只剩 fallback 954）；Playwright 真渲染（约 450 卡 render/reveal、aria、320×568 大字、注入、自选重复字） | `pnpm verify:content`；`verifyContentUI(browser,{appUrl,outputDir})` 被 `verify_8105_app.js` 调用 | Node、Playwright 1.62、Chrome 路径 | **可直接复用（随主干断言更新）** | `verify_content_ui.cjs:24-31` 直接改全局 `activeMode/baseTargets/render()` 等，v10 重写流程后这些钩子会失效 |
| PR #175 夹具 | `pr-175:scripts/fixtures/content-quality-approved.json`（366 行）、`content-quality-baseline.json`（127 行） | 340 条批准（round 114+7+219），每条 `{cardKey,target,round,decision,override,expected,reason,sources,review}`；基线 `{sourceCommit:06e141b,cardCount:7294,deckSha256:3ac0637e…,identitySha256,protectedCardDataSha256,originalRepeatedTargets(109),issueCounts{leaks:109,wordCollisionGroups:34,wordCollisionCards:69,allCollisionGroups:260,fallback:954}}` | 依赖 `main` 已有 `scripts/fixtures/context-overrides-approved.json`（legacy 56 条） | **可直接复用** | override 形状：`ci+py+w` 116、`ci+promptHint+py+w` 170、`gloss+py` 53、`gloss+preserveCommon+py` 1；`expected.ctx`：override 155 / dict 131 / gloss 54 |
| `fsrs6.min.js` | `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/fsrs6.min.js`（26,144 B） | ts-fsrs 5.2.0 UMD，`FSRS-6.0` 调度 | 全局 `FSRS`（UMD：`exports`/AMD/`globalThis.FSRS`）。导出：`fsrs, FSRS, generatorParameters, createEmptyCard, Rating, State, Grades, TypeConvert, FSRSAlgorithm, AbstractScheduler, BasicLearningStepsStrategy, DefaultInitSeedStrategy, GenSeedStrategyWithCardId, StrategyMode, FSRSVersion, FSRS5_DEFAULT_DECAY, FSRS6_DEFAULT_DECAY, CLAMP_PARAMETERS, W17_W18_Ceiling, S_MIN, S_MAX, INIT_S_MAX, default_w, default_request_retention, default_maximum_interval, default_enable_fuzz, default_enable_short_term, default_learning_steps, default_relearning_steps, checkParameters, clipParameters, migrateParameters, computeDecayFactor, forgetting_curve, get_fuzz_range, clamp, date_diff, date_scheduler, dateDiffInDays, fixDate, fixRating, fixState, formatDate, show_diff_message, ConvertStepUnitToMinutes`（文件尾部） | 无 | **reuse as-is** | `main` 用法：`FSRS.fsrs(FSRS.generatorParameters({request_retention:.9,maximum_interval:365,enable_fuzz:true,enable_short_term:true,learning_steps:[],relearning_steps:[]}))`（`index.html:1204`）、`FSRS.createEmptyCard(new Date(now))`（:1212）、`FSRS.Rating.Good/Again` 与 `fsrsEngine.next(card,new Date(now),grade)`→`{card,log}`（:1228） |
| `hanzi-writer.min.js` | `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/hanzi-writer.min.js`（36,968 B） | Hanzi Writer v3.7.3 | 全局 `var HanziWriter`。`main` 用：`HanziWriter.create(el,char,{width,height,padding,showCharacter,showOutline,strokeColor,outlineColor,strokeAnimationSpeed,delayBetweenStrokes,charDataLoader,onLoadCharDataSuccess,onLoadCharDataError})`（`index.html:2004,2235,2462-2466,2619-2620`）；`writer.animateStroke(i,{})`（:2474,2566）；`w.animateCharacter({onComplete})`（:2003-2004,2622）；`next.getCharacterData()`（:2236） | `data/<字>.json`（`charLoader`，`index.html:2271-2274`），7294 个文件 | **reuse as-is** | `render.mjs` 的 `referencePaths[char]` 就是 hanzi-writer-data 的 `strokes` SVG 路径数组（1024 单位、y 向上，L49/57 的 `translate(64,289) scale(.25,-.25)`）；D25 提示按笔顺画需要同一数据的 `medians` |
| 许可登记 | `THIRD_PARTY_NOTICES.md:1-205`；`LEGAL_RELEASE_CHECKLIST.md:1-23` | 第三方声明与发布门 | — | — | **需补充** | 见 §5.6 |

## 3. 数据契约

### 3.1 `resolveGlyphs` 的判断记录（`pr-180:module/selectors.mjs:36-43`，`docs/api.md:9-18`）

```js
// 每条判断
{ id: string(非空),          // 判断/尝试身份；ink.attemptId 必须严格等于它 (L22)
  char: string,              // 与 selection[i].char 匹配 (L36)
  sessionId: string(非空),   // scope.kind==='session' 时按它过滤 (L19,38)
  localDay: 'YYYY-MM-DD',    // 真实日历日（UTC 回读校验，L4,39）；scope.kind==='month' 时 startsWith(month+'-')
  at: number(有限,≥0),       // 排序主键，降序 (L39-40)
  sequence: 安全整数(≥0),    // 同 at 时的次键 (L40)；at 与 sequence 都相同 → 'ambiguous-last-judgment' (L41)
  explicit: true,            // 非 true 一律不算判断 (L36)
  judgment: 'correct'|'wrong', // 其他值（help/trace/…）不算 (L36)
  ink: { attemptId, coordinateSpace:'normalized-0-1',
         strokes: [[{x∈[0,1], y∈[0,1], w?∈(0,1.7], v?}], …] } | null }
```

`coverage` 只有 `'complete'` 才会查判断；默认 `'unknown'` 全部返回 `{source:'reference',reason:'history-not-proven-complete'}`（L34-35）。返回条目：`{...selectionItem, source:'reference'|'handwriting', reason:null|<原因>, judgmentDate, attemptId, judgment?, ink?}`；原因枚举：`history-not-proven-complete`、`no-judgment-in-scope`、`missing-judgment-identity`、`invalid-ordering`、`ambiguous-last-judgment`、`missing-or-unlinked-ink`、`unsupported-or-empty-ink`、`invalid-ink`。`selection` 条目可带 `displayTag`/`displayDate`（角标）与 `key`；渲染器不从 `judgmentDate` 生成角标（`api.md:18`，`render.mjs:23`）。

### 3.2 选字输入（`selectors.mjs:6-18`）

- `sessionSelection(roundStats,cards)`：`roundStats[i].idx` → `cards[idx].target`，保留顺序，不过滤结果。`main` 的 `roundStats` 元素见 `index.html:1832`（`{idx,target,word,outcome,uncertain,geometryStatus,geometryMode,traced,hintUsed,level,topic,dueDay,independentlyRecovered}`）。
- `monthSelection`：`activity.practiceDays[]`（`YYYY-MM-DD`）、`activity.daily[day].targetKeys[]`/`independentTargetKeys[]`、`reviews[]`（`{rating:'Good',cardKey,localDay}` 即 `shizi.fsrsReviewLog.v1` 事件）。顺序：日升序 → 当日 targetKeys 首见序 → 独立键与当月 Good 事件补入。`main` 的对应实现 `monthReportData`（`index.html:1936-1942`）另外还读 `activity.monthly[month].targetKeys`（归档月），模块没有这一路。

### 3.3 布局/渲染输出（`layout.mjs:16-17`，`render.mjs:30,40`）

- `sheetLayout` ready：`{status,n,width,height,margin:72,innerWidth:936,innerHeight(1296|936),columns(5..10),rows,cell=936/columns,gridHeight,top,footerTop=top+gridHeight+40,footerHeight:78,dateFont(33|24),dateLine(39|27),dateTop(9|6),dateLeft(12|9),inkScale=min(.78,(cell-dateTop-dateLine-3)/(.84*cell)),inkDx=min(9,cell*.05),inkDy,cells:[{x,y,empty}]}`；列数规则：从 5 起，`ceil(n/c)*(936/c)+118 > innerHeight` 就加一列，最多 10（L8）；`small = cell<126`（L12）。样例（`tests/verify.mjs:19-21`）：square 49/56 → 9 列；portrait 26 → cell 187.2、角标 33px；80 → cell 117、角标 24px。
- pending：`{status:'pending',reason:'OVER_80_POLICY_PENDING',n,ratio,width,height,margin,innerWidth,innerHeight,columns:0,rows:0,cells:[]}`（L6）；render 返 `{status:'pending',reason,n,ratio,canvas:null,layout,cells:[]}`，不读 items、不分配画布（`r2-contract.mjs:43-52` 用 Proxy 与毒化 `document` 证明）。
- render cell：`{index,char,source,attemptId,reason,judgmentDate,tag,bounds:{x,y,width,height},dateBottom,rendered:'reference-paths'|'candidate-paintBrushStroke',referenceBoundsMeasured?|widthFallback?,pointCount?}`（L30,58,68）。
- 颜色 `TOKENS`：纸 `#FBF8F2`、墨 `#3B2F28`、浅参考 `#B3AC9F`、落款 `#5D5952`、角标红 `#A6533F`、格线 `rgba(166,83,63,.28)`（L3）。落款 26px、字距 26×.16、最大宽 822px（L33-35）；印章 78×78、右下 `(1008-39, footerTop+39)`、旋 −3°（L38）。

### 3.4 字体覆盖清单与实测差额

`coverage-manifest.json`：`"ShiziKai:400"` 7,670 码点；`"ShiziSerifSC:400"`/`":500"` 各 924 码点。`reports/coverage.json`：Kai required 7,669 全覆盖；Serif required 925，923 直接映射，缺 U+0302、U+0308（独立组合符）。本次逐码点比对（NFC 后）：

| 文本集合 | ShiziKai 缺 | ShiziSerifSC 400 缺 |
| --- | --- | --- |
| `main deck-data.js` 7294 目标字 / `ans` 词 / `py` / `hint` | 0 / 0 / 0 / 0 | — / 6,558 字 / 0 / 3（频挑战） |
| `data/*.json` 7294 个文件名 | 0 | — |
| `data/etymology.json` 全部非 ASCII 字符 | 0 | — |
| #175 `context-overrides.js` 全部文本（键+w+gloss+py+promptHint） | 1：`”`（U+201D） | 810 |
| `main` 现有 56 条覆盖文本 | 0 | — |
| `docs/design/v10/*.md` 出现的 774 个汉字 | 0 | 129（例：墙 师 付 具 流 址 场 探 证 员 …） |
| 单字符：`□` U+25A1 / `“` / `”` / `‘’` / `·` / `？` | `□` 缺、`“` 有、`”` 缺、`‘’` 缺、`·` 有、`？` 有 | `□` 缺、`·` 有、`？` 有 |

deck `py` 与 #175 文本 NFC 后**没有**残余组合符（`inspectText` 不会因此拒绝）。Kai 语料按 c7 的 7,314 字构建，是当前 7,294 字的超集（`README.md:38`、`data-audit.md:47`）。

### 3.5 PR #175 覆盖表与卡片字段（`pr-175:index.html` 对应 `main index.html:1042-1050`）

```js
CONTEXT_OVERRIDES[target] = { boost?:true, w?:string, ci?:int, gloss?:string, py?:string, promptHint?:string, preserveCommon?:true }
```

处理顺序（新版 `applyContextOverride`）：① `boost` → `common=max(common,1.2)`；② `w`：`Array.from(w)[ci]!==target` 则整条作废返回原行；`sameContext = source.ans===w && source.ci===ci`，为真时**不**改 `ctx`（保持原 `dict`），否则 `ctx='override'`；③ 否则 `gloss`：`ans=target, ci=0, ctx='gloss', hint=gloss`，且除非 `preserveCommon===true`，`common=max(common,1)`；④ `py` 为非空字符串时 `row.py=py.trim()`；⑤ `promptHint` 为字符串时 `row.promptHint=promptHint.trim()`（可为空串）；⑥ 展开 `meta` 时仅当 `w.promptHint` 真值才写入卡片。卡片新增/改动字段：`py`（覆盖后读音）、`promptHint`。`cardKey` 不变（`base:<字>`，340 条 `expected` 全部为 `base:`）。

题面与 hint（对应 `main :2401`、`:2498`）：`promptHTML` 对 `i===ci` 画 `<span class="blank">${py||"？"}</span>`，对 `ch===target && i!==ci` 画 `<span class="blank repeatBlank" role="img" aria-label="同一目标字的另一处空格">□</span>`，其余 `<span class="given">ch</span>`；hint = `[custom?hint : gloss?hint : promptHint || fallback文案 || calibrate文案, 重复目标字数>1 ? "空格里是同一个字，只写一次。" : ""].filter(Boolean).join(" ")`。`verify_content_corpus.cjs:48-55` 断言 `promptHTML` 中 `class="blank"` 恰 1 个、`blank(?: repeatBlank)?` 数等于重复数、不含目标字。

### 3.6 `main` 现有墨迹/记录形状（对照 3.1 的差距）

- 现场点：`P(e)` → `{x,y(S 坐标),t(event.timeStamp),p(pen 压力，非 pen 为 0)}`（`index.html:2195`）；`inkBegin/inkMove` 只存 `{x,y,t,w,v}`，`p` 丢失（:2288-2289）；`inkEnd` 只保留 ≥2 点的笔（:2290-2294）。
- 分享中间态 `shareInkFromSnapshot`：前 48 笔、每笔最多 48 点、`x/y` 归一化三位小数、`w∈[.35,1.7]`、`v∈[0,6]`，无 `t/p`（:1801-1803）。
- 持久 `memory[key].recentInk = {version:2, day, at, dataURL(120×120 WebP q.68 ≤32KiB), strokes(前 36 笔×24 点, x/y 三位, w/v 两位)}`（:1804,1807-1809）；仅在 `!hard`（写对）时写入（:1830）；`RECENT_INK_MAX=96`、`RECENT_INK_BUDGET=420KiB`（:1144）。**没有 attemptId/sessionId，没有错判墨迹。**
- 会话内 `episodes[idx].attempts[] = {attemptId,seq,outcome,userCorrect,uncertain,hintUsed,hintCount,enteredTracing,teaching,eventId,at}`（:1832）——只随 `shizi.session.v1` 存活。
- FSRS 事件（`shizi.fsrsReviewLog.v1`，`{version:2,events,monthly}`）：`{attemptId,eventId=attemptId+':fsrs',cardKey,target,reviewedAt,localDay,rating:'Good'|'Again',reason:'independent'|'wrong'|'hinted'|'dontKnow',…,scheduledDays,schedulerVersion:'ts-fsrs 5.2.0 / FSRS-6.0',parameterVersion:'fsrs6-fuzz-365-v2',desiredRetention:.9,maximumInterval:365,timeZone}`（:1203,1224-1235）；120 天后压成月汇总（:1205-1209）。
- 备份 `BACKUP_KEYS` 21 个 localStorage 键（:2988）；无 IndexedDB。

### 3.7 供应库版本指纹

- `fsrs6.min.js`：ts-fsrs 5.2.0，SHA-256 `368942939646b0c58b6db89e3f92b036d2101e85a5194f07d7df6fdd5ed157f4`（`THIRD_PARTY_NOTICES.md:71`）；`hanzi-writer.min.js`：3.7.3，SHA-256 `17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642`（:9）；笔顺数据 hanzi-writer-data 2.0.1（6,854）+ 440 条补充（:17-27）。
- 字体 SHA（`RUNTIME-MANIFEST.json`）：Kai woff2 `e98fc925…9c02`、SerifSC-Regular woff2 `f6f4e048…3d1c`、SerifSC-Medium woff2 `d33c8e38…8ccf`。

## 4. 与第十稿（v10）决定的关系

| 决定 | 本范围内的现状 | 结论 |
| --- | --- | --- |
| **D09 / D10**（新笔迹管线：点画、30ms 尾速、压力替代速度） | `legacy-brush.mjs` 是 c7 旧公式（速度宽 `base×(1.34−.74×min(1,v/1.8))`、EMA .62/.38、固定 head/tail），`ink-comparison.md:13-27` 逐项列出与规格差距，`README.md:36` 明言"没有实现" | **保留仅用于重绘历史 w/v 墨迹**；实时书写和 D25 提示画法都要新写，不得复用它冒充新管线 |
| **D11**（本次图沿选字成员/顺序、同字取最后明确判断；月图取月内最后判断；末次缺墨用浅参考） | `resolveGlyphs` 精确实现（`selectors.mjs:36-43`，`verify.mjs:23-33` 覆盖"后错胜前对""末次缺墨不回填""跨月只取月内末次"） | **可直接复用**——但见下一行 |
| **v10 M02**（`04-v10-handoff.md:50`：字帖格子用"这个月**第一次**写这个字那一次的笔迹"） | 与 D11"月图取月内**最后**判断"直接矛盾；`decisions.md` 未标记 D11 被覆盖 | **冲突，需产品裁决**；技术上给 `resolveGlyphs` 加 `pick:'last'|'first'` 参数即可 |
| **D12**（N>8 显示 8 项；>80 返回 pending，不截字） | `layout.mjs:6` / `render.mjs:7` 实现 pending；`main` 的 `renderMonthlyPostCanvas` 仍 `slice(0,80)`（`index.html:1947`）且只有 3:4；首页 N 只有 `data-audit.md:41-45` 的 `{day,N,items,status,gaps}` 方案 | 用模块替换 `main` 导出；首页 N 契约需新实现 |
| **v10 交接备注 九.5 / T06-C**（3:4 从内区顶端排，落款紧跟最后一行下 40px；1:1 不变） | `layout.mjs:11` 两种比例都垂直居中；备注称"和工程现有的独立导出模块一致"并不准确（仅落款间距 40 一致） | **改造**：portrait 分支 `top=72`；同步更新 `fixtures/layout-r1.mjs` 与 `r2-contract.mjs:33-36` 的 deepEqual |
| **v10 交接备注 九.4 / A05**（单字手写图片：1080×1440/1080×1080、72px 留白、不画格、按墨迹外框缩到画面宽 60%、下方"jìng · 9 月 22 日"、右下落款+小印；最近一次无墨就不生成） | #180 没有单字渲染器；`render.mjs` 必画网格并强制落款/印章 | **新增**一个 `renderSingleGlyph`，复用 `drawInk`/`drawReference`/`TOKENS`/落款印章代码 |
| **D13**（ShiziKai / ShiziSerifSC 400/500；精确字重加载；许可随包；旧语料不自动覆盖 #175） | 字体、`fonts.css`、`font-loader.requireFont` 精确字重、两份 OFL 与改名说明齐备；#175 差 `”`；v10 备注 八.4 要求子集覆盖 7294 + 语境词 + 释义 + 字源用字 → Kai 已满足（除 `”`、`□`），Serif 需按 v10 句库/文案重做（`交接备注:135` "句库一改，宋体子集要一起重做"） | 复用，但**至少补 U+201D/U+25A1 后走 `reproduce.py` 重建**并重出 manifest/SHA |
| **D14 / D15**（历史缺 t/p 如实报告；无正式用户，兼容不是硬约束） | `replay-field-gaps.md` 与 `future-ink-storage-proposal.md`（"暂停"）说明现有链路 p 丢失、t 不入库；D15 允许直接换新存储 | 允许以 3.1 契约为目标设计新的逐判断存储（`decisions.md` 待定表："新逐判断存储、容量/保留/淘汰政策"），但需产品定保留策略 |
| **D16**（340 张修订；重复目标字全遮，原位拼音，其余 `□`；必要时可见消歧线索） | 即 #175 全部内容 | **直接移植**（§5.4 步骤） |
| **D18**（看答案记"看过答案"，不算对错） | `resolveGlyphs` 只认 `explicit===true && judgment∈{correct,wrong}`（L36），`verify.mjs:28` 明确排除 trace/help | 兼容：新存储把"看过答案"记为 `explicit:false` 或 `judgment:'seen-answer'` 即自动排除 |
| **D19 / D06**（更正更新同一记录、不增加次数） | 同一 `id` 更新 `judgment` 即可；但 `at/sequence` 若被改写会影响"最后判断"的选取 | 需约定：更正只改 `judgment`，不改 `at/sequence/localDay` |
| **D23**（写错过只看最近一次有效记录；跳过/看答案不算有效） | `resolveGlyphs` 的"范围内最后明确判断"排序（`at` 降序、`sequence` 次键、歧义显式报告）正是同一规则 | 可抽出 `lastExplicitJudgment(rows)` 复用于写错过/快忘了清单 |
| **v10 K28 / L05 / 10.12**（写错的字墙上显示楷体+红点、清单右侧显示"那次笔迹"小图；有记录无墨迹的状态） | `main` 只在写对时保存墨迹（`index.html:1830`），错判墨迹从未持久化；`recentInk` 无 attemptId | 无新存储则 L05 的"那次笔迹"无法提供；`resolveGlyphs` 的 reason 枚举可直接映射 10.12 的缺墨状态文案 |
| **D25**（提示：本人笔迹变浅 35%，细暖墨红按笔顺画在书写格） | 不在 #180 范围；依赖 hanzi-writer-data `medians`（`data/<字>.json`）与 `HanziWriter.create/animateStroke` 或自绘 | 供应库沿用；不复用 legacy-brush |
| **D17 / D20 / D21 / D22 / D24** | 与本范围无关（流程/清单/备份） | — |

## 5. 风险与坑

### 5.1 模块层
1. **键格式陈旧**：`selectors.keyFor` 产出 `custom:<index>:<字>`（`selectors.mjs:5`），`main` 已迁移为稳定键 `custom:<字>`（`index.html:1541,1543`，`storedCardKey` 只接受 `^(?:base|custom|legacy):`，:1189）。`monthSelection` 用 `cards.findIndex(keyFor===key)` 反查（L17），自选字全部匹配不到。移植时把 `keyFor` 改成 `main` 的 `cardKey` 语义。
2. **`monthSelection` 少读归档月**：`main` 的 `monthReportData` 合并 `activity.monthly[month].targetKeys/independentTargetKeys`（`index.html:1936`），模块没有；120 天后压缩的 FSRS 事件也不在 `reviews` 里。
3. **无生产者**：`coverage:'complete'` 只能由"可靠逐判断快照"证明（`data-audit.md:35`）；`main` 现有 `recentInk`/`roundHandwriting` 均无 `attemptId`，`resolveGlyphs:22` 的严格相等会全部回退到浅参考。逐判断存储是这一层从"接口契约"变成"能用"的唯一路径，但被 `future-ink-storage-proposal.md:3,7` 标为暂停。
4. **DOM 依赖残留**：`legacy-brush.brushStrokeLayer` 用 `document.createElement`（L23），`brushDetailEnabled` 读 `navigator`（L8）、`matchMedia`（L5）；`render.mjs` 默认工厂也用 `document`（L5）。只有全参考字（无手写）路径经 `r2-contract.mjs:76-81` 证明可在无 `document` 下运行；含手写的字帖不能进 Worker（`api.md:29`）。
5. **内存**：`brushStrokeLayer` 为目标画布建同尺寸临时层并按画布 WeakMap 缓存（L22-24），1080×1440 RGBA ≈ 6.2 MB；每格 `paintBrushStroke` 都会 `clearRect` 全层再合成（L24-25,33），80 格即 80 次全幅合成。
6. **参考字测量成本与缓存键**：`drawReference` 对每个新 `paths` 数组建 384×384 探针并逐像素扫 147,456 像素（L47-52），缓存按数组**身份**（WeakMap，L42,54）；若每次导出都 `fetch` 新 JSON，缓存永不命中。字形触到探针边界会抛 `REFERENCE_BOUNDS_UNAVAILABLE`（L53）。
7. **Canvas 不等字体**：`renderSheet` 用 `ctx.font` 直接写落款/角标（L29,33,39），不会等待字体加载；接 D13 宋体前必须先 `await requireFont(...)`，否则落到 `labelFont` 回退栈。
8. **LAYOUT_DOES_NOT_FIT 实际不可达**：n≤80 在两比例下 10 列都能放下（square 80：`8×93.6+118=866.8≤936`），但代码保留了该分支（L9）。
9. **改布局会撞夹具**：`r2-contract.mjs:33-36` 对 `fixtures/layout-r1.mjs` 做 0..80×2 的 deepEqual；实现 T06-C 顶对齐时要有意识地更新 r1 夹具，而不是删测试。
10. **文档行号不可追溯**：#180 的 docs 全部引用候选 `c7c8fc2`，该提交不在本仓库任何分支（`git cat-file` 失败）；对应函数在 `main` 的位置见 §3.6（如 `paintBrushStroke` :2215、`persistRecentInk` :1807、`renderMonthlyPostCanvas` :1943）。

### 5.2 字体层
11. **`”` 缺失**：#175 有 57 条 `promptHint`/`gloss` 形如"（右边是“享”）"，`“` 在 Kai 里、`”` 不在（U+201C 在 codepoints，U+201D 不在）。若题面/hint 用 `--kai`，右引号会掉到系统字体。`□` 同理（当前 `.blank` 用 `--sans` 所以暂无影响，`index.html:132-133`）。
12. **Serif 用途极窄**：759 个 CJK 只覆盖固定文案与三条题记；v10 文案 129 字不在其中（含"墨墙"的"墙"）；`requireFont` 会直接抛 `F8 missing glyphs`，不会静默回退（`font-loader.mjs:14`）。v10 备注 八.6 的题记轮换 `{上句,下句,出处}` 一改就要重建。
13. **组合符**：Serif 缺独立 U+0302/U+0308；`ê̌` 双调号与 `m̌` 定位有缺陷且"恢复空 mark 特性也修不了"（`gpos-diagnosis-r2.md:45-49`）；`requireFont` 对 NFC 后任何 `\p{M}` 直接拒绝（L15），所以 `ê̌`、`m̌`、`ǹ` 之外的非预组合拼音都会被拒。deck `py` 与 #175 文本目前 NFC 后无残余组合符。
14. **加载体验**：`fonts.css` 用 `font-display:block`（FOIT）；Kai WOFF2 1.78 MB 要进 SW `SHELL`（`sw.js:14-15` 安装时原子写入）和 iOS 同步脚本（`ios/ShiziApp/scripts/sync-web-assets.sh:10-22` 是显式白名单，需加字体目录）；`coverage-manifest.json` 123 KB 也必须先取到才能 `requireFont`。`font-adapter.mjs` 的 `/f8-assets/`、`/f8-coverage.json` 绝对路径与 GitHub Pages 子路径部署不兼容，且动态 `import()` 的 URL 需在 SW 里可缓存。
15. **两套楷体并存**：`main` 内嵌的 `"Shizi Brand"`（LXGW WenKai **非** GB，4,264 B，`index.html:20-24`；`THIRD_PARTY_NOTICES.md:95-115` 含 RFN 与网页分发附加许可）与 ShiziKai（GB v1.522）是不同上游文件；替换/并存需一并更新 `--kai` 栈和第三方声明。
16. **Safari/WKWebView 未验**：Chrome 153 的 7/7 是用户口头确认（`README.md:34`、`evidence.md:33`）。
17. **重建环境**：`fonts/README.md:20` 要 Python 3.12 + 固定依赖（fonttools 4.66.0、uharfbuzz 0.56.2…）；本机默认 3.9.6 只跑通了 `package.py`。

### 5.3 PR #175 移植
18. **不能整支 cherry-pick**：`git diff --stat main origin/pr-175` 里 `docs/**` 11 个文件、`icon-512-maskable.png`、`ios/.../Icon-1024-dark|tinted.png`、`scripts/generate_app_icons.*` 的删除以及 `manifest.webmanifest`/`sw.js SHELL`/`sync-web-assets.sh` 去掉 maskable 图标，都是分支基于 06e141b 的历史差，不是意图（#174/#177 已合入 main）。
19. **`content-corpus.cjs` 的正则耦合**：`loadCorpus` 靶定 `index.html` 中 `"const CARDS=[];"`→`"// ---- 本地存储 ----"` 区间、`^function promptHTML(c){…}$`、`^function cardKey(i){…}$`、`$("hint").textContent=(…)`、`"const LIBRARIES=["`→`"function defaultLibraryId()"`（L23-33），并禁止区间内出现 `localStorage|document\.|window\.|fetch\(`（L27）。v10 若拆分 `index.html`，这套门禁会立即失效；正确做法是把卡片展开抽成纯模块并让测试 import 它。
20. **基线 SHA 锁死**：`verify_content_corpus.cjs:14-22` 断言 `deck-data.js` sha256 = `3ac0637e…`、`identitySha256`、`protectedCardDataSha256`；任何题库再生成（例如 v10 待定的"样本字拼音和释义"）都要重算 `content-quality-baseline.json`。
21. **`sameContext` 语义**：135 条 `w` 覆盖与原词相同 → `ctx` 保持 `dict`（夹具 `expected.ctx` 有 131 条 `dict`）；若移植时"顺手"统一成 `override`，340 条逐项断言会失败。
22. **`?v=` 指纹**：`context-overrides.js?v=` 是文件 sha256 前 12 位（#175 `368205b7c784`），`verify_pwa_upgrade.js:49,95,102` 会核对 `index.html` 与 `sw.js` 的一致性及文件 SHA；移植后需重算并同步 `sw.js BUILD`、`index.html` `shizi-asset-build` meta。
23. **UI 测试钩子**：`verify_content_ui.cjs:24-31` 直接写全局 `activeMode/baseTargets/batch/baseCursor/pos/currentIndex/episodes/roundStats/unresolved/manualQueue/practicePhase/...` 后调 `render()`；v10 流程重写后这些名字多半不存在。
24. **推荐移植步骤**（main 自 06e141b 对 `index.html` 只改了 meta 一行，`git diff 06e141b main -- index.html` 仅 1 个 hunk）：`git checkout origin/pr-175 -- data/context-overrides.js scripts/content-corpus.cjs scripts/verify_content_corpus.cjs scripts/verify_content_ui.cjs scripts/fixtures/content-quality-approved.json scripts/fixtures/content-quality-baseline.json`；对 `index.html` 只应用 CSS `.repeatBlank`、`#prompt/#hint` aria、`applyContextOverride`/`meta` 展开、`promptHTML`、hint 行这 5 个 hunk（跳过 meta hunk，脚本引用改成新指纹）；应用 `scripts/verify_8105_app.js`、`scripts/verify_redesign_v3.js`（45→87 释义）、`package.json`（`verify:content`，`verify:data` 追加）、`CHANGELOG.md`、`README.md` 的 hunk；`sw.js` 只改 `BUILD` 与 overrides 指纹，保留 `icon-512-maskable.png`；然后 `pnpm run verify:content && pnpm test`。

### 5.4 供应库与许可
25. `fsrs6.min.js` 以 UMD 挂 `globalThis.FSRS`；若 v10 改用 ESM 打包，可直接 `import` 同一文件（UMD 头检测 `exports`/`define`），但要保持 `parameterVersion`（`index.html:1203`）不变或做迁移，因为 `memory[key].fsrsCard` 序列化依赖 `serializeFSRSCard`（:1211-1212）。
26. `hanzi-writer` 的 `charDataLoader` 契约是 `(char, onComplete)`（`index.html:2271-2274`），SW 对 `data/*.json` 采用缓存优先、上限 800、核心 600 字不淘汰（`sw.js:16-17,28-33`）。
27. **许可门未关**：`LEGAL_RELEASE_CHECKLIST.md:8-15` 里根 `LICENSE` 未选（BLOCKED）、MOE 10 条 / 人工 8 条 / 合并 59 条补充笔顺记录 BLOCKED、Arphic 与 LGPL 需合规复核；"440 条补充记录不得称为商业可用"（:17-19）。#180 字体尚未写进 `THIRD_PARTY_NOTICES.md`（现只有 4.2 KiB 品牌子集条目）；接入时需新增 ShiziKai（LXGW WenKai GB v1.522，OFL，无显式 RFN）与 ShiziSerifSC（Noto Serif SC 2.003-H1，Google 2012 + Adobe 2017-2024 双版权，OFL）两条并随包放两份 OFL 全文（`COPYRIGHT-NOTICES.md:35`）。`render.mjs` 画参考字所用的 hanzi-writer-data 路径属于 Arphic 体系，字体许可不替代它（`api.md:31`、`COPYRIGHT-NOTICES.md:36`）。

## 6. 未解问题

1. **D11 vs M02**：月字帖到底取月内最后判断还是本月第一次笔迹？两处文字冲突，代码无法裁决。
2. **逐判断存储何时立项**：D11/K28/L05/10.12/单字详情"历次格子"都要每次判断的墨迹与身份；#180 提案暂停，`decisions.md` 待定。没有它，`resolveGlyphs` 只能永远返回浅参考。
3. **更正（D19）时 `at/sequence/localDay` 是否保持原值**：影响"最后判断"选取与月归属。
4. **v10 写字页是否保留 #175 的可见语义/字形提示行**：v10 全部设计文档里没有 `promptHint`、`□`、"只写一次"的字样；D16 与 v10 K24"提示"是两个概念，题面 hint 的位置/样式待设计确认。
5. **字体补字与部署路径**：是否现在就把 `”`、`□`（及可能的 `‘’`）加进 Kai 语料并重建；Serif 语料以哪份 v10 文案/题记句库为准；`/f8-assets/` 改到什么相对路径；iOS 用 `woff2-web` 还是 `ttf-native`。
6. **>80 字策略与单字图字体**：A05 单字图"黑 11/13 → 33px"是系统黑体还是宋体；拼音/日期行用哪个 face。
7. **`custom:` 自选字要不要进月字帖**：若要，`monthSelection` 需按 `main` 稳定键重写并决定自选字的参考字来源。
8. **`activity.monthly` 归档与 FSRS 月汇总**是否算入 `monthSelection`/`coverage:'complete'` 的证据范围。
9. **v10 拆分 `index.html` 后内容门禁的落点**：`content-corpus.cjs` 的正则锚点需要一个明确的"纯卡片展开模块"作为替代取源。
10. Safari / WKWebView 下 `document.fonts.load` 返回的 `FontFace.weight` 是否为 `"400"/"500"` 字面量（`font-loader.mjs:25` 依赖此），未有实测。
