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
  const a = {state, mode:g.pick(['lookup','pick']), text, cur:g.pick(['','永','𠀀']), selected:g.pick([[],['永'],['甲','永']])};
  const latest = h.records.find(r => r.kind === 'judged');
  const summary = latest ? {latest, count:2, latestDay:latest.localDay} : null;
  return [
    ['view.query', a], ['view.query.sheet', a],
    ['view.query.meta',{pinyin:g.pick(['','yǒng']),strokes:g.pick([0,5,-1])}],
    ['view.query.stat',{summary}], ['view.query.date',{day:g.pick([null,'2026-03-01'])}],
    ['view.query.ink',{state,summary}],
  ].map(([op,args])=>({op,args,state:false}));
}
export const pageNames = ['view.query','view.query.sheet','view.query.meta','view.query.stat','view.query.date','view.query.ink'];
