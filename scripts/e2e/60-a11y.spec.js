// M6-1 可访问性走查（02 §8；01 §7 可访问性条；04 R-G08 / R-G09 / R-W20 / R-W29；acceptance M0–M5「键盘全程、焦点陷阱（M6）」）
// 与 CSP 收紧（02 §8：style-src 去 'unsafe-inline'、font-src 去 data:）。
//
// 读屏名字与角色取 Chromium 自己的无障碍树（CDP Accessibility.getFullAXTree，= 读屏实际拿到的计算名），
// 结构另用 Playwright ariaSnapshot 抽查；axe-core 不在离线依赖里（node_modules 只有 playwright），检查自写：
//   A. 名字：无障碍树里每个 button / switch / checkbox / radio / tab / textbox / searchbox / link / dialog / alertdialog /
//      image / radiogroup / tabpanel 都有非空名字（被 aria-hidden / visibility:hidden 的下层页面不在树里）。
//   B. DOM：每个 <button> 的 disabled 与 aria-disabled="true" 同进同出（R-G08）；无正数 tabindex；
//      aria-labelledby / aria-describedby / aria-controls 指向的 id 都存在；id 不重复；弹层 role=dialog|alertdialog 必带 aria-modal；
//      焦点不在 aria-hidden 子树里；轻提示宿主是 role=status aria-live=polite；<html lang=zh-CN>。
//   C. Tab 顺序：按 Tab 走一整圈——每一站都在当前最上层（有弹层时 = 弹层面板，即焦点陷阱）、可见、不在 aria-hidden 里；
//      各站按文档顺序（无跳序）；范围内每个可聚焦控件都走得到（tabindex=-1 除外：tab 条漫游只留选中项）。
//   D. 弹层：打开后焦点在面板内；背景 .sz-layer__screen aria-hidden；Tab 与 Shift+Tab 都出不去；Esc 关闭后焦点回到打开它的控件。
//   E. CSP：meta 里 style-src 只有 'self'、font-src 只有 'self'；全程 securitypolicyviolation 为零（页面加载前挂监听），
//      组件样式经 CSSOM 注入无一条被拒（styles.js droppedRules 为空）且确实生效；
//      反证：另开 context 往页面塞一个 <style>，CSP 确实拦下并报 violation（证明监听有效、策略在执行）。
//
// 覆盖：首页、写字页（recall / compare / answer，含看答案确认框）、查字弹层、结果页（含对照弹层）、字库、写错过清单、单字详情、
//      我的（菜单行名字只读标题，副标题进描述）、设置（含外观弹层）、备份与恢复（含清空弹层）、存储不可用阻断页。

import {
  bootTestHost, drawStroke, HORIZONTAL, openWrite, PRESS_SETTLE_MS, seedSession, tid, tokenRgb, topSel, waitNavIdle,
} from './helpers.mjs';

const TODAY = '2026-09-30';
const CLOCK = `${TODAY}T10:00:00`;

const NEED_NAME = new Set([
  'button', 'switch', 'checkbox', 'radio', 'tab', 'textbox', 'searchbox', 'combobox', 'link', 'menuitem', 'slider',
  'spinbutton', 'dialog', 'alertdialog', 'image', 'img', 'radiogroup', 'tabpanel', 'listbox', 'option',
]);

// 页面加载前挂上：记录每一次 CSP 违规。
function CSP_WATCH() {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', e => {
    window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI || ''} ${(e.sample || '').slice(0, 60)}`);
  });
}

// 与 53-block.spec 同一手法：页面加载前让 Storage 抛 SecurityError。
function DENY_STORAGE() {
  const proto = Storage.prototype;
  for (const name of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) {
    proto[name] = function denied() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
  }
}

// ------------------------------------------------------------------ 页面内 DOM 检查（B）
function domAudit() {
  const problems = [];
  const desc = el => {
    const id = el.getAttribute('data-testid');
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls}`;
  };
  for (const b of document.querySelectorAll('button')) {
    const aria = b.getAttribute('aria-disabled') === 'true';
    if (b.disabled !== aria) problems.push(`disabled≠aria-disabled: ${desc(b)} disabled=${b.disabled} aria-disabled=${b.getAttribute('aria-disabled')}`);
  }
  for (const el of document.querySelectorAll('[tabindex]')) {
    if (Number(el.getAttribute('tabindex')) > 0) problems.push(`positive tabindex: ${desc(el)}`);
  }
  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      for (const id of el.getAttribute(attr).split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) problems.push(`${attr} → missing #${id} on ${desc(el)}`);
      }
    }
  }
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  for (const [id, n] of ids) if (n > 1) problems.push(`duplicate id #${id} ×${n}`);
  for (const d of document.querySelectorAll('[role="dialog"],[role="alertdialog"]')) {
    if (d.getAttribute('aria-modal') !== 'true') problems.push(`dialog without aria-modal=true: ${desc(d)}`);
  }
  const a = document.activeElement;
  if (a && a !== document.body && a.closest('[aria-hidden="true"]')) problems.push(`focus inside aria-hidden: ${desc(a)}`);
  const host = document.querySelector('[data-testid="toast-host"]');
  if (host && !(host.getAttribute('role') === 'status' && host.getAttribute('aria-live') === 'polite')) problems.push('toast host is not role=status aria-live=polite');
  if (document.documentElement.getAttribute('lang') !== 'zh-CN') problems.push(`html lang=${document.documentElement.getAttribute('lang')}`);
  return problems;
}

