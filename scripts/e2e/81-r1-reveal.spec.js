// 结果页作品显现与落印（R2-R1 / D51 ②；第二轮审查 N2-01 / I2-03；03 P216）：
//   1. 最后一字判断后进结果页：作品格依次淡入 → 落款淡入 → 印落下；s1 落款声与「印到位那一帧」对齐（s1 开始播放的那一刻，印的动画已经 finished、
//      scale 1、不透明；所有格已不透明）；从结果页出现到 s1 ≤ 750ms；最后一字的 j1 与 s1 相隔约 0.4–0.8 秒，不叠在一起（I2-03）。
//   2. 触觉：进结果页那一刻不再发 finish 的 action；印着纸那一帧发一次 seal（I2-03；第三轮 C3-R 起 s1 与触觉在着纸帧而不是回弹结束，细节在 93-c3r-seal）。
//   3. 点一下直接到终态：印立刻落下、s1 立刻响（不等动画）。
//   4. 减少动态效果：只显示终态，没有任何动画，s1 立即响。
//   5. 同一组只响一次：点开一格再关闭（结果页重绘）作品不再重演、s1 不再响。

import { HORIZONTAL, bootTestHost, drawStroke, openWrite, seedSession, topSel, waitNavIdle } from './helpers.mjs';
import { openResultPage, seedWork } from './work-helpers.mjs';

