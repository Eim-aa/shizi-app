// R5-I2（交互规范 §1 N、§4 G、§7 读屏；审计 P0-01 / P0-02 / P0-16 / P1-01 – P1-06 / P1-09 / P1-11 / P1-12 / P2-17 / P2-18 / P2-19）：
// 左缘右滑永远等于左上角元素的动作（N3），页面不得登记 null；判断阶段的「‹ 接着写」是页内回退（kind 'phase'），左缘右滑同义；
// 读屏两指 Z 形 / Esc 在没有弹层时等于点左上；弹层开着时（含 tab 根上的弹层）左缘右滑可用、只关弹层。
// 单测没有 DOM：纯逻辑 + 源码约定；真实手势 / 读屏 escape 的端到端见 scripts/e2e/103-i2-nav.spec.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  backActionAllowed,
  getBackAction,
  getBackKind,
  resetBackActions,
  runBackAction,
  setBackAction,
} from '../../src/ui/back-action.js';
import { backGestureAllowed, createBackGestureController, createBackGestureSync } from '../../src/ui/router.js';
import { pageBackAction } from '../../src/ui/components/Page.js';

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const W = 400;

test('N3-2：Page 收到自定义 lead 时仍登记它的动作（kind phase），不登记 null', () => {
  const goBack = () => {};
  const onLead = () => {};
  assert.deepEqual(pageBackAction({ leading: 'back', goBack }), { fn: goBack, kind: 'page' }, '默认「‹」：出页');
  assert.deepEqual(pageBackAction({ leading: 'close', goBack }), { fn: goBack, kind: 'page' }, '结果页「×」：出页');
  assert.deepEqual(pageBackAction({ leading: 'back', goBack, lead: {}, onLead }), { fn: onLead, kind: 'phase' }, '判断页「‹ 接着写」：页内回退');
  const noLeadAction = pageBackAction({ leading: 'back', goBack, lead: {} });
  assert.equal(typeof noLeadAction.fn, 'function', '自定义 lead 没给动作：退回出页（仍然可滑），绝不是 null');
  const page = read('src/ui/components/Page.js');
  assert.doesNotMatch(page, /useBackAction\(customLead \|\| leading === 'none' \? null/, '不再有「自定义左上就关手势」的口子');
});

test('判断阶段把「接着写」的同一个函数交给 Page（write/index.js 传 onLead=compare.back）', () => {
  const write = read('src/ui/screens/write/index.js');
  assert.match(write, /lead=\$\{compare\.lead\} onLead=\$\{compare\.back\}/);
  const compare = read('src/ui/screens/write/compare.js');
  assert.match(compare, /return \{ active: true, stage, footer, lead, back \}/);
  assert.doesNotMatch(write, /这一阶段不能滑动返回/, '注释同步（P0-02）');
});

test('back-action：登记带种类；页内回退的层同样「能返回」', () => {
  resetBackActions();
  let ran = 0;
  setBackAction('e1', () => { ran += 1; }, 'phase');
  assert.equal(getBackKind('e1'), 'phase');
  assert.equal(backActionAllowed('e1'), true);
  assert.equal(runBackAction('e1', () => {}), true);
  assert.equal(ran, 1);
  setBackAction('e2', () => {});
  assert.equal(getBackKind('e2'), 'page', '缺省是出页');
  assert.equal(getBackKind('e9'), 'page', '没登记：按出页（router.back）');
  assert.equal(typeof getBackAction('e2'), 'function');
  resetBackActions();
});

test('N4 门控：顶层是弹层时左缘右滑永远可用（含 tab 根上的弹层），阻断页除外', () => {
  const root = { stack: [{ k: 's', id: 'e1', n: 'home' }], top: { id: 'e1', n: 'home' }, topIsOverlay: false };
  const rootSheet = { stack: [{ k: 's', id: 'e1', n: 'home' }, { k: 'o', id: 'o2', n: 'sheet' }], top: { id: 'e1', n: 'home' }, topIsOverlay: true };
  assert.equal(backGestureAllowed(root, false, true), false, 'tab 根：不能滑');
  assert.equal(backGestureAllowed(rootSheet, false, true), true, 'tab 根上的弹层：能滑（只关弹层）');
  assert.equal(backGestureAllowed(rootSheet, true, true), false, '阻断页：不能');
  const sent = [];
  const sync = createBackGestureSync({ send: v => sent.push(v), screenOf: () => ({}) });
  sync.update(root, false, true);
  sync.update(rootSheet, false, true);
  sync.update(root, false, true);
  assert.deepEqual(sent, [false, true, false], '开 / 关弹层时原生门控跟着变');
});

function phaseController(kind) {
  const views = [];
  let backs = 0;
  let timers = 0;
  const ctrl = createBackGestureController({
    getState: () => ({ stack: [{ k: 's', id: 'e1', n: 'home' }, { k: 's', id: 'e2', n: 'write' }], depth: 1, topIsOverlay: false }),
    back: () => { backs += 1; },
    kind: () => kind,
    width: () => W,
    now: () => 1000,
    setTimeout: () => { timers += 1; return timers; },
    clearTimeout: () => {},
    onView: v => views.push(v),
  });
  return { ctrl, views, backs: () => backs };
}

test('N3-3 页内回退：跟手画面带 kind=phase；完成即执行左上动作、画面立即收起（不等出栈转场）', () => {
  const c = phaseController('phase');
  c.ctrl.handle({ phase: 'began', translationX: 0 });
  c.ctrl.handle({ phase: 'changed', translationX: 160 });
  assert.equal(c.views.at(-1).kind, 'phase');
  assert.equal(c.views.at(-1).phase, 'follow');
  c.ctrl.handle({ phase: 'ended', translationX: 160, velocityX: 0 });
  assert.equal(c.backs(), 1, '执行一次「接着写」');
  assert.equal(c.views.at(-1), null, '画面交给页内阶段切换（phase-fade），不停在 commit 等出栈');
  assert.equal(c.ctrl.takeReducedCommit(), false, '页内回退不留「减少动态效果的出栈淡化」标记');
  const p = phaseController('page');
  p.ctrl.handle({ phase: 'began', translationX: 0 });
  p.ctrl.handle({ phase: 'changed', translationX: 160 });
  p.ctrl.handle({ phase: 'ended', translationX: 160, velocityX: 0 });
  assert.equal(p.views.at(-1).phase, 'commit', '出页仍停在松手处等返回转场接手');
});

test('P0-16：Swift 的两指 Z 形只在页面能返回 / 有弹层时（与左缘门控同一个值）派发并返回 true', () => {
  const swift = read('ios/ShiziApp/ShiziApp/WebViewController.swift');
  const m = /override func accessibilityPerformEscape\(\) -> Bool \{([\s\S]*?)\n    \}/.exec(swift);
  assert.ok(m);
  assert.match(m[1], /guard backGestureEnabled else \{ return false \}/);
  assert.match(m[1], /dispatchAccessibilityEscape\(\)/);
  const root = read('src/ui/root.js');
  assert.match(root, /const escapeBack = /, 'root.js：Esc 与 shizi-native-escape 共用一个「点左上」函数');
});

test('D58 ④：「×」只用于结果页；「旧版本的记录」与「没有要写的字」页是「‹」，后者没有「回首页」', () => {
  assert.doesNotMatch(read('src/ui/screens/detail/photos.js'), /leading="close"/);
  const none = read('src/ui/screens/session/none.js');
  assert.doesNotMatch(none, /leading="close"/);
  assert.doesNotMatch(none, /session-none-home/);
  assert.match(read('src/ui/screens/result/index.js'), /leading="close"/);
});

test('G1 / G2（P1-12）：图片预览的横向翻页区左右各让出 20pt 页边，不伸进左缘起手区', () => {
  const img = read('src/ui/components/image-preview.js');
  assert.match(img, /\.sz-img__scroll\{[^}]*width:calc\(100% - 2 \* \$\{T\.gutter\}\)/);
  assert.match(img, /\.sz-img__scroll\{padding-top:6px;padding-bottom:14px;margin:-6px \$\{T\.gutter\} -14px/);
});
