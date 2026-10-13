// 交互合规（交互与动效规范 §8b）—— 第 5 份：写字页各阶段。
//   IC-11  回忆 / 看答案 / 描一遍 / 自己写 / 判断每个阶段：B3 常用操作全部可见、可点、不在任何菜单弹层里
//   IC-19  写字页所有阶段「‹」图标的 x 坐标相等（± 0.5）
//   IC-04  判断阶段左缘右滑 = 「‹ 接着写」：回到回忆、笔数不变、页面栈深度不变（P0-01 归卡 I2：未修前按待修清单跳过并打印）
//   IC-17  转场进行中的输入不被吞：推入写字页的转场里落下的笔照样记下（与等转场放完再写结果相同）
//   IC-18  冷启动恢复到写字页：触觉日志为空（不重演）、左上元素与左缘右滑照常（IC-01 / 02 / 03 复跑）

import { PRESS_MS, TOP, boot, skipIfPending, snapshot, swipeBack, backActionIsFunction, toRoot, waitIdle } from './ic-lib.mjs';
import { drawStroke, HORIZONTAL, VERTICAL, seedSession } from './helpers.mjs';

const CHARS = ['永', '和', '春'];

/** B3：每个阶段应当一次点击直达的操作（testid）。 */
const OPS = {
  recall: ['write-done', 'write-hint', 'write-show-answer', 'write-skip', 'write-undo', 'write-clear'],
  answer: ['write-answer-trace', 'write-answer-self', 'write-answer-next'],
  trace: ['write-trace-done', 'write-answer-next'],
  retrace: ['write-answer-next', 'write-retrace-trace'],
  compare: ['write-judge-wrong', 'write-judge-correct', 'write-continue'],
};

async function phaseFacts(page, ops) {
  return page.evaluate(([t, list]) => {
    const top = document.querySelector(t);
    const out = {};
    for (const id of list) {
      const el = top.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        out[id] = 'missing';
        continue;
      }
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const inMenu = !!el.closest('[role="menu"], .sz-sheet, [role="dialog"]');
      out[id] = r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight && (hit === el || el.contains(hit)) && !inMenu ? 'ok' : `bad(${Math.round(r.top)}, menu=${inMenu})`;
    }
    const back = top.querySelector('.sz-page__head [data-testid="page-back"], .sz-page__head [data-testid="write-continue"]');
    const icon = back ? (back.querySelector('svg') || back).getBoundingClientRect() : null;
    return { ops: out, backX: icon ? Math.round(icon.left * 10) / 10 : null, phase: top.querySelector('.sz-write').dataset.phase };
  }, [TOP, ops]);
}

const strokesNow = page => page.evaluate(() => {
  const s = window.__shiziTest.getState().sessions.A;
  return s && s.current ? s.current.strokes.length : -1;
});

