// R3-K1（ADA A3-04）：AX5 弹层内不叠字。
//   - 查字弹层全高（键盘弹起）时，「完成」与查字框同一行但不相交（「完成」字号封顶 22，查字框右侧让出它的实际宽度）；内容区高度不变（76-q2-09 照旧）；
//   - 分享预览的比例分段「3:4 / 1:1」在 AX 档是两行满宽的单选，每段 ≥ 44 高，文字不出段、两段不叠（旧：60 宽两段，读成「3:41:1」）；
//   - 弹层标题在 AX 档均衡折行（text-wrap:balance），不再「这次的图 / 片」。
// 新旧对照：旧实现下 AX5 402×874 的「完成」与查字框相交，比例两段的文字溢出各自的按钮。
import { bootTestHost, setTextSize, tid, waitNavIdle } from './helpers.mjs';

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

const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size] of [[{ width: 402, height: 874 }, 'AX5'], [{ width: 375, height: 667 }, 'AX5'], [{ width: 375, height: 667 }, 'AX3']]) {
    const tag = `${view.width}×${view.height} ${size}`;
    await page.setViewportSize(view);
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await page.evaluate(() => window.__shiziTest.reset());
    await setTextSize(page, size);

    step(`${tag} 查字弹层全高: 「完成」 and the query box share a row without touching`);
    await installFakeViewport(page);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
    await waitNavIdle(page);
    await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
    await page.waitForSelector('.sz-sheet [data-testid="query-input"]');
    await waitNavIdle(page);
    await page.evaluate(() => {
      window.__fakeVV.height = Math.round(window.innerHeight * 0.55);
      window.__fakeVV.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.querySelector('.sz-sheet[data-testid="query-sheet"]').dataset.full === 'true');
    await page.waitForTimeout(120);
    const q = await page.evaluate(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      const done = document.querySelector('.sz-sheet[data-testid="query-sheet"] .sz-sheet__done');
      const wrap = document.querySelector('.sz-sheet[data-testid="query-sheet"] .sz-query__input');
      return { done: r(done), wrap: r(wrap), doneOverflow: done.scrollWidth > done.clientWidth + 1, vw: document.documentElement.clientWidth };
    });
    assert.ok(!overlaps(q.done, q.wrap), `${tag}: 完成 ${q.done.left.toFixed(0)}–${q.done.right.toFixed(0)} does not touch the box ${q.wrap.left.toFixed(0)}–${q.wrap.right.toFixed(0)}`);
    assert.ok(q.done.right <= q.vw + 0.5 && !q.doneOverflow, `${tag}: 完成 is whole on screen`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await page.waitForFunction(() => !document.querySelector('.sz-sheet'));
    await waitNavIdle(page);

    step(`${tag} 分享预览: the ratio choice is two full-width rows ≥ 44, text inside each; the title wraps balanced`);
    await page.evaluate(async () => {
      const { ImagePreview } = await import('/src/ui/components/image-preview.js');
      const { nav } = await import('/src/ui/router.js');
      const job = {
        kind: 'test', title: '这次的图片', ratios: ['3:4', '1:1'], initialRatio: '1:1',
        status: () => 'ready', pageCount: () => 1,
        renderPage: async () => { const c = document.createElement('canvas'); c.width = 270; c.height = 270; return { status: 'ready', canvas: c }; },
        fileName: () => 'test.jpg',
      };
      nav.openOverlay(ImagePreview, { job }, { name: 'image-preview' });
    });
    await page.waitForSelector('[data-testid="image-preview"] [data-testid="image-ratio"]');
    await waitNavIdle(page);
    const r = await page.$$eval('[data-testid="image-ratio"]', els => els.map(e => {
      const b = e.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(e);
      const t = [...range.getClientRects()].filter(x => x.width > 0.5);
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, h: b.height, inside: t.every(x => x.left >= b.left - 1 && x.right <= b.right + 1) };
    }));
    assert.equal(r.length, 2);
    assert.ok(r.every(x => x.h >= 44 - 0.5 && x.inside), `${tag}: each option ≥ 44 high with its text inside (${r.map(x => x.h.toFixed(0)).join(' / ')})`);
    assert.ok(r[1].top >= r[0].bottom - 0.5, `${tag}: the two options are stacked, not side by side`);
    assert.ok(!overlaps(r[0], r[1]), `${tag}: the options do not overlap`);
    const title = await page.$eval('[data-testid="image-preview"] .sz-sheet__title, .sz-sheet .sz-sheet__title', el => getComputedStyle(el).textWrap || getComputedStyle(el).textWrapStyle || '');
    assert.ok(/balance/.test(title), `${tag}: sheet title text-wrap is balance (${title})`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await page.waitForTimeout(300);
  }
}
