import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sessionSelection,monthSelection,resolveGlyphs} from '../module/selectors.mjs';
import {sheetLayout} from '../module/layout.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),report={version:'E8-2026-09-26-r2',layer:'Node pure selectors/layout and fixed ordering fixtures with artificial inputs; no browser/phone evidence',rows:[]};
function test(id,f){try{report.rows.push({id,status:'pass',evidence:f()});}catch(e){report.rows.push({id,status:'fail',error:e.stack});}}
const cards=Array.from('一二三十木水山日口大').map(target=>({target}));
const ink=id=>({attemptId:id,coordinateSpace:'normalized-0-1',strokes:[[{x:.2,y:.3,w:.9},{x:.7,y:.3,w:1}]]});
const row=(id,at,day='2026-09-26',more={})=>({id,at,sequence:at,char:'一',sessionId:'S',localDay:day,explicit:true,judgment:'correct',ink:ink(id),...more});
const resolve=(judgments,scope={kind:'session',sessionId:'S'},coverage='complete')=>resolveGlyphs({selection:[{key:'base:一',char:'一'}],scope,judgments,coverage})[0];
for(const ratio of ['portrait','square'])for(const n of [0,1,26,49,56,80])test(`layout-${ratio}-${n}`,()=>{
 const l=sheetLayout(n,ratio);assert.equal(l.width,1080);assert.equal(l.height,ratio==='portrait'?1440:1080);
 if(n===0){assert.equal(l.status,'empty');return l;}
 assert(l.columns>=5&&l.columns<=10);assert(l.gridHeight+118<=l.innerHeight);if(l.columns>5)assert(Math.ceil(n/(l.columns-1))*(936/(l.columns-1))+118>l.innerHeight);
 assert.equal(l.cells.length,l.rows*l.columns);assert.equal(l.cells.filter(c=>c.empty).length,l.cells.length-n);assert(l.top>=72);assert(l.footerTop+78<=l.height-72+1e-8);assert.equal(l.dateFont,l.cell<126?24:33);
 if(ratio==='square'&&(n===49||n===56))assert.equal(l.columns,9);return l;
});
test('date-threshold',()=>{assert.equal(sheetLayout(26,'portrait').dateFont,33);assert.equal(sheetLayout(80,'portrait').dateFont,24);return '187.2px→33px,117px→24px';});
test('over80-pending-no-truncation',()=>{for(const ratio of ['portrait','square'])for(const n of [81,200,Number.MAX_SAFE_INTEGER]){const l=sheetLayout(n,ratio);assert.equal(l.status,'pending');assert.equal(l.reason,'OVER_80_POLICY_PENDING');assert.equal(l.n,n);assert.equal(l.ratio,ratio);assert.deepEqual(l.cells,[]);}return '81/200/MAX_SAFE_INTEGER × both ratios return pending without selection';});
test('wrong-latest-wins',()=>{const x=resolve([row('old',1),row('wrong',2,undefined,{judgment:'wrong'})]);assert.equal(x.attemptId,'wrong');assert.equal(x.source,'handwriting');return x;});
test('missing-latest-no-backfill',()=>{const x=resolve([row('old',1),row('last',2,undefined,{ink:null})]);assert.equal(x.source,'reference');assert.equal(x.attemptId,'last');return x;});
test('different-session-excluded',()=>{const x=resolve([row('S',1),row('T',2,undefined,{sessionId:'T'})]);assert.equal(x.attemptId,'S');return x;});
test('cross-month-last-in-month',()=>{const js=[row('aug',1,'2026-08-31'),row('sep1',2,'2026-09-01'),row('sep-last',3,'2026-09-30',{ink:null}),row('oct',4,'2026-10-01')],x=resolve(js,{kind:'month',month:'2026-09'});assert.equal(x.attemptId,'sep-last');assert.equal(x.source,'reference');return x;});
test('month-only-other-month-is-missing',()=>{const x=resolve([row('aug',1,'2026-08-31')],{kind:'month',month:'2026-09'});assert.equal(x.reason,'no-judgment-in-scope');return x;});
test('trace-and-help-are-not-judgments',()=>{const x=resolve([row('valid',1),row('trace',2,undefined,{explicit:false}),row('help',3,undefined,{judgment:'help'})]);assert.equal(x.attemptId,'valid');return x;});
test('unverified-legacy-never-claims-history',()=>{const x=resolve([row('recent',1)],undefined,'unknown');assert.equal(x.reason,'history-not-proven-complete');return x;});
test('attempt-link-required',()=>{const x=resolve([row('latest',2,undefined,{ink:ink('old')})]);assert.equal(x.source,'reference');return x;});
test('equal-timestamp-sequence',()=>{const x=resolve([row('one',3,undefined,{sequence:1}),row('two',3,undefined,{sequence:2})]);assert.equal(x.attemptId,'two');return x;});
test('ambiguous-time-does-not-guess',()=>{const x=resolve([row('one',3),row('two',3)]);assert.equal(x.reason,'ambiguous-last-judgment');return x;});
test('display-tag-independent-of-last-ink',()=>{const x=resolveGlyphs({selection:[{key:'base:一',char:'一',displayTag:'9·1'}],scope:{kind:'session',sessionId:'S'},judgments:[row('last',2,'2026-09-26')],coverage:'complete'})[0];assert.equal(x.displayTag,'9·1');assert.equal(x.judgmentDate,'2026-09-26');return x;});
test('P03-missing-and-empty-scope',()=>{for(const sessionId of [undefined,null,'',' '])assert.throws(()=>resolve([row('x',1)],{kind:'session',sessionId}),/SESSION_ID_REQUIRED/);return 'missing/null/empty/whitespace rejected';});
test('P03-missing-and-empty-judgment-id',()=>{for(const id of [undefined,null,'',' ']){const x=resolve([row(id,1)]);assert.equal(x.source,'reference');assert.equal(x.reason,'missing-judgment-identity');}return true;});
test('P03-missing-and-empty-ink-link',()=>{for(const attemptId of [undefined,null,'',' ']){const x=resolve([row('x',1,undefined,{ink:{...ink('x'),attemptId}})]);assert.equal(x.source,'reference');}return true;});
test('P03-month-format-and-record-identity',()=>{for(const month of [undefined,null,'','2026-9','2026-00','2026-13','2026-09-01'])assert.throws(()=>resolve([],{kind:'month',month}),/INVALID_MONTH/);const x=resolve([row('x',1,undefined,{sessionId:undefined})],{kind:'month',month:'2026-09'});assert.equal(x.reason,'missing-judgment-identity');return true;});
test('invalid-calendar-date',()=>{const x=resolve([row('x',1,'2026-02-31')],{kind:'month',month:'2026-02'});assert.equal(x.reason,'invalid-ordering');return true;});
test('input-not-mutated',()=>{const a=[row('one',1)],s=JSON.stringify(a);resolve(a);assert.equal(JSON.stringify(a),s);return true;});
test('session-membership-order-unchanged',()=>{const stats=[{idx:5,outcome:'slow'},{idx:1,outcome:'miss'},{idx:2,outcome:'fast'}];assert.deepEqual(sessionSelection(stats,cards).map(x=>x.char),stats.map(s=>cards[s.idx].target));return sessionSelection(stats,cards);});
test('month-membership-order-known-fixture',()=>{
 const activity={practiceDays:['2026-09-02','2026-08-31','2026-09-01'],daily:{'2026-09-01':{targetKeys:['base:一','base:水'],independentTargetKeys:['base:水']},'2026-09-02':{targetKeys:['base:二','base:一','missing-key'],independentTargetKeys:[]},'2026-08-31':{targetKeys:['base:大'],independentTargetKeys:[]}}},reviews=[{rating:'Good',cardKey:'base:木',localDay:'2026-09-03'},{rating:'Again',cardKey:'base:日',localDay:'2026-09-03'}];
 const actual=monthSelection({month:'2026-09',activity,reviews,cards});
 assert.deepEqual(actual.items.map(x=>x.char),['一','水','二','木']);assert.equal(actual.keyCount,5);return actual;
});
report.passed=report.rows.filter(x=>x.status==='pass').length;report.failed=report.rows.length-report.passed;
report.inputHashes=Object.fromEntries(['module/layout.mjs','module/selectors.mjs','tests/verify.mjs'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:report.rows.filter(x=>x.status==='fail')},null,2));process.exitCode=report.failed?1:0;
