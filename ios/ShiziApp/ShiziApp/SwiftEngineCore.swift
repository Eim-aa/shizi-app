import ShiziCore
import UIKit

// B4.5c：SwiftEngine 的核心（计划 B3B4-原生化架构与计划.md §4.2「SwiftEngine: ShiziEngine 把 ShiziCore 的 op 表挂到 B3 的同一个协议上」）。
//
// 一份代码两种用法：
//   · swift 模式（SwiftEngine.swift）：Store 接 App 的同一个 SQLite 库（NativeStoreBridge 的同一条连接，同表同键同值形状，不迁移），在主线程答页面；
//   · shadow 模式（ShadowEngine.swift，只在 DEBUG）：Store 接内存里的库副本（每个 op 的前态 = WebEngine 那次 op 的前态），在后台线程重算后比对。
// 哪些 op 由 Swift 答、哪些交 JS，只有 EngineOps 一张表；宿主函数（导航、平台、排版量测）在 EngineHost 里，两种模式同一份。

// MARK: - 值：WebKit 边界的 [String: Any] ⇄ ShiziCore 的 JSValue

enum EngineValue {
    static func js(_ any: Any?) -> JSValue {
        guard let any else { return .null }
        switch any {
        case is NSNull: return .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return .number(n.doubleValue)
        case let s as String: return .string(s)
        case let a as [Any]: return .array(a.map { js($0) })
        case let d as [String: Any]:
            var o = JSObject()
            for k in d.keys.sorted() { o[k] = js(d[k]) }
            return .object(o)
        case let b as Bool: return .bool(b)
        case let i as Int: return .number(Double(i))
        case let x as Double: return .number(x)
        case let x as CGFloat: return .number(Double(x))
        default: return .null
        }
    }

    static func object(_ d: [String: Any]) -> JSObject { js(d).objectValue ?? JSObject() }

    static func any(_ v: JSValue) -> Any {
        switch v {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let d): return d.rounded() == d && abs(d) < 9e15 ? NSNumber(value: Int64(d)) : NSNumber(value: d)
        case .string(let s): return s
        case .array(let a): return a.map { any($0) }
        case .object(let o):
            var out: [String: Any] = [:]
            for (k, x) in o.entries { out[k] = any(x) }
            return out
        }
    }

    static func dict(_ v: JSValue) -> [String: Any] { any(v) as? [String: Any] ?? ["ok": false, "error": ["kind": "invalid-reply"]] }

    static func obj(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
    static func failure(_ kind: String) -> JSValue { obj([("ok", .bool(false)), ("error", obj([("kind", .string(kind))]))]) }
}

// MARK: - op 表：谁来答

/// 引擎边界上的三个 JS 函数与每个 op 的去处（一张表，swift 与 shadow 两种模式共用）。
enum EngineOps {
    static let app = "shiziNative"
    static let write = "shiziNativeWrite"
    static let nav = "shiziNativeNav"

    /// 只有 JS 有的 op（Swift 不答，影子不比；swift 模式照旧交页面）：
    ///   · shiziNativeNav 全部：B2.8 导航助手（back / cover / fence），只管网页界面层，不写 store；
    ///   · route.save / route.plan / deeplink.reminder / stage.enter / stage.resync：B3.F 的栈记账与冷启动判定（守卫、过期、深链、坏值、阻断优先、
    ///     宿主消息 hostBodies）在 JS 的 ui/engine.js、route-memory.js——是界面层规则，B4.8 / B4.9 原生化前交 JS；
    ///   · stage.cover / stage.fence / stage.under：网页界面层的截图与帧同步；
    ///   · nav.*：B3.F 起在原生侧由 NativeStage 直接做（WebEngine.navigator），根本不到引擎；
    ///   · image.render / image.save：画图是 B4.6 的原生渲染器（WebEngine.nativeImage），只在显式 webRenderer 时才到 JS；
    ///     它们用的 image.spec / image.persist 记账由 Swift 答。
    static let jsOnlyApp: Set<String> = ["route.save", "route.plan", "deeplink.reminder", "stage.enter", "stage.resync", "stage.cover", "stage.fence", "stage.under",
                                         "image.render", "image.save"]

