// M1-8 题面遮字与无泄漏（决定-D16 / R-W28；01 §6.8；02 §3 M1-8）。
// 移植 PR #175 scripts/verify_content_ui.cjs 的 verifyMask / assertLayout 与三条规则：
//   ① 答案不进 aria / title / data 等任何属性；② 题面与提示都走 textContent（`<img onerror>` 字面量不注入）；
//   ③ 320×568 + 大字（P1-E6 / D29 起 = 系统字号 XXXL，--k 1.35，模拟原生 shiziContentSize；原 data-large 1.3 已删）下最长题面与四行提示不裁切。
// 取样：内容门禁 822 条批准项（rounds 1–3：340；round 4 = C1 / D50 ③）里原本含重复目标字的子集（baseline.originalRepeatedTargets，含「越来越」「慢慢」改写前的
// 越 / 慢）∪ 当前题库仍含重复目标字的卡；另用 setCardResolver 注入合成卡：越来越、慢慢、自定义「哈哈哈」、补充平面字 𠮷、
// `<img onerror>` 字面量、四行长提示。期望值由内容门禁 loadCorpus（scripts/content-corpus.cjs，与 UI 同一 cards.js）
// 在 node 端独立算出，逐格比对。
// 「写好了」之前（recall）整页 body 文本、全部属性、ariaSnapshot 均无目标字；D49 起判断页的目标格同样不显示答案（答案只在参考格出现一次，77-e9b-write-judge.spec.js 断言）。

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootTestHost, LARGE_TEXT, openWrite, seedSession, setTextSize, tid, topSel } from './helpers.mjs';

const require = createRequire(import.meta.url);

const EVIL = '<img id="content-injection" src=x onerror="window.__contentInjected=true">';
// #175 verify_content_ui.cjs 的四行长提示原文。
const LONG_HINT = '这是一条用来核验窄屏显示的较长题意提示，包含含义说明和字形线索，所有文字都应清楚显示，书写区域和操作按钮仍需完整可见。';
const SUPP = '𠮷';

/** 独立期望（verifyMask 同式）：原位拼音（缺则 ？），其余同一目标字 □，其他字原样。 */
const expectedCells = card => card.chars.map((ch, i) => (i === card.ci ? (card.py || '？') : ch === card.target ? '□' : ch));

/** 顶层写字页题面的检查快照（在页面里跑）。 */
async function inspect(page, target) {
  const row = await page.evaluate(tgt => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const prompt = top && top.querySelector('[data-testid="write-prompt"]');
    if (!prompt) return { missing: true };
    const hintId = prompt.getAttribute('aria-describedby');
    const hint = hintId ? document.getElementById(hintId) : null;
    const cells = Array.from(prompt.querySelectorAll('[data-testid="write-prompt-cell"]')).map(n => ({
      text: n.textContent, kind: n.dataset.kind, role: n.getAttribute('role'), label: n.getAttribute('aria-label'),
    }));
    // 全部属性：<html> 与 body 子树（head 里的 meta description / title 是静态应用信息，另查 title 不变）。
    const nodes = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
    const attrLeaks = [];
    for (const node of nodes) {
      for (const a of Array.from(node.attributes)) {
        if (a.value.includes(tgt)) attrLeaks.push(`${node.tagName.toLowerCase()}[${a.name}=${a.value}]`);
      }
    }
    const box = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const wrap = prompt.querySelector('.sz-prompt__wordwrap');
    return {
      geometry: {
        wrap: wrap ? box(wrap) : null,
        cells: Array.from(prompt.querySelectorAll('[data-testid="write-prompt-cell"]')).map(box),
        blank: Array.from(prompt.querySelectorAll('[data-testid="write-prompt-cell"]')).findIndex(n => n.dataset.kind === 'blank'),
        k: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1,
      },
      cursor: Number(top.querySelector('.sz-write').dataset.cursor),
      role: prompt.getAttribute('role'),
      groupLabel: prompt.getAttribute('aria-label'),
      describedBy: hintId,
      hintIsInPrompt: !!hint && prompt.contains(hint),
      hintLive: hint ? hint.getAttribute('aria-live') : null,
      hint: hint ? hint.textContent : null,
      hintChildren: hint ? hint.children.length : -1,
      hintVisible: hint ? hint.getBoundingClientRect().height > 0 : false,
      cells,
      promptText: prompt.textContent,
      bodyHasTarget: document.body.textContent.includes(tgt),
      bodyInnerHasTarget: document.body.innerText.includes(tgt),
      attrLeaks,
      title: document.title,
    };
  }, target);
  row.aria = await page.locator('body').ariaSnapshot();
  return row;
}

