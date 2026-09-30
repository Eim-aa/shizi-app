// 写错过 / 快忘了清单（02 M3-2；04 R-E01–R-E04、R-R06；决定-D19 / D23；K15 / K16；边改 S05 / S06 / Z02；02 §8.1 场景 8）。
//
//   1. 行结构与勾选：写错过两行（最近写错的在前、小字、写错那次、没有笔迹）、默认全选、点圆圈、全选 / 全不选、
//      0 个时「先选一个字」disabled + aria-disabled 且点了不开组；快忘了一行（小图下不写）；两单空态。
//   2. S06：只选一个字 → 练这个字 → 写字页（B，来源 wrongList）→ 没写完就返回 → 勾选保留；刷新后仍保留。
//   3. 场景 8a（写错后再练写对）：从写错过开 B → 写对 → 直接进结果页（来源说明「从写错过」、离开「回到写错过」）→
//      回到本页：字离开写错过、清单重算且重新全选；不进快忘了；首页「今天记录了 N 个字」与字库首页两张卡的数字按 getState 同步。
//   4. 场景 8b（写错后更正为对）：结果行更正（写字页「改为写对」）+ 结果页格子更正，两字都离开写错过、不进快忘了、
//      记录条数不增加（D19）→ 回到本页是空态；首页 / 字库数字同步。
//   5. 从快忘了开 B → 写对 → 结果页「回到快忘了」→ 回到本页（字离开快忘了）。
//   6. 「现在没有要写的字」页（字库都写过）的「看写错过的字 ›」→ 写错过清单（本卡 setNoneActions 注册）。
//   7. 开组写入失败：留在本页、勾选不变、失败说明；再点成功。

import { bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, tid, topSel, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-30';
const CLOCK = `${TODAY}T10:00:00`;

const COPY = {
  titleWrong: '写错过',
  titleForget: '快忘了',
  wrongTop: '下次写对了，就会从这里移走',
  forgetTop: '有一阵没写、可能快忘了的字。写一遍，就会从这里移走。',
  head: n => `${n} 个字`,
  wrongMeta: (m, d, n) => `${m} 月 ${d} 日写错 · 一共写错 ${n} 次`,
  forgetMeta: (m, d, n) => `最近一次 ${m} 月 ${d} 日 · 记录了 ${n} 次`,
  wrongThumb: '写错那次',
  noInk: '没有笔迹',
  wrongNote: '右边小图是你写错的那一次。点圆圈选字，点这一行看记录。',
  forgetNote: '格子里是你最近一次的笔迹。点圆圈选字，点这一行看记录。',
  selected: n => `选了 ${n} 个字 · 写完会回到这里。`,
  selectedZero: '写完会回到这里。',
  btnMany: '练这些字',
  btnOne: '练这个字',
  btnNone: '先选一个字',
  selectAll: '全选',
  selectNone: '全不选',
  wrongEmpty: '现在没有写错过的字',
  wrongEmptyBody: '你判断写错的字会放在这里。',
  forgetEmptyTitle: '现在没有快忘了的字',
  forgetEmpty: '可能快忘了的字会放在这里。',
  leaveWrong: '回到写错过',
  leaveForget: '回到快忘了',
  fromWrong: '从写错过',
  fromForget: '从快忘了',
  todayCount: n => `今天记录了 ${n} 个字`,
  startFailed: '没保存上，刚才的选择没记下。',
};

function msOf(day, hms = '08:00:00') {
  return new Date(`${day}T${hms}`).getTime();
}

function rec(serial, char, judgment, day) {
  return {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's900', kind: 'judged', judgment, at: msOf(day) + serial * 1000,
    localDay: day, help: { hints: 0, answerSeen: false, traced: false },
  };
}

/** reset + setClock + seed（sched 用真实 FSRS 卡：applyJudgment 后把到期日改成 dueDays[char]）→ 字库 tab 根。 */
async function setup(page, { records, due = {} }) {
  const res = await page.evaluate(async ({ records: rs, due: dd, clock }) => {
    const { applyJudgment } = await import('/src/core/fsrs.js');
    const { nav } = await import('/src/ui/router.js');
    await import('/src/ui/screens/library/list.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(clock);
    const byMonth = {};
    for (const r of rs) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
    const sched = {};
    for (const r of rs) {
      const prev = sched[r.cardKey];
      sched[r.cardKey] = applyJudgment(prev, r).entry;
    }
    for (const [key, day] of Object.entries(dd)) sched[key] = { ...sched[key], due: day };
    const out = window.__shiziTest.seed({ records: byMonth, sched, sessions: { A: null, B: null, lastEnded: {} } });
    nav.switchTab('library');
    return { ok: !!(out && out.ok), out };
  }, { records, due, clock: CLOCK });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.out));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
}

