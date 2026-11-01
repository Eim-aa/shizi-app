#if DEBUG
import ShiziCore
import QuartzCore
import UIKit
import WebKit

// B4.7：影子运行（DEBUG -shizi-engine shadow；计划 B3B4-原生化架构与计划.md §4.3 ⑥）。
//
// WebEngine 照旧是写入者、照旧答页面；SwiftEngine 在后台用同一前态的内存副本把每个 op 再算一遍，回包与后态在**解析后的值**上逐个比。
// 比的范围 = SwiftEngine 有实现的 op（EngineOps.swiftImplements：App API 除只交 JS 的那几个、写字会话全部）。
//
// 前态从哪来：页面经 NativeStoreBridge 写库的每一批（apply）都记进 ShadowJournal（序号、键值、归属 op）——影子包装在 op 的同步部分里
// 设 window.__shiziShadowOp，页面的 XHR 传输带上它（X-Shizi-Op）。第一次调用前读一次全库作底，之后底 + 日志 = 任一时刻的库。
// 并发：在飞的调用彼此重叠时合成一组；WKWebView 按发出顺序执行、op 的同步部分在 JS 里是原子的，所以组内按发出顺序重放：
// 每个 op 的前态 = 组前的库 + 排在它前面的调用自己的写入；交给 JS 的调用写了域键，Swift 的库就重置到页面那一刻的库再往下算。
//
// 一条比对规则（不按页面开例外）：
//   · 回包：两边的值逐路径相等（对象不看键序，数字按 Double 相等，缺省 ≠ null）；
//   · 后态：每个比对 op 自己写的 store 域键（Schema.specForKey 有 domain 的键）逐键相等（值按 JSON 解析后比）；路由提示等非域键不比；
//   · changed：页面在比对 op 的同步部分里推的 store 提交推送（带 shadowOp，见 bridge.js）== Swift change feed 推的，按顺序
//     （界面状态的推送 'ui'——离开撤销条变了——跟着宿主的界面状态走，见 host-unregistered）；
//   · 声音：组内 op 发的 sound 序列 == Swift 发的（判断声 j1 轮换、落款 s1；轮换计数对齐到这组第一个声音之前页面放过的判断声总数）。
// 只忽略这几类有记录的字段（不是规则，是宿主 / 时钟给的值）：
//   1. 写字会话回包根上的 ms（性能采样，write.*.ms）；
//   2. remainingMs（离开撤销 / 跳过撤销的剩余时间 = 截止时刻 − 界面单调时钟 performance.now，两边时钟不同）：两边都是数字即可；
//   3. 排版量测的结果（折行点 / 段落量测 / 查字与 S02 折行 / 结果页 / 我的页 / 备份与提醒页 / 图片预览的折行点：网页 DOM 量、原生按自己的字体量，
//      见 SwiftEngine.swift NativeLineMeasure）：Swift 一侧给标记 [1, 1]（ShadowMeasure），网页一侧是 null 或整数数组即可；
//   4. 渲染器给的值——写字页的令牌包 colors / type / theme（网页 CSS 计算值；theme 只认 light / dark，Swift 宿主给页面那次的值）、图片选字条的缩略图 thumb（网页 canvas 画的位图）、
//      全部字 / 清单的版式量测 metrics（网页 DOM 量）：Swift 一侧给标记 {"$host": 名}，网页一侧不比。
// 不比、记 skipped（前态从库重读）的情况：
//   · untagged-writes：组的窗口里有不归属任何调用的域键写入（op 的异步后续、注入脚本、平台回调）——放不进顺序里；
//   · storage-injected：页面的 storage 处在测试注入的状态（interruptAfterWrite 之后「进程已中断」、夹具脚本换掉了探测 / blocked）；
//   · host-unregistered：依赖界面层状态的 op（查字弹层回调、S02 回调；离开撤销条——首页 / 字库视图与它的撤销），Swift 一侧的状态早于
//     页面最近一次 Swift 看不见的脚本 / 深链（QA 夹具会直接清离开撤销条、打开查字弹层）；页面回包说没有离开撤销条时 Swift 对齐成没有。
// 平台结果（存相册的权限 / 写文件）：Swift 宿主拿页面那次实际得到的结果（同一次保存，影子不存第二遍），比的是它前后的记账。
// 页面函数还没装好（启动早期，回包是 unavailable）的调用不是引擎的回答，不比（记 unanswered）。
// 写入注入（D07 三段式的测试：测试钩子 failNextWrite / interruptAfterWrite）：影子包装读出发出时页面挂着的注入，Swift 一侧挂同一组再算（测试设施，不是规则）。
// 时钟：影子包装在 op 的同步部分把 JS 的 Date.now 钉在同一毫秒（两边用同一个「现在」；异步 op 等待之后照常走），只影响影子模式。
// 影子在后台串行队列上算，回包先交页面再排进队列，不拖慢点按 → 首帧（50ms 门槛）。

