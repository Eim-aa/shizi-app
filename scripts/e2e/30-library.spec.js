// M3-1 字库首页（墨墙）（02 §5 M3-1；R-L01–R-L04、R-L07–R-L10；03 P27 / P56 / P63；原型 字库墨墙屏-第十稿交接版 L26–L79）。
// E9c（D49 减法修稿，实现交接 §14；03 P193）：字库页只剩 标题 → 查字 → 写错过 / 快忘了两个同模板的块 → 字墙题注「N 个字」→ 字墙；
// 没有搜索框下说明、练习范围一行（移到「我的 › 设置」，32-switch / 41-settings 断言）、大数字与副统计、两栏说明与朱点、图例、「→」；
// 自选未写的空心字描边是 ink4（朱色只表示写错）。77-e9c-library 另测版式与 AX。
//
// 场景（钩子 seed + setClock 2026-09-24）：
//   1. 0 个字：空态（R-L05 两句 +「你写下的字会留在这里」）；各状态同一个顶部（查字占位，下面没有说明句，页上没有练习范围入口）；
//      只有看过答案 / 跳过 / 自选的字也是空态。
//   2. 5 / 30 / 300 个字：题注「N 个字」= 有记录的字（R-L10），不是按钮；
//      墙：自选了还没写（空心）排最前，其余最近一次新 → 旧；写错过 = 标准字 + 红点（K28，不画写错笔迹）；墨色四档（P56）；
//      列数 8（P1-E1b 设计系统：与成员数无关；≥ 430 宽 9 列、系统大字号 6 列）；最多 8 行；截断时「还有 N 个字 ›」（P27：分母含自选未写）；没截断时不显示。
//      写错过 / 快忘了块：名称 + 数 +「练这些字」文字按钮、一排最多 5 个标准字样字（不画朱点）；没有字时只有名称 + 0。
//      300 字首屏渲染计时（R-L09）；紧凑版（360×640）列数 6 / 4。
//   3. 导航（目标屏由 M3-2 / M3-4 / M3-5 / M3-6 注册；本卡只测 nav 调用，测试里用占位屏覆盖）：
//      墙上点字 → detail {char}（空心字同样）；「练这些字」→ library-list {kind}；还有 N 个字 → library-all。
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
  noRecordNote: '每天写的新字，从这个字库里挑。',
  emptyTitle: '你写下的字会留在这里',
  emptyText: '去「习字」写几个字，判断过对错，就会出现在这里。',
  caption: n => `${n} 个字`,
  more: n => `还有 ${n} 个字 ›`,
  // D27（阶段 1 P1-E3）：perRecordInk 默认开启 → tInk 取原槽（D27 改写为「第一次和最近一次的笔迹」）；关闭态的 …Glyph 见 47-ink-promises
  legend: '墨色越浅，越久没写。点一个字，看它第一次和最近一次的笔迹。',
  legendDark: '颜色越暗，越久没写。点一个字，看它第一次和最近一次的笔迹。',
  wrongTitle: '写错过',
  forgetTitle: '快忘了',
  practice: '练这些字',
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
      const practice = el.querySelector('[data-testid="library-card-practice"]');
      const sample = el.querySelector('[data-testid="library-card-mini-cell"]');
      return {
        tag: el.tagName, n: Number(el.dataset.n), empty: el.dataset.empty === 'true', text: txt(el),
        name: txt(el.querySelector('[data-testid="library-card-name"]')), count: txt(el.querySelector('[data-testid="library-card-count"]')),
        practice: practice ? { text: txt(practice), tag: practice.tagName, aria: practice.getAttribute('aria-label') } : null,
        mini: [...el.querySelectorAll('[data-testid="library-card-mini-cell"]')].map(m => ({ char: m.dataset.char, kind: m.dataset.kind })),
        marks: el.querySelectorAll('.sz-lib__mark, .sz-lib__dot').length, paragraphs: el.querySelectorAll('p').length,
        sampleBox: sample ? { w: Math.round(sample.getBoundingClientRect().width), h: Math.round(sample.getBoundingClientRect().height) } : null,
        sampleColor: el.querySelector('.sz-lib__char') ? getComputedStyle(el.querySelector('.sz-lib__char')).color : null,
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
      removed: {
        queryNote: !!q('library-query-note'), scope: !!q('library-switch'), count: !!q('library-count'), facts: all('library-fact').length,
        legend: !!q('library-legend') || all('library-legend-tone').length > 0, arrows: /→/.test(root.innerText),
      },
      caption: q('library-caption') ? { n: Number(q('library-caption').dataset.n), text: txt(q('library-caption')), tag: q('library-caption').tagName } : null,
      noRecordNote: txt(q('library-no-record-note')),
      empty: txt(q('library-empty')),
      wrong: card('wrong'),
      forget: card('forget'),
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
  step('0 chars: empty state; the same top block (query slot only — no note under it, no practice-range row, D49)');
  await setup(page, null, 0);
  let v = await lib(page);
  assert.equal(v.title, '字库', 'tab title 字库');
  assert.equal(v.state, 'empty', 'data-state=empty');
  assert.ok(v.slot, 'library-query-slot placeholder present (M3-3 mounts the query box)');
  assert.deepEqual(v.removed, { queryNote: false, scope: false, count: false, facts: 0, legend: false, arrows: false },
    'D49: no note under the query box, no 练习范围 / 更换字库 row (moved to settings), no big number, no facts, no legend, no → anywhere');
  assert.equal(v.noRecordNote, COPY.noRecordNote, 'R-L05 no-record note');
  assert.equal(v.empty, `${COPY.emptyTitle} ${COPY.emptyText}`, 'empty state: an empty cell (no glyph, C3-H / D53 ⑦) + title + R-L05 text');
  assert.equal(v.caption, null, 'no caption without a wall');
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

  // ------------------------------------------------------------------ 2. 5 / 30 / 300 个字
  for (const n of [5, 30, 300]) {
    const chars = deckChars.slice(0, n);
    const { state, rows } = seedOf(chars);
    step(`${n} chars: caption, the two practice blocks, wall order / tones / columns / truncation`);
    const ms = await setup(page, state, n);
    v = await lib(page);
    const members = n + HOLLOW.length;
    const cols = 8; // 设计系统 v1（P1-E1b）：8 列，与成员数无关
    const shown = Math.min(members, cols * 8);
    assert.equal(v.state, 'records', 'data-state=records');
    assert.deepEqual(v.caption, { n, text: COPY.caption(n), tag: 'P' }, `caption 「${n} 个字」 above the wall (R-L10): a small label, not a button`);
    assert.deepEqual(v.removed, { queryNote: false, scope: false, count: false, facts: 0, legend: false, arrows: false }, 'no note / scope row / big number / facts / legend / arrow');
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
    assert.deepEqual(v.cells.slice(0, 2).map(c => c.color), [tokenRgb('light', 'ink4'), tokenRgb('light', 'ink4')], 'D49 ⑤: the hollow (custom, unwritten) chars are outlined in ink4, not vermilion');
    const wrongList = byNew.filter(r => r.judgment === 'wrong').map(r => r.c);
    // D49：两个块同一个模板（名称 + 数 +「练这些字」文字按钮，下面一排最多 5 个标准字样字，不画朱点、不写说明句）
    assert.deepEqual([v.wrong.name, v.wrong.count, v.wrong.n], [COPY.wrongTitle, String(wrongList.length), wrongList.length], `wrong block: name + count ${wrongList.length}`);
    assert.deepEqual(v.wrong.practice, { text: COPY.practice, tag: 'BUTTON', aria: `${COPY.wrongTitle}，${COPY.practice}` }, 'wrong block: the text button 练这些字 (no arrow), named per block for screen readers');
    assert.deepEqual(v.wrong.mini, wrongList.slice(0, 5).map(c => ({ char: c, kind: 'sample' })), 'wrong block samples: the first 5, plain standard glyphs');
    assert.equal(v.wrong.marks, 0, 'no red dot on the block title or on the samples (D49)');
    assert.deepEqual(v.wrong.sampleBox, { w: 30, h: 30 }, 'samples are 30pt');
    assert.equal(v.wrong.sampleColor, tokenRgb('light', 'wall1'), 'samples are wall1');
    assert.equal(v.wrong.paragraphs, 0, 'no note sentence in the block');
    const forgetN = Math.min(3, rows.filter(r => r.judgment === 'correct' && r.i % 4 === 3).length);
    if (forgetN) {
      assert.deepEqual([v.forget.name, v.forget.count, v.forget.n], [COPY.forgetTitle, String(forgetN), forgetN], `forget block count ${forgetN} (K16 due)`);
      assert.equal(v.forget.practice && v.forget.practice.text, COPY.practice, 'forget block: the same text button');
      assert.ok(v.forget.mini.length > 0 && v.forget.mini.every(m => m.kind === 'sample'), 'forget samples use the same plain-glyph look as the wrong block');
      assert.equal(v.forget.paragraphs, 0, 'no note sentence in the block');
    } else {
      assert.ok(v.forget.empty && v.forget.practice === null && v.forget.mini.length === 0, 'no chars: just the name and 0 — no button, no samples');
      assert.equal(v.forget.text, `${COPY.forgetTitle} 0`, 'empty forget block');
    }
    assert.equal(v.note, COPY.legend, 'R-L03 note under the wall stays (D27 promise; the draft does not list it for removal)');
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

  step('wrong block empty: just 「写错过 0」, no button, no samples, no block chrome');
  {
    const { state } = seedOf(deckChars.slice(0, 4), { custom: false, forget: false, wrong: false });
    await setup(page, state, 4);
    v = await lib(page);
    assert.ok(v.wrong.empty && v.wrong.text === `${COPY.wrongTitle} 0`, 'empty wrong block: name + 0 only');
    assert.ok(v.wrong.practice === null && v.wrong.mini.length === 0, 'no 练这些字 button and no samples when there is nothing to practise');
    assert.equal(v.wrong.bg, 'rgba(0, 0, 0, 0)', 'no block background');
    assert.equal(v.wrong.border, '0px', 'no block border');
    assert.ok(v.forget.empty && v.forget.text === `${COPY.forgetTitle} 0`, 'empty forget block');
    assert.equal(v.more, null, 'no 还有 N 个字');
    assert.ok(v.cells.every(c => c.kind === 'ink'), 'no wrong / hollow cells');
  }

  // ------------------------------------------------------------------ 3. 导航
  step('navigation: wall cell → detail; hollow → detail; 练这些字 → list; 还有 N 个字 → all (no big number, no scope row any more)');
  {
    const { state, rows } = seedOf(deckChars.slice(0, 300));
    await setup(page, state, 300);
    v = await lib(page);
    const inkChar = v.cells.find(c => c.kind === 'ink').char;
    await expectPush(page, assert, `${SCREEN} [data-testid="library-wall-cell"][data-char="${inkChar}"]`, 'detail', { char: inkChar },
      `wall cell 「${inkChar}」 → nav.push('detail', {char})`);
    await expectPush(page, assert, `${SCREEN} [data-testid="library-wall-cell"][data-char="${HOLLOW[0]}"]`, 'detail', { char: HOLLOW[0] },
      'hollow cell → detail too (详情画「没有记录」一态)');
    await expectPush(page, assert, `${SCREEN} ${tid('library-card-wrong')} ${tid('library-card-practice')}`, 'library-list', { kind: 'wrong' }, "写错过「练这些字」→ library-list {kind:'wrong'}");
    await expectPush(page, assert, `${SCREEN} ${tid('library-card-forget')} ${tid('library-card-practice')}`, 'library-list', { kind: 'forget' }, "快忘了「练这些字」→ library-list {kind:'forget'}");
    await expectPush(page, assert, `${SCREEN} ${tid('library-more')}`, 'library-all', {}, '还有 N 个字 › → library-all');
    assert.equal(await page.locator(`${SCREEN} ${tid('library-switch')}`).count(), 0, '练习范围 is not on this page (it lives in 设置)');
    assert.equal(await page.locator(`${SCREEN} ${tid('library-count')}`).count(), 0, 'the count is a caption now, not a button');
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
  assert.equal(v.cells[0].color, tokenRgb('dark', 'ink4'), 'dark: the hollow char is ink4 too');
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
  step('360×640: 7 columns (cells stay ≥ 44pt; a short screen itself changes nothing); system large text (XXXL) → 6; 440 wide → 9 (P1-E1b)');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(120);
  await setup(page, seedOf(deckChars.slice(0, 300)).state, 300);
  v = await lib(page);
  assert.deepEqual({ cols: v.wall.cols, shown: v.wall.shown, more: v.wall.more }, { cols: 7, shown: 56, more: 302 - 56 }, '360×640, 300 chars: 7 cols × 8 rows (360 − 40 = 320 ÷ 44)');
  assert.equal(v.more.text, COPY.more(302 - 56), 'more text follows the truncation');
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