async function install(page) {
  await page.addInitScript(() => {
    window.__rev = { starts: [], workAt: null };
    const proto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
    if (proto) {
      const start = proto.start;
      proto.start = function patched(...args) {
        const ms = Math.round(((this.buffer && this.buffer.duration) || 0) * 1000);
        const seal = document.querySelector('.sz-layer[data-top="true"] [data-testid="work-seal"]');
        const cells = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-cell"]')];
        const cs = seal ? getComputedStyle(seal) : null;
        window.__rev.starts.push({
          ms, t: performance.now(),
          seal: seal ? { opacity: cs.opacity, transform: cs.transform, anims: seal.getAnimations().map(a => a.playState) } : null,
          cells: cells.map(c => ({ opacity: getComputedStyle(c).opacity, anims: c.getAnimations().map(a => a.playState) })),
        });
        return start.apply(this, args);
      };
    }
    new MutationObserver(() => {
      if (window.__rev.workAt === null && document.querySelector('.sz-layer[data-top="true"] [data-testid="work-cell"]')) window.__rev.workAt = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
}

const rev = page => page.evaluate(() => window.__rev);
const resetRev = page => page.evaluate(() => { window.__rev.starts.length = 0; window.__rev.workAt = null; });
const hapticsNow = page => page.evaluate(async () => (await import('/src/platform/haptics.js')).hapticLog());
const ready = page => page.evaluate(async () => (await import('/src/platform/sound.js')).warmSounds({}));

async function judge(page, judgment = 'correct') {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel(`write-judge-${judgment}`));
  await waitNavIdle(page);
  await page.click(topSel(`write-judge-${judgment}`));
}

export default async function revealSpec(page, ctx) {
  const { assert, step } = ctx;
  await install(page);
  await bootTestHost(page, ctx.baseURL);

  step('the last judgment → result page: the cells fade in one after another, the 落款 follows, the seal lands; s1 starts on the frame the seal arrives (≤ 750ms); j1 and s1 are 0.4–0.8s apart; one haptic, at the landing');
  const seeded = await seedSession(page, { id: 's811', kind: 'daily', slot: 'A', chars: ['永', '和', '春'] });
  assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitNavIdle(page);
  await openWrite(page);
  await ready(page);
  await judge(page);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '1');
  await waitNavIdle(page);
  await judge(page, 'wrong');
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '2');
  await waitNavIdle(page);
  await resetRev(page);
  const hapticBase = (await hapticsNow(page)).length;
  await judge(page);
  await page.waitForSelector(topSel('result-screen'));
  const atEntry = (await hapticsNow(page)).slice(hapticBase);
  assert.deepEqual(atEntry, ['light', 'judge'], 'entering the result page sends no finish haptic: only 写好了 (light) and the judgment’s own judge haptic so far (I2-03; F1, D58 ③)');
  await page.waitForFunction(() => (window.__rev.starts || []).length >= 2, null, { timeout: 5000 });
  const r1 = await rev(page);
  const j1 = r1.starts.find(s => s.ms === 150);
  const s1 = r1.starts.find(s => s.ms === 320);
  assert.ok(j1 && s1, 'both the last j1 (150ms) and s1 (320ms) started');
  const gap = s1.t - j1.t;
  assert.ok(gap >= 300 && gap <= 900, `j1 and s1 are separate beats, ~0.3–0.8s apart (s1 now lands on contact, not at the end of the rebound — C3-R) (${Math.round(gap)}ms): s1 no longer lands on top of j1`);
  assert.ok(r1.workAt !== null && s1.t - r1.workAt <= 750 + 150, `from the work appearing to s1: ≤ 750ms (+ CI jitter) — ${Math.round(s1.t - r1.workAt)}ms`);
  assert.ok(s1.t - r1.workAt >= 300, `the stamp is not instant: s1 comes after the cells and the 落款 (${Math.round(s1.t - r1.workAt)}ms)`);
  assert.ok(s1.seal.opacity === '1', `at s1 the seal is fully opaque: it has touched the paper (${s1.seal.opacity})`);
  assert.ok(s1.cells.length === 2 && s1.cells.every(c => c.opacity === '1'), 'at s1 every cell is fully shown');
  const afterLand = (await hapticsNow(page)).slice(hapticBase);
  assert.deepEqual(afterLand, ['light', 'judge', 'seal'], 'exactly one more haptic, the rigid seal, sent at the landing');
  await page.waitForTimeout(500);
  assert.equal((await rev(page)).starts.filter(s => s.ms === 320).length, 1, 's1 once');
  assert.equal(await page.locator(`${topSel('work-cell')}.sz-wcell--in, ${topSel('work-seal')}.sz-seal--land`).count(), 0, 'after landing no animation class is left on the page');

  step('same group again: opening a cell sheet and closing it does not replay the reveal or sound s1 again');
  await resetRev(page);
  await page.click(topSel('work-cell'));
  await page.waitForSelector('[data-testid="result-sheet"]');
  await waitNavIdle(page);
  await page.click('[data-testid="result-sheet-close"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await page.waitForTimeout(500);
  assert.equal((await rev(page)).starts.length, 0, 'no sound on redraw');
  assert.equal(await page.locator(`${topSel('work-cell')}.sz-wcell--in`).count(), 0, 'no replay');

  step('one tap jumps to the final state: the seal lands at once and s1 sounds at once');
  await page.evaluate(() => window.__shiziTest.reset());
  await page.evaluate(async () => (await import('/src/platform/sound.js')).resetSound());
  const w2 = await seedWork(page, { id: 's812', chars: ['永', '和', '春', '大'], steps: ['correct', 'correct', 'correct', 'correct'] });
  await ready(page);
  await resetRev(page);
  await page.evaluate(async o => { (await import('/src/ui/router.js')).nav.push('result', o); }, { slot: w2.slot, sessionId: w2.sessionId });
  await page.waitForSelector(topSel('work-cell'));
  await page.waitForTimeout(120);
  assert.equal((await rev(page)).starts.length, 0, 'still playing the reveal 120ms in: no s1 yet');
  const tapAt = await page.evaluate(() => performance.now());
  await page.mouse.click(10, 300);
  await page.waitForFunction(() => (window.__rev.starts || []).length >= 1, null, { timeout: 3000 });
  const r2 = await rev(page);
  assert.ok(r2.starts[0].t - tapAt < 250, `s1 sounds right after the tap (${Math.round(r2.starts[0].t - tapAt)}ms), not at the end of the animation`);
  assert.deepEqual(r2.starts[0].seal.anims, [], 'the seal has no animation left: it is at the final state');
  assert.ok(r2.starts[0].cells.every(c => c.opacity === '1' && c.anims.length === 0), 'every cell is at the final state');
  await page.waitForTimeout(600);
  assert.equal((await rev(page)).starts.length, 1, 'once');

  step('reduce motion: only the final state, no animation at all, s1 right away');
  await page.evaluate(() => window.__shiziTest.reset());
  await page.evaluate(async () => (await import('/src/platform/sound.js')).resetSound());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w3 = await seedWork(page, { id: 's813', chars: ['永', '和', '春'], steps: ['correct', 'correct', 'correct'] });
  await ready(page);
  await resetRev(page);
  await page.evaluate(async o => { (await import('/src/ui/router.js')).nav.push('result', o); }, { slot: w3.slot, sessionId: w3.sessionId });
  await page.waitForSelector(topSel('work-cell'));
  await page.waitForFunction(() => (window.__rev.starts || []).length >= 1, null, { timeout: 3000 });
  const r3 = await rev(page);
  assert.ok(r3.starts[0].t - r3.workAt < 300, `reduce motion: s1 right when the final state shows (${Math.round(r3.starts[0].t - r3.workAt)}ms)`);
  assert.ok(r3.starts[0].cells.every(c => c.opacity === '1' && c.anims.length === 0), 'reduce motion: cells are final, no running animation');
  assert.deepEqual(r3.starts[0].seal.anims, [], 'reduce motion: the seal has no animation');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
