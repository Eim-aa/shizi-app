// 年度报告（02 §6 M4-2；04 R-M06；走查-M01；阶段 1 P1-E7 重写：年报是一卷，交接 §8；D27 / D39 / D42 / D45 / D46 ⑦ ⑬）。
//
// 场景（钩子 seed + setClock 2026-09-24）：
//   1. 空态：没有记录 / 只有看过答案、跳过 / 只有去年的记录 → 「年」+「今年还没有记录」+ R-M06 空态说明；没有卷、没有分享入口。
//      入口是「我的」菜单「年度报告」（M4-1），返回回到我的。
//   2. 有记录（真实 mutator judgeInDraft 造数，含去年记录、笔迹、看过答案 / 跳过、今年的折叠月份）：卷首（「二〇二六」、年字数按 getState 独立重算后对照、
//      今年第一个字 + 「{M月D日} 的笔迹」）→ 每月一段（月名、字数、8 列 45）→ 卷尾（同一个字、第一次与最近一次）；不再有四个统计小节。
//   3. 今年第一个字：那一次有笔迹 → 画笔迹 +「{date} 的笔迹」；没有笔迹 → 衬底字、说明行只写日期。
//   4. 右上分享（取代「这一页不能保存成图片」）→ 保存年报弹层：册页张数、「保存 N 张图片」、「存成一张长图」；点月段进月字帖页。
//   5. 不写任何东西（写日志不变、shizi.* 原始键逐字节相等）；刷新后停在年度报告；跨年（2027-01-02）变空态。
//   6. 300 字计时；深色（系统 / data-theme）与 360×640 无横向滚动；每个 button 有无障碍名。

import { bootTestHost, tid, tokenRgb, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';

const COPY = {
  title: '年度报告', // I3 P2-24: the page title is the menu row's name (one name for the report)
  emptyTitle: '今年还没有记录',
  emptyBody: '写几个字，这里就会汇总今年。',
  head: n => `这一年，你拾回${['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'][n]}个字。`, // 汉字数字，与册页卷首同一句（D53，N2-14；本用例的数都在 10 以内）
  inkLine: d => `${d}的笔迹`,
};
const md = day => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

async function seed(page, spec, clock = CLOCK) {
  const res = await page.evaluate(async s => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(s.clock);
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    (s.steps || []).forEach((st, i) => {
      const at = new Date(`${st.day}T08:00:00`).getTime() + i * 1000;
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + st.char], at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + st.char, judgment: st.judgment, strokes: stroke, at, nextId, perRecordInk: !!st.ink });
      draft.sessions.A = null;
    });
    for (const x of s.extra || []) {
      const month = x.day.slice(0, 7);
      const at = new Date(`${x.day}T10:00:00`).getTime();
      const r = { id: nextId('r'), cardKey: 'base:' + x.char, char: x.char, sessionId: 's999', kind: x.kind, at, localDay: x.day,
        help: { hints: 0, answerSeen: x.kind === 'answer-seen', traced: false } };
      (draft.records[month] || (draft.records[month] = [])).push(r);
    }
    for (const f of s.folded || []) draft.records[f.month] = f;
    if (!Object.keys(draft.ink).length) delete draft.ink;
    const r = window.__shiziTest.seed(draft);
    document.dispatchEvent(new Event('visibilitychange'));
    return { ok: !!(r && r.ok), r };
  }, { clock, ...spec });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
}

