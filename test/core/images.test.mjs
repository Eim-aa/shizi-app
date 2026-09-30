// 图片：版式 / 选字口径 / 渲染（02 M4-5；01 §10；04 §3.2 图片规格、R-I01–R-I04、A05；03 P02 / P25 / P50；T06-C）。
//
// 布局 0..80 两比例快照：r1 夹具 = origin/pr-180 handoff/r8-foundation/fixtures/layout-r1.mjs 的公式（下面 r1Layout 逐字转写）。
//   1:1 与 r1 逐项相同（T06-C「1:1 不变」）；3:4 按 T06-C 改为从内区顶端排：top = 72、落款紧跟最后一行下方 40px，
//   其余几何（列数、格宽、角标、笔迹缩放）与 r1 相同——这就是「更新 r1 夹具」的全部差异；另有整表 sha256 快照锁住现值。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as policy from '../../src/config/policy.js';
import {
  sheetLayout, glyphLayout, inkBounds, dateTag, cellInkTransform, columnsFor, SIZES, MARGIN, FOOTER,
} from '../../src/core/images/layout.js';
import {
  imagePlan, sessionMembers, monthMembers, dayMembers, glyphMember, flattenRecords, withTags,
} from '../../src/core/images/pick.js';
import { renderSheet, renderSingleGlyph } from '../../src/core/images/render.js';
import { at, rec } from './helpers.mjs';

// ---------------------------------------------------------------- r1 夹具（pr-180 layout-r1.mjs 转写；n > 80 在 r1 里抛错）

function r1Layout(n, ratio) {
  const { width, height } = { portrait: { width: 1080, height: 1440 }, square: { width: 1080, height: 1080 } }[ratio];
  const margin = 72;
  const innerWidth = 936;
  const innerHeight = height - 144;
  if (n === 0) return { status: 'empty', n, width, height, margin, innerWidth, innerHeight, columns: 0, rows: 0, cells: [] };
  let columns = 5;
  while (columns <= 10 && Math.ceil(n / columns) * (innerWidth / columns) + 118 > innerHeight) columns += 1;
  const cell = innerWidth / columns;
  const rows = Math.ceil(n / columns);
  const gridHeight = rows * cell;
  const top = margin + (innerHeight - gridHeight - 118) / 2;
  const footerTop = top + gridHeight + 40;
  const small = cell < 126;
  const dateFont = small ? 24 : 33;
  const dateLine = small ? 27 : 39;
  const dateTop = small ? 6 : 9;
  const dateLeft = small ? 9 : 12;
  const half = 0.42;
  const scale = Math.min(0.78, (cell - dateTop - dateLine - 3) / (2 * half * cell));
  const dy = Math.max(0, dateTop + dateLine + 3 - cell * (0.5 - half * scale));
  const dx = Math.min(9, cell * 0.05);
  return {
    status: 'ready', n, width, height, margin, innerWidth, innerHeight, columns, rows, cell, gridHeight, top, footerTop,
    footerHeight: 78, dateFont, dateLine, dateTop, dateLeft, inkScale: scale, inkDx: dx, inkDy: dy,
    cells: Array.from({ length: rows * columns }, (_, i) => ({ x: margin + (i % columns) * cell, y: top + Math.floor(i / columns) * cell, empty: i >= n })),
  };
}

const R1_KEYS = ['status', 'n', 'width', 'height', 'margin', 'innerWidth', 'innerHeight', 'columns', 'rows', 'cell', 'gridHeight',
  'top', 'footerTop', 'footerHeight', 'dateFont', 'dateLine', 'dateTop', 'dateLeft', 'inkScale', 'inkDx', 'inkDy'];

function comparable(l) {
  const out = {};
  for (const k of R1_KEYS) if (k in l) out[k] = l[k];
  out.cells = l.cells.map(c => ({ x: c.x, y: c.y, empty: c.empty }));
  return out;
}

