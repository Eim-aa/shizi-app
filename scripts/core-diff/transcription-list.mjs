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
  'test/core/after-seen-works.test.mjs': [T, 'B4.3', '作品出口规则（records / work-members）'],
  'test/core/arphic-compliance.test.mjs': [N, '—', '许可与随包文件门禁，留 node（数据不随 B4 变）'],
  'test/core/backup.test.mjs': [T, 'B4.4', '备份解析 / 生成；另加双向夹具（§4.4）'],
  'test/core/cards.test.mjs': [T, 'B4.3', ''],
  'test/core/compliance-removal.test.mjs': [N, '—', '题库 / 笔顺数据门禁留 node；「旧记录降级」一条转写（见逐条）'],
  'test/core/content-blocklist.test.mjs': [N, '—', '题面文字门禁，留 node'],
  'test/core/contract.test.mjs': [T, 'B4.3', 'core 产出过 schema 形状表；Swift 版对 Codable 模型 + 校验器跑同一组'],
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
  'test/core/paper-works.test.mjs': [T, 'B4.3', '图片成员部分在 B4.6 复核'],
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
  'test/core/structure.test.mjs': [T, 'B4.3', ''],
  'test/core/web-ink-golden.test.mjs': [N, '—', '已有 Swift 版（ShiziWriteTests/WebInkTests）'],
  'test/core/work-members.test.mjs': [T, 'B4.3', ''],
  'test/store/budget.test.mjs': [T, 'B4.4', ''],
  'test/store/hooks.test.mjs': [N, '—', '网页测试钩子（仅网页）'],
  'test/store/ink-schema.test.mjs': [T, 'B4.4', 'ink schema 1 → 2 迁移；Swift 版只需读两种形状'],
  'test/store/migrate.test.mjs': [T, 'B4.4', 'v1 → v2 导入'],
  'test/store/native-store.test.mjs': [N, '—', 'JS ↔ 原生 SQLite 桥与 localStorage 迁移，B4.9 随 WebEngine 退场；校验和向量已在 ShiziStoreTests'],
  'test/store/schema.test.mjs': [T, 'B4.1', 'schema.js 正反例另出金标准'],
  'test/store/storage.test.mjs': [T, 'B4.4', ''],
  'test/store/store.test.mjs': [T, 'B4.4', 'commit 语义 / 回收 / 中断矩阵；随机差分 ④ 另含写失败与撞配额注入'],
  'test/session/boundary.test.mjs': [N, '—', 'JS 导入图门禁（Swift 包只依赖 Foundation 由 Package.swift 保证）'],
  'test/ui/native-ink.test.mjs': [N, '—', '网页侧原生书写面接线（仅网页）'],
  'test/ui/native-write.test.mjs': [D, 'B4.5', '页面 API 契约 ⑤：同一输入夹具换 SwiftEngine 重跑，回包 == WebEngine'],
  'test/platform/reminder.test.mjs': [T, 'B4.5', '提醒题目选取是规则（计划 §6.2 未点名，暂归 B4.5）；syncReminder 消息体部分不转'],
  'test/platform/accessibility.test.mjs': [N, '—', '网页桥（仅网页）'],
  'test/platform/bridge.test.mjs': [N, '—', '网页桥（仅网页）'],
  'test/platform/sound.test.mjs': [N, '—', '网页声音（仅网页）'],
  'test/platform/sw.test.mjs': [N, '—', 'Service Worker（仅网页）'],
  'test/platform/text-size.test.mjs': [N, '—', '网页字号桥（仅网页）'],
};

// 逐条覆盖（文件内个别用例归类不同）：[文件, 名字正则, 归类, 卡, 说明]
const OVERRIDES = [
  ['test/core/compliance-removal.test.mjs', /old records/i, T, 'B4.2', '旧记录里的已移除字走「字不在题库」降级'],
  ['test/core/dates.test.mjs', /isValidDay|localDay|dayStartMs|addDays|monthOf|dayOfYear|period boundaries/, D, 'B4.0', '金标准 dates.json（6 时区）+ 随机差分已覆盖'],
  ['test/core/strokes.test.mjs', /glyph/i, N, '—', '网页画布纯函数（仅网页）'],
  ['test/platform/reminder.test.mjs', /payload|controller|deep link|permission/i, N, '—', '网页 → 原生消息体 / 网页桥的就绪队列与权限回调（B4 后不存在）'],
];

const SCOPE = ['test/core', 'test/store', 'test/session', 'test/platform'].flatMap((d) =>
  fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.test.mjs')).map((f) => `${d}/${f}`)).concat(['test/ui/native-ink.test.mjs', 'test/ui/native-write.test.mjs']).sort();

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
