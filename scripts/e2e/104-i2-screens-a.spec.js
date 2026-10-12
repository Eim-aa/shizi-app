// 本文件：第 2 部分前半（注册子页面，偶数位）。
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
export default async function i2ScreensA(page, ctx) {
  const { assert, step } = ctx;
  step('boot (test host)');
  await bootTestHost(page, ctx.baseURL);
  let s;
  let anims;
  const HALF = 0;
  // ------------------------------------------------------------ 2. 每个注册的子页面
  await toHome(page);
  await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  const month = new Date().toISOString().slice(0, 7);
  const FIXTURE = {
    detail: { char: '完' }, 'detail-photo': { char: '人' }, 'library-list': { kind: 'wrong' }, month: { month },
    '_demo/sub': { level: 1 },
  };
  const SKIP = new Set(['write', 'result']); // 写字页见 1，结果页见 4
  const screens = await page.evaluate(async () => (await import('/src/ui/router.js')).listScreens().filter(d => !d.tab).map(d => d.name));
  assert.ok(screens.length >= 15, `registered sub screens: ${screens.join(', ')}`);
  for (const [i, name] of screens.entries()) {
    if (SKIP.has(name) || i % 2 !== HALF) continue;
    step(`${name}: 「‹」 present; tap = swipe = native escape = Esc`);
    const params = FIXTURE[name] || {};
    await toHome(page);
    await push(page, name, params);
    const lead = await leadInfo(page);
    assert.equal(lead.testid, 'page-back', `${name}: top-left element present`);
    assert.equal(lead.label, '返回', `${name}: pushed pages use 「‹」 (返回), never × (D58 ④)`);
    assert.equal(lead.action, 'function', `${name}: back action registered`);
    assert.ok(lead.visible && lead.hit >= 44 - 0.5, `${name}: visible, hit ≥ 44`);
    await tapLead(page);
    await settle(page);
    const viaTap = await navState(page);
    assert.deepEqual(viaTap.names, ['home'], `${name}: tap → home`);
    await push(page, name, params);
    await nativeSwipe(page, { frac: 0.5 });
    await settle(page);
    assert.deepEqual(await navState(page), viaTap, `${name}: swipe = tap`);
    await push(page, name, params);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
    await settle(page);
    assert.deepEqual(await navState(page), viaTap, `${name}: two-finger Z = tap (P0-16)`);
    await push(page, name, params);
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await settle(page);
    assert.deepEqual(await navState(page), viaTap, `${name}: Esc = tap`);
  }

}
