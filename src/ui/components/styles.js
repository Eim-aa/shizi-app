// 组件样式注入：每个组件模块在加载时把自己的 CSS 逐条 insertRule 进同源样式表 src/config/base.css 的末尾（CSSOM）。
// M6-1 CSP 收紧后 style-src 只有 'self'：<style> 元素与 style="" 属性都会被拦，CSSOM（insertRule、el.style.x、
// style.cssText）不受 CSP 约束（CSP3 §6.1.3 只管 <style>/<link>/style 属性）。插在 base.css 末尾 = 原先「追加 <style> 到 head」
// 在层叠里的位置（其后只有 fonts.css 的 @font-face）。浏览器不认的单条规则丢弃（与样式表解析时丢弃无效规则一致）。
// 颜色、字号、圆角、线宽一律引用 src/config/tokens.css 的令牌（P1-E1a，D43）；下方 T 是令牌名的 var() 引用，不带回退值。
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

// 令牌引用（取值在 src/config/tokens.css，唯一来源 docs/design/design-system-v1/tokens.json，D43）。组件样式只写 ${T.xxx} 或 var(--xxx)，
// 不写颜色 / 字号 / 圆角字面量（scripts/verify_tokens.mjs 检查）；var() 不带回退值，令牌文件一定先于组件样式加载。
const v = name => `var(--${name})`;
export const T = {
  // 颜色（浅 / 深两套在 tokens.css）
  paper: v('paper'), sheet: v('sheet'), field: v('field'), elev: v('elev'), line: v('line'), frame: v('frame'), guide: v('guide'),
  ink1: v('ink1'), ink2: v('ink2'), ink3: v('ink3'), ink4: v('ink4'),
  hand: v('hand'), ref: v('ref'), under: v('under'),
  zhu: v('zhu'), seal: v('seal'), onSeal: v('on-seal'), danzhu: v('danzhu'),
  wall1: v('wall1'), wall2: v('wall2'), wall3: v('wall3'), wall4: v('wall4'),
  btnBg: v('btn-bg'), btnFg: v('btn-fg'), btnDown: v('btn-down'), toastBg: v('toast-bg'), toastFg: v('toast-fg'),
  scrim: v('scrim'), elevShadow: v('elev-shadow'),
  // 字阶：七级，已乘 --k
  k: v('k'),
  fs11: v('fs11'), fs13: v('fs13'), fs15: v('fs15'), fs17: v('fs17'), fs22: v('fs22'), fs28: v('fs28'), fs34: v('fs34'),
  lh11: v('lh11'), lh13: v('lh13'), lh15: v('lh15'), lh17: v('lh17'), lh17s: v('lh17s'), lh22: v('lh22'), lh28: v('lh28'), lh34: v('lh34'),
  // 字体栈
  kai: v('kai'), song: v('song'), hei: v('hei'),
  // 圆角三档、线、触控、动效
  rWork: v('r-work'), rCtl: v('r-ctl'), rBox: v('r-box'),
  hair: v('hair'), frameW: v('frame-w'), guideW: v('guide-w'), targetW: v('target-w'),
  hit: v('hit'), btnH: v('btn-h'),
  pressScale: v('press-scale'), tPress: v('t-press'), tRelease: v('t-release'), easeOut: v('ease-out'),
  // 过渡别名（P1-E1a 第一步；全局替换提交里删除）
  p: v('paper'), c: v('sheet'), sh: v('elev'), off: v('field'),
  i1: v('ink1'), i2: v('ink2'), i3: v('ink3'), i4: v('ink4'), i5: v('line'),
  a: v('btn-bg'), ar: v('zhu'), serif: v('song'), sans: v('hei'),
};

/** 笺面纸纹（只给书写格、对照卡、字帖、月帖、图片等笺面；按钮、弹层、列表、页面底不用）：笺色 + --tex-img。 */
export const TEX = `background-color:${T.sheet};background-image:var(--tex-img);background-size:var(--tex-size)`;
