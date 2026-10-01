// 会话现场与恢复（M1-6；走查-W10；决定-D07；01 §3.3 / §4；03 P52；02 M1-6）。
//
// 职责（写字页 index.js 调用 usePersist，一处接线）：
//   1. 抬笔写 strokes：本人笔画（当前字、当前阶段那一份）一变（抬笔 / 撤销 / 清空），就经 store.commit('write:strokes')
//      把 sessions[slot].current.strokes 写成 core/ink-math encodeRawStrokes 的紧凑行（schema「笔 = 数组」）。
//      同一次写入顺带对齐 recall ⇄ compare 的阶段：M1-5 进 / 出判断页的写入失败时本页用本地阶段覆盖，这里补写。
//      其余阶段切换（提示、看答案、描一遍、自己写、判断、跳过）由各自模块在同一次 commit 里写 sessions——「每步写入」。
//   2. 失败按 P52 **不阻断**：笔迹留在内存（index.js 本地现场），下一次抬笔 / 撤销 / 清空、visibilitychange(hidden)、
//      pagehide、离开写字页时重写；顶部一次性提示（配额 / 通用两句，沿旧 index.html L1067），每次页面加载最多一次，
//      显示 NOTICE_MS 后收起（叠在题面上方、不挡落笔，pointer-events:none）。到判断 commit 时由判断页三段式兜底（M1-5）。
//   3. 恢复（刷新后回到同一阶段）：写字页本地笔画现场从 session.current.strokes 取（storedStrokes → decodeRawStrokes），
//      所以 recall / compare / trace / retrace 刷新后笔迹都在；compare 有笔画 → 判断页（对照卡 + 参考字形），
//      answer → 看答案卡片（各阶段的界面由 M1-3/M1-4/M1-5 按存下的 phase 渲染）。
//   4. 恢复幂等（01 §3.3，core/sessions.recoverSession）：打开写字页时若 records 里已有本会话该字的 judged 记录
//      （items 还没有）→ 一次 commit 补写 item、推进 cursor，不再进 compare、不再评级、今日 N 不变；
//      phase==='compare' 且笔画为空 → 回到 recall。写失败不阻断（界面本来就按 recall 显示），下次状态变化再试。
//
// 规则：只经 store.commit 写存储；会话用 core/sessions；笔画编码用 core/ink-math。
//
// data-testid：write-persist-notice（顶部一次性提示，role=status，data-kind=quota|generic）。

import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as policy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { currentCardKey, recoverSession, withCurrent } from '../../../core/sessions.js';
import { decodeRawStrokes, encodeRawStrokes } from '../../../core/ink-math.js';
import { allRecords, answerInkKey } from './answer.js';

/** 抬笔写 sessions 的 commit 标签。 */
export const STROKES_LABEL = 'write:strokes';
/** 恢复幂等 commit 的标签。 */
export const RECOVER_LABEL = 'write:recover';
/** 一次性提示的显示时长（两行长句，比轻提示 3.2s 长；policy.motion.persistNoticeMs，P70）。 */
export const NOTICE_MS = policy.motion.persistNoticeMs;

const EMPTY = Object.freeze([]);
const SYNC_PHASES = Object.freeze(['recall', 'compare']);

injectStyles('write-persist', `
.sz-persist{position:absolute;left:24px;right:24px;top:calc(48px + env(safe-area-inset-top, 0px));z-index:30;
  pointer-events:none;box-sizing:border-box;display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:14px;
  background:${T.off};box-shadow:0 6px 18px rgba(48,38,26,.10);animation:sz-fade-in .2s ease-out both}
.sz-persist__dot{width:6px;height:6px;margin-top:calc(8px * ${T.k});flex:none;border-radius:50%;background:${T.a}}
.sz-persist__text{flex:1;font-size:calc(14px * ${T.k});line-height:1.6;color:${T.i2}}
@media (prefers-reduced-motion: reduce){.sz-persist{animation:none}}
`);

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

/** 失败结果 → 提示句（配额 / 通用，01 §4 表「沿旧两句」）。 */
export function noticeFor(error) {
  const quota = !!error && error.kind === 'quota';
  return { kind: quota ? 'quota' : 'generic', text: t(quota ? 'X-PERSIST.quotaFailed' : 'X-PERSIST.saveFailed') };
}

