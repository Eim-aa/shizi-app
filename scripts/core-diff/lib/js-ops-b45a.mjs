// Pure protocol adapters: reference behavior is always the real JS submission function.
import * as start from '../../../src/core/session-start.js';
import { deckAdapter } from '../../../src/data/deck.js';
import * as answer from '../../../src/session/ops/answer.js';
import * as judge from '../../../src/session/ops/judge.js';
import * as skip from '../../../src/session/ops/skip.js';
import * as strokes from '../../../src/session/ops/strokes.js';
import * as end from '../../../src/session/ops/end.js';
import { commitFirstTipSeen } from '../../../src/session/ops/first-tip.js';
import { createAppApi, domainsOf } from '../../../src/session/api/index.js';
import { sheetStrokes, createWriteSessionApi } from '../../../src/session/write-api.js';
import * as result from '../../../src/session/ops/result.js';
import * as first from '../../../src/session/ops/first-result.js';
import * as work from '../../../src/session/ops/work.js';
import { commitCorrection } from '../../../src/session/ops/line.js';
import * as hints from '../../../src/session/ops/hint.js';
import { setDeckSource } from '../../../src/data/deck.js';
import { deckSources } from '../../build_core_config.mjs';
let sources, imageModule, registeredImages, pageModules, singleton;
export function makeB45SessionOps({session,clock}) {
  const table = {
    strokes: strokes.commitStrokes, recover: strokes.commitRecover, phase: judge.commitComparePhase,
    answerSeen: answer.commitAnswerSeen, answerPhase: answer.commitAnswerPhase, answerNext: answer.commitAnswerNext,
    judge: judge.commitJudgment, skip: skip.commitSkip, undoSkip: skip.commitUndoSkip, end: end.commitEndGroup,
    firstTip: commitFirstTipSeen, answerNote: answer.commitAnswerNoteSeen,
  };
  Object.assign(table,{correct:commitCorrection,resultCorrect:result.commitResultCorrection,finish:result.commitFinish,leave:result.commitLeave,added:work.commitAdded,sealed:work.commitSealed,resultUndoSkip:result.commitResultSkipUndo});
  table.hint=(store,a)=>hints.commitHint(store,a,a.label);
  table.hintStep=hints.commitHintStep;
  const out = Object.fromEntries(Object.entries(table).map(([name,fn])=>['session.'+name,a=>{
    const s=session();s.notices=[];return fn(s.store,a);
  }]));
  for(const name of ['open','strokes','phase','judge','showAnswer','answerPhase','answerNext','skip','undoSkip','end','firstTip','correct','hint','copy','refLabel','resultLook','redoOpen','redoNext','redoExit','exit','result','resultCell','resultCorrect','resultAdd','resultSealed','resultUndoSkip','resultAgain','resultExit','resultInvite']) out['write.'+name]=a=>{
    setDeckSource(sources ||= deckSources());const s=session();s.notices=[];
    const api=createWriteSessionApi({getStore:()=>s.store});
    const normalize=({ms,...reply})=>reply;
    const saved=Date.now;Date.now=clock;let value;try{value=api.call(name,a);}finally{Date.now=saved;}return value?.then?value.then(normalize):normalize(value);
  };
  out['api.call']=a=>{const s=session();s.notices=[];const app=createAppApi({getStore:()=>s.store,now:clock});const saved=Date.now;Date.now=clock;try{return app.call(a.op,a.args);}finally{Date.now=saved;}};
  out['api.domainsOf']=a=>domainsOf(a.info);
  out['session.hintInitial']=a=>hints.initialHintView(a.key,a.stored,a.written);
  out['session.hintReduce']=a=>hints.reduceHintView(a.view,a.action);
  out['session.hintRemaining']=a=>({remaining:hints.hintRemaining(a.view),visible:hints.hintVisible(a.view)});
  out['session.hintMatch']=a=>hints.matchHintStroke(a);
  out['session.hintTimeline']=a=>hints.hintTimeline(a.count,a.motion);
  out['session.start']=a=>{const s=session();s.notices=[];setDeckSource(sources ||= deckSources());const fn=a.kind==='first'?start.startFirst:a.kind==='picked'?start.startPicked:start.startDaily;return fn(s.store,{...a,now:clock,deck:deckAdapter});};
  for(const [name,fn]of Object.entries({expire:start.expireStale,endStartPicked:start.endOldAndStartPicked,deferSpecial:start.deferSpecial}))out['session.'+name]=a=>{const s=session();s.notices=[];return fn(s.store,{...a,now:clock,deck:deckAdapter});};
  out['session.resume']=a=>{const s=session();s.notices=[];return start.resumeSlot(s.store,a.slot,{now:clock});};
  for(const name of ['session.hintInitial','session.hintReduce','session.hintRemaining','session.hintMatch','session.hintTimeline']){const fn=out[name];out[name]=a=>{try{session().notices=[];}catch{}return fn(a);};}
  out['session.environment']=async a=>{
    const ety=await import('../../../src/data/etymology.js'),detail=await import('../../../src/session/api/detail.js'),q=await import('../../../src/session/api/query.js'),lines=await import('../../../src/core/line-starts.js');
    const oldFetch=globalThis.fetch,oldDetail={...detail.detailHooks()},savedNow=Date.now;Date.now=clock;let loads=0;ety.setEtymology(null);
    globalThis.fetch=async()=>{const value=a.loads?.[loads++];if(value==='throw')throw Error('fetch');return {ok:true,json:async()=>value};};
    detail.setDetailHooks({image:a.image?()=>{}:null});
    q.setQueryLayout(a.layout===undefined?null:Object.fromEntries(['s02Body','cardAction'].map(k=>[k,()=>{if(a.layoutThrows)throw Error('host-layout');return a.layout;}])));
    lines.setLineBreaker(a.breaker===undefined?null:()=>{if(a.breakerThrows)throw Error('host-breaker');return a.breaker;});
    const s=session();s.notices=[];const app=createAppApi({getStore:()=>s.store,now:clock,native:a.native,build:a.build===undefined?undefined:()=>{if(a.buildThrows)throw Error('host-build');return a.build;}}),replies=[];
    try{for(const r of a.requests||[])replies.push(await app.call(r.op,r.args||{}));return {replies,loads};}
    finally{Date.now=savedNow;ety.setEtymology(null);globalThis.fetch=oldFetch;detail.setDetailHooks(oldDetail);q.setQueryLayout(null);lines.setLineBreaker(null);}
  };
  out['session.queryHost']=async a=>{
    const q=await import('../../../src/session/api/query.js'),oldQ=q.queryActionsRef(),oldS=q.s02ActionsRef(),callbacks=a.callbacks||{},calls=[];
    function fn(name,context=false){const c=callbacks[name];if(!c)return undefined;const run=(input,ctx)=>{calls.push({name,args:context?(name==='detail'?input:{input,mode:ctx.mode}):input??null});if(c.close){ctx.close();ctx.close();}if(c.throws)throw Error('host-'+name);return c.reply??null;};return c.async?async(...args)=>{await Promise.resolve();return run(...args);}:run;}
    q.setQueryActions({mode:a.mode||'lookup',onPractice:fn('practice',true),onPick:fn('pick',true),onDetail:fn('detail',true),close:fn('close')});
    q.setS02Actions(a.registered||['continue','cancel','close','endStart','started'].some(n=>callbacks[n])?{onContinue:fn('continue'),onCancel:fn('cancel'),close:fn('close'),onEndStart:fn('endStart'),onStarted:fn('started')}:null);
    const s=session();s.notices=[];try{return {reply:await createAppApi({getStore:()=>s.store,now:clock}).call(a.op,a.args||{}),calls};}finally{q.setQueryActions(oldQ);q.setS02Actions(oldS);}
  };
  out['session.pageRegistered']=async a=>{
    setDeckSource(sources ||= deckSources());const s=session();s.notices=[];
    const home=await import('../../../src/session/api/home.js'),lib=await import('../../../src/session/api/library.js'),sub=await import('../../../src/session/api/library-sub.js');
    const previous=[home.homeActions(),lib.libraryActions(),sub.librarySubActions()];
    if(!pageModules){await import('../../../src/ui/screens/home/index.js');await import('../../../src/ui/screens/library/index.js');pageModules=[home.homeActions(),lib.libraryActions(),sub.librarySubActions()];}
    home.setHomeActions(pageModules[0]);lib.setLibraryActions(pageModules[1]);sub.setLibrarySubActions(pageModules[2]);
    const {bootStore}=await import('../../../src/store/store.js');singleton ||= bootStore({backend:{getItem:()=>null,setItem(){},removeItem(){},length:0,key:()=>null}}).store;
    Object.defineProperties(singleton,Object.getOwnPropertyDescriptors(s.store));
    const {nav}=await import('../../../src/ui/router.js'),oldNav={...nav};for(const key of Object.keys(nav))nav[key]=()=>key==='openOverlay'?'overlay':null;
    const skip=await import('../../../src/ui/screens/write/skip.js'),oldPerformance=globalThis.performance,saved=Date.now;globalThis.performance={now:clock};Date.now=clock;skip.handoffLeaveUndo(a.undo);
    try{return {reply:await createAppApi({getStore:()=>s.store,now:clock}).call(a.op,a.args||{}),undo:skip.leaveUndoView()};}
    finally{skip.clearLeaveUndo();Date.now=saved;globalThis.performance=oldPerformance;Object.assign(nav,oldNav);home.setHomeActions(previous[0]);lib.setLibraryActions(previous[1]);sub.setLibrarySubActions(previous[2]||{});}
  };
  out['session.imageRegistered']=async a=>{
    const {setImageActions,imageActions}=await import('../../../src/session/api/image.js');
    const previous=imageActions();
    if(!imageModule){imageModule=await import('../../../src/ui/images-entry.js');registeredImages=imageActions();}
    setImageActions(registeredImages);
    const {resetPaletteCache,PALETTE_VARS}=await import('../../../src/core/images/palette.js');resetPaletteCache();
    const oldDoc=globalThis.document,oldStyle=globalThis.getComputedStyle,oldWin=globalThis.window;
    if(a.palette){globalThis.document={documentElement:{appendChild(){}},createElement:()=>({setAttribute(){},remove(){}})};globalThis.getComputedStyle=()=>({getPropertyValue:css=>{const key=Object.keys(PALETTE_VARS).find(k=>PALETTE_VARS[k]===css);return a.palette[key]||'';}});}
    globalThis.window=a.save?{URL:{createObjectURL:()=>'',revokeObjectURL(){}},setTimeout:()=>0,document:{body:{appendChild(){}},createElement:()=>({style:{},click(){},remove(){}})}}:null;
    const s=session();s.notices=[];const saved=Date.now;Date.now=clock;
    try{return await createAppApi({getStore:()=>s.store,now:clock}).call('image.'+a.op,a.args||{});}
    finally{Date.now=saved;globalThis.document=oldDoc;globalThis.getComputedStyle=oldStyle;globalThis.window=oldWin;resetPaletteCache();setImageActions(previous);}
  };
  out['session.hintHelper']=a=>{
    const i=a.input||{},old=globalThis.GROUPS;globalThis.GROUPS=i.table;
    try{switch(a.name){
      case 'groupsFor':return hints.groupsFor(i.char,i.table);
      case 'hasGroupData':return hints.hasGroupData(i.groups,i.totalStrokes);
      case 'mergeHintRange':return hints.mergeHintRange(i.prev,i.next);
      case 'strokeRangeText':return hints.strokeRangeText(i.from,i.to);
      case 'hintAnnouncement':return hints.hintAnnouncement(i.range);
      case 'strokeDrawMs':return hints.strokeDrawMs(i.count,i.motion);
      case 'meanDistanceToMedian':return hints.meanDistanceToMedian(i.points,i.median);
      case 'hintRemaining':case 'hintVisible':return hints[a.name](i.view);
      case 'initialHintView':return hints.initialHintView(i.key,i.stored,i.written);
      case 'reduceHintView':return hints.reduceHintView(i.view,i.action);
      case 'hintTimeline':return hints.hintTimeline(i.count,i.motion);
      default:return hints[a.name](i);
    }}finally{globalThis.GROUPS=old;}
  };
  out['session.rememberInk']=a=>{judge.rememberInk(a.recordId,a.strokes);return null;};
  out['session.recalledInk']=a=>judge.recalledInk(a.recordId,a.policy);
  out['session.forgetRecentInk']=()=>judge.forgetRecentInk();
  out['session.sheet']=a=>sheetStrokes(session().store,a.record);
  out['session.resultModel']=a=>result.resultModel(a.state || session().store.getState(),a);
  out['session.resultLeave']=a=>result.leaveOf(a.source);
  out['session.firstExtras']=a=>first.firstExtras(a);
  out['session.daysLaterOf']=a=>first.daysLaterOf(a);
  out['session.writeHost']=async a=>{
    setDeckSource(sources ||= deckSources());const s=session();s.notices=[];const calls=[];
    const result=Object.fromEntries(Object.entries(a.hooks||{}).map(([name,c])=>[name,(...params)=>{
      const arg=name==='view'?params[1]:params[0];
      calls.push({name,args:arg});if(c.throws)throw Error('host-'+name);return c.reply ?? null;
    }]));
    result.reminder={waitMs:a.waitMs??30};
    for(const name of ['invite','changeTime'])if(a.hooks?.[name])result.reminder[name]=async(store,args)=>{
      const c=a.hooks[name];if(c.settings)store.commit('host:reminder',d=>{d.settings=c.settings;});
      calls.push({name,args});if(c.throws)throw Error('host-'+name);
      if(c.laterPermission)setTimeout(()=>app.call('reminder.status',{permission:c.laterPermission}),5);
      return c.reply??null;
    };
    const app=createAppApi({getStore:()=>s.store,now:clock});
    const deps={getStore:()=>s.store,result};
    for(const name of ['colors','type','theme'])if(a.hooks?.[name])deps[name]=()=>{calls.push({name,args:[]});if(a.hooks[name].throws)throw Error('host-'+name);return a.hooks[name].reply??null;};
    if(a.hooks?.refLabel)deps.refLabel=a.hooks.refLabel.async ? async arg=>result.refLabel(arg) : result.refLabel;
    if(a.navigate)deps.navigate=Object.fromEntries(Object.entries(a.navigate).map(([name,c])=>[name,(...args)=>{calls.push({name:'navigate.'+name,args});if(c.throws)throw Error('host-navigate.'+name);return c.reply??null;}]));
    const api=createWriteSessionApi(deps);
    const saved=Date.now,oldGroups=globalThis.GROUPS;Date.now=clock;globalThis.GROUPS=a.groups;
    try{const {ms,...reply}=await api.call(a.op,a.args||{});return {reply,calls};}finally{Date.now=saved;globalThis.GROUPS=oldGroups;}
  };
  for(const name of ['session.hintHelper','session.rememberInk','session.recalledInk','session.forgetRecentInk','session.sheet','session.resultModel','session.resultLeave','session.firstExtras','session.daysLaterOf']){const fn=out[name];out[name]=a=>{try{session().notices=[];}catch{}return fn(a);};}
  return out;
}
