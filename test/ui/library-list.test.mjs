// M3-2 写错过 / 快忘了清单的纯逻辑单测（02 M3-2；04 R-E01–R-E04；决定-D23；K15 / K16；边改 S06 / Z02；03 P04）。
// 清单条目（只看最近一次有效记录、两单不重叠、写错过排序与次数、快忘了到期与上限）、行（词语加粗、小字、小图标签）、
// 勾选（默认全选、点圆圈、全选 / 全不选、不能练的字不可选）、底部三态文案、空态文案、「从本页开的组」判断；
// 两条离开路径（再练写对 / 结果页更正为对）走真实 mutator（judgeInDraft / correctResultInDraft）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal, rec } from '../core/helpers.mjs';
import {
  LIST_KINDS, VIEW_OF_KIND, normalizeKind, recordsOfState, dateText, wordParts, listEntries, listModel, normalizeOff, sameOff,
  toggleOff, selectAllOff, selectNoneOff, buttonLabel, hintText, groupFromHereActive,
} from '../../src/ui/screens/library/list-model.js';
import { judgeInDraft } from '../../src/ui/screens/write/compare.js';
import { correctResultInDraft } from '../../src/ui/screens/result/index.js';
import { createSession, endSlot } from '../../src/core/sessions.js';
import { forgetList, wrongList } from '../../src/core/records.js';
import { applyJudgment } from '../../src/core/fsrs.js';
import { t } from '../../src/config/copy/index.js';
import { localDay } from '../../src/core/dates.js';
import * as policy from '../../src/config/policy.js';

loadFSRSGlobal();

const TODAY = '2026-09-30';
const CARDS = { 永: { word: '永远' }, 和: { word: '和平' }, 春: { word: '春天' }, 大: { word: '大' }, 山: { word: '高山' } };
const cardFor = key => CARDS[key.slice(5)] || null;
const practicable = key => key.startsWith('base:') && !!cardFor(key);

function stateOf(records, sched = {}, sessions = { A: null, B: null, lastEnded: {} }) {
  const byMonth = {};
  for (const r of records) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: byMonth, sched, sessions, ink: {} };
}

const due = (day, stability = 3) => ({ fsrs: { stability }, due: day, lastJudgedAt: 0 });

test('kinds and views: wrong → wrongList, forget → forgetList; legacy againList accepted', () => {
  assert.deepEqual(LIST_KINDS, ['wrong', 'forget']);
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
  assert.equal(row.meta, '9 月 24 日写错 · 一共写错 2 次');
  assert.equal(row.meta, t('R-E03.wrongMeta', { date: dateText('2026-09-24'), n: 2 }));
  assert.deepEqual(row.metaParts, ['9 月 24 日写错', '一共写错 2 次']);
  assert.equal(row.thumbCaption, t('R-E03.wrongThumb'));
  assert.equal(m.note, t('R-E03.wrongNote'));
  assert.equal(m.top, t('R-E04.wrongTop'));
  assert.equal(m.title, t('R-E04.titleWrong'));
  assert.equal(m.head, '1 个字');

  const st2 = stateOf([rec(3, '和', 'judged', 'correct', '2026-09-02'), rec(4, '和', 'judged', 'correct', '2026-09-06')],
    { 'base:和': due('2026-09-20') });
  const f = listModel(st2, { kind: 'forget', today: TODAY, cardFor, practicable });
  assert.equal(f.rows[0].meta, '最近一次 9 月 6 日 · 记录了 2 次');
  assert.equal(f.rows[0].thumbCaption, '', '快忘了小图下不写');
  assert.equal(f.note, t('R-E03.forgetNote'));
  assert.equal(f.top, t('R-E04.forgetTop'));
  assert.equal(f.title, t('R-E04.titleForget'));

  assert.deepEqual(wordParts('大', '大'), { pre: '', tg: '', post: '', has: false }, 'word equal to the char is not shown');
  assert.deepEqual(wordParts('高山', '山'), { pre: '高', tg: '山', post: '', has: true });
  assert.deepEqual(wordParts('', '山').has, false);
  assert.deepEqual(wordParts('越来越', '越'), { pre: '', tg: '越', post: '来越', has: true }, 'first occurrence bold');
});

test('R-E02 / S06 / Z02: default all selected, toggle, select none / all, three bottom states', () => {
  const records = [
    rec(1, '永', 'judged', 'wrong', '2026-09-20'),
    rec(2, '和', 'judged', 'wrong', '2026-09-21'),
    rec(3, '春', 'judged', 'wrong', '2026-09-22'),
  ];
  const st = stateOf(records);
  let off = [];
  let m = listModel(st, { kind: 'wrong', off, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 3, '默认全选');
  assert.equal(m.allSelected, true);
  assert.equal(m.toggleAllLabel, t('X-LIST.selectNone'));
  assert.equal(m.hint, '选了 3 个字 · 写完会回到这里。');
  assert.equal(m.button.label, '练这些字');
  assert.equal(m.button.disabled, false);
  assert.deepEqual(m.selectedKeys, ['base:春', 'base:和', 'base:永'], 'display order');

  off = toggleOff(toggleOff(off, '春'), '和');
  m = listModel(st, { kind: 'wrong', off, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 1);
  assert.equal(m.hint, '选了 1 个字 · 写完会回到这里。');
  assert.equal(m.button.label, '练这个字');
  assert.equal(m.toggleAllLabel, t('X-LIST.selectAll'));
  assert.deepEqual(m.selectedKeys, ['base:永']);

  off = selectNoneOff(m);
  m = listModel(st, { kind: 'wrong', off, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 0);
  assert.equal(m.hint, '写完会回到这里。', 'Y05: zero → only the tail sentence');
  assert.equal(m.button.label, '先选一个字');
  assert.equal(m.button.disabled, true, 'Z02: really disabled');

  off = selectAllOff();
  m = listModel(st, { kind: 'wrong', off, today: TODAY, cardFor, practicable });
  assert.equal(m.selectedCount, 3);

  off = toggleOff(toggleOff([], '永'), '永');
  assert.deepEqual(off, [], 'toggle twice → back to selected');
  assert.equal(buttonLabel(2), t('R-E02.btnMany'));
  assert.equal(buttonLabel(1), t('R-E02.btnOne'));
  assert.equal(buttonLabel(0), t('R-E02.btnNone'));
  assert.equal(hintText(0), t('R-E02.selectedZero'));
  assert.equal(hintText(4), t('R-E02.selected', { n: 4 }));
  assert.equal(sameOff(['永', '和'], ['和', '永', '永']), true);
  assert.equal(sameOff(['永'], []), false);
  assert.deepEqual(normalizeOff(null), []);
});

test('rows that cannot be practised (custom: / not in deck) show but are not selectable and never go into the group', () => {
  const custom = { ...rec(1, '犇', 'judged', 'wrong', '2026-09-20'), cardKey: 'custom:犇' };
  const st = stateOf([custom, rec(2, '永', 'judged', 'wrong', '2026-09-21')]);
  const m = listModel(st, { kind: 'wrong', today: TODAY, cardFor, practicable });
  assert.deepEqual(m.rows.map(r => [r.char, r.selectable, r.selected]), [['永', true, true], ['犇', false, false]]);
  assert.deepEqual(m.selectedKeys, ['base:永']);
  assert.equal(m.selectableCount, 1);
  assert.deepEqual(selectNoneOff(m), ['永']);
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
