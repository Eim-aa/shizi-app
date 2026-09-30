import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sheetLayout} from '../module/layout.mjs';
import {renderSheet} from '../module/render.mjs';
import {sheetLayout as r1Layout} from '../fixtures/layout-r1.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report={version:'E8-2026-09-26-r2',layer:'Node API contracts with explicit mocked Canvas2D/Path2D; no real browser, font, worker, handwriting or device validation',rows:[]};
async function test(id,run){try{report.rows.push({id,status:'pass',evidence:await run()});}catch(error){report.rows.push({id,status:'fail',error:error.stack});}}
async function withGlobals(values,run){
  const saved=Object.fromEntries(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{for(const [key,descriptor] of Object.entries(values)){delete globalThis[key];if(descriptor)Object.defineProperty(globalThis,key,{configurable:true,...descriptor});}return await run();}
  finally{for(const key of Object.keys(values)){delete globalThis[key];if(saved[key])Object.defineProperty(globalThis,key,saved[key]);}}
}
const poisonDocument={get(){throw new Error('UNEXPECTED_DOCUMENT_ACCESS');}};
const poisonPath={get(){throw new Error('UNEXPECTED_PATH2D_ACCESS');}};
class MockPath2D{constructor(source){this.source=source;}}
function mockFactory({missing2DAt=0}={}){
  const canvases=[],calls=[];
  const factory=()=>{
    const id=canvases.length+1,canvas={width:0,height:0,getContext(type){calls.push([id,'getContext',type]);assert.equal(type,'2d');return id===missing2DAt?null:ctx;}};
    const ctx={canvas,measureText(text){calls.push([id,'measureText',text]);return {width:10};},getImageData(x,y,w,h){calls.push([id,'getImageData',w,h]);const data=new Uint8ClampedArray(w*h*4);data[(100*w+100)*4+3]=255;data[(110*w+120)*4+3]=255;return {data};}};
    for(const name of ['fillRect','beginPath','moveTo','lineTo','stroke','save','rect','clip','setLineDash','restore','fillText','translate','rotate','drawImage','scale','fill'])ctx[name]=(...args)=>calls.push([id,name,...args]);
    canvases.push(canvas);return canvas;
  };
  return {factory,canvases,calls};
}
const renderReference=(factory,paths)=>renderSheet({items:[{char:'一',source:'reference',displayTag:''}],ratio:'square',signature:'人工测试',referencePaths:{一:paths},sealImage:{mock:true},canvasFactory:factory});

await test('geometry-0-through-80-exactly-matches-r1',()=>{
  for(const ratio of ['portrait','square'])for(let n=0;n<=80;n++)assert.deepEqual(sheetLayout(n,ratio),r1Layout(n,ratio));
  return {comparisons:162,ratios:['portrait','square'],n:'all integers 0..80',method:'deep equality against preserved r1 layout outputs'};
});
for(const ratio of ['portrait','square'])await test(`layout-pending-${ratio}`,()=>{
  for(const n of [81,200,Number.MAX_SAFE_INTEGER]){
    const result=sheetLayout(n,ratio);assert.equal(result.status,'pending');assert.equal(result.reason,'OVER_80_POLICY_PENDING');assert.equal(result.n,n);assert.equal(result.ratio,ratio);assert.equal(result.width,1080);assert.equal(result.height,ratio==='portrait'?1440:1080);assert.deepEqual(result.cells,[]);
  }
  return {counts:[81,200,Number.MAX_SAFE_INTEGER],noSelectedCells:true};
});
for(const ratio of ['portrait','square'])await test(`render-pending-${ratio}-does-not-read-items-or-allocate`,async()=>withGlobals({document:poisonDocument,Path2D:poisonPath},async()=>{
  let allocations=0;
  for(const n of [81,200,Number.MAX_SAFE_INTEGER]){
    // Only count is exposed: reading any glyph or calling slice/map fails.
    const items=new Proxy(Object.freeze({length:n}),{get(target,key){if(key==='length')return target.length;throw new Error('UNEXPECTED_ITEM_READ_'+String(key));}});
    const result=await renderSheet({items,ratio,canvasFactory:()=>{allocations++;throw new Error('UNEXPECTED_ALLOCATION');}});
    assert.equal(result.status,'pending');assert.equal(result.reason,'OVER_80_POLICY_PENDING');assert.equal(result.n,n);assert.equal(result.ratio,ratio);assert.equal(result.canvas,null);assert.deepEqual(result.cells,[]);assert.deepEqual(result.layout,sheetLayout(n,ratio));
  }
  assert.equal(allocations,0);return {allocations,documentAndPath2D:'poisoned',signatureSealReferencePathsFonts:'not supplied'};
}));
await test('render-pending-default-factory-with-no-dom',()=>withGlobals({document:undefined,Path2D:poisonPath},async()=>{
  const items=Object.freeze(Array.from({length:81},(_,i)=>Object.freeze({char:`人工${i}`})));
  const before=JSON.stringify(items),result=await renderSheet({items});
  assert.equal(result.status,'pending');assert.equal(result.n,81);assert.equal(result.ratio,'portrait');assert.equal(result.canvas,null);assert.deepEqual(result.cells,[]);assert.equal(JSON.stringify(items),before);return {inputUnchanged:true,document:'absent',factory:'default, never invoked'};
}));
await test('empty-still-allocates-nothing',()=>withGlobals({document:poisonDocument},async()=>{
  for(const ratio of ['portrait','square']){const result=await renderSheet({items:[],ratio,canvasFactory:()=>{throw new Error('UNEXPECTED_ALLOCATION');}});assert.equal(result.status,'empty');assert.equal(result.canvas,null);assert.deepEqual(result.cells,[]);}
  return 'empty contract retained for both ratios';
}));
await test('invalid-count-remains-error-before-pending',async()=>{
  for(const n of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'81',null]){
    assert.throws(()=>sheetLayout(n),/INVALID_COUNT/);
    await assert.rejects(renderSheet({items:{length:n},canvasFactory:()=>{throw new Error('UNEXPECTED_ALLOCATION');}}),/INVALID_COUNT/);
  }
  return 'negative/fraction/nonfinite/unsafe/string/null counts rejected by both APIs';
});
await test('invalid-ratio-remains-error-even-over80',async()=>{
  for(const ratio of ['wide','',null,'toString','constructor','__proto__',{}])for(const n of [0,1,81,200]){
    assert.throws(()=>sheetLayout(n,ratio),/INVALID_RATIO/);
    await assert.rejects(renderSheet({items:{length:n},ratio,canvasFactory:()=>{throw new Error('UNEXPECTED_ALLOCATION');}}),/INVALID_RATIO/);
  }
  return 'invalid ratio rejected before empty or pending return';
});
for(const mode of ['poisoned','absent'])await test(`injected-factory-main-and-fresh-probe-document-${mode}`,()=>withGlobals({document:mode==='poisoned'?poisonDocument:undefined,Path2D:{value:MockPath2D}},async()=>{
  const mock=mockFactory(),freshPaths=['M 1 1 L 2 2']; // New array guarantees a cache miss.
  const result=await renderReference(mock.factory,freshPaths);
  assert.equal(result.status,'ready');assert.equal(result.canvas,mock.canvases[0]);assert.equal(mock.canvases.length,2);assert.notEqual(mock.canvases[0],mock.canvases[1]);assert.equal(mock.canvases[0].width,1080);assert.equal(mock.canvases[1].width,384);assert.equal(mock.canvases[1].height,384);assert(mock.calls.some(c=>c[0]===2&&c[1]==='getImageData'));assert(mock.calls.some(c=>c[0]===1&&c[1]==='fill'&&c[2] instanceof MockPath2D));assert.equal(result.cells[0].referenceBoundsMeasured,true);
  return {allocations:2,mainSize:[1080,1080],probeSize:[384,384],cache:'fresh paths',document:mode,raster:'mocked'};
}));
await test('main-missing-2d-is-explicit-error',()=>withGlobals({document:poisonDocument,Path2D:{value:MockPath2D}},async()=>{
  const mock=mockFactory({missing2DAt:1});await assert.rejects(renderReference(mock.factory,['M 3 3 L 4 4']),/^Error: CANVAS_UNAVAILABLE$/);assert.equal(mock.canvases.length,1);assert.deepEqual(mock.calls,[[1,'getContext','2d']]);return {error:'CANVAS_UNAVAILABLE',allocations:1};
}));
await test('fresh-probe-missing-2d-is-explicit-error-and-not-cached',()=>withGlobals({document:poisonDocument,Path2D:{value:MockPath2D}},async()=>{
  const paths=['M 5 5 L 6 6'],missing=mockFactory({missing2DAt:2});
  await assert.rejects(renderReference(missing.factory,paths),/^Error: REFERENCE_CANVAS_UNAVAILABLE$/);assert.equal(missing.canvases.length,2);assert(!missing.calls.some(c=>c[0]===2&&c[1]==='getImageData'));
  const recovered=mockFactory();assert.equal((await renderReference(recovered.factory,paths)).status,'ready');assert.equal(recovered.canvases.length,2);
  return {error:'REFERENCE_CANVAS_UNAVAILABLE',failedProbeAllocations:2,retryAllocations:2,failedMeasurementNotCached:true};
}));
await test('warm-cache-does-not-mask-fresh-probe-failure',()=>withGlobals({document:poisonDocument,Path2D:{value:MockPath2D}},async()=>{
  const paths=['M 7 7 L 8 8'],warm=mockFactory();await renderReference(warm.factory,paths);assert.equal(warm.canvases.length,2);
  const reused=mockFactory();await renderReference(reused.factory,paths);assert.equal(reused.canvases.length,1);
  const fresh=mockFactory({missing2DAt:2});await assert.rejects(renderReference(fresh.factory,[...paths]),/REFERENCE_CANVAS_UNAVAILABLE/);assert.equal(fresh.canvases.length,2);
  return {cache:'existing paths-identity cache retained',warmAllocations:1,freshPathsAllocateProbe:true};
}));
report.passed=report.rows.filter(row=>row.status==='pass').length;report.failed=report.rows.length-report.passed;
report.inputHashes=Object.fromEntries(['module/layout.mjs','module/render.mjs','module/legacy-brush.mjs','tests/r2-contract.mjs','fixtures/layout-r1.mjs'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
console.log(JSON.stringify({version:report.version,passed:report.passed,failed:report.failed,failures:report.rows.filter(row=>row.status==='fail')},null,2));process.exitCode=report.failed?1:0;
