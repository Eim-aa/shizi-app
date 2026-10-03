#!/usr/bin/env node
// 文案门禁（01-架构设计 §11-4；02 M0-6）。
//
// 检查项：
//   1. copy-source.json 结构：每个槽的占位符都在登记表里；非机械值（override）必须写明 decision（P 编号）或 note。
//   2. 抽取源一致：重新解析 04-需求清单 §4.1 表格「文案」列的「」片段，逐条核对 copy-source.json——
//      每个片段（按「 / 」拆开的每一段）要么落到某个槽（raw/part），要么在 dropped 里写明原因；
//      槽的值 = 片段按统一规则规整后的结果（占位符统一、<br> 换成数组），否则必须有 decision/note。
//   3. copy/ 与 json 逐字一致：已声明范围内每个槽在 src/config/copy/<screen>.js 里存在且值完全相同；
//      copy/ 里不能有 json 未登记的键；键必须落在 json 指定的屏文件里。
//   4. 旧词表禁用、引号只用「」；值以 TODO: 开头的必须在 json.todo 允许表里，只报警（但第 13 项一律报错，所以 json.todo 现为空）。
//   5. policy.js：能被加载；每个导出项与嵌套键的注释含 P 编号，且编号在 03-待产品决定 有登记；
//      03 的每个 P 编号都被 policy.js、copy-source.json 的 decision 或 json.nonRuntimeDecisions 覆盖。
//   M6-4 文案审计（02 §8）：
//   6. 硬编码中文：src/ 内（除 copy/、_demo、dev 目录、注释、正则）含中文的字符串 / 模板字面量一律报错；
//      例外只有 HARDCODE_ALLOW（逐条写理由，过期也报错）与拼字引号「」（{chars} 约定）。
//   7. 旧词表（json.bannedWords）同样扫 src/ 源码字面量。
//   8. 数字口径（04 §3.1 T10）：copy 里汉字数字只许 json.numeralAllow 登记的键（R-M06 节号、落款等）；
//      汉字数字转换函数只许落款代码 import（CN_HELPER_FILES）。
//   9. 「导出」只作按钮名「导出备份文件」出现（04 §4.2 D24），其余登记在 json.exportWordAllow。
//  10. 占位符：copy 与 json 值里的花括号全部是登记过的 {name}；登记表里没人用的占位符报错。
//  11. TODO：json.todo 的键须在 json.todoRegistry 登记 P 编号且属于 json.todoDecisions（P55/P66/P76/P90）；
//      汇总为 warning 按 P 编号列出。
//  12. 镜像常量：core/cards.js 的 PROMPT_COPY / LIBRARIES.label 与 copy 逐字一致。
//  13. 占位文案（F2）：运行时文案值不得含 TODO / TBD / FIXME / 待补 / 占位（大小写不敏感）——会原样渲染给用户；
//      待产品定稿的槽写过渡文案并在 copy-source.json 的 note / 03 里标明，不再用 TODO 占位。
//
// 用法：node scripts/verify_copy.mjs [--scope=all|M<n>|R-H,R-W|screen:home] [--quiet]
//   --scope 缺省取 copy-source.json 的 gate.defaultScope。M<n> = milestone ≤ n 的条目（按里程碑逐步生效）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = Object.freeze({
  source: path.join(ROOT, 'docs/engineering/v10/copy-source.json'),
  requirements: path.join(ROOT, 'docs/engineering/v10/04-需求清单-第十稿.md'),
  pending: path.join(ROOT, 'docs/engineering/v10/03-待产品决定.md'),
  copyDir: path.join(ROOT, 'src/config/copy'),
  policy: path.join(ROOT, 'src/config/policy.js'),
});

// ---------------------------------------------------------------------------
// 04 §4.1 抽取
// ---------------------------------------------------------------------------

function splitCells(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.slice(1, -1).map((s) => s.trim());
}

/** 取出文本里最外层「」包住的片段（支持嵌套「」）。 */
export function quotedSegments(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '「') {
      if (depth > 0) cur += ch;
      depth += 1;
      continue;
    }
    if (ch === '」' && depth > 0) {
      depth -= 1;
      if (depth > 0) cur += ch;
      else {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    if (depth > 0) cur += ch;
  }
  return out;
}

/**
 * 解析 04 §4.1：返回 [{id, status, source, segments[]}]（按文档顺序；没有「文案」列的表 segments 为空）。
 */
