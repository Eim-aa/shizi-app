# 第十稿原型 · 演示数据模型 proto-model 与笔迹管线 ink.js

文件别名（下文按别名 + 行号引用）：

| 别名 | 实际路径 | 原名（据 `bundler_ext_resources.txt` 与文件头注释） |
| --- | --- | --- |
| `proto-model` | `docs/design/v10/extracted/proto-model-第十稿交接版.js` | proto-model-第十稿交接版.js |
| `ink.js` | `docs/design/v10/extracted/ink-第十稿交接版.js` | ink-第十稿交接版.js |
| `录制模式` | `docs/design/v10/extracted/录制模式-第十稿交接版.dc.html` | 录制模式-第十稿交接版.dc.html |
| `主页面` | `docs/design/v10/extracted/拾字-可点原型-第十稿交接版.template.html`（单行转义文本，只能按函数名 / 预设名引用） | 拾字-可点原型-第十稿交接版.dc.html |
| `交接备注` | `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/docs/design/v10/交接备注-第十稿交接版.md` | — |
| `decisions` | `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/docs/handoff/decisions.md` | — |
| `handoff` | `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/docs/product/04-v10-handoff.md` | — |
| `改动清单` | `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/docs/design/v10/第十稿-改动清单-第十稿交接版.md` | — |

本报告只读不改。所有数字都用 Node 直接跑 `proto-model` / `ink.js` 核对过（两个文件都不依赖 DOM，可在 Node 里 `require`）。

## 1. 概览

