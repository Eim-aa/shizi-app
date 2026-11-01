import Foundation
import UIKit
import WebKit

// B1 原生数据层的桥（01-架构设计 §8.1「数据层端点」）：页面用同源请求
//   POST shizi-resource://app/__native/store/v1/<op>   body = JSON
// 由 LocalWebSchemeHandler 转到这里。写入走**同步** XHR（commit 返回时数据已在 SQLite 里），启动加载与迁移走异步 fetch。
// 选同步 XHR 而不是 postMessage：store.commit 是同步 API，同步确认让「commit 成功 = 已落盘」，写失败照旧当场返回 {ok:false}，
// 不需要「内存已提交、磁盘没跟上」的中间态（取舍见 01 §4.1）。CSP 不变（connect-src 'self' 即本源）。
//
// op：ping / load / apply / import / commitMigration / diag / stats（载荷与返回见 src/platform/native-store.js 文件头）。
// 返回一律 HTTP 200 + JSON：{ok:true, …} 或 {ok:false, error:{code, message, key?}}；code 见 NativeStore.swift 文件头，另有
//   E_TIMEOUT 原生没在期限内做完（结果未知：可能稍后仍会提交——JS 把它当作「不确定」，进阻断页，重启后以库为准）
//   E_BAD_REQUEST 请求体不是 JSON / 缺字段   E_UNKNOWN_OP 不认识的 op
// 线程：SQLite 只在 queue（串行）上用；WKURLSchemeTask 只在主线程回复，被 WebKit stop 的任务不再回复。

final class NativeStoreBridge {
    static let shared = NativeStoreBridge()
    static let pathPrefix = "/__native/store/v1/"

    /// 每个 op 的期限（秒）。写入 10s：正常 1–20ms，到期多半是库被系统挂起或磁盘异常。
    static func timeout(for op: String) -> TimeInterval {
        switch op {
        case "load", "import", "commitMigration": return 30
        default: return 10
        }
    }

    let queue = DispatchQueue(label: "com.eimaa.shizi.native-store", qos: .userInitiated)
    private var store: NativeStore?
    private var openFailure: NativeStoreError?
    /// 预读（queue 上）：loadApp 时先在队列上把 load 的回复编好，页面启动时的 load 直接拿走（一次性）。
    /// 任何写入类 op 都会先清掉它，所以拿到的一定是最新提交的内容。
    private var preloaded: Data?
    /// 只在主线程读写：还没回复、也没被 stop 的任务。
    private var live = Set<ObjectIdentifier>()
    private var observers: [NSObjectProtocol] = []

    /// 测试 / 冒烟可以换库位置；必须在第一次请求前设置。
    var fileURLProvider: () throws -> URL = { try NativeStore.defaultFileURL() }

