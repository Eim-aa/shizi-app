// 阶段 1 E9b（D49 减法修稿；实现交接 §13 写字页（回忆）与 §9 判断页；03 P118 / P151 / P189–P191）。
//
//   A 写字页：回忆阶段页头没有可见标题（读屏页名保留）、只有「‹」与计数；题面整词居中、已给的字不装框、要写的格只画空框；题面 + 书写格 + 格下工具行作为一组
//     在页头与按钮行之间居中（空余 40% 在上，书写格边长 = clamp(258, min(W − 40, 400, 主区高 − 80 − 16 − 40 − 16), 400)）；按钮行只有一个主按钮「写好了」，
//     其下一行文字按钮左「提示」「看答案」、右「跳过」；可点样式 ≤ 2 种（主按钮 / 文字按钮，另有格下图标）；「提示」可见文字只有「提示」、次数在读屏名称里；
//     撤销 / 清空是设计系统图标按钮（可见 36、热区 44）；浅 / 深色；402 / SE / Pro Max 实测值写进断言；AX5（R2-X1，P225）书写格按实际可用高度排、完整在首屏、整页不滚动（含冷启动直接在 AX5）、底栏只有「写好了」+「⋯」；各 AX 档的详细断言在 82–84-x1-write-ax-*.spec.js。
//   B 判断页：页头问题「写对了吗？」、左上与写字页同一个「‹」（读屏名「接着写」）；没有旁注与说明句但读屏名称都在；题面目标格不显示答案（答案只在参考格出现一次）；
//     两格与书写格同一顶边、同一中线，边长按 §9.1 的新公式（402 / SE / Pro Max 实测值写进断言）；AX5：页头问题只留读屏、两格取「上下排 / 并排」格子更大的一种、
//     同屏可比、按钮纵排；纸上那一字：参考字形放到书写格大小，格下说明位「和你纸上的字对照」。
//
// 测试浏览器没有安全区（状态栏 0、按钮行下内边距 8）：主区高 = 屏高 − 44（页头）− 124（按钮行：上 12 + 主按钮 54 + 间 6 + 文字行 44 + 下 8）。
// 设计稿的数值（402：231 / SE：177 / Pro Max：261）带 54 + 34 等安全区，在 test/ui/write-layout.test.mjs 里按稿面输入断言。

import {
  bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, seedSession, setTextSize, tokenRgb, topSel, waitNavIdle, openWrite,
} from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];

/** 打开写字页（A 槽，第二个字「据」：词语「根据」，要写的是第 2 格）。 */
/* eslint-disable no-undef */
// 冷启动直接处于某系统字号档：与原生壳的 WKUserScript 同一做法，文档开始时写 window.__shiziInitialContentSize（?e2eInject=AX5:2.4）。
function installInitialContentSize() {
  const raw = new URLSearchParams(location.search).get('e2eInject');
  if (!raw) return;
  const [category, scale] = raw.split(':');
  window.__shiziInitialContentSize = { category, scale: Number(scale) };
}
/* eslint-enable no-undef */
const COLD_SCALE = { AX5: 2.4, AX3: 2 };

async function boot(page, ctx, { view, scheme = 'light', size = 'L', cold = false, chars = CHARS, cursor = 1, extraState = {} }) {
  await page.setViewportSize(view);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  if (cold && !ctx.coldInit) {
    await page.addInitScript(installInitialContentSize);
    ctx.coldInit = true;
  }
  await bootTestHost(page, ctx.baseURL, cold ? { query: `e2eInject=${size}:${COLD_SCALE[size]}` } : {});
  if (size !== 'L' && !cold) await setTextSize(page, size);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor, extraState });
  ctx.assert.ok(seeded.ok, `${view.width}×${view.height} ${scheme} ${size}: seed A session`);
  await openWrite(page, { slot: 'A' });
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"], ${topSel('write-done')}`, { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.mouse.move(1, 1);
}

async function toCompare(page) {
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await page.waitForFunction(() => {
    const r = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]');
    return !!r && r.dataset.state === 'ready';
  });
  await waitNavIdle(page, { settleMs: 450 });
}

/** 一组几何：页头 / 正文（主区）/ 按钮行 / 题面 / 书写格 / 工具行 / 对照两格；坐标全是视口坐标。 */
async function geo(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2 };
    };
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const body = top.querySelector('.sz-page__body');
    const bs = getComputedStyle(body);
    const wordwrap = top.querySelector('.sz-prompt__wordwrap');
    return {
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      ax: document.documentElement.getAttribute('data-ax'),
      head: rect(top.querySelector('.sz-page__head')),
      body: rect(body),
      bodyPad: [bs.paddingTop, bs.paddingBottom, bs.paddingLeft, bs.paddingRight],
      bodyClient: body.clientHeight,
      bodyScroll: body.scrollHeight,
      foot: rect(top.querySelector('.sz-page__foot')),
      footUnder: top.querySelector('.sz-page__foot').getAttribute('data-under'),
      prompt: rect(q('write-prompt')),
      word: rect(q('write-prompt-word')),
      wordwrap: rect(wordwrap),
      grid: rect(q('write-grid')),
      below: top.querySelector('.sz-write__below') ? rect(top.querySelector('.sz-write__below')) : null,
      mine: rect(q('write-compare-mine')),
      ref: rect(q('write-compare-ref')),
      stage: rect(q('write-compare')),
      stageLayout: q('write-compare') ? q('write-compare').dataset.layout : null,
      done: rect(q('write-done')),
      wrong: rect(q('write-judge-wrong')),
      correct: rect(q('write-judge-correct')),
      undo: rect(q('write-undo')),
      clear: rect(q('write-clear')),
      hint: rect(q('write-hint')),
      answer: rect(q('write-show-answer')),
      skip: rect(q('write-skip')),
    };
  });
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

