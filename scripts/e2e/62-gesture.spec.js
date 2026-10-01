// M6-5 跟手交互式返回（02 §8；01 §7：Swift 的边缘识别器是手势唯一所有者，JS 只按 shizi-native-back-progress 渲染）。
// 这里用合成 CustomEvent 按 Swift dispatchBackGesture 的顺序派发（同一段脚本里 progress，ended 越过阈值时紧跟 shizi-native-back），
// 断言两层的 transform、类名、冻结、转场起点与最终页面栈：
//   began 冻结底层页（露出、不可点、跟手期间 DOM 不变）；changed 顶层跟手 + 底层视差 + 左投影；
//   ended 过距离 / 速度阈值提交（只退一层，不被紧随的 shizi-native-back 多退一层；转场从手指位置接着走），否则回弹；
//   cancelled 回弹；遮罩开着时 began 只关遮罩、页面不动；减少动态效果不跟随、只按阈值提交；tab 根不理会。
// 演示子页（src/ui/screens/_demo/sub.js）只在 ?test=1 的 localhost 主机加载。控制台零错误由 run.mjs 统一断言。

import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';

// 与 src/ui/router.js 一致（BACK_COMMIT_RATIO / BACK_COMMIT_VELOCITY / BACK_PARALLAX），也与 Swift 阈值一致。
const RATIO = 0.24;
const VELOCITY = 650;
const PARALLAX = 0.3;

const tx = px => `translateX(${px}px)`;
const underAt = (x, w) => Math.round(-(w - x) * PARALLAX * 100) / 100 || 0;

/** 仿 WebViewController.dispatchBackGesture：派发 progress；ended 越过阈值时紧跟 shizi-native-back。返回是否派发了 back。 */
function swift(page, phase, x, v = 0) {
  return page.evaluate(([phase, x, v, ratio, velocity]) => {
    const w = Math.max(window.innerWidth, 1);
    const detail = { phase, translationX: x, progress: Math.min(1, x / w), velocityX: v };
    window.dispatchEvent(new CustomEvent('shizi-native-back-progress', { detail }));
    const fired = phase === 'ended' && (x > w * ratio || v > velocity);
    if (fired) window.dispatchEvent(new CustomEvent('shizi-native-back', { detail }));
    return fired;
  }, [phase, x, v, RATIO, VELOCITY]);
}

async function layers(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.sz-app');
    const all = [...app.querySelectorAll(':scope > .sz-layer')];
    const top = app.querySelector(':scope > .sz-layer[data-top="true"]');
    const info = el => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        screen: el.dataset.screen,
        transform: el.style.transform,
        cls: [...el.classList].filter(c => c !== 'sz-layer').sort().join(' '),
        vis: cs.visibility,
        pe: cs.pointerEvents,
        shadow: cs.boxShadow,
      };
    };
    const s = history.state;
    return {
      navAnim: app.dataset.navAnim,
      depth: s.depth,
      names: s.stack.map(e => e.n),
      top: info(top),
      under: info(all[all.indexOf(top) - 1]),
      inline: all.map(el => el.style.transform).filter(Boolean),
    };
  });
}

async function animLog(page) {
  return page.evaluate(() => window.__animLog.slice());
}

// 记下返回转场开始那一刻各层的 Web Animations 关键帧（MutationObserver 回调在同一次提交的布局 effect 之后执行）。
async function armPopProbe(page) {
  await page.evaluate(() => {
    window.__popStart = null;
    const app = document.querySelector('.sz-app');
    const mo = new MutationObserver(() => {
      if (!/^pop-/.test(app.dataset.navAnim) || window.__popStart) return;
      mo.disconnect();
      window.__popStart = [...app.querySelectorAll(':scope > .sz-layer')].map(el => ({
        screen: el.dataset.screen,
        inline: el.style.transform,
        moving: el.classList.contains('sz-layer--moving'),
        anims: el.getAnimations().map(a => ({
          from: a.effect.getKeyframes()[0].transform || null,
          to: a.effect.getKeyframes()[1].transform || null,
          duration: a.effect.getTiming().duration,
        })),
      }));
    });
    mo.observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  });
}

async function pushDemo(page, times) {
  for (let i = 0; i < times; i += 1) {
    const depth = await page.evaluate(() => history.state.depth);
    await page.click(depth === 0 ? tid('demo-push') : topSel('demo-push-next'));
    await waitNavIdle(page);
  }
}

