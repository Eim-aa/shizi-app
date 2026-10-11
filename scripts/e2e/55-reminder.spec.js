// M5-5 提醒、触觉、按键音与桥（02 M5-5；01 §8.1；03 P18 / P24 / P47 / P48；04 R-S01 / R-S02）。全部用假原生通道
// （helpers.installNativeStub：window.webkit.messageHandlers.shiziNative 记录 postMessage）。
//
// 场景：
//   1. 设置提醒 → syncReminder：打开提醒（requestReminderPermission + syncReminder）；消息体字段与原生 ReminderQuestion 一致；
//      今天的题是到期最久的「境」，明天的题是明天到期且写错过的「鲜」（P48 写错过优先）——标题是遮住目标字的词语 + 拼音，
//      正文沿旧句；时间是用户选的（改成 21:15 后再同步）；原生回报 granted（shiziReminderStatus 经桥交给设置页）→ 写权限并再同步；
//      今天写了一个字（整体替换）→ 去抖后自动再同步，practicedToday=true。
//   2. 冷启动深链（无未完成 B）：页面加载时原生立刻调用 shiziOpenReminderTarget('base:鲜')——全局在 bridge.js 模块顶层就有、
//      调用返回 true 并进队列；markReady 后回放 → 以「这次选的字」（B）开「鲜」的写字页（P47），队列清空；启动时提醒开着 →
//      queryReminderStatus + syncReminder；零 pageerror / console.error。
//   3. 冷启动深链（有未完成 B）：走 S02「上一组还有…没写」→「结束那组，开新的」→ B 换成「额」；热启动再点一次通知（「境」，
//      就绪后直接交付）→ 又一次 S02 →「接着写那组」回到「额」。
//   4. 触觉 / 声音点位（S1，D50 ⑦）：判断落定 haptic stamp + sound j1 纸页落定（三个变体轮换）；看答案 action；描一遍 select；
//      描一遍落笔**不出声**（书写 / 描红无声）；写完最后一字进结果页 action + 落款盖章声 s1；按键音关（settings.sound=false）时判断只有触觉没有声音。

import {
  HORIZONTAL, bootTestHost, drawStroke, installNativeStub, localDayOf, makeSession, nativeMessages, tid, topSel, waitNavIdle, tap,
} from './helpers.mjs';

const DAY = 24 * 3600 * 1000;
const SETTINGS_MOD = '/src/ui/screens/mine/settings.js';

function rec(serial, char, judgment, at) {
  return {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's900', kind: 'judged', judgment, at,
    localDay: localDayOf(at), help: { hints: 0, answerSeen: false, traced: false },
  };
}

/** 鲜 写错过、明天到期；境 写对、4 天前到期；额 写对、今天到期。records 用真实 FSRS 卡算 sched，再改到期日。 */
function fixture(now) {
  const today = localDayOf(now);
  const plus = n => localDayOf(now + n * DAY);
  return {
    today,
    tomorrow: plus(1),
    records: [rec(1, '境', 'correct', now - 9 * DAY), rec(2, '额', 'correct', now - 5 * DAY), rec(3, '鲜', 'wrong', now - 2 * DAY)],
    due: { 'base:鲜': plus(1), 'base:境': plus(-4), 'base:额': today },
  };
}

async function seedFixture(page, { settings = null, sessions = null, extra = [] } = {}) {
  const now = await page.evaluate(() => Date.now());
  const fx = fixture(now);
  const res = await page.evaluate(async ({ fx: f, settings: st, sessions: ss, extra: ex }) => {
    const { applyJudgment } = await import('/src/core/fsrs.js');
    window.__shiziTest.reset();
    const all = f.records.concat(ex);
    const byMonth = {};
    for (const r of all) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
    const sched = {};
    for (const r of all) sched[r.cardKey] = applyJudgment(sched[r.cardKey], r).entry;
    for (const [key, day] of Object.entries(f.due)) sched[key] = { ...sched[key], due: day };
    const state = { records: byMonth, sched, sessions: ss || { A: null, B: null, lastEnded: {} } };
    if (st) state.settings = st;
    const out = window.__shiziTest.seed(state);
    return { ok: !!(out && out.ok), out };
  }, { fx, settings, sessions, extra });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.out));
  return { ...fx, now };
}

/** 页面里算「某字的通知标题」：题面词语遮住目标字 + 拼音（与 reminder.js 同一数据源，断言不是自证：只取题库数据）。 */
async function cardInfo(page, char) {
  return page.evaluate(async c => {
    const { cardForKey, hasContextWord } = await import('/src/data/deck.js');
    const card = cardForKey(`base:${c}`);
    return card ? { chars: card.chars, target: card.target, py: card.py, word: card.word, hasWord: hasContextWord(card) } : null;
  }, char);
}

