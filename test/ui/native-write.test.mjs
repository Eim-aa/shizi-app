// B2.0 原生写字页的会话 API（src/ui/screens/write/native-session.js）契约：
// 经 API 提交与网页写字页直接调用同一批提交函数，得到的 store 状态逐字段相同（记录、FSRS、会话推进、笔迹、结束）；
// D07：提交失败不推进、重试不重复计数；快照不把答案字放进读屏名称（D16）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import {
  createWriteSessionApi, writeSnapshot, strokesToWire, strokesFromWire, copyBundle, NATIVE_WRITE_COPY_KEYS, NATIVE_WRITE_OPS,
  nativeWriteEnabled,
} from '../../src/ui/screens/write/native-session.js';
import { commitJudgment, commitComparePhase } from '../../src/ui/screens/write/compare.js';
import { commitStrokes } from '../../src/ui/screens/write/persist.js';
import { commitFinish } from '../../src/ui/screens/result/index.js';
import { createSession } from '../../src/core/sessions.js';
import { makeRecord } from '../../src/core/records.js';
import { applyJudgment } from '../../src/core/fsrs.js';
import { encodeRawStrokes } from '../../src/core/ink-math.js';
import { commitAnswerSeen, commitAnswerPhase, commitAnswerNext } from '../../src/ui/screens/write/answer.js';
import { commitSkip, commitUndoSkip } from '../../src/ui/screens/write/skip.js';
import { commitEndGroup, endConfirmCounts } from '../../src/ui/screens/write/end.js';
import { handoffSkipUndo, takeSkipUndo } from '../../src/ui/screens/result/index.js';
import * as policyModule from '../../src/config/policy.js';
import { hintSourceOf, hintStep, commitHintStep, commitHint } from '../../src/ui/screens/write/hint-layer.js';
import { setCardResolver } from '../../src/data/deck.js';
import { t } from '../../src/config/copy/index.js';

loadFSRSGlobal();

const CHARS = ['永', '和', '春'];
setCardResolver(key => {
  const c = key.slice(5);
  return CHARS.includes(c) ? { key, target: c, chars: ['写', c], ci: 1, py: 'yǒng', word: '写' + c, hint: '' } : null;
});

const T0 = new Date(2026, 9, 21, 9, 0).getTime();
const STROKE_A = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];
const STROKE_B = [{ x: 172, y: 40, t: 0, p: 0.4 }, { x: 173, y: 160, t: 50, p: 0.6 }, { x: 171, y: 300, t: 110, p: 0.5 }];

function initialState() {
  const s = createSession({ id: 's1', kind: 'daily', queue: CHARS.map(c => 'base:' + c), at: T0 });
  return { records: {}, sched: {}, ink: {}, sessions: { A: s, B: null, lastEnded: {} }, settings: {}, meta: null, wordOff: {} };
}

