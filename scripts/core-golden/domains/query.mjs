// 金标准 · 查字（src/core/query.js；B4.3）。随机差分生成器的固定种子取样 + 手选向量（拼音比较键 / 输入过滤 / 汉字判定的边角）。
import { groupsFor } from '../lib/b43-golden.mjs';

function hand() {
  const R = [];
  const op = (name, args) => R.push({ op: name, args });
  for (const py of ['hǎo', 'lǜ', 'nǚ', 'Lüè', 'v', 'xí', 'ZHONG', "xi'an", 'ǖ', 'İ', 'K', 'ß', 'ａ', '', ' ', null, 5, ['a', 'b'], 'a1b2']) op('query.pyKey', { py });
  for (const text of ['hǎo', 'zhong guo', "xi'an", '人', '', ' ', 'ü', 'abc人', 'ĳ', 'Å', 'Ω', '\u{1F600}', 'á', 'a​b', null, 5]) op('query.parsePinyinInput', { text });
  for (const text of ['人口拾', '人人口', 'abc', '人 口a', '', '静亦静亦', '𠮷人', '漢字', '々〆〇', '\u{2A700}\u{2EBF0}\u{31350}\u{323AF}\u{323B0}', '龘龘龘龘', null, 5]) {
    op('query.filterInput', { text });
    op('query.filterInput', { text, max: 2 });
    op('query.filterInput', { text, max: null });
    op('query.filterInput', { text, max: 0 });
  }
  for (let cp = 0x2E80; cp < 0x2E80 + 3; cp += 1) op('query.isHan', { value: String.fromCodePoint(cp) });
  for (const cp of [0x4DFF, 0x4E00, 0x9FFF, 0xA000, 0x3005, 0x3006, 0x3007, 0x3021, 0x3029, 0x3038, 0x303B, 0x303C, 0x3400, 0x4DBF, 0xF900, 0xFAD9, 0xFADA, 0x16FE2, 0x16FE3, 0x16FF0, 0x20000, 0x2A6DF, 0x2A6E0, 0x2EBE0, 0x2EBF0, 0x2F800, 0x30000, 0x31350, 0x323AF, 0x323B0, 0xE0100]) op('query.isHan', { value: String.fromCodePoint(cp) });
  op('query.isHan', { value: '人口' });
  op('query.isHan', { value: '' });
  op('query.isHan', { value: null });
  op('query.normalizeMode', { mode: 'lookup' });
  op('query.normalizeMode', { mode: 'rows' });
  op('query.pickBar', { count: 0 });
  op('query.pickBar', { count: 1 });
  op('query.pickBar', { count: 3 });
  return R;
}

export default {
  id: 'query',
  source: 'src/core/query.js',
  build({ withTZ, opCases }) {
    return { groups: groupsFor('query', { seed: 4302, perOp: 16, hand: hand(), withTZ, opCases }) };
  },
};
