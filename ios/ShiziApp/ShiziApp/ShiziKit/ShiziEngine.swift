import UIKit

// ShiziKit（B3.2；计划 B3B4-原生化架构与计划.md §3.4）：原生页面与规则 / 数据之间唯一的边界。
//
// 原生页面不持有业务状态，只认这里的协议：每个 op 的回包都有 Codable 类型（AboutView …）。实现是 SwiftEngine（ShiziCore 的 SessionRuntime；
// B3 的 WebEngine 与 WKWebView 已在 B4.9 删除），op 名与回包形状沿用 JS 参考实现。
// 订阅：changes（store 每次成功提交后一个 ShiziChangeSet，带脏域）；status：ready / blocked(原因) / reloading（冷启动判定之前）。

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
    /// 通道没通（引擎不在 / 回包不是对象）。
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
    /// 不解码的调用（导航这类只看 ok 的 op；B2 页面的字典回包）。主线程上发。
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

    /// Encodable 参数 → 引擎收的字典。
    static func args<A: Encodable>(_ a: A) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(a), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}

// MARK: - 文案引用（视图模型给键 + 参数，B3.4；文案 ref / tRef 的原生版）

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

// MARK: - 引擎通道

/// 引擎调用的唯一出口（App API shiziNative、写字会话 shiziNativeWrite、导航助手 shiziNativeNav 三个通道都经这里）：SwiftEngine 装上的答复者。
/// 没有引擎（还没建好 / 单元测试里的孤立页面）→ {ok:false, error:{kind:'unavailable'}}。
enum EngineRoute {
    /// (function, op, args, completion) → 是否已答复。
    static var swift: ((String, String, [String: Any], @escaping ([String: Any], Double) -> Void) -> Bool)?

    static func evaluate(function: String, op: String, args: [String: Any], completion: @escaping ([String: Any], Double) -> Void) {
        if let swift, swift(function, op, args, completion) { return }
        completion(["ok": false, "error": ["kind": "unavailable"]], 0)
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
