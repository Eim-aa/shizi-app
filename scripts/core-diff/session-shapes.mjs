// Branch audit for the store-backed session sequence. A protocol error is never coverage.
import { createJsEngine } from './lib/js-engine.mjs';
import { makeCtx,rng } from './lib/gen.mjs';
import { sessionCases } from './domains/session.mjs';
const branches=new Map(), shapes=new Map();
for(let seed=1;seed<=200;seed++) {
 const e=createJsEngine();
 for(const req of sessionCases(makeCtx(rng(seed)))) {
  const r=await e.handle(req);
  if(!r.ok)throw Error(`protocol failure is not branch coverage: ${JSON.stringify(req)} -> ${JSON.stringify(r.error)}`);
  const name=req.op==='api.call'?req.args.op:req.op;
  if(!name.startsWith('write.')&&!name.startsWith('session.')&&req.op!=='api.call')continue;
  const set=branches.get(name)||new Set();set.add(r.reply?.ok===true?'success':'failure');branches.set(name,set);
  const kinds=shapes.get(name)||new Set();kinds.add(r.reply?.error?.kind||'ok');shapes.set(name,kinds);
 }
}
const writes=['write.judge','write.correct','write.resultCorrect','write.resultAdd','session.judge','session.end','detail.wordOff','detail.wordOn','detail.addCustom','detail.removeCustom','mine.appearance','mine.groupSize','remind.enabled','remind.time','query.add','backup.clear'];
for(const name of writes)for(const branch of ['success','failure'])if(!branches.get(name)?.has(branch))throw Error(`missing branch ${name}: ${branch}`);
for(const [name,set]of branches)console.log(`${name}: ${[...set].join('/')} (${[...shapes.get(name)].join(',')})`);
console.log(`session-shapes: ${branches.size} exercised operations, ${writes.length} required success/failure pairs; full-family and host callback coverage is forced separately by session-completion.mjs`);