    private init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { self?.store?.checkpoint() }
        })
    }

    /// WebViewController.loadApp 调用：WebContent 进程拉起的几百毫秒里先开库、读全部行并编好回复，省掉页面启动时的等待。
    func prewarm() {
        queue.async { [weak self] in
            guard let self, self.preloaded == nil else { return }
            let response = self.perform(op: "load", body: nil)
            guard response["ok"] as? Bool == true, let data = try? JSONSerialization.data(withJSONObject: response) else { return }
            self.preloaded = data
        }
    }

    func handles(_ url: URL) -> Bool {
        url.host == ShiziWebResource.host && url.path.hasPrefix(Self.pathPrefix)
    }

    // MARK: - WKURLSchemeHandler 转来的请求（主线程）

    func start(_ task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        live.insert(id)
        let request = task.request
        let op = String((request.url?.path ?? "").dropFirst(Self.pathPrefix.count))
        let body = Self.body(of: request)
        let started = CFAbsoluteTimeGetCurrent()
        #if DEBUG
        let tag = ShadowJournal.shared == nil ? nil : request.value(forHTTPHeaderField: "X-Shizi-Op") // B4.7 影子：这次写入属于哪个 op（只有影子包装里才有）
        #else
        let tag: String? = nil
        #endif
        queue.async { [weak self] in
            guard let self else { return }
            if op == "load", let data = self.preloaded {
                self.preloaded = nil
                DispatchQueue.main.async { self.reply(task, data: data) }
                return
            }
            let response = self.perform(op: op, body: body, started: started, tag: tag)
            DispatchQueue.main.async { self.reply(task, response) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeout(for: op)) { [weak self] in
            guard let self, self.live.contains(id) else { return }
            NSLog("[shizi] native store %@ timed out", op)
            self.reply(task, Self.failure(NativeStoreError("E_TIMEOUT", "\(op) did not finish in \(Self.timeout(for: op))s")))
        }
    }

    func stop(_ task: WKURLSchemeTask) {
        live.remove(ObjectIdentifier(task))
    }

    private func reply(_ task: WKURLSchemeTask, _ payload: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data(#"{"ok":false,"error":{"code":"E_INTERNAL","message":"encode"}}"#.utf8)
        reply(task, data: data)
    }

    private func reply(_ task: WKURLSchemeTask, data: Data) {
        guard live.remove(ObjectIdentifier(task)) != nil, let url = task.request.url else { return }
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": String(data.count),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            ]
        ) ?? URLResponse(url: url, mimeType: "application/json", expectedContentLength: data.count, textEncodingName: "utf-8")
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    static func body(of request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let size = 64 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let n = stream.read(buffer, maxLength: size)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    /// B4.5c：原生 SwiftEngine（swift 模式）经同一条连接、同一个串行队列读写，op 与载荷同页面的请求（load / apply / diag）。只在主线程调。
    func callSync(_ op: String, _ payload: [String: Any]) -> [String: Any] {
        let body = try? JSONSerialization.data(withJSONObject: payload)
        return queue.sync { perform(op: op, body: body) }
    }

    /// B4.9b：选引擎前（主线程）调一次，规则见 LegacyStorage.swift。返回迁移是否已是 done。
    func settleMigrationForLaunch() -> Bool {
        queue.sync {
            guard let store = try? openStore() else { return false }
            let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
            return store.settleMigrationForLaunch { library.map { LegacyStorageProbe.probe(libraryURL: $0) } ?? .unsure }
        }
    }

    #if DEBUG
    /// B4.7 影子：全库与日志序号（在队列上一起取，前后一致）。
    func shadowSnapshot() -> (rows: [String: String], seq: Int) {
        queue.sync {
            let rows = (try? openStore().loadAll()) ?? []
            return (Dictionary(rows, uniquingKeysWith: { $1 }), ShadowJournal.shared?.current ?? 0)
        }
    }
    #endif

    // MARK: - 执行（queue 上）

    private func openStore() throws -> NativeStore {
        if let store { return store }
        do {
            let s = NativeStore(fileURL: try fileURLProvider())
            #if DEBUG
            // B2.9b：QA 注入钉住的时钟也是原生时间戳的钟（QAClock，只在测试宿主）
            if WebViewController.nativeTestHostEnabled { s.now = { QAClock.nowMs() } }
            #endif
            try s.open()
            store = s
            openFailure = nil
            return s
        } catch let error as NativeStoreError {
            openFailure = error
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

    func perform(op: String, body: Data?, started: CFAbsoluteTime = CFAbsoluteTimeGetCurrent(), tag: String? = nil) -> [String: Any] {
        do {
            let payload: [String: Any]
            if let body, !body.isEmpty {
                guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
                    throw NativeStoreError("E_BAD_REQUEST", "body is not a JSON object")
                }
                payload = obj
            } else {
                payload = [:]
            }
            let store = try openStore()
            if !["ping", "load", "stats"].contains(op) { preloaded = nil }
            var out: [String: Any] = ["ok": true]
            switch op {
            case "ping":
                out["schema"] = Int(store.userVersion)
                out["migration"] = try store.migration()?.dictionary ?? NSNull()
            case "load":
                let rows = try store.loadAll()
                out["schema"] = Int(store.userVersion)
                out["migration"] = try store.migration()?.dictionary ?? NSNull()
                out["rows"] = rows.map { [$0.0, $0.1] }
            case "apply":
                let ops = try Self.ops(payload["ops"])
                out["written"] = try store.apply(ops)
                #if DEBUG
                ShadowJournal.shared?.record(ops.map { ($0.key, $0.value) }, tag: tag)
                #endif
            case "import":
                guard let count = payload["count"] as? Int, let digest = payload["digest"] as? String else {
                    throw NativeStoreError("E_BAD_REQUEST", "import needs count and digest")
                }
                let m = try store.importRows(try Self.ops(payload["rows"]), count: count, digest: digest, source: payload["source"] as? String ?? "")
                out["migration"] = m.dictionary
            case "commitMigration":
                guard let count = payload["count"] as? Int, let digest = payload["digest"] as? String else {
                    throw NativeStoreError("E_BAD_REQUEST", "commitMigration needs count and digest")
                }
                out["migration"] = try store.commitMigration(count: count, digest: digest).dictionary
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
                out["migration"] = try store.migration()?.dictionary ?? NSNull()
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
