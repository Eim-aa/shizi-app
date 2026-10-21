// 跳过与跳过撤销的提交函数（从 src/ui/screens/write/skip.js 原样挪来，B2.1；行为不变）。撤销条的寿命与界面仍在 skip.js。

import { HINTS_SHAPE_MAX } from '../../core/schema.js';
import * as defaultPolicy from '../../config/policy.js';
import { makeRecord, removeRecord } from '../../core/records.js';
import { advance, currentCardKey, undoSkip, withCurrent } from '../../core/sessions.js';
import { allRecords, appendRecordToDraft } from './answer.js';

// ---------------------------------------------------------------- 纯函数（草稿变换）

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

function setSession(draft, slot, session) {
  draft.sessions = { ...draft.sessions, [slot]: session };
}

function monthOf(record) {
  return typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
}

/**
 * 跳过的 mutator 主体。
 * @returns {{record}}
 */
export function skipInDraft(draft, { slot, cardKey, hints = 0, at, nextId, policy = defaultPolicy }) {
  if (policy.skipScope !== 'session' && policy.skipScope !== 'today') throw new RangeError('unsupported policy.skipScope: ' + String(policy.skipScope));
  const s = sessionOf(draft, slot);
  if (!s || currentCardKey(s) !== cardKey) throw new Error('skip: not the current card');
  const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
  const record = makeRecord({
    id: nextId('r'),
    cardKey,
    sessionId: s.id,
    kind: 'skipped',
    at,
    help: { hints: Math.max(0, Math.min(HINTS_SHAPE_MAX, Math.max(stored, Math.trunc(Number(hints) || 0)))), answerSeen: false, traced: false },
  });
  appendRecordToDraft(draft, record);
  setSession(draft, slot, advance(s, { cardKey, recordId: record.id, kind: 'skipped', at }));
  return { record };
}

/** 草稿里删掉一条记录（折叠月从 kept 删）。 */
function removeRecordFromDraft(draft, record) {
  const month = monthOf(record);
  const value = month ? draft.records[month] : null;
  if (Array.isArray(value)) draft.records[month] = removeRecord(value, record.id);
  else if (value && Array.isArray(value.kept)) draft.records[month] = { ...value, kept: removeRecord(value.kept, record.id) };
  else throw new Error('undo skip: record month not found');
}

/**
 * 跳过撤销的 mutator 主体：最后一个 item 必须是这条 skipped；删记录、字放回 cursor、current 回 recall，
 * 提示次数放回 current.hints；strokes（跳过时格子里的本人笔画，encodeRawStrokes 紧凑行）写回 current.strokes（M2-3）。
 * @returns {{record}}  被删掉的记录
 */
export function undoSkipInDraft(draft, { slot, sessionId, recordId, at, strokes }) {
  const s = sessionOf(draft, slot);
  if (!s || (sessionId && s.id !== sessionId)) throw new Error('undo skip: session changed');
  const record = allRecords(draft).find(r => r && r.id === recordId) || null;
  if (!record || record.kind !== 'skipped' || record.sessionId !== s.id) throw new Error('undo skip: skipped record not found');
  const back = undoSkip(s, recordId, at); // 最后一个 item 不是这条 skipped 时抛错
  removeRecordFromDraft(draft, record);
  const hints = record.help && Number.isInteger(record.help.hints) ? record.help.hints : 0;
  const patch = {};
  if (hints) patch.hints = hints;
  if (Array.isArray(strokes) && strokes.length) patch.strokes = strokes;
  setSession(draft, slot, Object.keys(patch).length ? withCurrent(back, patch, at) : back);
  return { record };
}

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 跳过 commit；当前字已不是 cardKey 时 stale。成功时另带 record。 */
export function commitSkip(store, { slot, cardKey, hints = 0, policy } = {}) {
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return STALE;
  let out = null;
  const result = store.commit('write:skip', (draft, ctx) => {
    out = skipInDraft(draft, { slot, cardKey, hints, at: ctx.now, nextId: ctx.nextId, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}

/** 可以撤销吗：会话没变、最后一个 item 就是这条 skipped。 */
export function canUndoSkip(state, { slot, sessionId, recordId }) {
  const s = sessionOf(state, slot);
  if (!s || s.id !== sessionId) return false;
  const last = s.items[s.items.length - 1];
  return !!last && last.kind === 'skipped' && last.recordId === recordId;
}

/** 跳过撤销 commit；已不能撤销时 stale。strokes：跳过时的本人笔画（紧凑行），写回 current.strokes。 */
export function commitUndoSkip(store, { slot, sessionId, recordId, strokes } = {}) {
  if (!canUndoSkip(store.getState(), { slot, sessionId, recordId })) return STALE;
  return store.commit('write:skip-undo', (draft, ctx) => {
    undoSkipInDraft(draft, { slot, sessionId, recordId, at: ctx.now, strokes });
  });
}
