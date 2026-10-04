// 判断页（compare）与判断 commit（M1-5；决定-D03 / D07 / D19 / D20；01 §3.2 / §3.3 / §4 / §5 / §6.6；04 R-W09 / R-W16 /
// R-W17；原型 ShiziWriteScreen L87–L100、L128–L134、L453–L463、L603–L616；reference/I-proto-write.md「判断页」「推进」）。
//
// 流程（01 §3.3：recall →「写好了」→ compare → 判断 → 下一字）：
//   1. 回忆阶段书写格有本人笔画时「写好了」可点（空格子 disabled + aria-disabled，01 §6.6）→ 进 compare。
//      进 / 出 compare 是会话现场写入（phase + 原始笔画，core/ink-math encodeRawStrokes），按 P52 **不阻断**：
//      写失败时本页照样切换（本地阶段覆盖），判断时由判断 commit 的三段式兜底。
//   2. 判断页（D46 ⑪、D49 减法修稿；实现交接 §9）：书写格位置换成上下两格——本人书写在上、参考字形在下，共用一条 1pt 格线，与书写格同一顶边、同一中线；
//      页头左「‹」（与写字页同一个图标，读屏名「接着写」，回书写格、墨不变）/ 中「写对了吗？」/ 右计数；题面与写字页完全相同、目标格不显示答案
//      （答案只在参考格出现一次）；没有旁注（「你的书写 / 参考字形」只留读屏名称）、没有说明句；两键「写错了」左、「写对了」右放在主操作行
//      （同一个组件同一组类名，同样式同尺寸同字重），文字行留空（保持行位与写字页相同）；无 autofocus、无 aria-pressed、无预选；
//      对照区没有任何判定着色 / 判定类名（决定-D03）。边长 S 见 layout.js judgePairSize（无旁注，宽度只受页边限制）；AX 档按「上下排 / 并排」取格子更大的
//      一种（judgeAxLayout，D49 ⑧），按钮纵排。没有本人笔画时上格「这次没写」（R-W17；01 §3.3 compare 且笔画为空按 recall 处理，正常流程到不了）。
//      进判断页时焦点移到页标题（不落在任何判断键上）。
//   3. 判断 = 一次 store.commit（D07：成功才推进）：judged 记录（help 照实：hints = max(本地, 已存)）+ FSRS
//      （core/fsrs.applyJudgment，评级按 policy.ratingWithHint，P34）+ 会话推进（items[].fsrsBefore 供本会话更正重放，
//      结果行 {kind:'record'}）+ 墨迹（policy.features.perRecordInk 为 true 时按记录月份写 shizi.v2.ink.<月>；
//      false 时不写 ink 键，记录即「有记录无笔迹」，10.12）+ 墨迹留存（决定-D27：这个字只留第一次与最近一次判断的墨迹，
//      上一次的「最近一次」若不是第一次，其墨迹在同一次提交里回收，store/budget.js pruneInkOfCards）。commit 前再断言有本人笔画：空笔画直接拒绝，不调用 commit。
//      失败留在判断页：两键上方出现「没保存上，你写的字还在。」、两键换成 [先不保存 / 再试一次]（R-W16 三段式）；
//      重试成功才推进；commit 是原子事务，失败不留半条记录，重试不重复计数。
//   同一会话同一字已有 judged 记录（中断恢复路径）时不再新增记录、不再评级，只补推进（D07 不重复计数）。
//   4. 纸上写的这一字（阶段 1 P1-E8，D46 ⑬；write/paper.js）：「写好了」不要求笔画，进判断页时写 current.paper=true；对照区只有参考字形、
//      放到书写格大小（PaperCompareStage）；判断记 source:'paper'、不写墨迹，判断 / FSRS / 推进 / 结果行照常。
//
// 规则：只经 store.commit 写存储；记录用 core/records.makeRecord，会话用 core/sessions，调度用 core/fsrs。
//
// data-testid：write-compare（对照区）、write-compare-mine / write-compare-ref（两张卡，role=img）、write-compare-noink
//   （「这次没写」）、write-judge-foot（按钮行：两键 + 留空的文字行，data-failed）、write-judge-note（只在保存失败时出现的失败句，aria-live）、
//   write-judge-wrong / write-judge-correct（判断两键）、write-judge-fail-cancel / write-judge-fail-retry（失败两键）、
//   write-continue（左上「‹」，读屏名「接着写」）。

