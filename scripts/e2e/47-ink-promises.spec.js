// F4 / D27：「笔迹」承诺两种开关各测一遍。
//   开启（D27 起的默认，阶段 1 P1-E3）：格子 / 小图画本人笔迹，说明句取原槽（tInk）；但 D27 只留每字第一次 + 最近一次，
//     任何页面都不得承诺「每次的笔迹」——墙说明是改写后的「第一次和最近一次的笔迹」。
//   关闭（policy.features.perRecordInk=false，经 page.route 改写，全新 browser context；10.12「有记录无笔迹」兜底仍要成立）：
//     字库 / 清单 / 详情 / 首页不得承诺「你的笔迹」，格子画标准字形（data-ink=none），说明句等于 …Glyph 槽。
import { bootTestHost, routePerRecordInk, topSel, waitNavIdle } from './helpers.mjs';

const PROMISE = /最近一次的笔迹|每次的笔迹|你写错的那一次|你当时的笔迹/;
const EVERY = /每次的笔迹|每一次的笔迹|历次的笔迹/;

async function seed(page, withInk) {
  const res = await page.evaluate(async ink => {
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
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + st.char, judgment: st.judgment, strokes: stroke, at, nextId, perRecordInk: ink });
      draft.sessions.A = null;
    });
    draft.sched['base:和'] = { ...draft.sched['base:和'], due: addDays(localDay(now), -5) };
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r };
  }, withInk);
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

/**
 * 逐页走一遍。on=true：说明句取原槽、格子有墨、不承诺「每次的笔迹」；on=false：说明句取 …Glyph、格子标准字形、不承诺笔迹。
 */
async function walk(page, { assert, step }, on) {
  const tag = on ? 'on' : 'off';
  const slot = base => (on ? base : base + 'Glyph');
  const banned = on ? EVERY : PROMISE;

  step(`[${tag}] library home: wall cells ${on ? 'draw the learner\'s ink' : 'are standard glyphs'}; legend notes = ${on ? 'original slots (D27 wording)' : '…Glyph'}`);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await topScreen(page, 'library');
  const home = await page.evaluate(() => ({
    cells: [...document.querySelectorAll('[data-testid="library-wall-cell"]')].map(c => ({
      kind: c.dataset.kind,
      ink: c.querySelector('[data-ink]') ? c.querySelector('[data-ink]').dataset.ink : null,
    })),
    noteLight: document.querySelector('[data-theme-variant="light"]').textContent.trim(),
    noteDark: document.querySelector('[data-theme-variant="dark"]').textContent.trim(),
  }));
  assert.ok(home.cells.length >= 3, 'three recorded chars on the wall');
  if (on) {
    // 写错过的格子画标准字 + 红点（wall.js：只有 kind=ink 才画笔迹），其余画最近一次的笔迹
    assert.ok(home.cells.filter(c => c.kind === 'ink').every(c => c.ink === 'ink'), 'every ink-kind wall cell draws persisted ink');
    assert.ok(home.cells.some(c => c.ink === 'ink'), 'at least one cell draws ink');
  } else {
    assert.ok(home.cells.every(c => c.ink === 'none'), 'every wall cell is a standard glyph (no persisted ink)');
  }
  assert.equal(home.noteLight, await copy(page, slot('R-L03.legend')), `light note = ${slot('R-L03.legend')}`);
  assert.equal(home.noteDark, await copy(page, slot('X-LIBHOME.legendDarkNote')), `dark note = ${slot('X-LIBHOME.legendDarkNote')}`);
  if (on) assert.ok(/第一次和最近一次的笔迹/.test(home.noteLight), 'D27: only first + latest are kept');
  assert.ok(!banned.test(await pageText(page)), `library home text has no ${on ? '每次的笔迹' : '笔迹'} promise`);

  step(`[${tag}] 全部字: sort note = ${slot('R-A01.sortRecentNote')}`);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('library-all', {}));
  await page.waitForSelector(topSel('all-body'));
  await waitNavIdle(page);
  const pageOnly = await pageText(page);
  assert.ok(!banned.test(pageOnly), 'all page text: no unkept promise');
  // H1 / T2-11：说明句收进页头尾端的「排序 · 筛选」菜单
  await page.click(topSel('all-menu-open'));
  await page.waitForSelector(topSel('all-menu'));
  await waitNavIdle(page);
  const allText = await pageText(page);
  assert.ok(allText.includes(await copy(page, slot('R-A01.sortRecentNote'))), `R-A01 note = ${slot('R-A01.sortRecentNote')} (inside the 排序 · 筛选 menu)`);
  assert.ok(!banned.test(allText), 'all page menu text: no unkept promise');
  await goBack(page);
  await goBack(page);

  for (const [kind, base] of [['wrong', 'R-E03.wrongNote'], ['forget', 'R-E03.forgetNote']]) {
    step(`[${tag}] ${kind} list: note = ${slot(base)}`);
    await page.evaluate(async k => (await import('/src/ui/screens/library/list.js')).openList(k), kind);
    await page.waitForSelector(topSel('list-screen'));
    await waitNavIdle(page);
    const note = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="list-note"]').textContent.trim());
    assert.equal(note, await copy(page, slot(base)), `${kind} note = ${slot(base)}`);
    assert.ok(!banned.test(await pageText(page)), `${kind} list text: no unkept promise`);
    await goBack(page);
  }

  step(`[${tag}] single-char detail page: cell ${on ? 'draws ink' : 'has no ink'}, no unkept promise`);
  await page.evaluate(async () => (await import('/src/ui/screens/detail/index.js')).openDetail('永'));
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
  const cells = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="detail-hero-cell"], .sz-layer[data-top="true"] [data-testid="detail-cell"]')].map(c => c.dataset.ink));
  assert.deepEqual(cells, [on ? 'true' : 'false'], 'detail cell ink state');
  assert.ok(!banned.test(await pageText(page)), 'detail text: no unkept promise');
  await goBack(page);

  step(`[${tag}] home: no ink row any more (H2 / D55), and no unkept promise in its text`);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await topScreen(page, 'home');
  assert.equal(await page.locator('[data-testid="home-ink-item"]').count(), 0, 'the home draws no written chars (the ink promises are kept on the detail page and the wall)');
  assert.ok(!banned.test(await pageText(page)), 'home text: no unkept promise');
}

