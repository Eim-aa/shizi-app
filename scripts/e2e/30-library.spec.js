// M3-1 字库首页（墨墙）（02 §5 M3-1；R-L01–R-L04、R-L07–R-L10；03 P27 / P56 / P63；原型 字库墨墙屏-第十稿交接版 L26–L79）。
//
// 场景（钩子 seed + setClock 2026-09-24）：
//   1. 0 个字：空态（R-L05 两句 +「你写下的字会留在这里」）；各状态同一个顶部（查字占位 + R-L04 说明 + 练习范围只写库名）；
//      只有看过答案 / 跳过 / 自选的字也是空态。
//   2. 5 / 30 / 300 个字：大数字 = 有记录的字（R-L10）；两条事实（另有 N 个自选的字还没写 / 从 X 开始记录，P63）；
//      墙：自选了还没写（空心）排最前，其余最近一次新 → 旧；写错过 = 标准字 + 红点（K28，不画写错笔迹）；墨色四档（P56）；
//      列数 8（P1-E1b 设计系统：与成员数无关；≥ 430 宽 9 列、系统大字号 6 列）；最多 8 行；截断时「还有 N 个字 ›」（P27：分母含自选未写）；没截断时不显示。
//      写错过 / 快忘了卡片：数字、前 4 格预览、有字才能点；空卡不是按钮、去卡片样式（R-L02 / R-L07）。
//      300 字首屏渲染计时（R-L09）；紧凑版（360×640）列数 6 / 4。
//   3. 导航（目标屏由 M3-2 / M3-4 / M3-5 / M3-6 注册；本卡只测 nav 调用，测试里用占位屏覆盖）：
//      墙上点字 → detail {char}（空心字同样）；卡片 → library-list {kind}；大数字 / 还有 N 个字 → library-all；练习范围 → library-switch。
//   4. 深色：墙下说明反向（「颜色越暗，越久没写。…」），最淡一档提亮；跟随系统（prefers-color-scheme）与 data-theme 强制两种。
//   5. 可访问性：页内每个 button 有可读的无障碍名。

import { bootTestHost, tid, tokenRgb, waitNavIdle, setTextSize, LARGE_TEXT } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const SCREEN = '.sz-layer[data-top="true"] [data-testid="screen-library"]';
const TONE_AGO = [1, 15, 60, 120]; // 第 i 个字距今天数 → 档位 i % 4（≤7 / ≤30 / ≤90 / 更久）
const HOLLOW = ['馨', '鼎'];
const STUBS = ['library-list', 'library-all', 'library-switch', 'detail'];

