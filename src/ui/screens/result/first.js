// 首练结果页专属的区块（阶段 1 P1-E5；设计稿「首练与首页」§三；D28 D35 D41 D46 ③）。
//
// 分界（与 P1-E7「作品出口」）：result/index.js 管通用的结果页结构（页头、作品区的格子、日期行、图片入口、底栏）；
// 本文件只放首练（以及「今天的练习」结果页的第二次邀请）特有的三块，index.js 把它们接在作品区下面：
//   ExcludedRows    作品下一行：写错且有墨的字「没放进图里」+［放进去］。只做入口与状态——点了在页面内记一个集合
//                   （addedMembers / toggleAdded，刷新即失），图片的成员规则、朱点、重排由 P1-E7 接这个集合实现；本卡不改图片。
//   ReviewPreview   复现预告句：用 FSRS 的实际到期日分「明天 / 过两天 / 过几天」三档（core/first-result.js reviewPreview，D41）。
//   ReminderInvite  提醒邀请（D35）：内嵌不弹窗，作品落定约 600ms 后淡入；点「好」才请求系统通知权限（platform/reminder.js inviteReminder）；
//                   最多邀请两次（首练结果页一次，没回应则下一次「今天的练习」结果页再一次，D46 ③；规则在 core/first-result.js inviteDecision）。
//
// data-testid：result-exrow（data-char / data-record / data-added）、result-add、result-preview、
//   result-invite（data-state = invite | accepted | denied）、result-invite-title、result-invite-body、result-invite-yes、result-invite-no、
//   result-invite-accepted、result-invite-denied、result-invite-time（「改时间」按钮）、result-invite-time-input、result-invite-fail。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { now as envNow } from '../../../platform/env.js';
import { inviteChangeTime, inviteReminder, maskedWord } from '../../../platform/reminder.js';
import { cardForKey } from '../../../data/deck.js';
import {
  commitInviteAnswer, commitInviteShown, inviteDecision, inviteTime, inviteTimeText, previewText, reviewPreview,
} from '../../../core/first-result.js';
import { parseTime, settingsView } from '../mine/settings.js';

/** 提醒邀请在作品落定后多久淡入（ms，设计稿 §三）。 */
export const INVITE_DELAY_MS = 600;

injectStyles('result-first', `
.sz-result__preview{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-exrow{display:flex;align-items:center;gap:12px;min-height:60px;box-sizing:border-box;padding:6px 0;border-top:${T.hair} solid ${T.line};
  border-bottom:${T.hair} solid ${T.line}}
.sz-exrow+.sz-exrow{border-top:0}
.sz-exrow__cell{position:relative;flex:none;width:48px;height:48px;box-sizing:border-box;${TEX};box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-exrow__cell .sz-compare__card{position:absolute;inset:10%;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
.sz-exrow__glyph{position:absolute;inset:0;display:grid;place-items:center;font-family:${T.kai};font-size:${T.fs22};line-height:1;color:${T.under}}
.sz-exrow__t{flex:1;min-width:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-invite{display:grid;gap:4px;padding-top:16px;border-top:${T.hair} solid ${T.line}}
.sz-invite--in{animation:szInviteIn 300ms ease-out both}
@keyframes szInviteIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.sz-invite--in{animation:none}}
.sz-invite__title{margin:0;font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-invite__body{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-invite__line{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-invite__acts{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.sz-invite__acts .sz-btn--secondary{width:auto;min-height:${T.hit};padding:0 22px;font-size:${T.fs15};line-height:${T.lh15}}
.sz-invite__time{font:inherit;font-size:${T.fs15};color:${T.ink1};background:${T.field};border:0;border-radius:${T.rCtl};min-height:${T.hit};
  padding:0 12px;box-sizing:border-box}
.sz-invite__note{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
`);

// ---------------------------------------------------------------- 纯函数

