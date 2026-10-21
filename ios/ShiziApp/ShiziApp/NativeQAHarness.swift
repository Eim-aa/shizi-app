#if DEBUG
import UIKit
import WebKit

// QA-H1：原生界面自动化测试框架的 App 内一半（只在 DEBUG 编译；Release 不含，verify-archive.sh / verify_assets 断言）。
//
// 三种用法，全部由启动参数打开（默认什么都不做）：
//   1. 状态注入（-shizi-qa-seed <状态>）：页面就绪后清空数据，把写字页带到指定状态（见 QAState）。
//      XCUITest（ShiziUITests）用它一键起步；同一套状态网页版（-shizi-native-write-off）与原生版（-shizi-native-write）都能到。
//   2. 逐屏取证（-shizi-qa parity -shizi-qa-ui native|web -shizi-qa-states a,b,… -shizi-qa-tag <外观_字号>）：
//      逐个状态注入 → 等动画落定 → 把元素清单（位置尺寸 / 文案 / 颜色 / 字号 / 可点）写到 Documents/qa/<ui>/<状态>_<tag>.json →
//      写 Documents/qa/ready 通知宿主脚本截图 → 等宿主写回 Documents/qa/ack-<序号> 再做下一个（截图由宿主 simctl 截，含真实合成结果）。
//      原生取 UIKit 视图树 + 无障碍属性（accessibilityIdentifier / Label / Frame）；网页取 DOM（getBoundingClientRect / 文本 / computed color）。
//   3. 探针（-shizi-qa-probe）：一个 1pt 的透明窗口，读屏元素 id「qa-probe」的 value 是 store 摘要 JSON（路由、会话、记录条数、
//      已练字数、原生写字页的阶段与字），每 0.3 秒刷新；XCUITest 经无障碍树读它断言「数据真的写进去了」。
// 状态注入走的是正式代码：会话由 core/session-start.startPicked 开、推进与阶段由写字会话 API（与原生页同一批提交函数）提交，
// 打开写字页走 session/index.js openWrite（网页路由 → 原生宿主），点按走原生页自己的按钮动作 / 网页按钮 click。

enum QAState: String, CaseIterable {
    case home // 只清数据、停在首页（流程测试的起点；首页按钮是「开始写字」首练）
    case homeUsed = "home-used" // 首练 3 字已写完（有记录、字库有字），停在首页：下一组是今天的练习
    case homeMid = "home-mid" // 在 home-used 之上开了今天的练习并判断了 1 字，停在首页（「继续写字」）
    case firstRecall = "first-recall" // 首次练习（A 槽 3 字）第 1 字：格下一次性说明（first-tip）
    case recall // 第 1 字 / 5，回忆阶段，没写
    case recallInk = "recall-ink" // 写了两笔（「写好了」可点）
    case hint1 = "hint-1" // 点一次提示
    case hint2 = "hint-2" // 点两次提示
    case hintFull = "hint-full" // 点到整字给完（按钮变灰，记看过答案）
    case trace // 看答案 → 描一遍
    case retrace // 凭记忆写
    case judge // 判断页（两笔）
    case line // 第 1 字判断为写错后到第 2 字：格下结果行「修改 ›」
    case changeSheet = "change-sheet" // 改判弹层
    case skipUndo = "skip-undo" // 跳过第 1 字：撤销条
    case endDialog = "end-dialog" // 判断过 1 字后点「结束这组」：确认框
    case last // 前 4 字判断过，第 5 字（最后一字）
    case lastJudge = "last-judge" // 最后一字的判断页（判断后直接结果页）
    case result // 「这次选的字」一组写完的结果页（网页）
    case resultDaily = "result-daily" // 今天的练习一组写完的结果页（有写错的字：「再写一组」「重写错字」）

    /// 逐屏对比覆盖的状态（home / result 不是写字页）。
    static var parityStates: [QAState] { allCases.filter { ![.home, .homeUsed, .homeMid, .result, .resultDaily].contains($0) } }
}

extension WebViewController {
    // MARK: 启动参数

