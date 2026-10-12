// 阶段 1 P1-E5：首页（首次打开 + 日常五态）与首练结果页（设计稿「首练与首页」；D28 D35 D38 D40 D41 D43 D46）。
// H2（D55，首页改为方向 E「极静」）：首页五态的断言按 E 改写——首页只有日期、墨「拾」、竖排题记、「自己选字」与主按钮，没有字帖行 / 最近写的字 / 进行中格子 / 数字 / 标题（版式、六态、浅深、AX 的量测在 99-h2-home-e / 99-h2-home-e-ax）；
// 这里留下首次打开、首练到结果页、提醒邀请，以及五态判定（按钮字、特别组顺延、离开一周）的断言。
//
// 场景：
//   1. 首次打开：书家「拾」占位 + 竖排题跋 + 印；没有日期 / 标题 / 题记；主按钮「开始写字」+ 下一行；隐藏「自己选字」（D46 ②）；
//      品牌时刻（?brand=1 才放）：逐字淡入、点任意处立即静帧、到时自己停；「减少动态效果」直接静帧；测试宿主默认静帧。
//   2. 首练三字（真实写字页：尴 写对 → 赢 写错 → 拾 写对）→ 结果页：标题「这三个字，很多人提笔就忘。」、没有「这次记录了 N 个字」、复现句
//      （E9c / D48：FSRS 实际到期的「N 天后再见」，天数相同的字合并）、写错字「放进图里」入口（放进去后这一行消失，拿出来在分享弹层）、提醒邀请
//      （约 600ms 后淡入，点「好」才请求系统权限、改时间、点「不用了」收起）、底栏只有「再写一组」（出口是页头左上「×」，D49 ③）；首练完成后首页出现「自己选字」。
//   3. 提醒邀请最多两次：首练页问一次 → 没回应、再写一组 → 下一次结果页再问一次 → 第三次不问；「不用了」之后不再问；系统拒绝（原生回 denied）
//      → 一行说明、不再问。
//   4. 首页五态各一（setClock + seed）：今天还没写 / 今天写过（写错的字也不画朱点，D46 ①）/ 进行中（没写的格子不露字）/ 大写数字特别组那天
//      （「这次先写平常的字」顺延，D46 ④，第二天回来）/ 离开 ≥7 天回来；五态里日期、标题、题记、主按钮的位置不动。
//   5. 375×667 与 390×844 的首练结果页（R2-R1 / N2-04 / N2-05 / I2-07）：邀请没回答前吸底栏就是「好 / 不用了」，整个在首屏内；回答后「完成」+ 文字按钮「再写一组」。

import { PRESS_SETTLE_MS, bootTestHost, drawStroke, HORIZONTAL, installNativeStub, nativeMessages, tid, topSel, waitNavIdle, leaveResult } from './helpers.mjs';

/** 页面里造数：entries（每条一个独立会话 = 一组一个字）→ group（保留在槽里的组）→ settings → setClock → seed。 */
const SEED_FN = `async (spec) => {
  const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
  const { createSession } = await import('/src/core/sessions.js');
  const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
  let n = 100; const nextId = p => p + (n += 1);
  const strokes = [
    [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 168, t: 60 }, { x: 290, y: 172, t: 120 }]],
    [[{ x: 60, y: 120, t: 0 }, { x: 170, y: 118, t: 60 }, { x: 290, y: 122, t: 120 }], [{ x: 172, y: 50, t: 300 }, { x: 170, y: 170, t: 360 }, { x: 174, y: 300, t: 420 }]],
    [[{ x: 70, y: 70, t: 0 }, { x: 170, y: 170, t: 60 }, { x: 290, y: 290, t: 120 }], [{ x: 290, y: 70, t: 250 }, { x: 180, y: 180, t: 310 }, { x: 70, y: 290, t: 370 }]],
  ];
  (spec.entries || []).forEach((e, i) => {
    const at = Date.parse(e.at);
    draft.sessions.A = createSession({ id: nextId('s'), kind: e.kind || 'daily', source: { view: 'home' }, queue: ['base:' + e.char], at });
    const out = judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + e.char, judgment: e.judgment || 'correct', strokes: strokes[i % strokes.length], at, nextId });
    if (e.noInk) { // 这条记录没有留下本人笔迹（被回收 / 旧数据）
      const month = out.record.localDay.slice(0, 7);
      if (draft.ink[month]) delete draft.ink[month][out.record.inkId || out.record.id];
    }
  });
  draft.sessions = { A: null, B: null, lastEnded: {} };
  for (const g of spec.groups || []) {
    const at = Date.parse(g.at);
    const s = createSession({ id: nextId('s'), kind: g.kind || 'daily', source: { view: 'home' }, queue: g.chars.map(c => 'base:' + c), at });
    draft.sessions[g.slot || 'A'] = s;
    (g.steps || []).forEach((step, i) => {
      judgeInDraft(draft, { slot: g.slot || 'A', cardKey: 'base:' + g.chars[i], judgment: step, strokes: strokes[(i + 1) % strokes.length], at: at + i * 1000, nextId });
    });
  }
  if (spec.settings) draft.settings = spec.settings;
  window.__shiziTest.reset();
  window.__shiziTest.setClock(spec.clock);
  const r = window.__shiziTest.seed(draft);
  return { ok: !!(r && r.ok), r };
}`;

const D = n => `2026-10-${String(n).padStart(2, '0')}`;

async function seedWorld(page, spec) {
  const res = await page.evaluate(`(${SEED_FN})(${JSON.stringify(spec)})`);
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(day => {
    const el = document.querySelector('.sz-layer [data-testid="screen-home"], [data-testid="screen-home"]');
    return !!el && el.dataset.today === day;
  }, spec.clock.slice(0, 10));
  await waitNavIdle(page, { settleMs: 200 });
}

