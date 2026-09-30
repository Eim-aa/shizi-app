// M1-5 判断页 / 结果行 / 跳过的纯逻辑单测（01 §3.2 / §3.3 / §5 / §6.6；决定-D03 / D07 / D19 / D23）。
// 草稿变换（judgeInDraft / correctInDraft / skipInDraft / undoSkipInDraft）、commit 前置检查、结果行模型、判断两键视图。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import {
  judgeInDraft, commitJudgment, commitComparePhase, hasInk, findJudged, JudgeButtons, JudgeFooter, JUDGE_ORDER, paintMini,
  rememberInk, recalledInk,
} from '../../src/ui/screens/write/compare.js';
import { correctInDraft, commitCorrection, resultRowModel, lineVisible, ResultRowView } from '../../src/ui/screens/write/result-row.js';
import { skipInDraft, undoSkipInDraft, commitSkip, commitUndoSkip, canUndoSkip, SKIP_UNDO_MS, SkipUndoBar } from '../../src/ui/screens/write/skip.js';
import { Button } from '../../src/ui/components/Button.js';
import { createSession } from '../../src/core/sessions.js';
import { replay } from '../../src/core/fsrs.js';
import { isInkV3, decodeRawStrokes } from '../../src/core/ink-math.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';

loadFSRSGlobal();

const T0 = new Date(2026, 8, 24, 12, 0).getTime();
const MONTH = '2026-09';
const STROKE = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];

function draftWith({ chars = ['永', '和', '春'], cursor = 0, current = {}, records = [], items = [], lastLine = null, sched = {} } = {}) {
  const s = createSession({ id: 's1', kind: 'daily', queue: chars.map(c => 'base:' + c), at: T0 });
  const A = { ...s, cursor, items, lastLine, current: { ...s.current, ...current } };
  return { records: records.length ? { [MONTH]: records } : {}, sched, ink: {}, sessions: { A, B: null, lastEnded: {} }, meta: null };
}

function idGen(start = 1) {
  let n = start - 1;
  return prefix => `${prefix}${(n += 1)}`;
}

function recs(d) {
  return Object.values(d.records).flat();
}

/** 最小 store：commit = 深拷贝草稿 → mutate → 可注入失败。 */
function fakeStore(state, { fail = 0 } = {}) {
  let cur = state;
  let failures = fail;
  let now = T0 + 60_000;
  let serial = 100;
  const calls = [];
  return {
    calls,
    getState: () => cur,
    commit(label, fn) {
      calls.push(label);
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: (now += 1000), label, nextId: p => `${p}${(serial += 1)}` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      if (failures > 0) {
        failures -= 1;
        return { ok: false, error: { kind: 'generic' } };
      }
      cur = draft;
      return { ok: true, keys: [] };
    },
  };
}

// ---------------------------------------------------------------- 判断

test('judgeInDraft: judged record + FSRS + advance with fsrsBefore + line record; no ink when perRecordInk is off', () => {
  const d = draftWith({ current: { hints: 1 } });
  const out = judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [STROKE], hints: 0, at: T0, nextId: idGen(3), perRecordInk: false });
  assert.equal(out.reused, false);
  assert.equal(out.inkWritten, false);
  const [r] = recs(d);
  assert.equal(r.id, 'r3');
  assert.equal(r.kind, 'judged');
  assert.equal(r.judgment, 'correct');
  assert.equal(r.sessionId, 's1');
  assert.deepEqual(r.help, { hints: 1, answerSeen: false, traced: false }, 'hints = max(stored 1, local 0)');
  assert.equal('inkId' in r, false);
  assert.deepEqual(d.ink, {}, 'no ink month written');
  const entry = d.sched['base:永'];
  assert.match(entry.due, /^\d{4}-\d{2}-\d{2}$/);
  const A = d.sessions.A;
  assert.equal(A.cursor, 1);
  assert.equal(A.items.length, 1);
  assert.equal(A.items[0].recordId, 'r3');
  assert.ok(A.items[0].fsrsBefore && typeof A.items[0].fsrsBefore.stability === 'number', 'fsrsBefore kept');
  assert.deepEqual(A.lastLine, { recordId: 'r3', kind: 'record' });
  assert.equal(A.current.phase, 'recall');
  assert.equal(A.current.hints, 0, 'next character starts fresh');
  assert.equal(validateValue(KEYS.sessions, d.sessions), null, 'sessions shape valid');
  assert.equal(validateValue(KEYS.sched, d.sched), null, 'sched shape valid');
});

