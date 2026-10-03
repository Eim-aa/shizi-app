// 把 out/ 下的总览 SVG 转成 PNG（用仓库已装的 playwright chromium；没有就跳过）。
// 用法：node svg-to-png.mjs [文件名…]  默认转 out/sheet-*.svg，转完删掉这些总览 SVG（可由 render-svg.mjs 重新生成；逐条向量的 SVG 保留）
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('playwright 不可用，跳过 PNG');
  process.exit(0);
}
const defaultRun = !process.argv.slice(2).length;
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(OUT).filter(n => n.startsWith('sheet-') && n.endsWith('.svg'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const name of files) {
  const file = resolve(OUT, name);
  const m = readFileSync(file, 'utf8').match(/width="([\d.]+)" height="([\d.]+)"/);
  const [w, h] = [Math.ceil(+m[1]), Math.ceil(+m[2])];
  await page.setViewportSize({ width: w, height: h });
  await page.goto(pathToFileURL(file).href);
  await page.screenshot({ path: file.replace(/\.svg$/, '.png'), clip: { x: 0, y: 0, width: w, height: h } });
  console.log('PNG', name.replace(/\.svg$/, '.png'), `${w}×${h}`);
}
await browser.close();
if (defaultRun) for (const name of files) unlinkSync(resolve(OUT, name));
