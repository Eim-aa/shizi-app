// 动效令牌（交互与动效规范 T2 / §8a，D58）：tokens.json 的 motion / gesture / timing / haptic 是唯一来源，
// src/config/motion.js（JS）与 src/config/tokens.css 的 --dur-* / --ease-*（CSS）逐值一致；旧名别名保留一个版本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokenDecls } from '../../src/ui/dev/palette.js';
import * as motion from '../../src/config/motion.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));
const tokensCss = read('src/config/tokens.css');
const baseCss = read('src/config/base.css');
const kebab = s => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
const rootDecls = Object.fromEntries(parseTokenDecls(tokensCss).filter(d => d.selectors.length === 1 && d.selectors[0] === ':root').map(d => [d.name, d]));

test('motion.js duration / moment / easing / scale / distance / timing equal tokens.json', () => {
  assert.deepEqual({ ...motion.duration }, tokens.motion.duration);
  assert.deepEqual({ ...motion.moment }, tokens.motion.moment);
  assert.deepEqual({ ...motion.easing }, tokens.motion.easing);
  assert.deepEqual({ ...motion.scale }, tokens.motion.scale);
  assert.deepEqual({ ...motion.distance }, tokens.motion.distance);
  assert.deepEqual({ ...motion.timing }, tokens.timing);
  for (const [k, v] of Object.entries(tokens.motion.spring)) {
    assert.equal(motion.spring[k].response, v.response, `spring.${k}`);
    assert.equal(motion.spring[k].dampingFraction, v.dampingFraction, `spring.${k}`);
  }
});

test('motion.js role resolves every tokens.json role (duration key or literal ms)', () => {
  assert.deepEqual(Object.keys(motion.role).sort(), Object.keys(tokens.motion.role).sort());
  for (const [k, v] of Object.entries(tokens.motion.role)) {
    const ms = typeof v === 'number' ? v : tokens.motion.duration[v];
    assert.ok(Number.isFinite(ms), `role.${k} → ${v}`);
    assert.equal(motion.role[k], ms, `role.${k}`);
  }
});

test('gesture equals tokens.json (commitRatio is the exact 1/3 of 0.3333)', () => {
  for (const [k, v] of Object.entries(tokens.gesture)) {
    if (k === 'commitRatio' || k === 'sheetCommitRatio') assert.ok(Math.abs(motion.gesture[k] - v) < 5e-4, k);
    else assert.equal(motion.gesture[k], v, k);
  }
  assert.equal(motion.gesture.commitRatio, 1 / 3);
});

test('haptic table equals tokens.json (judge soft 0.7, seal rigid 0.8 — D58 ③)', () => {
  for (const [k, v] of Object.entries(tokens.haptic)) {
    if (k === 'note') continue;
    assert.deepEqual({ ...motion.haptic[k] }, v, `haptic.${k}`);
  }
  assert.equal(motion.haptic.judge.style, 'soft');
  assert.equal(motion.haptic.judge.intensity, 0.7);
  assert.equal(motion.haptic.seal.style, 'rigid');
  assert.equal(motion.haptic.seal.intensity, 0.8);
});

test('bezier control points are parsed from easing (one source)', () => {
  assert.deepEqual([...motion.bezier.out], [0.2, 0.7, 0.2, 1]);
  assert.deepEqual([...motion.bezier.paperOpen], [0.3, 0, 0.1, 1]);
  assert.deepEqual([...motion.bezier.linear], [0, 0, 1, 1]);
});

test('tokens.css --dur-* / --ease-* equal tokens.json, each with a 来源 note', () => {
  for (const [k, ms] of Object.entries(tokens.motion.duration)) {
    const d = rootDecls[`--dur-${kebab(k)}`];
    assert.ok(d, `--dur-${kebab(k)} declared in :root`);
    assert.equal(d.value, `${ms}ms`, `--dur-${kebab(k)}`);
    assert.match(d.note, new RegExp(`来源：tokens\\.json motion\\.duration\\.${k}\\b`));
  }
  for (const [k, v] of Object.entries(tokens.motion.easing)) {
    const d = rootDecls[`--ease-${kebab(k)}`];
    assert.ok(d, `--ease-${kebab(k)} declared in :root`);
    assert.equal(d.value.replace(/\s+/g, ''), v.replace(/\s+/g, ''), `--ease-${kebab(k)}`);
    assert.match(d.note, new RegExp(`motion\\.easing\\.${k}\\b`));
  }
  // 反向：:root 里每个 --dur-* / --ease-* 都在 tokens.json 里（不许 CSS 自己多出一档）
  for (const name of Object.keys(rootDecls).filter(n => /^--(dur|ease)-/.test(n))) {
    assert.ok(name in motion.cssVars, `${name} is a motion token`);
    assert.equal(rootDecls[name].value.replace(/\s+/g, ''), motion.cssVars[name].replace(/\s+/g, ''), name);
  }
});

test('old names stay as aliases for one version (pressScale / pressIn / release / easeOut)', () => {
  assert.equal(tokens.motion.pressScale, tokens.motion.scale.press);
  assert.equal(tokens.motion.pressIn, tokens.motion.duration.press);
  assert.equal(tokens.motion.release, tokens.motion.duration.release);
  assert.equal(tokens.motion.easeOut, tokens.motion.easing.out);
  assert.equal(rootDecls['--t-press'].value, rootDecls['--dur-press'].value);
  assert.equal(rootDecls['--t-release'].value, rootDecls['--dur-release'].value);
});

test('base.css is not a second motion source (--motion-page / --reduce-motion are gone, P2-03)', () => {
  assert.deepEqual(parseTokenDecls(baseCss).map(d => d.name).filter(n => /^--(motion|reduce|dur|ease)/.test(n)), []);
});

test('css helpers name the tokens and refuse unknown keys', () => {
  assert.equal(motion.css.dur('paperOpen'), 'var(--dur-paper-open)');
  assert.equal(motion.css.ease('out'), 'var(--ease-out)');
  assert.throws(() => motion.css.dur('slow'));
  assert.throws(() => motion.css.ease('bounce'));
});

test('prefersReducedMotion is the one reduced-motion probe (P2-13) and is safe without window', () => {
  assert.equal(motion.prefersReducedMotion(null), false);
  assert.equal(motion.prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(motion.prefersReducedMotion({ matchMedia: () => { throw new Error('x'); } }), false);
});
