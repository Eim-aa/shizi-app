// B2.3 Ink v4（原始点）编码：与会话现场的 encodeRawStrokes 逐整数互逆；坏串解不开；网页解码 = 书写时同一管线；
// 回放一致性夹具（ink-v4-fixture.json，原生 XCTest 用同一份）与代码同步。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildStroke, decodeInk, decodeInkRaw, encodeInkRaw, encodeRawStrokes, encodeStoredInk, inkRawRows, isInk, isInkV3, isInkV4,
  packedToRawRow, rawRowToPacked,
} from '../../src/core/ink-math.js';
import { inkHasStrokes } from '../../src/core/ink-pick.js';
import { validateValue } from '../../src/core/schema.js';
import { FIXTURE_PATH, fixtureText } from '../../docs/engineering/v10/phase1/ink-model/gen-ink-v4-fixture.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomStroke(r, { pen = false, n = 2 + Math.floor(r() * 120), t0 = 0 } = {}) {
  const pts = [];
  let x = r() * 345;
  let y = r() * 345;
  let t = t0;
  for (let k = 0; k < n; k += 1) {
    x += (r() - 0.5) * (r() < 0.05 ? 400 : 12); // 偶尔大跳（多字节变长整数）、可出格（负数）
    y += (r() - 0.5) * 12;
    t += r() < 0.03 ? 300 + r() * 5000 : r() * 17; // 偶尔长停顿
    const q = { x, y, t };
    if (pen) q.p = r() < 0.1 ? 0 : r();
    pts.push(q);
  }
  return pts;
}

test('Ink v4 packing is the exact inverse of encodeRawStrokes rows (random strokes, finger + pen, out-of-grid, long pauses)', () => {
  const r = rng(20261021);
  for (let i = 0; i < 400; i += 1) {
    const row = encodeRawStrokes([randomStroke(r, { pen: i % 3 === 0 })])[0].map(v => v || 0); // -0 → 0（JSON 里本来就一样）
    const packed = rawRowToPacked(row);
    assert.equal(typeof packed, 'string');
    assert.deepEqual(packedToRawRow(packed), row, `case ${i}`);
  }
  assert.equal(rawRowToPacked([3, 1, 2]), null, 'bad row');
});

test('Ink v4: corrupted packed strings never decode (truncated varint, bad stride, too short, not base64)', () => {
  const good = rawRowToPacked(encodeRawStrokes([[{ x: 10, y: 20, t: 0 }, { x: 40, y: 20, t: 8 }]])[0]);
  const bytes = Buffer.from(good, 'base64');
  const b64 = arr => Buffer.from(arr).toString('base64');
  assert.equal(packedToRawRow(b64([...bytes.subarray(0, bytes.length - 1), 0x80])), null, 'truncated varint');
  assert.equal(packedToRawRow(b64([5, ...bytes.subarray(1)])), null, 'stride 5');
  assert.equal(packedToRawRow(b64([3, 1, 2])), null, 'shorter than one point');
  assert.equal(packedToRawRow(b64([3, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0, 0])), null, 'varint longer than 5 bytes');
  assert.equal(packedToRawRow('not base64!'), null);
  assert.equal(isInkV4({ v: 4, c: 345, r: [good, 'AAA='], g: [0, 0] }), false, 'one bad stroke = whole ink invalid');
  assert.equal(decodeInk({ v: 4, c: 345, r: [good], g: [0, 1] }), null, 'g length must match');
  assert.equal(decodeInkRaw({ v: 4, c: 345, r: [good], g: [-1] }), null);
});

test('Ink v4: encode keeps strokes ≤ inkMaxStrokes, gaps between strokes, empty strokes dropped; schema and inkHasStrokes agree', () => {
  const r = rng(7);
  const strokes = [];
  let t = 1000;
  for (let i = 0; i < 40; i += 1) {
    const st = randomStroke(r, { n: 5, t0: t });
    strokes.push(st, []);
    t = st[st.length - 1].t + 100 + i;
  }
  const ink = encodeInkRaw(strokes);
  assert.equal(ink.r.length, 36, 'P05: first 36 strokes');
  assert.equal(ink.g[0], 0);
  const kept = strokes.filter(st => st.length);
  assert.deepEqual(ink.g.slice(1, 4), [1, 2, 3].map(i => Math.round(kept[i][0].t - kept[i - 1][kept[i - 1].length - 1].t)), 'gaps (ms) between strokes');
  assert.ok(ink.g.slice(1).every(g => g >= 100), 'every gap ≥ the 100ms pause'); 
  assert.ok(isInkV4(ink) && isInk(ink));
  assert.equal(validateValue('shizi.v2.ink.2026-10.r1', ink), null);
  assert.equal(inkHasStrokes(ink), true);
  assert.equal(inkHasStrokes(encodeInkRaw([])), false);
  assert.deepEqual(encodeInkRaw([]), { v: 4, c: 345, r: [], g: [] });
});

test('Ink v4 on the web: decodeInk = buildStroke(final) over the decoded raw points (same pipeline as when written); cached per ink object', () => {
  const r = rng(11);
  const strokes = [randomStroke(r, { n: 30 }), randomStroke(r, { n: 20, pen: true, t0: 5000 })];
  const ink = Object.freeze(encodeInkRaw(strokes));
  const raw = decodeInkRaw(ink);
  const want = raw.map(s => buildStroke(s, { final: true }).map(q => (q.p === undefined ? { x: q.x, y: q.y, w: q.w, t: q.t } : { x: q.x, y: q.y, w: q.w, t: q.t, p: q.p })));
  const got = decodeInk(ink);
  assert.deepEqual(got, want);
  assert.equal(decodeInk(ink), got, 'second decode hits the cache');
  assert.notEqual(decodeInk(ink, { base: 15 }), got, 'custom params bypass the cache');
});

test('encodeStoredInk: raw (native) → Ink v4; v3 (web localStorage) → the old pipeline', () => {
  const strokes = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
  assert.ok(isInkV4(encodeStoredInk(strokes)), 'default raw');
  assert.ok(isInkV4(encodeStoredInk(strokes, { format: 'raw' })));
  assert.ok(isInkV3(encodeStoredInk(strokes, { format: 'v3' })));
});

test('replay fixture (ink-v4-fixture.json, shared with the native XCTest) is up to date; replay ≈ written (area within 1%)', () => {
  const text = fixtureText();
  assert.equal(fs.readFileSync(FIXTURE_PATH, 'utf8'), text, 'stale — run: node docs/engineering/v10/phase1/ink-model/gen-ink-v4-fixture.mjs');
  const doc = JSON.parse(text);
  assert.ok(doc.cases.length >= 21);
  for (const c of doc.cases) {
    c.ref.forEach((s, i) => {
      const rel = Math.abs(s.area - c.written[i]) / c.written[i];
      assert.ok(rel <= 0.01, `${c.id} stroke ${i}: replay area ${s.area} vs written ${c.written[i]}`);
    });
  }
});
