import { pageNames } from '../../core-diff/domains/views-pages.mjs';
// Fixed ten valid generated states × every registered B4.5b view/helper.
import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import { viewCases } from '../../core-diff/domains/views.mjs';
export default {
  id: 'views-basic', source: 'src/session/views/{about,block,kuan,library-switch,lines,session,settings}.js',
  build({ withTZ, opCases }) {
    return { groups: ['Asia/Shanghai', 'America/New_York'].map(tz => withTZ(tz, () => ({ tz, cases: opCases(Array.from({ length: 10 }, (_, i) => viewCases(makeCtx(rng(4500 + i))).filter(r => !pageNames.includes(r.op))).flat()) }))) };
  },
};