import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../../vendor/ui.js';
import { Button, markStateChange } from '../../components/Button.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { BACK_ICON } from '../../components/Page.js';
import { useNearViewport } from '../../components/near.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore, setInk } from '../../../store/store.js';
import { pruneInkOfCards } from '../../../store/budget.js';
import { makeRecord, isJudged, JUDGMENTS } from '../../../core/records.js';
import { advance, currentCardKey, withCurrent } from '../../../core/sessions.js';
import { applyJudgment } from '../../../core/fsrs.js';
import { buildStroke, encodeInk, encodeRawStrokes, GRID, INK } from '../../../core/ink-math.js';
import { paintBrushStroke } from '../../canvas/brush.js';
import { drawGlyph, glyphColor } from '../../canvas/glyph.js';
import { GlyphFallback } from './glyph-fallback.js';
import { allRecords, appendRecordToDraft } from './answer.js';
import { pyOf, refCardLabel } from './ref-label.js';

/** 判断两键的出现与就绪（P227，时刻编排 M1）：0–320ms 不显示，320ms 起 60% 且不可点，440ms 变实可点（取代看不见的 0.4s 防连点）；减少动态效果下 150ms 起可点、不淡入。 */
export const JUDGE_SHOW_MS = 320;
export const JUDGE_READY_MS = 440;
export const JUDGE_READY_REDUCED_MS = 150;

function prefersReducedMotionNow() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    return false;
  }
}

/** 判断两键的顺序：写错了左、写对了右（决定-D20 / R-W09）。 */
export const JUDGE_ORDER = Object.freeze(['wrong', 'correct']);
// 边长公式与常量在 layout.js（纯函数）；这里转出，保持原导入路径可用。
export { judgePairSize, judgeAxLayout, COMPARE_GAP, JUDGE_MIN } from './layout.js';
import { COMPARE_GAP } from './layout.js';
import { minInkScale } from '../../../core/images/layout.js';

const COPY_KEYS = Object.freeze({
  wrong: 'R-W09.btnWrong',
  correct: 'R-W09.btnCorrect',
});

injectStyles('write-compare', `
@keyframes szCmpIn{from{opacity:0}to{opacity:1}}
@keyframes szJudgeWait{0%,72.7%{opacity:0}77.3%,99.9%{opacity:.6}100%{opacity:1}}
.sz-compare{box-sizing:border-box;max-width:100%;margin:0 auto;display:flex;flex-direction:column;align-items:stretch}
.sz-compare[data-layout="side"]{flex-direction:row;gap:${COMPARE_GAP}px}
.sz-compare__row{position:relative;min-width:0;flex:1 1 0}
.sz-compare__row--ref{margin-top:calc(-1 * ${T.frameW});animation:szCmpIn .2s linear .16s both}
.sz-compare[data-layout="side"] .sz-compare__row--ref{margin-top:0}
.sz-compare__card{position:relative;aspect-ratio:1/1;box-sizing:border-box;border:${T.frameW} solid ${T.frame};border-radius:${T.rWork};
  ${TEX};overflow:hidden}
.sz-compare__card canvas{position:absolute;left:0;top:0;display:block}
.sz-compare__empty{aspect-ratio:1/1;box-sizing:border-box;border:${T.frameW} dashed ${T.frame};border-radius:${T.rWork};display:grid;
  place-items:center;font-size:${T.fs13};color:${T.ink3};text-align:center;padding:8px}
.sz-compare__label{text-align:center;font-size:${T.fs13};color:${T.ink3}}
.sz-compare__paperaside{margin:0;min-height:40px;display:flex;align-items:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-align:left}
.sz-judge__note{margin:0 0 6px;width:100%;text-align:center;font-size:${T.fs15};line-height:${T.lh15};
  color:${T.ink2}}
.sz-judge__btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-judge__btns[data-ready="false"]{animation:szJudgeWait 440ms linear both;pointer-events:none}
@media (prefers-reduced-motion: reduce){.sz-judge__btns[data-ready]{animation:none}.sz-compare__row--ref{animation:none}}
.sz-judge__btn{width:100%;min-height:${T.btnH};border-radius:${T.rCtl};background:transparent;box-shadow:inset 0 0 0 1px ${T.ink4};color:${T.ink1};
  font-size:${T.fs17};line-height:${T.lh17s};font-weight:500}
.sz-judge__btn[data-pressed]{background:${T.field};filter:none}
.sz-judge__fail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-cmpstage{display:flex;flex-direction:column;align-items:stretch;max-width:100%}
.sz-write__links--ghost{visibility:hidden}
`);

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
  return Math.max(0, Math.min(2, v));
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
 * @param {boolean} [o.paper]  在纸上写的这一字（阶段 1 P1-E8，D46 ⑬）：不要求本人笔画，记录 source:'paper'、不写墨迹，其余照常
 * @returns {{record, reused:boolean, inkWritten:boolean, inkRecycled:Array<{id, month, recordId}>}}
 */
