// 跳过与 3 秒撤销（M1-5；决定-D23 / D07；01 §3.2 / §3.3 / §4；04 R-W14 / R-W16 / R-W20；走查-W16；P06；
// 原型 ShiziWriteScreen L147–L156、L457–L459、L605、L627–L633）。
//
// 跳过（R-W14「跳过」下划线文字，直接生效，不确认）= 一次 store.commit：追加一条 kind='skipped' 记录（不是有效记录：
//   不判断、不评级、不改 sched / due、不写墨迹；help.hints 照实）+ 会话推进（item kind='skipped'、current 重置、
//   结果行清空，决定-D19「跳过后清空」）。跳过只在本会话排除（policy.skipScope='session'，P06），不写 stoppedAt。
//   写失败不推进：格下说明换「没保存上，你写的字还在。」、主按钮行换 [先不保存 / 再试一次]（R-W16 三段式，01 §4 表）。
// 撤销（走查-W16 / R-W20）：跳过成功后底部轻提示「已跳过「X」 · 撤销」3 秒；撤销 = 第二次 commit：删掉这条 skipped
//   记录（id 允许空洞，01 §3.1）、字放回 cursor、current 回到 recall，并把这条记录里的提示次数放回 current.hints
//   （帮助事实不因撤销丢失，决定-D07）。撤销写失败：轻提示换「没保存上，你写的字还在。」+ [先不保存 / 再试一次]，
//   不自动消失，直到重试成功或点「先不保存」。3 秒后 / 会话已经变了（不是最后一条 skipped）则不能撤销。
// 撤销机会的寿命（M1 验收 G3）：3 秒，或者下一字一开始操作就结束——第一次落笔（书写格接受了 pointerdown）、
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
import { getStore } from '../../../store/store.js';
import { makeRecord, removeRecord } from '../../../core/records.js';
import { advance, currentCardKey, undoSkip, withCurrent } from '../../../core/sessions.js';
import { allRecords, appendRecordToDraft } from './answer.js';

/** 跳过后可撤销的时长（走查-W16：3 秒；04 §4 撤销寿命四种之一）。 */
export const SKIP_UNDO_MS = 3000;