/** verifyMask（#175）：返回问题列表（空 = 通过）。 */
function verifyMask(row, card) {
  const problems = [];
  const push = (what, detail) => problems.push(`${card.target}/${card.word}: ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  if (row.missing) return [`${card.target}: no prompt`];
  if (row.cells.length !== card.chars.length) push('cells must use code points', row.cells.length);
  const texts = row.cells.map(c => c.text);
  if (JSON.stringify(texts) !== JSON.stringify(expectedCells(card))) push('cells', texts);
  const repeats = row.cells.filter(c => c.kind === 'repeatBlank');
  const repeatN = card.chars.filter(ch => ch === card.target).length - 1;
  if (repeats.length !== repeatN) push('repeatBlank count', repeats.length);
  if (!repeats.every(c => c.role === 'img' && c.label)) push('repeated blanks need role=img + accessible name');
  if (row.promptText.includes(card.target)) push('prompt text contains the answer');
  if (row.attrLeaks.length) push('answer in attributes', row.attrLeaks);
  if (row.bodyHasTarget || row.bodyInnerHasTarget) push('answer somewhere in page text');
  if (row.aria.includes(card.target)) push('answer in aria snapshot');
  if (row.role !== 'group') push('prompt role', row.role);
  if (!row.describedBy || !row.hintIsInPrompt) push('aria-describedby must point at the hint line');
  if (row.hintLive !== 'polite') push('hint aria-live', row.hintLive);
  if (row.hintChildren !== 0) push('hint must be a single text node (textContent)', row.hintChildren);
  if (row.hint !== null && row.hint.includes(card.target)) push('hint contains the answer');
  if (row.hint && !row.hintVisible) push('non-empty hint must be visible');
  return problems;
}

/** D49 版式（实现交接 §13.1）：每格 52 见方（放不下时等比收窄），整个词水平居中、不装框；AX 档 64（本文件不测 AX）。 */
function verifyGeometry(row, card) {
  const g = row.geometry;
  const problems = [];
  if (!g || !g.wrap || !g.cells.length) return [`${card.target}: no geometry`];
  const n = g.cells.length;
  const cw = 52;
  const avail = g.wrap.width;
  const want = n * cw <= avail ? cw : avail / n;
  const widths = g.cells.map(c => c.width);
  if (!widths.every(w => Math.abs(w - want) <= 1)) problems.push(`${card.target}: cell widths ${JSON.stringify(widths)} ≠ ${want.toFixed(1)}`);
  const heights = g.cells.map(c => c.height);
  if (!heights.every((h, i) => Math.abs(h - widths[i]) <= 1)) problems.push(`${card.target}: cells are not square ${JSON.stringify(heights)}`);
  const left = g.cells[0].left - g.wrap.left;
  const expectLeft = (g.wrap.width - n * want) / 2;
  if (Math.abs(left - expectLeft) > 1.5) problems.push(`${card.target}: row left ${left.toFixed(1)} ≠ ${expectLeft.toFixed(1)} (the whole word is centred)`);
  const last = g.cells[n - 1];
  if (g.cells[0].left < g.wrap.left - 0.5 || last.right > g.wrap.right + 0.5) problems.push(`${card.target}: row outside the prompt box`);
  return problems;
}

async function seedAt(page, keys, cursor, { reset = false, wait = true } = {}) {
  const res = await page.evaluate(({ keys: q, cursor: c, reset: r }) => {
    if (r) window.__shiziTest.reset();
    const now = Date.now();
    const d = new Date(now);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const session = {
      id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' }, queue: q, cursor: c, items: [],
      current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
      lastLine: null, startedAt: now, startedDay: day, updatedAt: now,
    };
    return window.__shiziTest.seed({ sessions: { A: session, B: null, lastEnded: {} } });
  }, { keys, cursor, reset });
  if (!res || !res.ok) throw new Error(`seed failed: ${JSON.stringify(res)}`);
  if (!wait) return;
  await page.waitForFunction(c => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && Number(w.dataset.cursor) === c;
  }, cursor);
}

async function setResolver(page, table) {
  await page.evaluate(async t => {
    const mod = await import('/src/ui/screens/write/prompt.js');
    mod.setCardResolver(t ? key => (Object.prototype.hasOwnProperty.call(t, key) ? t[key] : undefined) : null);
  }, table);
}

async function layoutOf(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const prompt = q('write-prompt');
    const hint = q('write-prompt-hint');
    const cs = getComputedStyle(hint);
    const clipped = el => {
      const s = getComputedStyle(el);
      const hidesX = /hidden|clip|scroll|auto/.test(s.overflowX);
      const hidesY = /hidden|clip|scroll|auto/.test(s.overflowY);
      return (hidesX && el.scrollWidth > el.clientWidth + 0.5) || (hidesY && el.scrollHeight > el.clientHeight + 0.5)
        || s.textOverflow === 'ellipsis' || Number(s.webkitLineClamp) > 0;
    };
    const textEls = [prompt, hint, ...prompt.querySelectorAll('*')];
    // 祖先链上任何一层 overflow 隐藏也会裁切：逐层检查题面各元素是否被祖先盒子截断（page body 滚动容器除外——它可滚到）。
    const ancestorsClip = el => {
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.classList.contains('sz-page__body')) break;
        const s = getComputedStyle(p);
        if (/hidden|clip/.test(s.overflowX + s.overflowY)) {
          const pr = p.getBoundingClientRect();
          if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) return true;
        }
      }
      return false;
    };
    const named = {
      prompt, hint, word: q('write-prompt-word'), py: q('write-prompt-py'), grid: q('write-grid'), tools: q('write-tools'),
      done: q('write-done'), answer: q('write-answer-slot'), hintSlot: q('write-hint-slot'), skip: q('write-skip-slot'),
      back: top.querySelector('[data-testid="page-back"]'), progress: q('write-progress'),
    };
    const cells = Array.from(prompt.querySelectorAll('[data-testid="write-prompt-cell"]')).map(rect);
    const bounds = {};
    for (const [k, el] of Object.entries(named)) if (el) bounds[k] = rect(el);
    const body = top.querySelector('.sz-page__body');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      large: document.documentElement.hasAttribute('data-text-large'),
      k: getComputedStyle(document.documentElement).getPropertyValue('--k').trim(),
      hint: hint.textContent,
      hintLines: Math.round(hint.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
      bounds,
      cells,
      clipped: textEls.filter(clipped).map(el => el.className || el.tagName),
      ancestorClipped: textEls.filter(ancestorsClip).map(el => el.className || el.tagName),
      scrollWidth: document.documentElement.scrollWidth,
      bodyScroll: body ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth } : null,
    };
  });
}

/** assertLayout（#175）移植：水平方向全部在 0–320 内、无横向溢出；题面 + 提示首屏完整可见、不被裁切；底栏按钮在视口内；
 *  书写格高度放得进正文可视区（竖向首屏容纳全部控件是 M1-7 紧凑版的事，见报告）。 */
function assertLayout(assert, L, label) {
  const W = L.viewport.width;
  const H = L.viewport.height;
  assert.ok(L.large && L.k === '1.35', `${label}: system text XXXL → data-text-large on, --k = 1.35 (policy.contentSizeScale.XXXL, P130)`);
  assert.ok(L.scrollWidth <= W, `${label}: no horizontal page overflow (scrollWidth ${L.scrollWidth} ≤ ${W})`);
  assert.ok(L.bodyScroll && L.bodyScroll.scrollWidth <= L.bodyScroll.clientWidth, `${label}: page body has no horizontal overflow`);
  const outX = Object.entries(L.bounds).filter(([, b]) => b.left < -0.5 || b.right > W + 0.5).map(([k]) => k);
  assert.deepEqual(outX, [], `${label}: every write-screen part is horizontally inside 0–${W}`);
  const cellsOut = L.cells.filter(b => b.left < -0.5 || b.right > W + 0.5);
  assert.equal(cellsOut.length, 0, `${label}: every prompt cell is horizontally inside the viewport`);
  for (const k of ['prompt', 'word', 'py', 'hint']) {
    const b = L.bounds[k];
    assert.ok(b && b.top >= -0.5 && b.bottom <= H + 0.5 && b.height > 0, `${label}: ${k} fully visible on the first screen ${JSON.stringify(b)}`);
  }
  assert.deepEqual(L.clipped, [], `${label}: no prompt/hint element clips its text (overflow / ellipsis / line clamp)`);
  assert.deepEqual(L.ancestorClipped, [], `${label}: no prompt/hint element is cut by an overflow:hidden ancestor`);
  const d = L.bounds.done;
  assert.ok(d && d.top >= -0.5 && d.bottom <= H + 0.5, `${label}: 「写好了」 inside the viewport ${JSON.stringify(d)}`);
  const g = L.bounds.grid;
  assert.ok(g && g.height <= L.bodyScroll.clientHeight + 0.5, `${label}: grid fits the scrollable body height (${g && g.height} ≤ ${L.bodyScroll.clientHeight})`);
}

export default async function promptMask(page, ctx) {
  const { assert } = ctx;
  const { loadCorpus } = require(join(ctx.root, 'scripts', 'content-corpus.cjs'));
  const corpus = await loadCorpus(ctx.root);
  const fixture = f => JSON.parse(readFileSync(join(ctx.root, 'scripts', 'fixtures', f), 'utf8'));
  const baseline = fixture('content-quality-baseline.json');
  const approvals = fixture('content-quality-approved.json').entries;
  const byKey = new Map(corpus.cards.map(c => [c.cardKey, c]));
  const originalRepeated = new Set(baseline.originalRepeatedTargets);
  const currentRepeated = corpus.cards.filter(c => c.chars.filter(ch => ch === c.target).length > 1);
  const subsetKeys = [...new Set([
    ...approvals.filter(e => originalRepeated.has(e.target)).map(e => e.cardKey),
    ...currentRepeated.map(c => c.cardKey),
  ])];
  const sample = subsetKeys.map(k => byKey.get(k));

  ctx.step(`sample: ${approvals.length} approved ∩ originally-repeated + currently repeated = ${sample.length} cards`);
  assert.equal(approvals.length, 822, 'content gate has 822 approved entries (340 + C1 round 4)');
  assert.ok(sample.every(Boolean), 'every sampled cardKey exists in the governed corpus');
  assert.ok(originalRepeated.has('越') && originalRepeated.has('慢'), '越来越 / 慢慢 (越 / 慢) are among the original repeated targets');
  assert.ok(subsetKeys.includes('base:越') && subsetKeys.includes('base:慢'), '越 / 慢 are in the sample');
  assert.ok(currentRepeated.length > 0 && currentRepeated.every(c => subsetKeys.includes(c.cardKey)), `all ${currentRepeated.length} currently repeated cards sampled`);

  ctx.step('open the write screen on the first sampled card');
  await bootTestHost(page, ctx.baseURL);
  const title0 = await page.evaluate(() => document.title);
  const sampleQueue = sample.map(c => c.cardKey);
  await seedAt(page, sampleQueue, 0, { reset: true, wait: false });
  await openWrite(page, { slot: 'A' });

  ctx.step('verifyMask on every sampled card in the recall phase (before 「写好了」)');
  const problems = [];
  let repeatedSeen = 0;
  let hintChecked = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const card = sample[i];
    if (i > 0) await seedAt(page, sampleQueue, i);
    const row = await inspect(page, card.target);
    problems.push(...verifyMask(row, card));
    problems.push(...verifyGeometry(row, card));
    if (row.cursor !== i) problems.push(`${card.target}: cursor ${row.cursor} ≠ ${i}`);
    if (row.hint !== card.visibleHint) problems.push(`${card.target}: hint ${JSON.stringify(row.hint)} ≠ gate visibleHint ${JSON.stringify(card.visibleHint)}`);
    else hintChecked += 1;
    if (row.title !== title0) problems.push(`${card.target}: document.title changed`);
    if (row.cells.some(c => c.kind === 'repeatBlank')) repeatedSeen += 1;
  }
  assert.deepEqual(problems.slice(0, 20), [], `all ${sample.length} sampled cards: masked per code point, □ role=img, no answer in text / attributes / aria snapshot; cells 52 wide, the whole word centred`);
  assert.equal(hintChecked, sample.length, 'hint line equals the content gate visibleHint byte for byte (copy from src/config/copy)');
  assert.equal(repeatedSeen, currentRepeated.length, 'every currently repeated card rendered at least one □');

  ctx.step('synthetic cards: 越来越, 慢慢, custom 哈哈哈, supplementary 𠮷, <img onerror> literal');
  // 𠮷 没有笔顺数据文件：给一份现成的（吉）避免 404 被 run.mjs 当成错误；与题面无关。
  await page.route(`**/data/${encodeURIComponent(SUPP)}.json`, route => route.fulfill({ path: join(ctx.root, 'data', '吉.json') }));
  const synth = {
    'base:越': { word: '越来越', chars: Array.from('越来越'), ci: 0, target: '越', py: 'yuè', hint: '', ctx: 'override', promptHint: '' },
    'base:慢': { word: '慢慢', chars: ['慢', '慢'], ci: 1, target: '慢', py: 'màn', hint: '', ctx: 'override' },
    'custom:哈': { word: '哈哈哈', chars: ['哈', '哈', '哈'], ci: 0, target: '哈', py: 'hā', hint: '', custom: true },
    [`base:${SUPP}`]: { word: `${SUPP}甲${SUPP}${SUPP}`, chars: Array.from(`${SUPP}甲${SUPP}${SUPP}`), ci: 2, target: SUPP, py: 'jí', ctx: 'override', promptHint: '补充平面字符的合成显示测试。' },
  };
  await setResolver(page, synth);
  const synthKeys = Object.keys(synth);
  await seedAt(page, synthKeys, 0);
  const expectHints = {
    'base:越': '空格里是同一个字，只写一次。',
    'base:慢': '空格里是同一个字，只写一次。',
    'custom:哈': '空格里是同一个字，只写一次。',
    [`base:${SUPP}`]: '补充平面字符的合成显示测试。 空格里是同一个字，只写一次。',
  };
  for (let i = 0; i < synthKeys.length; i += 1) {
    const key = synthKeys[i];
    const card = synth[key];
    if (i > 0) await seedAt(page, synthKeys, i);
    const row = await inspect(page, card.target);
    assert.deepEqual([...verifyMask(row, card), ...verifyGeometry(row, card)], [], `${card.word}: verifyMask + geometry (cells ${JSON.stringify(row.cells.map(c => c.text))})`);
    assert.equal(row.hint, expectHints[key], `${card.word}: hint line + R-W28`);
  }
  let row = await inspect(page, SUPP);
  assert.equal(row.cells.length, 4, '𠮷甲𠮷𠮷 → 4 cells (code points, not UTF-16 units)');
  assert.equal(row.cells[2].text, 'jí', 'pinyin only at the original target position');
  assert.ok(!/[\uD800-\uDFFF]/.test(row.promptText.replace(/𠮷/g, '')), 'no lone surrogate halves rendered');
  await seedAt(page, synthKeys, 2);
  row = await inspect(page, '哈');
  assert.equal(row.cells.filter(c => c.kind === 'repeatBlank').length, 2, 'custom 哈哈哈: two □');
  assert.ok(row.hint.endsWith('空格里是同一个字，只写一次。'), 'custom 哈哈哈: hint ends with R-W28');

  ctx.step('literal <img onerror> in a hint is rendered as text, not HTML');
  await setResolver(page, { ...synth, [`base:${SUPP}`]: { ...synth[`base:${SUPP}`], promptHint: EVIL } });
  await seedAt(page, synthKeys, 0);
  await seedAt(page, synthKeys, 3);
  row = await inspect(page, SUPP);
  assert.deepEqual(verifyMask(row, synth[`base:${SUPP}`]), [], 'literal: still masked');
  assert.ok(row.hint.startsWith('<img '), 'hint shows the literal markup as text');
  assert.equal(await page.locator('#content-injection').count(), 0, 'no <img id=content-injection> element created');
  assert.equal(await page.evaluate(() => window.__contentInjected), undefined, 'onerror never ran');

  ctx.step('320×568 + system text XXXL: the longest real hint and a four-line hint are not clipped');
  const longest = [...corpus.cards].filter(c => c.visibleHint).sort((a, b) => b.visibleHint.length - a.visibleHint.length)[0];
  await setResolver(page, null);
  await page.setViewportSize({ width: 320, height: 568 });
  await setTextSize(page, LARGE_TEXT);
  await seedAt(page, [longest.cardKey], 0);
  await page.waitForTimeout(100);
  let L = await layoutOf(page);
  assert.equal(L.hint, longest.visibleHint, `longest real hint (${longest.target}, ${longest.visibleHint.length} chars) rendered`);
  if (process.env.SHIZI_E2E_SHOTS) await page.screenshot({ path: join(process.env.SHIZI_E2E_SHOTS, 'm1-8-longest-320-large.png') });
  assertLayout(assert, L, `longest (${longest.target})`);
  row = await inspect(page, longest.target);
  assert.deepEqual([...verifyMask(row, longest), ...verifyGeometry(row, longest)], [], 'longest: still masked at 320×568 large; cells 52 wide, the whole word centred');

  const longCard = { ...synth[`base:${SUPP}`], promptHint: LONG_HINT };
  await setResolver(page, { [`base:${SUPP}`]: longCard });
  await seedAt(page, [`base:${SUPP}`], 0);
  await page.waitForTimeout(100);
  L = await layoutOf(page);
  assert.ok(L.hintLines >= 4, `synthetic long hint renders ≥ 4 lines (got ${L.hintLines})`);
  assertLayout(assert, L, 'four-line hint');
  if (process.env.SHIZI_E2E_SHOTS) await page.screenshot({ path: join(process.env.SHIZI_E2E_SHOTS, 'm1-8-four-line-320-large.png') });
  row = await inspect(page, SUPP);
  assert.deepEqual([...verifyMask(row, longCard), ...verifyGeometry(row, longCard)], [], 'four-line: still masked; 4 cells shrink evenly to fit 320 without clipping');

  ctx.step('restore');
  await setResolver(page, null);
  await setTextSize(page, 'L');
  await page.setViewportSize(ctx.viewport);
  assert.ok(await page.isVisible(topSel('write-prompt')), 'prompt still mounted');
  assert.ok(await page.isVisible(tid('write-screen')), 'write screen still on top');
}