`proto-model` 是第十稿可点原型的演示数据层：一个 IIFE 把 `window.SZProto`（出题数据、演示记录、七种用户状态的构造器、K15/K16 清单计算、300 字演示生成、单键 localStorage 存取、9 月 1 日备份夹具）和 `window.SZRec`（录制工具的 IndexedDB 存储）挂到全局（`proto-model:145,149`）。它明确声明"不接真实算法、不读生产存储"（`proto-model:1`），存储键 `shizi-proto-v9`、VERSION 4，版本不符即整体重置演示（`proto-model:4,137`）。`ink.js` 是笔迹管线：把 `{x,y,t}` 原始采样变成 `{x,y,w}` 带宽度的点列（1€ 滤波 → Catmull-Rom → 按时间平滑的速度→宽度映射 → 起笔 / 收笔 / 点画倍数），另有演示合成、写错样本变形、SVG 轮廓、真人笔迹登记与回放（`ink.js:79`）。`录制模式` 是原型专用的采集工具，定义了真人笔迹记录的实际格式（`录制模式:112-121`），而它引用的格式文档 `data/handwriting/格式-第十稿交接版.md` 在仓库和快照里都不存在。与 v10 决定对照：K15（写错过）在 `lists()` 里已按 D23 精确实现；K16（快忘了）是"90 天以上没写、最多 12 个"的模拟，正式按记忆曲线；D09 的点画规则在当前 `ink.js` 已是"乘本体宽"，但点画只在抬笔后判定、且跳过起笔收笔；D10 的压力分支在 `ink.js` 里完全没有（`build` 只读 x/y/t，`fromRecord` 丢掉 p）；收笔阈值 0.25 / 0.9 pt/ms 和 BASE 11.5pt 仍是"等真机"的起始值。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 常量 KEY / VERSION / TODAY | `proto-model:4` | 存储键 `'shizi-proto-v9'`、版本 4、演示"今天" `'9-24'`（2026 年） | `SZProto.KEY/VERSION/TODAY` | — | 应重写 | VERSION 4 = 走查 V05 清掉补记痕迹（`bk`、`backfilled`）后强制重置一次；`改动清单:21` 写的是"VERSION 1 → 2"，代码已到 4 |
| FB / SAMPLES | `proto-model:7-47` | 37 个样本字的出题数据：拼音、词语、挖空位、释义、部件分组 | `SZProto.SAMPLES`、`item(c)`（`:52`）、`canPractice(c)`（`:53`）、`pyOf(c)`（`:54`） | — | 应重写（字库定稿） | 性…斯 17 字拼音释义是"原型示意"（`:6`）；`groups:FB` + `fb:1` 表示没有部件分组，提示退回"前 1 笔 → 前 2 笔 → 看答案"；第十稿加 馨、鼎、瓷、慨、茂、桥、碑（`:39-46`）。`decisions` 待定表：演示 groups 不是全库资源 |
| PYX / XS | `proto-model:49-50` | 270 个补充字的拼音（多音字取第一个），只给拼音排序和题面 | `SZProto.PYX` | — | 应重写 | 实际 279 个字，`extra300` 只取 270；这些字"没有词语和释义" |
| QUEUES | `proto-model:56` | 三条出题队列：`first` 部主性体次（5 字，K26 / D17）、`ord` 数感警部户主虽（7 字，= 9-24 那一天）、`again` 静题慢亦额 | `SZProto.QUEUES` | — | 测试夹具 | `ord` 就是"今天这组"，见 §3.2 末 |
| SPRING / DAYS | `proto-model:59-70` | 演示记录源：11 天 × [字, 判断] 元组；`v`：R 写对 / W 写错 / S 跳过 / A 看过答案；元组第 3 项空着（原补记标记，K27 删）、第 4 项 = 看过答案 | `SZProto.DAYS` | — | 测试夹具 | K14 的春天三字 3-28（茂桥）、4-18（碑茂）让快忘了能选出 3 个（`:58`）；当前没有任何元组带第 4 项 |
| CUSTOM | `proto-model:71` | 自选的字 11 个：豕鲜额亦俄斯既您慢馨鼎 | `SZProto.CUSTOM` → 状态 `added` | — | 测试夹具 | 馨、鼎没有任何记录 = "自选了还没写"（Node 核对：0 条） |
| USER_STATES | `proto-model:72-75` | 7 种演示用户状态及标签 | `SZProto.USER_STATES` | — | 仅原型 | first / noToday / today / ordHalf / pickHalf / bothHalf / firstHalf |
| seed(days) | `proto-model:77-79` | 把 DAYS 变成 `records`（R/W）与 `events`（S/A）两个数组 | `SZProto.seed` | doy 无 | 可抽取改造（测试） | id 用模块级计数 `'d'+n`；`i` 是该字在当天元组里的序号（含 S/A，所以记录的 `i` 不连续） |
| session(s,kind,queue,src) | `proto-model:80` | 新建练习会话对象，`s.serial` 自增得 id `'s'+n` | `SZProto.session` | — | 可抽取改造 | 字段见 §3.3；`主页面` 调用 11 处 |
| 日期助手 ML/CUM/doy/toD/ago | `proto-model:82-85` | `'m-d'` ↔ 一年第几天；`ago(d,today)` 天数差 | `SZProto.doy/toD/ago` | — | 应重写 | 只有 2026、2 月 28 天、不跨年（`:81`） |
| lists(records,today) | `proto-model:86-90` | K15 写错过 + K16 快忘了 | `SZProto.lists` → `{latest,wrong,forget,forgetAll}` | doy/ago | 可抽取改造 | K15 部分可直接沿用逻辑；K16 的 90 天 / 12 个是模拟。详见 §3.10、§4 |
| extra300(base30) | `proto-model:91-98` | 生成另外 270 字的复习记录（LCG 伪随机，种子 17 / 7） | `SZProto.extra300` → `{EX,NR,IV,records}` | doy/toD | 测试数据生成器 | 首次 2-10 … 9-20；间隔 IV=[3,8,20,45,90,180] + 30% 抖动；每次 20% 不再复习；最后把 EX 顺序里前 3 个"≥2 条且最后一条在 9 月"的字末条改成 W（蟹@9-5、蕴@9-6、捧@9-18） |
| demo300() | `proto-model:99-101` | 300 字演示 = DAYS 去掉 SPRING（46 条）+ extra300（798 条）= 844 条，按 (doy, i) 排序 | `SZProto.demo300` | seed/extra300 | 测试数据生成器 | 和 `改动清单:21`"844 条记录和画布逐条相同"一致；`added` = CUSTOM + 瓷；**不含** 春天三字 |
| build(us,opt) / build0 | `proto-model:102-123` | 按用户状态构造整份演示状态；`opt.big` 走 demo300；`opt.ink` 打 10.12 笔迹缺失标记 | `SZProto.build` | seed/session/demo300 | 测试夹具 | 状态形状见 §3.1；ink 标记：静@9-22 `none`、感@9-24 `none`、体@9-22 `shape`（`:105`） |
| enc / dec / pack / unpack | `proto-model:125-129` | 笔迹 `[[{x,y,w}]]` ↔ `"x,y,w;x,y,w|..."`（1 位小数）；`pack/unpack` 用 JSON replacer/reviver 对**任何**键名为 `strokes` 的数组 / 字符串做转换 | `SZProto.enc/dec` | — | 可抽取改造 | 坑见 §5.1 |
| probe / load / save | `proto-model:131-140` | 单键 localStorage；`load()` → `{blocked}` / `{state:null}` / `{state:null,reset:msg}` / `{state}` | `SZProto.load/save` | pack/unpack | 应重写 | probe 写 `shizi-proto-v9-probe` 再删；版本不符或解析失败 → 重置并给提示句（`:137-138`） |
| restoreData() | `proto-model:142-144` | "9 月 1 日备份"夹具 = DAYS 里 `m*100+d ≤ 901` 的记录 | `SZProto.restoreData` | seed | 测试夹具 | 26 条记录 / 2 条事件，天：3-28、4-18、8-12、8-20、8-28、9-1（**含 SPRING**） |
| SZRec | `proto-model:147-159` | 录制存储：IndexedDB `shizi-proto-v9-rec` v1，对象仓 `recs`（keyPath `key`）、`writers`（keyPath `id`）；不可用退到 localStorage 同名键 | `SZRec.open/tx/all/put/setWriter/clear` | indexedDB / localStorage | 仅原型工具 | 重置演示、清空记录都不动它（`:147`）；坑见 §5.4 |
| BASE | `ink.js:4` | 本体宽基准 11.5pt（345×345 书写格空间） | `SZInk.BASE` | — | 等真机 | `交接备注:66` 列为真机检查项 |
| oneEuro(minc,beta,dc) | `ink.js:5-6` | 1€ 滤波器闭包；`α(fc,dt)=1/(1+1/(2π·fc)/dt)` | 内部 | — | 可直接复用 | `build` 里 x、y 各一个，参数 minCutoff 1 Hz、β 0.02、dCutoff 1 Hz，时间用秒（`:17-18`）；这些参数文字规格没写 |
| cr(p) | `ink.js:8-11` | Catmull-Rom（均匀，τ=0.5），首尾点重复，每段步数 `max(1, ceil(段长/3))` ≈ 3pt 一点；t 线性插值 | 内部 | — | 可直接复用 | `交接备注:110`"Catmull-Rom 3pt" |
| build(raw,final,base,tune) | `ink.js:15-38` | 主管线，输出 `[{x,y,w}]` 并挂 `v30/dot/single/endK` | `SZInk.build` | oneEuro/cr | 可直接复用（等真机阈值；补 D10 压力分支） | 逐步算法见 §3.7 |
| synth(pts,base) | `ink.js:40-44` | 演示：给中线合成时间戳再走 build（起笔 .2 → 中段 .6 → 抬笔前 15pt .5 pt/ms；点画全程 .2） | `SZInk.synth` | resample/build | 可直接复用（样例 / 测试） | 自带一套 `len<24` 点画判定 |
| resample(raw,step) | `ink.js:46-49` | 固定间隔线性重采样，HZ120 = 8.33ms | `SZInk.resample` | — | 可直接复用（测试） | 模拟 120Hz 输入 |
| atSpeed(pts,v,base,step) | `ink.js:51` | 匀速轨迹（笔迹规格样例用） | `SZInk.atSpeed` | resample/build | 可直接复用（测试） | — |
| wrongFix(st,W,cc) | `ink.js:53-54` | 写错样本：按 `W.drop` 删笔、`W.tilt{from,to,a,dx,dy}` 绕格心旋转平移 | `SZInk.wrongFix` | — | 不进产品 | 演示"写错"外观 |
| outline(pts,floor) | `ink.js:56-60` | 把 `{x,y,w}` 点列变成 SVG path：左右偏移折线 + 首尾圆帽；`floor` = 345 空间最小笔宽 | `SZInk.outline` | — | 可抽取改造 | 生产渲染是 Canvas2D（`交接备注:110`），只借"floor"概念 |
| REC / SOURCES / register / pick | `ink.js:65-69` | 真人笔迹内存登记表（按 char 分组）；`register` 后 `api.rev++` 并广播 `window` 事件 `'szink'` | `SZInk.register/pick/rev/sources` | — | 可抽取改造 | `SOURCES=[]`：没有任何数据文件接入（`:67,81`） |
| spts / fromRecord(rec,base) | `ink.js:72-73` | 每笔支持旧写法（点数组）和 `{end,points}`；`end==='cancel'` 的笔按未抬笔（不收尖）处理；**只取 x/y/t，丢掉 p** | `SZInk.fromRecord` | build | 可抽取改造 | D10 无法用真人记录验证，见 §4 |
| play(rec,h) | `ink.js:75-78` | 按原时间戳用 rAF 回放，调 `h.down/move/up/cancel/end`；点对象带 `p` | `SZInk.play` | performance/rAF | 可抽取改造（D14 限制） | 回放点 `t = t0 + q.t`（performance.now 基准） |
| 录制模式 plan(extra) | `录制模式:89-95` | 任务表：SAMPLES 每字 3 遍 + 附加（静 4–12 遍、写错样本 9 条、描写警前 9 笔） | 内部 | `SZProto.SAMPLES` | 仅原型工具 | 现 37 字 × 3 = 111 条（附加 +19 = 130），但界面文案仍写"30 个字各 3 遍"（`:152`），见 §5.6 |
| 录制模式 采集 pt/down/move/up/cancel | `录制模式:111-117` | 坐标换算到 345、t 从本条首次落笔起算、pen 压力 p、合并事件、setPointerCapture | 内部 | — | 录制格式可直接复用 | 详见 §3.6 |
| 录制模式 save / exportW / copy | `录制模式:118-130` | 写 `SZRec.put`；导出 `writer-<id>.json`（分享 → 下载 → 复制 → 选中全文） | `props.onSaved(rec)` | SZRec | 仅原型工具 | 导出时删掉 `key`、`task` 两个字段（`:124`） |
| 录制模式 grid | `录制模式:132-137` | 345×345 SVG：十字线、描红参考（hanzi-writer-data 前 N 笔）、实时笔迹（`SZInk.build` + `outline`） | 内部 | `SZInk`、CDN `hanzi-writer-data@2.0` | 仅原型工具 | 参考字形变换：`PAD=.06`，1024 单位 → 345（`:83-84`） |

