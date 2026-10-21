// 写字会话 API 的无 DOM 部分（B2.1；架构 docs/engineering/v10/B2-原生写字架构.md §3）：op 表、快照、笔画格式、文案字典、
// createWriteSessionApi——从 src/ui/screens/write/native-session.js 原样挪来（行为不变）。
//
// 每个 op 调用网页写字页**同一个**提交函数（write-ops.js / result-ops.js），所以规则、记录形状、FSRS、笔迹编码与网页逐字段一致
// （test/ui/native-write.test.mjs）。导航（nav.back / openResult）与颜色（getComputedStyle）属于界面，由页面侧 native-session.js 注入；
// 本模块不 import 任何 UI / DOM 模块（门禁 test/session/boundary.test.mjs），B3 末随 src/session 一起进 JavaScriptCore。

import { getStore } from '../store/store.js';
import { t } from '../config/copy/index.js';
import { currentCardKey, isComplete } from '../core/sessions.js';
import { charOfCardKey } from '../core/records.js';
import { capitalCard, cardForKey, withWordOff } from '../data/deck.js';
import { M } from '../config/motion.js';
import * as policy from '../config/policy.js';
import {
  answerInkKey, commitComparePhase, commitHint, commitHintStep, commitJudgment, commitRecover, commitStrokes, hintAnnouncement, hintButtonModel,
  hintNoteModel, hintSourceOfCount, hintStep, HINT_FADE_IN_MS, HINT_FADE_OUT_MS, HINT_MATCH_MAX_DIST, PEN_ARM_MS, promptCells, REDUCED_FADE_MS,
  resultRowModel, storedStrokes,
} from './write-ops.js';
import { commitFinish } from './result-ops.js';

/** 会话 API 的操作（B2.0 实现前 6 个，B2.2 加 hint；其余在后续卡补，名称先占住，见架构文档 §3.2）。 */
export const NATIVE_WRITE_OPS = Object.freeze(['open', 'strokes', 'phase', 'judge', 'exit', 'copy', 'hint']);

/** 原生写字页用到的文案键（值取自 src/config/copy，原生不另存一份）。 */
export const NATIVE_WRITE_COPY_KEYS = Object.freeze([
  'R-W01.progress',
  'R-W01.progressLabel',
  'R-W03.titleRecall',
  'R-W03.titleCompare',
  'R-W05.hintLabel',
  'R-W07.btnShowAnswer',
  'R-W09.btnWrong',
  'R-W09.btnCorrect',
  'R-W09.continueWriting',
  'R-W09.labelMine',
  'R-W09.mineCardLabel',
  'R-W09.refCardLabelChar',
  'R-W14.btnSkip',
  'R-W15.end',
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

function promptOf(state, cardKey, queue) {
  const card = withWordOff(capitalCard(cardForKey(cardKey), queue), state ? state.wordOff : null);
  const model = promptCells(card, { revealed: false });
  return { cells: model.cells.map(c => ({ kind: c.kind, text: c.text, label: c.label })), hint: model.hint };
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
  return {
    ...base,
    cardKey,
    char: charOfCardKey(cardKey),
    phase: phase === 'compare' && !strokes.length ? 'recall' : phase,
    storedPhase: raw || 'recall',
    strokes: strokesToWire(strokes),
    hints: s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0,
    hintRange: s.current && s.current.hintRange ? { from: s.current.hintRange.from, to: s.current.hintRange.to } : null,
    answerSeen: !!(s.current && s.current.answerSeen),
    prompt: promptOf(state, cardKey, s.queue),
    lastLine: s.lastLine ? { ...s.lastLine } : null,
    line: lineOf(s, state),
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
 * @param {{getStore?: () => object, navigate?: {back: Function, toResult: Function}, colors?: () => object}} deps
 * @returns {{call(op:string, args?:object): object}}  同步返回结果对象（window 全局再包成 Promise）
 */
export function createWriteSessionApi(deps = {}) {
  const storeOf = deps.getStore || getStore;
  const navigate = deps.navigate || NO_NAVIGATE;
  const colors = deps.colors || (() => ({}));

  const snapshot = slot => writeSnapshot(storeOf().getState(), slot);

  const ops = {
    /** 打开 / 重新同步：先做恢复幂等（与网页写字页挂载时同一函数），再给快照、文案、颜色与时刻（writeTiming）。 */
    open({ slot }) {
      const store = storeOf();
      const rec = commitRecover(store, { slot });
      return {
        ok: true, recovered: !!(rec && rec.ok && !rec.noop), snapshot: snapshot(slot), copy: copyBundle(), colors: colors(), timing: writeTiming(),
        motion: writeMotion(), layout: writeLayoutConstants(),
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
      const s = sessionOf(store.getState(), slot);
      let finished = null;
      if (s && isComplete(s)) {
        const f = commitFinish(store, { slot, sessionId: s.id });
        finished = { ok: !!(f && f.ok), sessionId: s.id };
      }
      return { ok: true, recordId: r.record ? r.record.id : null, reused: !!r.reused, finished, snapshot: snapshot(slot) };
    },
    /** 原生页离开：to = 'back'（左上 ‹ / 左缘滑回）或 'result'（写完最后一字）。 */
    exit({ slot, to, sessionId }) {
      if (to === 'result') navigate.toResult(slot, sessionId);
      else navigate.back();
      return { ok: true };
    },
    copy({ keys }) {
      return { ok: true, copy: copyBundle(Array.isArray(keys) ? keys : NATIVE_WRITE_COPY_KEYS) };
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
      return { ...out, ms: Math.round((clock() - t0) * 100) / 100 };
    },
  };
}
