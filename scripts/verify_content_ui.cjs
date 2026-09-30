const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadCorpus}=require('./content-corpus.cjs');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures',file),'utf8'));

async function verifyContentUI(browser,{appUrl,outputDir}={}){
  appUrl=appUrl||process.env.SHIZI_APP_URL||'http://127.0.0.1:8000/';
  outputDir=outputDir||process.env.SHIZI_CONTENT_OUTPUT_DIR;
  if(outputDir)fs.mkdirSync(outputDir,{recursive:true});
  const current=loadCorpus(root),baseline=read('content-quality-baseline.json');
  const repeated=current.cards.filter(c=>baseline.originalRepeatedTargets.includes(c.target));
  const currentRepeated=current.cards.filter(c=>c.chars.filter(ch=>ch===c.target).length>1);
  const approvals=read('content-quality-approved.json').entries;
  const byKey=new Map(current.cards.map(card=>[card.cardKey,card]));
  const indexes=[...new Set([...repeated.map(c=>c.index),...currentRepeated.map(c=>c.index),...approvals.map(entry=>{
    assert(byKey.has(entry.cardKey),`Approved target absent from governed corpus: ${entry.target}`);
    return byKey.get(entry.cardKey).index;
  })])];
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],records=[];
  page.on('pageerror',error=>errors.push(error.message));
  const setCard=async(index,{disableWriter=false,large=false}={})=>{
    await page.evaluate(({index,disableWriter,large})=>{
      clearSessionSnapshot();clearTimeout(autoNextTimer);clearTimeout(editStampTimer);
      activeMode='new';baseTargets=[index];batch=baseTargets;baseCursor=0;pos=0;currentIndex=index;
      currentAttemptKind='base';currentAttemptId=`verify-content-${index}`;episodes={};roundStats=[];unresolved=new Set();manualQueue=[];
      practicePhase='recall';roundOpeningPending=false;pendingSessionVisual=null;actionCooldownUntil=0;fontScaleLarge=large;applyFontScale();
      const key=cardKey(index);memory[key]={seen:3,last:Date.now()-86400000,target:CARDS[index].target};window.__contentMemory=memory[key];
      const originalWriter=window.HanziWriter;if(disableWriter)window.HanziWriter=undefined;
      try{render();}finally{window.HanziWriter=originalWriter;}
    },{index,disableWriter,large});
    if(!disableWriter)await page.waitForFunction(index=>currentIndex===index&&practiceCharData&&totalStrokes>0&&!document.getElementById('done').disabled,index);
    await page.evaluate(async()=>{await Promise.all(document.getElementById('practiceArea').getAnimations().map(animation=>animation.finished));});
  };
  const inspect=()=>page.evaluate(()=>{
    const prompt=document.getElementById('prompt'),hint=document.getElementById('hint');
    const attributes=[prompt,...prompt.querySelectorAll('*')].flatMap(node=>Array.from(node.attributes).filter(a=>a.name.startsWith('aria-')||a.name==='title'||a.name.startsWith('data-')).map(a=>a.value));
    return {index:currentIndex,target:cur.target,word:cur.word,py:cur.py,ci:cur.ci,chars:cur.chars,common:cur.common,key:cardKey(currentIndex),cells:Array.from(prompt.children).map(node=>({text:node.textContent,repeat:node.classList.contains('repeatBlank'),role:node.getAttribute('role'),label:node.getAttribute('aria-label')})),prompt:prompt.textContent,hint:hint.textContent,hintVisible:hint.getBoundingClientRect().height>0,describedBy:prompt.getAttribute('aria-describedby'),hintLive:hint.getAttribute('aria-live'),attributes,memoryPreserved:cardMemory(currentIndex)===window.__contentMemory,unexpectedHintElements:hint.children.length};
  });
  const verifyMask=(row)=>{
    assert.equal(row.cells.length,row.chars.length,'Prompt cells must use code points');
    assert.deepEqual(row.cells.map(c=>c.text),row.chars.map((ch,i)=>i===row.ci?(row.py||'？'):ch===row.target?'□':ch));
    assert.equal(row.cells.filter(c=>c.repeat).length,row.chars.filter(ch=>ch===row.target).length-1);
    assert(row.cells.filter(c=>c.repeat).every(c=>c.role==='img'&&c.label),'Repeated blanks require accessible names');
    assert(!row.prompt.includes(row.target));assert(row.attributes.every(value=>!value.includes(row.target)),'Do not expose the answer in prompt accessibility/title/data attributes');
    assert.equal(row.describedBy,'hint');assert.equal(row.hintLive,'polite');assert(row.memoryPreserved);assert.equal(row.unexpectedHintElements,0);
  };
  const screenshot=async name=>{if(outputDir)await page.screenshot({path:path.join(outputDir,name),fullPage:true});};
  try{
    await page.goto(appUrl,{waitUntil:'networkidle'});
    for(const index of indexes){
      const expected=current.cards[index];await setCard(index);const row=await inspect();verifyMask(row);
      assert.equal(row.hint,expected.visibleHint);assert(!row.hint.includes(row.target));assert.equal(row.key,expected.cardKey);assert.equal(row.common,expected.common);assert(row.hintVisible||!row.hint);
      if(['祼','耿','嗖','漉','姥'].includes(row.target))await screenshot(`prompt-${row.target}.png`);
      await page.click('#done');await page.waitForFunction(()=>getComputedStyle(document.getElementById('reveal')).display!=='none');
      const revealed=await page.evaluate(()=>({word:document.getElementById('revealWord').textContent,target:document.getElementById('rightGlyph').textContent,py:document.getElementById('revealPy').textContent}));
      assert.deepEqual(revealed,{word:expected.word,target:expected.target,py:expected.py});records.push({index,target:row.target,word:row.word,prompt:row.prompt,visibleHint:row.hint,common:row.common,reveal:revealed});
    }
    const customIndex=await page.evaluate(()=>{
      const count=CARDS.length;pushWordCards('哈哈哈');
      if(CARDS.length!==count)throw new Error('Existing base characters must not become duplicate custom cards');
      const target=Array.from({length:0x9fff-0x4e00+1},(_,i)=>String.fromCodePoint(0x4e00+i)).find(ch=>BASE_BY_CHAR[ch]==null&&customIndexOf(ch)<0);
      const [start,end]=pushWordCards(target.repeat(3));
      if(end-start!==1)throw new Error('Repeated custom input must create one unique target card');
      return start;
    });
    await setCard(customIndex,{disableWriter:true});const custom=await inspect();verifyMask(custom);assert.equal(custom.ci,0);assert.equal(custom.cells.filter(c=>c.repeat).length,2);assert(custom.hint.endsWith('空格里是同一个字，只写一次。'));await screenshot('custom-three-repeats.png');
    const supplementaryIndex=await page.evaluate(()=>{const index=CARDS.length;CARDS.push({...CARDS[0],word:'𠮷甲𠮷𠮷',chars:Array.from('𠮷甲𠮷𠮷'),target:'𠮷',ci:2,py:'jí',ctx:'override',promptHint:'补充平面字符的合成显示测试。'});return index;});
    await setCard(supplementaryIndex,{disableWriter:true});const supplementary=await inspect();verifyMask(supplementary);assert.equal(supplementary.chars.length,4);assert.equal(supplementary.cells[2].text,'jí');await screenshot('supplementary-three-repeats.png');
    await page.evaluate(index=>{CARDS[index].promptHint='<img id="content-injection" src=x onerror="window.__contentInjected=true">';},supplementaryIndex);
    await setCard(supplementaryIndex,{disableWriter:true});const literal=await inspect();verifyMask(literal);assert(literal.hint.startsWith('<img '));assert.equal(await page.locator('#content-injection').count(),0);assert.equal(await page.evaluate(()=>window.__contentInjected),undefined);
    await page.setViewportSize({width:320,height:568});
    const longest=[...current.cards].filter(c=>c.visibleHint).sort((a,b)=>b.visibleHint.length-a.visibleHint.length)[0];
    await setCard(longest.index,{large:true});
    const inspectLayout=()=>page.evaluate(()=>{
      const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const hint=document.getElementById('hint');
      return {target:cur.target,hint:hint.textContent,hintLines:Math.round(hint.getBoundingClientRect().height/parseFloat(getComputedStyle(hint).lineHeight)),viewport:{width:innerWidth,height:innerHeight},large:document.documentElement.classList.contains('largeText'),bounds:Object.fromEntries(['prompt','hint','boxwrap','tip','undoStroke','clear','show','done','exitPractice'].map(id=>[id,bounds(id)])),scrollWidth:document.documentElement.scrollWidth};
    });
    const assertLayout=layout=>{
      assert(layout.large);assert(layout.scrollWidth<=layout.viewport.width,'No horizontal overflow on the narrow screen');
      for(const [name,b] of Object.entries(layout.bounds))assert(b.left>=-0.5&&b.top>=-0.5&&b.right<=320.5&&b.bottom<=568.5,`Required ${name} clipped on 320x568 with large text: ${JSON.stringify(layout)}`);
    };
    const layout=await inspectLayout();await screenshot('longest-hint-small-large-text.png');assertLayout(layout);
    await page.evaluate(index=>{CARDS[index].promptHint='这是一条用来核验窄屏显示的较长题意提示，包含含义说明和字形线索，所有文字都应清楚显示，书写区域和操作按钮仍需完整可见。';},supplementaryIndex);
    await setCard(supplementaryIndex,{disableWriter:true,large:true});const longLayout=await inspectLayout();
    await screenshot('four-line-hint-small-large-text.png');assert(longLayout.hintLines>=4,'Synthetic long promptHint must exercise at least four rendered lines');assertLayout(longLayout);assert.deepEqual(errors,[]);
    const result={status:'passed',originalRepeatedCards:repeated.length,currentRepeatedCards:currentRepeated.length,actualCardsRendered:indexes.length,approvedCards:approvals.length,customRepeatedCard:true,supplementaryCodePoint:true,promptHintTextContentSafe:true,narrowLargeText:layout,fourLineLargeText:longLayout,records,scope:'Actual render/reveal and accessibility/geometry checks for approved targets in the current governed corpus'};
    if(outputDir)fs.writeFileSync(path.join(outputDir,'ui-results.json'),JSON.stringify(result,null,2)+'\n');return result;
  }finally{await context.close();}
}

if(require.main===module)(async()=>{const {chromium}=require('playwright');const browser=await chromium.launch({headless:true,executablePath:[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium'].find(candidate=>candidate&&fs.existsSync(candidate))});try{const r=await verifyContentUI(browser);console.log(JSON.stringify({...r,records:undefined},null,2));}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={verifyContentUI};
