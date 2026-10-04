// 「有记录的字」完整页纯模型单测（M3-4；04 R-A01–R-A04；03 P04 / P20 / P56；K15 / K16 / K19）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import {
  allModel, parseFind, pyKey, pyInitial, monthName, takeCells, toggleFold, normalizeFold, normalizeSort, normalizeFilter,
  RENDER_BATCH,
} from '../../src/ui/screens/library/all-model.js';
import { libraryHomeModel } from '../../src/ui/screens/library/model.js';

const TODAY = '2026-09-24';
const at = day => new Date(`${day}T08:00:00`).getTime();

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rec(n, c, { kind = 'judged', judgment = 'correct', day = TODAY } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's9', kind, at: at(day) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function state({ records = [], custom = null, sched = null } = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, custom, sched, sessions: { A: null, B: null, lastEnded: {} } };
}

const PY = { 静: 'jìng', 境: 'jìng', 京: 'jīng', 惊: 'jīng', 绿: 'lǜ', 安: 'ān', 爱: 'ài', 波: 'bō', 馨: 'xīn', 鼎: 'dǐng' };
const pyOf = c => PY[c] || '';
const opts = extra => ({ today: TODAY, policy, pyOf, practicable: k => k !== 'base:鼎', ...extra });

// 静 wrong 9-22；境 9-01；京 8-20；惊 5-10；绿 today（wrong→correct 以最后一次为准）；安 2025-09-30（去年）；爱 7-01
const RECORDS = [
  rec(1, '安', { day: '2025-09-30' }),
  rec(2, '惊', { day: '2026-05-10' }),
  rec(3, '爱', { day: '2026-07-01' }),
  rec(4, '京', { day: '2026-08-20' }),
  rec(5, '境', { day: '2026-09-01' }),
  rec(6, '绿', { day: '2026-09-10', judgment: 'wrong' }),
  rec(7, '静', { day: '2026-09-22', judgment: 'wrong' }),
  rec(8, '绿', { day: TODAY }),
  rec(9, '波', { kind: 'skipped', day: TODAY }),
  rec(10, '波', { kind: 'answer-seen', day: TODAY }),
];
const CUSTOM = { added: [{ char: '馨', at: 1 }, { char: '境', at: 2 }, { char: '鼎', at: 3 }] };
const SCHED = { 'base:惊': { fsrs: { stability: 2 }, due: '2026-06-01' }, 'base:静': { fsrs: { stability: 1 }, due: '2026-01-01' } };
const S = state({ records: RECORDS, custom: CUSTOM, sched: SCHED });

test('counts match the library home (recorded, custom unwritten) and judged-only rule (D23)', () => {
  const m = allModel(S, opts());
  const home = libraryHomeModel(S, TODAY);
  assert.equal(m.recorded, 7, 'skipped / answer-seen 波 is not recorded');
  assert.equal(m.recorded, home.recorded, 'same number as the library home big number');
  assert.deepEqual(m.counts, { wrong: 1, forget: 1, unw: 2, custom: 3 }, 'wrong = latest wrong only (绿 corrected); 静 due but wrong → not forget (K16)');
  assert.equal(m.empty, false);
  assert.equal(allModel(null, opts()).empty, true);
  assert.equal(allModel(state({ custom: CUSTOM }), opts()).empty, true, 'custom only → empty like the home page');
});

