// 提醒内容的纯计算（B3.10：从 src/platform/reminder.js 挪来；会话层不许 import 网页 / 平台层，所以挪进 core）。
//
// 提醒的题目（P48）：从今天起 REMINDER_DAYS 天，每天取「到那天为止已到期」的字（sched.due ≤ 那天、没有 stoppedAt、题库里能练、
//   有语境词语和拼音），按 policy.reminderPick='wrong-then-overdue' 写错过优先，其次到期最久，再按最近一次记录先后。
// 通知标题「{词语}（{拼音}）」、正文沿旧句（copy X-REMIND）；词语按 policy.reminderWord（'blank'：目标字位换成 ＿）。
//
// 网页路径（platform/reminder.js 的 syncReminder → 原生壳）与原生路径（App API 的 reminder.plan → 原生页自己排）算的是同一份内容：
//   reminderPayload 给拼好的句子（网页桥要的就是句子），reminderPayloadRefs 给文案引用（原生用 ShiziCopy 渲染）。

import * as defaultPolicy from '../config/policy.js';
import { ref, t } from '../config/copy/index.js';
import { addDays, isValidDay, localDay } from './dates.js';
import { compareRecordIds, isJudged, todayCount } from './records.js';
import { recordsOf } from './session-start.js';
import { cardForKey, hasContextWord, isPracticable, withWordOff } from '../data/deck.js';

/**
 * 提醒题目的文案引用版（B3.10，原生路径）：标题 / 正文给「键 + 参数」，原生用 ShiziCopy 渲染；
 * 与 reminderQuestion 拼好的句子一字不差（同一个 copy 键、同一组参数）。
 */
export function reminderQuestionRefs(item, day, { policy = defaultPolicy } = {}) {
  const py = String(item.card.py || '').trim();
  return {
    day,
    title: ref('X-REMIND.title', { word: maskedWord(item.card, policy), pinyin: py }),
    body: ref('X-REMIND.body'),
    targetCardKey: item.cardKey,
  };
}

/**
 * syncReminder 消息体的引用版（B3.10，原生路径）：{enabled, hour, minute, practicedToday, questions[{day, title, body, targetCardKey}]}。
 * 提醒关着时不算题目（questions 为空）。
 */
export function reminderPayloadRefs(state, { remind = null, today, now = null, deck, policy = defaultPolicy } = {}) {
  const r = remind || remindOf(state && state.settings, policy);
  const enabled = r.enabled === true;
  const questions = enabled
    ? reminderPicks(state, { today, deck, policy }).map(({ item, day }) => reminderQuestionRefs(item, day, { policy }))
    : [];
  return {
    enabled,
    hour: r.hour,
    minute: r.minute,
    practicedToday: todayCount(recordsOf(state), fireDayOf(now, r, today, policy)) > 0,
    questions,
  };
}

/** 一次同步带几天的题目（今天 + 原生 7 天窗口；沿旧版 reminderQuestions(count=8)）。 */
export const REMINDER_DAYS = 8;

const PERMISSIONS = ['granted', 'denied', 'unknown'];

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

/** 题面词语：policy.reminderWord='blank' 时目标字位（含同一目标字的其他位置）换成 policy.reminderBlank（＿）；'word' 时整词。 */
export function maskedWord(card, policy = defaultPolicy) {
  const chars = Array.isArray(card.chars) ? card.chars : Array.from(String(card.word || ''));
  if (policy.reminderWord === 'word') return chars.join('');
  const glyph = typeof policy.reminderBlank === 'string' && policy.reminderBlank ? policy.reminderBlank : defaultPolicy.reminderBlank;
  return chars.map(ch => (ch === card.target ? glyph : ch)).join('');
}

/** 题库缺省取法（网页路径与原生路径同一份）。 */
export function defaultDeck() {
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
 * 从 today 起 count 天的**选题**（每天至多一道；那天没有到期字就没有）：[{item, day}]。
 * reminderQuestions（拼句子）与 reminderPayloadRefs（给文案引用）用同一份选题（P48：每天至多一道，尽量不重复）。
 * @param {object} state  store 状态
 * @param {{today:string, count?:number, deck?:object, policy?:object}} o
 */
export function reminderPicks(state, { today, count = REMINDER_DAYS, deck, policy = defaultPolicy } = {}) {
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
    out.push({ item: pick, day });
  }
  return out;
}

/**
 * 从 today 起 count 天的题目（每天至多一道；那天没有到期字就没有）。
 * @param {object} state  store 状态
 * @param {{today:string, count?:number, deck?:object, policy?:object}} o
 */
export function reminderQuestions(state, { today, count = REMINDER_DAYS, deck, policy = defaultPolicy } = {}) {
  return reminderPicks(state, { today, count, deck, policy }).map(({ item, day }) => reminderQuestion(item, day, { policy }));
}

/**
 * 原生「今天」那次提醒归到哪一天（D66 ⑦）：日历上的今天 hour:minute 这一刻的 localDay。没给 now（测试 / 旧调用）时就是 today。
 * 提醒时刻在凌晨 4 点以后（常见）= 日历上的今天；凌晨 1 点同步时 today 还是前一天，而今晚的提醒属于新的一天。
 */
export function fireDayOf(now, remind, today, policy = defaultPolicy) {
  if (typeof now !== 'number' || !Number.isFinite(now) || !remind) return today;
  const d = new Date(now);
  const fire = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(remind.hour) || 0, Number(remind.minute) || 0);
  return localDay(fire.getTime(), policy);
}

/**
 * syncReminder 消息体（不含 type）：{enabled, hour, minute, practicedToday, questions}。
 * 提醒关着时不算题目（questions 为空）。
 */
export function reminderPayload(state, { remind = null, today, now = null, deck, policy = defaultPolicy } = {}) {
  const r = remind || remindOf(state && state.settings, policy);
  const enabled = r.enabled === true;
  return {
    enabled,
    hour: r.hour,
    minute: r.minute,
    practicedToday: todayCount(recordsOf(state), fireDayOf(now, r, today, policy)) > 0,
    questions: enabled ? reminderQuestions(state, { today, deck, policy }) : [],
  };
}
