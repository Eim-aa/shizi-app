// 原生结果页的会话 op（B2.7；架构 docs/engineering/v10/B2-原生写字架构.md §3.2 / §20）。无 DOM：与 write-api.js 同一个 createWriteSessionApi 合并。
//
// 每个写入 op 调用网页结果页**同一个**提交函数（result-ops.js / core/session-start.js / core/first-result.js），网页路径与 API 路径整份 store 状态相同
// （test/ui/native-write.test.mjs 的 B2.7 契约）。页面的版式与文字（作品格、落款、各行文字、复现句……）由页面侧注入的 deps.result.view 给出
// （src/ui/screens/result/native-view.js：网页结果页的同一批函数），导航（离开 / 再写一组 / 重写错字 / 字详情 / 分享 / 回写字页）与提醒权限同样由页面注入。
//
//   result          打开 / 重新取：commitFinish（幂等，网页结果页挂载时同一次）+ 页面给的视图
//   resultCell      点作品格 / 行：对照弹层的数据（网页 ResultCellSheet 同一套判定与文案；只读）
//   resultCorrect   弹层「改为写对 / 写错」= commitResultCorrection（D19：同一条记录只改 judgment、追加 corrections）
//   resultAdd       「放进图里」= commitAdded
//   resultSealed    印着纸那一帧 = commitSealed（+ 页面放盖章声 s1；触觉原生同帧发）
//   resultUndoSkip  撤销条「撤销」= commitResultSkipUndo，成功后页面把结果页就地换回写字页
//   resultAgain     「再写一组」= startNextA（与网页 again 同一组参数），成功后页面就地换成写字页（D70：返回回首页）
//   resultExit      「×」/ 底栏离开 / 重写错字 / 看这个字 / 分享：只导航
//   resultInvite    提醒邀请：shown = commitInviteShown；yes = 页面 inviteReminder（系统权限）+ commitInviteAnswer；no / denied = commitInviteAnswer；time = inviteChangeTime

import { t } from '../config/copy/index.js';
import { now as envNow } from '../platform/env.js';
import { canCorrect } from '../core/sessions.js';
import { isJudged, isPaperRecord } from '../core/records.js';
import * as sessionStart from '../core/session-start.js';
import { commitInviteAnswer, commitInviteShown, inviteDecision, inviteTime, inviteTimeText } from '../core/first-result.js';
import { deckAdapter } from '../data/deck.js';
import { findRecord } from './write-ops.js';
import { commitAdded, commitFinish, commitResultCorrection, commitResultSkipUndo, commitSealed, findResultSession, resultModel } from './result-ops.js';

export const NATIVE_RESULT_OPS = Object.freeze(['result', 'resultCell', 'resultCorrect', 'resultAdd', 'resultSealed', 'resultUndoSkip', 'resultAgain', 'resultExit', 'resultInvite']);

/** 原生结果页用到的固定文案键（值取自 src/config/copy；按内容变的字由页面视图直接给）。 */
export const NATIVE_RESULT_COPY_KEYS = Object.freeze([
  'X-COMMON.close',
  'X-WORK.shareAria',
  'X-RESULT.again',
  'X-RESULT.done',
  'X-RESULT.againFailed',
  'X-RESULT.againCancel',
  'X-RESULT.againRetry',
  'X-REDO.title',
  'X-FIRST.addIn',
  'X-INVITE.yes',
  'X-INVITE.no',
  'X-INVITE.changeTime',
  'X-INVITE.blankLabel',
  'X-INVITE.denied',
  'X-SETTINGS.saveFailed',
  'X-SETTINGS.cancel',
  'R-W09.labelMine',
  'R-W09.labelReference',
  'R-W09.mineCardLabel',
  'R-W09.refCardLabelChar',
  'R-W10.changeFailed',
  'R-W10.retry',
  'R-W10.cancel',
  'R-D07.noInkLarge',
  'R-R02.sheetNoInk',
  'X-DETAIL.viewChar',
  'R-W20.skippedToast',
  'R-W20.undo',
  'R-W16.saveFailed',
  'R-W16.retry',
  'R-W16.cancel',
  'X-JUDGE.changeToWrong',
  'X-JUDGE.changeToCorrect',
]);

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

function plainError(result) {
  const e = result && result.error ? result.error : {};
  return { kind: typeof e.kind === 'string' ? e.kind : 'generic', reason: typeof e.reason === 'string' ? e.reason : undefined };
}

