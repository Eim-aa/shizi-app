// 底部弹层（遮罩栈里的一层）：role=dialog aria-modal、焦点陷阱、关闭后焦点归还（01-架构设计 §7）。
// 规格取原型「底部弹层通用」：遮罩 --scrim；面板贴底、max-height 88%、24px 上圆角、--elev 底、--elev-shadow、
// padding 28 24 底部安全区、gap 18；没有顶部把手（网页里不能跟手下拉，把手是假的，P0-A12 / G12，阶段 3 由原生 Sheet 取代）。
// 进场上滑，减少动态效果时直接显示。
// 打开方式：nav.openOverlay(内容组件, props)；内容组件里用 <Sheet onClose=${close}>…</Sheet>。
// 点遮罩 / 系统返回 / Esc 都经 router 走 history.back()。
import { html, useEffect, useRef } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

injectStyles('sheet', `
.sz-overlay{position:absolute;inset:0;z-index:20}
.sz-scrim{position:absolute;inset:0;background:${T.scrim};animation:sz-fade-in .2s ease-out both}
.sz-sheet{position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow:auto;box-sizing:border-box;
  border-radius:${T.rBox} ${T.rBox} 0 0;background:${T.elev};box-shadow:${T.elevShadow};
  padding:28px 24px max(34px, env(safe-area-inset-bottom, 0px));display:flex;flex-direction:column;gap:18px;color:${T.ink1};
  animation:sz-sheet-in .28s cubic-bezier(.2,.7,.2,1) both}
.sz-sheet:focus{outline:none}
.sz-sheet__title{margin:0;font-family:${T.song};font-size:${T.fs22};font-weight:500;line-height:${T.lh22}}
@keyframes sz-fade-in{from{opacity:0}to{opacity:1}}
@keyframes sz-sheet-in{from{transform:translateY(100%)}to{transform:none}}
@media (prefers-reduced-motion: reduce){.sz-scrim,.sz-sheet{animation:none}}
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

let titleSeq = 0;

/**
 * @param {object} props
 * @param {string} [props.title]
 * @param {() => void} props.onClose  点遮罩时调用（通常是 overlay 的 close）
 * @param {boolean} [props.active]  由 root 传入：是否在最上层
 * @param {string} [props.testid]
 */
export function Sheet({ title, onClose, active = true, testid, children }) {
  const panelRef = useRef(null);
  const titleIdRef = useRef(null);
  if (!titleIdRef.current) titleIdRef.current = `sz-sheet-title-${(titleSeq += 1)}`;
  useDialogFocus(panelRef, active);
  return html`<div class="sz-overlay" data-overlay="sheet">
    <div class="sz-scrim" aria-hidden="true" onClick=${() => onClose && onClose()}></div>
    <div class="sz-sheet" role="dialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid=${testid}
      aria-labelledby=${title ? titleIdRef.current : undefined}>
      ${title ? html`<h2 class="sz-sheet__title" id=${titleIdRef.current}>${title}</h2>` : null}
      ${children}
    </div>
  </div>`;
}