export function extractSection41(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### 4.1'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('### 4.2'));
  if (start < 0 || end < 0) throw new Error('04 §4.1 not found');
  const rows = [];
  let header = null;
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    if (line.startsWith('| R |')) {
      header = splitCells(line);
      continue;
    }
    if (!/^\| R-[A-Z]+\d+ \|/.test(line) || !header) continue;
    const cells = splitCells(line);
    const col = (name) => {
      const idx = header.indexOf(name);
      return idx >= 0 ? cells[idx] : '';
    };
    rows.push({ id: cells[0], source: col('来源'), status: col('状态'), segments: quotedSegments(col('文案')) });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 规整规则（机械）：占位符统一、<br> → 数组
// ---------------------------------------------------------------------------

const PLACEHOLDER_RULES = [
  [/\{M\} 月 \{D\} 日/g, '{date}'],
  [/\{\d+ 月 \d+ 日\}/g, '{date}'],
  [/(^|[^A-Za-z{])M 月 D 日/g, '$1{date}'],
  [/\{日期\}/g, '{date}'],
  [/\{N\}/g, '{n}'],
  [/\{M\}/g, '{m}'],
  [/\{总数\}/g, '{total}'],
  [/\{字\}/g, '{char}'],
  [/\{X\}/g, '{char}'],
  [/「X」/g, '「{char}」'],
  [/\{词\}/g, '{word}'],
  [/\{月\}/g, '{month}'],
  [/\{时段\}/g, '{period}'],
  [/(^|[^A-Za-z{])N(?= 个)/g, '$1{n}'],
];

/** 片段（可选按「 / 」取第 part 段）→ 规整后的值（字符串或字符串数组）。 */
export function normalizeRaw(raw, part, splitter = ' / ') {
  let text = raw;
  if (part !== undefined && part !== null) {
    const parts = raw.split(splitter);
    if (part < 0 || part >= parts.length) throw new RangeError('part ' + part + ' out of range for 「' + raw + '」');
    text = parts[part];
  }
  for (const [re, rep] of PLACEHOLDER_RULES) text = text.replace(re, rep);
  if (text.includes('<br>')) return text.split('<br>');
  return text;
}

export function placeholdersOf(value) {
  const set = new Set();
  const texts = Array.isArray(value) ? value : [value];
  for (const t of texts) for (const m of String(t).matchAll(/\{([A-Za-z]+)\}/g)) set.add(m[1]);
  return set;
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

// ---------------------------------------------------------------------------
// 检查
// ---------------------------------------------------------------------------

function milestoneNumber(m) {
  const match = /^M(\d+)$/.exec(String(m || ''));
  return match ? Number(match[1]) : Infinity;
}

/** copy-source.json → 扁平槽列表 [{key, entryId, slot, screen, milestone, spec}]。 */
export function flattenSource(source) {
  const out = [];
  for (const group of ['entries', 'extra']) {
    for (const [entryId, entry] of Object.entries(source[group] || {})) {
      for (const [slot, spec] of Object.entries(entry.slots || {})) {
        out.push({ key: entryId + '.' + slot, entryId, slot, screen: entry.screen, milestone: entry.milestone, spec, group });
      }
    }
  }
  return out;
}

/** 解析 --scope。返回 (flatSlot) => boolean。 */
export function scopeFilter(scope) {
  if (!scope || scope === 'all') return () => true;
  if (/^M\d+$/.test(scope)) {
    const n = milestoneNumber(scope);
    return (s) => milestoneNumber(s.milestone) <= n;
  }
  if (scope.startsWith('screen:')) {
    const screens = new Set(scope.slice(7).split(','));
    return (s) => screens.has(s.screen);
  }
  const prefixes = scope.split(',').map((p) => p.trim()).filter(Boolean);
  return (s) => prefixes.some((p) => s.entryId === p || s.entryId.startsWith(p));
}

/** 1. json 结构 + 2. 抽取源一致。 */
export function checkSource(source, markdown) {
  const errors = [];
  const allowed = new Set(Object.keys(source.placeholders || {}).map((k) => k.replace(/[{}]/g, '')));
  for (const s of flattenSource(source)) {
    const { spec, key } = s;
    if (spec.text === undefined) errors.push(key + ': missing text');
    if (!s.screen) errors.push(key + ': entry has no screen');
    if (!s.milestone) errors.push(key + ': entry has no milestone');
    for (const p of placeholdersOf(spec.text)) if (!allowed.has(p)) errors.push(key + ': placeholder {' + p + '} not registered');
    if (spec.raw === undefined || spec.raw === null) {
      if (!spec.origin) errors.push(key + ': slot without raw needs origin');
      if (!spec.decision && !spec.note) errors.push(key + ': slot without raw needs decision or note');
      continue;
    }
    let normalized;
    try {
      normalized = normalizeRaw(spec.raw, spec.part, spec.split);
    } catch (e) {
      errors.push(key + ': ' + e.message);
      continue;
    }
    if (!sameValue(normalized, spec.text) && !spec.decision && !spec.note) {
      errors.push(key + ': value differs from normalized raw ' + JSON.stringify(normalized) + ' without decision/note');
    }
    if (sameValue(normalized, spec.text) && spec.override) {
      errors.push(key + ': marked override but equals normalized raw');
    }
  }
  if (markdown) {
    const rows = extractSection41(markdown);
    const known = new Set(rows.map((r) => r.id));
    const noCopy = new Set(source.noCopy || []);
    for (const row of rows) {
      const entry = (source.entries || {})[row.id];
      if (!row.segments.length) {
        if (!entry && !noCopy.has(row.id)) errors.push(row.id + ': no copy in 04 — list it in noCopy or add origin slots');
        continue;
      }
      if (noCopy.has(row.id)) errors.push(row.id + ': has copy in 04 but listed in noCopy');
      if (!entry) {
        errors.push(row.id + ': missing entry for 04 §4.1 copy ' + JSON.stringify(row.segments));
        continue;
      }
      const covered = new Map(); // raw → Set(parts) | 'whole'
      const mark = (raw, part, owner) => {
        if (!row.segments.includes(raw)) {
          errors.push(owner + ': raw 「' + raw + '」 not found in 04 ' + row.id + ' 文案列');
          return;
        }
        if (part === undefined || part === null) covered.set(raw, 'whole');
        else if (covered.get(raw) !== 'whole') {
          const set = covered.get(raw) || new Set();
          set.add(part);
          covered.set(raw, set);
        }
      };
      for (const [slot, spec] of Object.entries(entry.slots || {})) {
        if (spec.raw !== undefined && spec.raw !== null) mark(spec.raw, spec.part, row.id + '.' + slot);
      }
      for (const d of entry.dropped || []) {
        if (!d.why) errors.push(row.id + ': dropped 「' + d.raw + '」 needs why');
        mark(d.raw, d.part, row.id + ' dropped');
      }
      for (const seg of row.segments) {
        const c = covered.get(seg);
        if (!c) {
          errors.push(row.id + ': 04 copy 「' + seg + '」 not mapped to a slot or dropped');
          continue;
        }
        if (c !== 'whole') {
          const n = seg.split(' / ').length;
          for (let i = 0; i < n; i += 1) {
            if (!c.has(i)) errors.push(row.id + ': part ' + i + ' of 「' + seg + '」 not mapped or dropped');
          }
        }
      }
    }
    for (const id of Object.keys(source.entries || {})) {
      if (!known.has(id)) errors.push(id + ': entry not in 04 §4.1 (put non-§4.1 strings under extra)');
    }
  }
  return errors;
}

/** 3./4. copy 模块与 json 一致、禁用词、引号、TODO。 */
export function checkCopy(source, copyModules, { scope = 'all' } = {}) {
  const errors = [];
  const warnings = [];
  const inScope = scopeFilter(scope);
  const slots = flattenSource(source);
  const byKey = new Map(slots.map((s) => [s.key, s]));
  const fileOfKey = new Map();
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const key of Object.keys(table)) {
      if (fileOfKey.has(key)) errors.push(key + ': defined in both ' + fileOfKey.get(key) + ' and ' + screen);
      fileOfKey.set(key, screen);
      if (!byKey.has(key)) errors.push(key + ': in copy/' + screen + '.js but not registered in copy-source.json');
    }
  }
  let checked = 0;
  for (const s of slots) {
    const screen = fileOfKey.get(s.key);
    if (!screen) {
      errors.push(s.key + ': missing from src/config/copy/' + s.screen + '.js');
      continue;
    }
    if (screen !== s.screen) errors.push(s.key + ': expected in copy/' + s.screen + '.js, found in copy/' + screen + '.js');
    if (!inScope(s)) continue;
    checked += 1;
    const value = copyModules[screen][s.key];
    if (!sameValue(value, s.spec.text)) {
      errors.push(s.key + ': copy value ' + JSON.stringify(value) + ' ≠ copy-source ' + JSON.stringify(s.spec.text));
    }
  }
  const banned = source.bannedWords || [];
  const todoAllow = new Set(source.todo || []);
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const [key, value] of Object.entries(table)) {
      const texts = Array.isArray(value) ? value : [value];
      for (const t of texts) {
        if (typeof t !== 'string') {
          errors.push(key + ': value must be a string or string[]');
          continue;
        }
        for (const w of banned) if (t.includes(w)) errors.push(key + ' (' + screen + '): banned word 「' + w + '」');
        if (/["“”‘’『』]/.test(t)) errors.push(key + ' (' + screen + '): use 「」 instead of double quotes (or ‘’『』)');
        if (t.startsWith('TODO:')) {
          if (todoAllow.has(key)) warnings.push(key + ': 待文案 ' + t);
          else errors.push(key + ': TODO value not in copy-source.json todo allowlist');
        }
      }
    }
  }
  return { errors, warnings, checked };
}

/** 读 03 表里登记的 P 编号。 */
export function registeredPNumbers(pendingMarkdown) {
  const set = new Set();
  for (const m of pendingMarkdown.matchAll(/^\| (P\d{2,3}b?) \|/gm)) set.add(m[1]);
  return set;
}

/**
 * 5. policy.js 源码检查：每个 `export const/let/function` 的前导注释含 P 编号；
 * 导出的对象字面量里每个键在同一行或紧邻的前导注释里含 P 编号。
 * @returns {{errors: string[], exportsFound: string[], referenced: Set<string>}}
 */
export function checkPolicySource(policySource, registered) {
  const errors = [];
  const exportsFound = [];
  const referenced = new Set();
  const lines = policySource.split('\n');
  const P_RE = /\bP\d{2,3}b?\b/g;
  const noteRefs = (text, where) => {
    const refs = text.match(P_RE) || [];
    for (const r of refs) {
      referenced.add(r);
      if (registered && !registered.has(r)) errors.push(where + ': ' + r + ' is not registered in 03-待产品决定');
    }
    return refs.length > 0;
  };
  const leadingComment = (index) => {
    const out = [];
    for (let j = index - 1; j >= 0; j -= 1) {
      const t = lines[j].trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) out.unshift(t);
      else break;
    }
    return out.join('\n');
  };
  let objectDepth = 0;
  let objectName = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const exp = /^export\s+(?:const|let|function)\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (exp && objectDepth === 0) {
      const name = exp[1];
      exportsFound.push(name);
      const comment = leadingComment(i);
      const sameLine = (trimmed.match(/\/\/.*$/) || [''])[0];
      if (!noteRefs(comment + '\n' + sameLine, 'policy.' + name)) errors.push('policy.' + name + ': export has no P number in its comment');
      const opens = (line.match(/[{[]/g) || []).length;
      const closes = (line.match(/[}\]]/g) || []).length;
      if (opens > closes && /\{\s*$/.test(line.replace(/\/\/.*$/, '').trimEnd())) {
        objectDepth = opens - closes;
        objectName = name;
      }
      continue;
    }
    if (objectDepth > 0) {
      const code = line.replace(/\/\/.*$/, '');
      const prop = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(code);
      if (prop && objectDepth === 1) {
        const comment = leadingComment(i);
        const sameLine = (line.match(/\/\/.*$/) || [''])[0];
        if (!noteRefs(comment + '\n' + sameLine, 'policy.' + objectName + '.' + prop[1])) {
          errors.push('policy.' + objectName + '.' + prop[1] + ': key has no P number in its comment');
        }
      }
      objectDepth += (code.match(/[{[]/g) || []).length - (code.match(/[}\]]/g) || []).length;
      if (objectDepth <= 0) {
        objectDepth = 0;
        objectName = null;
      }
    }
  }
  return { errors, exportsFound, referenced };
}

/** policy 全量检查（含动态加载与 03 覆盖）。 */
export async function checkPolicy(source) {
  const errors = [];
  let mod;
  try {
    mod = await import(pathToFileURL(PATHS.policy).href);
  } catch (e) {
    return { errors: ['policy.js failed to load: ' + e.message], referenced: new Set() };
  }
  const registered = registeredPNumbers(fs.readFileSync(PATHS.pending, 'utf8'));
  const result = checkPolicySource(fs.readFileSync(PATHS.policy, 'utf8'), registered);
  errors.push(...result.errors);
  const runtimeExports = Object.keys(mod).sort();
  const parsed = [...result.exportsFound].sort();
  if (runtimeExports.join(',') !== parsed.join(',')) {
    errors.push('policy.js exports differ from parsed declarations: ' + runtimeExports.join(',') + ' vs ' + parsed.join(','));
  }
  const covered = new Set(result.referenced);
  for (const s of flattenSource(source)) {
    for (const m of String(s.spec.decision || '').matchAll(/\bP\d{2,3}b?\b/g)) covered.add(m[0]);
  }
  for (const entry of Object.values({ ...(source.entries || {}), ...(source.extra || {}) })) {
    for (const d of entry.dropped || []) for (const m of String(d.why || '').matchAll(/\bP\d{2,3}b?\b/g)) covered.add(m[0]);
  }
  for (const p of Object.keys(source.nonRuntimeDecisions || {})) covered.add(p);
  for (const p of registered) if (!covered.has(p)) errors.push(p + ': registered in 03 but not covered by policy.js / copy-source decisions / nonRuntimeDecisions');
  return { errors, referenced: result.referenced };
}

// ---------------------------------------------------------------------------
// 6.–10. M6-4 文案审计：硬编码中文、源码旧词、数字口径、「导出」、占位符、TODO 登记、镜像常量
// ---------------------------------------------------------------------------

/** 汉字 + 中文标点 / 全角符号（「」，。：？！…）。 */
export const CJK_RE = /[㐀-䶿一-鿿豈-﫿　-〿！-～]/;
const REGEX_PREV_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * JS 源码 → 字符串 / 模板字面量片段 [{line, text, kind: 'string'|'template'}]。
 * 跳过注释与正则字面量；模板按 ${} 切成静态片段（表达式里的字面量照常收）。
 * 模板静态片段里的 CSS 注释（组件样式字串）一并去掉。
 */
export function stringLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let braceDepth = 0;
  const tplStack = []; // 每个 ${ 打开时的 braceDepth
  let prevSig = '';
  const regexAllowed = () => {
    if (!prevSig) return true;
    if (/^[A-Za-z_$][\w$]*$/.test(prevSig)) return REGEX_PREV_KEYWORDS.has(prevSig);
    if (/^[\d.]/.test(prevSig)) return false;
    return !(prevSig === ')' || prevSig === ']' || prevSig === '}' || prevSig === 'lit');
  };
  const pushTemplate = (startLine, text) => {
    out.push({ line: startLine, text: text.replace(/\/\*[\s\S]*?\*\//g, ''), kind: 'template' });
  };
  // 从模板的静态片段起点读到 ` 或 ${；返回 'end' | 'expr'
  const readTemplate = () => {
    const startLine = line;
    let text = '';
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') {
        if (src[i + 1] === '\n') line += 1;
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '`') {
        i += 1;
        pushTemplate(startLine, text);
        return 'end';
      }
      if (ch === '$' && src[i + 1] === '{') {
        i += 2;
        pushTemplate(startLine, text);
        return 'expr';
      }
      if (ch === '\n') line += 1;
      text += ch;
      i += 1;
    }
    pushTemplate(startLine, text);
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
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let j = i; j < stop; j += 1) if (src[j] === '\n') line += 1;
      i = stop;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      const startLine = line;
      let text = '';
      i += 1;
      while (i < n && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') {
          text += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push({ line: startLine, text, kind: 'string' });
      prevSig = 'lit';
      continue;
    }
    if (ch === '`') {
      i += 1;
      afterTemplate(readTemplate());
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      i += 1;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const c = src[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      while (i < n && /[a-z]/.test(src[i])) i += 1;
      prevSig = 'lit';
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      prevSig = '{';
      i += 1;
      continue;
    }
    if (ch === '}') {
      braceDepth -= 1;
      i += 1;
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth) {
        tplStack.pop();
        afterTemplate(readTemplate());
        continue;
      }
      prevSig = '}';
      continue;
    }
    const word = /^(?:[A-Za-z_$][\w$]*|\d[\w.]*)/.exec(src.slice(i, i + 80));
    if (word) {
      prevSig = word[0];
      i += word[0].length;
      continue;
    }
    prevSig = ch;
    i += 1;
  }
  return out;
}

