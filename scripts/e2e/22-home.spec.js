// M2-1 首页（02 §4 M2-1；01 §2 首页状态 records × resume；R-H01–R-H07、R-H11；决定-D12、D05；03 P16 / P23 / P37 / P46）。
// 阶段 1 P1-E5 起首页按设计稿重排（五态 + 首次打开，03 P155 / P156）：本文件保留状态矩阵、N、日期时段、主入口、自己选字、跨天、R-H11 的断言，
// 改了的口径逐条在断言里写明（首页不再有「拾」大按钮 / 光影层 / 紧凑版合成行；续练行换成这一组的格子；首次打开隐藏「自己选字」）；
// 五态各自的版式、朱点、位置不动等断言在 72-p1e5-home-first.spec.js。
// H2（D55，首页改为方向 E「极静」）：首页不再有字帖行 / 进行中格子 / 今天写了 N 个字 / 字库计数，所以本文件里读它们的断言都撤了：
//   状态矩阵只看 data-records / data-resume / 主按钮字 / other-line；「N = 0 / 1 / 8 / 9」整节删除（首页不画今天写的字，计数规则在 test/ui/home.test.mjs 与结果页 / 字库页的 e2e 里）；续写的剩余字数由会话状态断言。
//   首页的新版式、六态、浅深、AX 在 99-h2-home-e / 99-h2-home-e-ax。
// 阶段 1 E9a（D49-7，实现交接 §1.1）：首页不再画「这一组还有 N 个字」「今天写了 N 个字」（n ≤ 8）「字库里有 N 个字了 ›」，计数只进读屏标签；
// 续写信息（槽 / 种类 / 剩余字数）改读进行中格子块上的 data-slot / data-kind / data-remaining 与它的读屏名称（旧断言读的 resume-line 文字行已删），
// 「今天的练习 · 还有 N 个字没写」一行去掉 ›（E9d，P196：可见文字再减成「今天的练习 · 接着写」，计数只进读屏名称）（带箭头的文字链接已取消，减法修稿 §1-5）。
//
// 场景：
//   1. 状态矩阵（需求 §6 反例 1：今天记录 0 / 有 × 未完成会话 无 / A / B / A+B，加首次）：data-records / data-resume、主入口字样、
//      S01 两行（R-H04，B 优先、A+B 时另一行带 ›）、「今天记录了 N 个字」+ 墨迹行在有未完成组时仍显示（P16）、第一次来说明只在首次且无组时；
//      清空过记录（backupMeta.lastConclusion kind=clear）→ 不再说「第一次来」（R-H09 / P46）；首练组没写完 → 「这一组还有 N 个字」。
//   2. N = 0 / 1 / 8 / 9：同字两次判断计 1、看过答案 / 跳过 / 昨天的判断不计；今天写的字最近 8 条 judged（按 id、同字留最近一次），
//      数字为去重 N；没有笔迹的记录按 10.12 只画字；紧凑版（360×640）同样的格子、两行四列，都在首屏内。
//   3. 日期行与时段词（R-H02）：setClock 四段与边界 04:59 / 05:00 / 09:59 / 10:00 / 14:59 / 15:00 / 18:59 / 19:00，
//      回前台（visibilitychange）重算；题记按日 doy % 3（P23）；光影层已取消（D43，03 P143）。
//   4. 主入口：第一次 → 第一次练习 3 字（policy.firstQueue，D38）；返回首页 → 轻提示（R-H10）+「第一次练习 · 还有 3 个字没写」；
//      A+B → 续写 B（D05 B 优先）；另一行 › → 续写 A；有记录无组 → 今天的练习；写入失败 → 主入口下三段式，再试一次成功。
//   5. 自己选字 →（R-H06）：打开查字组件 pick 模式，选两个字 → 开 B（一次 commit）、弹层关、写字页 B；返回首页 resume-line 为 B；
//      开组写入失败 → 弹层就地三段式、输入还在，再试一次成功；旧 B 没写完 → 弹层关、S02。
//   6. 跨天（P37）：昨天没写完的今天的练习 → 回前台时作废（store 里 A 为 null），首页不再显示续写；B 不过期（P61）。
//   7. 「现在没有要写的字」（R-H11）：小题库全写过 → 主入口推入 session-none 页；页上「自己选字」由首页注册，点开查字 pick。

