// 提示（M1-3；决定-D25 方案①；01-架构设计 §6.4；04 R-W05 / R-W06；原型 ShiziWriteScreen L395–L405、L505–L510、L545、L563、L616）。
//
// 量：一律交给 core/hints.js（每字最多 policy.hintMax 次；有部件分组数据的字每次 max(1, round(N/4)) 笔、从
//   min(已写笔数, N−q) 起（P01 按已写笔数）；没有分组数据的字前 1 / 前 2 笔；没有笔顺数据的字没有分步提示）。
//   「有没有分组数据」= deck-data.js 的 GROUPS[字] 存在且各组笔数之和等于笔顺数据的总笔数（与旧 index.html L2508 同一判据；
//   policy.hintUseGroups=false（P29）只表示不按分组内容切笔，分组数据本身只用来判断走 1/4 规则还是前 1 / 前 2 笔）。
// 画法（D34 / D51 ⑧，W1 验收：与描一遍同一种画法，全 App 只保留一种）：提示画在书写格的参考字形层（本人笔迹层**下面**），用 canvas/glyph-wash.js 的
//   整层淡填充（drawGlyphSolid：给出的那几笔同色不透明填进一层、整层 .4 不透明度）+ 外侧一圈墨三 --ink3 外廓（drawGlyphRing）；颜色走令牌（--danzhu / --ink3）。
//   不再是不透明实心色块，也不是中线折线。整组 150ms 淡入（policy.motion.hintFadeInMs，P210；网页阶段不逐笔写出，拟合与逐笔属阶段 2）。
//   本人笔迹**不变暗**（D34 覆盖 D25；inkOpacity 恒为 1）。写下一笔（接受了一次落笔）→ 提示 260ms 淡出，淡完清掉提示范围。
//   减少动态效果：提示整体 120ms 淡入 / 淡出（02 §3 M1-3 / R-G01）。
// 按钮（R-W05；D49 起是文字行里的文字按钮）：可见文字一直是「提示」，读屏名称「提示，还有 {n} 次」→「提示已用完」（用完 disabled + aria-disabled，ink4）；没有笔顺数据时换成灰字「暂时没有提示」
//   （M1-2 NoHintLabel，不是按钮）；数据还在加载时按钮文字照常、暂不可点。看过答案后（answerSeen）不显示（M1-4 的按钮）。
// 格下说明：用过提示后没有说明句（D51 ⑧：删去解释颜色的图例句「浅红色是提示……」，P41）；没有笔顺数据时
//   「这个字暂时没有提示，可以直接看答案。」（R-W05），前面有 --o 小圆点（原型 hintNote）。
// 记录：每次点提示 commit sessions[slot].current.hints（次数）与 hintRange（{from, to}，笔序 0 起、to 不含）；
//   淡出结束再 commit hintRange:null。写入失败不阻断（P52 同口径）：提示照常显示，本地次数保留，下一次写入带上本地次数；
//   调用方判断 / 看答案时应取 used（= max(本地, 已存)）兜底。
// 回忆阶段答案字不进任何属性（决定-D16）：本层只有笔序号与几何路径，宿主层 aria-hidden。
//
// 纯逻辑（单测 test/ui/hint-layer.test.mjs）：strokeDrawMs、hintTimeline（逐笔时序，阶段 2 原生的基准保留）、groupsFor、hasGroupData、hintSourceOf、
//   planHint、hintButtonModel、hintNoteModel、initialHintView、reduceHintView、applyHintToDraft。
// 组件 / hook：useStrokeData(char)、useHint({...})、HintLayer、HintButton、HintNote。

import { html, useEffect, useLayoutEffect, useReducer, useRef, useState } from '../../../../vendor/ui.js';
import { nextHintRange, hintButtonState, hintButtonCopy } from '../../../core/hints.js';
import { currentCardKey, withCurrent } from '../../../core/sessions.js';
import * as defaultPolicy from '../../../config/policy.js';
import { t } from '../../../config/copy/index.js';
import { watchStrokes, peekStrokes } from '../../../data/strokes.js';
import { prefersReducedMotion } from '../../canvas/glyph.js';
import { GlyphWash } from '../../canvas/glyph-wash.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { NoHintLabel } from './glyph-fallback.js';

