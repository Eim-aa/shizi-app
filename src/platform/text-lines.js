// 平台层：网页的折行点（原生要跟网页折在同一处）。
//
// 网页的段落是 text-wrap: pretty（src/config/base.css 的 p{text-wrap:pretty}；说明多的页面还各自写了一遍）：
// WebKit 的 pretty 不是贪心折行——它会为「末行不要太短」把字往上一行挪。原生排版是贪心折行，
// 同一句话两边断行的地方不一样，文字框的宽就差几 pt（逐屏对比会报「文字尺寸」差异）。
//
// 这里量出网页的折行点：在页面里用同一组 CSS 类排一份看不见的副本（宽度照网页的宽），
// 量出每一行从第几个字开始，原生按这些位置断行（与结果页 src/ui/screens/result/native-view.js 的 webLineStarts 同一做法）。
//
// 分层：会话层（src/session/**）不导入 UI 层。页面层（src/ui/screens/**）在模块里登记量法（registerTextLines），
// 会话层通过本模块的登记表取折行点（textLineStarts）——登记是页面加载时做的事，会话层只读。
// 没有 DOM（node:test）或量不到时返回 null：原生按自己的宽度折行（与结果页同一兜底）。

/** 量法登记表：键 → 量法（fn(text, extra) → 每行从第几个字开始；null = 量不到）。 */
const registry = new Map();

/**
 * 登记一个折行点的量法（页面层调用；同键后登记的覆盖先登记的）。
 * @param {string} key 折行点的键（如 'backup.intro'）
 * @param {(text: string, extra?: any) => number[]|null} fn
 * @returns {() => void} 取消登记
 */
export function registerTextLines(key, fn) {
  registry.set(key, fn);
  return () => {
    if (registry.get(key) === fn) registry.delete(key);
  };
}

/**
 * 取折行点（会话层调用）：text = 要显示的句子；extra = 量法要的其他上下文（如同一行里的别的字）。
 * @returns {number[]|null} 每一行从第几个字开始（按 Array.from 的字计）；null = 量不到
 */
export function textLineStarts(key, text, extra) {
  if (typeof text !== 'string' || !text) return null;
  const fn = registry.get(key);
  if (typeof fn !== 'function') return null;
  try {
    const r = fn(text, extra);
    if (!Array.isArray(r)) return null;
    return r.filter(n => Number.isInteger(n) && n > 0 && n < Array.from(text).length);
  } catch (error) {
    return null;
  }
}

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
