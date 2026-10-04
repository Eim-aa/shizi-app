// 阶段 1 P1-E6（D29，覆盖 X08 与 03 P59；03 P130 / P131）：字号跟随系统 Dynamic Type 的版式回归。
//
// 原生桥用页面里直接调用 window.shiziContentSize({category}) 模拟（与 Swift 在 pageReady / 系统字号变化时的调用同形）。
// 档位：L（系统默认，--k 1）、XXXL（--k 1.35，:root[data-text-large] 紧凑排布）、AX3（--k 2，data-ax="3"）、AX5（--k 2.4，data-ax="5"）。
// 视口：393×852（主力机）与 320×568（最窄的屏）。页面：首页、写字（回忆）、判断、结果、设置——长文本 fixture（与 60-matrix 同一份，
// 题面最长的卡、结果页说明句最长的那一态），同一页面内逐档切换（不重载，模拟用户在控制中心改字号后回到 App）。
// 每档断言：
//   1. 条件生效：--k、data-ax、data-text-large 与档位一致（policy.contentSizeScale，P130；compactTextScale，P131）。
//   2. 无横向溢出：documentElement 与顶层图层里每个滚动容器 scrollWidth ≤ clientWidth；每段文字（Range 矩形）不越出 0–视口宽。
//   3. 关键按钮在视口内：滚到它（允许纵向滚动，AX 档内容本来就比一屏长）后整块在可见区内、不被底栏 / tab 条盖住（elementFromPoint），
//      且触控区 ≥ 44×44pt（R-G09 / --tap）；tab 根页的三个 tab 也一样。
//   4. 书写格边长不随字号变化（阶段 0 卡 D / D36 / P118 的口径）：写字页同一视口各档的格子边长都等于 L 档的边长。
//   5. （E9a，D49）字阶按档取值：xS–XXXL 仍是 Npx × --k（连续）；AX1–AX5 不再乘 --k，每一级各取设计表内的值（像系统 Text Style）——
//      读首页「日期（t13）/ 标题（t28）/ 主按钮（t17）」与 :root 上的 --fs / --btn-h 的计算值，AX3 / AX5 与设计表逐值相等，层级不倒置。
//      旧断言只测「--k 的值」，AX 档的字阶在旧实现里是 k 的倍数（AX5 的 t28 = 67.2、t13 = 31.2），本条在旧实现下为红。
// 完整 AX 版式等设计稿（ui/components/ax.js 只放防溢出的过渡规则）；真机矩阵见 DEVICE_QA Q24。

import { longTextCatalog, seedLongText } from './fixtures/long-text.mjs';

const TOP = '.sz-layer[data-top="true"]';
// type = [t13, t28, t17, 按钮高] 的计算值（px）；xS–XXXL = Npx × k，AX = 设计表内的值（D49：减法修稿 §5-1，t13 / t28 / t17 / max(54, lh17 + 26)）
const SIZES = [
  { category: 'L', k: '1', ax: null, large: false, type: [13, 28, 17, 54] },
  { category: 'XXXL', k: '1.35', ax: null, large: true, type: [17.55, 37.8, 22.95, 54] },
  { category: 'AX3', k: '2', ax: '3', large: true, type: [33, 48, 40, 74] },
  { category: 'AX5', k: '2.4', ax: '5', large: true, type: [44, 58, 53, 88] },
];
const VIEWS = [{ width: 393, height: 852 }, { width: 320, height: 568 }];
const TABS = ['tab-home', 'tab-library', 'tab-mine'];

async function waitTopScreen(page, name) {
  await page.waitForFunction(n => {
    const app = document.querySelector('.sz-app');
    return !!app && app.dataset.topScreen === n && app.dataset.navAnim === 'idle';
  }, name, { timeout: 15000 });
  await page.waitForTimeout(150);
}

async function push(page, name, params = {}) {
  await page.evaluate(async ({ n, p }) => {
    const { nav } = await import('/src/ui/router.js');
    nav.push(n, p);
  }, { n: name, p: params });
  await waitTopScreen(page, name);
}

