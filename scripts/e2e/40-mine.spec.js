// M4-1 我的首页与练习记录（02 §6 M4-1；04 R-M01–R-M05、R-P01–R-P05、R-H08；03 P02 / P64；原型 ShiziScreen-第十稿交接版
// L24–L31、L88–L110）。
//
// 场景（钩子 seed + setClock 2026-09-24 周四）：
//   1. 没有记录：我的（R-M04 两句、这一周无墨点、不画字帖、菜单四行、备份行「还没有备份 ›」）；只有看过答案 / 跳过也算没有记录；
//      练习记录（「9 月还没有记录」+ R-P04、‹ › 都灰且 aria-disabled、没有可点的日子、字帖虚线框、没有今天那一行）。
//   2. 有记录（真实 mutator judgeInDraft 造数，含笔迹、看过答案 / 跳过、折叠月份、legacy.days、backupMeta）：
//      所有数字按 getState 独立重算后对照（这一周墨点、「N 月有记录 N 天」、墨点日子、字帖字数 / 顺序 / 角标 / 取墨记录 P02、
//      落款汉字数字、上次备份日期）；无补记痕迹（没有虚线圈 / 空心点 / 「补记」字样；看过答案、跳过、legacy 旧练习日都不画墨点）。
//   3. 练习记录：点有记录的日子列出那天的字（再点收起）；‹ › 翻月（字帖跟月份走，历史月说明换 R-P02.historyNote、没有保存入口、
//      没有今天那一行）；到最早有记录的月份 ‹ 变灰；本月 › 变灰；刷新后停在同一月份与日子。
//   4. 「今天的记录」：首页墨迹行（M2-1 setTodayRecordsAction）→ 练习记录本月、列出今天写的字（与墨迹行同一口径）。
//   5. 导航：练习记录 ›、字帖格子 → 单字详情 {char}、菜单四行 → settings / backup / annual / about（没注册的屏用占位屏）；
//      300 字：我的字帖只放最近 3 行 +「全部 ›」→ 练习记录本月（完整 300 格），首屏计时。
//   6. 图片入口桩（M4-5 setMineImageActions）：没注册时不显示；注册后我的 / 练习记录「保存图片 ›」传 {month}，
//      「{今天}写的字 / 这次的图片 · 保存图片 ›」传 {day, items}。
//   7. 浏览这些页面不写任何东西（写日志为空、getState 深相等）；深色 / 紧凑版 360×640 无横向滚动；每个 button 有无障碍名。

import { bootTestHost, tid, tokenRgb, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';

const dayNum = tag => (tag ? String(Number(tag.slice(8))) : ''); // P1-E7：月字帖角标只写「日」
const UNDER_NOTE = '浅色的字，这个月没有留下笔迹。点一个字看详情。';

const COPY = {
  mine: '我的',
  week: '这一周',
  records: '练习记录',
  emptyTitle: '还没有记录',
  emptyBody: '写一个字并判断对错，这里就会有记录。',
  settings: '设置',
  backup: '备份与恢复',
  backupSub: '记录只存在这台手机上',
  noBackup: '还没有备份', // 行尾的 › 自 P1-E1b 起是 svg chevron（components/Chevron.js），不在文字里
  lastBackup: d => `上次备份 ${d} ›`,
  annual: '年度报告',
  about: '关于拾字',
  monthDays: (m, n) => `${m} 月有记录 ${n} 天`,
  monthNone: m => `${m} 月还没有记录`,
  legend: '墨点表示这天有记录，不分对错。',
  emptyLegend: '写一个字并判断对错，这天就会有一个墨点。',
  sheetTitle: m => `${m} 月字帖`,
  sheetNote: '点一个字看详情，红色小字是那天的日期。',
  historyNote: '这里只能保存本月的字帖。',
  sheetEmpty: '这个月还没有可以放进图片的字',
  sheetOrder: '按第一次写下的先后排列',
  saveImage: '保存图片 ›',
  all: '全部 ›',
  dayChars: d => `${d}写的字`,
  todayImage: '这次的图片 · 保存图片 ›',
  noInk: '没有笔迹',
};

const CN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cn(n) {
  if (n === 2) return '两'; // D36：数量 2 写「两」（core/dates.js cnCount）
  if (n < 10) return CN[n];
  if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
  if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!rest) return CN[h] + '百';
  return CN[h] + '百' + (rest < 10 ? '零' + CN[rest] : (rest < 20 ? '一' : '') + cn(rest));
}
const md = day => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const tagOf = day => `${Number(day.slice(5, 7))}·${Number(day.slice(8, 10))}`;

/**
 * 造数：steps 用真实判断 mutator（judgeInDraft，一条记录一个会话，ink:true 时存笔迹），extra 追加看过答案 / 跳过记录；
 * folded / legacy / backupMeta 直接写。steps: [{char, judgment, day, ink}]（按时间先后）。
 */
async function seed(page, spec) {
  const res = await page.evaluate(async s => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(s.clock);
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    (s.steps || []).forEach((st, i) => {
      const at = new Date(`${st.day}T08:00:00`).getTime() + i * 1000;
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + st.char], at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + st.char, judgment: st.judgment, strokes: stroke, at, nextId, perRecordInk: !!st.ink });
      draft.sessions.A = null;
    });
    for (const x of s.extra || []) {
      const month = x.day.slice(0, 7);
      const at = new Date(`${x.day}T10:00:00`).getTime();
      const r = { id: nextId('r'), cardKey: 'base:' + x.char, char: x.char, sessionId: 's999', kind: x.kind, at, localDay: x.day,
        help: { hints: 0, answerSeen: x.kind === 'answer-seen', traced: false } };
      (draft.records[month] || (draft.records[month] = [])).push(r);
      draft.records[month].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    }
    if (s.folded) draft.records[s.folded.month] = s.folded;
    if (s.legacy) draft.legacy = s.legacy;
    if (s.backupAt) draft.backupMeta = { lastExportAt: s.backupAt, lastExportSig: null };
    if (!Object.keys(draft.ink).length) delete draft.ink;
    const r = window.__shiziTest.seed(draft);
    document.dispatchEvent(new Event('visibilitychange'));
    return { ok: !!(r && r.ok), r };
  }, { clock: CLOCK, ...spec });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
}

