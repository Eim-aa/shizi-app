// 练习提醒（01-架构设计 §8.1；02 M5-5；03 P18 / P47 / P48 / P86；04 R-S01 / R-S02；reference/F-platform §3）。
//
// 原生是无状态执行器（WebViewController.syncReminder）：每次同步清掉自己排的通知，按页面下发的
// {enabled, hour, minute, practicedToday, questions[{day, title, body, targetCardKey}]} 重排接下来 7 天（今天已练或已过点跳过今天，
// 没有题目的日子不发），并在排之前以本机实际授权为准。页面只管算内容：
//   - 时间：用户在设置页选的 settings.remind.hour/minute（P18，缺省 policy.remindDefault）；
//   - 题目：从今天起 REMINDER_DAYS 天，每天取「到那天为止已到期」的字（sched.due ≤ 那天、没有 stoppedAt、题库里能练、
//     有语境词语和拼音），按 P48（policy.reminderPick='wrong-then-overdue'）写错过优先（最近一次 judged 为写错，K15），
//     其次到期最久（due 早的在前），再按最近一次记录先后；已被前几天用过的字尽量不重复（全被用过时沿旧版取第一个）。
//     通知标题「{词语}（{拼音}）」、正文沿旧句（copy X-REMIND，P48 待文案）；词语按 policy.reminderWord（过渡 'blank'：目标字位换成 □，
//     与写字页题面一样不露答案，决定-D16）。
//   - practicedToday：今天有没有 judged 记录（旧版 dailyActivity().stamps>0 的第十稿口径）。
//   - enabled：用户的开关（settings.remind.enabled）。权限由原生在排之前核对（web 侧 permission 可能来自备份，P86）。
// 同步时机：设置页开 / 关 / 改时间（settings.js syncReminder → 本模块，force）；原生回报权限变化（applyReminderStatus）；
//   启动（提醒开着时先 queryReminderStatus 再同步）；store 变化（判断 / 更正 / 恢复备份等改了到期字或今天是否已练，
//   300ms 去抖，内容与上次发出的相同不重发）；回到前台（跨天后题目的日子要重算，并再查一次权限——用户可能刚在手机设置里改过）。
//   不在原生壳内一律不发（postNative 返回 false）。
//
// 原生 → 页面（bridge.registerNativeHandler，startReminder 注册）：
//   shiziReminderStatus({permission})  → 设置页 applyReminderStatus（写 settings.remind.permission，变了才写，写后同步）
//   shiziOpenReminderTarget(cardKey)   → P47（policy.reminderOpens='picked-s02'）：以「这次选的字」（B）开这个字，
//                                        旧 B 没写完时走 S02（session/index.js startPicked，与查字 / 单字详情同一入口）。
//                                        冷启动时原生在页面加载完就调用：桥在 store / 界面就绪前把调用排队（只留最后一个 cardKey），
//                                        startReminder 注册实现并 markReady 后回放。
//                                        深链优先于冷启动恢复（审查整改 F1）：排着队时不恢复；就绪后才到（iOS 等 pageReady 再派发）
//                                        且恢复后还没动过 → 先静默回首页再开组（ui/route-memory.js runDeepLink）。

import { bridge as defaultBridge } from './bridge.js';
import { now as envNow } from './env.js';
import * as defaultPolicy from '../config/policy.js';
import { t } from '../config/copy/index.js';
import { addDays, isValidDay, localDay } from '../core/dates.js';
import { compareRecordIds, isJudged, todayCount } from '../core/records.js';
import { recordsOf } from '../core/session-start.js';
import { cardForKey, hasContextWord, isPracticable, withWordOff } from '../data/deck.js';

/** 一次同步带几天的题目（今天 + 原生 7 天窗口；沿旧版 reminderQuestions(count=8)）。 */
export const REMINDER_DAYS = 8;
/** store 变化后重新同步的去抖（ms）。 */
export const RESYNC_DELAY_MS = 300;
/** 通知点开时开组的来源（sessions.B.source.view；结果页离开按钮按未知来源回首页，来源说明按「自己选的」）。 */
export const REMINDER_SOURCE_VIEW = 'reminder';

