// R2-A1（A2-05；D29 / D51）：所有底部弹层都有可见的「完成」文字按钮，读屏可达；Esc 与原生读屏 Z 形手势（shizi-native-escape）都能关。
//
// AX5 × 375×667（浅）与 AX5 × 375×667（深）、L 档 393×852（浅）：
//   写字页「⋯」菜单、字库「排序 · 筛选」菜单、设置「外观」弹层、查字弹层——
//   - 弹层标题行右端有 sheet-done「完成」：文字按钮规格（sz-btn--text、黑体 15 令牌、ink2）、整个按钮落在首屏内、点击区 ≥ 44、不是 aria-hidden、读屏名称是「完成」；
//   - 弹层顶端（标题行）也在首屏内（XXXL 查字弹层顶到屏幕上缘的毛病，A2-05）；
//   - 点「完成」、按 Escape、派发 shizi-native-escape 三种方式都关掉弹层（各开一次）。
//   决策弹层（修改判断 / 对照 / 清空确认）自己有可见的取消，data-dismiss="own"，不再多画一个「完成」。
// 新旧对照：旧实现下 Sheet 没有任何关闭按钮（只能点遮罩或 Esc），四个弹层的 sheet-done 都不存在；shizi-native-escape 没有监听。
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
const SHEET_FACTS = () => {
  const sheet = document.querySelector('.sz-sheet');
  if (!sheet) return null;
  const done = sheet.querySelector('[data-testid="sheet-done"]');
  const head = sheet.querySelector('[data-testid="sheet-head"]');
  const rect = el => (el ? el.getBoundingClientRect() : null);
  const dr = rect(done);
  const hr = rect(head);
  const cs = done ? getComputedStyle(done) : null;
  const probe = document.createElement('span');
  probe.style.color = 'var(--ink2)';
  document.body.appendChild(probe);
  const ink2 = getComputedStyle(probe).color;
  probe.remove();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // 点击区：按钮自身 min-height 与 ::after 热区里取大的（text 变体 ::after = max(100%, --hit)）
  const after = done ? getComputedStyle(done, '::after') : null;
  return {
    vw,
    vh,
    hasDone: !!done,
    text: done ? done.textContent.trim() : null,
    isText: !!done && done.classList.contains('sz-btn--text'),
    tag: done ? done.tagName : null,
    ariaHidden: done ? !!done.closest('[aria-hidden="true"]') : null,
    color: cs ? cs.color : null,
    ink2,
    fontSize: cs ? parseFloat(cs.fontSize) : null,
    done: dr ? { left: dr.left, top: dr.top, right: dr.right, bottom: dr.bottom, w: dr.width, h: dr.height } : null,
    hit: after ? { w: parseFloat(after.width), h: parseFloat(after.height) } : null,
    head: hr ? { top: hr.top, bottom: hr.bottom } : null,
    dismiss: sheet.dataset.dismiss,
    modal: sheet.getAttribute('aria-modal'),
  };
};

const CLOSED = () => !document.querySelector('.sz-sheet');