/**
 * 首练结果页的两项派生数据（纯函数；单测直接调用）。
 * @param {{cells:Array, sched:object, today:string, hasInk:(recordId:string)=>boolean}} o  cells = resultModel().cells
 * @returns {{preview:string, excluded:Array<{char:string, recordId:string}>}}
 *   preview：复现预告句，没有可预告的字（都是跳过 / 看过答案）时 ''；
 *   excluded：写错且有墨迹的字（作品里默认没有它们，可以点「放进去」，D31）。
 */
export function firstExtras({ cells, sched, today, hasInk }) {
  const judged = (cells || []).filter(c => c.kind === 'judged');
  const preview = previewText(reviewPreview({ chars: judged.map(c => ({ char: c.char, cardKey: c.cardKey })), sched: sched || {}, today }), t);
  const excluded = judged.filter(c => c.judgment === 'wrong' && c.recordId && hasInk(c.recordId)).map(c => ({ char: c.char, recordId: c.recordId }));
  return { preview, excluded };
}

// ---------------------------------------------------------------- 「放进去」（入口与状态；成员规则归 P1-E7）

const added = new Map(); // sessionId → Set<recordId>（只在内存里：刷新即失）

/** 这一组里用户点了「放进去」的记录 id（P1-E7 的图片成员规则读它）。 */
export function addedMembers(sessionId) {
  return [...(added.get(sessionId) || [])];
}

/** 切换一条记录的「放进去」状态；返回切换后是否在里面。 */
export function toggleAdded(sessionId, recordId) {
  const set = added.get(sessionId) || new Set();
  if (set.has(recordId)) set.delete(recordId);
  else set.add(recordId);
  added.set(sessionId, set);
  return set.has(recordId);
}

export function ExcludedRows({ rows, sessionId, renderMini }) {
  const [, bump] = useState(0);
  if (!rows || !rows.length) return null;
  const members = new Set(addedMembers(sessionId));
  return html`<div class="sz-exrows" data-testid="result-excluded">${rows.map(row => {
    const on = members.has(row.recordId);
    return html`<div key=${row.recordId} class="sz-exrow" data-testid="result-exrow" data-char=${row.char} data-record=${row.recordId}
      data-added=${on ? 'true' : 'false'}>
      <span class="sz-exrow__cell">${renderMini(row)}</span>
      <span class="sz-exrow__t" data-wrong="true">${t(on ? 'X-FIRST.included' : 'X-FIRST.excluded', { char: row.char })}</span>
      <${Button} variant="text" data-testid="result-add" aria-pressed=${on ? 'true' : 'false'}
        aria-label=${t(on ? 'X-FIRST.takeOutAria' : 'X-FIRST.addAria', { char: row.char })}
        onClick=${() => { toggleAdded(sessionId, row.recordId); bump(n => n + 1); }}>${t(on ? 'X-FIRST.takeOut' : 'X-FIRST.addIn')}</${Button}>
    </div>`;
  })}</div>`;
}

export function ReviewPreview({ text }) {
  if (!text) return null;
  return html`<p class="sz-result__preview" data-testid="result-preview">${text}</p>`;
}

// ---------------------------------------------------------------- 提醒邀请

/** 邀请说明里的示例：首练第一个字的题面词语（目标字位是 □）+ 拼音；取不到词语时 null。 */
export function inviteExample(session) {
  const key = session && Array.isArray(session.queue) ? session.queue[0] : null;
  const card = key ? cardForKey(key) : null;
  if (!card || !String(card.py || '').trim()) return null;
  return { word: maskedWord(card), pinyin: String(card.py).trim() };
}

/**
 * 提醒邀请块。
 * @param {{store:object, settings:object|null, session:object|null, variant:'first'|'daily'|'picked'}} props
 */
