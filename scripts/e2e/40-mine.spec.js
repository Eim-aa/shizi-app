// M4-1 我的首页与练习记录（02 §6 M4-1；04 R-M01–R-M05、R-P01–R-P05、R-H08；03 P02 / P64）；D63 起「我的」页按丙重做（概览三个数 → {月}字帖标题行 → 提醒 / 练习范围 / 外观 → 备份 / 年度报告 / 关于 → 版本号）。
// 「我的」页自己的新结构另见 110-r7-m1-mine.spec.js（顺序、概览算法、提醒页、外观三段、没有设置页）；本 spec 管数字口径与练习记录。
//
// 场景（钩子 seed + setClock 2026-09-24 周四）：
//   1. 没有记录：我的（R-M04 两句、概览三个 0、不画字帖、行与目标、备份行「还没有备份」）；只有看过答案 / 跳过也算没有记录；
//      练习记录（「9月还没有记录」+ R-P04、‹ › 都灰且 aria-disabled、没有可点的日子、没有今天那一行）。
//   2. 有记录（真实 mutator judgeInDraft 造数，含笔迹、看过答案 / 跳过、折叠月份、legacy.days、backupMeta）：
//      所有数字按 getState 独立重算后对照（概览天数含旧版练习日、「N 月有记录 N 天」、墨点日子、字帖字数 / 顺序 / 角标 / 取墨记录 P02、
//      落款汉字数字、上次备份日期）；无补记痕迹。
//   3. 练习记录：点有记录的日子列出那天的字（再点收起）；‹ › 翻月；到最早有记录的月份 ‹ 变灰；本月 › 变灰；刷新后停在同一月份与日子。
//   4. 「今天的记录」：练习记录本月、列出今天写的字。
//   5. 导航：字帖标题行 → 练习记录本月（D63）、字帖格子 → 单字详情 {char}、行 → remind / library-switch / backup / annual / about；
//      300 字：我的字帖只放最近两行（列数按整月字数定）+ 标题行「全部 300 字」→ 练习记录本月（完整 300 格），首屏计时。
//   6. 图片入口桩（M4-5 setMineImageActions）：没注册时练习记录不显示；注册后「保存图片」传 {month}，「{今天}写的字 / 这次的图片 · 保存图片」传 {day, items}；「我的」页不再有保存图片（D63）。
//   7. 浏览这些页面不写任何东西（写日志为空、getState 深相等）；深色 / 紧凑版 360×640 无横向滚动；每个 button 有无障碍名。

