// 形状表的值工厂与变异器（B4.1）：造出符合 src/core/schema.js 的合法值（随机可缺省字段、随机键序），再按需变异成非法值。
// 随机差分（domains/schema.mjs）与金标准（core-golden/domains/schema.mjs）共用。`g` 是 gen.mjs 的上下文（int / chance / pick / float / string）。
// 构造对象时键序默认取 JS 写入处的字面量序，以一定概率整体乱序（模型往返必须保住任何键序）。

export const MONTH_POOL = ['2026-09', '2026-10', '2025-01', '2024-02', '2026-02', '1999-12', '2100-02', '0099-12', '2026-13', '2026-00'];
const GOOD_CHARS = ['人', '口', '拾', '字', '一', '大', '𠮷', '龘', 'a', '1', '壹'];

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function shapes(g) {
  const S = {};

  /** 以 p 的概率把对象的键重排。 */
  S.maybeShuffle = (obj, p = 0.25) => {
    if (!g.chance(p)) return obj;
    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i > 0; i -= 1) {
      const j = g.int(0, i);
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    const out = {};
    for (const k of keys) out[k] = obj[k];
    return out;
  };
  S.opt = (obj, key, make, p = 0.5) => {
    if (g.chance(p)) obj[key] = make();
    return obj;
  };

  S.year = () => g.weighted([[() => g.int(2024, 2028), 6], [() => g.int(1000, 9999), 2], [() => g.int(0, 120), 1]])();
  S.month = () => `${pad(S.year(), 4)}-${pad(g.int(1, 12))}`;
  S.day = (month) => {
    if (month) return `${month}-${pad(g.int(1, 28))}`;
    const y = S.year();
    const m = g.int(1, 12);
    return `${pad(y, 4)}-${pad(m)}-${pad(g.int(1, 28))}`;
  };
  S.char = () => g.pick(GOOD_CHARS);
  S.cardKey = (ch) => `${g.chance(0.85) ? 'base' : 'custom'}:${ch || S.char()}`;
  S.recordId = (n) => `r${n ?? g.int(1, 999)}`;
  S.sessionId = (n) => `s${n ?? g.int(1, 99)}`;
  S.at = () => g.pick([1789000000000, 1790000000000, 1790000000123, 1.5e12 + 0.5, 0, -1, 1e15]);
  S.base64 = (n = g.int(0, 3)) => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let s = '';
    for (let i = 0; i < n * 4; i += 1) s += A[g.int(0, 63)];
    return s + g.pick(['', '', '', 'AA==', 'AAA=']);
  };
  S.packed = () => S.base64(g.int(2, 5)) || 'AAAAAAAA';

  S.help = () => S.maybeShuffle({ hints: g.pick([0, 0, 1, 2, 5, 64]), answerSeen: g.chance(0.3), traced: g.chance(0.3) });
  S.correction = () => S.maybeShuffle({ from: g.pick(['correct', 'wrong']), at: S.at() });

  /** 一条合法 Record（n = id 序号；month 给出时 localDay 落在该月）。 */
  S.record = (n, month) => {
    const ch = S.char();
    const kind = g.pick(['judged', 'judged', 'answer-seen', 'skipped']);
    const legacy = g.chance(0.08);
    const r = { id: S.recordId(n), cardKey: S.cardKey(ch), char: ch };
    if (!legacy || g.chance(0.5)) r.sessionId = S.sessionId();
    r.kind = kind;
    r.at = S.at();
    r.localDay = S.day(month);
    r.help = S.help();
    if (kind === 'judged') r.judgment = g.pick(['correct', 'wrong']);
    if (kind === 'judged' && g.chance(0.2)) r.corrections = Array.from({ length: g.int(0, 2) }, S.correction);
    const paper = kind === 'judged' && g.chance(0.15);
    if (paper) r.source = 'paper';
    else if (g.chance(0.1)) r.source = 'screen';
    if (!paper && g.chance(0.25)) r.inkId = S.recordId();
    if (legacy) r.legacy = true;
    return S.maybeShuffle(r);
  };

  S.recordsList = (month) => {
    const n = g.int(0, 4);
    let serial = g.int(1, 20);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(S.record(serial, month));
      serial += g.int(1, 5);
    }
    return out;
  };

  S.dayMap = (month) => {
    const o = {};
    const n = g.int(0, 3);
    for (let i = 0; i < n; i += 1) o[S.day(month)] = Array.from({ length: g.int(0, 3) }, S.char);
    return o;
  };
  S.folded = (month) => {
    const o = { folded: true, month, byDay: S.dayMap(month), chars: Array.from({ length: g.int(0, 4) }, S.char), kept: S.recordsList(month) };
    if (g.chance(0.4)) o.paperOnly = S.dayMap(month);
    return S.maybeShuffle(o);
  };
  S.recordsMonth = (month) => (g.chance(0.7) ? S.recordsList(month) : S.folded(month));

  S.meta = () => {
    const months = [...new Set(Array.from({ length: g.int(0, 4) }, () => S.month()))].sort();
    const o = { schema: 2, serial: g.int(0, 40), createdAt: S.at(), months };
    if (g.chance(0.3)) o.migratedAt = S.at();
    return S.maybeShuffle(o);
  };
  S.fsrs = () => g.pick([{ s: 1, d: 5 }, [1, 5, 0.9, 2], { stability: 2.5, difficulty: 4.3, state: 2 }, {}, []]);
  S.sched = () => {
    const o = {};
    for (let i = 0; i < g.int(0, 4); i += 1) {
      const e = { fsrs: S.fsrs(), due: g.chance(0.85) ? S.day() : null, lastJudgedAt: S.at() };
      if (g.chance(0.2)) e.stoppedAt = S.at();
      if (g.chance(0.2)) e.seenAgainDay = S.day();
      o[S.cardKey()] = S.maybeShuffle(e);
    }
    return o;
  };
  S.ink = () => {
    const v = g.pick([4, 4, 3, 2]);
    if (v === 4) {
      const n = g.int(0, 3);
      return S.maybeShuffle({ v: 4, c: 345, r: Array.from({ length: n }, S.packed), g: Array.from({ length: n }, () => g.int(0, 900)) });
    }
    if (v === 3) {
      const o = { v: 3, c: 345, s: Array.from({ length: g.int(0, 3) }, () => S.base64()) };
      if (g.chance(0.5)) o.p = Array.from({ length: g.int(0, 3) }, () => S.base64());
      return S.maybeShuffle(o);
    }
    const row = () => Array.from({ length: g.int(0, 4) }, () => g.int(-50, 500));
    const o = { v: 2, c: 345, s: Array.from({ length: g.int(0, 3) }, row) };
    if (g.chance(0.4)) o.dt = Array.from({ length: g.int(0, 2) }, row);
    if (g.chance(0.4)) o.p = Array.from({ length: g.int(0, 2) }, row);
    return S.maybeShuffle(o);
  };
  S.inkMonth = () => {
    const o = {};
    for (let i = 0; i < g.int(0, 3); i += 1) o[S.recordId()] = S.ink();
    return o;
  };
  S.custom = () => S.maybeShuffle({ added: Array.from({ length: g.int(0, 3) }, () => S.maybeShuffle({ char: S.char(), at: S.at() })) });
  S.wordOff = () => {
    const o = {};
    for (let i = 0; i < g.int(0, 3); i += 1) o[S.cardKey()] = S.at();
    return o;
  };
  S.settings = () => {
    const o = {};
    S.opt(o, 'library', () => g.pick(['core3500', 'common', 'all', 'x']));
    S.opt(o, 'sound', () => g.chance(0.5));
    S.opt(o, 'remind', () => {
      const r = {};
      S.opt(r, 'enabled', () => g.chance(0.5));
      S.opt(r, 'hour', () => g.int(0, 23));
      S.opt(r, 'minute', () => g.int(0, 59));
      S.opt(r, 'permission', () => g.pick(['granted', 'denied', 'default']));
      return S.maybeShuffle(r);
    }, 0.4);
    S.opt(o, 'remindInvite', () => {
      const r = {};
      S.opt(r, 'shown', () => g.int(0, 2));
      S.opt(r, 'last', () => S.sessionId());
      S.opt(r, 'answered', () => g.pick(['yes', 'no', 'denied']));
      return S.maybeShuffle(r);
    }, 0.3);
    S.opt(o, 'capitalDeferredDay', () => S.day(), 0.2);
    S.opt(o, 'returnSpreadFor', () => S.day(), 0.2);
    S.opt(o, 'writeMode', () => g.pick(['screen', 'paper']), 0.3);
    for (const k of ['paperSuggested', 'answerNoteSeen', 'shiHandoffDone', 'firstTipSeen', 'large']) S.opt(o, k, () => g.chance(0.5), 0.25);
    S.opt(o, 'appearance', () => g.pick(['auto', 'light', 'dark']), 0.4);
    S.opt(o, 'groupSize', () => g.pick([5, 10, 20, 30]), 0.4);
    return S.maybeShuffle(o);
  };
  S.photos = () => {
    const o = {};
    for (let i = 0; i < g.int(0, 2); i += 1) o[S.char()] = S.maybeShuffle({ day: S.day(), at: S.at(), dataURL: 'data:image/png;base64,' + S.base64() });
    return o;
  };
  S.legacy = () => S.maybeShuffle({ importedAt: S.at(), fromKeys: ['a', 'b'].slice(0, g.int(0, 2)), days: Array.from({ length: g.int(0, 3) }, () => S.day()), report: g.pick([{}, { ok: 1, skipped: ['x'] }]) });
  S.backupMeta = () => {
    const o = {};
    S.opt(o, 'lastExportAt', () => (g.chance(0.6) ? S.at() : null), 0.7);
    S.opt(o, 'lastExportSig', () => (g.chance(0.6) ? 'abc123' : null), 0.7);
    S.opt(o, 'lastConclusion', () => {
      if (g.chance(0.3)) return null;
      const c = { kind: g.pick(['restore', 'clear']), count: g.int(0, 99) };
      if (g.chance(0.6)) c.date = g.chance(0.8) ? '2026-09-15T01:00:00.000Z' : null;
      return S.maybeShuffle(c);
    }, 0.6);
    return S.maybeShuffle(o);
  };
  S.session = (slot) => {
    const kind = slot === 'A' ? g.pick(['first', 'daily']) : 'picked';
    const queue = Array.from({ length: g.int(0, 4) }, () => S.cardKey());
    const o = {
      id: S.sessionId(), slot, kind,
      source: S.maybeShuffle(g.chance(0.5) ? { view: g.pick(['home', 'library', 'detail']) } : { view: 'detail', char: S.char() }),
      queue, cursor: g.int(0, queue.length),
      items: Array.from({ length: g.int(0, 3) }, () => {
        const it = { cardKey: S.cardKey() };
        if (g.chance(0.7)) it.recordId = S.recordId();
        it.kind = g.pick(['judged', 'answer-seen', 'skipped']);
        if (g.chance(0.4)) it.fsrsBefore = S.fsrs();
        return S.maybeShuffle(it);
      }),
    };
    if (g.chance(0.5)) {
      const c = { phase: g.pick(['recall', 'compare', 'answer', 'trace', 'retrace']), strokes: Array.from({ length: g.int(0, 2) }, () => [[1, 2, 3], [4, 5]]) };
      S.opt(c, 'hints', () => g.int(0, 3), 0.4);
      S.opt(c, 'answerSeen', () => g.chance(0.3), 0.3);
      S.opt(c, 'hintRange', () => g.pick([null, [0, 2], { from: 0, to: 2 }]), 0.3);
      S.opt(c, 'referenceReady', () => g.chance(0.5), 0.3);
      S.opt(c, 'paper', () => g.chance(0.3), 0.2);
      o.current = S.maybeShuffle(c);
    } else if (g.chance(0.5)) o.current = null;
    if (g.chance(0.4)) o.lastLine = g.chance(0.2) ? null : S.maybeShuffle({ recordId: S.recordId(), kind: g.pick(['record', 'changed', 'saw']) });
    o.startedAt = S.at();
    o.startedDay = S.day();
    o.updatedAt = S.at();
    S.opt(o, 'endedAt', () => S.at(), 0.3);
    S.opt(o, 'endedEarly', () => g.chance(0.5), 0.2);
    S.opt(o, 'added', () => Array.from({ length: g.int(0, 2) }, () => S.recordId()), 0.2);
    S.opt(o, 'sealedAt', () => S.at(), 0.2);
    return S.maybeShuffle(o);
  };
  S.sessions = () => {
    const lastEnded = {};
    if (g.chance(0.5)) lastEnded.A = g.chance(0.4) ? null : S.session('A');
    if (g.chance(0.3)) lastEnded.B = g.chance(0.4) ? null : S.session('B');
    return S.maybeShuffle({ A: g.chance(0.6) ? S.session('A') : null, B: g.chance(0.3) ? S.session('B') : null, lastEnded: S.maybeShuffle(lastEnded) });
  };

  /** 白名单键 → 合法值（用于保护副本 payload 与备份外壳）。返回 [{key, value}]。 */
  S.backupEntries = () => {
    const out = [{ key: 'shizi.v2.meta', value: S.meta() }];
    for (let i = 0; i < g.int(0, 2); i += 1) {
      const m = S.month();
      out.push({ key: `shizi.v2.records.${m}`, value: S.recordsMonth(m) });
    }
    if (g.chance(0.6)) out.push({ key: 'shizi.v2.sched', value: S.sched() });
    if (g.chance(0.5)) out.push({ key: `shizi.v2.ink.${S.month()}`, value: S.inkMonth() });
    if (g.chance(0.4)) out.push({ key: 'shizi.v2.custom', value: S.custom() });
    if (g.chance(0.3)) out.push({ key: 'shizi.v2.wordOff', value: S.wordOff() });
    if (g.chance(0.5)) out.push({ key: 'shizi.v2.settings', value: S.settings() });
    if (g.chance(0.2)) out.push({ key: 'shizi.v2.photos', value: S.photos() });
    if (g.chance(0.2)) out.push({ key: 'shizi.v2.legacy', value: S.legacy() });
    if (g.chance(0.3)) out.push({ key: 'shizi.v2.backupMeta', value: S.backupMeta() });
    return out;
  };

  S.safety = () => {
    const o = { version: g.int(0, 3), kind: g.pick(['restore', 'clear']), createdAt: S.at() };
    S.opt(o, 'backupDate', () => (g.chance(0.7) ? '2026-09-15T01:00:00.000Z' : null), 0.6);
    S.opt(o, 'count', () => g.int(0, 99), 0.6);
    const payload = {};
    for (const e of S.backupEntries().slice(0, g.int(0, 3))) payload[e.key] = JSON.stringify(e.value);
    if (g.chance(0.4)) payload['shizi.v2.sessions'] = JSON.stringify(S.sessions());
    o.payload = payload;
    return S.maybeShuffle(o);
  };
  S.txn = () => {
    const keys = Array.from({ length: g.int(0, 3) }, (_, i) => `shizi.v2.k${i}`);
    const prev = {};
    for (const k of keys) prev[k] = g.chance(0.7) ? '{"a":1}' : null;
    return S.maybeShuffle({ label: g.pick(['judge', 'restore', '拾']), at: S.at(), keys, prev, phase: g.pick(['writing', 'done']) });
  };
  S.funnel = () => g.pick([{}, { a: 1, b: [1, 2], c: { d: null } }]);
  S.route = () => g.pick([{ v: 1, at: S.at(), stack: [{ n: 'home', p: {} }] }, {}]);

  /** key 种类 → {key, value}（合法）。 */
  S.forKind = (kind) => {
    switch (kind) {
      case 'meta': return { key: 'shizi.v2.meta', value: S.meta() };
      case 'records': { const m = S.month(); return { key: `shizi.v2.records.${m}`, value: S.recordsMonth(m) }; }
      case 'sched': return { key: 'shizi.v2.sched', value: S.sched() };
      case 'ink': return { key: `shizi.v2.ink.${S.month()}`, value: S.inkMonth() };
      case 'inkRecord': return { key: `shizi.v2.ink.${S.month()}.${S.recordId()}`, value: S.ink() };
      case 'custom': return { key: 'shizi.v2.custom', value: S.custom() };
      case 'wordOff': return { key: 'shizi.v2.wordOff', value: S.wordOff() };
      case 'settings': return { key: 'shizi.v2.settings', value: S.settings() };
      case 'photos': return { key: 'shizi.v2.photos', value: S.photos() };
      case 'legacy': return { key: 'shizi.v2.legacy', value: S.legacy() };
      case 'backupMeta': return { key: 'shizi.v2.backupMeta', value: S.backupMeta() };
      case 'sessions': return { key: 'shizi.v2.sessions', value: S.sessions() };
      case 'funnel': return { key: 'shizi.v2.funnel', value: S.funnel() };
      case 'safety': return { key: 'shizi.v2.safety', value: S.safety() };
      case 'txn': return { key: 'shizi.v2.txn', value: S.txn() };
      case 'route': return { key: 'shizi.v2.route', value: S.route() };
      default: throw new Error('unknown kind ' + kind);
    }
  };
  S.kinds = ['meta', 'records', 'sched', 'ink', 'inkRecord', 'custom', 'wordOff', 'settings', 'photos', 'legacy', 'backupMeta', 'sessions', 'funnel', 'safety', 'txn', 'route'];

  S.backupEnvelope = () => {
    const data = {};
    for (const e of S.backupEntries()) data[e.key] = JSON.stringify(e.value);
    if (g.chance(0.5)) data['shizi.v2.sessions'] = JSON.stringify(S.sessions());
    if (g.chance(0.2)) data['shizi.other'] = 'x';
    return S.maybeShuffle({ app: 'shizi', version: 2, date: '2026-09-15T01:00:00.000Z', data });
  };

  // ---------------------------------------------------------------- 变异

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const LEAVES = [null, true, false, 0, 1, -1, 1.5, 2, 3, 4, '', 'x', 'r1', 's1', 'base:人', '2026-09-01', '2026-13-01', '2026-02-30', '人', 'AA==', 'AAAAAAAA', [], {}, [1], { a: 1 }];
  const paths = (x, base = []) => {
    const out = [base];
    if (x && typeof x === 'object') for (const k of Object.keys(x)) out.push(...paths(x[k], [...base, k]));
    return out;
  };
  const at = (root, p) => p.reduce((o, k) => o[k], root);

  /** 在值上做 1–2 处随机破坏：换叶子 / 删键 / 加未知键 / 删数组项 / 换成别的类型 / 改字符串。 */
  S.mutate = (value) => {
    let v = clone(value);
    const times = g.chance(0.7) ? 1 : 2;
    for (let i = 0; i < times; i += 1) {
      const ps = paths(v);
      const p = g.pick(ps);
      const mode = g.int(0, 5);
      if (p.length === 0) {
        v = g.pick(LEAVES);
        continue;
      }
      const parent = at(v, p.slice(0, -1));
      const key = p[p.length - 1];
      if (mode === 0) parent[key] = clone(g.pick(LEAVES));
      else if (mode === 1) {
        if (Array.isArray(parent)) parent.splice(Number(key), 1);
        else delete parent[key];
      } else if (mode === 2) {
        const target = at(v, p);
        if (target && typeof target === 'object' && !Array.isArray(target)) Object.defineProperty(target, g.pick(['extra', 'v', 'kind', '__proto__', '0']), { value: clone(g.pick(LEAVES)), enumerable: true, configurable: true, writable: true });
        else parent[key] = clone(g.pick(LEAVES));
      } else if (mode === 3) {
        const target = at(v, p);
        if (typeof target === 'string') parent[key] = target + g.pick(['x', ' ', '1', '-']);
        else if (typeof target === 'number') parent[key] = g.pick([target + 1, -target - 1, target + 0.5, 1e21, -0]);
        else parent[key] = clone(g.pick(LEAVES));
      } else if (mode === 4) {
        const target = at(v, p);
        if (Array.isArray(target)) target.push(clone(g.pick(LEAVES)));
        else parent[key] = clone(g.pick(LEAVES));
      } else {
        const target = at(v, p);
        if (Array.isArray(target) && target.length > 1) target.reverse();
        else parent[key] = clone(g.pick(LEAVES));
      }
    }
    return v;
  };

  /** 合法值 / 变异值各一半。 */
  S.maybeBad = (value, pBad = 0.5) => (g.chance(pBad) ? S.mutate(value) : value);

  return S;
}
