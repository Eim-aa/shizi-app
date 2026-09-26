import {paintBrushStroke} from './legacy-brush.mjs';
import {sheetLayout,dateTag} from './layout.mjs';
export const TOKENS=Object.freeze({paper:'#FBF8F2',ink:'#3B2F28',reference:'#B3AC9F',muted:'#5D5952',red:'#A6533F',grid:'rgba(166,83,63,.28)'});
/** Offscreen Canvas2D only; returns a bitmap canvas and audit metadata. Never writes storage. */
export async function renderSheet({items,ratio='portrait',signature,referencePaths,sealImage,canvasFactory=()=>document.createElement('canvas'),labelFont='"PingFang SC",sans-serif',testLabel=''}){
  const layout=sheetLayout(items.length,ratio);
  if(layout.status==='pending')return {status:'pending',reason:layout.reason,n:layout.n,ratio:layout.ratio,canvas:null,layout,cells:[]};
  if(layout.status==='empty')return {status:'empty',canvas:null,layout,cells:[]};
  const canvas=canvasFactory();canvas.width=layout.width;canvas.height=layout.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('CANVAS_UNAVAILABLE');
  ctx.fillStyle=TOKENS.paper;ctx.fillRect(0,0,canvas.width,canvas.height);
  const {cell,top,columns,rows}=layout,cells=[];
  ctx.strokeStyle=TOKENS.grid;ctx.lineWidth=3;ctx.beginPath();
  for(let c=0;c<=columns;c++){const x=72+c*cell;ctx.moveTo(x,top);ctx.lineTo(x,top+rows*cell);}
  for(let r=0;r<=rows;r++){const y=top+r*cell;ctx.moveTo(72,y);ctx.lineTo(1008,y);}ctx.stroke();
  for(let i=0;i<layout.cells.length;i++){
    const box=layout.cells[i],item=items[i];
    ctx.save();ctx.beginPath();ctx.rect(box.x+1.5,box.y+1.5,cell-3,cell-3);ctx.clip();
    ctx.strokeStyle=TOKENS.grid;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.beginPath();
    ctx.moveTo(box.x+cell/2,box.y+1.5);ctx.lineTo(box.x+cell/2,box.y+cell-1.5);
    ctx.moveTo(box.x+1.5,box.y+cell/2);ctx.lineTo(box.x+cell-1.5,box.y+cell/2);ctx.stroke();ctx.setLineDash([]);
    if(!item){ctx.restore();continue;}
    const tag=item.displayTag??dateTag(item.displayDate),dateBottom=box.y+layout.dateTop+layout.dateLine;
    const sz=cell*.84*(tag?layout.inkScale:1),centerX=box.x+cell/2+(tag?layout.inkDx:0),centerY=box.y+cell/2+(tag?layout.inkDy:0);
    const bounds={x:Math.min(centerX-sz/2,box.x+cell-3-sz),y:Math.max(centerY-sz/2,tag?dateBottom+3:box.y+3),width:sz,height:sz};
    bounds.height=Math.min(bounds.height,box.y+cell-3-bounds.y);bounds.width=Math.min(bounds.width,bounds.height);
    const draw=item.source==='handwriting'?drawInk(ctx,item.ink,bounds):drawReference(ctx,referencePaths[item.char],bounds,canvasFactory);
    ctx.restore();
    if(tag){ctx.fillStyle=TOKENS.red;ctx.font=`400 ${layout.dateFont}px ${labelFont}`;ctx.textBaseline='top';ctx.textAlign='left';ctx.fillText(tag,box.x+layout.dateLeft,box.y+layout.dateTop);}
    cells.push({index:i,char:item.char,source:item.source,attemptId:item.attemptId,reason:item.reason,judgmentDate:item.judgmentDate,tag,bounds,dateBottom:tag?dateBottom:null,...draw});
  }
  if(!signature||signature.includes('\n'))throw new Error('SINGLE_LINE_SIGNATURE_REQUIRED');
  ctx.fillStyle=TOKENS.muted;ctx.font=`400 26px ${labelFont}`;ctx.textBaseline='alphabetic';ctx.textAlign='left';
  const spacing=26*.16,chars=Array.from(signature),textWidth=chars.reduce((sum,ch)=>sum+ctx.measureText(ch).width,0)+Math.max(0,chars.length-1)*spacing;
  if(textWidth>936-78-36)throw new Error('SIGNATURE_TOO_LONG');
  let tx=72;for(const ch of chars){ctx.fillText(ch,tx,layout.footerTop+78-6);tx+=ctx.measureText(ch).width+spacing;}
  if(!sealImage)throw new Error('SEAL_REQUIRED');
  ctx.save();ctx.translate(1008-39,layout.footerTop+39);ctx.rotate(-3*Math.PI/180);ctx.drawImage(sealImage,-39,-39,78,78);ctx.restore();
  if(testLabel){ctx.font=`400 18px ${labelFont}`;ctx.fillStyle=TOKENS.muted;ctx.textAlign='center';ctx.fillText(testLabel,540,canvas.height-24);}
  return {status:'ready',canvas,layout,cells,signature,textWidth,fonts:{label:labelFont},syntheticLabel:testLabel};
}
const referenceBoundsCache=new WeakMap();
function drawReference(ctx,paths,b,canvasFactory){
  if(!Array.isArray(paths)||!paths.length)throw new Error('REFERENCE_PATHS_MISSING');
  let measured=referenceBoundsCache.get(paths);
  if(!measured){
    const probe=canvasFactory();probe.width=384;probe.height=384;
    const pc=probe.getContext('2d');if(!pc)throw new Error('REFERENCE_CANVAS_UNAVAILABLE');
    const pp=paths.map(p=>new Path2D(p));pc.translate(64,289);pc.scale(.25,-.25);
    for(const p of pp)pc.fill(p);
    const pixels=pc.getImageData(0,0,384,384).data;let x0=384,y0=384,x1=-1,y1=-1;
    for(let y=0;y<384;y++)for(let x=0;x<384;x++)if(pixels[(y*384+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x1<0||x0===0||y0===0||x1===383||y1===383)throw new Error('REFERENCE_BOUNDS_UNAVAILABLE');
    measured={x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,paths:pp};referenceBoundsCache.set(paths,measured);
  }
  const scale=Math.min(b.width/measured.width,b.height/measured.height);
  ctx.save();ctx.translate(b.x+(b.width-measured.width*scale)/2-measured.x*scale,b.y+(b.height-measured.height*scale)/2-measured.y*scale);ctx.scale(scale,scale);ctx.translate(64,289);ctx.scale(.25,-.25);ctx.fillStyle=TOKENS.reference;
  for(const p of measured.paths)ctx.fill(p);ctx.restore();return {rendered:'reference-paths',referenceBoundsMeasured:true};
}
function drawInk(ctx,ink,b){
  // Same c7 brush, projected in a 345-unit offscreen space. Preserve stored ratios;
  // no t/p invention and no R8 1-Euro/CR/new width implementation.
  const sourceSize=345,padding=sourceSize*.075*1.7/2+3;
  const scale=Math.min(b.width,b.height)/(sourceSize+2*padding);
  ctx.save();ctx.translate(b.x+(b.width-(sourceSize+2*padding)*scale)/2+padding*scale,b.y+(b.height-(sourceSize+2*padding)*scale)/2+padding*scale);ctx.scale(scale,scale);
  for(const stroke of ink.strokes){const points=stroke.map(p=>({x:p.x*sourceSize,y:p.y*sourceSize,w:p.w,v:p.v}));
    paintBrushStroke(ctx,points,Math.max(8,sourceSize*.075),{color:TOKENS.ink,detail:true});}
  ctx.restore();return {rendered:'candidate-paintBrushStroke',widthFallback:ink.strokes.flat().some(p=>p.w===undefined),pointCount:ink.strokes.flat().length};
}
