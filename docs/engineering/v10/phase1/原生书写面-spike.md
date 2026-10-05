# 原生书写面 spike（P1-S2）

> 阶段 2 的入场券（审查 I3-13 / I2-12）。2026-10-05，分支 `v10/integration` 之上的 spike 提交（`feat(s2-spike):`）。
> 规格：[笔锋模型规格](笔锋模型规格.md)（ink-model-1.0）、时刻编排 ② M23（Claude Design「拾字设计系统」moments/moments.js）。
> 真机步骤：[ios/ShiziApp/DEVICE_QA.md §13f](../../../../ios/ShiziApp/DEVICE_QA.md)。截图、录屏与模拟器数据：`.review/s2-spike/`（不入库）。

## 1. 结构

- **开关**：只在 Debug 构建；启动参数 `-shizi-native-ink`（或 `SHIZI_NATIVE_INK=1`），默认关。关着时网页书写与正式包完全相同；Release 产物里没有任何 spike 代码（`#if DEBUG`，`verify-archive.sh` / `verify_assets.mjs` 查标记）。
- **层次**：`WKWebView`（页面照旧）之上叠一个原生 `NativeInkView`（`CAMetalLayer`），位置与尺寸 = 写字页书写格的当前笔层画布。页面每个 rAF 量一次 `getBoundingClientRect`，变化时发 `nativeInk op:'rect'`（含显隐：格子被弹层盖住、页面隐藏、组件卸载即隐藏），所以滚动、转场、弹层都靠这一路同步。网页的两层画布在开关开时隐藏、指针输入不落笔。
- **触摸**：`UITouch` 合并点（`coalescedTouches`）全部进原始点，预测点（`predictedTouches`）只画在这一帧；Pencil 时取 `force / maximumPossibleForce` 与 `altitudeAngle`；手指不写 p（规格 §1）。只认第一根落下的触点。
- **绘制**：`CADisplayLink`（`preferredFrameRateRange` 60–120，偏好 120）每帧对正在写的一笔跑 `InkModel.analyze(final:false, predicted:)` → `geometry` → 扇形三角化；已完成的笔各自缓存一份顶点缓冲。Metal 4×MSAA，所有三角形同一墨色、**不混合**地写入：重叠处颜色相同，正好就是规格 §4.2 的「非零并集」，MSAA resolve 给出预乘 alpha 的抗锯齿边。着色器运行时编译（工程里不加 .metal 构建规则）。
- **数据回写**：抬笔 → `window.shiziNativeInk({kind:'end', raw:[[x, y, t, p?]…], nowNative})`；页面把原生时基换算到 `performance.now`，走与网页 `onUp` 相同的路径（`painted` 追加、`paintFinal`、`onStrokeEnd` → 写字页 `store.commit`）。`kind:'start'` 照网页 `acceptFrom` 语义持笔（换字后 250ms 内落笔不丢）；`kind:'cancel'` 对应 `pointercancel`。页面 `strokes` 变化时全量 `op:'strokes'` 回原生（撤销、清空、换字、刷新恢复），页面丢弃正在写的一笔时 `op:'cancel'`。
- **判断落定原型**（M23 的最小子集）：点「写对了 / 写错了」时页面把上格与页头计数的位置发给原生 `op:'settle'`；原生另起一层画本人笔迹：0–100ms 离纸 1→.97，100–460ms 按 `cubic-bezier(.5,0,.15,1)` 收进 14pt 计数，380–460ms 淡出；`Impact medium 0.7` 在第一帧的同一个 `CADisplayLink` 回调里发，440ms `Selection`。减少动态效果时原地淡出 150ms、触觉照发。写错的朱点、计数翻动、最后一字的「归位成帖」（M5）不在本原型里。

| 文件 | 内容 |
|---|---|
| `ios/ShiziApp/ShiziApp/InkModel.swift` | reference.mjs 逐函数移植（纯 Foundation） |
| `ios/ShiziApp/ShiziApp/InkModelCheck.swift` | check.mjs 断言与 I1–I10 移植 + 与参考实现逐值比较 |
| `ios/ShiziApp/ShiziApp/NativeInkView.swift` | 触摸、显示链接、Metal 渲染、T1 计时 |
| `ios/ShiziApp/ShiziApp/NativeInkSpike.swift` | 壳侧消息、叠层、导出、自检入口、落定原型、T2 参数组 |
| `src/ui/canvas/native-ink.js` | 网页侧接线（ink-canvas.js 只多几行） |
| `docs/…/ink-model/dump-reference.mjs` → `out/reference-dump.json` | 参考实现输出摘要（给原生逐值比对） |
| `ios/ShiziApp/scripts/ink-model-check.sh` | macOS 上 swiftc 直接跑同一份 Swift 自检 |

