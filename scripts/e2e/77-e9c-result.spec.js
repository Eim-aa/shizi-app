// 阶段 1 E9c（D49 减法修稿；实现交接 §4 / §5）：结果页。
//
//   1. 作品格宽按新表（cw = b，没有底板）：402 → 181 / 181 / 120 / 144 / 120，SE 375 → 167 / 167 / 111 / 134 / 111，Pro Max 440 → 200 / 200 / 133 / 160 / 133；
//      两字时格贴住页边（左右各 20）。
//   2. 没有作品底板（作品纸无背景 / 无内边，页边到格之间是页面纸的颜色，浅深都是）、没有行内小字格的框与通栏细线（行无边框、无阴影；作品下除提醒邀请外没有任何横线）。
//   3. 出口只有页头左上「×」：底栏只有「再写一组」，没有「回到首页」（日常与首练结果页一样）；「×」回首页。
//   4. 行文案是状态词：写错了 / 看过答案 / 跳过了（去引号与重复字名），「放进图里」，纸上行「写对 · 纸上」；朱点在字的右上角（墨迹外框右上外），
//      状态字前不再有点；放进图里 → 该字回到作品、带朱点、这一行消失。
//   5. 复现句用「N 天后再见」（D48，天数相同的字合并），不再是「再来找你」。
//   6. AX5：作品格、落款（宋 13）、印（24）不随字号放大，落款完整；页头标题只给读屏（不再盖住作品）；「放进图里」在状态下方、左边与状态对齐。
//   7. 按钮行发丝线：内容超出时按钮行上沿出现（data-under，hairline），滚到底消失；内容不满一屏时没有；内容不满一屏时整组在页头与按钮行之间居中。
//   8. 像素：页边（x = 6）取页面纸色、格内是笺面（浅深各一次）。

import { bootTestHost, setTextSize, tid, tokenRgb, topSel, waitNavIdle } from './helpers.mjs';
import { openResultPage, resultSnapshot, seedWork } from './work-helpers.mjs';

const CLOCK = '2026-10-05T10:00:00';
const VIEWS = { 402: { width: 402, height: 874 }, 375: { width: 375, height: 667 }, 440: { width: 440, height: 956 } };
const CELLS = { 402: [181, 181, 120, 144, 120], 375: [167, 167, 111, 134, 111], 440: [200, 200, 133, 160, 133] };
const ALL = n => ({ chars: [...'类据路求程'].slice(0, n), steps: Array(n).fill('correct') });
// 6 字：2 写对进作品 + 写错有墨（放进图里）+ 写错没墨 + 看过答案 + 跳过
const ROWS = { chars: [...'类据路求程北'], steps: ['correct', 'correct', 'wrong', 'wrong-noink', 'seen', 'skip'] };

async function boot(page, ctx, { view = 402, scheme = 'light', ax = null } = {}) {
  await page.setViewportSize(VIEWS[view]);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  if (ax) await setTextSize(page, ax);
}

async function show(page, set, { kind = 'daily', id = 's77' } = {}) {
  const g = await seedWork(page, { id, kind, clock: CLOCK, ...set });
  await openResultPage(page, g);
  await page.waitForTimeout(250);
  return g;
}

