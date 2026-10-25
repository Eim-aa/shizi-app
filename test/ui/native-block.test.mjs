// B3.12 + B3.13 的 App API 契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.session-none / view.block 返回网页页面渲染用的同一个模型函数的结果（noneView / blockView），渲染出的字一字不差；
//   2. session.pick / session.libSwitch / session.wrongList 调的是网页登记进来的**同一个函数对象**（setNoneActions）；
//   3. block.retry：unavailable = 重新探测（回 {ok, still}），blocked / migration = 整页重新启动（回 {ok, reload:true}）；
//   4. block.export = 网页阻断页的同一个导出函数（只读：打包内存状态，不写入任何键）；block.exportable = 能不能导出；
//   5. 折行点：视图模型带着网页量出来的「每一行从第几个字开始」（原生按它换行，不自己折）；
//   6. 标了 native:true 的屏 ⇔ Swift 里有 @objc(ShiziScreen_<屏名>) 的类（NSClassFromString 约定）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/helpers.mjs';
import { createAppApi, listOps } from '../../src/session/api/index.js';
import { setNoneActions, noneActions } from '../../src/session/api/session.js';
import { noneView, NONE_SCREEN } from '../../src/session/views/session.js';
import { blockView, blockBackup, blockReasonOf, hasJudged, BLOCK_SCREEN } from '../../src/session/views/block.js';
import { setLineMeasurer } from '../../src/session/views/lines.js';
import { renderRefs, tRef, t } from '../../src/config/copy/index.js';

/** 一个假 store（状态够用：status / getState / serial / reload）。 */
function fakeStore({ available = true, blocked = null, records = {}, reload } = {}) {
  return {
    status: { available, blocked },
    serial: 1,
    getState: () => ({ records, settings: {}, ink: {} }),
    reload: reload || (() => {}),
  };
}

test('B3.12 view.session-none = the same model function the web page renders (web path == API path)', () => {
  const api = createAppApi({ native: true });
  // 没登记任何入口：没有入口就不显示（不放点了没反应的按钮）
  assert.deepEqual(api.call('view.session-none', {}).view, noneView({ exhausted: false, pick: false, wrongList: false, libSwitch: false }));
  // 登记了入口：模型里就有对应的按钮
  const pick = () => {};
  const wrongList = () => {};
  const libSwitch = () => {};
  setNoneActions({ pick, wrongList, libSwitch });
  try {
    const exhausted = api.call('view.session-none', { exhausted: true }).view;
    assert.deepEqual(exhausted, noneView({ exhausted: true, pick: true, wrongList: true, libSwitch: true }));
    assert.equal(exhausted.screen, NONE_SCREEN);
    assert.equal(exhausted.title.copy, 'X-TABS.write');
    // 渲染出的字与网页页面一模一样（网页页面调的就是 noneView）
    assert.deepEqual(renderRefs(exhausted.title), t('X-TABS.write'));
    assert.deepEqual(renderRefs(exhausted.empty.title), t('R-H11.title'));
    assert.deepEqual(renderRefs(exhausted.empty.body), [t('R-H11.body')]);
    assert.deepEqual(renderRefs(exhausted.empty.extra), [t('R-H11.noCharsBody')]);
    assert.equal(tRef(exhausted.empty.action.label), t('R-H11.noCharsLink'));
    assert.equal(exhausted.empty.action.to, 'wrongList');
    // exhausted：主按钮「更换字库」，「自己选字」降为次按钮
    assert.equal(tRef(exhausted.primary.label), t('X-SESSION.noneLibSwitch'));
    assert.equal(exhausted.primary.to, 'libSwitch');
    assert.equal(tRef(exhausted.secondary.label), t('X-SESSION.nonePick'));
    assert.equal(exhausted.secondary.to, 'pick');
    // 没 exhausted：主按钮是「自己选字」，没有次按钮，也没有「看写错过的字 ›」
    const plain = api.call('view.session-none', {}).view;
    assert.equal(tRef(plain.primary.label), t('X-SESSION.nonePick'));
    assert.equal(plain.secondary, null);
    assert.equal(plain.empty.action, null);
    assert.deepEqual(plain.empty.extra, []);
  } finally {
    setNoneActions({ pick: null, wrongList: null, libSwitch: null });
  }
});

