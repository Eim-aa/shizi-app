// M1-6 会话现场与恢复的纯逻辑单测（01 §3.3 / §4；决定-D07；P52）：
// storedStrokes（刷新恢复的初值）、syncPatch / commitStrokes（抬笔写 + recall⇄compare 对齐）、
// recoverInDraft / commitRecover（已有 judged → 补推进；compare 空笔画 → recall）、noticeFor（两句）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storedStrokes, syncPatch, commitStrokes, applyStrokesToDraft, recoverInDraft, commitRecover, noticeFor, PersistNotice,
  STROKES_LABEL, RECOVER_LABEL,
} from '../../src/ui/screens/write/persist.js';
import { createSession } from '../../src/core/sessions.js';
import { makeRecord, todayCount } from '../../src/core/records.js';
import { encodeRawStrokes } from '../../src/core/ink-math.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';

const T0 = new Date(2026, 8, 24, 12, 0).getTime();
const MONTH = '2026-09';
const DAY = '2026-09-24';
const S1 = [{ x: 60, y: 170, t: 0 }, { x: 170.4, y: 171, t: 16 }, { x: 280, y: 172, t: 32 }];
const S2 = [{ x: 172, y: 60, t: 0 }, { x: 172, y: 280, t: 40 }];

function stateWith({ chars = ['永', '和', '春'], cursor = 0, current = {}, records = [], items = [] } = {}) {
  const s = createSession({ id: 's1', kind: 'daily', queue: chars.map(c => 'base:' + c), at: T0 });
  const A = { ...s, cursor, items, current: { ...s.current, ...current } };
  return { records: records.length ? { [MONTH]: records } : {}, sched: {}, ink: {}, sessions: { A, B: null, lastEnded: {} }, meta: null };
}

function fakeStore(state, { fail = 0, kind = 'generic' } = {}) {
  let cur = state;
  let failures = fail;
  const calls = [];
  return {
    calls,
    getState: () => cur,
    commit(label, fn) {
      calls.push(label);
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: T0 + 1000, label, nextId: p => `${p}9` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      if (failures > 0) {
        failures -= 1;
        return { ok: false, error: { kind } };
      }
      cur = draft;
      return { ok: true, keys: ['shizi.v2.sessions'] };
    },
  };
}

function judged(id, char, sessionId = 's1') {
  return makeRecord({ id, cardKey: 'base:' + char, sessionId, kind: 'judged', judgment: 'correct', at: T0,
    help: { hints: 0, answerSeen: false, traced: false } });
}

test('storedStrokes: decodes the stored rows of the current phase group, stable reference, otherwise empty', () => {
  const rows = encodeRawStrokes([S1, S2]);
  const st = stateWith({ current: { phase: 'compare', strokes: rows } });
  const a = st.sessions.A;
  const got = storedStrokes(a, 'base:永', 'base:永'); // recall 与 compare 共用 cardKey 这一份
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].map(p => [p.x, p.y, p.t]), [[60, 170, 0], [170.4, 171, 16], [280, 172, 32]]);
  assert.equal(storedStrokes(a, 'base:永', 'base:永'), got, 'same rows → same decoded array (InkGrid compares by reference)');
  assert.deepEqual(storedStrokes(a, 'base:和', 'base:和'), [], 'not the current character');
  assert.deepEqual(storedStrokes(a, 'base:永', 'base:永|trace'), [], 'another phase group');
  const tr = stateWith({ current: { phase: 'trace', strokes: rows } }).sessions.A;
  assert.equal(storedStrokes(tr, 'base:永', 'base:永|trace').length, 2, 'trace has its own group');
  assert.deepEqual(storedStrokes(tr, 'base:永', 'base:永'), []);
  assert.deepEqual(storedStrokes(null, 'base:永', 'base:永'), []);
});

test('syncPatch: strokes differ → rows; equal → null; recall⇄compare phase aligned only within that pair', () => {
  const a = stateWith().sessions.A;
  assert.equal(syncPatch(a, { cardKey: 'base:永', inkKey: 'base:永', strokes: [], phase: 'recall' }), null, 'nothing to write');
  const p = syncPatch(a, { cardKey: 'base:永', inkKey: 'base:永', strokes: [S1], phase: 'recall' });
  assert.deepEqual(p, { strokes: encodeRawStrokes([S1]) });
  const saved = { ...a, current: { ...a.current, strokes: p.strokes } };
  assert.equal(syncPatch(saved, { cardKey: 'base:永', inkKey: 'base:永', strokes: [S1], phase: 'recall' }), null, 'already saved');
  // compare 本地覆盖（进判断页的写入失败）→ 补写阶段
  assert.deepEqual(syncPatch(saved, { cardKey: 'base:永', inkKey: 'base:永', strokes: [S1], phase: 'compare' }), { phase: 'compare' });
  // compare 没有笔画不补写
  assert.equal(syncPatch(a, { cardKey: 'base:永', inkKey: 'base:永', strokes: [], phase: 'compare' }), null);
  // 存下 compare + 空笔画、本地 recall → 改回 recall
  const cmpEmpty = { ...a, current: { ...a.current, phase: 'compare', strokes: [] } };
  assert.deepEqual(syncPatch(cmpEmpty, { cardKey: 'base:永', inkKey: 'base:永', strokes: [], phase: 'recall' }), { phase: 'recall' });
  // answer 流程阶段不由本模块改
  const tr = { ...a, current: { ...a.current, phase: 'trace' } };
  assert.deepEqual(syncPatch(tr, { cardKey: 'base:永', inkKey: 'base:永|trace', strokes: [S1], phase: 'trace' }), { strokes: encodeRawStrokes([S1]) });
  assert.equal(syncPatch(tr, { cardKey: 'base:永', inkKey: 'base:永', strokes: [S1], phase: 'recall' }), null, 'local group ≠ stored group');
  assert.equal(syncPatch(a, { cardKey: 'base:和', inkKey: 'base:和', strokes: [S1], phase: 'recall' }), null, 'stale character');
});

