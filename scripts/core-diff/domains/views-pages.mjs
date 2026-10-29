import { encodeInkRaw } from '../../../src/core/ink-math.js';
import { schedShapes } from '../lib/sched-shapes.mjs';
export function pageCases(g) {
  const S = schedShapes(g.r), h = S.state({days: g.int(0, 8)});
  const state = g.chance(.2) ? {} : h.state;
  state.ink = {};
  for (const r of h.records) if(g.chance(.5)) {
    const m=r.localDay.slice(0,7);
    (state.ink[m] ||= {})[r.id]=encodeInkRaw([[{x:100,y:100,t:0,p:.5},{x:150,y:160,t:20,p:.7}]]);
  }
  state.custom = {added:[{char:'永',at:1772400000000},{char:'𠀀',at:1772400000000}]};
  const text = g.pick(['', '永', '永甲', '𠀀', '永𠀀', 'yong', 'xyz', '永永a甲', 'ren']);
  if(g.chance(.5)) state.records = {...state.records, '2025-02':{v:1,folded:true,kept:[],chars:['永','甲'],byDay:{'2025-02-01':['永','甲']},work:{'2025-02-01':['永','甲']},workJudged:{'2025-02-01':['永']}}};
  const annual = {state,today:g.pick([h.today,'2025-01-01','2027-03-01']),year:g.pick([2025,2026,2027]),policy:{monthSheetPick:g.pick(['first','last']),imageMaxChars:g.pick([1,3,80])}};
  const a = {state, mode:g.pick(['lookup','pick']), text, cur:g.pick(['','永','𠀀']), selected:g.pick([[],['永'],['甲','永']])};
  const latest = h.records.find(r => r.kind === 'judged');
  const summary = latest ? {latest, count:2, latestDay:latest.localDay} : null;
  const list={state,today:h.today,kind:g.pick(['wrong','forget','due','shaky','known','skipped','forgetList','againList']),sel:g.pick([null,[],['永','甲']]),unpracticable:g.chance(.5)?S.keys().slice(0,30):[],policy:{groupSize:g.pick([5,10,20,30])}};
  return [
    ['view.library-list',list], ['view.library-list.entries',list],
    ['view.library-list.helpers',{...list,n:g.int(0,3),meta:'a · b · c',day:g.pick([null,h.today,'bad']),word:g.pick(['永远','永','a永b','a']),char:'永',other:g.pick([null,[],['甲','永']]),view:g.pick(['wrongList','dueList','home'])}],
    ...['view.annual','view.annual.plan','view.annual.years','view.annual.defaultYear','view.annual.slice','view.annual.first','view.annual.twice','view.annual.months'].map(op=>[op,annual]),
    ['view.query', a], ['view.query.sheet', a],
    ['view.query.meta',{pinyin:g.pick(['','yǒng']),strokes:g.pick([0,5,-1])}],
    ['view.query.stat',{summary}], ['view.query.date',{day:g.pick([null,'2026-03-01'])}],
    ['view.query.ink',{state,summary}],
  ].map(([op,args])=>({op,args,state:false}));
}
export const pageNames = ['view.library-list','view.library-list.entries','view.library-list.helpers','view.annual','view.annual.plan','view.annual.years','view.annual.defaultYear','view.annual.slice','view.annual.first','view.annual.twice','view.annual.months','view.query','view.query.sheet','view.query.meta','view.query.stat','view.query.date','view.query.ink'];
