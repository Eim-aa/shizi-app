// 交互合规（交互与动效规范 §8b，D58 ⑥；审计 P2-16；03 P294）—— 第 1 份：注册表与页面目录、逐页断言（前半）、手势判定、读屏 Z 形。
//   IC-00  router 注册表里的每个页面都在交互合规的页面目录里（新页面自动入列；没有进入方式的写进 CATALOG，开发页写明理由）
//   IC-01 / 02 / 03 / 09 / 10 / 20  逐页（scripts/e2e/ic-pages.mjs）
//   IC-05  左缘右滑判定：0.2 宽 v=0 回弹、0.4 宽完成、0.1 宽 v=600 完成
//   IC-08  shizi-native-escape 在没有弹层的子页上等于点左上（P0-16 归卡 I2：未修前按待修清单跳过并打印）
// 别的卡还没修的条目见 scripts/e2e/interaction-pending.mjs：命中时打印「pending P… skips IC-…」，不算通过也不算失败。
// 其余断言分在 102-interaction-compliance-pages2 / -overlays / -feedback / -write 几份里（每份 90s 上限）。

import { CATALOG, DEV_SCREENS, NATIVE_HOST_SCREENS, PRESS_MS, TOP, boot, enter, registeredScreens, seedRich, skipIfPending, snapshot, swipeBack, waitIdle } from './ic-lib.mjs';
import { checkPages } from './ic-pages.mjs';

export const PART1 = ['home', 'library', 'mine', 'write', 'result', 'library-list', 'library-all', 'library-switch', 'detail', 'detail-photo'];

export default async function interactionCompliance(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await boot(page, baseURL);
  const info = await seedRich(page);

  step('IC-00: every registered screen is in the interaction-compliance catalog (or a declared dev page)');
  const screens = await registeredScreens(page);
  const known = new Set(CATALOG.map(e => e.name));
  const missing = screens.filter(s => !known.has(s.name) && !DEV_SCREENS[s.name] && !NATIVE_HOST_SCREENS[s.name]).map(s => s.name);
  assert.deepEqual(missing, [], 'IC-00 registered screens without a catalog entry (add an entry to scripts/e2e/ic-lib.mjs CATALOG)');
  for (const e of CATALOG) assert.ok(screens.some(s => s.name === e.name), `IC-00 catalog entry ${e.name} is a registered screen`);
  for (const s of screens.filter(x => known.has(x.name))) assert.equal(s.tab, !!CATALOG.find(e => e.name === s.name).tab, `IC-00 ${s.name} tab flag`);

  await checkPages(page, ctx, info, PART1);

  step('IC-05: swipe-back thresholds (0.2 w at rest springs back; 0.4 w commits; 0.1 w at 600 pt/s commits)');
  const settings = CATALOG.find(e => e.name === 'remind');
  await enter(page, settings, info);
  await swipeBack(page, { to: 0.2, velocity: 0 });
  await waitIdle(page, null, 300);
  assert.equal((await snapshot(page)).top, 'remind', 'IC-05 0.2 w, v = 0: springs back, still on remind');
  assert.equal(await page.evaluate(t => document.querySelector(t).style.transform || '', TOP), '', 'IC-05 the page is back in place');
  await swipeBack(page, { to: 0.4, velocity: 0 });
  await waitIdle(page, 'home');
  assert.equal((await snapshot(page)).top, 'home', 'IC-05 0.4 w, v = 0: commits');
  await enter(page, settings, info);
  await swipeBack(page, { to: 0.1, velocity: 600 });
  await waitIdle(page, 'home');
  assert.equal((await snapshot(page)).top, 'home', 'IC-05 0.1 w, v = 600: a flick commits');

  step('IC-08: shizi-native-escape with no overlay on a sub page = tapping 「‹」');
  await enter(page, settings, info);
  await page.waitForTimeout(PRESS_MS);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
  await page.waitForTimeout(400);
  await waitIdle(page);
  const esc = await snapshot(page);
  if (esc.top === 'remind') {
    if (!skipIfPending('IC-08', {}, 'remind: Z gesture did nothing')) assert.equal(esc.top, 'home', 'IC-08 Z gesture / Esc goes back like 「‹」');
  } else {
    assert.equal(esc.top, 'home', 'IC-08 Z gesture / Esc goes back like 「‹」');
  }
}
