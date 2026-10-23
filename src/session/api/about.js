// App API · 关于 + 三个子页（B3.2 试点页）。只读：四个视图 op，返回网页页面渲染用的同一组模型函数（src/session/views/about.js）的结果。
// 原生页的 open 回包也是它（宿主挂载时调 view.<屏名>，原生首帧不等桥）；契约 test/ui/native-about.test.mjs。

import { aboutModel, creditsModel, letterModel, privacyModel } from '../views/about.js';

export const OPS = Object.freeze({
  'view.about': (args, ctx) => ({ ok: true, view: aboutModel(typeof ctx.build === 'function' ? ctx.build() : ctx.build) }),
  'view.about-privacy': (args, ctx) => ({ ok: true, view: privacyModel({ native: ctx.native }) }),
  'view.about-credits': () => ({ ok: true, view: creditsModel() }),
  'view.about-letter': () => ({ ok: true, view: letterModel() }),
});