async function closeBy(page, how, label) {
  if (how === 'done') await page.click('.sz-sheet [data-testid="sheet-done"]');
  else if (how === 'escape') await page.keyboard.press('Escape');
  else await page.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-escape')));
  await page.waitForFunction(CLOSED, null, { timeout: 4000 }).catch(() => { throw new Error(`${label}: sheet did not close by ${how}`); });
  await waitNavIdle(page);
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  const runs = [
    { tag: 'AX5 375×667 light', width: 375, height: 667, scheme: 'light', size: 'AX5' },
    { tag: 'AX5 375×667 dark', width: 375, height: 667, scheme: 'dark', size: 'AX5' },
    { tag: 'L 393×852 light', width: 393, height: 852, scheme: 'light', size: 'L' },
  ];
  let page = page0;
  for (const [i, v] of runs.entries()) {
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);
    await seedHomeSpec(page, {
      entries: [...'疆酱肆酝春嚷醋膝窗屉'].map((c, k) => ({ char: c, at: `2026-10-0${1 + (k % 4)}T20:0${k % 10}:00`, judgment: k < 2 ? 'wrong' : 'correct' })),
      clock: '2026-10-05T19:30:00',
    });
    if (v.size !== 'L') await setTextSize(page, v.size);

    const pushScreen = async (name, params, ready) => {
      await page.evaluate(async ([n, p]) => (await import('/src/ui/router.js')).nav.push(n, p), [name, params]);
      await page.waitForSelector(ready);
      await waitNavIdle(page);
    };
    // 每组：页面准备（组内只做一次）+ 打开弹层（组内三次，每次一种关法）
    const groups = [
      {
        name: '设置·外观弹层',
        prepare: async () => {},
        open: async () => {
          await page.evaluate(async () => (await import('/src/ui/screens/mine/settings.js')).openAppearanceSheet());
          await page.waitForSelector('.sz-sheet [data-testid="settings-appearance-options"]');
        },
      },
      {
        name: '查字弹层',
        prepare: async () => {},
        open: async () => {
          await page.evaluate(async () => (await import('/src/ui/components/query/index.js')).openQuery({ mode: 'lookup' }));
          await page.waitForSelector('.sz-sheet[data-testid="query-sheet"]');
        },
      },
      {
        name: '字库·排序筛选菜单',
        prepare: async () => pushScreen('library-all', {}, topSel('all-menu-open')),
        open: async () => {
          await page.click(topSel('all-menu-open'));
          await page.waitForSelector('.sz-sheet[data-testid="all-menu"]');
        },
      },
      {
        name: '写字页·⋯菜单',
        prepare: async () => {
          await seedSession(page, { slot: 'A', kind: 'daily', chars: ['根', '据', '永'], cursor: 1 });
          await pushScreen('write', { slot: 'A' }, topSel('write-screen'));
          await page.waitForTimeout(450);
        },
        open: async () => {
          if (v.size === 'L') {
            await page.evaluate(async () => (await import('/src/ui/screens/write/ax-menu.js')).openAxMenu([{ testid: 'x-1', label: '提示', onSelect() {} }, { testid: 'x-2', label: '跳过', onSelect() {} }]));
          } else {
            await page.click(topSel('write-more'));
          }
          await page.waitForSelector('.sz-sheet[data-testid="write-ax-menu"]');
        },
      },
    ];

    for (const g of groups) {
      await g.prepare();
      for (const how of ['done', 'escape', 'native']) {
        const label = `${v.tag}: ${g.name} 用「${how}」关`;
        step(label);
        await g.open();
        await waitNavIdle(page);
        if (how === 'done') {
          // 「完成」的外观只在每组第一次核对；后两次只验证关得掉
          const f = await page.evaluate(SHEET_FACTS);
          assert.ok(f && f.hasDone, `${label}: 完成 exists`);
          assert.equal(f.text, '完成', `${label}: 完成 label`);
          assert.equal(f.tag, 'BUTTON', `${label}: a real <button>`);
          assert.equal(f.isText, true, `${label}: text-button spec (sz-btn--text)`);
          assert.equal(f.color, f.ink2, `${label}: ink2`);
          assert.equal(f.ariaHidden, false, `${label}: not aria-hidden (screen-reader reachable)`);
          assert.equal(f.modal, 'true', `${label}: inside the modal dialog`);
          assert.equal(f.dismiss, 'done', `${label}: data-dismiss=done`);
          assert.ok(f.done.left >= 0 && f.done.right <= f.vw && f.done.top >= 0 && f.done.bottom <= f.vh,
            `${label}: 完成 inside the viewport ${JSON.stringify(f.done)} in ${f.vw}×${f.vh}`);
          assert.ok(f.head.top >= 0, `${label}: the title row starts inside the viewport (${f.head.top})`);
          assert.ok(Math.max(f.done.h, f.hit.h) >= 44 && Math.max(f.done.w, f.hit.w) >= 44, `${label}: hit area ≥ 44 (${JSON.stringify([f.done.w, f.done.h, f.hit])})`);
          assert.ok(Math.abs(f.done.right - (f.vw - 20)) <= 6, `${label}: right edge sits on the 20pt page margin (${f.done.right} vs ${f.vw - 20})`);
        }
        await closeBy(page, how, label);
      }
    }

    step(`${v.tag}: 决策弹层（清空确认）自带可见的取消，不再多画「完成」`);
    const own = await page.evaluate(async () => {
      const { nav } = await import('/src/ui/router.js');
      const { ClearSheet } = await import('/src/ui/screens/mine/backup.js');
      nav.openOverlay(ClearSheet, { n: 3, failed: false, onConfirm() {} }, { name: 'a1-clear' });
      await new Promise(r => setTimeout(r, 450));
      const sheet = document.querySelector('.sz-sheet[data-testid="backup-clear-sheet"]');
      const out = { dismiss: sheet && sheet.dataset.dismiss, done: !!(sheet && sheet.querySelector('[data-testid="sheet-done"]')), cancel: !!(sheet && sheet.querySelector('[data-testid="backup-clear-cancel"]')) };
      nav.back();
      return out;
    });
    assert.deepEqual(own, { dismiss: 'own', done: false, cancel: true }, `${v.tag}: clear sheet keeps its own visible cancel`);
    await waitNavIdle(page);
  }
}
