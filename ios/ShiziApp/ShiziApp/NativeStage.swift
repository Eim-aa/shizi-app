import UIKit
import WebKit

/// 窗口外观的唯一应用点。UserDefaults 仅缓存最近已提交的显示偏好供启动首帧使用；
/// 引擎 store 就绪后立即覆盖缓存，不写回 store，也不参与任何规则计算。
enum ShiziTheme {
    private static let cacheKey = "shizi.native.appearance"
    private(set) static var bootOverride = UIUserInterfaceStyle.unspecified.rawValue

    static func boot(window: UIWindow) {
        let cached = UserDefaults.standard.string(forKey: cacheKey) ?? "auto"
        apply(cached, window: window)
        bootOverride = window.overrideUserInterfaceStyle.rawValue
    }

    static func apply(_ appearance: String, window: UIWindow?) {
        guard ["auto", "light", "dark"].contains(appearance) else { return }
        UserDefaults.standard.set(appearance, forKey: cacheKey)
        let style: UIUserInterfaceStyle = appearance == "light" ? .light : appearance == "dark" ? .dark : .unspecified
        if let window, window.overrideUserInterfaceStyle != style { window.overrideUserInterfaceStyle = style }
    }
}

// NativeStage：原生层的唯一协调者（B3.2 建，B3.F 起是导航真相源；计划 B3B4-原生化架构与计划.md §3.3 段 2、§3.4、§10.x B3.F）。
//
// 段 2（B3.F）：页面栈在原生（entries，底 → 顶 [{id, n, p}]；第 0 条是 tab 根）。网页不挂界面、只当引擎（src/ui/engine.js 引擎模式）。
//   - 窗口：WebViewController 的视图 = WKWebView（全尺寸、不藏，压在最下面，WebKit 不降速）+ 其上的原生根层（ShiziTabController，三格各留着自己的根页）；
//     推入的页是全局栈，盖在 Tab 栏之上（N6）：每张原生页是一个全屏覆盖呈现（.overFullScreen）的视图控制器，转场按进入方式取 ShiziTransitions
//     （T-push / T-paper / T-quiet / 减少动态效果淡化；D62 来源矩形、D70、S4 撤销交接、返回种类 page / phase、左缘跟手、防误点都照旧）。
//     不用 UINavigationController 的 push：push 完成后下层页的视图被移出窗口，T-paper / T-push 的下层视差与左缘跟手画的都是下层页（§10.x B3.F 技术决定 ①）。
//   - 原生发起的导航（页面点按推入、‹ / 左缘 / Z 形返回、点 tab、页内参数、页面的 nav.* op）：这里直接改栈，再 stage.enter 让引擎记账（来源记账、视图回包），不经网页路由决定去处；
//   - 「去哪」的规则在 JS 的（首页主按钮、结果页「再写一组」/ 离开、深链、开组失败…）：引擎发 {op:'nav'}，这里照做；
//   - 宿主消息（open / close / result-open / redo-open …，格式与段 1 宿主组件发的相同）由引擎按栈的变化算好发来，下面两条通道照原来的处理；
//   - 每次栈变化 route.save；冷启动 pageReady 后 route.plan 无转场重建；提醒深链 deeplink.reminder（WebViewController）；页面重载 stage.resync。
//
// 两条通道，同一套转场（ShiziTransitions = NativeWriteTransitions，一个对象、一个 frame(s)，点按与左缘跟手同一条路径）与同一套「样子留在原处」的换页做法：
//   1. 写字 / 结果 / 重写错字页（B2）：消息 nativeWrite（open / close / result-open / result-close / redo-open / redo-close），行为与 B2.8 一致。
//   2. 通用原生屏（B3 页面卡）：消息 native（open / close / changed / status）。屏名 → 类按约定 NSClassFromString("ShiziScreen_<屏名，- 换 _>")，不设登记表。
// 引擎（ShiziEngine / WebEngine）：页面推来的 changed / status 转给它，原生页订阅 changes、按 status 禁用按钮与重拉视图；页面的 nav.* op 由 WebEngine.navigator 转回这里。

