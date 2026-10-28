import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import {webkit} from 'playwright';
const out=process.argv[2] || 'artifacts/image-parity/reference';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const p=path.resolve('.','.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(process.cwd()+'/')){res.writeHead(403).end();return}try{res.setHeader('Content-Type',p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':p.endsWith('.woff2')?'font/woff2':'text/html');res.end(fs.readFileSync(p))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await webkit.launch();
try {
const page=await browser.newPage();await page.goto(origin+'/fonts/fonts.css');await page.setContent(`<link rel="stylesheet" href="${origin}/fonts/fonts.css">`);await page.evaluate(async()=>{
 await document.fonts.load('400 36px ShiziKai','拾字');
 await document.fonts.load('400 36px ShiziSerifSC','拾字');
 await document.fonts.load('500 36px ShiziSerifSC','拾字');
 await document.fonts.ready;
});
for(const spec of JSON.parse(fs.readFileSync('artifacts/image-parity/expanded.json','utf8'))) {
 const pngs=await page.evaluate(async({spec,origin})=>{
 const r=await import(origin+'/src/core/images/render.js'),a=await import(origin+'/src/core/images/annual-render.js'),b=await import(origin+'/src/ui/canvas/brush.js');
 const requireFont=async(stack,text,{weight=400}={})=>{await document.fonts.load(`${weight} 36px ${stack}`,text)};
 const loadGlyph=async ch=>{const res=await fetch(origin+`/data/${ch}.json`);return res.ok?res.json():null};
 const deps={...spec.args,palette:spec.palette,requireFont,loadGlyph,paintStroke:b.paintBrushStroke};
 const fn={work:r.renderWorkPage,sheet:r.renderSheetPage,glyph:r.renderSingleGlyph,'annual-cover':a.renderAnnualCover,'annual-tail':a.renderAnnualTail,'annual-long':a.renderAnnualLong}[spec.kind];
 const result=await fn(deps);return (result.canvases || (result.canvas?[result.canvas]:[])).map(c=>c.toDataURL('image/png').split(',')[1]);
 },{spec,origin});
 for(let i=0;i<pngs.length;i++)fs.writeFileSync(path.join(out,`${spec.id}-${i}.png`),Buffer.from(pngs[i],'base64'));
 console.log(spec.id,pngs.length);
}
}finally{await browser.close();server.close()}
