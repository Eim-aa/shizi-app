#!/usr/bin/env node
// 出题与复习调度模拟器（r7-S1）。不是 iOS 模拟器：用真实的 src/core、policy 纯函数，模拟虚拟用户按天练习。
//
//   node scripts/sim/schedule-sim.mjs                     跑全部场景
//   node scripts/sim/schedule-sim.mjs --only S1,S3        只跑编号以 S1 / S3 开头的场景
//   node scripts/sim/schedule-sim.mjs --days 30           把每个场景的天数压到最多 30 天（快速烟测）
//   node scripts/sim/schedule-sim.mjs --out some/dir      输出目录（默认 scripts/sim/out）
//   node scripts/sim/schedule-sim.mjs --group-size 5      所有场景按「每组字数 5」跑（缺省 = 没选过，按 policy.groupSize 20）
//   node scripts/sim/schedule-sim.mjs --engine js|swift|both   规则引擎（缺省 js；swift / both 由 B4.2 接入，见 lib/engine-select.mjs）
//
// 输出（默认 scripts/sim/out/，已 .gitignore）：
//   report.md                  可读报告（场景预期 vs 实际、偏离、不变量违反、单字间隔表）
//   results.json               全部场景的汇总
//   <场景>/days.csv            每天一行：计划、字数、各来源个数、积压、三档、提醒…
//   <场景>/cards.csv           每个字每次出现一行：来源、动作、评级、下次到期日、稳定度…
//   <场景>/groups.json         每组的字及来源、之后的下次到期日与稳定度
//   <场景>/summary.json        场景汇总（含不变量违反次数与样例）
//
// 时区固定 Asia/Shanghai 保证可复现；随机数种子固定。
process.env.TZ = process.env.SIM_TZ || 'Asia/Shanghai';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from './lib/engine.mjs';
import { csvOf, summarize } from './lib/summary.mjs';
import { INVARIANTS, INVARIANT_TITLE } from './lib/invariants.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { intervalLadders } from './lib/ladders.mjs';
import { resolveSimEngine } from './lib/engine-select.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { only: null, days: null, out: path.join(HERE, 'out'), engine: 'js' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') out.only = argv[++i].split(',');
    else if (argv[i] === '--days') out.days = Number(argv[++i]);
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else if (argv[i] === '--group-size') out.groupSize = Number(argv[++i]);
    else if (argv[i] === '--engine') out.engine = argv[++i];
  }
  return out;
}

const pct = (x) => (x === null || x === undefined ? '—' : Math.round(x * 1000) / 10 + '%');

function mdTable(headers, rows) {
  const line = (cells) => '| ' + cells.map(c => String(c).replace(/\|/g, '\\|')).join(' | ') + ' |';
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function unionColumns(rows) {
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return cols;
}

function runOne(def, args) {
  const cfg = { ...def };
  if (args.days) cfg.days = Math.min(cfg.days, args.days);
  if (args.groupSize) cfg.groupSize = args.groupSize; // D65 #2：所有场景按这个「每组字数」跑（缺省 = 没选过，按 policy.groupSize）
  const res = runScenario(cfg);
  res.summary = summarize(res);
  return res;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engine = resolveSimEngine(args.engine);
  if (!engine.ok) {
    process.stderr.write(engine.message + '\n');
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(args.out, { recursive: true });
  const defs = SCENARIOS.filter(s => !args.only || args.only.some(p => s.id.startsWith(p)));
  const results = [];
  const t0 = Date.now();
  for (const def of defs) {
    const started = Date.now();
    const res = runOne(def, args);
    let baseRes = null;
    if (def.baseline) {
      baseRes = runOne({ ...def, ...def.baseline, user: { ...(def.user || {}), ...(def.baseline.user || {}) }, baseline: undefined, id: def.id + '-baseline' }, args);
    }
    const checks = (def.expect || []).map(e => {
      let r;
      try {
        r = e.check(res.summary, res, baseRes);
      } catch (error) {
        r = { ok: false, actual: '检查出错：' + error.message };
      }
      return { text: e.text, ok: r.ok, actual: r.actual };
    });
    const dir = path.join(args.out, def.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'days.csv'), csvOf(res.days, unionColumns(res.days)));
    fs.writeFileSync(path.join(dir, 'cards.csv'), csvOf(res.events));
    fs.writeFileSync(path.join(dir, 'groups.json'), JSON.stringify(res.groups, null, 1));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ id: def.id, name: def.name, summary: res.summary, checks, violations: res.violations.slice(0, 200) }, null, 1));
    results.push({ def, res, checks, baseRes, ms: Date.now() - started });
    process.stdout.write(`${def.id.padEnd(24)} ${String(Date.now() - started).padStart(6)}ms  偏离 ${checks.filter(c => !c.ok).length}/${checks.length}  不变量违反 ${Object.values(res.summary.violations).reduce((a, v) => a + v.count, 0)}\n`);
  }
  const ladders = intervalLadders();
  fs.writeFileSync(path.join(args.out, 'ladders.json'), JSON.stringify(ladders, null, 1));
  fs.writeFileSync(path.join(args.out, 'results.json'), JSON.stringify(results.map(r => ({ id: r.def.id, name: r.def.name, summary: r.res.summary, checks: r.checks })), null, 1));
  fs.writeFileSync(path.join(args.out, 'report.md'), renderReport(results, ladders, args));
  process.stdout.write(`\n报告：${path.relative(process.cwd(), path.join(args.out, 'report.md'))}（共 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n`);
}

