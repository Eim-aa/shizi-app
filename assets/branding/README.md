# 拾字应用图标

2026-09-28 定稿：**纸色底，墨色楷体“拾”，提手旁用暖墨红。** “拾”是用手把东西捡起来，颜色落在“手”上。取代 2026-09-25 的 A 方案（朱红底、米白圆头字）。

配色取自 App 的设计令牌：纸 `#F4F0E7`、墨 `#2B2622`、暖墨红 `#A6533F`；深色“灯下的纸” `#221E1A`、墨 `#DCCFB8`、暖墨红 `#D47A5D`。

## 字形来源

“拾”的轮廓取自 App 内嵌的楷体 ShiziKai（霞鹜文楷 GB 子集，SIL OFL 1.1），与界面里被练习的字同一种楷体。OFL 允许把字形用于标志图形；图标 SVG 只含轮廓路径，不嵌入字体文件。不使用 hanzi-writer-data（Arphic 字体）的笔画，其分发许可仍待确认。

## 矢量母版

**`assets/branding/` 里的 SVG 是唯一导出母版。** 每个文件都是一个背景矩形加两个路径，不含位图、字体、滤镜、脚本或外部资源：

| 文件 | 用途 |
|---|---|
| `app-icon-source.svg` | 浅色，120px 及以上的 iOS 图标、网页 180 / 192 / 512 |
| `app-icon-source-small.svg` | 浅色加粗版，87px 及以下（桌面小尺寸、设置、Spotlight） |
| `app-icon-dark.svg` | iOS 18 深色外观 |
| `app-icon-tinted.svg` | iOS 18 着色外观（灰度，系统按明暗上色） |
| `app-icon-maskable.svg` | 网页 manifest 的 `maskable`，字在半径 40% 的安全圆内 |

| 元素 ID | 内容 |
|---|---|
| `background` | 背景；系统负责最终外形裁切 |
| `shi-glyph` | 字形分组，统一定位和缩放 |
| `shi-hand` | 提手旁（暖墨红） |
| `shi-he` | 右半“合”，“口”的留白由复合路径保留 |

两个字形路径的描边与填色同色，用来整体加粗；调粗细只改 `stroke-width`（单位是字形单位）。

## 重新导出 PNG

安装项目已有的 Playwright 依赖和浏览器后运行：

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node scripts/generate_app_icons.js
```

也保留原有命令：

```bash
bash scripts/generate_app_icons.sh
```

两种命令执行同一个导出器。优先使用 `CHROME_PATH` 指定的浏览器或本机 macOS Chrome／Chromium；其余环境使用 Playwright 的 Chromium。每个尺寸从对应的 SVG 独立渲染，以目标尺寸的 4 倍超采样后缩小；输出无透明通道的 RGB PNG。输出：

- 根目录 `icon-180.png`、`icon-192.png`、`icon-512.png`（Apple touch icon、网页图标、manifest `any`）和 `icon-512-maskable.png`（manifest `maskable`）。
- `ios/ShiziApp/ShiziApp/Assets.xcassets/AppIcon.appiconset/` 中 40、58、60、80、87、120、180、1024 像素图标，以及 `Icon-1024-dark.png`、`Icon-1024-tinted.png`；导出器按 `Contents.json` 里每一项的尺寸和 `appearances` 选母版。

## 更新注意

根目录图标由 iOS 的 `sync-web-assets.sh` 同步到 Web bundle，原生桌面图标由 asset catalog 提供。深色、着色外观需要 Xcode 16 以上编译，iOS 18 起生效；更早的系统只用浅色。

Web 图标使用稳定路径，替换图像时同步更新 `index.html` 的 `shizi-asset-build` 和 `sw.js` 的 `BUILD`，让新的 service worker 安装一套新的离线资源缓存。此改动不涉及 localStorage 中的用户练习数据。

后续调整请编辑 SVG 后重新运行导出器，不要单独修改各尺寸 PNG。
