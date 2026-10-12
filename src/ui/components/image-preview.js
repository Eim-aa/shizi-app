// 图片弹层 / 分享弹层（阶段 1 P1-E7；交接 §5.3 / §6.7 / §8.2；02 M4-5；04 R-I01–R-I04、R-B10；D31 / D39 / D46 ⑥ ⑦ / D47）。
// 四种图片共用：这次的图片（结果页右上「分享」）、{月}字帖（月字帖页 / 我的）、年报（年报页右上「分享」）、手写字图片（单字详情）。
//
// 版式（交接 §5.3）：底部弹层，头「标题 / 完成」；预览 = 导出图本身（永远是浅纸，不随主题）；比例分段 3:4 / 1:1（默认按 D47：1–3 字 1:1，
//   4 字以上 3:4）；「也放进来」只列有墨的写错字（chip：小格 + 「{字} · 写错」，选中 = 已放进来，带朱点）；底部「分享」（次）/「保存图片」（主），
//   保存成功不提示：保存键原地变「已存好」（I3 · P0-07）。删除「存下来的是图片，不能用来恢复记录」（DQ6）。
// 超过 80 字（D39）：预览横向翻页 + 页点，说明「{n} 个字，存成 {m} 张，每张不超过 80 字。」，主按钮「保存 {m} 张图片」；「分享」分享当前这一张。
// 年报（D46 ⑦）：默认册页（卷首 + 每月 + 卷尾，每张 3:4），主按钮「保存 {n} 张图片」；文字按钮「存成一张长图」（宽 1440，不受 80 字上限）。
//
// 打开：nav.openOverlay(ImagePreview, {job}, {name: IMAGE_OVERLAY})——job 由 src/ui/images-entry.js 组好：
//   {kind, title, ratios:['3:4'|'1:1'…], initialRatio, pageCount(ratio)→n, renderPage(i, ratio, {scale})→Promise<{status, canvas}>,
//    status(): 'ready'|'empty'|'noInk', n, note?, emptyNote?, chips?:()=>[{recordId, ch, ink, on}], toggleChip?(recordId), watch?(cb)→off,
//    fileName(ratio, i, total)→string, alt?:{label, note?, render()→Promise<canvas[]>, fileName(i,total)}}
// 分发（01 §10：原生 → Web Share → 下载）：
//   分享  src/platform/share.js shareFile：原生 {type:'sharePracticeCard', name, dataURL, kind} → navigator.share({files}) → 下载；JPEG 0.92（§6.5）。
//   保存  原生 {type:'savePracticeCard', …} 等 iOS 回调 window.shiziCardSaved({success})；浏览器 = 下载。
//   原生壳（WebViewController.imageData(fromDataURL:)）认 JPEG 与 PNG：原生通道与网页同样导出 JPEG 0.92（Q2-6，P162，NATIVE_ACCEPTS_JPEG = true）；
//   保存到相册时原生按原始字节写入，不再转码。
//
// data-testid（前缀 image-）：image-preview（data-kind / data-state=loading|ready|empty|noInk|renderFailed / data-ratio / data-save=idle|busy|failed|saved /
//   data-pages / data-page）、image-ratio（data-ratio，aria-pressed）、image-board（每页一块，data-page）、image-canvas（画布，dataset 见 core/images/render.js）、
//   image-pager / image-dot、image-board-note、image-note、image-chips / image-chip（data-char / data-on / aria-pressed）、image-share、image-save、
//   image-retry、image-long（年报「存成一张长图」）、image-done。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { Sheet } from './Sheet.js';
import { Button, markStateChange } from './Button.js';
import { FailBlock } from './FailBlock.js';
import { onShareFailed, shareFailedText } from './share-failed.js';
import { CellCanvas } from './work.js';
import { M } from '../../config/motion.js';
import { HIT_EXT, injectStyles, T } from './styles.js';
import { t } from '../../config/copy/index.js';
import { EXPORT_SCALE } from '../../core/images/layout.js';
import { JPEG_QUALITY } from '../../core/images/render.js';
import { downloadBlob, shareFile } from '../../platform/share.js';
import { isNativeShell } from '../../platform/env.js';
import { bridge as nativeBridge } from '../../platform/bridge.js';

