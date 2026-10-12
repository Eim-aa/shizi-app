// 本文件：第 3–5 部分（弹层、结果页出口、撤销跟人走、Tab 滚动）。
// R5-I2（交互规范 §1 N / §4 G / §7 读屏；D58 ①④；审计 P0-01 / P0-02 / P0-16 / P1-01 – P1-06 / P1-09 / P1-11 / P2-17 / P2-18 / P2-19）
// 「左上就是返回，左缘右滑就是点左上」逐页逐阶段验收（规范 §8b IC-01 / IC-02 / IC-03 / IC-04 / IC-06 / IC-08 / IC-19 的导航部分）：
//   1. 写字页每一个阶段（回忆有墨 / 提示给出 / 看答案 / 描一遍 / 自己写 / 判断 / 纸上写的判断）：左上元素存在、可见、≥ 44；登记的返回动作是函数；
//      所有阶段「‹」x 相同；A 分支点左上、B 分支派发原生左缘进度（began → changed 0.5 宽 → ended v=0），结束状态逐项相同；
//      判断阶段 B 分支回到回忆、笔数不变、栈深度不变（页内回退），拖动中是 T-phase 倒放（上格放大、参考格淡出，下层页不露出）；
//   2. 每个注册的非 tab 页面（router.listScreens，新页面自动入列）：同上 A / B，外加读屏 escape（shizi-native-escape）与 Esc 等同点左上；
//   3. 弹层：tab 根上的弹层左缘右滑可用（只关弹层，栈不变）；Esc / 两指 Z 形关确认框时执行它自己的「取消」；
//   4. tab 根上 escape 什么都不做；结果页「×」回 tab 来源有转场（与右滑一致）；B3 进来的结果页出场也是 B3；「再写一组」只有一段转场；
//   5. 跳过后 5 秒内离开写字页，撤销条跟到来源页；Tab 各自记住滚动位置，再点当前 Tab 回顶部。
// 控制台零错误由 run.mjs 统一断言。

import { bootTestHost, drawStroke, HORIZONTAL, seedSession, tap, tid, topSel, waitNavIdle } from './helpers.mjs';
import {
  CHARS, leadInfo, nativeSwipe, navState, openWritePhase, phaseDrag, push, settle, tapLead, toHome, WRITE_PHASES,
} from './i2-helpers.mjs';

