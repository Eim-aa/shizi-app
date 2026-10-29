// App API（B3.2；docs/engineering/v10/B3B4-原生化架构与计划.md §3.4）：window.shiziNative(op, args) → Promise<{ok, …}> 的实现（无 DOM）。
//
// 原生页面全部是视图，经这一组 op 读写（B4 换成 Swift 的 SwiftEngine 实现同一组 op，原生页面一行不改）：
//   视图（只读）  view.<屏名> {…}       → {ok:true, view}：网页页面渲染用的同一个模型函数的结果（src/session/views/）；宿主挂载时随 open 一起推给原生
//   写入          <页>.<动作> {…}       → 现有提交函数的薄包装；D07：回 {ok:false, error:{kind}} 时原生就地三段式
//   导航          nav.push / replace / back / tab / setParams（./nav.js，网页路由执行）
//   写字会话      write.<op>            → 写字 / 结果页会话 API（window.shiziNativeWrite 是它的子集，B2 页面不改）
//   订阅          changed {domains}     → 页面 → 原生推送：store 每次成功提交后一次（createChangeFeed），带脏域；可见的原生页重拉自己的 view.*
//
// 每页一个文件（./<页>.js，导出 OPS）。下面的导入清单在 B3.2 一次列全（含还空着的页面文件），页面卡只填自己的文件、不改本文件。
// op 名重复（两个文件登记了同一个 op）在建表时直接报错。

import { getStore as defaultGetStore } from '../../store/store.js';
import { DOMAINS, specForKey } from '../../core/schema.js';
import { OPS as about } from './about.js';
import { OPS as nav } from './nav.js';
import { OPS as home } from './home.js';
import { OPS as library } from './library.js';
import { OPS as mine } from './mine.js';
import { OPS as tabs } from './tabs.js';
import { OPS as query } from './query.js';
import { OPS as detail } from './detail.js';
import { OPS as librarySub } from './library-sub.js';
import { OPS as mineSub } from './mine-sub.js';
import { OPS as settings } from './settings.js';
import { OPS as backup } from './backup.js';
import { OPS as image } from './image.js';
import { OPS as session } from './session.js';
import { OPS as block } from './block.js';
import { OPS as route } from './route.js';

/** 页面 API 文件（固定清单；node 测试核对目录里正好是这些文件）。 */
export const API_FILES = Object.freeze({
  'about.js': about, 'nav.js': nav, 'home.js': home, 'library.js': library, 'mine.js': mine, 'tabs.js': tabs, 'query.js': query, 'detail.js': detail,
  'library-sub.js': librarySub, 'mine-sub.js': mineSub, 'settings.js': settings, 'backup.js': backup, 'image.js': image, 'session.js': session,
  'block.js': block, 'route.js': route,
});

/** 合并全部页面文件的 op 表；重名报错。 */
export function buildOpTable(files = API_FILES) {
  const table = Object.create(null);
  for (const [file, ops] of Object.entries(files)) {
    for (const [op, fn] of Object.entries(ops || {})) {
      if (typeof fn !== 'function') throw new TypeError(`App API ${file}: ${op} is not a function`);
      if (table[op]) throw new Error(`App API: op ${op} is declared twice (${table[op].file} and ${file})`);
      table[op] = { fn, file };
    }
  }
  return table;
}

const TABLE = buildOpTable();

/** 全部 op 名（含写字会话的 write.* 不在内）。 */
export function listOps() {
  return Object.keys(TABLE).sort();
}

function failure(kind, extra) {
  return { ok: false, error: { kind, ...(extra || {}) } };
}

function normalize(r) {
  if (!r || typeof r !== 'object') return failure('invalid-reply');
  return r;
}

/**
 * @param {{getStore?: () => object, nav?: object, build?: {version: string, build: string}, native?: boolean,
 *          write?: {call(op: string, args?: object): object}, now?: () => number}} deps
 *   nav：网页路由（ui/router.js 的 nav；会话层不导入 UI）；build：版本与构建号（src/build-info.js；可以是取值函数）；native：是否在 iOS 壳里（platform/env.js）；
 *   write：写字会话 API（write-api.js createWriteSessionApi；write.<op> 转给它）。
 * @returns {{call(op: string, args?: object): object | Promise<object>, ops: string[]}}
 */
export function createAppApi(deps = {}) {
  const ctx = {
    getStore: deps.getStore || defaultGetStore,
    nav: deps.nav || null,
    build: deps.build || { version: '', build: '' },
    native: deps.native === true,
    now: deps.now || (() => Date.now()),
    write: deps.write || null,
    route: deps.route || null, // B3.F：route.* / deeplink.reminder / stage.enter|resync 的实现（ui/engine.js 注入；网页版没有）
  };
  return {
    ops: listOps(),
    call(op, args) {
      const a = args && typeof args === 'object' ? args : {};
      if (typeof op !== 'string') return failure('invalid');
      if (op.startsWith('write.')) {
        if (!ctx.write) return failure('unavailable');
        return ctx.write.call(op.slice('write.'.length), a);
      }
      const entry = TABLE[op];
      if (!entry) return failure('unknown-op', { op });
      try {
        const r = entry.fn(a, ctx);
        if (r && typeof r.then === 'function') return r.then(normalize, error => failure('exception', { reason: String(error && error.message || error) }));
        return normalize(r);
      } catch (error) {
        return failure('exception', { reason: String(error && error.message || error) });
      }
    },
  };
}

// ---------------------------------------------------------------- changed 推送

/** store 通知（store.subscribe 的 info）→ 脏域（DOMAINS 的子集，按 DOMAINS 顺序）。load / 整体替换 = 全部域；status = 空（只是状态）。 */
export function domainsOf(info) {
  if (!info || typeof info !== 'object') return [];
  if (info.type === 'load' || info.replace === true) return [...DOMAINS];
  if (info.type !== 'commit' && info.type !== 'recover') return [];
  const set = new Set();
  for (const key of info.keys || []) {
    const spec = specForKey(key);
    if (spec && spec.domain) set.add(spec.domain);
  }
  // 旁路回收（撞配额）动过的月份：records / ink
  if (Array.isArray(info.recovered) && info.recovered.length) { set.add('records'); set.add('ink'); }
  return DOMAINS.filter(d => set.has(d));
}

/**
 * 订阅 store：每次成功提交后发一次 {domains}（没有脏域的通知不发）。post 由 UI 层注入（postNative('native', {op:'changed', …})）。
 * @returns {() => void} 退订
 */
export function createChangeFeed({ store, post }) {
  if (!store || typeof store.subscribe !== 'function' || typeof post !== 'function') return () => {};
  return store.subscribe((state, info) => {
    const domains = domainsOf(info);
    if (!domains.length) return;
    try {
      post({ domains, label: info && info.label ? String(info.label) : null });
    } catch (error) {
      // 推送失败不影响提交
    }
  });
}
