// 金标准 · 导航层（B4.9a：src/ui/route-memory.js、engine.js、paper-transition.js、native-session.js 的导航那一半 ↔ ShiziCore Navigation/）。
// 随机差分生成器（core-diff/domains/nav.mjs）的固定种子取样 + 手选的产品路径（首页纸展开进写字页 → 结果页 → 再写一组 / 离开、
// 字库普通推入、结果页让开给字详情 / 重写错字再回来、冷启动恢复 / 过期 / 深链压过恢复、重载截短）。依赖本地日的 op 在三个时区各出一组。
import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import navDomain from '../../core-diff/domains/nav.mjs';

const TZ_OPS = new Set(['nav.route.fresh', 'nav.route.plan', 'nav.route.guard', 'nav.route.validPrefix']);
const NOW = Date.UTC(2026, 9, 20, 2); // 上海 10-20 10:00
const NATIVE = ['home', 'library', 'mine', 'detail', 'library-list', 'about', 'records', 'session-none', 'query', 's02'];
const SRC = { rect: { x: 24, y: 520, w: 342, h: 52 }, label: '开始写字', radius: 12, solid: true };

function route(stack, at = NOW - 60000) {
  return JSON.stringify({ v: 1, at, stack });
}

function hand() {
  const R = [];
  const op = (name, args) => R.push({ op: name, args });
  // 冷启动判定：恢复 / 关 / 没存 / 阻断 / 坏值 / 深链 / 过期 / 跨 4 点 / 未知屏 / 页不合格
  const st = { sessions: { A: null, B: null, lastEnded: { A: { id: 's9', slot: 'A' } } }, custom: { added: [{ char: '尴', at: 1 }] }, photos: { 旧: { at: 1 } } };
  const ok = route([{ n: 'library', p: {} }, { n: 'detail', p: { char: '永' } }, { n: 'result', p: { slot: 'A', sessionId: 's9' } }]);
  op('nav.route.plan', { raw: ok, state: st, now: NOW });
  op('nav.route.plan', { raw: ok, state: st, now: NOW, routeRestore: { enabled: false } });
  op('nav.route.plan', { raw: null, state: st, now: NOW });
  op('nav.route.plan', { raw: ok, state: st, now: NOW, blocked: true });
  op('nav.route.plan', { raw: ok, state: st, now: NOW, corrupt: true });
  op('nav.route.plan', { raw: ok, state: st, now: NOW, deepLink: true });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }], NOW - 361 * 60000), state: st, now: NOW });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }], Date.UTC(2026, 9, 19, 19, 50)), state: st, now: Date.UTC(2026, 9, 19, 20, 10) });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }], Date.UTC(2026, 9, 19, 19, 50)), state: st, now: Date.UTC(2026, 9, 19, 20, 10), routeRestore: { enabled: true, maxAgeMinutes: 360, crossDay: true } });
  op('nav.route.plan', { raw: route([{ n: 'detail', p: { char: '永' } }]), state: st, now: NOW });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }, { n: 'mine', p: {} }]), state: st, now: NOW });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }, { n: 'nope', p: {} }]), state: st, now: NOW });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }, { n: 'write', p: { slot: 'A' } }]), state: st, now: NOW });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }, { n: 'session-none', p: {} }]), state: st, now: NOW });
  op('nav.route.plan', { raw: route([{ n: 'home', p: {} }, { n: 'detail', p: { char: '尴' } }, { n: 'detail-photo', p: { char: '旧' } }]), state: st, now: NOW });
  for (const [name, p] of [['write', { slot: 'B' }], ['result', { slot: 'A', sessionId: 's9' }], ['result', { slot: 'B', sessionId: 's9' }], ['detail', { char: '人口' }], ['detail', { char: '𠮷' }],
    ['detail-photo', { char: '旧' }], ['redo', {}], ['session-none', {}], ['about', {}]]) op('nav.route.guard', { name, p, state: st, now: NOW });
  op('nav.route.validPrefix', { stack: [{ id: 'n1', n: 'home', p: {} }, { id: 'n2', n: 'detail', p: { char: '永' } }, { id: 'n3', n: 'write', p: { slot: 'A' } }, { id: 'n4', n: 'about', p: {} }], state: st, now: NOW });
  op('nav.route.validPrefix', { stack: [{ id: 'n1', n: 'write', p: {} }], state: st, now: NOW });
  // 编解码
  op('nav.route.encode', { stack: [{ n: 'home', p: {} }], at: NOW + 0.5 });
  op('nav.route.encode', { stack: Array.from({ length: 17 }, () => ({ n: 'home', p: {} })), at: NOW });
  op('nav.route.encode', { stack: [{ n: 'x'.repeat(8200), p: {} }], at: NOW });
  op('nav.route.parse', { raw: ok });
  op('nav.route.parse', { raw: '{"v":1,"at":5,"stack":[{"n":"home","p":[]}]}' });
  op('nav.route.parse', { raw: '{"v":1,"at":5,"stack":[{"n":"home","p":{}}],"v":2}' });
  op('nav.route.fresh', { at: NOW, now: NOW + 360 * 60000 });
  op('nav.route.fresh', { at: NOW, now: NOW + 361 * 60000 });
  op('nav.route.stackOf', { snap: { stack: [{ k: 's', n: 'home', p: {} }, { k: 's', n: 'about' }, { k: 'o', n: 'x', p: {} }, { k: 's', n: 'y', p: {} }] } });
  // 场景：首页主按钮（纸展开）→ 写完换成结果页（带跳过撤销）→ 让开给字详情再回来 → 再写一组（普通推入）→ 离开回首页
  op('nav.scenario', { native: NATIVE, now: NOW, steps: [
    { do: 'start', stack: [{ n: 'home', p: {} }], cold: true }, { do: 'attach' },
    { do: 'mark', source: SRC, key: 'home-start' }, { do: 'openWrite', slot: 'A' },
    { do: 'write', fn: 'toResult', args: ['A', 's1', { recordId: 'r1', sessionId: 's1', remainingMs: 3000 }] },
    { do: 'result', fn: 'detail', args: ['永'] }, { do: 'enter', kind: 'pop', cause: 'native' },
    { do: 'result', fn: 'redo', args: [['永', '永', '人', 'a']] }, { do: 'write', fn: 'redoBack' },
    { do: 'overlay' }, { do: 'result', fn: 'again', args: [{ started: true }] },
    { do: 'live', key: 'home-start', live: { rect: { x: 24, y: 500, w: 342, h: 52 }, label: '继续写字' } }, { do: 'backPlan' },
    { do: 'write', fn: 'toResult', args: ['A', 's2', null] }, { do: 'result', fn: 'leave', args: [{ view: 'home' }] }, { do: 'deepLink' },
  ] });
  // 场景：字库「今日练习」普通推入、写字页「看这个字 ›」让开再回来、回字库；冷恢复后深链先静默回首页
  op('nav.scenario', { native: NATIVE, now: NOW, steps: [
    { do: 'start', stack: [{ id: 'n1', n: 'library', p: {} }, { id: 'n2', n: 'library-list', p: { kind: 'due' } }], cold: true }, { do: 'attach' },
    { do: 'deepLink' }, { do: 'tab', name: 'library' },
    { do: 'mark', source: { rect: { x: 0, y: 200, w: 390, h: 56 }, solid: false }, key: 'library-today' }, { do: 'openWrite', slot: 'A' },
    { do: 'write', fn: 'toDetail', args: ['A', '永'] }, { do: 'enter', kind: 'pop', cause: 'native' },
    { do: 'write', fn: 'back', args: ['A', { recordId: 'r1', sessionId: 's1', remainingMs: 2000 }] },
    { do: 'cover', entryId: 'e1', url: 'data:image/png;base64,x' }, { do: 'enter', kind: 'push', entry: { id: 'n9', n: 'about', p: {} } },
    { do: 'enter', kind: 'pop', cause: 'native' }, { do: 'hidden' }, { do: 'deepLink' },
  ] });
  // 场景：重写错字没有能练的字（退回去）、结果页「再写一组」没有字、写字页的跳过撤销过期、adopt 的序号
  op('nav.scenario', { native: NATIVE, now: NOW, steps: [
    { do: 'start', stack: [{ id: 'n1', n: 'home', p: {} }, { id: 'n2', n: 'result', p: { slot: 'B', sessionId: 's3' } }, { id: 'n3', n: 'detail', p: { char: '永' } }] },
    { do: 'enter', kind: 'pop', cause: 'native' }, { do: 'push', name: 'redo', params: { chars: ['a'] } },
    { do: 'result', fn: 'again', args: [{ empty: true, libraryExhausted: true }] }, { do: 'openWrite', slot: 'B' }, { do: 'openWrite', slot: 'B' },
    { do: 'write', fn: 'toResult', args: ['B', 's4', { recordId: 'r2', sessionId: 's4', remainingMs: -5 }] },
    { do: 'adopt', stack: [{ id: 'n1', n: 'home', p: {} }], seq: 0 }, { do: 'adopt', stack: [{ id: 'n1', n: 'home', p: {} }], seq: 9 },
    { do: 'leaveTo', leave: { view: 'library' } }, { do: 'params', patch: { a: 1 } }, { do: 'push', name: 'mine' }, { do: 'replace', name: 'home' },
  ] });
  return R;
}

