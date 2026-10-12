// 图片直接导出（I3 · P0-04 / P1-23；规范 B3「常用操作一次点击」、F5「成功无需提示」）。
// 月字帖 / 年报页的「保存图片」「分享」不先开预览弹层：按任务（job，形状见 components/image-preview.js 头注）的默认比例直接渲染并保存 / 分享；
// 预览弹层只在用户要调整图片（比例、分张、也放进来）时进入（页头「调整图片 ›」）。
// 保存 / 分享函数可注入（单测）；缺省与预览弹层同一套（原生 → Web Share → 下载，JPEG 0.92）。
import { useEffect, useState } from '../../vendor/ui.js';
import { t } from '../config/copy/index.js';
import { EXPORT_SCALE } from '../core/images/layout.js';
import { markStateChange } from './components/Button.js';
import { SAVED_FLASH_MS, exportImage, saveImageFile, shareImageFile, withExt } from './components/image-preview.js';

/** 第 i 页的导出图（导出倍率）。渲染失败时抛错。 */
export async function quickExportCanvas(job, i, ratio = job.initialRatio || (job.ratios && job.ratios[0])) {
  const res = await job.renderPage(i, ratio, { scale: EXPORT_SCALE });
  if (!res || res.status !== 'ready' || !res.canvas) throw new Error('render failed');
  return res.canvas;
}

function fileOf(job, canvas, i, total, ratio) {
  return withExt({ dataURL: exportImage(canvas), name: job.fileName(ratio, i, total), kind: job.kind });
}

/**
 * 保存全部页（超过 80 字按日期分张时是几张就存几张）。
 * @returns {Promise<{ok:boolean, via?:string}>}
 */
export async function quickSave(job, { save = saveImageFile, ratio = job.initialRatio || (job.ratios && job.ratios[0]) } = {}) {
  if (!job || job.status() !== 'ready') return { ok: false };
  const total = job.pageCount(ratio);
  let last = { ok: true, via: 'none' };
  for (let i = 0; i < total; i += 1) {
    let one;
    try {
      const canvas = await quickExportCanvas(job, i, ratio);
      one = await save(fileOf(job, canvas, i, total, ratio));
    } catch (error) {
      one = { ok: false };
    }
    if (!one || !one.ok) return { ok: false, via: one && one.via };
    last = one;
  }
  return { ok: true, via: last.via };
}

/**
 * 直接分享：只有一张图时分享这一张；多张时分享哪一张是一个选择，交给预览弹层（needsPreview）。
 * 用户在系统分享面板里取消不算失败。
 * @returns {Promise<{ok:boolean, needsPreview?:boolean}>}
 */
export async function quickShare(job, { share = shareImageFile, ratio = job.initialRatio || (job.ratios && job.ratios[0]) } = {}) {
  if (!job || job.status() !== 'ready') return { ok: false };
  const total = job.pageCount(ratio);
  if (total > 1) return { ok: false, needsPreview: true };
  try {
    const canvas = await quickExportCanvas(job, 0, ratio);
    await share(fileOf(job, canvas, 0, 1, ratio));
    return { ok: true };
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[shizi] image share failed:', error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------- 页面接线（月字帖 / 年报共用）

/** 开始等待超过多久，保存键才改成进行时文案（规范 F4 loadingQuiet）。 */
export const SAVING_QUIET_MS = 400;

/**
 * 「保存图片」键的状态流：idle → busy（400ms 后文案「正在保存…」）→ saved（1.5 秒「已存好」）/ failed（「再试一次」+ 说明）。
 * @param {() => Promise<object>} makeJob  每次点击现取任务（读最新 store）
 * @returns {{state:string, label:string, disabled:boolean, note:string, save:() => Promise<void>}}
 */
export function useSaveFlow(makeJob, { save = quickSave } = {}) {
  const [state, setState] = useState('idle'); // idle | busy | saved | failed
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state === 'saved') {
      const timer = setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), SAVED_FLASH_MS);
      return () => clearTimeout(timer);
    }
    if (state === 'busy') {
      setSlow(false);
      const timer = setTimeout(() => setSlow(true), SAVING_QUIET_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state]);
  const run = async () => {
    if (state === 'busy' || state === 'saved') return;
    setState('busy');
    let res;
    try {
      res = await save(await makeJob());
    } catch (error) {
      res = { ok: false };
    }
    setState(res && res.ok ? 'saved' : 'failed');
    markStateChange();
  };
  const label = state === 'saved' ? t('X-IMAGES.saved') : state === 'failed' ? t('X-IMAGES.retry') : state === 'busy' && slow ? t('X-IMAGES.saving') : t('X-IMAGES.save');
  return { state, label, disabled: state === 'busy' || state === 'saved', note: state === 'failed' ? t('R-B10.albumDenied') : '', save: run };
}
