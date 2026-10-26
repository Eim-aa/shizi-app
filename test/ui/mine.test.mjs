// 我的首页与练习记录数据模型单测（M4-1；R-M01–R-M05、R-P01–R-P05；03 P02；01 §3.2 / §9）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import {
  recordIndex, practiceDaySet, streakDays, overviewModel, calendarModel, monthSheet, sheetPreview, dayItems, mineModel, recordsModel, clampMonth,
  weekdayIndex, lastBackupDay, backupHint, storagePressureNear, firstRecordMonth, MINE_SHEET_COLS, MINE_SHEET_ROWS,
} from '../../src/session/views/mine.js';
import { recordsSignature } from '../../src/core/backup.js';

const TODAY = '2026-09-24'; // 周四

let serial = 0;
function rec(c, day, { kind = 'judged', judgment = 'correct' } = {}) {
  serial += 1;
  const r = { id: `r${serial}`, cardKey: `base:${c}`, char: c, sessionId: 's1', kind, at: new Date(`${day}T08:00:00`).getTime() + serial,
    localDay: day, help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function state(records, extra = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A: null, B: null, lastEnded: {} }, ...extra };
}

test('empty: no judged record (answer-seen / skipped only) → empty; overview all 0; no sheet', () => {
  serial = 0;
  const s = state([rec('户', TODAY, { kind: 'answer-seen' }), rec('虽', '2026-09-22', { kind: 'skipped' })]);
  const m = mineModel(s, TODAY);
  assert.equal(m.empty, true);
  assert.equal(m.sheetOn, false);
  // D66 ⑤：看过答案的字算已练汉字（与字库同一个数）；没有判断记录，所以仍是空态、没有练习天数
  assert.deepEqual(m.overview, { streak: 0, total: 0, chars: 1 });
  const nullModel = mineModel(null, TODAY);
  assert.equal(nullModel.empty, true);
  assert.equal(nullModel.lastBackup, null);
});

test('weekdayIndex: Monday first; week wraps across months', () => {
  assert.equal(weekdayIndex('2026-09-21'), 0); // Mon
  assert.equal(weekdayIndex('2026-09-27'), 6); // Sun
  assert.equal(weekdayIndex('2026-09-01'), 1); // Tue
});

test('overview (D63): streak counts back from today, or from yesterday when today is not written yet; legacy.days counted', () => {
  serial = 0;
  assert.equal(streakDays(['2026-09-24', '2026-09-23', '2026-09-22', '2026-09-20'], '2026-09-24'), 3);
  assert.equal(streakDays(['2026-09-23', '2026-09-22'], '2026-09-24'), 2); // 今天还没写：从昨天算
  assert.equal(streakDays(['2026-09-22'], '2026-09-24'), 0); // 前天以前：断了
  assert.equal(streakDays([], '2026-09-24'), 0);
  // 跨月、跨年
  assert.equal(streakDays(['2026-01-01', '2025-12-31', '2025-12-30'], '2026-01-01'), 3);
  const s = state([rec('静', '2026-09-23'), rec('谁', '2026-09-24'), rec('谁', '2026-09-10')], {
    legacy: { importedAt: 1, fromKeys: [], days: ['2026-09-22', '2026-09-21', '2026-09-10', '2026-08-01', 'bad', '2026-09-30'], report: {} },
  });
  const days = practiceDaySet(s);
  assert.equal(days.size, 7); // 9-24 9-23 9-10 + legacy 9-22 9-21 8-01 9-30（9-10 重复，坏日期丢弃）
  const o = overviewModel(s, TODAY);
  assert.equal(o.streak, 4); // 9-21 … 9-24（旧版练习日接得上）
  assert.equal(o.total, 6); // 9-30 在今天以后，不计
  assert.equal(o.chars, 2); // 静、谁 = 字库「已练汉字」同一个数
  assert.equal(mineModel(s, TODAY).overview.chars, 2);
  // 没有新记录、只有旧版练习日也有数
  assert.deepEqual(overviewModel({ legacy: { days: ['2026-09-24'] } }, TODAY), { streak: 1, total: 1, chars: 0 });
});

