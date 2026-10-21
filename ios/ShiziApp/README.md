# 拾字 iOS App 封装

这个目录是 iOS 外壳：不重写业务逻辑，用原生 `WKWebView` 把仓库根目录的同一套 Web/PWA 静态文件（第十稿 ES 模块版）完整跑进 App。原生侧只负责加载、手势门控、系统面板（分享 / Files / 相册 / 设置）、本地通知、触觉与按键音，界面文案全部在 Web 侧。

## 工程入口

- Xcode 工程：`ios/ShiziApp/ShiziApp.xcodeproj`
- Target：`Shizi`
- 普通用户 scheme：`Shizi`
- 开发调试 scheme：`Shizi Dev`

`Shizi` 加载普通用户版（不带 `?dev=1` / `?test=1`）。`Shizi Dev` 通过启动参数 `-shizi-dev`（或环境变量 `SHIZI_DEV=1`）加载 `index.html?dev=1&test=1`，打开色板 / 指针统计调试页（只在 Debug 编译）。

## 资源打包方式

资源清单**由仓库的 `scripts/shell-manifest.txt` 驱动**，不在本文或脚本里手列。每次 Xcode Build 的「Sync Web Assets」阶段运行 `scripts/sync-web-assets.sh`，用 `rsync -a --files-from=scripts/shell-manifest.txt` 把清单里的文件逐个复制进 App 包的 `Web/`，并断言几项关键文件存在（`index.html`、`deck-data.js`、`core-strokes.js`、`vendor/hanzi-writer.min.js`、`vendor/fsrs6.min.js`、`src/app.js`、`manifest.webmanifest`、`data/`）。

清单由 `pnpm run build:manifest`（`scripts/build_shell_manifest.mjs`）生成，覆盖 `index.html`、`src/`、`vendor/`、`fonts/`、`licenses/`、`assets/`、`data/` 全部笔顺 JSON、题库与图标等。**新增、删除或修改任何 Web 文件后先在仓库根目录重新生成清单**，否则新文件不会进包（`pnpm run verify:unit` 会报清单过期；`verify-bundle-assets.sh` 逐行核对包内文件与清单一致）。缺清单时同步脚本直接失败并提示命令。

App 内部用 `shizi-resource://app/index.html` 加载页面，ES 模块、字体（`font/woff2`）与 `data/*.json` 都经同一个本地 scheme 按正确 MIME 返回，CSP 与 Web 版同为只允许 `'self'`。因此真机离线时也能加载首页、题库、调度器、字体和笔顺。PWA 的 service worker 在原生 App 里不是依赖项；离线能力来自 App bundle。

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

数据层单测（XCTest，只测 `NativeStore.swift`：表结构、事务原子性、校验与读回、迁移标记、与 JS 同口径的校验和向量）：

```bash
xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziStoreTests -destination 'platform=iOS Simulator,id=<udid>' CODE_SIGNING_ALLOWED=NO
```

原生写字页（B2.0 纵切，DEBUG 启动参数 `-shizi-native-write` / `SHIZI_NATIVE_WRITE=1`，默认关；架构见 `docs/engineering/v10/B2-原生写字架构.md`）的宿主测试（App 作测试宿主：真 store、原生 SQLite、写字会话 API、D07 失败注入），以及原生书写面（B2.1 起 Release 组件）的 `InkSurfaceTests`（笔锋模型金标准、点处理与几何、Pencil / 手掌 / 换字持住）：

```bash
xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziWriteTests -destination 'platform=iOS Simulator,id=<udid>' CODE_SIGNING_ALLOWED=NO
```

会清空该模拟器上 App 的数据（`__shiziTest.reset`），请用自己的模拟器。

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

它会构建 Debug 模拟器包、检查 bundle 资源、**卸载后全新安装**（预先授权「添加照片」），然后分三次启动跑 DEBUG 原生冒烟（02 M5-3；脚本在 `ShiziApp/NativeSmoke.swift`，只在 Debug 编译）。冒烟时 Swift 给 URL 追加 `?test=1`、在 documentStart 注入 `window.__shiziNativeDev = true`，页面挂上公开测试钩子 `window.__shiziTest`；页面每次 postMessage `pageReady` 后原生注入冒烟脚本，结果写到 App 的 `Documents/shizi-native-smoke.json`，由 `validate-native-smoke.py <json> <stage>` 按阶段核对：

