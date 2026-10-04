// 阶段 0 卡 P0-A：外壳层叠、按压反馈、状态栏遮罩、输入框、弹层把手、墨墙最淡档、笔锋门控（ADA 汇总 §6 的 A1 A4 A8 A11 A12 A3 B5）。
//
//   A1 推入转场叠层：每个 .sz-layer 自成层叠上下文；写错过清单 → 写字页的推入转场里（暂停动画逐点采样），
//      被新页盖住的位置 elementFromPoint 命中新页，不命中下层页的「全选」「‹」。

import { bootTestHost, canvasInk, drawStroke, HORIZONTAL, openWrite, seedSession, topSel, waitNavIdle } from './helpers.mjs';

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
  step('A4: pointerdown on a Tab sets data-pressed; it scales to .97 and darkens in 120ms (D43 motion tokens), release clears it');
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
  await page.waitForTimeout(180); // > 120ms（--t-press）过渡
  let ps = await pressState(tab);
  assert.equal(ps.attr, 'true', 'data-pressed=true while the pointer is down');
  assert.equal(ps.transform, 'matrix(0.97, 0, 0, 0.97, 0, 0)', `pressed scale .97 (${ps.transform})`);
  assert.equal(ps.filter, 'brightness(0.94)', `pressed darkens ~6% (${ps.filter})`);
  // 移出控件：pointerleave 清掉（也不会触发点击）
  await page.mouse.move(cx, cy - 400);
  await page.waitForTimeout(40);
  assert.equal((await pressState(tab)).attr, null, 'pointerleave clears data-pressed');
  await page.mouse.up();
  await page.waitForTimeout(280); // 220ms（--t-release）回弹
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

  // D43（tokens.json motion.reduceMotion）：按下缩放保留，其余过渡改 120ms 线性（阶段 0 的「减少动态效果只变色不缩放」随 P109 改为已决定 D43）
  step('A4: prefers-reduced-motion → the press scale stays, easing is flattened to 120ms linear (D43)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(180);
  ps = await pressState(tab);
  assert.equal(ps.attr, 'true', 'reduced motion: data-pressed still set');
  assert.equal(ps.transform, 'matrix(0.97, 0, 0, 0.97, 0, 0)', `reduced motion: scale kept (${ps.transform})`);
  assert.equal(ps.filter, 'brightness(0.94)', 'reduced motion: still darkens');
  const reducedTiming = await page.evaluate(s => {
    const cs = getComputedStyle(document.querySelector(s));
    return { dur: cs.transitionDuration.split(',')[0].trim(), ease: cs.transitionTimingFunction.split(',')[0].trim() };
  }, tab);
  assert.deepEqual(reducedTiming, { dur: '0.12s', ease: 'linear' }, 'reduced motion: 120ms linear cross-fade');
  await page.mouse.move(cx, cy - 400);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ------------------------------------------------------------------ A8 内容滚进状态栏 / 灵动岛（G20）
  step('A8: the tab panel has a sticky paper-gradient mask at the top that never intercepts clicks (light + dark)');
  const readMask = async () => page.evaluate(() => {
    const panel = document.querySelector('.sz-layer[data-top="true"] .sz-tabroot__panel');
    const cs = getComputedStyle(panel, '::before');
    const rootCs = getComputedStyle(document.documentElement);
    let ruleText = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (error) { continue; }
      for (const r of rules) if (r.selectorText === '.sz-tabroot__panel::before') ruleText = r.cssText;
    }
    return {
      content: cs.content, position: cs.position, top: cs.top, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents, display: cs.display,
      bg: cs.backgroundImage, paper: rootCs.getPropertyValue('--paper').trim(), ruleText,
    };
  });
  const rgbOf = hex => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
  };
  await page.emulateMedia({ colorScheme: 'light' });
  const maskLight = await readMask();
  assert.equal(maskLight.content, '""', 'mask pseudo-element exists (content "")');
  assert.deepEqual([maskLight.position, maskLight.top, maskLight.zIndex, maskLight.display], ['sticky', '0px', '2', 'block'], 'sticky top:0, z-index 2');
  assert.equal(maskLight.pointerEvents, 'none', 'mask has pointer-events:none (never intercepts taps)');
  assert.ok(/safe-area-inset-top/.test(maskLight.ruleText || ''), 'mask height / pull-up use env(safe-area-inset-top)');
  assert.ok(maskLight.bg.startsWith('linear-gradient(') && maskLight.bg.includes(rgbOf(maskLight.paper)), `light: gradient starts from the paper token (${maskLight.paper})`);
  await page.emulateMedia({ colorScheme: 'dark' });
  const maskDark = await readMask();
  assert.ok(maskDark.paper && maskDark.paper !== maskLight.paper, `dark paper token differs (${maskLight.paper} → ${maskDark.paper})`);
  assert.ok(maskDark.bg.includes(rgbOf(maskDark.paper)), 'dark: gradient follows the dark paper token');
  await page.emulateMedia({ colorScheme: 'light' });
  const hitTop = await page.evaluate(() => {
    const panel = document.querySelector('.sz-layer[data-top="true"] .sz-tabroot__panel');
    const r = panel.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + 1);
    return !!el && panel.contains(el);
  });
  assert.ok(hitTop, 'a point at the very top of the panel still lands in the page content / panel');

  // ------------------------------------------------------------------ 查字弹层：A11 输入框与说明段落、A12 弹层把手
  await page.click(topSel('library-query-open'));
  await page.waitForSelector('[data-testid="query-sheet"]');
  await waitNavIdle(page);

  // ------------------------------------------------------------------ A11 输入框光标色、说明段落断行（G44 部分）
  // 光标用主墨 --ink1（浅 / 深取设计令牌），不用朱色：D33「朱色只用于写错的朱点与印章」。
  step('A11: input caret is ink (--ink1), not the system blue; explanatory paragraphs use text-wrap:pretty');
  const caretOf = () => page.evaluate(() => {
    const input = document.querySelector('[data-testid="query-input"]');
    // 文字色换成红：caret-color:auto 会跟着文字色走（桌面）或用系统蓝（iOS），显式令牌则不变。
    input.style.color = 'rgb(255, 0, 0)';
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink1').trim();
    const p = document.querySelector('[data-testid="query-sheet"] p');
    const caret = getComputedStyle(input).caretColor;
    input.style.color = '';
    return { caret, ink, wrap: p ? getComputedStyle(p).textWrapStyle || getComputedStyle(p).textWrap : null };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  let cv = await caretOf();
  assert.equal(cv.caret, rgbOf(cv.ink), `light: caret-color = --ink1 (${cv.ink}); got ${cv.caret}`);
  assert.ok(/pretty/.test(cv.wrap || ''), `paragraph text-wrap is pretty (got ${cv.wrap})`);
  await page.emulateMedia({ colorScheme: 'dark' });
  cv = await caretOf();
  assert.equal(cv.caret, rgbOf(cv.ink), `dark: caret-color = --ink1 (${cv.ink}); got ${cv.caret}`);
  await page.emulateMedia({ colorScheme: 'light' });

  // ------------------------------------------------------------------ A12 去掉不能拖动的弹层把手（G12 部分）
  step('A12: the bottom sheet has no fake drag handle (DOM and CSS rule gone)');
  const handle = await page.evaluate(() => {
    let rule = false;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (error) { continue; }
      for (const r of rules) if (r.cssText && r.cssText.includes('sz-sheet__handle')) rule = true;
    }
    const sheet = document.querySelector('[data-testid="query-sheet"]');
    return { dom: document.querySelectorAll('.sz-sheet__handle').length, rule, firstTag: sheet.firstElementChild.tagName, aria: sheet.firstElementChild.getAttribute('aria-hidden') };
  });
  assert.equal(handle.dom, 0, 'no .sz-sheet__handle element');
  assert.equal(handle.rule, false, 'no .sz-sheet__handle style rule');
  assert.ok(handle.firstTag === 'H2' || handle.aria !== 'true', `sheet starts with real content (${handle.firstTag})`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-testid="query-sheet"]'));
  await waitNavIdle(page);

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

  // ------------------------------------------------------------------ A3 笔锋门控（G15）
  // iOS WebKit 把 hardwareConcurrency / deviceMemory 钳低；细节（飞白 / 洇墨）开着时，抬笔固化会借一张离屏层
  // （brush.js layerCache.take → document.createElement('canvas')），关着时不借。用「画一笔后新建的 canvas 数」观察开关。
  step('A3: hardwareConcurrency=2 / deviceMemory=2 → brush detail still on; reduced motion → off');
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 2, configurable: true });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2, configurable: true });
    window.__canvasMade = 0;
    const orig = Document.prototype.createElement;
    Document.prototype.createElement = function (name, ...rest) {
      if (String(name).toLowerCase() === 'canvas') window.__canvasMade += 1;
      return orig.call(this, name, ...rest);
    };
  });
  const strokeCanvases = async () => {
    await page.goto('about:blank'); // 同一地址再 goto 会当刷新、保留 history.state（页面栈），先离开
    await bootTestHost(page, ctx.baseURL);
    const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: ['永', '和', '春'], cursor: 0 });
    if (!seeded.ok) throw new Error('seed failed');
    await openWrite(page, { slot: 'A' });
    const before = await page.evaluate(() => window.__canvasMade);
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__canvasMade);
    const reported = await page.evaluate(() => [navigator.hardwareConcurrency, navigator.deviceMemory]);
    return { made: after - before, ink: await canvasInk(page, 'write-grid-ink'), reported };
  };
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const on = await strokeCanvases();
  assert.deepEqual(on.reported, [2, 2], 'the page really sees hardwareConcurrency=2, deviceMemory=2');
  assert.ok(on.ink > 500, 'the stroke is painted');
  assert.ok(on.made > 0, `detail on despite 2 cores / 2 GB: the stroke used an offscreen layer (${on.made} canvas created)`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const off = await strokeCanvases();
  assert.ok(off.ink > 500, 'reduced motion: the stroke is still painted');
  assert.equal(off.made, 0, 'reduced motion: detail off, no offscreen layer');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
