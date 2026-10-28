import UIKit

// 原生写字页的版式（B2.2；01 §6.1、A7 / D57、P118 / P195 / P257 / P299）。与网页 src/ui/screens/write/layout.js 同一组公式（纯函数，逐条对照），
// 常量由页面随 open 回包给出（src/session/write-api.js writeLayoutConstants，单一来源 policy.writeGrid），原生不另存数值。
//
//   名义主区高 H = 页面高 − (名义页头 44 + 上安全区) − (名义按钮行 134 + max(24, 下安全区))     与系统字号无关（D29 / D36 / P195）
//   书写格 g   = clamp(258, min(屏宽 − 40, 400, H − 80 − 16 − 88 − 16), 400)；名义版式里 258 仍放不下 → 取剩下的高度，最小 180（P299）
//   组顶      = max(12, round((H − 组高) × 0.4)) − 页头多出名义的部分；组高 = P + 16 + g + 88（P = 这张卡量到的题面高）
//   书写格顶边在同一张卡的所有阶段固定（D53 ②，P257）；判断页上下两格 S = min(屏宽 − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)，下限 120。
// AX 档（B2.9b）：axWrite / judgeAx = layout.js axWriteLayout / judgeAxLayout（按实际量到的主区高排，书写格下限 220，放不下时格子先让步到 180、再缩题面到 0.6；仍不 fits 时控制器滚动正文，P299）。

struct NativeWriteLayoutConstants {
    var min: CGFloat = 258
    var max: CGFloat = 400
    var sideMargin: CGFloat = 20
    var promptGap: CGFloat = 16
    var noteHeight: CGFloat = 40
    var toolRowHeight: CGFloat = 48
    var axMin: CGFloat = 220
    var axNoteHeight: CGFloat = 56
    var fitGridMin: CGFloat = 180
    var promptFitMin: CGFloat = 0.6
    var bottomGap: CGFloat = 16
    var topShare: CGFloat = 0.4
    var topMin: CGFloat = 12
    var nominalHead: CGFloat = 44
    var nominalFoot: CGFloat = 134
    var footBottomMin: CGFloat = 24
    var nominalPrompt: CGFloat = 80
    var hintMatchMaxDist: Double = 40

    /// 格下总高（撤销 / 清空行 + 说明位，A7）。
    var toolsHeight: CGFloat { toolRowHeight + noteHeight }

    /// 页面 open 回包的 layout（缺项保留缺省，缺省只为页面没给时不崩；值以页面为准）。
    init(_ raw: [String: Any]? = nil) {
        func v(_ k: String) -> CGFloat? { (raw?[k] as? NSNumber).map { CGFloat($0.doubleValue) } }
        if let x = v("min") { min = x }
        if let x = v("max") { max = x }
        if let x = v("sideMargin") { sideMargin = x }
        if let x = v("promptGap") { promptGap = x }
        if let x = v("noteHeight") { noteHeight = x }
        if let x = v("toolRowHeight") { toolRowHeight = x }
        if let x = v("axMin") { axMin = x }
        if let x = v("axNoteHeight") { axNoteHeight = x }
        if let x = v("fitGridMin") { fitGridMin = x }
        if let x = v("promptFitMin") { promptFitMin = x }
        if let x = v("bottomGap") { bottomGap = x }
        if let x = v("topShare") { topShare = x }
        if let x = v("topMin") { topMin = x }
        if let x = v("nominalHead") { nominalHead = x }
        if let x = v("nominalFoot") { nominalFoot = x }
        if let x = v("footBottomMin") { footBottomMin = x }
        if let x = v("nominalPrompt") { nominalPrompt = x }
        if let x = raw?["hintMatchMaxDist"] as? NSNumber { hintMatchMaxDist = x.doubleValue }
    }
}

enum NativeWriteLayout {
    typealias K = NativeWriteLayoutConstants

    static func contentWidth(_ width: CGFloat, _ k: K) -> CGFloat { width > 0 ? width - 2 * k.sideMargin : .infinity }

    /// layout.js writeGridSize。
    static func gridSize(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, toolsHeight: CGFloat, _ k: K) -> CGFloat {
        let w = contentWidth(width, k)
        let h = mainHeight > 0 ? mainHeight - promptHeight - k.promptGap - toolsHeight - k.bottomGap : .infinity
        return Swift.max(k.min, Swift.min(k.max, floor(Swift.min(w, k.max, h))))
    }

    /// layout.js groupTop：空余 40% 在上，至少 12；空余不足 12 时取空余本身（≥ 0）。
    static func groupTop(mainHeight: CGFloat, groupHeight: CGFloat, _ k: K) -> CGFloat {
        let spare = mainHeight - groupHeight
        let ideal = (spare * k.topShare).rounded()
        if ideal >= k.topMin { return ideal }
        return Swift.max(0, Swift.min(k.topMin, floor(spare)))
    }

    /// layout.js nominalMainHeight（正文区上下内边距 0）。
    static func nominalMainHeight(pageHeight: CGFloat, safeTop: CGFloat, footBottom: CGFloat, _ k: K) -> CGFloat {
        pageHeight - (k.nominalHead + safeTop) - (k.nominalFoot + footBottom)
    }

