import Foundation
import XCTest
@testable import ShiziCore

// 题库冷启动提速（JSON 解析的快路径、JSObject 一次散列写入与预留容量、buildCards 不建中间 meta 对象）的等价性：
// 与改动之前的写法（照抄在下面当参照）在真题库与全部包内资源 / 测试夹具上逐项比结果——
// 值的种类、数字的位模式、字符串的 UTF-8 字节、数组逐元素、对象的键与键序（Object.keys 序）逐个相同，
// 并且 JSON.stringify 的文字逐字节相同；出错的输入两边抛同一个错（同一位置）。
// 另打印新旧写法各一次的耗时：`BENCH deck-equiv <name> <ms>`（只打印，不断言耗时）。
final class DeckBuildEquivalenceTests: XCTestCase {
    // MARK: 参照（改动前的写法）

    /// 改动前的 JSONParser（逐字照抄，只改了名字）。
    private struct RefJSONParser {
        private let b: [UInt8]
        private var i = 0

        static func parse(_ text: String) throws -> JSValue {
            var p = RefJSONParser(bytes: Array(text.utf8))
            p.ws()
            let v = try p.value()
            p.ws()
            if p.i != p.b.count { throw JSONError.syntax("trailing characters", offset: p.i) }
            return v
        }

        private init(bytes: [UInt8]) { b = bytes }

        private mutating func ws() {
            while i < b.count, b[i] == 0x20 || b[i] == 0x09 || b[i] == 0x0A || b[i] == 0x0D { i += 1 }
        }

        private func fail(_ m: String) -> JSONError { .syntax(m, offset: i) }

        private mutating func literal(_ s: String, _ v: JSValue) throws -> JSValue {
            let u = Array(s.utf8)
            guard i + u.count <= b.count, Array(b[i..<(i + u.count)]) == u else { throw fail("bad literal") }
            i += u.count
            return v
        }

        private mutating func value() throws -> JSValue {
            guard i < b.count else { throw fail("unexpected end") }
            switch b[i] {
            case 0x7B: return try object()
            case 0x5B: return try array()
            case 0x22: return .string(try string())
            case 0x74: return try literal("true", .bool(true))
            case 0x66: return try literal("false", .bool(false))
            case 0x6E: return try literal("null", .null)
            default: return .number(try number())
            }
        }

        private mutating func object() throws -> JSValue {
            i += 1
            var o = JSObject()
            ws()
            if i < b.count, b[i] == 0x7D { i += 1; return .object(o) }
            while true {
                ws()
                guard i < b.count, b[i] == 0x22 else { throw fail("expected key") }
                let k = try string()
                ws()
                guard i < b.count, b[i] == 0x3A else { throw fail("expected ':'") }
                i += 1
                ws()
                o[k] = try value()
                ws()
                guard i < b.count else { throw fail("unexpected end") }
                if b[i] == 0x2C { i += 1; continue }
                if b[i] == 0x7D { i += 1; return .object(o) }
                throw fail("expected ',' or '}'")
            }
        }

        private mutating func array() throws -> JSValue {
            i += 1
            var a: [JSValue] = []
            ws()
            if i < b.count, b[i] == 0x5D { i += 1; return .array(a) }
            while true {
                ws()
                a.append(try value())
                ws()
                guard i < b.count else { throw fail("unexpected end") }
                if b[i] == 0x2C { i += 1; continue }
                if b[i] == 0x5D { i += 1; return .array(a) }
                throw fail("expected ',' or ']'")
            }
        }

        private mutating func hex4() throws -> UInt32 {
            guard i + 4 <= b.count else { throw fail("short \\u escape") }
            var v: UInt32 = 0
            for _ in 0..<4 {
                let c = b[i]
                let d: UInt32
                switch c {
                case 0x30...0x39: d = UInt32(c - 0x30)
                case 0x41...0x46: d = UInt32(c - 0x41 + 10)
                case 0x61...0x66: d = UInt32(c - 0x61 + 10)
                default: throw fail("bad hex digit")
                }
                v = v * 16 + d
                i += 1
            }
            return v
        }