const PERMISSIONS = ['granted', 'denied', 'unknown'];
const BLANK = '□'; // copy X-PROMPT.repeatBlankGlyph（取自 copy，见 maskedWord）

function parseTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** settings → 提醒设置（补缺省；与设置页 settingsView().remind 同口径）。 */
export function remindOf(settings, policy = defaultPolicy) {
  const r = (settings && settings.remind) || {};
  const def = parseTime(policy.remindDefault) || { hour: 20, minute: 0 };
  return {
    enabled: r.enabled === true,
    hour: Number.isInteger(r.hour) ? r.hour : def.hour,
    minute: Number.isInteger(r.minute) ? r.minute : def.minute,
    permission: PERMISSIONS.indexOf(r.permission) >= 0 ? r.permission : 'unknown',
  };
}

/** 'base:字' / 'custom:字' / 单字 → cardKey；认不出返回 null。 */
export function normalizeTargetKey(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().normalize('NFC');
  const m = /^(base|custom):(.+)$/.exec(text);
  const body = m ? m[2] : text;
  if (Array.from(body).length !== 1) return null;
  return `${m ? m[1] : 'base'}:${body}`;
}

/** 题面词语：policy.reminderWord='blank' 时目标字位（含同一目标字的其他位置）换成 □；'word' 时整词。 */
export function maskedWord(card, policy = defaultPolicy) {
  const chars = Array.isArray(card.chars) ? card.chars : Array.from(String(card.word || ''));
  if (policy.reminderWord === 'word') return chars.join('');
  let glyph = BLANK;
  try {
    glyph = t('X-PROMPT.repeatBlankGlyph') || BLANK;
  } catch (error) {
    glyph = BLANK;
  }
  return chars.map(ch => (ch === card.target ? glyph : ch)).join('');
}

function defaultDeck() {
  return { cardFor: cardForKey, practicable: isPracticable };
}

/**
 * 能进提醒的字（与日子无关的部分），按 P48 排好：写错过在前 → due 早的在前 → 最近一次记录早的在前 → cardKey。
 * @returns {Array<{cardKey, due, wrong, card}>}
 */
export function reminderCandidates(state, { deck = defaultDeck(), policy = defaultPolicy } = {}) {
  if (policy.reminderPick !== 'wrong-then-overdue') {
    throw new RangeError('unsupported policy.reminderPick: ' + String(policy.reminderPick));
  }
  const sched = (state && state.sched) || {};
  const wordOff = (state && state.wordOff) || null;
  const latest = new Map();
  for (const r of recordsOf(state)) {
    if (!isJudged(r)) continue;
    const prev = latest.get(r.cardKey);
    if (!prev || compareRecordIds(prev.id, r.id) < 0) latest.set(r.cardKey, r);
  }
  const out = [];
  for (const cardKey of Object.keys(sched)) {
    const entry = sched[cardKey];
    if (!entry || entry.stoppedAt !== undefined || !isValidDay(entry.due)) continue;
    if (!deck.practicable(cardKey)) continue;
    const card = withWordOff(deck.cardFor(cardKey), wordOff);
    if (!card || !hasContextWord(card) || !String(card.py || '').trim()) continue;
    const last = latest.get(cardKey) || null;
    out.push({ cardKey, due: entry.due, wrong: !!last && last.judgment === 'wrong', lastId: last ? last.id : null, card });
  }
  out.sort((a, b) => (a.wrong === b.wrong ? 0 : a.wrong ? -1 : 1)
    || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)
    || (a.lastId && b.lastId ? compareRecordIds(a.lastId, b.lastId) : a.lastId ? -1 : b.lastId ? 1 : 0)
    || (a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0));
  return out.map(({ cardKey, due, wrong, card }) => ({ cardKey, due, wrong, card }));
}

/** 一道提醒题：{day, title, body, targetCardKey}（原生 ReminderQuestion 四个字段都要非空）。 */
export function reminderQuestion(item, day, { policy = defaultPolicy } = {}) {
  const py = String(item.card.py || '').trim();
  return {
    day,
    title: t('X-REMIND.title', { word: maskedWord(item.card, policy), pinyin: py }),
    body: t('X-REMIND.body'),
    targetCardKey: item.cardKey,
  };
}