function slotOf(slot) {
  return slot === 'B' ? 'B' : 'A';
}

/**
 * 对照弹层的数据（网页 ResultCellSheet 同一套判定与文案）：判断过、本组可改的字给「改为…」主按钮；看过答案 / 跳过的只看不改（K25）。
 * strokes 由调用方给（存下的墨迹 → 本页面刚记下的笔画，与写字页改判弹层同一个取法）。
 */
export function resultCellModel(state, { slot, sessionId, recordId = null, kind: cellKind = null, char: cellChar = '' }) {
  const record = recordId ? findRecord(state, recordId) : null;
  const kind = record ? record.kind : cellKind;
  const char = record ? record.char : cellChar;
  const found = findResultSession(state, { slot, sessionId });
  const judged = kind === 'judged' && !!record && isJudged(record);
  const changeable = judged && !record.legacy && !!found && canCorrect(found.session, record.id);
  const judgment = judged ? record.judgment : null;
  let title;
  let note;
  if (judged) {
    title = t(judgment === 'wrong' ? 'R-R02.sheetTitleWrong' : 'R-R02.sheetTitleCorrect', { char });
    note = t('R-R02.sheetNoteChange');
  } else if (kind === 'answer-seen') {
    title = t('R-R02.sheetTitleSaw', { char });
    note = t('R-R02.sheetNoteSaw');
  } else {
    title = t('R-R02.sheetTitleSkipped', { char });
    note = t('R-R02.sheetNoteSkipped');
  }
  return {
    recordId: record ? record.id : recordId,
    kind: kind || 'skipped',
    char,
    judgment,
    judged,
    changeable,
    paper: isPaperRecord(record),
    // 看过答案的格：有看后自写的本人墨就画（Q1），没有仍是「这次没写」；跳过的格不画墨
    inked: judged || (kind === 'answer-seen' && !!record),
    title,
    note,
    topLabel: changeable ? t('R-R02.sheetCancel') : t('R-R02.sheetClose'),
    flipLabel: changeable ? t(judgment === 'correct' ? 'X-JUDGE.changeToWrong' : 'X-JUDGE.changeToCorrect') : null,
    emptyText: judged ? t('R-D07.noInkLarge') : t('R-R02.sheetNoInk'),
  };
}

/**
 * 结果页的会话 op。ctx：storeOf（取 store）、strokesOf(store, record)（桥上紧凑笔画）、result（页面注入：view / 导航 / 提醒 / 盖章声）。
 * @returns {object} op 名 → 函数（合并进 write-api 的 ops）
 */
