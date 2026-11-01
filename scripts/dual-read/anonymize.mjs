#!/usr/bin/env node
// 脱敏（B4.8 预备）：把负责人的真实数据（备份 JSON，或 App 的 SQLite 库副本）复制到 os.tmpdir()/shizi-dual-read-*，
// 只在副本上把「可能是个人内容的自由文字」换成同长度占位符；汉字、日期、调度数字、墨迹一律原样（它们正是要比的东西）。
//
// 会被替换的（只有这些）：
//   · 任何位置的图片数据（data:image/…;base64,…）——照片域 photos、v1 的 wild 抓拍、保护副本 safety.payload 里的拷贝：同长度占位；
//   · legacy.report 里所有字符串值（v1 导入报告，自由结构）：每个码元换成 x；键名与 fromKeys / days 保留。
// 其余（custom 的字、wordOff、settings、sessions、sched、ink、records）按形状表没有自由文字，不动。
//
// 只写临时文件夹，不改输入文件；不把任何记录内容打印到控制台（只打印计数）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseJson } from '../core-diff/lib/json-parse.mjs';
import { KEYS } from '../../src/core/schema.js';

const SQLITE_MAGIC = 'SQLite format 3\u0000';
const IMAGE_RE = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

/** 同长度（UTF-16 码元）占位。 */
const mask = (s) => 'x'.repeat(s.length);

function maskStrings(v, stats) {
  if (typeof v === 'string') {
    stats.strings += 1;
    return mask(v);
  }
  if (Array.isArray(v)) return v.map((x) => maskStrings(x, stats));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: maskStrings(v[k], stats), enumerable: true, configurable: true, writable: true });
    return o;
  }
  return v;
}

/** 一个键的原始字串 → 脱敏后的原始字串（不是 JSON 或没有可替换内容就原样返回）。 */
export function anonymizeRaw(key, raw, stats) {
  let out = raw;
  if (key === KEYS.legacy) {
    try {
      const o = parseJson(raw);
      if (o && typeof o === 'object' && o.report !== undefined) {
        out = JSON.stringify({ ...o, report: maskStrings(o.report, stats) });
      }
    } catch {
      /* 坏 JSON：只走图片替换 */
    }
  } else if (key === KEYS.safety) {
    try {
      const o = parseJson(raw);
      if (o && o.payload && typeof o.payload === 'object') {
        const payload = {};
        for (const k of Object.keys(o.payload)) payload[k] = typeof o.payload[k] === 'string' ? anonymizeRaw(k, o.payload[k], stats) : o.payload[k];
        out = JSON.stringify({ ...o, payload });
      }
    } catch {
      /* 同上 */
    }
  }
  // 图片数据：字串里任意位置（含嵌套 JSON 字串）
  out = out.replace(IMAGE_RE, (m) => {
    stats.images += 1;
    const head = 'data:image/png;base64,';
    return m.length >= head.length ? head + 'A'.repeat(m.length - head.length) : 'data:image/' + 'x'.repeat(Math.max(0, m.length - 11));
  });
  return out;
}

// ---------------------------------------------------------------- SQLite 键 ↔ 行（= SQLiteKVStore.swift 的 SQLiteStoreSlot）

const SINGLE = new Set(['sched', 'sessions', 'settings']);
const DOCS = new Set(['meta', 'custom', 'wordOff', 'photos', 'legacy', 'backupMeta', 'funnel', 'safety']);

export function keyOfRow(table, a, b) {
  switch (table) {
    case 'records': return `shizi.v2.records.${a}`;
    case 'ink': return `shizi.v2.ink.${a}`;
    case 'ink_records': return `shizi.v2.ink.${a}.${b}`;
    case 'docs': return `shizi.v2.${a}`;
    case 'aux': return a;
    default: return `shizi.v2.${table}`; // sched / sessions / settings
  }
}

/** 键 → 行位置（与 Swift 同一规则）；不是本 App 的键返回 null。 */
export function slotOfKey(key) {
  if (!key.startsWith('shizi.') || Buffer.byteLength(key) > 512 || key.includes('\u0000')) return null;
  const month = (s) => /^\d{4}-\d{2}$/.test(s);
  const rid = (s) => /^r[1-9]\d{0,18}$/.test(s);
  if (key.startsWith('shizi.v2.')) {
    const rest = key.slice('shizi.v2.'.length);
    for (const table of ['records', 'ink']) {
      if (rest.startsWith(table + '.')) {
        const m = rest.slice(table.length + 1);
        if (month(m)) return { table, a: m };
        if (table === 'ink' && m.length > 8 && month(m.slice(0, 7)) && m[7] === '.' && rid(m.slice(8))) return { table: 'ink_records', a: m.slice(0, 7), b: m.slice(8) };
      }
    }
    if (SINGLE.has(rest)) return { table: rest };
    if (DOCS.has(rest)) return { table: 'docs', a: rest };
  }
  return { table: 'aux', a: key };
}

