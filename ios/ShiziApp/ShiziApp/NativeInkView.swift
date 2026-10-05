#if DEBUG
import Metal
import QuartzCore
import UIKit

// 原生书写面 spike（P1-S2；I3-13 / I2-12）：叠在 WKWebView 上、与网页书写格同位置同尺寸的原生书写层。
//
// 管线（规格 §7）：UITouch（合并点 coalescedTouches + 预测点 predictedTouches；Pencil 时 force / altitude）
//   → 原始点（345 单位格、ms = UITouch.timestamp × 1000、p 仅 Pencil）
//   → CADisplayLink（preferredFrameRateRange 最高 120）每帧：InkModel.analyze(final: false, predicted:) → geometry → 三角形
//   → Metal：CAMetalLayer 直接呈现（不经 WKWebView），4×MSAA；所有三角形同一墨色、不混合地写入 = 规格 §4.2 的「并集」语义
//      （重叠处颜色相同，非零规则自然成立），MSAA resolve 得到预乘 alpha 的抗锯齿边。
//   抬笔：final = true 的终态几何立即替换书写中的预混态（规格 §7.4 的 70ms 补间本 spike 未做），原始点交给页面（NativeInkSpike）。
// 已完成的笔（页面同步来的 + 刚抬笔、页面还没确认的）各自缓存一份顶点缓冲，只在变化时重算；每帧只重算正在写的一笔。
// 飞白、洇墨、纸纹调制、湿墨变干本 spike 未实现（只验证形状、跟手与延迟）。
//
// 测量（T1）：每个合并点记 touch 时间戳 → 首次包含它的那一帧的 CADisplayLink.targetTimestamp 与 drawable 的 presentedTime，
//   见 NativeInkLatency；导出 JSON 由 NativeInkSpike 负责。

/// 书写面回调（NativeInkSpike 实现：转成页面消息）。
protocol NativeInkViewDelegate: AnyObject {
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval)
    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint])
    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String)
    func nativeInkRequestsExport(_ view: NativeInkView)
}

/// 一笔已算好的几何（三角形顶点，345 单位）。
final class NativeInkStrokeMesh {
    let raw: [InkRawPoint]
    let vertices: [Float]
    var buffer: MTLBuffer?

    init(raw: [InkRawPoint], vertices: [Float]) {
        self.raw = raw
        self.vertices = vertices
    }

    var vertexCount: Int { vertices.count / 2 }

    /// 剖面 → 三角形（每个多边形从第 0 个顶点做扇形三角化；规格里的多边形都是凸的或以中心为扇心）。
    static func triangles(_ geom: InkGeometry, into out: inout [Float]) {
        for poly in geom.polys where poly.count >= 3 {
            let a = poly[0]
            for i in 1..<(poly.count - 1) {
                let b = poly[i], c = poly[i + 1]
                out.append(Float(a.x)); out.append(Float(a.y))
                out.append(Float(b.x)); out.append(Float(b.y))
                out.append(Float(c.x)); out.append(Float(c.y))
            }
        }
    }

    static func build(raw: [InkRawPoint], params: InkParams) -> NativeInkStrokeMesh {
        let profile = InkModel.analyze(raw, final: true, params: params)
        var v: [Float] = []
        triangles(InkModel.geometry(profile), into: &v)
        return NativeInkStrokeMesh(raw: raw, vertices: v)
    }
}

/// Metal 渲染器：一条管线、4×MSAA，画进 CAMetalLayer 的 drawable。
final class NativeInkRenderer {
    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private var msaa: MTLTexture?
    static let sampleCount = 4

    struct Uniforms {
        var scale: SIMD2<Float>
        var offset: SIMD2<Float>
        var color: SIMD4<Float>
    }

