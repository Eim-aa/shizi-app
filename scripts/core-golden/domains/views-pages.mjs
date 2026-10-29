import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import { pageCases } from '../../core-diff/domains/views-pages.mjs';
export default {
  id:'views-pages', source:'src/session/views/{query,annual,library-list,home,library-all,detail,mine-sub,mine-page,mine,library}.js',
  build({withTZ,opCases}) {
    return {groups:['Asia/Shanghai','America/New_York'].map(tz=>withTZ(tz,()=>({tz,cases:opCases(Array.from({length:10},(_,i)=>pageCases(makeCtx(rng(4500+i)))).flat())})))};
  }
};
