// 阶段 1 P1-E8 写字页 / 判断页的「在纸上写」（D46 ⑬；实现交接 §10.2；03 P165 / P167）：
// 纸上判断不要求笔画、记 source:'paper'、不写墨迹、照常评级推进；进判断页写 current.paper；本字切换；纸上判断页只有参考字形。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { judgeInDraft, commitJudgment, commitComparePhase, PaperCompareStage } from '../../src/ui/screens/write/compare.js';
import { commitPaperToggle, PaperStage } from '../../src/ui/screens/write/paper.js';
import { createSession } from '../../src/core/sessions.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';

loadFSRSGlobal();

const T0 = new Date(2026, 9, 4, 12, 0).getTime();
const MONTH = '2026-10';
const STROKE = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];

function draftWith({ chars = ['永', '和'], current = {}, records = [], ink = {} } = {}) {
  const s = createSession({ id: 's1', kind: 'daily', queue: chars.map(c => 'base:' + c), at: T0 });
  const A = { ...s, current: { ...s.current, ...current } };
  return { records: records.length ? { [MONTH]: records } : {}, sched: {}, ink, sessions: { A, B: null, lastEnded: {} }, meta: null };
}

function idGen(start = 1) {
  let n = start - 1;
  return prefix => `${prefix}${(n += 1)}`;
}

function fakeStore(state) {
  let cur = state;
  let serial = 100;
  return {
    getState: () => cur,
    commit(label, fn) {
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: T0 + 1000, label, nextId: p => `${p}${(serial += 1)}` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      cur = draft;
      return { ok: true, keys: [] };
    },
  };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(n => walk(n, visit));
  visit(node);
  walk(node.props && node.props.children, visit);
}

function byTestid(vnode) {
  const out = {};
  walk(vnode, n => {
    const id = n.props && (n.props['data-testid'] || n.props.testid);
    if (id) (out[id] = out[id] || []).push(n);
  });
  return out;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props && node.props.children);
}

test('P167: 纸上判断不要求笔画——记 source:"paper"、不写墨迹，照常评级、推进、结果行；屏幕上写仍要求笔画', () => {
  const d = draftWith({ current: { phase: 'compare', paper: true, hints: 1 } });
  const out = judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment: 'wrong', strokes: [], at: T0, nextId: idGen(5), perRecordInk: true, paper: true });
  assert.equal(out.inkWritten, false);
  const r = d.records[MONTH][0];
  assert.equal(r.source, 'paper');
  assert.equal(r.kind, 'judged');
  assert.equal(r.judgment, 'wrong');
  assert.equal(r.help.hints, 1, 'help facts kept');
  assert.equal('inkId' in r, false);
  assert.deepEqual(d.ink, {}, 'ink = null: nothing written');
  assert.match(d.sched['base:永'].due, /^\d{4}-\d{2}-\d{2}$/, 'FSRS as usual');
  assert.equal(d.sessions.A.cursor, 1);
  assert.deepEqual(d.sessions.A.lastLine, { recordId: 'r5', kind: 'record' }, 'D19 result line as usual');
  assert.equal('paper' in d.sessions.A.current, false, 'the next character goes back to the setting');
  assert.equal(validateValue(`shizi.v2.records.${MONTH}`, d.records[MONTH]), null);
  assert.throws(() => judgeInDraft(draftWith(), { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [], at: T0, nextId: idGen() }), /no strokes/);
});

test('P167: 纸上判断不回收之前留墨的最近一次（D27：纸上那次不占位）', () => {
  const prev = { id: 'r2', cardKey: 'base:永', char: '永', sessionId: 's0', kind: 'judged', judgment: 'correct', at: T0 - 5000, localDay: '2026-10-04', help: { hints: 0, answerSeen: false, traced: false } };
  const first = { ...prev, id: 'r1', at: T0 - 9000 };
  const ink = { [MONTH]: { r1: { v: 3, c: 345, s: ['AAAAAA=='] }, r2: { v: 3, c: 345, s: ['AAAAAA=='] } } };
  const d = draftWith({ records: [first, prev], ink });
  const out = judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [], at: T0, nextId: idGen(3), perRecordInk: true, paper: true });
  assert.deepEqual(out.inkRecycled, []);
  assert.deepEqual(Object.keys(d.ink[MONTH]).sort(), ['r1', 'r2']);
});