/// 页面经 NativeStoreBridge 写库的日志（只在影子模式开）。
final class ShadowJournal {
    static var shared: ShadowJournal?
    private let lock = NSLock()
    private var seq = 0
    private var entries: [(seq: Int, writes: [(String, String?)], tag: String?)] = []

    var current: Int { lock.lock(); defer { lock.unlock() }; return seq }

    /// 在 NativeStoreBridge 的队列上调（apply 成功之后）。
    func record(_ writes: [(String, String?)], tag: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        seq += 1
        entries.append((seq, writes, tag))
    }

    func writes(after a: Int, upTo b: Int) -> [[(String, String?)]] { tagged(after: a, upTo: b).map(\.writes) }

    /// 带归属的写入（tag = 写入时页面里正在跑的影子 op；nil = op 之外：异步的后续、宿主消息、注入脚本）。
    func tagged(after a: Int, upTo b: Int) -> [(writes: [(String, String?)], tag: String?)] {
        lock.lock(); defer { lock.unlock() }
        return entries.filter { $0.seq > a && $0.seq <= b }.map { ($0.writes, $0.tag) }
    }

    func drop(upTo s: Int) {
        lock.lock(); defer { lock.unlock() }
        entries.removeAll { $0.seq <= s }
    }
}

/// 影子的库：内存里的键值，事务后端（与 App 的原生镜像后端同口径：native 预算、墨迹编码），记下这一组 Swift 写了什么。
final class ShadowDisk: KVBackend {
    private var rows: [String: String] = [:]
    private var sorted: [String]?
    private(set) var writes: [String: String?] = [:]

    /// 这次启动页面的存储探测被测试宿主改成失败（-shizi-qa-storage-unavailable → test-hooks 的 storage.probe 恒为 security）：
    /// 影子的探测键同样写不进去（测试设施，与写入注入同一回事）。
    let failProbe = ProcessInfo.processInfo.arguments.contains("-shizi-qa-storage-unavailable")
    private let probeKey = Schema.keyNamed("probe") ?? ""

    func reset(_ all: [String: String]) { rows = all; sorted = nil; writes = [:] }
    func clearWrites() { writes = [:] }

    func length() throws -> Int { rows.count }
    func key(_ index: Int) throws -> String? {
        if sorted == nil { sorted = rows.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) } }
        return index >= 0 && index < sorted!.count ? sorted![index] : nil
    }
    func getItem(_ key: String) throws -> String? { rows[key] }
    func setItem(_ key: String, _ value: String) throws { try applyBatch([(key, value)]) }
    func removeItem(_ key: String) throws { try applyBatch([(key, nil)]) }
    var isTransactional: Bool { true }
    func applyBatch(_ entries: [(String, String?)]) throws {
        if failProbe, entries.contains(where: { $0.0 == probeKey }) { throw StoreJSError(.plain, name: "SecurityError", message: "The operation is insecure.") }
        for (k, v) in entries {
            if let v { rows[k] = v } else { rows[k] = nil }
            writes[k] = .some(v)
        }
        sorted = nil
    }
    var supportsDiag: Bool { true }
    func diag(_ entry: JSObject) {}
}

