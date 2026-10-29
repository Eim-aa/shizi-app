import { sheetStrokes } from '../../../src/session/write-api.js';
import * as minePage from '../../../src/session/views/mine-page.js';
import * as mine from '../../../src/session/views/mine.js';
import * as mineSub from '../../../src/session/views/mine-sub.js';
import * as detail from '../../../src/session/views/detail.js';
import * as libraryAll from '../../../src/session/views/library-all.js';
import * as home from '../../../src/session/views/home.js';
import { deckAdapter } from '../../../src/data/deck.js';
import { ref } from '../../../src/config/copy/index.js';
// B4.5b: real view functions, no duplicated product rules.
import * as libraryList from '../../../src/session/views/library-list.js';
import { cardForKey } from '../../../src/data/deck.js';
import * as annual from '../../../src/session/views/annual.js';
import * as query from '../../../src/session/views/query.js';
import * as about from '../../../src/session/views/about.js';
import * as block from '../../../src/session/views/block.js';
import * as kuan from '../../../src/session/views/kuan.js';
import * as lines from '../../../src/session/views/lines.js';
import * as settings from '../../../src/session/views/settings.js';
import * as librarySwitch from '../../../src/session/views/library-switch.js';
import * as session from '../../../src/session/views/session.js';
import { setDeckSource } from '../../../src/data/deck.js';
import { deckSources } from '../../build_core_config.mjs';
import * as policy from '../../../src/config/policy.js';


