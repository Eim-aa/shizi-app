// 阶段 1 E9b（D49 实现交接 §13.2 / §9.1 / §9.4；P118 / P151 / P190）：写字页整组居中、书写格边长与判断页两格边长的纯函数。
// 期望值按公式写死（原取自设计稿实现交接 §13.2 / §9.1 的表）：主区高 = 屏高 − 状态栏 − 页头 44 − 按钮行。
// W2（D57，A7，P280）起按钮行 = 上 12 + 求助行 48 + 间 20 + 主按钮 54 + 下安全区（原 12 + 54 + 6 + 文字行 44），格下总高 T = 撤销 / 清空行 48 + 说明位 40 = 88（原 40）：
//   iPhone 17 402×874（状态栏 54、下 34）：主区 608（原 626）；SE 3 375×667（20、8）：461（原 479）；Pro Max 440×956（62、34）：682（原 700）。题面高 P = 80。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeGridSize, writeLayout, axWriteLayout, AX_GRID_MIN, AX_BELOW_H, nominalMainHeight, groupTop, judgePairSize, judgeAxLayout, estimateLayout, GRID_MIN, GRID_MAX, JUDGE_MIN, COMPARE_GAP,
} from '../../src/ui/screens/write/layout.js';

const mainOf = (h, sb, bot) => h - sb - 44 - (12 + 48 + 20 + 54 + bot);

test('the design sheet numbers: main areas of the three reference phones', () => {
  assert.equal(mainOf(874, 54, 34), 608);
  assert.equal(mainOf(667, 20, 8), 461);
  assert.equal(mainOf(956, 62, 34), 682);
});

test('writeLayout follows §13.2 with the A7 foot (P280): 402 → prompt top 123 / grid top 219 / g 362; SE → 76 / 172 / g 261; Pro Max → g 400', () => {
  const a = writeLayout({ width: 402, mainHeight: 608, promptHeight: 80 });
  assert.equal(a.g, 362);
  assert.equal(a.toolsHeight, 88, 'under the grid: 撤销 / 清空 row 48 + note slot 40');
  assert.equal(a.top, 25, 'round((608 − (80 + 16 + 362 + 88)) × 0.4)');
  assert.equal(54 + 44 + a.top, 123, 'prompt top on the page');
  assert.equal(54 + 44 + a.gridTop, 219, 'grid top on the page');
  const b = writeLayout({ width: 375, mainHeight: 461, promptHeight: 80 });
  assert.equal(b.g, 261, '461 − 80 − 16 − 88 − 16 (the design sheet draws 297: it has no note slot under the tools row)');
  assert.equal(b.top, 12, 'the 40% share (6) is below the 12 floor (the spare, 16, allows 12)');
  assert.equal(20 + 44 + b.top, 76);
  assert.equal(20 + 44 + b.gridTop, 172);
  const c = writeLayout({ width: 440, mainHeight: 682, promptHeight: 80 });
  assert.equal(c.g, 400, 'capped at 400 (also 440 − 40)');
  assert.equal(c.top, 39, 'round((682 − 584) × 0.4)');
});

test('writeLayout: g is sized from the nominal prompt (80), the position from the measured prompt (hint line, big text) — the grid never shrinks for either (D36)', () => {
  const plain = writeLayout({ width: 402, mainHeight: 626, promptHeight: 80 });
  const hinted = writeLayout({ width: 402, mainHeight: 626, promptHeight: 80 + 10 + 22 });
  const big = writeLayout({ width: 402, mainHeight: 626, promptHeight: 86 });
  assert.equal(hinted.g, plain.g, 'a prompt hint line does not shrink the grid');
  assert.equal(big.g, plain.g, 'neither does a bigger system text size');
  assert.ok(hinted.top < plain.top, 'the group sits higher instead (centered with the taller prompt)');
  assert.equal(hinted.gridTop, hinted.top + 112 + 16);
});

