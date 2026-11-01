import ShiziCore
import ShiziImageRendering
import QuartzCore
import UIKit
import WebKit

// B4.5c / B4.8 / B4.9a：SwiftEngine（缺省；计划 B3B4-原生化架构与计划.md §3.4、§4.2、§10.x B4.9a）。
//
// 与 WebEngine 同一个协议（ShiziEngine / StageEngine），页面一行不改。Store 接 App 的同一个 SQLite 库（同一条连接，同表同键同值形状，不迁移）。
// B4.9a 起缺省模式里没有 op 交给 WKWebView：
//   · 页面 API / 写字会话的全部 op 由 Swift 答（EngineOps.swiftAnswers；只剩显式 webRenderer 或原生渲染失败的 image.render / save 交页面，B4.6 的回退）；
//   · 栈往来（route.* / stage.* / deeplink.reminder / shiziNativeNav）由 SwiftNavigator 答（ShiziCore Navigation/，JS 参考 src/ui/engine.js）；
//   · 原来由页面订阅 store 做的事——引擎状态、阻断页、坏值提示、窗口外观、提醒同步——由这里订阅 Swift 的 store 做；
//   · 声音：判断声 j1 轮换、落印 s1 都由 Swift 的提交发（一件事一个责任方）；触觉由原生页自己发。
// WKWebView 仍在（B4.9 才删）：页面照常载入，冷启动仍等它的 pageReady 再做 route.plan（时序不变）。迁移没做完时这一次启动整个用 WebEngine（EngineMode.swift）。
// 缺省模式里页面发来的引擎类消息只认 changed（测试 / QA 往页面里造数据后 Swift 重读库，见 NativeStage.acceptsPageMessage）；
// QA / 测试宿主另有「镜像」：Swift 写了库 → 页面重读，Swift 存栈 → 页面的导航镜像对齐，测试脚本还能经页面读写（WebCalls 记作 qa，不算引擎调用）。
final class SwiftEngine: StageEngine {
    private let web: WebEngine
    let core: SwiftEngineCore
    let nav: SwiftNavigator
    let reminder: ReminderController
    private weak var stage: NativeStage?
    private let backend: ReloadableBackend
    private var subscribers: [UUID: AsyncStream<ShiziChangeSet>.Continuation] = [:]
    private var statusObservers: [UUID: (ShiziEngineStatus) -> Void] = [:]
    private var feedOff: (() -> Void)?
    private var reloading = false
    /// 发出去还没收到回声的 shiziEngineSync 次数（QA 镜像；回声 = 全部域、label 为空的 changed）。
    private var pendingSyncs = 0
    private var commits = 0
    /// 发出的 op 序号（route 是同步进来的：发出顺序）。
    private var issued = 0
    /// 冷启动的 route.plan 答过了（之前引擎状态 reloading：启动首帧的主按钮就绪前不可点，与原来等页面一致）。
    private(set) var planned = false
    private var lastStatus: ShiziEngineStatus = .reloading
    /// 判断声 / 落印声的播放（WebViewController 的同一组预载 CAF）。
    var playSound: ((String, Double) -> Void)?
    #if DEBUG
    /// 测试钩子在页面里挂了写入注入（failNextWrite / interruptAfterWrite，D07 三段式的测试）：下一次 Swift 要写的 op 之前取走挂到 Swift 的 storage。
    var faultsArmed = false
    /// 测试直接挂到 Swift 的写入注入（qaFailNextWrite）：只给挂上之后才发出的 op——之前已经发出、还没轮到的那一个不算
    /// （WebEngine 时页面调用队列先进先出，就是这个顺序；页面消息 qa-faults 到得晚，排不出这个顺序）。
    private var pendingFaults: (count: Double, kind: String, after: Int)?

