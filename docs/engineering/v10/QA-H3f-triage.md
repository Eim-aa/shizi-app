# QA-H3f 逐条分诊（2026-10-28）

基线 `20261028-011318`：annual 124，mine 242。网页参考未重取，阈值未改。

基线分类：annual 空态字形内边距 4 条、XXXL 月行盒累计漂移 68 条是真缺陷；14 条卷尾边框上下边错配、38 条 dark_AX3 转场中取证是工具误报。mine 240 条空墨是真缺陷，2 条 Tab 顶线归属是工具误报。

## mine 最终：18 条，全部工具误报

证据：`ios/ShiziApp/build/native-ui/20261028-012752/parity/report.md`（36 屏）。L / XXXL / AX3 的字帖墨形均 0 差异。

AX5 格子 y=757.3、h=90 跨过内容区底 y=791。工具只按整屏 h=874 判格完整可见，墨掩膜包含网页 Tab 遮挡与原生玻璃 Tab 图标；实际可见的格顶墨与网页一致。原生格内墨视图是内缩框，不能据其仍在整屏内便比较整个网页格。以下 16 条都是同一裁切误判，并非空墨或墨形缺陷。

mine-empty 的 y=791.2 通栏线属于网页 Tab 顶线（D77 / 既有 TAB-01），按最小包围元素错归 version-text，导致既有豁免没有命中。以下 2 条无需新豁免。

### mine-backup-stale_dark_AX5（我的 · 30 天没备份（备份行提示））— 4 条

- [墨格] 墨格：(21, 757.3 90×90)：格里网页有墨（101 点）、原生没有
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(111, 757.3 90×90)：墨形不合（容 1 格 IoU 0.353 < 0.6）；墨的位置偏 (-0.6, 16.8)pt > 4.5；墨的外框 网页 45.3×11.6 原生 82.8×42.7pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(201, 757.3 90×90)：墨形不合（容 1 格 IoU 0.14 < 0.6）；墨的位置偏 (38.8, 16.2)pt > 4.5；墨的外框 网页 5.2×14.2 原生 82.8×33.6pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(291, 757.3 90×90)：墨形不合（容 1 格 IoU 0.253 < 0.6）；墨的位置偏 (0, -20.1)pt > 4.5；墨的外框 网页 45.3×53 原生 45.3×10.4pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

### mine-backup-stale_light_AX5（我的 · 30 天没备份（备份行提示））— 4 条

- [墨格] 墨格：(21, 757.3 90×90)：格里网页有墨（86 点）、原生没有
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(111, 757.3 90×90)：墨形不合（容 1 格 IoU 0.367 < 0.6）；墨的位置偏 (-0.6, 16.2)pt > 4.5；墨的外框 网页 45.3×10.4 原生 82.8×42.7pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(201, 757.3 90×90)：墨形不合（容 1 格 IoU 0.156 < 0.6）；墨的位置偏 (38.8, 16.2)pt > 4.5；墨的外框 网页 5.2×14.2 原生 82.8×33.6pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(291, 757.3 90×90)：墨形不合（容 1 格 IoU 0.248 < 0.6）；墨的位置偏 (0, -20.7)pt > 4.5；墨的外框 网页 45.3×51.8 原生 45.3×10.4pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

### mine-empty_dark_L（我的 · 空（没有记录））— 1 条

- [线] version-text：原生缺少线：网页横线 (0, 791.2) 长 402 宽 0.3 #38322BFF（没对上的长度 402）
  - 判定：Tab 顶线归属误报；理由见上。

### mine-empty_light_L（我的 · 空（没有记录））— 1 条

- [线] version-text：原生缺少线：网页横线 (0, 791.2) 长 402 宽 0.3 #DDD5C7FF（没对上的长度 402）
  - 判定：Tab 顶线归属误报；理由见上。

### mine-records_dark_AX5（我的 · 有记录（概览 + 月字帖块 + 设置行））— 4 条

- [墨格] 墨格：(21, 757.3 90×90)：格里网页有墨（101 点）、原生没有
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(111, 757.3 90×90)：墨形不合（容 1 格 IoU 0.353 < 0.6）；墨的位置偏 (-0.6, 16.8)pt > 4.5；墨的外框 网页 45.3×11.6 原生 82.8×42.7pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(201, 757.3 90×90)：墨形不合（容 1 格 IoU 0.14 < 0.6）；墨的位置偏 (38.8, 16.2)pt > 4.5；墨的外框 网页 5.2×14.2 原生 82.8×33.6pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(291, 757.3 90×90)：墨形不合（容 1 格 IoU 0.253 < 0.6）；墨的位置偏 (0, -20.1)pt > 4.5；墨的外框 网页 45.3×53 原生 45.3×10.4pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