import { bootTestHost, noToastFor, tid, topSel, waitNavIdle } from './helpers.mjs';

const DAY = '2026-09-24'; // 年内第 267 天 → 267 % 3 = 0 → 第一条题记（原型写死的 267）
const YDAY = '2026-09-23';
const FIRST = ['尴', '赢', '拾']; // D38：首练 3 字（原 5 字：尴 嚏 狩 晤 飓）
const SHEET = '[data-testid="query-sheet"]';
const inSheet = id => `${SHEET} ${tid(id)}`;

const COPY = {
  title: '今天写字',
  start: '开始写字',
  continue: '继续写字',
  firstVisit: '先写三个大家常忘的字。',
  picked: n => `这一组还有 ${n} 个字`,
  daily: n => `这一组还有 ${n} 个字`,
  dailyOther: '今天的字 · 接着写', // E9d（P196，D49 ⑦）：可见文字不带计数
  dailyOtherAria: n => `今天的字 · 接着写，还剩 ${n} 个`, // 计数只在读屏名称里
  first: n => `这一组还有 ${n} 个字`,
  count: n => `今天写了 ${n} 个字`,
  pick: '自己选字',
  pickTitle: '自己选字',
  startFailed: '没保存上，刚才的选择没记下。',
  notSave: '先不保存',
  retry: '再试一次',
  saveFailedQuery: '没保存上，输入的字还在。',
  date: (m, d, p) => `${m}月${d}日 · ${p}`,
};
const EPIGRAPH_FIRST_LINES = ['心不厌精，', '文章千古事，', '我书意造本无法，'];

function msOf(day, hms) {
  return new Date(`${day}T${hms}`).getTime();
}

function rec(serial, char, { kind = 'judged', judgment = 'correct', day = DAY, sessionId = 's900' } = {}) {
  const r = {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId, kind, at: msOf(day, '08:00:00') + serial * 1000, localDay: day,
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

function sess({ id, slot, kind, chars, cursor = 0, day = DAY, current = {} }) {
  const at = msOf(day, '07:30:00');
  return {
    id, slot, kind: kind || (slot === 'B' ? 'picked' : 'daily'), source: { view: 'home' },
    queue: chars.map(c => `base:${c}`), cursor, items: [],
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false, ...current },
    lastLine: null, startedAt: at, startedDay: day, updatedAt: at,
  };
}

const SESSION_A = () => sess({ id: 's801', slot: 'A', kind: 'daily', chars: ['一', '二', '三', '四', '五'], cursor: 2 });
const SESSION_B = () => sess({ id: 's802', slot: 'B', kind: 'picked', chars: ['鲜', '境'], cursor: 0 });

async function goHome(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === 'home';
  });
  await waitNavIdle(page);
}

/** 回首页 → reset → setClock → seed → 回前台事件（时钟重算 + 跨天过期）→ 等首页显示这一天。 */
async function setup(page, { day = DAY, time = '09:00:00', seed = null } = {}) {
  await goHome(page);
  const r = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    const res = s ? window.__shiziTest.seed(s) : { ok: true };
    document.dispatchEvent(new Event('visibilitychange'));
    return res;
  }, { iso: `${day}T${time}`, s: seed });
  if (!r || !r.ok) throw new Error('seed failed: ' + JSON.stringify(r));
  await page.waitForFunction(d => {
    const el = document.querySelector('[data-testid="screen-home"]');
    return !!el && el.dataset.today === d;
  }, day);
  await waitNavIdle(page, { settleMs: 200 });
}

async function setClock(page, day, time) {
  await page.evaluate(iso => {
    window.__shiziTest.setClock(iso);
    document.dispatchEvent(new Event('visibilitychange'));
  }, `${day}T${time}`);
  await page.waitForTimeout(80);
}