/** getState 的独立重算（不引用页面模块）：年字数、有记录天数、第一个字、各月字数。 */
async function oracle(page, year) {
  return page.evaluate(y => {
    const st = window.__shiziTest.getState();
    const pre = `${y}-`;
    const judged = [];
    const days = new Set();
    const foldEvents = [];
    for (const v of Object.values(st.records || {})) {
      if (Array.isArray(v)) {
        for (const r of v) if (r.kind === 'judged') judged.push(r);
      } else if (v && v.folded) {
        for (const r of v.kept || []) if (r.kind === 'judged') judged.push(r);
        for (const [d, cs] of Object.entries(v.byDay || {})) {
          if (!d.startsWith(pre) || !cs.length) continue;
          days.add(d);
          cs.forEach((c, i) => foldEvents.push({ day: d, char: c, i }));
        }
      }
    }
    // D51 ⑤ 作品成员规则：写错的字不进年报（年字数、月字数、第一个字）
    const yj = judged.filter(r => r.localDay.startsWith(pre) && r.judgment !== 'wrong' && r.source !== 'paper').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const r of yj) days.add(r.localDay);
    const chars = new Set([...yj.map(r => r.char), ...foldEvents.map(e => e.char)]);
    const monthChars = {};
    for (const r of yj) (monthChars[r.localDay.slice(0, 7)] || (monthChars[r.localDay.slice(0, 7)] = new Set())).add(r.char);
    for (const e of foldEvents) (monthChars[e.day.slice(0, 7)] || (monthChars[e.day.slice(0, 7)] = new Set())).add(e.char);
    foldEvents.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.i - b.i));
    let first = yj.length ? { char: yj[0].char, day: yj[0].localDay, record: yj[0].id } : null;
    if (foldEvents.length && (!first || foldEvents[0].day < first.day)) first = { char: foldEvents[0].char, day: foldEvents[0].day, record: '' };
    const inkIds = Object.values(st.ink || {}).flatMap(t => Object.keys(t));
    return { count: chars.size, days: days.size, months: Object.entries(monthChars).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, set]) => [m, set.size]), first, inkIds };
  }, year);
}

async function view(page) {
  return page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const all = id => [...root.querySelectorAll(`[data-testid="${id}"]`)];
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const body = q('annual-body');
    const first = q('annual-first');
    const twice = q('annual-twice');
    return {
      title: txt(root.querySelector('[data-page-title]')),
      state: body ? body.dataset.state : null,
      year: body ? body.dataset.year : null,
      today: body ? body.dataset.today : null,
      yearText: txt(q('annual-year')),
      head: txt(q('annual-head')),
      count: q('annual-head') ? Number(q('annual-head').dataset.n) : null,
      empty: q('annual-empty') ? { glyph: txt(q('annual-empty-glyph')), title: txt(q('annual-empty-title')), body: txt(q('annual-empty-body')) } : null,
      months: all('annual-month').map(el => ({
        month: el.dataset.month, n: Number(el.dataset.n), name: txt(el.querySelector('[data-testid="annual-month-name"]')), count: txt(el.querySelector('[data-testid="annual-month-count"]')),
        under: el.querySelectorAll('[data-testid="annual-month-cell"][data-mode="under"]').length,
        cols: getComputedStyle(el.querySelector('[data-testid="annual-month-grid"]')).gridTemplateColumns.split(' ').length,
        cell: Math.round(el.querySelector('[data-testid="annual-month-cell"]').getBoundingClientRect().width),
      })),
      first: first ? { char: first.dataset.char, day: first.dataset.day, record: first.dataset.record, ink: first.dataset.ink,
        label: txt(q('annual-first-label')), line: txt(q('annual-first-date')), canvasMode: q('annual-first-canvas') ? q('annual-first-canvas').dataset.mode : null,
        cellLabel: q('annual-first-cell').getAttribute('aria-label') } : null,
      twice: twice ? { char: twice.dataset.char, dates: all('annual-twice-date').map(txt) } : null,
      share: !!q('annual-adjust'),
      buttons: [...root.querySelectorAll('button, [role="button"], a[href]')].map(b => b.dataset.testid || b.outerHTML.slice(0, 60)),
      bodyText: root.innerText,
      unnamedButtons: [...root.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.innerText || '').trim())
        .map(b => b.outerHTML.slice(0, 80)),
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1
        || [...root.querySelectorAll('*')].some(el => el.getBoundingClientRect().right > window.innerWidth + 1),
    };
  }, `${TOP} [data-testid="annual-screen"]`);
}

async function top(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { depth: s.depth, name: s.top ? s.top.n : null, params: s.top ? s.top.p || {} : {} };
  });
}

async function waitTop(page, name) {
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page, { settleMs: 450 });
}