const COPY = {
  queryNote: '查到的字可以直接练，也可以加入自选的字。',
  scopeLabel: '练习范围',
  defaultLib: '规范常用字',
  switchEntry: '更换字库 ›',
  noRecordNote: '每天写的新字，从这个字库里挑。',
  emptyTitle: '你写下的字会留在这里',
  emptyText: '去「习字」写几个字，判断过对错，就会出现在这里。',
  recordedLabel: '有记录的字',
  customUnwritten: n => `另有 ${n} 个自选的字还没写`,
  since: (m, d) => `从 ${m} 月 ${d} 日开始记录`,
  more: n => `还有 ${n} 个字 ›`,
  // D27（阶段 1 P1-E3）：perRecordInk 默认开启 → tInk 取原槽（D27 改写为「第一次和最近一次的笔迹」）；关闭态的 …Glyph 见 47-ink-promises
  legend: '墨色越浅，越久没写。点一个字，看它第一次和最近一次的笔迹。',
  legendDark: '颜色越暗，越久没写。点一个字，看它第一次和最近一次的笔迹。',
  tones: ['一周内写过', '一个月内', '三个月内', '三个月以上'],
  wrongTitle: '写错过',
  forgetTitle: '快忘了',
  wrongNote: '你判断写错的字。',
  wrongEmpty: '你判断写错的字会放在这里。',
  forgetNote: '有一阵没写、可能快忘了的字。',
  forgetEmpty: '可能快忘了的字会放在这里。',
  actOne: '练这个字 →',
  actMany: '练这些字 →',
  hollowLegend: '自选了还没写',
};

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function dayAgo(n) {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * n 个字的种子：第 i 个字一条 judged 记录，距今 TONE_AGO[i % 4] 天（同档里越靠后的字越新：+ 分钟偏移）；
 * 每 5 个字第 1 个写错；自选：HOLLOW 两个没写 + 一个已写的字；sched：前 3 个写对且距今 > 90 天的字到期（快忘了）。
 */
function seedOf(chars, { custom = true, forget = true, wrong = true } = {}) {
  const rows = chars.map((c, i) => {
    const day = dayAgo(TONE_AGO[i % 4]);
    const at = new Date(`${day}T08:00:00`).getTime() + i * 60000;
    return { c, i, day, at, judgment: wrong && i % 5 === 0 ? 'wrong' : 'correct' };
  }).sort((a, b) => a.at - b.at);
  const records = {};
  rows.forEach((row, k) => {
    const r = {
      id: `r${k + 1}`, cardKey: `base:${row.c}`, char: row.c, sessionId: 's900', kind: 'judged', judgment: row.judgment,
      at: row.at, localDay: row.day, help: { hints: 0, answerSeen: false, traced: false },
    };
    (records[row.day.slice(0, 7)] || (records[row.day.slice(0, 7)] = [])).push(r);
    row.id = r.id;
  });
  const state = { records };
  if (custom && chars.length) {
    state.custom = { added: [...HOLLOW, chars[chars.length - 1]].map((char, i) => ({ char, at: 1000 + i })) };
  }
  if (forget) {
    const due = rows.filter(r => r.judgment === 'correct' && r.i % 4 === 3).slice(0, 3);
    if (due.length) {
      state.sched = {};
      for (const r of due) state.sched[`base:${r.c}`] = { fsrs: { stability: 2 }, due: dayAgo(10), lastJudgedAt: r.at };
    }
  }
  return { state, rows };
}

async function stubTargets(page) {
  await page.evaluate(async names => {
    const { registerScreen } = await import('/src/ui/router.js');
    const { html } = await import('/vendor/ui.js');
    // 本卡只测 nav 调用：目标屏（M3-2 / M3-4 / M3-5 / M3-6）换成占位屏，与并行卡的实现解耦。
    for (const n of names) registerScreen(n, () => html`<div data-testid=${`stub-${n}`}>${n}</div>`);
  }, STUBS);
}

async function goLibrary(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('library');
  });
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === 'library';
  });
  await waitNavIdle(page, { settleMs: 200 });
}

/** reset → setClock → seed → 回前台（重算今天）→ 等字库页显示这份数据。返回 seed 到渲染完成的毫秒数。 */
async function setup(page, seed, expectRecorded) {
  await goLibrary(page);
  const r = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    window.__t0 = performance.now();
    const res = s ? window.__shiziTest.seed(s) : { ok: true };
    document.dispatchEvent(new Event('visibilitychange'));
    return res;
  }, { iso: CLOCK, s: seed });
  if (!r || !r.ok) throw new Error('seed failed: ' + JSON.stringify(r));
  await page.waitForFunction(({ sel, n, day }) => {
    const el = document.querySelector(`${sel} [data-testid="library-home"]`);
    return !!el && el.dataset.today === day && Number(el.dataset.recorded) === n;
  }, { sel: SCREEN, n: expectRecorded, day: TODAY });
  const ms = await page.evaluate(() => performance.now() - window.__t0);
  await page.waitForTimeout(60);
  return ms;
}

