// 首练结果页专属的区块（阶段 1 P1-E5；设计稿「首练与首页」§三；D28 D35 D41 D46 ③）。
//
// 分界（与 P1-E7「作品出口」）：result/index.js 管通用的结果页结构，作品构图（格子、落款、「没放进图里」的行与「放进去」）在
// result/work.js，首练与日常结果页共用（P1-E7）；本文件只放首练（以及「今天的练习」结果页的第二次邀请）特有的两块：
//   ReviewPreview   复现句：每字「N 天后再见」（D48）；天数用 FSRS 的实际到期日，天数相同的字合并成一个分句（core/first-result.js daysLaterLine，E9c）。
//   useReminderInvite / ReminderInvite  提醒邀请（D35；C3-H / T3-12、D53：首练页最多两句话——复现句 + 邀请的问句，邀请说明 X-INVITE.body 只在「今天的练习」那次出现；
//                   按钮写出结果「好，明天给我一个词」/「先不用」）：内嵌不弹窗，作品落定（印落下）约 600ms 后淡入；点「好」才请求系统通知权限
//                   （platform/reminder.js inviteReminder）；最多邀请两次（首练结果页一次，没回应则下一次「今天的练习」结果页再一次，D46 ③；规则在
//                   core/first-result.js inviteDecision）。R5-I3（P0-03，规范 B3）：「好 / 不用了」与说明都在正文的邀请块里（ReminderInvite），
//                   吸底栏始终是本页的主按钮（首练：「完成」+ 文字按钮「再写一组」），不被邀请替换。
//
// data-testid：result-preview、
//   result-invite（说明块；data-state = invite | pending（点了「好」、系统权限弹窗还没回应，Q2-5）| accepted | denied）、result-invite-title、result-invite-body、
//   result-invite-actions（吸底栏里的回答，data-state = wait | invite | pending）、result-invite-yes、result-invite-no、
//   result-invite-accepted、result-invite-denied、result-invite-time（「改时间」按钮）、result-invite-time-input、result-invite-fail。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { M } from '../../../config/motion.js';
import { FailBlock } from '../../components/FailBlock.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { now as envNow } from '../../../platform/env.js';
import { inviteChangeTime, inviteReminder, maskedWord } from '../../../platform/reminder.js';
import { cardForKey } from '../../../data/deck.js';
import { commitInviteAnswer, commitInviteShown, inviteDecision, inviteTime, inviteTimeText } from '../../../core/first-result.js';
import { parseTime, settingsView } from '../mine/prefs.js';

/** 提醒邀请在作品落定（印落下）后多久淡入（ms，设计稿 §三；motion.moment.inviteDelay）。 */
export const INVITE_DELAY_MS = M.moment.inviteDelay;

injectStyles('result-first', `
.sz-result__preview{margin:20px 0 0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-invite{display:grid;gap:4px;padding-top:16px;border-top:${T.hair} solid ${T.line}}
.sz-invite--in{animation:szInviteIn ${T.dPush} ${T.eOut} both}
@keyframes szInviteIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes szInviteFade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.sz-invite--in{animation:szInviteFade ${T.dReduce} ${T.eLinear} both}} /* 减少动态效果：150ms 淡化、不位移（D58 ②） */
.sz-invite__title{margin:0;font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-invite__body{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-wrap:pretty}
.sz-invite__line{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-invite__acts{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.sz-invite__acts .sz-btn--secondary{width:auto;min-height:${T.hit};padding:0 22px;font-size:${T.fs15};line-height:${T.lh15}}
/* 「改时间」：外观是文字按钮，里面盖着一个透明的 <input type=time>——点一下直接弹时间轮（I3 · P1-21） */
.sz-invite__timebtn{position:relative;display:inline-flex;align-items:center;min-height:${T.hit};padding:0 4px;margin-left:-4px;box-sizing:border-box;
  font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-invite__timetext{pointer-events:none}
.sz-invite__timeinput{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;padding:0;border:0;font-size:${T.fs17};cursor:pointer}
.sz-invite__note{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-blankbox{display:inline-block;width:.9em;height:.9em;box-sizing:border-box;margin:0 .06em;border:${T.frameW} solid ${T.frame};vertical-align:-.12em} /* 示例里被遮住的那个字：描边小方框（与写字页题面的空框同一画法，不用与「口」难分的 □，N2-13） */
`);

// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/result-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { firstExtras, daysLaterOf } from '../../../session/result-ops.js';
export { firstExtras, daysLaterOf };
export function ReviewPreview({ text }) {
  if (!text) return null;
  return html`<p class="sz-result__preview" data-testid="result-preview">${text}</p>`;
}

