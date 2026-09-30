/* Exact c7 candidate function extraction; do not implement R8 ink here. */
const S=345;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const brushLayerCache=new WeakMap();
const motionReduced=()=>!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const cssVar=(name,fallback)=>fallback;
function penBaseWidth(size=S){ return Math.max(5,size*.045); }
function brushDetailEnabled(capabilities=navigator){ const cores=Number(capabilities&&capabilities.hardwareConcurrency)||4, memory=Number(capabilities&&capabilities.deviceMemory)||4; return !motionReduced()&&cores>2&&memory>2; }
function brushWidthFor(point,previous,state={ema:0},base=penBaseWidth()){ const dt=Math.max(1,(Number(point.t)||0)-(Number(previous&&previous.t)||0)), distance=previous?Math.hypot(point.x-previous.x,point.y-previous.y):0, velocity=distance/dt;
  const pressure=clamp(Number(point.p)||0,0,1), target=pressure>0?clamp(base*(.58+Math.sqrt(pressure)*.94),base*.58,base*1.52):clamp(base*(1.34-Math.min(1,velocity/1.8)*.74),base*.6,base*1.34);
  state.ema=state.ema?state.ema*.62+target*.38:target; point.w=state.ema/base; point.v=velocity; return state.ema; }
function brushStrokeGeometry(points,base){ const lengths=[0], widths=[], count=points.length; let total=0, state={ema:0};
  for(let i=1;i<count;i++){ total+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y); lengths.push(total); }
  points.forEach((point,i)=>{ const hasWidth=Number(point.w)>0,hasTiming=Number.isFinite(Number(point.t)); let width=hasWidth?clamp(Number(point.w),.35,1.7)*base:(hasTiming?brushWidthFor({...point},points[Math.max(0,i-1)],state,base):base); const along=lengths[i], fromEnd=total-along, head=Math.min(total*.16,base*2), tail=Math.min(total*.3,base*3.8);
    if(head>0&&along<head) width*=.62+.38*Math.pow(along/head,.7); if(tail>0&&fromEnd<tail) width*=Math.max(.16,Math.pow(fromEnd/tail,.72)); widths.push(Math.max(1,width)); });
  return {lengths,widths,total}; }
function paintBrushRibbon(ctx,a,b,ra,rb){ const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy); if(!length) return; const nx=-dy/length,ny=dx/length;
  ctx.beginPath(); ctx.moveTo(a.x+nx*ra,a.y+ny*ra); ctx.lineTo(b.x+nx*rb,b.y+ny*rb); ctx.lineTo(b.x-nx*rb,b.y-ny*rb); ctx.lineTo(a.x-nx*ra,a.y-ny*ra); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(b.x,b.y,rb,0,Math.PI*2); ctx.fill(); }
function paintInkBloom(ctx,point,radius,color){ const spread=Math.min(2,Math.max(.8,radius*.14)), gradient=ctx.createRadialGradient(point.x,point.y,Math.max(0,radius-spread),point.x,point.y,radius+spread);
  gradient.addColorStop(0,color); gradient.addColorStop(.72,color); gradient.addColorStop(1,"rgba(0,0,0,0)"); ctx.save(); ctx.globalAlpha=.11; ctx.fillStyle=gradient; ctx.beginPath(); ctx.arc(point.x,point.y,radius+spread,0,Math.PI*2); ctx.fill(); ctx.restore(); }
function brushStrokeLayer(ctx){ const target=ctx&&ctx.canvas; if(!target || !target.width || !target.height || typeof ctx.getTransform!=="function") return null; let layer=brushLayerCache.get(target);
  if(!layer || layer.canvas.width!==target.width || layer.canvas.height!==target.height){ const canvas=document.createElement("canvas"); canvas.width=target.width; canvas.height=target.height; layer={canvas,ctx:canvas.getContext("2d")}; brushLayerCache.set(target,layer); }
  const layerCtx=layer.ctx; layerCtx.setTransform(1,0,0,1,0,0); layerCtx.clearRect(0,0,layer.canvas.width,layer.canvas.height); layerCtx.globalAlpha=1; layerCtx.globalCompositeOperation="source-over"; layerCtx.setLineDash([]); layerCtx.setTransform(ctx.getTransform()); return layer; }
function compositeBrushLayer(ctx,layer){ if(!layer) return; ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation="source-over"; ctx.drawImage(layer.canvas,0,0); ctx.restore(); }
function paintBrushStroke(ctx,points,base,options={}){ if(!Array.isArray(points)||!points.length) return false; const layer=brushStrokeLayer(ctx), brushCtx=layer?layer.ctx:ctx, color=options.color||cssVar('--inkPen',"#29241d"), detail=options.detail!==false&&brushDetailEnabled(options.capabilities), geometry=brushStrokeGeometry(points,base), widths=geometry.widths;
  brushCtx.save(); brushCtx.fillStyle=color; if(detail) paintInkBloom(brushCtx,points[0],widths[0]/2,color);
  if(points.length===1){ brushCtx.beginPath(); brushCtx.arc(points[0].x,points[0].y,widths[0]/2,0,Math.PI*2); brushCtx.fill(); brushCtx.restore(); compositeBrushLayer(ctx,layer); return true; }
  brushCtx.beginPath(); brushCtx.arc(points[0].x,points[0].y,widths[0]/2,0,Math.PI*2); brushCtx.fill();
  for(let i=1;i<points.length;i++){ const a=points[i-1],b=points[i],ra=widths[i-1]/2,rb=widths[i]/2; paintBrushRibbon(brushCtx,a,b,ra,rb);
    const dt=(Number(b.t)||0)-(Number(a.t)||0); if(detail&&dt>52) paintInkBloom(brushCtx,b,rb,color);
    const velocity=Number.isFinite(Number(b.v))?Number(b.v):(dt>0?Math.hypot(b.x-a.x,b.y-a.y)/dt:0); if(detail&&velocity>1.05&&Math.hypot(b.x-a.x,b.y-a.y)>base*.35){ brushCtx.save(); brushCtx.globalCompositeOperation="destination-out"; brushCtx.globalAlpha=Math.min(.2,.07+(velocity-1.05)*.05); brushCtx.strokeStyle="#000"; brushCtx.lineWidth=Math.max(.65,(ra+rb)*.12); brushCtx.lineCap="round"; brushCtx.setLineDash([Math.max(1,base*.42),Math.max(2,base*.72)]); brushCtx.lineDashOffset=-(i%3)*base*.23; brushCtx.beginPath(); brushCtx.moveTo(a.x,a.y); brushCtx.lineTo(b.x,b.y); brushCtx.stroke(); brushCtx.restore(); } }
  brushCtx.restore(); compositeBrushLayer(ctx,layer); return true; }

export {paintBrushStroke};
