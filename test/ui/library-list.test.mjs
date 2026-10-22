// M3-2 写错过 / 快忘了清单的纯逻辑单测（02 M3-2；04 R-E01–R-E04；决定-D23；K15 / K16；边改 S06 / Z02；03 P04）。
// 清单条目（只看最近一次有效记录、两单不重叠、写错过排序与次数、快忘了到期与上限）、行（词语加粗、小字、小图标签）、
// 勾选（默认全选、点圆圈、全选 / 全不选、不能练的字不可选）、底部三态文案、空态文案、「从本页开的组」判断；
// 两条离开路径（再练写对 / 结果页更正为对）走真实 mutator（judgeInDraft / correctResultInDraft）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal, rec } from '../core/helpers.mjs';
import {
  LIST_KINDS, VIEW_OF_KIND, normalizeKind, recordsOfState, dateText as dateTextRaw, wordParts, listEntries, listModel as listModelRaw, normalizeSel, sameSel,
  toggleSel, listRowMetaParts, selectAllSel, selectNoneSel, buttonLabel as buttonLabelRaw, hintText as hintTextRaw, groupFromHereActive,
} from '../../src/session/views/library-list.js';

// B3.4：视图模型给「键 + 参数」；这里照 t() 渲染后核对文案一字不变。
const listModel = (...args) => renderRefs(listModelRaw(...args));
const dateText = day => renderRefs(dateTextRaw(day));
const buttonLabel = n => renderRefs(buttonLabelRaw(n));
const hintText = n => renderRefs(hintTextRaw(n));
import { judgeInDraft } from '../../src/ui/screens/write/compare.js';
import { correctResultInDraft } from '../../src/ui/screens/result/index.js';
import { createSession, endSlot } from '../../src/core/sessions.js';
import { forgetList, wrongList } from '../../src/core/records.js';
import { applyJudgment } from '../../src/core/fsrs.js';
import { t, renderRefs } from '../../src/config/copy/index.js';
import { localDay } from '../../src/core/dates.js';
import * as policy from '../../src/config/policy.js';
import { listDefaultSelectOf } from '../../src/core/group-size.js';

loadFSRSGlobal();

const TODAY = '2026-09-30';
const CARDS = { 永: { word: '永远' }, 和: { word: '和平' }, 春: { word: '春天' }, 大: { word: '大' }, 山: { word: '高山' } };
const cardFor = key => CARDS[key.slice(5)] || null;
const practicable = key => key.startsWith('base:') && !!cardFor(key);

// 这些清单用例按「我的 › 每组字数」选 5 写（默认勾选 = 每组字数，D66 ⑬）；缺省 20 字一组的另见下面的 D66 ⑬ 用例。
function stateOf(records, sched = {}, sessions = { A: null, B: null, lastEnded: {} }, settings = { groupSize: 5 }) {
  const byMonth = {};
  for (const r of records) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: byMonth, sched, sessions, ink: {}, settings };
}

const due = (day, stability = 3) => ({ fsrs: { stability }, due: day, lastJudgedAt: 0 });

test('kinds and views: wrong → wrongList, forget → forgetList; legacy againList accepted', () => {
  assert.deepEqual(LIST_KINDS, ['wrong', 'forget', 'due', 'shaky', 'known', 'skipped']);
  assert.equal(VIEW_OF_KIND.skipped, 'skippedList');
  assert.equal(normalizeKind('skippedList'), 'skipped');
  assert.equal(VIEW_OF_KIND.due, 'dueList');
  assert.equal(normalizeKind('knownList'), 'known');
  assert.equal(normalizeKind('shaky'), 'shaky');
  assert.equal(VIEW_OF_KIND.wrong, 'wrongList');
  assert.equal(VIEW_OF_KIND.forget, 'forgetList');
  assert.equal(normalizeKind('forget'), 'forget');
  assert.equal(normalizeKind('forgetList'), 'forget');
  assert.equal(normalizeKind('wrong'), 'wrong');
  assert.equal(normalizeKind('againList'), 'wrong');
  assert.equal(normalizeKind(undefined), 'wrong');
});

