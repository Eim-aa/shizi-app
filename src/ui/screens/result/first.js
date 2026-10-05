// 首练结果页专属的区块（阶段 1 P1-E5；设计稿「首练与首页」§三；D28 D35 D41 D46 ③）。
//
// 分界（与 P1-E7「作品出口」）：result/index.js 管通用的结果页结构，作品构图（格子、落款、「没放进图里」的行与「放进去」）在
// result/work.js，首练与日常结果页共用（P1-E7）；本文件只放首练（以及「今天的练习」结果页的第二次邀请）特有的两块：
//   ReviewPreview   复现句：每字「N 天后再见」（D48）；天数用 FSRS 的实际到期日，天数相同的字合并成一个分句（core/first-result.js daysLaterLine，E9c）。
//   useReminderInvite / ReminderInvite / InviteActions  提醒邀请（D35）：内嵌不弹窗，作品落定（印落下）约 600ms 后淡入；点「好」才请求系统通知权限
//                   （platform/reminder.js inviteReminder）；最多邀请两次（首练结果页一次，没回应则下一次「今天的练习」结果页再一次，D46 ③；规则在
//                   core/first-result.js inviteDecision）。R2-R1（N2-04 / N2-05 / I2-07）：回答之前，吸底栏就是「好 / 不用了」（InviteActions），说明块在正文里
//                   （ReminderInvite）；回答以后吸底栏才换成别的（首练：「完成」+ 文字按钮「再写一组」）。
//
// data-testid：result-preview、
//   result-invite（说明块；data-state = invite | pending（点了「好」、系统权限弹窗还没回应，Q2-5）| accepted | denied）、result-invite-title、result-invite-body、
//   result-invite-actions（吸底栏里的回答，data-state = wait | invite | pending）、result-invite-yes、result-invite-no、
//   result-invite-accepted、result-invite-denied、result-invite-time（「改时间」按钮）、result-invite-time-input、result-invite-fail。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { now as envNow } from '../../../platform/env.js';
import { inviteChangeTime, inviteReminder, maskedWord } from '../../../platform/reminder.js';
import { cardForKey } from '../../../data/deck.js';
import {
  commitInviteAnswer, commitInviteShown, daysLaterLine, daysLaterText, inviteDecision, inviteTime, inviteTimeText, reviewDays,
} from '../../../core/first-result.js';
import { parseTime, settingsView } from '../mine/settings.js';

/** 提醒邀请在作品落定（印落下）后多久淡入（ms，设计稿 §三）。 */
export const INVITE_DELAY_MS = 600;

