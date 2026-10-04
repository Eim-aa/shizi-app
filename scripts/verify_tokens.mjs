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
//                淡朱 --danzhu（T.danzhu）只许出现在提示与描一遍的当前笔那几处（src/ui/screens/write/ 与 src/ui/canvas/，DANZHU_ALLOW_DIRS）：
//                D49 ⑤ 起朱色只表示写错，字库墙上自选未写的空心字改用 ink4，不再用淡朱——别处再用淡朱会被这条拦住（同属 zhu 规则）。
//   legacy       旧令牌名（--p --c --i1 … --ar --g …）一律不许再出现。
//   glyph        练习字字形单一来源（阶段 1 P1-E2，D33 8a 方案 B、D44）：src/ui 与 src/core/images 里每一处用楷体字体（--kai / T.kai / FONTS.kai）
//                的规则 / 代码，必须逐条登记在 EXCEPTIONS（rule 'glyph'：印章、题跋 / 释义 / 词语文字、输入框、
//                轮廓缺失的回退分支……），写明为什么它不是「练习字」；练习字（要写的字、参考字、衬底字、墙 / 字帖 / 详情 / 图片里的标准字形）
//                一律走 ui/components/PracticeGlyph.js（SVG 轮廓）或 core/images/render.js paintOutline（canvas 轮廓）。登记过期也报错。
//
// 用法：node scripts/verify_tokens.mjs [--root=<目录>] [--quiet]   有违规退出码 1；--root 指向另一份源码树（比较旧代码用）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

export const SCAN_DIRS = Object.freeze(['src/ui', 'src/config']);
/** 只检查 glyph 规则的目录（图片导出的 canvas 字体）。 */
export const GLYPH_ONLY_DIRS = Object.freeze(['src/core/images']);
export const FONT_SCALE = Object.freeze([11, 13, 15, 17, 22, 28, 34]);
export const RULES = Object.freeze(['fontSize', 'radius', 'letterSpacing', 'color', 'zhu', 'legacy', 'glyph']);

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
 * 淡朱 --danzhu 的允许目录（D49 ⑤，color.roles.danzhu 的用途只剩「提示、描一遍当前笔」）。目录前缀，相对仓库根。
 */
export const DANZHU_ALLOW_DIRS = Object.freeze({
  'src/ui/screens/write/': '写字页：提示笔画 / 提示说明点（hint-layer）、看答案与描一遍的淡朱字形与描边（answer / glyph-fallback）',
  'src/ui/canvas/': '字形 canvas：提示 / 描红当前笔读令牌（glyph.js）',
});

/**
 * 登记的例外：{ rule, file, snippet（源码里出现的片段）, why }。过期（文件里已找不到 snippet）报错。
 */