- `main`：ES 模块在 `shizi-resource://` 下加载、经典脚本全局（SEED/GROUPS/语境覆盖/600 核心笔顺）、`fetch` 笔顺 JSON、ShiziKai 字体、BUILD 就绪标记；`localStorage` 可写；合成 PointerEvent 写一字 → 写好了 → 写对了（judged 记录）；写下一字一笔后整页刷新，写字页同一阶段、笔画恢复；边缘返回在写字页被原生门控拒绝、在子页派发 `shizi-native-back` 返回一层；备份导出（原生 `shareBackup` 替身写文件并回 `markBackupExported`，文件不含 `shizi.nativeSmoke.v1`）；再写一字判断后从导出的文件恢复（原生预检 → `shiziBackupPicked` → 页内确认 → 替换 → 撤销，全程不 reload）；非备份文件、不是拾字的 JSON、超过 10 MB、取消选择分别显示 R-B06 文案；`syncReminder` 下发内容经 Swift 同一个排期函数核对；`openAppSettings`；图片存相册（`savePracticeCard` → `shiziCardSaved`）；所有写入经 storage.js。
- `relaunch`：结束进程后再启动，冒烟键、两条记录、会话与上次备份时间都在；脚本另外直接读 WKWebView 的 LocalStorage 数据库核对。
- `deeplink`：结束进程后带 `-shizi-reminder-target base:春` 冷启动（等同点开提醒通知）：原生等页面 `pageReady` 才派发，`shiziOpenReminderTarget` 返回 true 才清 key，页面以「这次选的字」开这个字。

系统面板（分享、文件选择、系统设置）在冒烟里由 Debug 替身代替，其余走正式代码路径；真实面板与真机手感见 `DEVICE_QA.md`。Release 产物里没有这些替身：`verify-archive.sh` 检查可执行文件不含 `__shiziNativeDev` / `nativeSmokeResult` 等标记。

`-shizi-dev` 打开的是色板 / 指针统计页（`?dev=1&test=1`），它不发 `pageReady`，不跑冒烟；冒烟脚本里旧的 `DEV_MODE=1` / `RUN_DEV_SMOKE=1` 已停用（`run-device.sh` 仍可用 `DEV_MODE=1` 以 `-shizi-dev` 启动调试页）。

或者把 smoke 串进本地校验：

```bash
RUN_SMOKE=1 ios/ShiziApp/scripts/verify-local.sh
```

## 原生写字页界面检查（QA-H1：一条命令）

```bash
pnpm run verify:native-ui            # = ios/ShiziApp/scripts/verify-native-ui.sh，全部（逐屏对比 + 流程用例）
ios/ShiziApp/scripts/verify-native-ui.sh --parity-only | --flows-only | --states recall,judge
ios/ShiziApp/scripts/verify-native-ui.sh --update-reference   # 网页写字页或固定条件改了之后，重新生成参考图
```

脚本自建专用模拟器（iPhone 17 / iOS 26.5，名「QA-H1 <时间>」），结束时删除，不碰别的模拟器；输出在 `ios/ShiziApp/build/native-ui/<时间>/`（不进仓库）：`summary.md`（通过 / 失败清单与总耗时）、`parity/report.md` 与 `parity/side-by-side/*.png`（左网页、右原生，差异编号框）、`flows.md` 与 `flows.xcresult`。有回归退出码 1；已知问题（预期失败 · 待修）不算。

**状态注入**（`ShiziApp/NativeQAHarness.swift`，只在 DEBUG；`verify_assets` / `verify-archive.sh` 断言 Release 不含）：启动参数 `-shizi-test-host -shizi-native-write -shizi-qa-seed <状态>` 把写字页一键带到指定状态（`-shizi-native-write-off` = 同一状态的网页版）。数据固定：「这次选的字」5 字（永 和 春 日 月）。状态：`first-recall`（首练第 1 字）、`recall`、`recall-ink`（两笔）、`hint-1` / `hint-2` / `hint-full`、`trace`（描一遍）、`retrace`（凭记忆写）、`judge`、`line`（格下结果行）、`change-sheet`（改判弹层）、`skip-undo`（撤销条）、`end-dialog`（结束确认框）、`last` / `last-judge`（最后一字）、`result` / `result-daily`（结果页）、`home` / `home-used` / `home-mid`（首页起点）。另有 `-shizi-qa-fail-next <n>`（接下来 n 次写入失败，测三段式）、`-shizi-qa-probe`（探针：读屏元素 `qa-probe` 的 value 是 store 摘要 JSON，XCUITest 用它断言记录 / 会话 / 路由 / 原生页阶段 / 原生转场）。注入走正式代码：会话由 `core/session-start` 开，推进与阶段经写字会话 API 提交，点按走原生页按钮自己的动作。

