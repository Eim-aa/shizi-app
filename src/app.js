// 原生桥必须是第一条语句：模块顶层同步定义 iOS→JS 全局（01 §8.1），store 就绪前的调用进队列。
import './platform/bridge.js';
// P1-E6b：系统字号在模块求值时就应用原生注入的档位（早于 DOMContentLoaded 与 UI 挂载），冷启动首帧即目标字号；网页无注入则无事发生。
import './platform/text-size.js';
import { FACES } from './data/font-loader.js';
import { isNativeShell } from './platform/env.js';

// 拾字 v10 启动入口。完整启动顺序见 01-架构设计 §2：
//   import './platform/bridge.js'（M0 验收修复起静态导入，M5-5 扩展）→ 加载数据 → 迁移（M5-4）→ 建 store（M0-5）→ 挂载 UI（本卡）
//   → bridge.markReady → postMessage pageReady（M5-3）→ 注册 SW（M5-1）。
// 当前（M0-4）：?dev=1 → 色板页（M0-3）；否则挂根组件（router + 三 tab）。

// Q3：冷启动分段打点（performance.mark，名字以 shizi: 开头）。e2e 68-q3-boot 与模拟器量测读这些点（01 §8.8）；打点失败不影响启动。
function mark(name) {
  try {
    performance.mark(`shizi:${name}`);
  } catch (error) {
    // 没有 User Timing 的环境：不打点
  }
}
mark('app-eval');

// Q3：iOS WKWebView 的首帧要等首屏用到的网页字体载完才画（模拟器实测：三种字体 loaded 后约 3ms 即首帧）。不预热时
// 字体到挂载后第一次排版才开始取、解码（ShiziKai woff2 1.7MB），挂载后还要等 40–110ms。原生壳里模块一求值就并行加载
// 三种 face（fonts/fonts.css 已声明，随包本地文件），与 store / 迁移 / 挂载重叠；失败不影响启动（DOM 文字 swap 回退，
// canvas 仍由 requireFont 把关）。网页（浏览器 / PWA）首帧不等字体、首屏也用不到全部 face，不预热，省首访流量（01 §8.8）。
function warmFonts() {
  if (!isNativeShell()) return;
  try {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.load !== 'function') return;
    for (const face of Object.values(FACES)) {
      fonts.load(`${face.weight} 16px "${face.family}"`).catch(() => {});
    }
  } catch (error) {
    // 没有 FontFaceSet：照旧由排版触发加载
  }
}
warmFonts();

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
    mark('store-modules');
    bootStore({ onStorage: storage => mountTestHooks({ storage, getStore }) });
    mark('store');
  } catch (error) {
    console.error('[shizi] store boot failed:', error);
  }
  await import('./store/migrate.js').then(m => m.bootMigration()).then(r => (r && r.ok === false ? import('./ui/screens/block/index.js').then(b => b.reportMigrationFailure({ reason: r.error && r.error.kind })) : null)).catch(error => console.warn('[shizi] migration failed:', error)); // M5-4：v1 → v2 迁移（01 §12；失败 → R-B09 迁移变体，M5-6）
  mark('migrate');
  await import('./platform/appearance.js').then(m => m.bootAppearance()).catch(error => console.warn('[shizi] appearance failed:', error)); // M4-3：按 settings 应用 data-theme（挂 UI 前）
  const { mountRoot } = await import('./ui/root.js');
  mark('ui-modules');
  await mountRoot(container);
  mark('mounted');
  requestAnimationFrame(() => requestAnimationFrame(() => mark('first-frame')));
  await import('./ui/screens/mine/settings.js').then(m => m.clearLegacyLargeFlag()).catch(error => console.warn('[shizi] legacy large flag failed:', error)); // P1-E6 / D29 / P132 / D58：v1 迁移带来的 large=true 静默去掉，不弹说明
  await import('./platform/accessibility.js').catch(error => console.warn('[shizi] accessibility status setup failed:', error)); // 阶段 0 B2 / P116：注册读屏状态的桥实现（markReady 之前，pageReady 时原生才发状态）
  await import('./platform/reminder.js').then(m => m.startReminder()).catch(error => console.warn('[shizi] reminder setup failed:', error)); // M5-5：注册提醒桥实现 → bridge.markReady(store) 回放积压调用（冷启动深链）→ 提醒同步（01 §8.1）
  await import('./platform/bridge.js').then(async b => { try { b.markReady((await import('./store/store.js')).getStore()); } finally { mark('ready'); b.postNative('pageReady', {}); } }).catch(error => console.warn('[shizi] native pageReady failed:', error)); // M5-3：markReady（幂等，回放积压的原生调用）之后 postMessage pageReady，原生这时才派发提醒深链（01 §2、§8.2）
  await import('./platform/sw.js').then(m => m.startServiceWorker()).catch(error => console.warn('[shizi] service worker setup failed:', error)); // M5-1：BUILD 比对、就绪标记、注册 SW（01 §8.3）
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