export function judgeInDraft(draft, o) {
  const { slot, cardKey, judgment, strokes, at, nextId } = o;
  const paper = o.paper === true;
  const policy = o.policy || defaultPolicy;
  if (!JUDGMENTS.includes(judgment)) throw new RangeError('judge: judgment must be correct or wrong');
  if (!paper && !hasInk(strokes)) throw new RangeError('judge: no strokes of the learner');
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
    source: paper ? 'paper' : undefined,
  });
  appendRecordToDraft(draft, record);
  let inkWritten = false;
  // 纸上记录 ink = null：不写墨迹（判断、FSRS、会话推进照常）；D27 留存不让它占「最近一次」（store/budget.js indexRecords）。
  if (!paper && inkEnabled(o)) {
    const built = strokes.filter(x => Array.isArray(x) && x.length).map(raw => buildStroke(raw, { final: true }));
    setInk(draft, record, encodeInk(built, { policy }));
    inkWritten = true;
  }
  // D27：新判断成了「最近一次」，上一次的最近一次（不是第一次时）墨迹回收；第一次与这一次留下。
  const inkRecycled = pruneInkOfCards(draft, [cardKey]);
  const entry = draft.sched ? draft.sched[cardKey] : undefined;
  const { entry: nextEntry, fsrsBefore } = applyJudgment(entry, record, { policy });
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
export function commitJudgment(store, { slot, cardKey, judgment, strokes, hints = 0, perRecordInk, policy, paper = false } = {}) {
  if (!paper && !hasInk(strokes)) return EMPTY;
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return STALE;
  let out = null;
  const result = store.commit('write:judge', (draft, ctx) => {
    out = judgeInDraft(draft, { slot, cardKey, judgment, strokes, hints, at: ctx.now, nextId: ctx.nextId, perRecordInk, policy, paper });
  });
  return result && result.ok && out ? { ...result, record: out.record, reused: out.reused } : result;
}

/**
 * 进 / 出判断页的会话现场写入（phase；进判断页时连同原始笔画）。按 P52 不阻断：返回 commit 结果，调用方可忽略失败。
 * paper（P1-E8）：纸上写的这一字进判断页——不带笔画，把 current.paper=true 一并写下（刷新后仍是纸上的判断页）。
 */
export function commitComparePhase(store, { slot, cardKey, phase, strokes, paper = false }) {
  if (phase !== 'compare' && phase !== 'recall') throw new RangeError('commitComparePhase: compare or recall only');
  const s = sessionOf(store.getState(), slot);
  if (!s || currentCardKey(s) !== cardKey) return STALE;
  return store.commit(`write:${phase === 'compare' ? 'compare' : 'continue'}`, (draft, ctx) => {
    const cur = sessionOf(draft, slot);
    if (!cur || currentCardKey(cur) !== cardKey) throw new Error('compare phase: not the current card');
    const patch = { phase };
    if (phase === 'compare' && paper) patch.paper = true;
    else if (phase === 'compare' && Array.isArray(strokes)) patch.strokes = encodeRawStrokes(strokes);
    setSession(draft, slot, withCurrent(cur, patch, ctx.now));
  });
}

