// B3.2 App API 契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4）：网页路径 == API 路径。
//   1. 视图 op（view.about*）返回网页页面渲染用的同一组模型函数的结果；按同一套渲染规则得出的字与网页页面一字不差；
//   2. 导航 op 交给注入的网页路由；op 表、页面文件清单、write.* 转发、changed 推送的脏域；
//   3. 标了 native:true 的屏 ⇔ Swift 里有 @objc(ShiziScreen_<屏名>) 的类（NSClassFromString 约定，没有共享登记表）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/helpers.mjs';
import { API_FILES, buildOpTable, createAppApi, createChangeFeed, domainsOf, listOps } from '../../src/session/api/index.js';
import * as views from '../../src/session/views/about.js';
import { renderRefs, tRef } from '../../src/config/copy/index.js';
import {
  ABOUT_SCREEN, ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN, aboutRows, privacyParagraphs, creditGroups, rowTexts, versionTexts, stripArrow,
} from '../../src/ui/screens/mine/about.js';
import { CREDITS } from '../../src/config/credits.js';
import { DOMAINS } from '../../src/core/schema.js';

const BUILD = { version: '1.0.0', build: '20261001-000000000000' };

test('B3.2 view.about* = the same model functions the web page renders (web path == API path)', () => {
  const api = createAppApi({ build: BUILD, native: true });
  assert.deepEqual(api.call('view.about'), { ok: true, view: views.aboutModel(BUILD) });
  assert.deepEqual(api.call('view.about-privacy'), { ok: true, view: views.privacyModel({ native: true }) });
  assert.deepEqual(api.call('view.about-credits'), { ok: true, view: views.creditsModel() });
  assert.deepEqual(api.call('view.about-letter'), { ok: true, view: views.letterModel() });
  // build 可以是取值函数（测试宿主钉住版本行）
  assert.deepEqual(createAppApi({ build: () => BUILD }).call('view.about').view, views.aboutModel(BUILD));
  // 网页 web 版的同一份字：行（标签 / 值 / 读屏名）、版本行、隐私段落、致谢分组
  const m = views.aboutModel(BUILD);
  assert.deepEqual(m.rows.map(r => rowTexts(r).aria), aboutRows().map(r => r.aria));
  assert.deepEqual(m.rows.map(r => r.to), [ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN]);
  assert.deepEqual(renderRefs(m.version), versionTexts(BUILD.version, BUILD.build));
  assert.deepEqual(views.privacyModel({ native: false }).paragraphs.map(tRef), privacyParagraphs({ native: false }));
  assert.deepEqual(views.creditsModel().groups.map(g => tRef(g.title)), creditGroups().map(g => g.title));
  assert.equal(views.creditsModel().groups.reduce((n, g) => n + g.items.length, 0), CREDITS.length);
  assert.ok(Array.isArray(m.seal) && m.seal.length > 10 && m.seal[0][0] === 'M', 'seal path travels with the view');
  assert.equal(stripArrow('记录只存在这台手机上 ›'), '记录只存在这台手机上');
  // 视图模型只给引用 + 数据，不拼句子
  assert.equal(typeof m.title, 'object');
  assert.equal(m.title.copy, 'X-ABOUT.title');
  // 屏名两边一致
  assert.deepEqual([views.ABOUT_SCREEN, views.ABOUT_PRIVACY_SCREEN, views.ABOUT_CREDITS_SCREEN, views.ABOUT_LETTER_SCREEN],
    [ABOUT_SCREEN, ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN]);
});

test('B3.2 nav.* ops are executed by the injected web router', () => {
  const calls = [];
  const nav = {
    push: (n, p) => calls.push(['push', n, p]),
    replace: (n, p, o) => calls.push(['replace', n, p, o]),
    back: o => { calls.push(['back', o]); return true; },
    switchTab: n => calls.push(['tab', n]),
    setParams: p => calls.push(['params', p]),
  };
  const api = createAppApi({ nav });
  assert.deepEqual(api.call('nav.push', { screen: 'about-privacy' }), { ok: true });
  assert.deepEqual(api.call('nav.replace', { screen: 'x', params: { a: 1 }, animate: true }), { ok: true });
  assert.deepEqual(api.call('nav.back', { via: 'native' }), { ok: true });
  assert.deepEqual(api.call('nav.tab', { name: 'mine' }), { ok: true });
  assert.deepEqual(api.call('nav.setParams', { patch: { month: '2026-10' } }), { ok: true });
  assert.deepEqual(calls, [['push', 'about-privacy', {}], ['replace', 'x', { a: 1 }, { animate: true }], ['back', { cause: 'native' }], ['tab', 'mine'], ['params', { month: '2026-10' }]]);
  assert.equal(api.call('nav.push', {}).ok, false, 'no screen → invalid');
  assert.equal(createAppApi({}).call('nav.back', {}).error.kind, 'exception', 'no router → exception, not a throw');
});