const PAGES = [
  { id: 'home', go: () => null, primary: ['home-start', 'home-pick'], tabs: true },
  {
    id: 'write', go: page => push(page, 'write', { slot: 'A' }), ready: `${TOP} [data-testid="write-hint"][data-state]`,
    primary: ['page-back', 'write-hint', 'write-done', 'write-show-answer', 'write-skip'],
    // AX 档（R2-X1，P225）：底栏只有「写好了」+「⋯」（提示 / 看答案 / 跳过在菜单里），撤销 / 清空在页头
    primaryAx: ['page-back', 'write-done', 'write-more', 'write-undo', 'write-clear'], grid: true,
  },
  {
    id: 'judge', phase: 'compare', go: page => push(page, 'write', { slot: 'A' }), ready: `${TOP} .sz-write[data-phase="compare"]`,
    primary: ['write-continue', 'write-judge-correct', 'write-judge-wrong'],
  },
  { id: 'result', go: (page, info) => push(page, 'result', { slot: 'B', sessionId: info.resultSessionId }), primary: ['result-leave'] },
  {
    id: 'settings', go: page => push(page, 'settings'),
    primary: ['page-back', 'settings-library', 'settings-sound', 'settings-remind', 'settings-appearance', 'settings-backup'],
  },
];

/* eslint-disable no-undef */
function measure({ primary, tabs }) {
  const root = document.documentElement;
  const vw = root.clientWidth;
  const vh = window.innerHeight;
  const problems = [];
  const env = {
    k: getComputedStyle(root).getPropertyValue('--k').trim(),
    ax: root.getAttribute('data-ax'),
    large: root.hasAttribute('data-text-large'),
  };
  const probe = document.createElement('div'); // var() 在 getPropertyValue 里不展开：用探针元素读计算值
  document.body.appendChild(probe);
  const px = (prop, name) => {
    probe.style.cssText = `position:absolute;visibility:hidden;${prop}:var(${name})`;
    return parseFloat(getComputedStyle(probe)[prop === 'height' ? 'height' : 'fontSize']);
  };
  env.type = [px('font-size', '--fs13'), px('font-size', '--fs28'), px('font-size', '--fs17'), px('height', '--btn-h')].map(v => Math.round(v * 100) / 100);
  probe.remove();
  const top = document.querySelector('.sz-layer[data-top="true"]');
  if (!top) return { env, problems: ['no top layer'] };
  if (root.scrollWidth > vw + 0.5) problems.push(`document scrollWidth ${root.scrollWidth} > ${vw}`);
  const scope = [top, document.querySelector('.sz-tabs')].filter(Boolean);
  for (const s of scope) {
    for (const el of [s, ...s.querySelectorAll('*')]) {
      if (!el.checkVisibility()) continue;
      const cs = getComputedStyle(el);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        if (el.closest('[aria-hidden="true"]') || el.tagName === 'CANVAS') continue;
        if (el.classList.contains('sz-page__title--hidden')) continue; // 页头标题只留给读屏（视觉隐藏的 1×1 盒子，D49 写字页回忆阶段 / 结果页）
        problems.push(`horizontal overflow in ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${el.scrollWidth} > ${el.clientWidth})`);
      }
    }
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const host = n.parentElement;
      if (!host || !host.checkVisibility({ visibilityProperty: true }) || host.closest('.sr-only, [hidden], .sz-page__title--hidden')) continue; // 视觉隐藏的读屏标题（D49）不算可见文字
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        if (r.left < -1 || r.right > vw + 1) {
          problems.push(`text「${n.textContent.trim().slice(0, 12)}」 outside 0–${vw} (${Math.round(r.left)}–${Math.round(r.right)})`);
          break;
        }
      }
    }
  }
  const hits = (el, x, y) => {
    const h = document.elementFromPoint(x, y);
    return !!h && (h === el || el.contains(h));
  };
  const check = (el, name) => {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    // H1：文字按钮的点击区宽度由 ::after 补到 ≥ 44（盒子本身只有字宽 + 内边距），所以宽度按「中心左右各 21.5 处仍命中它」算
    const wideEnough = r.width >= 44 - 0.5 || [-21.5, 21.5].every(dx => hits(el, r.left + r.width / 2 + dx, r.top + r.height / 2));
    if (!wideEnough || r.height < 44 - 0.5) problems.push(`${name} touch target ${Math.round(r.width)}×${Math.round(r.height)} < 44`);
    if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) {
      problems.push(`${name} outside the viewport ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))}`);
      return;
    }
    const inset = Math.min(4, r.width / 4, r.height / 4);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pts = [[cx, cy], [cx, r.top + inset], [cx, r.bottom - inset], [r.left + inset, cy], [r.right - inset, cy]];
    const bad = pts.find(([x, y]) => !hits(el, x, y));
    if (bad) {
      const h = document.elementFromPoint(bad[0], bad[1]);
      problems.push(`${name} covered at (${Math.round(bad[0])},${Math.round(bad[1])}) by ${h ? `${h.tagName.toLowerCase()}.${String(h.className).slice(0, 30)}` : 'nothing'}`);
    }
  };
  for (const id of primary) {
    const el = [...top.querySelectorAll(`[data-testid="${id}"]`)].find(e => e.checkVisibility({ visibilityProperty: true }));
    if (!el) problems.push(`${id} missing`);
    else check(el, id);
  }
  if (tabs) {
    for (const id of ['tab-home', 'tab-library', 'tab-mine']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) problems.push(`${id} missing`);
      else check(el, id);
    }
  }
  for (const el of top.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0;
  const grid = top.querySelector('[data-testid="write-grid"]');
  const g = grid ? grid.getBoundingClientRect() : null;
  return { env, problems, grid: g ? { w: g.width, h: g.height } : null };
}
/* eslint-enable no-undef */

