// 结果页（M2-3；决定-D18 / D19 / D20 / D22；01 §3.2 / §3.3；04 R-R01–R-R07、R-W11；03 P11 / P14 / P15 / P50 / P62；
// 边改 S05；原型 ShiziScreen L116–L124（result / firstResult / endPicked）、L421–L457（数据与修改判断弹层）；
// reference/J-proto-screen.md §2.3.11–§2.3.13）。
//
// 进入：写字页最后一字处理完（判断 / 看答案后「下一个」/ 跳过）→ 会话移入 lastEnded[slot]（commitFinish）→ 写字页就地换成本页
// （nav.replace('result', {slot, sessionId})，决定-D20：无中间页）；「结束这组」有判断时同样换成本页（write/end.js）。
// 停在本页刷新：按 params 从 lastEnded[slot] 恢复（01 §3.3）；会话还在槽里（写完但结束写入失败）时照样显示并补写结束。
//
// 三态（按会话 kind）：
//   daily  「这次练习」：结果页即作品（P1-E7；E9c 起按 D49 减法修稿：没有底板、没有标题，作品格贴页边）；作品下「没放进图里」的行、复现句（每字「N 天后再见」，D48）；
//          底栏只有主按钮「再写一组」，出口只在页头左上「×」（D49 ③：没有「回到首页」）；第二次邀请没回答前，底栏是「好 / 不用了」（R2-R1 / N2-04）。
//   first  「第一次练习」：同一构图，多一个标题「这三个字，很多人提笔就忘。」（数取这一页上实际有几个字，V2-05；不以计数作标题，D28）与提醒邀请（内嵌，D35 / D46 ③）；
//          底栏（R2-R1 / N2-04 / N2-05 / I2-07）：邀请没回答前就是「好 / 不用了」，回答以后是主按钮「完成」+ 文字按钮「再写一组」。
//          首练专属的三块在 result/first.js（与 P1-E7 作品出口的分界：本文件的格子 / 日期行 / 图片入口属通用结果页，E7 改构图）。
//   picked 「这次选的字」：和日常组同一个作品版式（R2-R1 / V2-04 / T2-03：不再是 v1 的表格页）——作品格 + 落款（「二〇二六年十月四日　自选五字」）+ 印、
//          作品下「没放进图里」的行与复现句；没有页头标题和说明段（中途结束时只有一行「还有 N 个字没写，没有记下。」，R-R05）；
//          底栏唯一的主按钮是离开按钮，按来源（R-R06「回到字库」等）；页头右上同样有分享（这次的图片）。
//   难度块按 P11（features.difficultyFeedback=false）不做。
// 说明句（R-R01 / P62）：看过答案与跳过的字按字列出（只有一类时按示例拆成两句）；都没有时用默认说明；末尾「点一个格子…」。
// 格子：点作品格 / 下面的行 → 底部对照弹层：
//   判断过的字可「改为…」（同一记录只改 judgment、追加 corrections、以 fsrsBefore 重放更新 sched，不增加记录，决定-D19）；
//   看过答案 / 跳过的字只看不改（K25）。失败「没改成，还是原来的判断。」[先不改 / 再试一次]。
// 跳过的 5 秒撤销（走查-W16；D36）：最后一字跳过后写字页把撤销机会交给本页（handoffSkipUndo），底栏照样显示到 5 秒（计时在 SkipUndoDock 里）；
//   撤销 = 一次 commit：会话从 lastEnded 放回槽里、删掉 skipped 记录、字放回 cursor、笔画写回 current.strokes；
//   成功后本页就地换回写字页（回到那个字）。
// 离开：「回到首页 / 字库 / 我的」回对应 tab 根；其余来源（写错过 / 快忘了 / 有记录的字 / 某个字）按页面栈返回到下面的来源页。
//   本页被移出页面栈后清掉 lastEnded[slot]（01 §3.3）；清不掉不影响（下次开同槽时一并清）。
//
// 规则：所有写入只经 store.commit；文案只取 copy/。
//
// data-testid：result-screen、result-body（data-variant=daily|first|picked、data-early）、result-title（首练）、
//   result-sub、作品与行见 result/work.js（work、work-cell、result-exrow…）、result-share（页头分享）、
//   result-remind-slot（首练 / 今天的练习的提醒邀请块，见 first.js）、result-again、result-leave（只在自己选字的结果页底栏）、result-again-note / result-again-cancel /
//   result-again-retry（再写一组失败）、result-sheet（对照弹层面板，data-kind）、result-sheet-close（取消 / 关闭）、
//   result-sheet-mine / result-sheet-ref / result-sheet-noink、result-sheet-note、result-sheet-flip、
//   result-sheet-fail-cancel / result-sheet-fail-retry；撤销底栏沿用 write-skip-undo*（skip.js SkipUndoBar）。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { installCommitFeedback } from '../../../platform/haptics.js'; // M5-5 触觉 / 按键音（按 commit label）
import { deckAdapter } from '../../../data/deck.js';
import { localDay, monthDayParts } from '../../../core/dates.js';
import { charOfCardKey, compareRecordIds, correctRecord, isJudged, sortById } from '../../../core/records.js';
import { canCorrect, clearLastEnded, endSlot, fsrsBeforeOf, isComplete } from '../../../core/sessions.js';
import { replay } from '../../../core/fsrs.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import * as sessionStart from '../../../core/session-start.js';
import { allRecords, replaceRecordInDraft } from '../write/answer.js';
import { InkMini, RefMini, recalledInk } from '../write/compare.js';
import { useStrokeData } from '../write/hint-layer.js';
import { SkipUndoDock, canUndoSkip, undoSkipInDraft } from '../write/skip.js';
import '../write/result-row.js'; // .sz-change* 弹层样式（与写字页修改判断弹层同一版式）
import { openWrite } from '../session/index.js';
import { openNonePage } from '../session/none.js';
import { InviteActions, ReminderInvite, ReviewPreview, firstExtras, useReminderInvite } from './first.js';
import { WorkRows, WorkSection, commitAdded, commitSealed, shouldPlayReveal } from './work.js';
import { addedOf, buildWork } from '../../../core/images/work.js';
import { firstTitle } from '../../work-text.js';

