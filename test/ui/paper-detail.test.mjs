// 阶段 1 P1-E8 单字详情的「纸上」标注（D46 ⑬；实现交接 §10.2；03 P169）：纸上记录照常计数、照常进写错过，
// 但不占笔迹格（不画空格），记录列表另起一行「{日期}　写对 · 纸上」，读屏「{日期}，写对，纸上」；做成图片取屏幕上写的最近一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { makeRecord } from '../../src/core/records.js';
import { t } from '../../src/config/copy/index.js';
import { detailModel, PaperRows, paperRowCopy, RecordsBlock } from '../../src/ui/screens/detail/records.js';

loadFSRSGlobal();

const TODAY = '2026-10-04';
const lookup = key => (key === 'base:嚏' ? { word: '喷嚏', chars: ['喷', '嚏'], ci: 1, target: '嚏', py: 'tì', hint: 'x', strokes: 17, ctx: 'dict' } : null);

let serial = 0;
function rec(judgment, day, { kind = 'judged', source } = {}) {
  serial += 1;
  const [y, m, d] = day.split('-').map(Number);
  return makeRecord({
    id: `r${serial}`, cardKey: 'base:嚏', sessionId: 's1', kind, judgment: kind === 'judged' ? judgment : undefined,
    at: new Date(y, m - 1, d, 10).getTime(), help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false }, source,
  });
}

function stateWith(records) {
  const byMonth = {};
  for (const r of records) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: byMonth, sched: {}, custom: null, wordOff: null, photos: null };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(n => walk(n, visit));
  visit(node);
  walk(node.props && node.props.children, visit);
}

function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function' && node.type.name === 'PaperRows') return expand(node.type(node.props));
  if (node.props && node.props.children !== undefined) return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  return node;
}

function byTestid(vnode) {
  const out = {};
  walk(vnode, n => {
    const id = n.props && n.props['data-testid'];
    if (id) (out[id] = out[id] || []).push(n);
  });
  return out;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props && node.props.children);
}

test('P169: detailModel——纸上记录计入次数与写错过，但不进笔迹格；留墨的第一次 / 最近一次与做图片取屏幕上写的', () => {
  const a = rec('correct', '2026-09-21');
  const b = rec('wrong', '2026-09-28');
  const p = rec('wrong', TODAY, { source: 'paper' });
  const seen = rec(null, '2026-09-29', { kind: 'answer-seen' });
  const m = detailModel(stateWith([a, b, seen, p]), '嚏', { today: TODAY, lookup, hasInk: r => r.id === a.id || r.id === b.id });
  assert.equal(m.count, 3, 'paper counts as a record');
  assert.deepEqual(m.cells.map(r => r.id), [a.id, b.id], 'paper record takes no ink cell');
  assert.deepEqual(m.paperRows.map(r => r.id), [p.id]);
  assert.equal(m.first, a);
  assert.equal(m.latest, p, 'latest judgment is the paper one');
  assert.equal(m.inkFirst, a);
  assert.equal(m.inkLatest, b, 'latest ink record skips the paper one (D27 / D42)');
  assert.equal(m.list, 'wrong', 'paper wrong → 写错过 as usual');
  assert.equal(m.image, 'ok', 'image from the latest screen record');
  assert.equal(m.imageRecord, b);

  const only = detailModel(stateWith([rec('correct', TODAY, { source: 'paper' })]), '嚏', { today: TODAY, lookup, hasInk: () => true });
  assert.equal(only.count, 1);
  assert.deepEqual(only.cells, []);
  assert.equal(only.image, 'noInk', 'only paper → nothing to draw');
});

test('P169: 纸上记录行「10月4日　写对 · 纸上」（· 纸上 单独一段，墨三），读屏「10月4日，写对，纸上」', () => {
  const p = rec('correct', TODAY, { source: 'paper' });
  const c = paperRowCopy(p);
  assert.equal(c.date, t('R-H02.dateFormat', { month: 10, day: 4 }));
  assert.equal(c.caption, '写对');
  assert.equal(c.tag, '· 纸上');
  assert.equal(c.label, `${c.date}，写对，纸上`);
  const ids = byTestid(PaperRows({ records: [p] }));
  assert.equal(ids['detail-paper-row'].length, 1);
  assert.equal(textOf(ids['detail-paper-tag'][0]), '· 纸上');
  assert.equal(textOf(ids['detail-paper-label'][0]), c.label);
  assert.equal(paperRowCopy(rec('wrong', TODAY, { source: 'paper' })).caption, '写错');
});

test('P169: RecordsBlock——只有纸上记录时不画笔迹格（不画空格），只出记录行；有屏幕记录时格子 + 行', () => {
  const p = rec('correct', TODAY, { source: 'paper' });
  const only = detailModel(stateWith([p]), '嚏', { today: TODAY, lookup });
  const ids = byTestid(expand(RecordsBlock({ model: only, store: null })));
  assert.ok(!ids['detail-cells'], 'no empty ink grid');
  assert.equal(ids['detail-paper-row'].length, 1);
  assert.equal(textOf(ids['detail-records-count'][0]), t('R-D03.count', { n: 1 }));
  // 屏幕上写过 3 次：头图是第一次与最近一次，格子只画它们之外的那一次（C3-R：一个字只出现一次）
  const a = rec('correct', '2026-09-21');
  const b = rec('wrong', '2026-09-25');
  const c = rec('correct', '2026-09-28');
  const both = detailModel(stateWith([a, b, c, p]), '嚏', { today: TODAY, lookup });
  const ids2 = byTestid(expand(RecordsBlock({ model: both, store: null })));
  assert.equal(ids2['detail-cells'].length, 1);
  const cellNodes = [];
  walk(expand(RecordsBlock({ model: both, store: null })), n => { if (typeof n.type === 'function' && n.type.name === 'Cell') cellNodes.push(n); });
  assert.deepEqual(cellNodes.map(n => n.props.record.id), [b.id], 'only the record in between (the first and the latest are the hero)');
  assert.equal(ids2['detail-paper-row'].length, 1);
  // 屏幕上只写过 1 次：头图已经是全部，不画历史格
  const one = detailModel(stateWith([a, p]), '嚏', { today: TODAY, lookup });
  assert.ok(!byTestid(expand(RecordsBlock({ model: one, store: null })))['detail-cells'], 'a single screen record is the hero; no strip');
});