    /// Swift 已移植了规则、但 op 的另一半是 JS 界面层的导航或界面状态（开组后推入写字页、S02、离开撤销条、查字弹层模式、结果页跳转、提醒权限往返）：
    /// 影子模式里 Swift 用同一组宿主函数（导航只记下、界面状态照 JS 维护）算回包与后态并比对；swift 模式里这些 op 仍交 JS 做，
    /// 做完 Swift 重读库（SwiftEngine.reloadAfterPage）——B4.8 把导航宿主原生化后从这张表里拿掉。
    static let hostApp: Set<String> = [
        "view.home", "view.library", "view.query", "view.s02", "view.session-none",
        "home.start", "home.resumeOther", "home.deferSpecial", "home.switchLibrary", "home.pick", "home.source", "home.undoLeave", "home.undoLeaveCancel",
        "library.startToday", "library.openQuery", "library.undoLeave", "library.undoLeaveCancel", "library.list.start", "library.all.start", "library.switch",
        "detail.practice", "detail.image", "session.pick", "session.libSwitch", "session.wrongList",
        "query.pick", "query.detail", "s02.decide", "image.view", "image.add", "image.closed",
        // 阻断页：存储可不可用 / 有没有阻断由页面的 store 报（引擎状态通道），阻断页的 op 跟它同一个来源
        "block.retry", "block.export", "block.exportable",
        // 存相册的平台握手（JS saveImageFile → savePracticeCard → shiziCardSaved）还在页面桥上；记账规则 Swift 有（影子里比）
        "image.persist",
    ]
    static let hostWrite: Set<String> = ["exit", "redoExit", "resultExit", "resultAgain", "resultUndoSkip", "resultCell", "resultSealed", "resultInvite", "open", "redoOpen", "resultLook"]

    /// 这个调用有没有 Swift 的实现（影子比对的范围 = 这些）。
    static func swiftImplements(function: String, op: String) -> Bool {
        if function == write { return true }
        if function != app { return false }
        if op.hasPrefix("nav.") { return false }
        return !jsOnlyApp.contains(op)
    }

    /// swift 模式里由 Swift 直接答的：B4.9a 起 Swift 实现了的全部 op（导航宿主与界面状态也在 Swift：EngineHost + SwiftNavigator）；
    /// 栈往来（jsOnlyApp 里的 route.* / stage.* / deeplink.reminder 与 shiziNativeNav）由 SwiftNavigator 先答，不到这里；
    /// 只剩显式 webRenderer（或原生渲染失败）的 image.render / save 交页面（B4.6 的回退）。hostApp / hostWrite 只给影子模式划范围。
    static func swiftAnswers(function: String, op: String) -> Bool {
        swiftImplements(function: function, op: op)
    }

    /// SessionRuntime 的 op 名（写字会话前缀 write.）。
    static func runtimeOp(function: String, op: String) -> String { function == write ? "write." + op : op }
}

// MARK: - 宿主（导航、平台、量测、界面状态）

