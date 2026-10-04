// M2-2 会话开始与选字（02 §4 M2-2；01 §3.3 / §5；03 P09 / P33 / P36 / P37 / P38 / P60 / P61；R-H05 / R-H10 / R-H11）。
// 不依赖首页 UI（M2-1 并行）：在 ?test=1 页面里 import('/src/ui/screens/session/index.js') 调 startA / startPicked / openWrite，
// 用 window.__shiziTest 造数（seed / setClock / failNextWrite）。
//
// 场景：
//   1. 第一次练习：startA → 写字页 A，first，固定 3 字 policy.firstQueue（D38：尴 赢 拾）；返回首页 → 轻提示「已保存，下次接着写」（R-H10）；
//      再 startA → 续写同一组。
//   2. 写字页去重：openWrite('A') 两次 → 只有一层写字页（replace），depth 不变。
//   3. 只有顶层写字页写回现场：A 上一笔写入失败（本地 1 笔、存下 0 笔）→ 开 B 压在上面 → visibilitychange / pagehide →
//      下层 A 不写（存下仍 0 笔）；退回 A → A 重新成为顶层、把那一笔写回（存下 1 笔）。
//   4. 今天的练习选字（真实题库，规范常用字，新字按易忘度顺序 D28 / D41 配比）：到期字（逾期降序）、今天 judged 的字不再出、今天跳过 / 看过答案的字
//      可以再出（answerSeenScope none）、自选未写不进；上限 30：今天已复习 29 字 → 只出 1 个到期字。
//   5. 「现在没有要写的字」（R-H11）：小题库全写过 → 推入 session-none 页（exhausted 次入口），不写入。
//   6. S02：旧 B 有判断 → 正文列出没写的字、三键、无预选；接着写那组 → 旧 B；结束那组，开新的 → 一次 commit、新 B、
//      轻提示「上一组判断过的 1 个字已经记下。」；旧 B 零判断 → 无轻提示；保存失败 → 留在确认框（三段式），再试一次成功。
//   7. daily 跨天过期（setClock）：昨天没写完的今天的练习 → startA 开新的今天的练习；已判断记录保留；B 不过期（P61）。

import { bootTestHost, drawStroke, HORIZONTAL, tid, topSel, waitNavIdle } from './helpers.mjs';

const SESSION_MOD = '/src/ui/screens/session/index.js';
const FIRST = ['尴', '赢', '拾']; // D38：首练 3 字（原 5 字：尴 嚏 狩 晤 飓）

function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function call(page, fn, ...args) {
  return page.evaluate(async ({ mod, fn: name, args: a }) => {
    const m = await import(mod);
    const r = m[name](...a);
    return JSON.parse(JSON.stringify(r === undefined ? null : r));
  }, { mod: SESSION_MOD, fn, args });
}

async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function routerInfo(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const snap = getRouter().getState();
    return {
      depth: snap.depth,
      top: snap.top ? { n: snap.top.n, p: snap.top.p } : null,
      writeLayers: document.querySelectorAll('.sz-layer[data-screen="write"]').length,
      topScreen: document.querySelector('.sz-app').dataset.topScreen,
    };
  });
}

async function goHome(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    return getRouter().getState().depth === 0;
  });
  await waitNavIdle(page);
}

async function resetSeed(page, s) {
  await goHome(page);
  const r = await page.evaluate(seed => {
    window.__shiziTest.reset();
    return window.__shiziTest.seed(seed);
  }, s);
  if (!r || !r.ok) throw new Error('seed failed: ' + JSON.stringify(r));
}

async function waitWrite(page, slot) {
  await page.waitForSelector(`${topSel('write-screen')}`);
  await page.waitForFunction(s => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.slot === s;
  }, slot);
  await waitNavIdle(page);
}

async function toastText(page) {
  const el = await page.$(tid('toast'));
  return el ? (await el.textContent()).trim() : null;
}

