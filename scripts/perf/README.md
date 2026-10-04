# 性能与容量（M6-3）

`scripts/e2e/61-perf.spec.js` 是 02 §8「性能」一条的门禁：300 字一年量级数据下的书写帧率、首屏渲染时长、总占用、
页面栈内存。它跟其余 e2e 一样由 `node scripts/e2e/run.mjs` 跑（`pnpm test` → `verify:web` 包含它），每次都会打印一张
数字表（`| 项 | 实测 | 阈值 | 结论 |`），表里每一行都是一条断言。

## 复现

```sh
node scripts/e2e/run.mjs 61-perf          # 只跑这一个 spec（约 45 秒）
```

- 环境：run.mjs 的 Chromium（playwright 1.62 自带或缓存的 headless shell）、393×852、deviceScaleFactor 2、
  本机静态服务（python3 -m http.server）。数字是**这台机器、这个 Chromium** 的，换机器会变；真机（iOS WKWebView）
  数字是 M7 真机检查项，不从这里推断。
- 结尾「参考 CPU 4×」一行用 CDP `Emulation.setCPUThrottlingRate` 把主线程降速 4 倍再量一次，粗略代表中端手机；
  只记录、不断言。

## 数据（spec 里现造，不读外部 fixture）

- 注入：`page.route` 把 `src/config/policy.js` 的 `features.perRecordInk` 改成 `true`（源码不动，同 44-scenario-ink-states），
  所以格子都走 InkMini 真实笔迹路径（P31 仍是过渡关闭）。
- 主种子 `year`：时钟 2026-09-24 20:00；2025-10 至 2026-08 每月 150 条、2026-09 本月 200 条（200 个不同的字），
  300 个字；全部用真实 mutator `judgeInDraft` 按时间先后逐条判断（id 顺序 = 时间顺序），每条带 ink v3
  （8–15 笔，每笔 30–46 个原始点，按 `policy.inkMaxPointsPerStroke` 抽点）；约 15% 写错。
  写入前对草稿跑一次 `store/budget.js` 的 `recover()`——与每次 commit 写前回收是同一函数，真实使用里墨迹是逐次提交时
  被淘汰到 P05 预算内的；不跑的话 1850 条 × 约 3.5KB 一次写不进 5MiB 配额。`sessions.A` = 今天的练习，
  队列「德」（15 画）、「题」。
- 变体 `month300`：本月 300 个不同的字各一条（练习记录 300 格，P89「练习记录不截断」）。

## 量什么、怎么量、阈值从哪来

| 项 | 方法 | 阈值 | 来源 |
|---|---|---|---|
| localStorage 总占用 | 全部键 `(键长 + 值长) × 2`（与 `store/budget.js entryBytes` 同口径，并与 store 的 usage 估算核对）；种子后、两次判断后、300 格变体各量一次；判断后不得残留 `shizi.v2.txn` | < 3.2MiB | 01 §9 / §13（对 5MiB 留 35% 余量） |
| 写字页 15 画帧率 | 鼠标在书写格里画 15 笔（每笔约 40 个 pointermove），期间 `requestAnimationFrame` 连续记帧时间戳，取帧间隔均值；另用 `browser.startTracing` 抓 Chromium trace，统计 `FireAnimationFrame` 与 pointer `EventDispatch` 的主线程耗时 | 平均 ≤ 16.7ms × 1.5 | 02 §8、任务卡 M6-3 |
| 抬笔固化 | ① pointerup 在 window 捕获→冒泡之间的同步处理（固化层追加一笔）；② 仪表化 `store.commit` 量 `write:strokes` 会话写入；③ pointerup → 该次写入完成（含等下一帧的 effect） | 每笔 ≤ 50ms | 任务卡 M6-3 |
| 首屏：墙 / 有记录的字 / 练习记录 200 格、300 格 | nav 动作（`switchTab` / `push`）→ rAF 轮询到「内容格子已渲染、与视口相交的格子里的笔迹 canvas 都已画好（`data-painted`）」→ 再等该帧样式/布局/绘制完成（rAF 里 post 一条 MessageChannel 消息）；各量 3 次取最大 | ≤ 200ms | 01 §13、02 M3-4（35-all 同口径） |
| 页面栈 5 层 JS 堆 | CDP `HeapProfiler.collectGarbage` ×2 后 `Runtime.getHeapUsage`；字库根页 → 有记录的字 → 单字详情 → 写错过清单 → 单字详情 → 练习记录（5 层都保持挂载）；进出 3 轮 | 增长 ≤ 32MiB；退回根页残留 ≤ 4MiB；第 3 轮与第 1 轮残留差 ≤ 2MiB | 工程取值（文档没有给数；02 只要求「可控」），见下 |
| 判断 commit | 同一仪表化；第 1 次含浏览器首次 `new AudioContext()`（按键音），第 2 次是稳态 | 只记录 | — |

