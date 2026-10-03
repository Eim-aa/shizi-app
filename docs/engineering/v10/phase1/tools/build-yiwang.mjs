#!/usr/bin/env node
// 「易忘度」候选字表生成器（P1-C1 初稿，D28）。只读仓库数据，只写 phase1/ 下的产物。
//
// 用法（仓库根目录）：
//   node docs/engineering/v10/phase1/tools/build-yiwang.mjs
// 产物：
//   docs/engineering/v10/phase1/易忘度字表-初稿.json
//
// 输入（全部只读）：
//   deck-data.js                         SEED（字、语境词 ans/ci、py、rank、strokes、norm、topic、ctx）
//   data/context-overrides.js            运行时语境覆盖（w/ci 换词、gloss）
//   generated/selected_8105_candidates.json  每字 IDS 拆分 decomposition、MMAH 首读音
//   sources/make-me-a-hanzi-dict.txt     部件的递归拆分与全部读音
//   sources/jieba_dict.txt               含该字的词与词频（「常见词里的字」与备选语境词）
//   tools/curation.mjs                   人工判断清单（部件陷阱、形近字组、手写场景、共鸣加成、热身排除、首练组合）
//
// 打分定义见 易忘度字表-初稿.md §2；此处每个函数头注释与文档一一对应。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as CUR from './curation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const OUT_DIR = path.resolve(HERE, '..');
const OUT_JSON = path.join(OUT_DIR, '易忘度字表-初稿.json');

const POOL_SIZE = 500;
const L2_APPENDIX_SIZE = 40;
const WARMUP_SIZE = 100;

// ---------------------------------------------------------------- 读输入
function sha12(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 12);
}
function loadSeed() {
  const src = fs.readFileSync(path.join(ROOT, 'deck-data.js'), 'utf8');
  return new Function(src + ';return SEED;')();
}
function loadOverrides() {
  const src = fs.readFileSync(path.join(ROOT, 'data/context-overrides.js'), 'utf8');
  return new Function(src + ';return CONTEXT_OVERRIDES;')();
}
function loadCandidates() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'generated/selected_8105_candidates.json'), 'utf8'));
  const m = new Map();
  for (const c of j.selected) m.set(c.character, c);
  return m;
}
function loadMMAH() {
  const m = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, 'sources/make-me-a-hanzi-dict.txt'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    m.set(o.character, { decomposition: o.decomposition || '？', pinyin: o.pinyin || [] });
  }
  return m;
}
function loadJieba(charSet) {
  // char -> [{word, freq, tag}]，只收 2–4 字、目标字只出现一次的词
  const idx = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, 'sources/jieba_dict.txt'), 'utf8').split('\n')) {
    const parts = line.split(' ');
    if (parts.length < 2) continue;
    const word = parts[0];
    const len = [...word].length;
    if (len < 2 || len > 4) continue;
    if (!/^[㐀-鿿\u{20000}-\u{3134f}]+$/u.test(word)) continue;
    const freq = Number(parts[1]) || 0;
    const tag = parts[2] || '';
    const seen = new Set();
    for (const ch of word) {
      if (seen.has(ch) || !charSet.has(ch)) continue;
      seen.add(ch);
      if (word.split(ch).length - 1 !== 1) continue;
      if (!idx.has(ch)) idx.set(ch, []);
      idx.get(ch).push({ word, freq, tag });
    }
  }
  for (const list of idx.values()) list.sort((a, b) => b.freq - a.freq);
  return idx;
}

// ---------------------------------------------------------------- IDS 工具
const IDC = new Set([...'⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻']);
const SURROUND = { '⿴': '全包围', '⿵': '三面包围', '⿶': '三面包围', '⿷': '三面包围', '⿸': '半包围', '⿹': '半包围', '⿺': '半包围', '⿻': '穿插' };
function leavesOf(ids) {
  return [...(ids || '')].filter((ch) => !IDC.has(ch) && ch !== '？');
}
function unknownCount(ids) {
  return [...(ids || '')].filter((ch) => ch === '？').length;
}
function recursiveComponents(ch, mmah, depth = 0, acc = new Set()) {
  if (depth > 3) return acc;
  const d = mmah.get(ch);
  if (!d) return acc;
  for (const leaf of leavesOf(d.decomposition)) {
    if (leaf === ch || acc.has(leaf)) continue;
    acc.add(leaf);
    recursiveComponents(leaf, mmah, depth + 1, acc);
  }
  return acc;
}
function toneless(py) {
  return py.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'v').toLowerCase();
}

