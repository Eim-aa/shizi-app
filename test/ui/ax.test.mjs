// 阶段 1 P1-E6（D29「AX 档单独排版」；03 P131）：AX 档防溢出规则（src/ui/components/ax.js）的静态检查。
// 版式效果由 scripts/e2e/66-text-size.spec.js 在 AX3 / AX5 下实测（无横向溢出、关键按钮在视口内且 ≥44pt、格子边长不变）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AX_CSS, AX_ROOT, TAB_SCALE_CAP } from '../../src/ui/components/ax.js';
import { splitRules } from '../../src/ui/components/styles.js';
import * as policy from '../../src/config/policy.js';

test('every AX rule is scoped to :root[data-ax][data-text-large] (never touches the default / XXXL layout)', () => {
  const rules = splitRules(AX_CSS);
  assert.ok(rules.length >= 10);
  for (const rule of rules) {
    const selectors = rule.slice(0, rule.indexOf('{')).split(',').map(s => s.trim());
    for (const s of selectors) assert.ok(s.startsWith(AX_ROOT), `${s} starts with ${AX_ROOT}`);
  }
});

test('AX rules cover the card list: page title wraps, write / judge buttons stack, settings value rows stack, tab bar capped', () => {
  assert.match(AX_CSS, /\.sz-page__title\{[^}]*white-space:normal/);
  assert.match(AX_CSS, /\.sz-write__main\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(AX_CSS, /\.sz-judge__btns,[^{]*\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(AX_CSS, /\.sz-set__row--value\{flex-direction:column/);
  assert.match(AX_CSS, /\.sz-btn--primary,[^{]*\{min-height:calc\(1\.3em/, 'button min height follows its own font size');
  assert.equal(TAB_SCALE_CAP, policy.contentSizeScale.XXXL, 'tab bar stops growing at the XXXL scale');
  // P1-E1a：Tab 栏改为设计系统的通栏 50px（加底部安全区），封顶规则不变
  assert.match(AX_CSS, new RegExp(`\\.sz-tabs\\{height:calc\\(50px \\* ${String(TAB_SCALE_CAP).replace('.', '\\.')} \\+ env\\(safe-area-inset-bottom`));
});

test('ax.js is loaded once by the root and the settings value rows carry the AX hook class', () => {
  assert.match(readFileSync(new URL('../../src/ui/root.js', import.meta.url), 'utf8'), /import '\.\/components\/ax\.js';/);
  assert.match(readFileSync(new URL('../../src/ui/screens/mine/settings.js', import.meta.url), 'utf8'), /class="sz-set__row sz-set__row--value"/);
});
