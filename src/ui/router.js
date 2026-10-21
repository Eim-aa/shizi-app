// 页面栈与遮罩栈（01-架构设计 §7）。
//
// 规则：
// - history 是唯一真相源。push / openOverlay 只 pushState；返回（UI 返回键、系统返回、原生返回事件）
//   一律走 history.back() / history.go(-n)，页面栈与遮罩栈的变化都在 popstate 处理器里按 depth 差执行。
// - 每个 history 条目的 state 都带完整栈快照（{depth, name, params, tab, stack}），刷新后可原样恢复；
//   params 必须能被结构化克隆（pushState 的要求）。
// - 各屏 registerScreen(name, component, opts) 自注册，没有中心路由表；opts.tab=true 的是 tab 根页。
// - tab 根页用 replaceState 切换，不新增条目；tab 根上 back() 不调用 history.back()（不退出页面）。
// - 遮罩（底部弹层、确认框）也占 history 条目，所以系统返回先关最上层遮罩；遮罩的组件与 props 只活在内存里，
//   刷新或「前进」到一个已关闭的遮罩条目时，静默退回到它下面的条目。
// - 冷启动（审查整改 F1）：进程被杀后 WKWebView / 新标签页是全新会话，history.state 为空。此时 start() 向注入的
//   coldStart() 要一份存下的页面栈（ui/route-memory.js 从 shizi.v2.route 读、判过期与各页有效性），经同一 sanitize 后
//   用 replaceState + pushState 逐层重建 history 条目（返回键照常按层退回），转场 {kind:'none', cause:'restore', cold:true}。
//   遮罩只活在内存里，不进存下的栈。
// - 本模块不碰 DOM：history 与计时器可注入，node:test 直接跑（test/ui/router.test.mjs）；
//   浏览器接线见 attachWindow()，渲染与转场见 ui/root.js。

import { M } from '../config/motion.js';

export const STATE_TAG = 'shizi-router';
export const STATE_VERSION = 1;

// 原生壳事件（01-架构设计 §7、§8.1）。M0-4 期间兼容的别名 'shizi-native-progress' 已在 M5-3 删除（Swift 只派发下面两个）。
export const NATIVE_BACK_EVENT = 'shizi-native-back';
export const NATIVE_PROGRESS_EVENT = 'shizi-native-back-progress';
/**
 * 读屏「两指 Z 形」退出手势（A2-05）：Swift 的 WebViewController.accessibilityPerformEscape 派发。
 * R5-I2（交互规范 N3 读屏、P0-16）：有弹层先关最上层弹层，没有弹层就执行顶层页面左上元素的动作（与左缘右滑同一个函数）；
 * Swift 只在门控为 true（有子页或有弹层）时派发并返回 true。
 */
export const NATIVE_ESCAPE_EVENT = 'shizi-native-escape';


// history.back()/go() 发出后等 popstate 的上限；超时则放弃等待、继续执行排队的操作（不是动画时长；verify_tokens 例外登记）。
export const PENDING_TIMEOUT_MS = 1000;

// ---------------------------------------------------------------------------
// 屏幕注册表（自注册）

const registry = new Map();

export function registerScreen(name, component, opts = {}) {
  if (typeof name !== 'string' || !name) throw new TypeError('registerScreen: name must be a non-empty string');
  if (typeof component !== 'function') throw new TypeError(`registerScreen(${name}): component must be a function`);
  const def = {
    name,
    component,
    tab: opts.tab === true,
    order: Number.isFinite(opts.order) ? opts.order : 0,
    label: typeof opts.label === 'string' ? opts.label : name,
    icon: opts.icon || null,
    // 01 §7：本屏在顶层期间自己管原生左缘返回手势门控；根组件此时不发 backGestureEnabled（R4-G1 起写字页不再声明，目前没有页面用）。
    ownsBackGesture: opts.ownsBackGesture === true,
    // B2.0：本屏此刻由原生页面显示（返回 true 时根组件让下层页保持可见、本层透明不接收触摸；见 write/native-session.js）。
    nativeHost: typeof opts.nativeHost === 'function' ? opts.nativeHost : null,
  };
  registry.set(name, def);
  return def;
}

export function getScreen(name) {
  return registry.get(name) || null;
}

export function listTabs() {
  return [...registry.values()].filter(def => def.tab).sort((a, b) => a.order - b.order);
}

/** 所有已注册的页面名（交互合规 e2e 从这里取遍历范围，新页面自动入列：交互与动效规范 §8b IC-00）。 */
export function listScreens() {
  return [...registry.values()].map(def => ({ name: def.name, tab: def.tab }));
}

// 仅供单测清理。
export function unregisterScreen(name) {
  registry.delete(name);
}

// ---------------------------------------------------------------------------
// 状态快照

function topScreenOf(stack) {
  for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i].k === 's') return stack[i];
  return null;
}

function serializeStack(stack) {
  return stack.map(e => (e.k === 's' ? { k: 's', id: e.id, n: e.n, p: e.p } : { k: 'o', id: e.id, n: e.n }));
}

function makeState(stack, depth) {
  const top = topScreenOf(stack);
  return {
    tag: STATE_TAG,
    v: STATE_VERSION,
    depth,
    name: top ? top.n : null,
    params: top ? top.p : null,
    tab: stack.length ? stack[0].n : null,
    stack: serializeStack(stack),
  };
}