        private mutating func string() throws -> String {
            i += 1
            var out = [UInt8]()
            while true {
                guard i < b.count else { throw fail("unterminated string") }
                let c = b[i]
                if c == 0x22 { i += 1; break }
                if c < 0x20 { throw fail("control character in string") }
                if c != 0x5C { out.append(c); i += 1; continue }
                i += 1
                guard i < b.count else { throw fail("unterminated escape") }
                let e = b[i]
                i += 1
                switch e {
                case 0x22: out.append(0x22)
                case 0x5C: out.append(0x5C)
                case 0x2F: out.append(0x2F)
                case 0x62: out.append(0x08)
                case 0x66: out.append(0x0C)
                case 0x6E: out.append(0x0A)
                case 0x72: out.append(0x0D)
                case 0x74: out.append(0x09)
                case 0x75:
                    let start = i - 2
                    var cp = try hex4()
                    if cp >= 0xD800 && cp <= 0xDBFF {
                        guard i + 6 <= b.count, b[i] == 0x5C, b[i + 1] == 0x75 else { throw JSONError.loneSurrogate(offset: start) }
                        i += 2
                        let lo = try hex4()
                        guard lo >= 0xDC00 && lo <= 0xDFFF else { throw JSONError.loneSurrogate(offset: start) }
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                    } else if cp >= 0xDC00 && cp <= 0xDFFF {
                        throw JSONError.loneSurrogate(offset: start)
                    }
                    out.append(contentsOf: Array(String(Character(Unicode.Scalar(cp)!)).utf8))
                default: throw fail("bad escape")
                }
            }
            return String(decoding: out, as: UTF8.self)
        }

        private mutating func number() throws -> Double {
            let start = i
            if i < b.count, b[i] == 0x2D { i += 1 }
            guard i < b.count, b[i] >= 0x30 && b[i] <= 0x39 else { throw fail("bad number") }
            if b[i] == 0x30 { i += 1 } else { while i < b.count, b[i] >= 0x30 && b[i] <= 0x39 { i += 1 } }
            if i < b.count, b[i] == 0x2E {
                i += 1
                guard i < b.count, b[i] >= 0x30 && b[i] <= 0x39 else { throw fail("bad fraction") }
                while i < b.count, b[i] >= 0x30 && b[i] <= 0x39 { i += 1 }
            }
            if i < b.count, b[i] == 0x65 || b[i] == 0x45 {
                i += 1
                if i < b.count, b[i] == 0x2B || b[i] == 0x2D { i += 1 }
                guard i < b.count, b[i] >= 0x30 && b[i] <= 0x39 else { throw fail("bad exponent") }
                while i < b.count, b[i] >= 0x30 && b[i] <= 0x39 { i += 1 }
            }
            let text = String(decoding: b[start..<i], as: UTF8.self)
            guard let d = Double(text) else { throw fail("bad number") }
            return d
        }
    }