    /// ShiziWriteTests：下一次写入失败（D07），按发出顺序挂在之后的第一个写 op 上。
    func qaFailNextWrite(_ count: Double = 1, kind: String = "generic") {
        pendingFaults = (count, kind, issued)
    }
    /// 只读的 op（不取走注入，留给后面真正写的那一次）。
    static let readOnly: Set<String> = ["write.copy", "write.refLabel", "image.spec", "reminder.plan", "backup.export", "backup.undoState", "backup.restorePreview"]
    /// QA / 测试宿主的页面镜像（见文件头）。零调用检查（ShiziWriteTests testB49a）关掉它。
    static var qaMirror: Bool = WebViewController.nativeTestHostEnabled || WebViewController.qaEnabled
    #endif

    init(webView: WKWebView?) {
        web = WebEngine(webView: webView)
        web.swiftOwned = true
        backend = ReloadableBackend(transport: BridgeTransport())
        core = SwiftEngineCore(backend: backend, clock: SwiftEngine.clock, measure: NativeLineMeasure())
        nav = SwiftNavigator(core: core)
        reminder = ReminderController(store: core.store)
        #if DEBUG
        // -shizi-qa-storage-unavailable（测试宿主）：这次启动存储探测失败——页面那边 test-hooks 换 storage.probe，写入者 Swift 这边同一个替身
        if WebViewController.nativeTestHostEnabled, ProcessInfo.processInfo.arguments.contains("-shizi-qa-storage-unavailable") {
            core.store.storage.probeOverride = (false, "security")
        }
        #endif
        core.load()
        _ = core.store.subscribe { [weak self] _, info in
            if info["type"] == .string("commit") || info["type"] == .string("recover") || info["replace"] == .bool(true) { self?.commits += 1 }
            self?.storeChanged(info)
        }
        feedOff = core.changeFeed { [weak self] packet in self?.emit(packet) }
        core.onSound = { [weak self] name, gain in self?.playSound?(name, gain) }
        core.host.navigator = nav
        nav.onCommit = { [weak self] in self?.syncPage() }
        nav.onStack = { [weak self] in self?.mirrorStack() }
        nav.openReminder = { [weak self] key in _ = self?.reminder.openTarget(.string(key)) }
        installPlatform()
        EngineRoute.swift = { [weak self] function, op, args, completion in self?.route(function, op, args, completion) ?? false }
        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    deinit { feedOff?() }

    static func clock() -> Double {
        #if DEBUG
        return QAClock.nowMs()
        #else
        return Date().timeIntervalSince1970 * 1000
        #endif
    }

    /// NativeStage 建好之后接上导航者的去处。阻断页 / 坏值提示 / 外观的第一次核对在页面第一次就绪时（engine.js mountEngine 的同一时刻：
    /// 在冷启动 route.plan 之前）。
    func attach(stage: NativeStage) {
        self.stage = stage
        nav.stage = stage
    }

    /// 页面第一次就绪过（之后 store 的变化才发阻断页 / 坏值提示 / 外观）。
    private var started = false

    /// QA 镜像：页面路由发起的导航（测试脚本）原生照做之后，Swift 的镜像立刻对齐（不等存栈）。
    func adoptPageNav(_ entries: [[String: Any]], seq: Int) {
        nav.router.adopt(EngineValue.js(entries)) // 原生刚照做了页面发来的那一条：以原生的栈为准（页面的意图序号与 Swift 的不是一个数）
    }

    // MARK: 转给 WebEngine 的部分（只剩 WKWebView 引用、nav.* 的导航者与回退画图）

    var webView: WKWebView? { get { web.webView } set { web.webView = newValue } }
    var navigator: ((String, [String: Any]) -> [String: Any])? { get { web.navigator } set { web.navigator = newValue } }

    func raw(_ op: String, _ args: [String: Any], completion: @escaping ([String: Any]) -> Void) { web.raw(op, args, completion: completion) }
    @MainActor func raw(_ op: String, _ args: [String: Any]) async -> [String: Any] { await web.raw(op, args) }
    @MainActor func call<A: Encodable, R: Decodable>(_ op: String, _ args: A, as type: R.Type) async throws -> R {
        try ShiziDecode.reply(await raw(op, ShiziDecode.args(args)), as: R.self)
    }

    // MARK: 引擎状态（Swift 的 store：可用 / 阻断；冷启动的 route.plan 答过之前 reloading）

    var status: ShiziEngineStatus {
        guard planned else { return .reloading }
        let reason = BlockView.blockReasonOf(.object(core.store.status))
        return reason.isNull ? .ready : .blocked(reason["kind"]?.stringValue ?? "blocked")
    }

    @discardableResult func observeStatus(_ fn: @escaping (ShiziEngineStatus) -> Void) -> () -> Void {
        let id = UUID()
        statusObservers[id] = fn
        return { [weak self] in self?.statusObservers[id] = nil }
    }

    private func publishStatus() {
        let s = status
        guard s != lastStatus else { return }
        lastStatus = s
        for fn in statusObservers.values { fn(s) }
    }

    /// 页面推来的 status：缺省模式里引擎状态只看 Swift 的 store。
    func receiveStatus(_ body: [String: Any]) {}
    /// 页面重载（WebContent 被回收）不影响 Swift 引擎：原生页照常可点。
    func pageWillReload() {}
    func pageDidBecomeReady() {
        guard !started else { return }
        started = true
        checkBlock()
        checkCorrupt()
        applyAppearance()
    }

    // MARK: 答

    /// EngineRoute 的 swift 出口：栈往来 op 由导航者答；其余 Swift 实现了的 op 在主线程答（写字会话回包照旧带 ms）；只剩回退的画图交页面。
    /// 都排进同一条主线程任务队列（按发出顺序）。
    private func route(_ function: String, _ op: String, _ args: [String: Any], _ completion: @escaping ([String: Any], Double) -> Void) -> Bool {
        let t0 = CACurrentMediaTime()
        issued += 1
        let seq = issued
        Task { @MainActor [weak self] in
            guard let self else { return }
            let jargs = EngineValue.object(args)
            if let reply = await nav.answer(function: function, op: op, args: jargs) {
                if function == EngineOps.app, op == "route.plan" { planned = true; publishStatus(); afterPlan() }
                completion(EngineValue.dict(reply), (CACurrentMediaTime() - t0) * 1000)
                return
            }
            guard EngineOps.swiftAnswers(function: function, op: op) else {
                WebEngine.evaluate(web.webView, function: function, op: op, args: args, completion: completion)
                return
            }
            let before = commits
            #if DEBUG
            let name = EngineOps.runtimeOp(function: function, op: op)
            let writes = !name.hasPrefix("view.") && !Self.readOnly.contains(name)
            if writes, let f = pendingFaults, seq > f.after {
                pendingFaults = nil
                core.store.storage.clearFaults()
                core.store.storage.failNextWrite(f.count, kind: f.kind, matchKey: nil)
            } else if faultsArmed, writes {
                faultsArmed = false
                await takeFaults()
            }
            #endif
            let reply = await core.answer(function: function, op: op, args: jargs)
            var body = EngineValue.dict(reply)
            let wall = (CACurrentMediaTime() - t0) * 1000
            if function == EngineOps.write { body["ms"] = wall }
            if commits != before { syncPage() }
            completion(body, wall)
        }
        return true
    }

    #if DEBUG
    @MainActor private func takeFaults() async {
        let f: JSValue = await withCheckedContinuation { cont in
            WebCalls.qa {
                WebEngine.evaluate(web.webView, function: "__shiziTestTakeFaults", op: "", args: [:]) { body, _ in cont.resume(returning: EngineValue.js(body)) }
            }
        }
        let storage = core.store.storage
        storage.clearFaults()
        for rule in f["fail"]?.arrayValue ?? [] {
            storage.failNextWrite(rule["remaining"]?.numberValue ?? 0, kind: rule["kind"]?.stringValue ?? "generic", matchKey: rule["matchKey"]?.stringValue)
        }
        if let k = f["interruptAfter"]?.numberValue { storage.interruptAfterWrite(k) }
    }
    #endif

    #if DEBUG
    /// B4.9c：存储替身（test-hooks overrideStorage / 夹具 blockMode）——Swift 是写入者，替身挂到 Swift 的存储上再重读，阻断页由 checkBlock 发。
    /// body：{probe: {ok:false, kind} | null, blocked: {reason, keys} | null}（null = 还原）。
    func qaOverrideStorage(_ body: [String: Any]) {
        let storage = core.store.storage
        storage.probeOverride = (body["probe"] as? [String: Any]).map { (false, ($0["kind"] as? String) ?? "unknown") }
        storage.blockedOverride = (body["blocked"] as? [String: Any]).map { (($0["reason"] as? String) ?? "rollback-failed", ($0["keys"] as? [String]) ?? [], []) }
        reloadFromLibrary()
    }
    #endif

    /// Swift 写了库：QA 镜像里页面的 JS 镜像重读（排在调用队列里）；缺省模式什么都不做（页面不再答任何 op）。
    private func syncPage() {
        #if DEBUG
        guard Self.qaMirror else { return }
        pendingSyncs += 1
        WebCalls.qa {
            WebEngine.evaluate(web.webView, function: "shiziEngineSync", op: "", args: [:]) { [weak self] body, _ in
                if body["ok"] as? Bool != true { self?.pendingSyncs = max(0, (self?.pendingSyncs ?? 1) - 1) }
            }
        }
        #endif
    }

    /// QA 镜像：Swift 的栈一变就让页面的导航镜像对齐（测试脚本读页面路由的栈顶）。
    private func mirrorStack() {
        #if DEBUG
        guard Self.qaMirror, let stage else { return }
        let args: [String: Any] = ["stack": nav.router.stack.map { EngineValue.any(EngineRouter.plain($0)) }, "seq": stage.pageSeq]
        WebCalls.qa { WebEngine.evaluate(web.webView, function: EngineOps.app, op: "route.save", args: args) { _, _ in } }
        #endif
    }

    // MARK: 订阅

    var changes: AsyncStream<ShiziChangeSet> {
        AsyncStream { cont in
            let id = UUID()
            subscribers[id] = cont
            cont.onTermination = { [weak self] _ in DispatchQueue.main.async { self?.subscribers[id] = nil } }
        }
    }

    private func emit(_ packet: JSValue) {
        guard !reloading else { return }
        let domains = packet["domains"]?.arrayValue?.compactMap(\.stringValue) ?? []
        guard !domains.isEmpty else { return }
        let set = ShiziChangeSet(domains: domains, label: packet["label"]?.stringValue)
        for c in subscribers.values { c.yield(set) }
    }

    /// 页面推来的 changed（测试 / QA 往页面里造数据）：QA 镜像同步引起的回声丢掉；页面自己的提交 → Swift 重读库再转给页面；
    /// 离开撤销条的 ui 推送由 Swift 的宿主推（EngineHost），页面的不认。
    func receiveChanged(_ body: [String: Any]) -> ShiziChangeSet? {
        let domains = (body["domains"] as? [String]) ?? []
        guard !domains.isEmpty else { return nil }
        let label = body["label"] as? String
        if pendingSyncs > 0, label == nil, Set(domains) == Set(Schema.domains) {
            pendingSyncs -= 1
            return nil
        }
        if label == "leave-undo" { return nil }
        if domains.contains(where: { Schema.domains.contains($0) }) { reloadFromLibrary() }
        let set = ShiziChangeSet(domains: domains, label: label)
        for c in subscribers.values { c.yield(set) }
        return set
    }

    private func reloadFromLibrary() {
        reloading = true
        backend.reload()
        core.load()
        reloading = false
    }

    // MARK: 原来由页面订阅 store 做的事（engine.js watchBlock / watchCorrupt、native-stage.js postStatus、appearance.js、reminder.js）

    private func storeChanged(_ info: JSObject) {
        let type = info["type"]?.stringValue ?? ""
        if type == "status" || type == "load" { publishStatus() }
        checkBlock()
        checkCorrupt()
        applyAppearance()
        // reminder.js affectsReminder 的超集：同步只在算出的内容变了时才发（ReminderController.sync 比上次发出的）
        if type == "load" || type == "commit" || type == "recover" || info["replace"] == .bool(true) { reminder.scheduleSync() }
    }

    /// 阻断页（engine.js watchBlock）：不可用 / 阻断时发原生阻断页的 open，好了收起；同一种（kind|能否导出）不重发。
    private var blockKey: String?
    private var blockId: String?
    private func checkBlock() {
        guard started, stage != nil else { return }
        let reason = BlockView.blockReasonOf(.object(core.store.status))
        let kind = reason["kind"]?.stringValue
        let canExport = kind == "blocked" && core.store.available && BlockView.hasJudged(.object(core.store.state))
        let key = kind.map { "\($0)|\(canExport)" }
        guard key != blockKey else { return }
        if let id = blockId { nav.post(JSObject([("op", .string("close")), ("entryId", .string(id))])) }
        blockKey = key
        blockId = kind.map { "block-\($0)" }
        guard let kind, let id = blockId else { return }
        let params = JSObject([("kind", .string(kind)), ("canExport", .bool(canExport))])
        let view = (try? BlockView.blockView(params)) ?? .null
        nav.post(JSObject([("op", .string("open")), ("screen", .string("block")), ("entryId", .string(id)), ("params", .object(params)),
                           ("via", .string("restore")), ("run", .array([])), ("payload", .object(JSObject([("ok", .bool(true)), ("view", view)])))]))
    }

    /// 坏值提示（engine.js watchCorrupt）：本次启动隔离了坏值 → 认领（ack）后发一次浮条。
    private func checkCorrupt() {
        guard started, stage != nil, let notice = core.store.corruptNotice else { return }
        core.store.ackCorruptNotice()
        let text = (try? Copy.text("X-SYS.corruptNotice")) ?? ""
        nav.post(JSObject([("op", .string("corrupt")), ("show", .bool(true)), ("keys", notice["keys"] ?? .array([])),
                           ("lines", core.host.measure.lineStarts("corrupt-text", text))]))
    }

    /// 窗口外观（platform/appearance.js startAppearance：store 的显示偏好 → 壳的唯一应用点 ShiziTheme）。
    private var appearance: String?
    private func applyAppearance() {
        guard started, let stage else { return }
        let raw = core.store.state["settings"]?["appearance"]?.stringValue ?? "auto"
        let allowed = Config.policy["features"]?["appearanceSwitch"] != .bool(false)
        let theme = allowed && ["auto", "light", "dark"].contains(raw) ? raw : "auto"
        guard theme != appearance else { return }
        appearance = theme
        ShiziTheme.apply(theme, window: stage.host.view.window)
    }

    // MARK: 平台（提醒、存相册、选字条小图）

    private func installPlatform() {
        reminder.isNative = { true }
        reminder.post = { [weak self] type, payload in
            guard let host = self?.stage?.host else { return false }
            switch type {
            case "syncReminder": host.syncReminder(body: EngineValue.any(payload) as? [String: Any] ?? [:])
            case "queryReminderStatus": host.sendReminderStatus()
            default: return false
            }
            return true
        }
        reminder.startPicked = { [weak self] keys, opts in (try? self?.core.host.startPicked(keys, source: opts["source"] ?? .null)) ?? .null }
        reminder.applyStatus = { store, payload in SettingsView.applyReminderStatus(store, payload: payload) }
        reminder.schedule = { ms, fn in
            let work = DispatchWorkItem(block: fn)
            DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: work)
            return { work.cancel() }
        }
        // 首练结果页的提醒邀请（reminder.js inviteReminder / inviteChangeTime：一次 settings 提交 → 要权限 → 同步）
        let deps = core.host.deps
        deps.reminderInvite = { [weak self] store, a in
            await MainActor.run {
                ReminderInviteHost.invite(store, hour: a["hour"] ?? .null, minute: a["minute"] ?? .null,
                                          request: { remind in self?.requestPermission(remind) ?? false },
                                          sync: { remind in _ = self?.reminder.sync(remind: remind, force: true) })
            }
        }
        deps.reminderChangeTime = { [weak self] store, a in
            await MainActor.run {
                ReminderInviteHost.changeTime(store, hour: a["hour"] ?? .null, minute: a["minute"] ?? .null, sync: { remind in _ = self?.reminder.sync(remind: remind, force: true) })
            }
        }
        // 存相册（image-preview.js saveImageFile 的原生分支：savePracticeCard → 成功与否；等 120s，与页面同）
        core.host.images.saveFile = { [weak self] file in
            await withCheckedContinuation { cont in
                DispatchQueue.main.async {
                    guard let host = self?.stage?.host else { cont.resume(returning: EngineValue.obj([("via", .string("native")), ("ok", .bool(false))])); return }
                    host.saveCard(dataURL: file["dataURL"]?.stringValue ?? "", timeout: 120) { ok in
                        cont.resume(returning: EngineValue.obj([("via", .string("native")), ("ok", .bool(ok))]))
                    }
                }
            }
        }
        // 选字条小图（images-entry.js chipThumb：32pt 格、--hand、透明底）
        core.host.images.thumb = { [weak self] e in
            guard let self, let record = e["record"], !record.isNull else { return .string("") }
            return .string(self.chipThumb(record))
        }
    }