**逐屏对比**（`scripts/native-ui/`）：参考图 = 同一台模拟器上网页版写字页（`ShiziUITests/Reference/<状态>_<外观>_<字号>.png` 与 `.json`，1 倍点尺寸），覆盖上面 15 个写字页状态 × 浅 / 深 × L / XXXL。对比以「元素清单 + 位置尺寸 + 文案 + 颜色」为主：原生取 UIKit 视图树 + 无障碍属性（identifier / label / frame，成员名作语义键），网页取 DOM（getBoundingClientRect / 文字矩形 / computed color）；语义键配对（`elements.mjs` KEYS），其余按文字配对；文字比左缘与竖向中线；容差在 `parity.config.json`（位置 ±1pt、尺寸 ±1pt、文字高 ±4pt、颜色通道 ±8、字号 ±0.5pt、字重 ±0.1）；书写格只比框不比墨。截图只取少量像素给具名检查（格底色、辅助线、题面空格、横画粗、遮罩）。具名检查 = AI 一致性报告 NP-* 逐条（`parity-checks.mjs`，`status: 'expected-fail'` 待修，修好后报「意外通过」再改成 `'pass'`）；负责人定过的逐项豁免写在 `parity.config.json` 的 `waive`（编号 → 理由，照跑照记实测值、不算回归，现有 NP-07 墨粗，D71 ①）。

**流程用例**（XCUITest target `ShiziUITests`，scheme 同名）：`EntryFlowTests`（确认单 §1 各入口、D62 转场、返回落点、首页 / 字库数字；§8 结果页出口与「再写一组」D70；§9 重写错字只算练习）、`WriteFlowTests`（§2–§7 各步、‹ 与左缘、跳过撤销含最后一字、结束这组有 / 零判断、杀进程重开恢复）、`KnownIssueTests`（AI 报告 NF-01/03/04/05、NP-01 用 `XCTExpectFailure` 标「预期失败 · 待修」；NP-06 三段式为普通断言；「已验证正常的路径」1–13 对照见文件头）。单独跑：`xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziUITests -destination 'platform=iOS Simulator,id=<自己的模拟器>' CODE_SIGNING_ALLOWED=NO`（会清掉该模拟器上 App 的数据）。

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

脚本会构建、安装，按 `main` / `relaunch` / `deeplink` 三个阶段启动 App，从真机 app data container 拉回 smoke JSON 并用同一个 `validate-native-smoke.py` 核对（真机上相册权限由系统弹窗决定，拒绝时允许图片保存走失败分支）。真机书写手感、旋转、Files/iCloud 选择器和飞行模式仍需按 `DEVICE_QA.md` 人工检查。

真机人工检查按 `ios/ShiziApp/DEVICE_QA.md`（第十稿 M7 版：书写与 Pencil、边缘返回与跟手、查字框键盘、字体、切后台与进程被杀、迁移、PWA 升级、通知 / 分享 / 相册、VoiceOver、iOS 15.x 低端机）。TestFlight 前复制一份，填上设备型号、iOS 版本、App 版本、被测 SHA 和结果。

## 开发工具入口

浏览器里的调试页（色板 / 指针统计）：

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

- `localStorage` 的 `shizi.v2.*` 键是否持续存在（升级用户在回退窗口内还会有旧 `shizi.*.v1` 键）。
- `shizi-resource://app/data/...json` 是否正常返回 JSON，`fonts/*.woff2` 是否为 `font/woff2`。
- Console 是否有模块加载、CSP 或 `HanziWriter` 错误。
- 普通 scheme 下 `window.__shiziTest` 为 `undefined`（测试钩子只在 Debug 冒烟 / `Shizi Dev` 下挂载）。

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

## 练习提醒

