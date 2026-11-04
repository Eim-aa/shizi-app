import Foundation

// ShiziCore 的 op 表与 JSON 行协议（B4.0；计划 §4.2 / §4.3 ④；协议全文见 ios/ShiziCore/README.md）。
// 当年的 JS 参考引擎（同一张 op 表、同一套参数校验、同一种错误码）与逐字段差分已随 D84 退役。
//   请求：{"id"?: any, "op": string, "args"?: object, "state"?: false}
//   回包：{"id"?: any, "ok": true, "reply": any, "state": {...}} | {"id"?: any, "ok": false, "error": {"code", "message"}, "state": {...}}
// 状态快照 = 引擎全部可观察状态（B4.0 只有 clock 与通用 kv；B4.4 起换成 store 的各域）。op 先校验后改状态：失败的 op 不改状态。

public final class CoreEngine {
    public static let protocolVersion = 1
    public static let engineName = "swift"

    public internal(set) var clock: Double = 0
    public private(set) var kv = JSObject()
    public var dates: Dates
    /// B4.4：store 会话（store.open 建；存在时进状态快照的 store 段，见 StoreOps.swift）。
    var storeSession: StoreSession?

    public init(timeZone: TimeZone = .current) {
        dates = Dates(timeZone: timeZone)
    }

    public var snapshot: JSValue {
        var o = JSObject([("clock", .number(clock)), ("kv", .object(kv))])
        if let s = storeSession { o["store"] = s.snapshot }
        return .object(o)
    }

    typealias Op = (CoreEngine, JSObject) throws -> JSValue

    static let ops: [String: Op] = coreOps.merging(configOps) { a, _ in a }.merging(schemaOps) { a, _ in a }.merging(b43Ops) { a, _ in a }.merging(schedOps) { a, _ in a }.merging(b44Ops) { a, _ in a }.merging(imageOps) { a, _ in a }.merging(viewOps) { a, _ in a }.merging(sessionOps) { a, _ in a }.merging(apiOps) { a, _ in a }.merging(navOps) { a, _ in a }

    static let coreOps: [String: Op] = [
        "hello": { _, _ in
            .object(JSObject([
                ("protocol", .number(Double(protocolVersion))),
                ("engine", .string(engineName)),
                ("ops", .array(opNames.map { .string($0) })),
            ]))
        },
        "echo": { _, a in try required(a, "value") },
        "kv.set": { e, a in
            let key = try string(a, "key")
            let value = try required(a, "value")
            e.kv[key] = value
            return .null
        },
        "kv.keys": { e, _ in .array(e.kv.keys.map { .string($0) }) },
        "clock.set": { e, a in
            e.clock = try finite(try required(a, "t"), "t")
            return .null
        },

        "dates.calendarDay": { e, a in .string(try e.dates.calendarDay(a["t"] ?? .number(e.clock))) },
        "dates.localDay": { e, a in .string(try e.dates.localDay(a["t"] ?? .number(e.clock), dayStartHour: a["dayStartHour"])) },
        "dates.periodOf": { e, a in .string(try e.dates.periodOf(a["t"] ?? .number(e.clock))) },
        "dates.isValidDay": { e, a in .bool(e.dates.isValidDay(try required(a, "value"))) },
        "dates.isValidMonth": { e, a in .bool(e.dates.isValidMonth(try required(a, "value"))) },
        "dates.daysInMonth": { e, a in
            .number(e.dates.daysInMonth(try int(a, "year", 200_000), try int(a, "month", 1000)))
        },
        "dates.parseDay": { e, a in
            let p = try e.dates.parseDay(try required(a, "day"))
            return .object(JSObject([("year", .number(Double(p.year))), ("month", .number(Double(p.month))), ("day", .number(Double(p.day)))]))
        },
        "dates.dayStartMs": { e, a in .number(try e.dates.dayStartMs(try required(a, "day"))) },
        "dates.addDays": { e, a in .string(try e.dates.addDays(try required(a, "day"), try bounded(a, "n"))) },
        "dates.diffDays": { e, a in .number(try e.dates.diffDays(try required(a, "a"), try required(a, "b"))) },
        "dates.monthOf": { e, a in .string(try e.dates.monthOf(try required(a, "dayOrMs"))) },
        "dates.addMonths": { e, a in .string(try e.dates.addMonths(try required(a, "month"), try bounded(a, "n"))) },
        "dates.dayOfYear": { e, a in .number(try e.dates.dayOfYear(try required(a, "day"))) },
        "dates.periodOfHour": { _, a in
            guard case .number(let h) = try required(a, "hour") else { throw CoreError.badArgs("hour must be a number") }
            return .string(try Dates.periodOfHour(h))
        },
        "dates.monthDayParts": { e, a in try e.dates.monthDayParts(try required(a, "day")) },
    ]

