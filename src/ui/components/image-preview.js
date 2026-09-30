// 图片预览弹层（02 M4-5；04 R-I01–R-I04、R-B10、R-R07；03 P25 / P50；原型 ShiziScreen-第十稿交接版 L192–L201 image34 / image11、
// L486–L487 imgNote；reference/J-proto-screen.md §2.3.25）。三种图片共用：这次的图片（结果页 / 练习记录）、{月}字帖、手写字图片。
//
// 版式（原型）：底部弹层；标题行左「标题」（serif 20）右分段「3:4 / 1:1」（选中 --c 底 + 阴影）；预览板 3:4 = 228×304、
//   1:1 = 250×250（.5px #DED8CD 边 + 投影；画布本身永远浅色纸面）；说明句 15/1.7 --i2；两键「分享」（次）/「保存图片」（主）。
//   保存失败：说明换成「没能存进相册。请到手机设置里允许拾字添加照片。」，两键「分享」/「再试一次」（R-B10、原型 imgFail）。
//   原生保存成功：轻提示「已保存到相册。」（R-B10）；浏览器里「保存图片」= 下载文件，不说「相册」。
//   > 80 字（P25 pending）：不生成画布、不截字，说明 R-I01.overLimit（待文案），两键真禁用；一个能画的字都没有：说明，两键真禁用。
// 打开：nav.openOverlay(ImagePreview, {job}, {name: IMAGE_OVERLAY})——job 由 src/ui/images-entry.js 组好：
//   {kind, title, note, plan, render(ratio) → Promise<{status, canvas}>, fileName(ratio), emptyNote?}
// 分发（01 §10：原生 → Web Share → 下载）：
//   分享  src/platform/share.js shareFile（M4-4）：原生 {type:'sharePracticeCard', name, dataURL, kind}（WebViewController.swift
//         sharePracticeCard，系统分享面板，无回调）→ navigator.share({files}) → 下载。PNG 在点击处理里同步做好（toDataURL + atob），
//         Web Share 仍在用户手势内。
//   保存  原生 {type:'savePracticeCard', name, dataURL, kind} → 等 iOS 回调 window.shiziCardSaved({success})（本文件 saveImageFile；
//         share.js 没有这一项）；浏览器 = 下载（share.js downloadBlob）。
//
// data-testid（前缀 image-）：image-preview（data-kind / data-state=loading|ready|pending|empty|noInk|renderFailed /
//   data-ratio / data-save=idle|busy|failed|saved）、image-ratio（data-ratio，aria-pressed）、image-board、image-canvas（画布，
//   dataset 见 core/images/render.js）、image-board-note、image-note、image-share、image-save、image-retry。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { Sheet } from './Sheet.js';
import { Button, markStateChange } from './Button.js';
import { showToast } from './Toast.js';
import { injectStyles, T } from './styles.js';
import { t } from '../../config/copy/index.js';
import { downloadBlob, shareFile } from '../../platform/share.js';
import { isNativeShell } from '../../platform/env.js';
import { bridge as nativeBridge } from '../../platform/bridge.js';

export const IMAGE_OVERLAY = 'image-preview';
export const PREVIEW_BOX = Object.freeze({ portrait: { width: 228, height: 304 }, square: { width: 250, height: 250 } });

injectStyles('image-preview', `
.sz-img{display:flex;flex-direction:column;gap:18px}
.sz-img__ratio{position:absolute;right:24px;top:25px;display:flex;padding:3px;border-radius:12px;background:${T.off}}
.sz-img__ratio button{width:52px;height:38px;min-height:38px;border-radius:9px;display:grid;place-items:center;
  font-size:calc(15px * ${T.k});color:${T.i3};font-variant-numeric:tabular-nums}
.sz-img__ratio button[aria-pressed="true"]{background:${T.c};color:${T.i1};box-shadow:0 1px 3px rgba(48,38,26,.12)}
.sz-img__board{align-self:center;flex:none;box-sizing:border-box;border:.5px solid #DED8CD;
  box-shadow:0 10px 24px rgba(59,47,40,.08);overflow:hidden;background:#FBF8F2;position:relative}
.sz-img__board canvas{display:block;width:100%;height:100%}
.sz-img__boardnote{position:absolute;inset:12px;display:grid;place-items:center;text-align:center;border:1px dashed #B3AC9F;
  border-radius:4px;padding:12px;font-size:13px;line-height:1.7;color:#5D5952}
.sz-img__note{margin:0;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2};text-wrap:pretty}
.sz-img__two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-sheet[data-testid="image-sheet"] .sz-sheet__title{padding-right:124px}
`);