## 3. 数据契约

### 3.1 演示存储 `localStorage['shizi-proto-v9']`（VERSION 4）

`build0` 生成的根对象（`proto-model:108`），经 `pack` 存储：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | 4 | 不等于 `VERSION` 即整体重置（`:137`） |
| `userState` | `'first'|'noToday'|'today'|'ordHalf'|'pickHalf'|'bothHalf'|'firstHalf'` | 演示状态名；`big` 模式强制 `'today'`（`:109`） |
| `serial` | number | 会话 / 记录 / 事件 id 计数器（`主页面` 用 `'r'+(++a.serial)`、`'e'+(++a.serial)`；`session()` 用 `'s'+`） |
| `introSeen` | boolean | 默认 true（介绍页已按 D17 去掉，字段残留）；first 状态为 false、firstHalf 为 true（`:110`） |
| `view` | `{name, slot?, from?, m?, c?}` | 当前页面；默认 `{name:'home'}` |
| `A` / `B` | session \| null | A = 普通 / 首次练习槽，B = 这次选的字槽（D05 会话隔离） |
| `added` | string[] | 自选的字（D21）；默认 `[...CUSTOM]`，first 为 `[]`，big 为 CUSTOM+瓷 |
| `lastBackup` | `'m-d'` \| null | 上次导出日期；默认 `'9-1'`，first 为 null；`主页面` 导出后设 `'9-24'`、恢复后设 `'9-1'` |
| `library` | string | `'规范常用字'` |
| `diffs` | `{sid, v}[]` | 结果页"这组字难不难"反馈（D6，待工程确认）；`主页面 setDiff` 写入 |
| `records` | Record[] | 有效判断（R/W），见 §3.2 |
| `events` | Event[] | 跳过 / 看过答案，见 §3.2 |
| `big` | true（可选） | 300 字模式 |
| `inkDemo` | true（可选） | 10.12 笔迹缺失样例开着 |
| `tool` | object | `主页面` 把场景面板设置（含 `debug.lo/hi/base`）也塞进同一键（`boot`） |
| `bkLast` / `expSig` | string / any | `主页面` 写：备份页结论句（D24）、导出签名 |

