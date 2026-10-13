// R6-J1（交互与动效规范 T0-6 / §8b IC-23；产品负责人 2026-10-12：「首页点『接着写』进入写字页后右滑或点左上角返回的效果，和点首页主按钮进入写字页后返回的效果不一样」）：
// 写字页进出只有一种语言——无论从哪个元素进入，纸都从被点元素的矩形展开（B1），返回沿原路缩回它；屏上没有来源元素的入口（通知 / 深链）才是 B3。
// 逐帧采样：paper-transition.js watchPaperFrames 每画一帧同步回调，在同一个任务里量那一层的矩形——
//   进场第一帧（s = 0）的矩形 = 被点元素的矩形（± 1）；点「‹」/ 左缘右滑返回的最后一帧（s = 0）= 被点元素此刻的矩形（± 1）；
//   被点元素已不在屏上（自己选字弹层已关、结果页已被换掉）时缩回它原来的位置并淡出（最后一帧透明度 ≤ 0.05）。
// D62（2026-10-13 真机反馈，覆盖 T0-6「任何入口都 B1」）：写字页转场按「回到哪里」定——只有从首页进入（主按钮、「接着写」；返回回到首页那个入口）才是 B1；
//   其它入口（字库「今日练习」、区详情「练这些字」、字详情「练这个字」、查字「练这个字」、全部页「练这些字」、结果页「再写一组」）一律普通推入：
//   从右推入（data-nav-anim = push-slide / replace-slide，写字页那层 left 从屏宽走到 0）、没有任何纸帧；返回往右滑出（pop-slide，left 从 0 走到屏宽），「‹」与左缘右滑同一套。
// 入口：首页主按钮、「接着写」（文字按钮）、自己选字「练这个字」（查字弹层里）、字库「练这些字」、单字详情「练这个字」、全部字「练这些字」、结果页「再写一组」。

import { bootTestHost, drawStroke, HORIZONTAL, makeSession, tap, tid, topSel, waitNavIdle } from './helpers.mjs';
import { push, settle, toHome } from './i2-helpers.mjs';
import { seedRich, swipeBack } from './ic-lib.mjs';

/* eslint-disable no-undef */
async function startPaperWatch() {
  window.__paperFrames = [];
  if (window.__paperUnwatch) window.__paperUnwatch();
  const { watchPaperFrames } = await import('/src/ui/paper-transition.js');
  window.__paperUnwatch = watchPaperFrames(({ layer: l, s, mode }) => {
    const r = l.getBoundingClientRect();
    window.__paperFrames.push({ s, mode, screen: l.dataset.screen, x: r.left, y: r.top, w: r.width, h: r.height, op: l.style.opacity === '' ? 1 : parseFloat(l.style.opacity) });
  });
}
function stopPaperWatch() {
  if (window.__paperUnwatch) window.__paperUnwatch();
  window.__paperUnwatch = null;
  return window.__paperFrames;
}
/** 逐帧记 data-nav-anim 与写字页那层的左边（普通推入的断言用）。 */
async function startSlideWatch() {
  window.__slide = { anims: new Set(), lefts: [], stop: false };
  const tick = () => {
    const app = document.querySelector('.sz-app');
    if (app) window.__slide.anims.add(app.dataset.navAnim);
    const l = document.querySelector('.sz-layer[data-screen="write"]');
    if (l) window.__slide.lefts.push(l.getBoundingClientRect().left);
    if (!window.__slide.stop) requestAnimationFrame(tick);
  };
  tick();
}
function stopSlideWatch() {
  window.__slide.stop = true;
  return { anims: [...window.__slide.anims], lefts: window.__slide.lefts };
}
function rectOfSel(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
/* eslint-enable no-undef */

const close = (a, b, tol = 1) => !!a && !!b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= tol);
const fmt = r => (r ? `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}×${r.h.toFixed(1)}` : 'null');