async function goHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

/** 首页快照（顶层图层里的首页）。 */
async function homeView(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer [data-testid="screen-home"]');
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const txt = id => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null);
    const rect = id => { const e = q(id); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const zhu = (() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--zhu)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    })();
    const reds = [...root.querySelectorAll('*')].filter(e => {
      if (e.closest('.sz-home__seal')) return false; // 印章用 --seal，不是写错的朱点
      return [getComputedStyle(e).backgroundColor, getComputedStyle(e, '::before').backgroundColor, getComputedStyle(e, '::after').backgroundColor].includes(zhu);
    }).length;
    return {
      view: root.dataset.view, hero: root.dataset.hero, brand: root.dataset.brand, records: root.dataset.records, resume: root.dataset.resume,
      date: txt('home-date'), title: txt('home-title'), epigraph: !!q('home-epigraph'), cta: txt('home-start'), firstTip: txt('home-first-tip'),
      pick: txt('home-pick'), defer: txt('home-capital-defer'), seals: root.querySelectorAll('.sz-home__seal').length,
      brandShi: q('home-brand-shi') ? q('home-brand-shi').getAttribute('aria-label') : null, brandShiSvg: q('home-brand-shi') ? q('home-brand-shi').querySelectorAll('svg path').length : 0, brandShiText: q('home-brand-shi') ? q('home-brand-shi').textContent.trim() : null, motto: q('home-motto') ? q('home-motto').getAttribute('aria-label') : null,
      todayCount: txt('home-today-count'), otherLine: txt('other-line'),
      removedNodes: ['home-library-link', 'home-last-row', 'home-last-label', 'home-last-item', 'resume-line', 'home-capital-lead', 'home-back-old'].filter(id => !!q(id)),
      // 首页上所有可见文字（不含 aria-hidden 的题记与格内图形）：用来证明没有计数、没有「昨天写的字」
      visibleText: [...root.querySelectorAll('*')].filter(e => e.children.length === 0 && !e.closest('[aria-hidden="true"]') && e.checkVisibility()).map(e => e.textContent.trim()).filter(Boolean).join(' | '),
      epiText: q('home-epigraph') ? q('home-epigraph').textContent.replace(/\s+/g, ' ').trim() : null,
      capBody: txt('home-capital-body'), backNote: txt('home-back-note'),
      startRect: rect('home-start'), titleRect: rect('home-title'), dateRect: rect('home-date'), epiRect: rect('home-epigraph'),
      reds,
    };
  });
}

async function stateOf(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function waitWrite(page) {
  await page.waitForSelector(topSel('write-screen'));
  await page.waitForFunction(() => { const w = document.querySelector('.sz-layer[data-top="true"] .sz-write'); return !!w && w.dataset.phase === 'recall'; });
  await waitNavIdle(page);
}

async function judgeLive(page, judgment, { last = false, cursor = 0 } = {}) {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel(`write-judge-${judgment}`));
  if (last) {
    await page.waitForSelector(topSel('result-screen'));
    return;
  }
  await page.waitForFunction(c => { const w = document.querySelector('.sz-layer[data-top="true"] .sz-write'); return !!w && w.dataset.cursor === String(c + 1) && w.dataset.phase === 'recall'; }, cursor);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function resultView(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const txt = id => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null);
    const body = q('result-body');
    const invite = q('result-invite');
    return {
      variant: body ? body.dataset.variant : null,
      title: txt('result-title'), titleSize: q('result-title') ? parseFloat(getComputedStyle(q('result-title')).fontSize) : null,
      sub: txt('result-sub'), preview: txt('result-preview'), date: txt('result-date'),
      // P1-E7：作品里的格子（写对的字）；列数是作品的列数（3 字以内一行，4 字 2 × 2…）
      cells: top ? [...top.querySelectorAll('[data-testid="work-cell"]')].map(c => c.dataset.char + ':' + c.dataset.state) : [],
      cols: q('work') ? q('work').dataset.cols : null,
      exrows: top ? [...top.querySelectorAll('[data-testid="result-exrow"]')].map(r => ({ char: r.dataset.char, text: r.querySelector('.sz-exrow__t').textContent.trim(), btn: r.querySelector('[data-testid="result-add"]') ? r.querySelector('[data-testid="result-add"]').textContent.trim() : null, ink: !!r.querySelector('canvas') })) : [],
      invite: invite ? { state: invite.dataset.state, title: txt('result-invite-title'), body: txt('result-invite-body'), accepted: txt('result-invite-accepted'), denied: txt('result-invite-denied'), yes: txt('result-invite-yes'), no: txt('result-invite-no'), time: txt('result-invite-time'),
        blank: (() => { const b = q('result-invite-blank'); if (!b) return null; const cs = getComputedStyle(b); const fs = parseFloat(getComputedStyle(b.parentElement).fontSize); const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), role: b.getAttribute('role'), text: b.textContent, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, wEm: r.width / fs, hEm: r.height / fs }; })() } : null,
      foot: top ? [...top.querySelectorAll('.sz-page__foot button')].map(b => b.dataset.testid + ':' + b.textContent.trim()) : [],
    };
  });
}

async function waitInvite(page, state = 'invite') {
  await page.waitForSelector(`${topSel('result-invite')}[data-state="${state}"]`, { timeout: 4000 });
}

