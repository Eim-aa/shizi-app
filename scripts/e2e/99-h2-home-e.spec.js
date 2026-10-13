// H2（D55，产品负责人选定「首页方向」E 极静）：首页六态。
//
//   首页只有：左上日期时段、居中偏上的墨「拾」（128pt，--hand）、其右竖排题记（两列 + 作者小字）、主按钮上方的「自己选字」、主按钮；
//   不放：写过的字 / 字帖行 / 数字 / 进度 / 说明句 / 标题「今天写几个字」（标题只留给读屏）。状态只体现在按钮的字与两处各多一句：
//     ① 首次打开  现有画面（框中「拾」、三列题跋、印、「先写三个大家常忘的字。」「开始写字」，没有自己选字）
//     ② 今天还没写  按钮「开始写字」
//     ③ 写到一半  「继续写字」
//     ④ 今天写完  「再写一组」
//     ⑤ 离开一周后  多一句「你写过的 N 个字都还在。」（13 墨三，在「拾」与题记这一组下面）
//     ⑥ 大写数字特别组那天  多一句特别组说明；「自己选字」旁加「这次先写平常的字」
//   所有态：主按钮底边在 Tab 栏上沿上 24（同一条底线）、整页不滚动；主操作都是一次点击；浅 / 深（夜间纸）；390×844 与 375×667。
// 截图：设 SHIZI_E2E_SHOTS=<目录> 时每个组合存一张。

import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { HOME_STATES, seedHomeState } from './home-helpers.mjs';

const VIEWS = [{ id: '390x844', width: 390, height: 844 }, { id: '375x667', width: 375, height: 667 }];
const STATES = Object.keys(HOME_STATES);

const CTA = { first: '开始写字', fresh: '开始写字', progress: '继续写字', today: '再写一组', back: '开始写字', special: '开始写字' };
const CAPITAL = '今天写两组大写数字，借条、红包上用得着。';
const EPIGRAPHS = [['心不厌精，', '手不忘熟。', '孙过庭'], ['文章千古事，', '得失寸心知。', '杜甫'], ['我书意造本无法，', '点画信手烦推求。', '苏轼']];

