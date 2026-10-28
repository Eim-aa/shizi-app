import fs from 'node:fs';import {layout,sheetPageLayout} from '../../src/core/images/layout.js';import {glyphLayout,inkBounds} from '../../src/core/images/glyph-layout.js';
const out={};
for(const spec of JSON.parse(fs.readFileSync('scripts/image-parity/inputs.json','utf8'))){
const a=spec.args,s=a.scale??4/3,text=[];let pages=1;
if(['work','sheet'].includes(spec.kind)){
 const l=(spec.kind==='sheet'?sheetPageLayout:layout)(a.cells.length,a.ratio),k=l.kuan;
 text.push([0,k.top-12,l.seal.x-4,k.lineHeight+24]);
 // signature may sit underneath a partial row: exclude its entire line, while retaining the seal.
 if(!l.below)text[text.length-1]=[0,k.top-12,1080,k.lineHeight+24];
 if(spec.kind==='sheet')for(let i=0;i<a.cells.length;i++){if(!a.cells[i].tag)continue;let b=l.cells[i];text.push([b.x+7,b.y-17,60,34]);}
 else for(let i=0;i<a.cells.length;i++){if(!a.cells[i].tag)continue;let b=l.cells[i];text.push([b.x+10,b.y+6,60,34]);}
 for(const r of text){for(let i=0;i<4;i++)r[i]*=s}
}else if(spec.kind==='glyph'){
 const l=glyphLayout(inkBounds(a.points),a.ratio);text.push([0,l.info.top-10,1080,l.info.line+20],[0,l.signature.baseline-40,l.signature.right+3,55]);
}else if(spec.kind==='annual-cover')text.push([110,190,900,125],[110,330,950,85],[570,890,500,120],[0,1238,880,70]);
else if(spec.kind==='annual-tail')text.push([110,190,950,90],[110,845,420,65],[550,845,500,65],[0,1238,880,70]);
else {
 const blocks=[{h:718,text:[[87,105,950,115],[87,238,950,80],[427,540,650,120]]}];
 for(const m of a.months){blocks.push({h:136,keep:true,text:[[87,40,950,80]]});for(let i=0;i<m.cells.length;i+=8)blocks.push({h:110+(i+8>=m.cells.length?56:0),text:[]});}
 if(a.tail)blocks.push({h:776,text:[[87,40,950,80],[87,574,950,70]]});
 blocks.push({h:164,text:[[0,37,880,70]]});let chunk=[],h=0,index=0;
 const emit=()=>{out[`${spec.id}-${index++}.png`]={text:chunk};chunk=[];h=0};
 for(let i=0;i<blocks.length;i++){let b=blocks[i],need=b.h+(b.keep?blocks[i+1].h:0);if(h&&h+need>Math.floor((a.maxExportHeight??11650)/s))emit();for(let [x,y,w,hh]of b.text)chunk.push([x*s,(y+h)*s,w*s,hh*s]);h+=b.h;}if(h)emit();continue;
}
if(spec.kind.startsWith('annual'))for(const r of text)for(let i=0;i<4;i++)r[i]*=s;
out[`${spec.id}-0.png`]={text};
}
fs.writeFileSync('artifacts/image-parity/regions.json',JSON.stringify(out,null,2));