// ---------------------------------------------------------------- 常量（原型 L505–L510 / 01 §6.4）
// 节奏里的过渡值（单笔时长上限、错开系数、减少动态效果的淡化时长）在 policy.motion（P70，待设计走查）；
// strokeDrawMs / hintTimeline 可传 motion 覆盖。其余是原型 / 01 §6.4 的工程常量。

export const HINT_DRAW = Object.freeze({
  minMs: 110,
  maxMs: defaultPolicy.motion.hintStrokeMs,
  stagger: defaultPolicy.motion.hintStagger,
  easing: 'cubic-bezier(.4,0,.2,1)',
  opacity: 1, // 整组（淡填充 + 外廓）的显隐不透明度；淡填充自己的 .4 在 glyph.js TRACE_FILL_ALPHA（对比度见 test/ui/contrast.test.mjs「提示」）
});
/** 提示整组淡入（P210；D51 ⑧ 网页阶段的最小过渡）。 */
export const HINT_FADE_IN_MS = defaultPolicy.motion.hintFadeInMs;
/** 写下一笔后提示淡出时长（01 §6.4）。 */
export const HINT_FADE_OUT_MS = 260;
/** 减少动态效果时的淡入淡出（02 §3 M1-3 / R-G01；policy.motion.reducedFadeMs，P70）。 */
export const REDUCED_FADE_MS = defaultPolicy.motion.reducedFadeMs;

// ---------------------------------------------------------------- 纯逻辑

/** 单笔描画时长（ms）：round(min(max(1100/n,110), 240, 1200/(.3+.7n)))，n = 这次给的笔数。 */
export function strokeDrawMs(count, motion) {
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  const maxMs = motion && Number.isFinite(motion.hintStrokeMs) ? motion.hintStrokeMs : HINT_DRAW.maxMs;
  return Math.round(Math.min(Math.max(1100 / n, HINT_DRAW.minMs), maxMs, 1200 / (0.3 + 0.7 * n)));
}

/** 这次提示每笔的 {delay, dur}（ms）与总时长。 */
export function hintTimeline(count, motion) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const dur = strokeDrawMs(n || 1, motion);
  const stagger = motion && Number.isFinite(motion.hintStagger) ? motion.hintStagger : HINT_DRAW.stagger;
  const items = [];
  for (let j = 0; j < n; j += 1) items.push({ delay: Math.round(j * dur * stagger), dur });
  const total = n ? items[n - 1].delay + dur : 0;
  return { dur, items, total };
}

/** deck-data.js 的 GROUPS 表（classic script 顶层 const，挂在全局词法环境，不在 globalThis 上）。 */
function globalGroups() {
  try {
    // eslint-disable-next-line no-undef
    if (typeof GROUPS !== 'undefined' && GROUPS && typeof GROUPS === 'object') return GROUPS;
  } catch (error) {
    // 没有 deck-data（node 单测）
  }
  const g = typeof globalThis !== 'undefined' ? globalThis.GROUPS : undefined;
  return g && typeof g === 'object' ? g : null;
}

/** 某字的部件分组（每组笔数数组）；没有返回 null。table 缺省读全局 GROUPS。 */
export function groupsFor(char, table = globalGroups()) {
  if (!table || typeof char !== 'string' || !char) return null;
  const g = Object.prototype.hasOwnProperty.call(table, char) ? table[char] : null;
  return Array.isArray(g) ? g : null;
}