export const IMAGE_OVERLAY = 'image-preview';
/** 预览板的 CSS 尺寸（交接：预览 = 导出图本身，按比例缩小）。 */
export const PREVIEW_BOX = Object.freeze({ '3:4': { width: 225, height: 300 }, '1:1': { width: 270, height: 270 }, portrait: { width: 225, height: 300 }, square: { width: 270, height: 270 } });
/** 页数多时预览用小一点的倍率（保存时按 EXPORT_SCALE 重画）。 */
export const PREVIEW_SCALE_MANY = 0.4;
/** 原生壳是否已经接受 JPEG（WebViewController.imageData 认 PNG 与 JPEG；阶段 1 Q2-6 放开，P162）。 */
export const NATIVE_ACCEPTS_JPEG = true;
/** 保存成功后，保存键显示「已存好」的时长（ms；成功不弹提示，状态在按钮上原地变化，I3 · P0-07 / 规范 F5）。 */
export const SAVED_FLASH_MS = M.timing.savedFlash;

injectStyles('image-preview', `
.sz-img{display:flex;flex-direction:column;gap:16px}
.sz-img__stage{display:flex;align-items:center;justify-content:center;box-sizing:border-box;margin:0 calc(-1 * ${T.gutter});padding:20px 0;
  min-height:calc(300px + 40px);background:${T.field}} /* 桌面：比弹层深一档的底（field），图是放在上面的一张笺（V3-03 / T3-06 / N3-04）；高度按最高的 3:4 留足，切比例时弹层不跳 */
.sz-img__scroll{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;box-sizing:border-box;width:calc(100% - 2 * ${T.gutter});padding:0 calc((100% - 2 * ${T.gutter} - var(--bw)) / 2); /* 百分比按包含块（桌面，满宽）算，补回来才居中（Q2-3）；左右各让出页边 20：翻页区不进左缘右滑的起手区（G1 / G2，审计 P1-12） */
  scrollbar-width:none;-webkit-overflow-scrolling:touch}
.sz-img__scroll::-webkit-scrollbar{display:none}
.sz-img__board{flex:none;box-sizing:border-box;overflow:hidden;position:relative;scroll-snap-align:center;animation:szImgFade ${T.dFade} ${T.eLinear} both;
  box-shadow:0 0 0 ${T.hair} ${T.line},${T.imgShadow}} /* 0.5pt 外缘 + 很轻的投影：一张放在桌上的纸（板自己是 t-light，不随主题） */
.sz-img__scroll{padding-top:6px;padding-bottom:14px;margin:-6px ${T.gutter} -14px;box-sizing:border-box} /* 滚动容器会裁掉投影：上下各留出投影的边 */
.sz-img__board canvas{display:block;width:100%;height:100%}
.sz-img__pager{display:flex;justify-content:center;gap:8px}
.sz-img__dot{width:6px;height:6px;border-radius:50%;background:${T.ink4}}
.sz-img__dot[data-on="true"]{background:${T.ink1}}
.sz-img__ratio{align-self:center;display:flex;padding:3px;border-radius:${T.rCtl};background:${T.field}}
.sz-img__ratio button{position:relative;width:60px;height:38px;min-height:38px;border-radius:calc(${T.rCtl} - 3px);display:grid;place-items:center;
  font-size:${T.fs15};color:${T.ink2};font-variant-numeric:tabular-nums}
.sz-img__ratio button::after{${HIT_EXT}} /* 视觉 38 高，热区 44（Q2-13） */
.sz-img__ratio button[aria-pressed="true"]{background:${T.paper};color:${T.ink1}}
.sz-img__boardnote{display:grid;place-items:center;text-align:center;margin:0 auto;
  padding:12px;box-sizing:border-box;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink2}}
.sz-img__note{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-img__note:empty{display:none}
.sz-img__chips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sz-img__chipslabel{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-img__chip.sz-btn{min-height:${T.hit};display:inline-flex;align-items:center;gap:8px;padding:4px 12px 4px 6px;border-radius:${T.rCtl};
  box-shadow:inset 0 0 0 1px ${T.line};font-size:${T.fs15};color:${T.ink1}}
.sz-img__chip.sz-btn[aria-pressed="true"]{background:${T.field};box-shadow:inset 0 0 0 ${T.targetW} ${T.ink1}}
.sz-img__chipcell{position:relative;width:32px;height:32px;flex:none;box-sizing:border-box;box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-img__chipcell canvas{position:absolute;left:0;top:0}
.sz-img__two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-img__long{align-self:center}
@keyframes szImgFade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.sz-img__board{animation-duration:${T.dReduce}}}
:root[data-ax] .sz-img__two{grid-template-columns:minmax(0,1fr)}
:root[data-ax] .sz-img__ratio{flex-direction:column;align-self:stretch} /* AX 档：比例两项上下排，不再压成「3:41:1」（V3-10） */
:root[data-ax] .sz-img__ratio button{width:auto;min-height:56px;height:auto;padding:0 12px}
`);

