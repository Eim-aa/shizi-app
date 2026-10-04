// 作品出口：版式函数 / 作品成员 / 分张 / 选字口径 / 渲染（阶段 1 P1-E7；交接「实现交接.md」§4–§8；D31 / D39 / D42 / D46 / D47；
// 02 M4-5；A05 单字手写图片）。
//
// 版式函数的期望值直接来自交接 §6.2「结果」一行：3:4 → 1 字 670、2 字一行 443、3 字一行 295、4 字 2×2、5 字 3+2、20 字 4×5、46 字 6×8、80 字 8×10；
// 1:1 → 5 字 3+2、20 字 5×4、80 字 9×9；竖纸一行上下留白 2:3；结果页格宽表 §5.2（402：181 / 165 / 110 / 144 / 110）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as policy from '../../src/config/policy.js';
import {
  DEFAULT_RATIO_FEW, DEFAULT_RATIO_MANY, dayTag, defaultRatio, dotDiameterPt, dotLayout, gridOf, inkWidthScale, layout, monthCell, monthColumns,
  resultGrid, withDayTags, TAG_SIZE, minInkScale,
} from '../../src/core/images/layout.js';
import { glyphLayout, inkBounds, SIZES, MARGIN } from '../../src/core/images/glyph-layout.js';
import { paginate, retagPages } from '../../src/core/images/paginate.js';
import { addedOf, buildWork, isPaperRecord, toggleAdded } from '../../src/core/images/work.js';
import { paletteFromTokens } from '../../src/core/images/palette.js';
import {
  cellOfMember, dayMembers, flattenRecords, glyphMember, imagePlan, monthCells, monthMembers, sessionWork,
} from '../../src/core/images/pick.js';
import { renderSingleGlyph, renderWorkPage } from '../../src/core/images/render.js';
import { renderAnnualLong } from '../../src/core/images/annual-render.js';
import { at, rec } from './helpers.mjs';

const TOKENS = JSON.parse(fs.readFileSync(new URL('../../docs/design/design-system-v1/tokens.json', import.meta.url), 'utf8'));
const PALETTE = paletteFromTokens(TOKENS);

// ---------------------------------------------------------------- 版式函数（§6.1 / §6.2）

test('layout: the §6.2 result table — 3:4 and 1:1 columns × rows and cell size', () => {
  const t34 = { 1: [1, 1, 670], 2: [2, 1, 443], 3: [3, 1, 295], 4: [2, 2, 367], 5: [3, 2, 295], 20: [4, 5, 221], 46: [6, 8, 146], 80: [8, 10, 110] };
  for (const [n, [cols, rows, c]] of Object.entries(t34)) {
    const l = layout(Number(n), '3:4');
    assert.deepEqual([l.cols, l.rows, l.c], [cols, rows, c], `3:4 × ${n}`);
    assert.equal(l.W, 1080);
    assert.equal(l.H, 1440);
  }
  const t11 = { 5: [3, 2, 295], 20: [5, 4, 177], 80: [9, 9, 90] };
  for (const [n, [cols, rows, c]] of Object.entries(t11)) {
    const l = layout(Number(n), '1:1');
    assert.deepEqual([l.cols, l.rows, l.c], [cols, rows, c], `1:1 × ${n}`);
    assert.equal(l.H, 1080);
  }
  // 输入是格子数组时只数个数
  assert.equal(layout([{ ch: '永' }, { ch: '和' }], '3:4').c, 443);
  assert.deepEqual(gridOf(0), { cols: 0, rows: 0, c: 0 });
  assert.equal(layout([], '3:4').n, 0);
  assert.deepEqual(layout([], '3:4').cells, []);
  assert.throws(() => layout(3, '4:3'), /INVALID_RATIO/);
  assert.throws(() => layout(-1, '3:4'), /INVALID_COUNT/);
});

test('layout: every cell fits the paper, the grid is never taller than the paper, and the last row is left-aligned (n = 1..80 × both ratios)', () => {
  for (const ratio of ['3:4', '1:1']) {
    for (let n = 1; n <= 80; n += 1) {
      const l = layout(n, ratio);
      assert.equal(l.cells.length, n);
      assert.ok(l.rows * l.cols >= n && (l.rows - 1) * l.cols < n, `${ratio} n=${n}: no empty row`);
      assert.ok(l.left >= 0 && l.left + l.cols * l.c <= l.W, `${ratio} n=${n}: inside the width`);
      assert.ok(l.top >= 0 && l.top + l.rows * l.c <= l.H, `${ratio} n=${n}: inside the height`);
      if (n >= 2) assert.ok(l.rows <= l.cols * (l.H / l.W) + 0.01, `${ratio} n=${n}: not taller than the paper`);
      assert.deepEqual(l.cells[0], { x: l.left, y: l.top });
      const last = l.cells[n - 1];
      assert.equal(last.x, l.left + ((n - 1) % l.cols) * l.c, 'left-aligned last row');
      assert.ok(l.seal.x + l.seal.size <= l.W && l.seal.y + l.seal.size <= l.H, `${ratio} n=${n}: seal on the paper`);
      assert.ok(l.kuan.top + l.kuan.lineHeight <= l.H, `${ratio} n=${n}: kuan on the paper`);
    }
  }
});

test('layout: one row on a portrait paper keeps top : bottom white space at 2 : 3 (D46 acceptance improvement)', () => {
  for (const n of [1, 2, 3]) {
    const l = layout(n, '3:4');
    const blockH = l.rows * l.c + 38 + Math.max(l.seal.size, l.kuan.size * 1.4);
    const bottom = l.H - l.top - blockH;
    assert.ok(Math.abs(l.top / bottom - 2 / 3) < 0.01, `n=${n} top ${l.top} bottom ${bottom}`);
  }
  // 两行以上：居中再上移 0.025H
  const l = layout(4, '3:4');
  const blockH = 2 * l.c + 38 + 64;
  assert.equal(l.top, Math.round((1440 - blockH) / 2 - 1440 * 0.025));
});

