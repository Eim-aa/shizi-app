// 写字会话 API 的无 DOM 部分（B2.1；架构 docs/engineering/v10/B2-原生写字架构.md §3）：op 表、快照、笔画格式、文案字典、
// createWriteSessionApi——从 src/ui/screens/write/native-session.js 原样挪来（行为不变）。
//
// 每个 op 调用网页写字页**同一个**提交函数（write-ops.js / result-ops.js），所以规则、记录形状、FSRS、笔迹编码与网页逐字段一致
// （test/ui/native-write.test.mjs）。导航（nav.back / openResult）与颜色（getComputedStyle）属于界面，由页面侧 native-session.js 注入；
// 本模块不 import 任何 UI / DOM 模块（门禁 test/session/boundary.test.mjs），B3 末随 src/session 一起进 JavaScriptCore。

import { getStore } from '../store/store.js';
import { t } from '../config/copy/index.js';
import { canCorrect, currentCardKey, isComplete } from '../core/sessions.js';
import { charOfCardKey, isJudged, isPaperRecord } from '../core/records.js';
import { decodeInk, decodeInkRaw, encodeRawStrokes, inkParams } from '../core/ink-math.js';
import { capitalCard, cardForKey, withWordOff } from '../data/deck.js';
import { M } from '../config/motion.js';
import * as policy from '../config/policy.js';
import {
  answerInkKey, canEndGroup, commitAnswerNext, commitAnswerPhase, commitAnswerSeen, commitComparePhase, commitCorrection, commitEndGroup, commitHint, commitHintStep,
  commitFirstTipSeen, commitJudgment, commitRecover, commitSkip, commitStrokes, commitUndoSkip, endConfirmCounts, firstTipDue, hintAnnouncement, hintButtonModel,
  hintNoteModel, hintSourceOfCount, hintStep, HINT_FADE_IN_MS, HINT_FADE_OUT_MS, HINT_MATCH_MAX_DIST, PEN_ARM_MS, promptCells, REDUCED_FADE_MS,
  findRecord, recalledInk, redoCharsOf, redoQueueOf, resultRowModel, storedStrokes,
} from './write-ops.js';
import { commitFinish } from './result-ops.js';
import { createResultOps, NATIVE_RESULT_COPY_KEYS, NATIVE_RESULT_OPS } from './result-api.js';

export { NATIVE_RESULT_COPY_KEYS, NATIVE_RESULT_OPS };

/** 会话 API 的操作（B2.0 实现前 6 个，B2.2 加 hint，B2.5 加 correct，B2.4 / B2.6 加 showAnswer / answerPhase / answerNext / skip / undoSkip / end，R9-A 加 firstTip；其余在后续卡补，名称先占住，见架构文档 §3.2）。 */
export const NATIVE_WRITE_OPS = Object.freeze(['open', 'strokes', 'phase', 'judge', 'exit', 'copy', 'hint', 'correct', 'showAnswer', 'answerPhase', 'answerNext', 'skip', 'undoSkip', 'end', 'firstTip',
  // B2.9a 重写错字（只练习、不记录）
  'redoOpen', 'redoNext', 'redoExit',
  // B2.9b 读屏：参考字形的名称（判断页参考卡、描一遍的答案字，网页 ref-label.js refCardLabel 同一句；只读）
  'refLabel']);

/** 原生写字页用到的文案键（值取自 src/config/copy，原生不另存一份）。 */
export const NATIVE_WRITE_COPY_KEYS = Object.freeze([
  'R-W01.progress',
  'R-W01.progressLabel',
  'X-WRITE.firstTip',
  'R-W03.titleRecall',
  'R-W03.titleCompare',
  'R-W05.hintLabel',
  'R-W07.btnShowAnswer',
  'R-W07.btnNext',
  'R-W07.answerNote',
  'R-W07.selfNote',
  'R-W08.answerNote',
  'R-W03.titleSelf',
  'R-W04.stepTrace',
  'R-W04.stepSelf',
  'X-ANSWER.titleTrace',
  'X-ANSWER.btnTraceDone',
  'X-ANSWER.btnRetrace',
  'X-COMMON.leave',
  'R-W09.btnWrong',
  'R-W09.btnCorrect',
  'R-W09.continueWriting',
  'R-W09.labelMine',
  'R-W09.mineCardLabel',
  'R-W09.refCardLabelChar',
  'R-W09.labelReference',
  'R-W10.changeBodyCorrect',
  'R-W10.changeBodyWrong',
  'R-W10.changeFailed',
  'R-W10.retry',
  'R-W10.cancel',
  'R-D07.noInkLarge',
  'R-W17.noInk',
  'X-JUDGE.changeTitle',
  'X-JUDGE.changeToWrong',
  'X-JUDGE.changeToCorrect',
  'X-JUDGE.changeCancel',
  'X-JUDGE.paperMineBox',
  'R-W14.btnSkip',
  'R-W15.end',
  'R-W15.confirmBody',
  'R-W15.confirmBodyNone',
  'R-W15.continue',
  'R-W20.skippedToast',
  'R-W20.undo',
  'R-W16.saveFailed',
  'R-W16.retry',
  'R-W16.cancel',
  'R-W18.btnUndo',
  'R-W18.btnClear',
  'R-W29.btnDone',
  'X-COMMON.back',
  'X-PROMPT.groupLabel',
  'X-WRITE.gridLabel',
  'X-WRITE.gridLabelCount',
  // B2.9b 读屏播报（网页 sr-live.js 同一组句子）：笔数变化、描一遍出现
  'X-WRITE.liveStroke',
  'X-WRITE.liveRestored',
  'X-WRITE.liveUndo',
  'X-WRITE.liveUndoEmpty',
  'X-WRITE.liveCleared',
  'X-WRITE.liveRangeOne',
  'X-WRITE.liveRangeMany',
  'X-WRITE.liveTrace',
  'X-WRITE.liveTraceWhole',
  'X-DETAIL.viewChar',
  // B2.9a 重写错字页（D66 ③）：页名、格下说明、对照页「再写一次」、最后一个字的「完成」
  'X-REDO.title',
  'X-REDO.note',
  'X-REDO.again',
  'X-RESULT.done',
]);

