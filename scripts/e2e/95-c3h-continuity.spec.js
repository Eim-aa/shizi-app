// C3-H ③（N3-02、D53；P246）：第二天的连续性。
//   今天还没写时，首页的「最近写的字」用 ink2 画（今天写的字用 ink），格下一句说清是哪天写的：
//   同一天写的 → 昨天 /前天 / N 天前写的字；不是同一天写的 →「最近写的字。」；离开一周以上（back）与特别组那天不加这句（back 有自己的一句）。
//   像素级核对：最近写的字的画布上最不透明的墨点颜色 = ink2，今天写的字的 = ink（--hand）。
import { bootTestHost } from './helpers.mjs';
import { seedHomeSpec, seedHomeState } from './home-helpers.mjs';

/* eslint-disable no-undef */
const D = n => `2026-10-${String(n).padStart(2, '0')}`;

async function look(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
    const probe = name => { const e = document.createElement('i'); e.style.color = `var(--${name})`; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
    const rgb = c => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const inkColor = row => {
      const canvas = row && row.querySelector('canvas');
      if (!canvas) return null;
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let best = null;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 250) { best = [d[i], d[i + 1], d[i + 2]]; break; }
      return best;
    };
    const note = root.querySelector('[data-testid="home-recent-note"]');
    const recent = root.querySelector('[data-testid="home-recent-row"]');
    const today = root.querySelector('[data-testid="home-ink-row"]');
    return {
      view: root.dataset.view,
      note: note ? note.textContent : null,
      noteColor: note ? rgb(getComputedStyle(note).color) : null,
      back: (root.querySelector('[data-testid="home-back-note"]') || {}).textContent || null,
      recentInk: inkColor(recent),
      todayInk: inkColor(today),
      ink1: rgb(probe('ink1')),
      ink2: rgb(probe('ink2')),
      ink3: rgb(probe('ink3')),
      hand: rgb(probe('hand')),
      noteBelowRow: note && recent ? note.getBoundingClientRect().top >= recent.getBoundingClientRect().bottom : null,
    };
  });
}
const close = (a, b, tol = 3) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= tol);

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await bootTestHost(page, ctx.baseURL);

    step(`${scheme}: 第二天（fresh）：最近写的字 ink2、格下「昨天写的字。」`);
    await seedHomeState(page, 'fresh');
    let f = await look(page);
    assert.equal(f.view, 'fresh', 'fresh view');
    assert.equal(f.note, '昨天写的字。', 'one line under the row says it was yesterday');
    assert.ok(f.noteBelowRow, 'the line is under the row');
    assert.ok(close(f.noteColor, f.ink3, 1), 'the line is ink3');
    assert.ok(close(f.recentInk, f.ink2), `the recent chars are drawn in ink2 (${JSON.stringify(f.recentInk)} ≈ ${JSON.stringify(f.ink2)})`);
    assert.ok(!close(f.ink2, f.hand, 6), 'ink2 differs from the ink used for today (so the two read differently)');

    step(`${scheme}: 今天写过：字帖行是今天的墨（--hand），没有「写的字」那句`);
    await seedHomeState(page, 'today');
    f = await look(page);
    assert.equal(f.note, null, 'no recent note once today is written');
    assert.ok(close(f.todayInk, f.hand, 8) && !close(f.todayInk, f.ink2, 20), `today's chars are drawn in the full ink (${JSON.stringify(f.todayInk)} ≈ ${JSON.stringify(f.hand)})`);

    step(`${scheme}: 按天数：前天 / N 天前 / 不是同一天写的`);
    await seedHomeSpec(page, { entries: [...'疆酱肆'].map((c, i) => ({ char: c, at: `${D(3)}T20:0${i}:00` })), clock: `${D(5)}T19:30:00` });
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]').dataset.view === 'fresh');
    f = await look(page);
    assert.equal(f.note, '前天写的字。', 'two days ago');
    await seedHomeSpec(page, { entries: [...'疆酱肆'].map((c, i) => ({ char: c, at: `${D(1)}T20:0${i}:00` })), clock: `${D(5)}T19:30:00` });
    f = await look(page);
    assert.equal(f.note, '4 天前写的字。', 'four days ago');
    await seedHomeSpec(page, { entries: [{ char: '疆', at: `${D(2)}T20:00:00` }, { char: '酱', at: `${D(4)}T20:00:00` }, { char: '肆', at: `${D(4)}T20:01:00` }], clock: `${D(5)}T19:30:00` });
    f = await look(page);
    assert.equal(f.note, '最近写的字。', 'written on different days → the neutral line');

    step(`${scheme}: 离开一周以上（back）有自己的一句、不加；特别组那天不加`);
    await seedHomeState(page, 'back');
    f = await look(page);
    assert.deepEqual([f.note, f.back], [null, '你写过的 5 个字都还在。'], 'back: only 「你写过的 N 个字都还在。」');
    assert.ok(close(f.recentInk, f.ink2), 'back: the recent chars are ink2 too');
    await seedHomeState(page, 'special');
    f = await look(page);
    assert.equal(f.note, null, 'special: the capital hint is the one line (no recent note)');
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
