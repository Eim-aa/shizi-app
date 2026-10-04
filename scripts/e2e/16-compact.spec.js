// M1-7 紧凑版写字页（02 §3 M1-7；R-W18 / R-W26 / R-G09；走查-W15 / 核对-V02 / X08；reference/I-proto-write.md §3.7）。
// D36（覆盖 X08）：紧凑版只改排布，不再缩格。D49（阶段 1 E9b，实现交接 §13）起写字页没有「标准 / 紧凑」两套结构：同一个按钮行（主按钮「写好了」满宽 +
// 文字行：左「提示」「看答案」、右「跳过」），书写格边长 = clamp(258, min(屏宽 − 40, 400, 主区高 − 题面 80 − 16 − 工具行 40 − 16), 400)（write/layout.js）。
// 测试浏览器没有安全区，主区高 = 屏高 − 168：360×640 → 320（屏宽 − 40）；320×568 主区不够，落在下限 258。其他视口的格子边长与阶段 / 大字的关系见 16-grid.spec.js。
// 「大字」= 系统字号 XXXL（P1-E6 / D29：模拟原生 shiziContentSize → --k 1.35 + :root[data-text-large]；原 App 内 data-large 1.3 已删）。
// 完成定义：360×640（标准字号与大字各走一遍）书写格 320（recall / trace / retrace 同一边长，点提示前后不变）、
// 按钮区首屏、无横向溢出（scrollWidth ≤ clientWidth）、可点控件全是 <button>、看答案页字形 200–345；
// 另：撤销 / 清空是格下右端的图标按钮（G32 / D36 / D49：标准版与紧凑版同一位置，不再挪到格子上方）、「写好了」满宽一行 +「提示」「看答案」「跳过」（· 结束这组）一行、
// 判断页标题「写对了吗？」可换行不裁切、提示说明与格子 / 按钮留出间距（R-W26，D49 起 ≥ 3）；视口从 360×640 切到 393×852 时书写格变大、结构不变，
// 393×852 + 大字仍是 353（D36：不随大字缩格）；320×568 + 大字抽查无横向溢出、按钮首屏。
// 393×852 标准版不回归由 10 / 11 / 13 / 14 spec 复跑保证。

import {
  bootTestHost, canvasInk, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, seedSession, tid, topSel, VERTICAL, waitNavIdle, openWrite,
  writeSnapshot, setTextSize, LARGE_TEXT,
} from './helpers.mjs';

const SHOTS = process.env.SHIZI_E2E_SHOTS || '';
const COMPACT_VIEW = { width: 360, height: 640 };
const STD_VIEW = { width: 393, height: 852 };
const CHARS = ['越', '大', '永'];
const GRID = 320; // 360×640 的格子边长：min(屏宽 − 40 = 320, 屏高 − 320 = 320)（write/layout.js，D49）
const GRID_FLOOR = 258; // 320×568：568 − 320 = 248 < 258，取下限（policy.writeGrid.min）
const GRID_393 = 353; // 393×852：屏宽 393 − 40（页边 20），高度够

/** 每个 testid 若出现就必须是 <button>（原型紧凑版这些是 span / div，R-G09 要求真按钮）。 */
const CONTROL_IDS = [
  'page-back', 'write-continue', 'write-undo', 'write-clear', 'write-hint', 'write-done', 'write-show-answer', 'write-skip',
  'write-line-change', 'write-judge-wrong', 'write-judge-correct', 'write-answer-self', 'write-answer-trace',
  'write-answer-next', 'write-trace-done', 'write-retrace-trace', 'write-answer-show', 'write-change-cancel',
  'write-change-flip', 'confirm-ok', 'confirm-cancel', 'write-end',
];

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function waitStrokes(page, n) {
  await page.waitForFunction(k => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === k;
  }, n);
}

/** SHIZI_E2E_SHOTS=<目录> 时每次量几何前截一张图（验收走查用，不进仓库）。 */
let shotSeq = 0;
async function shot(page, name) {
  if (!SHOTS) return;
  shotSeq += 1;
  const scheme = await page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  await page.screenshot({ path: `${SHOTS}/c${String(shotSeq).padStart(2, '0')}-${scheme}-${name}.png` });
}