export default async function interactionComplianceWrite(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await boot(page, baseURL);
  await seedSession(page, { slot: 'A', chars: CHARS });
  await toRoot(page);

  step('IC-11 / IC-19: each phase — every everyday operation is one tap away; 「‹」 stays at the same x');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await waitIdle(page, 'write', PRESS_MS);
  const xs = {};
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(PRESS_MS);
  let f = await phaseFacts(page, OPS.recall);
  assert.deepEqual(f.ops, Object.fromEntries(OPS.recall.map(k => [k, 'ok'])), 'IC-11 recall');
  xs.recall = f.backX;
  await page.click(`${TOP} [data-testid="write-show-answer"]`);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'answer');
  await page.waitForTimeout(PRESS_MS);
  f = await phaseFacts(page, OPS.answer);
  assert.deepEqual(f.ops, Object.fromEntries(OPS.answer.map(k => [k, 'ok'])), 'IC-11 answer');
  xs.answer = f.backX;
  await page.click(`${TOP} [data-testid="write-answer-trace"]`);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'trace');
  await page.waitForTimeout(1900); // 描一遍前的笔顺快放（≤ 1.6s）
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(PRESS_MS);
  f = await phaseFacts(page, OPS.trace);
  assert.deepEqual(f.ops, Object.fromEntries(OPS.trace.map(k => [k, 'ok'])), 'IC-11 trace');
  xs.trace = f.backX;
  await page.click(`${TOP} [data-testid="write-trace-done"]`);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'retrace');
  await page.waitForTimeout(PRESS_MS);
  f = await phaseFacts(page, OPS.retrace);
  assert.deepEqual(f.ops, Object.fromEntries(OPS.retrace.map(k => [k, 'ok'])), 'IC-11 retrace (自己写)');
  xs.retrace = f.backX;
  await page.click(`${TOP} [data-testid="write-answer-next"]`);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '1');
  await page.waitForTimeout(PRESS_MS);
  await drawStroke(page, VERTICAL);
  await page.waitForTimeout(200);
  await page.click(`${TOP} [data-testid="write-done"]`);
  await page.waitForSelector(`${TOP} [data-testid="write-judge-correct"]`);
  await page.waitForTimeout(700);
  f = await phaseFacts(page, OPS.compare);
  assert.deepEqual(f.ops, Object.fromEntries(OPS.compare.map(k => [k, 'ok'])), 'IC-11 compare');
  xs.compare = f.backX;
  const vals = Object.values(xs);
  assert.ok(vals.every(v => v !== null && Math.abs(v - vals[0]) <= 0.5), `IC-19 「‹」 x is the same in every phase ${JSON.stringify(xs)}`);

  step('IC-04: judge phase — swipe back = 「‹ 接着写」 (back to recall, ink kept, stack unchanged)');
  const before = await snapshot(page);
  const strokesBefore = await strokesNow(page);
  await swipeBack(page, { to: 0.5 });
  await page.waitForTimeout(500);
  await waitIdle(page);
  const after = await snapshot(page);
  if (after.phase !== 'recall' && skipIfPending('IC-04', { phases: ['compare'] }, 'compare: swipe did nothing')) {
    await page.click(`${TOP} [data-testid="write-continue"]`);
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'recall');
  } else {
    assert.equal(after.phase, 'recall', 'IC-04 back to recall');
    assert.equal(after.depth, before.depth, 'IC-04 the page stack is unchanged');
    assert.equal(await strokesNow(page), strokesBefore, 'IC-04 the ink is kept');
  }

  step('IC-17: a stroke put down while the write page is still coming in is kept (same as writing after the transition)');
  await seedSession(page, { slot: 'A', chars: CHARS });
  await toRoot(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await page.waitForSelector(`${TOP} [data-testid="write-grid-live"]`);
  await drawStroke(page, HORIZONTAL);
  await waitIdle(page, 'write', 400);
  assert.equal(await strokesNow(page), 1, 'IC-17 the stroke drawn during the transition is kept');
  step('IC-18: cold start back into the write page — no haptic / moment replays; back and swipe work as usual');
  await page.waitForTimeout(400); // 路由记忆写盘
  await page.goto('about:blank');
  await page.goto(`${baseURL}/?test=1`);
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitIdle(page, 'write', PRESS_MS);
  const replay = await page.evaluate(async () => (await import('/src/platform/haptics.js')).hapticLog());
  assert.deepEqual(replay, [], 'IC-18 no haptic on restore');
  assert.equal(await backActionIsFunction(page), true, 'IC-18 / IC-02 the restored write page registers its back action');
  assert.ok(await page.isVisible(`${TOP} .sz-page__head [data-testid="page-back"]`), 'IC-18 / IC-01 「‹」 is there');
  await swipeBack(page, { to: 0.5 });
  await waitIdle(page, 'home');
  assert.equal((await snapshot(page)).top, 'home', 'IC-18 / IC-03 swipe back from the restored page lands on home');

  // IC-17 / T0-3（转场可被打断）：推入转场还没放完就点「‹」或左缘右滑，返回照样执行——防连点只防重复推入，不吞返回（R5M）
  const tapBackMidPush = async (name, params, waitMs) => {
    await toRoot(page);
    await waitIdle(page, null, PRESS_MS);
    const rootTop = (await snapshot(page)).top;
    await page.evaluate(async ({ n, p }) => (await import('/src/ui/router.js')).nav.push(n, p), { n: name, p: params });
    await page.waitForTimeout(waitMs);
    const mid = await page.evaluate(t => {
      const app = document.querySelector('.sz-app');
      const b = document.querySelector(`${t} .sz-page__head [data-testid="page-back"]`);
      const r = b ? b.getBoundingClientRect() : null;
      return { anim: app.dataset.navAnim, x: r ? r.left + r.width / 2 : null, y: r ? r.top + r.height / 2 : null };
    }, TOP);
    assert.ok(mid.anim !== 'idle', `IC-17 ${name}: the push transition is still running when 「‹」 is tapped (${mid.anim})`);
    await page.mouse.click(mid.x, mid.y);
    await waitIdle(page, null, 120);
    const after = await snapshot(page);
    assert.equal(after.top, rootTop, `IC-17 ${name}: 「‹」 tapped mid-push goes back (same end state as tapping after the transition)`);
    assert.equal(after.depth, 0, `IC-17 ${name}: the stack is back at the tab root`);
  };
  step('IC-17: 「‹」 tapped while a push is still animating is not swallowed (T0-3: transitions can be interrupted)');
  await tapBackMidPush('remind', {}, 90);
  await seedSession(page, { slot: 'A', chars: CHARS });
  await tapBackMidPush('write', { slot: 'A' }, 140);

  step('IC-17: an edge swipe started while a push is still animating goes back');
  await toRoot(page);
  await waitIdle(page, null, PRESS_MS);
  const rootTop = (await snapshot(page)).top;
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('remind', {}));
  await page.waitForTimeout(90);
  assert.ok(await page.evaluate(() => document.querySelector('.sz-app').dataset.navAnim) !== 'idle', 'IC-17 the push is still running');
  await swipeBack(page, { to: 0.6 });
  await waitIdle(page, null, 120);
  assert.equal((await snapshot(page)).top, rootTop, 'IC-17 the edge swipe during the push went back');

}
