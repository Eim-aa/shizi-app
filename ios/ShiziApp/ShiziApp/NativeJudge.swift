import UIKit

// 原生判断页的两块独立部件（B2.5；docs/engineering/v10/B2-原生写字架构.md §11、§14）：
//   1. NativeSettle：判断落定（时刻编排 ② M23）——本人笔迹离纸、收进页头计数；时刻与曲线全部取自 open 回包的 motion.settle / easeOut（src/config/motion.js），
//      本文件不写死任何时长；
//   2. NativeChangeSheetViewController：改判弹层（D19 / D66 ④；网页 result-row.js ChangeSheet 的原生版）——标题、两张小卡、说明、主按钮、失败三段式。
// 文案全部来自页面（open 回包的 copy 字典），本文件不写任何用户可见的字。

// MARK: 时刻参数

/// open 回包 motion.settle（+ easeOut）：M23 判断落定。缺任何一项就不做落定动画（原生不自带默认值，时刻只有页面一个来源）。
struct NativeSettleSpec {
    let lift: Double
    let fadeFrom: Double
    let end: Double
    let countBox: CGFloat
    let liftScale: Double
    let gather: [Double]
    let easeOut: [Double]
    let reduceMs: Double

    init?(motion: [String: Any]) {
        guard let s = motion["settle"] as? [String: Any],
              let lift = (s["lift"] as? NSNumber)?.doubleValue, let fadeFrom = (s["fadeFrom"] as? NSNumber)?.doubleValue,
              let end = (s["end"] as? NSNumber)?.doubleValue, let box = (s["countBox"] as? NSNumber)?.doubleValue,
              let scale = (s["liftScale"] as? NSNumber)?.doubleValue,
              let gather = (s["gather"] as? [NSNumber])?.map({ $0.doubleValue }), gather.count == 4,
              let ease = (motion["easeOut"] as? [NSNumber])?.map({ $0.doubleValue }), ease.count == 4,
              let reduce = (motion["reduce"] as? NSNumber)?.doubleValue else { return nil }
        self.lift = lift
        self.fadeFrom = fadeFrom
        self.end = end
        self.countBox = CGFloat(box)
        self.liftScale = scale
        self.gather = gather
        self.easeOut = ease
        self.reduceMs = reduce
    }
}

// MARK: 判断落定（M23）

enum NativeSettle {
    private static var sharedRenderer: NativeInkRenderer?

    /// 本人笔迹：t = 0 离纸（liftScale，lift ms，ease.out），之后收进计数方框（gather 曲线，到 end），fadeFrom → end 淡出；
    /// 触觉与第一帧同一个 CADisplayLink 回调（firstFrame）。减少动态效果：不飞，reduceMs 原地淡出，触觉照发。
    /// 返回叠层（播完自己移除）；Metal 不可用 / 没有笔画 / 没有起点返回 nil（调用方自己发触觉）。
    @discardableResult
    static func play(in container: UIView, from: CGRect, to counter: CGRect?, strokes: [[InkRawPoint]], params: WebInkParams?, color: SIMD4<Float>,
                     spec: NativeSettleSpec, reduceMotion: Bool, firstFrame: @escaping () -> Void) -> NativeInkView? {
        guard !strokes.isEmpty, from.width > 0 else { return nil }
        if sharedRenderer == nil { sharedRenderer = NativeInkRenderer() }
        guard let renderer = sharedRenderer, let v = NativeInkView(frame: container.bounds, renderer: renderer) else { return nil }
        v.drawable = false
        v.isUserInteractionEnabled = false
        v.accessibilityElementsHidden = true
        container.addSubview(v)
        let box = spec.countBox
        let to = counter.map { CGRect(x: $0.midX - box / 2, y: $0.midY - box / 2, width: box, height: box) }
            ?? CGRect(x: from.midX - box / 2, y: from.minY - 40, width: box, height: box)
        let meshes = strokes.map { NativeInkStrokeMesh.build(raw: $0, params: params) }
        let size = container.bounds.size
        var t0: CFTimeInterval = 0
        func lerp(_ a: CGRect, _ b: CGRect, _ u: Double) -> CGRect {
            let f = CGFloat(u)
            return CGRect(x: a.minX + (b.minX - a.minX) * f, y: a.minY + (b.minY - a.minY) * f, width: a.width + (b.width - a.width) * f, height: a.height + (b.height - a.height) * f)
        }
        v.overlayFrame = { target in
            if t0 == 0 { t0 = target }
            let ms = (target - t0) * 1000
            var r = from
            var alpha = 1.0
            if reduceMotion {
                if ms > spec.reduceMs { return nil }
                alpha = 1 - ms / spec.reduceMs
            } else {
                if ms > spec.end { return nil }
                if ms < spec.lift {
                    let s = 1 - (1 - spec.liftScale) * NativeBezier.value(ms / spec.lift, spec.easeOut)
                    r = from.insetBy(dx: from.width * CGFloat(1 - s) / 2, dy: from.height * CGFloat(1 - s) / 2)
                } else {
                    let half = CGFloat((1 - spec.liftScale) / 2)
                    let start = from.insetBy(dx: from.width * half, dy: from.height * half)
                    r = lerp(start, to, NativeBezier.value((ms - spec.lift) / (spec.end - spec.lift), spec.gather))
                }
                if ms > spec.fadeFrom { alpha = max(0, 1 - (ms - spec.fadeFrom) / (spec.end - spec.fadeFrom)) }
            }
            let a = Float(alpha)
            let u = NativeInkRenderer.uniforms(color: SIMD4(color.x * a, color.y * a, color.z * a, a), rectInView: r, viewSize: size)
            return meshes.map { m in
                if m.buffer == nil { m.buffer = renderer.makeBuffer(m.vertices) }
                return NativeInkRenderer.Batch(vertices: nil, buffer: m.buffer, count: m.vertexCount, uniforms: u)
            }
        }
        var first = true
        v.afterFrame = { [weak v] _ in
            if first {
                first = false
                firstFrame() // 与离纸第一帧同一个 CADisplayLink 回调（F1：触觉与画面同帧）
            }
            if v?.overlayFrame == nil { DispatchQueue.main.async { v?.removeFromSuperview() } }
        }
        v.requestRender()
        return v
    }
}
