// 调度模拟器的「规则适配层」（B4.2；计划 §4.3 ③，挂点说明见 engine-select.mjs）。engine.mjs 里所有会改状态的规则调用都经这里：
//   开组前过期 expireStale、下一组是首练还是日常 aStartInfo、今日计划 planDaily、开组 startNextA / startPicked、
//   判断 commitJudgment、跳过 commitSkip / 撤销 commitUndoSkip、看答案 commitAnswerSeen / commitAnswerNext、结果页改判 commitResultCorrection。
// 只读的统计与不变量（overdueDays、三档、提醒题目、invariants.mjs）仍在 JS 上算——它们是「量」，不是被测的规则；
// swift 模式下它们量的是 Swift 算出来的状态，所以 27 条不变量对 Swift 同样成立才算过。
//
//   js     直接调 src/ 的真实函数（缺省；与 B4.2 之前完全相同）
//   swift  同样的提交函数，但其中的规则（选字 / 开组 / FSRS 评级与间隔 / 会话推进 / 跳过撤销 / 改判重放）由 shizi-core-cli 算；
//          记录的构造与存储（records / ink / budget，B4.3 / B4.4 的范围）仍走 JS，store 仍是 JS 的真实 store。
//   both   两个 store 同步走：主 store 走 js，影子 store 走 swift；每一步后比较两边的回包与整份状态（按引用变了的域 / 月 / 调度项逐个比），
//          差异计数与样例记在 rules.diffs；模拟器的「用户」只看主 store。
import * as policy from '../../../src/config/policy.js';
import { aStartInfo, expireStale, planDaily, startNextA, startPicked } from '../../../src/core/session-start.js';
import { deckAdapter } from '../../../src/data/deck.js';
import { commitJudgment, findJudged, hasInk } from '../../../src/session/ops/judge.js';
import { canUndoSkip, commitSkip, commitUndoSkip } from '../../../src/session/ops/skip.js';
import { allRecords, appendRecordToDraft, commitAnswerNext, commitAnswerSeen, findAnswerSeen, replaceRecordInDraft, storeSelfInkInDraft } from '../../../src/session/ops/answer.js';
import { commitResultCorrection, findResultSession } from '../../../src/session/ops/result.js';
import { compareRecordIds, correctRecord, isJudged, JUDGMENTS, makeRecord, removeRecord, sortById } from '../../../src/core/records.js';
import { HINTS_SHAPE_MAX } from '../../../src/core/schema.js';
import { setInk } from '../../../src/store/store.js';
import { pruneInkOfCards } from '../../../src/store/budget.js';
import { encodeStoredInk } from '../../../src/core/ink-math.js';
import { openSyncSwift } from './sync-engine.mjs';

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });
const EMPTY = Object.freeze({ ok: false, error: Object.freeze({ kind: 'empty-strokes' }) });

const sessionOf = (state, slot) => (state && state.sessions ? state.sessions[slot] || null : null);
const setSession = (draft, slot, session) => {
  draft.sessions = { ...draft.sessions, [slot]: session };
};
const nowOf = (now) => (typeof now === 'function' ? now() : now);

// ---------------------------------------------------------------- js

export function jsRules() {
  return {
    kind: 'js',
    expireStale: (store, o) => expireStale(store, o),
    aStartInfo: (store) => aStartInfo(store.getState()),
    planDaily: (store, { today }) => planDaily(store.getState(), { today, deck: deckAdapter, policy }),
    startNextA: (store, { now }) => startNextA(store, { now, deck: deckAdapter }),
    startPicked: (store, { keys }) => startPicked(store, { keys, deck: deckAdapter }),
    commitJudgment,
    commitSkip,
    commitUndoSkip,
    commitAnswerSeen,
    commitAnswerNext,
    commitResultCorrection,
    close() {},
  };
}

// ---------------------------------------------------------------- swift

