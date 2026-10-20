// v2 localStorage 键的形状表（01-架构设计 §3）。
// 只定义「长什么样」，不写业务：启动隔离（storage.repair）、store.commit 前校验、备份导入整单校验三处共用。
//
// 覆盖不变量（01 §3.6）：KEY_SPECS 的键表 = BACKUP_WHITELIST ∪ BACKUP_EXCLUDED，且两表不相交。
// 两张表是**显式声明**的清单，不由 KEY_SPECS 推导——新增键漏登记，test/store/schema.test.mjs 即红。
//
// 约定：校验函数返回 null 表示通过，否则返回 '路径: 原因' 字串（只给日志与测试看，不是界面文案）。
// 纯模块：不访问 window/document/localStorage。API 下限 iOS 15（不用 Object.hasOwn / Array.prototype.at / structuredClone）。

export const APP_ID = 'shizi';
export const SCHEMA_VERSION = 2;
export const BACKUP_VERSION = 2;

export const V2_PREFIX = 'shizi.v2.';
export const RECORDS_PREFIX = 'shizi.v2.records.';
/**
 * 墨迹按记录所属月份分键（架构裁定，M0 验收修复 F3）：`shizi.v2.ink.<YYYY-MM>` = `{ [recordId]: Ink }`（v3 打包编码，读取兼容 v2，P78）。
 * 月份与 records.<YYYY-MM> 同规则（记录的 localDay 所在月 = 其 at 的本地月，01 §3.1）。
 * 原因：01 §4 的事务日志把每个被改键的旧值整份写进 shizi.v2.txn，单键 ink（预算 1.5MiB）会让每次判断的峰值占用翻倍；
 * 按月分键后一次判断只重写当月 ink 键。
 */
export const INK_PREFIX = 'shizi.v2.ink.';
export const CORRUPT_PREFIX = 'shizi.corrupt.';
/** iOS DEBUG 冒烟键：不属于 v2，reset() 不删，备份不含。 */
export const NATIVE_SMOKE_KEY = 'shizi.nativeSmoke.v1';

export const KEYS = Object.freeze({
  meta: 'shizi.v2.meta',
  sched: 'shizi.v2.sched',
  custom: 'shizi.v2.custom',
  wordOff: 'shizi.v2.wordOff',
  settings: 'shizi.v2.settings',
  photos: 'shizi.v2.photos',
  legacy: 'shizi.v2.legacy',
  backupMeta: 'shizi.v2.backupMeta',
  sessions: 'shizi.v2.sessions',
  funnel: 'shizi.v2.funnel',
  safety: 'shizi.v2.safety',
  txn: 'shizi.v2.txn',
  /**
   * 审查整改 F1：冷启动恢复用的路由提示 {v, at, stack:[{n, p}]}（与 history.state 同一份栈、同样经 router sanitize）。
   * 不是业务数据、不是 store 域：只经 storage.writeRoute 单键写（不进 txn、不进备份），读回由 ui/route-memory.js 严格校验。
   */
  route: 'shizi.v2.route',
  /** storage.probe() 的探针键；repair() 顺手清掉残留。 */
  probe: 'shizi.v2.probe',
});

/** store 状态里的域（与键一一对应；records 与 ink 是按月分键的两族）。txn/probe 不是域。 */
export const DOMAINS = Object.freeze([
  'meta', 'records', 'sched', 'ink', 'custom', 'wordOff', 'settings', 'photos', 'legacy', 'backupMeta',
  'sessions', 'funnel', 'safety',
]);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// ---------------------------------------------------------------- 基本判定

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RECORD_ID_RE = /^r[1-9]\d*$/;
const SESSION_ID_RE = /^s[1-9]\d*$/;
const CARD_KEY_RE = /^(base|custom):([\s\S]+)$/;

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const isNonNegInt = value => Number.isInteger(value) && value >= 0;
const isBool = value => typeof value === 'boolean';
const isString = value => typeof value === 'string';

/** 一个 Unicode 码点（含补充平面，如 𠮷）。 */
export function isSingleChar(value) {
  if (!isString(value) || value.length === 0 || value.length > 2) return false;
  return Array.from(value).length === 1;
}

export function isMonthKey(value) {
  return isString(value) && MONTH_RE.test(value);
}

