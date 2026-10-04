// M3-4「有记录的字」完整页（02 §5 M3-4；04 R-A01–R-A04；03 P04 / P20 / P27 / P56；原型 字库墨墙屏-第十稿交接版 L85–L114、L367–L402）。
//
// 场景（钩子 seed + setClock 2026-09-24；300 个字、一年量级：最近一次记录从今天铺到 365 天前，跨年）：
//   1. 进入：字库首页大数字 → library-all；首屏渲染 < 200ms（performance.now，nav.push → 页面画出首批格子）；分批画完全部格子。
//   2. 最近写的（默认）：自选了还没写一组在最前；月份新 → 旧，默认展开最近两个月，其余收在下面（去年的月份带年）；
//      点收起的月份展开、点展开的月份标题收起（R-A01）；格子顺序与写错过画法。
//   3. 拼音：首字母分组，每格标拼音（= 题库 py，P20），组名 = 去声调首字母（R-A04）。
//   4. 多久没写：四档（P56），最久的排前。
//   5. 筛选四项：数目、再点取消、筛选后排序收起、0 个的变灰且不可点（R-A02 / R-A04）；自选的字两组。
//   6. 「练这些字 →」：自选了还没写 → 开这次选的字（B，来源 allWritten）；写入失败（failNextWrite）留在本页、不写入、可再点；
//      写错过 → 推入写错过清单页。
//   7. 页内查字：命中只显示那个月、描一圈、「在 X 月」；没有记录「「X」还没有记录。」；拼音查（R-A03 / R-A04）。
//   8. 点格子 → 单字详情 {char}；浏览不写入；视图参数刷新后恢复；0 个字空态；紧凑版列数；可访问性；无横向滚动。

import { bootTestHost, tid, waitNavIdle, setTextSize, LARGE_TEXT } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';
const BODY = `${TOP} [data-testid="all-body"]`;
const HOLLOW = ['馨', '鼎'];

const COPY = {
  title: '有记录的字',
  recentNote: '按最近一次写的月份排。每格是你最近一次的笔迹。', // D27：perRecordInk 默认开启 → 原槽；关闭态见 47-ink-promises
  pyNote: '按拼音首字母排。多音字按第一个读音。',
  ageNote: '离上次写越久，排得越前。',
  sorts: ['最近写的', '拼音', '多久没写'],
  hollowGroup: '自选了还没写',
  recordedGroup: '有记录',
  tones: ['一周内写过', '一个月内', '三个月内', '三个月以上'],
  wrongNote: '你判断写错的字。',
  forgetNote: '有一阵没写、可能快忘了的字。',
  unwNote: '加入了自选的字，还没有记录。',
  customNote: '你自己挑来常练的字。还没写的排在前面。',
  go: '练这些字',
  searchAria: '在有记录的字里查字',
  foundIn: m => `在 ${m}月`,
  notFound: c => `「${c}」还没有记录。`,
  startFailed: '没保存上，刚才的选择没记下。',
  emptyTitle: '你写下的字会留在这里',
};

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function dayAgo(n) {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return y === 2026 ? `${m}月` : `${y}年${m}月`;
}

function stripPy(py) {
  return String(py || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/v/g, 'u').replace(/[^a-z]/g, '');
}

/**
 * 一年量级的种子：第 i 个字最近一次记录在 floor(i*365/n) 天前（i=0 今天）；每 6 个字先有一条更早的写错、后来写对；
 * 每 7 个字最近一次写错；自选：HOLLOW 两个没写 + 第 3 个字；sched：最近一次写对且 > 100 天前的前 5 个到期（快忘了）。
 */