/// 影子里的量测：给标记（比对规则 3、4）。折行点的标记是 [1, 1]——真实的折行点严格递增、不会重复，而且它经得住
/// session/text-lines.js 的过滤（整数、在 (0, 字数) 里）；只有一个字的段落过滤后成 []，网页那边同样折不出行（[]）。
final class ShadowMeasure: EngineMeasure {
    static let marker: JSValue = .array([.number(1), .number(1)])
    func lineStarts(_ kind: String, _ text: String) -> JSValue { text.isEmpty ? .null : Self.marker }
    func measure(_ spec: JSValue) -> JSValue {
        guard let text = spec["text"]?.stringValue, !text.isEmpty else { return .null }
        return Self.marker
    }
    /// 写字页的主题（页面 :root color-scheme，网页 CSS 计算值）：只有 light / dark 才进回包，标记会被规则滤掉，所以给页面那次的值（同规则 4：宿主给的值不比）。
    var webTheme: JSValue?
    func host(_ name: String) -> JSValue { name == "theme" ? webTheme ?? .null : .object(JSObject([("$host", .string(name))])) }
}

final class ShadowEngine {
    static var shared: ShadowEngine?

    static func start() {
        guard shared == nil else { return }
        ShadowJournal.shared = ShadowJournal()
        shared = ShadowEngine()
    }

    private let journal = ShadowJournal.shared!
    private let worker = DispatchQueue(label: "com.eimaa.shizi.shadow", qos: .utility)
    private let launch = UUID().uuidString

    // MARK: 主线程：调用分组

    private final class Call {
        let function: String, op: String, args: [String: Any]
        let compared: Bool
        /// 影子包装给这次调用的编号（页面在它的同步部分里写库时带上，见 ShadowJournal）。
        let id: String
        var reply: [String: Any] = [:]
        var t: Double = 0
        /// 页面的墙上时钟（Date.now，不带测试宿主的偏移）：createAppApi ctx.now 用它。
        var wall: Double = 0
        var missing = false
        /// 发出时页面 storage 上挂着的写入注入（测试钩子 getFaults）：Swift 一侧挂同一组再算。
        var faults: JSValue = .null
        /// 发出时的界面层登记纪元。
        var epoch = 0
        init(function: String, op: String, args: [String: Any], id: String) {
            self.function = function; self.op = op; self.args = args; self.id = id
            compared = EngineOps.swiftImplements(function: function, op: op)
        }
    }

    private final class Group {
        let preSeq: Int
        var postSeq = 0
        var calls: [Call] = []
        var changed: [JSValue] = []
        var sounds: [String] = []
        /// 组开始时页面已经放过的判断声次数（轮换计数的前态）；组里有声音时以第一个声音到达前的计数为准（op 之外的判断声可能晚到）。
        var judgeBase = 0
        var firstSoundBase: Int?
        init(preSeq: Int) { self.preSeq = preSeq }
    }

    private var group: Group?
    private var callSerial = 0
    private var inflight = 0
    private var based = false

    /// 界面层登记的纪元（见 foreign）；只交 JS 的提醒深链（开组 / S02）同样开新纪元。
    private var hostEpoch = 0

    /// 原生直接往页面里执行了脚本（不经引擎：QA 夹具、平台回调）。它们的写入不带 op 标记（ShadowJournal），按「别的写入」处理；
    /// 它们还可能在页面的界面层登记查字 / S02 回调（Swift 看不见）——记一个新纪元，之前在 Swift 一侧的登记说不清了。
    static func foreign() {
        guard let s = shared else { return }
        s.hostEpoch += 1
    }

    /// 同上，脚本要等（QA 夹具注入：页面里一路 await）：执行期间开着的组都不比，结束后的下一组也不比。
    @MainActor static func foreign<T>(_ body: () async -> T) async -> T {
        guard let s = shared else { return await body() }
        foreign()
        let r = await body()
        foreign()
        return r
    }

