#!/usr/bin/env node
// 文案门禁（01-架构设计 §11-4；02 M0-6）。
//
// 检查项：
//   1. copy-source.json 结构：每个槽的占位符都在登记表里；非机械值（override）必须写明 decision（P 编号）或 note。
//   2. 抽取源一致：重新解析 04-需求清单 §4.1 表格「文案」列的「」片段，逐条核对 copy-source.json——
//      每个片段（按「 / 」拆开的每一段）要么落到某个槽（raw/part），要么在 dropped 里写明原因；
//      槽的值 = 片段按统一规则规整后的结果（占位符统一、<br> 换成数组），否则必须有 decision/note。
//   3. 原生 copy 与 json 逐字一致：已声明范围内每个槽在 Bundled/copy.json 里存在且值完全相同；
//      copy 里不能有 json 未登记的键；键必须落在 json 指定的屏里。
//   4. 旧词表禁用、引号只用「」；值以 TODO: 开头的必须在 json.todo 允许表里，只报警（但第 13 项一律报错，所以 json.todo 现为空）。
//   5. policy：每个导出项与嵌套键带 P 编号，且编号在 03-待产品决定 有登记；
//      03 的每个 P 编号都被 policy、copy-source.json 的 decision 或 json.nonRuntimeDecisions 覆盖（读 Bundled/policy.json + policy-meta.json）。
//   D84：门禁对象是原生的两份手改 JSON——ShiziCore Bundled/copy.json 与 ShiziKit/Generated/ShiziKitCopy.json（二者必须逐字相同），对照 copy-source.json；
//   网页版（src/ 的 copy 模块、policy.js、硬编码中文扫描、镜像常量）已随 D84 删除。Swift 源码无中文字面量由 test/ios-shizikit.test.mjs 守。
//   M6-4 文案审计（02 §8）：
//   7. 旧词表（json.bannedWords）扫 copy 值。
//   8. 数字口径（04 §3.1 T10）：copy 里汉字数字只许 json.numeralAllow 登记的键（R-M06 节号、落款等）；
//   9. 「导出」只作按钮名「导出备份」（D61 前叫「导出备份文件」，两者都认）出现（04 §4.2 D24），其余登记在 json.exportWordAllow。
//  10. 占位符：copy 与 json 值里的花括号全部是登记过的 {name}；登记表里没人用的占位符报错。
//  11. TODO：json.todo 的键须在 json.todoRegistry 登记 P 编号且属于 json.todoDecisions（P55/P66/P76/P90）；
//      汇总为 warning 按 P 编号列出。
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
  // D84：原生的手改真相源
  copyJson: path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled/copy.json'),
  kitCopyJson: path.join(ROOT, 'ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitCopy.json'),
  policyJson: path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled/policy.json'),
  policyMetaJson: path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled/policy-meta.json'),
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
      if (!byKey.has(key)) errors.push(key + ': in the native copy files (' + screen + ') but not registered in copy-source.json');
    }
  }
  let checked = 0;
  for (const s of slots) {
    const screen = fileOfKey.get(s.key);
    if (!screen) {
      errors.push(s.key + ': registered in copy-source.json (' + s.screen + ') but missing from the native copy files');
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
 * 5'.（D84）policy 的 P 编号登记，读 Bundled/policy.json + policy-meta.json（手改）：
 * meta.exports 的键 = policy.json 的顶层键；每个导出带 P 编号，嵌套键的 P 编号都在 03 登记；meta.registered = 03 的登记表；
 * 03 的每个 P 编号都被 meta 的导出 / 键、copy-source 的 decision 或 nonRuntimeDecisions 覆盖，且 meta.covered 正好是这个覆盖集。
 */
export function checkPolicyMeta(source, { policy, meta, pendingMarkdown }) {
  const errors = [];
  const registered = registeredPNumbers(pendingMarkdown);
  const P_RE = /\bP\d{2,3}b?\b/g;
  const policyKeys = Object.keys(policy).sort();
  const metaKeys = Object.keys(meta.exports || {}).sort();
  if (policyKeys.join(',') !== metaKeys.join(',')) {
    const miss = policyKeys.filter((k) => !metaKeys.includes(k));
    const extra = metaKeys.filter((k) => !policyKeys.includes(k));
    errors.push('policy-meta.json exports differ from policy.json keys' + (miss.length ? ' (missing: ' + miss.join(',') + ')' : '') + (extra.length ? ' (extra: ' + extra.join(',') + ')' : ''));
  }
  const referenced = new Set();
  const note = (where, ps) => {
    for (const p of ps) {
      referenced.add(p);
      if (!registered.has(p)) errors.push(where + ': ' + p + ' is not registered in 03-待产品决定');
    }
  };
  for (const [name, entry] of Object.entries(meta.exports || {})) {
    if (!Array.isArray(entry.p) || entry.p.length === 0) errors.push('policy.' + name + ': export has no P number in policy-meta.json');
    note('policy.' + name, entry.p || []);
    const value = policy[name];
    for (const [k, ps] of Object.entries(entry.keys || {})) {
      if (!Array.isArray(ps) || ps.length === 0) errors.push('policy.' + name + '.' + k + ': key has no P number in policy-meta.json');
      note('policy.' + name + '.' + k, ps || []);
      if (value && typeof value === 'object' && !Array.isArray(value) && !(k in value)) errors.push('policy-meta.json lists policy.' + name + '.' + k + ' but policy.json has no such key');
    }
  }
  const sameSet = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');
  if (!sameSet(meta.registered || [], registered)) errors.push('policy-meta.json registered differs from the P table in 03-待产品决定 (add / remove the P numbers in policy-meta.json)');
  const covered = new Set(referenced);
  for (const s of flattenSource(source)) {
    for (const m of String(s.spec.decision || '').matchAll(P_RE)) covered.add(m[0]);
  }
  for (const entry of Object.values({ ...(source.entries || {}), ...(source.extra || {}) })) {
    for (const d of entry.dropped || []) for (const m of String(d.why || '').matchAll(P_RE)) covered.add(m[0]);
  }
  for (const p of Object.keys(source.nonRuntimeDecisions || {})) covered.add(p);
  for (const p of registered) if (!covered.has(p)) errors.push(p + ': registered in 03 but not covered by policy-meta.json / copy-source decisions / nonRuntimeDecisions');
  if (!sameSet(meta.covered || [], covered)) errors.push('policy-meta.json covered differs from the computed coverage (P numbers of exports, keys, copy-source decisions and nonRuntimeDecisions)');
  return { errors, referenced, covered, registered };
}

/** 读 Bundled/policy.json + policy-meta.json + 03，跑 checkPolicyMeta。 */
export function checkPolicyFiles(source) {
  const policy = JSON.parse(fs.readFileSync(PATHS.policyJson, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(PATHS.policyMetaJson, 'utf8'));
  return checkPolicyMeta(source, { policy, meta, pendingMarkdown: fs.readFileSync(PATHS.pending, 'utf8') });
}

/**
 * （D84）原生文案文件：Bundled/copy.json 与 ShiziKitCopy.json 必须逐字相同；按 copy-source 的 screen 分组成 {screen: {key: value}}
 * （没登记的键放进 'unregistered'，让 checkCopy 报错）。
 */
export function loadNativeCopy(source) {
  const core = JSON.parse(fs.readFileSync(PATHS.copyJson, 'utf8'));
  const kit = JSON.parse(fs.readFileSync(PATHS.kitCopyJson, 'utf8'));
  const errors = [];
  for (const k of Object.keys(core)) if (!(k in kit)) errors.push(k + ': in Bundled/copy.json but not in ShiziKitCopy.json');
  for (const k of Object.keys(kit)) if (!(k in core)) errors.push(k + ': in ShiziKitCopy.json but not in Bundled/copy.json');
  for (const k of Object.keys(core)) if (k in kit && !sameValue(core[k], kit[k])) errors.push(k + ': Bundled/copy.json ' + JSON.stringify(core[k]) + ' ≠ ShiziKitCopy.json ' + JSON.stringify(kit[k]));
  const screenOf = new Map(flattenSource(source).map((s) => [s.key, s.screen]));
  const modules = {};
  for (const [key, value] of Object.entries(core)) {
    const screen = screenOf.get(key) || 'unregistered';
    (modules[screen] ||= {})[key] = value;
  }
  return { modules, errors };
}

// ---------------------------------------------------------------------------
// 6.–10. M6-4 文案审计：硬编码中文、源码旧词、数字口径、「导出」、占位符、TODO 登记、镜像常量
// ---------------------------------------------------------------------------

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

/** 9. 「导出」只作按钮名「导出备份」（D61 前叫「导出备份文件」，两者都认）出现（04 §4.2 D24：「导出」→「备份」，按钮除外）；其余登记在 exportWordAllow。 */
export function checkExportWord(copyModules, source) {
  const errors = [];
  const allow = source.exportWordAllow || {};
  const used = new Set();
  for (const [screen, table] of Object.entries(copyModules)) {
    for (const [key, value] of Object.entries(table)) {
      for (const t of Array.isArray(value) ? value : [value]) {
        if (typeof t !== 'string') continue;
        if (!t.replace(/导出备份(文件)?/g, '').includes('导出')) continue;
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

/** 汇总 7–13。 */
export function checkAudit(source, copyModules) {
  const errors = [];
  errors.push(...checkNumerals(copyModules, source).errors);
  errors.push(...checkExportWord(copyModules, source));
  errors.push(...checkPlaceholders(copyModules, source));
  const registered = registeredPNumbers(fs.readFileSync(PATHS.pending, 'utf8'));
  const todo = checkTodo(copyModules, source, registered);
  errors.push(...todo.errors);
  errors.push(...checkNoPlaceholderText(copyModules));
  return { errors, warnings: todo.warnings };
}

export async function run({ scope } = {}) {
  const source = JSON.parse(fs.readFileSync(PATHS.source, 'utf8'));
  const markdown = fs.readFileSync(PATHS.requirements, 'utf8');
  const effectiveScope = scope || (source.gate && source.gate.defaultScope) || 'all';
  const errors = [];
  errors.push(...checkSource(source, markdown));
  const native = loadNativeCopy(source);
  errors.push(...native.errors);
  const copyResult = checkCopy(source, native.modules, { scope: effectiveScope });
  errors.push(...copyResult.errors);
  errors.push(...checkPolicyFiles(source).errors);
  const audit = checkAudit(source, native.modules);
  errors.push(...audit.errors);
  return {
    errors,
    warnings: [...copyResult.warnings, ...audit.warnings],
    checked: copyResult.checked,
    total: flattenSource(source).length,
    scope: effectiveScope,
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
