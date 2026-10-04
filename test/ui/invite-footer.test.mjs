// 首练结果页吸底栏分两步（R2-R1 / N2-04 / N2-05 / I2-07；03 P217）：提醒邀请没回答前，吸底栏就是「好」（主按钮）+「不用了」（文字按钮）；
// 该问但还没到时候时占位（看不见、不可点）；回答以后才换成「完成」+「再写一组」（在 e2e 72-p1e5 里量 375×667 与 390×844 的首屏）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { InviteActions, ReminderInvite, INVITE_DELAY_MS } from '../../src/ui/screens/result/first.js';
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
const invite = over => ({ accept: () => calls.push('accept'), decline: () => calls.push('decline'), waiting: false, reserved: false, ...over });
const buttons = v => find(v, x => x.props && x.props['data-testid'] && /^result-invite-(yes|no)$/.test(x.props['data-testid']));

test('InviteActions: 好 is the primary button, 不用了 the text button, both wired to the invitation', () => {
  const v = InviteActions({ invite: invite({}) });
  const [yes, no] = buttons(v);
  assert.deepEqual([yes.props.variant, no.props.variant], ['primary', 'text']);
  assert.deepEqual([yes.props.children, no.props.children], [t('X-INVITE.yes'), t('X-INVITE.no')].map(x => x));
  assert.deepEqual([yes.props.disabled, no.props.disabled], [false, false]);
  assert.equal(v.props['data-state'], 'invite');
  assert.equal(v.props['aria-hidden'], null);
  yes.props.onClick();
  no.props.onClick();
  assert.deepEqual(calls, ['accept', 'decline']);
});

test('InviteActions: before the question is due the footer only keeps the place — invisible, aria-hidden, disabled; while the system permission is pending the buttons are disabled', () => {
  const wait = InviteActions({ invite: invite({ reserved: true }) });
  assert.equal(wait.props['data-state'], 'wait');
  assert.equal(wait.props['aria-hidden'], 'true');
  assert.match(wait.props.class, /sz-invite__foot--wait/);
  assert.ok(buttons(wait).every(b => b.props.disabled === true), 'cannot be tapped (or focused) while hidden');
  const pending = InviteActions({ invite: invite({ waiting: true }) });
  assert.equal(pending.props['data-state'], 'pending');
  assert.ok(buttons(pending).every(b => b.props.disabled === true), 'disabled while the system permission prompt is open (Q2-5)');
});

test('ReminderInvite (the block in the page) no longer holds the buttons; nothing before the question is due, and after an answer only the one-line result', () => {
  const base = { session: null, remind: { hour: 9, minute: 30, permission: 'granted' }, editing: false, setEditing() {}, failed: false, evening: false, changeTime() {} };
  assert.equal(ReminderInvite({ invite: { ...base, phase: 'wait' } }), null);
  assert.equal(ReminderInvite({ invite: { ...base, phase: 'gone' } }), null);
  const asking = ReminderInvite({ invite: { ...base, phase: 'invite' } });
  assert.equal(find(asking, x => x.props && /^result-invite-(yes|no)$/.test(x.props['data-testid'] || '')).length, 0, 'the answers live in the sticky footer now');
  assert.equal(find(asking, x => x.props && x.props['data-testid'] === 'result-invite-title').length, 1);
  assert.equal(find(ReminderInvite({ invite: { ...base, phase: 'accepted' } }), x => x.props && x.props['data-testid'] === 'result-invite-accepted').length, 1);
  assert.equal(INVITE_DELAY_MS, 600, 'the question fades in 600ms after the seal lands (the delay is counted from the landing, not from the page opening)');
});