/** CSS 源码 → 去掉注释后仍含中文的行（content: '…' 之类）。 */
export function cssCjkLines(src) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  const out = [];
  stripped.split('\n').forEach((l, idx) => {
    if (CJK_RE.test(l)) out.push({ line: idx + 1, text: l.trim(), kind: 'css' });
  });
  return out;
}

/** 扫描范围外：文案表本身、开发演示目录（_demo、dev）。 */
export function hardcodeExcluded(rel) {
  const parts = rel.split('/');
  if (rel.startsWith('src/config/copy/')) return true;
  return parts.includes('_demo') || parts.includes('dev');
}

/**
 * 拼字用的引号：{chars} / {seen} / {skipped} 占位符约定由调用方把每个字拼成「X」（copy-source.json placeholders），
 * 片段去掉空白后只剩「、」或「」时不算文案。
 */
export function isQuoteJoiner(text) {
  const t = text.replace(/\s+/g, '');
  return t === '「' || t === '」' || t === '「」';
}

/**
 * 硬编码中文允许表（逐条写明为什么不是界面文案或为什么留在原处）。每条必须仍命中至少一个字面量，否则报「过期」。
 * file：相对仓库根；texts：字面量全文（去首尾空白后逐字相等）；any：整份文件；why：理由。
 */