/**
 * 从 today 起 count 天的题目（每天至多一道；那天没有到期字就没有）。
 * @param {object} state  store 状态
 * @param {{today:string, count?:number, deck?:object, policy?:object}} o
 */
export function reminderQuestions(state, { today, count = REMINDER_DAYS, deck, policy = defaultPolicy } = {}) {
  if (!isValidDay(today)) throw new RangeError('reminderQuestions: invalid today ' + String(today));
  const all = reminderCandidates(state, { deck, policy });
  const used = new Set();
  const out = [];
  for (let offset = 0; offset < count; offset += 1) {
    const day = addDays(today, offset);
    const candidates = all.filter(c => c.due <= day);
    if (!candidates.length) continue;
    const pick = candidates.find(c => !used.has(c.cardKey)) || candidates[0];
    used.add(pick.cardKey);
    out.push(reminderQuestion(pick, day, { policy }));
  }
  return out;
}

/**
 * syncReminder 消息体（不含 type）：{enabled, hour, minute, practicedToday, questions}。
 * 提醒关着时不算题目（questions 为空）。
 */
export function reminderPayload(state, { remind = null, today, deck, policy = defaultPolicy } = {}) {
  const r = remind || remindOf(state && state.settings, policy);
  const enabled = r.enabled === true;
  return {
    enabled,
    hour: r.hour,
    minute: r.minute,
    practicedToday: todayCount(recordsOf(state), today) > 0,
    questions: enabled ? reminderQuestions(state, { today, deck, policy }) : [],
  };
}

// ---------------------------------------------------------------- 运行时（页面内唯一一份）

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * 建一个提醒控制器（测试可注入全部依赖；页面用 startReminder）。
 * @param {{getStore:Function, bridge?:object, win?:object, now?:Function, deck?:object, policy?:object,
 *          startPicked?:Function, applyReminderStatus?:Function}} deps
 */