injectStyles('write-skip', `
.sz-skip__btn{text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:.5px;color:${T.i2}}
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
 * 提示次数放回 current.hints。
 * @returns {{record}}  被删掉的记录
 */
export function undoSkipInDraft(draft, { slot, sessionId, recordId, at }) {
  const s = sessionOf(draft, slot);
  if (!s || (sessionId && s.id !== sessionId)) throw new Error('undo skip: session changed');
  const record = allRecords(draft).find(r => r && r.id === recordId) || null;
  if (!record || record.kind !== 'skipped' || record.sessionId !== s.id) throw new Error('undo skip: skipped record not found');
  const back = undoSkip(s, recordId, at); // 最后一个 item 不是这条 skipped 时抛错
  removeRecordFromDraft(draft, record);
  const hints = record.help && Number.isInteger(record.help.hints) ? record.help.hints : 0;
  setSession(draft, slot, hints ? withCurrent(back, { hints }, at) : back);
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

/** 跳过撤销 commit；已不能撤销时 stale。 */
export function commitUndoSkip(store, { slot, sessionId, recordId } = {}) {
  if (!canUndoSkip(store.getState(), { slot, sessionId, recordId })) return STALE;
  return store.commit('write:skip-undo', (draft, ctx) => {
    undoSkipInDraft(draft, { slot, sessionId, recordId, at: ctx.now });
  });
}

// ---------------------------------------------------------------- 写字页接线

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 底部轻提示（撤销底栏同一视觉）。纯视图。 */
export function SkipUndoBar({ char, failed = false, onUndo, onCancelFail }) {
  if (failed) {
    return html`<div class="sz-undobar sz-skipbar" data-testid="write-skip-undo" data-state="failed">
      <span class="sz-undobar__text" role="status" aria-live="polite"><span data-testid="write-skip-undo-text">${t('R-W16.saveFailed')}</span></span>
      <span class="sz-skipbar__btns">
        <${Button} variant="text" data-testid="write-skip-undo-cancel" onClick=${onCancelFail}>${t('R-W16.cancel')}</${Button}>
        <${Button} variant="text" data-testid="write-skip-undo-retry" onClick=${onUndo}>${t('R-W16.retry')}</${Button}>
      </span>
    </div>`;
  }
  return html`<div class="sz-undobar sz-skipbar" data-testid="write-skip-undo" data-state="shown">
    <span class="sz-undobar__text" role="status" aria-live="polite"><span data-testid="write-skip-undo-text">${t('R-W20.skippedToast', { char })}</span></span>
    <${Button} variant="text" data-testid="write-skip-undo-btn" onClick=${onUndo}>${t('R-W20.undo')}</${Button}>
  </div>`;
}

/**
 * 轻提示的停靠位置：贴在页面底栏上方 8px（不盖住「写好了」等主按钮；底栏高度随布局 / 大字变化，现量）。
 */
export function SkipUndoDock(props) {
  const ref = useRef(null);
  const [bottom, setBottom] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    const foot = page ? page.querySelector('.sz-page__foot') : null;
    const next = foot ? foot.offsetHeight + 8 : null;
    if (next !== bottom) setBottom(next);
  });
  return html`<div class="sz-skipdock" ref=${ref} style=${bottom === null ? '' : `--ubb:${bottom}px`}>${SkipUndoBar(props)}</div>`;
}

/**
 * 写字页的跳过接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session
 * @param {string|null} o.cardKey
 * @param {string} o.phase       有效阶段
 * @param {number} o.hints       本地提示次数（useHint().used）
 * @returns {{shown, button, failed, note, failButtons, bar, undoOpen, dismiss}}
 *   shown：回忆阶段、没看过答案时显示「跳过」；failed：跳过写失败（调用方把主按钮行换成 failButtons、格下说明换 note）；
 *   bar：3 秒撤销轻提示（放在页面根上，absolute 贴底；空页 / 结果页也要渲染）；undoOpen：撤销底栏是否在；
 *   dismiss()：撤销机会结束（下一字落笔 / 点提示 / 点看答案），立即收起底栏。
 */
export function useSkip({ slot, session, cardKey, phase, hints = 0 }) {
  const key = session && cardKey ? `${session.id}|${session.cursor}|${cardKey}` : null;
  const [fail, setFail] = useState(null); // 跳过写失败 {key}
  const [undo, setUndo] = useState(null); // {sessionId, recordId, char, failed}
  const timerRef = useRef(0);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const arm = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = 0;
      setUndo(u => (u && !u.failed ? null : u));
    }, SKIP_UNDO_MS);
  };

  const skip = () => {
    const store = storeOrNull();
    const result = store ? commitSkip(store, { slot, cardKey, hints }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok) {
      setFail(null);
      if (result.record) {
        setUndo({ sessionId: result.record.sessionId, recordId: result.record.id, char: result.record.char, failed: false });
        arm();
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
    const result = store ? commitUndoSkip(store, { slot, sessionId: u.sessionId, recordId: u.recordId }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      clearTimeout(timerRef.current);
      timerRef.current = 0;
      setUndo(null);
      return;
    }
    clearTimeout(timerRef.current); // 失败态不自动消失，直到重试成功或「先不保存」
    timerRef.current = 0;
    setUndo({ ...u, failed: true });
    markStateChange();
  };

  const dismiss = () => {
    clearTimeout(timerRef.current);
    timerRef.current = 0;
    setUndo(u => (u ? null : u));
  };

  const failed = !!(fail && fail.key === key);
  const answerSeen = !!(session && session.current && session.current.answerSeen);
  const shown = !!cardKey && phase === 'recall' && !answerSeen;
  return {
    shown,
    failed,
    button: shown && !failed
      ? html`<${Button} variant="text" class="sz-skip__btn" data-testid="write-skip" onClick=${skip}>${t('R-W14.btnSkip')}</${Button}>`
      : null,
    note: failed ? t('R-W16.saveFailed') : '',
    failButtons: failed
      ? html`<div class="sz-skip__fail">
          <${Button} variant="secondary" data-testid="write-skip-fail-cancel" onClick=${() => { setFail(null); markStateChange(); }}>${t('R-W16.cancel')}</${Button}>
          <${Button} variant="primary" data-testid="write-skip-fail-retry" onClick=${skip}>${t('R-W16.retry')}</${Button}>
        </div>`
      : null,
    bar: undo
      ? html`<${SkipUndoDock} char=${undo.char} failed=${undo.failed} onUndo=${doUndo}
          onCancelFail=${() => { setUndo(null); markStateChange(); }} />`
      : null,
    undoOpen: !!undo,
    dismiss,
  };
}