// ---------------------------------------------------------------- 小工具

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 深浅色变化计数（matchMedia 与 data-theme）；canvas 颜色在绘制时读，变化后重画。 */
export function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setVersion(v => v + 1);
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    } catch (error) {
      mq = null;
    }
    if (mq && mq.addEventListener) mq.addEventListener('change', bump);
    let observer = null;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(bump);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => {
      if (mq && mq.removeEventListener) mq.removeEventListener('change', bump);
      if (observer) observer.disconnect();
    };
  }, []);
  return version;
}

/** 元素的 CSS 边长（clientWidth），随尺寸变化更新。 */
function useBoxSize(ref, fallback) {
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setSize(prev => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    read();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return size;
}

// 视口附近才画（M6-3，61-perf）：实现在 components/near.js，作品格与练习字字形组件也用它。
export { useNearViewport };

function prepareCanvas(canvas, cssSize) {
  const dpr = Math.max(1, Math.min(4, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const px = Math.max(1, Math.round(cssSize * dpr));
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = px / GRID; // 按书写格内部 345 单位画（01 §6.1）
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}

function inkColor(el) {
  try {
    const v = getComputedStyle(el).getPropertyValue('--hand').trim();
    return v || '#221D19';
  } catch (error) {
    return '#221D19';
  }
}

/** 原始笔画 → 管线点列（绝对宽 w，345 空间）。 */
export function builtFromRaw(strokes) {
  return (strokes || []).filter(s => Array.isArray(s) && s.length).map(raw => buildStroke(raw, { final: true }));
}

/**
 * 把管线点列画进一张小卡。线宽与写字格同一视觉粗细：笔迹在 345 单位坐标里保持原宽、随显示尺寸等比缩放（R2-R1 / V2-03：不再统一加粗 1.41 倍），
 * 只有小到笔画细于最小物理线宽的卡，调用方传 widthScale（layout.js minInkScale）。纯绘制，调用方给 ctx（已按 345 单位变换）。
 * @returns {number} 画了几笔
 */
export function paintMini(ctx, built, { color = '#221D19', widthScale = 1, base = INK.base } = {}) {
  let n = 0;
  for (const pts of built || []) {
    if (!Array.isArray(pts) || !pts.length) continue;
    const scaled = pts.map(p => ({ ...p, w: (Number.isFinite(p.w) ? p.w : base) * widthScale }));
    if (paintBrushStroke(ctx, scaled, { color, base: base * widthScale, detail: false })) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------- 组件

/**
 * 本人笔迹小卡（对照卡、修改判断弹层共用）。points：管线点列（绝对宽）；缺省由 strokes（原始笔画）现算。
 * 没有笔画时渲染 placeholder（调用方给文案；缺省 R-W17「这次没写」）。
 */
export function InkMini({ strokes = null, points = null, testid, emptyText, emptyTestid, label }) {
  const cardRef = useRef(null);
  const canvasRef = useRef(null);
  const size = useBoxSize(cardRef, 0);
  const near = useNearViewport(cardRef);
  const theme = useThemeVersion();
  const built = useMemo(() => points || builtFromRaw(strokes), [points, strokes]);
  const has = built.some(p => Array.isArray(p) && p.length);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !has || !(size > 0) || !near) return;
    const ctx = prepareCanvas(canvas, size);
    paintMini(ctx, built, { color: inkColor(cardRef.current), widthScale: minInkScale(size) });
    canvas.dataset.painted = 'true'; // M6-3：61-perf 首屏计时的就绪标记
  }, [size, theme, has, points, strokes, near]);
  if (!has) {
    return html`<div class="sz-compare__empty" data-testid=${emptyTestid || 'write-compare-noink'}>${emptyText || t('R-W17.noInk')}</div>`;
  }
  return html`<div class="sz-compare__card" ref=${cardRef} data-testid=${testid} role="img" aria-label=${label}>
    <canvas ref=${canvasRef} aria-hidden="true"></canvas>
  </div>`;
}

/**
 * 参考字形小卡：有笔顺数据时 Path2D（--ref），取不到时（10.13）楷体整字 DOM 文本；加载中留空卡。
 * @param {{char:string, strokeData:{status:string, data:any}}} props
 */
export function RefMini({ char, strokeData, testid, label }) {
  const cardRef = useRef(null);
  const canvasRef = useRef(null);
  const size = useBoxSize(cardRef, 0);
  const theme = useThemeVersion();
  const status = strokeData ? strokeData.status : 'loading';
  const data = strokeData && strokeData.status === 'ready' ? strokeData.data : null;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(size > 0)) return;
    const ctx = prepareCanvas(canvas, size);
    if (data) drawGlyph(ctx, data, { color: glyphColor('--ref') });
  }, [size, theme, data]);
  return html`<div class="sz-compare__card" ref=${cardRef} data-testid=${testid} data-state=${status} role="img" aria-label=${label}>
    <canvas ref=${canvasRef} aria-hidden="true"></canvas>
    ${status === 'missing' && size > 0 ? html`<${GlyphFallback} char=${char} variant="reference" size=${size} />` : null}
  </div>`;
}

