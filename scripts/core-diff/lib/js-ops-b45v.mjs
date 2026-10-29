// B4.5b: real view functions, no duplicated product rules.
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
  const ink = a => r => a.state?.ink?.[r.localDay.slice(0, 7)]?.[r.id] ?? null;
  const q = a => { setDeckSource(deckSources()); return { ...a, policy: p(a), predicates: query.deckPredicates(a.state?.settings), getInk: ink(a), store: { getInk: ink(a) } }; };
  return {
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
