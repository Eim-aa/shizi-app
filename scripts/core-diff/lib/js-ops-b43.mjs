// B4.3 的 JS 参考 op（记录 / 查字 / 卡片 / 结构 / 作品成员 / 取墨 / 首练结果页 / 提醒题目 / 墨 v2 v3 v4 编解码 / V8 数学函数）。
// 与 ios/ShiziCore/Sources/ShiziCore/Engine/B43Ops*.swift 同名、同参数校验、同错误码；规则一律直接调 src/，这里只做协议适配。
// 参数约定：记录 / 卡片 / 墨迹等都是原样 JSON 值；注入函数（hasInk 之类）用数据描述：{ids: [记录 id…], throwIds?: [抛错的记录 id…]}。
import * as policy from '../../../src/config/policy.js';
import * as records from '../../../src/core/records.js';
import * as query from '../../../src/core/query.js';
import * as cards from '../../../src/core/cards.js';
import * as structure from '../../../src/core/structure.js';
import * as workMembers from '../../../src/core/work-members.js';
import * as inkPick from '../../../src/core/ink-pick.js';
import * as first from '../../../src/core/first-result.js';
import * as ink from '../../../src/core/ink-math.js';
import * as reminder from '../../../src/platform/reminder.js';
import { cardForKey, hasContextWord, isPracticable, setDeckSource, withWordOff } from '../../../src/data/deck.js';
import { t as copyT } from '../../../src/config/copy/index.js';
import { deckSources } from '../../build_core_config.mjs';

let deckCache = null;
const deck = () => deckCache || (deckCache = deckSources());
let deckReady = false;
function useDeck() {
  if (!deckReady) {
    setDeckSource({ seed: deck().seed, overrides: deck().overrides });
    deckReady = true;
  }
}

