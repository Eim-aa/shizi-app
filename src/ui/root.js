// 根组件：把 router 的页面栈 / 遮罩栈画成一叠图层，负责转场、焦点、防连点时钟与原生返回进度。
// 规则见 01-架构设计 §7：
// - 推入 300ms ease.out（motion.role.pushIn）带左投影，返回反向；
// - 减少动态效果：150ms 交叉淡化（motion.duration.reduce，D58 ② 全 App 统一；原 R-G01 的 120ms 作废）；
// - iOS 主屏 PWA（display-mode: standalone）下由系统返回（popstate）引发的返回跳过转场；
// - 原生 shizi-native-back-progress 事件驱动跟手交互式返回（M6-5，逻辑在 router.createBackGestureController）：
//   began 冻结底层页（露出、不可点、跟手期间不重画——位移直接写 style.transform，不走 setState），changed 顶层页跟手、
//   底层页视差、顶层页左投影；ended 过阈值提交 back（转场从手指位置接着滑出），否则回弹；cancelled 回弹；
//   顶层是遮罩时 began 只关遮罩、页面不动；减少动态效果时不跟随，只按阈值提交；
// - 原生左缘返回门控：tab 根页 / 阻断页 / 顶层页面左上不是返回键（判断页「接着写」）backGestureEnabled(false)，有子页 true；
//   只在页面栈深度、阻断或顶层能否返回变化时发（router.createBackGestureSync）。写字页也能滑动返回（R4-G1，P270）。
// - 交互式返回（R4-G1）：完成时执行顶层页面页头左上键的同一个动作（ui/back-action.js；结果页「×」先收起撤销条再回来源），
//   转场样式由 BACK_TRANSITION 决定（控制器只给进度）；减少动态效果时不跟手，完成后 GESTURE_FADE_MS 淡化。
//   浏览器 / 主屏 PWA 另有网页兜底手势（ui/edge-swipe.js，页头以下左缘 12px 起手），原生壳内关闭，免得两套手势打架。
// - 写字页进出（W2，D57，P282–P284；ui/paper-transition.js）：从首页「开始写字」类按钮进来，按钮原地长成整张纸（B1，进 420ms / 退 360ms），没有来源按钮的入口用 B3 安静淡入（220 / 180ms），
//   减少动态效果一律 150ms 淡化；进出与左缘右滑共用同一个进度 s（= 1 − 手指进度），BACK_TRANSITION 在写字页（及来源在首页的结果页）上把进度交给它。其它页面仍是横推。
// Tab 页滚动容器顶部有一条吸附的纸色渐变遮罩（::before，P0-A8 / G20）：内容滚进状态栏 / 灵动岛时淡出，不与时间、电池重叠；
// 不拦截点击（pointer-events:none），浅深色都走 --p。阶段 3 由系统的滚动边缘效果取代。
// 每个页面图层一直挂着（下面的页面 visibility:hidden），返回时页面内状态与滚动位置都在。
// 每层 isolation:isolate 自成层叠上下文（P0-A1 / G13）：页内 z-index（页头按钮 z1、sticky 条 z2/z3）不能越过图层，
// 否则推入 / 返回转场里下层页的「全选」「‹」会压在新页上。
import { html, render, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/ui.js';
import {
  attachWindow,
  backGestureAllowed,
  BACK_PARALLAX,
  createBackGestureController,
  createBackGestureSync,
  createRouter,
  getScreen,
  listTabs,
  nav,
  NATIVE_ESCAPE_EVENT,
  NATIVE_PROGRESS_EVENT,
  pageDepth,
  setActiveRouter,
} from './router.js';
import { setBackGestureEnabled } from '../platform/bridge.js';
import { M, prefersReducedMotion as reducedMotionOf } from '../config/motion.js';
import { isNativeShell, isStandalone, isTestHost } from '../platform/env.js';
import { backActionAllowed, EntryContext, runBackAction, subscribeBackActions } from './back-action.js';
import { attachEdgeSwipe, EdgeStrip } from './edge-swipe.js';
import { clearOverlayGesture, paintOverlayGesture } from './overlay-gesture.js';
import { markStateChange } from './components/Button.js';
import {
  cancelSpec, clearPaper, createPaper, PAPER_CSS, planPaper, planPaperDrag, runProgress, specFor,
} from './paper-transition.js';
import { Tabs } from './components/Tabs.js';
import './components/marks.js'; // 朱色白名单组件：写错朱点与印章（D43，P1-E1a）
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
import './components/ax.js'; // P1-E6 / D29 / P131：系统字号 AX 档的防溢出规则（:root[data-ax]，各屏样式之后注入）
import { getStore } from '../store/store.js';
import { createRouteMemory, setRouteMemory } from './route-memory.js'; // 审查整改 F1：冷启动恢复离开时的页面栈

// 动效令牌（交互与动效规范 T2，D58；config/motion.js）
export const PUSH_MS = M.role.pushIn;
export const PUSH_EASING = M.ease.out;
/** 减少动态效果的交叉淡化（全 App 唯一：150ms，D58 ②）。 */
export const FADE_MS = M.role.reduceCrossfade;
export const SNAP_MS = M.role.gestureSnap;
// 跟手提交后的返回转场按剩余距离缩短，但不短于这个值。
const GESTURE_POP_MIN_MS = M.role.pushGestureMin;
/** 减少动态效果时由手势完成的返回：不跟手，松手直接交叉淡化这么久（R4-G1，P270）。 */
export const GESTURE_FADE_MS = M.role.reduceCrossfade;
/** 后台标签页暂停 rAF 时的收尾兜底：逐帧最多前进 50ms，主线程卡顿时可能比转场时长长得多（不是动画时长）。 */
const PAPER_STALL_GUARD = 1500;

// 交互式返回的转场定义（R4-G1）：控制器（router.createBackGestureController）只给进度，这里决定进度画成什么样。
// 现用推入 / 返回同一套几何：顶层页右移 progress × 宽，底层页从 -BACK_PARALLAX × 宽 视差归位，顶层带左投影。
// 以后换写字页进出动画时换掉这个对象（与 useLayoutEffect 里的推入 / 返回关键帧保持一致），控制器与原生 / 网页手势都不用动。
export const BACK_TRANSITION = Object.freeze({
  /** 跟手开始：两层进入拖动状态。ctx.plan（写字页的 B1 / B3，planPaperDrag）有值时按「纸」画：见 ui/paper-transition.js。 */
  begin(top, under, ctx) {
    if (ctx && ctx.plan && top) {
      ctx.paper = createPaper(ctx.plan, top, under);
      if (under) under.classList.add('sz-layer--under');
      return;
    }
    if (top) top.classList.add('sz-layer--moving');
    if (under) under.classList.add('sz-layer--under');
  },
  /** 画一帧：view.phase 'follow' 直接设值、'snap' 走 SNAP_MS 过渡回原位、'commit' 停在松手处等返回转场接手。 */
  frame(top, under, view, ctx) {
    if (ctx && ctx.paper) {
      // 纸：s = 1 − 手指进度 p，逐帧跟手；snap（取消）= 220ms 长回整屏（与点按同一个 frame 函数）；commit 停在松手处等返回转场接手。
      if (ctx.anim) {
        ctx.anim.cancel();
        ctx.anim = null;
      }
      const s = 1 - (Number.isFinite(view.progress) ? view.progress : 0);
      if (view.phase === 'snap') {
        const spec = cancelSpec(ctx.plan, ctx.s === undefined ? 1 : ctx.s);
        ctx.anim = runProgress({ from: spec.from, to: spec.to, ms: spec.ms, ease: spec.ease, apply: v => { ctx.s = v; ctx.paper.frame(v, true); } });
      } else {
        ctx.s = s;
        ctx.paper.frame(s, true);
      }
      return;
    }
    const w = view.width || 1;
    const x = Number.isFinite(view.x) ? view.x : view.progress * w;
    const snapping = view.phase === 'snap';
    if (top) {
      top.classList.toggle('sz-layer--snap', snapping);
      top.style.transform = `translateX(${x}px)`;
    }
    if (under) {
      under.classList.toggle('sz-layer--snap', snapping);
      under.style.transform = `translateX(${Math.round(-(w - x) * BACK_PARALLAX * 100) / 100 || 0}px)`;
    }
  },
  /** 收尾：清掉跟手写下的样式。 */
  clear(el, ctx) {
    if (ctx && ctx.plan) {
      if (ctx.anim) {
        ctx.anim.cancel();
        ctx.anim = null;
      }
      clearPaper(el);
      if (el) el.classList.remove('sz-layer--under');
      return;
    }
    if (!el) return;
    el.style.transform = '';
    el.classList.remove('sz-layer--moving', 'sz-layer--snap', 'sz-layer--under');
  },
  /** 完成时返回转场的起点（顶层 / 底层的 translateX）：从手指松开的位置接着走。 */
  handoff(view) {
    const w = view.width || 1;
    const x = Number.isFinite(view.x) ? view.x : view.progress * w;
    return { startX: x, underX: Math.round(-(w - x) * BACK_PARALLAX * 100) / 100 || 0, width: w };
  },
});

injectStyles('paper-transition', PAPER_CSS);
injectStyles('root', `
.sz-app{position:fixed;inset:0;overflow:hidden;background:${T.paper};color:${T.ink1};font-family:${T.hei};
  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
.sz-layer{position:absolute;inset:0;overflow:hidden;isolation:isolate;background:${T.paper};display:flex;flex-direction:column}
.sz-layer--moving{box-shadow:-1px 0 0 ${T.line}}
.sz-layer--snap{transition:transform ${SNAP_MS}ms ${PUSH_EASING}}
.sz-layer--under{pointer-events:none}
.sz-layer__screen{flex:1;min-height:0;display:flex;flex-direction:column}
.sz-layer__screen>.sz-page{flex:1;height:auto}
.sz-tabroot{flex:1;min-height:0;display:flex;flex-direction:column}
.sz-tabroot__panel{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.sz-tabroot__panel::before{content:"";position:sticky;top:0;display:block;height:env(safe-area-inset-top, 0px);
  margin-bottom:calc(-1 * env(safe-area-inset-top, 0px));background:linear-gradient(${T.paper} 70%, transparent);z-index:2;pointer-events:none}
`);

function prefersReducedMotion(win) {
  return reducedMotionOf(win); // 全 App 唯一的判断（P2-13，config/motion.js）
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
  return html`<${EntryContext.Provider} value=${e.id}><div
    class="sz-layer"
    data-entry=${e.id}
    data-screen=${e.n}
    data-top=${isTop ? 'true' : undefined}
    aria-hidden=${isTop ? undefined : 'true'}
    style=${style}
  >
    <div class="sz-layer__screen" aria-hidden=${topOverlay ? 'true' : undefined}>${content}</div>
    ${group.overlays.map(o => html`<${OverlayHost} key=${o.id} router=${router} id=${o.id} active=${isTop && o.id === topOverlay} />`)}
  </div></${EntryContext.Provider}>`;
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
    // 跟手完成的返回：顶层页面的返回动作（nav.back，或结果页回首页时的静默返回）弹出的正是跟手的那一页 → 转场从手指位置接着走。
    const fromGesture = !!(t.kind === 'pop' && gv && gv.phase === 'commit' &&
      t.from && gestureRef.current.els && gestureRef.current.els.topId === t.from.id);
    // 减少动态效果下由手势完成的返回：不跟手，松手直接淡化 GESTURE_FADE_MS（R4-G1）。
    const reducedGesture = !!(t.kind === 'pop' && ctrl && !gv && prefersReducedMotion(win) && ctrl.takeReducedCommit());
    if ((t.animate || fromGesture || reducedGesture) && (t.kind === 'push' || t.kind === 'pop') && t.from && t.to) {
      const start = fromGesture ? BACK_TRANSITION.handoff(gv) : { startX: 0, underX: 0, width: 0 };
      // 写字页进出（W2）：B1 / B3 / 减少动态效果的 150ms 淡化；null = 沿用横推（其它页面）。
      const paper = planPaper(t, { reduced: prefersReducedMotion(win), root: appRef.current });
      animRef.current.current = {
        seq: t.seq,
        kind: t.kind,
        paper,
        startS: fromGesture && gv ? 1 - (Number.isFinite(gv.progress) ? gv.progress : 0) : null,
        mode: paper ? (paper.mode === 'B1' ? 'paper' : paper.mode === 'B3' ? 'quiet' : 'fade') : prefersReducedMotion(win) ? 'fade' : 'slide',
        from: t.from,
        to: t.to,
        startX: start.startX,
        underX: start.underX,
        width: start.width,
        fromGesture,
        reducedGesture,
      };
    } else {
      animRef.current.current = null;
      // 没有动画的转场（popstate 兜底等）也要让来源记录跟页面栈同步：写字页被弹掉就忘了它的来源
      if (t && t.kind === 'pop' && t.to) planPaper({ kind: 'pop', from: t.from, to: t.to }, { reduced: false, root: null });
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
    if (a.paper) {
      // 写字页进出：同一个进度 s 逐帧画（paper-transition.js），点按与左缘右滑完成是同一条路径
      const plan = a.paper;
      const open = plan.dir === 'open';
      const layerEl = pick(open ? a.to.id : a.from.id);
      const underEl = pick(open ? a.from.id : a.to.id);
      if (layerEl) {
        const paper = createPaper(plan, layerEl, underEl);
        const spec = specFor(plan, { fromS: a.startS });
        const drag = a.startS !== null && a.startS !== undefined;
        let finished = false;
        let handle = null;
        let timer2 = null;
        const done = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer2);
          if (handle) handle.cancel();
          if (!open) layerEl.style.visibility = 'hidden'; // 退出的页面马上卸载：不让它在清掉样式后以整屏闪一帧
          paper.clear();
          a.cancel = null;
          if (animRef.current.running === a) animRef.current.running = null;
          if (animRef.current.current === a) {
            animRef.current.current = null;
            force(n => n + 1);
          }
        };
        a.cancel = done;
        handle = runProgress({ from: spec.from, to: spec.to, ms: spec.ms, ease: spec.ease, apply: v => paper.frame(v, drag), onDone: done });
        timer2 = setTimeout(done, spec.ms + PAPER_STALL_GUARD); // 兜底：后台标签页 rAF 被暂停时也要收尾（逐帧最多前进 50ms，主线程卡顿时可能比 spec.ms 长）
        return;
      }
    }
    const fade = a.mode === 'fade';
    const moving = a.kind === 'push' ? pick(a.to.id) : pick(a.from.id);
    // 跟手提交：顶层页从手指位置滑出、底层页从视差位置归位，时长按剩余距离缩短。
    const under = a.fromGesture && !fade ? pick(a.to.id) : null;
    const rest = a.fromGesture && a.width ? Math.max(0, 1 - a.startX / a.width) : 1;
    const frames = a.kind === 'push'
      ? (fade ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }])
      : (fade ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: `translateX(${a.startX}px)` }, { transform: 'translateX(100%)' }]);
    const opts = fade
      ? { duration: a.reducedGesture ? GESTURE_FADE_MS : FADE_MS, easing: M.ease.linear, fill: 'both' }
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
    timer = setTimeout(finish, opts.duration + M.dur.fade);
  });

  // 原生左缘返回门控（01 §7）：页面栈深度 / 阻断 / 顶层页面能否返回（ui/back-action.js）变化时同步一次。
  // effect 在子组件之后执行；仍声明 ownsBackGesture 的页面为顶层时 createBackGestureSync 不发（R4-G1 起没有页面这样声明）。
  const gateRef = useRef(null);
  if (!gateRef.current) gateRef.current = createBackGestureSync({ send: setBackGestureEnabled });
  const gateDepth = pageDepth(snap);
  const blocked = !!block.reason;
  blockedRef.current = blocked;
  const edgeOkRef = useRef(false);
  const nativeShellRef = useRef(null);
  if (nativeShellRef.current === null) nativeShellRef.current = isNativeShell(win);
  const [actionsRev, bumpActions] = useState(0); // 顶层页面的返回动作可用性变化（写字页进出判断阶段）时重算门控
  useEffect(() => subscribeBackActions(() => bumpActions(n => n + 1)), []);
  const topEntryId = snap.top ? snap.top.id : null;
  const actionOk = backActionAllowed(topEntryId);
  edgeOkRef.current = backGestureAllowed(snap, blocked, actionOk);
  useEffect(() => {
    gateRef.current.update(snap, blocked, actionOk);
  }, [gateDepth, blocked, actionOk, topEntryId, actionsRev]);

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
    // 读屏两指 Z 形（A2-05）：原生 accessibilityPerformEscape 派发 shizi-native-escape，同样只关最上层遮罩。
    const onNativeEscape = () => {
      if (!router.getState().topIsOverlay) return;
      router.back();
    };
    win.addEventListener('keydown', onKey);
    win.addEventListener(NATIVE_ESCAPE_EVENT, onNativeEscape);
    return () => {
      win.removeEventListener('keydown', onKey);
      win.removeEventListener(NATIVE_ESCAPE_EVENT, onNativeEscape);
    };
  }, [router, win]);

  // 原生左缘手势进度（Swift 唯一所有者；JS 只按事件渲染）。M6-5 跟手交互式返回，见文件头与 router.createBackGestureController。
  useEffect(() => {
    const g = gestureRef.current;
    const pickLayer = id => (appRef.current ? appRef.current.querySelector(`.sz-layer[data-entry="${id}"]`) : null);
    const clearEls = () => {
      const els = g.els;
      g.els = null;
      if (!els) return;
      BACK_TRANSITION.clear(els.top, els);
      BACK_TRANSITION.clear(els.under, els);
    };
    // 画面只写 DOM：跟手期间页面组件不重画（冻结），只在开始 / 结束各 setState 一次（露出 / 收起底层页）。
    const ovl = { els: null }; // 弹层上的左缘右滑（P1-06）：只位移最上层弹层，页面不动
    const onView = view => {
      if (view && view.overlay) {
        paintOverlayGesture(appRef.current, view, ovl);
        return;
      }
      if (ovl.els) clearOverlayGesture(ovl);
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
          plan: planPaperDrag(topE, underE, appRef.current), // 写字页（及来源在首页的结果页）：把进度画成「纸」（W2），其它页面横推
        };
        BACK_TRANSITION.begin(g.els.top, g.els.under, g.els);
        setGestureOn(true);
      }
      BACK_TRANSITION.frame(g.els.top, g.els.under, view, g.els);
    };
    const topPageId = () => {
      const top = router.getState().top;
      return top ? top.id : null;
    };
    const nativeBack = () => router.back({ cause: 'native' });
    const ctrl = createBackGestureController({
      getState: () => router.getState(),
      // 完成：与点顶层页面页头左上键同一个动作（ui/back-action.js）；没登记的页面退回 router.back。
      back: () => runBackAction(topPageId(), nativeBack),
      closeOverlay: nativeBack,
      allowed: () => backActionAllowed(topPageId()),
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
    router.attachBackGesture(ctrl);
    const onProgress = event => ctrl.handle((event && event.detail) || {});
    win.addEventListener(NATIVE_PROGRESS_EVENT, onProgress);
    // 网页兜底手势（浏览器 / 主屏 PWA）：原生壳内不装——原生识别器是唯一所有者，两套手势不同时存在。
    const detachEdge = nativeShellRef.current ? null : attachEdgeSwipe({ win, canStart: () => edgeOkRef.current });
    return () => {
      if (detachEdge) detachEdge();
      win.removeEventListener(NATIVE_PROGRESS_EVENT, onProgress);
      router.attachBackGesture(null);
      router.setNativeBackFilter(null);
      ctrl.reset();
      clearEls();
      clearOverlayGesture(ovl);
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
  // 网页兜底手势的起手带（R4-G1）：浏览器 / PWA 里能返回时才画；原生壳内由原生识别器负责。
  const webEdge = !nativeShellRef.current && edgeOkRef.current;

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
    ${webEdge && !anim ? html`<${EdgeStrip} />` : null}
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
  // 审查整改 F1：history.state 为空（进程被杀后的全新会话）时由路由记忆给出离开时的页面栈（P108 过期、各页有效性、
  // 阻断 / 坏数据 / 提醒深链优先，见 route-memory.js）；启动后订阅页面栈变化写回 shizi.v2.route。
  const memory = createRouteMemory({ getStore, win, defaultTab });
  const router = createRouter({ history: win.history, isStandalone: () => isStandalone(win), coldStart: () => memory.coldStart() });
  setActiveRouter(router);
  const detach = attachWindow(router, win);
  router.start({ defaultTab });
  memory.attach(router);
  setRouteMemory(memory);
  render(html`<${Root} router=${router} win=${win} />`, container);
  return {
    router,
    unmount() {
      memory.detach();
      setRouteMemory(null);
      detach();
      render(null, container);
      setActiveRouter(null);
    },
  };
}
