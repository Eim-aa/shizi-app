// M4-2 年度报告（02 §6 M4-2；04 R-M06；走查-M01；原型 ShiziScreen-第十稿交接版 L133–L144、逻辑 L494–L498）。
//
// 场景（钩子 seed + setClock 2026-09-24）：
//   1. 空态：没有记录 / 只有看过答案、跳过 / 只有去年的记录 → 「年」+「今年还没有记录」+ R-M06 空态说明；没有四节、没有页底句。
//      入口是「我的」菜单「年度报告」（M4-1），返回回到我的。
//   2. 有记录（真实 mutator judgeInDraft 造数，含去年记录、笔迹、看过答案 / 跳过、今年的折叠月份）：四节的数字按 getState + SEED 字频
//      独立重算后对照（去重字数、有记录天数最多的月份（并列取大）、字频最大的字 + 拼音、今年第一条记录的字 / 日期 / 记录 id / 笔迹）。
//   3. 第四节：那一次有笔迹 → 画笔迹 +「{date} · 你当时的笔迹」；没有笔迹 → 标准字 +「没有笔迹」、说明行只写日期。
//   4. 不导出：页面里除了页头返回没有任何按钮、没有图片 / 分享入口；页底「只算今年的记录。这一页不能保存成图片。」。
//   5. 不写任何东西（写日志不变、shizi.* 原始键逐字节相等）；刷新后停在年度报告；跨年（2027-01-02）变空态。
//   6. 300 字计时；深色（系统 / data-theme）与 360×640 无横向滚动；每个 button 有无障碍名。

