#if DEBUG
import UIKit
import WebKit

// 原生书写面 spike 的壳侧接线（P1-S2；I3-13 / I2-12）。只在 DEBUG 编译，默认关闭。
// B2.1 起书写面本身（NativeInkView / InkModel）是 Release 组件；这里只剩 spike 专用的网页叠层、量测导出、落定原型与 T2 参数组。
//
// 开关：DEBUG 启动参数 -shizi-native-ink（或环境变量 SHIZI_NATIVE_INK=1）。开启时：
//   1. 文档开始注入 window.__shiziNativeInk = true；页面 src/ui/canvas/native-ink.js 据此接管写字页的书写格（网页画布隐藏、不再落笔）。
//   2. 页面每帧把书写格的 rect / 显隐 / 能否落笔 / 墨色 / 不透明度发来（nativeInk op:'rect'），本类把 NativeInkView 作为 WKWebView 的
//      子视图叠到同一位置（页面坐标 = WKWebView 坐标：scrollView 不缩放、contentInset 为 0）；不可见时隐藏并丢弃正在写的一笔。
//   3. op:'strokes'：页面的全量原始笔 → 原生重画已完成的笔。op:'cancel'：页面丢弃正在写的一笔。
//   4. 抬笔：shiziNativeInk({kind:'end', raw:[[x, y, t, p?]…], nowNative}) → 页面照常 onStrokeEnd → store.commit。
//   5. op:'settle'：判断落定原型（时刻编排 ② M23）——本人笔迹从对照上格「离纸」并收进页头计数，触觉与第一帧同帧。
//   6. T1 测量：每笔后把延迟统计写 Documents/shizi-native-ink-latency.json 并打印 p50 / p95；书写格上两指双击 → 分享面板导出这份 JSON。
// 另有 -shizi-ink-selfcheck：启动时对包内 InkModel/vectors.json 跑笔锋模型金标准自检（InkModelCheck），结果写 Documents/shizi-ink-selfcheck.json。
// 参数组（T2 盲测用）：-shizi-native-ink-preset A|B|C（A = ink-model-1.0 默认；B 弱方向、弱顿；C 强方向、长出锋），见 NativeInkSpike.preset。

final class NativeInkSpike: NSObject {
    static var enabled: Bool {
        let p = ProcessInfo.processInfo
        return p.arguments.contains("-shizi-native-ink") || p.environment["SHIZI_NATIVE_INK"] == "1"
    }

    static var selfCheckRequested: Bool {
        let p = ProcessInfo.processInfo
        return p.arguments.contains("-shizi-ink-selfcheck") || p.environment["SHIZI_INK_SELFCHECK"] == "1"
    }

    static var presetName: String {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-shizi-native-ink-preset"), i + 1 < args.count { return args[i + 1].uppercased() }
        return ProcessInfo.processInfo.environment["SHIZI_NATIVE_INK_PRESET"]?.uppercased() ?? "A"
    }

    /// T2 盲测的 2–3 套笔模型（规格 §3.11 标「T2」的参数）。A 是 ink-model-1.0 默认值（与金标准向量绑定）。
    static func preset(_ name: String) -> InkParams {
        var k = InkParams.default
        switch name {
        case "B": // 更接近等宽硬笔：方向因子与起收笔都减弱
            k.dirH = 0.82; k.dirV = 1.06; k.entryPeak = 1.2; k.stopPeak = 1.1; k.endFast = 0.2; k.vMin = 0.72
        case "C": // 更「楷」：横竖对比更强、出锋更长
            k.dirH = 0.66; k.dirV = 1.18; k.entryPeak = 1.45; k.tapLenMax = 40; k.endFast = 0.08; k.vMin = 0.58
        default:
            break
        }
        return k
    }

    static let latencyFileName = "shizi-native-ink-latency.json"

    private weak var controller: WebViewController?
    private var webView: WKWebView? { controller?.webView }
    private var ink: NativeInkView?
    private var settleView: NativeInkView?
    private lazy var settleImpact = UIImpactFeedbackGenerator(style: .medium)
    private lazy var settleSelection = UISelectionFeedbackGenerator()
    private var lastSaved = Date.distantPast

    init(controller: WebViewController) {
        self.controller = controller
        super.init()
    }

