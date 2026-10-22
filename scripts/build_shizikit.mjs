#!/usr/bin/env node
// 生成原生组件库 ShiziKit 的令牌 / 文案 / 动效资源（B3.1；计划 B3B4-原生化架构与计划.md §3.2）：原生页面的颜色、字阶、文案、动效时长
// 构建期从网页的同一份来源导出，不再靠写字会话 API 的 open 回包（回包里的同名键在 DEBUG 下只作核对，B4 删）。做法同 scripts/build_core_config.mjs。
//
//   node scripts/build_shizikit.mjs           生成（有变化才写）
//   node scripts/build_shizikit.mjs --check   只核对：生成物与来源不同步则列出并退出 1
//                                             （test/ios-shizikit.test.mjs 在 verify:unit 里守；pnpm run verify:tokens / verify:copy 也跑）
//
// 来源：
//   docs/design/design-system-v1/tokens.json   space / radius / line / touch（与 tokens.css 的一致性由 test/tokens.test.mjs 守）
//   src/config/tokens.css                      颜色（浅 / 深两块的声明原文 = 页面 getComputedStyle(--name) 的值）、字阶表达式（:root 与 :root[data-ax="N"]）
//   src/config/policy.js                       contentSizeScale（系统字号档位 → --k，P130）
//   src/config/motion.js                       全部数据导出；写字 / 结果页用的那几组（write-api.js writeMotion / resultMotion / writeTiming）原样算好
//   src/config/copy                            COPY（键 → 字串 | 字串数组）
//
// 输出（提交进仓库，Xcode 工程 Resources 阶段进包，Swift 的 ShiziTokens / ShiziCopy 读）：
//   ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitTokens.json
//   ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitCopy.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = path.join(ROOT, 'ios/ShiziApp/ShiziApp/ShiziKit/Generated');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/** 系统字号档位（小到大），与 src/platform/text-size.js CONTENT_SIZE_CATEGORIES、policy.contentSizeScale 的键同序。 */
export const CATEGORIES = Object.freeze(['xS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'AX1', 'AX2', 'AX3', 'AX4', 'AX5']);

// ---------------------------------------------------------------- tokens.css

/** 从 needle 起到配对右花括号的块（不含外层花括号）。 */
function block(css, needle) {
  const start = css.indexOf(needle);
  if (start < 0) throw new Error(`tokens.css: ${needle} not found`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`tokens.css: ${needle} not closed`);
}

/** 块里的自定义属性声明 {名: 值原文}（去掉行尾注释；值按页面 getPropertyValue(...).trim() 的样子）。 */
function decls(text) {
  const out = {};
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1].slice(2)] = m[2].trim();
  return out;
}

const COLOR = /^(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))$/;
const SHADOW = /^(-?[\d.]+px\s+){3}rgba?\([^)]*\)(\s*,\s*(-?[\d.]+px\s+){3}rgba?\([^)]*\))*$/;

/** 浅 / 深两套颜色与阴影（只取颜色值与 box-shadow 串；var() 引用的纸纹不要）。深色媒体查询块与 data-theme="dark" 块必须一致。 */
export function colorsFromCss(css) {
  const pick = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => COLOR.test(v) || SHADOW.test(v)));
  const light = pick(decls(block(css, ':root[data-theme="light"]')));
  const media = pick(decls(block(block(css, '@media (prefers-color-scheme: dark)'), ':root:not([data-theme="light"])')));
  const forced = pick(decls(block(css, ':root[data-theme="dark"]')));
  if (JSON.stringify(media) !== JSON.stringify(forced)) throw new Error('tokens.css: dark media block and data-theme="dark" block differ');
  if (JSON.stringify(Object.keys(light)) !== JSON.stringify(Object.keys(media))) throw new Error('tokens.css: light and dark colour sets differ');
  return { light, dark: media };
}

const LEN = /^(fs\d+|lh\d+s?|btn-h|hit|gutter|group-gap|s\d+|r-[a-z]+|hair|frame-w|guide-w|target-w)$/;

/** 'Npx' | 'calc(Npx * var(--k))' | 'max(Apx, calc(Npx * var(--k)))' → (k) => px。其它写法直接报错（tokens.css 加了新写法要先在这里支持）。 */
function lengthExpr(name, raw) {
  let m = /^(-?[\d.]+)px$/.exec(raw);
  if (m) { const v = Number(m[1]); return () => v; }
  m = /^calc\(([\d.]+)px \* var\(--k\)\)$/.exec(raw);
  if (m) { const n = Number(m[1]); return (k) => n * k; }
  m = /^max\(([\d.]+)px, calc\(([\d.]+)px \* var\(--k\)\)\)$/.exec(raw);
  if (m) { const a = Number(m[1]), n = Number(m[2]); return (k) => Math.max(a, n * k); }
  throw new Error(`tokens.css: --${name}: unsupported length expression ${raw}`);
}