/** store 状态 → Swift 镜像的增量同步（按引用：变了的域、月份、调度项才发；墨迹不发，规则不读它）。 */
function makeMirrorSync(sw) {
  let domains = new Map();
  let months = new Map();
  let schedObj = null;
  let schedKeys = [];
  let schedEntries = new Map();
  return function sync(state) {
    const set = {};
    const drop = [];
    let records = null;
    let sched = null;
    let any = false;
    for (const k of Object.keys(state)) {
      if (k === 'ink') continue;
      const v = state[k];
      if (k === 'records') {
        const cur = v && typeof v === 'object' ? v : {};
        for (const m of Object.keys(cur)) {
          if (months.get(m) !== cur[m]) {
            (records || (records = {}))[m] = cur[m];
            months.set(m, cur[m]);
          }
        }
        for (const m of [...months.keys()]) {
          if (!Object.prototype.hasOwnProperty.call(cur, m)) {
            (records || (records = {}))[m] = null;
            months.delete(m);
          }
        }
        continue;
      }
      if (k === 'sched') {
        if (v === schedObj) continue;
        const keys = v && typeof v === 'object' ? Object.keys(v) : [];
        const appended = keys.length >= schedKeys.length && schedKeys.every((key, i) => keys[i] === key);
        if (!appended) {
          set.sched = v;
          any = true;
          schedEntries = new Map(keys.map((key) => [key, v[key]]));
        } else {
          for (const key of keys) {
            if (schedEntries.get(key) !== v[key]) {
              (sched || (sched = {}))[key] = v[key];
              schedEntries.set(key, v[key]);
            }
          }
        }
        schedObj = v;
        schedKeys = keys;
        continue;
      }
      if (domains.get(k) !== v) {
        set[k] = v;
        domains.set(k, v);
        any = true;
      }
    }
    for (const k of [...domains.keys()]) {
      if (!Object.prototype.hasOwnProperty.call(state, k)) {
        drop.push(k);
        domains.delete(k);
        any = true;
      }
    }
    if (!any && !records && !sched) return;
    const args = {};
    if (Object.keys(set).length) args.set = set;
    if (drop.length) args.drop = drop;
    if (records) args.records = records;
    if (sched) args.sched = sched;
    sw.call('mirror.patch', args);
  };
}