/** getState 口径的独立重算（不引用页面模块）。 */
async function oracle(page, month) {
  return page.evaluate(({ month: m, today }) => {
    const st = window.__shiziTest.getState();
    const judged = [];
    const days = new Set();
    const folded = {};
    for (const [key, v] of Object.entries(st.records || {})) {
      if (Array.isArray(v)) {
        for (const r of v) if (r.kind === 'judged') judged.push(r);
      } else if (v && v.folded) {
        for (const r of v.kept || []) if (r.kind === 'judged') judged.push(r);
        folded[key] = v;
        for (const [d, cs] of Object.entries(v.byDay || {})) if (cs.length) days.add(d);
      }
    }
    judged.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const r of judged) days.add(r.localDay);
    // D51 ⑤ 作品成员规则：写错的记录不进月字帖 / 某一天的字（日历的「写过的日子」照旧看全部判断）
    const work = judged.filter(r => r.judgment !== 'wrong' && r.source !== 'paper');
    const inMonth = work.filter(r => r.localDay.startsWith(m + '-'));
    // D42（解 P122）：每字在本月内从早到晚找留有墨迹的那一次（存下的墨迹表里有这条），一份都没有才取本月第一次。
    const hasInk = r => !!((st.ink || {})[r.localDay.slice(0, 7)] || {})[r.id];
    const byChar = new Map();
    for (const r of inMonth) {
      if (!byChar.has(r.char)) byChar.set(r.char, []);
      byChar.get(r.char).push(r);
    }
    const first = new Map([...byChar.entries()].map(([char, list]) => [char, list.find(hasInk) || list[0]]));
    let sheet;
    if (folded[m]) {
      const fd = new Map();
      for (const d of Object.keys(folded[m].byDay).sort()) for (const c of folded[m].byDay[d]) if (!fd.has(c)) fd.set(c, d);
      sheet = [...fd.entries()].map(([char, day]) => ({ char, day, record: '' }));
    } else {
      // 角标与排序同一个日子：这个字本月第一次作为成员出现的那天（T2-05），不是取墨那条的日子
      sheet = [...first.entries()].map(([char, r]) => ({ char, day: byChar.get(char)[0].localDay, record: r.id }));
    }
    let prev = null;
    sheet = sheet.map(c => {
      const tag = c.day !== prev ? c.day : '';
      prev = c.day;
      return { ...c, tag };
    });
    const dayChars = day => {
      // 那天每字：按最近一次的先后排；留的这条 = 那天内从晚到早第一条留有墨迹的（D42），都没有才是最近一次
      const map = new Map();
      for (const r of work) {
        if (r.localDay !== day) continue;
        const list = map.get(r.char) || [];
        list.push(r);
        map.delete(r.char);
        map.set(r.char, list);
      }
      return [...map.values()].map(list => ({ char: list[0].char, record: (list.slice().reverse().find(hasInk) || list[list.length - 1]).id }));
    };
    const monthDays = [...days].filter(d => d.startsWith(m + '-')).sort();
    return {
      days: [...days].sort(), monthDays, sheet, todayChars: dayChars(today),
      dayChars: Object.fromEntries(monthDays.map(d => [d, dayChars(d)])),
      inkIds: Object.values(st.ink || {}).flatMap(t => Object.keys(t)),
      lastExportAt: st.backupMeta ? st.backupMeta.lastExportAt : null,
    };
  }, { month, today: TODAY });
}

async function top(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { depth: s.depth, name: s.top ? s.top.n : null, params: s.top ? s.top.p || {} : {} };
  });
}

async function waitTop(page, name) {
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page, { settleMs: 450 });
}

async function waitParams(page, params) {
  await page.waitForFunction(async want => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return !!s.top && JSON.stringify(s.top.p || {}) === JSON.stringify(want);
  }, params, { timeout: 5000 }).catch(() => {});
}

async function goTab(page, tab) {
  await page.evaluate(async t => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(t);
  }, tab);
  await page.waitForFunction(async t => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === t;
  }, tab);
  await waitNavIdle(page, { settleMs: 450 });
}

async function back(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await waitNavIdle(page, { settleMs: 450 });
}

async function mineView(page) {
  return page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const all = id => [...root.querySelectorAll(`[data-testid="${id}"]`)];
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const home = q('mine-home');
    const sheet = q('mine-sheet');
    return {
      title: txt(root.querySelector('[data-page-title]')),
      state: home ? home.dataset.state : null,
      today: home ? home.dataset.today : null,
      empty: txt(q('mine-empty')),
      emptyTitle: txt(q('mine-empty-title')),
      emptyBody: txt(q('mine-empty-body')),
      weekTitle: txt(q('mine-week-title')),
      recordsLink: txt(q('mine-records')),
      week: all('mine-week-day').map(el => ({ day: el.dataset.day, has: el.dataset.has === 'true', today: el.dataset.today === 'true',
        future: el.dataset.future === 'true', dot: !!el.querySelector('[data-testid="mine-week-dot"]'), label: el.getAttribute('aria-label'),
        text: txt(el) })),
      sheet: sheet ? { month: sheet.dataset.month, count: Number(sheet.dataset.count), shown: Number(sheet.dataset.shown),
        truncated: sheet.dataset.truncated === 'true', days: Number(sheet.dataset.days) } : null,
      gridInPaper: (() => {
        const g = q('mine-sheet-grid');
        const pp = g && g.closest('.sz-mine__paper');
        if (!g || !pp) return null;
        const a = g.getBoundingClientRect();
        const b = pp.getBoundingClientRect();
        return a.top >= b.top && a.bottom <= b.bottom && a.left >= b.left && a.right <= b.right;
      })(),
      sheetTitle: txt(q('mine-sheet-title')),
      sheetSave: q('mine-sheet-save') ? txt(q('mine-sheet-save')) : null,
      sheetAll: q('mine-sheet-all') ? txt(q('mine-sheet-all')) : null,
      sign: txt(q('mine-sheet-sign')),
      seal: txt(q('mine-sheet-seal')),
      cells: all('mine-sheet-cell').map(el => ({ char: el.dataset.char, day: el.dataset.day, tag: el.dataset.tag, record: el.dataset.record,
        ink: el.dataset.ink, label: el.getAttribute('aria-label'), tagText: txt(el.querySelector('.sz-scell__tag')) })),
      menu: all('mine-menu').length ? [...q('mine-menu').querySelectorAll('button')].map(b => ({ testid: b.dataset.testid, to: b.dataset.to,
        text: txt(b) })) : [],
      backupSub: txt(q('mine-backup-sub')),
      backupValue: txt(q('mine-backup-value')),
      backupLast: q('mine-backup-value') ? q('mine-backup-value').dataset.last : null,
      year: txt(q('mine-annual-year')),
      bodyText: root.innerText,
      unnamedButtons: [...root.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.innerText || '').trim())
        .map(b => b.outerHTML.slice(0, 80)),
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1
        || [...root.querySelectorAll('*')].some(el => el.getBoundingClientRect().right > window.innerWidth + 1),
    };
  }, `${TOP} [data-testid="screen-mine"]`);
}

