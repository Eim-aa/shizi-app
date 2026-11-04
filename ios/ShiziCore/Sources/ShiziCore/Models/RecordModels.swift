import Foundation

// 记录域模型：meta / records（含折叠月）/ sched / ink / custom / wordOff。形状见 Schema.swift（01-架构设计 §3）。
// 数字一律 Double（JS Number；整数字段由 Schema 校验保证是整数）。规范键序 = JS 写入处的字面量序（makeRecord 等）。

public struct Help: JSCodable, Equatable {
    public var hints: Double
    public var answerSeen: Bool
    public var traced: Bool
    var order: [String]?

    public init(hints: Double, answerSeen: Bool, traced: Bool) {
        self.hints = hints; self.answerSeen = answerSeen; self.traced = traced; order = nil
    }
    public init(js: JSValue) throws {
        let r = try Reader(js, "help")
        hints = try r.req("hints", Conv.num)
        answerSeen = try r.req("answerSeen", Conv.bool)
        traced = try r.req("traced", Conv.bool)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("hints", hints); w.add("answerSeen", answerSeen); w.add("traced", traced)
        return w.build(order: order)
    }
}

public struct Correction: JSCodable, Equatable {
    public var from: String
    public var at: Double
    var order: [String]?

    public init(from: String, at: Double) { self.from = from; self.at = at; order = nil }
    public init(js: JSValue) throws {
        let r = try Reader(js, "correction")
        from = try r.req("from", Conv.str)
        at = try r.req("at", Conv.num)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("from", from); w.add("at", at)
        return w.build(order: order)
    }
}

/// 一条 Record（01 §3.2）。
public struct RecordModel: JSCodable, Equatable {
    public var id: String
    public var cardKey: String
    public var char: String
    public var sessionId: String?
    public var kind: String
    public var judgment: String?
    public var at: Double
    public var localDay: String
    public var help: Help
    public var corrections: [Correction]?
    public var inkId: String?
    public var legacy: Bool?
    public var source: String?
    var order: [String]?

    public init(id: String, cardKey: String, char: String, sessionId: String?, kind: String, judgment: String?, at: Double, localDay: String,
                help: Help, corrections: [Correction]? = nil, inkId: String? = nil, legacy: Bool? = nil, source: String? = nil) {
        self.id = id; self.cardKey = cardKey; self.char = char; self.sessionId = sessionId; self.kind = kind; self.judgment = judgment
        self.at = at; self.localDay = localDay; self.help = help; self.corrections = corrections; self.inkId = inkId
        self.legacy = legacy; self.source = source; order = nil
    }

    public init(js: JSValue) throws {
        let r = try Reader(js, "record")
        id = try r.req("id", Conv.str)
        cardKey = try r.req("cardKey", Conv.str)
        char = try r.req("char", Conv.str)
        sessionId = try r.opt("sessionId", Conv.str)
        kind = try r.req("kind", Conv.str)
        judgment = try r.opt("judgment", Conv.str)
        at = try r.req("at", Conv.num)
        localDay = try r.req("localDay", Conv.str)
        help = try r.req("help", Conv.model(Help.self))
        corrections = try r.opt("corrections", Conv.array(Conv.model(Correction.self)))
        inkId = try r.opt("inkId", Conv.str)
        legacy = try r.opt("legacy", Conv.bool)
        source = try r.opt("source", Conv.str)
        order = r.order
    }

    public var js: JSValue {
        var w = Writer()
        w.add("id", id); w.add("cardKey", cardKey); w.add("char", char); w.add("sessionId", sessionId); w.add("kind", kind)
        w.add("at", at); w.add("localDay", localDay); w.add("help", model: help)
        w.add("judgment", judgment)
        w.add("corrections", array: corrections) { $0.js }
        w.add("inkId", inkId); w.add("source", source); w.add("legacy", legacy)
        return w.build(order: order)
    }
}

