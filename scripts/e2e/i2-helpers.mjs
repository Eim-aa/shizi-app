// R5-I2 导航合规 e2e 的共用工具（103 / 104 / 105-i2-*.spec.js）：读导航状态、左上元素、派发原生左缘进度、打开写字页某阶段。

import {
  drawStroke, HORIZONTAL, seedSession, tap, topSel, waitNavIdle,
} from './helpers.mjs';

export const CHARS = ['永', '和', '春'];

/* eslint-disable no-undef */
export async function navState(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.sz-app');
    const top = app.querySelector(':scope > .sz-layer[data-top="true"]');
    const write = top ? top.querySelector('.sz-write') : null;
    const st = window.__shiziTest.getState();
    const a = st.sessions && st.sessions.A;
    return {
      names: history.state.stack.map(e => e.n),
      screen: app.dataset.topScreen,
      overlay: history.state.stack[history.state.stack.length - 1].k === 'o',
      phase: write ? write.dataset.phase : null,
      cursor: a ? a.cursor : null,
      strokes: a && a.current && Array.isArray(a.current.strokes) ? a.current.strokes.length : null,
    };
  });
}

/** 顶层页面的左上元素与登记的返回动作。 */
export async function leadInfo(page) {
  return page.evaluate(async () => {
    const { getBackAction, getBackKind } = await import('/src/ui/back-action.js');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const el = top.querySelector('.sz-page__lead [data-testid="page-back"], .sz-page__lead [data-testid="write-continue"]');
    const r = el ? el.getBoundingClientRect() : null;
    const icon = el ? el.querySelector('svg') : null;
    const ir = icon ? icon.getBoundingClientRect() : null;
    const id = top.dataset.entry;
    return {
      testid: el ? el.dataset.testid : null,
      label: el ? el.getAttribute('aria-label') : null,
      visible: !!r && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth,
      hit: r ? Math.min(r.width, r.height) : 0,
      iconX: ir ? Math.round(ir.left * 100) / 100 : null,
      action: typeof getBackAction(id),
      kind: getBackKind(id),
    };
  });
}

/** 原生左缘进度（与 Swift 同一形状）：began → changed 到 frac × 宽 → ended v。midway(page) 在 changed 之后调用。 */
export async function nativeSwipe(page, { frac = 0.5, v = 0, midway = null } = {}) {
  const w = await page.evaluate(() => innerWidth);
  const fire = (phase, x, vx) => page.evaluate(([p, tx, vv, ww]) => window.dispatchEvent(new CustomEvent('shizi-native-back-progress', {
    detail: { phase: p, translationX: tx, progress: tx / ww, velocityX: vv },
  })), [phase, x, vx, w]);
  await fire('began', 0, 0);
  await fire('changed', Math.round(w * frac / 2), 0);
  await fire('changed', Math.round(w * frac), 0);
  await page.waitForTimeout(32);
  const mid = midway ? await midway(page) : null;
  await fire('ended', Math.round(w * frac), v);
  return mid;
}

export async function phaseDrag(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.sz-app');
    const top = app.querySelector(':scope > .sz-layer[data-top="true"]');
    const mine = top.querySelector('.sz-compare__row--mine');
    const ref = top.querySelector('[data-testid="write-compare-ref"]');
    const visibleLayers = [...app.querySelectorAll(':scope > .sz-layer')].filter(el => el.style.visibility !== 'hidden').length;
    return {
      navAnim: app.dataset.navAnim,
      mineTransform: mine ? mine.style.transform : null,
      refOpacity: ref ? Number(ref.style.opacity) : null,
      visibleLayers,
      topTransform: top.style.transform,
    };
  });
}
/* eslint-enable no-undef */

export async function settle(page) {
  await page.waitForTimeout(80);
  await waitNavIdle(page);
}

export async function push(page, name, params = {}) {
  await page.evaluate(async ([n, p]) => {
    const { nav } = await import('/src/ui/router.js');
    nav.push(n, p);
  }, [name, params]);
  await page.waitForFunction(n => document.querySelector('.sz-app').dataset.topScreen === n, name);
  await waitNavIdle(page);
}

export async function toHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.depth === '0');
  await waitNavIdle(page);
}

export async function tapLead(page) {
  const sel = '.sz-layer[data-top="true"] .sz-page__lead [data-testid="page-back"], .sz-layer[data-top="true"] .sz-page__lead [data-testid="write-continue"]';
  await page.click(sel);
}

// 写字页各阶段：返回 setup(page)，打开写字页并停在该阶段。
export const WRITE_PHASES = [
  ['recall', { current: undefined, draw: true }],
  ['hint', { current: undefined, hint: true }],
  ['answer', { current: { phase: 'answer', answerSeen: true } }],
  ['trace', { current: { phase: 'trace', answerSeen: true } }],
  ['retrace', { current: { phase: 'retrace', answerSeen: true } }],
  ['compare', { current: undefined, draw: true, done: true }],
];

export async function openWritePhase(page, ctx, opts) {
  await toHome(page);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0, current: opts.current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await push(page, 'write', { slot: 'A' });
  if (opts.draw) await drawStroke(page, HORIZONTAL);
  if (opts.hint) {
    await tap(page, 'write-hint');
    await page.waitForTimeout(200);
  }
  if (opts.done) {
    await tap(page, 'write-done');
    await page.waitForSelector(topSel('write-judge-wrong'));
  }
  await settle(page);
}

