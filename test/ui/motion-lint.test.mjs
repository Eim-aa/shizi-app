// 令牌门禁的 motion 规则（交互与动效规范 T2 / §8a，D58；审计 P2-15）：代码里出现令牌外的 duration / easing / transition 时长、
// 非令牌计时、手势常量字面量、减少动态效果下的硬切，scripts/verify_tokens.mjs 一律报错；例外逐条登记并写理由。
// 旧实现（10650a2）上跑这条规则：100 处违规（红）；本卡改完后 0 处（绿）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMotionUses, motionTokenDrift, MOTION_DEF_FILES, EXCEPTIONS, scan, stripComments, RULES } from '../../scripts/verify_tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kinds = src => findMotionUses(stripComments(src)).map(u => u.kind);

test('motion is one of the token rules and the repository is clean', () => {
  assert.ok(RULES.includes('motion'));
  const { violations, stale } = scan();
  assert.deepEqual(violations.filter(v => v.rule === 'motion').map(v => `${v.file}:${v.line} ${v.snippet}`), []);
  assert.deepEqual(stale.filter(e => e.rule === 'motion').map(e => `${e.file} ${e.snippet}`), []);
});

test('motion: off-token durations, curves, timers, gesture constants and hard cuts are caught (§8a table)', () => {
  assert.deepEqual(kinds('.a{animation:x .2s}'), ['css-time']);
  assert.deepEqual(kinds('.a{transition:opacity 150ms}'), ['css-time']);
  assert.deepEqual(kinds('.a{animation-delay:900ms}'), ['css-time']);
  assert.deepEqual(kinds('.a{animation:x ${T.dFade} ease-out both}'), ['css-ease']);
  assert.deepEqual(kinds('.a{transition:transform ${T.dM} cubic-bezier(.2,.7,.2,1)}'), ['css-ease']);
  assert.deepEqual(kinds('.a{animation:x ${T.dFade} linear}'), ['css-ease'], '`linear` must be var(--ease-linear)');
  assert.deepEqual(kinds('el.animate(f, { duration: 150, fill: "both" })'), ['js-duration']);
  assert.deepEqual(kinds('runProgress({ ms: 300 })'), ['js-duration']);
  assert.deepEqual(kinds("const o = { easing: 'linear' }"), ['js-easing']);
  assert.deepEqual(kinds('export const FADE_MS = 120;'), ['js-const']);
  assert.deepEqual(kinds('const p = { openMs: 420 };'), ['js-const']);
  assert.deepEqual(kinds('setTimeout(fn, 600)'), ['timer']);
  assert.deepEqual(kinds('w.setTimeout(done, FADE_MS + 90)'), ['timer']);
  assert.deepEqual(kinds('export const BACK_COMMIT_RATIO = 1 / 3;'), ['gesture']);
  assert.deepEqual(kinds('export const EDGE_ZONE_PX = 12;'), ['gesture']);
  assert.deepEqual(kinds('@media (prefers-reduced-motion: reduce){.a{animation:none}}'), ['reduced-none']);
  assert.deepEqual(kinds('el.style.animation = `szX 150ms linear`'), ['css-time']);
  assert.deepEqual(kinds('style=${{ animation: `szX ${ms}ms linear forwards` }}'), ['css-ease']);
});

test('motion: token references pass; comments do not count', () => {
  for (const ok of [
    '.a{animation:x ${T.dFade} ${T.eOut} both}', '.a{transition:opacity var(--dur-fade) var(--ease-linear)}', '.a{animation:x ${M.dur.fade}ms ${T.eLinear} ${T.dFade} both}',
    'el.animate(f, { duration: M.role.pushIn, easing: M.ease.out })', 'runProgress({ ms: spec.ms })', 'export const FADE_MS = M.role.fadeIn;',
    'setTimeout(fn, M.timing.toast)', 'setTimeout(fn, 0)', 'setTimeout(done, opts.duration + M.dur.fade)', 'writer.showCharacter({ duration: 0 })',
    'export const BACK_COMMIT_RATIO = M.gesture.commitRatio;', '@media (prefers-reduced-motion: reduce){.a{animation-duration:${T.dReduce}}}',
    'export const GLYPH_PAD_RATIO = 0.06;', '.a{background:linear-gradient(red, blue)}', '@keyframes szEase{from{opacity:0}}',
  ]) assert.deepEqual(kinds(ok), [], ok);
  assert.deepEqual(kinds('// transition: opacity 150ms ease-out\n/* setTimeout(fn, 600) */'), []);
});

test('motion: definition files are exempt; tokens.json ⇄ tokens.css do not drift', () => {
  assert.deepEqual([...MOTION_DEF_FILES], ['src/config/tokens.css', 'src/config/motion.js']);
  assert.deepEqual(motionTokenDrift(), []);
});

test('motion: every exception has a reason and still matches its file (pending ones name an audit id)', () => {
  for (const e of EXCEPTIONS.filter(x => x.rule === 'motion')) {
    assert.ok(e.why && e.why.length > 12, `${e.file}: ${e.snippet}`);
    assert.ok(fs.existsSync(path.join(ROOT, e.file)), e.file);
    if (e.pending) assert.match(e.pending, /^P[0-2]-\d\d$/, e.file);
    else assert.ok(fs.readFileSync(path.join(ROOT, e.file), 'utf8').includes(e.snippet), `${e.file}: ${e.snippet}`);
  }
});