// ---------------------------------------------------------------- 一次性提示（每次页面加载最多一次）

let noticeUsed = false;

/** 测试 / 重载用：复位「已提示过」。 */
export function resetPersistNotice() {
  noticeUsed = false;
}

export function PersistNotice({ notice }) {
  if (!notice) return null;
  return html`<div class="sz-persist" role="status" aria-live="polite" data-testid="write-persist-notice"
    data-kind=${notice.kind}>
    <span class="sz-persist__dot" aria-hidden="true"></span><span class="sz-persist__text">${notice.text}</span>
  </div>`;
}

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/**
 * 写字页的会话现场接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session   sessions[slot]（已发布状态）
 * @param {object|null} o.state     已发布状态（records 用于恢复幂等）
 * @param {string|null} o.cardKey
 * @param {string} o.inkKey          本地笔画那一份的键
 * @param {Array} o.strokes          本地原始笔画（index.js 的 view.strokes）
 * @param {string} o.phase           有效阶段
 * @param {() => boolean} [o.isStale] 为真时不再写回（写字页本体因 store 整体替换而重挂，M6-6）
 * @returns {{notice: vnode|null, dirty: boolean, flush: (reason?:string) => object|null}}
 */
export function usePersist({ slot, session, state, cardKey, inkKey, strokes, phase, noticeMs = NOTICE_MS, isStale = null }) {
  const [notice, setNotice] = useState(null); // {kind, text}
  const [dirty, setDirty] = useState(false);
  const live = useRef(null);
  live.current = { slot, cardKey, inkKey, strokes, phase, isStale };
  const hideTimer = useRef(null);
  const mounted = useRef(true);

  const onResult = result => {
    if (!result || !mounted.current) return;
    if (result.ok) {
      setDirty(false);
      return;
    }
    if (result.error && result.error.kind === 'stale') return; // 已换字：新字的现场由新一轮写入负责
    setDirty(true);
    if (!noticeUsed) {
      noticeUsed = true;
      setNotice(noticeFor(result.error));
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        if (mounted.current) setNotice(null);
      }, noticeMs);
    }
  };

  const flush = () => {
    const store = storeOrNull();
    const cur = live.current;
    if (!store || !cur || !cur.cardKey) return null;
    // M6-6：store 已被整体替换、本体正在按新状态重挂——这份现场属于替换前，不写（卸载时的「离开即写回」也在内）。
    if (typeof cur.isStale === 'function' && cur.isStale()) return null;
    const result = commitStrokes(store, cur);
    onResult(result);
    return result;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // 抬笔 / 撤销 / 清空 / recall⇄compare：本地现场一变就写（失败不阻断，下一次变化再写）。
  useEffect(() => {
    flushRef.current();
  }, [strokes, inkKey, phase, cardKey]);

  // 页面隐藏 / 卸载前再写一次（P52：visibilitychange 重写）。
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushRef.current();
    };
    const onPageHide = () => flushRef.current();
    const win = typeof window !== 'undefined' ? window : null;
    mounted.current = true;
    document.addEventListener('visibilitychange', onVisibility);
    if (win) win.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (win) win.removeEventListener('pagehide', onPageHide);
      mounted.current = false;
      flushRef.current(); // 离开写字页：返回 = 保存现场（01 §6.7）
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, []);

  // 恢复幂等：会话 / 当前字 / 阶段 / 记录数变化时检查一次；同一签名只试一次（失败不重复刷写）。
  const stored = session && session.current ? session.current : null;
  const signature = session
    ? `${session.id}|${session.cursor}|${stored ? stored.phase : ''}|${stored && Array.isArray(stored.strokes) ? stored.strokes.length : 0}|${allRecords(state).length}`
    : '';
  const tried = useRef('');
  useEffect(() => {
    if (!signature || tried.current === signature) return;
    tried.current = signature;
    const store = storeOrNull();
    if (store) commitRecover(store, { slot });
  }, [signature]);

  return { notice: notice ? html`<${PersistNotice} notice=${notice} />` : null, dirty, flush };
}
