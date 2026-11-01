// D80 ②（B4.9a）：App 里 createAppApi 的 ctx.now 用 App 时钟（env.now），与 store 同一个「现在」——测试宿主钉住时钟后，
// 字详情的「今天」与阻断页导出备份的日期跟着钉住的时钟走，不再取墙上时钟（ShiziCore 同改：SessionActionHooks.now 缺省 = store.now()）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeStage } from '../../src/ui/native-stage.js';
import { setClockOverride } from '../../src/platform/env.js';

test('the App API context clock is the app clock (a pinned test clock reaches block.export), not the wall clock', async () => {
  const store = { getState: () => ({}), serial: 0, status: { available: true }, subscribe: () => () => {} };
  const win = { __shiziNative: true, __shiziNativeWriteForce: true };
  installNativeStage(win, { getStore: () => store, native: true });
  setClockOverride('2031-02-03T10:00:00+08:00');
  try {
    const r = await win.shiziNative('block.export', {});
    assert.equal(r.ok, true);
    assert.match(r.name, /2031-?02-?03/, r.name);
  } finally {
    setClockOverride(null);
  }
});
