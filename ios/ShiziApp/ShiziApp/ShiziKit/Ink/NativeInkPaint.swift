import UIKit

// 画墨接口（B2.7；docs/engineering/v10/B2-原生写字架构.md §20）。
//
// 「只看不写」的墨迹——结果页作品格、没放进图里那一行的小字、对照与改判弹层「你写的」小卡——都经这一个接口画：
//   输入：原始点（345 单位格；存下的 Ink v4 解出的点，或本页面刚记下的笔画，NativeInkWire.rawStrokes 的形状）+ 方框边长（pt）+ 墨色 + 线宽下限（pt）；
//   输出：一张只读、不接收触摸、铺满方框的视图（调用方只管放在哪）。
// 实现（NativeInkSurfacePainter）：原生书写面 NativeInkView（drawable = false）只读回放——R11-A 起它画的就是网页 buildStroke
// 的同一算法（WebInk.swift，参数 WebInkParams.current = 页面下发的 ink 表）+ 同一画法的三角形，经原有 Metal 管线；不用 ink-model-1.0。
// 线宽倍数 = 网页 paintHand 的 widthScale（inkWidthScale：小格抬到最小物理线宽 1.2pt），由页面视图给。
// 结果页的墨迹纳入逐屏对比（parity.config.json ink：NP-07 平均笔宽 ±10%、NP-22 墨区 IoU，与写字页同一口径）。

/// 画墨的实现。
protocol NativeInkPainter {
    /// strokes：每笔原始点（345 单位）；side：方框边长（pt）；color：墨色（nil = 书写面默认墨色）；widthScale：线宽倍数（网页 inkWidthScale，1 = 原宽）。
    func makeInkView(strokes: [[InkRawPoint]], side: CGFloat, color: SIMD4<Float>?, widthScale: Double) -> UIView?
}

/// 画墨接口的入口（结果页、改判弹层都调它；换实现只改 painter）。
enum NativeInkPaint {
    static var painter: NativeInkPainter = NativeInkSurfacePainter()

    /// 一张只读墨迹视图（frame = 0, 0, side, side）；没有可画的笔 → nil。
    static func view(strokes: [[InkRawPoint]], side: CGFloat, color: SIMD4<Float>?, widthScale: Double = 1) -> UIView? {
        guard side > 0, strokes.contains(where: { !$0.isEmpty }) else { return nil }
        return painter.makeInkView(strokes: strokes, side: side, color: color, widthScale: widthScale)
    }
}

/// 原生书写面只读地回放原始点（网页同一算法 WebInk，参数 WebInkParams.current）。
struct NativeInkSurfacePainter: NativeInkPainter {
    func makeInkView(strokes: [[InkRawPoint]], side: CGFloat, color: SIMD4<Float>?, widthScale: Double) -> UIView? {
        guard let ink = NativeInkView.make(frame: CGRect(x: 0, y: 0, width: side, height: side)) else { return nil }
        ink.params = WebInkParams.current
        ink.widthScale = widthScale
        ink.drawable = false
        ink.isUserInteractionEnabled = false
        ink.isAccessibilityElement = false
        ink.backgroundColor = .clear
        if let color { ink.inkColor = color }
        ink.syncPageStrokes(strokes)
        return ink
    }
}
