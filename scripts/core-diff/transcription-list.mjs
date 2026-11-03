#!/usr/bin/env node
// B4 单测转写清单生成器（B4.0；计划 §4.3 ②）：真的跑一遍 node 单测，用自定义报告器拿到每个 test（含循环生成的、子 test）的名字，
// 按文件 / 用例名归类，写 docs/engineering/v10/B4-单测转写清单.md。
//   node scripts/core-diff/transcription-list.mjs           重新生成
//   node scripts/core-diff/transcription-list.mjs --check   只核对清单与当前测试同步（用例增删改名后提示重生成）
// 归类：转写（逐条转 XCTest，用例名保留原名 + 原文件路径注释）/ 由差分覆盖（金标准、随机差分、调度模拟器、契约重跑已覆盖，不单独转）/
//       不转（仅网页 UI、JS 专属门禁、数据与许可门禁留在 node）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs/engineering/v10/B4-单测转写清单.md');
const REPORTER = path.join(ROOT, 'scripts/core-diff/lib/list-reporter.mjs');

const T = '转写';
const D = '由差分覆盖';
const N = '不转';

// 文件 → [归类, 卡, 说明]。说明写给转写的人。
const FILES = {
  'test/ui/query.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/annual.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/library-list.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/home.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/h2-home-e.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/library-all.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/detail.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/h1-detail-hero.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/paper-detail.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/mine.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-mine-sub.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-mine.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/library-zones.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/library.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-home.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-query.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-library-sub.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-library.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],
  'test/ui/native-detail.test.mjs': [D, 'B4.5b', 'ViewParityTests / ViewRuleTests + views-pages 金标准与 200 seeds 全 op 差分；组件 / 平台动作留 node'],

  'test/ui/about.test.mjs': [N, '—', '网页组件 / 资料生成器；纯视图规则见逐条 B4.5b'],
  'test/ui/prefs.test.mjs': [N, '—', '网页设置组件与平台同步；纯视图规则见逐条 B4.5b'],
  'test/ui/library-switch.test.mjs': [N, '—', '网页换库动作与组件；纯视图规则见逐条 B4.5b'],
  'test/ui/work-text.test.mjs': [N, '—', '网页纸面渲染 / 文案门禁；落款引用规则见逐条 B4.5b'],
  'test/ui/native-block.test.mjs': [D, 'B4.5', 'App API 传输与页面接线；纯阻断判断见逐条 B4.5b'],
  'test/core/after-seen-works.test.mjs': [T, 'B4.3', '作品出口规则（records / work-members / ink-pick）；经图片 / 页面视图的断言按同一规则在测试里装配，视图本身 B4.5 / B4.6 接'],
  'test/core/arphic-compliance.test.mjs': [N, '—', '许可与随包文件门禁，留 node（数据不随 B4 变）'],
  'test/core/backup.test.mjs': [T, 'B4.4', 'BackupTests（20）；双向夹具 BackupRoundTripTests（Fixtures/backup-roundtrip.json）+ scripts/core-diff/backup-roundtrip.mjs'],
  'test/core/cards.test.mjs': [T, 'B4.3', ''],
  'test/core/compliance-removal.test.mjs': [N, '—', '题库 / 笔顺数据门禁留 node；「旧记录降级」一条转写（见逐条）'],
  'test/core/content-blocklist.test.mjs': [N, '—', '题面文字门禁，留 node'],
  'test/core/contract.test.mjs': [T, 'B4.3', 'core 产出过 schema 形状表；Swift 版对 JS 参考实现造出的夹具（contract.json）跑 Schema 校验 + 模型往返'],
  'test/core/core-config.test.mjs': [N, '—', 'B4.1 配置 / 数据资源的 node 门禁（生成物同步、policy 登记、deck.json、形状工厂）'],
  'test/core/core-diff.test.mjs': [N, '—', 'B4.0 等价性底座自身的 node 门禁（金标准同步、差分自检、op 表同名）'],
  'test/core/copy-audit.test.mjs': [N, '—', '文案源门禁；Swift 读生成的 Copy.json（B4.1），不手移植文案'],
  'test/core/copy-number-spacing.test.mjs': [N, '—', '同上'],
  'test/core/copy.test.mjs': [N, '—', '同上；B4.1 加「Copy.json 与 src/config/copy 同步」的 node 门禁'],
  'test/core/dates.test.mjs': [T, 'B4.1', 'B4.0 已移植 dates 本体与金标准（dates.json）；落款汉字数字 cnDigits / cnNumber / cnCount 随 B4.1'],
  'test/core/epigraphs.test.mjs': [T, 'B4.1', ''],
  'test/core/first-practice.test.mjs': [T, 'B4.2', ''],
  'test/core/first-result.test.mjs': [T, 'B4.3', ''],
  'test/core/font-loader.test.mjs': [N, '—', '网页字体加载器（仅网页）'],
  'test/core/fsrs.test.mjs': [T, 'B4.2', '另有 FSRS 金标准（评分 × 间隔 × fuzz 种子）'],
  'test/core/group-size.test.mjs': [T, 'B4.2', ''],
  'test/core/hints.test.mjs': [T, 'B4.2', ''],
  'test/core/images.test.mjs': [T, 'B4.6', '版式 / 分页 / 选字转写；画图部分改为参考 PNG 比对'],
  'test/core/ink-math.test.mjs': [T, 'B4.3', '墨 v2 / v3 / v4 编解码；buildStroke 已由 WebInkTests 覆盖'],
  'test/core/ink-pick.test.mjs': [T, 'B4.3', ''],
  'test/core/ink-v4.test.mjs': [T, 'B4.3', ''],
  'test/core/mix.test.mjs': [T, 'B4.2', ''],
  'test/core/new-order.test.mjs': [T, 'B4.2', ''],
  'test/core/paper-works.test.mjs': [T, 'B4.3', '纸上记录成员规则；折叠（budget.recover）B4.4、年报 / 我的视图 B4.5、图片 B4.6 在各自卡接上'],
  'test/core/policy-mix.test.mjs': [T, 'B4.1', ''],
  'test/core/policy.test.mjs': [T, 'B4.1', 'policy 由 node 导出 JSON 比对'],
  'test/core/query.test.mjs': [T, 'B4.3', ''],
  'test/core/records.test.mjs': [T, 'B4.3', ''],
  'test/core/schedule-invariants.test.mjs': [D, 'B4.2', '调度模拟器 --engine both 对 Swift 跑同一组不变量'],
  'test/core/session-start.test.mjs': [T, 'B4.2', ''],
  'test/core/sessions.test.mjs': [T, 'B4.2', ''],
  'test/core/sheet-grid.test.mjs': [T, 'B4.6', ''],
  'test/core/special.test.mjs': [T, 'B4.2', ''],
  'test/core/spread.test.mjs': [T, 'B4.2', ''],
  'test/core/strokes.test.mjs': [N, '—', '网页笔顺加载器（fetch / LRU）；原生直读 data/*.json'],
  'test/core/structure.test.mjs': [T, 'B4.3', '规则部分；读屏名称的文字拼装（ref-label.js）留界面层'],
  'test/core/web-ink-golden.test.mjs': [N, '—', '已有 Swift 版（ShiziWriteTests/WebInkTests）'],
  'test/core/work-members.test.mjs': [T, 'B4.3', ''],
  'test/store/budget.test.mjs': [T, 'B4.4', 'BudgetTests（17）'],
  'test/store/hooks.test.mjs': [N, '—', '网页测试钩子（仅网页）'],
  'test/store/ink-schema.test.mjs': [T, 'B4.4', 'InkSchemaLocalTests / InkSchemaNativeTests（6 × 2）；第 5 条的 commitJudgment（B4.5）在测试里按同一规则拼出提交'],
  'test/store/migrate.test.mjs': [T, 'B4.4', 'MigrateTests（16）；smallV1 导出成 Fixtures/migrate-small-v1.json'],
  'test/store/native-store.test.mjs': [N, '—', 'JS ↔ 原生 SQLite 桥与 localStorage 迁移，B4.9 随 WebEngine 退场；校验和向量已在 ShiziStoreTests'],
  'test/store/schema.test.mjs': [T, 'B4.1', 'schema.js 正反例另出金标准'],
  'test/store/storage.test.mjs': [T, 'B4.4', 'StorageTests（11）'],
  'test/store/store.test.mjs': [T, 'B4.4', 'StoreContractLocalTests / StoreContractNativeTests（26 × 2）；随机差分 ④ store 域另含写失败与撞配额注入'],
  'test/session/boundary.test.mjs': [N, '—', 'JS 导入图门禁（Swift 包只依赖 Foundation 由 Package.swift 保证）'],
  'test/ui/native-ink.test.mjs': [N, '—', '网页侧原生书写面接线（仅网页）'],
  'test/ui/native-write.test.mjs': [D, 'B4.5', '页面 API 契约 ⑤：同一输入夹具换 SwiftEngine 重跑，回包 == WebEngine'],
  'test/platform/reminder.test.mjs': [T, 'B4.3', '提醒题目选取是规则（B4.0 暂记 B4.5，主控改派 B4.3）；syncReminder 消息体 / 网页桥部分不转'],
  'test/platform/accessibility.test.mjs': [N, '—', '网页桥（仅网页）'],
  'test/platform/bridge.test.mjs': [N, '—', '网页桥（仅网页）'],
  'test/platform/sound.test.mjs': [N, '—', '网页声音（仅网页）'],
  'test/platform/sw.test.mjs': [N, '—', 'Service Worker（仅网页）'],
  'test/platform/text-size.test.mjs': [N, '—', '网页字号桥（仅网页）'],
};

