import Metal
import QuartzCore
import UIKit

// 原生书写面（B2.1 转正：Release 组件；docs/engineering/v10/B2-原生写字架构.md §6；规格 docs/engineering/v10/phase1/笔锋模型规格.md）。
//
// 管线（输入沿规格 §7；墨的几何见下）：UITouch（合并点 coalescedTouches + 预测点 predictedTouches；Pencil 时 force / altitude）
//   → 原始点（345 单位格、ms = UITouch.timestamp × 1000、p 仅 Pencil；时间戳不单调时夹到前一点，规格 §2.1）
//   → CADisplayLink（preferredFrameRateRange 最高 120）每帧：WebInk.buildStroke(原始点 + 预测点, final: false) → 三角形
//      （R11-A，D72 ②：墨与网页同一算法 ink-math.js buildStroke + brush.js 画法，参数由页面随 open 下发；ink-model-1.0 / InkModel
//       只留作 T2 盲测候选，见 inkModel）
//   → Metal：CAMetalLayer 直接呈现，4×MSAA；墨的三角形同一墨色、不混合地写入 = 规格 §4.2 的「并集」（重叠处颜色相同，非零规则自然成立），
//      MSAA resolve 得到预乘 alpha 的抗锯齿边。悬停预览点另一条混合管线叠在最上面（半透明，不落墨）。
//   抬笔：final = true 的终态几何替换书写中的预混态（规格 §7.4 的 70ms 补间在后续卡），原始点交给代理（写字页 → 页面 store.commit）。
// 已完成的笔（代理同步来的 + 刚抬笔、代理还没同步回来的）各自缓存一份顶点缓冲，只在变化时重算；每帧只重算正在写的一笔。
//
// 输入（D32；规格 §2.1；本文件的 NativeInkInputPolicy / NativeInkPencilAction 是可单测的纯逻辑）：
//   - Apple Pencil：压力（force / maximumPossibleForce）与倾角（altitudeAngle）进原始点；悬停（UIHoverGestureRecognizer，iPadOS 16.1+ zOffset > 0）
//     在笔尖下方画落笔预览点（直径 0.9 × B × F_p(0.35)，不落墨、不存）；双击（UIPencilInteraction）按系统偏好映射成「清空 / 撤销」交给代理。
//   - 手指与 Pencil 同时出现（写字时手掌误触）：见 NativeInkInputPolicy——Pencil 优先、Pencil 刚用过时手指不落墨、大接触面积 / 静止的手指判为手掌。
//   - 换字落笔门限（P227，acceptFrom）：门限之前落下的笔先「持住」——照常记点，但不画、不通知；到点补开始并接着实时画，抬笔早于门限时整笔
//     等到门限再交出——这一笔不丢（与网页 ink-canvas.js 同语义）。门限 = .infinity 表示「等下一个字」（判断回包前落下的笔）。
//   - 书写中书写面移动 / 改尺寸（换阶段、换字的版式变化）：已记的点按屏幕位置换算到新格，笔不断、不丢（T0 规则 3：这次输入照常生效）。
// 测量（T1，只在 DEBUG）：每个合并点记 touch 时间戳 → 首次包含它的那一帧的 targetTimestamp / presentedTime（NativeInkLatency）。

/// 书写面回调（原生写字页实现；DEBUG 的 spike 叠层 NativeInkSpike 也实现）。
protocol NativeInkViewDelegate: AnyObject {
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval)
    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint])
    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String)
    /// Apple Pencil 双击（按系统偏好映射后的动作）。
    func nativeInk(_ view: NativeInkView, didRequest action: NativeInkPencilAction)
}

extension NativeInkViewDelegate {
    func nativeInk(_ view: NativeInkView, didRequest action: NativeInkPencilAction) {}
}

// MARK: - Pencil 双击

/// Apple Pencil 双击的动作（D32；架构 §6 第 2 条「按系统偏好映射到撤销或清空」）。
enum NativeInkPencilAction: String, Equatable {
    /// 撤销最后一笔（与格下「撤销」同一个动作）。
    case undo
    /// 清空格子（与格下「清空」同一个动作；清空后可撤销一次，所以误触双击也找得回来）。
    case clear

    /// 系统偏好（设置 › Apple Pencil › 双击）→ 动作：
    ///   「切换到橡皮擦」→ 清空（书写格没有橡皮工具，擦掉格子是它最近的意思；可撤销一次）；
    ///   「切换到上一个工具」→ 撤销（回到上一步）；
    ///   「关闭」、调色板 / 墨水属性 / 情境调板（这页没有调板）、系统快捷指令（由系统执行）→ 不做任何事。
    static func forTap(_ preferred: UIPencilPreferredAction) -> NativeInkPencilAction? {
        switch preferred {
        case .switchEraser: return .clear
        case .switchPrevious: return .undo
        default: return nil
        }
    }
}

// MARK: - 手指与 Pencil：落笔判定（纯逻辑）

/// 哪一个触点是「写字的那一个」（规格 §2.1：本模型只接受一路 touch 流；被判为手掌的 touch 不得进入 move，判定被推翻时发 cancel）。
///
/// 规则（时间单位 s，与 UITouch.timestamp 同一时基；长度单位 pt）：
///   1. 同一时刻只写一笔；一笔进行中其余触点一律忽略——唯一例外：手指在写时 Pencil 落下，手指那笔取消（多半是掌托 / 握笔的手指），改写 Pencil 这笔。
///   2. Pencil 刚用过时手指不落墨：Pencil 正在写，或上一次 Pencil 接触（落笔、移动、抬笔、悬停）在 pencilGrace 秒之内；
///      系统「只用 Apple Pencil 绘图」打开时（UIPencilInteraction.prefersPencilOnlyDrawing），这块书写面上用过 Pencil 之后手指一直不落墨。
///   3. 手掌（只在这块书写面上用过 Pencil 之后生效，D71 ②：iPhone 没有 Pencil，大拇指接触半径常到 20–40pt，按半径判手掌会把大拇指的笔吞掉；
///      网页书写面没有手掌规则）：手指接触半径 ≥ palmRadius 直接不落墨；落笔后半径涨到 ≥ palmRadius，或半径 ≥ palmSuspectRadius 且最初 palmStill 秒内
///      几乎没动（< palmStillDistance）——判为手掌，这一笔取消（不固化、不计笔数）。
///   4. 手指只在没用过 Pencil（或已过 pencilGrace、且没开「只用 Apple Pencil 绘图」）时写字：iPhone（没有 Pencil）上手指照常写，规则 2 不生效。
struct NativeInkInputPolicy {
    enum Kind: Equatable { case pencil, finger }
    enum Begin: Equatable {
        case accept
        /// Pencil 落下，取消正在写的手指那笔后接受。
        case preempt
        case reject(String)
    }