export const EXCEPTIONS = Object.freeze([
  { rule: 'fontSize', file: 'src/ui/components/PracticeGlyph.js', snippet: 'font-size:calc(var(--pg-face) * 100cqw)', why: '练习字轮廓缺失时的楷体整字回退：字面尺寸 = 元素边长 × 字面比例（tokens.json typography.glyph.*Face，字面是图，ShiziKai 只做回退）' },
  { rule: 'fontSize', file: 'src/ui/screens/write/glyph-fallback.js', snippet: 'font-size:${Math.round(size * FALLBACK_FONT_RATIO * 100) / 100}px', why: '轮廓缺失时的楷体整字回退：字面尺寸 = 书写格边长 × 比例（字面是图，ShiziKai 只做回退）' },
  { rule: 'fontSize', file: 'src/ui/screens/mine/records.js', snippet: 'font-size:clamp(9px, 16cqw, 12px)', why: '字帖格里「没有笔迹」的小字，随格宽收缩；aria-hidden，同一信息在格子的 aria-label 里（X-MINE.cellLabel）' },
  { rule: 'fontSize', file: 'src/ui/components/query/input.js', snippet: "fontSize: '16px", why: '查字框的隐形代理 input（1×1、opacity 0）：iOS 对字号 < 16px 的输入框聚焦时会放大页面，所以这个看不见的框必须 ≥ 16px，与字阶无关' },
  // ---- glyph：楷体字体（--kai）只许用在这些地方（P1-E2；每条写明为什么它不是「练习字」）
  { rule: 'glyph', file: 'src/ui/components/PracticeGlyph.js', snippet: '.sz-pg__fb', why: '练习字组件自己的回退分支：轮廓缺失 / 取不到数据 / 不是汉字时的楷体整字（10.13 语义，ShiziKai 只做回退）' },
  { rule: 'glyph', file: 'src/ui/screens/write/glyph-fallback.js', snippet: '.sz-glyph-fb', why: '写字页 10.13 回退分支：看答案 / 对照 / 描一遍取不到笔顺数据时的楷体整字' },
  { rule: 'glyph', file: 'src/ui/screens/home/index.js', snippet: '.sz-home__seal>span', why: '首页题记 / 字帖落款旁的印章里的「字」（印章，不是练习字）' },
  { rule: 'glyph', file: 'src/ui/components/marks.js', snippet: '.sz-seal', why: '作品落款旁的印章（作品里唯一的一种印，<Seal/>；不是练习字）' },
  { rule: 'glyph', file: 'src/ui/screens/mine/about.js', snippet: '.sz-about__seal', why: '关于页的印章（品牌印，不是练习字）' },
  { rule: 'glyph', file: 'src/ui/screens/mine/about.js', snippet: '.sz-about__motto', why: '关于页的题记（整句文字，不是单个练习字）' },
  { rule: 'glyph', file: 'src/ui/screens/detail/records.js', snippet: '.sz-dsrc__text', why: '单字详情里的字源释义原文（整句题跋式文字，不是练习字）' },
  { rule: 'glyph', file: 'src/ui/screens/detail/index.js', snippet: '.sz-dcard__gloss', why: '单字详情里没有语境词时的释义（整句文字）' },
  { rule: 'glyph', file: 'src/ui/screens/library/list.js', snippet: '.sz-lrow__word', why: '清单行的语境词语（多字词整段文字，目标字加粗；不是单个练习字）' },
  { rule: 'glyph', file: 'src/ui/components/query/CharRow.js', snippet: '.sz-qrow__word', why: '查字结果行的语境词语（多字词文字）' },
  { rule: 'glyph', file: 'src/ui/components/query/CharCard.js', snippet: '.sz-qcard__word', why: '查字卡片的语境词语（多字词文字）' },
  { rule: 'glyph', file: 'src/ui/components/query/input.js', snippet: '.sz-query__input', why: '查字输入框：用户正在输入的文字（输入控件，不是标准字形）' },
  { rule: 'glyph', file: 'src/ui/screens/library/all.js', snippet: '.sz-all__input', why: '「有记录的字」页的找字输入框：用户正在输入的文字' },
  { rule: 'glyph', file: 'src/core/images/render.js', snippet: 'ctx.font = `400 ${Math.round(size * 0.8)}px ${FONTS.kai}`', why: '图片导出里轮廓缺失的衬底字回退（paintFallbackGlyph，10.13 语义；有数据时一律 paintOutline 画同一份轮廓）' },
  { rule: 'glyph', file: 'src/core/images/render.js', snippet: 'font = FONTS.kai', why: '印章默认字体（drawSeal；印章不是练习字）' },
  { rule: 'glyph', file: 'src/core/images/render.js', snippet: 'font: fonts.kai', why: '图片落款的印章（drawSeal；印章不是练习字）' },
  { rule: 'glyph', file: 'src/core/images/render.js', snippet: 'requireFont(fonts.kai, sealText)', why: '等印章字体就绪（印章不是练习字）' },
  { rule: 'glyph', file: 'src/core/images/annual-render.js', snippet: 'requireFont(fonts.kai, sealText)', why: '等年报印章字体就绪（印章不是练习字）' },
  { rule: 'glyph', file: 'src/core/images/annual-render.js', snippet: 'font: fonts.kai', why: '年报图片的印章（drawSeal；印章不是练习字）' },
  { rule: 'color', file: 'src/config/credits.js', snippet: '#', why: '致谢正文里的「#180」是议题编号（恰好是合法的 3 位十六进制），不是颜色' },
  { rule: 'color', file: 'src/config/char-order.js', snippet: '#', why: 'build_char_order.mjs 生成的新字顺序数据，removed / reserved 条目里的「字频#3919」是字频序号（恰好是合法的 4 位十六进制），不是颜色' },
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
const DANZHU_RE = /--danzhu\b|\bT\.danzhu\b/g;


const KAI_REF_RE = /\bFONTS\.kai\b|\bfonts\.kai\b|\bT\.kai\b|var\(--kai\)/g;
const KAI_FAMILY_RE = /font-family\s*:[^;]*(?:\bT\.kai\b|var\(--kai\))/;
// 另一种漏网：练习字用黑体 / 别的字体画文字（选择器带 glyph / __char 的规则）——同样要么改走轮廓组件，要么登记
const OTHER_GLYPH_FAMILY_RE = /font-family\s*:[^;]*(?:\bT\.hei\b|\bT\.song\b|var\(--hei\)|var\(--song\))/;
const GLYPH_SELECTOR_RE = /glyph|__char\b/;

/**
 * glyph 规则：找出所有用到楷体字体的规则（CSS 选择器）与代码行（canvas 字体等），返回 [{snippet, index}]。
 * 注释已去掉；`${…}` 里的花括号先遮住，免得拆坏 CSS 规则。
 */
export function findKaiUses(text) {
  const prot = text.replace(/\$\{[^{}]*\}/g, m => `\u0001\u0001${m.slice(2, -1).replace(/[{}]/g, '_')}\u0002`);
  const found = [];
  const spans = [];
  const ruleRe = /(?<=[{}`])([^{}`]*)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(prot))) {
    if (!KAI_FAMILY_RE.test(m[2]) && !(OTHER_GLYPH_FAMILY_RE.test(m[2]) && GLYPH_SELECTOR_RE.test(m[1]))) continue;
    const start = m.index + m[1].length + 1;
    spans.push([start, start + m[2].length]);
    found.push({ snippet: m[1].replace(/\s+/g, ' ').trim(), index: m.index + m[1].length - m[1].trimStart().length });
  }
  KAI_REF_RE.lastIndex = 0;
  while ((m = KAI_REF_RE.exec(prot))) {
    if (spans.some(([a, b]) => m.index >= a && m.index <= b)) continue;
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineEnd = text.indexOf('\n', m.index);
    found.push({ snippet: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim(), index: m.index });
  }
  return found;
}

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
    // 淡朱 --danzhu：只许提示 / 描一遍那几处（D49 ⑤）
    if (!Object.keys(DANZHU_ALLOW_DIRS).some(dir => rel.startsWith(dir))) {
      DANZHU_RE.lastIndex = 0;
      while ((m = DANZHU_RE.exec(text))) {
        out.push({ rule: 'zhu', file: rel, line: lineOf(text, m.index), snippet: text.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ').trim() });
      }
    }
    // 旧令牌名
    LEGACY_RE.lastIndex = 0;
    while ((m = LEGACY_RE.exec(text))) {
      out.push({ rule: 'legacy', file: rel, line: lineOf(text, m.index), snippet: m[0] });
    }
    // 练习字字形单一来源：楷体字体的每一处用法都要登记（P1-E2）
    for (const use of findKaiUses(text)) {
      const ex = EXCEPTIONS.find(e => e.rule === 'glyph' && e.file === rel && use.snippet.includes(e.snippet));
      if (ex) { used.add(ex); continue; }
      out.push({ rule: 'glyph', file: rel, line: lineOf(text, use.index), snippet: use.snippet.slice(0, 120) });
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
  for (const dir of GLYPH_ONLY_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      violations.push(...scanText(rel, fs.readFileSync(file, 'utf8'), used).filter(v => v.rule === 'glyph'));
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
