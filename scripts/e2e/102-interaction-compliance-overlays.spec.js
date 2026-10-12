// 交互合规（交互与动效规范 §8b）—— 第 3 份：弹层。
//   IC-06  弹层开着时左缘右滑只作用于最上层弹层：跟手（弹层位移、页面不动），松手过阈值关掉、页面栈不变；短拖回弹（P1-06）
//   IC-07  每个弹层：有可见的「完成」或 data-dismiss=own 的取消；点遮罩、Esc、shizi-native-escape、左缘右滑、下滑（底部弹层）各自关闭、结果相同
//   IC-16  每个进场都有退场：关闭过程中退场余影（.sz-exit）至少 2 帧处在动画中途（P1-07）
//   N4 门控：Tab 根上的弹层同样能左缘右滑关（首页「自己选字」、字库）

import { PRESS_MS, TOP, boot, enter, CATALOG, seedRich, skipIfPending, snapshot, swipeBack, toRoot, waitIdle } from './ic-lib.mjs';

/** 弹层目录：在哪一页、怎么打开、是底部弹层还是确认框。 */
const OVERLAYS = [
  { id: 'query (tab root)', page: 'home', open: 'home-pick', sel: '[data-testid="query-sheet"]', sheet: true, tabRoot: true },
  { id: 'all-menu', page: 'library-all', open: 'all-menu-open', sel: '[data-testid="all-menu"]', sheet: true },
  { id: 'appearance', page: 'settings', open: 'settings-appearance', sel: '[data-testid="settings-appearance-sheet"]', sheet: true },
  { id: 'write-mode', page: 'settings', open: 'settings-writemode', sel: '[data-testid="settings-writemode-sheet"]', sheet: true },
  // 月字帖「保存图片」改为一次点击直存（I3 P0-04），图片预览弹层从旁边的「调整…」打开
  { id: 'image-preview', page: 'month', open: 'month-adjust', sel: '[data-testid="image-sheet"]', sheet: true },
  // 清空确认改为居中确认框（I3，components/Confirm.js）；换库不再有确认框（I3 P1-19：不丢东西就不确认）
  { id: 'backup-clear', page: 'backup', open: 'backup-clear', sel: '[data-testid="backup-clear-sheet"]', sheet: false },
];

const EXITS = ['scrim', 'esc', 'native-escape', 'edge-swipe', 'swipe-down'];

async function openOverlay(page, o, info) {
  await enter(page, CATALOG.find(e => e.name === o.page), info);
  await page.waitForTimeout(PRESS_MS);
  const loc = page.locator(`${TOP} [data-testid="${o.open}"]`);
  await (o.pick === 'last' ? loc.last() : loc.first()).click();
  await page.waitForSelector(`${TOP} .sz-overlay:not(.sz-exit) ${o.sel}`, { timeout: 15000 });
  await page.waitForTimeout(PRESS_MS);
}

const isOpen = (page, o) => page.evaluate(([t, s]) => !!document.querySelector(`${t} .sz-overlay:not(.sz-exit) ${s}`), [TOP, o.sel]);

