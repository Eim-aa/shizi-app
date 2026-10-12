// 退场动画（交互与动效规范 T0-2：每个进场都有对应的退场；审计 P1-07）。
// 弹层、确认框、提示条、撤销条在被卸载的那一刻（Preact 先跑卸载钩子、再摘 DOM）把自己的 DOM 复制一份留在原位，
// 复制品不可点（inert、pointer-events:none）、读屏不可见（aria-hidden，去掉 role / aria-* / id / tabindex），按 kind 播退场动画后自己移除：
//   sheet   弹层 220ms 下滑（从当前位置，下滑关闭时接着手指的位置）+ 遮罩 180ms 淡出，ease.in（T-sheet）
//   confirm 确认框 180ms 淡出 + 遮罩 180ms 淡出，ease.in（T-confirm）
//   fade    提示条 / 撤销条 150ms 淡出，linear（T-fade）
// 减少动态效果：一律 150ms 线性淡出（motion.duration.reduce，D58 ②）。
// 用复制品而不是让路由晚一点卸载：页面栈、焦点归还、history 都不用等动画，退场只是「看得见的余影」，不挡任何输入（T0-3）。
// canvas 的像素复制过去（字帖、笔迹放大），其余是普通 DOM。data-testid 保留在根上（样式按它写），后代的去掉，免得测试 / 读屏摸到两份。
import { M, prefersReducedMotion } from '../../config/motion.js';
import { injectStyles, T } from './styles.js';

export const EXIT_CLASS = 'sz-exit';

injectStyles('exit', `
.${EXIT_CLASS}{pointer-events:none !important}
.${EXIT_CLASS} *{pointer-events:none !important;animation:none !important} /* 复制品里的进场动画不重播（复制出来的元素会重新起动画） */
.${EXIT_CLASS} .sz-toast__timer{opacity:0}
@keyframes sz-exit-fade{to{opacity:0}}
@keyframes sz-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sz-exit-sheet{to{transform:translateY(100%)}}
@keyframes sz-exit-confirm{to{opacity:0;transform:translateY(-50%) scale(${M.scale.confirmFrom})}}
.${EXIT_CLASS}[data-exit="sheet"]>.sz-scrim,.${EXIT_CLASS}[data-exit="confirm"]>.sz-scrim{animation:sz-exit-fade ${T.dS} ${T.eIn} both !important}
.${EXIT_CLASS}[data-exit="sheet"]>.sz-sheet{animation:sz-exit-sheet ${T.dRelease} ${T.eIn} both !important}
.${EXIT_CLASS}[data-exit="confirm"]>.sz-confirm{animation:sz-exit-confirm ${T.dS} ${T.eIn} both !important}
.${EXIT_CLASS}[data-exit="fade"]{animation:sz-exit-fade ${T.dFade} ${T.eLinear} both !important}
@media (prefers-reduced-motion: reduce){
  .${EXIT_CLASS}[data-exit="sheet"]>.sz-scrim,.${EXIT_CLASS}[data-exit="confirm"]>.sz-scrim,
  .${EXIT_CLASS}[data-exit="sheet"]>.sz-sheet,.${EXIT_CLASS}[data-exit="confirm"]>.sz-confirm,
  .${EXIT_CLASS}[data-exit="fade"]{animation:sz-exit-fade ${T.dReduce} ${T.eLinear} both !important}
}
`);

/** 各 kind 的退场时长（ms）：复制品在这之后移除。 */
export function exitMs(kind, reduced = prefersReducedMotion()) {
  if (reduced) return M.dur.reduce;
  if (kind === 'sheet') return Math.max(M.role.sheetOut, M.role.scrimOut);
  if (kind === 'confirm') return Math.max(M.role.confirmOut, M.role.scrimOut);
  return M.role.toastOut;
}

const STRIP = ['id', 'role', 'tabindex', 'aria-modal', 'aria-labelledby', 'aria-describedby', 'aria-live', 'aria-atomic', 'aria-label', 'data-autofocus'];

function copyCanvases(from, to) {
  const a = from.querySelectorAll ? [...from.querySelectorAll('canvas')] : [];
  const b = to.querySelectorAll ? [...to.querySelectorAll('canvas')] : [];
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    try {
      b[i].width = a[i].width;
      b[i].height = a[i].height;
      const ctx = b[i].getContext('2d');
      if (ctx && a[i].width && a[i].height) ctx.drawImage(a[i], 0, 0);
    } catch (error) {
      // 跨源或 WebGL 画布读不了：余影里留空，不影响任何功能
    }
  }
}

/**
 * 在 el 被摘掉之前调用：复制一份留在原位播退场，结束后移除。返回复制品（没有 DOM 时返回 null）。
 * @param {Element|null} el  要退场的根（弹层传 .sz-overlay，提示条 / 撤销条传自己）
 * @param {'sheet'|'confirm'|'fade'} kind
 */
export function playExit(el, kind = 'fade', { win = typeof window !== 'undefined' ? window : null } = {}) {
  if (!el || !el.parentNode || typeof el.cloneNode !== 'function' || !win) return null;
  if (el.closest && el.closest(`.${EXIT_CLASS}`)) return null;
  if (el.__szExited) return null; // 同一个元素只留一份余影
  el.__szExited = true;
  const clone = el.cloneNode(true);
  copyCanvases(el, clone);
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const name of STRIP) node.removeAttribute(name);
    // 弹层：根与面板上的 data-testid 留着（面板样式按它写，例如查字弹层），更深的去掉；提示条 / 撤销条：全去掉
    if (kind === 'fade' || (node !== clone && node.parentNode !== clone)) node.removeAttribute('data-testid');
  }
  clone.classList.add(EXIT_CLASS);
  clone.setAttribute('data-exit', kind);
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  el.parentNode.insertBefore(clone, el.nextSibling);
  const remove = () => {
    if (clone.parentNode) clone.parentNode.removeChild(clone);
  };
  win.setTimeout(remove, exitMs(kind, prefersReducedMotion(win)) + M.dur.xs);
  return clone;
}
