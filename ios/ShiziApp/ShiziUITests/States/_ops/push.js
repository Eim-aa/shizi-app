// 往路由栈推一屏（nav.push）。a: {screen, params}；params 里 "$名字" 取 ctx.vars。
ctx.nav.push(a.screen, ctx.subst(a.params || {}));