    /// EngineRoute 的影子出口：照旧交页面（多取一次 JS 的「现在」），回包先交给页面，再把这一组排进后台比对。
    func evaluate(_ webView: WKWebView?, function: String, op: String, args: [String: Any], completion: @escaping ([String: Any], Double) -> Void) {
        guard let webView else { WebEngine.evaluate(nil, function: function, op: op, args: args, completion: completion); return }
        if !based { takeBase() }
        callSerial += 1
        let call = Call(function: function, op: op, args: args, id: "s\(callSerial)")
        let g = group ?? Group(preSeq: journal.current)
        if group == nil { g.judgeBase = webJudgeSounds }
        if function == EngineOps.app && op == "deeplink.reminder" { hostEpoch += 1 }
        call.epoch = hostEpoch
        group = g
        g.calls.append(call)
        inflight += 1
        let t0 = CACurrentMediaTime()
        webView.callAsyncJavaScript(
            "if (typeof window.\(function) !== 'function') return {missing: true, r: {ok:false, error:{kind:'unavailable'}}}; const real = Date.now; const ms = real(); Date.now = () => ms; const tag0 = window.__shiziShadowOp; window.__shiziShadowOp = shadowId; let p, t, f = null; try { const T = window.__shiziTest; t = T && typeof T.now === 'function' ? T.now() : ms; f = T && typeof T.getFaults === 'function' ? T.getFaults() : null; p = window.\(function)(op, args); } finally { Date.now = real; window.__shiziShadowOp = tag0; } return {t: t, ms: ms, f: f, r: await p};",
            arguments: ["op": op, "args": args, "shadowId": call.id],
            in: nil,
            in: .page
        ) { [weak self] result in
            let wall = (CACurrentMediaTime() - t0) * 1000
            var body: [String: Any] = ["ok": false, "error": ["kind": "transport"]]
            var t = 0.0, missing = false
            if case .success(let value) = result, let wrap = value as? [String: Any] {
                if let dict = wrap["r"] as? [String: Any] { body = dict }
                t = (wrap["t"] as? NSNumber)?.doubleValue ?? 0
                call.wall = (wrap["ms"] as? NSNumber)?.doubleValue ?? t
                missing = wrap["missing"] as? Bool == true
                call.faults = EngineValue.js(wrap["f"])
            }
            if case .failure(let error) = result { body = ["ok": false, "error": ["kind": "transport", "reason": error.localizedDescription]] }
            completion(body, wall)
            call.reply = body
            call.t = t
            call.missing = missing
            self?.finish()
        }
    }

    private func finish() {
        inflight -= 1
        guard inflight == 0, let g = group else { return }
        group = nil
        g.postSeq = journal.current
        worker.async { [weak self] in self?.process(g) }
    }

    /// 页面推来的 changed：在某个 op 的同步部分里推的（带 shadowOp）记进那个 op 所在的组；op 之外的（注入脚本、异步后续）不算引擎的。
    func webChanged(_ body: [String: Any]) {
        guard let op = body["shadowOp"] as? String, let g = group, g.calls.contains(where: { $0.id == op }) else { return }
        g.changed.append(EngineValue.obj([("domains", EngineValue.js(body["domains"])), ("label", EngineValue.js(body["label"])), ("op", .string(op))]))
    }

    /// 页面放过的判断声总数（含 op 之外的：QA 夹具注入的判断也会响）——轮换计数的真相。
    private var webJudgeSounds = 0

    /// 页面重载（WebContent 被回收 / 测试重载）：JS 的模块状态从头来——轮换计数归零、界面层登记与落款声记过的 key 都没了。
    func pageReloaded() {
        webJudgeSounds = 0
        hostEpoch += 1
        worker.async { [weak self] in self?.core.host.resetPageState() }
    }

    /// 页面发的声音（判断声 / 落款声）：op 同步部分里发的记进那个 op 的组；轮换计数的前态 = 这一组第一个声音之前页面放过的判断声数。
    func webSound(_ kind: String, op: String?) {
        if let op, let g = group, g.calls.contains(where: { $0.id == op }) {
            if g.firstSoundBase == nil { g.firstSoundBase = webJudgeSounds }
            g.sounds.append(kind)
        }
        if SwiftEngineCore.judgeFiles.contains(kind) { webJudgeSounds += 1 }
    }

    // MARK: 后台：重算与比对