export function swiftRules({ now }) {
  const sw = openSyncSwift();
  // B4.4：SHIZI_SIM_STORE=core（schedule-sim --swift-store core）时，开组等提交类规则在 ShiziCore 的真 Store（ScheduleStore 的 B4.4 实现）上跑
  const core = process.env.SHIZI_SIM_STORE === 'core' ? { store: 'core' } : {};
  const sync = makeMirrorSync(sw);
  const call = (op, args) => sw.call(op, args);

  /** Swift 在内存 store 上的提交 → 同样的提交按顺序落到 JS 的真实 store（序号用同样多次 nextId 推进）。 */
  function applyCommits(store, reply) {
    let serial = store.serial;
    for (const c of reply.commits) {
      const res = store.commit(c.label, (draft, ctx) => {
        for (let i = serial; i < c.serial; i += 1) ctx.nextId('s');
        for (const k of Object.keys(c.set)) draft[k] = c.set[k];
        if (c.schedPatch) draft.sched = { ...(draft.sched || {}), ...c.schedPatch };
      });
      if (!res || !res.ok) return res;
      serial = c.serial;
    }
    return reply.result;
  }

  const currentCardKey = (session) => call('sessions.currentCardKey', { session });
  const advance = (session, o) => call('sessions.advance', { session, ...o });

  function judgeInDraft(draft, o) {
    const { slot, cardKey, judgment, strokes, at, nextId } = o;
    if (!JUDGMENTS.includes(judgment)) throw new RangeError('judge: judgment must be correct or wrong');
    if (!hasInk(strokes)) throw new RangeError('judge: no strokes of the learner');
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('judge: not the current card');
    const existing = findJudged(draft, s.id, cardKey);
    if (existing) {
      setSession(draft, slot, advance(s, { cardKey, recordId: existing.id, kind: 'judged', at }));
      return { record: existing, reused: true };
    }
    const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
    const record = makeRecord({
      id: nextId('r'), cardKey, sessionId: s.id, kind: 'judged', judgment, at,
      help: { hints: Math.max(0, Math.min(HINTS_SHAPE_MAX, Math.trunc(Math.max(stored, Number(o.hints) || 0)))), answerSeen: false, traced: false },
    });
    appendRecordToDraft(draft, record);
    const inkOn = typeof o.perRecordInk === 'boolean' ? o.perRecordInk : !!(policy.features && policy.features.perRecordInk === true);
    if (inkOn) setInk(draft, record, encodeStoredInk(strokes, { policy, format: o.inkFormat }));
    pruneInkOfCards(draft, [cardKey]);
    const entry = draft.sched ? draft.sched[cardKey] : undefined;
    const seen = allRecords(draft).filter((r) => r && r.kind === 'answer-seen' && r.cardKey === cardKey);
    const args = { record, records: seen };
    if (entry !== undefined) args.entry = entry;
    const { entry: nextEntry, fsrsBefore } = call('fsrs.applyJudgment', args);
    draft.sched = { ...(draft.sched || {}), [cardKey]: nextEntry };
    setSession(draft, slot, advance(s, { cardKey, recordId: record.id, kind: 'judged', fsrsBefore, at }));
    return { record, reused: false };
  }

  return {
    kind: 'swift',
    sw,
    expireStale(store, { now: n }) {
      sync(store.getState());
      return applyCommits(store, call('start.expireStale', { state: 'mirror', now: nowOf(n), serial: store.serial, ...core }));
    },
    aStartInfo(store) {
      sync(store.getState());
      return call('start.aStartInfo', { state: 'mirror' });
    },
    planDaily(store, { today }) {
      sync(store.getState());
      return call('start.planDaily', { state: 'mirror', today });
    },
    startNextA(store, { now: n }) {
      sync(store.getState());
      return applyCommits(store, call('start.startNextA', { state: 'mirror', now: nowOf(n), serial: store.serial, ...core }));
    },
    startPicked(store, { keys }) {
      sync(store.getState());
      return applyCommits(store, call('start.startPicked', { state: 'mirror', keys, deck: 'real', now: now(), serial: store.serial, ...core }));
    },
    commitJudgment(store, { slot, cardKey, judgment, strokes, hints = 0, perRecordInk } = {}) {
      if (!hasInk(strokes)) return EMPTY;
      const s = sessionOf(store.getState(), slot);
      if (!s || currentCardKey(s) !== cardKey) return STALE;
      let out = null;
      const result = store.commit('write:judge', (draft, ctx) => {
        out = judgeInDraft(draft, { slot, cardKey, judgment, strokes, hints, at: ctx.now, nextId: ctx.nextId, perRecordInk, inkFormat: ctx.inkFormat });
      });
      return result && result.ok && out ? { ...result, record: out.record, reused: out.reused } : result;
    },
    commitSkip(store, { slot, cardKey, hints = 0 } = {}) {
      const s0 = sessionOf(store.getState(), slot);
      if (!s0 || currentCardKey(s0) !== cardKey) return STALE;
      let out = null;
      const result = store.commit('write:skip', (draft, ctx) => {
        if (policy.skipScope !== 'session' && policy.skipScope !== 'today') throw new RangeError('unsupported policy.skipScope: ' + String(policy.skipScope));
        const s = sessionOf(draft, slot);
        if (!s || currentCardKey(s) !== cardKey) throw new Error('skip: not the current card');
        const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
        const record = makeRecord({
          id: ctx.nextId('r'), cardKey, sessionId: s.id, kind: 'skipped', at: ctx.now,
          help: { hints: Math.max(0, Math.min(HINTS_SHAPE_MAX, Math.max(stored, Math.trunc(Number(hints) || 0)))), answerSeen: false, traced: false },
        });
        appendRecordToDraft(draft, record);
        setSession(draft, slot, advance(s, { cardKey, recordId: record.id, kind: 'skipped', at: ctx.now }));
        out = { record };
      });
      return result && result.ok && out ? { ...result, record: out.record } : result;
    },
    commitUndoSkip(store, { slot, sessionId, recordId, strokes } = {}) {
      if (!canUndoSkip(store.getState(), { slot, sessionId, recordId })) return STALE;
      return store.commit('write:skip-undo', (draft, ctx) => {
        const s = sessionOf(draft, slot);
        if (!s || (sessionId && s.id !== sessionId)) throw new Error('undo skip: session changed');
        const record = allRecords(draft).find((r) => r && r.id === recordId) || null;
        if (!record || record.kind !== 'skipped' || record.sessionId !== s.id) throw new Error('undo skip: skipped record not found');
        const back = call('sessions.undoSkip', { session: s, recordId, at: ctx.now });
        const month = typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
        const value = month ? draft.records[month] : null;
        if (Array.isArray(value)) draft.records[month] = removeRecord(value, record.id);
        else if (value && Array.isArray(value.kept)) draft.records[month] = { ...value, kept: removeRecord(value.kept, record.id) };
        else throw new Error('undo skip: record month not found');
        const h = record.help && Number.isInteger(record.help.hints) ? record.help.hints : 0;
        const patch = {};
        if (h) patch.hints = h;
        if (Array.isArray(strokes) && strokes.length) patch.strokes = strokes;
        setSession(draft, slot, Object.keys(patch).length ? call('sessions.withCurrent', { session: back, patch, at: ctx.now }) : back);
      });
    },
    commitAnswerSeen(store, { slot, cardKey, stay = false, hints: hintsNow, hintRange = null }) {
      const s0 = sessionOf(store.getState(), slot);
      if (!s0 || currentCardKey(s0) !== cardKey) return STALE;
      return store.commit('write:answer-seen', (draft, ctx) => {
        const s = sessionOf(draft, slot);
        if (!s || currentCardKey(s) !== cardKey) throw new Error('answer-seen: not the current card');
        const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
        const h = Math.max(stored, Number.isInteger(hintsNow) ? hintsNow : 0);
        const existing = findAnswerSeen(draft, s.id, cardKey);
        if (!existing) {
          const record = makeRecord({ id: ctx.nextId('r'), cardKey, sessionId: s.id, kind: 'answer-seen', at: ctx.now, help: { hints: h, answerSeen: true, traced: !stay } });
          appendRecordToDraft(draft, record);
          const entry = draft.sched ? draft.sched[cardKey] : undefined;
          const seen = call('fsrs.applyAnswerSeen', entry === undefined ? { record } : { entry, record });
          if (seen.applied) draft.sched = { ...(draft.sched || {}), [cardKey]: seen.entry };
        } else if (!stay && !existing.help.traced) {
          replaceRecordInDraft(draft, { ...existing, help: { ...existing.help, traced: true } });
        }
        const patch = stay
          ? { answerSeen: true, hints: h, hintRange: hintRange ? { from: hintRange.from, to: hintRange.to } : null }
          : { phase: 'trace', strokes: [], answerSeen: true, hintRange: null };
        setSession(draft, slot, call('sessions.clearLine', { session: call('sessions.withCurrent', { session: s, patch, at: ctx.now }) }));
      });
    },
    commitAnswerNext(store, { slot, cardKey, strokes, perRecordInk } = {}) {
      const s0 = sessionOf(store.getState(), slot);
      if (!s0 || currentCardKey(s0) !== cardKey) return STALE;
      return store.commit('write:answer-next', (draft, ctx) => {
        const s = sessionOf(draft, slot);
        if (!s || currentCardKey(s) !== cardKey) throw new Error('answer next: not the current card');
        storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy, inkFormat: ctx.inkFormat });
        const record = findAnswerSeen(draft, s.id, cardKey);
        const o = { cardKey, kind: 'answer-seen', at: ctx.now };
        if (record) o.recordId = record.id;
        setSession(draft, slot, advance(s, o));
      });
    },
    commitResultCorrection(store, { slot, sessionId, recordId, to } = {}) {
      const found0 = findResultSession(store.getState(), { slot, sessionId });
      if (!found0 || !call('sessions.canCorrect', { session: found0.session, recordId })) return STALE;
      let out = null;
      const result = store.commit('result:correct', (draft, ctx) => {
        const found = findResultSession(draft, { slot, sessionId });
        if (!found) throw new Error('correct: session not found');
        const s = found.session;
        if (!call('sessions.canCorrect', { session: s, recordId })) throw new Error('correct: record cannot be corrected in this session');
        const all = allRecords(draft);
        const record = all.find((r) => r && r.id === recordId) || null;
        if (!record || !isJudged(record) || record.sessionId !== sessionId) throw new Error('correct: judged record not found');
        const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
        const next = correctRecord(record, target, ctx.now);
        if (next === record) {
          out = { record };
          return;
        }
        replaceRecordInDraft(draft, next);
        const later = sortById(all.filter((r) => isJudged(r) && r.cardKey === record.cardKey && compareRecordIds(r.id, recordId) >= 0)).map((r) => (r.id === recordId ? next : r));
        const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
        const fsrsBefore = call('sessions.fsrsBeforeOf', { session: s, recordId });
        const args = { records: later };
        if (fsrsBefore !== null) args.fsrsBefore = fsrsBefore;
        if (prev && prev.stoppedAt !== undefined) args.stoppedAt = prev.stoppedAt;
        const entry = call('fsrs.replay', args);
        if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
        out = { record: next };
      });
      return result && result.ok && out ? { ...result, record: out.record } : result;
    },
    close() {
      sw.close();
    },
  };
}