### 3.2 记录 Record 与事件 Event

**种子记录**（`seed`，`proto-model:78`）：`{id:'d'+n, c, d:'m-d', v:'R'|'W', i, help:''|'answer'}`。
**300 字附加记录**（`demo300`，`:100`）：`{id:'x'+n, c, d, v:'R'|'W', i:10+k, help:''}`。
**firstHalf 预置记录**（`:121`）：`{id:'f'+i, c, d:TODAY, v:'R', i, help:'', sid}`。
**主页面实时判断记录**（`主页面`，写字页 commit 分支）：

```js
{id:'r'+(++a.serial), c:o.c, d:SZProto.TODAY, v: o.verdict==='right'?'R':'W',
 i:this.dayIdx(a), help: o.saw?'answer' : o.hints?'hint' : '', sid:s.id, strokes:o.strokes}
```

字段汇总：

| 字段 | 值 | 备注 |
| --- | --- | --- |
| `id` | `'d'+n` / `'x'+n` / `'f'+i` / `'r'+n` | 前缀区分来源；`lists()` 不用 id |
| `c` | 单个汉字 | — |
| `d` | `'m-d'` 无年 | 只能用 `doy` 比较 |
| `v` | `'R'` 写对 / `'W'` 写错（记录）；`'S'` 跳过 / `'A'` 看过答案（事件） | 只有 R/W 是 K15 的"有效记录"（`:86`） |
| `i` | 当天序号 | 同一天排序 / 平局用 |
| `help` | `''` / `'answer'` / `'hint'` | proto-model 只知道 `''`/`'answer'`（`:78`）；`'hint'` 只在 `主页面` 出现——契约未写全 |
| `sid` | 会话 id | 种子记录没有；实时记录、ordHalf 的两条跳过事件（`:115`）有 |
| `strokes` | `[[{x,y,w}]]` \| null \| 缺省 | 实时记录带 345 空间的 `{x,y,w}` 点（字库墨墙屏注释"原型里实时写下的记录带 strokes（345 空间的 {x,y,w} 点）"）；演示助手 `done/F10/F11` 写 `strokes:null` |
| `ink` | `'none'` / `'shape'` / 缺省 | 10.12（I03 / D14）：`none` = 有记录没留笔迹；`shape` = 只有形状、没有 t/p（`:104-105`）。`主页面` 图片逻辑按 `ink!=='none'` 过滤 |

**事件**（S/A）形状同上但没有 `strokes`；`主页面` 看答案时 `events.push({id:'e'+n, c, d, v:'A', i, sid})` 并在 `session.items` 里加 `{c, v:'A', at:s.i}`（`at` = 当时的字序）。跳过在 `session.items` 里是 `{c, v:'S'}`（演示助手 `done`），只有 ordHalf 预设同时写了 `events`。

**"今天这组"**：就是 DAYS 里 `TODAY='9-24'` 那一行 `数R 感R 警W 部R 户S 主R 虽R`（`:69`）= `QUEUES.ord`（`:56`）。非 today 状态 `build0` 把这一行过滤掉（`:108` `DAYS.filter(d=>d[0]!==TODAY)`），today 状态才 `seed(DAYS)` 全部（`:111`）。`交接备注:99`："演示里今天这组暂时避开了「越来越」「慢慢」这两个词"。

### 3.3 会话 Session（`proto-model:80`）

`{id:'s'+n, kind:'ord'|'first'|'pick', src, queue:[c…], i:0, phase:'recall', hints:0, used:0, saw:false, strokes:[], sim:0|'part', line:null|'record'|'saw'|'changed', lastRid:null, items:[{c, v, rid?, at?}], done:false, diff:null}`；firstHalf 额外 `remind:'ask'`（`:122`）；`主页面` 还会加 `lastC`、`demoSheet`、`demoFail`。`src` 是字符串 `'home'` 或 `{name:list, from:{name:'library'}}`（`主页面 F11`，用来"写完回到写错过 / 快忘了"）。`items[].rid` 指向 `records[].id`——D06/D19"更正同一记录"就靠它。

### 3.4 笔迹压缩编码（`proto-model:125-129`）

- `enc`: `[[{x,y,w}]] → "x,y,w;x,y,w|x,y,w"`，每个值 `Math.round(v*10)/10`；空笔 `""`。
- `dec`: 反向；`""` → `[]`。
- `pack(state)`: `JSON.stringify(state, replacer)`，replacer 对**键名为 `strokes` 且是数组**的任何值调 `enc`（不限于记录）。
- `unpack(raw)`: reviver 对键名为 `strokes` 且是字符串的值调 `dec`。

### 3.5 录制存储 `SZRec`（`proto-model:147-159`）

- IndexedDB：名 `'shizi-proto-v9-rec'`，版本 1；`recs`（keyPath `'key'`）、`writers`（keyPath `'id'`）。
- 退路：`localStorage['shizi-proto-v9-rec']` = `{"writers":{id:{id,extra}}, "recs":[rec…]}`；`put` 按 `key` 去重后整份重写。
- `writers[id] = {id:'01', extra:boolean}`（`录制模式:108`）。
- `all()` → `{writers:{id→writer}, recs:[]}`；`clear()` 清两仓并删 localStorage 键。

### 3.6 录制记录格式（`录制模式:112-121`，即 `data/handwriting` 格式的唯一代码定义）

