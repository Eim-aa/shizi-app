// 提示的纯模型与现场写入（D64 ①；01 §6.4）。B2.1 先挪来提交函数（applyHintToDraft / commitHint），B2.2 把纯模型（来源判定、planHint、
// 按钮 / 说明模型、视图状态机、写过哪笔收哪笔的匹配、时间线）也从 src/ui/screens/write/hint-layer.js 原样挪来（行为不变，原导入路径照旧转出），
// 并抽出「点一次提示」的一步：hintStep（纯函数）+ commitHintStep（写入）——网页写字页 useHint.onHint 与写字会话 API 的 hint op 调用同一对函数，
// 所以两条路径的记录逐字段一致（test/ui/native-write.test.mjs）。
// 提示给完整个字时记为看过答案走 answer.js commitAnswerSeen（stay），与看答案同一口径（D64 ①）。
// 画法、组件与 hook（HintLayer / HintButton / HintNote / useHint / useStrokeData）留在 ui/（界面那一半）。

import { currentCardKey, withCurrent } from '../../core/sessions.js';
import { nextHintRange, hintButtonState, hintButtonCopy, hintsAllGiven } from '../../core/hints.js';
import * as defaultPolicy from '../../config/policy.js';
import { t } from '../../config/copy/index.js';
import { M } from '../../config/motion.js';
import { commitAnswerSeen } from './answer.js';

// ---------------------------------------------------------------- 常量（原型 L505–L510 / 01 §6.4）
// 节奏里的过渡值（单笔时长上限、错开系数、减少动态效果的淡化时长）在 policy.motion（P70，待设计走查）；
// strokeDrawMs / hintTimeline 可传 motion 覆盖。其余是原型 / 01 §6.4 的工程常量。

export const HINT_DRAW = Object.freeze({
  minMs: M.dur.fade, // D58 归并：原型的 110 → motion.duration.fade（阶段 2 原生逐笔写出的基准；网页阶段整组淡入）
  maxMs: defaultPolicy.motion.hintStrokeMs,
  stagger: defaultPolicy.motion.hintStagger,
  opacity: 1, // 整组的显隐不透明度；淡朱实填本身不透明（对比度见 test/ui/contrast.test.mjs「提示」）
});
/** 提示整组淡入（P210；D51 ⑧ 网页阶段的最小过渡）。 */
export const HINT_FADE_IN_MS = defaultPolicy.motion.hintFadeInMs;
/** 被本人笔收掉的那一笔提示的淡出时长（01 §6.4；D53 ⑧：只收写过的那一笔）。 */
export const HINT_FADE_OUT_MS = M.role.hintStrokeOut;
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
export function planHint({ source, used = 0, written = 0 }) {
  if (!source || source.status !== 'ready') return null;
  const at = u => nextHintRange({ totalStrokes: source.totalStrokes, used: u, hasStrokeData: source.hasStrokeData, hasGroups: source.hasGroups });
  let r = at(used);
  if (!r) return null;
  // 这一段已经全被本人写过了（先写了几笔才点提示）：点一下什么都看不到，白烧一次——顺延到下一段，跳过的段也算已给出（次数照推：used 加上 skip）。最后一段不再顺延。
  let skip = 0;
  for (;;) {
    if (r.from + r.count > written) break;
    const n = at(used + skip + 1);
    if (!n) break;
    r = n;
    skip += 1;
  }
  return { from: r.from, to: r.from + r.count, count: r.count, index: r.index, skip };
}

/**
 * 提示按钮模型。
 * @returns {{kind:'hidden'} | {kind:'unavailable', label} | {kind:'loading'|'available'|'exhausted', label, disabled, remaining}}
 */