// 只接受本模块写出的 state；其他（旧版 {shiziView}、null、哈希跳转）一律视为外来条目。
export function readState(raw) {
  if (!raw || typeof raw !== 'object' || raw.tag !== STATE_TAG || raw.v !== STATE_VERSION) return null;
  if (!Number.isInteger(raw.depth) || raw.depth < 0) return null;
  if (!Array.isArray(raw.stack) || raw.stack.length !== raw.depth + 1) return null;
  for (const e of raw.stack) {
    if (!e || typeof e !== 'object' || (e.k !== 's' && e.k !== 'o')) return null;
    if (typeof e.id !== 'string' || typeof e.n !== 'string') return null;
  }
  if (raw.stack[0].k !== 's') return null;
  return raw;
}

// ---------------------------------------------------------------------------
// 路由器

/**
 * @param {object} options
 * @param {{state:any, pushState:Function, replaceState:Function, back:Function, go:Function}} options.history
 * @param {() => boolean} [options.isStandalone]  iOS 主屏 PWA：系统返回（popstate）不做自定义转场
 * @param {Function} [options.setTimeout]
 * @param {Function} [options.clearTimeout]
 * @param {(error:any) => void} [options.onError]
 */
export function createRouter(options) {
  const history = options.history;
  const isStandalone = options.isStandalone || (() => false);
  const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout || (id => clearTimeout(id));
  const onError = options.onError || (error => { console.error('[shizi] router:', error); });

  let stack = [];
  let depth = 0;
  let idCounter = 0;
  let seq = 0; // 顶层页面每变一次 +1（transition.seq）
  let navSeq = 0; // 页面或遮罩结构每变一次 +1（给防连点用）
  let transition = null; // {seq, kind:'push'|'pop'|'tab'|'replace'|'none', animate, cause, from, to}
  let pending = null; // {expectDepth, cause, silent, then, timer}
  let started = false;
  let defaultTabName = null;
  let nativeBackFilter = null; // M6-5：跟手手势已处理过的 shizi-native-back 由它吞掉（见 createBackGestureController）
  let backGesture = null; // R4-G1：交互式返回控制器（root.js 接上；setBackProgress / finishBack / cancelBack 转给它）
  const queue = [];
  const overlays = new Map(); // id -> {component, props, name}
  const listeners = new Set();

  function nextId() {
    idCounter += 1;
    return `e${idCounter}`;
  }

  function bumpIds(entries) {
    for (const e of entries) {
      const m = /^e(\d+)$/.exec(e.id);
      if (m) idCounter = Math.max(idCounter, Number(m[1]));
    }
  }

  function snapshot() {
    return {
      stack: stack.slice(),
      depth,
      tab: stack.length ? stack[0].n : null,
      top: topScreenOf(stack),
      topIsOverlay: stack.length > 0 && stack[stack.length - 1].k === 'o',
      transition,
      navSeq,
      pending: !!pending,
    };
  }

  function emit() {
    const snap = snapshot();
    for (const fn of [...listeners]) {
      try {
        fn(snap);
      } catch (error) {
        onError(error);
      }
    }
  }

  function run(op) {
    if (pending) {
      queue.push(op);
      return;
    }
    try {
      op();
    } catch (error) {
      onError(error);
    }
  }

  function drain() {
    while (!pending && queue.length) {
      const op = queue.shift();
      try {
        op();
      } catch (error) {
        onError(error);
      }
    }
  }

  function setPending(p) {
    pending = p;
    p.timer = setTimer(() => {
      if (pending !== p) return;
      pending = null;
      drain();
    }, PENDING_TIMEOUT_MS);
  }

  function historyGo(n, p) {
    setPending(p);
    if (n === -1) history.back();
    else history.go(n);
  }

  // 把 state 里的栈还原成可渲染的栈：未注册的屏、已关闭（不在内存里）的遮罩及其以上全部截掉。
  function sanitize(serialized) {
    const first = serialized[0];
    const firstDef = getScreen(first.n);
    if (!firstDef || !firstDef.tab) return { entries: null, cut: 0 };
    const entries = [];
    for (const e of serialized) {
      if (e.k === 's') {
        if (!getScreen(e.n)) break;
        entries.push({ k: 's', id: e.id, n: e.n, p: e.p && typeof e.p === 'object' ? e.p : {} });
      } else {
        if (!overlays.has(e.id)) break;
        entries.push({ k: 'o', id: e.id, n: e.n });
      }
    }
    return { entries, cut: serialized.length - entries.length };
  }

  function freshRoot(tabName) {
    return [{ k: 's', id: nextId(), n: tabName, p: {} }];
  }

  function setTransition(kind, { animate, cause, from, to, cold = false }) {
    seq += 1;
    transition = cold ? { seq, kind, animate, cause, from, to, cold: true } : { seq, kind, animate, cause, from, to };
  }

  /**
   * 冷启动：coldStart() 给出的 [{n, p}]（只含页面）→ 可渲染的栈。第一项必须是 tab 根，其余必须是已注册的子页面；
   * 不认识的页面及其以上全部截掉（与 sanitize 同口径）。不合格返回 null。
   */
  function coldEntries(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const first = list[0];
    const firstDef = first && typeof first.n === 'string' ? getScreen(first.n) : null;
    if (!firstDef || !firstDef.tab) return null;
    const entries = [];
    for (let i = 0; i < list.length; i += 1) {
      const e = list[i];
      const def = e && typeof e.n === 'string' ? getScreen(e.n) : null;
      if (!def || (i > 0 && def.tab)) break;
      entries.push({ k: 's', id: nextId(), n: e.n, p: e.p && typeof e.p === 'object' && !Array.isArray(e.p) ? e.p : {} });
    }
    return entries;
  }

  function applyState(st, { cause, silent }) {
    const prevTop = topScreenOf(stack);
    const prevDepth = depth;
    const { entries, cut } = sanitize(st.stack);
    if (!entries) {
      // tab 根本身不认识（版本变了）：重建默认 tab 根，就地改写当前条目。
      stack = freshRoot(defaultTabName);
      depth = st.depth;
      history.replaceState(makeState(stack, depth), '');
      pruneOverlays();
      navSeq += 1;
      setTransition('none', { animate: false, cause, from: prevTop, to: stack[0] });
      return;
    }
    bumpIds(entries);
    stack = entries;
    depth = st.depth;
    pruneOverlays();
    navSeq += 1;
    const nextTop = topScreenOf(stack);
    if (!prevTop || prevTop.id !== nextTop.id) {
      const delta = depth - prevDepth;
      let kind = delta < 0 ? 'pop' : delta > 0 ? 'push' : 'none';
      if (depth === 0 && prevDepth === 0) kind = 'tab';
      const animate = !silent && (kind === 'push' || kind === 'pop') &&
        !(kind === 'pop' && cause === 'system' && isStandalone());
      setTransition(kind, { animate, cause, from: prevTop, to: nextTop });
    }
    if (cut > 0 && !pending) {
      historyGo(-cut, { expectDepth: depth - cut, cause: 'restore', silent: true });
    }
  }

  function pruneOverlays() {
    const live = new Set(stack.filter(e => e.k === 'o').map(e => e.id));
    for (const id of [...overlays.keys()]) if (!live.has(id)) overlays.delete(id);
  }

  function replaceTab(name) {
    const prevTop = topScreenOf(stack);
    if (stack.length === 1 && stack[0].n === name) return;
    stack = freshRoot(name);
    depth = 0;
    history.replaceState(makeState(stack, 0), '');
    pruneOverlays();
    navSeq += 1;
    setTransition('tab', { animate: false, cause: 'ui', from: prevTop, to: stack[0] });
    emit();
  }

  const router = {
    start({ defaultTab } = {}) {
      if (started) return router;
      const tabDef = getScreen(defaultTab);
      if (!tabDef || !tabDef.tab) throw new Error(`router.start: default tab "${defaultTab}" is not a registered tab screen`);
      defaultTabName = defaultTab;
      started = true;
      const restored = readState(history.state);
      if (restored) {
        const { entries, cut } = sanitize(restored.stack);
        if (entries) {
          bumpIds(entries);
          stack = entries;
          depth = restored.depth;
          navSeq += 1;
          setTransition('none', { animate: false, cause: 'restore', from: null, to: topScreenOf(stack) });
          if (cut > 0) historyGo(-cut, { expectDepth: depth - cut, cause: 'restore', silent: true });
          emit();
          return router;
        }
      }
      // 冷启动（history.state 为空或不是本模块写的）：按存下的栈重建 history 条目。
      let cold = null;
      if (!restored && typeof options.coldStart === 'function') {
        try {
          cold = coldEntries(options.coldStart());
        } catch (error) {
          onError(error);
          cold = null;
        }
      }
      if (cold && cold.length) {
        history.replaceState(makeState(cold.slice(0, 1), 0), '');
        for (let i = 1; i < cold.length; i += 1) history.pushState(makeState(cold.slice(0, i + 1), i), '');
        stack = cold;
        depth = cold.length - 1;
        navSeq += 1;
        setTransition('none', { animate: false, cause: 'restore', from: null, to: topScreenOf(stack), cold: true });
        emit();
        return router;
      }
      stack = freshRoot(defaultTab);
      depth = 0;
      history.replaceState(makeState(stack, 0), '');
      navSeq += 1;
      setTransition('none', { animate: false, cause: 'start', from: null, to: stack[0] });
      emit();
      return router;
    },

    getState: snapshot,

    getOverlay(id) {
      return overlays.get(id) || null;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    canGoBack() {
      return depth > 0;
    },

    /** 等正在进行的 history 返回（popstate）落定后执行 fn；没有在等时立即执行（与 push 等操作同一队列）。 */
    whenIdle(fn) {
      if (typeof fn !== 'function') throw new TypeError('router.whenIdle: fn must be a function');
      run(fn);
    },

    push(name, params = {}) {
      const def = getScreen(name);
      if (!def) throw new Error(`router.push: unknown screen "${name}"`);
      if (def.tab) {
        router.switchTab(name);
        return;
      }
      run(() => {
        const from = topScreenOf(stack);
        const entry = { k: 's', id: nextId(), n: name, p: params };
        const next = [...stack, entry];
        history.pushState(makeState(next, depth + 1), '');
        stack = next;
        depth += 1;
        navSeq += 1;
        setTransition('push', { animate: true, cause: 'ui', from, to: entry });
        emit();
      });
    },

    // 就地换掉顶层页面（不新增条目），例如写字页最后一字直接换成结果页。默认无转场；opts.animate = true 时根组件画一段
    // T-phase 淡化（同一张纸换内容：结果页「再写一组」、撤销跳过回到那个字，R5-I2 审计 P1-03 / P2-19）。
    replace(name, params = {}, opts = {}) {
      const def = getScreen(name);
      if (!def || def.tab) throw new Error(`router.replace: "${name}" is not a registered sub screen`);
      run(() => {
        if (depth === 0 || stack[stack.length - 1].k !== 's') throw new Error('router.replace: top entry is not a sub screen');
        const from = stack[stack.length - 1];
        const entry = { k: 's', id: nextId(), n: name, p: params };
        stack = [...stack.slice(0, -1), entry];
        history.replaceState(makeState(stack, depth), '');
        navSeq += 1;
        setTransition('replace', { animate: !!(opts && opts.animate), cause: 'ui', from, to: entry });
        emit();
      });
    },

    // 合并顶层页面的 params 并 replaceState（页面内状态要在刷新/返回后保留时用）。
    setParams(patch) {
      run(() => {
        const top = topScreenOf(stack);
        if (!top) return;
        const idx = stack.lastIndexOf(top);
        const entry = { ...top, p: { ...top.p, ...patch } };
        stack = [...stack.slice(0, idx), entry, ...stack.slice(idx + 1)];
        if (transition && transition.to && transition.to.id === entry.id) transition = { ...transition, to: entry };
        history.replaceState(makeState(stack, depth), '');
        emit();
      });
    },

    // 返回：先关最上层遮罩，否则弹出一页；tab 根上不动（不退出页面），返回 false。
    back({ cause = 'ui' } = {}) {
      if (!pending && depth === 0) return false;
      run(() => {
        if (depth === 0) return;
        historyGo(-1, { expectDepth: depth - 1, cause });
      });
      return true;
    },

    // 原生 shizi-native-back。跟手手势在 ended 时已按同一阈值自行提交 / 回弹（或在 began 时关了遮罩），
    // 紧随其后的这次事件由 filter 吞掉，免得多退一层；没有跟手过程（旧壳、冒烟、事件丢失）时照常返回一层。
    handleNativeBack() {
      if (nativeBackFilter) {
        let absorbed = false;
        try {
          absorbed = nativeBackFilter() === true;
        } catch (error) {
          onError(error);
        }
        if (absorbed) return false;
      }
      return router.back({ cause: 'native' });
    },

    /** M6-5：注册 / 清除 shizi-native-back 过滤器（返回 true 表示已被跟手手势处理，本次不返回）。 */
    setNativeBackFilter(fn) {
      nativeBackFilter = typeof fn === 'function' ? fn : null;
    },

    // R4-G1 交互式返回接口（与具体动画样式解耦）：进度 0–1 驱动「当前的返回转场」，样式由根组件的转场定义决定。
    // 原生边缘手势与网页兜底手势都经它（或经同一控制器的 handle）驱动；以后换进出动画只换转场定义，不动这里。
    /** 接上 / 拆下交互式返回控制器（createBackGestureController 的实例）。 */
    attachBackGesture(ctrl) {
      backGesture = ctrl && typeof ctrl.beginBack === 'function' ? ctrl : null;
    },
    /** 开始一次交互式返回：顶层是遮罩时直接关遮罩（返回 'overlay'）；能跟手返回时返回 'page'；不能返回时 'ignored'。 */
    beginBack() {
      return backGesture ? backGesture.beginBack() : 'ignored';
    },
    /** 进度 p（0–1，按视口宽的比例），velocity 为 px/s（向右为正，可省）。 */
    setBackProgress(p, velocity = 0) {
      return backGesture ? backGesture.setBackProgress(p, velocity) : false;
    },
    /** 松手：按阈值（位移 > 1/3 宽或速度 > 500）决定完成或回弹；返回是否完成。 */
    endBack(velocity = 0) {
      return backGesture ? backGesture.endBack(velocity) : false;
    },
    /** 直接完成返回（短动画补完）。 */
    finishBack() {
      return backGesture ? backGesture.finishBack() : false;
    },
    /** 取消（回弹）。 */
    cancelBack() {
      return backGesture ? backGesture.cancelBack() : false;
    },

    switchTab(name) {
      const def = getScreen(name);
      if (!def || !def.tab) throw new Error(`router.switchTab: "${name}" is not a registered tab screen`);
      run(() => {
        if (depth > 0) {
          historyGo(-depth, { expectDepth: 0, cause: 'tab', silent: true, then: () => replaceTab(name) });
          return;
        }
        replaceTab(name);
      });
    },

    openOverlay(component, props = {}, { name = 'overlay' } = {}) {
      if (typeof component !== 'function') throw new TypeError('router.openOverlay: component must be a function');
      const id = nextId();
      run(() => {
        overlays.set(id, { component, props, name });
        const next = [...stack, { k: 'o', id, n: name }];
        history.pushState(makeState(next, depth + 1), '');
        stack = next;
        depth += 1;
        navSeq += 1;
        emit();
      });
      return id;
    },

    updateOverlay(id, props) {
      run(() => {
        const o = overlays.get(id);
        if (!o) return;
        overlays.set(id, { ...o, props: { ...o.props, ...props } });
        navSeq += 1; // 遮罩内容换状态（如保存失败）也算「新状态」，按钮 0.4s 不响应
        emit();
      });
    },

    // 关掉某个遮罩（连同压在它上面的页面/遮罩）；只经 history 返回。
    closeOverlay(id) {
      run(() => {
        const idx = stack.findIndex(e => e.k === 'o' && e.id === id);
        if (idx < 0) return;
        const n = stack.length - idx;
        historyGo(-n, { expectDepth: depth - n, cause: 'ui' });
      });
    },

    handlePopState(raw) {
      const p = pending;
      if (p) {
        clearTimer(p.timer);
        pending = null;
      }
      const st = readState(raw);
      if (!st) {
        // 外来条目（例如手动改了 #hash）：把它改写成当前快照，之后返回时 depth 差为 0、画面不变。
        if (started && stack.length) history.replaceState(makeState(stack, depth), '');
        emit();
        drain();
        return;
      }
      const matched = !!p && p.expectDepth === st.depth;
      applyState(st, { cause: matched ? p.cause : 'system', silent: matched && !!p.silent });
      emit();
      if (matched && typeof p.then === 'function') {
        try {
          p.then();
        } catch (error) {
          onError(error);
        }
      }
      drain();
    },
  };

  return router;
}

// ---------------------------------------------------------------------------
// 原生左缘返回手势门控（01 §7）：tab 根页与阻断页不可返回 → backGestureEnabled(false)；有子页 → true。
// D58 / 审计 P1-06（N4 门控）：顶层是弹层时永远可用（只关弹层），不看下面那一页能否返回、也不看是否在 Tab 根。
// 页面登记 null 只剩 L0 / 阻断页（判断阶段「‹ 接着写」登记的是页内回退函数，不再关手势）；
// 写字页不再整页关掉手势（原 M0-7 / ownsBackGesture：书写格四周有 20pt 页边，边缘起手不会落在格子里）。
// 写字页以外仍可用 ownsBackGesture 自己管门控（目前没有页面用）；bridge.setBackGestureEnabled 只在值变化时发。

/** 页面栈深度：页面条目数 − 1（遮罩不算）。0 = tab 根页。 */
export function pageDepth(snap) {
  if (!snap || !Array.isArray(snap.stack)) return 0;
  let n = 0;
  for (const e of snap.stack) if (e && e.k === 's') n += 1;
  return Math.max(0, n - 1);
}

/** 按路由快照（与是否阻断、顶层页面能不能返回）算原生左缘返回手势该不该开：阻断页 false；顶层是弹层 true（N4，P1-06）；tab 根页 / 顶层不能返回 false，有子页 true。 */
export function backGestureAllowed(snap, blocked = false, actionAllowed = true) {
  if (blocked) return false;
  if (snap && snap.topIsOverlay) return true;
  return actionAllowed !== false && pageDepth(snap) > 0;
}

/**
 * 根组件用的门控同步器（纯逻辑，可注入 send 与屏幕查询，单测用）。
 * update(snap, blocked, actionAllowed) 只在「页面栈深度 / 阻断 / 顶层能否返回」变化时发一次；顶层页面 ownsBackGesture 时只记下、不发。
 * @param {{send: (value:boolean) => any, screenOf?: (name:string) => any}} deps
 */
export function createBackGestureSync({ send, screenOf = getScreen }) {
  let lastKey;
  return {
    update(snap, blocked = false, actionAllowed = true) {
      const key = blocked ? 'blocked' : `${pageDepth(snap)}|${backGestureAllowed(snap, false, actionAllowed)}`;
      if (key === lastKey) return false;
      lastKey = key;
      if (!blocked) {
        const top = snap && snap.top ? screenOf(snap.top.n) : null;
        if (top && top.ownsBackGesture) return false;
      }
      send(backGestureAllowed(snap, blocked, actionAllowed));
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// 跟手交互式返回（M6-5；R4-G1 重做接口）。
//
// 驱动方有两个，事件语义相同：
//   1. 原生（01 §7）：Swift 的左缘识别器（UIScreenEdgePanGestureRecognizer + 页边 20pt 起手的平移识别器）每个阶段派发
//      shizi-native-back-progress {phase, translationX, progress, velocityX}，经 handle(detail) 进来；
//   2. 网页兜底（浏览器 / 主屏 PWA，ui/edge-swipe.js）：左缘 20px 起手的指针拖动，派发同一个事件（原生壳内关闭）。
// 控制器只管「进度 → 完成 / 取消」的状态机；画面由 onView(view) 交给根组件，按当前转场定义（ui/root.js BACK_TRANSITIONS）
// 把进度画成图层样式——换进出动画时只换转场定义。对外接口（router.beginBack / setBackProgress / endBack / finishBack / cancelBack）
// 直接对应下面同名方法。
//
// - began：遮罩栈非空（顶层是遮罩）→ 跟手位移顶层弹层（页面不动，Tab 根上同样可用，N4 / P1-06）；松手按同一阈值关掉它或回弹
//          （原先是按下即关、不跟手、不能取消）；
//          否则有子页且顶层页面能返回（登记了左上元素的动作）→ 开始跟随：出页（kind 'page'）冻结底层页（露出、不可点）；
//          页内回退（kind 'phase'，判断阶段「‹ 接着写」）不露出底层页，进度画成该页 T-phase 倒放（root.js PHASE_BACK）；
//          tab 根 / 阻断 / 顶层不能返回 / 转场或导航进行中 → 不理会。
// - changed：进度 = 位移 / 宽，跟手（顶层右移、底层视差，样式由转场定义决定）；可中途反向。
// - ended：速度 > BACK_COMMIT_VELOCITY，或（位移 > BACK_COMMIT_RATIO × 宽 且 速度 > BACK_RETURN_VELOCITY，即没有明显往回拉）
//          → 完成：执行顶层页面的返回动作（与点页头左上键同一个函数，ui/back-action.js），转场从当前位置接着走；否则回弹。
//          页内回退没有出栈转场：完成即执行动作并收起跟手画面（之后的过渡由页内阶段切换 phase-fade 接手）。
// - cancelled：回弹。
// - 减少动态效果：不跟随（页面不动），ended 仍按阈值完成，完成后的返回转场是 GESTURE_FADE_MS 的交叉淡化（root.js）。
// - Swift 在 ended 越过同一阈值时紧接着派发 shizi-native-back：本次手势已处理，由 absorbNativeBack() 吞掉。
// 纯逻辑（状态、计时器、宽度都可注入）；单测 test/ui/gesture.test.mjs。

// 取 gesture 令牌（tokens.json gesture.*，config/motion.js；D58）；与 ios/ShiziApp/ShiziApp/WebViewController.swift BackGestureThreshold 逐值一致（单测核对）。
export const BACK_COMMIT_RATIO = M.gesture.commitRatio; // 位移过三分之一个宽（R4-G1 / P270；D36 时为 50%）
export const BACK_COMMIT_VELOCITY = M.gesture.commitVelocity; // pt/s（= CSS px/s）：向右甩过这个速度，不看位移（D36）
export const BACK_RETURN_VELOCITY = M.gesture.returnVelocity; // pt/s：位移过阈值后若向左回拉快过这个速度，视为取消（D36）
export const BACK_PARALLAX = M.distance.parallax;
export const GESTURE_SNAP_MS = M.role.gestureSnap;
// ended 之后多久内到达的 shizi-native-back 算「同一次手势」（Swift 在同一段脚本里紧接着派发，实际是同步的；不是动画时长，verify_tokens 例外登记）。
export const GESTURE_ABSORB_MS = 600;
// 提交后等不到返回转场（history 卡住、返回动作没有导航）就回弹，不让页面停在半路。
export const GESTURE_COMMIT_TIMEOUT_MS = PENDING_TIMEOUT_MS + 200;

function clampNum(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** ended 时是否提交返回：v > 500 || (x > 1/3 宽 && v > -200)。 */
export function backGestureCommits(detail, width) {
  const w = Math.max(1, Number(width) || 1);
  const x = clampNum(detail && detail.translationX, 0, w);
  const v = Number(detail && detail.velocityX) || 0;
  return v > BACK_COMMIT_VELOCITY || (x > w * BACK_COMMIT_RATIO && v > BACK_RETURN_VELOCITY);
}

/** 顶层页位移 x 时两层的 translateX：顶层 = x；底层视差 = -(宽 − x) × BACK_PARALLAX（x=0 时 -0.3 宽，x=宽 时 0）。 */
export function gestureLayerX(x, width) {
  const w = Math.max(1, Number(width) || 1);
  const top = clampNum(x, 0, w);
  const under = -(w - top) * BACK_PARALLAX;
  return { top, under: Math.round(under * 100) / 100 || 0 };
}

/**
 * @param {object} deps
 * @param {() => object} deps.getState         路由快照（router.getState）
 * @param {() => any} deps.back                完成返回：执行顶层页面的返回动作（根组件：页头左上键的动作，没登记时 router.back）
 * @param {() => any} [deps.closeOverlay]      关顶层遮罩（缺省同 back）
 * @param {() => boolean} [deps.allowed]       顶层页面能不能滑动返回（登记了左上元素的动作）
 * @param {() => 'page'|'phase'} [deps.kind]  顶层页面的返回是出页还是页内回退（ui/back-action.js getBackKind）
 * @param {() => number} [deps.width]          视口宽（CSS px）
 * @param {() => boolean} [deps.reducedMotion]
 * @param {() => boolean} [deps.blocked]       阻断页（R-B09）
 * @param {() => boolean} [deps.busy]          页面转场进行中
 * @param {(view: null | {phase:'follow'|'snap'|'commit', kind:'page'|'phase', progress:number, x:number, under:number, width:number}) => void} [deps.onView]
 */
export function createBackGestureController(deps) {
  const getState = deps.getState;
  const back = deps.back;
  const closeOverlay = deps.closeOverlay || back;
  const allowed = deps.allowed || (() => true);
  const kindOf = deps.kind || (() => 'page');
  const widthOf = deps.width || (() => 1);
  const reducedMotion = deps.reducedMotion || (() => false);
  const blocked = deps.blocked || (() => false);
  const busy = deps.busy || (() => false);
  const onView = deps.onView || (() => {});
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || (id => clearTimeout(id));
  const snapMs = Number.isFinite(deps.snapMs) ? deps.snapMs : GESTURE_SNAP_MS;

  let session = null; // {mode:'page'|'overlay'|'ignored', follow, width, x, velocity, ended, endedAt, committed, absorbed}
  let view = null;
  let timer = null;
  let reducedCommit = 0; // 减少动态效果下刚完成的那一次的时刻（root.js 据此把返回转场换成 GESTURE_FADE_MS 淡化）

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function show(next) {
    view = next;
    onView(next);
  }

  function frame(phase, x, width) {
    const { top, under } = gestureLayerX(x, width);
    const kind = session && session.kind === 'phase' ? 'phase' : 'page';
    return { phase, kind, progress: Math.round((top / width) * 10000) / 10000, x: top, under, width };
  }

  /** 弹层跟手的一帧（overlay: true，root 按它位移最上层弹层而不是页面）。 */
  function overlayFrame(phase, x, width) {
    const w = Math.max(1, Number(width) || 1);
    const top = clampNum(x, 0, w);
    return { phase, overlay: true, progress: Math.round((top / w) * 10000) / 10000, x: top, under: 0, width: w };
  }

  function snapBack() {
    stopTimer();
    if (!view) return;
    show(view.overlay ? overlayFrame('snap', 0, view.width) : frame('snap', 0, view.width));
    timer = setTimer(() => {
      timer = null;
      if (view && view.phase === 'snap') show(null);
    }, snapMs + M.dur.xs);
  }

  function begin(x, width) {
    stopTimer();
    const s = getState() || {};
    if (blocked()) {
      session = { mode: 'ignored', ended: false };
      if (view) show(null);
      return session.mode;
    }
    if (s.topIsOverlay) {
      // 弹层开着：左缘右滑只作用于最上层弹层（02 §8、N3-6，与点「‹」时先关弹层一致），页面不动。
      // D58 / P1-06：跟手位移弹层，松手按同一阈值关掉或回弹（减少动态效果下不跟手，只按阈值判定）。
      const followOverlay = !reducedMotion();
      session = { mode: 'overlay', follow: followOverlay, width, x, velocity: 0, ended: false };
      if (followOverlay) show(overlayFrame('follow', x, width));
      else if (view) show(null);
      return session.mode;
    }
    if (pageDepth(s) === 0 || s.pending || busy() || !allowed()) {
      session = { mode: 'ignored', ended: false };
      return session.mode;
    }
    const follow = !reducedMotion();
    session = { mode: 'page', kind: kindOf() === 'phase' ? 'phase' : 'page', follow, width, x, velocity: 0, ended: false };
    if (follow) show(frame('follow', x, width));
    else if (view) show(null);
    return session.mode;
  }

  function end(committed) {
    session.ended = true;
    session.endedAt = now();
    session.committed = committed;
  }

  function live() {
    return !!session && !session.ended;
  }

  function widthNow() {
    return live() && session.width ? session.width : Math.max(1, Number(widthOf()) || 1);
  }

  function move(x) {
    if (!live()) {
      begin(x, widthNow()); // began 丢失的兜底：changed 开启新的手势
      return;
    }
    if (session.mode === 'overlay') {
      session.x = x;
      if (session.follow) show(overlayFrame('follow', x, session.width));
      return;
    }
    if (session.mode !== 'page') return;
    session.x = x;
    if (session.follow) show(frame('follow', x, session.width));
  }

  /** 完成（commit = true）或回弹。只对跟随中的页面手势有效；遮罩 / 不理会的手势只记下结束。返回是否完成。 */
  function settle(commit) {
    if (!live()) return false;
    if (session.mode === 'overlay') {
      // 弹层：过阈值关掉最上层弹层（退场从手指位置接着淡出，root 标 data-exit-kind），否则回弹；页面不动
      end(commit);
      if (!commit) {
        snapBack();
        return false;
      }
      if (session.follow && view) {
        show(overlayFrame('commit', session.x, session.width));
        stopTimer();
        timer = setTimer(() => {
          timer = null;
          if (view && view.phase === 'commit') show(null);
        }, GESTURE_COMMIT_TIMEOUT_MS);
      }
      closeOverlay();
      return true;
    }
    if (session.mode !== 'page') {
      end(false);
      return false;
    }
    end(commit);
    if (!commit) {
      snapBack();
      return false;
    }
    if (session.kind === 'phase') {
      // 页内回退（N3-3）：页面不出栈，没有返回转场来接手——先执行左上动作（页面在下一次渲染里换阶段，phase-fade 从此刻的画面淡过去），再收起跟手画面。
      stopTimer();
      back();
      if (view) show(null);
      return true;
    }
    if (session.follow) {
      show(frame('commit', session.x, session.width));
      stopTimer();
      timer = setTimer(() => {
        timer = null;
        if (view && view.phase === 'commit') snapBack();
      }, GESTURE_COMMIT_TIMEOUT_MS);
    } else {
      reducedCommit = now();
    }
    back();
    return true;
  }

  return {
    /** 处理一条 shizi-native-back-progress 的 detail（原生与网页兜底同一形状）。 */
    handle(detail) {
      const d = detail || {};
      const phase = d.phase;
      const width = widthNow();
      const x = clampNum(d.translationX, 0, width);
      if (phase === 'began') {
        begin(x, width);
        return;
      }
      if (phase === 'changed') {
        move(x);
        return;
      }
      if (!live()) return; // 没见过 began 的 ended / cancelled：不理会（shizi-native-back 照常返回）
      if (phase === 'ended') {
        if (session.mode === 'page' || session.mode === 'overlay') session.x = x;
        settle(backGestureCommits({ translationX: x, velocityX: d.velocityX }, session.width || width));
        return;
      }
      if (phase === 'cancelled') settle(false);
    },

    // ---- 与动画样式无关的进度接口（router.beginBack / setBackProgress / endBack / finishBack / cancelBack）

    /** 开始：返回 'page'（跟随）| 'overlay'（已关顶层遮罩）| 'ignored'。 */
    beginBack() {
      return begin(0, Math.max(1, Number(widthOf()) || 1));
    },
    /** 进度 p ∈ [0, 1]（按宽的比例）；没有进行中的手势时等于先开始。返回是否在跟随页面。 */
    setBackProgress(p, velocity = 0) {
      move(clampNum(p, 0, 1) * widthNow());
      if (live()) session.velocity = Number(velocity) || 0;
      return live() && (session.mode === 'page' || session.mode === 'overlay');
    },
    /** 松手：按阈值完成或回弹。返回是否完成。 */
    endBack(velocity) {
      if (!live()) return false;
      const v = velocity === undefined ? session.velocity || 0 : Number(velocity) || 0;
      return settle((session.mode === 'page' || session.mode === 'overlay') && backGestureCommits({ translationX: session.x, velocityX: v }, session.width));
    },
    /** 直接完成（不看阈值）。返回是否完成。 */
    finishBack() {
      return settle(true);
    },
    /** 取消（回弹）。 */
    cancelBack() {
      settle(false);
      return true;
    },

    /** shizi-native-back 到达时调用：属于刚结束、已由本控制器处理的那次手势 → true（吞掉），每次手势只吞一次。 */
    absorbNativeBack() {
      if (!session || !session.ended || session.absorbed || session.mode === 'ignored') return false;
      if (now() - session.endedAt > GESTURE_ABSORB_MS) return false;
      session.absorbed = true;
      return true;
    },

    /** 返回转场接手（从当前位置继续滑出）：交出位置并清掉跟手画面。没有在提交中则返回 null。 */
    handoff() {
      if (!view || view.phase !== 'commit') return null;
      const v = view;
      stopTimer();
      show(null);
      return v;
    },

    /** 减少动态效果下刚由手势完成的返回（每次只认一次，超过 GESTURE_COMMIT_TIMEOUT_MS 不算）：root.js 据此用 GESTURE_FADE_MS 淡化。 */
    takeReducedCommit() {
      if (!reducedCommit) return false;
      const fresh = now() - reducedCommit <= GESTURE_COMMIT_TIMEOUT_MS;
      reducedCommit = 0;
      return fresh;
    },

    /** 页面结构另有变化（非本次提交的转场）：立即清掉跟手画面。 */
    reset() {
      stopTimer();
      if (session && !session.ended) end(false);
      if (view) show(null);
    },

    /** 有没有正在跟随的页面手势（began 之后、ended / cancelled 之前）。 */
    isTracking: () => live() && session.mode === 'page',
    getView: () => view,
    getSession: () => (session ? { ...session } : null),
  };
}

// ---------------------------------------------------------------------------
// 浏览器接线：popstate 与原生返回事件。返回解绑函数。

export function attachWindow(router, win) {
  const onPop = event => router.handlePopState(event.state);
  const onNativeBack = () => router.handleNativeBack();
  win.addEventListener('popstate', onPop);
  win.addEventListener(NATIVE_BACK_EVENT, onNativeBack);
  return () => {
    win.removeEventListener('popstate', onPop);
    win.removeEventListener(NATIVE_BACK_EVENT, onNativeBack);
  };
}

// ---------------------------------------------------------------------------
// 当前路由器（各屏通过 nav.* 导航，不直接持有实例）

let activeRouter = null;

export function setActiveRouter(router) {
  activeRouter = router;
}

export function getRouter() {
  return activeRouter;
}

function need() {
  if (!activeRouter) throw new Error('router not started');
  return activeRouter;
}

export const nav = {
  push: (name, params) => need().push(name, params),
  replace: (name, params, opts) => need().replace(name, params, opts),
  back: opts => need().back(opts),
  switchTab: name => need().switchTab(name),
  whenIdle: fn => need().whenIdle(fn),
  setParams: patch => need().setParams(patch),
  openOverlay: (component, props, opts) => need().openOverlay(component, props, opts),
  updateOverlay: (id, props) => need().updateOverlay(id, props),
  closeOverlay: id => need().closeOverlay(id),
  canGoBack: () => need().canGoBack(),
  // R4-G1 交互式返回（进度驱动当前返回转场；与动画样式解耦）
  beginBack: () => need().beginBack(),
  setBackProgress: (p, velocity) => need().setBackProgress(p, velocity),
  endBack: velocity => need().endBack(velocity),
  finishBack: () => need().finishBack(),
  cancelBack: () => need().cancelBack(),
};
