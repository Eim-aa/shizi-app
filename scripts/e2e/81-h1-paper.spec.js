// H1-7（D51 ⑥、V2-07、T2-16）：纸纹去掉低频「云絮」层，导出图片用平涂笺色。
//   - 屏上笺面（.tex，写字格 / 作品 / 字帖）的 background-image 只有一层（细颗粒），background-size 只有 240px；浅 / 深色各查；
//   - 导出图的调色板（readLightPalette）没有纹理：textures 为空；用它画一张纸（paintPaper），整张图每个像素都是笺色（平涂，没有灰斑）。
import { bootTestHost } from './helpers.mjs';

/* eslint-disable no-undef */
export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  for (const scheme of ['light', 'dark']) {
    step(`${scheme}: 屏上笺面只有细颗粒一层`);
    await page.emulateMedia({ colorScheme: scheme });
    const tex = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'tex';
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { image: cs.backgroundImage, size: cs.backgroundSize };
      el.remove();
      return out;
    });
    assert.equal((tex.image.match(/url\("data:/g) || []).length, 1, `${scheme}: one texture layer (got ${tex.image.slice(0, 60)}…)`);
    assert.ok(!tex.image.includes('baseFrequency=%27.016%27') && !tex.image.includes(".016"), `${scheme}: no low-frequency cloud layer`);
    assert.equal(tex.size, '240px 240px', `${scheme}: background-size has the grain tile only`);
  }
  await page.emulateMedia({ colorScheme: 'light' });

  step('导出图：调色板没有纹理，纸是平涂笺色');
  const flat = await page.evaluate(async () => {
    const { readLightPalette } = await import('/src/core/images/palette.js');
    const { loadTextures, paintPaper } = await import('/src/core/images/render.js');
    const pal = readLightPalette();
    const textures = await loadTextures(pal);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    paintPaper(ctx, 300, 400, pal, textures);
    const data = ctx.getImageData(0, 0, 300, 400).data;
    const first = [data[0], data[1], data[2], data[3]].join(',');
    let different = 0;
    for (let i = 0; i < data.length; i += 4) if ([data[i], data[i + 1], data[i + 2], data[i + 3]].join(',') !== first) different += 1;
    return { textures: pal.textures.length, loaded: textures.length, different, sheet: pal.sheet, first };
  });
  assert.equal(flat.textures, 0, 'the export palette carries no texture');
  assert.equal(flat.loaded, 0, 'nothing to load');
  assert.equal(flat.different, 0, `every pixel of the exported paper is the same flat sheet colour (${flat.sheet} → rgba ${flat.first})`);
}
