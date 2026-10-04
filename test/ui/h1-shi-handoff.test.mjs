// H1-4（D51 ④、N2-02；03 P221）：「拾」的交接——首练写下「拾」后第一次回首页，品牌「拾」的位置换成本人写的「拾」（只一次）。
// 纯函数部分：何时该交接、「只发生一次」的记录（settings.shiHandoffDone / schema）、homeModel 带出交接记录、文案里「拾回」只出现一次。
// 渲染（淡入 ≤ 300ms、减少动态效果直接替换、离开首页才收）见 e2e 81-h1-shi-handoff。
import test from 'node:test';
import assert from 'node:assert/strict';
import { commitShiHandoffDone, shiCardKey, shiHandoffRecord } from '../../src/ui/screens/home/handoff.js';
import { homeModel } from '../../src/ui/screens/home/today.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { COPY, t } from '../../src/config/copy/index.js';

const DAY = '2026-10-05';
const at = (day, h = 9) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();
const SHI = t('X-HOME.shiLabel');

function rec(n, c, { kind = 'judged', judgment = 'correct', day = DAY, source } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's1', kind, at: at(day, 8) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  if (source) r.source = source;
  return r;
}
const allInk = () => true;
const firstPractice = [rec(1, '尴'), rec(2, '赢'), rec(3, SHI)];

test('shiCardKey：base:拾（字取自文案表，代码里没有汉字字面量）', () => {
  assert.equal(shiCardKey(), `base:${SHI}`);
  assert.equal(SHI, '拾');
});

test('shiHandoffRecord：首练当天、写了「拾」且留有墨、没交接过 → 返回那条记录', () => {
  const got = shiHandoffRecord({ settings: null, records: firstPractice, today: DAY, hasInk: allInk });
  assert.equal(got && got.id, 'r3');
  assert.equal(shiHandoffRecord({ settings: {}, records: firstPractice, today: DAY, hasInk: allInk }).id, 'r3');
  assert.equal(shiHandoffRecord({ settings: { shiHandoffDone: false }, records: firstPractice, today: DAY, hasInk: allInk }).id, 'r3');
});

test('shiHandoffRecord：只发生一次——交接过（shiHandoffDone）就不再', () => {
  assert.equal(shiHandoffRecord({ settings: { shiHandoffDone: true }, records: firstPractice, today: DAY, hasInk: allInk }), null);
});

test('shiHandoffRecord：没写「拾」（跳过 / 只看过答案没写 / 纸上）、「拾」没有墨 → 不交接', () => {
  const skipped = [rec(1, '尴'), rec(2, '赢'), rec(3, SHI, { kind: 'skipped' })];
  assert.equal(shiHandoffRecord({ records: skipped, today: DAY, hasInk: allInk }), null);
  const seen = [rec(1, '尴'), rec(2, '赢'), rec(3, SHI, { kind: 'answer-seen' })];
  assert.equal(shiHandoffRecord({ records: seen, today: DAY, hasInk: () => false }), null, '看过答案没写自己的一遍');
  assert.equal(shiHandoffRecord({ records: seen, today: DAY, hasInk: r => r.id === 'r3' }).id, 'r3', '看后自写有墨：算本人写的「拾」');
  const paper = [rec(1, '尴'), rec(2, '赢'), rec(3, SHI, { source: 'paper' })];
  assert.equal(shiHandoffRecord({ records: paper, today: DAY, hasInk: allInk }), null, '纸上记录不算');
  assert.equal(shiHandoffRecord({ records: firstPractice, today: DAY, hasInk: () => false }), null, '没有留墨');
});

test('shiHandoffRecord：不是首练那天（老用户、隔天才回来）不补交接', () => {
  const older = [rec(1, '永', { day: '2026-09-20' }), ...firstPractice];
  assert.equal(shiHandoffRecord({ records: older, today: DAY, hasInk: allInk }), null, '今天不是第一次练习的那天');
  assert.equal(shiHandoffRecord({ records: firstPractice, today: '2026-10-06', hasInk: allInk }), null, '隔天才回首页：不补');
  assert.equal(shiHandoffRecord({ records: [], today: DAY, hasInk: allInk }), null);
  assert.equal(shiHandoffRecord({ records: firstPractice, today: DAY }), null, '没有 hasInk 不猜');
});

test('commitShiHandoffDone：经 store.commit 写 settings.shiHandoffDone；已记过不再写；保留其他设置', () => {
  const calls = [];
  let state = { settings: { sound: true } };
  const store = {
    getState: () => state,
    commit(label, fn) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft, { now: 0 });
      state = draft;
      calls.push(label);
      return { ok: true, keys: ['settings'] };
    },
  };
  assert.equal(commitShiHandoffDone(store).ok, true);
  assert.deepEqual(calls, ['home:shi-handoff']);
  assert.deepEqual(state.settings, { sound: true, shiHandoffDone: true });
  assert.equal(commitShiHandoffDone(store).skipped, true);
  assert.equal(calls.length, 1);
});

test('schema：settings.shiHandoffDone 是布尔', () => {
  assert.equal(validateValue(KEYS.settings, { shiHandoffDone: true }), null);
  assert.notEqual(validateValue(KEYS.settings, { shiHandoffDone: 'yes' }), null);
});

test('homeModel：首练当天回首页（view today）带出 shiHandoff，交接过 / 不是首练当天就是 null', () => {
  const state = settings => ({ records: { '2026-10': firstPractice }, sessions: { A: null, B: null, lastEnded: {} }, backupMeta: null, settings });
  const m = homeModel(state(null), at(DAY, 10), { hasInk: allInk });
  assert.equal(m.view, 'today');
  assert.equal(m.shiHandoff && m.shiHandoff.id, 'r3');
  assert.equal(homeModel(state({ shiHandoffDone: true }), at(DAY, 10), { hasInk: allInk }).shiHandoff, null);
  assert.equal(homeModel(state(null), at('2026-10-06', 10), { hasInk: allInk }).shiHandoff, null, '隔天（view fresh）没有');
});

test('文案：「拾回」整个 App 只在这一处读屏名称里出现一次', () => {
  const hits = Object.entries(COPY).filter(([, v]) => typeof v === 'string' && v.includes('拾回'));
  assert.deepEqual(hits.map(([k]) => k), ['X-HOME.shiHandoffLabel']);
  assert.equal(t('X-HOME.shiHandoffLabel'), '拾回的第一个字：你自己写的「拾」');
});
