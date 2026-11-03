// QA-H4：对比器误报的通用规则（ios/ShiziApp/scripts/native-ui/graphics.mjs）——每条一个「误报消失」+ 一个「真差异仍被报」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffDecos, diffGraphics, diffRules, iconVisibilityDiffers, inkMetrics, judgeInk, lazyPlaceholder, ownerOf, pairCells, reachesTabBar, settleBorderline, tabBarTop } from '../ios/ShiziApp/scripts/native-ui/graphics.mjs';

const tol = { pos: 3, size: 3, textHeight: 4, color: 8, font: 0.5, weight: 0.1 };
const f = (x, y, w, h) => ({ x, y, w, h });
const LINE = '#DDD5C7FF';
const el = (key, frame, extra = {}) => ({ key, frame, kind: 'view', ...extra });

// ── Tab 栏的东西归 Tab 项 ──
const webEls = [
  el('version-text', f(0, 700, 402, 200)), // 一直铺到屏底的页面元素
  el('tab-home', f(0, 791, 134, 83)), el('tab-library', f(134, 791, 134, 83)), el('tab-mine', f(268, 791, 134, 83)),
];
const natEls = [
  el('version-text', f(0, 700, 402, 90)),
  el('tab-home', f(20, 800, 120, 60)), el('tab-library', f(140, 800, 120, 60)), el('tab-mine', f(260, 800, 120, 60)),
];

test('tab bar: the top hairline and icons inside the tab bar belong to a tab item, not to the page element that overlaps it', () => {
  assert.equal(tabBarTop(webEls), 791);
  assert.equal(ownerOf({ x: 201, y: 791.2 }, webEls).key, 'tab-library');
  assert.equal(ownerOf({ x: 40, y: 830 }, webEls).key, 'tab-home');
  // 在 Tab 栏上面的点仍归页面元素
  assert.equal(ownerOf({ x: 201, y: 750 }, webEls).key, 'version-text');
  const d = diffRules([{ ...f(0, 791, 402, 0.3), color: LINE }], [], tol, { web: webEls, native: natEls, pairs: [] });
  assert.equal(d.length, 1);
  assert.equal(d[0].label, 'tab-library'); // 具名豁免 TAB-01 认这个标签
});

test('tab bar: the shared tab top uses the smaller of both sides (floating glass bar is shorter than the web bar)', () => {
  const g = diffGraphics({ rules: [{ ...f(0, 791, 402, 0.3), color: LINE }], decos: [], cells: [] }, { rules: [], decos: [], cells: [] }, tol, { web: webEls, native: natEls, pairs: [] });
  assert.equal(g.diffs.length, 1);
  assert.equal(g.diffs[0].label, 'tab-library');
});

test('tab bar: a missing line above the tab bar is still attributed to its page element and still reported', () => {
  const d = diffRules([{ ...f(0, 750, 402, 1), color: LINE }], [], tol, { web: webEls, native: natEls, pairs: [] });
  assert.equal(d.length, 1);
  assert.equal(d[0].label, 'version-text');
});

test('tab bar: a missing icon inside the tab bar is attributed to the tab item', () => {
  const d = diffDecos([{ kind: 'icon', ...f(55, 796, 24, 24) }], [], tol, { web: webEls, native: natEls, pairs: [] });
  assert.equal(d.length, 1);
  assert.equal(d[0].label, 'tab-home');
});

// ── 图标「看得见」的滞回 ──
test('icon visibility: 7 vs 5 ink points around minInk=6 is not a presence difference; a really missing icon still is', () => {
  assert.equal(iconVisibilityDiffers(7, 5), false);
  assert.equal(iconVisibilityDiffers(5, 7), false);
  assert.equal(iconVisibilityDiffers(8, 4), false); // 相差 4 = 2 × 滞回：仍算抖动
  assert.equal(iconVisibilityDiffers(30, 0), true);
  assert.equal(iconVisibilityDiffers(12, 2), true);
  assert.equal(iconVisibilityDiffers(2, 12), true);
  assert.equal(iconVisibilityDiffers(40, 20), false); // 两边都看得见
  assert.equal(iconVisibilityDiffers(1, 3), false); // 两边都看不见
});

// ── 网页懒加载 canvas 的 2:1 占位 ──
test('lazy placeholders: an offscreen web canvas that is still the default 2:1 box pairs with the native cell by centre x and top edge', () => {
  const web = [{ kind: 'ink', ...f(21.8, 1812, 41.7, 20.8), off: true }];
  const native = [{ kind: 'ink', ...f(21.8, 1812.1, 41.6, 41.6), off: true }];
  assert.equal(lazyPlaceholder(web[0]), true);
  const r = pairCells(web, native, tol);
  assert.deepEqual(r.diffs, []);
  assert.equal(r.pairs.length, 1);
});

