# Noto Serif SC：GPOS `mark` 为何消失

版本：F8-2026-09-26-r2。结论：本次锁定宋体语料没有源 `mark` 的任何注音母字，fontTools 因而删除空定位 lookup 与特性。没有发现本次语料所需的母字＋标记定位映射被误删，**不修改字体二进制，不添加空表或新语料**。

## 输入与可复现证据

- 官方完整源：`upstream/NotoSerifSC-wght.ttf`，版本 2.003-H1，SHA-256 `050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9`；下载来源锁定在 `provenance/download-lock.json`。
- fontTools **4.66.0**，沿用构建脚本的选项（`layout_features=['*']`、`layout_scripts=['*']`、layout closure 开启）。构建与本诊断共用 `scripts/font_options.py`，没有为诊断悄改选项。
- `scripts/diagnose-gpos.py` 在内存生成完整静态 400/500，逐段观察“源变量字体→子集→静态实例”的实际构建顺序；另跑“完整静态实例→子集”作为归因对照。未覆盖实际交付的 TTF/WOFF2。
- `gpos-diagnosis-r2.json` 保存全部逐 glyph 的 cmap/Unicode script、lookup coverage、各阶段 feature/script 引用、静态实例指纹、fontTools 关键函数源文及安装源码 SHA。静态实例未入运行包或归档；可由锁定源重建。

## 实际 `mark` 规则覆盖什么

源 GPOS 的 11 个 `mark` feature records 均引用 lookup **0、1**，类型都是 **4 / MarkBasePos**。同一 lookup 被多个 script/language 引用，不表示它对所有拉丁字形都有锚点。

| 源 GPOS lookup | 源母字 glyph 数 | 子集保留／移除母字 | 源标记 glyph 数 | 子集保留／移除标记 |
|---|---:|---:|---:|---:|
| 0 | 48 | 0 / 48 | 1 | 0 / 1 |
| 1 | 43 | 0 / 43 | 5 | 3 / 2 |

两行母字有重叠，**去重共 48 glyph，不是 91 个字符**：47 个有直接 cmap 的注音字母（Unicode script=`Bopo`），另 1 个 `glyph01434` 没有直接 cmap。已查证后者是 GSUB lookup 3 的 `hist` 替换 `uni3127 → glyph01434`；lookup 12 的 `vert/vrt2` 将它换回 `uni3127`。没有把无 cmap 的 glyph 伪算作第 48 个 Unicode 码点。

- lookup 0 的标记是 **U+0307**，本次未请求、closure 也未带入。
- lookup 1 的标记是 **U+02EA、U+02EB、U+0300、U+0301、U+030C**；后 3 个保留为 glyph，前 2 个未纳入。
- 去重 6 个标记中保留 3、删除 3。保留的 grave/acute/caron 都是 Unicode `Zinh`（Inherited）；删除的 2EA/2EB 是 `Bopo`、0307 是 `Zinh`。
- 这两个 lookup 的源 BaseCoverage **没有拉丁母字，也没有 `ecircumflex`（ê）**。保留 caron 本身不会生成一个源字体原本没有的 ê＋caron 锚点。

## 哪一步删除，以及 scripts 是否被误删

1. **完整源→完整静态 400/500：`mark` 仍在。** 静态化不是消失原因。
2. `_prune_pre_subset` 没按标签删除 `mark`。全部 layout features/scripts 被请求；观察此阶段仍有 11 个 `mark` records。
3. 在 GSUB closure 之后，GPOS 使用 `glyphs_gsubed` 裁剪。`MarkBasePos.subset_glyphs`（锁定源码第 825 行起）先裁 MarkCoverage，再计算 BaseCoverage 与保留 glyph 的交集。两 lookup 的母字交集都为 **0**；`if not base_indices: return False`。独立调用同一个 fontTools 方法复核，两 subtable 均返回 False。
4. `Lookup.subset_glyphs` 去掉返回 False 的 subtable；`LookupList.subset_glyphs` 只保留非空 lookup；GPOS `subset_lookups` 同步移除空 feature 并重写 script/language 引用。因此 `mark` 从 **11 个 records → 0**，不留下无效引用。
5. GPOS 全部特性 records 从 **90 → 57 → 7**（源／glyph 裁剪后／post-prune 后）；最后一步还合并重复 feature，并删除与 default 完全相同的显式 ZHS language records。GPOS 的 **DFLT、cyrl、grek、hani、kana、latn 六个 script tags 全部仍在，移除 script 数为 0**。`latn` 标签存在本身不是拉丁锚点覆盖证明。
6. 实际“先子集后静态化”生成的 **GPOS、GSUB、GDEF** 三表在 400/500 上分别与交付 TTF 编译内容逐字节相同。静态优先对照得到相同 coverage 裁剪结论；不是报告只看了最终 feature 名称。

所有计数与函数来源见 JSON，脚本运行时有断言；引用行号只对应被记录 SHA 的 fontTools 4.66.0 源码。

## GPOS `vert` 与 GSUB `vert/vrt2` 分开看

源 **GPOS `vert`** 引用 lookup 2、3：lookup 2 的 SinglePos 三个 coverage 分别有 8、5、1 个 glyph，本次各保留 0；lookup 3 同样是注音 MarkBasePos（43 bases 全删，5 marks 留3），也因此删除。GPOS `vert` 消失有独立的 coverage 原因。

**GSUB `vert/vrt2`** 是字形替换。子集仍保留两特性；本次诊断记录了 source/subset feature 引用，并核对交付 GSUB 字节。不能把缺少 GPOS `vert` 说成缺少 GSUB 竖排替换，也不把该结构检查升级成新浏览器竖排验收。

## `ê̌` 仍受限制

本轮只做有界 HarfBuzz 探针：400/500、NFC/NFD、完整静态源/交付子集、`mark` 开/关。全部得到 `ecircumflex`＋`uni030C`；caron 的 advance/offset 为 0，开启源 `mark` 也没有改变。400 的 ê advance=547，500=554（scale 1000）。这与源 BaseCoverage 不含 ê 一致，不能通过保留空 `mark` 来修复。

这项数值比较**不是视觉通过**。旧桌面样张已记载宋体 caron 偏右、文楷双音标相撞；此处仍保留限制。实际 1221 个音节不含该样例；r1 helper 对 NFC 后残余 combining marks 的拒绝规则原样保留。没有扩充任意组合符或修改上游字形。

## 重跑（独立输出目录，不覆盖交付）

```sh
python3 handoff/r8-foundation/fonts/scripts/reproduce.py --output /tmp/r8-font-rebuild --diagnose
```

此发布副本的入口先在新目录下载、核验和重建，再写该输出目录的 `reports/gpos-diagnosis-r2.json`。使用已有完整下载时加 `--source-cache`，可不联网；不修改交付字体或历史证据。Safari/WKWebView 未测；Chrome 153 helper 7/7 是用户实测确认，见[交接入口](../../README.md)，不是此脚本或本执行者重跑的证据。
