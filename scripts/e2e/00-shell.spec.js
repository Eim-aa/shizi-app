// M0-4 完成定义：三 tab 切换；三次推入子页 → 三次系统返回（page.goBack）→ 回到 tab 根且不离开页面；
// 键盘 Tab 可达三 tab；遮罩栈、原生返回事件、防连点、减少动态效果、刷新恢复。控制台零错误由 run.mjs 统一断言。
// 演示子页（src/ui/screens/_demo/sub.js）只在 ?test=1 的 localhost 主机加载。

const TABS = ['home', 'library', 'mine'];
const tid = id => `[data-testid="${id}"]`;

async function idle(page) {
  await page.waitForFunction(() => {
    const app = document.querySelector('.sz-app');
    return !!app && app.dataset.navAnim === 'idle';
  });
  await page.waitForTimeout(450); // 新页面 / 新状态后 0.4s 按钮不响应（01 §6.6）
}

async function nav(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.sz-app');
    const s = history.state;
    return {
      top: app.dataset.topScreen,
      tab: app.dataset.tab,
      domDepth: Number(app.dataset.depth),
      depth: s ? s.depth : null,
      names: s ? s.stack.map(e => e.n) : null,
      length: history.length,
      href: location.href,
      alive: window.__e2eAlive === true,
    };
  });
}

async function topHas(page, testid) {
  return page.locator(`.sz-layer[data-top="true"] ${tid(testid)}`).isVisible();
}

async function animLog(page) {
  return page.evaluate(() => window.__animLog.slice());
}

async function installAnimLog(page) {
  await page.evaluate(() => {
    window.__animLog = [];
    const app = document.querySelector('.sz-app');
    new MutationObserver(() => {
      const v = app.dataset.navAnim;
      if (window.__animLog[window.__animLog.length - 1] !== v) window.__animLog.push(v);
    }).observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  });
}

