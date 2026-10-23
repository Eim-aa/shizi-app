// App API · 字详情（B3.7）：view.detail、view.detail-photo、detail.wordOff / wordOn / addCustom / removeCustom / restoreCustom / correct / practice / image。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回网页页面渲染用的同一组模型函数的结果（src/session/views/detail.js：detailModel / detailHero /
// cellCopy 外面一层「文案引用 + 笔画」的壳）；写入 op 是 src/session/ops/detail.js 现有提交函数的薄包装（网页页面调的就是这几个函数，D07：失败回 {ok:false, error:{kind}}，
// 什么都不写，原生页就地三段式）。契约测试 test/ui/native-detail.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.7 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。
//
// 「练这个字」「做成图片」两个去处不在会话层（要开写字页 / 分享弹层，碰路由与弹层）：由网页字详情页模块（ui/screens/detail/index.js）启动时经 setDetailHooks 注册，
// 与网页页面里的 setDetailImageAction / startPicked 是同一个函数——原生页点按与网页页面点按走同一条入口规则（S02、来源矩形、撤销交接都是 JS 那一份）。

import { localDay } from '../../core/dates.js';
import { etymologyOf, loadEtymology } from '../../data/etymology.js';
import { baseKey, detailModel, detailView, hasInkPoints, inkOf, photoView } from '../views/detail.js';
import { commitAddCustom, commitCorrectRecord, commitRemoveCustom, commitRestoreCustom, commitWordOff, commitWordOn } from '../ops/detail.js';

const hooks = { practice: null, image: null };

/** 网页字详情页注册两个去处：practice(chars, {source}) = session/index.js startPicked；image({char, cardKey, record}) = 做成图片（M4-5 注册的那个）。传 null 取消。 */
export function setDetailHooks(next = {}) {
  if ('practice' in next) hooks.practice = typeof next.practice === 'function' ? next.practice : null;
  if ('image' in next) hooks.image = typeof next.image === 'function' ? next.image : null;
}

export function detailHooks() {
  return hooks;
}

const str = v => (typeof v === 'string' && v ? v : null);
const bad = () => ({ ok: false, error: { kind: 'invalid' } });

function storeOf(ctx) {
  try {
    return ctx.getStore();
  } catch (error) {
    return null;
  }
}

/** commit 的结果收成 {ok} / {ok:false, error:{kind}}（原生只认这两样；其余字段不外带）。 */
function plain(result, extra) {
  if (result && result.ok) return { ok: true, ...(extra || {}) };
  const kind = result && result.error && typeof result.error.kind === 'string' ? result.error.kind : 'failed';
  return { ok: false, error: { kind } };
}

export const OPS = Object.freeze({
  'view.detail': async (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    // 字源（R-D09）：data/etymology.json 读一次（失败不缓存）；读不到这一块就不显示，与网页页面一致
    await loadEtymology();
    const today = localDay(ctx.now());
    return { ok: true, view: detailView(store, char, { today, etymology: etymologyOf(char), imageAction: !!hooks.image }) };
  },
  'view.detail-photo': (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    return { ok: true, view: photoView(store.getState(), char) };
  },

  // 「换个词语」/ 横幅「撤销」
  'detail.wordOff': (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    return plain(commitWordOff(store, baseKey(char)));
  },
  'detail.wordOn': (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    return plain(commitWordOn(store, baseKey(char)));
  },
  // 自选：加入（成功不提示）/ 移出（回 removed 给撤销条）/ 撤销
  'detail.addCustom': (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    return plain(commitAddCustom(store, char));
  },
  'detail.removeCustom': (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    const r = commitRemoveCustom(store, char);
    return plain(r, { removed: r && r.ok ? r.removed || null : null });
  },
  'detail.restoreCustom': (args, ctx) => {
    const store = storeOf(ctx);
    const removed = args.removed && typeof args.removed === 'object' ? args.removed : null;
    if (!store || !removed) return bad();
    return plain(commitRestoreCustom(store, removed));
  },
  // 记录格放大里改判（缺省 = 反过来；记录已不存在 / 不能改 = stale，原生同网页：关弹层）
  'detail.correct': (args, ctx) => {
    const recordId = str(args.recordId);
    const store = storeOf(ctx);
    if (!recordId || !store) return bad();
    const to = args.to === 'correct' || args.to === 'wrong' ? args.to : undefined;
    return plain(commitCorrectRecord(store, { recordId, to }));
  },

  // 「练这个字」：网页页面里同一个 startPicked（一次 commit + 打开写字页；旧 B 没写完弹 S02）。回 {ok, opened}；开组写入失败 {ok:false, error:{kind}}
  'detail.practice': (args, ctx) => {
    const char = str(args.char);
    if (!char) return bad();
    if (!hooks.practice) return { ok: false, error: { kind: 'unavailable' } };
    const r = hooks.practice([char], { source: { view: 'detail', char } });
    if (r && r.ok === false) return plain(r);
    return { ok: true, opened: r && typeof r.opened === 'string' ? r.opened : null };
  },
  // 「做成图片」：网页页面里 hooks.image 同一个去处（图片预览弹层）
  'detail.image': (args, ctx) => {
    const char = str(args.char);
    const store = storeOf(ctx);
    if (!char || !store) return bad();
    if (!hooks.image) return { ok: false, error: { kind: 'unavailable' } };
    const model = detailModel(store.getState(), char, { today: localDay(ctx.now()), hasInk: record => hasInkPoints(inkOf(store, record)) });
    hooks.image({ char, cardKey: model.cardKey, record: model.imageRecord || model.latest });
    return { ok: true };
  },
});
