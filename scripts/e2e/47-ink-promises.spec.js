// F4：policy.features.perRecordInk=false（P31 阻塞）时，字库 / 清单 / 详情 / 首页不得承诺「你的笔迹」。
//   此时格子、小图画的是标准字形（页面会话内刚写的笔画除外，刷新即失），文案按 tInk 取 …Glyph 变体。
//   逐页取整页文字，断言没有「最近一次的笔迹 / 每次的笔迹 / 你写错的那一次」这类承诺，且说明句等于 …Glyph 槽。
//   同时核对 policy 默认关闭，格子确实是标准字形（data-ink=none）。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';

const PROMISE = /最近一次的笔迹|每次的笔迹|你写错的那一次|你当时的笔迹/;

async function seed(page) {
  const res = await page.evaluate(async () => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    const { localDay, addDays } = await import('/src/core/dates.js');
    window.__shiziTest.reset();
    const now = window.__shiziTest.now();
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    const steps = [{ char: '永', judgment: 'wrong', daysAgo: 1 }, { char: '和', judgment: 'correct', daysAgo: 40 }, { char: '静', judgment: 'correct', daysAgo: 0 }];
    steps.forEach((st, i) => {
      const at = now - st.daysAgo * 86400000 + i;
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + st.char], at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + st.char, judgment: st.judgment, strokes: stroke, at, nextId, perRecordInk: false });
      draft.sessions.A = null;
    });
    draft.sched['base:和'] = { ...draft.sched['base:和'], due: addDays(localDay(now), -5) };
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r };
  });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
}

async function copy(page, key) {
  return page.evaluate(async k => (await import('/src/config/copy/index.js')).t(k), key);
}

/** 当前页（顶层 layer；tab 根页取整个 app）的全部文字 + aria-label。 */
async function pageText(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]') || document.querySelector('.sz-app');
    const labels = [...top.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label'));
    return `${top.textContent}\n${labels.join('\n')}`;
  });
}

async function topScreen(page, name) {
  await page.waitForFunction(s => document.querySelector('.sz-app').dataset.topScreen === s, name);
  await waitNavIdle(page);
}

async function goBack(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
}

export default async function inkPromisesSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  step('policy: perRecordInk is off by default (P31), and tInk picks the …Glyph variants');
  const flags = await page.evaluate(async () => {
    const policy = await import('/src/config/policy.js');
    const { inkKey } = await import('/src/config/copy/index.js');
    return { on: policy.features.perRecordInk, key: inkKey('R-A01.sortRecentNote') };
  });
  assert.equal(flags.on, false, 'perRecordInk default false');
  assert.equal(flags.key, 'R-A01.sortRecentNoteGlyph', 'off → Glyph variant');

  await seed(page);

  step('library home: wall cells are standard glyphs; both legend notes (light / dark) say 看它的记录, no handwriting promise');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await topScreen(page, 'library');
  const home = await page.evaluate(() => ({
    cells: [...document.querySelectorAll('[data-testid="library-wall-cell"]')].map(c => (c.querySelector('[data-ink]') ? c.querySelector('[data-ink]').dataset.ink : null)),
    noteLight: document.querySelector('[data-theme-variant="light"]').textContent.trim(),
    noteDark: document.querySelector('[data-theme-variant="dark"]').textContent.trim(),
  }));
  assert.ok(home.cells.length >= 3 && home.cells.every(k => k === 'none'), 'every wall cell is a standard glyph (no persisted ink)');
  assert.equal(home.noteLight, await copy(page, 'R-L03.legendGlyph'), 'light note = R-L03.legendGlyph');
  assert.equal(home.noteDark, await copy(page, 'X-LIBHOME.legendDarkNoteGlyph'), 'dark note = X-LIBHOME.legendDarkNoteGlyph');
  assert.ok(!PROMISE.test(await pageText(page)), 'library home text has no 笔迹 promise');

  step('全部字: sort note = R-A01.sortRecentNoteGlyph, no promise');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('library-all', {}));
  await page.waitForSelector(topSel('all-body'));
  await waitNavIdle(page);
  const allText = await pageText(page);
  assert.ok(allText.includes(await copy(page, 'R-A01.sortRecentNoteGlyph')), 'R-A01 note = Glyph variant');
  assert.ok(!PROMISE.test(allText), 'all page text has no 笔迹 promise');
  await goBack(page);

  for (const [kind, key] of [['wrong', 'R-E03.wrongNoteGlyph'], ['forget', 'R-E03.forgetNoteGlyph']]) {
    step(`${kind} list: note = ${key}, no promise`);
    await page.evaluate(async k => (await import('/src/ui/screens/library/list.js')).openList(k), kind);
    await page.waitForSelector(topSel('list-screen'));
    await waitNavIdle(page);
    const note = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="list-note"]').textContent.trim());
    assert.equal(note, await copy(page, key), `${kind} note = Glyph variant`);
    assert.ok(!PROMISE.test(await pageText(page)), `${kind} list text has no 笔迹 promise`);
    await goBack(page);
  }

  step('single-char detail page: no promise');
  await page.evaluate(async () => (await import('/src/ui/screens/detail/index.js')).openDetail('永'));
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
  assert.ok(!PROMISE.test(await pageText(page)), 'detail text has no 笔迹 promise');
  await goBack(page);

  step('home ink row: standard glyph only (data-ink=none), no promise on the home page');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await topScreen(page, 'home');
  const inkRow = await page.evaluate(() => [...document.querySelectorAll('[data-testid="home-ink-item"]')].map(i => i.dataset.ink));
  assert.ok(inkRow.length >= 1 && inkRow.every(k => k === 'none'), 'home ink row shows standard glyphs');
  assert.ok(!PROMISE.test(await pageText(page)), 'home text has no 笔迹 promise');
}