export function createResultOps({ storeOf, strokesOf, result = {} }) {
  const view = (store, args) => (typeof result.view === 'function' ? result.view(store, args) : baseView(store, args));

  /** 没有页面注入时（node:test）的最小视图：模型里与 store 有关的部分。 */
  function baseView(store, { slot, sessionId }) {
    const m = resultModel(store.getState(), { slot, sessionId });
    return {
      found: m.found, variant: m.variant, early: m.early, sessionId, slot,
      cells: m.cells.map(c => ({ index: c.index, char: c.char, recordId: c.recordId, kind: c.kind, judgment: c.judgment, canChange: c.canChange })),
    };
  }

  return {
    /** 打开 / 重新取：写完还在槽里的组补写结束（幂等，网页 ResultScreen 挂载时同一次 commitFinish），再给视图。width = 原生页宽（作品格按它算）。 */
    result({ slot, sessionId, width, ax = false, undo = null }) {
      const s = slotOf(slot);
      const store = storeOf();
      const fin = commitFinish(store, { slot: s, sessionId });
      const v = view(store, { slot: s, sessionId, width, ax, undo });
      return { ok: true, finished: !!(fin && fin.ok), view: v };
    },
    resultCell({ slot, sessionId, recordId, kind, char }) {
      const store = storeOf();
      const m = resultCellModel(store.getState(), { slot: slotOf(slot), sessionId, recordId, kind, char });
      const record = m.recordId ? findRecord(store.getState(), m.recordId) : null;
      return { ok: true, ...m, strokes: m.inked && record ? strokesOf(store, record) : [] };
    },
    /** 改判（D19）。to 明示（弹层打开时的判断取反）：重发不会改回去。stale（会话没了 / 已不能改）网页同样直接关弹层。 */
    resultCorrect({ slot, sessionId, recordId, to, width, ax = false }) {
      const s = slotOf(slot);
      const store = storeOf();
      const r = commitResultCorrection(store, { slot: s, sessionId, recordId, to: to === 'correct' || to === 'wrong' ? to : undefined });
      if (!r || !r.ok) return { ok: false, error: plainError(r) };
      return { ok: true, judgment: r.record ? r.record.judgment : null, view: view(store, { slot: s, sessionId, width, ax }) };
    },
    resultAdd({ slot, sessionId, recordId, on, width, ax = false }) {
      const s = slotOf(slot);
      const store = storeOf();
      const r = commitAdded(store, { slot: s, sessionId, recordId, on: typeof on === 'boolean' ? on : undefined });
      if (!r || !r.ok) return { ok: false, error: plainError(r) };
      return { ok: true, view: view(store, { slot: s, sessionId, width, ax }) };
    },
    /** 印着纸：记 sealedAt（冷启动 / 刷新不重演、不再响，I3-05）；盖章声由页面放（同一个 keySound('seal')，同组只响一次）。 */
    resultSealed({ slot, sessionId, sound = true }) {
      const s = slotOf(slot);
      if (sound && typeof result.seal === 'function') {
        try {
          result.seal(`${s}:${sessionId}`);
        } catch (error) {
          // 声音失败不影响落印
        }
      }
      const r = commitSealed(storeOf(), { slot: s, sessionId });
      return r && r.ok ? { ok: true, already: !!r.already } : { ok: false, error: plainError(r) };
    },
    /** 撤销跳过（结果页的撤销条，写字页交接过来的）：一次 commit，成功后页面把结果页就地换回写字页（那个字，笔画写回）。 */
    resultUndoSkip({ slot, sessionId, recordId, strokes }) {
      const s = slotOf(slot);
      const rows = Array.isArray(strokes) && strokes.length ? strokes : null;
      const r = commitResultSkipUndo(storeOf(), { slot: s, sessionId, recordId, strokes: rows });
      if (!r || !r.ok) return { ok: false, error: plainError(r) };
      if (typeof result.toWrite === 'function') result.toWrite(s);
      return { ok: true };
    },
    /**
     * 「再写一组」：与网页 again 同一次 startNextA（来源沿用本组的来源）。started / occupied → 页面就地换成写字页；empty → 无字可写页；
     * 失败 {ok:false}（原生就地三段式，R-R 再写一组失败）。
     */
    resultAgain({ slot, sessionId }) {
      const s = slotOf(slot);
      const store = storeOf();
      const m = resultModel(store.getState(), { slot: s, sessionId });
      const source = m.source && m.source.view ? { ...m.source } : { view: 'home' };
      const r = sessionStart.startNextA(store, { now: envNow, deck: deckAdapter, source });
      if (!r || !r.ok) return { ok: false, error: plainError(r) };
      if (typeof result.again === 'function') result.again(r);
      return { ok: true, started: !!r.started, occupied: !!r.occupied, empty: !!r.empty };
    },
    /** 只导航：leave（「×」/ 底栏离开 / 首练「完成」）、redo（重写错字）、detail（看这个字 ›）、share（这次的图片）。 */
    resultExit({ slot, sessionId, to, char }) {
      const s = slotOf(slot);
      const store = storeOf();
      if (to === 'leave') {
        const m = resultModel(store.getState(), { slot: s, sessionId });
        if (typeof result.leave === 'function') result.leave(m.leave);
        return { ok: true };
      }
      if (to === 'redo') {
        const m = resultModel(store.getState(), { slot: s, sessionId });
        const wrong = m.cells.filter(c => c.kind === 'judged' && c.judgment === 'wrong').map(c => c.char);
        if (!wrong.length || typeof result.redo !== 'function') return { ok: false, error: { kind: 'invalid' } };
        return { ok: result.redo(wrong) !== false };
      }
      if (to === 'detail') {
        if (typeof char !== 'string' || !char || typeof result.detail !== 'function') return { ok: false, error: { kind: 'invalid' } };
        return { ok: result.detail(char) !== false };
      }
      if (to === 'share') {
        if (typeof result.share !== 'function') return { ok: false, error: { kind: 'invalid' } };
        return { ok: result.share({ slot: s, sessionId }) !== false };
      }
      return { ok: false, error: { kind: 'invalid' } };
    },
    /**
     * 提醒邀请（D35 / D46 ③；网页 useReminderInvite 同一组提交）。
     *   shown：显示出来的那一刻记一次（次数按显示算，同一会话不重复）；写不进去 → 不问（ok:false）。回包带标题是否「明天晚上」（evening）。
     *   yes：页面 inviteReminder（打开提醒 + 系统权限请求）→ commitInviteAnswer('yes')；系统权限还没回应时等它（页面 settings 变化），
     *        回包 phase = accepted（带「好，明天 H:MM…」）| denied（以后不再问）| failed（写不进去，原生三段式）。
     *   no：commitInviteAnswer('no')。time：改提醒时间（inviteChangeTime），回包带新的一行。
     */
    async resultInvite({ sessionId, action, hour, minute }) {
      const store = storeOf();
      if (action === 'shown') {
        const r = commitInviteShown(store, { sessionId });
        if (r && r.ok === false) return { ok: false, error: plainError(r) };
        return { ok: true, evening: inviteTime(envNow()).evening };
      }
      if (action === 'no') {
        commitInviteAnswer(store, 'no');
        return { ok: true, phase: 'gone' };
      }
      const reminder = result.reminder || {};
      if (action === 'time') {
        const h = Math.trunc(Number(hour));
        const mi = Math.trunc(Number(minute));
        if (!(h >= 0 && h < 24 && mi >= 0 && mi < 60) || typeof reminder.changeTime !== 'function') return { ok: false, error: { kind: 'invalid' } };
        let r;
        try {
          r = await reminder.changeTime(store, { hour: h, minute: mi });
        } catch (error) {
          r = { ok: false };
        }
        return r && r.ok !== false ? { ok: true, ...acceptedOf(store) } : { ok: false, error: plainError(r), ...acceptedOf(store) };
      }
      if (action !== 'yes' || typeof reminder.invite !== 'function') return { ok: false, error: { kind: 'invalid' } };
      const time = inviteTime(envNow());
      let r;
      try {
        r = await reminder.invite(store, time);
      } catch (error) {
        r = { ok: false };
      }
      if (!r || r.ok === false) return { ok: false, error: plainError(r), phase: 'failed' };
      commitInviteAnswer(store, 'yes');
      const permission = await settledPermission(store, r.requested, reminder.waitMs);
      if (permission === 'denied') {
        commitInviteAnswer(store, 'denied');
        return { ok: true, phase: 'denied', text: t('X-INVITE.denied') };
      }
      return { ok: true, phase: 'accepted', ...acceptedOf(store) };
    },
  };
}

