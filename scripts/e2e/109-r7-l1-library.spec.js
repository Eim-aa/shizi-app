// r7-L1（D60）：字库 tab 根页按「字库方向四」重做。
//   自上而下：大标题「字库」→ 搜索框（library-search）→「练习范围 …… 库名 ›」（library-range）→「今日练习 …… 值 ›」+ 第二行小字（library-today）
//   → 小标题「已练汉字 N」+「全部 ›」（library-written）→ 三行记忆状态（library-zone，data-kind = due | shaky | known，data-n）。
//   墨墙、图例、「还有 N 个字」、写错过 / 快忘了两块、页内「练这些字」都不在字库首页。
// 断言：顺序；今日练习与首页主按钮同一组字同一状态；三档互斥、合计 = N；0 档不可点；练习范围与设置同值；点进区详情页有「练这些字」；
//   没有记录时仍有 1–4、三档都是 0；AX5 不滚不叠。
// D62：小标题与各行名称同一级（17 / 500）、数 / 值 / 小字各自同级（含 AX5）；第四行「已跳过」（library-skipped：点过「跳过」、至今没有判断记录的字，
//   不计入已练汉字数；点进区详情页 library-list {kind:'skipped'}，底部「练这些字」开组，来源 skippedList）。

import { bootTestHost, tid, topSel, waitNavIdle, setTextSize, seedSession, tokenRgb } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const pad2 = n => (n < 10 ? `0${n}` : String(n));

function dayAgo(n) {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 字 → [最近一次判断, 几天前写的, sched {due 距今天数（负 = 已到期）, 稳定度} | null]
const ROWS = {
  永: ['wrong', 1, { due: 5, s: 30 }], // 最近写错 → 待复习（即使没到期）
  和: ['correct', 20, { due: -1, s: 3 }], // 到期 → 待复习
  春: ['correct', 6, { due: 10, s: 8 }], // 未到期、稳定度 < 21 → 未熟悉
  大: ['correct', 3, { due: 3, s: 2.5 }], // 未熟悉
  人: ['correct', 4, { due: 30, s: 20.9 }], // 20.9 < 21 → 未熟悉
  天: ['correct', 5, null], // 没有 sched → 未熟悉
  中: ['correct', 40, { due: 60, s: 50 }], // 已熟悉
  国: ['correct', 30, { due: 30, s: 21 }], // 恰好 21 → 已熟悉
};
const EXPECT = { due: 2, shaky: 4, known: 2, n: 8 };

function seedOf({ todayWritten = false } = {}) {
  const records = {};
  const sched = {};
  let k = 0;
  for (const [c, [judgment, ago, s]] of Object.entries(ROWS)) {
    k += 1;
    const day = dayAgo(ago);
    const at = new Date(`${day}T08:${pad2(k)}:00`).getTime();
    (records[day.slice(0, 7)] || (records[day.slice(0, 7)] = [])).push({
      id: `r${k}`, cardKey: `base:${c}`, char: c, sessionId: 's900', kind: 'judged', judgment, at, localDay: day, help: { hints: 0, answerSeen: false, traced: false },
    });
    if (s) sched[`base:${c}`] = { fsrs: { stability: s.s, reps: 3, lapses: 0 }, due: dayAgo(-s.due), lastJudgedAt: at };
  }
  // 已跳过（D62）：点过「跳过」、至今没有判断记录的字（水、火），不算已练汉字；山今天写了 = 不会出现在这里
  for (const [c, ago] of [['水', 3], ['火', 2]]) {
    k += 1;
    const day = dayAgo(ago);
    (records[day.slice(0, 7)] || (records[day.slice(0, 7)] = [])).push({
      id: `r${k}`, cardKey: `base:${c}`, char: c, sessionId: 's902', kind: 'skipped', at: new Date(`${day}T09:${pad2(k)}:00`).getTime(), localDay: day, help: { hints: 0, answerSeen: false, traced: false },
    });
  }
  if (todayWritten) {
    const at = new Date(`${TODAY}T08:30:00`).getTime();
    (records[TODAY.slice(0, 7)] || (records[TODAY.slice(0, 7)] = [])).push({
      id: 'r90', cardKey: 'base:山', char: '山', sessionId: 's901', kind: 'judged', judgment: 'correct', at, localDay: TODAY, help: { hints: 0, answerSeen: false, traced: false },
    });
    sched['base:山'] = { fsrs: { stability: 3 }, due: dayAgo(-3), lastJudgedAt: at };
  }
  return { records, sched };
}

async function seed(page, state) {
  const r = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    return window.__shiziTest.seed(s);
  }, { iso: CLOCK, s: state });
  if (!r || !r.ok) throw new Error('seed failed ' + JSON.stringify(r));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function toTab(page, name) {
  await page.evaluate(async n => (await import('/src/ui/router.js')).nav.switchTab(n), name);
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function routerTop(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { name: s.top && s.top.n, params: (s.top && s.top.p) || {}, depth: s.depth };
  });
}