    static let pencilGrace: TimeInterval = 1.5
    static let palmRadius: CGFloat = 30
    static let palmSuspectRadius: CGFloat = 20
    static let palmStill: TimeInterval = 0.12
    static let palmStillDistance: CGFloat = 2

    var pencilOnly = false
    private(set) var pencilSeen = false
    private(set) var lastPencilAt: TimeInterval = -.infinity

    /// Pencil 的任何接触（落笔、移动、抬笔、悬停）。
    mutating func notePencil(at t: TimeInterval) {
        pencilSeen = true
        lastPencilAt = max(lastPencilAt, t)
    }

    /// 新触点落下时的判定。active：正在写的那一笔是谁（没有为 nil）。
    func begin(kind: Kind, majorRadius: CGFloat, at t: TimeInterval, active: Kind?) -> Begin {
        if kind == .pencil {
            switch active {
            case .finger?: return .preempt
            case .pencil?: return .reject("busy")
            case nil: return .accept
            }
        }
        if active != nil { return .reject("busy") }
        if pencilOnly && pencilSeen { return .reject("pencil-only") }
        if t - lastPencilAt < Self.pencilGrace { return .reject("pencil-recent") }
        if pencilSeen && majorRadius >= Self.palmRadius { return .reject("palm") }
        return .accept
    }

    /// 手指那笔写着写着判为手掌（规则 3）：maxRadius = 落笔以来最大接触半径，moved = 离落笔点的最远距离（pt），elapsed = 落笔以来的秒数。
    func isPalm(kind: Kind, maxRadius: CGFloat, moved: CGFloat, elapsed: TimeInterval) -> Bool {
        guard kind == .finger, pencilSeen else { return false }
        if maxRadius >= Self.palmRadius { return true }
        return maxRadius >= Self.palmSuspectRadius && elapsed >= Self.palmStill && moved < Self.palmStillDistance
    }
}

// MARK: - 几何

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

    /// 一笔抬笔后的几何（R11-A，D72 ②）：网页同一算法 WebInk.buildStroke(final: true) → brush.js 同一画法的三角形。
    /// params 为 nil（页面还没下发 ink 表）时没有几何——书写面只在写字页 open 之后存在，open 一定带 ink（契约 test/ui/native-write.test.mjs）。
    static func build(raw: [InkRawPoint], params: WebInkParams?, widthScale: Double = 1) -> NativeInkStrokeMesh {
        var v: [Float] = []
        if let params {
            var pts = WebInk.buildStroke(raw, final: true, params: params).points
            // B2.7：小方框里的只读墨（结果页作品格 / 行）按网页 paintHand 的 widthScale 抬到最小物理线宽（core/images/layout.js inkWidthScale）
            if widthScale != 1 { pts = pts.map { var q = $0; q.w *= widthScale; return q } }
            WebInk.triangles(pts, into: &v)
        }
        return NativeInkStrokeMesh(raw: raw, vertices: v)
    }

    /// ink-model-1.0 的几何（T2 盲测候选，不在产品路径上：只有 DEBUG 的 NativeInkSpike 经 NativeInkView.inkModel 用到）。
    static func build(raw: [InkRawPoint], inkModel params: InkParams) -> NativeInkStrokeMesh {
        let profile = InkModel.analyze(raw, final: true, params: params)
        var v: [Float] = []
        triangles(InkModel.geometry(profile), into: &v)
        return NativeInkStrokeMesh(raw: raw, vertices: v)
    }

    /// 书写中的一笔（final = false）：已记的原始点 + 这一帧的预测点（只做临时尾巴，下一帧丢弃；时间夹成单调）。
    static func live(raw: [InkRawPoint], predicted: [InkRawPoint], params: WebInkParams, into out: inout [Float]) {
        var pts = raw
        for q in predicted { NativeInkView.append(q, to: &pts) }
        WebInk.triangles(WebInk.buildStroke(pts, final: false, params: params).points, into: &out)
    }

    /// 实心圆（扇形三角化，345 单位）。
    static func disc(x: Double, y: Double, radius r: Double, segments n: Int = 32) -> [Float] {
        var v: [Float] = []
        v.reserveCapacity(n * 6)
        for i in 0..<n {
            let a0 = Double(i) / Double(n) * 2 * Double.pi, a1 = Double(i + 1) / Double(n) * 2 * Double.pi
            v += [Float(x), Float(y), Float(x + r * cos(a0)), Float(y + r * sin(a0)), Float(x + r * cos(a1)), Float(y + r * sin(a1))]
        }
        return v
    }

    /// 悬停预览点的直径（345 单位）：Pencil 轻落（p = 0.35）的单点直径 = single × base × 压力因子（网页同一算法的单点口径）。
    static func hoverDotDiameter(_ k: WebInkParams) -> Double { k.single * k.base * WebInk.pressureFactor(0.35, k) }
}

// MARK: - 渲染

/// Metal 渲染器：4×MSAA，画进 CAMetalLayer 的 drawable。两条管线：墨（不混合 = 并集）与叠加（预乘 alpha 混合：悬停预览点）。
final class NativeInkRenderer {
    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let blendPipeline: MTLRenderPipelineState
    private var msaa: MTLTexture?
    static let sampleCount = 4

