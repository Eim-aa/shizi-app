// M4-6 关于（02 M4-6；04 R-AB01 / R-AB02；03 P21）。
//
// 场景：
//   1. 从「我的」tab 进关于页（M4-1 的菜单行还没接时用 openAbout()，与菜单行同一个 nav.push('about')）：
//      页头「关于拾字」、印、应用名、版本行、两行题句、三行按钮（隐私 / 开源资料 · 致谢 / 给我们写信），无障碍名可读。
//   2. 三个子页都可达：点行 → 子页（页头与内容）；页头返回 → 回到关于页（栈深回到 1，关于页仍在顶上）；
//      系统返回（history.back）同样回到关于页；关于页再返回 → 「我的」tab 根。
//   3. 开源资料 · 致谢：程序 / 字形和字源 / 字体 三组，条目与 src/config/credits.js 一致（含 Preact / htm / Hanzi Writer / ts-fsrs），
//      「许可全文」展开 / 收起（aria-expanded），展开后是 NOTICES 原文 + licenses/ 全文。
//   4. 给我们写信：过渡文案（P21，R-AB01.letterAddressPending）。
//   5. 刷新停在子页 → 仍是该子页，返回回到关于页。
//   6. 全程不写入（写日志长度不变、v2 状态深相等）；393×852 与 360×640 无横向滚动（展开最长的许可全文后）。

import { bootTestHost, PRESS_SETTLE_MS, tid, topSel, waitNavIdle } from './helpers.mjs';

const ABOUT_MOD = '/src/ui/screens/mine/about.js';

async function route(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { depth: s.depth, top: s.top ? s.top.n : null, tab: s.tab || null };
  });
}

async function waitTop(page, name) {
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return !!s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function goTab(page, name) {
  await page.evaluate(async n => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(n);
  }, name);
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function openAbout(page) {
  await page.evaluate(async mod => {
    const m = await import(mod);
    m.openAbout();
  }, ABOUT_MOD);
  await waitTop(page, 'about');
  await page.waitForSelector(topSel('about-screen'));
}

async function title(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-page-title]');
    return el ? el.textContent.trim() : null;
  });
}

async function writeCount(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

async function noHScroll(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const body = top && top.querySelector('.sz-page__body');
    return document.scrollingElement.scrollWidth <= window.innerWidth + 1
      && (!body || body.scrollWidth <= body.clientWidth + 1);
  });
}

