import Foundation

// 设置 / 照片 / 旧数据 / 备份元信息 / 会话 / 保护副本 / 事务日志 / 漏斗 / 路由提示的模型（形状见 Schema.swift）。

public struct Remind: JSCodable, Equatable {
    public var enabled: Bool?
    public var hour: Double?
    public var minute: Double?
    public var permission: String?
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "settings.remind")
        enabled = try r.opt("enabled", Conv.bool)
        hour = try r.opt("hour", Conv.num)
        minute = try r.opt("minute", Conv.num)
        permission = try r.opt("permission", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("enabled", enabled); w.add("hour", hour); w.add("minute", minute); w.add("permission", permission)
        return w.build(order: order)
    }
}

public struct RemindInvite: JSCodable, Equatable {
    public var shown: Double?
    public var last: String?
    public var answered: String?
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "settings.remindInvite")
        shown = try r.opt("shown", Conv.num)
        last = try r.opt("last", Conv.str)
        answered = try r.opt("answered", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("shown", shown); w.add("last", last); w.add("answered", answered)
        return w.build(order: order)
    }
}

/// settings：各字段都可缺省（缺省由读取方补默认值）。
public struct Settings: JSCodable, Equatable {
    public var library: String?
    public var sound: Bool?
    public var remind: Remind?
    public var remindInvite: RemindInvite?
    public var capitalDeferredDay: String?
    public var returnSpreadFor: String?
    public var writeMode: String?
    public var paperSuggested: Bool?
    public var answerNoteSeen: Bool?
    public var shiHandoffDone: Bool?
    public var firstTipSeen: Bool?
    public var large: Bool?
    public var appearance: String?
    public var groupSize: Double?
    public var mixTier: String?
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "settings")
        library = try r.opt("library", Conv.str)
        sound = try r.opt("sound", Conv.bool)
        remind = try r.opt("remind", Conv.model(Remind.self))
        remindInvite = try r.opt("remindInvite", Conv.model(RemindInvite.self))
        capitalDeferredDay = try r.opt("capitalDeferredDay", Conv.str)
        returnSpreadFor = try r.opt("returnSpreadFor", Conv.str)
        writeMode = try r.opt("writeMode", Conv.str)
        paperSuggested = try r.opt("paperSuggested", Conv.bool)
        answerNoteSeen = try r.opt("answerNoteSeen", Conv.bool)
        shiHandoffDone = try r.opt("shiHandoffDone", Conv.bool)
        firstTipSeen = try r.opt("firstTipSeen", Conv.bool)
        large = try r.opt("large", Conv.bool)
        appearance = try r.opt("appearance", Conv.str)
        groupSize = try r.opt("groupSize", Conv.num)
        mixTier = try r.opt("mixTier", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("library", library); w.add("sound", sound); w.add("remind", model: remind); w.add("remindInvite", model: remindInvite)
        w.add("capitalDeferredDay", capitalDeferredDay); w.add("returnSpreadFor", returnSpreadFor); w.add("writeMode", writeMode)
        w.add("paperSuggested", paperSuggested); w.add("answerNoteSeen", answerNoteSeen); w.add("shiHandoffDone", shiHandoffDone)
        w.add("firstTipSeen", firstTipSeen); w.add("large", large); w.add("appearance", appearance); w.add("groupSize", groupSize)
        w.add("mixTier", mixTier)
        return w.build(order: order)
    }
}

public struct Photo: JSCodable, Equatable {
    public var day: String
    public var at: Double
    public var dataURL: String
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "photo")
        day = try r.req("day", Conv.str)
        at = try r.req("at", Conv.num)
        dataURL = try r.req("dataURL", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("day", day); w.add("at", at); w.add("dataURL", dataURL)
        return w.build(order: order)
    }
}

