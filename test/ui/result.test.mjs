// M2-3 结束这组与结果页的纯逻辑单测（决定-D19 / D20 / D22；01 §3.2 / §3.3；04 R-R01–R-R07、R-W15；03 P14 / P62；边改 S04 / S05）。
// 结果页模型（三态、按记录算的数字、说明句、离开按钮与来源说明、图片说明）、结束写入、修改判断、结果页上的跳过撤销、
// 撤销机会交接；「结束这组」的草稿变换与确认框数字；跳过撤销写回笔画。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { judgeInDraft, rememberInk, recalledInk, forgetRecentInk } from '../../src/ui/screens/write/compare.js';
import { skipInDraft, undoSkipInDraft } from '../../src/ui/screens/write/skip.js';
import { appendRecordToDraft } from '../../src/ui/screens/write/answer.js';
import {
  resultModel, findResultSession, finishInDraft, commitFinish, commitLeave, correctResultInDraft, commitResultCorrection,
  undoSkipFromResultInDraft, commitResultSkipUndo, canUndoSkipFromResult, handoffSkipUndo, takeSkipUndo, leaveOf, fromOf,
  seenSkippedNote, seenCurrentItem, inkPresent, GRID_COLS,
} from '../../src/ui/screens/result/index.js';
import { endInDraft, commitEndGroup, endConfirmCounts, canEndGroup, judgedCountOf, EndDialogContent } from '../../src/ui/screens/write/end.js';
import { advance, createSession, endSlot } from '../../src/core/sessions.js';
import { makeRecord } from '../../src/core/records.js';
import { encodeRawStrokes } from '../../src/core/ink-math.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';

loadFSRSGlobal();

const T0 = new Date(2026, 8, 24, 12, 0).getTime();
const STROKE = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];

function idGen(start = 1) {
  let n = start - 1;
  return prefix => `${prefix}${(n += 1)}`;
}

function recs(d) {
  return Object.values(d.records).flat();
}

/**
 * 造一组：steps 依次为 'correct' | 'wrong' | 'seen' | 'skip'，走真实 mutator（judgeInDraft / skipInDraft / advance）。
 */
function group({ kind = 'daily', chars = ['永', '和', '春', '大'], steps = [], source, id = 's1' } = {}) {
  const s = createSession({ id, kind, source, queue: chars.map(c => 'base:' + c), at: T0 });
  const slot = s.slot;
  const d = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} }, meta: null };
  d.sessions[slot] = s;
  const nextId = idGen(10);
  steps.forEach((step, i) => {
    const cur = d.sessions[slot];
    const key = cur.queue[cur.cursor];
    const at = T0 + (i + 1) * 1000;
    if (step === 'correct' || step === 'wrong') {
      judgeInDraft(d, { slot, cardKey: key, judgment: step, strokes: [STROKE], at, nextId, perRecordInk: false });
    } else if (step === 'skip') {
      skipInDraft(d, { slot, cardKey: key, at, nextId });
    } else {
      const r = makeRecord({ id: nextId('r'), cardKey: key, sessionId: cur.id, kind: 'answer-seen', at, help: { hints: 0, answerSeen: true, traced: false } });
      appendRecordToDraft(d, r);
      d.sessions[slot] = advance(cur, { cardKey: key, recordId: r.id, kind: 'answer-seen', at });
    }
  });
  return { d, slot, id };
}

function ended(d, slot, early = false) {
  d.sessions = endSlot(d.sessions, slot, { at: T0 + 60_000, early });
  return d;
}