// ---------------------------------------------------------------- both

/** 两个 store 同步走：读主 store，写两个都写（模拟器自己的提交——换库、换每组字数、迁移场景的导入——两边一样）。 */
export function dualStore(primary, shadow) {
  return {
    primary,
    shadow,
    getState: () => primary.getState(),
    commit(label, mutate, options) {
      const a = primary.commit(label, mutate, options);
      shadow.commit(label, mutate, options);
      return a;
    },
    get serial() {
      return primary.serial;
    },
    get status() {
      return primary.status;
    },
    subscribe: (fn) => primary.subscribe(fn),
  };
}

const json = (v) => JSON.stringify(v);
/** 回包比对时去掉 store 自己的记账（写了哪些键、旁路回收）——两边 store 是两个实例，规则相同则状态相同。 */
function comparable(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const { keys, recovered, ...rest } = v; // eslint-disable-line no-unused-vars
  return rest;
}

/** 两份状态按引用找出变了的部分逐个比（records / ink 按月、sched 按项、其余按域）。 */
function makeStateDiff() {
  const last = { a: new Map(), b: new Map() };
  const seen = (side, key, value) => {
    const m = last[side];
    const changed = m.get(key) !== value;
    m.set(key, value);
    return changed;
  };
  return function diff(a, b) {
    const out = [];
    const domains = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const d of domains) {
      const va = a[d];
      const vb = b[d];
      if ((d === 'records' || d === 'ink' || d === 'sched') && va && vb && typeof va === 'object' && typeof vb === 'object') {
        const ca = seen('a', d, va);
        const cb = seen('b', d, vb);
        if (!ca && !cb) continue;
        const ka = Object.keys(va);
        const kb = Object.keys(vb);
        if (json(ka) !== json(kb)) out.push(`${d}: 键不同（${ka.length} vs ${kb.length}）`);
        for (const k of ka) {
          const x = va[k];
          const y = vb[k];
          const cx = seen('a', d + '|' + k, x);
          const cy = seen('b', d + '|' + k, y);
          if ((cx || cy) && json(x) !== json(y)) out.push(`${d}.${k}: ${json(x).slice(0, 300)} ≠ ${json(y).slice(0, 300)}`);
        }
        continue;
      }
      const ca = seen('a', d, va);
      const cb = seen('b', d, vb);
      if ((ca || cb) && json(va) !== json(vb)) out.push(`${d}: ${String(json(va)).slice(0, 300)} ≠ ${String(json(vb)).slice(0, 300)}`);
    }
    return out;
  };
}