export default async function shell(page, ctx) {
  const { assert } = ctx;
  const url = `${ctx.baseURL}/?test=1`;

  ctx.step('boot');
  await page.goto(url);
  await page.waitForSelector('.sz-app');
  await idle(page);
  await page.evaluate(() => { window.__e2eAlive = true; });
  await installAnimLog(page);
  let s = await nav(page);
  const baseLength = s.length;
  const baseHref = s.href;
  assert.equal(s.top, 'home', 'starts on the 习字 tab root');
  assert.equal(s.depth, 0, 'history.state.depth is 0 at the tab root');
  assert.deepEqual(s.names, ['home'], 'history.state carries the stack snapshot');
  assert.equal(await page.locator(`${tid('tab-home')}[aria-selected="true"]`).count(), 1, 'tab-home is aria-selected');
  assert.equal(await page.locator('[role="tablist"] [role="tab"]').count(), 3, 'tablist has three role=tab buttons');
  assert.equal(await page.locator(`.sz-layer[data-top="true"] ${tid('page-back')}`).count(), 0, 'tab root has no back button');

  ctx.step('switch tabs by click');
  for (const name of ['library', 'mine', 'home']) {
    await page.click(tid(`tab-${name}`));
    await idle(page);
    s = await nav(page);
    assert.equal(s.top, name, `click tab-${name} shows ${name}`);
    assert.ok(await topHas(page, `screen-${name}`), `screen-${name} is visible`);
    assert.equal(await page.locator(`${tid(`tab-${name}`)}[aria-selected="true"]`).count(), 1, `tab-${name} is aria-selected`);
    for (const other of TABS.filter(t => t !== name)) {
      assert.equal(await page.locator(tid(`screen-${other}`)).count(), 0, `screen-${other} is not rendered`);
    }
    assert.equal(s.depth, 0, 'tab switch stays at depth 0');
    assert.equal(s.length, baseLength, 'tab switch uses replaceState (history.length unchanged)');
  }

  ctx.step('keyboard: Tab reaches all three tabs; Enter/arrow keys switch');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const reached = new Set();
  for (let i = 0; i < 12 && reached.size < 3; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    if (id && id.startsWith('tab-')) reached.add(id);
  }
  assert.deepEqual([...reached].sort(), ['tab-home', 'tab-library', 'tab-mine'], 'Tab key focuses tab-home, tab-library and tab-mine');
  await page.focus(tid('tab-home'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-testid')), 'tab-library', 'ArrowRight moves focus to tab-library');
  await page.keyboard.press('Enter');
  await idle(page);
  assert.equal((await nav(page)).top, 'library', 'Enter on tab-library switches tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-testid')), 'tab-library', 'focus stays on the selected tab');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await idle(page);
  assert.equal((await nav(page)).top, 'home', 'ArrowLeft + Enter goes back to 习字');

  ctx.step('push three sub pages');
  await page.click(tid('demo-push'));
  await idle(page);
  for (let level = 1; level <= 3; level += 1) {
    if (level > 1) {
      await page.click(`.sz-layer[data-top="true"] ${tid('demo-push-next')}`);
      await idle(page);
    }
    s = await nav(page);
    assert.equal(s.depth, level, `after push #${level} history.state.depth is ${level}`);
    assert.equal(s.domDepth, level, `root reports depth ${level}`);
    assert.ok(await topHas(page, `screen-demo-${level}`), `demo sub page ${level} is visible on top`);
    assert.equal(s.length, baseLength + level, `push #${level} added one history entry`);
  }
  assert.equal(await page.locator(`.sz-layer[data-top="true"] ${tid('page-back')}`).count(), 1, 'sub page has a back button');
  const headerBox = await page.locator('.sz-layer[data-top="true"] .sz-page__head').boundingBox();
  assert.ok(headerBox && headerBox.height >= 44, 'sub page header is at least 44px tall');
  assert.equal(await page.locator('.sz-layer[data-top="true"] [role="tablist"]').count(), 0, 'sub page has no tab bar');
  assert.ok((await animLog(page)).includes('push-slide'), 'push runs the slide transition');

  ctx.step('three system back (page.goBack) return to the tab root without leaving the page');
  for (let level = 2; level >= 0; level -= 1) {
    await page.goBack();
    await idle(page);
    s = await nav(page);
    assert.equal(s.depth, level, `after goBack history.state.depth is ${level}`);
    assert.equal(s.top, level === 0 ? 'home' : '_demo/sub', `top screen is ${level === 0 ? 'home' : `demo ${level}`}`);
    if (level > 0) assert.ok(await topHas(page, `screen-demo-${level}`), `demo sub page ${level} is visible again`);
  }
  assert.ok(s.alive, 'same document (no reload / no navigation away)');
  assert.equal(s.href, baseHref, 'URL unchanged');
  assert.ok(await topHas(page, 'screen-home'), '习字 tab root is visible');
  assert.equal(await page.locator(`${tid('tab-home')}[aria-selected="true"]`).count(), 1, 'tab-home still selected');
  assert.ok((await animLog(page)).includes('pop-slide'), 'system back runs the pop transition (not standalone)');
  const backFocus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  assert.equal(backFocus, 'demo-push', 'focus returns to the control that opened the sub page');

  ctx.step('tab root does not go back (native back event is a no-op, page not left)');
  await page.evaluate(() => window.dispatchEvent(new Event('shizi-native-back')));
  await page.waitForTimeout(300);
  await idle(page);
  s = await nav(page);
  assert.equal(s.depth, 0, 'native back at tab root keeps depth 0');
  assert.ok(s.alive && s.href === baseHref, 'native back at tab root does not leave the page');

  ctx.step('UI back button and native back event pop one page');
  await page.click(tid('demo-push'));
  await idle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('page-back')}`);
  await idle(page);
  assert.equal((await nav(page)).depth, 0, 'page back button (history.back) returns to root');
  await page.click(tid('demo-push'));
  await idle(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-back')));
  await idle(page);
  assert.equal((await nav(page)).depth, 0, 'shizi-native-back pops one page');

  ctx.step('0.4s double-press guard');
  await page.dblclick(tid('demo-push'));
  await idle(page);
  s = await nav(page);
  assert.equal(s.depth, 1, 'double click pushes only one page');
  await page.goBack();
  await idle(page);

  ctx.step('overlay stack: confirm / sheet close before pages');
  await page.click(tid('demo-push'));
  await idle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('demo-open-confirm')}`);
  await idle(page);
  s = await nav(page);
  assert.ok(await page.locator(tid('demo-confirm')).isVisible(), 'confirm dialog is open');
  assert.equal(await page.locator(`${tid('demo-confirm')}[role="alertdialog"][aria-modal="true"]`).count(), 1, 'confirm has role=alertdialog aria-modal');
  assert.equal(s.depth, 2, 'overlay takes one history entry');
  assert.equal(s.top, '_demo/sub', 'overlay does not change the top page');
  const confirmFocus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  assert.equal(confirmFocus, 'demo-confirm', 'focus is on the dialog itself (no preselected button)');
  await page.goBack();
  await idle(page);
  s = await nav(page);
  assert.equal(await page.locator(tid('demo-confirm')).count(), 0, 'system back closes the confirm first');
  assert.equal(s.depth, 1, 'depth back to 1 after closing overlay');
  assert.ok(await topHas(page, 'screen-demo-1'), 'page under the overlay is still there');
  await page.click(`.sz-layer[data-top="true"] ${tid('demo-open-confirm')}`);
  await idle(page);
  await page.click(tid('confirm-ok'));
  await idle(page);
  assert.equal(await page.locator(tid('demo-confirm')).count(), 0, 'confirm button closes via router');
  assert.equal((await nav(page)).depth, 1, 'depth 1 after confirm');

  await page.click(`.sz-layer[data-top="true"] ${tid('demo-open-sheet')}`);
  await idle(page);
  assert.ok(await page.locator(tid('demo-sheet')).isVisible(), 'sheet is open');
  await page.click(tid('demo-sheet-push'));
  await idle(page);
  s = await nav(page);
  assert.equal(s.depth, 3, 'push over an open sheet adds an entry');
  assert.ok(await topHas(page, 'screen-demo-2'), 'page pushed over the sheet is on top');
  assert.equal(await page.locator(tid('demo-sheet')).isVisible(), false, 'sheet is hidden under the pushed page');
  await page.goBack();
  await idle(page);
  assert.ok(await page.locator(tid('demo-sheet')).isVisible(), 'back from the pushed page shows the sheet again');
  await page.keyboard.press('Escape');
  await idle(page);
  s = await nav(page);
  assert.equal(await page.locator(tid('demo-sheet')).count(), 0, 'Escape closes the sheet');
  assert.equal(s.depth, 1, 'depth 1 after Escape');

  ctx.step('toast and undo bar');
  await page.click(`.sz-layer[data-top="true"] ${tid('demo-toast')}`);
  const toast = page.locator(tid('toast'));
  assert.ok(await toast.isVisible(), 'toast is visible');
  assert.equal(await page.locator(`${tid('toast-host')}[role="status"][aria-live="polite"]`).count(), 1, 'toast host is a polite live region');
  await page.click(`.sz-layer[data-top="true"] ${tid('demo-undo')}`);
  assert.ok(await page.locator(tid('undo-bar')).isVisible(), 'undo bar is visible');
  await page.click(tid('undo-button'));
  assert.equal((await page.locator(tid('undo-bar')).innerText()).trim(), '已撤销', 'undo bar switches to 已撤销');

  ctx.step('native back gesture progress');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'began', translationX: 10, progress: 0.03 } }));
    window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'changed', translationX: 120, progress: 0.3 } }));
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.navAnim === 'drag');
  const dragTransform = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"]').style.transform);
  assert.equal(dragTransform, 'translateX(120px)', 'top page follows translationX');
  assert.ok(await page.locator(tid('screen-home')).isVisible(), 'page underneath is revealed while dragging');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'cancelled', translationX: 0, progress: 0 } })));
  await idle(page);
  assert.equal((await nav(page)).depth, 1, 'cancelled gesture keeps the page');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'changed', translationX: 200, progress: 0.5 } }));
    window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'ended', translationX: 200, progress: 0.5 } }));
    window.dispatchEvent(new Event('shizi-native-back'));
  });
  await idle(page);
  assert.equal((await nav(page)).depth, 0, 'ended gesture + shizi-native-back pops the page');

  ctx.step('prefers-reduced-motion: cross-fade instead of slide');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { window.__animLog.length = 0; });
  await page.click(tid('demo-push'));
  await idle(page);
  await page.goBack();
  await idle(page);
  const reducedLog = await animLog(page);
  assert.ok(reducedLog.includes('push-fade') && reducedLog.includes('pop-fade'), 'reduced motion uses fade for push and pop');
  assert.ok(!reducedLog.includes('push-slide') && !reducedLog.includes('pop-slide'), 'reduced motion never slides');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  ctx.step('reload restores the page stack; open overlays are dropped');
  await page.click(tid('demo-push'));
  await idle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('demo-push-next')}`);
  await idle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('demo-open-confirm')}`);
  await idle(page);
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => history.state && history.state.depth === 2);
  await idle(page);
  s = await nav(page);
  assert.equal(s.top, '_demo/sub', 'reload keeps the sub page');
  assert.ok(await topHas(page, 'screen-demo-2'), 'demo sub page 2 restored');
  assert.equal(await page.locator('[role="alertdialog"]').count(), 0, 'overlay open before reload is not restored');
  await page.goBack();
  await idle(page);
  await page.goBack();
  await idle(page);
  s = await nav(page);
  assert.equal(s.depth, 0, 'back twice after reload reaches the tab root');
  assert.equal(s.top, 'home', '习字 tab root after reload + back');
  assert.equal(s.href, baseHref, 'still on the app URL');
}
