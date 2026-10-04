// 阶段 1 E9a（D49，减法修稿 §3.1 / §3.6、实现交接 §1 / §2.4）：首页与首次打开的减法版式。
//
// 五态（首次打开 / 今天还没写 / 今天写过 / 进行中 / 特别组 / 回来）× 浅深 ×（393×852 默认、SE 375×667）× 系统字号（L / AX5）：
//   1. 首页没有朱色：所有可见元素（含伪元素、边框、阴影）的颜色都不是 --zhu / --seal；首次打开只有一枚印（品牌）。
//   2. 题记一行：日期下 2、宋 13 墨三、不带印、不折行；标题在题记下 10；AX5 隐藏（display:none），读屏经标题的 describedby 读到（60-a11y 另测）。
//   3. 没有两处计数：页面上看不到「这一组还有 N 个字」「字库里有 N 个字了」「昨天写的字」，计数只在读屏名称里（72 / 22 逐态断言文字）。
//   4. 字帖格线只有两种：外框 frame（1px）+ 格间 guide（实线），空格里没有虚十字 svg、没有下一格墨框（::after）。
//   5. 同屏字号 3 级：L 档 13 / 17 / 28；AX5 档 44 / 53 / 58（按设计表各级取值，层级不倒置）；H1 起文字按钮统一 15（AX5 49），有文字按钮的态再加这一级。
//   6. 字帖块在标题与主按钮之间光学居中（区域底留 6% 内边，视觉略偏上）。
//   7. AX5：主按钮满宽、「自己选字」在下，整页可滚、按钮不固定；字帖格 ≥ 44。
//   8. 首次打开 AX5：题跋横排三行（一行一句、不折）、印跟在末句后间距 8、「拾」120、主按钮满宽、说明句在按钮下 4。
//   9. Tab 栏选中态（实心图标 + ink1、无小圆点）在 76-q2-11 测；这里只确认首页打开时习字 Tab 是选中的。
// 截图：设 SHIZI_E2E_SHOTS=<目录> 时每个组合存一张（浅深 × 402 / SE / AX5 的前后对照用）。

import { bootTestHost, setTextSize, waitNavIdle } from './helpers.mjs';
import { HOME_STATES, seedHomeState } from './home-helpers.mjs';

const VIEWS = [{ id: 'p393', width: 393, height: 852 }, { id: 'se', width: 375, height: 667 }];
const STATES = Object.keys(HOME_STATES);

/* eslint-disable no-undef */
function measure() {
  const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
  if (!root) return null;
  const q = id => root.querySelector(`[data-testid="${id}"]`);
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; };
  const probe = prop => {
    const el = document.createElement('span');
    el.style[prop === 'bg' ? 'backgroundColor' : 'color'] = `var(--${prop === 'bg' ? 'zhu' : prop})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el)[prop === 'bg' ? 'backgroundColor' : 'color'];
    el.remove();
    return c;
  };
  const colorOf = name => probe(name);
  const zhu = colorOf('zhu');
  const seal = colorOf('seal');
  const reds = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.checkVisibility()) continue;
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      const vals = [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor, cs.boxShadow, cs.fill, cs.stroke];
      if (vals.some(v => v && (v.includes(zhu) || v.includes(seal)))) reds.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 24)}${pseudo || ''}`);
    }
  }
  const sizes = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const host = n.parentElement;
    if (!host || !host.checkVisibility() || host.closest('.sz-htie, .sz-hshi, .sz-first, .sz-home__dev')) continue;
    sizes.add(Math.round(parseFloat(getComputedStyle(host).fontSize) * 100) / 100);
  }
  const date = q('home-date');
  const epi = q('home-epigraph');
  const title = q('home-title');
  const start = q('home-start');
  const pick = q('home-pick') || q('home-capital-defer');
  const zone = root.querySelector('.sz-home__zone');
  const block = q('home-zone');
  const tie = root.querySelector('.sz-htie');
  const cells = [...root.querySelectorAll('.sz-hcell')];
  const lineColors = new Set();
  if (tie) {
    for (const el of [tie, ...tie.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      for (const m of String(cs.boxShadow).matchAll(/rgba?\([^)]*\)/g)) lineColors.add(m[0]);
      if (el.tagName !== 'CANVAS' && el.tagName !== 'svg' && cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) lineColors.add(`border:${cs.borderTopColor}`);
    }
  }
  const token = name => { const p = document.createElement('span'); p.style.color = `var(--${name})`; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const panel = document.querySelector('.sz-tabroot__panel');
  const epiCs = epi ? getComputedStyle(epi) : null;
  const sealEl = root.querySelector('.sz-home__seal');
  return {
    view: root.dataset.view,
    width: root.clientWidth,
    reds,
    sizes: [...sizes].sort((a, b) => a - b),
    hasTextBtn: [...root.querySelectorAll('.sz-btn--text')].some(b => b.checkVisibility()),
    date: rect(date),
    epi: epi ? { ...rect(epi), display: epiCs.display, font: epiCs.fontFamily, weight: epiCs.fontWeight, size: parseFloat(epiCs.fontSize), color: epiCs.color, lineHeight: parseFloat(epiCs.lineHeight), text: epi.textContent.replace(/\s+/g, ''), seals: epi.querySelectorAll('.sz-home__seal').length } : null,
    title: rect(title),
    titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
    start: rect(start),
    startPos: start ? getComputedStyle(start).position : null,
    pick: rect(pick),
    zone: rect(zone),
    zonePadBottom: zone ? parseFloat(getComputedStyle(zone).paddingBottom) : null,
    block: rect(block),
    tie: rect(tie),
    cells: cells.map(c => ({ w: c.getBoundingClientRect().width, svgs: c.querySelectorAll('svg').length, after: getComputedStyle(c, '::after').content })),
    lineColors: [...lineColors],
    tokens: { frame: token('frame'), guide: token('guide'), ink3: token('ink3') },
    seals: root.querySelectorAll('.sz-home__seal').length,
    sealBox: sealEl ? [sealEl.offsetWidth, sealEl.offsetHeight] : null,
    scrollable: panel ? panel.scrollHeight > panel.clientHeight + 1 : null,
    hlines: [...root.querySelectorAll('.sz-first__hline')].map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, text: [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(), lh: parseFloat(getComputedStyle(e).lineHeight), size: parseFloat(getComputedStyle(e).fontSize) }; }),
    shi: rect(q('home-brand-shi')),
    tip: rect(q('home-first-tip')),
    tabSelected: (document.querySelector('.sz-tabs [aria-selected="true"]') || {}).dataset && document.querySelector('.sz-tabs [aria-selected="true"]').dataset.testid,
  };
}
/* eslint-enable no-undef */

