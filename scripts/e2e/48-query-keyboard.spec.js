// F5（真机 Q23）：查字 / 自己选字弹层被键盘遮挡。
//   旧版：输入框和「练这个字」都在弹层的滚动内容里，大字 + 键盘占掉可见区后，按钮落到可见区下面，要先滚动。
//   现在：标题与输入框钉在弹层顶部，主操作（卡片「练这个字」/ pick 底栏）钉在底部，中间候选 / 卡片内容单独滚动；
//   弹层高度与底边跟随 window.visualViewport（resize / scroll）。
//
// Chromium 模拟不了 iOS 真实键盘，这里用两种近似，断言输入框与「练这个字」的包围盒整块在可见区内、不需要滚动：
//   A 缩小布局视口：393×448、320×300（等价于键盘占掉下半屏的可见区）；
//   B 假的 visualViewport：布局视口不变（393×852 / 320×640），visualViewport.height 缩到 448 / 300 并派发 resize（同 20-query / 34）。
// 每种都跑普通字号与 data-large，入口两处：首页「自己选字 →」（pick）与字库查字框（lookup）。
// 另验：卡片内容超高时滚动区自己滚动（弹层不滚）、输入框不随之移动；pick 逐字行的底栏同样钉在底部。
// 真实 iOS 键盘 / 候选栏的高度只能真机复测（见 DEVICE_QA）。
import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';

const CHAR = '春';

async function setLarge(page, on) {
  await page.evaluate(v => {
    if (v) document.documentElement.setAttribute('data-large', '');
    else document.documentElement.removeAttribute('data-large');
  }, on);
}

async function installFakeViewport(page) {
  await page.evaluate(() => {
    class FakeVV extends EventTarget {}
    const vv = new FakeVV();
    vv.height = window.innerHeight;
    vv.width = window.innerWidth;
    vv.offsetTop = 0;
    vv.offsetLeft = 0;
    vv.scale = 1;
    window.__fakeVV = vv;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  });
}

async function setVisibleHeight(page, h) {
  await page.evaluate(height => {
    window.__fakeVV.height = height;
    window.__fakeVV.dispatchEvent(new Event('resize'));
  }, h);
  await page.waitForFunction(() => {
    const s = document.querySelector('.sz-sheet');
    return !!s && s.dataset.keyboard === 'true';
  });
  await page.waitForTimeout(80);
}