test('layout: seal and 落款 — last cell in the rightmost column → seal under it (right edges aligned), 落款 left of the seal; otherwise seal beside the last cell, 落款 under the grid right-aligned (§6.4)', () => {
  const three = layout(3, '3:4');
  assert.equal(three.below, true);
  assert.deepEqual([three.seal.size, three.kuan.size], [64, 36]);
  assert.equal(three.seal.x + three.seal.size, three.left + 3 * three.c, 'seal right edge = last cell right edge');
  assert.equal(three.seal.y, three.top + three.c + 38, 'seal 0.035W below the grid');
  assert.equal(three.kuan.right, three.seal.x - 22, '落款 22px left of the seal');
  assert.ok(Math.abs(three.kuan.top + three.kuan.lineHeight / 2 - (three.seal.y + three.seal.size / 2)) < 1e-9, '落款 vertically centred on the seal');
  assert.equal(three.seal.rotate, 0, 'the seal is not tilted (R2-R1: one kind of seal)');
  const five = layout(5, '3:4'); // 3 + 2：末字在第 2 列，不在最右列
  assert.equal(five.below, false);
  assert.equal(five.seal.x, five.left + 2 * five.c + Math.round(five.c * 0.12), 'beside the last cell, 0.12c');
  assert.equal(five.seal.y, five.top + 2 * five.c - 64 - Math.round(five.c * 0.06), 'bottom raised by 0.06c');
  assert.equal(five.kuan.right, five.left + 3 * five.c, '落款 right-aligned to the grid');
  assert.equal(five.kuan.top, five.top + 2 * five.c + 38, '落款 0.035W under the grid');
  const one = layout(1, '3:4');
  assert.deepEqual([one.seal.size, one.kuan.size], [64, 36], 'a single char: the same seal / 落款 size as every other count (V2-05 / T2-22)');
  for (const n of [1, 2, 3, 4, 5, 9, 20, 80]) {
    for (const ratio of ['3:4', '1:1']) {
      const l = layout(n, ratio);
      assert.deepEqual([l.seal.size, l.seal.rotate, l.kuan.size], [64, 0, 36], `n=${n} ${ratio}: one seal size, no tilt`);
    }
  }
  // 外框：末行不满且末字不在最右列 → 两段（满行矩形 + 末行矩形）；否则一个矩形
  assert.equal(five.frame.length, 2);
  assert.deepEqual(five.frame[1], { x: five.left, y: five.top + five.c, w: 2 * five.c, h: five.c });
  assert.equal(three.frame.length, 1);
  assert.equal(layout(6, '3:4').frame.length, 1, 'full rows → one rectangle');
});

test('D47: 1–3 chars default to 1:1, 4 and more to 3:4 (a constant, not a magic number)', () => {
  assert.equal(DEFAULT_RATIO_FEW, '1:1');
  assert.equal(DEFAULT_RATIO_MANY, '3:4');
  assert.deepEqual([1, 2, 3, 4, 5, 20, 80].map(defaultRatio), ['1:1', '1:1', '1:1', '3:4', '3:4', '3:4', '3:4']);
});

test('result-page work cells (§5.2, D49: no board, cw = b): 402 → 181 / 181 / 120 / 144 / 120, plus the SE 375 and Pro Max 440 columns; same cols × rows as the 3:4 image', () => {
  const widths = { 402: [181, 181, 120, 144, 120], 375: [167, 167, 111, 134, 111], 440: [200, 200, 133, 160, 133] };
  for (const [w, expected] of Object.entries(widths)) {
    assert.deepEqual([1, 2, 3, 4, 5].map(n => resultGrid(n, Number(w)).c), expected, `screen ${w}`);
  }
  for (let n = 1; n <= 12; n += 1) {
    const g = resultGrid(n, 402);
    const l = layout(n, '3:4');
    assert.deepEqual([g.cols, g.rows], [l.cols, l.rows], `n=${n} same shape as the share image`);
  }
  assert.deepEqual(resultGrid(0, 402), { cols: 0, rows: 0, c: 0 });
});

test('ink width compensation table (§1.1) and the red dot (components.wrongDot)', () => {
  // R2-R1 / V2-03：只有一条规则——原宽，小格只抬到最小物理线宽 1.2pt（旧补偿表 ×1.15 / 1.35 / 1.5 已废）
  assert.deepEqual([160, 150, 100, 70, 50, 47.5].map(inkWidthScale), [1, 1, 1, 1, 1, 1]);
  assert.ok(Math.abs(inkWidthScale(40) - 47.37 / 40) < 0.01 && inkWidthScale(40) > 1, '40pt cell: lifted so the stroke is 1.2pt');
  assert.ok(Math.abs(inkWidthScale(30) * 11.5 * 0.76 * 30 / 345 - 1.2) < 1e-6, 'the lifted stroke is exactly the minimum physical width');
  assert.equal(minInkScale(234), 1, 'the 234pt judge card: original width (no ×1.41)');
  assert.equal(minInkScale(0), 1);
  assert.equal(dotDiameterPt(40), 5, 'clamp low');
  assert.ok(Math.abs(dotDiameterPt(110) - 7.7) < 1e-9);
  assert.equal(dotDiameterPt(300), 8, 'clamp high');
  // 墨迹外框右上外 2pt：圆心在外框右上角再向外 2pt + 半径；不出格
  const bounds = { x: 60, y: 60, width: 200, height: 200 }; // 345 单位
  const d = dotLayout(110, 1, bounds);
  const k = (110 * 0.76) / 345;
  assert.ok(Math.abs(d.cx - (110 * 0.12 + 260 * k + 2 + d.d / 2)) < 1e-9);
  assert.ok(Math.abs(d.cy - (110 * 0.12 + 60 * k - 2 - d.d / 2)) < 1e-9);
  const edge = dotLayout(110, 1, { x: 0, y: 0, width: 345, height: 345 });
  assert.ok(edge.cx + edge.d / 2 <= 110 && edge.cy - edge.d / 2 >= 0, 'clamped inside the cell');
  const exported = dotLayout(400, 2.69, bounds);
  assert.ok(Math.abs(exported.d - 8 * 2.69) < 1e-9, 'export unit: 8pt × 2.69');
});

test('month page grid: 6 columns (Pro Max 7, AX 4), cell ⌊(W − 40) / cols⌋; day tags only on the first char of each day', () => {
  assert.deepEqual([402, 375, 440].map(w => monthColumns(w)), [6, 6, 7]);
  assert.equal(monthColumns(402, { ax: true }), 4);
  assert.deepEqual([[402, 6], [375, 6], [440, 7]].map(([w, c]) => monthCell(w, c)), [60, 55, 57]);
  assert.equal(dayTag('2026-08-05'), '5');
  assert.equal(dayTag('2026-08-15'), '15');
  assert.equal(dayTag(''), '');
  const tagged = withDayTags([{ day: '2026-08-05' }, { day: '2026-08-05' }, { day: '2026-08-06' }, { day: '2026-08-06' }, { day: '2026-08-05' }]);
  assert.deepEqual(tagged.map(c => c.tag), ['5', '', '6', '', '5']);
});

