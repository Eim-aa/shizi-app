#if DEBUG
import UIKit
import WebKit

// QA-H1：原生界面自动化测试框架的 App 内一半（只在 DEBUG 编译；Release 不含，verify-archive.sh / verify_assets 断言）。
//
// 三种用法，全部由启动参数打开（默认什么都不做）：
//   1. 状态注入（-shizi-qa-seed <状态>）：页面就绪后清空数据，把 App 带到指定状态（夹具 ShiziUITests/States/<状态>.json，见 QAFixtures.swift）。
//      XCUITest（ShiziUITests）用它一键起步；同一套状态网页版（-shizi-native-write-off）与原生版（-shizi-native-write）都能到。
//   2. 逐屏取证（-shizi-qa parity -shizi-qa-ui native|web -shizi-qa-states a,b,… -shizi-qa-tag <外观_字号>）：
//      逐个状态注入 → 等动画落定 → 把元素清单（位置尺寸 / 文案 / 颜色 / 字号 / 可点）写到 Documents/qa/<ui>/<状态>_<tag>.json →
//      写 Documents/qa/ready 通知宿主脚本截图 → 等宿主写回 Documents/qa/ack-<序号> 再做下一个（截图由宿主 simctl 截，含真实合成结果）。
//      原生取 UIKit 视图树 + 无障碍属性（accessibilityIdentifier / Label / Frame）；网页取 DOM（getBoundingClientRect / 文本 / computed color）。
//   3. 探针（-shizi-qa-probe）：一个 1pt 的透明窗口，读屏元素 id「qa-probe」的 value 是 store 摘要 JSON（路由、会话、记录条数、
//      已练字数、原生写字页的阶段与字），每 0.3 秒刷新；XCUITest 经无障碍树读它断言「数据真的写进去了」。
// 状态注入走的是正式代码：会话由 core/session-start.startPicked 开、推进与阶段由写字会话 API（与原生页同一批提交函数）提交，
// 打开写字页走 session/index.js openWrite（网页路由 → 原生宿主），点按走原生页自己的按钮动作 / 网页按钮 click。

extension WebViewController {
    // MARK: 启动参数