async function recordsView(page) {
  return page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const all = id => [...root.querySelectorAll(`[data-testid="${id}"]`)];
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const body = q('records-body');
    const btn = id => {
      const el = q(id);
      return el ? { disabled: el.disabled, aria: el.getAttribute('aria-disabled'), label: el.getAttribute('aria-label'),
        bg: getComputedStyle(el.querySelector('.sz-rec__arrowbg')).backgroundColor } : null;
    };
    const sheet = q('records-sheet');
    const dl = q('records-daylist');
    const cal = q('records-calendar');
    const calCells = cal ? [...cal.children] : [];
    return {
      title: txt(root.querySelector('[data-page-title]')),
      month: body ? body.dataset.month : null,
      current: body ? body.dataset.current === 'true' : null,
      recordDays: body ? Number(body.dataset.recordDays) : null,
      selected: body ? body.dataset.selected : null,
      monthText: txt(q('records-month')),
      year: txt(q('records-year')),
      prev: btn('records-prev'),
      next: btn('records-next'),
      heading: txt(q('records-title')),
      legend: txt(q('records-legend')),
      weekdays: all('records-weekday').map(txt),
      lead: calCells.slice(7).findIndex(el => el.dataset.testid === 'records-day'),
      days: all('records-day').map(el => ({ day: el.dataset.day, has: el.dataset.has === 'true', tag: el.tagName,
        today: el.dataset.today === 'true', future: el.dataset.future === 'true', pressed: el.getAttribute('aria-pressed'),
        dot: !!el.querySelector('[data-testid="records-day-dot"]'), label: el.getAttribute('aria-label') })),
      dashed: [...root.querySelectorAll('.sz-rec__cal *')].filter(el => getComputedStyle(el).borderStyle.includes('dashed')).length,
      daylist: dl ? { day: dl.dataset.day, count: Number(dl.dataset.count), title: txt(q('records-daylist-title')),
        cells: all('records-daylist-cell').map(el => ({ char: el.dataset.char, record: el.dataset.record, tag: el.dataset.tag, ink: el.dataset.ink })) } : null,
      sheet: sheet ? { month: sheet.dataset.month, count: Number(sheet.dataset.count), days: Number(sheet.dataset.days),
        current: sheet.dataset.current === 'true', folded: sheet.dataset.folded === 'true' } : null,
      sheetTitle: txt(q('records-sheet-title')),
      sheetSave: q('records-sheet-save') ? txt(q('records-sheet-save')) : null,
      // 阶段 1 P1-E7：练习记录页的月字帖是 month.js 的 MonthBody（6 列、骑线日期角标只写日、没墨的字画衬底、落款 song、说明句只在有衬底字时出现）
      sheetCells: all('records-sheet-cell').map(el => ({ char: el.dataset.char, day: el.dataset.day, tag: el.dataset.tag,
        record: el.dataset.record, ink: el.dataset.ink, tagText: txt(el.querySelector('[data-testid="month-tag"]')),
        noink: el.dataset.mode === 'under', label: el.getAttribute('aria-label') })),
      sign: txt(q('month-kuan')),
      order: txt(q('records-sheet-order')),
      seal: txt(q('month-seal')),
      note: txt(q('month-note')),
      sheetEmpty: txt(q('records-sheet-empty')),
      gridInPaper: (() => {
        const g = q('records-sheet-grid');
        return !!g && g.classList.contains('sz-month') && [...g.querySelectorAll('[data-testid="records-sheet-cell"]')].every(c => g.contains(c));
      })(),
      today: q('records-today') ? { text: txt(q('records-today')), day: q('records-today').dataset.day, n: Number(q('records-today').dataset.n) } : null,
      bodyText: root.innerText,
      unnamedButtons: [...root.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.innerText || '').trim())
        .map(b => b.outerHTML.slice(0, 80)),
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1
        || [...root.querySelectorAll('*')].some(el => el.getBoundingClientRect().right > window.innerWidth + 1),
    };
  }, `${TOP} [data-testid="records-screen"]`);
}

async function openRecordsFromMine(page) {
  await page.click(`${TOP} ${tid('mine-records')}`);
  await waitTop(page, 'records');
}

async function waitRecordsMonth(page, month) {
  await page.waitForFunction(({ sel, m }) => {
    const el = document.querySelector(`${sel} [data-testid="records-body"]`);
    return !!el && el.dataset.month === m;
  }, { sel: TOP, m: month });
  await page.waitForTimeout(80);
}

