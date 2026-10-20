// 阶段 1 P1-E4：新的调度规则与首次练习（decisions D28 / D38 / D39 / D40 / D41；03 P09 / P34 / P74 / P125–P129）。
// 真实题库（规范常用字）、真实 store、真实写字页。
//
// 场景：
//   1. D38 首次练习是 尴 赢 拾 三字，进度「1 / 3」，写完（尴写错、赢拾写对）走到结果页，之后进入正常调度；首练写对的字记 Easy（稳定度远大于 Good）。
//   2. 第 2 天（setClock）：尴到期 → 今天的练习是「热身字在组首 + 复习 + 新字」混合，新字来自易忘度清单 1.0（豫 嚷 酝…，D45 起常用姓氏 / 地名字在内），不出现「的、一、是」，
//      姓氏 / 地名 / 大写数字不在新字里；热身字写对记 Easy（稳定度远大于 Good）。
//   3. 积压很大（24 个到期字）：连续开 5 组（经 core/session-start + commitJudgment 写完）：积压阀关着时每组全是复习，直到积压回落到 2 天以下才重新给新字
//      （D65 ② 回滞阀，覆盖 D41 的「不连续两组全复习」）。
//   本 spec 的配比断言按 5 字一组写（D41）：第 2 天起把「每组字数」设成 5（D65 ② 起缺省 20）。
//   4. D40 大写数字特别组：累计满 10 组、积压不重 → 首页出现一句提示；开组 = 壹贰叁肆伍（题面是借条语境「壹佰元整」…），写完后第二组 = 陆柒捌玖拾，
//      再之后不再出现；整个过程里别的组的题面语境不受影响。
// 控制台零错误由 run.mjs 统一断言。

import { bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, topSel, waitNavIdle, leaveResult } from './helpers.mjs';

const CLOCK = '2026-09-24T20:00:00';
const S = v => JSON.stringify(v);

async function resetAt(page, iso = CLOCK) {
  await page.evaluate(i => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(i);
  }, iso);
}

async function setClock(page, iso) {
  await page.evaluate(i => window.__shiziTest.setClock(i), iso);
}

async function seed(page, state) {
  const r = await page.evaluate(s => window.__shiziTest.seed(s), state);
  if (!r || !r.ok) throw new Error(`seed failed: ${S(r)}`);
}

async function getState(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function topScreen(page) {
  return page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen);
}

async function waitTop(page, screen) {
  await page.waitForFunction(s => document.querySelector('.sz-app').dataset.topScreen === s, screen);
  await waitNavIdle(page);
}

async function toHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitTop(page, 'home');
}

async function waitCursor(page, n) {
  await page.waitForFunction(c => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && Number(w.dataset.cursor) === c;
  }, n);
  await waitNavIdle(page);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

/** 写一笔 → 写好了 → 判断页 → 判断；最后一字之后等结果页。 */
async function writeAndJudge(page, judgment, { nextCursor = null, result = false } = {}) {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForFunction(() => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.phase === 'compare';
  });
  await page.waitForTimeout(PRESS_SETTLE_MS); // 新页面 0.4s 内按钮不响应（01 §6.6）
  await page.click(topSel(`write-judge-${judgment}`));
  if (result) await waitTop(page, 'result');
  else if (nextCursor !== null) await waitCursor(page, nextCursor);
}

async function queueOfA(page) {
  const st = await getState(page);
  return st.sessions.A ? st.sessions.A.queue.map(k => k.slice(5)) : null;
}

async function promptOf(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const word = top.querySelector('[data-testid="write-prompt-word"]');
    const hint = top.querySelector('[data-testid="write-prompt-hint"]');
    return { word: word ? word.textContent.replace(/\s+/g, '') : null, hint: hint ? hint.textContent.trim() : null };
  });
}

/** 用 store 直接把整组写完（不经 UI）：每个字 commitJudgment 一次。返回这一组的计划（含 newKeys / dueKeys / special）。 */
async function playGroupViaStore(page, { judgment = 'correct' } = {}) {
  return page.evaluate(async j => {
    const { getStore } = await import('/src/store/store.js');
    const { startDaily } = await import('/src/core/session-start.js');
    const { deckAdapter } = await import('/src/data/deck.js');
    const { commitJudgment } = await import('/src/ui/screens/write/compare.js');
    const { now } = await import('/src/platform/env.js');
    const store = getStore();
    const r = startDaily(store, { now: () => now(), deck: deckAdapter, source: { view: 'home' } });
    if (!r.ok || !r.started) return { error: JSON.stringify(r) };
    const strokes = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 170, t: 60 }, { x: 280, y: 170, t: 120 }]];
    const queue = store.getState().sessions.A.queue.slice();
    for (const cardKey of queue) {
      const c = commitJudgment(store, { slot: 'A', cardKey, judgment: j, strokes });
      if (!c.ok) return { error: 'judge ' + cardKey + ' ' + JSON.stringify(c) };
    }
    const plan = r.plan;
    return {
      queue,
      dueKeys: plan.dueKeys,
      newKeys: plan.newKeys,
      earlyKeys: plan.earlyKeys,
      warmKeys: plan.warmKeys,
      special: plan.special ? plan.special.kind : null,
    };
  }, judgment);
}