test('layout 0..80 × 1:1 equals the r1 fixture exactly (T06-C: square unchanged)', () => {
  for (let n = 0; n <= 80; n += 1) {
    assert.deepEqual(comparable(sheetLayout(n, 'square')), r1Layout(n, 'square'), `square n=${n}`);
  }
});

test('layout 0..80 × 3:4 = r1 moved to the top of the inner area, footer 40px under the last row (T06-C)', () => {
  for (let n = 0; n <= 80; n += 1) {
    const got = comparable(sheetLayout(n, 'portrait'));
    const r1 = r1Layout(n, 'portrait');
    if (n === 0) {
      assert.deepEqual(got, r1, 'empty unchanged');
      continue;
    }
    const expected = {
      ...r1,
      top: MARGIN,
      footerTop: MARGIN + r1.gridHeight + 40,
      cells: r1.cells.map((c, i) => ({ ...c, y: MARGIN + Math.floor(i / r1.columns) * r1.cell })),
    };
    assert.deepEqual(got, expected, `portrait n=${n}`);
    assert.ok(got.footerTop + FOOTER - 40 <= SIZES.portrait.height - MARGIN + 1e-9, `portrait n=${n} footer inside the inner area`);
  }
});

test('layout snapshot: every n in 0..81 for both ratios (sha256 of the full table)', () => {
  const table = [];
  for (const ratio of ['portrait', 'square']) for (let n = 0; n <= 81; n += 1) table.push(sheetLayout(n, ratio));
  const digest = crypto.createHash('sha256').update(JSON.stringify(table)).digest('hex');
  // 版式改动须同步更新这个快照（并在报告里说明）。
  assert.equal(digest, LAYOUT_SNAPSHOT, 'layout table snapshot');
  // 抽查几处现值
  const p1 = sheetLayout(1, 'portrait');
  assert.equal(p1.columns, 5);
  assert.equal(p1.cell, 936 / 5);
  assert.equal(p1.top, 72);
  assert.equal(p1.footerTop, 72 + 936 / 5 + 40);
  assert.equal(p1.dateFont, 33);
  const p80 = sheetLayout(80, 'portrait');
  assert.equal(p80.columns, 8, '80 chars 3:4 → 8 columns');
  assert.equal(p80.rows, 10);
  assert.equal(p80.dateFont, 24, '936/8 = 117 < 126 → small date tag 24px (备注 L136)');
});

const LAYOUT_SNAPSHOT = 'a29f78b0437fc0dbc6a7ba99c2f3230f4f2b56f2d5d65de5cd664d3f7374326c';

test('layout: > policy.imageMaxChars is pending (P25, not truncated); 0 empty; bad input throws', () => {
  assert.equal(policy.imageMaxChars, 80);
  for (const ratio of ['portrait', 'square']) {
    const l = sheetLayout(81, ratio, { maxChars: policy.imageMaxChars });
    assert.equal(l.status, 'pending');
    assert.equal(l.n, 81);
    assert.deepEqual(l.cells, []);
    assert.equal(sheetLayout(0, ratio).status, 'empty');
  }
  assert.throws(() => sheetLayout(-1), /INVALID_COUNT/);
  assert.throws(() => sheetLayout(1.5), /INVALID_COUNT/);
  assert.throws(() => sheetLayout(3, 'wide'), /INVALID_RATIO/);
  // 列数公式（备注 L136）：最小 c 使 ceil(n/c)·936/c + 118 ≤ 内区高
  for (let n = 1; n <= 80; n += 1) {
    for (const [ratio, ih] of [['portrait', 1296], ['square', 936]]) {
      const c = columnsFor(n, ih);
      assert.ok(Math.ceil(n / c) * (936 / c) + 118 <= ih, `${ratio} n=${n} fits with ${c}`);
      if (c > 5) assert.ok(Math.ceil(n / (c - 1)) * (936 / (c - 1)) + 118 > ih, `${ratio} n=${n} ${c} is the smallest`);
    }
  }
});

