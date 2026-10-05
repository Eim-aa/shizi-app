// 提示（M1-3；决定-D25 方案①；01-架构设计 §6.4；04 R-W05 / R-W06；原型 ShiziWriteScreen L395–L405、L505–L510、L545、L563、L616）。
//
// 量：一律交给 core/hints.js（每字最多 policy.hintMax 次；有部件分组数据的字每次 max(1, round(N/4)) 笔、从
//   min(已写笔数, N−q) 起（P01 按已写笔数）；没有分组数据的字前 1 / 前 2 笔；没有笔顺数据的字没有分步提示）。
//   「有没有分组数据」= deck-data.js 的 GROUPS[字] 存在且各组笔数之和等于笔顺数据的总笔数（与旧 index.html L2508 同一判据；
//   policy.hintUseGroups=false（P29）只表示不按分组内容切笔，分组数据本身只用来判断走 1/4 规则还是前 1 / 前 2 笔）。
// 画法（D34 / D51 ⑧ → D53 ①，第三轮 V3-01 / T3-02：去掉 ink3 外廓，与描一遍同一种画法，全 App 只保留一种）：提示画在书写格的参考字形层（本人笔迹层**下面**），用 canvas/glyph-wash.js 的
//   --danzhu 不透明实填（drawGlyphSolid：只画给出的那几笔，同色不透明填进一层、交叠处不叠色）；颜色走令牌（--danzhu）。没有灰外廓、没有整层不透明度，也不是中线折线。整组 150ms 淡入（policy.motion.hintFadeInMs，P210；网页阶段不逐笔写出，拟合与逐笔属阶段 2）。
//   本人笔迹**不变暗**（D34 覆盖 D25；inkOpacity 恒为 1）。
//   写过哪笔收哪笔（D53 ⑧，第三轮 I3-01；覆盖原「写下一笔整组 260ms 淡出」）：用户每写完一笔（抬笔，笔数 +1），若它与某一提示笔匹配——先按笔顺序号（第 n 笔对第 n 笔提示），
//   序号对不上时按几何最近（本人笔画对提示笔中线的平均距离最小，且 ≤ HINT_MATCH_MAX_DIST）——只把那一笔提示 260ms 淡出，其余提示笔留着照着写；全部写过后提示层消失（同时 commit hintRange:null）。
//   撤销（笔数减少）→ 被收掉的提示笔回来；读屏照常播报给出了哪几笔（sr-live.js）。
//   减少动态效果：提示整体 120ms 淡入、被收的那一笔 120ms 淡出（02 §3 M1-3 / R-G01）。
// 按钮（R-W05；D49 起是文字行里的文字按钮）：可见文字一直是「提示」，读屏名称「提示，还有 {n} 次」→「提示已用完」（用完 disabled + aria-disabled，ink4）；没有笔顺数据时换成灰字「暂时没有提示」
//   （M1-2 NoHintLabel，不是按钮）；数据还在加载时按钮文字照常、暂不可点。看过答案后（answerSeen）不显示（M1-4 的按钮）。
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
import { nextHintRange, hintButtonState, hintButtonCopy } from '../../../core/hints.js';
import { currentCardKey, withCurrent } from '../../../core/sessions.js';
import * as defaultPolicy from '../../../config/policy.js';
import { t } from '../../../config/copy/index.js';
import { watchStrokes, peekStrokes } from '../../../data/strokes.js';
import { mediansInBox, prefersReducedMotion } from '../../canvas/glyph.js';
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
  opacity: 1, // 整组的显隐不透明度；淡朱实填本身不透明（对比度见 test/ui/contrast.test.mjs「提示」）
});
/** 提示整组淡入（P210；D51 ⑧ 网页阶段的最小过渡）。 */
export const HINT_FADE_IN_MS = defaultPolicy.motion.hintFadeInMs;
/** 被本人笔收掉的那一笔提示的淡出时长（01 §6.4；D53 ⑧：只收写过的那一笔）。 */
export const HINT_FADE_OUT_MS = 260;
/** 序号对不上时按几何最近匹配的上限：本人笔画到提示笔中线的平均距离（书写格 345 单位，约格边的 11%）；更远的不算「写过这一笔」。 */
export const HINT_MATCH_MAX_DIST = 40;
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

/** 提示笔里还没被本人笔收掉的笔序号（升序）。 */
export function hintRemaining(view) {
  if (!view || !validRange(view.range)) return [];
  const gone = new Set((view.absorbed || []).map(a => a.hint));
  const out = [];
  for (let i = view.range.from; i < view.range.to; i += 1) if (!gone.has(i)) out.push(i);
  return out;
}

/** 提示层此刻有没有东西可看（还有没收的笔，或有一笔正在淡出）。 */
export function hintVisible(view) {
  return hintRemaining(view).length > 0 || !!(view && view.fading && view.fading.length);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 本人一笔（原始采样，书写格 345 单位）到一条提示笔中线（同单位折线）的平均距离。 */
export function meanDistanceToMedian(points, median) {
  if (!Array.isArray(points) || !points.length || !Array.isArray(median) || !median.length) return Infinity;
  const step = Math.max(1, Math.floor(points.length / 24));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    let best = Infinity;
    if (median.length === 1) best = Math.hypot(p.x - median[0][0], p.y - median[0][1]);
    for (let j = 0; j + 1 < median.length; j += 1) best = Math.min(best, distToSegment(p.x, p.y, median[j][0], median[j][1], median[j + 1][0], median[j + 1][1]));
    sum += best;
    n += 1;
  }
  return n ? sum / n : Infinity;
}

