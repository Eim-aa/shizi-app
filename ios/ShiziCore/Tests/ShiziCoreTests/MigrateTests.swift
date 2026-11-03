import Foundation
import XCTest
@testable import ShiziCore

// test/store/migrate.test.mjs 的转写（B4.4，16 条）：v1 → v2 转换规则（01 §12，P35 / P53 / P07 / P31）、单次写入、失败路径、旧键处理、
// v1 备份导入、D65 #2 摊开到期日。smallV1() 的值由 JS 原样导出成 Fixtures/migrate-small-v1.json（汉字 \u 转义）；
// 真实 v1 夹具读仓库里的 scripts/fixtures/legacy-v1/。

private let NOW = 1790820000000.0 // Date.parse('2026-10-01T10:00:00+08:00')
private let DAY = 86_400_000.0
private let cXiao = "\u{5C0F}", cKan = "\u{770B}", cYi = "\u{7591}", cGu = "\u{53E4}", cJiu = "\u{65E7}", cWang = "\u{5FD8}", cTi = "\u{63D0}", cPai = "\u{62CD}", cXian3 = "\u{9C7B}", cBiao = "\u{9A89}"

private func smallV1() throws -> JSValue { .object(try loadFixture("migrate-small-v1")) }

private func policyWith(migration: [(String, JSValue)] = [], features: [(String, JSValue)] = []) -> JSValue {
    var p = Config.policy.objectValue!
    var m = p["migration"]!.objectValue!
    for (k, v) in migration { m[k] = v }
    p["migration"] = .object(m)
    var f = p["features"]!.objectValue!
    for (k, v) in features { f[k] = v }
    p["features"] = .object(f)
    for (k, v) in migration where k == "_groupSize" { p["groupSize"] = v }
    return .object(p)
}

private func flatRecords(_ records: JSObject) -> [JSValue] { UTF16Order.sorted(records.keys).flatMap { records[$0]!.arrayValue ?? [] } }

private func convert(_ v: JSValue, now: Double = NOW, dueBase: Double? = nil, present: [String] = [], policy: JSValue = Config.policy) throws -> Migrate.Converted {
    try Migrate.convertV1(v, now: now, dueBase: dueBase, present: present, policy: policy, dates: shanghai)
}

private func backupText() throws -> String { try readRepoFile("scripts/fixtures/legacy-v1/backup-300.json") }

private func deviceBackend(_ extra: [(String, String)] = []) throws -> MemoryDisk {
    let backup = J(try backupText())
    let device = J(try readRepoFile("scripts/fixtures/legacy-v1/device-only.json"))
    var all = JSObject()
    for (k, v) in backup["data"]!.objectValue!.entries { all[k] = v }
    for (k, v) in device.objectValue!.entries { all[k] = v }
    for (k, v) in extra { all[k] = .string(v) }
    return MemoryDisk(initial: all.entries.map { ($0.key, $0.value.stringValue!) })
}

private func boot(_ d: TestDisk, _ now: Double = NOW) -> StoreEnv { freshStore(.local, disk: d, now: now) }

private func v1Snapshot(_ d: TestDisk) -> [String] { d.snapshot().filter { !$0.0.hasPrefix(Schema.v2Prefix) }.map { $0.0 + "=" + $0.1 } }

final class MigrateTests: XCTestCase {
    // canonicalCardKey: base/custom 收敛，旧 custom:<n>: 去序号，legacy / 多字丢弃
    func testCanonicalCardKey() {
        XCTAssertEqual(Migrate.canonicalCardKey(.string("base:" + cDa)), "base:" + cDa)
        XCTAssertEqual(Migrate.canonicalCardKey(.string("custom:12:" + cBiao)), "custom:" + cBiao)
        XCTAssertNil(Migrate.canonicalCardKey(.string("legacy:4")))
        XCTAssertNil(Migrate.canonicalCardKey(.string("base:" + cDa + cXiao)))
        XCTAssertNil(Migrate.canonicalCardKey(.number(7)))
    }

