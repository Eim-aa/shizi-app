// QA-H2：线 / 装饰 / 墨格 / 屏外元素的比较（ios/ShiziApp/scripts/native-ui/graphics.mjs、elements.mjs diffState）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffState } from '../ios/ShiziApp/scripts/native-ui/elements.mjs';
import { cleanMask, crossMatch, diffDecos, diffGraphics, diffRules, inkMetrics, judgeInk, normRules, pairCells } from '../ios/ShiziApp/scripts/native-ui/graphics.mjs';

const tol = { pos: 3, size: 3, textHeight: 4, color: 8, font: 0.5, weight: 0.1 };
const f = (x, y, w, h) => ({ x, y, w, h });
const LINE = '#DDD5C7FF';

test('rules: a hairline on the web with nothing on native is reported missing; same line on both sides is not', () => {
  const web = [{ ...f(20, 122, 362, 0.3), color: LINE }, { ...f(20, 177.7, 362, 0.3), color: LINE }];
  const native = [{ ...f(20, 122.3, 362, 0.3), color: LINE }];
  const d = diffRules(web, native, tol);
  assert.equal(d.length, 1);
  assert.match(d[0].msg, /原生缺少线/);
  assert.match(d[0].msg, /177\.9/);
});

test('rules: pairing is by position, not by key; segments on one line merge (row borders vs one native line)', () => {
  const web = [{ ...f(20, 300, 120, 1), color: LINE }, { ...f(140, 300, 120, 1), color: LINE }, { ...f(260, 300, 122, 1), color: LINE }];
  const native = [{ ...f(21, 301.5, 361, 1), color: LINE }];
  assert.equal(normRules(web, tol).length, 1);
  assert.deepEqual(diffRules(web, native, tol), []);
});

test('rules: extra native line, wrong colour and wrong width are reported', () => {
  const web = [{ ...f(20, 100, 200, 1), color: '#D3C6B3FF' }, { ...f(20, 200, 200, 1), color: LINE }];
  const native = [{ ...f(20, 100, 200, 1), color: '#95826BFF' }, { ...f(20, 200, 200, 2), color: LINE }, { ...f(100, 300, 0.5, 80), color: LINE }];
  const d = diffRules(web, native, tol);
  assert.ok(d.some(x => /线色/.test(x.msg)));
  assert.ok(d.some(x => /线宽/.test(x.msg)));
  assert.ok(d.some(x => /原生多出线：竖线/.test(x.msg)));
});

test('rules: a line moved only vertically becomes one vertical position diff (axis:y waivers apply)', () => {
  const d = diffRules([{ ...f(20, 141.5, 362, 1), color: LINE }], [{ ...f(20, 149.5, 362, 1), color: LINE }], tol);
  assert.equal(d.length, 1);
  assert.equal(d[0].vertical, true);
  assert.match(d[0].msg, /竖向差 8pt/);
});

test('rules: lines inside an ink cell or an icon belong to that drawing and are not compared as rules', () => {
  const g = diffGraphics(
    { rules: [{ ...f(110, 100, 0.8, 80), color: LINE }], cells: [{ kind: 'ink', ...f(70, 100, 80, 80) }], decos: [] },
    { rules: [], cells: [{ kind: 'ink', ...f(70, 100, 80, 80) }], decos: [] }, tol);
  assert.deepEqual(g.diffs, []);
});

test('rules: a missing button / text element does not also report its border (the element diff covers it)', () => {
  const webEls = [{ kind: 'button', id: 'demo', text: '演示', frame: f(20, 850, 362, 54) }];
  const d = diffRules([{ ...f(20, 850, 362, 1), color: LINE }], [], tol, { web: webEls, native: [], pairs: [] });
  assert.deepEqual(d, []);
});

test('decos: a chevron inline after the text (web) vs pinned to the right edge (native) is flagged even though the row matches', () => {
  const w = { kind: 'button', text: '10月字帖 全部 26 字', frame: f(20, 593, 362, 152), textFrame: f(20, 600, 230, 140) };
  const n = { kind: 'button', text: '10月字帖 全部 26 字', frame: f(20, 593, 362, 152), textFrame: f(20, 600, 230, 140) };
  const d = diffDecos([{ kind: 'icon', ...f(251, 701.8, 8, 13) }], [{ kind: 'icon', ...f(374, 662.8, 8, 13) }], tol, { web: [w], native: [n], pairs: [[w, n]] });
  assert.equal(d.length, 1);
  assert.match(d[0].msg, /相对所属元素差 \(123, -39\)/);
});