// ---------------------------------------------------------------- 提醒邀请

/**
 * 邀请说明里的示例：首练第一个字的题面词语（目标字位与锁屏同形：＿）+ 拼音；取不到词语时 null。
 * blanks[i]：word 的第 i 个字是不是被遮住的那一位——页面里这一位画成描边小方框，不画「＿」字符（N2-13）。
 */
export function inviteExample(session) {
  const key = session && Array.isArray(session.queue) ? session.queue[0] : null;
  const card = key ? cardForKey(key) : null;
  if (!card || !String(card.py || '').trim()) return null;
  const word = maskedWord(card);
  const blank = defaultPolicy.reminderBlank;
  return { word, pinyin: String(card.py).trim(), blanks: Array.from(word).map(ch => ch === blank) };
}

const WORD_SLOT = '\u0001';

/** 邀请正文：把示例词填进说明句，被遮住的字换成描边小方框（读屏读「空着的字」）。 */
export function inviteBody(example) {
  const [pre, post] = t('X-INVITE.body', { word: WORD_SLOT, pinyin: example.pinyin }).split(WORD_SLOT);
  const chars = Array.from(example.word);
  return [pre, ...chars.map((ch, i) => (example.blanks[i]
    ? html`<span key=${i} class="sz-blankbox" role="img" aria-label=${t('X-INVITE.blankLabel')} data-testid="result-invite-blank"></span>`
    : ch)), post];
}

/**
 * 提醒邀请的状态（一个 hook；结果页拿着它画正文里的邀请块 ReminderInvite，R5-I3 / P0-03）。
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
    let r;
    try {
      r = await inviteChangeTime(store, parsed);
    } catch (error) {
      r = { ok: false };
    }
    // 改不成就留在原来的时间，并说一句（失败不吞，S1 / I3 · P1-21）；设置页「提醒时间」同样可改
    setFailed(!!(r && r.ok === false));
  };

  return {
    show, phase, session, variant, remind, editing, setEditing, failed, evening, accept, decline, changeTime, dismissFail: () => setFailed(false),
    active: phase === 'invite' || phase === 'pending',
    reserved: show && phase === 'wait',
    waiting: phase === 'pending',
  };
}

/** 正文里的邀请块（标题 + 说明 + 「好 / 不用了」；回答后换成一行结果）。不占吸底栏：本页的主按钮始终可点（I3 · P0-03，规范 B3）。 */
export function ReminderInvite({ invite }) {
  const { phase, session, variant, remind, editing, setEditing, failed, evening, changeTime } = invite;
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
      ${failed ? html`<p class="sz-invite__note" data-testid="result-invite-fail">${t('X-SETTINGS.saveFailed')}</p>` : null}
      <div class="sz-invite__acts">
        <span class="sz-invite__timebtn" data-testid="result-invite-time">
          <span class="sz-invite__timetext" aria-hidden="true">${t('X-INVITE.changeTime')}</span>
          <input class="sz-invite__timeinput" type="time" step="60" value=${value} aria-label=${t('X-INVITE.changeTime')}
            data-testid="result-invite-time-input" onChange=${changeTime} />
        </span>
      </div>
    </div>`;
  }
  const example = inviteExample(session);
  const waiting = phase === 'pending';
  return html`<div class="sz-invite sz-invite--in" data-testid="result-invite" data-state=${waiting ? 'pending' : 'invite'} aria-busy=${waiting ? 'true' : null}>
    <p class="sz-invite__title" data-testid="result-invite-title">${t(evening ? 'X-INVITE.titleEvening' : 'X-INVITE.title')}</p>
    <p class="sz-invite__body" data-testid="result-invite-body">${example ? inviteBody(example) : t('X-INVITE.bodyPlain')}</p>
    ${failed ? html`${FailBlock({ speak: false, testid: 'result-invite-failure', noteTestid: 'result-invite-fail', retryTestid: 'result-invite-retry', cancelTestid: 'result-invite-cancel', text: t('X-SETTINGS.saveFailed'), cancelLabel: t('X-SETTINGS.cancel'), onCancel: invite.dismissFail, onRetry: invite.accept })}` : html`<div class="sz-invite__acts" data-testid="result-invite-actions" data-state=${waiting ? 'pending' : 'invite'}>
      <${Button} variant="secondary" data-testid="result-invite-yes" disabled=${waiting} onClick=${invite.accept}>${t('X-INVITE.yes')}</${Button}>
      <${Button} variant="text" data-testid="result-invite-no" disabled=${waiting} onClick=${invite.decline}>${t('X-INVITE.no')}</${Button}>
    </div>`}
  </div>`;
}