/** 确定性的最小 store（同一输入序列 → 同一 now / id）；fail = 接下来几次 commit 失败。 */
function fakeStore(state = initialState()) {
  let cur = state;
  let now = T0;
  let serial = 0;
  const api = {
    failures: 0,
    labels: [],
    getState: () => cur,
    commit(label, fn) {
      api.labels.push(label);
      const draft = JSON.parse(JSON.stringify(cur));
      now += 1000;
      try {
        fn(draft, { now, label, nextId: p => `${p}${(serial += 1)}` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      if (api.failures > 0) {
        api.failures -= 1;
        return { ok: false, error: { kind: 'generic' } };
      }
      cur = draft;
      return { ok: true, keys: [] };
    },
  };
  return api;
}

const quietNav = { back() {}, toResult() {} };

function apiOn(store, navigate = quietNav) {
  return createWriteSessionApi({ getStore: () => store, navigate, colors: () => ({}) });
}

test('ops: the named set; unknown op is rejected without throwing', () => {
  assert.deepEqual([...NATIVE_WRITE_OPS], ['open', 'strokes', 'phase', 'judge', 'exit', 'copy', 'hint', 'correct', 'showAnswer', 'answerPhase', 'answerNext', 'skip', 'undoSkip', 'end']);
  const r = apiOn(fakeStore()).call('nope', {});
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'unknown-op');
});

test('switch: off unless the iOS shell injected __shiziNativeWrite', () => {
  assert.equal(nativeWriteEnabled(undefined), false);
  assert.equal(nativeWriteEnabled({}), false);
  assert.equal(nativeWriteEnabled({ __shiziNativeWrite: true }), false, 'not inside the native shell');
  assert.equal(nativeWriteEnabled({ __shiziNativeWrite: true, __shiziNativeWriteForce: true }), true);
});

test('wire format: strokes round-trip, pressure kept only when present, junk points dropped', () => {
  const wire = strokesToWire([STROKE_A, STROKE_B]);
  assert.deepEqual(wire[0][0], [60, 170, 0]);
  assert.deepEqual(wire[1][0], [172, 40, 0, 0.4]);
  assert.deepEqual(strokesFromWire(wire), [STROKE_A, STROKE_B]);
  assert.deepEqual(strokesFromWire([[[1, 2]], [['x', 1, 2]], 'bad', [[1, 2, 3, 0]]]), [[{ x: 1, y: 2, t: 3 }]]);
});

test('copy: native strings come from src/config/copy (same values as t())', () => {
  const c = copyBundle();
  for (const k of NATIVE_WRITE_COPY_KEYS) assert.equal(c[k], t(k), k);
  assert.deepEqual(copyBundle(['R-W29.btnDone', 'no.such.key']), { 'R-W29.btnDone': t('R-W29.btnDone') });
});

test('snapshot: current card, progress, prompt cells; the answer char is not in any spoken label (D16)', () => {
  const snap = writeSnapshot(initialState(), 'A');
  assert.equal(snap.active, true);
  assert.equal(snap.cardKey, 'base:永');
  assert.equal(snap.char, '永');
  assert.equal(snap.cursor, 0);
  assert.equal(snap.total, 3);
  assert.equal(snap.phase, 'recall');
  assert.deepEqual(snap.strokes, []);
  assert.equal(snap.prompt.cells.length, 2);
  assert.equal(snap.prompt.cells[1].kind, 'blank');
  for (const c of snap.prompt.cells) {
    if (c.kind !== 'text') assert.ok(!String(c.label || '').includes('永') && c.text !== '永');
  }
  assert.deepEqual(writeSnapshot(initialState(), 'B'), { slot: 'B', active: false });
});

test('strokes op = commitStrokes (same session.current), and snapshot restores them', () => {
  const viaApi = fakeStore();
  const viaWeb = fakeStore();
  const r = apiOn(viaApi).call('strokes', { slot: 'A', cardKey: 'base:永', strokes: strokesToWire([STROKE_A, STROKE_B]) });
  assert.equal(r.ok, true);
  commitStrokes(viaWeb, { slot: 'A', cardKey: 'base:永', inkKey: 'base:永', strokes: [STROKE_A, STROKE_B] });
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(strokesFromWire(writeSnapshot(viaApi.getState(), 'A').strokes), [STROKE_A, STROKE_B]);
});

/** 同一组操作：网页路径（直接调提交函数）与原生路径（经会话 API）各跑一遍。 */
function webJudge(store, judgment, strokes) {
  const s = store.getState().sessions.A;
  const cardKey = s.queue[s.cursor];
  commitComparePhase(store, { slot: 'A', cardKey, phase: 'compare', strokes });
  const r = commitJudgment(store, { slot: 'A', cardKey, judgment, strokes, hints: 0 });
  const after = store.getState().sessions.A;
  if (r.ok && after && after.cursor >= after.queue.length) commitFinish(store, { slot: 'A', sessionId: after.id });
  return r;
}

function nativeJudge(api, store, judgment, strokes) {
  const s = store.getState().sessions.A;
  const cardKey = s.queue[s.cursor];
  api.call('phase', { slot: 'A', cardKey, phase: 'compare', strokes: strokesToWire(strokes) });
  return api.call('judge', { slot: 'A', cardKey, judgment, strokes: strokesToWire(strokes), hints: 0 });
}

test('judge through the API = the web judgment path, field by field (records, sched/FSRS, ink, session, lastEnded)', () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  const plan = [['correct', [STROKE_A]], ['wrong', [STROKE_A, STROKE_B]], ['correct', [STROKE_B]]];
  for (const [i, [judgment, strokes]] of plan.entries()) {
    const w = webJudge(viaWeb, judgment, strokes);
    const n = nativeJudge(api, viaApi, judgment, strokes);
    assert.equal(w.ok, true);
    assert.equal(n.ok, true, `native judge #${i}`);
    assert.equal(n.recordId, w.record.id);
    assert.deepEqual(viaApi.getState(), viaWeb.getState(), `state after card #${i}`);
    if (i < plan.length - 1) {
      assert.equal(n.snapshot.cursor, i + 1, 'reply carries the next card');
      assert.equal(n.finished, null);
    }
  }
  assert.deepEqual(viaApi.labels, viaWeb.labels, 'same commits in the same order');
  const last = viaApi.getState();
  assert.equal(last.sessions.A, null, 'finished group moved out of the slot');
  assert.equal(last.sessions.lastEnded.A.id, 's1');
  const records = Object.values(last.records).flat();
  assert.deepEqual(records.map(r => [r.cardKey, r.kind, r.judgment]), [
    ['base:永', 'judged', 'correct'], ['base:和', 'judged', 'wrong'], ['base:春', 'judged', 'correct'],
  ]);
  assert.deepEqual(Object.keys(last.sched).sort(), ['base:和', 'base:春', 'base:永']);
  const inkCount = Object.values(last.ink).reduce((n, m) => n + Object.keys(m).length, 0);
  assert.equal(inkCount, 3, 'per-record ink written in the same commit (perRecordInk on)');
});

test('judge reply on the last card says finished; exit navigates to the result page', () => {
  const store = fakeStore();
  const calls = [];
  const api = apiOn(store, { back: () => calls.push(['back']), toResult: (slot, id) => calls.push(['result', slot, id]) });
  let r;
  for (const _ of CHARS) r = nativeJudge(api, store, 'correct', [STROKE_A]);
  assert.deepEqual(r.finished, { ok: true, sessionId: 's1' });
  assert.equal(r.snapshot.active, false);
  api.call('exit', { slot: 'A', to: 'result', sessionId: 's1' });
  api.call('exit', { slot: 'A', to: 'back' });
  assert.deepEqual(calls, [['result', 'A', 's1'], ['back']]);
});

test('D07: a failed judgment changes nothing and does not advance; the retry records once', () => {
  const store = fakeStore();
  const api = apiOn(store);
  api.call('phase', { slot: 'A', cardKey: 'base:永', phase: 'compare', strokes: strokesToWire([STROKE_A]) });
  const before = store.getState();
  store.failures = 1;
  const failed = api.call('judge', { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: strokesToWire([STROKE_A]) });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.kind, 'generic');
  assert.equal(store.getState(), before, 'no state published');
  const ok = api.call('judge', { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: strokesToWire([STROKE_A]) });
  assert.equal(ok.ok, true);
  assert.equal(Object.values(store.getState().records).flat().length, 1);
  assert.equal(ok.snapshot.cardKey, 'base:和');
  // 同一个字再判一次（原生连点 / 回包丢失后重发）：已不是当前字 → stale，不多记
  const again = api.call('judge', { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: strokesToWire([STROKE_A]) });
  assert.equal(again.ok, false);
  assert.equal(again.error.kind, 'stale');
  assert.equal(again.snapshot.cardKey, 'base:和', 'stale reply carries the advanced snapshot for reconciliation');
  assert.equal(Object.values(store.getState().records).flat().length, 1);
});