test('B3.12 session.pick / session.libSwitch / session.wrongList call the very function the web registered', () => {
  const calls = [];
  const pick = () => calls.push('pick');
  const wrongList = () => calls.push('wrongList');
  const libSwitch = () => calls.push('libSwitch');
  setNoneActions({ pick, wrongList, libSwitch });
  try {
    const api = createAppApi({ native: true });
    assert.deepEqual(api.call('session.pick'), { ok: true });
    assert.deepEqual(api.call('session.wrongList'), { ok: true });
    assert.deepEqual(api.call('session.libSwitch'), { ok: true });
    assert.deepEqual(calls, ['pick', 'wrongList', 'libSwitch']);
    // 登记的函数回 {ok:false, error:{kind}} 时，op 也回同样的错（D07）
    setNoneActions({ pick: () => ({ ok: false, error: { kind: 'stale' } }) });
    assert.deepEqual(api.call('session.pick'), { ok: false, error: { kind: 'stale' } });
    // 没登记：unavailable（不放点了没反应的按钮）
    setNoneActions({ pick: null });
    assert.deepEqual(api.call('session.pick'), { ok: false, error: { kind: 'unavailable' } });
  } finally {
    setNoneActions({ pick: null, wrongList: null, libSwitch: null });
  }
});

test('B3.13 view.block = the same model function the web page renders (web path == API path)', () => {
  const store = fakeStore({ available: false });
  const api = createAppApi({ getStore: () => store, native: true });
  const v = api.call('view.block', {}).view;
  assert.deepEqual(v, blockView({ kind: 'unavailable', canExport: false, still: false, exportFail: false }));
  assert.equal(v.kind, 'unavailable');
  assert.deepEqual(renderRefs(v.title), t('R-B09.title'));
  assert.deepEqual(renderRefs(v.body), t('R-B09.body'));
  assert.equal(tRef(v.retry), t('R-B09.retry'));
  assert.equal(v.export, null);
  assert.equal(v.exportFail, null);
  assert.equal(v.migration, null);
  assert.equal(v.still, null);
  // 迁移变体：多一句「没能导入这一版」
  const mig = api.call('view.block', { kind: 'migration' }).view;
  assert.equal(mig.kind, 'migration');
  assert.deepEqual(renderRefs(mig.migration), t('X-SYS.blockMigration'));
  // 「再试一次」之后仍不可用：多一句「还是存不了」
  const still = api.call('view.block', { kind: 'unavailable', still: true }).view;
  assert.deepEqual(renderRefs(still.still), t('X-SYS.blockStill'));
  // 导出没成：就地三段式
  const fail = api.call('view.block', { kind: 'blocked', canExport: true, exportFail: true }).view;
  assert.deepEqual(renderRefs(fail.export), t('R-B02.export'));
  assert.deepEqual(renderRefs(fail.exportFail.text), t('X-BACKUP.exportFailed'));
  assert.deepEqual(renderRefs(fail.exportFail.cancel), t('X-BACKUP.exportStay'));
  assert.deepEqual(renderRefs(fail.exportFail.retry), t('R-B09.retry'));
});

test('B3.13 block.retry: unavailable re-probes (still), blocked / migration reload the page', () => {
  let reloaded = 0;
  const store = fakeStore({ available: false, reload: () => { reloaded += 1; } });
  const api = createAppApi({ getStore: () => store, native: true });
  // 存储不可用：重新探测；还是不可用 → still
  assert.deepEqual(api.call('block.retry', { kind: 'unavailable' }), { ok: true, still: true });
  assert.equal(reloaded, 1);
  // 探测之后好了：still = false
  store.status.available = true;
  assert.deepEqual(api.call('block.retry', { kind: 'unavailable' }), { ok: true, still: false });
  // 阻断 / 迁移：整页重新启动（网页 location.reload()、原生重载网页）
  assert.deepEqual(api.call('block.retry', { kind: 'blocked' }), { ok: true, reload: true });
  assert.deepEqual(api.call('block.retry', { kind: 'migration' }), { ok: true, reload: true });
});

test('B3.13 block.export = the web export function (read-only: packs memory, writes nothing)', () => {
  const now = Date.parse('2026-10-22T09:00:00Z');
  const state = { records: { '2026-10': [{ id: 'r1', char: '永', kind: 'judged' }] }, settings: {}, ink: {} };
  const store = fakeStore({ available: true, blocked: { reason: 'rollback' }, records: state.records });
  const api = createAppApi({ getStore: () => store, now: () => now, native: true });
  const r = api.call('block.export');
  assert.equal(r.ok, true);
  assert.deepEqual({ name: r.name, text: r.text }, blockBackup(store, now));
  assert.equal(r.name, '拾字备份-2026-10-22.json');
  // 只读：不写任何键
  assert.equal(typeof store.reload, 'function');
  assert.equal(store.getState().records, state.records);
  // 没有 store：unavailable
  const none = createAppApi({ getStore: () => { throw new Error('no store'); }, native: true });
  assert.deepEqual(none.call('block.export'), { ok: false, error: { kind: 'unavailable' } });
});