// ---------------------------------------------------------------- 分张（D39 / §6.7）

const cellsOn = (day, n, from = 0) => Array.from({ length: n }, (_, i) => ({ ch: String.fromCodePoint(0x4e00 + from + i), day }));

test('paginate: ≤ 80 chars is one page; whole days go to the next page instead of being split; each page ≤ 80', () => {
  assert.deepEqual(paginate([]), []);
  assert.equal(paginate(cellsOn('2026-09-01', 80)).length, 1);
  const cells = [...cellsOn('2026-09-01', 50), ...cellsOn('2026-09-02', 40, 50), ...cellsOn('2026-09-03', 6, 90)];
  const pages = paginate(cells);
  assert.deepEqual(pages.map(p => p.length), [50, 46], 'day 2 (40) does not fit page 1 (50 + 40 > 80) → page 2; day 3 joins it');
  assert.deepEqual(pages.flat().map(c => c.ch), cells.map(c => c.ch), 'order kept, nothing dropped or duplicated');
  assert.ok(pages.every(p => p.length <= 80));
  // 同一天的字不拆到两张
  for (const p of pages) assert.equal(new Set(p.map(c => c.day)).size, p.length === 50 ? 1 : 2);
});

test('paginate: a single day over 80 chars is cut inside the day at 80; the remainder page can take later days', () => {
  const cells = [...cellsOn('2026-09-01', 10), ...cellsOn('2026-09-02', 170, 10), ...cellsOn('2026-09-03', 5, 180)];
  const pages = paginate(cells);
  assert.deepEqual(pages.map(p => p.length), [10, 80, 80, 15], 'the small first page is closed, day 2 cut 80 + 80 + 10, day 3 joins the remainder');
  assert.equal(pages.flat().length, 185);
  assert.equal(paginate(cellsOn('2026-09-01', 96)).length, 2, 'the design example: 96 chars of one day → 80 + 16');
  assert.deepEqual(paginate(cellsOn('2026-09-01', 160)).map(p => p.length), [80, 80]);
  // 没有 day 的格子当作同一天；上限可传
  assert.deepEqual(paginate(Array.from({ length: 7 }, (_, i) => ({ ch: String(i) })), 3).map(p => p.length), [3, 3, 1]);
});

test('paginate: every page re-runs the layout with its own count (the last page is not a big grid with one corner filled); a new page starts with a day tag', () => {
  const pages = paginate(cellsOn('2026-09-01', 96));
  const layouts = pages.map(p => layout(p, '3:4'));
  assert.deepEqual(layouts.map(l => [l.cols, l.rows]), [[8, 10], [4, 4]], '80 chars → 8 × 10; 16 chars → 4 × 4, bigger cells');
  assert.ok(layouts[1].c > layouts[0].c);
  const retagged = retagPages([[{ day: '2026-09-02', tag: '' }, { day: '2026-09-02', tag: '' }]], dayTag);
  assert.deepEqual(retagged[0].map(c => c.tag), ['2', ''], 'a new page starts with a tag on its first char');
});

// ---------------------------------------------------------------- 作品成员（§4.2）

const recOf = (serial, char, kind, judgment, extra = {}) => rec(serial, char, kind, judgment, '2026-10-05', { sessionId: 's9', ...extra });

function group(steps, { ink = [], added = [], paper = [] } = {}) {
  const chars = '疆酱痒酝嚷醋';
  const items = [];
  const records = new Map();
  steps.forEach((step, i) => {
    const kind = step === 'skip' ? 'skipped' : step === 'seen' ? 'answer-seen' : 'judged';
    const r = recOf(i + 1, chars[i], kind, kind === 'judged' ? step : null);
    if (paper.includes(i)) r.source = 'paper';
    records.set(r.id, r);
    items.push({ cardKey: r.cardKey, recordId: r.id, kind });
  });
  const hasInk = r => ink.includes(Number(r.id.slice(1)) - 1);
  return buildWork({ items, records, hasInk, added: new Set(added) });
}

test('work members: default = right ∪ (saw answer ∧ wrote after, with ink); wrong with ink can be added; no ink can never be added', () => {
  // 疆 写对有墨 / 酱 写对有墨 / 痒 写错有墨 / 酝 看后写（有墨）/ 嚷 跳过 / 醋 看过答案没写
  const w = group(['correct', 'correct', 'wrong', 'seen', 'skip', 'seen'], { ink: [0, 1, 2, 3] });
  assert.deepEqual(w.cells.map(c => c.char), ['疆', '酱', '酝'], 'in group order');
  assert.deepEqual(w.entries.map(e => e.state), ['in', 'in', 'addable', 'in', 'skipped', 'seen']);
  assert.deepEqual(w.cells.map(c => c.tag), ['', '', 'afterSeen'], 'only the after-answer writing is tagged 看后写的');
  assert.deepEqual(w.rows.map(r => r.char), ['痒', '嚷', '醋']);
  assert.deepEqual(w.addable.map(r => r.char), ['痒'], 'only a wrong char with ink can be added');
  assert.equal(w.empty, false);
  // 放进去之后：作品里按组内原位置，带朱点；行仍在（可以拿出来）
  const added = group(['correct', 'correct', 'wrong', 'seen', 'skip', 'seen'], { ink: [0, 1, 2, 3], added: ['r3'] });
  assert.deepEqual(added.cells.map(c => [c.char, c.dot]), [['疆', false], ['酱', false], ['痒', true], ['酝', false]], 'back in its original position, red dot kept (D46 ⑥)');
  assert.equal(added.rows.find(r => r.char === '痒').state, 'added');
  // 无墨：写对 / 写错都不收，也不能加入（added 里有它也不收）
  const noInk = group(['correct', 'wrong'], { ink: [], added: ['r2'] });
  assert.deepEqual(noInk.entries.map(e => e.state), ['noInk', 'noInk']);
  assert.equal(noInk.empty, true, 'nothing with ink → the plain-row variant, share hidden');
  assert.deepEqual(noInk.addable, []);
});

