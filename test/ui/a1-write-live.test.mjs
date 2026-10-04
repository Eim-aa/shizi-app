// R2-A1（A2-06；03 P231）：书写格读屏名称带笔数，抬笔 / 撤销 / 清空 / 提示 / 描一遍经 aria-live=polite 区域播报；不在 pointermove 播报。
// 渲染后的真实行为见 e2e 89-a1-grid-sr；这里是纯函数与接线（单测没有 DOM）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  gridLabel, hintAnnouncement, strokeAnnouncement, strokeRangeText, traceAnnouncement,
} from '../../src/ui/screens/write/sr-live.js';

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

test('书写格读屏名称：没写是「书写格」，写了带笔数', () => {
  assert.equal(gridLabel(0), '书写格');
  assert.equal(gridLabel(1), '书写格，已写 1 笔');
  assert.equal(gridLabel(3), '书写格，已写 3 笔');
  assert.equal(gridLabel(undefined), '书写格');
});

test('笔数变化的播报句：抬笔、撤销、撤销到空、清空、恢复；没变化不播', () => {
  assert.equal(strokeAnnouncement(2, 3), '已写 3 笔');
  assert.equal(strokeAnnouncement(0, 1), '已写 1 笔');
  assert.equal(strokeAnnouncement(3, 2), '撤销了一笔，还有 2 笔');
  assert.equal(strokeAnnouncement(1, 0), '撤销了一笔，格子是空的');
  assert.equal(strokeAnnouncement(4, 0), '已清空');
  assert.equal(strokeAnnouncement(0, 4), '恢复了，现在是 4 笔');
  assert.equal(strokeAnnouncement(3, 3), '');
});

test('笔序读法：没有笔画名称数据，一律「第 n 笔」；提示 / 描一遍的播报句', () => {
  assert.equal(strokeRangeText(3, 4), '第 4 笔');
  assert.equal(strokeRangeText(3, 5), '第 4 到第 5 笔');
  assert.equal(strokeRangeText(0, 13), '第 1 到第 13 笔');
  assert.equal(strokeRangeText(5, 5), '');
  assert.equal(hintAnnouncement({ from: 3, to: 5 }), '提示画出了第 4 到第 5 笔');
  assert.equal(hintAnnouncement({ from: 0, to: 1 }), '提示画出了第 1 笔');
  assert.equal(hintAnnouncement(null), '');
  assert.equal(traceAnnouncement(13), '描一遍：参考字形画出了第 1 到第 13 笔');
  assert.equal(traceAnnouncement(0), '描一遍：参考字形出现了');
});

test('写字页接线：书写格名称用 gridLabel(笔数)；播报区挂在页根（不在淡化快照里）；播报区是 aria-live=polite 的 status', () => {
  const index = read('src/ui/screens/write/index.js');
  assert.match(index, /label=\$\{gridLabel\(view\.strokes\.length\)\}/);
  assert.match(index, /useWriteAnnounce\(\{/);
  assert.match(index, /\$\{announce\.node\}\s*\n\s*\$\{skip\.bar\}/);
  const live = read('src/ui/screens/write/sr-live.js');
  assert.match(live, /role="status" aria-live="polite" aria-atomic="true" data-testid="write-sr-status"/);
});

test('播报只由笔数 / 提示次数 / 描一遍状态触发，不挂任何 pointer 事件', () => {
  const live = read('src/ui/screens/write/sr-live.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(live, /pointermove|onpointer|addEventListener/);
  assert.match(live, /\[key, strokeCount, hintRun\]/);
});