/// JS 一侧这些由界面层注入（ui/screens/*、ui/images-entry.js、ui/screens/write/native-session.js、ui/native-stage.js）；
/// 这里是同一组函数的原生版。导航只记进 navigations（swift 模式里会导航的 op 本来就交 JS，见 EngineOps.hostApp）。
final class EngineHost {
    let store: Store
    let hooks = SessionActionHooks()
    let deps = WriteDependencies()
    let pages: PageRegisteredActions
    let images: ImageRegisteredActions
    /// 宿主导航的记录（op 名 + 参数），只供诊断。
    private(set) var navigations: [String] = []
    /// 量测：swift 模式原生量（NativeLineMeasure）；影子模式给标记（比对规则见 ShadowEngine.Compare）。
    let measure: EngineMeasure
    /// 不是 store 提交的 changed（界面状态）：离开撤销条变了（write/skip.js emitLeaveUndo）→ 首页、字库两个订阅者各推一次
    /// {domains:['ui'], label:'leave-undo'}（ui/screens/home/index.js、library/index.js 的 onLeaveUndo），原生首页 / 字库重拉视图。
    var onChanged: ((JSValue) -> Void)?
    private func emitLeaveUndo() {
        for _ in 0..<2 { onChanged?(EngineValue.obj([("domains", .array([.string("ui")])), ("label", .string("leave-undo"))])) }
    }
    private func handoffLeaveUndo(_ value: JSValue?) {
        pages.handoffLeaveUndo(value)
        registered["leaveUndo"] = epoch
        emitLeaveUndo()
    }
    /// 影子：页面上的离开撤销条说不清时（见 ShadowEngine host-unregistered），按页面回包看到的「没有」对齐（不推 changed）。
    func adoptNoLeaveUndo() { pages.clearLeaveUndo(); registered["leaveUndo"] = epoch }

    /// B4.9a：缺省模式的导航者（「去哪」的规则真正改栈、发宿主消息）；影子模式没有（导航只记进 navigations）。
    weak var navigator: SwiftNavigator?
    /// 离开撤销条的「撤销」正在开写字页（skip.js undoLeave 用 nav.push，不是 openWrite）。
    private var undoing = false

    /// 存相册的平台结果（影子：页面那次实际拿到的结果；swift 模式里 image.persist 走 WebViewController 的同一个保存）。
    var platformSave: ((JSValue) -> JSValue)?

    /// 声音事件（文件名、增益）：判断声 j1 轮换（SwiftEngineCore）与落款声 s1。
    var onSound: ((String, Double) -> Void)?
    private var sealed = Set<String>()
    /// 界面时钟（JS performance.now 的对应物：离开撤销 / 跳过撤销的剩余时间）。
    var clockNow: () -> Double = { CACurrentMediaTime() * 1000 }

    init(store: Store, measure: EngineMeasure) {
        self.store = store
        self.measure = measure
        pages = PageRegisteredActions(store: store)
        images = ImageRegisteredActions(store: store)
        install()
    }

    private func nav(_ what: String, _ arg: JSValue = .null) {
        navigations.append(what + " " + JSONWriter.stringify(arg))
        if navigations.count > 40 { navigations.removeFirst(navigations.count - 40) }
    }