/** 本人卡的读屏名称「你的书写，5 笔」（A9）；没有笔画时退回「你的书写」。 */
export function mineCardLabel(strokes) {
  const n = (Array.isArray(strokes) ? strokes : []).filter(s => Array.isArray(s) && s.length).length;
  return n > 0 ? t('R-W09.mineCardLabel', { n }) : t('R-W09.labelMine');
}

export { refCardLabel };

/**
 * 对照区（D46 ⑪、D49）：上格「你的书写」、下格「参考字形」，共用一条格线，居中（与书写格同一顶边、同一中线）；没有旁注，读屏名称是两张卡的 aria-label。
 * 没有任何判定着色 / 判定类名（决定-D03）。py = 本题读音（读屏名称用）。size = 每格边长（layout.js judgePairSize / judgeAxLayout）。
 * layout='side'（AX 档、并排能让两格更大时，D49 ⑧）：左 = 你的书写、右 = 参考字形，间距 12，整体宽 2S + 12。
 */
export function CompareStage({ char, py = '', strokes, strokeData, size = 234, layout = 'stack' }) {
  const side = layout === 'side';
  return html`<div class="sz-compare" data-testid="write-compare" data-size=${size} data-layout=${side ? 'side' : 'stack'}
    style=${{ width: `${side ? 2 * size + COMPARE_GAP : size}px` }}>
    <div class="sz-compare__row sz-compare__row--mine">
      <${InkMini} strokes=${strokes} testid="write-compare-mine" label=${mineCardLabel(strokes)} />
    </div>
    <div class="sz-compare__row sz-compare__row--ref">
      <${RefMini} char=${char} strokeData=${strokeData} testid="write-compare-ref" label=${refCardLabel({ char, py, strokeData })} />
    </div>
  </div>`;
}

/**
 * 纸上写的这一字的对照区（阶段 1 P1-E8，D46 ⑬；实现交接 §10.2）：没有本人书写，只有参考字形，放到书写格大小（size = 书写格边长），
 * 格下说明位「和你纸上的字对照」（13 墨三）；读屏先读「你的书写：写在纸上」（§9.5），再读参考字形。
 */
export function PaperCompareStage({ char, py = '', strokeData, size = 345 }) {
  return html`<div class="sz-compare sz-compare--paper" data-testid="write-compare" data-paper="true" data-size=${size}
    style=${{ width: `${size}px` }}>
    <span class="sr-only" data-testid="write-compare-paper">${t('X-JUDGE.paperMineLabel')}</span>
    <${RefMini} char=${char} strokeData=${strokeData} testid="write-compare-ref" label=${refCardLabel({ char, py, strokeData })} />
    <p class="sz-compare__paperaside" data-testid="write-compare-aside-ref" aria-hidden="true">${t('X-JUDGE.paperRefAside')}</p>
  </div>`;
}

/**
 * 判断两键：同一组件同一组类名（同样式、同尺寸、同字重），不带 aria-pressed / autofocus / 任何判定修饰（决定-D03）。
 * 纯视图（无 hook），单测直接调用。
 */