/** YYYY-MM-DD 且是真实存在的日期（拒绝 2026-02-30）。 */
export function isLocalDay(value) {
  if (!isString(value)) return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function monthOfDay(localDay) {
  return localDay.slice(0, 7);
}

export function isCardKey(value) {
  if (!isString(value)) return false;
  const m = CARD_KEY_RE.exec(value);
  return !!m && isSingleChar(m[2]);
}

export function charOfCardKey(cardKey) {
  const m = CARD_KEY_RE.exec(cardKey);
  return m ? m[2] : null;
}

export function isRecordId(value) {
  return isString(value) && RECORD_ID_RE.test(value);
}

export function isSessionId(value) {
  return isString(value) && SESSION_ID_RE.test(value);
}

/** 'r12' / 's7' → 12 / 7；不合法返回 0。 */
export function serialOf(id) {
  if (!isString(id) || !/^[rs][1-9]\d*$/.test(id)) return 0;
  return Number(id.slice(1));
}

export function recordsKey(month) {
  return RECORDS_PREFIX + month;
}

export function isRecordsKey(key) {
  return isString(key) && key.indexOf(RECORDS_PREFIX) === 0 && isMonthKey(key.slice(RECORDS_PREFIX.length));
}

export function monthOfRecordsKey(key) {
  return isRecordsKey(key) ? key.slice(RECORDS_PREFIX.length) : null;
}

export function inkKey(month) {
  return INK_PREFIX + month;
}

export function isInkKey(key) {
  return isString(key) && key.indexOf(INK_PREFIX) === 0 && isMonthKey(key.slice(INK_PREFIX.length));
}

export function monthOfInkKey(key) {
  return isInkKey(key) ? key.slice(INK_PREFIX.length) : null;
}

/** 按月分键的域（records / ink）。 */
export const MONTHLY_DOMAINS = Object.freeze(['records', 'ink']);

export function isMonthlyDomain(domain) {
  return MONTHLY_DOMAINS.indexOf(domain) >= 0;
}

/** 按月分键的键 → 月份（records.<月> / ink.<月>）；其余返回 null。 */
export function monthOfKey(key) {
  return monthOfRecordsKey(key) || monthOfInkKey(key);
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 一条记录的墨迹归哪个月键：与它所在的 records.<月> 相同（localDay 的月份；localDay 按定义是 at 的本地日）。
 * localDay 缺失或不合法时退回 at 的本地月。都没有返回 null。
 */
export function inkMonthOf(record) {
  if (!record || typeof record !== 'object') return null;
  if (isLocalDay(record.localDay)) return monthOfDay(record.localDay);
  if (isFiniteNumber(record.at)) {
    const d = new Date(record.at);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  return null;
}

/** 一条记录的墨迹在月键里的 id：inkId（01 §3.2）优先，否则记录自身 id。 */
export function inkIdOf(record) {
  if (!record || typeof record !== 'object') return null;
  if (isRecordId(record.inkId)) return record.inkId;
  return isRecordId(record.id) ? record.id : null;
}

export function corruptKeyFor(key) {
  return CORRUPT_PREFIX + key;
}

// ---------------------------------------------------------------- 小工具

function fail(path, reason) {
  return `${path}: ${reason}`;
}

function checkArray(value, path, each) {
  if (!Array.isArray(value)) return fail(path, 'not an array');
  for (let i = 0; i < value.length; i += 1) {
    const err = each(value[i], `${path}[${i}]`);
    if (err) return err;
  }
  return null;
}

function checkMap(value, path, keyOk, each) {
  if (!isPlainObject(value)) return fail(path, 'not an object');
  for (const key of Object.keys(value)) {
    if (!keyOk(key)) return fail(`${path}.${key}`, 'bad key');
    const err = each(value[key], `${path}.${key}`, key);
    if (err) return err;
  }
  return null;
}

/** 只允许列出的字段；required 必须存在。fields: {name: (v, path) => err|null}。 */
function checkFields(value, path, fields, required) {
  if (!isPlainObject(value)) return fail(path, 'not an object');
  for (const key of Object.keys(value)) {
    if (!hasOwn(fields, key)) return fail(`${path}.${key}`, 'unknown field');
  }
  for (const key of required) {
    if (!hasOwn(value, key)) return fail(`${path}.${key}`, 'missing');
  }
  for (const key of Object.keys(value)) {
    const err = fields[key](value[key], `${path}.${key}`);
    if (err) return err;
  }
  return null;
}

const v = {
  num: (x, p) => (isFiniteNumber(x) ? null : fail(p, 'not a finite number')),
  numOrNull: (x, p) => (x === null || isFiniteNumber(x) ? null : fail(p, 'not a number or null')),
  int: (x, p) => (isNonNegInt(x) ? null : fail(p, 'not a non-negative integer')),
  bool: (x, p) => (isBool(x) ? null : fail(p, 'not a boolean')),
  str: (x, p) => (isString(x) ? null : fail(p, 'not a string')),
  strOrNull: (x, p) => (x === null || isString(x) ? null : fail(p, 'not a string or null')),
  day: (x, p) => (isLocalDay(x) ? null : fail(p, 'not a YYYY-MM-DD day')),
  dayOrNull: (x, p) => (x === null || isLocalDay(x) ? null : fail(p, 'not a day or null')),
  char: (x, p) => (isSingleChar(x) ? null : fail(p, 'not a single character')),
  cardKey: (x, p) => (isCardKey(x) ? null : fail(p, 'not a cardKey')),
  recordId: (x, p) => (isRecordId(x) ? null : fail(p, 'not a record id')),
  sessionId: (x, p) => (isSessionId(x) ? null : fail(p, 'not a session id')),
  obj: (x, p) => (isPlainObject(x) ? null : fail(p, 'not an object')),
  oneOf: values => (x, p) => (values.indexOf(x) >= 0 ? null : fail(p, `not one of ${values.join('|')}`)),
  arrayOf: each => (x, p) => checkArray(x, p, each),
  intRange: (lo, hi) => (x, p) => (Number.isInteger(x) && x >= lo && x <= hi ? null : fail(p, `not an integer in ${lo}..${hi}`)),
};

// ---------------------------------------------------------------- 各键形状

/**
 * 提示次数的形状上限。D64 ①起提示可一直点到整字给出为止（P17 不再限 2 次），次数最多 = 一个字的笔画数（无分组数据的字每次多 1 笔）；
 * 取 64 作形状上限（远大于任何一个字的笔画数），只防坏数据。
 */
export const HINTS_SHAPE_MAX = 64;

const JUDGMENTS = ['correct', 'wrong'];
const RECORD_KINDS = ['judged', 'answer-seen', 'skipped'];

const helpFields = {
  hints: v.intRange(0, HINTS_SHAPE_MAX),
  answerSeen: v.bool,
  traced: v.bool,
};

const correctionFields = { from: v.oneOf(JUDGMENTS), at: v.num };

const recordFields = {
  id: v.recordId,
  cardKey: v.cardKey,
  char: v.char,
  sessionId: v.sessionId,
  kind: v.oneOf(RECORD_KINDS),
  judgment: v.oneOf(JUDGMENTS),
  at: v.num,
  localDay: v.day,
  help: (x, p) => checkFields(x, p, helpFields, ['hints', 'answerSeen', 'traced']),
  corrections: v.arrayOf((x, p) => checkFields(x, p, correctionFields, ['from', 'at'])),
  inkId: v.str,
  legacy: (x, p) => (x === true ? null : fail(p, 'must be true when present')),
  // 阶段 1 P1-E8（D46 ⑬，03 P166）：书写方式。缺省 = screen（旧数据不带、不重写）；只有纸上记录写 'paper'。
  source: v.oneOf(['screen', 'paper']),
};

/** 单条 Record（01 §3.2）。month 给出时校验 localDay 属于该月。 */
export function validateRecord(rec, path = 'record', month = null) {
  const required = ['id', 'cardKey', 'char', 'kind', 'at', 'localDay', 'help'];
  const err = checkFields(rec, path, recordFields, required);
  if (err) return err;
  // v1 合成记录（legacy:true）可以没有会话；其余必须有 sessionId。
  if (rec.legacy !== true && !hasOwn(rec, 'sessionId')) return fail(`${path}.sessionId`, 'missing');
  if (charOfCardKey(rec.cardKey) !== rec.char) return fail(`${path}.char`, 'does not match cardKey');
  if (rec.kind === 'judged' && !hasOwn(rec, 'judgment')) return fail(`${path}.judgment`, 'required when kind is judged');
  if (rec.kind !== 'judged' && hasOwn(rec, 'judgment')) return fail(`${path}.judgment`, 'only allowed when kind is judged');
  if (rec.kind !== 'judged' && hasOwn(rec, 'corrections')) return fail(`${path}.corrections`, 'only allowed when kind is judged');
  if (rec.source === 'paper' && rec.kind !== 'judged') return fail(`${path}.source`, 'paper only for judged records');
  if (rec.source === 'paper' && hasOwn(rec, 'inkId')) return fail(`${path}.inkId`, 'a paper record has no ink');
  if (month && monthOfDay(rec.localDay) !== month) return fail(`${path}.localDay`, `not in month ${month}`);
  return null;
}

function validateRecordList(list, path, month) {
  if (!Array.isArray(list)) return fail(path, 'not an array');
  let prev = 0;
  for (let i = 0; i < list.length; i += 1) {
    const err = validateRecord(list[i], `${path}[${i}]`, month);
    if (err) return err;
    const serial = serialOf(list[i].id);
    if (serial <= prev) return fail(`${path}[${i}].id`, 'ids must be strictly ascending');
    prev = serial;
  }
  return null;
}

/**
 * 按月记录键的值：当月 Record[]（按 id 升序），或预算回收折叠后的月汇总（01 §9）：
 *   { folded: true, month, byDay: {[localDay]: [char…]}, chars: [char…], kept: Record[], paperOnly?: {[localDay]: [char…]} }
 * paperOnly（可缺省）：byDay 里那天只在纸上写过的字（D47，P1-E78）；年报 / 月字数据此不计它们，日历照常算写过的日子。
 * byDay/chars 供日历与「练习记录」显示；kept 保留该月里仍是「某字最近一次 judged」或「某字第一次 judged」（D27，阶段 1 P1-E3）的记录，
 * 以维持「sched 存在 ⇒ 有 judged 记录」与写错过/快忘了查询（折叠细节见报告里的待定项）。
 */
export function validateRecordsMonth(value, month, path = 'records') {
  if (Array.isArray(value)) return validateRecordList(value, path, month);
  const fields = {
    folded: (x, p) => (x === true ? null : fail(p, 'must be true')),
    month: (x, p) => (x === month ? null : fail(p, `must equal ${month}`)),
    byDay: (x, p) => checkMap(x, p, key => isLocalDay(key) && monthOfDay(key) === month, v.arrayOf(v.char)),
    chars: v.arrayOf(v.char),
    kept: (x, p) => validateRecordList(x, p, month),
    // 可缺省：byDay 里「那天只在纸上写过」的字（D47：不计入年报 / 月字数；折叠时记下，缺省 = 没有）
    paperOnly: (x, p) => checkMap(x, p, key => isLocalDay(key) && monthOfDay(key) === month, v.arrayOf(v.char)),
  };
  return checkFields(value, path, fields, ['folded', 'month', 'byDay', 'chars', 'kept']);
}

const metaFields = {
  schema: (x, p) => (x === SCHEMA_VERSION ? null : fail(p, `must be ${SCHEMA_VERSION}`)),
  serial: v.int,
  createdAt: v.num,
  // v1 → v2 设备迁移完成的时刻（M5-4，store/migrate.js；01 §12）；P53 回退窗口从这里算。可缺省（新用户 / 备份导入）。
  migratedAt: v.num,
  months: (x, p) => {
    const err = checkArray(x, p, (m, q) => (isMonthKey(m) ? null : fail(q, 'not a YYYY-MM month')));
    if (err) return err;
    for (let i = 1; i < x.length; i += 1) if (!(x[i - 1] < x[i])) return fail(p, 'months must be sorted and unique');
    return null;
  },
};

const schedEntryFields = {
  // CompactCard 的内部结构归 core/fsrs.js（M0-6）；这里只要求是对象或数组。
  fsrs: (x, p) => (x !== null && typeof x === 'object' ? null : fail(p, 'not an object/array')),
  due: v.dayOrNull,
  lastJudgedAt: v.num,
  stoppedAt: v.num,
  // 可缺省（D66 ①，policy.answerSeenRating P321）：复习字看过答案、当天记了一次 Again 的那一天；同一天之后的判断不再评级
  seenAgainDay: v.day,
};

const intRow = v.arrayOf((x, p) => (Number.isInteger(x) ? null : fail(p, 'not an integer')));
/** 旧 InkV2（JSON 数字编码）：读取兼容（P78）。 */
const inkV2Fields = {
  v: (x, p) => (x === 2 ? null : fail(p, 'must be 2')),
  c: v.num,
  s: v.arrayOf(intRow),
  dt: v.arrayOf(intRow),
  p: v.arrayOf(intRow),
};
// 标准 base64（长度 4 的倍数、补位正确）；逐点字节数等细节由 core/ink-math.isInkV3 解码时再核。
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const b64 = (x, p) => (isString(x) && BASE64_RE.test(x) ? null : fail(p, 'not a base64 string'));
/** Ink v3 打包编码（01 §3.5，P78）：{v:3, c:345, s:['<base64>'], p?:['<base64>']}。 */
const inkV3Fields = {
  v: (x, p) => (x === 3 ? null : fail(p, 'must be 3')),
  c: v.num,
  s: v.arrayOf(b64),
  p: v.arrayOf(b64),
};
/** 一条墨迹：v3（写入口径）或 v2（旧数据，读取兼容）。 */
function checkInk(x, p) {
  if (x && typeof x === 'object' && x.v === 3) return checkFields(x, p, inkV3Fields, ['v', 'c', 's']);
  return checkFields(x, p, inkV2Fields, ['v', 'c', 's']);
}

const customFields = {
  added: v.arrayOf((x, p) => checkFields(x, p, { char: v.char, at: v.num }, ['char', 'at'])),
};

const photoFields = {
  day: v.day,
  at: v.num,
  dataURL: (x, p) => (isString(x) && x.indexOf('data:image/') === 0 ? null : fail(p, 'not an image data URL')),
};

// settings 各字段可缺省（缺省由读取方补默认值），出现时必须类型正确。
const remindFields = {
  enabled: v.bool,
  hour: v.intRange(0, 23),
  minute: v.intRange(0, 59),
  permission: v.str,
};
// 首练结果页的提醒邀请状态（D35 / D46 ③，P1-E5）：shown = 已邀请几次（最多 2）、last = 最近一次邀请所在的会话 id（同一页刷新不重复计数）、
// answered = 用户的回应（yes 点了「好」/ no「不用了」/ denied 系统拒绝）；没回应时没有 answered。
const remindInviteFields = {
  shown: v.int,
  last: v.str,
  answered: v.oneOf(['yes', 'no', 'denied']),
};
const settingsFields = {
  library: v.str,
  sound: v.bool,
  remind: (x, p) => checkFields(x, p, remindFields, []),
  remindInvite: (x, p) => checkFields(x, p, remindInviteFields, []),
  capitalDeferredDay: v.day, // D46 ④：点了「这次先写平常的字」的那一天
  writeMode: v.oneOf(['screen', 'paper']), // D46 ⑬（P1-E8，03 P165）：设置 › 写字方式；缺省 screen
  paperSuggested: v.bool, // P1-E8（03 P168）：读屏开启时「改为在纸上写」的建议已出现过（只出现一次）
  answerNoteSeen: v.bool, // W1（03 P212，D51 ⑧）：第一次用「看答案」时格下的一行说明已出现过（只出现一次；看答案没有确认框）
  shiHandoffDone: v.bool, // 【已弃用，只为兼容旧数据 / 备份保留，不再读也不再写】H1（03 P221，D51 ④）曾用它记「首练写下「拾」后第一次回首页的交接已发生过」；H2（D55，P267）去掉了首页「拾」交接
  firstTipSeen: v.bool, // Q2-1（03 P181）：首练第 1 字格下一次性提示「凭记忆写；想不起来，点下面的「提示」。」已出现过（只出现一次）

  large: v.bool,
  appearance: v.oneOf(['auto', 'light', 'dark']),
  groupSize: v.oneOf([5, 10, 20, 30]), // D65 #2（P314）：「我的 › 每组字数」；缺省（没选过）按 policy.groupSize 20。取值与 policy.groupSizeOptions 一致（test/store 断言）
};

const conclusionFields = {
  kind: v.oneOf(['restore', 'clear']),
  date: v.strOrNull,
  count: v.int,
};
const backupMetaFields = {
  lastExportAt: v.numOrNull,
  lastExportSig: v.strOrNull,
  lastConclusion: (x, p) => (x === null ? null : checkFields(x, p, conclusionFields, ['kind', 'count'])),
};

const legacyFields = {
  importedAt: v.num,
  fromKeys: v.arrayOf(v.str),
  days: v.arrayOf(v.day),
  report: v.obj,
};

// ---- 会话（01 §3.3）

const PHASES = ['recall', 'compare', 'answer', 'trace', 'retrace'];
const SESSION_KINDS = ['first', 'daily', 'picked'];
const ITEM_KINDS = ['judged', 'answer-seen', 'skipped'];

const currentFields = {
  phase: v.oneOf(PHASES),
  // 点的编码归 ink-math（M1-1）；形状层只要求「笔 = 数组」。
  strokes: v.arrayOf((x, p) => (Array.isArray(x) ? null : fail(p, 'stroke is not an array'))),
  hints: v.int,
  answerSeen: v.bool,
  hintRange: (x, p) => (x === null || Array.isArray(x) || isPlainObject(x) ? null : fail(p, 'bad hintRange')),
  referenceReady: v.bool,
  // P1-E8（03 P165）：只对当前这一个字切换写字方式（true 纸上 / false 屏幕；缺省跟 settings.writeMode）。推进时随 current 重置。
  paper: v.bool,
};

const itemFields = {
  cardKey: v.cardKey,
  recordId: v.recordId,
  kind: v.oneOf(ITEM_KINDS),
  fsrsBefore: (x, p) => (x !== null && typeof x === 'object' ? null : fail(p, 'not an object/array')),
};

const lastLineFields = {
  recordId: v.recordId,
  kind: v.oneOf(['record', 'changed', 'saw']),
};

const sessionFields = {
  id: v.sessionId,
  slot: v.oneOf(['A', 'B']),
  kind: v.oneOf(SESSION_KINDS),
  source: (x, p) => checkFields(x, p, { view: v.str, char: v.char }, ['view']),
  queue: v.arrayOf(v.cardKey),
  cursor: v.int,
  items: v.arrayOf((x, p) => checkFields(x, p, itemFields, ['cardKey', 'kind'])),
  current: (x, p) => (x === null ? null : checkFields(x, p, currentFields, ['phase', 'strokes'])),
  lastLine: (x, p) => (x === null ? null : checkFields(x, p, lastLineFields, ['recordId', 'kind'])),
  startedAt: v.num,
  startedDay: v.day,
  updatedAt: v.num,
  endedAt: v.num,
  endedEarly: v.bool,
  // 阶段 1 P1-E7（D31 / D46 ⑥）：结果页「放进去」的记录 id（写错且有墨的字手动放进作品 / 图片）；随会话存，刷新后仍在
  added: v.arrayOf(v.recordId),
  // 第三轮 C3-R（I3-05）：结果页落印的时刻；记下后刷新 / 冷启动恢复结果页不再重演落印、不再响落款声与触觉
  sealedAt: v.num,
};

export function validateSession(session, path = 'session', slot = null) {
  const err = checkFields(session, path, sessionFields,
    ['id', 'slot', 'kind', 'source', 'queue', 'cursor', 'items', 'startedAt', 'startedDay', 'updatedAt']);
  if (err) return err;
  if (slot && session.slot !== slot) return fail(`${path}.slot`, `must be ${slot}`);
  if (session.slot === 'A' && session.kind === 'picked') return fail(`${path}.kind`, 'slot A holds first/daily only');
  if (session.slot === 'B' && session.kind !== 'picked') return fail(`${path}.kind`, 'slot B holds picked only');
  if (session.cursor > session.queue.length) return fail(`${path}.cursor`, 'beyond queue');
  return null;
}

function validateSessions(value, path) {
  const fields = {
    A: (x, p) => (x === null ? null : validateSession(x, p, 'A')),
    B: (x, p) => (x === null ? null : validateSession(x, p, 'B')),
    lastEnded: (x, p) => checkFields(x, p, {
      A: (y, q) => (y === null ? null : validateSession(y, q, 'A')),
      B: (y, q) => (y === null ? null : validateSession(y, q, 'B')),
    }, []),
  };
  return checkFields(value, path, fields, ['A', 'B', 'lastEnded']);
}

function validateSafety(value, path) {
  const fields = {
    version: v.int,
    kind: v.oneOf(['restore', 'clear']),
    createdAt: v.num,
    backupDate: v.strOrNull,
    count: v.int,
    // 白名单键的原始字串；另可带 shizi.v2.sessions（替换 / 清空前的会话，形状同 shizi.v2.sessions，撤销时还原，P79）。
    payload: (x, p) => checkMap(x, p, key => isBackupKey(key) || key === KEYS.sessions, (raw, q, key) => {
      const err = v.str(raw, q);
      if (err || key !== KEYS.sessions) return err;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return fail(q, 'not JSON');
      }
      return validateSessions(parsed, q);
    }),
  };
  return checkFields(value, path, fields, ['version', 'kind', 'createdAt', 'payload']);
}

function validateTxn(value, path) {
  const fields = {
    label: v.str,
    at: v.num,
    keys: v.arrayOf(v.str),
    prev: (x, p) => checkMap(x, p, () => true, v.strOrNull),
    phase: v.oneOf(['writing', 'done']),
  };
  const err = checkFields(value, path, fields, ['label', 'at', 'keys', 'prev', 'phase']);
  if (err) return err;
  for (const key of value.keys) if (!hasOwn(value.prev, key)) return fail(`${path}.prev`, `missing prev for ${key}`);
  return null;
}

// ---------------------------------------------------------------- 键表

/**
 * 全部 v2 键。pattern 键（records、ink 按月分键）用 match()，其余用 key 精确匹配。
 * validate(value, key) 接收 JSON.parse 后的值。
 */
export const KEY_SPECS = Object.freeze([
  { id: 'meta', key: KEYS.meta, domain: 'meta', validate: x => checkFields(x, 'meta', metaFields, ['schema', 'serial', 'createdAt', 'months']) },
  {
    id: 'records',
    pattern: `${RECORDS_PREFIX}<YYYY-MM>`,
    domain: 'records',
    match: isRecordsKey,
    validate: (x, key) => validateRecordsMonth(x, monthOfRecordsKey(key), key),
  },
  { id: 'sched', key: KEYS.sched, domain: 'sched', validate: x => checkMap(x, 'sched', isCardKey, (e, p) => checkFields(e, p, schedEntryFields, ['fsrs', 'due', 'lastJudgedAt'])) },
  {
    id: 'ink',
    pattern: `${INK_PREFIX}<YYYY-MM>`,
    domain: 'ink',
    match: isInkKey,
    // 形状层只校验「recordId → Ink（v3，或旧 v2）」；墨迹与记录的月份归属由 store 的读写 helper 保证（inkMonthOf）。
    validate: (x, key) => checkMap(x, key || 'ink', isRecordId, checkInk),
  },
  { id: 'custom', key: KEYS.custom, domain: 'custom', validate: x => checkFields(x, 'custom', customFields, ['added']) },
  { id: 'wordOff', key: KEYS.wordOff, domain: 'wordOff', validate: x => checkMap(x, 'wordOff', isCardKey, v.num) },
  { id: 'settings', key: KEYS.settings, domain: 'settings', validate: x => checkFields(x, 'settings', settingsFields, []) },
  { id: 'photos', key: KEYS.photos, domain: 'photos', validate: x => checkMap(x, 'photos', isSingleChar, (e, p) => checkFields(e, p, photoFields, ['day', 'at', 'dataURL'])) },
  { id: 'legacy', key: KEYS.legacy, domain: 'legacy', validate: x => checkFields(x, 'legacy', legacyFields, ['importedAt', 'fromKeys', 'days', 'report']) },
  { id: 'backupMeta', key: KEYS.backupMeta, domain: 'backupMeta', validate: x => checkFields(x, 'backupMeta', backupMetaFields, []) },
  { id: 'sessions', key: KEYS.sessions, domain: 'sessions', validate: x => validateSessions(x, 'sessions') },
  // 漏斗内部结构由后续卡定义；形状层只要求对象。
  { id: 'funnel', key: KEYS.funnel, domain: 'funnel', validate: x => (isPlainObject(x) ? null : fail('funnel', 'not an object')) },
  { id: 'safety', key: KEYS.safety, domain: 'safety', validate: x => validateSafety(x, 'safety') },
  { id: 'txn', key: KEYS.txn, domain: null, validate: x => validateTxn(x, 'txn') },
  // 审查整改 F1：路由提示。形状层只要求对象（坏 JSON 才隔离）；内容由 ui/route-memory.parseRoute 严格校验，不合格只是不恢复。
  { id: 'route', key: KEYS.route, domain: null, validate: x => (isPlainObject(x) ? null : fail('route', 'not an object')) },
]);

/** 进备份的键（显式清单，01 §3.6「进备份：是」）。 */
export const BACKUP_WHITELIST = Object.freeze([
  'meta', 'records', 'sched', 'ink', 'custom', 'wordOff', 'settings', 'photos', 'legacy', 'backupMeta',
]);

/** 不进备份的键（显式清单，01 §3.6「进备份：否」）。shizi.corrupt.* 与 nativeSmoke 不在 v2 命名空间，另行排除。 */
export const BACKUP_EXCLUDED = Object.freeze(['sessions', 'funnel', 'safety', 'txn', 'route']);

const SPEC_BY_ID = new Map(KEY_SPECS.map(spec => [spec.id, spec]));

/** key → spec；不认识的键（含非 v2 键、probe）返回 null。 */
export function specForKey(key) {
  if (!isString(key)) return null;
  if (isRecordsKey(key)) return SPEC_BY_ID.get('records');
  if (isInkKey(key)) return SPEC_BY_ID.get('ink');
  for (const spec of KEY_SPECS) if (spec.key === key) return spec;
  return null;
}

export function isBackupKey(key) {
  const spec = specForKey(key);
  return !!spec && BACKUP_WHITELIST.indexOf(spec.id) >= 0;
}

/** 对已解析的值做形状校验。未知键返回错误。 */
export function validateValue(key, value) {
  const spec = specForKey(key);
  if (!spec) return fail(key, 'unknown key');
  return spec.validate(value, key);
}

/** 对原始字串做 JSON 解析 + 形状校验：{ok:true, value} | {ok:false, reason}。 */
export function parseAndValidate(key, raw) {
  if (!isString(raw)) return { ok: false, reason: fail(key, 'value is not a string') };
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: fail(key, 'invalid JSON') };
  }
  const err = validateValue(key, value);
  return err ? { ok: false, reason: err } : { ok: true, value };
}

