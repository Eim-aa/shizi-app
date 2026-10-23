import UIKit
import WebKit

// NativeStage：原生层的唯一协调者（B3.2；计划 B3B4-原生化架构与计划.md §3.3 段 1、§3.4；B2.8 的写字 / 结果协调推广而来，B2 记录见 B2-原生写字架构.md §4 / §23）。
//
// 段 1：网页路由仍是真相源。原生页 = 网页栈里的「原生宿主条目」（透明、不画内容），宿主挂载时发来 open、卸载时 close；本对象把
// 「网页栈顶上连续的原生宿主条目」画成一个原生栈：每张原生页是一个全屏覆盖呈现（.overFullScreen）的视图控制器，叠在 WebViewController 上——
// **不用导航栈 push**：push 完成后底下的 WKWebView 会被移出窗口，WebKit 把不在窗口里的网页降速（B2.0 实测判断往返 p50 20ms → 50–100ms，B2 §7）。
//
// 两条通道，同一套转场（ShiziTransitions = NativeWriteTransitions，一个对象、一个 frame(s)，点按与左缘跟手同一条路径）与同一套「样子留在原处」的换页做法：
//   1. 写字 / 结果 / 重写错字页（B2）：消息 nativeWrite（open / close / result-open / result-close / redo-open / redo-close），行为与 B2.8 一字不差
//      （D62 的纸展开 / 推入 / 安静淡入、D70、结果页「再写一组」推入、重写错字一段转场、让开与回来、深链 / 跨天 / 阻断 / 整体替换时样子留住再淡出、页面重载认领）。
//   2. 通用原生屏（B3 页面卡）：消息 native（open / close / changed / status）。屏名 → 类按约定 NSClassFromString("ShiziScreen_<屏名，- 换 _>")，不设登记表；
//      找不到类 = 该屏还没原生（网页侧根本不会渲染成宿主：启动时把有类的屏名清单注入页面 window.__shiziNativeScreens）。
//      原生页里发起的导航一律经 App API 的 nav.* op 交给网页路由（入口规则仍是 JS 一份）：
//        - 推入原生屏：nav.push → 宿主挂载回发 open → 这里播 T-push（下层是上一张原生页，视差画在它上面）；
//        - 推入网页屏：先把这一页的样子交给宿主层（stage.cover），再 nav.push，网页画好一帧（stage.fence）后原生层整个让开——推入 / 左缘滑回由网页播，
//          露出的是原生页的样子；回到这一条时宿主等网页转场放完发 open via 'return'，这里不带转场重建原生栈（含下面的原生页），随后网页收掉截图；
//        - 返回（「‹」/ 左缘右滑跟手 / 两指 Z 形）：这里播完退场（T-push 倒放），收起后 nav.back {via:'native'}，网页出栈但不再播（root.js nativeMoves）。
//      左缘手势、backGestureEnabled 在原生层可见时由原生页自己决定（WebViewController 的识别器在原生页下面，收不到触摸）。
//      宿主被别处卸掉（切 tab、深链、阻断、store 整体替换）→ close：样子留在原处、原生页收起，紧接着有新原生页就压在上面，否则等页面画好淡出。
//      页面重载：原生页留在屏上；宿主按同一串屏名重新认领 = 只换条目 id 与视图；1.5s 没人认领 → 同上收起淡出。
// 引擎（ShiziEngine / WebEngine）：页面推来的 changed / status 转给它，原生页订阅 changes、按 status 禁用按钮与重拉视图。

/// 屏名 ⇄ 原生类（约定：ObjC 名 ShiziScreen_<屏名，- 换 _>）。
enum ShiziScreenRegistry {
    static let prefix = "ShiziScreen_"

    static func className(_ screen: String) -> String { prefix + screen.replacingOccurrences(of: "-", with: "_") }

    static func screenClass(_ screen: String) -> ShiziScreenViewController.Type? {
        NSClassFromString(className(screen)) as? ShiziScreenViewController.Type
    }

    /// 包里全部原生屏名（ObjC 运行时里按前缀扫一遍，只做一次；注入页面，网页据此决定哪些 native:true 的屏渲染成宿主）。
    static let screens: [String] = {
        // 只扫本 App 自己的映像里的类名（C 字符串；不碰全部运行时类，有些系统类经不起 Swift 动态转换），前缀对上的再按名取类核对
        guard let image = class_getImageName(ShiziScreenViewController.self) else { return [] }
        var count: UInt32 = 0
        guard let names = objc_copyClassNamesForImage(image, &count) else { return [] }
        defer { free(UnsafeMutableRawPointer(mutating: names)) }
        var out: [String] = []
        for i in 0..<Int(count) {
            let name = String(cString: names[i])
            guard name.hasPrefix(prefix) else { continue }
            let screen = String(name.dropFirst(prefix.count)).replacingOccurrences(of: "_", with: "-")
            if screenClass(screen) != nil { out.append(screen) }
        }
        return out.sorted()
    }()
}

final class NativeStage: NSObject {
    unowned let host: WebViewController
    let engine: WebEngine
    /// 通用原生栈（底 → 顶）= 网页栈顶上连续的原生宿主条目。
    private(set) var screens: [ShiziScreenViewController] = []
    /// 屏操作排队执行（呈现 / 收起要等上一个完成：UIKit 呈现进行中再呈现会被丢掉）。
    private var queue: [(@escaping () -> Void) -> Void] = []
    private var busy = false
    /// 最近一次原生点按导航的时刻（点按 → 转场第一帧的量测）。
    private var tapAt: CFTimeInterval?
    /// 点按 → 转场第一帧（ms），最近 64 次（QA 探针读，门槛 p95 ≤ 50ms，§3.3）。
    private(set) static var latencies: [Double] = []