test('judge with no strokes is refused before any commit (D03)', () => {
  const store = fakeStore();
  const r = apiOn(store).call('judge', { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'empty-strokes');
  assert.deepEqual(store.labels, []);
});

test('open: recovery is idempotent (a judged-but-not-advanced card is advanced once), snapshot + copy in one reply', () => {
  const store = fakeStore();
  const api = apiOn(store);
  nativeJudge(api, store, 'correct', [STROKE_A]);
  // 模拟「记录已写、会话没推进」的半途状态（01 §3.3 恢复幂等）
  const st = JSON.parse(JSON.stringify(store.getState()));
  st.sessions.A = { ...st.sessions.A, cursor: 0, items: [] };
  const half = fakeStore(st);
  const r = apiOn(half).call('open', { slot: 'A' });
  assert.equal(r.ok, true);
  assert.equal(r.recovered, true);
  assert.equal(r.snapshot.cardKey, 'base:和');
  assert.equal(r.copy['R-W29.btnDone'], t('R-W29.btnDone'));
  const again = apiOn(half).call('open', { slot: 'A' });
  assert.equal(again.recovered, false);
  assert.equal(Object.values(half.getState().records).flat().length, 1);
});

test('open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)', async () => {
  const { PEN_ARM_MS } = await import('../../src/ui/screens/write/index.js');
  const { M } = await import('../../src/config/motion.js');
  const { PRESS_GUARD_MS } = await import('../../src/ui/components/Button.js');
  const hint = await import('../../src/ui/screens/write/hint-layer.js');
  const fade = await import('../../src/ui/screens/write/phase-fade.js');
  const layout = await import('../../src/ui/screens/write/layout.js');
  const r = apiOn(fakeStore()).call('open', { slot: 'A' });
  assert.deepEqual(r.timing, { penArmMs: PEN_ARM_MS, judgeAppearMs: M.moment.judgeAppear, judgeReadyMs: M.moment.judgeReady, pressGuardMs: PRESS_GUARD_MS });
  assert.equal(r.timing.penArmMs, 250);
  assert.equal(r.timing.pressGuardMs, 400, '0.4s 防误点（确认单 2）');
  // T-phase 与提示层的时长：与网页 phase-fade.js / hint-layer.js 同一组值
  assert.deepEqual(r.motion, {
    fade: fade.FADE_MS, textOut: fade.TEXT_OUT_MS, inkFlip: fade.FLIP_MS, phaseReverse: M.role.phaseReverse, reduce: M.dur.reduce,
    hintIn: hint.HINT_FADE_IN_MS, hintOut: hint.HINT_FADE_OUT_MS, hintReduced: hint.REDUCED_FADE_MS,
    easeOut: [...M.bezier.out],
    settle: { lift: M.moment.settleLift, fadeFrom: M.moment.settleFadeFrom, end: M.moment.settleEnd, countBox: M.moment.settleCountBox, liftScale: M.moment.settleLiftScale, gather: [...M.bezier.gather] },
  });
  assert.deepEqual([r.motion.settle.lift, r.motion.settle.fadeFrom, r.motion.settle.end, r.motion.settle.countBox], [100, 380, 460, 14], 'M23 判断落定');
  // 版式常量：与网页 layout.js 同一组（01 §6.1）
  assert.equal(r.layout.min, layout.GRID_MIN);
  assert.equal(r.layout.max, layout.GRID_MAX);
  assert.equal(r.layout.promptGap, layout.PROMPT_GAP);
  assert.equal(r.layout.toolRowHeight + r.layout.noteHeight, layout.TOOLS_H);
  assert.equal(r.layout.bottomGap, layout.BOTTOM_GAP);
  assert.equal(r.layout.topShare, layout.TOP_SHARE);
  assert.equal(r.layout.topMin, layout.TOP_MIN);
  assert.equal(r.layout.nominalHead, layout.NOMINAL_HEAD_H);
  assert.equal(r.layout.nominalFoot, layout.NOMINAL_FOOT_H);
  assert.equal(r.layout.footBottomMin, layout.FOOT_BOTTOM_MIN);
  assert.equal(r.layout.nominalPrompt, layout.PROMPT_H_STD);
  assert.equal(r.layout.fitGridMin, layout.FIT_GRID_MIN);
  assert.equal(r.layout.hintMatchMaxDist, hint.HINT_MATCH_MAX_DIST);
});

// ---------------------------------------------------------------- B2.2 提示（hint op）：网页路径 == API 路径

/** 网页写字页点一次提示（useHint.onHint 的同一组函数：来源由笔顺数据推出，hintStep + commitHintStep）。 */
function webHint(store, { cardKey, n, used, range, written, groups }) {
  const s = store.getState().sessions.A;
  const data = n > 0 ? { medians: Array.from({ length: n }, () => [[0, 0]]) } : null;
  const source = hintSourceOf({ status: n > 0 ? 'ready' : 'missing', data, char: cardKey.slice(5), groups });
  const step = hintStep({ source, used, written, range });
  if (!step) return null;
  commitHintStep(store, { slot: 'A', sessionId: s.id, cardKey, step });
  return step;
}

function withGroups(table, fn) {
  const saved = globalThis.GROUPS;
  globalThis.GROUPS = table;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete globalThis.GROUPS;
    else globalThis.GROUPS = saved;
  }
}

test('hint op: every tap = the web hint path field by field, up to the whole char (= answer seen, D64 ①)', () => withGroups({ 永: [4, 4] }, () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  let local = { used: 0, range: null };
  let web = { used: 0, range: null };
  const st = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'state', totalStrokes: 8 });
  assert.equal(st.ok, true);
  assert.equal(st.button.kind, 'available');
  assert.equal(st.button.remaining, 4, '8 strokes with group data → quarters of 2');
  assert.equal(st.button.label, t('R-W05.hintRemaining', { n: 4 }));
  for (let i = 0; i < 4; i += 1) {
    const w = webHint(viaWeb, { cardKey: 'base:永', n: 8, used: web.used, range: web.range, written: 1, groups: [4, 4] });
    const r = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 8, used: local.used, range: local.range, written: 1 });
    assert.equal(r.ok, true, `tap #${i + 1}`);
    assert.deepEqual(r.hintRange, w.hintRange);
    assert.equal(r.used, w.used);
    assert.equal(r.whole, w.whole);
    assert.deepEqual(viaApi.getState(), viaWeb.getState(), `state after tap #${i + 1}`);
    local = { used: r.used, range: r.hintRange };
    web = { used: w.used, range: w.hintRange };
  }
  assert.deepEqual(viaApi.labels, viaWeb.labels);
  assert.deepEqual(viaApi.labels, ['hint', 'hint', 'hint', 'write:answer-seen'], 'the tap that gives the whole char records answer-seen');
  const cur = viaApi.getState().sessions.A;
  assert.equal(cur.current.answerSeen, true);
  assert.equal(cur.current.phase, 'recall', 'stays in recall to keep writing');
  assert.deepEqual(cur.current.hintRange, { from: 0, to: 8 });
  const done = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 8, used: local.used, range: local.range, written: 1 });
  assert.equal(done.ok, false);
  assert.equal(done.error.kind, 'unavailable');
  assert.equal(done.button.kind, 'exhausted', 'the button stays (greyed) after the hint gave the whole char');
  assert.equal(done.button.label, t('R-W05.hintUsedUp'));
}));

