// R3-C3W（I3-02，D53 ⑥，P257）：写字页阶段切换里本人墨保持「一个」，文字先出后进、不叠字。
// 第三轮审查在过渡帧里看到：写好了 → 判断时 362pt 的「弓」淡出、255pt 的「弓」淡入，同一个字以两种尺寸重影（两层快照交叉淡化）；
// 按钮行「自己写 / 写好了 / 描一遍」、题面「主 / 应」叠成一团。现在：
//   - 回忆 ⇄ 判断：本人墨用 FLIP 纯缩放（以顶边中点为原点，书写格边长 → 判断上格边长，200ms，(.2,.7,.2,1)），旧快照里不再带墨、判断页上格的墨等缩放结束才露出；
//   - 其他阶段切换：新状态里有本人墨时旧快照不带墨（同一位置只有真实的那一层）；新状态没有墨（看答案 → 描一遍、下一个字…）时旧墨随快照 150ms 淡出（也只有一层）；
//   - 文字类区域（页头标题 / 题面 / 格下说明 / 底栏）旧的 0–75ms 淡出、新的 75–150ms 淡入，内容没变的区域不动；框线、背景仍同时淡化；
//   - 减少动态效果：直接切换（没有快照、没有 FLIP）。
// 逐帧采样（requestAnimationFrame）：任意一帧「可见的、有墨的 canvas」≤ 1 个；同一区域新旧文字不同时可见（不透明度都 > .15）。
import { encodeRawStrokes } from '../../src/core/ink-math.js';
import { bootTestHost, seedSession, tap, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永'];
const SPAN_MS = 700;
const line = (x0, y0, x1, y1) => Array.from({ length: 9 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, t: i * 16 }));
const STROKES = encodeRawStrokes([line(80, 120, 260, 120), line(170, 60, 170, 290)]);

async function open(page, ctx, { current, reduced = false, view = { width: 390, height: 844 }, cursor = 1 }) {
  await page.setViewportSize(view);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(`${topSel('write-screen')} .sz-page__foot`);
  await page.waitForTimeout(600);
  await page.mouse.move(1, 1);
}

/* eslint-disable no-undef */
/** 装采样器：点到 testid 那一下起 span ms 内每帧记录 ink / 文字区域状态。 */
function installSampler({ span, testid }) {
  window.__fr = { frames: [], start: 0 };
  const effOpacity = el => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };
  const hasInk = cv => {
    if (!cv.width || !cv.height) return false;
    try {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 40) return true;
    } catch (error) {
      return false;
    }
    return false;
  };
  const REGIONS = { title: '.sz-page__title:not(.sz-page__title--hidden)', prompt: '.sz-prompt', note: '.sz-write__note', foot: '.sz-page__foot' };
  const frame = now => {
    const page = document.querySelector('.sz-layer[data-top="true"] .sz-page[data-testid="write-screen"]');
    if (page) {
      const overlay = page.querySelector(':scope > .sz-phasefade');
      const inks = [];
      for (const cv of page.querySelectorAll('canvas')) {
        const inOverlay = !!cv.closest('.sz-phasefade');
        const tid = cv.getAttribute('data-testid');
        const isFlip = !!cv.closest('.sz-flipink') || cv.classList.contains('sz-flipink');
        const isInkReal = tid === 'write-grid-ink' || (!!cv.closest('[data-testid="write-compare-mine"]'));
        const isInkClone = inOverlay && cv.hasAttribute('data-flip-ink');
        if (!(isFlip || isInkReal || isInkClone)) continue;
        const o = effOpacity(cv);
        const r = cv.getBoundingClientRect();
        if (o < 0.02 || r.width < 2) continue;
        if (!hasInk(cv)) continue;
        const target = isFlip ? (cv.classList.contains('sz-flipink') ? cv : cv.closest('.sz-flipink')) : cv;
        inks.push({ kind: isFlip ? 'flip' : inOverlay ? 'overlay' : 'real', o, w: r.width, top: r.top, cx: r.left + r.width / 2, transform: getComputedStyle(target).transform });
      }
      const texts = {};
      for (const [key, sel] of Object.entries(REGIONS)) {
        const olds = overlay ? [...overlay.querySelectorAll(sel)] : [];
        const news = [...page.querySelectorAll(sel)].filter(e => !e.closest('.sz-phasefade'));
        texts[key] = {
          old: olds.length ? { o: effOpacity(olds[0]), text: olds[0].textContent.trim() } : null,
          now: news.length ? { o: effOpacity(news[0]), text: news[0].textContent.trim() } : null,
        };
      }
      window.__fr.frames.push({ t: now - window.__fr.start, inks, texts, overlay: !!overlay, flip: !!page.querySelector('.sz-flipink') });
    }
    if (now - window.__fr.start < span) requestAnimationFrame(frame);
  };
  const onClick = e => {
    if (!(e.target.closest && e.target.closest(`[data-testid="${testid}"]`))) return;
    document.removeEventListener('click', onClick, true);
    window.__fr.start = performance.now();
    requestAnimationFrame(frame);
  };
  document.addEventListener('click', onClick, true);
}
/* eslint-enable no-undef */

async function sample(page, testid, span = SPAN_MS) {
  await page.evaluate(installSampler, { span, testid });
  await tap(page, testid);
  await page.waitForFunction(sp => { const f = window.__fr.frames; return f.length > 0 && f[f.length - 1].t >= sp; }, span, { timeout: 6000 });
  return page.evaluate(() => window.__fr.frames);
}