    /// op 名按 JS 默认排序（UTF-16 码元序；op 名全是 ASCII，与 Swift 字符串序相同）。
    public static let opNames: [String] = ops.keys.sorted()

    // ---- 参数校验 ----

    static func required(_ a: JSObject, _ k: String) throws -> JSValue {
        guard let v = a[k] else { throw CoreError.badArgs("missing " + k) }
        return v
    }

    static func string(_ a: JSObject, _ k: String) throws -> String {
        guard let s = try required(a, k).stringValue else { throw CoreError.badArgs(k + " must be a string") }
        return s
    }

    static func finite(_ v: JSValue, _ k: String) throws -> Double {
        guard case .number(let d) = v, d.isFinite else { throw CoreError.badArgs(k + " must be a finite number") }
        return d
    }

    /// 有限数且 |n| ≤ 1e7（天 / 月的增量）。
    static func bounded(_ a: JSObject, _ k: String) throws -> Double {
        let d = try finite(try required(a, k), k)
        guard abs(d) <= 1e7 else { throw CoreError.badArgs(k + " out of range") }
        return d
    }

    static func int(_ a: JSObject, _ k: String, _ limit: Int) throws -> Int {
        let d = try finite(try required(a, k), k)
        guard d.rounded(.towardZero) == d, abs(d) <= Double(limit) else { throw CoreError.badArgs(k + " must be an integer within range") }
        return Int(d)
    }

    // ---- 协议 ----

    /// 处理一个请求值，返回回包值。
    public func handle(_ request: JSValue) -> JSValue {
        var out = JSObject()
        guard let req = request.objectValue else {
            return respond(&out, error: .badRequest("request must be an object"), withState: true)
        }
        if let id = req["id"] { out["id"] = id }
        let withState = req["state"] != .bool(false)
        guard case .string(let op)? = req["op"] else {
            return respond(&out, error: .badRequest("op must be a string"), withState: withState)
        }
        var args = JSObject()
        if let a = req["args"] {
            guard let o = a.objectValue else { return respond(&out, error: .badRequest("args must be an object"), withState: withState) }
            args = o
        }
        guard let fn = CoreEngine.ops[op] else {
            return respond(&out, error: .unknownOp("unknown op: " + op), withState: withState)
        }
        do {
            let reply = try fn(self, args)
            out["ok"] = .bool(true)
            out["reply"] = reply
            if withState { out["state"] = snapshot }
            return .object(out)
        } catch let e as CoreError {
            return respond(&out, error: e, withState: withState)
        } catch {
            return respond(&out, error: .badRequest(String(describing: error)), withState: withState)
        }
    }

    private func respond(_ out: inout JSObject, error: CoreError, withState: Bool) -> JSValue {
        out["ok"] = .bool(false)
        out["error"] = .object(JSObject([("code", .string(error.code)), ("message", .string(error.message))]))
        if withState { out["state"] = snapshot }
        return .object(out)
    }

    /// 一行请求 → 一行回包（JS 同规则序列化）。坏 JSON 回 bad-json。
    public func handle(line: String) -> String {
        let value: JSValue
        do {
            value = try JSONParser.parse(line)
        } catch {
            var out = JSObject()
            out["ok"] = .bool(false)
            out["error"] = .object(JSObject([("code", .string("bad-json")), ("message", .string(String(describing: error)))]))
            out["state"] = snapshot
            return JSONWriter.stringify(.object(out))
        }
        return JSONWriter.stringify(handle(value))
    }
}