    private var mirror: [String: String] = [:]
    private var mirrorSeq = 0
    private var coreSeq = -1
    private let disk = ShadowDisk()
    private lazy var core: SwiftEngineCore = {
        let c = SwiftEngineCore(backend: disk, clock: { Date().timeIntervalSince1970 * 1000 }, measure: shadowMeasure)
        c.onSound = { [weak self] name, _ in if self?.collecting == true { self?.swiftSounds.append(name) } }
        _ = c.changeFeed { [weak self] packet in if self?.collecting == true { self?.swiftChanged.append(packet) } }
        return c
    }()
    private let shadowMeasure = ShadowMeasure()
    private var collecting = false
    private var swiftChanged: [JSValue] = []
    private var swiftSounds: [String] = []

    /// 第一次调用前：全库作底（与日志序号在 NativeStoreBridge 的队列上一起取，前后一致）。
    private func takeBase() {
        based = true
        let snap = NativeStoreBridge.shared.shadowSnapshot()
        mirror = snap.rows
        mirrorSeq = snap.seq
    }

    private func advance(to seq: Int) {
        guard seq > mirrorSeq else { return }
        for batch in journal.writes(after: mirrorSeq, upTo: seq) {
            for (k, v) in batch { if let v { mirror[k] = v } else { mirror[k] = nil } }
        }
        mirrorSeq = seq
        journal.drop(upTo: seq)
    }

    static func isDomainKey(_ key: String) -> Bool { Schema.specForKey(key)?.domain != nil }

    /// 正在比的这一组里的调用（诊断用：op 名，交给 JS 的带 *）。
    private var currentGroupOps = ""