test('hint op: no group data → one stroke per tap; a segment already written is skipped (same skip as the web)', () => withGroups({}, () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  const w = webHint(viaWeb, { cardKey: 'base:永', n: 5, used: 0, range: null, written: 2, groups: null });
  const r = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 5, used: 0, range: null, written: 2 });
  assert.deepEqual(r.given, { from: 2, to: 3, skip: 2 });
  assert.equal(r.used, 3);
  assert.deepEqual(r.hintRange, w.hintRange);
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.equal(r.announce, t('X-WRITE.liveHint', { range: t('X-WRITE.liveRangeOne', { a: 3 }) }), 'spoken: the strokes now shown');
}));

test('hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)', () => withGroups({}, () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  webHint(viaWeb, { cardKey: 'base:永', n: 5, used: 0, range: null, written: 0, groups: null });
  const g = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 5, used: 0, written: 0 });
  const s = viaWeb.getState().sessions.A;
  commitHint(viaWeb, { slot: 'A', sessionId: s.id, cardKey: 'base:永', hints: 1, hintRange: null }, 'hint-fade');
  api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'range', hints: g.used, hintRange: null });
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.equal(viaApi.getState().sessions.A.current.hintRange, null);
  commitHint(viaWeb, { slot: 'A', sessionId: s.id, cardKey: 'base:永', hints: 1, hintRange: { from: 0, to: 1 } }, 'hint-fade');
  api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'range', hints: g.used, hintRange: { from: 0, to: 1 } });
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(viaApi.labels, viaWeb.labels);
}));

test('hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up', () => withGroups({}, () => {
  const store = fakeStore();
  const api = apiOn(store);
  const none = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'state', totalStrokes: 0 });
  assert.equal(none.button.kind, 'unavailable');
  assert.equal(none.button.label, t('R-W05.hintUnavailable'));
  assert.equal(none.note.text, t('R-W05.noHintNote'));
  assert.equal(api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 0 }).error.kind, 'unavailable');
  assert.equal(api.call('hint', { slot: 'A', cardKey: 'base:和', action: 'give', totalStrokes: 3 }).error.kind, 'stale');
  assert.equal(api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'state' }).button.kind, 'loading', 'stroke count not known yet');
  assert.deepEqual(store.labels, []);
  store.failures = 1;
  const failed = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 5, used: 0, written: 0 });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.given, { from: 0, to: 1, skip: 0 }, 'shown anyway');
  assert.equal(store.getState().sessions.A.current.hints, 0);
  const next = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 5, used: failed.used, range: failed.hintRange, written: 0 });
  assert.equal(next.ok, true);
  assert.equal(store.getState().sessions.A.current.hints, 2, 'the local count is carried into the next write');
  assert.deepEqual(store.getState().sessions.A.current.hintRange, { from: 0, to: 2 });
}));

test('hints feed the judgment the same way on both paths (D66 ②: review with 2+ hints)', () => withGroups({}, () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  let w = webHint(viaWeb, { cardKey: 'base:永', n: 5, used: 0, range: null, written: 0, groups: null });
  w = webHint(viaWeb, { cardKey: 'base:永', n: 5, used: w.used, range: w.hintRange, written: 0, groups: null });
  let r = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 5 });
  r = api.call('hint', { slot: 'A', cardKey: 'base:永', action: 'give', totalStrokes: 5, used: r.used, range: r.hintRange });
  commitComparePhase(viaWeb, { slot: 'A', cardKey: 'base:永', phase: 'compare', strokes: [STROKE_A] });
  commitJudgment(viaWeb, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [STROKE_A], hints: w.used });
  api.call('phase', { slot: 'A', cardKey: 'base:永', phase: 'compare', strokes: strokesToWire([STROKE_A]) });
  api.call('judge', { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: strokesToWire([STROKE_A]), hints: r.used });
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  const rec = Object.values(viaApi.getState().records).flat()[0];
  assert.equal(rec.help.hints, 2);
}));

test('snapshot: hint range, answer seen and the previous card line (text; the 修改 › action text comes with it)', () => {
  const store = fakeStore();
  const api = apiOn(store);
  nativeJudge(api, store, 'wrong', [STROKE_A]);
  const snap = writeSnapshot(store.getState(), 'A');
  assert.equal(snap.answerSeen, false);
  assert.equal(snap.hintRange, null);
  assert.equal(snap.line.state, 'judged');
  assert.equal(snap.line.text, t('R-W10.lineRecordedWrong', { char: '永' }).split(' · ')[0]);
  assert.ok(!snap.line.text.includes('和'), 'the line names the previous char, never the current answer (D16)');
});

// ---------------------------------------------------------------- B2.5 改判（correct op）：网页路径 == API 路径

import { commitCorrection } from '../../src/ui/screens/write/result-row.js';
import { isJudged } from '../../src/core/records.js';

/** fakeStore 的墨迹读取（真 store 的 getInk：state.ink[月][id]）。 */
function withInk(store) {
  store.getInk = rec => {
    const m = store.getState().ink[String(rec.localDay).slice(0, 7)];
    return m ? m[rec.id] : null;
  };
  return store;
}

function lastRecord(store) {
  return Object.values(store.getState().records).flat().filter(isJudged).slice(-1)[0];
}

