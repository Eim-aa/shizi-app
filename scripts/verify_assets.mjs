#!/usr/bin/env node
// 资产门禁（M0-2）：从旧 scripts/legacy/verify_8105_app.js L90–158 抽出与 UI 无关的静态断言，
// 外加 v10 新增项（01-架构设计 §11 第 1 层）。只读文件，不起浏览器。
//
//   许可文件 · index.html CSP · 无遥测 · sw.js 常量与指纹 · core-strokes 自包含 · 字源 fixture
//   · iOS 自定义 scheme 的 CSP/nosniff 与桥约束 · audit/vector-data-381-* 回放包
//   · Swift 源码不含面向用户的中文 alert 文案 · window.__shiziTest 只在 isTestHost() 分支赋值
//
// 失败项退出码 1；「warn」项只打印并写进报告（由后续卡收尾，见每条注释），不改变退出码。
// 题记 52 条 fixture 断言不再保留（P23：旧语料随旧脚本进 scripts/legacy/）。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...parts) => join(ROOT, ...parts);
const read = (...parts) => readFileSync(rel(...parts), 'utf8');
const readJSON = (...parts) => JSON.parse(read(...parts));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

const failures = [];
const warnings = [];
const skipped = [];
const passed = [];

function check(name, condition, details) {
  if (condition) passed.push(name);
  else failures.push(details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
}
function warn(name, details) {
  warnings.push(details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
}

function listFiles(dir, predicate) {
  const out = [];
  const abs = rel(dir);
  if (!existsSync(abs)) return out;
  const walk = current => {
    for (const name of readdirSync(current)) {
      if (name.startsWith('.')) continue;
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (predicate(full)) out.push(full);
    }
  };
  walk(abs);
  return out.sort();
}

const html = read('index.html');
const swSource = read('sw.js');

// ---- 许可 ------------------------------------------------------------------
{
  const notices = read('THIRD_PARTY_NOTICES.md');
  const legal = read('LEGAL_RELEASE_CHECKLIST.md');
  check('THIRD_PARTY_NOTICES pins Hanzi Writer 3.7.3 and its SHA-256',
    notices.includes('Hanzi Writer 3.7.3') && notices.includes('17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642'));
  check('THIRD_PARTY_NOTICES registers preact and htm', /preact/i.test(notices) && /\bhtm\b/.test(notices));
  const licenseFiles = ['sources/LICENSE-MIT-HANZI-WRITER.txt', 'sources/LICENSE-ARPHIC-PUBLIC.txt',
    'licenses/preact-LICENSE.txt', 'licenses/htm-LICENSE.txt'];
  const missing = licenseFiles.filter(file => !existsSync(rel(file)) || statSync(rel(file)).size === 0);
  check('complete local license texts exist', missing.length === 0, missing);
  // C1（D50）：三组来源有问题的补充数据已移除，行保留并写明 REMOVED；仍需外部动作的行与事项必须写明（CONDITIONAL + 末段清单）。
  const rowOf = label => legal.split('\n').find(line => line.startsWith('| ' + label)) || '';
  check('LEGAL_RELEASE_CHECKLIST keeps unresolved release gates explicit',
    ['Project-authored code and content', 'Hanzi Writer Data 2.0.1 baseline', 'AnimCJK-derived supplement', 'Make Me a Hanzi metadata']
      .every(label => /\| (CLEARED|CONDITIONAL|BLOCKED) \|/.test(rowOf(label)))
    && ['MOE stroke-order supplement', 'Font-outline extraction from STKaitiSC', 'Stroke-order merged supplement']
      .every(label => rowOf(label).includes('| REMOVED |'))
    && ['BLOCKED', 'CONDITIONAL', 'External actions still open', 'Arphic Technology'].every(text => legal.includes(text)));
}

// ---- index.html CSP --------------------------------------------------------
function cspDirectives(policy) {
  return Object.fromEntries(policy.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...values] = part.split(/\s+/);
    return [name, values];
  }));
}
{
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  check('index.html declares a CSP meta tag', !!policy);
  const csp = cspDirectives(policy || '');
  check("CSP default-src 'self'", JSON.stringify(csp['default-src']) === JSON.stringify(["'self'"]), csp['default-src']);
  check("CSP script-src is exactly 'self' (no inline, no eval, no hosts)",
    JSON.stringify(csp['script-src']) === JSON.stringify(["'self'"]), csp['script-src']);
  check("CSP frame-src/object-src 'none'", csp['frame-src']?.[0] === "'none'" && csp['object-src']?.[0] === "'none'");
  check('index.html has no remote stroke-data/CDN fallback', !/cdn\.jsdelivr\.net|unpkg\.com|cdnjs/i.test(html));
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const inline = scripts.filter(([, attrs, body]) => !/\bsrc="/.test(attrs) || body.trim());
  check('index.html has no inline scripts', inline.length === 0, inline.map(m => m[0].slice(0, 80)));
  const remote = scripts.filter(([, attrs]) => /\bsrc="(?:https?:)?\/\//.test(attrs));
  check('index.html loads scripts from same origin only', remote.length === 0, remote.map(m => m[1]));
  check('index.html has no inline event handler attributes', !/<[^>]+\son[a-z]+\s*=/i.test(html));
  check('index.html loads src/app.js as a module', /<script type="module" src="src\/app\.js"><\/script>/.test(html));
}

// ---- 无遥测 ----------------------------------------------------------------
{
  const shipped = [rel('index.html'), rel('sw.js'), ...listFiles('src', file => /\.(m?js|html)$/.test(file))];
  const offenders = [];
  for (const file of shipped) {
    const text = readFileSync(file, 'utf8');
    if (/sendBeacon|\bgtag\(|google-analytics|googletagmanager|sentry|mixpanel|amplitude|segment\.io/i.test(text)
      || /method\s*:\s*["']POST["']/i.test(text)) offenders.push(relative(ROOT, file));
  }
  check('no telemetry, beacon or POST request in shipped sources', offenders.length === 0, offenders);
}

// ---- sw.js 常量与资产指纹（M5-1：v14 + 生成的 sw-manifest.js） ------------------
{
  const prefix12 = file => sha256(readFileSync(rel(file))).slice(0, 12);
  const manifestSource = read('sw-manifest.js');
  check('sw.js is the v14 worker and reads the generated sw-manifest.js',
    swSource.includes("importScripts('./sw-manifest.js')") && swSource.includes('const VERSION = `shizi-v14-${BUILD}`')
    && !/const (SHELL|BUILD) = \[?'/.test(swSource));
  check('sw.js keeps atomic installation and a bounded stroke cache',
    ['Promise.allSettled', 'INSTALL_BATCH_SIZE = 40', 'cacheFreshShell', 'cache.addAll(requests)',
      "cache: 'reload'", 'STROKE_CACHE_LIMIT = 800', 'trimStrokeCache', 'cacheResponseBestEffort', 'updateCacheFromNetwork']
      .every(text => swSource.includes(text)));
  check('sw.js never force-navigates clients and announces new versions by postMessage',
    !/\.navigate\(/.test(swSource) && swSource.includes("'shizi-sw-activated'") && swSource.includes('clients.claim()'));

  const htmlMeta = html.match(/<meta name="shizi-asset-build" content="([^"]+)">/)?.[1];
  const buildInfo = read('src', 'build-info.js').match(/export const BUILD = '([^']+)'/)?.[1];
  const swBuild = manifestSource.match(/^\s*build: "([^"]+)",$/m)?.[1];
  check('BUILD is <yyyymmdd>-<12 hex> and identical in index.html meta, src/build-info.js and sw-manifest.js',
    /^\d{8}-[0-9a-f]{12}$/.test(htmlMeta || '') && htmlMeta === buildInfo && buildInfo === swBuild, { htmlMeta, buildInfo, swBuild });

  const deferScripts = [...html.matchAll(/<script defer src="([^"?]+)\?v=([0-9a-f]+)"><\/script>/g)].map(m => ({ file: m[1], v: m[2] }));
  for (const file of ['core-strokes.js', 'deck-data.js', 'data/context-overrides.js']) {
    const tag = deferScripts.find(s => s.file === file);
    check(`index.html <script defer> ${file} ?v= matches file content`, !!tag && tag.v === prefix12(file), { tag, file: prefix12(file) });
    check(`sw-manifest.js lists ${file} with the same ?v=`, !!tag && manifestSource.includes(`"${file}?v=${tag.v}"`), { file });
  }
  const deckV = deferScripts.find(s => s.file === 'deck-data.js')?.v;
  check('data/context-overrides.js defines CONTEXT_OVERRIDES', read('data', 'context-overrides.js').includes('const CONTEXT_OVERRIDES'));
  const deckMeta = read('src', 'config', 'deck-meta.js').match(/DECK_FINGERPRINT = "([0-9a-f]{12})"/)?.[1];
  check('src/config/deck-meta.js fingerprint matches index.html deck ?v=', deckMeta === deckV, { deckMeta, deckV });
  const listed = [...manifestSource.matchAll(/^\s*"([^"]+)",$/gm)].map(m => m[1].split('?')[0]);
  const missingShell = listed.filter(p => !existsSync(rel(p)));
  check('every sw-manifest.js entry exists on disk', missingShell.length === 0, missingShell);
}

// ---- core-strokes 自包含 ----------------------------------------------------
{
  const core = read('core-strokes.js');
  check('core-strokes.js is self-contained for the worker', core.includes('SHIZI_CORE_STROKES') && !core.includes('SEED'));
  // M5-1：首练 5 字（policy.firstQueue，P09）笔顺内嵌，且与 data/<字>.json 逐字段相同。
  const { firstQueue } = await import('../src/config/policy.js');
  const scope = {};
  new Function('self', core)(scope);
  const embeddedOk = firstQueue.every(ch => JSON.stringify(scope.SHIZI_STROKE_DATA?.[ch]) === JSON.stringify(readJSON('data', `${ch}.json`)));
  check('core-strokes.js embeds first-practice stroke data identical to data/<字>.json (P09)', embeddedOk
    && firstQueue.every((ch, i) => scope.SHIZI_CORE_STROKES?.[i] === ch), firstQueue);
}

// ---- 字源 fixture（旧 L109–144 原样） ---------------------------------------
{
  const etymology = readJSON('data', 'etymology.json');
  const coverage = readJSON('generated', 'etymology-coverage.json');
  const builder = read('scripts', 'build_etymology.py');
  const accuracy = readJSON('scripts', 'fixtures', 'etymology_accuracy.json');
  const contextAudit = readJSON('scripts', 'fixtures', 'etymology_context_audit.json');
  const copyReview = readJSON('scripts', 'fixtures', 'etymology_copy_review.json');
  const deckSource = read('deck-data.js');
  const deckCharacters = new Set(JSON.parse(deckSource.match(/const SEED = (\[.*\]);/s)[1]).map(row => row.target));
  const openccOneToMany = new Set(read('sources', 'opencc-st-characters.txt').split(/\r?\n/)
    .filter(line => line.includes('\t') && line.split('\t', 2)[1].trim().split(/\s+/).length > 1)
    .map(line => line.split('\t', 1)[0]));
  const hasCjkExtension = text => Array.from(String(text)).some(char => {
    const cp = char.codePointAt(0);
    return (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x323af);
  });
  const isOpaqueAncientGloss = gloss => {
    const match = String(gloss).split('。', 1)[0].match(/^(.{1,2})(?:也|同)$/u);
    return !!match && Array.from(match[1]).some(char => !deckCharacters.has(char));
  };

  check('etymology records are unique, compact and attributed',
    Array.isArray(etymology) && etymology.length === coverage.totals.entries && new Set(etymology.map(row => row.char)).size === etymology.length
    && etymology.every(row => Object.keys(row).sort().join() === 'char,gloss,source' && Array.from(row.char).length === 1
      && row.gloss.length >= 1 && row.gloss.length <= 20 && ['《说文解字》', 'Make Me a Hanzi'].includes(row.source)),
    { count: etymology.length });
  check('every top-frequency and radical coverage gap is explicit',
    coverage.schemaVersion === 2 && coverage.totals.topCharacters === 1000 && coverage.totals.topCovered >= 900
    && coverage.totals.radicalCovered + coverage.missingRadicalCharacters.length === coverage.totals.radicalCharacters
    && coverage.missingRadicalCharacters.every(char => coverage.omissions[char])
    && coverage.missingTopCharacters.every(char => !etymology.some(row => row.char === char)), coverage.totals);
  check('etymology builder uses exact headword indexing and one-to-one-only OpenCC resolution',
    builder.includes('build_shuowen_indexes') && builder.includes('len(traditional) == 1')
    && !builder.includes('next((candidate for candidate in candidates'));
  check('every published source match discloses a safe resolution path', Object.entries(coverage.detail).every(([char, row]) => {
    const baseKind = row.matchKind.replace('+reviewed-copy', '');
    return ['exact', 'reviewed-alias', 'reviewed-context', 'opencc-one-to-one', 'make-me-a-hanzi'].includes(baseKind)
      && (baseKind !== 'exact' || row.sourceHeadword === char);
  }));
  check('every OpenCC one-to-many character requires context review',
    Object.entries(coverage.detail).every(([char, row]) => !openccOneToMany.has(char) || row.matchKind.startsWith('reviewed-context')));
  check('the complete context audit remains enforced',
    contextAudit.entries.length === contextAudit.expectedCount && coverage.contextAudit.count === contextAudit.expectedCount);
  check('every readability exception has an explicit human decision',
    copyReview.entries.length === copyReview.expectedCount && coverage.copyReview.count === copyReview.expectedCount);
  check('published etymology copy rejects CJK extensions and opaque ancient one-word definitions',
    etymology.every(row => !hasCjkExtension(row.gloss) && !isOpaqueAncientGloss(row.gloss)));
  const byChar = new Map(etymology.map(row => [row.char, row]));
  check('reviewed exact-headword and ambiguity fixtures match generated output', accuracy.entries.every(expected => {
    const row = byChar.get(expected.char), detail = coverage.detail[expected.char], omission = coverage.omissions[expected.char];
    if (expected.status === 'absent') return !row && !detail && omission?.reason === expected.strategy;
    return row?.source === expected.source && row?.gloss === expected.gloss && detail?.sourceHeadword === expected.sourceHeadword
      && detail?.matchKind === expected.matchKind && detail?.gloss === expected.gloss;
  }));
  check('every approved plain-language copy or intentional omission matches its fixed candidate', copyReview.entries.every(expected => {
    const row = byChar.get(expected.char), detail = coverage.detail[expected.char], omission = coverage.omissions[expected.char];
    if (expected.status === 'absent') return !row && !detail && omission?.reason === 'readability-review-omission' && omission?.candidate === expected.candidate;
    return row?.gloss === expected.copy && detail?.gloss === expected.copy && detail?.matchKind.endsWith('+reviewed-copy');
  }));
}

// ---- iOS：自定义 scheme 的 CSP / nosniff 与原生桥约束 ------------------------
const swiftDir = join('ios', 'ShiziApp', 'ShiziApp');
{
  const scheme = read(swiftDir, 'LocalWebSchemeHandler.swift');
  const webView = read(swiftDir, 'WebViewController.swift');
  check('iOS custom scheme emits CSP and nosniff headers',
    scheme.includes('"Content-Security-Policy"') && scheme.includes('"X-Content-Type-Options": "nosniff"'));
  const iosPolicy = scheme.match(/"Content-Security-Policy":\s*"([^"]+)"/)?.[1] || '';
  const iosCsp = cspDirectives(iosPolicy);
  check("iOS CSP default-src 'self' and frame-src 'none'",
    iosCsp['default-src']?.[0] === "'self'" && iosCsp['frame-src']?.[0] === "'none'", iosPolicy);
  // M5-3 起硬检查：原生头与 Web 壳同为 script-src 'self'，且两处 CSP 逐字相同（01 §8.2「CSP 两处同步」）。
  check("iOS scheme CSP script-src is exactly 'self'",
    JSON.stringify(iosCsp['script-src']) === JSON.stringify(["'self'"]), iosCsp['script-src']);
  const webPolicy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] || '';
  check('iOS scheme CSP is identical to the index.html CSP meta', iosPolicy === webPolicy, { ios: iosPolicy, web: webPolicy });
  check('native bridge, local origin, external schemes and subframe navigation are constrained',
    webView.includes('message.frameInfo.isMainFrame') && webView.includes('["http", "https", "mailto"].contains(scheme)')
    && webView.includes('url.host == ShiziWebResource.host')
    && !/targetFrame\?\.isMainFrame != false[\s\S]{0,180}else\s*\{\s*decisionHandler\(\.allow\)/.test(webView));
  check('bridge handler is cycle-free and removed on teardown',
    webView.includes('WeakScriptMessageHandler(delegate: self)') && webView.includes('removeScriptMessageHandler(forName: "shiziNative")'));
  // M5-3：冒烟与测试宿主注入（__shiziNativeDev、?test=1、nativeSmoke*）只在 #if DEBUG 里（Release 不编译；产物另由 verify-archive.sh 查）。
  // P1-S2：原生书写面 spike（__shiziNativeInk、-shizi-native-ink、NativeInkSpike / NativeInkView / InkModel）同样只在 DEBUG。
  const debugOnly = /__shiziNativeDev|nativeSmoke|shizi-native-smoke|"test", value: "1"|__shiziNativeInk|shizi-native-ink|NativeInkSpike|NativeInkView|InkModel/;
  const leaks = [];
  for (const file of listFiles(swiftDir, f => f.endsWith('.swift'))) {
    const stack = [];
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const directive = line.trim();
      if (/^#if\b/.test(directive)) stack.push(/^#if\s+DEBUG\b/.test(directive));
      else if (/^#else\b/.test(directive) && stack.length) stack[stack.length - 1] = false; // #if DEBUG 的 #else 分支 = Release
      else if (/^#endif\b/.test(directive)) stack.pop();
      else if (debugOnly.test(line.replace(/\/\/.*$/, '')) && !stack.some(Boolean)) leaks.push(`${relative(ROOT, file)}:${index + 1}`);
    });
  }
  check('native smoke / test-host injection is compiled only under #if DEBUG', leaks.length === 0, leaks);

  // Swift 源码不得含面向用户的中文 alert 文案（文案应由 Web 侧 copy/ 经桥传入）。M5-3 起硬检查。
  const cjk = /[㐀-鿿豈-﫿]/;
  const alertLines = [];
  for (const file of listFiles(swiftDir, f => f.endsWith('.swift'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/UIAlertController|UIAlertAction|presentError\(|\.addTextField/.test(code)
        && [...code.matchAll(/"((?:[^"\\]|\\.)*)"/g)].some(m => cjk.test(m[1]))) {
        alertLines.push(`${relative(ROOT, file)}:${index + 1}`);
      }
    });
  }
  check('Swift sources contain no user-facing Chinese alert copy', alertLines.length === 0, alertLines);
  check('native shell presents no UIAlertController', !listFiles(swiftDir, f => f.endsWith('.swift'))
    .some(file => /UIAlertController\(/.test(readFileSync(file, 'utf8').replace(/\/\/.*$/gm, ''))));
}

// ---- audit/vector-data-381-* 回放包 ------------------------------------------
{
  const gz = rel('audit', 'vector-data-381-accepted-source-replay.json.gz');
  const md = rel('audit', 'vector-data-381-source-replay.md');
  check('audit/vector-data-381 replay bundle and its README exist', existsSync(gz) && existsSync(md));
  if (existsSync(gz)) {
    let payload = null;
    try { payload = JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8')); } catch (error) { payload = null; }
    check('audit/vector-data-381 replay bundle decodes to 381 accepted-source records',
      payload?.artifact === 'shizi-vector-data-381-accepted-source-replay' && Array.isArray(payload?.records) && payload.records.length === 381);
  }
}

// ---- window.__shiziTest 只在 isTestHost() 分支赋值（M0-5 产出） ----------------
function stripCommentsAndStrings(source) {
  // 保留长度与换行，便于按下标定位；字符串/模板/注释内容替换为空格。
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    match => match.replace(/[^\n]/g, ' '));
}
function blockEnd(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return code.length;
}
function enclosingBlockStart(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (code[i] === '}') depth += 1;
    else if (code[i] === '{') { if (depth === 0) return i; depth -= 1; }
  }
  return -1;
}
{
  const files = listFiles('src', file => /\.m?js$/.test(file));
  const assignRe = /(?:window|globalThis|self|win)\s*\.\s*__shiziTest\s*=(?!=)|(?:window|globalThis|self|win)\s*\[\s*['"]__shiziTest['"]\s*\]\s*=(?!=)|Object\.defineProperty\(\s*(?:window|globalThis|self)\s*,\s*['"]__shiziTest['"]/g;
  const sites = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('__shiziTest')) continue;
    // 用原文找赋值位置（defineProperty 的键在字符串里），用去注释/字符串后的代码判断作用域。
    const code = stripCommentsAndStrings(source);
    for (const match of source.matchAll(assignRe)) {
      if (code.slice(match.index, match.index + 6).trim() === '') continue; // 位于注释/字符串内
      const guardedBlocks = [...code.matchAll(/if\s*\(\s*isTestHost\s*\([^)]*\)\s*\)\s*\{/g)]
        .map(m => [m.index, blockEnd(code, m.index + m[0].length - 1)]);
      const inGuardBlock = guardedBlocks.some(([start, end]) => match.index > start && match.index < end);
      const scopeStart = enclosingBlockStart(code, match.index);
      const earlyReturn = /if\s*\(\s*!\s*isTestHost\s*\([^)]*\)\s*\)\s*(?:\{\s*)?return\b/.test(code.slice(scopeStart + 1, match.index));
      const line = source.slice(0, match.index).split('\n').length;
      sites.push({ file: `${relative(ROOT, file)}:${line}`, guarded: inGuardBlock || earlyReturn });
    }
    const definition = code.match(/function\s+isTestHost\s*\(|(?:const|let)\s+isTestHost\s*=/);
    if (definition) {
      check(`isTestHost() in ${relative(ROOT, file)} restricts to local hosts`,
        source.includes("'localhost'") || source.includes('"localhost"'));
    }
  }
  if (!sites.length) skipped.push('window.__shiziTest assignment guard: no assignment under src/ yet (M0-5 not landed)');
  else check('window.__shiziTest is only assigned inside an isTestHost() branch', sites.every(site => site.guarded),
    sites.filter(site => !site.guarded));
}

const report = { status: failures.length ? 'failed' : 'passed', passed: passed.length, failures, warnings, skipped };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exit(1);