// ---------------------------------------------------------------- 信号
// F 字频适中（0–1）：rank 为题库 rank（hanzi_db frequency_rank）。
//   rank < 400 → 0（成年人几乎不会忘，留给热身）；400–1500 线性 0→1；1500–3500 → 1；
//   3500–5500 线性 1→0.4；> 5500 → 0.3（日常不太读到）；未收录（≥999999）→ 0.5 并标注。
export function signalF(rank) {
  if (rank >= 999999) return 0.5;
  if (rank < 400) return 0;
  if (rank < 1500) return (rank - 400) / 1100;
  if (rank <= 3500) return 1;
  if (rank <= 5500) return 1 - 0.6 * (rank - 3500) / 2000;
  return 0.3;
}
// S 笔画（0–1）：≤6 画 0；7–8 画 0.15；≥9 画 0.35 起，每多一画 +0.65/9，18 画及以上为 1。
export function signalS(strokes) {
  if (strokes <= 6) return 0;
  if (strokes <= 8) return 0.15;
  return Math.min(1, 0.35 + 0.65 * (strokes - 9) / 9);
}
// C 结构与部件（0–1，各项相加封顶 1）：
//   包围结构 +0.25（穿插 ⿻ +0.35）；三分结构 ⿲⿳ +0.2；
//   部件数（把每个直接部件再按 Make Me a Hanzi 展开一层后的末级部件数，「？」也算一个）≥5 +0.3、4 +0.2、3 +0.1；
//   含不成字部件（IDS「？」）+0.25；部件陷阱（curation.COMPONENT_TRAPS，人工）每个 +0.3、最多 +0.45；
//   同一部件重复出现 +0.1。
function signalC(ids, comps, expandedCount) {
  const parts = [];
  let v = 0;
  const idcs = [...ids].filter((ch) => IDC.has(ch));
  const sur = idcs.find((x) => SURROUND[x]);
  if (sur) {
    v += sur === '⿻' ? 0.35 : 0.25;
    parts.push(SURROUND[sur] + '结构');
  }
  if (idcs.some((x) => x === '⿲' || x === '⿳')) {
    v += 0.2;
    parts.push(idcs.includes('⿲') ? '左中右三分' : '上中下三分');
  }
  const leaves = leavesOf(ids);
  const n = expandedCount;
  if (n >= 5) { v += 0.3; parts.push('展开后' + n + '个部件'); } else if (n === 4) { v += 0.2; parts.push('展开后4个部件'); } else if (n === 3) { v += 0.1; }
  if (unknownCount(ids) > 0) { v += 0.25; parts.push('含叫不出名字的部件'); }
  const traps = Object.keys(CUR.COMPONENT_TRAPS).filter((t) => comps.has(t));
  if (traps.length) v += Math.min(0.45, 0.3 * traps.length);
  if (new Set(leaves).size < leaves.length) { v += 0.1; parts.push('部件重复'); }
  return { v: Math.min(1, v), parts, traps };
}
// H 同音形近干扰（0–1）：
//   计算部分：一级/二级字中字频序 ≤ 4000（日常读得到）、与本字有共同读音（去调，取 Make Me a Hanzi 全部读音）
//   且共享一个直接部件的字数 k，得分 min(1, k/4)；人工部分：在 curation.FORM_GROUPS 形近字组里 +0.5。封顶 1。
function signalH(ch, ctx) {
  const { mmah, l12, directLeaves } = ctx;
  const myPy = new Set((mmah.get(ch)?.pinyin || []).map(toneless));
  const myLeaves = new Set(directLeaves(ch));
  const homo = [];
  if (myPy.size && myLeaves.size) {
    for (const other of l12) {
      if (other === ch || !(ctx.rankOf(other) <= 4000)) continue;
      const py = (mmah.get(other)?.pinyin || []).map(toneless);
      if (!py.some((p) => myPy.has(p))) continue;
      if (!directLeaves(other).some((l) => myLeaves.has(l))) continue;
      homo.push(other);
    }
  }
  const group = CUR.FORM_GROUPS.find((g) => g.includes(ch));
  const formPeers = group ? group.filter((x) => x !== ch) : [];
  const v = Math.min(1, Math.min(1, homo.length / 4) + (formPeers.length ? 0.5 : 0));
  return { v, homo, formPeers };
}
// W 手写场景（0–1）：人工分类（curation.HANDWRITING）命中 → 该类 weight（0.6–1.0，多类取最大）；
//   否则用「常见词里的字」数据代理：含该字的 jieba 词里最高词频 f，0.6 × clamp((log10 f − 2) / 3, 0, 1)
//   （f=100 → 0，f=100000 → 0.6）。
function signalW(ch, jieba) {
  const cats = Object.entries(CUR.HANDWRITING).filter(([, c]) => c.chars.includes(ch)).map(([k]) => k);
  const top = (jieba.get(ch) || [])[0];
  const f = top ? top.freq : 0;
  const proxy = f > 0 ? 0.6 * Math.max(0, Math.min(1, (Math.log10(f) - 2) / 3)) : 0;
  const catW = Math.max(0, ...cats.map((k) => CUR.HANDWRITING[k].weight));
  return { v: Math.max(catW, proxy), cats, topWord: top ? top.word : null, topFreq: f };
}

