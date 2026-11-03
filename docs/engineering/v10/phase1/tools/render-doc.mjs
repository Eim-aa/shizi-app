#!/usr/bin/env node
// 把 JSON 与模拟结果填进 易忘度字表-初稿.md（或 --table=1.0 时 易忘度字表-1.0.md）里 <!-- GEN:名字 --> … <!-- /GEN:名字 --> 之间的块。
// 文档其余部分是人工撰写，不会被覆盖。文档里没有的块不生成（1.0 文档不含旧口径的 30 天模拟块）。
//
// 用法（仓库根目录，按顺序）：
//   node docs/engineering/v10/phase1/tools/build-yiwang.mjs
//   node docs/engineering/v10/phase1/tools/simulate-30d.mjs
//   node docs/engineering/v10/phase1/tools/render-doc.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = (process.argv.find((a) => a.startsWith('--table=')) || '--table=初稿').slice('--table='.length);
const MD = path.resolve(HERE, '..', '易忘度字表-' + TABLE + '.md');
const DATA = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', '易忘度字表-' + TABLE + '.json'), 'utf8'));
const MD_TEXT = fs.readFileSync(MD, 'utf8');
const HAS = (name) => MD_TEXT.includes('<!-- GEN:' + name + ' -->');
const SIM = HAS('sim') || HAS('simAgg') ? JSON.parse(fs.readFileSync(path.join(HERE, 'simulate-30d.out.json'), 'utf8')) : null;
const V1 = DATA.meta.version === '1.0';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const ctxCell = (c) => {
  const cur = c.current ? '「' + c.current + '」' : '';
  if (c.status === 'ok') return cur;
  if (c.status === 'write') return cur + ' **需新写**';
  if (!c.suggest) return cur + '（需复核，无备选）';
  return cur + ' → 「' + c.suggest + '」' + (c.status === 'review' ? '（需复核）' : V1 ? '（顾问定）' : '（建议）');
};
const rankCell = (r) => (r == null ? '未收录' : r);

function mainRow(e) {
  return `| ${e.order} | ${e.char} | ${e.py} | ${e.strokes} | ${rankCell(e.freqRank)} | ${e.norm} | ${e.score} | ${esc(e.reason)} | ${esc(ctxCell(e.context))} | ${e.warmupSuitable ? '可' : ''} |`;
}
const MAIN_HEAD = '| 序 | 字 | 拼音 | 笔画 | 字频序 | 规范 | 易忘度 | 主要理由 | 语境词 | 可作热身 |\n|---:|:-:|:-:|---:|---:|:-:|---:|---|---|:-:|';

