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
 await call('store.seed',{state:{sessions:{A:createSession({id:'s1',kind:'daily',queue:['base:人','base:口','base:水'],at:T}),B:null,lastEnded:{}}}});
 const imageInk=[[{x:42,y:50,t:0},{x:90,y:130,t:17}]];
 await call('session.judge',{slot:'A',cardKey:'base:人',judgment:'correct',strokes:imageInk});
 const imageWrong=await call('session.judge',{slot:'A',cardKey:'base:口',judgment:'wrong',strokes:imageInk});await call('session.end',{slot:'A',sessionId:'s1'});
 await call('session.imageRegistered',{op:'add',args:{scope:{kind:'session',slot:'A',sessionId:'s1'},recordId:imageWrong.record.id}});
 const palette=Object.fromEntries(['paper','sheet','line','frame','guide','ink1','ink2','ink3','hand','ref','under','zhu','seal','onSeal'].map(k=>[k,'#123456']));palette.textures=[];palette.tiles=[240];
 for(const scope of [{kind:'session',slot:'A',sessionId:'s1'},{kind:'day',day:'2026-10-02'},{kind:'month',month:'2026-10'},{kind:'glyph',char:'人'},{kind:'annual',year:2026}])for(const ratio of ['3:4','1:1']){
  await call('session.imageRegistered',{op:'view',args:{scope,ratio}});
  for(const mode of ['preview','export','long'])for(const page of [0,1,9])await call('session.imageRegistered',{op:'spec',args:{scope,ratio,mode,page},palette});
  await call('session.imageRegistered',{op:'add',args:{scope,recordId:'bad'}});
 }
 for(const save of [false,true])for(const images of [[],[{dataURL:'data:image/png;base64,AA==',name:'test.JPG',kind:'session'}],[{dataURL:'data:image/jpeg;base64,AA==',name:'a.jpg'},{dataURL:'data:image/png;base64,AA==',name:'b.jpeg'}]])await call('session.imageRegistered',{op:'persist',args:{images},save});
 for(const entryId of [null,'image-preview-1','image-toast-2'])await call('session.imageRegistered',{op:'closed',args:{entryId}});
 for(const table of [null,{}, {'人':[2,2]}, {'人':[4]}, {'人':[1,0,3]}, {'人':['4']}, {'人':'bad'}])for(const totalStrokes of [null,0,4,'4',-1,1.5]){
  const input={char:'人',table,totalStrokes};
  await call('session.hintHelper',{name:'groupsFor',input});await call('session.hintHelper',{name:'hintSourceOfCount',input});
  await call('session.hintHelper',{name:'hasGroupData',input:{groups:table?.人,totalStrokes}});
  for(const status of ['ready','loading','missing','bad'])await call('session.hintHelper',{name:'hintSourceOf',input:{...input,status,data:{medians:[[],[],[],[]]}}});
 }
 for(const total of [1,4,12])for(const hasGroups of [false,true])for(const used of [0,1,4,'1',null,-1])for(const written of [0,3,20]){
  const source={status:'ready',totalStrokes:total,hasStrokeData:true,hasGroups};
  for(const name of ['planHint','hintStep'])await call('session.hintHelper',{name,input:{source,used,written,range:{from:0,to:1}}});
 }
 for(const phase of ['recall','compare','trace',null])for(const status of ['ready','loading','missing'])for(const answerSeen of [false,true]){
  const input={phase,status,answerSeen,used:1,source:{status,totalStrokes:4,hasStrokeData:status!=='missing',hasGroups:false}};
  await call('session.hintHelper',{name:'hintButtonModel',input});await call('session.hintHelper',{name:'hintNoteModel',input});
 }
 for(const range of [null,{from:0,to:1},{from:1,to:5},{from:-1,to:1},{from:'0',to:'2'},{}]){
  await call('session.hintHelper',{name:'hintAnnouncement',input:{range}});
  await call('session.hintHelper',{name:'strokeRangeText',input:range||{}});
 }
 for(const totalStrokes of [null,0,4,'bad'])for(const groups of [null,{'人':[2,2]}]){
  const state={sessions:{A:createSession({id:'s1',kind:'daily',queue:['base:人'],at:T}),B:null,lastEnded:{}}};await call('store.seed',{state});
  await call('session.writeHost',{op:'hint',args:{slot:'A',cardKey:'base:人',action:'give',totalStrokes},groups});
 }
 const hv={key:'x',used:1,range:{from:0,to:4},absorbed:[],fading:[],show:'in',run:0,restored:false};
 for(const [name,input] of [['mergeHintRange',{prev:{from:0,to:1},next:{from:1,to:3}}],['hintRemaining',{view:hv}],['hintVisible',{view:hv}],['matchHintStroke',{remaining:[1],index:1}],['initialHintView',{key:'x',stored:{hints:1,hintRange:{from:0,to:4}},written:2}],['reduceHintView',{view:hv,action:{type:'absorb',hint:1,user:1}}],['hintTimeline',{count:3}]])await call('session.hintHelper',{name,input});
 for(const count of [null,-1,0,1,3,12,'4'])for(const motion of [null,{hintStrokeMs:120,hintStagger:.5}])await call('session.hintHelper',{name:'strokeDrawMs',input:{count,motion}});
 await call('session.hintHelper',{name:'meanDistanceToMedian',input:{points:[{x:1,y:2}],median:[[0,0],[10,10]]}});
 await call('session.forgetRecentInk');
 for(let i=0;i<10;i++)await call('session.rememberInk',{recordId:'r'+i,strokes:[[{x:i,y:2,t:0}]]});
 for(const perRecordInk of [false,true])for(let i=0;i<10;i++)await call('session.recalledInk',{recordId:'r'+i,policy:{features:{perRecordInk}}});
 await call('session.rememberInk',{recordId:'r2',strokes:[[{x:99,y:2,t:0}]]});
 await call('session.rememberInk',{recordId:'r10',strokes:[[{x:10,y:2,t:0}]]});
 for(const recordId of ['r2','r3','r10','bad'])await call('session.recalledInk',{recordId,policy:{features:{perRecordInk:false}}});
 const cacheSession=createSession({id:'s9',kind:'daily',queue:['base:人'],at:T});cacheSession.cursor=1;cacheSession.items=[{cardKey:'base:人',recordId:'r9',kind:'judged'}];
 const cacheState={sessions:{A:cacheSession,B:null,lastEnded:{}},records:{'2026-10':[{id:'r9',sessionId:'s9',cardKey:'base:人',char:'人',kind:'judged',judgment:'correct',localDay:'2026-10-02'}]},ink:{}};
 for(const perRecordInk of [false,true])await call('session.resultModel',{slot:'A',sessionId:'s9',state:cacheState,policy:{features:{perRecordInk}}});
 await call('session.rememberInk',{recordId:'bad',strokes:[]});await call('session.rememberInk',{recordId:null,strokes:[[{x:1}]]});
 await call('session.forgetRecentInk');await call('session.forgetRecentInk');
 for(const op of ['open','resultLook','redoOpen'])for(const theme of ['light','dark','auto',null])await call('session.writeHost',{op,args:{slot:'A',chars:['人','口']},hooks:{colors:{reply:{ink:'#123'}},type:{reply:{body:17}},theme:{reply:theme}}});
 for(const reply of [false,null,17,'label'])for(const async of [true,false])for(const throws of [false,true]){
  await call('session.writeHost',{op:'refLabel',args:{char:'人',cardKey:'base:人'},hooks:{refLabel:{reply,throws,async}}});
  for(const name of ['back','toResult','toDetail','redoBack'])await call('session.writeHost',{op:name==='redoBack'?'redoExit':'exit',args:{slot:'A',sessionId:'s1',to:{back:'back',toResult:'result',toDetail:'detail'}[name],char:'人',undo:{sessionId:'s1',recordId:'r2',strokes:[[ [1,2,0],[3,4,1,.5] ]],remainingMs:'25'}},navigate:{[name]:{reply,throws}}});
 }
 for(const action of ['yes','time'])for(const permission of ['granted','denied','unknown'])for(const outcome of ['ok','failed','throw','null','later']) {
  await call('store.seed',{state:{settings:{remind:{permission:'unknown'}}}});
  const name=action==='yes'?'invite':'changeTime';
  const settings={remind:{permission,hour:7,minute:3,enabled:true}};
  await call('session.writeHost',{op:'resultInvite',args:{action,hour:'9.8',minute:'4.7',sessionId:'s1'},hooks:{[name]:{settings,reply:outcome==='null'?null:outcome==='failed'?{ok:false,error:{kind:'quota'}}:{ok:true,requested:true},throws:outcome==='throw',...(outcome==='later'&&permission==='unknown'&&action==='yes'?{laterPermission:'denied'}:{})}},waitMs:outcome==='later'?1000:0});
 }
 for(const view of ['wrongList','againList','forgetList','dueList','shakyList','knownList','skippedList','allWritten','mine','library','detail','home','bad'])for(const char of [null,'人','']) await call('session.resultLeave',{source:{view,char}});
 for(const variant of ['first','daily','picked'])for(const inWork of [true,false]){
  const cells=[{char:'拾',cardKey:'base:拾',kind:'judged'},{char:'人',cardKey:'base:人',kind:'judged'},{char:'口',kind:'skipped'}];
  const args={cells,sched:{'base:拾':{due:'2026-10-03'},'base:人':{due:'2026-10-04'}},today:'2026-10-02',variant,work:{cells:inWork?[{char:'拾'}]:[]}};
  await call('session.firstExtras',args);await call('session.daysLaterOf',args);
 }
 for(const name of ['view','seal','toWrite','again','leave','redo','detail','share'])assert(invoked.has(name),`missing callback ${name}`);
 console.log(`session-completion: rows 1–6, ${checked} exact reply/state comparisons; result model, first-result, all result host hooks success/false/throw`);
}finally{await js.close();await sw.close();}
