#if DEBUG
import ShiziCore
import UIKit

// QA-H1：原生界面自动化测试框架的 App 内一半（只在 DEBUG 编译；Release 不含，verify-archive.sh 断言）。
//
// 三种用法，全部由启动参数打开（默认什么都不做）：
//   1. 状态注入（-shizi-qa-seed <状态>）：冷启动判定之后清空数据，把 App 带到指定状态（夹具 ShiziUITests/States/<状态>.json，见 QAFixtures.swift / QAOps.swift）。
//      XCUITest（ShiziUITests）用它一键起步。
//   2. 逐屏取证（-shizi-qa parity -shizi-qa-states a,b,… -shizi-qa-tag <外观_字号>）：
//      逐个状态注入 → 等动画落定 → 把元素清单（位置尺寸 / 文案 / 颜色 / 字号 / 可点）写到 Documents/qa/native/<状态>_<tag>.json →
//      写 Documents/qa/ready 通知宿主脚本截图 → 等宿主写回 Documents/qa/ack-<序号> 再做下一个（截图由宿主 simctl 截，含真实合成结果）。
//      取 UIKit 视图树 + 无障碍属性（accessibilityIdentifier / Label / Frame）；网页参考图已随 D84 删除，基线是 ShiziUITests/Baseline/。
//   3. 探针（-shizi-qa-probe）：一个 1pt 的透明窗口，读屏元素 id「qa-probe」的 value 是 store 摘要 JSON（路由、会话、记录条数、
//      已练字数、原生写字页的阶段与字），每 0.3 秒刷新；XCUITest 经无障碍树读它断言「数据真的写进去了」。
// 状态注入走的是正式代码：造数据用 ShiziCore 里与真人判断同一批函数，导航走 SwiftNavigator，点按走原生页自己的按钮动作。
// B4.9：App 里没有网页了——测试钩子（原来页面里的 __shiziTest）、夹具 op、探针摘要都在 Swift。

extension RootViewController {
    // MARK: 启动参数

    /// 测试宿主（-shizi-test-host / SHIZI_TEST_HOST，XCTest 驱动；-shizi-dev / SHIZI_DEV 开发）：QA 时钟、测试用屏、QA 桩只在这时生效。
    static var nativeTestHostEnabled: Bool {
        let process = ProcessInfo.processInfo
        return process.arguments.contains("-shizi-test-host") || process.environment["SHIZI_TEST_HOST"] == "1"
            || process.arguments.contains("-shizi-dev") || process.environment["SHIZI_DEV"] == "1"
    }

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

    /// 时钟不固定（用真实时间）：冷启动恢复按「离开多久」判断，固定时钟会让重开时现场显得「很久以前」而不恢复；
    /// 写字页上没有随时间变的内容，对比不受影响。传 -shizi-qa-clock <ISO> 可另行固定。
    static var qaClock: String { qaArg("-shizi-qa-clock") ?? "" }

    // MARK: 启动参数里的平台动作（viewDidLoad 调，冷启动判定之前）

    func applyQALaunchArguments() {
        guard Self.nativeTestHostEnabled else { return }
        // B3.F RestoreAndDeepLinkTests：这次启动前把 QA 时钟往后拨 N 分钟（测「离开太久 / 跨 4 点不恢复」）
        if let m = Self.qaArg("-shizi-qa-clock-advance").flatMap(Double.init) {
            QAClock.offsetMs = (QAClock.offsetMs ?? 0) + m * 60_000
        }
        // 冷启动的提醒深链（与 AppDelegate 点开通知同一入口：栈还没重建，key 先存着）
        if let target = Self.qaArg("-shizi-reminder-target"), !target.isEmpty { openReminderTarget(cardKey: target) }
        // B3.F：热启动的提醒深链（栈重建好、QA 注入做完之后过几秒）
        if let target = Self.qaArg("-shizi-qa-warm-reminder"), !target.isEmpty {
            stage.whenPlanned { [weak self] in
                DispatchQueue.main.asyncAfter(deadline: .now() + 6) { self?.openReminderTarget(cardKey: target) }
            }
        }
    }

    // MARK: 入口（冷启动判定之后调用）