/** 通用断言：每帧本人墨只有一个、同一区域不同时出现两个不同的词。 */
function assertSingle(assert, frames, tag) {
  assert.ok(frames.length > 10, `${tag}: sampled ${frames.length} frames`);
  const worstInk = Math.max(...frames.map(f => f.inks.length));
  assert.ok(worstInk <= 1, `${tag}: at most ONE visible ink canvas in every frame (max ${worstInk}: ${JSON.stringify(frames.find(f => f.inks.length > 1) || null)})`);
  const clash = [];
  for (const f of frames) {
    for (const [key, t] of Object.entries(f.texts)) {
      if (t.old && t.now && t.old.text !== t.now.text && t.old.o > 0.15 && t.now.o > 0.15) clash.push(`${key}@${f.t.toFixed(0)}ms: 「${t.old.text}」 ${t.old.o.toFixed(2)} + 「${t.now.text}」 ${t.now.o.toFixed(2)}`);
    }
  }
  assert.deepEqual(clash.slice(0, 3), [], `${tag}: no region shows two different texts at once (old ≤ 75ms out, new from 75ms in)`);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;

  step('写好了 → 判断 (recall → compare): the ink is ONE canvas scaled by a pure FLIP from the grid size to the upper-cell size (top-centre origin), nothing else carries the ink');
  await open(page, ctx, { current: { strokes: STROKES } });
  const gridBefore = await page.$eval(topSel('write-grid'), el => { const r = el.getBoundingClientRect(); return { w: r.width, top: r.top, cx: r.left + r.width / 2 }; });
  let frames = await sample(page, 'write-done');
  assertSingle(assert, frames, 'recall → compare');
  const flips = frames.filter(f => f.inks.some(i => i.kind === 'flip'));
  assert.ok(flips.length >= 5, `the FLIP canvas is visible for several frames (${flips.length})`);
  const fl = flips.map(f => f.inks.find(i => i.kind === 'flip'));
  const widths = fl.map(i => i.w);
  assert.ok(widths.every((w, i) => i === 0 || w <= widths[i - 1] + 0.6), `its size only goes down (${widths.map(w => w.toFixed(0)).join(' → ')})`);
  assert.ok(Math.abs(widths[0] - gridBefore.w) <= gridBefore.w * 0.08, `it starts at the writing-grid size (${widths[0].toFixed(0)} vs ${gridBefore.w.toFixed(0)})`);
  const mineAfter = await page.$eval(topSel('write-compare-mine'), el => { const r = el.getBoundingClientRect(); return { w: r.width, top: r.top, cx: r.left + r.width / 2 }; });
  assert.ok(Math.abs(widths[widths.length - 1] - mineAfter.w) <= mineAfter.w * 0.1, `and ends at the upper-cell size (${widths[widths.length - 1].toFixed(0)} vs ${mineAfter.w.toFixed(0)})`);
  assert.ok(fl.every(i => Math.abs(i.cx - gridBefore.cx) <= 1.5), 'pure scaling: the centre line never moves');
  assert.ok(fl.every(i => i.transform.startsWith('matrix(')) && fl.every(i => { const m = /matrix\(([^)]+)\)/.exec(i.transform); const v = m[1].split(',').map(Number); return Math.abs(v[0] - v[3]) < 0.001 && Math.abs(v[1]) < 0.001 && Math.abs(v[2]) < 0.001; }), 'a pure uniform scale (no skew / non-uniform scale)');
  assert.ok(frames[frames.length - 1].inks.length === 1 && frames[frames.length - 1].inks[0].kind === 'real', 'in the end the real upper-cell canvas is the one ink (the FLIP canvas is gone)');
  assert.equal(await page.$$eval('.sz-flipink', e => e.length), 0, 'nothing of the transition is left in the DOM');

  step('接着写 (compare → recall): the reverse FLIP, still one ink');
  await page.waitForTimeout(600);
  frames = await sample(page, 'write-continue');
  assertSingle(assert, frames, 'compare → recall');
  assert.ok(frames.some(f => f.inks.some(i => i.kind === 'flip')), 'the reverse scaling uses the same FLIP canvas');
  assert.equal(await page.$$eval('.sz-flipink', e => e.length), 0, 'FLIP canvas removed');

  step('看答案 (recall → trace, D64 ②: straight into 描一遍): the old ink fades with the snapshot, the new grid is empty — still one ink at a time');
  await open(page, ctx, { current: { strokes: STROKES } });
  frames = await sample(page, 'write-show-answer');
  assertSingle(assert, frames, 'recall → trace');

  step('判断 → 下一个字 (compare → next card): the upper cell ink fades once, text regions go out then in');
  await open(page, ctx, { current: { phase: 'compare', strokes: STROKES }, cursor: 0 });
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(700);
  frames = await sample(page, 'write-judge-correct');
  assertSingle(assert, frames, 'compare → next card');

  step('凭记忆写 → 下一个 (retrace → next card): one ink, texts out then in');
  await open(page, ctx, { current: { phase: 'retrace', answerSeen: true, strokes: STROKES } });
  frames = await sample(page, 'write-answer-next');
  assertSingle(assert, frames, 'retrace → next card');

  step('reduced motion: a 150ms cross-fade (not a hard cut, D58 ② / P1-10) — the snapshot fades, but no FLIP canvas (no scaling); still one ink, no text clash');
  await open(page, ctx, { current: { strokes: STROKES }, reduced: true });
  frames = await sample(page, 'write-done');
  assert.ok(frames.every(f => !f.flip), 'no FLIP canvas in any frame (no scaling under reduced motion)');
  assert.ok(frames.some(f => f.overlay), 'the snapshot cross-fade is there (not a 0ms hard cut)');
  assertSingle(assert, frames, 'reduced motion');
  const hiddenLeft = await page.evaluate(() => [...document.querySelectorAll('[data-fade-in], [data-flip-hide]')].length);
  assert.equal(hiddenLeft, 0, 'nothing is left hidden');
}