// ---------------------------------------------------------------- 笔画格式

/** 网页原始笔画（每笔 [{x,y,t,p?}]）→ 桥上的紧凑数组（每笔 [[x,y,t,p?]…]）。 */
export function strokesToWire(strokes) {
  return (strokes || []).map(s => (s || []).map(p => (Number.isFinite(p.p) ? [p.x, p.y, p.t, p.p] : [p.x, p.y, p.t])));
}

/** 桥上的紧凑数组 → 网页原始笔画；坏点丢掉，空笔丢掉。 */
export function strokesFromWire(wire) {
  const out = [];
  for (const s of Array.isArray(wire) ? wire : []) {
    if (!Array.isArray(s)) continue;
    const pts = [];
    for (const q of s) {
      if (!Array.isArray(q) || q.length < 3 || !q.slice(0, 3).every(Number.isFinite)) continue;
      const pt = { x: q[0], y: q[1], t: q[2] };
      if (q.length > 3 && Number.isFinite(q[3]) && q[3] > 0) pt.p = Math.min(1, q[3]);
      pts.push(pt);
    }
    if (pts.length) out.push(pts);
  }
  return out;
}

// ---------------------------------------------------------------- 快照（纯函数）

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

// revealed：看答案 · 描一遍阶段把目标字填回空格（网页 Prompt 同一个 REVEAL_PHASES 规则；R9-A NP-03）。回忆 / 判断阶段 fill 恒为 null（D16 / D49）。
function promptOf(state, cardKey, queue, revealed = false) {
  const card = withWordOff(capitalCard(cardForKey(cardKey), queue), state ? state.wordOff : null);
  const model = promptCells(card, { revealed });
  return { cells: model.cells.map(c => ({ kind: c.kind, text: c.text, label: c.label, fill: c.fill || null })), hint: model.hint };
}

/**
 * 某槽写字会话的快照（原生渲染所需的全部只读数据）。会话没了 → {slot, active:false}；写完了 → done:true。
 * 回忆阶段答案字只出现在 char 字段（原生画参考格用），不进任何读屏名称（D16 由原生遵守）。
 */
export function writeSnapshot(state, slot) {
  const s = sessionOf(state, slot);
  if (!s) return { slot, active: false };
  const cardKey = currentCardKey(s);
  const base = {
    slot,
    active: true,
    sessionId: s.id,
    kind: s.kind,
    cursor: s.cursor,
    total: s.queue.length,
    done: isComplete(s),
  };
  if (!cardKey) return { ...base, cardKey: null };
  const raw = s.current && s.current.phase;
  const phase = raw === 'compare' ? 'compare' : 'recall';
  const strokes = storedStrokes(s, cardKey, answerInkKey(cardKey, raw));
  // B2.4：看答案流程的阶段（旧版存下的 'answer' 按描一遍，与网页 useAnswerFlow 同一规则）；phase 仍只表 recall / compare（B2.2 起的约定）
  const answerPhase = raw === 'answer' || raw === 'trace' ? 'trace' : raw === 'retrace' ? 'retrace' : null;
  return {
    ...base,
    cardKey,
    char: charOfCardKey(cardKey),
    phase: phase === 'compare' && !strokes.length ? 'recall' : phase,
    storedPhase: raw || 'recall',
    answerPhase,
    canEnd: canEndGroup(s),
    strokes: strokesToWire(strokes),
    hints: s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0,
    hintRange: s.current && s.current.hintRange ? { from: s.current.hintRange.from, to: s.current.hintRange.to } : null,
    answerSeen: !!(s.current && s.current.answerSeen),
    prompt: promptOf(state, cardKey, s.queue, answerPhase === 'trace'),
    // 首练第 1 字格下的一次性提示（网页 first-tip.js 同一个 firstTipDue；出现即经 op firstTip 记 settings.firstTipSeen，R9-A NP-02）
    firstTip: firstTipDue({ settings: state ? state.settings : null, session: s, phase: raw === 'compare' || answerPhase ? 'other' : 'recall' }),
    lastLine: s.lastLine ? { ...s.lastLine } : null,
    line: lineOf(s, state),
  };
}

/**
 * B2.9a 重写错字页（D66 ③）的快照：与 writeSnapshot 同一形状，原生写字页按 kind 'redo' 切到重写错字模式。
 * 字表与题面与网页 write/redo.js 同一组函数（redoCharsOf / redoQueueOf / promptOf = Prompt 组件的 withWordOff + capitalCard + promptCells）；
 * 只算练习：没有会话、记录、提示、结果行，笔画只在原生内存里（网页同样只在组件 state 里）。
 */