export function ReminderInvite({ store, settings, session, variant }) {
  const sessionId = session ? session.id : '';
  const show = inviteDecision({ settings, variant, sessionId }) === 'show';
  const [phase, setPhase] = useState('wait'); // wait → invite → accepted | denied | gone
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [evening, setEvening] = useState(false);

  // 作品落定约 600ms 后淡入；显示出来那一刻记一次邀请（次数按显示算，同一会话不重复）
  useEffect(() => {
    if (phase !== 'wait' || !show || !store) return undefined;
    const timer = setTimeout(() => {
      const r = commitInviteShown(store, { sessionId });
      if (r && r.ok === false) return; // 写不进去就不问（不让「问了几次」失真）
      setEvening(inviteTime(envNow()).evening);
      setPhase('invite');
    }, INVITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, show, sessionId]);

  // 点「好」之后系统权限被拒（原生回 permission = denied）：变成一行说明，以后不再问
  const remind = settingsView(settings).remind;
  useEffect(() => {
    if (phase !== 'accepted' || remind.permission !== 'denied' || !store) return;
    commitInviteAnswer(store, 'denied');
    setEditing(false);
    setPhase('denied');
  }, [phase, remind.permission]);

  if (phase === 'wait' || phase === 'gone') return null;

  const accept = async () => {
    const time = inviteTime(envNow());
    let r;
    try {
      r = await inviteReminder(store, time);
    } catch (error) {
      r = { ok: false };
    }
    if (!r || r.ok === false) {
      setFailed(true);
      return;
    }
    setFailed(false);
    commitInviteAnswer(store, 'yes');
    setPhase('accepted');
  };
  const decline = () => {
    commitInviteAnswer(store, 'no');
    setPhase('gone');
  };
  const changeTime = async event => {
    const parsed = parseTime(event && event.target ? event.target.value : '');
    if (!parsed) return;
    try {
      await inviteChangeTime(store, parsed);
    } catch (error) {
      // 改不成就留在原来的时间（设置页「提醒时间」同样可改）
    }
  };

  if (phase === 'denied') {
    return html`<div class="sz-invite" data-testid="result-invite" data-state="denied">
      <p class="sz-invite__line" data-testid="result-invite-denied">${t('X-INVITE.denied')}</p>
    </div>`;
  }
  if (phase === 'accepted') {
    const time = inviteTimeText(remind.hour, remind.minute);
    const value = `${String(remind.hour).padStart(2, '0')}:${String(remind.minute).padStart(2, '0')}`;
    return html`<div class="sz-invite" data-testid="result-invite" data-state="accepted">
      <p class="sz-invite__line" data-testid="result-invite-accepted" aria-live="polite">${t('X-INVITE.accepted', { time })}</p>
      <div class="sz-invite__acts">
        ${editing
          ? html`<input class="sz-invite__time" type="time" step="60" value=${value} aria-label=${t('X-INVITE.timeLabel')}
              data-testid="result-invite-time-input" onChange=${changeTime} />`
          : html`<${Button} variant="text" data-testid="result-invite-time" onClick=${() => setEditing(true)}>${t('X-INVITE.changeTime')}</${Button}>`}
      </div>
    </div>`;
  }
  const example = inviteExample(session);
  return html`<div class="sz-invite sz-invite--in" data-testid="result-invite" data-state="invite">
    <p class="sz-invite__title" data-testid="result-invite-title">${t(evening ? 'X-INVITE.titleEvening' : 'X-INVITE.title')}</p>
    <p class="sz-invite__body" data-testid="result-invite-body">${example ? t('X-INVITE.body', example) : t('X-INVITE.bodyPlain')}</p>
    ${failed ? html`<p class="sz-invite__note" data-testid="result-invite-fail" aria-live="polite">${t('X-SETTINGS.saveFailed')}</p>` : null}
    <div class="sz-invite__acts">
      <${Button} variant="secondary" data-testid="result-invite-yes" onClick=${accept}>${t('X-INVITE.yes')}</${Button}>
      <${Button} variant="text" data-testid="result-invite-no" onClick=${decline}>${t('X-INVITE.no')}</${Button}>
    </div>
  </div>`;
}

