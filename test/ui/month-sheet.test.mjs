// 月字帖页的角标与读屏名称（V2-09 / T2-05 / N2-07）：角标与排序同一个日子（firstDay），数字只增不减；
// 墨迹取自另一天时只在读屏名称里补一句，画面上不标；角标画在格内左上角，不压格线（样式在 components/work.js，单测里看 CSS 文本）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthModel } from '../../src/ui/screens/mine/month.js';
import { buildStroke, encodeInk } from '../../src/core/ink-math.js';
import * as policy from '../../src/config/policy.js';
import { MONTH_PAPER_TAG_CSS } from '../../src/ui/components/work.js';
import { rec } from '../core/helpers.mjs';

const INK = encodeInk([buildStroke([{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }], { final: true })]);

function fixture() {
  // 永：9-02 写过（墨迹已回收）、9-28 再写（有墨）；和 9-02；山 9-05；水 9-28
  const records = [
    rec(1, '永', 'judged', 'correct', '2026-09-02'),
    rec(2, '和', 'judged', 'correct', '2026-09-02'),
    rec(3, '山', 'judged', 'correct', '2026-09-05'),
    rec(4, '永', 'judged', 'correct', '2026-09-28'),
    rec(5, '水', 'judged', 'correct', '2026-09-28'),
  ];
  const state = { records: { '2026-09': records }, sessions: { A: null, B: null, lastEnded: {} } };
  const inked = new Set(['r2', 'r3', 'r4', 'r5']);
  const store = { getInk: r => (inked.has(r.id) ? INK : null) };
  return { state, store };
}

test('month page: the corner number is the sort day (firstDay), not the day of the ink that was drawn — numbers only go up', () => {
  const { state, store } = fixture();
  const m = monthModel(state, '2026-09', { store, policy });
  assert.deepEqual(m.cells.map(c => c.ch), ['永', '和', '山', '水']);
  assert.deepEqual(m.cells.map(c => c.tag), ['2', '', '5', '28']);
  assert.equal(m.cells[0].record, 'r4', '永 draws the 9-28 ink (D42: the 9-02 ink was recycled)');
  assert.equal(m.cells[0].day, '2026-09-02', '…but sits and is numbered on 9-02');
  const numbers = m.cells.map(c => c.tag).filter(Boolean).map(Number);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
});

test('month page: a cell whose ink comes from another day says so in its screen-reader name only (N2-07)', () => {
  const { state, store } = fixture();
  const m = monthModel(state, '2026-09', { store, policy });
  assert.equal(m.cells[0].label, '永 · 9月2日，9月28日的笔迹');
  assert.equal(m.cells[1].label, '和 · 9月2日', 'same day: the plain name');
});

test('D57 · C1: the day number rides the cell\'s top line (centred on it) with a paper-coloured backing that breaks the line; it does not enter the cell', () => {
  assert.match(MONTH_PAPER_TAG_CSS, /\.sz-mcell__tag\{[^}]*top:-7px/);
  assert.match(MONTH_PAPER_TAG_CSS, /\.sz-mcell__tag\{[^}]*background:var\(--paper\)/);
});