test('R-E01 / D23: only the latest judged record decides; answer-seen / skipped after a wrong keep it in 写错过', () => {
  const records = [
    rec(1, '永', 'judged', 'wrong', '2026-09-20'),
    rec(2, '永', 'answer-seen', null, '2026-09-21'),
    rec(3, '永', 'skipped', null, '2026-09-22'),
    rec(4, '和', 'judged', 'wrong', '2026-09-20'),
    rec(5, '和', 'judged', 'correct', '2026-09-23'), // 写对了 → 离开写错过
    rec(6, '春', 'judged', 'correct', '2026-09-10'),
    rec(7, '春', 'judged', 'wrong', '2026-09-24'), // 最近写错 → 在写错过
  ];
  const st = stateOf(records);
  const wrong = listEntries(st, { kind: 'wrong', today: TODAY });
  assert.deepEqual(wrong.map(e => e.char), ['春', '永'], 'most recent wrong first (by id)');
  assert.deepEqual(wrong.map(e => e.record.id), ['r7', 'r1']);
  assert.deepEqual(wrong.map(e => e.count), [1, 1], '一共写错 N 次 counts judged wrong records of the char');
  assert.equal(recordsOfState(st).length, 7);
});

test('R-E01 / K16: 快忘了 = latest judged correct and due; mutually exclusive with 写错过; cap from policy', () => {
  const records = [
    rec(1, '永', 'judged', 'correct', '2026-09-01'),
    rec(2, '和', 'judged', 'wrong', '2026-09-01'),
    rec(3, '春', 'judged', 'correct', '2026-09-02'),
    rec(4, '春', 'judged', 'correct', '2026-09-05'),
    rec(5, '山', 'judged', 'correct', '2026-09-05'),
  ];
  const sched = { 'base:永': due('2026-09-20'), 'base:和': due('2026-09-10'), 'base:春': due('2026-09-28'), 'base:山': due('2026-10-20') };
  const st = stateOf(records, sched);
  const forget = listEntries(st, { kind: 'forget', today: TODAY });
  assert.deepEqual(forget.map(e => e.char), ['永', '春'], 'overdue first; 和 (latest wrong) and 山 (not due) excluded');
  assert.deepEqual(forget.map(e => e.count), [1, 2], '记录了 N 次 = judged records of the char');
  const wrong = listEntries(st, { kind: 'wrong', today: TODAY });
  assert.deepEqual(wrong.map(e => e.char), ['和']);
  const both = new Set([...forget.map(e => e.char)]);
  assert.ok(wrong.every(e => !both.has(e.char)), 'no overlap');
  const capped = listEntries(st, { kind: 'forget', today: TODAY, policy: { ...policy, forgetCap: 1 } });
  assert.deepEqual(capped.map(e => e.char), ['永'], 'policy.forgetCap (P04)');
});

test('R-E03 rows: word with the target bold, meta line, 写错那次 caption only in 写错过', () => {
  const st = stateOf([rec(1, '永', 'judged', 'wrong', '2026-09-21'), rec(2, '永', 'judged', 'wrong', '2026-09-24')],
    { 'base:永': due('2026-09-25') });
  const m = listModel(st, { kind: 'wrong', today: TODAY, cardFor, practicable });
  assert.equal(m.rows.length, 1);
  const row = m.rows[0];
  assert.deepEqual(row.word, { pre: '', tg: '永', post: '远', has: true });
  assert.equal(row.meta, '9月24日写错 · 共 2 次');
  assert.equal(row.meta, t('R-E03.wrongMeta', { date: dateText('2026-09-24'), n: 2 }));
  assert.deepEqual(listRowMetaParts(row.meta), ['9月24日写错 ·', '共 2 次'], 'H1: 间隔号随前一段，不落行首');
  assert.equal(row.thumbCaption, t('R-E03.wrongThumb'));
  assert.equal(m.note, t('R-E03.wrongNote'), 'D27: default perRecordInk=true → 右边小图是你写错的那一次 (the latest is always kept)');
  const OFF = { ...policy, features: { ...policy.features, perRecordInk: false } };
  assert.equal(listModel(st, { kind: 'wrong', today: TODAY, cardFor, practicable, policy: OFF }).note, t('R-E03.wrongNoteGlyph'), 'F4: off → Glyph variant');
  assert.equal(m.top, t('R-E04.wrongTop'));
  assert.equal(m.title, t('R-E04.titleWrong'));
  assert.equal(m.head, '先练这 1 个');

  const st2 = stateOf([rec(3, '和', 'judged', 'correct', '2026-09-02'), rec(4, '和', 'judged', 'correct', '2026-09-06')],
    { 'base:和': due('2026-09-20') });
  const f = listModel(st2, { kind: 'forget', today: TODAY, cardFor, practicable });
  assert.equal(f.rows[0].meta, '最近 9月6日 · 写过 2 次');
  assert.equal(f.rows[0].thumbCaption, '', '快忘了小图下不写');
  assert.equal(f.note, t('R-E03.forgetNote'), 'D27: default on → 格子里是你最近一次的笔迹');
  assert.equal(listModel(st2, { kind: 'forget', today: TODAY, cardFor, practicable, policy: OFF }).note, t('R-E03.forgetNoteGlyph'), 'F4: off → Glyph variant');
  assert.equal(f.top, t('R-E04.forgetTop'));
  assert.equal(f.title, t('R-E04.titleForget'));

  assert.deepEqual(wordParts('大', '大'), { pre: '', tg: '', post: '', has: false }, 'word equal to the char is not shown');
  assert.deepEqual(wordParts('高山', '山'), { pre: '高', tg: '山', post: '', has: true });
  assert.deepEqual(wordParts('', '山').has, false);
  assert.deepEqual(wordParts('越来越', '越'), { pre: '', tg: '越', post: '来越', has: true }, 'first occurrence bold');
});

