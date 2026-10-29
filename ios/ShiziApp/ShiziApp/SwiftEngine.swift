import ShiziCore
import QuartzCore
import UIKit
import WebKit

// B4.5c：SwiftEngine（DEBUG -shizi-engine swift；计划 B3B4-原生化架构与计划.md §3.4、§4.2）。
//
// 与 WebEngine 同一个协议（ShiziEngine / StageEngine），页面一行不改。Store 接 App 的同一个 SQLite 库（同一条连接，同表同键同值形状，不迁移）。
//   · Swift 答：EngineOps.swiftAnswers 里的 op（视图、各页写入、写字会话、结果页的非导航 op、图片 spec / persist 记账、阻断页、提醒、备份 …）；
//   · 交 JS：EngineOps.jsOnlyApp（栈记账 / 冷启动判定 / 深链、网页界面层、画图）与 EngineOps.hostApp / hostWrite（导航宿主与界面状态，B4.8 原生化）。
// 两个写入者同一个库，按「谁写了谁通知」对齐：
//   · Swift 提交成功 → 页面 shiziEngineSync（JS 镜像重读库、store 重新 load；它的 changed 回声丢掉）。排在 WKWebView 的同一条调用队列里，
//     之后交给 JS 的 op 一定读到 Swift 刚写下的状态；
//   · JS 提交（交出去的 op 里开组、S02、测试钩子造数据 …）→ 页面照旧推 changed → Swift 镜像重读、store 重新 load，再把 changed 转给页面。
// changed：Swift 的提交由 Swift 的 change feed（createChangeFeed 同一组脏域规则）发；判断声 j1 轮换由 Swift 的提交发（一件事一个责任方：
// 判断写在 Swift，JS 那边没有这次提交，不会再响）；落印 s1 仍由交给 JS 的 resultSealed 发。触觉仍由原生页自己发（B3Zf-1）。
final class SwiftEngine: StageEngine {
    private let web: WebEngine
    let core: SwiftEngineCore
    private let backend: ReloadableBackend
    private var subscribers: [UUID: AsyncStream<ShiziChangeSet>.Continuation] = [:]
    private var feedOff: (() -> Void)?
    private var reloading = false
    /// 发出去还没收到回声的 shiziEngineSync 次数（回声 = 全部域、label 为空的 changed）。
    private var pendingSyncs = 0
    private var commits = 0
    /// 判断声的播放（WebViewController 的同一组预载 CAF）。
    var playSound: ((String, Double) -> Void)?

    init(webView: WKWebView?) {
        web = WebEngine(webView: webView)
        backend = ReloadableBackend(transport: BridgeTransport())
        core = SwiftEngineCore(backend: backend, clock: SwiftEngine.clock, measure: NativeLineMeasure())
        core.load()
        _ = core.store.subscribe { [weak self] _, info in
            if info["type"] == .string("commit") || info["type"] == .string("recover") || info["replace"] == .bool(true) { self?.commits += 1 }
        }
        feedOff = core.changeFeed { [weak self] packet in self?.emit(packet) }
        core.onSound = { [weak self] name, gain in self?.playSound?(name, gain) }
        EngineRoute.swift = { [weak self] function, op, args, completion in self?.route(function, op, args, completion) ?? false }
    }

    deinit { feedOff?() }

    static func clock() -> Double {
        #if DEBUG
        return QAClock.nowMs()
        #else
        return Date().timeIntervalSince1970 * 1000
        #endif
    }

    // MARK: 转给 WebEngine 的部分（页面状态、导航者、页面推来的消息）

    var webView: WKWebView? { get { web.webView } set { web.webView = newValue } }
    var navigator: ((String, [String: Any]) -> [String: Any])? { get { web.navigator } set { web.navigator = newValue } }
    var status: ShiziEngineStatus { web.status }
    @discardableResult func observeStatus(_ fn: @escaping (ShiziEngineStatus) -> Void) -> () -> Void { web.observeStatus(fn) }
    func receiveStatus(_ body: [String: Any]) { web.receiveStatus(body) }
    func pageWillReload() { web.pageWillReload() }
    func pageDidBecomeReady() { web.pageDidBecomeReady() }

    func raw(_ op: String, _ args: [String: Any], completion: @escaping ([String: Any]) -> Void) { web.raw(op, args, completion: completion) }
    @MainActor func raw(_ op: String, _ args: [String: Any]) async -> [String: Any] { await web.raw(op, args) }
    @MainActor func call<A: Encodable, R: Decodable>(_ op: String, _ args: A, as type: R.Type) async throws -> R {
        try ShiziDecode.reply(await raw(op, ShiziDecode.args(args)), as: R.self)
    }

    // MARK: 答

    /// EngineRoute 的 swift 出口：Swift 答的 op 在主线程答（写字会话回包照旧带 ms）；其余交页面。
    /// 两种都排进同一条主线程任务队列（按发出顺序）：交给页面的 op 一定排在它前面 Swift 提交引起的 shiziEngineSync 之后。
    private func route(_ function: String, _ op: String, _ args: [String: Any], _ completion: @escaping ([String: Any], Double) -> Void) -> Bool {
        let native = EngineOps.swiftAnswers(function: function, op: op)
        let t0 = CACurrentMediaTime()
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard native else {
                WebEngine.evaluate(web.webView, function: function, op: op, args: args, completion: completion)
                return
            }
            let before = commits
            let reply = await core.answer(function: function, op: op, args: EngineValue.object(args))
            var body = EngineValue.dict(reply)
            let wall = (CACurrentMediaTime() - t0) * 1000
            if function == EngineOps.write { body["ms"] = wall }
            if commits != before { syncPage() }
            completion(body, wall)
        }
        return true
    }

    /// Swift 写了库：页面的 JS 镜像重读（排在调用队列里）。
    private func syncPage() {
        pendingSyncs += 1
        WebEngine.evaluate(web.webView, function: "shiziEngineSync", op: "", args: [:]) { [weak self] body, _ in
            if body["ok"] as? Bool != true { self?.pendingSyncs = max(0, (self?.pendingSyncs ?? 1) - 1) }
        }
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

    /// 页面推来的 changed：Swift 同步引起的回声丢掉；JS 自己的提交 → Swift 重读库再转给页面；非 store 的（离开撤销条 'ui'）直接转。
    func receiveChanged(_ body: [String: Any]) -> ShiziChangeSet? {
        let domains = (body["domains"] as? [String]) ?? []
        guard !domains.isEmpty else { return nil }
        let label = body["label"] as? String
        if pendingSyncs > 0, label == nil, Set(domains) == Set(Schema.domains) {
            pendingSyncs -= 1
            return nil
        }
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

    /// 渲染器给的值：缩略图 ""（没有位图，原生页自己画）；全部字 / 清单的版式量测 null（原生页按自己的版式量）；令牌包 {}（写字页自己读 ShiziTokens）。
    func host(_ name: String) -> JSValue {
        switch name {
        case "thumb": return .string("")
        case "metrics": return .null
        default: return .object(JSObject())
        }
    }
}