test('judgeInDraft: local hint count wins when larger; clamps to 2; wrong → Again due is tomorrow', () => {
  const d = draftWith({ current: { hints: 0 } });
  judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment: 'wrong', strokes: [STROKE], hints: 5, at: T0, nextId: idGen() });
  const [r] = recs(d);
  assert.equal(r.help.hints, 2);
  assert.equal(r.judgment, 'wrong');
  assert.equal(d.sched['base:永'].due, '2026-09-25', 'Again → at least tomorrow');
});

test('judgeInDraft: perRecordInk on writes Ink v3 under the record month (P31 / P78 / 01 §3.5)', () => {
  const d = draftWith();
  const out = judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [STROKE, STROKE], at: T0, nextId: idGen(), perRecordInk: true });
  assert.equal(out.inkWritten, true);
  const ink = d.ink[MONTH].r1;
  assert.ok(isInkV3(ink), 'packed v3 encoding (P78)');
  assert.equal(ink.s.length, 2);
  assert.equal(validateValue(`shizi.v2.ink.${MONTH}`, d.ink[MONTH]), null, 'ink month shape valid');
});

test('judgeInDraft: rejects empty strokes, stale card and bad judgment', () => {
  for (const strokes of [[], [[]], null, undefined]) {
    assert.throws(() => judgeInDraft(draftWith(), { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes, at: T0, nextId: idGen() }), /no strokes/);
  }
  assert.throws(() => judgeInDraft(draftWith(), { slot: 'A', cardKey: 'base:和', judgment: 'correct', strokes: [STROKE], at: T0, nextId: idGen() }), /not the current card/);
  assert.throws(() => judgeInDraft(draftWith(), { slot: 'A', cardKey: 'base:永', judgment: 'maybe', strokes: [STROKE], at: T0, nextId: idGen() }), /judgment/);
  assert.equal(hasInk([[{ x: 1, y: 1, t: 0 }]]), true);
  assert.equal(hasInk([[]]), false);
});

test('judgeInDraft: an existing judged record of this session + card is reused (no double count, D07)', () => {
  const existing = { id: 'r1', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'judged', judgment: 'correct', at: T0, localDay: '2026-09-24', help: { hints: 0, answerSeen: false, traced: false } };
  const d = draftWith({ records: [existing], sched: { 'base:永': { fsrs: null, due: '2026-09-27', lastJudgedAt: T0 } } });
  const out = judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment: 'wrong', strokes: [STROKE], at: T0 + 5, nextId: idGen(2) });
  assert.equal(out.reused, true);
  assert.equal(recs(d).length, 1, 'no new record');
  assert.equal(d.sched['base:永'].due, '2026-09-27', 'no second review');
  assert.equal(d.sessions.A.cursor, 1);
  assert.equal(d.sessions.A.items[0].recordId, 'r1');
  assert.equal(findJudged(d, 's1', 'base:永').id, 'r1');
});

test('commitJudgment: empty strokes never reach commit; stale card; failure leaves state untouched', () => {
  const store = fakeStore(draftWith());
  assert.deepEqual(commitJudgment(store, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [] }).error, { kind: 'empty-strokes' });
  assert.deepEqual(store.calls, [], 'commit not called for empty strokes');
  assert.equal(commitJudgment(store, { slot: 'A', cardKey: 'base:和', judgment: 'correct', strokes: [STROKE] }).error.kind, 'stale');
  const failing = fakeStore(draftWith(), { fail: 1 });
  const r1 = commitJudgment(failing, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [STROKE] });
  assert.equal(r1.ok, false);
  assert.equal(recs(failing.getState()).length, 0, 'nothing published');
  const r2 = commitJudgment(failing, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [STROKE] });
  assert.equal(r2.ok, true);
  assert.equal(r2.record.kind, 'judged');
  assert.equal(recs(failing.getState()).length, 1, 'retry writes exactly one record');
});