export function makeB45ViewOps({ required, clock }) {
  const p = a => ({ ...policy, ...a.policy });
  const at = (a, fn) => { const saved = Date.now; Date.now = () => a.now ?? clock(); try { return fn(); } finally { Date.now = saved; } };
  const deck = a => {if(a.deck===undefined) return null; if(a.deck==='real') {setDeckSource(deckSources());return deckAdapter;} const d=a.deck; return {newCandidates:()=>d.newCandidates||[],warmupCandidates:d.warmupCandidates?()=>d.warmupCandidates:undefined,practicable:k=>d.practicable?d.practicable.includes(k):k.startsWith('base:'),currentLibraryId:d.currentLibraryId?()=>d.currentLibraryId:undefined};};
  const ink = a => r => a.state?.ink?.[r.localDay.slice(0, 7)]?.[r.id] ?? null;
  const q = a => { setDeckSource(deckSources()); return { ...a, policy: p(a), predicates: query.deckPredicates(a.state?.settings), getInk: ink(a), store: { getInk: ink(a) } }; };
  return {
    'view.home': a => home.homeView(a.state,a.now??clock(),{policy:p(a),deck:deck(a),ui:a.ui}),
    'view.home.model': a => home.homeModel(a.state,a.now??clock(),{policy:p(a),deck:deck(a)}),
    'view.home.resume': a => home.resumeOf(a.state,a.now??clock(),{policy:p(a)}),
    'view.home.helpers': a => ({records:home.recordsStateOf(a.state,a.today,{policy:p(a)}),last:home.lastJudgedDayOf(Object.values(a.state.records||{}).flatMap(v=>Array.isArray(v)?v:v.kept||[])),view:home.homeViewOf(a.model),count:home.libraryCountOf(Object.values(a.state.records||{}).flatMap(v=>Array.isArray(v)?v:v.kept||[])),cta:home.homeCtaKey(a.model),note:home.homeNoteOf(a.model),resume:home.resumeKeyOf(a.kind),progress:home.progressText(a.line,ref),text:home.resumeLineText(a.line,ref),aria:home.resumeLineAria(a.line,ref),ctaAria:home.ctaAria(a.model,ref),noChars:home.noCharsLeft(a.state,a.today,deck(a),p(a))}),
    'view.library-all': a => {setDeckSource(deckSources());return libraryAll.allModel(a.state,{...a,policy:p(a),pyOf:c=>a.pinyin?.[c]??cardForKey('base:'+c)?.py??'',practicable:k=>!a.unpracticable?.includes(k)});},
    'view.library-all.helpers': a => ({sort:libraryAll.normalizeSort(a.sort),filter:libraryAll.normalizeFilter(a.filter),fold:libraryAll.normalizeFold(a.fold),py:libraryAll.pyKey(a.py),initial:libraryAll.pyInitial(a.py),find:libraryAll.parseFind(a.find),month:libraryAll.monthName(a.month,a.today),where:libraryAll.foundWhere(a.month,a.today),toggle:libraryAll.toggleFold(a.fold,a.month,a.open),take:libraryAll.takeCells(a.groups||[],a.limit)}),
    'view.detail': a => {setDeckSource(deckSources());return detail.detailView({getState:()=>a.state,getInk:ink(a)},a.char,a);},
    'view.detail.model': a => {setDeckSource(deckSources());return detail.detailModel(a.state,a.char,{...a,policy:p(a),hasInk:r=>detail.recordHasInk({getInk:ink(a)},r)});},
    'view.detail-photo': a => detail.photoView(a.state,a.char),
    'view.detail.helpers': a => {setDeckSource(deckSources());const store={getInk:ink(a)},i=detail.inkOf(store,a.record),m=detail.detailModel(a.state,a.char,{today:a.today,policy:p(a)}); return {base:detail.baseKey(a.char),records:detail.recordsOfChar(a.state,a.char),copy:detail.cellCopy(a.record||{}),list:detail.listOf({records:Object.values(a.state.records||{}).flatMap(v=>Array.isArray(v)?v:v.kept||[]),sched:a.state.sched,today:a.today,cardKey:'base:'+a.char}),word:detail.wordView(cardForKey('base:'+a.char)),hero:detail.detailHero(m),ink:i,has:detail.recordHasInk(store,a.record),points:detail.hasInkPoints(i),day:detail.dayRef(a.day),photo:detail.photoOf(a.state,a.char)};},
    'view.records': a => mineSub.recordsView(a.state,a.today,{...a,policy:p(a),inkOf:r=>detail.inkOf({getInk:ink(a)},r)}),
    'view.month': a => mineSub.monthView(a.state,a.month,{policy:p(a),inkOf:r=>detail.inkOf({getInk:ink(a)},r)}),
    'view.month.sheet': a => mineSub.monthSheetOf(a.state,a.month,{policy:p(a),inkOf:r=>detail.inkOf({getInk:ink(a)},r)}),
    'view.annual-page': a => mineSub.annualView(a.state,a.today,{...a,policy:p(a),inkOf:r=>detail.inkOf({getInk:ink(a)},r)}),
    'view.mine-sub.helpers': a => ({month:mineSub.monthHeadRef(a.n),day:mineSub.dayTextRef(a.day),label:mineSub.cellLabelRef(a.cell),dayLabel:mineSub.dayCellLabelRef(a.cell),geometry:mineSub.sheetGeometry(a.n,a.width)}),
    'view.mine': a => minePage.mineView(a.state,a.today,{...a,policy:p(a),store:{getInk:ink(a)},strokesOf:r=>sheetStrokes({getInk:ink(a)},r)}),
    'view.mine.sheet': a => minePage.mineSheetView(a.state,mine.mineModel(a.state,a.today,{policy:p(a),storagePressure:a.storagePressure}),{...a,policy:p(a),store:{getInk:ink(a)},strokesOf:r=>sheetStrokes({getInk:ink(a)},r)}),
    'view.mine.cells': a => minePage.monthSheetCells(a.state,a.month,{policy:p(a),store:{getInk:ink(a)}}),
    'view.mine.helpers': a => ({label:minePage.cellLabelRef(a.cell),trim:minePage.trimSheetCells(a.cells||[],a.max),rows:minePage.mineSheetRows(a.n,a.ax),backup:minePage.backupValueRef(mine.mineModel(a.state,a.today,{policy:p(a),storagePressure:a.storagePressure})),choices:minePage.mineChoices(settings.settingsView(a.state.settings),p(a))}),
    'view.library-list': a => {setDeckSource(deckSources()); return libraryList.listModel(a.state,{...a,policy:p(a),cardFor:k=>a.cards?.[k]??cardForKey(k),practicable:k=>!a.unpracticable?.includes(k)});},
    'view.library-list.entries': a => libraryList.listEntries(a.state,{...a,policy:p(a)}),
    'view.library-list.helpers': a => ({kind:libraryList.normalizeKind(a.kind),zone:libraryList.isZoneKind(a.kind),parts:libraryList.listRowMetaParts(a.meta),date:libraryList.dateText(a.day),word:libraryList.wordParts(a.word,a.char),sel:libraryList.normalizeSel(a.sel),same:libraryList.sameSel(a.sel,a.other),toggle:libraryList.toggleSel(a.sel,a.char),all:libraryList.selectAllSel(a.model||{rows:[]}),none:libraryList.selectNoneSel(),button:libraryList.buttonLabel(a.n),hint:libraryList.hintText(a.n),active:libraryList.groupFromHereActive(a.state,a.view)}),
    'view.annual': a => annual.annualModel(a.state,a.today,{year:a.year,policy:p(a)}),
    'view.annual.plan': a => annual.annualPlan(a.state,{today:a.today,year:a.year,policy:p(a),inkOf:r=>query.inkPointsOf({latest:r},ink(a))}),
    'view.annual.years': a => annual.annualYears(a.state),
    'view.annual.defaultYear': a => annual.annualDefaultYear(a.state,a.today),
    'view.annual.slice': a => {const s=annual.yearSlice(a.state,a.year); return {...s,firstSeen:[...s.firstSeen]};},
    'view.annual.first': a => annual.firstOfYear(annual.yearSlice(a.state,a.year)),
    'view.annual.twice': a => annual.twiceOfYear(annual.yearSlice(a.state,a.year)),
    'view.annual.months': a => annual.yearMonths(a.state,annual.yearSlice(a.state,a.year),{policy:p(a)}),
    'view.query': a => query.querySheetModel(q(a)),
    'view.query.sheet': a => query.sheetModel(q(a)),
    'view.query.meta': a => query.cardMetaRef(a.pinyin, a.strokes),
    'view.query.stat': a => query.cardStatRef(a.summary),
    'view.query.date': a => query.dateRef(a.day),
    'view.query.ink': a => query.inkPointsOf(a.summary, ink(a), p(a)),
    'view.about': a => about.aboutModel(a),
    'view.about-privacy': a => about.privacyModel(a),
    'view.about-credits': a => about.creditsModel(a.credits, a.texts),
    'view.about-letter': () => about.letterModel(),
    'view.about.buildDay': a => about.buildDay(a.build),
    'view.about.stripArrow': a => about.stripArrow(a.text),
    'view.about.versionRefs': a => about.versionRefs(a.version, a.build),
    'view.about.rows': () => about.aboutRowRefs(),
    'view.about.creditName': a => about.creditName(required(a, 'credit')),
    'view.about.creditFullText': a => about.creditFullText(required(a, 'credit'), a.texts),
    'view.about.creditGroups': a => about.creditGroupRefs(a.credits),
    'view.settings': a => settings.settingsView(a.settings, { p: p(a) }),
    'view.remind': a => settings.remindView(a.settings, { p: p(a) }),
    'view.settings.parseTime': a => settings.parseTime(a.text),
    'view.settings.timeText': a => settings.timeText(a.hour, a.minute),
    'view.settings.defaultRemindTime': a => settings.defaultRemindTime(p(a)),
    'view.library-switch': a => { setDeckSource(deckSources()); return librarySwitch.libraryRows(a.state, {
      ...(a.libraries === undefined ? {} : { libraryOf: id => a.libraries[id] }),
      ...(a.current === undefined ? {} : { currentId: () => a.current }),
    }); },
    'view.library-switch.name': a => librarySwitch.libraryNameRef(a.id),
    'view.library-switch.desc': a => librarySwitch.libraryDescRef(a.id),
    'view.library-switch.judgedChars': a => [...librarySwitch.judgedChars(a.state)],
    'view.block': a => block.blockView(a),
    'view.block.reason': a => block.blockReasonOf(a.status, a.migration),
    'view.block.hasJudged': a => block.hasJudged({ getState: () => a.state }),
    'view.block.backup': a => block.blockBackup({ getState: () => required(a, 'state'), serial: a.serial ?? 0 }, a.now ?? clock()),
    'view.session-none': a => session.noneView(a),
    'view.kuan': a => at(a, () => kuan.kuanRef(a)),
    'view.kuan.date': a => at(a, () => kuan.dateRef(a.day)),
    'view.kuan.month': a => kuan.monthRef(required(a, 'month')),
    'view.kuan.part': a => kuan.partRef(a.i),
    'view.kuan.year': a => kuan.annualYearText(a.year),
    'view.kuan.cover': a => kuan.annualCoverLineRef(a.n),
    'view.lines.measure': a => {
      lines.setLineMeasurer('result' in a || a.throws ? () => { if (a.throws) throw Error('measurement failed'); return a.result; } : null);
      try { return lines.measureLines(a.spec); } finally { lines.setLineMeasurer(null); }
    },
  };
}