test('work members: 纸上记录 (D46-13) — judged but never in the work, not addable; the interface is isPaperRecord(record.source)', () => {
  assert.equal(isPaperRecord({ source: 'paper' }), true);
  assert.equal(isPaperRecord({ source: 'screen' }), false);
  assert.equal(isPaperRecord({}), false);
  assert.equal(isPaperRecord(null), false);
  const w = group(['correct', 'wrong', 'correct'], { ink: [0, 1, 2], paper: [1, 2], added: ['r2'] });
  assert.deepEqual(w.entries.map(e => e.state), ['in', 'paper', 'paper']);
  assert.deepEqual(w.cells.map(c => c.char), ['疆']);
  assert.deepEqual(w.addable, [], 'no 「放进去」 for a paper record');
});

test('「放进去」 state helpers: addedOf / toggleAdded are pure, keep first-added order, and ignore garbage', () => {
  assert.deepEqual([...addedOf(null)], []);
  assert.deepEqual([...addedOf({ added: ['r2', 7, 'r5'] })], ['r2', 'r5']);
  const s = { added: ['r2'] };
  assert.deepEqual(toggleAdded(s, 'r5'), ['r2', 'r5']);
  assert.deepEqual(toggleAdded(s, 'r2'), []);
  assert.deepEqual(toggleAdded(s, 'r2', true), ['r2'], 'idempotent');
  assert.deepEqual(toggleAdded(s, 'r9', false), ['r2'], 'removing something not there is a no-op');
  assert.deepEqual(s, { added: ['r2'] }, 'the input is not touched');
  assert.deepEqual(toggleAdded(null, 'r1'), ['r1']);
});

// ---------------------------------------------------------------- 选字口径

function stateOf(records, sessions = { A: null, B: null, lastEnded: {} }) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions, ink: {} };
}

const INK = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];

test('session image: the plan carries the work members in group order; the added wrong char is back in place with its dot; others are missing', () => {
  const recs = [
    recOf(1, '疆', 'judged', 'correct'),
    recOf(2, '痒', 'judged', 'wrong'),
    recOf(3, '酝', 'answer-seen', null),
    recOf(4, '嚷', 'skipped', null),
    recOf(5, '水', 'judged', 'correct', { sessionId: 's6' }),
  ];
  const items = [1, 2, 3, 4].map(n => ({ cardKey: recs[n - 1].cardKey, recordId: 'r' + n, kind: recs[n - 1].kind }));
  const session = { id: 's9', slot: 'A', kind: 'daily', items, endedAt: at('2026-10-05', 21), startedDay: '2026-10-05' };
  const mk = added => stateOf(recs, { A: null, B: null, lastEnded: { A: { ...session, added } } });
  const inkOf = r => (['r1', 'r2', 'r3'].includes(r.id) ? INK : null);
  const plain = imagePlan(mk(undefined), { kind: 'session', slot: 'A', sessionId: 's9' }, { inkOf });
  assert.equal(plain.status, 'ready');
  assert.deepEqual(plain.cells.map(c => [c.ch, c.dot, c.mode]), [['疆', false, 'hand'], ['酝', false, 'hand']], '看后写的 酝 is in, wrong 痒 is not yet');
  assert.deepEqual(plain.missing, ['嚷']);
  assert.equal(plain.day, '2026-10-05');
  assert.deepEqual(plain.work.addable.map(e => e.char), ['痒']);
  const withAdded = imagePlan(mk(['r2']), { kind: 'session', slot: 'A', sessionId: 's9' }, { inkOf });
  assert.deepEqual(withAdded.cells.map(c => [c.ch, c.dot]), [['疆', false], ['痒', true], ['酝', false]]);
  assert.deepEqual(withAdded.recordIds, ['r1', 'r2', 'r3']);
  assert.equal(withAdded.pages.length, 1);
  assert.equal(imagePlan(mk(undefined), { kind: 'session', sessionId: 's9' }, { inkOf: () => null }).status, 'empty');
  const found = sessionWork(mk(undefined), { slot: 'A', sessionId: 's9', hasInk: () => true });
  assert.equal(found.day, '2026-10-05');
});

test('month cells (§7): first-appearance order, ink = FIRST judgment in the month with ink (D42); a char with no ink all month stays as an under cell; tags only on the first char of each day', () => {
  const recs = [
    rec(1, '永', 'judged', 'wrong', '2026-08-30'),
    rec(2, '永', 'judged', 'correct', '2026-09-02'),
    rec(3, '和', 'judged', 'correct', '2026-09-02'),
    rec(4, '静', 'answer-seen', null, '2026-09-03'),
    rec(5, '静', 'judged', 'correct', '2026-09-05'),
    rec(6, '永', 'judged', 'correct', '2026-09-05'),
    rec(7, '山', 'judged', 'correct', '2026-09-07'),
  ];
  const st = stateOf(recs);
  // 静 r4 是「看了答案没写」：没有看后自写的墨。Q1 起看过答案的记录有墨就是看后自写、进月字帖，所以这里的取墨函数对它返回 null。
  const unwritten = fn => r => (r.kind === 'answer-seen' ? null : fn(r));
  assert.equal(policy.monthSheetPick, 'first');
  const m = monthMembers(st, '2026-09');
  assert.deepEqual(m.members.map(x => [x.char, x.record.id]), [['永', 'r2'], ['和', 'r3'], ['静', 'r5'], ['山', 'r7']]);
  assert.equal(m.days, 3, 'judged days only (answer-seen day 9-03 not counted, K27)');
  const all = monthCells(st, '2026-09', { inkOf: unwritten(() => INK) });
  assert.deepEqual(all.cells.map(c => [c.ch, c.mode, c.tag]), [['永', 'hand', '2'], ['和', 'hand', ''], ['静', 'hand', '5'], ['山', 'hand', '7']]);
  assert.equal(all.inked, 4);
  // D42：第一次那条缺墨 → 本月内从早到晚找下一条有墨的（永 r6，9-5）；角标与排序用同一个日子（firstDay = 永第一次作为成员出现的 9-02），不跟着取墨那条走
  const gap = monthCells(st, '2026-09', { inkOf: unwritten(r => (r.id === 'r2' ? null : INK)) });
  assert.deepEqual(gap.cells.map(c => [c.ch, c.record.id, c.day, c.tag]), [['永', 'r6', '2026-09-02', '2'], ['和', 'r3', '2026-09-02', ''], ['静', 'r5', '2026-09-05', '5'], ['山', 'r7', '2026-09-07', '7']]);
  const dayNumbers = gap.cells.map(c => c.tag).filter(Boolean).map(Number);
  assert.deepEqual(dayNumbers, [...dayNumbers].sort((a, b) => a - b), 'the margin numbers only ever go up (T2-05 / N2-07)');
  // 本月内一份都没有（8-30 那条不算：时间段外不冒充）→ 画 under 衬底，仍占一格、仍计字数；它的日期是偏好方向上的那条
  const none = monthCells(st, '2026-09', { inkOf: unwritten(r => (r.id === 'r2' || r.id === 'r6' ? null : INK)) });
  assert.deepEqual(none.cells.map(c => [c.ch, c.mode, c.tag]), [['永', 'under', '2'], ['和', 'hand', ''], ['静', 'hand', '5'], ['山', 'hand', '7']]);
  assert.equal(none.cells.length, 4, 'the char with no ink all month still counts');
  assert.equal(none.inked, 3);
  assert.equal(none.cells[0].ink, null);
  // 'last' 偏好：从晚到早找
  const lastGap = monthCells(st, '2026-09', { inkOf: unwritten(r => (r.id === 'r6' ? null : INK)), policy: { ...policy, monthSheetPick: 'last' } });
  assert.deepEqual(lastGap.cells.map(c => [c.ch, c.record.id]), [['永', 'r2'], ['和', 'r3'], ['静', 'r5'], ['山', 'r7']]);
  const last = monthMembers(st, '2026-09', { pick: 'last' });
  assert.deepEqual(last.members.map(x => x.record.id), ['r6', 'r3', 'r5', 'r7']);
});