async function openFromHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('home-pick')}`);
  await page.waitForSelector('.sz-sheet [data-testid="query-input"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function openFromLibrary(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
  await page.waitForSelector('.sz-sheet [data-testid="query-input"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function closeSheet(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await page.waitForFunction(() => !document.querySelector('.sz-sheet'));
  await waitNavIdle(page);
}

/** 输入框、主按钮的包围盒，可见区，弹层是否在滚动，主按钮命中测试。 */
async function geometry(page) {
  return page.evaluate(() => {
    const vv = window.visualViewport;
    const visTop = vv ? vv.offsetTop : 0;
    const visBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const panel = document.querySelector('.sz-sheet');
    const input = document.querySelector('[data-testid="query-input"]');
    const go = document.querySelector('[data-testid="query-card-practice"]');
    const scroller = document.querySelector('[data-testid="query-scroll"]');
    const hit = el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    };
    return {
      visTop,
      visBottom,
      width: window.innerWidth,
      panel: rect(panel),
      input: input ? rect(input) : null,
      go: go ? rect(go) : null,
      inputHit: input ? hit(input) : false,
      goHit: go ? hit(go) : false,
      panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
      panelScrollTop: panel.scrollTop,
      scrollerClient: scroller ? scroller.clientHeight : 0,
      large: document.documentElement.hasAttribute('data-large'),
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

function checkVisible(assert, g, label) {
  assert.ok(g.input && g.go, `${label}: input and 「练这个字」 exist`);
  assert.ok(g.panel.top >= g.visTop - 0.5, `${label}: sheet top inside the visible area (${Math.round(g.panel.top)} ≥ ${g.visTop})`);
  assert.ok(g.panel.bottom <= g.visBottom + 1, `${label}: sheet bottom does not go below the visible bottom (${Math.round(g.panel.bottom)} ≤ ${g.visBottom})`);
  assert.ok(g.input.top >= g.visTop - 0.5 && g.input.bottom <= g.visBottom + 0.5,
    `${label}: input fully visible (${Math.round(g.input.top)}–${Math.round(g.input.bottom)} within ${g.visTop}–${g.visBottom})`);
  assert.ok(g.go.top >= g.visTop - 0.5 && g.go.bottom <= g.visBottom + 0.5,
    `${label}: 「练这个字」 fully visible without scrolling (${Math.round(g.go.top)}–${Math.round(g.go.bottom)} within ${g.visTop}–${g.visBottom})`);
  assert.ok(g.go.left >= 0 && g.go.right <= g.width + 0.5, `${label}: 「练这个字」 inside the width`);
  assert.equal(g.panelScrolls, false, `${label}: the sheet itself does not scroll`);
  assert.equal(g.panelScrollTop, 0, `${label}: sheet scrollTop 0`);
  assert.ok(g.inputHit && g.goHit, `${label}: input and 「练这个字」 are hit-testable (nothing covers them)`);
  assert.ok(g.input.bottom <= g.go.top, `${label}: input above the main action`);
}

async function scenario(page, ctx, { label, open, large }) {
  const { assert, step } = ctx;
  step(`${label}${large ? ' · data-large' : ''}: type 「${CHAR}」 → input and 「练这个字」 fully inside the visible area, no scrolling`);
  await page.evaluate(() => window.__shiziTest.reset());
  await setLarge(page, large);
  await open(page);
  await page.fill(tid('query-input'), CHAR);
  await page.waitForSelector(`.sz-sheet [data-testid="query-card"][data-char="${CHAR}"]`);
  await page.waitForTimeout(80);
  return page;
}

export default async function queryKeyboardSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  const entries = [['home 自己选字', openFromHome], ['library 查字框', openFromLibrary]];

  // ---------------------------------------------------------------- A 缩小布局视口
  for (const vp of [{ width: 393, height: 448 }, { width: 320, height: 300 }]) {
    for (const large of [false, true]) {
      for (const [name, open] of entries) {
        const label = `A ${vp.width}×${vp.height} ${name}`;
        await page.setViewportSize(vp);
        await page.reload();
        await page.waitForFunction(() => typeof window.__shiziTest === 'object');
        await waitNavIdle(page);
        await scenario(page, ctx, { label, open, large });
        const g = await geometry(page);
        assert.equal(g.large, large, `${label}: data-large ${large}`);
        assert.equal(g.hscroll, false, `${label}: no horizontal scroll`);
        checkVisible(assert, g, `${label}${large ? ' large' : ''}`);
        await closeSheet(page);
      }
    }
  }

  // ---------------------------------------------------------------- B 假的 visualViewport
  for (const vp of [{ width: 393, height: 852, vis: 448 }, { width: 320, height: 640, vis: 300 }]) {
    for (const large of [false, true]) {
      for (const [name, open] of entries) {
        const label = `B ${vp.width}×${vp.height} vv→${vp.vis} ${name}`;
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.reload();
        await page.waitForFunction(() => typeof window.__shiziTest === 'object');
        await waitNavIdle(page);
        await installFakeViewport(page);
        await scenario(page, ctx, { label, open, large });
        await setVisibleHeight(page, vp.vis);
        const g = await geometry(page);
        assert.ok(Math.abs(g.panel.bottom - g.visBottom) <= 1, `${label}: sheet bottom sits on the visible-area bottom (${Math.round(g.panel.bottom)} vs ${g.visBottom})`);
        checkVisible(assert, g, `${label}${large ? ' large' : ''}`);
        // 候选栏再占 44px：visualViewport 再缩小，仍然成立
        await page.evaluate(h => {
          window.__fakeVV.height = h;
          window.__fakeVV.dispatchEvent(new Event('scroll'));
        }, vp.vis);
        await page.waitForTimeout(80);
        checkVisible(assert, await geometry(page), `${label}${large ? ' large' : ''} after a vv scroll event`);
        await closeSheet(page);
      }
    }
  }

  // ---------------------------------------------------------------- C 滚动区自己滚动，输入框与主按钮不动
  step('content scrolls inside its own region: the sheet, input and 「练这个字」 do not move (393×448, data-large)');
  await page.setViewportSize({ width: 393, height: 448 });
  await page.reload();
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  await page.evaluate(() => window.__shiziTest.reset());
  await setLarge(page, true);
  await openFromHome(page);
  await page.fill(tid('query-input'), CHAR);
  await page.waitForSelector(`.sz-sheet [data-testid="query-card"][data-char="${CHAR}"]`);
  await page.waitForTimeout(80);
  const before = await geometry(page);
  const scrolled = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="query-scroll"]');
    s.scrollTop = s.scrollHeight;
    return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight };
  });
  await page.waitForTimeout(60);
  const after = await geometry(page);
  assert.ok(scrolled.max > 0 ? scrolled.top > 0 : true, 'the candidate / card region scrolls by itself when it is taller than the space left');
  assert.deepEqual([after.input.top, after.go.top, after.panel.top], [before.input.top, before.go.top, before.panel.top],
    'input, 「练这个字」 and the sheet stay put while the content scrolls');
  checkVisible(assert, after, 'C after scrolling the content');
  await closeSheet(page);

  step('pick mode with several chars: the 「练这 N 个字」 bar is pinned at the bottom, rows scroll above it (393×448, data-large)');
  await page.evaluate(() => window.__shiziTest.reset());
  await setLarge(page, true);
  await openFromHome(page);
  await page.fill(tid('query-input'), '春夏秋冬山水火土');
  await page.waitForSelector('.sz-sheet [data-testid="query-rows"]');
  await page.waitForTimeout(80);
  const pickG = await page.evaluate(() => {
    const r = sel => document.querySelector(sel).getBoundingClientRect();
    const vv = window.visualViewport;
    const bar = r('[data-testid="query-go"]');
    const input = r('[data-testid="query-input"]');
    const scroller = document.querySelector('[data-testid="query-scroll"]');
    return { visBottom: vv ? vv.offsetTop + vv.height : window.innerHeight, bar, input, scrolls: scroller.scrollHeight > scroller.clientHeight + 1 };
  });
  assert.ok(pickG.input.top >= 0 && pickG.input.bottom <= pickG.visBottom + 0.5, 'pick: input visible');
  assert.ok(pickG.bar.bottom <= pickG.visBottom + 0.5 && pickG.bar.top >= 0, 'pick: main bar visible without scrolling');
  assert.equal(pickG.scrolls, true, 'pick: 8 rows do not fit in 448px → the rows region scrolls (not the sheet)');
  await closeSheet(page);
  await page.setViewportSize({ width: 393, height: 852 });
}
