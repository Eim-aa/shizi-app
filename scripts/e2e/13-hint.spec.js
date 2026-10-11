// M1-3 提示（02 §3 M1-3；01 §6.4；R-W05；P01 / P17 / P29 / P41）。W1（D34 / D51 ⑧，V2-01 / A2-02）：提示 = 字形轮廓填淡朱实心 + 常驻 1pt 墨三外廓、
// 在本人墨下层，本人墨任何时候都不变暗（像素取样断言），整组 150ms 淡入，没有图例说明句。
// 完成定义：3 画字（大）与 14 画字（聚）的提示笔数与按钮文案序列与 core/hints.js 一致；无笔顺数据的字显示
// 「暂时没有提示」且没有可点的提示按钮；提示次数经 store.commit 写进 sessions[slot].current.hints（M0-6 形状）；
// R-W05 文案。另覆盖：无分组数据的字前 1 / 前 2 笔；写过哪笔收哪笔（D53 ⑧；笔迹始终 100%）；减少动态效果 120ms 淡化；
// 写入失败不阻断且下次写入补上次数；会话现场里 hintRange 还在时静态恢复；无绕过 storage.js 的写入；回忆阶段 DOM 不含答案字。

import {
  bootTestHost, closeWriteMenu, drawStroke, HORIZONTAL, VERTICAL, openWrite, openWriteMenu, seedSession, tap, topSel, waitNavIdle,
} from './helpers.mjs';

const MENU_HINT = '[data-testid="write-ax-menu"] [data-testid="write-hint"]';
const LAYER = topSel('write-hint-layer');


async function open(page, ctx, chars, extra = {}) {
  await page.goto('about:blank'); // 全新的历史条目（同 URL 的 goto 会沿用上一页写字页的 history.state）
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor: 0, ...extra });
  ctx.assert.ok(seeded.ok, `seed session [${chars.join('')}]`);
  await openWrite(page, { slot: 'A' });
}

/** 「⋯」菜单里的提示项（D53 ②：提示不再是页面上的文字按钮）：打开菜单读它的名称 / 状态再关上。没有这一项时返回 null。 */
async function menuHint(page) {
  await openWriteMenu(page);
  const b = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      label: el.getAttribute('aria-label'), text: el.textContent.trim(), state: el.dataset.state, remaining: el.dataset.remaining,
      disabled: el.disabled, ariaDisabled: el.getAttribute('aria-disabled'),
    };
  }, MENU_HINT);
  await closeWriteMenu(page);
  return b;
}

async function waitButton(page, state) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const b = await menuHint(page);
    if (b && b.state === state) return b;
    if (Date.now() > deadline) throw new Error(`hint menu item never became ${state} (${JSON.stringify(b)})`);
    await page.waitForTimeout(300);
  }
}

async function hintState(page, withButton = false) {
  const btn = withButton ? await menuHint(page) : null;
  return page.evaluate(({ layer, btn: b }) => {
    const l = document.querySelector(layer);
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const note = top.querySelector('[data-testid="write-note"]');
    const ink = top.querySelector('[data-testid="write-grid-ink"]');
    return {
      label: b ? b.label : null, // D49：读屏名称（「提示，还有 N 次」）
      text: b ? b.text : null, // 可见文字一直是「提示」
      state: b ? b.state : null,
      disabled: b ? b.disabled : null,
      ariaDisabled: b ? b.ariaDisabled : null,
      layer: l ? l.dataset.state : null,
      from: l && l.dataset.from !== undefined ? Number(l.dataset.from) : null,
      to: l && l.dataset.to !== undefined ? Number(l.dataset.to) : null,
      anim: l ? l.dataset.anim || null : null,
      strokes: l && l.dataset.from !== undefined ? Array.from({ length: Number(l.dataset.to) - Number(l.dataset.from) }, (_, i) => Number(l.dataset.from) + i) : [], // 画出的是 [from, to) 这几笔
      timing: l ? [...l.querySelectorAll('canvas')].map(c => ({ name: getComputedStyle(c).animationName })) : [], // 逐笔动画已没有：画布上都没有动画
      note: note ? note.textContent.trim() : null,
      noteKind: note && note.querySelector('[data-hint-note]') ? note.querySelector('[data-hint-note]').dataset.hintNote : null,
      noteDot: !!(note && note.querySelector('.sz-hintnote__dot')),
      inkOpacity: ink ? Number(getComputedStyle(ink).opacity) : null,
      inkTransition: ink ? getComputedStyle(ink).transitionDuration : null,
    };
  }, { layer: LAYER, btn });
}

