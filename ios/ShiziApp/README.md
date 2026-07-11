# 拾字 iOS App 封装

这个目录是第一阶段 iOS 外壳：不重写业务逻辑，用原生 `WKWebView` 把现有 Web/PWA 完整跑进 App。

## 工程入口

- Xcode 工程：`ios/ShiziApp/ShiziApp.xcodeproj`
- Target：`Shizi`
- 普通用户 scheme：`Shizi`
- 开发调试 scheme：`Shizi Dev`

`Shizi` 默认加载普通用户版，不带 `?dev=1`，所以「我的」页不会出现开发工具。`Shizi Dev` 会通过启动参数 `-shizi-dev` 等价加载 `index.html?dev=1`，用于查看题库质检和实验数据。

## 资源打包方式

每次 Xcode Build 都会运行 `scripts/sync-web-assets.sh`，把仓库根目录的这些资源复制进 App 包：

- `index.html`
- `deck-data.js`
- `hanzi-writer.min.js`
- `sw.js`
- `manifest.webmanifest`
- `icon-*.png`
- `data/` 下全部笔画 JSON

App 内部用 `shizi-resource://app/index.html` 加载页面，并通过同一个本地 scheme 读取 `data/*.json`。因此真机离线时也能加载已打包的首页、题库和本地笔画文件。PWA 的 service worker 在原生 App 里不是依赖项；离线能力来自 App bundle。

## 本地构建校验

在仓库根目录运行：

```bash
ios/ShiziApp/scripts/verify-local.sh
```

它会检查 plist、shell 脚本、Xcode 工程、模拟器 Debug 构建、iPhoneOS Release 无签名 archive、archive 元数据、bundle 资源完整性和 iPhone-only 设置。

也可以手动分步运行：

```bash
xcodebuild -list -project ios/ShiziApp/ShiziApp.xcodeproj
xcodebuild -project ios/ShiziApp/ShiziApp.xcodeproj -scheme Shizi -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/ShiziApp/ShiziApp.xcodeproj -scheme Shizi -configuration Release -destination 'generic/platform=iOS' -archivePath work/Shizi.xcarchive CODE_SIGNING_ALLOWED=NO archive
ios/ShiziApp/scripts/verify-archive.sh work/Shizi.xcarchive
```

`CODE_SIGNING_ALLOWED=NO` 只用于本地无证书编译校验。真机运行和 TestFlight 必须使用 Apple Developer Team 正常签名。

构建后可以检查 App 包或 archive 里的离线资源是否完整：

```bash
ios/ShiziApp/scripts/verify-bundle-assets.sh /path/to/Shizi.app
ios/ShiziApp/scripts/verify-bundle-assets.sh /path/to/Shizi.xcarchive
ios/ShiziApp/scripts/verify-archive.sh /path/to/Shizi.xcarchive
```

如果已经有一个 iPhone Simulator 处于 Booted 状态，可以跑 smoke test：

```bash
ios/ShiziApp/scripts/smoke-simulator.sh
```

它会构建模拟器包、安装启动 App、截图、检查 bundle 资源，并确认 WKWebView 的 `localStorage` 已写入 `shizi.*` 键；随后会终止并重启 App，验证 smoke 写入的 `shizi.nativeSmoke.v1` 仍然存在。
同时它会让 WKWebView 在 App 内执行一次原生 smoke 检查：验证基础 `SEED/GROUPS` 是 6854、当前 `CARDS` 不少于基础字库数量、普通模式隐藏开发工具、`localStorage` 可写，并实际 `fetch('data/美.json')`，确认本地笔画 JSON 返回 200 且包含笔画数据。它还会走一遍主要页面、手写事件、加字/备份/恢复和轻量练习流程：进入字盒、我的、手感诊断，开发模式下进入题库质检；确认 viewport safe-area、弹层滚动和键盘留白适配存在；在写字 canvas 合成一段 pointer 轨迹，确认产生笔画与像素、触摸事件被阻止滚动且清屏有效；通过加字面板加入一个自定义字，并确认记忆模型、加字记录和备份 JSON 都包含它；随后故意扰动相关 `localStorage` 键，再应用刚导出的备份，确认加字、记忆和自定义卡能恢复；开始一组、等待「看答案/写好了」可用、揭晓答案、盖「拾到」章、进入下一题，再打开退出确认并返回首页。

开发入口也可以用同一个 smoke 脚本验证：

```bash
DEV_MODE=1 ios/ShiziApp/scripts/smoke-simulator.sh
```