export function hintButtonModel({ phase = 'recall', status, used = 0, answerSeen = false, source = null } = {}) {
  const total = source && source.status === 'ready' ? source.totalStrokes : 0;
  const hasGroups = source ? source.hasGroups : true;
  // 看过答案后不显示；唯一的例外是提示整字给完时记的看过答案（按钮留着，不可点，读屏「提示已用完」）
  const done = hintsAllGiven({ totalStrokes: total, used, hasStrokeData: status !== 'missing', hasGroups });
  if (phase !== 'recall' || (answerSeen && !done)) return { kind: 'hidden' };
  const st = hintButtonState({ used, hasStrokeData: status !== 'missing', totalStrokes: total, hasGroups });
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

/** 新一段提示是不是紧接着现有范围（D64 ①：接在已给出的最后一笔之后）。 */
function continuesRange(prev, next) {
  return validRange(prev) && validRange(next) && prev.to <= next.from;
}

/**
 * 新一段提示并入现有范围（D64 ①）：紧接着现有范围就延长（起点不变，终点到新一段末），否则（范围已被别处清空 / 恢复现场没有范围）就是新一段本身。
 * 页面写进 sessions.current.hintRange 的就是这个合并后的范围。
 */
export function mergeHintRange(prev, next) {
  return continuesRange(prev, next) ? { from: prev.from, to: next.to } : { from: next.from, to: next.to };
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
      {
        // 在已给出的提示笔之后再多给一段（D64 ①）：被本人笔收掉的仍算已给出（不再回来）、没收的继续留着
        const keep = continuesRange(view.range, action.range);
        const absorbed = keep ? view.absorbed.slice() : [];
        // 新一段里已经被本人写过的笔（按笔顺序号，同恢复现场的推法）直接算收掉，不再画
        const w = Math.max(0, Math.trunc(Number(action.written) || 0));
        for (let u = action.range.from; u < Math.min(action.range.to, w); u += 1) if (!absorbed.some(a => a.hint === u)) absorbed.push({ user: u, hint: u });
        return { ...view, used: view.used + 1 + Math.max(0, Math.trunc(Number(action.skip) || 0)), range: mergeHintRange(view.range, action.range), absorbed, fading: keep ? view.fading : [], show: 'in', run: view.run + 1, restored: false };
      }
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

/**
 * 提示的现场写入一次 commit（label：'hint' 给出提示 / 'hint-fade' 提示笔收掉或回来）。写入失败按 P52 不阻断，调用方只记下结果。
 * 会话 / 当前字已经变了时 commit 成功但 applied = false（与 applyHintToDraft 同口径）。
 * @returns {{ok:true, applied:boolean} | {ok:false, error}}
 */
export function commitHint(store, { slot, sessionId, cardKey, hints, hintRange }, label = 'hint') {
  let applied = false;
  const result = store.commit(label, (draft, ctx) => {
    applied = applyHintToDraft(draft, { slot, sessionId, cardKey, hints, hintRange }, ctx.now);
  });
  return result && result.ok ? { ok: true, applied } : { ok: false, error: result && result.error };
}

/**
 * 笔顺笔数 → 提示来源（原生用：书写面自己读包里同一份 data/<字>.json，只把总笔数交给页面；与 hintSourceOf 同一判据）。
 * totalStrokes：正整数 = 有数据；0 = 确无数据（missing）；其余（null / undefined）= 还在加载。
 */
export function hintSourceOfCount({ totalStrokes, char, groups } = {}) {
  const n = Number(totalStrokes);
  if (Number.isInteger(n) && n > 0) {
    const g = groups === undefined ? groupsFor(char) : groups;
    return { status: 'ready', totalStrokes: n, hasStrokeData: true, hasGroups: hasGroupData(g, n) };
  }
  if (totalStrokes === 0) return { status: 'missing', totalStrokes: 0, hasStrokeData: false, hasGroups: false };
  return { status: 'loading', totalStrokes: 0, hasStrokeData: true, hasGroups: false };
}

/**
 * 点一次提示（D64 ①；纯函数）：下一段 plan（planHint，已写过的段顺延）、并入现有范围后的 hintRange、点后的次数 used、
 * 是否整字都给出（whole → 这次写入同时记为看过答案）。不能给（加载中 / 无数据 / 已用完）返回 null。
 * @param {{source:object, used?:number, written?:number, range?:{from:number,to:number}|null}} o  range：此刻本地的提示范围（视图里的，可能已被全部收掉）
 */
export function hintStep({ source, used = 0, written = 0, range = null }) {
  const plan = planHint({ source, used, written });
  if (!plan) return null;
  const usedNow = used + 1 + plan.skip;
  const whole = hintsAllGiven({ totalStrokes: source.totalStrokes, used: usedNow, hasStrokeData: source.hasStrokeData, hasGroups: source.hasGroups });
  return { plan, used: usedNow, hintRange: mergeHintRange(range, plan), whole };
}

/**
 * 一次提示的写入（P52：失败不阻断，调用方照常显示提示、本地次数保留）：没给完 → commitHint('hint')；整字给完 → commitAnswerSeen(stay)，
 * 同一次写入记下次数与范围（与看答案同一函数、同一口径），页面留在回忆阶段。
 * @returns {{ok:true, applied:boolean} | {ok:false, error}}
 */
export function commitHintStep(store, { slot, sessionId, cardKey, step }) {
  if (!step.whole) return commitHint(store, { slot, sessionId, cardKey, hints: step.used, hintRange: step.hintRange }, 'hint');
  const r = commitAnswerSeen(store, { slot, cardKey, stay: true, hints: step.used, hintRange: step.hintRange });
  return r && r.ok ? { ok: true, applied: true } : { ok: false, error: r ? r.error : { kind: 'generic' } };
}

// ---------------------------------------------------------------- 读屏播报（从 src/ui/screens/write/sr-live.js 挪来，B2.2；行为不变）

/** 一段笔画范围的读法：「第 4 笔」「第 4 到第 5 笔」。from 从 0 起、to 不含；没有笔画名称数据，一律按笔序。 */
export function strokeRangeText(from, to) {
  const a = Math.trunc(Number(from)) + 1;
  const b = Math.trunc(Number(to));
  if (!(a >= 1) || !(b >= a)) return '';
  return a === b ? t('X-WRITE.liveRangeOne', { a }) : t('X-WRITE.liveRangeMany', { a, b });
}

/** 提示给出了 [from, to) 笔 → 播报句。 */
export function hintAnnouncement(range) {
  if (!range) return '';
  const text = strokeRangeText(range.from, range.to);
  return text ? t('X-WRITE.liveHint', { range: text }) : '';
}
