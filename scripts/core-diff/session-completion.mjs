// B4.5a per-row differential branch gate. Real JS ops, whole replies and snapshots.
process.env.TZ = 'Asia/Shanghai';
import assert from 'node:assert/strict';
import {openEngine} from './lib/engines.mjs';
import {createSession} from '../../src/core/sessions.js';
import {DOMAINS} from '../../src/core/schema.js';
const js=openEngine('js'), sw=openEngine('swift',{swiftPath:process.env.B45_SWIFT_BIN});let checked=0;const invoked=new Set(),branches=new Map(),observedOps=new Set();
function family(op,args){
 if(['session.writeHost','session.pageRegistered','session.queryHost','session.imageRegistered','session.apiHost','session.blockUnavailable','api.call'].includes(op))op=(op==='session.writeHost'?'write.':op==='session.imageRegistered'?'image.':'')+args.op;
 observedOps.add(op);
 if(op==='session.changeFeed')return 'changed';if(op==='session.environment')return 'providers';if(op==='session.reminderPlatform')return 'platform';
 if(/(rememberInk|recalledInk|forgetRecentInk|session.sheet)/.test(op))return 'recentInk';
 if(op==='session.writeHelper')return 'wire';if(/hint/i.test(op))return 'hint';if(/(judge|Judgment)$/.test(op))return 'judge';
 if(/(correct|Correct)$/.test(op))return 'correction';if(/(answer|Answer|showAnswer)/.test(op))return 'answer';
 if(/(skip|Skip)$/.test(op))return 'skip';if(/(end|End)$/.test(op))return 'end';if(/resultInvite$/.test(op))return 'invite';
 if(/(result|Result|firstExtras|daysLaterOf|session.finish|session.leave|session.added|session.sealed)/.test(op))return 'result';
 if(/^session\.(start|resume|expire|endStartPicked|deferSpecial)$/.test(op))return 'start';
 if(/^(write\.|session\.(strokes|phase|recover))/.test(op))return 'write';
 const prefix=op.split('.')[0];return ['home','library','detail','mine','remind','reminder','backup','query','s02','image','block'].includes(prefix)?prefix==='reminder'?'remind':prefix:null;
}
function audit(op,args,reply){
 const f=family(op,args);if(!f)return;const set=branches.get(f)||new Set();branches.set(f,set);
 const rows=reply?.replies||[reply?.reply??reply];for(const r of rows)set.add(r===false||r===null||r?.ok===false?'failure':'success');
 if(f==='providers'&&(args.measurerThrows||args.breakerThrows||args.loads?.some(v=>v===null||v==='throw')))set.add('failure');
 if(f==='changed'&&args.throws)set.add('failure');
}
async function call(op,args={}) {
 const line=JSON.stringify({op,args}); const a=JSON.parse(await js.send(line)),b=JSON.parse(await sw.send(line));
 try{assert.deepEqual(b,a);}catch(e){console.error(op,JSON.stringify(args),JSON.stringify(a),JSON.stringify(b));throw e;}
 assert.equal(a.ok,true);audit(op,args,a.reply);for(const c of a.reply?.calls||[])invoked.add(c.name);checked++;return a.reply;
}
const T=1790906400000;
try {
 await call('store.open',{backend:'local',clock:T});
 for(const kind of ['first','daily','picked'])for(const early of [false,true]) {
  const slot=kind==='picked'?'B':'A'; const s=createSession({id:'s1',kind,queue:['base:人','base:口','base:水'],at:T,source:{view:'detail',char:'人'}});
  const state=Object.fromEntries(DOMAINS.map(d=>[d,['records','ink'].includes(d)?{}:null])); state.sessions={A:null,B:null,lastEnded:{},[slot]:s};
  await call('store.seed',{state});
  const a={slot,sessionId:s.id};
  await call('session.resultModel',a);await call('session.resultPageView',{...a,width:402,ax:early});
  await call('session.judge',{slot,cardKey:'base:人',judgment:'wrong',strokes:[[{x:42,y:50,t:0},{x:90,y:130,t:17}]]});
  const skipped=await call('session.skip',{slot,cardKey:'base:口'});
  await call('session.resultModel',a);await call('session.resultPageView',{...a,width:402,ax:early});
  if(early)await call('session.end',a);
  else await call('session.judge',{slot,cardKey:'base:水',judgment:'correct',strokes:[]});
  await call('write.result',a);await call('session.resultModel',a);await call('session.resultPageView',{...a,width:402,ax:early});
  for(const name of ['view','seal','leave','redo','detail','share'])for(const reply of [false,true,null])for(const throws of [false,true]) {
   const op=name==='view'?'result':name==='seal'?'resultSealed':'resultExit';
   await call('session.writeHost',{op,args:{...a,to:name,char:'人',width:402},hooks:{[name]:{reply,throws}}});
  }
  await call('session.writeHost',{op:'resultUndoSkip',args:{...a,recordId:'bad'},hooks:{toWrite:{reply:true}}});
  // Restore last skip into the slot and exercise the successful handoff.
  if(early && kind!=='first')await call('session.writeHost',{op:'resultUndoSkip',args:{...a,recordId:skipped.record.id},hooks:{toWrite:{reply:true}}});
  await call('session.writeHost',{op:'resultAgain',args:a,hooks:{again:{reply:true}}});
 }
 for(const native of [false,true])await call('session.reminderPlatform',{native,commands:[{op:'sync'},{op:'invite',hour:9,minute:30},{op:'sync'},{op:'sync'},{op:'sync',force:true},{op:'schedule'},{op:'schedule'},{op:'time',hour:21,minute:15},{op:'fire'},{op:'forget'},{op:'sync'},{op:'query'},{op:'queueTarget',value:'base:口'},{op:'queueStatus',payload:{permission:'denied'}},{op:'queueTarget',value:'base:人'},{op:'ready'},{op:'ready'},{op:'target',value:'base:学习'}]});
 for(const throws of [false,true])await call('session.changeFeed',{throws,commands:[{settings:{appearance:'dark'},label:'first'},{settings:{appearance:'dark'},label:'noop'},{settings:{appearance:'light'},label:'fail',fail:true},{settings:{appearance:'light'},label:'retry'},{status:true},{off:true},{settings:{appearance:'auto'},label:'unsubscribed'}]});
 for(const loads of [[[ {char:'人',gloss:'origin',source:'book'}, {char:'人',gloss:'last'}, {char:'口',gloss:'',source:1},null ]],['throw',[{char:'人',gloss:'retry'}]],[null,[]]])for(const image of [false,true])await call('session.environment',{loads,image,requests:[{op:'view.detail',args:{char:'人',etymology:{gloss:'ignored'}}},{op:'view.detail',args:{char:'人'}}]});
 for(const build of [{version:'1.2',build:'20261029-abcd'},{},null,'bad'])for(const native of [false,true])await call('session.environment',{build,native,requests:[{op:'view.about',args:{build:{version:'ignored'}}},{op:'view.about-privacy',args:{native:!native}}]});
 for(const layout of [[],[1,3],[0,1.5,'2'],null,'bad'])for(const layoutThrows of [false,true])await call('session.environment',{layout,layoutThrows,requests:[{op:'view.query',args:{cur:'人',text:'人'}},{op:'view.s02',args:{chars:['人','口']}}]});
 for(const measurer of [[],[1,3],'bad'])for(const measurerThrows of [false,true])await call('session.environment',{measurer,measurerThrows,requests:[{op:'view.session-none',args:{exhausted:true}},{op:'view.block',args:{kind:'migration',still:true}}]});
 for(const breaker of [[],[1,3],null,'bad'])for(const breakerThrows of [false,true])await call('session.environment',{breaker,breakerThrows,requests:[{op:'view.annual',args:{}},{op:'view.records',args:{}}]});
 for(const async of [false,true])for(const close of [false,true])for(const withClose of [false,true])for(const outcome of ['ok','false','null','throw'])for(const op of ['query.pick','query.detail','s02.decide']){
  const c={async,close,reply:outcome==='false'?{ok:false}:outcome==='null'?null:{ok:true,token:1},throws:outcome==='throw'};
  const callbacks=op==='s02.decide'?{endStart:{...c,close:false},started:{}}:op==='query.detail'?{detail:c}:{pick:c,practice:c};if(withClose)callbacks.close={};
  await call('session.queryHost',{op,args:op==='s02.decide'?{action:'endStart'}:op==='query.detail'?{char:'人'}:{chars:['人','口'],from:'bar'},callbacks});
 }
 for(const async of [true,false])for(const throws of [true,false])await call('session.queryHost',{op:'query.pick',args:{chars:['人'],from:'card'},callbacks:{practice:{async,close:true,reply:{ok:true}},close:{throws}}});
 for(const op of ['query.pick','query.detail','s02.decide'])await call('session.queryHost',{op,args:op==='s02.decide'?{action:'endStart'}:op==='query.detail'?{char:'人'}:{chars:['人']},callbacks:{}});
 for(const action of ['continue','cancel','bad'])for(const throws of [true,false])await call('session.queryHost',{op:'s02.decide',args:{action},callbacks:{continue:{throws},cancel:{throws},close:{},started:{}}});
 for(const id of ['core3500','adv3000','rare','curriculum2500'])for(const kind of ['first','daily','picked'])for(const fault of [false,true]){
  const slot=kind==='picked'?'B':'A';await call('store.seed',{state:{settings:{library:'core3500'},sessions:{A:null,B:null,lastEnded:{},[slot]:createSession({id:'s1',kind,queue:['base:人','base:口'],at:T})}}});
  if(fault)await call('store.fault',{failNextWrite:{n:1,kind:'generic'}});
  const switched=await call('session.pageRegistered',{op:'library.switch',args:{id}});assert.equal(switched.reply.ok,!fault||id==='core3500');
  for(const op of ['home.start','home.resumeOther','library.startToday','home.deferSpecial'])await call('session.pageRegistered',{op});
  await call('session.pageRegistered',{op:'library.list.start',args:{keys:['base:人'],view:'dueList'}});
  for(const listKind of ['wrong','forget','due','shaky','known','skipped'])await call('session.pageRegistered',{op:'library.all.start',args:{kind:'list',listKind}});
  await call('session.pageRegistered',{op:'library.all.start',args:{keys:[]}});
 }
 for(const slot of ['A','B'])for(const op of ['home.undoLeave','library.undoLeave']){
  await call('store.seed',{state:{sessions:{A:null,B:null,lastEnded:{},[slot]:createSession({id:'s1',kind:slot==='A'?'daily':'picked',queue:['base:人','base:口'],at:T})}}});
  const skipped=await call('session.skip',{slot,cardKey:'base:人'});
  const undo={slot,sessionId:'s1',recordId:skipped.record.id,char:'人',strokes:null,until:T+5000};
  await call('store.fault',{failNextWrite:{n:1,kind:'generic'}});
  const failed=await call('session.pageRegistered',{op,undo});assert.equal(failed.reply.ok,false);assert.equal(failed.undo.failed,true);
  const success=await call('session.pageRegistered',{op,undo});assert.equal(success.reply.ok,true);assert.equal(success.undo,null);
 }
 for(const op of ['home.undoLeave','library.undoLeave','home.undoLeaveCancel','library.undoLeaveCancel','home.switchLibrary','home.source','home.pick','library.openQuery'])await call('session.pageRegistered',{op});
 await call('store.seed',{state:{sessions:{A:createSession({id:'s1',kind:'daily',queue:['base:人','base:口','base:水'],at:T}),B:null,lastEnded:{}}}});
 const imageInk=[[{x:42,y:50,t:0},{x:90,y:130,t:17}]];
 await call('session.judge',{slot:'A',cardKey:'base:人',judgment:'correct',strokes:imageInk});
 const imageWrong=await call('session.judge',{slot:'A',cardKey:'base:口',judgment:'wrong',strokes:imageInk});await call('session.end',{slot:'A',sessionId:'s1'});
 await call('session.imageRegistered',{op:'add',args:{scope:{kind:'session',slot:'A',sessionId:'s1'},recordId:imageWrong.record.id}});
 await call('session.resultPageView',{slot:'A',sessionId:'s1',width:402,shareAvailable:true});
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
 // Full-family acceptance sequences: each failure is a product reply, never a protocol error.
 const api=(op,args={})=>call('api.call',{op,args});
 await call('store.seed',{state:{sessions:{A:createSession({id:'s1',kind:'daily',queue:['base:人','base:口','base:水'],at:T}),B:null,lastEnded:{}}}});
 const strokes=[[{x:40,y:40,t:0},{x:90,y:100,t:20}]];
 await call('write.strokes',{slot:'A',cardKey:'bad',strokes:[]});await call('write.phase',{slot:'A',cardKey:'bad',phase:'compare'});
 const judged=await call('session.judge',{slot:'A',cardKey:'base:人',strokes,judgment:'correct'});
 await call('store.fault',{failNextWrite:{n:1,kind:'generic'}});
 await call('write.correct',{slot:'A',recordId:judged.record.id,to:'wrong'});
 const corrected=await call('write.correct',{slot:'A',recordId:judged.record.id,to:'wrong'});assert.equal(corrected.ok,true);
 await call('write.correct',{slot:'A',recordId:'bad'});
 await call('write.showAnswer',{slot:'A',cardKey:'base:口'});await call('write.answerNext',{slot:'A',cardKey:'bad'});
 await call('write.skip',{slot:'A',cardKey:'bad'});
 for(const [op,args]of [['detail.addCustom',{char:'人'}],['detail.wordOff',{char:'人'}],['detail.wordOn',{char:'人'}],['detail.removeCustom',{char:'人'}],['mine.appearance',{value:'dark'}],['mine.groupSize',{value:10}],['remind.enabled',{on:true}],['remind.time',{hour:7,minute:30}]]){
  await call('store.fault',{failNextWrite:{n:1,kind:'generic'}});const failed=await api(op,args);assert.equal(failed.ok,false,op+' failure');const retry=await api(op,args);assert.equal(retry.ok,true,op+' retry');
 }
 await api('query.add',{char:'人'});await api('query.add',{char:''});await api('remind.time',{hour:28,minute:0});await api('mine.groupSize',{value:9});
 const exported=await api('backup.export');assert.equal(exported.ok,true);
 await api('backup.restorePreview',{text:exported.text});await api('backup.restore',{text:'bad'});
 for(const op of ['backup.clear','backup.undoClear','backup.restore','backup.undoRestore','backup.clear','backup.restore','backup.undoRestore']){
  const r=await api(op,{text:exported.text});assert.equal(r.ok,true,'valid mixed '+op);
 }
 await call('store.fault',{failNextWrite:{n:1,kind:'generic'}});assert.equal((await api('backup.restore',{text:exported.text})).ok,false);
 assert.equal((await api('backup.restore',{text:exported.text})).ok,true);assert.equal((await api('backup.undoRestore')).ok,true);
 await call('store.seed',{state:{}});await call('store.fault',{failNextWrite:{n:1,kind:'generic'}});
 assert.equal((await call('session.start',{kind:'first'})).ok,false);assert.equal((await call('session.start',{kind:'first'})).ok,true);
 for(const op of ['view.block','block.retry','block.exportable','block.export'])await call('session.blockUnavailable',{op});
 await api('block.export');await api('block.retry',{kind:'blocked'});
 const hostOps=['home.start','home.resumeOther','home.deferSpecial','home.switchLibrary','home.pick','home.source','home.undoLeave','home.undoLeaveCancel','library.startToday','library.openQuery','library.undoLeave','library.undoLeaveCancel','library.list.start','library.all.start','library.switch','detail.practice','detail.image','session.pick','session.libSwitch','session.wrongList','image.view','image.spec','image.add','image.persist','image.closed','image.render','image.save'];
 for(const op of hostOps)for(const reply of [{ok:true,opened:'new'},{ok:false,error:{kind:'quota'}}])for(const throws of [false,true]){const r=await call('session.apiHost',{op,args:op.startsWith('detail.')?{char:'人'}:{},reply,throws});assert.equal(r.calls.length,1,`host not invoked ${op}`);}
 await call('session.writeHelper',{name:'enabled',win:{}});await call('session.writeHelper',{name:'enabled',win:{__shiziNativeWrite:true,__shiziNativeWriteForce:true}});
 const required=['write','wire','judge','hint','answer','correction','skip','end','result','invite','start','home','library','detail','mine','remind','backup','query','s02','image','block','platform','providers','changed','recentInk'];
 for(const f of required)for(const branch of ['success','failure'])assert(branches.get(f)?.has(branch),`missing family ${f} ${branch}`);
 for(const op of hostOps)assert(observedOps.has(op),`missing host callback ${op}`);
 for(const f of required)console.log(`branch ${f}: ${[...branches.get(f)].sort().join('/')}`);
 for(const name of ['view','seal','toWrite','again','leave','redo','detail','share','invite','changeTime','colors','type','theme','refLabel','navigate.back','navigate.toResult','navigate.toDetail','navigate.redoBack','pick','practice','continue','cancel','close','endStart','started'])assert(invoked.has(name),`missing callback ${name}`);
 console.log(`session-completion: rows 1–12, ${checked} exact reply/state comparisons; result model, first-result, ${required.length} forced families, all host hooks, valid backup import/undo + clear/undo`);
}finally{await js.close();await sw.close();}
