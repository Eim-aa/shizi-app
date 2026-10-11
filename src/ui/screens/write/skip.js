// 跳过与 5 秒撤销（M1-5；阶段 0 B2 / D36 起 5 秒、按住暂停、读屏不自动收起；决定-D23 / D07；01 §3.2 / §3.3 / §4；04 R-W14 / R-W16 / R-W20；走查-W16；P06；
// 原型 ShiziWriteScreen L147–L156、L457–L459、L605、L627–L633）。
//
// 跳过（R-W14「跳过」下划线文字，直接生效，不确认）= 一次 store.commit：追加一条 kind='skipped' 记录（不是有效记录：
//   不判断、不评级、不改 sched / due、不写墨迹；help.hints 照实）+ 会话推进（item kind='skipped'、current 重置、
//   结果行清空，决定-D19「跳过后清空」）。跳过只在本会话排除（policy.skipScope='session'，P06），不写 stoppedAt。
//   写失败不推进：格下说明换「没保存上，你写的字还在。」、主按钮行换 [先不保存 / 再试一次]（R-W16 三段式，01 §4 表）。
// 撤销（走查-W16 / R-W20）：跳过成功后底部轻提示「已跳过「X」 · 撤销」5 秒（D36）；撤销 = 第二次 commit：删掉这条 skipped
//   记录（id 允许空洞，01 §3.1）、字放回 cursor、current 回到 recall，并把这条记录里的提示次数放回 current.hints
//   （帮助事实不因撤销丢失，决定-D07）；跳过时格子里的本人笔画（紧凑行）随撤销显式写回 current.strokes（M2-3：
//   不靠写字页残留的本地状态——最后一字跳过后写字页已换成结果页，撤销回来的是一个新写字页）。撤销写失败：轻提示换「没保存上，你写的字还在。」+ [先不保存 / 再试一次]，
//   不自动消失，直到重试成功或点「先不保存」。5 秒后 / 会话已经变了（不是最后一条 skipped）则不能撤销。
// 撤销机会的寿命（M1 验收 G3；D36 / P115）：5 秒（policy.skipUndo.ms），手指按在撤销条上时暂停计时、松开接着走，
//   VoiceOver / 切换控制运行时不自动收起（原生经桥传状态，platform/accessibility.js）；或者下一字一开始操作就结束——第一次落笔（书写格接受了 pointerdown）、
//   点提示、点看答案时写字页调用 dismiss() 立即收起底栏（失败态同样收起：用户已经往下写了，不再把字拉回来）。
//   底栏由写字页挂在页面根上：最后一字跳过后写字页显示空页（M2-3 换成结果页），底栏照样显示、可撤销回到那个字。
//
// 规则：只经 store.commit 写存储；记录用 core/records.makeRecord / removeRecord，会话用 core/sessions.advance / undoSkip。
//
// data-testid：write-skip（「跳过」）、write-skip-fail-cancel / write-skip-fail-retry（跳过写失败两键）、
//   write-skip-undo（底部轻提示，data-state=shown|failed）、write-skip-undo-text、write-skip-undo-btn（撤销）、
//   write-skip-undo-cancel / write-skip-undo-retry（撤销写失败两键）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { Button, markStateChange } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import '../../components/UndoBar.js'; // .sz-undobar 样式（撤销底栏同一视觉，R-G05）
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { assistiveTechActive, onAccessibilityStatus } from '../../../platform/accessibility.js';
import { getStore } from '../../../store/store.js';
import { makeRecord, removeRecord } from '../../../core/records.js';
import { advance, currentCardKey, undoSkip, withCurrent } from '../../../core/sessions.js';
import { encodeRawStrokes } from '../../../core/ink-math.js';
import { allRecords, appendRecordToDraft } from './answer.js';

/** 跳过后可撤销的时长（走查-W16；04 §4 撤销寿命四种之一；D36 / P115：5 秒，原 3 秒）。 */
export const SKIP_UNDO_MS = defaultPolicy.skipUndo.ms;

