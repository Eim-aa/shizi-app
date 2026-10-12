// 本文件：第 1 部分（写字页每个阶段）。
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
export default async function i2WritePhases(page, ctx) {
  const { assert, step } = ctx;
  step('boot (test host)');
  await bootTestHost(page, ctx.baseURL);
  let s;
  let anims;
  // ------------------------------------------------------------ 1. 写字页每个阶段
  const iconXs = [];
  for (const [name, opts] of WRITE_PHASES) {
    step(`write · ${name}: top-left element present; swipe = tap (IC-01 / 02 / 03)`);
    await openWritePhase(page, ctx, opts);
    const lead = await leadInfo(page);
    assert.ok(lead.testid && lead.visible, `${name}: top-left element visible (${lead.testid})`);
    assert.ok(lead.hit >= 44 - 0.5, `${name}: hit ≥ 44 (${lead.hit})`);
    assert.equal(lead.action, 'function', `${name}: a back action is registered (never null)`);
    iconXs.push([name, lead.iconX]);
    const compare = name.startsWith('compare');
    if (compare) {
      assert.equal(lead.testid, 'write-continue', `${name}: 「‹」 is 接着写`);
      assert.equal(lead.label, '接着写', `${name}: VoiceOver name 接着写`);
      assert.equal(lead.kind, 'phase', `${name}: in-page step back (kind phase)`);
    } else {
      assert.equal(lead.kind, 'page', `${name}: leaves the page`);
    }
    const before = await navState(page);
    await tapLead(page);
    await settle(page);
    const viaTap = await navState(page);

    await openWritePhase(page, ctx, opts);
    const mid = await nativeSwipe(page, { frac: 0.5, midway: compare ? phaseDrag : null });
    await settle(page);
    const viaSwipe = await navState(page);
    assert.deepEqual(viaSwipe, viaTap, `${name}: swipe ends exactly where the tap ends (${JSON.stringify(viaTap)})`);
    if (compare) {
      assert.equal(mid.navAnim, 'drag-phase', `${name}: following the finger as an in-page step (no page reveal)`);
      assert.equal(mid.visibleLayers, 1, `${name}: the page underneath is not revealed`);
      assert.equal(mid.topTransform, '', `${name}: the page itself does not slide`);
      if (name === 'compare') {
        const scale = Number(/scale\(([\d.]+)\)/.exec(mid.mineTransform || '')?.[1]);
        assert.ok(scale > 1.01, `${name}: the upper cell grows back toward the writing grid (scale ${scale})`);
      }
      assert.ok(mid.refOpacity > 0 && mid.refOpacity < 1, `${name}: the reference cell fades (${mid.refOpacity})`);
      assert.equal(viaSwipe.phase, 'recall', `${name}: back to the writing state (IC-04)`);
      assert.deepEqual(viaSwipe.names, before.names, `${name}: page stack unchanged (IC-04)`);
      assert.equal(viaSwipe.strokes, before.strokes, `${name}: strokes kept (${viaSwipe.strokes})`);
      const leftover = await page.evaluate(() => {
        const top = document.querySelector('.sz-layer[data-top="true"]');
        return { attr: top.getAttribute('data-phase-back'), styled: [...top.querySelectorAll('.sz-write [style*="scale("]')].length };
      });
      assert.deepEqual(leftover, { attr: null, styled: 0 }, `${name}: no leftover drag styles`);
    } else {
      assert.deepEqual(viaSwipe.names, ['home'], `${name}: back to home`);
    }
  }
  const xs = iconXs.map(([, x]) => x);
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 0.5, `IC-19: 「‹」 at the same x in every phase (${JSON.stringify(iconXs)})`);

  step('compare: short swipe springs back — still judging, no leftovers');
  await openWritePhase(page, ctx, { draw: true, done: true });
  await nativeSwipe(page, { frac: 0.15, v: 0 });
  await page.waitForTimeout(400);
  await settle(page);
  s = await navState(page);
  assert.equal(s.phase, 'compare', 'spring back: still in the compare phase');

  step('compare: readers\' two-finger Z (shizi-native-escape) and Esc = 「‹ 接着写」 (IC-08)');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
  await settle(page);
  s = await navState(page);
  assert.equal(s.phase, 'recall', 'native escape → back to writing');
  assert.equal(s.screen, 'write', 'still on the write page');
  await openWritePhase(page, ctx, { draw: true, done: true });
  await page.keyboard.press('Escape');
  await settle(page);
  assert.equal((await navState(page)).phase, 'recall', 'Esc → back to writing');

}
