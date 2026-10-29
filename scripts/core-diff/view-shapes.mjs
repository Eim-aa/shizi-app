// Result-shape smoke audit, using the very same seed cases as the differential run.
import { makeCtx, rng } from './lib/gen.mjs';
import { pageCases } from './domains/views-pages.mjs';
import { createJsEngine } from './lib/js-engine.mjs';
const e=createJsEngine(), shapes=new Map();
function shape(v) {
  if(Array.isArray(v)) return v.length ? ['array',...new Set(v.map(x=>JSON.stringify(shape(x))))].sort() : [];
  if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x)]));
  return typeof v==='boolean' || v===null ? v : typeof v==='string' && /^(view|kind|status)$/.test('') ? v : typeof v;
}
for(let seed=1;seed<=200;seed++) for(const c of pageCases(makeCtx(rng(seed)))) {
  const r=e.handle(c); if(!r.ok) throw Error(JSON.stringify(r));
  const set=shapes.get(c.op)||new Set(); set.add(JSON.stringify(shape(r.reply))); shapes.set(c.op,set);
}
for(const [op,s] of shapes) console.log(`${op}: ${s.size} distinct result shapes`);
