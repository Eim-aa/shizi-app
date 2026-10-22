// B2.9b：QA 固定时钟跨杀进程重开（iOS DEBUG 壳在 documentStart 注入 window.__shiziQAClockOffset），只在测试宿主生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import { injectedClockOffset } from '../../src/platform/env.js';

const host = (extra = {}) => ({ location: { search: '?test=1', hostname: 'app' }, __shiziNativeDev: true, ...extra });

test('injectedClockOffset: test host with an injected offset uses it', () => {
  assert.equal(injectedClockOffset(host({ __shiziQAClockOffset: -86400000 })), -86400000);
});

test('injectedClockOffset: no offset / bad value → 0', () => {
  assert.equal(injectedClockOffset(host()), 0);
  assert.equal(injectedClockOffset(host({ __shiziQAClockOffset: 'x' })), 0);
  assert.equal(injectedClockOffset(null), 0);
});

test('injectedClockOffset: never outside the test host (release shell, no test=1)', () => {
  assert.equal(injectedClockOffset({ location: { search: '', hostname: 'app' }, __shiziNativeDev: true, __shiziQAClockOffset: 5000 }), 0);
  assert.equal(injectedClockOffset({ location: { search: '?test=1', hostname: 'app' }, __shiziQAClockOffset: 5000 }), 0);
});
