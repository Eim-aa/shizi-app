// 阶段 1 P1-E2：练习字字形单一来源（D33 8a 方案 B、D43、D44；审查 G04 / V02）。
//
// 所有「练习字」统一用 hanzi-writer 轮廓渲染，ShiziKai 只做轮廓缺失时的回退：
//   1. 字墙：标准字形格是 SVG 轮廓（data-glyph-src=outline，每笔一个 path，颜色取墨色档位令牌）；自选未写 = 淡朱双钩（描边、不填）；
//      轮廓缺失的字（造一个不在 data 里的自选字）回退 ShiziKai 空心描边（data-glyph-src=fallback）；
//      加载中不画（给 data/*.json 加延迟：第一帧没有任何楷体文字，轮廓晚到格子尺寸不变）；
//   2. 题面词语格：词里的字是轮廓；回忆阶段答案格里没有字形（D16）；判断页答案格填回的目标字是轮廓；
//   3. 详情：词语小字帖是轮廓，没有笔迹的记录格里衬底字是轮廓；
//   4. 月字帖 / 结果页作品的衬底字（canvas）：有数据 = outline，题库外的字 = fallback（ShiziKai）；
//   5. 数据 404 的题库字：回退 ShiziKai，不重试、不抛错；
//   6. 同一个字在墙与详情里的轮廓路径逐字节相同（同形）。
import { bootTestHost, tid, tokenRgb, topSel, waitNavIdle, seedSession, openWrite, drawStroke, HORIZONTAL } from './helpers.mjs';
import { openResultPage, seedMonthRecords, seedWork } from './work-helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const CHARS = [...'永的一是不了人我在有他这'];
const HOLLOW = ['馨', '鼎'];
const MISSING = '𠀀'; // CJK 扩展 B 的字：不在题库、没有 data/<字>.json

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function dayAgo(n) {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 每字一条没有笔迹的 judged 记录（标准字形占位）；自选：两个题库字没写 + 一个题库外的字。 */
function seedWall() {
  const records = {};
  CHARS.forEach((c, i) => {
    const day = dayAgo(1 + (i % 4) * 20);
    const at = new Date(`${day}T08:00:00`).getTime() + i * 60000;
    const r = {
      id: `r${i + 1}`, cardKey: `base:${c}`, char: c, sessionId: 's900', kind: 'judged', judgment: i === 0 ? 'wrong' : 'correct',
      at, localDay: day, help: { hints: 0, answerSeen: false, traced: false },
    };
    (records[day.slice(0, 7)] || (records[day.slice(0, 7)] = [])).push(r);
  });
  return { records, custom: { added: [...HOLLOW, MISSING].map((char, i) => ({ char, at: 1000 + i })) } };
}

async function goTab(page, tab) {
  await page.evaluate(async t => (await import('/src/ui/router.js')).nav.switchTab(t), tab);
  await page.waitForFunction(async t => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === t;
  }, tab);
  await waitNavIdle(page, { settleMs: 200 });
}

async function push(page, id, params) {
  await page.evaluate(async o => (await import('/src/ui/router.js')).nav.push(o.id, o.params), { id, params });
  await page.waitForSelector(topSel(`${id}-screen`));
  await waitNavIdle(page);
}

async function back(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
}

const TOP = '.sz-layer[data-top="true"]';

