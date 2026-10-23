// 打开原生 tab 根页（B3.5b；tab 根页的原生类带 root-pending，Swift 一侧默认不放进注入网页的原生屏清单，B3.5d 三个根页同开后这个 op 与各夹具里的这一步一起删）。
// 把 a.screens（缺省 ['library']）放进 window.__shiziNativeScreens，之后切到这个 tab，网页就把根页渲染成原生宿主。
// 只在原生壳里有意义（网页参考取证时没有 __shiziNativeScreens，什么也不改）；还原登记进 __qaCleanups（下一个顶层夹具清空前执行）。
const screens = Array.isArray(a.screens) && a.screens.length ? a.screens : ['library'];
const before = window.__shiziNativeScreens;
if (Array.isArray(before)) {
  window.__shiziNativeScreens = [...new Set([...before, ...screens])];
  (window.__qaCleanups = window.__qaCleanups || []).push(() => { window.__shiziNativeScreens = before; });
}
