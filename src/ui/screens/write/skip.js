// 跳过与 5 秒撤销（M1-5；阶段 0 B2 / D36 起 5 秒、按住暂停、读屏不自动收起；决定-D23 / D07；01 §3.2 / §3.3 / §4；04 R-W14 / R-W16 / R-W20；走查-W16；P06；
// 原型 ShiziWriteScreen L147–L156、L457–L459、L605、L627–L633）。
//
// 跳过（R-W14「跳过」下划线文字，直接生效，不确认）= 一次 store.commit：追加一条 kind='skipped' 记录（不是有效记录：
//   不判断、不评级、不改 sched / due、不写墨迹；help.hints 照实）+ 会话推进（item kind='skipped'、current 重置、
//   结果行清空，决定-D19「跳过后清空」）。跳过当天不再出、新字推迟几天（policy.skipScope='today' / skipNewDeferDays，P06，D65 #5；选字在 core/sessions.selectDaily），不写 stoppedAt。
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
import { useAnnounce } from '../../components/FailBlock.js';
import { playExit } from '../../components/exit.js';
import '../../components/UndoBar.js'; // .sz-undobar 样式（撤销底栏同一视觉，R-G05）
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { assistiveTechActive, onAccessibilityStatus } from '../../../platform/accessibility.js';
import { getStore } from '../../../store/store.js';
import { encodeRawStrokes } from '../../../core/ink-math.js';
import './answer.js';

/** 跳过后可撤销的时长（走查-W16；04 §4 撤销寿命四种之一；D36 / P115：5 秒，原 3 秒）。 */
export const SKIP_UNDO_MS = defaultPolicy.skipUndo.ms;

injectStyles('write-skip', `
.sz-skipbar{flex-wrap:wrap}
.sz-skipbar__btns{display:flex;gap:4px;flex:none}
`);

// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/write-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { skipInDraft, undoSkipInDraft, commitSkip, canUndoSkip, commitUndoSkip } from '../../../session/write-ops.js';
export { skipInDraft, undoSkipInDraft, commitSkip, canUndoSkip, commitUndoSkip };
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
  useLayoutEffect(() => () => playExit(ref.current, 'fade'), []); // 退场：撤销条收起 / 离开时原位 150ms 淡出（T-fade，P1-07）
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
 * @returns {{shown, button, failed, note, run, cancelFail, bar, undoOpen, undo, dismiss}}
 *   shown：回忆阶段、没看过答案时显示「跳过」；failed：跳过写失败（调用方把底栏换成三段式：主按钮「再试一次」= run、求助行「先不保存」= cancelFail、格下说明换 note）；
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
  useAnnounce(failed ? t('R-W16.saveFailed') : ''); // 说明在格下说明位：经常驻播报区读一次（S1，审计 P1-27）
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

// ---------------------------------------------------------------- 撤销窗口跟人走（R5-I2，交互规范 S4，审计 P1-11）
//
// 跳过后 5 秒的撤销条还在时离开写字页（点「‹」或左缘右滑——同一个函数），剩余的撤销机会交给来源页：写字页在返回之前 handoffLeaveUndo，
// 根组件的 LeaveUndoHost 在来源页上接着显示同一条撤销条（剩余时长照旧，按住暂停、读屏不自动收起）。点「撤销」= 同一个 commitUndoSkip，
// 成功后回到那个字（根组件推入写字页）；失败三段式留在撤销条上。来源页再导航到别处（顶层页面换了）或撤销条到点，机会结束。

let leaveUndo = null; // {slot, sessionId, recordId, char, strokes, until, failed, anchor}
const leaveListeners = new Set();

function emitLeaveUndo() {
  for (const fn of [...leaveListeners]) fn(leaveUndo);
}

/** 写字页离开前调用：把还没用掉的撤销机会交出去（null = 没有）。 */
export function handoffLeaveUndo(undo) {
  leaveUndo = undo && !undo.failed ? { ...undo, anchor: null } : null;
  emitLeaveUndo();
}

/** 结束交出去的撤销机会。 */
export function clearLeaveUndo() {
  leaveUndo = null;
  emitLeaveUndo();
}

