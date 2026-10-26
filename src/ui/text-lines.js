// 页面层：量网页的折行点（原生要跟网页折在同一处）。
//
// 网页的段落是 text-wrap: pretty（src/config/base.css），WebKit 的折法不是贪心折行。这里在页面里用同一组 CSS 类
// 排一份看不见的副本（宽度照网页的宽），量出每一行从第几个字开始，登记到会话层的表里（src/session/text-lines.js）——
// App API（src/session/api/**）取结果随 view 回包给原生，原生按这些位置断行。
// 与结果页 src/ui/screens/result/native-view.js 的 webLineStarts 同一做法。

import { registerTextLines } from '../session/text-lines.js';

export { registerTextLines };

/** 一个字 = 一个单位（按 Array.from 的字计，与网页一致）。 */
export function textUnits(node) {
  const units = [];
  let off = 0;
  for (const ch of Array.from(node.data)) {
    units.push({ node, off, len: ch.length });
    off += ch.length;
  }
  return units;
}

/**
 * 在一个看不见的 host 里排 build(host) 出来的副本，量每一行从第几个单位开始。
 * build(host) 把副本放进 host，并返回单位表（textUnits 的结果）。
 * 换行的判据：下一行的竖向位置比上一行低了半行以上（被遮住的那一位方框只下沉 0.12em，不算换行）。
 * @param {(host: HTMLElement) => {node: Node, off: number, len: number}[]} build
 * @param {number} width host 的宽（pt / px）
 * @returns {number[]|null}
 */
export function domLineStarts(build, width) {
  if (typeof document === 'undefined' || !document.body || !(width > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;min-height:900px;visibility:hidden;pointer-events:none`;
  try {
    const units = build(host);
    document.body.appendChild(host);
    const starts = [];
    let lastTop = null;
    units.forEach((u, i) => {
      let top = null;
      if (u.el) {
        top = u.el.getBoundingClientRect().top;
      } else {
        const r = document.createRange();
        r.setStart(u.node, u.off);
        r.setEnd(u.node, u.off + u.len);
        const rects = r.getClientRects();
        if (rects.length) top = rects[rects.length - 1].top;
      }
      if (top === null) return;
      if (lastTop !== null && top > lastTop + 8) starts.push(i); // 换行 = 竖向跳过半行以上
      lastTop = top;
    });
    return starts;
  } catch (error) {
    return null;
  } finally {
    host.remove();
  }
}

/** 屏宽（网页正文块的宽 = 屏宽；左右页边由 .sz-page__body 自己的内边距给）。 */
export function screenWidth() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const w = root ? root.clientWidth : 0;
  return w > 0 ? w : 402;
}
