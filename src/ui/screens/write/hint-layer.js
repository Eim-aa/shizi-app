// 提示（M1-3；决定-D25 方案①；01-架构设计 §6.4；04 R-W05 / R-W06；原型 ShiziWriteScreen L395–L405、L505–L510、L545、L563、L616）。
//
// 量：一律交给 core/hints.js（D64 ①：每点一次在已给出的笔之后再多给一段，可一直点到整字都给出；有部件分组数据的字每段 max(1, round(N/4)) 笔，
//   没有分组数据的字每次多 1 笔；没有笔顺数据的字没有分步提示）。整字都给出后按钮不可点，这个字按「看过答案」记录（answer.js commitAnswerSeen，留在回忆页继续写）。
//   「有没有分组数据」= deck-data.js 的 GROUPS[字] 存在且各组笔数之和等于笔顺数据的总笔数（与旧 index.html L2508 同一判据；
//   policy.hintUseGroups=false（P29）只表示不按分组内容切笔，分组数据本身只用来判断走 1/4 规则还是前 1 / 前 2 笔）。
// 画法（D34 / D51 ⑧ → D53 ①，第三轮 V3-01 / T3-02：去掉 ink3 外廓，与描一遍同一种画法，全 App 只保留一种）：提示画在书写格的参考字形层（本人笔迹层**下面**），用 canvas/glyph-wash.js 的
//   --danzhu 不透明实填（drawGlyphSolid：只画给出的那几笔，同色不透明填进一层、交叠处不叠色）；颜色走令牌（--danzhu）。没有灰外廓、没有整层不透明度，也不是中线折线。整组 150ms 淡入（policy.motion.hintFadeInMs，P210；网页阶段不逐笔写出，拟合与逐笔属阶段 2）。
//   本人笔迹**不变暗**（D34 覆盖 D25；inkOpacity 恒为 1）。
//   写过哪笔收哪笔（D53 ⑧，第三轮 I3-01；覆盖原「写下一笔整组 260ms 淡出」）：用户每写完一笔（抬笔，笔数 +1），若它与某一提示笔匹配——先按笔顺序号（第 n 笔对第 n 笔提示），
//   序号对不上时按几何最近（本人笔画对提示笔中线的平均距离最小，且 ≤ HINT_MATCH_MAX_DIST）——只把那一笔提示 260ms 淡出，其余提示笔留着照着写；全部写过后提示层消失（同时 commit hintRange:null）。
//   撤销（笔数减少）→ 被收掉的提示笔回来；读屏照常播报给出了哪几笔（sr-live.js）。
//   减少动态效果：提示整体 120ms 淡入、被收的那一笔 120ms 淡出（02 §3 M1-3 / R-G01）。
// 按钮（R-W05；D49 起是文字行里的文字按钮）：可见文字一直是「提示」，读屏名称「提示，还有 {n} 次」（n = 还剩几段）→「提示已用完」（用完 disabled + aria-disabled，ink4）；没有笔顺数据时换成灰字「暂时没有提示」
//   （M1-2 NoHintLabel，不是按钮）；数据还在加载时按钮文字照常、暂不可点。看过答案后（answerSeen）不显示（M1-4 的按钮）——除非是提示整字给完记的看过答案（用完状态仍显示不可点的按钮）。
// 格下说明：用过提示后没有说明句（D51 ⑧：删去解释颜色的图例句「浅红色是提示……」，P41）；没有笔顺数据时
//   「这个字暂时没有提示，可以直接看答案。」（R-W05），前面有 --o 小圆点（原型 hintNote）。
// 记录：每次点提示 commit sessions[slot].current.hints（次数）与 hintRange（{from, to}，笔序 0 起、to 不含）；
//   提示笔全部被本人笔收掉、淡完后 commit hintRange:null（撤销让提示笔回来时再写回 range；恢复现场时按已写笔数重新推出哪些已收掉）。写入失败不阻断（P52 同口径）：提示照常显示，本地次数保留，下一次写入带上本地次数；
//   调用方判断 / 看答案时应取 used（= max(本地, 已存)）兜底。
// 回忆阶段答案字不进任何属性（决定-D16）：本层只有笔序号与几何路径，宿主层 aria-hidden。
//
// 纯逻辑（单测 test/ui/hint-layer.test.mjs）：strokeDrawMs、hintTimeline（逐笔时序，阶段 2 原生的基准保留）、groupsFor、hasGroupData、hintSourceOf、
//   planHint、hintButtonModel、hintNoteModel、initialHintView、reduceHintView、hintRemaining、matchHintStroke、applyHintToDraft。
// 组件 / hook：useStrokeData(char)、useHint({...})、HintLayer、HintButton、HintNote。