    /// layout.js fitGroup（scaleMin = 1：非 AX 档只有格子让步这一步）。
    static func fitGrid(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, below: CGFloat, gFloor: CGFloat, _ k: K) -> CGFloat {
        let w = contentWidth(width, k)
        let room = mainHeight - k.promptGap - below - k.bottomGap
        let free = room - promptHeight
        if free >= gFloor || free >= k.fitGridMin { return floor(Swift.min(w, k.max, free)) }
        return Swift.max(k.fitGridMin, floor(Swift.min(w, k.max, room - promptHeight)))
    }

    /// layout.js writeLayout：{g, top, gridTop}（top / gridTop 是主区内的偏移；主区从页头底算起）。
    static func write(width: CGFloat, nominalHeight: CGFloat, promptHeight: CGFloat, headExtra: CGFloat, _ k: K) -> (g: CGFloat, top: CGFloat, gridTop: CGFloat) {
        var g = gridSize(width: width, mainHeight: nominalHeight, promptHeight: k.nominalPrompt, toolsHeight: k.toolsHeight, k)
        if nominalHeight > 0 {
            g = Swift.min(g, fitGrid(width: width, mainHeight: nominalHeight, promptHeight: k.nominalPrompt, below: k.toolsHeight, gFloor: g, k))
        }
        let extra = Swift.max(0, headExtra)
        let top = Swift.max(0, groupTop(mainHeight: nominalHeight, groupHeight: promptHeight + k.promptGap + g + k.toolsHeight, k) - extra)
        return (g, top, top + promptHeight + k.promptGap)
    }

    /// layout.js fitGroup（带题面缩放，AX 档用）：{g, scale}。
    static func fitGroup(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, below: CGFloat, gFloor: CGFloat, scaleMin: CGFloat, _ k: K) -> (g: CGFloat, scale: CGFloat) {
        let w = contentWidth(width, k)
        let room = mainHeight - k.promptGap - below - k.bottomGap
        let free = room - promptHeight
        if free >= gFloor || free >= k.fitGridMin { return (floor(Swift.min(w, k.max, free)), 1) }
        let scale = promptHeight > 0 ? Swift.max(scaleMin, Swift.min(1, floor(((room - k.fitGridMin) / promptHeight) * 1000) / 1000)) : 1
        let g = Swift.max(k.fitGridMin, floor(Swift.min(w, k.max, room - promptHeight * scale)))
        return (g, scale)
    }

    /// layout.js axWriteLayout（AX 档，D51 ⑦ / P225 / P241 / P299）：按实际主区高排；noteHeight = 格下实际高（撤销 / 清空行 + 说明位，至少 axBelow）。
    static func axWrite(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, noteHeight: CGFloat, _ k: K) -> (g: CGFloat, top: CGFloat, gridTop: CGFloat, below: CGFloat, fits: Bool, tight: Bool, promptScale: CGFloat) {
        let w = contentWidth(width, k)
        let axBelow = k.toolRowHeight + k.axNoteHeight
        let note = Swift.max(axBelow, noteHeight.isFinite ? ceil(noteHeight) : axBelow)
        let hasH = mainHeight > 0
        let room = hasH ? mainHeight - promptHeight - k.promptGap - note - k.bottomGap : .infinity
        let raw = floor(Swift.min(w, k.max, room))
        let tight = hasH && raw < k.axMin
        var g = Swift.max(k.axMin, Swift.min(k.max, raw))
        var scale: CGFloat = 1
        if tight {
            let f = fitGroup(width: width, mainHeight: mainHeight, promptHeight: promptHeight, below: note, gFloor: k.axMin, scaleMin: k.promptFitMin, k)
            g = f.g
            scale = f.scale
        }
        let shown = promptHeight * scale
        let groupHeight = shown + k.promptGap + g + note
        let top = groupTop(mainHeight: mainHeight, groupHeight: groupHeight, k)
        let fits = !hasH || top + groupHeight <= mainHeight + 0.5
        return (g, top, top + shown + k.promptGap, note, fits, tight, scale)
    }

    /// layout.js judgeAxLayout（AX 档判断页：上下排与并排（间距 12）各算一次，取格子更大的一种；平手取上下排）。
    static func judgeAx(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, gap: CGFloat, _ k: K) -> (side: Bool, s: CGFloat, top: CGFloat) {
        let w = contentWidth(width, k)
        let stack = floor(Swift.min(w, floor((mainHeight - k.topMin - promptHeight - k.promptGap - k.bottomGap) / 2)))
        let side = w.isFinite ? floor((w - gap) / 2) : 0
        if side > stack {
            return (true, side, groupTop(mainHeight: mainHeight, groupHeight: promptHeight + k.promptGap + side, k))
        }
        return (false, Swift.max(120, stack), k.topMin)
    }

    /// layout.js judgePairSize：判断页上下两格的边长（下限 120）。
    static func judgePair(width: CGFloat, mainHeight: CGFloat, gridTop: CGFloat, _ k: K) -> CGFloat {
        let w = contentWidth(width, k)
        let h = mainHeight > 0 ? floor((mainHeight - gridTop - k.bottomGap) / 2) : .infinity
        let s = floor(Swift.min(w, h))
        return s.isFinite ? Swift.max(120, s) : 234
    }
}
