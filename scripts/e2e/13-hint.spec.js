// M1-3 提示（02 §3 M1-3；01 §6.4；决定-D25 方案①；R-W05 / R-W06；P01 / P17 / P29 / P41）。
// 完成定义：3 画字（大）与 14 画字（聚）的提示笔数与按钮文案序列与 core/hints.js 一致；无笔顺数据的字显示
// 「暂时没有提示」且没有可点的提示按钮；提示次数经 store.commit 写进 sessions[slot].current.hints（M0-6 形状）；
// R-W05 / R-W06 文案。另覆盖：无分组数据的字前 1 / 前 2 笔；写下一笔提示淡出、笔迹恢复；减少动态效果 120ms 淡化；
// 写入失败不阻断且下次写入补上次数；会话现场里 hintRange 还在时静态恢复；无绕过 storage.js 的写入；回忆阶段 DOM 不含答案字。

import {
  bootTestHost, drawStroke, HORIZONTAL, VERTICAL, openWrite, seedSession, topSel, waitNavIdle,
} from './helpers.mjs';

const HINT = topSel('write-hint');
const LAYER = topSel('write-hint-layer');

// 与 core/hints.js / hint-layer.js 同一公式，独立写一遍作对照。
const drawMs = n => Math.round(Math.min(Math.max(1100 / n, 110), 240, 1200 / (0.3 + 0.7 * n)));

async function open(page, ctx, chars, extra = {}) {
  await page.goto('about:blank'); // 全新的历史条目（同 URL 的 goto 会沿用上一页写字页的 history.state）
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor: 0, ...extra });
  ctx.assert.ok(seeded.ok, `seed session [${chars.join('')}]`);
  await openWrite(page, { slot: 'A' });
}

async function waitButton(page, state) {
  await page.waitForSelector(`${HINT}[data-state="${state}"]`, { timeout: 15000 });
}

function hintState(page) {
  return page.evaluate(({ hint, layer }) => {
    const b = document.querySelector(hint);
    const l = document.querySelector(layer);
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const note = top.querySelector('[data-testid="write-note"]');
    const ink = top.querySelector('[data-testid="write-grid-ink"]');
    const paths = l ? [...l.querySelectorAll('[data-testid="write-hint-stroke"]')] : [];
    return {
      label: b ? b.textContent.trim() : null,
      state: b ? b.dataset.state : null,
      disabled: b ? b.disabled : null,
      ariaDisabled: b ? b.getAttribute('aria-disabled') : null,
      layer: l ? l.dataset.state : null,
      from: l && l.dataset.from !== undefined ? Number(l.dataset.from) : null,
      to: l && l.dataset.to !== undefined ? Number(l.dataset.to) : null,
      anim: l ? l.dataset.anim || null : null,
      strokes: paths.map(p => Number(p.dataset.stroke)),
      timing: paths.map(p => {
        const cs = getComputedStyle(p);
        return { dur: cs.animationDuration, delay: cs.animationDelay, name: cs.animationName, ease: cs.animationTimingFunction };
      }),
      note: note ? note.textContent.trim() : null,
      noteKind: note && note.querySelector('[data-hint-note]') ? note.querySelector('[data-hint-note]').dataset.hintNote : null,
      noteDot: !!(note && note.querySelector('.sz-hintnote__dot')),
      inkOpacity: ink ? Number(getComputedStyle(ink).opacity) : null,
      inkTransition: ink ? getComputedStyle(ink).transitionDuration : null,
    };
  }, { hint: HINT, layer: LAYER });
}

function current(page) {
  return page.evaluate(() => {
    const s = window.__shiziTest.getState().sessions;
    return s && s.A ? s.A.current : null;
  });
}

