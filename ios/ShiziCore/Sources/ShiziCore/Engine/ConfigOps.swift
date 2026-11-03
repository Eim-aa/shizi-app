import Foundation

// B4.1 的 op（配置 / 题库 / 题记 / 文案 / 落款汉字数字）。JS 参考实现（同名、同参数校验、同错误码）已随 D84 退役。

func obj(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }

extension CoreEngine {
    /// 可缺省的 vars（对象）。
    static func optionalVars(_ a: JSObject) throws -> JSObject? {
        guard let v = a["vars"] else { return nil }
        guard let o = v.objectValue else { throw CoreError.badArgs("vars must be an object") }
        return o
    }

    static let configOps: [String: Op] = [
        "config.get": { _, a in
            let name = try string(a, "name")
            guard let v = Config.named(name) else { throw CoreError.range("unknown config: " + name) }
            return v
        },

        "deck.meta": { _, _ in
            let d = DeckData.shared
            return obj([
                ("key", .string(DeckData.key)), ("fingerprint", .string(DeckData.fingerprint)),
                ("seed", .number(Double(d.seed.count))), ("overrides", .number(Double(d.overrides.count))), ("groups", .number(Double(d.groups.count))),
            ])
        },
        "deck.seed": { _, a in
            let i = try int(a, "index", 10_000_000)
            let seed = DeckData.shared.seed
            return i >= 0 && i < seed.count ? seed[i] : .null
        },
        "deck.override": { _, a in DeckData.shared.overrides[try string(a, "char")] ?? .null },
        "deck.groups": { _, a in DeckData.shared.groups[try string(a, "char")] ?? .null },

        "epigraphs.index": { e, a in .number(try Epigraphs.indexFor(day: try required(a, "day"), dates: e.dates)) },
        "epigraphs.for": { e, a in
            let ep = try Epigraphs.epigraph(for: try required(a, "day"), dates: e.dates)
            return obj([("lines", .array(ep.lines.map { .string($0) })), ("source", .string(ep.source))])
        },
        "epigraphs.author": { _, a in
            .string(Epigraphs.author(of: Epigraph(lines: [], source: try string(a, "source"))))
        },

        "copy.has": { _, a in .bool(Copy.has(try string(a, "key"))) },
        "copy.t": { _, a in try Copy.t(try string(a, "key"), try optionalVars(a)) },
        "copy.format": { _, a in
            let template = try required(a, "template")
            switch template {
            case .string, .array: return Copy.format(template, try optionalVars(a))
            default: throw CoreError.badArgs("template must be a string or an array")
            }
        },
        "copy.inkKey": { _, a in
            let base = try string(a, "base")
            if let flag = a["perRecordInk"] {
                guard case .bool(let b) = flag else { throw CoreError.badArgs("perRecordInk must be a boolean") }
                return .string(Copy.inkKey(base, perRecordInk: b))
            }
            return .string(Copy.inkKey(base))
        },
        "copy.tRef": { _, a in try Copy.tRef(try required(a, "value")) },

        "dates.cnDigits": { _, a in .string(try Dates.cnDigits(try finite(try required(a, "n"), "n"))) },
        "dates.cnNumber": { _, a in .string(try Dates.cnNumber(try finite(try required(a, "n"), "n"))) },
        "dates.cnCount": { _, a in .string(try Dates.cnCount(try finite(try required(a, "n"), "n"))) },
        "dates.signatureDateParts": { e, a in try e.dates.signatureDateParts(try required(a, "day")) },
        "dates.signatureMonthParts": { e, a in try e.dates.signatureMonthParts(try required(a, "month")) },
    ]
}
