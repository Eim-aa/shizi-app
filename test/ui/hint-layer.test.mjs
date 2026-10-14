// 提示层纯逻辑单测（M1-3；01 §6.4；core/hints.js 的量由 test/core 覆盖，这里测接线层：来源判定、按钮 / 说明模型、
// 视图状态机、时间线、会话现场写入）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  strokeDrawMs, hintTimeline, groupsFor, hasGroupData, hintSourceOf, planHint, hintButtonModel, hintNoteModel,
  initialHintView, reduceHintView, applyHintToDraft, HINT_FADE_OUT_MS, HINT_FADE_IN_MS, REDUCED_FADE_MS, HINT_DRAW, HintLayer,
  hintRemaining, hintVisible, mergeHintRange, matchHintStroke, meanDistanceToMedian, HINT_MATCH_MAX_DIST,
} from '../../src/ui/screens/write/hint-layer.js';
import { GlyphWash } from '../../src/ui/canvas/glyph-wash.js';
import { createSession, freshCurrent } from '../../src/core/sessions.js';
import { validateValue, KEYS } from '../../src/core/schema.js';

const data = n => ({ strokes: Array.from({ length: n }, () => 'M 0 0 L 1 1'), medians: Array.from({ length: n }, (_, i) => [[i, i], [i + 10, i + 10]]) });
const ready = (n, groups) => hintSourceOf({ status: 'ready', data: data(n), char: 'x', groups });

test('strokeDrawMs follows the prototype formula (L506), bounds merged into motion tokens (D58: 110 → fade 150, 240 → release 220)', () => {
  const ref = n => Math.round(Math.min(Math.max(1100 / n, 150), 220, 1200 / (0.3 + 0.7 * n)));
  for (let n = 1; n <= 20; n += 1) assert.equal(strokeDrawMs(n), ref(n), `n=${n}`);
  assert.equal(strokeDrawMs(1), 220);
  assert.equal(strokeDrawMs(4), 220);
  assert.equal(strokeDrawMs(10), 150);
  assert.equal(strokeDrawMs(0), 220, 'guards 0 as 1');
});

