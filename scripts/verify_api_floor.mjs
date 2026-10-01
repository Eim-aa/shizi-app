#!/usr/bin/env node
// API 下限门禁（M6-7；01-架构设计 §13「禁用 API 表」、02-实现计划 §8「API 下限门禁，iOS ≥ 15」）。
//
// 不装新依赖（仓库没有 acorn / es-check / eslint-plugin-compat）：手写词法器把源码切成代码 / 字符串 / 模板 / 正则 / 注释，
// 在「代码」里查禁用 API，在正则字面量里查禁用语法，在 .css 与 JS 字符串 / 模板静态片段（组件样式、选择器）里查 CSS 特性；
// 顶层 await 由 Node 自己判定：去掉 import / export 声明后把模块体当作普通（非 async）函数体编译（vm.compileFunction），
// 函数外的 await 会报「await is only valid in async functions」，其它语法照常通过。
//
// 扫描范围：src/**/*.{js,mjs,css}、sw.js（classic worker 脚本）、vendor/ui.js。vendor 里的第三方压缩件不扫（来源见 THIRD_PARTY_NOTICES.md）。
//
// 级别：
//   error（退出码 1）—— 在 iOS 15.0 WKWebView 上会抛错 / 语法错 / 行为缺失的 API 与语法；
//   warn（只列出，不改变退出码）—— iOS 15.0 不认但会被整条丢弃、可降级的 CSS（容器查询单位、dvh、:focus-visible）。
// 允许清单 API_ALLOW：每条写明理由（例如已做特征检测）；不再命中任何源码的条目本身算 error（防止清单腐烂）。
// 每次运行先跑检查器自测（SELF_TEST：每条规则都要能抓到样例、放过对照），自测失败同样退出 1。
//
// 用法：node scripts/verify_api_floor.mjs [--json]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 规则表
// ---------------------------------------------------------------------------

