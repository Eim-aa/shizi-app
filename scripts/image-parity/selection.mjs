import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {imagePlan} from '../../src/core/images/pick.js';import {buildWork} from '../../src/core/images/work.js';import {foldWorkOf} from '../../src/core/work-members.js';
const cases=[];const add=(op,args,reply)=>cases.push({op,args,reply});
const inkPoints=[[{x:20,y:30,w:2},{x:100,y:200,w:12}]];
for(let seed=0;seed<60;seed++){
const records=[],ink={};for(let i=1;i<=45;i++){
 const ch=['永','人','一','字','月'][i%5],day=`2026-10-${String(1+Math.floor(i/5)).padStart(2,'0')}`;
 const kind=(i+seed)%7===0?'skipped':(i+seed)%4===0?'answer-seen':'judged';
 const r={id:`r${i}`,cardKey:`base:${ch}`,char:ch,localDay:day,kind,sessionId:'s1',at:1790812800000+i*1000};
 if(kind==='judged')r.judgment=(i+seed)%3===0?'wrong':'correct';
 if((i+seed)%11===0)r.source='paper';records.push(r);if((i+seed)%3!==0)ink[r.id]=inkPoints;
}
const session={id:'s1',items:records.map(r=>({cardKey:r.cardKey,recordId:r.id,kind:r.kind})),startedDay:'2026-10-01',added:records.filter(r=>r.judgment==='wrong'&&Number(r.id.slice(1))%2).map(r=>r.id)};
const state={records:{'2026-10':records},sessions:{A:null,B:null,lastEnded:{A:session}},ink:{}};
const workArgs={items:session.items,records,inkIds:Object.keys(ink),added:session.added};add('images.work',workArgs,buildWork({items:session.items,records:new Map(records.map(r=>[r.id,r])),hasInk:r=>!!ink[r.id],added:session.added}));
for(const folded of [false,true]){
 if(folded){const work=foldWorkOf(records,{hasInk:r=>!!ink[r.id]});state.records['2026-10']={folded:true,kept:records.filter((_,i)=>i%4===0),byDay:{},...work};}
 for(const scope of [{kind:'month',month:'2026-10'},{kind:'month',month:'2026-09'},{kind:'day',day:'2026-10-03'},{kind:'glyph',char:'永'},{kind:'glyph',char:'山'},...(!folded?[{kind:'session',sessionId:'s1'},{kind:'session',sessionId:'s1',slot:'A'}]:[])])
 for(const monthPick of ['first','last']){
 const args=structuredClone({state,scope,ink,maxChars:7,monthPick});
 add('images.plan',args,imagePlan(args.state,scope,{inkOf:r=>ink[r.id]??null,policy:{imageMaxChars:7,monthSheetPick:monthPick}}));
 }
}
}
if(process.argv.includes('--fixtures')){
 fs.writeFileSync('ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/images-selection.json',JSON.stringify(cases.slice(0,50))+'\n');console.log(`Wrote ${cases.slice(0,50).length} selection fixtures`);
}else{
 const p=spawnSync('ios/ShiziCore/.build/debug/shizi-core-cli',[],{input:cases.map(({op,args})=>JSON.stringify({op,args,state:false})).join('\n')+'\n',maxBuffer:128*1024*1024,encoding:'utf8',env:{...process.env,TZ:'Asia/Shanghai'}});
 assert.equal(p.status,0,p.stderr);const rows=p.stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,cases.length);
 rows.forEach((r,i)=>{assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.reply,cases[i].reply,`${i}: ${cases[i].op} ${JSON.stringify(cases[i].args.scope)}`)});console.log(`Selection parity: ${cases.length}/${cases.length} exact`);
}
