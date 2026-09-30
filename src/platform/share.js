// 文件分发三级（01 §8.1 / §10；02 M4-4「导出备份文件（分发三级：原生 shareBackup → Web Share → 下载）」）：
//   1. 原生壳（iOS WKWebView，有 webkit.messageHandlers.shiziNative）：postMessage({type, …})，由 Swift 弹系统分享面板；
//      完成与否由原生回调（备份：markBackupExported()，Swift 只在 completed 时调用）。这里返回 {via:'native', done:false}。
//   2. Web Share Level 2（navigator.canShare({files}) 为真）：navigator.share({files})；resolve = 用户完成分享 → done:true；
//      AbortError = 用户取消 → cancelled:true（不记导出，旧版「取消分享不误记」）；其他错误退到第 3 级。
//   3. 下载：<a download> + Blob URL；浏览器不告诉页面有没有真的存下，按 done:true 处理（旧版同口径）。
// Web Share 要求「用户手势内」调用：调用方在点击处理里同步准备好文件文本，再调 shareFile（本函数在 await 之前就调用 share）。
// M4-5 图片（sharePracticeCard / savePracticeCard）可复用 shareFile 的第 2、3 级；原生消息类型由调用方给。

import { isNativeShell } from './env.js';
import { postNative } from './bridge.js';

export const DOWNLOAD_REVOKE_MS = 30000;

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** 这个环境能不能用 Web Share 分享这些文件。 */
export function canShareFiles(files, win = globalWin()) {
  try {
    const nav = win && win.navigator;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    return nav.canShare({ files }) === true;
  } catch (error) {
    return false;
  }
}

/** 触发浏览器下载。返回是否成功发起。 */
export function downloadBlob(blob, name, win = globalWin()) {
  try {
    const doc = win && win.document;
    const URL_ = win && (win.URL || win.webkitURL);
    if (!doc || !URL_ || typeof URL_.createObjectURL !== 'function') return false;
    const url = URL_.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    (doc.body || doc.documentElement).appendChild(a);
    a.click();
    a.remove();
    const timer = win.setTimeout || setTimeout;
    timer(() => {
      try {
        URL_.revokeObjectURL(url);
      } catch (error) {
        // 已释放
      }
    }, DOWNLOAD_REVOKE_MS);
    return true;
  } catch (error) {
    return false;
  }
}

function isAbort(error) {
  return !!error && (error.name === 'AbortError' || error.code === 20);
}

/**
 * 分发一个文件。
 * @param {object} o
 * @param {string} o.name            文件名
 * @param {string} o.type            MIME
 * @param {string|Blob} o.data       文本或 Blob
 * @param {{type:string, payload:object}} [o.native]  原生消息（缺省不走原生）
 * @param {string} [o.title]         Web Share 的标题
 * @param {object} [o.win]           测试注入
 * @returns {Promise<{via:'native'|'share'|'download'|'none', done:boolean, cancelled?:boolean, error?:any}>}
 */
export async function shareFile({ name, type, data, native = null, title = '', win = globalWin() }) {
  if (native && isNativeShell(win) && postNative(native.type, native.payload)) {
    return { via: 'native', done: false };
  }
  const blob = data instanceof Blob ? data : new Blob([String(data)], { type });
  let file = null;
  try {
    file = typeof File === 'function' ? new File([blob], name, { type }) : null;
  } catch (error) {
    file = null;
  }
  if (file && canShareFiles([file], win)) {
    try {
      await win.navigator.share(title ? { files: [file], title } : { files: [file] });
      return { via: 'share', done: true };
    } catch (error) {
      if (isAbort(error)) return { via: 'share', done: false, cancelled: true };
      // 其他错误（NotAllowedError 等）退到下载
    }
  }
  if (downloadBlob(blob, name, win)) return { via: 'download', done: true };
  return { via: 'none', done: false, error: new Error('no way to share or download') };
}

/** 备份文件：原生 shareBackup {name, payload}（WebViewController.swift）→ Web Share → 下载。 */
export function shareBackupFile({ name, text, win = globalWin() }) {
  return shareFile({
    name,
    type: 'application/json',
    data: text,
    native: { type: 'shareBackup', payload: { name, payload: text } },
    win,
  });
}