async function seedTwoGroups(page) {
  const A = makeSession({ id: 's1', slot: 'A', kind: 'daily', chars: ['永', '和', '春'] });
  const B = makeSession({ id: 's2', slot: 'B', kind: 'picked', chars: ['根', '据'] });
  const r = await page.evaluate(st => {
    window.__shiziTest.reset();
    return window.__shiziTest.seed(st);
  }, { sessions: { A, B, lastEnded: {} } });
  if (!r || !r.ok) throw new Error(`seed failed ${JSON.stringify(r)}`);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function finishGroup(page) {
  await toHome(page);
  const A = makeSession({ id: 's1', slot: 'A', kind: 'daily', chars: ['永'] });
  await page.evaluate(st => {
    window.__shiziTest.reset();
    window.__shiziTest.seed(st);
  }, { sessions: { A, B: null, lastEnded: {} } });
  await push(page, 'write', { slot: 'A' });
  await drawStroke(page, HORIZONTAL);
  await tap(page, 'write-done');
  await tap(page, 'write-judge-correct');
  await page.waitForSelector(topSel('result-screen'));
  await settle(page);
}

export default async function j1WriteEntries(page, ctx) {
  const { assert, step, baseURL } = ctx;
  step('boot (test host)');
  await bootTestHost(page, baseURL);
  const toTab = async tab => {
    await page.evaluate(async t => (await import('/src/ui/router.js')).nav.switchTab(t), tab);
    await page.waitForFunction(t => document.querySelector('.sz-app').dataset.topScreen === t, tab);
    await waitNavIdle(page);
  };

  const ENTRIES = [
    { name: 'home main button (primary)', prep: async () => { await seedRich(page); await toHome(page); }, sel: topSel('home-start'), solid: true, home: true },
    { name: 'home 「接着写」 (text button)', prep: async () => { await toHome(page); await seedTwoGroups(page); await page.waitForSelector(topSel('other-line')); await waitNavIdle(page); }, sel: topSel('other-line'), swipe: true, home: true },
    {
      name: '自己选字 「练这个字」 (in the pick sheet, which closes)',
      prep: async () => {
        await seedRich(page);
        await toHome(page);
        await tap(page, 'home-pick');
        await page.waitForSelector(tid('query-input'));
        await page.fill(tid('query-input'), '永');
        await page.waitForSelector(tid('query-card-practice'));
        await page.waitForTimeout(500);
      },
      sel: tid('query-card-practice'),
      gone: true,
    },
    { name: '字库 「今日练习」', prep: async () => { await seedRich(page); await toTab('library'); }, sel: topSel('library-today') },
    { name: '字库区详情页 「练这些字」', prep: async () => { await seedRich(page); await toTab('library'); await push(page, 'library-list', { kind: 'due' }); await page.waitForSelector(topSel('list-go')); await waitNavIdle(page); }, sel: topSel('list-go') },
    { name: '单字详情 「练这个字」', prep: async () => { const i = await seedRich(page); await push(page, 'detail', { char: i.detailChar }); }, sel: topSel('detail-practice'), swipe: true },
    { name: '全部字 「练这些字」', prep: async () => {
        await seedRich(page);
        await toHome(page);
        await push(page, 'library-all', {});
        await page.click(topSel('all-menu-open'));
        await page.waitForSelector(topSel('all-menu'));
        await waitNavIdle(page);
        await page.click(`${topSel('all-menu')} [data-testid="all-chip"][data-key="unw"]`);
        await waitNavIdle(page);
        await page.waitForSelector(topSel('all-go'));
      },
      sel: topSel('all-go'),
    },
    { name: '结果页 「再写一组」 (replaces the result page)', prep: async () => { await finishGroup(page); }, sel: topSel('result-again'), gone: true, replace: true },
  ];

  for (const e of ENTRIES) {
    step(`IC-23 ${e.name}: ${e.home ? 'the paper grows out of the tapped element and shrinks back into it' : 'plain push in from the right, plain slide out on the way back (D62)'}`);
    await e.prep();
    await waitNavIdle(page);
    const R = await page.evaluate(rectOfSel, e.sel);
    assert.ok(R && R.w > 0 && R.h > 0, `${e.name}: the entry is on screen (${fmt(R)})`);
    await page.evaluate(startPaperWatch);
    await page.evaluate(startSlideWatch);
    await page.click(e.sel);
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write', null, { timeout: 15000 });
    await waitNavIdle(page);
    const open = (await page.evaluate(stopPaperWatch)).filter(f => f.screen === 'write');
    const openSlide = await page.evaluate(stopSlideWatch);
    if (!e.home) {
      const W = await page.evaluate(() => window.innerWidth);
      const want = e.replace ? 'replace-slide' : 'push-slide';
      assert.equal(open.length, 0, `${e.name}: no paper frames on the way in (${open.length})`);
      assert.ok(openSlide.anims.includes(want), `${e.name}: in as ${want} (${openSlide.anims.join('/')})`);
      assert.ok(openSlide.lefts.length >= 3 && openSlide.lefts[0] > W * 0.5 && openSlide.lefts[openSlide.lefts.length - 1] === 0, `${e.name}: the write page slides in from the right (left ${openSlide.lefts[0]} → ${openSlide.lefts[openSlide.lefts.length - 1]})`);
      await page.evaluate(startPaperWatch);
      await page.evaluate(startSlideWatch);
      await page.waitForTimeout(450);
      if (e.swipe) await swipeBack(page, { to: 0.5 });
      else await page.click(topSel('page-back'));
      await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen !== 'write', null, { timeout: 15000 });
      await waitNavIdle(page);
      const backPaper = (await page.evaluate(stopPaperWatch)).filter(f => f.screen === 'write');
      const backSlide = await page.evaluate(stopSlideWatch);
      assert.equal(backPaper.length, 0, `${e.name}: no paper frames on the way back (${backPaper.length})`);
      assert.ok(backSlide.lefts.length >= 2 && backSlide.lefts[backSlide.lefts.length - 1] >= W * 0.9, `${e.name}: the write page slides out to the right (left → ${backSlide.lefts[backSlide.lefts.length - 1]})`);
      if (!e.swipe) assert.ok(backSlide.anims.includes('pop-slide'), `${e.name}: out as pop-slide (${backSlide.anims.join('/')})`);
      continue;
    }
    assert.ok(open.length >= 3, `${e.name}: the open is a paper transition (${open.length} frames, modes ${[...new Set(open.map(f => f.mode))].join('/')})`);
    assert.ok(open.every(f => f.mode === 'B1'), `${e.name}: B1, not B3 (${[...new Set(open.map(f => f.mode))].join('/')})`);
    const first = open[0];
    assert.ok(first.s === 0 && close(first, R), `${e.name}: first frame = the tapped element (s ${first.s}; frame ${fmt(first)} vs element ${fmt(R)})`);
    assert.equal(open[open.length - 1].s, 1, `${e.name}: ends as the whole page`);

    await page.evaluate(startPaperWatch);
    if (e.swipe) {
      await page.waitForTimeout(450);
      await swipeBack(page, { to: 0.5 });
    } else {
      await page.waitForTimeout(450);
      await page.click(topSel('page-back'));
    }
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen !== 'write', null, { timeout: 15000 });
    await waitNavIdle(page);
    const back = (await page.evaluate(stopPaperWatch)).filter(f => f.screen === 'write');
    assert.ok(back.length >= 2 && back.every(f => f.mode === 'B1'), `${e.name}: ${e.swipe ? 'the edge swipe' : '「‹」'} goes back by the same B1 path (${back.length} frames, ${[...new Set(back.map(f => f.mode))].join('/')})`);
    const last = back[back.length - 1];
    const target = e.gone ? R : await page.evaluate(rectOfSel, e.sel);
    assert.ok(last.s === 0 && close(last, target), `${e.name}: last frame = the element ${e.gone ? '(gone: where it was)' : 'as it is now'} (s ${last.s}, op ${last.op}; frame ${fmt(last)} vs ${fmt(target)})`);
    if (e.gone) assert.ok(last.op <= 0.05, `${e.name}: the element is gone, so the paper fades out as it lands (opacity ${last.op})`);
  }

  step('IC-23 no element on screen (notification / deep link → nav.push): B3 quiet fade (B3 unchanged by D62)');
  await seedRich(page);
  await toHome(page);
  await page.evaluate(startPaperWatch);
  await push(page, 'write', { slot: 'A' });
  const quiet = (await page.evaluate(stopPaperWatch)).filter(f => f.screen === 'write');
  assert.ok(quiet.length >= 2 && quiet.every(f => f.mode === 'B3'), `a push without a tap is B3 (${[...new Set(quiet.map(f => f.mode))].join('/')})`);
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}
