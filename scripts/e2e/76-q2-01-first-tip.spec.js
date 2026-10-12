// 阶段 1 Q2-1（复测 simB D2 / simC D12，实现交接 §3，03 P181）：首练第 1 字格下说明位的一次性提示「凭记忆写；想不起来，点下面的「提示」。」——
// 只在首练第 1 字出现一次，首次落笔 / 用提示 / 看答案后收起；出现即记 settings.firstTipSeen（经 store.commit），之后（包括刷新、下一次首练）不再出现。

import { bootTestHost, drawStroke, HORIZONTAL, openWrite, seedSession, topSel, waitNavIdle } from './helpers.mjs';

const TIP = '凭记忆写；想不起来，点下面的「提示」。';

async function tipText(page) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  }, topSel('write-first-tip'));
}

async function reopen(page, opts) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await seedSession(page, opts);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);
  await openWrite(page);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  step('全新安装走首练：第 1 字格下说明位出现一次性提示，位置在书写格下方的说明位，t13 墨三');
  await page.evaluate(() => { window.__shiziTest.reset(); window.__shiziTest.setClock('2026-10-05T09:41:00'); });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);
  await page.click('[data-testid="home-start"]');
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  assert.equal(await tipText(page), TIP, 'first char: the one-time tip');
  const geo = await page.evaluate(sel => {
    const tip = document.querySelector(sel);
    const grid = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    const cs = getComputedStyle(tip);
    const probe = document.createElement('span');
    probe.style.color = 'var(--ink3)';
    document.body.appendChild(probe);
    const ink3 = getComputedStyle(probe).color;
    probe.remove();
    return { below: tip.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom, size: cs.fontSize, color: cs.color, ink3 };
  }, topSel('write-first-tip'));
  assert.equal(geo.below, true, 'tip sits under the writing grid');
  assert.equal(geo.size, '13px', 't13');
  assert.equal(geo.color, geo.ink3, 'ink3');
  const st = await page.evaluate(() => window.__shiziTest.getState());
  assert.equal(st.settings && st.settings.firstTipSeen, true, 'settings.firstTipSeen recorded through store.commit when it appeared');

  step('首次落笔后收起；写完第 1 字到第 2 字不再出现');
  await drawStroke(page, HORIZONTAL);
  await page.waitForFunction(sel => !document.querySelector(sel), topSel('write-first-tip'));
  assert.equal(await tipText(page), null, 'gone after the first stroke');
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(450);
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => { const w = document.querySelector('.sz-layer[data-top="true"] .sz-write'); return !!w && w.dataset.cursor === '1' && w.dataset.phase === 'recall'; });
  assert.equal(await tipText(page), null, 'second char: no tip');

  step('已记过（firstTipSeen）：再开首练第 1 字不出现');
  await reopen(page, { kind: 'first', chars: ['尴', '赢', '拾'], extraState: { settings: { firstTipSeen: true } } });
  assert.equal(await tipText(page), null, 'seen before: no tip');

  step('没有记过：首练第 1 字出现；日常组第 1 字、首练第 2 字不出现；刷新后（已计为出现过）不再出现');
  await reopen(page, { kind: 'daily', chars: ['尴', '赢', '拾'] });
  assert.equal(await tipText(page), null, 'daily group: no tip');
  await reopen(page, { kind: 'first', chars: ['尴', '赢', '拾'], cursor: 1 });
  assert.equal(await tipText(page), null, 'first group, second char: no tip');
  await reopen(page, { kind: 'first', chars: ['尴', '赢', '拾'] });
  assert.equal(await tipText(page), TIP, 'first group, first char, never shown: tip');
  await page.reload();
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  assert.equal(await tipText(page), null, 'after a reload (it was already counted as shown): not again');
}
