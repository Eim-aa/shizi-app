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

test('ops: the B2.0 set is named; unknown op is rejected without throwing', () => {
  assert.deepEqual([...NATIVE_WRITE_OPS], ['open', 'strokes', 'phase', 'judge', 'exit', 'copy']);
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