test('P167: commitJudgment(paper) 空笔画不被挡；commitComparePhase(paper) 写 phase=compare + current.paper=true、不带笔画', () => {
  const store = fakeStore(draftWith());
  assert.equal(commitJudgment(fakeStore(draftWith()), { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [] }).error.kind, 'empty-strokes');
  const phase = commitComparePhase(store, { slot: 'A', cardKey: 'base:永', phase: 'compare', strokes: [STROKE], paper: true });
  assert.equal(phase.ok, true);
  const cur = store.getState().sessions.A.current;
  assert.equal(cur.phase, 'compare');
  assert.equal(cur.paper, true);
  assert.deepEqual(cur.strokes, [], 'paper compare carries no strokes');
  assert.equal(validateValue(KEYS.sessions, store.getState().sessions), null);
  const res = commitJudgment(store, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [], paper: true });
  assert.equal(res.ok, true);
  assert.equal(res.record.source, 'paper');
});

test('P165: commitPaperToggle 只改当前这一个字的 current.paper；换了字是 stale', () => {
  const store = fakeStore(draftWith());
  assert.equal(commitPaperToggle(store, { slot: 'A', cardKey: 'base:永', paper: true }).ok, true);
  assert.equal(store.getState().sessions.A.current.paper, true);
  assert.equal(commitPaperToggle(store, { slot: 'A', cardKey: 'base:永', paper: false }).ok, true);
  assert.equal(store.getState().sessions.A.current.paper, false);
  assert.equal(commitPaperToggle(store, { slot: 'A', cardKey: 'base:和', paper: true }).error.kind, 'stale');
  assert.equal(validateValue(KEYS.sessions, store.getState().sessions), null);
});

test('P167: 纸面格——格内「在纸上写」/ 说明 /「改回在屏幕上写」，不可落笔；用过提示时 data-hinted', () => {
  let back = 0;
  const v = PaperStage({ size: 320, onBack: () => { back += 1; } });
  const ids = byTestid(v);
  assert.equal(textOf(ids['write-paper-title'][0]), t('X-PAPER.title'));
  assert.equal(textOf(ids['write-paper-body'][0]), t('X-PAPER.body'));
  assert.equal(textOf(ids['write-paper-back'][0]), t('X-PAPER.backToScreen'));
  assert.equal(ids['write-paper-grid'][0].props.drawable, false);
  assert.equal(ids['write-paper'][0].props['data-hinted'], 'false');
  ids['write-paper-back'][0].props.onClick({ timeStamp: 1e9 });
  assert.equal(back, 1);
  assert.equal(byTestid(PaperStage({ size: 320, hinted: true }))['write-paper'][0].props['data-hinted'], 'true');
});

test('P167: 纸上判断页只有参考字形（书写格大小）+ 旁注「参考字形 · 和你纸上的字对照」，读屏「你的书写：写在纸上」', () => {
  const v = PaperCompareStage({ char: '永', py: 'yǒng', strokeData: { status: 'loading' }, size: 330 });
  const ids = byTestid(v);
  assert.equal(ids['write-compare'][0].props['data-paper'], 'true');
  assert.equal(ids['write-compare'][0].props['data-size'], 330);
  assert.ok(!ids['write-compare-mine'], 'no learner card');
  assert.equal(ids['write-compare-ref'].length, 1);
  assert.equal(textOf(ids['write-compare-aside-ref'][0]), '参考字形 · 和你纸上的字对照');
  assert.equal(textOf(ids['write-compare-paper'][0]), '你的书写：写在纸上');
  assert.equal(ids['write-compare-paper'][0].props.class, 'sr-only');
});