test('writeLayout (E9d, P195, D29 / D36): xS–XXXL never shrink the grid — g is sized from the nominal (L) main area, only the position follows the real one', () => {
  // 402×874（状态栏 54、下 34）：L 档主区 608；XXXL 页头 / 按钮行略高 → 实际主区只剩 560 左右，题面 106
  const L = writeLayout({ width: 402, mainHeight: 608, nominalHeight: 608, promptHeight: 80 });
  for (const [real, prompt] of [[600, 86], [580, 92], [560, 106]]) {
    const big = writeLayout({ width: 402, mainHeight: real, nominalHeight: 608, promptHeight: prompt });
    assert.equal(big.g, L.g, `real main ${real}: g = L g (${L.g})`);
    assert.equal(big.toolsHeight, 88);
    assert.ok(big.top >= 0, 'the top gap is never negative');
  }
  // 放不下：P257 起组顶也只按名义版式 + 题面高排（不随实际主区高变，书写格顶边才恒定），页面整体可滚（非 AX 档仍不缩格子）
  const tight = writeLayout({ width: 402, mainHeight: 300, nominalHeight: 608, promptHeight: 126 });
  assert.equal(tight.top, 12, 'round((608 − (126 + 16 + 362 + 88)) × 0.4) = 6 → the 12 floor (the spare, 16, allows it): follows the nominal main height, not the 300 that was measured');
  assert.equal(tight.g, 362);
});

// ---- AX 档（D51 ⑦，P225，A2-01）：永不滚动，格子按实际可用高度排，下限 220
// 页面外壳按 AX 档实测值建模：页头 44 + 上安全区；底栏 = 上 12 + 求助行 56 + 间 20 + 主按钮（--btn-h：AX1 60 / AX2 64 / AX3 74 / AX4 82 / AX5 88）+ max(8, 下安全区)（A7，P280）；
// 格子（不夹下限）低于 220（tight）时写字页让底栏收紧（P278）：主按钮字号封顶 34pt（高 52）、求助行 48、间距 6——下面 axMain(…, true)；
// 题面 P = 拼音行 28 + 题面格 round(52 × min(k, 1.6)) = 83 → 112（有两行提示时再加 8 + 48；提示行是 17pt 两行）。
const AX_BTN = { 1: 60, 2: 64, 3: 74, 4: 82, 5: 88 };
const PHONES = [
  { name: '375×667 (SE 3)', w: 375, h: 667, top: 20, bottom: 0 },
  { name: '390×844 (iPhone 14)', w: 390, h: 844, top: 47, bottom: 34 },
  { name: '430×932 (Pro Max)', w: 430, h: 932, top: 59, bottom: 34 },
];
const axMain = (phone, level, compact = false) => phone.h - (44 + phone.top) - (compact ? 12 + 48 + 6 + 52 : 12 + 56 + 20 + AX_BTN[level]) - Math.max(8, phone.bottom);
/** 与写字页一致：按常规底栏量一次，tight 就按收紧后的底栏再量一次。 */
const axFit = (phone, level, P) => {
  const first = axWriteLayout({ width: phone.w, mainHeight: axMain(phone, level), promptHeight: P });
  if (!first.tight) return { r: first, main: axMain(phone, level) };
  const main = axMain(phone, level, true);
  return { r: axWriteLayout({ width: phone.w, mainHeight: main, promptHeight: P }), main };
};
const AX_P = 112;

test('axWriteLayout (P225): AX1 / AX3 / AX5 × SE / 14 / Pro Max — grid whole, ≥ 220, group inside the main area (nothing to scroll), width-capped', () => {
  for (const phone of PHONES) {
    for (const level of [1, 3, 5]) {
      for (const P of [AX_P, AX_P + 8 + 48]) { // 无提示行 / 两行提示行
        const { r, main } = axFit(phone, level, P);
        const tag = `${phone.name} AX${level} P${P} (main ${main})`;
        assert.ok(r.g >= AX_GRID_MIN && r.g >= 220, `${tag}: g ${r.g} ≥ 220`);
        assert.ok(r.g <= Math.min(phone.w - 40, GRID_MAX), `${tag}: g ${r.g} within the page margins`);
        assert.ok(Number.isInteger(r.g), `${tag}: integer`);
        // 最矮的屏（SE 3）上题面再多两行提示行（P = 168）：A7 的格下工具行让整组放不下，按 P261 / P278 的最后一步落到「页面正文可滚动」（其它屏、常规题面都放得下）
        const overflowOk = phone.h < 700 && P > AX_P;
        if (!overflowOk) {
          assert.equal(r.fits, true, `${tag}: the whole group fits in the main area`);
          assert.ok(r.top + P + 16 + r.g + AX_BELOW_H <= main + 0.5, `${tag}: group bottom ${r.top + P + 16 + r.g + AX_BELOW_H} ≤ main ${main} — no scrolling`);
        } else {
          assert.equal(r.g, 220, `${tag}: on the floor, the page body scrolls (last resort)`);
        }
        assert.ok(r.top >= 0, `${tag}: top ≥ 0`);
        assert.equal(r.gridTop, r.top + P + 16);
        assert.equal(r.toolsHeight, AX_BELOW_H, 'under the grid: 撤销 / 清空 row 48 + note slot ≥ 56 (A7 put undo / clear back under the grid, P280)');
      }
    }
  }
});

