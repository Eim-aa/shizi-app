// e2e 共用辅助（不是 spec：run.mjs 只加载 *.spec.js）。M1-1 起所有写字页相关 spec 用这里的等待与造数。
//
//   waitNavIdle(page)              等 .sz-app[data-nav-anim=idle] 再等 450ms（新页面 / 新状态后 0.4s 按钮不响应，01 §6.6）
//   bootTestHost(page, baseURL)    打开 /?test=1（测试钩子 window.__shiziTest 只在测试宿主挂载，01 §11）；
//                                  默认先 freshRoute(page)（{coldRoute:true} 不装），见下
//   freshRoute(page)               审查整改 F1：给这个 page 装一次 init script——新导航（history.state 为空）前删掉路由提示
//                                  shizi.v2.route，于是 goto 照旧落首页（各 spec 写于冷启动恢复之前，「新开页面 = 首页」是前提）；
//                                  刷新（history.state 在）不受影响。冷启动恢复本身由 64-cold-start 用全新 context 覆盖。
//   resetStore(page)               __shiziTest.reset()：清全部 shizi.* 键、复原时钟、清写日志
//   makeSession({...})             造一个 01 §3.3 形状的会话对象（纯函数）
//   seedSession(page, {...})       reset（可选）+ seed 一个会话到 sessions[slot]；返回 {ok, state}
//   openWrite(page, {slot})        从首页测试入口（A）或 nav.push（B）打开写字页并等 idle
//   gridRect(page)                 顶层写字页书写格的 CSS 矩形
//   drawStroke(page, pts, opts)    用鼠标在书写格里画一笔；pts 为书写格内 0–1 的相对坐标
//   writeSnapshot(page)            写字页当前状态（笔数、按钮可用性、进度文字、cursor…）
//   canvasInk(page, testid)        某层 canvas 的非透明像素数
//   installNativeStub(page)        在页面加载前装一个假的 webkit.messageHandlers.shiziNative，记录 postMessage

export const tid = id => `[data-testid="${id}"]`;
/** 顶层图层里的元素（下层页面保持挂载，选择器要限定在顶层）。 */
export const topSel = id => `.sz-layer[data-top="true"] ${tid(id)}`;

export const PRESS_SETTLE_MS = 450;

export async function waitNavIdle(page, { settleMs = PRESS_SETTLE_MS } = {}) {
  await page.waitForFunction(() => {
    const app = document.querySelector('.sz-app');
    return !!app && app.dataset.navAnim === 'idle';
  });
  await page.waitForTimeout(settleMs);
}

export const ROUTE_KEY = 'shizi.v2.route';
const freshRoutePages = new WeakSet();

export async function freshRoute(page) {
  if (freshRoutePages.has(page)) return;
  freshRoutePages.add(page);
  await page.addInitScript(key => {
    try {
      if (!window.history.state) window.localStorage.removeItem(key);
    } catch (error) {
      // about:blank 等无存储的页面
    }
  }, ROUTE_KEY);
}

export async function bootTestHost(page, baseURL, { query = '', coldRoute = false } = {}) {
  if (!coldRoute) await freshRoute(page);
  await page.goto(`${baseURL}/?test=1${query ? `&${query}` : ''}`);
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
}

export async function resetStore(page) {
  return page.evaluate(() => window.__shiziTest.reset());
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

export function localDayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 01 §3.3 形状的会话。chars → queue ['base:<字>'…]。
 * @param {{id?:string, slot?:'A'|'B', kind?:'first'|'daily'|'picked', chars:string[], cursor?:number, at?:number,
 *          current?:object, items?:object[], lastLine?:object|null}} o
 */
export function makeSession({ id = 's1', slot = 'A', kind, chars, cursor = 0, at = Date.now(), current, items = [], lastLine = null }) {
  const k = kind || (slot === 'B' ? 'picked' : 'daily');
  return {
    id,
    slot,
    kind: k,
    source: { view: 'home' },
    queue: chars.map(c => `base:${c}`),
    cursor,
    items,
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false, ...(current || {}) },
    lastLine,
    startedAt: at,
    startedDay: localDayOf(at),
    updatedAt: at,
  };
}