/** 本人墨：固化层 canvas 上最不透明的那个像素 + 它到根的有效不透明度（元素与祖先 opacity 连乘）。 */
function inkProbe(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const ink = top.querySelector('[data-testid="write-grid-ink"]');
    let eff = 1;
    for (let el = ink; el && el.nodeType === 1; el = el.parentElement) eff *= Number(getComputedStyle(el).opacity);
    const ctx = ink.getContext('2d');
    const { width, height } = ink;
    const data = ctx.getImageData(0, 0, width, height).data;
    let best = null;
    for (let i = 0; i < data.length; i += 4) {
      if (!best || data[i + 3] > best[3] || (data[i + 3] === best[3] && data[i] < best[0])) best = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }
    return { eff, px: best };
  });
}

function current(page) {
  return page.evaluate(() => {
    const s = window.__shiziTest.getState().sessions;
    return s && s.A ? s.A.current : null;
  });
}

async function pressHint(page) {
  await page.waitForTimeout(450); // 同一按钮两次按下 < 0.4s 不响应（01 §6.6）
  await tap(page, 'write-hint');
}

async function drawN(page, n) {
  for (let i = 0; i < n; i += 1) {
    const y = 0.15 + (0.7 * i) / Math.max(1, n - 1);
    await drawStroke(page, i % 2 ? VERTICAL.map(([x, yy]) => [0.2 + (0.6 * i) / Math.max(1, n), yy]) : [[0.2, y], [0.5, y], [0.8, y]], { steps: 3 });
  }
}

async function waitLayer(page, state) {
  await page.waitForSelector(`${LAYER}[data-state="${state}"]`, { timeout: 5000 });
}

async function noLeak(page, chars) {
  return page.evaluate(cs => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return cs.filter(c => top.outerHTML.includes(c));
  }, chars);
}