test('hintTimeline staggers each stroke by dur × 0.7', () => {
  const tl = hintTimeline(4);
  assert.equal(tl.dur, 220);
  assert.deepEqual(tl.items.map(x => x.delay), [0, 154, 308, 462]);
  assert.equal(tl.total, 462 + 220);
  assert.deepEqual(hintTimeline(0), { dur: 220, items: [], total: 0 });
  assert.equal(HINT_DRAW.easing, undefined, 'the unused third curve is gone (P2-06)');
  assert.equal(HINT_DRAW.opacity, 1, 'the group is shown at full strength; the opaque wash needs no layer opacity (D53 ①)');
  assert.equal(HINT_FADE_IN_MS, 150, 'whole group fades in over 150ms (D51 ⑧, P210)');
  assert.equal(HINT_FADE_OUT_MS, 260, 'motion.role.hintStrokeOut');
  assert.equal(REDUCED_FADE_MS, 150, 'the one reduced-motion duration (D58 ②)');
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

test('planHint (D64 ①): every tap continues after the strokes already given, to the whole char; nothing written yet', () => {
  const s3 = ready(3, [1, 2]);
  assert.deepEqual([0, 1, 2].map(used => planHint({ source: s3, used })), [
    { from: 0, to: 1, count: 1, index: 1, skip: 0 }, { from: 1, to: 2, count: 1, index: 2, skip: 0 }, { from: 2, to: 3, count: 1, index: 3, skip: 0 },
  ]);
  assert.equal(planHint({ source: s3, used: 3 }), null, 'whole char given');
  const s14 = ready(14, [1, 4, 3, 1, 5]);
  assert.deepEqual([0, 1, 2, 3].map(used => planHint({ source: s14, used })), [
    { from: 0, to: 4, count: 4, index: 1, skip: 0 }, { from: 4, to: 8, count: 4, index: 2, skip: 0 }, { from: 8, to: 12, count: 4, index: 3, skip: 0 }, { from: 12, to: 14, count: 2, index: 4, skip: 0 },
  ]);
  assert.equal(planHint({ source: s14, used: 4 }), null);
  assert.deepEqual(planHint({ source: s14, used: 1, written: 0 }), { from: 4, to: 8, count: 4, index: 2, skip: 0 }, 'the second tap with nothing new written gives NEW strokes (the old bug gave the same ones)');
  const p = ready(8, null);
  assert.deepEqual([0, 1, 7].map(used => planHint({ source: p, used })), [
    { from: 0, to: 1, count: 1, index: 1, skip: 0 }, { from: 1, to: 2, count: 1, index: 2, skip: 0 }, { from: 7, to: 8, count: 1, index: 8, skip: 0 },
  ]);
  assert.equal(planHint({ source: p, used: 8 }), null);
  assert.equal(planHint({ source: hintSourceOf({ status: 'loading' }), used: 0 }), null);
  assert.equal(planHint({ source: hintSourceOf({ status: 'missing' }), used: 0 }), null);
});

test('hintButtonModel (D64 ①): label counts the remaining segments, last tap leaves a disabled 「提示已用完」', () => {
  const s14 = ready(14, [1, 4, 3, 1, 5]);
  const m = (used, extra = {}) => hintButtonModel({ status: 'ready', used, source: s14, ...extra });
  // D49：可见文字（text）一直是「提示」，label 是读屏名称（次数只进读屏）
  assert.deepEqual(m(0), { kind: 'available', label: '提示，还有 4 次', text: '提示', disabled: false, remaining: 4 });
  assert.deepEqual(m(3), { kind: 'available', label: '提示，还有 1 次', text: '提示', disabled: false, remaining: 1 });
  assert.deepEqual(m(4), { kind: 'exhausted', label: '提示已用完', text: '提示', disabled: true, remaining: 0 });
  assert.deepEqual(hintButtonModel({ status: 'ready', used: 2, source: ready(3, [1, 2]) }), { kind: 'available', label: '提示，还有 1 次', text: '提示', disabled: false, remaining: 1 });
  assert.deepEqual(hintButtonModel({ status: 'missing', used: 0 }), { kind: 'unavailable', label: '暂时没有提示' });
  assert.deepEqual(hintButtonModel({ status: 'loading', used: 1, source: hintSourceOf({ status: 'loading' }) }), { kind: 'loading', label: '提示', text: '提示', disabled: true, remaining: null });
  assert.deepEqual(m(0, { answerSeen: true }), { kind: 'hidden' }, 'M1-4 owns the saw-state buttons');
  assert.equal(m(4, { answerSeen: true }).kind, 'exhausted', 'answer-seen because the hints ran out: the disabled button stays');
  assert.deepEqual(m(2, { answerSeen: true }), { kind: 'hidden' });
  assert.deepEqual(hintButtonModel({ phase: 'compare', status: 'ready' }), { kind: 'hidden' });
  assert.deepEqual(hintButtonModel({ phase: 'trace', status: 'missing' }), { kind: 'hidden' });
});

test('hintNoteModel: no legend sentence after a hint (D51 ⑧), R-W05 note without data, nothing otherwise', () => {
  assert.equal(hintNoteModel({ status: 'ready', used: 0 }), null);
  assert.equal(hintNoteModel({ status: 'ready', used: 1 }), null, 'the 「浅红色是提示」 legend is gone');
  assert.equal(hintNoteModel({ status: 'ready', used: 2 }), null);
  assert.deepEqual(hintNoteModel({ status: 'missing', used: 0 }), { kind: 'no-hint', text: '这个字暂时没有提示，可以直接看答案。', dot: true });
  assert.equal(hintNoteModel({ status: 'ready', used: 1, answerSeen: true }), null);
  assert.equal(hintNoteModel({ phase: 'retrace', status: 'ready', used: 1 }), null);
  assert.equal(hintNoteModel({ status: 'loading', used: 0 }), null);
});

const NONE = { absorbed: [], fading: [] };

test('reduceHintView: hint → absorb (only that stroke) → faded; second hint restarts; restore is static (D53 ⑧)', () => {
  let v = initialHintView('base:大', { hints: 0, hintRange: null });
  assert.deepEqual(v, { key: 'base:大', used: 0, range: null, ...NONE, show: 'none', run: 0, restored: false });
  assert.equal(reduceHintView(v, { type: 'absorb', user: 0, hint: 0 }), v, 'a stroke without a hint is a no-op');
  assert.equal(reduceHintView(v, { type: 'stroke-start' }), v, 'pen-down no longer does anything to the hint');
  v = reduceHintView(v, { type: 'hint', range: { from: 1, to: 4 } });
  assert.deepEqual(v, { key: 'base:大', used: 1, range: { from: 1, to: 4 }, ...NONE, show: 'in', run: 1, restored: false });
  assert.deepEqual(hintRemaining(v), [1, 2, 3]);
  v = reduceHintView(v, { type: 'absorb', user: 1, hint: 1 });
  assert.deepEqual(hintRemaining(v), [2, 3], 'only stroke 1 goes; the rest of the hint stays');
  assert.deepEqual(v.fading, [{ hint: 1 }]);
  assert.equal(v.show, 'in', 'the layer stays');
  assert.equal(reduceHintView(v, { type: 'absorb', user: 2, hint: 1 }), v, 'an already absorbed stroke is not absorbed twice');
  assert.equal(reduceHintView(v, { type: 'absorb', user: 2, hint: 9 }), v, 'a stroke outside the hint range is ignored');
  v = reduceHintView(v, { type: 'faded', hint: 1 });
  assert.deepEqual(v.fading, []);
  assert.equal(reduceHintView(v, { type: 'faded', hint: 1 }), v);
  assert.equal(hintVisible(v), true);
  v = reduceHintView(v, { type: 'absorb', user: 2, hint: 2 });
  v = reduceHintView(v, { type: 'absorb', user: 3, hint: 3 });
  assert.deepEqual(hintRemaining(v), []);
  assert.equal(hintVisible(v), true, 'two strokes are still fading out');
  v = reduceHintView(reduceHintView(v, { type: 'faded', hint: 2 }), { type: 'faded', hint: 3 });
  assert.equal(hintVisible(v), false, 'all written → the hint layer is gone');
  // 撤销：笔数退到 2 → 第 2、3 笔（本人第 2、3 笔）收掉的提示笔回来，第 1 笔仍收着
  const back = reduceHintView(v, { type: 'restore', fromUser: 2 });
  assert.deepEqual(hintRemaining(back), [2, 3]);
  assert.equal(back.run, v.run + 1, 're-fades in as a group');
  assert.equal(reduceHintView(v, { type: 'restore', fromUser: 9 }), v, 'nothing to restore');
  const cleared = reduceHintView(v, { type: 'restore', fromUser: 0 });
  assert.deepEqual(hintRemaining(cleared), [1, 2, 3], 'clear → every absorbed stroke comes back');
  v = reduceHintView(v, { type: 'hint', range: { from: 1, to: 2 } });
  assert.deepEqual([v.used, v.run, v.show, v.range, v.absorbed], [2, 2, 'in', { from: 1, to: 2 }, []], 'a hint that does not continue the shown range starts a fresh one');
  assert.equal(reduceHintView(v, { type: 'hint', range: null }), v, 'invalid range ignored');
  assert.equal(reduceHintView(v, { type: 'sync-used', used: 1 }), v, 'sync only raises');
  assert.equal(reduceHintView(v, { type: 'sync-used', used: 3 }).used, 3);
  const r = initialHintView('base:聚', { hints: 1, hintRange: { from: 0, to: 4 } });
  assert.deepEqual(r, { key: 'base:聚', used: 1, range: { from: 0, to: 4 }, ...NONE, show: 'in', run: 0, restored: true });
  assert.deepEqual(reduceHintView(r, { type: 'reset', key: 'base:大', stored: null }), initialHintView('base:大', null));
  assert.equal(initialHintView('k', { hints: 1, hintRange: { from: 2, to: 2 } }).range, null, 'empty range not restored');
  assert.equal(initialHintView('k', { hints: 1, hintRange: [0, 1] }).range, null, 'array form not restored');
  // 恢复现场：已写 2 笔、提示范围 [1,4) → 按笔顺序号推出第 1 笔已被收掉
  const rest = initialHintView('base:聚', { hints: 1, hintRange: { from: 1, to: 4 } }, 2);
  assert.deepEqual(hintRemaining(rest), [2, 3]);
  assert.deepEqual(initialHintView('base:聚', { hints: 1, hintRange: { from: 1, to: 4 } }, 9).absorbed.map(a => a.hint), [1, 2, 3]);
});

test('planHint (D64 ①): a segment the user has already fully written is skipped (counted as given), so a tap always shows something new', () => {
  const s14 = ready(14, [1, 4, 3, 1, 5]);
  assert.deepEqual(planHint({ source: s14, used: 0, written: 5 }), { from: 4, to: 8, count: 4, index: 2, skip: 1 }, '5 written: segment 0–3 is all written → show 4–7');
  assert.deepEqual(planHint({ source: s14, used: 0, written: 3 }), { from: 0, to: 4, count: 4, index: 1, skip: 0 }, 'partly written segment is not skipped');
  assert.deepEqual(planHint({ source: s14, used: 0, written: 14 }), { from: 12, to: 14, count: 2, index: 4, skip: 3 }, 'everything written: lands on the last segment, never beyond it');
  const s3 = ready(3, [1, 2]);
  assert.deepEqual(planHint({ source: s3, used: 0, written: 1 }), { from: 1, to: 2, count: 1, index: 2, skip: 1 });
});

test('reduceHintView (D64 ①): strokes of the new segment the user already wrote are taken in at once; skipped segments count as used', () => {
  let v = initialHintView('base:聚', { hints: 0, hintRange: null });
  v = reduceHintView(v, { type: 'hint', range: { from: 2, to: 6 }, written: 4, skip: 1 });
  assert.equal(v.used, 2, 'one tap + one skipped segment');
  assert.deepEqual(hintRemaining(v), [4, 5], 'strokes 2–3 were already written');
});

test('reduceHintView (D64 ①): the next segment extends the shown range; absorbed strokes stay absorbed, the unwritten ones stay', () => {
  let v = initialHintView('base:聚', { hints: 0, hintRange: null });
  v = reduceHintView(v, { type: 'hint', range: { from: 0, to: 4 } });
  v = reduceHintView(v, { type: 'absorb', user: 0, hint: 0 });
  v = reduceHintView(v, { type: 'faded', hint: 0 });
  v = reduceHintView(v, { type: 'hint', range: { from: 4, to: 8 } });
  assert.deepEqual([v.used, v.range], [2, { from: 0, to: 8 }], 'range keeps its start, grows to the new end');
  assert.deepEqual(hintRemaining(v), [1, 2, 3, 4, 5, 6, 7], 'stroke 0 is written (still counts as given); the rest are on the grid');
  assert.deepEqual(v.absorbed, [{ user: 0, hint: 0 }]);
  const all = reduceHintView(v, { type: 'hint', range: { from: 8, to: 12 } });
  assert.deepEqual(all.range, { from: 0, to: 12 });
  assert.deepEqual(mergeHintRange({ from: 0, to: 4 }, { from: 4, to: 8 }), { from: 0, to: 8 }, 'what is written to sessions.current.hintRange');
  assert.deepEqual(mergeHintRange(null, { from: 4, to: 8 }), { from: 4, to: 8 }, 'no shown range (restored / cleared): just the new segment');
});

test('matchHintStroke：先按笔顺序号，序号对不上按几何最近（平均距离 ≤ 上限），再远就不算写过', () => {
  const medians = [
    [[10, 10], [10, 100]], // 提示笔 0：左侧竖
    [[200, 10], [200, 100]], // 提示笔 1：右侧竖
    [[10, 300], [300, 300]], // 提示笔 2：底部横
  ];
  const near = (x, y) => Array.from({ length: 10 }, (_, i) => ({ x: x + 2, y: y + i * 9 }));
  assert.equal(matchHintStroke({ remaining: [1, 2], index: 1, points: near(10, 10), medians }), 1, 'the stroke number wins even if the geometry says otherwise');
  assert.equal(matchHintStroke({ remaining: [1, 2], index: 0, points: near(200, 10), medians }), 1, 'index 0 is not in the hint → geometric nearest: stroke 1 (right bar)');
  assert.equal(matchHintStroke({ remaining: [0, 2], index: 5, points: Array.from({ length: 10 }, (_, i) => ({ x: 20 + i * 25, y: 302 })), medians }), 2, 'bottom bar → stroke 2');
  assert.equal(matchHintStroke({ remaining: [0], index: 3, points: Array.from({ length: 10 }, (_, i) => ({ x: 300, y: 300 + i })), medians }), null, 'too far from every remaining hint stroke → no match');
  assert.equal(matchHintStroke({ remaining: [], index: 0 }), null);
  assert.equal(matchHintStroke({ remaining: [2], index: 0 }), null, 'no geometry data → only the stroke number can match');
  assert.ok(HINT_MATCH_MAX_DIST > 10 && HINT_MATCH_MAX_DIST < 80);
  assert.ok(meanDistanceToMedian(near(10, 10), medians[0]) < 5);
  assert.equal(meanDistanceToMedian([], medians[0]), Infinity);
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

test('HintLayer: one shared opaque wash for the strokes not written yet (under the ink); a stroke just written fades on its own canvas (D53 ⑧)', () => {
  const d = { strokes: ['M0 0L10 0L10 10Z', 'M20 0L30 0L30 10Z', 'M40 0L50 0L50 10Z'], medians: [[[0, 0], [1, 1]], [[2, 2], [3, 3]], [[4, 4], [5, 5]]] };
  const view = { key: 'base:x', used: 1, range: { from: 1, to: 3 }, absorbed: [], fading: [], show: 'in', run: 1, restored: false };
  const collect = vnode => {
    const flat = [];
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      flat.push(n);
      if (n.props) walk(n.props.children);
    };
    walk(vnode);
    return flat;
  };
  const flat = collect(HintLayer({ data: d, view, reduced: false }));
  const washes = flat.filter(n => n.type === GlyphWash);
  assert.equal(washes.length, 1, 'one wash while nothing has been written');
  assert.deepEqual([washes[0].props.solid, washes[0].props.data], [[1, 2], d], 'only the strokes of the hint are drawn');
  assert.equal(washes[0].props.fillTestid, 'write-hint-fill');
  const g = flat.find(n => n.props && n.props.class === 'sz-hint__group');
  assert.match(g.props.style.animation, /^szHintFadeIn 150ms/, 'group fade-in 150ms');
  assert.equal(g.props.style.opacity, 1);
  const root = flat.find(n => n.props && n.props['data-testid'] === 'write-hint-layer');
  assert.deepEqual([root.props['data-anim'], root.props['data-from'], root.props['data-to'], root.props['data-state']], ['fade', 1, 3, 'shown']);
  // 写过第 1 笔：第 2 笔提示留着（主层只剩它），第 1 笔在自己的层里 260ms 淡出
  const one = collect(HintLayer({ data: d, view: { ...view, absorbed: [{ user: 1, hint: 1 }], fading: [{ hint: 1 }] }, reduced: false }));
  const w1 = one.filter(n => n.type === GlyphWash);
  assert.deepEqual(w1.map(w => w.props.solid), [[2], [1]], 'stroke 2 stays; stroke 1 fades on its own canvas');
  const out = one.find(n => n.props && n.props['data-testid'] === 'write-hint-out');
  assert.match(out.props.style.animation, /^szHintOut 260ms linear forwards/);
  assert.equal(one.find(n => n.props && n.props['data-testid'] === 'write-hint-layer').props['data-state'], 'fading');
  const red = collect(HintLayer({ data: d, view: { ...view, absorbed: [{ user: 1, hint: 1 }], fading: [{ hint: 1 }] }, reduced: true }));
  assert.match(red.find(n => n.props && n.props['data-testid'] === 'write-hint-out').props.style.animation, /^szHintOut 150ms/, 'reduced motion: 150ms (D58 ②)');
  // 全部写过且淡完 → 没有提示层
  const gone = collect(HintLayer({ data: d, view: { ...view, absorbed: [{ user: 1, hint: 1 }, { user: 2, hint: 2 }], fading: [] }, reduced: false }));
  assert.equal(gone.find(n => n.props && n.props['data-testid'] === 'write-hint-layer').props['data-state'], 'none');
  assert.equal(gone.filter(n => n.type === GlyphWash).length, 0);
  const rflat = collect(HintLayer({ data: d, view: { ...view, restored: true }, reduced: false }));
  assert.equal(rflat.find(n => n.props && n.props['data-testid'] === 'write-hint-layer').props['data-anim'], 'static', 'a restored hint is shown statically');
  assert.equal(rflat.find(n => n.props && n.props.class === 'sz-hint__group').props.style.animation, undefined);
  const none = collect(HintLayer({ data: d, view: { ...view, range: null }, reduced: false }));
  assert.equal(none.find(n => n.props && n.props['data-testid'] === 'write-hint-layer').props['data-state'], 'none');
});