## 2. 金标准一致性

`ios/ShiziApp/scripts/ink-model-check.sh`（macOS）与 App 内 `-shizi-ink-selfcheck`（iPhone 17 模拟器，结果写 `Documents/shizi-ink-selfcheck.json`）结果相同：

- check.mjs 同口径 **314 条断言全部通过**（20 条向量 + I1–I10；I4 前缀稳定按规格 §8.4 放宽到 1e-4，实际 ≤ 1e-6 也过）。
- 与 reference.mjs 逐值比较 40 条路径（每条向量 final 一次 + 前 60% 点 `final:false` 一次）：u = 0…1 每 0.01 的宽度最大差 **5.0e-11**（345 单位），并集面积最大相对差 **4.4e-12**，弧长最大差 4.8e-10；样本数、多边形数、端帽、钩、折角数、v30、洇墨数**全部一致，0 处不一致**。
- 差异来源只有 libm 与 V8 的末位舍入。

## 3. 模拟器上的数字（iPhone 17 模拟器，Debug，60Hz；**不代表真机**）

| 量 | p50 | p95 | 说明 |
|---|---|---|---|
| 触点 → 帧预计上屏（targetTimestamp） | 8.95 ms | 15.8 ms | 182 个合并点 / 3 笔 |
| 触点 → 渲染回调开始 | 10.0 ms | 16.9 ms | 模拟器的显示链接回调晚于 targetTimestamp，说明这里的时钟关系与真机不同 |
| 触点 → 主线程收到事件 | 9.9 ms | 16.8 ms | 注入触点本身就有约 10ms 投递延迟 |
| 每帧 CPU（分析 + 几何 + 编码） | 2.2 ms | 4.7 ms | Debug（-Onone，热路径 `@_optimize(speed)`）；macOS -O 下同一管线约 0.13–0.17 ms/帧 |
| 显示刷新间隔 | 16.7 ms | 16.7 ms | 模拟器只有 60Hz |
| `presentedTime` | — | — | 模拟器 SDK 没有 `addPresentedHandler`，真机才有 |

结论只能是「管线通了、每帧计算在预算内」。T1 的判定（与备忘录相差 ≤ 1 帧）必须真机 240fps 录像，见 DEVICE_QA §13f NI-2。

## 4. 已知风险与没做的

1. **转场**：「写好了 → 对照」时页面的交叉淡化快照里没有墨（网页画布是隐藏的），现在由原生层在同样 150ms 里原地淡出，然后对照页的网页墨淡入——不是规格 ① 的共享元素缩放，阶段 2 要由原生同一层把墨缩进上格。最后一字的落定原型会和结果页的作品同时出现（M5 归位成帖未做）。
2. **滚动 / 布局变化**：位置靠页面每帧轮询同步，原生层比页面晚 ≤ 1 帧；书写中格子尺寸变化时这一笔丢弃（与 pointercancel 同语义）。写字页本身不滚动，AX 档整页可滚时尚未在真机上看。
3. **遮挡判定**：用 `elementFromPoint` 查格子中心与四角，弹层盖住任一点就隐藏原生层；半透明遮罩、只盖一角的提示条会让整层隐藏。
4. **键盘**：写字页没有输入框；若将来同页出现键盘，原生层不会自动避让，只靠 rect 同步。
5. **读屏**：原生层 `isAccessibilityElement = false`，VoiceOver 仍读网页书写格；`allowsDirectInteraction` 直接书写、每笔播报未做（阶段 2 2b）。读屏下请关开关。
6. **抬笔**：终态几何直接替换书写中的预混态（规格 §7.4 的 70ms 补间未做），快写时末端会有一次小变化；飞白、洇墨、纸纹、湿墨变干未实现。
7. **性能**：每帧对正在写的整笔重算（没做 §7.2 前缀冻结的增量）；Debug 构建下长笔（V10 横折，367 单位）每帧约 2.3ms（Mac），iPhone 13 估计 3–4ms，60Hz 够、120Hz 偏紧——真机 `frameCpuMs.p95` 超过 4ms 时先做前缀冻结。
8. **掌托**：只认第一根触点，没有接触面积 / 静止判定（T10）。
9. **墨色**：用页面 `--hand` 现值；网页对照卡、字墙、结果页仍是网页旧墨，开关开时同一个字在书写格与对照卡是两种墨（便于对照，也是阶段 2 要统一的）。
10. **PencilKit 对照**未做（I3-13 的第三个开关）；T2 只备了 A/B/C 三组参数（`-shizi-native-ink-preset`）。
