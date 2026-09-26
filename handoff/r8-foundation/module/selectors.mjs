/** Read-only adapters. No app globals, storage, backup conversion, or inferred history. */
const copy = value => structuredClone(value);
const identity = value => typeof value==='string'&&value.trim().length>0;
const validDay = value => typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const keyFor = (card, index) => (card.custom ? `custom:${index}:` : 'base:') + card.target;
export function sessionSelection(roundStats, cards) {
  // Candidate renderPracticeCardCanvas uses roundStats order; do not reorder or filter outcomes.
  return roundStats.map(row => ({key:keyFor(cards[row.idx],row.idx),char:cards[row.idx].target}));
}
export function monthSelection({month,activity,reviews,cards}) {
  const prefix=month+'-', days=activity.practiceDays.filter(day=>day.startsWith(prefix)).sort();
  const keys=[],independent=[];const add=(a,k)=>{if(typeof k==='string'&&!a.includes(k))a.push(k);};
  for(const day of days){const row=activity.daily[day]||{};
    for(const k of row.targetKeys||[])add(keys,k);for(const k of row.independentTargetKeys||[])add(independent,k);}
  for(const event of reviews)if(event?.rating==='Good'&&String(event.localDay||'').startsWith(prefix))add(independent,event.cardKey);
  for(const k of independent)add(keys,k);
  return {items:keys.flatMap(key=>{const index=cards.findIndex((c,i)=>keyFor(c,i)===key);return index<0?[]:[{key,char:cards[index].target}];}),days:copy(days),keyCount:keys.length};
}
function inScope(row,scope){return scope.kind==='session'?row.sessionId===scope.sessionId:row.localDay?.startsWith(scope.month+'-');}
function usableInk(row){
  const ink=row.ink;
  if(!identity(row.id)||!ink||!identity(ink.attemptId)||ink.attemptId!==row.id)return {reason:'missing-or-unlinked-ink'};
  if(ink.coordinateSpace!=='normalized-0-1'||!Array.isArray(ink.strokes)||!ink.strokes.length)return {reason:'unsupported-or-empty-ink'};
  if(!ink.strokes.every(s=>Array.isArray(s)&&s.length&&s.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(p.w===undefined||Number.isFinite(p.w)&&p.w>0&&p.w<=1.7))))return {reason:'invalid-ink'};
  return {ink:copy(ink)};
}
export function resolveGlyphs({selection,scope,judgments=[],coverage='unknown'}){
  if(!scope||!['session','month'].includes(scope.kind))throw new Error('INVALID_SCOPE');
  if(scope.kind==='session'&&!identity(scope.sessionId))throw new Error('SESSION_ID_REQUIRED');
  if(scope.kind==='month'&&(typeof scope.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.month)))throw new Error('INVALID_MONTH');
  if(!Array.isArray(selection)||!Array.isArray(judgments))throw new Error('INVALID_COLLECTION');
  // Coverage is explicit caller attestation, not inferred from the newest available cache.
  return selection.map(item=>{
    const base={...item,source:'reference',reason:'history-not-proven-complete',judgmentDate:null,attemptId:null};
    if(coverage!=='complete')return base;
    const rows=judgments.filter(r=>r&&r.char===item.char&&inScope(r,scope)&&r.explicit===true&&['correct','wrong'].includes(r.judgment));
    if(!rows.length)return {...base,reason:'no-judgment-in-scope'};
    if(rows.some(r=>!identity(r.id)||!identity(r.sessionId)))return {...base,reason:'missing-judgment-identity'};
    if(rows.some(r=>!Number.isFinite(r.at)||r.at<0||!Number.isSafeInteger(r.sequence)||r.sequence<0||!validDay(r.localDay)))return {...base,reason:'invalid-ordering'};
    rows.sort((a,b)=>b.at-a.at||b.sequence-a.sequence);
    if(rows.length>1&&rows[0].at===rows[1].at&&rows[0].sequence===rows[1].sequence)return {...base,reason:'ambiguous-last-judgment'};
    const last=rows[0],result=usableInk(last),resolved={...base,judgmentDate:last.localDay,attemptId:last.id,judgment:last.judgment};
    return result.ink?{...resolved,source:'handwriting',reason:null,ink:result.ink}:{...resolved,reason:result.reason};
  });
}