```
rec = {
  key: wid + ':' + task.id,        // 存储主键，导出时删
  task: task.id,                   // 'n-静-1' | 'w-题-2' | 't-警-1'，导出时删
  writer: wid,                     // [0-9A-Za-z_-]{1,12}（:150）
  char, pass,                      // 汉字、第几遍
  kind?: 'wrong' | 'trace',        // 普通任务不写 kind（:120）
  input: 'pen' | 'touch' | 'mouse',// 本条第一次落笔的 pointerType（:113）
  canvas: { size: Math.round(格子 CSS 宽 px), dpr: devicePixelRatio },
  clock: 'event.timeStamp',
  ua: navigator.userAgent,
  strokes: [ { end:'up'|'cancel', points:[ {x, y, t, p?} … ] } … ]
}
```

- `x, y`：`(client − rect) × 345 / rect.width`，1 位小数（`:112`）。
- `t`：`e.timeStamp − t0`，1 位小数 ms；`t0` 只在"还没有任何笔、也没有进行中的笔"时设置（`:113`），所以撤销到零笔 / 清空后再落笔会重新从 0 计。
- `p`：仅 `pointerType==='pen'` 且 `pressure>0` 时记，3 位小数（`:112`）。
- move 用 `getCoalescedEvents()`（`:115`）；up 时若位置和最后一点不同再补一点（`:116`）；`pointercancel` → `end:'cancel'`（`:117`）。
- 导出文件 `writer-<wid>.json` = 记录数组（`:124-125`）。
- `ink.js:63` 的注释写的是旧形状 `strokes:[[{x,y,t,p?}]]`，`spts()` 两种都兼容（`ink.js:72`）。

### 3.7 `SZInk.build(raw, final, base, tune)` 算法（`ink.js:15-38`）

单位：坐标 pt（345×345 格），时间 ms；输出 `[{x,y,w}]`，附 `v30`、`dot`、`single`、`endK`。

1. 参数：`base` 缺省 `BASE=11.5`；`tune.lo/hi` 缺省 LO=0.25、HI=0.9 pt/ms（`:15`）。空输入返回 `[]`。
2. **零时间差合并**（`:16`）：与前一点 `t` 相同的采样替换前一点（留最后的位置），得到 `m`。
3. **1€ 滤波**（`:17-18`）：x、y 各一个 `oneEuro(1, .02, 1)`，时间 `t/1000` 秒。第一点原样返回；`dt≤0` 返回上一次滤波值。
4. **抬笔锁尾**（`:19`）：`final` 且多于 1 点时，最后一个滤波点强制等于原始最后一点。
5. **Catmull-Rom**（`:20`，`cr` `:8-11`）：约 3pt 一点；累计弧长 `L[i]`，总长 `len`。
6. **单点**（`:22`）：`m.length===1` 或 `len===0` → 一个点 `w = base × 0.9`，标 `dot=true, single=true, endK=.9, v30=null`。无论 `final` 与否都立即输出（Node 核对：`w=10.35`）。
7. **点画判定**（`:23`）：`dot = final && len < 24`。**只在抬笔后判定**。
8. **抬笔前 30ms 平均速度 v30**（`:25-28`，仅 `final`）：用合并后的原始点 `m`（不用滤波点）；从末点往回累加距离直到 `m[i-1].t < tl−30`；若窗口跨过采样点（`i>0`）则按 `u=(b.t−t0)/(b.t−a.t)` 插值补上那一段并令 `dt=30`；若整笔短于 30ms（`i===0`）则 `dt = tl − m[0].t`（整段时长，D09）。`v30 = d/dt`。Node 核对：40pt/10ms → `v30=4`。
9. **收笔系数**（`:29`）：`vv = v30 ?? 0.5`（未抬笔时用 0.5）；`k = clamp((vv−LO)/(HI−LO), 0, 1)`；`endMin = 0.9 + (0.12−0.9)·k`（k=0 → 0.9，k=1 → 0.12）；`tap = min(28, len×0.3)` 收尖长度。
10. **逐点宽度**（`:30-37`），初值 `w = base`：
    - 本体宽：`dt = p[i].t − p[i−1].t`；`dt>0` 时 `v = 段长/dt`，`tgt = base × (1.06 − 0.12·min(v, 1.5))`，`w += (tgt − w) × (1 − e^(−dt/35))`。
    - 点画分支（`:34`）：`u = s/len`；`fct = u<.5 ? 0.7→1.1 : 1.1→0.9`（线性）；输出 `w×fct`，**跳过起笔和收笔**。
    - 起笔（`:35`）：`s<6: 0.85+0.23·(s/6)`（0.85→1.08）；`s<12: 1.08−0.08·((s−6)/6)`（1.08→1.0）；其后 1。
    - 收笔（`:36`）：`final && k>0 && len−s < tap` 时 `fct ×= endMin + (1−endMin)·((len−s)/tap)`，即末段从 1 线性收到 `endMin`。k=0（v30 ≤ 0.25）**完全不收尖**。
11. 标记（`:38`）：`out.v30, out.dot, out.single=false, out.endK = 末点 w / base`。

Node 实测（200pt 直线，120Hz）：v=0.1 → 末端 12.05（无收尖，endK 1.048）；v=0.25 → endK 1.02（k=0，无收尖）；v=0.5 → endK 0.60；v=0.9 及以上 → endK ≈ 0.11。10pt 短划 v=0.2：抬笔前按普通起笔 9.78→11.59，抬笔后变成点画 8.05→12.90→10.54（形状在抬笔瞬间改变，见 §5.7）。

### 3.8 演示合成 `synth`（`ink.js:40-44`）

中线 `pts` 总长 `len<24` → 点画，全程 0.2 pt/ms；否则 `s<12` 时 0.2→0.6，中段 0.6，抬笔前 15pt 0.5；`t += max(1, ds/v)`；`resample(raw, 8.33ms)` 后 `build(final=true)`。实测 `v30=0.5, endK≈0.60`。