test('correct op: 改判 = the web commitCorrection field by field, flips once and never counts twice (D19 / D07)', () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  assert.equal(webJudge(viaWeb, 'correct', [STROKE_A]).ok, true);
  assert.equal(nativeJudge(api, viaApi, 'correct', [STROKE_A]).ok, true);
  const rid = lastRecord(viaApi).id;
  assert.equal(writeSnapshot(viaApi.getState(), 'A').line.canChange, true, '结果行可改');

  // 改为写错（原生明示 to；网页同参数）
  const w = commitCorrection(viaWeb, { slot: 'A', recordId: rid, to: 'wrong' });
  const r = api.call('correct', { slot: 'A', recordId: rid, to: 'wrong' });
  assert.equal(w.ok, true);
  assert.equal(r.ok, true);
  assert.equal(r.judgment, 'wrong');
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(viaApi.labels, viaWeb.labels, 'same commits in the same order');
  const rec = lastRecord(viaApi);
  assert.equal(rec.judgment, 'wrong');
  assert.equal(Object.values(viaApi.getState().records).flat().length, 1, '只改这一次，不多算一次');
  assert.equal(rec.corrections.length, 1);
  assert.equal(r.snapshot.line.text, t('R-W10.lineChangedWrong', { char: '永' }).split(' · ')[0], '结果行换成「已改为写错」');
  assert.equal(r.snapshot.line.canChange, true);

  // 同一个 to 重发（回包丢了 / 连点）：不改回去、不再追加
  const again = api.call('correct', { slot: 'A', recordId: rid, to: 'wrong' });
  commitCorrection(viaWeb, { slot: 'A', recordId: rid, to: 'wrong' }); // 网页侧同一次重发（同一目标，空操作）
  assert.equal(again.ok, true);
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.equal(lastRecord(viaApi).corrections.length, 1, 'idempotent with an explicit target');
  assert.equal(lastRecord(viaApi).judgment, 'wrong');

  // 省略 to = 反过来（网页弹层 flip 的同一语义）
  const w2 = commitCorrection(viaWeb, { slot: 'A', recordId: rid });
  const r2 = api.call('correct', { slot: 'A', recordId: rid });
  assert.equal(w2.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.judgment, 'correct');
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.equal(viaApi.getState().sched['base:永'].reps, viaWeb.getState().sched['base:永'].reps);
});

test('correct op: only the line record of this session can be changed (sessions.canCorrect); a later card closes the door', () => {
  const store = fakeStore();
  const api = apiOn(store);
  nativeJudge(api, store, 'correct', [STROKE_A]);
  const first = lastRecord(store).id;
  assert.equal(api.call('correct', { slot: 'A', recordId: first, action: 'state' }).ok, true);
  nativeJudge(api, store, 'wrong', [STROKE_B]);
  const second = lastRecord(store).id;
  // 结果行只说紧挨着的上一个字：第一条已不可改
  const stale = api.call('correct', { slot: 'A', recordId: first, to: 'wrong' });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.kind, 'stale');
  assert.equal(api.call('correct', { slot: 'A', recordId: first, action: 'state' }).error.kind, 'stale');
  assert.equal(api.call('correct', { slot: 'A', recordId: 'nope', action: 'state' }).error.kind, 'stale');
  assert.equal(api.call('correct', { slot: 'A', recordId: second, to: 'correct' }).ok, true);
  // 没有结果行（会话槽为空）也不开放
  assert.equal(apiOn(fakeStore()).call('correct', { slot: 'A', recordId: first, action: 'state' }).error.kind, 'stale');
});

test('correct op state: sheet data = the record (char, judgment, own strokes from the stored ink); a failed write changes nothing and the retry applies once', () => {
  const store = withInk(fakeStore());
  const api = apiOn(store);
  nativeJudge(api, store, 'correct', [STROKE_A, STROKE_B]);
  const rid = lastRecord(store).id;
  const sheet = api.call('correct', { slot: 'A', recordId: rid, action: 'state' });
  assert.equal(sheet.ok, true);
  assert.equal(sheet.char, '永');
  assert.equal(sheet.judgment, 'correct');
  assert.equal(sheet.paper, false);
  assert.equal(sheet.strokes.length, 2, 'both strokes of the learner');
  assert.equal(sheet.strokes[0].length, STROKE_A.length);
  assert.ok(Math.abs(sheet.strokes[0][0][0] - STROKE_A[0].x) <= 0.06, 'raw points (Ink v4)');
  assert.equal(sheet.strokes[1][0].length, 4, 'pressure kept');
  const before = store.getState();
  store.failures = 1;
  const failed = api.call('correct', { slot: 'A', recordId: rid, to: 'wrong' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.kind, 'generic');
  assert.equal(store.getState(), before, 'D07: nothing changed');
  assert.equal(failed.snapshot.line.text, writeSnapshot(before, 'A').line.text);
  const retry = api.call('correct', { slot: 'A', recordId: rid, to: 'wrong' });
  assert.equal(retry.ok, true);
  assert.equal(lastRecord(store).corrections.length, 1);
  // 没有存墨迹（无 getInk、也没记下）→ 弹层「这一次没有留下笔迹」
  const bare = fakeStore();
  nativeJudge(apiOn(bare), bare, 'correct', [STROKE_A]);
  assert.deepEqual(apiOn(bare).call('correct', { slot: 'A', recordId: lastRecord(bare).id, action: 'state' }).strokes, []);
});

test('correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)', () => {
  const copy = apiOn(fakeStore()).call('open', { slot: 'A' }).copy;
  for (const k of ['X-JUDGE.changeTitle', 'X-JUDGE.changeToWrong', 'X-JUDGE.changeToCorrect', 'X-JUDGE.changeCancel', 'R-W10.changeBodyCorrect', 'R-W10.changeBodyWrong',
    'R-W10.changeFailed', 'R-W10.retry', 'R-W10.cancel', 'R-W09.labelMine', 'R-W09.labelReference', 'R-W17.noInk', 'R-D07.noInkLarge', 'R-W16.saveFailed', 'R-W16.retry', 'R-W16.cancel']) {
    assert.equal(copy[k], t(k), k);
  }

});

// ---------------------------------------------------------------- B2.4 看答案 / 描一遍 / 凭记忆写：网页路径 == API 路径

/** 带一个「复习字」的起始状态：base:永 前几天判断过（有调度项）→ 看答案会记一次 Again（D66 ①）；base:和 是新字。 */
function reviewState() {
  const st = initialState();
  const earlier = new Date(2026, 9, 14, 20).getTime();
  const rec = makeRecord({ id: 'r100', cardKey: 'base:永', sessionId: 's100', kind: 'judged', judgment: 'correct', at: earlier, help: { hints: 0, answerSeen: false, traced: false } });
  st.sched = { 'base:永': applyJudgment(undefined, rec).entry };
  st.records = { '2026-10': [rec] };
  return st;
}

test('showAnswer = commitAnswerSeen: answer-seen record + straight into the trace phase (D64 ②), a review char gets one Again (D66 ①)', () => {
  const viaWeb = fakeStore(reviewState());
  const viaApi = fakeStore(reviewState());
  const before = viaApi.getState().sched['base:永'];
  commitAnswerSeen(viaWeb, { slot: 'A', cardKey: 'base:永' });
  const r = apiOn(viaApi).call('showAnswer', { slot: 'A', cardKey: 'base:永' });
  assert.equal(r.ok, true);
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(viaApi.labels, viaWeb.labels);
  assert.equal(r.snapshot.answerPhase, 'trace');
  assert.equal(r.snapshot.phase, 'recall', 'phase keeps meaning recall / compare');
  assert.equal(r.snapshot.answerSeen, true);
  assert.deepEqual(r.snapshot.strokes, []);
  const st = viaApi.getState();
  assert.ok(st.sched['base:永'].seenAgainDay, 'Again recorded today');
  assert.notDeepEqual(st.sched['base:永'], before);
  assert.equal(st.sessions.A.current.phase, 'trace');
  const seen = Object.values(st.records).flat().filter(x => x.kind === 'answer-seen');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].help.traced, true);
  // 同一个字再点：不重复记录
  apiOn(viaApi).call('showAnswer', { slot: 'A', cardKey: 'base:永' });
  assert.equal(Object.values(viaApi.getState().records).flat().filter(x => x.kind === 'answer-seen').length, 1);
});

