// 配置 / 题库 / 题记 / 文案 / 落款汉字数字域（B4.1）：config.get 逐名比对生成资源与 src/，deck.* 抽样比对题库，epigraphs / copy / cn* 随机输入。
import { COPY } from '../../../src/config/copy/index.js';
import { deckSources } from '../../build_core_config.mjs';

const CONFIG_NAMES = ['policy', 'policy-meta', 'motion', 'char-order', 'epigraphs', 'credits', 'deck-meta', 'signature', 'copy'];
const COPY_KEYS = Object.keys(COPY);
const PLACEHOLDERS = ['n', 'm', 'date', 'char', 'count', 'total', 'name', 'day', 'month', 'year', 'x', 'A', 'z'];
let deck = null;

export default {
  id: 'config',
  prepare(g) {
    deck = deck || deckSources();
    const seed = deck.seed;
    g.deckChar = () => g.weighted([
      [() => seed[g.int(0, seed.length - 1)].target, 6],
      [() => g.pick(Object.keys(deck.overrides)), 3],
      [() => g.pick(['人', '拾', 'x', '', '𠮷', '龘']), 1],
    ])();
    g.copyVars = () => {
      const o = {};
      const n = g.int(0, 4);
      for (let i = 0; i < n; i += 1) {
        o[g.chance(0.85) ? g.pick(PLACEHOLDERS) : g.string(3)] = g.weighted([
          [() => g.int(-5, 9999), 3],
          [() => g.string(4), 3],
          [() => g.number(), 1],
          [() => g.pick([null, true, false, [], [1, null, 'a'], { a: 1 }, [[1, 2], 'x']]), 2],
        ])();
      }
      return o;
    };
    g.cnNumber = () => g.weighted([
      [() => g.int(0, 9999), 6],
      [() => g.pick([0, 1, 2, 9, 10, 11, 12, 19, 20, 22, 100, 101, 110, 200, 202, 2000, 2002, 2020, 2026, 9999, 10000, -1, 1.5, -0, 1e21, 1e300, 2 ** 53]), 4],
      [() => g.int(-10, 20000), 1],
    ])();
  },
  ops: {
    'config.get': { weight: 3, args: (g) => ({ name: g.chance(0.95) ? g.pick(CONFIG_NAMES) : g.pick(['deck', 'nope', '', 'toString', '__proto__']) }) },
    'deck.meta': { weight: 1, args: () => ({}) },
    'deck.seed': { weight: 4, args: (g) => ({ index: g.chance(0.9) ? g.int(0, 8200) : g.pick([-1, 8105, 99999, 0]) }) },
    'deck.override': { weight: 3, args: (g) => ({ char: g.deckChar() }) },
    'deck.groups': { weight: 3, args: (g) => ({ char: g.deckChar() }) },
    'epigraphs.index': { weight: 2, args: (g) => ({ day: g.day() }) },
    'epigraphs.for': { weight: 2, args: (g) => ({ day: g.day() }) },
    'epigraphs.author': { weight: 2, args: (g) => ({ source: g.pick(['孙过庭《书谱》', '杜甫《偶题》', '《无作者》', '  苏轼 《石》', '', '无书名号', '作者　《x》', '﻿作者《x》', g.string(5)]) }) },
    'copy.has': { weight: 1, args: (g) => ({ key: g.chance(0.8) ? g.pick(COPY_KEYS) : g.pick(['nope', '', 'constructor']) }) },
    'copy.t': {
      weight: 6,
      args: (g) => {
        const a = { key: g.chance(0.95) ? g.pick(COPY_KEYS) : g.pick(['nope', '', 'toString']) };
        if (g.chance(0.7)) a.vars = g.copyVars();
        return a;
      },
    },
    'copy.format': {
      weight: 2,
      args: (g) => {
        const t = g.weighted([[() => g.pick(COPY_KEYS.map((k) => COPY[k])), 4], [() => g.pick(['{n}', 'a{n}b{m}', '{}', '{ n }', '{n', 'n}', '{{n}}', '{é}', '{n}{n}', '拾{date}']), 3], [() => g.string(5), 1]])();
        const a = { template: t };
        if (g.chance(0.8)) a.vars = g.copyVars();
        return a;
      },
    },
    'copy.inkKey': { weight: 1, args: (g) => (g.chance(0.5) ? { base: g.pick(['R-A1.line', 'x']) } : { base: g.pick(['R-A1.line', 'x']), perRecordInk: g.chance(0.5) }) },
    'copy.tRef': {
      weight: 2,
      args: (g) => ({
        value: g.weighted([
          [() => ({ copy: g.pick(COPY_KEYS), ...(g.chance(0.6) ? { params: g.copyVars() } : {}) }), 5],
          [() => ({ copy: g.pick(COPY_KEYS), params: { n: { copy: g.pick(COPY_KEYS) }, m: 3 } }), 1],
          [() => g.pick([null, '', 'plain', 5, { copy: 5 }, { a: 1 }, ['x'], { copy: 'nope' }]), 2],
        ])(),
      }),
    },
    'dates.cnDigits': { weight: 2, args: (g) => ({ n: g.cnNumber() }) },
    'dates.cnNumber': { weight: 3, args: (g) => ({ n: g.cnNumber() }) },
    'dates.cnCount': { weight: 3, args: (g) => ({ n: g.cnNumber() }) },
    'dates.signatureDateParts': { weight: 2, args: (g) => ({ day: g.day() }) },
    'dates.signatureMonthParts': { weight: 2, args: (g) => ({ month: g.month() }) },
  },
};
