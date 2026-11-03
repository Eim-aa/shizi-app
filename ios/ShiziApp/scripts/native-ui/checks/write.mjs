// QA-H1：逐屏对比里的「具名检查」——只判原生自身的性质（不依赖网页参考）。
// D84：网页参考退役后，原来与网页对照的 NP-* 检查（位置 / 字号 / 颜色 / 墨区 IoU 与网页一致）由「逐屏对冻结的原生基线」的元素与图形对比接手，
// 这里留下的是基线之外还要单独判的原生性质：AX 档不溢出、浮条与主按钮分开、看答案后题面空格有字、改判弹层满宽贴底、书写格有格底与辅助线、判断页两格方角。
//
// status：
//   'expected-fail'  已知问题、待修复卡转绿。失败 = 「预期失败（待修）」，不算回归；通过 = 「意外通过」，提示把 status 改成 'pass'。
//   'pass'           应当通过；失败 = 回归。
// 每条 eval(ctx) 返回 {pass, detail}；ctx = {state, tag, appearance, size, web, native, px:{web, native}, screen, tolerance}。
//   native：这一次的元素（配好语义键）；web：基线一侧的元素（历史命名，当前检查不用）；px：在截图上的取样（compare.mjs 用 Playwright 读像素）。
// NP-01（修改 › 热区）、NP-06（判断失败三段式）要真实点按，写在 XCUITest（ShiziUITests/KnownIssueTests.swift）。

import { readFileSync } from 'node:fs';
import { colorDelta, contrastRatio, normText } from '../elements.mjs';
import { STATES } from '../config.mjs';
import { KNOWN_OVERLAPS, evalAx01 } from './ax01.mjs';

// 设计令牌（唯一来源）：L4-01 用主按钮实心底 btnBg 与门槛 toastVsPrimary（D71 ③）
const TOKENS = JSON.parse(readFileSync(new URL('../../../../../docs/design/design-system-v1/tokens.json', import.meta.url), 'utf8'));

const byKey = (list, key) => list.find(e => e.key === key);
const byText = (list, re) => list.find(e => re.test(normText(e.text)));
const close = (a, b, tol) => a !== undefined && b !== undefined && Math.abs(a - b) <= tol;
const fmt = f => (f ? `(${f.x}, ${f.y}) ${f.w}×${f.h}` : '无');

