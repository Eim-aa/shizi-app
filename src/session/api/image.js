// App API · 图片（B3.11；计划 B3B4-原生化架构与计划.md §1.3「图片预览 image-preview」行、§3.6「分享图、年报图、月字帖图」）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。
//
//   image.view {scope, ratio?}               → {ok, view}：预览弹层的视图模型（标题 / 说明 / 比例 / 页数 / 「也放进来」/ 长图 / 失败三段式的句子）
//   image.render {scope, ratio, page, mode?} → {ok, image:{dataURL, width, height, name, status}}：页面用**现有函数**画好的图（PNG，base64）
//   image.add {scope, recordId}              → 「也放进来」（写入：commitAdded；D07 失败回 {ok:false, error:{kind}}）
//   image.save {scope, ratio, mode?}         → 保存到相册（页面把导出图交给原生、等原生回包；回 {ok, reason?}）
//
// scope = {kind:'session'|'day'|'month'|'glyph'|'annual', slot?, sessionId?, day?, month?, char?}：
//   原生只说「要生成哪张图」；组任务与画图都在页面，用的是网页弹层同一批函数（buildImageJob / buildAnnualJob / job.renderPage），
//   所以同一组输入出来的图逐字节相同（契约测试 test/ui/native-image.test.mjs）。
// 会话层不导入 UI：网页图片模块加载时经 setImageActions 登记**同一个函数对象**（网页路径 == API 路径，同 home.js 的做法）。
// 图由页面的 canvas 画（B4.6 才改 CoreGraphics）；这里只把 PNG 的字节送回原生。

let actions = null;

/** 网页图片模块登记它的动作（view / render / add / save）；传 null 取消。 */
export function setImageActions(a) {
  actions = a && typeof a === 'object' ? a : null;
}

export function imageActions() {
  return actions;
}

/** 动作回包 → {ok, …}（D07：失败回 {ok:false, error:{kind}}）。 */
function replyOf(r) {
  if (r && r.ok === false) {
    const err = r.error && typeof r.error === 'object' ? r.error : {};
    return { ok: false, error: { kind: String(err.kind || 'generic') } };
  }
  if (!r || typeof r !== 'object') return { ok: false, error: { kind: 'invalid-reply' } };
  return r;
}

/** 调一个动作；动作自己回 {ok:false, error:{kind}} 就原样带回去（不改成 generic）。 */
function act(name, args, ctx) {
  const fn = actions && actions[name];
  if (typeof fn !== 'function') return { ok: false, error: { kind: 'unavailable' } };
  try {
    const r = fn(args || {}, ctx);
    if (r && typeof r.then === 'function') {
      return r.then(replyOf, error => ({ ok: false, error: { kind: 'exception', reason: String((error && error.message) || error) } }));
    }
    return replyOf(r);
  } catch (error) {
    return { ok: false, error: { kind: 'exception', reason: String((error && error.message) || error) } };
  }
}

export const OPS = Object.freeze({
  'image.view': (args, ctx) => act('view', args, ctx),
  'image.persist': (args, ctx) => act('persist', args, ctx),
  'image.spec': (args, ctx) => act('spec', args, ctx),
  'image.render': (args, ctx) => act('render', args, ctx),
  'image.add': (args, ctx) => act('add', args, ctx),
  'image.save': (args, ctx) => act('save', args, ctx),
  'image.closed': args => act('closed', args, null),
});