function maskedTitle(info) {
  return `${info.chars.map(ch => (ch === info.target ? '＿' : ch)).join('')}（${info.py}）`;
}

async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function topScreen(page) {
  return page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen);
}

async function clickSettle(page, id) {
  await page.click(topSel(id));
  await page.waitForTimeout(450);
}

async function lastSync(page) {
  const msgs = await nativeMessages(page, 'syncReminder');
  return msgs[msgs.length - 1] || null;
}

// ------------------------------------------------------------------ 1

async function scenarioSettings(page, ctx) {
  const { assert, step, baseURL } = ctx;
  step('reminder content: enabling in settings syncs P48 questions (word + pinyin + user time)');
  await installNativeStub(page);
  await bootTestHost(page, baseURL);
  const fx = await seedFixture(page);
  const xian = await cardInfo(page, '鲜');
  const jing = await cardInfo(page, '境');
  assert.ok(xian && xian.hasWord && jing && jing.hasWord, 'fixture chars have context words in the deck');
  await page.evaluate(() => { window.__nativeMsgs.length = 0; });
  await page.evaluate(async mod => (await import(mod)).openSettings(), SETTINGS_MOD);
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
  assert.equal((await nativeMessages(page, 'syncReminder')).length, 0, 'opening settings does not sync');

  await clickSettle(page, 'settings-remind');
  const types = (await nativeMessages(page)).map(m => m.type).filter(x => x !== 'backGestureEnabled');
  assert.deepEqual(types, ['requestReminderPermission', 'syncReminder'], 'permission requested, then synced');
  let sync = await lastSync(page);
  assert.deepEqual(Object.keys(sync).sort(), ['enabled', 'hour', 'minute', 'practicedToday', 'questions', 'type'], 'payload fields');
  assert.deepEqual({ enabled: sync.enabled, hour: sync.hour, minute: sync.minute, practicedToday: sync.practicedToday },
    { enabled: true, hour: 20, minute: 0, practicedToday: false }, 'enabled at the P18 default time, not practiced today');
  assert.equal(sync.questions.length, 8, 'today + the 7-day native window');
  assert.deepEqual(sync.questions.slice(0, 2).map(q => [q.day, q.targetCardKey]), [[fx.today, 'base:境'], [fx.tomorrow, 'base:鲜']],
    'today: longest overdue 境; tomorrow: 鲜 (due tomorrow, 写错过 first)');
  const q1 = sync.questions[1];
  assert.equal(q1.title, maskedTitle(xian), `tomorrow's title is the masked word + pinyin (${q1.title})`);
  assert.ok(!q1.title.includes('鲜') && q1.title.includes(xian.py), 'the answer char is not in the notification; the pinyin is');
  assert.equal(q1.body, '还记得这个字怎么写吗？点开试试。', 'body (X-REMIND.body)');
  assert.equal(sync.questions[0].title, maskedTitle(jing), 'today: 境');
  assert.ok(sync.questions.every(q => q.day && q.title && q.body && q.targetCardKey), 'no empty fields (native drops them)');

  step('changing the time re-syncs with the user time');
  await page.fill(topSel('settings-remind-time'), '21:15');
  await page.waitForFunction(() => {
    const s = window.__shiziTest.getState().settings;
    return s && s.remind && s.remind.hour === 21;
  });
  sync = await lastSync(page);
  assert.deepEqual([sync.hour, sync.minute, sync.questions[1].targetCardKey], [21, 15, 'base:鲜'], 'synced at 21:15, same questions');

  step('native reports granted → stored by the settings page, synced again');
  const before = (await nativeMessages(page, 'syncReminder')).length;
  assert.equal(await page.evaluate(() => window.shiziReminderStatus({ permission: 'granted' })), true, 'global returns true');
  await page.waitForFunction(() => window.__shiziTest.getState().settings.remind.permission === 'granted');
  assert.equal((await nativeMessages(page, 'syncReminder')).length, before + 1, 'one more sync after the permission changed');

  step('store change (a judged record today) → debounced resync with practicedToday=true');
  const n0 = (await nativeMessages(page, 'syncReminder')).length;
  await page.evaluate(r => {
    const st = window.__shiziTest.getState();
    const key = r.localDay.slice(0, 7);
    const records = { ...st.records, [key]: (st.records[key] || []).concat([r]) };
    window.__shiziTest.seed({ ...st, records });
  }, rec(50, '额', 'correct', fx.now));
  await page.waitForFunction(n => (window.__nativeMsgs || []).filter(m => m.type === 'syncReminder').length > n, n0);
  sync = await lastSync(page);
  assert.equal(sync.practicedToday, true, 'practicedToday after a judged record today');
  assert.deepEqual([sync.hour, sync.minute], [21, 15], 'still the user time');
  await page.waitForTimeout(400);
  assert.equal((await nativeMessages(page, 'syncReminder')).length, n0 + 1, 'debounced: exactly one resync');
}

