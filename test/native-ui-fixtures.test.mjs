// QA-H1 夹具机制（B3.3）：registry 按目录扫描、取证顺序、字号档、op / 运行时脚本语法、夹具里点按步骤的形状。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AX_STATES, FIXTURES, STATES, STATES_DIR, REFERENCE_STATES, fixtureOf, sizesOf, statesForSize } from '../ios/ShiziApp/scripts/native-ui/registry.mjs';
import { KEYS } from '../ios/ShiziApp/scripts/native-ui/elements.mjs';
import { CHECKS } from '../ios/ShiziApp/scripts/native-ui/parity-checks.mjs';

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

/** B2 的 25 个原生对比状态，取证顺序不能变：造数据时钟钉住时「N 天后再见」靠同一次启动里前面跑过什么逐位一致（B2.9b）。 */
const B2_ORDER = ['first-recall', 'recall', 'recall-ink', 'hint-1', 'hint-2', 'hint-full', 'trace', 'retrace', 'judge', 'line', 'change-sheet', 'skip-undo', 'end-dialog', 'last', 'last-judge',
  'result', 'result-daily', 'result-first', 'result-early', 'result-undo', 'result-sheet', 'redo', 'redo-ink', 'redo-check', 'redo-last'];

test('native-parity states keep the B2 capture order; reference-only states come after', () => {
  // 页面卡原生化后（B3.2 起）它们的状态排在 B2 的 25 个之后（夹具没有 order），B2 的顺序不变
  assert.deepEqual(STATES.slice(0, B2_ORDER.length), B2_ORDER);
  assert.deepEqual(REFERENCE_STATES.slice(0, B2_ORDER.length), B2_ORDER);
  for (const s of STATES.slice(B2_ORDER.length)) assert.equal(fixtureOf[s].order, undefined, `${s}: page-card states come after B2`);
  assert.ok(REFERENCE_STATES.length > B2_ORDER.length, 'B3.3 reference-only fixtures exist');
  for (const s of STATES) assert.equal(fixtureOf[s].native, true);
});

test('sizesOf: default L / XXXL, ax adds AX3 / AX5, explicit sizes win', () => {
  assert.deepEqual(sizesOf({}), ['L', 'XXXL']);
  assert.deepEqual(sizesOf({ ax: true }), ['L', 'XXXL', 'AX3', 'AX5']);
  assert.deepEqual(sizesOf({ ax: true, sizes: ['AX3'] }), ['AX3']);
  assert.ok(statesForSize('AX5').every(s => sizesOf(fixtureOf[s]).includes('AX5')));
  const b2Ax = B2_ORDER.filter(s => fixtureOf[s].ax);
  assert.equal(b2Ax.length, 16);
  for (const s of b2Ax) assert.ok(AX_STATES.includes(s), `B2 AX state ${s}`);
  // 页面卡把夹具改成 native: true 后，它的 AX 档状态也进原生对比
  for (const s of AX_STATES) assert.ok(fixtureOf[s].native === true && sizesOf(fixtureOf[s]).some(z => z.startsWith('AX')), s);
});

test('every _ops / _runtime script parses (ops are function bodies; the runtime is one async function body)', () => {
  for (const f of readdirSync(join(STATES_DIR, '_ops')).filter(x => x.endsWith('.js'))) {
    const body = readFileSync(join(STATES_DIR, '_ops', f), 'utf8');
    assert.doesNotThrow(() => new AsyncFunction('ctx', 'a', 'OPS', body), `_ops/${f}`);
  }
  const ops = readdirSync(join(STATES_DIR, '_ops')).filter(x => x.endsWith('.js'))
    .map(f => { const body = readFileSync(join(STATES_DIR, '_ops', f), 'utf8'); return `OPS[${JSON.stringify(f.slice(0, -3))}] = ${body.includes('await ') ? 'async ' : ''}(ctx, a) => {\n${body}\n};\n`; }).join('');
  const full = ['prologue', 'epilogue'].map(n => readFileSync(join(STATES_DIR, '_runtime', `${n}.js`), 'utf8'));
  assert.doesNotThrow(() => new AsyncFunction('setup', 'pin', 'chars', 'clock', 'reset', full[0] + ops + full[1]), 'prologue + ops + epilogue');
  assert.doesNotThrow(() => new AsyncFunction('lines', readFileSync(join(STATES_DIR, '_runtime', 'strokes.js'), 'utf8')), 'strokes.js');
});

test('fixture steps have a known shape', () => {
  const check = (name, steps) => {
    for (const s of steps || []) {
      const kinds = ['wait', 'tap', 'ready', 'strokes', 'js', 'repeat'].filter(k => k in s);
      assert.equal(kinds.length, 1, `${name}: step needs exactly one of wait / tap / ready / strokes / js / repeat — ${JSON.stringify(s)}`);
      if (s.tap) assert.ok(s.tap.web || s.tap.webTestid || s.tap.native, `${name}: tap needs web / webTestid / native`);
      if (s.repeat) check(name, s.steps);
    }
  };
  for (const f of FIXTURES) check(f.state, f.steps);
  for (const f of readdirSync(STATES_DIR).filter(x => x.startsWith('_') && x.endsWith('.json'))) check(f, JSON.parse(readFileSync(join(STATES_DIR, f), 'utf8')).steps);
});

test('registry loads keys / parity / checks from directories', () => {
  assert.ok(KEYS.length >= 40, 'keys merged from keys/*.mjs');
  assert.ok(KEYS.some(k => k.key === 'grid') && KEYS.some(k => k.key === 'work-cell-0'), 'B2 keys survived the split');
  assert.ok(CHECKS.some(c => c.id === 'AX-01'), 'checks merged from checks/*.mjs');
  const dupes = KEYS.map(k => k.key).filter((k, i, a) => a.indexOf(k) !== i);
  assert.deepEqual(dupes, [], 'semantic keys are unique across screens');
});
