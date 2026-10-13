// 交互合规 e2e 的共用部分（交互与动效规范 §8b，D58 ⑥；03 P294）。不是 spec：run.mjs 只加载 *.spec.js。
// 102-interaction-compliance*.spec.js 分几份跑（每份 90s 上限），共用这里的页面目录、进入方式、读状态与跳过打印。
//
// 页面目录 CATALOG：每个 registerScreen 注册的页面一行（IC-00 断言注册表里的每个页面都在这里，新页面不登记就红）。
// 开发页（测试宿主 / ?dev=1 才注册）在 DEV_SCREENS 里写明理由，不进遍历。
import { longTextCatalog, seedLongText } from './fixtures/long-text.mjs';
import { pendingFor, logPending } from './interaction-pending.mjs';

export const TOP = '.sz-layer[data-top="true"]';
export const PRESS_MS = 450; // 新页面 / 新状态后 0.4s 按钮不响应（01 §6.6）

/** 开发 / 演示页：不是产品页面，不进交互合规遍历（理由写在这里）。 */
export const DEV_SCREENS = Object.freeze({
  '_demo/sub': '测试宿主（?test=1）的路由演示子页，不在产品里',
  'glyph-demo': '开发页（?dev=1）的字形演示',
  'query-demo': '开发页（?dev=1）的查字演示',
});

/** 页面目录：name、是否 Tab 根、进入方式（info = seedLongText 的结果）。 */
export const CATALOG = Object.freeze([
  { name: 'home', tab: true },
  { name: 'library', tab: true },
  { name: 'mine', tab: true },
  { name: 'write', params: () => ({ slot: 'A' }), ready: `${TOP} .sz-write[data-phase]` },
  { name: 'result', params: info => ({ slot: 'B', sessionId: info.resultSessionId }) },
  { name: 'library-list', params: () => ({ kind: 'wrong' }) },
  { name: 'library-all', ready: `${TOP} [data-testid="all-cell"]` },
  { name: 'library-switch' },
  { name: 'detail', params: info => ({ char: info.detailChar }) },
  { name: 'detail-photo', params: info => ({ char: info.detailChar }) },
  { name: 'session-none', params: () => ({ exhausted: false }) },
  { name: 'records' },
  { name: 'month', ready: `${TOP} [data-testid="month-cell"]` },
  { name: 'remind' },
  { name: 'backup' },
  { name: 'annual' },
  { name: 'about' },
  { name: 'about-privacy' },
  { name: 'about-credits' },
  { name: 'about-letter' },
]);

/** 跳过并打印（pending 条目命中时返回 true，调用方 return）。 */
export function skipIfPending(ic, where, detail = '') {
  const hits = pendingFor(ic, where);
  if (!hits.length) return false;
  logPending(m => console.log(`    ${m}`), ic, hits, detail);
  return true;
}

export async function boot(page, baseURL) {
  await page.goto('about:blank');
  await page.goto(`${baseURL}/?test=1`);
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitIdle(page, 'home');
}

/** 种一份「什么都有」的状态（长文本 fixture：一年量级记录、写错过、B 槽提前结束的组…）。 */
export async function seedRich(page) {
  const catalog = await longTextCatalog(page);
  const info = await seedLongText(page, catalog, { phase: 'recall' });
  if (!info.ok) throw new Error(`seed failed ${JSON.stringify(info.r)}`);
  return info;
}

export async function waitIdle(page, name, settle = 120) {
  await page.waitForFunction(n => {
    const app = document.querySelector('.sz-app');
    return !!app && (!n || app.dataset.topScreen === n) && app.dataset.navAnim === 'idle';
  }, name || null, { timeout: 15000 });
  if (settle) await page.waitForTimeout(settle);
}

export async function toRoot(page, tab = 'home') {
  await page.evaluate(async t => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(t);
  }, tab);
  await waitIdle(page, tab);
}

/** 进入目录里的一页（先回到首页根）。 */
export async function enter(page, entry, info) {
  if (entry.tab) {
    await toRoot(page, entry.name);
    return;
  }
  await toRoot(page);
  await page.evaluate(async ([n, p]) => {
    const { nav } = await import('/src/ui/router.js');
    nav.push(n, p);
  }, [entry.name, entry.params ? entry.params(info) : {}]);
  await waitIdle(page, entry.name);
  if (entry.ready) await page.waitForSelector(entry.ready, { timeout: 15000 });
}

/** 比较用的状态：页面栈（名字序列）、顶层、深度、写字页阶段与 store（去掉时间戳）。 */
export async function snapshot(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    const strip = v => {
      if (Array.isArray(v)) return v.map(strip);
      if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v).sort()) if (!/(At|Ms|Day|serial)$/.test(k)) o[k] = strip(v[k]);
        return o;
      }
      return v;
    };
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return {
      stack: s.stack.map(e => `${e.k}:${e.n}`).join(' > '),
      depth: s.depth,
      top: s.top ? s.top.n : null,
      phase: top ? top.dataset.phase : null,
      store: JSON.stringify(strip(window.__shiziTest.getState())),
    };
  });
}

