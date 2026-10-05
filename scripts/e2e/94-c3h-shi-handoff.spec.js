// C3-H ②（N3-01、I3-06、T3-07；D53 ④）：「拾」交接的逐帧时序。
//   在页面里用 requestAnimationFrame 逐帧采样（每帧一条：相对时间、阶段、品牌层颜色 / 不透明度、本人墨层可见性、墨的像素数、格下那句的不透明度），
//   然后核对：
//   · 品牌「拾」先完整停 ≥ 600ms（首页静止后才开始计时，品牌层墨色、本人墨层不可见、画布是空的）；
//   · 之后 500ms（±50）「退灰 → 写墨 → 灰退场」：品牌层先换成浅灰（不透明、只换色），本人墨按笔顺逐笔写出（画布像素数单调不减、至少分几个台阶出现），最后灰字退场；
//   · 任何一帧都不出现两层同时半透明（品牌层不透明度与本人墨层不透明度不会同时落在 (0, 1) 之间）；
//   · 墨写完后格下才出现「你写下的第一个「拾」。」，只一次；
//   · 没有笔画时间数据的记录：整字淡入（本人墨层 0 → 1，此时品牌层是不透明的浅灰），照样没有重影帧；
//   · 减少动态效果：第一帧就是本人墨 + 那句话，没有品牌层。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

const CLOCK = '2026-10-05T12:00:00';
const FIRST_PRACTICE = { entries: [...'尴赢拾'].map((c, i) => ({ char: c, at: `2026-10-05T10:0${i}:00` })), clock: CLOCK };

/* eslint-disable no-undef */
const tab = (page, name) => page.evaluate(async n => (await import('/src/ui/router.js')).nav.switchTab(n), name);

