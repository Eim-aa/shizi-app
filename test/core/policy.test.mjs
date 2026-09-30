import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as policy from '../../src/config/policy.js';
import { checkPolicySource, checkPolicy, registeredPNumbers, PATHS } from '../../scripts/verify_copy.mjs';
import { ROOT } from './helpers.mjs';

const source = fs.readFileSync(PATHS.policy, 'utf8');
const registered = registeredPNumbers(fs.readFileSync(PATHS.pending, 'utf8'));
const copySource = JSON.parse(fs.readFileSync(PATHS.source, 'utf8'));

test('policy: `node -e "import(\'./src/config/policy.js\')"` loads', () => {
  const r = spawnSync(process.execPath, ['-e', "import('./src/config/policy.js').then(m => { if (!m.groupSize) process.exit(3); })"], { cwd: ROOT });
  assert.equal(r.status, 0, String(r.stderr));
});

test('policy: 03 registers P01–P61 (incl. P10b); the table only grows', () => {
  for (let n = 1; n <= 61; n += 1) {
    const p = 'P' + String(n).padStart(2, '0');
    assert.ok(registered.has(p), p + ' registered in 03');
  }
  assert.ok(registered.has('P10b'));
  assert.ok(registered.size >= 62, 'P01–P61 + P10b at least');
});

test('policy: every export and every nested key carries a registered P number', () => {
  const { errors, exportsFound, referenced } = checkPolicySource(source, registered);
  assert.deepEqual(errors, []);
  assert.deepEqual([...exportsFound].sort(), Object.keys(policy).sort(), 'parser saw every runtime export');
  for (const p of referenced) assert.ok(registered.has(p), p);
});

test('policy: the check catches an export without a P number', () => {
  const bad = source.replace('// P17 每字提示上限\n', '// 每字提示上限\n');
  assert.notEqual(bad, source);
  const { errors } = checkPolicySource(bad, registered);
  assert.ok(errors.some((e) => e.startsWith('policy.hintMax')), errors.join('\n'));
});

test('policy: the check catches a nested key without a P number and an unregistered P', () => {
  const noKey = source.replace('milestones: false, // P08 里程碑庆祝：删除', 'milestones: false,');
  assert.ok(checkPolicySource(noKey, registered).errors.some((e) => e.includes('features.milestones')));
  const unknown = source.replace('// P17 每字提示上限', '// P99 每字提示上限');
  assert.ok(checkPolicySource(unknown, registered).errors.some((e) => e.includes('P99')));
});

test('policy: every P in 03 is covered by policy.js, a copy decision or a non-runtime note', async () => {
  const { errors } = await checkPolicy(copySource);
  assert.deepEqual(errors, []);
});

test('policy: transitional defaults match 03 / the M0-6 card', () => {
  assert.equal(policy.groupSize, 5);
  assert.equal(policy.dailyReviewCap, 30);
  assert.deepEqual([...policy.firstQueue], ['尴', '嚏', '狩', '晤', '飓']);
  assert.equal(policy.hintMax, 2);
  assert.equal(policy.hintStartRule, 'written-count');
  assert.equal(policy.hintUseGroups, false);
  assert.equal(policy.forgetRule, 'due');
  assert.equal(policy.forgetCap, 12);
  assert.equal(policy.customIntoDaily, 'none');
  assert.equal(policy.answerSeenScope, 'none');
  assert.equal(policy.ratingWithHint, 'Good');
  assert.equal(policy.skipScope, 'session');
  assert.equal(policy.dailyExpiry, 'discard');
  assert.equal(policy.s02EndOld, 'toast');
  assert.equal(policy.monthSheetPick, 'first');
  assert.equal(policy.inkBudgetBytes, 1.5 * 1024 * 1024);
  assert.equal(policy.recordsBudgetBytes, 1.5 * 1024 * 1024);
  assert.equal(policy.migration.legacyHintedAs, 'none');
  assert.equal(policy.features.perRecordInk, false, 'card M0-6: off until D14 is lifted (P31)');
  assert.equal(policy.features.soundscape, false);
  assert.equal(policy.features.difficultyFeedback, false);
  assert.equal(policy.features.nextReviewLine, true);
  // M0 验收修复 F4：P56–P61
  assert.deepEqual([...policy.inkToneDays], [7, 30, 90], 'P56');
  assert.equal(policy.storageWarnRatio, 0.8, 'P57');
  assert.equal(policy.assumedQuotaBytes, 5 * 1024 * 1024, 'P57');
  assert.equal(policy.darkLampLevel, 0.05, 'P58');
  assert.equal(policy.darkBrightenStep, false, 'P58');
  assert.equal(policy.largeTextScale, 1.3, 'P59');
  assert.equal(policy.dailyCapCountsPicked, true, 'P60');
  assert.deepEqual({ ...policy.sessionExpiry }, { first: 'never', picked: 'never' }, 'P61');
});

test('policy: P58/P59 mirror the CSS tokens they document (tokens.css cannot import JS)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/config/tokens.css'), 'utf8');
  assert.match(css, new RegExp('--lamp:\\s*' + String(policy.darkLampLevel).replace(/^0/, '0?').replace('.', '\\.') + '\\b'), '--lamp equals policy.darkLampLevel');
  assert.match(css, new RegExp('--k:\\s*' + String(policy.largeTextScale).replace('.', '\\.') + '\\b'), 'data-large --k equals policy.largeTextScale');
});

test('policy: exported objects and arrays are frozen', () => {
  for (const [name, value] of Object.entries(policy)) {
    if (value && typeof value === 'object') assert.ok(Object.isFrozen(value), name + ' is frozen');
  }
  assert.throws(() => {
    'use strict';
    policy.features.perRecordInk = true;
  }, TypeError);
});

test('policy: core modules do not hard-code transitional values that live in policy.js', () => {
  const core = path.join(ROOT, 'src/core');
  for (const file of fs.readdirSync(core).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(core, file), 'utf8');
    assert.equal(/['"]尴['"]/.test(text), false, file + ' repeats firstQueue');
    assert.equal(/\b(?:dailyReviewCap|groupSize|hintMax|forgetCap)\s*=\s*\d/.test(text), false, file + ' re-declares a policy number');
  }
});