/** 域 → 键（records / ink 需给 month）。 */
export function keyForDomain(domain, month) {
  if (domain === 'records') return recordsKey(month);
  if (domain === 'ink') return inkKey(month);
  const key = KEYS[domain];
  if (!key || DOMAINS.indexOf(domain) < 0) throw new Error(`unknown domain ${domain}`);
  return key;
}

// ---------------------------------------------------------------- 备份外壳（01 §3.6）

/**
 * 校验 v2 备份外壳 `{app:'shizi', version:2, date, data:{'shizi.v2.*': JSON 字串}}`。
 * 任一白名单键坏 → 整单拒绝（不返回部分结果）。不在白名单里的键（sessions 等）忽略。
 * 必须含 meta。返回 {ok:true, entries:[[key, raw]], ignored:[key]} | {ok:false, reason, key?}。
 * version 1 返回 {ok:false, reason:'v1'}，由 v1 导入器（M5-4）接手。
 * 纯函数，不触碰存储。
 */
export function parseBackupV2(obj) {
  if (!isPlainObject(obj) || obj.app !== APP_ID || !isPlainObject(obj.data)) return { ok: false, reason: 'format' };
  if (obj.version === 1) return { ok: false, reason: 'v1' };
  if (obj.version !== BACKUP_VERSION) return { ok: false, reason: 'version' };
  const entries = [];
  const ignored = [];
  for (const key of Object.keys(obj.data)) {
    if (!isBackupKey(key)) {
      ignored.push(key);
      continue;
    }
    const raw = obj.data[key];
    if (!isString(raw)) return { ok: false, reason: 'value', key };
    const parsed = parseAndValidate(key, raw);
    if (!parsed.ok) return { ok: false, reason: 'shape', key, detail: parsed.reason };
    entries.push([key, raw]);
  }
  if (!entries.some(([key]) => key === KEYS.meta)) return { ok: false, reason: 'empty' };
  return { ok: true, entries, ignored };
}
