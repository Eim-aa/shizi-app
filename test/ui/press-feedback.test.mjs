// 阶段 0 卡 P0-A · A4（G16）按压反馈：Button 用 pointerdown / pointerup / pointercancel / pointerleave 切 data-pressed
// （不依赖 :active，iOS WebKit 上 :active 需要 touchstart 监听才生效）。纯逻辑单测；真实样式与减少动态效果见 e2e 65-p0a-shell。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pressFeedbackHandlers, PRESS_IN_MS, PRESS_OUT_MS } from '../../src/ui/components/Button.js';

function fakeEl() {
  const attrs = new Map();
  return {
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: k => attrs.delete(k),
    getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
  };
}

test('pointerdown sets data-pressed; pointerup / pointercancel / pointerleave each clear it', () => {
  const h = pressFeedbackHandlers(() => false);
  for (const up of ['onpointerup', 'onpointercancel', 'onpointerleave']) {
    const el = fakeEl();
    h.onpointerdown({ currentTarget: el });
    assert.equal(el.getAttribute('data-pressed'), 'true', `${up}: set on pointerdown`);
    h[up]({ currentTarget: el });
    assert.equal(el.getAttribute('data-pressed'), null, `${up}: cleared`);
  }
});

test('a disabled button never gets data-pressed', () => {
  const h = pressFeedbackHandlers(() => true);
  const el = fakeEl();
  h.onpointerdown({ currentTarget: el });
  assert.equal(el.getAttribute('data-pressed'), null);
});

test('handlers are lowercase on* props (Preact keeps un-lowercased names for events the element lacks)', () => {
  const h = pressFeedbackHandlers(() => false);
  assert.deepEqual(Object.keys(h).sort(), ['onpointercancel', 'onpointerdown', 'onpointerleave', 'onpointerup']);
});

test('timing constants: press 80ms in, 160ms rebound (ADA A4)', () => {
  assert.equal(PRESS_IN_MS, 80);
  assert.equal(PRESS_OUT_MS, 160);
});