test('cell ink transform: untagged fills the cell in 345 units; tagged shrinks ≤ .78 and clears the date tag', () => {
  const l = sheetLayout(30, 'portrait');
  const box = l.cells[0];
  const plain = cellInkTransform(l, box, false);
  assert.ok(Math.abs(plain.ox - box.x) < 1e-9 && Math.abs(plain.oy - box.y) < 1e-9);
  assert.ok(Math.abs(plain.k - l.cell / 345) < 1e-12);
  const tagged = cellInkTransform(l, box, true);
  assert.ok(tagged.k <= plain.k * 0.78 + 1e-12);
  // 字形上缘（格心 − .42 格 × 缩放）在角标底边以下
  const glyphTop = tagged.oy + (345 / 2 - 0.42 * 345) * tagged.k;
  assert.ok(glyphTop >= box.y + l.dateTop + l.dateLine + 3 - 1e-6, 'glyph top below the date tag');
  assert.equal(dateTag('2026-09-04'), '9·4');
  assert.equal(dateTag(''), '');
});

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

// ---------------------------------------------------------------- 选字口径

function stateOf(records, sessions = { A: null, B: null, lastEnded: {} }) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions, ink: {} };
}

const INK = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];

test('session image: members in session order, each char = its LAST judgment in this session (D11); answer-seen / skipped excluded', () => {
  const recs = [
    rec(1, '永', 'judged', 'wrong', '2026-09-24', { sessionId: 's5' }),
    rec(2, '和', 'answer-seen', null, '2026-09-24', { sessionId: 's5' }),
    rec(3, '静', 'judged', 'correct', '2026-09-24', { sessionId: 's5' }),
    rec(4, '永', 'judged', 'correct', '2026-09-24', { sessionId: 's5' }),
    rec(5, '山', 'skipped', null, '2026-09-24', { sessionId: 's5' }),
    rec(6, '水', 'judged', 'correct', '2026-09-24', { sessionId: 's6' }),
  ];
  const session = { id: 's5', slot: 'A', kind: 'daily', items: [{ cardKey: 'base:永', recordId: 'r1' }, { cardKey: 'base:和', recordId: 'r2' },
    { cardKey: 'base:静', recordId: 'r3' }, { cardKey: 'base:永', recordId: 'r4' }], endedAt: at('2026-09-24', 21), startedDay: '2026-09-24' };
  const st = stateOf(recs, { A: null, B: null, lastEnded: { A: session } });
  const m = sessionMembers(st, { slot: 'A', sessionId: 's5' });
  assert.deepEqual(m.members.map(x => [x.char, x.record.id]), [['永', 'r4'], ['静', 'r3']]);
  assert.equal(m.day, '2026-09-24');
  const plan = imagePlan(st, { kind: 'session', slot: 'A', sessionId: 's5' }, { inkOf: r => (r.id === 'r3' ? null : INK) });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.drawn.map(c => c.char), ['永'], 'missing ink omitted (P50 omit)');
  assert.deepEqual(plan.missing, ['静']);
  assert.equal(plan.n, 1, 'signature count follows the drawn chars (R-I04)');
  assert.deepEqual(plan.recordIds, ['r4']);
  assert.ok(plan.drawn.every(c => c.tag === ''), 'session image has no date tags');
  const none = imagePlan(st, { kind: 'session', sessionId: 's5' }, { inkOf: () => null });
  assert.equal(none.status, 'empty');
  assert.deepEqual(none.missing, ['永', '静']);
});

