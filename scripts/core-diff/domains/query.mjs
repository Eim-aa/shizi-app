// 查字域（src/core/query.js；B4.3）：拼音比较键 / 拼音输入 / 拼音匹配、输入过滤与提示、记录域平铺、自选字、逐字摘要与行尾状态、视图与底栏。
import { b43, CHARS, DAYS } from '../lib/b43-shapes.mjs';

const PY = ['hǎo', 'lǜ', 'nǚ', 'Lüè', 'v', 'xí', 'zhōng', 'zhong', 'ZHONG', "xi'an", 'xī ān', 'ǖ', 'İ', 'K', 'ß', 'ａ', 'abc', 'shen', 'sheng', 'shí', 'ér', '', ' ', 'a1b2', 'ǹ', 'ń', 'ḿ', 'ɡ', 'ꞵ', 'ǆ'];
const INPUTS = ['人口拾', '人人口', 'abc', '人 口a', '', ' ', '静亦静亦', '𠮷人', '12', '!!', '人口，拾', 'ａｂ', 'ü', '字\n字', '汉', '漢字', 'xí', "x'y", 'a b', 'ǖ', 'ĳ', 'Å', 'Ω', 'z​', '⺀', '〇', '々', '\u{2A700}', '\u{3134A}', '\u{323B0}', '龘龘龘龘', '人1口2', '〆', 'ー'];

