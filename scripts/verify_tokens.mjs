#!/usr/bin/env node
// 设计令牌门禁（阶段 1 P1-E1a；D33、D43；接进 pnpm test）。
//
// 扫描 src/ui 与 src/config 下的 .js / .css（注释不算），规则：
//   font-size    只能取字阶：${T.fsN} / var(--fsN)（N ∈ 11 13 15 17 22 28 34），或 calc(Npx * --k)（N 同上）。字格里随格宽变化的字面
//                （cqw / 比例）逐条登记在 EXCEPTIONS，写明理由；登记过期（源码里已没有）也报错。
//   border-radius 只能取三档 0 / 12px / 24px（${T.rWork|rCtl|rBox}、var(--r-work|ctl|box)）或 50%（圆点）；嵌套内圆角写
//                calc(var(--r-ctl) - Npx)（inner = outer − inset）。
//   letter-spacing 中文字距 0：只有竖排题记（同一条规则里有 writing-mode）可以不为 0。
//   color        颜色字面量（#hex、rgb()/rgba()/hsl() 里写死数字、white / black 等颜色名）只许出现在 tokens.css；图片导出 canvas 等
//                确实读不到令牌的地方逐条登记在 EXCEPTIONS，写明理由。
//   zhu          朱色（--zhu / --seal / --on-seal，T.zhu / T.seal / T.onSeal）只许出现在白名单组件（写错朱点、印章、落款）。
//   legacy       旧令牌名（--p --c --i1 … --ar --g …）一律不许再出现。
//
// 用法：node scripts/verify_tokens.mjs [--root=<目录>] [--quiet]   有违规退出码 1；--root 指向另一份源码树（比较旧代码用）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

export const SCAN_DIRS = Object.freeze(['src/ui', 'src/config']);
export const FONT_SCALE = Object.freeze([11, 13, 15, 17, 22, 28, 34]);
export const RULES = Object.freeze(['fontSize', 'radius', 'letterSpacing', 'color', 'zhu', 'legacy']);

/** 令牌文件本身：颜色字面量与旧名的「定义处」。 */
const TOKEN_FILE = 'src/config/tokens.css';

/**
 * 朱色白名单（文件 → 理由）。只有「写错的朱点」「印章」「落款」三类组件。
 * 文件级登记：这些文件里每一处引用 --zhu / --seal / --on-seal 都是下面说的那个用途。
 */
export const ZHU_ALLOW = Object.freeze({
  'src/ui/components/marks.js': '写错朱点（字墙 / 结果页 / 记录页格子上的同一个符号）与印章（首页题记、关于页、字帖落款）的样式，集中在这一个组件里',
});

/**
 * 登记的例外：{ rule, file, snippet（源码里出现的片段）, why }。过期（文件里已找不到 snippet）报错。
 */
