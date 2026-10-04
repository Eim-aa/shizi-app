// 底部弹层（遮罩栈里的一层）：role=dialog aria-modal、焦点陷阱、关闭后焦点归还（01-架构设计 §7）。
// 规格取设计系统 v1 的弹层（P1-E1b）：遮罩 --scrim；面板贴底、max-height 88%、24px 上圆角（--r-box）、--elev 底、--elev-shadow（只有弹层有阴影）、
// padding 24 20（页边）底部 max(32, 安全区)、gap 16（间距尺度）；没有顶部把手（网页里不能跟手下拉，把手是假的，P0-A12 / G12，阶段 3 由原生 Sheet 取代）。
// 进场上滑，减少动态效果时直接显示。
// 完成（A2-05 / R2-A1，D29 / D51）：每个底部弹层标题行右端有一个可见的「完成」文字按钮（H1 统一的文字按钮规格，44 点击区，读屏可达），
// 与点遮罩 / 系统返回 / Esc / 原生 accessibilityPerformEscape（shizi-native-escape）同走 onClose。没有标题的弹层（写字页「⋯」菜单）这一行只有「完成」、靠右。
// 弹层自己已有一个等价的可见出口时（修改判断「取消」、清空确认「先不清空」这类决策弹层，取消比完成准确）传 dismiss="own"：不再多画一个「完成」，
// 根节点带 data-dismiss="own"，e2e 逐个核对。
// 打开方式：nav.openOverlay(内容组件, props)；内容组件里用 <Sheet onClose=${close}>…</Sheet>。
// 点遮罩 / 系统返回 / Esc 都经 router 走 history.back()。
import { html, useEffect, useRef } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';
import { Button } from './Button.js';
import { t } from '../../config/copy/index.js';

injectStyles('sheet', `
.sz-overlay{position:absolute;inset:0;z-index:20}
.sz-scrim{position:absolute;inset:0;background:${T.scrim};animation:sz-fade-in .2s ease-out both}
.sz-sheet{position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow:auto;box-sizing:border-box;
  border-radius:${T.rBox} ${T.rBox} 0 0;background:${T.elev};box-shadow:${T.elevShadow};
  padding:${T.s6} ${T.gutter} max(${T.s8}, env(safe-area-inset-bottom, 0px));display:flex;flex-direction:column;gap:${T.s4};color:${T.ink1};
  animation:sz-sheet-in .28s cubic-bezier(.2,.7,.2,1) both}
.sz-sheet:focus{outline:none}
.sz-sheet__head{display:flex;align-items:center;justify-content:flex-end;gap:${T.s4};flex:none}
.sz-sheet__head .sz-sheet__title{flex:1 1 auto;min-width:0}
.sz-sheet__done{flex:none;margin-inline-end:calc(-1 * var(--bx));white-space:nowrap;word-break:keep-all}
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
 * @param {'done'|'own'} [props.dismiss]  默认 'done'：标题行右端画「完成」；'own' = 弹层自己已有可见的取消 / 关闭，不画
 * @param {string} [props.doneTestid]  「完成」按钮的 data-testid（默认 sheet-done）
 */
export function Sheet({ title, onClose, active = true, testid, dismiss = 'done', doneTestid = 'sheet-done', children }) {
  const panelRef = useRef(null);
  const titleIdRef = useRef(null);
  if (!titleIdRef.current) titleIdRef.current = `sz-sheet-title-${(titleSeq += 1)}`;
  useDialogFocus(panelRef, active);
  const close = () => onClose && onClose();
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
