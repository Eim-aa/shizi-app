// 场景：缺墨矩阵（02 M4-5 完成定义 scenario-ink-states；§8.1「场景 7、10；反例 7；I03 缺墨矩阵」；01 §9「被淘汰墨迹的记录显示
// 没有笔迹（10.12），不借别次墨迹（I03）」；03 P02 / P19 / P31 / P50）。
//
// 注入：page.route 把 src/config/policy.js 的 features.perRecordInk 改成 true（P31 过渡关闭；源码不动，只在本 spec 的页面里）。
// 造数（真实 mutator judgeInDraft，按时间先后逐条判断，id 顺序 = 时间顺序；时钟 2026-09-24 20:00）：
//   306 个字：i = 0..299 每字一条「最近」记录（9-23 起每 3 个字往前一天，i%10==3 写错），i = 0..9 另有 5 天前、i = 10..29 另有
//   40 天前的一条更早的写对；T0..T5 = 今天一组 daily（结束后在 lastEnded.A）。然后删掉部分墨迹：
//     A 最近一次缺墨、更早一次有墨：i ∈ {0, 1, 3(写错), 4, 6}      → 各处必须「没有笔迹」，不能借更早那次
//     C 最近一次有墨、更早一次缺墨：i ∈ {2, 5}                    → 最近一次的笔迹；月字帖按 D42（解 P122）本月内从早到晚找留有墨迹的那次 → 取最近一次，画进图
//     B 只有一条且缺墨：i ∈ {40, 41, 43, 45}
//     今天一组缺墨：T1、T4
// 七处（逐格断言「这一格用的是哪条记录、有没有笔迹」与口径一致）：
//   1 墙（字库首页）                最近一次 judged；写错 = 标准字 + 红点，不画笔迹
//   2 查字卡片「你的书写」           最近一次 judged（P19）；缺墨「没有笔迹」
//   3 清单小图（写错过）             该行记录 = 最近一次（写错）；缺墨「没有笔迹」
//   4 单字详情                       历次格子各用各的；做图片行按最近一次置灰（R-D04）
//   5 字帖（我的 / 练习记录，M4-1）  本月第一次起从早到晚找留有墨迹的那次（P02 + D42）；落款天数与图片一致
//   6 这次的图片（结果页）           本组每字从晚到早找留有墨迹的那次（D11 + D42）；缺墨不画、落款字数跟着减（P50 / R-I04）
//   7 单字图片（详情）               最近一次；缺墨不生成
// 阶段 1 P1-E7 改口径（交接 §4.2 / §7）：6 这次的图片 = 作品成员（有墨的字；无墨落在作品下的行里，不再有「不在图里」说明句，落款只数画进去的字）；
//   5月字帖：没墨的字不再被去掉，而是画 under 衬底仍占一格、仍计字数（plan.cells 全部成员，plan.drawn 只有有墨的）；字帖页是 month.js 的 MonthBody。
// 其余页面由并行卡实现：未注册的屏（getScreen 为空）记 NOT-RUN 并跳过该项，不算通过。

import { bootTestHost, tid, topSel, waitNavIdle, PRESS_SETTLE_MS } from './helpers.mjs';

const A = [0, 1, 3, 4, 6];
const C = [2, 5];
const B = [40, 41, 43, 45];
const T_MISS = [1, 4];
const NO_INK = '没有笔迹';

async function injectPerRecordInk(page) {
  let hits = 0;
  await page.route(/\/src\/config\/policy\.js(\?.*)?$/, async route => {
    const res = await route.fetch();
    const body = await res.text();
    // D27 起源码默认已是 true；仍按值改写，保证这个 spec 不随默认值漂移
    const next = body.replace(/perRecordInk: (true|false),/, 'perRecordInk: true,');
    if (/perRecordInk: (true|false),/.test(body)) hits += 1;
    await route.fulfill({ response: res, body: next, headers: { ...res.headers(), 'content-type': 'text/javascript; charset=utf-8' } });
  });
  return () => hits;
}

