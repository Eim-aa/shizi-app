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
const plans=[
 ['snapshot: current card', [req('open')]],
 ['strokes op =', [req('strokes',{cardKey:key,strokes}),req('open')]],
 ['judge through the API', [req('judge',{cardKey:key,strokes,judgment:'correct'}),req('judge',{cardKey:other,strokes,judgment:'wrong'}),req('judge',{cardKey:'base:春',strokes,judgment:'correct'})]],
 ['D07: a failed judgment', [{op:'store.fault',args:{failNextWrite:{n:1,kind:'generic'}}},req('judge',{cardKey:key,strokes,judgment:'correct'}),req('judge',{cardKey:key,strokes,judgment:'correct'}),req('judge',{cardKey:key,strokes,judgment:'correct'})]],
 ['judge with no strokes', [req('judge',{cardKey:key,strokes:[],judgment:'correct'})]],
 ['hint op: every tap', [req('hint',{cardKey:key,action:'give',totalStrokes:1}),req('hint',{cardKey:key,action:'give',totalStrokes:1})]],
 ['correct op: 改判', [req('judge',{cardKey:key,strokes,judgment:'correct'}),req('correct',{recordId,to:'wrong'}),req('correct',{recordId,to:'wrong'}),req('correct',{recordId,action:'state'})]],
 ['showAnswer =', [req('showAnswer',{cardKey:key}),req('showAnswer',{cardKey:key})]],
 ['answer flow: trace →', [req('showAnswer',{cardKey:key}),req('answerPhase',{cardKey:key,phase:'retrace',strokes}),req('answerNext',{cardKey:key,strokes})]],
 ['skip + undoSkip =', [req('skip',{cardKey:key,hints:2}),req('undoSkip',{sessionId:id,recordId,strokes}),req('undoSkip',{sessionId:id,recordId,strokes})]],
 ['B2.7 result op =', [...completed,req('result',{sessionId:id}),req('result',{sessionId:id})]],
 ['B2.7 resultCell:', [...ended,req('resultCell',{sessionId:id,recordId}),req('resultCell',{sessionId:id,kind:'skipped',char:'春'})]],
 ['B2.7 resultCorrect =', [...ended,{op:'store.fault',args:{failNextWrite:{n:1,kind:'generic'}}},req('resultCorrect',{sessionId:id,recordId,to:'correct'}),req('resultCorrect',{sessionId:id,recordId,to:'correct'}),req('resultCorrect',{sessionId:id,recordId,to:'correct'})]],
 ['B2.7 resultAdd /', [...ended,req('resultAdd',{sessionId:id,recordId,on:true}),req('resultSealed',{sessionId:id}),req('resultSealed',{sessionId:id})]],
 ['B2.7 resultUndoSkip =', [req('skip',{cardKey:key}),req('end',{sessionId:id}),req('resultUndoSkip',{sessionId:id,recordId,strokes:[]}),req('open')]],
 ['B2.7 resultAgain =', [...ended,req('resultAgain',{sessionId:id})]],
 ['B2.7 resultInvite:', [req('resultInvite',{sessionId:id,action:'shown'}),req('resultInvite',{sessionId:id,action:'shown'}),req('resultInvite',{sessionId:id,action:'no'})]],
 ['end', [req('end',{sessionId:id,action:'counts'}),req('end',{sessionId:id}),req('result',{sessionId:id})]],
];
const groups=[];
for(const tz of ['Asia/Shanghai','America/New_York']) {
 process.env.TZ=tz;
 for(const backend of ['local','native']) for(const [prefix,plan] of plans) {
  const state=Object.fromEntries(DOMAINS.map(d=>[d,['records','ink'].includes(d)?{}:null]));
  state.sessions={A:createSession({id,kind:'daily',queue:[key,other,'base:春'],at:T}),B:null,lastEnded:{}};
  const requests=[{op:'store.open',args:{backend,clock:T}},{op:'store.seed',args:{state}},...plan];
  const engine=createJsEngine(), steps=[];
  for(const request of requests) {
   const response=await engine.handle(request);
   steps.push({request,reply:response.reply,state:response.state});
  }
  groups.push({name:names.find(n=>n.startsWith(prefix))||prefix,source,tz,backend,steps});
 }
}
const path=new URL('../../ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/session-contract.json',import.meta.url);
const text=JSON.stringify({source,generator:'scripts/core-golden/session-contract.mjs',groups},null,2)+'\n';
if(process.argv.includes('--check')) {if(!fs.existsSync(path)||fs.readFileSync(path,'utf8')!==text)throw Error('session-contract fixture stale');}
else fs.writeFileSync(path,text);
console.log(`session-contract: ${groups.length} scenarios, ${groups.reduce((n,g)=>n+g.steps.length,0)} steps`);
