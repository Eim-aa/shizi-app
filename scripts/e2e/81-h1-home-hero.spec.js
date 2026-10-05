// H1-3（D51 ④、T2-09、N2-09）：首页日常状态的主视觉。
//   今天还没写 / 离开一周 / 特别组那天还没写：本人最近写的 3 个字（本人墨，home-recent-row）；今天写过：今天的字（home-ink-row）；进行中：这一组的格子；
//   这些态里没有品牌「拾」（home-brand-shi 不存在）；品牌「拾」只在首次打开、以及有记录却没有任何可显示的本人墨（清空过记录）时出现。
//   C3-H / D53 ③ 起（覆盖 H1 的「整体块居中」）：标题 + 字帖这一组在页头下沿与主按钮区之间光学居中（上下留白 42 : 58），主按钮固定在
//   Tab 栏上沿上方 24 的底线（五态与首次打开同一 y），次按钮 / 首次说明在它上面；首次打开与品牌「拾」同一规则；一屏一个焦点（字帖行与品牌字合计 ≤ 1 个）。
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
      stage: rect(root.querySelector('.sz-home__stage')),
      zone: rect(root.querySelector('.sz-home__zone')),
      foot: rect(root.querySelector('.sz-home__foot')),
      title: rect(q('home-title')),
      headBottom: root.querySelector('.sz-home__head').getBoundingClientRect().bottom,
    };
  });
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

/** 标题 + 字帖这一组（标题上沿到字帖块下沿，首次打开 / 品牌「拾」没有标题，从字帖位上沿起）在页头下沿与主按钮区上沿之间光学居中（按含 16 底内边的 zone 量）：上下留白 42 : 58。 */
function assertCentred(assert, f, t) {
  const top = f.title ? f.title.top : f.zone.top;
  const bottom = f.zone.bottom; // 含 zone 底内边 16（到按钮区的最小间距）
  const above = top - f.headBottom;
  const below = f.foot.top - bottom;
  assert.ok(above >= -0.5 && below >= -0.5, `${t}: the group sits between the header and the main-button area (${above.toFixed(1)} / ${below.toFixed(1)})`);
  if (above + below > 40) assert.ok(Math.abs(above / (above + below) - 0.42) <= 0.03, `${t}: top : bottom whitespace ≈ 42 : 58 (${above.toFixed(1)} : ${below.toFixed(1)})`);
}

/** 主按钮底边固定在 Tab 栏上沿上方 24（全 App 统一的底线）。 */
function assertBaseline(assert, f, t) {
  assert.ok(near(f.panelBottom - f.cta.bottom, 24, 0.6), `${t}: the main button's bottom is 24 above the tab bar (${(f.panelBottom - f.cta.bottom).toFixed(1)})`);
}

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
      assertBaseline(assert, f, t);
      assertCentred(assert, f, t);
    }

    step(`${v.tag}: 品牌「拾」只在首次打开与没有可显示的本人墨时出现`);
    await seedHomeState(page, 'first');
    let f = await facts(page);
    assert.deepEqual([f.view, f.brand], ['first', true], `${v.tag}: first open shows the brand 拾`);
    assertCentred(assert, f, `${v.tag} first`);
    assertBaseline(assert, f, `${v.tag} first`);
    await page.evaluate(() => window.__shiziTest.reset());
    await markFirstPracticeDone(page); // 清空过记录的结论句：有过记录、现在没有任何一条
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]').dataset.view === 'fresh');
    await waitNavIdle(page);
    f = await facts(page);
    assert.deepEqual([f.view, f.hero, f.brand, f.recentChars.length], ['fresh', 'shi', true, 0], `${v.tag}: no ink to show (records cleared) → the brand 拾 is the placeholder`);
    assertCentred(assert, f, `${v.tag} brand placeholder`);
    assertBaseline(assert, f, `${v.tag} brand placeholder`);
  }
  if (page !== page0) await page.close();
}
