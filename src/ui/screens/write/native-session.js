// 原生写字页的「写字会话 API」与网页宿主条目（B2.0 最小纵切；架构见 docs/engineering/v10/B2-原生写字架构.md）。
//
// 选定架构（方案 A′）：一个运行时、一份 store——规则与 store 仍只在 WKWebView 里，原生写字页是「视图」：
//   - 读：页面把会话快照（当前字、题面、进度、阶段、笔画、文案、颜色）随 open 消息一次推给原生，之后每次提交的回包里带新快照，
//     写字中途（落笔、画、抬笔、撤销、清空）原生不等桥；
//   - 写：一律经 window.shiziNativeWrite(op, args)（原生用 callAsyncJavaScript 调用），本模块调用网页写字页**同一批**提交函数
//     （compare.commitJudgment / persist.commitStrokes / compare.commitComparePhase / result.commitFinish），store.commit 仍是唯一写入口；
//   - D07：judge 回 {ok:false} 时原生留在判断页走三段式，成功才推进；strokes / phase 按 P52 不阻断。
// 导航：网页路由仍是真相源。写字页条目照常入栈（冷启动恢复、刷新都按 route-memory 走），开关打开时它渲染成「原生宿主」
// （透明、不画内容，下层页保持可见，见 root.js nativeHost），挂载时 postMessage({type:'nativeWrite', op:'open'}) 让原生推入写字页，
// 卸载时 op:'close'；原生返回 / 写完最后一字时调用 exit，由本模块 nav.back() / openResult()。
//
// 开关：只在 iOS DEBUG 壳、启动参数 -shizi-native-write（SHIZI_NATIVE_WRITE=1）时，原生在文档开始注入 window.__shiziNativeWrite = true；
// 默认关，关着时本模块什么都不装、写字页与正式流程完全相同。

import { html, useEffect, useRef } from '../../../../vendor/ui.js';
import { getRouter, nav } from '../../router.js';
import { getStore } from '../../../store/store.js';
import { postNative, isNative } from '../../../platform/bridge.js';
import { t } from '../../../config/copy/index.js';
import { currentCardKey, isComplete } from '../../../core/sessions.js';
import { charOfCardKey } from '../../../core/records.js';
import { capitalCard, cardForKey, withWordOff } from '../../../data/deck.js';
import { commitJudgment, commitComparePhase } from './compare.js';
import { commitStrokes, commitRecover, storedStrokes } from './persist.js';
import { answerInkKey } from './answer.js';
import { promptCells } from './prompt.js';
import { commitFinish, openResult } from '../result/index.js';

/** 会话 API 的操作（B2.0 实现前 6 个；其余在后续卡补，名称先占住，见架构文档 §3.2）。 */
export const NATIVE_WRITE_OPS = Object.freeze(['open', 'strokes', 'phase', 'judge', 'exit', 'copy']);

