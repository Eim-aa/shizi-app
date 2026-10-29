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
    const a={slot,cardKey:queue[0],inkKey:queue[0],strokes};
    out.push({op:'session.strokes',args:a},{op:'session.strokes',args:a});
    out.push({op:'session.phase',args:{...a,phase:'compare'}});
    out.push({op:'session.recover',args:{slot}});
    const action=g.pick(['judge','skip','answerSeen']);
    out.push({op:'store.fault',args:{failNextWrite:true}});
    const args={...a,judgment:g.pick(['correct','wrong']),hints:g.int(0,4)};
    out.push({op:'session.'+action,args},{op:'session.'+action,args});
    if(action==='skip') {
      out.push({op:'session.undoSkip',args:{slot,sessionId:s.id,recordId:`r${serial}`,strokes:[]}});
    } else if(action==='answerSeen') {
      out.push({op:'session.answerPhase',args:{...a,phase:'retrace'}},{op:'session.answerNext',args:a});
    }
    out.push({op:'session.judge',args:{slot,cardKey:'base:口',strokes,judgment:'correct'}});
    out.push({op:'session.end',args:{slot,sessionId:s.id}});
    out.push({op:'session.judge',args},{op:'session.judge',args:{...args,strokes:[]}});
    out.push({op:'session.firstTip',args:{}},{op:'session.firstTip',args:{}},{op:'session.answerNote',args:{}});
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