    struct Uniforms {
        var scale: SIMD2<Float>
        var offset: SIMD2<Float>
        var color: SIMD4<Float>
    }

    /// 345 单位 → 归一化设备坐标；y 向下。rectInView 非零时把 345 单位格映射到 view 内的这块矩形（pt）。
    static func uniforms(color: SIMD4<Float>, rectInView: CGRect = .zero, viewSize: CGSize = .zero) -> Uniforms {
        if rectInView == .zero || viewSize == .zero {
            return Uniforms(scale: SIMD2(2 / 345, -2 / 345), offset: SIMD2(-1, 1), color: color)
        }
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
            // 着色器随源码编译（两个函数、几十字节；工程里不加 .metal 构建规则，构建机不需要单独的 Metal 工具链）
            let library = try device.makeLibrary(source: Self.shaderSource, options: nil)
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = library.makeFunction(name: "ink_vs")
            desc.fragmentFunction = library.makeFunction(name: "ink_fs")
            desc.colorAttachments[0].pixelFormat = .bgra8Unorm
            desc.colorAttachments[0].isBlendingEnabled = false // 并集：同色覆盖即可，不混合
            desc.rasterSampleCount = Self.sampleCount
            pipeline = try device.makeRenderPipelineState(descriptor: desc)
            let att = desc.colorAttachments[0]!
            att.isBlendingEnabled = true // 叠加：预乘 alpha 的 source-over
            att.sourceRGBBlendFactor = .one
            att.sourceAlphaBlendFactor = .one
            att.destinationRGBBlendFactor = .oneMinusSourceAlpha
            att.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            blendPipeline = try device.makeRenderPipelineState(descriptor: desc)
        } catch {
            NSLog("[shizi] ink surface: Metal pipeline failed: %@", error.localizedDescription)
            return nil
        }
    }

    struct Batch {
        let vertices: [Float]?
        let buffer: MTLBuffer?
        let count: Int
        let uniforms: Uniforms
        var blend = false
    }

    func makeBuffer(_ vertices: [Float]) -> MTLBuffer? {
        guard !vertices.isEmpty else { return nil }
        return vertices.withUnsafeBytes { device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }
    }

    /// 画一帧并呈现。presented 在 drawable 真正上屏时回调（模拟器上拿不到）。
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
        var blending = false
        enc.setRenderPipelineState(pipeline)
        for b in batches where b.count > 0 {
            if b.blend != blending {
                blending = b.blend
                enc.setRenderPipelineState(blending ? blendPipeline : pipeline)
            }
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
        if let presented {
            drawable.addPresentedHandler { d in presented(d.presentedTime) }
        }
        #endif
        cb.present(drawable)
        cb.commit()
        return true
    }
}

// MARK: - 书写面

@objc(ShiziNativeInkView)
final class NativeInkView: UIView {
    /// 墨的算法与参数（R11-A，D72 ②）：与网页同一算法 WebInk（= ink-math.js buildStroke），参数是页面随 open 下发的 ink 表
    /// （policy.ink + INK_SPEC，WebInkParams.current），不在原生写数值。取代 D71 ① 的 ink-model-1.0 参数（base 13 / vMin 0.62 / dirH 0.72）。

    override class var layerClass: AnyClass { CAMetalLayer.self }
    var metalLayer: CAMetalLayer { layer as! CAMetalLayer } // swiftlint:disable:this force_cast

    weak var delegate: NativeInkViewDelegate?
    let renderer: NativeInkRenderer
    var params: WebInkParams? = WebInkParams.current {
        didSet { if params != oldValue { rebuildMeshes() } }
    }
    /// B2.7：只读墨的线宽倍数（画墨接口 NativeInkPaint 设；书写面恒为 1）。
    var widthScale: Double = 1 {
        didSet { if widthScale != oldValue { rebuildMeshes() } }
    }
    /// T2 盲测候选（DEBUG 的 NativeInkSpike 设）：非 nil 时改用 ink-model-1.0 画；产品路径（写字页 / 判断页）不设。
    var inkModel: InkParams? {
        didSet { rebuildMeshes() }
    }
    var inputPolicy = NativeInkInputPolicy()

    /// 墨色（预乘前，0–1）与整体不透明度。
    var inkColor = SIMD4<Float>(0.231, 0.184, 0.157, 1) { didSet { needsRender = true } }
    var inkOpacity: Float = 1 { didSet { needsRender = true } }
    /// 此刻能不能落笔（不能时触摸穿透给下层）。改成不能时丢弃正在写的一笔与持住的笔。
    var drawable = true {
        didSet {
            isUserInteractionEnabled = drawable
            if !drawable {
                cancelStroke(reason: "reset", notify: true)
                heldDone = []
                hideHover()
            }
        }
    }
    /// 换字落笔门限（CACurrentMediaTime / UITouch.timestamp 时基，s；P227）。之前落下的笔先持住、到点补画；.infinity = 等下一个字。
    var acceptFrom: CFTimeInterval = 0 { didSet { needsRender = true } }

    private(set) var pageStrokes: [NativeInkStrokeMesh] = [] // 代理确认过的笔
    private(set) var pendingStrokes: [NativeInkStrokeMesh] = [] // 已抬笔、代理还没同步回来的笔
    private var pendingSince: CFTimeInterval = 0

    // 正在写的一笔
    private var current: ObjectIdentifier? // 写字的那一个触点
    private var currentKind: NativeInkInputPolicy.Kind = .finger
    private var raw: [InkRawPoint] = []
    private var predicted: [InkRawPoint] = []
    private var held = false // 门限之前落下：记点但不画、不通知
    private var heldStartedAt: TimeInterval = 0
    private var heldDone: [[InkRawPoint]] = [] // 门限之前已经抬笔的笔，到点整笔交出
    private var palm = (start: CGPoint.zero, maxRadius: CGFloat(0), moved: CGFloat(0), startedAt: TimeInterval(0))
    private var liveVertices: [Float] = []
    private var liveDirty = false
    private(set) var needsRender = true
    private var link: CADisplayLink?
    var lastFrameCpuMs = 0.0

