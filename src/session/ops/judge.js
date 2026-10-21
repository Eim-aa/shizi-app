// 判断提交（记录 + FSRS + 会话推进 + 笔迹 + D27 回收，一个事务）与进 / 出判断页的现场写入；本页面会话里记住的笔画
// （从 src/ui/screens/write/compare.js 原样挪来，B2.1；行为不变）。无 DOM、不依赖 UI。

import * as defaultPolicy from '../../config/policy.js';
import { setInk } from '../../store/store.js';
import { pruneInkOfCards } from '../../store/budget.js';
import { makeRecord, isJudged, JUDGMENTS } from '../../core/records.js';
import { HINTS_SHAPE_MAX } from '../../core/schema.js';
import { advance, currentCardKey, withCurrent } from '../../core/sessions.js';
import { applyJudgment } from '../../core/fsrs.js';
import { encodeRawStrokes, encodeStoredInk } from '../../core/ink-math.js';
import { allRecords, appendRecordToDraft } from './answer.js';

// ---------------------------------------------------------------- 纯函数（草稿变换）

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

function setSession(draft, slot, session) {
  draft.sessions = { ...draft.sessions, [slot]: session };
}

/** 至少一笔、至少一个点的原始笔画（01 §6.6「commit 前再断言有本人笔画」）。 */
export function hasInk(strokes) {
  return Array.isArray(strokes) && strokes.some(s => Array.isArray(s) && s.length > 0);
}

/** 本会话某字已有的 judged 记录（恢复幂等，01 §3.3）。 */
export function findJudged(state, sessionIdValue, cardKey) {
  let found = null;
  for (const r of allRecords(state)) {
    if (isJudged(r) && r.sessionId === sessionIdValue && r.cardKey === cardKey) found = r;
  }
  return found;
}

function clampHints(n) {
  const v = Math.trunc(Number(n) || 0);
  return Math.max(0, Math.min(HINTS_SHAPE_MAX, v));
}

/** perRecordInk 开关：显式传入优先，否则读 policy.features（P31）。 */
function inkEnabled(opts) {
  if (typeof opts.perRecordInk === 'boolean') return opts.perRecordInk;
  const policy = opts.policy || defaultPolicy;
  return !!(policy.features && policy.features.perRecordInk === true);
}

/**
 * 判断的 mutator 主体（store.commit 里调用）。
 * @param {object} draft  commit 草稿
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {string} o.cardKey
 * @param {'correct'|'wrong'} o.judgment
 * @param {Array} o.strokes  本人原始笔画（每笔 [{x,y,t,p?}]）
 * @param {number} [o.hints]  本地提示次数（与已存次数取大）
 * @param {number} o.at
 * @param {(prefix:string) => string} o.nextId
 * @param {boolean} [o.perRecordInk]  缺省读 policy.features.perRecordInk
 * @param {object} [o.policy]
 * @returns {{record, reused:boolean, inkWritten:boolean, inkRecycled:Array<{id, month, recordId}>}}
 */
export function judgeInDraft(draft, o) {
  const { slot, cardKey, judgment, strokes, at, nextId } = o;
  const policy = o.policy || defaultPolicy;
  if (!JUDGMENTS.includes(judgment)) throw new RangeError('judge: judgment must be correct or wrong');
  if (!hasInk(strokes)) throw new RangeError('judge: no strokes of the learner');
  const s = sessionOf(draft, slot);
  if (!s || currentCardKey(s) !== cardKey) throw new Error('judge: not the current card');
  const existing = findJudged(draft, s.id, cardKey);
  if (existing) {
    // 中断恢复：记录已写过 → 只补推进，不再新增 / 不再评级（D07 不重复计数）。
    setSession(draft, slot, advance(s, { cardKey, recordId: existing.id, kind: 'judged', at }));
    return { record: existing, reused: true, inkWritten: false, inkRecycled: [] };
  }
  const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
  const record = makeRecord({
    id: nextId('r'),
    cardKey,
    sessionId: s.id,
    kind: 'judged',
    judgment,
    at,
    help: { hints: clampHints(Math.max(stored, Number(o.hints) || 0)), answerSeen: false, traced: false },
  });
  appendRecordToDraft(draft, record);
  let inkWritten = false;
  if (inkEnabled(o)) {
    // B2.3：原生存原始点（Ink v4，宽度由读的人按笔锋模型重算），网页 localStorage 存 v3（o.inkFormat = ctx.inkFormat，policy P05）
    setInk(draft, record, encodeStoredInk(strokes, { policy, format: o.inkFormat }));
    inkWritten = true;
  }
  // D27：新判断成了「最近一次」，上一次的最近一次（不是第一次时）墨迹回收；第一次与这一次留下。
  const inkRecycled = pruneInkOfCards(draft, [cardKey]);
  const entry = draft.sched ? draft.sched[cardKey] : undefined;
  // D66 ①：records 给 fsrs 找「判断前看过答案」（新字不再给 Easy）；当天看答案已记过 Again 的字不再评级（见 core/fsrs.js）
  const { entry: nextEntry, fsrsBefore } = applyJudgment(entry, record, { policy, records: allRecords(draft) });
  draft.sched = { ...(draft.sched || {}), [cardKey]: nextEntry };
  setSession(draft, slot, advance(s, { cardKey, recordId: record.id, kind: 'judged', fsrsBefore, at }));
  return { record, reused: false, inkWritten, inkRecycled };
}

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });
const EMPTY = Object.freeze({ ok: false, error: Object.freeze({ kind: 'empty-strokes' }) });