async function pressHint(page) {
  await page.waitForTimeout(450); // 同一按钮两次按下 < 0.4s 不响应（01 §6.6）
  await page.click(HINT);
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
  let h = await hintState(page);
  assert.equal(h.label, '提示 · 还有 2 次', 'R-W05 button starts at 「提示 · 还有 2 次」');
  assert.deepEqual([h.disabled, h.ariaDisabled], [false, null], 'hint button enabled');
  assert.equal(h.layer, 'none', 'no hint drawn yet');
  assert.equal(h.note, '', 'no note under the grid before a hint');
  assert.deepEqual(await current(page), { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false }, 'session current starts with hints 0');

  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
  assert.deepEqual([h.from, h.to, h.strokes], [0, 1, [0]], 'hint 1 with 0 written → stroke 0 only');
  assert.equal(h.anim, 'draw', 'strokes are drawn along medians (not reduced motion)');
  assert.deepEqual(h.timing.map(x => [x.name, x.dur, x.delay, x.ease]), [['szHintDraw', `${drawMs(1) / 1000}s`, '0s', 'cubic-bezier(0.4, 0, 0.2, 1)']],
    'single stroke: 240ms, delay 0, cubic-bezier(.4,0,.2,1) (01 §6.4)');
  assert.equal(h.label, '提示 · 还有 1 次', 'button → 「提示 · 还有 1 次」');
  assert.equal(h.note, '浅红色是提示，只给一部分。接着写下一笔，提示就收起。', 'R-W06 / P41 note under the grid');
  assert.deepEqual([h.noteKind, h.noteDot], ['hint', true], 'note has the --o dot');
  await page.waitForTimeout(260);
  h = await hintState(page);
  assert.ok(Math.abs(h.inkOpacity - 0.35) < 0.01, `own ink dimmed to 35% (got ${h.inkOpacity})`);
  let cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, { from: 0, to: 1 }], 'store.commit wrote current.hints = 1 and hintRange {0,1}');
  const hintColor = await page.evaluate(sel => {
    const p = document.querySelector(sel + ' path');
    const probe = document.createElement('span');
    probe.style.color = 'var(--ar)';
    document.body.appendChild(probe);
    const ar = getComputedStyle(probe).color;
    probe.remove();
    return { stroke: getComputedStyle(p).stroke, ar, width: Number(p.getAttribute('stroke-width')) };
  }, LAYER);
  assert.equal(hintColor.stroke, hintColor.ar, 'hint stroke uses --hint (= --ar)');
  assert.ok(Math.abs(hintColor.width - 18 * (345 - 2 * 345 * 0.06) / 1024) < 0.02, `stroke width 18/1024 units (${hintColor.width})`);

  ctx.step('write the next stroke → hint fades out (260ms), ink restores (200ms), range cleared');
  await drawStroke(page, HORIZONTAL);
  h = await hintState(page);
  assert.ok(h.layer === 'fading' || h.layer === 'none', `hint starts fading on pen-down (${h.layer})`);
  await waitLayer(page, 'none');
  await page.waitForTimeout(250);
  h = await hintState(page);
  assert.equal(h.inkOpacity, 1, 'own ink back to 100%');
  assert.equal(h.inkTransition, '0.2s', 'ink restore transition 200ms');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.hintRange === null);
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, null], 'after fade: hints stays 1, hintRange cleared');
  assert.equal(h.note, '浅红色是提示，只给一部分。接着写下一笔，提示就收起。', 'note stays for the rest of this character');

  ctx.step('hint 2 continues from the written count (P01): 1 written → stroke 1');
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
  assert.deepEqual([h.from, h.to, h.strokes], [1, 2, [1]], 'hint 2 with 1 written → stroke 1');
  assert.equal(h.label, '提示已用完', 'button → 「提示已用完」');
  assert.deepEqual([h.state, h.disabled, h.ariaDisabled], ['exhausted', true, 'true'], 'used-up button is disabled + aria-disabled');
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [2, { from: 1, to: 2 }], 'store: hints 2, hintRange {1,2}');
  await page.waitForTimeout(450);
  await page.click(HINT, { force: true });
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
  h = await hintState(page);
  assert.deepEqual([h.from, h.to, h.strokes], [0, 4, [0, 1, 2, 3]], 'hint 1 with 0 written → strokes 0–3');
  const d4 = drawMs(4);
  assert.deepEqual(h.timing.map(x => [x.dur, x.delay]),
    [0, 1, 2, 3].map(j => [`${d4 / 1000}s`, `${Math.round(j * d4 * 0.7) / 1000}s`]), `4 strokes: ${d4}ms each, stagger ×0.7`);
  assert.equal(h.label, '提示 · 还有 1 次', '14-stroke: 「提示 · 还有 1 次」');
  cur = await current(page);
  assert.deepEqual([cur.hints, cur.hintRange], [1, { from: 0, to: 4 }], 'store: hints 1, hintRange {0,4}');

  ctx.step('write 11 strokes → hint 2 clamps to the last quarter: from = min(11, 14 − 4) = 10');
  await drawN(page, 11);
  await waitLayer(page, 'none');
  const count = await page.evaluate(sel => Number(document.querySelector(sel).dataset.strokeCount), topSel('write-grid'));
  assert.equal(count, 11, '11 strokes on the grid');
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
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
  h = await hintState(page);
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
  h = await hintState(page);
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
  await page.waitForSelector(topSel('write-hint-unavailable'), { timeout: 15000 });
  const nd = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const label = top.querySelector('[data-testid="write-hint-unavailable"]');
    return {
      text: label.textContent.trim(),
      tag: label.tagName,
      button: !!top.querySelector('[data-testid="write-hint"]'),
      slotButtons: top.querySelector('[data-testid="write-hint-slot"]').querySelectorAll('button').length,
      note: top.querySelector('[data-testid="write-note"]').textContent.trim(),
      dot: !!top.querySelector('[data-testid="write-note"] .sz-hintnote__dot'),
      layer: !!top.querySelector('[data-testid="write-hint-layer"]'),
      fallback: !!top.querySelector('[data-testid="write-glyph-fallback"]'),
      color: getComputedStyle(label).color,
    };
  });
  assert.equal(nd.text, '暂时没有提示', 'R-W05.hintUnavailable');
  assert.deepEqual([nd.tag, nd.button, nd.slotButtons], ['SPAN', false, 0], 'no clickable hint control (grey text, M1-2 NoHintLabel)');
  assert.equal(nd.note, '这个字暂时没有提示，可以直接看答案。', 'R-W05.noHintNote under the grid');
  assert.ok(nd.dot, 'note has the --o dot');
  assert.deepEqual([nd.layer, nd.fallback], [false, false], 'no hint layer and no fallback glyph in recall (D16)');
  await page.click(topSel('write-hint-unavailable'));
  cur = await current(page);
  assert.equal(cur.hints, 0, 'clicking the grey label records nothing');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // ---------------------------------------------------------------- 减少动态效果
  ctx.step('reduced motion: 120ms fade instead of stroke-by-stroke drawing (02 §3 M1-3 / R-G01)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, ctx, ['大']);
  await waitButton(page, 'available');
  await pressHint(page);
  await waitLayer(page, 'shown');
  h = await hintState(page);
  assert.equal(h.anim, 'fade', 'layer anim = fade');
  assert.ok(h.timing.every(x => x.name === 'none'), 'no per-stroke draw animation');
  const group = await page.evaluate(sel => {
    const g = document.querySelector(sel + ' g');
    const cs = getComputedStyle(g);
    return { name: cs.animationName, dur: cs.animationDuration, transition: cs.transitionDuration };
  }, LAYER);
  assert.deepEqual([group.name, group.dur, group.transition], ['szHintFadeIn', '0.12s', '0.12s'], 'group fades in / out over 120ms');
  assert.equal(h.inkTransition, '0.12s', 'ink dims over 120ms');
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
  h = await hintState(page);
  assert.equal(h.label, '提示 · 还有 1 次', 'button still counts the hint');
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
  h = await hintState(page);
  assert.deepEqual([h.from, h.to, h.anim, h.label], [0, 4, 'static', '提示 · 还有 1 次'], 'restored hint drawn statically');
  assert.ok(h.timing.every(x => x.name === 'none'), 'no re-draw animation on restore');
  await waitNavIdle(page, { settleMs: 50 });

  ctx.step('all localStorage writes went through storage.js');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'no direct localStorage writes');
  const sessionWrites = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'storage' && e.key === 'shizi.v2.sessions' && e.ok).length);
  assert.ok(sessionWrites > 0, `hint counts reached shizi.v2.sessions through storage.js (${sessionWrites} writes)`);
}