    // convertV1: 事件 → 记录（Good/wrong/dontKnow；不太确定与 P35 hinted 不生成判断），ids 按时间先后，全部 legacy
    func testConvertV1EventsToRecords() throws {
        let r = try convert(try smallV1())
        let records = r.state["records"]!.objectValue!
        let recs = flatRecords(records)
        for (m, v) in records.entries { XCTAssertNil(Schema.validateRecordsMonth(v, month: m), "month \(m) valid") }
        XCTAssertEqual(recs.map { $0["id"]!.stringValue! }, recs.indices.map { "r\($0 + 1)" }, "ids r1..rN")
        XCTAssertTrue(recs.indices.allSatisfy { $0 == 0 || recs[$0 - 1]["at"]!.numberValue! <= recs[$0]["at"]!.numberValue! }, "ids follow time")
        XCTAssertTrue(recs.allSatisfy { $0["legacy"] == .bool(true) && $0["sessionId"] == nil }, "all legacy, no session")
        func of(_ ch: String) -> [String] { recs.filter { $0["char"] == .string(ch) }.map { $0["kind"] == .string("judged") ? $0["judgment"]!.stringValue! : $0["kind"]!.stringValue! } }
        XCTAssertEqual(of(cDa), ["wrong", "correct"])
        XCTAssertEqual(recs.first { $0["char"] == .string(cDa) && $0["judgment"] == .string("correct") }!["help"]!["traced"], .bool(true))
        XCTAssertEqual(of(cXiao), ["wrong"])
        XCTAssertEqual(recs.first { $0["char"] == .string(cXiao) }!["help"]!["hints"], .number(1))
        XCTAssertEqual(of(cKan), ["answer-seen"])
        XCTAssertEqual(recs.first { $0["char"] == .string(cKan) }!["help"]!["answerSeen"], .bool(true))
        XCTAssertEqual(of(cYi), [], "hinted: no judged (P35 none)")
        XCTAssertEqual(of(cBiao), ["correct"], "custom:<n>: key converges")
        let e = r.report["events"]!
        XCTAssertEqual(["total", "correct", "wrong", "answerSeen", "uncertain", "hintedWithHints", "duplicate", "badKey"].map { e[$0]!.numberValue! }, [10, 2, 2, 1, 1, 1, 1, 2])
        XCTAssertEqual(r.report["hintedAs"], .string("none"))
        let uncertainDay = try shanghai.localDay(.number(JSDate.parse("2026-09-13T12:00:00.000Z", shanghaiTZ)))
        XCTAssertTrue(r.state["legacy"]!["days"]!.arrayValue!.contains(.string(uncertainDay)), "uncertain day kept in legacy.days")
    }

    // convertV1: P35 legacyHintedAs correct / wrong 把 hintCount>0 的 hinted 变成判断（帮助事实照实），hints 照实（D64：不再夹到 2）
    func testConvertV1LegacyHintedAsCorrectWrong() throws {
        for judgment in ["correct", "wrong"] {
            let r = try convert(try smallV1(), policy: policyWith(migration: [("legacyHintedAs", .string(judgment))]))
            let recs = flatRecords(r.state["records"]!.objectValue!)
            let yi = recs.filter { $0["char"] == .string(cYi) }
            XCTAssertEqual(yi.map { $0["judgment"]! }, [.string(judgment)], "hinted → \(judgment)")
            XCTAssertEqual(yi[0]["help"]!["hints"], .number(3), "hintCount 3 kept (D64 ①)")
            XCTAssertEqual(recs.filter { $0["char"] == .string(cTi) }.map { $0["judgment"]! }, [.string(judgment)], "synthesized hinted follows P35 too")
        }
    }

    // convertV1: 有 memory 无事件的字按 memory 合成；加字残留不算练习；从没练过不合成
    func testConvertV1SynthesizeFromMemory() throws {
        let r = try convert(try smallV1())
        let recs = flatRecords(r.state["records"]!.objectValue!)
        func one(_ ch: String) -> [JSValue] { recs.filter { $0["char"] == .string(ch) } }
        let gu = one(cGu)
        XCTAssertEqual(gu.count, 1)
        XCTAssertEqual(gu[0]["judgment"], .string("correct"))
        XCTAssertEqual(gu[0]["help"]!["hints"], .number(1))
        XCTAssertEqual(gu[0]["help"]!["traced"], .bool(true))
        XCTAssertEqual(gu[0]["localDay"], .string(try shanghai.localDay(.number(JSDate.parse("2026-03-02T20:00:00+08:00", shanghaiTZ)))))
        XCTAssertEqual(one(cJiu).map { $0["judgment"]! }, [.string("wrong")])
        XCTAssertEqual(one(cWang).map { $0["kind"]! }, [.string("answer-seen")])
        XCTAssertEqual(one(cTi).count, 0, "synthesized hinted → none")
        let pai = one(cPai)
        XCTAssertEqual(pai.count, 1)
        XCTAssertEqual(pai[0]["judgment"], .string("correct"), "add artifact → last real review")
        XCTAssertEqual(pai[0]["at"], .number(JSDate.parse("2026-02-01T12:00:00.000Z", shanghaiTZ)), "at = fsrsCard.last_review")
        XCTAssertEqual(one(cXian3).count, 0, "added only, never practiced")
        let s = r.report["synthesized"]!
        XCTAssertEqual(["correct", "wrong", "answerSeen", "hinted", "fromLastReview", "addedOnly"].map { s[$0]!.numberValue! }, [2, 1, 1, 1, 1, 1])
        let off = try convert(try smallV1(), policy: policyWith(migration: [("synthesizeFromMemory", .bool(false))]))
        let offRecs = flatRecords(off.state["records"]!.objectValue!)
        XCTAssertFalse(offRecs.contains { [cGu, cJiu, cPai].map { JSValue.string($0) }.contains($0["char"]!) }, "P35 B: no synthesis")
        XCTAssertNil(off.state["sched"]!["base:" + cGu], "and no sched for them")
    }

