// AX-01 的规则：只报网页没有的重叠 / 截断；网页同样的记 info；只给读屏的隐藏标题不参与重叠。
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalAx01, overlapArea } from '../ios/ShiziApp/scripts/native-ui/checks/ax01.mjs';

const t = (key, text, x, y, w, h, extra = {}) => ({ kind: 'text', key, text, frame: { x, y, w, h }, textFrame: { x, y, w, h }, ...extra });

test('overlapArea', () => {
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }), 0);
});

test('an overlap the web does not have is a failure', () => {
  const web = [t('a', 'A', 0, 0, 50, 20), t('b', 'B', 0, 30, 50, 20)];
  const native = [t('a', 'A', 0, 0, 50, 20), t('b', 'B', 0, 10, 50, 20)];
  const r = evalAx01(web, native);
  assert.equal(r.pass, false);
  assert.equal(r.bad.length, 1);
});

test('the same overlap in the web reference is only info', () => {
  const web = [t('a', 'A', 0, 0, 50, 20), t('b', 'B', 0, 10, 50, 20)];
  const native = [t('a', 'A', 0, 0, 50, 20), t('b', 'B', 0, 11, 50, 20)];
  const r = evalAx01(web, native);
  assert.equal(r.pass, true);
  assert.equal(r.info.length, 1);
});

test('a hidden accessibility-only title never counts for overlap', () => {
  const web = [t('title', '9月字帖', 0, 0, 50, 20, { class: 'sz-page__title sz-page__title--hidden' }), t('b', 'B', 0, 30, 50, 20)];
  const native = [t('title', '9月字帖', 0, 0, 50, 20), t('b', 'B', 0, 5, 50, 20)];
  assert.equal(evalAx01(web, native).pass, true);
});

test('truncation: failure unless the web truncates the same element', () => {
  const native = [t('a', 'A', 0, 0, 50, 20, { truncated: true })];
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20)], native).pass, false);
  assert.equal(evalAx01([t('a', 'A', 0, 0, 50, 20, { truncated: true })], native).pass, true);
});

test('elements without a semantic key are compared as new (no web counterpart)', () => {
  const web = [t(null, 'A', 0, 0, 50, 20), t(null, 'B', 0, 10, 50, 20)];
  const native = [t(null, 'A', 0, 0, 50, 20), t(null, 'B', 0, 10, 50, 20)];
  assert.equal(evalAx01(web, native).pass, false);
});