    static func userScript() -> WKUserScript {
        WKUserScript(source: "window.__shiziNativeInk = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    // MARK: 页面消息

    func handle(_ body: [String: Any]) {
        switch body["op"] as? String ?? "" {
        case "rect": applyRect(body)
        case "strokes": syncStrokes(body["strokes"])
        case "cancel": ink?.cancelStroke(reason: body["reason"] as? String ?? "reset", notify: false)
        case "settle": settle(body)
        default: break
        }
    }

    private func ensureView() -> NativeInkView? {
        if let ink { return ink }
        guard let webView, let renderer = NativeInkRenderer(), let v = NativeInkView(frame: .zero, renderer: renderer) else { return nil }
        v.inkModel = Self.preset(Self.presetName) // spike 是 ink-model-1.0 的 T2 盲测台：产品书写面不设 inkModel
        v.delegate = self
        v.isHidden = true
        // 书写格上两指双击 → 导出 T1 量测（spike 专用；B2.1 起从书写面本身挪到这里，正式书写面不带它）
        let export = UITapGestureRecognizer(target: self, action: #selector(handleExportTap(_:)))
        export.numberOfTouchesRequired = 2
        export.numberOfTapsRequired = 2
        v.addGestureRecognizer(export)
        webView.addSubview(v)
        ink = v
        NSLog("[shizi] native-ink on: preset %@, screen max %d fps", Self.presetName, UIScreen.main.maximumFramesPerSecond)
        return v
    }

    private func applyRect(_ b: [String: Any]) {
        let visible = b["visible"] as? Bool ?? false
        guard visible else {
            if let ink, !ink.isHidden {
                ink.cancelStroke(reason: "hidden", notify: true)
                let fade = (b["fadeMs"] as? NSNumber)?.doubleValue ?? 0
                if fade > 0 { ink.fadeOutAndHide(ms: fade) } else { ink.isHidden = true }
            }
            return
        }
        guard let v = ensureView() else { return }
        let num = { (k: String) in CGFloat((b[k] as? NSNumber)?.doubleValue ?? 0) }
        let frame = CGRect(x: num("x"), y: num("y"), width: num("w"), height: num("h"))
        if v.frame != frame {
            // 书写中格子移动（转场 / 滚动）：这一笔丢弃，与网页 pointercancel 同语义
            if v.isWriting, v.frame.size != frame.size { v.cancelStroke(reason: "cancel", notify: true) }
            v.frame = frame
        }
        v.drawable = b["drawable"] as? Bool ?? true
        if let c = Self.parseColor(b["color"] as? String) { v.inkColor = c }
        v.inkOpacity = Float((b["opacity"] as? NSNumber)?.doubleValue ?? 1)
        v.cancelFade()
        if v.isHidden {
            v.isHidden = false
            v.requestRender()
        }
    }

    /// 颜色与笔画格式：B2.2 起在 Release 工具 NativeInkWire（原生写字页也用它，不再依赖本 spike）。
    static func parseColor(_ s: String?) -> SIMD4<Float>? { NativeInkWire.parseColor(s) }
    static func rawStrokes(_ any: Any?) -> [[InkRawPoint]] { NativeInkWire.rawStrokes(any) }

    private func syncStrokes(_ any: Any?) {
        guard let v = ensureView() else { return }
        v.syncPageStrokes(Self.rawStrokes(any))
    }

    private func send(_ payload: [String: Any]) {
        guard let webView, let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("if (typeof window.shiziNativeInk === 'function') window.shiziNativeInk(\(json)); void 0;")
    }

    // MARK: 判断落定原型（时刻编排 ② M23）

    /// 本人笔迹（对照上格）：t=0 离纸 1→.97（100ms）→ 收进页头计数（100–460ms，gather 曲线 cubic-bezier(.5,0,.15,1)），380–460ms 淡出；
    /// t=0 Impact medium 0.7（两种判断相同）与第一帧同帧；440ms Selection；写错时多一颗朱点（本原型只画墨，朱点留给阶段 2）。
    /// 减少动态效果：墨不飞，150ms 原地淡出，触觉照发。
    private func settle(_ b: [String: Any]) {
        guard let webView, let renderer = NativeInkRenderer() else { return }
        let strokes = Self.rawStrokes(b["strokes"])
        guard !strokes.isEmpty else { return }
        func rect(_ any: Any?) -> CGRect? {
            guard let d = any as? [String: Any] else { return nil }
            let n = { (k: String) in CGFloat((d[k] as? NSNumber)?.doubleValue ?? 0) }
            return CGRect(x: n("x"), y: n("y"), width: n("w"), height: n("h"))
        }
        guard let from = rect(b["from"]), from.width > 0 else { return }
        let to = rect(b["to"]).map { r -> CGRect in
            let s: CGFloat = 14 // 收进计数 14pt（M23 cntBox(14)）
            return CGRect(x: r.midX - s / 2, y: r.midY - s / 2, width: s, height: s)
        } ?? CGRect(x: from.midX - 7, y: from.minY - 40, width: 14, height: 14)
        let reduce = b["reduceMotion"] as? Bool ?? UIAccessibility.isReduceMotionEnabled

        settleView?.removeFromSuperview()
        guard let v = NativeInkView(frame: webView.bounds, renderer: renderer) else { return }
        v.drawable = false
        v.isUserInteractionEnabled = false
        webView.addSubview(v)
        settleView = v
        let params = ink?.inkModel ?? .default
        let meshes = strokes.map { NativeInkStrokeMesh.build(raw: $0, inkModel: params) }
        let color = ink?.inkColor ?? SIMD4<Float>(0.231, 0.184, 0.157, 1)
        let size = webView.bounds.size
        settleImpact.prepare()
        settleSelection.prepare()
        var t0: CFTimeInterval = 0
        var firedSelection = false
        func bezier(_ x: Double, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) -> Double {
            // cubic-bezier(x1, y1, x2, y2) 在 x 处的 y（二分求参数）
            var lo = 0.0, hi = 1.0, u = x
            for _ in 0..<24 {
                u = (lo + hi) / 2
                let bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
                if bx < x { lo = u } else { hi = u }
            }
            return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
        }
        func lerpRect(_ a: CGRect, _ b: CGRect, _ u: Double) -> CGRect {
            let f = CGFloat(u)
            return CGRect(x: a.minX + (b.minX - a.minX) * f, y: a.minY + (b.minY - a.minY) * f,
                          width: a.width + (b.width - a.width) * f, height: a.height + (b.height - a.height) * f)
        }
        v.overlayFrame = { target in
            if t0 == 0 { t0 = target }
            let ms = (target - t0) * 1000
            var r = from
            var alpha = 1.0
            if reduce {
                if ms > 150 { return nil }
                alpha = 1 - ms / 150
            } else {
                if ms > 460 { return nil }
                if ms < 100 {
                    let s = 1 - 0.03 * bezier(ms / 100, 0.2, 0.7, 0.2, 1)
                    r = from.insetBy(dx: from.width * (1 - s) / 2, dy: from.height * (1 - s) / 2)
                } else {
                    let start = from.insetBy(dx: from.width * 0.015, dy: from.height * 0.015)
                    r = lerpRect(start, to, bezier((ms - 100) / 360, 0.5, 0, 0.15, 1))
                }
                if ms > 380 { alpha = max(0, 1 - (ms - 380) / 80) }
            }
            let a = Float(alpha)
            let u = NativeInkRenderer.uniforms(color: SIMD4(color.x * a, color.y * a, color.z * a, a), rectInView: r, viewSize: size)
            return meshes.map { m in
                if m.buffer == nil { m.buffer = renderer.makeBuffer(m.vertices) }
                return NativeInkRenderer.Batch(vertices: nil, buffer: m.buffer, count: m.vertexCount, uniforms: u)
            }
        }
        var firstFrame = true
        v.afterFrame = { [weak self, weak v] target in
            guard let self else { return }
            if firstFrame {
                // 与「离纸」第一帧同一个 CADisplayLink 回调里发：这一帧和触觉在同一个刷新周期里到达
                firstFrame = false
                self.settleImpact.impactOccurred(intensity: 0.7)
                NSLog("[shizi] native-ink settle: impact at frame target %.4f", target)
            } else if !firedSelection, !reduce, (target - t0) * 1000 >= 440 {
                firedSelection = true
                self.settleSelection.selectionChanged()
            }
            if v?.overlayFrame == nil {
                DispatchQueue.main.async { v?.removeFromSuperview() }
            }
        }
        v.requestRender()
    }

    // MARK: 测量导出

    var latencyURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent(Self.latencyFileName)
    }

    func latencyReport() -> [String: Any] {
        var sys = utsname()
        uname(&sys)
        let model = withUnsafeBytes(of: &sys.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
        var simulator = false
        #if targetEnvironment(simulator)
        simulator = true
        #endif
        let lat = ink?.latency
        return [
            "spike": "P1-S2 native ink surface",
            "model": InkModel.version,
            "preset": Self.presetName,
            "device": model,
            "simulatorModel": ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "",
            "simulator": simulator,
            "system": UIDevice.current.systemVersion,
            "screenMaxFps": UIScreen.main.maximumFramesPerSecond,
            "requestedFps": "60–120 (preferred 120)",
            "startedAt": ISO8601DateFormatter().string(from: lat?.startedAt ?? Date()),
            "savedAt": ISO8601DateFormatter().string(from: Date()),
            "note": "touchToTarget = CADisplayLink.targetTimestamp − UITouch.timestamp（这一帧预计上屏）；touchToPresented = drawable.presentedTime − UITouch.timestamp（真机才有）；不含屏幕扫描与像素响应，T1 仍需 240fps 录像对照备忘录。模拟器数字不代表真机。",
            "summary": lat?.summary ?? [:],
            "records": lat?.rawRecords ?? [],
            "recordFields": ["touch", "delivered", "frameCallback", "frameTarget", "framePresented"],
        ]
    }

    func saveLatency(force: Bool = false) {
        guard force || Date().timeIntervalSince(lastSaved) > 0.5, let url = latencyURL else { return }
        lastSaved = Date()
        let report = latencyReport()
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: url, options: .atomic)
        }
        if let s = report["summary"] as? [String: Any], let t = s["touchToTargetMs"] as? [String: Any] {
            let p = s["touchToPresentedMs"] as? [String: Any] ?? [:]
            let c = s["frameCpuMs"] as? [String: Any] ?? [:]
            NSLog("[shizi] native-ink T1 strokes %@ samples %@ | touch→target p50 %@ p95 %@ ms | touch→presented p50 %@ p95 %@ ms | frame CPU p50 %@ p95 %@ ms",
                  "\(s["strokes"] ?? 0)", "\(s["samples"] ?? 0)", "\(t["p50"] ?? "-")", "\(t["p95"] ?? "-")",
                  "\(p["p50"] ?? "-")", "\(p["p95"] ?? "-")", "\(c["p50"] ?? "-")", "\(c["p95"] ?? "-")")
        }
    }

    func exportLatency() {
        saveLatency(force: true)
        guard let controller, controller.presentedViewController == nil, let url = latencyURL else { return }
        let share = controller.temporaryShareURL(filename: "拾字-原生书写面-T1-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.copyItem(at: url, to: share)
        let activity = UIActivityViewController(activityItems: [share], applicationActivities: nil)
        activity.completionWithItemsHandler = { [weak controller] _, _, _, _ in controller?.removeTemporaryShareFile(share) }
        if let pop = activity.popoverPresentationController {
            pop.sourceView = controller.view
            pop.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
        }
        controller.present(activity, animated: true)
    }

    // MARK: 金标准自检（-shizi-ink-selfcheck）

    static func runSelfCheck() {
        DispatchQueue.global(qos: .userInitiated).async {
            let dir = Bundle.main.url(forResource: "InkModel", withExtension: nil)
            guard let vectors = dir.flatMap({ try? Data(contentsOf: $0.appendingPathComponent("vectors.json")) }) else {
                NSLog("[shizi] ink-selfcheck: InkModel/vectors.json not bundled (Debug builds copy it in sync-web-assets.sh)")
                return
            }
            let reference = dir.flatMap { try? Data(contentsOf: $0.appendingPathComponent("reference-dump.json")) }
            let report = InkModelCheck.run(vectorsData: vectors, referenceData: reference)
            NSLog("[shizi] ink-selfcheck %@: %@", report.ok ? "OK" : "FAILED", report.summary)
            for f in report.fails.prefix(20) { NSLog("[shizi] ink-selfcheck FAIL %@", f) }
            for f in report.refMismatches.prefix(20) { NSLog("[shizi] ink-selfcheck REF %@", f) }
            if let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("shizi-ink-selfcheck.json"),
               let data = try? JSONSerialization.data(withJSONObject: report.json, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: url, options: .atomic)
            }
        }
    }
}

extension NativeInkSpike: NativeInkViewDelegate {
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval) {
        send(["kind": "start", "t": timestamp * 1000])
    }

    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint]) {
        let rows: [[Double]] = raw.map { q in
            if let p = q.p, p > 0 { return [q.x, q.y, q.t, p] }
            return [q.x, q.y, q.t]
        }
        send(["kind": "end", "raw": rows, "nowNative": CACurrentMediaTime() * 1000])
        // 让最后一帧的 presentedTime 先回来再存
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.saveLatency() }
    }

    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String) {
        send(["kind": "cancel", "reason": reason])
    }

}

extension NativeInkSpike {
    @objc fileprivate func handleExportTap(_ g: UITapGestureRecognizer) {
        if g.state == .ended { exportLatency() }
    }
}

extension WebViewController {
    /// DEBUG：原生书写面 spike 的入口（loadView 装用户脚本、viewDidLoad 跑自检、消息分发）。
    func installNativeInkUserScriptIfNeeded(_ controller: WKUserContentController) {
        guard NativeInkSpike.enabled else { return }
        controller.addUserScript(NativeInkSpike.userScript())
    }

    func startNativeInkSpikeIfNeeded() {
        if NativeInkSpike.selfCheckRequested { NativeInkSpike.runSelfCheck() }
        guard NativeInkSpike.enabled, nativeInkSpike == nil else { return }
        nativeInkSpike = NativeInkSpike(controller: self)
    }

    func handleNativeInkMessage(_ body: [String: Any]) {
        nativeInkSpike?.handle(body)
    }
}
#endif
