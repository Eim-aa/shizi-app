#!/usr/bin/env node
// B2 write/result contract scenarios, replayed against the real JS Store (B4.4).
import fs from 'node:fs';
import { createJsEngine } from '../core-diff/lib/js-engine.mjs';
import { createSession } from '../../src/core/sessions.js';
import { DOMAINS } from '../../src/core/schema.js';
const source='test/ui/native-write.test.mjs';
const names=[...fs.readFileSync(source,'utf8').matchAll(/^test\('((?:[^'\\]|\\.)*)'/gm)].map(m=>m[1]);
const T=1792544400000, strokes=[[[60,170,0],[170,171,60],[280,172,120]]];
const req=(op,args={})=>({op:'write.'+op,args:{slot:'A',...args}});
const key='base:永', other='base:和', id='s1', recordId='r2';
const judged = [req('judge',{cardKey:key,strokes,judgment:'wrong'})];
const ended = [...judged,req('end',{sessionId:id})];
const completed = [...judged,req('judge',{cardKey:other,strokes,judgment:'correct'}),req('judge',{cardKey:'base:春',strokes,judgment:'correct'})];
const host=(op,args={},hooks={},navigate)=>({op:'session.writeHost',args:{op,args:{slot:'A',...args},hooks,...(navigate?{navigate}:{})}});
const fault={op:'store.fault',args:{failNextWrite:{n:1,kind:'generic'}}};
const skip=req('skip',{cardKey:key,hints:2}),undo=req('undoSkip',{sessionId:id,recordId,strokes});
const ans=req('showAnswer',{cardKey:key}),trace=req('answerPhase',{cardKey:key,phase:'trace',strokes}),retrace=req('answerPhase',{cardKey:key,phase:'retrace',strokes}),next=req('answerNext',{cardKey:key,strokes});
const hint=(action='give',extra={})=>req('hint',{cardKey:key,action,totalStrokes:4,...extra});
const map=[
 [host('nope')],
 ...[ [undefined,{}, {__shiziNativeWrite:true},{__shiziNativeWrite:true,__shiziNativeWriteForce:true}].map(win=>({op:'session.writeHelper',args:{name:'enabled',win}})) ],
 [{op:'session.writeHelper',args:{raw:[[{x:1,y:2,t:0},{x:3,y:4,t:1,p:.5}]],wire:[[[1,2]], [['x',1,2]],'bad',[[1,2,3,0]],[[2,3,4,.8]]]}}],
 [req('copy'),req('copy',{keys:['R-W29.btnDone','no.such.key']})],
 [req('open'),req('open',{slot:'B'})],
 [req('strokes',{cardKey:key,strokes}),req('open')],
 completed,
 [...completed,host('exit',{to:'result',sessionId:id},{},{toResult:{}})],
 [host('exit',{to:'detail',char:'永'},{},{toDetail:{reply:true}}),host('exit',{to:'detail',char:''},{},{toDetail:{}})],
 [host('open',{}, {type:{reply:{fs13:17,lh13:25}}})],
 ...[ [host('open',{}, {theme:{reply:'dark'}}),host('resultLook',{}, {theme:{reply:'light'}}),host('open',{}, {theme:{reply:'bad'}}),req('open')] ],
 [fault,...judged,...judged,...judged],
 [req('judge',{cardKey:key,strokes:[],judgment:'correct'})],
 [req('open'),req('open')],
 [req('open')],
 [hint(),hint('give',{used:1}),hint('give',{used:2}),hint('give',{used:3})],
 [hint('give',{written:3}),hint('give',{used:4})],
 [hint(),hint('range',{hintRange:null}),hint('range',{hintRange:{from:0,to:1}})],
 [hint('state',{totalStrokes:0}),req('hint',{cardKey:'bad'}),fault,hint(),hint('range',{hints:1,hintRange:{from:0,to:1}})],
 [hint(),hint('give',{used:1}),...judged],
 [hint(),ans,req('open'),retrace,next,req('open')],
 [...judged,req('correct',{recordId,to:'correct'}),req('correct',{recordId,to:'correct'})],
 [...judged,req('correct',{recordId:'r999'}),req('judge',{cardKey:other,strokes,judgment:'correct'}),req('correct',{recordId})],
 [...judged,req('correct',{recordId,action:'state'}),fault,req('correct',{recordId,to:'correct'}),req('correct',{recordId,to:'correct'})],
 [req('open'),req('copy',{keys:['R-W10.changeFailed','R-W10.retry','R-W10.cancel']})],
 [ans,ans],
 [ans,retrace,next],
 [ans,retrace,trace,retrace,next],
 [fault,ans,ans,req('answerPhase',{cardKey:key,phase:'bad'}),retrace,next,next],
 [ans,retrace,next,req('showAnswer',{cardKey:other}),req('answerNext',{cardKey:other}),req('showAnswer',{cardKey:'base:春'}),req('answerNext',{cardKey:'base:春'})],
 [req('open')],[req('open')],
 [skip,undo],[skip],
 [fault,skip,skip,skip],
 [skip,req('undoSkip',{sessionId:id,recordId:'r999'}),fault,undo,undo],
 [skip,req('skip',{cardKey:other}),req('skip',{cardKey:'base:春'}),host('exit',{to:'result',sessionId:id,undo:{sessionId:id,recordId:'r4',char:'春',strokes,remainingMs:2400}},{},{toResult:{}})],
 [req('end',{sessionId:id,action:'counts'}),...judged,req('end',{sessionId:id})],
 [fault,req('end',{sessionId:id}),req('end',{sessionId:id}),req('end',{sessionId:id})],
 [req('open'),req('firstTip'),req('firstTip'),req('open')],
 [req('open'),ans,req('open'),retrace,req('open')],
 [req('resultLook')],
 [...completed,req('result',{sessionId:id}),req('result',{sessionId:id})],
 [...ended,{op:'session.resultPageView',args:{slot:'A',sessionId:id,width:402,ax:false}},{op:'session.resultPageView',args:{slot:'A',sessionId:id,width:402,ax:true}}],
 [...ended,req('resultCell',{sessionId:id,recordId}),req('resultCell',{sessionId:id,kind:'skipped',char:'春'})],
 [...ended,fault,req('resultCorrect',{sessionId:id,recordId,to:'correct'}),req('resultCorrect',{sessionId:id,recordId,to:'correct'}),req('resultCorrect',{sessionId:id,recordId,to:'correct'})],
 [...ended,req('resultAdd',{sessionId:id,recordId,on:true}),host('resultSealed',{sessionId:id},{seal:{}}),host('resultSealed',{sessionId:id},{seal:{}})],
 [skip,req('end',{sessionId:id}),host('resultUndoSkip',{sessionId:id,recordId,strokes:[]},{toWrite:{}})],
 [...ended,host('resultAgain',{sessionId:id},{again:{}})],
 [...ended,...['leave','redo','detail','share'].map(to=>host('resultExit',{sessionId:id,to,char:'永'},{[to]:{reply:true}}))],
 [req('resultInvite',{sessionId:id,action:'shown'}),req('resultInvite',{sessionId:id,action:'no'}),...['yes','time'].flatMap(action=>[host('resultInvite',{sessionId:id,action,hour:8,minute:15},{[action==='yes'?'invite':'changeTime']:{reply:{ok:true},settings:{remind:{enabled:true,hour:8,minute:15,permission:'denied'}}}}),host('resultInvite',{action,hour:9,minute:0},{[action==='yes'?'invite':'changeTime']:{throws:true}})])],
 [req('redoOpen',{chars:['永','和']}),req('redoNext',{chars:['永','和'],index:0}),req('redoNext',{chars:['永','和'],index:1}),host('redoExit',{},{},{redoBack:{}})],
 [req('redoOpen',{chars:['永']}),host('redoExit',{},{},{redoBack:{}})],
 [req('redoOpen',{chars:[]}),req('redoNext',{chars:['永'],index:9}),req('redoExit')],
 [req('refLabel',{char:'永'}),host('refLabel',{char:'永'},{refLabel:{reply:'label',async:true}})],
];
if(map.length!==names.length)throw Error(`transcription plans ${map.length} != source tests ${names.length}`);
map[15]=[0,1,2,3,4].map(used=>({op:'session.writeHost',args:{op:'hint',args:{slot:'A',cardKey:key,action:'give',totalStrokes:8,used},groups:{'永':[4,4]}}}));
map[43]=[...completed,{op:'session.resultPageView',args:{slot:'A',sessionId:id,width:402,ax:false}},{op:'session.resultPageView',args:{slot:'A',sessionId:id,width:402,ax:true}}];
map[38].push({op:'store.seed',args:{state:{sessions:{A:createSession({id,kind:'first',queue:[key,other,'base:春'],at:T}),B:null,lastEnded:{}}}}},req('end',{sessionId:id}));
map[13]=[...judged,{op:'store.commit',args:{label:'test-interruption',ops:[{op:'set',domain:'sessions',value:{A:createSession({id,kind:'daily',queue:[key,other,'base:春'],at:T}),B:null,lastEnded:{}}}]}},req('open'),req('open')];
const plans=map.map((plan,i)=>[names[i],plan]);
const groups=[];
for(const tz of ['Asia/Shanghai','America/New_York']) {
 process.env.TZ=tz;
 for(const backend of ['local','native']) for(const [prefix,plan] of plans) {
  const state=Object.fromEntries(DOMAINS.map(d=>[d,['records','ink'].includes(d)?{}:null]));
  state.sessions={A:createSession({id,kind:prefix.startsWith('firstTip:')?'first':'daily',queue:[key,other,'base:春'],at:T}),B:null,lastEnded:{}};
  const requests=[{op:'store.open',args:{backend,clock:T}},{op:'store.seed',args:{state}},...plan];
  const engine=createJsEngine(), steps=[];
  for(const request of requests) {
   const response=await engine.handle(request);
   steps.push({request,reply:response.reply,state:response.state});
  }
  groups.push({name:prefix,source,tz,backend,steps});
 }
}
const path=new URL('../../ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/session-contract.json',import.meta.url);
const text=JSON.stringify({source,generator:'scripts/core-golden/session-contract.mjs',groups},null,2)+'\n';
if(process.argv.includes('--check')) {if(!fs.existsSync(path)||fs.readFileSync(path,'utf8')!==text)throw Error('session-contract fixture stale');}
else fs.writeFileSync(path,text);
console.log(`session-contract: ${groups.length} scenarios, ${groups.reduce((n,g)=>n+g.steps.length,0)} steps`);