    // convertV1: sched 不变式（sched 存在 ⇒ 有 judged 记录）与 due 口径
    func testConvertV1SchedInvariantAndDue() throws {
        let r = try convert(try smallV1())
        let judged = KeySet(flatRecords(r.state["records"]!.objectValue!).filter { $0["kind"] == .string("judged") }.map { $0["cardKey"]!.stringValue! })
        let sched = r.state["sched"]!.objectValue!
        for k in sched.keys { XCTAssertTrue(judged.contains(k), "sched \(k) has a judged record") }
        XCTAssertNil(Schema.validateValue(key: SK("sched"), value: .object(sched)), "sched shape")
        for ch in [cKan, cYi, cWang, cTi] { XCTAssertNil(sched["base:" + ch], "no judged → no sched") }
        XCTAssertEqual(r.report["sched"]!["droppedNoJudged"], .number(4))
        XCTAssertEqual(sched["base:" + cDa]!["due"], .string("2026-09-15"), "dueDay kept")
        XCTAssertEqual(sched["base:" + cXiao]!["due"], .string(try shanghai.addDays(.string(try shanghai.localDay(.number(NOW))), 1)), "pendingLearning → tomorrow")
        XCTAssertEqual(sched["base:" + cPai]!["due"], .string(try shanghai.localDay(.number(JSDate.parse("2026-12-01T12:00:00.000Z", shanghaiTZ)))))
        XCTAssertEqual(sched["base:" + cDa]!["lastJudgedAt"], .number(JSDate.parse("2026-09-10T12:00:00.000Z", shanghaiTZ)))
        XCTAssertEqual(sched["base:" + cDa]!["fsrs"]!["last_review"], .string("2026-09-10T12:00:00.000Z"))
        let base = JSDate.parse("2026-09-20T12:00:00+08:00", shanghaiTZ)
        let due = try convert(try smallV1(), dueBase: base).state["sched"]!["base:" + cXiao]!["due"]
        XCTAssertEqual(due, .string(try shanghai.addDays(.string(try shanghai.localDay(.number(base))), 1)), "dueBase moves tomorrow")
    }

