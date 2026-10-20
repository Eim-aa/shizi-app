// 阶段 1 Q2-13（复测 simC D10）：三处可点控件的触控热区 < 44——字库「练这些字」(.sz-lib__act 40；E9c 起它是文字按钮本身，高 44)、写字页「结束这组」(.sz-end__btn 40)、
// 分享比例分段按钮 (.sz-img__ratio button 38)；另查到查字弹层「回到这 N 个字」(.sz-query__back 36)、详情「换掉这个词语」横幅按钮 (.sz-dbanner 40)。
// 视觉尺寸不变，用透明的 ::after 把热区扩到 ≥ 44：在控件中心上下各 21pt 处做命中测试，必须仍落在这个控件（或它所在的按钮）上，宽度也 ≥ 44。
import { bootTestHost, seedSession, tid, topSel, waitNavIdle } from './helpers.mjs';
import { goHomeTab, openSharePreview, seedEndedGroup } from './q2-helpers.mjs';

/** 控件 sel（顶层图层 / 弹层里）的热区：中心上下 ±21.5pt 两点命中它或它的祖先按钮。 */
async function hitFacts(page, sel) {
  return page.evaluate(selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const host = el.closest('button') || el;
    const r = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = [-21, 21].map(d => {
      const top = document.elementFromPoint(cx, cy + d);
      return !!top && (top === host || host.contains(top));
    });
    return { w: Math.round(hr.width * 10) / 10, h: Math.round(r.height * 10) / 10, hostH: Math.round(hr.height * 10) / 10, hits };
  }, sel);
}

function check(assert, label, f) {
  assert.ok(f, `${label}: found`);
  assert.ok(f.w >= 44, `${label}: width ${f.w} ≥ 44`);
  assert.deepEqual(f.hits, [true, true], `${label}: the points 21pt above and below its centre still hit it (visual height ${f.h}, host ${f.hostH})`);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  step('分享弹层：比例分段按钮 3:4 / 1:1');
  await seedEndedGroup(page, { chars: [{ c: '静' }, { c: '永', judgment: 'wrong' }, { c: '和' }, { c: '水' }] });
  await openSharePreview(page);
  for (const ratio of ['3:4', '1:1']) check(assert, `ratio ${ratio}`, await hitFacts(page, `[data-testid="image-ratio"][data-ratio="${ratio}"]`));
  const ratioH = await page.evaluate(() => document.querySelector('[data-testid="image-ratio"]').getBoundingClientRect().height);
  assert.equal(Math.round(ratioH), 38, 'the visible size is unchanged (38)');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);

  step('字库首页：「练这些字」');
  await goHomeTab(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  await page.waitForSelector(topSel('library-all-open'));
  check(assert, 'library 全部 ›', await hitFacts(page, topSel('library-all-open')));
  const actH = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="library-all-open"]').getBoundingClientRect().height);
  assert.equal(Math.round(actH), 44, 'D60: 「全部 ›」 is a text button (min height 44), so the visible height is the hit height');

  step('写字页：「结束这组」（自选的字与今天的练习才有，D66 ⑥）');
  await seedSession(page, { slot: 'B', kind: 'picked', chars: ['春', '夏'] });
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'B' }));
  await page.waitForSelector(topSel('write-end'));
  await waitNavIdle(page);
  check(assert, 'write 结束这组', await hitFacts(page, topSel('write-end')));
  const endH = await page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().height, topSel('write-end'));
  assert.equal(Math.round(endH), 44, 'D66 ⑥: the box is 44 high now (today’s practice has it too, and the page matrix measures boxes); it is a plain text button, so visible = hit');

  step('查字弹层：「‹ 回到这 N 个字」');
  await goHomeTab(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
  await page.waitForSelector('.sz-sheet [data-testid="query-input"]');
  await page.fill(tid('query-input'), '春夏');
  await page.waitForSelector('.sz-sheet [data-testid="query-rows"]');
  await waitNavIdle(page);
  await page.locator('.sz-sheet [data-testid="query-row"][data-char="春"] [data-testid="query-row-open"]').click();
  await page.waitForSelector('.sz-sheet [data-testid="query-back"]');
  check(assert, 'query 回到这 N 个字', await hitFacts(page, '.sz-sheet [data-testid="query-back"]'));
}
