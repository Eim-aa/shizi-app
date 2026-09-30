// test/store 共用：内存 Storage（带故障注入）与 v2 状态夹具。
// 不以 .test.mjs 结尾，node --test 不会把它当测试文件跑。
import { setInk } from '../../src/store/store.js';

/**
 * 与 Web Storage 接口一致的内存实现。
 * 注入能力：
 *   quotaBytes            超过（键长+值长）×2 的总量时 setItem 抛 QuotaExceededError（DOMException code 22）
 *   failWhen(fn)          fn({op, key, value, count}) 返回 'quota' | 'security' | 'generic' | {corrupt: '值'} | falsy
 *                         —— {corrupt} 表示「静默写入别的值」（模拟读回不一致）
 *   interruptAfterWrites(k)  第 k 次成功写后「进程中断」：之后所有写都抛 Error('interrupted')
 *   failReads(kind)       getItem/key 抛错（kind 同上），模拟隐私模式 / 被禁用
 */
export class MemoryStorage {
  constructor({ quotaBytes = Infinity, initial = null } = {}) {
    this._map = new Map();
    this.quotaBytes = quotaBytes;
    this._failWhen = null;
    this._interruptAt = null;
    this._halted = false;
    this._readFailure = null;
    this.writeCount = 0;
    if (initial) for (const key of Object.keys(initial)) this._map.set(key, String(initial[key]));
  }

  get length() {
    this._checkRead();
    return this._map.size;
  }

  key(i) {
    this._checkRead();
    const keys = Array.from(this._map.keys());
    return i >= 0 && i < keys.length ? keys[i] : null;
  }

  getItem(key) {
    this._checkRead();
    key = String(key);
    return this._map.has(key) ? this._map.get(key) : null;
  }

  setItem(key, value) {
    key = String(key);
    value = String(value);
    const override = this._beforeWrite('set', key, value);
    if (override && Object.prototype.hasOwnProperty.call(override, 'corrupt')) value = String(override.corrupt);
    const used = this.usedBytes() - (this._map.has(key) ? (key.length + this._map.get(key).length) * 2 : 0);
    if (used + (key.length + value.length) * 2 > this.quotaBytes) throw makeError('quota');
    this._map.set(key, value);
    this._afterWrite();
  }

  removeItem(key) {
    key = String(key);
    this._beforeWrite('remove', key, null);
    this._map.delete(key);
    this._afterWrite();
  }

  clear() {
    this._beforeWrite('clear', '*', null);
    this._map.clear();
    this._afterWrite();
  }

  // ---- 注入

  failWhen(fn) {
    this._failWhen = fn;
    return this;
  }

  interruptAfterWrites(k) {
    this._interruptAt = this.writeCount + k;
    return this;
  }

  failReads(kind) {
    this._readFailure = kind || null;
    return this;
  }

  resume() {
    this._halted = false;
    this._interruptAt = null;
    this._failWhen = null;
    this._readFailure = null;
    return this;
  }

  // ---- 观察

  usedBytes() {
    let total = 0;
    for (const [k, v] of this._map) total += (k.length + v.length) * 2;
    return total;
  }

  snapshot() {
    const out = {};
    for (const key of Array.from(this._map.keys()).sort()) out[key] = this._map.get(key);
    return out;
  }

  clone() {
    return new MemoryStorage({ quotaBytes: this.quotaBytes, initial: this.snapshot() });
  }

  _checkRead() {
    if (this._readFailure) throw makeError(this._readFailure);
  }

  _beforeWrite(op, key, value) {
    if (this._halted) throw new Error('interrupted');
    if (this._readFailure === 'security') throw makeError('security');
    if (this._failWhen) {
      const verdict = this._failWhen({ op, key, value, count: this.writeCount + 1 });
      if (verdict && typeof verdict === 'object') return verdict;
      if (verdict) throw makeError(verdict);
    }
    return null;
  }

  _afterWrite() {
    this.writeCount += 1;
    if (this._interruptAt !== null && this.writeCount >= this._interruptAt) {
      this._interruptAt = null;
      this._halted = true;
    }
  }
}

