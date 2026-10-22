// QA-H1 夹具运行时·收尾：逐条执行 setup（见 prologue.js）。op 返回 {ok:false,error} 或抛错 = 这个状态注入失败。
try {
  for (const step of setup) {
    const fn = OPS[step.op];
    if (!fn) return { ok: false, error: 'unknown op ' + step.op };
    // 没有 await 的 op 是同步函数、这里也不 await：钉住时钟的造数据里，每多一次让出事件循环，页面（Preact 的微任务渲染）就可能多读一次时钟，
    // 「N 天后再见」就变了（B2.9b）。需要异步的 op（动态 import 等）才用 async。
    let r = fn(ctx, step);
    if (r && typeof r.then === 'function') r = await r;
    if (r && r.ok === false) return r;
  }
} catch (e) {
  return { ok: false, error: String(e && e.message || e) };
}
if (pinned) unpin();
return { ok: true };