async function seed(page, plan) {
  const res = await page.evaluate(async p => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession, endSlot } = await import('/src/core/sessions.js');
    const { allCards, isPracticable } = await import('/src/data/deck.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock('2026-09-24T20:00:00');
    const now = window.__shiziTest.now();
    const pool = [];
    for (const card of allCards()) {
      const c = card.target || card.char;
      if (c && isPracticable('base:' + c) && !pool.includes(c)) pool.push(c);
      if (pool.length >= 306) break;
    }
    const chars = pool.slice(0, 300);
    const today = pool.slice(300, 306);
    const dayMs = d => new Date(`${d}T09:00:00`).getTime();
    const addDays = (d, n) => {
      const x = new Date(`${d}T12:00:00`);
      x.setDate(x.getDate() + n);
      const z = v => String(v).padStart(2, '0');
      return `${x.getFullYear()}-${z(x.getMonth() + 1)}-${z(x.getDate())}`;
    };
    const events = [];
    chars.forEach((c, i) => {
      const day = addDays('2026-09-23', -Math.floor(i / 3));
      events.push({ i, c, at: dayMs(day) + (300 - i) * 1000, judgment: i % 10 === 3 ? 'wrong' : 'correct', role: 'latest' });
      if (i < 30) events.push({ i, c, at: dayMs(addDays(day, i < 10 ? -5 : -40)) + (300 - i) * 1000, judgment: 'correct', role: 'older' });
    });
    events.sort((a, b) => a.at - b.at);
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = x => x + (n += 1);
    const stroke = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ];
    const ids = {};
    for (const e of events) {
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + e.c], at: e.at });
      const out = judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + e.c, judgment: e.judgment, strokes: stroke, at: e.at, nextId, perRecordInk: true });
      draft.sessions.A = null;
      (ids[e.c] || (ids[e.c] = {}))[e.role] = { id: out.record.id, month: out.record.localDay.slice(0, 7), day: out.record.localDay };
    }
    const t0 = now - 3600000;
    draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: today.map(c => 'base:' + c), at: t0 });
    const sessionId = draft.sessions.A.id;
    today.forEach((c, k) => {
      const out = judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + c, judgment: 'correct', strokes: stroke, at: t0 + (k + 1) * 1000, nextId, perRecordInk: true });
      ids[c] = { latest: { id: out.record.id, month: out.record.localDay.slice(0, 7), day: out.record.localDay } };
    });
    draft.sessions = endSlot(draft.sessions, 'A', { at: t0 + 9000 });
    const drop = x => { delete draft.ink[x.month][x.id]; };
    for (const i of p.A) drop(ids[chars[i]].latest);
    for (const i of p.C) drop(ids[chars[i]].older);
    for (const i of p.B) drop(ids[chars[i]].latest);
    for (const k of p.T) drop(ids[today[k]].latest);
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r, chars, today, ids, sessionId };
  }, plan);
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  return res;
}

/** 某条记录有没有存下的墨迹（从 store 读，作为各处断言的真值）。 */
async function inkTruth(page) {
  return page.evaluate(() => {
    const st = window.__shiziTest.getState();
    const has = {};
    for (const table of Object.values(st.ink || {})) for (const id of Object.keys(table || {})) has[id] = true;
    return has;
  });
}

/** nav.<method>(...args)（CSP 不许 eval，只传方法名与参数）。 */
async function nav(page, method, ...args) {
  await page.evaluate(async ({ m, a }) => {
    const { nav: n } = await import('/src/ui/router.js');
    n[m](...a);
  }, { m: method, a: args });
  await waitNavIdle(page);
}

async function screenRegistered(page, name) {
  return page.evaluate(async s => !!(await import('/src/ui/router.js')).getScreen(s), name);
}