test('answer flow: trace → 凭记忆写 (retrace) → 下一个, strokes included — web path and API path agree on every commit (D70 ② no self ink, D66 ① Again)', () => {
  const viaWeb = fakeStore(reviewState());
  const viaApi = fakeStore(reviewState());
  const api = apiOn(viaApi);
  const key = 'base:永';
  // 网页路径
  commitAnswerSeen(viaWeb, { slot: 'A', cardKey: key });
  commitStrokes(viaWeb, { slot: 'A', cardKey: key, inkKey: `${key}|trace`, strokes: [STROKE_A], phase: 'recall' });
  commitAnswerPhase(viaWeb, { slot: 'A', cardKey: key, phase: 'retrace', strokes: [STROKE_A] });
  commitStrokes(viaWeb, { slot: 'A', cardKey: key, inkKey: `${key}|retrace`, strokes: [STROKE_B, STROKE_A], phase: 'recall' });
  commitAnswerNext(viaWeb, { slot: 'A', cardKey: key, strokes: [STROKE_B, STROKE_A] });
  // API 路径（原生：看答案 → 描一遍里写一笔（strokes op）→ 凭记忆写 → 写两笔 → 下一个）
  assert.equal(api.call('showAnswer', { slot: 'A', cardKey: key }).ok, true);
  assert.equal(api.call('strokes', { slot: 'A', cardKey: key, strokes: strokesToWire([STROKE_A]), phase: 'recall' }).ok, true);
  assert.deepEqual(strokesFromWire(writeSnapshot(viaApi.getState(), 'A').strokes), [STROKE_A], 'the trace strokes are what the snapshot restores');
  const retrace = api.call('answerPhase', { slot: 'A', cardKey: key, phase: 'retrace', strokes: strokesToWire([STROKE_A]) });
  assert.equal(retrace.snapshot.answerPhase, 'retrace');
  assert.deepEqual(retrace.snapshot.strokes, [], '凭记忆写 starts from an empty grid');
  api.call('strokes', { slot: 'A', cardKey: key, strokes: strokesToWire([STROKE_B, STROKE_A]), phase: 'recall' });
  const next = api.call('answerNext', { slot: 'A', cardKey: key, strokes: strokesToWire([STROKE_B, STROKE_A]) });
  assert.equal(next.ok, true);
  assert.equal(next.finished, null);
  assert.equal(next.snapshot.cardKey, 'base:和', 'advanced to the next char');
  assert.equal(next.snapshot.line.state, 'saw', 'the line under the grid says the answer was seen (no judgment)');
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(viaApi.labels, viaWeb.labels);
  const st = viaApi.getState();
  const seen = Object.values(st.records).flat().find(r => r.kind === 'answer-seen');
  assert.ok(!Object.values(st.ink).some(m => seen.id in m), 'D70 ②: the 凭记忆写 strokes are practice only — not stored (API path)');
  assert.deepEqual(viaWeb.getState().ink, {}, 'D70 ②: same on the web path');
  assert.equal(Object.values(st.records).flat().filter(r => r.kind === 'judged' && r.sessionId === 's1').length, 0, 'no judgment');
});

test('answer flow: 再描一遍 (retrace → trace) and the recall-after-answer-seen path (hint gave the whole char) behave like the web', () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  const key = 'base:永';
  commitAnswerSeen(viaWeb, { slot: 'A', cardKey: key });
  commitAnswerPhase(viaWeb, { slot: 'A', cardKey: key, phase: 'retrace', strokes: [] });
  commitAnswerPhase(viaWeb, { slot: 'A', cardKey: key, phase: 'trace', strokes: [STROKE_A] });
  api.call('showAnswer', { slot: 'A', cardKey: key });
  api.call('answerPhase', { slot: 'A', cardKey: key, phase: 'retrace', strokes: [] });
  const again = api.call('answerPhase', { slot: 'A', cardKey: key, phase: 'trace', strokes: strokesToWire([STROKE_A]) });
  assert.equal(again.snapshot.answerPhase, 'trace');
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(viaApi.labels, viaWeb.labels);
  // 提示给完整字（看过答案，留在回忆阶段）：快照 answerPhase 为 null、answerSeen 为 true；「下一个」直接推进，看后写的笔画同样只算练习（D70 ②）
  const hintStore = fakeStore();
  commitAnswerSeen(hintStore, { slot: 'A', cardKey: key, stay: true, hints: 4, hintRange: { from: 0, to: 8 } });
  const snap = writeSnapshot(hintStore.getState(), 'A');
  assert.equal(snap.answerSeen, true);
  assert.equal(snap.answerPhase, null);
  assert.equal(snap.phase, 'recall');
  const n = apiOn(hintStore).call('answerNext', { slot: 'A', cardKey: key, strokes: strokesToWire([STROKE_A]) });
  assert.equal(n.ok, true);
  const st = hintStore.getState();
  assert.equal(st.sessions.A.cursor, 1);
  const seen = Object.values(st.records).flat().find(r => r.kind === 'answer-seen');
  assert.equal(seen.help.traced, false, 'a hint-given answer was never traced');
  assert.ok(!Object.values(st.ink).some(m => seen.id in m), 'D70 ②: recall-after-seen writing is practice too — not stored');
});

