# M0-7 · iOS 模块加载与手势 spike · 记录

开发代理：Opus 5.5（high）。分支 `v10/integration`，HEAD `b3ff2df` + 未提交工作区（M0-1…M0-7 并行改动）。日期 2026-09-30。

依据：02 §2 M0-7；01 §7（Swift 是边缘返回手势唯一所有者、进度事件、`backGestureEnabled`）、§8.1、§8.2、§6.3。

## 1. 环境

| 项 | 值 |
|---|---|
| Xcode | 26.6（17F113） |
| Simulator | iPhone 17 Pro，iOS 26.5（23F77），UDID 89702053-…；视口 402×874 pt，dpr 3 |
| 构建 | `xcodebuild -scheme Shizi -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build` |
| 启动 | `xcrun simctl launch <udid> com.eimaa.shizi -shizi-dev`（Swift 追加 `?dev=1`，打开色板页和本卡的 spike 块） |
| 触摸注入 | iOS Simulator MCP 的 `touch_path` 需要用户在面板里授权，本次授权请求没有得到回应。改用一个临时 XCUITest 工程（放在 scratchpad，不提交），通过 `XCUIApplication(bundleIdentifier:"com.eimaa.shizi")` 驱动已安装的 App，用 `XCUICoordinate.press(forDuration:thenDragTo:withVelocity:thenHoldForDuration:)` 合成单指触摸 |
| 原生日志 | `xcrun simctl spawn <udid> log show --predicate 'eventMessage CONTAINS "[shizi]"'`（DEBUG 构建下 Swift 会用 NSLog 记录 gate 变化，以及手势的 began/ended/refused） |
| Chromium 对照 | Playwright 1.62，chromium_headless_shell-1243，393×852，`python3 -m http.server` |

没有找到 393×852 的机型（本机 iPhone 17/17 Pro 都是 402 宽）。所以 spike 块把 345 书写格的左缘**固定在 x=24pt**，也就是原型 393 宽机型上格居中时的位置。这比在 402 宽机型上居中（28.5pt）更靠边，条件更严格。

## 2. 模块加载 / localStorage / deck / MIME（Simulator，真实路径）

截图：`M0-7-0-start.png`（?dev=1 面板）、`M0-7-shell-home.png`（不带 dev 启动，三个 tab 的空壳）。

| 检查 | 结果 | 证据 |
|---|---|---|
| `type=module` 加载 | 通过：app.js 用 import 加载 palette.js 和 pointer-stats.js 并完成渲染；不带 dev 启动时 router 与三个 tab 正常挂载 | 两张截图 |
| localStorage 可写 | 通过：写入、读回、删除 `__shizi_spike_m07` 都成功 | 面板 `localStorage: ok` |
| deck 全局可读 | 通过：`SEED=7294 GROUPS=7294 CONTEXT_OVERRIDES=384 FSRS=object HanziWriter=function` | 面板 `deck:` 行 |
| woff2 MIME | 通过：`fonts/_spike.woff2 → 200 font/woff2 179840B`，`FontFace` 解码成功，样张用该字体渲染 | 面板 `mime:` 行 |
| 对照 MIME | `src/app.js → text/javascript; charset=utf-8`，`src/config/tokens.css → text/css; charset=utf-8` | 同上 |
| 原生壳识别 | `nativeShell=true href=shizi-resource://app/index.html?dev=1` | 面板 `shell:` 行 |

`fonts/_spike.woff2` 来自 `git show origin/pr-180:handoff/r8-foundation/fonts/assets/ShiziSerifSC-Regular.woff2`。验证完已删除，并重新跑了 `pnpm run build:manifest`，清单里已经没有这个文件。

## 3. 指针统计（`?dev=1` spike 块）

统计规则：从第一次 pointerdown 开始计 2 秒的墙钟窗口。「move 频率」= 窗口内的 pointermove 数 ÷ 窗口内手指按下的时长。「采样」= 所有 `getCoalescedEvents()` 返回的点数之和。「pressure 非零」只统计窗口内的 pointermove。

| 环境 | 用例 | move 频率 | 含 coalesced 的采样率 | coalesced>1 的 move | pressure 非零 | pointerType |
|---|---|---|---|---|---|---|
| Simulator（合成触摸） | D：斜线 140pt/s，持续 3s，取前 2s | 58.5 Hz（117/2000ms） | 58.5 Hz | 0 | 0%（值恒为 0.000） | touch |
| Simulator（合成触摸） | A：横线 300pt/s | 42.4 Hz（48/1133ms） | 56.5 Hz（64） | 14/48 | 0% | touch |
| Simulator（合成触摸） | A2：横线 600pt/s，起笔即拖 | 45.5 Hz（25/550ms） | 61.8 Hz（34） | 9/25 | 0% | touch |
| Chromium（Playwright 鼠标） | 横线 60 步 | 59.4 Hz | 59.4 Hz | 0 | 100%（恒为 0.5） | mouse |