/// photos：{字: Photo}。
public struct Photos: JSCodable, Equatable {
    public var entries: OrderedMap<Photo>
    public init(js: JSValue) throws { entries = try OrderedMap(js, "photos", { try Photo(js: $0) }) }
    public var js: JSValue { entries.encode { $0.js } }
}

public struct Legacy: JSCodable, Equatable {
    public var importedAt: Double
    public var fromKeys: [String]
    public var days: [String]
    /// 迁移报告（形状层只要求对象）。
    public var report: JSValue
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "legacy")
        importedAt = try r.req("importedAt", Conv.num)
        fromKeys = try r.req("fromKeys", Conv.array(Conv.str))
        days = try r.req("days", Conv.array(Conv.str))
        report = try r.req("report", Conv.any)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("importedAt", importedAt)
        w.add("fromKeys", array: fromKeys) { .string($0) }
        w.add("days", array: days) { .string($0) }
        w.add("report", report)
        return w.build(order: order)
    }
}

public struct Conclusion: JSCodable, Equatable {
    public var kind: String
    public var date: Field<String>
    public var count: Double
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "backupMeta.lastConclusion")
        kind = try r.req("kind", Conv.str)
        date = try r.field("date", Conv.str)
        count = try r.req("count", Conv.num)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("kind", kind); w.add("date", date) { .string($0) }; w.add("count", count)
        return w.build(order: order)
    }
}

public struct BackupMeta: JSCodable, Equatable {
    public var lastExportAt: Field<Double>
    public var lastExportSig: Field<String>
    public var lastConclusion: Field<Conclusion>
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "backupMeta")
        lastExportAt = try r.field("lastExportAt", Conv.num)
        lastExportSig = try r.field("lastExportSig", Conv.str)
        lastConclusion = try r.field("lastConclusion", Conv.model(Conclusion.self))
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("lastExportAt", lastExportAt) { .number($0) }
        w.add("lastExportSig", lastExportSig) { .string($0) }
        w.add("lastConclusion", lastConclusion) { $0.js }
        return w.build(order: order)
    }
}

// ---- 会话（01 §3.3）

public struct SessionSource: JSCodable, Equatable {
    public var view: String
    public var char: String?
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "session.source")
        view = try r.req("view", Conv.str)
        char = try r.opt("char", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("view", view); w.add("char", char)
        return w.build(order: order)
    }
}

public struct SessionItem: JSCodable, Equatable {
    public var cardKey: String
    public var recordId: String?
    public var kind: String
    public var fsrsBefore: JSValue?
    /// D83 重考 item：correct / wrong / skipped 与第几次。
    public var outcome: String?
    public var attempt: Double?
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "session.item")
        cardKey = try r.req("cardKey", Conv.str)
        recordId = try r.opt("recordId", Conv.str)
        kind = try r.req("kind", Conv.str)
        fsrsBefore = r.raw("fsrsBefore")
        outcome = try r.opt("outcome", Conv.str)
        attempt = try r.opt("attempt", Conv.num)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("cardKey", cardKey); w.add("recordId", recordId); w.add("kind", kind); w.add("fsrsBefore", fsrsBefore)
        w.add("outcome", outcome); w.add("attempt", attempt)
        return w.build(order: order)
    }
}

public struct SessionCurrent: JSCodable, Equatable {
    public var phase: String
    /// 每笔的点（编码归 ink-math）。
    public var strokes: [JSValue]
    public var hints: Double?
    public var answerSeen: Bool?
    /// null / 数组 / 对象，原样保留。
    public var hintRange: JSValue?
    public var referenceReady: Bool?
    public var paper: Bool?
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "session.current")
        phase = try r.req("phase", Conv.str)
        strokes = try r.req("strokes", Conv.array(Conv.any))
        hints = try r.opt("hints", Conv.num)
        answerSeen = try r.opt("answerSeen", Conv.bool)
        hintRange = r.raw("hintRange")
        referenceReady = try r.opt("referenceReady", Conv.bool)
        paper = try r.opt("paper", Conv.bool)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("phase", phase); w.add("strokes", array: strokes) { $0 }; w.add("hints", hints); w.add("answerSeen", answerSeen)
        w.add("hintRange", hintRange); w.add("referenceReady", referenceReady); w.add("paper", paper)
        return w.build(order: order)
    }
}

