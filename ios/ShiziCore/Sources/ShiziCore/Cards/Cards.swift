import Foundation

// src/core/cards.js 的 1:1 移植：SEED + 语境覆盖 → cards[]；持久身份 cardKey；四库；题面模型。
// 卡片是 JSValue 对象（字段与键序同 JS 的 CARDS 构造：内容门禁的 protectedCardDataSha256 对键序敏感）。
// 题面字串、四库名、缺省值读生成的 card-rules.json（Swift 源码不写汉字）。

public enum Cards {
    static func hasOwn(_ table: JSObject, _ key: String) -> Bool { table[key] != nil }

    static func overrideTable(_ overrides: JSValue?) -> JSObject {
        if case .object(let o)? = overrides { return o }
        return JSObject()
    }

    /// `Array.from(value)` 的元素（字符串 → 码点；数组 → 原元素；其余空）。
    static func arrayFrom(_ v: JSValue?) -> [JSValue] {
        switch v {
        case .string(let s)?: return s.unicodeScalars.map { .string(String($0)) }
        case .array(let a)?: return a
        default: return []
        }
    }

    /// 单行 SEED 套用语境覆盖（#175 applyContextOverride 逐条移植）。不改动入参。
    public static func applyContextOverride(_ source: JSValue, _ overrides: JSValue?) throws -> JSValue {
        let table = overrideTable(overrides)
        let target: JSValue?
        if let t = source["target"], JSX.truthy(t) { target = t } else {
            guard case .string? = source["ans"] else { throw CoreError.type("applyContextOverride: ans is not iterable") }
            let idx = JSX.toNumber(source["ci"])
            let i = (idx.isNaN || idx == 0) ? 0 : idx
            let chars = arrayFrom(source["ans"])
            target = (i.rounded(.towardZero) == i && i >= 0 && i < Double(chars.count)) ? chars[Int(i)] : nil
        }
        guard let tgt = target, let override = hasOwn(table, Copy.jsString(tgt)) ? table[Copy.jsString(tgt)] : nil, JSX.truthy(override) else { return source }
        guard case .object(var row) = source else { return source }
        if JSX.truthy(override["boost"]) {
            let c = JSX.toNumber(row["common"])
            row["common"] = .number(Swift.max((c.isNaN || c == 0) ? 0 : c, 1.2))
        }
        if let w = override["w"], JSX.truthy(w) {
            let chars = arrayFrom(w)
            let ci = JSX.toNumber(override["ci"])
            guard ci.isFinite, ci.rounded(.towardZero) == ci, ci >= 0, ci < Double(chars.count), chars[Int(ci)] == tgt else { return source }
            let sameContext = source["ans"] == w && source["ci"] == .number(ci)
            row["ans"] = w
            row["ci"] = .number(ci)
            row["target"] = tgt
            if !sameContext { row["ctx"] = .string("override") }
        } else if let gloss = override["gloss"], JSX.truthy(gloss) {
            row["ans"] = tgt
            row["ci"] = .number(0)
            row["target"] = tgt
            row["ctx"] = .string("gloss")
            row["hint"] = gloss
            if override["preserveCommon"] != .bool(true) {
                let c = JSX.toNumber(row["common"])
                row["common"] = .number(Swift.max((c.isNaN || c == 0) ? 0 : c, 1))
            }
        }
        if case .string(let py)? = override["py"], !Query.jsTrim(py).isEmpty { row["py"] = .string(Query.jsTrim(py)) }
        if case .string(let ph)? = override["promptHint"] { row["promptHint"] = .string(Query.jsTrim(ph)) }
        return .object(row)
    }

    /// `s.split(/\s+/)`。
    static func splitWhitespace(_ s: String) -> [String] {
        var parts: [[UInt16]] = [[]]
        var inSpace = false
        for u in s.utf16 {
            if JSX.isJSSpace(u) {
                if !inSpace { parts.append([]) }
                inSpace = true
            } else {
                inSpace = false
                parts[parts.count - 1].append(u)
            }
        }
        return parts.map { String(decoding: $0, as: UTF16.self) }
    }