export { commitAdded };

export const RESULT_SCREEN = 'result';
export const LABELS = Object.freeze({
  finish: 'result:finish',
  leave: 'result:leave',
  correct: 'result:correct',
  undoSkip: 'result:skip-undo',
});

// 离开按钮（R-R06；04 §3.2 原型 LEAVE 映射；旧键 againList → wrongList，改动 L19）。
const LEAVE_KEYS = Object.freeze({
  wrongList: 'R-R06.leaveWrong',
  againList: 'R-R06.leaveWrong',
  forgetList: 'R-R06.leaveForget',
  allWritten: 'R-R06.leaveAll',
  mine: 'R-R06.leaveMine',
  library: 'R-R06.leaveLibrary',
  detail: 'R-R06.leaveDetail',
  home: 'X-RESULT.leaveHome',
});
/** 离开时直接回 tab 根的来源（其余来源按页面栈返回）。 */
const TAB_VIEWS = Object.freeze(['home', 'library', 'mine']);

injectStyles('result', `
.sz-result{display:flex;flex-direction:column}
.sz-result__head{display:flex;flex-direction:column;gap:8px}
.sz-result__title{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;color:${T.ink1};text-wrap:pretty}
.sz-result__title--lead{font-size:${T.fs22};line-height:${T.lh22}}
.sz-result__title:focus{outline:none}
.sz-result__sub{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
/* 作品页（daily / first / picked，D49；自选组 R2-R1 起同一版式）：没有底板；间距用留白分组（作品→行 28、行→复现句 20、复现句→邀请 28）；内容不满一屏时整组在页头与按钮行之间居中（底部内边约 5%），超出时贴顶滚动 */
.sz-result{gap:0;margin:auto 0;padding-bottom:5vh}
.sz-result>.sz-work{margin-top:4px}
.sz-result__head{margin-bottom:24px;gap:0}
.sz-result__head+.sz-work{margin-top:0}
.sz-result__remind{margin-top:28px}
.sz-result__remind:empty{display:none}
.sz-result__textbtn{align-self:center}
.sz-result__fail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-result__failnote{margin:0;text-align:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-page[data-testid="result-screen"] .sz-page__body{padding-top:12px}
/* 日常 / 首练结果页的页头标题只给读屏；AX 档的页头规则（ui/components/ax.js）会把标题挤成单独一行，这里压回去（作品不再被标题盖住，D49） */
:root[data-ax][data-text-large] .sz-page[data-testid="result-screen"] .sz-page__head>.sz-page__title--hidden{position:absolute;left:auto;right:auto;flex:none;
  width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* 底栏：主按钮行位置与写字页相同（文字行留空）；紧凑高度与 AX 档不留空行；内容滚到它下面时上沿出现 hairline（data-under，由 useFootHairline 写） */
.sz-result__ghost{height:44px;margin-top:-6px;visibility:hidden;pointer-events:none}
@media (max-height:799px){
  .sz-result__ghost{display:none}
  .sz-page[data-testid="result-screen"] .sz-page__foot{padding-bottom:max(8px, env(safe-area-inset-bottom, 0px))}
}
:root[data-text-large] .sz-result__ghost{display:none}
:root[data-text-large] .sz-page[data-testid="result-screen"] .sz-page__foot{padding-bottom:max(8px, env(safe-area-inset-bottom, 0px))}
.sz-page[data-testid="result-screen"] .sz-page__foot[data-under="true"]{box-shadow:0 calc(${T.hair} * -1) 0 ${T.line}}
`);

// ---------------------------------------------------------------- 纯函数：读状态

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: { ...(s.lastEnded || {}) } } : { A: null, B: null, lastEnded: {} };
}

/**
 * 结果页要显示的会话：lastEnded[slot]（已结束）或 sessions[slot]（写完但还没移入 lastEnded）。
 * @returns {{session, where:'ended'|'slot'} | null}
 */
export function findResultSession(state, { slot, sessionId }) {
  const s = sessionsOf(state);
  const ended = s.lastEnded[slot];
  if (ended && ended.id === sessionId) return { session: ended, where: 'ended' };
  const live = s[slot];
  if (live && live.id === sessionId) return { session: live, where: 'slot' };
  return null;
}