    // 悬停预览点（345 单位；nil = 不画）
    private var hoverPoint: (x: Double, y: Double)?
    private var hoverRecognizer: UIHoverGestureRecognizer?
    private var pencilInteraction: UIPencilInteraction?

    /// 外部动画每帧追加的绘制（返回 nil 表示动画结束）：判断落定 M23（NativeSettle，B2.5 起是产品功能，B3.1 进 Release）与 spike 叠层的落定原型。
    var overlayFrame: ((CFTimeInterval) -> [NativeInkRenderer.Batch]?)?
    /// 每帧画完后的钩子（判断落定在「第一帧」同帧发触觉，F1）。
    var afterFrame: ((CFTimeInterval) -> Void)?
    #if DEBUG
    /// T1 测量（DEBUG）：触点 → 帧预计上屏 / 真正上屏。
    var latency = NativeInkLatency()
    private var fade: (start: CFTimeInterval, ms: Double, from: Float)?
    /// 每一笔的结局（DEBUG，R10-A：笔画「写完消失」排查）：began / ended / held / cancel:<原因> / refused:<原因>，最近 64 条。
    /// 探针（QAProbe native.inkLog）与控制台（[shizi] ink …）都看得到。
    private(set) var strokeLog: [String] = []
    func logStroke(_ e: String) {
        strokeLog.append(e)
        if strokeLog.count > 64 { strokeLog.removeFirst(strokeLog.count - 64) }
        NSLog("[shizi] ink %@", e)
    }
    #endif

    init?(frame: CGRect, renderer: NativeInkRenderer) {
        self.renderer = renderer
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isMultipleTouchEnabled = true
        let ml = metalLayer
        ml.device = renderer.device
        ml.pixelFormat = .bgra8Unorm
        ml.framebufferOnly = true
        ml.isOpaque = false
        ml.presentsWithTransaction = false
        ml.maximumDrawableCount = 3
        contentScaleFactor = UIScreen.main.scale

        // Apple Pencil：悬停预览（iPadOS 16.1+，zOffset）与双击（按系统偏好映射）
        let hover = UIHoverGestureRecognizer(target: self, action: #selector(handleHover(_:)))
        addGestureRecognizer(hover)
        hoverRecognizer = hover
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
        pencilInteraction = pencil
        if #available(iOS 14.0, *) { inputPolicy.pencilOnly = UIPencilInteraction.prefersPencilOnlyDrawing }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 建一个书写面（自带渲染器）；Metal 不可用时 nil。@objc：Release 可执行文件里书写面整条管线（渲染器与着色器；笔锋模型由每帧的
    /// tick 调用）随它保留，不因暂时没有 Release 调用方被优化掉（verify-archive.sh 查 ShiziNativeInkView 与着色器 ink_vs）。
    @objc static func make(frame: CGRect) -> NativeInkView? {
        guard let renderer = NativeInkRenderer() else { return nil }
        return NativeInkView(frame: frame, renderer: renderer)
    }

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

    /// 书写中书写面移动 / 改尺寸：已记的点按屏幕位置换算到新格（笔不断，T0 规则 3）。
    override var frame: CGRect {
        didSet { if frame != oldValue { remapStrokeInProgress(from: oldValue, to: frame) } }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil, link == nil {
            let l = CADisplayLink(target: NativeInkWeakTarget(self), selector: #selector(NativeInkWeakTarget.tick(_:)))
            // ProMotion：请求 120Hz（需要 Info.plist CADisableMinimumFrameDurationOnPhone）
            l.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
            l.add(to: .main, forMode: .common)
            link = l
        } else if window == nil {
            link?.invalidate()
            link = nil
        }
    }

    // MARK: 代理同步来的笔

    /// 代理的 strokes（按顺序）。与已有的对比：多出来的笔若正是待确认的笔，直接挪过来（不重算）；否则重建。
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
                next.append(mesh(s))
            }
        }
        pageStrokes = next
        // 代理已经收下的待确认笔从 pending 去掉；笔数减少（撤销 / 清空 / 换字）时 pending 全清
        let nextPending = strokes.count < oldCount || strokes.isEmpty ? [] : pend
        #if DEBUG
        if nextPending.count < pend.count { logStroke("pending-cleared \(pend.count) by sync(\(strokes.count))") }
        #endif
        pendingStrokes = nextPending
        needsRender = true
    }

    /// 一笔的几何（产品：网页同一算法；inkModel 设了时用 ink-model-1.0）。
    func mesh(_ raw: [InkRawPoint]) -> NativeInkStrokeMesh {
        if let k = inkModel { return NativeInkStrokeMesh.build(raw: raw, inkModel: k) }
        return NativeInkStrokeMesh.build(raw: raw, params: params, widthScale: widthScale)
    }

    /// 参数变了（页面重新同步下发新表 / 换笔模型）：已画的笔按新参数重算。
    private func rebuildMeshes() {
        pageStrokes = pageStrokes.map { mesh($0.raw) }
        pendingStrokes = pendingStrokes.map { mesh($0.raw) }
        liveDirty = !raw.isEmpty
        needsRender = true
    }

    /// 同一笔（只比位置与点数：页面那份可能做过时基换算）。
    static func sameShape(_ a: [InkRawPoint], _ b: [InkRawPoint]) -> Bool {
        guard a.count == b.count, let fa = a.first, let fb = b.first, let la = a.last, let lb = b.last else { return false }
        return abs(fa.x - fb.x) < 1e-3 && abs(fa.y - fb.y) < 1e-3 && abs(la.x - lb.x) < 1e-3 && abs(la.y - lb.y) < 1e-3
    }

    static func sameStroke(_ a: [InkRawPoint], _ b: [InkRawPoint]) -> Bool { sameShape(a, b) }

    // MARK: 点处理（纯函数，可单测）