function blocks() {
  const entries = DATA.order.map((c) => DATA.entries[c]);
  const out = {};

  out.combos = ['| 套 | 第 1 字（共鸣） | 第 2 字（更难） | 第 3 字（收尾） | 设计意图 | 预期情绪曲线 |', '|:-:|---|---|---|---|---|']
    .concat(DATA.firstCombos.map((c) => {
      const cell = (r, w) => `**${r.char}** ${r.py}「${w}」${r.strokes}画 · 字频#${r.rank} · ${r.norm} · 书写难度 ${r.writeDifficulty} · 易忘度 ${r.score}`;
      return `| ${c.id}${c.id === DATA.defaultCombo ? '（推荐）' : ''}${c.arcOk ? '' : ' ⚠弧线不成立'} | ${cell(c.rows[0], c.words[0])} | ${cell(c.rows[1], c.words[1])} | ${cell(c.rows[2], c.words[2])} | ${esc(c.intent)} | ${esc(c.curve)} |`;
    })).join('\n');

  out.top100 = MAIN_HEAD + '\n' + entries.slice(0, 100).map(mainRow).join('\n');
  out.rest = '<details><summary>第 101–' + entries.length + ' 位（点开）</summary>\n\n' + MAIN_HEAD + '\n' +
    entries.slice(100).map(mainRow).join('\n') + '\n\n</details>';

  const w = DATA.warmup.order.map((c) => DATA.warmup.entries[c]);
  const rows = [];
  for (let i = 0; i < w.length; i += 6) rows.push('| ' + w.slice(i, i + 6).map((e) => `${e.order}. **${e.char}** ${e.py} · ${e.strokes}画 · #${e.freqRank}`).join(' | ') + ' |');
  out.warmup = '| | | | | | |\n|---|---|---|---|---|---|\n' + rows.join('\n') +
    '\n\n剔除：' + (DATA.meta.warmupDropped.length ? DATA.meta.warmupDropped.join('、') : '无');

  out.l2 = MAIN_HEAD + '\n' + DATA.level2Appendix.map(mainRow).join('\n');

  // 统计
  const tiers = {}; const cats = {}; let noCat = 0; const ctx = {};
  for (const e of entries) {
    tiers[e.tier] = (tiers[e.tier] || 0) + 1;
    if (e.detail.handwriting.length) for (const k of e.detail.handwriting) cats[k] = (cats[k] || 0) + 1; else noCat++;
    ctx[e.context.status] = (ctx[e.context.status] || 0) + 1;
  }
  const scores = entries.map((e) => e.score).sort((a, b) => a - b);
  const q = (p) => scores[Math.floor(p * (scores.length - 1))];
  const ranks = entries.map((e) => e.freqRank).filter((x) => x != null).sort((a, b) => a - b);
  const qr = (p) => ranks[Math.floor(p * (ranks.length - 1))];
  const strokes = entries.map((e) => e.strokes).sort((a, b) => a - b);
  out.stats = [
    `- 一级 3500 字过门槛（字频序 ≥ 400 或人工清单；笔画 ≥ 7 或人工清单）的有 ${DATA.meta.l1Candidates} 字，按易忘度取前 ${entries.length} 字；入选线 ${DATA.meta.scoreCutoff} 分。`,
    `- 易忘度分：最低 ${q(0)}、四分位 ${q(0.25)} / ${q(0.5)} / ${q(0.75)}、最高 ${q(1)}。`,
    `- 字频序：最小 ${qr(0)}、中位 ${qr(0.5)}、最大 ${qr(1)}；笔画：最少 ${strokes[0]}、中位 ${strokes[Math.floor(strokes.length / 2)]}、最多 ${strokes[strokes.length - 1]}。`,
    `- 难度档（只用于排序交错）：≥16 画 ${tiers.hard || 0}、12–15 画 ${tiers.mid || 0}、≤11 画 ${tiers.light || 0}。`,
    `- 命中人工手写场景：${Object.entries(cats).map(([k, v]) => k + ' ' + v).join('、')}；未命中任何场景 ${noCat} 字（靠数据信号入选）。`,
    V1
      ? `- 语境词：沿用题库现有词 ${ctx.ok || 0}、顾问审定换词 ${ctx.suggest || 0}、需复核 ${ctx.review || 0}、需新写 ${ctx.write || 0}（见 §4）。`
      : `- 语境词：可直接用 ${ctx.ok || 0}、有人工建议 ${ctx.suggest || 0}、需复核 ${ctx.review || 0}、需新写 ${ctx.write || 0}（见 §6）。`,
  ].join('\n');

  const warmEntries = DATA.warmup.order.map((c) => DATA.warmup.entries[c]);
  const ctxRows = V1 ? [...entries, ...warmEntries.map((e) => ({ ...e, char: e.char + '（热身）' })), ...DATA.level2Appendix.map((e) => ({ ...e, char: e.char + '（二级）' }))] : entries;
  out.ctx = '| 字 | 现有语境词 | 问题 | ' + (V1 ? '审定' : '建议') + ' | 其他备选（jieba） |\n|:-:|---|---|---|---|\n' + ctxRows
    .filter((e) => e.context.status !== 'ok')
    .map((e) => `| ${e.char} | ${esc(e.context.current)} | ${esc(e.context.why.join('；') || '起草者建议换更日常的词')} | ${esc(e.context.suggest ? e.context.suggest + '（' + (V1 && e.context.suggestSource === '人工' ? '顾问定' : e.context.suggestSource) + '）' : '需新写')} | ${esc((e.context.alts || []).join('、'))} |`)
    .join('\n');

  if (!SIM) return out;
  // 模拟
  const sim = SIM;
  const kindLabel = { 首练: '首练', 热身: '热身', 复习: '复习', 新: '新' };
  out.sim = '参数：首练组合 ' + sim.params.combo + '，每天 ' + sim.params.groupsPerDay + ' 组（第 1 天首练后「再写一组」1 组），组大小 ' + sim.params.size +
    '，随机种子 ' + sim.params.seed + '，开始日 ' + sim.params.start + '。标记：〔热身〕〔复习〕〔首练〕；无标记 = 新的策划字；✗ = 模拟中写错。\n\n' +
    '| 天 | 日期 | 队列 |\n|:-:|:-:|---|\n' +
    sim.representative.map((d) => `| 第 ${d.day} 天 | ${d.date} | ${d.groups.map((g) => g.map((it) => it.ch + (it.kind === '新' ? '' : '〔' + kindLabel[it.kind] + '〕') + (it.ok ? '' : '✗')).join(' ')).join(' ｜ ')} |`).join('\n');

  const variants = [
    ['默认：每天 1 组', []],
    ['每天 2 组', ['--groups=2']],
    ['每组复习最多 3 个（留 2 个新字位）', ['--review-cap=3']],
    ['新字写对概率整体 +0.2', ['--pshift=0.2']],
  ];
  const vr = variants.map(([label, a]) => {
    const j = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'simulate-30d.mjs'), ...a, '--no-write', '--stdout-json'], { encoding: 'utf8' }));
    const ag = j.aggregate;
    const day = (d) => ag.kindsPerDay.find((x) => x.day === d).avg;
    const fmtDay = (d) => { const x = day(d); return `热${x['热身']}/复${x['复习']}/新${x['新']}`; };
    return `| ${label} | ${ag.curatedIntroducedBy30.median}（${ag.curatedIntroducedBy30.min}–${ag.curatedIntroducedBy30.max}） | ${ag.warmIntroducedBy30.median} | ${fmtDay(2)} | ${fmtDay(3)} | ${fmtDay(7)} | ${fmtDay(30)} | ${ag.violations.groupsWithMoreThanOneHighFreq} / ${ag.violations.top100Appear} / ${ag.violations.adjacentHighFreq} |`;
  });
  out.simAgg = `每种设定各随机 ${sim.params.runs} 次（种子 ${sim.params.seed}–${sim.params.seed + sim.params.runs - 1}）。「高频字」= 热身表里的字 ∪ 字频序 < ${sim.params.highFreqRank} 的字。\n\n` +
    '| 设定 | 30 天内出过的新策划字（中位，范围） | 新热身字（中位） | 第 2 天平均构成 | 第 3 天 | 第 7 天 | 第 30 天 | 违规：一组 >1 高频 / 字频前 100 出现 / 同日高频字相邻 |\n|---|---:|---:|---|---|---|---|---|\n' +
    vr.join('\n');
  return out;
}

let md = MD_TEXT;
const b = blocks();
for (const [name, body] of Object.entries(b)) {
  const re = new RegExp(`(<!-- GEN:${name} -->)[\\s\\S]*?(<!-- /GEN:${name} -->)`);
  if (!re.test(md)) { if (!V1) console.warn('missing block', name); continue; }
  md = md.replace(re, `$1\n${body}\n$2`);
}
fs.writeFileSync(MD, md);
console.log('rendered', path.basename(MD), Object.keys(b).join(','));
