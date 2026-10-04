// H1-3（D51 ④、T2-09、N2-09）：首页日常状态不再放品牌「拾」，主视觉是今天的字帖行；今天还没写 / 离开一周时是本人最近写的几个字
// （本人墨迹，取最近一次留存的墨）；品牌「拾」只在首次打开与没有可显示的本人墨时出现。纯函数部分的单测（版式与量测见 e2e 81-h1-home-hero）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECENT_ROW_MAX, heroOf, homeModel } from '../../src/ui/screens/home/today.js';
import { recentInkRow } from '../../src/ui/screens/home/recent.js';

const DAY = '2026-09-24';
const at = (day, h = 9) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();

function rec(n, c, { kind = 'judged', judgment = 'correct', day = DAY, source } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's9', kind, at: at(day, 8) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  if (source) r.source = source;
  return r;
}

function state(records) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A: null, B: null, lastEnded: {} }, backupMeta: null };
}

const allInk = () => true;

test('RECENT_ROW_MAX 是 3（一行三格，与 1–3 字的字帖行同一档格宽）', () => {
  assert.equal(RECENT_ROW_MAX, 3);
});

test('recentInkRow：最近写的 3 个不同的字，按先后排（早 → 晚），每字取最近一次留有墨的那条', () => {
  const records = [rec(1, '一', { day: '2026-09-01' }), rec(2, '二', { day: '2026-09-02' }), rec(3, '三', { day: '2026-09-03' }),
    rec(4, '四', { day: '2026-09-04' }), rec(5, '二', { day: '2026-09-05' })];
  const row = recentInkRow(records, { limit: 3, hasInk: allInk });
  assert.deepEqual(row.map(r => r.char), ['三', '四', '二'], '二 最近一次在 9月5日，排在最后');
  assert.equal(row[2].id, 'r5', '同一个字取最近一次的记录');
});

test('recentInkRow：墨被回收的最近一次不算——取这个字更早、仍留有墨的那一次；整字都没有墨就跳过这个字', () => {
  const records = [rec(1, '甲', { day: '2026-09-01' }), rec(2, '甲', { day: '2026-09-10' }), rec(3, '乙', { day: '2026-09-11' }), rec(4, '丙', { day: '2026-09-12' })];
  const inked = new Set(['r1', 'r3']); // 甲 的最近一次（r002）墨已回收，乙 有墨，丙 没有
  const row = recentInkRow(records, { limit: 3, hasInk: r => inked.has(r.id) });
  assert.deepEqual(row.map(r => [r.char, r.id]), [['甲', 'r1'], ['乙', 'r3']], '丙没有墨：不进行；甲 退到有墨的 r001');
});

test('recentInkRow：只收作品成员（不收跳过 / 只看过答案没写 / 纸上记录），看后自写有墨的收', () => {
  const records = [rec(1, '甲', { kind: 'skipped' }), rec(2, '乙', { kind: 'answer-seen' }), rec(3, '丙', { source: 'paper' }), rec(4, '丁')];
  const inked = new Set(['r2', 'r3', 'r4']);
  const row = recentInkRow(records, { limit: 3, hasInk: r => inked.has(r.id) });
  assert.deepEqual(row.map(r => r.char), ['乙', '丁'], '乙 是看后自写（answer-seen 且有墨）；丙是纸上记录；甲是跳过');
});

test('recentInkRow：没有记录 / 没有墨 → 空', () => {
  assert.deepEqual(recentInkRow([], { limit: 3, hasInk: allInk }), []);
  assert.deepEqual(recentInkRow([rec(1, '一')], { limit: 3, hasInk: () => false }), []);
  assert.deepEqual(recentInkRow(null, { limit: 3, hasInk: allInk }), []);
});

test('heroOf：日常状态主视觉——今天写过 = 今天的字；今天还没写 / 离开 / 特别组没写 = 最近写的字；没有可显示的墨才是品牌「拾」', () => {
  assert.equal(heroOf('first', 'first', 3), 'shi', '首次打开永远是品牌「拾」');
  assert.equal(heroOf('fresh', 'empty', 3), 'recent');
  assert.equal(heroOf('back', 'empty', 2), 'recent');
  assert.equal(heroOf('special', 'empty', 1), 'recent', '特别组那天还没写：最近写的字，下面一句提示');
  assert.equal(heroOf('special', 'record', 3), 'today');
  assert.equal(heroOf('today', 'record', 3), 'today');
  assert.equal(heroOf('progress', 'record', 3), 'progress');
  assert.equal(heroOf('fresh', 'empty', 0), 'shi', '没有任何可显示的本人墨（清空过记录）：品牌「拾」');
  assert.equal(heroOf('back', 'empty'), 'shi', '不给最近的字数 = 没有');
});

test('homeModel：fresh / back / special 的字帖位是 recentRow（最近 3 个字），today 仍是今天的字，没有「拾」框', () => {
  const history = [rec(1, '甲', { day: '2026-09-18' }), rec(2, '乙', { day: '2026-09-19' }), rec(3, '丙', { day: '2026-09-20' }), rec(4, '丁', { day: '2026-09-21' })];
  const fresh = homeModel(state(history), at(DAY), { hasInk: allInk });
  assert.equal(fresh.view, 'fresh');
  assert.equal(fresh.hero, 'recent');
  assert.deepEqual(fresh.recentRow.map(r => r.char), ['乙', '丙', '丁']);
  assert.deepEqual(fresh.inkRow, [], 'fresh 没有今天的字');
  const back = homeModel(state(history), at('2026-10-05'), { hasInk: allInk });
  assert.equal(back.view, 'back');
  assert.equal(back.hero, 'recent');
  assert.deepEqual(back.recentRow.map(r => r.char), ['乙', '丙', '丁']);
  const todayState = homeModel(state([...history, rec(5, '戊')]), at(DAY), { hasInk: allInk });
  assert.equal(todayState.hero, 'today');
  assert.deepEqual(todayState.recentRow, [], '今天写过：不再算最近的字');
  const noInk = homeModel(state(history), at(DAY), { hasInk: () => false });
  assert.equal(noInk.hero, 'shi', '有记录但没有一条留着墨：退回品牌「拾」');
  const first = homeModel(state([]), at(DAY), { hasInk: allInk });
  assert.deepEqual([first.view, first.hero, first.recentRow], ['first', 'shi', []]);
});