export default async function gesture(page, ctx) {
  const { assert, step } = ctx;
  const W = ctx.viewport.width;

  step('boot (test host)');
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(() => {
    window.__e2eAlive = true;
    window.__animLog = [];
    const app = document.querySelector('.sz-app');
    new MutationObserver(() => {
      const v = app.dataset.navAnim;
      if (window.__animLog[window.__animLog.length - 1] !== v) window.__animLog.push(v);
    }).observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  });
  const href = page.url();
  let L = await layers(page);
  assert.equal(L.depth, 0, 'starts at the tab root');

  step('tab root: progress events are ignored, the page does not move or leave');
  await swift(page, 'began', 0);
  await swift(page, 'changed', 200);
  L = await layers(page);
  assert.equal(L.navAnim, 'idle', 'no drag at the tab root');
  assert.deepEqual(L.inline, [], 'no layer is transformed');
  assert.equal(await swift(page, 'ended', 200, 900), true, 'Swift would fire shizi-native-back (past threshold)');
  await page.waitForTimeout(300);
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 0, 'still depth 0');
  assert.ok(page.url() === href && await page.evaluate(() => window.__e2eAlive === true), 'same document, same URL');

  step('began freezes the page underneath: revealed at the parallax start, not tappable, no re-render while following');
  await pushDemo(page, 2);
  L = await layers(page);
  assert.deepEqual(L.names, ['home', '_demo/sub', '_demo/sub'], 'two sub pages pushed');
  await swift(page, 'began', 0);
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.navAnim === 'drag');
  L = await layers(page);
  assert.equal(L.top.transform, tx(0), 'top page at translationX 0');
  assert.equal(L.under.transform, tx(underAt(0, W)), `page underneath starts at -${PARALLAX * 100}% width (parallax)`);
  assert.equal(L.under.vis, 'visible', 'page underneath is revealed');
  assert.equal(L.under.pe, 'none', 'page underneath is frozen (pointer-events none)');
  assert.ok(L.under.cls.includes('sz-layer--under'), 'page underneath carries sz-layer--under');
  assert.ok(L.top.cls.includes('sz-layer--moving') && L.top.shadow !== 'none', 'top page casts the left shadow');
  await page.evaluate(() => {
    window.__mut = 0;
    window.__mo = new MutationObserver(list => { window.__mut += list.length; });
    for (const el of document.querySelectorAll('.sz-app > .sz-layer > .sz-layer__screen')) {
      window.__mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    }
  });

  step('changed: top follows translationX, underneath moves with parallax');
  for (const x of [20, 45, 70, 100]) {
    await swift(page, 'changed', x);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  }
  L = await layers(page);
  assert.equal(L.navAnim, 'drag', 'data-nav-anim=drag while following');
  assert.equal(L.top.transform, tx(100), 'top page translateX(100px)');
  assert.equal(L.under.transform, tx(underAt(100, W)), `page underneath translateX(${underAt(100, W)}px)`);
  const hit = await page.evaluate(() => {
    const el = document.elementFromPoint(40, window.innerHeight / 2);
    return el ? (el.closest('.sz-layer') ? el.closest('.sz-layer').dataset.screen : el.className) : null;
  });
  assert.equal(hit, 'sz-app', 'a tap on the revealed strip does not reach the frozen page');
  const mutations = await page.evaluate(() => { window.__mo.disconnect(); return window.__mut; });
  assert.equal(mutations, 0, 'no DOM change inside either page while following (drag does not re-render the pages)');

  step('ended below both thresholds: snap back, stack unchanged');
  const shortX = Math.floor(W * RATIO) - 10;
  assert.equal(await swift(page, 'ended', shortX, 300), false, 'Swift would not fire shizi-native-back');
  L = await layers(page);
  assert.equal(L.top.transform, tx(0), 'top page animates back to 0');
  assert.equal(L.under.transform, tx(underAt(0, W)), 'page underneath animates back to its parallax start');
  assert.ok(L.top.cls.includes('sz-layer--snap') && L.under.cls.includes('sz-layer--snap'), 'both layers carry the snap transition');
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 2, 'still depth 2');
  assert.deepEqual(L.inline, [], 'no transform left on any layer');
  assert.equal(L.top.cls, '', 'top page classes cleaned up');
  assert.equal(L.under.vis, 'hidden', 'page underneath hidden again');

  step('cancelled: snap back, stack unchanged');
  await swift(page, 'began', 3);
  await swift(page, 'changed', 180);
  await swift(page, 'cancelled', 0);
  L = await layers(page);
  assert.equal(L.top.transform, tx(0), 'cancelled → top page snaps back');
  assert.ok(L.top.cls.includes('sz-layer--snap'), 'snap transition');
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 2, 'cancelled keeps the page');
  assert.deepEqual(L.inline, [], 'no transform left');

  step('ended past the distance threshold: commits one back, the pop continues from the finger position');
  await swift(page, 'began', 0);
  await swift(page, 'changed', 200);
  await armPopProbe(page);
  await page.evaluate(() => { window.__animLog.length = 0; });
  assert.equal(await swift(page, 'ended', 200, 300), true, 'Swift fires shizi-native-back right after ended');
  await page.waitForFunction(() => window.__popStart !== null);
  const start = await page.evaluate(() => window.__popStart);
  const leaving = start[start.length - 1];
  const revealed = start[start.length - 2];
  assert.deepEqual(leaving.anims.map(a => [a.from, a.to]), [[tx(200), 'translateX(100%)']], 'leaving page slides out from translateX(200px)');
  assert.ok(leaving.anims[0].duration < 300 && leaving.anims[0].duration >= 150, `remaining-distance duration (${leaving.anims[0].duration}ms, 150–300)`);
  assert.ok(leaving.moving, 'leaving page keeps the shadow during the pop');
  assert.deepEqual(revealed.anims.map(a => [a.from, a.to]), [[tx(underAt(200, W)), 'translateX(0px)']], 'page underneath settles from its parallax position');
  assert.deepEqual(start.map(l => l.inline), ['', '', ''], 'the gesture\'s inline transforms were handed over to the animation');
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 1, 'exactly one page popped (the trailing shizi-native-back was absorbed)');
  assert.deepEqual(L.names, ['home', '_demo/sub'], 'stack: home → demo 1');
  assert.ok(await page.locator(topSel('screen-demo-1')).isVisible(), 'demo 1 is on top');
  assert.deepEqual(L.inline, [], 'no transform left');
  assert.ok((await animLog(page)).includes('pop-slide'), 'pop-slide ran');
  await page.waitForTimeout(700); // 吸收窗口过后不会有迟到的第二次返回
  assert.equal((await layers(page)).depth, 1, 'still depth 1 afterwards');

  step('ended with a fast flick (velocity > 650) commits from a short distance');
  await pushDemo(page, 1);
  await swift(page, 'began', 0);
  await swift(page, 'changed', 30, 900);
  assert.equal(await swift(page, 'ended', 30, 900), true, 'Swift fires shizi-native-back on velocity');
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 1, 'one page popped by the flick');
  assert.deepEqual(L.names, ['home', '_demo/sub'], 'stack: home → demo 1');

  step('overlay open: began closes the top overlay first; the page does not move');
  await page.click(topSel('demo-open-sheet'));
  await waitNavIdle(page);
  assert.ok(await page.locator(tid('demo-sheet')).isVisible(), 'sheet is open');
  assert.equal((await layers(page)).depth, 2, 'overlay takes an entry');
  await swift(page, 'began', 4);
  L = await layers(page);
  assert.ok(L.navAnim !== 'drag', 'page is not dragged');
  assert.deepEqual(L.inline, [], 'no layer transformed');
  await swift(page, 'changed', 250, 900);
  assert.deepEqual((await layers(page)).inline, [], 'rest of the gesture is not followed');
  assert.equal(await swift(page, 'ended', 250, 900), true, 'Swift fires shizi-native-back at the end');
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(await page.locator(tid('demo-sheet')).count(), 0, 'sheet closed');
  assert.equal(L.depth, 1, 'only the overlay was closed (page kept)');
  assert.ok(await page.locator(topSel('screen-demo-1')).isVisible(), 'demo 1 still on top');

  await page.click(topSel('demo-open-confirm'));
  await waitNavIdle(page);
  assert.ok(await page.locator(tid('demo-confirm')).isVisible(), 'confirm dialog is open');
  await swift(page, 'began', 0);
  await swift(page, 'ended', 20, 100);
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(await page.locator(tid('demo-confirm')).count(), 0, 'began closes the confirm dialog even for a short swipe');
  assert.equal(L.depth, 1, 'page kept under the confirm');

  step('prefers-reduced-motion: no following; commit only by threshold (cross-fade)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pushDemo(page, 1);
  await swift(page, 'began', 0);
  await swift(page, 'changed', 200);
  L = await layers(page);
  assert.equal(L.navAnim, 'idle', 'no drag state');
  assert.deepEqual(L.inline, [], 'top page does not follow');
  assert.equal(L.under.vis, 'hidden', 'page underneath not revealed');
  await swift(page, 'ended', 40, 100);
  await page.waitForTimeout(300);
  await waitNavIdle(page);
  assert.equal((await layers(page)).depth, 2, 'below threshold: nothing happens');
  await page.evaluate(() => { window.__animLog.length = 0; });
  await swift(page, 'began', 0);
  await swift(page, 'changed', 200);
  assert.equal(await swift(page, 'ended', 200), true, 'past threshold');
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 1, 'committed one back');
  const reducedLog = await animLog(page);
  assert.ok(reducedLog.includes('pop-fade') && !reducedLog.includes('pop-slide') && !reducedLog.includes('drag'), `cross-fade only (${reducedLog.join(',')})`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  step('shizi-native-back without any progress events (old shell / smoke) still pops one page');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-back')));
  await waitNavIdle(page);
  L = await layers(page);
  assert.equal(L.depth, 0, 'plain native back pops');
  assert.ok(page.url() === href && await page.evaluate(() => window.__e2eAlive === true), 'never left the document');
}