test('month sheet: first-appearance order, ink = FIRST judgment in the month (P02 first), day tags, K27 day count; last when policy says so', () => {
  const recs = [
    rec(1, '永', 'judged', 'wrong', '2026-08-30'),
    rec(2, '永', 'judged', 'correct', '2026-09-02'),
    rec(3, '和', 'judged', 'correct', '2026-09-02'),
    rec(4, '静', 'answer-seen', null, '2026-09-03'),
    rec(5, '静', 'judged', 'correct', '2026-09-05'),
    rec(6, '永', 'judged', 'wrong', '2026-09-05'),
    rec(7, '山', 'judged', 'correct', '2026-09-07'),
  ];
  const st = stateOf(recs);
  assert.equal(policy.monthSheetPick, 'first');
  const m = monthMembers(st, '2026-09');
  assert.deepEqual(m.members.map(x => [x.char, x.record.id]), [['永', 'r2'], ['和', 'r3'], ['静', 'r5'], ['山', 'r7']]);
  assert.equal(m.days, 3, 'judged days only (answer-seen day 9-03 not counted, K27)');
  const plan = imagePlan(st, { kind: 'month', month: '2026-09' }, { inkOf: () => INK });
  assert.deepEqual(plan.drawn.map(c => c.tag), ['9·2', '', '9·5', '9·7']);
  assert.equal(plan.days, 3);
  const last = monthMembers(st, '2026-09', { pick: 'last' });
  assert.deepEqual(last.members.map(x => x.record.id), ['r6', 'r3', 'r5', 'r7']);
  // 缺墨去掉后角标重算：那天的第一格仍带日期
  const gap = imagePlan(st, { kind: 'month', month: '2026-09' }, { inkOf: r => (r.id === 'r2' ? null : INK) });
  assert.deepEqual(gap.drawn.map(c => [c.char, c.tag]), [['和', '9·2'], ['静', '9·5'], ['山', '9·7']]);
  assert.deepEqual(gap.missing, ['永']);
  assert.equal(gap.n, 3);
});

test('month sheet on a folded month: members from byDay, only kept records can carry ink', () => {
  const kept = rec(9, '和', 'judged', 'correct', '2025-01-10');
  const st = { records: { '2025-01': { folded: true, month: '2025-01', byDay: { '2025-01-03': ['永', '和'], '2025-01-10': ['和', '山'] },
    chars: ['永', '和', '山'], kept: [kept] } }, sessions: { A: null, B: null, lastEnded: {} } };
  const m = monthMembers(st, '2025-01');
  assert.deepEqual(m.members.map(x => [x.char, x.record ? x.record.id : null]), [['永', null], ['和', 'r9'], ['山', null]]);
  assert.equal(m.days, 2);
  const plan = imagePlan(st, { kind: 'month', month: '2025-01' }, { inkOf: () => INK });
  assert.deepEqual(plan.drawn.map(c => c.char), ['和']);
  assert.deepEqual(plan.missing, ['永', '山']);
  assert.deepEqual(flattenRecords(st.records).map(r => r.id), ['r9']);
});

