// 提示层纯逻辑单测（M1-3；01 §6.4；core/hints.js 的量由 test/core 覆盖，这里测接线层：来源判定、按钮 / 说明模型、
// 视图状态机、时间线、会话现场写入）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  strokeDrawMs, hintTimeline, groupsFor, hasGroupData, hintSourceOf, planHint, hintButtonModel, hintNoteModel,
  initialHintView, reduceHintView, applyHintToDraft, HINT_FADE_OUT_MS, INK_DIM_OPACITY, REDUCED_FADE_MS, HINT_DRAW,
} from '../../src/ui/screens/write/hint-layer.js';
import { createSession, freshCurrent } from '../../src/core/sessions.js';
import { validateValue, KEYS } from '../../src/core/schema.js';

const data = n => ({ strokes: Array.from({ length: n }, () => 'M 0 0 L 1 1'), medians: Array.from({ length: n }, (_, i) => [[i, i], [i + 10, i + 10]]) });
const ready = (n, groups) => hintSourceOf({ status: 'ready', data: data(n), char: 'x', groups });

test('strokeDrawMs follows the prototype formula (L506)', () => {
  const ref = n => Math.round(Math.min(Math.max(1100 / n, 110), 240, 1200 / (0.3 + 0.7 * n)));
  for (let n = 1; n <= 20; n += 1) assert.equal(strokeDrawMs(n), ref(n), `n=${n}`);
  assert.equal(strokeDrawMs(1), 240);
  assert.equal(strokeDrawMs(4), 240);
  assert.equal(strokeDrawMs(10), 110);
  assert.equal(strokeDrawMs(0), 240, 'guards 0 as 1');
});

test('hintTimeline staggers each stroke by dur × 0.7', () => {
  const tl = hintTimeline(4);
  assert.equal(tl.dur, 240);
  assert.deepEqual(tl.items.map(x => x.delay), [0, 168, 336, 504]);
  assert.equal(tl.total, 504 + 240);
  assert.deepEqual(hintTimeline(0), { dur: 240, items: [], total: 0 });
  assert.equal(HINT_DRAW.easing, 'cubic-bezier(.4,0,.2,1)');
  assert.equal(HINT_DRAW.opacity, 0.92);
  assert.equal(HINT_FADE_OUT_MS, 260);
  assert.equal(REDUCED_FADE_MS, 120);
  assert.equal(INK_DIM_OPACITY, 0.35);
});

test('group data: present only when every group is a positive int and they sum to the stroke count', () => {
  assert.equal(hasGroupData([1, 2], 3), true);
  assert.equal(hasGroupData([1, 4, 3, 1, 5], 14), true);
  assert.equal(hasGroupData([1, 2], 4), false, 'sum mismatch');
  assert.equal(hasGroupData([], 0), false);
  assert.equal(hasGroupData([0, 3], 3), false);
  assert.equal(hasGroupData([1.5, 1.5], 3), false);
  assert.equal(hasGroupData(null, 3), false);
  const table = { 大: [1, 2] };
  assert.deepEqual(groupsFor('大', table), [1, 2]);
  assert.equal(groupsFor('聚', table), null);
  assert.equal(groupsFor('toString', table), null, 'no prototype lookups');
  assert.equal(groupsFor('大', null), null);
});

test('hintSourceOf: loading / ready (with or without groups) / missing', () => {
  assert.deepEqual(hintSourceOf({ status: 'loading' }), { status: 'loading', totalStrokes: 0, hasStrokeData: true, hasGroups: false });
  assert.deepEqual(hintSourceOf({ status: 'missing' }), { status: 'missing', totalStrokes: 0, hasStrokeData: false, hasGroups: false });
  assert.deepEqual(ready(3, [1, 2]), { status: 'ready', totalStrokes: 3, hasStrokeData: true, hasGroups: true });
  assert.deepEqual(ready(3, null), { status: 'ready', totalStrokes: 3, hasStrokeData: true, hasGroups: false });
  assert.equal(hintSourceOf({ status: 'ready', data: { medians: [] } }).status, 'loading', 'empty data is not ready');
});