    private func install() {
        // 首页 / 字库 / S02 的登记动作（ui/screens/home、library、session）：存储一半是 ShiziCore，导航交 open
        pages.clockNow = { [unowned self] in clockNow() }
        pages.open = { [unowned self] kind, params in
            nav("open:" + kind, params)
            if kind == "query" { openQuery(mode: params["mode"]?.stringValue ?? "lookup") }
            guard let n = navigator else { return }
            switch kind {
            case "write":
                if undoing { try n.push("write", .object(JSObject([("slot", params["slot"] ?? .null)]))) } // undoLeave(slot => nav.push('write', {slot}))
                else {
                    if params["s02"] == .string("continue") { n.markOverlayTap() } // S02「继续写那组」：弹层里的点按（s02.js overlayTapped）
                    try n.openWrite(params["slot"]?.stringValue ?? "A")
                }
            case "session-none": try n.openNone(params["exhausted"])
            case "s02": try n.openS02(params)
            case "s02-close": n.closeTop("s02"); n.markOverlayTap()
            case "library-switch": try n.openLibrarySwitch()
            case "query": try n.openQuery(params["mode"]?.stringValue ?? "lookup")
            default: break
            }
        }
        // 原生入口此刻的位置与字（home/index.js setHomeActions source → setNativeLiveSource）
        pages.paperSource = { [unowned self] kind, a in
            nav("paper:" + kind, .object(a))
            guard kind == "source", let n = navigator else { return }
            let key = a["key"]?.stringValue ?? ""
            let rect = a["rect"] ?? .null
            let live: JSValue? = rect.isNull || rect == .bool(false) ? nil : .object(JSObject([("rect", rect), ("label", a["label"] ?? .null)]))
            n.setLive(["other-line", "home-capital-defer"].contains(key) ? key : "home-start", live)
        }
        pages.install(on: hooks)
        // 首页主按钮 / 「接着写」/「这次先写平常的字」、字库「今日练习」：原生量的被点元素记成写字页的来源（D62；home/index.js withNativeSource、library/index.js startToday）
        for (op, key) in [("home.start", "home-start"), ("home.resumeOther", "other-line"), ("home.deferSpecial", "home-capital-defer"), ("library.startToday", "library-today")] {
            hooks.set(op) { [unowned self] a in
                navigator?.markSource(a["source"], key: key)
                return try pages.call(op, a)
            }
        }
        // 离开撤销条的「撤销」/「先不保存」：skip.js undoLeave（有机会时结束或标失败，各推一次）/ clearLeaveUndo（总推一次）
        for op in ["home.undoLeave", "library.undoLeave"] {
            hooks.set(op) { [unowned self] a in
                let had = pages.leaveUndo != nil
                undoing = true
                defer { undoing = false }
                let r = try pages.call(op, a)
                if had { registered["leaveUndo"] = epoch; emitLeaveUndo() }
                return r
            }
        }
        for op in ["home.undoLeaveCancel", "library.undoLeaveCancel"] {
            hooks.set(op) { [unowned self] a in
                let r = try pages.call(op, a)
                registered["leaveUndo"] = epoch
                emitLeaveUndo()
                return r
            }
        }
        // 「现在没有要写的字」三个入口（JS 无条件登记）
        for op in ["session.pick", "session.libSwitch", "session.wrongList"] {
            hooks.set(op) { [unowned self] _ in
                nav(op)
                if op == "session.pick" { openQuery(mode: "pick"); try navigator?.openQuery("pick") } // home/index.js setNoneActions pick → openPick
                if op == "session.libSwitch" { try navigator?.openLibrarySwitch() } // library/switch.js setNoneActions libSwitch
                if op == "session.wrongList" { try navigator?.replace("library-list", .object(JSObject([("kind", .string("due"))]))) } // library/list.js wrongList
                return .null
            }
        }
        // 字详情：练这个字（startPicked）、做成图片（打开预览）
        hooks.set("detail.practice") { [unowned self] a in try startPicked(a["chars"]?.arrayValue ?? [], source: a["source"] ?? .null) }
        hooks.set("detail.image") { [unowned self] a in
            nav("detail.image", .object(a))
            navigator?.openImagePreview(JSObject([("kind", .string("glyph")), ("char", a["char"] ?? .null)])) // images-entry.js openGlyphImage
            return .null
        }
        // 图片：palette = tokens 的浅色一套（core/images/palette.js：导出图恒为浅纸，无纹理）；存相册是平台，影子里不真存
        images.palette = { Self.palette }
        images.saveFile = { [unowned self] file in
            nav("image.save", file["name"] ?? .null)
            return platformSave?(file) ?? EngineValue.obj([("ok", .bool(true)), ("via", .string("native"))])
        }
        images.post = { [unowned self] msg in
            nav("image.post", msg)
            if let n = navigator, let o = msg.objectValue { n.post(o) } // closeNativePreview：收掉这条原生屏（网页栈里没有这一层）
        }
        images.thumb = { [unowned self] _ in measure.host("thumb") } // 选字条的缩略图是渲染器画的位图（images-entry.js）
        images.install(on: hooks)
        // 环境
        hooks.native = true
        hooks.build = { Self.build }
        hooks.charData = EtymologyProvider { Self.etymologyRows() }
        hooks.measurer = { [unowned self] spec in measure.measure(spec) }
        hooks.lineBreaker = { [unowned self] kind, text in measure.lineStarts(kind, text) }
        // 备份页 / 提醒页的折行点（session/text-lines.js 的登记表；网页由 ui/screens/mine/backup.js、remind.js 登记）
        for key in ["backup.intro", "backup.confirmBody", "remind.sub"] {
            SessionTextLines.shared.register(key) { [unowned self] text, _ in measure.lineStarts(key, text) }
        }
        // 全部字 / 清单的版式量测（library-sub.js setLibrarySubMeasure：组头高、pretty 段落折行点、页头文字按钮宽——网页 DOM 量的）
        for name in ["measure.list", "measure.all"] { hooks.set(name) { [unowned self] _ in measure.host("metrics") } }
        hooks.queryLayout = ["s02Body": { [unowned self] text in measure.lineStarts("s02-body", text) },
                             "cardAction": { [unowned self] text in measure.lineStarts("card-action", text) }]
        // 写字会话（native-session.js createWriteSessionApi 的 deps）
        deps.groups = .object(DeckData.shared.groups)
        deps.colors = { [unowned self] in measure.host("colors") }
        deps.type = { [unowned self] in measure.host("type") }
        deps.theme = { [unowned self] in measure.host("theme") }
        deps.refLabel = { a in Self.refLabel(char: a["char"]?.stringValue ?? "", cardKey: a["cardKey"]?.stringValue) }
        // now = 界面单调时钟（跳过撤销的 until 用它；result/native-view.js resultView 的 clockNow）
        deps.resultView = { [unowned self] store, a in try ResultPageView.view(store, a, now: clockNow(), shareAvailable: true) }
        deps.navigate = [
            // 跳过的撤销条还在时离开：剩余的撤销机会交给来源页（S4，write/skip.js handoffLeaveUndo）
            "back": { [unowned self] args in
                let slot = args.first ?? .null, undo = args.count > 1 ? args[1] : .null
                if var u = undo.objectValue {
                    u["slot"] = slot
                    u["until"] = .number(clockNow() + (u["remainingMs"]?.numberValue ?? 0))
                    handoffLeaveUndo(.object(u))
                } else { handoffLeaveUndo(nil) }
                nav("write.back", slot)
                navigator?.writeBack()
                return .null
            },
            "toResult": { [unowned self] args in
                nav("write.toResult", .array(args))
                try navigator?.writeToResult(args.first ?? .null, args.count > 1 ? args[1] : .null, args.count > 2 ? args[2] : nil)
                return .null
            },
            "toDetail": { [unowned self] args in
                nav("write.toDetail", .array(args))
                if let n = navigator { return .bool(try n.writeToDetail(args.count > 1 ? args[1] : nil)) }
                return .bool(true)
            },
            "redoBack": { [unowned self] _ in nav("write.redoBack"); navigator?.redoBack(); return .null },
        ]
        // 落款声 s1（sound.js keySound('seal', {key})：同一个 key 只响一次）
        deps.seal = { [unowned self] key in
            nav("result.seal", .string(key))
            guard !sealed.contains(key), (Config.policy["keySoundEvents"]?.arrayValue ?? []).contains(.string("seal")) else { return }
            sealed.insert(key)
            let db = Config.policy["soundGainDb"]?["seal"]?.numberValue ?? 0
            onSound?("s1_wood_muted", pow(10, (db.isFinite ? db : 0) / 20))
        }
        // 结果条目被移出页面栈（离开 / 再写一组 / 撤销跳过换回写字页）→ 清 lastEnded[slot]（01 §3.3；JS 由引擎路由的宿主消息
        // native-session.js resultCloseBody 在同一次导航里同步提交 result:leave）
        // 真导航（缺省模式）：结果条目离栈时的 commitLeave 由宿主消息 resultCloseBody 做（HostBodies），这里不再替它清
        deps.toWrite = { [unowned self] slot in
            nav("result.toWrite", .string(slot))
            if let n = navigator { try n.resultToWrite(.string(slot)) } else { leaveResult() }
        }
        deps.again = { [unowned self] r in
            nav("result.again", r)
            if let n = navigator { try n.resultAgain(r) } else { leaveResult() }
        }
        deps.leave = { [unowned self] l in
            nav("result.leave", l)
            if let n = navigator { try n.leaveTo(l) } else { leaveResult() }
        }
        deps.redo = { [unowned self] chars in
            nav("result.redo", .array(chars))
            if let n = navigator { return .bool(try n.resultRedo(chars)) }
            return .bool(!chars.isEmpty)
        }
        deps.detail = { [unowned self] char in
            nav("result.detail", .string(char))
            if let n = navigator { return .bool(try n.openCharDetail(char)) }
            return .bool(true)
        }
        deps.share = { [unowned self] a in
            nav("result.share", .object(a))
            var scope = JSObject([("kind", .string("session"))])
            scope["slot"] = a["slot"]; scope["sessionId"] = a["sessionId"]
            navigator?.openImagePreview(scope) // images-entry.js openSessionImage
            return .bool(true)
        }
    }