test('axWriteLayout: SE 3 at AX5 is almost on the 220 floor (A7 added the 48pt tools row; the foot is compacted first, P278) and still fits; 390 × 844 AX5 keeps a 295 grid (modelled); big screens are width-limited', () => {
  const se = axWriteLayout({ width: 375, mainHeight: axMain(PHONES[0], 5), promptHeight: AX_P });
  assert.equal(se.tight, true, 'regular foot: main 419 → 171 < 220 → tight');
  const se5 = axFit(PHONES[0], 5, AX_P);
  assert.equal(se5.r.g, 229, 'compacted foot: main 477 → 477 − 112 − 16 − 104 − 16 = 229 (just above the floor)');
  assert.equal(se5.r.fits, true, 'the group fits');
  const p14 = axFit(PHONES[1], 5, AX_P);
  assert.equal(p14.r.g, 295, '390 × 844 AX5 (modelled with the 88pt AX5 main button): main 844 − 91 − (12 + 56 + 20 + 88) − 34 = 543 → 543 − 112 − 16 − 104 − 16');
  const pm = axFit(PHONES[2], 5, AX_P);
  assert.equal(pm.r.g, 371, 'Pro Max AX5 (modelled): main 932 − 118 − 184 − 34 − ... = 596 → height-limited 371 (it was width − 40 = 390 before the 48pt tools row)');
});

test('axWriteLayout: follows the real height — a shorter main area gives a smaller grid, down to the 220 floor, never below; fits=false only when even 220 does not fit', () => {
  const g = main => axWriteLayout({ width: 480, mainHeight: main, promptHeight: AX_P });
  assert.equal(g(560).g, 560 - AX_P - 16 - AX_BELOW_H - 16, 'height-limited: 312');
  assert.ok(g(500).g < g(560).g, 'smaller main → smaller grid');
  const floor = g(AX_P + 16 + 220 + AX_BELOW_H + 16);
  assert.equal(floor.g, 220, 'exactly the floor');
  assert.equal(floor.fits, true);
  const tooSmall = g(300);
  assert.equal(tooSmall.g, 220, 'never below 220');
  assert.equal(tooSmall.fits, false, 'cannot fit → the caller knows (320×568-class screens)');
  assert.equal(axWriteLayout({}).g, 345, 'nothing known → the old 345 grid');
});

test('nominalMainHeight: page − (44 + status bar) − (134 + max(8, bottom inset)); the standard-size main area under the A7 foot (P280)', () => {
  assert.equal(nominalMainHeight({ pageHeight: 874, safeTop: 54, footBottom: 34 }), 608, '402×874');
  assert.equal(nominalMainHeight({ pageHeight: 667, safeTop: 20, footBottom: 8 }), 461, 'SE');
  assert.equal(nominalMainHeight({ pageHeight: 956, safeTop: 62, footBottom: 34 }), 682, 'Pro Max');
  assert.equal(nominalMainHeight({ pageHeight: 852 }), 852 - 44 - 134 - 8, 'no safe area (browser)');
  assert.equal(nominalMainHeight({ pageHeight: 852, bodyPad: 4 }), 852 - 44 - 134 - 8 - 4);
  assert.ok(Number.isNaN(nominalMainHeight({})));
  // 与字号无关：函数不收字号参数，同一视口恒定
  assert.equal(nominalMainHeight({ pageHeight: 874, safeTop: 54, footBottom: 34 }), mainOf(874, 54, 34));
});

test('writeGridSize: min(W − 40, 400, main − P − 16 − T − 16) clamped to [258, 400], T = 88 (A7); independent of the text size', () => {
  const cases = [
    // [宽, 主区高, P, 期望, 说明]
    [402, 608, 80, 362, 'width first'],
    [375, 461, 80, 261, 'height first'],
    [440, 682, 80, 400, 'cap'],
    [768, 900, 80, 400, 'tablet: cap'],
    [320, 300, 80, 258, 'floor'],
    [402, 608, 126, 362, 'a taller prompt (AX) still leaves room here'],
    [402, 548, 126, 302, '548 − 126 − 16 − 88 − 16'],
    [402, 500, 126, 258, '500 − 126 − 16 − 88 − 16 = 254 → floor'],
    [375, 400, 80, 258, 'not enough → floor (the page scrolls)'],
  ];
  for (const [width, mainHeight, promptHeight, expected, why] of cases) {
    assert.equal(writeGridSize({ width, mainHeight, promptHeight }), expected, `${width}×${mainHeight} P${promptHeight}: ${why}`);
  }
  assert.equal(GRID_MIN, 258);
  assert.equal(GRID_MAX, 400);
});