/// 折叠后的月汇总（01 §9）。
public struct FoldedMonth: JSCodable, Equatable {
    public var month: String
    public var byDay: OrderedMap<[String]>
    public var chars: [String]
    public var kept: [RecordModel]
    public var paperOnly: OrderedMap<[String]>?
    /// R15：折叠时逐条记下的作品成员（缺省 = 旧折叠）。
    public var work: OrderedMap<[String]>?
    public var workJudged: OrderedMap<[String]>?
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "folded")
        _ = try r.req("folded", Conv.bool)
        month = try r.req("month", Conv.str)
        let strs = Conv.array(Conv.str)
        byDay = try OrderedMap(try r.req("byDay", Conv.any), "byDay", strs)
        chars = try r.req("chars", strs)
        kept = try r.req("kept", Conv.array(Conv.model(RecordModel.self)))
        if let p = r.raw("paperOnly") { paperOnly = try OrderedMap(p, "paperOnly", strs) } else { paperOnly = nil }
        if let p = r.raw("work") { work = try OrderedMap(p, "work", strs) } else { work = nil }
        if let p = r.raw("workJudged") { workJudged = try OrderedMap(p, "workJudged", strs) } else { workJudged = nil }
        order = r.order
    }

    public var js: JSValue {
        var w = Writer()
        let strs: ([String]) -> JSValue = { .array($0.map { .string($0) }) }
        w.add("folded", true); w.add("month", month); w.add("byDay", byDay.encode(strs)); w.add("chars", strs(chars))
        w.add("kept", array: kept) { $0.js }
        if let p = paperOnly { w.add("paperOnly", p.encode(strs)) }
        if let p = work { w.add("work", p.encode(strs)) }
        if let p = workJudged { w.add("workJudged", p.encode(strs)) }
        return w.build(order: order)
    }
}

/// records.<YYYY-MM> 的值：当月记录列表，或折叠月。
public enum RecordsMonth: JSCodable, Equatable {
    case list([RecordModel])
    case folded(FoldedMonth)

    public init(js: JSValue) throws {
        if case .array = js { self = .list(try Conv.array(Conv.model(RecordModel.self))(js)) } else { self = .folded(try FoldedMonth(js: js)) }
    }
    public var js: JSValue {
        switch self {
        case .list(let l): return .array(l.map { $0.js })
        case .folded(let f): return f.js
        }
    }
}

public struct Meta: JSCodable, Equatable {
    public var schema: Double
    public var serial: Double
    public var createdAt: Double
    public var migratedAt: Double?
    public var months: [String]
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "meta")
        schema = try r.req("schema", Conv.num)
        serial = try r.req("serial", Conv.num)
        createdAt = try r.req("createdAt", Conv.num)
        migratedAt = try r.opt("migratedAt", Conv.num)
        months = try r.req("months", Conv.array(Conv.str))
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("schema", schema); w.add("serial", serial); w.add("createdAt", createdAt); w.add("migratedAt", migratedAt)
        w.add("months", array: months) { .string($0) }
        return w.build(order: order)
    }
}

/// sched 的一项（FSRS 紧凑卡归 FSRS.swift，这里原样保留）。
public struct SchedEntry: JSCodable, Equatable {
    public var fsrs: JSValue
    /// 到期日；null（练习范围学完等）为 nil。
    public var due: String?
    public var lastJudgedAt: Double
    public var stoppedAt: Double?
    public var seenAgainDay: String?
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "sched entry")
        fsrs = try r.req("fsrs", Conv.any)
        due = try r.req("due", Conv.nullable(Conv.str))
        lastJudgedAt = try r.req("lastJudgedAt", Conv.num)
        stoppedAt = try r.opt("stoppedAt", Conv.num)
        seenAgainDay = try r.opt("seenAgainDay", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("fsrs", fsrs); w.add("due", due.map { JSValue.string($0) } ?? .null); w.add("lastJudgedAt", lastJudgedAt)
        w.add("stoppedAt", stoppedAt); w.add("seenAgainDay", seenAgainDay)
        return w.build(order: order)
    }
}

public struct Sched: JSCodable, Equatable {
    public var entries: OrderedMap<SchedEntry>
    public init(js: JSValue) throws { entries = try OrderedMap(js, "sched", { try SchedEntry(js: $0) }) }
    public var js: JSValue { entries.encode { $0.js } }
}