test('answer ops: a failed write changes nothing (D07), the retry succeeds once; a stale card is refused with the advanced snapshot; bad phase refused', () => {
  const store = fakeStore();
  const api = apiOn(store);
  const key = 'base:永';
  const before = store.getState();
  store.failures = 1;
  const failed = api.call('showAnswer', { slot: 'A', cardKey: key });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.kind, 'generic');
  assert.equal(failed.snapshot.answerPhase, null, 'still the recall page — the 三段式 stays on it');
  assert.equal(store.getState(), before);
  assert.equal(api.call('showAnswer', { slot: 'A', cardKey: key }).ok, true);
  store.failures = 1;
  const f2 = api.call('answerPhase', { slot: 'A', cardKey: key, phase: 'retrace', strokes: strokesToWire([STROKE_A]) });
  assert.equal(f2.ok, false);
  assert.equal(f2.snapshot.answerPhase, 'trace', 'stays in the trace phase, strokes kept by the native page');
  store.failures = 1;
  assert.equal(api.call('answerNext', { slot: 'A', cardKey: key, strokes: [] }).ok, false);
  assert.equal(store.getState().sessions.A.cursor, 0, 'not advanced');
  assert.equal(api.call('answerNext', { slot: 'A', cardKey: key, strokes: [] }).ok, true);
  const stale = api.call('answerNext', { slot: 'A', cardKey: key, strokes: [] });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.kind, 'stale');
  assert.equal(stale.snapshot.cardKey, 'base:和');
  assert.equal(Object.values(store.getState().records).flat().filter(r => r.kind === 'answer-seen').length, 1);
  assert.equal(api.call('answerPhase', { slot: 'A', cardKey: 'base:和', phase: 'compare' }).error.kind, 'invalid');
});

test('answer flow: 下一个 on the last char finishes the group in the same call (same order as the web page)', () => {
  const store = fakeStore();
  const api = apiOn(store);
  let r;
  for (const c of CHARS) {
    api.call('showAnswer', { slot: 'A', cardKey: 'base:' + c });
    r = api.call('answerNext', { slot: 'A', cardKey: 'base:' + c, strokes: [] });
  }
  assert.deepEqual(r.finished, { ok: true, sessionId: 's1' });
  assert.equal(store.getState().sessions.A, null);
  assert.equal(store.getState().sessions.lastEnded.A.id, 's1');
});

test('open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)', () => {
  const r = apiOn(fakeStore()).call('open', { slot: 'A' });
  assert.deepEqual(r.trace, {
    maxMs: policyModule.motion.stepPlayMaxMs, speed: policyModule.motion.answerSpeed, gapMs: policyModule.motion.answerStrokeGapMs,
    fadeMs: policyModule.motion.answerFadeMs, hookWidthPt: 0.75, hookWidthMoreContrastPt: 1.5,
  });
  assert.equal(r.trace.maxMs, 1600);
  assert.deepEqual(r.skipUndo, { ms: policyModule.skipUndo.ms, pauseWhileHeld: true, keepOpenWithAssistiveTech: true });
  assert.equal(r.skipUndo.ms, 5000);
});

// ---------------------------------------------------------------- B2.6 跳过 / 撤销 / 结束这组：网页路径 == API 路径

test('skip + undoSkip = commitSkip + commitUndoSkip: record, session, hints and the strokes written back, field by field', () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  const key = 'base:永';
  const w = commitSkip(viaWeb, { slot: 'A', cardKey: key, hints: 2 });
  const r = api.call('skip', { slot: 'A', cardKey: key, hints: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.undo, { sessionId: 's1', recordId: w.record.id, char: '永', ms: 5000 });
  assert.equal(r.snapshot.cardKey, 'base:和');
  assert.equal(r.finished, null);
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  // 撤销：跳过时格子里的本人笔画（网页 useSkip 先 encodeRawStrokes）写回 current.strokes
  commitUndoSkip(viaWeb, { slot: 'A', sessionId: 's1', recordId: w.record.id, strokes: encodeRawStrokes([STROKE_A, STROKE_B]) });
  const u = api.call('undoSkip', { slot: 'A', sessionId: 's1', recordId: r.undo.recordId, strokes: strokesToWire([STROKE_A, STROKE_B]) });
  assert.equal(u.ok, true);
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.deepEqual(viaApi.labels, viaWeb.labels);
  assert.equal(u.snapshot.cardKey, key, 'the skipped char is back');
  assert.equal(u.snapshot.hints, 2, 'the hint count comes back with it (D07)');
  assert.equal(strokesFromWire(u.snapshot.strokes).length, 2, 'and the strokes that were in the grid');
  assert.equal(Object.values(viaApi.getState().records).flat().length, 0, 'the skipped record is gone');
  // 没写笔画的撤销：不带笔画
  const w2 = commitSkip(viaWeb, { slot: 'A', cardKey: key });
  const r2 = api.call('skip', { slot: 'A', cardKey: key });
  commitUndoSkip(viaWeb, { slot: 'A', sessionId: 's1', recordId: w2.record.id, strokes: null });
  api.call('undoSkip', { slot: 'A', sessionId: 's1', recordId: r2.undo.recordId, strokes: [] });
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
});

test('skip: writes the same skipped record as the web (no judgment, not re-implemented)', () => {
  const store = fakeStore();
  const r = apiOn(store).call('skip', { slot: 'A', cardKey: 'base:永' });
  const rec = Object.values(store.getState().records).flat()[0];
  assert.equal(rec.kind, 'skipped');
  assert.equal(rec.id, r.undo.recordId);
  assert.equal(store.getState().sessions.A.items.at(-1).kind, 'skipped');
});