/** 分组数据可用：每组为正整数、总和等于笔顺数据的总笔数（旧 index.html L2508 同一判据）。 */
export function hasGroupData(groups, totalStrokes) {
  if (!Array.isArray(groups) || groups.length === 0) return false;
  let sum = 0;
  for (const n of groups) {
    if (!Number.isInteger(n) || n < 1) return false;
    sum += n;
  }
  return sum === totalStrokes;
}

/**
 * 笔顺数据状态 → 提示用的来源描述。
 * @param {{status:'loading'|'ready'|'missing', data?:object|null, char?:string, groups?:number[]|null}} input
 * @returns {{status:'loading'|'ready'|'missing', totalStrokes:number, hasStrokeData:boolean, hasGroups:boolean}}
 */
export function hintSourceOf({ status, data, char, groups } = {}) {
  if (status === 'ready' && data && Array.isArray(data.medians) && data.medians.length > 0) {
    const totalStrokes = data.medians.length;
    const g = groups === undefined ? groupsFor(char) : groups;
    return { status: 'ready', totalStrokes, hasStrokeData: true, hasGroups: hasGroupData(g, totalStrokes) };
  }
  if (status === 'missing') return { status: 'missing', totalStrokes: 0, hasStrokeData: false, hasGroups: false };
  return { status: 'loading', totalStrokes: 0, hasStrokeData: true, hasGroups: false };
}

/**
 * 下一次提示的笔序范围 {from, to, count, index}（to 不含）；不能给（加载中 / 无数据 / 已用完）返回 null。
 */
export function planHint({ source, used = 0, written = 0 }, policy = defaultPolicy) {
  if (!source || source.status !== 'ready') return null;
  const r = nextHintRange({
    totalStrokes: source.totalStrokes,
    writtenStrokes: written,
    used,
    hasStrokeData: source.hasStrokeData,
    hasGroups: source.hasGroups,
  }, policy);
  return r ? { from: r.from, to: r.from + r.count, count: r.count, index: r.index } : null;
}

/**
 * 提示按钮模型。
 * @returns {{kind:'hidden'} | {kind:'unavailable', label} | {kind:'loading'|'available'|'exhausted', label, disabled, remaining}}
 */
export function hintButtonModel({ phase = 'recall', status, used = 0, answerSeen = false } = {}, policy = defaultPolicy) {
  if (phase !== 'recall' || answerSeen) return { kind: 'hidden' };
  const st = hintButtonState({ used, hasStrokeData: status !== 'missing' }, policy);
  const copy = hintButtonCopy(st);
  const label = t(copy.key, copy.vars); // 读屏名称（「提示，还有 2 次」「提示已用完」）；可见文字一律是 text（D49：次数不画出来）
  const text = t('R-W05.hintLabel');
  if (st.state === 'unavailable') return { kind: 'unavailable', label };
  if (st.state === 'exhausted') return { kind: 'exhausted', label, text, disabled: true, remaining: 0 };
  if (status !== 'ready') return { kind: 'loading', label, text, disabled: true, remaining: st.remaining };
  return { kind: 'available', label, text, disabled: false, remaining: st.remaining };
}

/** 格下说明（提示相关的两句）。其余说明（保存失败、看过答案…）由各自卡片决定优先级。 */
export function hintNoteModel({ phase = 'recall', status, used = 0, answerSeen = false } = {}) {
  if (phase !== 'recall' || answerSeen) return null;
  if (status === 'missing') return { kind: 'no-hint', text: t('R-W05.noHintNote'), dot: true };
  return null; // 用过提示后没有说明句（D51 ⑧：不再用文字解释颜色）
}

function validRange(r) {
  return !!r && typeof r === 'object' && Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 0 && r.to > r.from;
}

/**
 * 提示层视图状态（每个字一份）。
 * show：'none' 没有提示；'in' 正在显示（run 变化即重新描画）；'out' 正在淡出。
 * stored：会话现场 {hints, hintRange}（恢复时 hintRange 仍在 → 直接静态显示，不再描画）。
 */