export const EXCEPTIONS = Object.freeze([
  { rule: 'fontSize', file: 'src/ui/screens/library/wall.js', snippet: 'calc(245px / var(--cols))', why: '不认 cqw 的浏览器的回退（后一行 72cqw 生效时被覆盖）；同样是字墙格里的字面' },
  { rule: 'fontSize', file: 'src/ui/screens/library/wall.js', snippet: 'calc(72cqw / var(--cols))', why: '字墙格里的楷体字面，边长 = 格宽 × 0.72，随列数变化（字面是图，不是排版字阶；tokens.json typography.glyph）' },
  { rule: 'fontSize', file: 'src/ui/screens/mine/annual.js', snippet: 'font-size:34cqw', why: '年度字帖格里的占位字面，按格宽的 34% 算（字面是图）' },
  { rule: 'fontSize', file: 'src/ui/screens/mine/records.js', snippet: 'font-size:34cqw', why: '字帖格里的占位字面，按格宽的 34% 算（字面是图）' },
  { rule: 'fontSize', file: 'src/ui/screens/detail/index.js', snippet: 'font-size:min(24px, calc((100cqw - 2px) / var(--n, 2) * .6))', why: '词语小字帖里的字面：边长 = 格宽 × 0.6，随字数变化（字面是图）' },
  { rule: 'fontSize', file: 'src/ui/screens/write/glyph-fallback.js', snippet: 'font-size:${Math.round(size * FALLBACK_FONT_RATIO * 100) / 100}px', why: '轮廓缺失时的楷体整字回退：字面尺寸 = 书写格边长 × 比例（字面是图，ShiziKai 只做回退）' },
  { rule: 'fontSize', file: 'src/ui/screens/mine/records.js', snippet: 'font-size:clamp(9px, 16cqw, 12px)', why: '字帖格里「没有笔迹」的小字，随格宽收缩；aria-hidden，同一信息在格子的 aria-label 里（X-MINE.cellLabel）' },
  { rule: 'fontSize', file: 'src/ui/screens/mine/annual.js', snippet: 'font-size:clamp(9px, 13cqw, 12px)', why: '年度字帖格里「没有笔迹」的小字，同上' },
  { rule: 'fontSize', file: 'src/ui/screens/home/index.js', snippet: 'font-size:64px', why: '首页「拾」按钮里的品牌字面（E1b 按设计稿重排首页时改为字帖格 / 书家「拾」）' },
  { rule: 'fontSize', file: 'src/ui/screens/library/index.js', snippet: 'calc(46px * ${T.k})', why: '字库空态的空心字面（字面是图）' },
  { rule: 'fontSize', file: 'src/ui/screens/library/list.js', snippet: 'font-size:52px', why: '空态占位框（88×88）里的「字」字面（字面是图，约占格 60%）' },
  { rule: 'fontSize', file: 'src/ui/screens/mine/annual.js', snippet: 'font-size:52px', why: '空态占位框（88×88）里的「字」字面（字面是图）' },
  { rule: 'fontSize', file: 'src/ui/screens/result/index.js', snippet: 'font-size:40px', why: '结果页格子里的楷体回退字面，随格宽、不随字号倍率（格子宽度不变，放大会压到说明）' },
  { rule: 'fontSize', file: 'src/ui/components/query/input.js', snippet: "fontSize: '16px", why: '查字框的隐形代理 input（1×1、opacity 0）：iOS 对字号 < 16px 的输入框聚焦时会放大页面，所以这个看不见的框必须 ≥ 16px，与字阶无关' },
  { rule: 'color', file: 'src/config/credits.js', snippet: '#', why: '致谢正文里的「#180」是议题编号（恰好是合法的 3 位十六进制），不是颜色' },
  { rule: 'color', file: 'src/ui/screens/home/light.js', snippet: 'rgba(', why: '首页光影层是按时段着色的插画（设计说明 4：暖灯、叶影取消，E1b 重排首页时整层评估），颜色是装饰色不作令牌' },
  { rule: 'color', file: 'src/ui/canvas/glyph.js', snippet: '#', why: '字形 canvas 读不到 DOM（单测环境）时的最后回退色；浏览器里一律 getComputedStyle 读令牌' },
  { rule: 'color', file: 'src/ui/canvas/ink-canvas.js', snippet: '#', why: '笔迹 canvas 取色失败（无 DOM 的单测环境）时的回退，浏览器里读 --hand' },
  { rule: 'color', file: 'src/ui/screens/write/compare.js', snippet: '#', why: '同上：InkMini / paintMini 的回退墨色，浏览器里读 --hand' },
  { rule: 'color', file: 'src/ui/canvas/brush.js', snippet: '#', why: '笔刷纯函数的默认墨色与离屏 canvas 的 alpha 蒙版（#000 只当蒙版，不上屏）' },
  { rule: 'color', file: 'src/ui/canvas/brush.js', snippet: 'rgba(', why: '笔刷渐变的透明端点（alpha 蒙版，不上屏）' },
  { rule: 'color', file: 'src/ui/dev/pointer-stats.js', snippet: 'rgba(', why: '开发页（?dev=1）指针统计画布的示意色，不进产品界面' },
]);

// 旧令牌名：P1-E1a 之前的变量，一个都不许再引用。
const LEGACY_NAMES = ['p', 'c', 'sh', 'off', 'i1', 'i2', 'i3', 'i4', 'i5', 'a', 'ar', 'g', 'hint', 'tf', 'tl', 'o', 'ln', 'tt', 'tb', 'tm', 'tn', 'btn', 'down',
  'serif', 'sans', 'lamp', 'paper-image', 'paper-size', 'paper-position', 'paper-repeat', 'tap', 'st1', 'st2', 'hi', 'ho', 'sy0', 'syt', 'sys', 'syl'];
