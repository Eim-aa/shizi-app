# F8 字体来源、版权和改名

仅记录本次选用版本的材料与处理，不作法务批准。

## 霞鹜文楷 GB → ShiziKai

来源：官方 [v1.522 发布页](https://github.com/lxgw/LxgwWenkaiGB/releases/tag/v1.522)，2026-03-17；tag commit `44cb0573002712c7d5c96f1b2aeea4420153f790`。本次下载完整 `LXGWWenKaiGB-Regular.ttf`，name ID 5 为 `Version 1.522; March 17, 2026`。不是 CSS 分片，不包含 Mono、Light 或 Medium 文件。

源字体 name ID 0 与原 OFL 文件保留：

> Copyright 2022-2026 LXGW (https://github.com/lxgw/LxgwWenkaiGB)
> Copyright 2020 The Klee Project Authors (https://github.com/fontworks-fonts/Klee)

完整原文见 `LXGW-WenKai-GB-OFL.txt`，未删改，SHA 见 `../provenance/download-lock.json`。注意：本次 v1.522 OFL 版权段并没有显式列出 Reserved Font Name；它与交接备注“已声明保留名”的文字有版本差异。本次仍严格按任务要求将修改版全面改名 ShiziKai，不借此保留源名称。

## Noto Serif SC → ShiziSerifSC

来源：官方 google/fonts 仓库 `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` 下完整 `ofl/notoserifsc/NotoSerifSC[wght].ttf`。该完整 SC 区域字体含 wght 200–900；不是网页按 Unicode 切片的 font CSS。源 name ID 5 为 `Version 2.003-H1;hotconv 1.1.1;makeotfexe 2.6.0`。METADATA.pb 指向上游 noto-cjk commit `985fa52c81c1d6692ccdd82bc3656e8fb932fd89`。

原 OFL 文件版权行：

> Copyright 2012 Google Inc. All Rights Reserved.

字体二进制 name ID 0 / METADATA.pb 另有：

> (c) 2017-2024 Adobe (http://www.adobe.com/).

两处原文均保留，没有用其中一处替换另一处。完整原文见 `Noto-Serif-SC-OFL.txt`。子集在 wght=400 / 500 完全静态化，并改名 ShiziSerifSC；改名用于区别本项目修改版，不表示上游背书。

## 修改记录与分发材料

- 从锁定实际语料制作子集，保留全部有关 GSUB/GPOS 特性和 layout closure，保留 `.notdef`；输出 TTF 与 WOFF2。
- name IDs 1/2/3/4/6/16/17/18/20/21/22/25 的现有所有语言与平台记录清除后重建实际命名；typographic family 为 ShiziKai 或 ShiziSerifSC。500 的 legacy family 为 ShiziSerifSC Medium / Regular，typographic 为 ShiziSerifSC / Medium。
- 静态化后去掉 fvar 和无用 STAT，不留下 ExtraLight 实例名称。名称表逐条见 `../reports/names.json`，源表见 `../reports/source-fonts.json`。版权、设计者、制造者、许可信息保留原文；这些归属信息中的原名称不属于修改版 family 名称，不应删除。
- 本次修改版字体仍按 SIL OFL 1.1 分发。运行时带任一字体格式时，须一并保留两份完整原 OFL 与本版权声明；不将 work/、官方完整版或审计样张打入 App。
- 参考笔画 hanzi-writer-data 属于其他资产体系；本次不修改、不审查、不替代其许可结论。