/** 结果页的几何与样式事实（全部取顶层图层）。 */
async function facts(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = s => top.querySelector(s);
    const all = s => [...top.querySelectorAll(s)];
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
    };
    const cs = (el, p, pseudo) => (el ? getComputedStyle(el, pseudo || null)[p] : null);
    const body = q('.sz-page__body');
    const result = q('[data-testid="result-body"]');
    const paper = q('.sz-work__paper');
    const work = q('[data-testid="work"]');
    const foot = q('.sz-page__foot');
    // 作品下除提醒邀请外，不许有任何横线（border-top / border-bottom / box-shadow）；作品自己的外框（frame / 格间线）不算
    const lines = [];
    for (const el of result.querySelectorAll('*')) {
      if (el.closest('.sz-work') || el.closest('.sz-invite') || el.closest('svg')) continue;
      const st = getComputedStyle(el);
      if (parseFloat(st.borderTopWidth) > 0 || parseFloat(st.borderBottomWidth) > 0 || (st.boxShadow && st.boxShadow !== 'none')) {
        lines.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return {
      grid: rect(q('[data-testid="work-grid"]')),
      cells: all('[data-testid="work-cell"]').map(rect),
      sheets: all('[data-testid="work-sheet"]').map(rect),
      frames: all('.sz-work__frame').map(rect),
      work: rect(work),
      paper: paper ? { bg: cs(paper, 'backgroundImage'), bgc: cs(paper, 'backgroundColor'), pt: cs(paper, 'paddingTop'), pb: cs(paper, 'paddingBottom'), pl: cs(paper, 'paddingLeft') } : null,
      workMargin: work ? cs(work, 'marginLeft') : null,
      kuan: q('[data-testid="work-kuan"]') ? {
        rect: rect(q('[data-testid="work-kuan"]')), fs: cs(q('[data-testid="work-kuan"]'), 'fontSize'), lh: cs(q('[data-testid="work-kuan"]'), 'lineHeight'),
        sw: q('[data-testid="work-kuan"]').scrollWidth, cw: q('[data-testid="work-kuan"]').clientWidth,
      } : null,
      seal: rect(q('[data-testid="work-seal"]')),
      stray: lines,
      rows: all('[data-testid="result-exrow"]').map(row => {
        const glyph = row.querySelector('[data-testid="result-exrow-glyph"]');
        const dot = row.querySelector('[data-testid="result-exrow-dot"]');
        const text = row.querySelector('[data-testid="result-exrow-text"]');
        const add = row.querySelector('[data-testid="result-add"]');
        return {
          ch: row.dataset.char, state: row.dataset.state, h: rect(row).h, text: text.textContent.trim(), aria: row.querySelector('[data-testid="result-exrow-open"]').getAttribute('aria-label'),
          glyph: rect(glyph), dot: rect(dot), textRect: rect(text), add: rect(add), addText: add ? add.textContent.trim() : null,
          bt: cs(row, 'borderTopWidth'), bb: cs(row, 'borderBottomWidth'), sh: cs(row, 'boxShadow'), glyphSh: cs(glyph, 'boxShadow'), glyphBg: cs(glyph, 'backgroundImage'),
          before: cs(text, 'content', '::before'), tagText: row.querySelector('[data-testid="result-exrow-tag"]') ? row.querySelector('[data-testid="result-exrow-tag"]').textContent.trim() : null,
        };
      }),
      workDots: all('[data-testid="work-cell"]').map(c => {
        const d = c.querySelector('[data-testid="work-dot"]');
        return d ? { cell: rect(c), dot: rect(d) } : null;
      }),
      again: all('[data-testid="result-again"]').length,
      leave: all('[data-testid="result-leave"]').length,
      footButtons: foot ? foot.querySelectorAll('button').length : -1,
      foot: rect(foot),
      footUnder: foot ? foot.getAttribute('data-under') : null,
      footShadow: foot ? cs(foot, 'boxShadow') : null,
      body: rect(body),
      bodyBox: body ? { pt: parseFloat(cs(body, 'paddingTop')), pb: parseFloat(cs(body, 'paddingBottom')), sh: body.scrollHeight, ch: body.clientHeight, st: body.scrollTop } : null,
      result: rect(result),
      resultPad: result ? parseFloat(cs(result, 'paddingBottom')) : null,
      title: q('[data-page-title]') ? rect(q('[data-page-title]')) : null,
      preview: q('[data-testid="result-preview"]') ? q('[data-testid="result-preview"]').textContent.trim() : null,
      pageText: top.textContent,
      close: q('[data-testid="page-back"]') ? q('[data-testid="page-back"]').getAttribute('aria-label') : null,
      bg: cs(document.body, 'backgroundColor'),
    };
  });
}