它会用 `-shizi-dev` 启动 App，并验证 `?dev=1` 生效后「我的」页开发工具可见。

或者把 smoke 串进本地校验：

```bash
RUN_SMOKE=1 ios/ShiziApp/scripts/verify-local.sh
```

需要同时跑开发入口 smoke 时：

```bash
RUN_SMOKE=1 RUN_DEV_SMOKE=1 ios/ShiziApp/scripts/verify-local.sh
```

## 真机运行

1. 复制本地签名模板：

```bash
cp ios/ShiziApp/Config/Signing.xcconfig.example ios/ShiziApp/Config/Signing.local.xcconfig
```

2. 在 `Signing.local.xcconfig` 填写 `DEVELOPMENT_TEAM`、团队下唯一的 `PRODUCT_BUNDLE_IDENTIFIER` 和版本号。
3. 打开 `ios/ShiziApp/ShiziApp.xcodeproj`。工程通过 `Config/Shared.xcconfig` 自动读取本地签名文件，不需要在 Signing & Capabilities 里手动选择 Team。
4. 选择一台已连接 iPhone，scheme 选 `Shizi`，点击 Run。

`Signing.local.xcconfig` 会被 git 忽略。请把 Team、Bundle Identifier 和版本修改都保留在这个文件中，不要提交 Xcode GUI 写入 `project.pbxproj` 的本地签名变化。命令行和 CI 也使用同一份配置。

真机安装前建议先跑一次签名和设备预检：

```bash
SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig \
DEVICE_ID='你的 iPhone 名称或 UUID' \
ios/ShiziApp/scripts/signing-preflight.sh
```

它会检查 Xcode、Team、Bundle Identifier、代码签名证书、本地 provisioning profile、已配对 iPhone 状态和 build settings。预检通过后再执行安装脚本；如果失败，先按输出修 Apple Developer Team、profile 或设备连接状态。

也可以命令行安装并启动到已配对 iPhone：

```bash
xcrun devicectl list devices

SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig \
DEVICE_ID='你的 iPhone 名称或 UUID' \
ios/ShiziApp/scripts/run-device.sh
```

不想用 xcconfig 时，也可以继续用环境变量传 `DEVELOPMENT_TEAM` 和 `BUNDLE_ID`。调试开发入口时加 `DEV_MODE=1`，脚本会用 `-shizi-dev` 启动参数打开等价 `?dev=1` 的版本。

签名和设备预检通过后，可以在真机上自动跑与 Simulator 相同的 native smoke：

```bash
SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig \
DEVICE_ID='你的 iPhone 名称或 UUID' \
ios/ShiziApp/scripts/smoke-device.sh
```

脚本会构建、安装、运行两次 App，从真机 app data container 拉回 smoke JSON，并验证页面导航、离线笔画、加字、备份/恢复、练习/退出流程、软件键盘触发后的 viewport/inset/按钮可达性，以及 `localStorage` 跨进程重启持久化。开发入口加 `DEV_MODE=1`。真机书写手感、旋转、Files/iCloud 选择器和飞行模式仍需按 `DEVICE_QA.md` 人工检查。

第一次真机安装后重点测：

- 首页、写字页、字盒、我的、手感诊断都能打开。
- 手指在田字格书写时页面不滚动，笔迹不断裂。
- 提示、揭晓答案、自评、下一题流程正常。
- 退出本组后返回首页，已自评记录保留，当前未自评卡不记录。
- 关闭再打开 App 后，`localStorage` 里的记忆模型、复习调度、加字记录仍在。
- 飞行模式下首页和已打包笔画资源能加载。
- 底部 Tab、弹窗、加字输入框和键盘不遮挡主要按钮。

完整手工验收表见 `ios/ShiziApp/DEVICE_QA.md`。TestFlight 前建议复制一份并填上设备型号、iOS 版本、App 版本和结果。

## 开发工具入口

浏览器/PWA 仍然使用：

```text
http://127.0.0.1:8000/?dev=1
```

iOS App 调试使用 Xcode scheme：

```text
Shizi Dev
```

命令行启动模拟器里的开发模式：

```bash
xcrun simctl launch booted com.eimaa.shizi -shizi-dev
```

也可以在 Xcode 的 scheme arguments 里加入 `-shizi-dev`，或设置环境变量 `SHIZI_DEV=1`。

## Safari Web Inspector

真机调试 WKWebView：