export function redoSnapshot(state, chars, index) {
  const list = Array.isArray(chars) ? chars : [];
  const total = list.length;
  const i = Math.min(Math.max(0, Math.trunc(Number(index) || 0)), Math.max(0, total - 1));
  const queue = redoQueueOf(list);
  const cardKey = queue[i] || null;
  return {
    slot: 'redo', active: true, kind: 'redo', sessionId: null, cursor: i, total, done: false,
    cardKey, char: cardKey ? charOfCardKey(cardKey) : '', last: i === total - 1,
    phase: 'recall', storedPhase: 'recall', answerPhase: null, canEnd: false, strokes: [], hints: 0, hintRange: null, answerSeen: false,
    prompt: cardKey ? promptOf(state, cardKey, queue, false) : { cells: [], hint: '' },
    firstTip: false, lastLine: null, line: { state: 'none' },
  };
}

/** 格下「上一个字」结果行（resultRowModel 同一个模型；「修改 ›」的动作由 B2.5 接，这里只给文字与能不能改）。 */
function lineOf(session, state) {
  const m = resultRowModel(session, state);
  if (!m || (m.state !== 'judged' && m.state !== 'saw')) return { state: m ? m.state : 'none' };
  return { state: m.state, kind: m.kind, recordId: m.recordId, text: m.text, action: m.action || null, canChange: !!m.canChange };
}

/**
 * 原生书写面与判断页要跟网页同步的时刻（ms，单一来源）：换字后落笔门限（P227，门限内的笔先持住、到点补画）、
 * 判断两键出现 / 可点（时刻编排 M1，motion.moment；取代看不见的 0.4s 防连点）。减少动态效果时原生直接可点（T0-3）。
 */
export function writeTiming() {
  return {
    penArmMs: PEN_ARM_MS,
    judgeAppearMs: M.moment.judgeAppear,
    judgeReadyMs: M.moment.judgeReady,
    // B2.2：换字 / 换阶段后按钮 0.4s 不响应（网页 Button.js markStateChange 同一个值，motion.timing.pressGuard）
    pressGuardMs: M.timing.pressGuard,
  };
}

/**
 * 原生写字页的动效时长（ms；单一来源 src/config/motion.js 与提示层常量，交互规范 T0 T-phase / T1）。
 * fade：T-phase 交叉淡化；textOut：文字类先出（新的在 textOut → fade 淡入）；inkFlip：回忆 → 判断本人墨纯缩放；phaseReverse：判断 → 回忆倒放；
 * reduce：减少动态效果的淡化；hintIn / hintOut：提示整组淡入、被收掉的那一笔淡出；hintReduced：减少动态效果时两者。
 * easeOut / settle：B2.5（上面第二块注释）。
 */
export function writeMotion() {
  return {
    fade: M.role.fadeIn,
    textOut: M.role.textOut,
    inkFlip: M.role.inkFlip,
    phaseReverse: M.role.phaseReverse,
    reduce: M.dur.reduce,
    hintIn: HINT_FADE_IN_MS,
    hintOut: HINT_FADE_OUT_MS,
    hintReduced: REDUCED_FADE_MS,
    // B2.5：回忆 ⇄ 判断的缓动（ease.out 控制点）与判断落定 M23（时刻 ms、离纸缩放、收进计数的方框边长 pt、gather 曲线控制点）
    easeOut: [...M.bezier.out],
    settle: {
      lift: M.moment.settleLift, fadeFrom: M.moment.settleFadeFrom, end: M.moment.settleEnd, countBox: M.moment.settleCountBox,
      liftScale: M.moment.settleLiftScale, gather: [...M.bezier.gather],
    },
    // R9-B：改判弹层（T-sheet）与「结束这组」确认框（T-confirm）的进退场、遮罩淡入淡出、下滑关闭阈值（交互规范 T0；Sheet.js / Confirm.js 同一组值）
    overlay: {
      sheetIn: M.role.sheetIn, sheetOut: M.role.sheetOut, scrimIn: M.role.scrimIn, scrimOut: M.role.scrimOut,
      confirmIn: M.role.confirmIn, confirmOut: M.role.confirmOut, confirmFrom: M.scale.confirmFrom, snap: M.role.gestureSnap,
      easeIn: [...M.bezier.in],
      directionSlop: M.gesture.directionSlop, commitRatio: M.gesture.sheetCommitRatio, commitVelocity: M.gesture.commitVelocity, returnVelocity: M.gesture.returnVelocity,
    },
    nav: writeNavMotion(),
  };
}

/**
 * B2.8：原生写字页 / 结果页进出的转场（交互规范 T0：T-push / T-paper / T-quiet、减少动态效果淡化、同一层换内容的 T-phase 淡化），
 * 与网页 root.js / paper-transition.js 同一组值（src/config/motion.js 与 policy.paperTransition）；原生 NativeWriteTransitions 只从这里取数。
 */
export function writeNavMotion() {
  const P = policy.paperTransition;
  return {
    push: { ms: M.role.pushIn, outMs: M.role.pushOut, gestureMinMs: M.role.pushGestureMin, snapMs: M.role.gestureSnap, parallax: M.distance.parallax, ease: [...M.bezier.out] },
    paper: {
      openMs: P.openMs, closeMs: P.closeMs, fullMs: P.fullMs, minFinishMs: P.minFinishMs, cancelMs: P.cancelMs, openEase: [...P.openEase], closeEase: [...P.closeEase],
      dragLeanPt: P.dragLeanPt, dragRadiusPt: P.dragRadiusPt, contentFadeFrom: P.contentFadeFrom, veilTo: P.veilTo,
    },
    quiet: { openMs: P.quietOpenMs, closeMs: P.quietCloseMs, scaleFrom: P.quietScaleFrom, dragPt: P.quietDragPt },
    reduceMs: P.reducedMs,
    phaseMs: M.dur.fade,
  };
}