/** 实现交接 §13.2 的公式，输入是量到的主区高与题面高。 */
function expectWrite({ W, mainH, P }) {
  const g = Math.max(258, Math.min(400, Math.floor(Math.min(W - 40, 400, mainH - P - 16 - 40 - 16))));
  const spare = mainH - (P + 16 + g + 40);
  const ideal = Math.round(spare * 0.4);
  const top = ideal >= 12 ? ideal : Math.max(0, Math.min(12, Math.floor(spare)));
  return { g, top, gridTop: top + P + 16 };
}

export default async function e9bWriteJudge(page, ctx) {
  const { assert, step } = ctx;

  // ------------------------------------------------------------------ A 写字页：结构与位置（浅色，三机型）
  // 实测值（测试浏览器无安全区）：主区高 = 屏高 − 168；P = 80
  const WRITE_CASES = [
    // [宽, 高, 主区高, g, 题面顶（相对正文顶）, 书写格顶（相对正文顶）, 判断页 S]
    [402, 874, 706, 362, 83, 179, 255],
    [375, 667, 499, 335, 12, 108, 187],
    [440, 956, 788, 400, 101, 197, 287],
  ];
  for (const [W, H, mainH, g, topOff, gridOff, S] of WRITE_CASES) {
    const tag = `${W}×${H}`;
    step(`A: ${tag} light — grouped prompt + grid + tools row centered between the header and the button row (main ${mainH}, g ${g}, prompt top ${topOff}, grid top ${gridOff})`);
    await boot(page, ctx, { view: { width: W, height: H } });
    const m = await geo(page);
    assert.deepEqual(m.bodyPad, ['0px', '0px', '20px', '20px'], `${tag}: the body has no top / bottom padding (the main area is the whole body), side margins 20`);
    assert.ok(near(m.body.height, mainH, 0.6), `${tag}: main area = screen − 44 − 124 = ${mainH} (${m.body.height})`);
    assert.ok(near(m.prompt.height, 80, 0.6), `${tag}: the prompt is 80 high (pinyin row 28 + 52 cell)`);
    const e = expectWrite({ W, mainH: m.body.height, P: m.prompt.height });
    assert.equal(e.g, g, `${tag}: formula check — g = ${g}`);
    assert.ok(near(m.grid.width, g) && near(m.grid.height, g), `${tag}: writing grid is ${g}×${g} (${m.grid.width}×${m.grid.height})`);
    assert.ok(near(m.prompt.top - m.body.top, topOff, 1), `${tag}: prompt top ${topOff} below the main-area top, 40% of the spare above (${m.prompt.top - m.body.top})`);
    assert.ok(near(m.grid.top - m.body.top, gridOff, 1), `${tag}: grid top ${gridOff} below the main-area top (${m.grid.top - m.body.top})`);
    assert.ok(near(m.grid.top - m.prompt.bottom, 16), `${tag}: prompt → grid is 16`);
    assert.ok(near(m.below.height, 40, 0.6) && near(m.below.width, g), `${tag}: the tools row is 40 high and as wide as the grid`);
    assert.ok(near(m.grid.cx, m.vw / 2, 0.6) && near(m.word.cx, m.vw / 2, 1.5), `${tag}: the whole word and the grid share the page's midline (${m.word.cx} / ${m.grid.cx})`);
    const bottomSpare = m.body.bottom - m.below.bottom;
    assert.ok(bottomSpare >= topOff * 1.4 - 1 || topOff === 12, `${tag}: the spare below the group (${bottomSpare.toFixed(1)}) is ~60% (above: ${topOff})`);
    assert.ok(m.bodyScroll <= m.bodyClient + 1, `${tag}: nothing to scroll`);
    assert.equal(m.footUnder, null, `${tag}: no hairline on the button row while nothing is pushed under it`);
  }

  step('A: the page header — no visible title in the recall phase (the page name stays for screen readers); ‹ on the left, 撤销 / 清空 + the counter on the right');
  await boot(page, ctx, { view: { width: 402, height: 874 } });
  const head = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const h1 = top.querySelector('[data-page-title]');
    const r = h1.getBoundingClientRect();
    const cs = getComputedStyle(h1);
    const prog = top.querySelector('[data-testid="write-progress"]');
    const pcs = getComputedStyle(prog);
    const pr = prog.getBoundingClientRect();
    const back = top.querySelector('[data-testid="page-back"]');
    return {
      h1Text: h1.textContent, h1: { w: r.width, h: r.height, clip: cs.clip, pos: cs.position },
      prog: { text: prog.textContent, fs: parseFloat(pcs.fontSize), color: pcs.color, num: pcs.fontVariantNumeric, right: window.innerWidth - pr.right },
      back: back ? { aria: back.getAttribute('aria-label'), svg: !!back.querySelector('svg') } : null,
    };
  });
  assert.equal(head.h1Text, '凭记忆写出这个字', 'the screen-reader page name is kept (R-W03.titleRecall)');
  assert.ok(head.h1.w <= 1.5 && head.h1.h <= 1.5, `…but visually hidden (${head.h1.w}×${head.h1.h})`);
  assert.deepEqual([head.prog.text, head.prog.fs, head.prog.color], ['2 / 5', 15, tokenRgb('light', 'ink3')], 'the counter is 15pt ink3');
  assert.ok(head.prog.num.includes('tabular-nums'), 'tabular numbers');
  assert.ok(near(head.prog.right, 20, 1.5), `the counter sits 20 from the right edge (H1: 页边线；${head.prog.right})`);
  assert.deepEqual(head.back, { aria: '返回', svg: true }, 'left: the ‹ icon button');

  step('A: the prompt — the whole word is centered, given characters have no frame, only the blank is framed (frame token, 1pt), pinyin sits above the blank');
  const prompt = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const cells = [...top.querySelectorAll('[data-testid="write-prompt-cell"]')].map(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const glyph = el.querySelector('.sz-pg');
      const gr = glyph ? glyph.getBoundingClientRect() : null;
      return { kind: el.dataset.kind, shadow: cs.boxShadow, border: cs.borderTopWidth, w: r.width, h: r.height, glyph: gr ? gr.width / r.width : null, text: el.textContent.trim() };
    });
    const py = top.querySelector('[data-testid="write-prompt-py"]');
    const blank = top.querySelector('[data-testid="write-prompt-cell"][data-kind="blank"]');
    const pr = py.getBoundingClientRect();
    const br = blank.getBoundingClientRect();
    const pcs = getComputedStyle(py);
    return { cells, py: { text: py.textContent, cx: pr.left + pr.width / 2, bottom: pr.bottom, fs: parseFloat(pcs.fontSize), color: pcs.color }, blank: { cx: br.left + br.width / 2, top: br.top } };
  });
  const given = prompt.cells.find(c => c.kind === 'text');
  const blank = prompt.cells.find(c => c.kind === 'blank');
  assert.ok(given.shadow === 'none' && given.border === '0px', 'a given character is just the glyph: no frame, no border');
  assert.ok(near(given.w, 52) && near(given.h, 52), 'cells are 52 square');
  assert.ok(near(given.glyph, 0.8, 0.02), `the glyph fills 80% of the 52 cell (${given.glyph})`);
  assert.ok(blank.shadow !== 'none' && blank.shadow.includes(tokenRgb('light', 'frame')), `the blank has the 1pt frame colour (${blank.shadow})`);
  assert.equal(blank.shadow.match(/(\d+(\.\d+)?)px/g).join(' '), '0px 0px 0px 1px', 'frame width 1pt, no dashed cross');
  assert.equal(blank.text, 'jù', 'the blank holds nothing but the pinyin above it (no answer, D16)');
  assert.ok(near(prompt.py.cx, prompt.blank.cx, 1) && prompt.py.bottom <= prompt.blank.top + 0.5, 'the pinyin is centered right above the blank');
  assert.deepEqual([prompt.py.fs, prompt.py.color], [15, tokenRgb('light', 'ink2')], 'pinyin 15pt ink2');

  step('A: the button row — exactly one primary button; hint + answer on the left, skip on the right; clickable styles ≤ 2');
  const foot = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const f = top.querySelector('.sz-page__foot');
    const btns = [...f.querySelectorAll('button')].map(b => ({
      id: b.dataset.testid, cls: [...b.classList].filter(c => /^sz-btn--/.test(c)).join(','), disabled: b.disabled,
      aria: b.getAttribute('aria-label'), text: b.textContent.trim(), left: b.getBoundingClientRect().left, top: b.getBoundingClientRect().top,
      right: b.getBoundingClientRect().right, h: b.getBoundingClientRect().height,
      under: getComputedStyle(b).textDecorationLine, color: getComputedStyle(b).color,
    }));
    const page = [...top.querySelectorAll('button')].filter(b => !!(b.offsetWidth || b.offsetHeight)).map(b => [...b.classList].filter(c => /^sz-btn--/.test(c)).join(','));
    return { btns, kinds: [...new Set(page)] };
  });
  const byId = Object.fromEntries(foot.btns.map(b => [b.id, b]));
  assert.deepEqual(foot.btns.map(b => b.id), ['write-done', 'write-hint', 'write-show-answer', 'write-to-paper', 'write-skip'], 'the footer holds exactly these five buttons, in reading order (在纸上写 is the permanent text button after 看答案, P226)');
  assert.equal(foot.btns.filter(b => b.cls === 'sz-btn--primary').length, 1, 'one primary button (写好了)');
  assert.deepEqual([byId['write-hint'].cls, byId['write-show-answer'].cls, byId['write-skip'].cls], ['sz-btn--text', 'sz-btn--text', 'sz-btn--text'], 'hint / answer / skip are all the same text button');
  assert.equal(byId['write-to-paper'].cls, 'sz-btn--text', '在纸上写 is the same text button too');
  assert.ok(foot.btns.every(b => b.cls !== 'sz-btn--secondary'), 'no outlined secondary button in the recall footer');
  assert.deepEqual(foot.kinds.filter(k => k !== 'sz-btn--icon' && k !== 'sz-btn--plain').sort(), ['sz-btn--primary', 'sz-btn--text'], 'clickable styles on the page: primary + text (the icon buttons are the tools / the back icon)');
  assert.ok(foot.kinds.length <= 4, 'icon-like buttons (back, undo, clear) are glyphs, not extra button styles');
  assert.ok(byId['write-hint'].top === byId['write-show-answer'].top && near(byId['write-show-answer'].top, byId['write-skip'].top, 1), 'hint / answer / skip share the text row');
  assert.ok(byId['write-hint'].right <= byId['write-show-answer'].left && byId['write-show-answer'].right <= byId['write-skip'].left, 'order: 提示 看答案 … 跳过');
  assert.ok(near(byId['write-skip'].right, 402 - 20, 6) && near(byId['write-hint'].left, 20, 6), 'text row spans the content width (left group left, 跳过 at the right end)');
  assert.ok(near(byId['write-show-answer'].left - byId['write-hint'].right, 16, 10), `the two helpers are ~16 apart (${byId['write-show-answer'].left - byId['write-hint'].right})`);
  assert.equal(byId['write-done'].disabled, true, '写好了 is disabled before the first stroke');
  assert.ok(!byId['write-hint'].under.includes('underline') && !byId['write-skip'].under.includes('underline'), 'text buttons are not underlined (H1 / D51 ⑥: the single text style is 15 / ink2 / no underline)');

  step('A: 提示 — the visible text is just 「提示」, the remaining count is only in the screen-reader name; used up → ink4, not clickable');
  assert.deepEqual([byId['write-hint'].text, byId['write-hint'].aria], ['提示', '提示，还有 2 次'], 'visible 提示, name 提示，还有 2 次');
  await page.click(topSel('write-hint'));
  await page.waitForSelector(`${topSel('write-hint-layer')}[data-state="shown"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  let h = await page.$eval(topSel('write-hint'), b => ({ text: b.textContent.trim(), aria: b.getAttribute('aria-label'), disabled: b.disabled }));
  assert.deepEqual(h, { text: '提示', aria: '提示，还有 1 次', disabled: false }, 'after one hint: still 「提示」, name says 1 left');
  await page.click(topSel('write-hint'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  h = await page.$eval(topSel('write-hint'), b => ({ text: b.textContent.trim(), aria: b.getAttribute('aria-label'), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), color: getComputedStyle(b).color }));
  assert.deepEqual([h.text, h.aria, h.disabled, h.ariaDisabled], ['提示', '提示已用完', true, 'true'], 'used up: disabled + aria-disabled, name 提示已用完');
  assert.equal(h.color, tokenRgb('light', 'ink4'), 'used up: ink4');

  step('A: undo / clear are icon buttons — visible 36, hit 44, ink2 with ink / ink4 and not clickable without (design-system icons); in place before the first stroke (P226)');
  await boot(page, ctx, { view: { width: 402, height: 874 } });
  const beforeInk = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return { shown: top.querySelector('[data-testid="write-tools"]').dataset.shown, toPaper: !!top.querySelector('[data-testid="write-to-paper"]'),
      disabled: [top.querySelector('[data-testid="write-undo"]').disabled, top.querySelector('[data-testid="write-clear"]').disabled] };
  });
  assert.deepEqual(beforeInk, { shown: 'true', toPaper: true, disabled: [true, true] }, 'before the first stroke the icons are already there (ink4, not tappable, P226) and 「在纸上写」 is a text button in the row under 「写好了」 (D55)');
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(250);
  const tools = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const f = id => {
      const b = top.querySelector(`[data-testid="${id}"]`);
      const r = b.getBoundingClientRect();
      const before = getComputedStyle(b, '::before');
      const svg = b.querySelector('svg').getBoundingClientRect();
      return { tag: b.tagName, text: b.textContent.trim(), aria: b.getAttribute('aria-label'), w: r.width, h: r.height, vis: parseFloat(before.width), visH: parseFloat(before.height),
        icon: svg.width, color: getComputedStyle(b).color, disabled: b.disabled, cx: r.left + r.width / 2 };
    };
    const head = top.querySelector('.sz-page__head').getBoundingClientRect();
    return { undo: f('write-undo'), clear: f('write-clear'), headBottom: head.bottom, undoBottom: top.querySelector('[data-testid="write-undo"]').getBoundingClientRect().bottom };
  });
  assert.deepEqual([tools.undo.tag, tools.undo.text, tools.undo.aria, tools.clear.text, tools.clear.aria], ['BUTTON', '', '撤销', '', '清空'], 'real <button>s with no words, the names are aria-labels');
  assert.ok(tools.undo.w >= 44 - 0.5 && tools.undo.h >= 44 - 0.5 && tools.clear.w >= 44 - 0.5 && tools.clear.h >= 44 - 0.5, 'hit area ≥ 44×44');
  assert.deepEqual([tools.undo.vis, tools.undo.visH, tools.clear.vis, tools.clear.visH], [36, 36, 36, 36], 'visible plate 36×36');
  assert.ok(near(tools.undo.icon, 20, 0.5) && near(tools.clear.icon, 20, 0.5), 'icon 20');
  assert.equal(tools.undo.color, tokenRgb('light', 'ink2'), 'with ink: undo is ink2');
  assert.equal(tools.clear.color, tokenRgb('light', 'ink2'), 'with ink: clear is ink2');
  assert.ok(tools.undoBottom <= tools.headBottom + 0.5 && tools.clear.cx > 402 / 2, `the icons sit in the header, right of the middle (D53 ②) (undo bottom ${tools.undoBottom} ≤ header ${tools.headBottom})`);
  await page.click(topSel('write-clear'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  const afterClear = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const f = id => { const b = top.querySelector(`[data-testid="${id}"]`); return { disabled: b.disabled, color: getComputedStyle(b).color }; };
    return { undo: f('write-undo'), clear: f('write-clear'), shown: top.querySelector('[data-testid="write-tools"]').dataset.shown };
  });
  assert.deepEqual([afterClear.shown, afterClear.undo.disabled, afterClear.clear.disabled], ['true', false, true], 'after 清空: 撤销 can bring the ink back, 清空 is disabled');
  assert.equal(afterClear.clear.color, tokenRgb('light', 'ink4'), 'disabled icon is ink4');
  assert.equal(afterClear.undo.color, tokenRgb('light', 'ink2'), 'enabled icon stays ink2');

  // ------------------------------------------------------------------ A 深色
  step('A: dark paper — same geometry, tokens swap (primary button, text buttons, frame)');
  await boot(page, ctx, { view: { width: 402, height: 874 }, scheme: 'dark' });
  const dark = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const cs = (sel, p) => getComputedStyle(top.querySelector(sel))[p];
    const blank = top.querySelector('[data-testid="write-prompt-cell"][data-kind="blank"]');
    return {
      done: cs('[data-testid="write-done"]', 'backgroundColor'), doneFg: cs('[data-testid="write-done"]', 'color'),
      progress: cs('[data-testid="write-progress"]', 'color'), blank: getComputedStyle(blank).boxShadow,
      grid: top.querySelector('[data-testid="write-grid"]').getBoundingClientRect().width,
    };
  });
  assert.equal(dark.progress, tokenRgb('dark', 'ink3'), 'dark: the counter ink3');
  assert.ok(dark.blank.includes(tokenRgb('dark', 'frame')), 'dark: the blank frame uses the dark frame token');
  assert.ok(near(dark.grid, 362), 'dark: grid 362');

  // ------------------------------------------------------------------ B 判断页（浅色，三机型）
  for (const [W, H, mainH, g, topOff, gridOff, S] of WRITE_CASES) {
    const tag = `${W}×${H}`;
    step(`B: ${tag} judge page — two cells share the writing grid's top edge and midline, S = ${S}`);
    await boot(page, ctx, { view: { width: W, height: H } });
    const grid = (await geo(page)).grid;
    await toCompare(page);
    const m = await geo(page);
    assert.ok(near(m.mine.top, grid.top, 1) && near(m.mine.cx, grid.cx, 1) && near(m.ref.cx, grid.cx, 1), `${tag}: upper cell = the writing grid's top edge (${m.mine.top} vs ${grid.top}) and midline`);
    assert.ok(near(m.ref.top, m.mine.bottom - 1, 1.2), `${tag}: the lower cell hangs on the shared line`);
    assert.ok(near(m.mine.width, m.mine.height) && near(m.ref.width, m.ref.height) && near(m.mine.width, m.ref.width), `${tag}: both cells are the same square`);
    assert.ok(near(m.mine.width, S, 1), `${tag}: S = ${S} (measured ${m.mine.width}) — min(W − 40, ⌊(main ${mainH} − grid top ${gridOff} − 16) ÷ 2⌋)`);
    const exp = Math.min(W - 40, Math.floor((m.body.height - (grid.top - m.body.top) - 16) / 2));
    assert.ok(near(m.mine.width, exp, 1), `${tag}: formula on the measured numbers = ${exp}`);
    assert.ok(m.ref.bottom <= m.body.bottom - 15, `${tag}: the pair ends ≥ 16 above the button row (${(m.body.bottom - m.ref.bottom).toFixed(1)})`);
    assert.ok(m.bodyScroll <= m.bodyClient + 1, `${tag}: the judge page does not scroll`);
    // 按钮行与写字页同一行位：两键在主按钮的位置，文字行留空（同样的 54 + 6 + 44）
    assert.ok(near(m.wrong.height, 54, 0.6) && near(m.correct.height, 54, 0.6) && near(m.wrong.width, m.correct.width, 0.6), `${tag}: the two judge keys are equal secondary buttons, 54 high`);
    assert.ok(near(m.foot.height, 124, 0.6), `${tag}: the button row is as high as on the write page (124, the text row stays empty but keeps its place)`);
  }

  step('B: the judge page header and reading — 写对了吗？, the same ‹ icon, no side notes / sentence, names kept, the answer shows once');
  await boot(page, ctx, { view: { width: 402, height: 874 } });
  const writeBack = await page.$eval(topSel('page-back'), b => b.querySelector('path').getAttribute('d'));
  await toCompare(page);
  const j = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const h1 = top.querySelector('[data-page-title]');
    const cont = top.querySelector('[data-testid="write-continue"]');
    const mine = top.querySelector('[data-testid="write-compare-mine"]');
    const ref = top.querySelector('[data-testid="write-compare-ref"]');
    const prompt = top.querySelector('[data-testid="write-prompt"]');
    const blank = top.querySelector('[data-testid="write-prompt-cell"][data-kind="blank"]');
    const h1r = h1.getBoundingClientRect();
    const pcs = getComputedStyle(h1);
    return {
      title: h1.textContent, titleVisible: h1r.width > 2, titleFs: parseFloat(pcs.fontSize), titleWeight: pcs.fontWeight,
      back: cont ? { aria: cont.getAttribute('aria-label'), text: cont.textContent.trim(), d: cont.querySelector('path').getAttribute('d'), cls: cont.className } : null,
      text: top.innerText, asides: top.querySelectorAll('.sz-compare__aside').length, note: !!top.querySelector('[data-testid="write-judge-note"]'),
      mineAria: mine.getAttribute('aria-label'), refAria: ref.getAttribute('aria-label'), mineRole: mine.getAttribute('role'), refRole: ref.getAttribute('role'),
      promptText: prompt.textContent, blankText: blank.textContent.trim(), fill: !!top.querySelector('.sz-prompt__fill'),
      blankAria: blank.getAttribute('aria-label'),
    };
  });
  assert.deepEqual([j.title, j.titleVisible, j.titleFs, j.titleWeight], ['写对了吗？', true, 17, '500'], 'header question 写对了吗？ (17 / 500)');
  assert.deepEqual([j.back.aria, j.back.text], ['接着写', ''], 'top-left: an icon, screen-reader name 接着写');
  assert.equal(j.back.d, writeBack, 'it is the very same ‹ glyph as the write page back button');
  assert.ok(j.back.cls.includes('sz-btn--icon'), 'same icon button style as the write page back button');
  assert.ok(!j.text.includes('你来判断') && !j.note, 'the sentence 「你来判断，点一下就记下。」 is gone');
  assert.ok(j.asides === 0 && !j.text.includes('你的书写') && !j.text.includes('参考字形'), 'no 「你的书写 / 参考字形」 side notes anywhere');
  assert.equal(j.mineAria, '你的书写，1 笔', 'the upper cell keeps its reading name');
  assert.ok(/^参考字形：据，jù，\d+ 画(，[^，]+)?$/.test(j.refAria), `the lower cell keeps its reading name (${j.refAria})`);
  assert.deepEqual([j.mineRole, j.refRole], ['img', 'img'], 'both cells are role=img');
  assert.ok(!j.promptText.includes('据') && j.blankText === 'jù' && !j.fill, 'the prompt target cell shows no answer — the answer appears only in the reference cell');
  assert.ok(/^要写的字，第 2 个，读 jù，四声$/.test(j.blankAria), `…and keeps the 「要写的字」 reading name (${j.blankAria})`);
  const refPixels = await page.evaluate(() => {
    const c = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"] canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
    return n;
  });
  assert.ok(refPixels > 500, 'the reference glyph (the answer) is drawn once, in the lower cell');
  const jTok = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const bg = id => getComputedStyle(top.querySelector(`[data-testid="${id}"]`));
    return { wrong: bg('write-judge-wrong').boxShadow, correct: bg('write-judge-correct').boxShadow, cb: bg('write-judge-correct').backgroundColor };
  });
  assert.equal(jTok.wrong, jTok.correct, 'both judge keys look identical (D20)');

  step('B: ‹ on the judge page goes back to the writing grid with the ink untouched');
  await page.click(topSel('write-continue'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'recall');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  const back = await page.evaluate(() => ({ strokes: Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount), records: Object.keys(window.__shiziTest.getState().records || {}).length }));
  assert.deepEqual(back, { strokes: 1, records: 0 }, 'the stroke is still there, nothing recorded');

  step('B: dark paper — same geometry, token colours');
  await boot(page, ctx, { view: { width: 402, height: 874 }, scheme: 'dark' });
  const gridD = (await geo(page)).grid;
  await toCompare(page);
  const mD = await geo(page);
  assert.ok(near(mD.mine.top, gridD.top, 1) && near(mD.mine.width, 255, 1), 'dark: same top edge, S 255');
  const darkFrame = await page.$eval(topSel('write-compare-mine'), el => getComputedStyle(el).borderTopColor);
  assert.equal(darkFrame, tokenRgb('dark', 'frame'), 'dark: the cell frame uses the dark frame token');

  // ------------------------------------------------------------------ AX5
  for (const [W, H, wantLayout] of [[402, 874, 'stack'], [375, 667, 'side']]) {
    const tag = `${W}×${H} AX5`;
    step(`AX: ${tag} write page — never scrolls, the whole grid sits above the button row (P225), also on a cold start; prompt cells 83, no hairline`);
    await boot(page, ctx, { view: { width: W, height: H }, size: 'AX5' });
    const a = await geo(page);
    // R2-X1（D51 ⑦，P225）：AX 档按实际可用高度排版——格子完整落在首屏（下限 220），页面正文不滚动；格子大小不再等于 L 档的格子
    assert.ok(a.grid.width >= 220 - 0.5, `${tag}: grid ${a.grid.width.toFixed(0)} ≥ the AX floor 220`);
    assert.ok(a.grid.bottom <= a.foot.top + 0.5, `${tag}: the grid ends above the button row (${a.grid.bottom.toFixed(0)} ≤ ${a.foot.top.toFixed(0)})`);
    assert.ok(a.bodyScroll <= a.bodyClient + 1, `${tag}: nothing to scroll (${a.bodyScroll} ≤ ${a.bodyClient})`);
    assert.equal(a.footUnder, null, `${tag}: no hairline on the button row — nothing is pushed under it`);
    // 冷启动直接在 AX5（原生注入 __shiziInitialContentSize）：同一视口、同一个 g
    await boot(page, ctx, { view: { width: W, height: H }, size: 'AX5', cold: true });
    const cold = await geo(page);
    assert.equal(cold.ax, '5', `${tag} cold start: data-ax 5 from the first frame`);
    assert.ok(near(cold.grid.width, a.grid.width, 0.5), `${tag} cold start straight into AX5: grid ${cold.grid.width} = ${a.grid.width}`);
    await boot(page, ctx, { view: { width: W, height: H }, size: 'AX5' });
    const cell = await page.$eval(topSel('write-prompt-cell') + '[data-kind="blank"]', el => el.getBoundingClientRect().width);
    assert.ok(near(cell, 83.2, 1.2), `${tag}: prompt cells are 52 × min(k, 1.6) = 83 (the word grows, V2-06)`);
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('.sz-layer[data-top="true"] [data-page-title]');
      const r = h1.getBoundingClientRect();
      const prog = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-progress"]').getBoundingClientRect();
      return { w: r.width, h: r.height, headH: document.querySelector('.sz-layer[data-top="true"] .sz-page__head').getBoundingClientRect().height, progH: prog.height };
    });
    assert.ok(title.w <= 1.5 && title.h <= 1.5 && title.headH <= Math.max(44, title.progH) + 1, `${tag}: the hidden title does not take a row in the header — one line, as high as the (capped) counter (${title.w}×${title.h}, header ${title.headH.toFixed(1)}, counter ${title.progH.toFixed(1)})`);
    const links = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const r = id => { const e = top.querySelector(`[data-testid="${id}"]`); return e ? e.getBoundingClientRect() : null; };
      const hint = top.querySelector('[data-testid="write-hint"]');
      return { hint: r('write-hint'), skip: r('write-skip'), done: r('write-done'), vw: window.innerWidth, scrollW: document.documentElement.scrollWidth, fs: hint ? parseFloat(getComputedStyle(hint).fontSize) : null,
        menu: !!top.querySelector('[data-testid="write-more"]') || !!document.querySelector('[data-testid="write-ax-menu"]') };
    });
    assert.ok(links.done.height >= 44 - 0.5 && links.hint && links.skip && links.hint.height >= 44 - 0.5 - 14 && links.skip.height >= 30, `${tag}: 写好了 keeps ≥ 44, 提示 / 跳过 are on the page in the row under it (D55)`);
    assert.ok(links.skip.right <= links.vw - 20 + 6 && links.scrollW <= links.vw, `${tag}: 跳过 stays at the right edge, nothing overflows horizontally`);
    assert.deepEqual([links.menu, links.fs], [false, 22], `${tag}: no 「⋯」 menu; the text row is capped at 22pt (AX5, P261)`);

    step(`AX: ${tag} judge page — the question is only for screen readers, cells take the bigger of stacked / side-by-side (${wantLayout}), both on screen, buttons stacked`);
    await toCompare(page);
    const c = await geo(page);
    const hid = await page.evaluate(() => {
      const h1 = document.querySelector('.sz-layer[data-top="true"] [data-page-title]');
      const r = h1.getBoundingClientRect();
      return { text: h1.textContent, w: r.width, h: r.height };
    });
    assert.deepEqual([hid.text, hid.w <= 1.5 && hid.h <= 1.5], ['写对了吗？', true], `${tag}: 写对了吗？ stays in the DOM for screen readers, visually hidden`);
    const P = c.prompt.height;
    const Sv = Math.floor(Math.min(W - 40, Math.floor((c.body.height - 12 - P - 16 - 16) / 2)));
    const Sh = Math.floor((W - 40 - 12) / 2);
    const want = Sh > Sv ? 'side' : 'stack';
    assert.equal(c.stageLayout, want, `${tag}: layout = the one with bigger cells (stack ${Sv} vs side ${Sh} on the measured main ${c.body.height.toFixed(0)} / prompt ${P.toFixed(0)}) → ${want}`);
    assert.equal(c.stageLayout, wantLayout, `${tag}: expected ${wantLayout} on this screen`);
    const S = want === 'side' ? Sh : Math.max(120, Sv);
    assert.ok(near(c.mine.width, S, 1) && near(c.ref.width, S, 1), `${tag}: both cells ${S}pt (${c.mine.width}, ${c.ref.width})`);
    if (want === 'side') {
      assert.ok(near(c.mine.top, c.ref.top, 1) && c.mine.right <= c.ref.left, `${tag}: side by side, mine on the left, same top`);
      assert.ok(near(c.ref.left - c.mine.right, 12, 1), `${tag}: gap 12`);
    } else {
      assert.ok(near(c.mine.top - c.prompt.bottom, 16, 1), `${tag}: stacked, 16 under the prompt`);
      assert.ok(near(c.ref.top, c.mine.bottom - 1, 1.2), `${tag}: stacked on a shared line`);
    }
    const inside = b => b.top >= c.body.top - 0.5 && b.bottom <= c.body.bottom + 0.5 && b.left >= 0 && b.right <= c.vw;
    assert.ok(inside(c.mine) && inside(c.ref), `${tag}: both cells are fully visible together, no scrolling needed (${c.bodyScroll} ≤ ${c.bodyClient})`);
    assert.ok(c.bodyScroll <= c.bodyClient + 1, `${tag}: the judge body does not scroll`);
    assert.ok(near(c.wrong.left, c.correct.left, 1) && c.wrong.bottom <= c.correct.top + 12.5 && c.wrong.top < c.correct.top, `${tag}: the two judge buttons are stacked, 写错了 above 写对了`);
    assert.ok(near(c.wrong.width, c.correct.width, 1) && near(c.wrong.height, c.correct.height, 1) && c.wrong.height >= 54 - 0.5, `${tag}: same size, ≥ 54 (grows with the text)`);
    assert.ok(near(c.wrong.left, 20, 1) && near(c.wrong.right, W - 20, 1), `${tag}: full width`);
  }

  // ------------------------------------------------------------------ 纸上写
  step('Paper: 在纸上写 — the paper cell and the judge page\'s reference glyph are the writing grid\'s size and place; the slot under it says 「和你纸上的字对照」');
  await boot(page, ctx, { view: { width: 402, height: 874 }, extraState: { settings: { writeMode: 'paper' } } });
  await page.waitForSelector(topSel('write-paper'));
  const paperRecall = await geo(page);
  const gridSize = (await page.$eval(topSel('write-paper'), el => el.getBoundingClientRect())).width;
  assert.ok(near(gridSize, 362, 1), `the paper cell is the writing grid size (${gridSize})`);
  const pn = await page.$eval(topSel('write-paper-note'), el => ({ text: el.textContent.trim(), top: el.getBoundingClientRect().top }));
  assert.equal(pn.text, '这个字记下时会标注「纸上」，不留笔迹。', 'the footnote under the paper cell');
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await page.waitForFunction(() => {
    const r = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]');
    return !!r && r.dataset.state === 'ready';
  });
  await waitNavIdle(page, { settleMs: 450 });
  const pj = await geo(page);
  assert.ok(near(pj.ref.width, 362, 1) && near(pj.ref.top, paperRecall.prompt.bottom + 16, 1.5), `the reference glyph is the writing-grid size, at the writing grid's place (${pj.ref.width}, top ${pj.ref.top.toFixed(1)})`);
  const aside = await page.$eval(topSel('write-compare-aside-ref'), el => ({ text: el.textContent.trim(), top: el.getBoundingClientRect().top, h: el.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color }));
  assert.deepEqual([aside.text, aside.fs, aside.color], ['和你纸上的字对照', 13, tokenRgb('light', 'ink3')], 'the slot under the reference reads 「和你纸上的字对照」 (13, ink3); no 「参考字形 · 」 side note');
  assert.ok(near(aside.top, pj.ref.bottom, 1.5) && near(aside.h, 40, 1), 'it sits in the 40-high tools-row place right under the glyph');
}