test('month sheet: first-appearance order, date tags on day change, P02 pick first vs last', () => {
  serial = 0;
  const rs = [
    rec('静', '2026-09-01'), rec('谁', '2026-09-01'), rec('题', '2026-09-01', { judgment: 'wrong' }),
    rec('静', '2026-09-08', { judgment: 'wrong' }), rec('慢', '2026-09-08'),
    rec('静', '2026-09-22'), rec('数', TODAY), rec('数', TODAY, { judgment: 'wrong' }),
    rec('户', TODAY, { kind: 'answer-seen' }),
  ];
  const idx = recordIndex(state(rs));
  const first = monthSheet(idx, '2026-09', { policy });
  assert.equal(first.pick, 'first');
  assert.deepEqual(first.cells.map(c => c.char), ['静', '谁', '慢', '数'], '题 was written wrong: not in the sheet (D51 ⑤)');
  assert.deepEqual(first.cells.map(c => c.tag), ['2026-09-01', null, '2026-09-08', TODAY]);
  assert.equal(first.cells[0].record.id, 'r1', '静 = first record this month (M02)');
  assert.equal(first.cells[3].record.id, 'r7');
  assert.equal(first.days, 4);
  assert.equal(first.chars, 4);
  const last = monthSheet(idx, '2026-09', { policy: { ...policy, monthSheetPick: 'last' } });
  assert.equal(last.cells[0].record.id, 'r6', '静 = last judged in month (D11)');
  assert.equal(last.cells[0].day, '2026-09-01', 'the tag is the sort day (first appearance), not the day of the drawn record (T2-05)');
  assert.deepEqual(last.cells.map(c => c.char), ['静', '谁', '慢', '数'], 'order stays first-appearance');
});

const INK_ENTRY = { s: ['AAAAAAAA'] }; // 存下的墨迹（只看有没有笔画；不解码）

test('D42 month sheet: 静 written in August then 9-01 / 9-08 / 9-22 — September shows 9-22 (tag 9-22), August shows its own; ink never borrowed across months', () => {
  serial = 0;
  const rs = [rec('静', '2026-08-05'), rec('静', '2026-09-01'), rec('谁', '2026-09-01'), rec('静', '2026-09-08'), rec('静', '2026-09-22')];
  // D27：只留首次（r1）与最近一次（r5）的墨迹；谁 只有一次、墨迹还在
  const ink = { '2026-08': { r1: INK_ENTRY }, '2026-09': { r5: INK_ENTRY, r3: INK_ENTRY } };
  const idx = recordIndex(state(rs, { ink }));
  const sep = monthSheet(idx, '2026-09', { policy });
  assert.deepEqual(sep.cells.map(c => [c.char, c.record.id, c.day, c.tag]), [['静', 'r5', '2026-09-01', '2026-09-01'], ['谁', 'r3', '2026-09-01', null]],
    '9-01 recycled: 静 takes the 9-22 ink but the tag stays on its sort day 9-01 (T2-05); 谁 keeps its 9-01 (same day, no second tag)');
  assert.equal(sep.cells[0].record.localDay, '2026-09-22');
  const aug = monthSheet(idx, '2026-08', { policy });
  assert.deepEqual(aug.cells.map(c => [c.char, c.record.id]), [['静', 'r1']]);
  // 'last' 偏好从晚到早找
  const last = monthSheet(idx, '2026-09', { policy: { ...policy, monthSheetPick: 'last' } });
  assert.equal(last.cells[0].record.id, 'r5');
  // 九月里一份墨迹都没有（八月那份不冒充）：取本月第一次、如实没有笔迹
  const noSep = monthSheet(recordIndex(state(rs, { ink: { '2026-08': { r1: INK_ENTRY } } })), '2026-09', { policy });
  assert.deepEqual(noSep.cells.map(c => [c.char, c.record.id, c.day]), [['静', 'r2', '2026-09-01'], ['谁', 'r3', '2026-09-01']]);
  // 注入的 hasInk 优先于 state.ink（界面把页面内笔画也算上）
  const injected = monthSheet(idx, '2026-09', { policy, hasInk: r => r.id === 'r4' });
  assert.equal(injected.cells[0].record.id, 'r4');
});

