// 根组件：把 router 的页面栈 / 遮罩栈画成一叠图层，负责转场、焦点、防连点时钟与原生返回进度。
// 规则见 01-架构设计 §7：
// - 推入 300ms cubic-bezier(.2,.7,.2,1) 带左投影，返回反向；
// - 减少动态效果：120ms 交叉淡化（R-G01；任务卡写「直接切换」，两者不一致，见报告待定项）；
// - iOS 主屏 PWA（display-mode: standalone）下由系统返回（popstate）引发的返回跳过转场；
// - 原生 shizi-native-back-progress 事件驱动跟手交互式返回（M6-5，逻辑在 router.createBackGestureController）：
//   began 冻结底层页（露出、不可点、跟手期间不重画——位移直接写 style.transform，不走 setState），changed 顶层页跟手、
//   底层页视差、顶层页左投影；ended 过阈值提交 back（转场从手指位置接着滑出），否则回弹；cancelled 回弹；
//   顶层是遮罩时 began 只关遮罩、页面不动；减少动态效果时不跟随，只按阈值提交；
// - 原生左缘返回门控：tab 根页 / 阻断页 backGestureEnabled(false)，有子页 true；只在页面栈深度或阻断变化时发，
//   写字页为顶层时由写字页自己管（router.createBackGestureSync）。
// 每个页面图层一直挂着（下面的页面 visibility:hidden），返回时页面内状态与滚动位置都在。
import { html, render, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/ui.js';
import {
  attachWindow,
  createBackGestureController,
  createBackGestureSync,
  createRouter,
  getScreen,
  listTabs,
  nav,
  NATIVE_PROGRESS_EVENT,
  pageDepth,
  setActiveRouter,
} from './router.js';
import { setBackGestureEnabled } from '../platform/bridge.js';
import { isStandalone, isTestHost } from '../platform/env.js';
import { markStateChange } from './components/Button.js';
import { Tabs } from './components/Tabs.js';
import { ToastHost } from './components/Toast.js';
import { injectStyles, T } from './components/styles.js';
import './screens/home/index.js';
import './screens/library/index.js';
import './screens/mine/index.js';
import './screens/detail/index.js'; // M3-6 单字详情（'detail' / 'detail-photo'）：各入口按屏名 push，刷新时也要能恢复
import './images-entry.js'; // M4-5 图片：向结果页 / 单字详情 / 我的注册「做图片」去处（没注册时入口不显示）
import './screens/mine/about.js'; // M4-6 关于（'about' 与三个子页）：「我的」菜单按屏名 push，刷新时也要能恢复
import './screens/mine/settings.js'; // M4-3 设置（'settings'）：「我的」菜单按屏名 push，刷新时也要能恢复
import './screens/mine/backup.js'; // M4-4 备份与恢复（'backup'）：菜单 / 设置按屏名 push；刷新后仍在本页要能恢复撤销（P32）；原生备份桥注册
import './screens/mine/annual.js'; // M4-2 年度报告（'annual'）：「我的」菜单按屏名 push，刷新时也要能恢复
import { BlockScreen, useBlockReason } from './screens/block/index.js'; // M5-6 R-B09：存储不可用 / 阻断 / 迁移失败时只画阻断页
import { CorruptNotice } from './components/corrupt-notice.js'; // M5-6 坏值一次性顶部提示（01 §4，P55）
import { getStore } from '../store/store.js';

export const PUSH_MS = 300;
export const PUSH_EASING = 'cubic-bezier(.2,.7,.2,1)';
export const FADE_MS = 120;
export const SNAP_MS = 200;
// 跟手提交后的返回转场按剩余距离缩短，但不短于这个值。
const GESTURE_POP_MIN_MS = 150;

injectStyles('root', `
.sz-app{position:fixed;inset:0;overflow:hidden;background:${T.p};color:${T.i1};font-family:${T.sans};
  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
.sz-layer{position:absolute;inset:0;overflow:hidden;background:${T.p};display:flex;flex-direction:column}
.sz-layer--moving{box-shadow:-12px 0 24px rgba(48,38,26,.12)}
.sz-layer--snap{transition:transform ${SNAP_MS}ms ${PUSH_EASING}}
.sz-layer--under{pointer-events:none}
.sz-layer__screen{flex:1;min-height:0;display:flex;flex-direction:column}
.sz-layer__screen>.sz-page{flex:1;height:auto}
.sz-tabroot{flex:1;min-height:0;display:flex;flex-direction:column}
.sz-tabroot__panel{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
`);

function matches(win, query) {
  try {
    return !!(win.matchMedia && win.matchMedia(query).matches);
  } catch (error) {
    return false;
  }
}

function prefersReducedMotion(win) {
  return matches(win, '(prefers-reduced-motion: reduce)');
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function groupStack(stack) {
  const groups = [];
  for (const e of stack) {
    if (e.k === 's') groups.push({ screen: e, overlays: [] });
    else if (groups.length) groups[groups.length - 1].overlays.push(e);
  }
  return groups;
}

function OverlayHost({ router, id, active }) {
  const o = router.getOverlay(id);
  if (!o) return null;
  const C = o.component;
  return html`<${C} ...${o.props} overlayId=${id} active=${active} close=${() => router.closeOverlay(id)} />`;
}

function TabRoot({ entry }) {
  const def = getScreen(entry.n);
  const Comp = def ? def.component : null;
  const items = listTabs().map(t => ({ id: t.name, label: t.label, icon: t.icon, panelId: 'sz-tabpanel' }));
  return html`<div class="sz-tabroot">
    <div class="sz-tabroot__panel" role="tabpanel" id="sz-tabpanel" aria-labelledby=${`sz-tab-${entry.n}`}>
      ${Comp ? html`<${Comp} key=${entry.n} params=${entry.p} entry=${entry} />` : null}
    </div>
    <${Tabs} items=${items} selected=${entry.n} onSelect=${name => nav.switchTab(name)} />
  </div>`;
}

function Layer({ router, group, isRoot, visible, isTop }) {
  const e = group.screen;
  const def = getScreen(e.n);
  const Comp = def ? def.component : null;
  const topOverlay = group.overlays.length ? group.overlays[group.overlays.length - 1].id : null;
  const content = isRoot
    ? html`<${TabRoot} entry=${e} />`
    : Comp ? html`<${Comp} params=${e.p} entry=${e} />` : null;
  // transform 与 sz-layer--moving/--snap/--under 由转场与跟手手势直接写 DOM（style 里不带 transform，Preact 不会覆盖）。
  const style = { visibility: visible ? 'visible' : 'hidden' };
  return html`<div
    class="sz-layer"
    data-entry=${e.id}
    data-screen=${e.n}
    data-top=${isTop ? 'true' : undefined}
    aria-hidden=${isTop ? undefined : 'true'}
    style=${style}
  >
    <div class="sz-layer__screen" aria-hidden=${topOverlay ? 'true' : undefined}>${content}</div>
    ${group.overlays.map(o => html`<${OverlayHost} key=${o.id} router=${router} id=${o.id} active=${isTop && o.id === topOverlay} />`)}
  </div>`;
}

function Root({ router, win }) {
  const [snap, setSnap] = useState(() => router.getState());
  const [gestureOn, setGestureOn] = useState(false); // 跟手中（含回弹、提交后等转场）：底层页露出
  const [, force] = useState(0);
  const block = useBlockReason(getStore); // M5-6
  const appRef = useRef(null);
  const animRef = useRef({ handledSeq: snap.transition ? snap.transition.seq : 0, current: null, running: null });
  const gestureRef = useRef({ ctrl: null, els: null });
  const blockedRef = useRef(false);
  const focusRef = useRef({ handledSeq: snap.transition ? snap.transition.seq : 0, saved: new Map() });

  useEffect(() => {
    const off = router.subscribe(setSnap);
    setSnap(router.getState());
    return off;
  }, [router]);

  // 由 transition 推导本次转场（渲染期决定，保证新图层第一帧就带着起始位置）。
  const t = snap.transition;
  if (t && t.seq !== animRef.current.handledSeq) {
    animRef.current.handledSeq = t.seq;
    const ctrl = gestureRef.current.ctrl;
    const gv = ctrl ? ctrl.getView() : null;
    const fromGesture = !!(t.kind === 'pop' && t.cause === 'native' && gv && gv.phase === 'commit' &&
      t.from && gestureRef.current.els && gestureRef.current.els.topId === t.from.id);
    if (t.animate && (t.kind === 'push' || t.kind === 'pop') && t.from && t.to) {
      animRef.current.current = {
        seq: t.seq,
        kind: t.kind,
        mode: prefersReducedMotion(win) ? 'fade' : 'slide',
        from: t.from,
        to: t.to,
        startX: fromGesture ? gv.x : 0,
        underX: fromGesture ? gv.under : 0,
        width: fromGesture ? gv.width : 0,
        fromGesture,
      };
    } else {
      animRef.current.current = null;
    }
    // 跟手画面只由它自己的提交转场接手；其它结构变化（replace、tab、另一处返回）立即清掉。
    if (ctrl && gv && !fromGesture) animRef.current.resetGesture = true;
  }
  const anim = animRef.current.current;

  // 转场执行（Web Animations；iOS 15 可用）。
  useLayoutEffect(() => {
    const a = animRef.current.current;
    const running = animRef.current.running;
    if (running && running !== a && running.cancel) running.cancel();
    if (animRef.current.resetGesture) {
      animRef.current.resetGesture = false;
      if (gestureRef.current.ctrl) gestureRef.current.ctrl.reset();
    }
    if (!a || a.started) return;
    a.started = true;
    animRef.current.running = a;
    // 跟手提交的返回：先清跟手写下的 transform / 类名，下面的动画从同一位置接着走（都在绘制前，不闪）。
    if (a.fromGesture && gestureRef.current.ctrl) gestureRef.current.ctrl.handoff();
    const rootEl = appRef.current;
    const pick = id => (rootEl ? rootEl.querySelector(`.sz-layer[data-entry="${id}"]`) : null);
    const fade = a.mode === 'fade';
    const moving = a.kind === 'push' ? pick(a.to.id) : pick(a.from.id);
    // 跟手提交：顶层页从手指位置滑出、底层页从视差位置归位，时长按剩余距离缩短。
    const under = a.fromGesture && !fade ? pick(a.to.id) : null;
    const rest = a.fromGesture && a.width ? Math.max(0, 1 - a.startX / a.width) : 1;
    const frames = a.kind === 'push'
      ? (fade ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }])
      : (fade ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: `translateX(${a.startX}px)` }, { transform: 'translateX(100%)' }]);
    const opts = fade
      ? { duration: FADE_MS, easing: 'linear', fill: 'both' }
      : { duration: a.fromGesture ? Math.max(GESTURE_POP_MIN_MS, Math.round(PUSH_MS * rest)) : PUSH_MS, easing: PUSH_EASING, fill: 'both' };
    if (moving && !fade) moving.classList.add('sz-layer--moving');
    let animation = null;
    let underAnimation = null;
    if (moving && typeof moving.animate === 'function') {
      animation = moving.animate(frames, opts);
    }
    if (under && typeof under.animate === 'function') {
      underAnimation = under.animate([{ transform: `translateX(${a.underX}px)` }, { transform: 'translateX(0)' }], opts);
    }
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const anm of [animation, underAnimation]) {
        if (!anm) continue;
        try {
          anm.cancel();
        } catch (error) {
          // 已结束
        }
      }
      if (moving) moving.classList.remove('sz-layer--moving');
      // 渲染期闭包还抓着 a（hook 里留存的上一轮 effect）；断开 a → finish → moving，出栈的图层 DOM 才能回收（M6-3）。
      a.cancel = null;
      if (animRef.current.running === a) animRef.current.running = null;
      if (animRef.current.current === a) {
        animRef.current.current = null;
        force(n => n + 1);
      }
    };
    a.cancel = finish;
    if (animation) animation.onfinish = finish;
    timer = setTimeout(finish, opts.duration + 150);
  });

  // 原生左缘返回门控（01 §7）：页面栈深度 / 阻断变化时同步一次。effect 在子组件之后执行，
  // 所以写字页（ownsBackGesture）为顶层时 createBackGestureSync 不发，免得盖掉写字页的 false。
  const gateRef = useRef(null);
  if (!gateRef.current) gateRef.current = createBackGestureSync({ send: setBackGestureEnabled });
  const gateDepth = pageDepth(snap);
  const blocked = !!block.reason;
  blockedRef.current = blocked;
  useEffect(() => {
    gateRef.current.update(snap, blocked);
  }, [gateDepth, blocked]);

  // 防连点时钟：页面或遮罩结构每变一次，按钮 0.4s 不响应（01-架构设计 §6.6）。
  useEffect(() => {
    markStateChange();
  }, [snap.navSeq]);

  // 焦点：推入 → 新页标题；返回 → 回到当初点下去的那个控件；切 tab 与启动不动焦点。
  useEffect(() => {
    const tr = snap.transition;
    const f = focusRef.current;
    if (!tr || tr.seq === f.handledSeq || typeof document === 'undefined') return;
    f.handledSeq = tr.seq;
    const live = new Set(snap.stack.map(e => e.id));
    for (const id of [...f.saved.keys()]) if (!live.has(id)) f.saved.delete(id);
    if (tr.kind === 'push' && tr.from) f.saved.set(tr.from.id, document.activeElement);
    if (!tr.to || tr.kind === 'tab' || tr.kind === 'none') return;
    const layer = appRef.current && appRef.current.querySelector(`.sz-layer[data-entry="${tr.to.id}"]`);
    if (!layer) return;
    let target = null;
    if (tr.kind === 'pop') {
      const el = f.saved.get(tr.to.id);
      f.saved.delete(tr.to.id);
      if (el && el.isConnected && layer.contains(el)) target = el;
    }
    if (!target) {
      if (layer.querySelector('[role="dialog"],[role="alertdialog"]')) return; // 弹层自己管焦点
      target = layer.querySelector('[data-autofocus]') || layer.querySelector('[data-page-title]');
    }
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }, [snap.transition]);

  // Esc：关最上层遮罩（键盘可达；页面返回用页头返回键）。
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!router.getState().topIsOverlay) return;
      event.preventDefault();
      router.back();
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, [router, win]);

  // 原生左缘手势进度（Swift 唯一所有者；JS 只按事件渲染）。M6-5 跟手交互式返回，见文件头与 router.createBackGestureController。
  useEffect(() => {
    const g = gestureRef.current;
    const pickLayer = id => (appRef.current ? appRef.current.querySelector(`.sz-layer[data-entry="${id}"]`) : null);
    const clearEls = () => {
      const els = g.els;
      g.els = null;
      if (!els) return;
      for (const el of [els.top, els.under]) {
        if (!el) continue;
        el.style.transform = '';
        el.classList.remove('sz-layer--moving', 'sz-layer--snap', 'sz-layer--under');
      }
    };
    // 画面只写 DOM：跟手期间页面组件不重画（冻结），只在开始 / 结束各 setState 一次（露出 / 收起底层页）。
    const onView = view => {
      if (!view) {
        clearEls();
        setGestureOn(false);
        return;
      }
      if (!g.els) {
        const pages = router.getState().stack.filter(e => e.k === 's');
        const topE = pages[pages.length - 1];
        const underE = pages[pages.length - 2];
        g.els = {
          topId: topE ? topE.id : null,
          top: topE ? pickLayer(topE.id) : null,
          under: underE ? pickLayer(underE.id) : null,
        };
        if (g.els.top) g.els.top.classList.add('sz-layer--moving');
        if (g.els.under) g.els.under.classList.add('sz-layer--under');
        setGestureOn(true);
      }
      const snapping = view.phase === 'snap';
      const { top, under } = g.els;
      if (top) {
        top.classList.toggle('sz-layer--snap', snapping);
        top.style.transform = `translateX(${view.x}px)`;
      }
      if (under) {
        under.classList.toggle('sz-layer--snap', snapping);
        under.style.transform = `translateX(${view.under}px)`;
      }
    };
    const ctrl = createBackGestureController({
      getState: () => router.getState(),
      back: () => router.back({ cause: 'native' }),
      width: () => win.innerWidth || 1,
      reducedMotion: () => prefersReducedMotion(win),
      blocked: () => blockedRef.current,
      busy: () => !!animRef.current.current,
      now: nowMs,
      snapMs: SNAP_MS,
      onView,
    });
    g.ctrl = ctrl;
    router.setNativeBackFilter(() => ctrl.absorbNativeBack());
    const onProgress = event => ctrl.handle((event && event.detail) || {});
    win.addEventListener(NATIVE_PROGRESS_EVENT, onProgress);
    return () => {
      win.removeEventListener(NATIVE_PROGRESS_EVENT, onProgress);
      router.setNativeBackFilter(null);
      ctrl.reset();
      clearEls();
      g.ctrl = null;
    };
  }, [router, win]);

  // M5-6 R-B09：不画 tab 与页面栈（写字入口不可达），只画阻断页。
  if (block.reason) {
    return html`<div class="sz-app" ref=${appRef} data-nav-anim="idle" data-depth=${snap.depth} data-top-screen="block"
      data-tab=${snap.tab} data-blocked=${block.reason.kind}>
      <div class="sz-layer" data-top="true" data-screen="block"><${BlockScreen} reason=${block.reason} store=${block.store} win=${win} /></div>
      <${ToastHost} />
    </div>`;
  }

  const groups = groupStack(snap.stack);
  if (anim && anim.kind === 'pop' && !groups.some(g => g.screen.id === anim.from.id)) {
    groups.push({ screen: anim.from, overlays: [], leaving: true });
  }
  const topId = snap.top ? snap.top.id : null;
  const visible = new Set([topId]);
  if (anim) {
    visible.add(anim.from.id);
    visible.add(anim.to.id);
  }
  const dragging = !anim && gestureOn && groups.length >= 2;
  if (dragging) visible.add(groups[groups.length - 2].screen.id);
  const navAnim = anim ? `${anim.kind}-${anim.mode}` : dragging ? 'drag' : 'idle';

  return html`<div class="sz-app" ref=${appRef} data-nav-anim=${navAnim} data-depth=${snap.depth}
    data-top-screen=${snap.top ? snap.top.n : ''} data-tab=${snap.tab}>
    ${groups.map((g, i) => html`<${Layer}
      key=${i === 0 ? 'tab-root' : g.screen.id}
      router=${router}
      group=${g}
      isRoot=${i === 0}
      visible=${visible.has(g.screen.id)}
      isTop=${g.screen.id === topId}
    />`)}
    <${CorruptNotice} getStore=${getStore} />
    <${ToastHost} />
  </div>`;
}

/**
 * 建 router、接 window、挂根组件。M0-5 起 app.js 在此之前建好 store。
 * @returns {Promise<{router, unmount: () => void}>}
 */
export async function mountRoot(container, { win = window, defaultTab = 'home' } = {}) {
  if (isTestHost(win)) await import('./screens/_demo/sub.js');
  const router = createRouter({ history: win.history, isStandalone: () => isStandalone(win) });
  setActiveRouter(router);
  const detach = attachWindow(router, win);
  router.start({ defaultTab });
  render(html`<${Root} router=${router} win=${win} />`, container);
  return {
    router,
    unmount() {
      detach();
      render(null, container);
      setActiveRouter(null);
    },
  };
}