const LEGACY_RE = new RegExp(`var\\(\\s*--(?:${LEGACY_NAMES.join('|')})\\s*[,)]|\\bT\\.(?:p|c|sh|off|i[1-5]|a|ar|serif|sans)\\b`, 'g');

/** 去掉 // 与 块注释（不碰 :// 与字符串里的 //）。行数保持不变，报错行号可用。 */
export function stripComments(text) {
  const block = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return block.split('\n').map(line => {
    const i = line.search(/(?<![:'"\w])\/\/(?!\/)/);
    return i < 0 ? line : line.slice(0, i);
  }).join('\n');
}

const FS_TOKEN = new RegExp(`^(?:\\$\\{T\\.fs(?:${FONT_SCALE.join('|')})\\}|var\\(--fs(?:${FONT_SCALE.join('|')})\\))$`);
const FS_CALC = new RegExp(`^calc\\(\\s*(\\d+(?:\\.\\d+)?)px\\s*\\*\\s*(?:\\$\\{T\\.k\\}|\\$\\{TAB_SCALE_CAP\\}|var\\(--k(?:\\s*,\\s*1)?\\)|[\\d.]+)\\s*\\)$`);

/** font-size 取值是否落在字阶上。 */
export function fontSizeOk(value) {
  const v = value.trim();
  if (v === 'inherit' || v === 'initial' || v === 'unset') return true;
  if (FS_TOKEN.test(v)) return true;
  const m = FS_CALC.exec(v);
  return !!m && FONT_SCALE.includes(Number(m[1]));
}

const RADIUS_TOKEN = /^(?:0|0px|12px|24px|50%|inherit|\$\{T\.r(?:Work|Ctl|Box)\}|var\(--r-(?:work|ctl|box)\))$/;
const RADIUS_NEST = /^(?:max\(0px,\s*)?calc\(\s*(?:var\(--r-(?:ctl|box)\)|\$\{T\.r(?:Ctl|Box)\})\s*-\s*\d+(?:\.\d+)?px\s*\)\)?$/;

/** border-radius 取值（可多个、可带 /）是否都在三档（或圆点 50%）里。 */
export function radiusOk(value) {
  const v = value.trim();
  if (RADIUS_NEST.test(v)) return true;
  const parts = v.split(/[\s/]+/).filter(Boolean);
  return parts.length > 0 && parts.every(p => RADIUS_TOKEN.test(p));
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const FUNC_RE = /\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]/g;
const NAMED_RE = /\b(?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)*|outline(?:-color)?|box-shadow|text-shadow)\s*:\s*[^;}'"`]*\b(?:white|black|red|blue|green|gray|grey|orange|yellow|purple|pink|brown)\b/g;

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

const ZHU_RE = /var\(\s*--(?:zhu|seal|on-seal)\b|\bT\.(?:zhu|seal|onSeal)\b/g;

/**
 * 扫一个文件的文本，返回 [{rule, file, line, snippet}]（已去掉登记过的例外）。
 * rel：相对仓库根的路径（决定白名单与例外）；used：收集用到过的例外，供过期检查。
 */
export function scanText(rel, source, used = new Set()) {
  const out = [];
  const isTokens = rel === TOKEN_FILE;
  const text = stripComments(source);
  const exceptionFor = (rule, snippet) => EXCEPTIONS.find(e => e.rule === rule && e.file === rel && snippet.includes(e.snippet));

  if (!isTokens) {
    // font-size：CSS 声明与 JS 对象 / 赋值
    const fsRe = /(?:font-size\s*:|\bfontSize\s*(?::|=)\s*['"`])\s*((?:\$\{[^}]*\}|[^;}`'"$])*)/g;
    let m;
    while ((m = fsRe.exec(text))) {
      const value = m[1].trim();
      if (!value || fontSizeOk(value)) continue;
      const whole = text.slice(m.index, m.index + m[0].length);
      const ex = exceptionFor('fontSize', whole) || exceptionFor('fontSize', value);
      if (ex) { used.add(ex); continue; }
      out.push({ rule: 'fontSize', file: rel, line: lineOf(text, m.index), snippet: `font-size:${value}`.slice(0, 120) });
    }
    // border-radius
    const brRe = /(?:border-radius\s*:|\bborderRadius\s*(?::|=)\s*['"`])\s*((?:\$\{[^}]*\}|[^;}`'"$])*)/g;
    while ((m = brRe.exec(text))) {
      const value = m[1].trim();
      if (!value || radiusOk(value)) continue;
      out.push({ rule: 'radius', file: rel, line: lineOf(text, m.index), snippet: `border-radius:${value}`.slice(0, 120) });
    }
    // letter-spacing：整条规则里没有 writing-mode（竖排题记）就必须是 0 / normal / inherit
    const protectedText = text.replace(/\$\{[^{}]*\}/g, s => s.replace(/[{}]/g, '_'));
    const blockRe = /\{[^{}]*\}/g;
    while ((m = blockRe.exec(protectedText))) {
      const body = m[0];
      if (!/letter-spacing\s*:/.test(body) || /writing-mode/.test(body)) continue;
      for (const ls of body.matchAll(/letter-spacing\s*:\s*([^;}]*)/g)) {
        const v = ls[1].trim();
        if (v === '0' || v === '0px' || v === '0em' || v === 'normal' || v === 'inherit') continue;
        out.push({ rule: 'letterSpacing', file: rel, line: lineOf(text, m.index), snippet: `letter-spacing:${v}` });
      }
    }
    for (const ls of text.matchAll(/\bletterSpacing\s*(?::|=)\s*['"`]([^'"`]*)/g)) {
      const v = ls[1].trim();
      if (v === '0' || v === '0px' || v === 'normal' || v === 'inherit') continue;
      out.push({ rule: 'letterSpacing', file: rel, line: lineOf(text, ls.index), snippet: `letterSpacing:${v}` });
    }
    // 颜色字面量
    for (const re of [HEX_RE, FUNC_RE, NAMED_RE]) {
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        const ex = EXCEPTIONS.find(e => e.rule === 'color' && e.file === rel && m[0].startsWith(e.snippet));
        if (ex) { used.add(ex); continue; }
        out.push({ rule: 'color', file: rel, line: lineOf(text, m.index), snippet: text.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ').trim() });
      }
    }
    // 朱色白名单
    if (!ZHU_ALLOW[rel]) {
      ZHU_RE.lastIndex = 0;
      while ((m = ZHU_RE.exec(text))) {
        out.push({ rule: 'zhu', file: rel, line: lineOf(text, m.index), snippet: text.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ').trim() });
      }
    }
    // 旧令牌名
    LEGACY_RE.lastIndex = 0;
    while ((m = LEGACY_RE.exec(text))) {
      out.push({ rule: 'legacy', file: rel, line: lineOf(text, m.index), snippet: m[0] });
    }
  }
  return out;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 扫整个源码树（root 下的 src/ui 与 src/config）。返回 { violations, stale, checked, counts }。 */
export function scan({ root = REPO_ROOT } = {}) {
  const violations = [];
  const used = new Set();
  let checked = 0;
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      violations.push(...scanText(rel, fs.readFileSync(file, 'utf8'), used));
      checked += 1;
    }
  }
  const stale = root === REPO_ROOT ? EXCEPTIONS.filter(e => !used.has(e)) : [];
  const counts = Object.fromEntries(RULES.map(r => [r, violations.filter(v => v.rule === r).length]));
  return { violations, stale, checked, counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.find(a => a.startsWith('--root='));
  const quiet = process.argv.includes('--quiet');
  const root = rootArg ? path.resolve(rootArg.slice('--root='.length)) : REPO_ROOT;
  const { violations, stale, checked, counts } = scan({ root });
  if (!quiet) for (const v of violations) console.log(`[verify-tokens] ${v.rule} ${v.file}:${v.line}  ${v.snippet}`);
  for (const e of stale) console.log(`[verify-tokens] stale exception (${e.rule} ${e.file}: ${e.snippet.slice(0, 40)})`);
  const total = violations.length + stale.length;
  console.log(`[verify-tokens] checked ${checked} files; violations ${violations.length} (${RULES.map(r => `${r} ${counts[r]}`).join(', ')}); stale exceptions ${stale.length}`);
  process.exit(total ? 1 : 0);
}
