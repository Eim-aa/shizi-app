// 备份与恢复的纯逻辑 + 保护副本编排（02 M4-4；决定-D24；需求 R12 / O04；01 §3.6、§8.1、§9；04 R-B01–R-B07；
// 03 P26 / P32 / P53）。
//
// 本模块不碰 DOM / window / localStorage；需要写入的函数把 store 当参数传进来（依赖方向 ui → store → core，
// core 不 import store）。所有写入都走 store 的公开原语，且一律**不做预算回收**：
//   - 替换：store.replaceWithBackup（整单校验、不回收、失败回滚、成功后清 shizi.corrupt.*，01 §3.6）；
//   - 保护副本的写入与删除、撤销、清空：store.commit(label, mutate, {reclaim:false})（M3/M4 修复回合 I2）；
//   - 导出记账：普通 store.commit。
// 为什么不回收：store.commit 撞配额默认「先回收再重试」（01 §4 / §9）——强制回收会折叠旧月份、淘汰墨迹并用 writeOne
// 旁路写回。保护副本本身很大（一整份白名单数据），它撞配额时若回收，会在「没能换成备份」的同时悄悄折掉用户的旧记录，
// 与 R-B04「你现在的记录没有变」和 K03「全部 v2 键深相等」相违。reclaim:false 撞配额直接 {ok:false, kind:'quota'}。
//
// 进行中的组（P79）：替换备份 / 清空所有记录时结束正在进行的组——sessions.A / B 置 null，并一并清掉 lastEnded
// （M6-6：lastEnded 指向的记录可能已被替换 / 清掉，结果页不能再按它恢复；02 §8「M3/M4 遗留」），
// 原 sessions 随保护副本存进 payload['shizi.v2.sessions']，撤销时连同会话一起原样还原（K03 全部 v2 键深相等含 sessions）。
//
// 备份文件（01 §3.6）：{app:'shizi', version:2, date:ISO, data:{'shizi.v2.<键>': JSON 字串}}，只含白名单键；
//   state.meta 缺失（迁移 M5-4 之前没人建 meta）时导出前补一份，保证 parseBackupV2 认得自己导出的文件。
// v1 备份文件（{app:'shizi', version:1, …}）：转换用 M5-4 迁移的同一套 convertV1（store/migrate.js legacyBackupToV2，严格模式），
//   由 store/migrate.js 在模块加载时经 setLegacyBackupImporter(fn) 注册（app.js 启动时已 import 它；依赖方向 ui → store → core，
//   本模块不反向 import store）。只加载 core 而没加载迁移模块时 importLegacyBackup 返回 {ok:false, reason:'v1-unsupported'}。

import {
  APP_ID, BACKUP_VERSION, BACKUP_WHITELIST, DOMAINS, KEYS, SCHEMA_VERSION,
  isBackupKey, isLocalDay, isMonthKey, isMonthlyDomain, isPlainObject, keyForDomain, monthOfKey,
  parseBackupV2, specForKey,
} from './schema.js';
import { localDay } from './dates.js';
import { t } from '../config/copy/index.js';

/** 备份文件大小上限（字节）：与 iOS 原生预检同口径（01 §8.1、M5-3「>10MB 显示 R-B06 文案」）。 */
export const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
/** shizi.v2.safety 的 version 字段（01 §9 保护副本形状）。 */
export const SAFETY_VERSION = 2;

/** store 提交 / 写入的 label（写日志与 txn 里可辨认）。 */
export const LABELS = Object.freeze({
  safety: 'backup:safety',
  safetyDrop: 'backup:safety-drop',
  restore: 'backup:restore',
  clear: 'backup:clear',
  undo: 'backup:undo',
  exported: 'backup:exported',
});

/** 恢复 / 撤销等失败的阶段（界面按它选文案）。 */
export const STAGES = Object.freeze({ safety: 'safety', replace: 'replace', clear: 'clear', undo: 'undo' });

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// ---------------------------------------------------------------- 记录口径（「记录」= judged，01 §3.2）

function monthList(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && value.folded === true && Array.isArray(value.kept)) return value.kept;
  return [];
}

function isFoldedMonth(value) {
  return isPlainObject(value) && value.folded === true;
}