    /// 一个触点采样 → 原始点（规格 §1）：位置按格边长换算到 345 单位；t = timestamp × 1000；p 只在 Pencil（force / maximumPossibleForce，
    /// ≤ 0 不写）；倾角只在 Pencil（度）。手指一律不写 p（即便 force > 0），保证手指笔迹在各机型一致。
    static func rawPoint(location: CGPoint, size: CGSize, timestamp: TimeInterval, pencil: Bool, force: CGFloat, maximumPossibleForce: CGFloat, altitude: CGFloat) -> InkRawPoint {
        let w = max(1, Double(size.width)), h = max(1, Double(size.height))
        var q = InkRawPoint(x: Double(location.x) * 345 / w, y: Double(location.y) * 345 / h, t: timestamp * 1000)
        if pencil {
            if maximumPossibleForce > 0 {
                let p = Double(force / maximumPossibleForce)
                if p > 0 { q.p = min(1, p) }
            }
            q.alt = Double(altitude) * 180 / Double.pi
        }
        return q
    }

    /// 追加原始点（规格 §2.1：时间戳不单调时夹到前一点时间，再由 InkModel.prepare 按零时间差合并）。
    static func append(_ q: InkRawPoint, to raw: inout [InkRawPoint]) {
        var q = q
        if let last = raw.last, !(q.t >= last.t) { q.t = last.t }
        raw.append(q)
    }

    /// 345 单位点在两块书写面之间换算（同一屏幕位置）。
    static func remap(_ q: InkRawPoint, from a: CGRect, to b: CGRect) -> InkRawPoint {
        guard a.width > 0, a.height > 0, b.width > 0, b.height > 0 else { return q }
        var r = q
        let sx = Double(a.minX) + q.x * Double(a.width) / 345, sy = Double(a.minY) + q.y * Double(a.height) / 345
        r.x = (sx - Double(b.minX)) * 345 / Double(b.width)
        r.y = (sy - Double(b.minY)) * 345 / Double(b.height)
        return r
    }

    /// 一个触点采样（UITouch 的必要字段；测试直接构造）。
    struct Sample {
        var location: CGPoint // 书写面坐标（pt）：preciseLocation
        var timestamp: TimeInterval
        var kind: NativeInkInputPolicy.Kind
        var majorRadius: CGFloat = 0
        var force: CGFloat = 0
        var maximumPossibleForce: CGFloat = 0
        var altitude: CGFloat = 0

        init(location: CGPoint, timestamp: TimeInterval, kind: NativeInkInputPolicy.Kind, majorRadius: CGFloat = 0,
             force: CGFloat = 0, maximumPossibleForce: CGFloat = 0, altitude: CGFloat = 0) {
            self.location = location
            self.timestamp = timestamp
            self.kind = kind
            self.majorRadius = majorRadius
            self.force = force
            self.maximumPossibleForce = maximumPossibleForce
            self.altitude = altitude
        }

        init(_ t: UITouch, in view: UIView) {
            let pencil = t.type == .pencil
            self.init(location: t.preciseLocation(in: view), timestamp: t.timestamp, kind: pencil ? .pencil : .finger, majorRadius: t.majorRadius,
                      force: t.force, maximumPossibleForce: t.maximumPossibleForce, altitude: pencil ? t.altitudeAngle : 0)
        }
    }

    private func gridPoint(_ s: Sample) -> InkRawPoint {
        Self.rawPoint(location: s.location, size: bounds.size, timestamp: s.timestamp, pencil: s.kind == .pencil,
                      force: s.force, maximumPossibleForce: s.maximumPossibleForce, altitude: s.altitude)
    }

    private func remapStrokeInProgress(from a: CGRect, to b: CGRect) {
        guard current != nil || !heldDone.isEmpty, a.width > 0, b.width > 0 else { return }
        raw = raw.map { Self.remap($0, from: a, to: b) }
        predicted = predicted.map { Self.remap($0, from: a, to: b) }
        heldDone = heldDone.map { s in s.map { Self.remap($0, from: a, to: b) } }
        liveDirty = !held
        needsRender = true
    }

    // MARK: 触摸 → 采样

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard drawable else {
            #if DEBUG
            logStroke("refused:not-drawable")
            #endif
            return
        }
        // Pencil 优先（规则 1）：同一批里有 Pencil 先看 Pencil
        for t in touches.sorted(by: { $0.type == .pencil && $1.type != .pencil }) {
            inputBegan(Sample(t, in: self), id: ObjectIdentifier(t))
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let id = current, let t = touches.first(where: { ObjectIdentifier($0) == id }) else { return }
        let co = (event?.coalescedTouches(for: t) ?? [t]).map { Sample($0, in: self) }
        let pre = (event?.predictedTouches(for: t) ?? []).map { Sample($0, in: self) }
        inputMoved(co, predicted: pre, last: Sample(t, in: self), id: id)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let id = current, let t = touches.first(where: { ObjectIdentifier($0) == id }) else { return }
        let co = (event?.coalescedTouches(for: t) ?? []).map { Sample($0, in: self) }
        inputEnded(co, last: Sample(t, in: self), id: id)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let id = current, let t = touches.first(where: { ObjectIdentifier($0) == id }) else { return }
        #if DEBUG
        // 谁取消的：这次触摸上已经识别出来的手势（began / changed / ended）
        let who = (t.gestureRecognizers ?? []).filter { [.began, .changed, .ended].contains($0.state) }
            .map { "\(type(of: $0))@\($0.view.map { String(describing: type(of: $0)) } ?? "-")" }
        logStroke("touches-cancelled by [\(who.joined(separator: ","))] x=\(Int(t.location(in: self).x)) y=\(Int(t.location(in: self).y))")
        #endif
        cancelStroke(reason: "touches-cancelled", notify: true)
    }