export const HARDCODE_ALLOW = Object.freeze([
  { file: 'src/config/credits.js', any: true, why: 'scripts/build_credits.mjs 生成：THIRD_PARTY_NOTICES 与许可全文逐字（法律文本，P90 原文展示），不是界面文案' },
  { file: 'src/config/epigraphs.js', any: true, why: '首页题记三条（决定-D13 / R-H13）逐字取自原型首页壳 L141，test/core/epigraphs.test.mjs 逐字核对；是引文不是界面文案' },
  { file: 'src/config/policy.js', texts: ['尴', '嚏', '狩', '晤', '飓'], why: 'P09 firstQueue：第一次练习的 5 个字（数据）' },
  {
    file: 'src/config/char-order.js',
    any: true,
    why: 'scripts/build_char_order.mjs 从易忘度字表初稿生成的新字顺序数据（D28 / D39 / D40：字表、热身字、保留字、大写数字特别组词语与提示句，待顾问审读），数据不是界面文案',
  },
  {
    file: 'src/core/cards.js',
    texts: ['空格里是同一个字，只写一次。', '这个字暂时没有常用词，按拼音写就好', '同一目标字的另一处空格', '？'],
    why: 'PROMPT_COPY 默认值：内容门禁（verify_content_corpus）要求与 #175 逐字一致；UI 一律从 copy 传入同值，本脚本 checkMirrors 核对与 R-W28 / X-PROMPT 逐字相等',
  },
  {
    file: 'src/core/cards.js',
    texts: ['规范常用字', '规范次常用字', '规范专门用字', '小学初中常用字'],
    why: 'LIBRARIES.label：库身份标签（内容门禁 identitySha256 依赖），界面库名一律取 R-L06.lib.*.name；checkMirrors 核对逐字相等',
  },
  { file: 'src/core/cards.js', texts: ['一级', '二级', '三级', '表一', '综合', '进阶'], why: 'SEED 题库字段取值（norm / edu / topic / band），数据不是文案' },
  { file: 'src/core/dates.js', texts: ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '零', '两', '十', '百', '千'], why: '落款汉字数字与数量词「两」（D36；04 §3.1 T10 / 文案-D3，纸面落款专用）' },
  { file: 'src/core/records.js', texts: ['cardKey must be base:<字> or custom:<字>'], why: '记录形状校验的开发者错误信息，不上界面' },
  { file: 'src/ui/canvas/glyph.js', texts: ['字'], why: 'HanziWriter.create 缺字时的占位字形参数，不是文字' },
  { file: 'src/ui/components/query/demo.js', any: true, why: '查字组件开发演示页（?dev=1），开发标签不是用户文案（同 _demo / dev 目录）' },
  { file: 'src/ui/screens/home/index.js', texts: ['写字（测试）'], why: 'M1-1 测试宿主（?test=1 且 localhost）才出现的开发入口标签（同 _demo）' },
  { file: 'src/ui/screens/mine/about.js', texts: ['，'], why: '关于页行的读屏标签把两段文案（均取自 copy）用中文逗号连起来；连接符不是独立文案' },
]);

