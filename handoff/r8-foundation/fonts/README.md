# F8 字体运行资产与重建

三份改名静态字体：ShiziKai 400、ShiziSerifSC 400/500。TTF/WOFF2、CSS/helper 和 coverage 的字节来自 F8 r2；只更新版权说明内的本包来源索引路径。完整 [LXGW OFL](licenses/LXGW-WenKai-GB-OFL.txt)、[Noto OFL](licenses/Noto-Serif-SC-OFL.txt)、[版权及改名说明](licenses/COPYRIGHT-NOTICES.md) 随任一配置复制。

## 复制运行子集

`RUNTIME-MANIFEST.json` 唯一决定可复制文件。默认 `woff2-web` 是 3 WOFF2 + CSS/helper + coverage + 3 许可文件，共 9 项；`ttf-native` 为 3 TTF + 3 许可文件，共 6 项，调用方自行加载。两者互斥，精确字节见清单。

```sh
python3 handoff/r8-foundation/fonts/scripts/pack-runtime.py --output /tmp/shizi-fonts-web
python3 handoff/r8-foundation/fonts/scripts/pack-runtime.py --profile ttf-native --output /tmp/shizi-fonts-native
```

输出目录必须不存在。脚本先验证全部源字节，再逐项复制；拒绝存档清单、目录扫描和损坏输入。不要把整个交接目录放进 App。当前没有应用加载或构建接线。

## 旧语料重建

[下载锁](provenance/download-lock.json) 记录官方固定 URL、完整文件字节和 SHA。源码改名/子集/静态化脚本在 scripts，所需 Unicode 输入在 corpus。没有把完整上游字体提交到 Git。

用 Python 3.12+ 建立独立环境并安装 [固定依赖](requirements.txt) 后：

```sh
python3 handoff/r8-foundation/fonts/scripts/reproduce.py --output /tmp/shizi-f8-rebuild
# 需要额外重跑 GPOS 归因时：
python3 handoff/r8-foundation/fonts/scripts/reproduce.py --output /tmp/shizi-f8-gpos --diagnose
```

脚本在新的输出目录下载并核验上游，复制旧 Unicode 输入与构建脚本，构建字体后比较交付字体 SHA；不覆盖本包。可用 `--source-cache` 指定已有上游下载根以离线复核（仍核验 SHA）。

2026-09-27 独立复核实际运行了该入口：Python 3.12.14、全部固定依赖匹配，使用本地锁定缓存、全新输出目录，10.025 秒完成，退出码 0。六份重建 TTF/WOFF2 的 SHA 同时匹配本包与原交付；输入及源文件 SHA 未变，交付字体未被替换。没有访问下载分支，也未运行 `--diagnose`。这只证明该环境下重建工具可复现旧语料字体，不增加新语料覆盖、组合调号视觉、Safari/WKWebView 或真机通过结论。

## 加载与已知边界

`inspectText` / `requireFont` 查 coverage、归一化 NFC、拒绝剩余组合符，再要求 exact family/weight/normal/loaded；不得把 400 的回退命中当 500 已载入。按返回的 NFC 文本绘制，异常含 family/weight/file。CSS/helper 不会从本目录自动接入页面。

字体按旧候选 7,314 字语料构建，楷体 7,669 请求字符全部覆盖；宋体请求 925 字符，923 直接映射，独立 U+0302/U+0308 缺失。当前主干及 #175 的内容改动需接入前增量复核；不以旧语料覆盖代替新 UI 验收。

历史实际 1,221 拼音音节检查通过的范围不等于任意组合符可用：补充 `ê̌` 双调号叠放不通过，`m̌` 的宋体位置有偏差。详见 [GPOS 归因](reports/gpos-diagnosis-r2.md)：源 mark 的 48 个注音母字均未进入子集，规则被清理；恢复空特性不能修复拉丁拼音锚点。没有因此改字体二进制。Safari/WKWebView 与真机仍需验证。
