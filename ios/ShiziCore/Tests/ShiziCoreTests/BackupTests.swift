import Foundation
import XCTest
@testable import ShiziCore

// test/core/backup.test.mjs 的转写（B4.4，20 条）：core/backup.js 的纯函数（文件构造、导入校验报告、签名、丢失范围、状态句）与保护副本编排
// （真 Store + 内存磁盘 + 故障注入：副本失败不替换且不回收、覆盖失败已回滚、撤销失败副本保留、清空与撤销、导出记账），
// 第 19 条的页面文案小工具（mine/backup.js）在 BackupText。

private let NOW = localMs(2026, 9, 24, 20)
private let cHe = "\u{548C}", cZi = "\u{5B57}", cKan2 = "\u{770B}", cXian = "\u{9C9C}", cJiu2 = "\u{65E7}", cShu = "\u{4E66}", cYue = "\u{6708}", cRi = "\u{65E5}", cXin = "\u{65B0}"

private func ms(_ day: String, _ hour: Int = 9) -> Double { dayMs(day, hour) }

private func brec(_ serial: Int, _ char: String, _ day: String, kind: String = "judged", judgment: String = "correct") -> JSValue {
    var o = JSObject([("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string("s1")), ("kind", .string(kind)),
                      ("at", .number(ms(day) + Double(serial))), ("localDay", .string(day)),
                      ("help", .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))])))])
    if kind == "judged" { o["judgment"] = .string(judgment) }
    return .object(o)
}