export default async function textSize(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await page.goto(`${baseURL}/?test=1`);
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  const catalog = await longTextCatalog(page);
  assert.equal(TABS.length, 3);

  for (const view of VIEWS) {
    await page.setViewportSize(view);
    for (const p of PAGES) {
      const tag = `${view.width}×${view.height} ${p.id}`;
      step(`${tag}: system text L / XXXL / AX3 / AX5 — no horizontal overflow, key buttons reachable and ≥44pt${p.grid ? ', grid edge unchanged' : ''}`);
      await page.goto('about:blank');
      await page.goto(`${baseURL}/?test=1`);
      await page.waitForSelector('.sz-app');
      await page.waitForFunction(() => typeof window.__shiziTest === 'object');
      await waitTopScreen(page, 'home');
      const info = await seedLongText(page, catalog, { phase: p.phase || 'recall' });
      assert.ok(info.ok, `${tag}: long-text fixture seeded`);
      await p.go(page, info);
      if (p.ready) await page.waitForSelector(p.ready, { timeout: 15000 });
      await page.mouse.move(1, 1);
      let gridL = null;
      for (const size of SIZES) {
        await page.evaluate(c => window.shiziContentSize({ category: c }), size.category);
        await page.waitForFunction(c => document.documentElement.getAttribute('data-text-size') === c, size.category);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.waitForTimeout(120);
        if (process.env.SHIZI_E2E_SHOTS) {
          await page.screenshot({ path: `${process.env.SHIZI_E2E_SHOTS}/p1e6-${view.width}x${view.height}-${p.id}-${size.category}.png` });
        }
        const m = await page.evaluate(measure, { primary: size.ax && p.primaryAx ? p.primaryAx : p.primary, tabs: !!p.tabs });
        const t = `${tag} ${size.category}`;
        assert.deepEqual({ ...m.env, type: undefined }, { k: size.k, ax: size.ax, large: size.large, type: undefined }, `${t}: --k ${size.k}, data-ax ${size.ax}, data-text-large ${size.large}`);
        assert.deepEqual(m.env.type, size.type, `${t}: --fs13 / --fs28 / --fs17 / --btn-h = ${size.type.join(' / ')} (D49: AX tiers are absolute, xS–XXXL = N × k)`);
        assert.deepEqual(m.problems, [], `${t}: no horizontal overflow; key buttons inside the viewport, uncovered, ≥44pt`);
        if (p.grid && size.ax) {
          // AX 档：按实际可用高度排版，下限 220（P225）；320×568 这类很矮的屏取下限
          assert.ok(m.grid && m.grid.w >= 220 - 0.5 && Math.abs(m.grid.w - m.grid.h) < 1, `${t}: square grid ≥ 220 (${m.grid && m.grid.w}) — the AX floor (P225)`);
        } else if (p.grid) {
          assert.ok(m.grid && m.grid.w >= 258 - 0.5 && Math.abs(m.grid.w - m.grid.h) < 1, `${t}: square grid ≥ 258 (${m.grid && m.grid.w})`);
          if (size.category === 'L') gridL = m.grid.w;
          else assert.ok(Math.abs(m.grid.w - gridL) < 0.5, `${t}: grid edge ${m.grid.w} = the L edge ${gridL} (xS–XXXL: text size does not change the grid, D36 / P118)`);
        }
      }
      await page.evaluate(() => window.shiziContentSize({ category: 'L' }));
    }
  }
}
