// 底部弹层（遮罩栈里的一层）：role=dialog aria-modal、焦点陷阱、关闭后焦点归还（01-架构设计 §7）。
// 规格取设计系统 v1 的弹层（P1-E1b）：遮罩 --scrim；面板贴底、max-height 88%、24px 上圆角（--r-box）、--elev 底、--elev-shadow（只有弹层有阴影）、
// padding 24 20（页边）底部 max(32, 安全区)、gap 16（间距尺度）；没有顶部把手（P0-A12 / G12：下滑关闭不靠把手，整张弹层都能拖）。
// 转场 T-sheet（交互与动效规范 T0，D58 ④）：进场 280ms 自下而上（ease.out）、遮罩 200ms 淡入；退场 220ms 下滑（ease.in）、遮罩 180ms 淡出
// （ui/components/exit.js：卸载前复制一份留在原位播退场，P1-07）；减少动态效果下进、出都是 150ms 淡化（motion.duration.reduce）。
// 下滑关闭（N4 ③ / G1，P1-08）：弹层任意位置向下拖（内容已滚到顶时），跟手、可中途拖回取消；松手时位移 > 1/3 弹层高或速度 > 500pt/s
// （且没有明显往回拉，gesture.sheetCommitRatio / commitVelocity / returnVelocity，与左缘右滑同一套阈值）就关，否则 200ms 回弹。
// 内容没在顶部时先滚动、到顶后再接管（G2 ④）；横向为主的拖动（图片预览翻页）不接管。减少动态效果：不跟手，松手按同一阈值判定，关闭走 150ms 淡化。
// 读屏 / 切换控制用户的等价出口：「完成」（或弹层自己的取消）、两指 Z 形（shizi-native-escape）、键盘 Esc。
// 完成（A2-05 / R2-A1，D29 / D51）：每个底部弹层标题行右端有一个可见的「完成」文字按钮（H1 统一的文字按钮规格，44 点击区，读屏可达），
// 与点遮罩 / 系统返回 / Esc / 原生 accessibilityPerformEscape（shizi-native-escape）同走 onClose。没有标题的弹层这一行只有「完成」、靠右。
// 弹层自己已有一个等价的可见出口时（修改判断「取消」、清空确认「先不清空」这类决策弹层，取消比完成准确）传 dismiss="own"：不再多画一个「完成」，
// 根节点带 data-dismiss="own"，e2e 逐个核对。
// 打开方式：nav.openOverlay(内容组件, props)；内容组件里用 <Sheet onClose=${close}>…</Sheet>。
// 点遮罩 / 系统返回 / Esc 都经 router 走 history.back()。
import { html, useEffect, useRef } from '../../../vendor/ui.js';
import { injectStyles, SCROLL_Y, T } from './styles.js';
import { Button } from './Button.js';
import { playExit } from './exit.js';
import { M, prefersReducedMotion } from '../../config/motion.js';
import { useOverlayBack } from '../back-action.js';
import { t } from '../../config/copy/index.js';