export function createReminder(deps) {
  const b = deps.bridge || defaultBridge;
  const win = deps.win === undefined ? globalWin() : deps.win;
  const nowFn = deps.now || envNow;
  const policy = deps.policy || defaultPolicy;
  let lastSent = null; // 上次发出的消息体 JSON
  let timer = null;
  const sent = [];

  function state() {
    try {
      const store = deps.getStore();
      return store ? store.getState() : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 算好并发给原生。force=false 时内容与上次相同不发；从没发过且提醒关着也不发（没有要清的）。
   * 返回发出的消息体，没发返回 null。
   */
  function sync({ remind = null, force = false } = {}) {
    const st = state();
    if (!st) return null;
    let payload;
    try {
      payload = reminderPayload(st, { remind, today: localDay(nowFn()), deck: deps.deck, policy });
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[shizi] reminder content failed:', error);
      return null;
    }
    const json = JSON.stringify(payload);
    if (!force && (json === lastSent || (lastSent === null && !payload.enabled))) return null;
    if (!b.postNative('syncReminder', payload)) return null;
    lastSent = json;
    sent.push(payload);
    if (sent.length > 20) sent.shift();
    return payload;
  }

  function scheduleSync() {
    if (!b.isNative()) return;
    const setT = win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
    const clearT = win && typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
    if (timer !== null) clearT(timer);
    timer = setT(() => {
      timer = null;
      sync();
    }, RESYNC_DELAY_MS);
  }

  function queryStatus() {
    return b.postNative('queryReminderStatus', {});
  }

  function receiveStatus(payload) {
    const store = (() => {
      try {
        return deps.getStore();
      } catch (error) {
        return null;
      }
    })();
    if (!store || typeof deps.applyReminderStatus !== 'function') return null;
    return deps.applyReminderStatus(store, payload);
  }

  /** P47：以 B 开这个字（旧 B 没写完走 S02）。返回 startPicked 的结果，认不出 / 不能练返回 {ok:false}。 */
  function openTarget(raw) {
    const cardKey = normalizeTargetKey(raw);
    const deck = deps.deck || defaultDeck();
    if (!cardKey || !deck.practicable(cardKey)) {
      if (typeof console !== 'undefined') console.warn('[shizi] reminder target is not practicable:', raw);
      return { ok: false, error: { kind: 'invalid', reason: 'target' } };
    }
    if (policy.reminderOpens !== 'picked-s02') {
      if (typeof console !== 'undefined') console.warn('[shizi] unsupported policy.reminderOpens:', policy.reminderOpens);
      return { ok: false, error: { kind: 'invalid', reason: 'policy' } };
    }
    const char = cardKey.slice(cardKey.indexOf(':') + 1);
    return deps.startPicked([cardKey], { source: { view: REMINDER_SOURCE_VIEW, char } });
  }

  return {
    sync,
    scheduleSync,
    queryStatus,
    receiveStatus,
    openTarget,
    /** 最近发出的 syncReminder 消息体（测试 / 诊断）。 */
    sent: () => sent.slice(),
    /** 忘掉上次发出的内容（下一次非 force 同步照发）。 */
    forget() {
      lastSent = null;
    },
  };
}

// 会改变提醒内容的写入：记录（今天是否已练、写错过）、sched（到期）、settings（开关 / 时间）、wordOff（词语）。
// 抬笔写会话现场（sessions）等不重算。整体替换（load / 恢复备份 / seed）一律重算。
const REMINDER_KEY = /^shizi\.v2\.(records|sched|settings|wordOff)(\.|$)/;

/** store 通知是否可能改变提醒内容。 */
export function affectsReminder(info) {
  if (!info) return false;
  if (info.type === 'load' || info.replace === true) return true;
  if (info.type !== 'commit' && info.type !== 'recover') return false;
  return Array.isArray(info.keys) && info.keys.some(key => REMINDER_KEY.test(String(key)));
}

let running = null; // {controller, off, store}

/**
 * 启动（app.js 在界面挂好之后调用一次；幂等）：
 *   1. 注册 shiziReminderStatus / shiziOpenReminderTarget 的实现；把设置页的同步换成带题目的实现（setReminderSync）；
 *   2. bridge.markReady(store)：回放 store / 界面就绪前到达的原生调用（冷启动深链在这里执行）；
 *   3. 原生壳内且提醒开着：queryReminderStatus + 同步一次；之后 store 变化去抖同步、回到前台再查权限并同步。
 * @returns {Promise<object>} 控制器
 */
export async function startReminder({ win = globalWin(), bridge: b = defaultBridge } = {}) {
  if (running) return running.controller;
  const [{ getStore }, settings, session, routeMemory] = await Promise.all([
    import('../store/store.js'),
    import('../ui/screens/mine/settings.js'),
    import('../ui/screens/session/index.js'),
    import('../ui/route-memory.js'),
  ]);
  if (running) return running.controller;
  const controller = createReminder({
    getStore, bridge: b, win,
    startPicked: session.startPicked,
    applyReminderStatus: settings.applyReminderStatus,
  });
  settings.setReminderSync(remind => {
    controller.sync({ remind, force: true });
  });
  b.registerNativeHandler('shiziReminderStatus', payload => controller.receiveStatus(payload));
  // 审查整改 F1：深链压过冷启动恢复的页面栈（恢复后还没动过 → 先静默回首页再开组，见 ui/route-memory.js）。
  b.registerNativeHandler('shiziOpenReminderTarget', key => routeMemory.runDeepLink(() => controller.openTarget(key)));

  let store = null;
  try {
    store = getStore();
  } catch (error) {
    store = null;
  }
  const off = store ? store.subscribe((next, info) => {
    if (affectsReminder(info)) controller.scheduleSync();
  }) : () => {};
  running = { controller, off, store };
  b.markReady(store);

  if (b.isNative()) {
    const enabled = store ? remindOf(store.getState() && store.getState().settings).enabled : false;
    if (enabled) {
      controller.queryStatus();
      controller.sync();
    }
    const doc = win && win.document;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState !== 'visible') return;
        let on = false;
        try {
          on = remindOf(getStore().getState().settings).enabled;
        } catch (error) {
          on = false;
        }
        if (!on) return;
        controller.queryStatus();
        controller.scheduleSync();
      });
    }
  }
  return controller;
}

/** 当前页面的提醒控制器（startReminder 之前为 null；测试 / 诊断用）。 */
export function reminderController() {
  return running ? running.controller : null;
}