    init(host: WebViewController) {
        self.host = host
        engine = WebEngine(webView: host.webView)
        super.init()
    }

    // MARK: 开关与注入

    /// 文档开始注入：原生开关、有类的屏名清单（网页 ui/native-stage.js 读）。
    static func userScript() -> String {
        let list = (try? JSONSerialization.data(withJSONObject: ShiziScreenRegistry.screens)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return "window.__shiziNativeWrite = true; window.__shiziNative = true; window.__shiziNativeScreens = \(list);"
    }

    // MARK: 页面推来的消息（type 'native'）

    func handleScreenMessage(_ body: [String: Any]) {
        engine.webView = host.webView
        switch body["op"] as? String ?? "" {
        case "open":
            enqueue { [weak self] done in self?.openScreen(body, done: done) ?? done() }
        case "close":
            enqueue { [weak self] done in self?.closeScreen(body, done: done) ?? done() }
        case "changed":
            _ = engine.receiveChanged(body)
        case "status":
            engine.receiveStatus(body)
        default:
            break
        }
    }

    private func enqueue(_ op: @escaping (@escaping () -> Void) -> Void) {
        queue.append(op)
        pump()
    }

    private func pump() {
        guard !busy, !queue.isEmpty else { return }
        busy = true
        let op = queue.removeFirst()
        var finished = false
        op { [weak self] in
            guard let self, !finished else { return }
            finished = true
            self.busy = false
            self.pump()
        }
    }

    // MARK: 通用原生屏

    /// 顶层原生屏（没有 = nil）。
    var topScreen: ShiziScreenViewController? { screens.last }

    func isTop(_ page: ShiziScreenViewController) -> Bool { screens.last === page }

    /// 呈现链最上面的控制器（新原生页盖在它上面）。
    private func topPresented() -> UIViewController {
        var top: UIViewController = host
        while let p = top.presentedViewController, !p.isBeingDismissed { top = p }
        return top
    }

    /// open {screen, entryId, params, via, plan, underId, run:[{entryId, screen, params, payload?}], payload}：
    /// run = 这一条下面连续的原生宿主条目（底 → 顶）。按 run + 这一条对齐原生栈：对得上的留着（页面重载期间按屏名认领），对不上的收起，
    /// 缺的（从网页页面回来时下面的原生页已让开）不带转场重建，最后呈现这一条（push / quiet 播转场；restore / return 直接盖上）。
    private func openScreen(_ body: [String: Any], done: @escaping () -> Void) {
        guard WebViewController.nativeWriteEnabled, let name = body["screen"] as? String, let entryId = body["entryId"] as? String,
              let cls = ShiziScreenRegistry.screenClass(name) else {
            ShiziProbe.log("native stage: open without a native class (\(body["screen"] ?? "?"))")
            done()
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.ensure()
        let payload = body["payload"] as? [String: Any] ?? [:]
        let params = body["params"] as? [String: Any] ?? [:]
        let via = body["via"] as? String ?? "push"
        let run = (body["run"] as? [[String: Any]] ?? []) + [["entryId": entryId, "screen": name, "params": params, "payload": payload]]
        // 1. 对齐：从底往上，条目 id 相同（或页面重载期间屏名相同）的留着
        let reattaching = NativeNavState.shared.awaitingReattach
        var keep = 0
        while keep < screens.count, keep < run.count {
            let want = run[keep]
            let page = screens[keep]
            guard !page.exitHandled, page.entryId == want["entryId"] as? String || (reattaching && page.screen == want["screen"] as? String) else { break }
            if let id = want["entryId"] as? String { page.entryId = id }
            keep += 1
        }
        if keep == run.count {
            // 这一条已经在原生栈里（重载后认领 / 同一条目再发）：只换视图，多出来的上层收起
            let page = screens[keep - 1]
            page.update(params: params)
            page.apply(payload: payload)
            if keep < screens.count { release(from: keep, fade: true, then: done) } else { done() }
            return
        }
        let finishOpen = { [weak self] in
            guard let self else { done(); return }
            self.rebuild(run, from: keep) {
                self.present(cls, name: name, entryId: entryId, params: params, payload: payload, via: via, plan: body["plan"] as? [String: Any], done: done)
            }
        }
        if keep < screens.count {
            // 栈顶上不属于这一串的原生页（网页别处换了页）：样子留在原处、收起，新页盖在样子上面
            release(from: keep, fade: false, then: finishOpen)
        } else {
            finishOpen()
        }
    }

    /// 重建 run[from ..< 最后一条] 里还不在原生栈上的原生页（从网页页面回来：它们让开时一起收起了）。没有视图回包的跳过。
    private func rebuild(_ run: [[String: Any]], from start: Int, then: @escaping () -> Void) {
        var i = start
        func next() {
            guard i < run.count - 1 else { then(); return }
            let item = run[i]
            i += 1
            guard let name = item["screen"] as? String, let id = item["entryId"] as? String, let cls = ShiziScreenRegistry.screenClass(name),
                  let payload = item["payload"] as? [String: Any] else { next(); return }
            present(cls, name: name, entryId: id, params: item["params"] as? [String: Any] ?? [:], payload: payload, via: "return", plan: nil) { next() }
        }
        next()
    }

    private func present(_ cls: ShiziScreenViewController.Type, name: String, entryId: String, params: [String: Any], payload: [String: Any], via: String,
                         plan: [String: Any]?, done: @escaping () -> Void) {
        let presenterNow = screens.last ?? topPresented()
        if let leaving = presenterNow.presentedViewController {
            // 上面还有一张正在收起 / 没交出的页（被别处卸掉的旧页）：等它收起再呈现（UIKit 呈现进行中再呈现会被丢掉）
            (leaving as? ShiziScreenViewController)?.exitHandled = true
            NativeStage.dismissWhenSettled(leaving) { [weak self] in
                guard let self else { done(); return }
                self.present(cls, name: name, entryId: entryId, params: params, payload: payload, via: via, plan: plan, done: done)
            }
            return
        }
        let vc = cls.init(screen: name, entryId: entryId, params: params)
        vc.stage = self
        vc.apply(payload: payload)
        // 冷启动恢复与从网页页面回来不带转场（网页已播完返回，露出的就是这一页的样子）；安静入口（通知 / 无来源）淡入；其余点按入口推入
        let kind: NativeNavKind = via == "restore" || via == "return" ? .none : (via == "quiet" || (plan?["mode"] as? String) == "quiet") ? .quiet : .push
        vc.enteredKind = kind == .none ? .push : kind
        let under = screens.last
        vc.transitions.plan = NativeNavPlan(kind: vc.enteredKind)
        vc.transitions.host = host.view
        let presenter = under ?? topPresented()
        screens.append(vc)
        ShiziProbe.note("screen:open \(name) via=\(via)")
        if let t0 = tapAt, kind != .none {
            tapAt = nil
            vc.transitions.onFirstFrame = { Self.recordLatency((CACurrentMediaTime() - t0) * 1000) }
        }
        vc.transitions.under = under?.view ?? NativeResultCover.adopt()
        vc.transitions.present(vc, over: presenter, kind: kind) {
            if under == nil { NativeResultCover.clear() }
            done()
        }
    }

    /// close {entryId}：宿主被别处卸掉（切 tab、深链、阻断、整体替换）——这一页与它上面的原生页收起（样子留着，没人接手时淡出），不发 nav.back。
    private func closeScreen(_ body: [String: Any], done: @escaping () -> Void) {
        guard let id = body["entryId"] as? String, let i = screens.firstIndex(where: { $0.entryId == id }), !screens[i].exitHandled else { done(); return }
        ShiziProbe.note("screen:close \(screens[i].screen)")
        release(from: i, fade: true, then: done)
    }

    /// 收起 screens[from...]（全部标为已交接，viewDidDisappear 不再发 nav.back）：顶上那页的样子留在原处，fade = 没有新页接手时等页面画好再淡出。
    private func release(from i: Int, fade: Bool, then: @escaping () -> Void) {
        guard i < screens.count else { then(); return }
        let gone = Array(screens[i...])
        screens.removeSubrange(i...)
        ShiziProbe.note("screen:release \(gone.map(\.screen).joined(separator: ","))")
        gone.forEach { $0.exitHandled = true; $0.transitions.finishNow() }
        if let top = gone.last { NativeResultCover.cover(top.view, in: host.view) }
        NativeStage.dismissWhenSettled(gone[0]) { [weak self] in
            guard let self else { then(); return }
            if fade { NativeResultCover.fadeLater(bridge: NativeWriteBridge(webView: self.host.webView)) }
            then()
        }
    }

    /// 写字 / 结果页要盖上来（B2 通道）：通用原生页一并交出（它们会随 B2 通道收起「其他页」时一起收起），不发 nav.back。
    private func handOverScreens() {
        if !screens.isEmpty { ShiziProbe.note("screen:handover") }
        screens.forEach { $0.exitHandled = true }
        screens.removeAll()
    }

    // MARK: 原生页发起的导航

    /// 返回（「‹」/ 两指 Z 形）：播退场（进来时那种转场倒放），收起后 screenDidLeave 发 nav.back。
    func back(_ page: ShiziScreenViewController) {
        guard isTop(page), !page.transitions.isLeaving, page.presentingViewController != nil else { return }
        page.transitions.plan = NativeNavPlan(kind: page.enteredKind)
        page.transitions.leave(page)
    }

    /// 原生页收起了（点按返回或左缘跟手完成）：出栈，网页路由 nav.back（网页不再播，root.js nativeMoves）。
    func screenDidLeave(_ page: ShiziScreenViewController) {
        guard let i = screens.firstIndex(where: { $0 === page }) else { return }
        screens.remove(at: i)
        ShiziProbe.note("screen:back \(page.screen)")
        engine.raw("nav.back", ["via": "native"]) { reply in
            if (reply["ok"] as? Bool) != true { ShiziProbe.log("native stage: nav.back failed \(reply)") }
        }
    }

    /// 推入 screen（原生页里点按）。目标有原生类 → nav.push，宿主回发 open；目标是网页屏 → 先让开（样子交给宿主层）再 nav.push。
    func navigate(from page: ShiziScreenViewController, push screen: String, params: [String: Any] = [:]) {
        guard isTop(page), !page.transitions.isLeaving else { return }
        tapAt = CACurrentMediaTime()
        let args: [String: Any] = ["screen": screen, "params": params]
        if ShiziScreenRegistry.screenClass(screen) != nil {
            engine.raw("nav.push", args) { [weak self] reply in
                if (reply["ok"] as? Bool) != true { self?.tapAt = nil; ShiziProbe.log("native stage: nav.push \(screen) failed \(reply)") }
            }
            return
        }
        yieldToWeb(from: page) { [weak self] in
            self?.engine.raw("nav.push", args) { _ in }
        }
    }

    /// 让给网页页面：原生页截图交给宿主层（解码好才回包）→ go（网页换页）→ 等页面画完一帧 → 原生栈整个收起（不带转场，不发 nav.back）。
    private func yieldToWeb(from page: ShiziScreenViewController, go: @escaping () -> Void) {
        tapAt = nil
        page.transitions.finishNow()
        let url = WebViewController.snapshotURL(page.view)
        var args: [String: Any] = ["entryId": page.entryId]
        if let url { args["url"] = url }
        ShiziProbe.note("yield:screen")
        engine.raw("stage.cover", args) { [weak self] _ in
            go()
            self?.engine.raw("stage.fence", [:]) { _ in
                self?.enqueue { done in
                    guard let self, !self.screens.isEmpty else { done(); return }
                    self.release(from: 0, fade: false, then: done)
                }
            }
        }
    }

    // MARK: 量测

    static func recordLatency(_ ms: Double) {
        latencies.append(ms)
        if latencies.count > 64 { latencies.removeFirst(latencies.count - 64) }
        ShiziProbe.log(String(format: "native stage: tap → first frame %.1f ms", ms))
    }

    // MARK: 页面重载

    func pageWillReload() {
        engine.pageWillReload()
    }

    func pageDidBecomeReady() {
        engine.pageDidBecomeReady()
    }

    /// 重载后没人认领：通用原生栈整个收起淡出（B2 页面走 stepAsideLeavingCover）。
    func releaseUnclaimedScreens() {
        enqueue { [weak self] done in
            guard let self, !self.screens.isEmpty else { done(); return }
            ShiziProbe.note("reload:unclaimed")
            self.release(from: 0, fade: true, then: done)
        }
    }

    #if DEBUG
    /// QA：收掉全部通用原生页（不发 nav.back、不淡出）。
    @MainActor func resetScreensForTesting() async {
        queue.removeAll()
        busy = false
        screens.forEach { $0.exitHandled = true }
        screens.removeAll()
        // 呈现链上所有通用原生页（含还在呈现中、没进栈表的）一并收起
        for _ in 0..<3 {
            try? await Task.sleep(nanoseconds: 120_000_000)
            var top: UIViewController = host
            var first: ShiziScreenViewController?
            while let p = top.presentedViewController {
                if let s = p as? ShiziScreenViewController { s.exitHandled = true; if first == nil { first = s } }
                top = p
            }
            guard let first else { break }
            await withCheckedContinuation { cont in DispatchQueue.main.async { NativeStage.dismissWhenSettled(first) { cont.resume() } } }
        }
        NativeResultCover.clear()
    }
    #endif

    // MARK: - B2 写字 / 结果 / 重写错字页（消息 nativeWrite；行为同 B2.8）

    var nativeWriteTop: NativeWriteViewController? { host.presentedViewController as? NativeWriteViewController }
    var nativeRedoTop: NativeWriteViewController? { nativeWriteTop.flatMap { $0.redo ? $0 : nil } }
    var nativeResultTop: NativeResultViewController? { host.presentedViewController as? NativeResultViewController }

    func handleWriteMessage(_ body: [String: Any]) {
        guard WebViewController.nativeWriteEnabled else { return }
        engine.webView = host.webView
        let op = body["op"] as? String ?? ""
        let slot = body["slot"] as? String == "B" ? "B" : "A"
        switch op {
        case "open":
            handleWriteOpen(body, slot: slot)
        case "result-open":
            handleResultOpen(body)
        case "result-close":
            handleResultClose(body, slot: slot)
        case "redo-open", "redo-close":
            handleRedoMessage(op, body)
        case "close":
            // 宿主条目被别处卸掉（深链换组、跨天作废、阻断页、store 整体替换）：原生页跟着离开，不再发 exit。
            // 样子留在原处：紧接着有新的原生页（深链换组）就压在它上面推入 / 淡入，否则等页面画好再淡出（不闪、不留残影）。
            guard let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo else { return }
            top.exitHandled = true
            ShiziProbe.note("close")
            stepAsideLeavingCover(top)
        default:
            break
        }
    }

    private func handleWriteOpen(_ body: [String: Any], slot: String) {
        let receivedAt = CACurrentMediaTime()
        let receivedEpochMs = Date().timeIntervalSince1970 * 1000
        let payload = body["payload"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, let snap = payload["snapshot"] as? [String: Any], (snap["active"] as? Bool) == true else {
            ShiziProbe.log("native-write open without an active session (slot \(slot))")
            // 宿主还在、组已经没了（重载后恢复出的写字条目，组已作废）：盖着的同槽原生页收起，不留一张写不了的页
            if let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo {
                top.exitHandled = true
                ShiziProbe.note("close")
                stepAsideLeavingCover(top)
            }
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: payload)
        #if DEBUG
        NativeWriteMetrics.shared.recordJs("open", ms: (payload["ms"] as? NSNumber)?.doubleValue ?? 0)
        #endif
        let via = body["via"] as? String ?? ""
        if let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo {
            top.resync(payload: payload)
            return
        }
        let vc = NativeWriteViewController(slot: slot, payload: payload, bridge: NativeWriteBridge(webView: host.webView))
        vc.coordinator = self
        vc.openTiming = ((body["sentAt"] as? NSNumber)?.doubleValue ?? receivedEpochMs, receivedAt, receivedEpochMs)
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.transitions
        let animate = body["animate"] as? Bool ?? true
        ShiziProbe.note("open via=\(via) animate=\(animate)") // QA-H1 测试钩子：转场核对（NF-01）
        let plan = NativeNavPlan(body["plan"] as? [String: Any])
        // D62：首页入口纸展开（home）、无来源入口安静淡入（quiet）、其他点按入口推入（push / again：结果页「再写一组」/ 撤销跳过）；
        // 冷启动恢复（restore）与从字详情回来（return：网页已播完字详情滑出，露出的就是这一页的样子）不带转场。
        let kind: NativeNavKind = !animate || via == "restore" || via == "return" ? .none
            : via == "home" ? .paper : via == "quiet" ? .quiet : .push
        prepareTransitions(vc.transitions, plan: kind == .none ? NativeNavPlan(kind: .push) : plan.with(kind: kind))
        let show: () -> Void = { [weak self] in // vc 强引用：旧页收起之后才呈现，局部变量那时已出作用域
            guard let self else { return }
            vc.transitions.under = NativeResultCover.adopt()
            vc.transitions.present(vc, over: self.host, kind: kind) { NativeResultCover.clear() }
        }
        if let other = host.presentedViewController {
            // 结果页「再写一组」/ 撤销跳过 → 新写字页（或深链换组）：旧页的样子留在原处，新写字页推入盖在它上面（D62：同一层换内容也是普通推入）
            (other as? NativeWriteViewController)?.exitHandled = true
            (other as? NativeResultViewController)?.exitHandled = true
            handOverScreens()
            if NativeResultCover.current == nil { NativeResultCover.cover(other.view, in: host.view) }
            (other as? NativeTransitionPage)?.transitions.finishNow()
            Self.dismissWhenSettled(other, then: show)
        } else {
            show()
        }
    }

    /// 页面问一次「顶层原生页回去时怎么走」（paper 带被点元素此刻的矩形）；返回前与左缘起手时各问一次（结果在 planProvider 回调里）。
    private func prepareTransitions(_ t: NativeWriteTransitions, plan: NativeNavPlan) {
        t.plan = plan
        t.host = host.view
        let bridge = NativeWriteBridge(webView: host.webView)
        t.planProvider = { done in
            bridge.callNav("back") { reply in done(reply.ok ? NativeNavPlan(reply.body["plan"] as? [String: Any]) : nil) }
        }
    }

    /// 原生页被别处卸掉（close / 结果条目被移出页面栈）：样子留在原处、原生页立即收起；若没有新的原生页接手，等页面画好再 T-fade 淡出。
    private func stepAsideLeavingCover(_ page: UIViewController) {
        (page as? NativeTransitionPage)?.transitions.finishNow()
        NativeResultCover.cover(page.view, in: host.view)
        Self.dismissWhenSettled(page) { [weak self] in
            guard let self else { return }
            NativeResultCover.fadeLater(bridge: NativeWriteBridge(webView: self.host.webView))
        }
    }

    /// 让开：等页面画完一帧（网页已换好页，推入从第一帧起），原生页不带转场收起。
    private func yield(_ page: UIViewController, bridge: NativeWriteBridge, what: String) {
        ShiziProbe.note("yield:\(what)")
        bridge.callNav("fence") { [weak page] _ in
            guard let page, page.presentingViewController != nil else { return }
            (page as? NativeTransitionPage)?.transitions.finishNow()
            Self.dismissWhenSettled(page)
        }
    }

    /// 返回（‹ / ×）：先向页面问一次回去的路（纸缩回时被点元素此刻的位置与字），再放转场；问不到（超时）就按进来时记下的计划走。
    private func leave(_ page: UIViewController, _ t: NativeWriteTransitions) {
        guard page.presentingViewController != nil, !t.isLeaving else { return }
        t.isLeaving = true
        var done = false
        let go: (NativeNavPlan?) -> Void = { [weak page, weak t] plan in
            guard !done, let page, let t else { return }
            done = true
            if let plan { t.plan = plan }
            t.leave(page)
        }
        if let ask = t.planProvider {
            ask { plan in go(plan) }
            DispatchQueue.main.asyncAfter(deadline: .now() + NativeNavState.planWait) { go(nil) }
        } else {
            go(nil)
        }
    }

    /// 不带动画收起一张覆盖页；它还在 UIKit 呈现转场里时等转场完再收（UIKit 转场中途 dismiss 会被忽略）。
    static func dismissWhenSettled(_ vc: UIViewController, then: (() -> Void)? = nil) {
        if vc.isBeingPresented || vc.isBeingDismissed, let tc = vc.transitionCoordinator {
            tc.animate(alongsideTransition: nil) { _ in
                if vc.presentingViewController != nil { vc.dismiss(animated: false, completion: then) } else { then?() }
            }
            return
        }
        if vc.presentingViewController == nil { then?(); return }
        vc.dismiss(animated: false, completion: then)
    }

    private func handleResultOpen(_ body: [String: Any]) {
        let slot = body["slot"] as? String == "B" ? "B" : "A"
        let sid = body["sessionId"] as? String ?? ""
        let payload = body["payload"] as? [String: Any] ?? [:]
        let look = body["look"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, let v = payload["view"] as? [String: Any], (v["found"] as? Bool) == true else {
            ShiziProbe.log("native-result open without a group (slot \(slot))")
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: look)
        let via = body["via"] as? String ?? ""
        if let top = nativeResultTop, top.slot == slot, top.sessionId == sid, !top.exitHandled {
            top.apply(view: v)
            return
        }
        let vc = NativeResultViewController(slot: slot, sessionId: sid, look: look, view: v, bridge: NativeWriteBridge(webView: host.webView))
        vc.coordinator = self
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.transitions
        let animate = (body["animate"] as? Bool) ?? true
        ShiziProbe.note("result:open via=\(via) animate=\(animate)")
        // 结果页回去的路由页面定（写字页从首页纸展开进来的：纸缩回；推入进来的：右滑出；安静淡入进来的：安静淡出），返回前再问
        prepareTransitions(vc.transitions, plan: NativeNavPlan(kind: .push))
        if let w = nativeWriteTop {
            // 写完最后一字（或结束这组有判断）：写字页的样子留在原处，原生结果页在它上面淡入（D20 无中间页，T-phase）
            w.exitHandled = true
            w.transitions.finishNow()
            NativeResultCover.cover(w.view, in: host.view)
            Self.dismissWhenSettled(w) { [weak self] in
                guard let self else { return }
                vc.transitions.present(vc, over: self.host, kind: .phase) { NativeResultCover.clear() }
            }
            return
        }
        // 从重写错字 / 字详情 / 分享回来（return：网页已播完返回转场，露出的是网页结果页本身）与冷启动恢复：不带转场直接盖上
        let kind: NativeNavKind = !animate || via == "return" || via == "restore" ? .none : via == "write" ? .phase : .push
        let show: () -> Void = { [weak self] in // vc 强引用：旧页收起之后才呈现，局部变量那时已出作用域
            guard let self else { return }
            vc.transitions.under = NativeResultCover.adopt()
            vc.transitions.present(vc, over: self.host, kind: kind) { NativeResultCover.clear() }
        }
        if let other = host.presentedViewController {
            (other as? NativeResultViewController)?.exitHandled = true
            (other as? NativeWriteViewController)?.exitHandled = true
            handOverScreens()
            (other as? NativeTransitionPage)?.transitions.finishNow()
            Self.dismissWhenSettled(other, then: show)
        } else {
            show()
        }
    }

    /// 结果条目被移出页面栈（离开 / 再写一组 / 撤销跳过 / 跨天作废等），或为重写错字 / 字详情 / 网页分享弹层让开（away）。
    private func handleResultClose(_ body: [String: Any], slot: String) {
        guard let top = nativeResultTop, top.slot == slot, !top.transitions.isLeaving else { return }
        if let sid = body["sessionId"] as? String, sid != top.sessionId { return }
        let away = (body["away"] as? Bool) == true
        ShiziProbe.note("result:close away=\(away)")
        top.exitHandled = true
        if away {
            // 让开：网页此刻显示网页结果页本身（推入 / 弹层盖在它上面），画好一帧后原生页直接收起
            yield(top, bridge: NativeWriteBridge(webView: host.webView), what: "result")
        } else {
            // 再写一组 / 撤销跳过：结果页的样子留在原处，新写字页推入盖在它上面（handleWriteOpen 接手）；没有新页接手时淡出
            stepAsideLeavingCover(top)
        }
    }

    /// 页面重写错字宿主条目（NativeRedoHost）的消息：redo-open = 原生重写错字页 T-push 推入（结果页的样子留在下面做视差，推入完收掉）；
    /// 回去（「完成」/「‹」/ 左缘右滑）= 同一个对象 T-push 倒放（露出网页结果页本身），收起后发 redoExit → 页面 nav.back，
    /// 结果条目等网页空闲后 result-open via 'return' 不带转场换回原生——只有一段转场。
    /// redo-close = 条目被别处卸掉（深链 / store 整体替换）：原生页的样子留在原处、原生页收起，不发 redoExit，等页面画好淡出。
    private func handleRedoMessage(_ op: String, _ body: [String: Any]) {
        if op == "redo-close" {
            if let top = nativeRedoTop, !top.exitHandled, !top.transitions.isLeaving {
                top.exitHandled = true
                ShiziProbe.note("close")
                stepAsideLeavingCover(top)
            }
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, payload["snapshot"] is [String: Any] else {
            ShiziProbe.log("native-redo open without chars")
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: payload)
        if let top = nativeRedoTop, !top.exitHandled {
            top.resync(payload: payload) // 页面重载后同一条目再发：只换外观，第几个字留在原生
            return
        }
        let vc = NativeWriteViewController(slot: "redo", payload: payload, bridge: NativeWriteBridge(webView: host.webView), redo: true)
        vc.coordinator = self
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.transitions
        let animate = body["animate"] as? Bool ?? true
        let via = body["via"] as? String ?? ""
        ShiziProbe.note("redo:open via=\(via) animate=\(animate)")
        let kind: NativeNavKind = !animate || via == "restore" ? .none : .push
        prepareTransitions(vc.transitions, plan: NativeNavPlan(kind: .push))
        let show: () -> Void = { [weak self] in
            guard let self else { return }
            vc.transitions.under = NativeResultCover.adopt()
            vc.transitions.present(vc, over: self.host, kind: kind) { NativeResultCover.clear() }
        }
        if let other = host.presentedViewController {
            // 结果页「重写错字」：结果页的样子留在原处当下层，重写错字页推入盖在它上面（结果页的让开不再另起转场）
            (other as? NativeWriteViewController)?.exitHandled = true
            (other as? NativeResultViewController)?.exitHandled = true
            handOverScreens()
            (other as? NativeTransitionPage)?.transitions.finishNow()
            if NativeResultCover.current == nil { NativeResultCover.cover(other.view, in: host.view) }
            Self.dismissWhenSettled(other, then: show)
        } else {
            show()
        }
    }

    // MARK: B2.8 页面重载

    /// 页面重新加载（WebContent 进程被回收 / 新文档）：原生页先留在屏上（本地笔画在内存里），等页面就绪后看宿主是否认领。
    func nativePageWillReload() {
        pageWillReload()
        guard WebViewController.nativeWriteEnabled, host.presentedViewController is NativeTransitionPage else { return }
        NativeNavState.shared.awaitReattach()
    }

    /// 页面就绪：重载前盖着的原生页，若页面在等待时间内没有再发 open / result-open（路由没有恢复出这一页），样子留着、原生页收起、等页面画好再淡出。
    func nativePageDidBecomeReady() {
        pageDidBecomeReady()
        guard WebViewController.nativeWriteEnabled, NativeNavState.shared.awaitingReattach else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + NativeNavState.reattachWait) { [weak self] in
            guard let self, NativeNavState.shared.takeUnclaimed(), let page = self.host.presentedViewController as? NativeTransitionPage else { return }
            if page is ShiziScreenViewController {
                self.releaseUnclaimedScreens()
                return
            }
            (page as? NativeWriteViewController)?.exitHandled = true
            (page as? NativeResultViewController)?.exitHandled = true
            ShiziProbe.note("reload:unclaimed")
            self.stepAsideLeavingCover(page)
        }
    }
}

// MARK: - B2 协调协议（写字 / 结果页的出口）

extension NativeStage: NativeWriteCoordinating {
    func nativeWriteDidRequestBack(_ vc: NativeWriteViewController) {
        // 现场在抬笔 / 撤销 / 清空时已发出（P52）；这里只离开。转场放完、收起后（viewDidDisappear）发 exit back。
        leave(vc, vc.transitions)
    }

    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String) {
        nativeWriteDidFinish(vc, sessionId: sessionId, undo: nil)
    }

    /// undo（B2.6）：跳过最后一字后 5 秒撤销机会还在时，剩余时长与笔画随 exit 交给结果页（页面 handoffSkipUndo）。
    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String, undo: [String: Any]?) {
        vc.exitHandled = true
        vc.saveMetrics()
        vc.endUndo()
        var args: [String: Any] = ["slot": vc.slot, "to": "result", "sessionId": sessionId]
        if let undo { args["undo"] = undo }
        // 先让页面把写字条目就地换成结果页（D20 无中间页）；B2.7 起结果页是原生的：页面的结果宿主随即发 result-open，
        // 由 handleResultOpen 把写字页淡成原生结果页（T-phase）。页面没请原生结果页（找不到这一组）时保底：等页面画好，原生页淡出露出网页。
        NativeWriteBridge(webView: host.webView).call("exit", args) { [weak self, weak vc] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + NativeNavState.handoffWait) {
                guard let self, let vc, self.host.presentedViewController === vc, !vc.transitions.isLeaving else { return }
                self.stepAsideLeavingCover(vc)
            }
        }
    }

    /// R9-B / B2.8：改判弹层「看这个字 ›」（D66 ⑮）：写字条目留在网页栈里，字详情推入在它上面。原生页的样子先以截图交给宿主层（字详情推入 / 左缘滑回时露出的是它），
    /// 页面推入字详情、画好一帧后原生页直接收起（推入由网页播）；详情返回时宿主等网页转场放完再请原生盖上（open via 'return'，不带转场）。
    func nativeWriteOpenDetail(_ vc: NativeWriteViewController, char: String) {
        guard !vc.exitHandled else { return }
        vc.exitHandled = true // 交给页面导航中（失败时放回）
        let bridge = NativeWriteBridge(webView: host.webView)
        let slot = vc.slot
        vc.transitions.finishNow()
        let url = WebViewController.snapshotURL(vc.view)
        // 截图先交给宿主层并等页面解码好（cover 回包），再请页面推入字详情——推入的第一帧下面就是原生页的样子
        bridge.callNav("cover", url.map { ["slot": slot, "url": $0] } ?? ["slot": slot]) { [weak self, weak vc] _ in
            guard let self, let vc else { return }
            self.openDetailAfterCover(vc, char: char, bridge: bridge)
        }
    }

    private func openDetailAfterCover(_ vc: NativeWriteViewController, char: String, bridge: NativeWriteBridge) {
        let slot = vc.slot
        bridge.call("exit", ["slot": slot, "to": "detail", "char": char]) { [weak self, weak vc] reply in
            guard let self, let vc else { return }
            guard reply.ok else {
                vc.exitHandled = false
                bridge.callNav("cover", ["slot": slot]) { _ in }
                return
            }
            vc.saveMetrics()
            vc.endUndo()
            self.yield(vc, bridge: bridge, what: "detail")
        }
    }
}

extension NativeStage: NativeResultCoordinating {
    func nativeResultWillNavigate(_ vc: NativeResultViewController) {}