function walkFiles(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc.sort();
}

/** src/ 下每个 .js/.mjs 文件的字面量 → [{file, line, text, kind}]（含扫描范围外的文件，调用方再过滤）。 */
export function collectSourceLiterals(root = ROOT) {
  const out = [];
  for (const f of walkFiles(path.join(root, 'src'), ['.js', '.mjs'])) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const lit of stringLiterals(fs.readFileSync(f, 'utf8'))) out.push({ file: rel, ...lit });
  }
  for (const f of walkFiles(path.join(root, 'src'), ['.css'])) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const lit of cssCjkLines(fs.readFileSync(f, 'utf8'))) out.push({ file: rel, ...lit });
  }
  return out;
}

/** 6. 硬编码中文：src/ 内（除 copy/、_demo、dev）含中文的字面量一律报错，允许表除外；允许表过期也报错。 */
export function checkHardcoded(literals, allow = HARDCODE_ALLOW) {
  const errors = [];
  const used = new Set();
  let allowed = 0;
  for (const lit of literals) {
    if (hardcodeExcluded(lit.file)) continue;
    if (!CJK_RE.test(lit.text)) continue;
    if (isQuoteJoiner(lit.text)) {
      allowed += 1;
      continue;
    }
    const idx = allow.findIndex((a) => a.file === lit.file && (a.any || (a.texts || []).includes(lit.text.trim())));
    if (idx >= 0) {
      used.add(idx);
      allowed += 1;
      continue;
    }
    const shown = lit.text.replace(/\s+/g, ' ').trim();
    errors.push(lit.file + ':' + lit.line + ': hardcoded Chinese literal 「' + (shown.length > 60 ? shown.slice(0, 60) + '…' : shown) + '」 — move it into src/config/copy/ (and copy-source.json)');
  }
  allow.forEach((a, idx) => {
    if (!used.has(idx)) errors.push('HARDCODE_ALLOW ' + a.file + (a.any ? '' : ' ' + JSON.stringify(a.texts)) + ': stale allowlist entry (no longer matches any literal)');
  });
  return { errors, allowed };
}