export default async function (page, ctx) {
  const { assert } = ctx;
  await page.setViewportSize({ width: 402, height: 874 });

  // 记录页面里出现过的楷体回退节点（.sz-pg__fb）与每个字形元素第一次出现时的尺寸：加载中不闪楷体、轮廓晚到不抖。
  await page.addInitScript(() => {
    window.__fb = [];
    window.__pgBoxes = [];
    const seen = new WeakSet();
    const note = node => {
      if (node.nodeType !== 1) return;
      const list = node.matches('.sz-pg') ? [node] : [...node.querySelectorAll('.sz-pg')];
      for (const el of list) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        window.__pgBoxes.push({ el, w: r.width, h: r.height });
      }
      const fbs = node.matches('.sz-pg__fb') ? [node] : [...node.querySelectorAll('.sz-pg__fb')];
      for (const fb of fbs) window.__fb.push(fb.textContent);
    };
    new MutationObserver(ms => {
      for (const m of ms) m.addedNodes.forEach(note);
    }).observe(document, { childList: true, subtree: true });
  });
  // 笔顺数据慢一点到：第一帧一定处在「加载中」
  await page.route('**/data/*.json', async route => {
    await new Promise(r => setTimeout(r, 150));
    await route.continue();
  });
  await bootTestHost(page, ctx.baseURL);

  // ---------------------------------------------------------------- 1. 字墙
  ctx.step('wall: loading draws nothing (no ShiziKai flash); then outlines; hollow = ink4 double-hook (D49 ⑤); out-of-deck char falls back to ShiziKai');
  await goTab(page, 'library');
  await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    window.__fb.length = 0;
    window.__pgBoxes.length = 0;
    const r = window.__shiziTest.seed(s);
    document.dispatchEvent(new Event('visibilitychange'));
    return r;
  }, { iso: CLOCK, s: seedWall() });
  await page.waitForSelector(`${TOP} [data-testid="library-wall-cell"]`);
  const early = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="library-wall-cell"] .sz-pg')].map(el => el.dataset.glyphSrc));
  assert.ok(early.length > 0 && early.includes('loading'), 'first frame: glyph boxes exist and are still loading (nothing drawn yet)');
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall-cell"] .sz-pg[data-glyph-src="loading"]'), null, { timeout: 15000 });
  const wall = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return [...top.querySelectorAll('[data-testid="library-wall-cell"]')].map(cell => {
      const g = cell.querySelector('.sz-pg');
      const paths = [...g.querySelectorAll('path')];
      const p0 = paths[0];
      const fb = g.querySelector('.sz-pg__fb');
      return {
        char: cell.dataset.char, kind: cell.dataset.kind, src: g.dataset.glyphSrc, variant: g.dataset.glyphVariant, n: paths.length,
        fill: p0 ? getComputedStyle(p0).fill : null, stroke: p0 ? getComputedStyle(p0).stroke : null, color: getComputedStyle(g).color,
        fbFont: fb ? getComputedStyle(fb).fontFamily : null, fbText: fb ? fb.textContent : null, text: g.textContent,
      };
    });
  });
  const byChar = Object.fromEntries(wall.map(c => [c.char, c]));
  const deckCells = wall.filter(c => c.char !== MISSING);
  assert.ok(deckCells.length >= 14, `the wall shows ${deckCells.length} deck chars`);
  assert.ok(deckCells.every(c => c.src === 'outline' && c.n >= 1), 'every deck char on the wall is an SVG outline (one path per stroke), not text');
  assert.ok(deckCells.every(c => c.fbText === null), 'no ShiziKai text node on any deck char');
  assert.deepEqual(wall.filter(c => c.kind === 'hollow').map(c => [c.char, c.variant, c.src]).sort(), [[MISSING, 'hollow', 'fallback'], ['馨', 'hollow', 'outline'], ['鼎', 'hollow', 'outline']].sort(), 'custom unwritten cells are hollow');
  for (const c of wall.filter(c => c.kind === 'hollow' && c.src === 'outline')) {
    assert.equal(c.fill, 'none', `${c.char}: double-hook is not filled`);
    assert.equal(c.stroke, tokenRgb('light', 'ink4'), `${c.char}: double-hook strokes with --ink4 (D49 ⑤: vermilion only means wrong; danzhu is only for hints / trace)`);
  }
  const filled = wall.filter(c => c.kind === 'ink' || c.kind === 'wrong');
  assert.ok(filled.length > 0 && filled.every(c => c.src === 'outline' && c.fill !== 'none' && c.fill === c.color), 'filled outlines take the tone colour (currentColor)');
  assert.equal(byChar[MISSING].src, 'fallback', 'out-of-deck custom char: ShiziKai fallback');
  assert.ok(/ShiziKai/.test(byChar[MISSING].fbFont) && byChar[MISSING].fbText === MISSING, 'the fallback is ShiziKai text');
  assert.deepEqual(await page.evaluate(() => [...new Set(window.__fb)]), [MISSING], 'ShiziKai text only ever appeared for the char without outline data');
  const jitter = await page.evaluate(() => window.__pgBoxes.filter(b => b.el.isConnected && b.w > 0).filter(b => {
    const r = b.el.getBoundingClientRect();
    return Math.abs(r.width - b.w) > 0.5 || Math.abs(r.height - b.h) > 0.5;
  }).length);
  assert.equal(jitter, 0, 'glyph boxes keep their size when the outline arrives (no layout shift)');
  const wallD = await page.evaluate(() => {
    const cell = document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall-cell"][data-char="永"]');
    return cell.querySelector('path').getAttribute('d');
  });

  // ---------------------------------------------------------------- 3. 详情
  ctx.step('detail: word tiles and the no-ink cells are outlines; same char, same outline as the wall');
  await push(page, 'detail', { char: '永' });
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] .sz-pg[data-glyph-src="loading"]'), null, { timeout: 15000 });
  const detail = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const srcs = sel => [...top.querySelectorAll(sel)].map(g => g.dataset.glyphSrc);
    return {
      tiles: srcs('[data-testid="detail-word-tile"] .sz-pg'),
      tileText: [...top.querySelectorAll('[data-testid="detail-word-tile"]')].map(t => t.textContent),
      cells: srcs('[data-testid="detail-cell-glyph"]'),
      d: top.querySelector('[data-testid="detail-cell-glyph"] path').getAttribute('d'),
      kaiTextNodes: top.querySelectorAll('.sz-pg__fb').length,
    };
  });
  assert.ok(detail.tiles.length >= 1 && detail.tiles.every(s => s === 'outline'), 'detail word tiles are outlines');
  assert.ok(detail.tileText.every(s => s.length >= 1), 'tiles keep their char as text for AT (textContent)');
  assert.ok(detail.cells.length >= 1 && detail.cells.every(s => s === 'outline'), 'detail no-ink cells: under glyph is an outline');
  assert.equal(detail.kaiTextNodes, 0, 'no ShiziKai text on the detail page');
  assert.equal(detail.d, wallD, 'same char, same outline path on the wall and in the detail');
  await back(page);

  // ---------------------------------------------------------------- 4. 月字帖衬底（canvas）
  ctx.step('month sheet: under glyphs (no ink) are outlines on canvas; a char outside the deck falls back to ShiziKai');
  await seedMonthRecords(page, {
    entries: [{ day: '2026-09-02', chars: `永山${MISSING}`, ink: false }, { day: '2026-09-03', chars: '水', ink: true }],
  });
  await push(page, 'month', { month: '2026-09' });
  await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell"] canvas')];
    return cs.length >= 4 && cs.every(c => c.dataset.painted === 'true');
  }, null, { timeout: 15000 });
  const month = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell"]')].map(c => {
    const cv = c.querySelector('canvas');
    return { ch: c.dataset.char, mode: c.dataset.mode, glyph: cv.dataset.glyph };
  }));
  assert.deepEqual(month.filter(c => c.mode === 'under').map(c => [c.ch, c.glyph]).sort(), [['永', 'outline'], ['山', 'outline'], [MISSING, 'fallback']].sort(), 'month under glyphs: outline, except the out-of-deck char');
  assert.deepEqual(month.filter(c => c.mode === 'hand').map(c => c.glyph), ['ink'], 'the char with ink is the hand writing');
  await back(page);

  // ---------------------------------------------------------------- 5. 结果页衬底
  ctx.step('result page: under glyphs of the no-ink work are outlines');
  const g = await seedWork(page, { chars: [...'疆酱纸'], steps: ['correct-noink', 'wrong-noink', 'correct-noink'], clock: '2026-10-05T10:00:00' });
  await openResultPage(page, g);
  const res = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-canvas"]')].map(c => [c.dataset.mode, c.dataset.glyph]));
  assert.deepEqual(res, [['under', 'outline'], ['under', 'outline'], ['under', 'outline']], 'result work: under glyphs are outlines');
  await back(page);

  // ---------------------------------------------------------------- 2. 题面
  ctx.step('prompt: word cells are outlines; the answer cell has no glyph while recalling (D16); the judge page fills the target as an outline');
  await goTab(page, 'home');
  const cardWord = await page.evaluate(async () => {
    const { cardForKey } = await import('/src/data/deck.js');
    const c = cardForKey('base:嚏');
    return c ? { word: c.word, chars: c.chars, ci: c.ci } : null;
  });
  assert.ok(cardWord && cardWord.chars.length >= 2, `base:嚏 has a multi-char word (${cardWord && cardWord.word})`);
  await seedSession(page, { chars: ['嚏', '永'], slot: 'B' });
  await openWrite(page, { slot: 'B' });
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="write-prompt-cell"] .sz-pg[data-glyph-src="loading"]'), null, { timeout: 15000 });
  const recall = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="write-prompt-cell"]')].map(c => ({
    kind: c.dataset.kind, glyph: c.querySelector('.sz-pg') ? c.querySelector('.sz-pg').dataset.glyphSrc : null, text: c.textContent,
  })));
  assert.ok(recall.filter(c => c.kind === 'text').length >= 1 && recall.filter(c => c.kind === 'text').every(c => c.glyph === 'outline'), 'recall: the other chars of the word are outlines');
  assert.deepEqual(recall.filter(c => c.kind === 'blank').map(c => c.glyph), [null], 'recall: the answer cell has no glyph (D16)');
  assert.ok(!recall.filter(c => c.kind === 'blank').some(c => c.text.includes('嚏')), 'the answer char is not in the blank cell text');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] .sz-prompt__fill[data-glyph-src="loading"]'), null, { timeout: 15000 });
  const fill = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] .sz-prompt__fill');
    return el ? { src: el.dataset.glyphSrc, text: el.textContent, paths: el.querySelectorAll('path').length } : null;
  });
  assert.ok(fill && fill.src === 'outline' && fill.paths >= 5 && fill.text === '嚏', 'judge page: the target char is filled back as an outline (textContent keeps the char)');
  assert.deepEqual(await page.evaluate(() => [...new Set(window.__fb)]), [MISSING], 'ShiziKai text never appeared for chars with outline data (wall, prompt, detail, month, result)');

  // ---------------------------------------------------------------- 6. 数据 404：回退
  ctx.step('a deck char whose data file is 404: ShiziKai fallback, once (not retried), no error');
  ctx.allowConsoleError(/E9%BC%8E|Failed to load resource/);
  await page.route('**/data/%E9%BC%8E.json', route => route.fulfill({ status: 404, body: 'no' }));
  await page.route('**/data/鼎.json', route => route.fulfill({ status: 404, body: 'no' }));
  let hits = 0;
  page.on('request', req => { if (/data\/(%E9%BC%8E|鼎)\.json/.test(req.url())) hits += 1; });
  await page.evaluate(async () => { (await import('/src/data/strokes.js')).getStrokesLoader().clear(); });
  await goTab(page, 'library');
  await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    window.__shiziTest.seed(s);
    document.dispatchEvent(new Event('visibilitychange'));
  }, { iso: CLOCK, s: seedWall() });
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall-cell"][data-char="鼎"] .sz-pg[data-glyph-src="fallback"]'), null, { timeout: 15000 });
  const ding = await page.evaluate(() => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall-cell"][data-char="鼎"] .sz-pg');
    return { src: g.dataset.glyphSrc, font: getComputedStyle(g.querySelector('.sz-pg__fb')).fontFamily, fill: getComputedStyle(g.querySelector('.sz-pg__fb')).webkitTextFillColor };
  });
  assert.ok(ding.src === 'fallback' && /ShiziKai/.test(ding.font), '鼎 (404) falls back to ShiziKai text');
  assert.ok(hits >= 1 && hits <= 2, `the 404 char was requested ${hits} time(s), not hammered`);
}
