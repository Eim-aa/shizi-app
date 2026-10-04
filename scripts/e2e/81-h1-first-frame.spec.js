// H1-6（I2-05）：首次打开，主按钮「开始写字」从第一帧起可见可点；品牌动画只作用于题跋与品牌字，不延迟主按钮（也不拦它的点击）。
//   用 ?brand=1 让测试宿主放品牌时刻（默认测试宿主不放动画）：
//   - 页面一出现（第一次拿到 home-start）：按钮所在的 foot 与按钮本身不透明度 1、没有动画（旧版 foot 是 opacity 0、1.65s 后才淡入，透明时仍可点到）；
//   - 动画只落在题跋逐字与印上：document.getAnimations() 里没有任何一条的目标在 foot 里；题跋逐字确实在动（品牌时刻还在）；
//   - 一出现就能点：马上点「开始写字」→ 进到写字页（首练），不是被「点一下先结束动画」吞掉；
//   - 品牌时刻总长 ≤ 1.2s（I2-05 建议：题跋若保留动画总长 ≤ 1.2s），到时自己回到静帧；
//   - 「减少动态效果」：照旧直接静帧，没有动画。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';

/* eslint-disable no-undef */
const probe = () => {
  const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
  const foot = root.querySelector('.sz-home__foot');
  const btn = root.querySelector('[data-testid="home-start"]');
  const anims = document.getAnimations();
  const inFoot = anims.filter(a => a.effect && a.effect.target && foot.contains(a.effect.target));
  const chars = anims.filter(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('sz-first__ch'));
  const r = btn.getBoundingClientRect();
  const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  return {
    brand: root.dataset.brand,
    footOpacity: getComputedStyle(foot).opacity,
    footAnim: getComputedStyle(foot).animationName,
    btnOpacity: getComputedStyle(btn).opacity,
    animsInFoot: inFoot.length,
    charAnims: chars.length,
    hitIsBtn: !!hit && (hit === btn || btn.contains(hit)),
    t: performance.now(),
  };
};

export default async function run(page, ctx) {
  const { assert, step } = ctx;

  step('?brand=1：第一次拿到按钮的那一刻——可见（不透明度 1）、没有动画、点得到；动画只在题跋 / 印上');
  await bootTestHost(page, ctx.baseURL, { query: 'brand=1' });
  const first = await page.evaluate(probe);
  assert.equal(first.brand, 'playing', 'the brand moment is playing (motto + seal)');
  assert.deepEqual([first.footOpacity, first.btnOpacity, first.footAnim], ['1', '1', 'none'], 'the foot and the main button are fully visible from the first frame, not animated');
  assert.equal(first.animsInFoot, 0, 'no animation targets anything in the foot (button / note)');
  assert.ok(first.charAnims >= 17, `the motto characters are animating (${first.charAnims})`);
  assert.equal(first.hitIsBtn, true, 'the centre of 开始写字 hits the button');

  step('马上点「开始写字」→ 进写字页（不被品牌动画吞掉）');
  await page.click(topSel('home-start'), { timeout: 3000 });
  await page.waitForSelector(topSel('write-screen'), { timeout: 5000 });
  await waitNavIdle(page);

  step('品牌时刻总长 ≤ 1.2s，到时自己回到静帧；减少动态效果直接静帧');
  const total = await page.evaluate(async () => (await import('/src/ui/screens/home/index.js')).BRAND_TOTAL_MS);
  assert.ok(total <= 1200, `BRAND_TOTAL_MS ${total} ≤ 1200`);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL, { query: 'brand=1' });
  await page.waitForTimeout(1500);
  assert.equal((await page.evaluate(probe)).brand, 'off', 'ended by itself');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL, { query: 'brand=1' });
  const still = await page.evaluate(probe);
  assert.deepEqual([still.brand, still.footOpacity, still.charAnims, still.animsInFoot], ['off', '1', 0, 0], 'reduced motion: the still frame, no animation');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