    /// 345 单位 → 归一化设备坐标；y 向下。整笔一个 uniform（落定原型里用它把墨缩放 / 平移到别处）。
    static func uniforms(color: SIMD4<Float>, rectInView: CGRect = .zero, viewSize: CGSize = .zero) -> Uniforms {
        if rectInView == .zero || viewSize == .zero {
            return Uniforms(scale: SIMD2(2 / 345, -2 / 345), offset: SIMD2(-1, 1), color: color)
        }
        // 把 345 单位格映射到 view 内的 rectInView（pt），再到 NDC
        let sx = Float(rectInView.width / 345) * 2 / Float(viewSize.width)
        let sy = Float(rectInView.height / 345) * 2 / Float(viewSize.height)
        let ox = Float(rectInView.minX) * 2 / Float(viewSize.width) - 1
        let oy = 1 - Float(rectInView.minY) * 2 / Float(viewSize.height)
        return Uniforms(scale: SIMD2(sx, -sy), offset: SIMD2(ox, oy), color: color)
    }

    private static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;
    struct U { float2 scale; float2 offset; float4 color; };
    struct VOut { float4 pos [[position]]; };
    vertex VOut ink_vs(uint vid [[vertex_id]], const device float2 *v [[buffer(0)]], constant U &u [[buffer(1)]]) {
      VOut o; float2 p = v[vid];
      o.pos = float4(p.x * u.scale.x + u.offset.x, p.y * u.scale.y + u.offset.y, 0.0, 1.0);
      return o;
    }
    fragment float4 ink_fs(VOut in [[stage_in]], constant U &u [[buffer(1)]]) { return u.color; }
    """

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.queue = queue
        do {
            // 运行时编译着色器：spike 不往工程里加 .metal 构建规则，Release 也不会带上它
            let library = try device.makeLibrary(source: Self.shaderSource, options: nil)
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = library.makeFunction(name: "ink_vs")
            desc.fragmentFunction = library.makeFunction(name: "ink_fs")
            desc.colorAttachments[0].pixelFormat = .bgra8Unorm
            desc.colorAttachments[0].isBlendingEnabled = false // 并集：同色覆盖即可，不混合
            desc.rasterSampleCount = Self.sampleCount
            pipeline = try device.makeRenderPipelineState(descriptor: desc)
        } catch {
            NSLog("[shizi] native-ink Metal pipeline failed: %@", error.localizedDescription)
            return nil
        }
    }

    struct Batch {
        let vertices: [Float]?
        let buffer: MTLBuffer?
        let count: Int
        let uniforms: Uniforms
    }

    func makeBuffer(_ vertices: [Float]) -> MTLBuffer? {
        guard !vertices.isEmpty else { return nil }
        return vertices.withUnsafeBytes { device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }
    }

    /// 画一帧并呈现。presented 在 drawable 真正上屏时回调（模拟器上可能拿不到，返回 0）。
    @discardableResult
    func render(layer: CAMetalLayer, batches: [Batch], presented: ((CFTimeInterval) -> Void)?) -> Bool {
        guard let drawable = layer.nextDrawable() else { return false }
        let tex = drawable.texture
        if msaa == nil || msaa!.width != tex.width || msaa!.height != tex.height {
            let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: tex.width, height: tex.height, mipmapped: false)
            d.textureType = .type2DMultisample
            d.sampleCount = Self.sampleCount
            d.usage = .renderTarget
            #if targetEnvironment(simulator)
            d.storageMode = .private
            #else
            d.storageMode = .memoryless
            #endif
            msaa = device.makeTexture(descriptor: d)
        }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = msaa
        pass.colorAttachments[0].resolveTexture = tex
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        pass.colorAttachments[0].storeAction = .multisampleResolve
        guard let cb = queue.makeCommandBuffer(), let enc = cb.makeRenderCommandEncoder(descriptor: pass) else { return false }
        enc.setRenderPipelineState(pipeline)
        for b in batches where b.count > 0 {
            var u = b.uniforms
            if let buf = b.buffer {
                enc.setVertexBuffer(buf, offset: 0, index: 0)
            } else if let v = b.vertices {
                if v.count * 4 <= 4096 {
                    v.withUnsafeBytes { enc.setVertexBytes($0.baseAddress!, length: $0.count, index: 0) }
                } else if let buf = makeBuffer(v) {
                    enc.setVertexBuffer(buf, offset: 0, index: 0)
                } else { continue }
            } else { continue }
            enc.setVertexBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
            enc.setFragmentBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
            enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: b.count)
        }
        enc.endEncoding()
        #if !targetEnvironment(simulator)
        // presentedTime：这一帧真正上屏的时刻（模拟器 SDK 没有这个 API，模拟器上只有 targetTimestamp）
        if let presented {
            drawable.addPresentedHandler { d in presented(d.presentedTime) }
        }
        #endif
        cb.present(drawable)
        cb.commit()
        return true
    }
}

/// T1 测量：触点（UITouch.timestamp）→ 首次上屏的帧。
final class NativeInkLatency {
    struct Sample {
        var touch: CFTimeInterval // UITouch.timestamp（s，与 CACurrentMediaTime 同一时基）
        var delivered: CFTimeInterval // 主线程拿到这个事件的时刻
        var predictedUsed: Bool = false
        var frame: Int = -1
    }

    struct Frame {
        var callback: CFTimeInterval // CADisplayLink 回调里开始画的时刻
        var target: CFTimeInterval // CADisplayLink.targetTimestamp：这一帧预计上屏的时刻
        var presented: CFTimeInterval = 0 // drawable presentedTime（真机才有；模拟器多为 0）
        var cpuMs: Double
        var samples: Int
    }

    private(set) var samples: [Sample] = []
    private(set) var frames: [Frame] = []
    private(set) var frameDurations: [Double] = [] // 每次回调的 targetTimestamp − timestamp（ms）：显示刷新间隔
    private var pending: [Int] = [] // 还没上屏的样本下标
    var strokes = 0
    let startedAt = Date()

    func touch(_ t: CFTimeInterval, delivered: CFTimeInterval) {
        pending.append(samples.count)
        samples.append(Sample(touch: t, delivered: delivered))
    }

    func tick(duration: CFTimeInterval) {
        if frameDurations.count < 20000 { frameDurations.append(duration * 1000) }
    }

    /// 这一帧画进了此前所有待上屏的样本。返回帧序号（交给 presented 回调）。
    func frame(callback: CFTimeInterval, target: CFTimeInterval, cpuMs: Double) -> Int {
        let id = frames.count
        frames.append(Frame(callback: callback, target: target, cpuMs: cpuMs, samples: pending.count))
        for i in pending { samples[i].frame = id }
        pending.removeAll()
        return id
    }

    func presented(frame id: Int, at t: CFTimeInterval) {
        guard id >= 0, id < frames.count else { return }
        frames[id].presented = t
    }

    func dropPending() { pending.removeAll() }

    static func stats(_ xs: [Double]) -> [String: Any] {
        guard !xs.isEmpty else { return ["n": 0] }
        let s = xs.sorted()
        func q(_ p: Double) -> Double { s[min(s.count - 1, max(0, Int((Double(s.count - 1) * p).rounded())))] }
        let r3 = { (x: Double) in (x * 1000).rounded() / 1000 }
        return ["n": s.count, "p50": r3(q(0.5)), "p95": r3(q(0.95)), "min": r3(s[0]), "max": r3(s[s.count - 1]), "mean": r3(s.reduce(0, +) / Double(s.count))]
    }

    var summary: [String: Any] {
        var toTarget: [Double] = [], toPresented: [Double] = [], toCallback: [Double] = [], delivery: [Double] = []
        for smp in samples where smp.frame >= 0 {
            let f = frames[smp.frame]
            toTarget.append((f.target - smp.touch) * 1000)
            toCallback.append((f.callback - smp.touch) * 1000)
            delivery.append((smp.delivered - smp.touch) * 1000)
            if f.presented > 0 { toPresented.append((f.presented - smp.touch) * 1000) }
        }
        var touchIntervals: [Double] = []
        for i in 1..<max(1, samples.count) {
            let d = (samples[i].touch - samples[i - 1].touch) * 1000
            if d > 0, d < 50 { touchIntervals.append(d) } // 同一笔内相邻合并点
        }
        return [
            "touchToTargetMs": Self.stats(toTarget),
            "touchToPresentedMs": Self.stats(toPresented),
            "touchToRenderCallbackMs": Self.stats(toCallback),
            "touchDeliveryMs": Self.stats(delivery),
            "frameCpuMs": Self.stats(frames.map(\.cpuMs)),
            "displayFrameMs": Self.stats(frameDurations),
            "touchSampleIntervalMs": Self.stats(touchIntervals),
            "strokes": strokes,
            "samples": samples.count,
            "frames": frames.count,
        ]
    }

    /// 原始记录（最多最近 3000 个样本）：[touch, delivered, frameCallback, frameTarget, framePresented]（s，CACurrentMediaTime 时基）。
    var rawRecords: [[Double]] {
        samples.suffix(3000).compactMap { smp in
            guard smp.frame >= 0 else { return nil }
            let f = frames[smp.frame]
            return [smp.touch, smp.delivered, f.callback, f.target, f.presented]
        }
    }
}

final class NativeInkView: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    var metalLayer: CAMetalLayer { layer as! CAMetalLayer } // swiftlint:disable:this force_cast

    weak var delegate: NativeInkViewDelegate?
    let renderer: NativeInkRenderer
    let latency = NativeInkLatency()
    var params = InkParams.default

    /// 墨色（预乘前，0–1）与整体不透明度（页面固化层 opacity）。
    var inkColor = SIMD4<Float>(0.231, 0.184, 0.157, 1) { didSet { needsRender = true } }
    var inkOpacity: Float = 1 { didSet { needsRender = true } }
    /// 页面说此刻能不能落笔（不能时触摸穿透给网页）。
    var drawable = true { didSet { isUserInteractionEnabled = drawable; if !drawable { cancelStroke(reason: "reset", notify: true) } } }

    private(set) var pageStrokes: [NativeInkStrokeMesh] = [] // 页面确认过的笔
    private(set) var pendingStrokes: [NativeInkStrokeMesh] = [] // 已抬笔、页面还没同步回来的笔
    private var pendingSince: CFTimeInterval = 0

    private var current: UITouch?
    private var raw: [InkRawPoint] = []
    private var predicted: [InkRawPoint] = []
    private var liveVertices: [Float] = []
    private var liveDirty = false
    private(set) var needsRender = true
    private var link: CADisplayLink?
    var lastFrameCpuMs = 0.0
    /// 落定原型等外部动画每帧追加的绘制（返回 nil 表示动画结束）。
    var overlayFrame: ((CFTimeInterval) -> [NativeInkRenderer.Batch]?)?
    /// 每帧画完后的钩子（落定原型用来在「第一帧」同帧发触觉）。
    var afterFrame: ((CFTimeInterval) -> Void)?

    init?(frame: CGRect, renderer: NativeInkRenderer) {
        self.renderer = renderer
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isMultipleTouchEnabled = true
        // 读屏：本 spike 不做原生读屏元素，网页书写格（role=img + 标签）仍是读屏看到的那个；直通（allowsDirectInteraction）留到阶段 2。
        isAccessibilityElement = false
        let ml = metalLayer
        ml.device = renderer.device
        ml.pixelFormat = .bgra8Unorm
        ml.framebufferOnly = true
        ml.isOpaque = false
        ml.presentsWithTransaction = false
        ml.maximumDrawableCount = 3
        contentScaleFactor = UIScreen.main.scale

        let export = UITapGestureRecognizer(target: self, action: #selector(handleExportTap(_:)))
        export.numberOfTouchesRequired = 2
        export.numberOfTapsRequired = 2
        addGestureRecognizer(export)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { link?.invalidate() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.scale ?? UIScreen.main.scale
        let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
        if metalLayer.drawableSize != size {
            metalLayer.drawableSize = size
            needsRender = true
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil, link == nil {
            let l = CADisplayLink(target: NativeInkWeakTarget(self), selector: #selector(NativeInkWeakTarget.tick(_:)))
            // ProMotion：请求 120Hz（需要 Info.plist CADisableMinimumFrameDurationOnPhone，DEBUG + SHIZI_NATIVE_INK_120HZ 构建时由同步脚本加上）
            l.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
            l.add(to: .main, forMode: .common)
            link = l
        } else if window == nil {
            link?.invalidate()
            link = nil
        }
    }

    @objc private func handleExportTap(_ g: UITapGestureRecognizer) {
        if g.state == .ended { delegate?.nativeInkRequestsExport(self) }
    }

    // MARK: 页面同步来的笔

    /// 页面的 strokes（按顺序）。与已有的对比：页面多出来的笔若正是待确认的笔，直接挪过来（不重算）；否则重建。
    func syncPageStrokes(_ strokes: [[InkRawPoint]]) {
        let oldCount = pageStrokes.count
        var next: [NativeInkStrokeMesh] = []
        var pend = pendingStrokes
        for (i, s) in strokes.enumerated() {
            if i < pageStrokes.count, Self.sameStroke(pageStrokes[i].raw, s) {
                next.append(pageStrokes[i])
            } else if let first = pend.first, Self.sameShape(first.raw, s) {
                next.append(first)
                pend.removeFirst()
            } else {
                next.append(NativeInkStrokeMesh.build(raw: s, params: params))
            }
        }
        pageStrokes = next
        // 页面已经收下的待确认笔从 pending 去掉；页面把笔数减少（撤销 / 清空 / 换字）时 pending 全清
        pendingStrokes = strokes.count < oldCount || strokes.isEmpty ? [] : pend
        needsRender = true
    }

    /// 同一笔（页面那份时间做过时基换算，只比位置与点数）。
    static func sameShape(_ a: [InkRawPoint], _ b: [InkRawPoint]) -> Bool {
        guard a.count == b.count, let fa = a.first, let fb = b.first, let la = a.last, let lb = b.last else { return false }
        return abs(fa.x - fb.x) < 1e-3 && abs(fa.y - fb.y) < 1e-3 && abs(la.x - lb.x) < 1e-3 && abs(la.y - lb.y) < 1e-3
    }

    static func sameStroke(_ a: [InkRawPoint], _ b: [InkRawPoint]) -> Bool { sameShape(a, b) }

    // MARK: 触摸

    private func gridPoint(_ t: UITouch) -> InkRawPoint {
        let loc = t.preciseLocation(in: self)
        let w = max(1, bounds.width), h = max(1, bounds.height)
        var q = InkRawPoint(x: Double(loc.x) * 345 / Double(w), y: Double(loc.y) * 345 / Double(h), t: t.timestamp * 1000)
        if t.type == .pencil {
            if t.maximumPossibleForce > 0 {
                let p = Double(t.force / t.maximumPossibleForce)
                if p > 0 { q.p = min(1, p) }
            }
            q.alt = Double(t.altitudeAngle) * 180 / Double.pi
        }
        return q
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard drawable, current == nil, let t = touches.first else { return }
        // 只认第一根落下的触点；第二根手指 / 手掌在这一笔期间一律忽略（规格 §2.1 掌托的接触面积 / 静止判定留到阶段 2）
        current = t
        let now = CACurrentMediaTime()
        raw = [gridPoint(t)]
        predicted = []
        latency.touch(t.timestamp, delivered: now)
        liveDirty = true
        needsRender = true
        delegate?.nativeInkDidBeginStroke(self, at: t.timestamp)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = current, touches.contains(t) else { return }
        let now = CACurrentMediaTime()
        let co = event?.coalescedTouches(for: t) ?? [t]
        for c in co {
            raw.append(gridPoint(c))
            latency.touch(c.timestamp, delivered: now)
        }
        predicted = (event?.predictedTouches(for: t) ?? []).map(gridPoint)
        liveDirty = true
        needsRender = true
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = current, touches.contains(t) else { return }
        let co = event?.coalescedTouches(for: t) ?? []
        for c in co where c.timestamp * 1000 > (raw.last?.t ?? 0) { raw.append(gridPoint(c)) }
        let end = gridPoint(t)
        if let last = raw.last, end.x != last.x || end.y != last.y { raw.append(end) }
        let stroke = raw
        current = nil
        raw = []
        predicted = []
        liveVertices = []
        let mesh = NativeInkStrokeMesh.build(raw: stroke, params: params)
        pendingStrokes.append(mesh)
        pendingSince = CACurrentMediaTime()
        latency.strokes += 1
        needsRender = true
        delegate?.nativeInkDidEndStroke(self, raw: stroke)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = current, touches.contains(t) else { return }
        cancelStroke(reason: "cancel", notify: true)
    }

    /// 丢弃正在写的一笔（不固化、不计笔数）。notify：是否告诉页面（页面自己发起的取消不回告）。
    func cancelStroke(reason: String, notify: Bool) {
        guard current != nil else { return }
        current = nil
        raw = []
        predicted = []
        liveVertices = []
        latency.dropPending()
        needsRender = true
        if notify { delegate?.nativeInkDidCancelStroke(self, reason: reason) }
    }

    var isWriting: Bool { current != nil }

    // MARK: 每帧

    fileprivate func tick(_ link: CADisplayLink) {
        latency.tick(duration: link.targetTimestamp - link.timestamp)
        let extra = overlayFrame?(link.targetTimestamp)
        if overlayFrame != nil, extra == nil { overlayFrame = nil; needsRender = true }
        guard needsRender || liveDirty || extra != nil else { return }
        let callback = CACurrentMediaTime()
        if liveDirty, !raw.isEmpty {
            let profile = InkModel.analyze(raw, final: false, predicted: predicted, params: params)
            var v: [Float] = []
            v.reserveCapacity(liveVertices.count + 64)
            NativeInkStrokeMesh.triangles(InkModel.geometry(profile), into: &v)
            liveVertices = v
        }
        liveDirty = false
        let a = inkOpacity
        let color = SIMD4<Float>(inkColor.x * a, inkColor.y * a, inkColor.z * a, a)
        let u = NativeInkRenderer.uniforms(color: color)
        var batches: [NativeInkRenderer.Batch] = []
        for m in pageStrokes + pendingStrokes {
            if m.buffer == nil { m.buffer = renderer.makeBuffer(m.vertices) }
            batches.append(.init(vertices: nil, buffer: m.buffer, count: m.vertexCount, uniforms: u))
        }
        if !liveVertices.isEmpty {
            batches.append(.init(vertices: liveVertices, buffer: nil, count: liveVertices.count / 2, uniforms: u))
        }
        if let extra { batches.append(contentsOf: extra) }
        let cpu = (CACurrentMediaTime() - callback) * 1000
        lastFrameCpuMs = cpu
        let frameId = latency.frame(callback: callback, target: link.targetTimestamp, cpuMs: cpu)
        let lat = latency
        let ok = renderer.render(layer: metalLayer, batches: batches) { t in
            DispatchQueue.main.async { lat.presented(frame: frameId, at: t) }
        }
        needsRender = !ok
        afterFrame?(link.targetTimestamp)
        // 页面迟迟没同步回来（例如这一笔被页面丢弃）：2s 后不再显示待确认的笔
        if !pendingStrokes.isEmpty, current == nil, CACurrentMediaTime() - pendingSince > 2 {
            pendingStrokes = []
            needsRender = true
        }
    }

    /// 渲染当前内容到一张 UIImage（截图对照用：CAMetalLayer 不进 snapshotView）。
    func requestRender() { needsRender = true }
}

/// CADisplayLink 强引用 target：用弱引用中转，视图释放后 link 失效。
final class NativeInkWeakTarget: NSObject {
    weak var view: NativeInkView?
    init(_ view: NativeInkView) { self.view = view }
    @objc func tick(_ link: CADisplayLink) {
        guard let view else { link.invalidate(); return }
        view.tick(link)
    }
}
#endif
