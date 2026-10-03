// 阶段 0 卡 P0-A · A3（G15）笔锋门控：飞白 / 洇墨只由「减少动态效果」与显式 policy 开关控制，不再看
// navigator.hardwareConcurrency / deviceMemory（iOS WebKit 为防指纹会钳低这两个值，真机可能把细节全部关掉）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { brushDetailEnabled } from '../../src/ui/canvas/brush.js';
import * as policy from '../../src/config/policy.js';

test('hardwareConcurrency=2 / deviceMemory=2 no longer switch the brush detail off', () => {
  assert.equal(brushDetailEnabled({ reducedMotion: false, hardwareConcurrency: 2, deviceMemory: 2 }), true);
  assert.equal(brushDetailEnabled({ hardwareConcurrency: 1, deviceMemory: 0.5 }), true);
  assert.equal(brushDetailEnabled({ hardwareConcurrency: 8, deviceMemory: 8 }), true);
});

test('reduced motion turns the detail off, whatever the hardware says', () => {
  assert.equal(brushDetailEnabled({ reducedMotion: true }), false);
  assert.equal(brushDetailEnabled({ reducedMotion: true, hardwareConcurrency: 8, deviceMemory: 8 }), false);
});

test('explicit switch (policy.brushDetail) can turn it off; default on', () => {
  assert.equal(brushDetailEnabled(), true);
  assert.equal(brushDetailEnabled({ enabled: true }), true);
  assert.equal(brushDetailEnabled({ enabled: false }), false);
  assert.equal(brushDetailEnabled({ enabled: false, reducedMotion: false, hardwareConcurrency: 8 }), false);
});

test('policy.brushDetail exists and is on by default (P111)', () => {
  assert.equal(policy.brushDetail, true);
});
