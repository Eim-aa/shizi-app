// 组件样式注入：每个组件模块在加载时把自己的 CSS 放进一个 <style data-sz=…>（CSP style-src 允许 'unsafe-inline'）。
// 颜色、字号一律引用 src/config/tokens.css（M0-3）的令牌；var() 的回退值只为令牌文件未加载时不至于全透明，
// 取自原型 ShiziScreen TH.light（与 tokens.css 同源），不是新的设计值。
// 在 node:test 下（无 document）什么都不做。

const injected = new Set();

export function injectStyles(id, cssText) {
  if (injected.has(id)) return;
  injected.add(id);
  if (typeof document === 'undefined' || !document.head) return;
  const el = document.createElement('style');
  el.setAttribute('data-sz', id);
  el.textContent = cssText;
  document.head.appendChild(el);
}

// 常用回退（令牌名沿原型）。
export const T = {
  p: 'var(--p, #F4F0E7)',
  c: 'var(--c, #FBF8F2)',
  sh: 'var(--sh, #F7F3EB)',
  off: 'var(--off, #EFE8DC)',
  i1: 'var(--i1, #3B2F28)',
  i2: 'var(--i2, #5D5952)',
  i3: 'var(--i3, #6A645B)',
  i4: 'var(--i4, #B3AC9F)',
  i5: 'var(--i5, #DED8CD)',
  a: 'var(--a, #A6533F)',
  ar: 'var(--ar, #A6533F)',
  scrim: 'var(--scrim, rgba(60,42,28,.22))',
  k: 'var(--k, 1)',
  serif: "var(--serif, 'Noto Serif SC', serif)",
  sans: "var(--sans, -apple-system, 'PingFang SC', 'Hiragino Sans GB', sans-serif)",
};