import { html, useEffect, useLayoutEffect, useReducer, useRef, useState } from '../../../../vendor/ui.js';
import { hintsAllGiven } from '../../../core/hints.js';
import { watchStrokes, peekStrokes } from '../../../data/strokes.js';
import { mediansInBox, prefersReducedMotion } from '../../canvas/glyph.js';
import { M } from '../../../config/motion.js';
import { GlyphWash } from '../../canvas/glyph-wash.js';
import { Button } from '../../components/Button.js';
import { SolidIcons } from '../../components/icons.js';
import { injectStyles, T } from '../../components/styles.js';
import { NoHintLabel } from './glyph-fallback.js';

// B2.1 / B2.2：提交函数与纯模型（常量、来源判定、planHint、按钮 / 说明模型、视图状态机、匹配、时间线、点一次提示的 hintStep / commitHintStep）
// 在无 DOM 的 src/session/ops/hint.js；这里导入并原名转出，原导入路径照旧可用（网页与写字会话 API 用的是同一批函数）。
import {
  HINT_DRAW,
  HINT_FADE_IN_MS,
  HINT_FADE_OUT_MS,
  HINT_MATCH_MAX_DIST,
  REDUCED_FADE_MS,
  strokeDrawMs,
  hintTimeline,
  groupsFor,
  hasGroupData,
  hintSourceOf,
  hintSourceOfCount,
  planHint,
  hintButtonModel,
  hintNoteModel,
  mergeHintRange,
  hintRemaining,
  hintVisible,
  meanDistanceToMedian,
  matchHintStroke,
  initialHintView,
  reduceHintView,
  applyHintToDraft,
  commitHint,
  hintStep,
  commitHintStep,
} from '../../../session/write-ops.js';
export {
  HINT_DRAW,
  HINT_FADE_IN_MS,
  HINT_FADE_OUT_MS,
  HINT_MATCH_MAX_DIST,
  REDUCED_FADE_MS,
  strokeDrawMs,
  hintTimeline,
  groupsFor,
  hasGroupData,
  hintSourceOf,
  hintSourceOfCount,
  planHint,
  hintButtonModel,
  hintNoteModel,
  mergeHintRange,
  hintRemaining,
  hintVisible,
  meanDistanceToMedian,
  matchHintStroke,
  initialHintView,
  reduceHintView,
  applyHintToDraft,
  commitHint,
  hintStep,
  commitHintStep,
};
// ---------------------------------------------------------------- 样式