injectStyles('sheet', `
.sz-overlay{position:absolute;inset:0;z-index:20}
.sz-scrim{position:absolute;inset:0;background:${T.scrim};animation:sz-fade-in ${T.dM} ${T.eOut} backwards}
.sz-sheet{position:absolute;left:0;right:0;bottom:0;max-height:88%;${SCROLL_Y};box-sizing:border-box;
  border-radius:${T.rBox} ${T.rBox} 0 0;background:${T.elev};box-shadow:${T.elevShadow};
  padding:${T.s6} ${T.gutter} max(${T.s8}, env(safe-area-inset-bottom, 0px));display:flex;flex-direction:column;gap:${T.s4};color:${T.ink1};
  animation:sz-sheet-in ${T.dSheet} ${T.eOut} backwards} /* backwards：进场结束后不再占着 transform / opacity，下滑与左缘跟手才写得进行内样式 */
.sz-sheet[data-drag="snap"]{transition:transform ${T.dM} ${T.eOut}}
.sz-scrim[data-drag="snap"]{transition:opacity ${T.dM} ${T.eOut}}
.sz-sheet:focus{outline:none}
.sz-sheet__head{display:flex;align-items:center;justify-content:flex-end;gap:${T.s4};flex:none}
.sz-sheet__head .sz-sheet__title{flex:1 1 auto;min-width:0}
.sz-sheet__done{flex:none;margin-inline-end:calc(-1 * var(--bx));white-space:nowrap}
.sz-sheet__title{margin:0;font-family:${T.song};font-size:${T.fs22};font-weight:500;line-height:${T.lh22}}
:root[data-ax] .sz-sheet__title{text-wrap:balance;line-break:strict} /* AX 档（R3-K1，A3-04）：「这次的图 / 片」这样单字落行改成均衡折行 */
@keyframes sz-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sz-sheet-in{from{transform:translateY(100%)}to{transform:none}}
@keyframes sz-fade-only{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.sz-scrim,.sz-sheet{animation:sz-fade-only ${T.dReduce} ${T.eLinear} backwards}}
`);

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// 焦点陷阱 + 焦点归还。active=false（被压在别的页面下）时不抢焦点也不拦 Tab。
export function useDialogFocus(panelRef, active = true) {
  const restoreRef = useRef(null);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    // 聚焦面板本身，不预选任何按钮（决定-D03：判断类弹层不能有默认项）。
    if (panel && active) panel.focus({ preventScroll: true });
    return () => {
      // 退场（P1-07）：卸载前把整层（遮罩 + 面板）复制一份留在原位播退场动画；焦点同时归还，不等动画。
      const el = panelRef.current;
      const overlay = el && el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('sz-overlay') ? el.parentNode : null;
      if (overlay) playExit(overlay, overlay.getAttribute('data-exit-kind') || (el.classList.contains('sz-sheet') ? 'sheet' : 'confirm'));
      const prev = restoreRef.current;
      if (prev && prev.isConnected && typeof prev.focus === 'function' && isVisible(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined' || !active) return undefined;
    // 从压在上面的页面返回、重新成为最上层时，把焦点拿回面板。
    const panelNow = panelRef.current;
    if (panelNow && !panelNow.contains(document.activeElement)) panelNow.focus({ preventScroll: true });
    const onKeyDown = event => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter(isVisible);
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}

/** 估下滑速度用的时间窗（ms；与网页左缘手势 edge-swipe.js 同一做法）。 */
const DRAG_VELOCITY_WINDOW = 100;

/**
 * 下滑关闭的判定（纯逻辑，单测 test/ui/sheet-drag.test.mjs）。坐标是 CSS px，时间是 ms。
 * start(x, y, t, atTop)：atTop = 起手处的滚动内容已在顶部（不在顶部时这次拖动交给滚动）；
 * move(x, y, t) → { engaged, offset }：先动 directionSlop 判方向，向下为主且在顶部才接管，offset = 接管后向下的位移（≥ 0，可拖回）；
 * end(t) → 'close' | 'snap' | null（没接管）。完成条件与左缘右滑同一套：v > commitVelocity 或（位移 > sheetCommitRatio × 弹层高 且 v > returnVelocity）。
 */
export function createSheetDrag({ height }) {
  let s = null;
  const h = () => Math.max(1, Number(typeof height === 'function' ? height() : height) || 1);
  function velocity(t) {
    const list = s.samples.filter(p => t - p.t <= DRAG_VELOCITY_WINDOW);
    if (list.length < 2) return 0;
    const a = list[0];
    const b = list[list.length - 1];
    return b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
  }
  return {
    start(x, y, t, atTop = true) {
      s = { x0: x, y0: y, mode: 'pending', atTop: !!atTop, offset: 0, samples: [{ y, t }] };
    },
    move(x, y, t) {
      if (!s) return { engaged: false, offset: 0 };
      s.samples.push({ y, t });
      if (s.samples.length > 12) s.samples.shift();
      if (s.mode === 'pending') {
        const dx = x - s.x0;
        const dy = y - s.y0;
        if (Math.abs(dx) < M.gesture.directionSlop && Math.abs(dy) < M.gesture.directionSlop) return { engaged: false, offset: 0 };
        s.mode = dy > 0 && dy > Math.abs(dx) && s.atTop ? 'drag' : 'off';
        if (s.mode === 'drag') s.y0 = y;
      }
      if (s.mode !== 'drag') return { engaged: false, offset: 0 };
      s.offset = Math.max(0, y - s.y0);
      return { engaged: true, offset: s.offset };
    },
    end(t) {
      if (!s || s.mode !== 'drag') {
        s = null;
        return null;
      }
      const v = velocity(t);
      const commit = v > M.gesture.commitVelocity || (s.offset > h() * M.gesture.sheetCommitRatio && v > M.gesture.returnVelocity);
      s = null;
      return commit ? 'close' : 'snap';
    },
    cancel() {
      const was = !!s && s.mode === 'drag';
      s = null;
      return was ? 'snap' : null;
    },
    isDragging: () => !!s && s.mode === 'drag',
  };
}

/** 起手点到弹层之间所有能竖向滚动的容器都在顶部（弹层自己也是滚动容器）。 */
function scrolledToTop(target, panel) {
  for (let el = target; el && el !== panel.parentNode; el = el.parentNode) {
    if (el.nodeType !== 1) continue;
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return false;
    if (el === panel) break;
  }
  return true;
}

/** 下滑关闭：把 createSheetDrag 接到弹层 DOM 上（触摸用 touch 事件，便于在接管后 preventDefault 挡住滚动回弹；鼠标 / 笔用指针事件）。 */
function useSheetDrag(panelRef, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof window === 'undefined') return undefined;
    const scrim = panel.parentNode ? panel.parentNode.querySelector(':scope > .sz-scrim') : null;
    const drag = createSheetDrag({ height: () => panel.getBoundingClientRect().height });
    let follow = false;
    const paint = offset => {
      if (!follow) return;
      panel.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
      if (scrim) scrim.style.opacity = String(Math.max(0, 1 - offset / Math.max(1, panel.getBoundingClientRect().height)));
    };
    const settle = result => {
      panel.removeAttribute('data-drag');
      if (result === 'close') {
        closeRef.current && closeRef.current();
        return;
      }
      if (result === 'snap' && follow) {
        panel.setAttribute('data-drag', 'snap');
        if (scrim) scrim.setAttribute('data-drag', 'snap');
        panel.style.transform = '';
        if (scrim) scrim.style.opacity = '';
        window.setTimeout(() => {
          if (panel.getAttribute('data-drag') === 'snap') panel.removeAttribute('data-drag');
          if (scrim) scrim.removeAttribute('data-drag');
        }, M.role.gestureSnap + M.dur.xs);
      }
    };
    const begin = (x, y, target, t) => {
      follow = !prefersReducedMotion(window);
      drag.start(x, y, t, scrolledToTop(target, panel));
    };
    const step = (x, y, t) => {
      const r = drag.move(x, y, t);
      if (!r.engaged) return false;
      panel.setAttribute('data-drag', 'follow');
      paint(r.offset);
      return true;
    };
    const now = e => (e && typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now());
    const onTouchStart = e => {
      if (e.touches.length !== 1) { drag.cancel(); return; }
      const p = e.touches[0];
      begin(p.clientX, p.clientY, e.target, now(e));
    };
    const onTouchMove = e => {
      const p = e.touches[0];
      if (p && step(p.clientX, p.clientY, now(e)) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = e => settle(drag.end(now(e)));
    const onTouchCancel = () => settle(drag.cancel());
    let pointerId = null;
    const onPointerDown = e => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      pointerId = e.pointerId;
      begin(e.clientX, e.clientY, e.target, now(e));
    };
    const onPointerMove = e => {
      if (e.pointerId !== pointerId) return;
      step(e.clientX, e.clientY, now(e));
    };
    const onPointerUp = e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      settle(drag.end(now(e)));
    };
    const onPointerCancel = e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      settle(drag.cancel());
    };
    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd);
    panel.addEventListener('touchcancel', onTouchCancel);
    panel.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', onTouchEnd);
      panel.removeEventListener('touchcancel', onTouchCancel);
      panel.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);
}