function record(serial, key, day, at, sessionId, judgment = 'correct') {
  return {
    id: `r${serial}`, cardKey: key, char: key.slice(5), sessionId, kind: 'judged', judgment, at, localDay: day,
    help: { hints: 0, answerSeen: false, traced: false },
  };
}

function byMonth(records) {
  const out = {};
  for (const r of records) (out[r.localDay.slice(0, 7)] || (out[r.localDay.slice(0, 7)] = [])).push(r);
  return out;
}

function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const FSRS = (stability, due) => ({ due, stability, difficulty: 5, elapsed_days: 0, scheduled_days: 10, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: due });

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------ 1. 首次练习 尴 赢 拾
  step('D38: first practice = 尴 赢 拾 (3 chars), progress 1 / 3; finish it (尴 wrong, 赢 拾 correct) → result page');
  await resetAt(page);
  await waitNavIdle(page);
  const hint0 = await page.locator(topSel('home-first-tip')).textContent();
  assert.equal(hint0.trim(), '先写三个大家常忘的字。', 'home first-open line (P1-E5 design §一: 「三个」 = the 3 first-practice chars, D38)');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  assert.deepEqual(await queueOfA(page), ['尴', '赢', '拾'], 'queue = 尴 赢 拾');
  assert.equal((await page.locator(topSel('write-progress')).textContent()).trim(), '1 / 3', 'progress 1 / 3');
  let p = await promptOf(page);
  assert.ok(p.word && p.word.includes('尬'), 'first char prompt is the word 尴尬 with 尴 blanked: ' + S(p));
  await writeAndJudge(page, 'wrong', { nextCursor: 1 });
  assert.equal((await page.locator(topSel('write-progress')).textContent()).trim(), '2 / 3', 'progress 2 / 3');
  await writeAndJudge(page, 'correct', { nextCursor: 2 });
  assert.equal((await page.locator(topSel('write-progress')).textContent()).trim(), '3 / 3', 'progress 3 / 3');
  await writeAndJudge(page, 'correct', { result: true });
  let st = await getState(page);
  const judged = Object.values(st.records).flat().filter(r => r.kind === 'judged');
  assert.equal(judged.length, 3, 'three judged records');
  assert.deepEqual(st.sessions.lastEnded.A.queue, ['base:尴', 'base:赢', 'base:拾']);
  const stab = k => st.sched[k].fsrs.stability;
  assert.ok(stab('base:赢') > 8 && stab('base:拾') > 8, `first-time correct → Easy (stability ${stab('base:赢')} / ${stab('base:拾')}, Good would be ~2.3)`);
  assert.ok(stab('base:尴') < 3, `first-time wrong → Again (stability ${stab('base:尴')})`);
  await leaveResult(page);
  await waitTop(page, 'home');

  // ------------------------------------------------------------ 2. 第 2 天
  step('day 2 (setClock): 尴 is due → the group mixes a warm-up char at the head, the review, early reviews and new chars from the order list; no 的 一 是');
  await setClock(page, '2026-09-25T09:00:00');
  await page.evaluate(async () => {
    const { commitGroupSize } = await import('/src/ui/screens/mine/prefs.js');
    const { getStore } = await import('/src/store/store.js');
    const r = commitGroupSize(getStore(), 5);
    if (!r.ok) throw new Error('commitGroupSize failed');
  });
  await toHome(page);
  assert.equal(await page.locator(topSel('home-capital-hint')).count(), 0, 'no capital hint this early');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const q2 = await queueOfA(page);
  assert.equal(q2.length, 5, 'a full group of 5');
  assert.equal(q2.includes('尴'), true, '尴 (wrong yesterday, due today) is reviewed');
  for (const c of ['的', '一', '是']) assert.equal(q2.includes(c), false, `${c} is not in the group (D28)`);
  const lib = await page.evaluate(async () => {
    const { deckAdapter } = await import('/src/data/deck.js');
    const { CHAR_ORDER } = await import('/src/config/char-order.js');
    return { warm: CHAR_ORDER.warmup.slice(), order: CHAR_ORDER.order.slice(0, 40), reserved: [...CHAR_ORDER.reserved.surnames, ...CHAR_ORDER.reserved.places, ...CHAR_ORDER.reserved.capitalNumerals], candidates: deckAdapter.newCandidates('core3500').slice(0, 12).map(k => k.slice(5)) };
  });
  assert.equal(lib.warm.includes(q2[0]), true, `warm-up char at the head: ${S(q2)}`);
  const newOnes = q2.filter(c => c !== '尴' && c !== q2[0]);
  const fromOrder = newOnes.filter(c => lib.order.includes(c));
  assert.ok(fromOrder.length >= 2, `new chars come from the order list (易忘度): ${S(q2)}`);
  // 只查新字：首练写过的字（尴赢拾）可以作为复习 / 提前复习补位出现（D41），拾同时是大写数字，不能算「默认新字」；
  // 是否被提前复习选中取决于 FSRS fuzz，原先对整组断言会随机失败。
  const firstChars = ['尴', '赢', '拾'];
  for (const c of q2.filter(c => !firstChars.includes(c) && c !== q2[0])) {
    assert.equal(lib.reserved.includes(c), false, `${c} (surname / place / capital numeral) is not a default new char`);
  }
  // D45：常用的姓氏 / 地名字（豫 疆 厦 …）回到默认排序原位；易忘度表 1.0（顾问审读）的默认顺序是 豫 嚷 酝 尴 疆 酱 …（肆 是大写数字，已剔除）
  assert.deepEqual(lib.candidates.slice(0, 2), ['豫', '嚷'], 'the default order starts 豫 嚷 酝 尴 …');
  const commons = await page.evaluate(async () => {
    const { deckAdapter } = await import('/src/data/deck.js');
    const all = deckAdapter.newCandidates('core3500').map(k => k.slice(5));
    return { in: ['熊', '颜', '藏', '桂', '厦', '傅', '鞠', '豫'].filter(c => all.includes(c)), out: ['滕', '翟', '蔺', '黔', '渝'].filter(c => all.includes(c)) };
  });
  assert.deepEqual(commons.in, ['熊', '颜', '藏', '桂', '厦', '傅', '鞠', '豫'], 'D45: common surnames / place names are new-char candidates again');
  assert.deepEqual(commons.out, [], 'D45: rarely-used surnames / place names stay out');
  // D66 ⑫：新用户前 3 天每组新字至多 2 份（5 字一组 2 个，含热身字）：热身字 + 新字池最前的「豫」，其余是首练字的提前复习
  assert.ok(q2.includes('豫') && !q2.includes('嚷'), 'the new char is the first of the list (new-user cap: warm-up + 1 new): ' + S(q2));
  assert.equal(q2[q2.length - 1] !== '豫' && q2[q2.length - 1] !== '嚷', true, 'the group does not end on a new char');
  const warmChar = q2[0];
  // 写完第一个（热身字）→ 写对 → 记 Easy
  await writeAndJudge(page, 'correct', { nextCursor: 1 });
  st = await getState(page);
  assert.ok(st.sched[`base:${warmChar}`].fsrs.stability > 8, `warm-up char written correct → Easy (stability ${st.sched[`base:${warmChar}`].fsrs.stability})`);
  await page.click(topSel('page-back'));
  await waitTop(page, 'home');

  // ------------------------------------------------------------ 3. 积压很大
  step('backlog of 24 due chars: the valve closes (all-review groups) and only reopens once the backlog is under 2 days (D65 valve with hysteresis)');
  await resetAt(page);
  const nowMs = await page.evaluate(() => window.__shiziTest.now());
  const DAY = 86400000;
  const keys = await page.evaluate(async () => {
    const { libraryOf } = await import('/src/data/deck.js');
    const { CHAR_ORDER } = await import('/src/config/char-order.js');
    const bad = new Set([...CHAR_ORDER.warmup, ...CHAR_ORDER.reserved.surnames, ...CHAR_ORDER.reserved.places, ...CHAR_ORDER.reserved.capitalNumerals]);
    return libraryOf('core3500').keys.filter(k => !bad.has(k.slice(5))).slice(2500, 2524);
  });
  assert.equal(keys.length, 24);
  const long = dayOf(nowMs - 40 * DAY);
  const yesterday = dayOf(nowMs - DAY);
  let serial = 1;
  const recs = keys.map(k => record(serial++, k, long, nowMs - 40 * DAY, 's1'));
  recs.push(record(serial++, 'base:春', yesterday, nowMs - DAY, 's2')); // 昨天最后一组有新字
  const sched = {};
  for (const k of keys) sched[k] = { fsrs: FSRS(3, dayOf(nowMs - 2 * DAY)), due: dayOf(nowMs - 2 * DAY), lastJudgedAt: nowMs - 40 * DAY };
  sched['base:春'] = { fsrs: FSRS(3, dayOf(nowMs + 9 * DAY)), due: dayOf(nowMs + 9 * DAY), lastJudgedAt: nowMs - DAY };
  await seed(page, { records: byMonth(recs), sched, sessions: { A: null, B: null, lastEnded: {} }, settings: { groupSize: 5 } });
  const news = [];
  for (let g = 0; g < 5; g += 1) {
    const r = await playGroupViaStore(page);
    assert.ok(!r.error, 'group ' + g + ': ' + r.error);
    news.push(r.newKeys.length);
    assert.equal(r.special, null, 'no special group in this scenario');
  }
  // 每组写掉 5 个到期字：开组时积压 24 19 14 9 4 → p = 积压 / 4 = 6、4.75（≥ 4 关）、3.5、2.25（阀关着、≥ 2 不开）、1（< 2 → 开）；
  // 一共 20 个复习，碰不到每日上限 30
  assert.deepEqual(news.slice(0, 4), [0, 0, 0, 0], 'p ≥ 4 closes the valve; it stays closed while p ≥ 2: ' + S(news));
  assert.ok(news[4] > 0, 'backlog under 2 days → new chars again: ' + S(news));

  // ------------------------------------------------------------ 4. D40 大写数字
  step('D40: after 10 groups and a light backlog the home page hints, the next group is 壹贰叁肆伍 (money context), then 陆柒捌玖拾, then never again');
  await resetAt(page);
  const now2 = await page.evaluate(() => window.__shiziTest.now());
  const recs2 = [];
  let n2 = 1;
  for (let g = 1; g <= 10; g += 1) {
    const at = now2 - (11 - g) * DAY;
    recs2.push(record(n2++, `base:${String.fromCodePoint(0x6400 + g)}`, dayOf(at), at, `s${g}`));
  }
  const sched2 = {};
  for (const r of recs2) sched2[r.cardKey] = { fsrs: FSRS(30, dayOf(now2 + 20 * DAY)), due: dayOf(now2 + 20 * DAY), lastJudgedAt: r.at };
  await seed(page, { records: byMonth(recs2), sched: sched2, sessions: { A: null, B: null, lastEnded: {} } });
  await toHome(page);
  await page.waitForSelector(topSel('home-capital-hint'));
  assert.equal((await page.locator(topSel('home-capital-hint')).textContent()).trim(), '今天写两组大写数字，借条、红包上用得着。', 'E9a (D49, 实现交接 §1.2 ④): one sentence — the lead 「「拾」也是大写的十。」 is gone');
  assert.equal(await page.locator(topSel('home-capital-hint')).getAttribute('data-kind'), 'capital1');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  assert.deepEqual(await queueOfA(page), ['壹', '贰', '叁', '肆', '伍'], 'special group 1');
  p = await promptOf(page);
  assert.equal(p.word.includes('佰元整') || p.word.includes('仟元整'), true, 'money context on the prompt: ' + S(p));
  assert.equal(p.hint, '借条上的大写金额', 'hint line');
  assert.equal((await page.locator(topSel('write-progress')).textContent()).trim(), '1 / 5');
  for (let i = 0; i < 4; i += 1) await writeAndJudge(page, 'correct', { nextCursor: i + 1 });
  await writeAndJudge(page, 'correct', { result: true });
  await leaveResult(page);
  await waitTop(page, 'home');
  await page.waitForSelector(topSel('home-capital-hint'));
  assert.equal(await page.locator(topSel('home-capital-hint')).getAttribute('data-kind'), 'capital2', 'second special group next');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  assert.deepEqual(await queueOfA(page), ['陆', '柒', '捌', '玖', '拾'], 'special group 2');
  p = await promptOf(page);
  assert.equal(p.hint === '报销单上的大写金额' || p.hint === '随礼红包上的大写金额', true, 'hint line of group 2: ' + S(p));
  for (let i = 0; i < 4; i += 1) await writeAndJudge(page, 'correct', { nextCursor: i + 1 });
  await writeAndJudge(page, 'correct', { result: true });
  await leaveResult(page);
  await waitTop(page, 'home');
  assert.equal(await page.locator(topSel('home-capital-hint')).count(), 0, 'both groups done → no more hint');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const q4 = await queueOfA(page);
  for (const c of '壹贰叁肆伍陆柒捌玖拾') assert.equal(q4.includes(c), false, `${c} does not come again (once only; they return later by FSRS)`);
  assert.equal(q4.includes('佰') || q4.includes('仟'), true, '佰 仟 lead the ordinary new chars afterwards: ' + S(q4));
  p = await promptOf(page);
  assert.equal(p.hint === '借条上的大写金额' || p.hint === '报销单上的大写金额' || p.hint === '随礼红包上的大写金额' || p.hint === '收据上的大写金额', false, 'ordinary group: no money-context hint line');
}