injectStyles('hint-layer', `
@keyframes szHintFadeIn{from{opacity:0}}
@keyframes szHintOut{to{opacity:0}}
.sz-hint{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;overflow:visible}
.sz-hint__group{position:absolute;inset:0}
.sz-hint__out{position:absolute;inset:0;pointer-events:none}
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
  const remaining = hintRemaining(view);
  const fading = view && view.fading ? view.fading : [];
  if (!data || !view || !view.range || (!remaining.length && !fading.length)) {
    return html`<div class="sz-hint" data-testid=${testid} data-state="none" aria-hidden="true"></div>`;
  }
  const { from, to } = view.range;
  // 淡入：新给的提示（非恢复）整组淡入；恢复的提示直接静态显示；减少动态效果用 REDUCED_FADE_MS。
  const anim = view.restored ? 'static' : 'fade';
  const outMs = reduced ? REDUCED_FADE_MS : HINT_FADE_OUT_MS;
  const inMs = reduced ? REDUCED_FADE_MS : HINT_FADE_IN_MS;
  const groupStyle = { opacity: HINT_DRAW.opacity };
  if (view.show === 'in' && anim === 'fade') groupStyle.animation = `szHintFadeIn ${inMs}ms ${M.ease.linear}`;
  // 没收的提示笔画在一张 canvas 上；每一笔刚被收掉的提示笔各占一张（260ms 淡出后卸掉）——被收掉的那一笔与其余提示笔互不影响。
  return html`<div class="sz-hint" data-testid=${testid} data-state=${fading.length ? 'fading' : 'shown'} data-from=${from}
    data-to=${to} data-anim=${anim} data-run=${view.run} data-remaining=${remaining.join(',')} data-fading=${fading.map(f => f.hint).join(',')} aria-hidden="true">
    <div class="sz-hint__group" key=${`g${view.run}`} style=${groupStyle}>
      <${GlyphWash} data=${data} solid=${remaining} fillTestid="write-hint-fill" />
      ${fading.map(f => html`<div class="sz-hint__out" key=${`o${f.hint}`} data-testid="write-hint-out" data-stroke=${f.hint}
        style=${{ animation: `szHintOut ${outMs}ms ${M.ease.linear} forwards` }}>
        <${GlyphWash} data=${data} solid=${[f.hint]} fillTestid="write-hint-out-fill" />
      </div>`)}
    </div>
  </div>`;
}

/** 提示按钮 / 灰字（R-W05）。model = hintButtonModel(...)。 */
export function HintButton({ model, onHint, testid = 'write-hint' }) {
  if (!model || model.kind === 'hidden') return null;
  if (model.kind === 'unavailable') return html`<${NoHintLabel} testid="write-hint-unavailable" />`;
  return html`<${Button} variant="text" class="sz-hintbtn" data-testid=${testid} data-state=${model.kind}
    data-remaining=${model.remaining} aria-label=${model.label} disabled=${!!model.disabled} onClick=${onHint}><span class="sz-write__ic" aria-hidden="true">${SolidIcons.hint()}</span>${model.text}</${Button}>`;
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
 * @param {Array} [o.ownStrokes]        当前书写格的本人原始笔画（每笔 [{x,y,t}]，345 单位）：写完一笔后据此（笔顺序号优先、几何最近为辅）收掉对应的那一笔提示（D53 ⑧）
 * @param {{status, data}} o.strokes    useStrokeData(char) 的结果
 * @param {() => object} [o.getStore]   store 访问（缺省 store/store.js getStore，注入给测试）
 * @param {() => void} [o.onHinted]      给出了一次提示之后（写字页用来结束跳过的撤销机会，G3）
 * @returns {{used, source, button, layer, note, inkOpacity(恒 1), inkTransition, onHint, lastCommit}}
 *   used = max(本地次数, 已存次数)，M1-4 / M1-5 记 help.hints 用它兜底。
 */
export function useHint({ slot, session, cardKey, char, phase, written, ownStrokes = null, strokes, getStore, onHinted }) {
  const current = session && session.current ? session.current : null;
  const stored = current ? { hints: current.hints, hintRange: current.hintRange } : null;
  const [view, dispatch] = useReducer(reduceHintView, null, () => initialHintView(cardKey, stored, written));
  const reduced = useReducedMotion();
  const timersRef = useRef(new Map()); // 提示笔序号 → 淡出计时器
  const lastCommitRef = useRef(null);
  const countRef = useRef({ key: `${cardKey}|${phase}`, count: written });
  const clearedRef = useRef(false); // 本字的 hintRange 已 commit 成 null（提示笔全部收掉）
  const live = useRef({});
  live.current = { slot, session, cardKey, view, reduced, strokes, ownStrokes, phase };

  // 换字：视图回到会话现场（恢复）状态。
  const active = view.key === cardKey ? view : initialHintView(cardKey, stored, written);
  useLayoutEffect(() => {
    if (view.key !== cardKey) dispatch({ type: 'reset', key: cardKey, stored, written });
  }, [cardKey]);
  // 已存次数比本地多（例如别处恢复写入）→ 本地跟上。
  const storedUsed = stored ? Math.max(0, Math.trunc(Number(stored.hints) || 0)) : 0;
  useEffect(() => {
    if (view.key === cardKey && storedUsed > view.used) dispatch({ type: 'sync-used', used: storedUsed });
  }, [cardKey, storedUsed]);

  const clearTimers = () => {
    for (const id of timersRef.current.values()) clearTimeout(id);
    timersRef.current.clear();
  };
  useEffect(() => clearTimers, []);
  useEffect(() => {
    clearTimers();
    clearedRef.current = false;
  }, [cardKey]);

  const source = hintSourceOf({ status: strokes ? strokes.status : 'loading', data: strokes ? strokes.data : null, char });
  const used = Math.max(active.used, storedUsed);
  const answerSeen = !!(current && current.answerSeen);
  const allGiven = hintsAllGiven({ totalStrokes: source.totalStrokes, used, hasStrokeData: source.hasStrokeData, hasGroups: source.hasGroups });

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
    const out = commitHint(store, { slot: sl, sessionId: se.id, cardKey: ck, ...patch }, label);
    lastCommitRef.current = { label, ...out };
    return out;
  }

  function onHint() {
    const { view: v, cardKey: ck } = live.current;
    if (v.key !== ck) return;
    const model = hintButtonModel({ phase, status: source.status, used, answerSeen, source });
    if (model.kind !== 'available') return;
    // 点一次提示（D64 ①）：与写字会话 API 的 hint op 同一对函数（src/session/ops/hint.js hintStep / commitHintStep）。
    const step = hintStep({ source, used, written, range: v.range });
    if (!step) return;
    clearTimers();
    clearedRef.current = false;
    dispatch({ type: 'hint', range: step.plan, written, skip: step.plan.skip });
    if (typeof onHinted === 'function') onHinted(); // 写字页：跳过的撤销机会到此结束（G3）
    // 写入失败不阻断（P52 同口径）：提示照常显示，本地 used 已 +1，下次写入带上。整字都给出了：这次写入同时记为看过答案，页面仍留在回忆阶段继续写。
    const { slot: sl, session: se } = live.current;
    let store = null;
    try {
      store = se && getStore ? getStore() : null;
    } catch (error) {
      store = null;
    }
    const result = store ? commitHintStep(store, { slot: sl, sessionId: se.id, cardKey: ck, step }) : { ok: false, error: { kind: 'no-store' } };
    lastCommitRef.current = { label: step.whole ? 'hint-whole' : 'hint', ...result };
  }

  // 写过哪笔收哪笔（D53 ⑧）：本人笔数在回忆阶段 +1（抬笔）→ 收掉与它匹配的那一笔提示（只那一笔淡出）；笔数减少（撤销 / 清空）→ 被收掉的提示笔回来。
  // 换字 / 换阶段只重置计数，不收。
  useLayoutEffect(() => {
    const key = `${cardKey}|${phase}`;
    const prev = countRef.current;
    countRef.current = { key, count: written };
    if (prev.key !== key || phase !== 'recall' || (answerSeen && !allGiven)) return;
    const { view: v, strokes: st, ownStrokes: own, reduced: red } = live.current;
    if (v.key !== cardKey) return;
    if (written < prev.count) {
      dispatch({ type: 'restore', fromUser: written });
      return;
    }
    if (written === prev.count || !v.range) return;
    const medians = st && st.status === 'ready' && st.data ? mediansInBox(st.data, { size: 345 }) : null;
    let cur = v;
    for (let n = prev.count; n < written; n += 1) {
      const remaining = hintRemaining(cur);
      const h = matchHintStroke({ remaining, index: n, points: own && own[n] ? own[n] : null, medians });
      if (h === null) continue;
      const action = { type: 'absorb', user: n, hint: h };
      cur = reduceHintView(cur, action);
      dispatch(action);
      clearTimeout(timersRef.current.get(h));
      timersRef.current.set(h, setTimeout(() => {
        timersRef.current.delete(h);
        if (live.current.cardKey === cardKey) dispatch({ type: 'faded', hint: h });
      }, red ? REDUCED_FADE_MS : HINT_FADE_OUT_MS));
    }
  }, [written, cardKey, phase]);

  // 提示笔全部收掉（淡完）→ commit hintRange:null；撤销让提示笔回来 → 把 range 写回去。写入失败不阻断（P52）。
  useEffect(() => {
    if (view.key !== cardKey || !view.range) return;
    const remaining = hintRemaining(view);
    if (!remaining.length && !view.fading.length && !clearedRef.current) {
      clearedRef.current = true;
      doCommit('hint-fade', { hints: view.used, hintRange: null });
    } else if (remaining.length && clearedRef.current) {
      clearedRef.current = false;
      doCommit('hint-fade', { hints: view.used, hintRange: { from: view.range.from, to: view.range.to } });
    }
  }, [view, cardKey]);

  const buttonModel = hintButtonModel({ phase, status: source.status, used, answerSeen, source });
  return {
    used,
    source,
    view: active,
    reduced,
    buttonModel,
    button: html`<${HintButton} model=${buttonModel} onHint=${onHint} />`,
    layer: phase === 'recall' && (!answerSeen || allGiven) && source.status === 'ready'
      ? html`<${HintLayer} data=${strokes.data} view=${active} reduced=${reduced} />`
      : null,
    note: hintNoteModel({ phase, status: source.status, used, answerSeen }),
    inkOpacity: 1, // 本人墨任何求助态都不变暗（D34 / D43 / D51 ⑧）
    inkTransition: undefined,
    onHint,
    lastCommit: lastCommitRef.current,
  };
}