const has = (a, k) => Object.prototype.hasOwnProperty.call(a, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function makeB43Ops({ required, str, finite, int, badArgs }) {
  const arr = (a, k) => {
    const v = required(a, k);
    if (!Array.isArray(v)) throw badArgs(k + ' must be an array');
    return v;
  };
  const optArr = (a, k) => {
    if (!has(a, k)) return undefined;
    if (!Array.isArray(a[k])) throw badArgs(k + ' must be an array');
    return a[k];
  };
  const obj = (a, k) => {
    const v = required(a, k);
    if (!isObj(v)) throw badArgs(k + ' must be an object');
    return v;
  };
  const optObj = (a, k) => {
    if (!has(a, k)) return undefined;
    if (!isObj(a[k])) throw badArgs(k + ' must be an object');
    return a[k];
  };
  const strList = (v, k) => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw badArgs(k + ' must be an array of strings');
    return v;
  };
  const optStrList = (a, k) => (has(a, k) ? strList(a[k], k) : undefined);
  const numArg = (a, k) => {
    const v = required(a, k);
    if (typeof v !== 'number') throw badArgs(k + ' must be a number');
    return v;
  };
  const optNum = (a, k) => {
    if (!has(a, k)) return undefined;
    if (typeof a[k] !== 'number') throw badArgs(k + ' must be a number');
    return a[k];
  };
  const optString = (a, k) => {
    if (!has(a, k)) return undefined;
    if (typeof a[k] !== 'string') throw badArgs(k + ' must be a string');
    return a[k];
  };
  const hasInkSpec = (a, k) => {
    if (!has(a, k)) return undefined;
    const s = a[k];
    if (!isObj(s)) throw badArgs(k + ' must be an object');
    const ids = strList(required(s, 'ids'), k + '.ids');
    const thr = has(s, 'throwIds') ? strList(s.throwIds, k + '.throwIds') : [];
    return (r) => {
      if (thr.includes(r.id)) throw new Error('x');
      return ids.includes(r.id);
    };
  };
  const policyArg = (a) => {
    const o = optObj(a, 'policy');
    return o === undefined ? undefined : { ...policy, ...o };
  };
  const toleranceArg = (a) => {
    if (!has(a, 'tolerance')) return undefined;
    const v = a.tolerance;
    if (v !== null && !isObj(v)) throw badArgs('tolerance must be an object or null');
    return v;
  };
  const card = (a, k = 'card') => {
    const v = required(a, k);
    if (!isObj(v)) throw badArgs(k + ' must be an object');
    return v;
  };
  // 邀请写入：用真实的 commitInviteShown / commitInviteAnswer 对一个假 store 跑一遍，取回写入后的 settings
  const fakeStore = (settings) => {
    let out;
    const labels = [];
    return {
      store: {
        getState: () => ({ settings }),
        commit: (label, fn) => {
          const draft = { settings: settings === undefined ? undefined : JSON.parse(JSON.stringify(settings)) };
          fn(draft);
          out = draft.settings;
          labels.push(label);
          return { ok: true, keys: ['shizi.v2.settings'] };
        },
      },
      result: () => ({ settings: out, label: labels[0] }),
    };
  };
  const stateArg = (a) => {
    const v = required(a, 'state');
    if (!isObj(v)) throw badArgs('state must be an object');
    return v;
  };
  const recs = (a) => arr(a, 'records');
  const pairs = (m) => [...m.entries()];
  const addedOf = (a) => optStrList(a, 'added');
  const pointsArg = (v, k) => {
    if (!Array.isArray(v) || !v.every(isObj)) throw badArgs(k + ' must be an array of point objects');
    return v;
  };
  const strokesArg = (a, k) => arr(a, k).map((s) => pointsArg(s, k));
  const rowsArg = (v, k) => {
    if (!Array.isArray(v)) throw badArgs(k + ' must be an array');
    return v.map((r) => (Array.isArray(r) && r.every((x) => typeof x === 'number') ? r : [NaN]));
  };
  const filteredArg = (a) => {
    if (!has(a, 'filtered') || a.filtered === null) return null;
    const f = a.filtered;
    if (!isObj(f) || !Array.isArray(f.chars) || !f.chars.every((x) => typeof x === 'string') || !Array.isArray(f.duplicates) || !f.duplicates.every((x) => typeof x === 'string') || typeof f.removed !== 'number') {
      throw badArgs('filtered must be a filterInput result');
    }
    return f;
  };
  const inkOpts = (a) => {
    if (has(a, 'policy') && !isObj(a.policy)) throw badArgs('policy must be an object');
    const o = { ...a };
    const p = policyArg(a);
    if (p) o.policy = p;
    return o;
  };
  const builtOf = (b) => ({ points: [...b], v30: b.v30, dot: b.dot, single: b.single, endK: b.endK, pressure: b.pressure });

  return {
    // ---------------------------------------------------------------- records
    'records.recordSerial': (a) => records.recordSerial(required(a, 'id')),
    'records.sessionSerial': (a) => records.sessionSerial(required(a, 'id')),
    'records.recordId': (a) => records.recordId(numArg(a, 'serial')),
    'records.sessionId': (a) => records.sessionId(numArg(a, 'serial')),
    'records.compareRecordIds': (a) => records.compareRecordIds(required(a, 'a'), required(a, 'b')),
    'records.sortById': (a) => records.sortById(recs(a)),
    'records.nextSerial': (a) => records.nextSerial({ records: optArr(a, 'records'), sessions: has(a, 'sessions') ? a.sessions : undefined, metaSerial: has(a, 'metaSerial') ? a.metaSerial : undefined }),
    'records.charOfCardKey': (a) => records.charOfCardKey(required(a, 'cardKey')),
    'records.validateRecord': (a) => records.validateRecord(required(a, 'record')),
    'records.makeRecord': (a) => records.makeRecord(a),
    'records.predicates': (a) => {
      const r = required(a, 'record');
      return { recordSource: records.recordSource(r), isPaperRecord: records.isPaperRecord(r), isWorkRecord: records.isWorkRecord(r), isJudged: records.isJudged(r), isSeenOnly: records.isSeenOnly(r) };
    },
    'records.isAfterSeenWork': (a) => records.isAfterSeenWork(required(a, 'record'), hasInkSpec(a, 'hasInk')),
    'records.isWorkOrAfterSeen': (a) => records.isWorkOrAfterSeen(required(a, 'record'), hasInkSpec(a, 'hasInk')),
    'records.withoutPaper': (a) => records.withoutPaper(recs(a)),
    'records.foldWorkByDay': (a) => records.foldWorkByDay(required(a, 'fold')),
    'records.correctRecord': (a) => records.correctRecord(required(a, 'record'), required(a, 'judgment'), required(a, 'at')),
    'records.replaceRecord': (a) => records.replaceRecord(recs(a), required(a, 'next')),
    'records.removeRecord': (a) => records.removeRecord(recs(a), required(a, 'id')),
    'records.latestJudgedByCard': (a) => pairs(records.latestJudgedByCard(recs(a))),
    'records.practicedByChar': (a) => pairs(records.practicedByChar(recs(a))),
    'records.latestJudged': (a) => records.latestJudged(recs(a), str(a, 'cardKey')),
    'records.recordsOfCard': (a) => records.recordsOfCard(recs(a), str(a, 'cardKey')),
    'records.judgedCountOfCard': (a) => records.judgedCountOfCard(recs(a), str(a, 'cardKey')),
    'records.wrongCountOfCard': (a) => records.wrongCountOfCard(recs(a), str(a, 'cardKey')),
    'records.firstJudgedOfCard': (a) => records.firstJudgedOfCard(recs(a), str(a, 'cardKey')),
    'records.writtenCardKeys': (a) => [...records.writtenCardKeys(recs(a))],
    'records.hasAnyJudged': (a) => records.hasAnyJudged(recs(a)),
    'records.wrongList': (a) => records.wrongList(recs(a)),
    'records.isInWrongList': (a) => records.isInWrongList(recs(a), str(a, 'cardKey')),
    'records.forgetList': (a) => records.forgetList({ records: recs(a), sched: has(a, 'sched') ? a.sched : undefined, today: required(a, 'today'), policy: policyArg(a) }),
    'records.judgedCardKeysOn': (a) => [...records.judgedCardKeysOn(recs(a), str(a, 'day'))],
    'records.answerSeenCardKeysOn': (a) => [...records.answerSeenCardKeysOn(recs(a), str(a, 'day'))],
    'records.skippedCardKeysOn': (a) => [...records.skippedCardKeysOn(recs(a), str(a, 'day'), optString(a, 'fromDay'))],
    'records.todayCount': (a) => records.todayCount(recs(a), str(a, 'today')),
    'records.reviewsDoneOn': (a) => records.reviewsDoneOn(recs(a), str(a, 'day')),
    'records.recordsByMonth': (a) => records.recordsByMonth(recs(a)),
    'records.judgedDaysInMonth': (a) => records.judgedDaysInMonth(recs(a), str(a, 'month')),

    // ---------------------------------------------------------------- query
    'query.pyKey': (a) => query.pyKey(required(a, 'py')),
    'query.parsePinyinInput': (a) => query.parsePinyinInput(required(a, 'text')),
    'query.pinyinMatches': (a) => query.pinyinMatches(str(a, 'query'), arr(a, 'entries'), { written: has(a, 'written') ? new Set(strList(a.written, 'written')) : undefined, max: has(a, 'max') ? a.max : undefined }),
    'query.writtenChars': (a) => [...query.writtenChars(recs(a))],
    'query.isHan': (a) => query.isHan(required(a, 'value')),
    'query.filterInput': (a) => query.filterInput(required(a, 'text'), has(a, 'max') ? { max: a.max } : undefined),
    'query.filterNotes': (a) => query.filterNotes(filteredArg(a), optString(a, 'view')),
    'query.flattenRecords': (a) => query.flattenRecords(required(a, 'domain')),
    'query.isPracticable': (a) => {
      const d = optStrList(a, 'deck');
      const l = optStrList(a, 'library');
      return query.isPracticable(required(a, 'char'), { inDeck: d ? (c) => d.includes(c) : null, inLibrary: l ? (c) => l.includes(c) : null });
    },
    'query.customChars': (a) => query.customChars(required(a, 'custom')),
    'query.isCustom': (a) => query.isCustom(required(a, 'custom'), str(a, 'char')),
    'query.withCustomAdded': (a) => query.withCustomAdded(required(a, 'custom'), required(a, 'char'), required(a, 'at')),
    'query.charSummary': (a) => query.charSummary(str(a, 'char'), { records: optArr(a, 'records'), sched: has(a, 'sched') ? a.sched : undefined, custom: has(a, 'custom') ? a.custom : undefined, practicable: has(a, 'practicable') ? a.practicable : undefined }),
    'query.rowStatus': (a) => query.rowStatus(obj(a, 'summary')),
    'query.cardStat': (a) => query.cardStat(obj(a, 'summary')),
    'query.queryView': (a) => {
      const prac = optStrList(a, 'practicable') || [];
      const o = { chars: strList(required(a, 'chars'), 'chars'), practicable: (c) => prac.includes(c) };
      const cur = optString(a, 'cur');
      if (cur !== undefined) o.cur = cur;
      return query.queryView(o);
    },
    'query.selectedChars': (a) => {
      const prac = optStrList(a, 'practicable');
      return query.selectedChars(strList(required(a, 'chars'), 'chars'), strList(required(a, 'selected'), 'selected'), prac ? (c) => prac.includes(c) : () => true);
    },
    'query.pickBar': (a) => query.pickBar(required(a, 'count')),
    'query.normalizeMode': (a) => query.normalizeMode(required(a, 'mode'), policyArg(a)),

    // ---------------------------------------------------------------- cards / deck
    'cards.applyContextOverride': (a) => cards.applyContextOverride(card(a, 'source'), required(a, 'overrides')),
    'cards.build': (a) => cards.buildCards({ seed: arr(a, 'rows'), overrides: required(a, 'overrides') }),
    'cards.cardKey': (a) => cards.cardKey(card(a)),
    'cards.libraryIdsFor': (a) => cards.libraryIdsFor(card(a)),
    'cards.libraries': () => cards.LIBRARIES.map((l) => ({ id: l.id, label: l.label, officialTotal: l.officialTotal })),
    'cards.promptModel': (a) => cards.promptModel(card(a), has(a, 'copy') ? obj(a, 'copy') : undefined),
    'cards.visibleHint': (a) => cards.visibleHint(card(a), has(a, 'copy') ? obj(a, 'copy') : undefined),
    'cards.promptHTML': (a) => cards.promptHTML(card(a), has(a, 'copy') ? obj(a, 'copy') : undefined),
    'deck.cardsOfRow': (a) => {
      const i = int(a, 'index', 10000000);
      const seed = deck().seed;
      return i >= 0 && i < seed.length ? cards.buildCards({ seed: [seed[i]], overrides: deck().overrides }) : null;
    },
    'deck.summary': () => {
      const all = cards.buildCards({ seed: deck().seed, overrides: deck().overrides });
      const keys = new Set(all.map(cards.cardKey));
      const libraries = {};
      for (const lib of cards.LIBRARIES) libraries[lib.id] = all.filter((c) => lib.test(c)).length;
      return { count: all.length, unique: keys.size, libraries, firstKey: cards.cardKey(all[0]), lastKey: cards.cardKey(all[all.length - 1]) };
    },
    'deck.cardForKey': (a) => {
      useDeck();
      return cardForKey(str(a, 'key'));
    },
    'deck.isPracticable': (a) => {
      useDeck();
      return isPracticable(str(a, 'key'));
    },
    'deck.hasContextWord': (a) => hasContextWord(required(a, 'card')),
    'deck.withWordOff': (a) => withWordOff(required(a, 'card'), required(a, 'wordOff')),

    // ---------------------------------------------------------------- structure / workMembers / inkPick
    'structure.validGroups': (a) => structure.validGroups(has(a, 'groups') ? a.groups : undefined, int(a, 'total', 1000000000)),
    'structure.inferStructure': (a) => structure.inferStructure(has(a, 'groups') ? a.groups : undefined, has(a, 'medians') ? a.medians : undefined),
    'structure.describe': (a) => structure.describeStructure({ groups: has(a, 'groups') ? a.groups : undefined, medians: has(a, 'medians') ? a.medians : undefined }),

    'workMembers.isWorkMember': (a) => workMembers.isWorkMember(required(a, 'record'), { hasInk: hasInkSpec(a, 'hasInk'), added: addedOf(a) }),
    'workMembers.isWrongMember': (a) => workMembers.isWrongMember(required(a, 'record')),
    'workMembers.records': (a) => workMembers.workMemberRecords(recs(a), { hasInk: hasInkSpec(a, 'hasInk'), added: addedOf(a) }),
    'workMembers.members': (a) => {
      const o = { hasInk: hasInkSpec(a, 'hasInk'), added: addedOf(a) };
      if (has(a, 'prefer')) o.prefer = a.prefer;
      if (has(a, 'order')) o.order = a.order;
      if (has(a, 'pickInk')) o.pickInk = a.pickInk === null ? null : hasInkSpec(a, 'pickInk');
      return workMembers.workMembers(recs(a), o);
    },

    'inkPick.normalizePrefer': (a) => inkPick.normalizePrefer(required(a, 'prefer')),
    'inkPick.inkHasStrokes': (a) => inkPick.inkHasStrokes(required(a, 'ink')),
    'inkPick.storedInkPresent': (a) => inkPick.storedInkPresent(required(a, 'state'), required(a, 'record')),
    'inkPick.pickInkRecord': (a) => inkPick.pickInkRecord(recs(a), { prefer: has(a, 'prefer') ? a.prefer : undefined, hasInk: hasInkSpec(a, 'hasInk') }),
    'inkPick.pickRecordInPeriod': (a) => inkPick.pickRecordInPeriod(recs(a), { prefer: has(a, 'prefer') ? a.prefer : undefined, hasInk: hasInkSpec(a, 'hasInk') }),

    // ---------------------------------------------------------------- first-result
    'firstResult.tierOfDue': (a) => first.tierOfDue(required(a, 'due'), required(a, 'today')),
    'firstResult.reviewPreview': (a) => first.reviewPreview({ chars: arr(a, 'chars'), sched: has(a, 'sched') ? a.sched : undefined, today: required(a, 'today') }),
    'firstResult.previewText': (a) => first.previewText(first.reviewPreview({ chars: arr(a, 'chars'), sched: has(a, 'sched') ? a.sched : undefined, today: required(a, 'today') }), copyT),
    'firstResult.reviewDays': (a) => first.reviewDays({ chars: arr(a, 'chars'), sched: has(a, 'sched') ? a.sched : undefined, today: required(a, 'today') }),
    'firstResult.daysLaterText': (a) => first.daysLaterText(required(a, 'days'), copyT),
    'firstResult.daysLaterLine': (a) => first.daysLaterLine({ chars: arr(a, 'chars'), sched: has(a, 'sched') ? a.sched : undefined, today: required(a, 'today') }, copyT),
    'firstResult.inviteOf': (a) => first.inviteOf(required(a, 'settings')),
    'firstResult.inviteDecision': (a) => first.inviteDecision({ settings: has(a, 'settings') ? a.settings : undefined, variant: has(a, 'variant') ? a.variant : undefined, sessionId: has(a, 'sessionId') ? a.sessionId : undefined }),
    'firstResult.inviteShown': (a) => {
      const f = fakeStore(has(a, 'settings') ? a.settings : undefined);
      const r = first.commitInviteShown(f.store, { sessionId: required(a, 'sessionId') });
      return r.skipped ? { skipped: true } : f.result();
    },
    'firstResult.inviteAnswer': (a) => {
      const f = fakeStore(has(a, 'settings') ? a.settings : undefined);
      const r = first.commitInviteAnswer(f.store, required(a, 'answer'));
      return r.skipped ? { skipped: true } : f.result();
    },
    'firstResult.inviteTime': (a) => first.inviteTime(numArg(a, 'nowMs')),
    'firstResult.inviteTimeText': (a) => first.inviteTimeText(has(a, 'hour') ? a.hour : undefined, has(a, 'minute') ? a.minute : undefined),

    // ---------------------------------------------------------------- reminder（题目选取）
    'reminder.remindOf': (a) => reminder.remindOf(has(a, 'settings') ? a.settings : undefined, optObj(a, 'policy') ? { ...policy, ...a.policy } : undefined),
    'reminder.normalizeTargetKey': (a) => reminder.normalizeTargetKey(required(a, 'raw')),
    'reminder.maskedWord': (a) => reminder.maskedWord(card(a), optObj(a, 'policy') ? { ...policy, ...a.policy } : undefined),
    'reminder.candidates': (a) => {
      useDeck();
      return reminder.reminderCandidates(stateArg(a), { policy: optObj(a, 'policy') ? { ...policy, ...a.policy } : undefined });
    },
    'reminder.questions': (a) => {
      useDeck();
      const o = { today: required(a, 'today'), policy: optObj(a, 'policy') ? { ...policy, ...a.policy } : undefined };
      if (has(a, 'count')) o.count = int(a, 'count', 100);
      return reminder.reminderQuestions(stateArg(a), o);
    },
    'reminder.fireDayOf': (a) => reminder.fireDayOf(has(a, 'now') ? a.now : undefined, has(a, 'remind') ? a.remind : undefined, required(a, 'today'), optObj(a, 'policy') ? { ...policy, ...a.policy } : undefined),
    'reminder.payload': (a) => {
      useDeck();
      return reminder.reminderPayload(stateArg(a), { remind: has(a, 'remind') ? a.remind : null, today: required(a, 'today'), now: has(a, 'now') ? a.now : null, policy: optObj(a, 'policy') ? { ...policy, ...a.policy } : undefined });
    },
    'reminder.affects': (a) => reminder.affectsReminder(required(a, 'info')),

    // ---------------------------------------------------------------- ink
    'jsmath.hypot': (a) => Math.hypot(numArg(a, 'a'), numArg(a, 'b')),
    'jsmath.exp': (a) => Math.exp(numArg(a, 'x')),
    'ink.params': (a) => ({ ...ink.inkParams(policyArg(a)) }),
    'ink.mergeSameTime': (a) => ink.mergeSameTime(pointsArg(required(a, 'raw'), 'raw')),
    'ink.liftSpeed': (a) => ink.liftSpeed(pointsArg(required(a, 'merged'), 'merged'), optNum(a, 'window')),
    'ink.catmullRom': (a) => ink.catmullRom(pointsArg(required(a, 'points'), 'points'), optNum(a, 'step')),
    'ink.buildStroke': (a) => builtOf(ink.buildStroke(pointsArg(required(a, 'raw'), 'raw'), inkOpts(a))),
    'ink.strokeLength': (a) => ink.strokeLength(pointsArg(required(a, 'points'), 'points')),
    'ink.thinStroke': (a) => ink.thinStroke(pointsArg(required(a, 'points'), 'points'), optNum(a, 'max')),
    'ink.simplifyStroke': (a) => {
      const o = {};
      const max = optNum(a, 'max');
      if (max !== undefined) o.max = max;
      const tol = toleranceArg(a);
      if (tol !== undefined) o.tolerance = tol;
      return ink.simplifyStroke(pointsArg(required(a, 'points'), 'points'), o);
    },
    'ink.quantizeDt': (a) => ink.quantizeDt(numArg(a, 'ms')),
    'ink.bytesToBase64': (a) => {
      const bytes = arr(a, 'bytes');
      if (!bytes.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) throw badArgs('bytes must be integers 0..255');
      return ink.bytesToBase64(Uint8Array.from(bytes));
    },
    'ink.base64ToBytes': (a) => {
      const b = ink.base64ToBytes(str(a, 'str'));
      return b ? [...b] : null;
    },
    'ink.isBase64': (a) => ink.isBase64(str(a, 'str')),
    'ink.encodeInk': (a) => {
      const o = {};
      for (const k of ['base', 'maxPoints', 'maxStrokes']) {
        const v = optNum(a, k);
        if (v !== undefined) o[k] = v;
      }
      const tol = toleranceArg(a);
      if (tol !== undefined) o.tolerance = tol;
      const p = policyArg(a);
      if (p) o.policy = p;
      return ink.encodeInk(strokesArg(a, 'strokes'), o);
    },
    'ink.isInk': (a) => {
      const v = required(a, 'ink');
      return { v2: ink.isInkV2(v), v3: ink.isInkV3(v), v4: ink.isInkV4(v), any: ink.isInk(v) };
    },
    'ink.decodeInk': (a) => ink.decodeInk(required(a, 'ink'), inkOpts(a)),
    'ink.resampleForReplay': (a) => ink.resampleForReplay(strokesArg(a, 'decoded'), optNum(a, 'step')),
    'ink.encodeRawStrokes': (a) => ink.encodeRawStrokes(strokesArg(a, 'strokes')),
    'ink.decodeRawStrokes': (a) => ink.decodeRawStrokes(rowsArg(required(a, 'rows'), 'rows')),
    'ink.rawRowToPacked': (a) => ink.rawRowToPacked(rowsArg([arr(a, 'row')], 'row')[0]),
    'ink.packedToRawRow': (a) => ink.packedToRawRow(str(a, 'str')),
    'ink.encodeInkRaw': (a) => {
      const o = {};
      const ms = optNum(a, 'maxStrokes');
      if (ms !== undefined) o.maxStrokes = ms;
      const p = policyArg(a);
      if (p) o.policy = p;
      return ink.encodeInkRaw(strokesArg(a, 'strokes'), o);
    },
    'ink.inkRawRows': (a) => ink.inkRawRows(required(a, 'ink')),
    'ink.decodeInkRaw': (a) => ink.decodeInkRaw(required(a, 'ink')),
    'ink.encodeStoredInk': (a) => {
      const o = {};
      const p = policyArg(a);
      if (p) o.policy = p;
      const f = optString(a, 'format');
      if (f !== undefined) o.format = f;
      return ink.encodeStoredInk(strokesArg(a, 'strokes'), o);
    },
  };
}