/// 原生 tab 根页给 QA 探针的摘要（B3.5a；NativeStage.rootProbe 带出）。
protocol ShiziRootProbing: AnyObject {
    var rootProbe: [String: Any] { get }
}

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
    let engine: StageEngine
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
        engine = NativeStage.makeEngine(host: host)
        super.init()
        engine.navigator = { [weak self] op, args in self?.handleNavOp(op, args) ?? ["ok": false, "error": ["kind": "unavailable"]] }
        // 进后台：立即存一次栈，刷新离开时刻（冷启动判定的「离开多久」从这一刻算）
        NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    /// 引擎选择（ShiziEngineMode）：缺省 WebEngine；DEBUG -shizi-engine swift → SwiftEngine，shadow → WebEngine + 后台影子比对。
    private static func makeEngine(host: WebViewController) -> StageEngine {
        switch ShiziEngineMode.current {
        case .web:
            return WebEngine(webView: host.webView)
        case .swift:
            let e = SwiftEngine(webView: host.webView)
            e.playSound = { [weak host] name, gain in host?.playEngineSound(kind: name, gain: gain) }
            return e
        case .shadow:
            #if DEBUG
            ShadowEngine.start()
            #endif
            return WebEngine(webView: host.webView)
        }
    }

    @objc private func didEnterBackground() {
        saveRoute(flush: true)
    }

    // MARK: 开关与注入

    /// 文档开始注入：原生开关、有类的屏名清单（网页 ui/native-stage.js 读）。
    static func userScript() -> String {
        let list = (try? JSONSerialization.data(withJSONObject: ShiziScreenRegistry.screens)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        // B3.5d：tab 根页与原生 Tab 栏同开（B3.5a 的根页闸 -shizi-native-roots / __shiziNativeRoots 已删）
        // B3.F：__shiziEngine = 引擎模式（src/app.js：建 store、装 API，不挂网页界面；页面栈由这里持有）
        return "window.__shiziNativeWrite = true; window.__shiziNative = true; window.__shiziEngine = true; window.__shiziNativeScreens = \(list);"
    }

    // MARK: 页面推来的消息（type 'native'）

    func handleScreenMessage(_ body: [String: Any]) {
        engine.webView = host.webView
        switch body["op"] as? String ?? "" {
        case "nav":
            applyIntent(body) // B3.F：JS 发起的导航（去哪由 JS 规则定）——原生改自己的栈、存栈；宿主消息紧跟着到
        case "roots-reset":
            enqueue { [weak self] done in self?.dropHiddenRoots(); done() } // QA：夹具要新挂载的根页（排在前面的切 tab 之后）
        case "open" where (body["root"] as? Bool) == true:
            enqueue { [weak self] done in self?.openRoot(body, done: done) ?? done() }
        case "appearance":
            if let value = body["value"] as? String { ShiziTheme.apply(value, window: host.view.window) }
        case "open":
            enqueue { [weak self] done in self?.openScreen(body, done: done) ?? done() }
        case "close" where rootScreen != nil && (body["entryId"] as? String) == rootScreen?.entryId:
            enqueue { [weak self] done in self?.closeRoot(done: done) ?? done() }
        case "close":
            enqueue { [weak self] done in self?.closeScreen(body, done: done) ?? done() }
        case "corrupt":
            enqueue { [weak self] done in self?.setCorruptNotice(body, done: done) ?? done() }
        case "qa-faults":
            #if DEBUG
            (engine as? SwiftEngine)?.faultsArmed = true // B4.8：测试钩子挂了写入注入（SwiftEngine 在下一次写之前取走）
            #endif
        case "changed":
            #if DEBUG
            ShadowEngine.shared?.webChanged(body)
            #endif
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

    /// 顶层原生屏（没有 = nil）。没有呈现中的原生页时，看得见的原生 tab 根页（B3.5a）也算。
    var topScreen: ShiziScreenViewController? {
        if let s = screens.last { return s }
        guard host.presentedViewController == nil, let r = rootScreen, !r.view.isHidden else { return nil }
        return r
    }

    // MARK: Tab 栏（B3.5d；计划 §3.3 段 1 末、§7 第 3 条、D73 ③）
    //
    // 系统 UITabBarController 作段 1 的原生层根：它的视图（包在 ShiziTabHostView 里）插在 WKWebView 正上方，三个 tab 各一个占位控制器
    // （ShiziTabSlot），此刻的原生根页是选中那一格的子控制器、只铺到 Tab 栏上沿。导航真相仍是网页路由：点别的 tab → nav.tab，网页切 tab 后
    // 旧根页 close、新根页 open，这里随之换选中格（无动画、无触觉）；再点当前 tab → 根页滚回顶部（N6）。Tab 栏只在根页看得见时出现：
    // 推入的原生页、写字 / 结果页、弹层都呈现在宿主上面（盖住它）；网页页面 / 网页弹层盖上根页时连同 Tab 栏一起让开（截图连 Tab 栏交给网页）。
    // 与网页参考（Tabs.js）的外观差异是具名豁免 TAB-01（parity.config.json）。

    /// Tab 栏控制器（第一次打开根页时建；之后一直在，没有根页时藏起）。
    private(set) var tabs: ShiziTabController?
    /// 包 Tab 栏控制器视图的宿主视图（让开 / 没有根页时整个藏起；上面有模态层时对读屏藏起）。
    private(set) var tabHost: ShiziTabHostView?

    private func ensureTabs() -> ShiziTabController {
        if let t = tabs { return t }
        let t = ShiziTabController()
        let hostView = ShiziTabHostView(frame: host.view.bounds)
        hostView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostView.backgroundColor = .clear
        hostView.hiddenFromAccessibility = { [weak self] in self?.hostHasModal ?? false }
        host.addChild(t)
        t.view.frame = hostView.bounds
        t.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostView.addSubview(t.view)
        host.view.insertSubview(hostView, aboveSubview: host.webView)
        t.didMove(toParent: host)
        t.onSelect = { [weak self] name in self?.tabTapped(name) }
        t.onReselect = { [weak self] _ in self?.scrollRootToTop() }
        t.onLayout = { [weak self] in self?.layoutRoot() }
        tabs = t
        tabHost = hostView
        return t
    }

    /// Tab 栏的宿主视图跟根页走：有根页且没让开才看得见。
    private func syncTabHost() {
        guard let hostView = tabHost else { return }
        hostView.isHidden = rootScreen.map { $0.view.isHidden } ?? true
    }

    /// 点了另一个 tab（B3.F：原生直接切——栈回到那个 tab 的根，选中格当即换；引擎记账、存栈）。
    private func tabTapped(_ name: String) {
        guard rootScreen != nil, host.presentedViewController == nil else { return }
        ShiziProbe.note("tab:select \(name)")
        switchTab(name)
    }

    /// 再点当前 tab：根页滚回顶部（已在顶部什么都不做；减少动态效果时直接到顶，同网页 TabRoot onReselect）。
    func scrollRootToTop() {
        guard let r = rootScreen, let sv = Self.mainScroll(of: r) else { return }
        let top = -sv.adjustedContentInset.top
        guard sv.contentOffset.y > top + 0.5 else { return }
        ShiziProbe.note("tab:top \(r.screen)")
        sv.setContentOffset(CGPoint(x: sv.contentOffset.x, y: top), animated: !(ShiziProbe.forceReduceMotion || UIAccessibility.isReduceMotionEnabled))
    }

    /// 根页的主滚动区：页面骨架的 scroll（在视图树里时），否则视图树里第一个占了大半高度的竖向滚动区。
    static func mainScroll(of page: ShiziScreenViewController) -> UIScrollView? {
        if page.scroll.window != nil, page.scroll.bounds.height > 0 { return page.scroll }
        var queue: [UIView] = [page.view]
        while !queue.isEmpty {
            let v = queue.removeFirst()
            if let sv = v as? UIScrollView, !(v is UITextView), v !== page.view, sv.bounds.height > page.view.bounds.height * 0.5 { return sv }
            queue.append(contentsOf: v.subviews)
        }
        return nil
    }

    /// 让给网页时交给宿主层的「样子」：根页连同 Tab 栏（网页那边截图铺满整个 tab 图层，B3.5d 起网页不画自己的 Tab 栏），其余原生页是它自己。
    func coverView(of page: ShiziScreenViewController) -> UIView {
        if page === rootScreen, let hostView = tabHost, !hostView.isHidden { return hostView }
        return page.view
    }

    /// 原生根页（连同 Tab 栏）此刻看得见（网页内容在它下面，对读屏藏起：WebViewController）。
    var rootShown: Bool { tabHost.map { !$0.isHidden } ?? false }

    /// 探针：Tab 栏（看得见、选中的 tab、栏的框）。
    var tabsProbe: [String: Any]? {
        guard let t = tabs, let hostView = tabHost else { return nil }
        let f = t.tabBar.convert(t.tabBar.bounds, to: host.view)
        return ["shown": !hostView.isHidden && hostView.window != nil, "selected": t.selectedScreen ?? "",
                "frame": [f.minX, f.minY, f.width, f.height], "a11yHidden": hostView.accessibilityElementsHidden,
                "rootScrollY": rootScreen.flatMap { Self.mainScroll(of: $0) }.map { Double($0.contentOffset.y + $0.adjustedContentInset.top) } ?? 0]
    }

    // MARK: tab 根页（B3.5a）
    //
    // 原生 tab 根页不是呈现出来的覆盖页，而是 WebViewController 的子控制器、视图插在 WKWebView 正上方，只盖到 Tab 栏上沿（Tab 栏仍是网页的，
    // B3.5d 换原生 Tab 栏）：写字 / 结果 / 通用原生页照旧呈现在它上面，收起后露出的就是它（原生 → 原生 T-paper，B2.8 同一套转场）。
    // 网页页面 / 网页弹层盖到根页上时（open / root 消息带 covered），等网页画好一帧再藏起来；盖着的走了网页发 open via 'return'，直接露出、换视图。

    /// 原生 tab 根页（没有 = nil）。
    private(set) var rootScreen: ShiziScreenViewController?

    /// 原生根页的框（所在 tab 格的坐标）：铺到原生 Tab 栏上沿（B3.5d；栏还没排版时按网页 Tabs.js 的 49 + 下安全区）。
    private var rootFrame: CGRect {
        let b = host.view.bounds
        var barTop = b.height - (49 + host.view.safeAreaInsets.bottom)
        if let t = tabs, t.tabBar.bounds.height > 0 { barTop = t.tabBar.convert(t.tabBar.bounds, to: t.view).minY }
        return CGRect(x: 0, y: 0, width: b.width, height: max(0, barTop))
    }

    /// Tab 栏排版后（转屏、安全区变化）把根页对齐到栏上沿。
    private func layoutRoot() {
        guard let r = rootScreen, r.view.frame != rootFrame else { return }
        r.view.frame = rootFrame
    }

    /// 各 tab 的根页（B3.F：切 tab 不拆——三格各留着自己的根页，回来时页内状态还在；UITabBarController 只显示选中那一格）。
    private var roots: [String: ShiziScreenViewController] = [:]

    private func openRoot(_ body: [String: Any], done: @escaping () -> Void) {
        guard let name = body["screen"] as? String, let entryId = body["entryId"] as? String,
              let cls = ShiziScreenRegistry.screenClass(name) else { done(); return }
        NativeNavState.shared.heard()
        NativeNavMotion.ensure()
        let payload = body["payload"] as? [String: Any] ?? [:]
        let params = body["params"] as? [String: Any] ?? [:]
        ShiziProbe.note("root:open \(name) via=\(body["via"] as? String ?? "?")")
        let t = ensureTabs()
        let slot = t.select(name)
        if let r = roots[name], r.parent != nil {
            // 这一格的根页还在（切走过又回来）：同一个对象，换条目与视图
            r.entryId = entryId
            r.exitHandled = false
            r.update(params: params)
            r.apply(payload: payload)
            r.view.isHidden = false
            r.view.frame = rootFrame
            rootScreen = r
            syncTabHost()
            done()
            return
        }
        let parent: UIViewController = slot ?? host
        let vc = cls.init(screen: name, entryId: entryId, params: params)
        vc.stage = self
        vc.apply(payload: payload)
        parent.addChild(vc)
        vc.view.frame = rootFrame
        vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if let slot { slot.view.addSubview(vc.view) } else { host.view.insertSubview(vc.view, aboveSubview: tabHost ?? host.webView) }
        vc.didMove(toParent: parent)
        roots[name] = vc
        rootScreen = vc
        syncTabHost()
        done()
    }

    /// 根页的条目离开栈（切 tab）：根页留在它那一格（不拆），新根页 open 时换选中格。
    private func closeRoot(done: @escaping () -> Void) {
        if let r = rootScreen { ShiziProbe.note("root:close \(r.screen)") }
        done()
    }

    /// QA（夹具 switchTab remount）：拆掉没选中的格里留着的根页，下次切过去新建（不带上一个状态的页内状态）。
    private func dropHiddenRoots() {
        for (name, r) in roots where r !== rootScreen {
            r.exitHandled = true
            r.willMove(toParent: nil)
            r.view.removeFromSuperview()
            r.removeFromParent()
            roots[name] = nil
        }
    }

    private func removeRoot() {
        guard let r = rootScreen else { return }
        rootScreen = nil
        roots[r.screen] = nil
        r.exitHandled = true
        r.willMove(toParent: nil)
        r.view.removeFromSuperview()
        r.removeFromParent()
        syncTabHost()
    }

    /// 探针：原生根页（屏名、是否藏着、页面自己的摘要）。
    var rootProbe: [String: Any]? {
        guard let r = rootScreen else { return nil }
        var out: [String: Any] = ["screen": r.screen, "hidden": r.view.isHidden, "frame": [r.view.frame.minX, r.view.frame.minY, r.view.frame.width, r.view.frame.height]]
        if let p = (r as? ShiziRootProbing)?.rootProbe { out["page"] = p }
        return out
    }

    func isTop(_ page: ShiziScreenViewController) -> Bool { topScreen === page }

    /// 呈现着的一层是否把下面整个盖住（R14，B3.6 规则）：原生页（ShiziScreenViewController）看自己的底色——不透明的子页盖住，
    /// 透明的弹层屏（查字 / S02：遮罩下面的页看得见）不盖；自定义呈现的弹层（底部选择弹层、图片弹层等 .custom）只有不透明且铺满窗口才算；
    /// 其余呈现页（写字 / 结果页）盖住。
    static func coversBelow(_ vc: UIViewController) -> Bool {
        guard vc.isViewLoaded else { return false }
        let opaque = (vc.view.backgroundColor?.cgColor.alpha ?? 0) > 0.5
        if vc is ShiziScreenViewController { return opaque }
        // R16：查字 / S02 的绘制层（B3.6 合并后才有：弹层屏把遮罩与面板放进自己呈现的透明层）是那一页本身，透明、不盖住下面的根页（D75 ②）。
        // 漏了这一支时 R14 的「其余呈现页盖住」把它算成盖住，取证不取透明弹层下面的根页（全量里 query-* / s02* 每屏十几条「原生缺少」）。
        if vc is QueryOverlayLayer { return opaque }
        if vc.modalPresentationStyle == .custom {
            guard opaque, let w = vc.view.window else { return false }
            return vc.view.convert(vc.view.bounds, to: w).contains(w.bounds.insetBy(dx: 1, dy: 1))
        }
        return true
    }

    /// 从 vc 往上的呈现链里有没有盖住它的一层。
    static func coveredByPresented(_ vc: UIViewController) -> Bool {
        var cur = vc.presentedViewController
        while let c = cur {
            if coversBelow(c) { return true }
            cur = c.presentedViewController
        }
        return false
    }

    /// 这一页被盖住了（R14，一条规则管无障碍树与 QA-H1 取证）：根页 = 宿主往上的呈现链里有一层盖住（coversBelow）；
    /// 原生栈里的页 = 它往上的呈现链里有一层盖住。被盖住的页整页不进无障碍树（ShiziScreenView），QA-H1 也不取被盖住的根页。
    /// 透明弹层屏 / 底部弹层下面的页仍在（看得见；弹层自己 accessibilityViewIsModal）。
    func isCovered(_ page: ShiziScreenViewController) -> Bool {
        if page === rootScreen { return Self.coveredByPresented(host) }
        guard screens.contains(where: { $0 === page }) else { return false }
        return Self.coveredByPresented(page)
    }

    /// 从 vc 往上有没有任何一层呈现着的模态层（R16，读屏一支）：透明的弹层屏（查字 / S02）、选择弹层、底部弹层、图片弹层都算——
    /// 弹层下面的内容读屏摸不到、划不到（主控 R16 决定）。正在收起的那一层不算；查字 / S02 自己的绘制层（QueryOverlayLayer）是这一页本身，不算盖住它。
    static func modalAbove(_ vc: UIViewController) -> Bool {
        var cur = vc.presentedViewController
        while let c = cur {
            if !(c is QueryOverlayLayer), !c.isBeingDismissed { return true }
            cur = c.presentedViewController
        }
        return false
    }

    /// 这一页对读屏藏起来（R16）：取证用的 isCovered（不透明口径，D75 ②）之外，再加「上面有任何模态层」——读屏口径不跟取证口径走。
    func isHiddenFromAccessibility(_ page: ShiziScreenViewController) -> Bool {
        if isCovered(page) { return true }
        if page === rootScreen { return Self.modalAbove(host) || Self.modalAbove(page) }
        guard screens.contains(where: { $0 === page }) else { return false }
        return Self.modalAbove(page)
    }

    /// 宿主上有没有任何模态层（R16：网页内容——Tab 栏等——在弹层下面同样对读屏藏起来）。
    var hostHasModal: Bool { Self.modalAbove(host) }

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
        // 1. 对齐：从底往上，条目 id 相同的留着（B3.F：run 由引擎按原生的栈算）
        var keep = 0
        while keep < screens.count, keep < run.count {
            let want = run[keep]
            let page = screens[keep]
            guard !page.exitHandled, page.entryId == want["entryId"] as? String else { break }
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

    // MARK: 页面栈（B3.F：导航真相在原生；计划 §3.3 段 2）
    //
    // entries = 页面栈（底 → 顶，[{id, n, p}]；第 0 条是 tab 根）。每次栈或参数变了调 route.save（引擎写路由提示键，单一写入者），进后台刷新离开时刻。
    // 两种来源、同一套改栈语义（push / replace / pop / tab / params，引擎镜像 ui/engine.js 同名）：
    //   - 原生发起（原生页点按推入、‹ / 左缘 / Z 形返回、点 tab、页内参数）：这里先改栈，再 stage.enter 让引擎记账（来源记账、视图回包），
    //     回包里的宿主消息照原来的通道处理（open / close / result-open …）——去处由原生定，不经网页路由；
    //   - JS 发起（「去哪」的规则在 JS：首页主按钮、结果页「再写一组」/ 离开、深链、开组失败……）：页面发 {op:'nav'}，这里照做、存栈，宿主消息紧跟着到。
    // 冷启动：pageReady 后 route.plan（守卫 / 过期 / 深链 / 坏值 / 阻断优先全在 JS planColdStart），按回包无转场重建。

    /// 页面栈（底 → 顶）。
    private(set) var entries: [[String: Any]] = []
    private var nativeIds = 0
    /// 冷启动的 route.plan 做完了（之后的 pageReady 是页面重载：stage.resync）。
    private(set) var planned = false
    /// route.plan 之后要做的事（提醒深链等栈重建好再派发）。
    private var afterPlan: [() -> Void] = []

    private func newEntry(_ screen: String, _ params: [String: Any]) -> [String: Any] {
        nativeIds += 1
        return ["id": "n\(nativeIds)", "n": screen, "p": params]
    }

    /// 栈变了：存（引擎写提示键）。flush = 进后台刷新离开时刻（立即）；其余合并到转场之后（写提示键是一次同步落库，不放在点按到转场第一帧的路上）。
    func saveRoute(flush: Bool = false) {
        guard planned else { return }
        saveToken += 1
        let mine = saveToken
        let go = { [weak self] in
            guard let self, flush || mine == self.saveToken else { return }
            Self.rememberBootTab(self.entries.first?["n"] as? String) // 与 route.save 同时机（含进后台 flush）
            self.engine.raw("route.save", ["stack": self.entries, "flush": flush, "seq": self.jsSeq]) { reply in
                if (reply["ok"] as? Bool) != true { ShiziProbe.log("native stage: route.save failed \(reply)") }
            }
        }
        if flush { go() } else { DispatchQueue.main.asyncAfter(deadline: .now() + Self.saveDelay, execute: go) }
    }

    private var saveToken = 0
    /// JS 发来的导航意图做到了第几条（存栈时回报：引擎据此不让旧栈盖掉还在路上的意图）。
    private var jsSeq = 0
    /// 存栈的合并延迟：进场转场放完之后（取 motion 令牌：推入与纸展开里长的那个，再加一个淡化时长）。
    static var saveDelay: TimeInterval {
        let m = NativeNavMotion.current
        return (max(m?.pushMs ?? 0, m?.paperOpenMs ?? 0) + (m?.phaseMs ?? 0)) / 1000
    }

    /// 按意图改栈（JS 发来的 nav 与原生自己发起的同一套语义）。返回是否改了。
    @discardableResult
    private func mutate(_ kind: String, entry: [String: Any]? = nil, patch: [String: Any]? = nil) -> Bool {
        switch kind {
        case "push":
            guard let entry else { return false }
            entries.append(entry)
        case "replace":
            guard let entry, entries.count >= 2 else { return false }
            entries[entries.count - 1] = entry
        case "pop":
            guard entries.count >= 2 else { return false }
            entries.removeLast()
        case "tab":
            guard let entry else { return false }
            if entries.count == 1, entries[0]["n"] as? String == entry["n"] as? String { return false }
            entries = [entry]
        case "params":
            guard var top = entries.last else { return false }
            var p = top["p"] as? [String: Any] ?? [:]
            for (k, v) in patch ?? [:] { p[k] = v }
            top["p"] = p
            entries[entries.count - 1] = top
        default:
            return false
        }
        return true
    }

    /// JS 发起的导航（页面消息 {op:'nav', kind, entry?, patch?}）：原生照做、存栈。
    private func applyIntent(_ body: [String: Any]) {
        let kind = body["kind"] as? String ?? ""
        if let seq = (body["seq"] as? NSNumber)?.intValue { jsSeq = max(jsSeq, seq) }
        ShiziProbe.note("nav:\(kind) \((body["entry"] as? [String: Any])?["n"] as? String ?? "")")
        if mutate(kind, entry: body["entry"] as? [String: Any], patch: body["patch"] as? [String: Any]) { saveRoute() }
    }

    /// 原生发起：改栈 → stage.enter（引擎记账）→ 回包里的宿主消息按原来的通道处理 → 存栈。
    private func enter(_ kind: String, entry: [String: Any]? = nil, patch: [String: Any]? = nil, extra: [String: Any] = [:], then: (() -> Void)? = nil) {
        guard mutate(kind, entry: entry, patch: patch) else { then?(); return }
        var args = extra
        args["kind"] = kind
        if let entry { args["entry"] = entry }
        if let patch { args["patch"] = patch }
        engine.raw("stage.enter", args) { [weak self] reply in
            guard let self else { return }
            if (reply["ok"] as? Bool) != true { ShiziProbe.log("native stage: stage.enter \(kind) failed \(reply)") }
            self.dispatch(reply["bodies"] as? [[String: Any]] ?? [])
            self.saveRoute()
            then?()
        }
    }

    /// 宿主消息（引擎按栈的变化算出的 open / close / result-open …）交给原来的处理。
    private func dispatch(_ bodies: [[String: Any]]) {
        for b in bodies {
            guard let body = b["body"] as? [String: Any] else { continue }
            if b["type"] as? String == "nativeWrite" { handleWriteMessage(body) } else { handleScreenMessage(body) }
        }
    }

    /// 页面里的 nav.* op（WebEngine.navigator 转来）：原生直接做。
    func handleNavOp(_ op: String, _ args: [String: Any]) -> [String: Any] {
        switch op {
        case "nav.push":
            guard let screen = args["screen"] as? String, !screen.isEmpty else { return ["ok": false, "error": ["kind": "invalid"]] }
            push(screen, params: args["params"] as? [String: Any] ?? [:])
        case "nav.back":
            guard let top = topScreen, top !== rootScreen else { return ["ok": false] }
            back(top)
        case "nav.tab":
            guard let name = args["name"] as? String, !name.isEmpty else { return ["ok": false, "error": ["kind": "invalid"]] }
            switchTab(name)
        case "nav.setParams":
            enter("params", patch: args["patch"] as? [String: Any] ?? [:])
        case "nav.replace":
            guard let screen = args["screen"] as? String, !screen.isEmpty else { return ["ok": false, "error": ["kind": "invalid"]] }
            enter("replace", entry: newEntry(screen, args["params"] as? [String: Any] ?? [:]), extra: ["animate": args["animate"] as? Bool ?? false])
        default:
            return ["ok": false, "error": ["kind": "unknown-op"]]
        }
        return ["ok": true]
    }

    /// 推入一屏（原生页里点按）：栈上加一条、引擎记账回视图 → 原生屏播 T-push（下层是上一张原生页）。
    func push(_ screen: String, params: [String: Any] = [:]) {
        if ShiziTabController.tabs.contains(where: { $0.screen == screen }) { switchTab(screen); return }
        tapAt = CACurrentMediaTime()
        enter("push", entry: newEntry(screen, params))
    }

    /// 切到某个 tab：栈回到那个 tab 的根（上面的页一并收起）。
    func switchTab(_ name: String) {
        if entries.count == 1, entries[0]["n"] as? String == name { return }
        enter("tab", entry: newEntry(name, [:]))
    }

    /// 推入 screen（原生页里点按；B3.2 起的入口名照旧）。
    func navigate(from page: ShiziScreenViewController, push screen: String, params: [String: Any] = [:]) {
        guard isTop(page), !page.transitions.isLeaving else {
            ShiziProbe.log("navigate \(screen) refused: top=\(topScreen?.screen ?? "-") leaving=\(page.transitions.isLeaving) presented=\(String(describing: host.presentedViewController))")
            return
        }
        push(screen, params: params)
    }

    /// 段 1 的「让给网页页面」（截图交给宿主层再换页）在段 2 没有了：全部页面都是原生，盖上来的一律是原生页。go 直接做。
    func yieldToWeb(from page: ShiziScreenViewController, go: @escaping () -> Void) {
        tapAt = nil
        go()
    }

    /// 同上（B3.12 / B3.13 的公开入口）：直接调那个 op（它发的导航由页面以 nav 消息告诉这里）。
    func yieldToWeb(_ op: String, _ args: [String: Any], from page: ShiziScreenViewController) {
        guard isTop(page), !page.transitions.isLeaving else { return }
        tapAt = nil
        ShiziProbe.note("op \(op)")
        engine.raw(op, args) { _ in }
    }

    /// 返回（「‹」/ 两指 Z 形）：播退场（进来时那种转场倒放），收起后 screenDidLeave 出栈。
    func back(_ page: ShiziScreenViewController) {
        guard isTop(page), !page.transitions.isLeaving, page.presentingViewController != nil else { return }
        page.transitions.plan = NativeNavPlan(kind: page.enteredKind)
        page.transitions.leave(page)
    }

    /// 原生页收起了（点按返回或左缘跟手完成）：出栈（原生改栈、引擎记账；下面那页若是让开过的结果页 / 写字页，回包里带它的 return）。
    func screenDidLeave(_ page: ShiziScreenViewController) {
        guard let i = screens.firstIndex(where: { $0 === page }) else { return }
        screens.remove(at: i)
        ShiziProbe.note("screen:back \(page.screen)")
        guard entries.last?["id"] as? String == page.entryId else {
            ShiziProbe.log("native stage: back from \(page.screen) not on top of the stack")
            return
        }
        enter("pop", extra: ["cause": "native"])
    }

    // MARK: 冷启动 / 页面重载

    /// pageReady：第一次 = 冷启动（route.plan，按回包无转场重建）；之后 = 页面重载（stage.resync，原生页留着、引擎镜像对齐）。
    private func engineReady() {
        if planned {
            jsSeq = 0 // 新页面的意图序号从头数
            engine.raw("stage.resync", ["stack": entries]) { [weak self] reply in
                guard let self else { return }
                if (reply["ok"] as? Bool) != true { ShiziProbe.log("native stage: stage.resync failed \(reply)") }
                // 重载期间数据变了、上面几页不再成立（组没了等）：引擎按同一张有效性表截短，收起的页随宿主消息走（close → 样子留着淡出）
                if let stack = reply["stack"] as? [[String: Any]], stack.count < self.entries.count {
                    ShiziProbe.note("reload:cut \(self.entries.count)→\(stack.count)")
                    self.entries = stack
                    self.dispatch(reply["bodies"] as? [[String: Any]] ?? [])
                    self.saveRoute()
                }
                // 阻断页「再试一次」整页重载后不再阻断：重载前的阻断页收起（还阻断时新页面会再发 open，同一条目认领）
                if (reply["blocked"] as? Bool) != true {
                    self.enqueue { done in
                        guard let i = self.screens.firstIndex(where: { $0.screen == "block" }) else { done(); return }
                        self.release(from: i, fade: true, then: done)
                    }
                }
            }
            return
        }
        let t0 = CACurrentMediaTime()
        engine.raw("route.plan", ["deepLink": host.pendingReminderCardKey != nil]) { [weak self] reply in
            guard let self else { return }
            self.entries = reply["stack"] as? [[String: Any]] ?? []
            self.planned = true
            ShiziProbe.note("route:plan \(reply["reason"] as? String ?? "?") restored=\((reply["restored"] as? Bool) == true) depth=\(self.entries.count)")
            ShiziProbe.log(String(format: "native stage: route.plan %.1f ms", (CACurrentMediaTime() - t0) * 1000))
            self.dispatch(reply["bodies"] as? [[String: Any]] ?? [])
            self.saveRoute()
            let later = self.afterPlan
            self.afterPlan.removeAll()
            later.forEach { $0() }
        }
    }

    /// 启动首帧画了什么（"home" 静态首页 / "paper" 只有纸色；探针读）。
    private(set) var bootKind = "none"
    private static let bootTabKey = "shizi.native.bootTab"
    /// 原生侧的启动提示：上次存栈的 tab 根（引擎未就绪时原生问不了 JS；和 homeBoot 缓存同类，只决定首帧画什么）。
    static func rememberBootTab(_ tab: String?) {
        guard let tab, UserDefaults.standard.string(forKey: bootTabKey) != tab else { return }
        UserDefaults.standard.set(tab, forKey: bootTabKey)
    }
    static func bootTabHint() -> String? { UserDefaults.standard.string(forKey: bootTabKey) }

    /// 冷启动到首页首帧（ms，从进程创建算；QA 探针 / 日志读，门槛 ≤ 网页版 FCP 160–214ms）。
    private(set) static var bootFrameMs: Double?

    /// 启动首帧（B3.F 段 2 第 6 条）：引擎就绪前先把首页的静态版（「拾」+ 日期）放进「写字」格——route.plan 回来时同一张根页认领（openRoot 复用），
    /// 恢复出别的 tab 时它留在自己那一格。主按钮位置不变、就绪前不可点（引擎状态 reloading）。
    func bootFrame() {
        guard rootScreen == nil else { return }
        // D79 ③：上次存栈的根在「字库 / 我的」→ 首帧只有纸色（不闪首页）；route.plan 仍是真相，判成首页时到时再出现。
        if let tab = Self.bootTabHint(), tab != "home" {
            bootKind = "paper"
            ShiziProbe.note("boot:paper hint=\(tab)")
            let link = CADisplayLink(target: BootFrameProbe.shared, selector: #selector(BootFrameProbe.tick(_:)))
            BootFrameProbe.shared.link = link
            link.add(to: .main, forMode: .common)
            return
        }
        bootKind = "home"
        let t0 = Date().timeIntervalSince1970
        openRoot(["screen": "home", "entryId": "boot", "params": [String: Any](), "via": "boot", "payload": HomeScreen.bootPayload()]) {}
        ShiziProbe.log(String(format: "native stage: boot segs launch→bootFrame %.1f, openRoot %.1f", (t0 - (Self.launchedAt ?? t0)) * 1000, (Date().timeIntervalSince1970 - t0) * 1000))
        let link = CADisplayLink(target: BootFrameProbe.shared, selector: #selector(BootFrameProbe.tick(_:)))
        BootFrameProbe.shared.link = link
        link.add(to: .main, forMode: .common)
    }

    /// 进程创建时刻（Unix 秒；sysctl kinfo_proc）。
    static func processStart() -> TimeInterval? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
        let t = info.kp_proc.p_un.__p_starttime
        return TimeInterval(t.tv_sec) + TimeInterval(t.tv_usec) / 1_000_000
    }

    /// 首页首帧之后要做的事（没有首帧量测时：下一轮主线程）。
    func afterBootFrame(_ fn: @escaping () -> Void) {
        if BootFrameProbe.shared.link == nil { DispatchQueue.main.async(execute: fn) } else { BootFrameProbe.shared.after.append(fn) }
    }

    /// didFinishLaunching 的时刻（AppDelegate 记）。
    static var launchedAt: TimeInterval?
    /// didFinishLaunching → 首页首帧（ms；与网页版「网页段 index → FCP」同为进程起来之后 App 自己的那一段）。
    private(set) static var bootFromLaunchMs: Double?

    fileprivate static func recordBootFrame() {
        guard bootFrameMs == nil, let start = processStart() else { return }
        let now = Date().timeIntervalSince1970
        bootFrameMs = (now - start) * 1000
        bootFromLaunchMs = launchedAt.map { (now - $0) * 1000 }
        ShiziProbe.note(String(format: "boot:home %.0f launch:%.0f", bootFrameMs ?? 0, bootFromLaunchMs ?? -1))
        ShiziProbe.log(String(format: "native stage: cold start → first home frame %.1f ms (didFinishLaunching → frame %.1f ms)", bootFrameMs ?? 0, bootFromLaunchMs ?? -1))
    }

    /// 栈重建好之后再做（提醒深链：先让冷启动判定看到它，再派发）。
    func whenPlanned(_ fn: @escaping () -> Void) {
        if planned { fn() } else { afterPlan.append(fn) }
    }

    // MARK: 坏值提示浮条（B3.13；L4 顶部浮条，网页那边只发显示 / 收起）

    /// 坏值提示浮条（原生层上的一个视图；挂在当前原生根页上——根页在网页之上，浮条又在根页之上；没有根页时挂宿主视图）。
    private var corruptNoticeView: ShiziCorruptNoticeView?

    private func setCorruptNotice(_ body: [String: Any], done: @escaping () -> Void) {
        let show = (body["show"] as? Bool) == true
        guard show else {
            corruptNoticeView?.removeFromSuperview()
            corruptNoticeView = nil
            done()
            return
        }
        // 挂在原生根页上（根页 = 原生 tab 根页；它在网页之上）：没有根页时挂宿主视图。
        let container: UIView = rootScreen?.view ?? host.view
        if corruptNoticeView == nil {
            let v = ShiziCorruptNoticeView(frame: .zero)
            v.onClose = { [weak self] in
                self?.corruptNoticeView?.removeFromSuperview()
                self?.corruptNoticeView = nil
            }
            corruptNoticeView = v
            container.addSubview(v)
        } else if corruptNoticeView?.superview !== container {
            corruptNoticeView?.removeFromSuperview()
            corruptNoticeView.map { container.addSubview($0) }
        }
        let m = ShiziMetrics()
        let starts = (body["lines"] as? [NSNumber])?.map { $0.intValue }
        corruptNoticeView?.configure(text: ShiziCopy.t("X-SYS.corruptNotice"), lines: starts, metrics: m)
        corruptNoticeView?.layout(in: container.bounds.width, safeTop: container.safeAreaInsets.top, metrics: m)
        if let v = corruptNoticeView { container.bringSubviewToFront(v) }
        ShiziProbe.note("corrupt:notice")
        done()
    }

    // MARK: 量测

    static func recordLatency(_ ms: Double) {
        latencies.append(ms)
        if latencies.count > 64 { latencies.removeFirst(latencies.count - 64) }
        ShiziProbe.log(String(format: "native stage: tap → first frame %.1f ms", ms))
    }

    // MARK: 页面重载

    func pageWillReload() {
        #if DEBUG
        ShadowEngine.shared?.pageReloaded()
        #endif
        engine.pageWillReload()
    }

    func pageDidBecomeReady() {
        engine.pageDidBecomeReady()
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
        bridge.callNav("fence") { [weak self, weak page] _ in
            guard let page, page.presentingViewController != nil else { return }
            // B3.7：让开的目标已经是原生页（字详情）并盖在这一页上面：这一页留在下面（不收起——收起会把盖在它上面的原生页一起带走），
            // 返回时那页收起、网页出栈，宿主再发 open via 'return'，这一页同一个对象认领（resync）
            if let self, let above = self.screens.first(where: { !$0.exitHandled && $0.presentingViewController === page }) {
                _ = above
                (page as? NativeWriteViewController)?.exitHandled = false
                (page as? NativeResultViewController)?.exitHandled = false
                ShiziProbe.note("yield:under-native")
                return
            }
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
        // R16：收起 vc 连同它上面呈现的整条链——由呈现它的那一层发 dismiss。直接对 vc 发 dismiss，vc 上面还有呈现的页时 UIKit 只收起最上面那条
        // （B3.8 后字库清单 → 字详情 →「练这个字」：清单留在宿主上，新写字页呈现不上去，test105）。
        let dismissChain: () -> Void = {
            if let presenter = vc.presentingViewController { presenter.dismiss(animated: false, completion: then) } else { then?() }
        }
        if vc.isBeingPresented || vc.isBeingDismissed, let tc = vc.transitionCoordinator {
            tc.animate(alongsideTransition: nil) { _ in dismissChain() }
            return
        }
        dismissChain()
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

    // MARK: 页面重载（B3.F：栈在原生，重载不再「等宿主认领」）

    /// 页面重新加载（WebContent 进程被回收 / 新文档）：原生页留在屏上（本地笔画在内存里），引擎状态 reloading（按钮暂不可点）。
    func nativePageWillReload() {
        pageWillReload()
    }

    /// 页面就绪：冷启动 → route.plan 重建栈；重载 → stage.resync（引擎镜像按原生的栈对齐），原生页按 status 回到 ready 后各自重拉视图。
    func nativePageDidBecomeReady() {
        pageDidBecomeReady()
        engineReady()
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

    /// R9-B / B2.8：改判弹层「看这个字 ›」（D66 ⑮）：写字条目留在栈里，字详情（原生屏）推入在它上面（B3.F：没有网页层了，不再先截图交给宿主层）。
    /// 页面换好页后这一页留在下面（字详情盖着它）；详情返回时引擎请原生 open via 'return'，这一页同一个对象认领。
    func nativeWriteOpenDetail(_ vc: NativeWriteViewController, char: String) {
        guard !vc.exitHandled else { return }
        vc.exitHandled = true // 交给页面导航中（失败时放回）
        vc.transitions.finishNow()
        openDetailAfterCover(vc, char: char, bridge: NativeWriteBridge(webView: host.webView))
    }

    private func openDetailAfterCover(_ vc: NativeWriteViewController, char: String, bridge: NativeWriteBridge) {
        let slot = vc.slot
        bridge.call("exit", ["slot": slot, "to": "detail", "char": char]) { [weak self, weak vc] reply in
            guard let self, let vc else { return }
            guard reply.ok else {
                vc.exitHandled = false
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
    /// 原生页恒开（B3.F：去掉了 B2 起的 -shizi-native-write / -shizi-native-write-off 开关与 UserDefaults 记忆——网页界面在 App 里不再挂载）。
    static var nativeWriteEnabled: Bool { true }

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
        guard Self.nativeWriteEnabled || body["op"] as? String == "appearance" else { return }
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

// MARK: - Tab 栏（B3.5d）

/// 原生 Tab 栏的宿主视图（NativeStage.tabHost）：根页让开 / 没有根页时整个藏起；宿主上呈现着任何模态层时对读屏藏起（R16 同一条规则，同 ShiziWebView）。
final class ShiziTabHostView: UIView {
    var hiddenFromAccessibility: () -> Bool = { false }

    override var accessibilityElementsHidden: Bool {
        get { super.accessibilityElementsHidden || hiddenFromAccessibility() }
        set { super.accessibilityElementsHidden = newValue }
    }
}

/// 一个 tab 的占位控制器：此刻的原生根页是它的子控制器（只有选中格里有根页）。
final class ShiziTabSlot: UIViewController {
    let screen: String

    init(screen: String) {
        self.screen = screen
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() {
        let v = UIView()
        v.backgroundColor = .clear
        view = v
    }
}

/// 系统 Tab 栏（D73 ③：UITabBarController，iOS 26 浮起玻璃样式，颜色取令牌）。三个 tab 的顺序、文案、图标同网页 Tabs（registerScreen order、
/// X-TABS.*、tab-icons.js 线描 / 实心）；标签 11 / 500 固定不随字号放大（D49，AX 档长按出系统大字预览）；选中 ink1、未选 ink3。
/// 选中格只由 NativeStage 按网页路由设（select）；点按一律不直接切换（shouldSelect 返回 false），交给 onSelect / onReselect。
final class ShiziTabController: UITabBarController, UITabBarControllerDelegate {
    /// tab 屏名（顺序 = 网页 registerScreen 的 order）与文案键。
    static let tabs: [(screen: String, copy: String)] = [("home", "X-TABS.write"), ("library", "X-TABS.library"), ("mine", "X-TABS.mine")]

    var onSelect: ((String) -> Void)?
    var onReselect: ((String) -> Void)?
    var onLayout: (() -> Void)?

    var slots: [ShiziTabSlot] { (viewControllers ?? []).compactMap { $0 as? ShiziTabSlot } }
    var selectedScreen: String? { (selectedViewController as? ShiziTabSlot)?.screen }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        // 纸色底（同 WKWebView 的 Paper 颜色集）：根页视图有的透明（我的），截图交给网页时不露黑底
        view.backgroundColor = UIColor(named: "Paper") ?? ShiziTokens.dynamicColor("paper")
        definesPresentationContext = false
        let slots = Self.tabs.map { tab -> ShiziTabSlot in
            let slot = ShiziTabSlot(screen: tab.screen)
            let item = UITabBarItem(title: ShiziCopy.t(tab.copy), image: ShiziTabIcon.image(tab.screen, solid: false), selectedImage: ShiziTabIcon.image(tab.screen, solid: true))
            item.accessibilityIdentifier = "native-tab-\(tab.screen)"
            slot.tabBarItem = item
            return slot
        }
        setViewControllers(slots, animated: false)
        applyLook()
        if #available(iOS 26.0, *) { tabBarMinimizeBehavior = .never }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        onLayout?()
    }

    /// 颜色取令牌（随浅 / 深自动切换；「我的 › 外观」强制浅 / 深时跟窗口走）；字 11 / 500 固定。
    private func applyLook() {
        let ink1 = ShiziTokens.dynamicColor("ink1") ?? .label
        let ink3 = ShiziTokens.dynamicColor("ink3") ?? .secondaryLabel
        let font = Self.labelFont
        let ap = UITabBarAppearance()
        ap.configureWithDefaultBackground()
        for layout in [ap.stackedLayoutAppearance, ap.inlineLayoutAppearance, ap.compactInlineLayoutAppearance] {
            layout.normal.iconColor = ink3
            layout.normal.titleTextAttributes = [.foregroundColor: ink3, .font: font]
            layout.selected.iconColor = ink1
            layout.selected.titleTextAttributes = [.foregroundColor: ink1, .font: font]
        }
        tabBar.standardAppearance = ap
        tabBar.scrollEdgeAppearance = ap
        tabBar.tintColor = ink1
        tabBar.unselectedItemTintColor = ink3
    }

    /// 标签字（网页 .sz-tabs__tab：11px、500，不读 --k）。
    static let labelFont = UIFont.systemFont(ofSize: 11, weight: .medium)

    /// 选中 screen 那一格（无动画）；返回那一格（不是 tab 屏 = nil）。
    @discardableResult
    func select(_ screen: String) -> ShiziTabSlot? {
        guard let i = slots.firstIndex(where: { $0.screen == screen }) else { return nil }
        if selectedIndex != i { UIView.performWithoutAnimation { selectedIndex = i } }
        return slots[i]
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        guard let slot = viewController as? ShiziTabSlot else { return false }
        if slot === selectedViewController { onReselect?(slot.screen) } else { onSelect?(slot.screen) }
        return false
    }
}

/// Tab 栏图标（网页 components/tab-icons.js 的同一组 24 × 24 路径：未选线描、选中实心；描边 1.5）。模板图，颜色由 Tab 栏的 tint 定。
enum ShiziTabIcon {
    static func image(_ screen: String, solid: Bool) -> UIImage? {
        let r = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24))
        let img = r.image { ctx in
            let cg = ctx.cgContext
            UIColor.black.setStroke()
            UIColor.black.setFill()
            switch screen {
            case "home":
                let p = UIBezierPath()
                p.move(to: CGPoint(x: 4, y: 10.5)); p.addLine(to: CGPoint(x: 12, y: 4)); p.addLine(to: CGPoint(x: 20, y: 10.5)); p.addLine(to: CGPoint(x: 20, y: 20))
                p.addLine(to: CGPoint(x: 14.5, y: 20)); p.addLine(to: CGPoint(x: 14.5, y: 14.5)); p.addLine(to: CGPoint(x: 9.5, y: 14.5)); p.addLine(to: CGPoint(x: 9.5, y: 20))
                p.addLine(to: CGPoint(x: 4, y: 20)); p.close()
                p.lineWidth = 1.5; p.lineJoinStyle = .round
                if solid { p.fill() }
                p.stroke()
            case "library":
                let p = UIBezierPath()
                p.move(to: CGPoint(x: 12, y: 6.5))
                p.addCurve(to: CGPoint(x: 4, y: 5), controlPoint1: CGPoint(x: 10, y: 5), controlPoint2: CGPoint(x: 7, y: 4.5))
                p.addLine(to: CGPoint(x: 4, y: 18))
                p.addCurve(to: CGPoint(x: 12, y: 19.5), controlPoint1: CGPoint(x: 7, y: 17.5), controlPoint2: CGPoint(x: 10, y: 18))
                p.addCurve(to: CGPoint(x: 20, y: 18), controlPoint1: CGPoint(x: 14, y: 18), controlPoint2: CGPoint(x: 17, y: 17.5))
                p.addLine(to: CGPoint(x: 20, y: 5))
                p.addCurve(to: CGPoint(x: 12, y: 6.5), controlPoint1: CGPoint(x: 17, y: 4.5), controlPoint2: CGPoint(x: 14, y: 5))
                p.close()
                p.lineWidth = 1.5; p.lineJoinStyle = .round
                if solid {
                    p.fill()
                    p.stroke()
                    // 实心版书脊是纸色的一道（网页 stroke var(--paper)）：模板图里挖空
                    let spine = UIBezierPath()
                    spine.move(to: CGPoint(x: 12, y: 7)); spine.addLine(to: CGPoint(x: 12, y: 19))
                    spine.lineWidth = 1.5
                    cg.setBlendMode(.clear)
                    spine.stroke()
                    cg.setBlendMode(.normal)
                } else {
                    p.stroke()
                    let spine = UIBezierPath()
                    spine.move(to: CGPoint(x: 12, y: 6.5)); spine.addLine(to: CGPoint(x: 12, y: 19.5))
                    spine.lineWidth = 1.5; spine.lineJoinStyle = .round
                    spine.stroke()
                }
            default: // mine
                let head = UIBezierPath(arcCenter: CGPoint(x: 12, y: 8.5), radius: 3.8, startAngle: 0, endAngle: .pi * 2, clockwise: true)
                head.lineWidth = 1.5
                if solid { head.fill() } else { head.stroke() }
                let body = UIBezierPath()
                body.move(to: CGPoint(x: 4.5, y: 20))
                body.addCurve(to: CGPoint(x: 12, y: 14), controlPoint1: CGPoint(x: 5.3, y: 16), controlPoint2: CGPoint(x: 8.3, y: 14))
                body.addCurve(to: CGPoint(x: 19.5, y: 20), controlPoint1: CGPoint(x: 15.7, y: 14), controlPoint2: CGPoint(x: 18.7, y: 16))
                body.lineWidth = 1.5
                if solid {
                    body.close()
                    body.lineJoinStyle = .round
                    body.fill()
                } else {
                    body.lineCapStyle = .round
                }
                body.stroke()
            }
        }
        return img.withRenderingMode(.alwaysTemplate)
    }
}

/// 启动首帧量测：首页静态版放进窗口后的第一次屏幕刷新（CADisplayLink 回调 = 这一帧已提交）。
final class BootFrameProbe: NSObject {
    static let shared = BootFrameProbe()
    var link: CADisplayLink?

    var after: [() -> Void] = []

    @objc func tick(_ l: CADisplayLink) {
        l.invalidate()
        link = nil
        NativeStage.recordBootFrame()
        let later = after
        after.removeAll()
        later.forEach { $0() }
    }
}
