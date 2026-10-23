import QuartzCore
import UIKit
import WebKit

// ShiziKit（B3.2；计划 B3B4-原生化架构与计划.md §3.4）：原生页面与规则 / 数据之间唯一的边界。
//
// 原生页面不持有业务状态，只认这里的协议：每个 op 的回包都有 Codable 类型（AboutView …），B3 的实现 WebEngine 经 callAsyncJavaScript 调页面里的
// App API（window.shiziNative，src/session/api/index.js），B4 换成 Swift 写的 SwiftEngine 实现同一组 op——页面一行不改。
// 订阅：changes（store 每次成功提交后一个 ShiziChangeSet，带脏域）；status：ready / blocked(原因) / reloading（WebContent 重启、页面重载）。

/// 引擎状态（§3.4「引擎不可用」）：reloading 时原生页留在屏上、按钮暂不可点；重新 ready 后各页重拉视图。
enum ShiziEngineStatus: Equatable {
    case ready
    case blocked(String)
    case reloading

    var isReady: Bool { self == .ready }
}

/// 一次成功提交动过的域（store DOMAINS 的子集；load / 整体替换 = 全部域）。
struct ShiziChangeSet: Equatable {
    let domains: [String]
    let label: String?

    func touches(_ any: [String]) -> Bool { any.contains { domains.contains($0) } }
}

enum ShiziEngineError: Error, Equatable {
    /// 回包 {ok:false, error:{kind}}（D07：原生就地三段式）。
    case failed(String)
    /// 桥没通（WebView 不在 / JS 抛错 / 回包不是对象）。
    case transport(String)
    /// 回包形状与 Codable 类型对不上。
    case decode(String)
}

/// 没有参数的 op。
struct ShiziNoArgs: Encodable {}

/// 视图 op 的回包（{ok, view}）。
struct ShiziViewReply<V: Decodable>: Decodable {
    let view: V
}

protocol ShiziEngine: AnyObject {
    var status: ShiziEngineStatus { get }
    /// 每次取一个新的订阅流（多个页面可以各自订阅）。
    var changes: AsyncStream<ShiziChangeSet> { get }
    /// 调一个 op，回包解成 R（{ok:false} → .failed(kind)）。
    @MainActor func call<A: Encodable, R: Decodable>(_ op: String, _ args: A, as: R.Type) async throws -> R
    /// 不解码的调用（导航这类只看 ok 的 op；B2 页面的字典回包）。主线程上发（WKWebView 只能在主线程调）。
    @MainActor func raw(_ op: String, _ args: [String: Any]) async -> [String: Any]
}

extension ShiziEngine {
    @MainActor func call<R: Decodable>(_ op: String, as type: R.Type) async throws -> R {
        try await call(op, ShiziNoArgs(), as: type)
    }

    /// 视图 op：view.<屏名> → V。
    @MainActor func view<V: Decodable>(_ screen: String, params: [String: Any] = [:], as: V.Type) async throws -> V {
        let body = await raw("view.\(screen)", params)
        return try ShiziDecode.reply(body, as: ShiziViewReply<V>.self).view
    }
}

/// 字典回包 → Codable（JSONSerialization 往返；数字 / 布尔照 JSON）。
enum ShiziDecode {
    static func reply<R: Decodable>(_ body: [String: Any], as: R.Type) throws -> R {
        if (body["ok"] as? Bool) != true {
            let kind = (body["error"] as? [String: Any])?["kind"] as? String ?? "transport"
            throw ShiziEngineError.failed(kind)
        }
        return try value(body, as: R.self)
    }

    static func value<R: Decodable>(_ any: Any, as: R.Type) throws -> R {
        guard JSONSerialization.isValidJSONObject(any) || any is [Any] || any is [String: Any] else { throw ShiziEngineError.decode("not JSON") }
        do {
            let data = try JSONSerialization.data(withJSONObject: any, options: [.fragmentsAllowed])
            return try JSONDecoder().decode(R.self, from: data)
        } catch let e as ShiziEngineError {
            throw e
        } catch {
            throw ShiziEngineError.decode(String(describing: error))
        }
    }

    /// Encodable 参数 → 页面能收的字典（callAsyncJavaScript 按值传）。
    static func args<A: Encodable>(_ a: A) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(a), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}

// MARK: - 文案引用（视图模型给键 + 参数，B3.4；src/config/copy ref / tRef 的原生版）

/// {copy: 键, params?: {名: 字符串 | 数字 | 引用}} → ShiziCopy 渲染（参数里的引用先展开，同 tRef）。
struct ShiziCopyRef: Decodable, Equatable {
    let copy: String
    let params: [String: Param]?