/** 写字页几何与控件检查（顶层图层 + 遮罩层）；name 给截图命名。 */
async function geometry(page, name = 'view') {
  await shot(page, name);
  return page.evaluate(ids => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const q = id => document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`)
      || document.querySelector(`[data-testid="${id}"]`);
    const body = top.querySelector('.sz-page__body');
    const foot = top.querySelector('.sz-page__foot');
    const title = top.querySelector('[data-page-title]');
    const write = top.querySelector('.sz-write');
    const tcs = title ? getComputedStyle(title) : null;
    // 所有看起来可点的元素（手型光标 / role=button / 可 Tab 聚焦 / onclick 属性）必须是 <button> 或在 <button> 里。
    const scope = [top, ...document.querySelectorAll('.sz-overlay, [role="dialog"], [role="alertdialog"]')];
    const seen = new Set();
    const nonButtons = [];
    for (const root of scope) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const looksClickable = cs.cursor === 'pointer' || el.getAttribute('role') === 'button'
          || el.hasAttribute('onclick') || (el.tabIndex >= 0 && !/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
            && el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1');
        if (looksClickable && !el.closest('button')) {
          nonButtons.push(`${el.tagName}.${el.className && el.className.baseVal === undefined ? el.className : ''}[${el.getAttribute('data-testid') || ''}]`);
        }
      }
    }
    const controls = {};
    for (const id of ids) {
      const el = q(id);
      if (el) controls[id] = { tag: el.tagName, rect: rect(el) };
    }
    const r = {};
    for (const id of ['write-grid', 'write-prompt', 'write-line-slot', 'write-tools', 'write-note', 'write-answer-card',
      'write-compare', 'write-links', 'write-answer-slot', 'write-skip-slot', 'write-trace-layer', 'write-change-sheet',
      'write-answer-confirm', 'write-hint-unavailable']) r[id] = rect(q(id));
    const note = q('write-note');
    const toolsEl = q('write-tools');
    return {
      toolsVisible: !!toolsEl && getComputedStyle(toolsEl).visibility !== 'hidden',
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      bodyScroll: body ? { sw: body.scrollWidth, cw: body.clientWidth, sh: body.scrollHeight, ch: body.clientHeight, top: body.scrollTop } : null,
      bodyRect: rect(body),
      foot: rect(foot),
      head: rect(top.querySelector('.sz-page__head')),
      lead: rect(top.querySelector('.sz-page__lead > *')),
      trail: rect(top.querySelector('.sz-page__trail > *')),
      title: title ? {
        rect: rect(title), text: title.textContent, sw: title.scrollWidth, cw: title.clientWidth,
        ellipsis: tcs.textOverflow === 'ellipsis' && tcs.overflowX !== 'visible', whiteSpace: tcs.whiteSpace,
        lines: Math.round(title.getBoundingClientRect().height / (parseFloat(tcs.lineHeight) || 1)),
      } : null,
      compact: write ? write.dataset.compact : null,
      phase: write ? write.dataset.phase : null,
      large: document.documentElement.hasAttribute('data-text-large'),
      noteText: note ? note.textContent.trim() : null,
      nonButtons,
      controls,
      r,
    };
  }, CONTROL_IDS);
}

function inView(g, b, slack = 0.5) {
  return !!b && b.top >= -slack && b.left >= -slack && b.bottom <= g.vh + slack && b.right <= g.vw + slack;
}

/** 通用断言：无横向溢出、可点控件全是按钮、列出的控件（存在的）都在首屏。 */
function common(assert, g, label, firstScreen = []) {
  assert.ok(g.docScrollWidth <= g.docClientWidth, `${label}: no horizontal page overflow (scrollWidth ${g.docScrollWidth} ≤ clientWidth ${g.docClientWidth})`);
  assert.ok(!g.bodyScroll || g.bodyScroll.sw <= g.bodyScroll.cw, `${label}: page body has no horizontal overflow (${g.bodyScroll && g.bodyScroll.sw} ≤ ${g.bodyScroll && g.bodyScroll.cw})`);
  assert.deepEqual(g.nonButtons, [], `${label}: every clickable-looking element is a <button> (or inside one)`);
  const notButton = Object.entries(g.controls).filter(([, c]) => c.tag !== 'BUTTON').map(([id, c]) => `${id}:${c.tag}`);
  assert.deepEqual(notButton, [], `${label}: every write-screen control present is a <button>`);
  const out = Object.entries(g.controls).filter(([, c]) => c.rect && (c.rect.left < -0.5 || c.rect.right > g.vw + 0.5))
    .map(([id]) => id);
  assert.deepEqual(out, [], `${label}: every control is horizontally inside 0–${g.vw}`);
  // 系统字号 XXXL 下最矮的屏（360×640 / 320×568）格子不缩（D36），格下说明折行时整页可滚（§13.3）；点到贴着按钮行的控件会把页面滚几个点，不算「首屏被滚走」
  if (g.bodyScroll && !(g.large && g.vh <= 640)) assert.equal(g.bodyScroll.top, 0, `${label}: page body not scrolled (first screen)`);
  const missing = firstScreen.filter(id => !g.controls[id] || !g.controls[id].rect);
  assert.deepEqual(missing, [], `${label}: first-screen controls rendered [${firstScreen.join(', ')}]`);
  const offscreen = firstScreen.filter(id => g.controls[id] && !inView(g, g.controls[id].rect)).map(id => `${id}@${JSON.stringify(g.controls[id].rect)}`);
  assert.deepEqual(offscreen, [], `${label}: button area on the first screen (inside 0–${g.vh})`);
}

function square(b, size) {
  return !!b && Math.abs(b.width - size) < 1 && Math.abs(b.height - size) < 1;
}

async function setMode(page, ctx, { view, large }) {
  await page.setViewportSize(view);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, large ? LARGE_TEXT : 'L');
}

async function compactWalk(page, ctx, { large }) {
  const { assert } = ctx;
  const tag = `360×640${large ? ' large' : ''}`;
  await setMode(page, ctx, { view: COMPACT_VIEW, large });
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, `${tag}: seed A session [${CHARS.join('')}]`);
  await openWrite(page, { slot: 'A' });
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`, { timeout: 15000 });
  await page.mouse.move(1, 1);

  // ---------------------------------------------------------------- recall
  ctx.step(`${tag}: recall — grid ${GRID}, 写好了 full width over one text row, buttons on the first screen`);
  let g = await geometry(page, `${large ? 'L' : 'N'}-recall`);
  assert.equal(g.compact, 'true', `${tag}: write screen is in compact mode`);
  assert.equal(g.large, large, `${tag}: data-text-large ${large ? 'on' : 'off'}`);
  assert.ok(square(g.r['write-grid'], GRID), `${tag}: recall grid is ${GRID}×${GRID} (D49 formula: min(W − 40, H − 320)) ${JSON.stringify(g.r['write-grid'])}`);
  common(assert, g, `${tag} recall`, ['page-back', 'write-hint', 'write-done', 'write-show-answer', 'write-skip']);
  const c = g.controls;
  assert.ok(Math.abs(c['write-done'].rect.left - 20) < 1 && Math.abs(c['write-done'].rect.right - (g.vw - 20)) < 1, `${tag}: 写好了 is the only main button, full width (${c['write-done'].rect.left}–${c['write-done'].rect.right})`);
  assert.ok(Math.abs(c['write-hint'].rect.top - c['write-show-answer'].rect.top) < 2 && c['write-hint'].rect.right <= c['write-show-answer'].rect.left + 0.5,
    `${tag}: 提示 and 看答案 are two text buttons on one row (not merged, D49 ②), 提示 first`);
  assert.ok(Math.abs(c['write-show-answer'].rect.top - c['write-skip'].rect.top) < 2
    && Math.abs(c['write-show-answer'].rect.bottom - c['write-skip'].rect.bottom) < 2, `${tag}: 看答案 and 跳过 share one row`);
  assert.ok(c['write-hint'].rect.top >= c['write-done'].rect.bottom - 0.5, `${tag}: the text row is below 写好了`);
  assert.ok(c['write-show-answer'].rect.right <= c['write-skip'].rect.left, `${tag}: 看答案 left of 跳过`);
  // D49：文字行两端对齐——「提示」「看答案」在左、跳过在右；不再有「提示 · 还有 N 次」描边按钮。
  const skipRight = c['write-skip'].rect.right;
  assert.ok(Math.abs(skipRight - (g.vw - 20)) < 8, `${tag}: 跳过 sits at the right end of the text row (${skipRight.toFixed(1)} vs ${g.vw - 20})`);
  assert.ok(Math.abs(c['write-hint'].rect.left - 20) < 8, `${tag}: 提示 sits at the left end of the text row (${c['write-hint'].rect.left.toFixed(1)})`);
  assert.ok(!!g.r['write-links'], `${tag}: the combined link row (write-links) is rendered`);
  assert.ok(c['write-done'].rect.height >= 54 - 0.5, `${tag}: the main button ≥ 54 tall`);
  assert.ok(Math.min(c['write-hint'].rect.height, c['write-show-answer'].rect.height, c['write-skip'].rect.height) >= 44 - 0.5, `${tag}: text buttons ≥ 44 tall`);
  const hintBtn = await page.$eval(topSel('write-hint'), el => ({ sw: el.scrollWidth, cw: el.clientWidth, ws: getComputedStyle(el).whiteSpace }));
  assert.ok(hintBtn.sw <= hintBtn.cw + 0.5, `${tag}: 提示 button text not cut (${hintBtn.sw} ≤ ${hintBtn.cw})`);
  const grid0 = g.r['write-grid'];
  assert.ok(grid0.top >= g.head.bottom && grid0.bottom <= g.foot.top + 0.5, `${tag}: whole grid visible between header and footer`);
  assert.ok(g.r['write-prompt'] && g.r['write-prompt'].bottom <= grid0.top + 0.5, `${tag}: prompt above the grid`);
  assert.ok(!g.toolsVisible, `${tag}: 撤销 / 清空 hidden before the first stroke (「在纸上写」takes the slot, P191)`);

  // ---------------------------------------------------------------- hint
  ctx.step(`${tag}: 提示 — grid size unchanged, no note under the grid (D51 ⑧), buttons still first screen`);
  await page.click(topSel('write-hint'));
  await page.waitForSelector(`${topSel('write-hint-layer')}[data-state="shown"]`);
  await page.waitForTimeout(300);
  g = await geometry(page, `${large ? 'L' : 'N'}-hint`);
  assert.ok(square(g.r['write-grid'], GRID), `${tag}: grid still ${GRID} after 提示`);
  assert.ok(!g.noteText, `${tag}: no legend note under the grid after a hint (D51 ⑧: 「浅红色是提示……」 deleted)`);
  assert.equal(await page.locator('.sz-layer[data-top="true"] [data-hint-note]').count(), 0, `${tag}: no hint note element`);
  common(assert, g, `${tag} hint`, ['write-hint', 'write-done', 'write-show-answer', 'write-skip']);

  // ---------------------------------------------------------------- tools at the grid's bottom right
  ctx.step(`${tag}: first stroke — 撤销 / 清空 icon buttons appear at the bottom right of the grid (G32 / D49), grid unchanged`);
  await drawStroke(page, HORIZONTAL);
  await waitStrokes(page, 1);
  await page.waitForTimeout(300);
  await page.mouse.move(1, 1);
  g = await geometry(page, `${large ? 'L' : 'N'}-written`);
  const undo = g.controls['write-undo'] && g.controls['write-undo'].rect;
  const clear = g.controls['write-clear'] && g.controls['write-clear'].rect;
  assert.ok(g.toolsVisible && !!undo && !!clear, `${tag}: 撤销 / 清空 visible after a stroke`);
  // D49：可见 36、热区 44，居中在 40 高的工具行里，热区各向上 / 下多出 2
  assert.ok(undo.top >= g.r['write-grid'].bottom - 2.5 && clear.top >= g.r['write-grid'].bottom - 2.5,
    `${tag}: 撤销 / 清空 sit below the grid (G32; the 44 hit box reaches 2pt up into the row's edge)`);
  // 工具在格下一行的右端：不在格子右缘以左（格子比一行窄时落在行的右端，也就是格子的右下方）。
  assert.ok(clear.right >= g.r['write-grid'].right - 1 && clear.left >= g.r['write-grid'].left + g.r['write-grid'].width / 2,
    `${tag}: 清空 sits at the right end of the row under the grid (${clear.left}–${clear.right} vs grid ${g.r['write-grid'].left}–${g.r['write-grid'].right})`);
  assert.ok(clear.right <= g.vw + 0.5 && undo.right <= clear.left + 4.5, `${tag}: 撤销 then 清空 (hit boxes overlap by 4: visible icons 4 apart), inside the viewport`);
  assert.ok(Math.abs(undo.top - clear.top) < 1, `${tag}: 撤销 / 清空 on one line`);
  assert.ok(Math.min(undo.height, clear.height, undo.width, clear.width) >= 44 - 0.5, `${tag}: tool buttons keep a ≥44pt touch target (${undo.width}×${undo.height}, ${clear.width}×${clear.height})`);
  // 44 的热区盒比 40 高的工具行多出上下各 2；系统字号 XXXL 时题面的拼音行比标称高（+5.7），最矮的屏上书写格组只剩 4 的余量，会再顶下去一点点（书写格不随字号缩，D36）
  assert.ok(g.foot.top - Math.max(undo.bottom, clear.bottom) >= (large ? -6 : -2.5), `${tag}: tools above the footer (the 44 hit boxes may reach into the 4pt spare under the group${large ? '; at XXXL the taller pinyin row eats a bit more' : ''})`);
  const icons = await page.$$eval('.sz-layer[data-top="true"] .sz-write__ibtn', els => els.map(el => ({ svg: !!el.querySelector('svg'), text: el.textContent.trim(), aria: el.getAttribute('aria-label') })));
  assert.deepEqual(icons, [{ svg: true, text: '', aria: '撤销' }, { svg: true, text: '', aria: '清空' }], `${tag}: 撤销 / 清空 are icon buttons (design-system icons), the words live in the aria-label`);
  assert.ok(square(g.r['write-grid'], GRID), `${tag}: grid still ${GRID} after writing`);
  assert.ok(Math.abs(g.r['write-grid'].top - grid0.top) < 1, `${tag}: grid did not move when the tools appeared`);
  common(assert, g, `${tag} written`, ['write-undo', 'write-clear', 'write-hint', 'write-done', 'write-show-answer', 'write-skip']);
  await page.click(topSel('write-undo'));
  await waitStrokes(page, 0);
  await drawStroke(page, VERTICAL);
  await waitStrokes(page, 1);

  // ---------------------------------------------------------------- compare
  ctx.step(`${tag}: 写好了 → judge page: title wraps instead of being cut, judge buttons first screen`);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await waitPhase(page, 'compare');
  await page.mouse.move(1, 1);
  g = await geometry(page, `${large ? 'L' : 'N'}-compare`);
  assert.equal(g.title.text, '写对了吗？', `${tag}: judge title (D49)`);
  assert.ok(g.title.whiteSpace !== 'nowrap' && !g.title.ellipsis, `${tag}: judge title may wrap (no nowrap / ellipsis)`);
  assert.ok(g.title.sw <= g.title.cw + 0.5, `${tag}: judge title not cut (${g.title.sw} ≤ ${g.title.cw})`);
  assert.ok(g.lead && g.title.rect && g.lead.right <= g.title.rect.left + 8.5, `${tag}: the ‹ (接着写) icon does not overlap the title text box`);
  assert.ok(g.trail && g.title.rect.right <= g.trail.left + 8.5, `${tag}: counter does not overlap the title text box`);
  assert.ok(inView(g, g.r['write-compare']), `${tag}: compare cards inside the viewport`);
  common(assert, g, `${tag} compare`, ['write-continue', 'write-judge-wrong', 'write-judge-correct']);

  ctx.step(`${tag}: 写对了 → next character, result row in the fixed row`);
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.cursor === '1' && w.dataset.phase === 'recall';
  });
  await waitNavIdle(page);
  await page.waitForSelector(topSel('write-line-change'));
  g = await geometry(page, `${large ? 'L' : 'N'}-resultrow`);
  assert.ok(square(g.r['write-grid'], GRID), `${tag}: 2nd char grid ${GRID}`);
  const change = g.controls['write-line-change'].rect;
  // P1-E1b（D46 ⑭）：结果行挪到格下说明位（原先在格子上方整行）
  assert.ok(change.top >= g.r['write-grid'].bottom - 2.5 && inView(g, change), `${tag}: 修改 (result row) under the grid in the note slot, on screen (the 44 hit box reaches 2pt up into the row's edge)`);
  common(assert, g, `${tag} result row`, ['write-line-change', 'write-hint', 'write-done', 'write-show-answer', 'write-skip']);

  ctx.step(`${tag}: 修改 sheet — no horizontal overflow, controls are buttons`);
  await page.click(topSel('write-line-change'));
  await page.waitForSelector(tid('write-change-sheet'));
  await waitNavIdle(page);
  g = await geometry(page, `${large ? 'L' : 'N'}-sheet`);
  assert.ok(g.r['write-change-sheet'] && g.r['write-change-sheet'].right <= g.vw + 0.5, `${tag}: sheet inside the viewport width`);
  common(assert, g, `${tag} sheet`, ['write-change-cancel', 'write-change-flip']);
  await page.click(tid('write-change-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-change-sheet"]'));
  await waitNavIdle(page);

  // ---------------------------------------------------------------- answer
  ctx.step(`${tag}: 看答案 → confirm → answer page: glyph card 200–345, buttons first screen`);
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector(tid('write-answer-confirm'));
  await waitNavIdle(page);
  g = await geometry(page, `${large ? 'L' : 'N'}-confirm`);
  assert.ok(inView(g, g.r['write-answer-confirm']), `${tag}: confirm panel inside the viewport`);
  common(assert, g, `${tag} confirm`, ['confirm-ok', 'confirm-cancel']);
  await page.click(tid('confirm-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
  await waitPhase(page, 'answer');
  await page.waitForSelector(`${topSel('write-answer-card')}[data-state="ready"]`);
  await page.waitForTimeout(300);
  g = await geometry(page, `${large ? 'L' : 'N'}-answer`);
  const card = g.r['write-answer-card'];
  assert.ok(!!card && card.width >= 200 - 0.5 && card.width <= 345 + 0.5 && Math.abs(card.width - card.height) < 1,
    `${tag}: answer glyph card is square and 200–345 (${card && card.width})`);
  assert.ok(card.top >= g.head.bottom - 0.5 && card.bottom <= g.foot.top + 0.5, `${tag}: whole answer card visible above the footer`);
  const svgBox = await page.evaluate(() => {
    const host = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-answer-card"] .sz-answer__anim');
    const svg = host && host.querySelector('svg');
    const b = (svg || host).getBoundingClientRect();
    return { w: b.width, h: b.height, svg: !!svg };
  });
  assert.ok(svgBox.w >= 200 - 0.5 && svgBox.w <= 345 + 0.5, `${tag}: glyph drawing box 200–345 (${svgBox.w}, svg ${svgBox.svg})`);
  common(assert, g, `${tag} answer`, ['write-answer-self', 'write-answer-trace', 'write-answer-next']);

  ctx.step(`${tag}: 描一遍 → trace grid 274; 描好了 → 自己写 grid 274`);
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  g = await geometry(page, `${large ? 'L' : 'N'}-trace`);
  assert.ok(square(g.r['write-grid'], GRID), `${tag}: trace grid ${GRID}`);
  const tl = g.r['write-trace-layer'];
  assert.ok(!!tl && Math.abs(tl.width - GRID) <= 2.5 && Math.abs(tl.height - GRID) <= 2.5,
    `${tag}: trace layer covers the grid inside its border ${JSON.stringify(tl)}`);
  common(assert, g, `${tag} trace`, ['write-trace-done', 'write-answer-next']);
  await drawStroke(page, HORIZONTAL);
  await waitStrokes(page, 1);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  g = await geometry(page, `${large ? 'L' : 'N'}-retrace`);
  assert.ok(square(g.r['write-grid'], GRID), `${tag}: retrace grid ${GRID}`);
  common(assert, g, `${tag} retrace`, ['write-retrace-trace', 'write-answer-next']);
}

function overlaps(a, b) {
  return !!a && !!b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

/**
 * M2 验收 H4：这次选的字（B）在紧凑版各阶段都有「结束这组」（判断页除外），在首屏、是按钮、不压住同一行的其他按钮。
 */
async function compactEnd(page, ctx, { large }) {
  const { assert } = ctx;
  const tag = `360×640${large ? ' large' : ''} picked`;
  await setMode(page, ctx, { view: COMPACT_VIEW, large });
  const seeded = await seedSession(page, { slot: 'B', kind: 'picked', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, `${tag}: seed B session`);
  await openWrite(page, { slot: 'B' });
  await page.mouse.move(1, 1);
  const check = async (label, others) => {
    const g = await geometry(page, `${large ? 'L' : 'N'}-end-${label}`);
    common(assert, g, `${tag} ${label}`, ['write-end', ...others]);
    const end = g.controls['write-end'].rect;
    const hit = others.filter(id => g.controls[id] && overlaps(end, g.controls[id].rect));
    assert.deepEqual(hit, [], `${tag} ${label}: 结束这组 does not cover ${others.join(' / ')}`);
    assert.ok(end.top >= g.foot.top - 0.5, `${tag} ${label}: 结束这组 sits in the footer`);
  };
  ctx.step(`${tag}: recall / answer / trace / retrace all show 结束这组 on the first screen without covering other buttons`);
  await check('recall', ['write-hint', 'write-done', 'write-show-answer', 'write-skip']);
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector(tid('write-answer-confirm'));
  await waitNavIdle(page);
  await page.click(tid('confirm-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
  await waitPhase(page, 'answer');
  await check('answer', ['write-answer-self', 'write-answer-trace', 'write-answer-next']);
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  await check('trace', ['write-trace-done', 'write-answer-next']);
  await drawStroke(page, HORIZONTAL);
  await waitStrokes(page, 1);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  await check('retrace', ['write-retrace-trace', 'write-answer-next']);
}

/** 顶层写字页「刚打开、没有任何输入」的状态：写好了禁用、固化层 0 像素、本地 0 笔、撤销 / 清空不可见。 */
async function blankState(page) {
  const snap = await writeSnapshot(page);
  const ink = await canvasInk(page);
  const toolsVisible = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-undo"]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  return { phase: snap.phase, done: snap.done, strokes: snap.strokes, toolsShown: snap.toolsShown, toolsVisible, ink };
}

function assertBlank(assert, b, label) {
  assert.equal(b.phase, 'recall', `${label}: recall`);
  assert.ok(b.done && b.done.disabled === true && b.done.ariaDisabled === 'true', `${label}: 写好了 disabled + aria-disabled="true" ${JSON.stringify(b.done)}`);
  assert.equal(b.ink, 0, `${label}: committed ink layer has 0 painted pixels`);
  assert.equal(b.strokes, 0, `${label}: 0 local strokes`);
  assert.ok(b.toolsShown === false && b.toolsVisible === false, `${label}: 撤销 / 清空 row not visible`);
}

/**
 * G1 回归（M1 验收）：打开写字页、不做任何输入 → 空白状态（标准 375×812 与紧凑 360×640 各一次）；
 * 再覆盖根因：写字页挂着时 store 被整体替换（reset + seed 同一个字），本地那一笔不能留下 / 画回来，也不能写回新会话；
 * 之后再 push 一个写字页，所有图层都是空白。
 */
async function openBlank(page, ctx, view) {
  const { assert } = ctx;
  const tag = `${view.width}×${view.height}`;
  await setMode(page, ctx, { view, large: false });
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, `${tag}: seed A session (cursor 0, no strokes)`);
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await page.waitForTimeout(900);
  assertBlank(assert, await blankState(page), `${tag} open, no input`);

  ctx.step(`${tag}: a stroke on the mounted screen does not survive a store replacement (reset + seed)`);
  await waitNavIdle(page);
  const g = await page.locator(topSel('write-grid-live')).boundingBox();
  await page.mouse.click(g.x + g.width / 2, g.y + 6); // 单点「点画」（书写格顶部正中）
  await waitStrokes(page, 1);
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.strokes.length === 1);
  // M2 验收 H1 起：写字页一旦按「没有会话」渲染就回到 tab 根（15-recover 覆盖），所以这里的整体替换改为 reset + seed
  // 在同一个任务里完成（store 仍发布两次替换，写字页的本地现场键按替换代数重取；旧实现会把本地那一笔写回新会话）。
  const again = await seedSession(page, { reset: true, slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(again.ok, `${tag}: reset + re-seed the same first character`);
  await page.waitForTimeout(600);
  assertBlank(assert, await blankState(page), `${tag} after re-seed`);
  const stored = await page.evaluate(() => window.__shiziTest.getState().sessions.A.current.strokes.length);
  assert.equal(stored, 0, `${tag}: the new session's current.strokes stays empty (old local stroke not written back)`);

  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForTimeout(900);
  const layers = await page.evaluate(() => [...document.querySelectorAll('[data-testid="write-grid"]')].map(el => ({
    strokes: Number(el.dataset.strokeCount),
    done: el.closest('.sz-page').querySelector('[data-testid="write-done"]').disabled,
  })));
  assert.ok(layers.length === 2 && layers.every(l => l.strokes === 0 && l.done === true),
    `${tag}: both stacked write screens are blank ${JSON.stringify(layers)}`);
  assertBlank(assert, await blankState(page), `${tag} pushed on top`);
}

export default async function compact(page, ctx) {
  const { assert } = ctx;
  // 走查：SHIZI_E2E_SCHEME=dark 时整条 spec 在深色下跑（配合 SHIZI_E2E_SHOTS 截图）。
  if (process.env.SHIZI_E2E_SCHEME) await page.emulateMedia({ colorScheme: process.env.SHIZI_E2E_SCHEME });

  ctx.step('G1: open the write screen without any input → blank (375×812 standard, 360×640 compact)');
  await openBlank(page, ctx, { width: 375, height: 812 });
  await openBlank(page, ctx, COMPACT_VIEW);

  await compactWalk(page, ctx, { large: false });
  await compactWalk(page, ctx, { large: true });
  await compactEnd(page, ctx, { large: false });
  await compactEnd(page, ctx, { large: true });

  ctx.step('393×852 (system text L): standard layout');
  await setMode(page, ctx, { view: STD_VIEW, large: false });
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'std: seed');
  await openWrite(page, { slot: 'A' });
  let g = await geometry(page, 'std393');
  assert.equal(g.compact, 'false', '393×852: standard layout (not compact)');
  assert.ok(square(g.r['write-grid'], GRID_393), `393×852: grid ${GRID_393} = screen width − 40 (D36 / D49) ${JSON.stringify(g.r['write-grid'])}`);
  // D49：标准版与紧凑版同一结构——页底栏两行：写好了（满宽），提示 · 看答案 … 跳过（· 结束这组）
  assert.ok(!!g.r['write-links'], '393×852: the same combined link row (write-links) as the compact layout');
  const c = g.controls;
  assert.ok(c['write-show-answer'].rect.top >= c['write-done'].rect.bottom - 0.5, '393×852: the text row is below 写好了 (same two-row footer)');
  assert.ok(Math.abs(c['write-show-answer'].rect.top - c['write-skip'].rect.top) < 2 && Math.abs(c['write-hint'].rect.top - c['write-skip'].rect.top) < 2, '393×852: 提示 · 看答案 and 跳过 share one row');
  common(assert, g, '393×852', ['write-hint', 'write-done', 'write-show-answer', 'write-skip']);

  ctx.step('393×852 standard layout: after a stroke 撤销 / 清空 sit at the grid\'s bottom right (reference for the compact layout, G32)');
  await drawStroke(page, HORIZONTAL);
  await waitStrokes(page, 1);
  await page.waitForTimeout(300);
  await page.mouse.move(1, 1);
  g = await geometry(page, 'std393-written');
  const toolsRel = gm => ({
    dRight: gm.r['write-grid'].right - gm.controls['write-clear'].rect.right,
    dTop: gm.controls['write-undo'].rect.top - gm.r['write-grid'].bottom,
    fromEdge: gm.vw - gm.controls['write-clear'].rect.right,
    uw: gm.controls['write-undo'].rect.width, cw: gm.controls['write-clear'].rect.width,
    uh: gm.controls['write-undo'].rect.height, ch: gm.controls['write-clear'].rect.height,
  });
  const stdTools = toolsRel(g);
  assert.ok(stdTools.dRight <= 1 && stdTools.dTop >= -2.5, `393×852: tools at the grid's bottom right ${JSON.stringify(stdTools)}`);
  assert.ok(Math.min(stdTools.uw, stdTools.cw, stdTools.uh, stdTools.ch) >= 44 - 0.5, '393×852: tool buttons ≥44pt');
  await page.click(topSel('write-undo'));
  await waitStrokes(page, 0);

  ctx.step('same page, shrink to 360×640 → compact without reload (matchMedia); grow back → standard');
  await page.setViewportSize(COMPACT_VIEW);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.compact === 'true');
  await page.waitForTimeout(200);
  g = await geometry(page, 'resized360');
  assert.ok(square(g.r['write-grid'], GRID), `resized to 360×640: grid ${GRID}`);
  common(assert, g, 'resized to 360×640', ['write-hint', 'write-done', 'write-show-answer', 'write-skip']);
  await page.setViewportSize(STD_VIEW);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.compact === 'false');
  await page.waitForTimeout(200);
  g = await geometry(page, 'resized393');
  assert.ok(square(g.r['write-grid'], GRID_393), `resized back to 393×852: grid ${GRID_393}`);

  ctx.step('393×852 + system text XXXL → compact layout, but the grid keeps its size (D36 overrides X08: larger text no longer shrinks the grid)');
  await setTextSize(page, LARGE_TEXT);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.compact === 'true');
  await page.waitForTimeout(200);
  g = await geometry(page, 'std393large');
  assert.ok(square(g.r['write-grid'], GRID_393), `393×852 large: grid still ${GRID_393}, not ${GRID} (D36) ${JSON.stringify(g.r['write-grid'])}`);
  common(assert, g, '393×852 large', ['write-hint', 'write-done', 'write-show-answer', 'write-skip']);
  await drawStroke(page, HORIZONTAL);
  await waitStrokes(page, 1);
  await page.waitForTimeout(300);
  await page.mouse.move(1, 1);
  g = await geometry(page, 'std393large-written');
  const largeTools = toolsRel(g);
  assert.ok(Math.abs(largeTools.dRight - stdTools.dRight) <= 1 && Math.abs(largeTools.dTop - stdTools.dTop) <= 1
    && Math.abs(largeTools.uh - stdTools.uh) <= 1, `393×852: 撤销 / 清空 sit in the same place relative to the grid in both layouts (G32) ${JSON.stringify({ stdTools, largeTools })}`);
  assert.ok(Math.min(largeTools.uw, largeTools.cw, largeTools.uh, largeTools.ch) >= 44 - 0.5, '393×852 large: tool buttons ≥44pt');

  ctx.step('320×568 + system text XXXL spot check: no horizontal overflow, buttons on the first screen');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);
  g = await geometry(page, '320large');
  assert.equal(g.compact, 'true', '320×568 large: compact');
  assert.ok(square(g.r['write-grid'], GRID_FLOOR), `320×568 large: grid ${GRID_FLOOR} (the floor)`);
  common(assert, g, '320×568 large', ['write-hint', 'write-done', 'write-show-answer', 'write-skip']);
  const doneText = await page.$eval(topSel('write-done'), el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  assert.ok(doneText.sw <= doneText.cw + 0.5, `320×568 large: 写好了 text fits its button (${doneText.sw} ≤ ${doneText.cw})`);
  await setTextSize(page, 'L');
  await page.setViewportSize(STD_VIEW);
}
