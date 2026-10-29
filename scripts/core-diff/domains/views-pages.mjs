import { encodeInkRaw } from '../../../src/core/ink-math.js';
import { schedShapes } from '../lib/sched-shapes.mjs';
export function pageCases(g) {
  const S = schedShapes(g.r), h = S.state({days: g.pick([0,2,8,30])});
  const state = g.chance(.2) ? {} : h.state;
  state.settings = {...state.settings, library:g.pick(['core3500','adv3000','rare','curriculum2500'])};
  for(const r of h.records) if(g.chance(.12)) r.source='paper';
  if(g.chance(.4)) state.legacy={days:['2025-01-01','2026-03-01','2099-01-01']};
  if(g.chance(.4)) state.backupMeta={lastExportAt:g.pick([0,1767225600000,1772400000000]),lastExportSig:g.pick([null,'x'])};
  state.ink = {};
  for (const r of h.records) if(g.chance(.5)) {
    const m=r.localDay.slice(0,7);
    (state.ink[m] ||= {})[r.id]=encodeInkRaw([[{x:100,y:100,t:0,p:.5},{x:150,y:160,t:20,p:.7}]]);
  }
  state.custom = {added:[{char:'永',at:1772400000000},{char:'𠀀',at:1772400000000}]};
  const text = g.pick(['', '永', '永甲', '𠀀', '永𠀀', 'yong', 'xyz', '永永a甲', 'ren']);
  if(g.chance(.5)) state.records = {...state.records, '2025-02':{v:1,folded:true,kept:[],chars:['永','甲'],byDay:{'2025-02-01':['永','甲']},work:{'2025-02-01':['永','甲']},workJudged:{'2025-02-01':['永']}}};
  const annual = {state,today:g.pick([h.today,'2025-01-01','2027-03-01']),year:g.pick([2025,2026,2027]),policy:{monthSheetPick:g.pick(['first','last']),imageMaxChars:g.pick([1,3,80])}};
  const a = {state, mode:g.pick(['lookup','pick']), text, cur:g.pick(['','永','𠀀']), selected:g.pick([[],['永'],['甲','永']])};
  const latest = h.records.find(r => r.kind === 'judged');
  const summary = latest ? {latest, count:2, latestDay:latest.localDay} : null;
  const detailChar=g.pick(['永','𠀀',h.records[0]?.char||'甲']);
  if(g.chance(.5)) state.wordOff={['base:'+detailChar]:true};
  if(g.chance(.5)) state.photos={[detailChar]:g.pick([{dataURL:'data:image/png;base64,AA',label:'x'},{dataURL:'bad'}])};
  const detailArgs={state,char:detailChar,today:h.today,record:h.records.find(r=>r.char===detailChar)||{},day:g.pick([null,h.today,'bad']),imageAction:g.chance(.5),etymology:g.pick([null,{gloss:'x',source:''}]),policy:g.pick([{}, {features:{nextReviewLine:true,perRecordInk:true}}])};
  const list={state,today:h.today,kind:g.pick(['wrong','forget','due','shaky','known','skipped','forgetList','againList']),sel:g.pick([null,[],['永','甲']]),unpracticable:g.chance(.5)?S.keys().slice(0,30):[],policy:{groupSize:g.pick([5,10,20,30])}};
  return [

    ...['view.mine-model','view.records-model','view.mine-model.helpers'].map(op=>[op,{state,today:g.pick([h.today,'2026-03-02','2025-02-01']),month:g.pick([h.today.slice(0,7),'2025-02','2026-03']),day:g.pick([h.today,'2025-02-01','2026-03-02']),wantedMonth:g.pick([null,'bad','1900-01','2099-01']),storagePressure:g.pick([null,true,.79,.8,'warn',{near:true},{level:'low'},{ratio:.9}]),cols:g.pick([4,5,7]),rows:g.pick([1,2,3]),days:['2026-03-01','2026-03-02'],added:h.records.slice(0,3).map(r=>r.id)}]),

    ...['view.mine','view.mine.sheet','view.mine.cells','view.mine.helpers'].map(op=>[op,{state,today:g.pick([h.today,'2025-02-01']),month:g.pick([h.today.slice(0,7),'2025-02']),width:g.pick([320,375,402,440,900]),ax:g.int(0,5),build:{version:'1.2',build:'20261001-a'},storagePressure:g.pick([null,true,.8,{ratio:.7},{level:'warn'}]),cell:{ch:'永',mode:g.pick(['hand','under']),day:h.today,record:{localDay:'2026-03-01'}},cells:Array.from({length:g.int(0,90)},(_,i)=>({ch:'永',day:i%2?'2026-03-01':'2026-03-02'})),max:g.pick([1,3,80]),n:g.pick([0,1,3,5,9,25,80,120])}]),

    ...['view.records','view.month','view.month.sheet','view.annual-page','view.mine-sub.helpers'].map(op=>[op,{state,today:g.pick([h.today,'2025-02-01','2026-03-02']),month:g.pick(['2025-02',h.today.slice(0,7),'2026-03','2027-01']),day:g.pick(['2025-02-01',h.today,'2026-03-02']),year:g.pick([2025,2026,2027]),n:g.pick([0,1,3,5,9,25,80,120]),width:g.pick([200,320,402,440,900]),cell:{ch:'永',mode:g.pick(['hand','under']),day:g.pick(['','2026-03-02']),record:g.pick([null,{localDay:'2026-03-01'}])},policy:{monthSheetPick:g.pick(['first','last'])}}]),

    ...['view.detail','view.detail.model','view.detail-photo','view.detail.helpers'].map(op=>[op,{...detailArgs}]),

    ...['view.library-all','view.library-all.helpers'].map(op=>[op,{state,today:h.today,sort:g.pick(['recent','py','age','bad']),filter:g.pick(['','due','shaky','known','unw','custom','wrong','forget']),compact:g.chance(.5),width:g.pick([null,320,375,402,440,900]),find:g.pick(['','永','a','ren','xyz','𠀀','123']),fold:{'2026-03':g.chance(.5),'bad':true,'2026-05':g.chance(.5)},month:g.pick(['2025-03','2026-05']),open:g.chance(.5),py:g.pick(['','yǒng','Lǜ']),groups:[{head:true,cells:[1,2,3]},{head:false,cells:[]},{head:true,cells:[4,5]}],limit:g.pick([0,1,3,9]),pinyin:g.chance(.5)?{'永':''}: {}}]),

    ...['view.home','view.home.model','view.home.resume','view.home.helpers'].map(op=>[op,{state,now:new Date(2026,2,g.pick([1,2,15]),4).getTime()+g.pick([-1,0,1,3600000]),today:h.today,...g.pick([{}, {deck:'real'}, {deck:{newCandidates:[],warmupCandidates:[]}}]),ui:{brand:g.chance(.5),leaveUndo:g.chance(.5)?{char:'永',slot:'B'}:null},model:{resume:g.pick(['none','A','B','A+B']),view:g.pick(['first','special','today','back','fresh','progress']),records:g.pick(['first','empty','record']),capital:g.pick([null,'capital1']),gapDays:g.pick([null,0,7,30]),libraryCount:g.int(0,100),primary:{kind:'picked',done:2,total:5}},kind:g.pick(['first','picked','daily']),line:g.pick([null,{kind:'daily',remaining:0,done:2,total:3,position:3},{kind:'first',remaining:3,done:1,total:5}])}]),

    ['view.library-list',list], ['view.library-list.entries',list],
    ['view.library-list.helpers',{...list,n:g.int(0,3),meta:'a · b · c',day:g.pick([null,h.today,'bad']),word:g.pick(['永远','永','a永b','a']),char:'永',other:g.pick([null,[],['甲','永']]),view:g.pick(['wrongList','dueList','home'])}],
    ...['view.annual','view.annual.plan','view.annual.years','view.annual.defaultYear','view.annual.slice','view.annual.first','view.annual.twice','view.annual.months'].map(op=>[op,annual]),
    ['view.query', a], ['view.query.sheet', a],
    ['view.query.meta',{pinyin:g.pick(['','yǒng']),strokes:g.pick([0,5,-1])}],
    ['view.query.stat',{summary}], ['view.query.date',{day:g.pick([null,'2026-03-01'])}],
    ['view.query.ink',{state,summary}],
  ].map(([op,args])=>({op,args,state:false}));
}
export const pageNames = ['view.mine-model','view.records-model','view.mine-model.helpers','view.mine','view.mine.sheet','view.mine.cells','view.mine.helpers','view.records','view.month','view.month.sheet','view.annual-page','view.mine-sub.helpers','view.detail','view.detail.model','view.detail-photo','view.detail.helpers','view.library-all','view.library-all.helpers','view.home','view.home.model','view.home.resume','view.home.helpers','view.library-list','view.library-list.entries','view.library-list.helpers','view.annual','view.annual.plan','view.annual.years','view.annual.defaultYear','view.annual.slice','view.annual.first','view.annual.twice','view.annual.months','view.query','view.query.sheet','view.query.meta','view.query.stat','view.query.date','view.query.ink'];