    // MARK: 格外起笔、滑进格内（D72 ③）
    //
    // 写字页根视图把「页面空白处起手」的触摸（不在按钮 / 可点控件上、不在左缘返回起手区——由写字页筛，NativeWritePageView）交到这里：
    // 先「待进入」，只记上一采样；轨迹第一次进入书写面时，在进入点（轨迹与格边的交点，时间按两采样插值）开始这一笔，之后照常写，
    // 格外那段不画、不存。进入点照常走 inputBegan：一次一笔、Pencil 优先、手掌（只在用过 Pencil 后）、换字 250ms 持住都一样。
    // 进入时由调用方确认格就在手指下（hitTest 落到书写面：可写、没被弹层盖住）。起手在格内的笔仍走上面的 touchesBegan，不变。

    /// 格外起手、还没进格的触点 → 上一采样（书写面坐标）。
    private var approaching: [ObjectIdentifier: Sample] = [:]

    /// 进入点：a 在 rect 外、b 在 rect 内（rect.contains）时，线段 a→b 与 rect 边的第一个交点；时间、接触半径、压力、倾角按同一比例插值，
    /// 落在哪条边就把那个坐标贴到边上（不留浮点误差）。不是「外 → 内」时 nil。
    static func entryPoint(from a: Sample, to b: Sample, in rect: CGRect) -> Sample? {
        guard !rect.contains(a.location), rect.contains(b.location) else { return nil }
        let dx = b.location.x - a.location.x, dy = b.location.y - a.location.y
        var u: CGFloat = 0
        var edgeX: CGFloat?, edgeY: CGFloat?
        // 各方向的「进入」参数取最大（Liang–Barsky）；a 在外，至少有一个方向起作用
        if a.location.x < rect.minX, dx > 0 { let v = (rect.minX - a.location.x) / dx; if v >= u { u = v; edgeX = rect.minX; edgeY = nil } }
        if a.location.x > rect.maxX, dx < 0 { let v = (rect.maxX - a.location.x) / dx; if v >= u { u = v; edgeX = rect.maxX; edgeY = nil } }
        if a.location.y < rect.minY, dy > 0 { let v = (rect.minY - a.location.y) / dy; if v >= u { u = v; edgeY = rect.minY; edgeX = nil } }
        if a.location.y > rect.maxY, dy < 0 { let v = (rect.maxY - a.location.y) / dy; if v >= u { u = v; edgeY = rect.maxY; edgeX = nil } }
        u = min(1, max(0, u))
        func lerp(_ p: CGFloat, _ q: CGFloat) -> CGFloat { p + (q - p) * u }
        var s = b
        s.location = CGPoint(x: edgeX ?? lerp(a.location.x, b.location.x), y: edgeY ?? lerp(a.location.y, b.location.y))
        s.timestamp = a.timestamp + (b.timestamp - a.timestamp) * Double(u)
        s.majorRadius = lerp(a.majorRadius, b.majorRadius)
        s.force = lerp(a.force, b.force)
        s.maximumPossibleForce = b.maximumPossibleForce
        s.altitude = lerp(a.altitude, b.altitude)
        return s
    }

    /// 页面空白处落下的触点：开始「待进入」。
    func approachBegan(_ touches: Set<UITouch>) {
        for t in touches { approachBegan(Sample(t, in: self), id: ObjectIdentifier(t)) }
    }

    func approachBegan(_ s: Sample, id: ObjectIdentifier) {
        if s.kind == .pencil { inputPolicy.notePencil(at: s.timestamp) }
        approaching[id] = s
    }

    /// 根视图转来的移动：已在写的那一笔照常；待进入的找进入点。enters：进入后第一个格内采样处，格是否就在手指下（调用方 hitTest）。
    func approachMoved(_ touches: Set<UITouch>, with event: UIEvent?, enters: (CGPoint) -> Bool) {
        for t in touches {
            let id = ObjectIdentifier(t)
            let co = (event?.coalescedTouches(for: t) ?? [t]).map { Sample($0, in: self) }
            let pre = (event?.predictedTouches(for: t) ?? []).map { Sample($0, in: self) }
            if current == id {
                inputMoved(co, predicted: pre, last: Sample(t, in: self), id: id)
            } else if approaching[id] != nil {
                approachMoved(co, predicted: pre, last: Sample(t, in: self), id: id, enters: enters)
            }
        }
    }

    /// 待进入的触点移动（测试直接调）：进格就在进入点开始这一笔，余下的采样照常写。
    func approachMoved(_ coalesced: [Sample], predicted pre: [Sample], last: Sample, id: ObjectIdentifier, enters: (CGPoint) -> Bool) {
        guard var prev = approaching[id] else { return }
        let samples = coalesced.isEmpty ? [last] : coalesced
        for (i, s) in samples.enumerated() {
            if s.kind == .pencil { inputPolicy.notePencil(at: s.timestamp) }
            guard bounds.contains(s.location), let e = Self.entryPoint(from: prev, to: s, in: bounds) else { prev = s; continue }
            approaching[id] = nil
            guard drawable, !isHidden, enters(s.location) else {
                #if DEBUG
                logStroke("approach-blocked")
                #endif
                return
            }
            #if DEBUG
            logStroke(String(format: "enter x=%.1f y=%.1f", Double(e.location.x), Double(e.location.y)))
            #endif
            guard inputBegan(e, id: id) else { return }
            inputMoved(Array(samples[i...]), predicted: pre, last: last, id: id)
            return
        }
        approaching[id] = prev
    }

    /// 根视图转来的抬起：已在写的照常抬笔；待进入的若最后一段进了格，先开始再抬笔，否则作罢。
    func approachEnded(_ touches: Set<UITouch>, with event: UIEvent?, enters: (CGPoint) -> Bool) {
        for t in touches {
            let id = ObjectIdentifier(t)
            let co = (event?.coalescedTouches(for: t) ?? []).map { Sample($0, in: self) }
            let last = Sample(t, in: self)
            if approaching[id] != nil { approachMoved(co, predicted: [], last: last, id: id, enters: enters) }
            approaching[id] = nil
            if current == id { inputEnded(co, last: last, id: id) }
        }
    }