### mine-records_light_AX5（我的 · 有记录（概览 + 月字帖块 + 设置行））— 4 条

- [墨格] 墨格：(21, 757.3 90×90)：格里网页有墨（86 点）、原生没有
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(111, 757.3 90×90)：墨形不合（容 1 格 IoU 0.367 < 0.6）；墨的位置偏 (-0.6, 16.2)pt > 4.5；墨的外框 网页 45.3×10.4 原生 82.8×42.7pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(201, 757.3 90×90)：墨形不合（容 1 格 IoU 0.156 < 0.6）；墨的位置偏 (38.8, 16.2)pt > 4.5；墨的外框 网页 5.2×14.2 原生 82.8×33.6pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。

- [墨格] 墨格：(291, 757.3 90×90)：墨形不合（容 1 格 IoU 0.248 < 0.6）；墨的位置偏 (0, -20.7)pt > 4.5；墨的外框 网页 45.3×51.8 原生 45.3×10.4pt（容 ±0.12 且 > 4pt）
  - 判定：AX5 滚动区裁切 / Tab 遮挡误报；理由见上。


## annual final: 40 tool false positives

Evidence: `ios/ShiziApp/build/native-ui/20261028-133634/parity/report.md` (12 screens); four empty screens from `20261028-012301`, all zero. Past-year and XXXL all zero.

AX3 corresponding border edges differ +2.1pt (web y=1926.4 / 2065.4, native 1928.5 / 2067.5); AX5 edges differ -1.9pt. All within D76. The comparator pairs opposite edges of the same square, producing eight false +/-141pt reports.

annual-report_dark_L root frame x=14.5 and all children have the same translation, while vertical layout matches: capture signals ready during the push transition. Earlier capture of this state was x=0 with zero diffs; baseline dark_AX3 had x=402 and another capture light_L x=200.5, both restored to x=0 on rerun. Screenshot and JSON are taken at different times, creating secondary ink/icon reports. All 32 reports in this state share that capture defect.

### annual-report_dark_AX3（年报 · 一卷（卷首 + 每月 + 卷尾））— 2 条

- [线] annual-twice-first：线位置 网页横线 (131, 1926.9) 长 140 宽 1 #806E5AFF，在屏外（滚动区里） 原生竖向差 141.1pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

- [线] annual-twice-last：线位置 网页横线 (131, 2124.9) 长 140 宽 1 #806E5AFF，在屏外（滚动区里） 原生竖向差 141.1pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

### annual-report_dark_AX5（年报 · 一卷（卷首 + 每月 + 卷尾））— 2 条

- [线] annual-twice-first：线位置 网页横线 (131, 2254.8) 长 140 宽 1 #806E5AFF，在屏外（滚动区里） 原生竖向差 -140.9pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

- [线] annual-twice-last：线位置 网页横线 (131, 2466.8) 长 140 宽 1 #806E5AFF，在屏外（滚动区里） 原生竖向差 -140.9pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

### annual-report_dark_L（年报 · 一卷（卷首 + 每月 + 卷尾））— 32 条