    private static func qaArg(_ flag: String) -> String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: flag), i + 1 < a.count else { return nil }
        return a[i + 1]
    }

    static var qaMode: String? { qaArg("-shizi-qa") }
    static var qaSeed: QAState? { qaArg("-shizi-qa-seed").flatMap(QAState.init(rawValue:)) }
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

    // MARK: 状态注入

    /// 把 App 带到 state。返回 nil = 成功，否则是错误说明。
    func qaPrepare(_ state: QAState, ui: String) async -> String? {
        // 1. 收掉现有原生页
        if let top = nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        // 2. 数据与写字页（页面里）
        do {
            let v = try await webView.callAsyncJavaScript(Self.qaPrepareJS, arguments: ["state": state.rawValue, "chars": Self.qaChars, "clock": Self.qaClock], in: nil, contentWorld: .page)
            if let d = v as? [String: Any], (d["ok"] as? Bool) != true { return "prepare: \(d["error"] ?? "?")" }
        } catch {
            return "prepare js: \(error)"
        }
        if let n = Self.qaArg("-shizi-qa-fail-next").flatMap(Int.init), n > 0 {
            // D07 三段式：接下来 n 次写入失败（页面测试钩子 failNextWrite，与 e2e / ShiziWriteTests 同一个）
            _ = await qaJS("return window.__shiziTest.failNextWrite(\(n), {kind:'generic'});")
        }
        if [.home, .homeUsed, .homeMid, .result, .resultDaily].contains(state) {
            try? await Task.sleep(nanoseconds: 900_000_000)
            return nil
        }
        // 3. 等写字页出现、转场结束
        if ui == "native" {
            guard await qaWait(5, { self.nativeWriteTop != nil && self.presentedViewController?.isBeingPresented == false }) else { return "native page did not appear" }
        } else {
            guard await qaWait(5, { await self.qaJS("const a=document.querySelector('.sz-app');const l=document.querySelector('.sz-layer[data-top=\"true\"] [data-testid=\"write-screen\"]');return !!a && a.dataset.navAnim==='idle' && !!l;") as? Bool == true }) else { return "web write page did not appear" }
        }
        try? await Task.sleep(nanoseconds: 700_000_000) // 0.4s 防误点 + 判断键 440ms
        // 4. 界面上的点按（与真人同一个按钮动作）
        switch state {
        case .hint1: await qaTap(ui, "hint", times: 1)
        case .hint2: await qaTap(ui, "hint", times: 2)
        case .hintFull: await qaTap(ui, "hint", times: 8)
        case .changeSheet: await qaTap(ui, "change", times: 1)
        case .skipUndo: await qaTap(ui, "skip", times: 1)
        case .endDialog: await qaTap(ui, "end", times: 1)
        default: break
        }
        // 5. 落定：提示淡入 / 弹层 / 撤销条 / 笔顺快放（≤ 1.6s）
        let settle: UInt64 = state == .trace ? 2_400_000_000 : (state == .changeSheet ? 1_200_000_000 : 900_000_000)
        try? await Task.sleep(nanoseconds: settle)
        return nil
    }

    private func qaTap(_ ui: String, _ what: String, times: Int) async {
        for i in 0..<times {
            if i > 0 { try? await Task.sleep(nanoseconds: 550_000_000) } // 同一按钮两次按下隔 0.4s
            if ui == "native" {
                guard let vc = nativeWriteTop else { return }
                let sel: String
                switch what {
                case "hint": sel = "tapHint"
                case "change": sel = "tapChange"
                case "skip": sel = "tapSkip"
                case "end": sel = "tapEnd"
                default: return
                }
                // 走按钮自己的 action（含 0.4s 防误点），没有就直接调动作函数
                if let b = qaButton(in: vc.view, id: Self.qaNativeIds[what] ?? ""), b.isEnabled, !b.isHidden {
                    b.sendActions(for: .touchUpInside)
                } else {
                    vc.perform(Selector((sel)))
                }
            } else {
                let sel = Self.qaWebSelectors[what] ?? ""
                _ = await qaJS("const el=document.querySelector(\(Self.jsonLiteral(sel) ?? "''"));if(!el||el.disabled)return false;el.click();return true;")
            }
        }
    }

    static let qaNativeIds = ["hint": "native-write-hint", "change": "native-write-line-change", "skip": "native-write-skip", "end": "native-write-end"]
    static let qaWebSelectors = [
        "hint": ".sz-layer[data-top=\"true\"] .sz-hintbtn",
        "change": ".sz-layer[data-top=\"true\"] .sz-line__change",
        "skip": ".sz-layer[data-top=\"true\"] [data-testid=\"write-skip\"]",
        "end": ".sz-layer[data-top=\"true\"] [data-testid=\"write-end\"]",
    ]

    private func qaButton(in root: UIView, id: String) -> UIButton? {
        if let b = root as? UIButton, b.accessibilityIdentifier == id { return b }
        for s in root.subviews { if let b = qaButton(in: s, id: id) { return b } }
        return nil
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
        let states = (Self.qaArg("-shizi-qa-states")?.split(separator: ",").compactMap { QAState(rawValue: String($0)) }) ?? QAState.parityStates
        let fm = FileManager.default
        let outDir = Self.qaDir.appendingPathComponent(ui, isDirectory: true)
        try? fm.createDirectory(at: outDir, withIntermediateDirectories: true)
        for (i, st) in states.enumerated() {
            let err = await qaPrepare(st, ui: ui)
            var dump: [String: Any] = ["state": st.rawValue, "ui": ui, "tag": tag, "ok": err == nil]
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
            }
            let file = outDir.appendingPathComponent("\(st.rawValue)_\(tag).json")
            if let data = try? JSONSerialization.data(withJSONObject: dump, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: file) }
            // 通知宿主截图，等回执
            let ack = Self.qaDir.appendingPathComponent("ack-\(i)")
            try? "\(i) \(st.rawValue)".write(to: Self.qaDir.appendingPathComponent("ready"), atomically: true, encoding: .utf8)
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
        if let vc = nativeWriteTop {
            collectNames(vc, prefix: "")
            if let sheet = vc.presentedViewController {
                collectNames(sheet, prefix: "sheet.")
                names[ObjectIdentifier(sheet.view)] = "sheet.view"
            }
            if let bar = vc.undoBarForTesting { collectNames(bar, prefix: "undoBar.") }
            if let dlg = vc.endDialogForTesting { collectNames(dlg, prefix: "endDialog.") }
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
        func walk(_ v: UIView) {
            if v is WKWebView { return }
            if v.window != nil, visible(v), v.bounds.width > 0.5, v.bounds.height > 0.5 {
                let f = v.convert(v.bounds, to: window)
                let onScreen = f.intersects(window.bounds)
                var e: [String: Any] = [:]
                let name = names[ObjectIdentifier(v)]
                if let b = v as? UIButton {
                    e["kind"] = "button"
                    e["text"] = (b.currentTitle ?? b.titleLabel?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    e["color"] = hex(b.currentTitleColor, v)
                    e["enabled"] = b.isEnabled
                    if let font = b.titleLabel?.font { e["fontSize"] = font.pointSize; e["fontWeight"] = weight(font) }
                    if b.currentImage != nil, let iv = b.imageView, !iv.isHidden {
                        let fi = iv.convert(iv.bounds, to: window)
                        e["hasIcon"] = true; e["tint"] = hex(b.tintColor, v)
                        e["iconFrame"] = ["x": r(fi.minX), "y": r(fi.minY), "w": r(fi.width), "h": r(fi.height)]
                    }
                    if let tl = b.titleLabel, !(tl.text ?? "").isEmpty {
                        let ft = tl.convert(tl.textRect(forBounds: tl.bounds, limitedToNumberOfLines: tl.numberOfLines), to: window)
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
                    let ft = l.convert(CGRect(x: tx, y: (l.bounds.height - tr.height) / 2, width: tr.width, height: tr.height), to: window)
                    e["textFrame"] = ["x": r(ft.minX), "y": r(ft.minY), "w": r(ft.width), "h": r(ft.height)]
                    e["align"] = l.textAlignment == .center ? "center" : (l.textAlignment == .right ? "right" : "left")
                } else if name != nil || v.accessibilityIdentifier != nil || v is NativeInkView {
                    e["kind"] = "view"
                }
                if !e.isEmpty, onScreen, !(v.superview is UIButton) {
                    e["frame"] = ["x": r(f.minX), "y": r(f.minY), "w": r(f.width), "h": r(f.height)]
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

    /// 注入：清空 →（可选固定时钟）→ 开「这次选的字」5 个字 → 按状态经写字会话 API 提交 → 打开写字页（网页路由；开关开着时是原生宿主）。
    static let qaPrepareJS = #"""
    const T = window.__shiziTest;
    if (!T) return { ok: false, error: 'no __shiziTest (need -shizi-test-host)' };
    const { nav } = await import('/src/ui/router.js');
    try { nav.switchTab('home'); } catch (e) {}
    await new Promise(r => setTimeout(r, 120));
    T.reset();
    if (clock) T.setClock(clock);
    if (state === 'home') return { ok: true };
    const { getStore } = await import('/src/store/store.js');
    const core = await import('/src/core/session-start.js');
    const { deckAdapter } = await import('/src/data/deck.js');
    const env = await import('/src/platform/env.js');
    const store = getStore();
    if (state === 'home-used' || state === 'home-mid' || state === 'result-daily') {
      const { createWriteSessionApi } = await import('/src/ui/screens/write/native-session.js');
      const { writeSnapshot } = await import('/src/session/write-api.js');
      const api = createWriteSessionApi({ navigate: { back() {}, toResult() {} } });
      const S = [Array.from({ length: 14 }, (_, i) => [70 + 15 * i, 150 + i, 1000 + i * 16])];
      const runA = (n, js) => {
        for (let i = 0; i < n; i += 1) {
          const k = writeSnapshot(store.getState(), 'A').cardKey;
          api.call('phase', { slot: 'A', cardKey: k, phase: 'compare', strokes: S });
          const r = api.call('judge', { slot: 'A', cardKey: k, judgment: js[i % js.length], strokes: S, hints: 0 });
          if (!r.ok) throw new Error('judge ' + JSON.stringify(r.error));
        }
      };
      try {
        const a = core.startNextA(store, { now: env.now, deck: deckAdapter, source: { view: 'home' } });
        if (!a || !a.ok || !a.started) return { ok: false, error: 'startNextA(first) ' + JSON.stringify(a) };
        runA(3, ['wrong', 'correct', 'correct']);
        if (state === 'home-mid' || state === 'result-daily') {
          const b = core.startNextA(store, { now: env.now, deck: deckAdapter, source: { view: 'home' } });
          if (!b || !b.ok || !b.started) return { ok: false, error: 'startNextA(daily) ' + JSON.stringify(b) };
          if (state === 'home-mid') runA(1, ['correct']);
          else {
            const sid = writeSnapshot(store.getState(), 'A').sessionId;
            const total = writeSnapshot(store.getState(), 'A').total;
            runA(total, ['wrong', 'correct', 'correct']);
            const { openWrite } = await import('/src/ui/screens/session/index.js');
            const { openResult } = await import('/src/ui/screens/result/index.js');
            openWrite('A');
            await new Promise(r => setTimeout(r, 400));
            openResult('A', sid);
            return { ok: true };
          }
        }
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      try { nav.switchTab('home'); } catch (e) {}
      return { ok: true };
    }
    if (state === 'first-recall') {
      const a = core.startNextA(store, { now: env.now, deck: deckAdapter, source: { view: 'home' } });
      if (!a || !a.ok || !a.started) return { ok: false, error: 'startNextA(first) ' + JSON.stringify(a) };
      const { openWrite } = await import('/src/ui/screens/session/index.js');
      openWrite('A');
      return { ok: true };
    }
    const started = core.startPicked(store, { keys: chars, source: { view: 'home' }, deck: deckAdapter });
    if (!started || !started.ok) return { ok: false, error: 'startPicked ' + JSON.stringify(started) };
    const { createWriteSessionApi } = await import('/src/ui/screens/write/native-session.js');
    const { writeSnapshot } = await import('/src/session/write-api.js');
    const api = createWriteSessionApi();
    const snap = () => writeSnapshot(store.getState(), 'B');
    const line = (x0, y0, dx, dy, t0) => Array.from({ length: 14 }, (_, i) => [x0 + dx * i, y0 + dy * i, t0 + i * 16]);
    const S = [line(70, 150, 15, 1, 1000), line(172, 60, 0.5, 17, 2000)];
    const must = (label, x) => { if (!x || !x.ok) throw new Error(label + ' ' + JSON.stringify(x && x.error)); return x; };
    const judgeOne = (judgment) => {
      const k = snap().cardKey;
      must('phase', api.call('phase', { slot: 'B', cardKey: k, phase: 'compare', strokes: S }));
      return must('judge', api.call('judge', { slot: 'B', cardKey: k, judgment, strokes: S, hints: 0 }));
    };
    try {
      const k = snap().cardKey;
      switch (state) {
        case 'recall-ink':
          must('strokes', api.call('strokes', { slot: 'B', cardKey: k, strokes: S, phase: 'recall' }));
          break;
        case 'trace':
          must('showAnswer', api.call('showAnswer', { slot: 'B', cardKey: k }));
          break;
        case 'retrace':
          must('showAnswer', api.call('showAnswer', { slot: 'B', cardKey: k }));
          must('answerPhase', api.call('answerPhase', { slot: 'B', cardKey: k, phase: 'retrace', strokes: [] }));
          break;
        case 'judge':
          must('phase', api.call('phase', { slot: 'B', cardKey: k, phase: 'compare', strokes: S }));
          break;
        case 'line': case 'change-sheet': case 'end-dialog':
          judgeOne('wrong');
          break;
        case 'last':
          for (let i = 0; i < 4; i += 1) judgeOne(i % 2 ? 'correct' : 'wrong');
          break;
        case 'last-judge':
          for (let i = 0; i < 4; i += 1) judgeOne(i % 2 ? 'correct' : 'wrong');
          must('phase', api.call('phase', { slot: 'B', cardKey: snap().cardKey, phase: 'compare', strokes: S }));
          break;
        case 'result': {
          const sid = snap().sessionId;
          for (let i = 0; i < 5; i += 1) judgeOne(i % 2 ? 'correct' : 'wrong');
          const { openWrite } = await import('/src/ui/screens/session/index.js');
          const { openResult } = await import('/src/ui/screens/result/index.js');
          openWrite('B'); // 与写完最后一字同一条路：写字条目就地换成结果页
          await new Promise(r => setTimeout(r, 400));
          openResult('B', sid);
          return { ok: true };
        }
        default: break;
      }
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
    const { openWrite } = await import('/src/ui/screens/session/index.js');
    openWrite('B');
    return { ok: true, snapshot: snap() };
    """#

    /// 网页元素清单：顶层图层与其上的弹层 / 确认框 / 撤销条里可见的控件与文字（与原生清单同一形状）。
    static let qaWebDumpJS = #"""
    const app = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const roots = [top, ...document.querySelectorAll('.sz-sheet, .sz-confirm, .sz-undobar, .sz-toast, [role="dialog"], [role="alertdialog"]')].filter(Boolean);
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

/// 原生写字页转场记录（QA-H1：探针带出最近 8 条，XCUITest 核对 D62 转场类型，NF-01）。
enum QATrace {
    private(set) static var events: [String] = []
    static func note(_ s: String) {
        events.append(s)
        if events.count > 8 { events.removeFirst(events.count - 8) }
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
                             "undoBar": vc.undoBarForTesting != nil, "endDialog": vc.endDialogForTesting != nil,
                             "sheet": vc.presentedViewController != nil, "cursor": vc.snapshot["cursor"] as? Int ?? -1]
        } else {
            out["native"] = ["shown": false]
        }
        out["pageReady"] = host.pageReady
        out["transitions"] = QATrace.events
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
    return {
      hooks: true, records: recs.length, kinds, judgedWrong: judged.filter(r => r.judgment === 'wrong').length, judgedCorrect: judged.filter(r => r.judgment === 'correct').length,
      chars: chars.size, answerSeenInk: seenInk, sched: Object.keys(st.sched || {}).length, sessions: sess, route, topScreen: app ? app.dataset.topScreen : null, navAnim: app ? app.dataset.navAnim : null,
    };
    """#
}
#endif