// ------------------------------------------------------------------ 无障碍树（A）
async function axProblems(cdp) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const bad = nodes.filter(n => !n.ignored && n.role && NEED_NAME.has(n.role.value) && !(n.name && String(n.name.value || '').trim()));
  const out = [];
  for (const n of bad) {
    let where = '';
    if (n.backendDOMNodeId) {
      try {
        const { node } = await cdp.send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId });
        const attrs = {};
        for (let i = 0; i < (node.attributes || []).length; i += 2) attrs[node.attributes[i]] = node.attributes[i + 1];
        where = `${node.localName}${attrs['data-testid'] ? `[${attrs['data-testid']}]` : ''}${attrs.class ? `.${attrs.class.split(/\s+/)[0]}` : ''}`;
      } catch (error) {
        where = `#${n.backendDOMNodeId}`;
      }
    }
    out.push(`unnamed ${n.role.value}: ${where}`);
  }
  return out;
}

/** 某元素（CSS 选择器）在无障碍树里的 {role, name, description}。 */
async function axOf(cdp, selector) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const n = nodes[0];
  if (!n) return null;
  return {
    role: n.role ? n.role.value : null,
    name: n.name ? String(n.name.value || '') : '',
    description: n.description ? String(n.description.value || '') : '',
  };
}

// ------------------------------------------------------------------ Tab 顺序（C）
async function tabCycle(page, { max = 120, shift = false } = {}) {
  const stops = [];
  let first = null;
  let blanks = 0;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      window.__tabKeys = window.__tabKeys || new WeakMap();
      if (!window.__tabKeys.has(el)) window.__tabKeys.set(el, `k${(window.__tabSeq = (window.__tabSeq || 0) + 1)}`);
      return { key: window.__tabKeys.get(el) };
    });
    if (!info) {
      blanks += 1;
      if (blanks > 3) break;
      continue;
    }
    if (info.key === first) return { stops, complete: true };
    if (!first) first = info.key;
    stops.push(info.key);
  }
  return { stops, complete: false };
}