test('writeGridSize: always within [258, 400] and never wider than the screen minus 40 unless below the floor', () => {
  for (let w = 280; w <= 900; w += 20) {
    for (let m = 300; m <= 900; m += 20) {
      const s = writeGridSize({ width: w, mainHeight: m, promptHeight: 80 });
      assert.ok(s >= 258 && s <= 400, `${w}×${m}: ${s}`);
      assert.ok(s <= Math.max(258, w - 40));
      assert.ok(Number.isInteger(s));
    }
  }
});

test('writeGridSize: missing or invalid sizes fall back to the old 345 grid / only the known side counts', () => {
  assert.equal(writeGridSize(), 345);
  assert.equal(writeGridSize({}), 345);
  assert.equal(writeGridSize({ width: NaN, mainHeight: 0 }), 345);
  assert.equal(writeGridSize({ width: 393 }), 353, 'only the width known');
  assert.equal(writeGridSize({ mainHeight: 461 }), 261, 'only the height known');
});

test('groupTop: 40% of the spare height above (60% below), at least 12 — but never more than the spare (the top gap never pushes the group out)', () => {
  assert.equal(groupTop({ mainHeight: 626, groupHeight: 498 }), 51);
  assert.equal(groupTop({ mainHeight: 479, groupHeight: 463 }), 12, 'SE: 40% of 16 is 6, the floor is 12 and the spare (16) allows it');
  assert.equal(groupTop({ mainHeight: 472, groupHeight: 461.7 }), 10, 'XXXL on the shortest screen: only 10.3 spare → top 10, no overflow');
  assert.equal(groupTop({ mainHeight: 500, groupHeight: 498 }), 2, 'spare 2 → top 2');
  assert.equal(groupTop({ mainHeight: 400, groupHeight: 498 }), 0, 'overflow: the page scrolls, the top gap is 0');
  assert.equal(groupTop({ mainHeight: 700, groupHeight: 536 }), 66);
  assert.equal(groupTop({}), 12);
});

test('judgePairSize follows §9.1: 402 → 231, SE → 177, Pro Max → 261; width-limited when tall; floor 120', () => {
  // S = min(W − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)
  assert.equal(judgePairSize({ width: 402, mainHeight: 626, gridTop: 147 }), 231, '(626 − 147 − 16) ÷ 2');
  assert.equal(judgePairSize({ width: 375, mainHeight: 479, gridTop: 108 }), 177, '(479 − 108 − 16) ÷ 2');
  assert.equal(judgePairSize({ width: 440, mainHeight: 700, gridTop: 162 }), 261, '(700 − 162 − 16) ÷ 2');
  assert.equal(judgePairSize({ width: 402, mainHeight: 1600, gridTop: 147 }), 362, 'width-limited: W − 40');
  assert.equal(judgePairSize({ width: 320, mainHeight: 200, gridTop: 100 }), JUDGE_MIN, 'floor');
  assert.equal(judgePairSize({}), 234, 'nothing known');
  // 与整组位置的联动：同一组输入
  for (const [w, main] of [[402, 608], [375, 461], [440, 682]]) {
    const L = writeLayout({ width: w, mainHeight: main, promptHeight: 80 });
    const s = judgePairSize({ width: w, mainHeight: main, gridTop: L.gridTop });
    assert.ok(L.gridTop + 2 * s - 1 <= main - 16 + 1, `${w}: the pair (2S − 1 tall) ends ≥ 16 above the button row`);
    assert.ok(s <= w - 40);
  }
});