/**
 * WebKit 把算出来的长度存成 LayoutUnit（1/64 px，截断）：页面 typeBundle 用探针元素的 getComputedStyle(width) 量 --fsN，
 * 读回的就是截断后的值（XXXL 的 --fs17 = 17 × 1.35 = 22.95 → 22.9375）。原生要与页面同一个数才能逐屏对齐，这里按同样的规则取。
 */
export const layoutUnit = (px) => Math.trunc(px * 64 + 1e-9) / 64;

/** 每个系统字号档位的长度令牌（pt）：xS–XXXL 按 --k = policy.contentSizeScale[档位] 算 :root 的表达式；AX1–AX5 再用 :root[data-ax="N"] 的直接取值覆盖。 */
export function typeFromCss(css, scale) {
  const base = Object.entries(decls(block(css, ':root {'))).filter(([n]) => LEN.test(n)).map(([n, raw]) => [n, lengthExpr(n, raw)]);
  const out = {};
  for (const cat of CATEGORIES) {
    const k = scale[cat];
    if (!Number.isFinite(k)) throw new Error(`policy.contentSizeScale.${cat} missing`);
    const ax = /^AX([1-5])$/.exec(cat);
    const row = {};
    for (const [n, f] of base) row[n] = layoutUnit(f(ax ? 1 : k));
    if (ax) {
      for (const [n, raw] of Object.entries(decls(block(css, `:root[data-ax="${ax[1]}"]`)))) {
        if (!(n in row)) throw new Error(`tokens.css: data-ax="${ax[1]}" overrides unknown --${n}`);
        row[n] = layoutUnit(lengthExpr(n, raw)(1));
      }
    }
    out[cat] = { k, ax: ax ? Number(ax[1]) : 0, values: row };
  }
  return out;
}

// ---------------------------------------------------------------- 汇总

const dataExports = (mod, skip = []) => {
  const out = {};
  for (const [k, v] of Object.entries(mod)) if (typeof v !== 'function' && !skip.includes(k)) out[k] = v;
  return out;
};

/** 两份生成物的 JS 值。 */
export async function sources() {
  const css = fs.readFileSync(path.join(ROOT, 'src/config/tokens.css'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/design/design-system-v1/tokens.json'), 'utf8'));
  const policy = await imp('src/config/policy.js');
  const motion = await imp('src/config/motion.js');
  const writeApi = await imp('src/session/write-api.js');
  const { COPY } = await imp('src/config/copy/index.js');
  const tokens = {
    colors: colorsFromCss(css),
    type: { compactTextScale: policy.compactTextScale, categories: typeFromCss(css, policy.contentSizeScale) },
    space: json.space, radius: json.radius, line: json.line, touch: json.touch,
    // 写字页 open / 结果页 resultLook 回包里 motion / timing 的同一份值（write-api.js 同一批函数现算）；motion 是 motion.js 全部数据导出，给 B3 页面
    write: { motion: writeApi.writeMotion(), timing: writeApi.writeTiming() },
    result: { motion: { ...writeApi.writeMotion(), result: writeApi.resultMotion() }, timing: writeApi.writeTiming() },
    motion: dataExports(motion, ['M', 'css']),
  };
  return { ShiziKitTokens: tokens, ShiziKitCopy: COPY };
}

function assertJsonSafe(value, where) {
  const walk = (x, p) => {
    if (x === undefined || typeof x === 'function') throw new Error(`${where}: ${p} is not JSON data`);
    if (typeof x === 'number' && !Number.isFinite(x)) throw new Error(`${where}: ${p} is not finite`);
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${p}.${k}`);
  };
  walk(value, where);
}

/** 全部生成物：{文件名: 文本}。 */
export async function generate() {
  const out = {};
  for (const [name, value] of Object.entries(await sources())) {
    assertJsonSafe(value, name);
    out[name + '.json'] = JSON.stringify(value, null, 2) + '\n';
  }
  return out;
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await generate();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let stale = 0;
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(OUT_DIR, name);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const rel = path.relative(ROOT, file);
    if (check) {
      if (cur !== text) {
        stale += 1;
        process.stdout.write(`过期：${rel}（node scripts/build_shizikit.mjs）\n`);
      }
    } else if (cur !== text) {
      fs.writeFileSync(file, text);
      process.stdout.write(`已写：${rel}\n`);
    }
  }
  const known = new Set(Object.keys(files));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!known.has(f)) {
      stale += check ? 1 : 0;
      process.stdout.write(`多余：${f}\n`);
    }
  }
  if (check) process.stdout.write(stale ? `shizikit：${stale} 个不同步\n` : `shizikit：${Object.keys(files).length} 个文件与来源同步\n`);
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