// 逐条覆盖（文件内个别用例归类不同）：[文件, 名字正则, 归类, 卡, 说明]
const OVERRIDES = [
  ['test/ui/query.test.mjs', /^deckPredicates:\ deck\ membership\ and\ current\ library\ \(settings\.library;\ unknown\ →\ default\ core3500\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^D42\ first\ of\ the\ year:\ the\ ink\ comes\ from\ the\ earliest\ of\ this\ year's\ records\ of\ that\ char\ that\ still\ has\ ink/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^卷尾「同一个字，两次」\(P161\):\ a\ char\ with\ two\ inked\ records\ this\ year,\ the\ pair\ furthest\ apart;\ ties\ →\ written\ first;\ none\ →\ no\ tail/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^D42\ month\ sheet:\ ink\ never\ borrowed\ across\ months;\ date\ tag\ stays\ the\ first\ member\ day/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^D42\ day\ items:\ the\ char\ keeps\ the\ latest\ record\ OF\ THAT\ DAY\ that\ has\ ink;\ none\ that\ day\ keeps\ the\ latest/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/home.test.mjs', /^resume\ dimension:\ none\ \/\ A\ \/\ B\ \/\ A\+B;\ B\ is\ the\ primary\ line,\ A\ the\ other\ \(D05\ \/\ S01\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-all.test.mjs', /^pinyin:\ initial\ groups\ \(tones\ stripped,\ ü\ →\ u\),\ each\ cell\ labelled\ with\ pinyin,\ no\-pinyin\ chars\ in\ 其他/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^R\-E01\ \/\ K16:\ 快忘了\ =\ latest\ judged\ correct\ and\ due;\ mutually\ exclusive\ with\ 写错过;\ cap\ from\ policy/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library.test.mjs', /^wall\ order:\ hollow\ first,\ then\ latest\ judged\ newest\ →\ oldest\ \(by\ id\);\ wrong\ =\ standard\ glyph\ kind/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/work-text.test.mjs', /^落款\ text\ \(§5\.2\ \/\ §6\.4\):\ 汉字日期\ \+\ 全角空格\ \+\ 汉字字数；2\ 写「两」；一个字也写「一字」（V2\-05）/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/work-text.test.mjs', /^自选组的落款\ \(T2\-03\):\ 「自选N字」，数量照样带/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/work-text.test.mjs', /^分张的落款\ \(D39\ \/\ §6\.7\):\ 其一\ \/\ 其二\ appended,\ each\ page\ writes\ its\ own\ count;\ one\ page\ has\ no\ 其几/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/native-block.test.mjs', /^B3\.13\ blockReasonOf:\ unavailable\ \/\ blocked\ \/\ migration,\ and\ none\ when\ everything\ is\ fine/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],

  ['test/ui/query.test.mjs', /^sheetModel\ pick:\ typing\ selects\ nothing;\ selection\ filtered\ by\ input\ and\ practicability;\ bar\ label\ by\ count/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/query.test.mjs', /^sheetModel\ lookup:\ no\ selection,\ no\ bar;\ rows\ carry\ summaries\ from\ records\ \/\ custom/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/query.test.mjs', /^sheetModel:\ pinyin\ with\ no\ match\ →\ one\ note;\ digits\ \/\ symbols\ stay「只能输入汉字」;\ Han\ input\ unaffected/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^empty:\ no\ records\ \/\ only\ answer\-seen\ or\ skipped\ \/\ only\ last\ year\ \/\ only\ paper\ →\ empty;\ null\ state\ safe/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^the\ year\ count:\ distinct\ work\ chars\ this\ year\ \(right\ ones;\ a\ wrong\-only\ char\ does\ not\ count,\ D51\ ⑤\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^months:\ one\ section\ per\ month\ that\ has\ chars,\ ascending;\ the\ count\ is\ the\ month\ sheet\ size\ \(chars\ with\ no\ ink\ included\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^D66\ ⑪\ a\ single\ year\ of\ records\ has\ no\ previous\ \/\ next\ year\ \(nothing\ to\ switch\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^R\-E01\ \/\ D23:\ only\ the\ latest\ judged\ record\ decides;\ answer\-seen\ \/\ skipped\ after\ a\ wrong\ keep\ it\ in\ 写错过/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^B4\ \(G38,\ D36\):\ 写错过\ with\ 8\ rows\ →\ default\ selects\ only\ the\ 5\ most\ recently\ wrong/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^D66\ ⑬:\ the\ default\ selection\ follows\ 每组字数/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^rows\ that\ cannot\ be\ practised\ \(custom:\ \/\ not\ in\ deck\)\ show\ but\ are\ not\ selectable\ and\ never\ go\ into\ the\ group/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^groupFromHereActive:\ an\ unfinished\ B\ whose\ source\ is\ this\ list/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/home.test.mjs', /^records\ dimension:\ first\ \/\ empty\ \/\ record\ \(K06:\ cleared\ →\ empty,\ not\ first\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/home.test.mjs', /^homeViewOf:\ first\ \/\ fresh\ \/\ today\ \/\ progress\ \/\ special\ \/\ back,\ with\ this\ priority\ \(03\ P155\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/home.test.mjs', /^D40\ \(P129\):\ the\ home\ model\ says\ which\ special\ group\ is\ next\ —\ only\ with\ a\ deck,\ no\ unfinished\ group,\ and\ the\ conditions\ met/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/h2-home-e.test.mjs', /^the\ two\ extra\ lines:\ back\ =\ 「你写过的\ N\ 个字都还在。」\ with\ the\ real\ N,\ special\ =\ the\ special\-group\ sentence;\ nothing\ else\ has\ one/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-all.test.mjs', /^counts\ match\ the\ library\ home\ \(recorded,\ custom\ unwritten\);\ D66\ ⑤:\ answer\-seen\ chars\ count,\ skipped\-only\ do\ not/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-all.test.mjs', /^recent\ \(default\):\ hollow\ first,\ months\ new\ →\ old,\ two\ open\ by\ default,\ rest\ closed;\ fold\ overrides;\ cross\-year\ label/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-all.test.mjs', /^filters:\ due\ \/\ shaky\ \/\ known\ \/\ unw\ \/\ custom;\ sort\ collapses;\ 0\-count\ chips\ disabled\ unless\ active;\ practice\ go/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/detail.test.mjs', /^detailModel:\ judged\ records\ only\ \(answer\-seen\ \/\ skipped\ excluded\),\ oldest\ first;\ first\ \/\ latest;\ due\ only\ with\ judged\ \(P12\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/paper-detail.test.mjs', /^P169:\ detailModel——纸上记录计入次数与写错过，但不进笔迹格/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/detail.test.mjs', /^detailModel:\ custom\ \(index\ \/\ entry\),\ wordOff\ \(label\ 释义\ \+\ prompt\ hint,\ no\ swap\),\ photo\ not\ counted\ as\ a\ record\ \(P10b\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^empty:\ no\ judged\ record\ \(answer\-seen\ \/\ skipped\ only\)\ →\ empty;\ overview\ all\ 0;\ no\ sheet/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^weekdayIndex:\ Monday\ first;\ week\ wraps\ across\ months/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^overview\ \(D63\):\ streak\ counts\ back\ from\ today,\ or\ from\ yesterday\ when\ today\ is\ not\ written\ yet;\ legacy\.days\ counted/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^month\ sheet:\ first\-appearance\ order,\ date\ tags\ on\ day\ change,\ P02\ pick\ first\ vs\ last/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^record\ days:\ judged\ \+\ folded\ byDay;\ answer\-seen\ \/\ skipped\ \/\ legacy\.days\ excluded/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^calendar:\ Monday\-first\ blanks,\ 7\-multiple,\ today\ \/\ future\ \/\ has\ flags/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^sheet\ preview:\ ≤\ 3\ rows\ untouched;\ more\ →\ last\ 3\ rows\ of\ the\ 7\-column\ layout,\ first\ cell\ re\-tagged/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^day\ items:\ same\ char\ keeps\ its\ latest\ record,\ ordered\ by\ latest\ \(home\ ink\ row\ rule\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^records\ model:\ clamp\ month,\ prev\ \/\ next\ ends,\ selection\ only\ on\ record\ days\ of\ that\ month,\ today\ row\ only\ this\ month/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^D66\ ⑱\ backup\ hint:\ >=\ 30\ days\ since\ last\ backup\ \(or\ since\ first\ record\ when\ never\ backed\ up\),\ only\ with\ records\ and\ changes/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^D66\ ⑱\ storage\ pressure:\ shown\ only\ when\ readable\ and\ near\ the\ limit;\ wins\ over\ the\ 30\-day\ hint/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library.test.mjs', /^tone\ buckets\ follow\ policy\.inkToneDays\ \(P56\)\ —\ boundaries\ inclusive/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library.test.mjs', /^columns\ \(8,\ Pro\ Max\ 9,\ large\ text\ ≤\ 6,\ every\ cell\ ≥\ 44pt;\ independent\ of\ members\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library.test.mjs', /^helpers:\ customCharsOf\ dedups\ and\ drops\ non\-single\ chars;\ latestJudgedByChar\ uses\ id\ order/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-zones.test.mjs', /^memoryZoneOf\ \(D66\ ⑰\):\ 已熟悉\ also\ needs\ ≥\ 3\ successes\ \(reps\ −\ lapses\)/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-zones.test.mjs', /^skippedZone\ \(D62\):\ skipped\ and\ still\ no\ judged\ record;\ not\ counted\ in\ recorded;\ newest\ skip\ first/, T, 'B4.5b', 'ViewRuleTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/annual.test.mjs', /^empty\ year\ and\ folded\ work\ members\ retain\ their\ year/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-list.test.mjs', /^selection\ normalization,\ word\ parts\ and\ real\ disabled\ zero\ state/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library-all.test.mjs', /^old\ filters\ map\ to\ due;\ search\ mode\ and\ batching/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/detail.test.mjs', /^hero\ uses\ first\ \/\ latest\ screen\ judgments;\ old\ photos\ remain\ read\-only/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/native-mine-sub.test.mjs', /^B3\.9\ the\ sheet\ geometry\ is\ the\ web\ sheetGrid\ rule/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/native-mine.test.mjs', /^small\ sheets\ sign;\ AX\ limits\ columns;\ trim\ re\-tags\ the\ first\ cell/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/mine.test.mjs', /^weekdayIndex:\ Monday\ first;\ week\ wraps\ across\ months/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],
  ['test/ui/library.test.mjs', /^empty\ \/\ big\ number\ \/\ facts;\ test\/ui\/library\-zones\.test\.mjs\ —\ exclusive\ zones,\ sum\ =\ recorded/, T, 'B4.5b', 'ViewParityTests：原名 / 原路径见 Swift 注释，转写纯规则断言'],

  ['test/ui/about.test.mjs', /^(B7 |C1 \/ P197:|sub-pages:)/, T, 'B4.5b', 'ViewParityTests：模型规则断言（DOM 断言留 node）'],
  ['test/ui/prefs.test.mjs', /^(settingsView:|time helpers$|commitSettings:|commitSettings on an empty|remind: enabling|RemindBody \(E3\))/, T, 'B4.5b', 'ViewParityTests：视图 / Store 提交规则（平台同步与 DOM 留 node）'],
  ['test/ui/library-switch.test.mjs', /^(libraryRows:|judgedChars:|real deck:)/, T, 'B4.5b', 'ViewParityTests'],
  ['test/ui/work-text.test.mjs', /^(落款 text|自选组的落款|分张的落款)/, T, 'B4.5b', 'ViewParityTests：同一引用结构及汉字数量；渲染留 Copy'],
  ['test/ui/native-block.test.mjs', /^B3.13 blockReasonOf:/, T, 'B4.5b', 'ViewParityTests'],
  ['test/ui/query.test.mjs', /^(isFailure:|keyboardInset|sheetFrameStyle|focus proxy:|F6 |CharRow |PickBar:|CardActions:|F5:|BadCard:)/, N, '—', '网页组件 / DOM / 桥与静态接线；模型纯规则另转写'],
  ['test/ui/home.test.mjs', /^(D49:|firstShiSize:)/, N, '—', '网页组件 / DOM / 桥与静态接线；模型纯规则另转写'],
  ['test/ui/h2-home-e.test.mjs', /^(removed:|「拾回」)/, N, '—', '网页组件 / DOM / 桥与静态接线；模型纯规则另转写'],
  ['test/ui/h1-detail-hero.test.mjs', /^文案：/, N, '—', '网页组件 / DOM / 桥与静态接线；模型纯规则另转写'],
  ['test/ui/paper-detail.test.mjs', /^P169: (纸上记录行|RecordsBlock)/, N, '—', '网页组件 / DOM / 桥与静态接线；模型纯规则另转写'],
  ['test/ui/native-mine.test.mjs', /^B3\.5(c Swift side:|d:)/, N, '—', '网页组件 / DOM / 桥与静态接线；模型纯规则另转写'],
  ['test/ui/detail.test.mjs', /^(commitWordOff|commitRemoveCustom|B3\.5c (write ops:|D07:|the web prefs|op table:))/, D, 'B4.5a', '会话写入 / 页面 API 契约留 B4.5a；本卡只移植视图与提醒提交辅助'],
  ['test/ui/native-mine.test.mjs', /^(commitWordOff|commitRemoveCustom|B3\.5c (write ops:|D07:|the web prefs|op table:))/, D, 'B4.5a', '会话写入 / 页面 API 契约留 B4.5a；本卡只移植视图与提醒提交辅助'],
  ['test/ui/detail.test.mjs', /^loadEtymology:/, N, '—', '网页异步数据加载 / fetch 缓存；不是 views/detail.js 函数'],
  ['test/core/compliance-removal.test.mjs', /old records/i, T, 'B4.2', '旧记录里的已移除字走「字不在题库」降级'],
  ['test/core/dates.test.mjs', /isValidDay|localDay|dayStartMs|addDays|monthOf|dayOfYear|period boundaries/, D, 'B4.0', '金标准 dates.json（6 时区）+ 随机差分已覆盖'],
  ['test/core/strokes.test.mjs', /glyph/i, N, '—', '网页画布纯函数（仅网页）'],
  ['test/platform/reminder.test.mjs', /payload|controller|deep link|permission/i, N, '—', '网页 → 原生消息体 / 网页桥的就绪队列与权限回调（B4 后不存在）'],
  ['test/core/first-result.test.mjs', /special deferral|deferSpecial/, T, 'B4.2', '特别组顺延依赖 sessions / special / session-start（B4.2）与 store.commit（B4.4）；B4.3 的 XCTest 里留 XCTSkip 占位'],
];

const SCOPE = ['test/core', 'test/store', 'test/session', 'test/platform'].flatMap((d) =>
  fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.test.mjs')).map((f) => `${d}/${f}`)).concat(["test/ui/query.test.mjs", "test/ui/annual.test.mjs", "test/ui/library-list.test.mjs", "test/ui/home.test.mjs", "test/ui/h2-home-e.test.mjs", "test/ui/library-all.test.mjs", "test/ui/detail.test.mjs", "test/ui/h1-detail-hero.test.mjs", "test/ui/paper-detail.test.mjs", "test/ui/mine.test.mjs", "test/ui/native-mine-sub.test.mjs", "test/ui/native-mine.test.mjs", "test/ui/library-zones.test.mjs", "test/ui/library.test.mjs", "test/ui/native-home.test.mjs", "test/ui/native-query.test.mjs", "test/ui/native-library-sub.test.mjs", "test/ui/native-library.test.mjs", "test/ui/native-detail.test.mjs"]).concat(['test/ui/native-ink.test.mjs', 'test/ui/native-write.test.mjs', 'test/ui/about.test.mjs', 'test/ui/prefs.test.mjs', 'test/ui/library-switch.test.mjs', 'test/ui/work-text.test.mjs', 'test/ui/native-block.test.mjs']).sort();

function collect() {
  const r = spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, ...SCOPE], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, TZ: process.env.TZ || 'Asia/Shanghai' } });
  const rows = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const e = JSON.parse(line);
    if (e.suite) continue;
    rows.push({ ...e, file: path.relative(ROOT, e.file) });
  }
  return rows;
}

// S2（调度规则 v2，D83；D82 起规则不再与 JS 一致）：这些用例断言的是旧规则（规则 D 配比 / 积压阀 / 每日复习上限 / 久别摊开 /
// 新用户封顶 / 自加的字不进今天的练习 / 写错不当天重考 / 复习日期按每次判断）或逐字段对照 JS 的会话写入，随新规则退役，XCTest 删除。
// 新规则的测试：ios/ShiziCore/Tests/ShiziCoreTests/TodayPlanTests.swift、TodayPlanSimulationTests.swift。
const R = 'S2 退役';
const S2_RETIRED = new Map([
  ["test/core/group-size.test.mjs", new Set([
    "selectDaily at 20: a fresh user gets a full group; the review/new mix is the 5-char mix × 4",
  ])],
  ["test/core/mix.test.mjs", new Set([
    "mix vs simulate-mix: the sim and the app use the same warm-up list, group size and cap",
    "mix vs simulate-mix: newTarget of rule D agrees on a grid across every threshold (0.5 / 1.5 / 4, accuracy 0.6, lastHadNew)",
    "mix vs simulate-mix: planGroup (3000 random states) gives the same new / review / early counts and the same characters",
    "rule D: p < 0.5 and recent new-char accuracy ≥ 0.6 → up to 3 new (reviews capped at 2); accuracy < 0.6 → only 2 new (reviews capped at 3)",
    "rule D: 0.5 ≤ p < 1.5 → 2 new; 1.5 ≤ p < 4 → 1 new",
    "valve (p ≥ 4, D65 #2): new chars drop to 0 whether or not the last group had new chars; the D41 alternating valve stays available for comparison",
    "valve hysteresis (D65 #2): once closed it stays closed until p < valveReleaseDays (2), then the usual tiers come back",
    "D41 alternating valve (valveReleaseDays null) never makes two full-review groups in a row: a 30-due backlog alternates until it shrinks",
    "rule D: coming back after ≥ 7 days the first group still has 1 new char even though the last group had new chars",
    "D48 ⑧ (P184): the first group after ≥ 7 days away is 3 chars; the next group the same day, 6 days away and the special group are not shortened",
    "new chars: at most 3 while the due + early pool can fill the group; the 4th / 5th new only appear when nothing else can fill",
    "library exhausted: no early reviews to fill a group (D66 ⑩) — nothing due → empty queue; some due → just those",
    "early reviews: soonest due first then least stable; not warm-up chars; not chars written today; stopped cards are skipped",
    "dailyReviewCap: an early review done today is not counted, an on-time one is (P125 earlyCountsTowardCap=false)",
    "dailyReviewCap through selectDaily: 30 early reviews written today leave the whole budget for due chars",
    "D66 ⑫ (policy.newUserRamp P325): days 1–3 after the first practice → at most 2 parts of new chars per group (20-char group: 8), no filling with new chars; day 4 back to normal",
  ])],
  ["test/core/session-start.test.mjs", new Set([
    "daily: the first group after ≥ 7 days away is 3 chars through startDaily (D48 ⑧ / P184)",
    "daily: characters judged today never come back; skipped / answer-seen today stay out (D65 #5, P06 / P36)",
    "daily: custom characters not yet written do not enter the daily queue (P33 none)",
    "daily: at most dailyReviewCap (30) reviews a day, counted on judged records (P03 / P60)",
    "after the first practice (尴 赢 拾) the first daily group is 1 warm-up char at the head + 4 new chars, nothing to review yet (D28 / D41)",
    "D66 ⑨: back after ≥ 30 days → expireStale spreads the due chars over the next days in one commit, once per absence; planDaily already sees it",
    "D66 ⑨: no spread when away < 30 days or already written today; starting a group spreads too (no home visit)",
  ])],
  ["test/core/sessions.test.mjs", new Set([
    "daily: a char skipped today stays out today; a skipped new char is deferred skipNewDeferDays days, then returns to its place (D65 #5)",
    "daily: answer-seen today follows policy.answerSeenScope (P36)",
    "daily: custom chars not yet written stay out of daily (P33 customIntoDaily=none)",
    "daily: at most dailyReviewCap (30) due reviews per day, counted as they are done",
    "daily: wrong-first (D65 #1) — last practice day's wrong chars lead the due list, then older wrong ones, then plain due; reserve survives an exhausted review budget",
  ])],
  ["test/core/spread.test.mjs", new Set([
    "returnSpreadPlan (policy.returnSpread P323): ≥ 30 days away, not written today, not done for this absence; perDay = round(group size × 0.5)",
  ])],
  ["test/ui/native-write.test.mjs", new Set([
    "judge through the API = the web judgment path, field by field (records, sched/FSRS, ink, session, lastEnded)",
    "judge reply on the last card says finished; exit navigates to the result page",
    "open: recovery is idempotent (a judged-but-not-advanced card is advanced once), snapshot + copy in one reply",
    "hint op: every tap = the web hint path field by field, up to the whole char (= answer seen, D64 ①)",
    "hint op: no group data → one stroke per tap; a segment already written is skipped (same skip as the web)",
    "hints feed the judgment the same way on both paths (D66 ②: review with 2+ hints)",
    "snapshot: hint range, answer seen and the previous card line (text; the 修改 › action text comes with it)",
    "correct op: 改判 = the web commitCorrection field by field, flips once and never counts twice (D19 / D07)",
    "correct op: only the line record of this session can be changed (sessions.canCorrect); a later card closes the door",
    "correct op state: sheet data = the record (char, judgment, own strokes from the stored ink); a failed write changes nothing and the retry applies once",
    "showAnswer = commitAnswerSeen: answer-seen record + straight into the trace phase (D64 ②), a review char gets one Again (D66 ①)",
    "answer flow: trace → 凭记忆写 (retrace) → 下一个, strokes included — web path and API path agree on every commit (D70 ② no self ink, D66 ① Again)",
    "answer flow: 再描一遍 (retrace → trace) and the recall-after-answer-seen path (hint gave the whole char) behave like the web",
    "answer ops: a failed write changes nothing (D07), the retry succeeds once; a stale card is refused with the advanced snapshot; bad phase refused",
    "answer flow: 下一个 on the last char finishes the group in the same call (same order as the web page)",
    "skip + undoSkip = commitSkip + commitUndoSkip: record, session, hints and the strokes written back, field by field",
    "skip: writes the same skipped record as the web (no judgment, not re-implemented)",
    "skip: D07 — a failed skip changes nothing; the retry records once; a second skip of the same card is stale",
    "undoSkip: only the last skipped record can be undone (stale otherwise); a failed undo changes nothing and retries",
    "skip of the last char finishes the group; exit hands the undo chance (remaining ms + strokes) to the result page / source page",
    "end: counts and commit = endConfirmCounts + commitEndGroup (web path); judged > 0 → result page, none judged → back to the source",
    "prompt fill: the blank cell carries the answer only in the trace phase (web REVEAL_PHASES), never in recall / retrace (D16)",
    "B2.7 result op = the web result page mount (commitFinish, idempotent) + the view of the same resultModel",
    "B2.7 result view (page side): work cells / rows / kuan / reveal come from the web result page functions",
    "B2.7 resultCell: the sheet model is the web ResultCellSheet (title / note / top label / flip); skipped and answer-seen only look",
    "B2.7 resultCorrect = commitResultCorrection field by field (D19: same record, corrections appended, sched replayed); once only; failure changes nothing",
    "B2.7 resultAdd / resultSealed = commitAdded / commitSealed (web path), the seal sound is asked for once per group",
    "B2.7 resultUndoSkip = commitResultSkipUndo (session back in the slot, record removed, strokes written back), then the page goes back to the write page",
    "B2.7 resultAgain = the web 再写一组 (startNextA with the group source), then the page replaces the result with the write page (D70)",
    "B2.7 resultExit: leave → the web leaveTo(model.leave); redo → the wrong chars of this group; detail / share pass through; nothing is written",
  ])],
]);

function classify(row) {
  if (S2_RETIRED.get(row.file)?.has(row.name)) return { c: R, card: 'S2', note: 'D83 新规则取代（TodayPlanTests / TodayPlanSimulationTests）' };
  if(row.file==='test/ui/native-write.test.mjs')return {c:T,card:'B4.5a',note:'SessionTranscriptionTests：55 个原名/路径；session-contract 220 场景 × 1,196 步，完整回复/状态；另 session-completion 强制差分'};
  if(row.file==='test/ui/native-block.test.mjs'&&!/^B3.13 blockReasonOf:/.test(row.name))return {c:T,card:'B4.5a',note:'SessionPageTranscriptionTests：原名/路径与原断言；App 类名静态检查同原 node 契约，只读源码无需模拟器'};
  if(['test/ui/detail.test.mjs','test/ui/native-mine.test.mjs'].includes(row.file)&&/^(commitWordOff|commitRemoveCustom|B3\.5c (write ops:|D07:|the web prefs|op table:))/.test(row.name))return {c:T,card:'B4.5a',note:'SessionPageTranscriptionTests：真实 Store 提交/失败/重试/原位撤销'};
  if(row.file==='test/platform/reminder.test.mjs'&&/^(payload|controller|cold-start deep link|permission report|inviteReminder)/.test(row.name))return {c:T,card:'B4.5a',note:'ReminderControllerTests：payload、去重/force/debounce、冷启动队列、live-store permission、invite/time'};

  for (const [file, re, c, card, note] of OVERRIDES) if (file === row.file && re.test(row.name)) return { c, card, note };
  const f = FILES[row.file];
  if (!f) return { c: '未归类', card: '?', note: '新文件：在 transcription-list.mjs FILES 里登记' };
  return { c: f[0], card: f[1], note: '' };
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function render(rows) {
  const L = [];
  L.push('# B4 单测转写清单（自动生成）', '');
  L.push('由 `node scripts/core-diff/transcription-list.mjs` 生成（B4.0；计划 [B3B4-原生化架构与计划.md](B3B4-原生化架构与计划.md) §4.3 ②）。不要手改；测试增删改名后重跑，`--check` 核对同步。', '');
  L.push('**归类**：**转写** = 逐条转 XCTest（用例名保留原名，注释写原文件路径，便于对账）；**由差分覆盖** = 金标准 / 随机差分 / 调度模拟器 / 页面 API 契约重跑已覆盖，不单独转；**不转** = 仅网页 UI、JS 专属门禁、数据与许可门禁（留在 node）。', '');
  const byFile = new Map();
  for (const r of rows) {
    const k = classify(r);
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push({ ...r, ...k });
  }
  const totals = {};
  const byCard = {};
  for (const list of byFile.values()) for (const r of list) {
    totals[r.c] = (totals[r.c] || 0) + 1;
    if (r.c === T) byCard[r.card] = (byCard[r.card] || 0) + 1;
  }
  L.push(`共 ${rows.length} 个用例（${byFile.size} 个文件）：${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join('、')}。`, '');
  L.push('**按卡（转写）**：' + Object.entries(byCard).sort().map(([k, v]) => `${k} ${v}`).join('、') + '。', '');
  L.push('## 按文件', '');
  L.push('| 文件 | 用例 | 归类 | 卡 | 说明 |', '|---|---|---|---|---|');
  for (const [file, list] of byFile) {
    const f = FILES[file] || ['未归类', '?', ''];
    const mix = {};
    for (const r of list) mix[r.c] = (mix[r.c] || 0) + 1;
    const cls = Object.keys(mix).length > 1 ? Object.entries(mix).map(([k, v]) => `${k} ${v}`).join(' / ') : f[0];
    L.push(`| ${file} | ${list.length} | ${cls} | ${f[1]} | ${esc(f[2])} |`);
  }
  L.push('', '## 逐条', '');
  for (const [file, list] of byFile) {
    L.push(`### ${file}`, '');
    L.push('| # | 用例 | 归类 | 卡 |', '|---|---|---|---|');
    list.forEach((r, i) => L.push(`| ${i + 1} | ${'　'.repeat(r.nesting)}${esc(r.name)}${r.skip ? '（skip）' : ''} | ${r.c}${r.note ? '：' + esc(r.note) : ''} | ${r.card} |`));
    L.push('');
  }
  return L.join('\n');
}

const rows = collect();
const text = render(rows);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) {
    process.stdout.write(`过期：${path.relative(ROOT, OUT)}（node scripts/core-diff/transcription-list.mjs）\n`);
    process.exitCode = 1;
  } else process.stdout.write(`同步：${rows.length} 个用例\n`);
} else {
  fs.writeFileSync(OUT, text);
  process.stdout.write(`已写：${path.relative(ROOT, OUT)}（${rows.length} 个用例）\n`);
}