test('judgeAxLayout (D49 ⑧): stack vs side — take the one with the bigger cells; side is (W − 40 − 12) ÷ 2', () => {
  // 402 AX5：上下排 181（实现交接 §9.4）：S_v = ⌊(主区高 − 12 − P − 16 − 16) ÷ 2⌋，P = 126（AX5 拼音 58 + 4 + 题面格 64）→ 主区高 532
  const a = judgeAxLayout({ width: 402, mainHeight: 532, promptHeight: 126 });
  assert.deepEqual([a.layout, a.s, a.top, a.stack, a.side], ['stack', 181, 12, 181, 175]);
  // SE AX5：并排 161 = ⌊(375 − 40 − 12) ÷ 2⌋，上下排放不下（更小）
  const b = judgeAxLayout({ width: 375, mainHeight: 400, promptHeight: 126 });
  assert.deepEqual([b.layout, b.s, b.stack, b.side], ['side', 161, 115, 161], '⌊(400 − 12 − 126 − 16 − 16) ÷ 2⌋ = 115 < 161');
  assert.equal(b.top, Math.max(12, Math.round((400 - (126 + 16 + 161)) * 0.4)), 'side: the 40% rule on the group (P + 16 + S)');
  assert.equal(COMPARE_GAP, 12);
  // 平手取上下排；并排只在更大时才用
  const c = judgeAxLayout({ width: 402, mainHeight: 44 + 126 + 2 * 175, promptHeight: 126 });
  assert.equal(c.stack, 175);
  assert.equal(c.layout, 'stack', 'a tie keeps the stack');
  const d = judgeAxLayout({ width: 402, mainHeight: 44 + 126 + 2 * 174, promptHeight: 126 });
  assert.equal(d.layout, 'side', '174 < 175');
  assert.equal(d.s, 175);
  // 任何一种取法，格子都是两种里更大的（下限 120 除外）
  for (const main of [300, 400, 532, 700]) {
    for (const w of [375, 402, 440]) {
      const r = judgeAxLayout({ width: w, mainHeight: main, promptHeight: 126 });
      assert.equal(r.layout, r.side > r.stack ? 'side' : 'stack', `${w}×${main}: the layout with the bigger cells wins`);
      assert.equal(r.s, r.layout === 'side' ? r.side : Math.max(JUDGE_MIN, r.stack), `${w}×${main}: S of the chosen layout (stack has the 120 floor)`);
    }
  }
});

test('estimateLayout: first-frame guess from the window (no safe area, standard prompt)', () => {
  const win = (width, height) => ({ innerWidth: width, innerHeight: height, document: { documentElement: { clientWidth: width, clientHeight: height } } });
  const a = estimateLayout(win(402, 874));
  assert.equal(a.g, 362);
  const b = estimateLayout(win(375, 667));
  assert.equal(b.g, 281, 'no safe area: 667 − 44 − (134 + 8) − 80 − 16 − 88 − 16 = 281 (height-limited under the A7 foot)');
  assert.equal(estimateLayout().g, 345, 'no window (node) → 345');
});

test('writeLayout (P257, D53 ②): the group top follows the NOMINAL main height and this card\'s prompt height only — the actual main height of a phase (taller head / foot) does not move the grid; headExtra lifts the group so the grid y on the page is unchanged', () => {
  const nominal = writeLayout({ width: 402, mainHeight: 722, nominalHeight: 722, promptHeight: 80 });
  assert.deepEqual([nominal.g, nominal.top, nominal.gridTop], [362, 70, 166], '402×874 (browser): g 362, group top 70, grid top 166 below the body top');
  for (const actual of [722, 700, 650, 620]) {
    const phase = writeLayout({ width: 402, mainHeight: actual, nominalHeight: 722, promptHeight: 80 });
    assert.deepEqual([phase.g, phase.top, phase.gridTop], [362, 70, 166], `actual main ${actual}: same g / top / grid top (it used to follow the actual main height)`);
  }
  // 页头比名义高 27.7（大字号下标题折成两行）：正文区被推下 27.7，组顶减去它，页面上的 y 不变
  const lifted = writeLayout({ width: 402, mainHeight: 694, nominalHeight: 722, promptHeight: 80, headExtra: 27.7 });
  assert.ok(Math.abs(lifted.top - (70 - 27.7)) < 1e-9 && Math.abs(lifted.gridTop + 27.7 - 166) < 1e-9, 'top lifted by the head extra');
  assert.equal(writeLayout({ width: 375, mainHeight: 533, nominalHeight: 533, promptHeight: 80, headExtra: 99 }).top, 0, 'never above the body top');
  // 同一张卡内题面高不变 → 顶边不变；换一张题面更高的卡（有提示行）才会不同（只和它自己的各阶段比）
  const tall = writeLayout({ width: 402, mainHeight: 722, nominalHeight: 722, promptHeight: 126 });
  assert.notEqual(tall.gridTop, nominal.gridTop);
});
