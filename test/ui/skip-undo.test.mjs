// 阶段 0 B2（G23 / D36 / P115）：跳过撤销条的寿命。
//   5 秒（原 3 秒）；手指按在撤销条上时暂停计时、松开继续（剩余时间不重置）；
//   读屏 / 切换控制运行时不自动收起（到下一次操作才收起）；读屏中途关闭则重新给一整段时间。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import { SKIP_UNDO_MS, createUndoLifetime } from '../../src/ui/screens/write/skip.js';

function clock() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    set: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear: id => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

function make(opts = {}) {
  const c = clock();
  let expired = 0;
  const assistive = { on: !!opts.assistive };
  const life = createUndoLifetime({
    ms: opts.ms ?? 5000,
    now: c.now,
    set: c.set,
    clear: c.clear,
    assistive: () => assistive.on,
    pauseWhileHeld: opts.pauseWhileHeld ?? true,
    onExpire: () => { expired += 1; },
  });
  return { c, life, assistive, expired: () => expired };
}

test('policy.skipUndo (P115, D36): 5 s, pause while held, keep open under assistive tech', () => {
  assert.deepEqual({ ...policy.skipUndo }, { ms: 5000, pauseWhileHeld: true, keepOpenWithAssistiveTech: true });
  assert.equal(SKIP_UNDO_MS, 5000);
  assert.ok(Object.isFrozen(policy.skipUndo));
});

test('expires after 5 seconds, not 3', () => {
  const t = make();
  t.life.start();
  t.c.advance(3000);
  assert.equal(t.expired(), 0, 'still there at 3 s');
  t.c.advance(1999);
  assert.equal(t.expired(), 0, 'still there at 4.999 s');
  t.c.advance(1);
  assert.equal(t.expired(), 1, 'gone at 5 s');
  t.c.advance(10000);
  assert.equal(t.expired(), 1, 'only once');
});

test('holding the bar pauses the clock; releasing resumes with the time that was left', () => {
  const t = make();
  t.life.start();
  t.c.advance(3000); // 剩 2 秒
  t.life.hold();
  assert.equal(t.c.pending(), 0, 'no timer while held');
  t.c.advance(60000);
  assert.equal(t.expired(), 0, 'a long press never expires the bar');
  t.life.release();
  t.c.advance(1999);
  assert.equal(t.expired(), 0, 'resumes with 2 s left, not a fresh 5 s and not zero');
  t.c.advance(1);
  assert.equal(t.expired(), 1);
});

test('hold twice / release without hold are harmless; pauseWhileHeld=false ignores holds', () => {
  const t = make();
  t.life.start();
  t.life.release();
  t.life.hold();
  t.life.hold();
  t.c.advance(1000); // 在 0 秒处按下、按了 1 秒：不扣时间
  t.life.release();
  t.life.release();
  t.c.advance(4999);
  assert.equal(t.expired(), 0);
  t.c.advance(1);
  assert.equal(t.expired(), 1);
  const u = make({ pauseWhileHeld: false });
  u.life.start();
  u.life.hold();
  u.c.advance(5000);
  assert.equal(u.expired(), 1, 'hold does nothing when the policy turns it off');
});

test('with VoiceOver / Switch Control running the bar is not collapsed by the clock', () => {
  const t = make({ assistive: true });
  t.life.start();
  t.c.advance(60000);
  assert.equal(t.expired(), 0, 'stays until the next action dismisses it');
});

test('assistive tech switched off while the bar is up → a full fresh period; switched on mid-way → pinned at the deadline', () => {
  const t = make({ assistive: true });
  t.life.start();
  t.c.advance(7000);
  t.assistive.on = false;
  t.life.assistiveChanged(false);
  t.c.advance(4999);
  assert.equal(t.expired(), 0);
  t.c.advance(1);
  assert.equal(t.expired(), 1, 'full 5 s counted from the moment it was switched off');

  const u = make();
  u.life.start();
  u.c.advance(2000);
  u.assistive.on = true; // 到点时才看当时的状态
  u.c.advance(3000);
  assert.equal(u.expired(), 0, 'deadline reached while assistive tech is on: kept');
  u.life.assistiveChanged(true);
  u.c.advance(60000);
  assert.equal(u.expired(), 0);
});

test('stop() cancels everything (dismiss / unmount)', () => {
  const t = make();
  t.life.start();
  t.life.stop();
  t.c.advance(10000);
  assert.equal(t.expired(), 0);
  assert.equal(t.c.pending(), 0);
  t.life.hold();
  t.life.release();
  assert.equal(t.c.pending(), 0, 'a stopped clock does not restart on release');
});

test('until: a clock started with an absolute deadline counts the remaining time (hand-over to the result page)', () => {
  const c = clock();
  let expired = 0;
  c.advance(1000);
  const life = createUndoLifetime({ ms: 5000, until: 3500, now: c.now, set: c.set, clear: c.clear, assistive: () => false, onExpire: () => { expired += 1; } });
  life.start();
  c.advance(2499);
  assert.equal(expired, 0);
  c.advance(1);
  assert.equal(expired, 1, 'expires at the absolute deadline');
});