/**
 * 把一个会话 seed 进 sessions[slot]（另一槽为空）。reset=true 时先 __shiziTest.reset()。
 * extraState：一并 seed 的其他域（records / sched …）。返回 {ok, state}。
 */
export async function seedSession(page, { reset = true, extraState = {}, ...sessionOpts }) {
  const session = makeSession(sessionOpts);
  const slot = session.slot;
  const state = {
    ...extraState,
    sessions: { A: slot === 'A' ? session : null, B: slot === 'B' ? session : null, lastEnded: {} },
  };
  return page.evaluate(({ state: s, reset: r }) => {
    if (r) window.__shiziTest.reset();
    const result = window.__shiziTest.seed(s);
    return { ok: !!(result && result.ok), result, state: window.__shiziTest.getState() };
  }, { state, reset });
}

/** 从首页打开写字页：A 槽走首页测试入口按钮（write-test-entry），B 槽直接 nav.push。 */
export async function openWrite(page, { slot = 'A' } = {}) {
  if (slot === 'A') {
    await page.click(tid('write-test-entry'));
  } else {
    await page.evaluate(async s => {
      const { nav } = await import('/src/ui/router.js');
      nav.push('write', { slot: s });
    }, slot);
  }
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

export async function gridRect(page, testid = 'write-grid-live') {
  const box = await page.locator(topSel(testid)).boundingBox();
  if (!box) throw new Error(`no bounding box for ${testid}`);
  return box;
}

/**
 * 在书写格里画一笔。pts：[[fx, fy], …]，书写格内 0–1 相对坐标；相邻两点之间插 steps 个鼠标移动。
 * opts.beforeUp(page)：抬笔前执行（中断测试用）。
 */
export async function drawStroke(page, pts, { steps = 8, beforeUp = null, testid = 'write-grid-live' } = {}) {
  const r = await gridRect(page, testid);
  const at = ([fx, fy]) => [r.x + fx * r.width, r.y + fy * r.height];
  const [x0, y0] = at(pts[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i += 1) {
    const [x, y] = at(pts[i]);
    await page.mouse.move(x, y, { steps });
  }
  if (typeof beforeUp === 'function') await beforeUp(page);
  await page.mouse.up();
}

export const HORIZONTAL = [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]];
export const VERTICAL = [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]];

export async function writeSnapshot(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const btn = id => {
      const el = q(id);
      return el ? { disabled: el.disabled, ariaDisabled: el.getAttribute('aria-disabled') } : null;
    };
    const grid = q('write-grid');
    const wrap = top ? top.querySelector('.sz-write') : null;
    const tools = q('write-tools');
    return {
      screen: document.querySelector('.sz-app').dataset.topScreen,
      strokes: grid ? Number(grid.dataset.strokeCount) : null,
      cursor: wrap ? Number(wrap.dataset.cursor) : null,
      phase: wrap ? wrap.dataset.phase : null,
      progress: q('write-progress') ? q('write-progress').textContent : null,
      title: top && top.querySelector('[data-page-title]') ? top.querySelector('[data-page-title]').textContent : null,
      done: btn('write-done'),
      undo: btn('write-undo'),
      clear: btn('write-clear'),
      toolsShown: tools ? tools.dataset.shown === 'true' : null,
    };
  });
}

/** 某层 canvas 的非透明像素数（固化层 write-grid-ink / 当前笔层 write-grid-live）。 */
export async function canvasInk(page, testid = 'write-grid-ink') {
  return page.evaluate(id => {
    const c = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`);
    if (!c) return -1;
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
    return n;
  }, testid);
}

/** 假原生通道：页面里 window.__nativeMsgs 记录每次 postMessage（bridge.setBackGestureEnabled 等）。 */
export async function installNativeStub(page) {
  await page.addInitScript(() => {
    window.__nativeMsgs = [];
    window.webkit = {
      messageHandlers: {
        shiziNative: { postMessage: msg => window.__nativeMsgs.push(JSON.parse(JSON.stringify(msg))) },
      },
    };
  });
}

export async function nativeMessages(page, type) {
  return page.evaluate(t => (window.__nativeMsgs || []).filter(m => !t || m.type === t), type || null);
}
