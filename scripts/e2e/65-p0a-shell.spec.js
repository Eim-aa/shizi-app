// 阶段 0 卡 P0-A：外壳层叠、按压反馈、状态栏遮罩、输入框、弹层把手、墨墙最淡档、笔锋门控（ADA 汇总 §6 的 A1 A4 A8 A11 A12 A3 B5）。
//
//   A1 推入转场叠层：每个 .sz-layer 自成层叠上下文；写错过清单 → 写字页的推入转场里（暂停动画逐点采样），
//      被新页盖住的位置 elementFromPoint 命中新页，不命中下层页的「全选」「‹」。

import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';

const CLOCK = '2026-09-30T10:00:00';

function msOf(day, hms = '08:00:00') {
  return new Date(`${day}T${hms}`).getTime();
}

function rec(serial, char, judgment, day) {
  return {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's900', kind: 'judged', judgment, at: msOf(day) + serial * 1000,
    localDay: day, help: { hints: 0, answerSeen: false, traced: false },
  };
}

/** reset + setClock + seed 写错过的字 → 字库 tab 根（与 31-lists 同法）。 */
async function seedWrong(page) {
  const records = [rec(1, '和', 'wrong', '2026-09-21'), rec(2, '永', 'wrong', '2026-09-20')];
  const res = await page.evaluate(async ({ records: rs, clock }) => {
    const { applyJudgment } = await import('/src/core/fsrs.js');
    const { nav } = await import('/src/ui/router.js');
    await import('/src/ui/screens/library/list.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(clock);
    const byMonth = {};
    for (const r of rs) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
    const sched = {};
    for (const r of rs) sched[r.cardKey] = applyJudgment(sched[r.cardKey], r).entry;
    for (const key of Object.keys(sched)) sched[key] = { ...sched[key], due: '2026-10-05' };
    const out = window.__shiziTest.seed({ records: byMonth, sched, sessions: { A: null, B: null, lastEnded: {} } });
    nav.switchTab('library');
    return { ok: !!(out && out.ok), out };
  }, { records, clock: CLOCK });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.out));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
}

async function openWrongList(page) {
  await page.evaluate(async () => {
    const { openList } = await import('/src/ui/screens/library/list.js');
    openList('wrong');
  });
  await page.waitForSelector(topSel('list-screen'));
  await waitNavIdle(page);
}

/**
 * 点 trigger 后抓住转场动画并暂停，按 currentTime 逐点采样 targets（转场开始前顶层页里的元素中心）：
 * 被「移动层」盖住的点（push 是新页，pop 是出栈页）elementFromPoint 必须命中移动层；push 时还不得命中下层（旧顶层）页。
 */