function yearSeed(chars, { custom = true } = {}) {
  const rows = [];
  chars.forEach((c, i) => {
    const ago = Math.floor((i * 365) / chars.length);
    const day = dayAgo(ago);
    const last = { c, day, at: new Date(`${day}T08:00:00`).getTime() + (chars.length - i) * 1000, judgment: i % 7 === 3 ? 'wrong' : 'correct', i, ago };
    if (i % 6 === 1 && ago < 360) {
      const d0 = dayAgo(ago + 5);
      rows.push({ c, day: d0, at: new Date(`${d0}T07:00:00`).getTime(), judgment: 'wrong', i, early: true });
    }
    rows.push(last);
  });
  rows.sort((a, b) => a.at - b.at);
  const records = {};
  rows.forEach((row, k) => {
    const r = {
      id: `r${k + 1}`, cardKey: `base:${row.c}`, char: row.c, sessionId: 's900', kind: 'judged', judgment: row.judgment,
      at: row.at, localDay: row.day, help: { hints: 0, answerSeen: false, traced: false },
    };
    (records[row.day.slice(0, 7)] || (records[row.day.slice(0, 7)] = [])).push(r);
  });
  const latest = rows.filter(r => !r.early);
  const state = { records, sched: {} };
  for (const r of latest.filter(x => x.judgment === 'correct' && x.ago > 100).slice(0, 5)) {
    state.sched[`base:${r.c}`] = { fsrs: { stability: 3 }, due: dayAgo(20), lastJudgedAt: r.at };
  }
  if (custom) state.custom = { added: [...HOLLOW, chars[2]].map((char, i) => ({ char, at: 1000 + i })) };
  return { state, latest };
}

async function routerTop(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { depth: s.depth, name: s.top ? s.top.n : null, params: s.top ? s.top.p : null };
  });
}

async function goLibraryRoot(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('library');
  });
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === 'library';
  });
  await waitNavIdle(page, { settleMs: 150 });
}

async function seed(page, state) {
  await goLibraryRoot(page);
  const r = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    const res = s ? window.__shiziTest.seed(s) : { ok: true };
    document.dispatchEvent(new Event('visibilitychange'));
    return res;
  }, { iso: CLOCK, s: state });
  if (!r || !r.ok) throw new Error('seed failed: ' + JSON.stringify(r));
  await page.waitForTimeout(80);
}

