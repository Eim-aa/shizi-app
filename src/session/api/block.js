// App API · 阻断页（block.*，引擎不可用时也能画）：B3.2 预先建好的空文件，B3.13 填内容。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-<页>.test.mjs（网页路径 == API 路径）。
//
//   view.block {kind?, migration?, still?, exportFail?, canExport?} → {ok, view}：views/block.js blockView（= 网页阻断页渲染用的同一份模型）
//   block.retry {kind?}            「再试一次」：unavailable = store.reload() 重新探测（回 {ok, still}：仍不可用时说「还是存不了」）；
//                                 blocked / migration = 整页重新启动（回 {ok, reload:true}：网页 location.reload()、原生重载网页）
//   block.export {}                导出备份的内容（只读：打包内存状态，不写入任何键）→ {ok, name, text}
//   block.exportable {}            现在能不能导出备份（'blocked' 且内存状态可读且有判断过的字）→ {ok, exportable}
//
// 引擎不可用时（store 没建成 / WebContent 被回收）这一页仍要能画：原生版不依赖 JS 回包——
// 文案全在 ShiziCopy（构建期生成），来由取 ShiziEngine.status（blocked(reason)），可导出与否由 block.exportable op 补。

import { blockBackup, blockReasonOf, blockView, hasJudged } from '../views/block.js';

function storeOf(ctx) {
  try {
    return ctx.getStore();
  } catch (error) {
    return null;
  }
}

function statusOf(ctx) {
  const store = storeOf(ctx);
  return store ? store.status : null;
}

/** 现在能不能导出备份（网页阻断页与原生同一组判断）。 */
function exportableOf(ctx) {
  const store = storeOf(ctx);
  if (!store) return false;
  const reason = blockReasonOf(store.status);
  if (!reason || reason.kind !== 'blocked') return false;
  if (!(store.status && store.status.available)) return false;
  return hasJudged(store);
}

export const OPS = Object.freeze({
  'view.block': (args, ctx) => {
    const a = args && typeof args === 'object' ? args : {};
    const reason = blockReasonOf(statusOf(ctx), a.migration || null);
    const kind = typeof a.kind === 'string' && a.kind ? a.kind : reason ? reason.kind : 'unavailable';
    const canExport = a.canExport !== undefined ? !!a.canExport : exportableOf(ctx);
    return { ok: true, view: blockView({ kind, canExport, still: !!a.still, exportFail: !!a.exportFail }) };
  },
  'block.retry': (args, ctx) => {
    const a = args && typeof args === 'object' ? args : {};
    const kind = typeof a.kind === 'string' && a.kind ? a.kind : (blockReasonOf(statusOf(ctx)) || { kind: 'unavailable' }).kind;
    if (kind !== 'unavailable') return { ok: true, reload: true }; // 阻断 / 迁移：整页重新启动
    const store = storeOf(ctx);
    if (!store) return { ok: true, still: true }; // 引擎不可用：还是存不了
    try {
      store.reload(); // 重新探测；恢复后 store 通知 → 根组件换回 tab
    } catch (error) {
      return { ok: true, still: true };
    }
    const still = !(store.status && store.status.available);
    return { ok: true, still };
  },
  'block.export': (args, ctx) => {
    const store = storeOf(ctx);
    if (!store) return { ok: false, error: { kind: 'unavailable' } };
    const now = typeof ctx.now === 'function' ? ctx.now() : Date.now();
    return { ok: true, ...blockBackup(store, now) };
  },
  'block.exportable': (args, ctx) => ({ ok: true, exportable: exportableOf(ctx) }),
});