    private var thumbRenderer: ImageRenderer?
    private func chipThumb(_ record: JSValue) -> String {
        guard let points = EngineValue.any(core.host.images.inkPoints(record)) as? [[[String: Any]]], let assets = EngineHost.webRoot else { return "" }
        if thumbRenderer == nil { thumbRenderer = ImageRenderer(assets: assets) }
        let style = stage?.host.view.window?.traitCollection.userInterfaceStyle ?? UITraitCollection.current.userInterfaceStyle
        let hand = ShiziTokens.colorStrings(style == .dark ? .dark : .light)["hand"] ?? ""
        guard let png = (try? thumbRenderer?.chipThumb(points: points, hand: hand)) ?? nil else { return "" }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    /// prefs.js requestReminderPermission：已授权不再要；否则向原生要（回 true = 真的发出了请求）。
    private func requestPermission(_ remind: JSValue) -> Bool {
        if remind["permission"] == .string("granted") { return false }
        guard let host = stage?.host else { return false }
        host.requestReminderPermission()
        return true
    }

    /// 原生查到的通知权限（原来交页面 shiziReminderStatus）。
    func receiveReminderStatus(_ permission: String) {
        _ = reminder.receiveStatus(.object(JSObject([("permission", .string(permission))])))
    }

    /// 冷启动的栈重建好了：提醒开着就查权限并同步一次（reminder.js startReminder）。
    private func afterPlan() {
        reminder.markReady()
        refreshReminder()
    }

    @objc private func willEnterForeground() { if planned { refreshReminder() } }

    private func refreshReminder() {
        guard Reminder.remindOf(core.store.state["settings"])["enabled"] == .bool(true) else { return }
        _ = reminder.queryStatus()
        _ = reminder.sync()
    }
}

/// 还交给 WKWebView 的调用计数（B4.9a：缺省模式应为 0；DEBUG 的 QA 探针 stage.webCalls 读）。
/// engine = 页面答的调用（op / 回退画图 / AX 量值）；qa = 测试设施（QA 镜像、写入注入），不算引擎调用。
enum WebCalls {
    private(set) static var engine = 0
    private(set) static var qa = 0
    private(set) static var byOp: [String: Int] = [:]
    private static var qaDepth = 0

