import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {SHI_BOLD_PATHS,SHI_BOLD_TRANSFORM,SHI_BOLD_CENTER,SHI_SEAL_VIEW} from '../../src/core/images/shi-paths.js';
const root='scripts/image-parity',manifest=JSON.parse(fs.readFileSync(path.join(root,'reference-manifest.json'),'utf8'));
assert.deepEqual(JSON.parse(fs.readFileSync('ios/ShiziCore/Sources/ShiziImageRendering/Resources/seal.json','utf8')),{paths:SHI_BOLD_PATHS,transform:SHI_BOLD_TRANSFORM,center:SHI_BOLD_CENTER,view:SHI_SEAL_VIEW},'native seal must track the source brand paths');
for(const f of manifest.files){
 const data=fs.readFileSync(path.join(root,'reference',f.file));
 assert.equal(data.length,f.bytes,f.file);
 assert.equal(createHash('sha256').update(data).digest('hex'),f.sha256,f.file);
 if(process.argv.includes('--generated'))assert.equal(createHash('sha256').update(fs.readFileSync(path.join('artifacts/image-parity/reference',f.file))).digest('hex'),f.sha256,'generated reference changed: '+f.file);
}
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'inputs.json'),'utf8')).length,40);
console.log(`Reference checksums + source seal: ${manifest.files.length} PNGs, ${manifest.bytes} bytes`);
