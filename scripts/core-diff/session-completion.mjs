// B4.5a per-row differential branch gate. Real JS ops, whole replies and snapshots.
process.env.TZ = 'Asia/Shanghai';
import assert from 'node:assert/strict';
import {openEngine} from './lib/engines.mjs';
import {createSession} from '../../src/core/sessions.js';
import {DOMAINS} from '../../src/core/schema.js';
const js=openEngine('js'), sw=openEngine('swift',{swiftPath:process.env.B45_SWIFT_BIN});let checked=0;const invoked=new Set();
async function call(op,args={}) {
 const line=JSON.stringify({op,args}); const a=JSON.parse(await js.send(line)),b=JSON.parse(await sw.send(line));
 try{assert.deepEqual(b,a);}catch(e){console.error(op,JSON.stringify(args),JSON.stringify(a),JSON.stringify(b));throw e;}
 assert.equal(a.ok,true);for(const c of a.reply?.calls||[])invoked.add(c.name);checked++;return a.reply;
}
const T=1790906400000;
try {
 await call('store.open',{backend:'local',clock:T});
 for(const kind of ['first','daily','picked'])for(const early of [false,true]) {
  const slot=kind==='picked'?'B':'A'; const s=createSession({id:'s1',kind,queue:['base:人','base:口','base:水'],at:T,source:{view:'detail',char:'人'}});
  const state=Object.fromEntries(DOMAINS.map(d=>[d,['records','ink'].includes(d)?{}:null])); state.sessions={A:null,B:null,lastEnded:{},[slot]:s};
  await call('store.seed',{state});
  const a={slot,sessionId:s.id};
  await call('session.resultModel',a);
  await call('session.judge',{slot,cardKey:'base:人',judgment:'wrong',strokes:[[{x:42,y:50,t:0},{x:90,y:130,t:17}]]});
  const skipped=await call('session.skip',{slot,cardKey:'base:口'});
  await call('session.resultModel',a);
  if(early)await call('session.end',a);
  else await call('session.judge',{slot,cardKey:'base:水',judgment:'correct',strokes:[]});
  await call('write.result',a);await call('session.resultModel',a);
  for(const name of ['view','seal','leave','redo','detail','share'])for(const reply of [false,true,null])for(const throws of [false,true]) {
   const op=name==='view'?'result':name==='seal'?'resultSealed':'resultExit';
   await call('session.writeHost',{op,args:{...a,to:name,char:'人',width:402},hooks:{[name]:{reply,throws}}});
  }
  await call('session.writeHost',{op:'resultUndoSkip',args:{...a,recordId:'bad'},hooks:{toWrite:{reply:true}}});
  // Restore last skip into the slot and exercise the successful handoff.
  if(early && kind!=='first')await call('session.writeHost',{op:'resultUndoSkip',args:{...a,recordId:skipped.record.id},hooks:{toWrite:{reply:true}}});
  await call('session.writeHost',{op:'resultAgain',args:a,hooks:{again:{reply:true}}});
 }
 for(const action of ['yes','time'])for(const permission of ['granted','denied','unknown'])for(const outcome of ['ok','failed','throw','null','later']) {
  await call('store.seed',{state:{settings:{remind:{permission:'unknown'}}}});
  const name=action==='yes'?'invite':'changeTime';
  const settings={remind:{permission,hour:7,minute:3,enabled:true}};
  await call('session.writeHost',{op:'resultInvite',args:{action,hour:'9.8',minute:'4.7',sessionId:'s1'},hooks:{[name]:{settings,reply:outcome==='null'?null:outcome==='failed'?{ok:false,error:{kind:'quota'}}:{ok:true,requested:true},throws:outcome==='throw',...(outcome==='later'&&permission==='unknown'?{laterPermission:'denied'}:{})}},waitMs:20});
 }
 for(const view of ['wrongList','againList','forgetList','dueList','shakyList','knownList','skippedList','allWritten','mine','library','detail','home','bad'])for(const char of [null,'人','']) await call('session.resultLeave',{source:{view,char}});
 for(const variant of ['first','daily','picked'])for(const inWork of [true,false]){
  const cells=[{char:'拾',cardKey:'base:拾',kind:'judged'},{char:'人',cardKey:'base:人',kind:'judged'},{char:'口',kind:'skipped'}];
  const args={cells,sched:{'base:拾':{due:'2026-10-03'},'base:人':{due:'2026-10-04'}},today:'2026-10-02',variant,work:{cells:inWork?[{char:'拾'}]:[]}};
  await call('session.firstExtras',args);await call('session.daysLaterOf',args);
 }
 for(const name of ['view','seal','toWrite','again','leave','redo','detail','share'])assert(invoked.has(name),`missing callback ${name}`);
 console.log(`session-completion: rows 1–2, ${checked} exact reply/state comparisons; result model, first-result, all result host hooks success/false/throw`);
}finally{await js.close();await sw.close();}