/* eslint-disable no-unused-vars */
export default async function i2OverlayExit(page, ctx) {
  const { assert, step } = ctx;
  step('boot (test host)');
  await bootTestHost(page, ctx.baseURL);
  let s;
  let anims;
  // ------------------------------------------------------------ 3. 弹层
  step('tab root: escape does nothing; an overlay on the tab root can be swiped away (N4 gate, P1-06)');
  await toHome(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
  await settle(page);
  assert.deepEqual((await navState(page)).names, ['home'], 'tab root: escape is a no-op');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    const { Confirm } = await import('/src/ui/components/Confirm.js');
    window.__cancelled = 0;
    const id = nav.openOverlay(Confirm, {
      title: 'x', body: 'y', cancelLabel: 'a', confirmLabel: 'b', testid: 'i2-confirm',
      onCancel: () => { window.__cancelled += 1; nav.closeOverlay(id); },
      onConfirm: () => nav.closeOverlay(id),
    });
  });
  await page.waitForSelector(tid('i2-confirm'));
  await settle(page);
  const strip = await page.evaluate(() => !!document.querySelector('.sz-app > .sz-edge'));
  assert.equal(strip, true, 'web edge strip present while an overlay is on top of the tab root');
  await nativeSwipe(page, { frac: 0.5 });
  await settle(page);
  s = await navState(page);
  assert.deepEqual([s.names, s.overlay], [['home'], false], 'swipe closed the overlay only');
  assert.equal(await page.evaluate(() => window.__cancelled), 1, 'closing by swipe ran the dialog\'s own cancel (P2-17)');

  step('Esc / two-finger Z on a confirm dialog run its own cancel (P2-17)');
  for (const how of ['escape-key', 'native-escape']) {
    await page.evaluate(async () => {
      const { nav } = await import('/src/ui/router.js');
      const { Confirm } = await import('/src/ui/components/Confirm.js');
      window.__cancelled = 0;
      const id = nav.openOverlay(Confirm, {
        title: 'x', body: 'y', cancelLabel: 'a', confirmLabel: 'b', testid: 'i2-confirm',
        onCancel: () => { window.__cancelled += 1; nav.closeOverlay(id); },
        onConfirm: () => nav.closeOverlay(id),
      });
    });
    await page.waitForSelector(tid('i2-confirm'));
    await settle(page);
    if (how === 'escape-key') await page.keyboard.press('Escape');
    else await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
    await settle(page);
    assert.equal(await page.evaluate(() => window.__cancelled), 1, `${how}: the dialog's own cancel ran`);
    assert.deepEqual((await navState(page)).names, ['home'], `${how}: overlay closed, page stays`);
  }

  // ------------------------------------------------------------ 4. 结果页出口
  const finishGroup = async () => {
    await toHome(page);
    await seedSession(page, { slot: 'A', kind: 'daily', chars: ['永'], cursor: 0 });
    await push(page, 'write', { slot: 'A' }); // 没有来源按钮：B3 进
    await drawStroke(page, HORIZONTAL);
    await tap(page, 'write-done');
    await tap(page, 'write-judge-correct');
    await page.waitForSelector(topSel('result-screen'));
    await settle(page);
  };
  const watchAnims = () => page.evaluate(() => {
    window.__anims = [];
    const app = document.querySelector('.sz-app');
    new MutationObserver(() => {
      const v = app.dataset.navAnim;
      if (window.__anims[window.__anims.length - 1] !== v) window.__anims.push(v); // 同值重写不算一段新转场
    }).observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  });

  step('result 「×」 back to the tab root animates (P1-01); entered by B3 → leaves by B3 (P1-02)');
  await finishGroup();
  await watchAnims();
  await page.click(topSel('page-back'));
  await settle(page);
  anims = await page.evaluate(() => window.__anims.filter(a => a !== 'idle'));
  assert.deepEqual((await navState(page)).names, ['home'], 'back home');
  assert.deepEqual(anims, ['pop-quiet'], `× animates with the reverse of how the write page came in (B3) (${anims.join(' → ')})`);

  step('result swipe = 「×」: same B3 path, followed by the finger');
  await finishGroup();
  await watchAnims();
  await nativeSwipe(page, { frac: 0.5 });
  await settle(page);
  anims = await page.evaluate(() => window.__anims.filter(a => a !== 'idle'));
  assert.deepEqual((await navState(page)).names, ['home'], 'back home');
  assert.ok(anims.includes('pop-quiet'), `swipe also leaves by B3 (${anims.join(' → ')})`);

  step('result 「再写一组」: one transition, not back-then-open (P1-03)');
  await finishGroup();
  const again = page.locator(topSel('result-again'));
  if (await again.count()) {
    await watchAnims();
    await again.click();
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen !== 'result');
    await settle(page);
    anims = await page.evaluate(() => window.__anims.filter(a => a !== 'idle'));
    s = await navState(page);
    assert.equal(s.names.length, 2, `the new group replaces the result page (${s.names.join(' / ')})`);
    assert.equal(anims.length, 1, `exactly one transition (${anims.join(' → ')})`);
    assert.ok(!anims.some(a => a.startsWith('pop-')), 'no pop back to home first');
  } else {
    assert.ok(true, 'no 再写一组 on this variant (first group)');
  }

  // ------------------------------------------------------------ 5. 跳过撤销跟人走、Tab 滚动位置
  step('skip, then leave within the undo window: the undo bar follows to the source page (P1-11 / S4)');
  await toHome(page);
  await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  await push(page, 'write', { slot: 'A' });
  await tap(page, 'write-skip');
  await page.waitForSelector(topSel('write-skip-undo'));
  await page.waitForTimeout(450); // 换字是新状态：按钮 0.4s 不响应
  await page.click(topSel('page-back'));
  await settle(page);
  assert.deepEqual((await navState(page)).names, ['home'], 'left to home');
  await page.waitForSelector(tid('write-skip-undo-btn'));
  assert.equal((await navState(page)).cursor, 1, 'skipped');
  await page.click(tid('write-skip-undo-btn'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  await settle(page);
  s = await navState(page);
  assert.equal(s.cursor, 0, 'undo from home puts the character back and returns to it');
  assert.equal(await page.locator(tid('write-skip-undo')).count(), 0, 'bar gone');

  step('tabs keep their own scroll position; re-tapping the current tab scrolls to the top (P1-09 / P2-18)');
  await toHome(page);
  await page.setViewportSize({ width: 393, height: 360 });
  await page.click(tid('tab-mine'));
  await settle(page);
  const panel = '.sz-tabroot__panel';
  const scrollable = await page.evaluate(sel => { const el = document.querySelector(sel); return el.scrollHeight - el.clientHeight; }, panel);
  assert.ok(scrollable > 120, `mine tab scrolls (${scrollable})`);
  await page.evaluate(sel => { document.querySelector(sel).scrollTop = 120; document.querySelector(sel).dispatchEvent(new Event('scroll')); }, panel);
  await page.waitForTimeout(50);
  await page.click(tid('tab-home'));
  await settle(page);
  assert.equal(await page.evaluate(sel => document.querySelector(sel).scrollTop, panel), 0, 'home starts at its own position (top)');
  await page.click(tid('tab-mine'));
  await settle(page);
  assert.equal(await page.evaluate(sel => Math.round(document.querySelector(sel).scrollTop), panel), 120, 'mine comes back where it was');
  await page.click(tid('tab-mine'));
  await page.waitForFunction(sel => document.querySelector(sel).scrollTop === 0, panel, { timeout: 3000 });
  assert.ok(true, 're-tap mine → scrolled to the top');
  await page.setViewportSize(ctx.viewport);
}
