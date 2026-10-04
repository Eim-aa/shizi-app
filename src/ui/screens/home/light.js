// 首页光影层（装饰，不作令牌，颜色字面量在 scripts/verify_tokens.mjs 登记为例外，P143；原型首页壳-v3 L144–L152 BRANCHES、L196–L210 lightLayer()、L174 时段切换 600ms 淡入）。
//
// - 早上 / 中午 / 傍晚：浅色有底光 radial + 两枝叶影 + 顶部日光；中午枝叶右移 126、模糊 +3、强度 ×.7；傍晚整层 scaleX(-1)、
//   色调 120,86,52。深色不画底光与日光，叶影改黑 .30、模糊 12。
// - 晚上：浅色只留右上灯光 radial（.08）；深色什么都不画（深色暖灯已随 D43 取消：--lamp / --paper-image 删除，P58；本层的去留见 P143，E1b 评估）。
// - 时段变化（不是首次渲染）时整层 opacity 0→1，时长取 base.css --motion-light（600ms；减少动态效果时 0ms = 直接切）。
//   原型只在 props.period 变化时动画、auto 模式下永不触发（K 报告 §5-3）；这里由首页的时钟（回前台 / 定时重算）驱动。
//
// 几何沿原型 393 宽画布的绝对坐标（左上角起画，中午整体右移；傍晚镜像以层中心为轴）；层宽跟随页面。
// data-testid：home-light（data-period / data-dark）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { T } from '../../components/styles.js';

// 叶影（早上为基准；坐标沿用交接版）。a 不透明度，b 模糊，c 颜色。原型 L145–L151 逐字。
export const BRANCHES = Object.freeze([
  {
    x: -52, y: -26, w: 246, h: 26, rot: 26, twig: { y: 11, a: 0.10, b: 7 }, c: '88,97,70', leaves: [
      { l: 26, t: -16, w: 58, h: 21, r: '50% 12% 50% 12%', rot: -39, a: 0.16, b: 6 },
      { l: 62, t: 14, w: 54, h: 19, r: '12% 50% 12% 50%', rot: 35, a: 0.16, b: 6 },
      { l: 100, t: -16, w: 56, h: 20, r: '50% 12% 50% 12%', rot: -43, a: 0.16, b: 6 },
      { l: 140, t: 13, w: 48, h: 17, r: '12% 50% 12% 50%', rot: 30, a: 0.085, b: 13 },
    ],
  },
  {
    x: -74, y: 96, w: 250, h: 30, rot: 14, twig: { y: 13, a: 0.07, b: 10 }, c: '92,100,74', leaves: [
      { l: 36, t: -17, w: 62, h: 23, r: '50% 12% 50% 12%', rot: -36, a: 0.08, b: 15 },
      { l: 84, t: 15, w: 58, h: 22, r: '12% 50% 12% 50%', rot: 33, a: 0.07, b: 16 },
      { l: 134, t: -16, w: 56, h: 21, r: '50% 12% 50% 12%', rot: -40, a: 0.065, b: 15 },
    ],
  },
]);

/** 光影层高度（原型：白天只画顶部 330，晚上整屏）。 */
export const LIGHT_HEIGHT = 330;
const DUSK_RGB = '120,86,52';
const DAWN_RGB = '103,110,84';
const TWIG_RGB = '88,97,70';

/** 深色？data-theme 强制优先，否则跟随系统（与 tokens.css 同一规则）。 */
export function isDarkTheme(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.document) return false;
  const th = win.document.documentElement.getAttribute('data-theme');
  if (th === 'dark') return true;
  if (th === 'light') return false;
  try {
    return !!(win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (error) {
    return false;
  }
}

/** 订阅深浅色（matchMedia change 与 data-theme 属性）。 */
export function useDarkTheme() {
  const [dark, setDark] = useState(() => isDarkTheme());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => setDark(isDarkTheme());
    sync();
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    } catch (error) {
      mq = null;
    }
    if (mq && mq.addEventListener) mq.addEventListener('change', sync);
    let mo = null;
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(sync);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => {
      if (mq && mq.removeEventListener) mq.removeEventListener('change', sync);
      if (mo) mo.disconnect();
    };
  }, []);
  return dark;
}