test('day image (R-P03): that day judged chars, each char = latest that day', () => {
  const recs = [
    rec(1, '永', 'judged', 'wrong', '2026-09-24'),
    rec(2, '和', 'judged', 'correct', '2026-09-23'),
    rec(3, '永', 'judged', 'correct', '2026-09-24'),
    rec(4, '山', 'judged', 'correct', '2026-09-24'),
  ];
  const m = dayMembers(stateOf(recs), '2026-09-24');
  assert.deepEqual(m.members.map(x => [x.char, x.record.id]), [['永', 'r3'], ['山', 'r4']]);
  assert.throws(() => dayMembers(stateOf(recs), '2026-9-1'), /INVALID_DAY/);
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

test('> 80 drawn chars: status pending, nothing truncated (P25 / D12)', () => {
  const recs = [];
  for (let i = 0; i < 81; i += 1) recs.push(rec(i + 1, String.fromCodePoint(0x4e00 + i), 'judged', 'correct', '2026-09-10'));
  const plan = imagePlan(stateOf(recs), { kind: 'month', month: '2026-09' }, { inkOf: () => INK });
  assert.equal(plan.status, 'pending');
  assert.equal(plan.n, 81);
  assert.equal(plan.drawn.length, 81);
  const eighty = imagePlan(stateOf(recs), { kind: 'month', month: '2026-09' }, { inkOf: r => (r.id === 'r81' ? null : INK) });
  assert.equal(eighty.status, 'ready', 'one missing → 80 drawn → ready');
  assert.equal(withTags([]).length, 0);
});

// ---------------------------------------------------------------- 渲染（假 canvas）

function fakeCanvas(width, height) {
  const calls = [];
  const ctx = new Proxy({ font: '', canvas: null }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return text => ({ width: [...text].length * 26 });
      return (...args) => calls.push([prop, ...args]);
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

test('renderSheet: 1080×1440 / 1080×1080, draws only the given items, dataset carries members / record ids / signature', async () => {
  const items = [
    { char: '永', points: INK, tag: '9·2', record: { id: 'r2' } },
    { char: '和', points: INK, tag: '', record: { id: 'r3' } },
  ];
  let painted = 0;
  for (const [ratio, h] of [['portrait', 1440], ['square', 1080]]) {
    const out = await renderSheet({ items, ratio, signature: '二〇二六年九月 · 有记录三天 · 两个字', sealText: '字', canvasFactory: fakeCanvas,
      paintStroke: () => { painted += 1; return true; }, meta: { kind: 'month' } });
    assert.equal(out.status, 'ready');
    assert.equal(out.canvas.width, 1080);
    assert.equal(out.canvas.height, h);
    assert.equal(out.canvas.dataset.members, '永和');
    assert.equal(out.canvas.dataset.recordIds, 'r2,r3');
    assert.equal(out.canvas.dataset.tags, '9·2|');
    assert.equal(out.canvas.dataset.kind, 'month');
    assert.equal(out.canvas.dataset.n, '2');
    assert.equal(out.cells.length, 2);
  }
  assert.equal(painted, 4, 'one stroke per item per render');
  const pending = await renderSheet({ items: Array.from({ length: 81 }, (_, i) => ({ char: 'x' + i, points: INK })), signature: 'x', sealText: '字',
    canvasFactory: () => { throw new Error('should not create a canvas'); } });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.canvas, null);
  await assert.rejects(() => renderSheet({ items, signature: 'a\nb', sealText: '字', canvasFactory: fakeCanvas }), /SINGLE_LINE/);
  await assert.rejects(() => renderSheet({ items, signature: '长'.repeat(40), sealText: '字', canvasFactory: fakeCanvas }), /SIGNATURE_TOO_LONG/);
});

test('renderSingleGlyph: A05 sizes, caption and brand; no ink → noInk without a canvas', async () => {
  for (const [ratio, h] of [['portrait', 1440], ['square', 1080]]) {
    const out = await renderSingleGlyph({ points: INK, caption: 'jìng · 9 月 22 日', signatureText: '拾字', sealText: '字', ratio,
      canvasFactory: fakeCanvas, meta: { kind: 'glyph', recordIds: 'r2' } });
    assert.equal(out.status, 'ready');
    assert.equal(out.canvas.height, h);
    assert.equal(out.canvas.dataset.caption, 'jìng · 9 月 22 日');
    assert.equal(out.canvas.dataset.signature, '拾字');
    assert.equal(out.canvas.dataset.recordIds, 'r2');
    assert.ok(Number(out.canvas.dataset.glyphWidth) <= 648);
    assert.ok(out.canvas.calls.some(c => c[0] === 'fillText' && c[1] === 'jìng · 9 月 22 日'), 'caption drawn');
  }
  const none = await renderSingleGlyph({ points: [], caption: '', signatureText: '拾字', sealText: '字', canvasFactory: fakeCanvas });
  assert.equal(none.status, 'noInk');
  assert.equal(none.canvas, null);
});