test('B3.2 op table: fixed page files (no shared edits), no duplicate op, unknown op / write.* forwarding', () => {
  const dir = path.join(ROOT, 'src/session/api');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js').sort();
  assert.deepEqual(Object.keys(API_FILES).sort(), files, 'index.js imports exactly the page files in src/session/api/');
  for (const f of ['home.js', 'library.js', 'mine.js', 'tabs.js', 'query.js', 'detail.js', 'library-sub.js', 'mine-sub.js', 'settings.js', 'backup.js', 'image.js', 'session.js', 'block.js', 'route.js']) {
    assert.ok(files.includes(f), `pre-created page file ${f}`);
  }
  assert.throws(() => buildOpTable({ 'a.js': { x: () => ({}) }, 'b.js': { x: () => ({}) } }), /declared twice/);
  assert.ok(listOps().includes('view.about') && listOps().includes('nav.push'));
  const api = createAppApi({ write: { call: (op, a) => ({ ok: true, op, a }) } });
  assert.deepEqual(api.call('write.open', { slot: 'A' }), { ok: true, op: 'open', a: { slot: 'A' } });
  assert.equal(api.call('nope.nope').error.kind, 'unknown-op');
  assert.equal(createAppApi({}).call('write.open').error.kind, 'unavailable');
});

test('B3.2 changed {domains}: one push per successful commit with its dirty domains; load / replace = everything', () => {
  assert.deepEqual(domainsOf({ type: 'commit', keys: ['shizi.v2.settings', 'shizi.v2.records.2026-10', 'shizi.v2.ink.2026-10'] }), ['records', 'ink', 'settings']);
  assert.deepEqual(domainsOf({ type: 'load' }), [...DOMAINS]);
  assert.deepEqual(domainsOf({ type: 'commit', keys: [], replace: true }), [...DOMAINS]);
  assert.deepEqual(domainsOf({ type: 'status' }), []);
  const listeners = [];
  const store = { subscribe: fn => { listeners.push(fn); return () => {}; } };
  const sent = [];
  createChangeFeed({ store, post: d => sent.push(d) });
  listeners[0]({}, { type: 'commit', label: 'judge', keys: ['shizi.v2.sessions'] });
  listeners[0]({}, { type: 'status' });
  assert.deepEqual(sent, [{ domains: ['sessions'], label: 'judge' }]);
});

/** src 里 registerScreen(…, { … native: true }) 的屏名（常量按同文件的 export const X = '…' 解析）。 */
function nativeFlaggedScreens() {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(ROOT, 'src/ui'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/registerScreen\(\s*([A-Za-z_'".-]+)\s*,[^;]*?\{[^}]*\bnative:\s*true\b[^}]*\}\s*\)/g)) {
      const arg = m[1];
      if (/^['"]/.test(arg)) { out.push(arg.slice(1, -1)); continue; }
      const c = new RegExp(`export const ${arg} = '([^']+)'`).exec(src);
      assert.ok(c, `${path.relative(ROOT, f)}: cannot resolve ${arg}`);
      out.push(c[1]);
    }
  }
  return out.sort();
}

/** Swift 里 @objc(ShiziScreen_<名>) 的类（名里的 _ 还原成 -）。 */
function swiftScreenClasses() {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.swift') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(ROOT, 'ios/ShiziApp/ShiziApp'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/@objc\(ShiziScreen_([A-Za-z0-9_]+)\)\s*\n\s*final class \w+: ShiziScreenViewController/g)) out.push(m[1].replace(/_/g, '-'));
  }
  return out.sort();
}

test('B3.2 every native:true screen has a Swift class ShiziScreen_<name> and vice versa (NSClassFromString convention, no shared registry)', () => {
  const flagged = nativeFlaggedScreens();
  assert.ok(flagged.includes('about') && flagged.includes('about-credits'), `found ${flagged}`);
  assert.deepEqual(swiftScreenClasses(), flagged);
});

test('B3.2 registerScreen native:true: hosted only while the NativeStage gate says the native class exists', async () => {
  const { registerScreen, unregisterScreen, getScreen, nativeScreenShown, setNativeScreenGate } = await import('../../src/ui/router.js');
  registerScreen('b32-test', () => null, { native: true });
  registerScreen('b32-web', () => null, {});
  try {
    setNativeScreenGate(() => false);
    assert.equal(nativeScreenShown('b32-test'), false);
    assert.equal(getScreen('b32-test').nativeHost(), false);
    setNativeScreenGate(name => name === 'b32-test');
    assert.equal(nativeScreenShown('b32-test'), true);
    assert.equal(getScreen('b32-test').nativeHost(), true);
    assert.equal(nativeScreenShown('b32-web'), false, 'screens without native:true never host');
    assert.equal(getScreen('b32-web').nativeHost, null);
  } finally {
    setNativeScreenGate(null);
    unregisterScreen('b32-test');
    unregisterScreen('b32-web');
  }
});