    /// 根视图转来的取消（例如左缘返回识别成功）：待进入的作罢；已在写的按中断丢弃（与格内起手同语义）。
    func approachCancelled(_ touches: Set<UITouch>) {
        for t in touches {
            let id = ObjectIdentifier(t)
            approaching[id] = nil
            if current == id { cancelStroke(reason: "touches-cancelled", notify: true) }
        }
    }

    // MARK: 采样 → 笔（触摸与测试同一条路）

    /// 落下一个触点；返回是否成了「写字的那一个」。
    @discardableResult
    func inputBegan(_ s: Sample, id: ObjectIdentifier) -> Bool {
        guard drawable else { return false }
        if s.kind == .pencil { inputPolicy.notePencil(at: s.timestamp) }
        switch inputPolicy.begin(kind: s.kind, majorRadius: s.majorRadius, at: s.timestamp, active: current == nil ? nil : currentKind) {
        case .reject(let why):
            #if DEBUG
            logStroke("refused:\(why)")
            #endif
            return false
        case .preempt:
            cancelStroke(reason: "palm", notify: true)
        case .accept:
            break
        }
        hideHover()
        current = id
        currentKind = s.kind
        raw = [gridPoint(s)]
        predicted = []
        palm = (s.location, s.majorRadius, 0, s.timestamp)
        held = s.timestamp < acceptFrom
        heldStartedAt = s.timestamp
        #if DEBUG
        latency.touch(s.timestamp, delivered: CACurrentMediaTime())
        logStroke(String(format: "began x=%.0f y=%.0f%@", Double(s.location.x), Double(s.location.y), held ? " held" : ""))
        #endif
        liveDirty = !held
        needsRender = true
        if !held { delegate?.nativeInkDidBeginStroke(self, at: s.timestamp) }
        return true
    }

    /// 移动：合并点全部进原始点（时间戳夹成单调），预测点只画这一帧；手指那笔按掌托规则复核。
    func inputMoved(_ coalesced: [Sample], predicted pre: [Sample], last: Sample, id: ObjectIdentifier) {
        guard current == id else { return }
        #if DEBUG
        let now = CACurrentMediaTime()
        #endif
        for c in coalesced {
            Self.append(gridPoint(c), to: &raw)
            #if DEBUG
            latency.touch(c.timestamp, delivered: now)
            #endif
        }
        if currentKind == .pencil {
            inputPolicy.notePencil(at: last.timestamp)
        } else {
            palm.maxRadius = max(palm.maxRadius, last.majorRadius)
            palm.moved = max(palm.moved, hypot(last.location.x - palm.start.x, last.location.y - palm.start.y))
            if inputPolicy.isPalm(kind: currentKind, maxRadius: palm.maxRadius, moved: palm.moved, elapsed: last.timestamp - palm.startedAt) {
                cancelStroke(reason: "palm", notify: true)
                return
            }
        }
        predicted = pre.map(gridPoint)
        liveDirty = !held
        needsRender = true
    }

    /// 抬笔：补上最后的合并点与抬笔点，整笔固化交给代理；门限之前抬笔的整笔先留着，到点再交出。
    func inputEnded(_ coalesced: [Sample], last: Sample, id: ObjectIdentifier) {
        guard current == id else { return }
        for c in coalesced where c.timestamp * 1000 > (raw.last?.t ?? 0) { Self.append(gridPoint(c), to: &raw) }
        let end = gridPoint(last)
        // 抬笔点：位置变了，或位置没变但时间更晚（抬笔前的停顿）都追加——B2.3 决定保留停顿时长：判断墨迹存原始点（Ink v4），
        // 原生回放的停顿洇墨与慢收（规格 §5.3、§3）要靠这个时刻；同一时刻的重复点不追加（零时间差本来就会被合并）。
        if let l = raw.last, end.x != l.x || end.y != l.y || end.t > l.t { Self.append(end, to: &raw) }
        if currentKind == .pencil { inputPolicy.notePencil(at: last.timestamp) }
        let stroke = raw
        let wasHeld = held
        current = nil
        raw = []
        predicted = []
        liveVertices = []
        held = false
        if wasHeld, CACurrentMediaTime() < acceptFrom {
            heldDone.append(stroke) // P227：这一笔不丢，到点整笔交出
            #if DEBUG
            logStroke("held")
            #endif
            needsRender = true
            return
        }
        if wasHeld { delegate?.nativeInkDidBeginStroke(self, at: heldStartedAt) }
        finish(stroke)
    }

    private func finish(_ stroke: [InkRawPoint]) {
        pendingStrokes.append(mesh(stroke))
        pendingSince = CACurrentMediaTime()
        #if DEBUG
        latency.strokes += 1
        logStroke("ended n=\(stroke.count)")
        #endif
        needsRender = true
        delegate?.nativeInkDidEndStroke(self, raw: stroke)
    }

    /// 丢弃正在写的一笔（不固化、不计笔数）。notify：是否告诉代理（代理自己发起的取消不回告；持住中的笔代理还不知道，也不回告）。
    func cancelStroke(reason: String, notify: Bool) {
        guard current != nil else { return }
        let wasHeld = held
        current = nil
        raw = []
        predicted = []
        liveVertices = []
        held = false
        #if DEBUG
        latency.dropPending()
        logStroke("cancel:\(reason)")
        #endif
        needsRender = true
        if notify, !wasHeld { delegate?.nativeInkDidCancelStroke(self, reason: reason) }
    }

    /// 丢掉持住的笔（判断没保存上：那时落下的笔不属于任何一个字）。
    func dropHeld() {
        if held { cancelStroke(reason: "reset", notify: false) }
        heldDone = []
    }

    var isWriting: Bool { current != nil }
    /// 有持住的笔（正在写或已抬笔，等门限）。
    var hasHeldInput: Bool { held || !heldDone.isEmpty }
    /// 正在写的这一笔的原始点（测试与诊断用）。
    var strokeInProgress: [InkRawPoint] { raw }