test('commitStrokes: one sessions commit, shape-valid; no-op when saved; stale after the character moved on', () => {
  const store = fakeStore(stateWith());
  const r = commitStrokes(store, { slot: 'A', cardKey: 'base:永', inkKey: 'base:永', strokes: [S1, S2], phase: 'recall' });
  assert.equal(r.ok, true);
  assert.deepEqual(store.calls, [STROKES_LABEL]);
  const sessions = store.getState().sessions;
  assert.equal(sessions.A.current.strokes.length, 2);
  assert.equal(sessions.A.current.phase, 'recall');
  assert.equal(sessions.A.updatedAt, T0 + 1000);
  assert.equal(validateValue(KEYS.sessions, sessions), null, 'sessions pass the schema');
  const again = commitStrokes(store, { slot: 'A', cardKey: 'base:永', inkKey: 'base:永', strokes: [S1, S2], phase: 'recall' });
  assert.equal(again.ok, true);
  assert.equal(again.noop, true);
  assert.equal(store.calls.length, 1, 'no second commit');
  const stale = commitStrokes(store, { slot: 'A', cardKey: 'base:和', inkKey: 'base:和', strokes: [S1], phase: 'recall' });
  assert.deepEqual(stale, { ok: false, error: { kind: 'stale' } });
  assert.throws(() => applyStrokesToDraft(stateWith(), { slot: 'A', cardKey: 'base:和', patch: {}, at: T0 }));
});

test('commitStrokes: failure (P52) leaves the stored session untouched; the next call rewrites everything', () => {
  const store = fakeStore(stateWith(), { fail: 1 });
  const first = commitStrokes(store, { slot: 'A', cardKey: 'base:永', inkKey: 'base:永', strokes: [S1], phase: 'recall' });
  assert.equal(first.ok, false);
  assert.equal(store.getState().sessions.A.current.strokes.length, 0);
  const second = commitStrokes(store, { slot: 'A', cardKey: 'base:永', inkKey: 'base:永', strokes: [S1, S2], phase: 'recall' });
  assert.equal(second.ok, true);
  assert.equal(store.getState().sessions.A.current.strokes.length, 2);
});

test('recover: judged record of this session and character → advance without a new record; N unchanged; idempotent', () => {
  const rows = encodeRawStrokes([S1]);
  const st = stateWith({ current: { phase: 'compare', strokes: rows }, records: [judged('r1', '永')] });
  const store = fakeStore(st);
  const r = commitRecover(store, { slot: 'A' });
  assert.equal(r.ok, true);
  assert.deepEqual(store.calls, [RECOVER_LABEL]);
  const a = store.getState().sessions.A;
  assert.equal(a.cursor, 1);
  assert.equal(a.current.phase, 'recall');
  assert.deepEqual(a.current.strokes, []);
  assert.deepEqual(a.items, [{ cardKey: 'base:永', kind: 'judged', recordId: 'r1' }]);
  assert.deepEqual(a.lastLine, { recordId: 'r1', kind: 'record' });
  const records = Object.values(store.getState().records).flat();
  assert.equal(records.length, 1, 'no second record');
  assert.equal(todayCount(records, DAY), 1);
  const again = commitRecover(store, { slot: 'A' });
  assert.equal(again.noop, true);
  assert.equal(store.calls.length, 1, 'nothing more to do');
});

test('recover: another session’s record does not advance; compare with no strokes falls back to recall', () => {
  const other = stateWith({ current: { phase: 'compare', strokes: encodeRawStrokes([S1]) }, records: [judged('r1', '永', 's9')] });
  const d1 = JSON.parse(JSON.stringify(other));
  assert.equal(recoverInDraft(d1, { slot: 'A' }), false);
  assert.equal(d1.sessions.A.cursor, 0);
  const empty = stateWith({ current: { phase: 'compare', strokes: [] } });
  const d2 = JSON.parse(JSON.stringify(empty));
  assert.equal(recoverInDraft(d2, { slot: 'A' }), true);
  assert.equal(d2.sessions.A.current.phase, 'recall');
  assert.equal(d2.sessions.A.cursor, 0);
  assert.equal(recoverInDraft({ sessions: { A: null, B: null, lastEnded: {} }, records: {} }, { slot: 'A' }), false);
});

test('noticeFor: quota vs generic sentence from copy; PersistNotice exposes role=status and data-kind', () => {
  assert.deepEqual(noticeFor({ kind: 'quota' }), { kind: 'quota', text: t('X-PERSIST.quotaFailed') });
  assert.deepEqual(noticeFor({ kind: 'unknown' }), { kind: 'generic', text: t('X-PERSIST.saveFailed') });
  assert.deepEqual(noticeFor(null), { kind: 'generic', text: t('X-PERSIST.saveFailed') });
  assert.equal(t('X-PERSIST.saveFailed'), '这次进度没有保存。请立即导出备份后重新打开 App。');
  assert.equal(t('X-PERSIST.quotaFailed'), '本地空间已满，这次进度没有保存。请立即导出备份并清理空间。');
  assert.equal(PersistNotice({ notice: null }), null);
  const v = PersistNotice({ notice: { kind: 'quota', text: 'x' } });
  assert.equal(v.props.role, 'status');
  assert.equal(v.props['data-kind'], 'quota');
  assert.equal(v.props['data-testid'], 'write-persist-notice');
});