export function makeError(kind) {
  if (kind === 'quota') return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  if (kind === 'security') return new DOMException('The operation is insecure.', 'SecurityError');
  return new Error(`generic failure (${kind})`);
}

// ---------------------------------------------------------------- 夹具

export const T0 = Date.parse('2026-09-15T09:00:00+08:00');

export function record(serial, char, { kind = 'judged', judgment = 'correct', day = '2026-09-15', session = 1, at = T0 + serial * 1000, extra = {} } = {}) {
  const rec = {
    id: `r${serial}`,
    cardKey: `base:${char}`,
    char,
    sessionId: `s${session}`,
    kind,
    at,
    localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false },
  };
  if (kind === 'judged') rec.judgment = judgment;
  return Object.assign(rec, extra);
}

export function inkEntry(points = 8, strokes = 3) {
  const s = [];
  for (let i = 0; i < strokes; i += 1) {
    const row = [];
    for (let j = 0; j < points; j += 1) row.push(100 + i * 10 + j, 200 + j, 100);
    s.push(row);
  }
  return { v: 2, c: 345, s };
}

export function session(serial, { slot = 'A', kind = 'daily', queue = ['base:人', 'base:口'], cursor = 0, items = [] } = {}) {
  return {
    id: `s${serial}`,
    slot,
    kind,
    source: { view: 'home' },
    queue,
    cursor,
    items,
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false },
    lastLine: null,
    startedAt: T0,
    startedDay: '2026-09-15',
    updatedAt: T0,
  };
}

/** 一份最小但各域齐全的 v2 状态。 */
export function baselineState() {
  return {
    meta: { schema: 2, serial: 3, createdAt: T0, months: ['2026-09'] },
    records: { '2026-09': [record(2, '人'), record(3, '口', { judgment: 'wrong' })] },
    sched: {
      'base:人': { fsrs: { s: 1, d: 5 }, due: '2026-09-18', lastJudgedAt: T0 },
      'base:口': { fsrs: { s: 1, d: 5 }, due: '2026-09-16', lastJudgedAt: T0 },
    },
    ink: { '2026-09': { r2: inkEntry() } }, // 按月分键：shizi.v2.ink.2026-09
    custom: { added: [{ char: '哈', at: T0 }] },
    wordOff: {},
    settings: { library: 'common', sound: true, large: false, appearance: 'auto' },
    photos: null,
    legacy: null,
    backupMeta: { lastExportAt: null, lastExportSig: null },
    sessions: { A: session(1, { cursor: 2, items: [{ cardKey: 'base:人', recordId: 'r2', kind: 'judged' }, { cardKey: 'base:口', recordId: 'r3', kind: 'judged' }] }), B: null, lastEnded: {} },
    funnel: null,
    safety: null,
  };
}

/** 典型「判断」提交：新增一条记录（10 月，新键）、更新 sched、写 ink、推进会话。 */
export function judgeMutation(char = '大') {
  return (draft, ctx) => {
    const id = ctx.nextId('r');
    const rec = record(Number(id.slice(1)), char, { day: '2026-10-02', at: ctx.now });
    const month = draft.records['2026-10'] || [];
    draft.records['2026-10'] = month.concat([rec]);
    draft.sched[`base:${char}`] = { fsrs: { s: 2, d: 4 }, due: '2026-10-05', lastJudgedAt: ctx.now };
    setInk(draft, rec, inkEntry());
    const A = draft.sessions.A;
    draft.sessions.A = Object.assign({}, A, {
      queue: A.queue.concat([`base:${char}`]),
      cursor: A.cursor + 1,
      items: A.items.concat([{ cardKey: `base:${char}`, recordId: id, kind: 'judged' }]),
      updatedAt: ctx.now,
    });
  };
}

export function allRecordIds(state) {
  const ids = [];
  for (const month of Object.keys(state.records || {})) {
    const value = state.records[month];
    const list = Array.isArray(value) ? value : value.kept;
    for (const rec of list) ids.push(rec.id);
  }
  return ids;
}

/** ink 域（{月: {id: Ink}}）摊平成 {id: Ink}，方便断言。 */
export function flatInk(ink) {
  const out = {};
  for (const month of Object.keys(ink || {})) Object.assign(out, ink[month]);
  return out;
}

export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
