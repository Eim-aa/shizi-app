// R2-X1（D51 ②⑦，P227；第二轮审查 I2-01）：写字页内阶段切换的网页最小过渡。
//
//   1. 阶段间 150ms 交叉淡化：回忆 → 判断 → 接着写 → 看答案 → 描一遍 → 自己写 → 判断后换下一字，每次切换，旧状态的快照（[data-testid="write-phase-snapshot"]，
//      aria-hidden、不可点）盖在新状态上 150ms 线性淡出，只淡化——快照与新内容都没有位移 / 缩放；结束后快照移除，终态不留任何痕迹。
//      减少动态效果：直接切换，快照从不出现。
//   2. 判断页参考格去掉 8px 上滑（szCmpIn 只淡入）。
//   3. 判断两键：0–320ms 不显示、320ms 起 60% 且不可点（pointer-events:none）、440ms 变实可点；减少动态效果下 150ms 起可点、不淡入。
//   4. 换字后 250ms 内早到的落笔缓存、到点补画，不丢笔。
//
// 时间轴取页面里的 requestAnimationFrame 采样（t = 触发点击那一帧起算），容差 ±45ms（无头浏览器的帧间隔）。

import {
  bootTestHost, drawStroke, gridRect, HORIZONTAL, seedSession, tid, topSel, waitNavIdle, openWrite, PRESS_SETTLE_MS, tap,
} from './helpers.mjs';

const CHARS = ['根', '据', '永'];
const SPAN_MS = 800;

async function open(page, ctx, { reduced = false, current, cursor = 0, chars = CHARS } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await openWrite(page, { slot: 'A' });
  await page.waitForSelector(topSel('write-more'), { timeout: 15000 });
  await page.waitForTimeout(450);
  await page.mouse.move(1, 1);
}

/* eslint-disable no-undef */
/** 在页面里装采样器：下一次 click（捕获阶段）起 SPAN_MS 内每帧记录快照 / 判断键 / 参考格的状态。 */
function installTimeline({ span, testid }) {
  window.__tl = { frames: [], start: 0 };
  const top = () => document.querySelector('.sz-layer[data-top="true"]');
  const frame = now => {
    const root = top();
    const snap = root && root.querySelector('[data-testid="write-phase-snapshot"]');
    const btns = root && root.querySelector('.sz-judge__btns');
    const wrong = root && root.querySelector('[data-testid="write-judge-wrong"]');
    const ref = root && root.querySelector('.sz-compare__row--ref');
    const page = root && root.querySelector('.sz-write');
    const cs = el => (el ? getComputedStyle(el) : null);
    window.__tl.frames.push({
      t: now - window.__tl.start,
      phase: page ? page.dataset.phase : null,
      snap: !!snap,
      snapOpacity: snap ? parseFloat(cs(snap).opacity) : null,
      snapTransform: snap ? cs(snap).transform : null,
      snapAria: snap ? snap.getAttribute('aria-hidden') : null,
      snapPointer: snap ? cs(snap).pointerEvents : null,
      btns: !!btns,
      btnsOpacity: btns ? parseFloat(cs(btns).opacity) : null,
      btnsPointer: wrong ? cs(wrong).pointerEvents : null,
      btnsReady: btns ? btns.dataset.ready : null,
      refTransform: ref ? cs(ref).transform : null,
      refOpacity: ref ? parseFloat(cs(ref).opacity) : null,
    });
    if (now - window.__tl.start < span) requestAnimationFrame(frame);
  };
  // 从点到 testid 那个控件的那一下起算（它可能是「⋯」菜单里的一项：之前开菜单的那一下点击不算）
  const onClick = e => {
    if (!(e.target.closest && e.target.closest(`[data-testid="${testid}"]`))) return;
    document.removeEventListener('click', onClick, true);
    window.__tl.start = performance.now();
    requestAnimationFrame(frame);
  };
  document.addEventListener('click', onClick, true);
}
/* eslint-enable no-undef */