test('month cells: 纸上 records are not in the month page and are not counted (D46-13: the judgment interface is isPaperRecord)', () => {
  const paper = { ...rec(2, '和', 'judged', 'correct', '2026-09-02'), source: 'paper' };
  const st = stateOf([rec(1, '永', 'judged', 'correct', '2026-09-02'), paper, rec(3, '山', 'judged', 'correct', '2026-09-03')]);
  const r = monthCells(st, '2026-09', { inkOf: () => INK });
  assert.deepEqual(r.cells.map(c => c.ch), ['永', '山']);
  assert.equal(r.days, 2);
  assert.equal(dayMembers(st, '2026-09-02').members.length, 1, 'the day list skips it too');
});

test('month cells on a folded month: members from byDay, only kept records can carry ink; the rest are under cells', () => {
  const kept = rec(9, '和', 'judged', 'correct', '2025-01-10');
  const st = { records: { '2025-01': { folded: true, month: '2025-01', byDay: { '2025-01-03': ['永', '和'], '2025-01-10': ['和', '山'] },
    chars: ['永', '和', '山'], kept: [kept] } }, sessions: { A: null, B: null, lastEnded: {} } };
  const m = monthMembers(st, '2025-01');
  assert.deepEqual(m.members.map(x => [x.char, x.record ? x.record.id : null]), [['永', null], ['和', 'r9'], ['山', null]]);
  assert.equal(m.days, 2);
  const r = monthCells(st, '2025-01', { inkOf: () => INK });
  assert.deepEqual(r.cells.map(c => [c.ch, c.mode, c.tag]), [['永', 'under', '3'], ['和', 'hand', ''], ['山', 'under', '10']], '和 sits on its first day (01-03) even though the kept ink is from 01-10; 山 first appears on 01-10');
  assert.deepEqual(flattenRecords(st.records).map(x => x.id), ['r9']);
});

test('day image (R-P03): that day judged chars, each char = latest that day; no ink → missing, not drawn', () => {
  const recs = [
    rec(1, '永', 'judged', 'wrong', '2026-09-24'),
    rec(2, '和', 'judged', 'correct', '2026-09-23'),
    rec(3, '永', 'judged', 'correct', '2026-09-24'),
    rec(4, '山', 'judged', 'correct', '2026-09-24'),
  ];
  const m = dayMembers(stateOf(recs), '2026-09-24');
  assert.deepEqual(m.members.map(x => [x.char, x.record.id]), [['永', 'r3'], ['山', 'r4']]);
  assert.throws(() => dayMembers(stateOf(recs), '2026-9-1'), /INVALID_DAY/);
  const plan = imagePlan(stateOf(recs), { kind: 'day', day: '2026-09-24' }, { inkOf: r => (r.id === 'r4' ? null : INK) });
  assert.deepEqual(plan.cells.map(c => c.ch), ['永']);
  assert.deepEqual(plan.missing, ['山']);
});

// D42（解 P122）：时间段内找留有墨迹的那一次

const INK_ENTRY = { s: ['AAAAAAAA'] }; // 存下的墨迹（只看有没有笔画；不解码）

/** 「静」：8-05 首次、9-01、9-08、9-22（D27 只留首次与最近一次的墨迹：r1 与 r4 有墨，中间 r2 r3 已回收）。 */
function jingState(extra = {}) {
  const recs = [
    rec(1, '静', 'judged', 'correct', '2026-08-05'),
    rec(2, '静', 'judged', 'correct', '2026-09-01', { sessionId: 's2' }),
    rec(3, '静', 'judged', 'correct', '2026-09-08', { sessionId: 's3' }),
    rec(4, '静', 'judged', 'correct', '2026-09-22', { sessionId: 's4' }),
  ];
  return { ...stateOf(recs), ink: { '2026-08': { r1: INK_ENTRY }, '2026-09': { r4: INK_ENTRY } }, ...extra };
}
const hasStored = st => r => !!(st.ink[r.localDay.slice(0, 7)] || {})[r.id];

test('D42 month cells: September picks 9-22 (the month\'s ink-bearing one), August keeps its own — no ink borrowed across months', () => {
  const st = jingState();
  const sep = monthMembers(st, '2026-09', { hasInk: hasStored(st) });
  assert.deepEqual(sep.members.map(m => [m.char, m.record.id]), [['静', 'r4']], '9-01 recycled → 9-22 (not the August ink)');
  const aug = monthMembers(st, '2026-08', { hasInk: hasStored(st) });
  assert.deepEqual(aug.members.map(m => [m.char, m.record.id]), [['静', 'r1']]);
  const plan = imagePlan(st, { kind: 'month', month: '2026-09' }, { inkOf: r => (hasStored(st)(r) ? INK : null) });
  assert.deepEqual(plan.cells.map(c => [c.ch, c.record.id, c.tag]), [['静', 'r4', '1']], 'the tag is the sort day (first member day 9-01), not the day of the picked record (T2-05)');
  assert.equal(monthMembers(st, '2026-09').members[0].record.id, 'r2', 'without hasInk: the plain first of the month');
});