/** 7. 旧词表同样适用于 src/ 源码字面量（不含注释；生成的许可原文除外）。 */
export function checkBannedInSource(literals, banned) {
  const errors = [];
  for (const lit of literals) {
    if (lit.file.startsWith('src/config/copy/') || lit.file === 'src/config/credits.js') continue;
    for (const w of banned) if (lit.text.includes(w)) errors.push(lit.file + ':' + lit.line + ': banned word 「' + w + '」 in source literal');
  }
  return errors;
}

/**
 * 8. 数字口径（04 §3.1 T10）：界面一律阿拉伯数字，落款保留汉字数字。
 * 命中：汉字数字（除「一」，一个 / 一次 / 一句 是量词习惯说法）后接量词、两位以上汉字数字、「第二…」、「二 · 」式节号。
 */
export const CN_NUMERAL_RE = /[〇零两二三四五六七八九十百千万]+(?=\s*[个次天日月年笔组周遍张份字行节画格位])|[〇零一二三四五六七八九十百千万两]{2,}|第[二三四五六七八九十百]+|^[一二三四五六七八九十]+ · /g;

function keyAllowed(key, table) {
  return Object.keys(table || {}).some((pattern) => (pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern));
}

export function checkNumerals(copyModules, source) {
  const errors = [];
  const allow = source.numeralAllow || {};
  const hitPatterns = new Set();
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const [key, value] of Object.entries(table)) {
      for (const t of Array.isArray(value) ? value : [value]) {
        if (typeof t !== 'string') continue;
        const bare = t.replace(/\{[A-Za-z]+\}/g, '');
        const hits = bare.match(CN_NUMERAL_RE);
        if (!hits) continue;
        const pattern = Object.keys(allow).find((p) => keyAllowed(key, { [p]: 1 }));
        if (pattern) hitPatterns.add(pattern);
        else errors.push(key + ' (' + screen + '): Chinese numeral 「' + hits.join('」「') + '」 — use Arabic digits (04 §3.1 T10) or list the key in copy-source.json numeralAllow');
      }
    }
  }
  for (const [p, why] of Object.entries(allow)) if (!why) errors.push('numeralAllow ' + p + ': needs a reason');
  return { errors, hitPatterns };
}

/** 汉字数字转换函数（core/dates.js cnNumber / cnCount / cnDigits / signature*Parts）只许落款代码用。 */
export const CN_HELPER_FILES = Object.freeze(['src/core/dates.js', 'src/ui/images-entry.js', 'src/ui/screens/mine/records.js']);

export function checkNumeralHelpers(root = ROOT) {
  const errors = [];
  for (const f of walkFiles(path.join(root, 'src'), ['.js', '.mjs'])) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (CN_HELPER_FILES.includes(rel) || hardcodeExcluded(rel)) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (/\b(?:cnNumber|cnCount|cnDigits|signatureDateParts|signatureMonthParts)\b/.test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) {
      errors.push(rel + ': uses a Chinese-numeral helper outside the 落款 code paths (04 §3.1 T10; CN_HELPER_FILES)');
    }
  }
  return errors;
}