    private func process(_ g: Group) {
        currentGroupOps = g.calls.map { ($0.function == EngineOps.write ? "write." : $0.function == EngineOps.nav ? "nav." : "") + $0.op + ($0.compared ? "" : "*") }.joined(separator: ",")
        stats.unanswered += g.calls.filter { $0.compared && $0.missing }.count
        let compared = g.calls.filter { $0.compared && !$0.missing }
        stats.groups += 1
        guard g.preSeq >= mirrorSeq else { stats.skipped += compared.count; return }
        advance(to: g.preSeq)
        // 窗口里的写入按 op 归属（页面在 op 的同步部分写库时带着 op 编号）；没有归属的域键写入（op 的异步后续、注入脚本、平台回调）放不进顺序里
        let entries = journal.tagged(after: g.preSeq, upTo: g.postSeq)
        var byTag: [String: [(String, String?)]] = [:]
        var untagged = false, wroteDomain = false
        for (batch, tag) in entries {
            let domain = batch.contains(where: { Self.isDomainKey($0.0) })
            wroteDomain = wroteDomain || domain
            if let tag { byTag[tag, default: []].append(contentsOf: batch) } else if domain { untagged = true }
        }
        // 「进程已中断」/ 夹具脚本换了探测或 blocked 的页面：Swift 一侧没有对应状态
        let halted = compared.contains { $0.faults["halted"] == .bool(true) || $0.faults["overridden"] == .bool(true) }
        let skip = untagged || halted
        if compared.isEmpty {
            advance(to: g.postSeq)
            if wroteDomain { coreSeq = -1 }
            return
        }
        if skip { stats.skippedGroups[currentGroupOps, default: 0] += 1 }
        // 按发出顺序重放（WKWebView 按发出顺序执行，op 的同步部分在 JS 里是原子的）：页面的库 cur 随每个 op 自己的写入往前走；
        // 交给 JS 的 op 写了域键，Swift 的库就重置到 cur（它们是 JS 的界面层写的，Swift 不做）
        var cur = mirror
        if coreSeq != g.preSeq { disk.reset(cur); core.pinnedNow = compared.first?.t; core.load(); coreSeq = g.preSeq }
        var stale = false
        swiftChanged = []
        swiftSounds = []
        core.judgeCount = g.firstSoundBase ?? webJudgeSounds
        var ok = true
        /// 交给 JS / 不比的调用：它们在页面里推的 changed 不在比的序列里
        var skippedCalls: [String] = []
        func apply(_ writes: [(String, String?)]) { for (k, v) in writes { if let v { cur[k] = v } else { cur[k] = nil } } }
        for c in g.calls {
            let own = byTag[c.id] ?? []
            guard c.compared && !c.missing else {
                if own.contains(where: { Self.isDomainKey($0.0) }) { stale = true }
                skippedCalls.append(c.id)
                apply(own)
                continue
            }
            if stale { disk.reset(cur); core.load(); stale = false }
            disk.clearWrites()
            if !skip { stats.ops += 1 } else {
                stats.skipped += 1
                stats.skippedBy[halted ? "storage-injected" : "untagged-writes", default: 0] += 1
            }
            core.pinnedNow = c.t > 0 ? c.t : nil
            armFaults(c.faults)
            core.host.epoch = c.epoch
            shadowMeasure.webTheme = EngineValue.js(c.reply)["theme"]
            // 依赖界面层登记的 op（查字弹层的回调、S02 的四个回调）：Swift 一侧的登记早于页面最近一次「Swift 看不见的」脚本 / 深链，就说不清页面登记的是什么——照算不比
            let regKey: String? = c.function != EngineOps.app ? nil
                : c.op == "s02.decide" ? "s02"
                : c.op == "query.pick" || c.op == "query.detail" ? "query"
                : ["view.home", "view.library", "home.undoLeave", "home.undoLeaveCancel", "library.undoLeave", "library.undoLeaveCancel"].contains(c.op) && core.host.pages.leaveUndo != nil ? "leaveUndo"
                : nil
            let unknownHost = regKey.map { (core.host.registered[$0] ?? -1) < c.epoch } ?? false
            // 存相册：平台给页面的结果（相册权限 / 写文件）就是 Swift 宿主的结果（同一次保存，影子里不再存第二遍）
            if c.function == EngineOps.app && c.op == "image.persist" {
                let web = EngineValue.js(c.reply)
                core.host.platformSave = { _ in web["ok"] == .bool(true) ? EngineValue.obj([("ok", .bool(true)), ("via", .string("native"))])
                    : EngineValue.obj([("ok", .bool(false)), ("via", .string("native")), ("reason", web["error"]?["kind"] ?? .string("download"))]) }
            } else { core.host.platformSave = nil }
            collecting = true
            let changedBefore = swiftChanged.count
            let reply = blocking { [core] in await core.answer(function: c.function, op: c.op, args: EngineValue.object(c.args)) }
            collecting = false
            let swiftOwn = disk.writes
            let before = cur
            apply(own)
            guard let reply else { stats.skipped += 1; ok = false; stale = true; skippedCalls.append(c.id); continue }
            // 不比的组照样让 Swift 算一遍：宿主的界面状态（离开撤销、S02 / 查字回调、模式）跟着走
            if skip { ok = false; continue }
            if unknownHost {
                // 不比：它在页面里的提交按「交给 JS 的」算（changed 子序列规则），Swift 的这一次不算
                stats.ops -= 1; stats.skipped += 1; stats.skippedBy["host-unregistered", default: 0] += 1; stale = true
                skippedCalls.append(c.id)
                if regKey == "leaveUndo", EngineValue.js(c.reply)["view"]?["leaveUndo"] == .null { core.host.adoptNoLeaveUndo() }
                let n = swiftChanged.count - changedBefore
                if n > 0 { swiftChanged.removeLast(n) }
                continue
            }
            var diffs: [Diff] = []
            Self.compare(EngineValue.js(c.reply), reply, path: "", root: c.function == EngineOps.write, into: &diffs)
            if !diffs.isEmpty { ok = false; mismatch("reply", c, diffs) }
            // 这个 op 的后态：域键逐键比（前态两边相同 = cur 在这个 op 之前的样子）
            var webOwn: [String: String?] = [:]
            for (k, v) in own { webOwn[k] = .some(v) }
            var stateDiffs: [Diff] = []
            for key in Set(webOwn.keys).union(swiftOwn.keys).filter(Self.isDomainKey).sorted() {
                let w: String? = webOwn[key].map { $0 } ?? before[key]
                let s: String? = swiftOwn[key].map { $0 } ?? before[key]
                if w == s { continue }
                let wv = w.flatMap { try? JSONParser.parse($0) }, sv = s.flatMap { try? JSONParser.parse($0) }
                Self.compare(wv, sv, path: key, root: false, into: &stateDiffs)
            }
            if !stateDiffs.isEmpty { ok = false; stale = true; mismatch("state", c, stateDiffs) }
        }
        core.pinnedNow = nil
        core.store.storage.clearFaults()
        if skip {
            advance(to: g.postSeq)
            coreSeq = -1
            schedulePersist()
            return
        }
        // changed：Swift 推的序列是页面推的序列的子序列，多出来的正好是交给 JS 的 op 的提交（每次提交一批写入、一条 changed）
        // 只比 store 提交的推送；界面状态的推送（'ui'：离开撤销条变了）随宿主的界面状态（见 host-unregistered），不在这一条里
        let skippedIds = Set(skippedCalls)
        let webStore = g.changed.filter { Self.isStorePacket($0) && !skippedIds.contains($0["op"]?.stringValue ?? "") }.map(Self.untag)
        let swiftStore = swiftChanged.filter(Self.isStorePacket)
        if let last = compared.last, webStore != swiftStore {
            ok = false
            mismatch("changed", last, [Diff(path: "changed", web: JSONWriter.stringify(.array(g.changed)), swift: JSONWriter.stringify(.array(swiftChanged)))])
        }
        // 声音
        stats.sounds += g.sounds.count
        if g.sounds != swiftSounds, let last = compared.last {
            ok = false
            mismatch("sound", last, [Diff(path: "sound", web: g.sounds.joined(separator: ","), swift: swiftSounds.joined(separator: ","))])
        }
        advance(to: g.postSeq)
        coreSeq = ok && !stale ? g.postSeq : -1
        schedulePersist()
    }