function session({ id, slot = 'A', kind, chars, cursor = 0, day, at, items = [] }) {
  return {
    id,
    slot,
    kind: kind || (slot === 'B' ? 'picked' : 'daily'),
    source: { view: 'home' },
    queue: chars.map(c => `base:${c}`),
    cursor,
    items,
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
    lastLine: null,
    startedAt: at,
    startedDay: day,
    updatedAt: at,
  };
}

function record(serial, char, kind, judgment, day, at, sessionId = 's900') {
  const r = {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId, kind, at, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false },
  };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function byMonth(records) {
  const out = {};
  for (const r of records) (out[r.localDay.slice(0, 7)] || (out[r.localDay.slice(0, 7)] = [])).push(r);
  return out;
}

const FSRS = { stability: 5, difficulty: 5, state: 2 };

export default async function sessionStart(page, ctx) {
  const { assert } = ctx;
  await bootTestHost(page, ctx.baseURL);
  const now = await page.evaluate(() => window.__shiziTest.now());
  const TODAY = dayOf(now);
  const DAY = 86400000;
  const LONG_AGO = dayOf(now - 30 * DAY);
  const LA = now - 30 * DAY;

  // ------------------------------------------------------------ 1. 第一次练习
  ctx.step('first practice: startA → write page A, kind first, the fixed 3 characters (P09 / D38)');
  await resetSeed(page, {});
  const info = await call(page, 'aStartInfo');
  assert.deepEqual(info, { kind: 'first', firstVisit: true }, 'aStartInfo on an empty store');
  let r = await call(page, 'startA');
  assert.equal(r.ok, true, 'startA ok');
  assert.equal(r.opened, 'new', 'a new group is opened');
  await waitWrite(page, 'A');
  let st = await state(page);
  assert.equal(st.sessions.A.kind, 'first', 'kind first');
  assert.deepEqual(st.sessions.A.queue, FIRST.map(c => `base:${c}`), 'queue = 尴 赢 拾');
  assert.equal((await page.locator(topSel('write-progress')).textContent()).trim(), '1 / 3', 'progress 1 / 3');
  const firstId = st.sessions.A.id;

  ctx.step('back to home mid-group → toast 已保存，下次接着写 (R-H10); startA again resumes the same group');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await page.waitForSelector(tid('toast'));
  assert.equal(await toastText(page), '已保存，下次接着写', 'R-H10 toast');
  await waitNavIdle(page);
  r = await call(page, 'startA');
  assert.equal(r.opened, 'resume', 'startA resumes');
  await waitWrite(page, 'A');
  st = await state(page);
  assert.equal(st.sessions.A.id, firstId, 'same session, no new group');

  // ------------------------------------------------------------ 2. 去重
  ctx.step('openWrite twice on the same slot → still exactly one write layer (replace, depth unchanged)');
  const before = await routerInfo(page);
  assert.equal(before.writeLayers, 1, 'one write layer before');
  assert.equal(await call(page, 'openWrite', 'A'), 'replace', 'first extra openWrite replaces');
  await waitWrite(page, 'A');
  assert.equal(await call(page, 'openWrite', 'A'), 'replace', 'second extra openWrite replaces');
  await waitWrite(page, 'A');
  const after = await routerInfo(page);
  assert.equal(after.writeLayers, 1, 'one write layer');
  assert.equal(after.depth, before.depth, 'depth unchanged');
  assert.deepEqual(after.top, { n: 'write', p: { slot: 'A' } }, 'top is write A');

  // ------------------------------------------------------------ 3. 只有顶层写字页写回现场
  ctx.step('only the top write page writes the session back (visibilitychange / pagehide)');
  await resetSeed(page, {
    sessions: { A: session({ id: 's900', chars: ['永', '和', '春'], day: TODAY, at: now }), B: null, lastEnded: {} },
  });
  await call(page, 'openWrite', 'A');
  await waitWrite(page, 'A');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await drawStroke(page, HORIZONTAL);
  await page.waitForSelector(topSel('write-persist-notice'));
  st = await state(page);
  assert.equal(st.sessions.A.current.strokes.length, 0, 'the stroke on A failed to save (stored 0, local 1)');
  r = await call(page, 'startPicked', ['大']);
  assert.equal(r.opened, 'new', 'B opened on top of A');
  await waitWrite(page, 'B');
  const layers = await routerInfo(page);
  assert.equal(layers.writeLayers, 2, 'A (hidden) + B (top)');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    delete document.visibilityState;
  });
  await page.waitForTimeout(200);
  st = await state(page);
  assert.equal(st.sessions.A.current.strokes.length, 0, 'the lower A page did not write its local stroke back');
  assert.equal(st.sessions.B.current.strokes.length, 0, 'B untouched');
  await page.click(topSel('page-back'));
  await waitWrite(page, 'A');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.strokes.length === 1);
  assert.ok(true, 'back on top, A writes its stroke back (stored 1)');
  assert.equal(await page.locator(`${topSel('write-grid')}`).getAttribute('data-stroke-count'), '1', 'A still shows its stroke');

  // ------------------------------------------------------------ 4. 今天的练习选字
  ctx.step('daily: due reviews (most overdue first) mixed with new chars (D41), judged-today excluded, skipped / answer-seen today can return, custom unwritten excluded');
  // 新字顺序（D28 易忘度，规范常用字库）：酱 疆 酝 尴 嚷 豫 痒 酿 罐 …（D45：常用的姓氏 / 地名字 疆 豫 在内；不再是 SEED 字频序的 的 一 是 不 了 在 人）
  const recs = [
    record(1, '了', 'judged', 'correct', LONG_AGO, LA),
    record(2, '在', 'judged', 'correct', LONG_AGO, LA + 1),
    record(3, '尴', 'judged', 'correct', TODAY, now - 60000),
    record(4, '酱', 'skipped', undefined, TODAY, now - 50000),
    record(5, '酝', 'answer-seen', undefined, TODAY, now - 40000),
  ];
  await resetSeed(page, {
    records: byMonth(recs),
    sched: {
      'base:了': { fsrs: FSRS, due: dayOf(now - 1 * DAY), lastJudgedAt: LA },
      'base:在': { fsrs: FSRS, due: dayOf(now - 3 * DAY), lastJudgedAt: LA },
      'base:尴': { fsrs: FSRS, due: dayOf(now - 5 * DAY), lastJudgedAt: now - 60000 },
    },
    custom: { added: [{ char: '嚷', at: now - 70000 }] },
  });
  assert.deepEqual(await call(page, 'aStartInfo'), { kind: 'daily', firstVisit: false }, 'aStartInfo daily');
  r = await call(page, 'startA');
  assert.equal(r.opened, 'new', 'opened a new group');
  await waitWrite(page, 'A');
  st = await state(page);
  assert.equal(st.sessions.A.kind, 'daily', 'kind daily');
  // D41：2 个到期、p = 2 / 4 = 0.5 → 2 复习 + 3 新字；组内复、新交错，末位若是新字就换成复习字（组尾放好写的字）
  assert.deepEqual(st.sessions.A.queue, ['base:在', 'base:酱', 'base:疆', 'base:酝', 'base:了'],
    '在 (3 days overdue, first) · 酱 (skipped today) · 疆 (D45: common place-name char, 2nd in the table) · 酝 (answer-seen today) · 了 (1 day, moved to the tail); not 尴 (judged today) nor 嚷 (custom)');
  for (const c of ['的', '一', '是']) assert.equal(st.sessions.A.queue.includes(`base:${c}`), false, `${c} is not a new character any more (D28)`);

  ctx.step('daily cap: 29 reviews done today → only 1 due character in the group (dailyReviewCap 30)');
  const capState = await page.evaluate(({ now: n, today, longAgo, la }) => {
    const deckChars = [];
    // 用题库里靠后的常用字（不与新字前几名冲突）
    const pool = '中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坐集编宝谈府拉黑且随格尽剑讲布杀微怕母调局根曾准团段终乐切级克精哪官示冷域读'.split('');
    for (const c of pool) if (!deckChars.includes(c)) deckChars.push(c);
    const reviewed = deckChars.slice(0, 29);
    const due = deckChars.slice(29, 32);
    const records = [];
    const sched = {};
    let serial = 1;
    const fsrs = { stability: 5, difficulty: 5, state: 2 };
    const push = (c, kind, day, at) => {
      records.push({ id: 'r' + serial, cardKey: 'base:' + c, char: c, sessionId: 's900', kind, judgment: 'correct', at, localDay: day,
        help: { hints: 0, answerSeen: false, traced: false } });
      serial += 1;
    };
    for (const c of reviewed) {
      push(c, 'judged', longAgo, la);
      push(c, 'judged', today, n - 1000);
      sched['base:' + c] = { fsrs, due: '2099-01-01', lastJudgedAt: n - 1000 };
    }
    for (const c of due) {
      push(c, 'judged', longAgo, la);
      sched['base:' + c] = { fsrs, due: longAgo, lastJudgedAt: la };
    }
    const byM = {};
    for (const r of records) (byM[r.localDay.slice(0, 7)] || (byM[r.localDay.slice(0, 7)] = [])).push(r);
    return { records: byM, sched, due };
  }, { now, today: TODAY, longAgo: LONG_AGO, la: LA });
  await resetSeed(page, { records: capState.records, sched: capState.sched });
  r = await call(page, 'startA');
  await waitWrite(page, 'A');
  st = await state(page);
  const dueInQueue = st.sessions.A.queue.filter(k => capState.due.includes(k.slice(5)));
  assert.equal(dueInQueue.length, 1, `only 1 of the 3 due characters (29 reviews already today): ${st.sessions.A.queue.join(' ')}`);
  assert.equal(st.sessions.A.queue.length, 5, 'group of 5');
  assert.equal(st.sessions.A.queue[st.sessions.A.queue.length - 1], dueInQueue[0], 'the lone review sits at the tail of the group (D41: the group ends on a char that is easy to write)');

  // ------------------------------------------------------------ 5. 现在没有要写的字
  ctx.step('nothing to write (tiny deck, all written) → session-none page, no write (R-H11)');
  await resetSeed(page, {
    records: byMonth([record(1, '永', 'judged', 'correct', TODAY, now - 1000), record(2, '和', 'judged', 'wrong', TODAY, now - 900)]),
    sched: {
      'base:永': { fsrs: FSRS, due: dayOf(now + 5 * DAY), lastJudgedAt: now - 1000 },
      'base:和': { fsrs: FSRS, due: dayOf(now + 1 * DAY), lastJudgedAt: now - 900 },
    },
  });
  await page.evaluate(async () => {
    const deck = await import('/src/data/deck.js');
    const row = (t, rank) => ({ py: 'x', hint: '', ans: t, ci: 0, target: t, rank, strokes: 5, parts: 1, topic: 't', d: 50, band: '基础',
      edu: null, common: 1, norm: '一级', std: 0, ctx: 'dict' });
    deck.setDeckSource({ seed: [row('永', 1), row('和', 2)], overrides: {} });
  });
  const logBefore = await page.evaluate(() => window.__shiziTest.getWriteLog().length);
  r = await call(page, 'startA');
  assert.equal(r.opened, 'none', 'opened the none page');
  assert.equal(r.libraryExhausted, true, 'library exhausted');
  await page.waitForSelector(topSel('session-none'));
  await waitNavIdle(page);
  assert.equal((await page.locator(topSel('session-none-title')).textContent()).trim(), '现在没有要写的字', 'R-H11 title');
  assert.equal((await page.locator(topSel('session-none-body')).textContent()).trim(), '想接着写，可以自己选几个字。', 'R-H11 body');
  assert.equal((await page.locator(topSel('session-none-nochars')).textContent()).trim(), '可以换一个字库，或者先练写错过的字。', 'R-H11 noChars body (library exhausted)');
  assert.equal((await page.locator(topSel('session-none-home')).textContent()).trim(), '回到首页 ›', 'R-H11 back home link');
  assert.equal(await page.evaluate(() => window.__shiziTest.getWriteLog().length), logBefore, 'no storage write');
  assert.equal(((await state(page)).sessions || {}).A || null, null, 'no session opened');
  const noneBtns = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const b = id => {
      const el = top.querySelector(`[data-testid="${id}"]`);
      return el ? { text: el.textContent.trim(), primary: el.classList.contains('sz-btn--primary') } : null;
    };
    return { lib: b('session-none-libswitch'), pick: b('session-none-pick') };
  });
  assert.deepEqual(noneBtns.lib, { text: '更换字库', primary: true }, 'I5 / P83: exhausted → primary 更换字库 (原型 noChars)');
  assert.equal(noneBtns.pick && noneBtns.pick.primary, false, '自己选字 becomes a secondary button when 更换字库 is the primary');
  await page.evaluate(async () => {
    const deck = await import('/src/data/deck.js');
    deck.setDeckSource(null);
  });
  await page.click(topSel('session-none-libswitch'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library-switch');
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
  assert.ok(true, '更换字库 pushes the library-switch page');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'session-none');
  await waitNavIdle(page);
  assert.equal(await page.evaluate(() => window.__shiziTest.getWriteLog().length), logBefore, 'opening / leaving the switch page writes nothing');
  // 没写完的范围（非 exhausted）：没有「更换字库」，自己选字仍是主按钮
  await page.evaluate(async () => (await import('/src/ui/screens/session/none.js')).openNonePage({ exhausted: false }));
  await page.waitForFunction(() => {
    const top = document.querySelector('.sz-layer[data-top="true"] [data-testid="session-none"]');
    return !!top && !top.querySelector('[data-testid="session-none-nochars"]');
  });
  await waitNavIdle(page);
  const plainNone = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const pick = top.querySelector('[data-testid="session-none-pick"]');
    return { lib: !!top.querySelector('[data-testid="session-none-libswitch"]'), pickPrimary: !!pick && pick.classList.contains('sz-btn--primary') };
  });
  assert.deepEqual(plainNone, { lib: false, pickPrimary: true }, 'not exhausted: no 更换字库, 自己选字 is the primary button');
  await page.click(topSel('session-none-home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);

  // ------------------------------------------------------------ 6. S02
  const oldB = session({
    id: 's901', slot: 'B', chars: ['额', '鲜', '境'], cursor: 1, day: TODAY, at: now - 5000,
    items: [{ cardKey: 'base:额', recordId: 'r1', kind: 'judged' }],
  });
  const withJudged = {
    records: byMonth([record(1, '额', 'judged', 'correct', TODAY, now - 4000, 's901')]),
    sched: { 'base:额': { fsrs: FSRS, due: dayOf(now + 2 * DAY), lastJudgedAt: now - 4000 } },
    sessions: { A: null, B: oldB, lastEnded: {} },
  };

  ctx.step('S02: body names the unwritten characters, three buttons, nothing preselected');
  await resetSeed(page, withJudged);
  r = await call(page, 'startPicked', ['永', '和']);
  assert.equal(r.opened, 's02', 'S02 opened');
  assert.deepEqual(r.s02.unwrittenChars, ['鲜', '境'], 'S02 data: 鲜 境');
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  assert.equal((await page.locator(tid('s02-body')).textContent()).trim(), '上一组还有「鲜」「境」没写。', 'R-H05 body with the characters');
  assert.deepEqual(
    [await page.locator(tid('s02-continue')).textContent(), await page.locator(tid('s02-end-start')).textContent(),
      await page.locator(tid('s02-cancel')).textContent()].map(s => s.trim()),
    ['接着写那组', '结束那组，开新的', '取消'], 'three buttons');
  const focus = await page.evaluate(() => ({ testid: document.activeElement && document.activeElement.dataset.testid,
    tag: document.activeElement && document.activeElement.tagName }));
  assert.deepEqual(focus, { testid: 's02-dialog', tag: 'DIV' }, 'focus on the dialog itself, no button preselected');
  assert.equal((await state(page)).sessions.B.id, 's901', 'nothing written while asking');

  ctx.step('S02 取消 → closes, nothing written');
  await page.click(tid('s02-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="s02-dialog"]'));
  await waitNavIdle(page);
  assert.equal((await state(page)).sessions.B.id, 's901', 'old B kept');

  ctx.step('S02 接着写那组 → the old B (cursor on 鲜)');
  await call(page, 'startPicked', ['永', '和']);
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  await page.click(tid('s02-continue'));
  await waitWrite(page, 'B');
  st = await state(page);
  assert.equal(st.sessions.B.id, 's901', 'same old group');
  assert.equal(st.sessions.B.cursor, 1, 'cursor on 鲜');
  assert.equal((await routerInfo(page)).writeLayers, 1, 'one write layer');

  ctx.step('S02 结束那组，开新的 (old B judged 1) → one commit, new B, toast 上一组判断过的 1 个字已经记下。');
  await goHome(page);
  await call(page, 'startPicked', ['永', '和']);
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  const commitsBefore = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.key === 'shizi.v2.sessions').length);
  await page.click(tid('s02-end-start'));
  await waitWrite(page, 'B');
  st = await state(page);
  assert.deepEqual(st.sessions.B.queue, ['base:永', 'base:和'], 'new B = 永 和');
  assert.equal(st.sessions.lastEnded.B.id, 's901', 'old B moved to lastEnded.B');
  assert.equal(st.sessions.lastEnded.B.endedEarly, true, 'endedEarly');
  const sessionWrites = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.key === 'shizi.v2.sessions').length);
  assert.equal(sessionWrites - commitsBefore, 1, 'sessions written once (single commit)');
  await page.waitForSelector(tid('toast'));
  assert.equal(await toastText(page), '上一组判断过的 1 个字已经记下。', 'P38 toast');
  const judged = Object.values(st.records).flat().filter(x => x.kind === 'judged');
  assert.equal(judged.length, 1, 'the judged record of 额 stays; 鲜 境 add nothing');
  assert.equal((await routerInfo(page)).writeLayers, 1, 'one write layer');

  ctx.step('S02 with a zero-judgment old B → no toast');
  await resetSeed(page, { sessions: { A: null, B: session({ id: 's902', slot: 'B', chars: ['鲜', '境'], day: TODAY, at: now - 5000 }), lastEnded: {} } });
  await page.evaluate(async () => {
    const { hideToast } = await import('/src/ui/components/Toast.js');
    hideToast();
  });
  await call(page, 'startPicked', ['永']);
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  await page.click(tid('s02-end-start'));
  await waitWrite(page, 'B');
  await page.waitForTimeout(300);
  assert.equal(await toastText(page), null, 'no toast when the old group had no judgment');
  st = await state(page);
  assert.equal(st.sessions.lastEnded.B.id, 's902', 'old B ended');
  assert.deepEqual(st.sessions.B.queue, ['base:永'], 'new B = 永');

  ctx.step('S02 save failure → stays in the dialog (three-part), nothing changed; 再试一次 succeeds');
  await resetSeed(page, withJudged);
  await call(page, 'startPicked', ['永']);
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(tid('s02-end-start'));
  await page.waitForSelector(`${tid('s02-dialog')}[data-state="failed"]`);
  assert.equal((await page.locator(tid('s02-body')).textContent()).trim(), '没保存上，刚才的选择没记下。', 'failure sentence');
  assert.deepEqual([await page.locator(tid('s02-retry')).textContent(), await page.locator(tid('s02-fail-cancel')).textContent()]
    .map(s => s.trim()), ['再试一次', '先不保存'], 'failure buttons');
  st = await state(page);
  assert.equal(st.sessions.B.id, 's901', 'old B still in place');
  assert.equal(st.sessions.lastEnded.B, undefined, 'nothing ended');
  assert.equal((await routerInfo(page)).topScreen, 'home', 'still on home under the dialog');
  await waitNavIdle(page);
  await page.click(tid('s02-retry'));
  await waitWrite(page, 'B');
  st = await state(page);
  assert.deepEqual(st.sessions.B.queue, ['base:永'], 'new B = 永');
  assert.equal(st.sessions.lastEnded.B.id, 's901', 'old B ended after the retry');

  // ------------------------------------------------------------ 7. 跨天过期
  ctx.step('daily expires across days (setClock): resumeSlot finds nothing, startA opens a new daily; records stay; B kept (P61)');
  await resetSeed(page, {
    records: byMonth([record(1, '了', 'judged', 'correct', TODAY, now - 3000, 's903')]),
    sched: { 'base:了': { fsrs: FSRS, due: dayOf(now + 3 * DAY), lastJudgedAt: now - 3000 } },
    sessions: {
      A: session({ id: 's903', chars: ['了', '在', '人'], cursor: 1, day: TODAY, at: now - 5000,
        items: [{ cardKey: 'base:了', recordId: 'r1', kind: 'judged' }] }),
      B: session({ id: 's904', slot: 'B', chars: ['鲜'], day: TODAY, at: now - 5000 }),
      lastEnded: {},
    },
  });
  r = await call(page, 'expireStale');
  assert.deepEqual(r, { ok: true, expired: [] }, 'same day: nothing expires');
  const tomorrow = new Date(now + DAY);
  tomorrow.setHours(9, 0, 0, 0);
  await page.evaluate(iso => window.__shiziTest.setClock(iso), tomorrow.toISOString());
  const TOMORROW = dayOf(tomorrow.getTime());
  r = await call(page, 'resumeSlot', 'A');
  assert.equal(r.ok, true, 'ok');
  assert.equal(r.opened, null, 'nothing to resume in A');
  assert.deepEqual(r.expired.map(x => x.id), ['s903'], 'yesterday\'s daily expired');
  st = await state(page);
  assert.equal(st.sessions.A, null, 'slot A cleared (P37 discard, no result page)');
  assert.equal(st.sessions.lastEnded.A, undefined, 'not kept for a result page');
  assert.equal(st.sessions.B.id, 's904', 'picked B does not expire (P61 never)');
  assert.equal(Object.values(st.records).flat().filter(x => x.kind === 'judged').length, 1, 'the judged record stays');
  r = await call(page, 'startA');
  assert.equal(r.opened, 'new', 'opened a new group');
  await waitWrite(page, 'A');
  st = await state(page);
  assert.equal(st.sessions.A.kind, 'daily', 'kind daily');
  assert.equal(st.sessions.A.startedDay, TOMORROW, 'new daily started on the new day');
  assert.ok(st.sessions.A.id !== 's903', 'a new session id');
  // 了 的 due 在 3 天后：不是到期复习。D41 的提前复习补位（到期不够时用快到期的字凑组）会把它放在组尾，所以只断言「不当到期字排在前面」。
  assert.equal(st.sessions.A.queue.length, 5, 'a full group: 4 new chars + the not-yet-due 了 as an early-review filler');
  assert.equal(st.sessions.A.queue[st.sessions.A.queue.length - 1], 'base:了', '了 (not due yet) can only be an early-review filler, at the tail of the group');
  assert.equal(st.sessions.A.queue.indexOf('base:了'), 4, '了 is not among the leading (due) chars');

  ctx.step('same flow when startA runs first on the new day: expiry + new group in one commit');
  await page.evaluate(() => window.__shiziTest.setClock(null));
  await resetSeed(page, {
    sessions: { A: session({ id: 's905', chars: ['在', '人'], day: TODAY, at: now - 5000 }), B: null, lastEnded: {} },
    records: byMonth([record(1, '了', 'judged', 'correct', TODAY, now - 3000, 's905')]),
    sched: { 'base:了': { fsrs: FSRS, due: dayOf(now + 3 * DAY), lastJudgedAt: now - 3000 } },
  });
  await page.evaluate(iso => window.__shiziTest.setClock(iso), tomorrow.toISOString());
  const sessWrites0 = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.key === 'shizi.v2.sessions').length);
  r = await call(page, 'startA');
  assert.equal(r.opened, 'new', 'opened a new group');
  await waitWrite(page, 'A');
  const sessWrites1 = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.key === 'shizi.v2.sessions').length);
  assert.equal(sessWrites1 - sessWrites0, 1, 'one sessions write');
  st = await state(page);
  assert.ok(st.sessions.A.id !== 's905', 'a new session id');
  assert.equal(st.sessions.A.startedDay, TOMORROW, 'started on the new day');
  await page.evaluate(() => window.__shiziTest.setClock(null));
}
