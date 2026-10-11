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
  // 三位编号（P100 起）也要被登记表解析到，否则不进覆盖检查。
  assert.deepEqual([...registeredPNumbers('| P100 | x |\n| P09 | y |\n| P10b | z |\n')].sort(), ['P09', 'P100', 'P10b']);
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
  // 哨兵编号取 03 里还没登记的（P99 已在 M5 登记，不能再当「未登记」用）。
  let n = 99;
  while (registered.has('P' + n)) n += 1;
  const sentinel = 'P' + n;
  const unknown = source.replace('// P17 每字提示上限', '// ' + sentinel + ' 每字提示上限');
  assert.ok(checkPolicySource(unknown, registered).errors.some((e) => e.includes(sentinel)), sentinel);
});

test('policy: every P in 03 is covered by policy.js, a copy decision or a non-runtime note', async () => {
  const { errors } = await checkPolicy(copySource);
  assert.deepEqual(errors, []);
});

test('policy: transitional defaults match 03 / the M0-6 card', () => {
  assert.equal(policy.groupSize, 5);
  assert.equal(policy.dailyReviewCap, 30);
  assert.deepEqual([...policy.firstQueue], ['尴', '赢', '拾'], 'P09 已决定 D38：首练 3 字（原旧校准组前 5：尴 嚏 狩 晤 飓）');
  assert.equal(policy.hintMax, 2);
  assert.deepEqual(
    [policy.ink.base, policy.ink.lo, policy.ink.hi, policy.ink.pressureLo, policy.ink.pressureGain, policy.ink.pressureHi],
    [11.5, 0.25, 0.9, 0.58, 0.94, 1.52],
    'P65 ink hand-feel constants (沿旧版)',
  );
  assert.ok(Object.isFrozen(policy.ink));
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
  assert.equal(policy.features.perRecordInk, true, 'P31 decided D27 (stage 1 P1-E3): per-judgment ink on (was false until D14 was lifted, card M0-6)');
  assert.equal(policy.features.soundscape, false);
  assert.equal(policy.defaultLibrary, 'core3500', 'P73 default library');
  assert.equal(policy.features.difficultyFeedback, false);
  assert.equal(policy.features.nextReviewLine, true);
  // M0 验收修复 F4：P56–P61
  assert.deepEqual([...policy.inkToneDays], [7, 30, 90], 'P56');
  assert.equal(policy.storageWarnRatio, 0.8, 'P57');
  assert.equal(policy.assumedQuotaBytes, 5 * 1024 * 1024, 'P57');
  assert.equal(policy.homeShowRecordWhileResume, undefined, 'P16 decided by the stage-1 home design (P1-E5): a group in progress shows its cells, no switch');
  assert.equal(policy.inkRowCompactMax, undefined, 'P75 decided by the stage-1 home design (P1-E5): today\'s chars use the 1–8 cell sizes, no merged compact row');
  assert.equal(policy.darkLampLevel, undefined, 'P58 decided D43: the dark warm lamp is cancelled');
  assert.equal(policy.darkBrightenStep, undefined, 'P58 decided D43: dark hint / trace / disabled colours are fixed in tokens.json, no brighten switch');
  assert.equal(policy.largeTextScale, undefined, 'P59 decided D29: no fixed in-app large scale any more');
  assert.deepEqual({ ...policy.contentSizeScale }, {
    xS: 0.82, S: 0.88, M: 0.94, L: 1, XL: 1.12, XXL: 1.24, XXXL: 1.35, AX1: 1.6, AX2: 1.8, AX3: 2, AX4: 2.2, AX5: 2.4,
  }, 'P130 Dynamic Type mapping (D29)');
  assert.equal(policy.compactTextScale, 1.3, 'P131');
  assert.equal(policy.dailyCapCountsPicked, true, 'P60');
  assert.deepEqual({ ...policy.sessionExpiry }, { first: 'never', picked: 'never' }, 'P61');
  // M2-H：P69 / P70 迁入 policy（值不变）
  assert.equal(policy.compactMaxHeight, 760, 'P69');
  assert.deepEqual({ ...policy.mainButtonLine }, { gapAboveEdge: 24 }, 'P258 主按钮底线：安全区 / Tab 栏上沿往上 24（写字页与首页共用）');
  assert.equal(policy.writeGrid.footBottomMin, 8, 'P260 底栏下内边距回到 max(8, 下安全区)（写字页底栏有文字行，不再用 24 的主按钮底线）');
  assert.deepEqual(
    { ...policy.writeGrid },
    { min: 258, max: 400, sideMargin: 20, promptGap: 16, toolsHeight: 40, axMin: 220, axNoteHeight: 56, axAux: { pinyin: [22, 28], note: [17, 22], progress: [17, 22], title: [17, 22], links: [17, 22], paper: [22, 28] }, axPromptScaleMax: 1.6, bottomGap: 16, topShare: 0.4, topMin: 12, nominalHead: 44, nominalFoot: 116, footBottomMin: 8, nominalPrompt: 80 },
    'P118 D36 / D49（E9b：实现交接 §13.2 的整组居中公式）',
  );
  assert.deepEqual(
    { ...policy.motion },
    { answerSpeed: 1.6, answerStrokeGapMs: 180, answerFadeMs: 240, hintStrokeMs: 240, hintStagger: 0.7, reducedFadeMs: 120, persistNoticeMs: 5000, hintFadeInMs: 150, answerRevealMs: 400, stepPlayMaxMs: 1600 },
    'P70 + P210（W1：提示整组淡入 150、答案衬底显影 400、笔顺快放 ≤ 1600）',
  );
});