/**
 * 结果页的显现与落印时刻（B2.7；result/work.js revealPlan 与 CSS 同一组值，src/config/motion.js）：cellIn 格淡入、stagger 格间错开上限、kuanIn 落款淡入、
 * sealDrop 印落下全程（含回弹）、rebound 回弹、sealFrom 印起始缩放、sealContact 着纸缩放、max 整段上限、lateIn 印落下后正文与底栏淡入、inviteDelay 邀请淡入延迟、
 * inviteIn 邀请淡入（T-push 时长，8pt 上移）。
 */
export function resultMotion() {
  return {
    cellIn: M.moment.workCellIn, stagger: M.moment.workStagger, kuanIn: M.dur.fade, sealDrop: M.moment.sealDrop, rebound: M.dur.press,
    sealFrom: M.scale.sealFrom, sealContact: 0.92, max: M.moment.max, lateIn: M.moment.resultLateIn, inviteDelay: M.moment.inviteDelay, inviteIn: M.dur.push,
  };
}

/**
 * 描一遍前笔顺快放与描红画法的参数（B2.4；glyph.js playbackPlan / drawGlyphHook 同一组值，单一来源 policy）：
 * maxMs 总时长上限（含起始淡化与笔间隔，D68 ②）、speed 动画速度、gapMs 笔间隔上限、fadeMs 起始淡化、hookWidthPt / hookWidthMoreContrastPt 双钩线宽。
 */
export function writeTrace() {
  return {
    maxMs: policy.motion.stepPlayMaxMs,
    speed: policy.motion.answerSpeed,
    gapMs: policy.motion.answerStrokeGapMs,
    fadeMs: policy.motion.answerFadeMs,
    hookWidthPt: policy.traceHook.widthPt,
    hookWidthMoreContrastPt: policy.traceHook.moreContrastPt,
  };
}

/**
 * 笔迹参数（D72 ②：原生书写面与网页同一算法 buildStroke，同一组参数）：policy.ink（P65 手感参数）+ INK_SPEC（已定规格），
 * 即 core/ink-math.js inkParams(policy) 整张表。原生 WebInk.swift 只从这里取数，不写死数值。
 */
export function writeInk() {
  return { ...inkParams(policy) };
}

/** 跳过撤销条的寿命（P115，D36）：ms、按住暂停、读屏时不自动收起（与网页 skip.js createUndoLifetime 同一组）。 */
export function writeSkipUndo() {
  return {
    ms: policy.skipUndo.ms,
    pauseWhileHeld: !!policy.skipUndo.pauseWhileHeld,
    keepOpenWithAssistiveTech: !!policy.skipUndo.keepOpenWithAssistiveTech,
  };
}

/**
 * 原生写字页的版式常量（pt；policy.writeGrid，与网页 src/ui/screens/write/layout.js 同一组值；原生按同一组公式排，01 §6.1）。
 * hintMatchMaxDist：写过哪笔收哪笔时几何匹配的上限（345 单位，hint.js HINT_MATCH_MAX_DIST）。
 */
export function writeLayoutConstants() {
  const g = policy.writeGrid;
  return {
    min: g.min,
    max: g.max,
    sideMargin: g.sideMargin,
    promptGap: g.promptGap,
    noteHeight: g.toolsHeight,
    toolRowHeight: g.toolRowHeight,
    axMin: g.axMin,
    axNoteHeight: g.axNoteHeight,
    fitGridMin: g.fitGridMin,
    promptFitMin: g.promptFitMin, // B2.9b：AX 档放不下时题面缩放下限（layout.js fitGroup，P299）
    bottomGap: g.bottomGap,
    topShare: g.topShare,
    topMin: g.topMin,
    nominalHead: g.nominalHead,
    nominalFoot: g.nominalFoot,
    footBottomMin: g.footBottomMin,
    nominalPrompt: g.nominalPrompt,
    hintMatchMaxDist: HINT_MATCH_MAX_DIST,
  };
}

export function copyBundle(keys = NATIVE_WRITE_COPY_KEYS) {
  const out = {};
  for (const k of keys) {
    try {
      out[k] = t(k);
    } catch (error) {
      // 未知键：不给（原生按缺失处理），不抛
    }
  }
  return out;
}

/**
 * 改判弹层「你的书写」的原始笔画（桥上紧凑格式）：存下的墨迹（v4 原始点；v3 / v2 旧数据取解出的点，原生按笔锋模型近似重算宽度，规格 §6.4）→
 * 本页面刚判断时记下的笔画（perRecordInk 关时）→ 没有（[]，弹层显示「这一次没有留下笔迹」）。网页弹层 result-row.js inkOfRecord 的同一个次序。
 */
export function sheetStrokes(store, record) {
  let ink = null;
  try {
    ink = store.getInk(record);
  } catch (error) {
    ink = null;
  }
  if (ink) {
    const raw = decodeInkRaw(ink);
    if (raw) return strokesToWire(raw);
    const decoded = decodeInk(ink);
    if (decoded) return strokesToWire(decoded.map(pts => pts.map(q => ({ x: q.x, y: q.y, t: q.t, p: q.p }))));
  }
  return strokesToWire(recalledInk(record.id) || []);
}

/** 这条记录此刻能不能改（结果行仍是它、且 items 里有 fsrsBefore：sessions.canCorrect，D19）。 */
function correctable(state, slot, recordId) {
  const s = sessionOf(state, slot);
  const record = findRecord(state, recordId);
  return !!(s && s.lastLine && s.lastLine.recordId === recordId && canCorrect(s, recordId) && record && isJudged(record));
}

// ---------------------------------------------------------------- 会话 API