    /// 门限到了：持住的笔补开始（正在写的接着实时画；已抬笔的整笔交出）。每帧调用；测试可直接调。
    func releaseHeldIfDue(_ now: CFTimeInterval) {
        guard now >= acceptFrom else { return }
        if held, current != nil {
            held = false
            liveDirty = true
            needsRender = true
            delegate?.nativeInkDidBeginStroke(self, at: heldStartedAt)
        }
        if !heldDone.isEmpty {
            let done = heldDone
            heldDone = []
            for s in done {
                delegate?.nativeInkDidBeginStroke(self, at: (s.first?.t ?? 0) / 1000)
                finish(s)
            }
        }
    }

    // MARK: Apple Pencil：悬停与双击

    @objc private func handleHover(_ g: UIHoverGestureRecognizer) {
        guard #available(iOS 16.1, *) else { return }
        switch g.state {
        case .began, .changed:
            // zOffset > 0 只有 Apple Pencil 悬停（触控板指针为 0）
            guard drawable, current == nil, g.zOffset > 0 else { hideHover(); return }
            inputPolicy.notePencil(at: CACurrentMediaTime())
            let loc = g.location(in: self)
            let w = max(1, Double(bounds.width)), h = max(1, Double(bounds.height))
            hoverPoint = (Double(loc.x) * 345 / w, Double(loc.y) * 345 / h)
            needsRender = true
        default:
            hideHover()
        }
    }

    private func hideHover() {
        guard hoverPoint != nil else { return }
        hoverPoint = nil
        needsRender = true
    }

    /// 双击：按系统偏好得到的动作交给代理（正在写一笔时不做，避免和书写冲突）。
    fileprivate func pencilTapped() {
        guard drawable, current == nil, let action = NativeInkPencilAction.forTap(UIPencilInteraction.preferredTapAction) else { return }
        delegate?.nativeInk(self, didRequest: action)
    }

    // MARK: 每帧

    fileprivate func tick(_ link: CADisplayLink) {
        #if DEBUG
        latency.tick(duration: link.targetTimestamp - link.timestamp)
        stepFade(link.targetTimestamp)
        #endif
        releaseHeldIfDue(CACurrentMediaTime())
        if isHidden { return }
        let extra = overlayFrame?(link.targetTimestamp)
        if overlayFrame != nil, extra == nil { overlayFrame = nil; needsRender = true }
        let hasExtra = extra != nil
        guard needsRender || liveDirty || hasExtra else { return }
        let callback = CACurrentMediaTime()
        if liveDirty, !raw.isEmpty, !held {
            var v: [Float] = []
            v.reserveCapacity(liveVertices.count + 64)
            if let k = inkModel {
                NativeInkStrokeMesh.triangles(InkModel.geometry(InkModel.analyze(raw, final: false, predicted: predicted, params: k)), into: &v)
            } else if let params {
                NativeInkStrokeMesh.live(raw: raw, predicted: predicted, params: params, into: &v)
            }
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
        if !liveVertices.isEmpty, !held {
            batches.append(.init(vertices: liveVertices, buffer: nil, count: liveVertices.count / 2, uniforms: u))
        }
        if let h = hoverPoint {
            // 落笔预览点：墨色 40%，叠在最上面（混合管线），不落墨
            let pa = a * 0.4
            let hu = NativeInkRenderer.uniforms(color: SIMD4(inkColor.x * pa, inkColor.y * pa, inkColor.z * pa, pa))
            if let params {
                let dot = NativeInkStrokeMesh.disc(x: h.x, y: h.y, radius: NativeInkStrokeMesh.hoverDotDiameter(params) / 2)
                batches.append(.init(vertices: dot, buffer: nil, count: dot.count / 2, uniforms: hu, blend: true))
            }
        }
        if let extra { batches.append(contentsOf: extra) }
        let cpu = (CACurrentMediaTime() - callback) * 1000
        lastFrameCpuMs = cpu
        #if DEBUG
        let frameId = latency.frame(callback: callback, target: link.targetTimestamp, cpuMs: cpu)
        let lat = latency
        let ok = renderer.render(layer: metalLayer, batches: batches) { t in
            DispatchQueue.main.async { lat.presented(frame: frameId, at: t) }
        }
        #else
        let ok = renderer.render(layer: metalLayer, batches: batches, presented: nil)
        #endif
        needsRender = !ok
        afterFrame?(link.targetTimestamp)
        // 代理迟迟没同步回来（例如这一笔被丢弃）：2s 后不再显示待确认的笔
        if !pendingStrokes.isEmpty, current == nil, CACurrentMediaTime() - pendingSince > 2 {
            #if DEBUG
            logStroke("pending-dropped \(pendingStrokes.count)")
            #endif
            pendingStrokes = []
            needsRender = true
        }
    }

    func requestRender() { needsRender = true }

    #if DEBUG
    // MARK: spike 叠层的卸载淡出（DEBUG：网页阶段交叉淡化 150ms 时网页快照里没有墨，由原生层同步淡出）

    func fadeOutAndHide(ms: Double) {
        isUserInteractionEnabled = false
        fade = (0, ms, inkOpacity)
        needsRender = true
    }

    func cancelFade() {
        guard let f = fade else { return }
        fade = nil
        inkOpacity = f.from
        isUserInteractionEnabled = drawable
    }

    fileprivate func stepFade(_ target: CFTimeInterval) {
        guard var f = fade else { return }
        if f.start == 0 { f.start = target; fade = f }
        let u = min(1, (target - f.start) * 1000 / max(1, f.ms))
        inkOpacity = f.from * Float(1 - u)
        if u >= 1 {
            fade = nil
            isHidden = true
            inkOpacity = f.from
        }
    }
    #endif
}

extension NativeInkView: UIPencilInteractionDelegate {
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        pencilTapped()
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        pencilTapped()
    }
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

#if DEBUG
/// T1 测量（DEBUG）：触点（UITouch.timestamp）→ 首次上屏的帧。原生写字页的量测文件与 spike 叠层的导出都读它。
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
#endif
