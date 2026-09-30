// v1 → v2 一次性迁移与旧备份导入（02 M5-4；01 §12、§3.5 photos、§3.6 旧键处理、§4「迁移」写入点、§9；
// 03 P10 / P35 / P53 / P07；reference/A-storage.md §3 v1 键形状、B-scheduling.md；旧版 index.html 639f592 的 v1 读写）。
//
// 流程（bootMigration，app.js 在 store 建好后、挂 UI 前调用一次）：
//   已有 shizi.v2.meta → 不迁移；只做旧键回收（P53 回退窗口到期或导出过一次 v2 后删其余 v1 键；残留的 session / safety 大键即删）。
//   没有 meta 且有 shizi.memory.v1 → readV1（逐键 JSON 解析，坏键跳过并记入报告）→ convertV1（纯函数）→
//   **一次** store.commit(MIGRATION_LABEL, …, {reclaim:false, replace:true})：全部 v2 键一次 writeAll（storage.js 写入顺序里
//   meta 在数据键之后，sessions 不动），写前不做预算回收、撞配额直接失败（迁移失败时「旧数据完好」比回收更重要）。
//   成功 → 读回核对 shizi.v2.meta.migratedAt → 立即删 shizi.session.v1（含 ≤2MiB compositeImage）、shizi.safety.v1、
//   v1 时代的 shizi.corrupt.*（原键不是 shizi.v2.*）；其余 v1 键保留到回退窗口结束（P53）。
//   失败 → writeAll 已回滚：v1 键一个没动、没有 v2.meta；返回 {ok:false, error}，app.js 交给 R-B09 迁移变体（M5-6）；
//   下次启动 meta 仍不存在，自动重试。
//
// 转换规则（01 §12，逐条）：
//   FSRS：memory[key].fsrsCard → sched[key].fsrs（core/fsrs serializeCard 规整）；dueDay → due；pendingLearning 的字 due = 明天。
//   记录（fsrsReviewLog.events，≤120 天）：Good → judged correct（help.hints = hintCount，traced）；
//     Again & wrong → judged wrong；Again & dontKnow → answer-seen；Again & hinted & hintCount===0（旧「不太确定」）→ 不生成记录，
//     只计入 legacy.days 与报告；Again & hinted & hintCount>0 → P35 policy.migration.legacyHintedAs（过渡 'none'：不生成判断，
//     只留练习日与报告条数；'correct' / 'wrong' 为 P35 选项 B / C）。其他组合不猜，只记报告。
//   有 memory 无事件的字（seen>0 且事件里没有它）：P35 policy.migration.synthesizeFromMemory 为真时按 memory.lastOutcome / last /
//     lastHints / traced 合成一条 legacy 记录（fast/slow → correct/wrong；miss → answer-seen；hinted → 同上 P35）。
//     **加字残留**（旧版 addWord / 拍字的 recordRealWorldMiss 把 lastOutcome 改成 miss、last 改成加字时刻，但不写 FSRS 事件，
//     且留下 queuedFront）：不是一次练习（决定-D21 / D03），不据此合成；有 fsrsCard 时改用最后一次真实复习——
//     时刻 = fsrsCard.last_review，结果 = lastEpisode（independentlyRecovered → 写对，否则 firstOutcome）；从没练过（无 fsrsCard）不合成。
//   不变式 sched[key] 存在 ⇒ 该字至少一条 judged 记录：没有 judged 记录的字不迁 sched（按新字处理，报告 schedDropped）。
//   全部迁移记录带 legacy:true（没有会话、不能更正，01 §3.2），id 按时间先后分配（「最近一次」以 id 为准，01 §3.1）。
//   墨迹：memory.recentInk.strokes → 该字最近一次 correct 记录的 ink（v3 编码；仅 features.perRecordInk 开启时，P31）。
//   wild.captures → photos（沿旧预算：单张解码 ≤64KiB、≤30 张、合计 ≤420KiB，按新到旧保留；wishes 不迁）。
//   added → custom.added（缺失时按旧版由 custom 词推导）；quality.badWord / hide → wordOff；library（旧 id 映射沿用）→ settings.library；
//   sound.enabled → settings.sound，sound.scene 丢弃（P07 / #166）；reminder → settings.remind（保留 permission）；
//   fontScale → settings.large；backupMeta.lastExportAt 保留。
//   不迁：opens / streak、funnel 旧事件、tuning、quality 其余、session v3、deck 状态、pref、topic、traceTutorial、handCard。
//   activity.practiceDays（∪ 事件日 ∪ 已折叠月份 lastReviewByDay 的日子）→ legacy.days。
//   导入报告（各类条数、丢弃数、照片淘汰数）→ legacy.report；设备迁移另写一份摘要进 funnel.legacyImport。
//
// v1 备份文件（{app:'shizi', version:1, date, data}）：legacyBackupToV2 走同一个 convertV1（严格模式：任一已知键坏 → 整单拒绝），
// 产出 v2 备份对象交给 core/backup.js 的 inspectBackup / restoreFromBackup。本模块加载时通过 setLegacyBackupImporter 注册——
// 依赖方向 ui → store → core（01 §2），core/backup.js 不反向 import store；app.js 启动时已 import 本模块。
//
// 所有写入只经 store.commit 与 storage.js（删旧键用 storage.removeKeys）。

