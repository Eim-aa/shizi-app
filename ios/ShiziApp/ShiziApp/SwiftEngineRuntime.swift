import ShiziCore
import UIKit

// B4.5c：SwiftEngine 的库与核心（SwiftEngineCore.swift 的 op 表与宿主之上）。

// MARK: - 库：App 的同一个 SQLite（swift 模式）

/// ShiziCore Store 的原生传输，接到 NativeStoreBridge 的同一条连接（页面 XHR 用的那一个；同表同键同 JSON 值形状，不迁移）。
final class BridgeTransport: NativeTransport {
    func callSync(_ op: String, _ payload: JSObject) throws -> JSObject {
        let reply = NativeStoreBridge.shared.callSync(op, EngineValue.any(.object(payload)) as? [String: Any] ?? [:])
        guard reply["ok"] as? Bool == true else {
            let e = reply["error"] as? [String: Any] ?? [:]
            throw NativeCallError(e["code"] as? String ?? "E_INTERNAL", "\(op): \(e["message"] as? String ?? "failed")", key: e["key"] as? String)
        }
        return EngineValue.object(reply)
    }
}

/// 可重读的镜像后端：别的写入者（JS）改了库之后 reload()，按库里现在的全部行重建镜像（JS 一侧 NativeBackend.reloadRows 的对应物）。
final class ReloadableBackend: KVBackend {
    private let transport: NativeTransport
    private var inner: KVBackend

    init(transport: NativeTransport) {
        self.transport = transport
        inner = NativeMirrorBackend.open(transport)
    }

    func reload() { inner = NativeMirrorBackend.open(transport) }

    func length() throws -> Int { try inner.length() }
    func key(_ index: Int) throws -> String? { try inner.key(index) }
    func getItem(_ key: String) throws -> String? { try inner.getItem(key) }
    func setItem(_ key: String, _ value: String) throws { try inner.setItem(key, value) }
    func removeItem(_ key: String) throws { try inner.removeItem(key) }
    var isTransactional: Bool { inner.isTransactional }
    func applyBatch(_ entries: [(String, String?)]) throws { try inner.applyBatch(entries) }
    var supportsDiag: Bool { inner.supportsDiag }
    func diag(_ entry: JSObject) { inner.diag(entry) }
}

// MARK: - 核心：Store + SessionRuntime + 宿主 + 判断声

final class SwiftEngineCore {
    let store: Store
    let runtime: SessionRuntime
    let host: EngineHost
    /// 这一次 op 的「现在」（影子模式 = WebEngine 那次 op 在 JS 里取到的 now）；nil = 时钟。
    var pinnedNow: Double?
    /// 声音（判断声 j1 三变体轮换：haptics.js COMMIT_FEEDBACK 的声音一列 + sound.js keySound；落款声 s1 见 EngineHost.deps.seal）。
    var onSound: ((String, Double) -> Void)? { get { host.onSound } set { host.onSound = newValue } }
    /// 判断声已经放过几次（sound.js keySound 的轮换计数；影子每组开始时对齐到页面的计数）。
    var judgeCount = 0

    init(backend: KVBackend, clock: @escaping () -> Double, measure: EngineMeasure) {
        let box = NowBox()
        let now: () -> Double = { box.pinned?() ?? clock() }
        store = Store(storage: StoreStorage(backend, now: now), now: now, budgets: Budgets.native.js, dates: Dates(timeZone: .current))
        host = EngineHost(store: store, measure: measure)
        runtime = SessionRuntime(store: store, mathFlavor: .darwin, hooks: host.hooks, writeDependencies: host.deps)
        box.pinned = { [unowned self] in pinnedNow }
        // createAppApi 的 ctx.now：D80 ② 起是 App 时钟（native-stage.js 注入 env.now）= store 的「现在」——hooks.now 不注入（缺省 store.now()）
        _ = store.subscribe { [weak self] _, info in self?.feedback(info) }
    }

    private final class NowBox { var pinned: (() -> Double?)? }

    /// 启动 / 重读：探测 → repair → 读全部键（store.load）。
    @discardableResult func load() -> JSObject { store.load() }

    /// 一个 op（App API 或写字会话）。异步宿主（字源、查字 / S02 回调、存图）走 callAsync。B4.9a：在调用方的执行者上跑（swift 模式 = 主线程：store、导航宿主、UIKit 同一条线程；影子 = 它的后台）。
    nonisolated(nonsending) func answer(function: String, op: String, args: JSObject) async -> JSValue {
        host.currentResult = function == EngineOps.write && op.hasPrefix("result") ? JSObject([("slot", args["slot"] ?? .null), ("sessionId", args["sessionId"] ?? .null)]) : nil
        let reply = await runtime.callAsync(EngineOps.runtimeOp(function: function, op: op), args)
        return function == EngineOps.app && op == "view.mine" ? decorateMine(reply, width: args["width"]?.numberValue) : reply
    }

    /// 「我的」页的折行点（ui/native-stage.js decorateReply → screens/mine/native-view.js decorateMineReply：页面侧在 view.mine 的回包上加 lines）。
    private func decorateMine(_ reply: JSValue, width: Double?) -> JSValue {
        guard reply["ok"] == .bool(true), var view = reply["view"]?.objectValue else { return reply }
        func starts(_ kind: String, _ ref: JSValue?) -> JSValue {
            guard let ref, ref != .null, let text = (try? Copy.tRef(ref))?.stringValue, !text.isEmpty else { return .null }
            return host.measure.lineStarts(kind, text)
        }
        view["lines"] = EngineValue.obj([
            ("note", starts("mine-note", view["sheet"]?["note"])),
            ("failNote", starts("mine-fail-note", view["choiceFail"]?["note"])),
            ("emptyBody", starts("mine-empty-body", view["emptyBlock"]?["body"])),
        ])
        var out = reply.objectValue ?? JSObject()
        out["view"] = .object(view)
        return .object(out)
    }

    /// 页面的 changed 推送（session/api/index.js createChangeFeed 的 Swift 版，同一组脏域规则）；界面状态的（离开撤销条）由宿主推。
    func changeFeed(_ post: @escaping (JSValue) -> Void) -> () -> Void {
        host.onChanged = post
        let off = runtime.changed { post($0) }
        return { [weak self] in off(); self?.host.onChanged = nil }
    }

    // 判断声：COMMIT_FEEDBACK 里有声音的只有 write:judge / write:correct / result:correct（→ judge）；policy.keySoundEvents 里要有 judge
    static let soundLabels: Set<String> = ["write:judge", "write:correct", "result:correct"]
    static let judgeFiles = ["j1_page_settle", "j1_page_settle_b", "j1_page_settle_c"]

    private func feedback(_ info: JSObject) {
        guard info["type"] == .string("commit"), let label = info["label"]?.stringValue, Self.soundLabels.contains(label) else { return }
        guard (Config.policy["keySoundEvents"]?.arrayValue ?? []).contains(.string("judge")) else { return }
        let db = Config.policy["soundGainDb"]?["judge"]?.numberValue ?? 0
        let name = Self.judgeFiles[judgeCount % Self.judgeFiles.count]
        judgeCount += 1
        onSound?(name, pow(10, (db.isFinite ? db : 0) / 20))
    }
}
