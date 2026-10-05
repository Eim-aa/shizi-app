// H1-4（D51 ④、N2-02；03 P221）：「拾」的交接。
//   首练（今天是用户第一次练习的那天）第三字写下「拾」后，第一次回到首页：品牌「拾」所在的格里换成本人写的「拾」（home-shi-handoff）——
//   C3-H / D53 ④ 起的编排（逐帧时序见 94-c3h-shi-handoff）：先停 600ms，再「退灰 → 写墨 → 灰退场」500ms，格下一句「你写下的第一个「拾」。」；
//   「减少动态效果」下只剩本人的字（品牌层不显示、没有动画）且那句话立即出现；
//   只发生一次（settings.shiHandoffDone，一回到首页就记）：交接格一直画到离开首页，下一次回来是日常状态；刷新也不再有；
//   不会提前发生（首页不在顶层时不交接、不记标志）；没写「拾」、老用户（不是第一次练习那天）不交接。读屏名称里用一次「拾回」。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

const CLOCK = '2026-10-05T12:00:00';
const FIRST_PRACTICE = { entries: [...'尴赢拾'].map((c, i) => ({ char: c, at: `2026-10-05T10:0${i}:00` })), clock: CLOCK };

/* eslint-disable no-undef */
const tab = (page, name) => page.evaluate(async n => (await import('/src/ui/router.js')).nav.switchTab(n), name);

async function handoffFacts(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
    const h = root && root.querySelector('[data-testid="home-shi-handoff"]');
    const st = window.__shiziTest.getState();
    if (!h) return { present: false, done: !!(st.settings && st.settings.shiHandoffDone), hero: root ? root.dataset.hero : null, todayItems: root ? root.querySelectorAll('[data-testid="home-ink-item"]').length : 0 };
    const brand = h.querySelector('.sz-hshi__brand');
    const mine = h.querySelector('[data-testid="home-shi-handoff-mine"]');
    const bcs = getComputedStyle(brand);
    const mcs = getComputedStyle(mine);
    const line = root.querySelector('[data-testid="home-shi-first-line"]');
    const canvas = h.querySelector('canvas');
    const r = h.getBoundingClientRect();
    const ink = mine.querySelector('[data-testid="home-ink-mine"]');
    return {
      present: true,
      done: !!(st.settings && st.settings.shiHandoffDone),
      hero: root.dataset.hero,
      handoffAttr: root.dataset.handoff,
      label: h.getAttribute('aria-label'),
      char: h.dataset.char,
      size: [Math.round(r.width), Math.round(r.height)],
      brandDisplay: bcs.display,
      phase: h.dataset.phase,
      brandAnim: [bcs.animationName, bcs.animationDuration],
      mineAnim: [mcs.animationName, mcs.animationDuration],
      line: line ? { text: line.textContent, on: line.dataset.on, opacity: getComputedStyle(line).opacity } : null,
      progress: canvas ? canvas.dataset.progress : null,
      mineHasInk: !!ink,
      todayItems: root.querySelectorAll('[data-testid="home-ink-item"]').length,
      brandFrames: [...document.querySelectorAll('[data-testid="home-brand-shi"]')].length,
    };
  });
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;

  step('首页不在顶层时不交接、不记标志；回到首页才交接，并记下（只一次）');
  let page = page0;
  await bootTestHost(page, ctx.baseURL);
  await tab(page, 'library');
  await waitNavIdle(page);
  await seedHomeSpec(page, FIRST_PRACTICE); // 首练刚写完（在别的页上）
  await page.waitForTimeout(400);
  await tab(page, 'home');
  await waitNavIdle(page);
  await page.waitForSelector(topSel('home-shi-handoff'));
  let f = await handoffFacts(page);
  assert.equal(f.present, true, 'back on the home tab: the handoff cell is there');
  assert.deepEqual([f.hero, f.handoffAttr, f.char], ['today', 'true', '拾'], 'it is the user\'s own 拾');
  assert.equal(f.mineHasInk, true, 'drawn with the user\'s ink');
  assert.equal(f.done, true, 'settings.shiHandoffDone is recorded as soon as it appears');
  assert.deepEqual(f.size, [160, 160], 'same cell as the brand 拾 (one copybook cell: min(content width, 160))');
  assert.equal(f.todayItems, 0, 'the three-char row waits until the next visit');
  assert.equal(f.label, '拾回的第一个字：你自己写的「拾」', 'the screen-reader name uses 拾回 once');
  assert.equal(f.phase, 'hold', 'it starts by holding the brand 拾 (the timeline is pinned in 94-c3h-shi-handoff)');
  assert.deepEqual([f.brandAnim[0], f.mineAnim[0]], ['none', 'none'], 'no keyframe cross-fade between the two glyphs any more (C3-H)');
  assert.equal(f.line && f.line.text, '你写下的第一个「拾」。', 'the one-time line under the cell');

  step('交接格一直画到离开首页；回来是日常状态（今天写的字），不再交接');
  await page.waitForTimeout(1700);
  f = await handoffFacts(page);
  assert.equal(f.present, true, 'still there while the user stays on the home page');
  assert.deepEqual([f.phase, f.line.on, f.progress], ['done', 'true', '1'], 'after the timeline: the user\'s ink is complete and the line is shown');
  await tab(page, 'library');
  await waitNavIdle(page);
  await tab(page, 'home');
  await waitNavIdle(page);
  f = await handoffFacts(page);
  assert.deepEqual([f.present, f.hero, f.todayItems], [false, 'today', 3], 'next visit: today\'s three chars (daily state)');

  step('刷新后也不再交接（标志位已存）');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  f = await handoffFacts(page);
  assert.deepEqual([f.present, f.done], [false, true], 'no second handoff after a reload');

  step('减少动态效果：直接是本人的字，品牌层不显示、没有动画');
  await page.close();
  page = await page0.context().newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootTestHost(page, ctx.baseURL);
  await seedHomeSpec(page, FIRST_PRACTICE);
  await page.waitForSelector(topSel('home-shi-handoff'));
  f = await handoffFacts(page);
  assert.equal(f.present, true, 'reduced motion: the handoff still happens');
  assert.equal(f.brandDisplay, 'none', 'the brand layer is not shown');
  assert.equal(f.mineAnim[0], 'none', 'no animation: the user\'s 拾 is just there');
  assert.deepEqual([f.phase, f.line.on, f.progress], ['done', 'true', '1'], 'reduced motion: the final state straight away, with the line');

  step('没写「拾」（跳过）/ 不是第一次练习那天：不交接，标志位不动');
  await page.close();
  page = await page0.context().newPage();
  await bootTestHost(page, ctx.baseURL);
  await seedHomeSpec(page, { entries: [...'尴赢春'].map((c, i) => ({ char: c, at: `2026-10-05T10:0${i}:00` })), clock: CLOCK });
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]').dataset.view === 'today');
  await page.waitForTimeout(300);
  f = await handoffFacts(page);
  assert.deepEqual([f.present, f.done, f.todayItems], [false, false, 3], 'no 拾 written: nothing to hand off');
  await seedHomeSpec(page, { entries: [{ char: '永', at: '2026-09-20T20:00:00' }, ...FIRST_PRACTICE.entries], clock: CLOCK });
  await page.waitForTimeout(300);
  f = await handoffFacts(page);
  assert.deepEqual([f.present, f.done], [false, false], 'an existing user (first practice was earlier): no catch-up handoff');
  await page.close();
}