    /// 宿主登记（查字 / S02 回调）是在哪个时刻登记的（影子：登记之后页面里又跑过 Swift 看不见的脚本 / 只交 JS 的 op，就说不清页面现在登记的是什么）。
    var epoch = 0
    private(set) var registered: [String: Int] = [:]

    /// 影子：页面重载后 JS 的界面层状态从头来（sound.js 的落款 key 集合）。
    func resetPageState() { sealed.removeAll() }

    /// 正在答的结果页 op 的 {slot, sessionId}（SwiftEngineCore.answer 设）。
    var currentResult: JSObject?
    private func leaveResult() {
        guard let r = currentResult else { return }
        _ = SessionResults.leave(store, r)
    }

    /// 最近的宿主导航（诊断）。
    var recentNavigations: String { navigations.suffix(4).joined(separator: " ; ") }

    /// 查字弹层打开时登记的回调（components/query/index.js openQuery）：
    ///   pick（首页「自己选字」、没字可写页，home/index.js openPick）→ onPick = pickAndStart（旧 B 没写完：先关弹层、弹 S02；否则开组，成功才关弹层、开写字页）；
    ///   lookup（字库「查字」，library/query-entry.js）→ onPractice = 开 B 组（来源 library，弹层不关）、onDetail = 推字详情；没有 onPick。
    private func openQuery(mode: String) {
        registered["query"] = epoch
        hooks.queryMode = mode
        // 先关弹层（查字屏出栈）再开写字页；出栈作废了记下的点按，关完再记一次（components/query/index.js close）
        hooks.queryClose = { [unowned self] in nav("query.close"); navigator?.closeTop("query"); navigator?.markOverlayTap() }
        let home = EngineValue.obj([("view", .string("home"))]), library = EngineValue.obj([("view", .string("library"))])
        if mode == "pick" {
            hooks.queryPick = { [unowned self] chars, ctx in
                navigator?.markOverlayTap() // overlayTapped(onPick)
                let keys = chars.map { JSValue.string($0) }
                if !ScheduleRules.s02Data(.object(store.state)).isNull { try ctx.close(); return try startPicked(keys, source: home) }
                let r: JSValue
                do { r = try ScheduleRules(dates: store.dates).startPicked(store, keys: keys, source: home, deck: .real) }
                catch { return EngineValue.obj([("ok", .bool(false)), ("error", EngineValue.obj([("kind", .string("invalid")), ("reason", .string(String(describing: error)))]))]) }
                if r["ok"] != .bool(true) { return r }
                try ctx.close()
                if r["started"] == .bool(true) { nav("open:write", .string("B")); try navigator?.openWrite("B"); return EngineValue.obj([("ok", .bool(true)), ("opened", .string("new"))]) }
                return try startPicked(keys, source: home)
            }
            hooks.queryPractice = nil
            hooks.queryDetail = nil
        } else {
            hooks.queryPick = nil
            hooks.queryPractice = { [unowned self] char, _ in navigator?.markOverlayTap(); return try startPicked([.string(char)], source: library) }
            hooks.queryDetail = { [unowned self] char, _ in nav("query.detail", .string(char)); try navigator?.openCharDetail(char); return .null }
        }
    }