function renderReport(results, ladders, args) {
  const L = [];
  L.push('# 调度模拟报告（自动生成）', '');
  L.push(`生成于 ${new Date().toISOString().slice(0, 10)}；时区 ${process.env.TZ}；场景 ${results.length} 个${args.days ? `（天数压到 ≤ ${args.days}，仅烟测）` : ''}。`);
  L.push('所有选字、记录、评级、间隔都由真实代码算出（`src/core` + `src/config/policy.js`），模拟器只负责「虚拟用户怎么做」。', '');
  L.push('## 总览', '');
  L.push(mdTable(['场景', '天数', '已练汉字', '每天字数(均/最大)', '积压(末30天均/最大)', '偏离预期', '不变量违反'],
    results.map(r => {
      const s = r.res.summary;
      const viol = Object.values(s.violations).reduce((a, v) => a + v.count, 0);
      return [`${r.def.id} ${r.def.name.split('（')[0]}`, s.daysTotal, s.recorded, `${s.cardsPerDayMean}/${s.cardsPerDayMax}`, `${s.backlogTailMean}/${s.backlogTailMax}`, `${r.checks.filter(c => !c.ok).length}/${r.checks.length}`, viol];
    })));
  L.push('');
  L.push('## 不变量违反汇总', '');
  const totals = {};
  for (const r of results) for (const [id, v] of Object.entries(r.res.summary.violations)) { (totals[id] = totals[id] || []).push(`${r.def.id.split('-')[0]}:${v.count}`); }
  L.push(mdTable(['不变量', '含义', '违反的场景（次数）'], INVARIANTS.map(i => [i.id, i.title, totals[i.id] ? totals[i.id].join('、') : '0'])));
  L.push('');
  L.push('## 单字间隔表（直接调用 fsrs.reviewCard，按时复习）', '');
  for (const lad of ladders) {
    L.push(`### ${lad.title}`, '');
    L.push(mdTable(['第几次', '第几天写', '怎么写的', '评级', '稳定度', '难度', '下次间隔(天)'], lad.rows.map(r => [r.n, r.day, r.how, r.rating, r.stability, r.difficulty, r.interval])));
    L.push('');
  }
  for (const r of results) {
    const s = r.res.summary;
    L.push(`## ${r.def.id} ${r.def.name}`, '');
    L.push(`用户设定：每天 ${typeof r.def.groupsPerDay === 'function' ? '（变化）' : r.def.groupsPerDay || 1} 组；写对率 ${r.res.cfg.user.accuracy}（新字 ${r.res.cfg.user.newAccuracy}）；提示 ${pct(r.res.cfg.user.hintRate)}、看答案 ${pct(r.res.cfg.user.answerRate)}、跳过 ${pct(r.res.cfg.user.skipRate)}${r.res.cfg.memory ? '；按真实遗忘曲线作答' : ''}。`, '');
    L.push('**预期 vs 实际**', '');
    L.push(mdTable(['', '产品直觉上应该', '实际'], r.checks.map(c => [c.ok ? '符合' : '**偏离**', c.text, c.actual])));
    L.push('');
    L.push(`**数字**：练了 ${s.daysPracticed}/${s.daysTotal} 天，${s.cards} 个字次（新字 ${s.newCards}、到期 ${s.dueCards}、提前复习 ${s.earlyCards}、其中写错重练 ${s.wrongRetry}、热身新字 ${s.warmCards}、特别组 ${s.specialCards}）；已练汉字 ${s.recorded}；三档（待复习/未熟悉/已熟悉）${s.zones.due}/${s.zones.shaky}/${s.zones.known}；已跳过档 ${s.skippedZone}；写对率 ${pct(s.correctRate)}，复习字写对率 ${pct(s.reviewCorrectRate)}；复习后平均下次间隔：写对 ${s.meanIntervalAfterReviewCorrect ?? '—'} 天 / 写错 ${s.meanIntervalAfterReviewWrong ?? '—'} 天；最长逾期 ${s.overdueMax} 天；提醒可选字占已调度字 ${pct(s.remindEligibleShare)}。`, '');
    if (s.wrongReturn) L.push(`**写错的字多久再见到**：${s.wrongReturn.n} 次写错；隔天就回来 ${pct(s.wrongReturn.nextDayShare)}，平均隔 ${s.wrongReturn.mean} 天，中位数 ${s.wrongReturn.median} 天，90% 分位 ${s.wrongReturn.p90} 天。`, '');
    L.push(`每组新字数分布（日常组）：${Object.entries(s.newPerGroupHist).map(([k, v]) => `${k} 个新字×${v}`).join('、') || '—'}；每组字数分布：${Object.entries(s.sizeHist).map(([k, v]) => `${k} 字×${v}`).join('、') || '—'}。`, '');
    if (r.res.memStats && r.res.memStats.reviews) {
      const m = s.memStats;
      L.push(`**用户遗忘模型下的实际记忆率**：${m.reviews} 次复习，到期时用户实际记得的概率平均 ${pct(m.predicted)}（FSRS 目标 90%）；按逾期天数：${Object.entries(m.byBucket).map(([k, v]) => `${k}天 ${pct(v.p)}（${v.n} 次）`).join('、')}。`, '');
    }
    const weeks = s.weeks.length > 14 ? s.weeks.filter((w, i) => i % Math.ceil(s.weeks.length / 12) === 0 || i === s.weeks.length - 1) : s.weeks;
    L.push(mdTable(['周', '练习天', '字次', '新字', '到期', '提前', '写对率', '周初积压均', '周末积压', '已练', '三档'], weeks.map(w => [w.week, w.practicedDays, w.cards, w.newCards, w.dueCards, w.earlyCards, w.correctRate, w.backlogStartMean, w.backlogEnd, w.recorded, w.zones])));
    L.push('');
    const first = r.res.days.slice(0, 4).filter(d => d.practiced);
    if (first.length) {
      L.push('**头几天的计划与实际**（每组：字·来源·结果·下次到期日）', '');
      for (const d of first) {
        L.push(`- 第 ${d.dayIdx + 1} 天 ${d.day}：开始时积压 ${d.backlogStart}，压力 ${d.pressureStart === '' ? '—' : d.pressureStart}，新字目标 ${d.newTargetStart === '' ? '—' : d.newTargetStart}，今日计划 ${d.todayPlan}`);
        for (const g of r.res.groups.filter(x => x.dayIdx === d.dayIdx)) {
          L.push(`  - 第 ${g.group + 1} 组${g.slot === 'B' ? '（自选）' : ''}：${g.queue.map(q => `${q.char}·${q.src}·${q.action}·${q.dueAfter ? q.dueAfter.slice(5) : ''}`).join('  ')}`);
        }
      }
      L.push('');
    }
    const vs = Object.entries(s.violations);
    if (vs.length) {
      L.push('**不变量违反**', '');
      L.push(mdTable(['不变量', '次数', '样例'], vs.map(([id, v]) => [`${id} ${INVARIANT_TITLE[id] || ''}`, v.count, v.samples.join('；')])));
      L.push('');
    } else {
      L.push('不变量：无违反。', '');
    }
    L.push(`探针：撤销跳过 ${s.probes.skipUndo.n} 次（不一致 ${s.probes.skipUndo.bad}）、更正往返 ${s.probes.correction.n} 次（不一致 ${s.probes.correction.bad}）、跳过 / 看答案不改调度表 ${s.probes.skipSeenNoSched.n} 次（不一致 ${s.probes.skipSeenNoSched.bad}）。`, '');
  }
  return L.join('\n') + '\n';
}

main();