function approx(a, b, tol = 1) {
  return Math.abs(a - b) <= tol;
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await installNativeStub(page);

  // ------------------------------------------------------------------ 1. 首次打开
  step('首次打开: 书家「拾」占位 + 竖排题跋 + 印；没有日期 / 标题 / 题记；开始写字 + 一行说明；没有「自己选字」');
  await bootTestHost(page, ctx.baseURL);
  let h = await homeView(page);
  assert.equal(h.view, 'first', 'view = first');
  assert.equal(h.brandShi, '拾', 'brand 「拾」 in the copybook slot (read-aloud name)');
  assert.equal(h.brandShiSvg, 9, 'brand 「拾」 is the 9-stroke vector mark (ui/brand/shi.js), not a text node');
  assert.equal(h.brandShiText, '', 'brand 「拾」 draws no text (no font glyph)');
  assert.equal(h.motto, '提笔忘字，不是忘了，只是很久没写。', 'motto (vertical, three columns)');
  assert.equal(h.cta, '开始写字');
  assert.equal(h.firstTip, '先写三个大家常忘的字。');
  assert.equal(h.pick, null, 'D46 ②: no 自己选字 on first open');
  assert.deepEqual([h.date, h.title, h.epigraph], [null, null, false], 'no date / title / epigraph on first open');
  assert.equal(h.seals, 1, 'one seal');
  assert.equal(h.reds, 0, 'no red dot');
  const mottoTag = await page.evaluate(() => { const m = document.querySelector('[data-testid="home-motto"]'); return { tag: m.tagName, pageTitle: m.hasAttribute('data-page-title'), writing: getComputedStyle(m.querySelector('.sz-first__col')).writingMode, text: [...m.querySelectorAll('.sz-first__col')].map(c => (c.querySelector('.sz-first__line') || c).textContent.trim()) }; });
  assert.deepEqual(mottoTag, { tag: 'H1', pageTitle: true, writing: 'vertical-rl', text: ['提笔忘字，', '不是忘了，', '只是很久没写。'] }, 'motto is the page heading, three vertical columns, 右列先读');
  assert.equal(h.brand, 'off', 'test host: no brand animation unless ?brand=1');
  const noText = await page.evaluate(() => /TODO|占位/.test(document.querySelector('[data-testid="screen-home"]').textContent));
  assert.equal(noText, false, 'no TODO / 占位 wording shown to the user');
  const firstCta = h.startRect;

  step('品牌时刻: ?brand=1 才放；逐字淡入；点任意处立即静帧；到时（≤1.85s）自己停；减少动态效果直接静帧');
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL, { query: 'brand=1' });
  h = await homeView(page);
  assert.equal(h.brand, 'playing', 'brand moment playing');
  const anim = await page.evaluate(() => ({ n: document.getAnimations().length, op: getComputedStyle(document.querySelector('.sz-first__ch')).opacity }));
  assert.ok(anim.n >= 17, `per-character fade animations running (${anim.n})`);
  await page.mouse.click(30, 120);
  await page.waitForFunction(() => document.querySelector('[data-testid="screen-home"]').dataset.brand === 'off');
  const stopped = await page.evaluate(() => ({ n: document.getAnimations().length, op: getComputedStyle(document.querySelector('.sz-first__ch')).opacity, foot: getComputedStyle(document.querySelector('.sz-home__foot')).opacity }));
  assert.deepEqual(stopped, { n: 0, op: '1', foot: '1' }, 'a tap jumps to the still frame (interruptible)');
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL, { query: 'brand=1' });
  await page.waitForTimeout(2100);
  h = await homeView(page);
  assert.equal(h.brand, 'off', 'ends by itself within 1.85s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL, { query: 'brand=1' });
  h = await homeView(page);
  assert.equal(h.brand, 'off', 'prefers-reduced-motion: the still frame right away');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no animations under reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 2. 首练三字 → 结果页
  step('首练三字: 尴 写对 → 赢 写错 → 拾 写对（真实写字页），进度 1 / 3');
  await page.evaluate(() => { window.__shiziTest.reset(); window.__shiziTest.setClock('2026-10-05T09:41:00'); });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);
  await page.click(tid('home-start'));
  await waitWrite(page);
  const progress = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="write-progress"]').textContent);
  assert.equal(progress, '1 / 3');
  await judgeLive(page, 'correct', { cursor: 0 });
  await judgeLive(page, 'wrong', { cursor: 1 });
  await judgeLive(page, 'correct', { last: true });
  await waitNavIdle(page, { settleMs: 100 });

  step('首练结果页: 标题不以计数作标题；复现句「N 天后再见」；写错字「放进图里」；提醒邀请约 600ms 后淡入，点「好」前没有系统权限请求');
  let r = await resultView(page);
  assert.equal(r.variant, 'first');
  assert.equal(r.title, '这三个字，很多人提笔就忘。', 'C3-H / N3-07 (D53): the title is fixed — the three chars of the first practice (the work holds two, the signature says so), D28: it is not a headline count');
  assert.equal(r.titleSize, 22, 'title is 宋 22 (design §三)');
  assert.ok(!/记录了/.test(r.title) && r.sub === null, 'no 「这次记录了 N 个字」 and no sentence under the title');
  assert.deepEqual(r.cells, ['尴:in', '拾:in'], 'P1-E7: the work holds the right chars only (赢 was wrong → not in by default, it is the row below)');
  assert.equal(r.cols, '2', 'two chars in the work → one row of two (the same layout function as the share image)');
  const st1 = await stateOf(page);
  const todayKey = '2026-10-05';
  const dueGap = key => Math.round((Date.parse(`${st1.sched[key].due}T12:00:00`) - Date.parse(`${todayKey}T12:00:00`)) / 86400000);
  // E9c（D48）：复现句 =「N 天后再见」，天数相同的字合并成一个分句，近 → 远；所有字同一天只写「N 天后再见。」
  const daysText = n => (n <= 1 ? '明天再见' : `${n} 天后再见`);
  const byDays = new Map();
  for (const [c, k] of [['赢', 'base:赢'], ['尴', 'base:尴'], ['拾', 'base:拾']]) {
    const n = Math.max(1, dueGap(k));
    byDays.set(n, [...(byDays.get(n) || []), c]);
  }
  const groups = [...byDays.entries()].sort((x, y) => x[0] - y[0]);
  // C3-H / D53 ④：首练三个字都写对（含「拾」）→ 复现句前多一句与首页格下同一句的「你写下的第一个「拾」。」
  const expectedPreview = '你写下的第一个「拾」。' + (groups.length === 1
    ? `${daysText(groups[0][0])}。`
    : groups.map(([n, cs]) => `${cs.map(c => `「${c}」`).join('')}${daysText(n)}`).join('，') + '。');
  assert.equal(r.preview, expectedPreview, `preview from the real FSRS due days (${JSON.stringify(Object.fromEntries(['尴', '赢', '拾'].map(c => [c, st1.sched['base:' + c].due])))})`);
  assert.ok(r.preview.startsWith('你写下的第一个「拾」。「赢」明天再见'), 'the 拾 sentence, then the wrong one comes back first: ' + r.preview);
  assert.ok(!/再来|找你/.test(r.preview), 'no 「再来找你」 any more');
  assert.ok(st1.sched['base:赢'].due > todayKey, '赢 due is after today');
  assert.deepEqual(r.exrows, [{ char: '赢', text: '写错了', btn: '放进图里', ink: true }], 'wrong char with ink: the status word + 放进图里 (the char is the glyph on the left, not in the sentence; D49)');
  assert.equal(r.invite, null, 'the invitation has not faded in yet (≈600ms after the work settles)');
  assert.equal((await nativeMessages(page, 'requestReminderPermission')).length, 0, 'no permission request before 好');
  assert.deepEqual(r.foot, ['result-done:完成', 'result-again:再写一组'], 'I3 P0-03: the sticky footer is 完成 + 再写一组 before, while and after the invitation (it never blocks the main actions)');
  await waitInvite(page);
  r = await resultView(page);
  assert.equal(r.invite.title, '明天这个时候，给你一个词？', 'time 9:41 is inside 7:00–22:00');
  assert.ok(/^锁屏上只出现词语和拼音，比如「.+（.+）」，你先在心里写一遍。$/.test(r.invite.body), 'example from the first char, same shape as the lock screen 「词语（拼音）」: ' + r.invite.body);
  assert.ok(r.invite.body.includes('尬（gān）') && !r.invite.body.includes('□') && !r.invite.body.includes('＿'), 'example is 尴 masked: an outlined box (no text glyph) + 尬（gān） (N2-13, D53)');
  assert.ok(r.invite.blank && r.invite.blank.text === '' && r.invite.blank.border === '1px solid', `the masked char is an outlined box (1pt frame), not a glyph: ${JSON.stringify(r.invite.blank)}`);
  assert.ok(Math.abs(r.invite.blank.wEm - 0.9) < 0.03 && Math.abs(r.invite.blank.hEm - 0.9) < 0.03, `0.9em square (${r.invite.blank.wEm.toFixed(2)} × ${r.invite.blank.hEm.toFixed(2)})`);
  assert.deepEqual([r.invite.blank.role, r.invite.blank.label], ['img', '空着的字'], 'read aloud as 空着的字');
  assert.deepEqual([r.invite.yes, r.invite.no], ['好，明天给我一个词', '先不用'], 'the buttons say what happens (C3-H / T3-12, D53)');
  let st = await stateOf(page);
  assert.equal(st.settings.remindInvite.shown, 1, 'counted when it appeared');
  assert.equal(st.settings.remindInvite.last, st.sessions.lastEnded.A.id, 'remembers the session it was shown on');
  assert.equal(st.settings.remindInvite.answered, undefined);
  assert.equal((await nativeMessages(page, 'requestReminderPermission')).length, 0, 'still no permission request');
  const animName = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="result-invite"]')).animationName);
  assert.equal(animName, 'szInviteIn', 'fades in (not a modal)');
  assert.equal(await page.evaluate(() => !!document.querySelector('.sz-sheet, [role="dialog"]')), false, 'no dialog / sheet');

  step('写错字「放进图里」：写进本组会话（session.added，经 store.commit），作品按组内原位置重排并带朱点，这一行消失（阶段 1 P1-E7 / E9c，成员规则 D31）');
  await page.click(topSel('result-add'));
  r = await resultView(page);
  assert.deepEqual(r.exrows, [], 'the row goes away once the char is in the picture');
  assert.deepEqual(r.cells, ['尴:in', '赢:added', '拾:in'], '赢 is in the work in its original place (尴 赢 拾)');
  const members = await page.evaluate(() => window.__shiziTest.getState().sessions.lastEnded.A.added);
  assert.equal(members.length, 1, 'one member recorded on the session');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  // 拿出来：分享弹层「也放进来」里的 chip（结果页的行已经没有了）
  await page.click(topSel('result-share'));
  await page.waitForSelector('[data-testid="image-chip"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click('[data-testid="image-chip"]');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.lastEnded.A.added.length === 0);
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);
  r = await resultView(page);
  assert.deepEqual([r.exrows.length, r.cells], [1, ['尴:in', '拾:in']], 'taking it out of the picture (share sheet chip) brings the row back');

  step('点「好」: 才请求系统权限；一次 commit 开提醒（9:30）；一行「好，明天 9:30 给你一个词。」；改时间');
  await page.evaluate(() => { window.__nativeMsgs.length = 0; });
  await page.click(topSel('result-invite-yes'));
  // Q2-5（复测 simB D6）：系统权限弹窗还没回应时不能先写「好，明天…」——先是等待态（块保持原状、按钮不可再点），原生回报授权结果后才换成文案。
  await waitInvite(page, 'pending');
  r = await resultView(page);
  assert.equal(r.invite.accepted, null, 'no 「好，明天…」 before the system answers');
  assert.equal(r.invite.title, '明天这个时候，给你一个词？', 'the block keeps its look while waiting');
  assert.equal(await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="result-invite-yes"]').disabled), true, 'buttons are disabled while waiting');
  st = await stateOf(page);
  assert.deepEqual([st.settings.remind.enabled, st.settings.remind.hour, st.settings.remind.minute, st.settings.remindInvite.answered], [true, 9, 30, 'yes']);
  const msgs = (await nativeMessages(page)).map(m => m.type).filter(x => !['backGestureEnabled', 'haptic', 'sound'].includes(x));
  assert.deepEqual(msgs, ['requestReminderPermission', 'syncReminder'], 'permission requested only now, then synced');
  await page.evaluate(() => window.shiziReminderStatus({ permission: 'granted' }));
  await waitInvite(page, 'accepted');
  r = await resultView(page);
  assert.equal(r.invite.accepted, '好，明天 9:30 给你一个词。');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('result-invite-time'));
  await page.fill(topSel('result-invite-time-input'), '21:15');
  await page.waitForFunction(() => /21:15/.test(document.querySelector('.sz-layer[data-top="true"] [data-testid="result-invite-accepted"]').textContent));
  st = await stateOf(page);
  assert.deepEqual([st.settings.remind.hour, st.settings.remind.minute], [21, 15], '改时间 writes settings.remind');
  const sync = (await nativeMessages(page, 'syncReminder')).pop();
  assert.deepEqual([sync.enabled, sync.hour, sync.minute], [true, 21, 15], 'synced with the new time');

  step('再写一组: 主按钮 → 新的今天的练习；首练完成后首页出现「自己选字」');
  await page.click(topSel('result-again'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  await waitNavIdle(page);
  st = await stateOf(page);
  assert.ok(st.sessions.A && st.sessions.A.kind === 'daily', 'a daily group started');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  h = await homeView(page);
  assert.equal(h.pick, '自己选字', 'after the first practice 自己选字 is there (D46 ②)');

  // ------------------------------------------------------------------ 3. 邀请次数
  step('提醒邀请最多两次: 首练页一次（没回应）→ 下一次「今天的练习」结果页再一次 → 第三次不问');
  async function dailyResultVia(page) {
    // seed 一个只有 1 个字的今天的练习（settings 保留），写完直接进结果页
    await goHome(page);
    const state = await stateOf(page);
    await page.evaluate(async ({ settings }) => {
      const { createSession } = await import('/src/core/sessions.js');
      const now = window.__shiziTest.now();
      const s = createSession({ id: 's' + (800 + Math.floor(Math.random() * 90)), kind: 'daily', source: { view: 'home' }, queue: ['base:酱'], at: now });
      const cur = window.__shiziTest.getState();
      const r = window.__shiziTest.seed({ ...cur, sessions: { A: s, B: null, lastEnded: {} }, settings });
      if (!r.ok) throw new Error('seed');
    }, { settings: state.settings });
    await page.evaluate(async () => (await import('/src/ui/screens/session/index.js')).openWrite('A'));
    await waitWrite(page);
    await judgeLive(page, 'correct', { last: true });
    await waitNavIdle(page, { settleMs: 100 });
  }
  await page.evaluate(() => { window.__shiziTest.reset(); window.__shiziTest.setClock('2026-10-05T09:41:00'); });
  // 造首练：真实流程太长，直接 seed 一个差最后一字的首练（尴 赢 已判断），再写拾
  await page.evaluate(`(${SEED_FN})(${JSON.stringify({ entries: [], groups: [{ at: `${D(5)}T09:00:00`, kind: 'first', chars: [...'尴赢拾'], steps: ['correct', 'wrong'] }], clock: `${D(5)}T09:41:00` })})`);
  await goHome(page);
  await page.evaluate(async () => (await import('/src/ui/screens/session/index.js')).openWrite('A'));
  await waitWrite(page);
  await judgeLive(page, 'correct', { last: true });
  await waitInvite(page);
  st = await stateOf(page);
  assert.equal(st.settings.remindInvite.shown, 1, 'first ask');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  st = await stateOf(page);
  assert.equal(st.settings.remindInvite.answered, undefined, 'leaving without answering is not an answer');
  await dailyResultVia(page);
  await waitInvite(page);
  st = await stateOf(page);
  assert.equal(st.settings.remindInvite.shown, 2, 'second (last) ask on the next result page');
  r = await resultView(page);
  assert.equal(r.variant, 'daily');
  assert.equal(r.invite.title, '明天这个时候，给你一个词？');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await dailyResultVia(page);
  await page.waitForTimeout(1300);
  r = await resultView(page);
  assert.equal(r.invite, null, 'a third result page never asks');
  st = await stateOf(page);
  assert.equal(st.settings.remindInvite.shown, 2, 'still two');
  assert.equal(st.settings.remind, undefined, 'never turned on by itself');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);

  step('「不用了」之后不再问；系统拒绝（原生回 denied）→ 一行说明、不再问');
  await page.evaluate(() => { window.__shiziTest.reset(); window.__shiziTest.setClock('2026-10-05T09:41:00'); });
  await page.evaluate(`(${SEED_FN})(${JSON.stringify({ entries: [], groups: [{ at: `${D(5)}T09:00:00`, kind: 'first', chars: [...'尴赢拾'], steps: ['correct', 'wrong'] }], clock: `${D(5)}T09:41:00` })})`);
  await goHome(page);
  await page.evaluate(async () => (await import('/src/ui/screens/session/index.js')).openWrite('A'));
  await waitWrite(page);
  await judgeLive(page, 'correct', { last: true });
  await waitInvite(page);
  await page.click(topSel('result-invite-no'));
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="result-invite"]'));
  st = await stateOf(page);
  assert.equal(st.settings.remindInvite.answered, 'no');
  assert.equal(st.settings.remind, undefined, '不用了 does not turn the reminder on');
  assert.equal((await nativeMessages(page, 'requestReminderPermission')).length, 1, 'only the earlier 好 requested permission (page-level stub keeps the log)');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await dailyResultVia(page);
  await page.waitForTimeout(1300);
  r = await resultView(page);
  assert.equal(r.invite, null, 'after 不用了 the next result page does not ask');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);

  await page.evaluate(() => { window.__shiziTest.reset(); window.__shiziTest.setClock('2026-10-05T23:40:00'); });
  await page.evaluate(`(${SEED_FN})(${JSON.stringify({ entries: [], groups: [{ at: `${D(5)}T23:00:00`, kind: 'first', chars: [...'尴赢拾'], steps: ['correct', 'wrong'] }], clock: `${D(5)}T23:40:00` })})`);
  await goHome(page);
  await page.evaluate(async () => (await import('/src/ui/screens/session/index.js')).openWrite('A'));
  await waitWrite(page);
  await judgeLive(page, 'correct', { last: true });
  await waitInvite(page);
  r = await resultView(page);
  assert.equal(r.invite.title, '明天晚上八点半，给你一个词？', '23:40 is outside 7:00–22:00 → 20:30 wording');
  await page.click(topSel('result-invite-yes'));
  await waitInvite(page, 'pending');
  r = await resultView(page);
  assert.equal(r.invite.accepted, null, 'Q2-5: nothing claimed while the system dialog is up');
  await page.evaluate(() => window.shiziReminderStatus({ permission: 'denied' }));
  await waitInvite(page, 'denied');
  r = await resultView(page);
  assert.equal(r.invite.denied, '没打开通知。想要提醒，可以在手机设置里打开。');
  st = await stateOf(page);
  assert.equal(st.settings.remindInvite.answered, 'denied');
  assert.equal(st.settings.remind.permission, 'denied');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await dailyResultVia(page);
  await page.waitForTimeout(1300);
  r = await resultView(page);
  assert.equal(r.invite, null, 'after a system denial it never asks again on result pages');
  await leaveResult(page);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 4. 首页五态
  const rects = {};
  const check = (name, view) => { rects[name] = { start: view.startRect, date: view.dateRect }; };
  const dayCells = chars => chars.map((c, i) => ({ char: c, at: `${D(4)}T20:0${i}:00` }));

  step('五态 ①今天还没写: 「拾」+ 竖排题记，没有字帖行 / 昨天写的字（D55）；题记两列 + 作者、不带印；按钮「开始写字」；有「自己选字」');
  await seedWorld(page, { entries: dayCells([...'疆酱肆酝春']), clock: `${D(5)}T09:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.cta, h.pick, h.date], ['fresh', '开始写字', '自己选字', '10月5日 · 早上']);
  assert.equal(h.brandShi, '拾', 'D55: the ink 「拾」 is the everyday home hero (no frame)');
  assert.deepEqual(h.removedNodes, [], 'D49: no 「昨天写的字」 row, no library link, no resume line, no capital lead / back-old line in the DOM');
  // D55：首页没有任何计数，也没有「昨天写的字。」（P266）
  assert.ok(!/上次写的字|字库里有|这一组|昨天写的字|今天写了/.test(h.visibleText) && !/\d/.test(h.visibleText.replace(/10月5日/, '')), `D55: nothing countable and no copybook caption is drawn: ${h.visibleText}`);
  assert.equal(h.reds, 0, 'no red dot');
  assert.equal(h.seals, 0, 'D49-1: the epigraph carries no seal — the everyday home has no red at all');
  assert.equal(h.epigraph, true);
  assert.ok(/^(心不厌精，手不忘熟。孙过庭|文章千古事，得失寸心知。杜甫|我书意造本无法，点画信手烦推求。苏轼)$/.test(h.epiText.replace(/\s/g, '')), `epigraph text = couplet + author only: ${h.epiText}`);
  check('fresh', h);
  step('①b 昨天没有、前几天（<7 天）写过: 仍是今天还没写，字帖位下仍没有「上次写的字」');
  await seedWorld(page, { entries: [...'疆酱'].map((c, i) => ({ char: c, at: `${D(1)}T20:0${i}:00` })), clock: `${D(5)}T09:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.removedNodes], ['fresh', []]);
  step('①c 昨天写的字都没有留下笔迹: 仍是今天还没写（「昨天写的字」那一行已整行删去，没有笔迹也不会再有占位）');
  await seedWorld(page, { entries: [{ char: '疆', at: `${D(4)}T20:00:00`, noInk: true }], clock: `${D(5)}T09:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.removedNodes], ['fresh', []]);

  step('五态 ②今天写过: 首页不放今天写的字（D55）；按钮「再写一组」；写错的字也不会在首页留下朱点（D46 ①）');
  await seedWorld(page, { entries: [...'疆酱肆酝'].map((c, i) => ({ char: c, at: `${D(5)}T08:0${i}:00`, judgment: i === 2 ? 'wrong' : 'correct' })), clock: `${D(5)}T12:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.cta, h.pick], ['today', '再写一组', '自己选字']);
  assert.equal(h.reds, 0, 'D46 ①: a wrong char is not marked with a red dot on the home page');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sz-layer [data-testid="screen-home"] [data-wrong]').length), 0, 'no wrong marker element');
  assert.deepEqual(h.removedNodes, [], 'no yesterday row, no library link');
  check('today', h);

  step('五态 ③有进行中的组: 按钮「继续写字」；首页不放这一组的格子，也不露还没写的字（D55）');
  await seedWorld(page, { entries: [], groups: [{ at: `${D(5)}T12:00:00`, chars: [...'疆嚷醋膝窗'], steps: ['correct', 'correct'] }], clock: `${D(5)}T12:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.cta, h.resume, h.pick], ['progress', '继续写字', 'A', '自己选字']);
  assert.ok(!/醋|膝|窗/.test(await page.evaluate(() => document.querySelector('.sz-layer [data-testid="screen-home"]').innerHTML)), 'the unwritten chars are nowhere in the home DOM');
  assert.ok(!/\d/.test(h.visibleText.replace(/10月5日/, '')) && !/这一组还有/.test(h.visibleText), `D55: no progress and no numbers on the page: ${h.visibleText}`);
  check('progress', h);
  step('③b A + B 都没写完: 主按钮续 B，主按钮上方一行文字按钮（无箭头，D49）续写 A（P269）');
  await seedWorld(page, {
    entries: [], clock: `${D(5)}T12:30:00`,
    groups: [{ at: `${D(5)}T12:00:00`, slot: 'B', kind: 'picked', chars: [...'鲜境'], steps: [] }, { at: `${D(5)}T12:00:00`, slot: 'A', kind: 'daily', chars: [...'一二三四五'], steps: ['correct'] }],
  });
  h = await homeView(page);
  assert.deepEqual([h.view, h.resume, h.cta, h.otherLine], ['progress', 'A+B', '继续写字', '今天的练习 · 接着写']);
  step('③c 首练写到一半: 仍没有「自己选字」');
  await seedWorld(page, { entries: [], groups: [{ at: `${D(5)}T12:00:00`, kind: 'first', chars: [...'尴赢拾'], steps: ['correct'] }], clock: `${D(5)}T12:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.pick, h.cta], ['progress', null, '继续写字']);

  step('五态 ④大写数字特别组那天: 一句提示；「自己选字」仍在，旁边文字按钮「这次先写平常的字」（D55 / P269，原来代替它）；点了顺延到下一个合适的日子');
  const history10 = ['09-28', '09-28', '09-29', '09-30', '10-01', '10-01', '10-02', '10-03', '10-04', '10-04'].map((d, i) => ({ char: String.fromCodePoint(0x6100 + i), at: `2026-${d}T20:0${i % 10}:00` }));
  await seedWorld(page, { entries: history10, clock: `${D(5)}T21:00:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.capBody, h.defer, h.pick, h.cta], ['special', '今天写两组大写数字，借条、红包上用得着。', '这次先写平常的字', '自己选字', '开始写字']);
  assert.deepEqual(h.removedNodes, [], 'the lead sentence node is gone');
  check('special', h);
  await page.click(tid('home-capital-defer'));
  // Q2-2（simB D3，交接 §1.2）：点了即开始一组普通练习（不再只顺延回首页）。旧断言「回到普通首页再点开始写字」改成「直接进写字页」。
  await waitWrite(page);
  st = await stateOf(page);
  assert.equal(st.settings.capitalDeferredDay, D(5), 'one store.commit: settings.capitalDeferredDay = today');
  assert.ok(st.sessions.A && st.sessions.A.kind === 'daily', 'a daily group started right away');
  assert.ok(st.sessions.A.queue.every(k => !'壹贰叁肆伍陆柒捌玖拾'.includes(k.slice(5))), 'today’s group is an ordinary one: ' + st.sessions.A.queue.join(','));
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await page.evaluate(() => { window.__shiziTest.setClock('2026-10-06T09:30:00'); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('.sz-layer [data-testid="screen-home"]').dataset.today === '2026-10-06');
  h = await homeView(page);
  assert.equal(h.view, 'special', 'the day after, yesterday’s unfinished ordinary group is gone (P37) and the special group is due again (D41 conditions hold)');
  st = await stateOf(page);
  assert.equal(st.sessions.A, null, 'yesterday’s unfinished daily group expired');
  assert.equal(st.settings.capitalDeferredDay, D(5), 'the deferral only covered the day it was tapped');
  step('④b 特别组那天已经写过字: 按钮「再写一组」，一句提示与「这次先写平常的字」仍在（D55）');
  await seedWorld(page, { entries: [...history10, { char: '壹', at: `${D(5)}T08:00:00` }], clock: `${D(5)}T21:00:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.cta, h.capBody, h.defer], ['special', '再写一组', '今天写两组大写数字，借条、红包上用得着。', '这次先写平常的字']);

  step('五态 ⑤离开 ≥7 天回来: 「拾」与题记下面一句「你写过的 N 个字都还在。」（D55，N = 5）；不提缺了几天');
  await seedWorld(page, { entries: [...'醋膝屉鼎窗'].map((c, i) => ({ char: c, at: `2026-09-2${i}T20:00:00` })), clock: `${D(14)}T09:30:00` });
  h = await homeView(page);
  assert.deepEqual([h.view, h.cta, h.pick, h.backNote], ['back', '开始写字', '自己选字', '你写过的 5 个字都还在。']);
  assert.deepEqual(h.removedNodes, [], 'no last-written row, no 「这一组先写写旧字。」');
  assert.ok(!/缺|断|好久不见|天没/.test(h.visibleText), 'does not mention how many days were missed: ' + h.visibleText);
  check('back', h);
  step('⑤b 正好 6 天不算回来（仍是今天还没写）');
  await seedWorld(page, { entries: dayCells([...'醋膝']).map(e => ({ ...e, at: e.at.replace(`${D(4)}`, D(1)) })), clock: `${D(7)}T09:30:00` });
  h = await homeView(page);
  assert.equal(h.view, 'fresh');

  step('位置不动: 日期与主按钮在五态里同一位置（首次打开只有主按钮）');
  for (const k of ['today', 'progress', 'special', 'back']) {
    assert.deepEqual([rects[k].start.x, rects[k].start.w, rects[k].start.h], [rects.fresh.start.x, rects.fresh.start.w, rects.fresh.start.h], `${k}: 主按钮横向位置与大小同 fresh`);
    assert.equal(rects[k].start.y, rects.fresh.start.y, `${k}: 主按钮在同一条底线上（C3-H / D53 ③）`);
    assert.deepEqual(rects[k].date, rects.fresh.date, `${k}: 日期位置同 fresh`);
  }
  assert.ok(approx(rects.fresh.start.w, 240) && approx(rects.fresh.start.h, 54), `main button 240 × 54 (D43): ${JSON.stringify(rects.fresh.start)}`);
  assert.ok(approx(rects.fresh.start.x + rects.fresh.start.w / 2, 393 / 2, 1), 'centred');
  assert.deepEqual([firstCta.x, firstCta.w, firstCta.h], [rects.fresh.start.x, rects.fresh.start.w, rects.fresh.start.h], 'first open: the main button has the same size and column');
  const panelBottom = await page.evaluate(() => document.querySelector('.sz-tabroot__panel').getBoundingClientRect().bottom);
  assert.ok(Math.abs(panelBottom - (rects.fresh.start.y + rects.fresh.start.h) - 24) <= 0.6, `main button's bottom is 24 above the tab bar (C3-H baseline): ${panelBottom - rects.fresh.start.y - rects.fresh.start.h}`);

  // ------------------------------------------------------------------ 5. 375×667 与 390×844：邀请的回答在首屏里完整可见（R2-R1 / N2-04 / N2-05 / I2-07）
  for (const [width, height] of [[375, 667], [390, 844]]) {
    step(`${width}×${height} 的首练结果页: 邀请没回答前吸底栏就是「好 / 不用了」，两个按钮整个在首屏内、没被盖住；回答后吸底栏是「完成」+ 文字按钮「再写一组」`);
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { window.__shiziTest.reset(); window.__shiziTest.setClock('2026-10-05T09:41:00'); });
    await page.evaluate(`(${SEED_FN})(${JSON.stringify({ entries: [], groups: [{ at: `${D(5)}T09:00:00`, kind: 'first', chars: [...'尴赢拾'], steps: ['correct', 'wrong'] }], clock: `${D(5)}T09:41:00` })})`);
    await goHome(page);
    await page.evaluate(async () => (await import('/src/ui/screens/session/index.js')).openWrite('A'));
    await waitWrite(page);
    await judgeLive(page, 'correct', { last: true });
    // 邀请出现之前（≈600ms）完成 / 再写一组就已经可点
    const early = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const el = top.querySelector('[data-testid="result-done"]'); const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { disabled: el.disabled, covered: !(hit === el || el.contains(hit)), invite: !!top.querySelector('[data-testid="result-invite-title"]') };
    });
    assert.deepEqual(early, { disabled: false, covered: false, invite: false }, `${width}×${height}: 完成 is tappable before the invitation fades in`);
    await waitInvite(page);
    await page.waitForFunction(() => { const e = document.querySelector('.sz-layer[data-top="true"] [data-testid="result-invite-actions"]'); return e && e.dataset.state === 'invite'; });
    await page.waitForTimeout(350);
    const asked = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const box = id => { const el = top.querySelector(`[data-testid="${id}"]`); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, disabled: el.disabled, covered: !(hit === el || el.contains(hit)) }; };
      return { yes: box('result-invite-yes'), no: box('result-invite-no'), done: box('result-done'), again: box('result-again'), vh: window.innerHeight, vw: window.innerWidth,
        inviteText: !!top.querySelector('[data-testid="result-invite-title"]') };
    });
    for (const k of ['yes', 'no', 'done', 'again']) {
      assert.ok(asked[k] && asked[k].top >= 0 && asked[k].bottom <= asked.vh && asked[k].left >= 0 && asked[k].right <= asked.vw, `${width}×${height}: ${k} is inside the screen (${JSON.stringify(asked[k])})`);
      assert.equal(asked[k].covered, false, `${width}×${height}: the ${k} button is not covered by anything`);
      assert.equal(asked[k].disabled, false, `${width}×${height}: the ${k} button is enabled`);
    }
    assert.equal(asked.inviteText, true, `${width}×${height}: the question text is in the page`);
    await page.click(topSel('result-invite-no'));
    await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="result-invite"]'));
    const answered = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const r = id => { const el = top.querySelector(`[data-testid="${id}"]`); const b = el.getBoundingClientRect(); return { text: el.textContent.trim(), cls: el.className, top: b.top, bottom: b.bottom }; };
      return { done: r('result-done'), again: r('result-again'), foot: [...top.querySelectorAll('.sz-page__foot button')].map(b => b.dataset.testid), vh: window.innerHeight };
    });
    assert.deepEqual(answered.foot, ['result-done', 'result-again'], `${width}×${height}: answered → the same 完成 (primary) + 再写一组 (text)`);
    assert.deepEqual([answered.done.text, answered.again.text], ['完成', '再写一组']);
    assert.ok(/sz-btn--primary/.test(answered.done.cls) && /sz-btn--text/.test(answered.again.cls), `${width}×${height}: 完成 is the primary button, 再写一组 a text button`);
    assert.ok(answered.again.bottom <= answered.vh && answered.done.top < answered.again.top, `${width}×${height}: both inside the screen, 完成 above 再写一组`);
  }
  await page.setViewportSize({ width: 393, height: 852 });
}