import * as defaultPolicy from '../config/policy.js';
import { LIBRARIES } from '../core/cards.js';
import { buildBackupV2, setLegacyBackupImporter } from '../core/backup.js';
import { addDays, localDay } from '../core/dates.js';
import { isCompactCard, serializeCard } from '../core/fsrs.js';
import { encodeInk, GRID, INK } from '../core/ink-math.js';
import {
  APP_ID, CORRUPT_PREFIX, HINTS_SHAPE_MAX, KEYS, SCHEMA_VERSION, V2_PREFIX,
  isLocalDay, isPlainObject, isSingleChar, monthOfDay,
} from '../core/schema.js';
import { now as envNow } from '../platform/env.js';
import { getStore } from './store.js';

// ---------------------------------------------------------------- v1 键（reference/A-storage.md §3.1，22 个）

export const V1_KEYS = Object.freeze({
  deck: 'shizi.deck.v8105.context2',
  opens: 'shizi.opens.v1',
  memory: 'shizi.memory.v1',
  quality: 'shizi.quality.v1',
  pref: 'shizi.pref.v1',
  tuning: 'shizi.tuning.v1',
  activity: 'shizi.activity.v1',
  session: 'shizi.session.v1',
  backupMeta: 'shizi.backupMeta.v1',
  reminder: 'shizi.reminder.v1',
  safety: 'shizi.safety.v1',
  fsrsLog: 'shizi.fsrsReviewLog.v1',
  traceTutorial: 'shizi.traceTutorial.v1',
  fontScale: 'shizi.fontScale.v1',
  funnel: 'shizi.funnel.v1',
  sound: 'shizi.sound.v1',
  topic: 'shizi.topic.v1',
  custom: 'shizi.custom.v1',
  added: 'shizi.added.v1',
  wild: 'shizi.wild.v1',
  handCard: 'shizi.handCard.v1',
  library: 'shizi.library.v1',
});

/** 导入成功后立即删除的旧大键（01 §3.6）。另删 v1 时代的 shizi.corrupt.*（见 legacyCorruptKeys）。 */
export const V1_BIG_KEYS = Object.freeze([V1_KEYS.session, V1_KEYS.safety]);
/** 检测 v1 数据用的键（01 §12「检测到 shizi.memory.v1 且无 shizi.v2.meta」）。 */
export const V1_DETECT_KEY = V1_KEYS.memory;
export const MIGRATION_LABEL = 'migrate:v1';
/** legacy.report 的版本（报告字段变了就加一）。 */
export const REPORT_VERSION = 1;

const NAME_OF_KEY = new Map(Object.keys(V1_KEYS).map(name => [V1_KEYS[name], name]));

// 旧版常量（index.html 639f592）
const FSRS_RAW_RETENTION_DAYS = 120; // L1205
const WILD_PHOTO_MAX = 30; // L2090
const WILD_PHOTO_BUDGET = 420 * 1024; // L2090（按 dataURL.length × 2 计）
const WILD_PHOTO_MAX_BYTES = 64 * 1024; // L2090（解码后字节）
const LEGACY_LIBRARY_IDS = Object.freeze({ primary: 'curriculum2500', junior: 'core3500', senior: 'adv3000' }); // L1128
const LIBRARY_IDS = LIBRARIES.map(lib => lib.id);
const HINTED_AS = ['none', 'correct', 'wrong'];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isCJK = ch => /[一-鿿]/.test(ch); // 旧版 isCJK（L2089）同口径
const finitePos = x => typeof x === 'number' && Number.isFinite(x) && x > 0;

// ---------------------------------------------------------------- 读 v1 键

/** 各键的容器形状（严格模式整单拒绝用；设备迁移时不合形状的键按缺失处理并记报告）。 */
const V1_SHAPES = {
  memory: v => isPlainObject(v) && Object.keys(v).every(k => isPlainObject(v[k])),
  quality: v => isPlainObject(v),
  activity: v => v === null || isPlainObject(v),
  backupMeta: v => v === null || isPlainObject(v),
  reminder: v => v === null || isPlainObject(v),
  sound: v => v === null || isPlainObject(v),
  fsrsLog: v => Array.isArray(v) || (isPlainObject(v) && Array.isArray(v.events)),
  fontScale: v => typeof v === 'boolean',
  custom: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
  added: v => v === null || (Array.isArray(v) && v.every(x => typeof x === 'string')),
  wild: v => isPlainObject(v),
  library: v => v === null || typeof v === 'string' || isPlainObject(v),
};