async function tabOrderProblems(page, label) {
  // 起点：当前焦点（弹层 = 面板本身）；走一整圈后在页面里核对每一站。
  const cycle = await tabCycle(page);
  const problems = [];
  if (!cycle.complete) problems.push(`${label}: Tab never wrapped (${cycle.stops.length} stops)`);
  const verdict = await page.evaluate(keys => {
    const out = [];
    const map = window.__tabKeys;
    const all = [...document.querySelectorAll('*')].filter(el => map.has(el));
    const byKey = new Map(all.map(el => [map.get(el), el]));
    const layer = document.querySelector('.sz-layer[data-top="true"]');
    const block = document.querySelector('[data-testid="block-screen"]');
    const overlays = layer ? [...layer.querySelectorAll('[role="dialog"],[role="alertdialog"]')] : [];
    const scope = overlays.length ? overlays[overlays.length - 1] : (layer || block || document.body);
    const desc = el => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}`;
    const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const els = keys.map(k => byKey.get(k)).filter(Boolean);
    for (const el of els) {
      if (!scope.contains(el)) out.push(`stop outside the top layer/dialog: ${desc(el)}`);
      if (el.closest('[aria-hidden="true"]')) out.push(`stop inside aria-hidden: ${desc(el)}`);
      if (!visible(el)) out.push(`stop not visible: ${desc(el)}`);
    }
    // 文档顺序：把一圈旋到文档里最靠前的一站开头，之后必须单调向后。
    if (els.length > 1) {
      let start = 0;
      for (let i = 1; i < els.length; i += 1) {
        if (els[i].compareDocumentPosition(els[start]) & Node.DOCUMENT_POSITION_FOLLOWING) start = i;
      }
      const rot = els.slice(start).concat(els.slice(0, start));
      for (let i = 1; i < rot.length; i += 1) {
        if (!(rot[i - 1].compareDocumentPosition(rot[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          out.push(`out of document order: ${desc(rot[i - 1])} → ${desc(rot[i])}`);
        }
      }
    }
    // tab 条漫游 tabindex：一圈里 tab 最多一站，且是选中项。
    const tabStops = els.filter(el => el.getAttribute('role') === 'tab');
    if (tabStops.length > 1) out.push(`tablist has ${tabStops.length} Tab stops (roving tabindex allows one)`);
    if (tabStops.length === 1 && tabStops[0].getAttribute('aria-selected') !== 'true') out.push(`Tab stop on an unselected tab: ${desc(tabStops[0])}`);
    // 范围内每个可聚焦控件都要走得到。
    const SEL = 'button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]';
    const reached = new Set(els);
    for (const el of scope.querySelectorAll(SEL)) {
      if (el.getAttribute('tabindex') === '-1') continue;
      if (!visible(el) || el.closest('[aria-hidden="true"]') || el.closest('[inert]')) continue;
      if (!reached.has(el)) out.push(`not reachable by Tab: ${desc(el)}`);
    }
    return { out, n: els.length };
  }, cycle.stops);
  return { problems: problems.concat(verdict.out.map(p => `${label}: ${p}`)), stops: verdict.n };
}

// ------------------------------------------------------------------ 组合
async function cspViolations(page) {
  return page.evaluate(() => (window.__cspViolations || []).slice());
}

async function audit(page, cdp, ctx, label, { tabOrder = true } = {}) {
  const { assert } = ctx;
  const ax = await axProblems(cdp);
  const dom = await page.evaluate(domAudit);
  assert.deepEqual(ax.concat(dom), [], `${label}: every control/dialog/image has a name; disabled↔aria-disabled; ids and aria refs sound`);
  if (tabOrder) {
    const t = await tabOrderProblems(page, label);
    assert.deepEqual(t.problems, [], `${label}: Tab cycle stays in the top layer, in document order, reaches every control (${t.stops} stops)`);
  }
  assert.deepEqual(await cspViolations(page), [], `${label}: no CSP violations`);
}

async function focusedTestid(page) {
  return page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
}

/**
 * 弹层（D）：焦点在面板内、背景 aria-hidden、Tab / Shift+Tab 出不去、名字与 aria-modal；Esc 关闭后焦点回到 opener。
 */
async function dialogCheck(page, cdp, ctx, { label, panel, opener }) {
  const { assert } = ctx;
  await page.waitForSelector(panel);
  await waitNavIdle(page);
  const state = await page.evaluate(sel => {
    const p = document.querySelector(sel);
    const layer = p.closest('.sz-layer');
    const screen = layer && layer.querySelector(':scope > .sz-layer__screen');
    return {
      role: p.getAttribute('role'),
      modal: p.getAttribute('aria-modal'),
      focusInside: p.contains(document.activeElement),
      backgroundHidden: screen ? screen.getAttribute('aria-hidden') : null,
    };
  }, panel);
  assert.ok(state.role === 'dialog' || state.role === 'alertdialog', `${label}: role=${state.role}`);
  assert.equal(state.modal, 'true', `${label}: aria-modal=true`);
  assert.ok(state.focusInside, `${label}: focus moves into the dialog on open`);
  assert.equal(state.backgroundHidden, 'true', `${label}: the page underneath is aria-hidden while the dialog is open`);
  const ax = await axOf(cdp, panel);
  assert.ok(ax && ax.name.trim().length > 0, `${label}: dialog has an accessible name (${ax && ax.name})`);
  await audit(page, cdp, ctx, `${label} (open)`);
  // Shift+Tab 一整圈也不出面板。
  const back = await tabCycle(page, { shift: true, max: 60 });
  const outside = await page.evaluate(({ sel, keys }) => {
    const p = document.querySelector(sel);
    const map = window.__tabKeys;
    return [...document.querySelectorAll('*')].filter(el => map.has(el) && keys.includes(map.get(el)) && !p.contains(el))
      .map(el => el.getAttribute('data-testid') || el.tagName);
  }, { sel: panel, keys: back.stops });
  assert.ok(back.complete && outside.length === 0, `${label}: Shift+Tab cycle stays inside the dialog (${JSON.stringify(outside)})`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(sel => !document.querySelector(sel), panel);
  await waitNavIdle(page);
  assert.equal(await focusedTestid(page), opener, `${label}: Esc closes it and focus returns to ${opener}`);
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function waitTop(page, name) {
  await page.waitForFunction(n => {
    const app = document.querySelector('.sz-app');
    return app && app.dataset.topScreen === n && app.dataset.navAnim === 'idle';
  }, name);
  await waitNavIdle(page);
}

async function switchTab(page, name) {
  await page.evaluate(async n => (await import('/src/ui/router.js')).nav.switchTab(n), name);
  await waitTop(page, name);
}

function rec(serial, char, judgment, day) {
  return {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's900', kind: 'judged', judgment,
    at: new Date(`${day}T08:00:00`).getTime() + serial * 1000, localDay: day, help: { hints: 0, answerSeen: false, traced: false },
  };
}

async function seedRecords(page) {
  const records = [rec(1, '永', 'wrong', '2026-09-20'), rec(2, '和', 'correct', '2026-09-22'), rec(3, '水', 'wrong', '2026-09-24')];
  const res = await page.evaluate(async ({ rs, clock }) => {
    const { applyJudgment } = await import('/src/core/fsrs.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(clock);
    const sched = {};
    for (const r of rs) sched[r.cardKey] = applyJudgment(sched[r.cardKey], r).entry;
    const out = window.__shiziTest.seed({ records: { '2026-09': rs }, sched, sessions: { A: null, B: null, lastEnded: {} } });
    return { ok: !!(out && out.ok), out };
  }, { rs: records, clock: CLOCK });
  if (!res.ok) throw new Error(`seed failed: ${JSON.stringify(res.out)}`);
}

export default async function a11y(page, realCtx) {
  // SHIZI_A11Y_PROBE=1：走查模式——失败只打印不中断，一次看全所有问题（开发用；门禁跑法不设它）。
  const probe = process.env.SHIZI_A11Y_PROBE === '1';
  const soft = fn => (...args) => {
    try {
      fn(...args);
    } catch (error) {
      if (!probe) throw error;
    }
  };
  const ctx = probe
    ? { ...realCtx, assert: { ok: soft(realCtx.assert.ok), equal: soft(realCtx.assert.equal), deepEqual: soft(realCtx.assert.deepEqual) } }
    : realCtx;
  const { assert } = ctx;

  // ================================================================ E. CSP 静态 + 反证
  ctx.step('CSP: style-src and font-src are exactly \'self\'; an injected <style> is really blocked');
  {
    const context = await page.context().browser().newContext({ viewport: ctx.viewport, locale: 'zh-CN' });
    try {
      await context.addInitScript(CSP_WATCH);
      const p = await context.newPage();
      await p.goto(`${ctx.baseURL}/`);
      await p.waitForSelector('.sz-app');
      const csp = await p.evaluate(() => {
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        const policy = meta ? meta.getAttribute('content') : '';
        return Object.fromEntries(policy.split(';').map(s => s.trim()).filter(Boolean).map(s => {
          const [k, ...v] = s.split(/\s+/);
          return [k, v];
        }));
      });
      assert.deepEqual(csp['style-src'], ["'self'"], "CSP style-src is exactly 'self' (no 'unsafe-inline')");
      assert.deepEqual(csp['font-src'], ["'self'"], "CSP font-src is exactly 'self' (no data:)");
      assert.deepEqual(csp['script-src'], ["'self'"], "CSP script-src is exactly 'self'");
      assert.deepEqual(await cspViolations(p), [], 'production URL boots with zero CSP violations');
      const probe = await p.evaluate(async () => {
        const el = document.createElement('style');
        el.textContent = 'body{outline:7px solid red}';
        document.head.appendChild(el);
        const div = document.createElement('div');
        div.setAttribute('style', 'width:7px');
        document.body.appendChild(div);
        await new Promise(r => setTimeout(r, 50));
        const applied = getComputedStyle(document.body).outlineWidth === '7px';
        const attrApplied = getComputedStyle(div).width === '7px';
        el.remove();
        div.remove();
        return { applied, attrApplied, violations: window.__cspViolations.slice() };
      });
      assert.ok(!probe.applied && !probe.attrApplied, 'an inline <style> element and a style="" attribute are not applied');
      assert.ok(probe.violations.length >= 2 && probe.violations.every(v => /^style-src/.test(v)),
        `both are reported as style-src violations (${probe.violations.length})`);
    } finally {
      await context.close();
    }
  }

  await page.addInitScript(CSP_WATCH);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  await cdp.send('DOM.enable');

  // ================================================================ 首页
  ctx.step('home (first visit)');
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(clock => { window.__shiziTest.reset(); window.__shiziTest.setClock(clock); }, CLOCK);
  await page.reload();
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  const styleState = await page.evaluate(async () => {
    const { droppedRules } = await import('/src/ui/components/styles.js');
    const tabs = document.querySelector('.sz-tabs');
    return {
      dropped: droppedRules.slice(),
      styleElements: document.querySelectorAll('style').length,
      tabsRadius: tabs ? getComputedStyle(tabs).borderTopLeftRadius : null,
      tabsBg: tabs ? getComputedStyle(tabs).backgroundColor : null,
      tabsBorder: tabs ? [getComputedStyle(tabs).borderTopStyle, getComputedStyle(tabs).borderTopWidth] : null,
      btnCursor: getComputedStyle(document.querySelector('.sz-btn')).cursor,
    };
  });
  assert.deepEqual(styleState.dropped, [], 'every component CSS rule was accepted by CSSOM insertRule (none dropped)');
  assert.equal(styleState.styleElements, 0, 'no <style> elements in the document');
  // D43（P1-E1a）：Tab 栏由悬浮药丸（圆角 32）改为设计系统的通栏：直角、纸色底、顶部发丝线
  assert.deepEqual([styleState.tabsRadius, styleState.tabsBg, styleState.tabsBorder[0]], ['0px', tokenRgb('light', 'paper'), 'solid'], 'component styles are live (tab bar: flat, paper, hairline top)');
  assert.equal(styleState.btnCursor, 'pointer', 'component styles are live (.sz-btn cursor)');
  const homeAria = await page.locator('[role="tablist"]').ariaSnapshot();
  assert.ok(/- tab "习字" \[selected\]/.test(homeAria) && /- tab "字库"/.test(homeAria) && /- tab "我的"/.test(homeAria),
    'ariaSnapshot: tablist with 习字 [selected] / 字库 / 我的');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map(el => el.getAttribute('tabindex'))),
    ['0', '-1', '-1'], 'roving tabindex: only the selected tab is in the Tab order');
  // P1-E5：首次打开没有题记（首页是书家「拾」+ 题跋）；下面「今天还没写」的首页才有题记，先 seed 一条昨天的判断
  const seedYesterday = () => page.evaluate(() => {
    window.__shiziTest.reset();
    const at = window.__shiziTest.now() - 24 * 3600 * 1000;
    const d = new Date(at);
    const pad = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const rec = { id: 'r1', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'judged', judgment: 'correct', at, localDay: day, help: { hints: 0, answerSeen: false, traced: false } };
    window.__shiziTest.seed({ records: { [day.slice(0, 7)]: [rec] } });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await audit(page, cdp, ctx, 'home (first open)');
  await seedYesterday();
  await page.waitForSelector(tid('home-epigraph'));
  {
    // A9：题记整句 + 出处（含《篇名》）读屏仍要读到。E9a（D49）起题记是日期下一行横排小字、AX 档隐藏（display:none），
    // 读屏把它作为标题的补充读出：h1 aria-describedby 指向题记（figure 本身 aria-hidden，避免和标题重复读两遍；被描述引用的隐藏节点仍参与描述计算）。
    const epi = await page.evaluate(async () => {
      const { EPIGRAPHS } = await import('/src/config/epigraphs.js');
      const fig = document.querySelector('[data-testid="home-epigraph"]');
      const e = EPIGRAPHS[Number(fig.dataset.index)];
      const h1 = document.querySelector('[data-testid="home-title"]');
      return { expected: e.lines.join('') + e.source, hidden: fig.getAttribute('aria-hidden'), describedby: h1.getAttribute('aria-describedby'), figId: fig.id };
    });
    const titleAx = await axOf(cdp, tid('home-title'));
    assert.equal(titleAx && titleAx.description, epi.expected, 'A9: the title is described by the full epigraph (one sentence + 《source》)');
    assert.equal(titleAx && titleAx.name, '今天写几个字', 'the title keeps its own name');
    assert.ok(/^.+。.+《.+》$|^.+，.+。.+$/.test(epi.expected), 'epigraph label has the quote and its source');
    assert.deepEqual([epi.hidden, epi.describedby === epi.figId], ['true', true], 'A9: the on-screen epigraph line is aria-hidden (read once, as the title’s description)');
    // AX1–AX5：题记视觉上隐藏，读屏描述仍在
    await page.evaluate(() => window.shiziContentSize({ category: 'AX3' }));
    await page.waitForTimeout(250);
    const hiddenAx = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="home-epigraph"]')).display);
    const titleAx3 = await axOf(cdp, tid('home-title'));
    assert.equal(hiddenAx, 'none', 'AX: the epigraph line is hidden (D49)');
    assert.equal(titleAx3 && titleAx3.description, epi.expected, 'AX: still read as the title’s supplement');
    await page.evaluate(() => window.shiziContentSize({ category: 'L' }));
    await page.waitForTimeout(250);
  }
  await audit(page, cdp, ctx, 'home');

  ctx.step('checker self-test: an unnamed button and a disabled button without aria-disabled are caught');
  await page.evaluate(() => {
    const layer = document.querySelector('.sz-layer[data-top="true"] .sz-layer__screen');
    const a = document.createElement('button');
    a.setAttribute('data-testid', 'a11y-probe-unnamed');
    const b = document.createElement('button');
    b.setAttribute('data-testid', 'a11y-probe-disabled');
    b.textContent = 'x';
    b.disabled = true;
    layer.append(a, b);
  });
  const caught = (await axProblems(cdp)).concat(await page.evaluate(domAudit));
  await page.evaluate(() => document.querySelectorAll('[data-testid^="a11y-probe-"]').forEach(el => el.remove()));
  assert.ok(caught.some(p => /unnamed button: button\[a11y-probe-unnamed\]/.test(p)), 'AX-tree check flags the unnamed button');
  assert.ok(caught.some(p => /disabled≠aria-disabled: button\[a11y-probe-disabled\]/.test(p)), 'DOM check flags disabled without aria-disabled');

  // ================================================================ 写字页
  ctx.step('write page: recall (empty grid → 写好了 disabled + aria-disabled)');
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: ['永', '和'], cursor: 0 });
  assert.ok(seeded.ok, 'seed an A session (永 / 和)');
  await openWrite(page, { slot: 'A' });
  await waitPhase(page, 'recall');
  const done0 = await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-done"]');
    return b ? { disabled: b.disabled, aria: b.getAttribute('aria-disabled') } : null;
  });
  assert.deepEqual(done0, { disabled: true, aria: 'true' }, '写好了 is disabled + aria-disabled before any stroke (R-W29)');
  const hintLive = await page.getAttribute(topSel('write-prompt-hint'), 'aria-live');
  assert.equal(hintLive, 'polite', 'prompt hint is aria-live=polite (R-W20)');
  {
    // A9：题面空格读「要写的字，第 k 个，读 py，N 声」（不含答案字）；其余格保持
    const cell = await page.evaluate(() => {
      const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-prompt-cell"][data-kind="blank"]');
      const cells = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="write-prompt-cell"]')];
      return { py: el.querySelector('[data-testid="write-prompt-py"]').textContent, index: cells.indexOf(el), count: cells.length,
        role: el.getAttribute('role'), others: cells.filter(c => c !== el).map(c => c.getAttribute('aria-label')) };
    });
    const tone = py => {
      const d = py.normalize('NFD');
      return d.includes('\u0304') ? '一声' : d.includes('\u0301') ? '二声' : d.includes('\u030c') ? '三声' : d.includes('\u0300') ? '四声' : '轻声';
    };
    const expected = cell.count > 1
      ? `要写的字，第 ${cell.index + 1} 个，读 ${cell.py}，${tone(cell.py)}`
      : `要写的字，读 ${cell.py}，${tone(cell.py)}`;
    const cellAx = await axOf(cdp, '.sz-layer[data-top="true"] [data-testid="write-prompt-cell"][data-kind="blank"]');
    assert.equal(cell.role, 'img', 'A9: blank cell role=img');
    assert.deepEqual(cellAx && { role: cellAx.role, name: cellAx.name }, { role: 'image', name: expected }, `A9: blank cell name is "${expected}"`);
    assert.ok(cell.others.every(l => l === null || l === '同一目标字的另一处空格'), 'A9: other cells keep their names');
  }
  await audit(page, cdp, ctx, 'write/recall');

  ctx.step('write page: 看答案 has no confirm; only a failed write opens the 先不保存 / 再试一次 dialog (alertdialog, focus trap, focus return)');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-show-answer'));
  await dialogCheck(page, cdp, ctx, { label: 'write/answer-save-failed', panel: tid('write-answer-confirm'), opener: 'write-show-answer' });

  ctx.step('write page: compare');
  await drawStroke(page, HORIZONTAL);
  await page.waitForFunction(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-done"]');
    return b && !b.disabled && b.getAttribute('aria-disabled') === null;
  });
  assert.ok(true, '写好了 enabled after a stroke: disabled and aria-disabled both cleared');
  await waitNavIdle(page);
  await page.click(topSel('write-done'));
  await waitPhase(page, 'compare');
  const judge = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return [...top.querySelectorAll('[data-testid^="write-judge-"]')].filter(b => b.tagName === 'BUTTON')
      .map(b => ({ id: b.dataset.testid, pressed: b.getAttribute('aria-pressed') }));
  });
  assert.deepEqual(judge.map(j => j.pressed), judge.map(() => null), 'judge buttons carry no aria-pressed (D03)');
  {
    // A9：对照卡读「参考字形：字，拼音，N 画」「你的书写，N 笔」
    const refAx = await axOf(cdp, topSel('write-compare-ref'));
    const mineAx = await axOf(cdp, topSel('write-compare-mine'));
    assert.ok(refAx && /^参考字形：永，yǒng，\d+ 画$/.test(refAx.name), `A9: reference card name "${refAx && refAx.name}"`);
    assert.equal(refAx.role, 'image', 'A9: reference card is an image');
    assert.deepEqual(mineAx && { role: mineAx.role, name: mineAx.name }, { role: 'image', name: '你的书写，1 笔' }, 'A9: my card reads the stroke count (one stroke drawn)');
  }
  await audit(page, cdp, ctx, 'write/compare');
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return top && top.dataset.phase === 'recall' && top.dataset.cursor === '1';
  });
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'write/recall after a judgment (result line)');

  ctx.step('write page: answer');
  await page.click(topSel('write-show-answer'));
  await waitPhase(page, 'answer');
  await audit(page, cdp, ctx, 'write/answer');

  // ================================================================ 结果页
  ctx.step('result page + 对照弹层');
  await page.click(topSel('write-answer-next'));
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'result');
  await page.focus(`${topSel('work-cell')}[data-index="0"]`); // P1-E7：日常结果页的格子是作品格（这里没有墨，是衬底一行里的 work-cell）
  await page.keyboard.press('Enter');
  await dialogCheck(page, cdp, ctx, { label: 'result/compare-sheet', panel: tid('result-sheet'), opener: 'work-cell' });
  await page.click(topSel('page-back')); // E9c / D49 ③：日常结果页的出口只有页头左上「×」
  await waitTop(page, 'home');

  // ================================================================ 字库 / 查字 / 清单 / 详情
  ctx.step('library tab (with records)');
  await seedRecords(page);
  await switchTab(page, 'library');
  await audit(page, cdp, ctx, 'library');

  ctx.step('查字弹层 (lookup): focus in the input, trap, Esc returns focus');
  await page.click(topSel('library-query-open'));
  await page.waitForSelector(tid('query-sheet'));
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await page.fill(`${tid('query-sheet')} ${tid('query-input')}`, '永');
  await page.waitForTimeout(300);
  const qAx = await axOf(cdp, `${tid('query-sheet')} ${tid('query-input')}`);
  assert.ok(qAx && qAx.name.trim().length > 0, `query input has an accessible name (${qAx && qAx.name})`);
  await page.focus(`${tid('query-sheet')} ${tid('query-input')}`);
  await dialogCheck(page, cdp, ctx, { label: 'query-sheet', panel: tid('query-sheet'), opener: 'library-query-open' });

  ctx.step('写错过清单 (list): 0 selected → 先选一个字 disabled + aria-disabled');
  await page.evaluate(async () => (await import('/src/ui/screens/library/list.js')).openList('wrong'));
  await page.waitForSelector(topSel('list-screen'));
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'list');
  await page.click(topSel('list-toggle-all'));
  await waitNavIdle(page);
  const go0 = await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="list-go"]');
    return b ? { disabled: b.disabled, aria: b.getAttribute('aria-disabled') } : null;
  });
  assert.deepEqual(go0, { disabled: true, aria: 'true' }, 'list-go with 0 selected is disabled + aria-disabled (Z02 / R-G08)');
  await audit(page, cdp, ctx, 'list (none selected)');
  await page.click(topSel('list-toggle-all'));
  await waitNavIdle(page);

  ctx.step('单字详情 (detail)');
  await page.evaluate(async () => (await import('/src/ui/screens/detail/index.js')).openDetail('永'));
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'detail');

  // ================================================================ 我的 / 设置 / 备份
  ctx.step('mine tab: menu rows are named by their title only; subtitle and value are descriptions');
  await switchTab(page, 'mine');
  await audit(page, cdp, ctx, 'mine');
  const rows = {};
  for (const id of ['mine-menu-settings', 'mine-menu-backup', 'mine-menu-annual', 'mine-menu-about']) {
    rows[id] = await axOf(cdp, `${topSel(id)}`);
  }
  const titleOf = id => page.evaluate(sel => document.querySelector(sel).querySelector('.sz-mine__rowt').textContent.trim(), topSel(id));
  for (const id of Object.keys(rows)) {
    assert.equal(rows[id] && rows[id].name, await titleOf(id), `${id}: accessible name is exactly the row title`);
  }
  const backupSub = await page.textContent(topSel('mine-backup-sub'));
  const backupValue = (await page.textContent(topSel('mine-backup-value'))).replace(/\s*›\s*$/, '').trim();
  assert.ok(rows['mine-menu-backup'].description.includes(backupSub.trim()) && rows['mine-menu-backup'].description.includes(backupValue),
    `mine-menu-backup: subtitle and value are read as the description (${rows['mine-menu-backup'].description})`);
  assert.ok(rows['mine-menu-annual'].description.trim().length > 0, 'mine-menu-annual: the year is read as the description');

  ctx.step('settings (+ 外观 sheet)');
  await page.click(topSel('mine-menu-settings'));
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'settings');
  const switches = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [role="switch"]')]
    .map(el => el.getAttribute('aria-checked')));
  assert.ok(switches.length >= 2 && switches.every(v => v === 'true' || v === 'false'), `switches expose aria-checked (${switches.join(',')})`);
  if (await page.locator(topSel('settings-appearance')).count()) {
    await page.click(topSel('settings-appearance'));
    await dialogCheck(page, cdp, ctx, { label: 'settings/appearance-sheet', panel: tid('settings-appearance-sheet'), opener: 'settings-appearance' });
  }
  await page.goBack();
  await waitTop(page, 'mine');

  ctx.step('backup (+ 清空 sheet)');
  await page.click(topSel('mine-menu-backup'));
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'backup');
  await page.click(topSel('backup-clear'));
  await dialogCheck(page, cdp, ctx, { label: 'backup/clear-sheet', panel: tid('backup-clear-sheet'), opener: 'backup-clear' });
  await page.goBack();
  await waitTop(page, 'mine');

  // ================================================================ 月字帖 / 年报 / 分享弹层（阶段 1 P1-E7）
  ctx.step('month page + 分享弹层: named cells (有墨 / 没墨), the share sheet is a labelled modal dialog');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('month', { month: '2026-09' }));
  await waitTop(page, 'month');
  await page.waitForSelector(topSel('month-cell'));
  await audit(page, cdp, ctx, 'month');
  const monthNames = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell"]')].map(c => c.getAttribute('aria-label')));
  assert.ok(monthNames.length >= 3 && monthNames.every(n => n && n.trim()), `month cells are named (${monthNames.join(' / ')})`);
  await page.click(topSel('month-share'));
  await dialogCheck(page, cdp, ctx, { label: 'month/share-sheet', panel: tid('image-sheet'), opener: 'month-share' });
  await page.goBack();
  await waitTop(page, 'mine');

  ctx.step('annual page (the scroll) + 保存年报弹层');
  await page.click(topSel('mine-menu-annual'));
  await waitTop(page, 'annual');
  await waitNavIdle(page);
  await audit(page, cdp, ctx, 'annual');
  await page.click(topSel('annual-share'));
  await dialogCheck(page, cdp, ctx, { label: 'annual/share-sheet', panel: tid('image-sheet'), opener: 'annual-share' });
  await page.goBack();
  await waitTop(page, 'mine');

  // ================================================================ 阻断页
  ctx.step('storage-blocked page (R-B09)');
  {
    const context = await page.context().browser().newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN' });
    const errors = [];
    try {
      await context.addInitScript(CSP_WATCH);
      await context.addInitScript(DENY_STORAGE);
      const p = await context.newPage();
      p.on('pageerror', error => errors.push(`pageerror: ${error && error.message}`));
      p.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
      const bcdp = await context.newCDPSession(p);
      await bcdp.send('Accessibility.enable');
      await bcdp.send('DOM.enable');
      await p.goto(`${ctx.baseURL}/`);
      await p.waitForSelector(tid('block-screen'));
      await p.waitForTimeout(PRESS_SETTLE_MS);
      const b = await p.evaluate(() => ({
        focusIn: document.querySelector('[data-testid="block-screen"]').contains(document.activeElement),
        tablist: !!document.querySelector('[role="tablist"]'),
      }));
      assert.ok(b.focusIn, 'block page: focus is on the block page');
      assert.equal(b.tablist, false, 'block page: no tab bar');
      await audit(p, bcdp, ctx, 'block');
      assert.deepEqual(errors, [], 'block page: no console errors / page errors');
    } finally {
      await context.close();
    }
  }

  ctx.step('whole run: zero CSP violations on the main page');
  assert.deepEqual(await cspViolations(page), [], 'no securitypolicyviolation events');
}
