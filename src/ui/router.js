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

export const STATE_TAG = 'shizi-router';
export const STATE_VERSION = 1;

// 原生壳事件（01-架构设计 §7、§8.1）。M0-4 期间兼容的别名 'shizi-native-progress' 已在 M5-3 删除（Swift 只派发下面两个）。
export const NATIVE_BACK_EVENT = 'shizi-native-back';
export const NATIVE_PROGRESS_EVENT = 'shizi-native-back-progress';
/** 读屏「两指 Z 形」退出手势（A2-05）：Swift 的 WebViewController.accessibilityPerformEscape 派发；页面关闭最上层弹层（没有弹层时什么都不做）。 */
export const NATIVE_ESCAPE_EVENT = 'shizi-native-escape';

// history.back()/go() 发出后等 popstate 的上限；超时则放弃等待、继续执行排队的操作。
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
    // 01 §7：本屏在顶层期间自己管原生左缘返回手势门控（写字页整页 false）；根组件此时不发 backGestureEnabled。
    ownsBackGesture: opts.ownsBackGesture === true,
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

    // 就地换掉顶层页面（不新增条目、无转场），例如写字页最后一字直接换成结果页。
    replace(name, params = {}) {
      const def = getScreen(name);
      if (!def || def.tab) throw new Error(`router.replace: "${name}" is not a registered sub screen`);
      run(() => {
        if (depth === 0 || stack[stack.length - 1].k !== 's') throw new Error('router.replace: top entry is not a sub screen');
        const from = stack[stack.length - 1];
        const entry = { k: 's', id: nextId(), n: name, p: params };
        stack = [...stack.slice(0, -1), entry];
        history.replaceState(makeState(stack, depth), '');
        navSeq += 1;
        setTransition('replace', { animate: false, cause: 'ui', from, to: entry });
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
// 写字页（ownsBackGesture）为顶层时由它自己置 false，根组件不插手；bridge.setBackGestureEnabled 只在值变化时发。

/** 页面栈深度：页面条目数 − 1（遮罩不算）。0 = tab 根页。 */
export function pageDepth(snap) {
  if (!snap || !Array.isArray(snap.stack)) return 0;
  let n = 0;
  for (const e of snap.stack) if (e && e.k === 's') n += 1;
  return Math.max(0, n - 1);
}

/** 按路由快照（与是否阻断）算原生左缘返回手势该不该开：阻断页 / tab 根页 false，有子页 true。 */
export function backGestureAllowed(snap, blocked = false) {
  return !blocked && pageDepth(snap) > 0;
}

/**
 * 根组件用的门控同步器（纯逻辑，可注入 send 与屏幕查询，单测用）。
 * update(snap, blocked) 只在「页面栈深度 / 阻断」变化时发一次；顶层页面 ownsBackGesture 时只记下深度、不发。
 * @param {{send: (value:boolean) => any, screenOf?: (name:string) => any}} deps
 */
export function createBackGestureSync({ send, screenOf = getScreen }) {
  let lastKey;
  return {
    update(snap, blocked = false) {
      const key = blocked ? 'blocked' : pageDepth(snap);
      if (key === lastKey) return false;
      lastKey = key;
      if (!blocked) {
        const top = snap && snap.top ? screenOf(snap.top.n) : null;
        if (top && top.ownsBackGesture) return false;
      }
      send(backGestureAllowed(snap, blocked));
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// 跟手交互式返回（M6-5，01 §7：Swift 的 UIScreenEdgePanGestureRecognizer 是手势唯一所有者，
// 每个阶段派发 shizi-native-back-progress {phase, translationX, progress, velocityX}；JS 只按事件渲染）。
//
// - began：遮罩栈非空（顶层是遮罩）→ 直接关顶层遮罩，页面不动，本次手势余下的事件都不跟随；
//          否则有子页 → 冻结底层页（露出、不可点），开始跟随；tab 根 / 阻断 / 转场或导航进行中 → 不理会。
// - changed：顶层页 translateX 跟手，底层页视差（从 -BACK_PARALLAX × 宽 滑到 0），顶层页带左投影。
// - ended：速度 > BACK_COMMIT_VELOCITY，或（位移 > BACK_COMMIT_RATIO × 宽 且 速度 > BACK_RETURN_VELOCITY，即没有明显往回拉）
//          → 提交 back（转场从当前位置接着走）；否则回弹（P103 / D36，与系统返回手势对齐）。
// - cancelled：回弹。
// - 减少动态效果：不跟随（页面不动），ended 仍按阈值提交（转场走交叉淡化）。
// - Swift 在 ended 越过同一阈值时紧接着派发 shizi-native-back：本次手势已处理，由 absorbNativeBack() 吞掉。
// 纯逻辑（状态、计时器、宽度都可注入），渲染由 onView(view) 交给 ui/root.js；单测 test/ui/gesture.test.mjs。

// 与 ios/ShiziApp/ShiziApp/WebViewController.swift dispatchBackGesture 的阈值一致（改一处必须改另一处）。
export const BACK_COMMIT_RATIO = 0.5; // 位移过半个宽才算（D36：原 24%）
export const BACK_COMMIT_VELOCITY = 500; // pt/s（= CSS px/s）：向右甩过这个速度，不看位移（D36：原 650）
export const BACK_RETURN_VELOCITY = -200; // pt/s：位移过半后若向左回拉快过这个速度，视为取消（D36）
export const BACK_PARALLAX = 0.3;
export const GESTURE_SNAP_MS = 200;
// ended 之后多久内到达的 shizi-native-back 算「同一次手势」（Swift 在同一段脚本里紧接着派发，实际是同步的）。
export const GESTURE_ABSORB_MS = 600;
// 提交后等不到返回转场（history 卡住）就回弹，不让页面停在半路。
export const GESTURE_COMMIT_TIMEOUT_MS = PENDING_TIMEOUT_MS + 200;

function clampNum(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** ended 时是否提交返回：v > 500 || (x > 50% 宽 && v > -200)。 */
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
 * @param {() => any} deps.back                返回一层 / 关顶层遮罩（router.back({cause:'native'})）
 * @param {() => number} [deps.width]          视口宽（CSS px）
 * @param {() => boolean} [deps.reducedMotion]
 * @param {() => boolean} [deps.blocked]       阻断页（R-B09）
 * @param {() => boolean} [deps.busy]          页面转场进行中
 * @param {(view: null | {phase:'follow'|'snap'|'commit', x:number, under:number, width:number}) => void} [deps.onView]
 */
export function createBackGestureController(deps) {
  const getState = deps.getState;
  const back = deps.back;
  const widthOf = deps.width || (() => 1);
  const reducedMotion = deps.reducedMotion || (() => false);
  const blocked = deps.blocked || (() => false);
  const busy = deps.busy || (() => false);
  const onView = deps.onView || (() => {});
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout || (id => clearTimeout(id));
  const snapMs = Number.isFinite(deps.snapMs) ? deps.snapMs : GESTURE_SNAP_MS;

  let session = null; // {mode:'page'|'overlay'|'ignored', follow, width, x, ended, endedAt, committed, absorbed}
  let view = null;
  let timer = null;

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
    return { phase, x: top, under, width };
  }

  function snapBack() {
    stopTimer();
    if (!view) return;
    show(frame('snap', 0, view.width));
    timer = setTimer(() => {
      timer = null;
      if (view && view.phase === 'snap') show(null);
    }, snapMs + 20);
  }

  function begin(x, width) {
    stopTimer();
    const s = getState() || {};
    if (blocked()) {
      session = { mode: 'ignored', ended: false };
      if (view) show(null);
      return;
    }
    if (s.topIsOverlay) {
      // 弹层开着：左缘右滑先关遮罩（02 §8），页面不动。
      session = { mode: 'overlay', ended: false };
      if (view) show(null);
      back();
      return;
    }
    if (pageDepth(s) === 0 || s.pending || busy()) {
      session = { mode: 'ignored', ended: false };
      return;
    }
    const follow = !reducedMotion();
    session = { mode: 'page', follow, width, x, ended: false };
    if (follow) show(frame('follow', x, width));
    else if (view) show(null);
  }

  function end(committed) {
    session.ended = true;
    session.endedAt = now();
    session.committed = committed;
  }

  return {
    /** 处理一条 shizi-native-back-progress 的 detail。 */
    handle(detail) {
      const d = detail || {};
      const phase = d.phase;
      const live = session && !session.ended;
      const width = live && session.width ? session.width : Math.max(1, Number(widthOf()) || 1);
      const x = clampNum(d.translationX, 0, width);
      if (phase === 'began' || (phase === 'changed' && !live)) {
        begin(x, width);
        return;
      }
      if (!live) return; // 没见过 began 的 ended / cancelled：不理会（shizi-native-back 照常返回）
      if (phase === 'changed') {
        if (session.mode !== 'page') return;
        session.x = x;
        if (session.follow) show(frame('follow', x, width));
        return;
      }
      if (phase === 'ended') {
        if (session.mode !== 'page') {
          end(false);
          return;
        }
        session.x = x;
        const commit = backGestureCommits({ translationX: x, velocityX: d.velocityX }, width);
        end(commit);
        if (!commit) {
          snapBack();
          return;
        }
        if (session.follow) {
          show(frame('commit', x, width));
          stopTimer();
          timer = setTimer(() => {
            timer = null;
            if (view && view.phase === 'commit') snapBack();
          }, GESTURE_COMMIT_TIMEOUT_MS);
        }
        back();
        return;
      }
      if (phase === 'cancelled') {
        end(false);
        if (session.mode === 'page') snapBack();
      }
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

    /** 页面结构另有变化（非本次提交的转场）：立即清掉跟手画面。 */
    reset() {
      stopTimer();
      if (session && !session.ended) end(false);
      if (view) show(null);
    },

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
  replace: (name, params) => need().replace(name, params),
  back: opts => need().back(opts),
  switchTab: name => need().switchTab(name),
  whenIdle: fn => need().whenIdle(fn),
  setParams: patch => need().setParams(patch),
  openOverlay: (component, props, opts) => need().openOverlay(component, props, opts),
  updateOverlay: (id, props) => need().updateOverlay(id, props),
  closeOverlay: id => need().closeOverlay(id),
  canGoBack: () => need().canGoBack(),
};