/** 邀请回答「好」之后的一行：「好，明天 H:MM 给你一个词。」与「改时间」用的当前时间。 */
function acceptedOf(store) {
  const settings = store.getState().settings || {};
  const remind = settings.remind || {};
  const hour = Number.isInteger(remind.hour) ? remind.hour : 20;
  const minute = Number.isInteger(remind.minute) ? remind.minute : 30;
  return { text: t('X-INVITE.accepted', { time: inviteTimeText(hour, minute) }), hour, minute };
}

function permissionOf(store) {
  const s = store.getState().settings || {};
  const p = s.remind && typeof s.remind.permission === 'string' ? s.remind.permission : 'unknown';
  return p;
}

/** 系统权限弹窗还没回应（这次真的发出了请求、权限仍「未知」）时，等原生回报（settings.remind.permission 变化），最多 waitMs。 */
function settledPermission(store, requested, waitMs = 120000) {
  const now = permissionOf(store);
  if (!requested || now !== 'unknown' || typeof store.subscribe !== 'function') return Promise.resolve(now);
  return new Promise(resolve => {
    let done = false;
    let off = null;
    const finish = p => {
      if (done) return;
      done = true;
      if (off) off();
      clearTimeout(timer);
      resolve(p);
    };
    const timer = setTimeout(() => finish(permissionOf(store)), waitMs);
    off = store.subscribe(() => {
      const p = permissionOf(store);
      if (p !== 'unknown') finish(p);
    });
  });
}

/** 邀请该不该问（网页 useReminderInvite 同一判定）：视图里带给原生。 */
export function inviteShouldShow(state, { variant, sessionId }) {
  return inviteDecision({ settings: state ? state.settings : null, variant, sessionId }) === 'show';
}