### 3.9 `lists()` 输出（`proto-model:86-90`）

- `latest[c]`：该字最近一条 **R/W** 记录（日期晚者胜，同日 `i` 大者胜，`>=`）。
- `wrong`：`latest.v==='W'` 的记录，按 (日期, i) 从新到旧。
- `forget`：`latest.v==='R'` 且 `ago(d) > 90` 的记录，按从旧到新，取前 12；`forgetAll` 为总数。
- 两张清单天然不重叠（同一 `latest` 记录不能同时 W 和 R）。

Node 实测：today 状态 `wrong = 警@9-24 整@9-22 题@9-22 豕@9-22 额@9-14`（5 个），`forget = 桥@3-28 碑@4-18 茂@4-18`（3/3）；noToday 少了警；300 字状态 `wrong` 8 个（加 捧 蕴 蟹），`forget` 12/115。`ago('6-26')=90` 不入选，`'6-25'=91` 入选。

### 3.10 `item(c)` 形状（`proto-model:52`）

`{c, py, word:[…], blank, gloss?, groups:[[笔画序号]…], fb?:1}`；不在 SAMPLES 的字 → `{c, py:PYX[c]||'', word:[], blank:0, gloss:'', groups:FB, fb:1}`。`word=[]` 时题面走"拼音 + 释义"（`:6`）。

## 4. 与第十稿（v10）决定的关系

| 决定 | 本范围里的对应 | 状态 |
| --- | --- | --- |
| D17 / K26 第一次练习 5 个字、去介绍页 | `QUEUES.first` 5 字（`:56`）；`introSeen` 默认 true（`:108`） | 一致；`introSeen` 是残留字段 |
| D18 / K25 看答案直接记"看过答案"，不再判断 | `seed` 把 `'A'` 放进 `events`（`:78`）；`主页面` 看答案 push `v:'A'` 事件并 `s.saw=true` | 一致。但 `主页面` 判断分支仍有 `help: o.saw?'answer'…` 写在 R/W 记录上，D18 后理论上不可达（§6） |
| D19（覆盖 D06）修改同一记录 | `session.lastRid` / `items[].rid`（`:80,121`）；`主页面` 结果页 `sheet={rid}` | 一致（入口位置不在本范围） |
| D20 写完直接进结果页 | `session.done/phase='done'`（`主页面 done`） | 不冲突 |
| D21 自选的字要明确"加入" | `added` 列表；馨、鼎"自选了还没写"没有记录（`:39,71`） | 一致 |
| D22 结束这组：已判断保留、没写的不算记录也不算跳过 | 数据上只有 R/W 进 `records`，S 只在明确跳过时进 `events`/`items` | 不冲突（ordHalf 预设把前两个字按跳过记是"写到一半"夹具，`:113` 注明"见异议"） |
| D23 / K15 写错过只看最近一次有效记录；跳过、看过答案不算 | `lists()` 只取 R/W（`:87`） | **完全一致** |
| K16 快忘了正式按记忆曲线 | `ago>90`、`slice(0,12)`（`:89-90`）；`交接备注:88`、`改动清单:56` 都标"原型模拟" | 原型模拟，正式要换算法 |
| D24 去补记；撤销在备份页一直有效；状态句按记录和上次导出算 | VERSION 4 清掉 `bk`/`backfilled`（`:4`，`改动清单:126`）；`lastBackup`、`bkLast` 结论句在 `主页面` | 一致；但 `主页面` 恢复后把 `lastBackup` 设成备份日期 `'9-1'` 而非"上次导出时间"（§6） |
| D14 / I03 / 10.12 历史缺 t/p 如实报告 | 记录字段 `ink:'none'|'shape'`（`:104-105`）；`fromRecord` 只用有 t 的记录 | 一致；`shape` 这一版不画（K23） |
| D11 图片取本次最后判断笔迹、缺墨用浅参考 | `主页面` `imgItems` 按 `ink!=='none'` 过滤 | 不冲突（图片逻辑不在本范围） |
| D05 A/B 会话隔离 | `A`、`B` 两个槽（`:108`），kind `ord/first` 走 A、`pick` 走 B | 一致 |
| D07 保存成功才推进 | `save()` 返回布尔（`:140`）；`主页面 commit` 失败不推进 | 一致 |
| D15 历史记录兼容不是硬约束 | 版本不符直接重置（`:137`） | 演示可以；生产不能"悄悄清空" |
| K03 必测：300 字 → 用 9-1 备份替换 → 撤销，记录数不变 | `restoreData()` 固定返回 26 条 30 字夹具（`:144`），与 300 字状态无关；撤销靠 `主页面` 的 `prev` 深拷贝 | 原型未复现问题（`handoff` 五）；实现时备份内容必须来自真实导出 |

### 4.1 笔迹管线 vs D09 / D10 / `交接备注` §八.1

**§八.1 文字规格逐项对照 `ink.js`：**

| 规格项 | ink.js | 一致？ |
| --- | --- | --- |
| 起笔 0.85× → 1.08× → 1.0× | `:35`，0–6–12pt | 一致 |
| 收笔看抬笔前 30ms 速度，阈值 0.25 / 0.9 pt/ms | `:25-29` | 一致（阈值等真机） |
| 30ms 窗口插值到恰好 30ms、分子分母同一段 | `:26-27` | 一致 |
| 点画 <24pt，0.7 → 1.1 → 0.9 | `:23,34` | 一致，但只在抬笔后判定 |
| 1€ + Catmull-Rom 3pt | `:17-20` | 一致（1€ 参数规格未写） |
| 宽度按时间平滑 α = 1 − e^(−Δt/35ms) | `:32` | 一致 |
| 本体宽 = BASE × (1.06 − 0.12·min(v,1.5))，各倍数乘在它上面 | `:32`；起笔 / 收笔 / 点画都是 `w×fct` | 一致 |
| 飞白、洇墨、Pencil 压感、减少动态效果照现有实现 | ink.js 里没有 | 不在本文件 |
| §八.2 固化缓存、合并事件、预测墨头 | ink.js 无状态；合并事件在 `录制模式:115` 和 ShiziWriteScreen | 前两项原型做了，预测墨头没做 |

