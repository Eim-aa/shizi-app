// 第三轮 C3-R（D53 ⑤；T2-08 / V3-05 / T 第 6 条）：作品标注与落款。
//   · 「看后写的」在它那一格里面、底边居中（11pt ink3），不在作品下方的单独一行；
//   · 落款永远是作品的最后一行：落款下方（作品区里）没有任何别的东西；
//   · 作品里没有 .sz-work__caps 那一排。

import { bootTestHost, topSel } from './helpers.mjs';
import { openResultPage, seedWork } from './work-helpers.mjs';

async function geometry(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right };
    };
    const work = top.querySelector('[data-testid="work"]');
    const cap = top.querySelector('[data-testid="work-cap"]');
    const cell = cap && cap.closest('[data-testid="work-cell"]');
    const kuan = top.querySelector('[data-testid="work-kuan"]');
    const seal = top.querySelector('[data-testid="work-seal"]');
    const sign = top.querySelector('[data-testid="work-sign"]');
    const cs = cap ? getComputedStyle(cap) : null;
    const kids = [...work.querySelectorAll('*')].filter(e => !e.contains(kuan) && !sign.contains(e) && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().bottom > sign.getBoundingClientRect().bottom + 0.5);
    return {
      cap: cap ? { ...rect(cap), text: cap.textContent.trim(), size: cs.fontSize, color: cs.color, align: cs.textAlign, hidden: cap.getAttribute('aria-hidden') } : null,
      cell: cell ? { ...rect(cell), ch: cell.dataset.char } : null,
      kuan: rect(kuan),
      sign: rect(sign),
      seal: rect(seal),
      work: rect(work),
      belowKuan: kids.map(e => e.getAttribute('data-testid') || e.className),
      oldCaps: !!top.querySelector('[data-testid="work-caps"], .sz-work__caps'),
      ink3: getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim(),
    };
  });
}

export default async function c3rWorkCaption(page, ctx) {
  const { assert, step } = ctx;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootTestHost(page, ctx.baseURL);

  step('「看后写的」 sits inside its own cell at the bottom edge, centred; no caption row under the work');
  const g = await seedWork(page, { id: 's941', chars: [...'疆酱痒酝'], steps: ['correct', 'seen-ink', 'correct', 'correct'] });
  await openResultPage(page, g);
  const v = await geometry(page);
  assert.ok(v.cap && v.cap.text === '看后写的', 'the caption is there');
  assert.equal(v.cell.ch, '酱', 'inside the cell of the char that was written after seeing the answer');
  assert.ok(v.cap.x >= v.cell.x - 0.5 && v.cap.r <= v.cell.r + 0.5 && v.cap.y >= v.cell.y && v.cap.b <= v.cell.b + 0.5, 'the caption box is inside the cell box');
  assert.ok(Math.abs((v.cap.x + v.cap.w / 2) - (v.cell.x + v.cell.w / 2)) <= 1, 'centred in the cell');
  assert.ok(v.cell.b - v.cap.b >= 2 && v.cell.b - v.cap.b <= 8, `at the bottom edge (${(v.cell.b - v.cap.b).toFixed(1)}pt above the cell bottom)`);
  assert.equal(v.cap.size, '11px', '11pt');
  assert.equal(v.cap.hidden, 'true', 'read aloud once: the cell label already says it; the caption is decoration for the eye');
  assert.equal(v.oldCaps, false, 'the old caption row under the work is gone');

  step('the 落款 is the last line of the work: nothing under it');
  assert.deepEqual(v.belowKuan, [], `no element of the work lies below the 落款 (${JSON.stringify(v.belowKuan)})`);
  assert.ok(v.sign.b >= v.work.b - 1 && v.sign.b <= v.work.b + 1, 'the 落款 row ends where the work ends');
  assert.ok(Math.abs((v.seal.y + v.seal.h / 2) - (v.kuan.y + v.kuan.h / 2)) <= 8 || v.seal.y < v.kuan.y, 'the seal sits on the 落款 line or beside the last cell, never below');
}
