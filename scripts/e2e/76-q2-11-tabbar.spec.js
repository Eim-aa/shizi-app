// 阶段 1 Q2-11（复测 simC D8 / simA S3）：Tab 栏在大字号下不出屏——XXXL 下圆点被屏幕底边裁掉；AX5 下图标极小、标签极大、圆点离标签很远。
// 阶段 1 E9a（D49，实现交接 §0.3）：Q2-11 的「封顶在 XXXL 倍率」收紧为「图标 24、标签 11 不随动态字体放大」（系统 UITabBar 行为），
//   选中 = 实心图标 + ink1，不画小圆点——旧断言「封顶 1.35 倍 / 圆点在栏内」随之改成「各档与 L 档完全一样（不放大）/ 没有圆点 / 选中图标是实心」。
//   不变的约束：任何字号档下栏都落在屏内、标签在栏内、触控区 ≥ 44。
// 模拟 375×667（iPhone SE 3，没有底部安全区），系统字号 XXXL / AX3 / AX5（模拟原生 shiziContentSize）。
import { bootTestHost, setTextSize, waitNavIdle } from './helpers.mjs';

async function tabFacts(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.sz-tabs');
    const tab = bar.querySelector('[aria-selected="true"]');
    const other = bar.querySelector('[aria-selected="false"]');
    const label = tab.querySelector('span');
    const icon = tab.querySelector('svg');
    const barR = bar.getBoundingClientRect();
    const labelR = label.getBoundingClientRect();
    const iconR = icon.getBoundingClientRect();
    const tabR = tab.getBoundingClientRect();
    const root = getComputedStyle(document.documentElement);
    return {
      k: parseFloat(root.getPropertyValue('--k')),
      barBottom: Math.round(barR.bottom * 10) / 10,
      barH: Math.round(barR.height * 10) / 10,
      viewportH: window.innerHeight,
      label: parseFloat(getComputedStyle(label).fontSize),
      icon: Math.round(iconR.width * 10) / 10,
      labelInsideBar: labelR.bottom <= barR.bottom + 0.5 && labelR.top >= barR.top - 0.5,
      dot: getComputedStyle(label, '::after').content,
      tabH: Math.round(tabR.height * 10) / 10,
      colorSelected: getComputedStyle(tab).color,
      colorOther: getComputedStyle(other).color,
      ink1: getComputedStyle(document.documentElement).getPropertyValue('--ink1').trim(),
      selectedFilled: icon.querySelector('path, circle').getAttribute('fill'),
      otherFilled: other.querySelector('svg path, svg circle').getAttribute('fill'),
    };
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await page.setViewportSize({ width: 375, height: 667 });
  await bootTestHost(page, ctx.baseURL);

  step('系统字号 L：Tab 栏基准 49 高（SE 无安全区）、图标 24、标签 11；选中是实心图标、没有圆点');
  await setTextSize(page, 'L');
  await waitNavIdle(page);
  const base = await tabFacts(page);
  assert.deepEqual([base.barH, base.icon, base.label], [49, 24, 11], 'L: 49 / 24 / 11');
  assert.equal(base.dot, 'none', 'no selected dot (D49)');
  assert.equal(base.selectedFilled, 'currentColor', 'selected = solid icon');
  assert.equal(base.otherFilled, 'none', 'unselected = line icon');
  assert.ok(base.colorSelected !== base.colorOther, 'selected is ink1, unselected ink3');

  for (const category of ['XXXL', 'AX3', 'AX5']) {
    step(`系统字号 ${category}：Tab 栏不放大——高、图标、标签与 L 档完全一样，栏在屏内、标签在栏内`);
    await setTextSize(page, category);
    await waitNavIdle(page);
    const f = await tabFacts(page);
    assert.ok(f.k > 1, `${category}: --k ${f.k} > 1 (the text size really changed)`);
    assert.deepEqual([f.barH, f.icon, f.label], [base.barH, base.icon, base.label], `${category}: bar / icon / label unchanged (${f.barH} / ${f.icon} / ${f.label})`);
    assert.ok(f.barBottom <= f.viewportH + 0.5, `${category}: the bar ends inside the screen (${f.barBottom} ≤ ${f.viewportH})`);
    assert.ok(f.labelInsideBar, `${category}: the label sits inside the bar`);
    assert.ok(f.tabH >= 44, `${category}: tab hit height ${f.tabH} ≥ 44`);
    assert.equal(f.dot, 'none', `${category}: no selected dot`);
  }
  await setTextSize(page, 'L');
}
