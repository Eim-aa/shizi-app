// H1-2（T2-01、D51 ⑥、设计说明「页边 20」）：页头尾端、文字按钮、内容的右边线统一落在 20pt 页边线（右 = 屏宽 − 20）；左边线 20。
// 逐页量「可见字形的外缘」（文字用 Range 的行盒，图标用 path 几何盒，加 / 减描边半宽 0.75）：
//   写字页：页头计数「1 / 3」右缘、提示 / 看答案左缘、跳过右缘、页头返回箭头左缘（在纸上写在左组看答案之后）；
//   清单页：页头尾端「全选 / 全不选」右缘；字库：「练这些字」右缘；我的：「练习记录 ›」「保存图片」右缘；
//   有记录的字：「练这些字」左缘；详情 / 设置：返回箭头左缘、主按钮 20..W−20。
// 393×852 与 375×667 各一遍。
import { bootTestHost, openWrite, seedSession, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
/** 元素里可见字形的外缘 {l, r}（文字：Range 行盒；纯图标：path 几何盒外扩描边半宽）。 */
async function ink(page, sel) {
  return page.evaluate(selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rects = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rc of range.getClientRects()) rects.push([rc.left, rc.right]);
    }
    if (!rects.length) {
      for (const p of el.querySelectorAll('svg path')) {
        const rc = p.getBoundingClientRect();
        const sw = parseFloat(getComputedStyle(p).strokeWidth) || 0;
        rects.push([rc.left - sw / 2, rc.right + sw / 2]);
      }
    }
    if (!rects.length) return null;
    return { l: Math.min(...rects.map(r => r[0])), r: Math.max(...rects.map(r => r[1])), w: document.documentElement.clientWidth };
  }, sel);
}

async function box(page, sel) {
  return page.evaluate(selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, w: document.documentElement.clientWidth };
  }, sel);
}

const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
const go = async (page, fn, arg) => {
  await page.evaluate(fn, arg);
  await waitNavIdle(page);
};

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  let page = page0;
  const rights = [];
  const lefts = [];
  const rightOf = async (label, sel) => {
    const m = await ink(page, sel);
    assert.ok(m, `${label}: found`);
    const want = m.w - 20;
    rights.push(m.r);
    assert.ok(near(m.r, want), `${label}: right edge ${m.r.toFixed(1)} = ${want}`);
  };
  const leftOf = async (label, sel) => {
    const m = await ink(page, sel);
    assert.ok(m, `${label}: found`);
    lefts.push(m.l);
    assert.ok(near(m.l, 20), `${label}: left edge ${m.l.toFixed(1)} = 20`);
  };

  for (const vp of [{ width: 393, height: 852 }, { width: 375, height: 667 }]) {
    if (page !== page0) await page.close();
    page = vp.width === 393 ? page0 : await page0.context().newPage(); // 第二个视口用新页（路由记忆不带过来）
    await page.setViewportSize(vp);
    await bootTestHost(page, ctx.baseURL);
    const tag = `${vp.width}×${vp.height}`;

    step(`${tag} 写字页：页头计数、提示、跳过、在纸上写、返回箭头`);
    await seedSession(page, { slot: 'A', chars: [...'春夏秋'] });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await openWrite(page, { slot: 'A' });
    await rightOf(`${tag} write 页头计数`, `${topSel('write-screen')} .sz-page__trail`);
    await leftOf(`${tag} write 返回箭头`, topSel('page-back'));
    await leftOf(`${tag} write 提示`, topSel('write-hint'));
    await rightOf(`${tag} write 跳过`, topSel('write-skip'));
    // R2-X1（P226）：「在纸上写」是左组里的常驻文字按钮（看答案之后），不再贴右边线；右边线只有跳过
    const answerBox = await box(page, topSel('write-show-answer'));
    const paperBox = await box(page, topSel('write-to-paper'));
    assert.ok(paperBox && paperBox.l >= answerBox.r - 0.5 && paperBox.r <= (await box(page, topSel('write-skip'))).l, `${tag} write 在纸上写 sits after 看答案, before 跳过`);
    const done = await box(page, topSel('write-done'));
    assert.ok(near(done.l, 20) && near(done.r, done.w - 20), `${tag} write 写好了 20..W−20`);
    // 页头尾端：撤销 / 清空在计数左边，计数仍是右缘 20（上面 rightOf 已断言）；这里再核对它们没有挤出页边
    const tools = await box(page, topSel('write-tools'));
    assert.ok(tools && tools.r <= tools.w - 20 + 0.5, `${tag} write 撤销 / 清空 stay inside the 20pt margin`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());

    step(`${tag} 清单 / 字库 / 我的 / 有记录的字 / 详情 / 设置`);
    await seedHomeSpec(page, { entries: [...'疆酱肆酝春'].map((c, i) => ({ char: c, at: `2026-10-0${1 + i}T20:00:00`, judgment: i < 2 ? 'wrong' : 'correct' })), clock: '2026-10-05T19:30:00' });
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('library-list', { kind: 'wrong' }));
    await rightOf(`${tag} list 页头尾端`, `${topSel('list-screen')} .sz-page__trail`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
    await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
    await rightOf(`${tag} library 练这些字`, topSel('library-card-practice'));
    await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await rightOf(`${tag} mine 练习记录 ›`, topSel('mine-records'));
    await rightOf(`${tag} mine 保存图片`, topSel('mine-sheet-save'));
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('settings', {}));
    await leftOf(`${tag} settings 返回箭头`, topSel('page-back'));
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('library-all', { filter: 'wrong' }));
    await leftOf(`${tag} all 练这些字`, topSel('all-go'));
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('detail', { char: '疆' }));
    await leftOf(`${tag} detail 返回箭头`, topSel('page-back'));
    const practice = await box(page, topSel('detail-practice'));
    assert.ok(near(practice.l, 20) && near(practice.r, practice.w - 20), `${tag} detail 练这个字 20..W−20`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
  }

  if (page !== page0) await page.close();
  const rset = [...new Set(rights.map(v => Math.round(v * 2) / 2))];
  assert.ok(rset.length <= 2, `right edges on all measured pages collapse to one line per viewport (got ${rset.join(', ')})`);
  assert.ok([...new Set(lefts.map(v => Math.round(v * 2) / 2))].length === 1, 'left edges collapse to one line (20)');
}
