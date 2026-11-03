# 拾字 iOS App 封装

这个目录是拾字的原生 iOS App（B4.9 起 App 里没有 JS / WKWebView）：界面是 UIKit（`ShiziApp/`、组件库 `ShiziApp/ShiziKit/`），规则与数据在 Swift 包 `ios/ShiziCore`（排课、记录、备份、视图模型、导航规则；JS 版 `src/` 冻结在仓库里作参考实现），数据存在 App 自己的 SQLite 库。文案、令牌、动效仍以仓库的 `src/config/copy`、tokens、policy 为来源，构建期生成进 ShiziKit / ShiziCore 的资源。
架构与历史见 `docs/engineering/v10/B3B4-原生化架构与计划.md`（§10.x B4.9 是删 JS 的记录）。

## 工程入口

- Xcode 工程：`ios/ShiziApp/ShiziApp.xcodeproj`
- Target：`Shizi`
- 普通用户 scheme：`Shizi`
- 开发调试 scheme：`Shizi Dev`

`Shizi Dev` 带启动参数 `-shizi-dev`（或环境变量 `SHIZI_DEV=1`）：打开 DEBUG 测试宿主的设施（QA 时钟、测试用屏），Release 不编译。

## 资源打包方式

App 包里的 `Web/` 只放原生仍在读的资源：`data/`（笔顺 / 字源 JSON，原生直读 `Web/data/<字>.json`）、`fonts/`（`NativeType` / `ShiziScreen` / 图片渲染器读 `Web/fonts/*.woff2`）与 `licenses/`，外加关于页的版本行 `Web/build-info.json`。清单是 `scripts/app-bundle-manifest.txt`（`pnpm run build:manifest` 按 `scripts/build_shell_manifest.mjs` 的 `APP_BUNDLE_ROOTS` 生成），Xcode 的「Sync Web Assets」阶段（`scripts/sync-web-assets.sh`）用 `rsync --files-from=` 逐个复制，并断言网页壳（`src/`、`vendor/`、`index.html`、`sw.js` …）**不**在包里。改了 `data/` / `fonts/` / `licenses/` 先重新生成清单（`pnpm run verify:unit` 会报过期）。

声音（判断声 j1 三变体与落款声 s1，CAF）是 App 的原生资源 `ShiziApp/Sounds/`（包里 `Sounds/`，`SoundPlayer.swift` 播放；`scripts/sound/gen.mjs` 生成，网页用同样采样的 WAV 在 `assets/sound/`）。题库、规则表、文案表在 ShiziCore 的资源包里（`verify-core-bundles.sh` 核对每个 `.copy` 目录真的进了包）。

## 本地构建校验

在仓库根目录运行：

```bash
ios/ShiziApp/scripts/verify-local.sh
```

它会检查 plist、shell 脚本、Xcode 工程、模拟器 Debug 构建、iPhoneOS Release 无签名 archive、archive 元数据、bundle 资源完整性（含「可执行文件不链接 WebKit」、包里没有网页壳）和 iPhone-only 设置。

也可以手动分步运行：

```bash
xcodebuild -list -project ios/ShiziApp/ShiziApp.xcodeproj
xcodebuild -project ios/ShiziApp/ShiziApp.xcodeproj -scheme Shizi -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/ShiziApp/ShiziApp.xcodeproj -scheme Shizi -configuration Release -destination 'generic/platform=iOS' -archivePath work/Shizi.xcarchive CODE_SIGNING_ALLOWED=NO archive
ios/ShiziApp/scripts/verify-archive.sh work/Shizi.xcarchive
```

数据层单测（XCTest，只测 `NativeStore.swift`：表结构、事务原子性、校验与读回、与 JS 同口径的校验和向量）：

```bash
xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziStoreTests -destination 'platform=iOS Simulator,id=<udid>' CODE_SIGNING_ALLOWED=NO
```

原生写字页与引擎的宿主测试（App 作测试宿主：真 store、原生 SQLite、写字会话 API、D07 失败注入；颜色 / 字阶 / 文案 / 动效取手改的 `ShiziKit/Generated/*.json`（D84：唯一真相源，见该目录 README，没有生成器）），以及原生书写面的 `InkSurfaceTests`（笔锋模型金标准、点处理与几何、Pencil / 手掌 / 换字持住）：

