// 阶段 1 Q2-3（复测 simB D4）：分享弹层里的预览图（1:1、3:4、月字帖、年报册页同一个组件）水平居中——
// 预览板的中线在弹层中线上（也就是页面中线），不再偏左约 20pt（横向滚动条的内边距按含负外边距的实际宽度算）。

import { bootTestHost } from './helpers.mjs';
import { openSharePreview, seedEndedGroup } from './q2-helpers.mjs';

async function centers(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="image-sheet"]').getBoundingClientRect();
    const boards = [...document.querySelectorAll('[data-testid="image-preview"] .sz-img__board')].map(b => b.getBoundingClientRect());
    const first = boards[0];
    return {
      viewport: window.innerWidth,
      sheetCx: sheet.left + sheet.width / 2,
      boardCx: first.left + first.width / 2,
      boardW: Math.round(first.width),
      count: boards.length,
    };
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await seedEndedGroup(page, { chars: [{ c: '静' }, { c: '永' }, { c: '和' }, { c: '水' }] });

  step('结果页分享弹层（4 字，默认 3:4）：预览板中线在页面中线上');
  await openSharePreview(page);
  let c = await centers(page);
  assert.ok(Math.abs(c.boardCx - c.viewport / 2) <= 1, `3:4 board centred (board ${c.boardCx}, page ${c.viewport / 2})`);
  assert.ok(Math.abs(c.boardCx - c.sheetCx) <= 1, 'board centre = sheet centre');

  step('切到 1:1：同样居中');
  await page.click('[data-testid="image-ratio"][data-ratio="1:1"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').height === 1440);
  c = await centers(page);
  assert.ok(Math.abs(c.boardCx - c.viewport / 2) <= 1, `1:1 board centred (board ${c.boardCx}, page ${c.viewport / 2})`);
}