    /// 改动前的 Cards.buildCards（逐字照抄；applyContextOverride / splitWhitespace 没改，直接调）。
    private static func refBuildCards(seed: [JSValue], overrides: JSValue?) throws -> [JSValue] {
        let table = JSValue.object(Cards.overrideTable(overrides))
        var cards: [JSValue] = []
        cards.reserveCapacity(seed.count)
        for raw in seed {
            let w = try Cards.applyContextOverride(raw, table)
            guard case .string(let ans)? = w["ans"] else { throw CoreError.type("buildCards: ans is not iterable") }
            guard case .string(let py)? = w["py"] else { throw CoreError.type("buildCards: py.split is not a function") }
            let chars = ans.unicodeScalars.map { String($0) }
            let charsV = JSValue.array(chars.map { .string($0) })
            let pys = Cards.splitWhitespace(py)
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

    // MARK: 逐项比较

    /// 第一处不同的位置（nil = 逐项相同）：种类、数字位模式、字符串 UTF-8 字节、数组长度与元素、对象键数 / 键序（keys）/ 各值。
    private static func firstDifference(_ a: JSValue, _ b: JSValue) -> String? {
        switch (a, b) {
        case (.null, .null): return nil
        case (.bool(let x), .bool(let y)): return x == y ? nil : ": bool \(x) vs \(y)"
        case (.number(let x), .number(let y)): return x.bitPattern == y.bitPattern ? nil : ": number \(x) vs \(y)"
        case (.string(let x), .string(let y)): return x.utf8.elementsEqual(y.utf8) ? nil : ": string \(x.debugDescription) vs \(y.debugDescription)"
        case (.array(let x), .array(let y)):
            if x.count != y.count { return ": array count \(x.count) vs \(y.count)" }
            for n in 0..<x.count { if let d = firstDifference(x[n], y[n]) { return "[\(n)]" + d } }
            return nil
        case (.object(let x), .object(let y)):
            let kx = x.keys, ky = y.keys
            if x.count != y.count || kx.count != ky.count { return ": key count \(kx.count) vs \(ky.count)" }
            for n in 0..<kx.count {
                guard kx[n].utf8.elementsEqual(ky[n].utf8) else { return ": key #\(n) \(kx[n]) vs \(ky[n])" }
                guard let vx = x[kx[n]], let vy = y[ky[n]] else { return "." + kx[n] + ": missing value" }
                if let d = firstDifference(vx, vy) { return "." + kx[n] + d }
            }
            return nil
        default: return ": kind \(a.description.prefix(40)) vs \(b.description.prefix(40))"
        }
    }

    private func assertIdentical(_ a: JSValue, _ b: JSValue, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        if let d = Self.firstDifference(a, b) { XCTFail("\(what): differs at $\(d)", file: file, line: line); return }
        XCTAssertTrue(JSONWriter.stringify(a).utf8.elementsEqual(JSONWriter.stringify(b).utf8), "\(what): stringify differs", file: file, line: line)
    }

    private static func ms(_ body: () throws -> Void) rethrows -> Double {
        let t0 = DispatchTime.now().uptimeNanoseconds
        try body()
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    }

    private static func report(_ name: String, _ ms: Double) {
        print("BENCH deck-equiv \(name) \(String(format: "%.2f", ms))")
    }

    /// 新旧解析器对同一段文字：都成功则逐项相同；都失败则抛同一个错。
    private func assertSameParse(_ text: String, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let new: Result<JSValue, Error> = Result { try JSONParser.parse(text) }
        let ref: Result<JSValue, Error> = Result { try RefJSONParser.parse(text) }
        switch (new, ref) {
        case (.success(let a), .success(let b)): assertIdentical(a, b, what, file: file, line: line)
        case (.failure(let ea), .failure(let eb)):
            XCTAssertEqual(ea as? JSONError, eb as? JSONError, "\(what): different errors \(ea) vs \(eb)", file: file, line: line)
            XCTAssertNotNil(ea as? JSONError, "\(what): \(ea)", file: file, line: line)
        default: XCTFail("\(what): new \(new) vs ref \(ref)", file: file, line: line)
        }
    }

    // MARK: JSON 解析

    private static let bundledNames = ["deck", "deck-libraries", "deck-meta", "card-rules", "char-order", "copy", "credits", "epigraphs",
                                       "fsrs-config", "motion", "policy", "policy-meta", "signature", "unicode-scripts", "view-brand", "view-seal"]

    func testParserMatchesReferenceOnEveryBundledResource() throws {
        for name in Self.bundledNames {
            let text = try CoreResources.text(name)
            assertSameParse(text, "Bundled/\(name).json")
        }
        let deckText = try CoreResources.text("deck")
        Self.report("ref.parse.deck", try Self.ms { _ = try RefJSONParser.parse(deckText) })
        Self.report("new.parse.deck", try Self.ms { _ = try JSONParser.parse(deckText) })
        // 与 CoreResources.load 的缓存结果（App 实际用的那份）也相同
        assertIdentical(try JSONParser.parse(deckText), try CoreResources.load("deck"), "deck vs CoreResources.load")
    }

    func testParserMatchesReferenceOnEveryTestFixture() throws {
        let urls = Bundle.module.urls(forResourcesWithExtension: "json", subdirectory: "Fixtures") ?? []
        XCTAssertFalse(urls.isEmpty, "no fixtures found")
        for url in urls.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let text = String(decoding: try Data(contentsOf: url), as: UTF8.self)
            assertSameParse(text, "Fixtures/\(url.lastPathComponent)")
        }
    }

    /// 手写的边角：数字的各种写法（含 15 / 16 位整数、−0、超范围、指数）、转义与代理对、控制字符、重复键与下标形键、
    /// 嵌套、各种语法错误（错的位置必须相同）。
    func testParserMatchesReferenceOnEdgeCases() {
        var texts: [String] = [
            "0", "-0", "1", "-1", "7", "10", "123456789012345", "-123456789012345", "999999999999999", "1000000000000000",
            "1234567890123456", "9007199254740991", "9007199254740993", "-9007199254740993", "99999999999999999999999", "18446744073709551616",
            "0.1", "-0.0", "0.0", "1.0", "1e3", "1E-7", "2.5e+300", "1e400", "-1e400", "-1e-400", "5e-324", "123.456e-2", "100e0", "0e0",
            "007", "01", "-", "-a", "1.", "1.e2", "1e", "1e+", ".5", "+1", "--1", "0x10", "1 2",
            "\"\"", "\"abc\"", "\"a\\\"b\\\\c\\/d\\b\\f\\n\\r\\t\"", "\"\\u0041\\u00e9\\u4e00\\u0000\\u001f\"", "\"\\ud83d\\ude00\"",
            "\"\\ud83d\"", "\"\\ude00\"", "\"\\ud83dx\"", "\"\\ud83d\\u0041\"", "\"x\\ud83d\\ude00y\"",
            "\"pre\\nmid\\u0000post\"", "\"\u{FEFF}lead\"", "\"\u{1F600}\u{4E00}\u{E9}\"", "\"e\u{301}\"", "\"unterminated", "\"esc\\",
            "\"bad\\x\"", "\"ctl\u{01}\"", "\"tab\tin\"", "\"nl\nin\"", "\"\\u12\"", "\"\\u12G4\"", "\"\\U0041\"",
            "[]", "[ ]", "[\n\t]", "[1,2,[3,[4,{}]],\"x\"]", "[[[[[]]]]]", "[1,]", "[1 2]", "[", "]", "[1",
            "{}", "{ }", "{\"a\":1,\"b\":2,\"a\":3}", "{\"a\":1,\"a\":{\"b\":2}}",
            "{\"b\":1,\"2\":2,\"1\":3,\"01\":4,\"4294967294\":5,\"4294967295\":6,\"-1\":7,\"0\":8}",
            "{\"a\":{\"b\":{\"c\":[{\"d\":null}]}}}", "{\"a\":1,}", "{\"a\" 1}", "{a:1}", "{\"a\":}", "{\"a\"", "{", "{\"a\":1",
            "{\"k\":[{\"x\":1,\"x\":[2]},{\"y\":\"\\u0000\"}],\"k\":{},\"\":0}",
            "true", "false", "null", "tru", "nul", "fals", "truex", "  [true , false,null ]  ", "[1] x", "", "   ",
        ]
        // 长串（越过小字串的内联长度）、只在末尾带转义的长串
        texts.append("\"" + String(repeating: "a", count: 40) + "\"")
        texts.append("\"" + String(repeating: "\u{4E00}", count: 40) + "\\n\"")
        texts.append("[" + (0..<200).map { "{\"i\":\($0),\"s\":\"v\($0)\",\"n\":[\($0),-\($0).5]}" }.joined(separator: ",") + "]")
        for (n, t) in texts.enumerated() { assertSameParse(t, "edge #\(n) \(t.debugDescription.prefix(60))") }
    }

    /// JSObject 的写入（一次散列）：新键排在最后、旧键原位替换、删除后再加排到最后、下标形键按数值升序在前。
    func testJSObjectInsertionOrderAndOverwrite() {
        var o = JSObject()
        o["b"] = .number(1)
        o["a"] = .number(2)
        o["b"] = .number(3)
        o["2"] = .number(4)
        o["1"] = .number(5)
        XCTAssertEqual(o.keys, ["1", "2", "b", "a"])
        XCTAssertEqual(o["b"], .number(3))
        o["b"] = nil
        o["b"] = .number(6)
        XCTAssertEqual(o.keys, ["1", "2", "a", "b"])
        XCTAssertEqual(o.count, 4)
        var r = JSObject(minimumCapacity: 8)
        for k in ["1", "2", "a", "b"] { r[k] = o[k] }
        XCTAssertEqual(r, o)
        XCTAssertEqual(JSONWriter.stringify(.object(r)), JSONWriter.stringify(.object(o)))
    }

    // MARK: buildCards

    func testBuildCardsMatchesReferenceOnRealDeck() throws {
        let data = DeckData.shared
        let overrides = JSValue.object(data.overrides)
        var new: [JSValue] = [], ref: [JSValue] = []
        Self.report("ref.buildCards", try Self.ms { ref = try Self.refBuildCards(seed: data.seed, overrides: overrides) })
        Self.report("new.buildCards", try Self.ms { new = try Cards.buildCards(seed: data.seed, overrides: overrides) })
        XCTAssertGreaterThan(ref.count, 7000)
        assertIdentical(.array(new), .array(ref), "real deck cards")
        assertIdentical(.array(DeckCards.shared.cards), .array(ref), "DeckCards.shared.cards")
        // 不带覆盖表
        assertIdentical(.array(try Cards.buildCards(seed: data.seed, overrides: nil)), .array(try Self.refBuildCards(seed: data.seed, overrides: nil)), "real deck, no overrides")
        // cardKey 索引：每个键取第一张（直接查索引，不经 resolverOverride 测试替身）
        var first = OMap<JSValue>()
        for c in ref { let k = Cards.cardKey(c); if !first.has(k) { first[k] = c } }
        XCTAssertEqual(DeckCards.shared.index.keys, first.keys)
        for (k, c) in first.entries { assertIdentical(DeckCards.shared.index[k] ?? .null, c, "index \(k)") }
    }

    /// 真题库的行改出各种形状：ci 缺 / 非整数 / 越界 / 负（逐字出卡那一支）、拼音空白各样、promptHint 有 / 空、hint 缺、
    /// 缺省字段为假值、额外字段；再配上 gloss / w / py / promptHint / boost 各种覆盖。逐张与参照相同；出错的行两边都抛同一个错。
    func testBuildCardsMatchesReferenceOnVariants() throws {
        let data = DeckData.shared
        let rows = Array(data.seed.prefix(400))
        var seed: [JSValue] = []
        var overrides = JSObject()
        for (n, raw) in rows.enumerated() {
            guard case .object(let row) = raw else { continue }
            seed.append(raw)
            var v = row
            switch n % 12 {
            case 0: v["ci"] = nil
            case 1: v["ci"] = .number(0.5); v["py"] = .string("  a  b\u{3000}c ")
            case 2: v["ci"] = .number(-1)
            case 3: v["ci"] = .number(99); v["target"] = nil
            case 4: v["ci"] = .string("1"); v["promptHint"] = .string("hint-\(n)")
            case 5: v["promptHint"] = .string(""); v["hint"] = nil
            case 6: v["common"] = .number(0); v["edu"] = .null; v["topic"] = .string(""); v["rank"] = nil
            case 7: v["extra"] = .bool(true); v["0"] = .number(1); v["promptHint"] = .number(3)
            case 8: v["ci"] = .number(.infinity); v["py"] = .string("")
            case 9: v["ci"] = nil; v["target"] = nil; v["ans"] = .string((row["ans"]?.stringValue ?? "") + (row["ans"]?.stringValue ?? ""))
            case 10: v["ci"] = .number(1); v["target"] = .string("")
            default: v["d"] = .number(-0.0); v["strokes"] = .number(.nan)
            }
            seed.append(.object(v))
            guard let t = row["target"]?.stringValue, let ans = row["ans"]?.stringValue else { continue }
            switch n % 7 {
            case 0: overrides[t] = .object(JSObject([("gloss", .string("g\(n)")), ("py", .string("  p\(n) ")), ("promptHint", .string(" ph "))]))
            case 1: overrides[t] = .object(JSObject([("w", .string(ans)), ("ci", row["ci"] ?? .null)]))
            case 2: overrides[t] = .object(JSObject([("w", .string(t + t)), ("ci", .number(1)), ("boost", .bool(true))]))
            case 3: overrides[t] = .object(JSObject([("gloss", .string("g")), ("preserveCommon", .bool(true)), ("py", .string(" "))]))
            case 4: overrides[t] = .object(JSObject([("w", .string(t)), ("ci", .number(2))])) // 位置不对：整条覆盖不生效
            case 5: overrides[t] = .object(JSObject([("boost", .bool(false)), ("promptHint", .number(1))]))
            default: break
            }
        }
        for table in [JSValue.object(overrides), .object(data.overrides), .null] {
            assertIdentical(.array(try Cards.buildCards(seed: seed, overrides: table)), .array(try Self.refBuildCards(seed: seed, overrides: table)), "variants")
        }
        assertIdentical(.array(try Cards.buildCards(seed: [], overrides: nil)), .array(try Self.refBuildCards(seed: [], overrides: nil)), "empty seed")
        // 出错的行：两边抛同一个错
        let bad: [JSValue] = [.object(JSObject([("py", .string("a"))])), .object(JSObject([("ans", .string("ab")), ("ci", .number(0)), ("target", .string("a"))])),
                              .object(JSObject([("ans", .number(1)), ("py", .string("a")), ("target", .string("a"))]))]
        for b in bad {
            var e1: Error?, e2: Error?
            do { _ = try Cards.buildCards(seed: [rows[0], b], overrides: nil) } catch { e1 = error }
            do { _ = try Self.refBuildCards(seed: [rows[0], b], overrides: nil) } catch { e2 = error }
            XCTAssertNotNil(e1)
            XCTAssertEqual(e1 as? CoreError, e2 as? CoreError)
        }
    }
}