test('commitComparePhase: writes phase and encoded raw strokes; recall keeps strokes', () => {
  const store = fakeStore(draftWith());
  assert.equal(commitComparePhase(store, { slot: 'A', cardKey: 'base:永', phase: 'compare', strokes: [STROKE] }).ok, true);
  const cur = store.getState().sessions.A.current;
  assert.equal(cur.phase, 'compare');
  assert.equal(decodeRawStrokes(cur.strokes).length, 1);
  assert.equal(commitComparePhase(store, { slot: 'A', cardKey: 'base:永', phase: 'recall' }).ok, true);
  assert.equal(store.getState().sessions.A.current.phase, 'recall');
  assert.equal(store.getState().sessions.A.current.strokes.length, 1);
  assert.throws(() => commitComparePhase(store, { slot: 'A', cardKey: 'base:永', phase: 'answer' }));
});

// ---------------------------------------------------------------- 修改判断

function judgedDraft({ judgment = 'correct', current = { hints: 1, hintRange: { from: 0, to: 1 }, strokes: [[3, 10, 10, 0]] } } = {}) {
  const d = draftWith();
  judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment, strokes: [STROKE], at: T0, nextId: idGen() });
  d.sessions.A = { ...d.sessions.A, current: { ...d.sessions.A.current, ...current } };
  return d;
}

test('correctInDraft: same record, corrections appended, sched replayed, current untouched, line changed (D19)', () => {
  const d = judgedDraft();
  const before = JSON.parse(JSON.stringify(d));
  const current = d.sessions.A.current;
  const { record } = correctInDraft(d, { slot: 'A', recordId: 'r1', at: T0 + 9000 });
  const all = recs(d);
  assert.equal(all.length, 1, 'no new record');
  assert.equal(record.id, 'r1');
  assert.equal(record.judgment, 'wrong');
  assert.equal(record.at, T0);
  assert.equal(record.localDay, '2026-09-24');
  assert.deepEqual(record.help, recs(before)[0].help);
  assert.deepEqual(record.corrections, [{ from: 'correct', at: T0 + 9000 }]);
  assert.deepEqual(d.sched['base:永'], replay(before.sessions.A.items[0].fsrsBefore, [record]));
  assert.notEqual(d.sched['base:永'].due, before.sched['base:永'].due, 'due changed (Good → Again)');
  assert.equal(d.sessions.A.current, current, 'current is the same object');
  assert.deepEqual(d.sessions.A.current, before.sessions.A.current);
  assert.deepEqual(d.sessions.A.lastLine, { recordId: 'r1', kind: 'changed' });
  assert.equal(d.sessions.A.cursor, before.sessions.A.cursor);
  // 改回来：重放确定
  correctInDraft(d, { slot: 'A', recordId: 'r1', at: T0 + 10000 });
  assert.equal(recs(d)[0].judgment, 'correct');
  assert.equal(recs(d)[0].corrections.length, 2);
  assert.deepEqual(d.sched['base:永'], before.sched['base:永'], 'back to the original sched');
});