/** 字库页现状：每块的文字、位置、可点性。 */
async function readLib(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-library"]');
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const top = el => (el ? Math.round(el.getBoundingClientRect().top) : null);
    const zones = [...root.querySelectorAll('[data-testid="library-zone"]')].map(z => ({
      kind: z.dataset.kind, n: Number(z.dataset.n), tag: z.tagName, clickable: z.tagName === 'BUTTON', chev: !!z.querySelector('[data-testid="chevron"]'),
      samples: z.querySelectorAll('[data-testid="library-zone-sample"]').length, text: txt(z), top: top(z),
    }));
    const sk = q('library-skipped');
    const skipped = sk ? {
      n: Number(sk.dataset.n), tag: sk.tagName, clickable: sk.tagName === 'BUTTON', chev: !!sk.querySelector('[data-testid="chevron"]'),
      samples: sk.querySelectorAll('[data-testid="library-skipped-sample"]').length, text: txt(sk), top: top(sk), name: txt(q('library-skipped-name')),
    } : null;
    const today = q('library-today');
    const written = q('library-written');
    return {
      title: txt(root.querySelector('[data-testid="screen-library"] > h1, h1')),
      titleTop: top(root.querySelector('h1')),
      searchTop: top(q('library-search')), searchText: txt(q('library-search')),
      range: q('library-range') ? { text: txt(q('library-range')), top: top(q('library-range')), value: txt(q('library-range-value')), tag: q('library-range').tagName } : null,
      today: today ? { text: txt(today), top: top(today), phase: today.dataset.phase, value: txt(q('library-today-value')), sub: txt(q('library-today-sub')), tag: today.tagName } : null,
      written: written ? { text: txt(written), top: top(written), n: Number(written.dataset.n) } : null,
      allBtn: q('library-all-open') ? txt(q('library-all-open')) : null,
      zones,
      skipped,
      gone: ['library-wall', 'library-wall-cell', 'library-legend-note', 'library-more', 'library-card-wrong', 'library-card-forget', 'library-card-practice', 'library-caption']
        .filter(id => q(id)),
    };
  });
}

/** 字库首页同一角色的字号 / 字重必须一致（D62）：行名称含小标题、数、右侧值、第二行小字。 */
async function typeRoles(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-library"]');
    const spec = el => { const c = getComputedStyle(el); return `${c.fontSize}/${c.fontWeight}`; };
    const roles = {
      name: [...root.querySelectorAll('.sz-libr__nm, .sz-libr__ht')],
      count: [...root.querySelectorAll('.sz-libr__cnt, .sz-libr__hn')],
      value: [...root.querySelectorAll('.sz-libr__val')],
      caption: [...root.querySelectorAll('.sz-libr__cap')],
    };
    return Object.fromEntries(Object.entries(roles).map(([k, els]) => [k, { n: els.length, specs: [...new Set(els.map(spec))], heading: k === 'name' ? spec(root.querySelector('.sz-libr__ht')) : null }]));
  });
}

