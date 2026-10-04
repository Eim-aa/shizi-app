// P0-D / D36（G05）→ 阶段 1 P1-E5（D43）：首页主按钮不随字号缩小。
// P1-E5 起主按钮不再是 196×190 的「拾」大块，而是设计稿的墨色主按钮（宽 240 居中、高 54、距 Tab 栏上沿 119，圆角 12）：
// 大字（系统字号 XXXL，模拟原生 shiziContentSize）与短屏紧凑版都保持同一大小、同一位置，整个在首屏内。
// 只量主按钮与「自己选字」的尺寸和位置；首页其余内容的断言在 22-home.spec.js / 72-p1e5-home-first.spec.js。
//
// 视口：393×852、375×667、360×640、320×568，各自系统字号 L / XXXL；同一视口换字号前后尺寸与位置不变。
// 「自己选字」首次打开不显示（D46 ②），所以这里先 seed 一条昨天的判断（首练已完成）。

import { bootTestHost, LARGE_TEXT, setTextSize, tid, waitNavIdle } from './helpers.mjs';

const VIEWS = [
  { width: 393, height: 852 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];
const CTA_W = 240;
const CTA_H = 54;

async function cta(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="home-start"]');
    const r = el.getBoundingClientRect();
    const panel = document.querySelector('.sz-tabroot__panel').getBoundingClientRect();
    const pick = document.querySelector('[data-testid="home-pick"]').getBoundingClientRect();
    return {
      w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, vw: document.documentElement.clientWidth,
      fromBottom: panel.bottom - r.top,
      startInPanel: r.top >= panel.top && r.bottom <= panel.bottom, pickInPanel: pick.top >= panel.top && pick.bottom <= panel.bottom,
      compact: document.querySelector('[data-testid="screen-home"]').dataset.compact,
      large: document.documentElement.hasAttribute('data-text-large'),
    };
  });
}

/** 首练已完成：昨天一条判断（保留其余域），首页出现「自己选字」。 */
async function seedFirstPracticeDone(page) {
  const r = await page.evaluate(() => {
    window.__shiziTest.reset();
    const now = window.__shiziTest.now();
    const at = now - 24 * 3600 * 1000;
    const d = new Date(at);
    const pad = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const rec = { id: 'r1', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'judged', judgment: 'correct', at, localDay: day, help: { hints: 0, answerSeen: false, traced: false } };
    return window.__shiziTest.seed({ records: { [day.slice(0, 7)]: [rec] } });
  });
  if (!r || !r.ok) throw new Error('seed failed');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

export default async function homeCta(page, ctx) {
  const { assert, step } = ctx;
  for (const view of VIEWS) {
    await page.setViewportSize(view);
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await seedFirstPracticeDone(page);
    await page.waitForSelector(tid('home-pick'));
    await waitNavIdle(page, { settleMs: 200 });
    const tag = `${view.width}×${view.height}`;
    step(`${tag}: 主按钮在标准字号与大字下都是 ${CTA_W}×${CTA_H}、整体块在页头与 Tab 栏之间居中（H1 起不再固定距 Tab 栏 119；D36 / G05：按钮不随字号缩小），开关大字前后尺寸不变`);
    const sizes = [];
    for (const large of [false, true]) {
      await setTextSize(page, large ? LARGE_TEXT : 'L');
      await page.waitForTimeout(250);
      const c = await cta(page);
      assert.equal(c.large, large, `${tag}: data-text-large ${large ? 'on' : 'off'}`);
      assert.ok(Math.abs(c.w - CTA_W) < 1 && Math.abs(c.h - CTA_H) < 1,
        `${tag} ${large ? 'large' : 'normal'} (compact=${c.compact}): main button ${CTA_W}×${CTA_H}, got ${c.w.toFixed(1)}×${c.h.toFixed(1)}`);
      assert.ok(Math.abs(c.left + c.w / 2 - c.vw / 2) < 1, `${tag}: centred`);
      assert.ok(c.left >= 0 && c.right <= c.vw, `${tag}: button inside the viewport width`);
      assert.ok(c.startInPanel, `${tag} ${large ? 'large' : 'normal'}: 主按钮整个在首屏内`);
      assert.ok(c.pickInPanel, `${tag} ${large ? 'large' : 'normal'}: 「自己选字」也在首屏内（五态里按钮下方的文字按钮位置固定）`);
      sizes.push([c.w, c.h]);
    }
    assert.deepEqual(sizes[0], sizes[1], `${tag}: same size before and after switching 系统字号`);
  }
  await setTextSize(page, 'L');
}