/** 桥上的提示范围 {from, to} → 合法范围或 null。 */
function wireRange(r) {
  return r && Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 0 && r.to > r.from ? { from: r.from, to: r.to } : null;
}

function plainError(result) {
  const e = result && result.error ? result.error : {};
  return { kind: typeof e.kind === 'string' ? e.kind : 'generic', reason: typeof e.reason === 'string' ? e.reason : undefined };
}

function clock() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** 跳过撤销机会的交接（原生页离开时带来）：撤销条剩余多久 + 撤销要写回的笔画（紧凑行，与网页 useSkip 同一格式）。坏数据当没有。 */
function normalizeUndo(raw) {
  if (!raw || typeof raw.sessionId !== 'string' || typeof raw.recordId !== 'string') return null;
  const wire = strokesFromWire(raw.strokes);
  return {
    sessionId: raw.sessionId,
    recordId: raw.recordId,
    char: typeof raw.char === 'string' ? raw.char : '',
    strokes: wire.length ? encodeRawStrokes(wire) : null,
    remainingMs: Math.max(0, Number(raw.remainingMs) || 0),
  };
}

const NO_NAVIGATE = Object.freeze({
  back() {
    throw new Error('write session api: navigate.back not provided');
  },
  toResult() {
    throw new Error('write session api: navigate.toResult not provided');
  },
});

/**
 * 写字会话 API。deps 可注入（node:test 用假 store / 假导航）；导航与颜色属于界面，页面侧（native-session.js）注入网页路由与令牌计算值。
 * @param {{getStore?: () => object, navigate?: {back: (slot, undo) => void, toResult: (slot, sessionId, undo) => void, toDetail?: (slot, char) => boolean}, colors?: () => object, type?: () => object}} deps
 *   type（R9-B）：字阶的此刻计算值（pt；页面侧 native-session.js typeBundle，--fs13 / --lh13 …，随系统字号 --k 与 AX 表），原生据此排字，不另抄取值表
 * @returns {{call(op:string, args?:object): object}}  同步返回结果对象（window 全局再包成 Promise）
 */