test('recent (default): hollow first, months new → old, two open by default, rest closed; fold overrides; cross-year label', () => {
  const m = allModel(S, opts());
  assert.equal(m.sort, 'recent');
  assert.equal(m.note, '按最近一次写的月份排。每格是你最近一次的笔迹。', 'D27: default perRecordInk=true → original slot (latest ink is always kept)');
  const off = allModel(S, opts({ policy: { ...policy, features: { ...policy.features, perRecordInk: false } } }));
  assert.equal(off.note, '按最近一次写的月份排。点一个字，看它的记录。', 'F4: perRecordInk=false → no promise of 你的笔迹');
  const on = allModel(S, opts({ policy: { ...policy, features: { ...policy.features, perRecordInk: true } } }));
  assert.equal(on.note, '按最近一次写的月份排。每格是你最近一次的笔迹。', 'perRecordInk=true → original slot')
  assert.deepEqual(m.groups.map(g => [g.key, g.name, g.count]), [
    ['hollow', '自选了还没写', '2 个字'],
    ['m:2026-09', '9月', '3 个字'],
    ['m:2026-08', '8月', '1 个字'],
  ]);
  assert.deepEqual(m.groups[0].cells.map(c => [c.char, c.kind]), [['馨', 'hollow'], ['鼎', 'hollow']]);
  assert.deepEqual(m.groups[1].cells.map(c => [c.char, c.kind, c.tone]), [['绿', 'ink', 0], ['静', 'wrong', 0], ['境', 'ink', 1]],
    'newest first; 静 latest wrong → wrong cell; tones by P56');
  assert.deepEqual(m.closed.map(c => [c.month, c.name, c.count]), [
    ['2026-07', '7月', 1], ['2026-05', '5月', 1], ['2025-09', '2025年9月', 1],
  ], 'older months folded; last year month carries the year');
  assert.equal(m.groups[1].fold, 'open');
  const f1 = toggleFold({}, '2025-09', false);
  const f2 = toggleFold(f1, '2026-09', true);
  assert.deepEqual(f2, { '2025-09': true, '2026-09': false });
  const m2 = allModel(S, opts({ fold: f2 }));
  assert.deepEqual(m2.groups.map(g => g.key), ['hollow', 'm:2026-08', 'm:2025-09']);
  assert.deepEqual(m2.closed.map(c => c.month), ['2026-09', '2026-07', '2026-05']);
  assert.equal(monthName('2026-01', TODAY), '1月');
  assert.deepEqual(normalizeFold({ '2026-09': true, bad: true, '2026-08': 'x' }), { '2026-09': true });
});

test('pinyin: initial groups (tones stripped, ü → u), each cell labelled with pinyin, no-pinyin chars in 其他', () => {
  const extra = state({ records: [...RECORDS, rec(11, '龘', { day: TODAY })], custom: CUSTOM, sched: SCHED });
  const m = allModel(extra, opts({ sort: 'py' }));
  assert.equal(m.note, '按拼音首字母排。多音字按第一个读音。');
  assert.deepEqual(m.groups.map(g => g.name), ['自选了还没写', 'A', 'J', 'L', '其他']);
  const a = m.groups.find(g => g.name === 'A');
  assert.deepEqual(a.cells.map(c => [c.char, c.py]), [['爱', 'ài'], ['安', 'ān']], 'ai < an');
  const j = m.groups.find(g => g.name === 'J');
  assert.deepEqual(j.cells.map(c => c.char), ['京', '惊', '境', '静'].sort(), 'same syllable → by character');
  assert.ok(m.groups.every(g => g.cells.every(c => typeof c.py === 'string')), 'every cell carries pinyin in py sort (R-A04)');
  assert.equal(m.groups.at(-1).cells[0].py, '', '其他 group: no pinyin');
  assert.equal(pyKey('lǜ'), 'lu');
  assert.equal(pyKey('LV'), 'lu');
  assert.equal(pyInitial(''), null);
  const r = allModel(S, opts({ sort: 'recent' }));
  assert.ok(r.groups.every(g => g.cells.every(c => c.py === null)), 'no pinyin labels outside py sort');
});

test('age: hollow, then oldest tone first, oldest first inside a tone (P56)', () => {
  const m = allModel(S, opts({ sort: 'age' }));
  assert.equal(m.note, '离上次写越久，排得越前。');
  assert.deepEqual(m.groups.map(g => [g.name, g.tone, g.cells.map(c => c.char).join('')]), [
    ['自选了还没写', null, '馨鼎'],
    ['三个月以上', 3, '安惊'],
    ['三个月内', 2, '爱京'],
    ['一个月内', 1, '境'],
    ['一周内写过', 0, '静绿'],
  ]);
});