结论与限制：
- WKWebView 支持 `getCoalescedEvents`，而且确实会合并：快速书写时约 1/3 的 move 带多个点，采样率稳定在约 60Hz。
- 在 WKWebView 里，手指 touch 的 `pressure` 恒为 0，不是 0.5。所以 01 §6.2「只有真实压力才走压感分支」可以直接用 `pointerType==='pen'` 判断，和 C-ink.md 第 15 条一致。
- 这些频率是 Simulator 合成事件的节奏，不代表真机的 120Hz ProMotion 或 Apple Pencil 240Hz。真机数值要留到 M7 真机清单再测。

## 4. 手势用例（Simulator，XCUITest 合成触摸）

Swift 改动：给边缘识别器加上 delegate，由 `gestureRecognizerShouldBegin` 按 `backGestureEnabled` 决定是否开始；每个阶段都派发 `shizi-native-back-progress {phase, translationX, progress, velocityX}`，达到阈值（位移超过 24% 宽或速度超过 650）时再派发 `shizi-native-back`。页面在书写格 pointerdown 时经 bridge 发 `backGestureEnabled(false)`，pointerup、pointercancel 或中途丢失捕获时发 `true`。

| # | 设置 | 操作 | 页面结果（面板） | 原生日志 | 结论 | 截图 |
|---|---|---|---|---|---|---|
| A | 格左缘 24，门控开，preventDefault 开 | x=26 起笔写横，按 0.05s，300pt/s | 一笔完整（pointerup），cancel=0，跨度 2→306，原生 back=0、progress=0 | gate false→true；无 began | **通过**：不触发返回，笔画完整 | `M0-7-A-x26-gate-on.png` |
| A2 | 同 A | x=26 起笔即拖，600pt/s | 一笔完整，cancel=0，back=0 | gate false→true；无 began | 通过 | `M0-7-A2-x26-gate-on-fast.png` |
| B | 格左缘 24，**门控关** | x=26 起笔，300pt/s | 一笔完整，back=0 | 无 began | 对照：x=26 本来就不在合成触摸的边缘识别区内 | `M0-7-B-x26-gate-off.png` |
| C | 门控开，格外 | x=0 起，边缘右滑 260pt | down=0；原生 began=1 changed=40 ended=1 back=1，translationX=248 | began/ended | 对照：识别器工作正常，进度事件和 back 事件都送到了页面 | `M0-7-C-edge-swipe-x0.png` |
| H | **格贴左缘 x=0**，门控开，preventDefault 开 | x=0 起笔写横 | 一笔完整，back=0 | gate false→true；无 began、无 refused | 通过（压力用例） | `M0-7-H-grid0-x0-gate-on.png` |
| I | 格贴左缘，**门控关**，preventDefault 开 | x=0 起笔写横 | 一笔完整，back=0 | 无 began | 见下面的「发现 1」 | `M0-7-I-grid0-x0-gate-off.png` |
| J | 格贴左缘，门控关，**preventDefault 关** | x=0 起笔写横 | 一笔完整，pointercancel=0，**但原生 back=1**（began/ended 都有） | began/ended | 归因：页面不拦默认行为时，识别器会在书写的同时触发返回 | `M0-7-J-grid0-x0-nopd-gate-off.png` |
| K | 格贴左缘，**门控开**，preventDefault 关 | x=0 起笔，按 0.1s | 一笔完整，back=0 | `backGestureEnabled=false` 之后 184ms 记到 `native back gesture refused` | **门控生效**：shouldBegin 拒绝了识别 | `M0-7-K-grid0-x0-nopd-gate-on.png` |
| K2 | 同 K | x=0 起笔即拖，600pt/s | 一笔完整，back=0 | gate false→true；无 began、无 refused | 没有结论：合成触摸在 press=0 时本身就不进识别区（与 E2 相同） | 未存 |

边缘识别区探测（格外，门控开，合成触摸，y=250）：起点 x=0（按 0.1s）识别；x=1（按 0，1000pt/s）未识别；x=3（按 0.05s）识别；x=10、16、20 都未识别；用 normalized dx=0 起划可以识别。所以**合成触摸的边缘识别区不到 10pt**。真机手指的接触半径更大，系统边缘区也可能更宽，需要真机复测。