test('correctInDraft: only the current line record with fsrsBefore can be corrected (K25)', () => {
  const d = judgedDraft();
  assert.throws(() => correctInDraft(d, { slot: 'A', recordId: 'r9', at: T0 }), /not the line record/);
  const noBefore = judgedDraft();
  noBefore.sessions.A = { ...noBefore.sessions.A, items: noBefore.sessions.A.items.map(({ fsrsBefore, ...it }) => it) };
  assert.throws(() => correctInDraft(noBefore, { slot: 'A', recordId: 'r1', at: T0 }), /cannot be corrected/);
  const store = fakeStore(judgedDraft(), { fail: 1 });
  const snap = JSON.stringify(store.getState());
  assert.equal(commitCorrection(store, { slot: 'A', recordId: 'r1' }).ok, false);
  assert.equal(JSON.stringify(store.getState()), snap, 'failed correction publishes nothing');
  const ok = commitCorrection(store, { slot: 'A', recordId: 'r1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.judgment, 'wrong');
  assert.equal(commitCorrection(store, { slot: 'A', recordId: 'r2' }).error.kind, 'stale');
});

// ---------------------------------------------------------------- 结果行

test('resultRowModel: judged record / changed, saw, skipped, none; 修改 split from the copy', () => {
  const d = judgedDraft();
  let m = resultRowModel(d.sessions.A, d);
  assert.equal(m.state, 'judged');
  assert.equal(m.kind, 'record');
  assert.equal(m.text, '「永」记为写对');
  assert.equal(m.action, '修改 ›');
  assert.equal(m.canChange, true);
  correctInDraft(d, { slot: 'A', recordId: 'r1', at: T0 + 1 });
  m = resultRowModel(d.sessions.A, d);
  assert.equal(m.kind, 'changed');
  assert.equal(m.text, '「永」已改为写错');
  const saw = { id: 'r5', cardKey: 'base:和', char: '和', sessionId: 's1', kind: 'answer-seen', at: T0, localDay: '2026-09-24', help: { hints: 0, answerSeen: true, traced: false } };
  const d2 = draftWith({ cursor: 1, records: [saw], items: [{ cardKey: 'base:永', kind: 'answer-seen', recordId: 'r5' }], lastLine: { recordId: 'r5', kind: 'saw' } });
  m = resultRowModel(d2.sessions.A, d2);
  assert.deepEqual([m.state, m.text, m.action, m.canChange], ['saw', t('R-W10.lineSaw', { char: '和' }), null, false]);
  const d3 = draftWith({ cursor: 1, items: [{ cardKey: 'base:永', kind: 'skipped', recordId: 'r2' }] });
  assert.equal(resultRowModel(d3.sessions.A, d3).state, 'skipped');
  assert.equal(resultRowModel(draftWith().sessions.A, draftWith()).state, 'none');
  assert.equal(resultRowModel(null, null).state, 'none');
});

test('lineVisible: only in recall, not after answer, no strokes, no pen-down (D19)', () => {
  assert.equal(lineVisible({ phase: 'recall', answerSeen: false, strokeCount: 0, penDown: false }), true);
  assert.equal(lineVisible({ phase: 'recall', answerSeen: false, strokeCount: 1, penDown: false }), false);
  assert.equal(lineVisible({ phase: 'recall', answerSeen: false, strokeCount: 0, penDown: true }), false);
  assert.equal(lineVisible({ phase: 'recall', answerSeen: true, strokeCount: 0, penDown: false }), false);
  assert.equal(lineVisible({ phase: 'compare', answerSeen: false, strokeCount: 0, penDown: false }), false);
});

test('ResultRowView: skipped state is an empty row; judged row has one 修改 button', () => {
  const skipped = ResultRowView({ model: { state: 'skipped' } });
  assert.equal(skipped.props['data-state'], 'skipped');
  assert.equal(ResultRowView({ model: { state: 'none' } }), null);
  const d = judgedDraft();
  const row = ResultRowView({ model: resultRowModel(d.sessions.A, d), onChange: () => {} });
  const flat = JSON.stringify(row, (k, v) => (typeof v === 'function' ? (v === Button ? 'Button' : 'fn') : k === '__o' || k === '__' || k === '__v' ? undefined : v));
  assert.match(flat, /write-line-change/);
  assert.match(flat, /「永」记为写对/);
});

// ---------------------------------------------------------------- 跳过

test('skipInDraft / undoSkipInDraft: skipped record (not valid), advance, undo restores count, cursor and hints', () => {
  const d = draftWith({ current: { hints: 2 } });
  const recsBefore = recs(d).length;
  const { record } = skipInDraft(d, { slot: 'A', cardKey: 'base:永', hints: 1, at: T0, nextId: idGen(4) });
  assert.equal(record.kind, 'skipped');
  assert.equal('judgment' in record, false);
  assert.equal(record.help.hints, 2);
  assert.deepEqual(d.sched, {}, 'no FSRS for a skip');
  assert.equal(d.sessions.A.cursor, 1);
  assert.equal(d.sessions.A.lastLine, null);
  assert.deepEqual(d.sessions.A.items, [{ cardKey: 'base:永', kind: 'skipped', recordId: 'r4' }]);
  assert.equal(canUndoSkip(d, { slot: 'A', sessionId: 's1', recordId: 'r4' }), true);
  undoSkipInDraft(d, { slot: 'A', sessionId: 's1', recordId: 'r4', at: T0 + 1 });
  assert.equal(recs(d).length, recsBefore, 'record count back');
  assert.equal(d.sessions.A.cursor, 0, 'char back at the cursor');
  assert.equal(d.sessions.A.current.phase, 'recall');
  assert.equal(d.sessions.A.current.hints, 2, 'hint count restored');
  assert.deepEqual(d.sessions.A.items, []);
  assert.equal(validateValue(KEYS.sessions, d.sessions), null);
  assert.throws(() => undoSkipInDraft(d, { slot: 'A', sessionId: 's1', recordId: 'r4', at: T0 }), /not found/);
});

test('commitSkip / commitUndoSkip: failure does not advance; undo only while the skip is the last item', () => {
  const store = fakeStore(draftWith(), { fail: 1 });
  assert.equal(commitSkip(store, { slot: 'A', cardKey: 'base:永' }).ok, false);
  assert.equal(store.getState().sessions.A.cursor, 0, 'failed skip does not advance');
  const ok = commitSkip(store, { slot: 'A', cardKey: 'base:永' });
  assert.equal(ok.ok, true);
  assert.equal(store.getState().sessions.A.cursor, 1);
  const id = ok.record.id;
  // 推进之后再跳过一次：上一条不能再撤销
  const ok2 = commitSkip(store, { slot: 'A', cardKey: 'base:和' });
  assert.equal(commitUndoSkip(store, { slot: 'A', sessionId: 's1', recordId: id }).error.kind, 'stale');
  assert.equal(commitUndoSkip(store, { slot: 'A', sessionId: 's1', recordId: ok2.record.id }).ok, true);
  assert.equal(store.getState().sessions.A.cursor, 1);
  assert.equal(SKIP_UNDO_MS, 3000);
});

// ---------------------------------------------------------------- 视图

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, visit));
    return;
  }
  visit(node);
  walk(node.props && node.props.children, visit);
}

