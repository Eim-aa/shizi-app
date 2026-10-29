// B3.F 引擎模式：导航镜像（createEngineRouter）与 App API 的栈往来 op（src/session/api/route.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerScreen, getScreen } from '../../src/ui/router.js';
import { createEngineRouter, entriesOf } from '../../src/ui/engine.js';
import { createAppApi } from '../../src/session/api/index.js';

const C = () => null;
for (const [name, opts] of [['home', { tab: true, order: 0 }], ['library', { tab: true, order: 1 }], ['mine', { tab: true, order: 2 }], ['about', {}], ['detail', {}]]) {
  if (!getScreen(name)) registerScreen(name, C, opts);
}

function rig() {
  const posted = [];
  const hostCalls = [];
  const r = createEngineRouter({ post: m => posted.push(m), hosts: (prev, next, tr, o) => { hostCalls.push({ prev, next, tr, o }); return []; }, onError: () => {} });
  r.start([{ n: 'home', p: {} }]);
  hostCalls.length = 0;
  return { r, posted, hostCalls };
}

test('JS-originated push: the mirror records it and tells native where to go (op nav)', () => {
  const { r, posted, hostCalls } = rig();
  r.push('about', { a: 1 });
  const s = r.getState();
  assert.deepEqual(s.stack.map(e => e.n), ['home', 'about']);
  assert.equal(s.top.n, 'about');
  assert.equal(s.depth, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].op, 'nav');
  assert.equal(posted[0].kind, 'push');
  assert.deepEqual(posted[0].entry, { id: s.top.id, n: 'about', p: { a: 1 } });
  assert.equal(hostCalls.length, 1);
  assert.equal(hostCalls[0].tr.kind, 'push');
  assert.equal(hostCalls[0].o.origin, 'js');
});

test('push of a tab screen switches tab; back at a tab root does nothing', () => {
  const { r, posted } = rig();
  assert.equal(r.back(), false);
  r.push('mine');
  assert.equal(r.getState().tab, 'mine');
  assert.equal(posted[0].kind, 'tab');
  r.switchTab('mine');
  assert.equal(posted.length, 1, 'same tab: nothing sent');
});

test('replace / back / setParams carry their arguments to native', () => {
  const { r, posted } = rig();
  r.push('about');
  r.replace('detail', { char: '永' }, { animate: true });
  assert.equal(posted[1].kind, 'replace');
  assert.equal(posted[1].animate, true);
  r.setParams({ x: 2 });
  assert.equal(posted[2].kind, 'params');
  assert.deepEqual(r.getState().top.p, { char: '永', x: 2 });
  assert.equal(r.back({ cause: 'native' }), true);
  assert.equal(posted[3].kind, 'pop');
  assert.equal(posted[3].cause, 'native');
  assert.equal(r.getState().depth, 0);
});

test('native-originated navigation is only accounted for (nothing is sent back to native)', () => {
  const { r, posted, hostCalls } = rig();
  const bodies = r.apply({ kind: 'push', entry: { k: 's', id: 'n1', n: 'about', p: {} } });
  assert.deepEqual(bodies, []);
  assert.equal(posted.length, 0);
  assert.equal(hostCalls[0].o.origin, 'native');
  assert.equal(r.getState().top.id, 'n1');
  assert.equal(r.apply({ kind: 'pop', cause: 'native' }).length, 0);
  assert.equal(r.apply({ kind: 'pop', cause: 'native' }), null, 'cannot pop the tab root');
});

test('route.save: the native stack wins (adopt), identical stacks are a no-op', () => {
  const { r } = rig();
  let emits = 0;
  r.subscribe(() => { emits += 1; });
  const home = r.getState().stack[0];
  assert.equal(r.adopt([{ id: home.id, n: 'home', p: {} }]), false);
  assert.equal(emits, 0);
  assert.equal(r.adopt([{ id: home.id, n: 'home', p: {} }, { id: 'n9', n: 'detail', p: { char: '永' } }]), true);
  assert.equal(r.getState().top.id, 'n9');
  assert.equal(emits, 1);
});

test('route.save from native does not roll back a JS intent still on its way (seq)', () => {
  const { r, posted } = rig();
  const home = r.getState().stack[0];
  r.switchTab('mine');
  assert.equal(posted[0].seq, 1);
  assert.equal(r.adopt([{ id: home.id, n: 'home', p: {} }], 0), false, 'native has not applied intent 1 yet: stale');
  assert.equal(r.getState().tab, 'mine');
  assert.equal(r.adopt([{ id: 'n5', n: 'library', p: {} }], 1), true, 'caught up: native wins');
  assert.equal(r.getState().tab, 'library');
});

test('cold start: unknown / malformed stacks fall back to the default tab; ids are kept', () => {
  const r = createEngineRouter({ onError: () => {} });
  assert.deepEqual(r.start([{ n: 'nope', p: {} }]).stack.map(e => e.n), ['home']);
  const out = r.start([{ n: 'mine', p: {} }, { n: 'about', p: {} }], { cold: true });
  assert.deepEqual(out.stack.map(e => e.n), ['mine', 'about']);
  assert.equal(r.getState().transition.cold, true);
  assert.equal(entriesOf([{ n: 'about', p: {} }], () => 'x'), null, 'first entry must be a tab root');
});

test('App API route ops go to the injected engine hooks; without them they are unavailable', async () => {
  const seen = [];
  const api = createAppApi({ getStore: () => ({ getState: () => ({}) }), route: {
    save: a => { seen.push(['save', a]); return { ok: true }; },
    plan: a => ({ ok: true, stack: [], bodies: [], deepLink: a.deepLink }),
    deepLink: a => ({ ok: a.cardKey === 'k' }),
    enter: a => ({ ok: true, bodies: [], kind: a.kind }),
    resync: () => ({ ok: true }),
  } });
  assert.deepEqual(api.call('route.save', { stack: [] }), { ok: true });
  assert.equal(api.call('route.plan', { deepLink: true }).deepLink, true);
  assert.equal(api.call('deeplink.reminder', { cardKey: 'k' }).ok, true);
  assert.equal(api.call('stage.enter', { kind: 'pop' }).kind, 'pop');
  assert.equal(seen.length, 1);
  const bare = createAppApi({});
  assert.equal(bare.call('route.plan', {}).error.kind, 'unavailable');
});

test('engine mode only inside the iOS app: app.js keeps mounting the web UI when __shiziEngine is not injected', () => {
  const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /engineRequested\(\) \? await import\('\.\/ui\/engine\.js'\)/);
  assert.match(app, /await mountRoot\(container\)/);
  const swift = readFileSync(new URL('../../ios/ShiziApp/ShiziApp/NativeStage.swift', import.meta.url), 'utf8');
  assert.match(swift, /window\.__shiziEngine = true/);
});