import { bootTestHost, tid, tokenRgb, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';

const dayNum = tag => (tag ? String(Number(tag.slice(8))) : ''); // P1-E7：月字帖角标只写「日」
const UNDER_NOTE = '浅色的字这个月没有笔迹，点字看详情。';

const COPY = {
  mine: '我的',
  records: '练习记录',
  emptyTitle: '还没有记录',
  emptyBody: '写字并点写对或写错，这里就有记录。',
  backup: '备份',
  noBackup: '还没有备份', // 行尾的 › 自 P1-E1b 起是 svg chevron（components/Chevron.js），不在文字里
  lastBackup: d => `上次备份 ${d}`,
  annual: '年度报告',
  about: '关于拾字',
  monthDays: (m, n) => `${m}月写了 ${n} 天`,
  monthNone: m => `${m}月还没有记录`,
  legend: '墨点表示这天有记录，不分对错。',
  emptyLegend: '写字并点写对或写错，这天就有墨点。',
  sheetTitle: m => `${m}月字帖`,
  sheetNote: '点一个字看详情，红色小字是那天的日期。',
  historyNote: '这里只能保存本月的字帖。',
  sheetEmpty: '这个月还没有可做图的字',
  sheetOrder: '按第一次写的先后排',
  saveImage: '保存图片',
  all: n => `全部 ${n} 字`,
  remind: '提醒',
  library: '练习范围',
  appearance: '外观',
  dayChars: d => `${d}写的字`,
  todayImage: '本次图片 · 保存',
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
const md = day => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
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
      overview: q('mine-overview') ? { streak: Number(q('mine-overview').dataset.streak), total: Number(q('mine-overview').dataset.total),
        chars: Number(q('mine-overview').dataset.chars), text: txt(q('mine-overview')) } : null,
      sheet: sheet ? { month: sheet.dataset.month, count: Number(sheet.dataset.count), shown: Number(sheet.dataset.shown),
        truncated: sheet.dataset.truncated === 'true', days: Number(sheet.dataset.days) } : null,
      // D57 · C1：字帖是月字帖那一块（一层框，没有「纸卡」套着）；格子都在 .sz-month 里，且没有旧的 .sz-mine__paper 外框
      gridInPaper: (() => {
        const g = q('mine-sheet-grid');
        if (!g || !g.classList.contains('sz-month') || document.querySelector('.sz-layer[data-top="true"] .sz-mine__paper')) return null;
        return [...g.parentElement.querySelectorAll('[data-testid="mine-sheet-cell"]')].every(c => g.contains(c));
      })(),
      sheetTitle: txt(q('mine-sheet-title')),
      sheetSave: q('mine-sheet-save') ? txt(q('mine-sheet-save')) : null,
      sheetHead: q('mine-sheet-head') ? txt(q('mine-sheet-head')) : null,
      sheetAll: q('mine-sheet-all') ? txt(q('mine-sheet-all')) : null,
      sign: txt(q('mine-sheet-sign')),
      seal: txt(q('mine-sheet-seal')), sealPaths: q('mine-sheet-seal') ? q('mine-sheet-seal').querySelectorAll('svg path').length : 0,
      cells: all('mine-sheet-cell').map(el => ({ char: el.dataset.char, day: el.dataset.day, tag: el.dataset.tag, record: el.dataset.record,
        ink: el.dataset.ink, label: el.getAttribute('aria-label'), tagText: txt(el.querySelector('.sz-mcell__tag')) })),
      menu: ['mine-remind', 'mine-library', 'mine-appearance', 'mine-menu-backup', 'mine-menu-annual', 'mine-menu-about'].map(id => q(id)).filter(Boolean)
        .map(b => ({ testid: b.dataset.testid, to: b.dataset.to || null, text: txt(b) })),
      version: txt(q('mine-version')),
      backupValue: txt(q('mine-backup-value')),
      backupLast: q('mine-menu-backup') ? q('mine-menu-backup').dataset.last : null,
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
      seal: txt(q('month-seal')), sealPaths: q('month-seal') ? q('month-seal').querySelectorAll('svg path').length : 0,
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
  // D63：字帖标题行就是练习记录入口（没有记录时没有字帖块，也就没有入口）
  if (await page.locator(`${TOP} ${tid('mine-sheet-head')}`).count()) await page.click(`${TOP} ${tid('mine-sheet-head')}`);
  else await page.evaluate(async () => { const { nav } = await import('/src/ui/router.js'); nav.push('records', {}); });
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
  const stubbed = await stubMissing(page, ['backup', 'annual', 'about']);
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
  assert.deepEqual([v.overview.streak, v.overview.total, v.overview.chars], [0, 0, 0], 'D63: overview is three zeros without records');
  assert.equal(v.overview.text, '0 天 连续练习 0 天 累计练习 0 字 已练汉字', 'overview copy: 连续练习 / 累计练习 / 已练汉字');
  assert.equal(v.sheet, null, 'no month sheet in the empty state');
  assert.deepEqual(v.menu.map(m => [m.testid, m.to]), [['mine-remind', null], ['mine-library', null], ['mine-appearance', null],
    ['mine-menu-backup', 'backup'], ['mine-menu-annual', 'annual'], ['mine-menu-about', 'about']], 'D63: row order and targets');
  assert.equal(v.menu[0].text, `${COPY.remind} 关`, 'reminder off → 提醒 …… 关');
  assert.equal(v.backupValue, COPY.noBackup, 'R-M03 no backup');
  assert.equal(v.year, '2026', 'annual row shows this year');
  assert.ok(/^版本 \d+\.\d+\.\d+（\d{8}）$/.test(v.version), 'version line at the foot');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');

  step('only answer-seen / skipped records → still empty');
  await seed(page, { extra: [{ char: '户', kind: 'answer-seen', day: TODAY }, { char: '虽', kind: 'skipped', day: '2026-09-22' }] });
  await page.waitForTimeout(100);
  v = await mineView(page);
  assert.equal(v.state, 'empty', 'answer-seen / skipped do not count as records');
  // D66 ⑤：看过答案的字算已练汉字（与字库同一个数）；仍是空态、没有练习天数
  assert.deepEqual([v.overview.streak, v.overview.total, v.overview.chars], [0, 0, 1], 'answer-seen / skipped days are not practice days; the seen char counts as 已练汉字');

  step('no records: practice log (records empty design)');
  await openRecordsFromMine(page);
  let r = await recordsView(page);
  assert.equal(r.title, COPY.records, 'page title 练习记录');
  assert.equal(r.month, '2026-09', 'opens this month');
  assert.equal(r.monthText, '9月', 'month head');
  assert.equal(r.year, '2026', 'year');
  assert.equal(r.heading, COPY.monthNone(9), '「9月还没有记录」');
  assert.equal(r.legend, COPY.emptyLegend, 'R-P04');
  assert.deepEqual([r.prev.disabled, r.prev.aria, r.next.disabled, r.next.aria], [true, 'true', true, 'true'], 'both arrows grey + aria-disabled');
  assert.deepEqual([r.prev.label, r.next.label], ['上个月', '下个月'], 'arrow accessible names');
  assert.deepEqual(r.weekdays, ['一', '二', '三', '四', '五', '六', '日'], 'calendar weekdays');
  assert.equal(r.lead, 1, 'Sep 2026 starts on Tuesday → one blank');
  assert.equal(r.days.length, 30, '30 days');
  assert.equal(r.days.filter(d => d.tag === 'BUTTON').length, 0, 'no clickable days');
  assert.equal(r.sheet, null, 'R5M / P2-22: an empty month draws no sheet block (the heading already says there is nothing)');
  assert.equal(r.sheetEmpty, null, 'no empty sheet box either');
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
  // D63 概览：练习日 = 有 judged 记录的日子 ∪ 折叠月份 ∪ v1 旧版练习日（legacy.days）；连续 = 从今天往前（今天没写就从昨天）连续有练习的天数
  const legacyDays = await page.evaluate(() => (window.__shiziTest.getState().legacy || { days: [] }).days);
  const allDays = new Set([...o9.days, ...legacyDays].filter(d => d <= TODAY));
  const dayBefore = day => new Date(new Date(`${day}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10);
  let streak = 0;
  for (let d = allDays.has(TODAY) ? TODAY : dayBefore(TODAY); allDays.has(d); d = dayBefore(d)) streak += 1;
  assert.equal(v.overview.total, allDays.size, 'overview total = judged days ∪ folded ∪ legacy.days (oracle)');
  assert.equal(v.overview.streak, streak, 'overview streak (oracle)');
  assert.deepEqual([v.overview.streak, v.overview.total, v.overview.chars], [3, 11, 11],
    'literal: 9-24, 9-23 (legacy only), 9-22 = 3 days in a row (9-21 skipped only); 11 days in all (7 judged + 2 folded + 2 legacy); 10 chars with a judged record + 1 seen-only char (D66 ⑤)');
  assert.deepEqual(v.sheet, { month: '2026-09', count: o9.sheet.length, shown: o9.sheet.length, truncated: false, days: o9.monthDays.length },
    'sheet counts from records');
  assert.equal(v.sheetTitle, COPY.sheetTitle(9), 'R-P02 「9月字帖」');
  assert.equal(v.gridInPaper, true, 'D57: sheet grid is the one-frame month sheet (no paper card around it)');
  assert.deepEqual(v.cells.map(c => [c.char, c.day, c.tag, c.record]), o9.sheet.map(c => [c.char, c.day, dayNum(c.tag), c.record]),
    'sheet order / dates / tags / picked record = oracle (P02 first, D42: first one this month that still has ink)');
  assert.deepEqual(v.cells.map(c => c.char).join(''), '静谁慢您数', 'first-appearance order of the work members: the wrong-only 题 / 额 / 感 are not on the sheet (D51 ⑤)');
  const jing = v.cells.find(c => c.char === '静');
  // D42（解 P122）：9-1、9-8 两次的墨迹已按 D27 回收（中间那次）；月字帖在本月内从早到晚找留有墨迹的那一次 → 画 9-22 的笔迹，
  // 不再是「9-1 没有笔迹」；但角标与排序用的是 firstDay（9-1），不跟着取墨那条走（T2-05 / N2-07）。8月那次（8-20，种子没存墨迹）在时间段外，不进候选。
  assert.equal(jing.day, '2026-09-01', '静 is placed and numbered on the day it was first written as a work this month (9-1, firstDay), T2-05');
  assert.equal(jing.ink, 'true', '静 cell draws 9-22\'s own ink (D42 解 P122)');
  assert.equal(v.cells.some(c => c.char === '感' || c.char === '题' || c.char === '额'), false, 'wrong-only chars are not on the sheet (D51 ⑤)');
  // D57 · C1：我的页字帖的日期角标与月字帖页一致——只写「日」、t11 hei 500 ink3；骑在该格上边线上，纸色衬底断开格线，不进格内压字。
  assert.equal(jing.tagText, '1', 'date tag = the sort day (firstDay); day only, like the month page (Q2-4 / T2-05)');
  const tagGeo = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="mine-sheet-cell"]')].find(c => c.dataset.tag);
    const tag = cell.querySelector('.sz-mcell__tag');
    const cs = getComputedStyle(tag);
    const r = tag.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    return { size: cs.fontSize, weight: cs.fontWeight, rides: r.top < c.top && r.bottom > c.top, mid: r.top + r.height / 2 - c.top };
  });
  assert.deepEqual([tagGeo.size, tagGeo.weight], ['11px', '500'], 'tag is t11 / 500 (same as the month page)');
  assert.equal(tagGeo.rides, true, 'D57: the tag rides the cell’s top edge');
  assert.ok(Math.abs(tagGeo.mid) <= 1.5, 'the tag is centred on the top line');
  assert.equal(v.cells.find(c => c.char === '数').ink, 'false', 'no ink → 没有笔迹 (10.12, no borrowing)');
  assert.equal(v.cells.find(c => c.char === '谁').tagText, null, 'same sort day as the previous cell (静, 9-01) → no tag');
  assert.equal(jing.label, '静 · 9月1日，9月22日的笔迹', 'cell accessible name: the sort day, plus the day of the ink drawn (N2-07)');
  assert.equal(v.sign, `二〇二六年九月 ${cn(o9.sheet.length)}字`, 'signature in Chinese numerals: the same kuan() as the month page and the export (R2-R1; txt() folds the full-width space)');
  assert.equal(v.sign, '二〇二六年九月 五字', 'signature literal');
  assert.equal(v.seal, '', 'R2-S2: the seal is a drawing, no text');
  assert.equal(v.sealPaths, 9, 'the seal draws the brand 拾');
  assert.equal(v.sheetSave, null, 'D63: no 保存图片 on 我的 (the title row is the whole entry; saving lives on the records / month pages)');
  assert.equal(v.sheetAll, COPY.all(o9.sheet.length), 'D63: 全部 N 字 on the title row (N = the whole month)');
  assert.equal(v.sheetHead, `${COPY.sheetTitle(9)} ${COPY.all(o9.sheet.length)}`, 'title row = 「9月字帖」 + 「全部 5 字」');
  assert.equal(v.backupValue, COPY.lastBackup(md('2026-09-01')), 'last backup date from backupMeta');
  assert.equal(v.backupLast, '2026-09-01', 'data-last');
  assert.ok(!/补记/.test(v.bodyText), 'no 补记 wording');
  assert.deepEqual(v.unnamedButtons, [], 'every button has an accessible name');
  assert.equal(v.hScroll, false, 'no horizontal overflow (393)');

  step('D66 ⑱: 30+ days since the last backup → the backup row value says so (no dot, no extra row); back within 30 days → the date again');
  const rowsBefore = v.menu.length;
  await page.evaluate(() => {
    window.__shiziTest.setClock('2026-11-05T09:00:00');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(sel => (document.querySelector(sel) || {}).textContent === '65 天没有备份', `${TOP} [data-testid="mine-backup-value"]`);
  const stale = await mineView(page);
  assert.equal(stale.backupValue, '65 天没有备份', 'stale hint replaces 「上次备份 …」 (9-01 → 11-05 = 65 days)');
  assert.equal(await page.getAttribute(`${TOP} ${tid('mine-menu-backup')}`, 'data-hint'), 'stale', 'data-hint=stale');
  assert.equal(stale.menu.length, rowsBefore, 'no new row');
  assert.equal(await page.locator(`${TOP} ${tid('mine-menu-backup')} .sz-dot, ${TOP} ${tid('mine-menu-backup')} [data-dot]`).count(), 0, 'no red dot');
  await page.evaluate(iso => {
    window.__shiziTest.setClock(iso);
    document.dispatchEvent(new Event('visibilitychange'));
  }, CLOCK);
  await page.waitForFunction(sel => (document.querySelector(sel) || {}).textContent === '上次备份 9月1日', `${TOP} [data-testid="mine-backup-value"]`);

  step('records: practice log this month — numbers, dots, sheet, no backfill traces');
  const raw0 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  await openRecordsFromMine(page);
  r = await recordsView(page);
  assert.deepEqual((await top(page)).params, { month: '2026-09' }, 'D63: the title row passes this month');
  assert.equal(r.recordDays, o9.monthDays.length, 'record days = oracle');
  assert.equal(r.heading, COPY.monthDays(9, o9.monthDays.length), 'R-P01 「9月有记录 N 天」');
  assert.equal(r.heading, '9月写了 5 天', 'literal 5 days');
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
  assert.equal(r.seal, '', 'R2-S2: the seal is a drawing, no text');
  assert.equal(r.sealPaths, 9, 'the seal draws the brand 拾');
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
  assert.equal(r.heading, COPY.monthDays(8, o8.monthDays.length), '「8月有记录 2 天」');
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
  assert.equal(r.sheet, null, 'R5M / P2-22: no sheet block on an empty month');
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
  await stubMissing(page, ['backup', 'annual', 'about']);
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
  await page.click(`${TOP} [data-testid="mine-sheet-cell"][data-char="您"]`);
  await waitTop(page, 'detail');
  assert.deepEqual((await top(page)).params, { char: '您' }, 'mine sheet cell → detail {char} (R-M01)');
  await back(page);
  for (const [testid, name] of [['mine-remind', 'remind'], ['mine-library', 'library-switch'], ['mine-menu-backup', 'backup'], ['mine-menu-annual', 'annual'], ['mine-menu-about', 'about']]) {
    await page.click(`${TOP} ${tid(testid)}`);
    await waitTop(page, name);
    const tp = await top(page);
    assert.deepEqual([tp.depth, tp.name], [1, name], `${testid} → push ${name}`);
    await back(page);
    await waitTop(page, 'mine');
  }
  await page.click(`${TOP} ${tid('mine-sheet-head')}`);
  await waitTop(page, 'records');
  assert.deepEqual((await top(page)).params, { month: '2026-09' }, 'D63: the title row opens the practice log on this month');
  await back(page);
  await waitTop(page, 'mine');

  step('browsing mine / records / detail wrote nothing');
  assert.equal(await writes(page) - w0, 0, 'no writes since reload (write log unchanged)');
  const raw1 = await page.evaluate(() => window.__shiziTest.getRawKeys());
  assert.deepEqual(raw1, raw0, 'every shizi.* storage key byte-equal before / after browsing (incl. the reload)');

  // ------------------------------------------------------------------ 4. 今天的记录
  // H2（D55）：首页不再有「今天写的字」那一排，原来从它点进来的入口没了；「今天的记录」页本身（R-H08）仍在，这里直接推入它核对内容。
  step('今天的记录 = practice log with today\'s chars (R-H08; the home ink row it used to open from is gone, D55)');
  await goTab(page, 'home');
  assert.equal(await page.locator(`${TOP} ${tid('home-ink-row')}`).count(), 0, 'D55: no ink row on the home any more');
  await page.evaluate(async day => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('records', { month: day.slice(0, 7), day });
  }, TODAY);
  await waitTop(page, 'records');
  assert.deepEqual((await top(page)).params, { month: '2026-09', day: TODAY }, 'pushed records {month, day: today}');
  await page.waitForSelector(`${TOP} ${tid('records-daylist')}`);
  r = await recordsView(page);
  assert.deepEqual(r.daylist.cells.map(c => c.char), o9.todayChars.map(c => c.char), 'today\'s chars (oracle)');
  assert.deepEqual(r.daylist.cells.map(c => c.record), o9.todayChars.map(c => c.record), 'latest record of each char today');
  assert.equal(r.daylist.title, COPY.dayChars('9月24日'), '「9月24日写的字」');
  await back(page);
  await goTab(page, 'mine');

  // ------------------------------------------------------------------ 6. 图片入口桩
  step('image entries (M4-5 stub): registered → shown, called with {month} / {day}');
  await page.evaluate(async () => {
    const { setMineImageActions, getMineImageActions } = await import('/src/ui/screens/mine/records.js');
    window.__origImg = getMineImageActions(); // 重载后是 M4-5 重新注册的真去处
    window.__imgCalls = [];
    setMineImageActions({
      month: p => window.__imgCalls.push({ kind: 'month', month: p.month, n: p.sheet.cells.length }),
      today: p => window.__imgCalls.push({ kind: 'today', day: p.day }),
    });
  });
  await seed(page, RICH); // 重新发布状态 → 重画
  await page.waitForSelector(`${TOP} ${tid('mine-sheet-head')}`);
  v = await mineView(page);
  assert.equal(v.sheetSave, null, 'D63: 我的 has no 保存图片 even when the image action is registered');
  await openRecordsFromMine(page);
  r = await recordsView(page);
  assert.equal(r.sheetSave, COPY.saveImage, 'records 保存图片 (the entry lives here)');
  assert.equal(r.today && r.today.text, `${COPY.dayChars('9月24日')} ${COPY.todayImage}`, 'R-P03 today row');
  assert.equal(r.today.n, o9.todayChars.length, 'today row n');
  await page.click(`${TOP} ${tid('records-sheet-save')}`);
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('records-today')}`);
  const calls = await page.evaluate(() => window.__imgCalls);
  assert.deepEqual(calls, [
    { kind: 'month', month: '2026-09', n: 5 },
    { kind: 'today', day: TODAY },
  ], 'image actions called with this month / today (B3.9: the destination takes the day; which chars = the day list oracle above)');
  await page.evaluate(async () => {
    const { setMineImageActions } = await import('/src/ui/screens/mine/index.js');
    setMineImageActions({ month: window.__origImg.month, today: window.__origImg.today });
  });
  await back(page);

  // ------------------------------------------------------------------ 5. 300 字
  step('300 chars this month: mine sheet = latest two rows (8 columns × 2 = 16, D63) + title row 全部 300 字 → practice log; no signature; timing');
  const deckChars = await page.evaluate(async () => {
    const { getDeck } = await import('/src/data/deck.js');
    return getDeck().keys.filter(k => k.startsWith('base:')).map(k => k.slice(5)).slice(0, 300);
  });
  assert.equal(deckChars.length, 300, 'deck provides 300 chars');
  const big = { steps: deckChars.map((c, i) => ({ char: c, judgment: 'correct', // 300 个作品字（写错的不进字帖，D51 ⑤，所以这里全写对）
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
  assert.equal(v.sheet.count, 300, '300 chars in the month');
  assert.equal(v.sheet.truncated, true, 'truncated');
  const lastRows = oBig.sheet.slice(300 - 16);
  assert.equal(v.cells.length, 16, 'shows the latest two rows: 8 columns × 2');
  assert.equal(v.sheet.shown, 16, 'data-shown = 16');
  assert.deepEqual(v.cells.map(c => c.char), lastRows.map(c => c.char), 'most recent chars, oldest first');
  assert.equal(v.cells[0].tag, dayNum(lastRows[0].day), 'first visible cell re-tagged with its date');
  assert.equal(v.sheetAll, COPY.all(300), '「全部 300 字」');
  assert.equal(v.sign, null, 'D57: a capped sheet draws no signature / seal (the full month is on the practice log)');
  assert.equal(v.hScroll, false, 'no horizontal overflow');
  console.log(`mine 300: seed→render ${mineMs}ms`);
  assert.ok(mineMs < 3000, `mine 300 chars renders within 3s (${mineMs}ms)`);
  const t1 = Date.now();
  await page.click(`${TOP} ${tid('mine-sheet-head')}`);
  await waitTop(page, 'records');
  assert.equal((await top(page)).params.month, '2026-09', 'D63: the title row → practice log of this month');
  await page.waitForFunction(sel => document.querySelectorAll(`${sel} [data-testid="records-sheet-cell"]`).length === 300, TOP);
  const recMs = Date.now() - t1;
  console.log(`records 300: push→300 cells ${recMs}ms (incl. 450ms settle)`);
  const recChars = await page.evaluate(sel => [...document.querySelectorAll(`${sel} [data-testid="records-sheet-cell"]`)].map(c => c.dataset.char), TOP);
  assert.deepEqual(recChars, oBig.sheet.map(c => c.char), 'all 300 chars in order');
  assert.equal(await page.evaluate(sel => document.documentElement.scrollWidth > window.innerWidth + 1, TOP), false, 'no horizontal overflow');
  await back(page);

  // ------------------------------------------------------------------ 7. 深色 / 紧凑
  step('dark (system and data-theme) + compact 360×640: no overflow, names');
  await seed(page, RICH);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(200);
  v = await mineView(page);
  const darkBg = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} [data-testid="mine-sheet-grid"] .sz-month__sheet`)).backgroundColor, TOP);
  assert.equal(darkBg, tokenRgb('dark', 'sheet'), 'sheet paper uses dark --sheet (D43: was --c #2D2823)');
  assert.equal(v.hScroll, false, 'mine 360: no horizontal overflow');
  await openRecordsFromMine(page);
  r = await recordsView(page);
  assert.equal(r.hScroll, false, 'records 360: no horizontal overflow');
  assert.deepEqual(r.unnamedButtons, [], 'names in dark / compact');
  await back(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(100);
  const forced = await page.evaluate(sel => getComputedStyle(document.querySelector(`${sel} [data-testid="mine-sheet-grid"] .sz-month__sheet`)).backgroundColor, TOP);
  assert.equal(forced, tokenRgb('dark', 'sheet'), 'data-theme=dark forced');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.setViewportSize({ width: 393, height: 852 });
}
