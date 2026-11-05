import ShiziCore
import ShiziImageRendering
import QuartzCore
import UIKit

// SwiftEngine（B4.5c 建，B4.8 设为缺省，B4.9 起是唯一的引擎；计划 B3B4-原生化架构与计划.md §3.4、§4.2、§10.x B4.9）。
//
// 原生页只认 ShiziEngine 协议（ShiziKit/ShiziEngine.swift）；Store 接 App 的 SQLite 库（AppDatabase，一条连接）。全部 op 在这里答：
//   · 栈往来（route.* / stage.* / deeplink.reminder / shiziNativeNav）由 SwiftNavigator 答（ShiziCore Navigation/，原 JS 参考实现）；
//   · 画图 image.render / image.save 由原生渲染器答（ShiziImageRendering，B4.6）；
//   · 其余页面 API / 写字会话由 SessionRuntime 答。
// 订阅 Swift 的 store 做的事：引擎状态、阻断页、坏值提示、窗口外观、提醒同步 / 要权限 / 查权限、首练邀请、存相册、选字条小图、分享失败提示条。
// 声音：判断声 j1 轮换、落印 s1 由 Swift 的提交发（一件事一个责任方，SoundPlayer 播）；触觉由原生页自己发。
// B4.9：WKWebView 与 JS 已从 App 删除——没有 WebEngine 回退、没有 -shizi-engine 开关、没有影子比对、没有 localStorage 迁移保护（D81 ②）。
final class SwiftEngine: ShiziEngine {
    let core: SwiftEngineCore
    let nav: SwiftNavigator
    let reminder: ReminderController
    private weak var stage: NativeStage?
    private let backend: ReloadableBackend
    private var subscribers: [UUID: AsyncStream<ShiziChangeSet>.Continuation] = [:]
    private var statusObservers: [UUID: (ShiziEngineStatus) -> Void] = [:]
    private var feedOff: (() -> Void)?
    private var reloading = false
    /// 发出的 op 序号（route 是同步进来的：发出顺序）。
    private var issued = 0
    /// 冷启动的 route.plan 答过了（之前引擎状态 reloading：启动首帧的主按钮就绪前不可点）。
    private(set) var planned = false
    private var lastStatus: ShiziEngineStatus = .reloading
    /// B3.F：导航 op（nav.push / replace / back / tab / setParams）不进引擎——原生持有页面栈，由导航者（NativeStage）直接做。
    var navigator: ((String, [String: Any]) -> [String: Any])?
    #if DEBUG
    /// 测试直接挂到 Swift 的写入注入（qaFailNextWrite）：只给挂上之后才发出的 op——之前已经发出、还没轮到的那一个不算。
    private var pendingFaults: (count: Double, kind: String, after: Int)?

    /// ShiziWriteTests / QA 夹具（failNext）：下一次写入失败（D07），按发出顺序挂在之后的第一个写 op 上。
    func qaFailNextWrite(_ count: Double = 1, kind: String = "generic") {
        pendingFaults = (count, kind, issued)
    }
    /// 只读的 op（不取走注入，留给后面真正写的那一次）。
    static let readOnly: Set<String> = ["write.copy", "write.refLabel", "image.spec", "reminder.plan", "backup.export", "backup.undoState", "backup.restorePreview"]
    /// QA：迁移失败的阻断页（夹具 blockMode migration；D81 ② 起正式包没有迁移路径，这一种阻断页只能由夹具造出来）。
    var qaMigrationFailure: JSValue?
    /// QA：系统通知权限的回包钉成这个值（夹具 systemPermission，R16）。
    var qaPermission: String?
    #endif