// ------------------------------------------------------------------ 2 / 3

/** 模拟 Swift 冷启动：bridge.js 一把全局装到 window 上就立刻调用（此时 store / 界面都还没好）。 */
function coldStartScript(cardKey) {
  Object.defineProperty(window, 'shiziOpenReminderTarget', {
    configurable: true,
    get() { return undefined; },
    set(fn) {
      Object.defineProperty(window, 'shiziOpenReminderTarget', { value: fn, writable: true, configurable: true });
      window.__cold = { returned: fn(cardKey), readyAtCall: false };
      queueMicrotask(() => {
        const b = window.__shiziBridge;
        window.__cold.pending = b ? b.pending().map(p => [p.name, p.args[0]]) : null;
        window.__cold.readyAtCall = b ? b.isReady() : null;
      });
    },
  });
}

async function newNativePage(ctx) {
  const context = await ctx.page.context().browser().newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN' });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await installNativeStub(p);
  return { context, p, errors };
}

async function waitWriteB(p) {
  await p.waitForFunction(() => {
    const app = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return app && app.dataset.topScreen === 'write' && top && top.dataset.slot === 'B';
  });
  await waitNavIdle(p);
}

async function scenarioColdStart(page, ctx) {
  const { assert, step, baseURL } = ctx;
  step('cold-start deep link (no unfinished B): queued at import, replayed after markReady → B write page for 鲜');
  const { context, p, errors } = await newNativePage({ ...ctx, page });
  try {
    await bootTestHost(p, baseURL);
    await seedFixture(p, { settings: { remind: { enabled: true, hour: 8, minute: 30, permission: 'granted' } } });
    await p.addInitScript(coldStartScript, 'base:鲜');
    await p.reload();
    await p.waitForSelector('.sz-app');
    await waitWriteB(p);
    const cold = await p.evaluate(() => window.__cold);
    assert.equal(cold.returned, true, 'global existed at import and returned true (received)');
    assert.equal(cold.readyAtCall, false, 'called before the bridge was ready');
    assert.deepEqual(cold.pending, [['shiziOpenReminderTarget', 'base:鲜']], 'queued until markReady');
    const st = await state(p);
    assert.deepEqual(st.sessions.B.queue, ['base:鲜'], 'B = 鲜 (P47 picked)');
    assert.deepEqual(st.sessions.B.source, { view: 'reminder', char: '鲜' }, 'source = reminder');
    assert.equal(st.sessions.A, null, 'A untouched');
    assert.deepEqual(await p.evaluate(() => window.__shiziBridge.pending()), [], 'queue drained');
    const types = (await nativeMessages(p)).map(m => m.type);
    assert.ok(types.includes('queryReminderStatus'), 'reminder on at launch → queryReminderStatus');
    const sync = (await nativeMessages(p, 'syncReminder')).pop();
    assert.ok(sync && sync.enabled && sync.hour === 8 && sync.minute === 30, 'reminder on at launch → syncReminder with the stored time');
    assert.deepEqual(errors, [], 'no pageerror / console.error');
  } finally {
    await context.close();
  }

  step('cold-start deep link with an unfinished B → S02; 结束那组，开新的 → B = 额; warm link → S02 again, 接着写那组');
  const second = await newNativePage({ ...ctx, page });
  try {
    const q = second.p;
    await bootTestHost(q, baseURL);
    const old = makeSession({ id: 's77', slot: 'B', kind: 'picked', chars: ['境', '鲜'], at: Date.now() - 3600 * 1000 });
    await seedFixture(q, { sessions: { A: null, B: old, lastEnded: {} } });
    await q.addInitScript(coldStartScript, 'base:额');
    await q.reload();
    await q.waitForSelector(topSel('s02-dialog'));
    await waitNavIdle(q);
    const body = await q.textContent(tid('s02-body'));
    assert.ok(body.includes('「境」') && body.includes('「鲜」'), `S02 lists the unwritten chars of the old B (${body})`);
    assert.deepEqual((await state(q)).sessions.B.queue, ['base:境', 'base:鲜'], 'nothing written before choosing');
    await q.click(tid('s02-end-start'));
    await waitWriteB(q);
    let st = await state(q);
    assert.deepEqual(st.sessions.B.queue, ['base:额'], 'new B = 额');
    assert.deepEqual(st.sessions.B.source, { view: 'reminder', char: '额' }, 'source = reminder');

    const warm = await q.evaluate(() => window.shiziOpenReminderTarget('base:境'));
    assert.equal(warm, true, 'warm link: delivered immediately (bridge ready)');
    await q.waitForSelector(topSel('s02-dialog'));
    await waitNavIdle(q);
    await q.click(tid('s02-continue'));
    await waitWriteB(q);
    st = await state(q);
    assert.deepEqual(st.sessions.B.queue, ['base:额'], '接着写那组 → still 额');
    assert.equal(await q.evaluate(() => window.shiziOpenReminderTarget('base:鲜鲜')), true, 'bad key: still received');
    await q.waitForTimeout(300);
    assert.deepEqual((await state(q)).sessions.B.queue, ['base:额'], 'bad key opens nothing');
    assert.deepEqual(second.errors, [], 'no pageerror / console.error');
  } finally {
    await second.context.close();
  }
}

