// AX-01 的规则（D84 起只判原生自己）：任何截断 / 裁掉 / 伸出屏幕 / 同层重叠都是失败；只给读屏的元素不参与。
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalAx01, overlapArea } from '../ios/ShiziApp/scripts/native-ui/checks/ax01.mjs';

const t = (key, text, x, y, w, h, extra = {}) => ({ kind: 'text', key, text, frame: { x, y, w, h }, textFrame: { x, y, w, h }, ...extra });

test('overlapArea', () => {
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }), 0);
});

test('a same-layer overlap is a failure; stacked layers and clean layouts pass', () => {
  const r = evalAx01([t('a', 'A', 0, 0, 50, 20), t('b', 'B', 0, 10, 50, 20)]);
  assert.equal(r.pass, false);
  assert.equal(r.bad.length, 1);
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20), t('b', 'B', 0, 30, 50, 20)]).pass, true);
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20), t('f', '浮', 0, 0, 50, 20, { layer: 'undoBar' })]).pass, true);
});

test('screen-reader-only elements never count', () => {
  assert.equal(evalAx01([t('title', '9月字帖', 0, 0, 50, 20, { srOnly: true }), t('b', 'B', 0, 5, 50, 20)]).pass, true);
});

test('a known accepted overlap is skipped (either order); any other overlap still fails', () => {
  const els = [t('a', '调整图片›', 0, 0, 50, 20), t('b', '年度报告', 0, 10, 50, 20)];
  assert.equal(evalAx01(els).pass, false);
  assert.equal(evalAx01(els, ['年度报告|调整图片›']).pass, true);
  assert.equal(evalAx01(els, ['年度报告|别的']).pass, false);
});

test('truncated, clipped and off-screen text fail', () => {
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20, { truncated: true })]).pass, false);
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20, { clipped: true })]).pass, false);
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20, { offscreenX: true })]).pass, false);
});
