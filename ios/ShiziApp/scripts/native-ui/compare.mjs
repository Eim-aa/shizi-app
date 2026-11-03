// QA-H1 逐屏对比（D84）：冻结的原生基线 vs 这一次的原生取证——纯回归检测，原生一变就报，人确认后重录基线（verify-native-ui.sh --update-baseline）。
//
// usage: node compare.mjs --ref <基线目录> --native <原生取证目录> --out <输出目录> [--config parity.config.json] [--states a,b]
// 基线目录 = ShiziUITests/Baseline/（<状态>_<外观>_<字号>.png + .json，capture.mjs 的原生取证原样存下来）。只比夹具 native: true 的状态（registry.mjs STATES）。
// 方法：以「元素清单 + 位置尺寸 + 文案 + 颜色」为主（elements.mjs 配对，容差见 parity.config.json），不做整图像素比；
//   线 / 装饰 / 墨格（graphics.mjs）另比，并在截图上取少量像素（格底色、辅助线、题面空格、遮罩）供具名检查（parity-checks.mjs）用。
//   具名检查只留判原生自身性质的（AX 档不溢出、浮条与主按钮分开、弹层满宽贴底等）；与网页对照的 NP-* 随网页参考退役（D84）。
// 内部变量沿用历史命名：web / w = 基线一侧，native / n = 这一次。
// 输出：<out>/report.md（文本差异清单）、<out>/report.json、<out>/side-by-side/<状态>_<外观>_<字号>.png（左基线、右这次，差异框编号）。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { diffState, normText } from './elements.mjs';
import { GRAPHICS_DEFAULTS, cellRegions, cleanMask, commonScrollWindow, diffGraphics, glyphInk, hiddenText, iconVisibilityDiffers, inkMetrics, judgeGlyph, judgeInk, reachesTabBar, scrollWindows, tabBarTop, underSheet } from './graphics.mjs';
import { CHECKS, COVERED_ELSEWHERE } from './parity-checks.mjs';
import { STATE_NAMES, STATES, fixtureOf, sizesOf } from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const refDir = args.ref;
const natDir = args.native;
const outDir = args.out;
// 全局口径（容差、线 / 装饰 / 墨格阈值）在 parity.config.json
const config = JSON.parse(readFileSync(args.config || join(here, 'parity.config.json'), 'utf8'));
const onlyStates = args.states && args.states !== 'true' ? new Set(args.states.split(',').filter(Boolean)) : null;
const nativeStates = new Set(STATES);
const tol = config.tolerance;
// QA-H2：线 / 装饰 / 墨格的阈值（graphics.mjs GRAPHICS_DEFAULTS，parity.config.json graphics 可改）
const G = { ...GRAPHICS_DEFAULTS, ...(config.graphics || {}), ink: { ...GRAPHICS_DEFAULTS.ink, ...((config.graphics || {}).ink || {}) } };
if (!refDir || !natDir || !outDir) {
  console.error('usage: node compare.mjs --ref <dir> --native <dir> --out <dir>');
  process.exit(2);
}
mkdirSync(join(outDir, 'side-by-side'), { recursive: true });

function headlessShell() {
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter(d => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) for (const sub of readdirSync(join(root, d))) {
    const exe = join(root, d, sub, 'chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}
async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const exe = headlessShell();
    if (!exe) throw error;
    return chromium.launch({ executablePath: exe });
  }
}

const dataUrl = p => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

/** 截图取样（在浏览器里读像素）。regions：书写格、题面空格。 */
async function sample(page, png, regions) {
  return page.evaluate(async ({ src, regions: g }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const s = g.scale;
    const px = (x, y) => Array.from(ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data);
    const hex = a => '#' + a.slice(0, 3).map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('') + 'FF';
    const lum = a => 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
    const out = {};
    if (g.grid) {
      const { x, y, w, h } = g.grid;
      const pts = [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]].map(([fx, fy]) => px(x + fx * w, y + fy * h));
      pts.sort((a, b) => lum(a) - lum(b));
      const bg = pts[2];
      out.gridBg = hex(bg);
      const bgL = lum(bg);
      let guide = 0;
      for (let t = 0.03; t <= 0.12; t += 0.005) {
        if (Math.abs(lum(px(x + w / 2, y + t * h)) - bgL) > 8) guide += 1;
        if (Math.abs(lum(px(x + t * w, y + h / 2)) - bgL) > 8) guide += 1;
      }
      out.guide = guide;
      let thick = 0;
      for (let yy = y + 0.3 * h; yy <= y + 0.6 * h; yy += 1 / s) if (Math.abs(bgL - lum(px(x + 0.3 * w, yy))) > 60) thick += 1;
      out.inkThick = Math.round(thick / s * 10) / 10;
      out.bgL = bgL;
    }
    if (g.blank) {
      const { x, y, w, h } = g.blank;
      const ref = lum(px(x + 3, y + 3));
      let n = 0;
      for (let yy = y + 4; yy < y + h - 4; yy += 1) for (let xx = x + 4; xx < x + w - 4; xx += 1) if (Math.abs(ref - lum(px(xx, yy))) > 60) n += 1;
      out.blankInk = n;
    }
    out.scrim = hex(px(g.screenW / 2, 100));
    return out;
  }, { src: dataUrl(png), regions });
}