test('filters: wrong / forget / unw / custom; sort collapses; 0-count chips disabled unless active; practice go', () => {
  const w = allModel(S, opts({ filter: 'wrong' }));
  assert.equal(w.showSort, false, 'R-A04: filter on → sort collapsed');
  assert.equal(w.showChips, true);
  assert.deepEqual(w.groups.map(g => [g.head, g.cells.map(c => c.char).join('')]), [[false, '静']]);
  assert.equal(w.note, '你判断写错的字。');
  assert.deepEqual(w.go, { kind: 'list', listKind: 'wrong' });
  const f = allModel(S, opts({ filter: 'forget' }));
  assert.deepEqual(f.groups[0].cells.map(c => c.char), ['惊'], 'forget = latest correct & due (K16), capped by policy');
  assert.equal(f.note, '有一阵没写、可能快忘了的字。');
  assert.deepEqual(f.go, { kind: 'list', listKind: 'forget' });
  const u = allModel(S, opts({ filter: 'unw' }));
  assert.deepEqual(u.groups[0].cells.map(c => [c.char, c.kind]), [['馨', 'hollow'], ['鼎', 'hollow']]);
  assert.equal(u.note, '加入了自选的字，还没有记录。');
  assert.deepEqual(u.go, { kind: 'start', keys: ['base:馨'] }, 'only practicable chars are handed to startPicked');
  const c = allModel(S, opts({ filter: 'custom' }));
  assert.deepEqual(c.groups.map(g => [g.name, g.count, g.cells.map(x => x.char).join('')]), [
    ['自选了还没写', '2 个字', '馨鼎'], ['有记录', '1 个字', '境'],
  ]);
  assert.equal(c.note, '你自己挑来常练的字。还没写的排在前面。');
  assert.equal(c.go, null, 'custom filter has no practice button (prototype L401)');
  assert.deepEqual(c.chips.map(x => x.label), ['写错过 1', '快忘了 1', '自选了还没写 2', '自选的字 3']);
  const bare = state({ records: [rec(1, '安')] });
  const b = allModel(bare, opts());
  assert.deepEqual(b.chips.map(x => [x.key, x.n, x.disabled]), [
    ['wrong', 0, true], ['forget', 0, true], ['unw', 0, true], ['custom', 0, true],
  ], 'R-A04: 0-count filters greyed');
  const stuck = allModel(bare, opts({ filter: 'wrong' }));
  assert.equal(stuck.chips[0].disabled, false, 'an active chip stays clickable to cancel');
  assert.equal(stuck.go, null, 'no practice button on an empty filter');
  assert.equal(allModel(state({ records: [rec(1, '安')], custom: { added: [{ char: '鼎', at: 1 }] } }), opts({ filter: 'unw' })).go, null,
    'no practicable hollow char → no button');
});

test('find by char (R-A03): only that month, ring, where; miss keeps the page', () => {
  const m = allModel(S, opts({ find: '静', filter: 'wrong', sort: 'age' }));
  assert.equal(m.find.mode, 'char');
  assert.equal(m.find.found, true);
  assert.equal(m.find.where, '在 9月');
  assert.equal(m.showSort, false);
  assert.equal(m.showChips, false);
  assert.equal(m.note, '');
  assert.equal(m.filter, '', 'found overrides the filter');
  assert.deepEqual(m.groups.map(g => g.key), ['m:2026-09'], 'only the month of its latest record');
  assert.deepEqual(m.closed, []);
  assert.deepEqual(m.groups[0].cells.filter(c => c.hit).map(c => c.char), ['静']);
  const y = allModel(S, opts({ find: '安' }));
  assert.equal(y.find.where, '在 2025年9月', 'cross-year found label');
  const miss = allModel(S, opts({ find: '馨' }));
  assert.equal(miss.find.found, false);
  assert.equal(miss.find.miss, '「馨」还没有记录。', 'custom unwritten char is not recorded');
  assert.equal(miss.showSort, true);
  assert.ok(miss.groups.length > 1, 'page stays as it was');
  assert.deepEqual(parseFind('a静b'), { mode: 'char', char: '静', query: '静' }, 'first Han char wins');
  assert.equal(parseFind('123').mode, 'none');
  assert.equal(parseFind('').mode, 'none');
});

test('find by pinyin (R-A04): exact syllable (tones ignored), else prefix; rings every hit; miss text', () => {
  const m = allModel(S, opts({ find: 'jing' }));
  assert.equal(m.find.mode, 'pinyin');
  assert.deepEqual(m.find.chars.sort(), ['京', '境', '惊', '静'].sort());
  assert.deepEqual(m.groups.map(g => g.key), ['m:2026-09', 'm:2026-08', 'm:2026-05'], 'every month with a hit, new → old');
  assert.equal(m.find.where, '', 'several months → no single 「在 X 月」');
  const hits = m.groups.flatMap(g => g.cells.filter(c => c.hit).map(c => c.char)).sort();
  assert.deepEqual(hits, ['京', '境', '惊', '静'].sort());
  const toned = allModel(S, opts({ find: 'jìng' }));
  assert.deepEqual(toned.find.chars.sort(), ['京', '境', '惊', '静'].sort(), 'tone marks ignored');
  const lv = allModel(S, opts({ find: 'lv' }));
  assert.deepEqual(lv.find.chars, ['绿'], 'v means ü');
  assert.equal(lv.find.where, '在 9月');
  const prefix = allModel(S, opts({ find: 'a' }));
  assert.deepEqual(prefix.find.chars.sort(), ['安', '爱'].sort(), 'no exact match → prefix');
  const miss = allModel(S, opts({ find: 'zzz' }));
  assert.equal(miss.find.found, false);
  assert.equal(miss.find.miss, '「zzz」还没有记录。');
});

