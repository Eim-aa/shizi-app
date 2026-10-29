// Pure protocol adapters: reference behavior is always the real JS submission function.
import * as answer from '../../../src/session/ops/answer.js';
import * as judge from '../../../src/session/ops/judge.js';
import * as skip from '../../../src/session/ops/skip.js';
import * as strokes from '../../../src/session/ops/strokes.js';
import * as end from '../../../src/session/ops/end.js';
import { commitFirstTipSeen } from '../../../src/session/ops/first-tip.js';
import { createAppApi, domainsOf } from '../../../src/session/api/index.js';
import { createWriteSessionApi } from '../../../src/session/write-api.js';
import * as result from '../../../src/session/ops/result.js';
import * as work from '../../../src/session/ops/work.js';
import { commitCorrection } from '../../../src/session/ops/line.js';
import * as hints from '../../../src/session/ops/hint.js';
import { setDeckSource } from '../../../src/data/deck.js';
import { deckSources } from '../../build_core_config.mjs';
let sources;
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
  return out;
}
