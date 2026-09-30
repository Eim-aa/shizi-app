import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectText,requireFont} from '../fonts/assets/font-loader.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../fonts/corpus/coverage-manifest.json',import.meta.url)));
const rows=[];
function stub(faces,error){const calls=[];globalThis.document={fonts:{load:async(...args)=>{calls.push(args);if(error)throw error;return structuredClone(faces);},check:()=>{throw Error('fonts.check must not authorize fallback');},ready:Promise.resolve()}};return calls;}
async function test(id,run){try{await run();rows.push({id,status:'pass'});}catch(error){rows.push({id,status:'fail',error:error.stack});}}
const face=(family,weight)=>({family,weight:String(weight),style:'normal',status:'loaded'});
const context=(error,family,weight)=>error.message.includes(`${family}:${weight}`)&&error.message.includes(manifest[`${family}:${weight}`].file);
for(const [family,weight] of [['ShiziKai',400],['ShiziSerifSC',400],['ShiziSerifSC',500]])await test(`normal-${family}-${weight}`,async()=>{stub([face(family,weight)]);assert.equal((await requireFont(manifest,family,weight,'心')).text,'心');});
await test('400-cannot-satisfy-500',async()=>{stub([face('ShiziSerifSC',400)]);await assert.rejects(()=>requireFont(manifest,'ShiziSerifSC',500,'心'),e=>context(e,'ShiziSerifSC',500));});
await test('missing-style-is-not-normal',async()=>{const f=face('ShiziSerifSC',500);delete f.style;stub([f]);await assert.rejects(()=>requireFont(manifest,'ShiziSerifSC',500,'心'),/unavailable/);});
await test('empty-faces-rejected',async()=>{stub([]);await assert.rejects(()=>requireFont(manifest,'ShiziKai',400,'心'),/unavailable/);});
await test('wrong-family-rejected',async()=>{stub([face('serif',500)]);await assert.rejects(()=>requireFont(manifest,'ShiziSerifSC',500,'心'),/unavailable/);});
for(const weight of [400,500])await test(`nfc-${weight}`,async()=>{const calls=stub([face('ShiziSerifSC',weight)]);const result=await requireFont(manifest,'ShiziSerifSC',weight,'u\u0308\u030c');assert.equal(result.text,'ǚ');assert.equal(calls[0][1],'ǚ');});
await test('load-failure-keeps-cause-and-context',async()=>{const cause=new Error('controlled failure');stub([],cause);await assert.rejects(()=>requireFont(manifest,'ShiziSerifSC',500,'心'),e=>e.cause===cause&&context(e,'ShiziSerifSC',500));});
await test('missing-glyph-stops-before-load',async()=>{const calls=stub([]);await assert.rejects(()=>requireFont(manifest,'ShiziSerifSC',500,'𠀀'),e=>context(e,'ShiziSerifSC',500)&&e.message.includes('U+20000'));assert.equal(calls.length,0);});
await test('residual-combining-stops-before-load',async()=>{const calls=stub([]),raw='u\u0308\u030c\u030c';assert(inspectText(manifest,'ShiziSerifSC',500,raw).unreviewedCombining.length);await assert.rejects(()=>requireFont(manifest,'ShiziSerifSC',500,raw),/combining sequence/);assert.equal(calls.length,0);});
delete globalThis.document;
console.log(JSON.stringify({layer:'Node FontFaceSet stubs; no real browser/font loading',passed:rows.filter(x=>x.status==='pass').length,failed:rows.filter(x=>x.status==='fail').length,rows},null,2));
process.exitCode=rows.some(x=>x.status==='fail')?1:0;