test('R-E02 / S06 / Z02: ≤5 rows → default all selected; toggle, select none / all, three bottom states', () => {
  const records = [
    rec(1, '永', 'judged', 'wrong', '2026-09-20'),
    rec(2, '和', 'judged', 'wrong', '2026-09-21'),
    rec(3, '春', 'judged', 'wrong', '2026-09-22'),
  ];
  const st = stateOf(records);
  let sel = null;
  let m = listModel(st, { kind: 'wrong', sel, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 3, '不足 5 个：默认全选');
  assert.equal(m.head, '先练这 3 个', '不足 5 个按实际数');
  assert.equal(m.restCount, 0);
  assert.equal(m.allSelected, true);
  assert.equal(m.toggleAllLabel, t('X-LIST.selectNone'));
  assert.equal(m.hint, '选了 3 个字 · 写完会回到这里。');
  assert.equal(m.button.label, '练这些字');
  assert.equal(m.button.disabled, false);
  assert.deepEqual(m.selectedKeys, ['base:春', 'base:和', 'base:永'], 'display order');

  const defaults = m.rows.map(r => r.char);
  sel = toggleSel(toggleSel(defaults, '春'), '和');
  m = listModel(st, { kind: 'wrong', sel, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 1);
  assert.equal(m.allSelected, false);
  assert.equal(m.hint, '选了 1 个字 · 写完会回到这里。');
  assert.equal(m.button.label, '练这个字');
  assert.equal(m.toggleAllLabel, t('X-LIST.selectAll'));
  assert.equal(m.customSel, true);

  sel = selectNoneSel();
  m = listModel(st, { kind: 'wrong', sel, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 0);
  assert.equal(m.hint, t('R-E02.selectedZero'));
  assert.deepEqual(m.button, { label: '先选字', disabled: true });

  sel = selectAllSel(m);
  m = listModel(st, { kind: 'wrong', sel, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 3);

  assert.deepEqual(toggleSel(toggleSel([], '永'), '永'), [], 'toggle twice → back to unselected');
  assert.equal(buttonLabel(2), t('R-E02.btnMany'));
  assert.equal(buttonLabel(1), t('R-E02.btnOne'));
  assert.equal(buttonLabel(0), t('R-E02.btnNone'));
  assert.equal(hintText(0), t('R-E02.selectedZero'));
  assert.equal(hintText(4), t('R-E02.selected', { n: 4 }));
  assert.equal(sameSel(['永', '和'], ['和', '永', '永']), true);
  assert.equal(sameSel(['永'], []), false);
  assert.equal(sameSel(null, []), false, 'default is not the same as an explicit empty choice');
  assert.equal(sameSel(null, undefined), true);
  assert.equal(normalizeSel(null), null);
  assert.equal(normalizeSel(undefined), null);
  assert.deepEqual(normalizeSel(['永', '永', '', 3]), ['永']);
});

// 8 个写错过的字（id 越大越新）：最近写错的排前。8 个字取自 CARDS 之外也行——cardFor / practicable 对未知字返回 null / false，
// 这里单独造一张含 8 个字的假卡表。
const MANY = ['一', '二', '三', '四', '五', '六', '七', '八'];
const manyCardFor = key => ({ word: key.slice(5) + '字' });
const manyPracticable = key => key.startsWith('base:');

test('B4 (G38, D36): 写错过 with 8 rows → default selects only the 5 most recently wrong; head 先练这 5 个; the rest fold under 其余 N 个字', () => {
  const records = MANY.map((c, i) => rec(i + 1, c, 'judged', 'wrong', `2026-09-${String(10 + i).padStart(2, '0')}`));
  const st = stateOf(records);
  const m = listModel(st, { kind: 'wrong', today: TODAY, cardFor: manyCardFor, practicable: manyPracticable });
  assert.deepEqual(m.rows.map(r => r.char), ['八', '七', '六', '五', '四', '三', '二', '一'], 'most recently wrong first');
  assert.deepEqual(m.rows.filter(r => r.selected).map(r => r.char), ['八', '七', '六', '五', '四'], 'default = the 5 most recent');
  assert.deepEqual(m.rows.map(r => r.group), ['top', 'top', 'top', 'top', 'top', 'rest', 'rest', 'rest']);
  assert.equal(m.selectedCount, 5);
  assert.equal(m.head, '先练这 5 个');
  assert.equal(m.topCount, 5);
  assert.equal(m.restCount, 3);
  assert.equal(m.restLabel, '其余 3 个字 ›');
  assert.equal(m.restHideLabel, '收起其余 3 个字');
  assert.equal(m.allSelected, false);
  assert.equal(m.toggleAllLabel, t('X-LIST.selectAll'));
  assert.equal(m.hint, '选了 5 个字 · 写完会回到这里。');
  assert.equal(m.customSel, false);
  assert.equal(policy.listDefaultSelect, 5);
  // 从默认展开成数组再点：取消最该练的一个、选上其余的一个
  const defaults = m.rows.filter(r => r.selected).map(r => r.char);
  const sel = toggleSel(toggleSel(defaults, '八'), '二');
  const m2 = listModel(st, { kind: 'wrong', sel, today: TODAY, cardFor: manyCardFor, practicable: manyPracticable });
  assert.deepEqual(m2.rows.filter(r => r.selected).map(r => r.char), ['七', '六', '五', '四', '二']);
  assert.equal(m2.head, '先练这 5 个', 'the head labels the group, not the current selection');
  // 全选 → 8 个
  const all = listModel(st, { kind: 'wrong', sel: selectAllSel(m), today: TODAY, cardFor: manyCardFor, practicable: manyPracticable });
  assert.equal(all.selectedCount, 8);
  assert.equal(all.allSelected, true);
  // 自定义 limit
  const three = listModel(st, { kind: 'wrong', today: TODAY, cardFor: manyCardFor, practicable: manyPracticable, policy: { ...policy, listDefaultSelect: 3 } });
  assert.equal(three.selectedCount, 3);
  assert.equal(three.head, '先练这 3 个');
});

test('D66 ⑬: the default selection follows 每组字数 (policy.listDefaultSelect 5 per 5-char group → = group size)', () => {
  const chars = Array.from({ length: 34 }, (_, i) => String.fromCodePoint(0x4e00 + 0x100 + i));
  const records = chars.map((c, i) => rec(i + 1, c, 'judged', 'wrong', `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`));
  const pick = settings => listModel(stateOf(records, {}, undefined, settings), { kind: 'wrong', today: TODAY, cardFor: manyCardFor, practicable: manyPracticable });
  assert.equal(pick(null).selectedCount, 20, 'never chosen → group size 20 → 20');
  assert.equal(pick({}).head, '先练这 20 个');
  assert.equal(pick({ groupSize: 10 }).selectedCount, 10);
  assert.equal(pick({ groupSize: 30 }).selectedCount, 30);
  assert.equal(pick({ groupSize: 5 }).selectedCount, 5);
  assert.equal(listDefaultSelectOf({ groupSize: 30 }), 30);
  assert.equal(listDefaultSelectOf(null), 20);
});

test('B4: 快忘了 default = the 5 longest overdue (list order); rows that cannot be practised do not take a slot', () => {
  const days = ['2026-09-10', '2026-09-12', '2026-09-14', '2026-09-16', '2026-09-18', '2026-09-20', '2026-09-22'];
  const records = [];
  const sched = {};
  MANY.slice(0, 7).forEach((c, i) => {
    records.push(rec(i + 1, c, 'judged', 'correct', '2026-09-01'));
    sched[`base:${c}`] = due(days[i]);
  });
  const st = stateOf(records, sched);
  const m = listModel(st, { kind: 'forget', today: TODAY, cardFor: manyCardFor, practicable: manyPracticable });
  assert.deepEqual(m.rows.map(r => r.char), ['一', '二', '三', '四', '五', '六', '七'], 'longest overdue first');
  assert.deepEqual(m.rows.filter(r => r.selected).map(r => r.char), ['一', '二', '三', '四', '五']);
  assert.equal(m.head, '先练这 5 个');
  assert.equal(m.restCount, 2);
  // 排在最前面的一行练不了：不占名额（第 6 个能练的字顶上）
  const noFirst = listModel(st, { kind: 'forget', today: TODAY, cardFor: manyCardFor, practicable: key => key !== 'base:一' });
  assert.deepEqual(noFirst.rows.map(r => [r.char, r.group, r.selected]).slice(0, 7), [
    ['一', 'top', false], ['二', 'top', true], ['三', 'top', true], ['四', 'top', true], ['五', 'top', true], ['六', 'top', true], ['七', 'rest', false],
  ]);
  assert.equal(noFirst.head, '先练这 5 个');
});

test('rows that cannot be practised (custom: / not in deck) show but are not selectable and never go into the group', () => {
  const custom = { ...rec(1, '犇', 'judged', 'wrong', '2026-09-20'), cardKey: 'custom:犇' };
  const st = stateOf([custom, rec(2, '永', 'judged', 'wrong', '2026-09-21')]);
  const m = listModel(st, { kind: 'wrong', today: TODAY, cardFor, practicable });
  assert.deepEqual(m.rows.map(r => [r.char, r.selectable, r.selected]), [['永', true, true], ['犇', false, false]]);
  assert.deepEqual(m.selectedKeys, ['base:永']);
  assert.equal(m.selectableCount, 1);
  assert.deepEqual(selectAllSel(m), ['永']);
});

test('R-E04 empty states', () => {
  const w = listModel(stateOf([]), { kind: 'wrong', today: TODAY, cardFor, practicable });
  assert.equal(w.empty, true);
  assert.equal(w.emptyTitle, '现在没有写错过的字');
  assert.equal(w.emptyTitle, t('R-E04.wrongEmpty'));
  assert.equal(w.emptyBody, t('X-LIST.wrongEmptyBody'));
  assert.equal(w.emptyGlyph, t('X-LIST.emptyGlyphWrong'));
  assert.equal(w.button.disabled, true);
  const f = listModel(stateOf([]), { kind: 'forget', today: TODAY, cardFor, practicable });
  assert.equal(f.emptyBody, '可能快忘了的字会放在这里。');
  assert.equal(f.emptyBody, t('R-E04.forgetEmpty'));
  assert.equal(f.emptyTitle, t('X-LIST.forgetEmptyTitle'));
  assert.equal(listModel(null, { kind: 'forget', today: TODAY }).empty, true, 'no state → empty, no throw');
});

test('groupFromHereActive: an unfinished B whose source is this list', () => {
  const b = createSession({ id: 's9', kind: 'picked', source: { view: 'wrongList' }, queue: ['base:永'], at: 1 });
  const st = stateOf([], {}, { A: null, B: b, lastEnded: {} });
  assert.equal(groupFromHereActive(st, 'wrongList'), true);
  assert.equal(groupFromHereActive(st, 'forgetList'), false);
  assert.equal(groupFromHereActive(stateOf([], {}, { A: null, B: { ...b, cursor: 1 }, lastEnded: {} }), 'wrongList'), false, 'finished');
  assert.equal(groupFromHereActive(stateOf([], {}, { A: null, B: { ...b, source: { view: 'againList' } }, lastEnded: {} }), 'wrongList'), true);
  assert.equal(groupFromHereActive(stateOf([]), 'wrongList'), false);
});

// ---------------------------------------------------------------- 场景 8：两条离开写错过的路径（真实 mutator）

const STROKE = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];

function idGen(start = 100) {
  let n = start;
  return p => p + (n += 1);
}

function seededWrong() {
  // 永 早先写错（sched 到期），和 早先写对且到期（在快忘了）
  const records = [rec(1, '永', 'judged', 'wrong', '2026-09-10'), rec(2, '和', 'judged', 'correct', '2026-09-10')];
  // 真实 FSRS 卡（applyJudgment），到期日改到过去
  const real = (r, day) => ({ ...applyJudgment(undefined, r).entry, due: day });
  const sched = { 'base:永': real(records[0], '2026-09-12'), 'base:和': real(records[1], '2026-09-15') };
  return stateOf(records, sched);
}

test('scenario 8a: wrong → later written correct in a group from 写错过 → leaves 写错过, does not enter 快忘了', () => {
  const d = JSON.parse(JSON.stringify(seededWrong()));
  const before = listModel(d, { kind: 'wrong', today: TODAY, cardFor, practicable });
  assert.deepEqual(before.rows.map(r => r.char), ['永']);
  d.sessions.B = createSession({ id: 's50', kind: 'picked', source: { view: 'wrongList' }, queue: before.selectedKeys, at: Date.now() });
  judgeInDraft(d, { slot: 'B', cardKey: 'base:永', judgment: 'correct', strokes: STROKE, at: Date.now(), nextId: idGen() });
  const today = localDay(Date.now());
  const wrong = listModel(d, { kind: 'wrong', today, cardFor, practicable });
  const forget = listModel(d, { kind: 'forget', today, cardFor, practicable });
  assert.equal(wrong.empty, true, '永 left 写错过');
  assert.ok(!forget.rows.some(r => r.char === '永'), '永 not in 快忘了 (fresh correct is not due)');
  assert.ok(forget.rows.some(r => r.char === '和'), '和 still in 快忘了');
  const all = recordsOfState(d);
  assert.deepEqual(wrongList(all).map(r => r.char), []);
  assert.ok(!forgetList({ records: all, sched: d.sched, today }).items.some(i => i.record.char === '永'));
});

test('scenario 8b: wrong again in the group, then corrected to 写对 on the result page → leaves 写错过, not 快忘了, no new record', () => {
  const d = JSON.parse(JSON.stringify(seededWrong()));
  d.sessions.B = createSession({ id: 's51', kind: 'picked', source: { view: 'wrongList' }, queue: ['base:永'], at: Date.now() });
  judgeInDraft(d, { slot: 'B', cardKey: 'base:永', judgment: 'wrong', strokes: STROKE, at: Date.now(), nextId: idGen() });
  const today = localDay(Date.now());
  assert.deepEqual(listModel(d, { kind: 'wrong', today, cardFor, practicable }).rows.map(r => r.char), ['永']);
  d.sessions = endSlot(d.sessions, 'B', { at: Date.now() });
  const count = recordsOfState(d).length;
  const judged = recordsOfState(d).find(r => r.sessionId === 's51');
  correctResultInDraft(d, { slot: 'B', sessionId: 's51', recordId: judged.id, to: 'correct', at: Date.now() });
  assert.equal(recordsOfState(d).length, count, 'correction adds no record (D19)');
  assert.equal(listModel(d, { kind: 'wrong', today, cardFor, practicable }).empty, true, '永 left 写错过');
  assert.ok(!listModel(d, { kind: 'forget', today, cardFor, practicable }).rows.some(r => r.char === '永'), 'not in 快忘了');
});

test('list.js registers the screen, the none-page action and exports openList / setListActions', async () => {
  const { getScreen } = await import('../../src/ui/router.js');
  const mod = await import('../../src/ui/screens/library/list.js');
  assert.equal(mod.LIST_SCREEN, 'library-list');
  assert.ok(getScreen('library-list'), 'self-registered');
  assert.equal(typeof mod.openList, 'function');
  assert.equal(typeof mod.setListActions, 'function');
  mod.setListActions({ detail: () => {} });
  mod.setListActions({ detail: null });
});
