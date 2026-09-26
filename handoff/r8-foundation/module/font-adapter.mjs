/** Optional F8 font integration; default sheet dates/signature remain system sans per 5.3. */
export async function loadCheckedText({family,weight,text,assetBase='/f8-assets/',coverageURL='/f8-coverage.json'}){
  const faceFiles={'ShiziKai:400':'ShiziKai-Regular.woff2','ShiziSerifSC:400':'ShiziSerifSC-Regular.woff2','ShiziSerifSC:500':'ShiziSerifSC-Medium.woff2'},file=faceFiles[`${family}:${weight}`];
  if(!file)throw new Error('F8_FACE_NOT_IN_CONTRACT');
  const response=await fetch(coverageURL);if(!response.ok)throw new Error('F8_COVERAGE_UNAVAILABLE: '+coverageURL);
  const manifest=await response.json(),helper=await import(assetBase+'font-loader.mjs'),check=helper.inspectText(manifest,family,weight,text);
  if(check.missing.length||check.unreviewedCombining.length)throw new Error('F8_TEXT_UNSUPPORTED: '+JSON.stringify(check));
  try{const face=await new FontFace(family,`url("${assetBase+file}")`,{weight:String(weight),style:'normal'}).load();document.fonts.add(face);
    const ready=await helper.requireFont(manifest,family,weight,text);return {...ready,family,weight,file,sourceURL:assetBase+file};
  }catch(error){throw new Error(`F8_FONT_LOAD_FAILED ${assetBase+file} ${family}:${weight}: ${error.message}`);}
}
