// 冷启动恢复页面栈（审查整改 F1；需求 R-W13「离开/刷新后恢复到离开时阶段（含判断页），笔迹和参考字形都在」；
// 03 P32 undoAfterReload='resume'、P108 routeRestore；01 §3.6、§4、§7、§9）。
//
// 问题：router 只从 history.state 恢复页面栈。同一页面内刷新时有效；但 App 进程被杀后 WKWebView 是全新会话（主屏 PWA、
// 新标签页同理），history.state 为空 → 落回首页，写字页的阶段与备份页的撤销都丢了。
//
// 做法：
//   存：页面栈（只含页面，截到第一个遮罩为止；与 history.state 里同一份 {n, p}）写进 shizi.v2.route =
//       {v:1, at, stack:[{n, p}]}——经 storage.writeRoute 单键写（不是业务数据、不是 store 域、不进备份与 txn，见 storage.js）。
//       何时写：attach 时一次；之后页面栈 / 参数每变一次（遮罩开关不变栈，不写）；切后台（visibilitychange hidden）与
//       pagehide 时刷新 at（at = 离开时刻）。写失败静默（不提示、不阻断）；阻断页（含迁移失败）期间不写。
//   读：router.start() 发现 history.state 不是本模块写的（冷启动）时调用 coldStart() → planColdStart() 判定：
//       1. policy.routeRestore.enabled 关 → 不恢复；
//       2. 阻断页（存储不可用 / 回滚失败 / 迁移失败）→ 不恢复（阻断页优先）；本次启动隔离了坏值（顶部提示）→ 不恢复（坏数据优先）；
//       3. 原生提醒深链已在桥上排队（shiziOpenReminderTarget）→ 不恢复（深链优先）；
//       4. 离开太久（P108 maxAgeMinutes）或跨本地日（P108 crossDay=false）→ 不恢复；
//       5. 逐页有效性（RESTORE_GUARDS）：写字页要该槽还有能续写的组（跨天作废的 daily 不算）、结果页要 lastEnded / 槽里还有那组、
//          单字详情要这个字还在（题库 / 自选 / 有记录 / 旧照片）、旧照片页要照片还在、「现在没有要写的字」页不恢复；
//          任何一页不合格 → 整个栈不恢复，落首页（安全降级）。
//       合格的栈交给 router 重建 history 条目（转场 cause:'restore', cold:true）。写字页按 sessions[slot].current 的阶段与笔画
//       自己恢复（M1-6 persist.js：笔画抬笔即写、切后台再写）；备份页按 cause:'restore' 恢复撤销底栏（P32，backup.js）。
//   深链（运行期）：iOS 冷启动时原生等 pageReady 之后才派发提醒深链，这时栈可能已经恢复了。yieldToDeepLink(fn)：
//       本次是冷恢复、用户还没动过（没导航、没切后台）→ 先静默退回首页（switchTab），等 history 落定再执行 fn（开 B 组）；
//       否则直接执行 fn（与原先一样叠在当前页上）。
//
// 纯逻辑部分（routeStackOf / encodeRoute / parseRoute / planColdStart）不碰 DOM，node:test 直接跑（test/ui/route-memory.test.mjs）。

import { KEYS, isPlainObject } from '../core/schema.js';
import * as defaultPolicy from '../config/policy.js';
import { localDay } from '../core/dates.js';
import { recordsOf, resumableSession } from '../core/session-start.js';
import { cardForKey } from '../data/deck.js';
import { now as envNow } from '../platform/env.js';
import { bridge as defaultBridge } from '../platform/bridge.js';
import { blockReasonOf } from './screens/block/index.js';
import { getScreen } from './router.js';

export const ROUTE_VERSION = 1;
/** 存下的栈最多几层（防御；正常不超过 6）。 */
export const MAX_ROUTE_DEPTH = 16;
/** 编码后超过这么长（字符）不写（参数异常大时宁可不恢复）。 */
export const MAX_ROUTE_CHARS = 8192;
/** 提醒深链全局名（与 bridge.js NATIVE_GLOBALS 一致）。 */
export const DEEP_LINK_GLOBAL = 'shiziOpenReminderTarget';

// ---------------------------------------------------------------- 纯函数

