# 拾字应用图标

采用 2026-09-25 确认的 A 方案：朱红底、米白定制“拾”字。与原有蓝底字标相比，保留品牌字形识别，调整笔画轮廓与留白，并与简化版界面的温暖配色协调。

## 源图与导出

`app-icon-source.png` 是获确认的 1254×1254 RGB 位图源稿，由 OpenAI 图像生成工具生成并定向修订；没有透明通道，也没有预先裁成圆角。它不是可编辑的字体或矢量路径。各尺寸直接从同一源稿重采样，不重新生成字形。

在 macOS 上运行：

```bash
bash scripts/generate_app_icons.sh
```

输出：

- 根目录 `icon-180.png`、`icon-192.png`、`icon-512.png`，分别供 Apple touch icon、网页图标和 Web manifest 使用。
- `ios/ShiziApp/ShiziApp/Assets.xcassets/AppIcon.appiconset/` 中的 40、58、60、80、87、120、180、1024 像素图标，与现有 `Contents.json` 对应。

图形主体保持在以画布中心为圆心、半径为边长 40% 的安全圆内；根目录 512 图标继续用于 manifest 的 `any` 和 `maskable`。系统负责最终外形裁切。

## 更新注意

根目录图标由 iOS 的 `sync-web-assets.sh` 自动同步到 Web bundle，原生桌面图标由 asset catalog 提供。

Web 图标使用已有稳定路径，因此替换图像时同步更新 `index.html` 的 `shizi-asset-build` 和 `sw.js` 的 `BUILD`，使新的 service worker 安装一套新的离线资源缓存。此改动不涉及 localStorage 中的用户练习数据。

本次是用户选定方案的位图资源接入。后续若精修矢量母版，应保留已确认的字形和视觉方向，并从同一母版统一导出所有尺寸。