test('batch rendering: takeCells keeps group order and ≤ limit cells (01 §10: ≤ 72 at once)', () => {
  const chars = Array.from('的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可也你说年而');
  const records = [];
  chars.forEach((c, i) => records.push(rec(i + 1, c, { day: addDays(TODAY, -(i * 7)) })));
  const m = allModel(state({ records }), opts({ fold: Object.fromEntries(records.map(r => [r.localDay.slice(0, 7), true])) }));
  assert.equal(m.total, chars.length);
  const first = takeCells(m.groups, 10);
  assert.equal(first.reduce((n, g) => n + g.cells.length, 0), 10);
  assert.deepEqual(first.flatMap(g => g.cells.map(c => c.char)), m.groups.flatMap(g => g.cells.map(c => c.char)).slice(0, 10));
  assert.ok(first.at(-1).partial || first.at(-1).cells.length === m.groups[first.length - 1].cells.length);
  assert.equal(takeCells(m.groups, 1e9).length, m.groups.length);
  assert.equal(RENDER_BATCH, 72);
  assert.equal(normalizeSort('x'), 'recent');
  assert.equal(normalizeFilter('x'), '');
});

test('300 chars a year: model computes quickly and every recorded char appears once', () => {
  const pool = Array.from('的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可也你说年而子那得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感见明问力理尔点文几定本公特做外孩相西果走将月十实向声车全信重三机工物气每并别真打太新比才便夫再书部水像眼等体却加电主界门利海受听表德少克代员许稜先口由死安写性马光白或住难望教命花结乐色更拉东神记处让母父应直字场平报友关放至张认接告入笑内英军候民岁往何度山觉路带万男边风解叫任金快原吃妈变通师立象数四失满战远格士音轻目条呢病始达深完今提求清王化空业思切怎非找片罗钱紶吗语元喜曾离飞科言干流欢约各即指合反题必该论交终林请医晚制球决窢传画保读运及则房早院量苦火布品近坐产答星精视五连司巴奇管类未朋且婚台夜青北队久乎越观落尽形影红爸百令周吧识步希亚术留市半热送兴造谈容极随演收首根讲整式取照办强石古华諣拿计您装似足双妻尼转诉米称丽客南领节衣站黑刻统断福城故历惊脸选包紧争另建维绝树系伤示愿持千史谁准联妇纪基买志静阿诗独复痛消社算义竟确酒需单治卡幸兰念举仅钟怕共毛句息功官待究跟穿室易游程号居考突皮哪费倒价图具刚脑永歌响商礼细专黄块脚味灵改据般破引食仍存众注笔甚某沉血备习校默务土微娘须试怀料调广蜖苏显赛查密议底列富梦错座参八除跑');
  const chars = [...new Set(pool)].slice(0, 300);
  const records = chars.map((c, i) => rec(i + 1, c, { day: addDays(TODAY, -Math.floor(i * 365 / 300)), judgment: i % 7 === 0 ? 'wrong' : 'correct' }));
  const st = state({ records, custom: { added: [{ char: '馨', at: 1 }] } });
  const t0 = performance.now();
  for (const sort of ['recent', 'py', 'age']) allModel(st, opts({ sort, pyOf: () => 'shi' }));
  const ms = performance.now() - t0;
  assert.ok(ms < 150, `three sorts over 300 chars in ${ms.toFixed(1)}ms`);
  const age = allModel(st, opts({ sort: 'age' }));
  const seen = age.groups.flatMap(g => g.cells.map(c => c.char));
  assert.equal(seen.length, 301);
  assert.equal(new Set(seen).size, 301);
  assert.equal(age.cols, 8, '≥ 60 members → 8 columns (same as the wall)');
  assert.equal(allModel(st, opts({ compact: true })).cols, 6);
});