test('D42 month sheet on a folded month: only kept records are candidates; kept with ink wins, otherwise the preferred kept one / null', () => {
  serial = 0;
  const k1 = rec('和', '2026-06-03');
  const k2 = rec('和', '2026-06-10');
  const s = state([], { ink: { '2026-06': { [k2.id]: INK_ENTRY } } });
  s.records['2026-06'] = { folded: true, month: '2026-06', byDay: { '2026-06-03': ['和', '永'], '2026-06-10': ['和'] }, chars: ['和', '永'], kept: [k1, k2] };
  const fs = monthSheet(recordIndex(s), '2026-06');
  assert.deepEqual(fs.cells.map(c => [c.char, c.record ? c.record.id : null, c.day]), [['和', k2.id, '2026-06-03'], ['永', null, '2026-06-03']]);
});

test('D42 day items: the char keeps the latest record OF THAT DAY that has ink; order stays by latest; none that day keeps the latest', () => {
  serial = 0;
  const rs = [rec('数', TODAY), rec('感', TODAY), rec('数', TODAY), rec('静', TODAY), rec('静', '2026-09-25')];
  // r1（数 的第一次）有墨、r3（数 最近一次）没有；感 没有墨；静 只有 9-25 有墨
  const idx = recordIndex(state(rs, { ink: { '2026-09': { r1: INK_ENTRY, r5: INK_ENTRY } } }));
  assert.deepEqual(dayItems(idx, TODAY).map(i => [i.char, i.record.id]), [['感', 'r2'], ['数', 'r1'], ['静', 'r4']],
    '数 falls back to its older same-day ink; 感 / 静 have none that day: latest of the day, no borrowing');
});

test('record days: judged + folded byDay; answer-seen / skipped / legacy.days excluded', () => {
  serial = 0;
  const s = state([rec('静', '2026-09-01'), rec('户', '2026-09-02', { kind: 'answer-seen' }), rec('虽', '2026-09-03', { kind: 'skipped' })], {
    legacy: { importedAt: 1, fromKeys: [], days: ['2026-09-05'], report: {} },
  });
  s.records['2026-06'] = { folded: true, month: '2026-06', byDay: { '2026-06-03': ['永', '和'], '2026-06-10': ['和', '天'] }, chars: ['永', '和', '天'], kept: [] };
  const idx = recordIndex(s);
  assert.deepEqual([...idx.days].sort(), ['2026-06-03', '2026-06-10', '2026-09-01']);
  assert.equal(firstRecordMonth(idx), '2026-06');
  const fs = monthSheet(idx, '2026-06');
  assert.equal(fs.folded, true);
  assert.deepEqual(fs.cells.map(c => [c.char, c.tag, c.record]), [['永', '2026-06-03', null], ['和', null, null], ['天', '2026-06-10', null]]);
  assert.equal(fs.days, 2);
  assert.deepEqual(dayItems(idx, '2026-06-10'), [{ char: '和', record: null, dot: false }, { char: '天', record: null, dot: false }]);
});

test('calendar: Monday-first blanks, 7-multiple, today / future / has flags', () => {
  serial = 0;
  const idx = recordIndex(state([rec('静', '2026-09-08')]));
  const cal = calendarModel(idx, '2026-09', TODAY);
  assert.equal(cal.filter(c => c.blank).length + 30, cal.length);
  assert.equal(cal.length % 7, 0);
  assert.equal(cal.findIndex(c => !c.blank), 1, 'Sep 1 2026 is a Tuesday');
  assert.deepEqual(cal.filter(c => c.has).map(c => c.day), ['2026-09-08']);
  assert.deepEqual(cal.filter(c => c.today).map(c => c.day), [TODAY]);
  assert.equal(cal.filter(c => c.future).length, 6);
  const aug = calendarModel(idx, '2026-08', TODAY);
  assert.equal(aug.findIndex(c => !c.blank), 5, 'Aug 1 2026 is a Saturday');
});