    // convertV1: 照片（沿旧预算）、自选、wordOff、设置（scene 丢弃）、上次导出、练习日
    func testConvertV1PhotosCustomWordOffSettingsBackupMetaDays() throws {
        let v = try smallV1()
        let present = Migrate.v1Keys.map { $0.key }.filter { $0 != Migrate.v1Key("safety") }
        let r = try convert(v, present: present)
        let st = r.state
        XCTAssertEqual(st["photos"]!.objectValue!.keys, [cPai])
        XCTAssertNil(Schema.validateValue(key: SK("photos"), value: st["photos"]!))
        XCTAssertEqual(r.report["photos"]!["wishesDropped"], .number(1))
        XCTAssertEqual(st["custom"]!["added"]!.arrayValue!.map { $0["char"]! }, [.string(cXian3), .string(cPai)], "non-CJK dropped")
        XCTAssertEqual(st["custom"]!["added"]!.arrayValue![1]["at"], .number(JSDate.parse("2026-08-20T13:00:00+08:00", shanghaiTZ)))
        XCTAssertEqual(st["wordOff"], .object(JSObject([("base:" + cDa, .number(5)), ("base:" + cXiao, .number(NOW))])))
        XCTAssertEqual(st["settings"], J(#"{"library":"core3500","sound":false,"remind":{"enabled":true,"permission":"granted"},"large":true}"#))
        XCTAssertNil(Schema.validateValue(key: SK("settings"), value: st["settings"]!))
        XCTAssertEqual(r.report["dropped"]!["soundScene"], .bool(true))
        XCTAssertEqual(st["backupMeta"], .object(JSObject([("lastExportAt", .number(JSDate.parse("2026-08-01T10:00:00+08:00", shanghaiTZ))), ("lastExportSig", .null)])))
        let days = st["legacy"]!["days"]!.arrayValue!
        XCTAssertTrue(days.contains(.string("2026-01-05")) && days.contains(.string("2026-02-01")), "practiceDays ∪ folded months")
        XCTAssertFalse(days.contains(.string("bad-day")))
        XCTAssertNil(Schema.validateValue(key: SK("legacy"), value: st["legacy"]!))
        let dropped = r.report["dropped"]!["keys"]!.arrayValue!
        XCTAssertTrue(dropped.contains(.string(Migrate.v1Key("session"))) && dropped.contains(.string(Migrate.v1Key("tuning"))))
        // 缺 added 时按旧版由 custom 词推导
        var noAdded = v.objectValue!
        noAdded["added"] = nil
        XCTAssertEqual(try convert(.object(noAdded)).state["custom"]!["added"]!.arrayValue!.map { $0["char"]! }, [.string(cBiao), .string(cXian3)])
        // 照片预算：≤30 张、合计 ≤420KiB、单张 ≤64KiB、只收 webp/jpeg、字须为汉字
        let chars = "\u{4E00}\u{4E8C}\u{4E09}\u{56DB}\u{4E94}\u{516D}\u{4E03}\u{516B}\u{4E5D}\u{5341}\u{4E0A}\u{4E0B}\u{5DE6}\u{53F3}\u{4E2D}\u{5927}\u{5C0F}\u{591A}\u{5C11}\u{5929}\u{5730}\u{4EBA}\u{53E3}\u{624B}\u{8DB3}\u{5C71}\u{6C34}\u{706B}\u{6728}\u{91D1}\u{571F}\u{65E5}\u{6708}\u{661F}\u{4E91}\u{98CE}\u{96E8}".unicodeScalars.map { String($0) }
        var caps = JSObject()
        for (i, ch) in chars.enumerated() { caps[ch] = J(#"{"day":"2026-09-01","at":\#(1000 + i),"dataURL":"data:image/jpeg;base64,\#(String(repeating: "B", count: 4000))"}"#) }
        caps["A"] = J(#"{"day":"2026-09-01","at":99999,"dataURL":"data:image/jpeg;base64,AAAA"}"#)
        caps["\u{56FE}"] = J(#"{"day":"2026-09-01","at":99998,"dataURL":"data:image/png;base64,AAAA"}"#)
        caps[cDa] = J(#"{"day":"2026-09-01","at":99997,"dataURL":"data:image/jpeg;base64,\#(String(repeating: "C", count: 90000))"}"#)
        let many = try convert(.object(JSObject([("wild", .object(JSObject([("captures", .object(caps))])))])))
        XCTAssertEqual(many.report["photos"]!["kept"], .number(30), "at most 30 photos")
        XCTAssertEqual(many.report["photos"]!["evicted"], .number(Double(chars.count - 1 - 30 + 3)))
        XCTAssertTrue(many.state["photos"]!["\u{4E00}"] == nil && many.state["photos"]!["\u{96E8}"] != nil, "newest kept first")
        var big = JSObject()
        for i in 0..<10 { big[chars[i]] = J(#"{"day":"2026-09-01","at":\#(10 + i),"dataURL":"data:image/webp;base64,\#(String(repeating: "D", count: 60000))"}"#) }
        XCTAssertEqual(try convert(.object(JSObject([("wild", .object(JSObject([("captures", .object(big))])))]))).report["photos"]!["kept"], .number(3), "420KiB / (60000×2) → 3")
    }

    // convertV1: perRecordInk 开启时 recentInk → 最近一次 correct 记录的 v3 墨迹（P31）；关闭时跳过
    func testConvertV1PerRecordInk() throws {
        let off = try convert(try smallV1(), policy: policyWith(features: [("perRecordInk", .bool(false))]))
        XCTAssertEqual(off.state["ink"], .object(JSObject()))
        XCTAssertEqual(off.report["ink"]!["skipped"], .number(1))
        let byDefault = try convert(try smallV1())
        XCTAssertEqual(byDefault.report["ink"]!["migrated"], .number(1), "default policy (D27) migrates the v1 recent ink")
        let on = try convert(try smallV1(), policy: policyWith(features: [("perRecordInk", .bool(true))]))
        XCTAssertEqual(byDefault.state["ink"], on.state["ink"])
        let target = flatRecords(on.state["records"]!.objectValue!).first { $0["char"] == .string(cPai) }!
        let month = String(target["localDay"]!.stringValue!.prefix(7))
        let ink = on.state["ink"]![month]![target["id"]!.stringValue!]
        XCTAssertTrue(InkMath.isInkV3(ink), "v3 packed ink")
        XCTAssertNil(Schema.validateValue(key: "shizi.v2.ink." + month, value: on.state["ink"]![month]!))
        XCTAssertEqual(try InkMath.decodeInk(ink)!.count, 2, "two strokes")
        XCTAssertEqual(on.report["ink"]!["migrated"], .number(1))
    }

    // readV1: 严格模式整单拒绝坏键；宽松模式跳过并登记
    func testReadV1StrictAndLoose() {
        XCTAssertEqual(Migrate.readV1(J(#"{"shizi.memory.v1":"{\"base:大\":{}}","shizi.quality.v1":"{oops"}"#), strict: true), J(#"{"ok":false,"reason":"shape","key":"shizi.quality.v1"}"#))
        XCTAssertEqual(Migrate.readV1(J(#"{"shizi.memory.v1":"[1]"}"#), strict: true), J(#"{"ok":false,"reason":"shape","key":"shizi.memory.v1"}"#))
        XCTAssertEqual(Migrate.readV1(J(#"{"shizi.memory.v1":5}"#), strict: true), J(#"{"ok":false,"reason":"value","key":"shizi.memory.v1"}"#))
        let loose = Migrate.readV1(J(#"{"shizi.memory.v1":"{}","shizi.wild.v1":"nope","shizi.other":"1"}"#))
        XCTAssertEqual(loose["ok"], .bool(true))
        XCTAssertEqual(loose["present"], J(#"["shizi.memory.v1","shizi.wild.v1"]"#))
        XCTAssertEqual(loose["bad"], J(#"["shizi.wild.v1"]"#))
    }

    // legacyBackupToV2 / importLegacyBackup / inspectBackup：真实 v1 fixture（300 字）→ 合法 v2 备份与报告
    func testLegacyBackupToV2RealFixture() throws {
        let text = try backupText()
        let backup = J(text)
        let r = Migrate.legacyBackupToV2(backup, now: NOW, dates: shanghai)
        XCTAssertEqual(r["ok"], .bool(true))
        let parsed = Schema.parseBackupV2(r["backup"]!)
        XCTAssertEqual(parsed["ok"], .bool(true), str(parsed))
        XCTAssertEqual(r["backup"]!["date"], backup["date"], "keeps the v1 export date")
        XCTAssertFalse(r["backup"]!["data"]!.objectValue!.keys.contains { $0.contains("sessions") || $0.contains("funnel") || $0.contains("safety") })
        var state = JSObject()
        for e in parsed["entries"]!.arrayValue! { state[e.arrayValue![0].stringValue!] = J(e.arrayValue![1].stringValue!) }
        XCTAssertNil(state[SK("meta")]!["migratedAt"], "backup import is not a device migration")
        XCTAssertGreaterThanOrEqual(state[SK("photos")]!.objectValue!.count, 1)
        let rep = r["report"]!
        XCTAssertTrue(rep["events"]!["uncertain"]!.numberValue! > 0 && rep["events"]!["hintedWithHints"]!.numberValue! > 0)
        XCTAssertTrue(rep["synthesized"]!["correct"]!.numberValue! > 0 && rep["synthesized"]!["fromLastReview"]!.numberValue! > 0 && rep["synthesized"]!["addedOnly"]!.numberValue! > 0)
        XCTAssertEqual(rep["dropped"]!["soundScene"], .bool(true))
        var judged = KeySet()
        for (k, v) in state.entries where k.hasPrefix("shizi.v2.records.") { for rec in v.arrayValue! where rec["kind"] == .string("judged") { judged.insert(rec["cardKey"]!.stringValue!) } }
        for k in state[SK("sched")]!.objectValue!.keys { XCTAssertTrue(judged.contains(k), "invariant: \(k)") }
        XCTAssertGreaterThanOrEqual(judged.count, 290)
        XCTAssertGreaterThan(rep["sched"]!["droppedNoJudged"]!.numberValue!, 0)

        let viaCore = Backup.importLegacyBackup(.string(text), now: NOW)
        XCTAssertEqual(viaCore["ok"], .bool(true))
        XCTAssertEqual(viaCore["report"]!["records"]!["chars"], .number(Double(judged.count)))
        let report = Backup.inspectBackup(.string(text), dates: shanghai)
        XCTAssertEqual([report["ok"]!, report["fromLegacy"]!, report["version"]!, report["count"]!], [.bool(true), .bool(true), .number(2), .number(Double(judged.count))])
        var broken = backup.objectValue!
        var data = broken["data"]!.objectValue!
        data["shizi.memory.v1"] = .string("[1,2]")
        broken["data"] = .object(data)
        let b = Backup.inspectBackup(.string(str(.object(broken))), dates: shanghai)
        XCTAssertEqual([b["reason"]!, b["kind"]!], [.string("shape"), .string("restoreFailed")])
        XCTAssertEqual(Migrate.legacyBackupToV2(J(#"{"app":"shizi","version":1,"data":{}}"#))["reason"], .string("empty"))
        XCTAssertEqual(Migrate.legacyBackupToV2(J(#"{"app":"other","version":1,"data":{}}"#))["reason"], .string("format"))
    }

    // bootMigration: 一次 writeAll 写全部 v2 键（meta 在数据键之后）、核对 meta.migratedAt、即删大键、其余 v1 键保留
    func testBootMigrationSingleWriteMetaLastBigKeysDropped() throws {
        let backend = try deviceBackend()
        let env = boot(backend)
        XCTAssertTrue(try Migrate.detectV1(env.store.storage))
        var txnWrites = 0
        var order: [String] = []
        backend.failWhen { w in
            if w.op == "set" && w.key == SK("txn") { txnWrites += 1 }
            if w.op == "set" && w.key.hasPrefix(Schema.v2Prefix) && w.key != SK("txn") { order.append(w.key) }
            return nil
        }
        let r = Migrate.bootMigration(env.store, now: { NOW })
        backend.failWhen(nil)
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        XCTAssertEqual(r["action"], .string("migrated"))
        XCTAssertEqual(r["metaVerified"], .bool(true))
        XCTAssertEqual(txnWrites, 1, "exactly one transaction")
        XCTAssertEqual(order.last, SK("meta"), "meta is written after every data key")
        XCTAssertLessThan(order.firstIndex(of: SK("legacy"))!, order.firstIndex(of: SK("meta"))!)
        XCTAssertNil(backend.rawGet(SK("txn")))
        let meta = J(backend.rawGet(SK("meta"))!)
        XCTAssertEqual(meta["migratedAt"], .number(NOW))
        XCTAssertEqual(meta["serial"], .number(env.store.serial))
        for (k, v) in backend.snapshot() where k.hasPrefix(Schema.v2Prefix) { XCTAssertNil(Schema.validateValue(key: k, value: J(v)), "\(k) valid") }
        XCTAssertEqual(UTF16Order.sorted(r["removed"]!.arrayValue!.map { $0.stringValue! }), ["shizi.corrupt.shizi.topic.v1", "shizi.safety.v1", "shizi.session.v1"])
        for (k, v) in J(try backupText())["data"]!.objectValue!.entries {
            if k == "shizi.session.v1" { XCTAssertNil(backend.rawGet(k)) } else { XCTAssertEqual(backend.rawGet(k), v.stringValue, "\(k) kept for the rollback window") }
        }
        let state = env.store.state
        let recs = state["records"]!.objectValue!.entries.flatMap { $0.value.arrayValue ?? [] }
        let judged = KeySet(recs.filter { $0["kind"] == .string("judged") }.map { $0["cardKey"]!.stringValue! })
        for k in state["sched"]!.objectValue!.keys { XCTAssertTrue(judged.contains(k)) }
        XCTAssertEqual(state["legacy"]!["report"]!["source"], .string("device"))
        XCTAssertEqual(state["funnel"]!["legacyImport"]!["records"], .number(Double(recs.count)))
        XCTAssertEqual(state["sessions"], .null, "no session migrated")
        let usage = Budget.estimateUsage(backend.snapshot())
        XCTAssertLessThan(usage["total"]!.numberValue!, Budgets.defaults.totalTargetBytes)
        let c = env.store.commit("next") { draft, ctx in
            var custom = draft["custom"]!.objectValue!
            custom["added"] = .array(custom["added"]!.arrayValue! + [JS.obj([("char", .string("\u{65B0}")), ("at", .number(NOW))])])
            draft["custom"] = .object(custom)
            _ = try ctx.nextId("r")
        }
        XCTAssertTrue(ok(c))
        XCTAssertEqual(env.store.serial, meta["serial"]!.numberValue! + 1)
        let again = boot(backend)
        let before = backend.writeCount
        let r2 = Migrate.bootMigration(again.store, now: { NOW + DAY })
        XCTAssertEqual(r2["action"], .string("none"))
        XCTAssertEqual(r2["released"], .array([]))
        XCTAssertEqual(backend.writeCount, before, "no writes on later boots inside the window")
    }

    // bootMigration 失败（配额注入）：v1 键完好、没有任何 v2 键、没有 meta；重启可重试
    func testBootMigrationFailureQuotaInjection() throws {
        let injections: [(StoreStorage) -> Void] = [
            { $0.failNextWrite(1, kind: "quota") },
            { $0.failNextWrite(1, kind: "quota", matchKey: SK("sched")) },
            { $0.failNextWrite(1, kind: "quota", matchKey: SK("meta")) },
        ]
        for inject in injections {
            let backend = try deviceBackend()
            let before = v1Snapshot(backend)
            let env = boot(backend)
            inject(env.storage)
            let r = Migrate.bootMigration(env.store, now: { NOW })
            XCTAssertEqual(r["ok"], .bool(false))
            XCTAssertEqual(r["error"]?["kind"], .string("quota"))
            XCTAssertEqual(r["error"]?["label"], .string(Migrate.label))
            XCTAssertEqual(v1Snapshot(backend), before, "v1 keys byte-identical")
            XCTAssertTrue(backend.snapshot().filter { $0.0.hasPrefix(Schema.v2Prefix) }.isEmpty, "no v2 keys, no meta, no txn")
            XCTAssertEqual(env.store.state["meta"], .null)
            let retry = boot(backend)
            let r2 = Migrate.bootMigration(retry.store, now: { NOW + 60000 })
            XCTAssertEqual(r2["ok"], .bool(true))
            XCTAssertEqual(r2["action"], .string("migrated"))
            XCTAssertEqual(J(backend.rawGet(SK("meta"))!)["migratedAt"], .number(NOW + 60000))
        }
    }

    // 迁移不做预算回收（reclaim:false）：真实配额不够时直接失败、不折叠
    func testMigrationDoesNotReclaim() throws {
        let backend = try deviceBackend()
        backend.quotaBytes = backend.usedBytes() + 20000
        let env = boot(backend)
        let r = try Migrate.runMigration(env.store, now: NOW)
        XCTAssertEqual(r["ok"], .bool(false))
        XCTAssertEqual(r["error"]?["kind"], .string("quota"))
        XCTAssertEqual(r["error"]?["recoveredAttempted"], .bool(false))
        XCTAssertNil(backend.rawGet(SK("meta")))
    }

    // P53 回退窗口：30 天到期或导出过一次 v2 后删其余 v1 键；窗口内保留
    func testP53RollbackWindow() throws {
        let backend = try deviceBackend()
        XCTAssertEqual(Migrate.bootMigration(boot(backend).store, now: { NOW })["action"], .string("migrated"))
        let inWindow = try Migrate.releaseLegacyKeys(boot(backend).store, now: NOW + 29 * DAY)
        XCTAssertEqual(inWindow["released"], .array([]))
        XCTAssertNotNil(backend.rawGet(Migrate.v1Key("memory")))
        let expired = Migrate.bootMigration(boot(backend).store, now: { NOW + 30 * DAY })
        XCTAssertEqual(expired["action"], .string("none"))
        let rel = expired["released"]!.arrayValue!
        XCTAssertTrue(rel.contains(.string(Migrate.v1Key("memory"))) && rel.contains(.string(Migrate.v1Key("wild"))))
        XCTAssertTrue(backend.snapshot().allSatisfy { $0.0.hasPrefix(Schema.v2Prefix) }, "only v2 keys remain")

        let b2 = try deviceBackend()
        let e2 = boot(b2)
        _ = Migrate.bootMigration(e2.store, now: { NOW })
        XCTAssertTrue(ok(Backup.markExported(e2.store, at: NOW + DAY)))
        let released = Migrate.bootMigration(boot(b2).store, now: { NOW + 2 * DAY })
        XCTAssertTrue(released["released"]!.arrayValue!.contains(.string(Migrate.v1Key("fsrsLog"))), "export releases the v1 keys early")
        let b3 = try deviceBackend()
        let e3 = boot(b3)
        _ = Migrate.bootMigration(e3.store, now: { NOW })
        XCTAssertLessThan(e3.store.state["backupMeta"]!["lastExportAt"]!.numberValue!, NOW)
        XCTAssertEqual(Migrate.bootMigration(boot(b3).store, now: { NOW + DAY })["released"], .array([]))
    }

    // bootMigration: 没有 v1 → none；policy 关闭 → disabled；v2 已有记录却没有 meta → 不覆盖；存储不可用 → 不迁
    func testBootMigrationNoneDisabledSkippedUnavailable() throws {
        XCTAssertEqual(Migrate.bootMigration(boot(MemoryDisk()).store, now: { NOW })["action"], .string("none"))
        XCTAssertEqual(Migrate.bootMigration(boot(try deviceBackend()).store, now: { NOW }, policy: policyWith(migration: [("importLegacy", .bool(false))]))["action"], .string("disabled"))
        let day = try shanghai.localDay(.number(NOW))
        let rec = #"[{"id":"r1","cardKey":"base:大","char":"大","sessionId":"s1","kind":"judged","judgment":"correct","at":\#(Int(NOW)),"localDay":"\#(day)","help":{"hints":0,"answerSeen":false,"traced":false}}]"#
        let withV2 = try deviceBackend([(Schema.recordsKey(String(day.prefix(7))), rec)])
        let env = boot(withV2)
        let before = diskObject(withV2)
        let r = Migrate.bootMigration(env.store, now: { NOW })
        XCTAssertEqual([r["ok"]!, r["action"]!, r["reason"]!], [.bool(true), .string("skipped"), .string("v2-records")])
        XCTAssertEqual(diskObject(withV2), before)
        let locked = try deviceBackend()
        locked.failReads("security")
        let store = Store(storage: StoreStorage(locked, now: { NOW }), now: { NOW }, dates: shanghai)
        store.load()
        XCTAssertEqual(Migrate.bootMigration(store, now: { NOW })["action"], .string("unavailable"))
    }

    // spreadLegacyDue: overdue entries spread from today on, at most perDay a day (counting entries already due that day), never earlier, others untouched
    func testSpreadLegacyDue() throws {
        func e(_ due: String, _ stability: Double = 5) -> JSValue { JS.obj([("fsrs", JS.obj([("stability", .number(stability))])), ("due", .string(due)), ("lastJudgedAt", .number(0))]) }
        var sched = JSObject()
        for i in 0..<25 { sched["base:" + String(Unicode.Scalar(0x4e00 + i)!)] = e(try shanghai.addDays(.string("2026-10-01"), Double(-30 + i)), Double(3 + i % 4)) }
        sched["base:\u{672A}"] = e("2026-10-02")
        sched["base:\u{8FDC}"] = e("2026-12-01")
        var stopped = e("2026-09-01").objectValue!
        stopped["stoppedAt"] = .number(5)
        sched["base:\u{505C}"] = .object(stopped)
        let frozen = str(.object(sched))
        let (out, moved) = try Migrate.spreadLegacyDue(.object(sched), today: "2026-10-01", perDay: 10, dates: shanghai)
        XCTAssertEqual(str(.object(sched)), frozen, "pure: input untouched")
        var perDay: [String: Int] = [:]
        for (k, v) in out.entries where k != "base:\u{505C}" {
            perDay[v["due"]!.stringValue!, default: 0] += 1
            XCTAssertFalse(UTF16Order.less(v["due"]!.stringValue!, sched[k]!["due"]!.stringValue!), "never moved earlier")
        }
        XCTAssertEqual(perDay["2026-10-01"], 10)
        XCTAssertEqual(perDay["2026-10-02"], 10)
        XCTAssertEqual(perDay["2026-10-03"], 6)
        XCTAssertEqual(out["base:\u{672A}"]!["due"], .string("2026-10-02"))
        XCTAssertEqual(out["base:\u{8FDC}"]!["due"], .string("2026-12-01"))
        XCTAssertEqual(out["base:\u{505C}"]!["due"], .string("2026-09-01"))
        XCTAssertEqual(moved, 25)
        XCTAssertEqual(out["base:\u{4E00}"]!["due"], .string("2026-10-01"))
        XCTAssertEqual(out["base:" + String(Unicode.Scalar(0x4e00 + 24)!)]!["due"], .string("2026-10-03"))
        let k24 = "base:" + String(Unicode.Scalar(0x4e00 + 24)!)
        XCTAssertEqual(setting(out[k24]!, "due", .null), setting(sched[k24]!, "due", .null), "only due changes")
        XCTAssertEqual(try Migrate.spreadLegacyDue(.object(JSObject([("base:\u{7532}", e("2026-09-01"))])), today: "2026-10-01", perDay: 10, dates: shanghai).moved, 0)
        XCTAssertEqual(Migrate.spreadPerDayOf(), 8, "round(groupSize 15 × 0.5)（D83 缺省 15）")
    }

    // convertV1: an old user with 60 overdue chars gets them spread over the next days (≤ 10 a day), records and cards unchanged (D65 #2)
    func testConvertV1OldUserWith60OverdueCharsSpread() throws {
        let today = try shanghai.localDay(.number(NOW))
        var memory = JSObject()
        var events: [JSValue] = []
        let base = dayMs(try shanghai.addDays(.string(today), -40), 12)
        for i in 0..<60 {
            let ch = String(Unicode.Scalar(0x4e00 + 40 + i)!)
            let key = "base:" + ch
            let reviewedMs = base + Double(i) * 60000
            let reviewed = try JSDate.isoString(reviewedMs)
            let due = try shanghai.addDays(.string(today), Double(-20 + i % 15))
            memory[key] = JS.obj([("seen", .number(1)), ("fast", .number(1)), ("last", .number(reviewedMs)), ("lastOutcome", .string("fast")), ("lastHints", .number(0)), ("traced", .bool(false)),
                                  ("fsrsCard", JS.obj([("due", .string(due + "T04:00:00.000Z")), ("stability", .number(5)), ("difficulty", .number(5)), ("elapsed_days", .number(1)), ("scheduled_days", .number(5)),
                                                       ("learning_steps", .number(0)), ("reps", .number(1)), ("lapses", .number(0)), ("state", .number(2)), ("last_review", .string(reviewed))])),
                                  ("dueDay", .string(due)), ("pendingLearning", .bool(false))])
            events.append(JS.obj([("eventId", .string("e\(i):fsrs")), ("attemptId", .string("e\(i)")), ("cardKey", .string(key)), ("target", .string(ch)), ("reviewedAt", .string(reviewed)),
                                  ("localDay", .string(try shanghai.localDay(.number(reviewedMs)))), ("rating", .string("Good")), ("reason", .string("independent")), ("hintCount", .number(0)),
                                  ("traced", .bool(false)), ("teaching", .bool(false)), ("plannedDue", .string(try shanghai.addDays(.string(today), -40)))]))
        }
        let values = JS.obj([("memory", .object(memory)), ("fsrsLog", JS.obj([("version", .number(2)), ("events", .array(events))]))])
        let r = try convert(values)
        let dues = r.state["sched"]!.objectValue!.entries.map { $0.value["due"]!.stringValue! }
        var byDay: [String: Int] = [:]
        for d in dues { byDay[d, default: 0] += 1 }
        XCTAssertTrue(byDay.values.allSatisfy { $0 <= 10 })
        XCTAssertEqual(dues.filter { !UTF16Order.less(today, $0) }.count, 8, "only 8 left due on the migration day (round(15 × 0.5))")
        XCTAssertEqual(r.report["sched"]!["spread"], .number(60))
        let noSpread = try convert(values, policy: policyWith(migration: [("spreadDuePerDayShare", .number(0))]))
        XCTAssertEqual(noSpread.state["sched"]!.objectValue!.entries.filter { !UTF16Order.less(today, $0.value["due"]!.stringValue!) }.count, 60)
        for (k, v) in r.state["sched"]!.objectValue!.entries { XCTAssertEqual(v["fsrs"], noSpread.state["sched"]![k]!["fsrs"], "FSRS card unchanged") }
        XCTAssertEqual(r.state["records"], noSpread.state["records"])
    }
}
