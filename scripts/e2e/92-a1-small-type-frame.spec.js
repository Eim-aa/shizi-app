// R2-A1（A2-07 / A2-12；03 P234）：小字保底与格框对比。
//   - 系统字号 xS / S（--k < 1）下 --fs11 / --fs13 不低于 11px / 12px（行高 16 / 18px 保底）；L 档不变（11 / 13）；AX 档沿用 AX 字阶；
//     字墙图例 / 结果格「没有笔迹」/ 日历周名这类真实用到 fs11 的元素，计算字号 ≥ 11px。
//   - 格框 --frame 对纸面、对笺面在浅 / 深两套下都 ≥ 3:1（按页面里算出来的颜色实算，不读令牌表）。
// 新旧对照：旧实现下 xS 档 --fs11 = 9.02px、--fs13 = 10.66px，浅色 frame/paper = 2.91:1。
import { bootTestHost, setTextSize, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
const probe = () => {
  const out = {};
  const measure = (name, decl) => {
    const el = document.createElement('span');
    el.textContent = '字';
    el.style.cssText = `position:absolute;visibility:hidden;${decl}`;
    document.body.appendChild(el);
    out[name] = parseFloat(getComputedStyle(el).fontSize);
    out[`${name}Lh`] = getComputedStyle(el).lineHeight;
    el.remove();
  };
  measure('fs11', 'font-size:var(--fs11);line-height:var(--lh11)');
  measure('fs13', 'font-size:var(--fs13);line-height:var(--lh13)');
  const colorOf = v => {
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;visibility:hidden;color:var(${v})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  };
  out.frame = colorOf('--frame');
  out.paper = colorOf('--paper');
  out.sheet = colorOf('--sheet');
  return out;
};

const rgb = s => /rgba?\((\d+), (\d+), (\d+)/.exec(s).slice(1, 4).map(Number);
function lum([r, g, b]) {
  const f = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a, b) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await seedHomeSpec(page, {
      entries: [...'疆酱肆酝春嚷醋膝窗屉'].map((c, k) => ({ char: c, at: `2026-10-0${1 + (k % 4)}T20:0${k % 10}:00`, judgment: k < 2 ? 'wrong' : 'correct' })),
      clock: '2026-10-05T19:30:00',
    });

    step(`${scheme}: 小字保底（xS / S 档）`);
    for (const size of ['xS', 'S']) {
      await setTextSize(page, size);
      const p = await page.evaluate(probe);
      assert.ok(p.fs11 >= 11, `${scheme} ${size}: --fs11 ${p.fs11}px ≥ 11`);
      assert.ok(p.fs13 >= 12, `${scheme} ${size}: --fs13 ${p.fs13}px ≥ 12`);
      assert.ok(parseFloat(p.fs11Lh) >= 16 && parseFloat(p.fs13Lh) >= 18, `${scheme} ${size}: line heights keep the floor (${p.fs11Lh} / ${p.fs13Lh})`);
    }
    await setTextSize(page, 'L');
    let p = await page.evaluate(probe);
    assert.deepEqual([p.fs11, p.fs13], [11, 13], `${scheme} L: unchanged 11 / 13`);
    await setTextSize(page, 'XXXL');
    p = await page.evaluate(probe);
    assert.ok(p.fs11 > 11 && p.fs13 > 13, `${scheme} XXXL: still scales up (${p.fs11} / ${p.fs13})`);

    step(`${scheme}: 真实用到 fs11 的元素（日历周名）xS 下 ≥ 11px`);
    await setTextSize(page, 'xS');
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('records', { month: '2026-10' }));
    await page.waitForSelector('[data-testid="records-weekday"]');
    await waitNavIdle(page);
    const wd = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="records-weekday"]')).fontSize));
    assert.ok(wd >= 11, `${scheme} xS: calendar weekday names ${wd}px ≥ 11`);

    step(`${scheme}: 格框对纸面 / 笺面 ≥ 3:1`);
    p = await page.evaluate(probe);
    const onPaper = ratio(p.frame, p.paper);
    const onSheet = ratio(p.frame, p.sheet);
    assert.ok(onPaper >= 3, `${scheme}: frame/paper ${onPaper.toFixed(2)} ≥ 3`);
    assert.ok(onSheet >= 3, `${scheme}: frame/sheet ${onSheet.toFixed(2)} ≥ 3`);
  }
}