async function goTab(page, tab) {
  await page.evaluate(async t => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(t);
  }, tab);
  await page.waitForFunction(async t => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === t;
  }, tab);
  await waitNavIdle(page, { settleMs: 450 });
}

async function waitState(page, state, extra = {}) {
  await page.waitForFunction(({ sel, st, ex }) => {
    const el = document.querySelector(`${sel} [data-testid="annual-body"]`);
    if (!el || el.dataset.state !== st) return false;
    return Object.entries(ex).every(([k, v]) => el.dataset[k] === String(v));
  }, { sel: TOP, st: state, ex: extra });
  await page.waitForTimeout(80);
}

async function writes(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

// 今天 2026-09-24。去年记录（不算）、今年跨 1/3/5/9月；5月与 9月各 3 天 → 并列取 9月；第一条（1-05「静」）有笔迹。
const RICH = {
  steps: [
    { char: '豕', judgment: 'correct', day: '2025-12-30' },
    { char: '籍', judgment: 'wrong', day: '2025-12-31' },
    { char: '惊', judgment: 'wrong', day: '2026-01-04', ink: true }, // 写错的字不算第一个字（D51 ⑤）
    { char: '静', judgment: 'correct', day: '2026-01-05', ink: true },
    { char: '谁', judgment: 'correct', day: '2026-01-05' },
    { char: '题', judgment: 'correct', day: '2026-03-02' },
    { char: '静', judgment: 'correct', day: '2026-05-01', ink: true },
    { char: '慢', judgment: 'correct', day: '2026-05-02' },
    { char: '额', judgment: 'wrong', day: '2026-05-09' },
    { char: '数', judgment: 'correct', day: '2026-09-01' },
    { char: '感', judgment: 'wrong', day: '2026-09-08' },
    { char: '数', judgment: 'wrong', day: '2026-09-24' },
  ],
  extra: [
    { char: '户', kind: 'answer-seen', day: '2026-01-02' },
    { char: '虽', kind: 'skipped', day: '2026-01-03' },
  ],
};

// 卷尾：同一个字「疆」4-27 与 10-02 各有一份墨迹（D27 留下第一次与最近一次）；5月一整月没有墨迹的字画衬底
const RICH2 = {
  steps: [
    { char: '春', judgment: 'correct', day: '2026-04-26', ink: true },
    { char: '疆', judgment: 'correct', day: '2026-04-27', ink: true },
    { char: '笔', judgment: 'correct', day: '2026-05-10', ink: false },
    { char: '疆', judgment: 'correct', day: '2026-10-02', ink: true }, // 写错的那次不是作品成员，卷尾只看两次都在作品里的字（D51 ⑤）
  ],
};

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 1. 空态
  step('entry from 我的 menu; empty states (no records / only answer-seen or skipped / only last year)');
  await goTab(page, 'mine');
  await seed(page, {});
  const reg = await page.evaluate(async () => !!(await import('/src/ui/router.js')).getScreen('annual'));
  assert.equal(reg, true, 'annual screen registered at startup');
  await page.click(`${TOP} ${tid('mine-menu-annual')}`);
  await waitTop(page, 'annual');
  assert.deepEqual(await top(page), { depth: 1, name: 'annual', params: {} }, 'menu row pushes annual {}');
  await waitState(page, 'empty');
  let v = await view(page);
  assert.equal(v.title, COPY.title, 'page title 年报 (§8.1)');
  assert.deepEqual(v.empty, { glyph: '年', title: COPY.emptyTitle, body: COPY.emptyBody }, 'R-M06 empty state');
  assert.deepEqual(v.months, [], 'no months in the empty state');
  assert.equal(v.share, false, 'no share entry in the empty state');

  for (const [label, spec] of [
    ['only answer-seen / skipped', { extra: RICH.extra }],
  ]) {
    await seed(page, spec);
    await waitState(page, 'empty');
    v = await view(page);
    assert.equal(v.empty && v.empty.title, COPY.emptyTitle, `${label} → 今年还没写过`);
  }

  // ------------------------------------------------------------------ 1b. 往年（D66 ⑪，P4-02）
  step('past years: only last year → the row and the page point at 2025 without any switch; two years → ‹ › switch, params keep the year');
  await seed(page, { steps: RICH.steps.slice(0, 2) });
  await waitState(page, 'report', { year: 2025 });
  v = await view(page);
  assert.equal(v.count, 1, 'only last year: the 2025 report (豕 correct; 籍 wrong is not a work)');
  assert.ok(!v.buttons.includes('annual-prev') && !v.buttons.includes('annual-next'), 'a single year of records shows no switch at all');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitTop(page, 'mine');
  assert.equal(await page.textContent(`${TOP} ${tid('mine-annual-year')}`), '2025', 'mine row points at the latest year with records');
  await seed(page, RICH);
  await page.waitForFunction(sel => (document.querySelector(sel) || {}).textContent === '2026', `${TOP} [data-testid="mine-annual-year"]`);
  await page.click(`${TOP} ${tid('mine-menu-annual')}`);
  await waitTop(page, 'annual');
  await waitState(page, 'report', { year: 2026 });
  assert.deepEqual(await page.evaluate(sel => {
    const el = id => document.querySelector(`${sel} [data-testid="${id}"]`);
    return [!!el('annual-prev'), !!el('annual-next'), el('annual-prev').disabled, el('annual-next').disabled, el('annual-years').dataset.years];
  }, TOP), [true, true, false, true, '2025 2026'], 'two years: prev enabled, next disabled at the latest year');
  await page.click(`${TOP} ${tid('annual-prev')}`);
  await waitState(page, 'report', { year: 2025 });
  assert.equal((await view(page)).yearText, '二〇二五', 'the 2025 scroll title');
  assert.deepEqual((await top(page)).params, { year: 2025 }, 'the viewed year is kept in params');
  await page.click(`${TOP} ${tid('annual-next')}`);
  await waitState(page, 'report', { year: 2026 });
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitTop(page, 'mine');
  await page.click(`${TOP} ${tid('mine-menu-annual')}`);
  await waitTop(page, 'annual');

  // ------------------------------------------------------------------ 2. 一卷
  step('the scroll: 卷首 (二〇二六, the one number, 今年首字) → monthly sections → no statistics sections');
  await seed(page, RICH);
  await waitState(page, 'report');
  const o = await oracle(page, 2026);
  v = await view(page);
  assert.equal(v.year, '2026', 'data-year');
  assert.equal(v.yearText, '二〇二六', '卷首 year in 汉字 (song 34)');
  assert.equal(v.head, COPY.head(o.count), 'the one number: 「这一年，你拾回N个字。」 (Chinese numerals)');
  assert.equal(v.count, o.count, `distinct chars this year = ${o.count} (answer-seen / skipped / last year not counted)`);
  assert.deepEqual(v.months.map(m => [m.month, m.n]), o.months, 'one section per month with chars, ascending; the count is the month sheet size');
  assert.deepEqual(v.months.map(m => [m.name, m.count]), o.months.map(([m, n]) => [`${Number(m.slice(5))}月`, `${n} 字`]), 'month name + 「N 字」');
  assert.ok(v.months.every(m => m.cols === 8 && m.cell === Math.min(45, Math.floor((ctx.viewport.width - 40) / 8))), 'every month: 8 columns, cell min(45, ⌊(W − 40) / 8⌋) (45 at 402; 44 at the runner\'s 393)');
  assert.deepEqual([v.first.char, v.first.day, v.first.record], [o.first.char, o.first.day, o.first.record], 'the first char of the year (oracle)');
  assert.deepEqual([v.first.label, v.first.line], ['今年首字', COPY.inkLine(md(o.first.day))], '「今年首字」 / 「{M月D日} 的笔迹」 (D45)');
  assert.equal(v.first.canvasMode, 'hand', 'the first char is drawn with its ink');
  assert.ok(!/最忙|较少见|有记录天数|只算今年的记录/.test(v.bodyText), 'no statistics sections / footer (the model keeps one number)');

  // ------------------------------------------------------------------ 3. 今年第一个字：有 / 没有笔迹
  step('first char of the year without ink: under glyph, the line is the date only; a folded earlier month supplies the first char');
  await seed(page, { steps: [{ char: '静', judgment: 'correct', day: '2026-01-05', ink: false }, { char: '谁', judgment: 'correct', day: '2026-01-06', ink: true }] });
  await waitState(page, 'report');
  v = await view(page);
  assert.deepEqual([v.first.char, v.first.ink, v.first.canvasMode, v.first.line], ['静', 'false', 'under', md('2026-01-05')], 'no ink this year for the first char → under glyph, date only');
  assert.equal(v.first.cellLabel, '「静」，没有笔迹', 'accessible name of the under cell');
  await seed(page, {
    steps: [{ char: '静', judgment: 'correct', day: '2026-03-01', ink: true }],
    folded: [{ folded: true, month: '2026-02', byDay: { '2026-02-03': ['和', '永'], '2026-02-10': ['永', '天'] }, chars: ['和', '永', '天'], kept: [] }],
  });
  await waitState(page, 'report');
  v = await view(page);
  const o2 = await oracle(page, 2026);
  assert.deepEqual([v.first.char, v.first.day, v.first.record], ['和', '2026-02-03', ''], 'folded 2026-02: the first day only keeps chars (record null)');
  assert.equal(v.count, o2.count, 'folded months count too');
  assert.deepEqual(v.months.map(m => [m.month, m.n]), o2.months, 'the folded month is a section made of its byDay chars');
  assert.equal(v.months[0].under, 3, 'folded month: no kept ink → all under cells (still counted)');

  // ------------------------------------------------------------------ 4. 分享（保存年报）与月段
  step('the 卷尾 「同字两次」; share → 保存年报 sheet (album page count, 保存 N 张, 存成长图); a month section opens the month page');
  await seed(page, RICH2);
  await waitState(page, 'report');
  v = await view(page);
  assert.deepEqual([v.twice.char, v.twice.dates], ['疆', ['4月27日', '10月2日']], '卷尾: the same char, first and latest ink, dates under the cells');
  assert.equal(v.share, true, 'share icon (replaces 「这一页不能保存成图片」)');
  assert.deepEqual(v.buttons.filter(b => b !== 'annual-month'), ['page-back', 'annual-adjust', 'annual-save'], 'header back + 调整图片 ›, footer 保存图片; the month sections are buttons');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');
  await page.click(`${TOP} ${tid('annual-adjust')}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  await page.waitForTimeout(700);
  const sh = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="image-preview"]');
    return {
      title: document.querySelector('.sz-sheet__title').textContent.trim(), pages: Number(r.dataset.pages), save: r.querySelector('[data-testid="image-save"]').textContent.trim(),
      long: r.querySelector('[data-testid="image-long"]').textContent.trim(), note: r.querySelector('[data-testid="image-note"]').textContent.trim(),
      kinds: [...r.querySelectorAll('[data-testid="image-canvas"]')].map(c => c.dataset.kind), ratios: r.querySelectorAll('[data-testid="image-ratio"]').length,
    };
  });
  assert.deepEqual([sh.title, sh.long, sh.note, sh.ratios], ['保存年报', '存成长图', '分成封面、每月、封底，每张 3:4。', 0], 'sheet copy; the album is always 3:4 (no ratio segment)');
  assert.deepEqual(sh.kinds, ['annual-cover', 'annual-month', 'annual-month', 'annual-month', 'annual-tail'], 'cover + 3 months (4, 5, 10) + tail');
  assert.equal(sh.pages, 5, 'album pages');
  assert.equal(sh.save, '保存 5 张', 'primary button 「保存 N 张」');
  await page.waitForTimeout(450);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);
  await page.click(`${TOP} ${tid('annual-month')}[data-month="2026-05"]`);
  await waitTop(page, 'month');
  assert.deepEqual((await top(page)).params, { month: '2026-05' }, 'the month section pushes the month page');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitTop(page, 'annual');

  // ------------------------------------------------------------------ 5. 不写、刷新、跨年
  step('viewing writes nothing; reload stays on annual; back → 我的');
  await seed(page, RICH);
  await waitState(page, 'report');
  const rawCount = (await view(page)).count;
  const raw0 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  await page.evaluate(c => window.__shiziTest.setClock(c), CLOCK);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitTop(page, 'annual');
  await waitState(page, 'report');
  v = await view(page);
  assert.equal(v.count, rawCount, 'after reload: same report');
  const wReload = await writes(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitTop(page, 'mine');
  assert.equal((await top(page)).depth, 0, 'back → mine tab root');
  const raw1 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  assert.equal(await writes(page) - wReload, 0, 'no writes while on annual after reload and going back');
  assert.deepEqual(raw1, raw0, 'every shizi.* storage key byte-equal before / after viewing + reload');

  step('year boundary: clock 2027-01-02 → no record this year, the page follows the latest year with records (D66 ⑪)');
  await page.click(`${TOP} ${tid('mine-menu-annual')}`);
  await waitTop(page, 'annual');
  const wBefore = await writes(page);
  await page.evaluate(() => {
    window.__shiziTest.setClock('2027-01-02T09:00:00');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitState(page, 'report', { year: 2026 });
  v = await view(page);
  assert.equal(v.count, rawCount, 'new year: still the 2026 report, not an empty page');
  assert.equal(await writes(page) - wBefore, 0, 'no writes on the annual page');
  await page.evaluate(c => {
    window.__shiziTest.setClock(c);
    document.dispatchEvent(new Event('visibilitychange'));
  }, CLOCK);
  await waitState(page, 'report');

  // ------------------------------------------------------------------ 6. 300 字、深色、紧凑
  step('300 chars: timing and counts');
  const deckChars = await page.evaluate(async () => {
    const { getDeck } = await import('/src/data/deck.js');
    return getDeck().keys.filter(k => k.startsWith('base:')).map(k => k.slice(5)).slice(0, 300);
  });
  assert.equal(deckChars.length, 300, 'deck provides 300 chars');
  const big = { steps: deckChars.map((c, i) => ({ char: c, judgment: 'correct', // 300 个作品字（写错的不进年报，D51 ⑤，所以这里全写对）
    day: `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + Math.floor(i / 9) % 28).padStart(2, '0')}` })) };
  const t0 = Date.now();
  await seed(page, big);
  await waitState(page, 'report', { count: 300 });
  const ms = Date.now() - t0;
  console.log(`annual 300: seed→render ${ms}ms`);
  const ob = await oracle(page, 2026);
  v = await view(page);
  assert.equal(v.count, 300, '300 chars');
  assert.deepEqual(v.months.map(m => [m.month, m.n]), ob.months, 'month sections (oracle, 300)');
  assert.equal(v.months.reduce((n, m) => n + m.n, 0), 300, 'every char is in some month');
  assert.ok(ms < 5000, `renders within 5s (${ms}ms)`);

  step('dark (system and data-theme) + 360×640: no overflow, names');
  await seed(page, RICH);
  await waitState(page, 'report');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(300);
  v = await view(page);
  const darkBox = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} .sz-ann__fcell`)).backgroundColor, TOP);
  assert.equal(darkBox, tokenRgb('dark', 'sheet'), 'first-char cell uses dark --sheet (D43)');
  assert.equal(v.hScroll, false, '360 dark: no horizontal overflow');
  assert.deepEqual(v.unnamedButtons, [], 'names in dark / compact');
  assert.ok(v.months.every(m => m.cols === 8 && m.cell === Math.min(45, Math.floor((360 - 40) / 8))), '360: 8 columns, cell = ⌊(360 − 40) / 8⌋ = 40');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(100);
  const forced = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} .sz-ann__fcell`)).backgroundColor, TOP);
  assert.equal(forced, tokenRgb('dark', 'sheet'), 'data-theme=dark forced');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(100);
  v = await view(page);
  assert.equal(v.hScroll, false, '320×568: no horizontal overflow');
  await page.setViewportSize({ width: 393, height: 852 });
}
