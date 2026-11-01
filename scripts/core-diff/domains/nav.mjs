// 导航域（B4.9a；ShiziCore Navigation/ ↔ src/ui/route-memory.js / engine.js / paper-transition.js / native-session.js 的导航那一半）：
// 路由提示键的编解码与新鲜度、冷启动判定（RESTORE_GUARDS）、重载截短、导航镜像 + 宿主消息 + 来源记账 + 「去哪」规则的整串场景。
import { schedShapes } from '../lib/sched-shapes.mjs';
import { NAV_TABS, NAV_SUBS } from '../lib/js-ops-b49.mjs';

const ALL = [...NAV_TABS, ...NAV_SUBS];
const NATIVE = ['home', 'library', 'mine', 'detail', 'detail-photo', 'library-list', 'library-all', 'library-switch', 'about', 'about-privacy', 'records', 'month',
  'annual', 'backup', 'remind', 'session-none', 'query', 's02', 'block', 'image-preview'];
const CHARS = ['永', '人', '口', '拾', '静', '大', '一', '𠮷', 'a', '人口', ''];
const VIEWS = ['home', 'library', 'mine', 'allWritten', 'wrong', 'reminder', 'detail', null, 5];
const DAY = 86400000;
const BASE = Date.UTC(2026, 9, 20, 2); // 10-20 10:00（上海）
const GUARDS = ['write', 'result', 'detail', 'detail-photo', 'session-none', 'redo', 'about', 'home', 'hasOwnProperty'];