export default async function run(page, ctx) {
  const { assert } = ctx;
  const hits = await injectPerRecordInk(page);
  await bootTestHost(page, ctx.baseURL);
  assert.ok(hits() >= 1, 'policy.js served with perRecordInk injected');
  assert.equal(await page.evaluate(async () => (await import('/src/config/policy.js')).features.perRecordInk), true, 'features.perRecordInk === true in this page');
  const seeded = await seed(page, { A, C, B, T: T_MISS });
  const { chars, today, ids, sessionId } = seeded;
  const has = await inkTruth(page);
  const latestId = c => ids[c].latest.id;
  const latestHas = c => !!has[latestId(c)];
  assert.equal(chars.length, 300, '300 chars seeded (+ 6 today)');
  assert.ok(A.every(i => !latestHas(chars[i]) && has[ids[chars[i]].older.id]), 'A: latest missing, older has ink');
  assert.ok(C.every(i => latestHas(chars[i]) && !has[ids[chars[i]].older.id]), 'C: latest has ink, older missing');
  const notRun = [];

  // ------------------------------------------------------------------ 1 墙
  ctx.step('1 wall (r7-L1 D60: the wall lives on 「全部」 = library-all now): each cell = latest judged; missing ink → standard glyph; wrong → glyph + dot (never ink)');
  await nav(page, 'switchTab', 'library');
  await page.waitForSelector(topSel('library-zone'));
  await nav(page, 'push', 'library-all', { sort: 'age' });
  await page.waitForFunction(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="all-body"]');
    return !!b && Number(b.dataset.rendered) === Number(b.dataset.total) && Number(b.dataset.total) > 0;
  }, null, { timeout: 30000 });
  const wall = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="all-cell"]')].map(el => {
    const g = el.querySelector('[data-ink]');
    return { char: el.dataset.char, kind: el.dataset.kind, ink: g ? g.dataset.ink : null, mini: !!el.querySelector('[data-testid="library-cell-ink"]') };
  }));
  const recorded = await page.evaluate(() => Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="all-body"]').dataset.recorded));
  assert.ok(wall.length >= recorded && recorded >= 100, 'the all page draws every recorded char (' + wall.length + ' / ' + recorded + ')');
  let wallBad = wall.filter(cell => {
    const want = cell.kind === 'ink' && latestHas(cell.char) ? 'ink' : 'none';
    return cell.ink !== want || cell.mini !== (want === 'ink');
  });
  assert.deepEqual(wallBad, [], 'every cell draws ink iff it is a correct-latest cell whose latest record has ink');
  const wallChars = wall.map(c => c.char);
  for (const i of [...A, ...C]) {
    const c = chars[i];
    const cell = wall.find(x => x.char === c);
    assert.ok(!!cell, `wall contains ${c} (i=${i})`);
  }
  assert.ok(A.filter(i => chars[i] !== chars[3]).every(i => wall.find(x => x.char === chars[i]).ink === 'none'), 'A: no ink borrowed from the older record');
  assert.ok(C.every(i => wall.find(x => x.char === chars[i]).ink === 'ink'), 'C: latest ink drawn');
  assert.equal(wall.find(x => x.char === chars[3]).kind, 'wrong', 'i=3 is a wrong cell (standard glyph + dot)');
  assert.ok(today.every(c => wallChars.includes(c)), 'today\'s chars on the wall');
  assert.ok(T_MISS.every(k => wall.find(x => x.char === today[k]).ink === 'none'), 'today\'s missing-ink chars show the standard glyph');

  await nav(page, 'back');

  // ------------------------------------------------------------------ 2 查字卡片
  ctx.step('2 query card 「你的书写」: latest judged ink (P19); missing → 没有笔迹');
  await page.click(topSel('library-query-open'));
  await page.waitForSelector('[data-testid="query-input"]');
  const probe = [chars[0], chars[2], chars[40], chars[7]];
  await page.locator('[data-testid="query-sheet"] [data-testid="query-input"]').fill(probe.join(''));
  await page.waitForSelector('[data-testid="query-sheet"] [data-testid="query-rows"]');
  const cardOf = async c => {
    await page.waitForTimeout(PRESS_SETTLE_MS);
    await page.locator(`[data-testid="query-sheet"] [data-testid="query-row"][data-char="${c}"] [data-testid="query-row-open"]`).click();
    await page.waitForSelector(`[data-testid="query-sheet"] [data-testid="query-card"][data-char="${c}"]`);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="query-sheet"]');
      const mine = s.querySelector('[data-testid="query-card-mine"]');
      const empty = s.querySelector('[data-testid="query-card-mine-empty"]');
      return { ink: !!mine, empty: empty ? empty.textContent.trim() : null };
    });
    await page.waitForTimeout(PRESS_SETTLE_MS);
    await page.click('[data-testid="query-sheet"] [data-testid="query-back"]');
    await page.waitForSelector('[data-testid="query-sheet"] [data-testid="query-rows"]');
    await page.waitForTimeout(PRESS_SETTLE_MS);
    return r;
  };
  for (const c of probe) {
    const r = await cardOf(c);
    assert.deepEqual(r, latestHas(c) ? { ink: true, empty: null } : { ink: false, empty: NO_INK }, `query card ${c}: ${latestHas(c) ? 'latest ink' : '没有笔迹'}`);
  }
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('[data-testid="query-sheet"]'));
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 3 清单小图
  ctx.step('3 wrong list thumbnails: row record = latest (wrong); missing → 没有笔迹');
  await nav(page, 'push', 'library-list', { kind: 'wrong' });
  await page.waitForSelector(topSel('list-rows'));
  await page.click(topSel('list-rest-toggle')); // B4：默认只露最该练的 5 行，其余折叠；展开后核对全部行
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="list-row"]')].map(el => ({
    char: el.dataset.char, record: el.dataset.record,
    ink: !!el.querySelector('[data-testid="list-row-thumb-ink"]'),
    noink: el.querySelector('[data-testid="list-row-thumb-noink"]') ? el.querySelector('[data-testid="list-row-thumb-noink"]').textContent.trim() : null,
  })));
  const wrongChars = chars.filter((c, i) => i % 10 === 3);
  assert.equal(rows.length, wrongChars.length, 'wrong list = every char whose latest judgment is wrong');
  const rowBad = rows.filter(r => r.record !== latestId(r.char) || r.ink !== latestHas(r.char) || (r.ink ? r.noink !== null : r.noink !== NO_INK));
  assert.deepEqual(rowBad, [], 'each row uses the latest record; thumbnail ink iff that record has ink, else 没有笔迹');
  assert.deepEqual(rows.find(r => r.char === chars[3]), { char: chars[3], record: latestId(chars[3]), ink: false, noink: NO_INK }, 'A∩wrong (i=3): 没有笔迹, older ink not borrowed');

  // ------------------------------------------------------------------ 4 详情 + 7 单字图片
  ctx.step('4 detail cells (each record its own ink) + image row; 7 glyph image = latest, missing → not generated');
  const detail = async c => {
    await page.evaluate(async ch => (await import('/src/ui/screens/detail/index.js')).openDetail(ch), c);
    await page.waitForSelector(topSel('detail-screen'));
    await waitNavIdle(page);
    return page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const img = top.querySelector('[data-testid="detail-image"]');
      return {
        cells: [...top.querySelectorAll('[data-testid="detail-hero-cell"], [data-testid="detail-cell"]')].map(el => ({ record: el.dataset.record, ink: el.dataset.ink === 'true',
          noink: el.querySelector('[data-testid="detail-cell-noink"]') ? el.querySelector('[data-testid="detail-cell-noink"]').textContent.trim() : (el.dataset.ink === 'true' ? null : (el.getAttribute('aria-label').includes('没有笔迹') && el.querySelector('[data-testid="detail-cell-glyph"], [data-testid="detail-hero-glyph"]') ? '没有笔迹' : 'missing')) })),
        image: img ? img.dataset.state : null,
      };
    });
  };
  for (const i of [0, 2, 3, 40, 7]) {
    const c = chars[i];
    const d = await detail(c);
    const expectCells = [ids[c].older, ids[c].latest].filter(Boolean).map(x => ({ record: x.id, ink: !!has[x.id], noink: has[x.id] ? null : NO_INK }));
    assert.deepEqual(d.cells, expectCells, `detail ${c} (i=${i}): every cell uses its own record's ink`);
    assert.equal(d.image, latestHas(c) ? 'ok' : 'noInk', `detail ${c}: image row ${latestHas(c) ? 'active' : 'greyed (R-D04)'}`);
    if (latestHas(c)) {
      await page.click(topSel('detail-image'));
      await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
      const g = await page.evaluate(() => ({ ...document.querySelector('[data-testid="image-canvas"]').dataset }));
      assert.deepEqual([g.kind, g.recordIds, g.width, g.height], ['glyph', latestId(c), '1080', '1440'], `glyph image ${c}: latest record ${latestId(c)}`);
      await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
      await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
      await waitNavIdle(page);
    } else {
      const job = await page.evaluate(async ch => {
        const { buildImageJob } = await import('/src/ui/images-entry.js');
        const j = buildImageJob({ kind: 'glyph', char: ch });
        return { status: j.plan.status, missing: j.plan.missing };
      }, c);
      assert.deepEqual(job, { status: 'noInk', missing: [c] }, `glyph image ${c}: not generated (no fallback to the older ink, I03)`);
    }
  }

  // ------------------------------------------------------------------ 6 这次的图片
  ctx.step('6 session image (the work): members = this session\'s chars with ink; the no-ink ones are rows below, not in the image; 落款 count follows the drawn chars');
  await nav(page, 'push', 'result', { slot: 'A', sessionId });
  await page.waitForSelector(topSel('result-screen'));
  await page.waitForFunction(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-canvas"]')].every(c => c.dataset.painted === 'true'));
  const resultItems = await page.evaluate(() => ({
    work: [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-cell"]')].map(el => el.dataset.char),
    rows: [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="result-exrow"]')].map(el => [el.dataset.char, el.dataset.state]),
  }));
  const drawnToday = today.filter(c => latestHas(c));
  assert.deepEqual(resultItems.work, drawnToday, 'result work: the chars whose record has ink');
  assert.deepEqual(resultItems.rows, T_MISS.map(k => [today[k], 'noInk']), 'result rows: the no-ink chars, state noInk');
  await waitNavIdle(page);
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  const sess = await page.evaluate(() => ({ ...document.querySelector('[data-testid="image-canvas"]').dataset,
    note: document.querySelector('[data-testid="image-note"]').textContent.trim() }));
  assert.equal(sess.members, drawnToday.join(''), 'members = today chars with ink, session order');
  assert.equal(sess.recordIds, drawnToday.map(latestId).join(','), 'record ids = this session\'s judgments');
  assert.equal(sess.signature, '二〇二六年九月二十四日　四字', '落款: date + drawn count (R-I04)');
  assert.equal(sess.note, '', 'no 「不在图里」 sentence and no 「存下来的是图片…」 any more');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 5 字帖（M4-1）+ 月字帖图片
  ctx.step('5 month sheet (练习记录, M4-1) vs {月}字帖 image: first of month (P02), same records, same day count');
  const job = await page.evaluate(async () => {
    const { buildImageJob } = await import('/src/ui/images-entry.js');
    const j = buildImageJob({ kind: 'month', month: '2026-09' });
    return { status: j.plan.status, members: j.plan.members.map(m => ({ char: m.char, record: m.record ? m.record.id : null })),
      drawn: j.plan.drawn.map(m => m.char), recordIds: j.plan.drawn.map(m => m.record.id), allRecordIds: j.plan.recordIds,
      missing: j.plan.cells.filter(c => c.mode === 'under').map(c => c.ch), cells: j.plan.cells.map(c => c.ch).join(''), pages: j.plan.pages.length,
      days: j.plan.days, signature: j.signature };
  });
  // D51 ⑤：写错的不是作品成员。i % 10 === 3 的字最近一次写错；其中 i < 10 的另有一次写对（9月内），i ≥ 10 的在 9月里只有那一次写错 → 不在月字帖里
  const septChars = chars.filter((c, i) => i <= 68);
  const wrongOnly = septChars.filter((c, i) => i % 10 === 3 && i >= 10);
  assert.equal(wrongOnly.length, 6, 'six September chars were only written wrong this month');
  const nMembers = septChars.length - wrongOnly.length + today.length;
  assert.equal(job.members.length, nMembers, 'month members = September work chars (69 − 6 wrong-only + 6 today = 69)');
  assert.ok(wrongOnly.every(c => !job.members.some(m => m.char === c)), 'the wrong-only chars are not on the sheet');
  assert.deepEqual([job.status, job.pages], ['ready', 1], '69 chars → ready, one page (D39: no pending any more)');
  for (const i of [0, 1, 4, 6]) {
    const m = job.members.find(x => x.char === chars[i]);
    assert.equal(m.record, ids[chars[i]].older.id, `P02 first: ${chars[i]} (i=${i}) uses its first September record (the older one, which has ink)`);
  }
  assert.ok(job.drawn.includes(chars[0]) && job.recordIds.includes(ids[chars[0]].older.id), 'A i=0 drawn from its first-of-month record, not the missing latest');
  // D42（解 P122）：C 的本月第一次（缺墨）不再让这个字缺墨——本月内往后找到的最近一次有墨，画进图，角标跟着换成那次的日子
  for (const i of C) {
    const m = job.members.find(x => x.char === chars[i]);
    assert.equal(m.record, ids[chars[i]].latest.id, `D42: ${chars[i]} (i=${i}) first-of-month has no ink → the month's latest (has ink)`);
    assert.ok(job.drawn.includes(chars[i]) && job.recordIds.includes(ids[chars[i]].latest.id), `C ${chars[i]} drawn from its later record`);
    assert.ok(!job.missing.includes(chars[i]), `C ${chars[i]} no longer missing`);
  }
  assert.ok(job.drawn.includes(chars[0]) && job.recordIds.includes(ids[chars[0]].older.id), 'A i=0 drawn from its first-of-month record, not the missing latest');
  const bMembers = B.filter(i => i <= 68 && !wrongOnly.includes(chars[i]));
  assert.ok(bMembers.every(i => job.missing.includes(chars[i])), 'B: no ink anywhere in the month → an under cell (still on the page, nothing borrowed)');
  assert.equal(job.days, 24, 'judged days in September (9-01 … 9-24)');
  assert.equal(job.drawn.length, nMembers - bMembers.length - 2, 'drawn (with ink) = members − B members − today missing(2)');
  assert.equal(job.cells.length, nMembers, 'every member is a cell (the no-ink ones are under cells, §7)');
  assert.equal(nMembers, 69, 'the arithmetic above is 69');
  assert.equal(job.signature, '二〇二六年九月　六十九字', '落款: month + all 69 chars (under cells count too)');
  if (await screenRegistered(page, 'records')) {
    await nav(page, 'push', 'records', { month: '2026-09' });
    await page.waitForSelector(topSel('records-sheet'));
    await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="records-sheet-cell"]').length > 0);
    await page.waitForTimeout(200);
    const sheet = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const el = top.querySelector('[data-testid="records-sheet"]');
      return { days: el.dataset.days, cells: [...top.querySelectorAll('[data-testid="records-sheet-cell"]')].map(c => ({ char: c.dataset.char, record: c.dataset.record || null, ink: c.dataset.ink === 'true' })) };
    });
    assert.deepEqual(sheet.cells.map(c => ({ char: c.char, record: c.record })), job.members, '字帖 cells = image members, same record per char (P02 first + D42)');
    assert.deepEqual(sheet.cells.filter(c => !c.ink).map(c => c.char), job.missing, '字帖 没有笔迹 cells = chars left out of the image');
    assert.equal(Number(sheet.days), job.days, '字帖 day count = image day count');
  } else {
    notRun.push('5 字帖 display (records screen not registered — M4-1)');
    ctx.step('NOT-RUN: 5 字帖 display — records screen not registered (M4-1)');
  }
  await page.evaluate(async () => (await import('/src/ui/images-entry.js')).openMonthImage({ month: '2026-09' }));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  const month = await page.evaluate(() => ({ ...document.querySelector('[data-testid="image-canvas"]').dataset }));
  assert.equal(month.members, job.cells, 'month image members = plan cells (with-ink and under)');
  assert.equal(month.recordIds, job.allRecordIds.join(','), 'month image record ids = first-of-month records');
  assert.equal(month.signature, job.signature, 'month image signature');
  assert.equal([month.width, month.height].join('×'), '1440×1920', 'month image 1440×1920 (69 chars → 3:4)');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));

  assert.deepEqual(notRun, [], `all seven places covered${notRun.length ? ' (NOT-RUN: ' + notRun.join('; ') + ')' : ''}`);
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct').length);
  assert.equal(direct, 0, 'no write bypasses storage.js');
}
