import fs from 'node:fs';
const inputs=JSON.parse(fs.readFileSync('scripts/image-parity/inputs.json','utf8')),expanded=[];
for(const spec of inputs){expanded.push(spec);for(const layer of ['frame','seal','ink']){
 const palette=Object.fromEntries(Object.keys(spec.palette).map(k=>[k,typeof spec.palette[k]==='string'?'#FFFFFF':spec.palette[k]]));
 for(const k of layer==='frame'?['frame','guide']:layer==='seal'?['seal']:['hand','under'])palette[k]='#000000';
 expanded.push({...spec,id:`${spec.id}-${layer}`,palette});
}}
fs.mkdirSync('artifacts/image-parity',{recursive:true});fs.writeFileSync('artifacts/image-parity/expanded.json',JSON.stringify(expanded));