/** 路由快照 → 要存的栈 [{n, p}]：只取页面，遇到第一个遮罩为止（遮罩只活在内存里，恢复不了）。 */
export function routeStackOf(snap) {
  const out = [];
  const stack = snap && Array.isArray(snap.stack) ? snap.stack : [];
  for (const e of stack) {
    if (!e || e.k !== 's') break;
    out.push({ n: e.n, p: e.p && typeof e.p === 'object' ? e.p : {} });
  }
  return out;
}

/** 栈 + 时刻 → shizi.v2.route 的原始字串；栈空、参数不能 JSON 化或太长时返回 null（不写）。 */
export function encodeRoute(stack, at) {
  if (!Array.isArray(stack) || !stack.length || stack.length > MAX_ROUTE_DEPTH || !Number.isFinite(at)) return null;
  let raw;
  try {
    raw = JSON.stringify({ v: ROUTE_VERSION, at: Math.round(at), stack });
  } catch (error) {
    return null;
  }
  return typeof raw === 'string' && raw.length <= MAX_ROUTE_CHARS ? raw : null;
}

/** shizi.v2.route 原始字串 → {at, stack} | null（任何一处不合格都返回 null）。 */
export function parseRoute(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_ROUTE_CHARS) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return null;
  }
  if (!isPlainObject(value) || value.v !== ROUTE_VERSION || !Number.isFinite(value.at)) return null;
  const stack = value.stack;
  if (!Array.isArray(stack) || !stack.length || stack.length > MAX_ROUTE_DEPTH) return null;
  for (const e of stack) {
    if (!isPlainObject(e) || typeof e.n !== 'string' || !e.n || !isPlainObject(e.p)) return null;
  }
  return { at: value.at, stack: stack.map(e => ({ n: e.n, p: e.p })) };
}

/** 离开时刻 at 到现在是否还在恢复窗口里（P108）。 */
export function routeFresh(at, nowMs, policy = defaultPolicy) {
  const cfg = policy.routeRestore || {};
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return false;
  const maxMs = (Number(cfg.maxAgeMinutes) || 0) * 60 * 1000;
  if (Math.abs(nowMs - at) > maxMs) return false;
  if (cfg.crossDay !== true && localDay(at) !== localDay(nowMs)) return false;
  return true;
}

function slotOf(p) {
  return p && p.slot === 'B' ? 'B' : 'A';
}

function singleChar(value) {
  return typeof value === 'string' && Array.from(value).length === 1;
}

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: s.lastEnded || {} } : { A: null, B: null, lastEnded: {} };
}

function hasPhoto(state, char) {
  const photos = state && isPlainObject(state.photos) ? state.photos : null;
  return !!photos && Object.prototype.hasOwnProperty.call(photos, char) && !!photos[char];
}

/**
 * 逐页有效性：页面名 → (params, ctx) => boolean。ctx = {state, now, policy, lookup}。没列的页面不依赖易失状态，恒可恢复。
 * 备份页恒可恢复：撤销底栏另由备份页按副本是否还在决定（副本没了只是没有撤销，页面本身照常）。
 */
export const RESTORE_GUARDS = Object.freeze({
  // 写字页：该槽还有能续写的组（跨天作废的 daily、已写完的组都不算）。
  write: (p, ctx) => !!resumableSession(ctx.state, slotOf(p), { now: ctx.now, policy: ctx.policy }),
  // 结果页：那组还在 lastEnded[slot]（或写完了还在槽里）。
  result: (p, ctx) => {
    const id = p && typeof p.sessionId === 'string' ? p.sessionId : '';
    if (!id) return false;
    const s = sessionsOf(ctx.state);
    const slot = slotOf(p);
    return !!((s.lastEnded[slot] && s.lastEnded[slot].id === id) || (s[slot] && s[slot].id === id));
  },
  // 单字详情：这个字还在（题库里有 / 自选里有 / 有记录 / 有旧照片）。
  detail: (p, ctx) => {
    const char = p && p.char;
    if (!singleChar(char)) return false;
    if (ctx.lookup(`base:${char}`)) return true;
    const added = ctx.state && ctx.state.custom && Array.isArray(ctx.state.custom.added) ? ctx.state.custom.added : [];
    if (added.some(e => e && e.char === char)) return true;
    if (hasPhoto(ctx.state, char)) return true;
    return recordsOf(ctx.state).some(r => r && r.char === char);
  },
  // 旧照片页：照片还在。
  'detail-photo': (p, ctx) => singleChar(p && p.char) && hasPhoto(ctx.state, p.char),
  // 「现在没有要写的字」：开组失败时的过渡页，重启后没有意义。
  'session-none': () => false,
  // 重写错字页（D66 ③）：只在内存里练、不写存储，重启后没有意义。
  redo: () => false,
});