test('planHint: 3-stroke and 14-stroke quarter rule, prefix rule, exhausted, not ready', () => {
  const s3 = ready(3, [1, 2]);
  assert.deepEqual(planHint({ source: s3, used: 0, written: 0 }), { from: 0, to: 1, count: 1, index: 1 });
  assert.deepEqual(planHint({ source: s3, used: 1, written: 1 }), { from: 1, to: 2, count: 1, index: 2 });
  assert.deepEqual(planHint({ source: s3, used: 1, written: 3 }), { from: 2, to: 3, count: 1, index: 2 }, 'clamped to N − q');
  assert.equal(planHint({ source: s3, used: 2, written: 0 }), null, 'hintMax = 2');
  const s14 = ready(14, [1, 4, 3, 1, 5]);
  assert.deepEqual(planHint({ source: s14, used: 0, written: 0 }), { from: 0, to: 4, count: 4, index: 1 });
  assert.deepEqual(planHint({ source: s14, used: 1, written: 5 }), { from: 5, to: 9, count: 4, index: 2 });
  assert.deepEqual(planHint({ source: s14, used: 1, written: 11 }), { from: 10, to: 14, count: 4, index: 2 });
  const p = ready(8, null);
  assert.deepEqual(planHint({ source: p, used: 0, written: 5 }), { from: 0, to: 1, count: 1, index: 1 });
  assert.deepEqual(planHint({ source: p, used: 1, written: 5 }), { from: 0, to: 2, count: 2, index: 2 });
  assert.equal(planHint({ source: hintSourceOf({ status: 'loading' }), used: 0 }), null);
  assert.equal(planHint({ source: hintSourceOf({ status: 'missing' }), used: 0 }), null);
  assert.equal(planHint({ source: s3, used: 0 }, { hintMax: 3, hintStartRule: 'written-count' }).index, 1, 'policy injectable');
});

test('hintButtonModel: R-W05 label sequence and states', () => {
  const m0 = hintButtonModel({ status: 'ready', used: 0 });
  // D49：可见文字（text）一直是「提示」，label 是读屏名称（次数只进读屏）
  assert.deepEqual(m0, { kind: 'available', label: '提示，还有 2 次', text: '提示', disabled: false, remaining: 2 });
  assert.deepEqual(hintButtonModel({ status: 'ready', used: 1 }), { kind: 'available', label: '提示，还有 1 次', text: '提示', disabled: false, remaining: 1 });
  assert.deepEqual(hintButtonModel({ status: 'ready', used: 2 }), { kind: 'exhausted', label: '提示已用完', text: '提示', disabled: true, remaining: 0 });
  assert.deepEqual(hintButtonModel({ status: 'missing', used: 0 }), { kind: 'unavailable', label: '暂时没有提示' });
  assert.deepEqual(hintButtonModel({ status: 'loading', used: 1 }), { kind: 'loading', label: '提示，还有 1 次', text: '提示', disabled: true, remaining: 1 });
  assert.deepEqual(hintButtonModel({ status: 'loading', used: 2 }).kind, 'exhausted');
  assert.deepEqual(hintButtonModel({ status: 'ready', used: 0, answerSeen: true }), { kind: 'hidden' }, 'M1-4 owns the saw-state buttons');
  assert.deepEqual(hintButtonModel({ phase: 'compare', status: 'ready' }), { kind: 'hidden' });
  assert.deepEqual(hintButtonModel({ phase: 'trace', status: 'missing' }), { kind: 'hidden' });
});

test('hintNoteModel: R-W06 after a hint, R-W05 note without data, nothing otherwise', () => {
  assert.equal(hintNoteModel({ status: 'ready', used: 0 }), null);
  assert.deepEqual(hintNoteModel({ status: 'ready', used: 1 }), { kind: 'hint', text: '浅红色是提示，只给一部分。接着写下一笔，提示就收起。', dot: true });
  assert.deepEqual(hintNoteModel({ status: 'missing', used: 0 }), { kind: 'no-hint', text: '这个字暂时没有提示，可以直接看答案。', dot: true });
  assert.equal(hintNoteModel({ status: 'ready', used: 1, answerSeen: true }), null);
  assert.equal(hintNoteModel({ phase: 'retrace', status: 'ready', used: 1 }), null);
  assert.equal(hintNoteModel({ status: 'loading', used: 0 }), null);
});

