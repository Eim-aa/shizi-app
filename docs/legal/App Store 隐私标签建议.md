# App Store 隐私标签（App Privacy）填写建议

> AI 起草，不是律师意见。依据仓库 `v10/integration`（2026-10-04）逐项核对的实际行为。对应决定 D48：隐私标签和关于页写明不收集数据、无账号；辅助功能标签只声明真实支持的项。

## 1. 结论

在 App Store Connect →「App 隐私」里，选 **「否，我们不会从此 App 收集数据」**。商店页会显示 **「未收集数据」（Data Not Collected）**，同时不涉及「跟踪」。

**为什么能这么填**：Apple 对「收集」的定义是，数据被传到设备之外，而且你或第三方合作方能访问它，访问时间长于实时处理请求所需。拾字的数据始终留在设备上，满足不了这个定义。具体依据：

| 核对项 | 仓库里的证据 | 结论 |
|---|---|---|
| 有没有网络请求 | iOS 壳的 CSP 是 `connect-src 'self'`，所有资源都由 `LocalWebSchemeHandler` 从 App 包里的 `Web/` 目录读取；JS 里只有本地 `data/` 的 fetch；Swift 代码没有用 `URLSession`；Release 版不编译 `NativeSmoke.swift` | 不联网 |
| 第三方 SDK | Xcode 工程里没有 Swift Package，也没有 CocoaPods；`vendor/` 只有 Preact、htm、Hanzi Writer、ts-fsrs，都是纯本地运行的库 | 没有 |
| 存储 | 存在 WKWebView 的 `localStorage`（`websiteDataStore = .default()`），留在本机 | 不算「收集」 |
| 备份导出 | 用户主动打开系统分享面板（`UIActivityViewController`），目的地由用户自己选 | 不算开发者收集 |
| 备份导入 | `UIDocumentPickerViewController` 选文件，只在本机读取 | 不算「收集」 |
| 相册 | `PHPhotoLibrary.requestAuthorization(for: .addOnly)`，只写入不读取 | 不算「收集」 |
| 通知 | `UNCalendarNotificationTrigger` 本地通知，内容在本机生成 | 不算「收集」 |
| 「给我们写信」 | 用 `mailto:` 打开用户自己的邮件 App，是否发送由用户决定 | 属于 Apple 允许不披露的「可选披露」情形：不常发生、用户自愿、发出前清楚看到要发什么，而且不用于跟踪或广告 |
| Apple 的崩溃报告 | 由 Apple 收集，用户自己选择是否和开发者共享 | 不用开发者披露 |

## 2. 逐项填写

App Store Connect 的问卷第一题是「你或你的第三方合作伙伴是否从此 App 收集数据？」→ 选 **否**。下面每一类都**不勾选**，理由如下（万一审核问起来，可以照着说明）：

| 数据类别 | 填写 | 理由 |
|---|---|---|
| 联系信息（姓名、邮箱、电话、地址、其他） | 不收集 | 没有账号、没有表单。写信是用户用自己的邮件 App 发的，属于可选披露 |
| 健康与健身 | 不收集 | 没有相关功能 |
| 财务信息 | 不收集 | 没有支付功能（以后加内购也由 Apple 处理，开发者拿不到支付信息） |
| 位置（精确、粗略） | 不收集 | 不申请定位权限 |
| 敏感信息 | 不收集 | — |
| 通讯录 | 不收集 | 不申请通讯录权限 |
| 用户内容（邮件或短信、照片或视频、音频、游戏内容、客服记录、其他用户内容） | 不收集 | 笔迹、练字图片、自己添加的字词都只存在本机。用户导出的图片和备份由用户自己发到想去的地方，开发者拿不到 |
| 浏览历史 | 不收集 | — |
| 搜索历史 | 不收集 | 「查字」在本机完成，不记录也不上传 |
| 标识符（用户 ID、设备 ID） | 不收集 | 没有账号，不读 IDFA 或 IDFV |
| 购买项目 | 不收集 | — |
| 使用数据（产品交互、广告数据、其他） | 不收集 | 存储里的 `funnel` 域只是本机计数（比如旧版迁移摘要），不会离开设备，也不在备份里 |
| 诊断（崩溃数据、性能数据、其他） | 不收集 | App 不自己上报。Apple 提供的崩溃报告由用户选择是否共享，不归开发者披露 |
| 其他数据 | 不收集 | — |
| **跟踪** | **否** | 没有广告和跨 App 跟踪，不需要请求「允许跟踪」 |

**还要填的两个地址**：
- **隐私政策网址**（必填）：把 [隐私政策.md](隐私政策.md) 发布成固定网页之后填进去。
- **用户隐私选择网址**（可选）：不填。拾字没有可以选择的数据收集，所以没有对应页面。

**以后什么情况要重新填**：加联网功能（云同步、在线更新笔顺）、接入任何统计或崩溃 SDK、加账号或内购、「考考你」分享改成经由服务器——只要有一项发生，就要重新评估这份标签，同时更新 `PrivacyInfo.xcprivacy` 和隐私政策。

## 3. PrivacyInfo.xcprivacy 核对

现在的内容（`ios/ShiziApp/ShiziApp/PrivacyInfo.xcprivacy`，已加入 Resources 构建阶段）：

```
NSPrivacyTracking            = false
NSPrivacyTrackingDomains     = []
NSPrivacyCollectedDataTypes  = []
NSPrivacyAccessedAPITypes    = []
```