    static func qa(_ fn: () -> Void) {
        qaDepth += 1
        defer { qaDepth -= 1 }
        fn()
    }

    static func note(function: String, op: String) {
        if qaDepth > 0 { qa += 1; return }
        engine += 1
        byOp["\(function).\(op)", default: 0] += 1
    }

    static func reset() { engine = 0; qa = 0; byOp = [:] }

    static var probe: [String: Any] { ["engine": engine, "qa": qa, "byOp": byOp] }
}

// MARK: - 原生量测（swift 模式）：页面自己的字体与版心宽，按 ShiziPageText 的均衡折行（网页 text-wrap: pretty / balance 的同一口径）

/// 与网页 DOM 量的差别（影子模式只比形状，见 ShadowEngine）：字体是原生页实际用的苹方 / 宋体（网页同名字体的 woff2 与系统苹方在个别字宽上不同）；
/// 宽按原生页的版心（屏宽 − 2 × 页边），不含网页 fit-content / max-width 的细节；AX 档的折行因此可能与网页不同——原生页按自己的排法本来就该如此。
final class NativeLineMeasure: EngineMeasure {
    private enum Face { case hei(Int), heiMedium(Int), song(Int) }

    /// kind / variant → 页面用的字（Records / Annual / Month / DetailParts / LibrarySwitch / SessionNone / Block / CorruptNotice / Query）。
    private static let faces: [String: Face] = [
        "records-title": .song(22), "records-daylist-title": .song(22), "empty-title": .song(22),
        "records-legend": .hei(15), "records-axrow": .hei(15), "annual-first-date": .hei(15), "detail-next": .hei(15),
        "empty-body": .hei(15), "block-line": .hei(15), "s02-body": .hei(15), "card-action": .hei(15),
        "records-paperday": .hei(13), "records-sheet-note": .hei(13), "month-sub": .hei(13), "library-switch-source": .hei(13), "corrupt-text": .hei(13),
        "annual-head": .hei(17),
    ]