    /// 「×」/ 底栏离开（N3-5）：回来源的转场由页面定（来源是首页且写字页从首页纸展开进来的 = 纸缩回；其余推入倒放 / 安静淡出），放完后发 resultExit leave。
    func nativeResultLeave(_ vc: NativeResultViewController) {
        leave(vc, vc.transitions)
    }
}

// MARK: - WebViewController 一侧（开关、注入、消息入口；B2 的调用点名字照旧）

extension WebViewController {
    /// 真机试用：带 `-shizi-native-write` 启动一次后记在 UserDefaults，之后从主屏打开也保持开启；
    /// 带 `-shizi-native-write-off` 启动一次即关闭。B3.1 起 Release 同样有这一套（默认关；TestFlight / App Store 安装带不了启动参数，所以那里一直是网页版），B3.F 去掉。
    /// B3.2：同一个开关也打开通用原生屏（NativeStage）。
    static var nativeWriteEnabled: Bool {
        let p = ProcessInfo.processInfo
        let key = "shizi.debug.nativeWrite"
        if p.arguments.contains("-shizi-native-write-off") {
            UserDefaults.standard.set(false, forKey: key)
            return false
        }
        if p.arguments.contains("-shizi-native-write") || p.environment["SHIZI_NATIVE_WRITE"] == "1" {
            UserDefaults.standard.set(true, forKey: key)
            return true
        }
        return UserDefaults.standard.bool(forKey: key)
    }