public struct InkV2: Equatable {
    public var c: Double
    public var s: [[Double]]
    public var dt: [[Double]]?
    public var p: [[Double]]?
    var order: [String]?
}
public struct InkV3: Equatable {
    public var c: Double
    public var s: [String]
    public var p: [String]?
    var order: [String]?
}
/// Ink v4（B2.3 原始点）：每笔一个打包串，g 与 r 等长。
public struct InkV4: Equatable {
    public var c: Double
    public var r: [String]
    public var g: [Double]
    var order: [String]?
}

/// 一条墨迹：v4（现行写入口径）/ v3（打包，旧数据）/ v2（更旧，读取兼容）。笔点的逐字节解包在 B4.3（与 InkStoredInk 合并）。
public enum Ink: JSCodable, Equatable {
    case v2(InkV2)
    case v3(InkV3)
    case v4(InkV4)

    public init(js: JSValue) throws {
        let r = try Reader(js, "ink")
        let version = try r.req("v", Conv.num)
        let rows = Conv.array(Conv.array(Conv.num))
        let b64s = Conv.array(Conv.str)
        switch version {
        case 4: self = .v4(InkV4(c: try r.req("c", Conv.num), r: try r.req("r", b64s), g: try r.req("g", Conv.array(Conv.num)), order: r.order))
        case 3: self = .v3(InkV3(c: try r.req("c", Conv.num), s: try r.req("s", b64s), p: try r.opt("p", b64s), order: r.order))
        case 2: self = .v2(InkV2(c: try r.req("c", Conv.num), s: try r.req("s", rows), dt: try r.opt("dt", rows), p: try r.opt("p", rows), order: r.order))
        default: throw ModelError.shape("ink.v")
        }
    }

    public var js: JSValue {
        let num: (Double) -> JSValue = { .number($0) }
        let str: (String) -> JSValue = { .string($0) }
        let rows: ([[Double]]) -> JSValue = { .array($0.map { .array($0.map(num)) }) }
        var w = Writer()
        switch self {
        case .v4(let i):
            w.add("v", 4.0); w.add("c", i.c); w.add("r", array: i.r, str); w.add("g", array: i.g, num)
            return w.build(order: i.order)
        case .v3(let i):
            w.add("v", 3.0); w.add("c", i.c); w.add("s", array: i.s, str); w.add("p", array: i.p, str)
            return w.build(order: i.order)
        case .v2(let i):
            w.add("v", 2.0); w.add("c", i.c); w.add("s", rows(i.s))
            if let dt = i.dt { w.add("dt", rows(dt)) }
            if let p = i.p { w.add("p", rows(p)) }
            return w.build(order: i.order)
        }
    }
}

/// shizi.v2.ink.<YYYY-MM> 的值：{recordId: Ink}（备份文件与保护副本里的形态）。
public struct InkMonth: JSCodable, Equatable {
    public var entries: OrderedMap<Ink>
    public init(js: JSValue) throws { entries = try OrderedMap(js, "ink month", { try Ink(js: $0) }) }
    public var js: JSValue { entries.encode { $0.js } }
}

public struct CustomAdded: JSCodable, Equatable {
    public var char: String
    public var at: Double
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "custom.added")
        char = try r.req("char", Conv.str)
        at = try r.req("at", Conv.num)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("char", char); w.add("at", at)
        return w.build(order: order)
    }
}

public struct Custom: JSCodable, Equatable {
    public var added: [CustomAdded]
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "custom")
        added = try r.req("added", Conv.array(Conv.model(CustomAdded.self)))
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("added", array: added) { $0.js }
        return w.build(order: order)
    }
}

/// wordOff：{cardKey: at}。
public struct WordOff: JSCodable, Equatable {
    public var entries: OrderedMap<Double>
    public init(js: JSValue) throws { entries = try OrderedMap(js, "wordOff", Conv.num) }
    public var js: JSValue { entries.encode { .number($0) } }
}