/** nav.push('library-all') → 页面画出首批格子（rAF 轮询）的毫秒数。 */
async function openAll(page, params) {
  const ms = await page.evaluate(async p => {
    const { nav } = await import('/src/ui/router.js');
    const t0 = performance.now();
    nav.push('library-all', p || {});
    return new Promise(resolve => {
      const tick = () => {
        const body = document.querySelector('.sz-layer[data-top="true"] [data-testid="all-body"], .sz-layer[data-top="true"] [data-testid="all-empty"]');
        if (body && (body.dataset.testid === 'all-empty' || body.querySelector('[data-testid="all-cell"]'))) {
          window.__allFirst = { rendered: Number(body.dataset.rendered), cells: body.querySelectorAll('[data-testid="all-cell"]').length, total: Number(body.dataset.total) };
          resolve(performance.now() - t0);
        }
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }, params);
  await waitNavIdle(page, { settleMs: 150 });
  return ms;
}

async function waitRendered(page) {
  await page.waitForFunction(sel => {
    const b = document.querySelector(sel);
    return !!b && b.dataset.rendered === b.dataset.total;
  }, BODY);
}

async function view(page) {
  await waitRendered(page);
  const base = await page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const all = (id, el = root) => [...el.querySelectorAll(`[data-testid="${id}"]`)];
    const layer = root.closest('.sz-layer');
    return {
      title: txt(layer.querySelector('[data-page-title]')),
      sort: root.dataset.sort,
      filter: root.dataset.filter,
      findMode: root.dataset.findMode,
      found: root.dataset.found === 'true',
      total: Number(root.dataset.total),
      rendered: Number(root.dataset.rendered),
      cols: Number(root.dataset.cols),
      recorded: Number(root.dataset.recorded),
      sorts: q('all-sorts') ? all('all-sort').map(b => ({ key: b.dataset.key, text: txt(b), pressed: b.getAttribute('aria-pressed') })) : null,
      chips: q('all-chips') ? all('all-chip').map(b => ({ key: b.dataset.key, text: txt(b), n: Number(b.dataset.n), pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') })) : null,
      legend: !!q('library-legend'),
      note: txt(q('all-note')),
      where: txt(q('all-find-where')),
      miss: txt(q('all-find-miss')),
      findAria: q('all-find') ? q('all-find').getAttribute('aria-label') : null,
      groups: all('all-group').map(g => {
        const head = g.querySelector('[data-testid="all-group-head"]');
        return {
          key: g.dataset.key, month: g.dataset.month || null,
          name: txt(g.querySelector('[data-testid="all-group-name"]')), count: txt(g.querySelector('[data-testid="all-group-count"]')),
          headTag: head ? head.tagName : null, expanded: head ? head.getAttribute('aria-expanded') : null,
          cells: all('all-cell', g).map(c => ({
            char: c.dataset.char, kind: c.dataset.kind, tone: c.dataset.tone, hit: c.dataset.hit === 'true', py: c.dataset.py ?? null,
            pyText: c.querySelector('[data-testid="all-cell-py"]') ? c.querySelector('[data-testid="all-cell-py"]').textContent : null,
            label: c.getAttribute('aria-label'), ring: !!c.querySelector('.sz-all__ring'), mark: !!c.querySelector('.sz-lib__mark'),
          })),
        };
      }),
      closed: all('all-month').map(b => ({ month: b.dataset.month, text: txt(b), expanded: b.getAttribute('aria-expanded') })),
      go: q('all-go') ? { kind: q('all-go').dataset.kind, text: txt(q('all-go')) } : null,
      fail: txt(q('all-start-fail')),
      unnamedButtons: [...layer.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.innerText || '').trim()).map(b => b.outerHTML.slice(0, 80)),
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1
        || root.closest('.sz-page__body').scrollWidth > root.closest('.sz-page__body').clientWidth + 1,
      hDims: [document.scrollingElement.scrollWidth, window.innerWidth, root.closest('.sz-page__body').scrollWidth, root.closest('.sz-page__body').clientWidth],
    };
  }, BODY);
  if (!base) return null;
  // H1 / T2-11：排序、筛选、图例、说明句收进页头尾端「排序 · 筛选」菜单——读菜单当前发布的视图（弹层里的真实渲染另见 81-h1-library-menu）
  const m = await page.evaluate(async () => (await import('/src/ui/screens/library/all.js')).allMenuSnapshot());
  const hasBtn = await page.evaluate(() => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="all-menu-open"]'));
  const on = !!(m && hasBtn);
  base.menuButton = hasBtn;
  base.sorts = on && m.showSort ? m.sorts.map(x => ({ key: x.key, text: x.label, pressed: x.active ? 'true' : 'false' })) : null;
  base.chips = on && m.showChips ? m.chips.map(c => ({ key: c.key, text: c.label, n: c.n, pressed: c.active ? 'true' : 'false', disabled: !!c.disabled, ariaDisabled: c.disabled ? 'true' : null })) : null;
  base.legend = !!(on && m.showLegend);
  base.note = on && m.note ? m.note.replace(/\s+/g, ' ').trim() : null;
  return base;
}

/** 打开「排序 · 筛选」菜单点里面的一项（点完弹层关闭；stay = 点不动的项，弹层还开着，用 closeMenu 收）。 */
async function menuClick(page, inner, { stay = false, force = false } = {}) {
  await page.click(`${TOP} ${tid('all-menu-open')}`);
  await page.waitForSelector(`${TOP} ${tid('all-menu')}`);
  await waitNavIdle(page, { settleMs: 450 });
  await page.click(`${TOP} ${tid('all-menu')} ${inner}`, { force });
  await page.waitForTimeout(40);
  if (!stay) await waitNavIdle(page, { settleMs: 450 });
}

async function closeMenu(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page, { settleMs: 450 });
}

async function click(page, selector) {
  await page.click(selector);
  await page.waitForTimeout(40);
}

async function backToAll(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === 'library-all';
  });
  await waitNavIdle(page, { settleMs: 150 });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  const deck = await page.evaluate(async () => {
    const { getDeck } = await import('/src/data/deck.js');
    const d = getDeck();
    const out = [];
    for (const k of d.keys) {
      if (!k.startsWith('base:')) continue;
      const c = k.slice(5);
      if (c === '馨' || c === '鼎') continue;
      out.push([c, d.index.get(k).py || '']);
      if (out.length >= 320) break;
    }
    return out;
  });
  const PY = Object.fromEntries(deck);
  const chars = deck.map(([c]) => c).slice(0, 300);
  assert.equal(chars.length, 300, 'deck provides 300 practicable chars');
  const { state: S300, latest } = yearSeed(chars);
  const byNew = [...latest].sort((a, b) => b.at - a.at);
  const wrongChars = byNew.filter(r => r.judgment === 'wrong').map(r => r.c);
  const forgetChars = Object.keys(S300.sched).map(k => k.slice(5));

  // ------------------------------------------------------------------ 1. 进入与首屏
  step('enter from the library home 「还有 N 个字 ›」 (the big number is a caption now, D49); 300 chars first paint < 200ms; batches fill in');
  await seed(page, S300);
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel);
    return !!el && Number(el.dataset.recorded) === 300;
  }, `${TOP} [data-testid="library-home"]`);
  await page.waitForTimeout(450); // 新状态后 0.4s 按钮不响应（01 §6.6）
  await click(page, `${TOP} ${tid('library-more')}`);
  await page.waitForSelector(BODY);
  await waitNavIdle(page, { settleMs: 150 });
  let top = await routerTop(page);
  assert.equal(top.name, 'library-all', '还有 N 个字 › → library-all (real registration, not a stub)');
  await backToAllRoot();
  async function backToAllRoot() {
    await page.evaluate(async () => {
      const { nav } = await import('/src/ui/router.js');
      nav.back();
    });
    await page.waitForFunction(async () => {
      const { getRouter } = await import('/src/ui/router.js');
      return getRouter().getState().depth === 0;
    });
    await waitNavIdle(page, { settleMs: 150 });
  }
  const times = [];
  for (let k = 0; k < 3; k += 1) {
    times.push(await openAll(page));
    if (k < 2) await backToAllRoot();
  }
  const best = Math.min(...times);
  assert.ok(times.every(ms => ms < 200), `300 chars: first paint ${times.map(ms => ms.toFixed(0)).join(' / ')}ms (< 200ms each)`);
  const firstBatch = await page.evaluate(sel => Number(document.querySelector(sel).dataset.rendered), BODY);
  assert.ok(firstBatch > 0, `first batch rendered (${firstBatch} cells, best ${best.toFixed(0)}ms)`);
  await backToAllRoot();
  const pyMs = await openAll(page, { sort: 'py' });
  const pyFirst = await page.evaluate(() => window.__allFirst);
  assert.ok(pyMs < 200, `300 chars, pinyin sort (all groups open): first paint ${pyMs.toFixed(0)}ms (< 200ms)`);
  assert.ok(pyFirst.total > 72 && pyFirst.cells <= 72 && pyFirst.rendered === pyFirst.cells,
    `first paint draws one batch ≤ 72 cells (01 §10): ${pyFirst.cells} of ${pyFirst.total}`);
  await waitRendered(page);
  await backToAllRoot();
  await openAll(page);
  let v = await view(page);
  assert.equal(v.title, COPY.title, 'page title 有记录的字');
  assert.equal(v.recorded, 300, 'recorded 300 (same as the home big number)');
  assert.equal(v.rendered, v.total, `all ${v.total} cells rendered after batching`);
  assert.equal(v.cols, 8, '8 columns (same as the wall)');
  assert.equal(v.findAria, COPY.searchAria, 'find box aria-label 「在有记录的字里查字」 (R-A03)');

  // ------------------------------------------------------------------ 2. 最近写的
  step('recent (default): hollow group first, two latest months open, older months folded (cross-year label)');
  const months = [...new Set(byNew.map(r => r.day.slice(0, 7)))];
  assert.equal(v.sort, 'recent', 'default sort recent');
  assert.deepEqual(v.sorts.map(s => [s.text, s.pressed]), [[COPY.sorts[0], 'true'], [COPY.sorts[1], 'false'], [COPY.sorts[2], 'false']], 'three sorts (R-A01)');
  assert.equal(v.note, COPY.recentNote, 'R-A01 recent note');
  assert.ok(v.legend, 'legend shown');
  assert.deepEqual(v.groups.map(g => g.name), [COPY.hollowGroup, monthLabel(months[0]), monthLabel(months[1])], 'hollow + two latest months');
  assert.deepEqual(v.groups[0].cells.map(c => [c.char, c.kind]), HOLLOW.map(c => [c, 'hollow']), 'hollow cells');
  const m0 = byNew.filter(r => r.day.startsWith(months[0]));
  assert.equal(v.groups[1].count, `${m0.length} 个字`, 'month count');
  assert.deepEqual(v.groups[1].cells.map(c => c.char), m0.map(r => r.c), 'month cells newest → oldest');
  assert.equal(v.groups[1].headTag, 'BUTTON', 'open month title is a button (tap to fold)');
  assert.equal(v.groups[1].expanded, 'true', 'aria-expanded=true');
  assert.deepEqual(v.closed.map(c => c.month), months.slice(2), 'older months folded, new → old');
  assert.ok(v.closed.some(c => c.text.startsWith('2025年')), 'last-year months carry the year');
  const lastClosed = v.closed.at(-1);
  const lastN = byNew.filter(r => r.day.startsWith(lastClosed.month)).length;
  assert.equal(lastClosed.text, `${monthLabel(lastClosed.month)} ${lastN} 个字 ›`, 'closed month row: name + N 个字 ›');
  const wrongInView = v.groups.flatMap(g => g.cells).filter(c => c.kind === 'wrong');
  assert.ok(wrongInView.length > 0 && wrongInView.every(c => wrongChars.includes(c.char) && c.mark), 'wrong = latest judged wrong, red dot');
  const earlyWrongNowCorrect = latest.find(r => r.i % 6 === 1 && r.judgment === 'correct' && r.day.startsWith(months[0]));
  if (earlyWrongNowCorrect) {
    const cell = v.groups[1].cells.find(c => c.char === earlyWrongNowCorrect.c);
    assert.equal(cell.kind, 'ink', `「${earlyWrongNowCorrect.c}」 wrong earlier, correct last → not wrong (D23)`);
  }

  step('fold: tap a folded month to open it, tap an open month title to fold it (R-A01)');
  await click(page, `${BODY} [data-testid="all-month"][data-month="${lastClosed.month}"]`);
  v = await view(page);
  assert.ok(v.groups.some(g => g.month === lastClosed.month), 'folded month opened');
  assert.ok(!v.closed.some(c => c.month === lastClosed.month), 'no longer in the folded list');
  await click(page, `${BODY} [data-testid="all-group"][data-month="${months[0]}"] [data-testid="all-group-head"]`);
  v = await view(page);
  assert.ok(!v.groups.some(g => g.month === months[0]), 'latest month folded');
  assert.equal(v.closed[0].month, months[0], 'it moves to the folded list');
  top = await routerTop(page);
  assert.deepEqual(top.params.fold, { [lastClosed.month]: true, [months[0]]: false }, 'fold state written to params');
  await click(page, `${BODY} [data-testid="all-month"][data-month="${months[0]}"]`);

  // ------------------------------------------------------------------ 3. 拼音
  step('pinyin: initial groups, every cell labelled with its pinyin (R-A04 / P20)');
  await menuClick(page, '[data-testid="all-sort"][data-key="py"]');
  v = await view(page);
  assert.equal(v.sort, 'py', 'sort py');
  assert.equal(v.note, COPY.pyNote, 'R-A01 pinyin note');
  const pyGroups = v.groups.filter(g => g.key.startsWith('p:'));
  assert.ok(pyGroups.length >= 10, `${pyGroups.length} initial groups`);
  assert.deepEqual(pyGroups.map(g => g.name), [...pyGroups.map(g => g.name)].sort(), 'groups A → Z');
  let pyOk = true;
  let labelOk = true;
  for (const g of pyGroups) {
    for (const c of g.cells) {
      if (stripPy(PY[c.char])[0].toUpperCase() !== g.name) pyOk = false;
      if (c.pyText !== PY[c.char] || c.py !== PY[c.char]) labelOk = false;
    }
  }
  assert.ok(pyOk, 'each char sits under the initial of its (toneless) pinyin');
  assert.ok(labelOk, 'each cell shows the deck pinyin under the glyph');
  assert.equal(pyGroups.reduce((n, g) => n + g.cells.length, 0), 300, 'all 300 chars grouped');
  assert.equal(v.groups[0].name, COPY.hollowGroup, 'hollow group still first');

  // ------------------------------------------------------------------ 4. 多久没写
  step('age: four tones, oldest first (P56)');
  await menuClick(page, '[data-testid="all-sort"][data-key="age"]');
  v = await view(page);
  assert.equal(v.note, COPY.ageNote, 'age note');
  const toneGroups = v.groups.filter(g => g.key.startsWith('t:'));
  assert.deepEqual(toneGroups.map(g => g.name), [COPY.tones[3], COPY.tones[2], COPY.tones[1], COPY.tones[0]], 'oldest tone first');
  const oldest = toneGroups[0].cells;
  const expOldest = [...latest].filter(r => r.ago > 90).sort((a, b) => a.at - b.at).map(r => r.c);
  assert.deepEqual(oldest.map(c => c.char), expOldest, 'inside a tone, the longest-unwritten first');
  assert.ok(toneGroups.every(g => g.cells.every(c => c.kind === 'wrong' || c.tone === g.key.slice(2))), 'cells carry their group tone');

  // ------------------------------------------------------------------ 5. 筛选
  step('filters: counts, toggle off, sort collapses, custom groups (R-A02 / R-A04)');
  assert.deepEqual(v.chips.map(c => [c.key, c.text, c.disabled]), [
    ['wrong', `写错过 ${wrongChars.length}`, false],
    ['forget', `快忘了 ${forgetChars.length}`, false],
    ['unw', `自选了还没写 ${HOLLOW.length}`, false],
    ['custom', `自选的字 ${HOLLOW.length + 1}`, false],
  ], 'chip labels with counts');
  await menuClick(page, '[data-testid="all-chip"][data-key="wrong"]');
  v = await view(page);
  assert.equal(v.filter, 'wrong', 'filter wrong on');
  assert.equal(v.sorts, null, 'R-A04: sort collapsed while a filter is on');
  assert.equal(v.chips[0].pressed, 'true', 'wrong chip pressed');
  assert.equal(v.note, COPY.wrongNote, 'wrong note');
  assert.deepEqual(v.groups.flatMap(g => g.cells.map(c => c.char)), wrongChars, 'wrong filter = latest wrong, newest first');
  assert.deepEqual(v.go, { kind: 'list', text: COPY.go }, '练这些字 → (to the wrong list)');
  await menuClick(page, '[data-testid="all-chip"][data-key="wrong"]');
  v = await view(page);
  assert.equal(v.filter, '', 'tap again cancels');
  assert.equal(v.sort, 'age', 'sort restored');
  assert.ok(v.sorts, 'sort control back');
  await menuClick(page, '[data-testid="all-chip"][data-key="forget"]');
  v = await view(page);
  assert.equal(v.note, COPY.forgetNote, 'forget note');
  assert.deepEqual(v.groups.flatMap(g => g.cells.map(c => c.char)).sort(), [...forgetChars].sort(), 'forget filter = due & latest correct (K16)');
  await menuClick(page, '[data-testid="all-chip"][data-key="custom"]');
  v = await view(page);
  assert.equal(v.filter, 'custom', 'switching filters');
  assert.equal(v.note, COPY.customNote, 'custom note (R-A02)');
  assert.deepEqual(v.groups.map(g => [g.name, g.cells.map(c => c.char).join('')]), [
    [COPY.hollowGroup, HOLLOW.join('')], [COPY.recordedGroup, chars[2]],
  ], 'custom: unwritten first, then recorded (K19)');
  assert.equal(v.go, null, 'no practice button under 自选的字');
  await menuClick(page, '[data-testid="all-chip"][data-key="unw"]');
  v = await view(page);
  assert.equal(v.note, COPY.unwNote, 'unw note (R-A02)');
  assert.deepEqual(v.groups[0].cells.map(c => [c.char, c.kind]), HOLLOW.map(c => [c, 'hollow']), 'unw cells = hollow');
  assert.deepEqual(v.go, { kind: 'start', text: COPY.go }, '练这些字 → after 自选了还没写');

  // ------------------------------------------------------------------ 6. 练这些字
  step('practice these (unw): write failure stays here, nothing written, retry opens B with source allWritten');
  const before = await page.evaluate(() => window.__shiziTest.getState());
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await click(page, `${BODY} ${tid('all-go')}`);
  await page.waitForTimeout(120);
  v = await view(page);
  assert.equal(v.fail, COPY.startFailed, 'failure note (R-G04)');
  top = await routerTop(page);
  assert.equal(top.name, 'library-all', 'stays on the page');
  assert.equal(v.filter, 'unw', 'filter unchanged');
  const afterFail = await page.evaluate(() => window.__shiziTest.getState());
  assert.deepEqual(afterFail.sessions, before.sessions, 'no session written');
  assert.deepEqual(afterFail.records, before.records, 'records unchanged');
  await page.waitForTimeout(450);
  await click(page, `${BODY} ${tid('all-go')}`);
  await page.waitForSelector(`${TOP} [data-testid="write-screen"]`);
  await waitNavIdle(page, { settleMs: 150 });
  const afterGo = await page.evaluate(() => window.__shiziTest.getState());
  const B = afterGo.sessions.B;
  assert.deepEqual([B.kind, B.source, B.queue], ['picked', { view: 'allWritten' }, HOLLOW.map(c => `base:${c}`)], 'B = picked, source allWritten, queue = unwritten custom chars');
  top = await routerTop(page);
  assert.deepEqual([top.name, top.params.slot], ['write', 'B'], 'write page (B)');
  await backToAll(page);
  v = await view(page);
  assert.equal(v.filter, 'unw', 'back from the write page: filter kept');
  assert.equal(v.fail, null, 'failure note cleared after success');

  step('practice these (wrong): pushes the wrong list page');
  await menuClick(page, '[data-testid="all-chip"][data-key="wrong"]');
  await click(page, `${BODY} ${tid('all-go')}`);
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === 'library-list';
  });
  await waitNavIdle(page, { settleMs: 150 });
  top = await routerTop(page);
  assert.deepEqual([top.name, top.params.kind], ['library-list', 'wrong'], "→ library-list {kind:'wrong'}");
  await backToAll(page);
  await menuClick(page, '[data-testid="all-chip"][data-key="wrong"]');
  await menuClick(page, '[data-testid="all-sort"][data-key="recent"]');

  // ------------------------------------------------------------------ 7. 页内查字
  step('find: a recorded char → only its month, ring, 「在 X 月」 (R-A03)');
  const target = byNew.find(r => r.day.startsWith(months[5]));
  await page.fill(`${BODY} ${tid('all-find')}`, target.c);
  v = await view(page);
  assert.equal(v.found, true, 'found');
  assert.equal(v.findMode, 'char', 'find mode char');
  assert.equal(v.where, COPY.foundIn(Number(target.day.slice(5, 7))), 'where = 在 X 月');
  assert.deepEqual(v.groups.map(g => g.month), [months[5]], 'only that month');
  assert.deepEqual(v.groups[0].cells.filter(c => c.hit).map(c => [c.char, c.ring]), [[target.c, true]], 'ring on the char');
  assert.equal(v.sorts, null, 'sort hidden');
  assert.equal(v.chips, null, 'filters hidden');
  assert.equal(v.legend, false, 'legend hidden');
  assert.equal(v.closed.length, 0, 'no other months');

  step('find: a char without records → 「X」还没有记录。 and the page stays');
  await page.fill(`${BODY} ${tid('all-find')}`, HOLLOW[0]);
  v = await view(page);
  assert.equal(v.found, false, 'not found');
  assert.equal(v.miss, COPY.notFound(HOLLOW[0]), 'miss text');
  assert.ok(v.sorts && v.chips && v.groups.length >= 2, 'page unchanged');

  step('find by pinyin (R-A04): toneless syllable, every hit ringed');
  const pyTarget = byNew.find(r => stripPy(PY[r.c]).length >= 3);
  const q = stripPy(PY[pyTarget.c]);
  await page.fill(`${BODY} ${tid('all-find')}`, q);
  v = await view(page);
  assert.equal(v.findMode, 'pinyin', 'find mode pinyin');
  assert.equal(v.found, true, `pinyin 「${q}」 found`);
  const expHits = latest.filter(r => stripPy(PY[r.c]) === q).map(r => r.c).sort();
  const gotHits = v.groups.flatMap(g => g.cells.filter(c => c.hit).map(c => c.char)).sort();
  assert.deepEqual(gotHits, expHits, `hits = chars read ${q} (${expHits.join('')})`);
  const hitMonths = [...new Set(latest.filter(r => expHits.includes(r.c)).map(r => r.day.slice(0, 7)))].sort().reverse();
  assert.deepEqual(v.groups.map(g => g.month), hitMonths, 'only months containing a hit');
  await page.fill(`${BODY} ${tid('all-find')}`, 'qqqz');
  v = await view(page);
  assert.equal(v.miss, COPY.notFound('qqqz'), 'pinyin miss');
  await page.fill(`${BODY} ${tid('all-find')}`, '');
  v = await view(page);
  assert.equal(v.findMode, 'none', 'find cleared');
  assert.equal(v.note, COPY.recentNote, 'cleared → back to the sorted view');

  // ------------------------------------------------------------------ 8. 去处、参数、写入
  step('tap a cell → detail {char}; browsing writes nothing');
  const cellChar = v.groups[1].cells[0].char;
  await click(page, `${BODY} [data-testid="all-cell"][data-char="${cellChar}"]`);
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === 'detail';
  });
  await waitNavIdle(page, { settleMs: 150 });
  top = await routerTop(page);
  assert.deepEqual({ name: top.name, params: top.params }, { name: 'detail', params: { char: cellChar } }, 'cell → detail {char}');
  await backToAll(page);
  const log = await page.evaluate(() => window.__shiziTest.getWriteLog());
  assert.equal(log.filter(e => e.via === 'direct').length, 0, 'no direct localStorage writes');

  step('view params survive a reload');
  await menuClick(page, '[data-testid="all-sort"][data-key="py"]');
  await page.fill(`${BODY} ${tid('all-find')}`, 'zzz');
  await page.waitForTimeout(80);
  await page.fill(`${BODY} ${tid('all-find')}`, '');
  await page.waitForTimeout(80);
  await page.reload();
  await page.waitForSelector(BODY);
  await waitNavIdle(page, { settleMs: 150 });
  v = await view(page);
  assert.equal(v.sort, 'py', 'sort restored from params after reload');

  step('a11y and layout: named buttons, no horizontal scroll; 360×640 → 7 columns (cells ≥ 44pt), system large text → 6 (P1-E1b)');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');
  assert.equal(v.hScroll, false, `no horizontal scroll ${v.hDims}`);
  const aCell = v.groups.find(g => g.cells.length).cells[0];
  assert.ok(/^.，.+$/u.test(aCell.label), `cell name 「字，状态」 (${aCell.label})`);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(150);
  v = await view(page);
  assert.equal(v.cols, 7, '360×640: 7 columns so every cell stays ≥ 44pt wide (360 − 40) ÷ 44');
  assert.equal(v.hScroll, false, '360×640: no horizontal scroll');
  await setTextSize(page, LARGE_TEXT);
  await page.waitForTimeout(250);
  v = await view(page);
  assert.equal(v.cols, 6, 'XXXL system text: 6 columns');
  assert.equal(v.hScroll, false, 'XXXL: no horizontal scroll');
  await setTextSize(page, 'L');
  await page.setViewportSize({ width: 393, height: 852 });

  step('zero-count filters greyed & inert; 0 records → empty state');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('library');
  });
  await waitNavIdle(page, { settleMs: 150 });
  await seed(page, yearSeed(chars.slice(0, 20), { custom: false }).state);
  await openAll(page);
  v = await view(page);
  assert.equal(v.cols, 8, '< 60 members → still 8 columns (P1-E1b: independent of the member count)');
  const zero = v.chips.filter(c => c.n === 0);
  assert.ok(zero.length >= 2 && zero.every(c => c.disabled && c.ariaDisabled === 'true'), 'zero chips disabled + aria-disabled (R-A04)');
  await menuClick(page, '[data-testid="all-chip"][data-key="unw"]', { stay: true, force: true });
  await closeMenu(page);
  v = await view(page);
  assert.equal(v.filter, '', 'tapping a zero chip does nothing');
  await backToAllRoot();
  await seed(page, null);
  await openAll(page);
  const empty = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
  }, `${TOP} [data-testid="all-empty"]`);
  assert.ok(empty && empty.startsWith(COPY.emptyTitle), '0 records → empty state');
  await backToAllRoot();
}
