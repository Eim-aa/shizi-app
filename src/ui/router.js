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
// - 本模块不碰 DOM：history 与计时器可注入，node:test 直接跑（test/ui/router.test.mjs）；
//   浏览器接线见 attachWindow()，渲染与转场见 ui/root.js。

export const STATE_TAG = 'shizi-router';
export const STATE_VERSION = 1;

// 原生壳事件（01-架构设计 §7、§8.1）。M0-4 任务卡写的是 'shizi-native-progress'，
// 架构文档写的是 'shizi-native-back-progress'：两个都监听，以架构文档为准（见报告待定项）。
export const NATIVE_BACK_EVENT = 'shizi-native-back';
export const NATIVE_PROGRESS_EVENT = 'shizi-native-back-progress';
export const NATIVE_PROGRESS_EVENT_ALIAS = 'shizi-native-progress';

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

  function setTransition(kind, { animate, cause, from, to }) {
    seq += 1;
    transition = { seq, kind, animate, cause, from, to };
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

    handleNativeBack() {
      return router.back({ cause: 'native' });
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
  setParams: patch => need().setParams(patch),
  openOverlay: (component, props, opts) => need().openOverlay(component, props, opts),
  updateOverlay: (id, props) => need().updateOverlay(id, props),
  closeOverlay: id => need().closeOverlay(id),
  canGoBack: () => need().canGoBack(),
};