/**
 * 冷启动判定（纯函数）。返回 {stack:[{n,p}]|null, reason}。reason：
 *   'ok' | 'disabled' | 'none'（没存 / 存的不合格）| 'blocked' | 'corrupt' | 'deep-link' | 'stale' | 'unknown-screen:<n>' | 'invalid:<n>'
 * @param {object} o
 * @param {{at:number, stack:Array}|null} o.route   parseRoute 的结果
 * @param {object|null} o.state                     store 已发布状态
 * @param {object|null} o.blockReason               blockReasonOf(store.status)（null = 不阻断）
 * @param {boolean} [o.corrupt]                     本次启动隔离了坏值
 * @param {boolean} [o.deepLink]                    桥上排着提醒深链
 * @param {number} o.now                            ms
 * @param {object} [o.policy]
 * @param {(name:string) => any} [o.screenOf]
 * @param {(cardKey:string) => any} [o.lookup]
 */
export function planColdStart({
  route, state, blockReason = null, corrupt = false, deepLink = false, now, policy = defaultPolicy, screenOf = getScreen, lookup = cardForKey,
}) {
  const cfg = policy.routeRestore || {};
  if (cfg.enabled !== true) return { stack: null, reason: 'disabled' };
  if (!route) return { stack: null, reason: 'none' };
  if (blockReason) return { stack: null, reason: 'blocked' };
  if (corrupt) return { stack: null, reason: 'corrupt' };
  if (deepLink) return { stack: null, reason: 'deep-link' };
  if (!routeFresh(route.at, now, policy)) return { stack: null, reason: 'stale' };
  const ctx = { state, now, policy, lookup };
  for (let i = 0; i < route.stack.length; i += 1) {
    const e = route.stack[i];
    const def = screenOf(e.n);
    if (!def || (i === 0) !== !!def.tab) return { stack: null, reason: `unknown-screen:${e.n}` };
    const guard = Object.prototype.hasOwnProperty.call(RESTORE_GUARDS, e.n) ? RESTORE_GUARDS[e.n] : null;
    let ok = true;
    if (guard) {
      try {
        ok = guard(e.p, ctx) === true;
      } catch (error) {
        ok = false;
      }
    }
    if (!ok) return { stack: null, reason: `invalid:${e.n}` };
  }
  return { stack: route.stack.map(e => ({ n: e.n, p: e.p })), reason: 'ok' };
}

// ---------------------------------------------------------------- 接线

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * @param {object} deps
 * @param {() => object} deps.getStore
 * @param {object} [deps.bridge]
 * @param {object|null} [deps.win]
 * @param {() => number} [deps.now]
 * @param {object} [deps.policy]
 * @param {string} [deps.defaultTab]
 */
