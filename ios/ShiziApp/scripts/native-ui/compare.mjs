// QA-H1 逐屏对比：网页参考（标准答案）vs 原生取证。
//
// usage: node compare.mjs --ref <参考目录> --native <原生取证目录> --out <输出目录> [--config parity.config.json]
// 方法：以「元素清单 + 位置尺寸 + 文案 + 颜色」为主（elements.mjs 配对，容差见 parity.config.json），不做整图像素比；
//   笔迹区域不比（只比书写格的框，不比格里的墨）。另在截图上取少量像素（格底色、辅助线、题面空格、横画粗、遮罩），
//   供具名检查（parity-checks.mjs，两份 AI 报告的 NP-*）用。
// 输出：<out>/report.md（文本差异清单）、<out>/report.json、<out>/side-by-side/<状态>_<外观>_<字号>.png（左网页、右原生，差异框编号）。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { diffState } from './elements.mjs';
import { CHECKS, COVERED_ELSEWHERE } from './parity-checks.mjs';
import { STATE_NAMES } from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const refDir = args.ref;
const natDir = args.native;
const outDir = args.out;
const config = JSON.parse(readFileSync(args.config || join(here, 'parity.config.json'), 'utf8'));
const tol = config.tolerance;
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

/** 截图取样（在浏览器里读像素）。regions：网页参考的书写格、原生的题面空格。 */
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
  <div class="col"><h3>网页（参考）</h3><div class="stage"><img src="${dataUrl(webPng)}">${boxes('web')}</div></div>
  <div class="col"><h3>原生</h3><div class="stage"><img src="${dataUrl(natPng)}">${boxes('native')}</div></div>
  <div><h2>${escape(title)} · ${diffs.length} 条差异</h2><ol>${list}</ol></div>`;
  return page.setContent(html);
}

const escape = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const pairsFound = readdirSync(refDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const results = [];
for (const name of pairsFound) {
  const m = /^(.+)_(light|dark)_([A-Za-z0-9]+)$/.exec(name);
  if (!m) continue;
  const [, state, appearance, size] = m;
  const webJson = JSON.parse(readFileSync(join(refDir, `${name}.json`), 'utf8'));
  const natPath = join(natDir, `${name}.json`);
  if (!existsSync(natPath)) { results.push({ name, state, appearance, size, error: '没有原生取证' }); continue; }
  const natJson = JSON.parse(readFileSync(natPath, 'utf8'));
  const { diffs, web, native } = diffState(webJson, natJson, tol);
  const ignored = config.ignore || [];
  const kept = diffs.filter(d => !ignored.some(rule => (!rule.state || rule.state === state) && (!rule.type || rule.type === d.type) && (!rule.label || rule.label === d.label)));
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
    await render(page, { webPng, natPng, diffs: kept, title: `${STATE_NAMES[state] || state} · ${appearance} · ${size}`, screen });
    await page.screenshot({ path: join(outDir, 'side-by-side', `${name}.png`), fullPage: true });
  }
  const checks = [];
  for (const c of CHECKS) {
    if (!c.states.includes(state)) continue;
    if (c.appearances && !c.appearances.includes(appearance)) continue;
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
const TYPE = { position: '位置', size: '尺寸', text: '文案', color: '颜色', font: '字号字重', state: '可点状态', icon: '图标', missing: '原生缺少', extra: '原生多出' };
const md = [];
md.push('# 原生 vs 网页 逐屏对比报告（QA-H1）', '');
md.push(`- 对比 ${results.length} 屏（状态 × 外观 × 字号），差异 **${total}** 条（一个元素各方面合一条；原生缺少 / 多出各一条）；容差：位置 ±${tol.pos}pt、尺寸 ±${tol.size}pt、颜色通道 ±${tol.color}、字号 ±${tol.font}pt、字重 ±${tol.weight}`);
md.push(`- 按类别（一条可含多类）：${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${TYPE[k] || k} ${v}`).join('、') || '无'}`);
md.push(`- 具名检查（AI 报告 NP-*）：预期失败（待修）${expectedFail.length} 条、意外通过 ${unexpectedPass.length} 条、回归 ${regressions.length} 条`);
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
console.log(`compared ${results.length} screens: ${total} diffs (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}); NP checks expected-fail ${expectedFail.length}, unexpected-pass ${unexpectedPass.length}, regressions ${regressions.length}`);
console.log(`report: ${join(outDir, 'report.md')}`);
process.exitCode = regressions.length ? 1 : 0;