    /// SEED → cards[]（基础卡；自定义卡由调用方另行追加，带 custom:true）。
    public static func buildCards(seed: [JSValue], overrides: JSValue?) throws -> [JSValue] {
        let table = JSValue.object(overrideTable(overrides))
        var cards: [JSValue] = []
        cards.reserveCapacity(seed.count)
        for raw in seed {
            let w = try applyContextOverride(raw, table)
            guard case .string(let ans)? = w["ans"] else { throw CoreError.type("buildCards: ans is not iterable") }
            guard case .string(let py)? = w["py"] else { throw CoreError.type("buildCards: py.split is not a function") }
            let chars = ans.unicodeScalars.map { String($0) }
            let charsV = JSValue.array(chars.map { .string($0) })
            let pys = splitWhitespace(py)
            var meta = JSObject()
            for (k, def) in CardRules.defaults.entries {
                if let v = w[k], JSX.truthy(v) { meta[k] = v } else { meta[k] = def }
            }
            if let ph = w["promptHint"], JSX.truthy(ph) { meta["promptHint"] = ph }
            func make(ci: Int, target: JSValue?, py: JSValue) -> JSValue {
                var o = JSObject()
                o["word"] = w["ans"]
                o["chars"] = charsV
                o["ci"] = .number(Double(ci))
                if let t = target { o["target"] = t }
                o["py"] = py
                if let h = w["hint"] { o["hint"] = h }
                for (k, v) in meta.entries { o[k] = v }
                return .object(o)
            }
            if case .number(let ciD)? = w["ci"], ciD.isFinite, ciD.rounded(.towardZero) == ciD {
                var target: JSValue? = (ciD >= 0 && ciD < Double(chars.count)) ? .string(chars[Int(ciD)]) : nil
                if let t = w["target"], JSX.truthy(t) { target = t }
                var o = JSObject()
                o["word"] = w["ans"]
                o["chars"] = charsV
                o["ci"] = .number(ciD)
                if let t = target { o["target"] = t }
                o["py"] = w["py"]
                if let h = w["hint"] { o["hint"] = h }
                for (k, v) in meta.entries { o[k] = v }
                cards.append(.object(o))
                continue
            }
            for (ci, ch) in chars.enumerated() {
                let p: JSValue = (ci < pys.count && !pys[ci].isEmpty) ? .string(pys[ci]) : (w["py"] ?? .null)
                cards.append(make(ci: ci, target: .string(ch), py: p))
            }
        }
        return cards
    }

    /// 持久身份：base:<字> / custom:<字>。
    public static func cardKey(_ card: JSValue) -> String {
        (JSX.truthy(card["custom"]) ? "custom:" : "base:") + (card["target"].map { Copy.jsString($0) } ?? "undefined")
    }

    public static var libraries: [CardRules.Library] { CardRules.libraries }

    public static func libraryIdsFor(_ card: JSValue) -> [String] { libraries.filter { $0.test(card) }.map { $0.id } }

    public static func libraryById(_ id: String) -> CardRules.Library? { libraries.first { JSX.eq($0.id, id) } }

    static func repeatCount(_ card: JSValue) -> Int {
        guard case .array(let chars)? = card["chars"] else { return 0 }
        return chars.filter { c in card["target"].map { c == $0 } ?? false }.count
    }

    /// 题面模型（D16 / R-W28）：按码点逐格；原目标位 blank 带拼音，其余同一目标字位 repeatBlank（□）。copy 缺省 = 生成的 promptCopy。
    /// copy 里缺的键等同 JS 的 undefined（输出里不出现该键）。
    public static func promptModel(_ card: JSValue, copy: JSObject? = nil) throws -> JSValue {
        let cp = copy ?? CardRules.promptCopy
        guard case .array(let chars)? = card["chars"] else { throw CoreError.type("promptModel: card.chars.map is not a function") }
        func obj(_ pairs: [(String, JSValue?)]) -> JSValue {
            var o = JSObject()
            for (k, v) in pairs { if let v = v { o[k] = v } }
            return .object(o)
        }
        var segments: [JSValue] = []
        for (i, ch) in chars.enumerated() {
            if case .number(let ci)? = card["ci"], ci == Double(i) {
                let py = card["py"].flatMap { JSX.truthy($0) ? $0 : nil } ?? cp["missingPinyin"]
                segments.append(obj([("kind", .string("blank")), ("text", py)]))
            } else if let t = card["target"], ch == t {
                segments.append(obj([("kind", .string("repeatBlank")), ("text", cp["repeatBlankGlyph"]), ("label", cp["repeatBlankLabel"])]))
            } else {
                segments.append(obj([("kind", .string("text")), ("text", ch)]))
            }
        }
        var contentHint: JSValue?
        if JSX.truthy(card["custom"]) {
            contentHint = card["hint"]
        } else if JSX.eq(card["ctx"], "gloss"), let h = card["hint"], JSX.truthy(h) {
            contentHint = h
        } else if let ph = card["promptHint"], JSX.truthy(ph) {
            contentHint = ph
        } else {
            contentHint = JSX.eq(card["ctx"], "fallback") ? cp["fallbackHint"] : .string("")
        }
        if !JSX.truthy(contentHint) { contentHint = .string("") }
        let instruction: JSValue? = repeatCount(card) > 1 ? cp["repeatInstruction"] : .string("")
        let visible = [contentHint, instruction].compactMap { $0 }.filter { JSX.truthy($0) }.map { Copy.jsString($0) }.joined(separator: " ")
        return obj([("segments", .array(segments)), ("visibleHint", .string(visible)), ("contentHint", contentHint), ("instruction", instruction)])
    }

