// B4.1 的 JS 参考 op（配置 / 题库 / 题记 / 文案 / 落款汉字数字 / 形状表 / 模型往返）。与 ios/ShiziCore/Sources/ShiziCore/Engine/{ConfigOps,SchemaOps}.swift
// 同名、同参数校验、同错误码；规则一律直接调 src/，这里只做协议适配。
import * as dates from '../../../src/core/dates.js';
import * as schema from '../../../src/core/schema.js';
import { epigraphAuthor, epigraphFor, epigraphIndexFor } from '../../../src/config/epigraphs.js';
import { format as copyFormat, has as copyHas, inkKey, t as copyT, tRef } from '../../../src/config/copy/index.js';
import { deckSources, sources } from '../../build_core_config.mjs';

const SOURCES = await sources();
let deckCache = null;
const deck = () => deckCache || (deckCache = deckSources());

const has = (a, k) => Object.prototype.hasOwnProperty.call(a, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function makeB41Ops({ required, str, finite, int, badArgs }) {
  const optStr = (a, k) => {
    if (!has(a, k)) return undefined;
    if (typeof a[k] !== 'string') throw badArgs(k + ' must be a string');
    return a[k];
  };
  const varsOf = (a) => {
    if (!has(a, 'vars')) return undefined;
    if (!isObj(a.vars)) throw badArgs('vars must be an object');
    return a.vars;
  };
  const orNull = (x) => (x === undefined ? null : x);

  return {
    'config.get': (a) => {
      const name = str(a, 'name');
      if (!has(SOURCES, name)) throw new RangeError('unknown config: ' + name);
      return SOURCES[name];
    },

    'deck.meta': () => ({
      key: SOURCES['deck-meta'].DECK_KEY,
      fingerprint: SOURCES['deck-meta'].DECK_FINGERPRINT,
      seed: deck().seed.length,
      overrides: Object.keys(deck().overrides).length,
      groups: Object.keys(deck().groups).length,
    }),
    'deck.seed': (a) => {
      const i = int(a, 'index', 10000000);
      const seed = deck().seed;
      return i >= 0 && i < seed.length ? seed[i] : null;
    },
    'deck.override': (a) => {
      const c = str(a, 'char');
      return has(deck().overrides, c) ? deck().overrides[c] : null;
    },
    'deck.groups': (a) => {
      const c = str(a, 'char');
      return has(deck().groups, c) ? deck().groups[c] : null;
    },

    'epigraphs.index': (a) => epigraphIndexFor(required(a, 'day')),
    'epigraphs.for': (a) => epigraphFor(required(a, 'day')),
    'epigraphs.author': (a) => epigraphAuthor({ source: str(a, 'source') }),

    'copy.has': (a) => copyHas(str(a, 'key')),
    'copy.t': (a) => copyT(str(a, 'key'), varsOf(a)),
    'copy.format': (a) => {
      const template = required(a, 'template');
      if (typeof template !== 'string' && !Array.isArray(template)) throw badArgs('template must be a string or an array');
      return copyFormat(template, varsOf(a));
    },
    'copy.inkKey': (a) => {
      const base = str(a, 'base');
      if (has(a, 'perRecordInk')) {
        if (typeof a.perRecordInk !== 'boolean') throw badArgs('perRecordInk must be a boolean');
        return inkKey(base, { features: { perRecordInk: a.perRecordInk } });
      }
      return inkKey(base);
    },
    'copy.tRef': (a) => tRef(required(a, 'value')),

    'dates.cnDigits': (a) => dates.cnDigits(finite(required(a, 'n'), 'n')),
    'dates.cnNumber': (a) => dates.cnNumber(finite(required(a, 'n'), 'n')),
    'dates.cnCount': (a) => dates.cnCount(finite(required(a, 'n'), 'n')),
    'dates.signatureDateParts': (a) => dates.signatureDateParts(required(a, 'day')),
    'dates.signatureMonthParts': (a) => dates.signatureMonthParts(required(a, 'month')),

    'schema.keys': () => ({
      KEYS: schema.KEYS,
      DOMAINS: schema.DOMAINS,
      BACKUP_WHITELIST: schema.BACKUP_WHITELIST,
      BACKUP_EXCLUDED: schema.BACKUP_EXCLUDED,
      KEY_SPECS: schema.KEY_SPECS.map((s) => ({ id: s.id, key: orNull(s.key), pattern: orNull(s.pattern), domain: orNull(s.domain) })),
    }),
    'schema.keyInfo': (a) => {
      const key = str(a, 'key');
      const spec = schema.specForKey(key);
      return spec ? { id: spec.id, domain: orNull(spec.domain), backup: schema.isBackupKey(key) } : null;
    },
    'schema.keyFacts': (a) => {
      const key = str(a, 'key');
      return {
        isRecordsKey: schema.isRecordsKey(key),
        monthOfRecordsKey: schema.monthOfRecordsKey(key),
        isInkKey: schema.isInkKey(key),
        monthOfInkKey: schema.monthOfInkKey(key),
        parseInkRecordKey: schema.parseInkRecordKey(key),
        isInkStorageKey: schema.isInkStorageKey(key),
        monthOfKey: orNull(schema.monthOfKey(key)),
        isBackupKey: schema.isBackupKey(key),
        isCardKey: schema.isCardKey(key),
        charOfCardKey: schema.charOfCardKey(key),
        corruptKeyFor: schema.corruptKeyFor(key),
      };
    },
    'schema.valueFacts': (a) => {
      const v = required(a, 'value');
      return {
        isLocalDay: schema.isLocalDay(v),
        isSingleChar: schema.isSingleChar(v),
        isMonthKey: schema.isMonthKey(v),
        isCardKey: schema.isCardKey(v),
        isRecordId: schema.isRecordId(v),
        isSessionId: schema.isSessionId(v),
        serialOf: schema.serialOf(v),
      };
    },
    'schema.makeKey': (a) => {
      const month = str(a, 'month');
      const id = str(a, 'id');
      return { recordsKey: schema.recordsKey(month), inkKey: schema.inkKey(month), inkRecordKey: schema.inkRecordKey(month, id) };
    },
    'schema.keyForDomain': (a) => schema.keyForDomain(str(a, 'domain'), optStr(a, 'month')),
    'schema.inkOf': (a) => {
      const record = required(a, 'record');
      return { month: schema.inkMonthOf(record), id: schema.inkIdOf(record) };
    },
    'schema.validateValue': (a) => schema.validateValue(str(a, 'key'), required(a, 'value')),
    'schema.parseAndValidate': (a) => {
      const r = schema.parseAndValidate(str(a, 'key'), required(a, 'raw'));
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    },
    'schema.parseBackupV2': (a) => schema.parseBackupV2(required(a, 'obj')),
    'schema.validateRecord': (a) => schema.validateRecord(required(a, 'record'), 'record', optStr(a, 'month') ?? null),
    'schema.validateRecordsMonth': (a) => schema.validateRecordsMonth(required(a, 'value'), str(a, 'month')),
    'schema.validateInk': (a) => schema.validateInk(required(a, 'value')),
    'schema.validateSession': (a) => schema.validateSession(required(a, 'session'), 'session', optStr(a, 'slot') ?? null),

    // 形状表通过的值，经模型解码再编码必须与原值逐字节相同；JS 一侧是恒等（Swift 一侧才真的走模型）。
    'models.roundtrip': (a) => {
      const key = str(a, 'key');
      const value = required(a, 'value');
      const err = schema.validateValue(key, value);
      return err ? { valid: false, reason: err } : { valid: true, value };
    },
  };
}

