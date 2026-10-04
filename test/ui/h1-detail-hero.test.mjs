// H1-9（V2-03、T2-13、N2-10）：详情页头图——「第一次 | 最近一次」两格本人墨（只有一次时只显示一格；没写过才用参考字形）。纯函数部分。
import test from 'node:test';
import assert from 'node:assert/strict';
import { detailHero, detailModel } from '../../src/ui/screens/detail/records.js';
import { t } from '../../src/config/copy/index.js';

const DAY = '2026-10-05';
function rec(n, c, { day = '2026-10-01', judgment = 'correct', source } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's1', kind: 'judged', judgment, at: Date.parse(`${day}T09:00:00`) + n, localDay: day,
    help: { hints: 0, answerSeen: false, traced: false } };
  if (source) r.source = source;
  return r;
}
const state = records => ({ records: { '2026-10': records }, sessions: { A: null, B: null, lastEnded: {} }, sched: {}, custom: { added: [] }, settings: {} });
const model = (records, char = '永') => detailModel(state(records), char, { today: DAY, lookup: () => null });

test('detailHero：写过 3 次 → 两格，第一次在左、最近一次在右（取屏幕上写的第一条与最后一条）', () => {
  const m = model([rec(1, '永', { day: '2026-08-04' }), rec(2, '永', { day: '2026-09-14' }), rec(3, '永', { day: '2026-10-04', judgment: 'wrong' })]);
  const h = detailHero(m);
  assert.equal(h.kind, 'ink');
  assert.deepEqual(h.cells.map(c => [c.kind, c.record.id]), [['first', 'r1'], ['latest', 'r3']]);
});

test('detailHero：只写过 1 次 → 只显示一格（它既是第一次也是最近一次，标「第一次」）', () => {
  const h = detailHero(model([rec(1, '永')]));
  assert.equal(h.kind, 'ink');
  assert.deepEqual(h.cells.map(c => [c.kind, c.record.id]), [['first', 'r1']]);
});

test('detailHero：2 次 → 两格', () => {
  const h = detailHero(model([rec(1, '永'), rec(2, '永', { day: '2026-10-03' })]));
  assert.deepEqual(h.cells.map(c => c.record.id), ['r1', 'r2']);
});

test('detailHero：没写过 / 只在纸上写过 → 参考字形当头图（不占墨格）', () => {
  assert.deepEqual(detailHero(model([])), { kind: 'ref', cells: [] });
  assert.equal(detailHero(model([rec(1, '永', { source: 'paper' })])).kind, 'ref', '纸上记录没有笔迹格，D46 ⑬');
});

test('文案：头图标签', () => {
  assert.equal(t('X-DETAIL.heroFirst'), '第一次');
  assert.equal(t('X-DETAIL.heroLatest'), '最近一次');
});
