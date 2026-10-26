// 原生「我的」页的折行点（B3.5c；页面侧，由 ui/native-stage.js 在 view.mine 的回包上加 `lines`）。
//
// 网页这几段是 text-wrap: pretty（WebKit 按整段平衡折行），TextKit 没有对应规则，原生自己折出来的行不一样（B2.7 的做法）：这里在页面里用同一组 CSS 类排一份看不见的副本，
// 量出每一行从第几个字开始，原生按这些位置换行（字的样子仍由原生排）。没有 DOM（node:test）时不加 lines（原生按自己的宽度折行）。
//   lines.note      字帖说明句（.sz-monthpage__note，宽 = 页宽 − 40）
//   lines.failNote  选择失败说明（.sz-fail__note，宽 = 页宽 − 40）
//   lines.emptyBody 空态说明（.sz-empty__body，宽 = 页宽 − 40）
import { tRef } from '../../../config/copy/index.js';

/** 一段纯文字在某组 CSS 类下的折行点（按 Array.from 的字计；返回每个新行起始字的序号）。 */
export function textLineStarts(text, { wrapClass, cls }, width) {
  if (typeof document === 'undefined' || !document.body || !text || !(width > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden;pointer-events:none`;
  try {
    const wrap = document.createElement('div');
    wrap.className = wrapClass;
    const el = document.createElement('p');
    el.className = cls;
    const node = document.createTextNode(text);
    el.appendChild(node);
    wrap.appendChild(el);
    host.appendChild(wrap);
    document.body.appendChild(host);
    const starts = [];
    let lastTop = null;
    let off = 0;
    Array.from(text).forEach((ch, i) => {
      const r = document.createRange();
      r.setStart(node, off);
      r.setEnd(node, off + ch.length);
      const rects = r.getClientRects();
      off += ch.length;
      if (!rects.length) return;
      const top = rects[rects.length - 1].top;
      if (lastTop !== null && top > lastTop + 8) starts.push(i);
      lastTop = top;
    });
    return starts;
  } catch (error) {
    return null;
  } finally {
    host.remove();
  }
}

/** view.mine 的回包 → 加上折行点（失败回包原样返回）。 */
export function decorateMineReply(reply, width) {
  if (!reply || reply.ok !== true || !reply.view) return reply;
  const view = reply.view;
  const w = (Number.isFinite(width) && width > 0 ? width : view.env && view.env.width) - 40;
  const lines = {
    note: view.sheet && view.sheet.note ? textLineStarts(tRef(view.sheet.note), { wrapClass: 'sz-mine', cls: 'sz-monthpage__note' }, w) : null,
    failNote: textLineStarts(tRef(view.choiceFail.note), { wrapClass: 'sz-fail', cls: 'sz-fail__note' }, w),
    emptyBody: view.emptyBlock ? textLineStarts(tRef(view.emptyBlock.body), { wrapClass: 'sz-empty', cls: 'sz-empty__body' }, w) : null,
  };
  return { ...reply, view: { ...view, lines } };
}
