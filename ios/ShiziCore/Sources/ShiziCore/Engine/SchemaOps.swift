import Foundation

// B4.1 的 op（形状表校验 / 键工具 / 模型往返）。JS 参考实现已随 D84 退役。

extension CoreEngine {
    static func optionalString(_ a: JSObject, _ k: String) throws -> String? {
        guard let v = a[k] else { return nil }
        guard let s = v.stringValue else { throw CoreError.badArgs(k + " must be a string") }
        return s
    }

    static func nullable(_ s: String?) -> JSValue { s.map { .string($0) } ?? .null }

    static let schemaOps: [String: Op] = [
        "schema.keys": { _, _ in
            obj([
                ("KEYS", .object(JSObject(Schema.keys.map { ($0.name, JSValue.string($0.key)) }))),
                ("DOMAINS", .array(Schema.domains.map { .string($0) })),
                ("BACKUP_WHITELIST", .array(Schema.backupWhitelist.map { .string($0) })),
                ("BACKUP_EXCLUDED", .array(Schema.backupExcluded.map { .string($0) })),
                ("KEY_SPECS", .array(Schema.keySpecs.map {
                    obj([("id", .string($0.id)), ("key", nullable($0.key)), ("pattern", nullable($0.pattern)), ("domain", nullable($0.domain))])
                })),
            ])
        },
        "schema.keyInfo": { _, a in
            let key = try string(a, "key")
            guard let spec = Schema.specForKey(key) else { return .null }
            return obj([("id", .string(spec.id)), ("domain", nullable(spec.domain)), ("backup", .bool(Schema.isBackupKey(key)))])
        },
        "schema.keyFacts": { _, a in
            let key = try string(a, "key")
            let ink = Schema.parseInkRecordKey(key)
            return obj([
                ("isRecordsKey", .bool(Schema.isRecordsKey(key))),
                ("monthOfRecordsKey", nullable(Schema.monthOfRecordsKey(key))),
                ("isInkKey", .bool(Schema.isInkKey(key))),
                ("monthOfInkKey", nullable(Schema.monthOfInkKey(key))),
                ("parseInkRecordKey", ink.map { obj([("month", .string($0.month)), ("id", .string($0.id))]) } ?? .null),
                ("isInkStorageKey", .bool(Schema.isInkStorageKey(key))),
                ("monthOfKey", nullable(Schema.monthOfKey(key))),
                ("isBackupKey", .bool(Schema.isBackupKey(key))),
                ("isCardKey", .bool(Schema.isCardKey(key))),
                ("charOfCardKey", nullable(Schema.charOfCardKey(key))),
                ("corruptKeyFor", .string(Schema.corruptKeyFor(key))),
            ])
        },
        "schema.valueFacts": { _, a in
            let v = try required(a, "value")
            let s = v.stringValue
            return obj([
                ("isLocalDay", .bool(Schema.isLocalDay(v))),
                ("isSingleChar", .bool(s.map(Schema.isSingleChar) ?? false)),
                ("isMonthKey", .bool(s.map(Schema.isMonthKey) ?? false)),
                ("isCardKey", .bool(Schema.isCardKey(v))),
                ("isRecordId", .bool(Schema.isRecordId(v))),
                ("isSessionId", .bool(Schema.isSessionId(v))),
                ("serialOf", .number(s.map(Schema.serialOf) ?? 0)),
            ])
        },
        "schema.makeKey": { _, a in
            let month = try string(a, "month")
            let id = try string(a, "id")
            return obj([
                ("recordsKey", .string(Schema.recordsKey(month))),
                ("inkKey", .string(Schema.inkKey(month))),
                ("inkRecordKey", .string(Schema.inkRecordKey(month, id))),
            ])
        },
        "schema.keyForDomain": { _, a in
            let domain = try string(a, "domain")
            return .string(try Schema.keyForDomain(domain, month: try optionalString(a, "month")))
        },
        "schema.inkOf": { e, a in
            let record = try required(a, "record")
            return obj([
                ("month", nullable(Schema.inkMonthOf(record, timeZone: e.dates.timeZone))),
                ("id", nullable(Schema.inkIdOf(record))),
            ])
        },
        "schema.validateValue": { _, a in
            nullable(Schema.validateValue(key: try string(a, "key"), value: try required(a, "value")))
        },
        "schema.parseAndValidate": { _, a in
            switch Schema.parseAndValidate(key: try string(a, "key"), raw: try required(a, "raw")) {
            case .ok(let v): return obj([("ok", .bool(true)), ("value", v)])
            case .failed(let r): return obj([("ok", .bool(false)), ("reason", .string(r))])
            }
        },
        "schema.parseBackupV2": { _, a in Schema.parseBackupV2(try required(a, "obj")) },
        "schema.validateRecord": { _, a in
            nullable(Schema.validateRecord(try required(a, "record"), month: try optionalString(a, "month")))
        },
        "schema.validateRecordsMonth": { _, a in
            nullable(Schema.validateRecordsMonth(try required(a, "value"), month: try string(a, "month")))
        },
        "schema.validateInk": { _, a in nullable(Schema.validateInk(try required(a, "value"))) },
        "schema.validateSession": { _, a in
            nullable(Schema.validateSession(try required(a, "session"), slot: try optionalString(a, "slot")))
        },

        // 形状表通过的值，经模型解码再编码，必须与原值逐字节相同（键序也一样）；JS 一侧是恒等。
        "models.roundtrip": { _, a in
            let key = try string(a, "key")
            let value = try required(a, "value")
            if let err = Schema.validateValue(key: key, value: value) { return obj([("valid", .bool(false)), ("reason", .string(err))]) }
            let spec = Schema.specForKey(key)!
            return obj([("valid", .bool(true)), ("value", try Models.roundTrip(specId: spec.id, value: value))])
        },
    ]
}