```bash
xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziWriteTests -destination 'platform=iOS Simulator,id=<udid>' CODE_SIGNING_ALLOWED=NO
```

会清空该模拟器上 App 的数据（`TestHost.reset` = `SwiftEngine.qaReset`），请用自己的模拟器。

`CODE_SIGNING_ALLOWED=NO` 只用于本地无证书编译校验。真机运行和 TestFlight 必须使用 Apple Developer Team 正常签名。

构建后可以检查 App 包或 archive 里的离线资源是否完整：

```bash
ios/ShiziApp/scripts/verify-bundle-assets.sh /path/to/Shizi.app
ios/ShiziApp/scripts/verify-bundle-assets.sh /path/to/Shizi.xcarchive
ios/ShiziApp/scripts/verify-archive.sh /path/to/Shizi.xcarchive
```

模拟器上的端到端检查是下一节的 `verify-native-ui.sh`（XCUITest 流程 + 逐屏对比）。B4.9 前的网页冒烟（`smoke-simulator.sh` / `smoke-device.sh` / `validate-native-smoke.py` / `NativeSmoke.swift`）随 WKWebView 退役（B3.F 起已失效）。

## 原生写字页界面检查（QA-H1：一条命令）

```bash
pnpm run verify:native-ui            # = ios/ShiziApp/scripts/verify-native-ui.sh，全部（逐屏对比 + 流程用例）
ios/ShiziApp/scripts/verify-native-ui.sh --parity-only | --flows-only | --states recall,judge
node ios/ShiziApp/scripts/native-ui/fixture-dev.mjs library-records --out /tmp/x.png         # 网页参考的开发工具（冻结的网页版在 Chromium 里跑夹具）
```

脚本自建专用模拟器（iPhone 17 / iOS 26.5，名「QA-H1 <时间>」），结束时删除，不碰别的模拟器；输出在 `ios/ShiziApp/build/native-ui/<时间>/`（不进仓库）：`summary.md`（通过 / 失败清单与总耗时）、`parity/report.md` 与 `parity/side-by-side/*.png`（左网页、右原生，差异编号框）、`flows.md` 与 `flows.xcresult`。有回归退出码 1；已知问题（预期失败 · 待修）不算。

网页参考图（`ShiziUITests/Reference/`）在 B3.F 合并前取齐冻结；B4.9 起 App 里没有网页，`--update-reference` / `--reference-only` 退役。

**状态 = 夹具文件**（B3.3 起数据驱动）：一个状态一个文件 `ShiziUITests/States/<状态>.json`——路由 / 造数据 / 钉时钟 / 点按序列 / 写失败注入都在里面，原生取证、XCUITest（`-shizi-qa-seed <状态>`）与冻结的网页参考读同一份；**加一个状态只加文件，不改任何共享枚举 / switch / 脚本**。字段说明在 `ShiziApp/QAFixtures.swift` 文件头：`state`、`name`、`screen`（屏名，覆盖门禁按它归类）、`overlay` / `floater`（弹层 / 浮条名）、`native`（原生页已实现才为 true，逐屏对比只比 true 的；其余是 reference-only）、`parity`（false = 只作流程起点）、`ax`（另取 AX3 / AX5）或 `sizes`（直接指定字号档，例：只在 AX 档出现的弹层）、`order`（取证顺序）、`template`（`_templates/<名>.json` 的默认值）、`base`（先整条跑另一个夹具，再接着往下）、`clock.pin`（造数据期间钉住页面时钟）、`setup`（页面里依次执行的操作）、`ready` / `settleBefore` / `steps` / `settle`（等页面、点按、落定）。`setup` 里的 op 由 Swift 执行（B4.9：`ShiziApp/QAOps.swift`，与原来的 `States/_ops/<op>.js` 同名同参——每个 op 调 ShiziCore 里与 JS 同名的那一个函数；`seedRecords` 是夹具生成器：种子化、时间戳写死、经 `SessionWrites.judgeInDraft` 与真人判断同一个函数，所以任何一天跑出同一份数据）。`_ops/*.js` 与 `_runtime/` 只留给网页参考的开发工具（Chromium）。夹具 JSON 在 Debug 构建时由 `sync-web-assets.sh` 拷进 App 包的 `QAStates/`（Release 不含）。