async function openList(page, kind) {
  await page.evaluate(async k => {
    const { openList: open } = await import('/src/ui/screens/library/list.js');
    open(k);
  }, kind);
  await page.waitForSelector(topSel('list-screen'));
  await waitNavIdle(page);
}

async function listView(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const txt = id => (q(id) ? q(id).textContent.trim() : null);
    const go = q('list-go');
    const toggle = q('list-toggle-all');
    return {
      screen: document.querySelector('.sz-app').dataset.topScreen,
      title: top && top.querySelector('[data-page-title]') ? top.querySelector('[data-page-title]').textContent.trim() : null,
      head: txt('list-head'),
      top: txt('list-top'),
      note: txt('list-note'),
      hint: txt('list-hint'),
      fail: txt('list-start-fail'),
      go: go ? { text: go.textContent.trim(), disabled: go.disabled, aria: go.getAttribute('aria-disabled') } : null,
      toggle: toggle ? toggle.textContent.trim() : null,
      empty: q('list-empty') ? { title: txt('list-empty-title'), body: txt('list-empty-body'), glyph: txt('list-empty-glyph') } : null,
      rows: top ? [...top.querySelectorAll('[data-testid="list-row"]')].map(r => {
        const sel = r.querySelector('[data-testid="list-row-select"]');
        const t = id => (r.querySelector(`[data-testid="${id}"]`) ? r.querySelector(`[data-testid="${id}"]`).textContent.trim() : null);
        return {
          char: r.dataset.char,
          selected: r.dataset.selected === 'true',
          checked: sel ? sel.getAttribute('aria-checked') : null,
          selLabel: sel ? sel.getAttribute('aria-label') : null,
          word: t('list-row-word'),
          bold: r.querySelector('[data-testid="list-row-word"] b') ? r.querySelector('[data-testid="list-row-word"] b').textContent : null,
          meta: (t('list-row-meta') || '').replace(/\s+/g, ' '),
          caption: t('list-row-thumb-caption'),
          noink: t('list-row-thumb-noink'),
          ink: !!r.querySelector('[data-testid="list-row-thumb-ink"]'),
        };
      }) : [],
    };
  });
}

/** getState 口径的数字：写错过 / 快忘了的字、今天记录了 N 个字、记录条数。 */
async function numbers(page) {
  return page.evaluate(async today => {
    const R = await import('/src/core/records.js');
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    return {
      wrong: R.wrongList(records).map(r => r.char),
      forget: R.forgetList({ records, sched: st.sched || {}, today }).items.map(i => i.record.char),
      today: R.todayCount(records, today),
      records: records.length,
      judged: records.filter(r => r.kind === 'judged').map(r => ({ id: r.id, char: r.char, judgment: r.judgment, corrections: (r.corrections || []).length })),
      B: st.sessions ? st.sessions.B : null,
      lastB: st.sessions && st.sessions.lastEnded ? st.sessions.lastEnded.B || null : null,
    };
  }, TODAY);
}