    static func untag(_ p: JSValue) -> JSValue { var o = p.objectValue ?? JSObject(); o["op"] = nil; return .object(o) }

    static func isStorePacket(_ p: JSValue) -> Bool { (p["domains"]?.arrayValue ?? []).allSatisfy { Schema.domains.contains($0.stringValue ?? "") } }

    static func isSubsequence(_ a: [JSValue], of b: [JSValue]) -> Bool {
        var i = 0
        for x in b where i < a.count && a[i] == x { i += 1 }
        return i == a.count
    }

    private var persistPending = false
    private func schedulePersist() {
        guard !persistPending else { return }
        persistPending = true
        worker.asyncAfter(deadline: .now() + 1) { [weak self] in self?.persistPending = false; self?.persist() }
    }

    private func armFaults(_ f: JSValue) {
        let storage = core.store.storage
        storage.clearFaults()
        for rule in f["fail"]?.arrayValue ?? [] {
            storage.failNextWrite(rule["remaining"]?.numberValue ?? 0, kind: rule["kind"]?.stringValue ?? "generic", matchKey: rule["matchKey"]?.stringValue)
        }
        if let k = f["interruptAfter"]?.numberValue { storage.interruptAfterWrite(k) }
    }

    private func blocking(_ body: @escaping () async -> JSValue) -> JSValue? {
        let done = DispatchSemaphore(value: 0)
        final class Box { var value: JSValue? }
        let box = Box()
        Task.detached { box.value = await body(); done.signal() }
        return done.wait(timeout: .now() + 10) == .success ? box.value : nil
    }

    // MARK: 比对

    struct Diff { let path: String; let web: String; let swift: String }

    static func compare(_ w: JSValue?, _ s: JSValue?, path: String, root: Bool, into diffs: inout [Diff]) {
        if diffs.count >= 6 { return }
        // 规则 3：量测标记
        if s == ShadowMeasure.marker {
            if w == nil || w == .null { return }
            if let arr = w?.arrayValue, arr.allSatisfy({ $0.numberValue != nil }) { return }
            diffs.append(Diff(path: path, web: w.map(JSONWriter.stringify) ?? "undefined", swift: "measured")); return
        }
        // 规则 4：宿主令牌标记
        if case .object(let o)? = s, o["$host"] != nil { return }
        switch (w, s) {
        case (nil, nil): return
        case (.object(let a)?, .object(let b)?):
            for key in Set(a.keys).union(b.keys).sorted() {
                if root && key == "ms" { continue } // 规则 1
                if key == "remainingMs", a[key]?.numberValue != nil, b[key]?.numberValue != nil { continue } // 规则 2
                compare(a[key], b[key], path: path + "." + key, root: false, into: &diffs)
            }
        case (.array(let a)?, .array(let b)?):
            if a.count != b.count { diffs.append(Diff(path: path + ".length", web: "\(a.count)", swift: "\(b.count)")); return }
            for i in 0..<a.count { compare(a[i], b[i], path: path + "[\(i)]", root: false, into: &diffs) }
        default:
            if w != s { diffs.append(Diff(path: path, web: w.map(JSONWriter.stringify).map(Self.clip) ?? "undefined", swift: s.map(JSONWriter.stringify).map(Self.clip) ?? "undefined")) }
        }
    }

