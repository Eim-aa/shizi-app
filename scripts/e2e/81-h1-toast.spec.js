// H1-5（I2-04）：返回首页时的「已保存，下次接着写」Toast 不再盖住主按钮「继续写字」。
//   Toast 的放置规则（components/Toast.js toastBottom）：默认距底 110（Tab 条上方）；默认位置压住当前页的主按钮时整条抬到主按钮上沿之上 12。
//   断言真实包围盒：Toast 与主按钮不相交（间距 ≥ 12）、主按钮中心点仍命中按钮（不是 Toast）；主按钮不在默认位置附近的页面 Toast 仍在默认位置。
//   393×852 与 375×667、浅 / 深。
import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
async function rects(page, btnSel) {
  return page.evaluate(sel => {
    const r = el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const toast = document.querySelector('[data-testid="toast"]');
    const btn = document.querySelector(sel);
    if (!toast || !btn) return { toast: !!toast, btn: !!btn };
    const t = r(toast);
    const b = r(btn);
    const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    return { toast: t, btn: b, text: toast.textContent.trim(), hitIsBtn: !!hit && (hit === btn || btn.contains(hit)), vh: window.innerHeight };
  }, btnSel);
}
const intersects = (a, b) => a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  const runs = [
    { tag: '393×852 light', width: 393, height: 852, scheme: 'light' },
    { tag: '375×667 dark', width: 375, height: 667, scheme: 'dark' },
  ];
  let page = page0;
  for (const [i, v] of runs.entries()) {
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);

    step(`${v.tag}: 写到一半回首页 → 「已保存，下次接着写」不盖「继续写字」`);
    await seedHomeSpec(page, { entries: [], groups: [{ at: '2026-10-05T12:00:00', chars: [...'疆嚷醋膝窗'], steps: ['correct', 'correct'] }], clock: '2026-10-05T12:30:00' });
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]').dataset.view === 'progress');
    await page.click(topSel('home-start'));
    await page.waitForSelector(topSel('write-screen'));
    await waitNavIdle(page);
    await page.click(topSel('page-back'));
    await page.waitForSelector(tid('toast'));
    await page.waitForSelector(topSel('home-start'));
    await page.waitForTimeout(450); // 过了转场与 Toast 淡入
    const r = await rects(page, topSel('home-start'));
    assert.equal(r.text, '已保存，下次接着写', `${v.tag}: the toast is up`);
    assert.equal(intersects(r.toast, r.btn), false, `${v.tag}: the toast box does not intersect the main button (toast ${Math.round(r.toast.top)}–${Math.round(r.toast.bottom)}, button ${Math.round(r.btn.top)}–${Math.round(r.btn.bottom)})`);
    assert.ok(r.btn.top - r.toast.bottom >= 12 - 0.5, `${v.tag}: at least 12 between the toast and the button (${(r.btn.top - r.toast.bottom).toFixed(1)})`);
    assert.equal(r.hitIsBtn, true, `${v.tag}: the centre of 继续写字 hits the button`);
    assert.ok(r.toast.left >= 19.5 && r.toast.right <= v.width - 19.5, `${v.tag}: the toast stays inside the page margins`);

    step(`${v.tag}: 详情页：主按钮「练这个字」在默认位置附近，Toast 同样让开；没有主按钮的页面 Toast 仍在默认位置`);
    await page.waitForTimeout(3500); // 等这条 Toast 消失
    await seedHomeSpec(page, { entries: [...'疆酱肆'].map((c, i2) => ({ char: c, at: `2026-10-0${1 + i2}T20:00:00` })), clock: '2026-10-05T19:30:00' });
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('detail', { char: '疆' }));
    await waitNavIdle(page);
    await page.evaluate(async () => (await import('/src/ui/components/Toast.js')).showToast('测试提示'));
    await page.waitForSelector(tid('toast'));
    await page.waitForTimeout(300);
    const d = await rects(page, topSel('detail-practice'));
    assert.equal(intersects(d.toast, d.btn), false, `${v.tag} detail: the toast does not cover 练这个字`);
    assert.equal(d.hitIsBtn, true, `${v.tag} detail: 练这个字 still hit`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await waitNavIdle(page);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
    await waitNavIdle(page);
    await page.evaluate(async () => (await import('/src/ui/components/Toast.js')).showToast('测试提示二'));
    await page.waitForSelector(tid('toast'));
    await page.waitForTimeout(300);
    const l = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="toast"]').getBoundingClientRect();
      const host = document.querySelector('[data-testid="toast-host"]');
      return { bottomGap: window.innerHeight - t.bottom, inline: host.style.bottom };
    });
    assert.equal(l.inline, '', `${v.tag} library: no primary button here → the default position (no inline bottom)`);
    assert.ok(l.bottomGap >= 110 - 0.5, `${v.tag} library: the toast stays above the tab bar (${l.bottomGap.toFixed(1)} from the bottom)`);
  }
  if (page !== page0) await page.close();
}