// ------------------------------------------------------------------ 4

async function hapticsSince(page, n0) {
  const msgs = await nativeMessages(page);
  return msgs.slice(n0).filter(m => m.type === 'haptic' || m.type === 'sound').map(m => `${m.type}:${m.kind}`);
}

async function scenarioFeedback(page, ctx) {
  const { assert, step } = ctx;
  step('haptics / sounds at the points (judge j1, answer, trace, trace stroke silent, result seal s1)');
  await page.evaluate(() => window.__shiziTest.reset());
  const session = makeSession({ id: 's5', slot: 'A', kind: 'daily', chars: ['永', '和'] });
  const seeded = await page.evaluate(s => window.__shiziTest.seed({ sessions: { A: s, B: null, lastEnded: {} } }), session);
  assert.ok(seeded && seeded.ok, 'seeded a two-char group');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await waitNavIdle(page);
  await page.evaluate(async () => {
    const { openWrite } = await import('/src/ui/screens/session/index.js');
    openWrite('A');
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);

  let n0 = (await nativeMessages(page)).length;
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await waitNavIdle(page);
  assert.deepEqual(await hapticsSince(page, n0), [], 'drawing / entering compare: no feedback');
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '1');
  assert.deepEqual(await hapticsSince(page, n0), ['haptic:stamp', 'sound:j1_page_settle'], 'judge: haptic stamp + j1 page-settle (P24 / P200)');
  await waitNavIdle(page);

  n0 = (await nativeMessages(page)).length;
  await tap(page, 'write-show-answer');
  await page.waitForSelector(topSel('write-answer-trace'));
  await waitNavIdle(page);
  assert.deepEqual(await hapticsSince(page, n0), ['haptic:action'], '看答案: action');
  n0 = (await nativeMessages(page)).length;
  await page.click(topSel('write-answer-trace'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase === 'trace');
  await waitNavIdle(page);
  assert.deepEqual(await hapticsSince(page, n0), ['haptic:select'], '描一遍: select');
  n0 = (await nativeMessages(page)).length;
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await drawStroke(page, [[0.5, 0.2], [0.5, 0.8]]);
  assert.deepEqual(await hapticsSince(page, n0), [], 'trace strokes are silent (D50 ⑦: no writing / tracing sound)');

  n0 = (await nativeMessages(page)).length;
  await tap(page, 'write-answer-next');
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  assert.deepEqual((await hapticsSince(page, n0)).sort(), ['haptic:seal', 'sound:s1_wood_muted'], 'last char done → result page: the rigid seal haptic + the seal sound (once, same frame; C3-R)');
  assert.equal(await topScreen(page), 'result', 'on the result page');

  step('key sound off (settings.sound=false): judge gives the haptic only');
  await page.evaluate(() => window.__shiziTest.reset());
  const s2 = makeSession({ id: 's6', slot: 'A', kind: 'daily', chars: ['永', '和'] });
  await page.evaluate(s => window.__shiziTest.seed({ sessions: { A: s, B: null, lastEnded: {} }, settings: { sound: false } }), s2);
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await waitNavIdle(page);
  await page.evaluate(async () => {
    const { openWrite } = await import('/src/ui/screens/session/index.js');
    openWrite('A');
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  n0 = (await nativeMessages(page)).length;
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-wrong'));
  await waitNavIdle(page);
  await page.click(topSel('write-judge-wrong'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '1');
  assert.deepEqual(await hapticsSince(page, n0), ['haptic:stamp'], 'no key sound when 按键音 is off');
  await page.evaluate(() => window.__shiziTest.reset());
}

export default async function reminderSpec(page, ctx) {
  await scenarioSettings(page, ctx);
  await scenarioColdStart(page, ctx);
  await scenarioFeedback(page, ctx);
}