/** records 域（按月）里有 judged 记录的字（含折叠月的 chars 与 kept）。 */
export function judgedCharsOf(recordsDomain) {
  const out = new Set();
  const months = isPlainObject(recordsDomain) ? recordsDomain : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    if (isFoldedMonth(value) && Array.isArray(value.chars)) for (const c of value.chars) if (typeof c === 'string') out.add(c);
    for (const r of monthList(value)) if (r && r.kind === 'judged' && typeof r.char === 'string') out.add(r.char);
  }
  return out;
}

/** 有 judged 记录的本地日（升序去重；含折叠月的 byDay）。 */
export function judgedDaysOf(recordsDomain) {
  const days = new Set();
  const months = isPlainObject(recordsDomain) ? recordsDomain : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    if (isFoldedMonth(value) && isPlainObject(value.byDay)) {
      for (const day of Object.keys(value.byDay)) if (isLocalDay(day)) days.add(day);
    }
    for (const r of monthList(value)) if (r && r.kind === 'judged' && isLocalDay(r.localDay)) days.add(r.localDay);
  }
  return [...days].sort();
}

/**
 * 「现在的记录」的签名（K02 状态句：备份以后记录有没有改动）。原型 expSig 只看 judged 记录（id + 判断）；
 * 这里同口径：每条 judged 记录的 id 与判断（更正改判断即算改动），折叠月按月份 + 字数 + kept。
 * 返回 `${judged 条数}:${FNV-1a 32 位十六进制}`；没有记录为 '0:811c9dc5'。
 */