export function createWriteSessionApi(deps = {}) {
  const storeOf = deps.getStore || getStore;
  const navigate = deps.navigate || NO_NAVIGATE;
  const colors = deps.colors || (() => ({}));
  const type = deps.type || (() => ({}));
  // B3.1：页面此刻的主题（'light' | 'dark'，含「我的 › 外观」的强制浅 / 深）。原生的颜色取 ShiziKit 生成值，按这个主题选浅 / 深一套；没注入时不给（原生跟系统）
  const theme = deps.theme || (() => undefined);
  const themeField = () => {
    const t = theme();
    return t === 'light' || t === 'dark' ? { theme: t } : {};
  };
  // B2.9b：参考字形的读屏名称（字、拼音、笔画数、结构 / 部件数）由页面侧注入（要题库读音与笔顺数据，ui/screens/write/ref-label.js）；没注入时只读字
  const refLabelOf = deps.refLabel || (({ char }) => t('R-W09.refCardLabelChar', { char }));
  // B2.7：结果页的 op（result-api.js）；页面的视图、导航、提醒权限与盖章声由页面侧注入（deps.result）
  const resultOps = createResultOps({ storeOf, strokesOf: sheetStrokes, result: deps.result || {} });

  const snapshot = slot => writeSnapshot(storeOf().getState(), slot);

  /** 这组写完了（任一路径推进到队尾）：同一次调用里 commitFinish（幂等，与网页写字页同一顺序）。 */
  function finishIfComplete(store, slot) {
    const s = sessionOf(store.getState(), slot);
    if (!s || !isComplete(s)) return null;
    const f = commitFinish(store, { slot, sessionId: s.id });
    return { ok: !!(f && f.ok), sessionId: s.id };
  }

  /** 看答案流程 / 跳过 / 结束的统一回包：失败（含 stale）也带快照，原生据此对账（D07：成功才推进，stale = 已不是这个字）。 */
  const flowFail = (slot, r) => ({ ok: false, error: plainError(r), snapshot: snapshot(slot) });

  const ops = {
    /** 打开 / 重新同步：先做恢复幂等（与网页写字页挂载时同一函数），再给快照、文案、颜色与时刻（writeTiming）。 */
    open({ slot }) {
      const store = storeOf();
      const rec = commitRecover(store, { slot });
      return {
        ok: true, recovered: !!(rec && rec.ok && !rec.noop), snapshot: snapshot(slot), copy: copyBundle(), colors: colors(), type: type(), timing: writeTiming(),
        motion: writeMotion(), layout: writeLayoutConstants(), trace: writeTrace(), skipUndo: writeSkipUndo(), ink: writeInk(), ...themeField(),
      };
    },
    /** 抬笔 / 撤销 / 清空后的现场写回（P52：不阻断，失败只回报）。 */
    strokes({ slot, cardKey, strokes, phase }) {
      const store = storeOf();
      const s = sessionOf(store.getState(), slot);
      const raw = s && s.current ? s.current.phase : 'recall';
      const r = commitStrokes(store, { slot, cardKey, inkKey: answerInkKey(cardKey, raw), strokes: strokesFromWire(strokes), phase });
      return r && r.ok ? { ok: true, noop: !!r.noop } : { ok: false, error: plainError(r) };
    },
    /** 进 / 出判断页（P52：不阻断）。 */
    phase({ slot, cardKey, phase, strokes }) {
      const r = commitComparePhase(storeOf(), { slot, cardKey, phase, strokes: phase === 'compare' ? strokesFromWire(strokes) : undefined });
      return r && r.ok ? { ok: true } : { ok: false, error: plainError(r) };
    },
    /**
     * 判断（D07：成功才推进）。与网页判断页调用同一个 commitJudgment；成功且这组写完时同一次调用里 commitFinish（幂等，与网页写字页同一顺序）。
     * 回包带新快照（下一字），原生不再多跑一趟桥。
     */
    judge({ slot, cardKey, judgment, strokes, hints = 0 }) {
      const store = storeOf();
      const r = commitJudgment(store, { slot, cardKey, judgment, strokes: strokesFromWire(strokes), hints });
      // 失败也带快照：结果未知（桥超时 / 页面重载）后重发时若上一次其实已提交，回 stale + 已推进的快照，原生据此对账，不会多记（D07）
      if (!r || !r.ok) return { ok: false, error: plainError(r), snapshot: snapshot(slot) };
      const finished = finishIfComplete(store, slot);
      return { ok: true, recordId: r.record ? r.record.id : null, reused: !!r.reused, finished, snapshot: snapshot(slot) };
    },
    /**
     * 原生页离开：to = 'back'（左上 ‹ / 左缘滑回）、'result'（写完最后一字）或 'detail'（R9-B：改判弹层「看这个字 ›」，D66 ⑮——
     * 写字条目留在栈里，字详情推入在它上面，返回回到写字页；网页 ViewCharLink 同一个 openCharDetail）。
     */
    exit({ slot, to, sessionId, undo, char }) {
      if (to === 'detail') {
        if (typeof char !== 'string' || !char || typeof navigate.toDetail !== 'function') return { ok: false, error: { kind: 'invalid' } };
        return { ok: navigate.toDetail(slot, char) !== false };
      }
      // undo（B2.6）：跳过后 5 秒撤销条还在时离开，剩余的撤销机会交给结果页 / 来源页（S4，网页 handoffSkipUndo / handoffLeaveUndo）
      const handoff = normalizeUndo(undo);
      if (to === 'result') navigate.toResult(slot, sessionId, handoff);
      else navigate.back(slot, handoff);
      return { ok: true };
    },
    /**
     * 点「看答案」（D64 ②：标准写法直接淡显、立即可描；B2.4）。与网页 useAnswerFlow.showAnswer 同一个 commitAnswerSeen：
     * answer-seen 记录 + 会话现场进描一遍（复习字当天记一次 Again，D66 ①）。回包带快照（phase 仍是 recall，answerPhase 'trace'）。
     */
    showAnswer({ slot, cardKey }) {
      const r = commitAnswerSeen(storeOf(), { slot, cardKey });
      return r && r.ok ? { ok: true, snapshot: snapshot(slot) } : flowFail(slot, r);
    },
    /**
     * 看答案流程内换阶段（trace ⇄ retrace；看过答案后的回忆阶段点「看答案」回 trace）。与网页 commitAnswerPhase 同一个：
     * 离开凭记忆写（retrace）时同一次 commit 把本人笔画存成这条 answer-seen 记录的墨迹（Q1）；笔画清空。
     */
    answerPhase({ slot, cardKey, phase, strokes }) {
      if (phase !== 'trace' && phase !== 'retrace') return { ok: false, error: { kind: 'invalid' }, snapshot: snapshot(slot) };
      const r = commitAnswerPhase(storeOf(), { slot, cardKey, phase, strokes: strokesFromWire(strokes) });
      return r && r.ok ? { ok: true, snapshot: snapshot(slot) } : flowFail(slot, r);
    },
    /** 看过答案后「下一个」（推进，不进判断页；Q1 同一次 commit 存看后自写的墨迹）。这组写完时同一次调用里 commitFinish。 */
    answerNext({ slot, cardKey, strokes }) {
      const store = storeOf();
      const r = commitAnswerNext(store, { slot, cardKey, strokes: strokesFromWire(strokes) });
      if (!r || !r.ok) return flowFail(slot, r);
      return { ok: true, finished: finishIfComplete(store, slot), snapshot: snapshot(slot) };
    },
    /**
     * 跳过（直接生效，不确认；B2.6，D68 ③）。与网页 useSkip.skip 同一个 commitSkip；成功回 undo 机会 {sessionId, recordId, char, ms}（5 秒，P115），
     * 原生据此显示「已跳过「X」· 撤销」。跳过的是最后一字时同一次调用里 commitFinish，原生把撤销机会随 exit result 交给结果页。
     */
    skip({ slot, cardKey, hints = 0 }) {
      const store = storeOf();
      const r = commitSkip(store, { slot, cardKey, hints: Math.max(0, Math.trunc(Number(hints) || 0)) });
      if (!r || !r.ok) return flowFail(slot, r);
      const finished = finishIfComplete(store, slot);
      const rec = r.record;
      return {
        ok: true, finished, snapshot: snapshot(slot),
        undo: rec ? { sessionId: rec.sessionId, recordId: rec.id, char: rec.char, ms: policy.skipUndo.ms } : null,
      };
    },
    /** 撤销跳过：删记录、字放回、提示次数与跳过时格子里的笔画写回（M2-3；strokes = 原生跳过时的本人笔画）。stale = 已不能撤销（会话变了 / 不是最后一条 skipped）。 */
    undoSkip({ slot, sessionId, recordId, strokes }) {
      const wire = strokesFromWire(strokes);
      const rows = wire.length ? encodeRawStrokes(wire) : null;
      const r = commitUndoSkip(storeOf(), { slot, sessionId, recordId, strokes: rows });
      return r && r.ok ? { ok: true, snapshot: snapshot(slot) } : flowFail(slot, r);
    },
    /**
     * 结束这组（D66 ⑥，D68 ④；B2.6）。action 'counts'：确认框的数字 {n 没写的（含当前字）, m 已判断的}；
     * 'commit'（缺省）：与网页 openEndConfirm.onEnd 同一个 commitEndGroup，成功回 judgedCount（> 0 → 原生 exit result 换成结果页；0 → exit back 回来源）。
     * 失败留在确认框（原生三段式）；stale = 会话已不是它。
     */
    end({ slot, sessionId, action = 'commit' }) {
      const store = storeOf();
      if (action === 'counts') {
        const c = endConfirmCounts(store.getState(), slot);
        return { ok: true, n: c.n, m: c.m, canEnd: canEndGroup(sessionOf(store.getState(), slot)) };
      }
      const r = commitEndGroup(store, { slot, sessionId });
      return r && r.ok ? { ok: true, judgedCount: r.judgedCount, sessionId, snapshot: snapshot(slot) } : flowFail(slot, r);
    },
    /**
     * B2.9a 重写错字（D66 ③，确认单 §9）：只算练习——三个 op 都不调 store.commit、不读写会话 / 记录 / 调度 / 墨迹（契约测试断言 store 不变）。
     *   redoOpen {chars}：整理字表（网页 redoCharsOf 同一个函数）→ 第一个字的快照 + 外观（文案 / 颜色 / 字阶 / 时刻 / 动效 / 版式 / 墨参数，同 open）；
     *     没有能练的字 → invalid（网页同样不打开 / 退回去）。
     *   redoNext {chars, index}：对照页「下一个 / 完成」——不是最后一个 → 下一个字的快照；最后一个 → done（原生随即滑出、离开时 redoExit；
     *     网页 next() 最后一个同样是一次 nav.back）。
     *   redoExit：离开（‹ / 左缘右滑 / 完成）= 页面 nav.back 回到结果页（navigate.redoBack）。
     */
    redoOpen({ chars }) {
      const list = redoCharsOf({ chars });
      if (!list.length) return { ok: false, error: { kind: 'invalid' } };
      return {
        ok: true, chars: list, snapshot: redoSnapshot(storeOf().getState(), list, 0), copy: copyBundle(), colors: colors(), type: type(), timing: writeTiming(),
        motion: writeMotion(), layout: writeLayoutConstants(), ink: writeInk(), ...themeField(),
      };
    },
    redoNext({ chars, index }) {
      const list = redoCharsOf({ chars });
      const i = Math.trunc(Number(index));
      if (!list.length || !Number.isInteger(i) || i < 0 || i >= list.length) return { ok: false, error: { kind: 'invalid' } };
      if (i === list.length - 1) return { ok: true, done: true };
      return { ok: true, done: false, snapshot: redoSnapshot(storeOf().getState(), list, i + 1) };
    },
    redoExit() {
      if (typeof navigate.redoBack !== 'function') return { ok: false, error: { kind: 'invalid' } };
      navigate.redoBack();
      return { ok: true };
    },
    copy({ keys }) {
      return { ok: true, copy: copyBundle(Array.isArray(keys) ? keys : NATIVE_WRITE_COPY_KEYS) };
    },
    /** B2.9b：参考字形的读屏名称（只读，不写 store）。页面侧可能要先取笔顺数据（异步）。 */
    refLabel({ char, cardKey }) {
      if (typeof char !== 'string' || !char) return { ok: false, error: { kind: 'invalid' } };
      const v = refLabelOf({ char, cardKey: typeof cardKey === 'string' ? cardKey : null });
      return v && typeof v.then === 'function' ? v.then(label => ({ ok: true, label: String(label || '') })) : { ok: true, label: String(v || '') };
    },
    ...resultOps,
    /**
     * B2.7：原生结果页打开时要的外观与文案（宿主条目挂载时随 open 消息一起推给原生，首帧不等桥）：
     * 固定文案（NATIVE_RESULT_COPY_KEYS 与写字页的键）、颜色与字阶的此刻计算值、动效时刻（写字页同一组 + 结果页的显现 / 落印 / 邀请时刻）。
     */
    resultLook() {
      return {
        ok: true, copy: copyBundle([...NATIVE_WRITE_COPY_KEYS, ...NATIVE_RESULT_COPY_KEYS]), colors: colors(), type: type(), timing: writeTiming(),
        motion: { ...writeMotion(), result: resultMotion() }, skipUndo: writeSkipUndo(), ink: writeInk(), ...themeField(),
      };
    },
    /** 首练第 1 字的一次性提示出现了（R9-A NP-02）：与网页 useFirstTip 同一个 commitFirstTipSeen（只记一次；P52 失败不阻断）。 */
    firstTip() {
      const r = commitFirstTipSeen(storeOf());
      return r && r.ok ? { ok: true } : { ok: false, error: plainError(r) };
    },
    /**
     * 改判（D19 / D66 ④；B2.5）：结果行「修改 ›」与改判弹层。网页弹层 result-row.js 的同一个 commitCorrection（同一条记录只改 judgment、追加 corrections，
     * 从 fsrsBefore 重放本字此后的记录更新 sched；会话只把 lastLine 换成 'changed'，current 原样不动）。
     *   action 'state'：只读，弹层要的数据——{recordId, char, judgment, paper, strokes}；已不能改（结果行换了 / 不是 judged）回 stale；
     *   action 'apply'（缺省）：改。to = 'correct' | 'wrong'（原生按弹层打开时的判断取反后明示，重发不会改回去；省略 = 反过来，与网页 flip 同）。
     *     结果行已不是这条记录 → stale（网页同样直接关弹层）。失败 {ok:false, error} 原生就地换三段式（R-W10），记录与 FSRS 不变。回包都带新快照。
     */
    correct({ slot, recordId, to, action = 'apply' }) {
      const store = storeOf();
      const state = store.getState();
      if (action === 'state') {
        if (!correctable(state, slot, recordId)) return { ok: false, error: { kind: 'stale' }, snapshot: snapshot(slot) };
        const record = findRecord(state, recordId);
        return { ok: true, recordId, char: record.char, judgment: record.judgment, paper: isPaperRecord(record), strokes: sheetStrokes(store, record) };
      }
      const r = commitCorrection(store, { slot, recordId, to: to === 'correct' || to === 'wrong' ? to : undefined });
      if (!r || !r.ok) return { ok: false, error: plainError(r), snapshot: snapshot(slot) };
      return { ok: true, recordId, judgment: r.record ? r.record.judgment : null, snapshot: snapshot(slot) };
    },
    /**
     * 提示（D64 ①、D66 ②；B2.2）。与网页 useHint 同一组函数（src/session/ops/hint.js）。原生自己读包里同一份 data/<字>.json，只把总笔数 totalStrokes 交来
     * （0 = 这个字没有笔顺数据；省略 = 还在加载），分组数据（GROUPS）在页面里。
     *   action 'state'：只读——按钮模型（读屏名称「提示，还有 n 次」/「提示已用完」/「暂时没有提示」）与格下说明（没有笔顺数据时一句）；
     *   action 'give'：点一次——used / range 是原生此刻本地的次数与范围（写入失败时本地多于已存，P52），written = 书写格已写笔数；
     *     回包 given = 这次多给的一段 {from, to}（to 不含；已写过的段顺延，skip 段），hintRange = 合并后的范围，whole = 整字给完（同一次写入记为看过答案）；
     *     写入失败（P52）ok:false 但 given 照给，原生照常显示；不能给（加载中 / 无数据 / 已用完 / 看过答案）回 unavailable、不写；
     *   action 'range'：提示笔被本人笔全部收掉（hintRange:null）或撤销让它们回来（写回 range）——网页 'hint-fade' 同一次写入。
     */
    hint({ slot, cardKey, action = 'state', totalStrokes, used = 0, range = null, written = 0, hintRange = null, hints }) {
      const store = storeOf();
      const s = sessionOf(store.getState(), slot);
      if (!s || currentCardKey(s) !== cardKey || !s.current) return { ok: false, error: { kind: 'stale' } };
      const char = charOfCardKey(cardKey);
      const source = hintSourceOfCount({ totalStrokes, char });
      const stored = Number.isInteger(s.current.hints) ? s.current.hints : 0;
      const usedNow = Math.max(stored, Math.max(0, Math.trunc(Number(used) || 0)));
      const answerSeen = !!s.current.answerSeen;
      const phase = s.current.phase === 'compare' ? 'compare' : s.current.phase && s.current.phase !== 'recall' ? s.current.phase : 'recall';
      const view = (u, seen) => ({ button: hintButtonModel({ phase, status: source.status, used: u, answerSeen: seen, source }), note: hintNoteModel({ phase, status: source.status, used: u, answerSeen: seen }) });
      if (action === 'range') {
        const r = commitHint(store, { slot, sessionId: s.id, cardKey, hints: hints === undefined ? usedNow : hints, hintRange: wireRange(hintRange) }, 'hint-fade');
        return r && r.ok ? { ok: true, applied: !!r.applied } : { ok: false, error: plainError(r) };
      }
      if (action !== 'give') return { ok: true, used: usedNow, ...view(usedNow, answerSeen) };
      const model = hintButtonModel({ phase, status: source.status, used: usedNow, answerSeen, source });
      const step = model.kind === 'available' ? hintStep({ source, used: usedNow, written: Math.max(0, Math.trunc(Number(written) || 0)), range: wireRange(range) }) : null;
      if (!step) return { ok: false, error: { kind: 'unavailable' }, used: usedNow, ...view(usedNow, answerSeen) };
      const r = commitHintStep(store, { slot, sessionId: s.id, cardKey, step });
      const given = { from: step.plan.from, to: step.plan.to, skip: step.plan.skip };
      const out = {
        given, used: step.used, hintRange: step.hintRange, whole: step.whole, announce: hintAnnouncement(step.hintRange), // 与网页同一句：读出到此为止给出的整段（sr-live.js 读 hintView.range）
        ...view(step.used, answerSeen || (step.whole && !!(r && r.ok))),
      };
      return r && r.ok ? { ok: true, ...out } : { ok: false, error: plainError(r), ...out };
    },
  };

  return {
    call(op, args = {}) {
      const fn = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : null;
      if (!fn) return { ok: false, error: { kind: 'unknown-op' } };
      const t0 = clock();
      let out;
      try {
        out = fn(args || {});
      } catch (error) {
        out = { ok: false, error: { kind: 'exception', reason: String(error && error.message) } };
      }
      // B2.7：提醒邀请要等系统权限（异步）；其余 op 同步
      if (out && typeof out.then === 'function') {
        return out.then(v => ({ ...v, ms: Math.round((clock() - t0) * 100) / 100 }), error => ({ ok: false, error: { kind: 'exception', reason: String(error && error.message) }, ms: Math.round((clock() - t0) * 100) / 100 }));
      }
      return { ...out, ms: Math.round((clock() - t0) * 100) / 100 };
    },
  };
}