    /// ui/screens/session/index.js startPicked：开 B 组（写字页）或弹 S02（登记 S02 的四个回调）。
    func startPicked(_ keys: [JSValue], source: JSValue) throws -> JSValue {
        let rules = ScheduleRules(dates: store.dates)
        let src: JSValue = source.isNull ? EngineValue.obj([("view", .string("home"))]) : source
        let r: JSValue
        do { r = try rules.startPicked(store, keys: keys, source: src, deck: .real) } catch {
            return EngineValue.obj([("ok", .bool(false)), ("error", EngineValue.obj([("kind", .string("invalid")), ("reason", .string(String(describing: error)))]))])
        }
        if r["ok"] != .bool(true) { return r }
        if r["started"] == .bool(true) {
            nav("open:write", .string("B"))
            try navigator?.openWrite("B")
            return Self.patch(r, [("opened", .string("new"))])
        }
        let queue = r["queue"]?.arrayValue ?? keys
        registered["s02"] = epoch
        hooks.s02Registered = true
        hooks.s02Cancel = nil
        // session/s02.js openS02 的原生分支：关框（出栈）再记一次弹层点按；两个开写字页的键记成弹层里的入口（D62 普通推入）
        hooks.s02Close = { [unowned self] in nav("s02.close"); navigator?.closeTop("s02"); navigator?.markOverlayTap() }
        hooks.s02Continue = { [unowned self] in nav("open:write", .string("B")); navigator?.markOverlayTap(); try navigator?.openWrite("B") }
        hooks.s02EndStart = { [unowned self] in
            navigator?.markOverlayTap()
            return try ScheduleRules(dates: store.dates).endOldAndStartPicked(store, keys: queue, source: src, deck: .real)
        }
        hooks.s02Started = { [unowned self] _ in nav("open:write", .string("B")); try navigator?.openWrite("B") }
        nav("open:s02", r["s02"] ?? .null)
        try navigator?.openS02(r["s02"])
        return Self.patch(r, [("opened", .string("s02"))])
    }