    static func qaArg(_ flag: String) -> String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: flag), i + 1 < a.count else { return nil }
        return a[i + 1]
    }

    static var qaMode: String? { qaArg("-shizi-qa") }
    static var qaSeed: String? { qaArg("-shizi-qa-seed") }
    static var qaProbeEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-shizi-qa-probe") }
    static var qaEnabled: Bool { qaMode != nil || qaSeed != nil || qaProbeEnabled }

    static var qaDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("qa", isDirectory: true)
    }

    /// 固定数据：这次选的字（B 槽，「跳过」「结束这组」都在），5 个字。
    static let qaChars = ["\u{6C38}", "\u{548C}", "\u{6625}", "\u{65E5}", "\u{6708}"] // 永 和 春 日 月
    /// 时钟不固定（用真实时间）：冷启动恢复按「离开多久」判断，固定时钟会让重开时现场显得「很久以前」而不恢复；
    /// 写字页上没有随时间变的内容，对比不受影响。传 -shizi-qa-clock <ISO> 可另行固定。
    static var qaClock: String { qaArg("-shizi-qa-clock") ?? "" }

    // MARK: 入口（handlePageReady 调用）

    func runQAHarnessIfNeeded() {
        guard Self.qaEnabled else { return }
        if Self.qaProbeEnabled { QAProbe.shared.install(on: self) }
        // 只在本次启动的第一次 pageReady 注入（页面重载 / 冷启动恢复不再注入，否则「杀进程重开恢复」测不到）
        guard !QARun.started else { return }
        QARun.started = true
        Task { @MainActor in
            if Self.qaMode == "parity" {
                await self.qaRunParity()
            } else if let st = Self.qaSeed {
                let r = await self.qaPrepare(st, ui: NativeWriteDetect.enabled ? "native" : "web")
                QAProbe.shared.seedResult = r
            }
        }
    }

    /// B2.9b：注入后页面时钟的偏移存下来（QAClock），之后的冷启动、原生时间戳都用它；没钉时钟（偏移 < 1s）则清掉。
    func qaRememberClock() async {
        let off = (await qaJS("return window.__shiziTest ? window.__shiziTest.now() - Date.now() : 0;") as? NSNumber)?.doubleValue ?? 0
        QAClock.offsetMs = abs(off) >= 1000 ? off : nil
    }
    func qaJS(_ body: String) async -> Any? {
        try? await webView.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
    }

    func qaWait(_ seconds: Double, _ cond: @escaping () async -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if await cond() { return true }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return false
    }

    // MARK: 逐屏取证

    private func qaRunParity() async {
        let ui = Self.qaArg("-shizi-qa-ui") ?? (NativeWriteDetect.enabled ? "native" : "web")
        let tag = Self.qaArg("-shizi-qa-tag") ?? "light_L"
        let states = Self.qaArg("-shizi-qa-states")?.split(separator: ",").map(String.init) ?? QAFixture.parityNames(native: ui == "native")
        let fm = FileManager.default
        let outDir = Self.qaDir.appendingPathComponent(ui, isDirectory: true)
        try? fm.createDirectory(at: outDir, withIntermediateDirectories: true)
        for (i, st) in states.enumerated() {
            let err = await qaPrepare(st, ui: ui)
            if ui == "native" { await qaSettleNative() } // QA-H4：等推入转场 / 动画落定再取（准备好的信号可能发在转场进行中）
            var dump: [String: Any] = ["state": st, "ui": ui, "tag": tag, "ok": err == nil]
            if let err { dump["error"] = err }
            let win = view.window
            dump["screen"] = ["w": win?.bounds.width ?? 0, "h": win?.bounds.height ?? 0, "scale": win?.screen.scale ?? 0,
                              "safeTop": win?.safeAreaInsets.top ?? 0, "safeBottom": win?.safeAreaInsets.bottom ?? 0,
                              "style": traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
                              "contentSize": Self.contentSizeName(currentContentSizeCategory)]
            if ui == "native" {
                let (elements, offscreen) = qaNativeDump()
                dump["elements"] = elements
                // QA-H2：滚动区里屏外的元素、线 / 装饰 / 墨格（旧字段不变）
                dump["offscreen"] = offscreen
                for (k, v) in qaNativeGraphics() { dump[k] = v }
            } else {
                dump["elements"] = (await qaJS(Self.qaWebDumpJS)) ?? []
                if let x = await qaJS(Self.qaWebExtrasJS) as? [String: Any] { for (k, v) in x { dump[k] = v } } // QA-H2
                dump["ax"] = (await qaJS(Self.qaWebAxJS)) ?? [] // B3.3：读屏名称表（aria-label / role / aria-live），原生页之后逐项比 label
            }
            let file = outDir.appendingPathComponent("\(st)_\(tag).json")
            if let data = try? JSONSerialization.data(withJSONObject: dump, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: file) }
            // 通知宿主截图，等回执
            let ack = Self.qaDir.appendingPathComponent("ack-\(i)")
            try? "\(i) \(st)".write(to: Self.qaDir.appendingPathComponent("ready"), atomically: true, encoding: .utf8)
            _ = await qaWait(90) { fm.fileExists(atPath: ack.path) }
        }
        try? "done".write(to: Self.qaDir.appendingPathComponent("done"), atomically: true, encoding: .utf8)
    }

    /// QA-H4：等原生界面落定再取证——没有进行中的转场（任一视图控制器的 transitionCoordinator / isBeingPresented 等）、
    /// 没有在跑的有限动画（无限重复的转圈不算），并且相邻两次（80ms）取样里全部图层的呈现位置 / 大小不变。最多等 4 秒。
    /// 网页一侧不需要（网页参考在浏览器里取，不走原生转场）。
    func qaSettleNative() async {
        guard let window = view.window else { return }
        func busy(_ vc: UIViewController?, _ depth: Int = 0) -> Bool {
            guard let vc, depth < 12 else { return false }
            if vc.transitionCoordinator != nil || vc.isBeingPresented || vc.isBeingDismissed || vc.isMovingToParent || vc.isMovingFromParent { return true }
            return vc.children.contains { busy($0, depth + 1) } || busy(vc.presentedViewController, depth + 1)
        }
        func snapshot(_ layer: CALayer, _ sig: inout [Double], _ animating: inout Bool) {
            if sig.count > 40_000 { return }
            // QA-H5：长动画（≥1s，如 Toast / 撤销条的计时线 3–5s 线性收尽）是倒计时的画面，不是转场：既不算「在动」，
            // 也不进位置签名——否则整整等满 4s，浮条的自动收起 / 撤销机会的到期定时器先于取证触发（浮条消失 / 半透明 / 已还原）。
            // 短动画（转场、淡入淡出 < 1s）照旧要等。
            var longRunning = false
            if let keys = layer.animationKeys() {
                for k in keys {
                    guard let a = layer.animation(forKey: k), a.repeatCount < 1e6, a.repeatDuration == 0 || a.repeatDuration < 1e6 else { continue }
                    if a.duration * Double(max(1, a.repeatCount)) >= 1 { longRunning = true } else { animating = true }
                }
            }
            if longRunning {
                for sub in layer.sublayers ?? [] {
                    if let host = sub.delegate as? UIView, host is WKWebView { continue }
                    snapshot(sub, &sig, &animating)
                }
                return
            }
            let p = layer.presentation() ?? layer
            sig.append(contentsOf: [Double(p.position.x), Double(p.position.y), Double(p.bounds.width), Double(p.bounds.height), Double(p.opacity)].map { ($0 * 10).rounded() / 10 })
            for sub in layer.sublayers ?? [] {
                if let host = sub.delegate as? UIView, host is WKWebView { continue }
                snapshot(sub, &sig, &animating)
            }
        }
        var last: [Double] = []
        var stable = 0
        let end = Date().addingTimeInterval(4)
        while Date() < end {
            var sig: [Double] = []
            var animating = false
            snapshot(window.layer, &sig, &animating)
            let moving = busy(window.rootViewController)
            if !moving, !animating, sig == last { stable += 1 } else { stable = 0 }
            last = sig
            if stable >= 2 { return }
            try? await Task.sleep(nanoseconds: 80_000_000)
        }
    }

    /// 原生元素清单：窗口里除 WKWebView 之外的全部可见视图（原生写字页、弹层、撤销条、确认框），控件与文字一项一条。
    /// 每条带：属性名（Mirror 取原生页上的成员名，作稳定的语义键）、accessibilityIdentifier / Label / Frame、
    /// 窗口坐标 frame（pt）、文字、文字色 / 底色 / 边框色（按当前外观解析成 #RRGGBBAA）、字号与字重、是否可点。
    func qaNativeElements() -> [[String: Any]] { qaNativeDump().0 }

    /// 元素清单 + QA-H2 屏外一份（滚动区里滚得到、此刻在屏外的元素，同一形状、带 off: true）。
    func qaNativeDump() -> ([[String: Any]], [[String: Any]]) {
        guard let window = view.window else { return ([], []) }
        let names = qaNames()
        var out: [[String: Any]] = []
        var offOut: [[String: Any]] = []
        func visible(_ v: UIView) -> Bool {
            var cur: UIView? = v
            var alpha: CGFloat = 1
            while let c = cur {
                if c.isHidden { return false }
                alpha *= c.alpha
                cur = c.superview
            }
            return alpha > 0.02
        }
        let covered = qaCoveredViews()
        func walk(_ v: UIView) {
            if v is WKWebView || covered.contains(ObjectIdentifier(v)) { return }
            // B3.5d：系统 Tab 栏按项取（每个 tab 一个按钮：网页 Tabs 的 tab-* 同形状），不往系统私有子视图里走
            if let bar = v as? UITabBar {
                if v.window != nil, visible(v) { out.append(contentsOf: qaTabBarElements(bar, in: window)) }
                return
            }
            if v.window != nil, visible(v), v.bounds.width > 0.5, v.bounds.height > 0.5 {
                let f = v.convert(v.bounds, to: window)
                // 字帖格上的日期角标（骑在格的上边线上）：网页取证的是格按钮本身（屏内 / 屏外按按钮的框），原生按格的框判屏内 / 屏外，两边同口径
                let rf = (v is UILabel && v.superview is ShiziPaperCell) ? v.superview!.convert(v.superview!.bounds, to: window) : f
                let onScreen = rf.intersects(window.bounds)
                var e: [String: Any] = [:]
                let name = names[ObjectIdentifier(v)]
                if let b = v as? UIButton {
                    e["kind"] = "button"
                    e["text"] = (b.currentTitle ?? b.titleLabel?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if let rb = b as? ShiziRowButton { e["text"] = rb.composedText } // B3.2 列表行：按钮里两段字（网页按钮的字 = 里面全部文字）
                    e["color"] = hex(b.currentTitleColor, v)
                    e["enabled"] = b.isEnabled
                    if let font = b.titleLabel?.font { e["fontSize"] = font.pointSize; e["fontWeight"] = weight(font) }
                    if b.currentImage != nil, let iv = b.imageView, !iv.isHidden {
                        let fi = iv.convert(iv.bounds, to: window)
                        e["hasIcon"] = true; e["tint"] = hex(b.tintColor, v)
                        e["iconFrame"] = ["x": r(fi.minX), "y": r(fi.minY), "w": r(fi.width), "h": r(fi.height)]
                    }
                    if let rb = b as? ShiziRowButton {
                        // 两段字的文字框并集（网页按钮 = 全部文字节点的并集）
                        var u = CGRect.null
                        for l in [rb.label, rb.valueLabel] where !l.isHidden && !(l.text ?? "").isEmpty {
                            let tr = l.textRect(forBounds: l.bounds, limitedToNumberOfLines: l.numberOfLines)
                            let tx = l.textAlignment == .right ? l.bounds.width - tr.width : l.textAlignment == .center ? (l.bounds.width - tr.width) / 2 : tr.minX
                            var th = tr.height
                            // 钉住行盒的标签（宋体标题）：同上面文字标签的口径，网页文字框 = 字体内容区（升部 + 降部），中线不变
                            if let a = l.attributedText, a.length > 0, let ps = a.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle, ps.minimumLineHeight > 0,
                               let f = a.attribute(.font, at: 0, effectiveRange: nil) as? UIFont {
                                let lines = max(1, (tr.height / ps.minimumLineHeight).rounded())
                                th = (lines - 1) * ps.minimumLineHeight + (f.ascender - f.descender)
                            }
                            u = u.union(l.convert(CGRect(x: tx, y: (l.bounds.height - th) / 2, width: tr.width, height: th), to: window))
                        }
                        if !u.isNull { e["textFrame"] = ["x": r(u.minX), "y": r(u.minY), "w": r(u.width), "h": r(u.height)] }
                    } else if let tl = b.titleLabel, !(tl.text ?? "").isEmpty {
                        // 字在标题标签里竖向居中（UILabel 的画法；标签比字高时 textRect 给的是贴顶的框）
                        let tr = tl.textRect(forBounds: tl.bounds, limitedToNumberOfLines: tl.numberOfLines)
                        var th = tr.height
                        // 钉住行盒的标题（行尾带图标的按钮 ShiziTrailIconButton：富文本里的段落样式给了固定行高）：同上面文字标签的口径——网页文字框是字体内容区（升部 + 降部），不是行盒，中线不变
                        if b is ShiziTrailIconButton, let a = b.attributedTitle(for: .normal), a.length > 0, let ps = a.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle, ps.minimumLineHeight > 0,
                           let f = a.attribute(.font, at: 0, effectiveRange: nil) as? UIFont {
                            let lines = max(1, (tr.height / ps.minimumLineHeight).rounded())
                            th = (lines - 1) * ps.minimumLineHeight + (f.ascender - f.descender)
                        }
                        let ft = tl.convert(CGRect(x: tr.minX, y: (tl.bounds.height - th) / 2, width: tr.width, height: th), to: window)
                        e["textFrame"] = ["x": r(ft.minX), "y": r(ft.minY), "w": r(ft.width), "h": r(ft.height)]
                    }
                } else if let l = v as? UILabel, let t = l.text, !t.isEmpty {
                    e["kind"] = "text"
                    e["text"] = t
                    e["color"] = hex(l.textColor, v)
                    e["fontSize"] = l.font.pointSize
                    e["fontWeight"] = weight(l.font)
                    // 文字实际占的矩形（标签框可能比字宽，居中 / 靠右时字的位置要按对齐算）
                    let tr = l.textRect(forBounds: l.bounds, limitedToNumberOfLines: l.numberOfLines)
                    var tx = tr.minX
                    switch l.textAlignment {
                    case .center: tx = (l.bounds.width - tr.width) / 2
                    case .right: tx = l.bounds.width - tr.width
                    default: break
                    }
                    var th = tr.height
                    // 钉住行盒的标签（fixLineBox：宋体标题等）：网页的文字框是字体内容区（升部 + 降部，Range.getClientRects），不是行盒——同口径换算（中线不变）
                    if let a = l.attributedText, a.length > 0, let ps = a.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle, ps.minimumLineHeight > 0,
                       let f = a.attribute(.font, at: 0, effectiveRange: nil) as? UIFont {
                        let lines = max(1, (tr.height / ps.minimumLineHeight).rounded())
                        th = (lines - 1) * ps.minimumLineHeight + (f.ascender - f.descender)
                    }
                    // 自己排字的标签（ShiziDrawnText：竖排题记等）报字实际占的矩形
                    let ft = l.convert((l as? ShiziDrawnText)?.drawnTextRect ?? CGRect(x: tx, y: (l.bounds.height - th) / 2, width: tr.width, height: th), to: window)
                    e["textFrame"] = ["x": r(ft.minX), "y": r(ft.minY), "w": r(ft.width), "h": r(ft.height)]
                    e["align"] = l.textAlignment == .center ? "center" : (l.textAlignment == .right ? "right" : "left")
                } else if name != nil || v.accessibilityIdentifier != nil || v is NativeInkView {
                    e["kind"] = "view"
                }
                // B2.9b「AX5 不溢出」：字是否被截断（行数不够 / 单行放不下）、是否被祖先裁掉（滚动视图按内容区算：滚得到就不算裁掉）
                let textView: UILabel? = (v as? UILabel) ?? (v as? UIButton)?.titleLabel
                if let l = textView, !(l.text ?? "").isEmpty, l.bounds.width > 2 {
                    // QA-H4：按「字实际怎么画」量。按钮标题的字距（trackTitle 的富文本）在布局时才灌进标题标签，先布局；
                    // 按钮有富文本标题时直接量富文本（带字距），不依赖标签此刻的 attributedText（取证时刻没铺好会量成不带字距的窄宽，或反过来）
                    (v as? UIButton)?.layoutIfNeeded()
                    l.layoutIfNeeded()
                    let need = l.sizeThatFits(CGSize(width: l.bounds.width, height: .greatestFiniteMagnitude))
                    var natural = l.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude))
                    if let b = v as? UIButton, let at = b.attributedTitle(for: .normal) ?? b.currentAttributedTitle, at.length > 0, l.numberOfLines == 1 {
                        let w = ceil(at.boundingRect(with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).width)
                        natural.width = w
                    }
                    // 钉住行盒的标签按行数比（字在行盒里的上下偏移会让量出来的高多几 pt，不是截断）
                    let box = ((l.attributedText?.length ?? 0) > 0 ? (l.attributedText?.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.minimumLineHeight : nil) ?? 0
                    let per = box > 0 ? box : l.font.lineHeight
                    let lines = max(1, (need.height / max(1, per)).rounded())
                    let room = max(1, (l.bounds.height / max(1, per)).rounded())
                    let truncated = l.numberOfLines == 1 ? natural.width > l.bounds.width + 1
                        : (box > 0 ? lines > room : need.height > l.bounds.height + 1.5) || (l.numberOfLines > 1 && lines > CGFloat(l.numberOfLines))
                    if truncated { e["truncated"] = true; e["textNeed"] = ["h": r(need.height), "lines": lines, "room": room, "box": r(box), "fontLine": r(l.font.lineHeight)] }
                    // clip：滚动视图按内容区（滚得到），其余裁切祖先按自身框；visible：此刻真能看见的部分（滚动视图按可见框），重叠只比看得见的部分
                    var clip = CGRect.infinite
                    var visible = window.bounds
                    var scrolls = false
                    var a: UIView? = l.superview
                    while let anc = a, anc !== window {
                        if let sv = anc as? UIScrollView {
                            scrolls = true
                            let origin = CGPoint(x: -sv.contentInset.left, y: -sv.contentInset.top)
                            clip = clip.intersection(sv.convert(CGRect(origin: origin, size: CGSize(width: max(sv.contentSize.width, sv.bounds.width), height: max(sv.contentSize.height + sv.contentInset.top + sv.contentInset.bottom, sv.bounds.height))), to: window))
                            visible = visible.intersection(sv.convert(sv.bounds, to: window))
                        } else if anc.clipsToBounds {
                            // B3.5d：滚动区外面的裁切祖先裁的是滚动区的视口，不是内容（滚得到就不算裁掉）——根页挂进 Tab 栏控制器后多了
                            // 系统的整窗裁切容器，滚到屏幕下面的内容不再按「被裁掉」算
                            if !scrolls { clip = clip.intersection(anc.convert(anc.bounds, to: window)) }
                            visible = visible.intersection(anc.convert(anc.bounds, to: window))
                        }
                        a = anc.superview
                    }
                    if !scrolls { clip = clip.intersection(window.bounds) }
                    let lf = l.convert(l.textRect(forBounds: l.bounds, limitedToNumberOfLines: l.numberOfLines), to: window)
                    if !clip.insetBy(dx: -0.5, dy: -0.5).contains(lf) { e["clipped"] = true }
                    if lf.minX < -0.5 || lf.maxX > window.bounds.width + 0.5 { e["offscreenX"] = true }
                    let own = (v is UIButton) ? v.convert(v.bounds, to: window) : lf
                    let vis = own.intersection(visible)
                    e["visibleFrame"] = vis.isNull || vis.isEmpty ? NSNull() : ["x": r(vis.minX), "y": r(vis.minY), "w": r(vis.width), "h": r(vis.height)] as Any
                } else if v is ShiziRowButton || v is ShiziLineButton {
                    // B3.7：自己不画字的整块按钮（字详情的头图格 / 记录格，字在它里面的标签里）：此刻看得见的部分 = 按滚动区 / 裁切祖先的可见框裁过的框（AX-01 重叠只比看得见的）
                    var visible = window.bounds
                    var a: UIView? = v.superview
                    while let anc = a, anc !== window {
                        if let sv = anc as? UIScrollView { visible = visible.intersection(sv.convert(sv.bounds, to: window)) }
                        else if anc.clipsToBounds { visible = visible.intersection(anc.convert(anc.bounds, to: window)) }
                        a = anc.superview
                    }
                    let vis = v.convert(v.bounds, to: window).intersection(visible)
                    e["visibleFrame"] = vis.isNull || vis.isEmpty ? NSNull() : ["x": r(vis.minX), "y": r(vis.minY), "w": r(vis.width), "h": r(vis.height)] as Any
                }
                // 所在的层：弹层 / 确认框 / 撤销条是盖在页面上的浮层（按设计会盖住页面），重叠只在同一层里查
                let layer = qaLayer(v, names)
                if !e.isEmpty { e["layer"] = layer }
                let reach = onScreen ? 1 : qaReach(v, rf, in: window)
                if !e.isEmpty, reach > 0, !(v.superview is UIButton) {
                    if reach == 2 { e["off"] = true }
                    e["frame"] = ["x": r(f.minX), "y": r(f.minY), "w": r(f.width), "h": r(f.height)]
                    // 只给读屏的元素（1 × 1、裁掉；网页 .sz-page__title--hidden 同一判据：框不超过 2 × 2）
                    if f.width <= 2 && f.height <= 2 { e["srOnly"] = true }
                    if let name { e["prop"] = name }
                    if let id = v.accessibilityIdentifier { e["id"] = id }
                    if v.isAccessibilityElement || v is UIButton {
                        e["axLabel"] = v.accessibilityLabel ?? ""
                        let af = v.accessibilityFrame
                        e["axFrame"] = ["x": r(af.minX), "y": r(af.minY), "w": r(af.width), "h": r(af.height)]
                    }
                    if let bg = v.backgroundColor, bg.cgColor.alpha > 0.01 { e["bg"] = hex(bg, v) }
                    if v.layer.borderWidth > 0, let bc = v.layer.borderColor { e["border"] = hex(UIColor(cgColor: bc), v); e["borderWidth"] = v.layer.borderWidth }
                    if v.layer.cornerRadius > 0 { e["radius"] = v.layer.cornerRadius }
                    e["class"] = String(describing: type(of: v))
                    if reach == 2 { offOut.append(e) } else { out.append(e) }
                }
            }
            if v is UIButton { return }
            for s in v.subviews { walk(s) }
        }
        walk(window)
        return (out, offOut)
    }

    /// 视图 → 原生页上的成员名（Mirror；弹层 / 撤销条 / 确认框带 sheet. / undoBar. / endDialog. 前缀）。
    func qaNames() -> [ObjectIdentifier: String] {
        var names: [ObjectIdentifier: String] = [:]
        func collectNames(_ obj: Any, prefix: String) {
            var m: Mirror? = Mirror(reflecting: obj)
            while let mm = m {
                for c in mm.children {
                    guard let label = c.label else { continue }
                    if let v = c.value as? UIView { names[ObjectIdentifier(v)] = prefix + label }
                    if let arr = c.value as? [UIView] { for (i, v) in arr.enumerated() { names[ObjectIdentifier(v)] = "\(prefix)\(label)[\(i)]" } }
                }
                m = mm.superclassMirror
            }
        }
        for page in stage.screens { collectNames(page, prefix: "") } // B3.2 通用原生页（backButton 等成员名）
        if let rv = nativeResultTop {
            collectNames(rv, prefix: "")
            if let sheet = rv.presentedViewController {
                collectNames(sheet, prefix: "sheet.")
                names[ObjectIdentifier(sheet.view)] = "sheet.view"
            }
            if let bar = rv.undoBarForTesting { collectNames(bar, prefix: "undoBar.") }
        }
        if let vc = nativeWriteTop {
            collectNames(vc, prefix: "")
            if let sheet = vc.presentedViewController {
                collectNames(sheet, prefix: "sheet.")
                names[ObjectIdentifier(sheet.view)] = "sheet.view"
            }
            if let bar = vc.undoBarForTesting { collectNames(bar, prefix: "undoBar.") }
            if let dlg = vc.endDialogForTesting { collectNames(dlg, prefix: "endDialog.") }
        }
        // B3.3：别的原生页（页面卡新加的宿主）：呈现出来的控制器按成员名取语义键，弹层同写字页的 sheet. 前缀
        if nativeResultTop == nil, nativeWriteTop == nil, let p = presentedViewController, !(p is ShiziScreenViewController), p.modalPresentationStyle == .custom {
            // R14：宿主直接呈现的弹层（根页的底部选择弹层等）同写字页的弹层，归 sheet 图层
            collectNames(p, prefix: "sheet.")
            names[ObjectIdentifier(p.view)] = "sheet.view"
        } else if nativeResultTop == nil, nativeWriteTop == nil, let p = presentedViewController {
            collectNames(p, prefix: "")
            if let sheet = p.presentedViewController, !(sheet is ShiziScreenViewController) { // 呈现在上面的原生页（B3.5c：根页之上推入的子页）不是弹层
                collectNames(sheet, prefix: "sheet.")
                names[ObjectIdentifier(sheet.view)] = "sheet.view"
            }
        }
        return names
    }

    /// 视图所在的层：弹层 / 确认框 / 撤销条是盖在页面上的浮层（按设计会盖住页面），其余 page。
    func qaLayer(_ v: UIView, _ names: [ObjectIdentifier: String]) -> String {
        var anc: UIView? = v
        while let x = anc {
            if let n = names[ObjectIdentifier(x)], let dot = n.firstIndex(of: "."), ["sheet", "endDialog", "undoBar"].contains(String(n[..<dot])) { return String(n[..<dot]) }
            if names[ObjectIdentifier(x)] == "sheet.view" { return "sheet" }
            if let vc = x.next as? NativeImagePreviewController, vc.view === x { return "sheet" } // QA-H3c：图片预览弹层也是盖在底页上的一层
            if x is NativeUndoBarView { return "undoBar" }
            if x is NativeEndDialogView { return "endDialog" }
            anc = x.superview
        }
        return "page"
    }

    /// QA-H2：原生一边的线（rules）、装饰（decos）、墨格（cells），窗口坐标 pt，与网页 qaWebExtrasJS 同一口径；屏外但滚得到的标 off。
    /// 走全部可见视图（含按钮里面的子视图；不进 WKWebView、系统 Tab 栏、被盖住的页、系统控件的内部）与它们自己的子图层：
    ///   rules：图层边框（四条边）、≤ 2pt 的有底色视图 / 图层、CAShapeLayer 描边里的横 / 竖直线段（路径外框 > 40pt 的）、
    ///          draw(_:) 自己画线的视图声明的线（ShiziDrawnLines）。颜色乘上透明度链。
    ///   decos：≤ 40pt 的图片（按 contentMode 算画出来的框；按钮图标同样）与 ≤ 40pt 的 CAShapeLayer；≤ 48pt 的圆（圆角 ≥ 短边一半、有底色或边框）。
    ///   cells：类名带 Ink / Glyph 的视图（墨格、字形）；单个汉字、字号 ≥ 24 的标签（框 = 字的框）。
    func qaNativeGraphics() -> [String: [[String: Any]]] {
        guard let window = view.window else { return [:] }
        let covered = qaCoveredViews()
        let names = qaNames()
        var rules: [[String: Any]] = [], decos: [[String: Any]] = [], cells: [[String: Any]] = []
        func rect(_ f: CGRect) -> [String: Double] { ["x": r(f.minX), "y": r(f.minY), "w": r(f.width), "h": r(f.height)] }
        func colorK(_ cg: CGColor?, _ v: UIView, _ k: CGFloat) -> String? {
            guard let cg, cg.alpha * k > 0.02 else { return nil }
            return hex(UIColor(cgColor: cg).withAlphaComponent(cg.alpha * k), v)
        }
        func place(_ v: UIView, _ f: CGRect, _ item: [String: Any], _ list: inout [[String: Any]]) {
            let reach = qaReach(v, f, in: window)
            guard reach > 0 else { return }
            var e = item
            for (k, x) in rect(f) { e[k] = x }
            if reach == 2 { e["off"] = true }
            e["layer"] = qaLayer(v, names) // 所在的层（盖在上面的弹层下的墨格不比像素）
            list.append(e)
        }
        func addRule(_ v: UIView, _ f: CGRect, _ color: String?, _ src: String) {
            guard let color, max(f.width, f.height) >= 3, min(f.width, f.height) <= 4, min(f.width, f.height) >= 0.25 else { return }
            place(v, f, ["color": color, "src": src], &rules)
        }
        /// 透明度链（隐藏 → nil）
        func alphaChain(_ v: UIView) -> CGFloat? {
            var k: CGFloat = 1
            var cur: UIView? = v
            while let c = cur {
                if c.isHidden || c.layer.isHidden { return nil }
                k *= c.alpha
                cur = c.superview
            }
            return k
        }
        func edges(_ l: CALayer, _ bw: CGFloat) -> [CGRect] {
            let b = l.bounds
            return [CGRect(x: b.minX, y: b.minY, width: b.width, height: bw), CGRect(x: b.minX, y: b.maxY - bw, width: b.width, height: bw),
                    CGRect(x: b.minX, y: b.minY, width: bw, height: b.height), CGRect(x: b.maxX - bw, y: b.minY, width: bw, height: b.height)]
        }
        func layerGraphics(_ l: CALayer, _ v: UIView, _ k: CGFloat) {
            if l.isHidden || l.opacity <= 0.01 { return }
            let toWin = { (q: CGRect) in l.convert(q, to: window.layer) }
            let f = toWin(l.bounds)
            let own = l === v.layer
            if l.borderWidth > 0 { for q in edges(l, l.borderWidth) { addRule(v, toWin(q), colorK(l.borderColor, v, k), "border") } }
            let bgCG = own ? v.backgroundColor?.resolvedColor(with: v.traitCollection).cgColor : l.backgroundColor
            let bg = colorK(bgCG, v, k)
            if bg != nil, (f.height <= 2 && f.width > 4) || (f.width <= 2 && f.height > 4) { addRule(v, f, bg, "thin") }
            // 圆
            if f.width >= 4, f.height >= 4, f.width <= 48, f.height <= 48, abs(f.width - f.height) <= 2, l.cornerRadius >= min(f.width, f.height) / 2 - 0.5 {
                let border = l.borderWidth > 0 ? colorK(l.borderColor, v, k) : nil
                if let c = bg ?? border { place(v, f, ["kind": "circle", "color": c], &decos) }
            }
            if let s = l as? CAShapeLayer, let p = s.path {
                // 图层有自己的框时按框（同网页 svg 元素框），没有时按路径外框
                let box = l.bounds.width > 0.5 && l.bounds.height > 0.5 ? f : toWin(p.boundingBoxOfPath)
                let stroke = s.lineWidth > 0 ? colorK(s.strokeColor, v, k) : nil
                if max(box.width, box.height) <= 40 {
                    if stroke != nil || colorK(s.fillColor, v, k) != nil, min(box.width, box.height) >= 2 { place(v, box, ["kind": "icon"], &decos) }
                } else {
                    // 大的形状图层：只有横 / 竖直线段的是线条图（格线、外框）→ 线；有曲线 / 斜线的是图画（笔迹、字形）→ 墨格（同网页大 svg 的分法）
                    var cur = CGPoint.zero, start = CGPoint.zero
                    var segs: [(CGPoint, CGPoint)] = []
                    var drawing = false
                    p.applyWithBlock { el in
                        let e = el.pointee
                        switch e.type {
                        case .moveToPoint: cur = e.points[0]; start = cur
                        case .addLineToPoint: segs.append((cur, e.points[0])); cur = e.points[0]
                        case .addQuadCurveToPoint: cur = e.points[1]; drawing = true
                        case .addCurveToPoint: cur = e.points[2]; drawing = true
                        case .closeSubpath: segs.append((cur, start)); cur = start
                        @unknown default: break
                        }
                    }
                    if segs.contains(where: { abs($0.0.x - $0.1.x) >= 0.05 && abs($0.0.y - $0.1.y) >= 0.05 && hypot($0.0.x - $0.1.x, $0.0.y - $0.1.y) >= 1 }) { drawing = true }
                    let lw = s.lineWidth
                    if drawing {
                        if stroke != nil || colorK(s.fillColor, v, k) != nil { place(v, box, ["kind": "ink", "class": "CAShapeLayer"], &cells) }
                        segs = []
                    }
                    if let stroke { for (a, b) in segs {
                        if abs(a.y - b.y) < 0.05, abs(a.x - b.x) >= 2 { addRule(v, toWin(CGRect(x: min(a.x, b.x), y: a.y - lw / 2, width: abs(a.x - b.x), height: lw)), stroke, "shape") }
                        else if abs(a.x - b.x) < 0.05, abs(a.y - b.y) >= 2 { addRule(v, toWin(CGRect(x: a.x - lw / 2, y: min(a.y, b.y), width: lw, height: abs(a.y - b.y))), stroke, "shape") }
                    } }
                }
            }
            for sub in l.sublayers ?? [] where !(sub.delegate is UIView) { layerGraphics(sub, v, k * CGFloat(sub.opacity)) }
        }
        func walk(_ v: UIView) {
            if v is WKWebView || v is UITabBar || covered.contains(ObjectIdentifier(v)) { return }
            guard v.window != nil || v is UIWindow, let k = alphaChain(v), k > 0.02 else { return }
            let cls = String(describing: type(of: v))
            let f = v.convert(v.bounds, to: window)
            if f.width > 0.25 || f.height > 0.25 {
                layerGraphics(v.layer, v, k)
                if let d = v as? ShiziDrawnLines { for (q, c) in d.drawnLines { addRule(v, v.convert(q, to: window), colorK(c.resolvedColor(with: v.traitCollection).cgColor, v, k), "drawn") } }
                if let iv = v as? UIImageView, let img = iv.image, img.size.width > 0, img.size.height > 0, !Self.qaBlank(img) {
                    let b = iv.bounds, sz = img.size
                    var dr = b
                    switch iv.contentMode {
                    case .center: dr = CGRect(x: b.midX - sz.width / 2, y: b.midY - sz.height / 2, width: sz.width, height: sz.height)
                    case .scaleAspectFit:
                        let sc = min(b.width / sz.width, b.height / sz.height)
                        dr = CGRect(x: b.midX - sz.width * sc / 2, y: b.midY - sz.height * sc / 2, width: sz.width * sc, height: sz.height * sc)
                    default: break
                    }
                    let fd = iv.convert(dr, to: window)
                    if max(fd.width, fd.height) <= 40 { if min(fd.width, fd.height) >= 2 { place(v, fd, ["kind": "icon"], &decos) } }
                    else if min(fd.width, fd.height) >= 8 { place(v, fd, ["kind": "image"], &cells) } // 大图（笔迹图、照片）当格比
                }
                if cls.contains("Ink") || cls.contains("Glyph") { place(v, f, ["kind": "ink", "class": cls], &cells) }
                if let l = v as? UILabel, let t = l.text, t.count == 1, let u = t.unicodeScalars.first, (0x3400...0x9FFF).contains(u.value) || (0xF900...0xFAFF).contains(u.value), l.font.pointSize >= 24 {
                    let tr = l.textRect(forBounds: l.bounds, limitedToNumberOfLines: 1)
                    let tx = l.textAlignment == .center ? (l.bounds.width - tr.width) / 2 : (l.textAlignment == .right ? l.bounds.width - tr.width : tr.minX)
                    let th = l.font.ascender - l.font.descender
                    place(v, l.convert(CGRect(x: tx, y: (l.bounds.height - th) / 2, width: tr.width, height: th), to: window), ["kind": "glyph", "text": t], &cells)
                }
            }
            // 不进系统控件的内部
            if v is UISwitch || v is UIDatePicker || v is UITextField || v is UITextView || v is UIVisualEffectView
                || v is UIActivityIndicatorView || v is UIPickerView || v is UISegmentedControl || v is UISlider { return }
            for s in v.subviews { walk(s) }
        }
        walk(window)
        return ["rules": rules, "decos": decos, "cells": cells]
    }

    /// 全透明的图片（只为让按钮有个「图标框」放的空图）：画不出任何东西，不算装饰 / 墨格。缩到 16×16 看透明度。
    static func qaBlank(_ img: UIImage) -> Bool {
        let n = 16
        var px = [UInt8](repeating: 0, count: n * n * 4)
        guard let ctx = CGContext(data: &px, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        UIGraphicsPushContext(ctx)
        img.draw(in: CGRect(x: 0, y: 0, width: n, height: n))
        UIGraphicsPopContext()
        return !stride(from: 3, to: px.count, by: 4).contains { px[$0] > 2 }
    }

    /// 不取的视图：原生栈里被盖住的下层页、被盖住的根页（与 Tab 栏）。
    func qaCoveredViews() -> Set<ObjectIdentifier> {
        // B3.2：原生栈里被盖住的下层页不取（网页同样只取顶层图层）
        // QA-H3c：图片预览宿主是透明的一层（弹层从它上面升起，网页参考里底页看得见且照列），它下面的那一页不当作被盖住
        let screens = stage.screens
        var covered = Set(screens.indices.dropLast().filter { !(screens[$0 + 1] is ShiziScreen_image_preview) }.map { ObjectIdentifier(screens[$0].view) })
        // 根页被盖住（NativeStage.isCovered：呈现链里有不透明的原生子页或写字 / 结果页）同样不取（网页只取顶层图层；B3.8 发现，主控补呈现页一支）；
        // R14 / B3.6：透明的原生弹层屏（查字 / S02）与底部弹层下面的根页看得见，网页参考同样列出它，照取
        if let root = stage.rootScreen, stage.isCovered(root) {
            covered.insert(ObjectIdentifier(root.view))
            if let t = stage.tabHost { covered.insert(ObjectIdentifier(t)) } // B3.5d：原生 Tab 栏随根页一起被盖住
        }
        return covered
    }

    /// QA-H2：一块（窗口坐标 f，属于视图 v）看不看得到——1 在屏上；2 在屏外、但在第一个滚动区祖先的内容区里（滚得到；滚动区本身在屏上），
    /// 途中没有被不滚的裁切祖先裁掉；0 看不到。网页 qaWebCoreJS reach 同一口径。
    func qaReach(_ v: UIView, _ f: CGRect, in window: UIWindow) -> Int {
        // 贴着屏幕边（弹层上沿外面那条发丝线）算在屏上：同网页 onScreenRect 的「不在屏外」口径（边界上的也算）
        if f.insetBy(dx: -0.5, dy: -0.5).intersects(window.bounds) { return 1 }
        var a: UIView? = v.superview
        while let anc = a, anc !== window {
            let af = anc.convert(anc.bounds, to: window)
            if let sv = anc as? UIScrollView {
                let origin = CGPoint(x: -sv.contentInset.left, y: -sv.contentInset.top)
                let size = CGSize(width: max(sv.contentSize.width + sv.contentInset.left + sv.contentInset.right, sv.bounds.width),
                                  height: max(sv.contentSize.height + sv.contentInset.top + sv.contentInset.bottom, sv.bounds.height))
                let content = sv.convert(CGRect(origin: origin, size: size), to: window)
                return af.intersects(window.bounds) && content.intersects(f) ? 2 : 0
            }
            if anc.clipsToBounds && !af.intersects(f) { return 0 }
            a = anc.superview
        }
        return 0
    }

    /// B3.5d：原生 Tab 栏的三项（语义键 native-tab-<屏名> ↔ 网页 tab-<屏名>）。按钮框 = 系统 Tab 栏里带这个 accessibilityIdentifier 的那一格
    /// （找不到时按栏宽三等分）；字 / 图标框取格里的标签与图标视图；字色 / 图标色按选中态取 Tab 栏的令牌色，字号字重取 ShiziTabController.labelFont。
    /// 与网页参考的外观差异（iOS 26 浮起玻璃、格宽、字与图标的位置）是具名豁免 TAB-01（parity.config.json），文案与有无照比。
    func qaTabBarElements(_ bar: UITabBar, in window: UIWindow) -> [[String: Any]] {
        guard let items = bar.items else { return [] }
        var out: [[String: Any]] = []
        func find(_ v: UIView, _ id: String) -> UIView? {
            if v.accessibilityIdentifier == id { return v }
            for s in v.subviews { if let hit = find(s, id) { return hit } }
            return nil
        }
        func firstOf<T: UIView>(_ type: T.Type, in v: UIView) -> T? {
            if let t = v as? T, !v.isHidden, v.alpha > 0.01, v.bounds.width > 0.5 { return t }
            for s in v.subviews { if let hit = firstOf(type, in: s) { return hit } }
            return nil
        }
        func findLabel(_ v: UIView, _ text: String) -> UILabel? {
            if let l = v as? UILabel, l.text == text, !l.isHidden, l.alpha > 0.01, l.window != nil { return l }
            for s in v.subviews { if let hit = findLabel(s, text) { return hit } }
            return nil
        }
        func rect(_ f: CGRect) -> [String: Double] { ["x": r(f.minX), "y": r(f.minY), "w": r(f.width), "h": r(f.height)] }
        let barFrame = bar.convert(bar.bounds, to: window)
        for (i, item) in items.enumerated() {
            let id = item.accessibilityIdentifier ?? "native-tab-\(i)"
            let selected = bar.selectedItem === item
            // 系统 Tab 栏里这一格：带 accessibilityIdentifier 的视图；iOS 26 不把它带到格视图上时，按标题找格里的标签、往上取类名带 Button 的那一层
            var cell = find(bar, id)
            if cell == nil, let title = item.title, let label = findLabel(bar, title) {
                var anc: UIView? = label.superview
                while let a = anc, a !== bar, !String(describing: type(of: a)).contains("Button") { anc = a.superview }
                cell = (anc === bar || anc == nil) ? label.superview : anc
            }
            let w = barFrame.width / CGFloat(items.count)
            let f = cell.map { $0.convert($0.bounds, to: window) } ?? CGRect(x: barFrame.minX + w * CGFloat(i), y: barFrame.minY, width: w, height: min(barFrame.height, 49))
            var e: [String: Any] = ["kind": "button", "id": id, "text": item.title ?? "", "enabled": item.isEnabled, "layer": "tabBar", "class": "UITabBarItem",
                                    "frame": rect(f), "axLabel": item.title ?? "", "selected": selected,
                                    "color": hex(selected ? bar.tintColor : bar.unselectedItemTintColor, bar),
                                    "fontSize": ShiziTabController.labelFont.pointSize, "fontWeight": weight(ShiziTabController.labelFont), "hasIcon": item.image != nil]
            if let cell {
                // 看得见的部分 = 图标 ∪ 标签（系统格的点按区左右互相搭一点，AX-01 的「不互相压住」比的是看得见的字与图标）
                var seen = CGRect.null
                if let l = firstOf(UILabel.self, in: cell) { let lf = l.convert(l.bounds, to: window); e["textFrame"] = rect(lf); seen = seen.union(lf) }
                if let iv = firstOf(UIImageView.self, in: cell) { let fi = iv.convert(iv.bounds, to: window); e["iconFrame"] = rect(fi); seen = seen.union(fi) }
                if !seen.isNull { e["visibleFrame"] = rect(seen) }
            }
            out.append(e)
        }
        return out
    }

    private func r(_ x: CGFloat) -> Double { (Double(x) * 10).rounded() / 10 }

    private func weight(_ font: UIFont) -> Double {
        let traits = font.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]
        return (traits?[.weight] as? NSNumber)?.doubleValue ?? 0
    }

    private func hex(_ c: UIColor?, _ v: UIView) -> String {
        guard let c else { return "" }
        let rc = c.resolvedColor(with: v.traitCollection)
        var rr: CGFloat = 0, gg: CGFloat = 0, bb: CGFloat = 0, aa: CGFloat = 0
        if !rc.getRed(&rr, green: &gg, blue: &bb, alpha: &aa) {
            var w: CGFloat = 0
            if rc.getWhite(&w, alpha: &aa) { rr = w; gg = w; bb = w }
        }
        func h(_ x: CGFloat) -> String { String(format: "%02X", Int((min(max(x, 0), 1) * 255).rounded())) }
        return "#" + h(rr) + h(gg) + h(bb) + h(aa)
    }

    // MARK: 页面脚本

    /// 网页元素清单：顶层图层与其上的弹层 / 确认框 / 撤销条里可见的控件与文字（与原生清单同一形状）。
    /// QA-H2：清单本身（elements）不变；qaWebExtrasJS 用同一份收集函数另取滚动区里屏外的元素（offscreen）与线 / 装饰 / 墨格。
    static let qaWebDumpJS = qaWebCoreJS + "\nreturn collect(false).out;"

    static let qaWebCoreJS = #"""
    const app = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const roots = [top, ...document.querySelectorAll('.sz-sheet, .sz-confirm, .sz-undobar, .sz-toast, .sz-corrupt, [role="dialog"], [role="alertdialog"]')].filter(Boolean);
    const uniq = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    const hex = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return '';
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      const a = p.length > 3 ? p[3] : 1;
      const h = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0').toUpperCase();
      return '#' + h(p[0]) + h(p[1]) + h(p[2]) + h(a * 255);
    };
    const visible = (el) => {
      let op = 1;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        op *= Number(cs.opacity);
        if (e.getAttribute('aria-hidden') === 'true' && e.classList.contains('sz-layer__screen') && e.closest('.sz-layer') !== top) return false;
      }
      return op > 0.02;
    };
    const ownText = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    const fullText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const weight = (w) => ({ 100: -0.8, 200: -0.6, 300: -0.4, 400: 0, 500: 0.23, 600: 0.3, 700: 0.4, 800: 0.56, 900: 0.62 })[Number(w)] ?? 0;
    // QA-H2：屏外的东西是否滚得到——1 = 在屏上；2 = 在屏外、但在第一个能滚的祖先（overflow auto / scroll 且内容比框大、框在屏上）里，途中没有被不滚的裁切祖先裁掉；0 = 看不到
    const onScreenRect = (q) => !(q.right < 0 || q.bottom < 0 || q.left > W || q.top > H);
    const reach = (el, q) => {
      if (onScreenRect(q)) return 1;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const ar = a.getBoundingClientRect();
        const sx = /(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1;
        const sy = /(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1;
        if (sx || sy) return onScreenRect(ar) ? 2 : 0;
        if (/(hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY) && (q.right < ar.left || q.left > ar.right || q.bottom < ar.top || q.top > ar.bottom)) return 0;
      }
      return 0;
    };
    const collect = (includeOff) => {
    const out = [], off = [];
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (uniq.has(el)) continue;
        if (el.closest('button') && el.tagName !== 'BUTTON') continue;
        const tid = el.dataset ? el.dataset.testid : undefined;
        const isBtn = el.tagName === 'BUTTON';
        const txt = isBtn ? fullText(el) : ownText(el);
        const isCanvas = el.tagName === 'CANVAS' || el.tagName === 'svg';
        if (!isBtn && !tid && !txt) continue;
        if (isCanvas && !tid) continue;
        const rc = el.getBoundingClientRect();
        if (rc.width < 0.5 || rc.height < 0.5) continue;
        let dest = out;
        if (rc.right < 0 || rc.bottom < 0 || rc.left > W || rc.top > H) { if (!includeOff || reach(el, rc) !== 2) continue; dest = off; }
        if (!visible(el)) continue;
        uniq.add(el);
        const cs = getComputedStyle(el);
        const e = { kind: isBtn ? 'button' : (txt ? 'text' : 'view'), frame: { x: Math.round(rc.left * 10) / 10, y: Math.round(rc.top * 10) / 10, w: Math.round(rc.width * 10) / 10, h: Math.round(rc.height * 10) / 10 }, tag: el.tagName.toLowerCase(), class: el.getAttribute('class') || '' };
        if (tid) e.id = tid;
        if (txt) e.text = txt;
        const aria = el.getAttribute('aria-label');
        if (aria) e.axLabel = aria;
        if (txt || isBtn) { e.color = hex(cs.color); e.fontSize = parseFloat(cs.fontSize); e.fontWeight = weight(cs.fontWeight); e.align = cs.textAlign === 'center' ? 'center' : (cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : 'left'); }
        if (txt) {
          // 文字实际占的矩形（所有文字节点的并集）
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            // 只跳过元素自己里面的读屏隐藏装饰；整个图层被 aria-hidden（弹层下面的页，R16）不算——否则弹层下的标题没有 textFrame，对比退回到盒子（含内边距）
            const hid = n.parentElement && n.parentElement.closest('[aria-hidden="true"]');
            if (hid && hid !== el && el.contains(hid) && !isBtn) continue;
            const range = document.createRange(); range.selectNodeContents(n);
            for (const q of range.getClientRects()) { if (q.width < 0.1) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
          }
          if (r > l) e.textFrame = { x: Math.round(l * 10) / 10, y: Math.round(t * 10) / 10, w: Math.round((r - l) * 10) / 10, h: Math.round((b - t) * 10) / 10 };
        }
        if (rc.width <= 2 && rc.height <= 2) e.srOnly = true;
        const icon = isBtn ? el.querySelector('svg') : null;
        if (icon) { const q = icon.getBoundingClientRect(); e.iconFrame = { x: Math.round(q.left * 10) / 10, y: Math.round(q.top * 10) / 10, w: Math.round(q.width * 10) / 10, h: Math.round(q.height * 10) / 10 }; }
        if (isBtn) e.enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
        const bg = hex(cs.backgroundColor);
        if (bg && !bg.endsWith('00')) e.bg = bg;
        const bw = parseFloat(cs.borderTopWidth);
        if (bw > 0 && cs.borderTopStyle !== 'none') { e.border = hex(cs.borderTopColor); e.borderWidth = bw; }
        const rad = parseFloat(cs.borderTopLeftRadius);
        if (rad > 0) e.radius = rad;
        if (isBtn && el.querySelector('svg')) e.hasIcon = true;
        if (dest === off) e.off = true;
        dest.push(e);
      }
    }
    return { out, off };
    };
    """#

    /// QA-H2：网页一边的屏外元素（offscreen：滚动区里滚得到的）、线（rules）、装饰（decos）、墨格（cells），窗口坐标 pt；屏外的标 off。
    ///   rules：每条看得见的边框边（≥ 0.25px、不透明）、0 模糊的 box-shadow 细条（inset 框 / 偏移线，≤ 4pt）、≤ 2pt 高 / 宽的有底色元素、
    ///          大于 40pt 的 svg 里的横 / 竖直线段（path / line / rect / polyline 的描边）。颜色乘上祖先透明度。
    ///   decos：≤ 40pt 的 svg / img（图标、chevron、箭头）；≤ 48pt 的圆（圆角 ≥ 短边一半、有底色 / 边框 / inset 阴影；选中日圆底、圆按钮底）。
    ///   cells：canvas（墨格：笔迹 / 衬底字）与单个汉字、字号 ≥ 24 的文字（字形格，框 = 文字框）。
    static let qaWebExtrasJS = qaWebCoreJS + #"""

    const R1 = (x) => Math.round(x * 10) / 10;
    const fr = (l, t, w, h) => ({ x: R1(l), y: R1(t), w: R1(w), h: R1(h) });
    const opa = (el) => { let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(getComputedStyle(e).opacity); return op; };
    const rgbaOf = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const hexK = (c, k) => { const p = rgbaOf(c); if (!p) return ''; return hex(`rgba(${p[0]}, ${p[1]}, ${p[2]}, ${p[3] * k})`); };
    const alphaOf = (c) => { const p = rgbaOf(c); return p ? p[3] : 0; };
    const rules = [], decos = [], cells = [];
    const place = (el, q, item, list) => {
      const r = reach(el, { left: q.x, top: q.y, right: q.x + q.w, bottom: q.y + q.h });
      if (!r) return;
      if (r === 2) item.off = true;
      list.push(item);
    };
    const addRule = (el, x, y, w, h, color, src) => {
      if (!(Math.max(w, h) >= 3) || Math.min(w, h) > 4 || Math.min(w, h) < 0.25 || !color || color.endsWith('00')) return;
      place(el, { x, y, w, h }, { ...fr(x, y, w, h), color, src }, rules);
    };
    const shadows = (v) => {
      if (!v || v === 'none') return [];
      const parts = []; let depth = 0, cur = '';
      for (const ch of v) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      return parts.map(p => { const color = (/rgba?\([^)]*\)/.exec(p) || [''])[0]; const nums = p.replace(color, '').match(/-?[\d.]+px|(?:^|\s)0(?=\s|$)/g) || []; return { color, inset: /\binset\b/.test(p), n: nums.map(parseFloat) }; });
    };
    const segsOfPath = (d) => {
      const tok = (d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
      const out = []; let i = 0, cmd = 'M', x = 0, y = 0, sx = 0, sy = 0, guard = 0;
      const isCmd = () => /[A-Za-z]/.test(tok[i]);
      const num = () => parseFloat(tok[i++]);
      while (i < tok.length && guard++ < 10000) {
        if (isCmd()) cmd = tok[i++];
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        if (C === 'Z') { out.push([x, y, sx, sy]); x = sx; y = sy; cmd = rel ? 'l' : 'L'; continue; }
        if (i >= tok.length || isCmd()) continue;
        if (C === 'M') { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
        else if (C === 'L') { const nx = num(), ny = num(); const tx = rel ? x + nx : nx, ty = rel ? y + ny : ny; out.push([x, y, tx, ty]); x = tx; y = ty; }
        else if (C === 'H') { const nx = num(); const tx = rel ? x + nx : nx; out.push([x, y, tx, y]); x = tx; }
        else if (C === 'V') { const ny = num(); const ty = rel ? y + ny : ny; out.push([x, y, x, ty]); y = ty; }
        else { const n = { C: 6, S: 4, Q: 4, T: 2, A: 7 }[C] || 2; const v = []; for (let k = 0; k < n; k++) v.push(num()); x = rel ? x + v[n - 2] : v[n - 2]; y = rel ? y + v[n - 1] : v[n - 1]; }
      }
      return out;
    };
    const svgSegs = (g) => {
      const t = g.tagName.toLowerCase();
      const n = (a) => (g[a] && g[a].baseVal ? g[a].baseVal.value : 0);
      if (t === 'path') return segsOfPath(g.getAttribute('d'));
      if (t === 'line') return [[n('x1'), n('y1'), n('x2'), n('y2')]];
      if (t === 'rect') { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); return [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]]; }
      if (t === 'polyline' || t === 'polygon') { const p = [...(g.points || [])].map(q => [q.x, q.y]); const s = []; for (let k = 1; k < p.length; k++) s.push([...p[k - 1], ...p[k]]); if (t === 'polygon' && p.length > 2) s.push([...p[p.length - 1], ...p[0]]); return s; }
      return [];
    };
    const CJK1 = /^[㐀-鿿豈-﫿]$/;
    // 装饰性的伪元素（::before / ::after 有底色 / 边框 / inset 阴影：写错前面的朱点、格里的辅助线）没有自己的框：插一个同样式的临时 span 量出框、马上拿掉
    // （同一段同步脚本里插、量、删，中间不渲染；截图在这之后）。量的时候用一条临时样式把真的伪元素藏起，免得两个并排挤开位置。
    const probeStyle = document.createElement('style');
    probeStyle.textContent = '[data-qa-pseudo="before"]::before,[data-qa-pseudo="after"]::after{display:none !important}';
    document.head.appendChild(probeStyle);
    const PSEUDO_PROPS = ['display', 'position', 'left', 'right', 'top', 'bottom', 'width', 'height', 'minWidth', 'minHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'flex', 'flexShrink', 'alignSelf', 'verticalAlign', 'boxSizing', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle',
      'borderBottomStyle', 'borderLeftStyle', 'transform', 'inset'];
    const pseudoBoxes = (el) => {
      const out = [];
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(el, which);
        if (!ps || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
        const deco = alphaOf(ps.backgroundColor) > 0.02 || ['Top', 'Right', 'Bottom', 'Left'].some(sd => parseFloat(ps[`border${sd}Width`]) > 0 && !/none|hidden/.test(ps[`border${sd}Style`]) && alphaOf(ps[`border${sd}Color`]) > 0.02)
          || shadows(ps.boxShadow).some(sh => alphaOf(sh.color) > 0.02 && !(sh.n[2] > 0));
        if (!deco || /^["'].+["']$/.test(ps.content)) continue; // 有字的伪元素（›、角标）不量
        // 跟在字前 / 后的伪元素（不脱离文档流，例：「写错」前的朱点）：按字的框推出位置（字的左缘 − 间距 − 外边距 − 宽，竖向对字居中）；
        // 插临时 span 量这一类会被 flex / 行内排版挤开，量不准
        if (!/absolute|fixed/.test(ps.position)) {
          const texts = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
          const tn = which === '::before' ? texts[0] : texts[texts.length - 1];
          const w = parseFloat(ps.width), h = parseFloat(ps.height);
          if (tn && w > 0 && h > 0) {
            const range = document.createRange(); range.selectNodeContents(tn);
            const rs = [...range.getClientRects()].filter(r => r.width > 0);
            const t = which === '::before' ? rs[0] : rs[rs.length - 1];
            if (t) {
              const ecs = getComputedStyle(el);
              const gap = /flex|grid/.test(ecs.display) ? (parseFloat(ecs.columnGap) || 0) : 0;
              const left = which === '::before' ? t.left - gap - (parseFloat(ps.marginRight) || 0) - w : t.right + gap + (parseFloat(ps.marginLeft) || 0);
              const top = t.top + (t.height - h) / 2;
              out.push({ q: { left, top, width: w, height: h, right: left + w, bottom: top + h }, cs: ps });
              continue;
            }
          }
        }
        const probe = document.createElement('span');
        for (const k of PSEUDO_PROPS) { try { probe.style[k] = ps[k]; } catch (e) {} }
        el.setAttribute('data-qa-pseudo', which.slice(2));
        if (which === '::before') el.insertBefore(probe, el.firstChild); else el.appendChild(probe);
        const q = probe.getBoundingClientRect();
        probe.remove();
        el.removeAttribute('data-qa-pseudo');
        if (q.width > 0 || q.height > 0) out.push({ q, cs: ps });
      }
      return out;
    };
    // 一个框（元素或伪元素）的线与圆：边框边、0 模糊 box-shadow 细条（inset 框 / 偏移线，外圈同理）、细的有底色框（分隔条）、≤ 48pt 的圆（选中日圆底、圆按钮底）
    const boxShapes = (el, rc, cs, k) => {
      const L = rc.left, T = rc.top, Wd = rc.width, Ht = rc.height;
      for (const [side, f] of [['Top', (b) => [L, T, Wd, b]], ['Bottom', (b) => [L, T + Ht - b, Wd, b]], ['Left', (b) => [L, T, b, Ht]], ['Right', (b) => [L + Wd - b, T, b, Ht]]]) {
        const bw = parseFloat(cs[`border${side}Width`]);
        if (!(bw >= 0.25) || /none|hidden/.test(cs[`border${side}Style`])) continue;
        addRule(el, ...f(bw), hexK(cs[`border${side}Color`], k), 'border');
      }
      for (const sh of shadows(cs.boxShadow)) {
        const [ox = 0, oy = 0, blur = 0, spread = 0] = sh.n;
        if (blur > 0 || !sh.color || alphaOf(sh.color) <= 0.02) continue;
        const c = hexK(sh.color, k);
        if (sh.inset) {
          const hl = L + ox + spread, ht = T + oy + spread, hr = L + Wd + ox - spread, hb = T + Ht + oy - spread;
          if (ht > T) addRule(el, L, T, Wd, Math.min(Ht, ht - T), c, 'shadow');
          if (hb < T + Ht) addRule(el, L, Math.max(T, hb), Wd, T + Ht - Math.max(T, hb), c, 'shadow');
          if (hl > L) addRule(el, L, T, Math.min(Wd, hl - L), Ht, c, 'shadow');
          if (hr < L + Wd) addRule(el, Math.max(L, hr), T, L + Wd - Math.max(L, hr), Ht, c, 'shadow');
        } else {
          const sl = L + ox - spread, st = T + oy - spread, sr = L + Wd + ox + spread, sb = T + Ht + oy + spread;
          if (st < T) addRule(el, L, st, Wd, T - st, c, 'shadow');
          if (sb > T + Ht) addRule(el, L, T + Ht, Wd, sb - T - Ht, c, 'shadow');
          if (sl < L) addRule(el, sl, T, L - sl, Ht, c, 'shadow');
          if (sr > L + Wd) addRule(el, L + Wd, T, sr - L - Wd, Ht, c, 'shadow');
        }
      }
      const bg = cs.backgroundColor;
      if (alphaOf(bg) > 0.02 && ((Ht <= 2 && Wd > 4) || (Wd <= 2 && Ht > 4))) addRule(el, L, T, Wd, Ht, hexK(bg, k), 'thin');
      if (Wd >= 4 && Ht >= 4 && Wd <= 48 && Ht <= 48 && Math.abs(Wd - Ht) <= 2) {
        const rr = cs.borderTopLeftRadius;
        const rad = /%$/.test(rr) ? parseFloat(rr) / 100 * Math.min(Wd, Ht) : parseFloat(rr);
        const bwc = parseFloat(cs.borderTopWidth) > 0 && !/none|hidden/.test(cs.borderTopStyle) && alphaOf(cs.borderTopColor) > 0.02;
        const ring = shadows(cs.boxShadow).find(sh => sh.inset && alphaOf(sh.color) > 0.02);
        if (rad >= Math.min(Wd, Ht) / 2 - 0.5 && (alphaOf(bg) > 0.02 || bwc || ring)) place(el, fr(L, T, Wd, Ht), { kind: 'circle', ...fr(L, T, Wd, Ht), color: alphaOf(bg) > 0.02 ? hexK(bg, k) : (bwc ? hexK(cs.borderTopColor, k) : hexK(ring.color, k)) }, decos);
      }
    };
    const seen = new Set();
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el)) continue;
        seen.add(el);
        const tag = el.tagName.toLowerCase();
        if (tag !== 'svg' && el.closest('svg')) continue;
        const rc = el.getBoundingClientRect();
        if (rc.width < 0.25 && rc.height < 0.25) continue;
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        const k = opa(el);
        const L = rc.left, T = rc.top, Wd = rc.width, Ht = rc.height;
        boxShapes(el, rc, cs, k);
        for (const pb of pseudoBoxes(el)) boxShapes(el, pb.q, pb.cs, k);
        if (tag === 'svg' || tag === 'img') {
          if (Math.max(Wd, Ht) <= 40 && Math.min(Wd, Ht) >= 2) { place(el, fr(L, T, Wd, Ht), { kind: 'icon', ...fr(L, T, Wd, Ht), color: hexK(cs.color, k) }, decos); continue; }
          if (tag === 'img') { if (Wd >= 8 && Ht >= 8) place(el, fr(L, T, Wd, Ht), { kind: 'image', ...fr(L, T, Wd, Ht) }, cells); continue; }
          if (tag === 'svg') {
            // 大 svg：只有横 / 竖直线段的是线条图（格线、外框）→ 线；有曲线 / 斜线的是图画（笔迹、字形轮廓）→ 墨格
            const found = [];
            let drawing = false;
            for (const g of el.querySelectorAll('path, line, rect, polyline, polygon, circle, ellipse')) {
              const gt = g.tagName.toLowerCase();
              if (gt === 'circle' || gt === 'ellipse' || (gt === 'path' && /[CcSsQqTtAa]/.test(g.getAttribute('d') || ''))) { drawing = true; break; }
              if (!visible(g)) continue;
              const m = g.getScreenCTM && g.getScreenCTM();
              if (!m) continue;
              const gs = getComputedStyle(g);
              const stroked = gs.stroke && /rgb/.test(gs.stroke);
              const sw = stroked ? parseFloat(gs.strokeWidth) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 0;
              const c = stroked ? hexK(gs.stroke, opa(g) * Number(gs.strokeOpacity || 1)) : '';
              for (const [x1, y1, x2, y2] of svgSegs(g)) {
                const X1 = m.a * x1 + m.c * y1 + m.e, Y1 = m.b * x1 + m.d * y1 + m.f, X2 = m.a * x2 + m.c * y2 + m.e, Y2 = m.b * x2 + m.d * y2 + m.f;
                if (Math.abs(Y1 - Y2) < 0.05 && Math.abs(X1 - X2) >= 2) { if (sw > 0) found.push([g, Math.min(X1, X2), Y1 - sw / 2, Math.abs(X2 - X1), sw, c]); }
                else if (Math.abs(X1 - X2) < 0.05 && Math.abs(Y1 - Y2) >= 2) { if (sw > 0) found.push([g, X1 - sw / 2, Math.min(Y1, Y2), sw, Math.abs(Y2 - Y1), c]); }
                else if (Math.hypot(X2 - X1, Y2 - Y1) >= 1) drawing = true;
              }
              if (drawing) break;
            }
            if (drawing) place(el, fr(L, T, Wd, Ht), { kind: 'ink', ...fr(L, T, Wd, Ht) }, cells);
            else for (const [g, x, y, w, h, c] of found) addRule(g, x, y, w, h, c, 'svg');
          }
        }
        // 墨格
        if (tag === 'canvas' && Wd >= 8 && Ht >= 8) place(el, fr(L, T, Wd, Ht), { kind: 'ink', ...fr(L, T, Wd, Ht) }, cells);
        const own = ownText(el);
        if (own && CJK1.test(own) && parseFloat(cs.fontSize) >= 24) {
          const range = document.createRange();
          for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { range.selectNodeContents(n); const q = range.getBoundingClientRect(); if (q.width > 0) place(el, fr(q.left, q.top, q.width, q.height), { kind: 'glyph', ...fr(q.left, q.top, q.width, q.height), text: own }, cells); break; }
        }
      }
    }
    probeStyle.remove();
    return { offscreen: collect(true).off, rules, decos, cells };
    """#
}

/// 原生写字页转场记录（QA-H1：探针带出最近 24 条，XCUITest 核对 D62 转场类型，NF-01；B2.8：present:/dismiss:<paper|push|quiet|phase|fade|none>、
/// drag:<种类>、dismiss:<种类>:interactive、yield:<detail|result>、close、cover:fade、overlap（两个原生转场同时在跑）。
enum QATrace {
    private(set) static var events: [String] = []
    static func note(_ s: String) {
        events.append(s)
        if events.count > 24 { events.removeFirst(events.count - 24) }
    }
}

/// B2.9b：QA 时钟。注入把页面时钟钉在固定日子时（结果页状态：2026-10-22 09:00，或 -shizi-qa-clock），这个钟就是全 App 唯一的「现在」：
/// 页面 now()（注入后量出偏移 = 页面 now − 真实时间，存在 UserDefaults）、杀进程重开后的页面（WebViewController 在 documentStart 注入
/// window.__shiziQAClockOffset，src/platform/env.js 模块求值时读，路由恢复 routeRestore 也用它）与原生（SQLite 时间戳、提醒排期）。
/// 不钉时钟的注入清掉偏移（之后用真实时间）。只在 DEBUG 测试宿主。
enum QAClock {
    static let key = "shizi.qa.clockOffsetMs"

    static var offsetMs: Double? {
        get { WebViewController.nativeTestHostEnabled ? UserDefaults.standard.object(forKey: key) as? Double : nil }
        set {
            if let v = newValue { UserDefaults.standard.set(v, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }

    static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 + (offsetMs ?? 0) }
    static func date() -> Date { Date(timeIntervalSince1970: nowMs() / 1000) }

    /// documentStart 注入的脚本（没有偏移 → nil）。
    static var script: String? {
        guard let v = offsetMs else { return nil }
        return "window.__shiziQAClockOffset = \(String(format: "%.0f", v));"
    }
}

/// 本次启动是否已经注入过（只在第一次 pageReady 注入）。
enum QARun {
    static var started = false
}

/// 原生写字页开关（与 NativeWriteCoordinator 同一个判定，这里只读）。
enum NativeWriteDetect {
    static var enabled: Bool { WebViewController.nativeWriteEnabled }
}

/// 探针：读屏元素「qa-probe」的 value = store 摘要 JSON（XCUITest 断言数据用）。
@MainActor
final class QAProbe {
    static let shared = QAProbe()
    private var window: UIWindow?
    private let label = UILabel()
    private var timer: Timer?
    private weak var host: WebViewController?
    var seedResult: String??

    func install(on host: WebViewController) {
        self.host = host
        guard window == nil else { return }
        let w = UIWindow(frame: CGRect(x: 0, y: 0, width: 2, height: 2))
        w.windowLevel = .statusBar + 10
        w.isUserInteractionEnabled = false
        w.backgroundColor = .clear
        label.frame = CGRect(x: 0, y: 0, width: 2, height: 2)
        label.alpha = 0.05
        label.text = " "
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = "qa-probe"
        label.accessibilityLabel = "qa-probe"
        label.accessibilityValue = "{}"
        let root = UIViewController()
        root.view.backgroundColor = .clear
        root.view.isUserInteractionEnabled = false
        root.view.addSubview(label)
        w.rootViewController = root
        w.isHidden = false
        window = w
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    private var busy = false

    func refresh() async {
        guard !busy, let host else { return }
        busy = true
        defer { busy = false }
        var out: [String: Any] = [:]
        if let v = try? await host.webView.callAsyncJavaScript(Self.summaryJS, arguments: [:], in: nil, contentWorld: .page), let d = v as? [String: Any] {
            out = d
        }
        if let vc = host.nativeWriteTop {
            let phase: String
            switch vc.phase {
            case .recall: phase = "recall"
            case .compare: phase = "compare"
            case .trace: phase = "trace"
            case .retrace: phase = "retrace"
            }
            out["native"] = ["shown": true, "slot": vc.slot, "cardKey": vc.cardKey ?? "", "phase": phase, "strokes": vc.strokes.count,
                             "redo": vc.redo, "redoIndex": vc.redoIndexForTesting, "redoTotal": vc.redoTotalForTesting,
                             "undoBar": vc.undoBarForTesting != nil, "endDialog": vc.endDialogForTesting != nil,
                             "sheet": vc.presentedViewController != nil, "cursor": vc.snapshot["cursor"] as? Int ?? -1,
                             "inkLog": vc.inkViewForTesting?.strokeLog ?? []]
        } else {
            out["native"] = ["shown": false]
        }
        // B2.7：原生结果页（作品格数、没放进图里的行数、撤销条、弹层、提醒邀请的阶段）
        if let rv = host.nativeResultTop {
            out["result"] = ["shown": true, "slot": rv.slot, "sessionId": rv.sessionId, "variant": rv.variant, "cells": rv.workCellCount, "rows": rv.rowCount,
                             "undoBar": rv.undoBarForTesting != nil, "sheet": rv.presentedViewController != nil, "invite": rv.invitePhase, "sealed": rv.sealedForTesting]
        } else {
            out["result"] = ["shown": false]
        }
        // B3.2 NativeStage：通用原生栈（底 → 顶的屏名）、引擎状态、点按 → 转场第一帧（ms，最近 64 次）
        var stageOut: [String: Any] = ["screens": host.stage.screens.map(\.screen), "engine": host.stage.engine.status.probeName, "latency": NativeStage.latencies, "bootMs": NativeStage.bootFrameMs ?? -1, "bootFromLaunchMs": NativeStage.bootFromLaunchMs ?? -1, "bootKind": host.stage.bootKind, "entries": host.stage.entries.map { $0["n"] as? String ?? "" }]
        if let root = host.stage.rootProbe { stageOut["root"] = root } // B3.5a：原生 tab 根页
        if let tabs = host.stage.tabsProbe { stageOut["tabs"] = tabs } // B3.5d：原生 Tab 栏（看得见、选中的 tab）
        // R14：宿主往上的呈现链（类名，底 → 顶；写字 / 结果 / 原生页 / 弹层都在里面）——测试工具判断「左缘返回有没有发生任何事」用
        var chain: [String] = []
        var cur = host.presentedViewController
        while let c = cur { chain.append(String(describing: type(of: c))); cur = c.presentedViewController }
        stageOut["presented"] = chain
        out["stage"] = stageOut
        out["pageReady"] = host.pageReady
        out["theme"] = ["override": host.view.window?.overrideUserInterfaceStyle.rawValue ?? -1, "bootOverride": ShiziTheme.bootOverride] // B3.5c：窗口外观与引擎就绪前的启动外观（0 跟随系统 / 1 浅 / 2 深）
        out["transitions"] = QATrace.events
        out["a11y"] = NativeA11y.events // B2.9b：读屏通知队列（screen:/layout:/announce:）
        out["navRunning"] = NativeWriteTransitions.running
        if let s = seedResult { out["seed"] = s ?? "ok" }
        if let data = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), let s = String(data: data, encoding: .utf8) {
            label.accessibilityValue = s
        }
    }

    static let summaryJS = #"""
    const T = window.__shiziTest;
    if (!T) return { hooks: false };
    const st = T.getState();
    const recs = Object.values(st.records || {}).flat();
    const kinds = {};
    for (const r of recs) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const judged = recs.filter(r => r.kind === 'judged');
    const sess = {};
    for (const slot of ['A', 'B']) {
      const s = st.sessions && st.sessions[slot];
      sess[slot] = s ? { kind: s.kind, cursor: s.cursor, total: s.queue.length, ended: !!s.endedAt, items: s.items.length, phase: s.current ? s.current.phase : null, strokes: s.current ? s.current.strokes.length : 0, hints: s.current ? s.current.hints || 0 : 0, lastLine: s.lastLine ? s.lastLine.kind : null } : null;
    }
    const chars = new Set(recs.map(r => r.char));
    const seenInk = recs.filter(r => r.kind === 'answer-seen' && T.getInk(r)).length;
    const app = document.querySelector('.sz-app');
    let route = null;
    try { const { getRouter } = await import('/src/ui/router.js'); const r = getRouter().getState(); route = { top: r.top ? r.top.n : null, depth: r.depth, tab: r.tab, overlay: !!r.topIsOverlay }; } catch (e) {}
    let webNav = [];
    try { const { navTrace } = await import('/src/ui/paper-transition.js'); webNav = [...navTrace]; } catch (e) {}
    // B2.9b：冷启动判定（route-memory lastPlan：ok / stale / invalid:<页> …）与页面此刻的时钟（QA 钉住时跨重开保持）
    let coldPlan = null;
    try { const { getRouteMemory } = await import('/src/ui/route-memory.js'); const m = getRouteMemory(); coldPlan = m ? m.lastPlan() : null; } catch (e) {}
    return {
      coldPlan, clock: T.now(),
      hooks: true, records: recs.length, kinds, judgedWrong: judged.filter(r => r.judgment === 'wrong').length, judgedCorrect: judged.filter(r => r.judgment === 'correct').length,
      settings: { appearance: (st.settings || {}).appearance || 'auto', groupSize: (st.settings || {}).groupSize || null }, // B3.5c：我的页设置行的流程测试读
      chars: chars.size, answerSeenInk: seenInk, sched: Object.keys(st.sched || {}).length, sessions: sess, route, topScreen: app ? app.dataset.topScreen : null, navAnim: app ? app.dataset.navAnim : null, webNav,
    };
    """#
}
#endif
