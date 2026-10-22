// QA-H1 夹具开发工具：不开模拟器，在 Chromium 里把一个状态夹具的网页版跑出来（同一份 _runtime / _ops / 夹具，同一套步骤语义），
// 截一张图并打印页面上的文字与 data-testid，写新夹具 / 查夹具为什么不对时用。字号档与 iOS WebKit 的版式不是逐像素一样——
// 最终的参考图仍由 verify-native-ui.sh --reference-only 在模拟器里取。
//
// usage: node fixture-dev.mjs <状态 | 夹具.json 路径> [--out 截图.png] [--dark] [--width 402 --height 874] [--keep]
//   --keep：跑完不关浏览器窗口（--headed 有界面时看现场；默认 headless）
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { STATES_DIR } from './registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : acc), []));
const state = process.argv[2];
if (!state || state.startsWith('--')) { console.error('usage: node fixture-dev.mjs <state> [--out file.png] [--dark]'); process.exit(2); }

const read = p => JSON.parse(readFileSync(p, 'utf8'));
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && v && typeof v === 'object' && !Array.isArray(v) ? merge(o[k], v) : v; return o; };
function load(name) {
  const file = name.endsWith('.json') ? resolve(name) : join(STATES_DIR, `${name}.json`); // 也可直接给一个 .json 路径（草稿夹具）
  if (!existsSync(file)) throw new Error(`no fixture ${name}`);
  let fx = read(file);
  if (fx.template) fx = merge(read(join(STATES_DIR, '_templates', `${fx.template}.json`)), fx);
  return fx;
}
const runtime = n => readFileSync(join(STATES_DIR, '_runtime', `${n}.js`), 'utf8');
const ops = readdirSync(join(STATES_DIR, '_ops')).filter(f => f.endsWith('.js')).sort()
  .map(f => { const body = readFileSync(join(STATES_DIR, '_ops', f), 'utf8'); return `OPS[${JSON.stringify(f.slice(0, -3))}] = ${body.includes('await ') ? 'async ' : ''}(ctx, a) => {\n${body}\n};\n`; }).join('');
const RUN_JS = runtime('prologue') + ops + runtime('epilogue');
const STROKES_JS = runtime('strokes');
const LINES = [
  Array.from({ length: 14 }, (_, i) => [70 + 15 * i, 150 + i]),
  Array.from({ length: 14 }, (_, i) => [172 + 0.5 * i, 60 + 17 * i]),
];
const CHARS = ['永', '和', '春', '日', '月'];

function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
}
function headlessShell() {
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter(d => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) for (const sub of readdirSync(join(root, d))) { const exe = join(root, d, sub, 'chrome-headless-shell'); if (existsSync(exe)) return exe; }
  return null;
}
async function launch() {
  try { return await chromium.launch({ headless: !args.headed }); } catch (error) { const exe = headlessShell(); if (!exe) throw error; return chromium.launch({ executablePath: exe }); }
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/index.html`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: Number(args.width || 402), height: Number(args.height || 874) }, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: args.dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** 函数体 + 形参名 + 实参 → 在页面里当 async 函数跑（App 里是 callAsyncJavaScript 同一形态）。 */
const callBody = (body, names, values) => page.evaluate(({ body: b, names: n, values: v }) => new (Object.getPrototypeOf(async function noop() {}).constructor)(...n, b)(...v), { body, names, values });

async function waitReady(r) {
  const sel = r.webSelector || (r.web ? `.sz-layer[data-top="true"] [data-testid="${r.web}"]` : null);
  if (!sel) return;
  await page.waitForFunction(s => { const a = document.querySelector('.sz-app'); return !!a && a.dataset.navAnim === 'idle' && !!document.querySelector(s); }, sel, { timeout: (r.timeout || 5) * 1000 });
}
async function runSteps(steps) {
  for (const step of steps || []) {
    if (typeof step.wait === 'number') await sleep(step.wait);
    else if (step.tap) {
      const sel = step.tap.web || `.sz-layer[data-top="true"] [data-testid="${step.tap.webTestid}"]`;
      for (let i = 0; i < (step.times || 1); i += 1) {
        if (i > 0) await sleep(step.gap || 550);
        await page.evaluate(s => { const el = document.querySelector(s); if (!el || el.disabled) return false; el.click(); return true; }, sel);
      }
    } else if (step.ready) await waitReady(step.ready);
    else if (step.strokes) await callBody(STROKES_JS, ['lines'], [LINES]);
    else if (typeof step.js === 'string') await callBody(step.js, [], []);
    else if (step.repeat) for (let i = 0; i < step.repeat; i += 1) await runSteps(step.steps);
  }
}
async function run(name, top) {
  const fx = load(name);
  if (fx.base) await run(fx.base, false);
  const setup = fx.setup || [];
  if (!fx.base || setup.length) {
    const pin = (fx.clock && fx.clock.pin) || '';
    const res = await callBody(RUN_JS, ['setup', 'pin', 'chars', 'clock', 'reset'], [setup, pin, CHARS, '', !fx.base]).catch(e => ({ ok: false, error: String(e) }));
    if (!res || res.ok === false) throw new Error(`setup failed in ${name}: ${JSON.stringify(res)} ${typeof res} errors=${errors.join('|')}`);
  }
  if (fx.ready) await waitReady(fx.ready);
  await sleep(fx.settleBefore || 0);
  await runSteps(fx.steps);
  await sleep(fx.settle || 0);
}

try {
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => !!window.__shiziTest && !!document.querySelector('.sz-app'), null, { timeout: 15000 });
  await sleep(400);
  for (const pre of String(args.pre || '').split(',').filter(Boolean)) { await run(pre, true); await sleep(1500); } // --pre a,b：先按顺序跑这几个状态（模拟「同一次启动里前面已经跑过别的状态」）
  await run(state, true);
  const out = args.out || `/tmp/fixture-dev-${state}.png`;
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => {
    const app = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const scope = [top, ...document.querySelectorAll('.sz-sheet, .sz-confirm, .sz-overlay, .sz-undobar, .sz-toast, [role="dialog"]')].filter(Boolean);
    const ids = [...new Set(scope.flatMap(r => [...r.querySelectorAll('[data-testid]')].map(e => e.dataset.testid)))];
    return { debugTitle: document.title, topScreen: app && app.dataset.topScreen, text: scope.map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()).join(' ‖ ').slice(0, 900), ids };
  });
  console.log(JSON.stringify({ state, screenshot: out, ...info, errors }, null, 2));
} catch (error) {
  console.error(`FAILED ${state}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (!args.keep) { await browser.close(); server.kill(); }
}