let titleSeq = 0;

/**
 * @param {object} props
 * @param {string} [props.title]
 * @param {() => void} props.onClose  点遮罩时调用（通常是 overlay 的 close）
 * @param {boolean} [props.active]  由 root 传入：是否在最上层
 * @param {string} [props.testid]
 * @param {'done'|'own'} [props.dismiss]  默认 'done'：标题行右端画「完成」；'own' = 弹层自己已有可见的取消 / 关闭，不画
 * @param {string} [props.doneTestid]  「完成」按钮的 data-testid（默认 sheet-done）
 */
export function Sheet({ title, onClose, active = true, testid, dismiss = 'done', doneTestid = 'sheet-done', children }) {
  const panelRef = useRef(null);
  const titleIdRef = useRef(null);
  if (!titleIdRef.current) titleIdRef.current = `sz-sheet-title-${(titleSeq += 1)}`;
  useDialogFocus(panelRef, active);
  const close = () => onClose && onClose();
  useSheetDrag(panelRef, close);
  useOverlayBack(close); // Esc / 两指 Z 形 / 左缘右滑关弹层时走同一个 onClose（P2-17：清空确认的「先不清空」等自定义取消不再被绕过）
  const done = dismiss !== 'own';
  return html`<div class="sz-overlay" data-overlay="sheet">
    <div class="sz-scrim" aria-hidden="true" onClick=${close}></div>
    <div class="sz-sheet" role="dialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid=${testid}
      data-dismiss=${done ? 'done' : 'own'} aria-labelledby=${title ? titleIdRef.current : undefined}>
      ${title || done
    ? html`<div class="sz-sheet__head" data-testid="sheet-head">
        ${title ? html`<h2 class="sz-sheet__title" id=${titleIdRef.current}>${title}</h2>` : null}
        ${done ? html`<${Button} variant="text" class="sz-sheet__done" data-testid=${doneTestid} onClick=${close}>${t('X-COMMON.done')}</${Button}>` : null}
      </div>`
    : null}
      ${children}
    </div>
  </div>`;
}