test('B3.13 block.exportable: only blocked + readable memory + judged chars', () => {
  const judged = { '2026-10': [{ id: 'r1', char: '永', kind: 'judged' }] };
  const blocked = fakeStore({ available: true, blocked: { reason: 'rollback' }, records: judged });
  const api = createAppApi({ getStore: () => blocked, native: true });
  assert.deepEqual(api.call('block.exportable'), { ok: true, exportable: true });
  assert.equal(hasJudged(blocked), true);
  // 存储不可用：不能导出
  const unavailable = createAppApi({ getStore: () => fakeStore({ available: false }), native: true });
  assert.deepEqual(unavailable.call('block.exportable'), { ok: true, exportable: false });
  // 没有判断过的字：不能导出
  const empty = createAppApi({ getStore: () => fakeStore({ available: true, blocked: { reason: 'x' }, records: {} }), native: true });
  assert.deepEqual(empty.call('block.exportable'), { ok: true, exportable: false });
});

test('B3.13 blockReasonOf: unavailable / blocked / migration, and none when everything is fine', () => {
  assert.deepEqual(blockReasonOf(null), { kind: 'unavailable', detail: 'no-store' });
  assert.deepEqual(blockReasonOf({ available: false, unavailableKind: 'quota' }), { kind: 'unavailable', detail: 'quota' });
  assert.deepEqual(blockReasonOf({ available: true, blocked: { reason: 'rollback' } }), { kind: 'blocked', detail: 'rollback' });
  assert.deepEqual(blockReasonOf({ available: true, blocked: null }, { reason: 'v1' }), { kind: 'migration', detail: 'v1' });
  assert.equal(blockReasonOf({ available: true, blocked: null }), null);
});

test('B3.12 / B3.13 the view models carry the web-measured line starts (native wraps by them, not by itself)', () => {
  // node 没有 DOM：量不到 → lines 为 null（原生按自己的宽度折）
  const none = noneView({ exhausted: true, pick: true, wrongList: true, libSwitch: true });
  assert.equal(none.lines.title, null);
  assert.equal(none.lines.body, null);
  assert.equal(none.lines.extra, null);
  const block = blockView({ kind: 'migration' });
  assert.equal(block.lines.body.length, 2);
  assert.equal(block.lines.body[0], null);
  assert.equal(block.lines.migration, null);
  assert.equal(block.lines.still, null);
  // 量得到时：每一行从第几个字开始
  setLineMeasurer(spec => (spec.variant === 'empty-body' ? [8, 12] : [4]));
  try {
    const n2 = noneView({ exhausted: true });
    assert.deepEqual(n2.lines.title, [4]);
    assert.deepEqual(n2.lines.body, [8, 12]);
    assert.deepEqual(n2.lines.extra, [8, 12]);
    const b2 = blockView({ kind: 'blocked', still: true });
    assert.deepEqual(b2.lines.body, [[4], [4]]);
    assert.deepEqual(b2.lines.still, [4]);
  } finally {
    setLineMeasurer(null);
  }
});

test('B3.12 / B3.13 the ops are registered and the native screens have their Swift classes', () => {
  const ops = listOps();
  for (const op of ['view.session-none', 'session.pick', 'session.libSwitch', 'session.wrongList', 'view.block', 'block.retry', 'block.export', 'block.exportable']) {
    assert.ok(ops.includes(op), `missing op ${op}`);
  }
  // 屏名 ⇄ 类名（NSClassFromString 约定）
  const swift = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.swift') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(ROOT, 'ios/ShiziApp/ShiziApp'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/@objc\(ShiziScreen_([A-Za-z0-9_]+)\)\s*\n\s*final class \w+: ShiziScreenViewController/g)) swift.push(m[1].replace(/_/g, '-'));
  }
  assert.ok(swift.includes(NONE_SCREEN), `Swift class for ${NONE_SCREEN}`);
  assert.ok(swift.includes(BLOCK_SCREEN), `Swift class for ${BLOCK_SCREEN}`);
});