function fakeStore(state, { fail = 0 } = {}) {
  let cur = state;
  let failures = fail;
  let now = T0 + 120_000;
  let serial = 500;
  const calls = [];
  return {
    calls,
    getState: () => cur,
    getInk: () => null,
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

// ---------------------------------------------------------------- 模型

test('resultModel daily: count by judged records, cells in order with captions, seen+skipped note + grid hint, 再写一组', () => {
  const { d, slot, id } = group({ steps: ['correct', 'seen', 'wrong', 'skip'] });
  ended(d, slot);
  const m = resultModel(d, { slot, sessionId: id });
  assert.equal(m.found, true);
  assert.equal(m.where, 'ended');
  assert.equal(m.variant, 'daily');
  assert.equal(m.header, t('X-RESULT.headerDaily'));
  assert.equal(m.title, null, 'P1-E7 (交接 §5.1): the daily result page has no 「这次记录了 N 个字」 title — the work is the title');
  assert.equal(m.count, 2, 'the judged count is still computed (picked / first use it)');
  assert.deepEqual(m.cells.map(c => [c.char, c.kind, c.caption]), [
    ['永', 'judged', '写对'], ['和', 'answer-seen', '看过答案'], ['春', 'judged', '写错'], ['大', 'skipped', '跳过'],
  ]);
  assert.deepEqual(m.cells.map(c => c.canChange), [true, false, true, false], 'only judged cells with fsrsBefore can change (K25)');
  assert.deepEqual(m.sub, [], 'no 「没算在内」 / 「点一个格子」 sentences on the daily page (交接 §5.1: 不写「没算在内」)');
  assert.equal(seenSkippedNote(['和'], ['大']), '「和」看过答案，「大」跳过了，没算在内。', 'the P62 sentence helper itself is unchanged (picked page still uses it)');
  assert.equal(m.cols, GRID_COLS.daily);
  assert.equal(m.again, true);
  assert.equal(m.leave.label, t('X-RESULT.leaveHome'));
  assert.equal(m.dateLine, null, 'daily has no date line');
  // 作品成员（§4.2）：没有任何墨 → 作品为空（衬底一行变体），分享隐藏；每个字落在下面的行里
  assert.equal(m.work.empty, true);
  assert.equal(m.share, false, 'no ink at all → the share icon is hidden (§4.1)');
  assert.deepEqual(m.work.entries.map(e => [e.char, e.state]), [['永', 'noInk'], ['和', 'seen'], ['春', 'noInk'], ['大', 'skipped']]);
});

test('resultModel: P62 only-seen / only-skipped sentences; none → default note; zero judged → 这次没有记下字', () => {
  let { d, slot, id } = group({ chars: ['永', '和'], steps: ['seen', 'seen'] });
  let m = resultModel(ended(d, slot), { slot, sessionId: id });
  assert.equal(m.title, null);
  assert.equal(m.count, 0, 'nothing judged');
  assert.equal(m.share, false);
  assert.equal(seenSkippedNote(['永', '和'], []), '「永」「和」看过答案，没算在内。');
  assert.equal(seenSkippedNote([], ['和']), '「和」跳过了，没算在内。');
  assert.equal(seenSkippedNote([], []), '');
});

test('resultModel first: header 第一次练习, 5 columns, date-only line (R-R03), 再写一组 (P1-E5), title is not a count (D28)', () => {
  const { d, slot, id } = group({ kind: 'first', chars: ['尴', '嚏'], steps: ['correct', 'wrong'] });
  const m = resultModel(ended(d, slot), { slot, sessionId: id });
  assert.equal(m.variant, 'first');
  assert.equal(m.header, t('X-RESULT.headerFirst'));
  assert.equal(m.cols, 5);
  assert.equal(m.dateLine, null, 'P1-E7: the date lives in the work 落款 now, not in a separate line');
  assert.equal(m.again, true, 'P1-E5 / D28: the first result page has 再写一组 (and 回到首页)');
  assert.equal(m.title, '这两个字，很多人提笔就忘。', 'V2-05: the title counts what the page shows (two chars here), it is not a fixed 「三」');
  assert.deepEqual(m.sub, [], 'no 「这次记录了 N 个字」/ grid-hint sentence under the first-practice title');
  const none = group({ kind: 'first', chars: ['尴', '嚏'], steps: ['skip', 'skip'] });
  assert.equal(resultModel(ended(none.d, none.slot), { slot: none.slot, sessionId: none.id }).title, '这两个字，很多人提笔就忘。', 'with no ink the plain row lists both chars: the title follows that count');
  // 三个字里只有两个留有墨迹 → 作品（字帖）只有两格 → 标题写「两」，不写「三」（V2-05：标题与字数对不上是第一次使用最后一屏里的事实错误）
  const inkOn = names => record => names.includes(record.char);
  const titleOf = names => {
    const three = group({ kind: 'first', chars: ['尴', '嚏', '拾'], steps: ['correct', 'wrong', 'correct'] });
    return resultModel(ended(three.d, three.slot), { slot: three.slot, sessionId: three.id, hasInk: inkOn(names) }).title;
  };
  assert.equal(titleOf(['尴', '拾']), '这两个字，很多人提笔就忘。', '2 inked of 3 (the wrong one is not in the work)');
  assert.equal(titleOf(['尴']), '这一个字，很多人提笔就忘。', '1 char on the page');
  assert.equal(titleOf(['尴', '嚏', '拾']), '这两个字，很多人提笔就忘。', '3 judged, 1 wrong → the work holds 2: the title says 两, the page shows two cells');
  assert.equal(titleOf([]), '这三个字，很多人提笔就忘。', 'no ink: the plain row lists all 3 chars');
  const daily = group({ kind: 'daily', chars: ['尴', '嚏'], steps: ['correct', 'wrong'] });
  assert.equal(resultModel(ended(daily.d, daily.slot), { slot: daily.slot, sessionId: daily.id }).title, null, 'daily has no title any more (P1-E7)');
});

test('resultModel picked: 写完了 / 先写到这里 (P14), bodyAll / bodyOne, early rest, S05 source line, leave by source (R-R06)', () => {
  let { d, slot, id } = group({ kind: 'picked', chars: ['额', '鲜', '境'], steps: ['correct', 'wrong', 'skip'], source: { view: 'wrongList' } });
  let m = resultModel(ended(d, slot), { slot, sessionId: id });
  assert.equal(m.variant, 'picked');
  assert.equal(m.header, t('R-R05.kicker'));
  assert.deepEqual([m.kicker, m.title], ['这次选的字', '写完了']);
  assert.deepEqual(m.sub, ['「额」「鲜」都记下了。', '「境」跳过了，没算在内。', t('R-R02.gridHint')]);
  assert.equal(m.dateLine, '9 月 24 日 · 从写错过');
  assert.equal(m.leave.label, '回到写错过');
  assert.equal(m.again, false);
  assert.equal(m.work, null, 'picked has no work / share (交接 §5 is the daily and first pages)');
  ({ d, slot, id } = group({ kind: 'picked', chars: ['额', '鲜', '境', '静'], steps: ['correct'], source: { view: 'detail', char: '额' } }));
  m = resultModel(ended(d, slot, true), { slot, sessionId: id });
  assert.equal(m.early, true);
  assert.equal(m.title, '先写到这里');
  assert.deepEqual(m.sub, ['「额」记下了。', '还有 3 个字没写，没有记下。', t('R-R02.gridHint')]);
  assert.equal(m.leave.label, '回到「额」');
  assert.equal(m.dateLine, '9 月 24 日 · 自己选的');
});

test('leaveOf / fromOf: every source view (R-R06 / S05); unknown and detail without char fall back to 回到首页', () => {
  assert.deepEqual(['wrongList', 'forgetList', 'allWritten', 'mine', 'library', 'home'].map(view => leaveOf({ view }).label),
    ['回到写错过', '回到快忘了', '回到有记录的字', '回到我的', '回到字库', '回到首页']);
  assert.equal(leaveOf({ view: 'againList' }).view, 'wrongList', 'old key againList → wrongList');
  assert.equal(leaveOf({ view: 'detail', char: '静' }).label, '回到「静」');
  assert.equal(leaveOf({ view: 'detail' }).label, '回到首页');
  assert.equal(leaveOf({ view: 'nowhere' }).label, '回到首页');
  assert.equal(leaveOf(null).label, '回到首页');
  assert.deepEqual(['wrongList', 'forgetList', 'home', 'detail'].map(view => fromOf({ view })), ['从写错过', '从快忘了', '自己选的', '自己选的']);
});

test('resultModel: session still in the slot (finish write failed) is shown; missing session falls back to records', () => {
  const { d, slot, id } = group({ chars: ['永'], steps: ['correct'] });
  let m = resultModel(d, { slot, sessionId: id });
  assert.equal(m.where, 'slot');
  assert.equal(m.count, 1);
  const noSession = { ...d, sessions: { A: null, B: null, lastEnded: {} } };
  m = resultModel(noSession, { slot, sessionId: id });
  assert.equal(m.found, false);
  assert.deepEqual(m.cells.map(c => [c.char, c.kind, c.canChange]), [['永', 'judged', false]], 'records only, no correction without the session');
  assert.equal(m.count, 1);
});

test('resultModel P77: ended from the answer phase with judged chars → current char added as 看过答案 (not changeable); count unchanged', () => {
  const { d, id } = group({ kind: 'picked', chars: ['额', '鲜', '境'], steps: ['correct'] });
  // 鲜：看答案确认（写了 answer-seen 记录、current.answerSeen=true），没推进就结束这组
  const cur = d.sessions.B;
  appendRecordToDraft(d, makeRecord({ id: 'r90', cardKey: 'base:鲜', sessionId: id, kind: 'answer-seen', at: T0 + 5000, help: { hints: 0, answerSeen: true, traced: false } }));
  d.sessions.B = { ...cur, current: { ...cur.current, phase: 'trace', answerSeen: true } };
  assert.equal(endInDraft(d, { slot: 'B', sessionId: id, at: T0 + 6000 }).judgedCount, 1);
  const m = resultModel(d, { slot: 'B', sessionId: id });
  assert.deepEqual(m.cells.map(c => [c.char, c.kind, c.recordId, c.canChange]), [['额', 'judged', 'r10', true], ['鲜', 'answer-seen', 'r90', false]]);
  assert.equal(m.cells[1].caption, t('R-R02.cellSaw'));
  assert.equal(m.count, 1, 'title count by judged records only');
  assert.deepEqual(m.seen, ['鲜'], 'seen list (note) includes it');
  assert.equal(m.unwritten, 2, 'unwritten count unchanged (queue − cursor)');
  assert.ok(m.sub.includes(seenSkippedNote(['鲜'], [])), 'P62 only-seen sentence');
  // 没有 answer-seen 记录（只打开了确认框）→ 不补
  const g2 = group({ kind: 'picked', chars: ['额', '鲜'], steps: ['correct'] });
  g2.d.sessions.B = { ...g2.d.sessions.B, current: { ...g2.d.sessions.B.current, answerSeen: true } };
  assert.deepEqual(seenCurrentItem(g2.d.sessions.B, recs(g2.d)), [], 'no record → nothing added');
  // answerSeen 为假 → 不补；当前字已在 items 里 → 不重复
  const g3 = group({ kind: 'picked', chars: ['额', '鲜'], steps: ['correct'] });
  appendRecordToDraft(g3.d, makeRecord({ id: 'r91', cardKey: 'base:鲜', sessionId: g3.id, kind: 'answer-seen', at: T0 + 5000, help: { hints: 0, answerSeen: true, traced: false } }));
  assert.deepEqual(seenCurrentItem(g3.d.sessions.B, recs(g3.d)), [], 'answerSeen false → nothing added');
  const g4 = group({ kind: 'picked', chars: ['额', '鲜'], steps: ['correct', 'seen'] });
  assert.equal(resultModel(g4.d, { slot: 'B', sessionId: g4.id }).cells.length, 2, 'already advanced → no duplicate');
  // 别的会话的 answer-seen 记录不算
  const g5 = group({ kind: 'picked', chars: ['额', '鲜'], steps: ['correct'] });
  appendRecordToDraft(g5.d, makeRecord({ id: 'r92', cardKey: 'base:鲜', sessionId: 's999', kind: 'answer-seen', at: T0 + 5000, help: { hints: 0, answerSeen: true, traced: false } }));
  g5.d.sessions.B = { ...g5.d.sessions.B, current: { ...g5.d.sessions.B.current, answerSeen: true } };
  assert.deepEqual(seenCurrentItem(g5.d.sessions.B, recs(g5.d)), [], 'other session record ignored');
});

test('resultModel I6: the work counts page-memory strokes like the grid does (stored ink OR recalledInk) → share / members', t0 => {
  forgetRecentInk(); // M6-6：不继承别的用例记下的笔画
  t0.after(() => forgetRecentInk()); // 也不留给后面的用例（记录 id 在各用例里会重复）
  const { d, slot, id } = group({ chars: ['永', '和'], steps: ['correct', 'correct'], id: 's77' });
  ended(d, slot);
  const ids = recs(d).map(r => r.id);
  const OFF = { features: { perRecordInk: false } }; // 页面内笔画只在关闭时（10.12 兜底）才算
  assert.equal(resultModel(d, { slot, sessionId: id, policy: OFF }).share, false, 'no stored ink, nothing in page memory → no share');
  rememberInk(ids[1], [STROKE]); // 本页面会话里刚判断时记下的笔画（格子会画它）
  assert.equal(resultModel(d, { slot, sessionId: id }).share, false, 'D27 (default on): only stored ink counts — page memory does not stand in');
  let m = resultModel(d, { slot, sessionId: id, policy: OFF });
  assert.equal(m.share, true, 'page-memory strokes count → share');
  assert.deepEqual(m.work.cells.map(c => c.char), ['和']);
  assert.deepEqual(m.work.rows.map(c => [c.char, c.state]), [['永', 'noInk']]);
  // 页面传入的判据（与格子同一个 inkOf）：刷新后页面内笔画没了 → 没有墨
  m = resultModel(d, { slot, sessionId: id, hasInk: () => inkPresent({ points: null, strokes: null }) });
  assert.equal(m.share, false, 'after reload (no page strokes, perRecordInk off) → nothing to share');
  assert.equal(inkPresent({ points: [[{ x: 1, y: 1 }]], strokes: null }), true);
  assert.equal(inkPresent({ points: null, strokes: [[{ x: 1, y: 1, t: 0 }]] }), true);
  assert.equal(inkPresent(null), false);
});

// ---------------------------------------------------------------- 结束 / 离开

test('finishInDraft / commitFinish: complete session moves to lastEnded (not early); idempotent; incomplete is stale', () => {
  const { d, slot, id } = group({ chars: ['永', '和'], steps: ['correct', 'skip'] });
  const store = fakeStore(d);
  const r1 = commitFinish(store, { slot, sessionId: id });
  assert.equal(r1.ok, true);
  const st = store.getState().sessions;
  assert.equal(st.A, null);
  assert.equal(st.lastEnded.A.id, id);
  assert.equal(st.lastEnded.A.endedEarly, undefined);
  assert.equal(typeof st.lastEnded.A.endedAt, 'number');
  assert.equal(validateValue(KEYS.sessions, st), null);
  const r2 = commitFinish(store, { slot, sessionId: id });
  assert.equal(r2.noop, true, 'already ended → no write');
  assert.deepEqual(store.calls, ['result:finish']);
  const half = group({ chars: ['永', '和'], steps: ['correct'] });
  assert.equal(commitFinish(fakeStore(half.d), { slot: 'A', sessionId: half.id }).error.kind, 'stale');
  assert.throws(() => finishInDraft(half.d, { slot: 'A', sessionId: half.id, at: T0 }), /not complete/);
});

test('commitLeave clears only this lastEnded[slot]', () => {
  const { d, slot, id } = group({ chars: ['永'], steps: ['correct'] });
  ended(d, slot);
  const store = fakeStore(d);
  assert.equal(commitLeave(store, { slot, sessionId: 's999' }).noop, true);
  assert.equal(commitLeave(store, { slot, sessionId: id }).ok, true);
  assert.equal(store.getState().sessions.lastEnded.A, undefined);
  assert.equal(findResultSession(store.getState(), { slot, sessionId: id }), null);
});

// ---------------------------------------------------------------- 修改判断

test('correctResultInDraft: same record, judgment flipped, corrections appended, sched replayed, no new record (D19)', () => {
  const { d, slot, id } = group({ steps: ['correct', 'wrong', 'skip', 'correct'] });
  ended(d, slot);
  const before = recs(d).length;
  const dueBefore = d.sched['base:永'].due;
  const store = fakeStore(d);
  const r = commitResultCorrection(store, { slot, sessionId: id, recordId: 'r10' });
  assert.equal(r.ok, true);
  const after = store.getState();
  const rec = recs(after).find(x => x.id === 'r10');
  assert.equal(recs(after).length, before, 'no record added');
  assert.equal(rec.judgment, 'wrong');
  assert.equal(rec.corrections.length, 1);
  assert.equal(rec.corrections[0].from, 'correct');
  assert.equal(rec.at, recs(d).find(x => x.id === 'r10').at, 'at unchanged');
  assert.notEqual(after.sched['base:永'].due, dueBefore, 'due replayed (wrong → Again, earlier)');
  assert.deepEqual(after.sessions.lastEnded.A, d.sessions.lastEnded.A, 'session untouched');
  const m = resultModel(after, { slot, sessionId: id });
  assert.equal(m.cells[0].caption, '写错');
  assert.equal(m.count, 3, 'count unchanged by a correction');
});

test('commitResultCorrection: skipped / answer-seen are not correctable; failure leaves records as they were', () => {
  const { d, slot, id } = group({ steps: ['seen', 'skip', 'correct', 'wrong'] });
  ended(d, slot);
  const store = fakeStore(d, { fail: 1 });
  assert.equal(commitResultCorrection(store, { slot, sessionId: id, recordId: 'r10' }).error.kind, 'stale', 'answer-seen');
  assert.equal(commitResultCorrection(store, { slot, sessionId: id, recordId: 'r11' }).error.kind, 'stale', 'skipped');
  const failed = commitResultCorrection(store, { slot, sessionId: id, recordId: 'r12' });
  assert.equal(failed.ok, false);
  assert.equal(recs(store.getState()).find(x => x.id === 'r12').judgment, 'correct', 'unchanged after failure');
  assert.equal(commitResultCorrection(store, { slot, sessionId: id, recordId: 'r12' }).ok, true, 'retry succeeds');
  assert.throws(() => correctResultInDraft(store.getState(), { slot, sessionId: 's404', recordId: 'r12', at: T0 }), /not found/);
});

// ---------------------------------------------------------------- 跳过撤销（结果页）

test('undoSkipFromResultInDraft: ended session goes back to the slot, skipped record removed, cursor back, strokes written back', () => {
  const { d, slot, id } = group({ chars: ['永', '和'], steps: ['correct', 'skip'] });
  ended(d, slot);
  const rows = encodeRawStrokes([STROKE]);
  assert.equal(canUndoSkipFromResult(d, { slot, sessionId: id, recordId: 'r11' }), true);
  const store = fakeStore(d);
  const r = commitResultSkipUndo(store, { slot, sessionId: id, recordId: 'r11', strokes: rows });
  assert.equal(r.ok, true);
  const st = store.getState();
  assert.equal(st.sessions.lastEnded.A, undefined, 'no longer ended');
  assert.equal(st.sessions.A.id, id);
  assert.equal(st.sessions.A.cursor, 1);
  assert.equal('endedAt' in st.sessions.A, false);
  assert.equal('endedEarly' in st.sessions.A, false);
  assert.deepEqual(st.sessions.A.current.strokes, rows, 'strokes written back to current.strokes');
  assert.equal(recs(st).some(x => x.kind === 'skipped'), false);
  assert.equal(validateValue(KEYS.sessions, st.sessions), null);
});

test('result skip undo is stale when the slot holds a newer group or the skip is not the last item', () => {
  const { d, slot, id } = group({ chars: ['永', '和'], steps: ['skip', 'correct'] });
  ended(d, slot);
  assert.equal(canUndoSkipFromResult(d, { slot, sessionId: id, recordId: 'r10' }), false, 'skip is not the last item');
  const g = group({ chars: ['永'], steps: ['skip'] });
  ended(g.d, 'A');
  g.d.sessions.A = createSession({ id: 's2', kind: 'daily', queue: ['base:春'], at: T0 });
  assert.equal(canUndoSkipFromResult(g.d, { slot: 'A', sessionId: g.id, recordId: 'r10' }), false, 'slot occupied');
  assert.equal(commitResultSkipUndo(fakeStore(g.d), { slot: 'A', sessionId: g.id, recordId: 'r10' }).error.kind, 'stale');
  assert.throws(() => undoSkipFromResultInDraft(g.d, { slot: 'A', sessionId: g.id, recordId: 'r10', at: T0 }), /occupied/);
});

test('undoSkipInDraft (write page) writes strokes back when given (M2-3), keeps hints', () => {
  const { d, slot, id } = group({ chars: ['永', '和'], steps: ['skip'] });
  const rows = encodeRawStrokes([STROKE, STROKE]);
  undoSkipInDraft(d, { slot, sessionId: id, recordId: 'r10', at: T0, strokes: rows });
  assert.equal(d.sessions.A.cursor, 0);
  assert.deepEqual(d.sessions.A.current.strokes, rows);
});

test('handoffSkipUndo / takeSkipUndo: taken once, only by the same group, dropped when expired', () => {
  handoffSkipUndo({ slot: 'A', sessionId: 's1', recordId: 'r3', char: '永', strokes: null, until: 5000 });
  assert.equal(takeSkipUndo('B', 's1', 1000), null, 'other slot');
  assert.equal(takeSkipUndo('A', 's1', 1000), null, 'already taken (cleared by the first take)');
  handoffSkipUndo({ slot: 'A', sessionId: 's1', recordId: 'r3', char: '永', until: 5000 });
  assert.equal(takeSkipUndo('A', 's1', 1000).recordId, 'r3');
  handoffSkipUndo({ slot: 'A', sessionId: 's1', recordId: 'r3', char: '永', until: 5000 });
  assert.equal(takeSkipUndo('A', 's1', 6000), null, 'expired');
  handoffSkipUndo(null);
  assert.equal(takeSkipUndo('A', 's1', 0), null);
});

// ---------------------------------------------------------------- 结束这组

test('endInDraft: picked group → lastEnded.B with endedEarly; judged count by records; daily cannot be ended', () => {
  const { d, id } = group({ kind: 'picked', chars: ['额', '鲜', '境'], steps: ['correct', 'skip'] });
  assert.deepEqual(endConfirmCounts(d, 'B'), { n: 1, m: 1 }, '1 unwritten (境), 1 judged (额)');
  assert.equal(canEndGroup(d.sessions.B), true);
  const out = endInDraft(d, { slot: 'B', sessionId: id, at: T0 + 5000 });
  assert.equal(out.judgedCount, 1);
  assert.equal(d.sessions.B, null);
  assert.equal(d.sessions.lastEnded.B.endedEarly, true);
  assert.equal(d.sessions.lastEnded.B.endedAt, T0 + 5000);
  assert.equal(validateValue(KEYS.sessions, d.sessions), null);
  const daily = group({ steps: ['correct'] });
  assert.equal(canEndGroup(daily.d.sessions.A), false);
  assert.throws(() => endInDraft(daily.d, { slot: 'A', sessionId: daily.id, at: T0 }), /only a picked group/);
});

test('commitEndGroup: zero judged returns judgedCount 0; failure keeps the group; stale when the group changed', () => {
  const { d, id } = group({ kind: 'picked', chars: ['额', '鲜'], steps: ['skip'] });
  assert.equal(judgedCountOf(d, id), 0);
  const store = fakeStore(d, { fail: 1 });
  const failed = commitEndGroup(store, { slot: 'B', sessionId: id });
  assert.equal(failed.ok, false);
  assert.equal(store.getState().sessions.B.id, id, 'group untouched after failure');
  const ok = commitEndGroup(store, { slot: 'B', sessionId: id });
  assert.equal(ok.ok, true);
  assert.equal(ok.judgedCount, 0);
  assert.equal(commitEndGroup(store, { slot: 'B', sessionId: id }).error.kind, 'stale');
});

test('EndDialogContent: S04 primary 接着写, 结束这组 secondary, no preselection; failed state R-W16 three-part', () => {
  const find = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach(n => find(n, pred, out));
      return out;
    }
    if (pred(node)) out.push(node);
    find(node.props && node.props.children, pred, out);
    return out;
  };
  const ask = EndDialogContent({ n: 2, m: 1, onEnd: () => {}, onCancel: () => {} });
  const btns = find(ask, n => n.props && n.props['data-testid'] && /^write-end-/.test(n.props['data-testid']) && n.props.variant);
  assert.deepEqual(btns.map(b => [b.props['data-testid'], b.props.variant]), [['write-end-confirm', 'secondary'], ['write-end-continue', 'primary']]);
  assert.ok(btns.every(b => !b.props.autofocus && !('aria-pressed' in b.props)));
  const body = find(ask, n => n.props && n.props['data-testid'] === 'write-end-body')[0];
  assert.equal(body.props.children, '还有 2 个字没写，结束后就不写了。判断过的 1 个字已经记下。');
  const failed = EndDialogContent({ n: 2, m: 1, failed: true, onEnd: () => {}, onCancel: () => {} });
  const fb = find(failed, n => n.props && n.props.variant && n.props['data-testid']);
  assert.deepEqual(fb.map(b => b.props['data-testid']), ['write-end-fail-cancel', 'write-end-retry']);
  assert.equal(find(failed, n => n.props && n.props['data-testid'] === 'write-end-body')[0].props.children, t('R-W16.saveFailed'));
});

test('M6-6 forgetRecentInk: test cleanup for the page-memory ink cache (rememberInk)', () => {
  forgetRecentInk();
  rememberInk('r901', [STROKE]);
  rememberInk('r902', [STROKE]);
  const OFF = { features: { perRecordInk: false } };
  assert.deepEqual(recalledInk('r901', OFF), [STROKE]);
  assert.equal(forgetRecentInk(), 2, 'returns how many were dropped');
  assert.equal(recalledInk('r901', OFF), null, 'cleared');
  assert.equal(recalledInk('r902', OFF), null, 'cleared');
  assert.equal(forgetRecentInk(), 0, 'idempotent');
});