/** 夹具里的 store 状态只留 guard 读的域（会话、自选、旧照片、每月前 3 条记录）：规则相同，夹具小。 */
function slim(args) {
  const st = args && args.state;
  if (!st || typeof st !== 'object' || Array.isArray(st)) return args;
  const out = {};
  for (const k of ['sessions', 'custom', 'photos']) if (k in st) out[k] = st[k];
  if (st.records && typeof st.records === 'object') {
    out.records = {};
    for (const m of Object.keys(st.records).slice(0, 2)) {
      const v = st.records[m];
      out.records[m] = Array.isArray(v) ? v.slice(0, 3) : v && Array.isArray(v.kept) ? { ...v, kept: v.kept.slice(0, 3), byDay: {} } : v;
    }
  }
  return { ...args, state: out };
}

function generated(seed, perOp) {
  const g = makeCtx(rng(seed));
  navDomain.prepare(g);
  const out = [];
  for (const [op, spec] of Object.entries(navDomain.ops)) {
    for (let i = 0; i < perOp; i += 1) out.push({ op, args: slim(JSON.parse(JSON.stringify(spec.args(g)))) });
  }
  return out;
}

export default {
  id: 'nav',
  source: 'src/ui/route-memory.js + src/ui/engine.js + src/ui/paper-transition.js + src/ui/screens/write/native-session.js',
  build({ withTZ, opCases }) {
    const all = [...hand(), ...generated(4901, 24)];
    const tz = [...hand(), ...generated(4908, 24)].filter(c => TZ_OPS.has(c.op));
    return {
      groups: [
        withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases(all) })),
        withTZ('America/New_York', () => ({ tz: 'America/New_York', cases: opCases(tz) })),
        withTZ('Australia/Lord_Howe', () => ({ tz: 'Australia/Lord_Howe', cases: opCases(tz) })),
      ],
    };
  },
};
