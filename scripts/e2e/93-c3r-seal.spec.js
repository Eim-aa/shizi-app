// 第三轮 C3-R（D53 ⑤；I3-04 / I3-05 / T3-08）：落印三感同帧。
//   1. 印落下：先落到 0.92（着纸，缩放最小值）再用约 120ms 回弹到 1；落款声 s1 与 rigid 触觉 seal 在「着纸」那一帧同发（rAF 逐帧采样：s1、触觉、缩放最小值在同一帧 ±1 帧），
//      不是 animationend 之后；没有 action 触觉。
//   2. 先只显示作品：印落下之前，各行 / 复现句 / 底栏不透明度 0；印回弹到位之后才淡入（底栏在 s1 之后至少 100ms 才开始出现）。
//   3. 刷新（冷启动恢复）结果页：不重演落印、不响 s1、不发 seal 触觉、文字与底栏一开始就在（会话上的 sealedAt）。
//   4. 点一下直接到终态：s1 与触觉同一帧、立刻。
//   5. 减少动态效果：终态 + 立即同发（同一帧），文字与底栏不隐藏。

import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedWork } from './work-helpers.mjs';

async function install(page) {
  await page.addInitScript(() => {
    window.__c3 = { frames: [], starts: [] };
    const proto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
    if (proto) {
      const start = proto.start;
      proto.start = function patched(...args) {
        window.__c3.starts.push({ ms: Math.round(((this.buffer && this.buffer.duration) || 0) * 1000), t: performance.now() });
        return start.apply(this, args);
      };
    }
    const op = el => (el ? Number(getComputedStyle(el).opacity) : null);
    const loop = ts => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const seal = top && top.querySelector('[data-testid="work-seal"]');
      if (seal) {
        const cs = getComputedStyle(seal);
        const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
        window.__c3.frames.push({
          ts, scale: m.a, seal: Number(cs.opacity),
          foot: op(top.querySelector('.sz-page__foot')),
          row: op(top.querySelector('[data-testid="result-excluded"]')),
          late: !!top.querySelector('.sz-page[data-late="pending"]'),
        });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

const reset = page => page.evaluate(() => { window.__c3.frames.length = 0; window.__c3.starts.length = 0; });
const read = page => page.evaluate(async () => {
  const h = await import('/src/platform/haptics.js');
  return { ...window.__c3, haptics: h.hapticLog(), times: h.hapticTimes() };
});
const frameOf = (frames, t) => {
  let k = -1;
  frames.forEach((f, i) => { if (f.ts <= t) k = i; });
  return k;
};
const ready = page => page.evaluate(async () => (await import('/src/platform/sound.js')).warmSounds({}));
const openResult = (page, o) => page.evaluate(async p => { (await import('/src/ui/router.js')).nav.push('result', p); }, o);

export default async function c3rSeal(page, ctx) {
  const { assert, step } = ctx;
  await install(page);
  await bootTestHost(page, ctx.baseURL);

  step('the seal lands: s1 and the rigid haptic are sent on the frame it touches the paper (scale minimum), not at animationend; the page shows only the work until then');
  const w1 = await seedWork(page, { id: 's931', chars: ['永', '和', '春'], steps: ['correct', 'wrong', 'wrong'] });
  await ready(page);
  await reset(page);
  await page.evaluate(() => { window.__c3.rowAfterRead = null; });
  await openResult(page, { slot: w1.slot, sessionId: w1.sessionId });
  await page.waitForFunction(() => window.__c3.starts.length >= 1, null, { timeout: 5000 });
  await page.waitForTimeout(700);
  const r1 = await read(page);
  const s1 = r1.starts.find(s => s.ms === 320);
  assert.ok(s1, 's1 (320ms) started');
  const sealIdx = r1.haptics.lastIndexOf('seal');
  assert.ok(sealIdx >= 0, `the haptic log has a seal (${JSON.stringify(r1.haptics)})`);
  assert.ok(!r1.haptics.includes('action'), 'no light action haptic any more at the landing');
  if (process.env.C3_DEBUG) console.log(JSON.stringify({ s1: s1.t, h: r1.times, frames: r1.frames.map(f => [Math.round(f.ts), +f.scale.toFixed(3), f.seal, f.foot, f.row, f.late]) }));
  const fs = frameOf(r1.frames, s1.t);
  const fh = frameOf(r1.frames, r1.times[sealIdx]);
  assert.equal(fs, fh, 's1 and the seal haptic are sent on the same frame');
  const scales = r1.frames.map(f => f.scale);
  const minIdx = scales.indexOf(Math.min(...scales));
  assert.ok(Math.abs(fs - minIdx) <= 1, `that frame is the seal touching the paper: scale minimum frame ${minIdx}, sent frame ${fs}`);
  assert.ok(r1.frames[fs].scale <= 0.95 && r1.frames[fs].seal >= 0.99, `at the sending frame the seal is at its smallest and opaque (${r1.frames[fs].scale.toFixed(3)} / ${r1.frames[fs].seal})`);
  assert.ok(Math.max(...scales.slice(0, minIdx)) >= 1.1, 'before touching the paper the seal came down from above 1.1');
  const after = r1.frames.slice(fs + 1).filter(f => f.scale < 0.999);
  assert.ok(after.length >= 4, `after touching, the seal rebounds over at least 4 frames (${after.length})`);
  assert.ok(r1.frames[r1.frames.length - 1].scale === 1, 'it ends at scale 1');
  assert.ok(r1.frames.slice(0, fs).every(f => f.foot === 0 && f.row === 0 && f.late), 'until it touches the paper the footer and the rows are fully transparent (work only)');
  const footShown = r1.frames.findIndex(f => f.foot > 0);
  assert.ok(footShown > fs && r1.frames[footShown].ts - s1.t >= 100, `the footer starts to fade in after the rebound is on its way (${Math.round(r1.frames[footShown].ts - s1.t)}ms after s1)`);
  const last = r1.frames[r1.frames.length - 1];
  assert.ok(last.foot === 1 && last.row === 1 && !last.late, 'later the footer and the rows are fully shown and data-late is gone');

  step('refresh on the result page (cold start): no replay, no s1, no seal haptic, text and footer are there from the first frame; sealedAt is on the session');
  const sealedAt = await page.evaluate(() => {
    const st = window.__shiziTest.getState().sessions;
    return st.lastEnded.A && st.lastEnded.A.sealedAt;
  });
  assert.ok(Number.isFinite(sealedAt), `the session records sealedAt (${sealedAt})`);
  await page.reload();
  await page.waitForSelector(topSel('work-cell'));
  await page.waitForTimeout(1200);
  const r2 = await read(page);
  assert.equal(r2.starts.length, 0, 'no s1 after the refresh');
  assert.ok(!r2.haptics.includes('seal'), 'no seal haptic after the refresh');
  assert.ok(r2.frames.length > 0 && r2.frames.every(f => f.scale === 1 && f.seal === 1 && f.foot === 1 && !f.late), 'the seal, rows and footer are in their final state on every frame: nothing replays');
  assert.equal(await page.locator(`${topSel('work-cell')}.sz-wcell--in`).count(), 0, 'cells are not animating');

  step('one tap jumps to the final state: s1 and the haptic are sent on the same frame, right away');
  await page.evaluate(() => window.__shiziTest.reset());
  await page.evaluate(async () => (await import('/src/platform/sound.js')).resetSound());
  const w2 = await seedWork(page, { id: 's932', chars: ['永', '和', '春', '大'], steps: ['correct', 'correct', 'correct', 'correct'] });
  await ready(page);
  await reset(page);
  await openResult(page, { slot: w2.slot, sessionId: w2.sessionId });
  await page.waitForSelector(topSel('work-cell'));
  await page.waitForTimeout(120);
  assert.equal((await read(page)).starts.length, 0, 'still playing the reveal 120ms in');
  const tapAt = await page.evaluate(() => performance.now());
  await page.mouse.click(10, 300);
  await page.waitForFunction(() => window.__c3.starts.length >= 1, null, { timeout: 3000 });
  await page.waitForTimeout(300);
  const r3 = await read(page);
  const t3 = r3.starts[0].t;
  const hi3 = r3.haptics.lastIndexOf('seal');
  assert.ok(t3 - tapAt < 250, `s1 sounds right after the tap (${Math.round(t3 - tapAt)}ms)`);
  assert.equal(frameOf(r3.frames, t3), frameOf(r3.frames, r3.times[hi3]), 'tap: s1 and the seal haptic are on the same frame');
  assert.equal(r3.starts.length, 1, 'once');

  step('reduce motion: only the final state; s1 and the haptic are sent together at once; nothing is hidden');
  await page.evaluate(() => window.__shiziTest.reset());
  await page.evaluate(async () => (await import('/src/platform/sound.js')).resetSound());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w3 = await seedWork(page, { id: 's933', chars: ['永', '和', '春'], steps: ['correct', 'wrong', 'wrong'] });
  await ready(page);
  await reset(page);
  await openResult(page, { slot: w3.slot, sessionId: w3.sessionId });
  await page.waitForFunction(() => window.__c3.starts.length >= 1, null, { timeout: 3000 });
  await page.waitForTimeout(200);
  const r4 = await read(page);
  const hi4 = r4.haptics.lastIndexOf('seal');
  assert.ok(hi4 >= 0, 'reduce motion: the seal haptic is sent');
  assert.ok(Math.abs(frameOf(r4.frames, r4.starts[0].t) - frameOf(r4.frames, r4.times[hi4])) <= 1, 'reduce motion: s1 and the haptic together');
  assert.ok(r4.frames.every(f => f.scale === 1 && f.foot === 1 && !f.late), 'reduce motion: final state, footer and rows never hidden');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await waitNavIdle(page);
}