export default async function about(page, ctx) {
  const { assert } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(() => window.__shiziTest.reset());
  const credits = await page.evaluate(async () => {
    const m = await import('/src/config/credits.js');
    return m.CREDITS.map(c => ({ id: c.id, name: c.name, version: c.version, kind: c.kind, license: c.license, url: c.url }));
  });
  const stateBefore = await page.evaluate(() => window.__shiziTest.getState());
  const writesBefore = await writeCount(page);

  // ------------------------------------------------------------ 1. 关于页
  ctx.step('about page from the 我的 tab: header, seal, name, build, motto, three row buttons with readable names');
  await goTab(page, 'mine');
  await openAbout(page);
  let r = await route(page);
  const writesInSession = writesBefore;
  assert.equal(r.top, 'about', 'about on top');
  assert.equal(r.depth, 1, 'pushed one level above the mine tab root');
  assert.equal(await title(page), '关于拾字', 'page title 关于拾字');
  const head = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    return {
      seal: q('about-seal').textContent.trim(), sealPaths: q('about-seal').querySelectorAll('svg path').length, sealHidden: q('about-seal').getAttribute('aria-hidden'),
      name: q('about-name').textContent, build: q('about-build').textContent,
      motto: q('about-motto').innerText.replace(/\s+/g, '|'),
      back: q('page-back') ? q('page-back').getAttribute('aria-label') : null,
      rows: [...top.querySelectorAll('[data-testid^="about-row-"]')].map(b => ({
        id: b.dataset.testid, tag: b.tagName, to: b.dataset.to, aria: b.getAttribute('aria-label'), text: b.innerText.replace(/\s+/g, ' ').trim(),
        h: b.getBoundingClientRect().height,
      })),
    };
  });
  const { build, version } = await page.evaluate(async () => {
    const m = await import('/src/build-info.js');
    return { build: m.BUILD, version: m.VERSION };
  });
  assert.equal(head.seal, '', 'R2-S2: the seal is a drawing, no text');
  assert.equal(head.sealPaths, 9, 'seal draws the brand 拾 (nine strokes)');
  assert.equal(head.sealHidden, 'true', 'seal is decorative (aria-hidden)');
  assert.equal(head.name, '拾字', 'app name');
  // B7（D36）：版本行「版本 1.0（20261001）」= VERSION + BUILD 的日期部分；完整 BUILD 点按展开、可选中
  assert.equal(head.build, `版本 ${version}（${build.slice(0, 8)}）`, 'version line = 版本 {VERSION}（BUILD date）');
  assert.ok(/^版本 \d+\.\d+\.\d+（\d{8}）$/.test(head.build), 'version line shape');
  assert.equal(await page.locator(topSel('about-build-full')).count(), 0, 'full BUILD is folded by default');
  await page.click(topSel('about-build'));
  const full = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const btn = top.querySelector('[data-testid="about-build"]');
    const el = top.querySelector('[data-testid="about-build-full"]');
    return el ? { text: el.textContent, expanded: btn.getAttribute('aria-expanded'), userSelect: getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect } : null;
  });
  assert.deepEqual(full && { text: full.text, expanded: full.expanded }, { text: `构建号 ${build}`, expanded: 'true' }, 'tap → full BUILD shown, aria-expanded=true');
  assert.equal(full.userSelect, 'text', 'full BUILD is selectable (long-press → copy)');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('about-build'));
  assert.equal(await page.locator(topSel('about-build-full')).count(), 0, 'tap again → folded');
  assert.equal(head.motto, '提笔忘字，不是忘了，|只是很久没写。', 'motto in two lines');
  assert.equal(head.back, '返回', 'back button has a name');
  assert.deepEqual(head.rows.map(x => x.id), ['about-row-privacy', 'about-row-credits', 'about-row-letter'], 'three rows in order');
  assert.ok(head.rows.every(x => x.tag === 'BUTTON'), 'every row is a <button>');
  assert.deepEqual(head.rows.map(x => x.to), ['about-privacy', 'about-credits', 'about-letter'], 'row targets');
  assert.deepEqual(head.rows.map(x => x.aria), ['隐私，记录只存在这台手机上', '开源资料 · 致谢', '给我们写信'], 'row accessible names');
  assert.deepEqual(head.rows.map(x => x.text), ['隐私 记录只存在这台手机上 ›', '开源资料 · 致谢', '给我们写信'], 'row texts (R-AB01; the arrows of the last two rows are svg chevrons since P1-E1b)');
  assert.ok(head.rows.every(x => x.h >= 44), 'rows at least 44px tall');
  assert.ok(await noHScroll(page), 'about: no horizontal scroll');

  // ------------------------------------------------------------ 2. 三个子页可达、返回正确
  ctx.step('each sub-page reachable; header back and system back return to the about page');
  const subs = [
    { row: 'about-row-privacy', screen: 'about-privacy', testid: 'about-privacy-screen', title: '隐私' },
    { row: 'about-row-credits', screen: 'about-credits', testid: 'about-credits-screen', title: '开源资料 · 致谢' },
    { row: 'about-row-letter', screen: 'about-letter', testid: 'about-letter-screen', title: '给我们写信' },
  ];
  for (const s of subs) {
    await page.click(topSel(s.row));
    await waitTop(page, s.screen);
    await page.waitForSelector(topSel(s.testid));
    r = await route(page);
    assert.equal(r.depth, 2, `${s.screen}: depth 2`);
    assert.equal(await title(page), s.title, `${s.screen}: title ${s.title}`);
    assert.ok(await noHScroll(page), `${s.screen}: no horizontal scroll`);
    await page.click(topSel('page-back'));
    await waitTop(page, 'about');
    r = await route(page);
    assert.equal(r.depth, 1, `${s.screen}: header back → about (depth 1)`);
    assert.ok(await page.$(topSel('about-screen')), `${s.screen}: about page on top again`);
  }
  // 系统返回
  await page.click(topSel('about-row-letter'));
  await waitTop(page, 'about-letter');
  await page.evaluate(() => history.back());
  await waitTop(page, 'about');
  assert.equal((await route(page)).depth, 1, 'system back from 给我们写信 → about');

  // ------------------------------------------------------------ 3. 隐私
  ctx.step('privacy: four paragraphs from copy X-ABOUT.privacy1, 2, 3Web, 4 (P21; P197 per platform)');
  await page.click(topSel('about-row-privacy'));
  await waitTop(page, 'about-privacy');
  const priv = await page.$$eval(topSel('about-privacy-p'), els => els.map(e => e.textContent));
  const privCopy = await page.evaluate(async () => {
    const { t } = await import('/src/config/copy/index.js');
    return ['privacy1', 'privacy2', 'privacy3Web', 'privacy4'].map(k => t(`X-ABOUT.${k}`));
  });
  assert.deepEqual(priv, privCopy, 'privacy paragraphs = copy');
  assert.ok(priv[0].includes('这台手机'), 'first paragraph says 这台手机 (D9)');
  assert.ok(priv[2].startsWith('网页版联网'), 'web build: the network sentence is the web one (P197; the iOS shell never goes online)');
  await page.click(topSel('page-back'));
  await waitTop(page, 'about');

  // ------------------------------------------------------------ 4. 开源资料 · 致谢
  ctx.step('credits: groups, items from credits.js, license text toggle');
  await page.click(topSel('about-row-credits'));
  await waitTop(page, 'about-credits');
  let cv = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return {
      intro: top.querySelector('[data-testid="about-credits-intro"]').textContent,
      groups: [...top.querySelectorAll('[data-testid="about-credits-group"]')].map(g => ({
        kind: g.dataset.kind, title: g.querySelector('h2').textContent,
        items: [...g.querySelectorAll('[data-testid="about-credit"]')].map(i => ({
          id: i.dataset.id, name: i.querySelector('[data-testid="about-credit-name"]').textContent,
          license: (i.querySelector('[data-testid="about-credit-license"]') || {}).textContent || '',
          url: (i.querySelector('[data-testid="about-credit-url"]') || {}).textContent || '',
          toggle: (() => {
            const b = i.querySelector('[data-testid="about-credit-toggle"]');
            return { tag: b.tagName, expanded: b.getAttribute('aria-expanded'), aria: b.getAttribute('aria-label') };
          })(),
        })),
      })),
      links: top.querySelectorAll('a[href]').length,
    };
  });
  assert.equal(cv.intro, '拾字用到了下面这些开源的程序、数据和字体。谢谢它们的作者。', 'intro line');
  assert.deepEqual(cv.groups.map(g => [g.kind, g.title]), [['code', '程序'], ['data', '字形和字源'], ['font', '字体']], 'three groups in order');
  const shown = cv.groups.flatMap(g => g.items);
  const expected = ['code', 'data', 'font'].flatMap(k => credits.filter(c => c.kind === k));
  assert.deepEqual(shown.map(i => i.id), expected.map(c => c.id), 'items = credits.js (grouped, NOTICES order)');
  assert.deepEqual(shown.map(i => i.name), expected.map(c => (c.version ? `${c.name} ${c.version}` : c.name)), 'name + version');
  assert.deepEqual(shown.map(i => i.license), expected.map(c => c.license), 'license names');
  assert.deepEqual(shown.map(i => i.url), expected.map(c => c.url), 'upstream URLs as plain text');
  assert.equal(cv.links, 0, 'no outbound links (URLs are text only)');
  const names = shown.map(i => i.name.replace(/ [\d.]+$/, ''));
  for (const n of ['Preact', 'htm', 'Hanzi Writer', 'ts-fsrs']) assert.ok(names.includes(n), `lists ${n}`);
  assert.ok(shown.every(i => i.toggle.tag === 'BUTTON' && i.toggle.expanded === 'false' && /许可全文$/.test(i.toggle.aria)),
    'every 许可全文 toggle is a collapsed <button> with a per-item name');

  const preactSel = `${topSel('about-credit')}[data-id="${expected.find(c => c.name === 'Preact').id}"]`;
  await page.click(`${preactSel} ${tid('about-credit-toggle')}`);
  await page.waitForSelector(`${preactSel} ${tid('about-credit-text')}`);
  const pre = await page.evaluate(sel => {
    const item = document.querySelector(sel);
    return {
      expanded: item.querySelector('[data-testid="about-credit-toggle"]').getAttribute('aria-expanded'),
      open: item.dataset.open, text: item.querySelector('[data-testid="about-credit-text"]').textContent,
    };
  }, preactSel);
  const preactLicense = await page.evaluate(async () => (await (await fetch('/licenses/preact-LICENSE.txt')).text()).trim());
  assert.equal(pre.expanded, 'true', 'aria-expanded=true after tap');
  assert.equal(pre.open, 'true', 'item data-open');
  assert.ok(pre.text.includes('Preact is licensed under the MIT License'), 'expanded text has the NOTICES section');
  assert.ok(pre.text.includes(preactLicense), 'expanded text has licenses/preact-LICENSE.txt verbatim');
  // 最长的全文（htm Apache 2.0）也展开，查横向滚动
  const htmSel = `${topSel('about-credit')}[data-id="${expected.find(c => c.name === 'htm').id}"]`;
  await page.waitForTimeout(450);
  await page.click(`${htmSel} ${tid('about-credit-toggle')}`);
  await page.waitForSelector(`${htmSel} ${tid('about-credit-text')}`);
  assert.ok(await noHScroll(page), 'credits expanded (393): no horizontal scroll');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(100);
  assert.ok(await noHScroll(page), 'credits expanded (360×640): no horizontal scroll');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(450);
  await page.click(`${preactSel} ${tid('about-credit-toggle')}`);
  await page.waitForFunction(sel => !document.querySelector(sel + ' [data-testid="about-credit-text"]'), preactSel);
  assert.equal(await page.getAttribute(`${preactSel} ${tid('about-credit-toggle')}`, 'aria-expanded'), 'false', 'tap again collapses');

  assert.deepEqual((await page.evaluate(() => window.__shiziTest.getWriteLog())).slice(writesInSession).map(w => w.key), [],
    'no storage writes while browsing about pages (before reload)');

  // ------------------------------------------------------------ 5. 刷新停在子页
  ctx.step('reload on a sub-page restores it; back returns to about, then to the mine tab root');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitTop(page, 'about-credits');
  const writesAfterReload = await writeCount(page); // 启动本身的写入（如有）不算关于页的
  assert.ok(await page.$(topSel('about-credits-screen')), 'reload keeps 开源资料 · 致谢');
  await page.click(topSel('page-back'));
  await waitTop(page, 'about');
  assert.equal((await route(page)).depth, 1, 'back after reload → about');
  await page.click(topSel('page-back'));
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === 'mine';
  });
  await waitNavIdle(page);
  assert.equal((await route(page)).top, 'mine', 'about back → mine tab root');

  // ------------------------------------------------------------ 6. 给我们写信 + 不写入
  ctx.step('letter page: transitional note (P21); nothing written anywhere');
  await openAbout(page);
  await page.click(topSel('about-row-letter'));
  await waitTop(page, 'about-letter');
  const addr = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="about-letter-address"]');
    return { text: el.textContent, pending: el.dataset.pending };
  });
  const letterCopy = await page.evaluate(async () => (await import('/src/config/copy/index.js')).t('R-AB01.letterAddressPending'));
  assert.deepEqual(addr, { text: letterCopy, pending: 'P21' }, 'letter page shows the P21 transitional note');
  assert.ok(!/待补|TODO/i.test(addr.text), 'letter note is not a placeholder');
  const log = await page.evaluate(() => window.__shiziTest.getWriteLog());
  assert.deepEqual(log.slice(writesAfterReload).map(w => w.key), [], 'no storage writes while browsing about pages after reload');
  assert.deepEqual(await page.evaluate(() => window.__shiziTest.getState()), stateBefore, 'v2 state deep-equal');
}
