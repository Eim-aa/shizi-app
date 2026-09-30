// 根组件：把 router 的页面栈 / 遮罩栈画成一叠图层，负责转场、焦点、防连点时钟与原生返回进度。
// 规则见 01-架构设计 §7：
// - 推入 300ms cubic-bezier(.2,.7,.2,1) 带左投影，返回反向；
// - 减少动态效果：120ms 交叉淡化（R-G01；任务卡写「直接切换」，两者不一致，见报告待定项）；
// - iOS 主屏 PWA（display-mode: standalone）下由系统返回（popstate）引发的返回跳过转场；
// - 原生 shizi-native-back-progress 事件驱动跟手位移（M0 最小实现，完整跟手在 M6）。
// 每个页面图层一直挂着（下面的页面 visibility:hidden），返回时页面内状态与滚动位置都在。
import { html, render, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/ui.js';
import {
  attachWindow,
  createRouter,
  getScreen,
  listTabs,
  nav,
  NATIVE_PROGRESS_EVENT,
  NATIVE_PROGRESS_EVENT_ALIAS,
  setActiveRouter,
} from './router.js';
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
// 原生手势 ended 之后等 shizi-native-back 的时间；超过就回弹。
const NATIVE_END_GRACE_MS = 250;

injectStyles('root', `
.sz-app{position:fixed;inset:0;overflow:hidden;background:${T.p};color:${T.i1};font-family:${T.sans};
  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
.sz-layer{position:absolute;inset:0;overflow:hidden;background:${T.p};display:flex;flex-direction:column}
.sz-layer--moving{box-shadow:-12px 0 24px rgba(48,38,26,.12)}
.sz-layer--snap{transition:transform ${SNAP_MS}ms ${PUSH_EASING}}
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

function Layer({ router, group, isRoot, visible, isTop, dragX, snapping }) {
  const e = group.screen;
  const def = getScreen(e.n);
  const Comp = def ? def.component : null;
  const topOverlay = group.overlays.length ? group.overlays[group.overlays.length - 1].id : null;
  const content = isRoot
    ? html`<${TabRoot} entry=${e} />`
    : Comp ? html`<${Comp} params=${e.p} entry=${e} />` : null;
  const style = { visibility: visible ? 'visible' : 'hidden' };
  if (dragX != null) style.transform = `translateX(${dragX}px)`;
  return html`<div
    class=${snapping ? 'sz-layer sz-layer--snap' : 'sz-layer'}
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
  const [drag, setDrag] = useState(null); // {x, snapping?}
  const [, force] = useState(0);
  const block = useBlockReason(getStore); // M5-6
  const appRef = useRef(null);
  const animRef = useRef({ handledSeq: snap.transition ? snap.transition.seq : 0, current: null, running: null });
  const dragRef = useRef({ active: false, x: 0, at: -Infinity, timer: null });
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
    if (t.animate && (t.kind === 'push' || t.kind === 'pop') && t.from && t.to) {
      const d = dragRef.current;
      const fromDrag = t.kind === 'pop' && t.cause === 'native' && (d.active || nowMs() - d.at < 600) ? d.x : 0;
      animRef.current.current = {
        seq: t.seq,
        kind: t.kind,
        mode: prefersReducedMotion(win) ? 'fade' : 'slide',
        from: t.from,
        to: t.to,
        startX: fromDrag,
      };
    } else {
      animRef.current.current = null;
    }
  }
  const anim = animRef.current.current;

  // 转场执行（Web Animations；iOS 15 可用）。
  useLayoutEffect(() => {
    const a = animRef.current.current;
    const running = animRef.current.running;
    if (running && running !== a && running.cancel) running.cancel();
    if (!a || a.started) return;
    a.started = true;
    animRef.current.running = a;
    if (dragRef.current.active || drag) {
      clearTimeout(dragRef.current.timer);
      dragRef.current = { active: false, x: 0, at: -Infinity, timer: null };
      setDrag(null);
    }
    const rootEl = appRef.current;
    const pick = id => (rootEl ? rootEl.querySelector(`.sz-layer[data-entry="${id}"]`) : null);
    const fade = a.mode === 'fade';
    const moving = a.kind === 'push' ? pick(a.to.id) : pick(a.from.id);
    const frames = a.kind === 'push'
      ? (fade ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }])
      : (fade ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: `translateX(${a.startX}px)` }, { transform: 'translateX(100%)' }]);
    const opts = fade
      ? { duration: FADE_MS, easing: 'linear', fill: 'both' }
      : { duration: PUSH_MS, easing: PUSH_EASING, fill: 'both' };
    if (moving && !fade) moving.classList.add('sz-layer--moving');
    let animation = null;
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (animation) {
        try {
          animation.cancel();
        } catch (error) {
          // 已结束
        }
      }
      if (moving) moving.classList.remove('sz-layer--moving');
      if (animRef.current.running === a) animRef.current.running = null;
      if (animRef.current.current === a) {
        animRef.current.current = null;
        force(n => n + 1);
      }
    };
    a.cancel = finish;
    if (moving && typeof moving.animate === 'function') {
      animation = moving.animate(frames, opts);
      animation.onfinish = finish;
    }
    timer = setTimeout(finish, opts.duration + 150);
  });

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

  // 原生左缘手势进度（Swift 唯一所有者；JS 只按事件渲染）。
  useEffect(() => {
    const snapBack = () => {
      clearTimeout(dragRef.current.timer);
      const timer = setTimeout(() => setDrag(cur => (cur && cur.snapping ? null : cur)), SNAP_MS + 20);
      dragRef.current = { active: false, x: 0, at: -Infinity, timer };
      setDrag({ x: 0, snapping: true });
    };
    const onProgress = event => {
      const detail = (event && event.detail) || {};
      const s = router.getState();
      if (s.depth === 0 || s.topIsOverlay || animRef.current.current) return;
      const width = win.innerWidth || 1;
      const x = Math.min(width, Math.max(0, Number(detail.translationX) || 0));
      const d = dragRef.current;
      if (detail.phase === 'began' || detail.phase === 'changed') {
        clearTimeout(d.timer);
        dragRef.current = { active: true, x, at: nowMs(), timer: null };
        setDrag({ x });
      } else if (detail.phase === 'ended') {
        clearTimeout(d.timer);
        dragRef.current = { active: false, x, at: nowMs(), timer: null };
        dragRef.current.timer = setTimeout(() => {
          if (!animRef.current.current) snapBack();
        }, NATIVE_END_GRACE_MS);
      } else if (detail.phase === 'cancelled') {
        snapBack();
      }
    };
    win.addEventListener(NATIVE_PROGRESS_EVENT, onProgress);
    win.addEventListener(NATIVE_PROGRESS_EVENT_ALIAS, onProgress);
    return () => {
      clearTimeout(dragRef.current.timer);
      win.removeEventListener(NATIVE_PROGRESS_EVENT, onProgress);
      win.removeEventListener(NATIVE_PROGRESS_EVENT_ALIAS, onProgress);
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
  const dragging = !anim && drag && groups.length >= 2;
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
      dragX=${dragging && g.screen.id === topId ? drag.x : null}
      snapping=${dragging && g.screen.id === topId && !!drag.snapping}
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