async function clickRowSelect(page, char) {
  await page.click(`${topSel('list-row')}[data-char="${char}"] [data-testid="list-row-select"]`);
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function writeAndJudge(page, judgment) {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await waitPhase(page, 'compare');
  await page.click(topSel(`write-judge-${judgment}`));
}

async function startFromList(page) {
  await page.click(topSel('list-go'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

async function resultInfo(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const txt = id => (top && top.querySelector(`[data-testid="${id}"]`) ? top.querySelector(`[data-testid="${id}"]`).textContent.trim() : null);
    return { screen: document.querySelector('.sz-app').dataset.topScreen, date: txt('result-date'), leave: txt('result-leave') };
  });
}

async function leaveResult(page) {
  await page.click(topSel('result-leave'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library-list');
  await waitNavIdle(page);
}

/** 首页「今天记录了 N 个字」与字库首页两张卡（M3-1，data-n）的数字；回到本页前先切 tab。 */
async function tabNumbers(page) {
  const read = () => page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const n = el => (el && el.dataset.n !== undefined ? Number(el.dataset.n) : null);
    return {
      screen: document.querySelector('.sz-app').dataset.topScreen,
      todayCount: q('home-today-count') ? q('home-today-count').textContent.trim() : null,
      wrongCard: n(q('library-card-wrong')),
      forgetCard: n(q('library-card-forget')),
    };
  });
  const go = async tab => {
    await page.evaluate(async name => {
      const { nav } = await import('/src/ui/router.js');
      nav.switchTab(name);
    }, tab);
    await page.waitForFunction(name => document.querySelector('.sz-app').dataset.topScreen === name, tab);
    await waitNavIdle(page);
  };
  await go('home');
  const home = await read();
  await go('library');
  const lib = await read();
  return { todayCount: home.todayCount, wrongCard: lib.wrongCard, forgetCard: lib.forgetCard };
}

export default async function listsSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // 永：9-20 写错（1 次）；和：9-18 写错、9-21 又写错（2 次）；春：9-01 写对、到期 9-25（快忘了）；山：9-02 写对、没到期
  const BASE = [
    rec(1, '春', 'correct', '2026-09-01'),
    rec(2, '山', 'correct', '2026-09-02'),
    rec(3, '和', 'wrong', '2026-09-18'),
    rec(4, '永', 'wrong', '2026-09-20'),
    rec(5, '和', 'wrong', '2026-09-21'),
  ];
  const BASE_DUE = { 'base:春': '2026-09-25', 'base:山': '2026-10-20', 'base:永': '2026-10-05', 'base:和': '2026-10-05' };

  // ------------------------------------------------------------------ 1. 行结构与勾选
  step('写错过: rows (latest wrong first), meta, 写错那次, 没有笔迹, default all selected, footer');
  await setup(page, { records: BASE, due: BASE_DUE });
  await openList(page, 'wrong');
  let v = await listView(page);
  assert.equal(v.title, COPY.titleWrong, 'page title 写错过');
  assert.equal(v.head, COPY.head(2), 'head 2 个字');
  assert.equal(v.top, COPY.wrongTop, 'R-E04 top line');
  assert.deepEqual(v.rows.map(r => r.char), ['和', '永'], 'latest wrong first (和 r5 > 永 r4)');
  assert.deepEqual(v.rows.map(r => r.meta), [COPY.wrongMeta(9, 21, 2), COPY.wrongMeta(9, 20, 1)], 'R-E03 meta');
  assert.ok(v.rows.every(r => r.word && r.word.includes(r.char) && r.bold === r.char), `word shown with the target bold: ${v.rows.map(r => r.word).join(' / ')}`);
  assert.deepEqual(v.rows.map(r => r.caption), [COPY.wrongThumb, COPY.wrongThumb], '写错那次 under each thumb');
  assert.deepEqual(v.rows.map(r => r.noink), [COPY.noInk, COPY.noInk], 'no stored ink (P31 off) → 没有笔迹 (10.12)');
  assert.deepEqual(v.rows.map(r => [r.selected, r.checked]), [[true, 'true'], [true, 'true']], 'default all selected (R-E02)');
  assert.equal(v.rows[0].selLabel, '取消选择「和」', 'checkbox accessible name');
  assert.equal(v.note, COPY.wrongNote, 'R-E03 note');
  assert.equal(v.hint, COPY.selected(2), 'hint 选了 2 个字');
  assert.deepEqual(v.go, { text: COPY.btnMany, disabled: false, aria: null }, 'button 练这些字');
  assert.equal(v.toggle, COPY.selectNone, 'S06 toggle shows 全不选 when all selected');
  let n = await numbers(page);
  assert.deepEqual(n.wrong, v.rows.map(r => r.char), 'list = records.wrongList(getState)');

  step('click the circle → 练这个字; 全选; 全不选 → 先选一个字 disabled + aria-disabled, clicking does nothing');
  await clickRowSelect(page, '和');
  v = await listView(page);
  assert.deepEqual(v.rows.map(r => r.selected), [false, true], '和 unselected');
  assert.equal(v.rows[0].selLabel, '选择「和」', 'label follows state');
  assert.equal(v.hint, COPY.selected(1), 'hint 选了 1 个字');
  assert.equal(v.go.text, COPY.btnOne, 'button 练这个字');
  assert.equal(v.toggle, COPY.selectAll, 'toggle 全选');
  await page.click(topSel('list-toggle-all'));
  v = await listView(page);
  assert.deepEqual(v.rows.map(r => r.selected), [true, true], '全选');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('list-toggle-all'));
  v = await listView(page);
  assert.deepEqual(v.rows.map(r => r.selected), [false, false], '全不选');
  assert.equal(v.hint, COPY.selectedZero, 'Y05 zero hint');
  assert.deepEqual(v.go, { text: COPY.btnNone, disabled: true, aria: 'true' }, 'Z02: 先选一个字 really disabled');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sz-layer[data-top="true"] [data-testid="list-go"]')).cursor), 'default',
    'Z02: no hand cursor');
  await page.click(topSel('list-go'), { force: true });
  await page.waitForTimeout(300);
  n = await numbers(page);
  assert.equal(n.B, null, 'disabled button opened no group');
  assert.equal((await listView(page)).screen, 'library-list', 'still on the list');

  step('快忘了: one row, meta without 写错那次, R-E03 note; then both empty states');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  await openList(page, 'forget');
  v = await listView(page);
  assert.equal(v.title, COPY.titleForget, 'title 快忘了');
  assert.equal(v.top, COPY.forgetTop, 'R-E04 forget top');
  assert.deepEqual(v.rows.map(r => [r.char, r.meta, r.caption]), [['春', COPY.forgetMeta(9, 1, 1), null]], '春 due 9-25; 山 not due; no caption');
  assert.equal(v.note, COPY.forgetNote, 'forget note');
  n = await numbers(page);
  assert.deepEqual(n.forget, ['春'], 'list = records.forgetList(getState)');
  assert.ok(!n.forget.some(c => n.wrong.includes(c)), 'K16: no overlap');
  await setup(page, { records: [] });
  await openList(page, 'wrong');
  v = await listView(page);
  assert.deepEqual(v.empty, { title: COPY.wrongEmpty, body: COPY.wrongEmptyBody, glyph: '错' }, 'R-E04 wrong empty');
  assert.equal(v.go, null, 'no footer in the empty state');
  await setup(page, { records: [] });
  await openList(page, 'forget');
  v = await listView(page);
  assert.deepEqual(v.empty, { title: COPY.forgetEmptyTitle, body: COPY.forgetEmpty, glyph: '忘' }, 'R-E04 forget empty');

  // ------------------------------------------------------------------ 2. S06
  step('S06: select only 永 → 练这个字 → write (B from wrongList) → back unfinished → selection kept; reload keeps it');
  await setup(page, { records: BASE, due: BASE_DUE });
  await openList(page, 'wrong');
  await clickRowSelect(page, '和');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await startFromList(page);
  n = await numbers(page);
  assert.deepEqual([n.B.kind, n.B.source, n.B.queue], ['picked', { view: 'wrongList' }, ['base:永']], 'B = picked, source wrongList, queue [永]');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library-list');
  await waitNavIdle(page);
  v = await listView(page);
  assert.deepEqual(v.rows.map(r => [r.char, r.selected]), [['和', false], ['永', true]], 'S06: selection kept after returning unfinished');
  assert.equal(v.hint, COPY.selected(1), 'hint still 选了 1 个字');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await page.waitForSelector(topSel('list-screen'));
  await waitNavIdle(page);
  v = await listView(page);
  assert.deepEqual(v.rows.map(r => [r.char, r.selected]), [['和', false], ['永', true]], 'selection restored from history after reload');

  step('tap a row (not the circle) → 单字详情 {char} when registered (M3-6); back → selection unchanged');
  const detailRegistered = await page.evaluate(async () => !!(await import('/src/ui/router.js')).getScreen('detail'));
  if (detailRegistered) {
    await page.click(`${topSel('list-row')}[data-char="和"] [data-testid="list-row-open"]`);
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'detail');
    await waitNavIdle(page);
    const p = await page.evaluate(async () => (await import('/src/ui/router.js')).getRouter().getState().top.p);
    assert.equal(p.char, '和', 'detail opened with {char: 和}');
    n = await numbers(page);
    assert.deepEqual(n.B.queue, ['base:永'], 'opening a detail does not touch B');
    await page.click(topSel('page-back'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library-list');
    await waitNavIdle(page);
    v = await listView(page);
    assert.deepEqual(v.rows.map(r => [r.char, r.selected]), [['和', false], ['永', true]], 'selection unchanged after the detail');
  } else {
    assert.ok(await page.$(`${topSel('list-row')}[data-char="和"] [data-testid="list-row-main"]`), 'no detail screen yet → row is not a button');
  }

  // ------------------------------------------------------------------ 3. 场景 8a：写错后再练写对
  step('scenario 8a: from 写错过 practise 永 → 写对 → result (从写错过 / 回到写错过) → back to the list');
  await setup(page, { records: BASE, due: BASE_DUE });
  await openList(page, 'wrong');
  await clickRowSelect(page, '和');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await startFromList(page);
  await writeAndJudge(page, 'correct');
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  let r = await resultInfo(page);
  assert.equal(r.leave, COPY.leaveWrong, 'R-R06 leave 回到写错过');
  assert.ok(r.date && r.date.endsWith(COPY.fromWrong), `S05 source line: ${r.date}`);
  await leaveResult(page);
  v = await listView(page);
  assert.deepEqual(v.rows.map(r2 => r2.char), ['和'], '永 left 写错过 (recomputed on return)');
  assert.deepEqual(v.rows.map(r2 => r2.selected), [true], 'group finished → re-selected all (和 was unselected before)');
  assert.equal(v.hint, COPY.selected(1), 'hint 选了 1 个字');
  assert.equal(v.head, COPY.head(1), 'head 1 个字');
  n = await numbers(page);
  assert.deepEqual(n.wrong, ['和'], 'getState: wrongList = [和]');
  assert.ok(!n.forget.includes('永'), 'getState: 永 not in 快忘了');
  assert.equal(n.today, 1, 'getState: today N = 1');
  assert.equal(n.lastB, null, 'lastEnded.B cleared after leaving the result page');
  let tabs = await tabNumbers(page);
  assert.equal(tabs.todayCount, COPY.todayCount(n.today), 'home 今天记录了 N 个字 = getState');
  assert.equal(tabs.wrongCard, n.wrong.length, 'library home 写错过 card count = getState');
  assert.equal(tabs.forgetCard, n.forget.length, 'library home 快忘了 card count = getState');
  await openList(page, 'forget');
  v = await listView(page);
  assert.ok(!v.rows.some(r2 => r2.char === '永'), '快忘了 page does not list 永');

  // ------------------------------------------------------------------ 4. 场景 8b：写错后更正为对
  step('scenario 8b: from 写错过 practise 和 + 永; 和 写错 → result row 改为写对; 永 写错 → result cell 改为写对');
  await setup(page, { records: BASE, due: BASE_DUE });
  await openList(page, 'wrong');
  await startFromList(page);
  n = await numbers(page);
  assert.deepEqual(n.B.queue, ['base:和', 'base:永'], 'both selected, list order');
  const before = n.records;
  await writeAndJudge(page, 'wrong'); // 和
  await page.waitForSelector(topSel('write-line-change'));
  await waitNavIdle(page);
  await page.click(topSel('write-line-change'));
  await page.waitForSelector(tid('write-change-sheet'));
  await waitNavIdle(page);
  await page.click(tid('write-change-flip'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-change-sheet"]'));
  await waitNavIdle(page);
  n = await numbers(page);
  const he = n.judged.filter(j => j.char === '和').pop();
  assert.deepEqual([he.judgment, he.corrections], ['correct', 1], '和 corrected on the result row (same record, one correction)');
  assert.ok(!n.wrong.includes('和'), '和 left 写错过 right after the correction');
  await writeAndJudge(page, 'wrong'); // 永（最后一字）→ 结果页
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await page.click(`${topSel('result-cell')}[data-index="1"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-flip'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);
  n = await numbers(page);
  assert.equal(n.records, before + 2, 'two judged records added, corrections added none (D19)');
  const yong = n.judged.filter(j => j.char === '永').pop();
  assert.deepEqual([yong.judgment, yong.corrections], ['correct', 1], '永 corrected on the result page');
  assert.deepEqual(n.wrong, [], 'getState: 写错过 empty');
  assert.ok(!n.forget.includes('永') && !n.forget.includes('和'), 'getState: neither enters 快忘了');
  r = await resultInfo(page);
  assert.equal(r.leave, COPY.leaveWrong, 'leave 回到写错过');
  await leaveResult(page);
  v = await listView(page);
  assert.deepEqual(v.empty && v.empty.title, COPY.wrongEmpty, 'back on the list: empty state');
  tabs = await tabNumbers(page);
  assert.equal(tabs.todayCount, COPY.todayCount(n.today), `home 今天记录了 ${n.today} 个字 = getState`);
  assert.equal(tabs.wrongCard, 0, 'library home 写错过 card = 0');
  assert.equal(tabs.forgetCard, n.forget.length, 'library home 快忘了 card = getState');

  // ------------------------------------------------------------------ 5. 从快忘了开 B → 结束 → 回本页
  step('from 快忘了: 练这个字 → 写对 → result 回到快忘了 / 从快忘了 → back to the list, 春 gone');
  await setup(page, { records: BASE, due: BASE_DUE });
  await openList(page, 'forget');
  v = await listView(page);
  assert.deepEqual([v.go.text, v.hint], [COPY.btnOne, COPY.selected(1)], '1 selected → 练这个字');
  await startFromList(page);
  n = await numbers(page);
  assert.deepEqual(n.B.source, { view: 'forgetList' }, 'B source forgetList');
  await writeAndJudge(page, 'correct');
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  r = await resultInfo(page);
  assert.equal(r.leave, COPY.leaveForget, 'leave 回到快忘了');
  assert.ok(r.date && r.date.endsWith(COPY.fromForget), `S05 source line: ${r.date}`);
  await leaveResult(page);
  v = await listView(page);
  assert.equal(v.title, COPY.titleForget, 'back on 快忘了');
  assert.deepEqual(v.empty && v.empty.title, COPY.forgetEmptyTitle, '春 left 快忘了 (written once)');
  n = await numbers(page);
  assert.deepEqual(n.forget, [], 'getState: forgetList empty');
  assert.deepEqual(n.wrong, ['和', '永'], 'getState: 写错过 unchanged');

  // ------------------------------------------------------------------ 6. 「现在没有要写的字」→ 看写错过的字
  step('nothing to write (library exhausted) → 看写错过的字 › → 写错过 list (registered via setNoneActions)');
  await setup(page, { records: [rec(1, '永', 'wrong', '2026-09-20'), rec(2, '和', 'correct', '2026-09-20')],
    due: { 'base:永': '2026-10-10', 'base:和': '2026-10-10' } });
  await page.evaluate(async () => {
    const deck = await import('/src/data/deck.js');
    const row = (t, rank) => ({ py: 'x', hint: '', ans: t, ci: 0, target: t, rank, strokes: 5, parts: 1, topic: 't', d: 50, band: '基础',
      edu: null, common: 1, norm: '一级', std: 0, ctx: 'dict' });
    deck.setDeckSource({ seed: [row('永', 1), row('和', 2)], overrides: {} });
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await page.click(tid('home-start'));
  await page.waitForSelector(topSel('session-none'));
  await waitNavIdle(page);
  assert.ok(await page.$(topSel('session-none-wrong')), '看写错过的字 › shown (registered by M3-2)');
  await page.click(topSel('session-none-wrong'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library-list');
  await waitNavIdle(page);
  v = await listView(page);
  assert.deepEqual([v.title, v.rows.map(r2 => r2.char)], [COPY.titleWrong, ['永']], '写错过 list with 永');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  assert.ok(true, 'back from the list (it replaced the none page) returns to home');

  // ------------------------------------------------------------------ 7. 开组写入失败
  step('start failure: stays on the list, selection unchanged, 没保存上… ; retry succeeds');
  await page.reload(); // 复原题库（setDeckSource 只活在这次页面里）
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  await setup(page, { records: BASE, due: BASE_DUE });
  await openList(page, 'wrong');
  await clickRowSelect(page, '和');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('list-go'));
  await page.waitForSelector(topSel('list-start-fail'));
  v = await listView(page);
  assert.equal(v.fail, COPY.startFailed, 'failure note');
  assert.equal(v.screen, 'library-list', 'still on the list');
  assert.deepEqual(v.rows.map(r2 => [r2.char, r2.selected]), [['和', false], ['永', true]], 'selection unchanged');
  n = await numbers(page);
  assert.equal(n.B, null, 'no group written');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await startFromList(page);
  n = await numbers(page);
  assert.deepEqual(n.B && n.B.queue, ['base:永'], 'retry opened the group');
}