/** 9. 「导出」只作按钮名「导出备份文件」出现（04 §4.2 D24：「导出」→「备份」，按钮除外）；其余登记在 exportWordAllow。 */
export function checkExportWord(copyModules, source) {
  const errors = [];
  const allow = source.exportWordAllow || {};
  const used = new Set();
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const [key, value] of Object.entries(table)) {
      for (const t of Array.isArray(value) ? value : [value]) {
        if (typeof t !== 'string') continue;
        if (!t.replace(/导出备份文件/g, '').includes('导出')) continue;
        if (Object.prototype.hasOwnProperty.call(allow, key)) used.add(key);
        else errors.push(key + ' (' + screen + '): 「导出」 outside the button name 「导出备份文件」 — say 「备份」 (04 §4.2 D24) or list it in copy-source.json exportWordAllow');
      }
    }
  }
  for (const [key, why] of Object.entries(allow)) {
    if (!why) errors.push('exportWordAllow ' + key + ': needs a reason');
    else if (!used.has(key)) errors.push('exportWordAllow ' + key + ': stale entry (value no longer says 导出)');
  }
  return errors;
}

/** 10. 占位符：copy 值里的花括号只能是登记过的 {name}；登记表里每个占位符至少有一个槽在用；json 里的值同查。 */
export function checkPlaceholders(copyModules, source) {
  const errors = [];
  const registered = new Set(Object.keys(source.placeholders || {}).map((k) => k.replace(/[{}]/g, '')));
  const used = new Set();
  const scan = (where, t) => {
    if (typeof t !== 'string') return;
    for (const m of t.matchAll(/\{([A-Za-z]+)\}/g)) {
      used.add(m[1]);
      if (!registered.has(m[1])) errors.push(where + ': placeholder {' + m[1] + '} not registered in copy-source.json placeholders');
    }
    const rest = t.replace(/\{[A-Za-z]+\}/g, '');
    if (/[{}｛｝]/.test(rest)) errors.push(where + ': malformed placeholder in ' + JSON.stringify(t) + ' (use {name} with ASCII letters)');
  };
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const [key, value] of Object.entries(table)) for (const t of Array.isArray(value) ? value : [value]) scan(key + ' (' + screen + ')', t);
  }
  for (const s of flattenSource(source)) for (const t of Array.isArray(s.spec.text) ? s.spec.text : [s.spec.text]) scan(s.key + ' (copy-source)', t);
  for (const p of registered) if (!used.has(p)) errors.push('placeholder {' + p + '} registered but used by no slot');
  return errors;
}

/**
 * 11. TODO 键：json.todo 里每个键都要在 todoRegistry 登记所属 P 编号，且只许 todoDecisions（P55/P66/P76/P90）；
 * 值必须仍以 TODO: 开头（补上文案后从 todo 挪走）。汇总成一条 warning，按 P 编号列出。
 */
export function checkTodo(copyModules, source, registeredP) {
  const errors = [];
  const warnings = [];
  const allowedP = new Set(source.todoDecisions || []);
  const registry = source.todoRegistry || {};
  const values = {};
  for (const table of Object.values(copyModules)) Object.assign(values, table);
  for (const p of allowedP) if (registeredP && !registeredP.has(p)) errors.push('todoDecisions ' + p + ': not registered in 03-待产品决定');
  const byP = new Map();
  for (const key of source.todo || []) {
    const p = registry[key];
    if (!p) errors.push(key + ': TODO key has no P number in copy-source.json todoRegistry');
    else if (!allowedP.has(p)) errors.push(key + ': TODO registered under ' + p + ', only ' + [...allowedP].join('/') + ' may hold 待文案 TODO keys');
    const v = values[key];
    if (typeof v !== 'string' || !v.startsWith('TODO:')) errors.push(key + ': listed in todo but value is not a TODO: placeholder (move it out of todo once written)');
    if (p) byP.set(p, [...(byP.get(p) || []), key]);
  }
  for (const key of Object.keys(registry)) if (!(source.todo || []).includes(key)) errors.push('todoRegistry ' + key + ': not in todo');
  if (byP.size) {
    warnings.push(
      '待文案 TODO ' + (source.todo || []).length + ' 个：' +
        [...byP.entries()].map(([p, keys]) => p + ' → ' + keys.join('、')).join('；'),
    );
  }
  // 现值占位、待文案确认的槽（decision 含 todoDecisions 里的 P 编号）：只汇总数量，便于 M7 交产品
  const pending = new Map();
  for (const s of flattenSource(source)) {
    if ((source.todo || []).includes(s.key)) continue;
    for (const m of String(s.spec.decision || '').matchAll(/\bP\d{2,3}b?\b/g)) {
      if (allowedP.has(m[0])) pending.set(m[0], (pending.get(m[0]) || 0) + 1);
    }
  }
  if (pending.size) warnings.push('现值占位、待文案确认的槽：' + [...pending.entries()].sort().map(([p, c]) => p + ' × ' + c).join('、'));
  return { errors, warnings };
}