**状态注入**（`ShiziApp/NativeQAHarness.swift` + `QAFixtures.swift`，只在 DEBUG；`verify_assets` / `verify-archive.sh` 断言 Release 不含）：启动参数 `-shizi-test-host -shizi-qa-seed <状态>` 把 App 一键带到指定状态。数据固定：「这次选的字」5 字（永 和 春 日 月）；B2 的 28 个状态（`first-recall`、`recall`…`redo-last`、`result*`、`home` / `home-used` / `home-mid`）与 B3.3 加的网页参考状态（首页 / 字库 / 我的 / 全部字 / 区详情 / 换库 / 字详情 / 旧记录 / 练习记录 / 月字帖 / 年报 / 提醒 / 备份 / 关于 / 没字页 / 阻断页 / 查字 / S02 / 图片预览 / 浮条等，约 100 个，按页清单见 `B3B4-原生化架构与计划.md` §1 与 §10.6）都在 `States/`。造数据时把应用时钟钉在固定时刻（落款与「N 天后再见」可复现：FSRS 的 fuzz 种子含复习时刻，钉住的时钟每次读数 +5ms、顺序确定，**所以造数据时多一次 / 少一次读时钟都会让天数变**；judge 的 `tick` 把读数拨到固定值）；这个钟是全 App 唯一的钟（`QAClock`：放开时量出偏移存下，store / 导航 / 原生 SQLite 时间戳 / 提醒排期都用它，杀进程重开照旧；不钉时钟的注入清掉它），所以冷启动恢复与真实日期无关。另有 `-shizi-qa-fail-next <n>`（接下来 n 次写入失败，测三段式；夹具里的 `failNext` 同义）、`-shizi-qa-probe`（探针：读屏元素 `qa-probe` 的 value 是 store 摘要 JSON，XCUITest 用它断言记录 / 会话 / 路由 / 原生页阶段 / 原生转场）。注入走正式代码：会话由 ShiziCore `ScheduleRules.startPicked / startNextA` 开，推进与阶段经写字会话 API（SessionRuntime `write.*`）提交，导航走 SwiftNavigator，点按走原生页按钮自己的动作。

