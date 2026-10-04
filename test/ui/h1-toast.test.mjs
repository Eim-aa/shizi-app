// H1-5（I2-04）：Toast 不盖页面的主操作——放置规则的纯函数（真实包围盒不相交见 e2e 81-h1-toast）。
//   规则：Toast 默认在距底 110 + 安全区（Tab 条上方）；如果这个默认位置的竖向范围与当前页某个主操作（主按钮）相交，就整条抬到该主操作上沿之上 12；
//   不相交（主操作在别处）就不动。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOAST_ANCHOR_GAP, toastBottom } from '../../src/ui/components/Toast.js';

// 视口 874 高、安全区 34：默认 bottom = 110 + 34 = 144；Toast 高 48 → 默认占 [682, 730]（自上而下坐标）
const base = { appHeight: 874, defaultBottom: 144, toastHeight: 48 };

test('没有主操作 / 主操作在别处：不动（默认位置）', () => {
  assert.equal(toastBottom({ ...base, anchors: [] }), 144);
  assert.equal(toastBottom({ ...base, anchors: [{ top: 100, bottom: 154 }] }), 144, '主操作在顶部：不相交');
  assert.equal(toastBottom({ ...base, anchors: [{ top: 780, bottom: 834 }] }), 144, '主操作在 Tab 条里 / 默认位置下面：不相交');
});

test('首页：主按钮 706–760 与默认位置 [682, 730] 相交 → 整条抬到主按钮上沿之上 12', () => {
  const bottom = toastBottom({ ...base, anchors: [{ top: 706, bottom: 760 }] });
  assert.equal(TOAST_ANCHOR_GAP, 12);
  assert.equal(bottom, 874 - 706 + 12, 'Toast 下沿 = 主按钮上沿 − 12');
  const toastBottomEdge = 874 - bottom;
  assert.ok(toastBottomEdge <= 706 - 12 + 1e-9, 'Toast 的下沿在主按钮上沿之上至少 12');
});

test('多个主操作：避开最靠上的那个相交的', () => {
  const bottom = toastBottom({ ...base, anchors: [{ top: 706, bottom: 760 }, { top: 690, bottom: 700 }] });
  assert.equal(bottom, 874 - 690 + 12);
});

test('抬起后若又压到更上面的主操作，继续往上让（最多迭代到不相交）', () => {
  const bottom = toastBottom({ ...base, anchors: [{ top: 706, bottom: 760 }, { top: 640, bottom: 690 }] });
  const topEdge = 874 - bottom - 48;
  const bottomEdge = 874 - bottom;
  for (const a of [{ top: 706, bottom: 760 }, { top: 640, bottom: 690 }]) {
    assert.ok(bottomEdge <= a.top - 12 + 1e-9 || topEdge >= a.bottom, `不压住 ${a.top}–${a.bottom}`);
  }
});

test('坏输入：缺高度 / 非数字锚点按没有处理', () => {
  assert.equal(toastBottom({ appHeight: 0, defaultBottom: 144, toastHeight: 48, anchors: [{ top: 1, bottom: 2 }] }), 144);
  assert.equal(toastBottom({ ...base, anchors: [{ top: NaN, bottom: 700 }, null] }), 144);
});