async function writes(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

async function stubMissing(page, names) {
  return page.evaluate(async list => {
    const { registerScreen, getScreen } = await import('/src/ui/router.js');
    const { html } = await import('/vendor/ui.js');
    const stubbed = [];
    for (const n of list) {
      if (getScreen(n)) continue;
      registerScreen(n, () => html`<div data-testid=${`stub-${n}`}>${n}</div>`);
      stubbed.push(n);
    }
    return stubbed;
  }, names);
}

// 丰富造数（今天 2026-09-24 周四）。
const RICH = {
  steps: [
    { char: '静', judgment: 'correct', day: '2026-08-20' },
    { char: '惊', judgment: 'wrong', day: '2026-08-20' },
    { char: '整', judgment: 'correct', day: '2026-08-28' },
    { char: '静', judgment: 'correct', day: '2026-09-01', ink: true },
    { char: '谁', judgment: 'correct', day: '2026-09-01' },
    { char: '题', judgment: 'wrong', day: '2026-09-01' },
    { char: '静', judgment: 'wrong', day: '2026-09-08', ink: true },
    { char: '慢', judgment: 'correct', day: '2026-09-08' },
    { char: '额', judgment: 'wrong', day: '2026-09-14' },
    { char: '您', judgment: 'correct', day: '2026-09-22' },
    { char: '题', judgment: 'wrong', day: '2026-09-22' },
    { char: '静', judgment: 'correct', day: '2026-09-22', ink: true },
    { char: '数', judgment: 'correct', day: '2026-09-24' },
    { char: '感', judgment: 'wrong', day: '2026-09-24', ink: true },
    { char: '数', judgment: 'wrong', day: '2026-09-24' },
  ],
  extra: [
    { char: '虽', kind: 'skipped', day: '2026-09-21' },
    { char: '户', kind: 'answer-seen', day: '2026-09-23' },
  ],
  folded: { folded: true, month: '2026-06', byDay: { '2026-06-03': ['永', '和'], '2026-06-10': ['和', '天'] }, chars: ['永', '和', '天'], kept: [] },
  legacy: { importedAt: new Date('2026-07-01T08:00:00').getTime(), fromKeys: ['shizi.memory.v1'], days: ['2026-09-05', '2026-09-23'], report: {} },
  backupAt: new Date('2026-09-01T12:00:00').getTime(),
};

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  const stubbed = await stubMissing(page, ['settings', 'backup', 'annual', 'about']);
  console.log(`stub screens: ${stubbed.join(',') || '(none)'}`);
  // 图片去处由 M4-5 注册（ui/images-entry.js）；先摘掉，测「没注册时不显示」，第 6 步用桩再测调用参数，最后还原。
  const hadImage = await page.evaluate(async () => {
    const m = await import('/src/ui/screens/mine/records.js');
    window.__origImg = m.getMineImageActions();
    m.setMineImageActions({ month: null, today: null });
    return { month: !!window.__origImg.month, today: !!window.__origImg.today };
  });
  console.log(`image actions registered at boot: ${JSON.stringify(hadImage)}`);

  // ------------------------------------------------------------------ 1. 没有记录
  step('no records: mine empty state (R-M04), week without dots, no sheet, menu four rows, backup row');
  await goTab(page, 'mine');
  await seed(page, {});
  await page.waitForFunction(sel => {
    const el = document.querySelector(`${sel} [data-testid="mine-home"]`);
    return el && el.dataset.state === 'empty' && el.dataset.today === '2026-09-24';
  }, TOP);
  let v = await mineView(page);
  assert.equal(v.title, COPY.mine, 'tab title 我的');
  assert.equal(v.emptyTitle, COPY.emptyTitle, 'R-M04 title');
  assert.equal(v.emptyBody, COPY.emptyBody, 'R-M04 body');
  assert.equal(v.weekTitle, COPY.week, 'R-M01 这一周');
  assert.equal(v.recordsLink, `${COPY.records} ›`, '练习记录 › link');
  assert.deepEqual(v.week.map(d => d.day), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'],
    'this week = Mon 21 … Sun 27 (Monday first)');
  assert.deepEqual(v.week.map(d => d.text.split(' ')[0]), ['一', '二', '三', '四', '五', '六', '日'], 'weekday names');
  assert.deepEqual(v.week.filter(d => d.today).map(d => d.day), [TODAY], 'today flagged');
  assert.deepEqual(v.week.filter(d => d.future).map(d => d.day), ['2026-09-25', '2026-09-26', '2026-09-27'], 'future days flagged');
  assert.equal(v.week.filter(d => d.dot).length, 0, 'no ink dots');
  assert.equal(v.sheet, null, 'no month sheet in the empty state');
  assert.deepEqual(v.menu.map(m => [m.testid, m.to]), [['mine-menu-settings', 'settings'], ['mine-menu-backup', 'backup'],
    ['mine-menu-annual', 'annual'], ['mine-menu-about', 'about']], 'menu order and targets (prototype L28)');
  assert.equal(v.menu[0].text, COPY.settings, 'settings row (the trailing › is an svg chevron since P1-E1b)');
  assert.equal(v.backupSub, COPY.backupSub, 'R-M03 backup sub line');
  assert.equal(v.backupValue, COPY.noBackup, 'R-M03 no backup');
  assert.equal(v.year, '2026', 'annual row shows this year');
  assert.equal(v.menu[3].text, COPY.about, 'about row (svg chevron)');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');

  step('only answer-seen / skipped records → still empty');
  await seed(page, { extra: [{ char: '户', kind: 'answer-seen', day: TODAY }, { char: '虽', kind: 'skipped', day: '2026-09-22' }] });
  await page.waitForTimeout(100);
  v = await mineView(page);
  assert.equal(v.state, 'empty', 'answer-seen / skipped do not count as records');
  assert.equal(v.week.filter(d => d.dot).length, 0, 'no dots for answer-seen / skipped days');

  step('no records: practice log (records empty design)');
  await openRecordsFromMine(page);
  let r = await recordsView(page);
  assert.equal(r.title, COPY.records, 'page title 练习记录');
  assert.equal(r.month, '2026-09', 'opens this month');
  assert.equal(r.monthText, '9 月', 'month head');
  assert.equal(r.year, '2026', 'year');
  assert.equal(r.heading, COPY.monthNone(9), '「9 月还没有记录」');
  assert.equal(r.legend, COPY.emptyLegend, 'R-P04');
  assert.deepEqual([r.prev.disabled, r.prev.aria, r.next.disabled, r.next.aria], [true, 'true', true, 'true'], 'both arrows grey + aria-disabled');
  assert.deepEqual([r.prev.label, r.next.label], ['上个月', '下个月'], 'arrow accessible names');
  assert.deepEqual(r.weekdays, ['一', '二', '三', '四', '五', '六', '日'], 'calendar weekdays');
  assert.equal(r.lead, 1, 'Sep 2026 starts on Tuesday → one blank');
  assert.equal(r.days.length, 30, '30 days');
  assert.equal(r.days.filter(d => d.tag === 'BUTTON').length, 0, 'no clickable days');
  assert.equal(r.sheetTitle, COPY.sheetTitle(9), 'sheet title');
  assert.equal(r.sheetEmpty, COPY.sheetEmpty, 'sheet empty dashed box');
  assert.equal(r.sheetSave, null, 'no save entry');
  assert.equal(r.today, null, 'no today row');
  assert.deepEqual(r.unnamedButtons, [], 'every button has an accessible name');
  await back(page);

  // ------------------------------------------------------------------ 2. 有记录
  step('records: mine numbers all from records (getState oracle)');
  await seed(page, RICH);
  await page.waitForFunction(sel => {
    const el = document.querySelector(`${sel} [data-testid="mine-home"]`);
    return el && el.dataset.state === 'records';
  }, TOP);
  await page.waitForTimeout(100);
  const o9 = await oracle(page, '2026-09');
  // D27（阶段 1 P1-E3）：judgeInDraft 每次判断回收这个字中间那次的墨迹——静 的 9-1、9-8 既非第一次（8-20，没存墨迹）也非最近一次（9-22），
  // 写 9-22 时已回收；留下的是 静 9-22（最近一次）与 感 9-24（唯一一次）。
  const jingRecs = (await page.evaluate(() => window.__shiziTest.getState().records['2026-09'])).filter(r => r.char === '静');
  const ganRec = (await page.evaluate(() => window.__shiziTest.getState().records['2026-09'])).find(r => r.char === '感');
  assert.deepEqual(o9.inkIds.slice().sort(), [jingRecs[2].id, ganRec.id].sort(), 'D27: only first / latest judged ink survives (静 9-22, 感)');
  v = await mineView(page);
  assert.equal(v.empty, null, 'no empty block');
  assert.deepEqual(v.week.filter(d => d.dot).map(d => d.day), v.week.map(d => d.day).filter(d => o9.days.includes(d)),
    'week dots = days with judged records (oracle)');
  assert.deepEqual(v.week.filter(d => d.dot).map(d => d.day), ['2026-09-22', '2026-09-24'],
    'week dots 22 / 24 (21 skipped only, 23 answer-seen + legacy only → no dot)');
  assert.equal(v.week.find(d => d.day === '2026-09-22').label, '9 月 22 日，有记录', 'dot day accessible name');
  assert.deepEqual(v.sheet, { month: '2026-09', count: o9.sheet.length, shown: o9.sheet.length, truncated: false, days: o9.monthDays.length },
    'sheet counts from records');
  assert.equal(v.sheetTitle, COPY.sheetTitle(9), 'R-P02 「9 月字帖」');
  assert.equal(v.gridInPaper, true, 'sheet grid laid out inside the paper card');
  assert.deepEqual(v.cells.map(c => [c.char, c.day, c.tag, c.record]), o9.sheet.map(c => [c.char, c.day, c.tag, c.record]),
    'sheet order / dates / tags / picked record = oracle (P02 first, D42: first one this month that still has ink)');
  assert.deepEqual(v.cells.map(c => c.char).join(''), '静谁慢您数', 'first-appearance order of the work members: the wrong-only 题 / 额 / 感 are not on the sheet (D51 ⑤)');
  const jing = v.cells.find(c => c.char === '静');
  // D42（解 P122）：9-1、9-8 两次的墨迹已按 D27 回收（中间那次）；月字帖在本月内从早到晚找留有墨迹的那一次 → 画 9-22 的笔迹，
  // 不再是「9-1 没有笔迹」；但角标与排序用的是 firstDay（9-1），不跟着取墨那条走（T2-05 / N2-07）。8 月那次（8-20，种子没存墨迹）在时间段外，不进候选。
  assert.equal(jing.day, '2026-09-01', '静 is placed and numbered on the day it was first written as a work this month (9-1, firstDay), T2-05');
  assert.equal(jing.ink, 'true', '静 cell draws 9-22\'s own ink (D42 解 P122)');
  assert.equal(v.cells.some(c => c.char === '感' || c.char === '题' || c.char === '额'), false, 'wrong-only chars are not on the sheet (D51 ⑤)');
  // Q2-4（复测 simB D5）：我的页字帖卡片的日期角标与月字帖页一致——只写「日」、t11 hei 500 ink3；V2-09：画在格内左上角，不再骑线、不压格线。
  assert.equal(jing.tagText, '1', 'date tag = the sort day (firstDay); day only, like the month page (Q2-4 / T2-05)');
  const tagGeo = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="mine-sheet-cell"]')].find(c => c.dataset.tag);
    const tag = cell.querySelector('.sz-scell__tag');
    const sq = cell.querySelector('.sz-scell__sq');
    const cs = getComputedStyle(tag);
    const r = tag.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const q = sq.getBoundingClientRect();
    return { size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily.split(',')[0].trim(), straddles: r.top < c.top && r.bottom > c.top,
      inside: r.top >= c.top && r.left >= c.left && r.right <= c.right && r.bottom <= c.bottom, bg: cs.backgroundColor,
      glyphScaled: Math.abs(q.width - c.width) > 1, tagText: tag.textContent.trim(), glyphClear: r.bottom <= q.top + 6 };
  });
  assert.deepEqual([tagGeo.size, tagGeo.weight], ['11px', '500'], 'tag is t11 / 500 (same as the month page)');
  assert.equal(tagGeo.straddles, false, 'tag no longer rides the cell’s top edge (V2-09)');
  assert.equal(tagGeo.inside, true, 'tag sits inside the cell’s top-left corner, off every grid line');
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(tagGeo.bg), 'no colour block behind the number');
  assert.equal(tagGeo.glyphScaled, false, 'the ink is not shrunk to make room for the tag');
  assert.equal(v.cells.find(c => c.char === '数').ink, 'false', 'no ink → 没有笔迹 (10.12, no borrowing)');
  assert.equal(v.cells.find(c => c.char === '谁').tagText, null, 'same sort day as the previous cell (静, 9-01) → no tag');
  assert.equal(jing.label, '静 · 9 月 1 日，9 月 22 日 的笔迹', 'cell accessible name: the sort day, plus the day of the ink drawn (N2-07)');
  assert.equal(v.sign, `二〇二六年九月 · 有记录${cn(o9.monthDays.length)}天 · ${cn(o9.sheet.length)}个字`, 'signature in Chinese numerals');
  assert.equal(v.sign, '二〇二六年九月 · 有记录五天 · 五个字', 'signature literal');
  assert.equal(v.seal, '字', 'seal');
  assert.equal(v.sheetSave, null, 'save image hidden until M4-5 registers');
  assert.equal(v.sheetAll, null, 'no 全部 › when ≤ 3 rows');
  assert.equal(v.backupValue, COPY.lastBackup(md('2026-09-01')), 'last backup date from backupMeta');
  assert.equal(v.backupLast, '2026-09-01', 'data-last');
  assert.ok(!/补记/.test(v.bodyText), 'no 补记 wording');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');
  assert.equal(v.hScroll, false, 'no horizontal overflow (393)');

  step('records: practice log this month — numbers, dots, sheet, no backfill traces');
  const raw0 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  await openRecordsFromMine(page);
  await waitParams(page, { month: '2026-09', day: null });
  r = await recordsView(page);
  assert.deepEqual((await top(page)).params, { month: '2026-09', day: null }, 'view params written back');
  assert.equal(r.recordDays, o9.monthDays.length, 'record days = oracle');
  assert.equal(r.heading, COPY.monthDays(9, o9.monthDays.length), 'R-P01 「9 月有记录 N 天」');
  assert.equal(r.heading, '9 月有记录 5 天', 'literal 5 days');
  assert.equal(r.legend, COPY.legend, 'R-P01 legend');
  assert.deepEqual(r.days.filter(d => d.dot).map(d => d.day), o9.monthDays, 'dots = oracle days');
  assert.deepEqual(r.days.filter(d => d.tag === 'BUTTON').map(d => d.day), o9.monthDays, 'only record days are buttons');
  assert.ok(!r.days.find(d => d.day === '2026-09-05').dot, 'legacy.days 9-05 not drawn (R-P01: only record days)');
  assert.ok(!r.days.find(d => d.day === '2026-09-23').dot, 'answer-seen day has no dot');
  assert.equal(r.dashed, 0, 'no dashed circles (no backfill)');
  assert.ok(!/补记/.test(r.bodyText), 'no 补记 wording');
  assert.deepEqual(r.days.filter(d => d.today).map(d => d.day), [TODAY], 'today flagged');
  assert.equal(r.days.filter(d => d.future).length, 6, '25–30 future');
  assert.deepEqual([r.prev.disabled, r.next.disabled, r.next.aria], [false, true, 'true'], 'prev enabled, next grey on this month');
  assert.ok(r.prev.bg !== 'rgba(0, 0, 0, 0)', 'arrow has a background (R-P05 箭头加底)');
  assert.deepEqual(r.sheetCells.map(c => [c.char, c.day, c.tag, c.record]), o9.sheet.map(c => [c.char, c.day, dayNum(c.tag), c.record]),
    'records sheet = oracle (same data as mine; the day tag now reads the day number only)');
  assert.equal(r.sign, '二〇二六年九月 五字', '落款 (P1-E7: 月份 + 全角空格 + 字数，不再写有记录几天；txt() 把全角空格折成一个空格)');
  assert.equal(r.gridInPaper, true, 'records sheet grid laid out inside the month paper');
  assert.equal(r.order, null, 'P1-E7: the order line moved to the month page subtitle');
  assert.equal(r.seal, '字', 'seal');
  assert.equal(r.note, UNDER_NOTE, 'P1-E7: the only note is the under-glyph sentence (there is an under cell: 数)');
  assert.equal(r.sheetCells.find(c => c.char === '数').noink, true, 'no ink all month → an under cell (drawn as the reference outline, no 「没有笔迹」 text)');
  assert.equal(r.today, null, 'today row hidden until M4-5 registers');
  assert.equal(r.daylist, null, 'no day selected');
  assert.deepEqual(r.unnamedButtons, [], 'every button has an accessible name');
  assert.equal(r.hScroll, false, 'no horizontal overflow');

  step('tap a record day → that day\'s chars (R-P05); tap again → closed');
  await page.click(`${TOP} [data-testid="records-day"][data-day="2026-09-08"]`);
  await page.waitForSelector(`${TOP} ${tid('records-daylist')}`);
  r = await recordsView(page);
  assert.equal(r.daylist.title, COPY.dayChars(md('2026-09-08')), 'list title');
  assert.deepEqual(r.daylist.cells.map(c => [c.char, c.record]), o9.dayChars['2026-09-08'].map(c => [c.char, c.record]), 'chars of the day (oracle)');
  assert.equal(r.days.find(d => d.day === '2026-09-08').pressed, 'true', 'aria-pressed');
  await waitParams(page, { month: '2026-09', day: '2026-09-08' });
  assert.deepEqual((await top(page)).params, { month: '2026-09', day: '2026-09-08' }, 'selected day in params');
  await page.waitForTimeout(450);
  await page.click(`${TOP} [data-testid="records-day"][data-day="2026-09-08"]`);
  await page.waitForFunction(sel => !document.querySelector(`${sel} [data-testid="records-daylist"]`), TOP);
  await waitParams(page, { month: '2026-09', day: null });
  assert.deepEqual((await top(page)).params, { month: '2026-09', day: null }, 'closed');

  step('month navigation: sheet follows the month; history note; folded month; ends grey; reload keeps the view');
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('records-prev')}`);
  await waitRecordsMonth(page, '2026-08');
  const o8 = await oracle(page, '2026-08');
  r = await recordsView(page);
  assert.equal(r.heading, COPY.monthDays(8, o8.monthDays.length), '「8 月有记录 2 天」');
  assert.equal(o8.monthDays.length, 2, 'oracle 2 days');
  assert.equal(r.lead, 5, 'Aug 2026 starts on Saturday');
  assert.equal(r.sheetTitle, COPY.sheetTitle(8), 'sheet follows the month (R-P05)');
  assert.deepEqual(r.sheetCells.map(c => [c.char, c.tag, c.record]), o8.sheet.map(c => [c.char, dayNum(c.tag), c.record]), 'August sheet = oracle');
  assert.equal(r.note, r.sheetCells.some(c => c.noink) ? UNDER_NOTE : null, 'P1-E7: no 「这里只能保存本月的字帖」 any more; the note appears only with under cells');
  assert.equal(r.sheetSave, null, 'save entry only when M4-5 has registered it (any month can be saved since P1-E7 / D42; stubbed out here)');
  assert.equal(r.today, null, 'no today row on a past month');
  assert.deepEqual([r.prev.disabled, r.next.disabled], [false, false], 'both arrows enabled');
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('records-prev')}`);
  await waitRecordsMonth(page, '2026-07');
  r = await recordsView(page);
  assert.equal(r.heading, COPY.monthNone(7), 'empty month between records');
  assert.equal(r.sheetEmpty, COPY.sheetEmpty, 'empty sheet box');
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('records-prev')}`);
  await waitRecordsMonth(page, '2026-06');
  const o6 = await oracle(page, '2026-06');
  r = await recordsView(page);
  assert.equal(r.heading, COPY.monthDays(6, 2), 'folded month days from byDay');
  assert.deepEqual(r.days.filter(d => d.dot).map(d => d.day), o6.monthDays, 'folded dots = oracle');
  assert.equal(r.sheet.folded, true, 'folded sheet');
  assert.deepEqual(r.sheetCells.map(c => [c.char, c.tag, c.ink]), [['永', '3', 'false'], ['和', '', 'false'], ['天', '10', 'false']],
    'folded sheet: chars by first day, no ink');
  assert.deepEqual([r.prev.disabled, r.prev.aria], [true, 'true'], 'earliest month → ‹ grey');
  await page.click(`${TOP} [data-testid="records-day"][data-day="2026-06-10"]`);
  await page.waitForSelector(`${TOP} ${tid('records-daylist')}`);
  r = await recordsView(page);
  assert.deepEqual(r.daylist.cells.map(c => c.char), ['和', '天'], 'folded day lists its chars');
  await waitParams(page, { month: '2026-06', day: '2026-06-10' });
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await page.evaluate(iso => window.__shiziTest.setClock(iso), CLOCK);
  await stubMissing(page, ['settings', 'backup', 'annual', 'about']);
  await waitRecordsMonth(page, '2026-06');
  const w0 = await writes(page); // 写日志随页面重载清零：从这里起算
  r = await recordsView(page);
  assert.equal(r.selected, '2026-06-10', 'reload keeps month + selected day');
  await page.waitForTimeout(450);
  for (const m of ['2026-07', '2026-08', '2026-09']) {
    await page.click(`${TOP} ${tid('records-next')}`);
    await waitRecordsMonth(page, m);
    await page.waitForTimeout(450);
  }
  r = await recordsView(page);
  assert.deepEqual([r.current, r.next.disabled, r.selected], [true, true, ''], 'back to this month; › grey; selection cleared on month change');

  step('sheet cell → detail {char}; back returns to the same view');
  await page.click(`${TOP} [data-testid="records-sheet-cell"][data-char="慢"]`);
  await waitTop(page, 'detail');
  assert.deepEqual((await top(page)).params, { char: '慢' }, 'detail {char}');
  await back(page);
  await waitTop(page, 'records');
  r = await recordsView(page);
  assert.equal(r.month, '2026-09', 'back on the same month');
  await back(page);
  await waitTop(page, 'mine');

  step('mine: sheet cell → detail; menu rows → their screens');
  await page.click(`${TOP} [data-testid="mine-sheet-cell"][data-char="额"]`);
  await waitTop(page, 'detail');
  assert.deepEqual((await top(page)).params, { char: '额' }, 'mine sheet cell → detail {char} (R-M01)');
  await back(page);
  for (const [testid, name] of [['mine-menu-settings', 'settings'], ['mine-menu-backup', 'backup'], ['mine-menu-annual', 'annual'], ['mine-menu-about', 'about']]) {
    await page.click(`${TOP} ${tid(testid)}`);
    await waitTop(page, name);
    const tp = await top(page);
    assert.deepEqual([tp.depth, tp.name], [1, name], `${testid} → push ${name}`);
    await back(page);
    await waitTop(page, 'mine');
  }

  step('browsing mine / records / detail wrote nothing');
  assert.equal(await writes(page) - w0, 0, 'no writes since reload (write log unchanged)');
  const raw1 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  assert.deepEqual(raw1, raw0, 'every shizi.* storage key byte-equal before / after browsing (incl. the reload)');

  // ------------------------------------------------------------------ 4. 今天的记录（首页墨迹行）
  step('home ink row → 今天的记录 = practice log with today\'s chars (R-H08)');
  await goTab(page, 'home');
  const row = await page.evaluate(sel => {
    const el = document.querySelector(`${sel} [data-testid="home-ink-row"]`);
    return el ? { tag: el.tagName, chars: [...el.querySelectorAll('[data-testid="home-ink-item"]')].map(i => i.dataset.char) } : null;
  }, TOP);
  assert.equal(row && row.tag, 'BUTTON', 'ink row is a button now that M4-1 registered the target');
  await page.click(`${TOP} ${tid('home-ink-row')}`);
  await waitTop(page, 'records');
  assert.deepEqual((await top(page)).params, { month: '2026-09', day: TODAY }, 'pushed records {month, day: today}');
  await page.waitForSelector(`${TOP} ${tid('records-daylist')}`);
  r = await recordsView(page);
  assert.deepEqual(r.daylist.cells.map(c => c.char), o9.todayChars.map(c => c.char), 'today\'s chars (oracle)');
  assert.deepEqual(r.daylist.cells.map(c => c.char), row.chars, 'same set and order as the home ink row');
  assert.deepEqual(r.daylist.cells.map(c => c.record), o9.todayChars.map(c => c.record), 'latest record of each char today');
  assert.equal(r.daylist.title, COPY.dayChars('9 月 24 日'), '「9 月 24 日写的字」');
  await back(page);
  await goTab(page, 'mine');

  // ------------------------------------------------------------------ 6. 图片入口桩
  step('image entries (M4-5 stub): registered → shown, called with {month} / {day, items}');
  await page.evaluate(async () => {
    const { setMineImageActions, getMineImageActions } = await import('/src/ui/screens/mine/records.js');
    window.__origImg = getMineImageActions(); // 重载后是 M4-5 重新注册的真去处
    window.__imgCalls = [];
    setMineImageActions({
      month: p => window.__imgCalls.push({ kind: 'month', month: p.month, n: p.sheet.cells.length }),
      today: p => window.__imgCalls.push({ kind: 'today', day: p.day, chars: p.items.map(i => i.char) }),
    });
  });
  await seed(page, RICH); // 重新发布状态 → 重画
  await page.waitForSelector(`${TOP} ${tid('mine-sheet-save')}`);
  v = await mineView(page);
  assert.equal(v.sheetSave, COPY.saveImage, 'mine 保存图片 ›');
  await page.click(`${TOP} ${tid('mine-sheet-save')}`);
  await openRecordsFromMine(page);
  r = await recordsView(page);
  assert.equal(r.sheetSave, COPY.saveImage, 'records 保存图片 › (same entry)');
  assert.equal(r.today && r.today.text, `${COPY.dayChars('9 月 24 日')} ${COPY.todayImage}`, 'R-P03 today row');
  assert.equal(r.today.n, o9.todayChars.length, 'today row n');
  await page.click(`${TOP} ${tid('records-sheet-save')}`);
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('records-today')}`);
  const calls = await page.evaluate(() => window.__imgCalls);
  assert.deepEqual(calls, [
    { kind: 'month', month: '2026-09', n: 8 },
    { kind: 'month', month: '2026-09', n: 8 },
    { kind: 'today', day: TODAY, chars: o9.todayChars.map(c => c.char) },
  ], 'image actions called with this month / today (each char\'s latest record today)');
  await page.evaluate(async () => {
    const { setMineImageActions } = await import('/src/ui/screens/mine/index.js');
    setMineImageActions({ month: window.__origImg.month, today: window.__origImg.today });
  });
  await back(page);

  // ------------------------------------------------------------------ 5. 300 字
  step('300 chars this month: mine sheet = last 3 rows + 全部 › (R-M05); records shows all; timing');
  const deckChars = await page.evaluate(async () => {
    const { getDeck } = await import('/src/data/deck.js');
    return getDeck().keys.filter(k => k.startsWith('base:')).map(k => k.slice(5)).slice(0, 300);
  });
  assert.equal(deckChars.length, 300, 'deck provides 300 chars');
  const big = { steps: deckChars.map((c, i) => ({ char: c, judgment: i % 7 === 0 ? 'wrong' : 'correct',
    day: `2026-09-${String(1 + Math.floor(i / 13)).padStart(2, '0')}` })) };
  const t0 = Date.now();
  await seed(page, big);
  await page.waitForFunction(sel => {
    const el = document.querySelector(`${sel} [data-testid="mine-sheet"]`);
    return el && el.dataset.count === '300';
  }, TOP);
  const mineMs = Date.now() - t0;
  const oBig = await oracle(page, '2026-09');
  v = await mineView(page);
  assert.equal(v.sheet.count, 300, '300 chars in the sheet');
  assert.equal(v.sheet.truncated, true, 'truncated');
  const lastRows = oBig.sheet.slice(Math.floor((300 - 1) / 7) * 7 - 14);
  assert.equal(v.cells.length, lastRows.length, `shows the last 3 rows (${lastRows.length} cells)`);
  assert.ok(v.cells.length <= 21 && v.cells.length > 14, 'between 15 and 21 cells');
  assert.deepEqual(v.cells.map(c => c.char), lastRows.map(c => c.char), 'most recent chars, oldest first');
  assert.equal(v.cells[0].tag, lastRows[0].day, 'first visible cell re-tagged with its date');
  assert.equal(v.sheetAll, COPY.all, '「全部 ›」');
  assert.equal(v.sign, `二〇二六年九月 · 有记录${cn(oBig.monthDays.length)}天 · 三百个字`, 'signature counts all 300');
  assert.equal(v.hScroll, false, 'no horizontal overflow');
  console.log(`mine 300: seed→render ${mineMs}ms`);
  assert.ok(mineMs < 3000, `mine 300 chars renders within 3s (${mineMs}ms)`);
  const t1 = Date.now();
  await page.click(`${TOP} ${tid('mine-sheet-all')}`);
  await waitTop(page, 'records');
  assert.equal((await top(page)).params.month, '2026-09', '全部 › → records this month');
  await page.waitForFunction(sel => document.querySelectorAll(`${sel} [data-testid="records-sheet-cell"]`).length === 300, TOP);
  const recMs = Date.now() - t1;
  console.log(`records 300: push→300 cells ${recMs}ms (incl. 450ms settle)`);
  r = await recordsView(page);
  assert.deepEqual(r.sheetCells.map(c => c.char), oBig.sheet.map(c => c.char), 'all 300 chars in order');
  assert.equal(r.heading, COPY.monthDays(9, oBig.monthDays.length), 'record days');
  assert.equal(r.hScroll, false, 'no horizontal overflow');
  await back(page);

  // ------------------------------------------------------------------ 7. 深色 / 紧凑
  step('dark (system and data-theme) + compact 360×640: no overflow, names');
  await seed(page, RICH);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(200);
  v = await mineView(page);
  const darkBg = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} .sz-mine__paper`)).backgroundColor, TOP);
  assert.equal(darkBg, tokenRgb('dark', 'sheet'), 'paper card uses dark --sheet (D43: was --c #2D2823)');
  assert.equal(v.hScroll, false, 'mine 360: no horizontal overflow');
  await openRecordsFromMine(page);
  r = await recordsView(page);
  assert.equal(r.hScroll, false, 'records 360: no horizontal overflow');
  assert.deepEqual(r.unnamedButtons, [], 'names in dark / compact');
  await back(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(100);
  const forced = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} .sz-mine__paper`)).backgroundColor, TOP);
  assert.equal(forced, tokenRgb('dark', 'sheet'), 'data-theme=dark forced');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.setViewportSize({ width: 393, height: 852 });
}