/**
 * v1 原始字串表 → 解析后的值。
 * @param {object} data  {'shizi.<v1 键>': JSON 字串}（备份文件的 data，或从 localStorage 读出的键值）
 * @param {{strict?: boolean}} [o]  strict：任一已知键不是字串 / 不是 JSON / 容器形状不对 → {ok:false, reason:'shape', key}
 * @returns {{ok:true, values:object, present:string[], bad:string[]} | {ok:false, reason:string, key?:string}}
 */
export function readV1(data, { strict = false } = {}) {
  if (!isPlainObject(data)) return { ok: false, reason: 'format' };
  const values = {};
  const present = [];
  const bad = [];
  for (const key of Object.keys(data)) {
    const name = NAME_OF_KEY.get(key);
    if (!name) continue;
    const raw = data[key];
    if (raw === null || raw === undefined) continue;
    present.push(key);
    let value;
    let ok = typeof raw === 'string';
    if (ok) {
      try {
        value = JSON.parse(raw);
      } catch (error) {
        ok = false;
      }
    }
    if (ok && V1_SHAPES[name] && !V1_SHAPES[name](value)) ok = false;
    if (!ok) {
      if (strict) return { ok: false, reason: typeof raw === 'string' ? 'shape' : 'value', key };
      bad.push(key);
      continue;
    }
    values[name] = value;
  }
  present.sort();
  bad.sort();
  return { ok: true, values, present, bad };
}

// ---------------------------------------------------------------- 小工具

/** v1 卡键 → v2 cardKey：base:<字> / custom:<字>；旧 custom:<n>:<字> 收敛（旧版 canonicalCardKey L1542）；legacy:* 与其他丢弃。 */
export function canonicalCardKey(raw) {
  if (typeof raw !== 'string' || raw.length > 80) return null;
  const m = /^(base|custom):(?:\d+:)?([\s\S]+)$/.exec(raw);
  if (!m || !isSingleChar(m[2])) return null;
  return `${m[1]}:${m[2]}`;
}

function charOfKey(key) {
  return key.slice(key.indexOf(':') + 1);
}

function clampHints(n) {
  const x = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(HINTS_SHAPE_MAX, x));
}