**D09**（点画倍数乘本体宽；短于 30ms 用整段时长；单点直径 0.9×本体宽；零时间差点合并不参与速度计算；"参考 JS 的点画分支是原型差异"）：

- 乘本体宽：当前 `:34` 是 `w*fct`，`:14` 注释注明这是"第九稿第一批修订"改的——即 D09 所说的差异很可能是第八稿"点画不乘本体宽"的旧写法，**当前文件已经符合文字规格**。
- 仍与文字规格不同 / 文字规格没说清的三点：(a) 点画分支**跳过起笔和收笔**（`continue`），文字规格把"点画 0.7×"写在起笔一项里，二者可以读成一致，但需确认点画是否还要收尖；(b) `dot` 只在 `final` 时为真，书写中按普通起笔画、抬笔瞬间换成点画轮廓（§3.7 实测）；(c) `synth()` 有自己的点画判定（`:41`）。
- 短于 30ms 用整段：`:27` 一致。单点：`base×0.9`（`:22`），单点没有速度，"本体宽"= base，一致。零时间差合并：`:16` 在滤波和速度之前做，一致。

**D10**（有真实压力时压力替代速度本体因子，不叠乘）：`build` 的输入映射只取 `{x,y,t}`（`:16`），`fromRecord` 也只取 `{x,y,t}`（`:73`），`play` 虽然把 `p` 传给 handler（`:77`）但 ShiziWriteScreen 直接把点喂回 `build`，所以**整条管线没有压力路径**。`录制模式:112` 已经采集 `p`（仅 pen）。实现 D10 要在 `:32` 的 `tgt` 处加分支：有 `p` 时 `tgt = base × g(p)`，替换 `(1.06 − 0.12·min(v,1.5))`，起笔 / 收笔 / 点画倍数照乘。`g(p)` 没有任何来源（§6）。

### 4.2 哪些"等真机阈值"、哪些"已定"

| 等真机（`交接备注:66`、§八.3、`decisions` 待定表"新笔迹管线、延迟/60–120 Hz/Pencil 阈值"） | 已定（文字规格 §八.1 + D09） |
| --- | --- |
| 收笔阈值 LO 0.25 / HI 0.9 pt/ms（`ink.js:15` 缺省；`主页面` 调试面板 `tune{lo,hi,base}` 可调） | 起笔 0.85→1.08→1.0（0/6/12pt） |
| BASE 11.5pt 在 6.1 寸屏合不合适、两画的字会不会单薄 | 点画 <24pt，0.7→1.1→0.9，乘本体宽 |
| 墨头延迟（对比备忘录）、60Hz / 120Hz 手感、15 笔以后会不会卡 | 单点直径 0.9×本体宽 |
| Pencil 压感（D10 留真机验收） | 零时间差合并；短于 30ms 用整段时长；30ms 窗口插值 |
| 要不要画预测墨头 | 1€ + Catmull-Rom 3pt；宽度平滑 τ=35ms；本体宽公式 |
| （非笔迹）深色对照投影线、十字线加重 | 飞白 / 洇墨 / 减少动态效果沿现有实现 |

文字规格没写、只存在于 JS 的细节（工程接入前要确认算不算规格）：1€ 参数 (1 Hz, 0.02, 1 Hz)；收尖长度 `tap = min(28pt, 30%·len)`；`endMin` 从 0.9 线性到 0.12；书写中默认 `vv=0.5`；抬笔锁尾到原始末点；Catmull-Rom τ=0.5；轮廓圆帽。

## 5. 风险与坑