export function initialHintView(key, stored) {
  const used = Math.max(0, Math.trunc(Number(stored && stored.hints) || 0));
  const range = stored && validRange(stored.hintRange) ? { from: stored.hintRange.from, to: stored.hintRange.to } : null;
  return { key, used, range, show: range ? 'in' : 'none', run: 0, restored: !!range };
}

export function reduceHintView(view, action) {
  switch (action.type) {
    case 'reset':
      return initialHintView(action.key, action.stored);
    case 'hint':
      if (!validRange(action.range)) return view;
      return { ...view, used: view.used + 1, range: { from: action.range.from, to: action.range.to }, show: 'in', run: view.run + 1, restored: false };
    case 'stroke-start':
      return view.show === 'in' ? { ...view, show: 'out' } : view;
    case 'faded':
      return view.show === 'out' ? { ...view, show: 'none', range: null } : view;
    case 'sync-used':
      return action.used > view.used ? { ...view, used: action.used } : view;
    default:
      return view;
  }
}

/**
 * store.commit 的 mutator 主体：把 {hints?, hintRange} 写进 draft.sessions[slot].current。
 * 会话 / 当前字已经变了（换字、会话结束）就不写，返回 false。
 */
export function applyHintToDraft(draft, { slot, sessionId, cardKey, hints, hintRange }, at) {
  const sessions = draft.sessions;
  const s = sessions ? sessions[slot] : null;
  if (!s || s.id !== sessionId || currentCardKey(s) !== cardKey || !s.current) return false;
  const patch = { hintRange: hintRange ? { from: hintRange.from, to: hintRange.to } : null };
  if (hints !== undefined) patch.hints = Math.max(Number(s.current.hints) || 0, hints);
  draft.sessions = { ...sessions, [slot]: withCurrent(s, patch, at) };
  return true;
}

// ---------------------------------------------------------------- 样式

injectStyles('hint-layer', `
@keyframes szHintFadeIn{from{opacity:0}}
.sz-hint{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;overflow:visible}
.sz-hint__group{position:absolute;inset:0}
.sz-hintbtn{white-space:nowrap}
.sz-hintnote{display:flex;align-items:flex-start;gap:8px}
.sz-hintnote__dot{flex:none;width:6px;height:6px;margin-top:calc(.775em - 3px);border-radius:50%;background:${T.danzhu}}
`);

// ---------------------------------------------------------------- 组件

/**
 * 提示层：放进书写格的 glyphLayer（宿主 absolute、aria-hidden、pointer-events:none）。
 * @param {{data, view, reduced}} props  view = reduceHintView 的状态
 */
export function HintLayer({ data, view, reduced = false, testid = 'write-hint-layer' }) {
  if (!data || !view || !view.range) {
    return html`<div class="sz-hint" data-testid=${testid} data-state="none" aria-hidden="true"></div>`;
  }
  const { from, to } = view.range;
  // 淡入：新给的提示（非恢复）整组淡入；恢复的提示直接静态显示；减少动态效果用 REDUCED_FADE_MS。
  const anim = view.restored ? 'static' : 'fade';
  const out = view.show === 'out';
  const fadeMs = reduced ? REDUCED_FADE_MS : HINT_FADE_OUT_MS;
  const inMs = reduced ? REDUCED_FADE_MS : HINT_FADE_IN_MS;
  const groupStyle = {
    opacity: out ? 0 : HINT_DRAW.opacity,
    transition: `opacity ${fadeMs}ms linear`,
  };
  if (view.show === 'in' && anim === 'fade') groupStyle.animation = `szHintFadeIn ${inMs}ms linear`;
  return html`<div class="sz-hint" data-testid=${testid} data-state=${out ? 'fading' : 'shown'} data-from=${from}
    data-to=${to} data-anim=${anim} data-run=${view.run} aria-hidden="true">
    <div class="sz-hint__group" key=${`g${view.run}`} style=${groupStyle}>
      <${GlyphWash} data=${data} from=${from} to=${to} fillTestid="write-hint-fill" ringTestid="write-hint-ring" />
    </div>
  </div>`;
}