/** 13. 运行时文案不得含占位词（F2）。copyModules = {screen: {key: string|string[]}}。 */
export const PLACEHOLDER_TEXT_RE = /TODO|TBD|FIXME|待补|占位/i;
export function checkNoPlaceholderText(copyModules) {
  const errors = [];
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const [key, value] of Object.entries(table)) {
      for (const text of Array.isArray(value) ? value : [value]) {
        if (typeof text !== 'string') continue;
        const m = PLACEHOLDER_TEXT_RE.exec(text);
        if (m) errors.push(key + ' (' + screen + '): runtime copy contains placeholder word 「' + m[0] + '」 — write the transitional wording instead of a TODO');
      }
    }
  }
  return errors;
}

/** 12. 留在 core 的镜像常量与 copy 逐字一致（HARDCODE_ALLOW 里 cards.js 两条的前提）。 */
export async function checkMirrors(copyModules) {
  const errors = [];
  const values = {};
  for (const table of Object.values(copyModules)) Object.assign(values, table);
  let cards;
  try {
    cards = await import(pathToFileURL(path.join(ROOT, 'src/core/cards.js')).href);
  } catch (e) {
    return ['src/core/cards.js failed to load: ' + e.message];
  }
  const promptPairs = {
    repeatInstruction: 'R-W28.repeatBlankNote',
    fallbackHint: 'X-PROMPT.fallbackHint',
    repeatBlankLabel: 'X-PROMPT.repeatBlankLabel',
    missingPinyin: 'X-PROMPT.missingPinyin',
    repeatBlankGlyph: 'X-PROMPT.repeatBlankGlyph',
  };
  for (const [field, key] of Object.entries(promptPairs)) {
    if (cards.PROMPT_COPY[field] !== values[key]) {
      errors.push('cards.PROMPT_COPY.' + field + ' ' + JSON.stringify(cards.PROMPT_COPY[field]) + ' ≠ ' + key + ' ' + JSON.stringify(values[key]));
    }
  }
  for (const lib of cards.LIBRARIES) {
    const key = 'R-L06.lib.' + lib.id + '.name';
    if (lib.label !== values[key]) errors.push('cards.LIBRARIES ' + lib.id + ' label ' + JSON.stringify(lib.label) + ' ≠ ' + key + ' ' + JSON.stringify(values[key]));
  }
  return errors;
}

/** 汇总 6–12。 */
export async function checkAudit(source, copyModules, { root = ROOT } = {}) {
  const literals = collectSourceLiterals(root);
  const hard = checkHardcoded(literals);
  const errors = [...hard.errors];
  errors.push(...checkBannedInSource(literals, source.bannedWords || []));
  errors.push(...checkNumerals(copyModules, source).errors);
  errors.push(...checkNumeralHelpers(root));
  errors.push(...checkExportWord(copyModules, source));
  errors.push(...checkPlaceholders(copyModules, source));
  const registered = registeredPNumbers(fs.readFileSync(PATHS.pending, 'utf8'));
  const todo = checkTodo(copyModules, source, registered);
  errors.push(...todo.errors);
  errors.push(...(await checkMirrors(copyModules)));
  errors.push(...checkNoPlaceholderText(copyModules));
  return { errors, warnings: todo.warnings, allowedLiterals: hard.allowed };
}

export async function loadCopyModules() {
  const index = await import(pathToFileURL(path.join(PATHS.copyDir, 'index.js')).href);
  return index.SCREENS;
}

export async function run({ scope } = {}) {
  const source = JSON.parse(fs.readFileSync(PATHS.source, 'utf8'));
  const markdown = fs.readFileSync(PATHS.requirements, 'utf8');
  const effectiveScope = scope || (source.gate && source.gate.defaultScope) || 'all';
  const errors = [];
  errors.push(...checkSource(source, markdown));
  const copyModules = await loadCopyModules();
  const copyResult = checkCopy(source, copyModules, { scope: effectiveScope });
  errors.push(...copyResult.errors);
  const policyResult = await checkPolicy(source);
  errors.push(...policyResult.errors);
  const audit = await checkAudit(source, copyModules);
  errors.push(...audit.errors);
  return {
    errors,
    warnings: [...copyResult.warnings, ...audit.warnings],
    checked: copyResult.checked,
    total: flattenSource(source).length,
    scope: effectiveScope,
    allowedLiterals: audit.allowedLiterals,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const scopeArg = args.find((a) => a.startsWith('--scope='));
  const quiet = args.includes('--quiet');
  const result = await run({ scope: scopeArg ? scopeArg.slice(8) : undefined });
  if (!quiet) for (const w of result.warnings) process.stdout.write('[verify-copy] warn: ' + w + '\n');
  for (const e of result.errors) process.stderr.write('[verify-copy] ' + e + '\n');
  process.stdout.write(
    '[verify-copy] scope=' + result.scope + ' checked ' + result.checked + '/' + result.total + ' slots; ' +
      result.errors.length + ' error(s), ' + result.warnings.length + ' warning(s); ' +
      result.allowedLiterals + ' allowlisted source literal(s)\n',
  );
  process.exit(result.errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    process.stderr.write('[verify-copy] crashed: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  });
}