import { bootTestHost, tid, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';

const COPY = {
  title: '年度报告',
  s1: '一 · 今年有记录的字',
  s1Note: '写完并判断过对错的字，写对写错都算。',
  s2: '二 · 有记录天数最多的月份',
  s2Note: '只看哪天有记录，不分对错。',
  s3: '三 · 较少见的字',
  s3Note: '今年有记录的字里，它最不常用。',
  s4: '四 · 这一年第一个有记录的字',
  footer: '只算今年的记录。这一页不能保存成图片。',
  emptyTitle: '今年还没有记录',
  emptyBody: '写字并判断对错后，这里会汇总你今年的记录。',
  monthDays: (m, n) => `${m} 月有记录 ${n} 天`,
  inkLine: d => `${d} · 你当时的笔迹`,
  noInk: '没有笔迹',
};
const md = day => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;

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

/** getState + SEED 的独立重算（不引用页面模块）。 */
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
    const yj = judged.filter(r => r.localDay.startsWith(pre)).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const r of yj) days.add(r.localDay);
    const chars = new Set([...yj.map(r => r.char), ...foldEvents.map(e => e.char)]);
    const byMonth = {};
    for (const d of days) byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1;
    const month = Object.entries(byMonth).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0] || null;
    // eslint-disable-next-line no-undef
    const seedRows = SEED;
    const rankOf = c => {
      const row = seedRows.find(w => w.target === c || (Number.isInteger(w.ci) && Array.from(w.ans)[w.ci] === c));
      return row && row.rank ? { rank: row.rank, py: row.py } : null;
    };
    let rare = null;
    for (const c of chars) {
      const k = rankOf(c);
      if (k && (!rare || k.rank > rare.rank)) rare = { char: c, rank: k.rank, py: k.py };
    }
    foldEvents.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.i - b.i));
    let first = yj.length ? { char: yj[0].char, day: yj[0].localDay, record: yj[0].id } : null;
    if (foldEvents.length && (!first || foldEvents[0].day < first.day)) first = { char: foldEvents[0].char, day: foldEvents[0].day, record: '' };
    const inkIds = Object.values(st.ink || {}).flatMap(t => Object.keys(t));
    return { count: chars.size, days: days.size, month, rare, first, inkIds };
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
    const sec = k => root.querySelector(`[data-testid="annual-section"][data-key="${k}"]`);
    const secView = k => {
      const el = sec(k);
      if (!el) return null;
      return { title: txt(el.querySelector('[data-testid="annual-section-title"]')),
        notes: [...el.querySelectorAll('[data-testid="annual-section-note"]')].map(txt) };
    };
    const first = q('annual-first');
    const rare = q('annual-rare');
    return {
      title: txt(root.querySelector('[data-page-title]')),
      state: body ? body.dataset.state : null,
      year: body ? body.dataset.year : null,
      today: body ? body.dataset.today : null,
      yearText: txt(q('annual-year')),
      empty: q('annual-empty') ? { glyph: txt(q('annual-empty-glyph')), title: txt(q('annual-empty-title')), body: txt(q('annual-empty-body')) } : null,
      sections: all('annual-section').map(el => el.dataset.key),
      s: { count: secView('count'), month: secView('month'), rare: secView('rare'), first: secView('first') },
      count: q('annual-count') ? { n: Number(q('annual-count').dataset.n), text: txt(q('annual-count')), unit: txt(q('annual-count-unit')) } : null,
      month: q('annual-month') ? { month: q('annual-month').dataset.month, days: Number(q('annual-month').dataset.days), text: txt(q('annual-month')) } : null,
      rare: rare ? { char: rare.dataset.char, rank: Number(rare.dataset.rank), glyphChar: txt(q('annual-rare-char')), py: txt(q('annual-rare-py')),
        glyph: !!q('annual-rare-glyph'), glyphLabel: q('annual-rare-glyph') ? q('annual-rare-glyph').getAttribute('aria-label') : null } : null,
      first: first ? { char: first.dataset.char, day: first.dataset.day, record: first.dataset.record, ink: first.dataset.ink,
        inkEl: !!q('annual-first-ink'), inkLabel: q('annual-first-ink') ? q('annual-first-ink').getAttribute('aria-label') : null,
        noink: txt(q('annual-first-noink')), charText: txt(q('annual-first-char')), line: txt(q('annual-first-line')),
        canvas: !!(q('annual-first-ink') && q('annual-first-ink').querySelector('canvas')) } : null,
      footer: txt(q('annual-footer')),
      buttons: [...root.querySelectorAll('button, [role="button"], a[href]')].map(b => b.dataset.testid || b.outerHTML.slice(0, 60)),
      exportish: [...root.querySelectorAll('[data-testid^="image-"], [data-testid*="share"], [data-testid*="save"]')].length,
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

// 今天 2026-09-24。去年记录（不算）、今年跨 1/3/5/9 月；5 月与 9 月各 3 天 → 并列取 9 月；第一条（1-05「静」）有笔迹。
const RICH = {
  steps: [
    { char: '豕', judgment: 'correct', day: '2025-12-30' },
    { char: '籍', judgment: 'wrong', day: '2025-12-31' },
    { char: '静', judgment: 'wrong', day: '2026-01-05', ink: true },
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
  assert.equal(v.title, COPY.title, 'page title 年度报告');
  assert.deepEqual(v.empty, { glyph: '年', title: COPY.emptyTitle, body: COPY.emptyBody }, 'R-M06 empty state');
  assert.deepEqual(v.sections, [], 'no sections in the empty state');
  assert.equal(v.footer, null, 'no footer in the empty state (prototype annualEmpty)');

  for (const [label, spec] of [
    ['only answer-seen / skipped', { extra: RICH.extra }],
    ['only last year', { steps: RICH.steps.slice(0, 2) }],
  ]) {
    await seed(page, spec);
    await waitState(page, 'empty');
    v = await view(page);
    assert.equal(v.empty && v.empty.title, COPY.emptyTitle, `${label} → 今年还没有记录`);
  }

  // ------------------------------------------------------------------ 2. 四节按记录算
  step('report: four sections recomputed from getState + SEED ranks');
  await seed(page, RICH);
  await waitState(page, 'report');
  const o = await oracle(page, 2026);
  v = await view(page);
  assert.equal(v.year, '2026', 'data-year');
  assert.equal(v.yearText, '2026', 'year line (Arabic digits, T10)');
  assert.deepEqual(v.sections, ['count', 'month', 'rare', 'first'], 'four sections in prototype order');
  assert.deepEqual(v.s.count, { title: COPY.s1, notes: [COPY.s1Note] }, 'section 1 title + note');
  assert.equal(v.count.n, o.count, `count = distinct judged chars this year (oracle ${o.count})`);
  assert.equal(o.count, 7, 'oracle sanity: 静 谁 题 慢 额 数 感');
  assert.equal(v.count.text, `${o.count} 个字`, '「N 个字」');
  assert.equal(v.count.unit, '个字', 'unit split from the number');
  assert.deepEqual(v.s.month, { title: COPY.s2, notes: [COPY.s2Note] }, 'section 2 title + note');
  assert.deepEqual([v.month.month, v.month.days], [o.month[0], o.month[1]], 'busiest month (oracle)');
  assert.deepEqual(o.month, ['2026-09', 3], 'oracle sanity: May and Sept tie at 3 days → Sept');
  assert.equal(v.month.text, COPY.monthDays(9, 3), '「9 月有记录 3 天」');
  assert.deepEqual(v.s.rare, { title: COPY.s3, notes: [COPY.s3Note] }, 'section 3 title + note');
  assert.ok(o.rare, 'oracle found a ranked char');
  assert.deepEqual([v.rare.char, v.rare.rank], [o.rare.char, o.rare.rank], `rarest = max SEED rank (${o.rare.char} #${o.rare.rank})`);
  assert.ok(v.rare.char !== '豕', 'last year\'s 豕 is not considered');
  assert.equal(v.rare.glyphChar, o.rare.char, 'char text');
  assert.equal(v.rare.py, o.rare.py, 'pinyin from the deck');
  assert.equal(v.rare.glyph, true, 'standard glyph box (RefMini)');
  assert.equal(v.rare.glyphLabel, `「${o.rare.char}」的标准字形`, 'glyph accessible name');
  assert.deepEqual(v.s.first, { title: COPY.s4, notes: [] }, 'section 4 title');
  assert.deepEqual([v.first.char, v.first.day, v.first.record], [o.first.char, o.first.day, o.first.record], 'first judged record of the year');
  assert.deepEqual([o.first.char, o.first.day], ['静', '2026-01-05'], 'oracle sanity: answer-seen 户 on 1-02 does not count');

  // ------------------------------------------------------------------ 3. 第四节笔迹
  step('section 4: ink of that record → drawn + 「{date} · 你当时的笔迹」');
  assert.ok(o.inkIds.includes(o.first.record), 'that record has stored ink (seed)');
  assert.equal(v.first.ink, 'true', 'data-ink');
  assert.equal(v.first.inkEl && v.first.canvas, true, 'InkMini canvas drawn');
  assert.equal(v.first.inkLabel, '「静」当时的笔迹', 'ink accessible name');
  assert.equal(v.first.noink, null, 'no 没有笔迹');
  assert.equal(v.first.line, COPY.inkLine(md('2026-01-05')), '「1 月 5 日 · 你当时的笔迹」');
  const painted = await page.evaluate(sel => {
    const c = document.querySelector(`${sel} [data-testid="annual-first-ink"] canvas`);
    if (!c || !c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n += 1;
    return n;
  }, TOP);
  assert.ok(painted > 0, `ink pixels painted (${painted})`);

  step('section 4 without ink: standard glyph + 没有笔迹, line = date only; folded month earlier in the year');
  const noInk = { steps: RICH.steps.map(s => ({ ...s, ink: false })), extra: RICH.extra };
  await seed(page, noInk);
  await waitState(page, 'report');
  v = await view(page);
  assert.equal(v.first.ink, 'false', 'data-ink false');
  assert.equal(v.first.inkEl, false, 'no InkMini');
  assert.equal(v.first.noink, COPY.noInk, '「没有笔迹」 (R-D07 / 10.12)');
  assert.equal(v.first.line, md('2026-01-05'), 'line is the date only (no 「你当时的笔迹」 without ink)');
  const folded = { folded: true, month: '2026-02', byDay: { '2026-02-03': ['永', '和'] }, chars: ['永', '和'], kept: [] };
  const earlyFold = { folded: true, month: '2026-01', byDay: { '2026-01-01': ['和'] }, chars: ['和'], kept: [] };
  await seed(page, { steps: RICH.steps.filter(s => s.day >= '2026-03' || s.day < '2026'), folded: [earlyFold, folded] });
  await waitState(page, 'report', { count: 8 });
  const of = await oracle(page, 2026);
  v = await view(page);
  assert.equal(v.count.n, of.count, 'folded chars count (oracle)');
  assert.deepEqual([v.first.char, v.first.day, v.first.record], ['和', '2026-01-01', ''], 'first = folded day (no record)');
  assert.equal(v.first.noink, COPY.noInk, 'folded first shows 没有笔迹');

  // ------------------------------------------------------------------ 4. 不导出
  step('no export: only the header back button; no image / share / save entries; footer sentence');
  await seed(page, RICH);
  await waitState(page, 'report', { count: 7 });
  v = await view(page);
  assert.deepEqual(v.buttons, ['page-back'], 'the only button is the header back');
  assert.equal(v.exportish, 0, 'no image / share / save entries');
  assert.equal(v.footer, COPY.footer, 'R-M06 footer');
  assert.ok(!/保存图片|分享/.test(v.bodyText.replace(COPY.footer, '')), 'no 保存图片 / 分享 wording besides the footer');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');
  assert.equal(v.hScroll, false, 'no horizontal overflow (393)');

  // ------------------------------------------------------------------ 5. 不写、刷新、跨年
  step('viewing writes nothing; reload stays on annual; back → 我的');
  const raw0 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  await page.evaluate(c => window.__shiziTest.setClock(c), CLOCK);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitTop(page, 'annual');
  await waitState(page, 'report', { count: 7 });
  v = await view(page);
  assert.equal(v.count.n, 7, 'after reload: same report');
  const wReload = await writes(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitTop(page, 'mine');
  assert.equal((await top(page)).depth, 0, 'back → mine tab root');
  const raw1 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  assert.equal(await writes(page) - wReload, 0, 'no writes while on annual after reload and going back');
  assert.deepEqual(raw1, raw0, 'every shizi.* storage key byte-equal before / after viewing + reload');

  step('year boundary: clock 2027-01-02 → 今年还没有记录');
  await page.click(`${TOP} ${tid('mine-menu-annual')}`);
  await waitTop(page, 'annual');
  const wBefore = await writes(page);
  await page.evaluate(() => {
    window.__shiziTest.setClock('2027-01-02T09:00:00');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitState(page, 'empty', { year: 2027 });
  v = await view(page);
  assert.equal(v.empty && v.empty.title, COPY.emptyTitle, 'new year: empty state');
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
  const big = { steps: deckChars.map((c, i) => ({ char: c, judgment: i % 7 === 0 ? 'wrong' : 'correct',
    day: `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + Math.floor(i / 9) % 28).padStart(2, '0')}` })) };
  const t0 = Date.now();
  await seed(page, big);
  await waitState(page, 'report', { count: 300 });
  const ms = Date.now() - t0;
  console.log(`annual 300: seed→render ${ms}ms`);
  const ob = await oracle(page, 2026);
  v = await view(page);
  assert.equal(v.count.n, 300, '300 chars');
  assert.deepEqual([v.month.month, v.month.days], [ob.month[0], ob.month[1]], 'busiest month (oracle, 300)');
  assert.equal(v.rare.char, ob.rare.char, 'rarest (oracle, 300)');
  assert.ok(ms < 3000, `renders within 3s (${ms}ms)`);

  step('dark (system and data-theme) + 360×640: no overflow, names');
  await seed(page, RICH);
  await waitState(page, 'report', { count: 7 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(200);
  v = await view(page);
  const darkBox = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} .sz-ann__box`)).backgroundColor, TOP);
  assert.equal(darkBox, 'rgb(45, 40, 35)', 'glyph box uses dark --c');
  assert.equal(v.hScroll, false, '360 dark: no horizontal overflow');
  assert.deepEqual(v.unnamedButtons, [], 'names in dark / compact');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(100);
  const forced = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} .sz-ann__box`)).backgroundColor, TOP);
  assert.equal(forced, 'rgb(45, 40, 35)', 'data-theme=dark forced');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(100);
  v = await view(page);
  assert.equal(v.hScroll, false, '320×568: no horizontal overflow');
  await page.setViewportSize({ width: 393, height: 852 });
}