// ---------------------------------------------------------------- 分发

/** data:image/png;base64,… → Blob（同步，保住 Web Share 的用户手势）。 */
export function dataURLToBlob(dataURL) {
  const comma = dataURL.indexOf(',');
  const bin = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/** 原生回调迟迟不来时放弃等待（相册授权弹窗可能停很久；过时按失败处理，按钮可再点）。 */
export const NATIVE_SAVE_TIMEOUT_MS = 120000;

let pendingSave = null;
let saveHandlerInstalled = false;

function onCardSaved(result) {
  const p = pendingSave;
  pendingSave = null;
  if (p) p.resolve(!!(result && result.success));
}

/**
 * 接 iOS 的 shiziCardSaved。正路是 bridge.registerNativeHandler（01 §8.1）；但 bridge.markReady 要到 M5-3 才在 app.js 调用，
 * 就绪前到达的回调只进队列、不交付，保存会一直等。本地绕过：桥未就绪时把 window.shiziCardSaved 包一层直接交给这里
 * （仍返回 true = 页面已接收）；桥就绪后照常走 bridge。已登记待定（M5-3 接上 markReady 后可删）。
 */
function installSaveHandler(bridge, w) {
  if (saveHandlerInstalled || !bridge || typeof bridge.registerNativeHandler !== 'function') return;
  saveHandlerInstalled = true;
  bridge.registerNativeHandler('shiziCardSaved', onCardSaved);
  if (w && typeof bridge.isReady === 'function') {
    const viaBridge = w.shiziCardSaved;
    w.shiziCardSaved = (...args) => {
      if (bridge.isReady()) return typeof viaBridge === 'function' ? viaBridge(...args) : true;
      onCardSaved(args[0]);
      return true;
    };
  }
}

/**
 * 分享图片（点击处理里调用）。
 * @returns {Promise<{via, done, cancelled?}>}
 */
export function shareImageFile({ dataURL, name, kind }, { win = typeof window !== 'undefined' ? window : null } = {}) {
  return shareFile({
    name,
    type: 'image/png',
    data: dataURLToBlob(dataURL),
    native: { type: 'sharePracticeCard', payload: { name, dataURL, kind } },
    win,
  });
}

/**
 * 保存图片：原生 → 相册（等 shiziCardSaved）；浏览器 → 下载。
 * @returns {Promise<{via:'native'|'download'|'none', ok:boolean}>}
 */
export async function saveImageFile({ dataURL, name, kind }, {
  win = typeof window !== 'undefined' ? window : null, bridge = nativeBridge, timeoutMs = NATIVE_SAVE_TIMEOUT_MS,
} = {}) {
  if (isNativeShell(win)) {
    installSaveHandler(bridge, win);
    if (pendingSave) pendingSave.resolve(false); // 上一次还没回来：作废
    const done = new Promise(resolve => {
      const timer = setTimeout(() => {
        pendingSave = null;
        resolve(false);
      }, timeoutMs);
      pendingSave = { resolve: ok => { clearTimeout(timer); resolve(ok); } };
    });
    if (!bridge.postNative('savePracticeCard', { name, dataURL, kind })) onCardSaved({ success: false });
    return { via: 'native', ok: await done };
  }
  const ok = downloadBlob(dataURLToBlob(dataURL), name, win);
  return { via: ok ? 'download' : 'none', ok };
}

// ---------------------------------------------------------------- 组件

/** 说明句：保存失败 → R-B10；否则按状态。 */
export function noteOf({ state, saveFailed, job }) {
  if (saveFailed) return t('R-B10.albumDenied');
  if (state === 'pending') return t('R-I01.overLimit');
  if (state === 'renderFailed') return t('X-IMAGES.renderFailed');
  if (state === 'empty' || state === 'noInk') return job.emptyNote || job.note || '';
  return job.note || '';
}

/**
 * @param {{job:object, close:Function, active?:boolean, share?:Function, save?:Function}} props
 */
export function ImagePreview({ job, close, active = true, share = shareImageFile, save = saveImageFile }) {
  const [ratio, setRatio] = useState('portrait');
  const [view, setView] = useState({ state: 'loading', canvas: null, ratio: null });
  const [busy, setBusy] = useState(null); // 'share' | 'save' | null
  const [saveState, setSaveState] = useState('idle'); // idle | failed | saved
  const boardRef = useRef(null);
  const renderSeq = useRef(0);

  const draw = r => {
    const seq = (renderSeq.current += 1);
    setView(v => ({ ...v, state: 'loading', ratio: r }));
    Promise.resolve()
      .then(() => job.render(r))
      .then(res => {
        if (seq !== renderSeq.current) return;
        const state = res && res.status === 'ready' && res.canvas ? 'ready' : (res && res.status) || 'renderFailed';
        setView({ state, canvas: state === 'ready' ? res.canvas : null, ratio: r });
      })
      .catch(error => {
        if (seq !== renderSeq.current) return;
        if (typeof console !== 'undefined') console.warn('[shizi] image render failed:', error);
        setView({ state: 'renderFailed', canvas: null, ratio: r });
      });
  };

  useEffect(() => {
    draw(ratio);
  }, [ratio, job]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    for (const old of [...board.querySelectorAll('canvas')]) old.remove();
    if (view.canvas) {
      view.canvas.setAttribute('data-testid', 'image-canvas');
      view.canvas.setAttribute('aria-hidden', 'true');
      board.insertBefore(view.canvas, board.firstChild);
    }
  }, [view.canvas]);

  const ready = view.state === 'ready' && !!view.canvas;
  const img = () => ({ dataURL: view.canvas.toDataURL('image/png'), name: job.fileName(view.ratio || ratio), kind: job.kind });

  const onShare = async () => {
    if (!ready || busy) return;
    let pending;
    try {
      pending = share(img()); // 同步发起（Web Share 要在用户手势内）
    } catch (error) {
      pending = Promise.reject(error);
    }
    setBusy('share');
    try {
      await pending;
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[shizi] image share failed:', error);
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    if (!ready || busy) return;
    let pending;
    try {
      pending = save(img());
    } catch (error) {
      pending = Promise.resolve({ ok: false });
    }
    setBusy('save');
    let res = null;
    try {
      res = await pending;
    } catch (error) {
      res = { ok: false };
    }
    setBusy(null);
    markStateChange();
    if (res && res.ok) {
      setSaveState('saved');
      if (res.via === 'native') showToast(t('R-B10.savedToAlbum'));
    } else {
      setSaveState('failed');
    }
  };

  const onRatio = r => {
    if (r === ratio) return;
    setSaveState(s => (s === 'failed' ? s : 'idle'));
    setRatio(r);
  };

  const failed = saveState === 'failed';
  const box = PREVIEW_BOX[ratio];
  const boardNote = !ready && view.state !== 'loading' ? noteOf({ state: view.state, saveFailed: false, job }) : '';
  const disabled = !ready || !!busy;
  return html`<${Sheet} title=${job.title} onClose=${close} active=${active} testid="image-sheet">
    <div class="sz-img" data-testid="image-preview" data-kind=${job.kind} data-state=${view.state} data-ratio=${ratio}
      data-save=${busy === 'save' ? 'busy' : saveState}>
      <div class="sz-img__ratio">
        ${['portrait', 'square'].map(r => html`<${Button} key=${r} variant="plain" guard=${false} data-testid="image-ratio" data-ratio=${r}
          aria-pressed=${r === ratio ? 'true' : 'false'} onClick=${() => onRatio(r)}>${t(r === 'portrait' ? 'X-IMAGES.ratioPortrait' : 'X-IMAGES.ratioSquare')}</${Button}>`)}
      </div>
      <div class="sz-img__board" ref=${boardRef} data-testid="image-board" role="img" aria-label=${job.title}
        style=${{ width: `${box.width}px`, height: `${box.height}px` }}>
        ${boardNote && view.state !== 'renderFailed' ? html`<span class="sz-img__boardnote" data-testid="image-board-note">${boardNote}</span>` : null}
      </div>
      <p class="sz-img__note" data-testid="image-note" aria-live="polite">${noteOf({ state: view.state, saveFailed: failed, job })}</p>
      <div class="sz-img__two">
        <${Button} variant="secondary" data-testid="image-share" disabled=${disabled} onClick=${onShare}>${t('R-B10.share')}</${Button}>
        ${failed
          ? html`<${Button} variant="primary" data-testid="image-retry" disabled=${disabled} onClick=${onSave}>${t('X-IMAGES.retry')}</${Button}>`
          : html`<${Button} variant="primary" data-testid="image-save" disabled=${disabled} onClick=${onSave}>${t('X-IMAGES.save')}</${Button}>`}
      </div>
    </div>
  </${Sheet}>`;
}