test('skip: D07 — a failed skip changes nothing; the retry records once; a second skip of the same card is stale', () => {
  const store = fakeStore();
  const api = apiOn(store);
  const before = store.getState();
  store.failures = 1;
  const failed = api.call('skip', { slot: 'A', cardKey: 'base:永' });
  assert.equal(failed.ok, false);
  assert.equal(failed.snapshot.cardKey, 'base:永');
  assert.equal(store.getState(), before);
  assert.equal(api.call('skip', { slot: 'A', cardKey: 'base:永' }).ok, true);
  const again = api.call('skip', { slot: 'A', cardKey: 'base:永' });
  assert.equal(again.error.kind, 'stale');
  assert.equal(Object.values(store.getState().records).flat().length, 1);
});

test('undoSkip: only the last skipped record can be undone (stale otherwise); a failed undo changes nothing and retries', () => {
  const store = fakeStore();
  const api = apiOn(store);
  const a = api.call('skip', { slot: 'A', cardKey: 'base:永' });
  const b = api.call('skip', { slot: 'A', cardKey: 'base:和' });
  assert.equal(api.call('undoSkip', { slot: 'A', sessionId: 's1', recordId: a.undo.recordId }).error.kind, 'stale', 'not the last item any more');
  store.failures = 1;
  const before = store.getState();
  assert.equal(api.call('undoSkip', { slot: 'A', sessionId: 's1', recordId: b.undo.recordId }).ok, false);
  assert.equal(store.getState(), before);
  assert.equal(api.call('undoSkip', { slot: 'A', sessionId: 's1', recordId: b.undo.recordId }).ok, true);
  assert.equal(store.getState().sessions.A.cursor, 1);
});

test('skip of the last char finishes the group; exit hands the undo chance (remaining ms + strokes) to the result page / source page', () => {
  const store = fakeStore();
  const calls = [];
  const api = apiOn(store, {
    back: (slot, undo) => calls.push(['back', slot, undo]),
    toResult: (slot, id, undo) => calls.push(['result', slot, id, undo]),
  });
  api.call('skip', { slot: 'A', cardKey: 'base:永' });
  api.call('skip', { slot: 'A', cardKey: 'base:和' });
  const last = api.call('skip', { slot: 'A', cardKey: 'base:春' });
  assert.deepEqual(last.finished, { ok: true, sessionId: 's1' });
  assert.equal(last.snapshot.active, false);
  assert.equal(store.getState().sessions.lastEnded.A.id, 's1');
  api.call('exit', { slot: 'A', to: 'result', sessionId: 's1', undo: { sessionId: 's1', recordId: last.undo.recordId, char: '春', strokes: strokesToWire([STROKE_A]), remainingMs: 4200 } });
  api.call('exit', { slot: 'A', to: 'back', undo: { sessionId: 's1', recordId: 'r9', char: '永', remainingMs: 100 } });
  api.call('exit', { slot: 'A', to: 'back', undo: { recordId: 'x' } });
  assert.deepEqual(calls[0], ['result', 'A', 's1', { sessionId: 's1', recordId: last.undo.recordId, char: '春', strokes: encodeRawStrokes([STROKE_A]), remainingMs: 4200 }]);
  assert.deepEqual(calls[1], ['back', 'A', { sessionId: 's1', recordId: 'r9', char: '永', strokes: null, remainingMs: 100 }]);
  assert.equal(calls[2][2], null, 'a malformed hand-over is ignored');
  // 结果页取走交接的撤销机会（网页同一组函数）
  handoffSkipUndo({ ...calls[0][3], slot: 'A', until: Date.now() + 3000 });
  const taken = takeSkipUndo('A', 's1', 0);
  assert.equal(taken.recordId, last.undo.recordId);
});

test('end: counts and commit = endConfirmCounts + commitEndGroup (web path); judged > 0 → result page, none judged → back to the source', () => {
  const viaWeb = fakeStore();
  const viaApi = fakeStore();
  const api = apiOn(viaApi);
  nativeJudge(api, viaApi, 'correct', [STROKE_A]);
  webJudge(viaWeb, 'correct', [STROKE_A]);
  const c = api.call('end', { slot: 'A', sessionId: 's1', action: 'counts' });
  assert.deepEqual({ n: c.n, m: c.m }, endConfirmCounts(viaWeb.getState(), 'A'));
  assert.deepEqual({ n: c.n, m: c.m }, { n: 2, m: 1 });
  assert.equal(c.canEnd, true);
  const w = commitEndGroup(viaWeb, { slot: 'A', sessionId: 's1' });
  const r = api.call('end', { slot: 'A', sessionId: 's1' });
  assert.equal(r.ok, true);
  assert.equal(r.judgedCount, w.judgedCount);
  assert.equal(r.judgedCount, 1);
  assert.equal(r.snapshot.active, false);
  assert.deepEqual(viaApi.getState(), viaWeb.getState());
  assert.equal(viaApi.getState().sessions.lastEnded.A.endedEarly, true);
  const none = apiOn(fakeStore());
  const z = none.call('end', { slot: 'A', sessionId: 's1' });
  assert.equal(z.ok, true);
  assert.equal(z.judgedCount, 0);
});

test('end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd', () => {
  const store = fakeStore();
  const api = apiOn(store);
  assert.equal(writeSnapshot(store.getState(), 'A').canEnd, true);
  const before = store.getState();
  store.failures = 1;
  const failed = api.call('end', { slot: 'A', sessionId: 's1' });
  assert.equal(failed.ok, false);
  assert.equal(failed.snapshot.active, true, 'the group is still there');
  assert.equal(store.getState(), before);
  assert.equal(api.call('end', { slot: 'A', sessionId: 's1' }).ok, true);
  assert.equal(api.call('end', { slot: 'A', sessionId: 's1' }).error.kind, 'stale');
  const first = initialState();
  first.sessions.A = createSession({ id: 's2', kind: 'first', queue: CHARS.map(c => 'base:' + c), at: T0 });
  assert.equal(writeSnapshot(first, 'A').canEnd, false, 'no 结束这组 in the first practice (D66 ⑥)');
  assert.equal(apiOn(fakeStore(first)).call('end', { slot: 'A', sessionId: 's2' }).error.kind, 'stale');
});
