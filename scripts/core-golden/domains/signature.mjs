// 金标准 · 落款汉字数字与首页题记（src/core/dates.js cnDigits / cnNumber / cnCount / signature*；src/config/epigraphs.js）。
// 汉字来自生成的 signature.json，Swift 源码里没有汉字字面量；期望值就是参考引擎的回包。
const DAYS = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-01-01', '2026-12-31', '2024-02-29', '2000-01-10', '2100-11-20', '0050-01-01', '1999-10-10', '9999-12-31',
  '2026-02-30', '2026-13-01', '', 'x', null, 20260101];

export default {
  id: 'signature',
  source: 'src/core/dates.js（落款汉字数字）、src/config/epigraphs.js',
  build({ withTZ, opCases }) {
    const R = [];
    const ns = [];
    for (let n = 0; n <= 1300; n += 1) ns.push(n);
    for (let n = 1300; n <= 9999; n += 7) ns.push(n);
    ns.push(9999, 10000, -1, 1.5, -0, 2 ** 53, 1e21, 1e300, 12345678901234567890);
    for (const n of ns) for (const op of ['dates.cnNumber', 'dates.cnCount']) R.push({ op, args: { n } });
    for (const n of [0, 1, 9, 10, 2026, 1999, 2000, 100, 12345, 1e21, 1e22, 1e300, 2 ** 53, -1, 1.5, -0, 99999999]) R.push({ op: 'dates.cnDigits', args: { n } });
    for (const day of DAYS) R.push({ op: 'dates.signatureDateParts', args: { day } });
    for (const month of ['2026-09', '2026-12', '2026-01', '0000-01', '0099-05', '2026-13', '2026-00', '2026-1', '2026-09-24', '', null, 202609]) R.push({ op: 'dates.signatureMonthParts', args: { month } });
    for (let i = 0; i < 40; i += 1) {
      const day = new Date(Date.UTC(2026, 8, 24 + i)).toISOString().slice(0, 10);
      R.push({ op: 'epigraphs.index', args: { day } });
      R.push({ op: 'epigraphs.for', args: { day } });
    }
    for (const day of DAYS) {
      R.push({ op: 'epigraphs.index', args: { day } });
      R.push({ op: 'epigraphs.for', args: { day } });
    }
    for (const source of ['孙过庭《书谱》', '杜甫《偶题》', '苏轼《石苍舒醉墨堂》', '《无作者》', '  苏轼 《石》', '', '无书名号', '作者　《x》', '﻿作者《x》', 'a 《b》']) R.push({ op: 'epigraphs.author', args: { source } });
    return { groups: [withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases(R) }))] };
  },
};
