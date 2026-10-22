// B4.2 的 JS 参考 op（FSRS 与出题调度：fsrs / mix / sessions / session-start / new-order / special / group-size / spread / hints / correct）。
// 与 ios/ShiziCore/Sources/ShiziCore/Engine/SchedOps.swift 同名、同参数校验、同错误码；规则一律直接调 src/，这里只做协议适配。
//
// 约定：
//   · policy：可选 `policy`（对象）= 浅覆盖 {...policy, ...patch}（与 test/core/helpers.mjs policyWith 同法）；
//   · deck：可选 `deck`（对象）= 假题库 {newCandidates:[键], warmupCandidates?:[键], practicable?:[键], currentLibraryId?:串}；缺省 = 真题库（data/deck.js deckAdapter）；
//   · isWarm：一律真热身清单（new-order isWarmupKey）；practicable 缺省 = base: 前缀（与 selectDaily 缺省同）；
//   · start.* 的提交类 op 在内存假 store 上跑（草稿浅拷贝、mutate 抛错 = {ok:false, error:{kind:'mutator'}}、ctx.nextId 从 `serial` 起数），
//     回包 {result, commits:[{label, set, schedPatch?}], serial}：set = 按 JSON 变了的域（sched 除外），schedPatch = 变了 / 新增的调度项。
import * as basePolicy from '../../../src/config/policy.js';
import * as fsrs from '../../../src/core/fsrs.js';
import * as mix from '../../../src/core/mix.js';
import * as sessions from '../../../src/core/sessions.js';
import * as start from '../../../src/core/session-start.js';
import * as newOrder from '../../../src/core/new-order.js';
import * as special from '../../../src/core/special.js';
import * as groupSize from '../../../src/core/group-size.js';
import * as spread from '../../../src/core/spread.js';
import * as hints from '../../../src/core/hints.js';
import * as correct from '../../../src/core/correct.js';
import { deckAdapter, setDeckSource } from '../../../src/data/deck.js';
import { loadFSRSGlobal } from '../../../test/core/helpers.mjs';
import { deckSources } from '../../build_core_config.mjs';

loadFSRSGlobal();
let deckReady = false;
function realDeck() {
  if (!deckReady) {
    setDeckSource(deckSources());
    deckReady = true;
  }
  return deckAdapter;
}