function render(page, { webPng, natPng, diffs, title, screen }) {
  const boxes = (side) => diffs.map((d, i) => {
    const e = side === 'web' ? d.w : d.n;
    if (!e) return '';
    const f = e.frame;
    return `<div class="b ${side}" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px"><i>${i + 1}</i></div>`;
  }).join('');
  const list = diffs.map((d, i) => `<li><b>${i + 1}</b> [${(d.aspects || [d.type]).join('·')}] ${escape(d.label)}：${escape(d.msg)}</li>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;font:12px/1.45 -apple-system,"PingFang SC",sans-serif;background:#fff;color:#222;display:flex;gap:12px;padding:12px;width:max-content}
    .col{position:relative;width:${screen.w}px} .col img{width:${screen.w}px;display:block;border:1px solid #ccc}
    .col h3{margin:0 0 6px;font-size:13px} .stage{position:relative}
    .b{position:absolute;box-sizing:border-box;border:1.5px solid} .b i{position:absolute;top:-9px;left:-1px;font-style:normal;font-size:10px;color:#fff;padding:0 2px}
    .web{border-color:#1f6fd1}.web i{background:#1f6fd1} .native{border-color:#d12f1f}.native i{background:#d12f1f}
    ol{list-style:none;margin:0;padding:0;width:440px} li{margin:0 0 4px} h2{font-size:14px;margin:0 0 8px}
  </style>
  <div class="col"><h3>基线（参考）</h3><div class="stage"><img src="${dataUrl(webPng)}">${boxes('web')}</div></div>
  <div class="col"><h3>这一次</h3><div class="stage"><img src="${dataUrl(natPng)}">${boxes('native')}</div></div>
  <div><h2>${escape(title)} · ${diffs.length} 条差异</h2><ol>${list}</ol></div>`;
  return page.setContent(html);
}

/** QA-H2：墨格掩膜（每格 N×N，与格底亮度差 > max(minContrast, 格内最大差 × threshold) 记墨；格底 = 四角亮度第三亮）。返回 '0' / '1' 串数组。 */
async function sampleCells(page, png, regions, scale, opts) {
  return page.evaluate(async ({ src, regions: rs, s, o }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = (x, y) => { const X = Math.min(c.width - 1, Math.max(0, Math.round(x * s))), Y = Math.min(c.height - 1, Math.max(0, Math.round(y * s))); const i = (Y * c.width + X) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
    return rs.map(({ f, n, inset }) => {
      const corners = [[0.04, 0.04], [0.96, 0.04], [0.04, 0.96], [0.96, 0.96]].map(([fx, fy]) => lum(f.x + fx * f.w, f.y + fy * f.h)).sort((a, b) => a - b);
      const L = new Float32Array(n * n);
      for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) L[j * n + i] = lum(f.x + inset + (i + 0.5) / n * (f.w - 2 * inset), f.y + inset + (j + 0.5) / n * (f.h - 2 * inset));
      // 格底：墨格取整格亮度的中位数（墨 < 一半面积；格线 / 邻格角标字落在角上时，四角法会把它当成底：深色下第二亮的角就是亮线，半像素的对位差就让最后一行格的下边线进了角）；图标等占满的框仍用四角法
      const bgL = o.median ? [...L].sort((a, b) => a - b)[L.length >> 1] : corners[2];
      const d = new Float32Array(n * n);
      let max = 0;
      for (let k = 0; k < L.length; k += 1) {
        const dd = Math.abs(bgL - L[k]);
        d[k] = dd;
        if (dd > max) max = dd;
      }
      const cut = Math.max(o.minContrast, max * o.threshold);
      const band = o.band || 0; // QA-H4：缓冲带——'1' 肯定是墨，'b' 略过截止值，'c' 略低于截止值，'0' 肯定不是（graphics.mjs inkMetrics 只拿 '1' 量外框 / 点数）
      let m = '';
      for (let k = 0; k < d.length; k += 1) m += d[k] > cut * (1 + band) ? '1' : d[k] > cut ? (band ? 'b' : '1') : d[k] > cut * (1 - band) ? 'c' : '0';
      return m;
    });
  }, { src: dataUrl(png), regions, s: scale, o: { minContrast: opts.minContrast ?? 40, threshold: opts.threshold ?? 0.5, median: !!opts.median, band: opts.band || 0 } });
}

const escape = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const refFound = readdirSync(refDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
// 每个原生状态应有的基线（夹具的外观 × 字号档）：缺了就报，不然新加的状态永远不被比
const expected = [];
for (const state of STATES) for (const a of ['light', 'dark']) for (const sz of sizesOf(fixtureOf[state])) expected.push(`${state}_${a}_${sz}`);
const pairsFound = [...new Set([...refFound, ...expected])].sort();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const results = [];
const orphanBaseline = new Set(); // 基线里有、夹具已不是 native: true 的状态（不比）
for (const name of pairsFound) {
  const m = /^(.+)_(light|dark)_([A-Za-z0-9]+)$/.exec(name);
  if (!m) continue;
  const [, state, appearance, size] = m;
  if (!nativeStates.has(state)) { orphanBaseline.add(state); continue; }
  if (onlyStates && !onlyStates.has(state)) continue;
  if (!existsSync(join(refDir, `${name}.json`))) { results.push({ name, state, appearance, size, error: '没有基线（verify-native-ui.sh --update-baseline 录一份）' }); continue; }
  const webJson = JSON.parse(readFileSync(join(refDir, `${name}.json`), 'utf8'));
  const natPath = join(natDir, `${name}.json`);
  if (!existsSync(natPath)) { if (onlyStates) continue; /* --states 只比取过的 */ results.push({ name, state, appearance, size, error: '没有原生取证' }); continue; }
  const natJson = JSON.parse(readFileSync(natPath, 'utf8'));
  const { diffs, web, native, webAll, nativeAll, pairs } = diffState(webJson, natJson, tol);
  // QA-H2：线、装饰、墨格（参考里没有这些字段时不比——旧参考）
  const clipped = commonScrollWindow(webJson, natJson, webAll, nativeAll);
  const graphics = diffGraphics(clipped.web, clipped.native, tol, { web: webAll, native: nativeAll, pairs }, G);
  diffs.push(...graphics.diffs);
  // QA-H3e：盖在不透明弹层下面的页面图形（线 / 装饰 / 墨格）两边都看不见，不比
  const kept = diffs.filter(d => !(['rule', 'deco', 'cell'].includes(d.type) && underSheet(d, webAll, nativeAll)));
  const webPng = join(refDir, `${name}.png`);
  const natPng = join(natDir, `${name}.png`);
  const screen = webJson.screen;
  let px = { web: {}, native: {} };
  if (existsSync(webPng) && existsSync(natPng)) {
    const grid = (web.find(e => e.key === 'grid') || {}).frame;
    const blankEl = (natJson.elements || []).find(e => e.id === 'native-write-blank');
    const regions = { grid, blank: blankEl ? blankEl.frame : null, screenW: screen.w };
    const scaleOf = async png => page.evaluate(async src => { const i = new Image(); i.src = src; await i.decode(); return i.width; }, dataUrl(png));
    px = {
      web: await sample(page, webPng, { ...regions, scale: (await scaleOf(webPng)) / screen.w }),
      native: await sample(page, natPng, { ...regions, scale: (await scaleOf(natPng)) / screen.w }),
    };
    // QA-H2：两边都完整在屏上的墨格比墨（屏外的只比有无与位置：截图只有一屏）
    const onScr = f => f.x >= 0 && f.y >= 0 && f.x + f.w <= screen.w && f.y + f.h <= screen.h;
    // 盖在上面的层（原生元素的 layer：弹层 sheet < 撤销条 / 确认框）下面的墨格不比像素（截图上看到的是浮层，不是格；有无与位置照比）
    const RANK = { sheet: 1, undoBar: 2, endDialog: 2 };
    const covers = (natJson.elements || []).filter(e => RANK[e.layer]);
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const coveredCell = (p, r) => covers.some(e => RANK[e.layer] > (RANK[p.n.layer] || 0) && hit(e.frame, r.native));
    // QA-H4：伸进系统 Tab 栏范围的格 / 文字不按截图像素比（Tab 栏的图标、标签、玻璃会落进掩膜 / 字色里）
    const tabTop = [tabBarTop(webAll), tabBarTop(nativeAll)].filter(t => t !== null).reduce((m, t) => (m === null ? t : Math.min(m, t)), null);
    const inkPairs = graphics.inkPairs.map(p => ({ p, r: cellRegions(p, G.ink) })).filter(({ p, r }) => !p.w.off && !p.n.off && onScr(r.web) && onScr(r.native) && !coveredCell(p, r) && !reachesTabBar(r.web, tabTop) && !reachesTabBar(r.native, tabTop));
    if (inkPairs.length) {
      const wm = await sampleCells(page, webPng, inkPairs.map(({ r }) => ({ f: r.web, n: r.n, inset: r.inset })), (await scaleOf(webPng)) / screen.w, { ...G.ink, median: true });
      const nm = await sampleCells(page, natPng, inkPairs.map(({ r }) => ({ f: r.native, n: r.n, inset: r.inset })), (await scaleOf(natPng)) / screen.w, { ...G.ink, median: true });
      px.cells = [];
      inkPairs.forEach(({ p, r }, i) => {
        const m = inkMetrics(wm[i], nm[i], r.n, Math.min(p.w.w, p.w.h) - 2 * r.inset);
        px.cells.push({ x: p.w.x, y: p.w.y, w: p.w.w, ...m, ...(process.env.QA_MASKS ? { wm: wm[i], nm: nm[i], n: r.n } : {}) });
        const bad = judgeInk(m, Math.min(p.w.w, p.w.h), G.ink);
        const d = { type: 'cell', aspects: ['cell'], label: `${p.w.kind === 'glyph' ? `字形格「${p.w.text || ''}」` : '墨格'}`, msg: `(${p.w.x}, ${p.w.y} ${p.w.w}×${p.w.h})：${bad.join('；')}`, w: { frame: p.w }, n: { frame: p.n } };
        if (bad.length) kept.push(d);
      });
    }
    // QA-H2：配上对的图标在截图里看得见吗（图标被自己的圆底盖住、画成透明）：两边各取图标框的掩膜，一边有、一边没有就报
    const iconPairs = graphics.iconPairs.filter(p => !p.w.off && !p.n.off && onScr(p.w) && onScr(p.n) && !coveredCell({ n: p.n }, { native: p.n }));
    if (iconPairs.length) {
      const reg = f => ({ f, n: Math.max(8, Math.round(Math.max(f.w, f.h))), inset: 0 });
      const wm = await sampleCells(page, webPng, iconPairs.map(p => reg(p.w)), (await scaleOf(webPng)) / screen.w, { ...G.ink, band: 0, minContrast: 30, threshold: 0.4 });
      const nm = await sampleCells(page, natPng, iconPairs.map(p => reg(p.n)), (await scaleOf(natPng)) / screen.w, { ...G.ink, band: 0, minContrast: 30, threshold: 0.4 });
      const ink = m => [...m].filter(c => c === '1').length;
      iconPairs.forEach((p, i) => {
        const a = ink(wm[i]), b = ink(nm[i]);
        if (!iconVisibilityDiffers(a, b, G.ink)) return; // QA-H4：滞回——7 对 5 这种卡在阈值上的不算
        const d = { type: 'deco', aspects: ['deco'], label: p.label, msg: `图标 (${p.w.x}, ${p.w.y} ${p.w.w}×${p.w.h})：截图里${a >= (G.ink.minInk ?? 6) ? '网页看得见、原生看不见' : '原生看得见、网页看不见'}（墨点 网页 ${a} 原生 ${b}）`, w: { frame: p.w }, n: { frame: p.n } };
        kept.push(d);
      });
    }
    // QA-H3e：配上对的文字（文字框两边都在屏上）取画出来的字色：dump 里的颜色是 titleColor / CSS color，不等于像素（富文本标题的前景色、被盖住的字都不反映）
    const winZones = scrollWindows(webAll, nativeAll);
    const textPairs = (pairs || []).filter(([w, n]) => (w.kind === 'text' || w.kind === 'button') && normText(w.text) && normText(w.text) === normText(n.text)
      && w.textFrame && n.textFrame && !w.off && !n.off && onScr(w.textFrame) && onScr(n.textFrame) && w.textFrame.w >= 4 && w.textFrame.h >= 4
      && !coveredCell({ n }, { native: n.textFrame }) && !reachesTabBar(w.textFrame, tabTop) && !reachesTabBar(n.textFrame, tabTop) && !hiddenText(winZones, 'web', w) && !hiddenText(winZones, 'native', n));
    if (textPairs.length) {
      const grab = async (png, frames) => {
        const s = (await scaleOf(png)) / screen.w;
        return page.evaluate(async ({ src, frames: fs, s: sc, fn, o }) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const ink = new Function(`return ${fn}`)();
          return fs.map(f => {
            const x = Math.max(0, Math.round(f.x * sc)), y = Math.max(0, Math.round(f.y * sc));
            const w = Math.max(1, Math.min(c.width - x, Math.round(f.w * sc))), h = Math.max(1, Math.min(c.height - y, Math.round(f.h * sc)));
            return ink(ctx.getImageData(x, y, w, h).data, w, h, o.minDist, o.minPx);
          });
        }, { src: dataUrl(png), frames, s, fn: glyphInk.toString(), o: G.glyph || GRAPHICS_DEFAULTS.glyph });
      };
      const wi = await grab(webPng, textPairs.map(([w]) => w.textFrame));
      const ni = await grab(natPng, textPairs.map(([, n]) => n.textFrame));
      textPairs.forEach(([w, n], i) => {
        const bad = judgeGlyph(wi[i], ni[i], G.glyph || GRAPHICS_DEFAULTS.glyph);
        if (!bad.length) return;
        const d = { type: 'color', aspects: ['color'], label: w.key || normText(w.text), msg: `「${w.text}」${bad.join('；')}`, w, n };
        kept.push(d);
      });
    }
    // 只有一边有的格：在屏上、截图里那一格是空的（没墨，例：只为取证量框的透明图片）→ 不算缺少 / 多出
    const lone = kept.filter(d => d.lone && (d.type === 'cell' || d.type === 'deco') && !(d.lone === 'web' ? d.w : d.n).frame.off && onScr((d.lone === 'web' ? d.w : d.n).frame));
    if (lone.length) {
      const masks = {};
      for (const side of ['web', 'native']) {
        const ds = lone.filter(d => d.lone === side);
        if (!ds.length) continue;
        const png = side === 'web' ? webPng : natPng;
        const ms = await sampleCells(page, png, ds.map(d => { const f = (side === 'web' ? d.w : d.n).frame; const r = cellRegions({ w: f, n: f }, G.ink); return { f: r.web, n: r.n, inset: r.inset }; }), (await scaleOf(png)) / screen.w, { ...G.ink, band: 0 });
        ds.forEach((d, i) => { masks[kept.indexOf(d)] = ms[i]; });
      }
      for (let i = kept.length - 1; i >= 0; i -= 1) if (masks[i] !== undefined && [...cleanMask(masks[i], Math.round(Math.sqrt(masks[i].length)))].filter(c => c === '1').length < (G.ink.minInk ?? 6)) kept.splice(i, 1);
    }
    await render(page, { webPng, natPng, diffs: kept, title: `${STATE_NAMES[state] || state} · ${appearance} · ${size}`, screen });
    await page.screenshot({ path: join(outDir, 'side-by-side', `${name}.png`), fullPage: true });
  }
  const checks = [];
  for (const c of CHECKS) {
    if (!c.states.includes(state)) continue;
    if (c.appearances && !c.appearances.includes(appearance)) continue;
    if (c.sizes && !c.sizes.includes(size)) continue; // B2.9b：只在某些字号档跑（AX-01）
    let r;
    try { r = c.eval({ state, tag: `${appearance}_${size}`, appearance, size, web, native, px, screen, tolerance: tol }); } catch (error) { r = { pass: false, detail: `检查出错：${error.message}` }; }
    checks.push({ id: c.id, status: c.status, pass: !!r.pass, detail: r.detail });
  }
  results.push({ name, state, appearance, size, ok: webJson.ok && natJson.ok, errors: [webJson.error, natJson.error].filter(Boolean), diffs: kept.map(d => ({ type: d.type, aspects: d.aspects, label: d.label, msg: d.msg })), checks, px });
}
await browser.close();

// 汇总
const byType = {};
let total = 0;
for (const r of results) for (const d of r.diffs || []) { for (const a of d.aspects || [d.type]) byType[a] = (byType[a] || 0) + 1; total += 1; }
const checkSummary = {};
for (const r of results) for (const c of r.checks || []) {
  const s = checkSummary[c.id] || (checkSummary[c.id] = { id: c.id, status: c.status, runs: 0, failed: 0, details: [] });
  s.runs += 1;
  if (!c.pass) { s.failed += 1; if (s.details.length < 3) s.details.push(`${r.name}: ${c.detail}`); }
}
const regressions = Object.values(checkSummary).filter(s => s.status === 'pass' && s.failed);
const unexpectedPass = Object.values(checkSummary).filter(s => s.status === 'expected-fail' && !s.failed);
const expectedFail = Object.values(checkSummary).filter(s => s.status === 'expected-fail' && s.failed);
const TYPE = { position: '位置', size: '尺寸', text: '文案', color: '颜色', font: '字号字重', state: '可点状态', icon: '图标', missing: '基线有这次没有', extra: '这次多出', rule: '线', deco: '装饰', cell: '墨格' };
const md = [];
md.push('# 原生 vs 原生基线 逐屏对比报告（QA-H1，D84）', '');
md.push(`- 对比 ${results.length} 屏（状态 × 外观 × 字号），差异 **${total}** 条（一个元素各方面合一条；基线有这次没有 / 这次多出各一条）；容差：位置 ±${tol.pos}pt、尺寸 ±${tol.size}pt、颜色通道 ±${tol.color}、字号 ±${tol.font}pt、字重 ±${tol.weight}`);
md.push(`- 按类别（一条可含多类）：${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${TYPE[k] || k} ${v}`).join('、') || '无'}`);
md.push(`- 基线里已不是 native: true 的状态（不比）：${orphanBaseline.size} 个`);
md.push(`- 具名检查：预期失败（待修）${expectedFail.length} 条、意外通过 ${unexpectedPass.length} 条、回归 ${regressions.length} 条`);
const errs = results.filter(r => r.error || (r.errors && r.errors.length) || r.ok === false);
if (errs.length) md.push(`- 取证出错 ${errs.length} 屏：${errs.map(r => `${r.name}（${r.error || r.errors.join('；')}）`).join('，')}`);
md.push('', '## 具名检查', '', '| 编号 | 状态 | 结果 | 说明（最多 3 屏） |', '|---|---|---|---|');
for (const c of CHECKS) {
  const s = checkSummary[c.id];
  const res = !s ? '没跑到' : s.failed ? (c.status === 'expected-fail' ? `预期失败（待修）${s.failed}/${s.runs}` : `**回归** ${s.failed}/${s.runs}`) : (c.status === 'expected-fail' ? `**意外通过** ${s.runs}/${s.runs}（可改为 pass）` : `通过 ${s.runs}/${s.runs}`);
  md.push(`| ${c.id} | ${c.level} · ${c.title} | ${res} | ${(s && s.details.join('<br>')) || ''} |`);
}
for (const [id, where] of Object.entries(COVERED_ELSEWHERE)) md.push(`| ${id} | — | 见别处 | ${where} |`);
md.push('', '## 逐屏差异', '');
for (const r of results) {
  md.push(`### ${r.name}（${STATE_NAMES[r.state] || r.state}）— ${r.diffs ? r.diffs.length : 0} 条`, '');
  if (r.error) { md.push(`- 出错：${r.error}`, ''); continue; }
  md.push(`并排图：side-by-side/${r.name}.png`, '');
  for (const d of r.diffs) md.push(`- [${(d.aspects || [d.type]).map(a => TYPE[a] || a).join('·')}] ${d.label}：${d.msg}`);
  md.push('');
}
writeFileSync(join(outDir, 'report.md'), md.join('\n'));
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ total, byType, checks: checkSummary, results }, null, 2));
console.log(`compared ${results.length} screens: ${total} diffs (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}); named checks expected-fail ${expectedFail.length}, unexpected-pass ${unexpectedPass.length}, regressions ${regressions.length}; errors ${errs.length}`);
console.log(`report: ${join(outDir, 'report.md')}`);
// D84：基线就是原生自己，任何差异 / 缺基线 / 缺取证都是回归
process.exitCode = regressions.length || total || errs.length ? 1 : 0;