    static func patch(_ v: JSValue, _ pairs: [(String, JSValue)]) -> JSValue {
        var o = v.objectValue ?? JSObject()
        for (k, x) in pairs { o[k] = x }
        return .object(o)
    }

    // MARK: 静态资源（包里 Web/ 的同一批文件：JS 读的就是它们）

    static let webRoot: URL? = Bundle.main.url(forResource: "Web", withExtension: nil)

    /// 关于页的版本行（ui/screens/mine/about.js aboutBuild：src/build-info.js 的 VERSION / BUILD；QA 里钉住，同 NativeSmoke 注入的 __shiziQABuild）。
    static var build: JSValue {
        #if DEBUG
        if WebViewController.qaEnabled { return EngineValue.obj([("version", .string("1.0.0")), ("build", .string("20261001-000000000000"))]) }
        #endif
        return bundledBuild
    }

    static let bundledBuild: JSValue = {
        var version = "", build = ""
        if let url = webRoot?.appendingPathComponent("src/build-info.js"), let text = try? String(contentsOf: url, encoding: .utf8) {
            func constant(_ name: String) -> String {
                guard let r = text.range(of: "export const \(name) = '") else { return "" }
                let rest = text[r.upperBound...]
                return String(rest.prefix { $0 != "'" })
            }
            version = constant("VERSION"); build = constant("BUILD")
        }
        return EngineValue.obj([("version", .string(version)), ("build", .string(build))])
    }()

