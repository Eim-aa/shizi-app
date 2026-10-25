// 会话层：网页量出的折行点（原生要跟网页折在同一处）的登记表。
//
// 网页的段落是 text-wrap: pretty（src/config/base.css 的 p{text-wrap:pretty}），WebKit 的折法不是贪心折行——
// 末行太短时它会把字往上一行挪。原生排版是贪心折行，同一句话两边断行的地方不一样，文字框的宽就差几 pt
// （逐屏对比报「文字尺寸」差异）。所以断行点得由网页量出来给原生。
//
// 量法要 DOM，在页面层（src/ui/text-lines.js）：页面模块加载时把量法登记进来，会话层只读登记表——
// 会话层不导入 UI / DOM 模块（test/session/boundary.test.mjs 的边界门禁）。没有 DOM（node:test）或没登记时
// 取不到折行点：原生按自己的宽度折行（与结果页同一兜底）。

/** 量法登记表：键 → 量法（fn(text, extra) → 每一行从第几个字开始；null = 量不到）。 */
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
    const n = Array.from(text).length;
    return r.filter(i => Number.isInteger(i) && i > 0 && i < n);
  } catch (error) {
    return null;
  }
}