/** 提示按钮 / 灰字（R-W05）。model = hintButtonModel(...)。 */
export function HintButton({ model, onHint, testid = 'write-hint' }) {
  if (!model || model.kind === 'hidden') return null;
  if (model.kind === 'unavailable') return html`<${NoHintLabel} testid="write-hint-unavailable" />`;
  return html`<${Button} variant="text" class="sz-hintbtn" data-testid=${testid} data-state=${model.kind}
    data-remaining=${model.remaining} aria-label=${model.label} disabled=${!!model.disabled} onClick=${onHint}>${model.text}</${Button}>`;
}

/** 格下说明（带 --o 小圆点）。note = hintNoteModel(...)。 */
export function HintNote({ note }) {
  if (!note) return null;
  return html`<span class="sz-hintnote" data-hint-note=${note.kind}>
    ${note.dot ? html`<span class="sz-hintnote__dot" aria-hidden="true"></span>` : null}
    <span>${note.text}</span>
  </span>`;
}

// ---------------------------------------------------------------- hooks

/**
 * 当前字的笔顺数据（src/data/strokes.js watchStrokes；换字 / 卸载时 stop）。
 * 返回 {char, status:'loading'|'ready'|'missing', data, reason?}。char 为空时 status='missing'。
 * 写字页只调一次，M1-4（看答案 / 描一遍）与本卡共用。
 */
export function useStrokeData(char) {
  const initial = () => {
    if (!char) return { char, status: 'missing', data: null, reason: 'bad-char' };
    const cached = peekStrokes(char);
    return cached ? { char, status: 'ready', data: cached } : { char, status: 'loading', data: null };
  };
  const [st, setSt] = useState(initial);
  useEffect(() => {
    if (!char) {
      setSt({ char, status: 'missing', data: null, reason: 'bad-char' });
      return undefined;
    }
    const w = watchStrokes(char, ev => {
      if (ev.status === 'ready') setSt({ char, status: 'ready', data: ev.data, source: ev.source });
      else if (ev.status === 'missing') setSt({ char, status: 'missing', data: null, reason: ev.reason });
      else setSt(prev => (prev.char === char && prev.status === 'ready' ? prev : { char, status: 'loading', data: null }));
    });
    return () => w.stop();
  }, [char]);
  // 换字的第一帧：旧字的数据不能用在新字上。
  return st.char === char ? st : initial();
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    let mq = null;
    try {
      mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch (error) {
      mq = null;
    }
    if (!mq) return undefined;
    const on = () => setReduced(!!mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener('change', on);
    else if (mq.addListener) mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else if (mq.removeListener) mq.removeListener(on);
    };
  }, []);
  return reduced;
}

/**
 * 写字页的提示控制器。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session       store 里的 sessions[slot]
 * @param {string|null} o.cardKey
 * @param {string|null} o.char
 * @param {string} o.phase
 * @param {number} o.written            当前书写格已完成的本人笔数（P01 按已写笔数）
 * @param {{status, data}} o.strokes    useStrokeData(char) 的结果
 * @param {() => object} [o.getStore]   store 访问（缺省 store/store.js getStore，注入给测试）
 * @param {() => void} [o.onHinted]      给出了一次提示之后（写字页用来结束跳过的撤销机会，G3）
 * @returns {{used, source, button, layer, note, inkOpacity(恒 1), inkTransition, onStrokeStart, onHint, lastCommit}}
 *   used = max(本地次数, 已存次数)，M1-4 / M1-5 记 help.hints 用它兜底。
 */