test('D42 month cells: nothing with ink inside the month → an under cell (preferred record kept for the day); ink outside the month does not stand in', () => {
  const st = jingState({ ink: { '2026-08': { r1: INK_ENTRY } } });
  const plan = imagePlan(st, { kind: 'month', month: '2026-09' }, { inkOf: r => (hasStored(st)(r) ? INK : null) });
  assert.equal(plan.status, 'ready', 'the char is still on the page (as an under cell), D42 / §7');
  assert.deepEqual(plan.cells.map(c => [c.ch, c.mode, c.day]), [['静', 'under', '2026-09-01']]);
  assert.deepEqual(plan.drawn, [], 'drawn = cells with ink');
});

test('D42 month cells: preference direction — first scans early→late, last scans late→early', () => {
  const st = jingState({ ink: { '2026-09': { r2: INK_ENTRY, r3: INK_ENTRY } } });
  const has = hasStored(st);
  assert.equal(monthMembers(st, '2026-09', { pick: 'first', hasInk: has }).members[0].record.id, 'r2');
  assert.equal(monthMembers(st, '2026-09', { pick: 'last', hasInk: has }).members[0].record.id, 'r3', 'last: r4 has none → r3, not r2');
});

test('D42 month cells on a folded month: only kept records are candidates; the one with ink wins', () => {
  const k1 = rec(8, '和', 'judged', 'correct', '2025-01-03');
  const k2 = rec(9, '和', 'judged', 'correct', '2025-01-10');
  const st = { records: { '2025-01': { folded: true, month: '2025-01', byDay: { '2025-01-03': ['和'], '2025-01-10': ['和', '山'] },
    chars: ['和', '山'], kept: [k1, k2] } }, sessions: { A: null, B: null, lastEnded: {} }, ink: { '2025-01': { r9: INK_ENTRY } } };
  const m = monthMembers(st, '2025-01', { hasInk: hasStored(st) });
  assert.deepEqual(m.members.map(x => [x.char, x.record ? x.record.id : null]), [['和', 'r9'], ['山', null]]);
});

test('D42 day image: each char = the latest record of THAT day that has ink (older same-day one), none that day → missing', () => {
  const recs = [
    rec(1, '静', 'judged', 'correct', '2026-09-24'),
    rec(2, '静', 'judged', 'wrong', '2026-09-24'),
    rec(3, '山', 'judged', 'correct', '2026-09-24'),
    rec(4, '山', 'judged', 'correct', '2026-09-25'),
  ];
  const st = { ...stateOf(recs), ink: { '2026-09': { r1: INK_ENTRY, r4: INK_ENTRY } } };
  const has = hasStored(st);
  const d = dayMembers(st, '2026-09-24', { hasInk: has });
  assert.deepEqual(d.members.map(x => [x.char, x.record.id]), [['静', 'r1'], ['山', 'r3']], '静: r2 has none → r1; 山: only the 9-25 ink exists → not borrowed');
  const plan = imagePlan(st, { kind: 'day', day: '2026-09-24' }, { inkOf: r => (has(r) ? INK : null) });
  assert.deepEqual(plan.cells.map(c => c.ch), ['静']);
  assert.deepEqual(plan.missing, ['山']);
});

test('glyph image (A05): latest judged of the char; that record without ink → noInk (no fallback to an older one, I03)', () => {
  const recs = [rec(1, '静', 'judged', 'correct', '2026-09-20'), rec(2, '静', 'judged', 'wrong', '2026-09-22'), rec(3, '静', 'answer-seen', null, '2026-09-23')];
  const st = stateOf(recs);
  assert.equal(glyphMember(st, '静').record.id, 'r2');
  const ok = imagePlan(st, { kind: 'glyph', char: '静' }, { inkOf: () => INK });
  assert.equal(ok.status, 'ready');
  assert.equal(ok.day, '2026-09-22');
  const miss = imagePlan(st, { kind: 'glyph', char: '静' }, { inkOf: r => (r.id === 'r1' ? INK : null) });
  assert.equal(miss.status, 'noInk');
  assert.equal(imagePlan(st, { kind: 'glyph', char: '和' }, { inkOf: () => INK }).status, 'noInk');
});

test('> 80 chars is not pending any more (D39 / D12): the plan returns pages, each ≤ 80, in date order, nothing truncated', () => {
  const recs = [];
  for (let i = 0; i < 96; i += 1) recs.push(rec(i + 1, String.fromCodePoint(0x4e00 + i), 'judged', 'correct', '2026-09-10'));
  for (let i = 96; i < 100; i += 1) recs.push(rec(i + 1, String.fromCodePoint(0x4e00 + i), 'judged', 'correct', '2026-09-12'));
  const plan = imagePlan(stateOf(recs), { kind: 'month', month: '2026-09' }, { inkOf: () => INK });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.n, 100);
  assert.deepEqual(plan.pages.map(p => p.length), [80, 20]);
  assert.equal(plan.pages.flat().length, 100);
  assert.equal(plan.pages[1][0].tag, '10', 'the new page starts with a tag on its first char (same day continued)');
  assert.equal(plan.pages[1][16].tag, '12');
  assert.equal(imagePlan(stateOf(recs.slice(0, 80)), { kind: 'month', month: '2026-09' }, { inkOf: () => INK }).pages.length, 1);
});

test('cellOfMember: ink → hand, none → under only when asked; day follows the record (or the first day for a folded month)', () => {
  const r = rec(1, '永', 'judged', 'correct', '2026-09-02');
  assert.equal(cellOfMember({ char: '永', record: r }, () => null), null);
  assert.deepEqual(cellOfMember({ char: '永', record: r }, () => null, { under: true }), { ch: '永', ink: null, mode: 'under', dot: false, tag: '', day: '2026-09-02', record: r });
  assert.equal(cellOfMember({ char: '永', record: r }, () => INK).mode, 'hand');
  assert.equal(cellOfMember({ char: '山', record: null, firstDay: '2025-01-03' }, () => null, { under: true }).day, '2025-01-03');
});

// ---------------------------------------------------------------- 单字手写图（A05，沿用）