/** 关闭过程中采样退场余影：返回处在动画中途的帧数（IC-16）。 */
function watchExit(page) {
  return page.evaluate(() => new Promise(resolve => {
    let mid = 0;
    let frames = 0;
    let seen = false;
    const tick = () => {
      frames += 1;
      const exits = [...document.querySelectorAll('.sz-exit')];
      if (exits.length) seen = true;
      const running = exits.flatMap(el => el.getAnimations({ subtree: true }))
        .map(a => a.effect && a.effect.getComputedTiming().progress)
        .some(p => typeof p === 'number' && p > 0 && p < 1);
      if (running) mid += 1;
      if ((seen && !exits.length) || frames > 90) resolve({ mid, seen });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

async function close(page, o, how) {
  if (how === 'scrim') {
    await page.mouse.click(8, 60);
  } else if (how === 'esc') {
    await page.keyboard.press('Escape');
  } else if (how === 'native-escape') {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
  } else if (how === 'edge-swipe') {
    await swipeBack(page, { to: 0.5 });
  } else if (how === 'swipe-down') {
    const box = await page.locator(`${TOP} .sz-overlay:not(.sz-exit) .sz-sheet`).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + 30;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) {
      await page.mouse.move(x, y + (box.height * 0.5 * i) / 8);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
}

export default async function interactionComplianceOverlays(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await boot(page, baseURL);
  const info = await seedRich(page);

  for (const o of OVERLAYS) {
    step(`IC-07 / IC-16 ${o.id}`);
    await openOverlay(page, o, info);
    const base = await page.evaluate(([t, s]) => {
      const root = document.querySelector(`${t} .sz-overlay:not(.sz-exit)`);
      return {
        done: !!root.querySelector('[data-testid="sheet-done"], [data-testid$="-done"]'),
        own: !!root.querySelector(`${s}[data-dismiss="own"], [data-dismiss="own"]`) || !!root.querySelector('[role="alertdialog"]'),
      };
    }, [TOP, o.sel]);
    assert.ok(base.done || base.own, `IC-07 ${o.id}: a visible 「完成」 or its own cancel (N4 ①)`);
    // 关掉之后应当回到的状态（以「完成」/ 自己的取消为准：先记下打开前的页面栈）
    const before = await snapshot(page);
    const expect = before.stack.replace(/ > o:[^>]+$/, '');
    for (const how of EXITS) {
      if (how === 'swipe-down' && !o.sheet) continue;
      if (!(await isOpen(page, o))) await openOverlay(page, o, info);
      const watching = watchExit(page);
      await close(page, o, how);
      await page.waitForTimeout(80);
      if (await isOpen(page, o)) {
        if (how === 'esc' && skipIfPending('IC-07', { exits: ['esc'] }, `${o.id}: Esc`)) {
          await page.keyboard.press('Escape').catch(() => {});
          continue;
        }
        assert.ok(false, `IC-07 ${o.id}: ${how} closes the overlay`);
      }
      const ex = await watching;
      await waitIdle(page, null, 60);
      const after = await snapshot(page);
      assert.equal(after.stack, expect, `IC-07 ${o.id}: ${how} closes only the overlay, the page stack is unchanged`);
      assert.ok(ex.seen && ex.mid >= 2, `IC-16 ${o.id}: ${how} has an exit (${ex.mid} frames mid-animation)`);
    }
  }

  step('IC-06: edge swipe on an open sheet follows the sheet, the page never moves; a short drag springs back');
  const ap = OVERLAYS.find(o => o.id === 'appearance');
  await openOverlay(page, ap, info);
  await swipeBack(page, { to: 0.3, phases: ['began', 'changed'] });
  const mid = await page.evaluate(t => {
    const layer = document.querySelector(t);
    const panel = layer.querySelector('.sz-overlay:not(.sz-exit) .sz-sheet');
    return { panel: panel ? panel.style.transform : '', layer: layer.style.transform || '', nav: document.querySelector('.sz-app').dataset.navAnim };
  }, TOP);
  assert.ok(/translateX\(\d/.test(mid.panel), `IC-06 the sheet follows the finger (${mid.panel})`);
  assert.equal(mid.layer, '', 'IC-06 the page underneath does not move');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'ended', translationX: window.innerWidth * 0.1, progress: 0.1, velocityX: 0 } })));
  await page.waitForTimeout(400);
  assert.equal(await isOpen(page, ap), true, 'IC-06 a short drag springs back: still open');
  assert.equal((await snapshot(page)).top, 'settings', 'IC-06 the page stack is unchanged');
  const back = await page.evaluate(t => document.querySelector(`${t} .sz-overlay:not(.sz-exit) .sz-sheet`).style.transform, TOP);
  assert.equal(back, '', 'IC-06 the sheet is back in place after the spring-back');

  step('N4 gate: an overlay over a tab root can be swiped away (P1-06)');
  await toRoot(page, 'home');
  const gate = await page.evaluate(async () => {
    const { backGestureAllowed, getRouter } = await import('/src/ui/router.js');
    return backGestureAllowed(getRouter().getState());
  });
  assert.equal(gate, false, 'tab root without an overlay: gate closed');
  await openOverlay(page, OVERLAYS[0], info);
  const gateOpen = await page.evaluate(async () => {
    const { backGestureAllowed, getRouter } = await import('/src/ui/router.js');
    return backGestureAllowed(getRouter().getState());
  });
  assert.equal(gateOpen, true, 'tab root with an overlay: gate open (N4)');
  const edge = await page.evaluate(() => !!document.querySelector('.sz-app > .sz-edge'));
  assert.equal(edge, true, 'the web fallback edge strip is drawn over a tab-root overlay');
}