async function home(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer [data-testid="screen-home"]');
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const txt = id => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null);
    return {
      records: root.dataset.records,
      resume: root.dataset.resume,
      period: root.dataset.period,
      compact: root.dataset.compact,
      date: txt('home-date'),
      title: txt('home-title'),
      epigraph: q('home-epigraph') ? { index: Number(q('home-epigraph').dataset.index), text: txt('home-epigraph') } : null,
      cta: q('home-start') ? q('home-start').getAttribute('aria-label') : null,
      ctaText: txt('home-start'),
      firstTip: txt('home-first-tip'),
      otherLine: q('other-line') ? { text: txt('other-line'), aria: q('other-line').getAttribute('aria-label'), slot: q('other-line').dataset.slot, tag: q('other-line').tagName } : null,
      pick: txt('home-pick'),
      fail: txt('home-start-fail'),
      light: !!q('home-light'),
      view: root.dataset.view,
    };
  });
}

async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function topScreen(page) {
  return page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen);
}

async function waitWrite(page, slot) {
  await page.waitForFunction(s => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.slot === s;
  }, slot);
  await waitNavIdle(page);
}

async function backToHome(page) {
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

async function toastText(page) {
  const el = await page.$(tid('toast'));
  return el ? (await el.textContent()).trim() : null;
}

async function openPickSheet(page) {
  await page.click(tid('home-pick'));
  await page.waitForSelector(inSheet('query-input'));
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function pickChars(page, text, chars) {
  await page.locator(inSheet('query-input')).fill(text);
  for (const c of chars) {
    await page.locator(`${SHEET} [data-testid="query-row"][data-char="${c}"] [data-testid="query-row-select"]`).click();
  }
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 1. 状态矩阵
  step('first visit: records=first, resume=none; 开始写字 + 第一次来说明; no S01 lines, no N row (R-H01/R-H03/R-H12)');
  await setup(page);
  let h = await home(page);
  assert.equal(h.records, 'first', 'data-records=first');
  assert.equal(h.resume, 'none', 'data-resume=none');
  assert.equal(h.title, null, 'P1-E5: the first open has no 「今天写字」 title (design §一: the 「拾」 is the title; 72 covers the screen)');
  assert.equal(h.cta, COPY.start, 'main entry reads 开始写字');
  assert.equal(h.ctaText, COPY.start, 'P1-E5: the main button is a plain 240 ink button (no 「拾」 block any more)');
  assert.equal(h.firstTip, COPY.firstVisit, 'R-H03 「先写三个大家常忘的字。」 (stage-1 design)');
  assert.equal(h.otherLine, null, 'no other-line');
  assert.equal(h.pick, null, 'D46 ②: no 「自己选字」 on the first open');

  const todayRecs = [rec(1, '数'), rec(2, '感', { judgment: 'wrong' }), rec(3, '警')];
  const oldRecs = [rec(1, '数', { day: YDAY }), rec(2, '感', { day: YDAY })];
  const matrix = [];
  for (const recordsCase of ['empty', 'record']) {
    for (const resumeCase of ['none', 'A', 'B', 'A+B']) matrix.push({ recordsCase, resumeCase });
  }
  for (const { recordsCase, resumeCase } of matrix) {
    step(`matrix: records=${recordsCase} × resume=${resumeCase}`);
    const sessions = {
      A: resumeCase === 'A' || resumeCase === 'A+B' ? SESSION_A() : null,
      B: resumeCase === 'B' || resumeCase === 'A+B' ? SESSION_B() : null,
      lastEnded: {},
    };
    await setup(page, { seed: { records: byMonth(recordsCase === 'record' ? todayRecs : oldRecs), sessions } });
    h = await home(page);
    assert.equal(h.records, recordsCase, `data-records=${recordsCase}`);
    assert.equal(h.resume, resumeCase, `data-resume=${resumeCase}`);
    const noneCta = recordsCase === 'record' ? '再写一组' : COPY.start;
    assert.equal(h.cta, resumeCase === 'none' ? noneCta : COPY.continue, `main entry ${resumeCase === 'none' ? noneCta : '继续写字'} (P1-E5: 今天写过 → 再写一组)`);
    assert.equal(h.firstTip, null, 'no 第一次来 (records exist)');
    const expectOther = resumeCase === 'A+B' ? { text: COPY.dailyOther, aria: COPY.dailyOtherAria(3), slot: 'A', tag: 'BUTTON' } : null;
    assert.deepEqual(h.otherLine, expectOther, `other-line ${expectOther ? `「${expectOther.text}」, count only in the name: ${expectOther.aria}` : 'absent'}`);
  }

  step('first group in progress: 首次练习 · 还有 N 个字没写, no 第一次来 tip');
  await setup(page, { seed: { sessions: { A: sess({ id: 's803', slot: 'A', kind: 'first', chars: FIRST, cursor: 1 }), B: null, lastEnded: {} } } });
  h = await home(page);
  assert.equal(h.records, 'first', 'records=first (no judged record yet)');
  assert.equal(h.resume, 'A', 'resume=A');
  assert.equal(h.firstTip, null, 'first-visit tip hidden while the group is unfinished');
  assert.equal(h.pick, null, 'D46 ②: still no 「自己选字」 until the first practice is finished');

  // B6（G45, D36）：看过答案的字不再计入「还有 N 个字没写」——首页不再有这行数字，规则由 test/ui/home.test.mjs 的 B6 单测与读屏名称（other-line）核对。

  step('records cleared (R-H09 / P46): no 第一次来 wording, empty state');
  await setup(page, { seed: { backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: YDAY, count: 12 } } } });
  h = await home(page);
  assert.equal(h.records, 'empty', 'records=empty after clear-all');
  assert.equal(h.firstTip, null, 'no 「第一次来」 after clear-all');
  assert.equal(h.cta, COPY.start, 'main entry still 开始写字');

  // ------------------------------------------------------------------ 2.（已删）N = 0 / 1 / 8 / 9：首页不再画今天写的字与计数（D55）
  step('compact (360×640): the main button and 自己选字 fit on the first screen, no horizontal overflow (版式细节在 99-h2-home-e)');
  await setup(page, { seed: { records: byMonth(todayRecs) } });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForFunction(() => document.querySelector('[data-testid="screen-home"]').dataset.compact === 'true');
  h = await home(page);
  assert.equal(h.compact, 'true', 'data-compact=true');
  const fits = await page.evaluate(() => {
    const panel = document.querySelector('.sz-tabroot__panel');
    const pr = panel.getBoundingClientRect();
    const r = id => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
    return ['home-start', 'home-pick', 'home-brand-shi'].every(id => r(id).top >= pr.top && r(id).bottom <= pr.bottom)
      && document.documentElement.scrollWidth <= window.innerWidth;
  });
  assert.ok(fits, '360×640: the 「拾」, 自己选字 and the main button fit on the first screen, no horizontal overflow');
  await page.setViewportSize(ctx.viewport);
  await page.waitForFunction(() => document.querySelector('[data-testid="screen-home"]').dataset.compact === 'false');

  // ------------------------------------------------------------------ 3. 日期行、时段、题记、光影
  step('date line and period word at the four periods and their boundaries (R-H02, setClock + back to foreground)');
  await setup(page, { time: '07:00:00', seed: { records: byMonth(oldRecs) } }); // 首次打开没有日期行（P1-E5 设计稿），所以带一条昨天的记录
  const cases = [
    ['04:59:00', 'night', '晚上'], ['05:00:00', 'dawn', '早上'], ['07:00:00', 'dawn', '早上'], ['09:59:00', 'dawn', '早上'],
    ['10:00:00', 'noon', '中午'], ['12:30:00', 'noon', '中午'], ['14:59:00', 'noon', '中午'], ['15:00:00', 'dusk', '傍晚'],
    ['18:59:00', 'dusk', '傍晚'], ['19:00:00', 'night', '晚上'], ['23:30:00', 'night', '晚上'],
  ];
  for (const [time, period, word] of cases) {
    await setClock(page, DAY, time);
    h = await home(page);
    assert.equal(h.date, COPY.date(9, 24, word), `${time} → 「9月24日 · ${word}」`);
    assert.equal(h.period, period, `${time} → data-period=${period}`);
  }

  step('epigraph rotates by day of year % 3 (P23)');
  for (const [day, index] of [[DAY, 0], ['2026-09-25', 1], ['2026-09-26', 2]]) {
    await setClock(page, day, '09:00:00');
    h = await home(page);
    assert.equal(h.epigraph.index, index, `${day} → epigraph ${index}`);
    assert.ok(h.epigraph.text.includes(EPIGRAPH_FIRST_LINES[index]), `${day} shows 「${EPIGRAPH_FIRST_LINES[index]}」`);
  }
  assert.equal(h.date, COPY.date(9, 26, '早上'), 'date line follows the day');

  step('no light layer (D43, 03 P143: the design sheet has none): the period only changes the date line');
  await setClock(page, DAY, '09:00:00');
  assert.equal((await home(page)).light, false, 'no home-light element');
  await setClock(page, DAY, '12:00:00');
  assert.equal((await home(page)).light, false, 'still none after the period changes');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sz-light, [data-testid="home-light"]').length), 0, 'LightLayer is gone');

  // ------------------------------------------------------------------ 4. 主入口
  step('first visit: 开始写字 → first group of 3 (policy.firstQueue, D38) → back → toast + 这一组还有 3 个字 (R-H03/R-H10)');
  await setup(page);
  await page.click(tid('home-start'));
  await waitWrite(page, 'A');
  let st = await state(page);
  assert.equal(st.sessions.A.kind, 'first', 'A is the first group');
  assert.deepEqual(st.sessions.A.queue, FIRST.map(c => `base:${c}`), 'queue = 尴 赢 拾');
  // 跟手返回露出下层首页时，首页内容不能盖到写字页上（.sz-home 自成层叠上下文；去掉 isolation 时 10-write 的 G2 会丢笔）。
  const covered = await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'began', translationX: 4, progress: 0.01, velocityX: 50 } }));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const grid = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid-live"]').getBoundingClientRect();
      const hit = document.elementFromPoint(grid.left + grid.width / 2, grid.top + grid.height / 2);
      const homeVisible = getComputedStyle(document.querySelector('.sz-layer[data-screen="home"]')).visibility;
      window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail: { phase: 'cancelled', translationX: 0, progress: 0, velocityX: 0 } }));
      resolve({ homeVisible, inWrite: !!(hit && hit.closest('.sz-layer[data-top="true"]')) });
    })));
  });
  assert.deepEqual(covered, { homeVisible: 'visible', inWrite: true }, 'home revealed under a back drag stays below the write page');
  await waitNavIdle(page);
  await backToHome(page);
  assert.equal(await noToastFor(page), true, 'no toast within 1.5s of coming back (R4-F1 / P262: the 「已保存，下次接着写」 bar is gone)');
  h = await home(page);
  assert.equal(h.resume, 'A', 'resume=A');
  assert.equal(h.cta, COPY.continue, '继续写字');
  assert.equal(h.firstTip, null, 'tip gone');
  await page.click(tid('home-start'));
  await waitWrite(page, 'A');
  assert.equal((await state(page)).sessions.A.id, st.sessions.A.id, 'continue writes the same group');
  await backToHome(page);

  step('A+B: 拾 continues B (D05); other-line › continues A');
  await setup(page, { seed: { records: byMonth(todayRecs), sessions: { A: SESSION_A(), B: SESSION_B(), lastEnded: {} } } });
  const logBefore = await page.evaluate(() => window.__shiziTest.getWriteLog().length);
  await page.click(tid('home-start'));
  await waitWrite(page, 'B');
  assert.equal(await page.evaluate(() => window.__shiziTest.getWriteLog().length), logBefore, 'continuing writes nothing');
  await backToHome(page);
  await page.click(tid('other-line'));
  await waitWrite(page, 'A');
  st = await state(page);
  assert.equal(st.sessions.A.id, 's801', 'other-line opens the seeded A');
  await backToHome(page);

  step('records, no group: 拾 → today’s practice (daily group of 20: D65 每组字数缺省 20)');
  // 首练在上个月（新用户前 3 天每组新字封顶，D66 ⑫，另测）
  await setup(page, { seed: { records: byMonth([rec(100, '尴', { day: '2026-08-28' }), ...todayRecs.map(r => ({ ...r }))]) } });
  await page.click(tid('home-start'));
  await waitWrite(page, 'A');
  st = await state(page);
  assert.equal(st.sessions.A.kind, 'daily', 'daily group');
  assert.equal(st.sessions.A.queue.length, 20, 'group of 20 (settings.groupSize never chosen → 20)');
  assert.ok(!st.sessions.A.queue.some(k => ['base:数', 'base:感', 'base:警'].includes(k)), 'chars judged today are not picked again');
  await backToHome(page);

  step('start fails to save → three-part message under 拾, nothing opened; retry succeeds (R-G04)');
  await setup(page, { seed: { records: byMonth(oldRecs) } });
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(tid('home-start'));
  await page.waitForSelector(tid('home-start-fail'));
  h = await home(page);
  assert.ok(h.fail.includes(COPY.startFailed) && h.fail.includes(COPY.notSave) && !h.fail.includes(COPY.retry),
    '说明 +「先不保存」在失败块里；「再试一次」不再是第二个主按钮（I3 P1-14）');
  assert.equal((await page.textContent(tid('home-start-fail-retry'))).trim(), COPY.retry, 'the one main button of the screen became 再试一次');
  assert.equal(await page.locator(`${tid('screen-home')} .sz-btn--primary`).count(), 1, 'exactly ONE primary button on the screen while it failed');
  assert.equal(await topScreen(page), 'home', 'still on home');
  assert.equal(((await state(page)).sessions || {}).A || null, null, 'no session written');
  await waitNavIdle(page);
  await page.click(tid('home-start-fail-retry'));
  await waitWrite(page, 'A');
  assert.equal((await state(page)).sessions.A.kind, 'daily', 'retry opened today’s practice');
  await backToHome(page);
  assert.equal((await home(page)).fail, null, 'failure message gone after success');

  // ------------------------------------------------------------------ 5. 自己选字
  step('自己选字 → pick sheet (R-H06): pick 永 和 → one commit, sheet closes, write page B; back → resume-line B');
  await setup(page, { seed: { records: byMonth(oldRecs) } });
  await openPickSheet(page);
  assert.equal(await page.locator(inSheet('query-body')).getAttribute('data-mode'), 'pick', 'query sheet in pick mode');
  assert.equal((await page.locator(`${SHEET} .sz-sheet__title`).textContent()).trim(), COPY.pickTitle, 'sheet title 「自己选字」');
  await pickChars(page, '永和', ['永', '和']);
  let log0 = await page.evaluate(() => window.__shiziTest.getWriteLog().length);
  await page.locator(inSheet('query-go')).click();
  await waitWrite(page, 'B');
  st = await state(page);
  assert.equal(st.sessions.B.kind, 'picked', 'B is 自己选的');
  assert.deepEqual(st.sessions.B.queue, ['base:永', 'base:和'], 'queue in input order');
  assert.deepEqual(st.sessions.B.source, { view: 'home' }, 'source = home');
  assert.equal(st.custom || null, null, 'picking does not add to 自选字 (D21)');
  const writes = await page.evaluate(n => window.__shiziTest.getWriteLog().slice(n), log0);
  assert.ok(writes.length > 0 && writes.every(w => w.via === 'storage'), 'writes go through storage.js');
  assert.equal(await page.locator(SHEET).count(), 0, 'sheet closed (prototype lkGo closes it)');
  await backToHome(page);
  h = await home(page);
  assert.deepEqual([h.resume, h.cta], ['B', COPY.continue], 'back on home: resume = B, 继续写字');

  step('自己选字: commit fails → R-H06 three-part in the sheet, input kept, no B; retry opens B');
  await setup(page, { seed: { records: byMonth(oldRecs) } });
  await openPickSheet(page);
  await pickChars(page, '永和', ['和']);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.locator(inSheet('query-go')).click();
  await page.waitForSelector(inSheet('query-go-fail'));
  const failText = (await page.locator(inSheet('query-go-fail')).textContent()).trim();
  assert.ok(failText.includes(COPY.saveFailedQuery), '「没保存上，输入的字还在。」');
  assert.equal(await page.locator(inSheet('query-input')).inputValue(), '永和', 'input kept');
  assert.equal(((await state(page)).sessions || {}).B || null, null, 'no B written');
  await waitNavIdle(page);
  await page.locator(inSheet('query-go-fail-retry')).click();
  await waitWrite(page, 'B');
  assert.deepEqual((await state(page)).sessions.B.queue, ['base:和'], 'retry opened B with 和');
  await backToHome(page);

  step('自己选字 with an unfinished B → sheet closes, S02 lists the unwritten chars (R-H05)');
  await setup(page, { seed: { records: byMonth(oldRecs), sessions: { A: null, B: SESSION_B(), lastEnded: {} } } });
  await openPickSheet(page);
  await pickChars(page, '永和', ['永']);
  log0 = await page.evaluate(() => window.__shiziTest.getWriteLog().length);
  await page.locator(inSheet('query-go')).click();
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  assert.equal(await page.locator(SHEET).count(), 0, 'query sheet closed before S02');
  assert.ok((await page.locator(tid('s02-body')).textContent()).includes('「鲜」「境」'), 'S02 lists 「鲜」「境」');
  assert.equal(await page.evaluate(() => window.__shiziTest.getWriteLog().length), log0, 'nothing written before choosing');
  await page.click(tid('s02-end-start'));
  await waitWrite(page, 'B');
  assert.deepEqual((await state(page)).sessions.B.queue, ['base:永'], 'end old, start new B with 永');
  await backToHome(page);

  // ------------------------------------------------------------------ 6. 跨天
  step('cross-day (P37): yesterday’s unfinished daily is discarded on foreground; picked B stays (P61)');
  await setup(page, {
    seed: {
      records: byMonth([rec(1, '数', { day: YDAY })]),
      sessions: { A: sess({ id: 's804', slot: 'A', kind: 'daily', chars: ['一', '二', '三'], cursor: 1, day: YDAY }),
        B: sess({ id: 's805', slot: 'B', kind: 'picked', chars: ['鲜'], cursor: 0, day: YDAY }), lastEnded: {} },
    },
  });
  await page.waitForFunction(() => (window.__shiziTest.getState().sessions || {}).A === null);
  st = await state(page);
  assert.equal(st.sessions.A, null, 'A (daily, yesterday) discarded');
  assert.equal(st.sessions.B.id, 's805', 'B (picked) kept');
  h = await home(page);
  assert.equal(h.resume, 'B', 'resume=B');
  assert.equal(h.otherLine, null, 'no other-line for the expired A');

  // ------------------------------------------------------------------ 7. 现在没有要写的字
  step('nothing to write (R-H11): 拾 → session-none; its 自己选字 (registered by home) opens the pick sheet');
  await setup(page, { seed: { records: byMonth([rec(1, '永'), rec(2, '和')]), sched: {
    'base:永': { fsrs: { stability: 5, difficulty: 5, state: 2 }, due: '2026-10-10', lastJudgedAt: msOf(DAY, '08:00:00') },
    'base:和': { fsrs: { stability: 5, difficulty: 5, state: 2 }, due: '2026-10-10', lastJudgedAt: msOf(DAY, '08:00:00') },
  } } });
  await page.evaluate(async () => {
    const deck = await import('/src/data/deck.js');
    const row = (t, rank) => ({ py: 'x', hint: '', ans: t, ci: 0, target: t, rank, strokes: 5, parts: 1, topic: 't', d: 50, band: '基础',
      edu: null, common: 1, norm: '一级', std: 0, ctx: 'dict' });
    deck.setDeckSource({ seed: [row('永', 1), row('和', 2)], overrides: {} });
  });
  await page.click(tid('home-start'));
  await page.waitForSelector(topSel('session-none'));
  await waitNavIdle(page);
  assert.equal((await page.locator(topSel('session-none-title')).textContent()).trim(), '现在没有要写的字', 'R-H11 page');
  assert.equal(await page.locator(topSel('session-none-pick')).count(), 1, '「自己选字」 shown (registered by home)');
  await page.click(topSel('session-none-pick'));
  await page.waitForSelector(inSheet('query-input'));
  assert.equal(await page.locator(inSheet('query-body')).getAttribute('data-mode'), 'pick', 'opens the pick sheet');
  await page.evaluate(async () => {
    const deck = await import('/src/data/deck.js');
    deck.setDeckSource(null);
  });
  await waitNavIdle(page);
  await page.evaluate(() => history.back());
  await page.waitForSelector(SHEET, { state: 'detached' });
  await waitNavIdle(page);
  await page.click(topSel('page-back')); // D58 ④：「没有」页的出口只有左上「‹」
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  assert.equal(await topScreen(page), 'home', 'back on home');
}