/* eslint-disable no-undef */
function measure() {
  const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
  if (!root) return null;
  const q = id => root.querySelector(`[data-testid="${id}"]`);
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; };
  const panel = document.querySelector('.sz-tabroot__panel');
  const token = name => { const p = document.createElement('span'); p.style.color = `var(--${name})`; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const visibleText = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.textContent.replace(/\s+/g, ' ').trim();
    const host = n.parentElement;
    if (!s || !host || !host.checkVisibility() || host.closest('.sz-home__dev')) continue; // 开发入口只在测试宿主出现，不是用户界面
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue; // 读屏专用（sr-only）的文字不算「可见」
    visibleText.push({ text: s, testid: (host.closest('[data-testid]') || {}).dataset ? host.closest('[data-testid]').dataset.testid : null });
  }
  const probe = name => { const el = document.createElement('span'); el.style.color = `var(--${name})`; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; };
  const zhu = probe('zhu');
  const seal = probe('seal');
  const reds = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.checkVisibility() || el.closest('.sz-home__dev')) continue;
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      const vals = [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor, cs.boxShadow, cs.fill, cs.stroke];
      if (vals.some(v => v && (v.includes(zhu) || v.includes(seal)))) reds.push(`${el.tagName.toLowerCase()}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 24)}${pseudo || ''}`);
    }
  }
  const sizes = new Set();
  const walker2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker2.nextNode(); n; n = walker2.nextNode()) {
    if (!n.textContent.trim()) continue;
    const host = n.parentElement;
    if (!host || !host.checkVisibility() || host.closest('.sz-home__dev, .sz-first')) continue;
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    sizes.add(Math.round(parseFloat(getComputedStyle(host).fontSize) * 100) / 100);
  }
  const shi = q('home-brand-shi');
  const epi = q('home-epigraph');
  const epiCols = epi ? [...epi.children].map(c => { const cs = getComputedStyle(c); const r = c.getBoundingClientRect(); return { text: c.textContent.trim(), mode: cs.writingMode, size: parseFloat(cs.fontSize), color: cs.color, font: cs.fontFamily, x: r.x, y: r.y, w: r.width, h: r.height }; }) : [];
  const title = q('home-title');
  const pick = q('home-pick');
  const defer = q('home-capital-defer');
  const note = q('home-back-note') || q('home-capital-body');
  const date = q('home-date');
  const start = q('home-start');
  const shiSvg = shi ? shi.querySelector('svg') : null;
  const shiCs = shi ? getComputedStyle(shi) : null;
  return {
    view: root.dataset.view,
    width: root.clientWidth,
    scrollable: root.offsetHeight > panel.clientHeight + 1, // 测试宿主的开发入口落在首屏下面（absolute），不算页面内容
    overflowX: Math.max(document.documentElement.scrollWidth, root.scrollWidth) > window.innerWidth + 0.5,
    panelBottom: panel.getBoundingClientRect().bottom,
    start: rect(start), startText: start ? start.textContent.trim() : null, startLabel: start ? start.getAttribute('aria-label') : null,
    pick: rect(pick), pickText: pick ? pick.textContent.trim() : null,
    defer: rect(defer), deferText: defer ? defer.textContent.trim() : null,
    date: rect(date), dateText: date ? date.textContent.trim() : null, dateColor: date ? getComputedStyle(date).color : null,
    shi: rect(shi), shiColor: shiCs ? shiCs.color : null, shiLabel: shi ? shi.getAttribute('aria-label') : null, shiHasSvg: !!shiSvg,
    epi: rect(epi), epiCols, epiAriaHidden: epi ? epi.getAttribute('aria-hidden') : null, epiIndex: epi ? Number(epi.dataset.index) : null,
    title: title ? { text: title.textContent.trim(), tag: title.tagName, visible: (() => { const r = title.getBoundingClientRect(); return r.width >= 2 && r.height >= 2; })() } : null,
    note: rect(note), noteText: note ? note.textContent.trim() : null, noteColor: note ? getComputedStyle(note).color : null, noteSize: note ? parseFloat(getComputedStyle(note).fontSize) : null,
    firstTip: q('home-first-tip') ? q('home-first-tip').textContent.trim() : null,
    motto: q('home-motto') ? q('home-motto').getAttribute('aria-label') : null,
    seals: root.querySelectorAll('.sz-home__seal').length,
    reds, sizes: [...sizes].sort((a, b) => a - b),
    visibleText,
    banned: ['.sz-htie', '.sz-hcell', '.sz-hshi--handoff', 'canvas', '[data-testid="home-ink-row"]', '[data-testid="home-ink-item"]', '[data-testid="home-recent-row"]',
      '[data-testid="home-progress"]', '[data-testid="home-today-count"]', '[data-testid="home-recent-note"]', '[data-testid="home-shi-handoff"]', '[data-testid="home-shi-first-line"]']
      .filter(sel => !!root.querySelector(sel)),
    tokens: { hand: token('hand'), ink2: token('ink2'), ink3: token('ink3') },
    hasHeadingH1: root.querySelectorAll('h1').length,
  };
}
/* eslint-enable no-undef */

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  const shots = process.env.SHIZI_E2E_SHOTS;
  await bootTestHost(page, ctx.baseURL);

  for (const view of VIEWS) {
    await page.setViewportSize({ width: view.width, height: view.height });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      step(`${view.id} ${scheme}: 六态——按钮字、「拾」+ 竖排题记、没有字帖与数字、同一条底线、整页不滚动`);
      const bottoms = [];
      for (const name of STATES) {
        await seedHomeState(page, name);
        await waitNavIdle(page, { settleMs: 150 });
        const m = await page.evaluate(measure);
        const t = `${view.id} ${scheme} ${name}`;
        if (shots) await page.screenshot({ path: `${shots}/h2-${name}-${view.id}-${scheme}.png` });
        assert.equal(m.view, name, `${t}: view`);
        assert.deepEqual(m.banned, [], `${t}: no copybook row, no ink cells, no handoff, no counts, no 「昨天写的字」 on the home`);
        assert.equal(m.startText, CTA[name], `${t}: the main button reads 「${CTA[name]}」`);
        assert.equal(m.startLabel, CTA[name], `${t}: and is named the same for the screen reader`);
        assert.equal(m.scrollable, false, `${t}: the page does not scroll`);
        assert.equal(m.overflowX, false, `${t}: no horizontal overflow`);
        assert.ok(near(m.panelBottom - m.start.b, 24, 0.6), `${t}: the main button's bottom is 24 above the tab bar (${m.panelBottom - m.start.b})`);
        bottoms.push(m.start.b);

        if (name === 'first') {
          assert.equal(m.motto, '提笔忘字，不是忘了，只是很久没写。', `${t}: the first-open motto is unchanged`);
          assert.equal(m.firstTip, '先写三个大家常忘的字。', `${t}: 「先写三个大家常忘的字。」`);
          assert.equal(m.seals, 1, `${t}: one seal`);
          assert.equal(m.pick, null, `${t}: no 「自己选字」 on the first open (D46 ②)`);
          assert.equal(m.date, null, `${t}: no date on the first open`);
          continue;
        }

        // 日期 + 「拾」+ 竖排题记
        assert.ok(/^\d{1,2}月\d{1,2}日 · (早上|中午|傍晚|晚上)$/.test(m.dateText), `${t}: date and period at the top-left (${m.dateText})`);
        assert.equal(m.dateColor, m.tokens.ink3, `${t}: the date is ink3`);
        assert.ok(near(m.date.x, 20, 0.6), `${t}: the date is on the 20 line`);
        assert.equal(m.shiHasSvg, true, `${t}: the brand 「拾」 is the ShiMark vector`);
        assert.equal(m.shiLabel, '拾', `${t}: named 「拾」`);
        assert.ok(near(m.shi.w, 128, 0.6) && near(m.shi.h, 128, 0.6), `${t}: 「拾」 is 128pt (${m.shi.w}×${m.shi.h})`);
        assert.equal(m.shiColor, m.tokens.hand, `${t}: 「拾」 is drawn in the ink colour --hand`);
        assert.equal(m.epiCols.length, 3, `${t}: epigraph = two columns + the author`);
        const [a, b, au] = m.epiCols;
        assert.ok(m.epiCols.every(c => c.mode === 'vertical-rl'), `${t}: vertical writing`);
        assert.ok(a.x > b.x && b.x > au.x, `${t}: columns run right to left: first line rightmost, author leftmost`);
        assert.ok(m.epi.x > m.shi.r, `${t}: the epigraph sits to the right of 「拾」`);
        assert.ok(EPIGRAPHS.some(e => e[0] === a.text && e[1] === b.text && e[2] === au.text), `${t}: couplet + author: ${a.text}${b.text}${au.text}`);
        assert.deepEqual([a.size, b.size, au.size], [15, 15, 13], `${t}: couplet 宋 15, author 宋 13`);
        assert.deepEqual([a.color, au.color], [m.tokens.ink2, m.tokens.ink3], `${t}: couplet ink2, author ink3`);
        assert.ok(a.font.startsWith('ShiziSerifSC'), `${t}: 宋体`);
        assert.equal(m.epiAriaHidden, 'true', `${t}: the epigraph is decoration for the reader (it is the page title's description)`);
        // 居中偏上：「拾」在日期与主按钮之间，中心在可用高度的上半
        const midGroup = m.shi.y + m.shi.h / 2;
        assert.ok(midGroup > m.date.b && midGroup < m.start.y, `${t}: the 「拾」 group sits between the date and the buttons`);
        assert.ok(near((m.shi.x + m.epi.r) / 2, view.width / 2, 14), `${t}: the 「拾」 + epigraph group is centred horizontally (${m.shi.x}…${m.epi.r})`);
        // 标题只给读屏
        assert.ok(m.title && m.title.text === '今天写字' && m.title.tag === 'H1' && m.title.visible === false, `${t}: the title 「今天写字」 is only an h1 for the screen reader, not on the page`);
        // 屏上的文字：只有日期、题记、一句（五 / 六态）、按钮
        const texts = m.visibleText.map(x => x.text);
        const allowed = new Set([m.dateText, ...EPIGRAPHS.flatMap(e => e), 'x']);
        const extra = m.visibleText.filter(x => !allowed.has(x.text) && x.testid !== 'home-start' && x.testid !== 'home-pick' && x.testid !== 'home-capital-defer'
          && x.testid !== 'home-back-note' && x.testid !== 'home-capital-body');
        assert.deepEqual(extra, [], `${t}: nothing else is written on the page (no title, no counts, no progress, no explanations)`);
        const digitsOutsideDate = m.visibleText.filter(x => x.text !== m.dateText && /\d/.test(x.text)).map(x => x.text);
        if (name === 'back') assert.deepEqual(digitsOutsideDate, ['你写过的 5 个字都还在。'], `${t}: the one number on the page is the 「N 个字」 line`);
        else assert.deepEqual(digitsOutsideDate, [], `${t}: no digits anywhere but the date`);
        void texts;

        // 按钮与那一句
        if (name === 'special') {
          assert.equal(m.noteText, CAPITAL, `${t}: the special group's one line (existing copy)`);
          assert.equal(m.deferText, '写平常字', `${t}: 「写平常字」`);
        } else {
          assert.equal(m.defer, null, `${t}: no 「写平常字」`);
          assert.equal(m.pickText, '自己选字', `${t}: 「自己选字」 above the main button`);
        }
        if (name === 'back') {
          assert.equal(m.noteText, '你写过的 5 个字都还在。', `${t}: 「你写过的 N 个字都还在。」 with the real N`);
        }
        if (name === 'back' || name === 'special') {
          assert.equal(m.noteSize, 13, `${t}: the line is 13`);
          assert.equal(m.noteColor, m.tokens.ink3, `${t}: ink3`);
          assert.ok(m.note.y >= m.shi.b - 0.5 && m.note.y >= m.epi.b - 0.5 || m.note.y > m.shi.y + m.shi.h * 0.5, `${t}: the line sits under the 「拾」 + epigraph group (${m.note.y} vs ${m.shi.b})`);
          assert.ok(m.note.b <= (m.pick || m.defer).y + 0.5, `${t}: and above the text buttons`);
        } else {
          assert.equal(m.noteText, null, `${t}: no extra line`);
        }
        if (name === 'special') {
          assert.ok(m.pick && m.defer && near(m.pick.y, m.defer.y, 1) && m.pick.x < m.defer.x, `${t}: 「自己选字」 and 「写平常字」 side by side, pick on the left`);
          assert.equal(m.pickText, '自己选字', `${t}: 「自己选字」 stays`);
        }
        if (m.pick) assert.ok(m.pick.b <= m.start.y + 0.5, `${t}: the text buttons sit above the main button`);
        assert.ok(m.seals === 0, `${t}: no seal on the everyday home`);
        assert.deepEqual(m.reds, [], `${t}: no red anywhere on the everyday home (no seal, no wrong dots)`);
        assert.deepEqual(m.sizes, [13, 15, 17], `${t}: same-screen font sizes 13 / 15 / 17 (date, line and author 13; couplet and text buttons 15; the main button 17)`);
      }
      assert.ok(bottoms.every(y => near(y, bottoms[0], 0.6)), `${view.id} ${scheme}: the main button's y is the same in all six states (${bottoms.map(Math.round).join(' / ')})`);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });

  // ---- 主操作都是一次点击
  step('主操作一次点击：开始写字 → 写字页；自己选字 → 查字；写平常字 → 写字页（顺延）；继续写字 / 再写一组各一次');
  const fresh = async name => {
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await seedHomeState(page, name);
    await waitNavIdle(page);
  };
  const topScreen = () => page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen);
  await fresh('fresh');
  await page.click(topSel('home-start'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  assert.equal(await topScreen(), 'write', 'fresh: one tap on 开始写字 opens the write page');
  await fresh('progress');
  await page.click(topSel('home-start'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  assert.equal(await topScreen(), 'write', 'progress: one tap on 继续写字 opens the write page');
  await fresh('today');
  await page.click(topSel('home-start'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  assert.equal(await topScreen(), 'write', 'today: one tap on 再写一组 opens the write page');
  await fresh('fresh');
  await page.click(topSel('home-pick'));
  await page.waitForSelector('[data-testid="query-input"]');
  assert.ok(true, 'fresh: one tap on 自己选字 opens the picker');
  await fresh('special');
  await page.click(topSel('home-capital-defer'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  assert.equal(await topScreen(), 'write', 'special: one tap on 写平常字 opens the (ordinary) write page');
}