test('reduceHintView: hint → stroke-start → faded; second hint restarts the draw; restore is static', () => {
  let v = initialHintView('base:大', { hints: 0, hintRange: null });
  assert.deepEqual(v, { key: 'base:大', used: 0, range: null, show: 'none', run: 0, restored: false });
  assert.equal(reduceHintView(v, { type: 'stroke-start' }), v, 'stroke without a hint is a no-op');
  v = reduceHintView(v, { type: 'hint', range: { from: 0, to: 1 } });
  assert.deepEqual(v, { key: 'base:大', used: 1, range: { from: 0, to: 1 }, show: 'in', run: 1, restored: false });
  v = reduceHintView(v, { type: 'stroke-start' });
  assert.equal(v.show, 'out');
  assert.equal(reduceHintView(v, { type: 'stroke-start' }), v, 'second pen-down while fading is a no-op');
  v = reduceHintView(v, { type: 'faded' });
  assert.deepEqual([v.show, v.range, v.used], ['none', null, 1]);
  assert.equal(reduceHintView(v, { type: 'faded' }), v);
  v = reduceHintView(v, { type: 'hint', range: { from: 1, to: 2 } });
  assert.deepEqual([v.used, v.run, v.show, v.range], [2, 2, 'in', { from: 1, to: 2 }]);
  assert.equal(reduceHintView(v, { type: 'hint', range: null }), v, 'invalid range ignored');
  assert.equal(reduceHintView(v, { type: 'sync-used', used: 1 }), v, 'sync only raises');
  assert.equal(reduceHintView(v, { type: 'sync-used', used: 3 }).used, 3);
  const r = initialHintView('base:聚', { hints: 1, hintRange: { from: 0, to: 4 } });
  assert.deepEqual(r, { key: 'base:聚', used: 1, range: { from: 0, to: 4 }, show: 'in', run: 0, restored: true });
  assert.deepEqual(reduceHintView(r, { type: 'reset', key: 'base:大', stored: null }), initialHintView('base:大', null));
  assert.equal(initialHintView('k', { hints: 1, hintRange: { from: 2, to: 2 } }).range, null, 'empty range not restored');
  assert.equal(initialHintView('k', { hints: 1, hintRange: [0, 1] }).range, null, 'array form not restored');
});

function draftWith(session) {
  return { sessions: { A: session, B: null, lastEnded: {} } };
}

test('applyHintToDraft writes hints + hintRange into the current card only, in the M0-6 shape', () => {
  const s = createSession({ id: 's1', kind: 'daily', queue: ['base:大', 'base:聚'], at: 1000 });
  const draft = draftWith(s);
  const ok = applyHintToDraft(draft, { slot: 'A', sessionId: 's1', cardKey: 'base:大', hints: 1, hintRange: { from: 0, to: 1 } }, 2000);
  assert.equal(ok, true);
  assert.deepEqual(draft.sessions.A.current, { ...freshCurrent(), hints: 1, hintRange: { from: 0, to: 1 } });
  assert.equal(draft.sessions.A.updatedAt, 2000);
  assert.equal(s.current.hints, 0, 'input session not mutated');
  assert.equal(validateValue(KEYS.sessions, draft.sessions), null, 'passes the sessions shape check');

  // 淡出：只清 hintRange；次数取 max(已存, 本地)。
  const d2 = draftWith(draft.sessions.A);
  applyHintToDraft(d2, { slot: 'A', sessionId: 's1', cardKey: 'base:大', hints: 0, hintRange: null }, 3000);
  assert.deepEqual([d2.sessions.A.current.hints, d2.sessions.A.current.hintRange], [1, null], 'never lowers the stored count');
  const d3 = draftWith(d2.sessions.A);
  applyHintToDraft(d3, { slot: 'A', sessionId: 's1', cardKey: 'base:大', hints: 2, hintRange: null }, 3000);
  assert.equal(d3.sessions.A.current.hints, 2, 'catches up a count whose earlier write failed');

  // 会话 / 当前字变了：不写。
  for (const bad of [
    { slot: 'A', sessionId: 's9', cardKey: 'base:大' },
    { slot: 'A', sessionId: 's1', cardKey: 'base:聚' },
    { slot: 'B', sessionId: 's1', cardKey: 'base:大' },
  ]) {
    const d = draftWith(s);
    assert.equal(applyHintToDraft(d, { ...bad, hints: 1, hintRange: { from: 0, to: 1 } }, 1), false, JSON.stringify(bad));
    assert.equal(d.sessions.A, s, 'draft untouched');
  }
  assert.equal(applyHintToDraft({ sessions: null }, { slot: 'A', sessionId: 's1', cardKey: 'base:大', hints: 1 }, 1), false);
});