/** 代码（字符串 / 注释 / 正则已抹掉）里的禁用 API。since = 首个支持的 iOS Safari 版本。 */
export const CODE_RULES = [
  { id: 'Object.hasOwn', re: /\bObject\s*\.\s*hasOwn\b/g, since: '15.4', hint: '用本地 hasOwn()（Object.prototype.hasOwnProperty.call）' },
  { id: 'Array.prototype.at', re: /\.\s*at\s*\(/g, since: '15.4', hint: 'a[a.length - 1] / s.charAt(i)' },
  { id: 'structuredClone', re: /\bstructuredClone\b/g, since: '15.4', hint: 'JSON 往返或手写拷贝' },
  { id: 'Array.prototype.findLast', re: /\.\s*findLast(Index)?\s*\(/g, since: '15.4', hint: '倒序 for 循环' },
  { id: 'Intl.Segmenter', re: /\bIntl\s*\.\s*Segmenter\b/g, since: '15.4', hint: 'Array.from(str) 按码点切；确需时特征检测并登记 API_ALLOW' },
  { id: 'crypto.randomUUID', re: /\.\s*randomUUID\s*\(/g, since: '15.4', hint: 'crypto.getRandomValues 拼' },
  { id: 'HTMLDialogElement.showModal', re: /\.\s*showModal\s*\(/g, since: '15.4', hint: '用 Sheet / Confirm 组件' },
  { id: 'inert (property)', re: /\.\s*inert\b/g, since: '15.5', hint: 'aria-hidden + 焦点陷阱（Sheet 已有）' },
  { id: 'Array change-by-copy', re: /\.\s*(toSorted|toReversed|toSpliced)\s*\(/g, since: '16', hint: 'slice().sort() / slice().reverse()' },
  { id: 'Array.fromAsync', re: /\bArray\s*\.\s*fromAsync\b/g, since: '16.4', hint: 'for await 收集' },
  { id: 'Object/Map.groupBy', re: /\b(Object|Map)\s*\.\s*groupBy\b/g, since: '17.4', hint: '手写 reduce' },
  { id: 'Promise.withResolvers', re: /\bPromise\s*\.\s*withResolvers\b/g, since: '17.4', hint: 'new Promise 取 resolve/reject' },
  { id: 'AbortSignal.timeout/any', re: /\bAbortSignal\s*\.\s*(timeout|any)\b/g, since: '16', hint: 'setTimeout + controller.abort()' },
  { id: 'String.prototype.isWellFormed', re: /\.\s*(isWellFormed|toWellFormed)\s*\(/g, since: '16.4', hint: '手写代理对检查' },
  { id: 'requestIdleCallback', re: /\brequestIdleCallback\b/g, since: '— (Safari 无)', hint: 'setTimeout / requestAnimationFrame' },
  { id: 'class static block', re: /\bstatic\s*\{/g, since: '16.4', hint: '类外初始化' },
];

/**
 * 必须特征检测的 API：出现处所在行要有 typeof 守卫（01 §13「getCoalescedEvents 特征检测」）。
 * 不是禁用，是「不检测就用」禁用。
 */
export const GUARDED_RULES = [
  { id: 'getCoalescedEvents', re: /\bgetCoalescedEvents\b/g, guard: /\btypeof\b/, since: '—（iOS WKWebView 可能缺）' },
];

/** 字符串 / 模板静态片段 / .css 里的禁用项（选择器、属性）。 */
export const TEXT_ERROR_RULES = [
  { id: ':has()', re: /:has\s*\(/g, since: '15.4', hint: '加类名或结构选择器' },
  { id: 'inert (attribute)', re: /(^|[\s<[])inert(?=\s*(=|\]|>|\/|\s|$))/g, since: '15.5', hint: 'aria-hidden + 焦点陷阱' },
  { id: 'regex lookbehind (RegExp string)', re: /\(\?<[=!]/g, since: '16.4', hint: '改写成前瞻或手写判断', onlyStrings: true },
];

/**
 * CSS：iOS 15.0 不认、整条声明 / 规则被丢弃但可降级的特性——只列出（warn）。
 * group 相同的归到一组待定项里。
 */
export const CSS_WARN_RULES = [
  { id: 'container query unit (cqw/cqh/cqi/cqb/cqmin/cqmax)', group: 'cq', re: /(?<![\w-])(\d*\.?\d+)(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/g, since: '16', decl: true },
  { id: 'container-type / @container', group: 'cq', re: /(?<![\w-])container-type\s*:|@container\b/g, since: '16', decl: false },
  { id: 'dynamic viewport unit (dvh/svh/lvh/dvw/svw/lvw)', group: 'dvh', re: /(?<![\w-])(\d*\.?\d+)(dvh|svh|lvh|dvw|svw|lvw)\b/g, since: '15.4', decl: true },
  { id: ':focus-visible', group: 'focus-visible', re: /:focus-visible\b/g, since: '15.4', decl: false },
];

/** 正则字面量里的禁用语法。 */
export const REGEX_RULES = [
  { id: 'regex lookbehind', test: (body) => hasLookbehind(body), since: '16.4', hint: '改写成前瞻或手写判断' },
  { id: 'regex v flag', test: (_body, flags) => flags.includes('v'), since: '17', hint: '用 u 标志' },
];

/**
 * 允许清单：{ file, rule, reason }。命中 file+rule 的发现降为「已登记」；
 * 一条也没命中的条目本身报错（与 verify_copy HARDCODE_ALLOW 同一约定）。
 */
export const API_ALLOW = [];

// ---------------------------------------------------------------------------
// 词法器
// ---------------------------------------------------------------------------

const REGEX_PREV_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * 源码 → { masked, tokens }。
 * masked：与源码等长，注释 / 字符串 / 模板静态片段 / 正则体换成空格（换行保留），只剩代码。
 * tokens：[{ type: 'str'|'tpl'|'regex'|'ident'|'punct'|'num', start, end, text, flags? }]；
 *   str / tpl 的 text 是原样内容（不含引号），start 指向内容起点；regex 的 text 是正则体。
 */
export function lex(src) {
  const n = src.length;
  const masked = src.split('');
  const tokens = [];
  const blank = (a, b) => { for (let j = a; j < b; j += 1) if (masked[j] !== '\n') masked[j] = ' '; };
  let i = 0;
  let prevSig = '';
  let braceDepth = 0;
  const tplStack = [];
  const regexAllowed = () => {
    if (!prevSig) return true;
    if (/^[A-Za-z_$][\w$]*$/.test(prevSig)) return REGEX_PREV_KEYWORDS.has(prevSig);
    if (/^[\d.]/.test(prevSig)) return false;
    return !(prevSig === ')' || prevSig === ']' || prevSig === '}' || prevSig === 'lit');
  };
  const readTemplate = () => {
    const start = i;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') {
        tokens.push({ type: 'tpl', start, end: i, text: src.slice(start, i) });
        blank(start, i);
        i += 1;
        return 'end';
      }
      if (ch === '$' && src[i + 1] === '{') {
        tokens.push({ type: 'tpl', start, end: i, text: src.slice(start, i) });
        blank(start, i);
        i += 2;
        return 'expr';
      }
      i += 1;
    }
    tokens.push({ type: 'tpl', start, end: n, text: src.slice(start, n) });
    blank(start, n);
    return 'end';
  };
  const afterTemplate = (r) => {
    if (r === 'expr') {
      tplStack.push(braceDepth);
      braceDepth += 1;
      prevSig = '{';
    } else prevSig = 'lit';
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '\n' || ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    if (ch === '#' && next === '!' && i === 0) {
      const e = src.indexOf('\n');
      blank(0, e < 0 ? n : e);
      i = e < 0 ? n : e;
      continue;
    }
    if (ch === '/' && next === '/') {
      const s = i;
      while (i < n && src[i] !== '\n') i += 1;
      blank(s, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      const start = i + 1;
      i += 1;
      while (i < n && src[i] !== ch && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      tokens.push({ type: 'str', start, end: i, text: src.slice(start, i) });
      blank(start, i);
      i += 1;
      prevSig = 'lit';
      continue;
    }
    if (ch === '`') {
      i += 1;
      afterTemplate(readTemplate());
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      const start = i + 1;
      i += 1;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        i += 1;
      }
      const bodyEnd = i;
      i += 1;
      const fStart = i;
      while (i < n && /[a-z]/i.test(src[i])) i += 1;
      tokens.push({ type: 'regex', start, end: bodyEnd, text: src.slice(start, bodyEnd), flags: src.slice(fStart, i) });
      blank(start, bodyEnd);
      prevSig = 'lit';
      continue;
    }
    if (/[A-Za-z_$\\]/.test(ch) || ch.charCodeAt(0) > 127) {
      const start = i;
      while (i < n && (/[\w$\\]/.test(src[i]) || src.charCodeAt(i) > 127)) i += 1;
      const word = src.slice(start, i);
      tokens.push({ type: 'ident', start, end: i, text: word });
      prevSig = word;
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(next || ''))) {
      const start = i;
      while (i < n && /[\w.]/.test(src[i])) i += 1;
      tokens.push({ type: 'num', start, end: i, text: src.slice(start, i) });
      prevSig = src.slice(start, i);
      continue;
    }
    if (ch === '{') braceDepth += 1;
    if (ch === '}') {
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth - 1) {
        tplStack.pop();
        braceDepth -= 1;
        i += 1;
        afterTemplate(readTemplate());
        continue;
      }
      braceDepth -= 1;
    }
    // 多字符标点合成一个 token（=> ?. ?? 等），prevSig 取最后一个字符即可判定正则位置。
    tokens.push({ type: 'punct', start: i, end: i + 1, text: ch });
    prevSig = ch;
    i += 1;
  }
  return { masked: masked.join(''), tokens };
}

/** 正则体里（字符类外）有没有 (?<= / (?<!。 */
export function hasLookbehind(body) {
  let inClass = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '\\') { i += 1; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(' && body[i + 1] === '?' && body[i + 2] === '<' && (body[i + 3] === '=' || body[i + 3] === '!')) return true;
  }
  return false;
}

export function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

/** CSS 文本里的注释换成等长空格（保留偏移）。 */
function blankCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

// ---------------------------------------------------------------------------
// 顶层 await：模块体去掉 import / export 声明后当作非 async 函数体编译
// ---------------------------------------------------------------------------

/** 把 ES 模块改写成等价的函数体（只为让 V8 判定 await 位置；偏移与行号不变）。 */
export function moduleToFunctionBody(src, tokens) {
  const out = src.split('');
  const blankRange = (a, b) => { for (let j = a; j < b; j += 1) if (out[j] !== '\n') out[j] = ' '; };
  const sig = tokens;
  let depth = 0; // ( [ { 总深度（模板 ${} 里的花括号由词法器吃掉一半，这里只看顶层声明）
  for (let k = 0; k < sig.length; k += 1) {
    const t = sig[k];
    if (t.type === 'punct') {
      if (t.text === '(' || t.text === '[' || t.text === '{') depth += 1;
      else if (t.text === ')' || t.text === ']' || t.text === '}') depth = Math.max(0, depth - 1);
      continue;
    }
    if (t.type !== 'ident') continue;
    const nx = sig[k + 1];
    if (t.text === 'import' && nx && nx.type === 'punct' && nx.text === '.') {
      // import.meta → (0,{}).meta（等长）
      out.splice(t.start, 6, '(', '0', ',', '{', '}', ')');
      continue;
    }
    if (depth !== 0) continue;
    if (t.text === 'import' && !(nx && nx.type === 'punct' && (nx.text === '(' || nx.text === '.'))) {
      // import … from 'x' / import 'x'：抹到第一个字符串字面量（及其后的分号）
      let m = k + 1;
      while (m < sig.length && sig[m].type !== 'str') m += 1;
      if (m >= sig.length) continue;
      let end = sig[m].end + 1;
      if (sig[m + 1] && sig[m + 1].type === 'ident' && (sig[m + 1].text === 'with' || sig[m + 1].text === 'assert')) {
        let q = m + 2;
        while (q < sig.length && !(sig[q].type === 'punct' && sig[q].text === '}')) q += 1;
        end = sig[q] ? sig[q].end : end;
        m = q;
      }
      if (sig[m + 1] && sig[m + 1].type === 'punct' && sig[m + 1].text === ';') end = sig[m + 1].end;
      blankRange(t.start, end);
      k = m;
      continue;
    }
    if (t.text === 'export') {
      if (nx && nx.type === 'ident' && nx.text === 'default') {
        // export default X → void X（等长：'export default' 14 字 → 'void' + 空格）
        blankRange(t.start, nx.end);
        out.splice(t.start, 4, 'v', 'o', 'i', 'd');
        k += 1;
        continue;
      }
      if (nx && nx.type === 'punct' && (nx.text === '{' || nx.text === '*')) {
        let m = k + 1;
        if (nx.text === '{') {
          while (m < sig.length && !(sig[m].type === 'punct' && sig[m].text === '}')) m += 1;
        }
        let end = sig[m] ? sig[m].end : src.length;
        const after = sig[m + 1];
        if ((after && after.type === 'ident' && after.text === 'from') || nx.text === '*') {
          while (m < sig.length && sig[m].type !== 'str') m += 1;
          end = sig[m] ? sig[m].end + 1 : end;
        }
        if (sig[m + 1] && sig[m + 1].type === 'punct' && sig[m + 1].text === ';') { end = sig[m + 1].end; m += 1; }
        blankRange(t.start, end);
        k = m;
        continue;
      }
      blankRange(t.start, t.end); // export const / function / class / let / async …
    }
  }
  return out.join('');
}

/** @returns {null | {line:number, message:string, tla:boolean}} */
export function checkTopLevelAwait(src, tokens, filename, isModule) {
  const body = isModule ? moduleToFunctionBody(src, tokens) : src;
  try {
    vm.compileFunction(`'use strict';${body}`, [], { filename });
    return null;
  } catch (error) {
    const m = /:(\d+)\s*$/m.exec(String(error.stack || '').split('\n')[0]);
    const line = m ? Number(m[1]) : 0;
    const message = String(error.message || error);
    return { line, message, tla: /await is only valid|only valid in async functions/.test(message) };
  }
}

// ---------------------------------------------------------------------------
// 单文件扫描
// ---------------------------------------------------------------------------

function cssDeclInfo(text, idx) {
  // 当前声明的属性名，以及同一规则块里它之前有没有同名、不含本特性的回退声明
  const open = text.lastIndexOf('{', idx);
  const block = text.slice(open + 1, idx);
  const parts = block.split(';');
  const cur = parts[parts.length - 1];
  const pm = /([-\w]+)\s*:[^:]*$/.exec(cur);
  const prop = pm ? pm[1] : '';
  const fallback = !!prop && parts.slice(0, -1).some(p => {
    const d = /^\s*([-\w]+)\s*:(.*)$/s.exec(p);
    return d && d[1] === prop && !/\d(cq\w+|[dsl]v[hw])\b/.test(d[2]);
  });
  return { prop, fallback };
}

/**
 * @param {string} rel 相对路径（报告与允许清单用）
 * @param {string} src
 * @returns {{errors: object[], warns: object[]}}
 */
export function scanSource(rel, src) {
  const errors = [];
  const warns = [];
  const isCss = rel.endsWith('.css');
  const push = (arr, rule, offset, extra = {}) => arr.push({ file: rel, line: lineOf(src, offset), rule: rule.id, since: rule.since, hint: rule.hint, ...extra });

  const cssTexts = []; // [{ text, base }]
  if (isCss) {
    cssTexts.push({ text: blankCssComments(src), base: 0 });
  } else {
    const isModule = rel !== 'sw.js' && !rel.endsWith('/sw.js') || rel.startsWith('src/'); // 根目录 sw.js 是 classic worker 脚本
    const { masked, tokens } = lex(src);
    for (const rule of CODE_RULES) {
      for (const m of masked.matchAll(rule.re)) push(errors, rule, m.index);
    }
    for (const rule of GUARDED_RULES) {
      for (const m of masked.matchAll(rule.re)) {
        const ls = masked.lastIndexOf('\n', m.index) + 1;
        const le = masked.indexOf('\n', m.index);
        const lineText = masked.slice(ls, le < 0 ? masked.length : le);
        if (!rule.guard.test(lineText)) push(errors, { ...rule, hint: '同一行用 typeof … === \'function\' 做特征检测' }, m.index);
      }
    }
    for (const t of tokens) {
      if (t.type === 'regex') {
        for (const rule of REGEX_RULES) if (rule.test(t.text, t.flags || '')) push(errors, rule, t.start);
      } else if (t.type === 'str' || t.type === 'tpl') {
        cssTexts.push({ text: t.type === 'tpl' ? blankCssComments(t.text) : t.text, base: t.start, str: true });
      }
    }
    const tla = checkTopLevelAwait(src, tokens, rel, isModule);
    if (tla) {
      if (tla.tla) errors.push({ file: rel, line: tla.line, rule: 'top-level await', since: '15（01 §13 仍禁用）', hint: '放进 async 函数' });
      else errors.push({ file: rel, line: tla.line, rule: 'parse', since: '', hint: `无法解析（检查器改写或语法错误）：${tla.message}` });
    }
  }

  for (const { text, base, str } of cssTexts) {
    for (const rule of TEXT_ERROR_RULES) {
      if (rule.onlyStrings && !str) continue;
      for (const m of text.matchAll(rule.re)) {
        const lead = m[1] && rule.id.startsWith('inert') ? m[1].length : 0;
        push(errors, rule, base + m.index + lead);
      }
    }
    for (const rule of CSS_WARN_RULES) {
      for (const m of text.matchAll(rule.re)) {
        const extra = { group: rule.group, snippet: text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8).replace(/\s+/g, ' ').trim() };
        if (rule.decl) Object.assign(extra, cssDeclInfo(text, m.index));
        push(warns, rule, base + m.index, extra);
      }
    }
  }
  return { errors, warns };
}

// ---------------------------------------------------------------------------
// 范围与汇总
// ---------------------------------------------------------------------------

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css)$/.test(name)) out.push(p);
  }
  return out;
}

export function scopeFiles(root = ROOT) {
  const files = walk(join(root, 'src'), []);
  files.push(join(root, 'sw.js'), join(root, 'vendor', 'ui.js'));
  return files.map(f => relative(root, f).split('\\').join('/')).sort();
}

export function applyAllow(errors, allow = API_ALLOW) {
  const used = new Set();
  const remaining = [];
  const allowed = [];
  for (const e of errors) {
    const idx = allow.findIndex(a => a.file === e.file && a.rule === e.rule);
    if (idx >= 0) { used.add(idx); allowed.push({ ...e, reason: allow[idx].reason }); } else remaining.push(e);
  }
  allow.forEach((a, idx) => {
    if (!used.has(idx)) remaining.push({ file: a.file, line: 0, rule: 'stale API_ALLOW', since: '', hint: `允许清单条目不再命中：${a.rule}（${a.reason}）` });
  });
  return { remaining, allowed };
}

// ---------------------------------------------------------------------------
// 检查器自测：每条规则一个必抓样例、一个必放对照
// ---------------------------------------------------------------------------

export const SELF_TEST = [
  // [文件名, 源码, 期望命中的 rule（null = 不应有任何 error）]
  ['t.js', 'const x = Object.hasOwn(a, "k");', 'Object.hasOwn'],
  ['t.js', 'const x = hasOwn(a, "k"); // Object.hasOwn(a) in comment', null],
  ['t.js', 'const last = list.at(-1);', 'Array.prototype.at'],
  ['t.js', 'const s = "list.at(-1) structuredClone(x)";', null],
  ['t.js', 'const c = structuredClone(v);', 'structuredClone'],
  ['t.js', 'const f = arr.findLast(x => x);', 'Array.prototype.findLast'],
  ['t.js', 'const f = arr.findLastIndex(x => x);', 'Array.prototype.findLast'],
  ['t.js', 'const seg = new Intl.Segmenter("zh");', 'Intl.Segmenter'],
  ['t.js', 'const r = s.replaceAll("a", "b"); a ??= 1; b ||= 2; class K { #p = 1; get p() { return this.#p; } }', null],
  ['t.js', 'const id = crypto.randomUUID();', 'crypto.randomUUID'],
  ['t.js', 'el.inert = true;', 'inert (property)'],
  ['t.js', 'const v = html`<div inert class="x"></div>`;', 'inert (attribute)'],
  ['t.js', 'const v = html`<div class="inertia"></div>`; const w = "inertia";', null],
  ['t.js', 'class A { static { init(); } }', 'class static block'],
  ['t.js', 'class A { static x = 1; static f() {} }', null],
  ['t.js', 'const re = /(?<=a)b/;', 'regex lookbehind'],
  ['t.js', 'const re = /(?<!a)b/g;', 'regex lookbehind'],
  ['t.js', 'const re = /(?<name>a)[(?<=]b/; const q = a / b / c;', null],
  ['t.js', 'const re = new RegExp("(?<=a)b");', 'regex lookbehind (RegExp string)'],
  ['t.js', 'const re = /a/v;', 'regex v flag'],
  ['t.js', 'const css = `.a:has(.b){color:red}`;', ':has()'],
  ['t.js', 'const list = e.getCoalescedEvents();', 'getCoalescedEvents'],
  ['t.js', 'const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];', null],
  ['t.js', 'import { a } from "./a.js";\nconst data = await load();\nexport default data;', 'top-level await'],
  ['t.js', 'import { a } from "./a.js";\nimport "./side.js";\nexport { a as b };\nexport * from "./c.js";\nexport const x = async () => { await a(); };\nexport default async function f() { for await (const y of z) {} }\nconst u = import.meta.url; const m = import("./d.js");', null],
  ['t.js', 'if (ok) { await go(); }', 'top-level await'],
  ['t.js', 'requestIdleCallback(run);', 'requestIdleCallback'],
  ['t.js', 'const s = arr.toSorted();', 'Array change-by-copy'],
  ['t.css', '.a { font-size: 12px; font-size: 34cqw; }', null],
  ['t.css', '.a:has(> .b) { color: red; }', ':has()'],
];

export function runSelfTest() {
  const problems = [];
  for (const [file, src, expect] of SELF_TEST) {
    const { errors } = scanSource(file, src);
    const rules = errors.map(e => e.rule);
    if (expect === null && rules.length) problems.push(`自测误报：${JSON.stringify(src)} → ${rules.join(', ')}`);
    if (expect !== null && !rules.includes(expect)) problems.push(`自测漏报：${JSON.stringify(src)} 应命中 ${expect}，实际 ${rules.join(', ') || '无'}`);
  }
  // warn 规则：cq 单位要列出并识别回退
  const w = scanSource('t.css', '.a{font-size:12px;font-size:34cqw}\n.b{font-size:clamp(9px, 16cqw, 12px);container-type:inline-size}\nbody{min-height:100vh;min-height:100dvh}\n.c:focus-visible{outline:0}').warns;
  const cq = w.filter(x => x.group === 'cq');
  if (cq.length !== 3) problems.push(`自测：cq 组应列出 3 处，实际 ${cq.length}`);
  if (!(cq[0] && cq[0].fallback === true && cq[1] && cq[1].fallback === false)) problems.push('自测：cq 回退识别不对');
  if (!w.some(x => x.group === 'dvh' && x.fallback === true)) problems.push('自测：dvh 回退识别不对');
  if (!w.some(x => x.group === 'focus-visible')) problems.push('自测：:focus-visible 未列出');
  // 允许清单：命中降级、不命中报 stale
  const al = applyAllow([{ file: 'a.js', line: 1, rule: 'X' }], [{ file: 'a.js', rule: 'X', reason: 'r' }, { file: 'b.js', rule: 'Y', reason: 'r' }]);
  if (al.allowed.length !== 1 || al.remaining.length !== 1 || al.remaining[0].rule !== 'stale API_ALLOW') problems.push('自测：API_ALLOW 处理不对');
  return problems;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export function run(root = ROOT) {
  const selfTest = runSelfTest();
  const files = scopeFiles(root);
  let errors = [];
  const warns = [];
  for (const rel of files) {
    const r = scanSource(rel, readFileSync(join(root, rel), 'utf8'));
    errors.push(...r.errors);
    warns.push(...r.warns);
  }
  const { remaining, allowed } = applyAllow(errors);
  errors = remaining;
  return { ok: selfTest.length === 0 && errors.length === 0, files: files.length, selfTest, errors, allowed, warns };
}

function report(result) {
  const out = [];
  out.push(`API 下限门禁（iOS ≥ 15.0 WKWebView）：扫描 ${result.files} 个文件（src/**/*.{js,mjs,css}、sw.js、vendor/ui.js）`);
  out.push(`检查器自测：${SELF_TEST.length} 个样例 + warn / 允许清单样例，${result.selfTest.length ? `${result.selfTest.length} 处不对` : '全部通过'}`);
  for (const p of result.selfTest) out.push(`  ✗ ${p}`);
  if (result.errors.length) {
    out.push(`error ${result.errors.length} 处：`);
    for (const e of result.errors) out.push(`  ✗ ${e.file}:${e.line}  ${e.rule}${e.since ? `（iOS ${e.since}+）` : ''}${e.hint ? ` —— ${e.hint}` : ''}`);
  } else out.push('error 0 处');
  for (const a of result.allowed) out.push(`  · 已登记 ${a.file}:${a.line} ${a.rule} —— ${a.reason}`);
  const groups = new Map();
  for (const w of result.warns) {
    if (!groups.has(w.group)) groups.set(w.group, []);
    groups.get(w.group).push(w);
  }
  const GROUP_NOTE = {
    cq: 'iOS 16 起才认容器查询：iOS 15 上含 cq 单位的声明被丢弃（规则本身仍插入），无回退的退回继承字号；container-type 同样被忽略。待定：M3/M4 的 cqw 字号是否改为 JS 计算。',
    dvh: 'iOS 15.4 起才认；有同名回退声明时 15.0–15.3 用回退值。',
    'focus-visible': 'iOS 15.4 起才认；15.0–15.3 上含它的规则整条丢弃，只少键盘焦点环，不影响触屏。',
  };
  for (const [g, list] of groups) {
    out.push(`warn [${g}] ${list.length} 处 —— ${GROUP_NOTE[g] || ''}`);
    for (const w of list) {
      const fb = w.prop ? `（${w.prop}${w.fallback ? '，有回退' : '，无回退'}）` : '';
      out.push(`  ! ${w.file}:${w.line}  ${w.rule}${fb}  ${w.snippet}`);
    }
  }
  out.push(result.ok ? 'verify_api_floor: OK' : 'verify_api_floor: FAILED');
  return out.join('\n');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = run();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(report(result));
  process.exit(result.ok ? 0 : 1);
}
