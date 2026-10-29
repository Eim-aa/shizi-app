// 切 tab 根页。a: {tab, remount?}
// remount: true（B3.5d，取代 B3.5a 的 nativeRoots op）：先切到别的 tab、等它画出来再切回——根页重新挂载（新条目 id → 原生建一张新的根页；
// 网页取证时网页首页也重新挂载，不带上一个状态的页内状态，例：上一个状态的开组失败三段式）。登记还原：下一个顶层夹具清空前再切走一次，
// 之后的状态从别的 tab 回来也是重新挂载。
const tab = a.tab || 'home';
if (!a.remount) {
  try { ctx.nav.switchTab(tab); } catch (e) {}
} else {
  const other = tab === 'mine' ? 'home' : 'mine';
  // B3.F：原生切 tab 不拆根页（每格留着自己的根页）——夹具要新挂载的根页：每次切之前请原生拆掉没选中的格里留着的根页
  const rootsReset = () => { try { window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'roots-reset' }); } catch (e) {} };
  rootsReset();
  try { ctx.nav.switchTab(other); } catch (e) {}
  await ctx.sleep(80);
  rootsReset();
  try { ctx.nav.switchTab(tab); } catch (e) {}
  await ctx.sleep(80);
  (window.__qaCleanups = window.__qaCleanups || []).push(() => {
    try { ctx.nav.switchTab(other); } catch (e) {}
  });
}
