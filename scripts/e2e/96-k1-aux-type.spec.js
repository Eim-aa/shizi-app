// R3-K1（ADA A3-03，P243）：AX 档写字页辅助字分层封顶，取代上一轮一律 17pt。
// AX1 / AX3 / AX5 × 375×667 / 402×874：
//   - 回忆：拼音 22 / 28、进度 17 / 22（policy.writeGrid.axAux），题面汉字的字面仍比它们都大；
//   - 看答案：格下后果说明 17 / 22、页头标题 17 / 22 且不被截断（最多两行，不再单行省略）；
//   - 纸上写：格内说明 22 / 28，整块在纸面格里。
// 新旧对照：旧实现下 AX3 / AX5 的拼音、进度、说明、标题、纸上说明一律 17pt。
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';
import * as policy from '../../src/config/policy.js';

const CHARS = ['根', '据', '永', '和', '春'];
const AUX = policy.writeGrid.axAux;

async function open(page, ctx, { view, size, current }) {
  await page.setViewportSize(view);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 1, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForTimeout(300);
}

/* eslint-disable no-undef */
const fsOf = sel => {
  const el = document.querySelector(`.sz-layer[data-top="true"] ${sel}`);
  return el ? parseFloat(getComputedStyle(el).fontSize) : null;
};
const glyphSize = () => {
  const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-prompt"] .sz-prompt__cell .sz-pg');
  return g ? g.getBoundingClientRect().height : null;
};
/* eslint-enable no-undef */

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const view of [{ width: 375, height: 667 }, { width: 402, height: 874 }]) {
    for (const size of ['AX1', 'AX3', 'AX5']) {
      const tier = size === 'AX1' ? 0 : 1;
      const tag = `${view.width}×${view.height} ${size}`;

      step(`${tag} recall: pinyin ${AUX.pinyin[tier]}, counter ${AUX.progress[tier]}; the prompt glyph is still the biggest`);
      await open(page, ctx, { view, size });
      const py = await page.evaluate(fsOf, '[data-testid="write-prompt-py"]');
      const pr = await page.evaluate(fsOf, '[data-testid="write-progress"]');
      const gl = await page.evaluate(glyphSize);
      assert.equal(py, AUX.pinyin[tier], `${tag}: pinyin ${py}`);
      assert.equal(pr, AUX.progress[tier], `${tag}: counter ${pr}`);
      assert.ok(gl > py * 1.5 && gl > pr * 1.5, `${tag}: the prompt glyph (${gl.toFixed(0)}) is much bigger than pinyin / counter`);

      step(`${tag} answer: note ${AUX.note[tier]}, title ${AUX.title[tier]} and not cut off`);
      await open(page, ctx, { view, size, current: { phase: 'answer', answerSeen: true } });
      const note = await page.evaluate(fsOf, '[data-testid="write-note"] *');
      assert.equal(note, AUX.note[tier], `${tag}: note ${note}`);
      const title = await page.$eval('.sz-layer[data-top="true"] .sz-page__head>.sz-page__title', el => ({
        fs: parseFloat(getComputedStyle(el).fontSize), lh: parseFloat(getComputedStyle(el).lineHeight),
        h: el.clientHeight, sh: el.scrollHeight, sw: el.scrollWidth, cw: el.clientWidth, text: el.textContent,
      }));
      assert.equal(title.fs, AUX.title[tier], `${tag}: title 「${title.text}」 ${title.fs}`);
      assert.ok(title.sh <= title.h + 1 && title.sw <= title.cw + 1, `${tag}: the title is not cut off (${title.sw}×${title.sh} in ${title.cw}×${title.h})`);
      assert.ok(title.h <= 2 * title.lh + 1, `${tag}: at most two lines`);

      step(`${tag} paper: the in-grid text is ${AUX.paper[tier]} and stays inside the paper cell`);
      await open(page, ctx, { view, size, current: { paper: true } });
      const p = await page.evaluate(() => {
        const top = document.querySelector('.sz-layer[data-top="true"]');
        const paper = top.querySelector('[data-testid="write-paper"]').getBoundingClientRect();
        const els = [...top.querySelectorAll('.sz-paper__title, .sz-paper__text, .sz-paper__back')];
        return {
          fs: els.map(e => parseFloat(getComputedStyle(e).fontSize)),
          gfit: !!top.querySelector('.sz-write[data-gfit]'),
          inside: els.every(e => {
            const r = e.getBoundingClientRect();
            return r.top >= paper.top - 0.5 && r.bottom <= paper.bottom + 0.5 && r.left >= paper.left - 0.5 && r.right <= paper.right + 0.5;
          }),
        };
      });
      // P299（R5M）：格子让步到 220 以下（SE AX3–AX5）时格内文字回到 22 一档
      const want = p.gfit ? AUX.paper[0] : AUX.paper[tier];
      assert.ok(p.fs.length >= 2 && p.fs.every(v => v === want), `${tag}: paper text ${p.fs.join(' / ')} (want ${want}${p.gfit ? ', the grid gave way' : ''})`);
      assert.ok(p.inside, `${tag}: the paper text stays inside the paper cell`);
    }
  }
}