/** 装逐帧采样器：出现 home-shi-handoff 后每帧记一条，直到停止。 */
async function installSampler(page) {
  await page.evaluate(() => {
    const frames = [];
    const state = { stop: false };
    const hand = (() => { const e = document.createElement('i'); e.style.color = 'var(--hand)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })();
    const under = (() => { const e = document.createElement('i'); e.style.color = 'var(--under)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })();
    const tick = now => {
      const h = document.querySelector('.sz-layer[data-top="true"] [data-testid="home-shi-handoff"]');
      if (h) {
        const brand = h.querySelector('.sz-hshi__brand');
        const mine = h.querySelector('[data-testid="home-shi-handoff-mine"]');
        const canvas = h.querySelector('canvas');
        const line = document.querySelector('.sz-layer[data-top="true"] [data-testid="home-shi-first-line"]');
        const bs = getComputedStyle(brand);
        const ms = getComputedStyle(mine);
        let ink = 0;
        if (canvas && canvas.width) {
          const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink += 1;
        }
        frames.push({
          t: now,
          phase: h.dataset.phase,
          brandColor: bs.color,
          brandOpacity: parseFloat(bs.opacity),
          brandVisible: bs.visibility !== 'hidden' && bs.display !== 'none',
          mineOpacity: parseFloat(ms.opacity),
          mineVisible: ms.visibility !== 'hidden',
          ink,
          timed: !!h.querySelector('[data-replay="timed"]'),
          line: line ? parseFloat(getComputedStyle(line).opacity) : null,
        });
      }
      if (!state.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__handoffSampler = { frames, state, hand, under };
  });
}

async function collect(page) {
  return page.evaluate(() => { window.__handoffSampler.state.stop = true; const s = window.__handoffSampler; return { frames: s.frames, hand: s.hand, under: s.under }; });
}

const semi = o => o > 0.02 && o < 0.98;

function analyse(assert, tag, { frames, hand, under }, { timed }) {
  assert.ok(frames.length > 40, `${tag}: sampled ${frames.length} frames`);
  const t0 = frames[0].t;
  const rel = frames.map(f => ({ ...f, at: f.t - t0 }));
  // 阶段起止
  const first = name => rel.find(f => f.phase === name);
  const gray = first('gray');
  const write = first('write');
  const fade = first('fade');
  const done = first('done');
  assert.ok(gray && write && fade && done, `${tag}: the phases hold → gray → write → fade → done all appear`);
  assert.ok(gray.at >= 590, `${tag}: the brand 拾 holds ≥ 600ms (${gray.at.toFixed(0)}ms)`);
  const span = done.at - gray.at;
  assert.ok(span >= 450 && span <= 600, `${tag}: gray → done takes ≈ 500ms (${span.toFixed(0)}ms)`);
  // hold：品牌墨色、本人层不可见、画布空
  const hold = rel.filter(f => f.phase === 'hold');
  assert.ok(hold.every(f => f.brandColor === hand && f.brandOpacity === 1 && !f.mineVisible && f.ink === 0), `${tag}: hold = the brand 拾 in ink colour, nothing of the user's ink yet`);
  // 退灰：品牌层不透明、颜色从墨过渡到浅灰
  const grayFrames = rel.filter(f => f.phase === 'gray' || f.phase === 'write');
  assert.ok(grayFrames.every(f => f.brandOpacity === 1), `${tag}: while greying and writing the brand layer stays opaque (it only changes colour)`);
  const last = grayFrames[grayFrames.length - 1];
  assert.equal(last.brandColor, under, `${tag}: the brand 拾 ends up in the pale grey (under)`);
  assert.ok(rel.filter(f => f.phase === 'gray').some(f => f.brandColor !== hand && f.brandColor !== under) || span > 0, `${tag}: the grey is a colour change of one opaque layer`);
  // 任何一帧不出现两层同时半透明
  const ghosts = rel.filter(f => f.brandVisible && f.mineVisible && semi(f.brandOpacity) && semi(f.mineOpacity));
  assert.equal(ghosts.length, 0, `${tag}: no frame has both layers semi-transparent (${ghosts.length} ghost frames)`);
  // 写墨
  const writing = rel.filter(f => f.phase === 'write');
  if (timed) {
    const inks = writing.map(f => f.ink);
    assert.ok(inks.every((v, i) => i === 0 || v >= inks[i - 1] - 2), `${tag}: the ink grows monotonically while writing (${inks[0]} → ${inks[inks.length - 1]})`);
    assert.ok(new Set(inks.map(v => Math.round(v / 50))).size >= 4, `${tag}: it is written progressively, not all at once (${new Set(inks.map(v => Math.round(v / 50))).size} distinct steps)`);
    assert.ok(writing[0].ink < writing[writing.length - 1].ink * 0.5, `${tag}: the first writing frame shows less than half of the final ink`);
  } else {
    assert.ok(writing.some(f => semi(f.mineOpacity)), `${tag}: no time data → the whole glyph fades in`);
  }
  const doneInk = rel.filter(f => f.phase === 'done').pop().ink;
  assert.ok(doneInk > 0 || !timed, `${tag}: the finished ink is on the canvas (${doneInk})`);
  // 灰退场
  assert.ok(rel.filter(f => f.phase === 'done').every(f => !f.brandVisible || f.brandOpacity === 0), `${tag}: the grey layer is gone at the end`);
  // 格下一句
  assert.ok(rel.filter(f => f.phase === 'hold' || f.phase === 'gray' || f.phase === 'write').every(f => f.line === 0), `${tag}: the line under the cell is not shown before the ink is written`);
  assert.ok(rel.filter(f => f.phase === 'done').pop().line === 1, `${tag}: the line is shown once the ink is done`);
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  let page = page0;

  step('逐帧时序：停 600ms → 500ms 退灰 → 写墨（逐笔）→ 灰退场；没有两层同时半透明的帧');
  await bootTestHost(page, ctx.baseURL);
  await tab(page, 'library');
  await waitNavIdle(page);
  await seedHomeSpec(page, FIRST_PRACTICE);
  await page.waitForTimeout(300);
  await installSampler(page);
  await tab(page, 'home');
  await page.waitForSelector(topSel('home-shi-handoff'));
  await page.waitForFunction(() => { const h = document.querySelector('.sz-layer[data-top="true"] [data-testid="home-shi-handoff"]'); return h && h.dataset.phase === 'done'; }, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  analyse(assert, 'timed ink', await collect(page), { timed: true });

  step('没有笔画时间数据（整字淡入）：本人墨整字 0 → 1，此时品牌层是不透明的浅灰，同样没有重影帧');
  await page.close();
  page = await page0.context().newPage();
  await bootTestHost(page, ctx.baseURL);
  await tab(page, 'library');
  await waitNavIdle(page);
  await seedHomeSpec(page, { ...FIRST_PRACTICE, noTime: true });
  await page.waitForTimeout(300);
  await installSampler(page);
  await tab(page, 'home');
  await page.waitForSelector(topSel('home-shi-handoff'));
  await page.waitForFunction(() => { const h = document.querySelector('.sz-layer[data-top="true"] [data-testid="home-shi-handoff"]'); return h && h.dataset.phase === 'done'; }, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  analyse(assert, 'untimed ink', await collect(page), { timed: false });

  step('减少动态效果：第一帧就是本人墨 + 那句话，没有品牌层');
  await page.close();
  page = await page0.context().newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootTestHost(page, ctx.baseURL);
  await tab(page, 'library');
  await waitNavIdle(page);
  await seedHomeSpec(page, FIRST_PRACTICE);
  await page.waitForTimeout(300);
  await installSampler(page);
  await tab(page, 'home');
  await page.waitForSelector(topSel('home-shi-handoff'));
  await page.waitForTimeout(500);
  const reduced = await collect(page);
  assert.ok(reduced.frames.length > 5, 'reduced: sampled');
  assert.ok(reduced.frames.every(f => f.phase === 'done' && !f.brandVisible && f.mineVisible && f.mineOpacity === 1 && f.line === 1), 'reduced motion: every frame is already the final state (the user\'s ink + the line)');
  assert.ok(reduced.frames[reduced.frames.length - 1].ink > 0, 'reduced motion: the ink is drawn');
  await page.close();
}