**逐屏对比**（`scripts/native-ui/`）：参考图 = 同一台模拟器上网页版写字页（`ShiziUITests/Reference/<状态>_<外观>_<字号>.png` 与 `.json`，1 倍点尺寸），覆盖上面各状态 × 浅 / 深 × L / XXXL，另有大字号的主要状态（夹具 `ax: true`：B2 的 16 个写字 / 结果 / 重写错字状态，B3.3 起各页主要状态）× 浅 / 深 × AX3 / AX5（B2.9b）。**只有 `native: true` 的状态才逐屏对比**（B2 的 25 个）；B3.3 取的网页参考在原生页做出来之前是 reference-only，页面卡原生化合并时把自己页的夹具改成 `native: true`，并填 `keys/<屏>.mjs` 的 native 一栏。参考图的 JSON 里还有 `ax`（读屏名称表：aria-label / role / aria-live，B3B4 §5.4，原生页逐项比 `accessibilityLabel`）。AX 档原生的逐元素字号 / 行高 / 最小高取页面量到的值（`native-session.js` `NATIVE_AX_ROLES`：按网页的类名挂看不见的探针，读 :root[data-ax] 规则算出的值，原生不抄取值表）；具名检查 **AX-01**（只在 AX3 / AX5 跑）：原生每个文字 / 按钮不被截断、不被祖先裁掉（滚动区里滚得到的不算）、不伸出屏幕，同一层（页面 / 弹层 / 确认框 / 撤销条）里互不重叠。对比以「元素清单 + 位置尺寸 + 文案 + 颜色」为主：原生取 UIKit 视图树 + 无障碍属性（identifier / label / frame，成员名作语义键），网页取 DOM（getBoundingClientRect / 文字矩形 / computed color）；语义键配对（`keys/<屏>.mjs`，`elements.mjs` 按目录合并；B3.3 从网页参考为每个屏 / 弹层生成了一份，native 一栏待页面卡填），其余按文字配对；文字比左缘与竖向中线；全局容差在 `parity.config.json`（位置 ±1pt、尺寸 ±1pt、文字高 ±4pt、颜色通道 ±8、字号 ±0.5pt、字重 ±0.1）；书写格的框按元素比；格里的墨另按像素比（R11-A，D72 ②：`parity.config.json` `ink`——recall-ink / judge / last-judge / change-sheet 的墨格里，同一组注入笔画的墨区 IoU ≥ 0.8、容 1 像素 ≥ 0.97、墨面积比（= 平均笔宽比）±10%，NP-07 / NP-22）。截图另取少量像素给具名检查（格底色、辅助线、题面空格、横画粗、遮罩）。具名检查 = AI 一致性报告 NP-* 逐条（`checks/<屏>.mjs`，`parity-checks.mjs` 按目录合并，`status: 'expected-fail'` 待修，修好后报「意外通过」再改成 `'pass'`）；逐项豁免 / 忽略 / 墨格语义键写在 `parity/<屏>.json`（`waive`：编号 → 理由，照跑照记实测值、不算回归；`ignore`：不比的差异；`ink.states`：状态 → 墨格语义键；现 `parity/write.json` 是 B2 的，无 waive 条目——NP-07 墨粗的豁免已随 D72 ② 取消）。**覆盖门禁**（`test/native-ui-coverage.test.mjs`，`pnpm run verify:unit` 里跑）：每个已注册的屏、弹层、浮条至少有一个带网页参考图的夹具，或在 `scripts/native-ui/coverage.json` 的 `notApplicable` 里写明理由；每个参考状态的 PNG + JSON 都在册。

**流程用例**（XCUITest target `ShiziUITests`，scheme 同名；B3.3 起另有 B3B4 §5.2 的 11 个页面类骨架——`HomeFlowTests` / `LibraryFlowTests` / `DetailFlowTests` / `QueryFlowTests` / `MineFlowTests` / `BackupFlowTests` / `ImageFlowTests` / `NavigationTests` / `RestoreAndDeepLinkTests` / `BlockTests` / `AccessibilityAuditTests`，63 个用例先 `QAPending.skip`（XCTSkip，汇总里记「待办」不算失败），页面卡把自己那一类的用例填实）：`EntryFlowTests`（确认单 §1 各入口、D62 转场（B2.8：每个入口的转场种类读探针 transitions / webNav，含左缘跟手、减少动态效果 `-shizi-qa-reduce-motion` 淡化、不叠播）、返回落点、首页 / 字库数字；§8 结果页出口与「再写一组」D70；§9 重写错字只算练习）、`ResultFlowTests`（§8 结果页；§9 原生重写错字页逐字写完 / 中途返回 / 冷启动，B2.9a）、`WriteFlowTests`（§2–§7 各步、‹ 与左缘、跳过撤销含最后一字、结束这组有 / 零判断、杀进程重开恢复）、`AccessibilityFlowTests`（B2.9b：同一注入状态分别打开网页版与原生版，按读屏顺序比名称序列；播报队列经探针 `a11y`（`NativeA11y` 记下的 screen: / announce:）核对与网页 sr-live.js 同一组句子；AX5 下 `performAccessibilityAudit`）、`KnownIssueTests`（AI 报告 NF-01/03/04/05、NP-01；仍待修的用 `XCTExpectFailure` 标「预期失败 · 待修」，NF-01 由 B2.8、NF-04 由 B2.9a 修好转成普通断言；NP-06 三段式为普通断言；「已验证正常的路径」1–13 对照见文件头）。单独跑：`xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziUITests -destination 'platform=iOS Simulator,id=<自己的模拟器>' CODE_SIGNING_ALLOWED=NO`（会清掉该模拟器上 App 的数据）。

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

