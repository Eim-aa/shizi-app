// 阶段 1 Q2-11（复测 simC D8 / simA S3）：Tab 栏在大字号下封顶（XXXL 倍率），图标与标签同比，选中的 4px 圆点落在屏幕与安全区之内。
//   XXXL 下圆点被屏幕底边裁掉；AX5 下图标极小、标签极大、圆点离标签很远。
// 模拟 375×667（iPhone SE 3，没有底部安全区），系统字号 XXXL / AX3 / AX5（模拟原生 shiziContentSize）。
import { bootTestHost, setTextSize, waitNavIdle } from './helpers.mjs';

async function tabFacts(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.sz-tabs');
    const tab = bar.querySelector('[aria-selected="true"]');
    const label = tab.querySelector('span');
    const icon = tab.querySelector('svg');
    const barR = bar.getBoundingClientRect();
    const labelR = label.getBoundingClientRect();
    const iconR = icon.getBoundingClientRect();
    const dot = getComputedStyle(label, '::after');
    const dotH = parseFloat(dot.height) || 0;
    const dotMargin = parseFloat(dot.marginTop) || 0;
    const root = getComputedStyle(document.documentElement);
    return {
      k: parseFloat(root.getPropertyValue('--k')),
      barTop: Math.round(barR.top * 10) / 10,
      barBottom: Math.round(barR.bottom * 10) / 10,
      barH: Math.round(barR.height * 10) / 10,
      viewportH: window.innerHeight,
      label: parseFloat(getComputedStyle(label).fontSize),
      icon: Math.round(iconR.width * 10) / 10,
      dotBottom: Math.round((labelR.bottom + dotMargin + dotH) * 10) / 10,
      labelBottom: Math.round(labelR.bottom * 10) / 10,
      dotTop: Math.round((labelR.bottom + dotMargin) * 10) / 10,
    };
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await page.setViewportSize({ width: 375, height: 667 });
  await bootTestHost(page, ctx.baseURL);
  const cap = await page.evaluate(async () => (await import('/src/config/policy.js')).contentSizeScale.XXXL);

  step('系统字号 L：Tab 栏基准 50 高、图标 24、标签 11');
  await setTextSize(page, 'L');
  await waitNavIdle(page);
  const base = await tabFacts(page);
  assert.deepEqual([base.barH, base.icon, base.label], [50, 24, 11], 'L: 50 / 24 / 11');

  for (const category of ['XXXL', 'AX3', 'AX5']) {
    step(`系统字号 ${category}：封顶在 XXXL 倍率（${cap}），图标与标签同比，圆点在栏内、栏在屏内`);
    await setTextSize(page, category);
    await waitNavIdle(page);
    const f = await tabFacts(page);
    assert.ok(f.k >= cap, `${category}: --k ${f.k} ≥ the cap ${cap}`);
    assert.equal(f.label, Math.round(11 * cap * 100) / 100, `${category}: label capped at 11 × ${cap}`);
    assert.equal(f.icon, Math.round(24 * cap * 10) / 10, `${category}: icon capped at 24 × ${cap}`);
    assert.ok(Math.abs(f.icon / f.label - 24 / 11) < 0.05, `${category}: icon and label scale together (${f.icon} / ${f.label})`);
    assert.ok(Math.abs(f.barH - 50 * cap) <= 0.6, `${category}: bar height capped (${f.barH} vs ${50 * cap})`);
    assert.ok(f.barBottom <= f.viewportH + 0.5, `${category}: the bar ends inside the screen (${f.barBottom} ≤ ${f.viewportH})`);
    assert.ok(f.dotBottom <= f.barBottom - 1, `${category}: the 4px selected dot (bottom ${f.dotBottom}) is inside the bar (bottom ${f.barBottom}) and the screen`);
    assert.ok(f.dotTop - f.labelBottom <= 2, `${category}: the dot sits right under the label (gap ${f.dotTop - f.labelBottom})`);
  }
  await setTextSize(page, 'L');
}