「我的 → 设置 → 练习提醒」开启本地通知（默认关，只在 iOS 壳内真正发通知）。原生是无状态执行器：页面经 `shiziNative` 桥下发 `syncReminder {enabled, hour, minute, practicedToday, questions[]}`，原生每次先清掉自己排的通知，再按页面给的题目排接下来 7 天（今天已练或已过点跳过今天；没有题目的日子不发），排之前以本机实际授权为准。题目由页面算：每天取到那天已到期、有语境词的字，写错过优先、其次到期最久；标题「{词语}（{拼音}）」里目标字遮成 □（03 P48 / P99）。点开通知时 `AppDelegate` 把 `targetCardKey` 交给 `shiziOpenReminderTarget`：页面未就绪先排队，返回 true 后原生才清 key；页面以「这次选的字」开这个字（03 P47）。授权结果经 `shiziReminderStatus` 回调，「去手机设置 ›」用 `openAppSettings`。

## 触觉与按键音

触觉经 `haptic {kind}` 消息：判断落定 / 修改判断为 stamp，提示与进「描一遍」为 select，看答案、进结果页、结束这组为 action，撤销跳过为 undo（03 P97，沿旧版点位）。按键音（设置里「按键音」，默认开）只有两处：判断落定（短促闷响）和「描一遍」落笔（纸声），经 `sound {kind}` 由 `AVAudioPlayer` 播放运行时合成的短 PCM，`AVAudioSession` 为 `.ambient` + `.mixWithOthers`，遵守静音键。练字背景音已删除（P07），`soundscape` 消息是 no-op。

## 数据保留说明

**B1 起数据存在 App 自己的 SQLite 库** `Library/Application Support/ShiziStore/shizi.sqlite`（WAL、synchronous=FULL、文件保护「首次解锁后」、随 iCloud / 电脑备份；表结构与耐久性见 `docs/engineering/v10/01-架构设计.md` §4.1）。页面经同源端点 `/__native/store/v1/<op>`（`NativeStoreBridge.swift`）读写，键名与值同下文的 `shizi.v2.*`；第一次启动新版本时把 `localStorage` 里的全部 `shizi.*` 键一次性迁进去并逐项核对（§12.1），迁移没完成之前仍用 localStorage，旧 localStorage 数据保留一个版本周期不删。以下是迁移前（以及网页 / PWA）的存法：App 使用 `WKWebsiteDataStore.default()`，Web 侧数据全部在 `localStorage` 的 `shizi.v2.*` 键（数据模型 v2：记录按月分键、调度、设置、自选字、旧照片、备份元信息等；键表见 `docs/engineering/v10/01-架构设计.md` §3.6），所有写入经 `src/store/storage.js` 的事务。旧版（v1）用户首次打开新版时自动迁移一次；迁移后立即删除旧会话与旧安全副本大键，其余 v1 键保留到回退窗口结束（30 天或用户完成一次 v2 导出，先到者，03 P53）。

「我的 → 备份与恢复」导出调用原生分享面板（分享完成才更新上次备份时间，取消不提示），备份文件为 `{app:'shizi', version:2, …}`；「用备份替换」调用原生 Files 选择器，原生预检后经 `shiziBackupPicked` 交给页面确认，非备份文件、超过 64 MB（B1 前 10 MB）、取消选择经 `shiziBackupRejected` 显示页内 R-B06 文案；替换与清空前写设备内保护副本，离开备份页前可撤销，全程不 reload。旧版 v1 备份文件可以直接导入。练习图片经 `sharePracticeCard` / `savePracticeCard` 调起分享面板或存相册（`NSPhotoLibraryAddUsageDescription`）；分享或保存失败经 `shiziShareFailed` 由页面轻提示。浏览器 / PWA 保留 Web Share、下载和 file input 降级。拍字 / OCR 与相机已删除（不再有 `NSCameraUsageDescription`），旧照片只读查看并随备份。

正常 App 更新会保留数据；卸载 App、抹掉设备数据会删除本地记录（迁移前清理 WebKit 网站数据也会）。换机前请在「我的 → 备份与恢复」导出备份。

工程内包含 `PrivacyInfo.xcprivacy`，当前声明不追踪用户、不收集隐私数据、不使用需要声明的 required reason API；`ITSAppUsesNonExemptEncryption=false` 表示 App 没有使用非豁免加密。若后续加入埋点、账号、推送、第三方 SDK 或自研加密，需要同步更新这些声明和 App Store Connect 的 App Privacy/出口合规信息。
