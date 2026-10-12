// 交互合规：逐页断言（交互与动效规范 §8b IC-01 / 02 / 03 / 09 / 10 / 20），被 102-interaction-compliance.spec.js 与 -pages2 两份 spec 分段调用。
// 不是 spec（run.mjs 只加载 *.spec.js）。
import { CATALOG, PRESS_MS, TOP, enter, pageFacts, skipIfPending, snapshot, swipeBack, backActionIsFunction, waitIdle } from './ic-lib.mjs';

/** 主按钮底线（B2）：子页 = 视口下沿 − max(20, 安全区)（测试里安全区 0）；Tab 根 = Tab 栏上沿 − 20。 */
const LINE = 20;

export async function checkPages(page, ctx, info, names) {
  const { assert, step } = ctx;
  for (const name of names) {
    const entry = CATALOG.find(e => e.name === name);
    assert.ok(entry, `${name} is in the catalog`);
    step(`${name}${entry.tab ? '（Tab 根）' : ''}`);
    await enter(page, entry, info);
    const f = await page.evaluate(pageFacts);
    const where = { screens: [name] };

    // IC-01 / IC-19 前提：非 Tab 根都有左上元素；Tab 根没有
    if (entry.tab) {
      assert.equal(f.back, null, `${name}: a tab root has no top-left back (N1 L0)`);
    } else if (!skipIfPending('IC-01', where, name)) {
      assert.ok(f.back, `IC-01 ${name}: top-left back exists`);
      assert.ok(f.back.inView && f.back.hit && f.back.w >= 44 && f.back.h >= 44, `IC-01 ${name}: back is visible, in view, ≥ 44×44 and hittable (${JSON.stringify(f.back)})`);
      const close = name === 'result';
      assert.ok(close ? /--close/.test(f.back.cls) : /--back/.test(f.back.cls), `IC-01 / N2 ${name}: 「${close ? '×' : '‹'}」 (${f.back.cls})`);
      assert.ok((f.back.label || '').trim().length > 0, `IC-20 ${name}: the back button has a name`);
    }

    // IC-02：返回动作是函数
    if (!entry.tab && !skipIfPending('IC-02', where, name)) assert.equal(await backActionIsFunction(page), true, `IC-02 ${name}: getBackAction(top) is a function`);

    // IC-20：推入后焦点在新页标题（或页面声明的 data-autofocus）；图标按钮都有名字
    if (!entry.tab && !f.focusIsTitle) {
      const auto = await page.evaluate(t => {
        const a = document.activeElement;
        return !!(a && a.closest && a.closest(t) && a.hasAttribute('data-autofocus'));
      }, TOP);
      if (!auto && !skipIfPending('IC-20', where, `${name} focus`)) assert.ok(false, `IC-20 ${name}: focus is on the page title after the push`);
    }
    assert.deepEqual(f.iconNoName, [], `IC-20 ${name}: every icon button has an aria-label`);

    // IC-09：可点区域 ≥ 44（中心与四向 21px 都命中控件自己）
    if (f.small.length && !skipIfPending('IC-09', where, `${name}: ${f.small.join(', ')}`)) assert.deepEqual(f.small, [], `IC-09 ${name}: every control is hittable over 44×44`);

    // IC-10：一屏 ≤ 1 主按钮；主按钮落在全 App 的底线上
    if (f.primaries.length > 1 && !skipIfPending('IC-10', where, `${name}: ${f.primaries.join(', ')}`)) assert.ok(false, `IC-10 ${name}: at most one primary (${f.primaries.join(', ')})`);
    if (f.primaries.length === 1) {
      const onLine = entry.tab
        ? f.tabTop !== null && Math.abs(f.tabTop - f.primaryBottom - LINE) <= 1
        : Math.abs(f.primaryBottomGap - LINE) <= 1;
      if (!onLine && !skipIfPending('IC-10', where, `${name}: primary bottom gap ${f.primaryBottomGap}, tab top ${f.tabTop}`)) {
        assert.ok(false, `IC-10 ${name}: the primary sits on the app-wide bottom line (gap ${f.primaryBottomGap}, tab top ${f.tabTop})`);
      }
    }
    assert.equal(f.hOverflow, false, `${name}: no horizontal page scroll`);

    // IC-03：点左上 ≡ 左缘右滑（栈、顶层、写字页阶段、store 逐项相同）
    if (!entry.tab && !skipIfPending('IC-03', where, name)) {
      await page.waitForTimeout(PRESS_MS);
      await page.click(`${TOP} .sz-page__head [data-testid="page-back"]`);
      await waitIdle(page);
      const a = await snapshot(page);
      await enter(page, entry, info);
      await swipeBack(page, { to: 0.5 });
      await waitIdle(page);
      const b = await snapshot(page);
      assert.deepEqual({ stack: b.stack, depth: b.depth, top: b.top, phase: b.phase }, { stack: a.stack, depth: a.depth, top: a.top, phase: a.phase }, `IC-03 ${name}: swipe back lands where tapping 「‹」 lands`);
      assert.equal(b.store === a.store, true, `IC-03 ${name}: the store is identical after either way back`);
    }
  }
}
