// 阶段 1 P1-E4：D41 配比与评级相关的 policy 取值（P125 groupMix、P126 warmup、P127 ratingFirstCorrect；03 登记与 policy.js 注释的一致性由 policy.test.mjs 统一检查）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';

test('policy D41: groupMix (P125) matches the recommendation in 复习新字配比-研究与推荐.md §6.1', () => {
  assert.deepEqual(
    { ...policy.groupMix },
    {
      baseSize: 5, newMax: 3, threeNewBelowDays: 0.5, threeNewMinAccuracy: 0.6, twoNewBelowDays: 1.5, valveDays: 4, valveReleaseDays: 2, reviewsPerGroupForPressure: 4,
      pressureWindowDays: 7, recentNewWindow: 10, newAccuracyPrior: 0.5, allAccuracyPrior: 0.7, accuracyPriorWeight: 2, returnAfterDays: 7, returnGroupSize: 3,
      earlyReviewFill: true, earlyCountsTowardCap: false,
    },
  );
  assert.ok(Object.isFrozen(policy.groupMix));
  assert.equal(policy.groupMix.baseSize, 5, 'the counts are written for groups of 5 and scaled by size / 5 (D65 #2)');
  assert.equal(policy.groupSize, 20, 'D65 #2: default per-group size 20');
  assert.deepEqual([...policy.groupSizeOptions], [5, 10, 20, 30]);
  assert.equal(policy.dailyReviewCap, 30, 'P03 stays as a safety net');
});

test('policy D41: warmup gate (P126) and first-correct rating (P127)', () => {
  assert.deepEqual({ ...policy.warmup }, { mode: 'gated', firstDays: 7, accuracyBelow: 0.6, window: 10, perGroupMax: 1, easyOnCorrect: true });
  assert.ok(Object.isFrozen(policy.warmup));
  assert.equal(policy.ratingFirstCorrect, 'Easy');
  assert.deepEqual({ first: [...policy.ratingWithHint.first], review: [...policy.ratingWithHint.review] }, { first: ['Good', 'Hard', 'Again'], review: ['Hard', 'Hard', 'Again'] }, 'P34 D65 #4');
});