injectStyles('write-skip', `
.sz-skip__fail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-skipbar{flex-wrap:wrap}
.sz-skipbar__btns{display:flex;gap:4px;flex:none}
`);

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
  if (policy.skipScope !== 'session') throw new RangeError('unsupported policy.skipScope: ' + String(policy.skipScope));
  const s = sessionOf(draft, slot);
  if (!s || currentCardKey(s) !== cardKey) throw new Error('skip: not the current card');
  const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
  const record = makeRecord({
    id: nextId('r'),
    cardKey,
    sessionId: s.id,
    kind: 'skipped',
    at,
    help: { hints: Math.max(0, Math.min(2, Math.max(stored, Math.trunc(Number(hints) || 0)))), answerSeen: false, traced: false },
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

// ---------------------------------------------------------------- 撤销条的寿命（D36 / P115）

/**
 * 撤销条的自动收起计时（纯逻辑，时钟可注入）：
 *   - start()：从现在起算 ms（给了 until 就按这个绝对时刻到期，写字页交给结果页时用）；
 *   - hold() / release()：手指按在撤销条上时暂停，松开后用剩下的时间继续（pauseWhileHeld=false 时忽略）；
 *   - 到点时若读屏 / 切换控制在运行（assistive()）则不收起，改为「钉住」；assistiveChanged(false) 之后重新给一整段 ms；
 *   - stop()：取消（用户已经往下操作 / 组件卸载），之后 hold / release 不再重启。
 * 到期只调一次 onExpire。
 */
export function createUndoLifetime({
  ms = SKIP_UNDO_MS,
  until,
  now = clockNow,
  set = (fn, delay) => setTimeout(fn, delay),
  clear = id => clearTimeout(id),
  assistive = () => false,
  pauseWhileHeld = defaultPolicy.skipUndo.pauseWhileHeld,
  keepOpenWithAssistiveTech = defaultPolicy.skipUndo.keepOpenWithAssistiveTech,
  onExpire,
} = {}) {
  let deadline = Number.isFinite(until) ? until : null;
  let timer = null;
  let heldAt = null;
  let pinned = false;
  let stopped = false;
  let done = false;

  function cancel() {
    if (timer !== null) clear(timer);
    timer = null;
  }
  function fire() {
    timer = null;
    if (stopped || done) return;
    if (keepOpenWithAssistiveTech && assistive()) {
      pinned = true;
      return;
    }
    done = true;
    if (typeof onExpire === 'function') onExpire();
  }
  function schedule() {
    cancel();
    if (stopped || done || heldAt !== null) return;
    timer = set(fire, Math.max(0, deadline - now()));
  }

  return {
    start() {
      stopped = false;
      done = false;
      pinned = false;
      heldAt = null;
      if (deadline === null) deadline = now() + ms;
      schedule();
    },
    hold() {
      if (!pauseWhileHeld || stopped || done || heldAt !== null) return;
      heldAt = now();
      cancel();
    },
    release() {
      if (heldAt === null) return;
      deadline += now() - heldAt;
      heldAt = null;
      schedule();
    },
    /** 读屏状态变了：关掉且之前被钉住 → 重新给一整段。 */
    assistiveChanged(active) {
      if (active || !pinned || stopped || done) return;
      pinned = false;
      deadline = now() + ms;
      schedule();
    },
    stop() {
      stopped = true;
      cancel();
    },
  };
}

// ---------------------------------------------------------------- 写字页接线

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** 底部轻提示（撤销底栏同一视觉）。纯视图。 */
export function SkipUndoBar({ char, failed = false, onUndo, onCancelFail, onHold, onRelease }) {
  if (failed) {
    return html`<div class="sz-undobar sz-skipbar" data-testid="write-skip-undo" data-state="failed">
      <span class="sz-undobar__text" role="status" aria-live="polite"><span data-testid="write-skip-undo-text">${t('R-W16.saveFailed')}</span></span>
      <span class="sz-skipbar__btns">
        <${Button} variant="text" data-testid="write-skip-undo-cancel" onClick=${onCancelFail}>${t('R-W16.cancel')}</${Button}>
        <${Button} variant="text" data-testid="write-skip-undo-retry" onClick=${onUndo}>${t('R-W16.retry')}</${Button}>
      </span>
    </div>`;
  }
  // 手指按在撤销条上：暂停自动收起（D36 / P115）；抬起、取消、移出都算松开。
  return html`<div class="sz-undobar sz-skipbar" data-testid="write-skip-undo" data-state="shown"
    onPointerDown=${onHold} onPointerUp=${onRelease} onPointerCancel=${onRelease} onPointerLeave=${onRelease}>
    <span class="sz-undobar__text" role="status" aria-live="polite"><span data-testid="write-skip-undo-text">${t('R-W20.skippedToast', { char })}</span></span>
    <${Button} variant="text" data-testid="write-skip-undo-btn" onClick=${onUndo}>${t('R-W20.undo')}</${Button}>
  </div>`;
}

/**
 * 轻提示的停靠位置：贴在页面底栏上方 8px（不盖住「写好了」等主按钮；底栏高度随布局 / 大字变化，现量）。
 * 给了 onExpire 就由这里计时（D36 / P115）：until（performance.now 的绝对时刻，缺省从挂载起算 policy.skipUndo.ms），
 * 按住撤销条暂停，读屏 / 切换控制运行时不自动收起；失败态（failed）不计时。
 */
export function SkipUndoDock({ until, onExpire, ...props }) {
  const ref = useRef(null);
  const [bottom, setBottom] = useState(null);
  const lifeRef = useRef(null);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const timed = typeof onExpire === 'function' && !props.failed;
  useLayoutEffect(() => {
    const el = ref.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    const foot = page ? page.querySelector('.sz-page__foot') : null;
    const next = foot ? foot.offsetHeight + 8 : null;
    if (next !== bottom) setBottom(next);
  });
  useEffect(() => {
    if (!timed) return undefined;
    const life = createUndoLifetime({
      until,
      assistive: assistiveTechActive,
      onExpire: () => {
        if (typeof expireRef.current === 'function') expireRef.current();
      },
    });
    lifeRef.current = life;
    life.start();
    const off = onAccessibilityStatus(() => life.assistiveChanged(assistiveTechActive()));
    return () => {
      off();
      life.stop();
      lifeRef.current = null;
    };
  }, [timed, until]);
  const hold = () => { if (lifeRef.current) lifeRef.current.hold(); };
  const release = () => { if (lifeRef.current) lifeRef.current.release(); };
  return html`<div class="sz-skipdock" ref=${ref} style=${bottom === null ? '' : `--ubb:${bottom}px`}>${SkipUndoBar({ ...props, onHold: hold, onRelease: release })}</div>`;
}

/**
 * 写字页的跳过接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session
 * @param {string|null} o.cardKey
 * @param {string} o.phase       有效阶段
 * @param {number} o.hints       本地提示次数（useHint().used）
 * @param {Array} [o.strokes]    书写格本人原始笔画（跳过时记下，撤销时写回 current.strokes，M2-3）
 * @returns {{shown, button, failed, note, run, cancelFail, failButtons, bar, undoOpen, undo, dismiss}}
 *   shown：回忆阶段、没看过答案时显示「跳过」；failed：跳过写失败（调用方把主按钮行换成 failButtons、格下说明换 note）；
 *   bar：5 秒撤销轻提示（D36）（放在页面根上，absolute 贴底；空页 / 结果页也要渲染）；undoOpen：撤销底栏是否在；
 *   dismiss()：撤销机会结束（下一字落笔 / 点提示 / 点看答案），立即收起底栏。
 *   undo：撤销机会 {sessionId, recordId, char, strokes, until, failed} | null（until = performance.now() 时刻；
 *   最后一字跳过后写字页把它交给结果页，M2-3）。
 */
export function useSkip({ slot, session, cardKey, phase, hints = 0, strokes = null }) {
  const key = session && cardKey ? `${session.id}|${session.cursor}|${cardKey}` : null;
  const [fail, setFail] = useState(null); // 跳过写失败 {key}
  const [undo, setUndo] = useState(null); // {sessionId, recordId, char, failed}

  const skip = () => {
    const store = storeOrNull();
    const rows = Array.isArray(strokes) && strokes.length ? encodeRawStrokes(strokes) : null;
    const result = store ? commitSkip(store, { slot, cardKey, hints }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok) {
      setFail(null);
      if (result.record) {
        setUndo({
          sessionId: result.record.sessionId, recordId: result.record.id, char: result.record.char, failed: false,
          strokes: rows, until: clockNow() + SKIP_UNDO_MS,
        });
      }
      return;
    }
    if (result.error && result.error.kind === 'stale') {
      setFail(null);
      return;
    }
    setFail({ key });
    markStateChange();
  };

  const doUndo = () => {
    const u = undo;
    if (!u) return;
    const store = storeOrNull();
    const result = store
      ? commitUndoSkip(store, { slot, sessionId: u.sessionId, recordId: u.recordId, strokes: u.strokes })
      : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      setUndo(null);
      return;
    }
    setUndo({ ...u, failed: true }); // 失败态不自动消失（Dock 不计时），直到重试成功或「先不保存」
    markStateChange();
  };

  const dismiss = () => {
    setUndo(u => (u ? null : u));
  };

  const failed = !!(fail && fail.key === key);
  const answerSeen = !!(session && session.current && session.current.answerSeen);
  const shown = !!cardKey && phase === 'recall' && !answerSeen;
  return {
    shown,
    failed,
    button: shown && !failed
      ? html`<${Button} variant="text" data-testid="write-skip" onClick=${skip}>${t('R-W14.btnSkip')}</${Button}>`
      : null,
    note: failed ? t('R-W16.saveFailed') : '',
    run: skip, // 跳过 / 失败后重试的动作本身（失败时是底栏主按钮「再试一次」的动作）
    cancelFail: () => { setFail(null); markStateChange(); },
    failButtons: failed
      ? html`<div class="sz-skip__fail">
          <${Button} variant="secondary" data-testid="write-skip-fail-cancel" onClick=${() => { setFail(null); markStateChange(); }}>${t('R-W16.cancel')}</${Button}>
          <${Button} variant="primary" data-testid="write-skip-fail-retry" onClick=${skip}>${t('R-W16.retry')}</${Button}>
        </div>`
      : null,
    bar: undo
      ? html`<${SkipUndoDock} char=${undo.char} failed=${undo.failed} onUndo=${doUndo} until=${undo.until}
          onExpire=${() => setUndo(u => (u && !u.failed ? null : u))}
          onCancelFail=${() => { setUndo(null); markStateChange(); }} />`
      : null,
    undoOpen: !!undo,
    undo,
    dismiss,
  };
}