export const WEIGHTS = Object.freeze({ F: 0.22, S: 0.22, C: 0.26, H: 0.12, W: 0.18 });
export const RESONANCE_BONUS = 6;

// ---------------------------------------------------------------- 语境词
const PROPER_TAGS = new Set(['nr', 'nrt', 'nrfg', 'ns', 'nt', 'nz', 'j']);
function contextOf(card, overrides, jieba) {
  const ch = card.target;
  let ans = card.ans;
  let ci = card.ci;
  let source = card.ctx;
  const ov = overrides[ch];
  if (ov && ov.w && Number.isInteger(ov.ci) && [...ov.w][ov.ci] === ch) { ans = ov.w; ci = ov.ci; source = 'override(runtime)'; }
  else if (ov && ov.gloss) { source = 'gloss'; }
  const list = jieba.get(ch) || [];
  const cur = list.find((x) => x.word === ans);
  // 备选词：jieba 里含该字、2–3 字、词性不是专名/简称的高频词（jieba 词性有噪声，仅供顾问参考）
  const alts = list.filter((x) => x.word !== ans && [...x.word].length <= 3 && !PROPER_TAGS.has(x.tag)).slice(0, 3).map((x) => x.word);
  const manual = CUR.CONTEXT_SUGGEST[ch] || null;
  let status = 'ok';
  const why = [];
  if (source === 'fallback') { status = 'write'; why.push('现有为「X字」兜底'); }
  else if (CUR.CONTEXT_WRITE[ch]) { status = 'write'; why.push(CUR.CONTEXT_WRITE[ch]); }
  else if (source === 'gloss') { status = 'review'; why.push('现为释义题'); }
  else {
    if (cur && PROPER_TAGS.has(cur.tag)) { status = 'review'; why.push('现有词在 jieba 里标为专名/简称（' + cur.tag + '）'); }
    if (cur && list[0] && cur.freq * 10 < list[0].freq) { status = 'review'; why.push('现有词词频远低于「' + list[0].word + '」'); }
    if ((ans.split(ch).length - 1) > 1) { status = 'review'; why.push('语境词里目标字出现两次'); }
  }
  // 人工确认：CONTEXT_SUGGEST 与现有词相同 = 起草者确认现有词可用（jieba 词性噪声，如「希冀」被标 nr）；
  // 「写地址」类的字，地名语境本身就是手写场景，不因专名标记而复核。
  const addressChar = CUR.HANDWRITING['写地址'].chars.includes(ch);
  if (status === 'review' && ((manual && manual === ans) || (addressChar && cur && PROPER_TAGS.has(cur.tag) && why.length === 1))) {
    status = 'ok'; why.length = 0;
  }
  if (manual && manual !== ans) { status = status === 'ok' ? 'suggest' : status; }
  const suggest = manual && manual !== ans ? manual : (status === 'ok' || status === 'write' ? null : alts[0] || null);
  return {
    current: ans, ci, source, status, why,
    suggest, suggestSource: manual && manual !== ans ? '人工' : suggest ? 'jieba 高频词' : null,
    alts,
  };
}

// ---------------------------------------------------------------- 一句话理由
function reasonOf(e) {
  const bits = [];
  bits.push(e.strokes + '画');
  if (e.sig.C.parts.length) bits.push(e.sig.C.parts.slice(0, 2).join('、'));
  if (e.sig.C.traps.length) bits.push(CUR.COMPONENT_TRAPS[e.sig.C.traps[0]]);
  if (e.sig.H.formPeers.length) bits.push('易与「' + e.sig.H.formPeers.slice(0, 3).join('') + '」混');
  else if (e.sig.H.homo.length >= 2) bits.push('同音形近字多（' + e.sig.H.homo.slice(0, 3).join('、') + '）');
  if (e.sig.W.cats.length) bits.push('手写场景：' + e.sig.W.cats.join('、'));
  if (e.resonance) bits.push('共鸣字（人工）');
  if (e.rank >= 999999) bits.push('字频未收录');
  return bits.join('；');
}