export default async function inkPromisesSpec(page, ctx) {
  const { assert, step } = ctx;

  // ------------------------------------------------------------------ 开启（默认，D27）
  await bootTestHost(page, ctx.baseURL);
  step('policy: perRecordInk is on by default (P31 decided D27), tInk picks the original slots');
  const flags = await page.evaluate(async () => {
    const policy = await import('/src/config/policy.js');
    const { inkKey } = await import('/src/config/copy/index.js');
    return { on: policy.features.perRecordInk, key: inkKey('R-A01.sortRecentNote') };
  });
  assert.equal(flags.on, true, 'perRecordInk default true (D27)');
  assert.equal(flags.key, 'R-A01.sortRecentNote', 'on → original slot');
  await seed(page, true);
  await walk(page, ctx, true);

  // ------------------------------------------------------------------ 关闭（10.12 兜底仍成立）
  const context = await page.context().browser().newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN' });
  const off = await context.newPage();
  const errors = [];
  off.on('pageerror', e => errors.push(`pageerror: ${e && e.message}`));
  off.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  try {
    const hits = await routePerRecordInk(off, false);
    await bootTestHost(off, ctx.baseURL);
    step('policy (off context): perRecordInk forced false via page.route; tInk picks the …Glyph variants');
    assert.ok(hits() >= 1, 'policy.js served with perRecordInk=false');
    const offFlags = await off.evaluate(async () => {
      const policy = await import('/src/config/policy.js');
      const { inkKey } = await import('/src/config/copy/index.js');
      return { on: policy.features.perRecordInk, key: inkKey('R-A01.sortRecentNote') };
    });
    assert.equal(offFlags.on, false, 'perRecordInk false in this context');
    assert.equal(offFlags.key, 'R-A01.sortRecentNoteGlyph', 'off → Glyph variant');
    await seed(off, false);
    await walk(off, ctx, false);
  } finally {
    await context.close();
  }
  assert.deepEqual(errors, [], 'no errors in the off context');
}
