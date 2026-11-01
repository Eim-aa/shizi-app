import Foundation
import XCTest
@testable import ShiziCore

// test/store/storage.test.mjs 的转写（B4.4，11 条）：事务写、固定顺序、逐键核对、回滚、回滚失败隔离与阻断、配额分类、启动修复。

private func seedBackend(_ state: JSObject = storeBaseline()) -> MemoryDisk {
    var initial: [(String, String)] = []
    for (domain, v) in state.entries {
        if domain == "records" { for (m, x) in v.objectValue!.entries { initial.append((Schema.recordsKey(m), str(x))) } } else if domain == "ink" { for (m, x) in v.objectValue!.entries { initial.append((Schema.inkKey(m), str(x))) } } else if !v.isNull { initial.append((SK(domain), str(v))) }
    }
    return MemoryDisk(initial: initial)
}

private func traceWrites(_ d: MemoryDisk) -> () -> [String] {
    final class Box { var order: [String] = [] }
    let box = Box()
    d.failWhen { w in box.order.append(w.op + ":" + w.key); return nil }
    return { box.order }
}

private func throwsWrite(_ body: () throws -> Void, file: StaticString = #filePath, line: UInt = #line, _ check: (StoreJSError) -> Bool) {
    do {
        try body()
        XCTFail("expected a throw", file: file, line: line)
    } catch let e as StoreJSError {
        XCTAssertTrue(check(e), "unexpected error \(e) kind=\(e.kind ?? "nil") key=\(e.key ?? "nil")", file: file, line: line)
    } catch {
        XCTFail("unexpected error \(error)", file: file, line: line)
    }
}

