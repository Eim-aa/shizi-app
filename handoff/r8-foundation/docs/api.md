# 独立导出接口

## 选择与取墨

`sessionSelection(roundStats, cards)` 保留传入成员与顺序；`monthSelection({month, activity, reviews, cards})` 保留旧候选月报选择规则。它们不是当前主干的全新权威统计，也不读取应用状态。

`resolveGlyphs({selection, scope, judgments, coverage})` 只为已选项目选择墨迹来源。`scope` 为 `{kind:'session',sessionId}` 或 `{kind:'month',month:'YYYY-MM'}`。只有调用者能够证明该范围判断流完整时才能传 `coverage:'complete'`；默认 unknown 返回浅色参考及理由，不能拿 recentInk 缓存冒充完整历史。

每个判断须有 `{id,char,sessionId,localDay,at,sequence,explicit:true,judgment:'correct'|'wrong',ink}`。先选范围内最后明确判断，再检查墨迹，最后一次缺墨就回退，绝不向前挑旧墨。时间与 sequence 都相同则返回歧义；缺身份和非法日期明确返回缺口。

墨迹格式：

```js
{attemptId, coordinateSpace:'normalized-0-1',
 strokes:[[{x,y,w?,v?}, /* ... */], /* ... */]}
```

attemptId 必须匹配判断 id，x/y 在 0–1。w/v 是旧静态重绘来源，不是 t/p；不补造时间、压力或真人轨迹。展示角标 `displayTag` / `displayDate` 与 `judgmentDate` 分开，未传角标就不画，不自行决定日期分组。

## 排版与绘制

`sheetLayout(n, ratio='portrait')`、`renderSheet({items,ratio,signature,referencePaths,sealImage,canvasFactory,...})` 支持 portrait 1080×1440 与 square 1080×1080，72px 内边距。列数 5–10，选择满足空间约束的最小列数。

- 0 字：`status:'empty'`，不生成画布。
- 1–80 字：生成布局；render 返回 `status:'ready'`、canvas、逐格来源及范围元数据。
- 合法 n>80：`status:'pending'`、`reason:'OVER_80_POLICY_PENDING'`，保留 n/ratio；render 返回 `canvas:null,cells:[]`。不读字项、不创建画布、不截前 80 字、不要求字体/落款资源。
- 非法数量或比例仍报错。落款必须单行且放得下，不偷偷截断。

主画布和参考字包围框测量均用注入 `canvasFactory`。主画布缺 2D 报 `CANVAS_UNAVAILABLE`，探针缺 2D 报 `REFERENCE_CANVAS_UNAVAILABLE`。失败不缓存，已有路径对象测量缓存保留。默认工厂用 document；旧本人笔锋分支仍有 document/navigator 依赖，不能宣称整个模块已支持无 DOM worker。

referencePaths 由调用者提供已获许可的矢量路径。本交接未新增笔画字库或复制其测试样本；现有字体许可不替代笔画数据许可。`assets/zi-seal-sheet.svg` 为原项目样章。`font-adapter.mjs` 可选，实际调用要显式提供资产/coverage URL；导入模块不会主动加载字体。
