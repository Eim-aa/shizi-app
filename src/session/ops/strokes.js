// 会话现场（抬笔写回笔画、recall ⇄ compare 对齐）与恢复幂等（从 src/ui/screens/write/persist.js 原样挪来，B2.1；行为不变）。
// 无 DOM、不依赖 UI。失败提示（三段式）仍在 persist.js。

import { currentCardKey, recoverSession, withCurrent } from '../../core/sessions.js';
import { decodeRawStrokes, encodeRawStrokes } from '../../core/ink-math.js';
import { allRecords, answerInkKey } from './answer.js';

/** 换字后书写格的落笔门限（01 §6.6 / 走查-V01；P227：300 → 250，门限内的笔先持住、到点补画，不再丢弃）。网页写字页与原生书写面同一个值。 */
export const PEN_ARM_MS = 250;
/** 抬笔写 sessions 的 commit 标签。 */
export const STROKES_LABEL = 'write:strokes';
/** 恢复幂等 commit 的标签。 */
export const RECOVER_LABEL = 'write:recover';
const EMPTY = Object.freeze([]);
const SYNC_PHASES = Object.freeze(['recall', 'compare']);

// ---------------------------------------------------------------- 纯函数

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

function setSession(draft, slot, session) {
  draft.sessions = { ...draft.sessions, [slot]: session };
}

// 同一份存下的紧凑行只解码一次，保证引用稳定（InkGrid 按引用比较 strokes）。
const decodedCache = new WeakMap();

function decodeCached(rows) {
  if (!Array.isArray(rows) || !rows.length) return EMPTY;
  let out = decodedCache.get(rows);
  if (!out) {
    out = Object.freeze(decodeRawStrokes(rows));
    decodedCache.set(rows, out);
  }
  return out;
}

/**
 * 写字页本地笔画现场的初值：会话当前字是 cardKey、且存下的阶段那一份（answerInkKey）就是 inkKey 时，
 * 返回解码后的原始笔画（每笔 [{x,y,t,p?}]）；否则空数组。
 */
export function storedStrokes(session, cardKey, inkKey) {
  if (!session || !session.current || !cardKey || currentCardKey(session) !== cardKey) return EMPTY;
  if (answerInkKey(cardKey, session.current.phase) !== inkKey) return EMPTY;
  return decodeCached(session.current.strokes);
}

function sameRows(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

/**
 * 本地现场与存下的会话现场差了什么；无差别或不归本模块写时返回 null。
 * @param {object|null} session  sessions[slot]
 * @param {object} o
 * @param {string} o.cardKey     写字页当前字
 * @param {string} o.inkKey      本地笔画那一份的键（answerInkKey(cardKey, 存下的阶段)）
 * @param {Array} o.strokes      本地原始笔画
 * @param {string} [o.phase]     有效阶段（recall / compare 的本地覆盖）
 * @returns {{strokes?:Array, phase?:string}|null}
 */
export function syncPatch(session, { cardKey, inkKey, strokes, phase }) {
  if (!session || !session.current || !cardKey || currentCardKey(session) !== cardKey) return null;
  const storedPhase = session.current.phase;
  if (answerInkKey(cardKey, storedPhase) !== inkKey) return null; // 本地这一份不是存下阶段的那一份（阶段刚换）
  const patch = {};
  const rows = encodeRawStrokes(strokes || EMPTY);
  if (!sameRows(rows, session.current.strokes)) patch.strokes = rows;
  if (phase && phase !== storedPhase && SYNC_PHASES.includes(phase) && SYNC_PHASES.includes(storedPhase)) {
    // compare 必须有本人笔画（01 §3.3）；没有就不补写 compare。
    if (phase === 'recall' || rows.length) patch.phase = phase;
  }
  return Object.keys(patch).length ? patch : null;
}

/** 草稿里写会话现场（commit mutator 主体）。当前字已不是 cardKey 时抛错（commit 返回 mutator 失败）。 */
export function applyStrokesToDraft(draft, { slot, cardKey, patch, at }) {
  const s = sessionOf(draft, slot);
  if (!s || currentCardKey(s) !== cardKey) throw new Error('persist: not the current card');
  setSession(draft, slot, withCurrent(s, patch, at));
}

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });
const CLEAN = Object.freeze({ ok: true, keys: Object.freeze([]), noop: true });

/**
 * 把本地现场写进 sessions[slot].current（抬笔写 / visibilitychange / 离开）。无差别时不写，返回 {ok:true, noop:true}。
 * @returns store.commit 的结果，或 {ok:false, error:{kind:'stale'}}
 */
export function commitStrokes(store, { slot, cardKey, inkKey, strokes, phase }) {
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return STALE;
  const patch = syncPatch(s, { cardKey, inkKey, strokes, phase });
  if (!patch) return CLEAN;
  return store.commit(STROKES_LABEL, (draft, ctx) => applyStrokesToDraft(draft, { slot, cardKey, patch, at: ctx.now }));
}

/** 草稿里做恢复幂等（core/sessions.recoverSession）；返回是否改了。 */
export function recoverInDraft(draft, { slot }) {
  const s = sessionOf(draft, slot);
  if (!s) return false;
  const { session, recovered } = recoverSession(s, allRecords(draft));
  if (recovered) setSession(draft, slot, session);
  return recovered;
}

/** 需要恢复时 commit（'write:recover'）；不需要时 {ok:true, noop:true}。 */
export function commitRecover(store, { slot }) {
  const state = store.getState();
  const s = sessionOf(state, slot);
  if (!s || !recoverSession(s, allRecords(state)).recovered) return CLEAN;
  return store.commit(RECOVER_LABEL, draft => {
    recoverInDraft(draft, { slot });
  });
}