test('decos: missing selected-day circle and wrong circle colour; duplicate native image views count once', () => {
  const web = [{ kind: 'circle', ...f(336, 410, 30, 30), color: '#E4DDD0FF' }, { kind: 'circle', ...f(48, 400, 5, 5), color: '#26211DFF' }, { kind: 'icon', ...f(374, 209.7, 8, 13) }];
  const native = [{ kind: 'circle', ...f(48, 400, 5, 5), color: '#B03A27FF' }, { kind: 'icon', ...f(374, 209.8, 8, 13) }, { kind: 'icon', ...f(374, 209.7, 8, 13) }];
  const d = diffDecos(web, native, tol);
  assert.equal(d.length, 2);
  assert.ok(d.some(x => /原生缺少装饰：网页有圆 \(336, 410/.test(x.msg)));
  assert.ok(d.some(x => /圆的颜色/.test(x.msg)));
});

test('cells: cells drawn under the wrong section are missing (offscreen too) / extra (on screen)', () => {
  const web = [{ kind: 'ink', ...f(16, 551, 45, 45) }, { kind: 'ink', ...f(16, 904, 45, 45), off: true }];
  const native = [{ kind: 'ink', ...f(16, 551, 45, 45) }, { kind: 'ink', ...f(16, 1031, 45, 45), off: true }];
  const { pairs, diffs } = pairCells(web, native, tol);
  assert.equal(pairs.length, 1);
  assert.ok(diffs.some(d => /原生缺少墨格 \(16, 904 45×45\)，在屏外/.test(d.msg)));
  assert.ok(!diffs.some(d => /原生多出墨格 \(16, 1031/.test(d.msg)), 'an extra native cell offscreen is not reported (the web may draw offscreen glyphs lazily)');
  const on = pairCells([{ kind: 'ink', ...f(16, 551, 45, 45) }], [{ kind: 'ink', ...f(16, 551, 45, 45) }, { kind: 'ink', ...f(16, 688, 45, 45) }], tol);
  assert.ok(on.diffs.some(d => /原生多出墨格 \(16, 688/.test(d.msg) && d.lone === 'native'));
});

test('cells: an oversized native cell on the same centre is a size diff; two native layers on one web cell are not extra', () => {
  const { diffs } = pairCells([{ kind: 'ink', ...f(45.5, 535.5, 40, 40) }], [{ kind: 'ink', ...f(20, 510, 91, 91) }], tol);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0].msg, /格大小/);
  const two = pairCells([{ kind: 'ink', ...f(16, 551, 45, 45) }], [{ kind: 'ink', ...f(16, 551, 45, 45) }, { kind: 'glyph', ...f(20, 555, 37, 37) }], tol);
  assert.deepEqual(two.diffs, []);
});

test('cross match: a web svg icon and a native ink view in the same box are one thing (compared as ink)', () => {
  const x = crossMatch([{ kind: 'icon', ...f(25, 411, 28, 28) }], [], [], [{ kind: 'ink', ...f(25, 411, 28, 28) }], tol);
  assert.equal(x.pairs.length, 1);
  assert.equal(x.webDecos.length, 0);
  assert.equal(x.nativeCells.length, 0);
});

// 掩膜：n×n 的 '0' / '1' 串
const mask = (n, fill) => { const a = Array(n * n).fill('0'); fill((i, j) => { a[j * n + i] = '1'; }); return a.join(''); };
const glyph = (n, x0, y0, s) => mask(n, set => { for (let k = 0; k < s; k += 1) { set(x0 + k, y0 + Math.floor(s / 2)); set(x0 + Math.floor(s / 2), y0 + k); } }); // 十

test('ink: antialiasing / 1-pixel registration does not fail', () => {
  const n = 45;
  const a = glyph(n, 10, 10, 25), b = glyph(n, 11, 10, 25);
  const m = inkMetrics(a, b, n, 41);
  assert.equal(m.iou1, 1);
  assert.deepEqual(judgeInk(m, 45), []);
});

test('ink: the annual defects fail — ink not vertically centred (shifted ~10%) and an oversized glyph (no inner pad)', () => {
  const n = 45;
  const ref = glyph(n, 10, 10, 25);
  const shifted = glyph(n, 10, 5, 25); // 竖向偏 5 格 ≈ 4.6pt（格 45pt 的 10%）
  assert.ok(judgeInk(inkMetrics(ref, shifted, n, 41), 45).some(s => /墨的位置偏/.test(s)));
  const big = glyph(n, 4, 4, 37); // 内边 0
  assert.ok(judgeInk(inkMetrics(ref, big, n, 41), 45).some(s => /墨的外框/.test(s)));
  assert.ok(judgeInk(inkMetrics(ref, mask(n, () => {}), n, 41), 45).some(s => /原生没有/.test(s)));
});

test('ink: small blobs along the edge band (date tags riding on the grid line) are not ink', () => {
  const n = 45;
  const withTag = mask(n, set => { for (let k = 10; k < 35; k += 1) set(k, 22); set(5, 43); set(5, 44); set(9, 43); });
  assert.equal([...cleanMask(withTag, n)].filter(c => c === '1').length, 25);
});

test('offscreen elements: a section only in the web scroll content is missing on native', () => {
  const web = { elements: [{ kind: 'text', text: '年度报告', frame: f(72, 73, 232, 22) }], offscreen: [{ kind: 'text', text: '同字两次', frame: f(16, 1253, 370, 30) }] };
  const native = { elements: [{ kind: 'text', text: '年度报告', frame: f(72, 73, 232, 22) }], offscreen: [] };
  const { diffs, web: onScreen } = diffState(web, native, tol);
  assert.equal(onScreen.length, 1, 'named checks still see only on-screen elements');
  assert.ok(diffs.some(d => d.type === 'missing' && /同字两次.*在屏外/.test(d.msg)));
});

test('old references without the new fields compare as before', () => {
  assert.deepEqual(diffGraphics({ elements: [] }, { elements: [], rules: [{ ...f(0, 0, 100, 1), color: LINE }] }, tol).diffs, []);
});
