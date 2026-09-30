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
//   4. 旧词表禁用、引号只用「」；值以 TODO: 开头的必须在 json.todo 允许表里（P55），只报警不失败。
//   5. policy.js：能被加载；每个导出项与嵌套键的注释含 P 编号，且编号在 03-待产品决定 有登记；
//      03 的每个 P 编号都被 policy.js、copy-source.json 的 decision 或 json.nonRuntimeDecisions 覆盖。
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
        if (/["“”]/.test(t)) errors.push(key + ' (' + screen + '): use 「」 instead of double quotes');
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
  for (const m of pendingMarkdown.matchAll(/^\| (P\d{2}b?) \|/gm)) set.add(m[1]);
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
  const P_RE = /\bP\d{2}b?\b/g;
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
    for (const m of String(s.spec.decision || '').matchAll(/\bP\d{2}b?\b/g)) covered.add(m[0]);
  }
  for (const entry of Object.values({ ...(source.entries || {}), ...(source.extra || {}) })) {
    for (const d of entry.dropped || []) for (const m of String(d.why || '').matchAll(/\bP\d{2}b?\b/g)) covered.add(m[0]);
  }
  for (const p of Object.keys(source.nonRuntimeDecisions || {})) covered.add(p);
  for (const p of registered) if (!covered.has(p)) errors.push(p + ': registered in 03 but not covered by policy.js / copy-source decisions / nonRuntimeDecisions');
  return { errors, referenced: result.referenced };
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
  return { errors, warnings: copyResult.warnings, checked: copyResult.checked, total: flattenSource(source).length, scope: effectiveScope };
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
      result.errors.length + ' error(s), ' + result.warnings.length + ' warning(s)\n',
  );
  process.exit(result.errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    process.stderr.write('[verify-copy] crashed: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(2);
  });
}
