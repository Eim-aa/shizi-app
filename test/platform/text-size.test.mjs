// 阶段 1 P1-E6（D29，覆盖 X08 与 03 P59；03 P130–P133）：字号跟随系统 Dynamic Type。
//   原生读 traitCollection.preferredContentSizeCategory，在 pageReady 与 UIContentSizeCategory.didChangeNotification 时调用
//   桥全局 shiziContentSize({category, scale})（bridge.js 顶层同步定义、就绪前只留最后一次）；页面侧 src/platform/text-size.js
//   按 policy.contentSizeScale（P130）把档位换成连续倍率写进 :root 的 --k，AX 档加 data-ax，倍率 ≥ policy.compactTextScale（P131）
//   加 data-text-large（紧凑排布）。网页（无原生桥）不调用 → --k 保持 tokens.css 的 1（P133）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createBridge, NATIVE_GLOBALS, bridge as moduleBridge } from '../../src/platform/bridge.js';
import {
  CONTENT_SIZE_CATEGORIES, scaleFor, axLevelOf, textSizeOf, applyTextSize, receiveContentSize, getTextSize, onTextSize, resetTextSize,
  readInjectedContentSize, applyInjectedContentSize,
} from '../../src/platform/text-size.js';
import * as policy from '../../src/config/policy.js';

const SWIFT = readFileSync(new URL('../../ios/ShiziApp/ShiziApp/WebViewController.swift', import.meta.url), 'utf8');

