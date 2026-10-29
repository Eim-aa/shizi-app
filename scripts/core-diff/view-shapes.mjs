// Audits the exact same 200-seed cases used by the views differential domain.
// Shapes distinguish null, booleans and branch discriminators, while ignoring
// arbitrary numeric / text values and repeated homogeneous array elements.
import { makeCtx, rng } from './lib/gen.mjs';
import { pageCases } from './domains/views-pages.mjs';
import { createJsEngine } from './lib/js-engine.mjs';
const engine=createJsEngine(), shapes=new Map(), branches=new Map();
const discriminators=new Set(['view','kind','state','phase','mode','status','image','filter','sort','group','action','permission','appearance']);
function shape(v,key='') {
  if(Array.isArray(v)) return v.length ? ['array',...new Set(v.map(x=>JSON.stringify(shape(x))))].sort() : [];
  if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x,k)]));
  return typeof v==='boolean' || v===null || discriminators.has(key) ? v : typeof v;
}
function observe(op,key,value) {
  const id=op+'.'+key,set=branches.get(id)||new Set();set.add(JSON.stringify(value??null));branches.set(id,set);
}
for(let seed=1;seed<=200;seed++) for(const c of pageCases(makeCtx(rng(seed)))) {
  const r=engine.handle(c); if(!r.ok) throw Error(`${c.op}: ${JSON.stringify(r)}`);
  const set=shapes.get(c.op)||new Set();set.add(JSON.stringify(shape(r.reply)));shapes.set(c.op,set);
  for(const key of ['view','kind','phase','sort','filter','empty','image','capital']) if(r.reply?.[key]!==undefined) observe(c.op,key,r.reply[key]);
  if(c.args.state?.settings?.library) observe('states','library',c.args.state.settings.library);
}
for(const [op,s] of shapes) console.log(`${op}: ${s.size} distinct result shapes`);
const required={
  'view.query.view':['hint','rows','card','bad'],
  'view.home.model.view':['first','fresh','today','progress','special','back'],
  'view.home.model.capital':[null,'capital1','capital2'],
  'view.library-list.kind':['wrong','forget','due','shaky','known','skipped'],
  'view.library-all.sort':['recent','py','age'],
  'view.library-all.filter':['','due','shaky','known','unw','custom'],
  'view.library.plan.phase':['fresh','half','done'],
  'view.detail.model.image':['ok','noInk','noRecord'],
  'view.annual-page.empty':[false,true],
  'view.mine.empty':[false,true],
  'states.library':['core3500','adv3000','rare','curriculum2500'],
};
for(const [key,values] of Object.entries(required)) {
  const seen=branches.get(key)||new Set();
  for(const value of values) if(!seen.has(JSON.stringify(value))) throw Error(`unexercised branch ${key}=${JSON.stringify(value)}`);
  console.log(`${key}: ${[...seen].sort().join(' / ')}`);
}
console.log(`views branch audit: 200 seeds × ${shapes.size} page/helper ops; all required branches hit`);
