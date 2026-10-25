// 网页量的折行点（界面层；B3.12 / B3.13）。
//
// 会话层（src/session/views/lines.js）只留一个槽位，量法在这里：把这段字按网页上那一组 CSS 类排一份看不见的副本，
// 量出每一行从第几个字开始。原生按这些位置换行（字的样子仍由原生排）——
// 与 src/ui/screens/result/native-view.js 的 webLineStarts 同一套做法（那边是结果页的段落，这边是空状态 / 阻断页 / 浮条）。
//
// 量的时候必须用同一组类：字号、行高、text-wrap（p 的 pretty、标题的 balance）都在类里。

import { setLineMeasurer } from '../../session/views/lines.js';

/** 视口宽（px）。 */
export function viewportWidth() {
  try {
    return (document.documentElement && document.documentElement.clientWidth) || 0;
  } catch (error) {
    return 0;
  }
}

/** 页边（px）：令牌 --gutter（读不到就量一个探针，量不到返回 0）。 */
export function gutterPx() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--gutter');
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (error) {
    // 读不到计算样式：下面量探针
  }
  try {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;left:-10000px;top:0;width:var(--gutter);height:1px;visibility:hidden';
    document.body.appendChild(p);
    const w = p.getBoundingClientRect().width;
    p.remove();
    if (w > 0) return w;
  } catch (error) {
    // 探针也量不到
  }
  return 0;
}

/** 页面正文宽（视口 − 两侧页边）；量不到页边时返回 0（量不了折行）。 */
export function pageWidth() {
  const g = gutterPx();
  if (!(g > 0)) return 0;
  return Math.max(0, viewportWidth() - 2 * g);
}

/**
 * 各种段落在网页上的写法（类 + 标签）。会话层只说「哪一段」，不说 CSS。
 * 类里带着字号、行高与 text-wrap（p 的 pretty、标题的 balance）——量的时候必须用同一组类。
 */
const VARIANTS = {
  'empty-title': { cls: 'sz-empty__title', tag: 'h2' },
  'empty-body': { cls: 'sz-empty__body', tag: 'p' },
  'block-line': { cls: 'sz-block__line', tag: 'p' },
  'corrupt-text': { cls: 'sz-corrupt__text', tag: 'p' },
};

/**
 * 量一段字在给定宽度下的折行点。
 * @param {{text: string, variant?: string, cls?: string, tag?: string, width?: number,
 *          parentCls?: string, parentTag?: string, siblingCls?: string, siblingTag?: string}} spec
 *   variant：哪一段（见 VARIANTS）；width：副本容器的宽（0 = 页面正文宽）；
 *   parentCls：这段字外面那一层（类名；那层自己会左右让开，如浮条）；siblingCls：同一层里在它前面的兄弟（如关闭键）。
 * @returns {number[]|null} 每一行从第几个字开始（第一行是 0，不在数组里）；量不到返回 null
 */
export function measureLines(spec) {
  const s = spec || {};
  const text = typeof s.text === 'string' ? s.text : '';
  if (!text || typeof document === 'undefined' || !document.body) return null;
  const v = VARIANTS[s.variant] || {};
  const width = s.width > 0 ? s.width : pageWidth();
  if (!(width > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden;pointer-events:none`;
  try {
    let scope = host;
    if (s.parentCls) {
      const parent = document.createElement(s.parentTag || 'div');
      parent.className = s.parentCls;
      host.appendChild(parent);
      scope = parent;
    }
    if (s.siblingCls) {
      const sib = document.createElement(s.siblingTag || 'div');
      sib.className = s.siblingCls;
      scope.appendChild(sib);
    }
    const el = document.createElement(s.tag || v.tag || 'p');
    const cls = s.cls || v.cls;
    if (cls) el.className = cls;
    const node = document.createTextNode(text);
    el.appendChild(node);
    scope.appendChild(el);
    document.body.appendChild(host);
    // 每一行从第几个字开始：竖向跳过半行以上就算换行（被遮住的那一位方框下沉 0.12em，不算换行）
    const chars = Array.from(text);
    const starts = [];
    let lastTop = null;
    for (let i = 0; i < chars.length; i += 1) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + chars[i].length);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const top = rects[rects.length - 1].top;
      if (lastTop !== null && top > lastTop + 8) starts.push(i);
      lastTop = top;
    }
    return starts;
  } catch (error) {
    return null;
  } finally {
    host.remove();
  }
}

// 会话层取折行点的入口（src/session/views/lines.js 的槽位）。
setLineMeasurer(measureLines);
