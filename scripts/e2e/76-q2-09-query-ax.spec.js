// 阶段 1 Q2-9（复测 simC D5）：AX3 下查字 / 自选字弹层在键盘弹起后内容区只剩约 17pt，候选卡看不到。
// 现在：大字号（紧凑排布，--k ≥ 1.3）下弹层用满可见区的全高，内容区至少能放下一张候选卡 / 一行候选字；输入框与主按钮仍钉在可见区里（F5，48-query-keyboard 不回退）。
//
// 模拟：375×667（iPhone SE 3）布局视口不变，假的 visualViewport 缩到 376（键盘 + 候选栏约 291pt），系统字号 AX3（模拟原生 shiziContentSize）。
import { bootTestHost, setTextSize, tid, topSel, waitNavIdle } from './helpers.mjs';
import { markFirstPracticeDone } from './home-helpers.mjs';

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

async function openPick(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  await markFirstPracticeDone(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('home-pick')}`);
  await page.waitForSelector('.sz-sheet [data-testid="query-input"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function openLookup(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
  await page.waitForSelector('.sz-sheet [data-testid="query-input"]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
}

async function measure(page) {
  return page.evaluate(() => {
    const vv = window.visualViewport;
    const rect = el => (el ? el.getBoundingClientRect() : null);
    const scroller = document.querySelector('[data-testid="query-scroll"]');
    const panel = document.querySelector('.sz-sheet');
    const input = rect(document.querySelector('[data-testid="query-input"]'));
    const go = rect(document.querySelector('[data-testid="query-card-practice"], [data-testid="query-go"]'));
    const card = rect(document.querySelector('[data-testid="query-card"]'));
    const row = rect(document.querySelector('[data-testid="query-row"]'));
    const first = document.querySelector('[data-testid="query-card-head"], [data-testid="query-row"]');
    return {
      visBottom: vv.offsetTop + vv.height,
      scrollerH: scroller ? Math.round(scroller.clientHeight) : 0,
      panelTop: Math.round(panel.getBoundingClientRect().top),
      panelBottom: Math.round(panel.getBoundingClientRect().bottom),
      panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
      inputTop: input ? Math.round(input.top) : null,
      inputBottom: input ? Math.round(input.bottom) : null,
      goTop: go ? Math.round(go.top) : null,
      goBottom: go ? Math.round(go.bottom) : null,
      cardH: card ? Math.round(card.height) : null,
      rowH: row ? Math.round(row.height) : null,
      firstH: first ? Math.round(first.getBoundingClientRect().height) : null,
      text: document.documentElement.getAttribute('data-text-size'),
    };
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await page.setViewportSize({ width: 375, height: 667 });
  await bootTestHost(page, ctx.baseURL);

  for (const [name, open] of [['自己选字 (pick)', openPick], ['字库查字 (lookup)', openLookup]]) {
    step(`${name} · AX3 · 375×667 · 键盘弹起（可见区 376）: 单字 → 卡片`);
    await page.reload();
    await page.waitForFunction(() => typeof window.__shiziTest === 'object');
    await waitNavIdle(page);
    await page.evaluate(() => window.__shiziTest.reset());
    await setTextSize(page, 'AX3');
    await installFakeViewport(page);
    await open(page);
    await page.fill(tid('query-input'), '春');
    await page.waitForSelector('.sz-sheet [data-testid="query-card"][data-char="春"]');
    await setVisibleHeight(page, 376);
    let m = await measure(page);
    assert.equal(m.text, 'AX3', 'system size AX3');
    assert.ok(m.panelTop >= 0 && m.panelBottom <= m.visBottom + 1, `sheet inside the visible area (${m.panelTop}–${m.panelBottom} within 0–${m.visBottom})`);
    assert.equal(m.panelScrolls, false, 'the sheet itself does not scroll');
    assert.ok(m.inputTop >= 0 && m.inputBottom <= m.visBottom, `input visible (${m.inputTop}–${m.inputBottom})`);
    assert.ok(m.goTop >= 0 && m.goBottom <= m.visBottom + 0.5, `main action visible (${m.goTop}–${m.goBottom})`);
    assert.ok(m.scrollerH >= 100, `content area is at least 100pt tall at AX3 (was ~17): ${m.scrollerH}`);
    assert.ok(m.panelTop <= 1, `AX3: the sheet takes the full visible height (top ${m.panelTop})`);

    step(`${name} · AX3 · 多个字 → 候选行至少能显示一行`);
    await page.fill(tid('query-input'), '春夏秋');
    await page.waitForSelector('.sz-sheet [data-testid="query-rows"]');
    await page.waitForTimeout(80);
    m = await measure(page);
    assert.ok(m.rowH > 0 && m.scrollerH >= m.rowH, `one candidate row (${m.rowH}) fits in the content area (${m.scrollerH})`);
    assert.ok(m.goBottom === null || m.goBottom <= m.visBottom + 0.5, 'main bar still visible');
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await page.waitForFunction(() => !document.querySelector('.sz-sheet'));
    await waitNavIdle(page);
  }
}