injectStyles('result-first', `
.sz-result__preview{margin:20px 0 0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-invite{display:grid;gap:4px;padding-top:16px;border-top:${T.hair} solid ${T.line}}
.sz-invite--in{animation:szInviteIn 300ms ease-out both}
@keyframes szInviteIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.sz-invite--in,.sz-invite__foot--in{animation:none}}
/* 吸底栏里的回答：主按钮「好」+ 文字按钮「不用了」，与结果页别的底栏同一个位置；该问但没到时候时占位（不透明度 0、不可点） */
.sz-invite__foot{display:flex;flex-direction:column;align-items:stretch;gap:2px}
.sz-invite__foot--in{animation:szInviteIn 200ms ease-out both}
.sz-invite__foot--wait{opacity:0;pointer-events:none}
.sz-invite__foot .sz-btn--text{align-self:center}
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
 * 复现句（纯函数；单测直接调用）：「「求」明天再见，「据」「类」3 天后再见。」（D48，天数同 FSRS 到期日）。
 * 首练结果页（variant === 'first'）在它前面多一句关于「拾」的话（C3-H / N3-01、D53 ④，03 P245）——首页那个品牌字就是首练的第三个字：
 *   写成了（作品里有「拾」）→「你写下的第一个「拾」。」（与首页格下同一句）；
 *   没写成（有「拾」这一格，但没进作品：写错 / 看过答案 / 跳过）→「「拾」就是首页那个字。」，说一次。
 * @param {{cells:Array, sched:object, today:string, work?:object|null, variant?:string}} o  cells = resultModel().cells，work = resultModel().work
 * @returns {{preview:string}}  没有可预告的字（都是跳过 / 看过答案）且没有「拾」那句时 preview 为 ''
 */
export function firstExtras({ cells, sched, today, work = null, variant = '' }) {
  const judged = (cells || []).filter(c => c.kind === 'judged');
  const later = daysLaterLine({ chars: judged.map(c => ({ char: c.char, cardKey: c.cardKey })), sched: sched || {}, today }, t);
  let shi = null;
  if (variant === 'first') {
    const mark = t('X-HOME.shiLabel');
    const inWork = !!work && (work.cells || []).some(c => c.char === mark);
    const inGroup = inWork || (cells || []).some(c => c.char === mark);
    if (inWork) shi = 'written';
    else if (inGroup) shi = 'missed';
  }
  const lead = shi === 'written' ? t('X-FIRST.shiWritten') : shi === 'missed' ? t('X-FIRST.shiHome') : '';
  return { preview: lead + later };
}

/**
 * 每字「N 天后再见」的数据与文案（D48，P185；结果页的复现句用它的合并版 firstExtras）。
 * @param {{cells:Array, sched:object, today:string}} o  cells = resultModel().cells
 * @returns {Array<{char:string, cardKey:string, days:number, text:string}>}  只有 judged 的字（有 FSRS 调度），按组内顺序
 */
export function daysLaterOf({ cells, sched, today }) {
  const judged = (cells || []).filter(c => c.kind === 'judged');
  return reviewDays({ chars: judged.map(c => ({ char: c.char, cardKey: c.cardKey })), sched: sched || {}, today })
    .map(d => ({ ...d, text: daysLaterText(d.days, t) }));
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
 * 提醒邀请的状态（一个 hook；结果页拿着它同时画正文里的说明块 InviteBlock 与吸底栏里的「好 / 不用了」InviteActions，R2-R1 / N2-04 / I2-07）。
 * @param {{store:object, settings:object|null, session:object|null, variant:'first'|'daily'|'picked', ready?:boolean}} o
 *   ready：作品落定了（落印那一帧，D51 ②）；邀请从这时起再等 INVITE_DELAY_MS 才淡入。
 * @returns {{show:boolean, phase:string, active:boolean, reserved:boolean, waiting:boolean, ...}}
 *   active = 说明块与「好 / 不用了」都在（invite / pending）；reserved = 该问但还没到时候（wait）：吸底栏先占住位置、看不见、不可点，免得邀请出现时布局跳。
 */
export function useReminderInvite({ store, settings, session, variant, ready = true }) {
  const sessionId = session ? session.id : '';
  const show = inviteDecision({ settings, variant, sessionId }) === 'show';
  const [phase, setPhase] = useState('wait'); // wait → invite → (pending →) accepted | denied | gone
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [evening, setEvening] = useState(false);

  // 作品落定约 600ms 后淡入；显示出来那一刻记一次邀请（次数按显示算，同一会话不重复）
  useEffect(() => {
    if (phase !== 'wait' || !show || !store || !ready) return undefined;
    const timer = setTimeout(() => {
      const r = commitInviteShown(store, { sessionId });
      if (r && r.ok === false) return; // 写不进去就不问（不让「问了几次」失真）
      setEvening(inviteTime(envNow()).evening);
      setPhase('invite');
    }, INVITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, show, sessionId, ready]);

  // 点「好」之后系统权限被拒（原生回 permission = denied）：变成一行说明，以后不再问
  const remind = settingsView(settings).remind;
  useEffect(() => {
    if ((phase !== 'accepted' && phase !== 'pending') || remind.permission !== 'denied' || !store) return;
    commitInviteAnswer(store, 'denied');
    setEditing(false);
    setPhase('denied');
  }, [phase, remind.permission]);
  // Q2-5（复测 simB D6，交接 §4.6）：点「好」后系统权限弹窗还没回应时（权限还是「未知」且这次真的发出了请求），块保持原状、按钮不可再点；
  // 原生回报授权结果（shiziReminderStatus → settings.remind.permission 变成 granted / denied）后才换成「好，明天…」或拒绝说明。
  useEffect(() => {
    if (phase === 'pending' && remind.permission === 'granted') setPhase('accepted');
  }, [phase, remind.permission]);

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
    setPhase(r.requested && remind.permission === 'unknown' ? 'pending' : 'accepted');
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

  return {
    show, phase, session, remind, editing, setEditing, failed, evening, accept, decline, changeTime,
    active: phase === 'invite' || phase === 'pending',
    reserved: show && phase === 'wait',
    waiting: phase === 'pending',
  };
}

/** 吸底栏里的邀请回答：「好」是主按钮、「不用了」是文字按钮（N2-04 方案 A）；该问但还没到时候时占位（看不见、不可点）。 */
export function InviteActions({ invite }) {
  const waiting = invite.waiting;
  const hiddenNow = invite.reserved;
  return html`<div class=${hiddenNow ? 'sz-invite__foot sz-invite__foot--wait' : 'sz-invite__foot sz-invite__foot--in'} data-testid="result-invite-actions"
    data-state=${hiddenNow ? 'wait' : waiting ? 'pending' : 'invite'} aria-hidden=${hiddenNow ? 'true' : null}>
    <${Button} variant="primary" data-testid="result-invite-yes" disabled=${waiting || hiddenNow} onClick=${invite.accept}>${t('X-INVITE.yes')}</${Button}>
    <${Button} variant="text" data-testid="result-invite-no" disabled=${waiting || hiddenNow} onClick=${invite.decline}>${t('X-INVITE.no')}</${Button}>
  </div>`;
}

/** 正文里的邀请说明块（标题 + 说明；回答后换成一行结果）。按钮不在这里，在吸底栏（InviteActions）。 */
export function ReminderInvite({ invite }) {
  const { phase, session, remind, editing, setEditing, failed, evening, changeTime } = invite;
  if (phase === 'wait' || phase === 'gone') return null;
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
  const waiting = phase === 'pending';
  return html`<div class="sz-invite sz-invite--in" data-testid="result-invite" data-state=${waiting ? 'pending' : 'invite'} aria-busy=${waiting ? 'true' : null}>
    <p class="sz-invite__title" data-testid="result-invite-title">${t(evening ? 'X-INVITE.titleEvening' : 'X-INVITE.title')}</p>
    <p class="sz-invite__body" data-testid="result-invite-body">${example ? t('X-INVITE.body', example) : t('X-INVITE.bodyPlain')}</p>
    ${failed ? html`<p class="sz-invite__note" data-testid="result-invite-fail" aria-live="polite">${t('X-SETTINGS.saveFailed')}</p>` : null}
  </div>`;
}