    func runQAHarnessIfNeeded() {
        guard Self.qaEnabled else { return }
        if Self.qaProbeEnabled { QAProbe.shared.install(on: self) }
        // 只在本次启动注入一次（冷启动恢复的测试杀进程重开时不带 -shizi-qa-seed）
        guard !QARun.started else { return }
        QARun.started = true
        Task { @MainActor in
            if Self.qaMode == "parity" {
                await self.qaRunParity()
            } else if let st = Self.qaSeed {
                let r = await self.qaPrepare(st)
                QAProbe.shared.seedResult = r
            }
        }
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
        let ui = "native" // B4.9：App 里没有网页；网页参考图已随 D84 删除，基线在 ShiziUITests/Baseline/
        let tag = Self.qaArg("-shizi-qa-tag") ?? "light_L"
        let states = Self.qaArg("-shizi-qa-states")?.split(separator: ",").map(String.init) ?? QAFixture.parityNames()
        let fm = FileManager.default
        let outDir = Self.qaDir.appendingPathComponent(ui, isDirectory: true)
        try? fm.createDirectory(at: outDir, withIntermediateDirectories: true)
        for (i, st) in states.enumerated() {
            let err = await qaPrepare(st)
            await qaSettleNative() // QA-H4：等推入转场 / 动画落定再取（准备好的信号可能发在转场进行中）
            var dump: [String: Any] = ["state": st, "ui": ui, "tag": tag, "ok": err == nil]
            if let err { dump["error"] = err }
            let win = view.window
            dump["screen"] = ["w": win?.bounds.width ?? 0, "h": win?.bounds.height ?? 0, "scale": win?.screen.scale ?? 0,
                              "safeTop": win?.safeAreaInsets.top ?? 0, "safeBottom": win?.safeAreaInsets.bottom ?? 0,
                              "style": traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
                              "contentSize": Self.contentSizeName(currentContentSizeCategory)]
            let (elements, offscreen) = qaNativeDump()
            dump["elements"] = elements
            // QA-H2：滚动区里屏外的元素、线 / 装饰 / 墨格（旧字段不变）
            dump["offscreen"] = offscreen
            for (k, v) in qaNativeGraphics() { dump[k] = v }
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
                    snapshot(sub, &sig, &animating)
                }
                return
            }
            let p = layer.presentation() ?? layer
            sig.append(contentsOf: [Double(p.position.x), Double(p.position.y), Double(p.bounds.width), Double(p.bounds.height), Double(p.opacity)].map { ($0 * 10).rounded() / 10 })
            for sub in layer.sublayers ?? [] {
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

    /// 原生元素清单：窗口里的全部可见视图（原生写字页、弹层、撤销条、确认框），控件与文字一项一条。
    /// 每条带：属性名（Mirror 取原生页上的成员名，作稳定的语义键）、accessibilityIdentifier / Label / Frame、
    /// 窗口坐标 frame（pt）、文字、文字色 / 底色 / 边框色（按当前外观解析成 #RRGGBBAA）、字号与字重、是否可点。
    /// 返回元素清单 + QA-H2 屏外一份（滚动区里滚得到、此刻在屏外的元素，同一形状、带 off: true）。
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
            if covered.contains(ObjectIdentifier(v)) { return }
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
    /// 走全部可见视图（含按钮里面的子视图；不进系统 Tab 栏、被盖住的页、系统控件的内部）与它们自己的子图层：
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
            if v is UITabBar || covered.contains(ObjectIdentifier(v)) { return }
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

/// 声音 / 触觉事件记录（探针 feedback，最近 200 条，按发出顺序；`ShiziProbe.feedback`）。只在 DEBUG 测试宿主。
enum QAFeedback {
    private(set) static var events: [String] = []
    static func note(_ s: String) {
        events.append(s)
        if events.count > 200 { events.removeFirst(events.count - 200) }
    }
}

/// B2.9b：QA 时钟（只在 DEBUG 测试宿主）。两个读数：
///   nowMs  应用时钟（store / 导航的「现在」，JS 参考里页面的 env.now）：夹具 clock.pin 期间从固定时刻起每次读数 +5ms（顺序确定，FSRS 的 fuzz 种子含复习时刻，
///          「N 天后再见」要可复现）；其余时候 = 墙上时钟 + 偏移。
///   wallMs 墙上时钟 + 偏移（原生库的行时间戳、提醒排期）：钉住期间也不跳（与 JS 参考里原生侧的 QAClock 同一口径）。
/// 偏移存在 UserDefaults：杀进程重开后也是同一个「现在」（冷启动恢复按「离开多久」判断）。不钉时钟的注入清掉偏移（之后用真实时间）。
enum QAClock {
    static let key = "shizi.qa.clockOffsetMs"

    static var offsetMs: Double? {
        get { RootViewController.nativeTestHostEnabled ? UserDefaults.standard.object(forKey: key) as? Double : nil }
        set {
            if let v = newValue { UserDefaults.standard.set(v, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }

    /// 钉住的起点与读数（Date.now = FIX + (pinK += 5)）。
    private static var pinned: (base: Double, k: Double)?

    private static func realMs() -> Double { Date().timeIntervalSince1970 * 1000 }

    static func nowMs() -> Double {
        if var p = pinned {
            p.k += 5
            pinned = p
            return p.base + p.k
        }
        return wallMs()
    }

    static func wallMs() -> Double { realMs() + (offsetMs ?? 0) }
    /// 探针读的「现在」：钉住期间不消耗读数。
    static func nowWithoutTick() -> Double { pinned.map { $0.base + $0.k } ?? wallMs() }
    static func date() -> Date { Date(timeIntervalSince1970: wallMs() / 1000) }

    /// 造数据期间钉住（墙上时钟的偏移同时对到这一刻）。
    static func pin(at fix: Double) {
        pinned = (fix, 0)
        offsetMs = fix - realMs()
    }

    /// R16：把读数拨到第 tick 次（judge 的 tick）。
    static func repin(_ tick: Double) {
        if var p = pinned { p.k = tick * 5; pinned = p }
    }

    /// 放开：从此刻（再读一次）起照常流逝，全 App 的钟随之平移（setClock）。没钉住时什么都不做。
    static func unpin() {
        guard pinned != nil else { return }
        let at = nowMs()
        pinned = nil
        setClock(at)
    }

    /// 顶层夹具清空时：直接放开，不平移（之后 reset / setClock 决定偏移）。
    static func unpinWithoutShift() { pinned = nil }

    /// 应用时钟平移到 at（test-hooks setClock）；nil = 复原（偏移 < 1s 视为没平移）。
    static func setClock(_ at: Double?) {
        guard let at else { offsetMs = nil; return }
        let off = at - realMs()
        offsetMs = abs(off) >= 1000 ? off : nil
    }
}

/// 本次启动是否已经注入过（只在第一次 pageReady 注入）。
enum QARun {
    static var started = false
}

/// 探针：读屏元素「qa-probe」的 value = store 摘要 JSON（XCUITest 断言数据用）。
@MainActor
final class QAProbe {
    static let shared = QAProbe()
    private var window: UIWindow?
    private let label = UILabel()
    private var timer: Timer?
    private weak var host: RootViewController?
    var seedResult: String??

    func install(on host: RootViewController) {
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
        var out = Self.summary(host.stage.engine)
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
        var stageOut: [String: Any] = ["screens": host.stage.screens.map(\.screen), "engine": host.stage.engine.status.probeName, "latency": NativeStage.latencies, "bootMs": NativeStage.bootFrameMs ?? -1, "bootFromLaunchMs": NativeStage.bootFromLaunchMs ?? -1, "bootKind": host.stage.bootKind, "entries": host.stage.entries.map { $0.n ?? "" }]
        if let root = host.stage.rootProbe { stageOut["root"] = root } // B3.5a：原生 tab 根页
        if let tabs = host.stage.tabsProbe { stageOut["tabs"] = tabs } // B3.5d：原生 Tab 栏（看得见、选中的 tab）
        // R14：宿主往上的呈现链（类名，底 → 顶；写字 / 结果 / 原生页 / 弹层都在里面）——测试工具判断「左缘返回有没有发生任何事」用
        var chain: [String] = []
        var cur = host.presentedViewController
        while let c = cur { chain.append(String(describing: type(of: c))); cur = c.presentedViewController }
        stageOut["presented"] = chain
        out["stage"] = stageOut
        out["pageReady"] = host.stage.planned // B4.9：没有网页了，「就绪」= 冷启动判定做完（测试按它等）
        out["theme"] = ["override": host.view.window?.overrideUserInterfaceStyle.rawValue ?? -1, "bootOverride": ShiziTheme.bootOverride] // B3.5c：窗口外观与引擎就绪前的启动外观（0 跟随系统 / 1 浅 / 2 深）
        out["transitions"] = QATrace.events
        // 导航由 SwiftNavigator 记账（同 account 的 traceNav，字段名沿用 webNav）；冷启动判定 = Swift 的 RouteMemory
        out["webNav"] = SwiftNavigator.traceLog
        out["coldPlan"] = EngineValue.any(host.stage.engine.nav.host.memory.lastPlan)
        out["feedback"] = QAFeedback.events
        out["a11y"] = NativeA11y.events // B2.9b：读屏通知队列（screen:/layout:/announce:）
        out["navRunning"] = NativeWriteTransitions.running
        if let s = seedResult { out["seed"] = s ?? "ok" }
        if let data = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), let s = String(data: data, encoding: .utf8) {
            label.accessibilityValue = s
        }
    }

    /// store 摘要（原来是页面里的 summaryJS，B4.9 起读 Swift 的 store 与导航）：记录条数与种类、判断写对 / 写错数、设置、已练字数、
    /// 看答案留墨数、调度表条数、两个槽的会话、路由（栈顶 / 深度 / tab）、应用时钟。
    static func summary(_ engine: SwiftEngine) -> [String: Any] {
        let store = engine.core.store
        let st = store.state
        let recs = Query.flattenRecords(st["records"])
        var kinds: [String: Int] = [:]
        for r in recs { kinds[QAJS.string(r["kind"]), default: 0] += 1 }
        let judged = recs.filter { $0["kind"] == .string("judged") }
        func plain(_ v: JSValue?) -> Any { v.map { EngineValue.any($0) } ?? NSNull() }
        var sessions: [String: Any] = [:]
        for slot in ["A", "B"] {
            guard let s = st["sessions"]?[slot], !s.isNull else { sessions[slot] = NSNull(); continue }
            var o: [String: Any] = [:]
            o["kind"] = plain(s["kind"])
            o["cursor"] = plain(s["cursor"])
            o["total"] = s["queue"]?.arrayValue?.count ?? 0
            o["ended"] = QAJS.truthy(s["endedAt"])
            o["items"] = s["items"]?.arrayValue?.count ?? 0
            let cur: JSValue? = (s["current"]?.isNull ?? true) ? nil : s["current"]
            o["phase"] = cur == nil ? NSNull() : plain(cur?["phase"])
            o["strokes"] = cur?["strokes"]?.arrayValue?.count ?? 0
            o["hints"] = cur?["hints"]?.numberValue ?? 0
            let line: JSValue? = (s["lastLine"]?.isNull ?? true) ? nil : s["lastLine"]
            o["lastLine"] = line == nil ? NSNull() : plain(line?["kind"])
            // D83：当前字是第几次考（1 = 第一次）、这一组的重考 item 数、是不是「再来一组」
            let key = SessionRules.currentCardKey(s) ?? .null
            o["attempt"] = key.isNull ? 0 : TodayPlan.attempts(s, key) + 1
            o["retries"] = (s["items"]?.arrayValue ?? []).filter { TodayPlan.isRetryItem($0) }.count
            o["queue"] = (s["queue"]?.arrayValue ?? []).map { QAJS.string($0) }
            o["extra"] = s["extra"] == .bool(true)
            sessions[slot] = o
        }
        let settings = st["settings"]
        let stack = engine.nav.router.stack
        let top = stack.last
        var route: [String: Any] = [:]
        route["top"] = top?["n"]?.stringValue ?? NSNull()
        route["depth"] = max(0, stack.count - 1)
        route["tab"] = stack.first?["n"]?.stringValue ?? NSNull()
        route["overlay"] = top.map { $0["k"] != .string("s") } ?? false
        route["char"] = top?["p"]?["char"]?.stringValue ?? NSNull() // 顶层屏的 char 参数（字详情是哪个字）
        var set: [String: Any] = [:]
        set["appearance"] = settings?["appearance"]?.stringValue ?? "auto"
        let group: JSValue? = (settings?["groupSize"]?.isNull ?? true) ? nil : settings?["groupSize"]
        set["groupSize"] = group == nil ? NSNull() : plain(group)
        set["mixTier"] = settings?["mixTier"]?.stringValue ?? NSNull()
        var out: [String: Any] = [:]
        out["coldPlan"] = NSNull()
        out["clock"] = QAClock.nowWithoutTick()
        out["hooks"] = true
        out["records"] = recs.count
        out["kinds"] = kinds
        out["judgedWrong"] = judged.filter { $0["judgment"] == .string("wrong") }.count
        out["judgedCorrect"] = judged.filter { $0["judgment"] == .string("correct") }.count
        out["settings"] = set
        out["chars"] = Set(recs.map { QAJS.string($0["char"]) }).count
        out["answerSeenInk"] = recs.filter { $0["kind"] == .string("answer-seen") && store.getInk($0) != nil }.count
        out["sched"] = st["sched"]?.objectValue?.count ?? 0
        out["sessions"] = sessions
        // D83 今天的账：进度（每个字的第一次）/ 这一份几个字 / 是否完成
        if let today = try? store.dates.localDay(.number(QAClock.nowWithoutTick())) {
            let t = TodayPlan.today(.object(st), day: today)
            out["today"] = ["n": t.handled.count, "target": t.target.map { $0 as Any } ?? NSNull(), "done": t.done] as [String: Any]
        }
        out["route"] = route
        out["topScreen"] = top?["n"]?.stringValue ?? NSNull()
        out["navAnim"] = "idle"
        return out
    }
}
#endif