    enum Param: Decodable, Equatable {
        case text(String)
        case number(Double)
        indirect case ref(ShiziCopyRef)

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .text(s); return }
            if let d = try? c.decode(Double.self) { self = .number(d); return }
            self = .ref(try c.decode(ShiziCopyRef.self))
        }

        var text: String {
            switch self {
            case .text(let s): return s
            case .number(let d): return d.rounded() == d && abs(d) < 1e15 ? String(Int64(d)) : String(d)
            case .ref(let r): return r.text
            }
        }
    }

    init(copy: String, params: [String: Param]? = nil) {
        self.copy = copy
        self.params = params
    }

    private var vars: [String: CustomStringConvertible] { (params ?? [:]).mapValues { $0.text } }

    /// 单串文案（多行文案取各行以换行连接）。
    var text: String { lines.joined(separator: "\n") }

    /// 多行文案（数组值）逐行；单串 = 一行。
    var lines: [String] { ShiziCopy.lines(copy, vars) }
}

// MARK: - WebEngine（B3：WKWebView 里的 App API）

/// B2 NativeWriteBridge 的推广：同一条 callAsyncJavaScript 队列（参数按值传，调用按发出顺序执行），函数名可换——
/// shiziNative（App API）、shiziNativeWrite（写字 / 结果会话，B2 页面）、shiziNativeNav（B2 导航助手）。
final class WebEngine: ShiziEngine {
    weak var webView: WKWebView?
    private(set) var status: ShiziEngineStatus = .reloading
    private var subscribers: [UUID: AsyncStream<ShiziChangeSet>.Continuation] = [:]
    private var statusObservers: [UUID: (ShiziEngineStatus) -> Void] = [:]

    init(webView: WKWebView?) {
        self.webView = webView
    }

    // MARK: 调用

    /// 页面里的一个全局函数（window.<fn>(op, args)）。webView 不在 / JS 抛错 / 回包不是对象 → {ok:false, error:{kind:'transport'}}。
    static func evaluate(_ webView: WKWebView?, function: String, op: String, args: [String: Any], completion: @escaping ([String: Any], Double) -> Void) {
        let t0 = CACurrentMediaTime()
        guard let webView else {
            completion(["ok": false, "error": ["kind": "transport"]], 0)
            return
        }
        webView.callAsyncJavaScript(
            "if (typeof window.\(function) !== 'function') return {ok:false, error:{kind:'unavailable'}}; return await window.\(function)(op, args);",
            arguments: ["op": op, "args": args],
            in: nil,
            in: .page
        ) { result in
            let wall = (CACurrentMediaTime() - t0) * 1000
            var body: [String: Any] = ["ok": false, "error": ["kind": "transport"]]
            if case .success(let value) = result, let dict = value as? [String: Any] { body = dict }
            if case .failure(let error) = result { body = ["ok": false, "error": ["kind": "transport", "reason": error.localizedDescription]] }
            completion(body, wall)
        }
    }

    func raw(_ op: String, _ args: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        Self.evaluate(webView, function: "shiziNative", op: op, args: args) { body, _ in completion(body) }
    }

    @MainActor func raw(_ op: String, _ args: [String: Any]) async -> [String: Any] {
        await withCheckedContinuation { cont in
            raw(op, args) { cont.resume(returning: $0) }
        }
    }

    @MainActor func call<A: Encodable, R: Decodable>(_ op: String, _ args: A, as type: R.Type) async throws -> R {
        let body = await raw(op, ShiziDecode.args(args))
        return try ShiziDecode.reply(body, as: R.self)
    }

    // MARK: 订阅

    var changes: AsyncStream<ShiziChangeSet> {
        AsyncStream { cont in
            let id = UUID()
            subscribers[id] = cont
            cont.onTermination = { [weak self] _ in
                DispatchQueue.main.async { self?.subscribers[id] = nil }
            }
        }
    }

    /// 状态变化回调（同步，主线程；页面据此禁用 / 恢复按钮）。返回取消函数。
    @discardableResult
    func observeStatus(_ fn: @escaping (ShiziEngineStatus) -> Void) -> () -> Void {
        let id = UUID()
        statusObservers[id] = fn
        return { [weak self] in self?.statusObservers[id] = nil }
    }

    // MARK: 页面推来的（NativeStage 转进来）

    /// {op:'changed', domains, label}。
    func receiveChanged(_ body: [String: Any]) -> ShiziChangeSet? {
        let domains = (body["domains"] as? [String]) ?? []
        guard !domains.isEmpty else { return nil }
        let set = ShiziChangeSet(domains: domains, label: body["label"] as? String)
        for c in subscribers.values { c.yield(set) }
        return set
    }

    /// {op:'status', status:'ready'|'blocked', reason}。
    func receiveStatus(_ body: [String: Any]) {
        if body["status"] as? String == "blocked" { set(.blocked(body["reason"] as? String ?? "blocked")) } else { set(.ready) }
    }

    func pageWillReload() { set(.reloading) }

    /// 页面就绪（pageReady）：还在 reloading（页面没推过状态）就算 ready；页面推过 blocked 的保持 blocked。
    func pageDidBecomeReady() {
        if status == .reloading { set(.ready) }
    }

    private func set(_ s: ShiziEngineStatus) {
        guard s != status else { return }
        status = s
        for fn in statusObservers.values { fn(s) }
    }
}

extension ShiziEngineStatus {
    var probeName: String {
        switch self {
        case .ready: return "ready"
        case .blocked(let r): return "blocked:\(r)"
        case .reloading: return "reloading"
        }
    }
}