/** 原生写字页用到的文案键（值取自 src/config/copy，原生不另存一份）。 */
export const NATIVE_WRITE_COPY_KEYS = Object.freeze([
  'R-W01.progress',
  'R-W01.progressLabel',
  'R-W03.titleRecall',
  'R-W03.titleCompare',
  'R-W09.btnWrong',
  'R-W09.btnCorrect',
  'R-W09.continueWriting',
  'R-W09.labelMine',
  'R-W09.mineCardLabel',
  'R-W09.refCardLabelChar',
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

/** 原生要的颜色令牌（取页面此刻计算值：浅 / 深色与网页同源，见 tokens.css）。 */
export const NATIVE_WRITE_COLOR_TOKENS = Object.freeze(['paper', 'hand', 'ref', 'frame', 'line', 'ink1', 'ink2', 'ink3', 'ink4', 'field']);

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** 开关：iOS DEBUG 壳注入了 __shiziNativeWrite 且在原生壳内。 */
export function nativeWriteEnabled(win = globalWin()) {
  return !!(win && win.__shiziNativeWrite === true && (win.__shiziNativeWriteForce === true || isNative()));
}

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
    prompt: promptOf(state, cardKey, s.queue),
    lastLine: s.lastLine ? { ...s.lastLine } : null,
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

export function colorBundle(win = globalWin()) {
  const out = {};
  try {
    const cs = win.getComputedStyle(win.document.documentElement);
    for (const name of NATIVE_WRITE_COLOR_TOKENS) out[name] = cs.getPropertyValue(`--${name}`).trim();
  } catch (error) {
    // node:test / 无 DOM
  }
  return out;
}

// ---------------------------------------------------------------- 会话 API

function plainError(result) {
  const e = result && result.error ? result.error : {};
  return { kind: typeof e.kind === 'string' ? e.kind : 'generic', reason: typeof e.reason === 'string' ? e.reason : undefined };
}

function clock() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * 写字会话 API。deps 可注入（node:test 用假 store / 假导航）。
 * @param {{getStore?: () => object, navigate?: {back: Function, toResult: Function}, colors?: () => object}} deps
 * @returns {{call(op:string, args?:object): object}}  同步返回结果对象（window 全局再包成 Promise）
 */
export function createWriteSessionApi(deps = {}) {
  const storeOf = deps.getStore || getStore;
  const navigate = deps.navigate || {
    back: () => nav.back({ cause: 'native' }),
    toResult: (slot, sessionId) => openResult(slot, sessionId),
  };
  const colors = deps.colors || (() => colorBundle());

  const snapshot = slot => writeSnapshot(storeOf().getState(), slot);

  const ops = {
    /** 打开 / 重新同步：先做恢复幂等（与网页写字页挂载时同一函数），再给快照、文案与颜色。 */
    open({ slot }) {
      const store = storeOf();
      const rec = commitRecover(store, { slot });
      return { ok: true, recovered: !!(rec && rec.ok && !rec.noop), snapshot: snapshot(slot), copy: copyBundle(), colors: colors() };
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

let installed = null;


/** 装 window.shiziNativeWrite(op, args) → Promise<结果>（只在开关打开时；幂等）。 */
export function installNativeWrite(win = globalWin(), deps) {
  if (!win || !nativeWriteEnabled(win)) return null;
  if (installed && win.shiziNativeWrite) return installed;
  installed = createWriteSessionApi(deps);
  win.shiziNativeWrite = (op, args) => Promise.resolve(installed.call(op, args));
  return installed;
}

// ---------------------------------------------------------------- 宿主条目

/** 顶层写字条目是不是以原生页显示（root.js 用它让下层页保持可见、宿主层透明）。 */
export function isNativeHostEntry() {
  return nativeWriteEnabled();
}

/**
 * 写字页在开关打开时渲染的宿主：不画内容；成为顶层时请原生推入写字页（随消息带快照，原生首帧不等桥），卸载时请原生关掉。
 * animate：本条目是刚 push 进来的（有转场）——冷启动恢复 / 刷新时为 false，原生直接盖上、不做推入动画。
 */
export function NativeWriteHost({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sentRef = useRef(false);
  useEffect(() => {
    installNativeWrite();
    const router = getRouter();
    const snap = router ? router.getState() : null;
    const tr = snap ? snap.transition : null;
    const animate = !!(tr && tr.to && entry && tr.to.id === entry.id && tr.animate && !tr.cold);
    // D62：从首页进来（纸展开 / 缩回）与其他入口（推入 / 滑出）的转场不同；冷启动恢复没有转场。
    const via = !animate ? 'restore' : tr.from && tr.from.n === 'home' ? 'home' : 'push';
    let api = null;
    try {
      api = createWriteSessionApi();
    } catch (error) {
      api = null;
    }
    const opened = api ? api.call('open', { slot }) : { ok: false };
    sentRef.current = postNative('nativeWrite', { op: 'open', slot, entryId: entry ? entry.id : null, animate, via, sentAt: Date.now(), payload: opened });
    return () => {
      if (sentRef.current) postNative('nativeWrite', { op: 'close', slot, entryId: entry ? entry.id : null });
    };
  }, [entry && entry.id]);
  return html`<div data-testid="write-native-host" data-slot=${slot}></div>`;
}

installNativeWrite();