/** 本组的记录（按 id 顺序）。 */
export function recordsOfSession(state, sessionId) {
  return sortById(allRecords(state).filter(r => r && r.sessionId === sessionId));
}

function captionOf(kind, judgment) {
  if (kind === 'judged') return t(judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  if (kind === 'answer-seen') return t('R-R02.cellSaw');
  return t('X-RESULT.cellSkipped');
}

function dayOfSession(session) {
  if (!session) return null;
  const at = Number.isFinite(session.endedAt) ? session.endedAt : session.updatedAt;
  return Number.isFinite(at) ? localDay(at) : session.startedDay || null;
}

function dateText(day) {
  if (!day) return '';
  return t('R-H02.dateFormat', monthDayParts(day));
}

/** 离开按钮：{view, label, char?}。 */
export function leaveOf(source) {
  const view = source && typeof source.view === 'string' ? source.view : 'home';
  const char = source && typeof source.char === 'string' ? source.char : null;
  if (view === 'detail' && char) return { view, char, label: t(LEAVE_KEYS.detail, { char }) };
  const key = view !== 'detail' ? LEAVE_KEYS[view] : null;
  if (key) return { view: view === 'againList' ? 'wrongList' : view, char, label: t(key) };
  return { view: 'home', char: null, label: t(LEAVE_KEYS.home) };
}

/**
 * 结果页模型（纯函数；单测直接调用）。
 * @param {object} state   store 状态
 * @param {{slot:'A'|'B', sessionId:string, hasInk?:(record)=>boolean, policy?:object}} o
 *   hasInk：这条 judged 记录有没有本人笔迹（「这次的图片」只画有笔迹的字，R-R07 / 10.12）。口径与格子一致（I6 / P88）：
 *   存下的墨迹（perRecordInk）或本页面会话里刚判断时记下的笔画（write/compare.js recalledInk）任一即算——图片取墨
 *   （images-entry.js inkPointsOf）也是这两处。页面内笔画刷新即失：perRecordInk 关时刷新后入口按 R-R07.allMissing。
 *   缺省看 state.ink + recalledInk；页面传入与格子同一个取法（inkOf）。perRecordInk=true（D27）时 recalledInk 不再补位，
 *   只看存下的墨迹。
 */
export function resultModel(state, { slot, sessionId, hasInk = null, policy = defaultPolicy }) {
  const found = findResultSession(state, { slot, sessionId });
  const session = found ? found.session : null;
  const records = recordsOfSession(state, sessionId);
  const byId = new Map(records.map(r => [r.id, r]));
  const items = session
    ? session.items.concat(seenCurrentItem(session, records))
    : records.map(r => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const cells = items.map((it, index) => {
    const record = it.recordId ? byId.get(it.recordId) || null : null;
    const kind = record ? record.kind : it.kind;
    const char = record ? record.char : charOfCardKey(it.cardKey);
    const judgment = kind === 'judged' && record ? record.judgment : null;
    return {
      index,
      cardKey: it.cardKey,
      recordId: record ? record.id : it.recordId || null,
      char,
      kind,
      judgment,
      caption: captionOf(kind, judgment),
      canChange: kind === 'judged' && !!record && !record.legacy && !!session && canCorrect(session, record.id),
    };
  });
  const count = new Set(records.filter(isJudged).map(r => r.cardKey)).size;
  const variant = session ? (session.kind === 'picked' ? 'picked' : session.kind === 'first' ? 'first' : 'daily') : slot === 'B' ? 'picked' : 'daily';
  const early = !!(session && session.endedEarly);
  const unwritten = session ? Math.max(0, session.queue.length - session.cursor) : 0;
  const source = session && session.source ? session.source : { view: 'home' };
  const day = dayOfSession(session);

  // 三种结果页同一个作品版式（交接 §5.1；自选组 R2-R1 起也是）：最上面就是作品，不写「这次记录了 N 个字」「点一个格子…」；数量只出现在落款里。
  // 首练保留标题（D28 / P1-E5；N3-07 / D53 起固定「这三个字」，firstTitle）；自选组只在中途结束时多一行「还有 N 个字没写，没有记下。」。
  const sub = [];
  let title = null;
  const header = t(variant === 'first' ? 'X-RESULT.headerFirst' : variant === 'picked' ? 'R-R05.kicker' : 'X-RESULT.headerDaily');
  if (variant === 'picked' && early && unwritten > 0) sub.push(t('R-R05.bodyEarly', { n: unwritten }));

  // 作品（三种结果页都有）：成员规则见 core/work-members.js / core/images/work.js。inkTest = 这条记录有没有本人墨
  // （存下的墨迹或本页面会话里刚判断时记下的笔画，与格子 / 图片取墨同一取法，I6）。
  const inkTest = typeof hasInk === 'function' ? hasInk : record => !!inkEntryOf(state, record) || hasStrokes(recalledInk(record.id, policy));
  const work = cells.length
    ? buildWork({ items: items.map(it => ({ cardKey: it.cardKey, recordId: it.recordId, kind: it.kind })), records: byId, hasInk: inkTest, added: addedOf(session) })
    : null;
  // 分享入口：作品里至少有一个字（没有任何墨时隐藏，§4.1）
  const share = !!work && work.cells.length > 0;
  // 首练标题按这一页上实际有几个字取数（V2-05）：作品里有几格就是几；没有墨时是衬底一行的字数
  if (variant === 'first') title = firstTitle();

  return {
    found: !!session,
    where: found ? found.where : null,
    session,
    slot,
    sessionId,
    variant,
    early,
    header,
    title,
    sub,
    cells,
    count,
    unwritten,
    day,
    work,
    share,
    leave: leaveOf(source),
    again: variant === 'daily' || variant === 'first',
    source,
  };
}

/**
 * P77（过渡「补进」）：从看答案阶段（answer / trace / retrace，或看过答案后恢复到的 recall）「结束这组」时，当前字已写了
 * answer-seen 记录但会话没推进（items 里没有它）——结果页补一格「看过答案」（不可改判，K25）。
 * 只认本会话（sessionId 已由 records 过滤）、当前字的最近一条 answer-seen 记录；没有记录就不补（D22：没写完的字不算）。
 * 标题数字只按 judged 算，不受影响；说明句里的看过答案列举含它。
 * @returns {Array<{cardKey, recordId, kind:'answer-seen'}>} 0 或 1 项
 */
export function seenCurrentItem(session, records) {
  const cur = session && session.current;
  if (!cur || cur.answerSeen !== true) return [];
  if (!(session.cursor >= 0 && session.cursor < session.queue.length)) return [];
  const key = session.queue[session.cursor];
  if (session.items.some(it => it && it.cardKey === key)) return [];
  let rec = null;
  for (const r of records) if (r && r.kind === 'answer-seen' && r.cardKey === key && r.sessionId === session.id) rec = r; // 按 id 升序，取最后
  return rec ? [{ cardKey: key, recordId: rec.id, kind: 'answer-seen' }] : [];
}

function hasStrokes(strokes) {
  return Array.isArray(strokes) && strokes.some(st => Array.isArray(st) && st.length > 0);
}

/** 格子上的本人笔迹是否有东西可画（inkOf 的结果；「这次的图片」入口与格子同一判据，I6）。 */
export function inkPresent(ink) {
  return !!(ink && ((ink.points && ink.points.length) || (ink.strokes && ink.strokes.length)));
}

function inkEntryOf(state, record) {
  if (!state || !record || !state.ink) return null;
  const month = typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
  const id = record.inkId || record.id;
  const table = month ? state.ink[month] : null;
  return table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// ---------------------------------------------------------------- 纯函数：草稿变换

/** 写完的会话还在槽里 → 移入 lastEnded[slot]（正常结束，01 §3.3）。 */
export function finishInDraft(draft, { slot, sessionId, at }) {
  const s = sessionsOf(draft);
  const live = s[slot];
  if (!live || live.id !== sessionId) throw new Error('finish: session not in slot');
  if (!isComplete(live)) throw new Error('finish: session not complete');
  draft.sessions = endSlot(s, slot, { at, early: false });
}

const CLEAN = Object.freeze({ ok: true, noop: true, keys: Object.freeze([]) });
const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 结束写完的会话（幂等：已在 lastEnded → noop）。 */
export function commitFinish(store, { slot, sessionId }) {
  const found = findResultSession(store.getState(), { slot, sessionId });
  if (!found) return STALE;
  if (found.where === 'ended') return CLEAN;
  if (!isComplete(found.session)) return STALE;
  return store.commit(LABELS.finish, (draft, ctx) => finishInDraft(draft, { slot, sessionId, at: ctx.now }));
}

/** 离开结果页：清掉 lastEnded[slot]（只清本组）。 */
export function commitLeave(store, { slot, sessionId }) {
  const s = sessionsOf(store.getState());
  if (!s.lastEnded[slot] || s.lastEnded[slot].id !== sessionId) return CLEAN;
  return store.commit(LABELS.leave, draft => {
    const cur = sessionsOf(draft);
    if (cur.lastEnded[slot] && cur.lastEnded[slot].id === sessionId) draft.sessions = clearLastEnded(cur, slot);
  });
}

/**
 * 结果页修改判断的 mutator 主体（决定-D19）：同一条记录只改 judgment、追加 corrections；
 * 以 items[].fsrsBefore 为起点、各记录 at 为 review 时间重放本字此后的 judged 记录，更新 sched；会话不动。
 * @returns {{record, entry}}
 */
export function correctResultInDraft(draft, { slot, sessionId, recordId, to, at, policy = defaultPolicy }) {
  const found = findResultSession(draft, { slot, sessionId });
  if (!found) throw new Error('correct: session not found');
  const s = found.session;
  if (!canCorrect(s, recordId)) throw new Error('correct: record cannot be corrected in this session');
  const all = allRecords(draft);
  const record = all.find(r => r && r.id === recordId) || null;
  if (!record || !isJudged(record) || record.sessionId !== sessionId) throw new Error('correct: judged record not found');
  const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
  const next = correctRecord(record, target, at);
  if (next === record) return { record, entry: draft.sched ? draft.sched[record.cardKey] : undefined };
  replaceRecordInDraft(draft, next);
  const later = sortById(all.filter(r => isJudged(r) && r.cardKey === record.cardKey && compareRecordIds(r.id, recordId) >= 0))
    .map(r => (r.id === recordId ? next : r));
  const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
  const entry = replay(fsrsBeforeOf(s, recordId), later, { policy, stoppedAt: prev ? prev.stoppedAt : undefined });
  if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
  return { record: next, entry };
}

/** 结果页修改判断 commit。已不能改（会话不在 / 不是本组可改的记录）时 stale。 */
export function commitResultCorrection(store, { slot, sessionId, recordId, to, policy } = {}) {
  const found = findResultSession(store.getState(), { slot, sessionId });
  if (!found || !canCorrect(found.session, recordId)) return STALE;
  let out = null;
  const result = store.commit(LABELS.correct, (draft, ctx) => {
    out = correctResultInDraft(draft, { slot, sessionId, recordId, to, at: ctx.now, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}

/** 结果页上还能不能撤销这次跳过：会话在（lastEnded 或槽里）、最后一个 item 就是这条 skipped、槽没被新组占住。 */
export function canUndoSkipFromResult(state, { slot, sessionId, recordId }) {
  const found = findResultSession(state, { slot, sessionId });
  if (!found) return false;
  if (found.where === 'ended' && sessionsOf(state)[slot]) return false;
  const last = found.session.items[found.session.items.length - 1];
  return !!last && last.kind === 'skipped' && last.recordId === recordId;
}

/**
 * 结果页上的跳过撤销（mutator 主体）：已结束的会话放回槽里（去掉 endedAt / endedEarly、清 lastEnded[slot]），
 * 然后同写字页的撤销：删 skipped 记录、字放回 cursor、current 回 recall、提示次数与笔画写回（skip.js undoSkipInDraft）。
 */
export function undoSkipFromResultInDraft(draft, { slot, sessionId, recordId, strokes, at }) {
  const s = sessionsOf(draft);
  const ended = s.lastEnded[slot];
  if (ended && ended.id === sessionId) {
    if (s[slot]) throw new Error('undo skip: slot is occupied by a newer group');
    const { endedAt, endedEarly, ...rest } = ended; // eslint-disable-line no-unused-vars
    draft.sessions = { ...clearLastEnded(s, slot), [slot]: rest };
  } else if (!s[slot] || s[slot].id !== sessionId) {
    throw new Error('undo skip: session changed');
  }
  return undoSkipInDraft(draft, { slot, sessionId, recordId, at, strokes });
}

export function commitResultSkipUndo(store, { slot, sessionId, recordId, strokes } = {}) {
  const state = store.getState();
  const found = findResultSession(state, { slot, sessionId });
  if (found && found.where === 'slot') {
    if (!canUndoSkip(state, { slot, sessionId, recordId })) return STALE;
  } else if (!canUndoSkipFromResult(state, { slot, sessionId, recordId })) {
    return STALE;
  }
  return store.commit(LABELS.undoSkip, (draft, ctx) => {
    undoSkipFromResultInDraft(draft, { slot, sessionId, recordId, strokes, at: ctx.now });
  });
}

// ---------------------------------------------------------------- 跨页交接与扩展点

let pendingUndo = null; // 写字页 → 结果页：最后一字跳过后的撤销机会（只在内存里：刷新即失，01 §3.2）

/**
 * 写字页在换成结果页之前交出撤销机会（skip.js useSkip().undo + slot）；null 清掉。
 * @param {{slot, sessionId, recordId, char, strokes, until}|null} undo
 */
export function handoffSkipUndo(undo) {
  pendingUndo = undo && undo.sessionId && undo.recordId ? { ...undo, failed: false } : null;
}

/** 结果页取走交接的撤销机会（取一次即清）；不是本组的或已过期的丢掉。 */
export function takeSkipUndo(slot, sessionId, nowMs = clockNow()) {
  const u = pendingUndo;
  pendingUndo = null;
  if (!u || u.slot !== slot || u.sessionId !== sessionId) return null;
  if (Number.isFinite(u.until) && u.until <= nowMs) return null;
  return u;
}

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

const hooks = { image: null };

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const SHARE_ICON = () => html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 14V3.5M7.2 7 11 3.2 14.8 7M6 10H5v8h12v-8h-1"></path></svg>`;

/** 右上「分享」的去处（M4-5 注册，P1-E7 起是结果页页头的分享图标：fn({slot, sessionId})）；没注册时入口不显示。 */
export function setResultImageAction(fn) {
  hooks.image = typeof fn === 'function' ? fn : null;
}

/** 写字页换成结果页（最后一字推进后 / 结束这组有判断）。 */
export function openResult(slot, sessionId) {
  nav.replace(RESULT_SCREEN, { slot, sessionId });
}

// ---------------------------------------------------------------- 组件

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(() => {
    const st = storeOrNull();
    return st ? st.getState() : null;
  });
  useEffect(() => {
    const st = storeOrNull();
    if (!st) return undefined;
    setState(st.getState());
    return st.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 某条记录的本人笔迹（judged，或看过答案后自己写的那份，Q1）：存下的墨迹（perRecordInk 开）→ 本页面会话里刚判断时记下的笔画 → 没有。 */
function inkOf(store, record) {
  if (!record) return { points: null, strokes: null };
  if (store) {
    let ink = null;
    try {
      ink = store.getInk(record);
    } catch (error) {
      ink = null;
    }
    if (ink) {
      const decoded = decodeInk(ink);
      if (decoded) return { points: resampleForReplay(decoded), strokes: null };
    }
  }
  const raw = recalledInk(record.id);
  return raw ? { points: null, strokes: raw } : { points: null, strokes: null };
}

function findRecord(state, recordId) {
  for (const r of allRecords(state)) if (r && r.id === recordId) return r;
  return null;
}

/** 格子对照弹层（overlay 组件；root 注入 close / active）。 */
export function ResultCellSheet({ slot, sessionId, recordId, cellKind, cellChar, close, active = true }) {
  const store = storeOrNull();
  const state = store ? store.getState() : null;
  const record = recordId && state ? findRecord(state, recordId) : null;
  const kind = record ? record.kind : cellKind;
  const char = record ? record.char : cellChar;
  const found = state ? findResultSession(state, { slot, sessionId }) : null;
  const judged = kind === 'judged' && !!record && isJudged(record);
  const changeable = judged && !record.legacy && !!found && canCorrect(found.session, record.id);
  const [failed, setFailed] = useState(false);
  const strokeData = useStrokeData(char);
  // 看过答案的格：有看后自写的本人墨（Q1）就画出来，没有仍是「这次没写」
  const [ink] = useState(() => (judged || (kind === 'answer-seen' && record) ? inkOf(store, record) : { points: null, strokes: null }));
  const judgment = judged ? record.judgment : null;
  let title;
  let note;
  if (judged) {
    title = t(judgment === 'wrong' ? 'R-R02.sheetTitleWrong' : 'R-R02.sheetTitleCorrect', { char });
    note = failed ? t('R-W10.changeFailed') : t('R-R02.sheetNoteChange');
  } else if (kind === 'answer-seen') {
    title = t('R-R02.sheetTitleSaw', { char });
    note = t('R-R02.sheetNoteSaw');
  } else {
    title = t('R-R02.sheetTitleSkipped', { char });
    note = t('R-R02.sheetNoteSkipped');
  }
  const flip = () => {
    const st = storeOrNull();
    const result = st ? commitResultCorrection(st, { slot, sessionId, recordId }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok || (result.error && result.error.kind === 'stale')) {
      if (close) close();
      return;
    }
    setFailed(true);
    markStateChange(); // 失败态是新状态（走查-W08）
  };
  const mine = t('R-W09.labelMine');
  const ref = t('R-W09.labelReference');
  const topLabel = changeable ? t('R-R02.sheetCancel') : t('R-R02.sheetClose');
  return html`<${Sheet} title=${title} onClose=${close} active=${active} testid="result-sheet" dismiss="own">
    <div class="sz-change" data-kind=${kind}>
      <${Button} variant="text" class="sz-change__cancel" data-testid="result-sheet-close" onClick=${() => close && close()}>${topLabel}</${Button}>
      <div class="sz-change__minis">
        <div class="sz-change__col">
          <${InkMini} points=${ink.points} strokes=${ink.strokes} testid="result-sheet-mine" label=${mine}
            emptyText=${judged ? t('R-D07.noInkLarge') : t('R-R02.sheetNoInk')} emptyTestid="result-sheet-noink" />
          <span class="sz-compare__label" aria-hidden="true">${mine}</span>
        </div>
        <div class="sz-change__col">
          <${RefMini} char=${char} strokeData=${strokeData} testid="result-sheet-ref" label=${ref} />
          <span class="sz-compare__label" aria-hidden="true">${ref}</span>
        </div>
      </div>
    </div>
    <p class="sz-change__note" data-testid="result-sheet-note" aria-live="polite">${note}</p>
    ${changeable && failed
      ? html`<div class="sz-change__btns">
          <${Button} variant="secondary" data-testid="result-sheet-fail-cancel" onClick=${() => close && close()}>${t('R-W10.cancel')}</${Button}>
          <${Button} variant="primary" data-testid="result-sheet-fail-retry" onClick=${flip}>${t('R-W10.retry')}</${Button}>
        </div>`
      : changeable
        ? html`<${Button} variant="primary" data-testid="result-sheet-flip" onClick=${flip}>${t(judgment === 'correct' ? 'X-JUDGE.changeToWrong' : 'X-JUDGE.changeToCorrect')}</${Button}>`
        : null}
  </${Sheet}>`;
}

function openCellSheet({ slot, sessionId, cell }) {
  return nav.openOverlay(ResultCellSheet, {
    slot, sessionId, recordId: cell.recordId, cellKind: cell.kind, cellChar: cell.char,
  }, { name: 'result-sheet' });
}

function inRouterStack(entryId) {
  const router = getRouter();
  if (!router || !entryId) return false;
  return router.getState().stack.some(e => e.id === entryId);
}

/** 离开结果页（回来源）。 */
function leaveTo(leave) {
  if (TAB_VIEWS.includes(leave.view)) {
    const def = getScreen(leave.view);
    if (def && def.tab) {
      nav.switchTab(leave.view);
      return;
    }
  }
  nav.back();
}

/**
 * 内容滚到按钮行下面时，按钮行上沿出现 hairline（D49，实现交接 §0.5 / §4.1）：body 下面还有内容没滚到 → 给 .sz-page__foot 写 data-under="true"。
 * 页面骨架 Page 不认识这条规则，所以由本页从自己的根节点往上找；每次渲染后与 body 滚动 / 尺寸变化时重算。
 */
function useFootHairline(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    const page = root && root.closest ? root.closest('.sz-page') : null;
    const body = page ? page.querySelector('.sz-page__body') : null;
    const foot = page ? page.querySelector('.sz-page__foot') : null;
    if (!body || !foot) return undefined;
    const update = () => {
      const under = body.scrollHeight - body.scrollTop - body.clientHeight > 1;
      const cur = foot.getAttribute('data-under') === 'true';
      if (under !== cur) {
        if (under) foot.setAttribute('data-under', 'true');
        else foot.removeAttribute('data-under');
      }
    };
    update();
    body.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(update);
      ro.observe(body);
      if (root) ro.observe(root);
    }
    return () => {
      body.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
      foot.removeAttribute('data-under');
    };
  });
}

function ResultScreen({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : '';
  const state = useStoreState();
  const store = storeOrNull();
  const rootRef = useRef(null);
  useFootHairline(rootRef);
  // 「这次的图片」入口与格子同一取法（存下的墨迹 → 本页面会话里的笔画，I6）
  const model = resultModel(state, { slot, sessionId, hasInk: record => inkPresent(inkOf(store, record)) });
  const sealKey = `${slot}:${sessionId}`;
  // 作品落定（印落下，D51 ② / D53）：邀请的 600ms 从这时算起；落印没有要演的（已落过印 / 减少动态效果 / 没有作品）时一开始就是已落定，文字与底栏不隐藏
  const [landed, setLanded] = useState(() => !shouldPlayReveal({ work: model.work, key: sealKey, session: model.session }));
  useLayoutEffect(() => { // 印落下之前先只显示作品（I3-04）：给页面写 data-late，底栏跟着淡入（正文那一半由 .sz-result[data-late] 管）
    const root = rootRef.current;
    const page = root && root.closest ? root.closest('.sz-page') : null;
    if (!page) return undefined;
    if (landed) page.removeAttribute('data-late');
    else page.setAttribute('data-late', 'pending');
    return () => page.removeAttribute('data-late');
  }, [landed]);
  useEffect(() => { installCommitFeedback(getStore); }, []); // M5-5：结果页的改判断 / 撤销跳过 / 补写结束也发触觉（刷新后直接停在本页时写字页没挂过）

  // 写完但还在槽里（结束写入失败 / 刷新打断）→ 补写结束（幂等）。
  useEffect(() => {
    const st = storeOrNull();
    if (st) commitFinish(st, { slot, sessionId });
  }, [slot, sessionId]);

  // 被移出页面栈（离开 / 返回 / 切 tab）→ 清 lastEnded[slot]（01 §3.3）。
  const entryId = entry && entry.id;
  useEffect(() => () => {
    if (inRouterStack(entryId)) return;
    const st = storeOrNull();
    if (st) commitLeave(st, { slot, sessionId });
  }, [entryId]);

  // 跳过的撤销机会（写字页交过来的，剩余时长照旧）。
  // 计时在 SkipUndoDock 里（D36 / P115：5 秒、按住暂停、读屏不自动收起；until 是写字页给的绝对时刻）。
  const [undo, setUndo] = useState(() => takeSkipUndo(slot, sessionId));
  const dismissUndo = () => setUndo(null);
  const doUndo = () => {
    const u = undo;
    if (!u) return;
    const st = storeOrNull();
    const result = st
      ? commitResultSkipUndo(st, { slot, sessionId, recordId: u.recordId, strokes: u.strokes })
      : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok) {
      setUndo(null);
      nav.replace('write', { slot }); // 回到那个字（新的写字页按存下的现场取笔画）
      return;
    }
    if (result.error && result.error.kind === 'stale') {
      setUndo(null);
      return;
    }
    setUndo({ ...u, failed: true });
    markStateChange();
  };

  const [againFailed, setAgainFailed] = useState(false);
  const again = () => {
    dismissUndo();
    const st = storeOrNull();
    const source = model.source && model.source.view ? { ...model.source } : { view: 'home' };
    const r = st
      ? sessionStart.startNextA(st, { now: envNow, deck: deckAdapter, source })
      : { ok: false, error: { kind: 'unavailable' } };
    if (!r.ok) {
      setAgainFailed(true);
      markStateChange();
      return;
    }
    setAgainFailed(false);
    nav.back(); // 本页先出栈（回到来源），新组的写字页排在返回之后推入
    if (r.started || r.occupied) openWrite('A');
    else if (r.empty) openNonePage({ exhausted: r.libraryExhausted });
  };
  const leave = () => {
    dismissUndo();
    leaveTo(model.leave);
  };
  const openCell = cell => {
    dismissUndo();
    openCellSheet({ slot, sessionId, cell });
  };

  // 提醒邀请（首练 / 第二次）：没回答之前吸底栏就是「好 / 不用了」；该问但还没到时候时占位（N2-04、I2-07）
  const invite = useReminderInvite({ store, settings: state && state.settings, session: model.session, variant: model.variant, ready: landed });
  useEffect(() => { if (!model.work || model.work.empty) setLanded(true); }, [!!model.work, model.work ? model.work.empty : true]); // 没有作品（没有落印）：直接算落定

  let footer;
  if (againFailed) {
    footer = html`<p class="sz-result__failnote" data-testid="result-again-note" aria-live="polite">${t('X-RESULT.againFailed')}</p>
      <div class="sz-result__fail">
        <${Button} variant="secondary" data-testid="result-again-cancel" onClick=${() => { setAgainFailed(false); markStateChange(); }}>${t('X-RESULT.againCancel')}</${Button}>
        <${Button} variant="primary" data-testid="result-again-retry" onClick=${again}>${t('X-RESULT.againRetry')}</${Button}>
      </div>`;
  } else if (invite.active || invite.reserved) {
    footer = html`<${InviteActions} invite=${invite} />`;
  } else if (model.variant === 'first') {
    // 首练收尾（N2-05）：主按钮是「完成」，「再写一组」降为下面的文字按钮
    footer = html`<${Button} variant="primary" data-testid="result-done" onClick=${leave}>${t('X-RESULT.done')}</${Button}>
      <${Button} variant="text" class="sz-result__textbtn" data-testid="result-again" onClick=${again}>${t('X-RESULT.again')}</${Button}>`;
  } else if (model.again) {
    // D49 ③：出口只在页头左上「×」；底栏只有主按钮（文字行留空，让主按钮行与写字页同位）
    footer = html`<${Button} variant="primary" data-testid="result-again" onClick=${again}>${t('X-RESULT.again')}</${Button}>
      <span class="sz-result__ghost" aria-hidden="true"></span>`;
  } else {
    footer = html`<${Button} variant="primary" data-testid="result-leave" onClick=${leave}>${model.leave.label}</${Button}>`;
  }

  const imageAction = hooks.image;
  // 复现预告句（三种结果页都有，交接 §5.1）；提醒邀请在首练与「今天的练习」结果页的槽位里
  const extras = firstExtras({
    cells: model.cells,
    sched: state && state.sched,
    today: localDay(envNow()),
    work: model.work,
    variant: model.variant,
  });
  const inkForRecord = record => (record ? inkOf(store, record) : null);
  const openEntry = entry => openCell(model.cells[entry.index]);
  const toggleEntry = entry => {
    const st = storeOrNull();
    if (st && entry.recordId) commitAdded(st, { slot, sessionId, recordId: entry.recordId });
  };
  // 右上「分享」：作品里至少有一个字才有（没有任何墨时隐藏，交接 §4.1）
  const shareButton = model.share && imageAction
    ? html`<${Button} variant="icon" data-testid="result-share" aria-label=${t('X-WORK.shareAria')}
        onClick=${() => { dismissUndo(); imageAction({ slot, sessionId }); }}>${SHARE_ICON()}</${Button}>`
    : null;
  return html`<${Page} title=${model.header} hideTitle=${true} leading="close" onBack=${leave} footer=${footer} trailing=${shareButton} testid="result-screen">
    <div class="sz-result" ref=${rootRef} data-testid="result-body" data-late=${landed ? null : 'pending'} data-variant=${model.variant} data-slot=${slot} data-session=${sessionId} data-early=${model.early ? 'true' : 'false'}
      data-found=${model.found ? 'true' : 'false'}>
      ${model.title || model.sub.length
        ? html`<div class="sz-result__head">
            ${model.title ? html`<h2 class="sz-result__title sz-result__title--lead" data-testid="result-title">${model.title}</h2>` : null}
            ${model.sub.length ? html`<p class="sz-result__sub" data-testid="result-sub">${model.sub.join('')}</p>` : null}
          </div>`
        : null}
      ${model.work
        ? html`<${WorkSection} work=${model.work} day=${model.day} dateText=${dateText(model.day)} inkOf=${inkForRecord} onOpen=${openEntry}
          picked=${model.variant === 'picked'} sealKey=${sealKey} session=${model.session} settings=${state && state.settings}
          onSealed=${() => { const st = storeOrNull(); if (st) commitSealed(st, { slot, sessionId }); }} onLanded=${() => setLanded(true)} />`
        : null}
      ${model.work ? html`<${WorkRows} rows=${model.work.rows.filter(r => r.state !== 'in')} inkOf=${inkForRecord} onOpen=${openEntry} onToggle=${toggleEntry} quiet=${model.work.empty} />` : null}
      ${extras ? html`<${ReviewPreview} text=${extras.preview} />` : null}
      <div class="sz-result__remind" data-testid="result-remind-slot">
        <${ReminderInvite} invite=${invite} />
      </div>
    </div>
    ${undo ? html`<${SkipUndoDock} char=${undo.char} failed=${!!undo.failed} onUndo=${doUndo} until=${undo.until}
      onExpire=${() => setUndo(u => (u === undo ? null : u))}
      onCancelFail=${() => { setUndo(null); markStateChange(); }} />` : null}
  </${Page}>`;
}

registerScreen(RESULT_SCREEN, ResultScreen, { label: t('X-RESULT.headerDaily') });