/**
 * 本人写下的第 index 笔对应哪一笔提示（纯函数；D53 ⑧）。先按笔顺序号：index 本身还在 remaining 里就是它；
 * 否则按几何最近：remaining 里中线离本人笔画最近的一笔，平均距离 ≤ maxDist 才算（没有笔画 / 中线数据时不匹配）。
 * @param {{remaining:number[], index:number, points?:Array<{x:number,y:number}>, medians?:Array<Array<[number,number]>>, maxDist?:number}} o
 * @returns {number|null} 提示笔序号；匹配不上返回 null
 */
export function matchHintStroke({ remaining, index, points = null, medians = null, maxDist = HINT_MATCH_MAX_DIST } = {}) {
  if (!Array.isArray(remaining) || !remaining.length) return null;
  if (remaining.includes(index)) return index;
  if (!Array.isArray(points) || !points.length || !Array.isArray(medians)) return null;
  let best = null;
  let bestD = Infinity;
  for (const h of remaining) {
    const d = meanDistanceToMedian(points, medians[h]);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best !== null && bestD <= maxDist ? best : null;
}

/**
 * 提示层视图状态（每个字一份）。
 * show：'none' 没有提示；'in' 有提示（run 变化即重新淡入）。range：这次给的 {from, to}（笔序 0 起、to 不含）。
 * absorbed：[{user, hint}] 已被本人笔收掉的提示笔（user = 本人第几笔）；fading：[{hint}] 正在淡出的（收掉后 260ms 内）。
 * stored：会话现场 {hints, hintRange}（恢复时 hintRange 仍在 → 直接静态显示，不再描画）；written = 恢复时已写笔数，据此按笔顺序号推出哪些提示笔已被收掉。
 */
export function initialHintView(key, stored, written = 0) {
  const used = Math.max(0, Math.trunc(Number(stored && stored.hints) || 0));
  const range = stored && validRange(stored.hintRange) ? { from: stored.hintRange.from, to: stored.hintRange.to } : null;
  const absorbed = [];
  if (range) {
    const w = Math.max(0, Math.trunc(Number(written) || 0));
    for (let u = range.from; u < Math.min(range.to, w); u += 1) absorbed.push({ user: u, hint: u });
  }
  return { key, used, range, absorbed, fading: [], show: range ? 'in' : 'none', run: 0, restored: !!range };
}

export function reduceHintView(view, action) {
  switch (action.type) {
    case 'reset':
      return initialHintView(action.key, action.stored, action.written);
    case 'hint':
      if (!validRange(action.range)) return view;
      return { ...view, used: view.used + 1, range: { from: action.range.from, to: action.range.to }, absorbed: [], fading: [], show: 'in', run: view.run + 1, restored: false };
    case 'absorb': {
      // 本人写完一笔（user）收掉提示笔 hint：只那一笔淡出，其余留着；已收掉的 / 不在这次范围里的不再收
      if (!validRange(view.range) || !hintRemaining(view).includes(action.hint)) return view;
      return { ...view, absorbed: view.absorbed.concat([{ user: action.user, hint: action.hint }]), fading: view.fading.concat([{ hint: action.hint }]) };
    }
    case 'faded': {
      if (!view.fading.some(f => f.hint === action.hint)) return view;
      return { ...view, fading: view.fading.filter(f => f.hint !== action.hint) };
    }
    case 'restore': {
      // 撤销 / 清空：笔数退到 fromUser 笔——它们收掉的提示笔回来（同时重新淡入这一组）
      const back = view.absorbed.filter(a => a.user >= action.fromUser);
      if (!back.length) return view;
      const gone = new Set(back.map(a => a.hint));
      return { ...view, absorbed: view.absorbed.filter(a => a.user < action.fromUser), fading: view.fading.filter(f => !gone.has(f.hint)), show: 'in', run: view.run + 1, restored: false };
    }
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
  if (view.show === 'in' && anim === 'fade') groupStyle.animation = `szHintFadeIn ${inMs}ms linear`;
  // 没收的提示笔画在一张 canvas 上；每一笔刚被收掉的提示笔各占一张（260ms 淡出后卸掉）——被收掉的那一笔与其余提示笔互不影响。
  return html`<div class="sz-hint" data-testid=${testid} data-state=${fading.length ? 'fading' : 'shown'} data-from=${from}
    data-to=${to} data-anim=${anim} data-run=${view.run} data-remaining=${remaining.join(',')} data-fading=${fading.map(f => f.hint).join(',')} aria-hidden="true">
    <div class="sz-hint__group" key=${`g${view.run}`} style=${groupStyle}>
      <${GlyphWash} data=${data} solid=${remaining} fillTestid="write-hint-fill" />
      ${fading.map(f => html`<div class="sz-hint__out" key=${`o${f.hint}`} data-testid="write-hint-out" data-stroke=${f.hint}
        style=${{ animation: `szHintOut ${outMs}ms linear forwards` }}>
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
    clearTimers();
    clearedRef.current = false;
    dispatch({ type: 'hint', range });
    if (typeof onHinted === 'function') onHinted(); // 写字页：跳过的撤销机会到此结束（G3）
    // 写入失败不阻断（P52 同口径）：提示照常显示，本地 used 已 +1，下次写入带上。
    doCommit('hint', { hints: used + 1, hintRange: { from: range.from, to: range.to } });
  }

  // 写过哪笔收哪笔（D53 ⑧）：本人笔数在回忆阶段 +1（抬笔）→ 收掉与它匹配的那一笔提示（只那一笔淡出）；笔数减少（撤销 / 清空）→ 被收掉的提示笔回来。
  // 换字 / 换阶段只重置计数，不收。
  useLayoutEffect(() => {
    const key = `${cardKey}|${phase}`;
    const prev = countRef.current;
    countRef.current = { key, count: written };
    if (prev.key !== key || phase !== 'recall' || answerSeen) return;
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
    onHint,
    lastCommit: lastCommitRef.current,
  };
}