async function lib(page) {
  return page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const all = id => [...root.querySelectorAll(`[data-testid="${id}"]`)];
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const home = q('library-home');
    const wall = q('library-wall');
    const card = kind => {
      const el = q(`library-card-${kind}`);
      if (!el) return null;
      return {
        tag: el.tagName, n: Number(el.dataset.n), empty: el.dataset.empty === 'true', text: txt(el),
        mini: [...el.querySelectorAll('[data-testid="library-card-mini-cell"]')].map(m => ({ char: m.dataset.char, kind: m.dataset.kind })),
        bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth,
      };
    };
    const cells = all('library-wall-cell').map(el => {
      const g = el.querySelector('.sz-lib__g');
      const r = el.getBoundingClientRect();
      return {
        char: el.dataset.char, kind: el.dataset.kind, tone: el.dataset.tone, label: el.getAttribute('aria-label'),
        opacity: g ? getComputedStyle(g).opacity : null, mark: !!el.querySelector('.sz-lib__mark'),
        color: el.querySelector('.sz-lib__char') ? getComputedStyle(el.querySelector('.sz-lib__char')).color : null,
        glyph: el.querySelector('.sz-lib__char') ? el.querySelector('.sz-lib__char').textContent : null,
        ink: g ? g.dataset.ink : null, y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    return {
      state: home ? home.dataset.state : null,
      recorded: home ? Number(home.dataset.recorded) : null,
      title: txt(root.querySelector('[data-page-title]')),
      slot: !!q('library-query-slot'),
      queryNote: txt(q('library-query-note')),
      scope: txt(q('library-switch')),
      scopeName: txt(q('library-scope-name')),
      scopeTag: q('library-switch') ? q('library-switch').tagName : null,
      noRecordNote: txt(q('library-no-record-note')),
      empty: txt(q('library-empty')),
      count: q('library-count') ? { n: Number(q('library-count').dataset.n), text: txt(q('library-count')), tag: q('library-count').tagName } : null,
      facts: all('library-fact').map(el => ({ kind: el.dataset.kind, text: txt(el).replace(/^·\s*/, '') })),
      wrong: card('wrong'),
      forget: card('forget'),
      legend: all('library-legend-tone').map(el => txt(el)),
      legendMarks: [txt(q('library-legend-wrong')), txt(q('library-legend-hollow'))],
      note: txt(q('library-legend-note')),
      wall: wall ? { cols: Number(wall.dataset.cols), shown: Number(wall.dataset.shown), members: Number(wall.dataset.members), more: Number(wall.dataset.more) } : null,
      cells,
      more: q('library-more') ? { text: txt(q('library-more')), n: Number(q('library-more').dataset.n), tag: q('library-more').tagName } : null,
      unnamedButtons: [...root.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.innerText || '').trim())
        .map(b => b.outerHTML.slice(0, 80)),
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    };
  }, SCREEN);
}

async function routerTop(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { depth: s.depth, name: s.top ? s.top.n : null, params: s.top ? s.top.p : null };
  });
}

/** 点一下，断言推入 name（params），再返回字库页。 */
async function expectPush(page, assert, selector, name, params, msg) {
  await page.click(selector);
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 1 && s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page, { settleMs: 120 });
  const top = await routerTop(page);
  assert.deepEqual({ name: top.name, params: top.params || {} }, { name, params }, msg);
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === 'library';
  });
  await waitNavIdle(page, { settleMs: 120 });
}