public struct LastLine: JSCodable, Equatable {
    public var recordId: String
    public var kind: String
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "session.lastLine")
        recordId = try r.req("recordId", Conv.str)
        kind = try r.req("kind", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("recordId", recordId); w.add("kind", kind)
        return w.build(order: order)
    }
}

public struct Session: JSCodable, Equatable {
    public var id: String
    public var slot: String
    public var kind: String
    public var source: SessionSource
    public var queue: [String]
    public var cursor: Double
    public var items: [SessionItem]
    public var current: Field<SessionCurrent>
    public var lastLine: Field<LastLine>
    public var startedAt: Double
    public var startedDay: String
    public var updatedAt: Double
    public var endedAt: Double?
    public var endedEarly: Bool?
    public var added: [String]?
    public var sealedAt: Double?
    public var extra: Bool?
    var order: [String]?

    public init(js: JSValue) throws {
        let r = try Reader(js, "session")
        id = try r.req("id", Conv.str)
        slot = try r.req("slot", Conv.str)
        kind = try r.req("kind", Conv.str)
        source = try r.req("source", Conv.model(SessionSource.self))
        queue = try r.req("queue", Conv.array(Conv.str))
        cursor = try r.req("cursor", Conv.num)
        items = try r.req("items", Conv.array(Conv.model(SessionItem.self)))
        current = try r.field("current", Conv.model(SessionCurrent.self))
        lastLine = try r.field("lastLine", Conv.model(LastLine.self))
        startedAt = try r.req("startedAt", Conv.num)
        startedDay = try r.req("startedDay", Conv.str)
        updatedAt = try r.req("updatedAt", Conv.num)
        endedAt = try r.opt("endedAt", Conv.num)
        endedEarly = try r.opt("endedEarly", Conv.bool)
        added = try r.opt("added", Conv.array(Conv.str))
        sealedAt = try r.opt("sealedAt", Conv.num)
        extra = try r.opt("extra", Conv.bool)
        order = r.order
    }

    public var js: JSValue {
        var w = Writer()
        w.add("id", id); w.add("slot", slot); w.add("kind", kind); w.add("source", model: source)
        w.add("queue", array: queue) { .string($0) }
        w.add("cursor", cursor)
        w.add("items", array: items) { $0.js }
        w.add("current", current) { $0.js }
        w.add("lastLine", lastLine) { $0.js }
        w.add("startedAt", startedAt); w.add("startedDay", startedDay); w.add("updatedAt", updatedAt)
        w.add("endedAt", endedAt); w.add("endedEarly", endedEarly)
        w.add("added", array: added) { .string($0) }
        w.add("sealedAt", sealedAt)
        w.add("extra", extra)
        return w.build(order: order)
    }
}

/// lastEnded：{A?, B?}，各自为 null 或一个会话。
public struct LastEnded: JSCodable, Equatable {
    public var A: Field<Session>
    public var B: Field<Session>
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "sessions.lastEnded")
        A = try r.field("A", Conv.model(Session.self))
        B = try r.field("B", Conv.model(Session.self))
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("A", A) { $0.js }; w.add("B", B) { $0.js }
        return w.build(order: order)
    }
}

