// QA-H1 夹具运行时·前导（B3.3）。与 epilogue.js 一起包住 _ops/*.js：App 里由 QAFixtures.swift 拼成 callAsyncJavaScript 的函数体，
// 开发工具 scripts/native-ui/fixture-dev.mjs（Chromium）拼成同样的函数。参数（函数形参）：
//   setup  [{op, …}]   要依次执行的操作（夹具的 setup）
//   pin    字符串       造数据期间钉住的时钟（ISO 本地时间），空 = 不钉
//   chars  [字]         固定 5 字（永 和 春 日 月）
//   clock  字符串       -shizi-qa-clock（全局启动参数），空 = 不改
//   （op 要改全局的东西时，把还原函数 push 进 window.__qaCleanups，下一个顶层夹具清空前会执行）
//   reset  布尔         顶层夹具 true（清空数据、回首页）；base 链里后一个夹具接着前一个的现场 = false
const T = window.__shiziTest;
if (!T) return { ok: false, error: 'no __shiziTest (need -shizi-test-host)' };
const { nav } = await import('/src/ui/router.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
if (reset) {
  // 上一个状态的 op 留下的全局改动（例：setUsage 换掉的占用估算）在清空前先还原：同一次启动要连跑上百个状态
  for (const fn of (window.__qaCleanups || []).splice(0)) { try { fn(); } catch (e) {} }
  try { nav.switchTab('home'); } catch (e) {}
  // B3.F：原生切 tab 不拆根页——每个顶层状态从新挂载的字库 / 我的根页开始（与段 1 每次切 tab 重新挂载一致，取证可复现）
  try { window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'roots-reset' }); } catch (e) {}
  await sleep(120);
  T.reset();
  if (clock) T.setClock(clock);
}
const subst = (v) => {
  if (typeof v === 'string' && v[0] === '$') return ctx.vars[v.slice(1)];
  if (Array.isArray(v)) return v.map(subst);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)]));
  return v;
};
const line = (x0, y0, dx, dy, t0) => Array.from({ length: 14 }, (_, i) => [x0 + dx * i, y0 + dy * i, t0 + i * 16]);
const ctx = {
  T, nav, chars, sleep, vars: {}, subst, unpin: () => unpin(),
  // 固定笔画：one = 一横；two = 一横一竖（与原生书写面注入的同形）
  strokeSet: (name) => (name === 'one' ? [line(70, 150, 15, 1, 1000)] : [line(70, 150, 15, 1, 1000), line(172, 60, 0.5, 17, 2000)]),
  mods: null,
  async load() {
    if (!ctx.mods) {
      const { getStore } = await import('/src/store/store.js');
      const core = await import('/src/core/session-start.js');
      const { deckAdapter } = await import('/src/data/deck.js');
      const env = await import('/src/platform/env.js');
      const { createWriteSessionApi } = await import('/src/ui/screens/write/native-session.js');
      const { writeSnapshot } = await import('/src/session/write-api.js');
      ctx.createWriteSessionApi = createWriteSessionApi;
      ctx.writeSnapshot = writeSnapshot;
      ctx.mods = { store: getStore(), core, deckAdapter, env };
    }
    return ctx.mods;
  },
  // 写字会话 API（每槽一个，第一次要时创建并缓存；openApi op 可以把创建点放在指定位置）。A 槽带一个空的 navigate（结果页由 op 自己推）；B 槽缺省。
  // 创建点要稳定：造数据期间钉住的时钟每次读数 +5ms，FSRS 的 fuzz 种子含复习时刻，所以任何多一次 / 少一次读时钟的改动都会让「N 天后再见」的天数变（B2.9b）
  apis: {},
  api(slot) {
    return ctx.apis[slot] || (ctx.apis[slot] = slot === 'A' ? ctx.createWriteSessionApi({ navigate: { back() {}, toResult() {} } }) : ctx.createWriteSessionApi());
  },
};
// 模块先载入一遍（只有这次启动里第一个状态才真的载入，之后都是缓存）：载入要走事件循环，不能落在钉住的时钟里。
if (!window.__qaModulesWarm) { await ctx.load(); ctx.mods = null; window.__qaModulesWarm = true; }
// 取证数据要可复现——「N 天后再见」的天数来自 FSRS（fuzz 种子含复习时刻，毫秒级），每次取证时刻不同天数就不同。
// 造数据期间把页面时钟钉在固定时刻（每次读数 +5ms，顺序确定），造完从那一刻起照常流逝；网页参考与原生取证因此是同一份数据、同一个落款日期。
let pinned = false;
const realNow = Date.now;
const unpin = () => { if (!pinned) return; pinned = false; const at = Date.now(); Date.now = realNow; T.setClock(at); };
let pinK = 0;
if (pin) {
  const FIX = new Date(pin).getTime();
  Date.now = () => FIX + (pinK += 5);
  pinned = true;
  // B4.9c：写入者是 SwiftEngine 时它的钟（QAClock）在造数据期间也钉在这一刻（不读页面时钟，不动 pinK）——否则 Swift 在造数据途中写下的时刻
  // （路由提示的离开时刻、跨天作废的判断）是真实时间，杀进程重开时判成「离开太久」
  try { window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'qa-clock', offsetMs: FIX - realNow() }); } catch (e) {}
}
// R16：把钉住的时钟拨到第 tick 次读数（op 的 tick 参数，judge 用）。读时钟的次数在 op 之间会被页面渲染（网页 Preact）与原生根页的
// 视图请求（原生取证）插进来，次数随界面实现与时序变；op 自己的同步段里没有让出、次数确定。所以写判断记录（FSRS fuzz 种子含复习时刻）
// 之前把计数拨到夹具写明的值，「N 天后再见」就与谁在前面读过时钟无关（网页参考、原生取证、Chromium 开发工具同一个数）。
ctx.repin = (tick) => { if (pinned) pinK = Number(tick) * 5; };
// 钉住之后再调一次 load()：原来的写法是钉住时钟之后才载入各模块，造数据时读时钟的次数要和原来逐位一致（B2.9b 参考图里的「N 天后再见」靠它）。
await ctx.load();
const OPS = {};