class FakeRoot {
  constructor() {
    this.attrs = new Map();
    this.props = new Map();
    const self = this;
    this.style = {
      setProperty(k, v) { self.props.set(k, String(v)); },
      removeProperty(k) { self.props.delete(k); },
      getPropertyValue(k) { return self.props.has(k) ? self.props.get(k) : ''; },
    };
  }
  hasAttribute(k) { return this.attrs.has(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
}
const fakeDoc = () => ({ documentElement: new FakeRoot() });

test('P130 mapping table: xS…XXXL ≈ 0.82–1.35 around L = 1, AX1–AX5 keep growing, strictly increasing', () => {
  const table = policy.contentSizeScale;
  assert.deepEqual(CONTENT_SIZE_CATEGORIES, ['xS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'AX1', 'AX2', 'AX3', 'AX4', 'AX5']);
  assert.deepEqual(Object.keys(table), CONTENT_SIZE_CATEGORIES, 'policy table covers every category in order');
  assert.equal(table.L, 1, 'system default (Large) = 1');
  assert.equal(table.xS, 0.82);
  assert.equal(table.XXXL, 1.35);
  const values = CONTENT_SIZE_CATEGORIES.map(c => table[c]);
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] > values[i - 1], `${CONTENT_SIZE_CATEGORIES[i]} > ${CONTENT_SIZE_CATEGORIES[i - 1]}`);
  assert.ok(table.AX1 > table.XXXL && table.AX5 >= 2, 'AX sizes continue past XXXL');
  for (const c of CONTENT_SIZE_CATEGORIES) assert.equal(scaleFor(c), table[c], `${c} → policy value`);
  assert.ok(Object.isFrozen(table));
});

test('scaleFor: unknown category falls back to the native continuous scale, clamped to the table range; junk → 1', () => {
  const table = policy.contentSizeScale;
  assert.equal(scaleFor('UICTContentSizeCategoryFuture', 1.5), 1.5, 'future category: use what iOS measured');
  assert.equal(scaleFor('unspecified', 9), table.AX5, 'clamped to AX5');
  assert.equal(scaleFor('unspecified', 0.1), table.xS, 'clamped to xS');
  assert.equal(scaleFor(null, Number.NaN), 1);
  assert.equal(scaleFor(undefined, undefined), 1);
  assert.equal(scaleFor('XXXL', 3), table.XXXL, 'a known category wins over the native number (policy is the single source)');
});

test('axLevelOf / textSizeOf: AX marker 1–5 only for AX categories; compact flag from P131', () => {
  assert.equal(axLevelOf('AX1'), 1);
  assert.equal(axLevelOf('AX5'), 5);
  assert.equal(axLevelOf('XXXL'), 0);
  assert.equal(axLevelOf('ax3'), 0, 'names are exact');
  assert.deepEqual(textSizeOf({ category: 'L', scale: 1 }), { category: 'L', k: 1, ax: 0, large: false });
  const xxxl = textSizeOf({ category: 'XXXL', scale: 1.35 });
  assert.equal(xxxl.large, xxxl.k >= policy.compactTextScale);
  assert.equal(textSizeOf({ category: 'XXXL' }).large, true, 'XXXL uses the compact arrangement (prototype: compact ⇔ k 1.3)');
  assert.equal(textSizeOf({ category: 'XL' }).large, false, 'XL keeps the standard arrangement');
  assert.deepEqual(textSizeOf({ category: 'AX3' }), { category: 'AX3', k: policy.contentSizeScale.AX3, ax: 3, large: true });
  assert.deepEqual(textSizeOf(null), { category: null, k: 1, ax: 0, large: false }, 'bad payload → default size');
});

test('applyTextSize: --k on :root as a continuous value, data-ax / data-text-large / data-text-size; default removes them', () => {
  const doc = fakeDoc();
  const root = doc.documentElement;
  applyTextSize(textSizeOf({ category: 'AX3' }), { doc });
  assert.equal(root.style.getPropertyValue('--k'), String(policy.contentSizeScale.AX3));
  assert.equal(root.getAttribute('data-ax'), '3');
  assert.equal(root.hasAttribute('data-text-large'), true);
  assert.equal(root.getAttribute('data-text-size'), 'AX3');
  applyTextSize(textSizeOf({ category: 'XL' }), { doc });
  assert.equal(root.style.getPropertyValue('--k'), '1.12');
  assert.equal(root.hasAttribute('data-ax'), false);
  assert.equal(root.hasAttribute('data-text-large'), false);
  applyTextSize(textSizeOf({ category: 'L' }), { doc });
  assert.equal(root.style.getPropertyValue('--k'), '', 'k = 1 → inline --k removed, tokens.css default applies');
  assert.equal(root.getAttribute('data-text-size'), 'L');
  assert.equal(applyTextSize(textSizeOf({ category: 'L' }), { doc: null }), null, 'no document → no-op');
});

test('shiziContentSize is a native global: defined at bridge creation, queued before ready (last one wins), replayed once', () => {
  assert.ok(NATIVE_GLOBALS.includes('shiziContentSize'));
  const win = {};
  const b = createBridge(win);
  assert.equal(typeof win.shiziContentSize, 'function');
  assert.equal(win.shiziContentSize({ category: 'XXXL', scale: 1.35 }), true, 'accepted (queued) before ready');
  assert.equal(win.shiziContentSize({ category: 'AX5', scale: 3.12 }), true);
  const got = [];
  b.registerNativeHandler('shiziContentSize', s => got.push(s));
  assert.deepEqual(b.pending().map(p => p.name), ['shiziContentSize'], 'only the last size stays queued');
  b.markReady(null);
  assert.deepEqual(got, [{ category: 'AX5', scale: 3.12 }], 'replayed once with the latest value');
  win.shiziContentSize({ category: 'L', scale: 1 });
  assert.equal(got.length, 2, 'delivered directly once ready');
});

test('text-size.js registers its implementation on the page bridge at import', () => {
  assert.equal(moduleBridge.hasHandler('shiziContentSize'), true);
});

test('receiveContentSize: keeps the current size, notifies on change only, returns true', () => {
  resetTextSize();
  assert.deepEqual(getTextSize(), { category: null, k: 1, ax: 0, large: false }, 'web default: k = 1 (P133)');
  const seen = [];
  const off = onTextSize(s => seen.push(s));
  assert.equal(receiveContentSize({ category: 'AX2', scale: 1.94 }), true);
  assert.equal(getTextSize().ax, 2);
  receiveContentSize({ category: 'AX2', scale: 1.94 });
  assert.equal(seen.length, 1, 'same size not announced again');
  receiveContentSize({ category: 'M', scale: 0.94 });
  assert.equal(seen.length, 2);
  assert.equal(getTextSize().k, policy.contentSizeScale.M);
  off();
  receiveContentSize({ category: 'XXL' });
  assert.equal(seen.length, 2, 'unsubscribed');
  const copy = getTextSize();
  copy.k = 99;
  assert.notEqual(getTextSize().k, 99, 'getTextSize returns a copy');
  resetTextSize();
});

test('Swift reads preferredContentSizeCategory and sends shiziContentSize on pageReady and on every system change', () => {
  assert.match(SWIFT, /preferredContentSizeCategory/);
  assert.match(SWIFT, /UIContentSizeCategory\.didChangeNotification/);
  assert.match(SWIFT, /shiziContentSize\(\{category:/, 'evaluates the global with {category, scale}');
  const handlePageReady = SWIFT.match(/private func handlePageReady\(\) \{[\s\S]*?\n    \}/)[0];
  assert.match(handlePageReady, /sendContentSize\(/, 'size goes out when the page reports ready');
  for (const [name, swift] of [['xS', 'extraSmall'], ['L', 'large'], ['XXXL', 'extraExtraExtraLarge'], ['AX1', 'accessibilityMedium'],
    ['AX5', 'accessibilityExtraExtraExtraLarge']]) {
    assert.match(SWIFT, new RegExp(`case \\.${swift}: return "${name}"`), `${swift} → ${name}`);
  }
});

test('no double scaling: page CSS never uses the -apple-system-* text styles that WebKit scales by Dynamic Type itself', () => {
  const root = new URL('../../src/', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter(f => /\.(css|js)$/.test(f) && !String(f).startsWith('data'));
  assert.ok(files.length > 50, 'scanned the page sources');
  for (const file of files) {
    const text = readFileSync(new URL(String(file), root), 'utf8');
    assert.ok(!/-apple-system-(body|headline|subheadline|caption|footnote|title|short)/.test(text), `${file} has no -apple-system-<style> font`);
  }
});

// ---------------------------------------------------------------- P1-E6b：冷启动注入（WKUserScript atDocumentStart）

const APP_JS = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
const NATIVE_SMOKE = readFileSync(new URL('../../ios/ShiziApp/ShiziApp/NativeSmoke.swift', import.meta.url), 'utf8');

test('injected size: readInjectedContentSize accepts only an object on window; none (web / PWA) → null and nothing is applied', () => {
  assert.equal(readInjectedContentSize({}), null, 'web: no injected variable');
  assert.equal(readInjectedContentSize({ __shiziInitialContentSize: 'AX3' }), null, 'not an object');
  assert.equal(readInjectedContentSize({ __shiziInitialContentSize: null }), null);
  assert.deepEqual(readInjectedContentSize({ __shiziInitialContentSize: { category: 'AX3', scale: 2 } }), { category: 'AX3', scale: 2 });
  assert.equal(readInjectedContentSize(null), null);
  const doc = fakeDoc();
  assert.equal(applyInjectedContentSize({ win: {}, doc }), false, 'web: nothing to apply');
  assert.equal(doc.documentElement.props.size, 0, 'web: --k untouched (P133)');
  assert.equal(doc.documentElement.attrs.size, 0, 'web: no data-* written');
});

test('injected size: applied immediately on start; the same size arriving later through the bridge neither rewrites <html> nor notifies', () => {
  resetTextSize();
  const doc = fakeDoc();
  const root = doc.documentElement;
  let sets = 0;
  const realSet = root.style.setProperty;
  root.style.setProperty = (k, v) => { sets += 1; realSet(k, v); };
  const seen = [];
  const off = onTextSize(s => seen.push(s));
  assert.equal(applyInjectedContentSize({ win: { __shiziInitialContentSize: { category: 'AX3', scale: 2.0 } }, doc }), true);
  assert.equal(root.style.getPropertyValue('--k'), String(policy.contentSizeScale.AX3), 'k applied at start');
  assert.equal(root.getAttribute('data-ax'), '3');
  assert.equal(root.getAttribute('data-text-size'), 'AX3');
  assert.equal(root.hasAttribute('data-text-large'), true);
  assert.equal(getTextSize().category, 'AX3');
  assert.equal(sets, 1);
  assert.equal(seen.length, 1);
  // pageReady 之后原生再发同一档位（scale 值略有出入也算同档，表里有该档位以表为准）
  assert.equal(receiveContentSize({ category: 'AX3', scale: 1.9981 }), true, 'the bridge call is still accepted');
  assert.equal(sets, 1, 'same size through the bridge: no second write');
  assert.equal(seen.length, 1, 'same size through the bridge: subscribers not notified (no re-layout)');
  receiveContentSize({ category: 'XXXL', scale: 1.35 });
  assert.equal(seen.length, 2, 'a different size afterwards still goes through (system size changed while running)');
  off();
  resetTextSize();
});

test('injected size: unknown future category uses the injected native scale; the same payload from the bridge is not repeated', () => {
  resetTextSize();
  const seen = [];
  const off = onTextSize(s => seen.push(s));
  assert.equal(applyInjectedContentSize({ win: { __shiziInitialContentSize: { category: 'UICTFuture', scale: 1.5 } }, doc: fakeDoc() }), true);
  assert.equal(getTextSize().k, 1.5);
  receiveContentSize({ category: 'UICTFuture', scale: 1.5 });
  assert.equal(seen.length, 1);
  off();
  resetTextSize();
});

function runInFakeBrowser(injected) {
  const code = `
    const writes = [];
    const attrs = new Map();
    const props = new Map();
    const root = {
      style: { setProperty: (k, v) => { writes.push(k); props.set(k, v); }, removeProperty: k => props.delete(k), getPropertyValue: k => props.get(k) || '' },
      hasAttribute: k => attrs.has(k), getAttribute: k => attrs.has(k) ? attrs.get(k) : null,
      setAttribute: (k, v) => { writes.push(k); attrs.set(k, String(v)); }, removeAttribute: k => attrs.delete(k),
    };
    globalThis.document = { documentElement: root };
    globalThis.window = globalThis;
    ${injected ? `globalThis.__shiziInitialContentSize = ${JSON.stringify(injected)};` : ''}
    await import('./src/platform/text-size.js');
    console.log(JSON.stringify({ k: props.get('--k') || null, ax: attrs.get('data-ax') || null, size: attrs.get('data-text-size') || null, writes: writes.length }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('injected size: text-size.js applies it while the module is evaluated (before any UI mounts); without injection nothing is written', () => {
  const ax3 = runInFakeBrowser({ category: 'AX3', scale: 2 });
  assert.deepEqual({ k: ax3.k, ax: ax3.ax, size: ax3.size }, { k: String(policy.contentSizeScale.AX3), ax: '3', size: 'AX3' });
  const web = runInFakeBrowser(null);
  assert.deepEqual(web, { k: null, ax: null, size: null, writes: 0 });
});

test('app.js imports text-size.js statically at the top (module evaluation happens before DOMContentLoaded), after bridge.js', () => {
  const imports = [...APP_JS.matchAll(/^import '([^']+)';$/gm)].map(m => m[1]);
  assert.deepEqual(imports.slice(0, 2), ['./platform/bridge.js', './platform/text-size.js']);
  assert.ok(!/await import\('\.\/platform\/text-size\.js'\)/.test(APP_JS), 'no later dynamic import of the same module');
});

test('Swift injects the current size with WKUserScript at document start, and rebuilds the script before every load / reload', () => {
  assert.match(SWIFT, /__shiziInitialContentSize\s*=\s*\{category:/, 'script sets window.__shiziInitialContentSize = {category, scale}');
  assert.match(SWIFT, /WKUserScript\([\s\S]*?injectionTime: \.atDocumentStart,\s*forMainFrameOnly: true/, 'main frame, document start');
  const loadApp = SWIFT.match(/private func loadApp\(\) \{[\s\S]*?\n    \}/)[0];
  assert.match(loadApp, /refreshUserScripts\(/, 'loadApp (first load, process-terminated reload, retry) rebuilds the scripts with the current size');
  const loadView = SWIFT.match(/override func loadView\(\) \{[\s\S]*?\n    \}/)[0];
  assert.match(loadView, /installUserScripts\(/, 'installed when the WKWebView is created');
  assert.match(SWIFT, /removeAllUserScripts\(\)/, 'old scripts removed (a stale size would be re-injected otherwise)');
  const didChange = SWIFT.match(/@objc private func contentSizeDidChange[\s\S]*?\n    \}/)[0];
  assert.ok(didChange.indexOf('refreshUserScripts(') >= 0 && didChange.indexOf('refreshUserScripts(') < didChange.indexOf('guard pageReady'),
    'a system size change updates the injected script even while the page is not ready, then still goes through the bridge when ready');
  assert.match(didChange, /sendContentSize\(/);
  assert.match(NATIVE_SMOKE, /installNativeDevUserScriptIfNeeded/, 'the DEBUG dev script is still installed (re-added with the rebuild)');
  assert.match(SWIFT, /UIApplication\.shared\.preferredContentSizeCategory/, 'before the view is in a window the category is read from the application');
});