/** 点 testid 对应的控件（主按钮直接点、菜单项先开菜单，helpers.tap）并记录之后 span ms 内每一帧。 */
async function timeline(page, testid, span = SPAN_MS) {
  await page.evaluate(installTimeline, { span, testid });
  await tap(page, testid);
  await page.waitForFunction(sp => { const f = window.__tl.frames; return f.length > 0 && f[f.length - 1].t >= sp; }, span, { timeout: 5000 });
  return page.evaluate(() => window.__tl.frames);
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** 快照存在的时间段 [首帧, 末帧]（没有返回 null）。 */
function snapSpan(frames) {
  const on = frames.filter(f => f.snap);
  if (!on.length) return null;
  return { from: on[0].t, to: on[on.length - 1].t, frames: on };
}

export default async function x1Transitions(page, ctx) {
  const { assert, step } = ctx;

  // ------------------------------------------------------------------ 1. 150ms 交叉淡化
  step('fade: 写好了 → 判断页 — the old page is a snapshot that fades 1 → 0 linearly over ~150ms (no movement, no scale), then it is gone');
  await open(page, ctx);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  let frames = await timeline(page, 'write-done');
  let sp = snapSpan(frames);
  assert.ok(sp, 'a snapshot of the previous state appears');
  assert.ok(sp.from <= 50, `the snapshot is there from the first frame (${sp.from.toFixed(0)}ms)`);
  assert.ok(sp.to >= 100 && sp.to <= 150 + 60, `the snapshot lasts ~150ms (until ${sp.to.toFixed(0)}ms)`);
  assert.ok(sp.frames[0].snapOpacity >= 0.85, `it starts opaque (${sp.frames[0].snapOpacity})`);
  const ops = sp.frames.map(f => f.snapOpacity);
  assert.ok(ops.every((v, i) => i === 0 || v <= ops[i - 1] + 0.01), 'the opacity only goes down');
  const mid = sp.frames.find(f => f.t >= 70 && f.t <= 85);
  assert.ok(!mid || near(mid.snapOpacity, 1 - mid.t / 150, 0.2), `linear: ${mid && mid.snapOpacity.toFixed(2)} at ${mid && mid.t.toFixed(0)}ms`);
  assert.ok(sp.frames.every(f => f.snapTransform === 'none'), 'the snapshot is only faded — no translate / scale');
  assert.ok(sp.frames.every(f => f.snapAria === 'true' && f.snapPointer === 'none'), 'the snapshot is aria-hidden and not clickable');
  assert.equal(frames[frames.length - 1].snap, false, 'the snapshot is removed when the fade ends');
  assert.equal(await page.$$eval('[data-testid="write-phase-snapshot"]', e => e.length), 0, 'nothing is left in the DOM');
  assert.equal(await page.$$eval('.sz-layer[data-top="true"] [data-testid="write-grid-ink"], .sz-layer[data-top="true"] [data-testid="write-compare-mine"]', e => e.length), 1, 'the final state has no duplicate of the page (only the judge cell)');

  step('fade: 接着写 (judge → recall) fades too, and the ink is still there');
  await page.waitForSelector(`${topSel('write-continue')}`);
  await page.waitForTimeout(PRESS_SETTLE_MS + 200);
  frames = await timeline(page, 'write-continue');
  sp = snapSpan(frames);
  assert.ok(sp && sp.from <= 50 && sp.to <= 150 + 60, 'judge → recall: a 150ms snapshot fade');
  await page.waitForSelector(topSel('write-grid'));
  assert.equal(await page.$eval(topSel('write-grid'), el => Number(el.dataset.strokeCount)), 1, 'the written stroke is intact');

  step('fade: 看答案 (recall → answer) and 描一遍 / 自己写 fade too');
  await open(page, ctx);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  frames = await timeline(page, 'write-show-answer');
  sp = snapSpan(frames);
  assert.ok(sp && sp.from <= 50 && sp.to <= 150 + 60, 'recall → answer: a 150ms snapshot fade');
  await page.waitForSelector(topSel('write-answer-trace'));
  await page.waitForTimeout(PRESS_SETTLE_MS + 250);
  frames = await timeline(page, 'write-answer-trace');
  sp = snapSpan(frames);
  assert.ok(sp && sp.to <= 150 + 60, 'answer → trace: a 150ms snapshot fade');
  await page.waitForSelector(topSel('write-trace-done'));
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  frames = await timeline(page, 'write-trace-done');
  sp = snapSpan(frames);
  assert.ok(sp && sp.to <= 150 + 60, 'trace → retrace: a 150ms snapshot fade');

  step('fade: 写对了 on card 1 → card 2 fades; typing on the new card is not blocked by the snapshot');
  await open(page, ctx);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(700);
  frames = await timeline(page, 'write-judge-correct');
  sp = snapSpan(frames);
  assert.ok(sp && sp.from <= 50 && sp.to <= 150 + 60, 'judge → next card: a 150ms snapshot fade');
  assert.equal(frames.find(f => f.t > 300).phase, 'recall', 'the next card is in recall');

  // ------------------------------------------------------------------ 减少动态效果
  step('reduced motion: every switch is direct — the snapshot never appears, the end state is the same, judge buttons are tappable from ~150ms without a fade-in');
  await open(page, ctx, { reduced: true });
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  frames = await timeline(page, 'write-done');
  assert.equal(frames.some(f => f.snap), false, 'no snapshot at all under reduced motion');
  assert.equal(frames[frames.length - 1].phase, 'compare', 'the end state is the judge page');
  const late = frames.find(f => f.t >= 170);
  assert.ok(late.btnsOpacity === 1 && late.btnsReady === 'true', `the judge buttons are solid and live by ${late.t.toFixed(0)}ms (no fade-in, no 320 / 440ms)`);
  const firstBtn = frames.find(f => f.btns);
  assert.ok(firstBtn.btnsOpacity === 1, 'they are never faded');
  assert.ok(frames.filter(f => f.refTransform).every(f => f.refTransform === 'none'), 'no movement in the reference cell');

  // ------------------------------------------------------------------ 2. 参考格不再上滑
  step('judge page: the reference cell only fades in — no 8px slide');
  await open(page, ctx);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  frames = await timeline(page, 'write-done');
  const refFrames = frames.filter(f => f.refTransform);
  assert.ok(refFrames.length > 5, 'the reference cell was sampled');
  assert.ok(refFrames.every(f => f.refTransform === 'none'), 'its transform is never anything but none (no translateY)');
  assert.ok(refFrames[0].refOpacity < 0.5 && refFrames[refFrames.length - 1].refOpacity === 1, `it fades in (${refFrames[0].refOpacity} → ${refFrames[refFrames.length - 1].refOpacity})`);

  // ------------------------------------------------------------------ 3. 判断两键的出现与就绪
  step('judge buttons: hidden until 320ms, 60% and not tappable from 320ms, solid and tappable from 440ms');
  const btn = frames.filter(f => f.btns);
  const at = (t0, t1) => btn.filter(f => f.t >= t0 && f.t <= t1);
  assert.ok(at(0, 290).every(f => f.btnsOpacity < 0.05), `0–290ms: not shown (max ${Math.max(...at(0, 290).map(f => f.btnsOpacity)).toFixed(2)})`);
  const sixty = at(350, 420);
  assert.ok(sixty.length && sixty.every(f => f.btnsOpacity > 0.3 && f.btnsOpacity < 0.75), `350–410ms: about 60% (${sixty.map(f => f.btnsOpacity.toFixed(2)).join(', ')})`);
  assert.ok(at(0, 420).every(f => f.btnsPointer === 'none' && f.btnsReady === 'false'), 'not tappable (pointer-events:none, data-ready=false) before 440ms');
  const solid = at(500, 800);
  assert.ok(solid.length && solid.every(f => f.btnsOpacity === 1 && f.btnsReady === 'true' && f.btnsPointer !== 'none'), 'solid, ready and tappable from 440ms on');

  step('judge buttons: a tap at ~300ms does nothing, a tap after 440ms judges');
  await open(page, ctx);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__t0 = 0;
    document.addEventListener('click', () => { window.__t0 = performance.now(); }, { capture: true, once: true });
  });
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-wrong'), { state: 'attached' });
  const box = await page.locator(topSel('write-judge-correct')).boundingBox();
  await page.waitForFunction(() => performance.now() - window.__t0 > 280);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  const stillThere = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor);
  assert.equal(stillThere, '0', 'the tap at ~300ms did not judge (cursor still 0)');
  await page.waitForFunction(() => performance.now() - window.__t0 > 480);
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write')?.dataset.cursor === '1');
  assert.ok(true, 'the tap after 440ms judged (cursor 1)');

  // ------------------------------------------------------------------ 4. 早到落笔不丢
  step('early pen: a stroke that lands within 250ms of the new card is kept and drawn (it used to be dropped for 300ms)');
  await open(page, ctx);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__t0 = 0; document.addEventListener('click', () => { window.__t0 = performance.now(); }, { capture: true, once: true }); });
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write')?.dataset.cursor === '1');
  const r = await gridRect(page);
  await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5, { steps: 4 });
  const sinceClick = await page.evaluate(() => performance.now() - window.__t0);
  assert.ok(sinceClick < 250, `the stroke started ${sinceClick.toFixed(0)}ms after the judgement (< 250ms)`);
  await page.mouse.move(r.x + r.width * 0.8, r.y + r.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === 1;
  }, null, { timeout: 2000 });
  assert.ok(true, 'the early stroke was kept (stroke count 1)');
  const ink = await page.$eval(topSel('write-grid-ink'), c => {
    const ctx2 = c.getContext('2d');
    const data = ctx2.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
    return n;
  });
  assert.ok(ink > 200, `and drawn on the ink layer (${ink} px)`);
  assert.equal(await page.$eval(tid('write-done'), el => el.disabled), false, '「写好了」 is live (the stroke counts)');
}