// ---------------------------------------------------------------- 分发

/** data:image/…;base64,… → Blob（同步，保住 Web Share 的用户手势）。 */
export function dataURLToBlob(dataURL) {
  const comma = dataURL.indexOf(',');
  const type = /^data:([^;,]+)/.exec(dataURL);
  const bin = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type ? type[1] : 'image/jpeg' });
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

/** 接 iOS 的 shiziCardSaved（01 §8.1：bridge.registerNativeHandler；app.js 启动时 bridge.markReady，M5-3）。 */
function installSaveHandler(bridge) {
  if (saveHandlerInstalled || !bridge || typeof bridge.registerNativeHandler !== 'function') return;
  saveHandlerInstalled = true;
  bridge.registerNativeHandler('shiziCardSaved', onCardSaved);
}

/** canvas → 导出用的 dataURL：网页 / 下载 / 原生壳都是 JPEG 0.92（§6.5；原生壳不接受 JPEG 的旧版本才退回 PNG，NATIVE_ACCEPTS_JPEG）。 */
export function exportImage(canvas, { win = typeof window !== 'undefined' ? window : null } = {}) {
  const native = isNativeShell(win) && !NATIVE_ACCEPTS_JPEG;
  return native ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** 文件名的扩展名跟着实际的图片格式走（PNG 时名字不能还写 .jpg）。 */
export function withExt(file) {
  return /^data:image\/png/.test(file.dataURL) ? { ...file, name: file.name.replace(/\.jpe?g$/i, '.png') } : file;
}

/** 分享图片（点击处理里调用）。 */
export function shareImageFile({ dataURL, name, kind }, { win = typeof window !== 'undefined' ? window : null } = {}) {
  const blob = dataURLToBlob(dataURL);
  return shareFile({
    name,
    type: blob.type,
    data: blob,
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
    installSaveHandler(bridge);
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
export function noteOf({ state, saveFailed, job, total = 1 }) {
  if (saveFailed) return t('R-B10.albumDenied');
  if (state === 'renderFailed') return t('X-IMAGES.renderFailed');
  if (state === 'empty' || state === 'noInk') return job.emptyNote || job.note || '';
  if (total > 1 && job.splitNote) return job.splitNote(total);
  return job.note || '';
}

/**
 * 保存 / 分享失败的三段式说明句（S1：按原因写，审计 P1-29——原先渲染、下载失败也一律说「请到手机设置里允许拾字添加照片」）。
 * reason：render（图没画出来）| denied（原生没能写进相册：多半是权限）| download（网页下载没成）；分享失败用 X-SHARE.cardFailed。
 */
export function failText(fail) {
  if (!fail) return '';
  if (fail.kind === 'share') return shareFailedText('card');
  if (fail.reason === 'render') return t('X-IMAGES.renderFailed');
  if (fail.reason === 'denied') return t('R-B10.albumDenied');
  return t('X-IMAGES.saveFailed');
}

/** cond 连续为真超过 ms 才为真（F4：< 400ms 的等待什么都不显示，不闪「正在…」）。 */
function useDelayedFlag(cond, ms) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!cond) {
      setOn(false);
      return undefined;
    }
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [cond]);
  return cond && on;
}

function useJobVersion(job) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!job || typeof job.watch !== 'function') return undefined;
    return job.watch(() => setVersion(v => v + 1));
  }, [job]);
  return version;
}

