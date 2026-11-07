import Foundation
import ShiziCore
import ShiziCoreEngine

// shizi-core-cli：ShiziCore 的 JSON 行协议外壳（B4.0）。stdin 一行一个请求，stdout 一行一个回包（协议见 ../../README.md）。
//   shizi-core-cli [--tz <IANA 时区>] [--math v8|darwin]
//     时区缺省取环境变量 TZ，再缺省取系统时区（与 node 侧 process.env.TZ 对齐）；
//     --math：Math.exp / log 跟 V8（缺省，差分的参考实现）还是 Darwin libm（= iOS 上的 JavaScriptCore；B4.2 JSMath.flavor）
// 空行忽略；EOF 退出 0。stderr 只在启动参数错时写。

//   shizi-core-cli cards-dump
//     D84：题库卡片展开（内容 / 治理 / 字体门禁用，取代原 JS 的 cards）。stdin 一份 JSON {seed, overrides}（缺省 = 包内 deck.json），
//     stdout 一行一张卡：{card, cardKey, promptHTML, visibleHint, contentHint, instruction, libraries}（键序同 Cards 的 JSValue）。

if CommandLine.arguments.dropFirst().first == "cards-dump" {
    do {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        let text = String(decoding: input, as: UTF8.self)
        let deck: JSValue
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            deck = .object(JSObject([("seed", .array(DeckData.shared.seed)), ("overrides", .object(DeckData.shared.overrides))]))
        } else {
            deck = try JSONParser.parse(text)
        }
        let cards = try Cards.buildCards(seed: deck["seed"]?.arrayValue ?? [], overrides: deck["overrides"] ?? .object(JSObject()))
        var out = ""
        for card in cards {
            let model = try Cards.promptModel(card)
            var row = JSObject()
            row["card"] = card
            row["cardKey"] = .string(Cards.cardKey(card))
            row["promptHTML"] = .string(try Cards.promptHTML(card))
            row["visibleHint"] = model["visibleHint"] ?? .string("")
            if let v = model["contentHint"] { row["contentHint"] = v }
            if let v = model["instruction"] { row["instruction"] = v }
            row["libraries"] = .array(Cards.libraryIdsFor(card).map { .string($0) })
            out += JSONWriter.stringify(.object(row))
            out += "\n"
        }
        FileHandle.standardOutput.write(out.data(using: .utf8)!)
        exit(0)
    } catch {
        FileHandle.standardError.write("cards-dump: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

var tzName = ProcessInfo.processInfo.environment["TZ"]
var argv = CommandLine.arguments.dropFirst()
while let a = argv.first {
    argv = argv.dropFirst()
    if a == "--tz", let v = argv.first {
        tzName = v
        argv = argv.dropFirst()
    } else if a == "--math", let v = argv.first, v == "v8" || v == "darwin" {
        JSMath.flavor = v == "v8" ? .v8 : .darwin
        argv = argv.dropFirst()
    } else {
        FileHandle.standardError.write("usage: shizi-core-cli [--tz <zone>] [--math v8|darwin]\n".data(using: .utf8)!)
        exit(2)
    }
}

var timeZone = TimeZone.current
if let name = tzName, !name.isEmpty {
    guard let tz = TimeZone(identifier: name) else {
        FileHandle.standardError.write("unknown time zone: \(name)\n".data(using: .utf8)!)
        exit(2)
    }
    timeZone = tz
}

setvbuf(stdout, nil, _IOLBF, 0)
let engine = CoreEngine(timeZone: timeZone)
while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    print(engine.handle(line: line))
}