「我的 → 设置 → 练习提醒」开启本地通知（默认关）。`RootViewController` 是无状态执行器：SwiftEngine 的 `ReminderController` 下发 `syncReminder {enabled, hour, minute, practicedToday, questions[]}`，原生每次先清掉自己排的通知，再按页面给的题目排接下来 7 天（今天已练或已过点跳过今天；没有题目的日子不发），排之前以本机实际授权为准。题目由 ShiziCore 算：每天取到那天已到期、有语境词的字，写错过优先、其次到期最久；标题「{词语}（{拼音}）」里目标字遮成 □（03 P48 / P99）。点开通知时 `AppDelegate` 把 `targetCardKey` 交给 `RootViewController.openReminderTarget`：冷启动判定之前先存着，`deeplink.reminder`（SwiftNavigator）答 ok 后才清 key，以「这次选的字」开这个字（03 P47）。授权结果交回 SwiftEngine（`receiveReminderStatus`）。

## 触觉与声音

触觉由原生页自己发（交互与动效规范 F1，D58 ③：判断 soft 0.7、落印 rigid 0.8、light 0.5、select）。声音只有两种：判断声 j1 三个变体轮换（SwiftEngine 在判断类提交时发）与落款声 s1（结果页落印，同一组只响一次），`SoundPlayer` 播 `Sounds/*.caf`，`AVAudioSession` 为 `.ambient` + `.mixWithOthers`，遵守静音键。

## 数据保留说明

**B1 起数据存在 App 自己的 SQLite 库** `Library/Application Support/ShiziStore/shizi.sqlite`（WAL、synchronous=FULL、文件保护「首次解锁后」、随 iCloud / 电脑备份；表结构与耐久性见 `docs/engineering/v10/01-架构设计.md` §4.1）。SwiftEngine 的 Store 经 `AppDatabase.swift`（一条连接、一个串行队列）读写，键名与值同下文的 `shizi.v2.*`。B4.9（D81 ②）起不再有 localStorage → SQLite 的迁移路径：新装、升级都直接开这个库（没迁过的旧设备不再支持）。以下是网页 / PWA（冻结在仓库里）的存法：App 使用 `WKWebsiteDataStore.default()`，Web 侧数据全部在 `localStorage` 的 `shizi.v2.*` 键（数据模型 v2：记录按月分键、调度、设置、自选字、旧照片、备份元信息等；键表见 `docs/engineering/v10/01-架构设计.md` §3.6），所有写入经 `src/store/storage.js` 的事务。旧版（v1）用户首次打开新版时自动迁移一次；迁移后立即删除旧会话与旧安全副本大键，其余 v1 键保留到回退窗口结束（30 天或用户完成一次 v2 导出，先到者，03 P53）。

「我的 → 备份与恢复」导出调用原生分享面板（分享完成才更新上次备份时间，取消不提示），备份文件为 `{app:'shizi', version:2, …}`；「用备份替换」调用原生 Files 选择器，原生预检（`BackupFile.precheck`）后交给会话层确认，非备份文件、超过 64 MB（B1 前 10 MB）显示 R-B06 说明框，取消选择什么都不显示；替换与清空前写设备内保护副本，离开备份页前可撤销，全程不 reload。旧版 v1 备份文件可以直接导入。练习图片由原生图片预览调起分享面板或存相册（`NSPhotoLibraryAddUsageDescription`）；失败时原生轻提示（X-SHARE 文案）。浏览器 / PWA 保留 Web Share、下载和 file input 降级。拍字 / OCR 与相机已删除（不再有 `NSCameraUsageDescription`），旧照片只读查看并随备份。

正常 App 更新会保留数据；卸载 App、抹掉设备数据会删除本地记录。换机前请在「我的 → 备份与恢复」导出备份。

工程内包含 `PrivacyInfo.xcprivacy`，当前声明不追踪用户、不收集隐私数据、不使用需要声明的 required reason API；`ITSAppUsesNonExemptEncryption=false` 表示 App 没有使用非豁免加密。若后续加入埋点、账号、推送、第三方 SDK 或自研加密，需要同步更新这些声明和 App Store Connect 的 App Privacy/出口合规信息。