    public static func visibleHint(_ card: JSValue, copy: JSObject? = nil) throws -> JSValue {
        try promptModel(card, copy: copy)["visibleHint"] ?? .string("")
    }

    static func escapeHTML(_ text: String) -> String {
        var out = ""
        for u in text.unicodeScalars {
            switch u {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            case "\"": out += "&quot;"
            case "'": out += "&#39;"
            default: out.unicodeScalars.append(u)
            }
        }
        return out
    }

    /// 纯字符串题面（与 #175 index.html promptHTML 逐字同形；另对 HTML 特殊字符转义）。
    public static func promptHTML(_ card: JSValue, copy: JSObject? = nil) throws -> String {
        guard case .array(let segs)? = try promptModel(card, copy: copy)["segments"] else { return "" }
        return segs.map { seg -> String in
            let text = escapeHTML(seg["text"].map { Copy.jsString($0) } ?? "undefined")
            switch seg.str("kind") {
            case "blank"?: return "<span class=\"blank\">\(text)</span>"
            case "repeatBlank"?:
                return "<span class=\"blank repeatBlank\" role=\"img\" aria-label=\"\(escapeHTML(seg["label"].map { Copy.jsString($0) } ?? "undefined"))\">\(text)</span>"
            default: return "<span class=\"given\">\(text)</span>"
            }
        }.joined()
    }
}

/// 题库运行时访问（src/data/deck.js 的无 DOM 部分）：卡片列表与 cardKey 索引、可练谓词、「换掉这个词语」。
public final class DeckCards {
    public let cards: [JSValue]
    let index: OMap<JSValue>

    public static let shared: DeckCards = {
        do { return try DeckCards(seed: DeckData.shared.seed, overrides: .object(DeckData.shared.overrides)) } catch { fatalError("ShiziCore deck cards: \(error)") }
    }()

    public init(seed: [JSValue], overrides: JSValue?) throws {
        cards = try Cards.buildCards(seed: seed, overrides: overrides)
        var map = OMap<JSValue>()
        for c in cards {
            let k = Cards.cardKey(c)
            if !map.has(k) { map[k] = c }
        }
        index = map
    }

    /// 测试替身（src/data/deck.js setCardResolver 的同一件事：QA 夹具 writeOverflowPrompt 把某张卡换掉）：回 nil 的键照常查题库。
    public static var resolverOverride: ((String) -> JSValue?)?

    /// cardKey → 卡片（base:<字> 查题库；其余 nil）。
    public func cardForKey(_ key: String) -> JSValue? {
        if let o = Self.resolverOverride, let card = o(key) { return card }
        guard key.utf8.starts(with: "base:".utf8) else { return nil }
        return index[key]
    }

    /// 可练 = 题库里的 base: 卡。
    public func isPracticable(_ key: String) -> Bool { cardForKey(key) != nil }

    /// 卡片有没有可换掉的语境词（多字词；仅拼音题 fallback 与释义题 gloss 不算）。
    public static func hasContextWord(_ card: JSValue?) -> Bool {
        guard let card = card, JSX.truthy(card), case .array(let chars)? = card["chars"] else { return false }
        return chars.count > 1 && !JSX.eq(card["ctx"], "fallback") && !JSX.eq(card["ctx"], "gloss")
    }

    /// 「换掉这个词语」生效后的卡片（R-D05）：词语只剩目标字、ctx = fallback、去掉 promptHint。
    public static func withWordOff(_ card: JSValue?, _ wordOff: JSValue?) -> JSValue? {
        guard let card = card, JSX.truthy(card), let wo = wordOff, JSX.truthy(wo), case .object(let off) = wo else { return card }
        guard off[Cards.cardKey(card)] != nil, hasContextWord(card), case .object(var rest) = card else { return card }
        rest["promptHint"] = nil
        let t = card["target"]
        rest["word"] = t
        rest["chars"] = t.map { .array([$0]) }
        rest["ci"] = .number(0)
        rest["ctx"] = .string("fallback")
        return .object(rest)
    }
}