test('glyph layout (A05): ink box ≈ 60% of the width (or limited by height), centered, caption under it, seal bottom-right', () => {
  const pts = [[{ x: 100, y: 60, w: 12 }, { x: 250, y: 60, w: 12 }], [{ x: 172, y: 40, w: 12 }, { x: 172, y: 300, w: 12 }]];
  const b = inkBounds(pts);
  assert.deepEqual(b, { x: 94, y: 34, width: 162, height: 272 });
  for (const ratio of ['portrait', 'square']) {
    const g = glyphLayout(b, ratio);
    assert.equal(g.status, 'ready');
    const { width, height } = SIZES[ratio];
    assert.ok(g.glyph.width <= width * 0.6 + 1e-6, `${ratio} width ≤ 60%`);
    assert.ok(Math.abs(g.glyph.x + g.glyph.width / 2 - width / 2) < 1e-6, `${ratio} centered`);
    assert.ok(g.glyph.y >= MARGIN - 1e-6 && g.info.top + g.info.line <= height - MARGIN - 78 - 48 + 1e-6, `${ratio} fits above the seal row`);
    assert.equal(g.seal.x, width - 72 - 78);
    assert.equal(g.seal.y, height - 72 - 78);
    assert.equal(g.info.font, 33);
  }
  const wide = glyphLayout({ x: 0, y: 150, width: 345, height: 40 }, 'portrait');
  assert.ok(Math.abs(wide.glyph.width - 1080 * 0.6) < 1e-6, 'wide ink → exactly 60% of the width');
  assert.equal(glyphLayout(null).status, 'noInk');
  assert.equal(inkBounds([]), null);
});

// ---------------------------------------------------------------- 渲染（假 canvas）

function fakeCanvas(width, height) {
  const calls = [];
  const state = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, canvas: null };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return text => ({ width: [...text].length * 26 });
      return (...args) => calls.push([prop, ...args, target.fillStyle, target.strokeStyle]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const canvas = { width, height, dataset: {}, getContext: () => ctx, calls };
  ctx.canvas = canvas;
  return canvas;
}

const cell = (ch, extra = {}) => ({ ch, ink: INK, mode: 'hand', ...extra });

test('renderWorkPage: 1440×1920 / 1440×1440 (logical 1080 × 4/3), only the given cells, dataset carries members / modes / dots / record ids / 落款', async () => {
  const cells = [cell('永', { tag: '2', record: { id: 'r2' } }), cell('和', { record: { id: 'r3' }, dot: true }), { ch: '山', ink: null, mode: 'under', record: { id: 'r4' } }];
  let painted = 0;
  const glyphsAsked = [];
  for (const [ratio, h] of [['3:4', 1920], ['1:1', 1440]]) {
    const out = await renderWorkPage({
      cells, ratio, kuan: '二〇二六年九月　三字', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas,
      paintStroke: () => { painted += 1; return true; }, loadGlyph: async ch => { glyphsAsked.push(ch); return null; }, meta: { kind: 'month' },
    });
    assert.equal(out.status, 'ready');
    assert.equal(out.canvas.width, 1440);
    assert.equal(out.canvas.height, h);
    assert.equal(out.canvas.dataset.members, '永和山');
    assert.equal(out.canvas.dataset.modes, 'hhu');
    assert.equal(out.canvas.dataset.dots, '010');
    assert.equal(out.canvas.dataset.recordIds, 'r2,r3,r4');
    assert.equal(out.canvas.dataset.tags, '2||');
    assert.equal(out.canvas.dataset.signature, '二〇二六年九月　三字');
    assert.equal(out.canvas.dataset.kind, 'month');
    assert.equal(out.canvas.dataset.n, '3');
    assert.equal(out.cells.length, 3);
    assert.equal(out.cells[2].strokes, 0, 'an under cell paints no ink');
  }
  assert.equal(painted, 4, 'one stroke per inked cell per render');
  assert.deepEqual(glyphsAsked, ['山', '山'], 'reference outlines are loaded only for under cells');
  const empty = await renderWorkPage({ cells: [], kuan: 'x', sealText: '字', palette: PALETTE, canvasFactory: () => { throw new Error('no canvas for nothing'); } });
  assert.equal(empty.status, 'empty');
  await assert.rejects(() => renderWorkPage({ cells, kuan: 'a\nb', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas }), /SINGLE_LINE/);
});

test('renderWorkPage: the day tag is drawn inside its own cell, top-left, without a colour block — it never rides a grid line (V2-09)', async () => {
  const cells = [cell('永', { tag: '2' }), cell('和'), cell('山', { tag: '5' })];
  const out = await renderWorkPage({ cells, ratio: '3:4', kuan: '二〇二六年九月　三字', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas });
  const L = out.layout;
  const tagCalls = out.canvas.calls.filter(c => c[0] === 'fillText' && (c[1] === '2' || c[1] === '5'));
  assert.equal(tagCalls.length, 2);
  for (const [call, i] of [[tagCalls[0], 0], [tagCalls[1], 2]]) {
    const box = L.cells[i];
    assert.ok(call[2] >= box.x && call[2] < box.x + L.c / 2, 'x inside the cell, near its left edge');
    assert.ok(call[3] - TAG_SIZE / 2 >= box.y && call[3] < box.y + L.c / 2, 'the whole line box is inside the cell (below its top line)');
  }
  const blocks = out.canvas.calls.filter(c => c[0] === 'fillRect' && c[4] === TAG_SIZE);
  assert.deepEqual(blocks, [], 'no sheet-coloured block behind the number (that block is what cut the grid lines)');
});