1. **`pack` 的 replacer 按键名匹配**（`proto-model:128`）：任何叫 `strokes` 的数组都会被 `enc`，而 `enc` 假定元素是 `[{x,y,w}]`。`session.strokes`（`:80`）和 `items[].strokes`（`主页面` S/A 项 `strokes:it.strokes||null`）若被塞进别的形状（如写字页的 `{pts,d,end}`），会被编码成 `"undefined,undefined,undefined"` 再解码成 NaN。
2. **存储配额**：单键 localStorage；300 字状态 844 条，若每条都带实时笔迹（每笔约 100 点 × 10 字节 × 10 笔 ≈ 10KB），总量会超 5MB。`probe()` 只测能不能写（`:132`），不测配额；`save()` 失败只返回 false，`主页面` 进入"存储阻断"态。
3. **版本不符即清空**（`:137`）：演示可接受；生产实现绝不能沿用（D15 说兼容不是硬约束，但要求"关联必须正确"，不是丢数据）。
4. **`SZRec.open()` 没有 `onblocked`**（`:151`）：IndexedDB 升级被其他标签页阻塞时 promise 永不 resolve，录制模式 `refresh()` 卡住无提示；`_p` 缓存首次结果，一次失败整页都走 localStorage 退路；退路每次 `put` 整份重写。
5. **`ua` 进导出文件**（`录制模式:119`）：真人写字人的 UA 字符串随 `writer-<id>.json` 一起外发，与"只存在这台设备"的说明（`:24`）并不矛盾但要留意隐私。
6. **录制任务数与文案不符**：`plan()` 用 `Object.keys(SAMPLES)` = 37 字（`录制模式:90`），普通任务 111 条，界面 `planText` 仍写"30 个字各 3 遍"（`:152`），注释也写"30 字 × 3 遍"（`:89`）。
7. **点画只在抬笔后判定**（`ink.js:23`）：短划书写中用普通起笔轮廓、抬笔瞬间切换到 0.7→1.1→0.9，宽度峰值从 ~11.6 跳到 ~12.9（§3.7 实测）。真机上是否可见需验证；若不可接受要在书写中提前预判。
8. **速度 ≤ 0.25 pt/ms 完全不收尖**（`:36` `k>0`）：慢写的"一"末端平齐 + 圆帽；这是设计意图（"慢写一"是真机检查项 `交接备注:121`），但 endMin=0.9 的取值在 k=0 时实际不生效。
9. **`build` 每次 move 全量重算**（ShiziWriteScreen `pMove` 每次 `SZInk.build(this.raw…)`）：1€ 每次重新实例化，O(n) 每帧、O(n²) 每笔；长笔画 + 120Hz 时是 §八.3"第 15 笔以后会不会卡"的候选原因之一。
10. **`outline` 用相邻点差分作法线**（`:57`）：折笔处左右折线自交，靠 `fillRule:'nonzero'` 盖住；生产 Canvas2D 渲染器不应照抄。
11. **日期没有年份**（`proto-model:81-85`）：`ago()`、`lists()` 跨年即错；2 月按 28 天。
12. **`restoreData` 含 SPRING**（`:144` 过滤条件 `≤ 9-1` 把 3-28、4-18 也算进去）：9 月 1 日备份夹具有 26 条、含茂桥碑；但 `demo300` 反而不含 SPRING（`:99`），两种状态下"快忘了"的来源不同。
13. **`build(us,{ink:true})` 在 noToday 状态静默失效一半**：感@9-24 不存在（TODAY 行被过滤），`mk` 找不到就跳过（`:105`）；`主页面 INK12` 复制了同一逻辑，切换开关时把 first/firstHalf 强制成 today 才有效。
14. **`help` 取值不一致**：proto-model 只定义 `''`/`'answer'`（`:78`），`主页面` 还写 `'hint'`；`seed` 的第 4 元组项 `hp` 会给 R/W 记录打 `help:'answer'`，与 D18（看过答案不再判断）冲突，目前没有数据用到它。
15. **`lists()` 同日平局用 `i`**：`extra300` 的 `i=10+k` 与种子记录 `i` 不在同一尺度，同一天同一字出现两条时顺序不可靠（目前不会发生）。
16. **录制的 `t0` 重置规则**（`录制模式:113`）：撤销到零笔或清空后重新计时，同一条记录内不会出问题；`暂停` 会丢掉未保存的笔（`:161`）。
17. **`fromRecord` 把 `end:'cancel'` 当未抬笔**（`ink.js:73`）：不收尖、不判点画，回放和缩略图与实时一致；但 `play()` 里 cancel 的笔会调 `h.cancel`（`:77`），若 handler 没实现就退到 `h.up()`，两条路径外观不同。
18. **`SOURCES=[]`**（`ink.js:67`）：没有任何真人数据随原型交付；`data/handwriting/格式-第十稿交接版.md` 在仓库（`grep` 全仓）和 scratchpad 都找不到，只在 `交接备注:16,137`、`ink.js:64`、`录制模式:24` 被引用。
19. **hanzi-writer-data 走 CDN**（`录制模式:86`）：描红任务离线不可用；许可（Arphic）见 `交接备注:127`。
20. **`extra300` 注释与代码小偏差**：注释"9 月 19 日"（`:91`），代码首次日最大 doy 264 = 9-21（实测 9-20）；`IV` 含 180（`:93`）但注释只列到 90，实测最多 6 条 / 字，180 从未触发。

## 6. 未解问题

1. D09 说"参考 JS 的点画分支是原型差异"——差异具体指什么？当前 `ink.js:34` 已乘本体宽；若指"点画不做起笔 / 收笔"或"只在抬笔后判定"，文字规格没有明说。
2. D10 的压力→本体宽映射 `g(p)` 没有任何来源（文字规格、决定表、JS 都没有），只知道"替代速度因子、不叠乘"。
3. `主页面` 判断分支的 `help: o.saw?'answer'` 在 D18 后是否还可达（看答案后是否还能进判断页），要看 ShiziWriteScreen（不在本范围）。
4. `session.remind:'ask'`（`proto-model:122`）的含义（首次练习后询问提醒？）只在 firstHalf 出现，`主页面` 引用 27 处，本范围内无法确定。
5. 恢复备份后 `lastBackup='9-1'`（`主页面 restore`）是否符合 D24"按上次导出时间"——备份日期 ≠ 导出时间。
6. 1€ 参数 (1, 0.02, 1)、`tap=min(28, 0.3·len)`、`endMin` 0.9→0.12、书写中默认 `vv=0.5` 是规格还是原型取值？
7. 真人录制数据是否已经采集（`交接备注:137` 说"数据到位后把文件名填进 SOURCES"），以及 `格式-第十稿交接版.md` 在设计项目里的内容是否与 `录制模式:119` 一致。
8. `canvas.size` 记录的是 CSS 像素宽（`录制模式:113,119`），紧凑版 258pt 格（W15）录出来的坐标仍归一到 345，但 BASE 是否要按格宽缩放（`ink.js:55` 的 floor 公式暗示会），生产里谁负责换算未定。
9. 生产的逐判断笔迹存储另案暂停（D14、`decisions` 待定表），`record.strokes` 的 `{x,y,w}` 压缩格式（丢 t/p）是否作为正式格式，无从判断。
10. `diffs` / `session.diff`（D6"这组字难不难"）待工程确认是否保留；数据字段已在状态里。
