import Foundation

// src/session/ops/result.js and result-api.js: base view and cell contract.
public enum ResultModels {
    static func items(_ s: JSValue?, records: [JSValue]) -> [JSValue] {
        guard let s else { return records.map { JS.obj([("cardKey", $0["cardKey"]!), ("recordId", $0["id"]!), ("kind", $0["kind"]!)]) } }
        var items = s["items"]?.arrayValue ?? []
        if s["current"]?["answerSeen"] == .bool(true), let key = SessionRules.currentCardKey(s), !items.contains(where: { $0["cardKey"] == key }), let r = records.last(where: { $0["kind"] == .string("answer-seen") && $0["cardKey"] == key && $0["sessionId"] == s["id"] }) {
            items.append(JS.obj([("cardKey", key), ("recordId", r["id"]!), ("kind", .string("answer-seen"))]))
        }; return items
    }
    static func cells(_ state: JSObject, _ a: JSObject) throws -> [JSValue] {
        let s = SessionResults.locate(state, a)?.session, records = Records.sortById(SessionWrites.allRecords(state).filter { $0["sessionId"] == a["sessionId"] })
        return try items(s, records: records).enumerated().map { i,it in
            let record = records.first { $0["id"] == it["recordId"] }, kind = record?["kind"] ?? it["kind"] ?? .null
            let judgment = kind == .string("judged") ? record?["judgment"] ?? .null : .null
            return JS.obj([("index", .number(Double(i))), ("cardKey", it["cardKey"] ?? .null), ("recordId", record?["id"] ?? it["recordId"] ?? .null), ("char", record?["char"] ?? Records.charOfCardKey(it["cardKey"]).map(JSValue.string) ?? .null), ("kind", kind), ("judgment", judgment), ("caption", try Copy.t(kind == .string("judged") ? (judgment == .string("wrong") ? "X-RESULT.cellWrong" : "X-RESULT.cellCorrect") : kind == .string("answer-seen") ? "R-R02.cellSaw" : "X-RESULT.cellSkipped")), ("canChange", .bool(kind == .string("judged") && record != nil && !JS.truthy(record?["legacy"]) && s != nil && SessionRules.canCorrect(s, record?["id"])))])
        }
    }
    static func baseView(_ state: JSObject, _ a: JSObject) throws -> JSValue {
        let s = SessionResults.locate(state, a)?.session
        let variant = s.map { $0["kind"] == .string("picked") ? "picked" : $0["kind"] == .string("first") ? "first" : "daily" } ?? (a["slot"] == .string("B") ? "picked" : "daily")
        let cells = try cells(state, a).map { ViewSupport.ordered($0, "index char recordId kind judgment canChange") }
        return JS.obj([("found", .bool(s != nil)), ("variant", .string(variant)), ("early", .bool(JS.truthy(s?["endedEarly"]))), ("sessionId", a["sessionId"] ?? .null), ("slot", a["slot"] ?? .null), ("cells", .array(cells))])
    }
    static func cell(_ state: JSObject, _ a: JSObject) throws -> JSValue {
        let r = JS.truthy(a["recordId"]) ? SessionWrites.find(state, a["recordId"]) : nil, kind = r?["kind"] ?? a["kind"] ?? .null, char = r?["char"] ?? a["char"] ?? .string("")
        let found = SessionResults.locate(state, a), judged = kind == .string("judged") && r != nil && Records.isJudged(r)
        let changeable = judged && !JS.truthy(r?["legacy"]) && found != nil && SessionRules.canCorrect(found?.session, r?["id"])
        let judgment = judged ? r?["judgment"] ?? .null : .null
        let title = judged ? (judgment == .string("wrong") ? "R-R02.sheetTitleWrong" : "R-R02.sheetTitleCorrect") : kind == .string("answer-seen") ? "R-R02.sheetTitleSaw" : "R-R02.sheetTitleSkipped"
        let note = judged ? "R-R02.sheetNoteChange" : kind == .string("answer-seen") ? "R-R02.sheetNoteSaw" : "R-R02.sheetNoteSkipped"
        return JS.obj([("recordId", r?["id"] ?? a["recordId"] ?? .null), ("kind", JS.truthy(kind) ? kind : .string("skipped")), ("char", char), ("judgment", judgment), ("judged", .bool(judged)), ("changeable", .bool(changeable)), ("paper", .bool(Records.isPaperRecord(r))), ("inked", .bool(judged || (kind == .string("answer-seen") && r != nil))), ("title", try Copy.t(title, JSObject([("char", char)]))), ("note", try Copy.t(note)), ("topLabel", try Copy.t(changeable ? "R-R02.sheetCancel" : "R-R02.sheetClose")), ("flipLabel", changeable ? try Copy.t(judgment == .string("correct") ? "X-JUDGE.changeToWrong" : "X-JUDGE.changeToCorrect") : .null), ("emptyText", try Copy.t(judged ? "R-D07.noInkLarge" : "R-R02.sheetNoInk"))])
    }
}