export function useHint({ slot, session, cardKey, char, phase, written, strokes, getStore, onHinted }) {
  const current = session && session.current ? session.current : null;
  const stored = current ? { hints: current.hints, hintRange: current.hintRange } : null;
  const [view, dispatch] = useReducer(reduceHintView, null, () => initialHintView(cardKey, stored));
  const reduced = useReducedMotion();
  const timerRef = useRef(0);
  const lastCommitRef = useRef(null);
  const live = useRef({});
  live.current = { slot, session, cardKey, view, reduced };

  // 换字：视图回到会话现场（恢复）状态。
  const active = view.key === cardKey ? view : initialHintView(cardKey, stored);
  useLayoutEffect(() => {
    if (view.key !== cardKey) dispatch({ type: 'reset', key: cardKey, stored });
  }, [cardKey]);
  // 已存次数比本地多（例如别处恢复写入）→ 本地跟上。
  const storedUsed = stored ? Math.max(0, Math.trunc(Number(stored.hints) || 0)) : 0;
  useEffect(() => {
    if (view.key === cardKey && storedUsed > view.used) dispatch({ type: 'sync-used', used: storedUsed });
  }, [cardKey, storedUsed]);

  useEffect(() => () => clearTimeout(timerRef.current), []);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = 0;
  }, [cardKey]);

  const source = hintSourceOf({ status: strokes ? strokes.status : 'loading', data: strokes ? strokes.data : null, char });
  const used = Math.max(active.used, storedUsed);
  const answerSeen = !!(current && current.answerSeen);

  function doCommit(label, patch) {
    const { slot: sl, session: se, cardKey: ck } = live.current;
    if (!se) return { ok: false, error: { kind: 'no-session' } };
    let store = null;
    try {
      store = getStore ? getStore() : null;
    } catch (error) {
      store = null;
    }
    if (!store) return { ok: false, error: { kind: 'no-store' } };
    let applied = false;
    const result = store.commit(label, (draft, ctx) => {
      applied = applyHintToDraft(draft, { slot: sl, sessionId: se.id, cardKey: ck, ...patch }, ctx.now);
    });
    const out = result && result.ok ? { ok: true, applied } : { ok: false, error: result && result.error };
    lastCommitRef.current = { label, ...out };
    return out;
  }

  function onHint() {
    const { view: v, cardKey: ck } = live.current;
    if (v.key !== ck) return;
    const model = hintButtonModel({ phase, status: source.status, used, answerSeen });
    if (model.kind !== 'available') return;
    const range = planHint({ source, used, written });
    if (!range) return;
    clearTimeout(timerRef.current);
    timerRef.current = 0;
    dispatch({ type: 'hint', range });
    if (typeof onHinted === 'function') onHinted(); // 写字页：跳过的撤销机会到此结束（G3）
    // 写入失败不阻断（P52 同口径）：提示照常显示，本地 used 已 +1，下次写入带上。
    doCommit('hint', { hints: used + 1, hintRange: { from: range.from, to: range.to } });
  }

  function onStrokeStart() {
    const { view: v, cardKey: ck, reduced: red } = live.current;
    if (v.key !== ck || v.show !== 'in') return;
    dispatch({ type: 'stroke-start' });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = 0;
      if (live.current.cardKey !== ck) return;
      dispatch({ type: 'faded' });
      doCommit('hint-fade', { hints: live.current.view.used, hintRange: null });
    }, red ? REDUCED_FADE_MS : HINT_FADE_OUT_MS);
  }

  const buttonModel = hintButtonModel({ phase, status: source.status, used, answerSeen });
  return {
    used,
    source,
    view: active,
    reduced,
    buttonModel,
    button: html`<${HintButton} model=${buttonModel} onHint=${onHint} />`,
    layer: phase === 'recall' && !answerSeen && source.status === 'ready'
      ? html`<${HintLayer} data=${strokes.data} view=${active} reduced=${reduced} />`
      : null,
    note: hintNoteModel({ phase, status: source.status, used, answerSeen }),
    inkOpacity: 1, // 本人墨任何求助态都不变暗（D34 / D43 / D51 ⑧）
    inkTransition: undefined,
    onStrokeStart,
    onHint,
    lastCommit: lastCommitRef.current,
  };
}