export default {
  id: 'query',
  prepare(g) {
    g.pyText = () => g.weighted([[() => g.pick(PY), 6], [() => g.pick(PY) + g.pick(PY), 2], [() => g.string(4), 1], [() => g.pick([null, 5, true, [], {}, ['a'], [1, 2]]), 1]])();
    g.inputText = () => g.weighted([[() => g.pick(INPUTS), 6], [() => g.pick(INPUTS) + g.pick(INPUTS), 3], [() => g.string(5), 1], [() => g.pick([null, 5, [], {}]), 1]])();
    g.customVal = () => g.weighted([[() => ({ added: Array.from({ length: g.int(0, 3) }, () => g.pick([{ char: g.pick(CHARS), at: 1 }, { char: g.pick(CHARS) }, { char: '' }, null, 5, {}])) }), 6], [() => g.pick([null, {}, { added: null }, { added: 'x' }, [], 5, { added: [], other: 1 }, { other: 1 }]), 3]])();
  },
  ops: {
    'query.pyKey': { weight: 3, args: (g) => ({ py: g.pyText() }) },
    'query.parsePinyinInput': { weight: 3, args: (g) => ({ text: g.weighted([[() => g.inputText(), 4], [() => g.pick(PY), 4], [() => ` ${g.pick(PY)} `, 1]])() }) },
    'query.pinyinMatches': {
      weight: 3,
      args: (g) => {
        const entries = Array.from({ length: g.int(0, 8) }, () => g.weighted([[() => ({ char: g.pick(CHARS), key: g.pick(['a', 'ab', 'abc', 'zhong', 'zhongg', 'u', 'ui', 'x']) }), 8], [() => g.pick([null, {}, { char: '', key: 'a' }, { char: 'x', key: '' }, 5, { char: 'x' }]), 1]])());
        const a = { query: g.pick(['a', 'ab', 'zhong', 'u', 'x', 'q', '', 'abc']), entries };
        if (g.chance(0.5)) a.written = Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS));
        if (g.chance(0.4)) a.max = g.pick([1, 2, 100, 0, -1, 1.5, null, 3]);
        return a;
      },
    },
    'query.writtenChars': { weight: 1, args: (g) => ({ records: b43(g).records(10) }) },
    'query.isHan': { weight: 2, args: (g) => ({ value: g.weighted([[() => g.pick(INPUTS.concat(CHARS)), 6], [() => g.pick([null, 5, [], '', '人口', '\u{2A700}', '\u{20000}', 'a', '〇']), 3]])() }) },
    'query.filterInput': {
      weight: 4,
      args: (g) => {
        const a = { text: g.inputText() };
        if (g.chance(0.5)) a.max = g.pick([1, 2, 3, 5, 0, -1, 1.5, null, 'x', 100]);
        return a;
      },
    },
    'query.filterNotes': {
      weight: 3,
      args: (g) => {
        const text = g.inputText();
        const cap = g.pick([null, 1, 2, 3]);
        // 与 filterInput 同一形状（由 JS 现算一份：这里手工造，覆盖各分支）
        const chars = Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS));
        const a = { filtered: { chars, removed: g.pick([0, 0, 1, 3]), duplicates: Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS)), hanCount: g.int(0, 6), overLimit: g.int(0, 2), total: g.int(0, 9) } };
        void text; void cap;
        if (g.chance(0.85)) a.view = g.pick(['rows', 'card', 'bad', 'hint']);
        if (g.chance(0.05)) a.filtered = null;
        return a;
      },
    },
    'query.flattenRecords': {
      weight: 2,
      args: (g) => {
        const B = b43(g);
        const domain = {};
        for (const m of ['2026-09', '2026-08', '2026-10', '0', '10', '2']) {
          if (g.chance(0.5)) domain[m] = g.weighted([[() => B.records(3), 4], [() => ({ folded: true, kept: B.records(3) }), 3], [() => g.pick([null, {}, 5, { kept: null }]), 1]])();
        }
        return { domain: g.chance(0.95) ? domain : g.pick([null, [], 5]) };
      },
    },
    'query.isPracticable': {
      weight: 2,
      args: (g) => {
        const a = { char: g.pick(INPUTS.concat(CHARS)) };
        if (g.chance(0.7)) a.deck = Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS));
        if (g.chance(0.7)) a.library = Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS));
        return a;
      },
    },
    'query.customChars': { weight: 1, args: (g) => ({ custom: g.customVal() }) },
    'query.isCustom': { weight: 1, args: (g) => ({ custom: g.customVal(), char: g.pick(CHARS) }) },
    'query.withCustomAdded': { weight: 2, args: (g) => ({ custom: g.customVal(), char: g.weighted([[() => g.pick(CHARS), 6], [() => g.pick(['', 'ab', 5, null, 'a']), 2]])(), at: g.pick([1, 1789000000000, 1.5, null, 'x', 0]) }) },
    'query.charSummary': {
      weight: 3,
      args: (g) => {
        const B = b43(g);
        const records = B.records(10);
        const a = { char: g.pick(CHARS), records };
        if (g.chance(0.8)) a.sched = g.chance(0.9) ? B.schedFor(records) : g.pick([null, [], 'x']);
        if (g.chance(0.6)) a.custom = g.customVal();
        if (g.chance(0.7)) a.practicable = g.pick([true, false, 1, 0, 'x', null]);
        return a;
      },
    },
    'query.rowStatus': { weight: 2, args: (g) => ({ summary: { practicable: g.pick([true, false, 0, 1, null]), custom: g.pick([true, false, 0, 1]), count: g.pick([0, 1, 2, 7, null, 'x']) } }) },
    'query.cardStat': { weight: 2, args: (g) => ({ summary: { count: g.pick([0, 1, 5, null]), latestDay: g.pick([null, '', ...DAYS]) } }) },
    'query.queryView': {
      weight: 2,
      args: (g) => {
        const chars = Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS));
        const a = { chars };
        if (g.chance(0.6)) a.cur = g.pick(CHARS.concat(['']));
        if (g.chance(0.7)) a.practicable = Array.from({ length: g.int(0, 3) }, () => g.pick(CHARS));
        return a;
      },
    },
    'query.selectedChars': {
      weight: 2,
      args: (g) => {
        const a = { chars: Array.from({ length: g.int(0, 4) }, () => g.pick(CHARS)), selected: Array.from({ length: g.int(0, 4) }, () => g.pick(CHARS)) };
        if (g.chance(0.5)) a.practicable = Array.from({ length: g.int(0, 4) }, () => g.pick(CHARS));
        return a;
      },
    },
    'query.pickBar': { weight: 1.5, args: (g) => ({ count: g.pick([0, 1, 2, 5, null, NaN === 1 ? 0 : '1', 1.5, -1, true, 'x']) }) },
    'query.normalizeMode': { weight: 1, args: (g) => ({ mode: g.pick(['lookup', 'pick', 'rows', '', null, 5]), ...(g.chance(0.3) ? { policy: g.pick([{ queryModes: ['a', 'b'] }, { queryModes: ['lookup'] }, {}]) } : {}) }) },
  },
};