/** PNG 截图里某点的 rgb（在页面里解码；点坐标是 CSS px）。 */
async function pixelsAt(page, points) {
  const buf = await page.screenshot({ type: 'png' });
  return page.evaluate(async ({ b64, pts }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const k = bmp.width / window.innerWidth;
    return pts.map(([x, y]) => {
      const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
      return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    });
  }, { b64: buf.toString('base64'), pts: points });
}

const close = (a, b, eps = 1) => Math.abs(a - b) <= eps;

export default async function (page, ctx) {
  const { assert } = ctx;

  // ---------------------------------------------------------------- 1. 作品格宽按新表
  ctx.step('work cells follow the new table (cw = b, no board): 402 / SE 375 / Pro Max 440 × 1–5 chars; two chars sit on the page edges');
  for (const view of [402, 375, 440]) {
    await boot(page, ctx, { view });
    for (let n = 1; n <= 5; n += 1) {
      await show(page, ALL(n), { id: `s7${n}` });
      const f = await facts(page);
      const c = CELLS[view][n - 1];
      assert.deepEqual([...new Set(f.cells.map(r => r.w))], [c], `${view}: ${n} char(s) → cell ${c}`);
      assert.equal(f.cells.length, n, `${view}/${n}: one cell per char`);
      if (n === 2) {
        assert.ok(close(f.grid.x, 20) && close(f.grid.r, view - 20), `${view}: two chars fill the page edges (20 / ${view - 20}): ${f.grid.x}–${f.grid.r}`);
      }
      assert.ok(f.grid.x >= 19.5 && f.grid.r <= view - 19.5, `${view}/${n}: the work never leaves the gutter`);
      assert.ok(close(f.grid.x + f.grid.w / 2, view / 2, 1), `${view}/${n}: the work is centred`);
      await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
      await waitNavIdle(page);
    }
  }

  // ---------------------------------------------------------------- 2. 没有底板、没有框与通栏线
  ctx.step('no board under the work, no frame around the row glyphs, no rule between rows; only the invitation keeps its hairline');
  await boot(page, ctx, { view: 402 });
  await show(page, ROWS);
  let f = await facts(page);
  assert.equal(f.paper.bg, 'none', 'the work paper has no texture of its own (the cells are the sheet)');
  assert.equal(f.paper.bgc, 'rgba(0, 0, 0, 0)', 'no board colour');
  assert.deepEqual([f.paper.pt, f.paper.pb, f.paper.pl], ['0px', '0px', '0px'], 'no board padding');
  assert.equal(f.workMargin, '0px', 'the work is not pushed out of the gutter');
  assert.equal(f.sheets.length, f.frames.length, 'one sheet per frame rectangle (the sheet is only behind the cells)');
  assert.deepEqual(f.sheets.map(r => [r.x, r.y, r.w, r.h].map(Math.round)), f.frames.map(r => [r.x, r.y, r.w, r.h].map(Math.round)), 'the sheet fills exactly the frame');
  assert.deepEqual(f.stray, [], 'no border-top / border-bottom / box-shadow anywhere under the work (the invitation is the one place with a hairline)');
  assert.ok(f.rows.length === 4, '4 rows');
  for (const row of f.rows) {
    assert.deepEqual([row.bt, row.bb, row.sh, row.glyphSh, row.glyphBg], ['0px', '0px', 'none', 'none', 'none'], `row ${row.ch}: no rule, no frame around the glyph`);
    assert.ok(row.h >= 52 - 0.5, `row ${row.ch}: at least 52 high (${row.h})`);
    assert.ok(close(row.glyph.w, 36) && close(row.glyph.h, 36), `row ${row.ch}: 36pt glyph`);
  }
  assert.ok(f.rows.every(r => close(r.glyph.x, 20)), 'row glyphs sit on the gutter');
  assert.equal(f.footShadow === 'none' || f.footUnder === 'true', true, 'the button row has no hairline unless content runs under it');

  // 像素：页边取页面纸色，格内是笺面
  for (const scheme of ['light', 'dark']) {
    await boot(page, ctx, { view: 402, scheme });
    await show(page, ALL(2));
    const g = (await facts(page)).grid;
    const [edge, inside, above] = await pixelsAt(page, [[6, g.y + g.h / 2], [g.x + 12, g.y + 12], [g.x + g.w / 2, g.y - 10]]);
    assert.equal(edge, tokenRgb(scheme, 'paper'), `${scheme}: the page edge next to the work is the page paper (no board)`);
    assert.equal(above, tokenRgb(scheme, 'paper'), `${scheme}: just above the work is the page paper`);
    assert.ok(inside !== tokenRgb(scheme, 'paper'), `${scheme}: inside the cell is the sheet (${inside})`);
  }

  // ---------------------------------------------------------------- 3. 出口只有「×」
  ctx.step('one exit: the close icon top-left; the footer only has 再写一组 (daily and first); no 回到首页');
  await boot(page, ctx, { view: 402 });
  await show(page, ALL(3));
  f = await facts(page);
  assert.deepEqual([f.again, f.leave, f.footButtons], [1, 0, 1], 'daily: the footer holds exactly the primary button');
  assert.equal(f.pageText.includes('回到首页'), false, 'daily: no 回到首页 anywhere');
  assert.equal(f.close, '关闭', 'the close icon is the exit');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
  await show(page, { chars: [...'尴赢拾'], steps: ['correct', 'correct', 'correct'] }, { kind: 'first', id: 's78' });
  f = await facts(page);
  assert.deepEqual([f.again, f.leave, f.footButtons], [1, 0, 2], 'first (I3 P0-03): the footer is always 完成 (primary) + 再写一组 (text) — the invitation never replaces it');
  assert.equal(f.pageText.includes('回到首页'), false, 'first: no 回到首页 anywhere');
  const title = await page.locator(topSel('result-title')).textContent();
  assert.equal(title.trim(), '这三个字，很多人提笔就忘。', 'first: the title is the only extra block');
  const sameCells = (await facts(page)).cells.map(r => r.w);
  assert.deepEqual([...new Set(sameCells)], [120], 'first: the same work composition (3 chars → 120)');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  assert.ok(true, 'the close icon leaves to the home tab');

  // ---------------------------------------------------------------- 4. 行文案、朱点、放进图里
  ctx.step('rows: status words only; the red dot sits at the glyph\'s top-right; 放进图里 puts the char back into the work (dot kept) and the row goes away');
  await boot(page, ctx, { view: 402 });
  await show(page, ROWS);
  f = await facts(page);
  assert.deepEqual(f.rows.map(r => [r.ch, r.text]), [['路', '写错了'], ['求', '写错了，没有笔迹'], ['程', '看过答案'], ['北', '跳过了']], 'status words, no quotes, no repeated char names');
  assert.equal(f.rows.some(r => r.text.includes('「')), false, 'no quotation marks in the rows');
  assert.deepEqual(f.rows.map(r => r.addText), ['放进图里', null, null, null], '放进图里 only on the wrong char that has ink');
  assert.deepEqual(f.rows.map(r => r.before), ['none', 'none', 'none', 'none'], 'no dot in front of the status word any more');
  assert.deepEqual(f.rows.map(r => !!r.dot), [true, true, false, false], 'wrong rows carry the dot on the glyph; seen / skipped do not');
  for (const row of f.rows.filter(r => r.dot)) {
    const cx = row.glyph.x + row.glyph.w / 2;
    const cy = row.glyph.y + row.glyph.h / 2;
    const dx = row.dot.x + row.dot.w / 2;
    const dy = row.dot.y + row.dot.h / 2;
    assert.ok(dx > cx && dy < cy, `row ${row.ch}: the dot is in the top-right quadrant of the glyph box`);
    assert.ok(row.dot.x >= row.glyph.x && row.dot.r <= row.glyph.r + 0.5 && row.dot.y >= row.glyph.y - 0.5, `row ${row.ch}: the dot stays inside the glyph box`);
    assert.ok(row.dot.w >= 5 && row.dot.w <= 8, `row ${row.ch}: dot diameter clamp(5, c × .07, 8) → ${row.dot.w}`);
    assert.ok(row.textRect.x > row.glyph.r, `row ${row.ch}: the status starts after the glyph`);
  }
  // 状态字前面没有点：写错那行的颜色是 ink2，而不是朱
  const dotColor = await page.evaluate(() => getComputedStyle(document.querySelector('.sz-layer[data-top="true"] [data-testid="result-exrow-dot"]')).backgroundColor);
  assert.equal(dotColor, tokenRgb('light', 'zhu'), 'the dot is the vermilion mark');
  const workBefore = f.cells.length;
  await page.click(topSel('result-add'));
  await page.waitForFunction(n => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-cell"]').length === n + 1, workBefore);
  await page.waitForTimeout(300);
  f = await facts(page);
  assert.equal(f.cells.length, workBefore + 1, '路 joined the work');
  assert.deepEqual(f.rows.map(r => r.ch), ['求', '程', '北'], '路\'s row is gone');
  const dots = f.workDots.filter(Boolean);
  assert.equal(dots.length, 1, 'the added char keeps its red dot (D46 ⑥)');
  const dd = dots[0];
  assert.ok(dd.dot.x + dd.dot.w / 2 > dd.cell.x + dd.cell.w / 2 && dd.dot.y + dd.dot.h / 2 < dd.cell.y + dd.cell.h / 2, 'the work dot is in the top-right quadrant of its cell');

  ctx.step('paper rows read 写对 · 纸上 / 写错 · 纸上 (no quotes, no 放进图里)');
  await boot(page, ctx, { view: 402 });
  await show(page, { chars: [...'疆纸笔酱'], steps: ['correct', 'paper-correct', 'paper-wrong', 'correct'] });
  f = await facts(page);
  assert.deepEqual(f.rows.map(r => r.text), ['写对 · 纸上', '写错 · 纸上'], 'paper rows');
  assert.deepEqual(f.rows.map(r => r.addText), [null, null], 'no 放进图里 on paper rows');
  assert.deepEqual(f.rows.map(r => r.aria), ['纸，写对，纸上', '笔，写错，纸上'], 'the read-aloud name still carries the char');

  // ---------------------------------------------------------------- 5. 复现句
  ctx.step('the recurrence line is 「N 天后再见」 per char (merged by days), not 「再来找你」');
  await boot(page, ctx, { view: 402 });
  await show(page, ROWS);
  f = await facts(page);
  assert.ok(/再见。$/.test(f.preview), `ends with 再见。: ${f.preview}`);
  assert.ok(/明天再见|天后再见/.test(f.preview), 'uses 明天再见 / N 天后再见');
  assert.equal(/再来|找你/.test(f.preview), false, 'no 再来找你');
  assert.ok(f.preview.includes('「路」') && f.preview.includes('「类」'), 'lists the judged chars');
  assert.equal(f.preview.includes('「程」') || f.preview.includes('「北」'), false, 'seen / skipped chars are not in the line');

  // ---------------------------------------------------------------- 6. AX5
  ctx.step('AX5: the work (cell, kuan 13, seal 24) does not grow; the kuan is whole; the hidden title does not cover the work; 放进图里 sits under the status');
  for (const view of [402, 375]) {
    await boot(page, ctx, { view, ax: 'AX5' });
    await show(page, ROWS);
    f = await facts(page);
    assert.deepEqual([...new Set(f.cells.map(r => r.w))], [CELLS[view][1]], `AX5/${view}: cell stays ${CELLS[view][1]}`);
    assert.deepEqual([f.kuan.fs, f.kuan.lh], ['13px', '20px'], `AX5/${view}: the kuan is Song 13 / 20 whatever the system size`);
    assert.ok(f.kuan.rect.x >= 0 && f.kuan.rect.r <= view && f.kuan.sw <= f.kuan.cw + 1, `AX5/${view}: the kuan is whole (${Math.round(f.kuan.rect.x)}–${Math.round(f.kuan.rect.r)})`);
    assert.ok(close(f.seal.w, 24) && close(f.seal.h, 24), `AX5/${view}: the seal stays 24`);
    assert.ok(f.title.h <= 2 && f.title.w <= 2, `AX5/${view}: the page title is read-aloud only (${f.title.w}×${f.title.h})`);
    assert.ok(f.work.y >= f.body.y, `AX5/${view}: the work starts below the header`);
    const row = f.rows[0];
    assert.ok(close(row.glyph.w, 52), `AX5/${view}: row glyph 52`);
    assert.ok(row.add.y >= row.textRect.b - 1 && close(row.add.x, row.textRect.x, 3), `AX5/${view}: 放进图里 under the status, left-aligned with it`);
    assert.equal(f.footButtons, 1, `AX5/${view}: the footer is still one button`);
  }

  // ---------------------------------------------------------------- 7. 按钮行发丝线与竖向位置
  ctx.step('hairline above the button row only while content runs under it; short content is centred between the header and the button row');
  await boot(page, ctx, { view: 375 });
  await show(page, ROWS);
  f = await facts(page);
  assert.ok(f.bodyBox.sh > f.bodyBox.ch + 2, `SE: the content overflows (${f.bodyBox.sh} > ${f.bodyBox.ch})`);
  assert.equal(f.footUnder, 'true', 'SE: the button row marks that content is under it');
  assert.ok(f.footShadow !== 'none', 'SE: the hairline is drawn (box-shadow above the row)');
  await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] .sz-page__body');
    b.scrollTop = b.scrollHeight;
  });
  await page.waitForTimeout(150);
  f = await facts(page);
  assert.equal(f.footUnder, null, 'scrolled to the bottom: no hairline');
  assert.equal(f.footShadow, 'none', 'scrolled to the bottom: nothing drawn');
  await boot(page, ctx, { view: 402 });
  await show(page, ALL(1));
  f = await facts(page);
  assert.equal(f.footUnder, null, '402 / 1 char: nothing under the button row, no hairline');
  const topGap = f.result.y - (f.body.y + f.bodyBox.pt);
  const bottomGap = (f.body.b - f.bodyBox.pb) - f.result.b;
  assert.ok(Math.abs(topGap - bottomGap) <= 1.5 && topGap > 20, `short content is centred (gap above ${Math.round(topGap)}, below ${Math.round(bottomGap)})`);
  assert.ok(f.resultPad > 20 && f.resultPad < 60, `the bottom inner padding is about 5% of the height (${f.resultPad})`);
  assert.ok(close(f.foot.h, 12 + 54 + 24, 4), `the button row is the primary on the app-wide line (12 + 54 + 24, R5M / P1-15: no empty text row any more): ${f.foot.h}`);

  // ---------------------------------------------------------------- 8. 深色
  ctx.step('dark: row status uses ink2, the cells use the dark sheet, the page paper is the night paper');
  await boot(page, ctx, { view: 402, scheme: 'dark' });
  await show(page, ROWS);
  const dark = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return {
      text: getComputedStyle(top.querySelector('[data-testid="result-exrow-text"]')).color,
      frame: getComputedStyle(top.querySelector('.sz-work__frame')).borderTopColor,
      paper: getComputedStyle(top.querySelector('.sz-work__paper')).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    };
  });
  assert.equal(dark.text, tokenRgb('dark', 'ink2'), 'status words are ink2 (dark)');
  assert.equal(dark.frame, tokenRgb('dark', 'frame'), 'frame (dark)');
  assert.equal(dark.paper, 'rgba(0, 0, 0, 0)', 'still no board (dark)');
  assert.equal(dark.page, tokenRgb('dark', 'paper'), 'night paper');
}
