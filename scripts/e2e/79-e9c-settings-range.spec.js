// 阶段 1 E9c（D49 ④；03 P193）：「练习范围 / 更换字库」从字库页移到「我的 › 设置 › 练习」。
//
//   「练习范围」是「练习」组第一行：右侧「{库名} ›」；点开 → 换库页（复用现有换库流程与确认框）；换完回到设置并显示新库名，settings.library 写进去；
//   r7-L1（D60 覆盖 D49 ④）：字库页顶部又有「练习范围 …… 库名 ›」一行，推入的是同一个换库页、显示同一个值；换库后字库页的三档记忆状态不受影响（只影响之后的新字来源）。

import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CHARS = [...'永和春大中国人天地山水'];

function seed() {
  const records = { '2026-09': CHARS.map((c, i) => ({
    id: `r${i + 1}`, cardKey: `base:${c}`, char: c, sessionId: 's900', kind: 'judged', judgment: i % 3 === 0 ? 'wrong' : 'correct',
    at: new Date(`${TODAY}T08:${pad2(i)}:00`).getTime(), localDay: TODAY, help: { hints: 0, answerSeen: false, traced: false },
  })) };
  return { records };
}
const pad2 = n => (n < 10 ? `0${n}` : String(n));

async function zoneCounts(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="library-zone"]')].map(c => `${c.dataset.kind}:${c.dataset.n}`));
}

export default async function (page, ctx) {
  const { assert } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(async s => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock('2026-09-24T09:00:00');
    window.__shiziTest.seed(s);
    (await import('/src/ui/router.js')).nav.switchTab('library');
  }, seed());
  await page.waitForSelector(topSel('library-zone'));
  await waitNavIdle(page);
  ctx.step('the library page has the 练习范围 row (D60) with the same value as settings; no 「更换字库 ›」 text');
  assert.equal((await page.textContent(topSel('library-range-value'))).trim(), '规范常用字', 'range row value = the current library');
  assert.ok(!/更换字库/.test(await page.textContent(topSel('library-home'))), 'no 更换字库 text');
  const wallBefore = await zoneCounts(page);

  ctx.step('设置 › 练习 › 练习范围: first row of the group, shows the library name; opens the switch page; the switch returns to settings with the new name');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'mine');
  await waitNavIdle(page);
  await page.click(topSel('mine-menu-settings'));
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
  const rows = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const group = top.querySelector('[data-testid="settings-group"][data-group="practice"]');
    const first = group.querySelector('.sz-set__row');
    return {
      groupTitle: group.querySelector('[data-testid="settings-group-title"]').textContent.trim(), firstTestid: first.dataset.testid,
      text: first.innerText.replace(/\s+/g, ' ').trim(), lib: first.dataset.library, tag: first.tagName, h: first.getBoundingClientRect().height,
    };
  });
  assert.deepEqual([rows.groupTitle, rows.firstTestid, rows.lib, rows.tag], ['练习', 'settings-library', 'core3500', 'BUTTON'], 'the 练习 group starts with the 练习范围 row (a button)');
  assert.equal(rows.text, '练习范围 规范常用字', 'the row reads 练习范围 + the library name');
  assert.ok(rows.h >= 44, `the row is at least 44 high (${rows.h})`);
  await page.click(topSel('settings-library'));
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
  await page.click(`${topSel('libswitch-row')}[data-lib="rare"]`);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'settings');
  await waitNavIdle(page);
  assert.equal(await page.textContent(topSel('settings-library-value')), '规范专门用字', 'back in settings the row shows the new library');
  assert.equal(await page.getAttribute(topSel('settings-library'), 'data-library'), 'rare', 'data-library follows');
  assert.equal(await page.evaluate(() => window.__shiziTest.getState().settings.library), 'rare', 'settings.library written through the existing switch flow');

  ctx.step('the library page follows the switch: the range row shows the new library, the zones are unchanged');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  assert.equal((await page.textContent(topSel('library-range-value'))).trim(), '规范专门用字', 'one value, two places: the range row follows settings.library');
  assert.deepEqual(await zoneCounts(page), wallBefore, 'the three zones (records) are unchanged by switching the practice range');
}