1. iPhone 设置里打开 Safari 的 Web Inspector。
2. 用数据线连接 Mac，并在 Xcode 里运行 App。
3. Mac Safari 打开 Develop 菜单，选择对应 iPhone 或 Simulator，再选择 `Shizi` 页面。

可在 Inspector 里检查：

- `localStorage` 的 `shizi.*` 键是否持续存在。
- `shizi-resource://app/data/...json` 是否正常返回 JSON。
- Console 是否有 `HanziWriter` 或资源加载错误。
- `DEV_TOOLS` 在普通 scheme 为 false，在 `Shizi Dev` 为 true。

## TestFlight

1. 确认 `Signing.local.xcconfig` 中的 Team 和 Bundle Identifier 正确。
2. 更新 `MARKETING_VERSION`，并确保每次上传使用尚未提交过的 `CURRENT_PROJECT_VERSION`。
3. Xcode 选择 Any iOS Device 或真机，scheme 选 `Shizi`。
4. 菜单 Product -> Archive。
5. Organizer 里选择 Distribute App -> App Store Connect -> Upload。

上传前建议先做一次无签名 archive 结构校验：

```bash
xcodebuild -project ios/ShiziApp/ShiziApp.xcodeproj -scheme Shizi -configuration Release -destination 'generic/platform=iOS' -archivePath work/Shizi.xcarchive CODE_SIGNING_ALLOWED=NO archive
ios/ShiziApp/scripts/verify-archive.sh work/Shizi.xcarchive
```

真正上传 TestFlight 时不要加 `CODE_SIGNING_ALLOWED=NO`。

有 Apple Developer Team 和有效 App Store Connect 权限时，也可以用脚本导出 TestFlight 用 IPA：

```bash
PREFLIGHT_MODE=testflight \
SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig \
ios/ShiziApp/scripts/signing-preflight.sh
```

确认预检结果后再 archive/export：

```bash
BUILD_NUMBER=2 \
SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig \
ios/ShiziApp/scripts/archive-testflight.sh
```

脚本会 archive，检查离线资源、版本、arm64、iPhone-only、签名身份、Team、Bundle Identifier、build 号和 embedded provisioning profile，再用 `app-store-connect` export method 导出 IPA。`BUILD_NUMBER` 会覆盖 `CURRENT_PROJECT_VERSION`，每次上传前必须递增。也可以用环境变量传 `DEVELOPMENT_TEAM` 和 `BUNDLE_ID`。导出的 IPA 可以通过 Xcode Organizer、Transporter，或团队现有 CI 上传到 App Store Connect。

如果想让脚本直接调用 Xcode 上传到 App Store Connect：

```bash
DEVELOPMENT_TEAM=ABCDE12345 \
BUNDLE_ID=com.yourcompany.shizi \
BUILD_NUMBER=2 \
EXPORT_DESTINATION=upload \
ios/ShiziApp/scripts/archive-testflight.sh
```

CI 环境可以用 App Store Connect API key，不依赖已登录的 Xcode Accounts：

```bash
DEVELOPMENT_TEAM=ABCDE12345 \
BUNDLE_ID=com.yourcompany.shizi \
BUILD_NUMBER=2 \
EXPORT_DESTINATION=upload \
AUTHENTICATION_KEY_PATH=/secure/AuthKey_ABC123.p8 \
AUTHENTICATION_KEY_ID=ABC123 \
AUTHENTICATION_KEY_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
ios/ShiziApp/scripts/archive-testflight.sh
```

## 数据保留说明

App 使用 `WKWebsiteDataStore.default()`，Web 侧仍使用现有 `localStorage`，所以记忆模型、复习调度、加字、备份/恢复都沿用原逻辑。iOS 中「导出备份」调用原生分享面板，「恢复备份」调用原生 Files 文档选择器；浏览器/PWA 保留下载与 file input fallback。正常 App 更新会保留数据；卸载 App、抹掉设备数据或手动清理 WebKit 网站数据会删除本地记录。换机和长期内测前仍建议在「我的 -> 备份与重置 -> 导出备份」导出 JSON。

工程内包含 `PrivacyInfo.xcprivacy`，当前声明不追踪用户、不收集隐私数据、不使用需要声明的 required reason API；`ITSAppUsesNonExemptEncryption=false` 表示 App 没有使用非豁免加密。若后续加入埋点、账号、推送、第三方 SDK 或自研加密，需要同步更新这些声明和 App Store Connect 的 App Privacy/出口合规信息。