| 项 | 和实际一致吗 | 说明 |
|---|---|---|
| `NSPrivacyTracking = false`，`TrackingDomains` 为空 | ✅ | 不跟踪，也不连任何域名 |
| `NSPrivacyCollectedDataTypes` 为空 | ✅ | 和「未收集数据」一致 |
| `NSPrivacyAccessedAPITypes` 为空（required-reason API，即需要声明理由的 API） | ✅ **一致** | 我逐类搜索了 4 个 Swift 文件（见下表），**Release 版本里没有调用任何需要声明理由的 API**。`01-架构设计.md` 第 284 行那句「`PrivacyInfo` 按新 API 使用补 required-reason」，核对之后的结论是「现在不需要补」 |

**需要声明理由的 API，逐类核对**：

| Apple 的分类 | 典型 API | 在 Swift 里搜到了吗 | 结论 |
|---|---|---|---|
| UserDefaults | `UserDefaults`、`@AppStorage` | 没有 | 不用声明。WKWebView 的 `localStorage` 由系统的 WebKit 管理，不属于 App 自己调用这个 API |
| 文件时间戳 | `creationDate`、`modificationDate`、`contentModificationDateKey`、`stat` / `getattrlist` | 没有。`resourceValues(forKeys: [.fileSizeKey])` 读的是**文件大小**，不在清单里；清理临时文件用的 `contentsOfDirectory(includingPropertiesForKeys: nil)` 不读时间戳 | 不用声明 |
| 系统启动时间 | `systemUptime`、`mach_absolute_time` | 没有。`ProcessInfo` 的 `thermalState`、`physicalMemory` 只出现在 DEBUG 才编译的 `NativeSmoke.swift` 里，而且也不在清单里 | 不用声明 |
| 磁盘空间 | `volumeAvailableCapacity*`、`statfs` | 没有 | 不用声明 |
| 当前键盘 | `activeInputModes` | 没有 | 不用声明 |

**以后要注意**：如果原生层开始用 `UserDefaults`（比如记住某个原生设置），要加上 `NSPrivacyAccessedAPICategoryUserDefaults`，理由码 `CA92.1`（只在本 App 内读写）；如果按修改时间清理文件，要加 `NSPrivacyAccessedAPICategoryFileTimestamp`，理由码 `C617.1`（App 容器内的文件）。建议在 `verify-archive.sh` 里加一道门禁：用 grep 检查这些 API 名称，一旦出现就提示同步更新 xcprivacy。

**其他相关项**：
- `Info.plist` 只有一项权限说明 `NSPhotoLibraryAddUsageDescription`（「用于把你保存的练字图片存进系统相册。」），和实际用到的 `.addOnly` 一致。相机用途串已删除（P100），没有其他多余的权限说明。
- 通知权限不需要写在 Info.plist 里，系统弹窗由 `requestAuthorization` 触发，时机是用户打开「提醒」开关时（P86）。
- `ITSAppUsesNonExemptEncryption = false` 和实际一致。

## 4. 关于页隐私文案（建议和标签保持一致）

商店标签写的是「未收集数据」。关于 →「隐私」里那 4 句的第 3 句是「联网只用来更新拾字和取字的笔顺」，这在 iOS 版**不成立**（iOS 版不联网），审核人员和用户都可能觉得前后矛盾。建议按平台区分文案（P21，由产品定稿），比如 iOS 版改为「拾字不联网，你的记录不会离开这台手机。」。另外加一个「完整隐私政策」入口。

---

## 附录　辅助功能标签（Accessibility Nutrition Labels）核对清单（D48）

> D48 要求**只声明真实支持的项**。下表只是「候选项 + 代码依据 + 真机怎么验证」。**真机验证通过之前一律不勾选。** Apple 对每一项都有判定标准：要求 App 的「常用任务」全部能完成，而不是部分能完成。拾字的常用任务是：首次练习、写字和判断、看结果、翻墨墙和详情、备份和恢复、设置提醒。

| 标签项 | 代码依据 | 真机怎么验证 | 初步判断 |
|---|---|---|---|
| VoiceOver | 有 aria 读屏名；`accessibility.js` 接收系统 VoiceOver 和切换控制的状态；DEVICE_QA §11 的 Q55–Q58b | 打开 VoiceOver，完整走一遍常用任务，**包括在书写格里写字**（读屏状态下怎么手写，要单独确认是否可行） | 待验证。写字这一步是核心，**写不了就不能勾选** |
| 语音控制 | 没有专门适配 | 用语音控制完成常用任务（手写这一步大概率做不到） | 预计**不勾选** |
| 更大字体 | 跟随系统的动态字体；AX1–AX5 分级取值（P186、D49）；书写格大小不随字号变（P195） | 在 AX5 档逐页检查，文字不截断、不重叠 | 有依据，**验证后可以勾选** |
| 深色界面 | `tokens.css` 跟随 `prefers-color-scheme`，也可以用 `data-theme` 强制 | 在深色模式下逐页检查 | 有依据，**验证后可以勾选** |
| 不只靠颜色区分 | 对错除了颜色还有文字（「写对了 / 写错了」） | 用灰阶滤镜逐页检查，特别是墨墙和结果页 | 待验证 |
| 足够的对比度 | 有色板 token | 用辅助功能检查器量文字对比度（≥ 4.5:1） | 待验证 |
| 减弱动态效果 | 写字页、首页、画布等有对 `prefers-reduced-motion` 的处理 | 打开「减弱动态效果」，看笔顺动画、转场等是否收敛 | 待验证 |
| 字幕 / 口述影像 | App 里没有视频 | 不适用 | 不勾选（Apple 规定没有这类媒体的 App 不声明） |