    func lineStarts(_ kind: String, _ text: String) -> JSValue {
        guard !text.isEmpty, let face = Self.faces[kind] else { return .null }
        let mt = ShiziMetrics()
        let body = UIScreen.main.bounds.width - 2 * mt.gutter
        let width: CGFloat
        switch kind {
        case "annual-head": width = body + 8
        case "annual-first-date": width = body + 8 - 132 - 20
        default: width = body
        }
        guard width > 0 else { return .null }
        let a: NSAttributedString
        switch face {
        case .hei(let n): a = ShiziPageText.mixed(text, size: mt.value("fs\(n)"), color: .label)
        case .heiMedium(let n): a = ShiziPageText.mixed(text, size: mt.value("fs\(n)"), weight: .medium, color: .label)
        case .song(let n): a = ShiziPageText.song(text, size: mt.value("fs\(n)"), weight: .medium, color: .label)
        }
        let chars = Array(text)
        let lines = ShiziPageText.wrappedLines(a, chars, width: width)
        // 每一行从第几个字开始（JS Array.from 的码点计；第一行不在数组里）
        var starts: [JSValue] = []
        var scalar = 0, index = 0
        for r in lines {
            while index < r.lowerBound { scalar += chars[index].unicodeScalars.count; index += 1 }
            if r.lowerBound > 0 { starts.append(.number(Double(scalar))) }
        }
        return .array(starts)
    }

