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

function classify(row) {
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