export function createRouteMemory(deps) {
  const getStoreFn = deps.getStore;
  const b = deps.bridge || defaultBridge;
  const win = deps.win === undefined ? globalWin() : deps.win;
  const nowFn = deps.now || envNow;
  const policy = deps.policy || defaultPolicy;
  const defaultTab = deps.defaultTab || 'home';

  let router = null;
  let off = null;
  let lastKey = null; // 上次成功写下的栈（JSON）
  let plan = null; // 最近一次冷启动判定
  let coldNavSeq = null; // 冷恢复时的 navSeq；之后有导航即「动过了」
  let touched = false;

  function store() {
    try {
      return getStoreFn();
    } catch (error) {
      return null;
    }
  }

  function readRaw() {
    const s = store();
    if (!s || !s.storage) return null;
    try {
      return s.storage.read(KEYS.route);
    } catch (error) {
      return null;
    }
  }

  function deepLinkQueued() {
    try {
      return typeof b.pending === 'function' && b.pending().some(c => c && c.name === DEEP_LINK_GLOBAL);
    } catch (error) {
      return false;
    }
  }

  function write(force) {
    if (!router) return null;
    const stack = routeStackOf(router.getState());
    const key = JSON.stringify(stack);
    if (!force && key === lastKey) return null;
    const s = store();
    if (!s || !s.storage || typeof s.storage.writeRoute !== 'function') return null;
    if (blockReasonOf(s.status)) return null; // 阻断页（含迁移失败）期间不写：此时不该在存储里留下任何 v2 键
    const raw = encodeRoute(stack, nowFn());
    if (raw === null) return null;
    let result;
    try {
      result = s.storage.writeRoute(raw);
    } catch (error) {
      result = { ok: false, kind: 'unknown' };
    }
    if (result && result.ok) lastKey = key;
    return result;
  }

  const onVisibility = () => {
    const doc = win && win.document;
    if (!doc || doc.visibilityState !== 'hidden') return;
    touched = true; // 切到后台过：之后再来的深链是热启动，不退回首页
    write(true);
  };
  const onPageHide = () => write(true);

  const memory = {
    /** router.start 的 coldStart 回调（B3.F 起也是 route.plan）：返回要恢复的栈或 null。deepLink：原生排着提醒深链。 */
    coldStart({ deepLink = false } = {}) {
      const s = store();
      const status = s ? s.status : null;
      plan = planColdStart({
        route: parseRoute(readRaw()),
        state: s ? s.getState() : null,
        blockReason: blockReasonOf(status),
        corrupt: !!(status && status.corruptNotice),
        deepLink: deepLink || deepLinkQueued(), // B3.F：原生持有提醒深链，冷启动判定时由 route.plan 告知
        now: nowFn(),
        policy,
      });
      return plan.stack;
    },

    /** router 启动之后接上：订阅页面栈变化写提示键，切后台 / pagehide 刷新离开时刻。 */
    attach(r) {
      if (off) off();
      router = r;
      const snap = r.getState();
      coldNavSeq = snap.transition && snap.transition.cold ? snap.navSeq : null;
      touched = false;
      off = r.subscribe(next => {
        if (coldNavSeq !== null && next.navSeq !== coldNavSeq) touched = true;
        write(false);
      });
      const doc = win && win.document;
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
      if (win && typeof win.addEventListener === 'function') win.addEventListener('pagehide', onPageHide);
      write(true);
      return memory;
    },

    detach() {
      if (off) off();
      off = null;
      const doc = win && win.document;
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('pagehide', onPageHide);
      router = null;
    },

    /**
     * 提醒深链压过冷恢复：本次是冷恢复且还没动过 → 先静默回首页，history 落定后执行 fn；否则立即执行 fn。
     * 返回 'yielded' | 'direct'。
     */
    yieldToDeepLink(fn) {
      const r = router;
      if (!r || coldNavSeq === null || touched) {
        fn();
        return 'direct';
      }
      touched = true;
      const snap = r.getState();
      if (snap.depth === 0 && snap.tab === defaultTab) {
        fn();
        return 'direct';
      }
      r.switchTab(defaultTab);
      r.whenIdle(fn);
      return 'yielded';
    },

    /** 立即写一次（刷新离开时刻）。 */
    flush: () => write(true),
    /** 最近一次冷启动判定（测试 / 诊断）。 */
    lastPlan: () => (plan ? { reason: plan.reason, restored: !!plan.stack } : null),
    /** 冷恢复之后是否还没动过（测试 / 诊断）。 */
    pristine: () => coldNavSeq !== null && !touched,
  };
  return memory;
}

// ---------------------------------------------------------------- 页面内单例（root.js 建，reminder.js 用）

let active = null;

export function setRouteMemory(memory) {
  active = memory || null;
}

export function getRouteMemory() {
  return active;
}

/** reminder.js 用：有路由记忆就让深链压过冷恢复，否则直接执行。 */
export function runDeepLink(fn) {
  if (active) return active.yieldToDeepLink(fn);
  fn();
  return 'direct';
}
