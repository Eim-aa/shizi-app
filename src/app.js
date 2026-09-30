// 拾字 v10 启动入口。完整启动顺序见 01-架构设计 §2：
//   import './platform/bridge.js'（M5-5）→ 加载数据 → 迁移（M5-4）→ 建 store（M0-5）→ 挂载 UI（本卡）
//   → bridge.markReady → postMessage pageReady（M5-3）→ 注册 SW（M5-1）。
// 当前（M0-4）：?dev=1 → 色板页（M0-3）；否则挂根组件（router + 三 tab）。

function isDevMode() {
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch (error) {
    return false;
  }
}

async function mountApp() {
  const container = document.getElementById('app');
  if (!container) return;
  // M0-5：store 在这里建好后再挂 UI。测试钩子只在 isTestHost() 为真时挂到 window（在 repair 之前挂，写日志完整）。
  try {
    const { bootStore, getStore } = await import('./store/store.js');
    const { mountTestHooks } = await import('./platform/test-hooks.js');
    bootStore({ onStorage: storage => mountTestHooks({ storage, getStore }) });
  } catch (error) {
    console.error('[shizi] store boot failed:', error);
  }
  const { mountRoot } = await import('./ui/root.js');
  await mountRoot(container);
}

async function mountDevPalette() {
  try {
    const mod = await import('./ui/dev/palette.js');
    if (typeof mod.mountPalette !== 'function') throw new Error('palette.js has no mountPalette export');
    mod.mountPalette(document.body);
  } catch (error) {
    // 色板页缺失或出错时退回正常界面，不打断启动。
    console.warn('[shizi] dev palette unavailable:', error && error.message ? error.message : error);
    await mountApp();
  }
}

function start() {
  const run = isDevMode() ? mountDevPalette : mountApp;
  run().catch(error => {
    console.error('[shizi] startup failed:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
