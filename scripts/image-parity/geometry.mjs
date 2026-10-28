import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {layout,sheetPageLayout,sheetGrid,withDayTags,sheetTags} from '../../src/core/images/layout.js';
import {glyphLayout,inkBounds} from '../../src/core/images/glyph-layout.js';
import {paginate} from '../../src/core/images/paginate.js';
const cases=[];
const add=(op,args,reply)=>cases.push({op,args,reply});
for(let n=0;n<=80;n++) for(const ratio of ['3:4','1:1']) for(const sheet of [false,true]) add('images.layout',{n,ratio,sheet},(sheet?sheetPageLayout:layout)(n,ratio));
for(let n=0;n<=160;n++) for(const unit of [1,2.69]) for(const width of [362,886]) add('images.sheetGrid',{n,width,unit},sheetGrid(n,width,{unit}));
for(let n=0;n<=250;n++) {
  const cells=Array.from({length:n},(_,i)=>({ch:'一',day:`2026-10-${String(1+Math.floor(i/37)).padStart(2,'0')}`}));
  for(const max of [1,7,40,80]) add('images.paginate',{cells,max},paginate(cells,max));
  add('images.withDayTags',{cells},withDayTags(cells));add('images.sheetTags',{cells:withDayTags(cells)},sheetTags(withDayTags(cells)));
}
for(const points of [[],[[{x:10,y:20,w:10},{x:300,y:290,w:2}]],[[{x:50,y:50}]],[[{x:0,y:0,w:2}]]]) {
  const bounds=inkBounds(points);add('images.inkBounds',{points},bounds);
  for(const ratio of ['portrait','square']) add('images.glyphLayout',{bounds,ratio},glyphLayout(bounds,ratio));
}
if(process.argv.includes('--fixtures')) {
  const fs=await import('node:fs');
  fs.writeFileSync('ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/images-geometry.json',JSON.stringify(cases.slice(0,324))+'\n');
  console.log('Wrote 324 geometry fixtures');process.exit(0);
}
const p=spawnSync('ios/ShiziCore/.build/debug/shizi-core-cli',[],{input:cases.map(({op,args})=>JSON.stringify({op,args,state:false})).join('\n')+'\n',maxBuffer:128*1024*1024,encoding:'utf8'});
assert.equal(p.status,0,p.stderr);
const rows=p.stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,cases.length);
rows.forEach((r,i)=>{assert.equal(r.ok,true,JSON.stringify([cases[i],r]));assert.deepEqual(r.reply,cases[i].reply,JSON.stringify({op:cases[i].op,args:cases[i].args}));});
console.log(`Geometry / pagination parity: ${cases.length}/${cases.length} exact`);