/** 交出去的撤销机会此刻的样子（B3.5a 原生首页画同一条撤销条用）：{slot, char, failed, remainingMs} | null。 */
export function leaveUndoView() {
  if (!leaveUndo) return null;
  const { slot, char, failed } = leaveUndo;
  return { slot, char, failed: !!failed, remainingMs: Math.max(0, Math.round(leaveUndo.until - clockNow())) };
}

/** 订阅交出去的撤销机会的变化（返回退订）。 */
export function onLeaveUndo(fn) {
  leaveListeners.add(fn);
  return () => leaveListeners.delete(fn);
}

/**
 * 来源页撤销条的「撤销」（网页 LeaveUndoHost 与原生首页同一个函数）：commitUndoSkip；成功 → 结束机会、onUndone(slot)（回到那个字）；
 * stale → 结束机会；失败 → 撤销条换成三段式（failed）。返回提交结果。
 */
export function undoLeave(onUndone) {
  const cur = leaveUndo;
  if (!cur) return { ok: false, error: { kind: 'stale' } };
  const store = storeOrNull();
  const result = store
    ? commitUndoSkip(store, { slot: cur.slot, sessionId: cur.sessionId, recordId: cur.recordId, strokes: cur.strokes })
    : { ok: false, error: { kind: 'unavailable' } };
  if (result.ok) {
    clearLeaveUndo();
    if (onUndone) onUndone(cur.slot);
    return result;
  }
  if (result.error && result.error.kind === 'stale') {
    clearLeaveUndo();
    return result;
  }
  leaveUndo = { ...cur, failed: true };
  emitLeaveUndo();
  markStateChange();
  return result;
}

/**
 * 根组件挂的宿主：来源页上的撤销条。交接后第一次看到的（不是写字页的）顶层页面就是它的归属；顶层换了就结束。
 * @param {{snap: object, onUndone: (slot:string) => void}} props
 */
export function LeaveUndoHost({ snap, onUndone }) {
  const [u, setU] = useState(leaveUndo);
  useEffect(() => {
    leaveListeners.add(setU);
    setU(leaveUndo);
    return () => leaveListeners.delete(setU);
  }, []);
  const topId = snap && snap.top ? snap.top.id : null;
  const topName = snap && snap.top ? snap.top.n : null;
  const settled = !!snap && !snap.pending && topName !== 'write';
  useEffect(() => {
    if (!leaveUndo || !settled) return;
    if (leaveUndo.anchor === null) {
      leaveUndo = { ...leaveUndo, anchor: topId };
      emitLeaveUndo();
    } else if (leaveUndo.anchor !== topId) {
      clearLeaveUndo();
    }
  }, [topId, settled, u]);
  if (!u || !settled || (u.anchor !== null && u.anchor !== topId)) return null;
  const undo = () => { undoLeave(onUndone); };
  // 来源页的底边（撤销条不盖主按钮，S4）：页上有主按钮时停在最下面那个主按钮上方 8；否则 tab 根在 tab 栏上方 8、子页在底栏上方 8。
  let ubb = null;
  if (typeof document !== 'undefined' && topId) {
    const layer = document.querySelector(`.sz-layer[data-entry="${topId}"]`);
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    let top = Infinity;
    if (layer) {
      for (const b of layer.querySelectorAll('.sz-btn--primary')) {
        const r = b.getBoundingClientRect();
        if (r.height > 0 && r.top < vh && r.bottom > vh / 2) top = Math.min(top, r.top);
      }
    }
    const bar = layer ? layer.querySelector('.sz-tabs') || layer.querySelector('.sz-page__foot') : null;
    if (Number.isFinite(top)) ubb = Math.round(vh - top + 8);
    else if (bar) ubb = bar.offsetHeight + 8;
  }
  return html`<div class="sz-leaveundo" data-testid="leave-skip-undo" style=${ubb === null ? '' : `--ubb:${ubb}px`}>
    <${SkipUndoDock} char=${u.char} failed=${!!u.failed} onUndo=${undo} until=${u.until}
      onExpire=${() => { if (leaveUndo && !leaveUndo.failed) clearLeaveUndo(); }}
      onCancelFail=${() => { clearLeaveUndo(); markStateChange(); }} />
  </div>`;
}