    func measure(_ spec: JSValue) -> JSValue {
        guard let text = spec["text"]?.stringValue, let variant = spec["variant"]?.stringValue else { return .null }
        return lineStarts(variant, text)
    }

    /// 渲染器给的值：缩略图 ""（选字条小图由 SwiftEngine 原生画）；全部字 / 清单的版式量测 null（原生页按自己的版式量）；
    /// 写字页 / 结果页的令牌包：颜色 {}（ShiziLook 按主题取生成值）、主题 = 窗口此刻的外观、字阶 = AX 档位与逐元素量值（见 type()）。
    func host(_ name: String) -> JSValue {
        switch name {
        case "thumb": return .string("")
        case "metrics": return .null
        case "theme": return Self.theme()
        case "type": return Self.type()
        default: return .object(JSObject())
        }
    }

    /// native-session.js themeOf：页面 color-scheme 的计算值（「我的 › 外观」强制的浅 / 深或跟系统）= 窗口此刻的外观。
    static func theme() -> JSValue {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        let style = (windows.first(where: \.isKeyWindow) ?? windows.first)?.traitCollection.userInterfaceStyle ?? UITraitCollection.current.userInterfaceStyle
        return .string(style == .dark ? "dark" : "light")
    }

    /// native-session.js typeBundle 里页面才有的那一半：px 值由 ShiziLook 按系统字号档生成；AX 档位照给，逐元素版式是原生常量
    /// （D81 ①：ShiziLook 按 NativeAXLayout 填，不再向页面量网页 CSS），这里给空。
    static func type() -> JSValue {
        .object(JSObject([("ax", .number(Double(SwiftNavigator.axLevel()))), ("roles", .object(JSObject()))]))
    }
}