// ---------------------------------------------------------------- 主流程
function main() {
  const seed = loadSeed();
  const overrides = loadOverrides();
  const cand = loadCandidates();
  const mmah = loadMMAH();
  const byChar = new Map(seed.map((c) => [c.target, c]));
  const l1 = seed.filter((c) => c.norm === '一级');
  const l2 = seed.filter((c) => c.norm === '二级');
  const l12 = [...l1, ...l2].map((c) => c.target);
  const jieba = loadJieba(new Set(l12));

  const leafCache = new Map();
  const directLeaves = (ch) => {
    if (!leafCache.has(ch)) leafCache.set(ch, leavesOf((cand.get(ch) || mmah.get(ch) || {}).decomposition));
    return leafCache.get(ch);
  };
  const hctx = { mmah, l12, directLeaves, rankOf: (ch) => (byChar.get(ch) || {}).rank };
  const expandedCount = (ids) => {
    let n = unknownCount(ids);
    for (const leaf of leavesOf(ids)) {
      const sub = mmah.get(leaf);
      const subLeaves = sub ? leavesOf(sub.decomposition) : [];
      const subUnknown = sub ? unknownCount(sub.decomposition) : 0;
      n += subLeaves.length + subUnknown >= 2 ? subLeaves.length + subUnknown : 1;
    }
    return n;
  };

  const manualChars = new Set([...Object.values(CUR.HANDWRITING).map((c) => c.chars).join(''), ...CUR.RESONANCE]);

  function score(card) {
    const ch = card.target;
    const ids = (cand.get(ch) || {}).decomposition || '？';
    const comps = recursiveComponents(ch, mmah);
    const sig = {
      F: signalF(card.rank),
      S: signalS(card.strokes),
      C: signalC(ids, comps, expandedCount(ids)),
      H: signalH(ch, hctx),
      W: signalW(ch, jieba),
    };
    const base = 100 * (WEIGHTS.F * sig.F + WEIGHTS.S * sig.S + WEIGHTS.C * sig.C.v + WEIGHTS.H * sig.H.v + WEIGHTS.W * sig.W.v);
    const resonance = CUR.RESONANCE.includes(ch);
    const total = Math.round((base + (resonance ? RESONANCE_BONUS : 0)) * 10) / 10;
    const e = {
      char: ch, py: card.py, pinyinDict: (cand.get(ch) || {}).pinyin || null, strokes: card.strokes, rank: card.rank,
      norm: card.norm, edu: card.edu, topic: card.topic, ids, sig, resonance, score: total,
      context: contextOf(card, overrides, jieba),
    };
    e.reason = reasonOf(e);
    return e;
  }

  // ---- 一级候选池
  const gate = (c) => {
    const manual = manualChars.has(c.target);
    return (c.rank >= 400 || manual) && (c.strokes >= 7 || manual);
  };
  const scoredL1 = l1.filter(gate).map(score).sort((a, b) => b.score - a.score || a.rank - b.rank);
  const pool = scoredL1.slice(0, POOL_SIZE);
  const cutoff = pool[pool.length - 1].score;

  // ---- 排序：分高优先 + 每 4 个策划字按「中—难—中—易」交错，避免难字扎堆；窗口内去重（同词、同陷阱部件、同形近组、同类专名）
  const tierOf = (e) => (e.strokes >= 16 ? 'hard' : e.strokes >= 12 ? 'mid' : 'light');
  const PATTERN = ['mid', 'hard', 'mid', 'light'];
  const FALLBACK = { hard: ['mid', 'light'], mid: ['hard', 'light'], light: ['mid', 'hard'] };
  const SPREAD_CATS = new Set(['记账票据', '写地址', '签名姓氏']);
  const remaining = [...pool];
  const order = [];
  const conflicts = (e, win) => win.some((o) => {
    if (o.context.current === e.context.current) return true;
    if (o.sig.C.traps.some((t) => e.sig.C.traps.includes(t))) return true;
    if (o.sig.H.formPeers.includes(e.char)) return true;
    if (o.sig.W.cats.some((k) => SPREAD_CATS.has(k) && e.sig.W.cats.includes(k))) return true;
    return false;
  });
  // 挑选优先级：前 EARLY_RESONANCE_POSITIONS 位共鸣字 +EARLY_RESONANCE_PICK；前 EARLY_AVOID_POSITIONS 位跳过 EARLY_AVOID。
  const pickKey = (e, pos) => e.score + (pos < CUR.EARLY_RESONANCE_POSITIONS && e.resonance ? CUR.EARLY_RESONANCE_PICK : 0);
  while (remaining.length) {
    const pos = order.length;
    const want = PATTERN[pos % 4];
    const win = order.slice(-3);
    const allowed = (e) => !(pos < CUR.EARLY_AVOID_POSITIONS && CUR.EARLY_AVOID.includes(e.char));
    const ranked = [...remaining].sort((a, b) => pickKey(b, pos) - pickKey(a, pos) || a.rank - b.rank);
    let pick = null;
    for (const tier of [want, ...FALLBACK[want]]) {
      pick = ranked.find((e) => tierOf(e) === tier && allowed(e) && !conflicts(e, win));
      if (pick) break;
    }
    if (!pick) pick = ranked.find((e) => allowed(e) && !conflicts(e, win)) || ranked.find(allowed) || ranked[0];
    remaining.splice(remaining.indexOf(pick), 1);
    order.push(pick);
  }

  // ---- 二级附录（不在默认库）
  const l2Scored = l2
    .filter((c) => c.strokes >= 7 && c.ctx !== 'fallback')
    .filter((c) => manualChars.has(c.target) || (c.rank <= 4200 && ((jieba.get(c.target) || []).find((x) => !PROPER_TAGS.has(x.tag)) || { freq: 0 }).freq >= 500))
    .map(score)
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, L2_APPENDIX_SIZE);

  // ---- 热身字（curation.WARMUP 人工挑选；此处只做数据校验与按行轮流排序）
  const poolSet = new Set(pool.map((e) => e.char));
  const warmDropped = [];
  const warmRows = CUR.WARMUP.map((row) => [...row].filter((ch) => {
    const c = byChar.get(ch);
    const why = !c ? '不在题库' : c.norm !== '一级' ? '不在一级' : c.rank < 100 ? '字频序<100，与「的一是」同档' : c.rank > 2100 ? '字频序>2100' : c.strokes < 5 ? '少于5画' : poolSet.has(ch) ? '已在候选池' : null;
    if (why) warmDropped.push(ch + '（' + why + '）');
    return !why;
  }));
  const warm = [];
  for (let i = 0; warmRows.some((r) => r.length > i); i++) for (const r of warmRows) if (r[i]) warm.push({ c: byChar.get(r[i]), row: CUR.WARMUP.findIndex((x) => x.includes(r[i])) + 1 });

  // ---- 首练组合校验
  const combos = CUR.FIRST_COMBOS.map((combo) => {
    const rows = combo.chars.map((ch) => {
      const card = byChar.get(ch);
      if (!card) throw new Error('首练字不在题库：' + ch);
      if (card.norm !== '一级') throw new Error('首练字不在默认库（一级）：' + ch + ' ' + card.norm);
      const e = score(card);
      // 书写难度（只用于检查首练弧线）：0.5 × S + 0.5 × C，×100。不含字频与场景，所以和易忘度分不同。
      const writeDifficulty = Math.round(100 * (0.5 * e.sig.S + 0.5 * e.sig.C.v));
      return { char: ch, py: card.py, strokes: card.strokes, rank: card.rank, norm: card.norm, score: e.score, writeDifficulty, deckWord: card.ans, ids: e.ids };
    });
    // 弧线检查：第 2 字书写难度 ≥ 第 1 字 > 第 3 字
    const [a, b, c] = rows.map((r) => r.writeDifficulty);
    const arcOk = b >= a && a > c;
    if (!arcOk) console.warn('首练组合 ' + combo.id + ' 书写难度不成弧线：', rows.map((r) => r.char + r.writeDifficulty).join(' '));
    return { ...combo, rows, arcOk };
  });

  // ---- 输出
  const entryOut = (e, i) => ({
    order: i + 1,
    char: e.char,
    py: e.py,
    strokes: e.strokes,
    freqRank: e.rank >= 999999 ? null : e.rank,
    norm: e.norm,
    score: e.score,
    signals: {
      F: round(e.sig.F), S: round(e.sig.S), C: round(e.sig.C.v), H: round(e.sig.H.v), W: round(e.sig.W.v),
      resonanceBonus: e.resonance ? RESONANCE_BONUS : 0,
    },
    detail: {
      ids: e.ids,
      structure: e.sig.C.parts,
      traps: e.sig.C.traps,
      homophoneShapePeers: e.sig.H.homo.slice(0, 6),
      formPeers: e.sig.H.formPeers,
      handwriting: e.sig.W.cats,
      topJiebaWord: e.sig.W.topWord,
    },
    reason: e.reason,
    context: e.context,
    tier: tierOf(e),
    warmup: false,
    warmupSuitable: false,
  });
  const out = {
    meta: {
      title: '易忘度候选字表初稿（P1-C1）',
      status: 'draft — 待产品负责人与语文/书法顾问审读；未经用户验证',
      decision: 'D28',
      generatedBy: 'docs/engineering/v10/phase1/tools/build-yiwang.mjs',
      inputs: Object.fromEntries(['deck-data.js', 'data/context-overrides.js', 'generated/selected_8105_candidates.json',
        'sources/make-me-a-hanzi-dict.txt', 'sources/jieba_dict.txt', 'docs/engineering/v10/phase1/tools/curation.mjs']
        .map((f) => [f, sha12(f)])),
      weights: WEIGHTS,
      resonanceBonus: RESONANCE_BONUS,
      poolSize: pool.length,
      poolGate: 'norm=一级 且 (rank≥400 或 人工清单) 且 (笔画≥7 或 人工清单)',
      scoreCutoff: cutoff,
      orderRule: '分高优先；每 4 个策划字按 中(12–15画)—难(≥16画)—中—易(≤11画) 交错；最近 3 字内不重复同一语境词、同一陷阱部件、同一形近组、同一类（记账/地址/姓氏）',
      warmupRule: '人工挑选（curation.WARMUP），校验：一级、100 ≤ 字频序 ≤ 2100、≥5 画、不在候选池；按主题行轮流排序；每组至多 1 个、放组首',
      warmupDropped: warmDropped,
      earlyRules: { avoid: CUR.EARLY_AVOID, avoidPositions: CUR.EARLY_AVOID_POSITIONS, resonancePositions: CUR.EARLY_RESONANCE_POSITIONS, resonancePick: CUR.EARLY_RESONANCE_PICK },
      l1Candidates: scoredL1.length,
    },
    order: order.map((e) => e.char),
    entries: Object.fromEntries(order.map((e, i) => [e.char, entryOut(e, i)])),
    warmup: {
      order: warm.map((x) => x.c.target),
      entries: Object.fromEntries(warm.map((x, i) => [x.c.target, {
        order: i + 1, char: x.c.target, py: x.c.py, strokes: x.c.strokes, freqRank: x.c.rank, norm: x.c.norm,
        topic: x.c.topic, themeRow: x.row, context: { current: x.c.ans, ci: x.c.ci, source: x.c.ctx }, warmup: true,
      }])),
    },
    level2Appendix: l2Scored.map((e, i) => ({ ...entryOut(e, i), note: '二级，不在默认库 core3500；仅当用户字库含二级时可用' })),
    firstCombos: combos,
    defaultCombo: CUR.DEFAULT_COMBO,
  };
  // 候选池里也标出「可作热身」（低分区、笔画少的字）：分低于池中位数且 ≤10 画
  const median = [...pool].sort((a, b) => a.score - b.score)[Math.floor(pool.length / 2)].score;
  for (const e of order) if (e.score < median && e.strokes <= 10) out.entries[e.char].warmupSuitable = true;

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', path.relative(ROOT, OUT_JSON));
  console.log('L1 gated', scoredL1.length, 'pool', pool.length, 'cutoff', cutoff, 'median', median);
  console.log('top30', order.slice(0, 30).map((e) => e.char).join(''));
  console.log('top30 by score', pool.slice(0, 30).map((e) => e.char + e.score).join(' '));
  console.log('warmup', warm.length, warm.map((x) => x.c.target).join(''), 'dropped', warmDropped.join(' '));
  console.log('L2', l2Scored.map((e) => e.char).join(''));
  const ctxStat = {};
  for (const e of order) ctxStat[e.context.status] = (ctxStat[e.context.status] || 0) + 1;
  console.log('context status', ctxStat);
}
function round(x) { return Math.round(x * 100) / 100; }

main();