/// shizi.v2.sessions：A / B 两个槽（null = 空）与上一次结束的会话。
public struct Sessions: JSCodable, Equatable {
    public var A: Session?
    public var B: Session?
    public var lastEnded: LastEnded
    /// D83 今天的账（{day, handled, target?, done}，原样保留）。
    public var today: JSValue?
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "sessions")
        A = try r.req("A", Conv.nullable(Conv.model(Session.self)))
        B = try r.req("B", Conv.nullable(Conv.model(Session.self)))
        lastEnded = try r.req("lastEnded", Conv.model(LastEnded.self))
        today = r.raw("today")
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("A", A.map { $0.js } ?? .null); w.add("B", B.map { $0.js } ?? .null); w.add("lastEnded", model: lastEnded)
        w.add("today", today)
        return w.build(order: order)
    }
}

/// 保护副本（替换 / 清空前的白名单键原始字串，撤销用）。
public struct Safety: JSCodable, Equatable {
    public var version: Double
    public var kind: String
    public var createdAt: Double
    public var backupDate: Field<String>
    public var count: Double?
    /// {键: 原始字串}。
    public var payload: OrderedMap<String>
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "safety")
        version = try r.req("version", Conv.num)
        kind = try r.req("kind", Conv.str)
        createdAt = try r.req("createdAt", Conv.num)
        backupDate = try r.field("backupDate", Conv.str)
        count = try r.opt("count", Conv.num)
        payload = try OrderedMap(try r.req("payload", Conv.any), "safety.payload", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("version", version); w.add("kind", kind); w.add("createdAt", createdAt)
        w.add("backupDate", backupDate) { .string($0) }
        w.add("count", count)
        w.add("payload", payload.encode { .string($0) })
        return w.build(order: order)
    }
}

/// 事务日志（shizi.v2.txn）：每个被改键的旧值整份写进 prev（null = 原来没有）。
public struct Txn: JSCodable, Equatable {
    public var label: String
    public var at: Double
    public var keys: [String]
    public var prev: OrderedMap<String?>
    public var phase: String
    var order: [String]?
    public init(js: JSValue) throws {
        let r = try Reader(js, "txn")
        label = try r.req("label", Conv.str)
        at = try r.req("at", Conv.num)
        keys = try r.req("keys", Conv.array(Conv.str))
        prev = try OrderedMap(try r.req("prev", Conv.any), "txn.prev", Conv.nullable(Conv.str))
        phase = try r.req("phase", Conv.str)
        order = r.order
    }
    public var js: JSValue {
        var w = Writer()
        w.add("label", label); w.add("at", at)
        w.add("keys", array: keys) { .string($0) }
        w.add("prev", prev.encode { $0.map { JSValue.string($0) } ?? .null })
        w.add("phase", phase)
        return w.build(order: order)
    }
}

/// 形状层只要求「是对象」的键（funnel 漏斗、route 路由提示）：原样保留。
public struct OpaqueObject: JSCodable, Equatable {
    public var object: JSObject
    public init(js: JSValue) throws {
        guard case .object(let o) = js else { throw ModelError.shape("object") }
        object = o
    }
    public var js: JSValue { .object(object) }
}

public enum Models {
    /// 按形状表的键 id 解码再编码（`models.roundtrip` op 与测试用）。值必须先过 Schema 校验。
    public static func roundTrip(specId: String, value: JSValue) throws -> JSValue {
        switch specId {
        case "meta": return try Meta(js: value).js
        case "records": return try RecordsMonth(js: value).js
        case "sched": return try Sched(js: value).js
        case "ink": return try InkMonth(js: value).js
        case "inkRecord": return try Ink(js: value).js
        case "custom": return try Custom(js: value).js
        case "wordOff": return try WordOff(js: value).js
        case "settings": return try Settings(js: value).js
        case "photos": return try Photos(js: value).js
        case "legacy": return try Legacy(js: value).js
        case "backupMeta": return try BackupMeta(js: value).js
        case "sessions": return try Sessions(js: value).js
        case "funnel", "route": return try OpaqueObject(js: value).js
        case "safety": return try Safety(js: value).js
        case "txn": return try Txn(js: value).js
        default: throw CoreError.badArgs("no model for " + specId)
        }
    }
}
