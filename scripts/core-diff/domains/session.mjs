import { createSession } from '../../../src/core/sessions.js';
import { DOMAINS } from '../../../src/core/schema.js';
const T=1790906400000;
export function sessionCases(g, steps=300) {
  const out=[{op:'store.open',args:{backend:g.pick(['local','native']),clock:T}}];
  let serial=1;
  const strokes=[[{x:42,y:50,t:0,p:0.5},{x:90,y:130,t:17,p:0.8}]];
  while(out.length<steps) {
    const slot=g.pick(['A','B']), kind=slot==='B'?'picked':g.pick(['first','daily']);
    const queue=['base:人','base:口','base:水'];
    const s=createSession({id:`s${serial++}`,kind,source:{view:'home'},queue,at:T});
    const state=Object.fromEntries(DOMAINS.map(d=>[d,['records','ink'].includes(d)?{}:null]));
    state.sessions={A:null,B:null,lastEnded:{},[slot]:s};
    out.push({op:'store.seed',args:{state}});
    const view={key:'x',used:1,range:{from:0,to:4},absorbed:[{user:0,hint:0}],fading:[{hint:0}],show:'in',run:1,restored:false};
    out.push({op:'session.hintInitial',args:{key:'x',stored:{hints:2,hintRange:{from:0,to:4}},written:g.int(0,6)}},
      {op:'session.hintReduce',args:{view,action:g.pick([{type:'hint',range:{from:4,to:6},written:5},{type:'restore',fromUser:0},{type:'faded',hint:0},{type:'absorb',user:1,hint:1},{type:'sync-used',used:3}])}},
      {op:'session.hintRemaining',args:{view}},
      {op:'session.hintMatch',args:{remaining:[1,2],index:0,points:[{x:1,y:1,t:0}],medians:[[[0,0]],[[0,0],[10,10]],[[100,100]]]}},
      {op:'session.hintTimeline',args:{count:g.int(0,20)}});

    const a={slot,cardKey:queue[0],inkKey:queue[0],strokes};
    out.push({op:'session.strokes',args:a},{op:'session.strokes',args:a});
    out.push({op:'session.phase',args:{...a,phase:'compare'}});
    out.push({op:'session.recover',args:{slot}});
    const action=g.pick(['judge','skip','answerSeen']);
    out.push({op:'store.fault',args:{failNextWrite:{n:1,kind:'generic'}}});
    const args={...a,judgment:g.pick(['correct','wrong']),hints:g.int(0,4)};
    out.push({op:'session.'+action,args},{op:'session.'+action,args});
    if(action==='skip') {
      out.push({op:'session.undoSkip',args:{slot,sessionId:s.id,recordId:`r${serial}`,strokes:[]}});
    } else if(action==='answerSeen') {
      out.push({op:'session.answerPhase',args:{...a,phase:'retrace'}},{op:'session.answerNext',args:a});
    }
    out.push({op:'session.judge',args:{slot,cardKey:'base:口',strokes,judgment:'correct'}});
    out.push({op:'write.correct',args:{slot,recordId:`r${serial+1}`,to:'wrong'}});
    out.push({op:'session.judge',args:{slot,cardKey:'base:水',strokes,judgment:'wrong'}});
    out.push({op:'session.end',args:{slot,sessionId:s.id}});
    out.push({op:'write.result',args:{slot,sessionId:s.id}});
    out.push({op:'write.resultSealed',args:{slot,sessionId:s.id}},{op:'write.resultSealed',args:{slot,sessionId:s.id}});
    out.push({op:'write.resultCell',args:{slot,sessionId:s.id,recordId:`r${serial}`}});
    out.push({op:'write.resultCorrect',args:{slot,sessionId:s.id,recordId:`r${serial}`,to:'correct'}});
    out.push({op:'write.resultAdd',args:{slot,sessionId:s.id,recordId:`r${serial}`,on:true}});
    out.push({op:'write.resultUndoSkip',args:{slot,sessionId:s.id,recordId:`r${serial}`}});
    out.push({op:'write.resultInvite',args:{sessionId:s.id,action:g.pick(['shown','no'])}});
    out.push({op:'session.leave',args:{slot,sessionId:s.id}});
    for(const [op,args] of [
      ['detail.addCustom',{char:'人'}],['detail.wordOff',{char:'人'}],['detail.wordOn',{char:'人'}],['detail.removeCustom',{char:'人'}],['detail.restoreCustom',{removed:{entry:{char:'人',at:T},index:0}}],['detail.correct',{recordId:`r${serial}`,to:'correct'}],
      ['mine.appearance',{value:g.pick(['auto','dark','light','bad'])}],['mine.groupSize',{value:g.pick([5,10,20,30,9])}],['remind.enabled',{on:true}],['remind.time',{hour:g.int(0,23),minute:g.int(0,59)}],['reminder.status',{permission:g.pick(['granted','denied','unknown'])}],['reminder.plan',{}],['view.remind',{}],
      ['query.add',{char:'水'}],['query.add',{char:''}],['view.query',{text:'人'}],['view.home',{}],['view.library',{}],['view.library-list',{kind:'wrong'}],['view.library-all',{}],['view.library-switch',{}],['view.mine',{}],['view.records',{}],['view.month',{}],['view.annual',{}],['view.about',{}],['view.about-credits',{}],['view.s02',{chars:['人','水']}],['backup.export',{}],['backup.restorePreview',{text:'bad'}],['backup.picked',{text:'bad'}],['backup.clear',{}],['backup.undoClear',{}],['backup.undoState',{}],['view.backup',{}],['block.exportable',{}],['block.retry',{kind:'blocked'}],['view.block',{}],
    ]) {
      if(!op.startsWith("view.") && g.chance(.3)) out.push({op:"store.fault",args:{failNextWrite:{n:1,kind:"generic"}}});
      out.push({op:'api.call',args:{op,args}});
      if(!op.startsWith('view.')) out.push({op:'api.call',args:{op,args}});
    }
    out.push({op:'session.judge',args},{op:'session.judge',args:{...args,strokes:[]}});
    out.push({op:'session.firstTip',args:{}},{op:'session.firstTip',args:{}},{op:'session.answerNote',args:{}});
    out.push({op:'store.disk',args:{quota:1}},{op:'api.call',args:{op:'mine.appearance',args:{value:'dark'}}},{op:'store.disk',args:{quota:null}});
    out.push({op:'session.start',args:{kind:g.pick(['first','daily','picked']),keys:['base:人','base:口'],source:{view:'home'}}});
    out.push({op:'session.resume',args:{slot}},{op:'session.expire',args:{}});
    out.push({op:'clock.set',args:{t:1790971199999}},{op:'session.expire',args:{}},{op:'clock.advance',args:{ms:1}},{op:'session.expire',args:{}});
    out.push({op:'clock.advance',args:{ms:g.pick([-86400000,86400000,3600000,-3600000])}});
  }
  return out.slice(0,steps).flatMap(r=>{
    if(r.op==='store.seed') return [r,{op:'write.open',args:{slot:r.args.state.sessions.A?'A':'B'}},{op:'write.hint',args:{slot:r.args.state.sessions.A?'A':'B',cardKey:'base:人',totalStrokes:2,action:'give',written:0}}];
    if(r.op.startsWith('session.') && ['strokes','phase','judge','skip','undoSkip','answerNext','answerPhase','firstTip'].includes(r.op.slice(8)) && g.chance(.5)) {
      return [{...r,op:'write.'+r.op.slice(8),args:{...r.args,strokes:r.args.strokes?.map(s=>s.map(p=>[p.x,p.y,p.t,...(p.p?[p.p]:[])]))}}];
    }
    return [r];
  }).slice(0,steps);
}
export default {id:'session',sequence:sessionCases,ops:{'session.recover':{weight:1,args:()=>({slot:'A'})}}};