function monthDay(day) {
  const [, m, d] = day.split('-');
  return [Number(m), Number(d)];
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await stubTargets(page);
  const deckChars = await page.evaluate(async () => {
    const { getDeck } = await import('/src/data/deck.js');
    const d = getDeck();
    return d ? d.keys.filter(k => k.startsWith('base:')).map(k => k.slice(5)).filter(c => !['馨', '鼎'].includes(c)).slice(0, 320) : [];
  });
  assert.ok(deckChars.length >= 300, 'deck provides 300+ practicable chars for seeding');

  // ------------------------------------------------------------------ 1. 0 个字
  step('0 chars: empty state; same top block (query slot + R-L04 note + practice scope = library name only)');
  await setup(page, null, 0);
  let v = await lib(page);
  assert.equal(v.title, '字库', 'tab title 字库');
  assert.equal(v.state, 'empty', 'data-state=empty');
  assert.ok(v.slot, 'library-query-slot placeholder present (M3-3 mounts the query box)');
  assert.equal(v.queryNote, COPY.queryNote, 'R-L04 note under the query box');
  assert.equal(v.scopeTag, 'BUTTON', 'practice scope row is a button (→ 换库)');
  assert.equal(v.scopeName, COPY.defaultLib, 'R-L01 scope line shows only the library name (default P73)');
  assert.equal(v.scope, `${COPY.scopeLabel} ${COPY.defaultLib} ${COPY.switchEntry}`, 'scope row: 练习范围 · 库名 · 更换字库 ›');
  assert.equal(v.noRecordNote, COPY.noRecordNote, 'R-L05 no-record note');
  assert.equal(v.empty, `拾 ${COPY.emptyTitle} ${COPY.emptyText}`, "empty state: hollow 拾 + title + R-L05 text");
  assert.equal(v.count, null, 'no big number');
  assert.equal(v.wall, null, 'no wall');
  assert.equal(v.wrong, null, 'no cards');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');

  step('0 judged: answer-seen / skipped / custom only → still empty');
  const nonJudged = {
    records: { '2026-09': [
      { id: 'r1', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'answer-seen', at: new Date(`${TODAY}T08:00:00`).getTime(), localDay: TODAY, help: { hints: 0, answerSeen: true, traced: false } },
      { id: 'r2', cardKey: 'base:和', char: '和', sessionId: 's1', kind: 'skipped', at: new Date(`${TODAY}T08:01:00`).getTime(), localDay: TODAY, help: { hints: 0, answerSeen: false, traced: false } },
    ] },
    custom: { added: [{ char: '馨', at: 1 }] },
  };
  await setup(page, nonJudged, 0);
  v = await lib(page);
  assert.equal(v.state, 'empty', 'answer-seen / skipped are not records (D18/D23)');
  assert.equal(v.wall, null, 'no wall while nothing is recorded');

  step('library name follows settings.library (R-L01 renamed curriculum library)');
  await setup(page, { settings: { library: 'curriculum2500' } }, 0);
  v = await lib(page);
  assert.equal(v.scopeName, '小学初中常用字', 'curriculum2500 → 「小学初中常用字」');

  // ------------------------------------------------------------------ 2. 5 / 30 / 300 个字
  for (const n of [5, 30, 300]) {
    const chars = deckChars.slice(0, n);
    const { state, rows } = seedOf(chars);
    step(`${n} chars: big number, facts, cards, wall order / tones / columns / truncation`);
    const ms = await setup(page, state, n);
    v = await lib(page);
    const members = n + HOLLOW.length;
    const cols = 8; // 设计系统 v1（P1-E1b）：8 列，与成员数无关
    const shown = Math.min(members, cols * 8);
    assert.equal(v.state, 'records', 'data-state=records');
    assert.deepEqual(v.count, { n, text: `${COPY.recordedLabel} ${n} 个字`, tag: 'BUTTON' }, `big number ${n} (R-L10) is a button (R-L02)`);
    const first = rows[0].day;
    const [fm, fd] = monthDay(first);
    assert.deepEqual(v.facts, [
      { kind: 'customUnwritten', text: COPY.customUnwritten(HOLLOW.length) },
      { kind: 'since', text: COPY.since(fm, fd) },
    ], 'two facts: custom unwritten + since first record day (P63)');
    assert.deepEqual(v.wall, { cols, shown, members, more: members - shown }, `wall ${cols} cols, ${shown} cells shown of ${members} (P27)`);
    const rowsY = [...new Set(v.cells.map(c => c.y))];
    assert.ok(rowsY.length <= 8, `wall has at most 8 rows (got ${rowsY.length})`);
    assert.ok(v.cells.every(c => Math.abs(c.w - c.h) <= 1), 'cells are square');
    assert.deepEqual(v.cells.slice(0, 2).map(c => [c.char, c.kind]), HOLLOW.map(c => [c, 'hollow']), 'custom unwritten (hollow) first (R-L02)');
    const byNew = [...rows].sort((a, b) => b.at - a.at);
    const expectRest = byNew.slice(0, shown - HOLLOW.length).map(r => r.c);
    assert.deepEqual(v.cells.slice(HOLLOW.length).map(c => c.char), expectRest, 'then latest judged, newest → oldest');
    const wrongCells = v.cells.filter(c => c.kind === 'wrong');
    const wrongExpected = byNew.slice(0, shown - HOLLOW.length).filter(r => r.judgment === 'wrong').map(r => r.c);
    assert.deepEqual(wrongCells.map(c => c.char), wrongExpected, 'wrong cells = latest judged wrong');
    assert.ok(wrongCells.every(c => c.mark && c.glyph === c.char && c.ink === 'none'), 'wrong = standard glyph + red dot, no wrong ink (K28 / R-L08)');
    const inkCells = v.cells.filter(c => c.kind === 'ink');
    const toneOk = inkCells.every(c => {
      const r = rows.find(x => x.c === c.char);
      return Number(c.tone) === r.i % 4;
    });
    assert.ok(toneOk, 'ink cells carry the tone of their last record (7/30/90, P56)');
    // P1-E1b：新旧四档改用令牌 wall1–wall4 的独立色值（取代透明度 1 / .78 / .58 / .55），写错格也按新旧取档、不再变灰变小
    const WALL = ['wall1', 'wall2', 'wall3', 'wall4'].map(k => tokenRgb('light', k));
    assert.ok(inkCells.every(c => c.color === WALL[Number(c.tone)] && c.opacity === '1'), 'tone colours wall1–wall4 (light), no opacity coding (P1-E1b)');
    assert.ok(wrongCells.every(c => c.color === WALL[Number(c.tone)]), 'wrong cells are toned by recency like the others (no grey-out)');
    assert.ok(inkCells.every(c => c.ink === 'none' && c.glyph === c.char), 'records seeded without ink → standard glyph placeholder (10.12; with stored ink the wall draws it, D27: 66-ink-retention / 47)');
    const hollowCell = v.cells[0];
    assert.equal(hollowCell.label, `${HOLLOW[0]}，${COPY.hollowLegend}`, 'cell accessible name 「字，状态」');
    const wrongList = byNew.filter(r => r.judgment === 'wrong').map(r => r.c);
    assert.equal(v.wrong.tag, 'BUTTON', 'wrong card with chars is a button');
    assert.equal(v.wrong.n, wrongList.length, `wrong card count ${wrongList.length}`);
    assert.deepEqual(v.wrong.mini, wrongList.slice(0, 4).map(c => ({ char: c, kind: 'wrong' })), 'wrong card preview: first 4, standard glyph + dot');
    assert.ok(v.wrong.text.includes(COPY.wrongNote) && v.wrong.text.endsWith(wrongList.length === 1 ? COPY.actOne : COPY.actMany),
      'wrong card note + action line');
    const forgetN = Math.min(3, rows.filter(r => r.judgment === 'correct' && r.i % 4 === 3).length);
    if (forgetN) {
      assert.equal(v.forget.tag, 'BUTTON', 'forget card with chars is a button');
      assert.equal(v.forget.n, forgetN, `forget card count ${forgetN} (K16 due)`);
      assert.ok(v.forget.text.includes(COPY.forgetNote), 'R-L07 forget card note');
      assert.ok(v.forget.mini.every(m => m.kind === 'ink'), 'forget preview draws last ink / placeholder');
    } else {
      assert.equal(v.forget.tag, 'DIV', 'empty forget card is not a button (R-L02)');
      assert.ok(v.forget.empty && v.forget.text.includes(COPY.forgetEmpty), 'R-L07 empty forget card text');
    }
    assert.deepEqual(v.legend, COPY.tones, 'legend: four tones (R-L03 fourth = 三个月以上)');
    assert.deepEqual(v.legendMarks, [COPY.wrongTitle, COPY.hollowLegend], 'legend marks: 写错过 / 自选了还没写');
    assert.equal(v.note, COPY.legend, 'R-L03 note (light)');
    if (members > shown) {
      assert.deepEqual(v.more, { text: COPY.more(members - shown), n: members - shown, tag: 'BUTTON' }, `「还有 ${members - shown} 个字 ›」`);
    } else {
      assert.equal(v.more, null, 'not truncated → no 还有 N 个字');
    }
    assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');
    assert.equal(v.hScroll, false, 'no horizontal scroll');
    if (n === 300) {
      assert.ok(ms < 1000, `300 chars: seed → rendered in ${ms.toFixed(0)}ms (R-L09)`);
    }
  }

  step('wrong card empty: no card chrome, not a button (R-L02)');
  {
    const { state } = seedOf(deckChars.slice(0, 4), { custom: false, forget: false, wrong: false });
    await setup(page, state, 4);
    v = await lib(page);
    assert.equal(v.wrong.tag, 'DIV', 'empty wrong card is a div');
    assert.ok(v.wrong.empty && v.wrong.text === `${COPY.wrongTitle} ${COPY.wrongEmpty}`, 'empty wrong card: title + 「你判断写错的字会放在这里。」');
    assert.equal(v.wrong.bg, 'rgba(0, 0, 0, 0)', 'empty card has no card background');
    assert.equal(v.wrong.border, '0px', 'empty card has no border');
    assert.equal(v.forget.tag, 'DIV', 'empty forget card is a div');
    assert.equal(v.forget.text, `${COPY.forgetTitle} ${COPY.forgetEmpty}`, 'R-L07 empty forget card text');
    assert.deepEqual(v.facts.map(f => f.kind), ['since'], 'no custom unwritten → only the since fact');
    assert.equal(v.more, null, 'no 还有 N 个字');
    assert.ok(v.cells.every(c => c.kind === 'ink'), 'no wrong / hollow cells');
  }

  // ------------------------------------------------------------------ 3. 导航
  step('navigation: wall cell → detail; hollow → detail; cards → list; big number / more → all; scope → switch');
  {
    const { state, rows } = seedOf(deckChars.slice(0, 300));
    await setup(page, state, 300);
    v = await lib(page);
    const inkChar = v.cells.find(c => c.kind === 'ink').char;
    await expectPush(page, assert, `${SCREEN} [data-testid="library-wall-cell"][data-char="${inkChar}"]`, 'detail', { char: inkChar },
      `wall cell 「${inkChar}」 → nav.push('detail', {char})`);
    await expectPush(page, assert, `${SCREEN} [data-testid="library-wall-cell"][data-char="${HOLLOW[0]}"]`, 'detail', { char: HOLLOW[0] },
      'hollow cell → detail too (详情画「没有记录」一态)');
    await expectPush(page, assert, `${SCREEN} ${tid('library-card-wrong')}`, 'library-list', { kind: 'wrong' }, "wrong card → library-list {kind:'wrong'}");
    await expectPush(page, assert, `${SCREEN} ${tid('library-card-forget')}`, 'library-list', { kind: 'forget' }, "forget card → library-list {kind:'forget'}");
    await expectPush(page, assert, `${SCREEN} ${tid('library-count')}`, 'library-all', {}, 'big number → library-all');
    await expectPush(page, assert, `${SCREEN} ${tid('library-more')}`, 'library-all', {}, '还有 N 个字 › → library-all');
    await expectPush(page, assert, `${SCREEN} ${tid('library-switch')}`, 'library-switch', {}, '练习范围 → library-switch');
    const after = await page.evaluate(() => window.__shiziTest.getState());
    assert.equal(Object.values(after.records).flat().length, rows.length, 'navigation writes nothing');
    assert.equal(after.sessions && after.sessions.B ? 'B' : null, null, 'no session opened from the library home itself');
  }

  // ------------------------------------------------------------------ 4. 深色
  step('dark (data-theme=dark): note reversed, tone colours = dark wall1–wall4 (R-L03 / 边改 L14, P1-E1b)');
  await setup(page, seedOf(deckChars.slice(0, 30)).state, 30); // 30 字：四档都在墙上
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(60);
  v = await lib(page);
  assert.equal(v.note, COPY.legendDark, 'dark note 「颜色越暗，越久没写。…」');
  const oldest = v.cells.find(c => c.kind === 'ink' && c.tone === '3');
  assert.equal(oldest && oldest.color, tokenRgb('dark', 'wall4'), 'oldest tone = dark wall4 (an independent colour, not an opacity)');
  const tone2 = v.cells.find(c => c.kind === 'ink' && c.tone === '2');
  assert.equal(tone2 && tone2.color, tokenRgb('dark', 'wall3'), 'third tone = dark wall3');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(60);
  v = await lib(page);
  assert.equal(v.note, COPY.legend, 'data-theme=light forces the light note even when the system is dark');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.waitForTimeout(60);
  v = await lib(page);
  assert.equal(v.note, COPY.legendDark, 'follow system dark (prefers-color-scheme) → dark note');
  assert.equal(v.cells.find(c => c.kind === 'ink' && c.tone === '3').color, tokenRgb('dark', 'wall4'), 'follow system dark → oldest tone = dark wall4');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(60);
  v = await lib(page);
  assert.equal(v.note, COPY.legend, 'back to light note');

  // ------------------------------------------------------------------ 5. 紧凑版
  step('360×640: still 8 columns (a short screen no longer changes the wall); system large text (XXXL) → 6 columns; 440 wide → 9 (P1-E1b)');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(120);
  await setup(page, seedOf(deckChars.slice(0, 300)).state, 300);
  v = await lib(page);
  assert.deepEqual({ cols: v.wall.cols, shown: v.wall.shown, more: v.wall.more }, { cols: 8, shown: 64, more: 302 - 64 }, '360×640, 300 chars: 8 cols × 8 rows');
  assert.equal(v.more.text, COPY.more(302 - 64), 'more text follows the truncation');
  assert.equal(v.hScroll, false, 'no horizontal scroll at 360');
  await setTextSize(page, LARGE_TEXT);
  await page.waitForTimeout(300);
  v = await lib(page);
  assert.deepEqual({ cols: v.wall.cols, shown: v.wall.shown, more: v.wall.more }, { cols: 6, shown: 48, more: 302 - 48 }, 'XXXL: 6 cols × 8 rows');
  assert.equal(v.hScroll, false, 'no horizontal scroll at 360 with large text');
  await setTextSize(page, 'L');
  await page.setViewportSize({ width: 440, height: 956 });
  await page.waitForTimeout(300);
  v = await lib(page);
  assert.equal(v.wall.cols, 9, '440 wide: 9 cols (Pro Max)');
  {
    const { state } = seedOf(deckChars.slice(0, 5));
    await setup(page, state, 5);
    v = await lib(page);
    assert.equal(v.wall.cols, 9, '5 chars on 440 wide: still 9 cols');
  }
  await page.setViewportSize(ctx.viewport);
  await page.waitForTimeout(120);
}
