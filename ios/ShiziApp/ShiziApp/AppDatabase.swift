import Foundation
import UIKit

// App 的数据库入口（B1 建为页面的数据层桥，B4.9 起只有原生一个使用者）：一个 SQLite 库（NativeStore.swift）、一条连接、一个串行队列。
// SwiftEngine 的 Store 经 SwiftEngineRuntime.swift 的 DatabaseTransport 同步调这里（op 与载荷沿用 B1 的数据层端点：ping / load / apply / diag / stats，
// 返回 {ok:true, …} 或 {ok:false, error:{code, message, key?}}；code 见 NativeStore.swift 文件头，另有 E_BAD_REQUEST / E_UNKNOWN_OP）。
// B4.9（D81 ②）：没有 localStorage → SQLite 的迁移路径了——新装、升级都直接开这个库；库里旧的迁移标记留着不读。
// 线程：SQLite 只在 queue（串行）上用；callSync 只在主线程调。

final class AppDatabase {
    static let shared = AppDatabase()

    let queue = DispatchQueue(label: "com.eimaa.shizi.native-store", qos: .userInitiated)
    private var store: NativeStore?
    private var observers: [NSObjectProtocol] = []

    /// 测试可以换库位置；必须在第一次请求前设置。
    var fileURLProvider: () throws -> URL = { try NativeStore.defaultFileURL() }

    private init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { self?.store?.checkpoint() }
        })
    }

    /// SwiftEngine 经这条连接、这个串行队列读写（load / apply / diag / stats / ping）。只在主线程调。
    func callSync(_ op: String, _ payload: [String: Any]) -> [String: Any] {
        queue.sync { perform(op: op, payload: payload) }
    }

    // MARK: - 执行（queue 上）

    private func openStore() throws -> NativeStore {
        if let store { return store }
        do {
            let s = NativeStore(fileURL: try fileURLProvider())
            #if DEBUG
            // B2.9b：QA 注入钉住的时钟也是原生时间戳的钟（QAClock，只在测试宿主）
            if RootViewController.nativeTestHostEnabled { s.now = { QAClock.wallMs() } }
            #endif
            try s.open()
            store = s
            return s
        } catch let error as NativeStoreError {
            throw NativeStoreError("E_UNAVAILABLE", error.description)
        } catch {
            throw NativeStoreError("E_UNAVAILABLE", String(describing: error))
        }
    }

    static func failure(_ error: NativeStoreError) -> [String: Any] {
        var e: [String: Any] = ["code": error.code, "message": error.message]
        if let key = error.key { e["key"] = key }
        return ["ok": false, "error": e]
    }

    static func ops(_ value: Any?) throws -> [NativeStoreOp] {
        guard let list = value as? [Any] else { throw NativeStoreError("E_BAD_REQUEST", "ops must be an array") }
        return try list.map { item in
            guard let row = item as? [Any], row.count >= 2, let key = row[0] as? String else {
                throw NativeStoreError("E_BAD_REQUEST", "op must be [key, value|null, sum?]")
            }
            let value: String?
            if row[1] is NSNull { value = nil } else if let s = row[1] as? String { value = s } else {
                throw NativeStoreError("E_BAD_REQUEST", "value must be a string or null", key: key)
            }
            let sum = row.count > 2 ? row[2] as? String : nil
            return NativeStoreOp(key: key, value: value, sum: sum)
        }
    }

    func perform(op: String, payload: [String: Any]) -> [String: Any] {
        let started = CFAbsoluteTimeGetCurrent()
        do {
            let store = try openStore()
            var out: [String: Any] = ["ok": true]
            switch op {
            case "ping":
                out["schema"] = Int(store.userVersion)
            case "load":
                out["schema"] = Int(store.userVersion)
                out["rows"] = try store.loadAll().map { [$0.0, $0.1] }
            case "apply":
                out["written"] = try store.apply(try Self.ops(payload["ops"]))
            case "diag":
                if let entry = payload["entry"] as? [String: Any] {
                    try store.appendDiag(entry)
                    NSLog("[shizi] native store diag: %@", String(describing: entry))
                }
                out["diag"] = try store.diagEntries()
            case "stats":
                let s = try store.stats()
                out["rows"] = s.rows
                out["bodyBytes"] = s.bodyBytes
                out["fileBytes"] = s.fileBytes
                out["tables"] = s.tables.mapValues { ["rows": $0.rows, "bytes": $0.bytes] }
                out["schema"] = Int(store.userVersion)
            default:
                throw NativeStoreError("E_UNKNOWN_OP", "unknown op \(op)")
            }
            out["ms"] = (CFAbsoluteTimeGetCurrent() - started) * 1000
            return out
        } catch let error as NativeStoreError {
            if op != "ping" { NSLog("[shizi] native store %@ failed: %@", op, error.description) }
            return Self.failure(error)
        } catch {
            return Self.failure(NativeStoreError("E_INTERNAL", String(describing: error)))
        }
    }
}
