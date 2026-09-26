# 第八稿底层交接（F8/E8 r2）

这是已限定签收的独立字体、导出模块与工程核查材料。关联 [#176](https://github.com/Eim-aa/shizi-app/issues/176)。文件只放在交接目录；应用页面、SW、原生资源同步和存储均未接入。

## 交付内容

- [module/](module/)：选字适配器、末次明确判断取墨、1080×1440 / 1080×1080 离屏导出、可选字体加载适配器。
- [fonts/](fonts/README.md)：ShiziKai 400、ShiziSerifSC 400/500，精确字重加载 helper、两份完整 OFL、锁定来源、旧语料与重建入口。
- [接口说明](docs/api.md)：输入、缺失处理、>80 待定返回和工厂注入。
- [历史核查与未实施方案](docs/status.md)：首页墨迹行、回放字段缺口、新笔迹与存储的状态。
- [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json)：移入文件的原 SHA 与当前 SHA。[ARCHIVE-MANIFEST.json](ARCHIVE-MANIFEST.json) 只做本交接目录存档，不能作为 App 复制列表。

五个模块及字体/helper 的执行代码保持冻结字节。测试改用相对路径，结果写标准输出，不依赖私人 checkout，也不重写历史证据。测试中的 r1 布局是明确标记的历史夹具，用于检查 r2 在 0–80 字两比例下没有意外几何变化。

## 验证命令

在仓库根目录执行（Node 22+；Python 3.10+）：

```sh
node handoff/r8-foundation/tests/verify.mjs
node handoff/r8-foundation/tests/r2-contract.mjs
node handoff/r8-foundation/tests/fonts.mjs
python3 handoff/r8-foundation/tests/package.py
```

这些测试验证选择/布局、依赖注入、字体描述符拒绝条件、文件字节和打包白名单。Canvas2D/Path2D 与 FontFaceSet 使用观察桩，不能据此宣称真实浏览器像素、worker、Pencil 或真机手感通过。

字体重建入口另有 2026-09-27 独立离线实测：Python 3.12.14 与固定依赖，在新的输出目录生成六份字体，SHA 与本包及原交付全部相同；源文件未变、交付二进制未替换。此次只验证缓存读取和旧语料重建，未运行下载分支或 `--diagnose`，也不增加视觉/设备验收，详见[字体说明](fonts/README.md)。

## 已有验收及边界

原始基线为 `c7c8fc2ffbc80241802f1f1743e845dfc8e2160c`，不声明它是线上版本。历史验收包括作者 Node 34/34、r2 契约 14/14、独立工程核心 198 项、独立桌面 Canvas 18 项；独立 r2 运行包 8/8、GPOS 6/6、工程接口 12/12。各组有重叠，不相加为独立场景总数。本包移植后的命令不再执行旧候选函数摘取测试，不能冒充完整历史验收重跑。

用户报告 Chrome 153 的字体 helper 补测 7/7；这是用户确认，未取得逐项原始日志，也不是本次执行。Safari/WKWebView、真机和新笔迹管线尚未验收。人工夹具不是用户笔迹；包中没有真人备份、照片或回放数据。

`legacy-brush.mjs` 是旧候选的静态笔锋依赖，含当时的速度宽度、起收笔、飞白和洇墨。它**没有实现**第八稿的新滤波、插值、实时宽度公式或压力替代规则，也不能直接当作 [#165](https://github.com/Eim-aa/shizi-app/pull/165) 的新管线。本 session 已确定按第八稿实现新的速度本体宽和起收笔，沿用飞白/洇墨；有真实压力时用压力替代速度因子，两者不叠乘。这一最新授权优先于历史 [#169](https://github.com/Eim-aa/shizi-app/issues/169) 的删除原则；仅真机阈值确认和新管线实施暂缓，表现方向无需重新拍板。版本关系见 [#177](https://github.com/Eim-aa/shizi-app/pull/177)。

字体仍按旧 7,314 字语料构建；本次主干基线 `06e141b` 的 7,294 字及 [#175](https://github.com/Eim-aa/shizi-app/pull/175) 的 340 内容修订不随本次归档自动获得字体/页面验收。实际接入前复核新增文字、拼音、字号、排版和目标设备。完整上游字体、虚拟环境、原型和过程截图不提交，也不进入运行包。
