import XCTest
@testable import ShiziCore

/// S2（调度规则 v2，D83）：这些契约场景里有写错 / 看答案 / 跳过 / 写完一组——当天重考、今天的进度（sessions.today）、
/// 复习日期只看第一次让 Swift 的回包与状态和 JS 参考不同（D82：会话域的 JS 对照退役）。对应的原生规则测试见 TodayPlanTests。
let d83RetiredSessionContracts: Set<String> = [
    "judge through the API = the web judgment path, field by field (records, sched/FSRS, ink, session, lastEnded)",
    "judge reply on the last card says finished; exit navigates to the result page",
    "D07: a failed judgment changes nothing and does not advance; the retry records once",
    "open: recovery is idempotent (a judged-but-not-advanced card is advanced once), snapshot + copy in one reply",
    "hint op: every tap = the web hint path field by field, up to the whole char (= answer seen, D64 ①)",
    "hint op: no group data → one stroke per tap; a segment already written is skipped (same skip as the web)",
    "hints feed the judgment the same way on both paths (D66 ②: review with 2+ hints)",
    "snapshot: hint range, answer seen and the previous card line (text; the 修改 › action text comes with it)",
    "correct op: 改判 = the web commitCorrection field by field, flips once and never counts twice (D19 / D07)",
    "correct op: only the line record of this session can be changed (sessions.canCorrect); a later card closes the door",
    "correct op state: sheet data = the record (char, judgment, own strokes from the stored ink); a failed write changes nothing and the retry applies once",
    "showAnswer = commitAnswerSeen: answer-seen record + straight into the trace phase (D64 ②), a review char gets one Again (D66 ①)",
    "answer flow: trace → 凭记忆写 (retrace) → 下一个, strokes included — web path and API path agree on every commit (D70 ② no self ink, D66 ① Again)",
    "answer flow: 再描一遍 (retrace → trace) and the recall-after-answer-seen path (hint gave the whole char) behave like the web",
    "answer ops: a failed write changes nothing (D07), the retry succeeds once; a stale card is refused with the advanced snapshot; bad phase refused",
    "answer flow: 下一个 on the last char finishes the group in the same call (same order as the web page)",
    "skip + undoSkip = commitSkip + commitUndoSkip: record, session, hints and the strokes written back, field by field",
    "skip: writes the same skipped record as the web (no judgment, not re-implemented)",
    "skip: D07 — a failed skip changes nothing; the retry records once; a second skip of the same card is stale",
    "undoSkip: only the last skipped record can be undone (stale otherwise); a failed undo changes nothing and retries",
    "skip of the last char finishes the group; exit hands the undo chance (remaining ms + strokes) to the result page / source page",
    "end: counts and commit = endConfirmCounts + commitEndGroup (web path); judged > 0 → result page, none judged → back to the source",
    "prompt fill: the blank cell carries the answer only in the trace phase (web REVEAL_PHASES), never in recall / retrace (D16)",
    "B2.7 result op = the web result page mount (commitFinish, idempotent) + the view of the same resultModel",
    "B2.7 result view (page side): work cells / rows / kuan / reveal come from the web result page functions",
    "B2.7 resultCell: the sheet model is the web ResultCellSheet (title / note / top label / flip); skipped and answer-seen only look",
    "B2.7 resultCorrect = commitResultCorrection field by field (D19: same record, corrections appended, sched replayed); once only; failure changes nothing",
    "B2.7 resultAdd / resultSealed = commitAdded / commitSealed (web path), the seal sound is asked for once per group",
    "B2.7 resultUndoSkip = commitResultSkipUndo (session back in the slot, record removed, strokes written back), then the page goes back to the write page",
    "B2.7 resultAgain = the web 再写一组 (startNextA with the group source), then the page replaces the result with the write page (D70)",
    "B2.7 resultExit: leave → the web leaveTo(model.leave); redo → the wrong chars of this group; detail / share pass through; nothing is written",
]

final class SessionContractTests: XCTestCase {
    // test/ui/native-write.test.mjs — original contract names are preserved per fixture group.
    // JS real Store → Swift real Store; compare every reply and full normalized store snapshot.
    func testWriteAndResultContracts() throws {
        JSMath.flavor = .v8
        let fixture = try loadFixture("session-contract")
        for group in fixture["groups"]!.arrayValue! where !d83RetiredSessionContracts.contains(JS.string(group["name"])) {
            let engine = CoreEngine(timeZone: TimeZone(identifier: group["tz"]!.stringValue!)!)
            for (i,step) in group["steps"]!.arrayValue!.enumerated() {
                let result = engine.handle(step["request"]!), label = JS.string(group["name"]) + " [" + JS.string(group["backend"]) + "] step " + String(i)
                XCTAssertEqual(result["ok"], .bool(true), label)
                XCTAssertEqual(JSONWriter.stringify(result["reply"] ?? .null), JSONWriter.stringify(step["reply"] ?? .null), label)
                XCTAssertEqual(JSONWriter.stringify(result["state"] ?? .null), JSONWriter.stringify(step["state"] ?? .null), label)
            }
        }
    }
    // test/ui/native-write.test.mjs — D07: a failed judgment changes nothing and does not advance; the retry records once
    func testFailurePublishesNothingAndRetryRecordsOnce() throws {
        let doc = try loadFixture("session-contract")
        for group in doc["groups"]!.arrayValue! where JS.string(group["name"]).hasPrefix("D07:") {
            let steps = group["steps"]!.arrayValue!
            XCTAssertEqual(steps[3]["state"]?["store"]?["state"], steps[2]["state"]?["store"]?["state"])
            XCTAssertEqual(steps[4]["state"]?["store"]?["state"], steps[5]["state"]?["store"]?["state"])
            XCTAssertEqual(steps[5]["reply"]?["error"]?["kind"], .string("stale"))
        }
    }
}
