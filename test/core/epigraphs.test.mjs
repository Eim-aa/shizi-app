import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EPIGRAPHS, epigraphFor, epigraphIndexFor } from '../../src/config/epigraphs.js';
import { addDays } from '../../src/core/dates.js';
import { ROOT } from './helpers.mjs';

const PROTO = path.join(ROOT, 'docs/design/v10/extracted/首页壳-v3-第十稿交接版.dc.html');

test('epigraphs: verbatim from the prototype home shell L141 QUOTES', () => {
  const line = fs.readFileSync(PROTO, 'utf8').split('\n')[140];
  const m = /const QUOTES=(\[.*\]);/.exec(line);
  assert.ok(m, 'L141 still defines QUOTES');
  const quotes = vm.runInNewContext('(' + m[1] + ')');
  assert.equal(quotes.length, 3);
  quotes.forEach((q, i) => {
    assert.deepEqual([...EPIGRAPHS[i].lines], [...q.q], 'lines ' + i);
    assert.equal(EPIGRAPHS[i].source, q.src, 'source ' + i);
  });
});

test('epigraphs: each couplet has two halves of equal length', () => {
  for (const e of EPIGRAPHS) {
    assert.equal(e.lines.length, 2);
    assert.equal([...e.lines[0]].length, [...e.lines[1]].length, e.lines.join(''));
  }
  assert.ok(Object.isFrozen(EPIGRAPHS) && EPIGRAPHS.every((e) => Object.isFrozen(e) && Object.isFrozen(e.lines)));
});

test('epigraphs: rotate by day of year mod 3 (P23; 9月24日 = 267 → first)', () => {
  assert.equal(epigraphIndexFor('2026-09-24'), 267 % 3);
  assert.equal(epigraphFor('2026-09-24'), EPIGRAPHS[0]);
  assert.equal(epigraphFor('2026-09-25'), EPIGRAPHS[1]);
  assert.equal(epigraphFor('2026-09-26'), EPIGRAPHS[2]);
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const day = addDays('2026-09-24', i);
    assert.equal(epigraphFor(day), epigraphFor(day), 'stable within a day');
    seen.add(epigraphIndexFor(day));
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});