export function recordsSignature(recordsDomain) {
  const months = isPlainObject(recordsDomain) ? Object.keys(recordsDomain).sort() : [];
  let count = 0;
  let hash = 0x811c9dc5;
  const feed = text => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const month of months) {
    const value = recordsDomain[month];
    if (isFoldedMonth(value)) feed(`F${month}:${Array.isArray(value.chars) ? value.chars.length : 0};`);
    for (const r of monthList(value)) {
      if (!r || r.kind !== 'judged') continue;
      count += 1;
      feed(`${r.id}${r.judgment === 'wrong' ? 'W' : 'R'};`);
    }
  }
  return `${count}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------- 状态 → 备份条目 / 文件

/**
 * 状态里的白名单键 → [[key, JSON 字串]]（空月份、null 域不出现；与 store 落盘规则一致）。
 * @param {object} state  store 状态（getState() 或其 JSON 拷贝）
 */
export function backupEntries(state) {
  const out = [];
  const s = state || {};
  for (const domain of BACKUP_WHITELIST) {
    const value = s[domain];
    if (isMonthlyDomain(domain)) {
      const months = isPlainObject(value) ? Object.keys(value).sort() : [];
      for (const month of months) {
        const v = value[month];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (isPlainObject(v) && v.folded !== true && Object.keys(v).length === 0) continue;
        out.push([keyForDomain(domain, month), JSON.stringify(v)]);
      }
    } else if (value !== null && value !== undefined) {
      out.push([keyForDomain(domain), JSON.stringify(value)]);
    }
  }
  return out;
}

/** 非空的 records 月份（升序）。 */
function recordMonths(state) {
  const records = state && isPlainObject(state.records) ? state.records : {};
  return Object.keys(records).filter(m => isMonthKey(m) && monthList(records[m]).length + (isFoldedMonth(records[m]) ? 1 : 0) > 0).sort();
}

/**
 * v2 备份文件对象。state.meta 缺失时补一份 {schema:2, serial, createdAt, months}（serial 取 opts.serial，缺省 0）。
 * @param {object} state
 * @param {{now:number, serial?:number}} opts
 */
export function buildBackupV2(state, { now, serial = 0 } = {}) {
  const at = Number.isFinite(now) ? now : Date.now();
  const data = {};
  for (const [key, raw] of backupEntries(state)) data[key] = raw;
  if (!hasOwn(data, KEYS.meta)) {
    data[KEYS.meta] = JSON.stringify({
      schema: SCHEMA_VERSION,
      serial: Number.isInteger(serial) && serial >= 0 ? serial : 0,
      createdAt: at,
      months: recordMonths(state),
    });
  }
  return { app: APP_ID, version: BACKUP_VERSION, date: new Date(at).toISOString(), data };
}

/** 文件文本（沿旧版 JSON.stringify(…, null, 1)）。 */
export function serializeBackup(obj) {
  return JSON.stringify(obj, null, 1);
}

/**
 * 文件名「拾字备份-YYYY-MM-DD.json」（日期取本地日；Q2-7，03 P182：用户在「文件」里认得出哪份是备份，不带 UUID / 英文前缀）。
 * 原生壳分享时用同一个名字（WebViewController.temporaryShareURL 放进各自独立的临时目录，同名冲突才加序号）。
 */
export function backupFileName(now) {
  return t('X-BACKUP.fileName', { ymd: localDay(Number.isFinite(now) ? now : Date.now()) });
}

// ---------------------------------------------------------------- v1 备份文件（M5-4 接入）

let legacyImporter = null;

/**
 * v1 → v2 的备份转换器（store/migrate.js 注册 legacyBackupToV2）：fn(obj, opts) → {ok:true, backup:{app:'shizi', version:2, date, data},
 * report} | {ok:false, reason, key?}。传 null 取消。
 */
export function setLegacyBackupImporter(fn) {
  legacyImporter = typeof fn === 'function' ? fn : null;
}

/**
 * v1 备份（{app:'shizi', version:1, date, data}）→ v2 备份对象 + 导入报告（M5-4；01 §12，转换规则见 store/migrate.js）。
 * 失败原因：json / format / shape（key：哪个 v1 键坏了）/ value / empty / v1-failed；转换器未注册 → v1-unsupported。
 * @param {string|object} input  文件文本或已解析对象
 * @param {{now?:number}} [opts]  导入时刻（legacy.importedAt；缺省 Date.now()）
 * @returns {{ok:true, backup:object, report:object|null} | {ok:false, reason:string, key?:string, detail?:string}}
 */
export function importLegacyBackup(input, opts = {}) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch (error) {
      return { ok: false, reason: 'json' };
    }
  }
  if (!isPlainObject(obj) || obj.app !== APP_ID || obj.version !== 1 || !isPlainObject(obj.data)) return { ok: false, reason: 'format' };
  if (!legacyImporter) return { ok: false, reason: 'v1-unsupported' };
  let result;
  try {
    result = legacyImporter(obj, opts || {});
  } catch (error) {
    return { ok: false, reason: 'v1-failed', detail: error && error.message ? error.message : String(error) };
  }
  if (!result || result.ok !== true || !isPlainObject(result.backup)) {
    const out = { ok: false, reason: (result && result.reason) || 'v1-failed' };
    if (result && typeof result.key === 'string') out.key = result.key;
    return out;
  }
  return { ok: true, backup: result.backup, report: isPlainObject(result.report) ? result.report : null };
}

// ---------------------------------------------------------------- 导入校验报告

/**
 * 失败原因 → 界面口径（R-B06）：
 *   notBackup      不是 JSON / 不是拾字的外壳 / 过大（原生预检 tooLarge、invalid 同口径）
 *   restoreFailed  是拾字的备份但坏了（半坏：某个键形状不对、缺 meta、截断的 JSON 里带拾字外壳）、版本不认识、v1 暂不能导入
 */
export function failureKind(reason) {
  return reason === 'json' || reason === 'format' || reason === 'tooLarge' || reason === 'invalid'
    ? 'notBackup'
    : 'restoreFailed';
}

function daysOfIso(iso) {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localDay(t) : null;
}

/** entries（[[key, raw]]，已通过形状校验）→ 状态片段（只含白名单域）。 */
export function stateOfEntries(entries) {
  const out = { records: {}, ink: {} };
  for (const [key, raw] of entries) {
    const spec = specForKey(key);
    if (!spec || !spec.domain) continue;
    const value = JSON.parse(raw);
    if (isMonthlyDomain(spec.domain)) out[spec.domain][monthOfKey(key)] = value;
    else out[spec.domain] = value;
  }
  return out;
}

/**
 * 校验一份备份文件（文本或已解析对象）并给出报告。不触碰存储。
 * @param {string|object} input
 * @param {{maxBytes?:number}} [opts]
 * @returns {{ok:true, version:number, backup:object, entries:[string,string][], ignored:string[], day:string|null,
 *            count:number, days:string[], latestDay:string|null, fromLegacy:boolean}
 *          | {ok:false, reason:string, kind:'notBackup'|'restoreFailed', key?:string, detail?:string}}
 */
export function inspectBackup(input, { maxBytes = BACKUP_MAX_BYTES } = {}) {
  const bad = (reason, extra) => Object.assign({ ok: false, reason, kind: failureKind(reason) }, extra || {});
  let obj = input;
  if (typeof input === 'string') {
    if (input.length > maxBytes || byteLength(input) > maxBytes) return bad('tooLarge');
    try {
      obj = JSON.parse(input);
    } catch (error) {
      // 截断 / 半写的文件：带拾字外壳的按「坏了的备份」，否则「不是拾字的备份」。
      return /"app"\s*:\s*"shizi"/.test(input) ? bad('damaged') : bad('json');
    }
  }
  if (!isPlainObject(obj) || obj.app !== APP_ID || !isPlainObject(obj.data)) return bad('format');
  let fromLegacy = false;
  if (obj.version === 1) {
    const legacy = importLegacyBackup(obj);
    if (!legacy.ok) return bad(legacy.reason);
    obj = legacy.backup;
    fromLegacy = true;
  }
  const parsed = parseBackupV2(obj);
  if (!parsed.ok) return bad(parsed.reason, parsed.key ? { key: parsed.key, detail: parsed.detail || null } : null);
  const part = stateOfEntries(parsed.entries);
  const days = judgedDaysOf(part.records);
  const latestDay = days.length ? days[days.length - 1] : null;
  let day = daysOfIso(obj.date);
  if (!day) day = latestDay;
  if (!day && part.meta && Number.isFinite(part.meta.createdAt)) day = localDay(part.meta.createdAt);
  return {
    ok: true,
    version: obj.version,
    backup: obj,
    entries: parsed.entries,
    ignored: parsed.ignored,
    day,
    count: judgedCharsOf(part.records).size,
    days,
    latestDay,
    fromLegacy,
  };
}

function byteLength(text) {
  // UTF-8 字节数（与原生按文件大小预检同口径）；不依赖 TextEncoder 以便在任何环境跑。
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

// ---------------------------------------------------------------- 替换确认（R-B03 / 走查-K04 / P26）

/**
 * 替换会丢掉哪段日子（P26 / 走查-K04「9 月 2 日到 24 日的记录会丢失」）：现在的 judged 记录里、日期晚于备份日期的那些天。
 * 备份日期以后没有记录 → null。
 * @returns {{from:string, to:string, days:number}|null}
 */
export function lossRange(currentRecords, backupDay) {
  if (!isLocalDay(backupDay)) return null;
  const later = judgedDaysOf(currentRecords).filter(day => day > backupDay);
  if (!later.length) return null;
  return { from: later[0], to: later[later.length - 1], days: later.length };
}

/**
 * 确认框模型：有记录 → 替换措辞（标题「用备份替换现在的记录？」+ R-B03.replaceBody + 丢失范围）；
 * 没有记录（Y04）→「用这份备份恢复记录？」+ R-B03.restoreBody + 「恢复」。
 * @returns {{mode:'replace'|'restore', day, n, m, loss}}
 */
export function confirmModel(state, report, { showLoss = true } = {}) {
  const m = judgedCharsOf(state && state.records).size;
  return {
    mode: m > 0 ? 'replace' : 'restore',
    day: report.day,
    n: report.count,
    m,
    loss: m > 0 && showLoss ? lossRange(state && state.records, report.day) : null,
  };
}

// ---------------------------------------------------------------- 状态句（R-B02 / T07 / K02 / X03 / V07）

/**
 * 备份页顶部状态块的模型（文案键 + 变量，界面用 t() 取字）。
 *   date：{kind:'never'}（还没有备份）| {kind:'day', day}（上次备份 {date}）；替换 / 撤销不改这个日期（K02）。
 *   note：
 *     没有记录 → 有「清空」结论：R-B01.conclusionClear；有「替换」结论：结论 + R-B02.noRecords；否则 R-B02.noRecords
 *     有结论（撤销底栏还在，或失效后留下的 backupMeta.lastConclusion）→ 只写结论句（X03）
 *     从没备份 → 不写（N27）
 *     签名与上次导出一致 → R-B02.allBackedUp，否则 R-B02.changedSince
 * @param {object} state
 * @param {{conclusion?: {kind, date, count}|null}} [opts]  撤销底栏在时的结论（覆盖 backupMeta 里的）
 */
export function backupStatus(state, { conclusion: live = null } = {}) {
  const meta = state && isPlainObject(state.backupMeta) ? state.backupMeta : {};
  const count = judgedCharsOf(state && state.records).size;
  const hasRecords = count > 0;
  const exportedAt = Number.isFinite(meta.lastExportAt) ? meta.lastExportAt : null;
  const date = exportedAt === null ? { kind: 'never' } : { kind: 'day', day: localDay(exportedAt) };
  // 结论句（D24）：撤销底栏还在时用现场结论（live），失效后（离开这一页再进来）留下 backupMeta.lastConclusion，直到下次导出清掉；
  // 没有结论句时才按现在的记录和上次导出时间算。（Q2-8 曾让重进时一律重算，与 D24「撤销失效后留结论句」冲突，E9c 改回，03 P183。）
  const conclusion = live || (isPlainObject(meta.lastConclusion) ? meta.lastConclusion : null);
  const lines = [];
  if (!hasRecords) {
    if (conclusion && conclusion.kind === 'clear') lines.push({ key: 'R-B01.conclusionClear' });
    else {
      if (conclusion && conclusion.kind === 'restore') lines.push(restoreConclusion(conclusion));
      lines.push({ key: 'R-B02.noRecords' });
    }
  } else if (conclusion && conclusion.kind === 'restore') {
    lines.push(restoreConclusion(conclusion));
  } else if (exportedAt !== null) {
    const same = typeof meta.lastExportSig === 'string' && meta.lastExportSig === recordsSignature(state.records);
    lines.push({ key: same ? 'R-B02.allBackedUp' : 'R-B02.changedSince' });
  }
  return { date, lines, hasRecords, count, canExport: hasRecords, canClear: hasRecords };
}

function restoreConclusion(conclusion) {
  return { key: 'R-B01.conclusionRestore', vars: { day: conclusion.date || null, n: Number.isInteger(conclusion.count) ? conclusion.count : 0 } };
}

// ---------------------------------------------------------------- 保护副本（01 §9；R12 / 10.14 / O04；P32）

/**
 * 保护副本对象（schema validateSafety）：v2 白名单键的原始字串；state.sessions 存在时另带 payload['shizi.v2.sessions']
 * （替换 / 清空会结束进行中的组，撤销时还原，P79）。不含 v1 键、funnel、txn。
 * @param {object} state
 * @param {{kind:'restore'|'clear', now:number, backupDate?:string|null, count?:number}} o
 */
export function makeSafety(state, { kind, now, backupDate = null, count = 0 }) {
  const payload = {};
  for (const [key, raw] of backupEntries(state)) payload[key] = raw;
  if (state && isPlainObject(state.sessions)) payload[KEYS.sessions] = JSON.stringify(state.sessions);
  return {
    version: SAFETY_VERSION,
    kind,
    createdAt: Number.isFinite(now) ? now : Date.now(),
    backupDate: typeof backupDate === 'string' ? backupDate : null,
    count: Number.isInteger(count) && count >= 0 ? count : 0,
    payload,
  };
}

/**
 * 结束进行中的组（P79）：在 commit / replaceWithBackup 的草稿里把 sessions.A / B 置 null，lastEnded 一并清空
 * （M6-6：替换 / 清空后 lastEnded 指向的会话与记录已不在，结果页不再按它恢复）。sessions 域不存在时不建。
 */
export function endActiveSessions(draft) {
  if (!isPlainObject(draft.sessions)) return;
  const ended = draft.sessions.lastEnded;
  const noEnded = !isPlainObject(ended) || Object.keys(ended).length === 0;
  if (draft.sessions.A === null && draft.sessions.B === null && noEnded) return;
  draft.sessions = Object.assign({}, draft.sessions, { A: null, B: null, lastEnded: {} });
}

/** 状态里的保护副本（没有返回 null）。 */
export function safetyOf(state) {
  return state && isPlainObject(state.safety) && isPlainObject(state.safety.payload) ? state.safety : null;
}

/** 保护副本里的数据是否就是现在的数据（撤销已生效、只剩副本没删掉的情形）。 */
export function safetyMatchesCurrent(state) {
  const safety = safetyOf(state);
  if (!safety) return false;
  const now = backupEntries(state);
  const keys = Object.keys(safety.payload).filter(key => key !== KEYS.sessions);
  if (keys.length !== now.length) return false;
  for (const [key, raw] of now) if (safety.payload[key] !== raw) return false;
  return true;
}

/** 由保护副本推出的结论（撤销底栏在时的状态句）。restore 取备份日期与字数；clear 无日期。 */
export function conclusionOfSafety(safety, state) {
  if (!safety) return null;
  if (safety.kind === 'clear') return { kind: 'clear', date: null, count: 0 };
  const meta = state && isPlainObject(state.backupMeta) ? state.backupMeta : null;
  const stored = meta && isPlainObject(meta.lastConclusion) && meta.lastConclusion.kind === 'restore' ? meta.lastConclusion : null;
  return stored || { kind: 'restore', date: safety.backupDate || null, count: safety.count || 0 };
}

/**
 * 写若干域且不做预算回收（store.commit 的 reclaim:false，见文件头）。patch 里的域整体替换；其余域不动（未变的键不会被写）。
 * 通知带 replace:true（整体替换口径：持有本地现场的页面按新状态重取，与原先借 store.seed 时相同）。
 * @returns store 结果 {ok, keys} | {ok:false, error}
 */
export function writeDomains(store, patch, label) {
  for (const domain of Object.keys(patch)) {
    if (DOMAINS.indexOf(domain) < 0) throw new Error(`writeDomains: unknown domain ${domain}`);
  }
  return store.commit(label, draft => {
    for (const domain of Object.keys(patch)) {
      const value = patch[domain] === undefined ? null : patch[domain];
      draft[domain] = isMonthlyDomain(domain) && !isPlainObject(value) ? {} : value;
    }
  }, { reclaim: false, replace: true });
}

/** 写保护副本（写后 writeAll 逐键读回核对，storage.js 保证）。 */
export function writeSafety(store, safety) {
  return writeDomains(store, { safety }, LABELS.safety);
}

/** 删掉保护副本；没有副本时不写。 */
export function dropSafety(store) {
  if (!safetyOf(store.getState())) return { ok: true, keys: [] };
  return writeDomains(store, { safety: null }, LABELS.safetyDrop);
}

function errorOf(result) {
  return result && result.error ? result.error : { kind: 'unknown' };
}

/**
 * 用一份已校验的备份替换现在的记录（01 §9）：
 *   ① 写保护副本（失败 → {ok:false, stage:'safety'}，不替换，R-B04）；
 *   ② store.replaceWithBackup（失败已由 store 回滚 → 删副本 → {ok:false, stage:'replace'}，R-B06「没能恢复」）；
 *   ③ 成功 → {ok:true, conclusion}。
 * 备份文件里的 backupMeta 不采用：换成本机的上次备份时间与签名（K02「替换、撤销不改上次备份的日期」）+ 本次结论
 * （R-B01 结论句，离开备份页后仍显示；与替换同一次写入，不另等离开时再写）。
 * 备份文件里没有会话（01 §3.6：导入时忽略会话）；本机进行中的组随替换结束（A/B 置 null、lastEnded 清空，P79 / M6-6），
 * 原会话在保护副本里，撤销时还原。funnel 不动。
 * @param {object} store
 * @param {object} report  inspectBackup 的成功结果
 * @param {{now:number}} o
 */
export function restoreFromBackup(store, report, { now }) {
  const state = store.getState();
  const safety = makeSafety(state, { kind: 'restore', now, backupDate: report.day, count: report.count });
  const s = writeSafety(store, safety);
  if (!s.ok) return { ok: false, stage: STAGES.safety, error: errorOf(s) };
  const conclusion = { kind: 'restore', date: report.day || null, count: report.count };
  const cur = isPlainObject(state.backupMeta) ? state.backupMeta : {};
  const backupMeta = {
    lastExportAt: Number.isFinite(cur.lastExportAt) ? cur.lastExportAt : null,
    lastExportSig: typeof cur.lastExportSig === 'string' ? cur.lastExportSig : null,
    lastConclusion: conclusion,
  };
  const data = {};
  for (const [key, raw] of report.entries) data[key] = raw;
  data[KEYS.backupMeta] = JSON.stringify(backupMeta);
  const file = { app: APP_ID, version: BACKUP_VERSION, date: report.backup && report.backup.date, data };
  const r = store.replaceWithBackup(file, { label: LABELS.restore, mutate: endActiveSessions });
  if (!r.ok) {
    const drop = dropSafety(store);
    return { ok: false, stage: STAGES.replace, error: errorOf(r), safetyDropped: !!drop.ok };
  }
  return { ok: true, conclusion };
}

/**
 * 清空所有记录（R-B03 清空确认之后）：① 保护副本（失败 → stage 'safety'）；② 一次不回收的 commit 清掉
 * records / ink / sched / custom / wordOff / photos / legacy，保留 meta（序号）、settings、backupMeta（写入结论），
 * 并结束进行中的组（A/B 置 null、lastEnded 清空，P79 / M6-6；原会话在保护副本里，撤销时还原）；
 * 失败 → 删副本 → stage 'clear'。
 */
export function clearAllRecords(store, { now }) {
  const state = store.getState();
  const count = judgedCharsOf(state.records).size;
  const s = writeSafety(store, makeSafety(state, { kind: 'clear', now, backupDate: null, count }));
  if (!s.ok) return { ok: false, stage: STAGES.safety, error: errorOf(s) };
  const conclusion = { kind: 'clear', date: null, count };
  const r = store.commit(LABELS.clear, draft => {
    draft.records = {};
    draft.ink = {};
    draft.sched = null;
    draft.custom = null;
    draft.wordOff = null;
    draft.photos = null;
    draft.legacy = null;
    const cur = isPlainObject(draft.backupMeta) ? draft.backupMeta : {};
    draft.backupMeta = {
      lastExportAt: Number.isFinite(cur.lastExportAt) ? cur.lastExportAt : null,
      lastExportSig: typeof cur.lastExportSig === 'string' ? cur.lastExportSig : null,
      lastConclusion: conclusion,
    };
    endActiveSessions(draft);
  }, { reclaim: false, replace: true });
  if (!r.ok) {
    const drop = dropSafety(store);
    return { ok: false, stage: STAGES.clear, error: errorOf(r), safetyDropped: !!drop.ok };
  }
  return { ok: true, conclusion };
}

/**
 * 撤销（R-B01 / R-B05）：用副本 payload 原样写回全部白名单域（及副本里的 sessions，P79）并删副本——一次 writeAll（原子）。
 * 副本里没有 sessions（替换前本来就没有会话域）时会话不动。
 * 失败 → {ok:false}，副本保留，可以再点。没有副本 → {ok:false, error:{kind:'no-safety'}}。
 */
export function undoFromSafety(store) {
  const state = store.getState();
  const safety = safetyOf(state);
  if (!safety) return { ok: false, error: { kind: 'no-safety' } };
  const patch = { safety: null };
  for (const domain of BACKUP_WHITELIST) patch[domain] = isMonthlyDomain(domain) ? {} : null;
  for (const key of Object.keys(safety.payload)) {
    if (!isBackupKey(key)) continue;
    const spec = specForKey(key);
    const value = JSON.parse(safety.payload[key]);
    if (isMonthlyDomain(spec.domain)) patch[spec.domain][monthOfKey(key)] = value;
    else patch[spec.domain] = value;
  }
  if (hasOwn(safety.payload, KEYS.sessions)) patch.sessions = JSON.parse(safety.payload[KEYS.sessions]);
  const r = writeDomains(store, patch, LABELS.undo);
  return r.ok ? { ok: true, kind: safety.kind } : { ok: false, error: errorOf(r) };
}

/**
 * 导出完成后记账（R-B02）：lastExportAt / lastExportSig（导出那一刻的记录签名），并清掉上次替换 / 清空的结论
 * （原型「完成」→ bkLast=null）。
 * @param {{at:number, sig?:string}} o  sig 缺省按现在的记录算
 */
export function markExported(store, { at, sig = null }) {
  const state = store.getState();
  const signature = typeof sig === 'string' ? sig : recordsSignature(state.records);
  return store.commit(LABELS.exported, draft => {
    draft.backupMeta = { lastExportAt: at, lastExportSig: signature };
  });
}
