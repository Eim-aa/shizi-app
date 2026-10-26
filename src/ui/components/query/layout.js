// 原生排版的折行点（B3.6；同结果页 B2.7 的做法：网页量出折行点，原生按这些位置换行）。
//
// 网页（WebKit）与原生（CoreText）的中文断行不一样：网页按 ICU 的中文词典断行（「记录」不拆开），
// 段落还按 text-wrap: pretty 平衡（base.css 的 p 规则）；原生按字断、贪心折行，折出来的行与网页不同。
// 这里在页面里用同一组 CSS 类排一份看不见的副本，量出每一行从第几个字开始，原生按这些位置换行
// （原生只排版与绘制，不另算规则）。没有 DOM（node:test）时返回 null（原生按自己的宽度折行）。
//
// 按钮文字另有一层：网页 Button.js 把文字经 Intl.Segmenter 分词、每个词包一个 nowrap 的 span
// （Words.js，R3-K1）——按钮只在词与词之间折行（「查看记录」折成「查看 / 记录」，「加入自选」折成「加入自 / 选」），
// 所以量按钮的折行点要照抄这层结构（wordsLineStarts），量裸文本会按字断、断点不一样。

import { segmentWords } from '../Words.js';

/**
 * 一段文字在某组 CSS 类下的折行点（每行第一个字的序号；按 Array.from 的字计）。
 * @param {string} text
 * @param {{wrapClass?: string, tag?: string, cls?: string, width: number, style?: string}} o
 *   wrapClass = 外层容器的类（决定内容宽度与内边距）；tag / cls = 文字所在的元素。
 * @returns {number[]|null} 折行点；量不到（没有 DOM / 宽度不对）时 null
 */
export function textLineStarts(text, { wrapClass = '', tag = 'div', cls = '', width, style = '' }) {
  if (!text || typeof document === 'undefined' || !document.body || !(width > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden;pointer-events:none`;
  try {
    const el = document.createElement(tag);
    el.className = cls;
    if (style) el.style.cssText = style;
    const node = document.createTextNode(text);
    el.appendChild(node);
    if (wrapClass) {
      const wrap = document.createElement('div');
      wrap.className = wrapClass;
      wrap.appendChild(el);
      host.appendChild(wrap);
    } else {
      host.appendChild(el);
    }
    document.body.appendChild(host);
    const starts = [];
    let lastTop = null;
    let off = 0;
    Array.from(text).forEach((ch, i) => {
      const len = ch.length;
      const range = document.createRange();
      range.setStart(node, off);
      range.setEnd(node, off + len);
      const rects = range.getClientRects();
      off += len;
      if (!rects.length) return;
      const top = rects[rects.length - 1].top;
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

/**
 * 按钮文字的折行点（网页 Button.js：文字经 Words 分词，每个词一个 nowrap 的 span，只能在词与词之间折）。
 * 量的是每个词所在的行；折行点 = 该词在原文里的起点（字符序号）。
 * @param {string} text
 * @param {{wrapClass?: string, cls?: string, width: number}} o
 * @returns {number[]|null}
 */
export function wordsLineStarts(text, { wrapClass = '', cls = 'sz-btn sz-btn--secondary', width }) {
  if (!text || typeof document === 'undefined' || !document.body || !(width > 0)) return null;
  const parts = segmentWords(text);
  if (parts.length <= 1) return []; // 一个词 = 不折行
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden;pointer-events:none`;
  try {
    const btn = document.createElement('button');
    btn.className = cls;
    // 网页 Button.js 的结构：外层 .sz-words，里面每个词一个 .sz-words__w（空白原样）。
    const outer = document.createElement('span');
    outer.className = 'sz-words';
    const spans = [];
    const offsets = [];
    let off = 0;
    for (const part of parts) {
      offsets.push(off);
      off += part.length;
      if (/^\s+$/u.test(part)) {
        outer.appendChild(document.createTextNode(part));
        spans.push(null);
        continue;
      }
      const span = document.createElement('span');
      span.className = 'sz-words__w';
      span.textContent = part;
      outer.appendChild(span);
      spans.push(span);
    }
    btn.appendChild(outer);
    if (wrapClass) {
      const wrap = document.createElement('div');
      wrap.className = wrapClass;
      wrap.appendChild(btn);
      host.appendChild(wrap);
    } else {
      host.appendChild(btn);
    }
    document.body.appendChild(host);
    const starts = [];
    let lastTop = null;
    spans.forEach((span, i) => {
      if (!span) return;
      const rects = span.getClientRects();
      if (!rects.length) return;
      const top = rects[0].top;
      if (lastTop !== null && top > lastTop + 8) starts.push(offsets[i]);
      lastTop = top;
    });
    return starts;
  } catch (error) {
    return null;
  } finally {
    host.remove();
  }
}

/** 视口宽（原生页与网页同一块屏）。 */
export function viewportWidth() {
  if (typeof document === 'undefined') return 0;
  return document.documentElement.clientWidth || window.innerWidth || 0;
}

/**
 * S02 正文的折行点（网页 .sz-confirm__body：p 的 text-wrap: pretty + 确认框的内边距）。
 * @param {string} text
 * @returns {number[]|null}
 */
export function s02BodyLineStarts(text) {
  // 确认框：左右页边 20（--gutter）+ 内边距 20（--s5）×2。
  const width = viewportWidth() - 80;
  return textLineStarts(text, { tag: 'p', cls: 'sz-confirm__body', width });
}

/**
 * 卡片次要键的折行点（网页 .sz-qcard__two 的两键格 + .sz-btn--secondary 的内边距；文字按词折）。
 * @param {string} text
 * @returns {number[]|null}
 */
export function cardActionLineStarts(text) {
  // 卡片内容宽 = 视口 − 左右页边 20 × 2；两键格 = 1fr 1fr、gap 12；键的内边距 8。
  const width = viewportWidth() - 40;
  return wordsLineStarts(text, { wrapClass: 'sz-qcard__two', cls: 'sz-btn sz-btn--secondary', width });
}
