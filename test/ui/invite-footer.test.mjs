// 首练 / 第二次提醒邀请不阻塞主操作（I3 · P0-03；规范 B3、D55 ⑤）：
// 邀请的「好 / 不用了」放在正文的邀请块里；吸底栏始终是本页原有的主按钮（首练「完成」+ 文字按钮「再写一组」），邀请出现前、出现中、回答后位置都不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as first from '../../src/ui/screens/result/first.js';
import { ReminderInvite, INVITE_DELAY_MS } from '../../src/ui/screens/result/first.js';
import { t } from '../../src/config/copy/index.js';

function find(vnode, pred, out = []) {
  if (!vnode || typeof vnode !== 'object') return out;
  if (Array.isArray(vnode)) {
    vnode.forEach(v => find(v, pred, out));
    return out;
  }
  if (pred(vnode)) out.push(vnode);
  const kids = vnode.props && vnode.props.children;
  if (kids !== undefined) find(kids, pred, out);
  return out;
}

const calls = [];
const base = { session: null, remind: { hour: 9, minute: 30, permission: 'granted' }, editing: false, setEditing() {}, failed: false, evening: false, changeTime() {},
  accept: () => calls.push('accept'), decline: () => calls.push('decline'), waiting: false };
const answers = v => find(v, x => x.props && /^result-invite-(yes|no)$/.test(x.props['data-testid'] || ''));

test('the invitation block carries 好 / 不用了 itself: 好 is a secondary button, 不用了 a text button, both wired; the primary button stays in the footer', () => {
  const v = ReminderInvite({ invite: { ...base, phase: 'invite' } });
  const [yes, no] = answers(v);
  assert.deepEqual([yes.props.variant, no.props.variant], ['secondary', 'text']);
  assert.deepEqual([yes.props.children, no.props.children], [t('X-INVITE.yes'), t('X-INVITE.no')]);
  assert.deepEqual([yes.props.disabled, no.props.disabled], [false, false]);
  yes.props.onClick();
  no.props.onClick();
  assert.deepEqual(calls, ['accept', 'decline']);
});

test('while the system permission prompt is open the buttons are disabled; before the question is due and after an answer there are none', () => {
  const pending = ReminderInvite({ invite: { ...base, phase: 'pending', waiting: true } });
  assert.ok(answers(pending).length === 2 && answers(pending).every(b => b.props.disabled === true), 'disabled while waiting (Q2-5)');
  assert.equal(ReminderInvite({ invite: { ...base, phase: 'wait' } }), null);
  assert.equal(ReminderInvite({ invite: { ...base, phase: 'gone' } }), null);
  assert.equal(answers(ReminderInvite({ invite: { ...base, phase: 'accepted' } })).length, 0);
  assert.equal(INVITE_DELAY_MS, 600, 'the question fades in 600ms after the seal lands');
});

test('the footer no longer has an invitation mode (InviteActions is gone, the result page does not branch on invite.active / reserved)', () => {
  assert.equal(first.InviteActions, undefined);
  const src = readFileSync(new URL('../../src/ui/screens/result/index.js', import.meta.url), 'utf8');
  assert.ok(!/InviteActions|invite\.active|invite\.reserved/.test(src), 'result/index.js footer ignores the invitation');
});