    static func clip(_ s: String) -> String { s.count > 300 ? String(s.prefix(300)) + "…" : s }

    // MARK: 结果

    struct Mismatch { let kind: String; let op: String; let args: String; let path: String; let web: String; let swift: String; var group = ""
        var js: JSValue { EngineValue.obj([("kind", .string(kind)), ("op", .string(op)), ("args", .string(args)), ("path", .string(path)), ("web", .string(web)), ("swift", .string(swift)), ("group", .string(group))]) }
    }

    private struct Stats { var ops = 0, groups = 0, mismatches = 0, skipped = 0, unanswered = 0, sounds = 0; var skippedBy: [String: Int] = [:]; var skippedGroups: [String: Int] = [:]; var first: Mismatch?; var recent: [Mismatch] = [] }
    private var stats = Stats()
    private let statsLock = NSLock()
    private var snapshot = Stats()

    private func mismatch(_ kind: String, _ c: Call, _ diffs: [Diff]) {
        let args = ShadowEngine.clip(JSONWriter.stringify(EngineValue.js(c.args)))
        for d in diffs.prefix(3) {
            record(Mismatch(kind: kind, op: (c.function == EngineOps.write ? "write." : "") + c.op, args: args, path: d.path, web: d.web, swift: d.swift, group: currentGroupOps + " | nav: " + core.host.recentNavigations))
        }
    }

    private func record(_ m: Mismatch) {
        stats.mismatches += 1
        if stats.first == nil { stats.first = m }
        stats.recent.append(m)
        if stats.recent.count > 20 { stats.recent.removeFirst() }
        NSLog("SHIZI-SHADOW mismatch %@ %@ %@ web=%@ swift=%@ args=%@", m.kind, m.op, m.path, m.web, m.swift, m.args)
        persist()
    }

    /// 写进 Documents/shadow/<本次启动>.json（verify-native-ui.sh 收集；有 mismatch 就判失败）并供探针读。
    private func persist() {
        statsLock.lock(); snapshot = stats; statsLock.unlock()
        guard let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("shadow") else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let text = JSONWriter.stringify(json(stats, full: true))
        try? text.write(to: dir.appendingPathComponent("\(launch).json"), atomically: true, encoding: .utf8)
    }

    private func json(_ s: Stats, full: Bool) -> JSValue {
        var o = JSObject([("ops", .number(Double(s.ops))), ("groups", .number(Double(s.groups))), ("mismatches", .number(Double(s.mismatches))),
                          ("skipped", .number(Double(s.skipped))), ("unanswered", .number(Double(s.unanswered))), ("sounds", .number(Double(s.sounds))), ("first", s.first?.js ?? .null)])
        if full {
            o["recent"] = .array(s.recent.map(\.js))
            var by = JSObject(); for (k, v) in s.skippedBy.sorted(by: { $0.key < $1.key }) { by[k] = .number(Double(v)) }
            o["skippedBy"] = .object(by)
            var groups = JSObject(); for (k, v) in s.skippedGroups.sorted(by: { $0.value > $1.value }).prefix(15) { groups[k] = .number(Double(v)) }
            o["skippedGroups"] = .object(groups)
        }
        return .object(o)
    }

    /// QA 探针的 shadow 段：{ops, mismatches, first, …}。
    var probe: [String: Any] {
        statsLock.lock(); defer { statsLock.unlock() }
        return EngineValue.dict(json(snapshot, full: false))
    }
}
#endif
