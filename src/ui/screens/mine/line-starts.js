// 网页的折行点（B3.9；同 B2.7 结果页 native-view.js 的 webLineStarts 做法）。
//
// 原生这几个段落（练习记录的标题 / 图例、AX 列表的一行、年报的卷首一句与今年首字、月字帖的副标题）
// 与网页同一个折行：网页这些段落是 text-wrap: pretty（WebKit 按整段平衡折行），原生排版算法不同，
// 自己折出来的行不一样（例：AX3 的图例网页在第 8 字后折行、原生在第 10 字后）。
// 这里在页面里用同一组 CSS 类排一份看不见的副本，量出每一行从第几个字开始；原生按这些位置换行
// （字的样子仍由原生排）。没有 DOM（node:test）时返回 null（原生按自己的宽度折行）。
//
// 会话层不导入 UI：折行点由网页界面层量好后经 src/core/line-starts.js 的登记口交给会话层，
// 原生从 view.records / view.month / view.annual 的回包里取（同 B2.7 结果页 deps.result.view 的做法）。

import { setLineBreaker } from '../../../core/line-starts.js';

/** 页边的实际像素（CSS 变量 --gutter；styles.js 的 T.gutter 是 "var(--gutter)" 字符串，不能直接参与算术）。 */
function gutterPx() {
  if (typeof document === 'undefined' || !document.documentElement) return 20;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--gutter');
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** 版心宽（网页 .sz-page__body 的内容宽 = 屏宽 − 左右页边）。 */
function bodyWidth() {
  const w = (typeof document !== 'undefined' && document.documentElement ? document.documentElement.clientWidth : 402);
  return Math.max(0, w - 2 * gutterPx());
}

/** 网页的折行点：build(host) 往 host 里放一份看不见的副本并返回「单位表」，这里量出每一行从第几个单位开始。 */
export function webLineStarts(build, width) {
  if (typeof document === 'undefined' || !document.body || !(width > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden;pointer-events:none`;
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

/** 一段纯文字的单位表（按 Array.from 的字计）。 */
function textUnits(node) {
  const units = [];
  let off = 0;
  for (const ch of Array.from(node.data)) {
    units.push({ node, off, len: ch.length });
    off += ch.length;
  }
  return units;
}

/** 一段纯文字在某组 CSS 类下的折行点（按 Array.from 的字计）。 */
export function textLineStarts(text, { wrapClass, tag = 'p', cls }, width) {
  if (!text) return null;
  return webLineStarts(host => {
    const wrap = document.createElement('div');
    wrap.className = wrapClass;
    const el = document.createElement(tag);
    el.className = cls;
    const node = document.createTextNode(text);
    el.appendChild(node);
    wrap.appendChild(el);
    host.appendChild(wrap);
    return textUnits(node);
  }, width);
}

// ---------------------------------------------------------------- 三个子页的折行点

/**
 * 折行点的测量（登记给会话层）：{kind, text} → 每一行从第几个字开始（null = 量不到）。
 *
 * 每段的宽度按网页的版式算（与 core/images/layout.js、.sz-page__body 的页边同一套）：
 *   - 练习记录：版心宽（屏宽 − 左右页边）；
 *   - 月字帖：版心宽；
 *   - 年报：内容比版心宽 8（.sz-ann 的左右 −4 外边距）；今年首字那一行 = 内容宽 − 格 132 − 间距 20。
 */
export function mineSubLineBreaker(kind, text) {
  if (!text) return null;
  const w = bodyWidth();
  switch (kind) {
    case 'records-title':
      return textLineStarts(text, { wrapClass: 'sz-rec__head', cls: 'sz-rec__title' }, w);
    case 'records-legend':
      return textLineStarts(text, { wrapClass: 'sz-rec__head', cls: 'sz-rec__legend' }, w);
    case 'records-axrow':
      return textLineStarts(text, { wrapClass: '', tag: 'button', cls: 'sz-rec__axrow sz-btn' }, w);
    case 'records-paperday':
      return textLineStarts(text, { wrapClass: '', cls: 'sz-rec__paperday' }, w);
    case 'records-sheet-note':
      return textLineStarts(text, { wrapClass: 'sz-rec__sheet', cls: 'sz-monthpage__note' }, w);
    case 'records-daylist-title':
      return textLineStarts(text, { wrapClass: 'sz-rec__daylist', tag: 'h3', cls: 'sz-rec__subtitle' }, w);
    case 'month-sub':
      return textLineStarts(text, { wrapClass: 'sz-monthpage__head', cls: 'sz-monthpage__sub' }, w);
    case 'annual-head':
      return textLineStarts(text, { wrapClass: '', cls: 'sz-ann__line' }, w + 8);
    case 'annual-first-date':
      return textLineStarts(text, { wrapClass: 'sz-ann__fside', tag: 'span', cls: 'sz-ann__fdate' }, w + 8 - 132 - 20);
    default:
      return null;
  }
}

/** 登记折行点的测量（页面模块加载时登记一次；同 src/session/api/home.js 的登记做法）。 */
export function registerMineSubLineBreaker() {
  setLineBreaker(mineSubLineBreaker);
}