/**
 * 判断 commit。空笔画直接拒绝（{ok:false, error:{kind:'empty-strokes'}}，不调用 commit）；
 * 当前字已不是 cardKey 时 {ok:false, error:{kind:'stale'}}；否则返回 store.commit 的结果，成功时另带 record。
 */
export function commitJudgment(store, { slot, cardKey, judgment, strokes, hints = 0, perRecordInk, policy } = {}) {
  if (!hasInk(strokes)) return EMPTY;
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return STALE;
  let out = null;
  const result = store.commit('write:judge', (draft, ctx) => {
    out = judgeInDraft(draft, { slot, cardKey, judgment, strokes, hints, at: ctx.now, nextId: ctx.nextId, perRecordInk, policy, inkFormat: ctx.inkFormat });
  });
  return result && result.ok && out ? { ...result, record: out.record, reused: out.reused } : result;
}

/**
 * 进 / 出判断页的会话现场写入（phase；进判断页时连同原始笔画）。按 P52 不阻断：返回 commit 结果，调用方可忽略失败。
 */
export function commitComparePhase(store, { slot, cardKey, phase, strokes }) {
  if (phase !== 'compare' && phase !== 'recall') throw new RangeError('commitComparePhase: compare or recall only');
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return STALE;
  return store.commit(`write:${phase === 'compare' ? 'compare' : 'continue'}`, (draft, ctx) => {
    const cur = sessionOf(draft, slot);
    if (!cur || currentCardKey(cur) !== cardKey) throw new Error('compare phase: not the current card');
    const patch = { phase };
    if (phase === 'compare' && Array.isArray(strokes)) patch.strokes = encodeRawStrokes(strokes);
    setSession(draft, slot, withCurrent(cur, patch, ctx.now));
  });
}

const recentInk = new Map(); // recordId → 原始笔画（本页面会话内；修改判断弹层「你的书写」用，刷新即失）
const RECENT_INK_CAP = 8;

/**
 * 记住刚判断那一字的原始笔画（perRecordInk=false 时弹层 / 格子 / 图片只能从这里取，01 §3.5 / 10.12）。
 * perRecordInk=true（D27）时存下的墨迹是唯一来源：recalledInk 一律返回 null——被回收的那次如实「没有笔迹」，
 * 不拿本页面记下的笔画补（刷新前后一个样）。
 */
export function rememberInk(recordId, strokes) {
  if (!recordId || !hasInk(strokes)) return;
  recentInk.delete(recordId);
  recentInk.set(recordId, strokes);
  while (recentInk.size > RECENT_INK_CAP) recentInk.delete(recentInk.keys().next().value);
}

export function recalledInk(recordId, policy = defaultPolicy) {
  if (policy && policy.features && policy.features.perRecordInk === true) return null;
  return recentInk.get(recordId) || null;
}

/** 测试清理接口（M6-6）：清掉本页面会话里记住的笔画（单测之间不共享缓存）；返回清掉的条数。 */
export function forgetRecentInk() {
  const n = recentInk.size;
  recentInk.clear();
  return n;
}
