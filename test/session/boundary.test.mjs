// B2.1 会话层边界门禁（docs/engineering/v10/B2-原生写字架构.md §3.2 / §11 B2.1；D69）：
// src/session 是写字 / 判断 / 结果的提交函数与纯模型，网页写字页与写字会话 API（window.shiziNativeWrite）共用；B3 末它与 src/store、src/core
// 一起搬进 JavaScriptCore，所以不得依赖任何 UI / Preact / DOM 模块。
//   1. 从 src/session 下每个文件出发的**传递**导入图只落在 src/session、src/core、src/store、src/config、src/data（外加只读全局、导入时不碰 DOM 的
//      src/platform/env.js：store 用它取时钟），不得出现 src/ui/、vendor/、其余 src/platform/、裸模块名（preact 等）；
//   2. src/session 源码（去掉注释）不出现 DOM / 浏览器全局；
//   3. 没有 window / document 的环境里能整体加载；
//   4. 网页页面的原导入路径转出的是**同一个**函数（网页路径与 API 路径调用同一批提交函数，不是两份拷贝）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../core/helpers.mjs';

const SESSION = path.join(ROOT, 'src/session');
const ALLOWED_DIRS = ['src/session/', 'src/core/', 'src/store/', 'src/config/', 'src/data/'];
const ALLOWED_FILES = Object.freeze({ 'src/platform/env.js': 'store/store.js 取时钟；只在函数里读全局，导入时不碰 DOM' });

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** 静态 import / export … from 的说明符（含动态 import('…') 字面量）。 */
function specifiers(src) {
  const code = stripComments(src);
  const out = [];
  for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const SESSION_FILES = walk(SESSION);

test('session boundary: there is a session layer (write-ops, result-ops, write-api)', () => {
  const names = SESSION_FILES.map(rel);
  for (const f of ['src/session/write-ops.js', 'src/session/result-ops.js', 'src/session/write-api.js']) assert.ok(names.includes(f), f);
});

test('session boundary: the transitive import graph of src/session stays in core / store / config / data (no UI, Preact, DOM)', () => {
  const seen = new Map(); // 文件 → 谁第一次引入它
  const queue = SESSION_FILES.map(f => [f, null]);
  const bad = [];
  while (queue.length) {
    const [file, from] = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, from);
    const r = rel(file);
    const ok = ALLOWED_DIRS.some(d => r.startsWith(d)) || Object.prototype.hasOwnProperty.call(ALLOWED_FILES, r);
    if (!ok) {
      bad.push(`${r} (imported by ${from ? rel(from) : '?'})`);
      continue;
    }
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        bad.push(`bare specifier "${spec}" in ${r}`);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec);
      assert.ok(fs.existsSync(target), `${r} imports missing ${spec}`);
      queue.push([target, file]);
    }
  }
  assert.deepEqual(bad, []);
  // 图里确实走到了 store 与 core（不是空转）
  const reached = [...seen.keys()].map(rel);
  assert.ok(reached.includes('src/store/store.js'));
  assert.ok(reached.includes('src/core/sessions.js'));
});

test('session boundary: no DOM / browser globals in src/session sources', () => {
  const DOM = /\b(?:window|document|navigator|localStorage|sessionStorage|getComputedStyle|requestAnimationFrame|matchMedia|HTMLElement|customElements)\b/;
  const hits = [];
  for (const f of SESSION_FILES) {
    stripComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      if (DOM.test(line)) hits.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('session boundary: loads without window / document', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  for (const f of SESSION_FILES) await import(pathToFileURL(f).href);
});

test('session boundary: the web page modules re-export the very same session functions (one implementation, two callers)', async () => {
  const ops = await import(pathToFileURL(path.join(SESSION, 'write-ops.js')).href);
  const result = await import(pathToFileURL(path.join(SESSION, 'result-ops.js')).href);
  const api = await import(pathToFileURL(path.join(SESSION, 'write-api.js')).href);
  const ui = async f => import(pathToFileURL(path.join(ROOT, 'src/ui/screens', f)).href);
  const pairs = [
    [await ui('write/compare.js'), ops, ['commitJudgment', 'commitComparePhase', 'judgeInDraft', 'recalledInk', 'rememberInk']],
    [await ui('write/persist.js'), ops, ['commitStrokes', 'commitRecover', 'storedStrokes', 'syncPatch']],
    [await ui('write/answer.js'), ops, ['commitAnswerSeen', 'commitAnswerPhase', 'commitAnswerNext', 'commitAnswerNoteSeen', 'answerInkKey', 'allRecords']],
    [await ui('write/hint-layer.js'), ops, ['applyHintToDraft', 'commitHint', 'hintStep', 'commitHintStep', 'planHint', 'hintSourceOf', 'hintButtonModel', 'reduceHintView', 'matchHintStroke']],
    [await ui('write/sr-live.js'), ops, ['strokeRangeText', 'hintAnnouncement']],
    [await ui('write/skip.js'), ops, ['commitSkip', 'commitUndoSkip', 'canUndoSkip']],
    [await ui('write/end.js'), ops, ['commitEndGroup', 'endConfirmCounts', 'canEndGroup']],
    [await ui('write/result-row.js'), ops, ['commitCorrection', 'resultRowModel']],
    [await ui('write/first-tip.js'), ops, ['commitFirstTipSeen', 'firstTipDue']],
    [await ui('write/prompt.js'), ops, ['promptCells', 'blankLabel']],
    [await ui('write/redo.js'), ops, ['redoCharsOf', 'redoQueueOf']], // B2.9a：原生重写错字页的 redoOpen / redoNext 用同一份字表
    [await ui('result/index.js'), result, ['resultModel', 'commitFinish', 'commitLeave', 'commitResultCorrection', 'commitResultSkipUndo']],
    [await ui('result/work.js'), result, ['commitAdded', 'commitSealed']],
    [await ui('result/first.js'), result, ['firstExtras', 'daysLaterOf']],
    [await ui('write/native-session.js'), api, ['writeSnapshot', 'strokesToWire', 'strokesFromWire', 'copyBundle', 'NATIVE_WRITE_COPY_KEYS', 'NATIVE_WRITE_OPS']],
  ];
  for (const [page, layer, names] of pairs) {
    for (const n of names) {
      assert.equal(typeof layer[n] === 'undefined', false, `session exports ${n}`);
      assert.equal(page[n], layer[n], `${n}: page module must re-export the session function, not a copy`);
    }
  }
});
