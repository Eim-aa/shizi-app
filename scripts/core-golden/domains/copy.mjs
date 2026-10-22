// 金标准 · 文案取用（src/config/copy/index.js：占位符填充、取用、笔迹槽、文案引用）。
// 文案本身来自生成的 copy.json；这里的期望值是参考引擎对「全部键 × 若干参数」的回包。
import { COPY } from '../../../src/config/copy/index.js';

const VARS = [
  undefined,
  {},
  { n: 3, total: 5, m: 2, k: 1, date: '9月24日', char: '人', chars: '人口', count: 80, name: 'x', day: 24, month: 9, year: 2026 },
  { n: 0, total: 0.5, date: null, char: '', chars: [1, null, 'a'], count: true },
  { n: { a: 1 }, total: [[1, 2], 'x'], m: -0, k: 1e21, date: false },
];

export default {
  id: 'copy',
  source: 'src/config/copy/index.js',
  build({ withTZ, opCases }) {
    const R = [];
    for (const key of Object.keys(COPY)) {
      R.push({ op: 'copy.has', args: { key } });
      for (const vars of VARS) R.push({ op: 'copy.t', args: vars === undefined ? { key } : { key, vars } });
    }
    for (const key of ['nope', '', 'toString', 'constructor', '__proto__']) {
      R.push({ op: 'copy.has', args: { key } });
      R.push({ op: 'copy.t', args: { key } });
    }
    for (const template of ['{n}', 'a{n}b{m}', '{}', '{ n }', '{n', 'n}', '{{n}}', '{é}', '{n}{n}', '{n}{', '}{n}{', '拾{date}', '', ['{n}', 'x{m}', ''], []]) {
      for (const vars of VARS) R.push({ op: 'copy.format', args: vars === undefined ? { template } : { template, vars } });
    }
    for (const base of ['R-A1.line', 'x', '']) {
      R.push({ op: 'copy.inkKey', args: { base } });
      R.push({ op: 'copy.inkKey', args: { base, perRecordInk: true } });
      R.push({ op: 'copy.inkKey', args: { base, perRecordInk: false } });
    }
    const keys = Object.keys(COPY);
    for (const value of [{ copy: keys[0] }, { copy: 'R-H04.resumeDaily', params: { n: 3, total: 5 } }, { copy: 'R-H02.line', params: { date: { copy: 'R-H02.dateFormat', params: { month: 9, day: 24 } }, period: { copy: 'R-H02.period.dawn' } } },
      null, '', 'plain', 5, { copy: 5 }, { a: 1 }, ['x'], { copy: 'nope' }]) R.push({ op: 'copy.tRef', args: { value } });
    return { groups: [withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases(R) }))] };
  },
};