堆阈值的取法：增长阈值取 M6-3 修正后实测（约 26MiB，主要是 5 个页面里约 430 个缩略图的回放点列）留约 25% 余量；
残留与逐轮差是泄漏判据（修正前出栈的页面整页留在堆里，残留约 21MiB）。这三个数请架构侧在验收时确认（M6-3 报告已登记）。

## M6-3 找到并修掉的热点

1. **出栈页面整页留在堆里**（残留 8→21MiB，逐轮上涨后才饱和）。两处原因：
   - htm 把不含插值的子树缓存成共享 vnode；模块顶层的 `html\`…\`` 常量同理。Preact 首次挂载直接用这个对象（设父指针），
     重渲染换成副本、原对象既不再出现也不被卸载，于是一直抓着第一次渲染的整棵 vnode 树与 DOM（含 canvas 与点列）。
     修：`vendor/ui.js` 在 h 里置 `this[0] = 3` 关掉 htm 缓存；各处模块级图标常量改成 `() => html\`…\``。
   - `root.js` 转场的 `finish` 闭包抓着出栈图层 DOM，经渲染期闭包里的 `anim` 被 hook 留存。修：结束时断开 `a.cancel`。
   修后基线堆 55→26MiB，残留 ≈0.5MiB，逐轮差 ≈0.1MiB。
2. **练习记录一次画完全部笔迹 canvas**（200 格约 190ms，300 格约 265ms，超 200ms）。修：InkMini 只在离视口一屏以内时
   挂载当帧就画，更远的登记到全页共用的一个 IntersectionObserver，滚到附近再画（隐藏图层同理）。修后 200 格 ≈100ms、
   300 格 ≈110ms，同时少建约 2/3 的 2D context。
3. **回放点列逐点事后加字段**（`catmullRom` 先建 `{x,y,t}` 再加 `w`/`p`，每个点多一个 PropertyArray）。修：一次字面量建齐
   （键序不变）。5 层页面栈堆增长 30→26MiB。

未修（记录）：浏览器 / PWA 下第一次判断里同步 `new AudioContext()`（headless Chromium 实测 30–140ms 不等，之后的判断 5–11ms）。
iOS Safari 要求在用户手势里解锁音频，挪出手势会有不响的风险；原生壳走 `postNative('sound')` 不受影响。真机时长见 M7。

## 冷启动首帧（Q3，`scripts/e2e/68-q3-boot.spec.js`）

```sh
node scripts/e2e/run.mjs 68-q3            # 约 30 秒
```

- 全新 browser context（无 HTTP 缓存 / 内存）+ 存储快照打开 `/?test=1`，装假原生桥（App 路径）；首次安装（空存储）与
  61-perf 的 `seedPerf('year')`（300 字 + 墨迹）各 3 次。读 `src/app.js` 的 `shizi:*` 打点与 FCP，打印分段表。
- 阈值：3 次里最快一次首帧 ≤ 400ms（03 P180；并行负载只会变慢，最快一次最接近固有耗时，中位数一并打印）。
  另断言首屏模块全部在 app.js 求值前发出请求（modulepreload）、原生壳字体在 UI 渲染前开始取、网页不预热字体、html 底色是纸色。
- 模拟器 / 原生分段（进程启动 → WebContent → 页面各段）的量法与数字见 01 §8.8；那部分需要临时原生插桩，不入库。

