# 拾字应用图标

2026-10-05 定稿（D33）：**纸色底，整字一色墨的楷书“拾”。** “拾”是用手把东西捡起来；朱色只用于批改与印章，所以图标和 App 内的品牌字都只用一种墨色。取代 2026-09-28 的“提手旁暖墨红”方案。

配色取自设计令牌（`docs/design/design-system-v1/tokens.json`）：浅色纸 `#F4EFE6`、墨 `#221D19`；深色“灯下的纸” `#1B1814`、墨 `#E6DAC4`；着色外观是黑底白字的灰度图（系统按明暗上色）。

## 字形来源

“拾”是**拾字自绘的 A1 端正楷书骨架，用三次贝塞尔逐笔精修而成，不取自任何字体文件**（霞鹜文楷、华文楷体、Arphic 等的轮廓都没有用）。九笔各是一条顺时针闭合轮廓，同色、非零填充叠放。这是程序化精修的过渡母版，还不是书家实写（D33 说品牌“拾”由书家书写）；做法、检查图和残留问题见 `docs/design/brand/README.md`。App 内的同一个字由 `src/ui/brand/shi.js` 渲染，字形数据与这里的母版同源（`docs/design/brand/shi-A1.svg`）。

## 矢量母版

**`assets/branding/` 里的 SVG 是唯一导出母版。** 每个文件都是一个背景矩形加一个字形分组（九条同色路径），不含位图、字体、滤镜、脚本或外部资源，也没有描边：

| 文件 | 用途 |
|---|---|
| `app-icon-source.svg` | 浅色，120px 及以上的 iOS 图标、网页 180 / 192 / 512（图标墨重 A1-bold） |
| `app-icon-source-small.svg` | 浅色光学加粗版，87px 及以下（桌面小尺寸、设置、Spotlight；笔画再粗约 15%，字放大 4%） |
| `app-icon-dark.svg` | iOS 18 深色外观 |
| `app-icon-tinted.svg` | iOS 18 着色外观（灰度，系统按明暗上色） |
| `app-icon-maskable.svg` | 网页 manifest 的 `maskable`，整字落在半径 40% 的安全圆内 |

| 元素 ID | 内容 |
|---|---|
| `background` | 背景；系统负责最终外形裁切 |
| `shi-glyph` | 字形分组，统一定位和缩放 |
| `shi-s1` … `shi-s9` | 九笔（笔顺）：横 · 竖钩 · 提 · 撇 · 捺 · 横 · 竖 · 横折 · 横 |

加粗靠单独的墨重版本（`docs/design/brand/shi-A1-bold*.svg`），不靠描边。字的墨框长边约占画布 66%，水平方向取墨框中心与墨迹重心各一半居中，墨迹重心比几何中心高 1.5%。

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

Web 图标使用稳定路径，替换图像后运行 `node scripts/build_shell_manifest.mjs`：它会重算 `index.html` 的 `shizi-asset-build`、`src/build-info.js`、`sw-manifest.js` 和 `scripts/shell-manifest.txt`，让新的 service worker 安装一套新的离线资源缓存（这些是生成文件，不要手改）。此改动不涉及 localStorage 中的用户练习数据。

后续调整请编辑 SVG 后重新运行导出器，不要单独修改各尺寸 PNG。