### 发现

1. **页面对 touchstart/pointerdown 调用 `preventDefault` 时，在 Simulator 上原生边缘识别器根本不会开始**（I：门控关也没有 began，shouldBegin 甚至没有被调用）。推测原因是 WebKit 的 deferring gesture recognizer：页面处理掉触摸后，挂在 WKWebView 上的其他识别器会失败。M1-1 书写格按 C-ink 的现有做法会 preventDefault，所以这一层本身就是一道保护。但它依赖 WebKit 的内部行为，**门控仍然必须保留**。
2. **识别器触发时，WebKit 不会给页面的笔发 pointercancel**（J：back 和 pointerup 同时发生，笔画完整）。也就是说，如果门控漏掉，用户会一边写一边被带走，01 §6.3 的「pointercancel 即中断」也接不到这个信号。**M1 书写页不能只靠 pointercancel 发现手势冲突，门控必须在 pointerdown 同步发送。**
3. 门控的时序：K 用例里 postMessage 比 shouldBegin 早到 184ms。但那次按住了 0.1s。「落指即快速拖」的最坏时序在 Simulator 上合成不出来（K2 连识别区都没进），**需要真机验证**。如果真机出现竞态，可以改为书写页挂载时就发 false、离开时发 true。这要改 01 §7 的语义，已写进待定项。
4. 在 x=26（格左缘 24）起笔，即使门控关掉，合成触摸也碰不到识别区（B）。这与 F-platform.md 第 14 条「格不在边缘识别区」的判断一致。

## 5. `verify-local.sh`

`RUN_SMOKE=0 bash ios/ShiziApp/scripts/verify-local.sh` 的退出码是 **1**。plist/sh lint、治理、vector440、content、assets、sw-unit 都通过；**卡在 `Verify PWA corpus upgrade`**（`verify_pwa_upgrade.js`：激活的 worker 没有让旧客户端跳转，120s 超时）。这是已知的红项，原因是 `sw.js` SHELL 还列着根目录的 vendor 文件，归 M5-1。

脚本在 PWA 之后的步骤我逐条手动跑了一遍，结果全部通过：`git diff --check`（0）、`xcodebuild -list`（0）、Debug Simulator 构建（0）、`verify-bundle-assets.sh`（0，shell-manifest 7369 个文件，data JSON 7295 个）、Release iPhoneOS 无签名 archive（0）、`verify-archive.sh`（0）。冒烟（`RUN_SMOKE=1`）没有跑：Swift 内嵌的旧 smoke 脚本依赖 v9 的全局名，M5-3 会重写。

## 6. 复现

```
git show origin/pr-180:handoff/r8-foundation/fonts/assets/ShiziSerifSC-Regular.woff2 > fonts/_spike.woff2
pnpm run build:manifest
xcodebuild -project ios/ShiziApp/ShiziApp.xcodeproj -scheme Shizi -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath <dd> CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot <udid>; xcrun simctl install <udid> <dd>/Build/Products/Debug-iphonesimulator/Shizi.app
xcrun simctl launch <udid> com.eimaa.shizi -shizi-dev
# 手势：在 Simulator 窗口里用鼠标按格左缘拖动；或者用 XCUITest（下面是要点）
rm fonts/_spike.woff2 && pnpm run build:manifest
```

XCUITest 要点：UI-testing bundle 不设 TEST_TARGET_NAME，`XCUIApplication(bundleIdentifier:)` 加 `launchArguments=["-shizi-dev"]`。坐标用 `app.coordinate(withNormalizedOffset:.zero).withOffset(dx,dy)`，单位 pt，等于 CSS px。按钮用 `app.webViews.buttons` 按 label 前缀找：门控、清零、格左缘/格贴左缘、touch preventDefault。

## 7. 未覆盖

- 真机：边缘识别区宽度、「落指即拖」下门控的时序、ProMotion 与 Pencil 的采样率和压力，都要在 M7 真机清单里测。
- 跟手转场：root.js 已经在消费 progress 事件，但 dev 面板不在 router 栈里，所以这次只验证了事件送达（C/J），没有验证页面栈动画。
- `shizi-native-back` 在 tab 根页和阻断页不开始（01 §7）：需要页面在这些状态发 `backGestureEnabled(false)`，由 M0-4 的 root 和 M5 接入，本卡只提供了 bridge 接口。