async function sampleTransition(page, { trigger, targets, kind }) {
  return page.evaluate(async ({ trigger: trig, targets: sels, kind: k }) => {
    const oldLayer = document.querySelector('.sz-layer[data-top="true"]');
    const centerOf = el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    // push：采样旧顶层页里的控件（它们不该压到新页上）；pop：采样出栈页自己的控件，并在下层页里再取一批。
    const pts = sels.map(sel => oldLayer.querySelector(sel)).filter(Boolean).map(centerOf);
    if (k === 'pop') {
      const layers = [...document.querySelectorAll('.sz-layer')];
      const below = layers[layers.indexOf(oldLayer) - 1];
      for (const el of below ? below.querySelectorAll('button') : []) pts.push(centerOf(el));
    }
    oldLayer.querySelector(trig).click();
    let moving = null;
    for (let i = 0; i < 30 && !moving; i += 1) {
      await new Promise(r => requestAnimationFrame(r));
      moving = document.querySelector('.sz-layer--moving');
    }
    if (!moving) return { error: 'no moving layer' };
    const anims = moving.getAnimations();
    if (!anims.length) return { error: 'no animation on moving layer' };
    for (const a of anims) a.pause();
    const out = [];
    for (let ms = 0; ms <= 290; ms += 30) {
      for (const a of anims) a.currentTime = ms;
      await new Promise(r => requestAnimationFrame(r));
      const r = moving.getBoundingClientRect();
      pts.forEach((pt, i) => {
        const hit = document.elementFromPoint(pt.x, pt.y);
        const covered = pt.x >= r.left + 1 && pt.x <= r.right - 1;
        out.push({
          ms, i, covered, left: Math.round(r.left),
          inMoving: !!hit && moving.contains(hit),
          inOld: !!hit && oldLayer !== moving && oldLayer.contains(hit),
          hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 30)}` : null,
        });
      });
    }
    for (const a of anims) a.finish();
    return { out };
  }, { trigger, targets, kind });
}

export default async function p0aShell(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await seedWrong(page);

  // ------------------------------------------------------------------ A4 按压反馈（G16）
  // 不靠 :active（iOS WebKit 没有 touchstart 监听时 :active 不生效），改 pointerdown / up / cancel / leave 切 data-pressed。
  // 对象：Tab 条（Tabs 组件）与一个列表行（字库页的「字库」切换行），它们都是 Button variant=plain。
  step('A4: pointerdown on a Tab sets data-pressed; it scales to .97 and darkens in ~80ms, release clears it');
  const tab = topSel('tab-home');
  const pressState = async sel => page.evaluate(s => {
    const el = document.querySelector(s);
    const cs = getComputedStyle(el);
    return { attr: el.getAttribute('data-pressed'), transform: cs.transform, filter: cs.filter };
  }, sel);
  const box = await page.locator(tab).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  assert.equal((await pressState(tab)).attr, null, 'not pressed before pointerdown');
  await page.mouse.down();
  await page.waitForTimeout(140); // > 80ms 过渡
  let ps = await pressState(tab);
  assert.equal(ps.attr, 'true', 'data-pressed=true while the pointer is down');
  assert.equal(ps.transform, 'matrix(0.97, 0, 0, 0.97, 0, 0)', `pressed scale .97 (${ps.transform})`);
  assert.equal(ps.filter, 'brightness(0.94)', `pressed darkens ~6% (${ps.filter})`);
  // 移出控件：pointerleave 清掉（也不会触发点击）
  await page.mouse.move(cx, cy - 400);
  await page.waitForTimeout(40);
  assert.equal((await pressState(tab)).attr, null, 'pointerleave clears data-pressed');
  await page.mouse.up();
  await page.waitForTimeout(220); // 160ms 回弹
  ps = await pressState(tab);
  assert.equal(ps.transform, 'none', 'released back to rest');
  assert.equal(ps.filter, 'none', 'released filter cleared');

  step('A4: pointercancel clears data-pressed on a list row; a disabled button never shows the pressed look');
  const lib = topSel('library-switch');
  const lbox = await page.locator(lib).boundingBox();
  await page.mouse.move(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
  await page.mouse.down();
  assert.equal((await pressState(lib)).attr, 'true', 'row: data-pressed set on pointerdown');
  await page.evaluate(s => document.querySelector(s).dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })), lib);
  assert.equal((await pressState(lib)).attr, null, 'pointercancel clears data-pressed');
  await page.mouse.move(cx, cy - 400);
  await page.mouse.up();
  const disabledPressed = await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'sz-btn sz-btn--primary';
    b.disabled = true;
    document.body.appendChild(b);
    b.setAttribute('data-pressed', 'true');
    const cs = getComputedStyle(b);
    const out = { transform: cs.transform, filter: cs.filter };
    b.remove();
    return out;
  });
  assert.deepEqual(disabledPressed, { transform: 'none', filter: 'none' }, 'CSS: disabled never shows the pressed look');

  step('A4: prefers-reduced-motion → colour change only, no scale');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(140);
  ps = await pressState(tab);
  assert.equal(ps.attr, 'true', 'reduced motion: data-pressed still set');
  assert.equal(ps.transform, 'none', `reduced motion: no scale (${ps.transform})`);
  assert.equal(ps.filter, 'brightness(0.94)', 'reduced motion: still darkens');
  await page.mouse.move(cx, cy - 400);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await openWrongList(page);

  // ------------------------------------------------------------------ A1 推入转场叠层（G13）
  step('A1: during the list → write push, covered points hit the new page, never the list 全选 / ‹');
  const push = await sampleTransition(page, { trigger: '[data-testid="list-go"]', targets: ['[data-testid="list-toggle-all"]', '[data-testid="page-back"]'], kind: 'push' });
  assert.ok(!push.error, `captured the push animation (${push.error || 'ok'})`);
  assert.ok(push.out.filter(s => s.covered).length >= 6, `sampled ${push.out.filter(s => s.covered).length} covered points`);
  assert.deepEqual(push.out.filter(s => s.covered && (!s.inMoving || s.inOld)), [], 'push: covered points always belong to the incoming page');
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);

  step('A1: during the write → list pop, the points under the sliding-out page never show the list page through its stacking');
  const pop = await sampleTransition(page, { trigger: '[data-testid="page-back"]', targets: ['[data-testid="page-back"]'], kind: 'pop' });
  assert.ok(!pop.error, `captured the pop animation (${pop.error || 'ok'})`);
  assert.deepEqual(pop.out.filter(s => s.covered && !s.inMoving), [], 'pop: points still covered by the outgoing page belong to it');
  await page.waitForSelector(topSel('list-screen'));
  await waitNavIdle(page);

  step('A1: every .sz-layer is its own stacking context (isolation:isolate)');
  const iso = await page.evaluate(() => [...document.querySelectorAll('.sz-layer')].map(el => getComputedStyle(el).isolation));
  assert.ok(iso.length >= 2 && iso.every(v => v === 'isolate'), `layers isolate: ${JSON.stringify(iso)}`);
}
