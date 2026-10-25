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
            var dump: [String: Any] = ["state": st, "ui": ui, "tag": tag, "ok": err == nil]
            if let err { dump["error"] = err }
            let win = view.window
            dump["screen"] = ["w": win?.bounds.width ?? 0, "h": win?.bounds.height ?? 0, "scale": win?.screen.scale ?? 0,
                              "safeTop": win?.safeAreaInsets.top ?? 0, "safeBottom": win?.safeAreaInsets.bottom ?? 0,
                              "style": traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
                              "contentSize": Self.contentSizeName(currentContentSizeCategory)]
            if ui == "native" {
                dump["elements"] = qaNativeElements()
            } else {
                dump["elements"] = (await qaJS(Self.qaWebDumpJS)) ?? []
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

    /// 原生元素清单：窗口里除 WKWebView 之外的全部可见视图（原生写字页、弹层、撤销条、确认框），控件与文字一项一条。
    /// 每条带：属性名（Mirror 取原生页上的成员名，作稳定的语义键）、accessibilityIdentifier / Label / Frame、
    /// 窗口坐标 frame（pt）、文字、文字色 / 底色 / 边框色（按当前外观解析成 #RRGGBBAA）、字号与字重、是否可点。
    func qaNativeElements() -> [[String: Any]] {
        guard let window = view.window else { return [] }
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
        if nativeResultTop == nil, nativeWriteTop == nil, let p = presentedViewController {
            collectNames(p, prefix: "")
            if let sheet = p.presentedViewController {
                collectNames(sheet, prefix: "sheet.")
                names[ObjectIdentifier(sheet.view)] = "sheet.view"
            }
        }
        var out: [[String: Any]] = []
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
        // B3.2：原生栈里被盖住的下层页不取（网页同样只取顶层图层）
        let covered = Set(stage.screens.dropLast().map { ObjectIdentifier($0.view) })
        func walk(_ v: UIView) {
            if v is WKWebView || covered.contains(ObjectIdentifier(v)) { return }
            if v.window != nil, visible(v), v.bounds.width > 0.5, v.bounds.height > 0.5 {
                let f = v.convert(v.bounds, to: window)
                let onScreen = f.intersects(window.bounds)
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
                            u = u.union(l.convert(CGRect(x: tx, y: (l.bounds.height - tr.height) / 2, width: tr.width, height: tr.height), to: window))
                        }
                        if !u.isNull { e["textFrame"] = ["x": r(u.minX), "y": r(u.minY), "w": r(u.width), "h": r(u.height)] }
                    } else if let tl = b.titleLabel, !(tl.text ?? "").isEmpty {
                        // 字在标题标签里竖向居中（UILabel 的画法；标签比字高时 textRect 给的是贴顶的框）
                        let tr = tl.textRect(forBounds: tl.bounds, limitedToNumberOfLines: tl.numberOfLines)
                        let ft = tl.convert(CGRect(x: tr.minX, y: (tl.bounds.height - tr.height) / 2, width: tr.width, height: tr.height), to: window)
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
                    let ft = l.convert(CGRect(x: tx, y: (l.bounds.height - th) / 2, width: tr.width, height: th), to: window)
                    e["textFrame"] = ["x": r(ft.minX), "y": r(ft.minY), "w": r(ft.width), "h": r(ft.height)]
                    e["align"] = l.textAlignment == .center ? "center" : (l.textAlignment == .right ? "right" : "left")
                } else if name != nil || v.accessibilityIdentifier != nil || v is NativeInkView {
                    e["kind"] = "view"
                }
                // B2.9b「AX5 不溢出」：字是否被截断（行数不够 / 单行放不下）、是否被祖先裁掉（滚动视图按内容区算：滚得到就不算裁掉）
                let textView: UILabel? = (v as? UILabel) ?? (v as? UIButton)?.titleLabel
                if let l = textView, !(l.text ?? "").isEmpty, l.bounds.width > 2 {
                    let need = l.sizeThatFits(CGSize(width: l.bounds.width, height: .greatestFiniteMagnitude))
                    let natural = l.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude))
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
                            clip = clip.intersection(anc.convert(anc.bounds, to: window))
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
                }
                // 所在的层：弹层 / 确认框 / 撤销条是盖在页面上的浮层（按设计会盖住页面），重叠只在同一层里查
                var layer = "page"
                var anc: UIView? = v
                while let x = anc {
                    if let n = names[ObjectIdentifier(x)], let dot = n.firstIndex(of: "."), ["sheet", "endDialog", "undoBar"].contains(String(n[..<dot])) { layer = String(n[..<dot]); break }
                    if names[ObjectIdentifier(x)] == "sheet.view" { layer = "sheet"; break }
                    if x is NativeUndoBarView { layer = "undoBar"; break }
                    if x is NativeEndDialogView { layer = "endDialog"; break }
                    anc = x.superview
                }
                if !e.isEmpty { e["layer"] = layer }
                if !e.isEmpty, onScreen, !(v.superview is UIButton) {
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
                    out.append(e)
                }
            }
            if v is UIButton { return }
            for s in v.subviews { walk(s) }
        }
        walk(window)
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
    static let qaWebDumpJS = #"""
    const app = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const roots = [top, ...document.querySelectorAll('.sz-sheet, .sz-confirm, .sz-undobar, .sz-toast, .sz-corrupt, [role="dialog"], [role="alertdialog"]')].filter(Boolean);
    const uniq = new Set();
    const out = [];
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
        if (rc.right < 0 || rc.bottom < 0 || rc.left > W || rc.top > H) continue;
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
            if (n.parentElement && n.parentElement.closest('[aria-hidden="true"]') && n.parentElement.closest('[aria-hidden="true"]') !== el && !isBtn) continue;
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
        out.push(e);
      }
    }
    return out;
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
        var stageOut: [String: Any] = ["screens": host.stage.screens.map(\.screen), "engine": host.stage.engine.status.probeName, "latency": NativeStage.latencies]
        if let root = host.stage.rootProbe { stageOut["root"] = root } // B3.5a：原生 tab 根页
        out["stage"] = stageOut
        out["pageReady"] = host.pageReady
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
      chars: chars.size, answerSeenInk: seenInk, sched: Object.keys(st.sched || {}).length, sessions: sess, route, topScreen: app ? app.dataset.topScreen : null, navAnim: app ? app.dataset.navAnim : null, webNav,
    };
    """#
}
#endif