const has = (a, k) => Object.prototype.hasOwnProperty.call(a, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const orNull = (x) => (x === undefined ? null : x);
const json = (v) => JSON.stringify(v);
/** 判断时刻早于上次复习时 fsrs.js 会 console.warn 一条诊断（D65 #3）；差分里成千上万次，静音（行为不变）。 */
function quiet(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

export function makeB42Ops({ required, str, finite, int, badArgs }) {
  const opt = (a, k) => (has(a, k) ? a[k] : undefined);
  const objArg = (a, k) => {
    const v = required(a, k);
    if (!isObj(v)) throw badArgs(k + ' must be an object');
    return v;
  };
  const optObj = (a, k) => {
    if (!has(a, k)) return undefined;
    if (!isObj(a[k])) throw badArgs(k + ' must be an object');
    return a[k];
  };
  const arrOfObj = (a, k) => {
    const v = required(a, k);
    if (!Array.isArray(v) || v.some((x) => !isObj(x))) throw badArgs(k + ' must be an array of objects');
    return v;
  };
  const optArrOfObj = (a, k) => (has(a, k) ? arrOfObj(a, k) : undefined);
  const strArr = (a, k) => {
    const v = required(a, k);
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badArgs(k + ' must be an array of strings');
    return v;
  };
  const optStrArr = (a, k) => (has(a, k) ? strArr(a, k) : undefined);
  const schedArg = (a, k) => {
    const v = required(a, k);
    if (!isObj(v) || Object.values(v).some((e) => e !== null && !isObj(e))) throw badArgs(k + ' must be an object of entries');
    return v;
  };
  const optBool = (a, k) => {
    if (!has(a, k)) return undefined;
    if (typeof a[k] !== 'boolean') throw badArgs(k + ' must be a boolean');
    return a[k];
  };
  const policyOf = (a) => {
    const p = optObj(a, 'policy');
    return p ? { ...basePolicy, ...p } : basePolicy;
  };
  const deckOf = (a) => {
    if (a.deck === 'real') return realDeck();
    const d = optObj(a, 'deck');
    if (!d) return realDeck();
    const cands = has(d, 'newCandidates') ? d.newCandidates : [];
    if (!Array.isArray(cands) || cands.some((x) => typeof x !== 'string')) throw badArgs('deck.newCandidates must be an array of strings');
    const out = { newCandidates: () => cands };
    if (has(d, 'warmupCandidates')) {
      if (!Array.isArray(d.warmupCandidates) || d.warmupCandidates.some((x) => typeof x !== 'string')) throw badArgs('deck.warmupCandidates must be an array of strings');
      out.warmupCandidates = () => d.warmupCandidates;
    }
    if (has(d, 'practicable')) {
      if (!Array.isArray(d.practicable) || d.practicable.some((x) => typeof x !== 'string')) throw badArgs('deck.practicable must be an array of strings');
      const known = new Set(d.practicable);
      out.practicable = (k) => known.has(k);
    } else {
      out.practicable = (k) => typeof k === 'string' && k.startsWith('base:');
    }
    if (has(d, 'currentLibraryId')) {
      if (typeof d.currentLibraryId !== 'string') throw badArgs('deck.currentLibraryId must be a string');
      out.currentLibraryId = () => d.currentLibraryId;
    }
    return out;
  };
  const practicableOf = (a) => {
    if (!has(a, 'practicable')) return undefined;
    const list = strArr(a, 'practicable');
    const known = new Set(list);
    return (k) => known.has(k);
  };
  const isWarm = (k) => newOrder.isWarmupKey(k);
  const statsOut = (s) => ({ ...s });

  // ---- 镜像（调度模拟器的状态缓存：mirror.patch 增量同步，各 op 的 state 传 "mirror" 即用它；不进状态快照）----
  let mirror = {};
  const stateArg = (a) => (a.state === 'mirror' ? mirror : objArg(a, 'state'));
  function patchMirror(a) {
    const next = { ...mirror };
    if (has(a, 'set')) {
      const set = objArg(a, 'set');
      for (const k of Object.keys(set)) next[k] = set[k];
    }
    if (has(a, 'drop')) for (const k of strArr(a, 'drop')) delete next[k];
    if (has(a, 'records')) {
      const months = objArg(a, 'records');
      const cur = { ...(isObj(next.records) ? next.records : {}) };
      for (const m of Object.keys(months)) {
        if (months[m] === null) delete cur[m];
        else cur[m] = months[m];
      }
      next.records = cur;
    }
    if (has(a, 'sched')) {
      const entries = objArg(a, 'sched');
      const cur = { ...(isObj(next.sched) ? next.sched : {}) };
      for (const k of Object.keys(entries)) {
        if (entries[k] === null) delete cur[k];
        else cur[k] = entries[k];
      }
      next.sched = cur;
    }
    mirror = next;
    return null;
  }

  // ---- 内存假 store（提交类 op）----
  function fakeStore(state0, serial0, now) {
    let state = state0;
    let serial = serial0;
    const commits = [];
    return {
      getState: () => state,
      commits,
      get serial() {
        return serial;
      },
      commit(label, mutate) {
        const draft = { ...state };
        let next = serial;
        const ctx = {
          now,
          label,
          nextId(prefix) {
            if (prefix !== 'r' && prefix !== 's') throw new Error(`nextId prefix must be 'r' or 's', got ${prefix}`);
            next += 1;
            return `${prefix}${next}`;
          },
        };
        try {
          mutate(draft, ctx);
        } catch (error) {
          return { ok: false, error: { kind: 'mutator', label, reason: error && error.message ? error.message : String(error) } };
        }
        if (next !== serial && isObj(draft.meta) && draft.meta.serial !== next) draft.meta = Object.assign({}, draft.meta, { serial: next });
        const set = {};
        let schedPatch = null;
        for (const k of Object.keys(draft)) {
          if (k === 'sched') {
            const before = isObj(state.sched) ? state.sched : {};
            const after = isObj(draft.sched) ? draft.sched : {};
            for (const key of Object.keys(after)) {
              if (!has(before, key) || json(before[key]) !== json(after[key])) (schedPatch || (schedPatch = {}))[key] = after[key];
            }
          } else if (json(state[k]) !== json(draft[k])) {
            set[k] = draft[k];
          }
        }
        commits.push(schedPatch ? { label, set, schedPatch, serial: next } : { label, set, serial: next });
        state = draft;
        serial = next;
        return { ok: true };
      },
    };
  }
  const commitArgs = (a) => {
    const state = stateArg(a);
    const serial = int(a, 'serial', 1e12);
    const now = finite(required(a, 'now'), 'now');
    return { state, serial, now };
  };
  const runStore = (a, fn) => {
    const { state, serial, now } = commitArgs(a);
    const store = fakeStore(state, serial, now);
    const result = fn(store, now);
    return { result, commits: store.commits, serial: store.serial };
  };
  const sourceOf = (a) => (has(a, 'source') ? objArg(a, 'source') : undefined);

  return {
    'mirror.patch': (a) => patchMirror(a),
    'mirror.get': () => mirror,
    'tz.set': (a) => {
      const zone = str(a, 'zone');
      process.env.TZ = zone;
      return null;
    },

    // ---- fsrs.js ----
    'fsrs.ratingFor': (a) => fsrs.ratingFor(required(a, 'judgment'), opt(a, 'help'), policyOf(a), { first: optBool(a, 'first') === true, warmup: optBool(a, 'warmup') === true }),
    'fsrs.emptyCard': (a) => fsrs.emptyCard(required(a, 'at')),
    'fsrs.isCompactCard': (a) => fsrs.isCompactCard(required(a, 'value')),
    'fsrs.reviewCard': (a) => {
      const w = optBool(a, 'warmup');
      const before = has(a, 'before') ? objArg(a, 'before') : null;
      return fsrs.reviewCard(before, objArg(a, 'review'), w === undefined ? { policy: policyOf(a) } : { policy: policyOf(a), warmup: w });
    },
    'fsrs.answerSeenAgainApplies': (a) => fsrs.answerSeenAgainApplies(optObj(a, 'entry'), objArg(a, 'record'), policyOf(a)),
    'fsrs.applyAnswerSeen': (a) => {
      const r = fsrs.applyAnswerSeen(optObj(a, 'entry'), objArg(a, 'record'), { policy: policyOf(a) });
      return { entry: orNull(r.entry), applied: r.applied };
    },
    'fsrs.applyJudgment': (a) => quiet(() => fsrs.applyJudgment(optObj(a, 'entry'), objArg(a, 'record'), { policy: policyOf(a), records: optArrOfObj(a, 'records') })),
    'fsrs.replay': (a) => {
      const before = has(a, 'fsrsBefore') ? objArg(a, 'fsrsBefore') : null;
      const opts = has(a, 'stoppedAt') ? { policy: policyOf(a), stoppedAt: a.stoppedAt } : { policy: policyOf(a) };
      return fsrs.replay(before, arrOfObj(a, 'records'), opts);
    },
    'fsrs.overdueDays': (a) => fsrs.overdueDays(optObj(a, 'entry'), required(a, 'today')),
    'fsrs.isDue': (a) => fsrs.isDue(optObj(a, 'entry'), required(a, 'today')),
    'fsrs.retrievability': (a) => fsrs.retrievability(optObj(a, 'entry'), required(a, 'now')),

    // ---- mix.js ----
    'mix.practiceStats': (a) => statsOut(mix.practiceStats(arrOfObj(a, 'records'), str(a, 'today'), { policy: policyOf(a), isWarm })),
    'mix.scaledCount': (a) => mix.scaledCount(finite(required(a, 'n'), 'n'), finite(required(a, 'size'), 'size'), policyOf(a).groupMix),
    'mix.pressureOf': (a) => (has(a, 'size')
      ? mix.pressureOf(finite(required(a, 'backlog'), 'backlog'), finite(required(a, 'groupsPerDay'), 'groupsPerDay'), policyOf(a).groupMix, finite(a.size, 'size'))
      : mix.pressureOf(finite(required(a, 'backlog'), 'backlog'), finite(required(a, 'groupsPerDay'), 'groupsPerDay'), policyOf(a).groupMix)),
    'mix.newTargetOf': (a) => {
      const s = objArg(a, 'state');
      return has(a, 'size') ? mix.newTargetOf(s, policyOf(a).groupMix, finite(a.size, 'size')) : mix.newTargetOf(s, policyOf(a).groupMix);
    },
    'mix.planGroup': (a) => {
      const args = {
        size: finite(required(a, 'size'), 'size'),
        budget: finite(required(a, 'budget'), 'budget'),
        due: strArr(a, 'due').map((key) => ({ key })),
        early: strArr(a, 'early'),
        isWarm,
        warmNext: has(a, 'warmNext') ? (a.warmNext === null ? null : str(a, 'warmNext')) : null,
        warmOk: optBool(a, 'warmOk') === true,
        state: objArg(a, 'state'),
        mix: policyOf(a).groupMix,
      };
      for (const k of ['newAvailable', 'reserve', 'pressureSize', 'newCap']) if (has(a, k)) args[k] = finite(a[k], k);
      return mix.planGroup(args);
    },
    'mix.arrangeGroup': (a) => mix.arrangeGroup({
      warmNew: has(a, 'warmNew') && a.warmNew !== null ? str(a, 'warmNew') : null,
      revKeys: strArr(a, 'revKeys'), earlyKeys: strArr(a, 'earlyKeys'), newKeys: strArr(a, 'newKeys'), isWarm,
    }),
    'mix.dueReviewsDoneOn': (a) => mix.dueReviewsDoneOn(arrOfObj(a, 'records'), str(a, 'today'), { sched: schedArg(a, 'sched'), policy: policyOf(a) }),
    'mix.newUserCapOf': (a) => mix.newUserCapOf(mix.practiceStats(arrOfObj(a, 'records'), str(a, 'today'), { policy: policyOf(a), isWarm }), policyOf(a).newUserRamp, finite(required(a, 'size'), 'size'), policyOf(a).groupMix),
    'mix.warmupAllowed': (a) => mix.warmupAllowed(mix.practiceStats(arrOfObj(a, 'records'), str(a, 'today'), { policy: policyOf(a), isWarm }), policyOf(a).warmup),

    // ---- sessions.js ----
    'sessions.createSession': (a) => sessions.createSession({ id: opt(a, 'id'), kind: opt(a, 'kind'), source: opt(a, 'source'), queue: opt(a, 'queue'), at: opt(a, 'at') }),
    'sessions.currentCardKey': (a) => orNull(sessions.currentCardKey(objArg(a, 'session'))),
    'sessions.remaining': (a) => {
      const s = objArg(a, 'session');
      return { keys: sessions.remainingKeys(s), count: sessions.remainingCount(s), complete: sessions.isComplete(s), judged: sessions.judgedItems(s) };
    },
    'sessions.withCurrent': (a) => sessions.withCurrent(objArg(a, 'session'), opt(a, 'patch'), opt(a, 'at')),
    'sessions.advance': (a) => sessions.advance(objArg(a, 'session'), {
      cardKey: opt(a, 'cardKey'), recordId: opt(a, 'recordId'), kind: opt(a, 'kind'), fsrsBefore: opt(a, 'fsrsBefore'), at: opt(a, 'at'),
    }),
    'sessions.markLineChanged': (a) => sessions.markLineChanged(objArg(a, 'session'), opt(a, 'recordId')),
    'sessions.clearLine': (a) => sessions.clearLine(objArg(a, 'session')),
    'sessions.undoSkip': (a) => sessions.undoSkip(objArg(a, 'session'), opt(a, 'recordId'), opt(a, 'at')),
    'sessions.fsrsBeforeOf': (a) => orNull(sessions.fsrsBeforeOf(objArg(a, 'session'), opt(a, 'recordId'))),
    'sessions.canCorrect': (a) => sessions.canCorrect(objArg(a, 'session'), opt(a, 'recordId')),
    'sessions.startInSlot': (a) => sessions.startInSlot(objArg(a, 'sessions'), objArg(a, 'session')),
    'sessions.endSlot': (a) => sessions.endSlot(objArg(a, 'sessions'), str(a, 'slot'), { at: opt(a, 'at'), early: optBool(a, 'early') === true }),
    'sessions.clearLastEnded': (a) => sessions.clearLastEnded(objArg(a, 'sessions'), str(a, 'slot')),
    'sessions.resumeLines': (a) => sessions.resumeLines(objArg(a, 'sessions')),
    'sessions.s02Prompt': (a) => sessions.s02Prompt(objArg(a, 'sessions')),
    'sessions.endAndStartPicked': (a) => sessions.endAndStartPicked(objArg(a, 'sessions'), objArg(a, 'session'), { at: opt(a, 'at'), policy: policyOf(a) }),
    'sessions.expireDaily': (a) => {
      const r = sessions.expireDaily(objArg(a, 'sessions'), required(a, 'today'), policyOf(a));
      return { sessions: r.sessions, expired: r.expired, expiredAll: r.expiredAll };
    },
    'sessions.recoverSession': (a) => {
      const r = sessions.recoverSession(objArg(a, 'session'), arrOfObj(a, 'records'));
      return { session: r.session, recovered: r.recovered };
    },
    'sessions.nextAKind': (a) => sessions.nextAKind(arrOfObj(a, 'records'), { policy: policyOf(a), everPracticed: optBool(a, 'everPracticed') === true }),
    'sessions.selectFirst': (a) => sessions.selectFirst(policyOf(a)),
    'sessions.wrongReserveOf': (a) => sessions.wrongReserveOf(finite(required(a, 'size'), 'size'), policyOf(a)),
    'sessions.skipDeferredNewKeys': (a) => [...sessions.skipDeferredNewKeys(arrOfObj(a, 'records'), str(a, 'today'), policyOf(a))],
    'sessions.selectDaily': (a) => {
      const args = {
        sched: schedArg(a, 'sched'), records: arrOfObj(a, 'records'), today: str(a, 'today'),
        newCandidates: optStrArr(a, 'newCandidates') || [], warmupCandidates: optStrArr(a, 'warmupCandidates') || [],
        custom: has(a, 'custom') ? objArg(a, 'custom') : null, policy: policyOf(a),
        capitalDeferredDay: has(a, 'capitalDeferredDay') ? a.capitalDeferredDay : null, groupSize: has(a, 'groupSize') ? a.groupSize : null,
      };
      const p = practicableOf(a);
      if (p) args.practicable = p;
      return sessions.selectDaily(args);
    },
    'sessions.specialPlan': (a) => {
      const args = {
        sched: schedArg(a, 'sched'), records: arrOfObj(a, 'records'), today: str(a, 'today'), policy: policyOf(a),
        capitalDeferredDay: has(a, 'capitalDeferredDay') ? a.capitalDeferredDay : null, groupSize: has(a, 'groupSize') ? a.groupSize : null,
      };
      const p = practicableOf(a);
      if (p) args.practicable = p;
      return sessions.specialPlan(args);
    },

    // ---- new-order.js / special.js / group-size.js ----
    'newOrder.orderNewKeys': (a) => newOrder.orderNewKeys(strArr(a, 'keys')),
    'newOrder.warmupKeys': (a) => newOrder.warmupKeys(strArr(a, 'keys')),
    'newOrder.facts': (a) => {
      const ch = str(a, 'char');
      return { reserved: newOrder.isReservedChar(ch), warmup: newOrder.isWarmupChar(ch), capital: newOrder.isCapitalChar(ch), warmupKey: newOrder.isWarmupKey('base:' + ch) };
    },
    'newOrder.capital': () => ({ groups: newOrder.capitalGroupKeys(), after: newOrder.capitalAfterKeys() }),
    'newOrder.isCapitalQueue': (a) => newOrder.isCapitalQueue(required(a, 'queue')),
    'special.capitalProgress': (a) => special.capitalProgress(arrOfObj(a, 'records'), policyOf(a)),
    'special.capitalAfterKeysFor': (a) => special.capitalAfterKeysFor(arrOfObj(a, 'records'), policyOf(a)),
    'special.isDeferred': (a) => special.isDeferred(opt(a, 'deferredDay'), opt(a, 'today')),
    'groupSize.of': (a) => orNull(groupSize.groupSizeOf(opt(a, 'settings'), policyOf(a))),
    'groupSize.valid': (a) => orNull(groupSize.validGroupSize(opt(a, 'value'), policyOf(a))),
    'groupSize.dailyReviewCapOf': (a) => groupSize.dailyReviewCapOf(opt(a, 'size'), policyOf(a)),
    'groupSize.listDefaultSelectOf': (a) => {
      const n = groupSize.listDefaultSelectOf(opt(a, 'settings'), policyOf(a));
      return n === Infinity ? 'Infinity' : n;
    },

    // ---- spread.js ----
    'spread.spreadDue': (a) => spread.spreadDue(schedArg(a, 'sched'), { today: str(a, 'today'), perDay: finite(required(a, 'perDay'), 'perDay') }),
    'spread.returnSpreadPerDay': (a) => spread.returnSpreadPerDay(opt(a, 'settings'), policyOf(a)),
    'spread.returnSpreadPlan': (a) => spread.returnSpreadPlan(objArg(a, 'state'), required(a, 'today'), policyOf(a)),

    // ---- hints.js ----
    'hints.quota': (a) => hints.hintQuota(required(a, 'totalStrokes')),
    'hints.facts': (a) => {
      const input = objArg(a, 'input');
      const safe = (fn) => {
        try {
          return { ok: true, value: orNull(fn()) };
        } catch (error) {
          return { ok: false, error: error instanceof RangeError ? 'range' : 'error' };
        }
      };
      return {
        mode: hints.hintMode(input),
        given: safe(() => hints.hintsGiven(input)),
        segments: safe(() => hints.hintSegments(input)),
        remaining: safe(() => hints.hintsRemaining(input)),
        allGiven: safe(() => hints.hintsAllGiven(input)),
        next: safe(() => hints.nextHintRange(input)),
      };
    },
    'hints.button': (a) => {
      const st = hints.hintButtonState(objArg(a, 'input'));
      return { state: st, copy: hints.hintButtonCopy(st) };
    },

    // ---- correct.js ----
    'correct.findFsrsBefore': (a) => orNull(correct.findFsrsBefore(objArg(a, 'sessions'), opt(a, 'recordId'))),
    'correct.schedAfterCorrection': (a) => {
      const args = { records: arrOfObj(a, 'records'), recordId: opt(a, 'recordId'), policy: policyOf(a) };
      if (has(a, 'fsrsBefore')) args.fsrsBefore = a.fsrsBefore;
      if (has(a, 'stoppedAt')) args.stoppedAt = a.stoppedAt;
      return correct.schedAfterCorrection(args);
    },

    // ---- session-start.js（读）----
    'start.recordsOf': (a) => start.recordsOf(stateArg(a)),
    'start.aStartInfo': (a) => start.aStartInfo(stateArg(a), { policy: policyOf(a) }),
    'start.planDaily': (a) => start.planDaily(stateArg(a), { today: str(a, 'today'), deck: deckOf(a), policy: policyOf(a) }),
    'start.planSpecial': (a) => start.planSpecial(stateArg(a), { today: str(a, 'today'), deck: deckOf(a), policy: policyOf(a) }),
    'start.s02Data': (a) => start.s02Data(stateArg(a)),
    'start.resumableSession': (a) => start.resumableSession(stateArg(a), str(a, 'slot'), { now: finite(required(a, 'now'), 'now'), policy: policyOf(a) }),
    'schedDeck.facts': (a) => {
      const d = realDeck();
      const lib = has(a, 'libraryId') ? a.libraryId : null;
      return { newCandidates: d.newCandidates(lib).slice(0, 40), newCount: d.newCandidates(lib).length, warmup: d.warmupCandidates(lib), current: d.currentLibraryId(opt(a, 'settings')) };
    },
    'schedDeck.practicable': (a) => realDeck().practicable(required(a, 'key')),

    // ---- session-start.js（提交，内存假 store）----
    'start.expireStale': (a) => runStore(a, (store, now) => start.expireStale(store, { now, policy: policyOf(a) })),
    'start.resumeSlot': (a) => runStore(a, (store, now) => start.resumeSlot(store, str(a, 'slot'), { now, policy: policyOf(a) })),
    'start.startFirst': (a) => runStore(a, (store, now) => start.startFirst(store, { now, source: sourceOf(a), policy: policyOf(a) })),
    'start.startDaily': (a) => runStore(a, (store, now) => start.startDaily(store, { now, deck: deckOf(a), source: sourceOf(a), policy: policyOf(a) })),
    'start.startNextA': (a) => runStore(a, (store, now) => start.startNextA(store, { now, deck: deckOf(a), source: sourceOf(a), policy: policyOf(a) })),
    'start.startPicked': (a) => runStore(a, (store) => start.startPicked(store, { keys: required(a, 'keys'), source: sourceOf(a), deck: has(a, 'deck') ? deckOf(a) : null })),
    'start.endOldAndStartPicked': (a) => runStore(a, (store) => start.endOldAndStartPicked(store, { keys: required(a, 'keys'), source: sourceOf(a), deck: has(a, 'deck') ? deckOf(a) : null, policy: policyOf(a) })),
    'start.deferSpecial': (a) => runStore(a, (store, now) => start.deferSpecial(store, { now })),
  };
}
