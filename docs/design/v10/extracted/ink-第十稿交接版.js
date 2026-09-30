// 拾字 · 笔迹管线（第八稿 1.1 / 1.2 / 1.3）。实时书写、演示笔迹、真人笔迹回放共用这一份。
// 单位：坐标 pt（书写格 345×345），时间 ms。输出点 {x,y,w}，w 为笔宽。
(function(){
  const BASE=11.5;
  function oneEuro(minc,beta,dc){let xp=null,dxp=0,tp=null;const al=(fc,dt)=>1/(1+1/(2*Math.PI*fc)/dt);
    return (x,t)=>{if(xp===null){xp=x;tp=t;return x;}const dt=t-tp;if(!(dt>0))return xp;const dx=(x-xp)/dt,ad=al(dc,dt),dxh=ad*dx+(1-ad)*dxp,a=al(minc+beta*Math.abs(dxh),dt),xh=a*x+(1-a)*xp;xp=xh;dxp=dxh;tp=t;return xh;};}
  // Catmull-Rom，步长 3pt；t 线性插值
  function cr(p){if(p.length<2)return p.slice();const o=[],P=[p[0],...p,p[p.length-1]];
    for(let i=1;i<P.length-2;i++){const a=P[i-1],b=P[i],c=P[i+1],d=P[i+2],n=Math.max(1,Math.ceil(Math.hypot(c.x-b.x,c.y-b.y)/3));
      for(let j=0;j<n;j++){const t=j/n,t2=t*t,t3=t2*t;o.push({x:.5*(2*b.x+(-a.x+c.x)*t+(2*a.x-5*b.x+4*c.x-d.x)*t2+(-a.x+3*b.x-3*c.x+d.x)*t3),y:.5*(2*b.y+(-a.y+c.y)*t+(2*a.y-5*b.y+4*c.y-d.y)*t2+(-a.y+3*b.y-3*c.y+d.y)*t3),t:b.t+(c.t-b.t)*t});}}
    o.push(p[p.length-1]);return o;}
  // raw: [{x,y,t}] 原始采样（ms）。final=true 表示已抬笔。
  // tune（第九稿调试叠层用，可省）：{lo,hi} 两个收笔阈值 pt/ms，缺省 .25 / .9
  // 第九稿第一批修订：同一时刻的采样先合并（留最后的位置）；点画 = 本体宽 × 0.7→1.1→0.9；单点画圆，直径 0.9 × 起笔本体宽
  function build(raw,final,base,tune){base=base||BASE;if(!raw.length)return [];const LO=tune&&tune.lo!=null?tune.lo:.25,HI=tune&&tune.hi!=null?tune.hi:.9;
    const m=[];raw.forEach(r=>{const q={x:r.x,y:r.y,t:r.t};if(m.length&&r.t===m[m.length-1].t)m[m.length-1]=q;else m.push(q);});
    const fx=oneEuro(1,.02,1),fy=oneEuro(1,.02,1);
    let f=m.map(r=>({x:fx(r.x,r.t/1000),y:fy(r.y,r.t/1000),t:r.t}));
    if(final&&m.length>1){const l=m[m.length-1];f[f.length-1]={x:l.x,y:l.y,t:l.t};}
    const p=cr(f);const n=p.length;const L=[0];for(let i=1;i<n;i++)L.push(L[i-1]+Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y));
    const len=L[n-1];
    if(m.length===1||len===0){const o=[{x:p[n-1].x,y:p[n-1].y,w:base*.9}];o.v30=null;o.dot=true;o.single=true;o.endK=.9;return o;}
    const dot=final&&len<24;
    // 抬笔前 30ms 平均速度：窗口插值到恰好 30ms，分子分母取同一段（与刷新率无关）；只用合并后的点
    let v30=null;if(final){const n0=m.length,tl=m[n0-1].t,t0=tl-30;let i=n0-1,d=0;
      while(i>0&&m[i-1].t>=t0){d+=Math.hypot(m[i].x-m[i-1].x,m[i].y-m[i-1].y);i--;}
      let dt=tl-m[i].t;if(i>0){const a=m[i-1],b=m[i],u=(b.t-t0)/(b.t-a.t);d+=Math.hypot(b.x-a.x,b.y-a.y)*u;dt=30;}
      v30=dt>0?d/dt:0;}
    const vv=v30==null?.5:v30, k=Math.min(1,Math.max(0,(vv-LO)/Math.max(1e-6,HI-LO))),endMin=.9+(.12-.9)*k,tap=Math.min(28,len*.3);
    let w=base;const out=[];
    for(let i=0;i<n;i++){let fct;
      if(i>0){const dt=p[i].t-p[i-1].t;if(dt>0){const v=(L[i]-L[i-1])/dt,tgt=base*(1.06-Math.min(v,1.5)*.12);w+=(tgt-w)*(1-Math.exp(-dt/35));}}
      const s=L[i];
      if(dot){const u=len?s/len:0;fct=u<.5?.7+(1.1-.7)*(u/.5):1.1+(.9-1.1)*((u-.5)/.5);out.push({x:p[i].x,y:p[i].y,w:w*fct});continue;}
      fct=s<6?.85+.23*(s/6):s<12?1.08-.08*((s-6)/6):1;
      if(final&&k>0&&len-s<tap){const u=(len-s)/tap;fct*=endMin+(1-endMin)*u;}
      out.push({x:p[i].x,y:p[i].y,w:w*fct});}
    out.v30=v30;out.dot=dot;out.single=false;out.endK=out[n-1].w/base;return out;}
  // 演示：中线合成时间戳后走同一条管线。起笔 .2 → 中段 .6 → 抬笔前 15pt 为 .5（pt/ms），点画全程 .2
  function synth(pts,base){if(!pts.length)return [];let len=0;for(let i=1;i<pts.length;i++)len+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
    const dot=len<24;let t=0,s=0;const raw=[{x:pts[0].x,y:pts[0].y,t:0}];
    for(let i=1;i<pts.length;i++){const ds=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);s+=ds;
      const v=dot?.2:(len-s<15?.5:s<12?.2+.4*(s/12):.6);t+=Math.max(1,ds/v);raw.push({x:pts[i].x,y:pts[i].y,t});}
    return build(resample(raw,HZ120),true,base);}
  // 按固定间隔重采样（模拟 120Hz 输入，8.33ms 一个点）；最后一个点总保留
  const HZ120=1000/120;
  function resample(raw,step){const o=[raw[0]],T=raw[raw.length-1].t;let j=1;
    for(let t=step;t<T;t+=step){while(j<raw.length-1&&raw[j].t<t)j++;const a=raw[j-1],b=raw[j],u=(t-a.t)/Math.max(1e-6,b.t-a.t);o.push({x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,t});}
    const l=raw[raw.length-1];if(o[o.length-1].t<l.t)o.push({x:l.x,y:l.y,t:l.t});return o;}
  // 匀速轨迹（笔迹规格样例用）：pts 中线，v pt/ms
  function atSpeed(pts,v,base,step){let t=0;const raw=[{x:pts[0].x,y:pts[0].y,t:0}];for(let i=1;i<pts.length;i++){t+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y)/v;raw.push({x:pts[i].x,y:pts[i].y,t});}return build(resample(raw,step||HZ120),true,base);}
  // 写错样本（1.3）：真人样本不像写错时，照 WRONG 做删笔和错位。st 是按原笔序的点数组，cc 为格心
  function wrongFix(st,W,cc){if(!W)return st;return st.map((p,idx)=>{if(W.drop&&W.drop.includes(idx))return null;const t=W.tilt&&idx>=W.tilt.from&&(W.tilt.to==null||idx<=W.tilt.to)?W.tilt:null;if(!t)return p;
    const a=t.a*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return p.map(q=>{const px=q.x-cc,py=q.y-cc;return Object.assign({},q,{x:cc+px*c-py*s+t.dx,y:cc+px*s+py*c+t.dy});});}).filter(Boolean);}
  // floor：345 空间里的最小笔宽 = 屏幕下限 pt × 345 ÷ 格子边长 pt（首页墨迹行、写完一组的小格用）
  function outline(pts,floor){const n=pts.length,L=[],R=[];if(!n)return '';const F=floor||0,W=p=>Math.max(p.w,F);
    for(let i=0;i<n;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(n-1,i+1)],p=pts[i],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l,h=W(p)/2;
      L.push((p.x+nx*h).toFixed(1)+' '+(p.y+ny*h).toFixed(1));R.push((p.x-nx*h).toFixed(1)+' '+(p.y-ny*h).toFixed(1));}
    const c=(p)=>{const w=W(p),r=(w/2).toFixed(2);return 'M'+(p.x-w/2).toFixed(1)+' '+p.y.toFixed(1)+'a'+r+' '+r+' 0 1 0 '+w.toFixed(2)+' 0a'+r+' '+r+' 0 1 0 '+(-w).toFixed(2)+' 0';};
    return 'M'+L.concat(R.reverse()).join('L')+'Z'+c(pts[0])+c(pts[n-1]);}

  // ——— 1.3 真人笔迹 ———
  // 记录：{char, writer, pass, kind?, strokes:[[{x,y,t,p?}]]}；x、y 在 345×345，t 从第一次落笔起算（ms），p 可选。
  // kind 可选：'wrong' 写错样本、'trace' 描红（描一遍 H）；缺省为普通。格式说明见 data/handwriting/格式-第十稿交接版.md
  const REC={};
  // 数据到位后，把文件名填进这里，例如 'data/handwriting/writer-01.json'（每个文件是记录数组）
  const SOURCES=[];
  function register(list){(Array.isArray(list)?list:[list]).forEach(r=>{if(r&&r.char&&r.strokes)(REC[r.char]=REC[r.char]||[]).push(r);});api.rev++;try{window.dispatchEvent(new Event('szink'));}catch(_){}}
  function pick(c,kind,n){const a=(REC[c]||[]).filter(r=>(r.kind||'normal')===(kind||'normal'));return a.length?a[(n||0)%a.length]:null;}
  // 静态缩略图：按记录里的 t 一次算完，不做实时动画
  // 每笔可以是点数组（旧写法），也可以是 {end, points}（第九稿第一批修订）；end 为 'cancel' 的笔不收尖
  const spts=s=>Array.isArray(s)?s:(s&&s.points)||[];
  function fromRecord(rec,base){return rec.strokes.map(s=>build(spts(s).map(q=>({x:q.x,y:q.y,t:q.t})),!(s&&s.end==='cancel'),base));}
  // 回放：按原时间把点喂给 down / move / up。返回停止函数。
  function play(rec,h){const ev=[];rec.strokes.forEach(s=>{const P=spts(s),c=s&&s.end==='cancel';P.forEach((q,i)=>ev.push({t:q.t,k:i===0?'down':'move',q,last:i===P.length-1,c}));});ev.sort((a,b)=>a.t-b.t);
    let i=0,stop=false;const t0=performance.now();
    const tick=()=>{if(stop)return;const now=performance.now()-t0;while(i<ev.length&&ev[i].t<=now){const e=ev[i++],p={x:e.q.x,y:e.q.y,t:t0+e.q.t,p:e.q.p};if(e.k==='down')h.down(p);else h.move(p);if(e.last){if(e.c&&h.cancel)h.cancel();else h.up();}}if(i<ev.length)requestAnimationFrame(tick);else if(h.end)h.end();};
    requestAnimationFrame(tick);return ()=>{stop=true;};}
  const api={BASE,build,synth,atSpeed,resample,wrongFix,outline,register,pick,fromRecord,play,rev:0,sources:SOURCES};
  window.SZInk=api;
  SOURCES.forEach(u=>fetch(u).then(r=>r.json()).then(register).catch(()=>{}));
})();
