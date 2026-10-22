// QA-H1：逐屏对比的元素配对与差异（ios/ShiziApp/scripts/native-ui/elements.mjs）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignKeys, diffState, colorDelta, contrastRatio, normText } from '../ios/ShiziApp/scripts/native-ui/elements.mjs';
import { CHECKS } from '../ios/ShiziApp/scripts/native-ui/parity-checks.mjs';

const tol = { pos: 1, size: 1, textHeight: 4, color: 8, font: 0.5, weight: 0.1 };
const f = (x, y, w, h) => ({ x, y, w, h });

test('pairs by semantic key first, then by text; reports missing / extra', () => {
  const web = { elements: [
    { kind: 'button', id: 'write-skip', text: '跳过', frame: f(344, 62, 42, 44), textFrame: f(348, 73, 34, 22), color: '#564E46FF', fontSize: 17 },
    { kind: 'text', text: '记为看过答案。', id: 'write-note', frame: f(20, 634, 362, 40), textFrame: f(20, 645, 90, 17), color: '#6E655BFF', fontSize: 13 },
    { kind: 'text', text: '只在网页', frame: f(0, 0, 50, 20) },
    { kind: 'text', text: '读屏', frame: f(0, 0, 1, 1), srOnly: true },
  ] };
  const native = { elements: [
    { kind: 'button', prop: 'skipButton', text: '跳过', frame: f(352, 62, 30, 44), textFrame: f(352, 75, 30, 18), color: '#564E46FF', fontSize: 15 },
    { kind: 'text', text: '记为看过答案。', frame: f(20, 641, 362, 20), textFrame: f(20.5, 645.5, 90, 18), color: '#6E655BFF', fontSize: 13 },
    { kind: 'text', text: '只在原生', frame: f(0, 0, 50, 20) },
  ] };
  const { diffs, pairs } = diffState(web, native, tol);
  assert.equal(pairs.length, 2);
  const skip = diffs.find(d => d.label === 'skip');
  assert.ok(skip.aspects.includes('position') && skip.aspects.includes('font'));
  assert.ok(!diffs.some(d => d.label === normText('记为看过答案。')), 'within tolerance (text compared by left edge and centre line)');
  assert.ok(diffs.some(d => d.type === 'missing' && /只在网页/.test(d.msg)));
  assert.ok(diffs.some(d => d.type === 'extra' && /只在原生/.test(d.msg)));
  assert.ok(!diffs.some(d => /读屏/.test(d.msg)), 'screen-reader-only text is not compared for layout');
});

test('colour delta is the max channel difference', () => {
  assert.equal(colorDelta('#FBF8F2FF', '#F4EFE6FF'), 12);
  assert.equal(colorDelta('#FFFFFF', null), null);
});

test('every named check (AI report NP-*) has an id, a status and states', () => {
  const ids = new Set();
  for (const c of CHECKS) {
    assert.match(c.id, /^(NP|L4|AX)-\d\d$/); // NP：AI 报告编号；L4：设计系统规则（D71 ③）；AX：大字号不溢出（B2.9b，交互规范 A1）
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`);
    ids.add(c.id);
    assert.ok(['expected-fail', 'pass'].includes(c.status));
    assert.ok(c.states.length > 0);
  }
});

test('primary key: only the full-width primary button; the help-row 下一个 (same testid in the trace phase) pairs by text', () => {
  const web = assignKeys([
    { kind: 'button', id: 'write-answer-next', class: 'sz-btn sz-btn--text', text: '下一个', frame: { x: 20, y: 718, w: 362, h: 48 } },
    { kind: 'button', id: 'write-trace-done', class: 'sz-btn sz-btn--primary', text: '凭记忆写', frame: { x: 20, y: 786, w: 362, h: 54 } },
  ], 'web');
  assert.equal(web[0].key, undefined);
  assert.equal(web[1].key, 'primary');
  const next = assignKeys([{ kind: 'button', id: 'write-answer-next', class: 'sz-btn sz-btn--primary', text: '下一个', frame: { x: 20, y: 786, w: 362, h: 54 } }], 'web');
  assert.equal(next[0].key, 'primary');
});

test('L4-01: a floating bar painted with the primary button fill fails; the raised light surface passes (D71 ③)', () => {
  const c = CHECKS.find(x => x.id === 'L4-01');
  assert.ok(c && c.status === 'pass');
  const screen = (barBg, radius) => [
    { key: 'undo-bar', kind: 'view', bg: barBg, radius, frame: { x: 20, y: 638, w: 362, h: 62 } },
    { key: 'primary', kind: 'button', bg: '#E4DDD0FF', enabled: false, radius: 12, frame: { x: 20, y: 786, w: 362, h: 54 } },
  ];
  const old = c.eval({ appearance: 'light', web: screen('#26211DFF', 12), native: screen('#26211DFF', 12) });
  assert.equal(old.pass, false, 'old look (toast-bg = btn-bg, 12 radius) is rejected');
  assert.ok(c.eval({ appearance: 'light', web: screen('#FBF8F2FF', 24), native: screen('#FBF8F2FF', 24) }).pass);
  assert.ok(c.eval({ appearance: 'dark', web: screen('#2A2520FF', 24), native: screen('#2A2520FF', 24) }).pass);
  assert.equal(c.eval({ appearance: 'dark', web: screen('#2A2520FF', 24), native: screen('#E2D9C9FF', 24) }).pass, false, 'native alone regressing fails too');
  assert.ok(Math.abs(contrastRatio('#26211D', '#FBF8F2') - 15.03) < 0.01);
});

test('AX-01 (B2.9b): truncation, clipping and overlap within one layer fail; overlays over the page do not', () => {
  const ax = CHECKS.find(c => c.id === 'AX-01');
  assert.deepEqual(ax.sizes, ['AX3', 'AX5']);
  const el = (text, frame, extra = {}) => ({ kind: 'text', text, frame, textFrame: frame, layer: 'page', ...extra });
  const ok = ax.eval({ native: [el('甲', { x: 20, y: 100, w: 50, h: 30 }), el('乙', { x: 20, y: 140, w: 50, h: 30 }),
    el('浮', { x: 20, y: 100, w: 300, h: 60 }, { layer: 'undoBar' })] });
  assert.equal(ok.pass, true, ok.detail);
  assert.equal(ax.eval({ native: [el('甲', { x: 20, y: 100, w: 50, h: 30 }, { truncated: true })] }).pass, false);
  assert.equal(ax.eval({ native: [el('甲', { x: 20, y: 100, w: 50, h: 30 }, { clipped: true })] }).pass, false);
  assert.equal(ax.eval({ native: [el('甲', { x: 20, y: 100, w: 50, h: 30 }), el('乙', { x: 40, y: 110, w: 50, h: 30 })] }).pass, false);
});
