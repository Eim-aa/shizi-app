// B3.5a：打开原生 tab 根页（B3.5d 与 Tab 栏同开之前只在 window.__shiziNativeRoots 时出现，ui/native-stage.js nativeRootsOn）。
// 先切到别的 tab、等它画出来再切回：根页重新挂载（新条目 id → 原生建一张新的根页；网页取证时网页首页也重新挂载，不带上一个状态的页内状态，
// 例：上一个状态的开组失败三段式）。登记还原：下一个顶层夹具清空前关掉、再切走（之后的首页是网页版）。
// 网页取证时（没有 __shiziNative）这只是一次切 tab，页面不变。a: {tab}（缺省 home）
window.__shiziNativeRoots = true;
const tab = a.tab || 'home';
const other = tab === 'mine' ? 'home' : 'mine';
try { ctx.nav.switchTab(other); } catch (e) {}
await ctx.sleep(80);
try { ctx.nav.switchTab(tab); } catch (e) {}
await ctx.sleep(80);
(window.__qaCleanups = window.__qaCleanups || []).push(() => {
  window.__shiziNativeRoots = false;
  try { ctx.nav.switchTab(other); } catch (e) {}
});