    /// data/etymology.json（data/etymology.js loadEtymology 读的同一个文件）。
    static func etymologyRows() -> JSValue? {
        guard let url = webRoot?.appendingPathComponent("data/etymology.json"), let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return try? JSONParser.parse(text)
    }

    /// 导出图调色板（palette.js PALETTE_VARS ← tokens 的 color.light；textures 恒空、tiles = [240]）。
    static let palette: JSValue = {
        let light = ShiziTokens.colorStrings(.light)
        let keys: [(String, String)] = [("paper", "paper"), ("sheet", "sheet"), ("line", "line"), ("frame", "frame"), ("guide", "guide"), ("ink1", "ink1"), ("ink2", "ink2"), ("ink3", "ink3"),
                                        ("hand", "hand"), ("ref", "ref"), ("under", "under"), ("zhu", "zhu"), ("seal", "seal"), ("onSeal", "on-seal")]
        var o = JSObject()
        for (k, token) in keys { o[k] = .string(light[token] ?? "") }
        o["textures"] = .array([])
        o["tiles"] = .array([.number(240)])
        return .object(o)
    }()

    /// 参考字形的读屏名称（ui/screens/write/ref-label.js refCardLabel：字、拼音、笔画数、结构 / 部件数）。
    static func refLabel(char: String, cardKey: String?) -> JSValue {
        let py = cardKey.flatMap { DeckCards.shared.cardForKey($0)?["py"]?.stringValue }?.trimmingCharacters(in: .whitespaces) ?? ""
        func t(_ key: String, _ vars: [(String, JSValue)]) -> JSValue { (try? Copy.t(key, JSObject(vars))) ?? .string("") }
        if py.isEmpty { return t("R-W09.refCardLabelChar", [("char", .string(char))]) }
        let data = strokeData(char)
        let n = data?["strokes"]?.arrayValue?.count ?? 0
        let base = n > 0 ? t("R-W09.refCardLabel", [("char", .string(char)), ("pinyin", .string(py)), ("n", .number(Double(n)))])
                         : t("R-W09.refCardLabelNoCount", [("char", .string(char)), ("pinyin", .string(py))])
        var extra = ""
        if n > 0, let medians = data?["medians"], medians.arrayValue != nil {
            let info = Structure.describeStructure(groups: SessionHints.groupsFor(.string(char), table: .object(DeckData.shared.groups)), medians: medians)
            if info["structure"] == .string("lr") { extra = (try? Copy.text("X-JUDGE.refStructureLr")) ?? "" }
            else if info["structure"] == .string("tb") { extra = (try? Copy.text("X-JUDGE.refStructureTb")) ?? "" }
            else if let parts = info["parts"], parts != .null, parts != .number(0), parts != .bool(false) { extra = (try? Copy.text("X-JUDGE.refParts", JSObject([("n", parts)]))) ?? "" }
        }
        return extra.isEmpty ? base : t("X-JUDGE.refCardLabelPlus", [("base", base), ("extra", .string(extra))])
    }

    static func strokeData(_ char: String) -> JSValue? {
        guard !char.isEmpty, let url = webRoot?.appendingPathComponent("data/\(char).json"), let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return try? JSONParser.parse(text)
    }
}

// MARK: - 排版量测（折行点等）：页面的字体与宽度

/// B4.5a/b 留下的注入口：折行点（core/line-starts.js lineStarts kind）、段落量测（session/views/lines.js measureLines variant）、
/// 查字 / S02 的折行（query.js setQueryLayout）、写字页的颜色 / 字阶令牌（native-session.js colorBundle / typeBundle / themeOf）。
/// JS 由网页 DOM 量；原生页本来就按原生字体排，所以 swift 模式由原生量（NativeLineMeasure）。
protocol EngineMeasure: AnyObject {
    func lineStarts(_ kind: String, _ text: String) -> JSValue
    func measure(_ spec: JSValue) -> JSValue
    /// 写字页的令牌包（colors / type / theme）。
    func host(_ name: String) -> JSValue
}
