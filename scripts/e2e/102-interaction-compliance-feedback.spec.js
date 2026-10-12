// 交互合规（交互与动效规范 §8b）—— 第 4 份：反馈与动效。
//   IC-12  流程中出现的每一条提示条都是失败或可撤销（data-kind=failure|undo）；成功 / 说明类出现即失败——审计里还没删的
//          （kind=legacy，P0-07 – P0-14，归卡 I3）按待修清单跳过并打印
//   IC-13  hapticLog：判断恰好 1 次 judge、写好了 1 次 light；书写、撤销、返回 0 次；保存失败的三段式期间 0 次，再试成功补 1 次
//   IC-14  遍历中收集 document.getAnimations()：每个动画的时长与曲线都在 motion 令牌集合里（运行时兜底，补 verify:tokens 的静态扫描）
//   IC-15  减少动态效果：推入 / 返回 / 弹层没有 transform 关键帧（按下缩放除外），淡化 150ms，且不是 0ms 硬切

import { PRESS_MS, TOP, boot, enter, CATALOG, seedRich, skipIfPending, toRoot, waitIdle } from './ic-lib.mjs';
import { drawStroke, HORIZONTAL, seedSession } from './helpers.mjs';

/** 页面里装一个收集器：rAF 逐帧记下所有动画的 {duration, easing, props, kind}（去重）。 */
async function startAnimCollector(page) {
  await page.evaluate(() => {
    const seen = new Map();
    window.__ic14 = { seen, on: true };
    const tick = () => {
      if (!window.__ic14.on) return;
      for (const a of document.getAnimations()) {
        const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
        if (!t) continue;
        let kfs = [];
        try {
          kfs = a.effect.getKeyframes();
        } catch (error) {
          kfs = [];
        }
        const props = [...new Set(kfs.flatMap(k => Object.keys(k).filter(x => !['offset', 'computedOffset', 'easing', 'composite'].includes(x))))];
        const target = a.effect.target;
        const key = `${a.constructor.name}|${a.animationName || a.transitionProperty || ''}|${t.duration}|${t.easing}|${target && target.className}`;
        if (!seen.has(key)) {
          seen.set(key, {
            kind: a.constructor.name, name: a.animationName || a.transitionProperty || '', duration: t.duration, easing: t.easing,
            props: a.transitionProperty ? [a.transitionProperty] : props, cls: target && typeof target.className === 'string' ? target.className : '',
            kfEasings: kfs.map(k => k.easing).filter(Boolean),
          });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopAnimCollector(page) {
  return page.evaluate(() => {
    window.__ic14.on = false;
    return [...window.__ic14.seen.values()];
  });
}

/** motion 令牌允许的时长（ms）与曲线（Chromium 规范化后的写法）。 */
async function tokenSets(page) {
  return page.evaluate(async () => {
    const { M } = await import('/src/config/motion.js');
    const ms = new Set([0, ...Object.values(M.dur), ...Object.values(M.role), ...Object.values(M.moment), ...Object.values(M.timing)]);
    const norm = s => String(s).replace(/\s+/g, '').replace(/(^|[(,])0\./g, '$1.');
    const eases = new Set(Object.values(M.ease).map(norm));
    return { ms: [...ms], eases: [...eases] };
  });
}

const normEase = s => String(s).replace(/\s+/g, '').replace(/(^|[(,])0\./g, '$1.');

export default async function interactionComplianceFeedback(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await boot(page, baseURL);
  const info = await seedRich(page);
  const sets = await tokenSets(page);

  // ---- IC-12：提示条白名单
  step('IC-12: every toast that shows up is a failure or an undo (success toasts still in the code are pending items of card I3)');
  await page.evaluate(() => {
    window.__ic12 = [];
    const host = document.querySelector('[data-testid="toast-host"]');
    new MutationObserver(() => {
      for (const el of host.querySelectorAll('[data-testid="toast"]')) {
        if (el.__seen) continue;
        el.__seen = true;
        window.__ic12.push({ text: el.textContent.trim(), kind: el.dataset.kind, audit: el.dataset.audit || null });
      }
    }).observe(host, { childList: true, subtree: true });
  });
  // 换库（成功提示 P0-08 待删）
  await enter(page, CATALOG.find(e => e.name === 'library-switch'), info);
  await page.waitForTimeout(PRESS_MS);
  await page.locator(`${TOP} [data-testid="libswitch-row"]`).last().click();
  await page.waitForSelector(`${TOP} [data-testid="libswitch-ok"]`);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="libswitch-ok"]`);
  await page.waitForTimeout(600);
  // 导出备份（网页下载；成功提示 P0-09 待删）
  await enter(page, CATALOG.find(e => e.name === 'backup'), info);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="backup-export"]`).catch(() => {});
  await page.waitForTimeout(600);
  const toasts = await page.evaluate(() => window.__ic12);
  assert.ok(toasts.length >= 1, `IC-12 the flows produced toasts to check (${toasts.length})`);
  for (const ts of toasts) {
    if (ts.kind === 'failure' || ts.kind === 'undo') {
      assert.ok(true, `IC-12 「${ts.text}」 is a ${ts.kind}`);
    } else if (ts.kind === 'legacy' && skipIfPending('IC-12', { copy: [] }, `「${ts.text}」`)) {
      // 打印过了（pendingFor 对 IC-12 的匹配按 where.copy；这里用审计编号再核一次）
      assert.ok(!!ts.audit, `IC-12 legacy toast 「${ts.text}」 names its audit id (${ts.audit})`);
    } else if (ts.kind === 'legacy' && ts.audit) {
      const { PENDING } = await import('./interaction-pending.mjs');
      assert.ok(PENDING[ts.audit], `IC-12 legacy toast 「${ts.text}」 (${ts.audit}) is still on the pending list`);
      console.log(`    pending ${ts.audit} (${PENDING[ts.audit].card}) skips IC-12 [「${ts.text}」]: ${PENDING[ts.audit].why}`);
    } else {
      assert.ok(false, `IC-12 「${ts.text}」 is a success / explanation toast (kind ${ts.kind}) — F3 allows failure and undo only`);
    }
  }

  // ---- IC-13：触觉
  step('IC-13: one judge per judgement, one light for 写好了; writing / undo / back send nothing; a failed save sends nothing until the retry succeeds');
  await seedSession(page, { slot: 'A', chars: ['永', '和', '春'] });
  await toRoot(page);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await waitIdle(page, 'write', PRESS_MS);
  const log = () => page.evaluate(async () => (await import('/src/platform/haptics.js')).hapticLog());
  let base = (await log()).length;
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  await page.click(`${TOP} [data-testid="write-undo"]`);
  await page.waitForTimeout(PRESS_MS);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  assert.deepEqual((await log()).slice(base), [], 'IC-13 writing and 撤销 send no haptic');
  await page.click(`${TOP} [data-testid="write-done"]`);
  await page.waitForSelector(`${TOP} [data-testid="write-judge-correct"]`);
  await page.waitForTimeout(700);
  assert.deepEqual((await log()).slice(base), ['light'], 'IC-13 写好了: one light');
  base = (await log()).length;
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(`${TOP} [data-testid="write-judge-correct"]`);
  await page.waitForSelector(`${TOP} [data-testid="write-judge-fail-retry"]`);
  assert.deepEqual((await log()).slice(base), [], 'IC-13 a failed judgement (three-part failure) sends no haptic');
  const said = await page.evaluate(() => document.querySelector('[data-testid="sr-announce"]').textContent);
  assert.ok(said.includes('没保存上'), `the failure sentence went through the persistent live region (${said})`);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="write-judge-fail-retry"]`);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '1');
  assert.deepEqual((await log()).slice(base), ['judge'], 'IC-13 the retry that succeeds sends exactly one judge');
  base = (await log()).length;
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="page-back"]`);
  await waitIdle(page, 'home');
  assert.deepEqual((await log()).slice(base), [], 'IC-13 going back sends no haptic');

  // ---- IC-14：运行时动画都在令牌里
  step('IC-14: every running animation (push / pop, sheet in / out, toast, write phases) uses token durations and curves');
  await startAnimCollector(page);
  await enter(page, CATALOG.find(e => e.name === 'settings'), info);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="settings-appearance"]`);
  await page.waitForSelector(`${TOP} [data-testid="settings-appearance-sheet"]`);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="sheet-done"]`);
  await page.waitForTimeout(400);
  await page.click(`${TOP} [data-testid="page-back"]`);
  await waitIdle(page, 'home');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await waitIdle(page, 'write', PRESS_MS);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await page.click(`${TOP} [data-testid="write-done"]`);
  await page.waitForSelector(`${TOP} [data-testid="write-judge-correct"]`);
  await page.waitForTimeout(700);
  const anims = await stopAnimCollector(page);
  assert.ok(anims.length >= 4, `IC-14 animations were collected (${anims.length})`);
  const bad = anims.filter(a => {
    const d = Number(a.duration);
    const durOk = !Number.isFinite(d) || sets.ms.includes(Math.round(d)) || a.cls.includes('sz-toast__timer');
    const easeOk = sets.eases.includes(normEase(a.easing)) && a.kfEasings.every(e => e === 'linear' || sets.eases.includes(normEase(e)));
    return !(durOk && easeOk);
  });
  assert.deepEqual(bad, [], 'IC-14 every animation duration / easing is a motion token');

  // ---- IC-15：减少动态效果
  step('IC-15: reduced motion — no transform keyframes (press scale aside), fades are 150ms, and state changes are not 0ms hard cuts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toRoot(page);
  await startAnimCollector(page);
  await enter(page, CATALOG.find(e => e.name === 'settings'), info);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="settings-appearance"]`);
  await page.waitForSelector(`${TOP} [data-testid="settings-appearance-sheet"]`);
  await page.waitForTimeout(PRESS_MS);
  await page.click(`${TOP} [data-testid="sheet-done"]`);
  await page.waitForTimeout(400);
  await page.click(`${TOP} [data-testid="page-back"]`);
  await waitIdle(page, 'home');
  const reduced = await stopAnimCollector(page);
  const moving = reduced.filter(a => a.props.some(p => /transform|translate|scale/.test(p)) && !/sz-btn/.test(a.cls));
  assert.deepEqual(moving, [], 'IC-15 no transform animation under reduced motion (button press scale is kept, D43)');
  const fades = reduced.filter(a => a.props.includes('opacity') && a.kind !== 'CSSTransition');
  assert.ok(fades.length >= 2, `IC-15 the push / pop and the sheet are cross-fades, not 0ms cuts (${fades.length} fades)`);
  assert.deepEqual([...new Set(fades.map(a => Math.round(a.duration)))].filter(d => d !== 150), [], 'IC-15 every reduced-motion fade is 150ms (motion.duration.reduce)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
