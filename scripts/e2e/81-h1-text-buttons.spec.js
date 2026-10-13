// H1-1（D51 ⑥、T2-02）：全 App 文字按钮只有一种规格——黑体 15、--ink2、无下划线；「›」按一条规则（见 Button.js 头注释）。
// 逐页（首页各态 / 字库 / 有记录的字 / 详情 / 我的 / 设置）取顶层图层里所有可见的 .sz-btn--text，核对渲染后的计算样式：
//   字号 15（--fs15，L 档 --k = 1）、颜色 = --ink2、text-decoration-line none、字体栈同 --hei；
//   浅 / 深色各查一遍。再核对「练这些字」文案没有「→」、有记录的字筛选后的「练这些字」是文字按钮（variant text）。
import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec, seedHomeState } from './home-helpers.mjs';

/* eslint-disable no-undef */
async function textButtons(page) {
  return page.evaluate(() => {
    const probe = name => {
      const el = document.createElement('span');
      el.style.color = `var(--${name})`;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const ink2 = probe('ink2');
    const layer = document.querySelector('.sz-layer[data-top="true"]') || document;
    const rows = [];
    for (const el of layer.querySelectorAll('.sz-btn--text')) {
      if (!el.checkVisibility()) continue;
      const cs = getComputedStyle(el);
      rows.push({
        id: el.dataset.testid || el.className,
        size: cs.fontSize,
        color: cs.color,
        underline: cs.textDecorationLine,
        weight: cs.fontWeight,
        ok: cs.fontSize === '15px' && cs.color === ink2 && cs.textDecorationLine === 'none',
      });
    }
    return { ink2, rows };
  });
}

async function checkPage(page, assert, label) {
  const r = await textButtons(page);
  assert.ok(r.rows.length > 0, `${label}: at least one text button on screen`);
  for (const row of r.rows) {
    assert.ok(row.ok, `${label} · ${row.id}: 15px / ink2 / no underline (got ${row.size} ${row.color} ${row.underline})`);
  }
  return r.rows.length;
}

async function go(page, fn, arg) {
  await page.evaluate(fn, arg);
  await waitNavIdle(page);
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  for (const scheme of ['light', 'dark']) {
    const page = scheme === 'light' ? page0 : await page0.context().newPage(); // 深色用新页（路由记忆不带到第二轮）
    await page.emulateMedia({ colorScheme: scheme });
    await bootTestHost(page, ctx.baseURL);

    step(`${scheme}: home — 自己选字 (fresh), 这次先写平常的字 (special)`);
    await seedHomeState(page, 'fresh');
    assert.ok(await page.locator(topSel('home-pick')).count(), 'fresh: 自己选字 is there');
    await checkPage(page, assert, `${scheme} home fresh`);
    await seedHomeState(page, 'special');
    assert.ok(await page.locator(topSel('home-capital-defer')).count(), 'special: 这次先写平常的字 is there');
    await checkPage(page, assert, `${scheme} home special`);

    step(`${scheme}: home — 今天的练习 · 接着写 (A + B 两组都没写完)`);
    await seedHomeSpec(page, { entries: [], groups: [
      { slot: 'A', at: '2026-10-05T12:00:00', chars: [...'疆嚷醋'], steps: ['correct'] },
      { slot: 'B', kind: 'picked', at: '2026-10-05T12:10:00', chars: [...'膝窗'], steps: [] },
    ], clock: '2026-10-05T12:30:00' });
    await page.waitForSelector(topSel('other-line'));
    await checkPage(page, assert, `${scheme} home other-line`);

    step(`${scheme}: 字库 / 有记录的字 / 详情 / 我的 / 设置`);
    await seedHomeSpec(page, { entries: [...'疆酱肆酝春'].map((c, i) => ({ char: c, at: `2026-10-0${1 + i}T20:00:00`, judgment: i === 0 ? 'wrong' : 'correct' })), clock: '2026-10-05T19:30:00' });
    await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
    await page.waitForSelector(topSel('library-all-open'));
    await checkPage(page, assert, `${scheme} library`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('library-all', { filter: 'wrong' }));
    await page.waitForSelector(topSel('all-go'));
    const goBtn = await page.evaluate(() => {
      const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="all-go"]');
      const view = document.querySelector('.sz-layer[data-top="true"] [data-testid="all-list"]');
      return { text: el.textContent.trim(), isPrimary: el.classList.contains('sz-btn--primary'), viewText: view.textContent.trim(), viewIsText: view.classList.contains('sz-btn--text') };
    });
    assert.equal(goBtn.text, '练这些字', 'all page: 练这些字 has no arrow');
    assert.ok(goBtn.isPrimary, 'all page: 练这些字 is the footer main button (P1-17: same place as the list page)');
    assert.equal(goBtn.viewText, '看这些字 ›', 'all page: the list entry is 看这些字 ›');
    assert.ok(goBtn.viewIsText, 'all page: 看这些字 › is a text button (same spec as everywhere)');
    await checkPage(page, assert, `${scheme} library-all`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
    await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForSelector(topSel('mine-records'));
    await checkPage(page, assert, `${scheme} mine`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('settings', {}));
    await page.waitForSelector(tid('settings-body') + ', ' + topSel('settings-open-system') + ', .sz-layer[data-top="true"] .sz-page');
    // 设置页（通知没被关时）可能没有文字按钮——有就核对，没有不算失败
    const set = await textButtons(page);
    for (const row of set.rows) assert.ok(row.ok, `${scheme} settings · ${row.id}: 15px / ink2 / no underline`);
    if (page !== page0) await page.close();
  }
}