/** 原生左缘手势进度（与 Swift / 网页兜底同一形状）。 */
export async function swipeBack(page, { to = 0.5, velocity = 0, phases = ['began', 'changed', 'ended'] } = {}) {
  await page.evaluate(async ({ to: p, v, ph }) => {
    const w = window.innerWidth;
    const fire = (phase, x, vx = 0) => window.dispatchEvent(new CustomEvent('shizi-native-back-progress', {
      detail: { phase, translationX: x, progress: x / w, velocityX: vx },
    }));
    if (ph.includes('began')) fire('began', 0);
    if (ph.includes('changed')) {
      for (let i = 1; i <= 4; i += 1) {
        fire('changed', (w * p * i) / 4);
        await new Promise(r => requestAnimationFrame(r));
      }
    }
    if (ph.includes('ended')) fire('ended', w * p, v);
  }, { to, v: velocity, ph: phases });
}

/** 顶层页面的返回动作（ui/back-action.js 登记的函数）是不是函数。 */
export async function backActionIsFunction(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const { getBackAction } = await import('/src/ui/back-action.js');
    const top = getRouter().getState().top;
    return typeof getBackAction(top ? top.id : null) === 'function';
  });
}

/** 已注册的页面名（router.listScreens）。 */
export async function registeredScreens(page) {
  return page.evaluate(async () => {
    const { listScreens } = await import('/src/ui/router.js');
    return listScreens();
  });
}

/** 顶层图层的几何 / 可点 / 主按钮等事实（IC-01 / 09 / 10 / 20）。在页面里跑。 */
export function pageFacts() {
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (let p = el; p && p !== top; p = p.parentElement) if (Number(getComputedStyle(p).opacity) === 0 || p.inert) return false;
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  };
  const back = top.querySelector('.sz-page__head [data-testid="page-back"], .sz-page__head [data-testid="write-continue"]');
  const br = back ? back.getBoundingClientRect() : null;
  // 命中区：从中心向四个方向 21px 采样，elementFromPoint 落在控件自己（或它的后代、::after）上就算这一点可点
  const hitOk = el => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pts = [[cx, cy], [cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]];
    const bars = [...document.querySelectorAll('[role="tablist"], .sz-layer[data-top="true"] .sz-page__foot, .sz-layer[data-top="true"] .sz-page__head')]
      .filter(b => !b.contains(el));
    return pts.every(([x, y]) => {
      if (x < 0 || y < 0 || x >= vw || y >= vh) return true; // 出了视口的那一侧不算（贴边控件）
      const hit = document.elementFromPoint(x, y);
      if (hit && bars.some(b => b.contains(hit))) return true; // 被固定的页头 / 底栏 / Tab 栏盖住的部分是滚动位置的问题，不是热区不足
      return !!hit && (hit === el || el.contains(hit));
    });
  };
  const controls = [...top.querySelectorAll('button, [role="button"], a[href], [role="switch"], [role="tab"]')]
    .filter(el => visible(el) && !el.disabled && !el.closest('.sz-exit') && !el.closest('[aria-hidden="true"]')
      && !/^(demo-|write-test-entry)/.test(el.getAttribute('data-testid') || '')); // 测试宿主的开发入口不是产品控件
  const small = controls.filter(el => !hitOk(el)).map(el => el.getAttribute('data-testid') || el.className || el.tagName);
  const iconNoName = [...top.querySelectorAll('.sz-btn--icon')].filter(visible).filter(el => !(el.getAttribute('aria-label') || '').trim())
    .map(el => el.getAttribute('data-testid') || el.className);
  const primaries = [...top.querySelectorAll('.sz-btn--primary')].filter(visible);
  const lastPrimary = primaries[primaries.length - 1];
  const tabbar = document.querySelector('[role="tablist"]');
  const active = document.activeElement;
  return {
    back: back ? {
      testid: back.getAttribute('data-testid'), cls: back.className, label: back.getAttribute('aria-label'),
      w: br.width, h: br.height, x: br.left, inView: br.top >= 0 && br.left >= 0 && br.bottom <= vh && br.right <= vw, hit: hitOk(back),
    } : null,
    small,
    iconNoName,
    primaries: primaries.map(el => el.getAttribute('data-testid')),
    primaryBottomGap: lastPrimary ? Math.round(vh - lastPrimary.getBoundingClientRect().bottom) : null,
    tabTop: tabbar ? Math.round(tabbar.getBoundingClientRect().top) : null,
    primaryBottom: lastPrimary ? Math.round(lastPrimary.getBoundingClientRect().bottom) : null,
    focusIsTitle: !!(active && active.matches && active.matches('[data-page-title]') && top.contains(active)),
    hOverflow: document.documentElement.scrollWidth > vw + 1,
  };
}

export { longTextCatalog, seedLongText };
