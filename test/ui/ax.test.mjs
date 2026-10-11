// 阶段 1 P1-E6（D29「AX 档单独排版」；03 P131）：AX 档防溢出规则（src/ui/components/ax.js）的静态检查。
// 版式效果由 scripts/e2e/66-text-size.spec.js 在 AX3 / AX5 下实测（无横向溢出、关键按钮在视口内且 ≥44pt、格子边长不变）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AX_CSS, AX_ROOT } from '../../src/ui/components/ax.js';
import { splitRules } from '../../src/ui/components/styles.js';

test('every AX rule is scoped to :root[data-ax][data-text-large] (never touches the default / XXXL layout)', () => {
  const rules = splitRules(AX_CSS);
  assert.ok(rules.length >= 10);
  for (const rule of rules) {
    const selectors = rule.slice(0, rule.indexOf('{')).split(',').map(s => s.trim());
    for (const s of selectors) assert.ok(s.startsWith(AX_ROOT), `${s} starts with ${AX_ROOT}`);
  }
});

test('AX rules cover the card list: page title wraps, write / judge buttons stack, settings value rows stack, buttons take --btn-h (D49)', () => {
  assert.match(AX_CSS, /\.sz-page__title\{[^}]*white-space:normal/);
  assert.match(AX_CSS, /\.sz-btn--text\{min-height:max\(44px, calc\(1\.3em \+ 12px\)\);white-space:normal;line-break:strict/);
  assert.match(AX_CSS, /\.sz-judge__btns,[^{]*\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(AX_CSS, /\.sz-set__row--value\{flex-direction:column/);
  assert.match(AX_CSS, /\.sz-btn--primary,[^{]*\{min-height:var\(--btn-h\)/, 'D49: button min height = --btn-h (AX tier: max(54, lh17 + 26), 88 at AX5)');
});

test('D49: the tab bar does not grow in AX — no AX rule touches .sz-tabs and Tabs.js never reads --k (icon 24, label 11, height 49 + safe area)', () => {
  assert.ok(!/\.sz-tabs/.test(AX_CSS), 'ax.js has no tab bar rule any more');
  const tabs = readFileSync(new URL('../../src/ui/components/Tabs.js', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/T\.k\b|var\(--k|T\.fs11|T\.lh11/.test(tabs), 'Tabs.js: no --k / fs11 (font scale) dependency');
  assert.match(tabs, /height:calc\(49px \+ env\(safe-area-inset-bottom/);
  assert.match(tabs, /svg\{width:24px;height:24px/);
  assert.match(tabs, /font-size:calc\(11px \* 1\)/);
  assert.ok(!/::after/.test(tabs), 'no selected dot (D49)');
});

test('ax.js is loaded once by the root and the settings value rows carry the AX hook class', () => {
  assert.match(readFileSync(new URL('../../src/ui/root.js', import.meta.url), 'utf8'), /import '\.\/components\/ax\.js';/);
  assert.match(readFileSync(new URL('../../src/ui/screens/mine/settings.js', import.meta.url), 'utf8'), /class="sz-set__row sz-set__row--value"/);
});