final class StorageTests: XCTestCase {
    // test/store/storage.test.mjs: writeAll: txn first, fixed data order (ink.<月> → records.<月> → sched → … → meta → sessions last), txn removed
    func testWriteAllTxnFirstFixedDataOrderTxnRemoved() throws {
        let backend = seedBackend()
        let storage = StoreStorage(backend, now: { 42 })
        let order = traceWrites(backend)
        let s = storeBaseline()
        var meta = s["meta"]!.objectValue!
        meta["serial"] = .number(9)
        let entries: [(String, String?)] = [
            (SK("sessions"), str(s["sessions"]!)), (SK("meta"), str(.object(meta))), (SK("sched"), "{}"), (Schema.recordsKey("2026-10"), "[]"),
            (Schema.recordsKey("2026-08"), "[]"), (SK("settings"), #"{"sound":false}"#), (Schema.inkKey("2026-10"), "{}"), (Schema.inkKey("2026-09"), "{}"),
        ]
        let written = try storage.writeAll(entries, label: "order")
        XCTAssertEqual(order(), [
            "set:" + SK("txn"), "set:" + Schema.inkKey("2026-09"), "set:" + Schema.inkKey("2026-10"), "set:" + Schema.recordsKey("2026-08"),
            "set:" + Schema.recordsKey("2026-10"), "set:" + SK("sched"), "set:" + SK("settings"), "set:" + SK("meta"), "remove:" + SK("txn"),
        ])
        XCTAssertNil(backend.rawGet(SK("txn")))
        XCTAssertFalse(written.contains(SK("sessions")), "unchanged key is skipped")
        XCTAssertGreaterThan(StoreStorage.writeRank(SK("sessions")), StoreStorage.writeRank(SK("meta")))
        XCTAssertGreaterThan(StoreStorage.writeRank(SK("meta")), StoreStorage.writeRank(SK("safety")))
    }

    // test/store/storage.test.mjs: write failure: rolls back in reverse order; previously-missing key rolls back to null (removeItem)
    func testWriteFailureRollsBackInReverseOrderPreviouslyMissingKeyRollsBackToNull() throws {
        let backend = seedBackend()
        let before = backend.snapshot()
        let storage = StoreStorage(backend)
        backend.failWhen { w in w.op == "set" && w.key == SK("meta") ? .generic("generic") : nil }
        let newMonth = Schema.recordsKey("2026-10")
        XCTAssertNil(backend.rawGet(newMonth))
        throwsWrite({ try storage.writeAll([(newMonth, "[]"), (SK("sched"), "{}"), (SK("meta"), "{}")], label: "fail-meta") }) {
            $0.cls == .write && $0.kind == "unknown" && $0.key == SK("meta")
        }
        XCTAssertNil(backend.rawGet(newMonth), "key that did not exist before is removed again")
        XCTAssertEqual(backend.snapshot().map { $0.0 + "=" + $0.1 }, before.map { $0.0 + "=" + $0.1 }, "all keys back to pre-write values, txn gone")
    }

    // test/store/storage.test.mjs: read-back verification mismatch triggers rollback
    func testReadBackVerificationMismatchTriggersRollback() throws {
        let backend = seedBackend()
        let before = backend.snapshot().map { $0.0 + "=" + $0.1 }
        let storage = StoreStorage(backend)
        var hits = 0
        backend.failWhen { w in
            if w.op == "set" && w.key == SK("sched") { hits += 1; if hits == 1 { return .corrupt(#"{"silently":"different"}"#) } }
            return nil
        }
        throwsWrite({ try storage.writeAll([(Schema.inkKey("2026-09"), "{}"), (SK("sched"), "{}"), (SK("sessions"), #"{"A":null,"B":null,"lastEnded":{}}"#)]) }) {
            $0.cls == .write && $0.kind == "verify" && $0.key == SK("sched")
        }
        backend.failWhen(nil)
        XCTAssertEqual(backend.snapshot().map { $0.0 + "=" + $0.1 }, before)
    }

    // test/store/storage.test.mjs: rollback failure: unrecoverable keys quarantined to shizi.corrupt.*, txn copied, BlockingStorageError, later writes blocked
    func testRollbackFailureUnrecoverableKeysQuarantinedTxnCopiedBlockingLaterWritesBlocked() throws {
        let backend = seedBackend()
        let storage = StoreStorage(backend)
        let originalSched = backend.rawGet(SK("sched"))
        var schedWrites = 0
        backend.failWhen { w in
            if w.op == "set" && w.key == SK("sched") {
                schedWrites += 1
                return schedWrites >= 2 ? .quota : nil // 第一次（写新值）成功，第二次（回滚）失败
            }
            if w.op == "set" && w.key == SK("meta") { return .quota }
            return nil
        }
        throwsWrite({ try storage.writeAll([(SK("sched"), "{}"), (SK("meta"), "{}")], label: "doomed") }) {
            $0.cls == .blocking && $0.keys.contains(SK("sched")) && $0.cause?.kind == "quota"
        }
        backend.failWhen(nil)
        XCTAssertEqual(backend.rawGet("shizi.corrupt." + SK("sched")), "{}", "the half-written value is moved aside")
        XCTAssertNil(backend.rawGet(SK("sched")), "original key removed")
        let txnCopy = J(backend.rawGet("shizi.corrupt." + SK("txn"))!)
        XCTAssertEqual(txnCopy["prev"]?[SK("sched")]?.stringValue, originalSched, "txn (with prev) is preserved for export/repair")
        XCTAssertNotNil(backend.rawGet(SK("txn")), "live txn stays so the next boot can roll back from prev")
        XCTAssertEqual(storage.blocked?.reason, "rollback-failed")
        throwsWrite({ try storage.writeAll([(SK("settings"), "{}")]) }) { $0.cls == .blocking }

        // 下次启动：repair 用 txn.prev 把 sched 恢复到写前
        let next = StoreStorage(backend)
        let report = try next.repair()
        XCTAssertEqual(report["txn"], .string("rolled-back"))
        XCTAssertEqual(backend.rawGet(SK("sched")), originalSched)
        XCTAssertNil(backend.rawGet(SK("txn")))
    }

    // test/store/storage.test.mjs: quota classification
    func testQuotaClassification() throws {
        XCTAssertEqual(StoreStorage.classify(MemoryDisk.makeError("quota")), "quota")
        let ns = StoreJSError(.plain, name: "NS_ERROR_DOM_QUOTA_REACHED", message: "")
        XCTAssertEqual(StoreStorage.classify(ns), "quota")
        let c22 = StoreJSError(.plain, name: "Error", message: "")
        c22.code = .number(22)
        XCTAssertEqual(StoreStorage.classify(c22), "quota")
        let c1014 = StoreJSError(.plain, name: "", message: "")
        c1014.code = .number(1014)
        XCTAssertEqual(StoreStorage.classify(c1014), "quota")
        XCTAssertEqual(StoreStorage.classify(MemoryDisk.makeError("security")), "security")
        let c18 = StoreJSError(.plain, name: "", message: "")
        c18.code = .number(18)
        XCTAssertEqual(StoreStorage.classify(c18), "security")
        XCTAssertEqual(StoreStorage.classify(StoreJSError.typeError("x")), "unknown")
        XCTAssertEqual(StoreStorage.classify(nil), "unknown")

        let backend = seedBackend()
        let storage = StoreStorage(backend)
        backend.failWhen { w in w.op == "set" && w.key == Schema.inkKey("2026-09") ? .quota : nil }
        throwsWrite({ try storage.writeAll([(Schema.inkKey("2026-09"), "{}")]) }) { $0.kind == "quota" }
        backend.failWhen { w in w.op == "set" && w.key == Schema.inkKey("2026-09") ? .security : nil }
        throwsWrite({ try storage.writeAll([(Schema.inkKey("2026-09"), "{}")]) }) { $0.kind == "security" }
        backend.failWhen(nil)
        // 真实配额上限
        let tiny = MemoryDisk(quotaBytes: 200)
        let s2 = StoreStorage(tiny)
        throwsWrite({ try s2.writeAll([(SK("settings"), str(.object(JSObject([("library", .string(String(repeating: "x", count: 200)))]))))]) }) { $0.kind == "quota" }
        XCTAssertTrue(tiny.snapshot().isEmpty, "nothing left behind")
    }

    // test/store/storage.test.mjs: storage-level failNextWrite (test hook path): kinds and matchKey prefix
    func testStorageLevelFailNextWriteKindsAndMatchKeyPrefix() throws {
        let backend = seedBackend()
        let storage = StoreStorage(backend)
        storage.failNextWrite(1, kind: "quota", matchKey: "shizi.v2.records.*")
        throwsWrite({ try storage.writeAll([(Schema.inkKey("2026-09"), "{}"), (Schema.recordsKey("2026-11"), "[]")]) }) {
            $0.kind == "quota" && $0.key == Schema.recordsKey("2026-11")
        }
        XCTAssertNil(backend.rawGet(Schema.recordsKey("2026-11")))
        try storage.writeAll([(Schema.recordsKey("2026-11"), "[]")]) // 注入已用完
        XCTAssertEqual(backend.rawGet(Schema.recordsKey("2026-11")), "[]")
        storage.failNextWrite(1) // 无 matchKey：下一次写（即 txn）失败
        throwsWrite({ try storage.writeAll([(SK("settings"), "{}")]) }) { $0.key == SK("txn") && $0.kind == "unknown" }
        storage.failNextWrite(1, kind: "security")
        throwsWrite({ try storage.writeAll([(SK("settings"), "{}")]) }) { $0.kind == "security" }
    }

    // test/store/storage.test.mjs: finalize: when txn removal fails the txn is marked done; repair keeps the post-write state
    func testFinalizeWhenTxnRemovalFailsTheTxnIsMarkedDoneRepairKeepsThePostWriteState() throws {
        let backend = seedBackend()
        let storage = StoreStorage(backend)
        backend.failWhen { w in w.op == "remove" && w.key == SK("txn") ? .generic("generic") : nil }
        try storage.writeAll([(SK("settings"), #"{"sound":false}"#)])
        backend.failWhen(nil)
        XCTAssertEqual(J(backend.rawGet(SK("txn"))!)["phase"], .string("done"))
        let report = try StoreStorage(backend).repair()
        XCTAssertEqual(report["txn"], .string("completed"))
        XCTAssertEqual(backend.rawGet(SK("settings")), #"{"sound":false}"#)
        XCTAssertNil(backend.rawGet(SK("txn")))
    }

    // test/store/storage.test.mjs: repair: bad JSON / bad shape quarantined, original removed, reported once; good keys untouched
    func testRepairBadJSONBadShapeQuarantinedOriginalRemovedReportedOnceGoodKeysUntouched() throws {
        let backend = seedBackend()
        backend.rawSet(SK("sched"), "{not json")
        backend.rawSet(Schema.recordsKey("2026-08"), #"[{"id":"x"}]"#)
        backend.rawSet("shizi.v2.records.2026-13", "[]")
        backend.rawSet("shizi.memory.v1", #"{"legacy":true}"#)
        let goodMeta = backend.rawGet(SK("meta"))
        let report = try StoreStorage(backend).repair()
        XCTAssertEqual(UTF16Order.sorted((report["quarantined"]?.arrayValue ?? []).map { $0["key"]!.stringValue! }), UTF16Order.sorted([Schema.recordsKey("2026-08"), SK("sched")]))
        XCTAssertEqual(report["unknown"], .array([.string("shizi.v2.records.2026-13")]), "unknown v2 keys are left alone")
        XCTAssertNil(backend.rawGet(SK("sched")))
        XCTAssertEqual(backend.rawGet("shizi.corrupt." + SK("sched")), "{not json")
        XCTAssertEqual(backend.rawGet(SK("meta")), goodMeta)
        XCTAssertEqual(backend.rawGet("shizi.memory.v1"), #"{"legacy":true}"#, "v1 keys are not touched")
        let second = try StoreStorage(backend).repair()
        XCTAssertEqual(second["quarantined"], .array([]), "second boot has nothing new to report")
    }

    // test/store/storage.test.mjs: probe: security error on write is reported as unavailable
    func testProbeSecurityErrorOnWriteIsReportedAsUnavailable() {
        let backend = MemoryDisk()
        backend.failReads("security")
        let result = StoreStorage(backend).probe()
        XCTAssertFalse(result.ok)
        XCTAssertEqual(result.kind, "security")
        XCTAssertTrue(StoreStorage(MemoryDisk()).probe().ok)
    }

    // test/store/storage.test.mjs: writeAll refuses to touch txn/probe keys and non-string values
    func testWriteAllRefusesToTouchTxnProbeKeysAndNonStringValues() throws {
        let storage = StoreStorage(MemoryDisk())
        throwsWrite({ try storage.writeAll([(SK("txn"), "{}")]) }) { $0.name == "TypeError" }
        throwsWrite({ try storage.writeAll([(SK("probe"), "1")]) }) { $0.name == "TypeError" }
        // 非字串值：Swift 的接口类型已排除（值是 String?）——编译期保证，不能写出原用例的 {a:1}
        XCTAssertEqual(try storage.writeAll([]), [])
    }

    // test/store/storage.test.mjs: writeOne: single-key atomic write without txn (budget side recovery); verify mismatch restores the old value
    func testWriteOneSingleKeyAtomicWriteWithoutTxnVerifyMismatchRestoresTheOldValue() throws {
        let backend = seedBackend()
        let storage = StoreStorage(backend)
        let order = traceWrites(backend)
        let key = Schema.inkKey("2026-09")
        XCTAssertEqual(try storage.writeOne(key, "{}", label: "shrink"), [key])
        XCTAssertEqual(order(), ["set:" + key], "no txn written")
        XCTAssertEqual(backend.rawGet(key), "{}")
        XCTAssertEqual(try storage.writeOne(key, "{}"), [], "unchanged value is skipped")
        try storage.writeOne(key, nil)
        XCTAssertNil(backend.rawGet(key), "null removes the key")
        backend.rawSet(key, #"{"a":1}"#)
        var hits = 0
        backend.failWhen { w in
            if w.op == "set" && w.key == key { hits += 1; if hits == 1 { return .corrupt(#"{"b":2}"#) } }
            return nil
        }
        throwsWrite({ try storage.writeOne(key, "{}") }) { $0.cls == .write && $0.kind == "verify" }
        backend.failWhen(nil)
        XCTAssertEqual(backend.rawGet(key), #"{"a":1}"#, "old value restored")
        XCTAssertNil(backend.rawGet(SK("txn")))
        throwsWrite({ try storage.writeOne(SK("txn"), "{}") }) { $0.name == "TypeError" }
    }

    // B4.9c：测试替身（JS 夹具把 storage.probe / storage.blocked 换成假的同一件事）——探测按替身答；blocked 只改 store 读到的（JS 换的也只是这个读口），
    // 写入照常；摘掉替身后重读回到真的
    func testProbeAndBlockedOverridesActLikeTheJSStandIns() throws {
        for B in TestBackend.allCases {
            let env = seeded(B)
            env.storage.probeOverride = (false, "security")
            env.store.load()
            XCTAssertFalse(env.store.available, B.name)
            env.storage.probeOverride = nil
            env.storage.blockedOverride = ("rollback-failed", [], [])
            env.store.load()
            XCTAssertTrue(env.store.available, B.name)
            XCTAssertEqual(env.store.blocked?["reason"], .string("rollback-failed"), B.name)
            XCTAssertNoThrow(try env.storage.writeOne(SK("settings"), #"{"appearance":"dark"}"#), B.name)
            env.storage.blockedOverride = nil
            env.store.load()
            XCTAssertNil(env.store.blocked, B.name)
        }
    }
}