test('lazy placeholders: only offscreen 2:1 boxes get the rule; on-screen cells and a wrongly placed native cell are still reported', () => {
  assert.equal(lazyPlaceholder({ kind: 'ink', ...f(0, 0, 41.7, 20.8) }), false); // 屏上
  assert.equal(lazyPlaceholder({ kind: 'ink', ...f(0, 0, 41.6, 41.6), off: true }), false); // 不是 2:1
  const web = [{ kind: 'ink', ...f(21.8, 1812, 41.7, 20.8), off: true }];
  const moved = [{ kind: 'ink', ...f(21.8, 1830, 41.6, 41.6), off: true }]; // 顶边差 18pt：真的位置错了
  assert.ok(pairCells(web, moved, tol).diffs.length >= 1);
  const onScreen = pairCells([{ kind: 'ink', ...f(21.8, 100, 41.7, 20.8) }], [{ kind: 'ink', ...f(21.8, 100, 41.6, 41.6) }], tol);
  assert.equal(onScreen.pairs.length, 0); // 屏上的 2:1 格不适用占位规则
});

// ── 方框的上下边线不错配（年报「同字两次」AX 档） ──
test('rules: a box whose native frame sits 2.1pt below the web one compares edge to edge (no 141pt vertical diff), and a really missing bottom edge is still reported', () => {
  const box = (y, c) => [{ ...f(131, y, 140, 1), color: c }, { ...f(131, y + 139, 140, 1), color: c }, { ...f(131, y, 1, 140), color: c }, { ...f(270, y, 1, 140), color: c }];
  const web = box(1926.4, '#95826BFF'), native = box(1928.5, '#95826BFF');
  const cells = { web: [{ kind: 'ink', ...f(131, 1926.4, 140, 140) }], native: [{ kind: 'ink', ...f(131, 1928.5, 140, 140) }] };
  const els = { web: [], native: [], pairs: [], cells };
  assert.deepEqual(diffRules(web, native, tol, els), []);
  const broken = native.filter((_, i) => i !== 1); // 原生少了下边线
  const d = diffRules(web, broken, tol, els);
  assert.equal(d.length, 1);
  assert.match(d[0].msg, /原生缺少线/);
});

// ── 墨掩膜的缓冲带 ──
const mask = (n, rows) => { const a = Array(n * n).fill('0'); for (const [j, i, ch] of rows) a[j * n + i] = ch; return a.join(''); };
test('ink bands: a pixel that flips only inside both sides borderline band is not a difference; a one-sided or clearly different stroke still is', () => {
  const n = 32;
  const core = [...Array(12).keys()].map(i => [10, 8 + i, '1']).concat([...Array(12).keys()].map(i => [20, 8 + i, '1']));
  const web = mask(n, [...core, [2, 6, 'c'], [3, 25, 'c'], [27, 14, 'c']]); // 网页：这几个点略低于截止值
  const nativeFaint = mask(n, [...core, [2, 6, 'b'], [3, 25, 'b'], [27, 14, 'b']]); // 原生：略高于截止值（淡字压在截止值上）
  assert.deepEqual(judgeInk(inkMetrics(web, nativeFaint, n, 225), 225), []);
  // 同样的几个点网页明显没墨（'0'）、原生算墨：不是缓冲带里的翻转，仍然进外框
  const clearWeb = mask(n, core);
  const strongRows = [...Array(16).keys()].flatMap(i => [[2, 6 + i, '1'], [3, 6 + i, '1']]);
  assert.ok(judgeInk(inkMetrics(clearWeb, mask(n, [...core, ...strongRows]), n, 225), 225).length > 0);
  // 一边缓冲带里算墨、另一边明显没墨：带不是通行证，这几个点留着
  const [, kept] = settleBorderline(clearWeb, nativeFaint);
  assert.equal([...kept].filter(c => c === '1').length, 24 + 3);
  // 缺一整笔仍然报
  assert.ok(judgeInk(inkMetrics(web, mask(n, core.slice(0, 12)), n, 225), 225).length > 0);
});

test('tab bar: frames crossing the tab bar top are detected (cells / text under the bar are not pixel-compared)', () => {
  assert.equal(reachesTabBar(f(21, 757.3, 90, 90), 791), true);
  assert.equal(reachesTabBar(f(21, 600, 90, 90), 791), false);
  assert.equal(reachesTabBar(f(21, 600, 90, 191), 791), false); // 恰好贴着上沿
  assert.equal(reachesTabBar(f(21, 757.3, 90, 90), null), false);
});