const approx = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  const shots = process.env.SHIZI_E2E_SHOTS;
  await bootTestHost(page, ctx.baseURL);

  for (const view of VIEWS) {
    await page.setViewportSize({ width: view.width, height: view.height });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const size of ['L', 'AX5']) {
        const tag = `${view.id} ${scheme} ${size}`;
        step(`${tag}: 首页各态——无朱色、题记一行 / AX5 隐藏、字帖格两种线、同屏字号三级、光学居中、AX5 满宽按钮与可滚`);
        for (const name of STATES) {
          await page.goto('about:blank');
          await bootTestHost(page, ctx.baseURL);
          await seedHomeState(page, name);
          await setTextSize(page, size);
          await waitNavIdle(page, { settleMs: 150 });
          const m = await page.evaluate(measure);
          const t = `${tag} ${name}`;
          if (shots) await page.screenshot({ path: `${shots}/e9a-${name}-${view.id}-${scheme}-${size}.png` });
          assert.equal(m.view, name, `${t}: home view`);
          assert.equal(m.tabSelected, 'tab-home', `${t}: the 习字 tab is selected`);

          // 1 朱色
          if (name === 'first') {
            assert.equal(m.seals, 1, `${t}: first open has exactly one seal (the brand moment)`);
            assert.deepEqual(m.sealBox, [16, 16], `${t}: seal16`);
          } else {
            assert.deepEqual(m.reds, [], `${t}: no red anywhere on the everyday home (题记不带印、不画朱点)`);
            assert.equal(m.seals, 0, `${t}: no seal`);
          }
          if (name === 'first') continue;

          // 2 题记一行
          assert.ok(m.epi, `${t}: epigraph exists`);
          assert.equal(m.epi.seals, 0, `${t}: epigraph carries no seal`);
          if (size === 'AX5') {
            assert.equal(m.epi.display, 'none', `${t}: epigraph hidden in AX1–AX5 (D49)`);
          } else {
            assert.ok(m.epi.display !== 'none', `${t}: epigraph visible`);
            assert.ok(approx(m.epi.y - m.date.b, 2, 0.6), `${t}: epigraph 2 below the date (${m.epi.y - m.date.b})`);
            assert.ok(approx(m.title.y - m.epi.b, 10, 0.6), `${t}: title 10 below the epigraph (${m.title.y - m.epi.b})`);
            assert.ok(approx(m.epi.h, m.epi.lineHeight, 0.6), `${t}: one line (height ${m.epi.h} = line-height ${m.epi.lineHeight})`);
            assert.ok(m.epi.r <= m.width - 20 + 0.5, `${t}: the line ends inside the right margin (${m.epi.r} ≤ ${m.width - 20})`);
            assert.deepEqual([m.epi.size, m.epi.weight, m.epi.font.startsWith('ShiziSerifSC')], [13, '400', true], `${t}: 宋 13 / 400`);
            assert.ok(/^(心不厌精，手不忘熟。孙过庭|文章千古事，得失寸心知。杜甫|我书意造本无法，点画信手烦推求。苏轼)$/.test(m.epi.text), `${t}: couplet + author: ${m.epi.text}`);
            assert.equal(m.epi.color, m.tokens.ink3, `${t}: ink3`);
          }

          // 4 字帖格线：只有 frame 与 guide
          if (m.tie) {
            assert.ok(m.cells.every(c => c.svgs === 0 || name === 'today'), `${t}: no guide svg inside the cells`);
            assert.ok(m.cells.every(c => c.after === 'none' || c.after === 'normal'), `${t}: no next-cell frame (::after)`);
            const allowed = new Set([m.tokens.frame, m.tokens.guide]);
            const stray = m.lineColors.filter(c => !c.startsWith('border:') && ![...allowed].some(a => c.startsWith(a)));
            assert.deepEqual(stray, [], `${t}: only frame + guide lines inside the copybook (no cross lines, no ink frame)`);
          }

          // 5 字号
          // H1：文字按钮统一 15（D51 ⑥），有文字按钮的态多一级 15（原来「自己选字」是 17）
          const want = size === 'AX5' ? (m.hasTextBtn ? [44, 49, 53, 58] : [44, 53, 58]) : (m.hasTextBtn ? [13, 15, 17, 28] : [13, 17, 28]);
          assert.deepEqual(m.sizes, want, `${t}: same-screen font sizes = ${want.join(' / ')} (text buttons are 15; AX5 per the tier table)`);

          // 6 字帖块与主按钮成组（H1 / D51 ④）：字帖块（含它下面的说明句）底边到主按钮 32、贴着按钮放（首次打开在上面已处理）
          if (size !== 'AX5') {
            assert.ok(approx(m.zonePadBottom, 32, 0.5), `${t}: zone bottom padding 32 (${m.zonePadBottom})`);
            assert.ok(approx(m.start.y - m.block.b, 32, 1), `${t}: 32 between the copybook block and the main button (${m.start.y - m.block.b})`);
            assert.ok(m.block.y >= m.title.b - 0.5 && m.block.b <= m.start.y + 0.5, `${t}: block sits between the title and the main button`);
          }

          // 7 AX5
          if (size === 'AX5') {
            assert.ok(approx(m.start.w, m.width - 40, 1) && approx(m.start.x, 20, 1), `${t}: main button full width (${m.start.w})`);
            assert.ok(m.pick ? m.pick.y >= m.start.b - 0.5 : true, `${t}: 「自己选字」 / 这次先写平常的字 below the main button`);
            assert.equal(m.startPos, 'static', `${t}: the main button is not fixed (the whole page scrolls)`);
            assert.ok(m.cells.length === 0 || m.cells.every(c => c.w >= 44 - 0.5), `${t}: copybook cells ≥ 44 (${m.cells.map(c => c.w)})`);
            assert.ok(m.title.h >= 58, `${t}: title at the Title 1 AX tier`);
          }
        }
      }
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // ---- 首次打开 AX5：题跋横排三行
  for (const view of VIEWS) {
    await page.setViewportSize({ width: view.width, height: view.height });
    step(`${view.id} 首次打开 AX5：题跋横排三行（一行一句、不折）、印跟在末句后间距 8、「拾」120、主按钮满宽、说明句在按钮下 4`);
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await seedHomeState(page, 'first');
    await setTextSize(page, 'AX5');
    await waitNavIdle(page, { settleMs: 150 });
    if (shots) await page.screenshot({ path: `${shots}/e9a-first-${view.id}-light-AX5.png` });
    const m = await page.evaluate(measure);
    const t = `${view.id} first AX5`;
    assert.deepEqual(m.hlines.map(l => l.text), ['提笔忘字，', '不是忘了，', '只是很久没写。'], `${t}: three horizontal lines, one sentence each`);
    assert.ok(m.hlines.every(l => approx(l.h, l.lh, 1)), `${t}: no line wraps (heights ${m.hlines.map(l => l.h)} = line-height ${m.hlines[0].lh})`);
    assert.ok(m.hlines.every(l => l.size === 44), `${t}: 宋 at the t13 AX5 tier (44)`);
    assert.ok(m.hlines.every(l => l.x >= 0 && l.x + l.w <= view.width + 0.5), `${t}: lines inside the viewport`);
    assert.deepEqual(m.sealBox, [16, 16], `${t}: seal16 follows the last line`);
    assert.equal(m.shi.w, 120, `${t}: 「拾」 cell 120`);
    assert.ok(approx(m.start.w, view.width - 40, 1), `${t}: main button full width`);
    assert.ok(approx(m.tip.y - m.start.b, 4, 0.6), `${t}: the note sits 4 below the button (${m.tip.y - m.start.b})`);
    assert.equal(m.pick, null, `${t}: no 「自己选字」 on first open`);
  }
  await setTextSize(page, 'L');
}