export function JudgeButtons({ onJudge, ready = true, guard = true }) {
  return html`<div class="sz-judge__btns" data-ready=${ready ? 'true' : 'false'}>${JUDGE_ORDER.map(j => html`<${Button} key=${j} variant="plain" class="sz-judge__btn"
    data-testid=${`write-judge-${j}`} guard=${guard} onClick=${() => ready && onJudge && onJudge(j)}>${t(COPY_KEYS[j])}</${Button}>`)}</div>`;
}

/**
 * 判断区（按钮行）：两键 + 留空的文字行（保持行位与写字页相同，D49）；保存失败时两键上方出现「没保存上，你写的字还在。」、
 * 两键换成 [先不保存 / 再试一次]。纯视图。
 */
export function JudgeFooter({ failed = false, onJudge, onRetry, onCancelFail, ready = true, guard = true }) {
  const body = failed
    ? html`<div class="sz-judge__fail">
        <${Button} variant="secondary" data-testid="write-judge-fail-cancel" onClick=${onCancelFail}>${t('R-W16.cancel')}</${Button}>
        <${Button} variant="primary" data-testid="write-judge-fail-retry" onClick=${onRetry}>${t('R-W16.retry')}</${Button}>
      </div>`
    : html`<${JudgeButtons} onJudge=${onJudge} ready=${ready} guard=${guard} />`;
  return html`<div class="sz-write__foot sz-write__foot--judge" data-testid="write-judge-foot" data-failed=${failed ? 'true' : 'false'}>
    ${failed ? html`<p class="sz-judge__note" data-testid="write-judge-note" aria-live="polite">${t('R-W16.saveFailed')}</p>` : null}
    ${body}
    <div class="sz-write__links sz-write__links--ghost" aria-hidden="true"></div>
  </div>`;
}

/** 左上「‹」（与写字页同一个图标，读屏名「接着写」：R-W09.continueWriting；D49）。 */
export function ContinueButton({ onClick }) {
  return html`<${Button} variant="icon" data-testid="write-continue" aria-label=${t('R-W09.continueWriting')} onClick=${onClick}>${BACK_ICON()}</${Button}>`;
}

// ---------------------------------------------------------------- 写字页接线

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

/**
 * 判断页的阶段：store 里的 phase 加本地覆盖（进 / 出判断页的写入按 P52 不阻断，写失败时本页照样切换）。
 * compare 且没有本人笔画 → 按 recall 处理（01 §3.3；也挡住注入的空笔画判断页）；纸上写的这一字（paper，P1-E8）不要求笔画。
 * @returns {{phase, enter(strokes), leave()}}
 */
export function useComparePhase({ slot, session, cardKey, storedPhase, strokeCount, paper = false }) {
  const [local, setLocal] = useState(null); // {key, phase}
  const key = session && cardKey ? `${session.id}|${session.cursor}|${cardKey}` : null;
  let phase = storedPhase;
  if (local && local.key === key && (storedPhase === 'recall' || storedPhase === 'compare')) phase = local.phase;
  if (phase === 'compare' && !(strokeCount > 0) && !paper) phase = 'recall';
  const persist = (p, strokes) => {
    const store = storeOrNull();
    if (!store || !cardKey) return;
    commitComparePhase(store, { slot, cardKey, phase: p, strokes, paper }); // P52：失败不阻断
  };
  return {
    phase,
    enter(strokes) {
      if (!key || (!paper && !hasInk(strokes))) return;
      setLocal({ key, phase: 'compare' });
      persist('compare', strokes);
    },
    leave() {
      if (!key) return;
      setLocal({ key, phase: 'recall' });
      persist('recall');
    },
  };
}