test('sheet preview: ≤ 3 rows untouched; more → last 3 rows of the 7-column layout, first cell re-tagged', () => {
  const cells = n => Array.from({ length: n }, (_, i) => ({ char: String.fromCharCode(0x4e00 + i), day: `2026-09-${String(1 + Math.floor(i / 10)).padStart(2, '0')}`, record: null }));
  const mk = n => {
    let prev = null;
    return { cells: cells(n).map(c => { const tag = c.day !== prev ? c.day : null; prev = c.day; return { ...c, tag }; }) };
  };
  const small = sheetPreview(mk(21));
  assert.deepEqual([small.truncated, small.cells.length, small.hidden], [false, 21, 0]);
  const p = sheetPreview(mk(300));
  assert.equal(p.truncated, true);
  assert.equal(p.total, 300);
  const totalRows = Math.ceil(300 / MINE_SHEET_COLS);
  assert.equal(p.hidden, (totalRows - MINE_SHEET_ROWS) * MINE_SHEET_COLS);
  assert.equal(p.cells.length, 300 - p.hidden);
  assert.ok(p.cells.length > 14 && p.cells.length <= 21);
  assert.equal(p.cells[0].char, String.fromCharCode(0x4e00 + p.hidden));
  assert.equal(p.cells[0].tag, p.cells[0].day, 'first visible cell always carries its date');
  const p22 = sheetPreview(mk(22));
  assert.deepEqual([p22.truncated, p22.cells.length], [true, 15], '22 chars = 4 rows → rows 2–4 (15 cells)');
});

test('day items: same char keeps its latest record, ordered by latest (home ink row rule)', () => {
  serial = 0;
  const idx = recordIndex(state([rec('数', TODAY), rec('感', TODAY), rec('数', TODAY), rec('赢', TODAY, { judgment: 'wrong' }),
    rec('户', TODAY, { kind: 'answer-seen' }), rec('静', '2026-09-22')]));
  assert.deepEqual(dayItems(idx, TODAY).map(i => [i.char, i.record.id]), [['感', 'r2'], ['数', 'r3']], '赢 (wrong) is not a work member');
  assert.deepEqual(dayItems(idx, 'bad'), []);
});

test('records model: clamp month, prev / next ends, selection only on record days of that month, today row only this month', () => {
  serial = 0;
  const s = state([rec('静', '2026-08-20'), rec('谁', '2026-09-01'), rec('数', TODAY)]);
  const cur = recordsModel(s, TODAY, {});
  assert.deepEqual([cur.month, cur.current, cur.prev, cur.next], ['2026-09', true, '2026-08', null]);
  assert.equal(cur.recordDays, 2);
  assert.deepEqual(cur.todayRow && [cur.todayRow.day, cur.todayRow.n], [TODAY, 1]);
  const aug = recordsModel(s, TODAY, { month: '2026-08', day: '2026-08-20' });
  assert.deepEqual([aug.month, aug.prev, aug.next, aug.todayRow], ['2026-08', null, '2026-09', null]);
  assert.deepEqual(aug.selected.items.map(i => i.char), ['静']);
  assert.equal(recordsModel(s, TODAY, { month: '2026-08', day: '2026-08-21' }).selected, null, 'no records that day');
  assert.equal(recordsModel(s, TODAY, { month: '2026-09', day: '2026-08-20' }).selected, null, 'day of another month');
  assert.equal(clampMonth('2027-01', recordIndex(s), TODAY), '2026-09', 'future → this month');
  assert.equal(clampMonth('2025-01', recordIndex(s), TODAY), '2026-08', 'before first → first');
  assert.equal(clampMonth('nope', recordIndex(s), TODAY), '2026-09');
  const none = recordsModel(null, TODAY, {});
  assert.deepEqual([none.prev, none.next, none.recordDays, none.empty], [null, null, 0, true]);
});

test('last backup day from backupMeta.lastExportAt; mine sheet only when this month has chars', () => {
  assert.equal(lastBackupDay(null), null);
  assert.equal(lastBackupDay({ lastExportAt: null }), null);
  assert.equal(lastBackupDay({ lastExportAt: new Date('2026-09-01T12:00:00').getTime() }), '2026-09-01');
  serial = 0;
  const onlyAug = mineModel(state([rec('静', '2026-08-20')], { backupMeta: { lastExportAt: new Date('2026-09-01T12:00:00').getTime() } }), TODAY);
  assert.deepEqual([onlyAug.empty, onlyAug.sheetOn, onlyAug.lastBackup, onlyAug.year], [false, false, '2026-09-01', 2026]);
});