export const CHECKS = [
  {
    // B2.9b：AX 档不溢出（交互规范 A1「不截断、不省略号」）——原生每个文字 / 按钮：字没被截断（行数够、单行放得下）、没被祖先裁掉（滚动区里滚得到的不算）、
    // 不伸出屏幕左右；同一层里（页面 / 弹层 / 确认框 / 撤销条各算一层，浮层按设计盖在页面上）文字与按钮互不重叠（重叠面积 > 1pt²）。
    id: 'AX-01', status: 'pass', level: '高', title: 'AX 档不溢出：文字完整可见、不截断、不互相压住',
    states: STATES, sizes: ['AX3', 'AX5'],
    eval({ native, state }) {
      const r = evalAx01(native, KNOWN_OVERLAPS[state] || []);
      return { pass: r.pass, detail: r.detail };
    },
  },
  {
    id: 'NP-03', status: 'pass', level: '高', title: '看答案后（描一遍）题面空格里显示答案字',
    states: ['trace'],
    eval({ px }) {
      const n = px.native.blankInk;
      return { pass: n >= 8, detail: `空格里墨点像素 ${n}（≥ 8）` };
    },
  },
  {
    id: 'NP-04', status: 'pass', level: '高', title: '改判弹层有「看这个字 ›」',
    states: ['change-sheet'],
    eval({ native }) {
      const n = byText(native, /^看这个字/);
      return { pass: !!n, detail: n ? '有' : '无' };
    },
  },
  {
    id: 'NP-05', status: 'pass', level: '高', title: '书写格有纸色格底与十字辅助线',
    states: ['recall', 'trace', 'retrace', 'redo'], // 判断页 / 重写核对页是两格共用格线，没有十字辅助线
    eval({ px }) {
      const n = px.native;
      return { pass: !!n.gridBg && n.guide > 0, detail: `格底 ${n.gridBg}；辅助线像素 ${n.guide}` };
    },
  },
  {
    id: 'NP-10', status: 'pass', level: '中', title: '改判弹层是满宽贴底抽屉',
    states: ['change-sheet'],
    eval({ native, screen }) {
      const n = byKey(native, 'sheet');
      if (!n) return { pass: false, detail: '原生没有找到弹层视图' };
      const full = close(n.frame.x, 0, 1) && close(n.frame.w, screen.w, 1) && close(n.frame.y + n.frame.h, screen.h, 1);
      return { pass: full, detail: `弹层 ${fmt(n.frame)} 底 ${n.bg || '无'}` };
    },
  },
  {
    id: 'NP-13', status: 'pass', level: '中', title: '判断页两格方角、共用格线',
    states: ['judge', 'last-judge'],
    eval({ native }) {
      const bad = [];
      for (const k of ['grid', 'ref-grid']) {
        const n = byKey(native, k);
        if (!n) { bad.push(`${k} 原生无`); continue; }
        if ((n.radius || 0) > 0.5) bad.push(`${k} 原生圆角 ${n.radius}`);
      }
      return { pass: !bad.length, detail: bad.join('；') || '两格方角' };
    },
  },
  {
    id: 'L4-01', status: 'pass', level: '高', title: '浮条底色 ≠ 主按钮底色，且两者色差足够大（对比度 ≥ toastVsPrimary）；浮条圆角大于主按钮（D71 ③）',
    states: ['skip-undo'],
    eval({ native, appearance }) {
      const minRatio = TOKENS.color.contrast.thresholds.toastVsPrimary;
      const btnBg = (TOKENS.color[appearance] || {}).btnBg;
      const bad = [], info = [];
      const bar = byKey(native, 'undo-bar');
      if (!bar || !bar.bg) return { pass: false, detail: '没有撤销条或取不到底色' };
      const primary = byKey(native, 'primary');
      // 主按钮实心底：令牌 btnBg；同屏主按钮可点时再拿它的实际底色比一次（不可点时是 field 底，不代表主按钮的实心色）
      const refs = [['btnBg', `${btnBg}FF`]];
      if (primary && primary.enabled && primary.bg) refs.push(['同屏主按钮', primary.bg]);
      for (const [name, c] of refs) {
        const r = contrastRatio(bar.bg, c);
        const same = colorDelta(bar.bg, c) === 0;
        if (same || r === null || r < minRatio) bad.push(`浮条 ${bar.bg} 对${name} ${c} 对比度 ${r === null ? '?' : r.toFixed(2)}${same ? '（同色）' : ''} < ${minRatio}`);
        else info.push(`对${name} ${r.toFixed(1)}`);
      }
      const pr = (primary && primary.radius) || 12;
      if (!((bar.radius || 0) > pr)) bad.push(`浮条圆角 ${bar.radius || 0} 不大于主按钮 ${pr}`);
      return { pass: !bad.length, detail: bad.join('；') || info.join('，') };
    },
  },
];

/** 报告里 NP 编号的覆盖说明（没写成逐屏检查的条目在哪里）。 */
export const COVERED_ELSEWHERE = {
  'NP-01': 'XCUITest KnownIssueTests.testNP01_changeLinkWholeHitArea（真实点按「修改 ›」44pt 热区上沿；R9-B 修好，普通断言）',
  'NP-06': 'XCUITest KnownIssueTests.testNP06_judgeSaveFailureThreeSteps（-shizi-qa-fail-next 注入写失败）',
  'NP-02 / 07 / 08 / 09 / 11 / 12 / 14–20 / 22 / 37 / 38': '随网页参考退役（D84）：位置、字号、颜色、墨区与墨粗细由逐屏对冻结基线的元素与图形对比（含墨格掩膜）守',
};