export default {
  id: 'nav',
  prepare(g) {
    const S = schedShapes(g.r);
    g.navNow = () => g.weighted([[() => BASE + g.int(-3, 30) * 3600000 + g.int(0, 59) * 60000, 6], [() => BASE + g.int(-40, 40) * DAY, 2], [() => g.pick([0, 1, -1, 1e12, 4102444800000]), 1]])();
    g.navParams = (n) => {
      if (n === 'write') return g.weighted([[() => ({ slot: g.pick(['A', 'B']) }), 6], [() => ({}), 1], [() => ({ slot: g.pick(['C', 5, null]) }), 1]])();
      if (n === 'result') return g.weighted([[() => ({ slot: g.pick(['A', 'B']), sessionId: 's' + g.int(1, 400) }), 5], [() => ({ slot: 'A' }), 1], [() => ({ sessionId: g.pick(['', 5, null]) }), 1]])();
      if (n === 'detail' || n === 'detail-photo') return { char: g.pick(CHARS) };
      if (n === 'redo') return { chars: Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS)) };
      if (n === 'library-list') return { kind: g.pick(['due', 'wrong', 'forget']) };
      if (n === 'session-none') return { exhausted: g.chance(0.5) };
      return g.chance(0.8) ? {} : { x: g.int(0, 3) };
    };
    g.navEntry = (tab, withId) => {
      const n = tab === true ? g.pick(NAV_TABS) : tab === false ? g.pick(NAV_SUBS) : g.pick(ALL.concat(['nope', '']));
      const e = { n, p: g.navParams(n) };
      if (withId) e.id = g.weighted([[() => 'n' + g.int(1, 30), 4], [() => 'e' + g.int(1, 30), 3], [() => '', 1], [() => 5, 1]])();
      return e;
    };
    g.navStack = (withId) => {
      const len = g.weighted([[() => g.int(1, 4), 8], [() => 0, 1], [() => g.int(5, 18), 1]])();
      const out = [];
      for (let i = 0; i < len; i += 1) out.push(g.chance(0.92) ? g.navEntry(i === 0, withId) : g.navEntry(null, withId));
      return out;
    };
    g.navState = () => {
      const s = S.state();
      const st = s.state;
      if (g.chance(0.3)) st.photos = Object.fromEntries(Array.from({ length: g.int(1, 3) }, () => [g.pick(CHARS), g.pick([{ at: 1 }, true, 0, null])]));
      if (g.chance(0.05)) st.sessions = g.pick([null, 5, 'x', { lastEnded: 'AB' }, { A: 5 }]);
      if (g.chance(0.05)) st.custom = g.pick([null, { added: 'x' }, { added: [null, { char: '永' }] }]);
      return { state: st, now: g.chance(0.7) ? s.nowAt : g.navNow() };
    };
    g.navRaw = () => g.weighted([
      [() => JSON.stringify({ v: 1, at: g.navNow(), stack: g.navStack(false) }), 8],
      [() => JSON.stringify({ v: g.pick([2, '1', null]), at: g.navNow(), stack: g.navStack(false) }), 1],
      [() => JSON.stringify({ v: 1, at: g.pick(['1', null, 1e400 === Infinity ? 'x' : 0]), stack: g.navStack(false) }), 1],
      [() => JSON.stringify({ v: 1, at: g.navNow(), stack: g.pick([[], {}, null, [5], [{ n: 'home' }], [{ n: '', p: {} }], [{ n: 'home', p: [] }]]) }), 1],
      [() => g.pick(['', '{', 'null', '[]', '5', '"x"', '{"v":1}', 'x'.repeat(8200)]), 1],
      [() => g.pick([null, 5, true, {}]), 0.5],
    ])();
    g.navSource = () => ({
      rect: g.weighted([[() => ({ x: g.int(0, 300), y: g.int(0, 700), w: g.int(1, 360), h: g.int(1, 80) }), 6], [() => ({ x: 0, y: 0, w: g.pick([0, -1, '5']), h: 44 }), 1]])(),
      ...(g.chance(0.8) ? { label: g.pick(['开始写字', '继续写字', '', 5]) } : {}),
      ...(g.chance(0.7) ? { radius: g.pick([12, 0, 22, null]) } : {}),
      ...(g.chance(0.6) ? { solid: g.pick([true, false, 0, 1]) } : {}),
    });
  },
  ops: {
    'nav.route.parse': { weight: 2, args: (g) => ({ raw: g.navRaw() }) },
    'nav.route.encode': { weight: 2, args: (g) => ({ stack: g.weighted([[() => g.navStack(false), 6], [() => g.pick([null, {}, 5, []]), 1], [() => [{ n: 'x'.repeat(9000), p: {} }], 0.3]])(), at: g.weighted([[() => g.navNow() + g.pick([0, 0.4, 0.5, -0.5, 0.6]), 6], [() => g.pick(['1', null, -0.5, 2.5]), 1]])() }) },
    'nav.route.fresh': {
      weight: 2,
      args: (g) => {
        const at = g.navNow();
        const a = { at: g.chance(0.9) ? at : g.pick(['1', null]), now: at + g.weighted([[() => g.int(0, 400) * 60000, 6], [() => -g.int(0, 400) * 60000, 2], [() => g.int(0, 3) * DAY, 1]])() };
        if (g.chance(0.2)) a.routeRestore = g.pick([{ enabled: true, maxAgeMinutes: 360, crossDay: true }, { maxAgeMinutes: '60' }, { maxAgeMinutes: null }, {}]);
        return a;
      },
    },
    'nav.route.stackOf': { weight: 1, args: (g) => ({ snap: g.weighted([[() => ({ stack: g.navStack(true).map(e => ({ k: g.chance(0.9) ? 's' : g.pick(['o', null]), ...e, ...(g.chance(0.1) ? { p: g.pick([null, 5, []]) } : {}) })) }), 6], [() => g.pick([null, {}, { stack: 5 }, { stack: [null, { k: 's' }] }]), 1]])() }) },
    'nav.route.plan': {
      weight: 5,
      args: (g) => {
        const { state, now } = g.navState();
        const route = { v: 1, at: now - g.weighted([[() => g.int(0, 300) * 60000, 6], [() => g.int(300, 800) * 60000, 1], [() => -g.int(0, 30) * 60000, 1]])(), stack: g.navStack(false) };
        const a = { raw: g.chance(0.9) ? JSON.stringify(route) : g.navRaw(), state, now };
        if (g.chance(0.1)) a.blocked = true;
        if (g.chance(0.1)) a.corrupt = true;
        if (g.chance(0.1)) a.deepLink = true;
        if (g.chance(0.05)) a.routeRestore = g.pick([{ enabled: false }, { enabled: true, maxAgeMinutes: 360, crossDay: true }]);
        return a;
      },
    },
    'nav.route.guard': {
      weight: 4,
      args: (g) => {
        const { state, now } = g.navState();
        const name = g.pick(GUARDS);
        let p = g.navParams(name);
        if (name === 'result' && g.chance(0.6)) {
          const slot = g.pick(['A', 'B']);
          const s = state.sessions && (g.chance(0.5) ? state.sessions[slot] : state.sessions.lastEnded && state.sessions.lastEnded[slot]);
          if (s && s.id) p = { slot, sessionId: s.id };
        }
        if (name === 'detail-photo' && state.photos && g.chance(0.6)) p = { char: g.pick(Object.keys(state.photos)) };
        if (g.chance(0.05)) p = g.pick([null, 5, []]);
        return { name, p, state: g.chance(0.95) ? state : g.pick([null, 5]), now };
      },
    },
    'nav.route.validPrefix': { weight: 2, args: (g) => { const { state, now } = g.navState(); return { stack: g.navStack(true), state, now }; } },
    'nav.scenario': {
      weight: 6,
      args: (g) => {
        const native = NATIVE.filter(() => g.chance(0.8));
        const steps = [{ do: 'start', stack: g.chance(0.85) ? g.navStack(true) : g.pick([[], null, [{ n: 'detail', p: {} }]]), cold: g.chance(0.5), silent: g.chance(0.1) }];
        let attached = false;
        const n = g.int(1, 26);
        for (let i = 0; i < n; i += 1) {
          const step = g.weighted([
            [() => ({ do: 'enter', kind: 'push', entry: { id: 'n' + g.int(1, 40), ...g.navEntry(false, false) } }), 4],
            [() => ({ do: 'enter', kind: 'pop', cause: g.pick(['native', 'native', 'ui', undefined]) }), 4],
            [() => ({ do: 'enter', kind: 'tab', entry: { id: 'n' + g.int(1, 40), n: g.pick(NAV_TABS), p: {} } }), 1.5],
            [() => ({ do: 'enter', kind: 'replace', entry: { id: 'n' + g.int(1, 40), ...g.navEntry(false, false) }, animate: g.chance(0.5) }), 1],
            [() => ({ do: 'enter', kind: 'params', patch: { sort: g.pick(['a', 'b']), x: g.int(0, 2) } }), 1],
            [() => ({ do: 'enter', kind: g.pick(['bogus', 'restore']) }), 0.3],
            [() => ({ do: 'push', name: g.pick(ALL.concat(['nope'])), params: g.navParams(g.pick(ALL)) }), 2],
            [() => ({ do: 'replace', name: g.pick(ALL), params: {}, animate: g.chance(0.5) }), 1],
            [() => ({ do: 'back', cause: g.pick(['ui', 'native', undefined]) }), 1.5],
            [() => ({ do: 'tab', name: g.pick(ALL) }), 1],
            [() => ({ do: 'params', patch: { k: g.int(0, 3) } }), 0.5],
            [() => ({ do: 'adopt', stack: g.navStack(true), seq: g.pick([undefined, 0, 1, 5, -1]) }), 1],
            [() => ({ do: 'mark', source: g.navSource(), key: g.pick(['home-start', 'other-line', 'library-today', null, '']) }), 2.5],
            [() => ({ do: 'overlay' }), 1],
            [() => ({ do: 'live', key: g.pick(['home-start', 'other-line', '']), live: g.chance(0.8) ? g.navSource() : null }), 1],
            [() => ({ do: 'forget' }), 0.5],
            [() => ({ do: 'cover', entryId: g.pick(['n' + g.int(1, 40), 'e' + g.int(1, 8), '', 5]), url: g.pick(['data:x', '', undefined]) }), 1],
            [() => ({ do: 'openWrite', slot: g.pick(['A', 'B', 'C']) }), 3],
            [() => ({ do: 'detail', char: g.pick(CHARS) }), 1.5],
            [() => ({ do: 'leaveTo', leave: { view: g.pick(VIEWS) } }), 1.5],
            [() => ({ do: 'write', fn: 'back', args: [g.pick(['A', 'B']), g.chance(0.5) ? { recordId: 'r1', sessionId: 's1', remainingMs: 3000 } : null] }), 1.5],
            [() => ({ do: 'write', fn: 'toResult', args: [g.pick(['A', 'B']), 's' + g.int(1, 3), g.chance(0.5) ? { recordId: g.pick(['r1', '']), sessionId: 's' + g.int(1, 3), remainingMs: g.pick([3000, -5]) } : null] }), 2],
            [() => ({ do: 'write', fn: 'toDetail', args: [g.pick(['A', 'B']), g.pick(CHARS)] }), 1.5],
            [() => ({ do: 'write', fn: 'redoBack', args: [] }), 0.7],
            [() => ({ do: 'result', fn: 'again', args: [g.pick([{ started: true }, { occupied: true }, { empty: true, libraryExhausted: g.chance(0.5) }, {}])] }), 1.5],
            [() => ({ do: 'result', fn: 'toWrite', args: [g.pick(['A', 'B'])] }), 1],
            [() => ({ do: 'result', fn: 'redo', args: [Array.from({ length: g.int(0, 4) }, () => g.pick(CHARS))] }), 1.5],
            [() => ({ do: 'result', fn: 'detail', args: [g.pick(CHARS)] }), 1],
            [() => ({ do: 'result', fn: 'leave', args: [{ view: g.pick(VIEWS) }] }), 1.5],
            [() => (attached ? { do: 'flush' } : (attached = true, { do: 'attach' })), 1.5],
            [() => ({ do: 'hidden' }), 0.7],
            [() => ({ do: 'flush' }), 0.5],
            [() => ({ do: 'deepLink' }), 1.5],
            [() => ({ do: 'backPlan' }), 1.5],
          ])();
          steps.push(step);
        }
        return { native, now: g.navNow(), steps };
      },
    },
  },
};