- [位置] annual-screen：位置 网页 (0, 0) 原生 (14.5, 0)，差 (14.5, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] back：位置 网页 (2.3, 62) 原生 (16.7, 62)，差 (14.4, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-adjust：文字位置 网页 (312, 74) 原生 (326.5, 75)，差 (14.5, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-body：位置 网页 (16, 122) 原生 (30.5, 122)，差 (14.5, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-year：文字位置 网页 (16, 118) 原生 (30.5, 118.6)，差 (14.5, 0)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-head：文字位置 网页 (16, 174) 原生 (30.5, 174.8)，差 (14.5, 0)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-first：位置 网页 (16, 222) 原生 (30.5, 222)，差 (14.5, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-first-cell：位置 网页 (16, 222) 原生 (30.5, 222)，差 (14.5, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-first-canvas：位置 网页 (16, 222) 原生 (30.5, 222)，差 (14.5, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-first-label：文字位置 网页 (168, 305) 原生 (182.5, 306.2)，差 (14.5, 0.6)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-first-date：文字位置 网页 (168, 329) 原生 (182.5, 330)，差 (14.5, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-month：文字位置 网页 (16, 382.3) 原生 (30.5, 383.5)，差 (14.5, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-month：文字位置 网页 (16, 509.7) 原生 (30.5, 510.9)，差 (14.5, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-month：文字位置 网页 (16, 772) 原生 (30.5, 773.2)，差 (14.5, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-save：文字位置 网页 (167.3, 802) 原生 (181.5, 803)，差 (14.2, 0.1)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-month：文字位置 网页 (16, 989.3) 原生 (30.5, 990.5)，差 (14.5, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-twice-first：位置 网页 (16, 1297.6) 原生 (30.5, 1297.7)，差 (14.5, 0.1)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-twice-date：文字位置 网页 (64.9, 1446.6) 原生 (79.3, 1447.8)，差 (14.4, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-twice-last：位置 网页 (168, 1297.6) 原生 (182.5, 1297.7)，差 (14.5, 0.1)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] annual-twice-date：文字位置 网页 (211.2, 1446.6) 原生 (225.6, 1447.8)，差 (14.4, 0.5)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] title：文字位置 网页 (154.3, 73) 原生 (168.6, 73.8)，差 (14.3, 0)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [位置] 同字两次：文字位置 网页 (16, 1251.6) 原生 (30.5, 1252.9)，差 (14.5, 0.6)pt（竖向按中线）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [线] annual-first-cell：原生缺少线：网页竖线 (16.5, 222) 长 132 宽 1 #806E5AFF（没对上的长度 132）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [线] annual-twice-first：原生缺少线：网页竖线 (16.5, 1297.6) 长 140 宽 1 #806E5AFF，在屏外（滚动区里）（没对上的长度 140）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [线] annual-first-cell：原生多出线：竖线 (162, 222) 长 132 宽 1 #806E5AFF（网页没有的长度 132）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [线] annual-twice-last：原生多出线：竖线 (322, 1297.7) 长 140 宽 1 #806E5AFF，在屏外（滚动区里）（网页没有的长度 140）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [装饰] back：图标位置 网页 (13.3, 73) 原生 (27.7, 73)，差 (14.4, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [墨格] annual-first-cell：格位置 网页墨格 (16, 222 132×132) 原生墨格 (30.5, 222 132×132)，中心差 (14.5, 0)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [墨格] annual-twice-first：格位置 网页墨格 (16, 1297.6 140×140)，在屏外（滚动区里） 原生墨格 (30.5, 1297.7 140×140)，在屏外（滚动区里），中心差 (14.5, 0.1)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [墨格] annual-twice-last：格位置 网页墨格 (168, 1297.6 140×140)，在屏外（滚动区里） 原生墨格 (182.5, 1297.7 140×140)，在屏外（滚动区里），中心差 (14.5, 0.1)pt
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [墨格] 墨格：(16, 222 132×132)：墨形不合（容 1 格 IoU 0.321 < 0.6）；墨的位置偏 (-15.2, 0.9)pt > 6.6
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

- [装饰] back：图标 (13.3, 73 22×22)：截图里网页看得见、原生看不见（墨点 网页 32 原生 0）
  - Triage: Capture during push transition; uniform root translation and derived pixel diffs.

### annual-report_light_AX3（年报 · 一卷（卷首 + 每月 + 卷尾））— 2 条

- [线] annual-twice-first：线位置 网页横线 (131, 1926.9) 长 140 宽 1 #95826BFF，在屏外（滚动区里） 原生竖向差 141.1pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

- [线] annual-twice-last：线位置 网页横线 (131, 2124.9) 长 140 宽 1 #95826BFF，在屏外（滚动区里） 原生竖向差 141.1pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

### annual-report_light_AX5（年报 · 一卷（卷首 + 每月 + 卷尾））— 2 条

- [线] annual-twice-first：线位置 网页横线 (131, 2254.8) 长 140 宽 1 #95826BFF，在屏外（滚动区里） 原生竖向差 -140.9pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

- [线] annual-twice-last：线位置 网页横线 (131, 2466.8) 长 140 宽 1 #95826BFF，在屏外（滚动区里） 原生竖向差 -140.9pt
  - Triage: Opposite border edges paired; corresponding edges are within 3pt.

## Gates and scope

- Unit: 1664 pass, 0 fail, 1 existing TODO. Refreshed stale generated files; a 150ms performance assertion passed after concurrent build load ended.
- Final Release build passed, with DerivedData at `ios/ShiziApp/build/release-qa-h3f`.
- Flows restricted to MineFlowTests / MineSubFlowTests: first run 18 pass, 2 timeouts, 1 existing reminder skeleton skipped. Group-size tab timeout passed alone in `20261028-012837`; annual-twice seed-ready timeout passed alone in `20261028-133510`. All 20 implemented cases obtained passing results; original failures retained.
- No comparator/reference changes, no new/proposed waivers, no full verify, no push.
- Shared-file exception: mine-page.js adds only the mine ink payload; native-mine.test.mjs asserts complete decoded points equal the web model. index.html, src/build-info.js and sw-manifest.js are build:manifest outputs.