/**
 * 写字页的判断页接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session
 * @param {string|null} o.cardKey
 * @param {string|null} o.char
 * @param {string} o.phase        有效阶段（useComparePhase 的结果）
 * @param {Array} o.strokes       本人原始笔画（写字页本地现场）
 * @param {number} o.hints        本地提示次数（useHint().used）
 * @param {object} o.strokeData   useStrokeData(char) 的结果（写字页只开一路 watch）
 * @param {() => void} o.onLeave  「接着写」
 * @param {number} [o.size=234]  每格边长（layout.js judgePairSize / judgeAxLayout，经 useWriteLayout 的 pair.s）
 * @param {'stack'|'side'} [o.layout='stack']  上下排 / 并排（AX 档，pair.layout）
 * @param {boolean} [o.paper=false]  在纸上写的这一字（P1-E8）：只有参考字形、放到书写格大小（paperSize），判断记 source:'paper'
 * @param {number} [o.paperSize]  纸上判断页参考字形的边长（= 书写格边长）
 * @returns {{active, stage, footer, lead}}  stage = 上下两格（替代书写格）；footer = 两键 + 留空的文字行（进页底栏，替代写字页底栏）
 */
export function useCompareFlow({ slot, session, cardKey, char, phase, strokes, hints = 0, strokeData, onLeave, size = 234, layout = 'stack', paper = false, paperSize }) {
  const active = !!cardKey && phase === 'compare';
  const [fail, setFail] = useState(null); // {key, judgment}
  const key = session && cardKey ? `${session.id}|${session.cursor}|${cardKey}` : null;
  const failNow = fail && fail.key === key ? fail : null;
  const wasActive = useRef(false);

  // 判断两键的就绪（P227）：进判断页 440ms 后才可点（看得见的就绪，取代看不见的 0.4s）；减少动态效果 150ms。离开判断页就重置，回来重新计。
  const [readyKey, setReadyKey] = useState(null);
  const reducedNow = prefersReducedMotionNow();
  useEffect(() => {
    if (!active) {
      setReadyKey(null);
      return undefined;
    }
    const id = setTimeout(() => setReadyKey(key), prefersReducedMotionNow() ? JUDGE_READY_REDUCED_MS : JUDGE_READY_MS);
    return () => clearTimeout(id);
  }, [active, key]);
  const ready = active && readyKey === key;

  // 进判断页：焦点移到页标题（不落在判断键上，决定-D03；读屏先读到「对照一下，写对了吗？」）。
  useLayoutEffect(() => {
    if (active && !wasActive.current && typeof document !== 'undefined') {
      const stage = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare"]');
      const page = stage && stage.closest ? stage.closest('.sz-page') : null;
      const title = page ? page.querySelector('[data-page-title]') : null;
      if (title && typeof title.focus === 'function') title.focus({ preventScroll: true });
      else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    wasActive.current = active;
  }, [active]);

  const judge = judgment => {
    const store = storeOrNull();
    const result = store
      ? commitJudgment(store, { slot, cardKey, judgment, strokes, hints, paper })
      : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok) {
      setFail(null);
      if (result.record && !paper) rememberInk(result.record.id, strokes);
      return;
    }
    if (result.error && (result.error.kind === 'stale' || result.error.kind === 'empty-strokes')) {
      setFail(null);
      return;
    }
    setFail({ key, judgment });
    markStateChange(); // 失败态是新状态：按钮 0.4s 不响应（走查-W08）
  };

  if (!active) return { active: false, stage: null, footer: null, lead: null };

  // D46 ⑪、D49：对照区只有上下两格（AX 档可能并排），占书写格的位置；两键进页底栏（与写字页「写好了」同一行位置）。
  const stage = html`<div class="sz-cmpstage">
    ${paper
    ? html`<${PaperCompareStage} char=${char} py=${pyOf(cardKey)} strokeData=${strokeData} size=${paperSize || size} />`
    : html`<${CompareStage} char=${char} py=${pyOf(cardKey)} strokes=${strokes} strokeData=${strokeData} size=${size} layout=${layout} />`}
  </div>`;
  const footer = html`<${JudgeFooter} failed=${!!failNow} onJudge=${judge} ready=${ready} guard=${!reducedNow}
      onRetry=${() => failNow && judge(failNow.judgment)} onCancelFail=${() => { setFail(null); markStateChange(); }} />`;
  const lead = html`<${ContinueButton} onClick=${() => { setFail(null); if (onLeave) onLeave(); }} />`;
  return { active: true, stage, footer, lead };
}