test('JudgeButtons: 写错了 left, 写对了 right, same component / variant / class, no aria-pressed or autofocus (D03 / D20)', () => {
  assert.deepEqual(JUDGE_ORDER, ['wrong', 'correct']);
  const buttons = [];
  walk(JudgeButtons({ onJudge: () => {} }), n => {
    if (n.type === Button) buttons.push(n.props);
  });
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map(b => b['data-testid']), ['write-judge-wrong', 'write-judge-correct']);
  assert.deepEqual(buttons.map(b => b.children), [t('R-W09.btnWrong'), t('R-W09.btnCorrect')]);
  assert.equal(buttons[0].class, buttons[1].class);
  assert.equal(buttons[0].variant, buttons[1].variant);
  for (const b of buttons) {
    assert.equal('aria-pressed' in b, false);
    assert.equal('autofocus' in b || 'autoFocus' in b, false);
    assert.ok(!/correct|wrong|primary|suggest/.test(b.class), 'no verdict / emphasis class');
  }
});

test('JudgeFooter: prompt copy; failure swaps in R-W16 copy and [先不保存 / 再试一次]', () => {
  const ids = node => {
    const out = [];
    walk(node, n => {
      if (n.props && n.props['data-testid']) out.push(n.props['data-testid']);
    });
    return out;
  };
  const normal = JudgeFooter({ failed: false, onJudge: () => {} });
  assert.deepEqual(ids(normal), ['write-judge-foot', 'write-judge-note']);
  const failed = JudgeFooter({ failed: true, onRetry: () => {}, onCancelFail: () => {} });
  assert.deepEqual(ids(failed), ['write-judge-foot', 'write-judge-note', 'write-judge-fail-cancel', 'write-judge-fail-retry']);
  const bar = SkipUndoBar({ char: '春', onUndo: () => {} });
  assert.equal(bar.props['data-state'], 'shown');
  assert.equal(SkipUndoBar({ char: '春', failed: true, onUndo: () => {}, onCancelFail: () => {} }).props['data-state'], 'failed');
});

test('copy: M1-5 slots exist (R-W09 / R-W10 / R-W16 / R-W17 / R-W20 / X-JUDGE)', () => {
  assert.equal(t('X-JUDGE.changeTitle', { char: '永' }), '修改「永」的判断');
  assert.equal(t('X-JUDGE.changeToWrong'), '改为写错');
  assert.equal(t('X-JUDGE.changeToCorrect'), '改为写对');
  assert.equal(t('R-W20.skippedToast', { char: '春' }), '已跳过「春」');
  assert.equal(t('R-W17.noInk'), '这次没写');
  assert.equal(t('R-W16.saveFailed'), '没保存上，你写的字还在。');
});

test('rememberInk / paintMini helpers', () => {
  rememberInk('r77', [STROKE]);
  assert.deepEqual(recalledInk('r77'), [STROKE]);
  rememberInk('r78', [[]]);
  assert.equal(recalledInk('r78'), null, 'empty strokes are not remembered');
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push(k)), set: (o, k, v) => { o[k] = v; return true; } });
  assert.equal(paintMini(ctx, [[{ x: 1, y: 1, w: 10, t: 0 }, { x: 20, y: 20, w: 10, t: 10 }]]), 1);
  assert.equal(paintMini(ctx, []), 0);
});