export default async function (page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 1. 顺序与结构（一个月后）
  step('order: title → search → range → today → written → three zones; gone: wall / legend / more / 写错过 / 快忘了 / 练这些字');
  await seed(page, seedOf());
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-zone'));
  let lib = await readLib(page);
  assert.equal(lib.title, '字库', 'big title');
  assert.ok(lib.searchTop > lib.titleTop && lib.range.top > lib.searchTop && lib.today.top > lib.range.top && lib.written.top > lib.today.top, 'vertical order');
  assert.deepEqual(lib.zones.map(z => z.kind), ['due', 'shaky', 'known'], 'three zones in order');
  assert.ok(lib.zones[0].top > lib.written.top, 'zones below the written heading');
  assert.ok(lib.skipped && lib.skipped.top > lib.zones[2].top, '已跳过 is the 4th row, under the three zones');
  assert.equal(lib.skipped.name, '已跳过', 'skipped row name');
  assert.ok(/搜索汉字或拼音/.test(lib.searchText), 'search placeholder: ' + lib.searchText);
  assert.deepEqual(lib.gone, [], 'old blocks are gone: ' + lib.gone.join(','));
  assert.equal(await page.locator(topSel('library-query-open')).count(), 1, 'search box still opens the lookup sheet');

  step('type roles (D62): the sub-heading 已练汉字 and every row name share one size / weight; counts, values, captions each one size');
  const roles = await typeRoles(page);
  assert.equal(roles.name.n, 7, 'names: range, today, heading, 3 zones, skipped');
  assert.deepEqual(roles.name.specs, ['17px/500'], 'all row names (heading included) are 17 / 500: ' + JSON.stringify(roles.name));
  assert.deepEqual(roles.count.specs.length, 1, 'counts one size: ' + JSON.stringify(roles.count));
  assert.deepEqual(roles.value.specs.length, 1, 'values one size: ' + JSON.stringify(roles.value));
  assert.deepEqual(roles.caption.specs.length, 1, 'captions one size: ' + JSON.stringify(roles.caption));

  step('zones are exclusive and add up to N; counts follow the FSRS rule');
  assert.equal(lib.written.n, EXPECT.n, 'N = written chars');
  assert.deepEqual(lib.zones.map(z => z.n), [EXPECT.due, EXPECT.shaky, EXPECT.known], 'due / shaky / known counts');
  assert.equal(lib.zones.reduce((s, z) => s + z.n, 0), lib.written.n, 'zones sum to N');
  assert.ok(lib.zones.every(z => z.clickable && z.chev && z.samples >= 1 && z.samples <= 3), 'non-empty zones: button, chevron, 1–3 samples');
  assert.ok(/已练汉字\s*8/.test(lib.written.text) && /全部/.test(lib.written.text), 'written heading text: ' + lib.written.text);

  step('已跳过 (D62): same row template; counts only skipped-and-never-judged chars; not part of 已练汉字 N');
  assert.deepEqual([lib.skipped.n, lib.skipped.clickable, lib.skipped.chev, lib.skipped.samples], [2, true, true, 2], 'skipped row: 2 chars, button, chevron, 2 samples');
  assert.ok(/^已跳过\s*2/.test(lib.skipped.text), 'skipped text: ' + lib.skipped.text);

  // ------------------------------------------------------------------ 2. 今日练习 = 首页主按钮同一组
  step('today row: value / sub come from the same plan the home button starts');
  assert.equal(lib.today.phase, 'fresh', 'phase fresh');
  assert.ok(/^\d+ 个字$/.test(lib.today.value), 'value: ' + lib.today.value);
  assert.ok(/复习|新字/.test(lib.today.sub), 'sub: ' + lib.today.sub);
  const shown = { n: Number(/^(\d+)/.exec(lib.today.value)[1]), sub: lib.today.sub };
  const state0 = await page.evaluate(() => window.__shiziTest.getState());
  await page.click(topSel('library-today'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const viaLib = await page.evaluate(() => window.__shiziTest.getState().sessions.A);
  assert.equal(viaLib.queue.length, shown.n, 'count shown = queue length');
  const reviews = viaLib.queue.filter(k => state0.sched && state0.sched[k]).length;
  const expectSub = [reviews ? `${reviews} 个复习` : null, viaLib.queue.length - reviews ? `${viaLib.queue.length - reviews} 个新字` : null].filter(Boolean).join('，');
  assert.equal(shown.sub, expectSub, 'sub = review / new split of that queue');
  // 首页主按钮开出来的是同一组
  await seed(page, seedOf());
  await toTab(page, 'home');
  await page.click(tid('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const viaHome = await page.evaluate(() => window.__shiziTest.getState().sessions.A);
  assert.deepEqual(viaLib.queue, viaHome.queue, 'library today row and home main button start the same queue');

  // ------------------------------------------------------------------ 3. 写了一半 / 写完
  step('today row, half written: 还剩 N 个 / 接着写; one tap resumes the same group');
  await seedSession(page, { slot: 'A', kind: 'daily', chars: [...'山水火木金'], cursor: 2, at: new Date(`${TODAY}T08:00:00`).getTime(), extraState: seedOf() });
  await page.evaluate(iso => window.__shiziTest.setClock(iso), CLOCK);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-today'));
  lib = await readLib(page);
  assert.equal(lib.today.phase, 'half', 'phase half');
  assert.equal(lib.today.value, '还剩 3 个', 'value: ' + lib.today.value);
  assert.equal(lib.today.sub, '接着写', 'sub: ' + lib.today.sub);
  await page.click(topSel('library-today'));
  await page.waitForSelector(topSel('write-screen'));
  assert.deepEqual((await page.evaluate(() => window.__shiziTest.getState().sessions.A.queue)), [...'山水火木金'].map(c => `base:${c}`), 'resumed the same session');

  step('today row, written today: 写完了 / 想多写，再写一组; one tap starts another group (same as the home button)');
  await seed(page, seedOf({ todayWritten: true }));
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-today'));
  lib = await readLib(page);
  assert.equal(lib.today.phase, 'done', 'phase done');
  assert.equal(lib.today.value, '写完了', 'value: ' + lib.today.value);
  assert.equal(lib.today.sub, '想多写，再写一组', 'sub: ' + lib.today.sub);
  await page.click(topSel('library-today'));
  await page.waitForSelector(topSel('write-screen'));
  const more = await page.evaluate(() => window.__shiziTest.getState().sessions.A);
  assert.ok(more && more.queue.length > 0 && more.cursor === 0, 'a fresh group was started');

  // ------------------------------------------------------------------ 4. 练习范围
  step('range row: shows the current library name, same value as the 我的 page row (D63), opens the switch page');
  await seed(page, { ...seedOf(), settings: { library: 'core3500' } });
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-range'));
  lib = await readLib(page);
  assert.ok(/练习范围/.test(lib.range.text) && lib.range.tag === 'BUTTON', 'range row is one button: ' + lib.range.text);
  const rangeValue = lib.range.value;
  await page.click(topSel('library-range'));
  await page.waitForFunction(async () => (await import('/src/ui/router.js')).getRouter().getState().top.n === 'library-switch');
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).name, 'library-switch', 'range row pushes library-switch');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
  await toTab(page, 'mine');
  await page.waitForSelector(topSel('mine-library-value'));
  const setValue = (await page.textContent(topSel('mine-library-value'))).trim();
  assert.equal(setValue, rangeValue, '我的 练习范围 shows the same value');
  await toTab(page, 'library');

  // ------------------------------------------------------------------ 5. 区详情页
  step('zone row pushes the zone page (library-list kind=due|shaky|known) with one primary 练这些字 that starts the group in one tap');
  for (const kind of ['due', 'shaky', 'known']) {
    await page.click(`${topSel('library-zone')}[data-kind="${kind}"]`);
    await page.waitForSelector(topSel('list-screen'));
    await waitNavIdle(page);
    const top = await routerTop(page);
    assert.deepEqual({ name: top.name, kind: top.params.kind }, { name: 'library-list', kind }, `zone ${kind} → library-list`);
    const rows = await page.locator(topSel('list-row')).count();
    assert.equal(rows, EXPECT[kind], `${kind}: the zone page lists ${EXPECT[kind]} chars`);
    assert.equal(await page.locator(topSel('list-go')).count(), 1, 'one primary button');
    assert.equal((await page.textContent(topSel('list-go'))).trim(), '练这些字', 'primary label');
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await waitNavIdle(page);
  }
  await page.click(`${topSel('library-zone')}[data-kind="shaky"]`);
  await page.waitForSelector(topSel('list-go'));
  await waitNavIdle(page);
  await page.click(topSel('list-go'));
  await page.waitForSelector(topSel('write-screen'));
  const picked = await page.evaluate(() => window.__shiziTest.getState().sessions.B);
  assert.ok(picked && picked.kind === 'picked' && picked.queue.length >= 1 && picked.queue.length <= 5, 'one tap on 练这些字 started a group of ≤ 5');
  assert.ok(picked.queue.every(k => ['春', '大', '人', '天'].includes(k.slice(5))), 'the group only has shaky chars: ' + picked.queue.join(','));

  step('已跳过 opens its zone page (library-list kind skipped): newest skip first, 练这些字 at the foot, no 没有笔迹 thumbnails; it starts a picked group');
  await seed(page, seedOf());
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-skipped'));
  await page.click(topSel('library-skipped'));
  await page.waitForSelector(topSel('list-screen'));
  await waitNavIdle(page);
  let rt = await routerTop(page);
  assert.deepEqual([rt.name, rt.params.kind], ['library-list', 'skipped'], 'pushed library-list {kind: skipped}');
  const sk = await page.evaluate(() => ({
    title: document.querySelector('.sz-layer[data-top="true"] h1, .sz-layer[data-top="true"] [data-page-title]').innerText.trim(),
    rows: [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="list-row"]')].map(r => r.dataset.char),
    meta: [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="list-row-meta"]')].map(m => m.innerText.replace(/\s+/g, '')),
    thumbs: document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="list-row-thumb"]').length,
    go: document.querySelector('.sz-layer[data-top="true"] [data-testid="list-go"]').innerText.trim(),
  }));
  assert.equal(sk.title, '已跳过', 'zone page title');
  assert.deepEqual(sk.rows, ['火', '水'], 'newest skip first');
  assert.deepEqual(sk.meta, ['9月22日跳过', '9月21日跳过'], 'meta = skip date');
  assert.equal(sk.thumbs, 0, 'no thumbnails for never-written chars');
  assert.equal(sk.go, '练这些字', 'primary button');
  await page.click(topSel('list-go'));
  await page.waitForSelector(topSel('write-screen'));
  const grp = await page.evaluate(() => window.__shiziTest.getState().sessions.B);
  assert.ok(grp && grp.kind === 'picked' && grp.queue.length === 2 && grp.source && grp.source.view === 'skippedList', 'started a picked group of the 2 skipped chars from skippedList: ' + JSON.stringify(grp && grp.source));
  assert.ok(grp.queue.every(k => ['水', '火'].includes(k.slice(5))), 'the group only has skipped chars');

  step('全部 › opens library-all');
  await seed(page, seedOf());
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-all-open'));
  await page.click(topSel('library-all-open'));
  await page.waitForFunction(async () => (await import('/src/ui/router.js')).getRouter().getState().top.n === 'library-all');
  await waitNavIdle(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 6. 没有记录
  step('no records: 1–4 are still there, written 0, three zones 0 and not clickable, no empty illustration');
  await seed(page, {});
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-written'));
  lib = await readLib(page);
  assert.ok(lib.range && lib.today && lib.searchTop != null, '1–4 present');
  assert.equal(lib.written.n, 0, 'written 0');
  assert.deepEqual(lib.zones.map(z => z.n), [0, 0, 0], 'zones all 0');
  assert.deepEqual([lib.skipped.n, lib.skipped.clickable, lib.skipped.chev, lib.skipped.samples], [0, false, false, 0], '已跳过 0: name + 0 only, not clickable');
  assert.ok(lib.zones.every(z => !z.clickable && !z.chev && z.samples === 0), 'zeros: not clickable, no chevron, no samples');
  assert.equal(await page.locator(topSel('library-empty')).count(), 0, 'no empty-state illustration');
  assert.equal(lib.today.phase, 'fresh', 'today still plans a first group');

  // ------------------------------------------------------------------ 6b. 墨色与夜间、读屏名称
  for (const scheme of ['light', 'dark']) {
    step(`${scheme}: sample ink = wall4 / wall2 / wall1 by zone; zero rows are ink3; every button has an accessible name`);
    await page.emulateMedia({ colorScheme: scheme });
    await seed(page, seedOf());
    await toTab(page, 'library');
    await page.waitForSelector(topSel('library-zone-sample'));
    const colors = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="library-zone"]')].map(z => {
      const ch = z.querySelector('.sz-lib__char');
      return [z.dataset.kind, ch ? getComputedStyle(ch).color : null];
    })));
    assert.deepEqual(colors, { due: tokenRgb(scheme, 'wall4'), shaky: tokenRgb(scheme, 'wall2'), known: tokenRgb(scheme, 'wall1') }, `${scheme}: zone ink tones`);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="screen-library"] button')]
      .filter(b => !((b.getAttribute('aria-label') || b.innerText || '').trim())).length);
    assert.equal(unnamed, 0, `${scheme}: every button has an accessible name`);
  }
  await seed(page, {});
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-zone'));
  const zeroColor = await page.evaluate(() => getComputedStyle(document.querySelector('.sz-layer[data-top="true"] [data-testid="library-zone"] [data-testid="library-zone-name"]')).color);
  assert.equal(zeroColor, tokenRgb('dark', 'ink3'), 'dark: zero zone name is ink3');
  await page.emulateMedia({ colorScheme: 'light' });

  // ------------------------------------------------------------------ 7. AX5：不滚、不叠
  step('AX5: no scroll, no overlap, nothing cut off; samples and the today sub line are not drawn');
  await seed(page, seedOf());
  await toTab(page, 'library');
  await page.waitForSelector(topSel('library-zone'));
  await setTextSize(page, 'AX5');
  await waitNavIdle(page);
  const ax = await page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-library"]');
    const panel = root.closest('.sz-tabroot__panel') || root.parentElement;
    const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const rows = ['library-search', 'library-range', 'library-today', 'library-written', 'library-skipped'].map(id => root.querySelector(`[data-testid="${id}"]`))
      .concat([...root.querySelectorAll('[data-testid="library-zone"]')]);
    const rs = rows.map(rect);
    let overlap = 0;
    for (let i = 0; i < rs.length; i += 1) for (let j = i + 1; j < rs.length; j += 1) {
      const a = rs[i]; const b = rs[j];
      if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) overlap += 1;
    }
    const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    return {
      panelScroll: panel.scrollHeight - panel.clientHeight, docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, overlap,
      lastBottom: Math.max(...rs.map(r => r.b)), panelBottom: panel.getBoundingClientRect().bottom,
      samples: [...root.querySelectorAll('[data-testid="library-zone-sample"]')].filter(visible).length,
      sub: visible(root.querySelector('[data-testid="library-today-sub"]')),
      clipped: rows.filter(el => el.scrollWidth > el.clientWidth + 1).length,
    };
  });
  assert.ok(ax.panelScroll <= 1 && ax.docScroll <= 0 && ax.hscroll <= 0, `AX5 does not scroll: ${JSON.stringify(ax)}`);
  assert.equal(ax.overlap, 0, 'AX5: no overlapping rows');
  assert.ok(ax.lastBottom <= ax.panelBottom + 1, 'AX5: last row inside the panel');
  assert.equal(ax.samples, 0, 'AX5: no samples');
  assert.equal(ax.sub, false, 'AX5: no today sub line');
  assert.equal(ax.clipped, 0, 'AX5: nothing cut off');
  const axRoles = await typeRoles(page);
  assert.equal(axRoles.name.specs.length, 1, 'AX5: row names (heading included) share one size / weight: ' + JSON.stringify(axRoles.name));
  assert.ok(axRoles.count.specs.length === 1 && axRoles.value.specs.length === 1, 'AX5: counts / values each one size: ' + JSON.stringify(axRoles));
  await setTextSize(page, 'L');
}