test('policy: --k defaults to 1 = contentSizeScale.L (P130); the P58 lamp token is gone (D43)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/config/tokens.css'), 'utf8');
  assert.ok(!/--lamp/.test(css), 'no --lamp token');
  assert.match(css, /--k:\s*1;/, 'tokens.css --k default 1');
  assert.equal(policy.contentSizeScale.L, 1, 'system default size maps to the same 1');
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

test('policy: P69 / P70 modules read their defaults from policy.js (M2-H)', async () => {
  const glyph = await import('../../src/ui/canvas/glyph.js');
  const hint = await import('../../src/ui/screens/write/hint-layer.js');
  const compact = await import('../../src/ui/screens/write/compact.js');
  const persist = await import('../../src/ui/screens/write/persist.js');
  assert.equal(compact.COMPACT_MAX_HEIGHT, policy.compactMaxHeight);
  assert.equal(compact.COMPACT_QUERY, `(max-height: ${policy.compactMaxHeight}px)`);
  assert.equal(compact.GRID_MIN, policy.writeGrid.min);
  assert.equal(compact.GRID_MAX, policy.writeGrid.max);
  assert.deepEqual({ ...glyph.ANIMATION }, {
    strokeAnimationSpeed: policy.motion.answerSpeed,
    delayBetweenStrokes: policy.motion.answerStrokeGapMs,
    strokeFadeDuration: policy.motion.answerFadeMs,
  });
  assert.equal(hint.HINT_DRAW.maxMs, policy.motion.hintStrokeMs);
  assert.equal(hint.HINT_DRAW.stagger, policy.motion.hintStagger);
  assert.equal(hint.REDUCED_FADE_MS, policy.motion.reducedFadeMs);
  assert.equal(persist.NOTICE_MS, policy.motion.persistNoticeMs);
  // 仍可覆盖
  assert.equal(hint.strokeDrawMs(1, { hintStrokeMs: 150 }), 150);
  assert.equal(hint.hintTimeline(2, { hintStagger: 1 }).items[1].delay, hint.strokeDrawMs(2));
  for (const file of ['src/ui/canvas/glyph.js', 'src/ui/screens/write/hint-layer.js', 'src/ui/screens/write/compact.js', 'src/ui/screens/write/persist.js']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(/\b(?:COMPACT_MAX_HEIGHT|GRID_MIN|GRID_MAX|REDUCED_FADE_MS|NOTICE_MS)\s*=\s*\d/.test(text), false, file + ' re-declares a P69/P70/P118 number');
    assert.equal(/\b(?:strokeAnimationSpeed|delayBetweenStrokes|strokeFadeDuration|maxMs|stagger):\s*\d/.test(text), false, file + ' hard-codes a P70 number');
  }
});
