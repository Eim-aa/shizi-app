// 组件样式注入：每个组件模块在加载时把自己的 CSS 逐条 insertRule 进同源样式表 src/config/base.css 的末尾（CSSOM）。
// M6-1 CSP 收紧后 style-src 只有 'self'：<style> 元素与 style="" 属性都会被拦，CSSOM（insertRule、el.style.x、
// style.cssText）不受 CSP 约束（CSP3 §6.1.3 只管 <style>/<link>/style 属性）。插在 base.css 末尾 = 原先「追加 <style> 到 head」
// 在层叠里的位置（其后只有 fonts.css 的 @font-face）。浏览器不认的单条规则丢弃（与样式表解析时丢弃无效规则一致）。
// 颜色、字号一律引用 src/config/tokens.css（M0-3）的令牌；var() 的回退值只为令牌文件未加载时不至于全透明，
// 取自原型 ShiziScreen TH.light（与 tokens.css 同源），不是新的设计值。
// 在 node:test 下（无 document）什么都不做。

const injected = new Set();
const pending = [];
/** insertRule 拒收的规则（诊断用；e2e 断言 Chromium 下为空）。 */
export const droppedRules = [];
let hostSheet = null;
let waiting = false;

/** 按顶层花括号把一段 CSS 切成单条规则（跳过字符串与注释里的括号）；导出给单测。 */
export function splitRules(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const rule = css.slice(start, i + 1).trim();
        if (rule) out.push(rule);
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      const rule = css.slice(start, i + 1).trim();
      if (rule) out.push(rule);
      start = i + 1;
    }
  }
  return out;
}

function readable(sheet) {
  try {
    return !!sheet && !!sheet.cssRules;
  } catch (error) {
    return false; // 跨源样式表读不了 cssRules
  }
}

function findHostSheet() {
  if (hostSheet && hostSheet.ownerNode && hostSheet.ownerNode.isConnected && readable(hostSheet)) return hostSheet;
  hostSheet = null;
  const sheets = [...document.styleSheets];
  hostSheet = sheets.find(s => s.href && /\/src\/config\/base\.css(\?|$)/.test(s.href) && readable(s))
    || sheets.reverse().find(s => s.href && readable(s))
    || null;
  return hostSheet;
}

function flush() {
  const sheet = findHostSheet();
  if (!sheet) {
    // 样式表还没加载好（正常启动不会发生：模块脚本在阻塞脚本的样式表加载完后才执行）——等 load 再试。
    if (!waiting && typeof window !== 'undefined') {
      waiting = true;
      window.addEventListener('load', () => { waiting = false; flush(); }, { once: true });
    }
    return;
  }
  while (pending.length) {
    const rule = pending.shift();
    try {
      sheet.insertRule(rule, sheet.cssRules.length);
    } catch (error) {
      // 浏览器不认的规则：丢弃（样式表解析时同样丢弃）。
      droppedRules.push(rule.slice(0, 120));
    }
  }
}

export function injectStyles(id, cssText) {
  if (injected.has(id)) return;
  injected.add(id);
  if (typeof document === 'undefined' || !document.head) return;
  pending.push(...splitRules(cssText));
  flush();
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