export default async function hint(page, ctx) {
  const { assert } = ctx;

  // ---------------------------------------------------------------- 3 画字
  ctx.step('3-stroke 大 (GROUPS [1,2] → 1/4 rule, q = max(1, round(3/4)) = 1)');
  await open(page, ctx, ['大', '聚']);
  await waitButton(page, 'available');
  let h = await hintState(page, true);
  assert.equal(h.label, '提示，还有 2 次', 'R-W05 button screen-reader name starts at 「提示，还有 2 次」');
  assert.equal(h.text, '提示', 'D49: the visible text is just 「提示」 (the count is only in the screen-reader name)');
  assert.deepEqual([h.disabled, h.ariaDisabled], [false, null], 'hint button enabled');
  assert.equal(h.layer, 'none', 'no hint drawn yet');
  assert.equal(h.note, '', 'no note under the grid before a hint');
  assert.deepEqual(await current(page), { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false }, 'session current starts with hints 0');

  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.strokes], [0, 1, [0]], 'hint 1 with 0 written → stroke 0 only');
  assert.equal(h.anim, 'fade', 'the new hint fades in as one group (D51 ⑧: no stroke-by-stroke drawing on the web)');
  assert.ok(h.timing.every(x => x.name === 'none'), 'no per-stroke draw animation (no szHintDraw any more)');
  const fadeIn = await page.evaluate(sel => {
    const cs = getComputedStyle(document.querySelector(sel + ' .sz-hint__group'));
    return { name: cs.animationName, dur: cs.animationDuration };
  }, LAYER);
  assert.deepEqual([fadeIn.name, fadeIn.dur], ['szHintFadeIn', '0.15s'], 'whole group fades in over 150ms (P210)');
  assert.equal(h.label, '提示，还有 1 次', 'button → 「提示，还有 1 次」');
  assert.equal(h.note, '', 'no legend sentence under the grid after a hint (D51 ⑧: 「浅红色是提示……」 deleted, P41)');
  assert.deepEqual([h.noteKind, h.noteDot], [null, false], 'no hint note, no dot');
  await page.waitForTimeout(260);
  h = await hintState(page);
  assert.equal(h.inkOpacity, 1, `own ink is not dimmed (got ${h.inkOpacity})`);
  let cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, { from: 0, to: 1 }], 'store.commit wrote current.hints = 1 and hintRange {0,1}');
  const paint = await page.evaluate(sel => {
    const colorOf = v => {
      const probe = document.createElement('span');
      probe.style.color = `var(${v})`;
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const fill = document.querySelector(sel + ' [data-testid="write-hint-fill"]');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const glyph = top.querySelector('[data-testid="write-glyph-layer"]');
    const ink = top.querySelector('[data-testid="write-grid-ink"]');
    const read = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const f = read(fill);
    let fillPx = 0;
    let partial = 0;
    let fillRgb = null;
    const others = new Set();
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] === 255) {
        fillPx += 1;
        const rgb = `rgb(${f[i]}, ${f[i + 1]}, ${f[i + 2]})`;
        if (!fillRgb) fillRgb = rgb;
        else if (rgb !== fillRgb) others.add(rgb);
      } else if (f[i + 3] > 0) partial += 1;
    }
    return {
      danzhu: colorOf('--danzhu'),
      fillOpacity: getComputedStyle(fill).opacity,
      fillPx, partial, fillRgb, otherColours: others.size,
      ring: !!document.querySelector(sel + ' [data-testid="write-hint-ring"]'),
      underInk: !!(glyph.compareDocumentPosition(ink) & Node.DOCUMENT_POSITION_FOLLOWING), glyphHasHint: glyph.contains(fill),
    };
  }, LAYER);
  assert.equal(paint.fillOpacity, '1', 'D53 ①: the hint wash is opaque (no whole-layer 0.4)');
  assert.ok(paint.fillPx > 300, `wash fill drawn (${paint.fillPx} px)`);
  assert.equal(paint.fillRgb, paint.danzhu, 'fill colour = --danzhu (token) exactly: the opaque wash itself carries the 3:1');
  assert.equal(paint.otherColours, 0, 'one flat colour: no ring, no ink3');
  assert.equal(paint.ring, false, 'no outer ring canvas any more (D53 ①: the ink3 outline is gone)');
  assert.deepEqual([paint.glyphHasHint, paint.underInk], [true, true], 'the hint lives in the reference layer, which is below the ink canvas in z-order');

  ctx.step('write the next stroke → the (only) hint stroke is taken in (260ms), ink stays 100%, range cleared');
  await drawStroke(page, HORIZONTAL);
  h = await hintState(page);
  assert.ok(h.layer === 'fading' || h.layer === 'none', `the hint stroke starts fading when the stroke is written (${h.layer})`);
  await waitLayer(page, 'none');
  await page.waitForTimeout(250);
  h = await hintState(page);
  assert.equal(h.inkOpacity, 1, 'own ink stays at 100% throughout');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.hintRange === null);
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, null], 'after fade: hints stays 1, hintRange cleared');
  assert.equal(h.note, '', 'still no legend sentence');

  ctx.step('hint 2 continues from the written count (P01): 1 written → stroke 1; the writer\'s ink pixels are unchanged (not dimmed)');
  const inkBefore = await inkProbe(page);
  assert.ok(inkBefore.px && inkBefore.px[3] > 200, `there is solid ink on the grid before the hint (${inkBefore.px})`);
  await pressHint(page);
  await waitLayer(page, 'shown');
  await page.waitForTimeout(400);
  const inkDuring = await inkProbe(page);
  assert.deepEqual(inkDuring.px, inkBefore.px, 'darkest ink pixel is identical while the hint is shown');
  assert.equal(inkDuring.eff, 1, 'effective opacity of the ink canvas (element × ancestors) stays 1');
  assert.equal(inkBefore.eff, 1);
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.strokes], [1, 2, [1]], 'hint 2 with 1 written → stroke 1');
  assert.equal(h.label, '提示已用完', 'button → 「提示已用完」');
  assert.deepEqual([h.state, h.disabled, h.ariaDisabled], ['exhausted', true, 'true'], 'used-up button is disabled + aria-disabled');
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [2, { from: 1, to: 2 }], 'store: hints 2, hintRange {1,2}');
  await page.waitForTimeout(450);
  await tap(page, 'write-hint', { force: true });
  await page.waitForTimeout(100);
  cur = await current(page);
  assert.equal(cur.hints, 2, 'clicking the used-up button changes nothing (hintMax = 2, P17)');
  assert.deepEqual(await noLeak(page, ['大']), [], 'answer character not in the write screen DOM (D16)');

  // ---------------------------------------------------------------- 14 画字
  ctx.step('14-stroke 聚 (GROUPS sum 14 → q = round(14/4) = 4)');
  await open(page, ctx, ['聚']);
  await waitButton(page, 'available');
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.strokes], [0, 4, [0, 1, 2, 3]], 'hint 1 with 0 written → strokes 0–3');
  assert.ok(h.timing.every(x => x.name === 'none'), '4 strokes appear together (one group fade, no stagger on the web)');
  assert.equal(h.label, '提示，还有 1 次', '14-stroke: 「提示，还有 1 次」');
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, { from: 0, to: 4 }], 'store: hints 1, hintRange {0,4}');

  ctx.step('write ONE stroke → only that hint stroke goes (260ms), strokes 1–3 stay; the store keeps the range (D53 ⑧, I3-01)');
  const remaining = () => page.evaluate(sel => document.querySelector(sel).dataset.remaining, LAYER);
  await drawStroke(page, HORIZONTAL);
  await page.waitForFunction(sel => document.querySelector(sel).dataset.remaining === '1,2,3', LAYER, { timeout: 5000 });
  h = await hintState(page);
  assert.ok(h.layer === 'fading' || h.layer === 'shown', `the layer stays (${h.layer})`);
  const outs = await page.evaluate(sel => [...document.querySelectorAll(sel + ' [data-testid="write-hint-out"]')].map(e => e.dataset.stroke), LAYER);
  assert.ok(outs.length === 0 || (outs.length === 1 && outs[0] === '0'), `only stroke 0 can be fading (${JSON.stringify(outs)})`);
  await page.waitForFunction(sel => !document.querySelector(sel + ' [data-testid="write-hint-out"]'), LAYER, { timeout: 2000 });
  assert.equal((await hintState(page)).layer, 'shown', 'after the 260ms the other three hint strokes are still shown');
  assert.equal(await remaining(), '1,2,3');
  const px1 = await page.evaluate(sel => {
    const cv = document.querySelector(sel + ' [data-testid="write-hint-fill"]');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n += 1;
    return n;
  }, LAYER);
  assert.ok(px1 > 100, `the remaining hint strokes are still painted (${px1} px)`);
  cur = await current(page);
  assert.deepEqual(cur.hintRange, { from: 0, to: 4 }, 'store: hintRange unchanged while some hint strokes remain');
  await drawStroke(page, VERTICAL);
  await page.waitForFunction(sel => document.querySelector(sel).dataset.remaining === '2,3', LAYER, { timeout: 5000 });
  ctx.step('undo one stroke → the hint stroke it took in comes back');
  await page.click(topSel('write-undo'));
  await page.waitForFunction(sel => document.querySelector(sel).dataset.remaining === '1,2,3', LAYER, { timeout: 5000 });
  assert.equal((await hintState(page)).layer, 'shown', 'restored hint stroke is visible again');
  ctx.step('write the remaining strokes → the hint layer is gone and the range is cleared');
  await drawN(page, 3);
  await waitLayer(page, 'none');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.hintRange === null);

  ctx.step('write 11 strokes → hint 2 clamps to the last quarter: from = min(11, 14 − 4) = 10');
  await drawN(page, 7); // 已有 4 笔，共 11 笔
  await waitLayer(page, 'none');
  const count = await page.evaluate(sel => Number(document.querySelector(sel).dataset.strokeCount), topSel('write-grid'));
  assert.equal(count, 11, '11 strokes on the grid');
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.strokes], [10, 14, [10, 11, 12, 13]], 'hint 2 → strokes 10–13');
  assert.deepEqual([h.label, h.disabled, h.ariaDisabled], ['提示已用完', true, 'true'], '14-stroke: used up after 2');
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [2, { from: 10, to: 14 }], 'store: hints 2, hintRange {10,14}');
  assert.deepEqual(await noLeak(page, ['聚']), [], 'answer character not in the DOM (D16)');

  ctx.step('14-stroke, second hint without writing: same from (written count unchanged)');
  await open(page, ctx, ['聚']);
  await waitButton(page, 'available');
  await drawN(page, 5);
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
  assert.deepEqual([h.from, h.to], [5, 9], '5 written → strokes 5–8');
  await pressHint(page);
  await page.waitForFunction(sel => document.querySelector(sel).dataset.run === '2', LAYER);
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.label], [5, 9, '提示已用完'], 'second press re-draws 5–8 and uses the last hint');

  // ---------------------------------------------------------------- 无分组数据
  ctx.step('character with stroke data but no group data (custom 𠮷, served with 犇 data) → first 1 / first 2 strokes');
  const benData = await page.evaluate(async () => (await fetch('/data/%E7%8A%87.json')).text());
  await page.route(url => decodeURIComponent(url.pathname).endsWith('/data/𠮷.json'), route => route.fulfill({
    status: 200, contentType: 'application/json', body: benData,
  }));
  await open(page, ctx, ['𠮷']);
  await waitButton(page, 'available');
  await drawN(page, 3);
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
  assert.deepEqual([h.from, h.to], [0, 1], 'prefix mode hint 1 → stroke 0 (ignores written count)');
  await pressHint(page);
  await page.waitForFunction(sel => document.querySelector(sel).dataset.run === '2', LAYER);
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.label], [0, 2, '提示已用完'], 'prefix mode hint 2 → strokes 0–1');
  assert.deepEqual(await noLeak(page, ['𠮷']), [], 'custom character not in the DOM (D16)');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // ---------------------------------------------------------------- 无笔顺数据（10.13）
  ctx.step('no stroke data (404) → 「暂时没有提示」 grey label, no hint button, R-W05 note');
  ctx.allowConsoleError(/^http 404: .*\/data\/%E6%98%A5\.json$/);
  ctx.allowConsoleError(/Failed to load resource: the server responded with a status of 404/);
  // 404 的响应体没人读，下一场景 goto 离开时 Chromium 把它记为 ERR_ABORTED（与本卡逻辑无关）。
  ctx.allowConsoleError(/^requestfailed: .*\/data\/%E6%98%A5\.json net::ERR_ABORTED$/);
  await page.route(url => decodeURIComponent(url.pathname).endsWith('/data/春.json'), route => route.fulfill({ status: 404, body: '' }));
  await open(page, ctx, ['春']);
  await page.waitForSelector(topSel('write-more'), { timeout: 15000 });
  await page.waitForFunction(() => !!document.querySelector('.sz-layer[data-top="true"] [data-hint-note="no-hint"]'), null, { timeout: 15000 });
  await openWriteMenu(page);
  const nd = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="write-ax-menu"]');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const label = menu.querySelector('[data-testid="write-hint-unavailable"]');
    const page = document.querySelector('.sz-page[data-testid="write-screen"]');
    return {
      text: label.textContent.trim(),
      tag: label.tagName,
      button: !!menu.querySelector('[data-testid="write-hint"]'),
      slotButtons: label.querySelectorAll('button').length,
      note: page.querySelector('[data-testid="write-note"]').textContent.trim(),
      dot: !!page.querySelector('[data-testid="write-note"] .sz-hintnote__dot'),
      layer: !!page.querySelector('[data-testid="write-hint-layer"]'),
      fallback: !!page.querySelector('[data-testid="write-glyph-fallback"]'),
      color: getComputedStyle(label).color,
    };
  });
  assert.equal(nd.text, '暂时没有提示', 'R-W05.hintUnavailable');
  assert.deepEqual([nd.tag, nd.button, nd.slotButtons], ['SPAN', false, 0], 'no clickable hint control (grey text item in the 「⋯」 menu, M1-2 NoHintLabel)');
  assert.equal(nd.note, '这个字暂时没有提示，可以直接看答案。', 'R-W05.noHintNote under the grid');
  assert.ok(nd.dot, 'note has the --o dot');
  assert.deepEqual([nd.layer, nd.fallback], [false, false], 'no hint layer and no fallback glyph in recall (D16)');
  await page.click('[data-testid="write-ax-menu"] [data-testid="write-hint-unavailable"]', { force: true });
  await closeWriteMenu(page);
  cur = await current(page);
  assert.equal(cur.hints, 0, 'clicking the grey label records nothing');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // ---------------------------------------------------------------- 减少动态效果
  ctx.step('reduced motion: 120ms fade (02 §3 M1-3 / R-G01)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, ctx, ['大']);
  await waitButton(page, 'available');
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
  assert.equal(h.anim, 'fade', 'layer anim = fade');
  assert.ok(h.timing.every(x => x.name === 'none'), 'no per-stroke draw animation');
  const group = await page.evaluate(sel => {
    const g = document.querySelector(sel + ' .sz-hint__group');
    const cs = getComputedStyle(g);
    return { name: cs.animationName, dur: cs.animationDuration };
  }, LAYER);
  assert.deepEqual([group.name, group.dur], ['szHintFadeIn', '0.12s'], 'group fades in over 120ms (the stroke taken in fades out over 120ms: unit test HintLayer reduced)');
  assert.equal(h.inkOpacity, 1, 'ink is not dimmed in reduced motion either');
  await drawStroke(page, HORIZONTAL);
  await waitLayer(page, 'none');
  h = await hintState(page);
  assert.equal(h.layer, 'none', 'hint gone after the next stroke');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---------------------------------------------------------------- 写入失败不阻断
  ctx.step('commit failure on hint: hint still shown, count kept locally and written with the next commit (P52 口径)');
  await open(page, ctx, ['大']);
  await waitButton(page, 'available');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1));
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page, true);
  assert.equal(h.label, '提示，还有 1 次', 'button still counts the hint');
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [0, null], 'failed write left the store unchanged');
  await drawStroke(page, HORIZONTAL);
  await waitLayer(page, 'none');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.hints === 1);
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, null], 'fade commit catches the count up: hints 1');

  ctx.step('restore: session current already has hints 1 + hintRange → hint shown statically, 1 left');
  await open(page, ctx, ['聚'], { current: { hints: 1, hintRange: { from: 0, to: 4 } } });
  await waitButton(page, 'available');
  await waitLayer(page, 'shown');
  h = await hintState(page, true);
  assert.deepEqual([h.from, h.to, h.anim, h.label], [0, 4, 'static', '提示，还有 1 次'], 'restored hint drawn statically');
  assert.ok(h.timing.every(x => x.name === 'none'), 'no animation on restore');
  await waitNavIdle(page, { settleMs: 50 });

  ctx.step('all localStorage writes went through storage.js');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'no direct localStorage writes');
  const sessionWrites = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'storage' && e.key === 'shizi.v2.sessions' && e.ok).length);
  assert.ok(sessionWrites > 0, `hint counts reached shizi.v2.sessions through storage.js (${sessionWrites} writes)`);
}