    func installNativeWriteUserScriptIfNeeded(_ controller: WKUserContentController) {
        guard Self.nativeWriteEnabled else { return }
        controller.addUserScript(WKUserScript(source: NativeStage.userScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    var nativeWriteTop: NativeWriteViewController? { stage.nativeWriteTop }
    /// B2.9a：原生重写错字页（与写字页同一个类，redo 模式）。
    var nativeRedoTop: NativeWriteViewController? { stage.nativeRedoTop }
    /// B2.7：原生结果页（与写字页同一种覆盖呈现）。
    var nativeResultTop: NativeResultViewController? { stage.nativeResultTop }

    func handleNativeWriteMessage(_ body: [String: Any]) { stage.handleWriteMessage(body) }
    func handleNativeScreenMessage(_ body: [String: Any]) {
        guard Self.nativeWriteEnabled else { return }
        stage.handleScreenMessage(body)
    }

    func nativePageWillReload() { stage.nativePageWillReload() }
    func nativePageDidBecomeReady() { stage.nativePageDidBecomeReady() }

    static func dismissWhenSettled(_ vc: UIViewController, then: (() -> Void)? = nil) { NativeStage.dismissWhenSettled(vc, then: then) }

    /// 原生页的样子（JPEG data URL，2 倍）：让开时交给宿主层（网页推入 / 左缘滑回时露出）。
    static func snapshotURL(_ v: UIView) -> String? {
        guard v.bounds.width > 0, v.bounds.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = min(2, v.window?.screen.scale ?? 2)
        format.opaque = true
        let image = UIGraphicsImageRenderer(bounds: v.bounds, format: format).image { _ in
            v.drawHierarchy(in: v.bounds, afterScreenUpdates: false)
        }
        guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }
}

/// 页面重载 / 宿主交接的等待时间（不是动效：动效时长一律取页面给的 motion.nav）。
final class NativeNavState {
    static let shared = NativeNavState()
    /// 写完最后一字交给结果页：页面没请原生结果页时多久后保底让开。
    static let handoffWait: TimeInterval = 1.0
    /// 返回前向页面问路：最多等这么久，问不到按进来时的计划走。
    static let planWait: TimeInterval = 0.25
    /// 页面重载后等宿主认领的时间。
    static let reattachWait: TimeInterval = 1.5

    private(set) var awaitingReattach = false
    private var heardSinceReload = false

    func awaitReattach() {
        awaitingReattach = true
        heardSinceReload = false
    }

    func heard() {
        heardSinceReload = true
    }

    /// 等待结束：没有认领时为 true（只回答一次）。
    func takeUnclaimed() -> Bool {
        guard awaitingReattach else { return false }
        awaitingReattach = false
        return !heardSinceReload
    }
}

/// 换页时的「旧页样子」（B2.7 / B2.8）：原生页换成另一张原生页 / 让给网页时，先把旧页的截图留在原处，新页盖上（或网页就位）后再收掉，不露出中间的网页层。
enum NativeResultCover {
    private(set) static weak var current: UIView?
    private static var token = 0

    static func cover(_ v: UIView, in host: UIView) {
        clear()
        guard let snap = v.snapshotView(afterScreenUpdates: false) else { return }
        snap.frame = host.bounds
        snap.isUserInteractionEnabled = false
        host.addSubview(snap)
        current = snap
    }

    /// 没有新的原生页接手：留一个 T-phase 时长（紧接着的 open 可以接手压在它上面），再等页面画好一帧，T-fade 原位淡出。
    static func fadeLater(bridge: NativeWriteBridge) {
        guard let snap = current else { return }
        token += 1
        let mine = token
        let fade = (NativeNavMotion.current?.phaseMs ?? 0) / 1000
        DispatchQueue.main.asyncAfter(deadline: .now() + fade) {
            guard current === snap, token == mine else { return }
            bridge.callNav("fence") { _ in
                guard current === snap, token == mine else { return }
                ShiziProbe.note("cover:fade")
                UIView.animate(withDuration: fade, delay: 0, options: [.curveLinear]) { snap.alpha = 0 } completion: { _ in
                    snap.removeFromSuperview()
                    if current === snap { current = nil }
                }
            }
        }
    }

    /// 新的原生页接手旧页的样子（当它的下层；视差画在它上面）：不再淡出，等新页进场放完由 clear 收掉。
    static func adopt() -> UIView? {
        token += 1
        return current
    }

    static func clear() {
        token += 1
        current?.removeFromSuperview()
        current = nil
    }
}
