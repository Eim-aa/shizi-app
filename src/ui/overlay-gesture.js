// 弹层上的左缘右滑（交互与动效规范 N3-6 / N4，D58；审计 P1-06）：顶层是弹层时，左缘右滑只作用于最上层弹层，页面不动——
// 跟手把弹层面板往右推、遮罩随进度变淡；松手按同一阈值（router.createBackGestureController）关掉或回弹（gesture.snap 200ms）。
// 关掉时在弹层根上标 data-exit-kind="fade"，退场余影（components/exit.js）从手指松开的位置原地淡出，不再从下面滑走。
// 只写 DOM 样式（与页面跟手同一做法，不走 setState）；控制器给 view = {phase:'follow'|'snap'|'commit', overlay:true, x, progress, width}。
/** 最上层页面图层里最上面那个（还活着的）弹层：{root, panel, scrim}。 */
export function topOverlayEls(app) {
  if (!app) return null;
  const layer = app.querySelector('.sz-layer[data-top="true"]');
  if (!layer) return null;
  const roots = [...layer.querySelectorAll(':scope > .sz-overlay:not(.sz-exit)')];
  const root = roots[roots.length - 1];
  if (!root) return null;
  return {
    root,
    panel: root.querySelector(':scope > .sz-sheet, :scope > .sz-confirm'),
    scrim: root.querySelector(':scope > .sz-scrim'),
  };
}

function panelTransform(panel, x) {
  if (!panel) return '';
  // 确认框靠 translateY(-50%) 垂直居中，跟手位移叠在它后面
  const base = panel.classList.contains('sz-confirm') ? 'translateY(-50%) ' : '';
  return x > 0 ? `${base}translateX(${x}px)` : '';
}

/** 画一帧。state 是 root 里留着的 {els}（同一次手势复用）。 */
export function paintOverlayGesture(app, view, state) {
  if (!state.els || !state.els.root.isConnected) state.els = topOverlayEls(app);
  const els = state.els;
  if (!els) return;
  const { panel, scrim, root } = els;
  const x = Number.isFinite(view.x) ? view.x : (view.progress || 0) * (view.width || 1);
  if (view.phase === 'snap') {
    for (const el of [panel, scrim]) if (el) el.setAttribute('data-drag', 'snap');
    if (panel) panel.style.transform = '';
    if (scrim) scrim.style.opacity = '';
    return;
  }
  if (view.phase === 'commit') {
    root.setAttribute('data-exit-kind', 'fade');
    return;
  }
  for (const el of [panel, scrim]) if (el) el.setAttribute('data-drag', 'follow');
  if (panel) panel.style.transform = panelTransform(panel, x);
  if (scrim) scrim.style.opacity = String(Math.max(0, 1 - (view.progress || 0)));
}

/** 手势结束（view = null）：弹层还在（回弹 / 关不掉）就清掉跟手样式；已经卸载的不用管。 */
export function clearOverlayGesture(state) {
  const els = state.els;
  state.els = null;
  if (!els || !els.root.isConnected) return;
  const { panel, scrim, root } = els;
  root.removeAttribute('data-exit-kind');
  // 控制器在回弹画完（gestureSnap）之后才给 null，这里直接收尾
  for (const el of [panel, scrim]) {
    if (!el) continue;
    el.removeAttribute('data-drag');
    el.style.transform = '';
    el.style.opacity = '';
  }
}