/**
 * @param {{job:object, close:Function, active?:boolean, share?:Function, save?:Function}} props
 */
export function ImagePreview({ job, close, active = true, share = shareImageFile, save = saveImageFile }) {
  const [ratio, setRatio] = useState(job.initialRatio || job.ratios[0]);
  const [view, setView] = useState({ state: 'loading', canvases: [], ratio: null, scale: EXPORT_SCALE });
  const [busy, setBusy] = useState(null); // 'share' | 'save' | 'long' | null
  const [saveState, setSaveState] = useState('idle'); // idle | failed | saved
  const [fail, setFail] = useState(null); // null | {kind:'save', reason} | {kind:'share'}：保存 / 分享失败的就地三段式（S1，审计 P1-29 / P1-30）
  const [page, setPage] = useState(0);
  // 原生分享面板没打开（shiziShareFailed kind=card）：预览还开着，就在这里就地给三段式，不另出提示条（F3）
  useEffect(() => onShareFailed(kind => {
    if (kind !== 'card') return false;
    setFail({ kind: 'share' });
    markStateChange();
    return true;
  }), []);
  const scrollRef = useRef(null);
  const renderSeq = useRef(0);
  const version = useJobVersion(job);

  useEffect(() => {
    if (saveState !== 'saved') return undefined;
    const timer = setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [saveState]);

  const draw = r => {
    const seq = (renderSeq.current += 1);
    Promise.resolve()
      .then(async () => {
        const status = job.status();
        if (status !== 'ready') return { state: status, canvases: [] };
        const total = job.pageCount(r);
        const scale = total <= 3 ? EXPORT_SCALE : PREVIEW_SCALE_MANY;
        const canvases = [];
        for (let i = 0; i < total; i += 1) {
          const res = await job.renderPage(i, r, { scale });
          if (seq !== renderSeq.current) return null;
          if (!res || res.status !== 'ready' || !res.canvas) return { state: (res && res.status) || 'renderFailed', canvases: [] };
          canvases.push(res.canvas);
        }
        return { state: 'ready', canvases, scale };
      })
      .then(res => {
        if (!res || seq !== renderSeq.current) return;
        setView({ state: res.state, canvases: res.canvases, ratio: r, scale: res.scale || EXPORT_SCALE });
        setPage(p => Math.min(p, Math.max(0, res.canvases.length - 1)));
      })
      .catch(error => {
        if (seq !== renderSeq.current) return;
        if (typeof console !== 'undefined') console.warn('[shizi] image render failed:', error);
        setView({ state: 'renderFailed', canvases: [], ratio: r, scale: EXPORT_SCALE });
      });
  };

  useEffect(() => {
    draw(ratio);
  }, [ratio, job, version]);

  const boards = useRef([]);
  useLayoutEffect(() => {
    boards.current.forEach((board, i) => {
      if (!board) return;
      for (const old of [...board.querySelectorAll('canvas')]) old.remove();
      const canvas = view.canvases[i];
      if (canvas) {
        canvas.setAttribute('data-testid', 'image-canvas');
        canvas.setAttribute('aria-hidden', 'true');
        board.insertBefore(canvas, board.firstChild);
      }
    });
  }, [view.canvases]);

  const total = view.canvases.length;
  const ready = view.state === 'ready' && total > 0;
  const curRatio = view.ratio || ratio;
  const box = PREVIEW_BOX[curRatio] || PREVIEW_BOX['3:4'];
  const chips = typeof job.chips === 'function' ? job.chips() : [];

  /** 第 i 页的导出图（预览倍率不是导出倍率时重画）。 */
  const exportCanvas = async i => {
    if (view.scale === EXPORT_SCALE && view.canvases[i]) return view.canvases[i];
    const res = await job.renderPage(i, curRatio, { scale: EXPORT_SCALE });
    if (!res || res.status !== 'ready') throw new Error('render failed');
    return res.canvas;
  };
  const img = (canvas, i, count) => withExt({ dataURL: exportImage(canvas), name: job.fileName(curRatio, i, count), kind: job.kind });

  const onShare = async () => {
    if (!ready || busy) return;
    const i = Math.min(page, total - 1);
    let pending;
    try {
      pending = view.scale === EXPORT_SCALE && view.canvases[i] ? share(img(view.canvases[i], i, total)) : exportCanvas(i).then(c => share(img(c, i, total)));
    } catch (error) {
      pending = Promise.reject(error);
    }
    setBusy('share');
    setFail(null);
    try {
      const res = await pending;
      // 网页：分享与下载都不行（via none）→ 就地三段式；用户自己取消、原生（结果另由 shiziShareFailed 回来）不算失败
      if (res && res.via === 'none' && !res.done && !res.cancelled) setFail({ kind: 'share' });
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[shizi] image share failed:', error);
      setFail({ kind: 'share' });
    } finally {
      setBusy(null);
    }
  };

  const saveAll = async (canvasesFor, count, nameOf) => {
    let res = { ok: true, via: 'none' };
    for (let i = 0; i < count; i += 1) {
      let one;
      let canvas = null;
      try {
        canvas = await canvasesFor(i);
        one = await save(withExt({ dataURL: exportImage(canvas), name: nameOf(i, count), kind: job.kind }));
      } catch (error) {
        one = { ok: false, reason: canvas ? 'download' : 'render' };
      }
      if (!one || !one.ok) {
        const reason = (one && one.reason) || (one && one.via === 'native' ? 'denied' : 'download');
        return { ok: false, via: one && one.via, reason };
      }
      res = one;
    }
    return res;
  };

  const finishSave = res => {
    setBusy(null);
    markStateChange();
    if (res && res.ok) {
      setSaveState('saved'); // 成功不提示（F5）：保存键原地变「已存好」，约 1.5 秒后恢复
      setFail(null);
    } else {
      setSaveState('failed');
      setFail({ kind: 'save', reason: (res && res.reason) || 'download' });
    }
  };

  const onSave = async () => {
    if (!ready || busy) return;
    setFail(null);
    setBusy('save');
    finishSave(await saveAll(exportCanvas, total, (i, n) => job.fileName(curRatio, i, n)));
  };

  const onSaveLong = async () => {
    if (!ready || busy || !job.alt) return;
    setBusy('long');
    let canvases = [];
    try {
      canvases = await job.alt.render();
    } catch (error) {
      canvases = [];
    }
    if (!canvases.length) {
      finishSave({ ok: false, reason: 'render' });
      return;
    }
    finishSave(await saveAll(async i => canvases[i], canvases.length, (i, n) => job.alt.fileName(i, n)));
  };

  const onRatio = r => {
    if (r === ratio) return;
    setSaveState(s => (s === 'failed' ? s : 'idle'));
    setRatio(r);
  };

  const onScroll = event => {
    const el = event.currentTarget;
    if (!el || total < 2) return;
    const first = el.firstElementChild;
    if (!first) return;
    const step = first.getBoundingClientRect().width + 14;
    const next = Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / step)));
    if (next !== page) setPage(next);
  };

  // F4（审计 P1-33）：等待超过 timing.loadingQuiet（400ms）才把按钮改成进行时文案、标 aria-busy；更短的等待什么都不显示
  const slowLoad = useDelayedFlag(view.state === 'loading', M.timing.loadingQuiet);
  const slowBusy = useDelayedFlag(!!busy, M.timing.loadingQuiet);
  const loadingNote = slowLoad ? t('X-IMAGES.rendering') : '';
  const boardNote = !ready && view.state !== 'loading' && view.state !== 'renderFailed' ? noteOf({ state: view.state, saveFailed: false, job }) : loadingNote;
  const disabled = !ready || !!busy;
  const placeholders = !ready ? 1 : total;
  const saveLabel = total > 1 ? t('X-WORK.saveMany', { m: total }) : t('X-IMAGES.save');
  const justSaved = saveState === 'saved';
  const mainSave = slowBusy && (busy === 'save' || busy === 'long') ? t('X-IMAGES.saving') : justSaved ? t('X-IMAGES.saved') : job.saveLabel ? job.saveLabel(total) : saveLabel;
  const shareLabel = slowBusy && busy === 'share' ? t('X-IMAGES.rendering') : t('R-B10.share');
  const actions = fail
    ? html`${FailBlock({ testid: 'image-fail', layout: 'dialog', text: failText(fail), cancelLabel: fail.kind === 'share' ? t('X-IMAGES.shareStay') : t('R-W16.cancel'), retryTestid: fail.kind === 'share' ? 'image-share-retry' : 'image-retry', retryLabel: t('X-IMAGES.retry'), busy: disabled, onCancel: () => { setFail(null); setSaveState('idle'); markStateChange(); }, onRetry: fail.kind === 'share' ? onShare : onSave })}`
    : html`<div class="sz-img__two">
        <${Button} variant="secondary" data-testid="image-share" disabled=${disabled} onClick=${onShare}>${shareLabel}</${Button}>
        <${Button} variant="primary" data-testid="image-save" disabled=${disabled || justSaved} onClick=${onSave}>${mainSave}</${Button}>
      </div>`;
  return html`<${Sheet} title=${job.title} onClose=${close} active=${active} testid="image-sheet" doneTestid="image-done">
    <div class="sz-img" data-testid="image-preview" data-kind=${job.kind} data-state=${view.state} data-ratio=${curRatio}
      data-pages=${total} data-page=${page} data-save=${busy === 'save' ? 'busy' : saveState} aria-busy=${slowLoad || slowBusy ? 'true' : undefined}>
      <div class="sz-img__stage" data-testid="image-stage">
      ${boardNote
        ? html`<span class="sz-img__boardnote" data-testid="image-board-note" style=${{ width: `${box.width}px`, height: `${box.height}px` }}>${boardNote}</span>`
        : html`<div class="sz-img__scroll" ref=${scrollRef} onScroll=${onScroll} style=${{ '--bw': `${box.width}px` }} role="group" aria-label=${t('X-WORK.previewAria')}>
            ${Array.from({ length: placeholders }, (_, i) => html`<div key=${`${curRatio}-${i}-${total}`} class="sz-img__board t-light" data-testid="image-board" data-page=${i}
              ref=${el => { boards.current[i] = el; }} role="img"
              aria-label=${total > 1 ? t('X-WORK.pageAria', { k: i + 1, m: total }) : job.title}
              style=${{ width: `${box.width}px`, height: `${box.height}px` }}></div>`)}
          </div>`}
      </div>
      ${total > 1
        ? html`<div class="sz-img__pager" data-testid="image-pager">${Array.from({ length: total }, (_, i) => html`<span key=${i} class="sz-img__dot" data-testid="image-dot" data-on=${i === page ? 'true' : 'false'}></span>`)}</div>`
        : null}
      ${job.ratios.length > 1
        ? html`<div class="sz-img__ratio" role="group">
            ${job.ratios.map(r => html`<${Button} key=${r} variant="plain" guard=${false} data-testid="image-ratio" data-ratio=${r}
              aria-pressed=${r === ratio ? 'true' : 'false'} onClick=${() => onRatio(r)}>${r}</${Button}>`)}
          </div>`
        : null}
      <p class="sz-img__note" data-testid="image-note" aria-live="polite">${noteOf({ state: view.state, saveFailed: false, job, total })}</p>
      ${chips.length
        ? html`<div class="sz-img__chips" data-testid="image-chips">
            <span class="sz-img__chipslabel">${t('X-WORK.alsoAdd')}</span>
            ${chips.map(chip => html`<${Button} key=${chip.recordId} variant="plain" class="sz-img__chip" data-testid="image-chip" data-char=${chip.ch}
              data-on=${chip.on ? 'true' : 'false'} aria-pressed=${chip.on ? 'true' : 'false'}
              onClick=${() => job.toggleChip && job.toggleChip(chip.recordId)}>
              <span class="sz-img__chipcell" aria-hidden="true"><${CellCanvas} ch=${chip.ch} ink=${chip.ink} size=${32} testid="image-chip-canvas" /></span>
              <span>${t('X-WORK.chipWrong', { char: chip.ch })}</span>
            </${Button}>`)}
          </div>`
        : null}
      ${actions}
      ${job.alt
        ? html`<${Button} variant="text" class="sz-img__long" data-testid="image-long" disabled=${disabled} onClick=${onSaveLong}>${job.alt.label}</${Button}>`
        : null}
    </div>
  </${Sheet}>`;
}
