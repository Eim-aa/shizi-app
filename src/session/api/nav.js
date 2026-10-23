// App API · 导航（B3.2，计划 §3.3 段 1：网页路由仍是真相源）。原生页里发起的导航一律经这些 op 交给网页路由执行——
// 入口规则（D62 来源矩形、D70 例外、S4 撤销交接）都还是 JS 那一份；目标页若是原生宿主条目，宿主挂载时回发 open，NativeStage 播转场。
// 路由由调用方注入（ctx.nav = ui/router.js 的 nav；会话层不导入 UI）。
//   nav.push {screen, params?}         推入
//   nav.replace {screen, params?, animate?}  就地换掉顶层页
//   nav.back {via?}                    返回一层；via:'native' = 原生已自己播完退场（网页不再播，root.js nativeMoves）
//   nav.tab {name}                     切 tab
//   nav.setParams {patch}              合并顶层页的 params（页内临时状态，冷启动可恢复）

function need(ctx) {
  if (!ctx.nav) throw new Error('no router');
  return ctx.nav;
}

const str = v => (typeof v === 'string' && v ? v : null);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const OPS = Object.freeze({
  'nav.push': (args, ctx) => {
    const screen = str(args.screen);
    if (!screen) return { ok: false, error: { kind: 'invalid' } };
    need(ctx).push(screen, obj(args.params));
    return { ok: true };
  },
  'nav.replace': (args, ctx) => {
    const screen = str(args.screen);
    if (!screen) return { ok: false, error: { kind: 'invalid' } };
    need(ctx).replace(screen, obj(args.params), { animate: args.animate === true });
    return { ok: true };
  },
  'nav.back': (args, ctx) => ({ ok: need(ctx).back({ cause: args.via === 'native' ? 'native' : 'ui' }) !== false }),
  'nav.tab': (args, ctx) => {
    const name = str(args.name);
    if (!name) return { ok: false, error: { kind: 'invalid' } };
    need(ctx).switchTab(name);
    return { ok: true };
  },
  'nav.setParams': (args, ctx) => {
    need(ctx).setParams(obj(args.patch));
    return { ok: true };
  },
});