function isoMs(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function base64Bytes(dataURL) {
  const raw = String(dataURL).split(',')[1] || '';
  const padding = (raw.match(/=*$/) || [''])[0].length;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

function newReport(source) {
  return {
    version: REPORT_VERSION,
    source, // 'device' | 'backup'
    events: { total: 0, correct: 0, wrong: 0, answerSeen: 0, uncertain: 0, hintedWithHints: 0, other: 0, badKey: 0, duplicate: 0 },
    hintedAs: 'none',
    synthesized: { correct: 0, wrong: 0, answerSeen: 0, hinted: 0, fromLastReview: 0, addedOnly: 0, unknown: 0 },
    records: { total: 0, judged: 0, chars: 0 },
    sched: { kept: 0, droppedNoJudged: 0, badCard: 0 },
    ink: { enabled: false, migrated: 0, skipped: 0 },
    photos: { kept: 0, evicted: 0, wishesDropped: 0 },
    custom: 0,
    wordOff: 0,
    days: 0,
    settings: [],
    dropped: { soundScene: false, keys: [] },
    badKeys: [],
  };
}

/** v1 memory 行合并（两个旧键收敛到同一 cardKey 时取 last 较新的那行；计数取大，沿旧版 mergeStableRows 口径）。 */
function mergeRows(a, b) {
  if (!a) return b;
  const newer = (Number(b.last) || 0) >= (Number(a.last) || 0) ? b : a;
  const older = newer === b ? a : b;
  const out = Object.assign({}, older, newer);
  for (const k of ['seen', 'fast', 'slow', 'hints', 'misses', 'streak']) {
    if (hasOwn(a, k) || hasOwn(b, k)) out[k] = Math.max(Number(a[k]) || 0, Number(b[k]) || 0);
  }
  return out;
}

// ---------------------------------------------------------------- 转换（纯函数）

/**
 * 解析后的 v1 值 → v2 各域（不含 sessions / funnel / safety）。纯函数：不碰存储、不读时钟（now 由调用方给）。
 *
 * @param {object} values  readV1(...).values
 * @param {{now:number, dueBase?:number, source?:'device'|'backup', present?:string[], bad?:string[],
 *          idFor?:(i:number)=>string, policy?:object}} o
 *   now      importedAt / meta.createdAt / migratedAt 的时刻
 *   dueBase  「pendingLearning 的字 due = 明天」的「今天」（缺省 = now；备份导入用备份日期）
 *   idFor    第 i 条（按时间先后，0 起）记录的 id；缺省 r1, r2 …（store 提交时换成 ctx.nextId('r')）
 * @returns {{state:object, report:object, serial:number}}
 *   state：{meta, records, sched, ink, custom, wordOff, settings, photos, legacy, backupMeta}（空域为 null，records / ink 为 {}）
 */
export function convertV1(values, { now, dueBase = null, source = 'device', present = [], bad = [], idFor = null, policy = defaultPolicy } = {}) {
  if (!Number.isFinite(now)) throw new TypeError('convertV1 needs opts.now (ms)');
  const v = values || {};
  const mig = (policy && policy.migration) || {};
  const hintedAs = HINTED_AS.indexOf(mig.legacyHintedAs) >= 0 ? mig.legacyHintedAs : 'none';
  const synthesize = mig.synthesizeFromMemory !== false;
  const withInk = !!(policy && policy.features && policy.features.perRecordInk === true);
  const report = newReport(source);
  report.hintedAs = hintedAs;
  report.ink.enabled = withInk;
  report.badKeys = bad.slice();
  const days = new Set();
  const addDay = day => {
    if (isLocalDay(day)) days.add(day);
  };

  // ---- memory（按 v2 cardKey 收敛）
  const memory = new Map();
  if (isPlainObject(v.memory)) {
    for (const rawKey of Object.keys(v.memory)) {
      const key = canonicalCardKey(rawKey);
      const row = v.memory[rawKey];
      if (!key || !isPlainObject(row)) continue;
      memory.set(key, mergeRows(memory.get(key), row));
    }
  }

  // ---- 事件 → 待定记录
  const pending = []; // {cardKey, kind, judgment?, at, localDay, help, order}
  let order = 0;
  const push = (item, bucket) => {
    item.order = order;
    order += 1;
    pending.push(item);
    if (bucket) bucket.n += 1;
  };
  const log = v.fsrsLog;
  const rawEvents = Array.isArray(log) ? log : isPlainObject(log) && Array.isArray(log.events) ? log.events : [];
  const monthly = isPlainObject(log) && isPlainObject(log.monthly) ? log.monthly : {};
  const withEvents = new Set();
  const seenIds = new Set();
  const events = [];
  for (const e of rawEvents) {
    report.events.total += 1;
    if (!isPlainObject(e)) {
      report.events.badKey += 1;
      continue;
    }
    const cardKey = canonicalCardKey(e.cardKey);
    const at = isoMs(e.reviewedAt);
    if (!cardKey || at === null || !isLocalDay(e.localDay)) {
      report.events.badKey += 1;
      continue;
    }
    const id = typeof e.eventId === 'string' && e.eventId ? e.eventId : '';
    if (id) {
      if (seenIds.has(id)) {
        report.events.duplicate += 1;
        continue;
      }
      seenIds.add(id);
    }
    events.push({ cardKey, at, localDay: e.localDay, rating: e.rating === 'Good' ? 'Good' : 'Again', reason: typeof e.reason === 'string' ? e.reason : '', hintCount: Math.max(0, Math.floor(Number(e.hintCount) || 0)), traced: e.traced === true });
  }
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    withEvents.add(e.cardKey);
    addDay(e.localDay);
    const help = { hints: clampHints(e.hintCount), answerSeen: false, traced: e.traced };
    const base = { cardKey: e.cardKey, at: e.at, localDay: e.localDay };
    if (e.rating === 'Good') {
      push(Object.assign(base, { kind: 'judged', judgment: 'correct', help }));
      report.events.correct += 1;
    } else if (e.reason === 'wrong') {
      push(Object.assign(base, { kind: 'judged', judgment: 'wrong', help }));
      report.events.wrong += 1;
    } else if (e.reason === 'dontKnow') {
      push(Object.assign(base, { kind: 'answer-seen', help: Object.assign(help, { answerSeen: true }) }));
      report.events.answerSeen += 1;
    } else if (e.reason === 'hinted' && e.hintCount === 0) {
      report.events.uncertain += 1; // 旧「不太确定」：不生成记录（01 §12）
    } else if (e.reason === 'hinted') {
      report.events.hintedWithHints += 1;
      if (hintedAs !== 'none') push(Object.assign(base, { kind: 'judged', judgment: hintedAs, help }));
    } else {
      report.events.other += 1; // 旧日志里不该出现的组合：不猜
    }
  }

  // ---- 有 memory 无事件的字：合成 legacy 记录（P35）
  for (const [key, m] of memory) {
    if (withEvents.has(key) || !(Number(m.seen) > 0)) continue;
    if (!synthesize) continue;
    const addArtifact = m.queuedFront === true;
    let outcome = m.lastOutcome;
    let at = Number(m.last);
    if (addArtifact || (outcome === 'miss' && !isPlainObject(m.fsrsCard))) {
      // 加字残留：lastOutcome/last 是加字那一刻，不是练习
      const lastReview = isPlainObject(m.fsrsCard) ? isoMs(m.fsrsCard.last_review) : null;
      if (lastReview === null) {
        report.synthesized.addedOnly += 1;
        continue;
      }
      const ep = isPlainObject(m.lastEpisode) ? m.lastEpisode : null;
      outcome = ep && ep.independentlyRecovered === true ? 'fast' : ep ? ep.firstOutcome : null;
      at = lastReview;
      report.synthesized.fromLastReview += 1;
    }
    if (!finitePos(at)) {
      report.synthesized.unknown += 1;
      continue;
    }
    const day = localDay(at);
    const help = { hints: clampHints(m.lastHints), answerSeen: false, traced: m.traced === true };
    const base = { cardKey: key, at, localDay: day, legacySynth: true };
    if (outcome === 'fast') {
      push(Object.assign(base, { kind: 'judged', judgment: 'correct', help }));
      report.synthesized.correct += 1;
    } else if (outcome === 'slow') {
      push(Object.assign(base, { kind: 'judged', judgment: 'wrong', help }));
      report.synthesized.wrong += 1;
    } else if (outcome === 'miss') {
      push(Object.assign(base, { kind: 'answer-seen', help: Object.assign(help, { answerSeen: true }) }));
      report.synthesized.answerSeen += 1;
    } else if (outcome === 'hinted') {
      report.synthesized.hinted += 1;
      if (hintedAs !== 'none') push(Object.assign(base, { kind: 'judged', judgment: hintedAs, help }));
    } else {
      report.synthesized.unknown += 1;
      continue;
    }
    addDay(day);
  }

  // ---- 记录：按时间先后分配 id、按 localDay 月份分键
  pending.sort((a, b) => a.at - b.at || a.order - b.order);
  const makeId = typeof idFor === 'function' ? idFor : i => `r${i + 1}`;
  const records = {};
  const flat = [];
  pending.forEach((p, i) => {
    const rec = { id: makeId(i), cardKey: p.cardKey, char: charOfKey(p.cardKey), kind: p.kind };
    if (p.kind === 'judged') rec.judgment = p.judgment;
    rec.at = p.at;
    rec.localDay = p.localDay;
    rec.help = p.help;
    rec.legacy = true;
    const month = monthOfDay(p.localDay);
    (records[month] || (records[month] = [])).push(rec);
    flat.push(rec);
  });
  const lastJudged = new Map(); // cardKey → 最近一次 judged 记录
  const lastCorrect = new Map();
  for (const rec of flat) {
    if (rec.kind !== 'judged') continue;
    lastJudged.set(rec.cardKey, rec);
    if (rec.judgment === 'correct') lastCorrect.set(rec.cardKey, rec);
  }
  report.records.total = flat.length;
  report.records.judged = flat.filter(r => r.kind === 'judged').length;
  report.records.chars = lastJudged.size;

  // ---- sched（不变式：sched 存在 ⇒ 有 judged 记录）
  const today = localDay(Number.isFinite(dueBase) ? dueBase : now);
  let sched = {};
  for (const [key, m] of memory) {
    if (!isPlainObject(m.fsrsCard)) continue;
    let fsrs;
    try {
      fsrs = serializeCard(m.fsrsCard);
    } catch (error) {
      fsrs = null;
    }
    if (!fsrs || !isCompactCard(fsrs)) {
      report.sched.badCard += 1;
      continue;
    }
    if (!lastJudged.has(key)) {
      report.sched.droppedNoJudged += 1;
      continue;
    }
    const cardDue = localDay(Date.parse(fsrs.due));
    let due;
    if (m.queuedFront === true) due = cardDue; // 加字把 dueDay 改成了加字当天：不算调度
    else if (m.pendingLearning === true) due = addDays(today, 1);
    else if (isLocalDay(m.dueDay)) due = m.dueDay;
    else due = cardDue;
    sched[key] = { fsrs, due, lastJudgedAt: lastJudged.get(key).at };
    report.sched.kept += 1;
  }
  if (!Object.keys(sched).length) sched = null;

  // ---- 墨迹（P31 开关）
  const ink = {};
  for (const [key, m] of memory) {
    const recent = isPlainObject(m.recentInk) ? m.recentInk : null;
    if (!recent || !Array.isArray(recent.strokes) || !recent.strokes.length) continue;
    const target = lastCorrect.get(key);
    if (!withInk || !target) {
      report.ink.skipped += 1;
      continue;
    }
    const strokes = recent.strokes
      .filter(Array.isArray)
      .map(s => s.filter(p => isPlainObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map(p => ({ x: p.x * GRID, y: p.y * GRID, w: (Number.isFinite(p.w) ? p.w : 1) * INK.base })))
      .filter(s => s.length > 0);
    if (!strokes.length) {
      report.ink.skipped += 1;
      continue;
    }
    const month = monthOfDay(target.localDay);
    (ink[month] || (ink[month] = {}))[target.id] = encodeInk(strokes, { policy });
    report.ink.migrated += 1;
  }

  // ---- 照片（沿旧预算）
  let photos = {};
  const wild = isPlainObject(v.wild) ? v.wild : {};
  const captures = isPlainObject(wild.captures) ? wild.captures : {};
  const rows = [];
  for (const ch of Object.keys(captures)) {
    const row = captures[ch];
    if (!isPlainObject(row) || typeof row.dataURL !== 'string' || !row.dataURL) continue;
    const okChar = isSingleChar(ch) && isCJK(ch);
    const okImage = /^data:image\/(?:webp|jpeg);base64,/.test(row.dataURL) && base64Bytes(row.dataURL) <= WILD_PHOTO_MAX_BYTES;
    if (!okChar || !okImage) {
      report.photos.evicted += 1;
      continue;
    }
    const at = finitePos(Number(row.at)) ? Number(row.at) : now;
    rows.push({ ch, at, day: isLocalDay(row.day) ? row.day : localDay(at), dataURL: row.dataURL, bytes: row.dataURL.length * 2 });
  }
  rows.sort((a, b) => b.at - a.at || (a.ch < b.ch ? -1 : 1));
  let photoBytes = 0;
  for (const row of rows) {
    if (report.photos.kept < WILD_PHOTO_MAX && photoBytes + row.bytes <= WILD_PHOTO_BUDGET) {
      photos[row.ch] = { day: row.day, at: row.at, dataURL: row.dataURL };
      photoBytes += row.bytes;
      report.photos.kept += 1;
    } else report.photos.evicted += 1;
  }
  report.photos.wishesDropped = isPlainObject(wild.wishes) ? Object.keys(wild.wishes).length : 0;
  if (!report.photos.kept) photos = null;

  // ---- 自选的字（added；缺失时按旧版 L2119 由 custom 词推导）
  let addedChars = Array.isArray(v.added) ? v.added : null;
  if (!addedChars && Array.isArray(v.custom)) addedChars = v.custom.flatMap(w => Array.from(String(w)).filter(isCJK));
  let custom = null;
  if (addedChars && addedChars.length) {
    const added = [];
    const seen = new Set();
    for (const raw of addedChars) {
      const ch = typeof raw === 'string' ? raw : '';
      if (!isSingleChar(ch) || !isCJK(ch) || seen.has(ch)) continue;
      seen.add(ch);
      const m = memory.get(`base:${ch}`) || memory.get(`custom:${ch}`) || null;
      const at = m && finitePos(Number(m.queuedFrontAt)) ? Number(m.queuedFrontAt) : m && finitePos(Number(m.firstSeenAt)) ? Number(m.firstSeenAt) : now;
      added.push({ char: ch, at });
    }
    if (added.length) custom = { added };
  }
  report.custom = custom ? custom.added.length : 0;

  // ---- 停用的词语（quality.badWord / hide）
  let wordOff = {};
  if (isPlainObject(v.quality)) {
    for (const rawKey of Object.keys(v.quality)) {
      const row = v.quality[rawKey];
      const key = canonicalCardKey(rawKey);
      if (!key || !isPlainObject(row) || !(row.badWord || row.hide === true)) continue;
      wordOff[key] = finitePos(Number(row.last)) ? Number(row.last) : now;
    }
  }
  report.wordOff = Object.keys(wordOff).length;
  if (!report.wordOff) wordOff = null;

  // ---- 设置
  const settings = {};
  if (hasOwn(v, 'library') && v.library !== null) {
    const stored = isPlainObject(v.library) ? v.library.id : v.library;
    const id = LEGACY_LIBRARY_IDS[stored] || stored;
    if (LIBRARY_IDS.indexOf(id) >= 0) settings.library = id;
  }
  if (isPlainObject(v.sound)) {
    settings.sound = v.sound.enabled !== false; // 旧默认开（L1321）
    if (hasOwn(v.sound, 'scene')) report.dropped.soundScene = true; // P07 / #166：背景音不迁
  }
  if (isPlainObject(v.reminder)) {
    const perm = v.reminder.permission;
    settings.remind = { enabled: v.reminder.enabled === true, permission: perm === 'granted' || perm === 'denied' ? perm : 'unknown' };
  }
  if (typeof v.fontScale === 'boolean') settings.large = v.fontScale;
  report.settings = Object.keys(settings).sort();

  // ---- 上次导出
  let backupMeta = null;
  if (isPlainObject(v.backupMeta) && finitePos(Number(v.backupMeta.lastExportAt))) {
    backupMeta = { lastExportAt: Number(v.backupMeta.lastExportAt), lastExportSig: null };
  }

  // ---- 练习日（旧日历）
  const activity = isPlainObject(v.activity) ? v.activity : {};
  if (Array.isArray(activity.practiceDays)) activity.practiceDays.forEach(addDay);
  for (const month of Object.keys(monthly)) {
    const row = monthly[month];
    if (isPlainObject(row) && isPlainObject(row.lastReviewByDay)) Object.keys(row.lastReviewByDay).forEach(addDay);
  }
  const dayList = Array.from(days).sort();
  report.days = dayList.length;

  const known = new Set(['memory', 'fsrsLog', 'wild', 'added', 'custom', 'quality', 'library', 'sound', 'reminder', 'fontScale', 'backupMeta', 'activity']);
  report.dropped.keys = present.filter(key => !known.has(NAME_OF_KEY.get(key)));

  const legacy = { importedAt: now, fromKeys: present.slice(), days: dayList, report };
  const serial = flat.reduce((max, r) => Math.max(max, Number(r.id.slice(1)) || 0), 0);
  const meta = { schema: SCHEMA_VERSION, serial, createdAt: now, months: Object.keys(records).sort() };
  return {
    state: { meta, records, sched, ink, custom, wordOff, settings: report.settings.length ? settings : null, photos, legacy, backupMeta },
    report,
    serial: meta.serial,
  };
}

/** 迁移结果在 v2 各域里的非空程度（「v2 已有数据」判断用）。 */
function hasV2Records(state) {
  const records = state && isPlainObject(state.records) ? state.records : {};
  return Object.keys(records).length > 0 || !!(state && isPlainObject(state.sched) && Object.keys(state.sched).length);
}

// ---------------------------------------------------------------- v1 备份文件 → v2 备份对象

/**
 * v1 备份（{app:'shizi', version:1, date, data}）→ v2 备份对象（core/backup.js buildBackupV2 同形）。严格模式：任一已知 v1 键坏 → 整单拒绝。
 * 「pendingLearning 的字 due = 明天」以备份日期为「今天」（缺失时用 now）。
 * @returns {{ok:true, backup:object, report:object} | {ok:false, reason:string, key?:string}}
 */
export function legacyBackupToV2(obj, { now = Date.now(), policy = defaultPolicy } = {}) {
  if (!isPlainObject(obj) || obj.app !== APP_ID || obj.version !== 1 || !isPlainObject(obj.data)) return { ok: false, reason: 'format' };
  const read = readV1(obj.data, { strict: true });
  if (!read.ok) return read;
  if (!read.present.length) return { ok: false, reason: 'empty' };
  const date = isoMs(obj.date);
  const conv = convertV1(read.values, { now, dueBase: date === null ? now : date, source: 'backup', present: read.present, bad: [], policy });
  const backup = buildBackupV2(conv.state, { now: date === null ? now : date, serial: conv.serial });
  if (typeof obj.date === 'string' && date !== null) backup.date = obj.date;
  return { ok: true, backup, report: conv.report };
}

// 备份页导入 v1 文件走这里（core/backup.js importLegacyBackup 的转换器，见文件头）。
setLegacyBackupImporter((obj, opts) => legacyBackupToV2(obj, opts || {}));

// ---------------------------------------------------------------- 设备迁移（写入）

/** 本机 localStorage 里的 v1 键（22 个已知键中存在的）→ {key: raw}。 */
export function readDeviceV1(storage) {
  const out = {};
  for (const key of Object.values(V1_KEYS)) {
    const raw = storage.read(key);
    if (raw !== null) out[key] = raw;
  }
  return out;
}

/** 本机是否有待迁移的 v1 数据（01 §12：有 shizi.memory.v1）。 */
export function detectV1(storage) {
  return storage.read(V1_DETECT_KEY) !== null;
}

/** v1 时代的隔离坏值（shizi.corrupt.<原键>，原键不是 v2 键）。v2 的隔离值由 repair / 备份导入管，不在这里删。 */
export function legacyCorruptKeys(storage) {
  return storage.listKeys(CORRUPT_PREFIX).filter(key => key.slice(CORRUPT_PREFIX.length).indexOf(V2_PREFIX) !== 0);
}

/** 迁移成功后的大键清理（01 §3.6 / §14「旧大键导入后即删」）。返回删掉的键。 */
export function dropBigLegacyKeys(storage) {
  const keys = V1_BIG_KEYS.filter(key => storage.read(key) !== null).concat(legacyCorruptKeys(storage));
  return keys.length ? storage.removeKeys(keys) : [];
}

/**
 * 执行一次迁移（调用方已确认：没有 v2.meta、有 v1 数据）。
 * @returns {{ok:true, action:'migrated', report, removed:string[]} | {ok:true, action:'skipped', reason} | {ok:false, error}}
 */
export function runMigration({ store, now = envNow, policy = defaultPolicy } = {}) {
  const storage = store.storage;
  const read = readV1(readDeviceV1(storage), { strict: false });
  const at = typeof now === 'function' ? now() : now;
  const before = store.getState();
  if (hasV2Records(before)) {
    // 不该出现（迁移失败时 R-B09 阻断写字）：v2 已有记录却没有 meta。不覆盖 v2，也不阻断。
    return { ok: true, action: 'skipped', reason: 'v2-records' };
  }
  let report = null;
  const result = store.commit(MIGRATION_LABEL, (draft, ctx) => {
    const conv = convertV1(read.values, { now: at, source: 'device', present: read.present, bad: read.bad, idFor: () => ctx.nextId('r'), policy });
    report = conv.report;
    const s = conv.state;
    draft.records = s.records;
    draft.ink = s.ink;
    // v2 已有的小域（例如先写了设置）保留 v2 的值；没有才用 v1 的
    for (const domain of ['sched', 'custom', 'wordOff', 'settings', 'photos', 'backupMeta']) {
      if (draft[domain] === null || draft[domain] === undefined) draft[domain] = s[domain];
    }
    draft.legacy = s.legacy;
    draft.meta = Object.assign({}, s.meta, { migratedAt: at });
    draft.funnel = Object.assign({}, isPlainObject(draft.funnel) ? draft.funnel : {}, {
      legacyImport: {
        at,
        records: report.records.total,
        judged: report.records.judged,
        chars: report.records.chars,
        uncertain: report.events.uncertain,
        hintedWithHints: report.events.hintedWithHints,
        synthesized: report.synthesized.correct + report.synthesized.wrong + report.synthesized.answerSeen,
        schedDropped: report.sched.droppedNoJudged,
        photosEvicted: report.photos.evicted,
      },
    });
  }, { reclaim: false, replace: true });
  if (!result.ok) return { ok: false, error: result.error };
  // 核对 meta 已落盘（01 §3.6「v2.meta 写入并核对」）后才删旧大键
  let metaOk = false;
  try {
    const raw = storage.read(KEYS.meta);
    const meta = raw ? JSON.parse(raw) : null;
    metaOk = !!meta && meta.migratedAt === at;
  } catch (error) {
    metaOk = false;
  }
  let removed = [];
  if (metaOk) {
    try {
      removed = dropBigLegacyKeys(storage);
    } catch (error) {
      removed = [];
    }
  }
  return { ok: true, action: 'migrated', report, removed, metaVerified: metaOk };
}

/**
 * 回退窗口（P53）：v2.meta 在、v1 键还在时，窗口起点 = meta.migratedAt（没有则 meta.createdAt）；
 * 满 policy.migration.legacyKeyRetentionDays 天，或（legacyKeyReleaseOnExport）起点之后导出过一次 v2 备份 → 删其余 v1 键。
 * 残留的 session / safety 大键（上次删失败，或回退期间旧版又写了）无条件删。
 * @returns {{released:string[], big:string[]}}
 */
export function releaseLegacyKeys({ store, now = envNow, policy = defaultPolicy } = {}) {
  const storage = store.storage;
  const state = store.getState();
  const meta = state && isPlainObject(state.meta) ? state.meta : null;
  const out = { released: [], big: [] };
  if (!meta) return out;
  const present = Object.values(V1_KEYS).filter(key => storage.read(key) !== null);
  if (!present.length && !legacyCorruptKeys(storage).length) return out;
  out.big = dropBigLegacyKeys(storage);
  const mig = (policy && policy.migration) || {};
  const start = Number.isFinite(meta.migratedAt) ? meta.migratedAt : meta.createdAt;
  const at = typeof now === 'function' ? now() : now;
  const days = Number.isFinite(mig.legacyKeyRetentionDays) ? mig.legacyKeyRetentionDays : 30;
  const exportedAt = state.backupMeta && Number.isFinite(state.backupMeta.lastExportAt) ? state.backupMeta.lastExportAt : null;
  const expired = Number.isFinite(start) && at - start >= days * 86400000;
  const exported = mig.legacyKeyReleaseOnExport === true && exportedAt !== null && Number.isFinite(start) && exportedAt > start;
  if (!expired && !exported) return out;
  const rest = present.filter(key => V1_BIG_KEYS.indexOf(key) < 0);
  out.released = rest.length ? storage.removeKeys(rest) : [];
  return out;
}

let lastResult = null;

/** 最近一次 bootMigration 的结果（阻断页 / 测试读）。 */
export function getMigrationResult() {
  return lastResult;
}

/**
 * 启动入口（app.js：store 建好后、挂 UI 前）。不抛错。
 * @returns {{ok:true, action:'none'|'migrated'|'skipped'|'disabled'|'unavailable', …} | {ok:false, error:{kind, reason?}}}
 */
export function bootMigration({ store = null, now = envNow, policy = defaultPolicy } = {}) {
  const done = result => {
    lastResult = result;
    return result;
  };
  let s = store;
  try {
    if (!s) s = getStore();
  } catch (error) {
    return done({ ok: true, action: 'unavailable' });
  }
  try {
    const status = s.status;
    if (!status.available || status.blocked) return done({ ok: true, action: 'unavailable' }); // R-B09 由阻断页处理
    if (s.getState().meta) return done(Object.assign({ ok: true, action: 'none' }, releaseLegacyKeys({ store: s, now, policy })));
    if (!detectV1(s.storage)) return done({ ok: true, action: 'none' });
    if (!policy.migration || policy.migration.importLegacy !== true) return done({ ok: true, action: 'disabled' });
    return done(runMigration({ store: s, now, policy }));
  } catch (error) {
    return done({ ok: false, error: { kind: error && error.kind ? error.kind : 'exception', reason: error && error.message ? error.message : String(error) } });
  }
}