test('renderWorkPage: colours come from the LIGHT design tokens (never the dark ones); ink keeps its own width, only tiny cells are lifted to the minimum physical width (R2-R1)', async () => {
  const out = await renderWorkPage({ cells: [cell('永', { dot: true })], ratio: '3:4', kuan: '二〇二六年九月', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas });
  const fills = new Set(out.canvas.calls.map(c => c[c.length - 2]));
  const strokes = new Set(out.canvas.calls.map(c => c[c.length - 1]));
  assert.ok(fills.has(TOKENS.color.light.sheet), 'paper = light sheet');
  assert.ok(fills.has(TOKENS.color.light.seal), 'seal = light seal');
  assert.ok(fills.has(TOKENS.color.light.zhu), 'dot = light zhu');
  assert.ok(strokes.has(TOKENS.color.light.frame) && strokes.has(TOKENS.color.light.guide) || strokes.has(TOKENS.color.light.frame), 'frame colour from tokens');
  for (const dark of Object.values(TOKENS.color.dark)) {
    if (typeof dark === 'string') assert.ok(!fills.has(dark) || Object.values(TOKENS.color.light).includes(dark), 'no dark-only colour used');
  }
  // 一个 670px 的格 ≈ 249pt：笔锋收到的点宽就是 11.5（原宽）
  const widths = [];
  await renderWorkPage({
    cells: [cell('永')], ratio: '3:4', kuan: 'k', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas,
    paintStroke: (ctx, pts) => { widths.push(pts[0].w); return true; },
  });
  assert.ok(Math.abs(widths[0] - 11.5 * inkWidthScale(670 / 2.69)) < 1e-9, 'single char: cell 670px ≈ 249pt → ×1.0');
  const w3 = [];
  await renderWorkPage({
    cells: [cell('永'), cell('和'), cell('静')], ratio: '3:4', kuan: 'k', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas,
    paintStroke: (ctx, pts) => { w3.push(pts[0].w); return true; },
  });
  assert.ok(Math.abs(w3[0] - 11.5) < 1e-9, '3 chars: cell 295px ≈ 110pt → original width (the old ×1.15 step is gone)');
  const many = Array.from({ length: 80 }, (_, i) => cell(String.fromCodePoint(0x4e00 + i)));
  const w80 = [];
  const big = await renderWorkPage({
    cells: many, ratio: '3:4', kuan: 'k', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas,
    paintStroke: (ctx, pts) => { w80.push(pts[0].w); return true; },
  });
  const tiny = big.layout.c / 2.69;
  assert.ok(tiny < 47, `80 cells are tiny (${tiny.toFixed(1)}pt)`);
  assert.ok(w80[0] > 11.5 && Math.abs(w80[0] - 11.5 * inkWidthScale(tiny)) < 1e-9, 'tiny cells: lifted to the minimum physical width only');
});

test('renderWorkPage awaits the injected requireFont (落款 song, seal kai, tags hei 500) before creating the canvas', async () => {
  const order = [];
  const canvasFactory = (w, h) => { order.push('canvas'); return fakeCanvas(w, h); };
  await renderWorkPage({
    cells: [cell('永', { tag: '2' })], ratio: '3:4', kuan: '二〇二六年九月　一字', sealText: '字', palette: PALETTE, canvasFactory,
    requireFont: async (stack, text, o) => { order.push(`font:${stack.split(',')[0].replace(/"/g, '')}:${text}${o && o.weight ? `:${o.weight}` : ''}`); },
  });
  assert.deepEqual(order, ['font:ShiziSerifSC:二〇二六年九月　一字', 'font:ShiziKai:字', 'font:-apple-system:2:500', 'canvas']);
});

test('palette: paletteFromTokens reads color.light only and has no colour literal of its own', () => {
  assert.equal(PALETTE.sheet, TOKENS.color.light.sheet);
  assert.equal(PALETTE.hand, TOKENS.color.light.hand);
  assert.equal(PALETTE.onSeal, TOKENS.color.light.onSeal);
  assert.throws(() => paletteFromTokens({}), /PALETTE_UNAVAILABLE/);
  for (const file of ['palette.js', 'render.js', 'layout.js', 'annual-render.js', 'paginate.js', 'work.js']) {
    const src = fs.readFileSync(new URL(`../../src/core/images/${file}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d/.test(src), `${file} has no colour literals (P1-E1a leftovers are gone)`);
  }
});

test('renderSingleGlyph: A05 sizes, caption and brand; no ink → noInk without a canvas', async () => {
  for (const [ratio, h] of [['portrait', 1440], ['square', 1080]]) {
    const out = await renderSingleGlyph({ points: INK, caption: 'jìng · 9月22日', signatureText: '拾字', sealText: '字', ratio, palette: PALETTE,
      canvasFactory: fakeCanvas, meta: { kind: 'glyph', recordIds: 'r2' } });
    assert.equal(out.status, 'ready');
    assert.equal(out.canvas.height, h);
    assert.equal(out.canvas.dataset.caption, 'jìng · 9月22日');
    assert.equal(out.canvas.dataset.signature, '拾字');
    assert.equal(out.canvas.dataset.recordIds, 'r2');
    assert.ok(Number(out.canvas.dataset.glyphWidth) <= 648);
    assert.ok(out.canvas.calls.some(c => c[0] === 'fillText' && c[1] === 'jìng · 9月22日'), 'caption drawn');
  }
  const none = await renderSingleGlyph({ points: [], caption: '', signatureText: '拾字', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas });
  assert.equal(none.status, 'noInk');
  assert.equal(none.canvas, null);
});

// ---------------------------------------------------------------- 年报长图（§8.2）

test('annual long image: width 1440, height by content, not capped at 80 chars; a total over the limit is cut by month (rows if one month alone is too tall), no char dropped', async () => {
  const month = (name, n) => ({ name, count: `${n} 字`, cells: Array.from({ length: n }, (_, i) => cell(String.fromCodePoint(0x4e00 + i))) });
  const base = {
    yearText: '二〇二六', line: '这一年，你写过二百零二个字。', first: cell('春'), firstLabel: '今年第一个字', firstDate: '四月二十六日的笔迹',
    kuan: '拾字　年报', sealText: '字', palette: PALETTE, canvasFactory: fakeCanvas,
  };
  const small = await renderAnnualLong({ ...base, months: [month('4月', 12), month('5月', 90)], tail: null });
  assert.equal(small.canvases.length, 1);
  assert.equal(small.canvases[0].width, 1440);
  assert.ok(small.canvases[0].height > 1920, 'taller than a 3:4 page');
  assert.equal(small.canvases[0].dataset.n, '102', '90 chars in one month is allowed in the long image (no 80 cap)');
  const total = chunks => chunks.canvases.reduce((s, c) => s + Number(c.dataset.n), 0);
  assert.equal(total(small), 102);
  // 限高：切成几张，每张不超过上限，月名不落在一张的末尾，字一个不少
  const limit = 4000;
  const many = await renderAnnualLong({ ...base, months: [month('4月', 40), month('5月', 80), month('6月', 60)], tail: null, maxExportHeight: limit });
  assert.ok(many.canvases.length >= 2);
  assert.ok(many.heights.every(h => h <= limit), `every part ≤ ${limit}px: ${many.heights}`);
  assert.equal(total(many), 180, 'nothing truncated');
  // 单月自己就超高：按行切
  const huge = await renderAnnualLong({ ...base, months: [month('7月', 300)], tail: null, maxExportHeight: 3000 });
  assert.ok(huge.canvases.length >= 2 && huge.heights.every(h => h <= 3000));
  assert.equal(total(huge), 300);
});