export function readRows(db) {
  const disk = {};
  const q = (sql) => db.prepare(sql).all();
  for (const t of ['records', 'ink']) for (const r of q(`SELECT month, body FROM ${t}`)) disk[keyOfRow(t, r.month)] = r.body;
  for (const r of q('SELECT month, id, body FROM ink_records')) disk[keyOfRow('ink_records', r.month, r.id)] = r.body;
  for (const t of SINGLE) for (const r of q(`SELECT body FROM ${t} WHERE id = 1`)) disk[keyOfRow(t)] = r.body;
  for (const r of q('SELECT name, body FROM docs')) disk[keyOfRow('docs', r.name)] = r.body;
  for (const r of q('SELECT key, body FROM aux')) disk[r.key] = r.body;
  return disk;
}

/** 键值表 → 新建一个 App 同结构（schema 2）的 SQLite 库（自测夹具用）。 */
export function writeSqlite(file, disk, nowMs = 0) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=DELETE');
  for (const t of ['records', 'ink']) db.exec(`CREATE TABLE ${t} (month TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  for (const t of [...SINGLE].sort()) db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  db.exec('CREATE TABLE docs (name TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  db.exec('CREATE TABLE aux (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  db.exec('CREATE TABLE store_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  db.exec('CREATE TABLE ink_records (month TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (month, id))');
  db.exec('PRAGMA user_version = 2');
  const ins = {
    records: db.prepare('INSERT INTO records (month, body, updated_at) VALUES (?, ?, ?)'),
    ink: db.prepare('INSERT INTO ink (month, body, updated_at) VALUES (?, ?, ?)'),
    ink_records: db.prepare('INSERT INTO ink_records (month, id, body, updated_at) VALUES (?, ?, ?, ?)'),
    docs: db.prepare('INSERT INTO docs (name, body, updated_at) VALUES (?, ?, ?)'),
    aux: db.prepare('INSERT INTO aux (key, body, updated_at) VALUES (?, ?, ?)'),
  };
  for (const t of SINGLE) ins[t] = db.prepare(`INSERT INTO ${t} (id, body, updated_at) VALUES (1, ?, ?)`);
  for (const [key, body] of Object.entries(disk)) {
    const s = slotOfKey(key);
    if (!s) continue;
    if (s.table === 'ink_records') ins.ink_records.run(s.a, s.b, body, nowMs);
    else if (SINGLE.has(s.table)) ins[s.table].run(body, nowMs);
    else ins[s.table].run(s.a, body, nowMs);
  }
  db.close();
}

// ---------------------------------------------------------------- 入口

/** 输入文件的类型：'sqlite' | 'backup'（其余抛错）。 */
export function sniff(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    if (buf.toString('latin1') === SQLITE_MAGIC) return 'sqlite';
  } finally {
    fs.closeSync(fd);
  }
  return 'backup';
}

/**
 * 脱敏副本。
 * @returns {{kind: 'sqlite'|'backup', dir: string, file: string, stats: {images:number, strings:number, keys:number}}}
 *   file = 临时文件夹里的副本路径；backup 副本是脱敏后的备份文本。
 */
export function anonymize(input) {
  if (!fs.existsSync(input)) throw new Error('找不到输入文件');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-dual-read-'));
  fs.chmodSync(dir, 0o700);
  const stats = { images: 0, strings: 0, keys: 0 };
  const kind = sniff(input);
  if (kind === 'sqlite') {
    const file = path.join(dir, 'store.sqlite');
    fs.copyFileSync(input, file);
    for (const suffix of ['-wal', '-shm']) if (fs.existsSync(input + suffix)) fs.copyFileSync(input + suffix, file + suffix);
    const db = new DatabaseSync(file);
    try {
      const upd = (table, col, keyOf, sql) => {
        const rows = db.prepare(`SELECT ${col}, body FROM ${table}`).all();
        const set = db.prepare(sql);
        for (const r of rows) {
          const next = anonymizeRaw(keyOf(r), r.body, stats);
          if (next !== r.body) {
            set.run(next, r[col]);
            stats.keys += 1;
          }
        }
      };
      upd('docs', 'name', (r) => `shizi.v2.${r.name}`, 'UPDATE docs SET body = ? WHERE name = ?');
      upd('aux', 'key', (r) => r.key, 'UPDATE aux SET body = ? WHERE key = ?');
    } finally {
      db.close();
    }
    return { kind, dir, file, stats };
  }
  const text = fs.readFileSync(input, 'utf8');
  let obj;
  try {
    obj = parseJson(text);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('输入既不是 SQLite 库也不是备份 JSON');
  }
  if (!obj || typeof obj !== 'object' || !obj.data || typeof obj.data !== 'object') {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('备份文件缺少 data');
  }
  const data = {};
  for (const key of Object.keys(obj.data)) {
    const raw = obj.data[key];
    const next = typeof raw === 'string' ? anonymizeRaw(key, raw, stats) : raw;
    if (next !== raw) stats.keys += 1;
    Object.defineProperty(data, key, { value: next, enumerable: true, configurable: true, writable: true });
  }
  const file = path.join(dir, 'backup.json');
  fs.writeFileSync(file, JSON.stringify({ ...obj, data }, null, 1), { mode: 0o600 });
  return { kind, dir, file, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const input = process.argv[2];
  if (!input) {
    console.log('用法：node scripts/dual-read/anonymize.mjs <备份.json | 库文件>');
    process.exit(2);
  }
  const r = anonymize(input);
  console.log(`脱敏副本：${r.file}（${r.kind}；替换图片 ${r.stats.images} 处、报告字串 ${r.stats.strings} 个，涉及 ${r.stats.keys} 个键）`);
}