export function bothRules({ now }) {
  const js = jsRules();
  const sw = swiftRules({ now });
  const diffState = makeStateDiff();
  const diffs = { count: 0, steps: 0, samples: [] };
  const note = (what, detail) => {
    diffs.count += 1;
    if (diffs.samples.length < 20) diffs.samples.push(`${what}: ${detail}`);
  };
  function step(name, store, fn) {
    const a = fn(js, store.primary);
    let b;
    try {
      b = fn(sw, store.shadow);
    } catch (error) {
      note(name, 'swift 抛错 ' + error.message);
      return a;
    }
    diffs.steps += 1;
    const ra = json(comparable(a));
    const rb = json(comparable(b));
    if (ra !== rb) note(name, `回包 ${ra.slice(0, 400)} ≠ ${rb.slice(0, 400)}`);
    for (const d of diffState(store.primary.getState(), store.shadow.getState())) note(name, d);
    return a;
  }
  return {
    kind: 'both',
    diffs,
    swiftCalls: () => sw.sw.calls,
    expireStale: (store, o) => step('expireStale', store, (r, s) => r.expireStale(s, o)),
    aStartInfo: (store) => step('aStartInfo', store, (r, s) => r.aStartInfo(s)),
    planDaily: (store, o) => step('planDaily', store, (r, s) => r.planDaily(s, o)),
    startNextA: (store, o) => step('startNextA', store, (r, s) => r.startNextA(s, o)),
    startPicked: (store, o) => step('startPicked', store, (r, s) => r.startPicked(s, o)),
    commitJudgment: (store, o) => step('commitJudgment', store, (r, s) => r.commitJudgment(s, o)),
    commitSkip: (store, o) => step('commitSkip', store, (r, s) => r.commitSkip(s, o)),
    commitUndoSkip: (store, o) => step('commitUndoSkip', store, (r, s) => r.commitUndoSkip(s, o)),
    commitAnswerSeen: (store, o) => step('commitAnswerSeen', store, (r, s) => r.commitAnswerSeen(s, o)),
    commitAnswerNext: (store, o) => step('commitAnswerNext', store, (r, s) => r.commitAnswerNext(s, o)),
    commitResultCorrection: (store, o) => step('commitResultCorrection', store, (r, s) => r.commitResultCorrection(s, o)),
    /** 一天结束时整份状态再比一次（防按引用漏看）。 */
    checkFull(store, label) {
      const a = { ...store.primary.getState() };
      const b = { ...store.shadow.getState() };
      if (json(a) !== json(b)) note('fullState ' + label, '整份状态不同');
    },
    close() {
      sw.close();
    },
  };
}

/** 按名字开规则引擎。 */
export function makeRules(kind, { now }) {
  if (kind === 'swift') return swiftRules({ now });
  if (kind === 'both') return bothRules({ now });
  return jsRules();
}