/** base.css --motion-light（ms）；减少动态效果为 0；读不到时按 matchMedia 取 600 / 0。 */
export function lightFadeMs(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return 0;
  let reduce = false;
  try {
    reduce = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    reduce = false;
  }
  if (reduce) return 0;
  let raw = '';
  try {
    raw = win.getComputedStyle(win.document.documentElement).getPropertyValue('--motion-light').trim();
  } catch (error) {
    raw = '';
  }
  const m = /^([\d.]+)\s*(ms|s)?$/.exec(raw);
  if (!m) return 600; // 原型 L174 duration:600
  const v = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  return Number.isFinite(v) ? v : 600;
}

function branchNodes(period, dark) {
  const noon = period === 'noon';
  const dusk = period === 'dusk';
  const k = noon ? 0.7 : 1;
  const db = noon ? 3 : 0;
  return BRANCHES.map((b, bi) => {
    const col = a => (dark ? 'rgba(0,0,0,.30)' : `rgba(${dusk ? DUSK_RGB : b.c},${dusk ? 0.10 : a * k})`);
    const blur = x => (dark ? 12 : x + db);
    const twigBg = dark ? 'rgba(0,0,0,.30)' : `rgba(${dusk ? DUSK_RGB : TWIG_RGB},${b.twig.a * k})`;
    return html`<div key=${`b${bi}`} class="sz-light__branch" style=${{
      left: `${b.x + (noon ? 126 : 0)}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, transform: `rotate(${b.rot}deg)`,
    }}>
      <div class="sz-light__twig" style=${{ top: `${b.twig.y}px`, width: `${b.w}px`, background: twigBg, filter: `blur(${blur(b.twig.b)}px)` }}></div>
      ${b.leaves.map((f, i) => html`<div key=${i} class="sz-light__leaf" style=${{
        left: `${f.l}px`, top: `${f.t}px`, width: `${f.w}px`, height: `${f.h}px`, borderRadius: f.r, transform: `rotate(${f.rot}deg)`,
        background: col(f.a), filter: `blur(${blur(f.b)}px)`,
      }}></div>`)}
    </div>`;
  });
}

/** 光影层的子节点（原型 lightLayer(per, dark)）。 */
function layerChildren(period, dark) {
  if (period === 'night') {
    return dark ? [] : [html`<div key="lamp" class="sz-light__fill" data-part="lamp"
      style=${{ background: 'radial-gradient(275px 383px at calc(100% - 47px) -43px,rgba(255,196,130,.08),transparent 70%)' }}></div>`];
  }
  const noon = period === 'noon';
  const dusk = period === 'dusk';
  const k = noon ? 0.7 : 1;
  const rgb = dusk ? DUSK_RGB : DAWN_RGB;
  const kids = [];
  if (!dark) {
    kids.push(html`<div key="base" class="sz-light__fill" data-part="base" style=${{
      background: `radial-gradient(130% 90% at ${noon ? '50%' : '-10%'} -20%,rgba(${rgb},${0.085 * k}),rgba(${rgb},${0.03 * k}) 42%,transparent 70%)`,
    }}></div>`);
  }
  kids.push(...branchNodes(period, dark));
  if (!dark) {
    kids.push(html`<div key="sun" class="sz-light__fill" data-part="sun"
      style=${{ background: 'linear-gradient(200deg,rgba(255,252,243,.42) 0%,rgba(255,252,243,0) 46%)' }}></div>`);
  }
  return kids;
}

/**
 * 光影层。period 变化（不含首次挂载）时淡入。
 * @param {{period:'dawn'|'noon'|'dusk'|'night'}} props
 */
export function LightLayer({ period }) {
  const dark = useDarkTheme();
  const ref = useRef(null);
  const prev = useRef(null);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = period;
    if (was === null || was === period) return;
    const el = ref.current;
    const ms = lightFadeMs();
    if (!el || !(ms > 0) || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' });
  }, [period]);
  const night = period === 'night';
  return html`<div class="sz-light" ref=${ref} aria-hidden="true" data-testid="home-light" data-period=${period}
    data-dark=${dark ? 'true' : 'false'}
    style=${{ height: night ? '100%' : `${LIGHT_HEIGHT}px`, transform: period === 'dusk' ? 'scaleX(-1)' : 'none' }}>
    ${layerChildren(period, dark)}
  </div>`;
}

export const LIGHT_CSS = `
.sz-light{position:absolute;left:0;top:0;right:0;overflow:hidden;pointer-events:none}
.sz-light__fill{position:absolute;inset:0}
.sz-light__branch{position:absolute;transform-origin:left center}
.sz-light__twig{position:absolute;left:0;height:3px;border-radius:${T.rWork}}
.sz-light__leaf{position:absolute}
`;
