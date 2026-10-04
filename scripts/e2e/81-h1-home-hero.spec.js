// H1-3（D51 ④、T2-09、N2-09）：首页日常状态的主视觉。
//   今天还没写 / 离开一周 / 特别组那天还没写：本人最近写的 3 个字（本人墨，home-recent-row）；今天写过：今天的字（home-ink-row）；进行中：这一组的格子；
//   这些态里没有品牌「拾」（home-brand-shi 不存在）；品牌「拾」只在首次打开、以及有记录却没有任何可显示的本人墨（清空过记录）时出现。
//   字帖块（含它下面的说明句）的底边到主按钮 32，主按钮仍在 Tab 栏上 119；一屏一个焦点（字帖行与品牌字合计 ≤ 1 个）。
//   393×852 浅 / 深，375×667 浅。
import { bootTestHost, waitNavIdle } from './helpers.mjs';
import { markFirstPracticeDone, seedHomeState } from './home-helpers.mjs';

/* eslint-disable no-undef */
async function facts(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const panel = document.querySelector('.sz-tabroot__panel').getBoundingClientRect();
    const recent = [...root.querySelectorAll('[data-testid="home-recent-item"]')];
    return {
      view: root.dataset.view,
      hero: root.dataset.hero,
      brand: !!q('home-brand-shi'),
      focus: root.querySelectorAll('.sz-htie, .sz-hshi').length,
      recentChars: recent.map(el => el.dataset.char),
      recentInk: recent.map(el => el.dataset.ink),
      recentRowIsButton: q('home-recent-row') ? q('home-recent-row').tagName === 'BUTTON' : null,
      hasToday: !!q('home-ink-row'),
      hasProgress: !!q('home-progress'),
      label: (q('home-recent-row') || {}).ariaLabel || null,
      block: rect(q('home-zone')),
      cta: rect(q('home-start')),
      panelBottom: panel.bottom,
    };
  });
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  const expected = {
    fresh: [...'肆酝春'],
    back: [...'屉鼎窗'],
    special: [0x6107, 0x6108, 0x6109].map(c => String.fromCodePoint(c)),
  };
  let page = page0;
  const runs = [
    { tag: '393×852 light', width: 393, height: 852, scheme: 'light' },
    { tag: '393×852 dark', width: 393, height: 852, scheme: 'dark' },
    { tag: '375×667 light', width: 375, height: 667, scheme: 'light' },
  ];
  for (const [i, v] of runs.entries()) {
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);

    step(`${v.tag}: 日常五态没有品牌「拾」，主视觉是字帖行`);
    for (const name of ['fresh', 'today', 'progress', 'special', 'back']) {
      await seedHomeState(page, name);
      const f = await facts(page);
      const t = `${v.tag} ${name}`;
      assert.equal(f.brand, false, `${t}: no brand 拾 frame`);
      assert.ok(f.focus <= 1, `${t}: one focus on the screen (${f.focus} copybook rows)`);
      if (name === 'fresh' || name === 'back' || name === 'special') {
        assert.equal(f.hero, 'recent', `${t}: the hero is the recent chars`);
        assert.deepEqual(f.recentChars, expected[name], `${t}: the three most recently written chars, oldest → newest`);
        assert.deepEqual(f.recentInk, ['ink', 'ink', 'ink'], `${t}: all drawn with the user's own ink`);
        assert.equal(f.recentRowIsButton, false, `${t}: the recent row is not a button`);
        assert.ok(f.label && f.label.startsWith('你最近写的字：') && expected[name].every(c => f.label.includes(`「${c}」`)), `${t}: screen-reader name lists the chars (${f.label})`);
      } else if (name === 'today') {
        assert.equal(f.hasToday, true, `${t}: today's row`);
        assert.equal(f.recentChars.length, 0, `${t}: no recent row once today has chars`);
      } else {
        assert.equal(f.hasProgress, true, `${t}: the group's cells`);
      }
      assert.ok(near(f.cta.top - f.block.bottom, 32), `${t}: 32 between the copybook block and the main button (${(f.cta.top - f.block.bottom).toFixed(1)})`);
      assert.ok(near(f.panelBottom - f.cta.top, 119), `${t}: the main button stays 119 above the tab bar (${f.panelBottom - f.cta.top})`);
    }

    step(`${v.tag}: 品牌「拾」只在首次打开与没有可显示的本人墨时出现`);
    await seedHomeState(page, 'first');
    let f = await facts(page);
    assert.deepEqual([f.view, f.brand], ['first', true], `${v.tag}: first open shows the brand 拾`);
    await page.evaluate(() => window.__shiziTest.reset());
    await markFirstPracticeDone(page); // 清空过记录的结论句：有过记录、现在没有任何一条
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]').dataset.view === 'fresh');
    await waitNavIdle(page);
    f = await facts(page);
    assert.deepEqual([f.view, f.hero, f.brand, f.recentChars.length], ['fresh', 'shi', true, 0], `${v.tag}: no ink to show (records cleared) → the brand 拾 is the placeholder`);
  }
  if (page !== page0) await page.close();
}