    init() {
        backend = ReloadableBackend(transport: DatabaseTransport())
        core = SwiftEngineCore(backend: backend, clock: SwiftEngine.clock, measure: NativeLineMeasure())
        nav = SwiftNavigator(core: core)
        reminder = ReminderController(store: core.store)
        #if DEBUG
        // -shizi-qa-storage-unavailable（测试宿主）：这次启动存储探测失败（冷启动「阻断优先」的流程测试）
        if RootViewController.nativeTestHostEnabled, ProcessInfo.processInfo.arguments.contains("-shizi-qa-storage-unavailable") {
            core.store.storage.probeOverride = (false, "security")
        }
        #endif
        core.load()
        _ = core.store.subscribe { [weak self] _, info in self?.storeChanged(info) }
        feedOff = core.changeFeed { [weak self] packet in self?.emit(packet) }
        core.onSound = { name, gain in SoundPlayer.shared.play(kind: name, gain: gain) }
        core.host.navigator = nav
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

    /// NativeStage 建好之后接上导航者的去处。
    func attach(stage: NativeStage) {
        self.stage = stage
        nav.stage = stage
    }

    /// 启动核对过一次（之后 store 的变化才发阻断页 / 坏值提示 / 外观）。
    private var started = false

    /// 冷启动判定之前（mountEngine 的同一时刻）：阻断页 / 坏值提示 / 外观第一次核对。
    func start() {
        guard !started else { return }
        started = true
        checkBlock()
        checkCorrupt()
        applyAppearance()
    }

    /// 阻断页「再试一次」的重新启动（JS 参考整页 location.reload()）：存储从头探测、修复、读库；还阻断就留在阻断页，不阻断了阻断页收起（checkBlock）。
    func relaunch() {
        core.store.storage.resetForRelaunch()
        reloadFromLibrary()
        announceAllDomains() // 新页面的 store 从头读：原生页按全部域重拉
    }

    // MARK: 调用（App API：原生页的 raw / call）

    func raw(_ op: String, _ args: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        if op.hasPrefix("nav."), let navigator {
            DispatchQueue.main.async { completion(navigator(op, args)) }
            return
        }
        _ = route(EngineOps.app, op, args) { body, _ in completion(body) }
    }

    @MainActor func raw(_ op: String, _ args: [String: Any]) async -> [String: Any] {
        await withCheckedContinuation { cont in raw(op, args) { cont.resume(returning: $0) } }
    }

    @MainActor func call<A: Encodable, R: Decodable>(_ op: String, _ args: A, as type: R.Type) async throws -> R {
        try ShiziDecode.reply(await raw(op, ShiziDecode.args(args)), as: R.self)
    }

    // MARK: 引擎状态（Swift 的 store：可用 / 阻断；冷启动的 route.plan 答过之前 reloading）

    var status: ShiziEngineStatus {
        guard planned else { return .reloading }
        let reason = blockReason()
        return reason.isNull ? .ready : .blocked(reason["kind"]?.stringValue ?? "blocked")
    }

    private func blockReason() -> JSValue {
        #if DEBUG
        return BlockView.blockReasonOf(.object(core.store.status), migration: qaMigrationFailure)
        #else
        return BlockView.blockReasonOf(.object(core.store.status))
        #endif
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

    // MARK: 答

    /// EngineRoute 的出口：栈往来 op 由导航者答；画图由原生渲染器答；其余在主线程由 SessionRuntime 答（写字会话回包照旧带 ms）。
    /// 都排进同一条主线程任务队列（按发出顺序）。
    private func route(_ function: String, _ op: String, _ args: [String: Any], _ completion: @escaping ([String: Any], Double) -> Void) -> Bool {
        let t0 = CACurrentMediaTime()
        issued += 1
        #if DEBUG
        let seq = issued
        #endif
        Task { @MainActor [weak self] in
            guard let self else { return }
            let jargs = EngineValue.object(args)
            if let reply = await nav.answer(function: function, op: op, args: jargs) {
                if function == EngineOps.app, op == "route.plan" { planned = true; publishStatus(); afterPlan() }
                completion(EngineValue.dict(reply), (CACurrentMediaTime() - t0) * 1000)
                return
            }
            if function == EngineOps.app, EngineOps.imageOps.contains(op) {
                completion(await nativeImage(op, args), (CACurrentMediaTime() - t0) * 1000)
                return
            }
            #if DEBUG
            let name = EngineOps.runtimeOp(function: function, op: op)
            if !name.hasPrefix("view."), !Self.readOnly.contains(name), let f = pendingFaults, seq > f.after {
                pendingFaults = nil
                core.store.storage.clearFaults()
                core.store.storage.failNextWrite(f.count, kind: f.kind, matchKey: nil)
            }
            #endif
            let reply = await core.answer(function: function, op: op, args: jargs)
            var body = EngineValue.dict(reply)
            let wall = (CACurrentMediaTime() - t0) * 1000
            if function == EngineOps.write { body["ms"] = wall }
            completion(body, wall)
        }
        return true
    }

    // MARK: 画图（B4.6：原生渲染器；规格 image.spec 与存相册 image.persist 的记账由 SessionRuntime 答）

    private var imageRenderer: ImageRenderer?
    /// image.render 回包里预览直接上屏的图（display: true 时；不是 JSON 值，ShiziDecode 之前由调用方取走）。
    static let pictureKey = "picture"

    @MainActor private func nativeImage(_ op: String, _ args: [String: Any]) async -> [String: Any] {
        let failed: [String: Any] = ["ok": false, "error": ["kind": "render"]]
        guard let assets = EngineHost.webRoot else { return failed }
        if imageRenderer == nil { imageRenderer = ImageRenderer(assets: assets) }
        func spec(_ request: [String: Any]) async -> [String: Any] {
            EngineValue.dict(await core.answer(function: EngineOps.app, op: "image.spec", args: EngineValue.object(request)))
        }
        var request = args
        // 预览弹层（display: true）：不要 PNG / base64，直接给画好的位图（像素与 PNG 解回来的逐个相同：同一张图，PNG 无损）。
        // 分享 / 存相册不带它，照旧给 PNG（字节不变）。spec 的输入不带这个键（与原来同一份）。
        let display = op == "image.render" && args["display"] as? Bool == true
        request.removeValue(forKey: "display")
        if op == "image.save", args["mode"] as? String != "long" { request["mode"] = "export" }
        let first = await spec(request)
        guard first["ok"] as? Bool == true, let s = first["spec"] as? [String: Any] else { return failed }
        let status = s["status"] as? String ?? "ready"
        if status != "ready", op == "image.save" { return failed }
        if status != "ready" { return ["ok": true, "image": ["status": status, "dataURL": "", "width": 0, "height": 0, "name": ""]] }
        do {
            if display {
                guard let image = try imageRenderer!.renderImages(s).first else { return failed }
                // width / height = 原来 UIImage(data: png).size（PNG 解回来 scale 1 → 点 = 像素）
                return ["ok": true, "image": ["status": "ready", "dataURL": "", "width": image.width, "height": image.height, "name": first["name"] as? String ?? ""],
                        Self.pictureKey: UIImage(cgImage: image, scale: 1, orientation: .up)]
            }
            let data = try imageRenderer!.render(s)
            if op == "image.render" {
                guard let png = data.first, let image = UIImage(data: png) else { return failed }
                return ["ok": true, "image": ["status": "ready", "dataURL": "data:image/png;base64," + png.base64EncodedString(), "width": Int(image.size.width), "height": Int(image.size.height), "name": first["name"] as? String ?? ""]]
            }
            var images: [[String: Any]] = []
            func append(_ pngs: [Data], _ name: String) {
                for (i, png) in pngs.enumerated() {
                    let base = (name as NSString).deletingPathExtension
                    let stem = pngs.count > 1 ? base + "-\(i + 1)of\(pngs.count)" : name
                    images.append(["dataURL": "data:image/png;base64," + png.base64EncodedString(), "name": RootViewController.fileName(stem, forExtension: "png"), "kind": (args["scope"] as? [String: Any])?["kind"] as? String ?? ""])
                }
            }
            append(data, first["name"] as? String ?? "shizi")
            if args["mode"] as? String != "long" {
                let total = first["total"] as? Int ?? 1
                if total > 1 { for page in 1..<total {
                    request["page"] = page
                    let body = await spec(request)
                    guard let next = body["spec"] as? [String: Any], body["ok"] as? Bool == true else { return failed }
                    append(try imageRenderer!.render(next), body["name"] as? String ?? "shizi")
                } }
            }
            guard !images.isEmpty else { return failed }
            return EngineValue.dict(await core.answer(function: EngineOps.app, op: "image.persist", args: EngineValue.object(["images": images])))
        } catch {
            ShiziProbe.log("native image render failed: \(error)")
            return failed
        }
    }

    // MARK: QA 设施（只在 DEBUG；QAOps.swift 的夹具 op 调）

    #if DEBUG
    /// 存储替身（夹具 blockMode / corruptNotice）：替身挂到 Swift 的存储上再重读，阻断页由 checkBlock 发、坏值浮条由 checkCorrupt 发。
    func qaOverrideStorage(probe: String?, blocked: String?, quarantined: [String]?) {
        let storage = core.store.storage
        storage.probeOverride = probe.map { (false, $0) }
        storage.blockedOverride = blocked.map { ($0, [], []) }
        storage.quarantinedOverride = quarantined
        reloadFromLibrary()
    }

    /// 夹具的界面入口：corruptHide = 收起坏值浮条（夹具清理）；其余交 EngineHost.qaUI（与原生按钮同一个入口）。
    func qaUI(_ action: String, _ args: JSValue) {
        if action == "corruptHide" {
            nav.post(JSObject([("op", .string("corrupt")), ("show", .bool(false))]))
            return
        }
        core.host.qaUI(action, args)
    }

    /// 测试钩子 reset 的 Swift 版（reset）：清写入注入、删全部 shizi.* 键、重读库（时钟由 QAClock 另管）。
    func qaReset() {
        let storage = core.store.storage
        storage.clearFaults()
        pendingFaults = nil
        if let keys = try? storage.listKeys("shizi.") { _ = try? storage.removeKeys(keys) }
        reloadFromLibrary()
        announceAllDomains() // test-hooks reset → store.reload：订阅者收到全部域
    }

    /// 迁移失败的阻断页（夹具 blockMode migration）：nil = 还原。
    func qaSetMigrationFailure(_ reason: String?) {
        qaMigrationFailure = reason.map { .object(JSObject([("reason", .string($0))])) }
        publishStatus()
        checkBlock()
    }
    #endif

    /// 重读库（重新启动 / QA 清空数据）：store.load 时不推 changed（之后页面按 status / 下一次提交重拉）。
    private func reloadFromLibrary() {
        reloading = true
        backend.reload()
        core.load()
        reloading = false
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

    /// 重读库之后（重新启动 / QA 清空）：原生页按全部域重拉（JS 参考：store.reload 后订阅者收到全部域）。
    private func announceAllDomains() {
        let set = ShiziChangeSet(domains: Schema.domains, label: nil)
        for c in subscribers.values { c.yield(set) }
    }

    // MARK: 订阅 store 做的事（watchBlock / watchCorrupt、postStatus）

    private func storeChanged(_ info: JSObject) {
        let type = info["type"]?.stringValue ?? ""
        if type == "status" || type == "load" { publishStatus() }
        checkBlock()
        checkCorrupt()
        applyAppearance()
        // affectsReminder 的超集：同步只在算出的内容变了时才发（ReminderController.sync 比上次发出的）
        if type == "load" || type == "commit" || type == "recover" || info["replace"] == .bool(true) { reminder.scheduleSync() }
    }

    /// 阻断页（watchBlock）：不可用 / 阻断时发原生阻断页的 open，好了收起；同一种（kind|能否导出）不重发。
    private var blockKey: String?
    private var blockId: String?
    private func checkBlock() {
        guard started, stage != nil else { return }
        let reason = blockReason()
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

    /// 坏值提示（watchCorrupt）：本次启动隔离了坏值 → 认领（ack）后发一次浮条。
    private func checkCorrupt() {
        guard started, stage != nil, let notice = core.store.corruptNotice else { return }
        core.store.ackCorruptNotice()
        let text = (try? Copy.text("X-SYS.corruptNotice")) ?? ""
        nav.post(JSObject([("op", .string("corrupt")), ("show", .bool(true)), ("keys", notice["keys"] ?? .array([])),
                           ("lines", core.host.measure.lineStarts("corrupt-text", text))]))
    }

    /// 窗口外观（startAppearance：store 的显示偏好 → 壳的唯一应用点 ShiziTheme）。
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
        // 首练结果页的提醒邀请（inviteReminder / inviteChangeTime：一次 settings 提交 → 要权限 → 同步）
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
        // 存相册（saveImageFile 的原生分支：savePracticeCard → 成功与否；等 120s）
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
        // 选字条小图（chipThumb：32pt 格、--hand、透明底）
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

    /// 已授权不再要；否则向系统要（回 true = 真的发出了请求）。
    private func requestPermission(_ remind: JSValue) -> Bool {
        if remind["permission"] == .string("granted") { return false }
        guard let host = stage?.host else { return false }
        host.requestReminderPermission()
        return true
    }

    /// 系统查到 / 要到的通知权限（JS 参考 shiziReminderStatus → applyReminderStatus）。
    func receiveReminderStatus(_ permission: String) {
        var value = permission
        #if DEBUG
        if let p = qaPermission { value = p } // 夹具 systemPermission：回包里的 permission 钉成夹具写的值，其余照常
        #endif
        _ = reminder.receiveStatus(.object(JSObject([("permission", .string(value))])))
    }

    /// 冷启动的栈重建好了：提醒开着就查权限并同步一次（startReminder）。
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

// MARK: - 原生量测：页面自己的字体与版心宽，按 ShiziPageText 的均衡折行（网页 text-wrap: pretty / balance 的同一口径）

/// 与网页 DOM 量（JS 参考）的差别：字体是原生页实际用的苹方 / 宋体（网页同名字体的 woff2 与系统苹方在个别字宽上不同）；
/// 宽按原生页的版心（屏宽 − 2 × 页边），不含网页 fit-content / max-width 的细节；AX 档的折行因此可能与网页不同——原生页按自己的排法本来就该如此。
final class NativeLineMeasure: EngineMeasure {
    private enum Face { case hei(Int), heiMedium(Int), song(Int) }

    /// kind / variant → 页面用的字（Records / Annual / Month / DetailParts / LibrarySwitch / SessionNone / Block / CorruptNotice / Query /
    /// B4.9c 补：图片预览说明句与失败句、备份页、提醒页、结果页页头与预告——网页在这些段落上量 DOM，swift 模式原来回 null，原生只好按自己的贪心折行）。
    private static let faces: [String: Face] = [
        "records-title": .song(22), "records-daylist-title": .song(22), "empty-title": .song(22), "result-title": .song(22),
        "records-legend": .hei(15), "records-axrow": .hei(15), "annual-first-date": .hei(15), "detail-next": .hei(15),
        "empty-body": .hei(15), "block-line": .hei(15), "s02-body": .hei(15),
        "corrupt-text": .hei(15), "image-note": .hei(15), "image-fail": .hei(15), "backup.intro": .hei(15), "backup.confirmBody": .hei(15), "result-preview": .hei(15),
        "records-paperday": .hei(13), "records-sheet-note": .hei(13), "month-sub": .hei(13), "library-switch-source": .hei(13),
        "remind.sub": .hei(13), "result-sub": .hei(13),
        "annual-head": .hei(17), "card-action": .heiMedium(17),
    ]

    func lineStarts(_ kind: String, _ text: String) -> JSValue {
        guard !text.isEmpty, let face = Self.faces[kind] else { return .null }
        let mt = ShiziMetrics()
        let body = UIScreen.main.bounds.width - 2 * mt.gutter
        let width: CGFloat
        // 版心以外的宽（原 JS 参考量 DOM 时的容器，B4.9c 逐个对过）
        switch kind {
        case "annual-head": width = body + 8
        case "annual-first-date": width = body + 8 - 132 - 20
        case "s02-body", "backup.confirmBody": width = body - 40 // 确认框：左右页边 + 内边距 20 × 2（.sz-confirm__body）
        case "corrupt-text": width = body - 76 // 坏值浮条：边框 1 × 2、内边距 16 + 6、字与关闭键间距 8、关闭键 44（.sz-corrupt__text fs15）
        case "remind.sub": width = body - 56 // 提醒行：右侧开关 44 + 间距 12（.sz-remind__sub）
        case "card-action": width = (body - 12) / 2 - 16 // 字卡两键格 1fr 1fr、gap 12，键的左右内边距 8（.sz-qcard__two .sz-btn--secondary）
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
        // 按钮文字只在词与词之间折（segmentWords + 正常折行）；其余是 text-wrap: pretty 的段落
        let lines = kind == "card-action" ? Self.wordLines(a, chars, width: width) : ShiziPageText.wrappedLines(a, chars, width: width)
        // 每一行从第几个字开始（JS Array.from 的码点计；第一行不在数组里）
        var starts: [JSValue] = []
        var scalar = 0, index = 0
        for r in lines {
            while index < r.lowerBound { scalar += chars[index].unicodeScalars.count; index += 1 }
            if r.lowerBound > 0 { starts.append(.number(Double(scalar))) }
        }
        return .array(starts)
    }

    /// 按词切（系统分词，zh），开括号类并进后一个词、其余标点并进前一个词，空白单独一块（是断点）；
    /// 然后按块贪心排进宽 w（white-space: normal，块内不断）。返回每行的字下标区间。
    static func wordLines(_ a: NSAttributedString, _ chars: [Character], width w: CGFloat) -> [Range<Int>] {
        let text = String(chars)
        var pieces: [(range: Range<Int>, word: Bool)] = []
        var index = 0
        let tokenizer = CFStringTokenizerCreate(nil, text as CFString, CFRange(location: 0, length: (text as NSString).length), kCFStringTokenizerUnitWordBoundary, Locale(identifier: "zh") as CFLocale)
        var utf16 = 0
        while true {
            let t = CFStringTokenizerAdvanceToNextToken(tokenizer)
            if t.isEmpty { break }
            let r = CFStringTokenizerGetCurrentTokenRange(tokenizer)
            let sub = (text as NSString).substring(with: NSRange(location: r.location, length: r.length))
            if r.location > utf16 { // 分词器跳过的（空白 / 标点）
                let gap = (text as NSString).substring(with: NSRange(location: utf16, length: r.location - utf16))
                for ch in gap { pieces.append((index..<index + 1, false)); _ = ch; index += 1 }
            }
            let n = sub.count
            pieces.append((index..<index + n, sub.rangeOfCharacter(from: .alphanumerics) != nil || NativeType.hasCJK(sub)))
            index += n
            utf16 = r.location + r.length
        }
        while index < chars.count { pieces.append((index..<index + 1, false)); index += 1 }
        let opening: Set<Character> = ["\u{300C}", "\u{300E}", "\u{FF08}", "\u{300A}", "\u{3008}", "\u{3010}", "\u{3014}", "\u{201C}", "\u{2018}", "(", "[", "{"] // 「『（《〈【〔“‘
        var units: [Range<Int>] = []
        var pendingOpen: Int?
        var lastIsWord = false
        for p in pieces {
            let s = String(chars[p.range])
            if s.allSatisfy(\.isWhitespace) {
                if let o = pendingOpen { units.append(o..<p.range.lowerBound); pendingOpen = nil }
                units.append(p.range)
                lastIsWord = false
            } else if p.word {
                units.append((pendingOpen ?? p.range.lowerBound)..<p.range.upperBound)
                pendingOpen = nil
                lastIsWord = true
            } else if s.allSatisfy({ opening.contains($0) }) {
                if pendingOpen == nil { pendingOpen = p.range.lowerBound }
            } else if lastIsWord, let last = units.last {
                units[units.count - 1] = last.lowerBound..<p.range.upperBound
            } else {
                units.append((pendingOpen ?? p.range.lowerBound)..<p.range.upperBound)
                pendingOpen = nil
                lastIsWord = true
            }
        }
        if let o = pendingOpen { units.append(o..<chars.count) }
        func widthOf(_ r: Range<Int>) -> CGFloat {
            let ns = NSRange(location: String(chars[0..<r.lowerBound]).utf16.count, length: String(chars[r]).utf16.count)
            return a.attributedSubstring(from: ns).size().width
        }
        var lines: [Range<Int>] = []
        var start = 0, used: CGFloat = 0
        for u in units {
            let uw = widthOf(u)
            let blank = String(chars[u]).allSatisfy(\.isWhitespace)
            if used > 0, !blank, used + uw > w + 0.5 {
                lines.append(start..<u.lowerBound)
                start = u.lowerBound
                used = 0
            }
            used += uw
        }
        if start < chars.count { lines.append(start..<chars.count) }
        return lines
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

    /// 页面 color-scheme 的计算值（「我的 › 外观」强制的浅 / 深或跟系统）= 窗口此刻的外观。
    static func theme() -> JSValue {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        let style = (windows.first(where: \.isKeyWindow) ?? windows.first)?.traitCollection.userInterfaceStyle ?? UITraitCollection.current.userInterfaceStyle
        return .string(style == .dark ? "dark" : "light")
    }

    /// typeBundle 里页面才有的那一半：px 值由 ShiziLook 按系统字号档生成；AX 档位照给，逐元素版式是原生常量
    /// （D81 ①：ShiziLook 按 NativeAXLayout 填，不再向页面量网页 CSS），这里给空。
    static func type() -> JSValue {
        .object(JSObject([("ax", .number(Double(SwiftNavigator.axLevel()))), ("roles", .object(JSObject()))]))
    }
}