private let FSRS = J(#"{"stability":3,"difficulty":5,"state":2}"#)
private func sched(_ due: String, _ last: Double) -> JSValue { JS.obj([("fsrs", FSRS), ("due", .string(due)), ("lastJudgedAt", .number(last))]) }

private func currentState() -> JSObject {
    JSObject([
        ("records", JS.obj([
            ("2026-07", .array([brec(1, cYong, "2026-07-03"), brec(2, cHe, "2026-07-04", judgment: "wrong")])),
            ("2026-09", .array([brec(3, cYong, "2026-09-02"), brec(4, cZi, "2026-09-20"), brec(5, cKan2, "2026-09-21", kind: "answer-seen")])),
        ])),
        ("sched", JS.obj([("base:" + cYong, sched("2026-10-01", ms("2026-09-02"))), ("base:" + cHe, sched("2026-09-25", ms("2026-07-04"))), ("base:" + cZi, sched("2026-10-05", ms("2026-09-20")))])),
        ("custom", JS.obj([("added", .array([JS.obj([("char", .string(cXian)), ("at", .number(ms("2026-09-01")))])]))])),
        ("settings", J(#"{"library":"adv3000","sound":false}"#)),
        ("backupMeta", JS.obj([("lastExportAt", .number(ms("2026-09-10"))), ("lastExportSig", .string("x")), ("lastConclusion", .null)])),
        ("sessions", J(#"{"A":null,"B":null,"lastEnded":{}}"#)),
    ])
}

private func oldBackupState() -> JSObject {
    JSObject([
        ("meta", JS.obj([("schema", .number(2)), ("serial", .number(9)), ("createdAt", .number(ms("2026-06-01"))), ("months", J(#"["2026-08"]"#))])),
        ("records", JS.obj([("2026-08", .array([brec(7, cJiu2, "2026-08-30"), brec(9, cShu, "2026-08-31")]))])),
        ("sched", JS.obj([("base:" + cJiu2, sched("2026-09-30", ms("2026-08-30")))])),
        ("settings", J(#"{"library":"core3500"}"#)),
        ("backupMeta", JS.obj([("lastExportAt", .number(ms("2026-09-01"))), ("lastExportSig", .string("old")), ("lastConclusion", .null)])),
    ])
}

private func makeStore(_ initial: JSObject? = nil) -> StoreEnv {
    let env = freshStore(.local, now: NOW)
    if let s = initial { XCTAssertTrue(ok(env.store.seed(.object(s)))) }
    return env
}

private func v2Raw(_ d: TestDisk) -> [String] { d.snapshot().filter { $0.0.hasPrefix("shizi.") }.map { $0.0 + "=" + $0.1 } }

private func oldReport() throws -> JSObject {
    Backup.inspectBackup(.string(Backup.serializeBackup(.object(try Backup.buildBackupV2(oldBackupState(), now: ms("2026-09-01", 20))))), dates: shanghai)
}

private func withActiveSessions() -> JSObject {
    let A = sessionJS(8, queue: ["base:" + cYong, "base:" + cZi, "base:" + cHe], cursor: 1, items: [item("base:" + cYong, "r3")])
    var B = sessionJS(6, slot: "B", kind: "picked", queue: ["base:" + cZi], cursor: 1, items: [item("base:" + cZi, "r4")]).objectValue!
    B["endedAt"] = .number(ms("2026-09-20", 10))
    var s = currentState()
    s["sessions"] = JS.obj([("A", A), ("B", .null), ("lastEnded", JS.obj([("B", .object(B))]))])
    return s
}

private func lines(_ status: JSObject) -> [String] { status["lines"]!.arrayValue!.map { $0["key"]!.stringValue! } }

final class BackupTests: XCTestCase {
    // buildBackupV2: 只含白名单键、值 = 落盘字串、缺 meta 时补一份且 parseBackupV2 认得
    func testBuildBackupV2WhitelistRawValuesMetaFilledIn() throws {
        let env = makeStore(currentState())
        let state = env.store.state
        let obj = try Backup.buildBackupV2(state, now: NOW, serial: env.store.serial)
        XCTAssertEqual(obj["app"], .string("shizi"))
        XCTAssertEqual(obj["version"], .number(2))
        XCTAssertEqual(obj["date"], .string(try JSDate.isoString(NOW)))
        let keys = UTF16Order.sorted(obj["data"]!.objectValue!.keys)
        XCTAssertEqual(keys, ["shizi.v2.backupMeta", "shizi.v2.custom", "shizi.v2.meta", "shizi.v2.records.2026-07", "shizi.v2.records.2026-09", "shizi.v2.sched", "shizi.v2.settings"])
        XCTAssertNil(obj["data"]!["shizi.v2.sessions"], "sessions not in backup")
        for k in keys where k != SK("meta") { XCTAssertEqual(obj["data"]![k]!.stringValue, env.disk.rawGet(k), "\(k) equals stored raw") }
        XCTAssertEqual(J(obj["data"]![SK("meta")]!.stringValue!), JS.obj([("schema", .number(2)), ("serial", .number(env.store.serial)), ("createdAt", .number(NOW)), ("months", J(#"["2026-07","2026-09"]"#))]))
        XCTAssertEqual(Schema.parseBackupV2(J(Backup.serializeBackup(.object(obj))))["ok"], .bool(true))
        XCTAssertEqual(try Backup.backupFileName(NOW, dates: shanghai), "\u{62FE}\u{5B57}\u{5907}\u{4EFD}-2026-09-24.json")
        XCTAssertFalse(try Backup.backupFileName(NOW, dates: shanghai).lowercased().contains("shizi"))
        var withMeta = state
        withMeta["meta"] = J(#"{"schema":2,"serial":42,"createdAt":1,"months":["2026-07","2026-09"]}"#)
        XCTAssertEqual(J(try Backup.buildBackupV2(withMeta, now: NOW)["data"]![SK("meta")]!.stringValue!)["serial"], .number(42))
    }

    // inspectBackup: 报告（日期、字数含折叠月）与失败原因 → R-B06 口径
    func testInspectBackupReportAndFailureReasons() throws {
        var s = oldBackupState()
        var recs = s["records"]!.objectValue!
        recs["2026-06"] = J(#"{"folded":true,"month":"2026-06","byDay":{"2026-06-02":["月"]},"chars":["月","日"],"kept":[]}"#)
        s["records"] = .object(recs)
        let good = try Backup.buildBackupV2(s, now: ms("2026-09-01", 20))
        let report = Backup.inspectBackup(.string(Backup.serializeBackup(.object(good))), dates: shanghai)
        XCTAssertEqual(report["ok"], .bool(true))
        XCTAssertEqual(report["day"], .string("2026-09-01"))
        XCTAssertEqual(report["count"], .number(4), "old book + folded moon sun")
        XCTAssertEqual(report["latestDay"], .string("2026-08-31"))
        XCTAssertEqual(report["fromLegacy"], .bool(false))
        func with(_ k: String, _ v: JSValue) -> String { str(setting(.object(good), k, v)) }
        var badData = good["data"]!.objectValue!
        badData["shizi.v2.records.2026-08"] = .string(#"[{"id":"bad"}]"#)
        let cases: [(String, String, String)] = [
            ("not json at all", "json", "notBackup"),
            (#"{"hello":1}"#, "format", "notBackup"),
            (String(Backup.serializeBackup(.object(good)).prefix(200)), "damaged", "restoreFailed"),
            (with("version", .number(3)), "version", "restoreFailed"),
            (with("data", .object(badData)), "shape", "restoreFailed"),
            (with("data", J(#"{"shizi.v2.settings":"{}"}"#)), "empty", "restoreFailed"),
            (#"{"app":"shizi","version":1,"data":{"shizi.memory.v1":"{}"}}"#, "v1-unsupported", "restoreFailed"),
        ]
        let saved = Backup.legacyImporter
        Backup.legacyImporter = nil // 原用例里迁移模块没加载（转换器未注册）
        defer { Backup.legacyImporter = saved }
        for (text, reason, kind) in cases {
            let r = Backup.inspectBackup(.string(text), dates: shanghai)
            XCTAssertEqual(r["ok"], .bool(false), reason)
            XCTAssertEqual(r["reason"], .string(reason))
            XCTAssertEqual(r["kind"], .string(kind), "\(reason) → \(kind)")
        }
        let big = Backup.inspectBackup(.string(String(repeating: "x", count: 16)), maxBytes: 8, dates: shanghai)
        XCTAssertEqual([big["reason"]!, big["kind"]!], [.string("tooLarge"), .string("notBackup")])
        XCTAssertEqual(Backup.maxBytes, 64 * 1024 * 1024)
    }

    // v1 备份：转换器未注册是桩（v1-unsupported）；M5-4 注册后走同一份报告
    func testV1BackupImporterStubThenRegistered() throws {
        let v1 = J(#"{"app":"shizi","version":1,"date":"2026-08-01T10:00:00.000Z","data":{"shizi.memory.v1":"{}"}}"#)
        let saved = Backup.legacyImporter
        defer { Backup.legacyImporter = saved }
        Backup.legacyImporter = nil
        XCTAssertEqual(Backup.importLegacyBackup(v1), J(#"{"ok":false,"reason":"v1-unsupported"}"#))
        let converted = try Backup.buildBackupV2(oldBackupState(), now: ms("2026-08-01", 18))
        Backup.legacyImporter = { obj, _ in obj["version"] == .number(1) ? JS.obj([("ok", .bool(true)), ("backup", .object(converted))]) : JS.obj([("ok", .bool(false))]) }
        let r = Backup.inspectBackup(.string(str(v1)), dates: shanghai)
        XCTAssertEqual(r["ok"], .bool(true))
        XCTAssertEqual(r["fromLegacy"], .bool(true))
        XCTAssertEqual(r["count"], .number(2))
        Backup.legacyImporter = nil
        XCTAssertEqual(Backup.importLegacyBackup(.string("{"))["reason"], .string("json"))
    }

    // recordsSignature: 只看 judged 的 id 与判断；更正、新增改变签名，看过答案不改变
    func testRecordsSignature() {
        let s = currentState()["records"]!.objectValue!
        let base = Backup.recordsSignature(.object(s))
        XCTAssertTrue(base.hasPrefix("4:") && base.count == 10)
        var withSeen = s
        withSeen["2026-09"] = .array(s["2026-09"]!.arrayValue! + [brec(6, cKan2, "2026-09-22", kind: "answer-seen")])
        XCTAssertEqual(Backup.recordsSignature(.object(withSeen)), base)
        var corrected = s
        corrected["2026-09"] = .array(s["2026-09"]!.arrayValue!.map { $0["id"] == .string("r4") ? setting($0, "judgment", .string("wrong")) : $0 })
        XCTAssertNotEqual(Backup.recordsSignature(.object(corrected)), base)
        var more = s
        more["2026-09"] = .array(s["2026-09"]!.arrayValue! + [brec(8, cXin, "2026-09-23")])
        XCTAssertNotEqual(Backup.recordsSignature(.object(more)), base)
        XCTAssertEqual(Backup.recordsSignature(JS.obj([("2026-09", s["2026-09"]!), ("2026-07", s["2026-07"]!)])), base, "month key order irrelevant")
        XCTAssertEqual(Backup.recordsSignature(.object(JSObject())), "0:811c9dc5")
    }

    // lossRange / confirmModel：现在的记录里晚于备份日期的日子（P26 / K04）；没有记录 → 恢复措辞
    func testLossRangeAndConfirmModel() {
        let s = JSValue.object(currentState())
        XCTAssertEqual(Backup.lossRange(s["records"], .string("2026-09-01")), J(#"{"from":"2026-09-02","to":"2026-09-20","days":2}"#))
        XCTAssertEqual(Backup.lossRange(s["records"], .string("2026-09-19")), J(#"{"from":"2026-09-20","to":"2026-09-20","days":1}"#))
        XCTAssertEqual(Backup.lossRange(s["records"], .string("2026-09-24")), .null)
        XCTAssertEqual(Backup.lossRange(s["records"], .null), .null)
        let report = J(#"{"day":"2026-09-01","count":23}"#)
        XCTAssertEqual(Backup.confirmModel(s, report), J(#"{"mode":"replace","day":"2026-09-01","n":23,"m":3,"loss":{"from":"2026-09-02","to":"2026-09-20","days":2}}"#).objectValue!)
        XCTAssertEqual(Backup.confirmModel(s, report, showLoss: false)["loss"], .null)
        XCTAssertEqual(Backup.confirmModel(J(#"{"records":{}}"#), report), J(#"{"mode":"restore","day":"2026-09-01","n":23,"m":0,"loss":null}"#).objectValue!)
    }

    // backupStatus：T07 状态机（无记录 / 从没备份 / 一致 / 有改动 / 结论只写结论）
    func testBackupStatusT07() {
        func keys(_ st: JSValue) -> [String] { lines(Backup.backupStatus(st, dates: shanghai)) }
        XCTAssertEqual(keys(J(#"{"records":{}}"#)), ["R-B02.noRecords"])
        XCTAssertEqual(Backup.backupStatus(J(#"{"records":{}}"#), dates: shanghai)["date"], J(#"{"kind":"never"}"#))
        XCTAssertEqual(Backup.backupStatus(J(#"{"records":{}}"#), dates: shanghai)["canExport"], .bool(false))
        let s = currentState()
        XCTAssertEqual(keys(setting(.object(s), "backupMeta", .null)), [], "N27")
        let matched = setting(.object(s), "backupMeta", JS.obj([("lastExportAt", .number(ms("2026-09-20"))), ("lastExportSig", .string(Backup.recordsSignature(s["records"])))]))
        XCTAssertEqual(keys(matched), ["R-B02.allBackedUp"])
        XCTAssertEqual(Backup.backupStatus(matched, dates: shanghai)["date"], J(#"{"kind":"day","day":"2026-09-20"}"#))
        XCTAssertEqual(keys(.object(s)), ["R-B02.changedSince"])
        let restored = setting(matched, "backupMeta", setting(matched["backupMeta"]!, "lastConclusion", J(#"{"kind":"restore","date":"2026-09-01","count":23}"#)))
        XCTAssertEqual(Backup.backupStatus(restored, dates: shanghai)["lines"], J(#"[{"key":"R-B01.conclusionRestore","vars":{"day":"2026-09-01","n":23}}]"#))
        let cleared = J(#"{"records":{},"backupMeta":{"lastExportAt":null,"lastExportSig":null,"lastConclusion":{"kind":"clear","date":null,"count":3}}}"#)
        XCTAssertEqual(keys(cleared), ["R-B01.conclusionClear"])
        XCTAssertEqual(Backup.backupStatus(.object(s), conclusion: J(#"{"kind":"restore","date":"2026-08-01","count":2}"#), dates: shanghai)["lines"]!.arrayValue![0]["vars"], J(#"{"day":"2026-08-01","n":2}"#))
        XCTAssertEqual(keys(restored), ["R-B01.conclusionRestore"], "re-entry keeps the restore conclusion")
        XCTAssertEqual(keys(cleared), ["R-B01.conclusionClear"])
        XCTAssertEqual(keys(setting(restored, "backupMeta", setting(restored["backupMeta"]!, "lastConclusion", .null))), ["R-B02.allBackedUp"])
        XCTAssertEqual(keys(J(#"{"records":{},"backupMeta":{"lastExportAt":null,"lastExportSig":null,"lastConclusion":null}}"#)), ["R-B02.noRecords"])
        XCTAssertEqual(keys(setting(.object(s), "backupMeta", cleared["backupMeta"]!)), [])
    }

    // makeSafety：形状合 schema（白名单键原始字串 + 现在的 sessions，P79）
    func testMakeSafetyShape() {
        let env = makeStore(currentState())
        let safety = Backup.makeSafety(env.store.state, kind: "restore", now: NOW, backupDate: .string("2026-09-01"), count: .number(2))
        XCTAssertNil(Schema.validateValue(key: SK("safety"), value: .object(safety)))
        XCTAssertEqual(safety["payload"]![SK("sessions")], .string(str(env.store.state["sessions"]!)), "sessions carried along")
        XCTAssertEqual(UTF16Order.sorted(safety["payload"]!.objectValue!.keys.filter { $0 != SK("sessions") }), UTF16Order.sorted(Backup.backupEntries(env.store.state).map { $0.0 }))
        XCTAssertFalse(Backup.safetyMatchesCurrent(env.store.state), "no safety in state yet")
        var noSess = env.store.state
        noSess["sessions"] = .null
        let noSessions = Backup.makeSafety(noSess, kind: "clear", now: NOW)
        XCTAssertNil(noSessions["payload"]![SK("sessions")])
        XCTAssertNil(Schema.validateValue(key: SK("safety"), value: .object(noSessions)))
        func withPayload(_ k: String, _ v: String) -> JSValue {
            var p = safety["payload"]!.objectValue!
            p[k] = .string(v)
            return setting(.object(safety), "payload", .object(p))
        }
        XCTAssertTrue(contains(Schema.validateValue(key: SK("safety"), value: withPayload(SK("sessions"), #"{"A":1}"#)), "sessions"))
        XCTAssertTrue(contains(Schema.validateValue(key: SK("safety"), value: withPayload(SK("sessions"), "nope")), "not JSON"))
        XCTAssertTrue(contains(Schema.validateValue(key: SK("safety"), value: withPayload(SK("funnel"), "{}")), "bad key"))
    }

    // P79 / M6-6：替换备份结束进行中的组（A/B 置 null、lastEnded 清空），撤销后会话与全部 v2 键逐字还原
    func testP79RestoreEndsActiveGroupsUndoRestores() throws {
        let env = makeStore(withActiveSessions())
        let before = v2Raw(env.disk)
        let sessionsBefore = env.store.state["sessions"]!
        XCTAssertTrue(ok(Backup.restoreFromBackup(env.store, try oldReport(), now: NOW)))
        let st = env.store.state
        XCTAssertEqual(st["sessions"]!["A"], .null)
        XCTAssertEqual(st["sessions"]!["B"], .null)
        XCTAssertFalse(sessionsBefore["lastEnded"]!.objectValue!.isEmpty)
        XCTAssertEqual(st["sessions"]!["lastEnded"], .object(JSObject()))
        XCTAssertEqual(J(env.disk.rawGet(SK("sessions"))!)["lastEnded"], .object(JSObject()))
        XCTAssertEqual(J(Backup.safetyOf(st)!["payload"]![SK("sessions")]!.stringValue!), sessionsBefore)
        XCTAssertEqual(J(env.disk.rawGet(SK("sessions"))!)["A"], .null)
        XCTAssertTrue(ok(Backup.undoFromSafety(env.store)))
        XCTAssertEqual(env.store.state["sessions"], sessionsBefore)
        XCTAssertEqual(v2Raw(env.disk), before, "K03")
    }

    // P79：清空所有记录同样结束进行中的组；撤销还原会话；清空失败时会话不动
    func testP79ClearEndsActiveGroupsUndoRestores() {
        let env = makeStore(withActiveSessions())
        let before = v2Raw(env.disk)
        let sessionsBefore = env.store.state["sessions"]!
        XCTAssertTrue(ok(Backup.clearAllRecords(env.store, now: NOW)))
        XCTAssertEqual(env.store.state["sessions"]!["A"], .null)
        XCTAssertEqual(env.store.state["sessions"]!["lastEnded"], .object(JSObject()))
        XCTAssertTrue(ok(Backup.undoFromSafety(env.store)))
        XCTAssertEqual(env.store.state["sessions"], sessionsBefore)
        XCTAssertEqual(v2Raw(env.disk), before)
        let b = makeStore(withActiveSessions())
        let beforeB = v2Raw(b.disk)
        b.storage.failNextWrite(1, kind: "generic", matchKey: SK("sessions"))
        let r = Backup.clearAllRecords(b.store, now: NOW)
        XCTAssertEqual(r["stage"], .string("clear"))
        XCTAssertEqual(v2Raw(b.disk), beforeB)
        XCTAssertNotEqual(b.store.state["sessions"]!["A"], .null, "A still there")
    }

    // M6-6：endActiveSessions——只有 lastEnded 时也清；什么都没有时不写；没有 sessions 域时不建
    func testEndActiveSessions() {
        var onlyEnded = J(#"{"sessions":{"A":null,"B":null,"lastEnded":{"A":{"id":"s1"}}}}"#).objectValue!
        Backup.endActiveSessions(&onlyEnded)
        XCTAssertEqual(onlyEnded["sessions"], J(#"{"A":null,"B":null,"lastEnded":{}}"#))
        var empty = J(#"{"sessions":{"A":null,"B":null,"lastEnded":{}}}"#).objectValue!
        let ref = str(.object(empty))
        Backup.endActiveSessions(&empty)
        XCTAssertEqual(str(.object(empty)), ref, "nothing to end → draft untouched")
        var none = J(#"{"sessions":null}"#).objectValue!
        Backup.endActiveSessions(&none)
        XCTAssertEqual(none["sessions"], .null)
    }

    // I2：保护副本 / 清空 / 撤销走 store.commit 的 reclaim:false——撞配额不回收、全部键不变；通知是整体替换
    func testI2SafetyClearUndoDoNotReclaim() {
        let env = makeStore(currentState())
        let before = v2Raw(env.disk)
        var seen: [JSObject] = []
        env.store.subscribe { _, info in seen.append(info) }
        env.storage.failNextWrite(1, kind: "quota", matchKey: SK("safety"))
        let r = Backup.clearAllRecords(env.store, now: NOW)
        XCTAssertEqual(r["ok"], .bool(false))
        XCTAssertEqual(r["stage"], .string("safety"))
        XCTAssertEqual(r["error"]?["kind"], .string("quota"))
        XCTAssertEqual(v2Raw(env.disk), before, "nothing changed; July not folded")
        XCTAssertFalse(seen.contains { $0["type"] == .string("recover") })
        env.storage.clearFaults()
        XCTAssertTrue(ok(Backup.clearAllRecords(env.store, now: NOW)))
        XCTAssertTrue(seen.filter { $0["type"] == .string("commit") }.allSatisfy { $0["replace"] == .bool(true) })
    }

    // 恢复 → 撤销：替换采用备份（backupMeta 换成本机日期 + 结论、sessions 不动、清 corrupt），撤销后全部 v2 键逐字相等
    func testRestoreThenUndo() throws {
        let env = makeStore(currentState())
        env.disk.rawSet("shizi.corrupt.shizi.v2.custom", "\"garbage\"")
        var before = v2Raw(env.disk)
        let r = Backup.restoreFromBackup(env.store, try oldReport(), now: NOW)
        XCTAssertTrue(ok(r))
        let st = env.store.state
        XCTAssertEqual(st["records"]!.objectValue!.keys, ["2026-08"])
        XCTAssertEqual(st["settings"], J(#"{"library":"core3500"}"#))
        XCTAssertEqual(st["custom"], .null)
        XCTAssertEqual(st["backupMeta"], JS.obj([("lastExportAt", .number(ms("2026-09-10"))), ("lastExportSig", .string("x")), ("lastConclusion", J(#"{"kind":"restore","date":"2026-09-01","count":2}"#))]))
        XCTAssertEqual(st["sessions"], J(#"{"A":null,"B":null,"lastEnded":{}}"#))
        XCTAssertEqual(Backup.safetyOf(st)?["kind"], .string("restore"))
        XCTAssertNil(env.disk.rawGet("shizi.corrupt.shizi.v2.custom"), "corrupt cleaned")
        XCTAssertFalse(Backup.safetyMatchesCurrent(st))
        XCTAssertTrue(ok(Backup.undoFromSafety(env.store)))
        before.removeAll { $0.hasPrefix("shizi.corrupt.shizi.v2.custom=") }
        XCTAssertEqual(v2Raw(env.disk), before)
        XCTAssertNil(Backup.safetyOf(env.store.state))
    }

    // R-B04：保护副本写失败（配额两次 / 通用）→ 不替换、不做预算回收、全部键不变
    func testRB04SafetyWriteFailure() throws {
        for (n, kind, matchKey) in [(2.0, "quota", SK("safety")), (1.0, "generic", nil), (2.0, "quota", nil)] as [(Double, String, String?)] {
            let env = makeStore(currentState())
            let before = v2Raw(env.disk)
            let report = try oldReport()
            env.storage.failNextWrite(n, kind: kind, matchKey: matchKey)
            let r = Backup.restoreFromBackup(env.store, report, now: NOW)
            XCTAssertEqual(r["ok"], .bool(false))
            XCTAssertEqual(r["stage"], .string("safety"))
            env.storage.clearFaults()
            XCTAssertEqual(v2Raw(env.disk), before)
            XCTAssertNil(Backup.safetyOf(env.store.state))
            XCTAssertNotNil(env.store.state["records"]!["2026-07"]!.arrayValue, "July not folded")
        }
    }

    // 覆盖失败已回滚：替换中途写失败 → store 回滚、副本删除、全部键不变（R-B06 没能恢复）
    func testReplaceFailureRolledBackSafetyDropped() throws {
        let env = makeStore(currentState())
        let before = v2Raw(env.disk)
        let report = try oldReport()
        env.storage.failNextWrite(1, kind: "generic", matchKey: "shizi.v2.records.*")
        let r = Backup.restoreFromBackup(env.store, report, now: NOW)
        XCTAssertEqual(r["ok"], .bool(false))
        XCTAssertEqual(r["stage"], .string("replace"))
        XCTAssertEqual(r["safetyDropped"], .bool(true))
        XCTAssertEqual(v2Raw(env.disk), before)
        XCTAssertEqual(env.store.state["records"], currentState()["records"])
    }

    // R-B05：撤销失败 → 仍是备份里的记录、副本保留、可以再点；再点成功
    func testRB05UndoFailureKeepsSafety() throws {
        let env = makeStore(currentState())
        let before = v2Raw(env.disk)
        XCTAssertTrue(ok(Backup.restoreFromBackup(env.store, try oldReport(), now: NOW)))
        let replaced = v2Raw(env.disk)
        env.storage.failNextWrite(1, kind: "generic")
        XCTAssertEqual(Backup.undoFromSafety(env.store)["ok"], .bool(false))
        XCTAssertEqual(v2Raw(env.disk), replaced)
        XCTAssertNotNil(Backup.safetyOf(env.store.state))
        XCTAssertTrue(ok(Backup.undoFromSafety(env.store)))
        XCTAssertEqual(v2Raw(env.disk), before)
        XCTAssertEqual(Backup.undoFromSafety(env.store), J(#"{"ok":false,"error":{"kind":"no-safety"}}"#))
    }

    // 清空所有记录 → 撤销：清掉记录类域、保留 settings 与本机备份日期、写入结论；撤销逐字还原
    func testClearThenUndo() {
        let env = makeStore(currentState())
        let before = v2Raw(env.disk)
        XCTAssertTrue(ok(Backup.clearAllRecords(env.store, now: NOW)))
        let st = env.store.state
        XCTAssertEqual(st["records"], .object(JSObject()))
        for d in ["sched", "custom", "wordOff", "photos", "legacy"] { XCTAssertEqual(st[d], .null, d) }
        XCTAssertEqual(st["settings"], J(#"{"library":"adv3000","sound":false}"#))
        XCTAssertEqual(st["backupMeta"], JS.obj([("lastExportAt", .number(ms("2026-09-10"))), ("lastExportSig", .string("x")), ("lastConclusion", J(#"{"kind":"clear","date":null,"count":3}"#))]))
        XCTAssertEqual(lines(Backup.backupStatus(.object(st), dates: shanghai)), ["R-B01.conclusionClear"])
        XCTAssertEqual(Backup.safetyOf(st)?["kind"], .string("clear"))
        env.storage.failNextWrite(1, kind: "generic")
        XCTAssertEqual(Backup.undoFromSafety(env.store)["ok"], .bool(false))
        XCTAssertEqual(env.store.state["records"], .object(JSObject()))
        XCTAssertTrue(ok(Backup.undoFromSafety(env.store)))
        XCTAssertEqual(v2Raw(env.disk), before)
    }

    // 清空：副本失败 / 清空本身失败 → 全部键不变
    func testClearFailuresLeaveEveryKey() {
        let a = makeStore(currentState())
        let beforeA = v2Raw(a.disk)
        a.storage.failNextWrite(1, kind: "generic", matchKey: SK("safety"))
        XCTAssertEqual(Backup.clearAllRecords(a.store, now: NOW)["stage"], .string("safety"))
        XCTAssertEqual(v2Raw(a.disk), beforeA)
        let b = makeStore(currentState())
        let beforeB = v2Raw(b.disk)
        b.storage.failNextWrite(1, kind: "generic", matchKey: SK("backupMeta"))
        XCTAssertEqual(Backup.clearAllRecords(b.store, now: NOW)["stage"], .string("clear"))
        XCTAssertEqual(v2Raw(b.disk), beforeB)
    }

    // 导出记账：lastExportAt / 签名、清结论 → 「现在的记录都已经备份了」；dropSafety 无副本不写
    func testMarkExportedAndDropSafety() {
        let env = makeStore(currentState())
        let writes = env.disk.writeCount
        XCTAssertEqual(Backup.dropSafety(env.store), J(#"{"ok":true,"keys":[]}"#))
        XCTAssertEqual(env.disk.writeCount, writes)
        let sig = Backup.recordsSignature(env.store.state["records"])
        XCTAssertTrue(ok(Backup.markExported(env.store, at: NOW, sig: sig)))
        XCTAssertEqual(env.store.state["backupMeta"], JS.obj([("lastExportAt", .number(NOW)), ("lastExportSig", .string(sig))]))
        XCTAssertEqual(lines(Backup.backupStatus(.object(env.store.state), dates: shanghai)), ["R-B02.allBackedUp"])
        XCTAssertEqual(Backup.judgedCharsOf(env.store.state["records"]).count, 3)
    }

    // 备份页文案小工具（mine/backup.js）：撤销底栏两行、丢失范围句、结论句、「我的」菜单右侧
    func testBackupPageTextHelpers() throws {
        XCTAssertEqual(try BackupText.undoLines("restore", failed: false), ["\u{5DF2}\u{6362}\u{6210}\u{5907}\u{4EFD}\u{91CC}\u{7684}\u{8BB0}\u{5F55}", "\u{79BB}\u{5F00}\u{8FD9}\u{4E00}\u{9875}\u{524D}\u{53EF}\u{4EE5}\u{64A4}\u{9500}"])
        XCTAssertEqual(try BackupText.undoLines("clear", failed: false), ["\u{8BB0}\u{5F55}\u{5DF2}\u{6E05}\u{7A7A}", "\u{79BB}\u{5F00}\u{8FD9}\u{4E00}\u{9875}\u{524D}\u{53EF}\u{4EE5}\u{64A4}\u{9500}"])
        XCTAssertEqual(try BackupText.undoLines("restore", failed: true), ["\u{6CA1}\u{80FD}\u{64A4}\u{9500}\u{FF0C}\u{73B0}\u{5728}\u{8FD8}\u{662F}\u{5907}\u{4EFD}\u{91CC}\u{7684}\u{8BB0}\u{5F55}", "\u{53EF}\u{4EE5}\u{518D}\u{70B9}\u{4E00}\u{6B21}\u{64A4}\u{9500}"])
        XCTAssertEqual(try BackupText.undoLines("clear", failed: true), ["\u{6CA1}\u{80FD}\u{64A4}\u{9500}\u{FF0C}\u{8BB0}\u{5F55}\u{8FD8}\u{662F}\u{7A7A}\u{7684}", "\u{53EF}\u{4EE5}\u{518D}\u{70B9}\u{4E00}\u{6B21}\u{64A4}\u{9500}"])
        XCTAssertEqual(try BackupText.lossText(J(#"{"from":"2026-09-02","to":"2026-09-24"}"#), dates: shanghai), "9\u{6708}2\u{65E5}\u{5230} 9\u{6708}24\u{65E5}\u{7684}\u{8BB0}\u{5F55}\u{4F1A}\u{4E22}\u{5931}\u{FF0C}\u{5EFA}\u{8BAE}\u{5148}\u{5BFC}\u{51FA}\u{3002}")
        XCTAssertEqual(try BackupText.lossText(J(#"{"from":"2026-09-20","to":"2026-09-20"}"#), dates: shanghai), "9\u{6708}20\u{65E5}\u{7684}\u{8BB0}\u{5F55}\u{4F1A}\u{4E22}\u{5931}\u{FF0C}\u{5EFA}\u{8BAE}\u{5148}\u{5BFC}\u{51FA}\u{3002}")
        XCTAssertEqual(try BackupText.lossText(.null, dates: shanghai), "")
        XCTAssertEqual(try BackupText.lineText(J(#"{"key":"R-B01.conclusionRestore","vars":{"day":"2026-09-01","n":23}}"#), dates: shanghai), "\u{5DF2}\u{6062}\u{590D} 9\u{6708}1\u{65E5}\u{7684}\u{5907}\u{4EFD}\u{FF0C}\u{5171} 23 \u{4E2A}\u{5B57}\u{3002}")
        XCTAssertEqual(try BackupText.lineText(J(#"{"key":"R-B02.noRecords"}"#), dates: shanghai), "\u{73B0}\u{5728}\u{6CA1}\u{6709}\u{8BB0}\u{5F55}\u{3002}")
        XCTAssertEqual(try BackupText.backupMenuStatus(J(#"{"records":{}}"#), dates: shanghai), JS.obj([("kind", .string("never")), ("day", .null), ("text", .string("\u{8FD8}\u{6CA1}\u{6709}\u{5907}\u{4EFD}"))]).objectValue!)
        XCTAssertEqual(try BackupText.backupMenuStatus(JS.obj([("records", .object(JSObject())), ("backupMeta", JS.obj([("lastExportAt", .number(ms("2026-09-01", 20)))]))]), dates: shanghai),
                       JS.obj([("kind", .string("day")), ("day", .string("2026-09-01")), ("text", .string("\u{4E0A}\u{6B21}\u{5907}\u{4EFD} 9\u{6708}1\u{65E5}"))]).objectValue!)
        XCTAssertEqual(BackupText.noteKeys.map { $0.1 }, ["R-B04.protectFailed", "R-B06.notBackup", "R-B06.restoreFailed"])
    }

    // D27：备份信封含墨迹（每字第一次 + 最近一次，跨月键）；导出 → 新机恢复逐字相等；恢复旧备份 → 撤销，墨迹往返不丢
    func testD27BackupEnvelopeCarriesInk() throws {
        func stroke(_ y: Double, _ t0: Double) throws -> [InkPoint] {
            try InkMath.buildStroke([InkPoint(x: 60, y: y, t: t0), InkPoint(x: 170, y: y + 2, t: t0 + 60), InkPoint(x: 280, y: y + 9, t: t0 + 120)], options: InkOptions(final: true)).points
        }
        let inkA = try InkMath.encodeInk([try stroke(120, 0), try stroke(200, 500)])
        let inkB = try InkMath.encodeInk([try stroke(90, 0)])
        var withInk = currentState()
        withInk["ink"] = JS.obj([("2026-07", JS.obj([("r1", inkA), ("r2", inkB)])), ("2026-09", JS.obj([("r3", inkB), ("r4", inkA)]))])
        let env = makeStore(withInk)
        let file = try Backup.buildBackupV2(env.store.state, now: NOW)
        func perRecord(_ d: TestDisk, _ month: String, _ ids: [String]) -> [String] { ids.map { $0 + "=" + (d.rawGet("shizi.v2.ink.\(month).\($0)") ?? "nil") } }
        for month in ["2026-07", "2026-09"] {
            let table = J(file["data"]!["shizi.v2.ink." + month]!.stringValue!).objectValue!
            XCTAssertNil(env.disk.rawGet("shizi.v2.ink." + month), "no month key on disk")
            XCTAssertEqual(perRecord(env.disk, month, table.keys), table.entries.map { $0.key + "=" + str($0.value) }, "ink \(month) in the envelope")
        }
        let report = Backup.inspectBackup(.string(Backup.serializeBackup(.object(file))), dates: shanghai)
        XCTAssertEqual(report["ok"], .bool(true))
        let fresh = makeStore()
        XCTAssertTrue(ok(Backup.restoreFromBackup(fresh.store, report, now: NOW)))
        for month in ["2026-07", "2026-09"] {
            let ids = withInk["ink"]![month]!.objectValue!.keys
            XCTAssertEqual(perRecord(fresh.disk, month, ids), perRecord(env.disk, month, ids), "ink \(month) restored byte-equal")
        }
        XCTAssertEqual(try InkMath.decodeInk(fresh.store.getInk(brec(1, cYong, "2026-07-03"))), try InkMath.decodeInk(inkA))
        XCTAssertEqual(try InkMath.decodeInk(fresh.store.getInk(brec(3, cYong, "2026-09-02"))), try InkMath.decodeInk(inkB))
        let before = v2Raw(env.disk)
        XCTAssertTrue(ok(Backup.restoreFromBackup(env.store, try oldReport(), now: NOW)))
        XCTAssertTrue(flatInk(env.store.state["ink"]).isEmpty, "backup had no ink → none after replace")
        XCTAssertTrue(Backup.safetyOf(env.store.state)!["payload"]!.objectValue!.keys.contains { $0.hasPrefix("shizi.v2.ink.") }, "safety copy carries the ink keys")
        XCTAssertTrue(ok(Backup.undoFromSafety(env.store)))
        XCTAssertEqual(v2Raw(env.disk), before, "undo restores every key, ink included")
    }
}
