// 形状表域（src/core/schema.js；B4.1）：随机合法值 / 变异值喂 validateValue、parseAndValidate、parseBackupV2、models.roundtrip，以及键工具。
import { shapes } from '../lib/shapes.mjs';

const KEY_ATOMS = ['shizi.v2.meta', 'shizi.v2.sched', 'shizi.v2.sessions', 'shizi.v2.probe', 'shizi.v2.records.2026-09', 'shizi.v2.records.2026-13', 'shizi.v2.records.',
  'shizi.v2.ink.2026-09', 'shizi.v2.ink.2026-09.r12', 'shizi.v2.ink.2026-09.r0', 'shizi.v2.ink.2026-09.s1', 'shizi.v2.ink.2026-09r1', 'shizi.v2.ink.2026-09.', 'shizi.v2.ink.2026-09.r1.x',
  'shizi.v2.ink', 'shizi.corrupt.shizi.v2.meta', 'shizi.nativeSmoke.v1', 'shizi.v2.whatever', 'base:人', 'custom:𠮷', 'base:', 'base:ab', 'custom:é', 'base:\n', 'shizi.v2.records.2026-09́', 'é', '', 'constructor'];

export default {
  id: 'schema',
  prepare(g) {
    const S = shapes(g);
    g.shapes = S;
    g.schemaKey = () => g.weighted([[() => g.pick(KEY_ATOMS), 3], [() => S.forKind(g.pick(S.kinds)).key, 5], [() => g.string(8), 1]])();
    g.keyedValue = () => {
      const { key, value } = S.forKind(g.pick(S.kinds));
      return { key, value: S.maybeBad(value, 0.45) };
    };
  },
  ops: {
    'schema.keys': { weight: 0.2, args: () => ({}) },
    'schema.keyInfo': { weight: 1, args: (g) => ({ key: g.schemaKey() }) },
    'schema.keyFacts': { weight: 2, args: (g) => ({ key: g.schemaKey() }) },
    'schema.valueFacts': {
      weight: 2,
      args: (g) => ({
        value: g.weighted([
          [() => g.shapes.day(), 2], [() => g.pick(['2026-02-29', '2028-02-29', '0000-02-29', '0099-12-31', '0100-01-01', '2026-13-01', '2026-1-1', '２０２６-01-01']), 3],
          [() => g.shapes.cardKey(), 2], [() => g.pick(['base:人', 'base:ab', 'custom:', 'base:\u{20000}', 'x']), 2],
          [() => g.shapes.recordId(), 2], [() => g.shapes.sessionId(), 1], [() => g.pick(['r0', 'r01', 'r123456789012345678901234567890', 's9007199254740993', 'r']), 2],
          [() => g.shapes.month(), 1], [() => g.string(3), 1], [() => g.pick([null, 5, true, [], {}, ['2026-01-01']]), 1],
        ])(),
      }),
    },
    'schema.makeKey': { weight: 0.5, args: (g) => ({ month: g.chance(0.7) ? g.shapes.month() : g.string(4), id: g.chance(0.7) ? g.shapes.recordId() : g.string(3) }) },
    'schema.keyForDomain': { weight: 0.5, args: (g) => ({ domain: g.pick(['meta', 'records', 'ink', 'sched', 'sessions', 'txn', 'probe', 'route', 'toString', 'nope', 'safety', 'funnel']), ...(g.chance(0.6) ? { month: g.shapes.month() } : {}) }) },
    'schema.inkOf': {
      weight: 1,
      args: (g) => ({
        record: g.weighted([
          [() => g.shapes.record(g.int(1, 9), g.shapes.month()), 3],
          [() => ({ id: 'r1', at: g.pick([1789000000000, 0, -1, 1e15, 8.64e15, 8.64e15 + 1, 1.5e12 + 0.5]) }), 3],
          [() => ({ id: g.pick(['r1', 's1', 'x']), localDay: g.pick(['2026-09-30', '2026-02-30', null]), inkId: g.pick(['r4', 'x', 5]) }), 2],
          [() => g.pick([null, 5, 'x', [], {}, true]), 1],
        ])(),
      }),
    },
    'schema.validateValue': { weight: 10, args: (g) => g.keyedValue() },
    'models.roundtrip': { weight: 10, args: (g) => g.keyedValue() },
    'schema.parseAndValidate': {
      weight: 4,
      args: (g) => {
        const { key, value } = g.keyedValue();
        const raw = g.weighted([[() => JSON.stringify(value), 8], [() => g.pick(['{', '', 'null', '{"a":1}', '[]', '﻿{}']), 1], [() => g.pick([null, 5, {}, []]), 1]])();
        return { key, raw };
      },
    },
    'schema.parseBackupV2': {
      weight: 4,
      args: (g) => {
        const env = g.shapes.backupEnvelope();
        const bad = g.chance(0.5);
        return { obj: bad ? g.pick([g.shapes.mutate(env), g.shapes.mutate(env), { app: 'shizi', version: 1, data: {} }, { app: 'other', version: 2, data: {} }, null, [], 'x', { app: 'shizi', version: 2, data: [] }]) : env };
      },
    },
    'schema.validateRecord': {
      weight: 4,
      args: (g) => {
        const month = g.shapes.month();
        const r = g.shapes.maybeBad(g.shapes.record(g.int(1, 9), g.chance(0.7) ? month : undefined));
        return g.chance(0.5) ? { record: r, month } : { record: r };
      },
    },
    'schema.validateRecordsMonth': {
      weight: 3,
      args: (g) => {
        const month = g.shapes.month();
        return { value: g.shapes.maybeBad(g.shapes.recordsMonth(g.chance(0.85) ? month : g.shapes.month())), month };
      },
    },
    'schema.validateInk': { weight: 3, args: (g) => ({ value: g.shapes.maybeBad(g.shapes.ink()) }) },
    'schema.validateSession': {
      weight: 3,
      args: (g) => {
        const slot = g.pick(['A', 'B']);
        const s = g.shapes.maybeBad(g.shapes.session(g.chance(0.9) ? slot : g.pick(['A', 'B'])));
        const a = { session: s };
        if (g.chance(0.6)) a.slot = g.chance(0.85) ? slot : g.pick(['A', 'B', '']);
        return a;
      },
    },
  },
};
