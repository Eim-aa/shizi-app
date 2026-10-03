// 阶段 1 P1-E6（D29，覆盖 X08 与 03 P59；03 P130–P133）：字号跟随系统 Dynamic Type。
//   原生读 traitCollection.preferredContentSizeCategory，在 pageReady 与 UIContentSizeCategory.didChangeNotification 时调用
//   桥全局 shiziContentSize({category, scale})（bridge.js 顶层同步定义、就绪前只留最后一次）；页面侧 src/platform/text-size.js
//   按 policy.contentSizeScale（P130）把档位换成连续倍率写进 :root 的 --k，AX 档加 data-ax，倍率 ≥ policy.compactTextScale（P131）
//   加 data-text-large（紧凑排布）。网页（无原生桥）不调用 → --k 保持 tokens.css 的 1（P133）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createBridge, NATIVE_GLOBALS, bridge as moduleBridge } from '../../src/platform/bridge.js';
import {
  CONTENT_SIZE_CATEGORIES, scaleFor, axLevelOf, textSizeOf, applyTextSize, receiveContentSize, getTextSize, onTextSize, resetTextSize,
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