test('300 chars in a month: models stay fast', () => {
  serial = 0;
  const chars = Array.from({ length: 300 }, (_, i) => String.fromCharCode(0x4e00 + i));
  const rs = chars.map((c, i) => rec(c, `2026-09-${String(1 + Math.floor(i / 13)).padStart(2, '0')}`));
  const s = state(rs);
  const t0 = performance.now();
  const m = mineModel(s, TODAY);
  const r = recordsModel(s, TODAY, { day: TODAY });
  const ms = performance.now() - t0;
  assert.equal(m.sheet.chars, 300);
  assert.equal(r.sheet.cells.length, 300);
  assert.ok(ms < 100, `models in ${ms.toFixed(1)}ms`);
});

test('D66 ⑱ backup hint: >= 30 days since last backup (or since first record when never backed up), only with records and changes', () => {
  serial = 0;
  const at = day => new Date(`${day}T12:00:00`).getTime();
  const rs = [rec('静', '2026-07-01')];
  // 从没备份：最早记录 7/1 → 9/24 = 85 天
  assert.deepEqual(mineModel(state(rs), TODAY).backupHint, { kind: 'stale', days: 85 });
  // 刚满 30 天才出，29 天不出
  assert.deepEqual(backupHint(state([rec('谁', '2026-08-25')]), TODAY), { kind: 'stale', days: 30 });
  assert.equal(backupHint(state([rec('谁', '2026-08-26')]), TODAY), null, '29 days: no hint');
  // 备份过：距上次备份
  assert.deepEqual(backupHint(state(rs, { backupMeta: { lastExportAt: at('2026-08-20'), lastExportSig: 'x' } }), TODAY), { kind: 'stale', days: 35 });
  assert.equal(backupHint(state(rs, { backupMeta: { lastExportAt: at('2026-09-10'), lastExportSig: 'x' } }), TODAY), null, '14 days');
  // 备份以后记录没变（签名一致）：没有东西可备份，不提示
  const st = state(rs, { backupMeta: { lastExportAt: at('2026-08-01') } });
  st.backupMeta.lastExportSig = recordsSignature(st.records);
  assert.equal(backupHint(st, TODAY), null);
  // 没有记录（含只看过答案）：不提示
  assert.equal(backupHint(state([]), TODAY), null);
  assert.equal(backupHint(null, TODAY), null);
  assert.equal(backupHint(state([rec('户', '2026-06-01', { kind: 'answer-seen' })], { backupMeta: { lastExportAt: at('2026-06-02') } }), TODAY), null);
});

test('D66 ⑱ storage pressure (card A field storagePressure): shown only when readable and near the limit; wins over the 30-day hint', () => {
  serial = 0;
  const rs = [rec('静', '2026-07-01')];
  for (const v of [true, 'near', 'high', 'full', { near: true }, { level: 'high' }, { level: 'warn', ratio: 0.82 }, 'warn', { ratio: 0.9 }, 0.85]) assert.equal(storagePressureNear(v), true, JSON.stringify(v));
  for (const v of [undefined, null, false, 0, 0.3, 'ok', {}, { level: 'low' }, NaN]) assert.equal(storagePressureNear(v), false, String(v));
  assert.equal(backupHint(state(rs, { backupMeta: { lastExportAt: new Date('2026-09-20T12:00:00').getTime(), lastExportSig: 'x' } }), TODAY), null, 'field absent → nothing');
  assert.deepEqual(backupHint(state(rs, { storagePressure: 'near', backupMeta: { lastExportAt: new Date('2026-09-20T12:00:00').getTime(), lastExportSig: 'x' } }), TODAY), { kind: 'pressure' });
  assert.deepEqual(mineModel(state(rs), TODAY, { storagePressure: true }).backupHint, { kind: 'pressure' }, 'opts.storagePressure beats the 30-day hint');
  assert.equal(backupHint(state([]), TODAY, undefined, { storagePressure: true }), null, 'no records → nothing to export');
});
