import Foundation
import XCTest
@testable import ShiziCore

// test/store/store.test.mjs 的转写（B4.4，26 条 × 两种后端 = 52）：commit 事务语义、写失败不发布、中断矩阵、坏值隔离提示一次、
// 配额回收重试、seed、备份整单拒绝。两种后端同一份契约（localStorage 替身 MemoryDisk / 原生 SQLite 替身 FakeNativeDisk），
// 只有后端内部机制不同的地方（txn 日志 vs 原生事务、回滚失败 vs 结果未知）按 B.native 分开断言。
// 与 JS 的差别：原用例里「已发布状态是冻结的同一个对象」「mutate 就地改冻结对象被拒」「包一层 storage.writeAll 数调用」在值类型
// 与 Swift 里没有对应物，分别转写为「状态值不变」「草稿是副本，发布前改不到已发布状态」「磁盘写日志里没有任何写」。

private func plainState(_ s: Store) -> String { sortedJSON(.object(s.state)) }

/// helpers.mjs 之外的 inkHeavyState：同一个字每个月写一次（只有最近一次受保护）。
private func inkHeavyState(_ count: Int) -> JSObject {
    var s = storeBaseline()
    var months = JSObject()
    var ink = s["ink"]!.objectValue!
    var serial = 10
    for i in 0..<count {
        let month = "2026-0\(1 + (i % 8))"
        serial += 1
        let rec = srec(serial, cShui, day: month + "-10", at: T0 - Double(count - i) * ONE_DAY_MS)
        months[month] = .array((months[month]?.arrayValue ?? []) + [rec])
        var t = ink[month]?.objectValue ?? JSObject()
        t[rec["id"]!.stringValue!] = inkEntry(30, 6)
        ink[month] = .object(t)
    }
    var records = s["records"]!.objectValue!
    for (m, v) in months.entries { records[m] = v }
    s["records"] = .object(records)
    s["ink"] = .object(ink)
    var meta = s["meta"]!.objectValue!
    meta["serial"] = .number(Double(serial))
    meta["months"] = .array(UTF16Order.sorted(records.keys).map { .string($0) })
    s["meta"] = .object(meta)
    return s
}

private func backupFrom(_ state: JSObject) -> JSValue {
    var data = JSObject()
    for d in ["meta", "sched", "custom", "settings", "backupMeta"] where !(state[d]?.isNull ?? true) { data[SK(d)] = .string(str(state[d]!)) }
    for (m, v) in state["records"]!.objectValue!.entries { data[Schema.recordsKey(m)] = .string(str(v)) }
    for (m, v) in state["ink"]?.objectValue?.entries ?? [] { data[Schema.inkKey(m)] = .string(str(v)) }
    return .object(JSObject([("app", .string("shizi")), ("version", .number(2)), ("date", .string("2026-09-01T00:00:00.000Z")), ("data", .object(data))]))
}

private func settingsMutation(_ patch: [(String, JSValue)]) -> (inout JSObject, inout CommitContext) throws -> Void {
    return { draft, _ in
        var s = draft["settings"]?.objectValue ?? JSObject()
        for (k, v) in patch { s[k] = v }
        draft["settings"] = .object(s)
    }
}

/// 契约用例（两种后端各跑一遍，见文件末的两个测试类）。
enum StoreContract {
    // test/store/store.test.mjs: commit success: publishes new frozen state, notifies subscribers, allocates ids from derived serial
    static func commitSuccess(_ B: TestBackend) {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        XCTAssertEqual(store.serial, 3)
        var seen: [JSObject] = []
        store.subscribe { _, info in seen.append(info) }
        let before = store.state
        var order: [String] = []
        backend.failWhen { w in
            if w.op == "set" && w.key != SK("txn") { order.append(w.key) }
            return nil
        }
        let r = store.commit("judge", judgeMutation(cDa))
        backend.failWhen(nil)
        XCTAssertTrue(ok(r), str(r))
        let after = store.state
        XCTAssertNotEqual(str(.object(after)), str(.object(before)))
        XCTAssertEqual(after["records"]!["2026-10"]!.arrayValue![0]["id"]?.stringValue, "r4")
        XCTAssertEqual(after["meta"]!["serial"], .number(4))
        XCTAssertEqual(after["meta"]!["months"], J(#"["2026-09","2026-10"]"#), "meta.months follows records keys")
        XCTAssertNil(before["records"]!["2026-10"], "previous state value untouched")
        XCTAssertEqual(seen.count, 1)
        XCTAssertEqual(seen[0]["type"], .string("commit"))
        let keys = r["keys"]!.arrayValue!.map { $0.stringValue! }
        XCTAssertEqual(keys.last, SK("sessions"), "sessions written last")
        XCTAssertNil(backend.rawGet(SK("txn")))
        XCTAssertEqual(J(backend.rawGet(Schema.recordsKey("2026-10"))!), after["records"]!["2026-10"]!)
        XCTAssertTrue(keys.contains(Schema.inkRecordKey("2026-10", "r4")), "new record ink goes to its own key")
        XCTAssertEqual(keys.filter { $0.hasPrefix("shizi.v2.ink.") }.count, 1, "only that one ink key written")
        let iInk = order.firstIndex(of: Schema.inkRecordKey("2026-10", "r4"))!
        XCTAssertLessThan(iInk, order.firstIndex(of: Schema.recordsKey("2026-10"))!, "ink written before records month")
        XCTAssertEqual(order.last, SK("sessions"), "sessions is the last data key written")
        XCTAssertNil(backend.rawGet("shizi.v2.ink"), "no single ink key any more")
        XCTAssertNil(backend.rawGet(Schema.inkKey("2026-10")), "no month key either")
        XCTAssertEqual(J(backend.rawGet(Schema.inkRecordKey("2026-10", "r4"))!), inkEntry())
        XCTAssertEqual(store.getInk(after["records"]!["2026-10"]!.arrayValue![0]), inkEntry())
    }

    // test/store/store.test.mjs: ink v3 (P78): legacy v2 ink on disk still loads and decodes; v2 and v3 entries live side by side in one month
    static func inkV3LegacyV2Loads(_ B: TestBackend) throws {
        let backend = B.make()
        let env = seeded(B, disk: backend)
        let v2ink = JSValue.object(JSObject([("2026-09", .object(JSObject([("r2", inkEntryV2())])))]))
        XCTAssertTrue(ok(env.store.commit("legacy ink") { draft, _ in draft["ink"] = v2ink }))
        let fresh = freshStore(B, disk: backend)
        let r2 = fresh.store.state["records"]!["2026-09"]!.arrayValue![0]
        let legacy = fresh.store.getInk(r2)
        XCTAssertTrue(InkMath.isInkV2(legacy), "v2 survives load (not quarantined)")
        XCTAssertNil(backend.rawGet("shizi.corrupt." + Schema.inkKey("2026-09")))
        XCTAssertEqual(try InkMath.decodeInk(legacy)![0].count, 8, "v2 decodes")
        let r3 = fresh.store.state["records"]!["2026-09"]!.arrayValue![1]
        let r = fresh.store.commit("v3 ink") { draft, _ in try Store.setInk(&draft, r3, inkEntry(), timeZone: shanghaiTZ) }
        XCTAssertTrue(ok(r), str(r))
        XCTAssertTrue(InkMath.isInkV2(J(backend.rawGet(Schema.inkRecordKey("2026-09", "r2"))!)) && InkMath.isInkV3(J(backend.rawGet(Schema.inkRecordKey("2026-09", "r3"))!)),
                      "same month: r2 v2, r3 v3, one key each")
        XCTAssertEqual(try InkMath.decodeInk(fresh.store.getInk(r3))!.map { $0.count }, [8, 8, 8])
    }

    // test/store/store.test.mjs: ink helpers: getInk / setInk / deleteInk address state.ink[record month]; on disk one key per record, txn only carries that record
    static func inkHelpers(_ B: TestBackend) throws {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        let r2 = store.state["records"]!["2026-09"]!.arrayValue![0]
        XCTAssertEqual(Store.getInk(store.state, r2, timeZone: shanghaiTZ), inkEntry(), "baseline r2 ink lives in 2026-09")
        XCTAssertNil(Store.getInk(store.state, store.state["records"]!["2026-09"]!.arrayValue![1], timeZone: shanghaiTZ), "r3 has no ink (10.12)")
        XCTAssertNil(Store.getInk(store.state, setting(r2, "inkId", .string("r3")), timeZone: shanghaiTZ), "inkId wins over id")
        let r3 = store.state["records"]!["2026-09"]!.arrayValue![1]
        var setResult: JSValue = .null
        let r = store.commit("ink r3") { draft, _ in setResult = try Store.setInk(&draft, r3, inkEntry(4, 2), timeZone: shanghaiTZ) }
        XCTAssertEqual(setResult, J(#"{"month":"2026-09","id":"r3"}"#))
        XCTAssertTrue(ok(r), str(r))
        // 原用例包一层 storage.writeAll 抓 txn：写入的条目只有 r3 这一条（commit 回包的 keys 就是 writeAll 的条目）
        XCTAssertEqual(r["keys"], .array([.string(Schema.inkRecordKey("2026-09", "r3"))]), "only r3 written (r2 untouched)")
        XCTAssertEqual(J(backend.rawGet(Schema.inkRecordKey("2026-09", "r3"))!), inkEntry(4, 2))
        XCTAssertEqual(J(backend.rawGet(Schema.inkRecordKey("2026-09", "r2"))!), inkEntry())
        // 删光一个月 → 月键移除
        let del = store.commit("drop ink") { draft, _ in
            XCTAssertTrue(Store.deleteInk(&draft, r2, timeZone: shanghaiTZ))
            XCTAssertFalse(Store.deleteInk(&draft, r2, timeZone: shanghaiTZ), "already gone")
            try Store.setInk(&draft, r3, nil, timeZone: shanghaiTZ)
        }
        XCTAssertTrue(ok(del))
        XCTAssertNil(backend.rawGet(Schema.inkRecordKey("2026-09", "r2")), "deleted record key removed")
        XCTAssertNil(backend.rawGet(Schema.inkRecordKey("2026-09", "r3")), "deleted record key removed")
        XCTAssertEqual(store.state["ink"], .object(JSObject()))
        let bad = store.commit("no month") { draft, _ in try Store.setInk(&draft, J(#"{"id":"r9"}"#), inkEntry(), timeZone: shanghaiTZ) }
        XCTAssertEqual(errKind(bad), "mutator")
        let badMonth = store.commit("bad month") { draft, _ in
            var ink = draft["ink"]!.objectValue!
            ink["2026-9"] = .object(JSObject([("r2", inkEntry())]))
            draft["ink"] = .object(ink)
        }
        XCTAssertEqual(errKind(badMonth), "shape")
    }

    // test/store/store.test.mjs: write failure does not publish: in-memory state and storage stay as before; retry succeeds without double count
    static func writeFailureDoesNotPublish(_ B: TestBackend) {
        let env = seeded(B)
        let (store, storage, backend) = (env.store, env.storage, env.disk)
        let beforeState = str(.object(store.state))
        let beforeDisk = diskObject(backend)
        var calls = 0
        store.subscribe { _, _ in calls += 1 }
        storage.failNextWrite(1, kind: "generic", matchKey: SK("sched"))
        let r = store.commit("judge", judgeMutation(cDa))
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "unknown")
        XCTAssertEqual(r["error"]?["key"], .string(SK("sched")))
        XCTAssertEqual(str(.object(store.state)), beforeState, "nothing published")
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(diskObject(backend), beforeDisk)
        let retry = store.commit("judge", judgeMutation(cDa))
        XCTAssertTrue(ok(retry))
        XCTAssertEqual(store.state["records"]!["2026-10"]!.arrayValue!.count, 1, "retry writes exactly one record")
        XCTAssertEqual(store.state["records"]!["2026-10"]!.arrayValue![0]["id"], .string("r4"), "failed attempt did not burn a persisted id")
    }

    // test/store/store.test.mjs: verify mismatch → rollback → not published
    static func verifyMismatch(_ B: TestBackend) {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        let beforeDisk = diskObject(backend)
        let beforeState = str(.object(store.state))
        var hits = 0
        backend.failWhen { w in
            if w.op == "set" && w.key == Schema.inkRecordKey("2026-10", "r4") { hits += 1; if hits == 1 { return .corrupt("{}") } }
            return nil
        }
        let r = store.commit("judge", judgeMutation(cDa))
        backend.failWhen(nil)
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "verify")
        XCTAssertEqual(str(.object(store.state)), beforeState)
        XCTAssertEqual(diskObject(backend), beforeDisk)
    }

    // test/store/store.test.mjs: mutator mutating frozen state in place is rejected (copy-on-write discipline); shape errors never reach storage
    static func mutatorAndShapeErrors(_ B: TestBackend) {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        let beforeDisk = diskObject(backend)
        let published = str(.object(store.state))
        // Swift：草稿是副本——mutate 改了草稿又抛错，已发布状态一字不变（JS 里是「就地改冻结对象 → mutator」）
        let r = store.commit("bad") { draft, _ in
            var s = draft["sessions"]!.objectValue!
            var A = s["A"]!.objectValue!
            A["cursor"] = .number(5)
            s["A"] = .object(A)
            draft["sessions"] = .object(s)
            throw CoreError.type("Cannot assign to read only property 'cursor' of object")
        }
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "mutator")
        XCTAssertEqual(str(.object(store.state)), published)
        let r2 = store.commit("bad-shape") { draft, _ in
            var recs = draft["records"]!.objectValue!
            recs["2026-09"] = .array(recs["2026-09"]!.arrayValue! + [J(#"{"id":"r9","nonsense":true}"#)])
            draft["records"] = .object(recs)
        }
        XCTAssertFalse(ok(r2))
        XCTAssertEqual(errKind(r2), "shape")
        XCTAssertEqual(r2["error"]?["key"], .string(Schema.recordsKey("2026-09")))
        let r3 = store.commit("unknown-domain") { draft, _ in draft["bogus"] = .number(1) }
        XCTAssertEqual(errKind(r3), "shape")
        XCTAssertEqual(diskObject(backend), beforeDisk)
        let noop = store.commit("noop") { _, _ in }
        XCTAssertEqual(noop, J(#"{"ok":true,"keys":[],"recovered":[]}"#))
    }

    // test/store/store.test.mjs: interruptAfterWrite(k) matrix k=1..N: after reload state is exactly pre or post; records unique; ids do not collide
    static func interruptMatrix(_ B: TestBackend) {
        let probe = seeded(B)
        let pre = plainState(probe.store)
        let writesBefore = probe.disk.writeCount
        XCTAssertTrue(ok(probe.store.commit("judge", judgeMutation(cDa))))
        let N = probe.disk.writeCount - writesBefore
        let post = plainState(probe.store)
        XCTAssertGreaterThanOrEqual(N, 5, "commit should touch several keys (N=\(N))")
        var outcomes: [String] = []
        for k in 1...(N + 1) {
            let env = seeded(B)
            env.storage.interruptAfterWrite(Double(k))
            let r = env.store.commit("judge", judgeMutation(cDa))
            if k < N { XCTAssertFalse(ok(r), "k=\(k) must not report success") }
            let reloaded = freshStore(B, disk: env.disk)
            let state = plainState(reloaded.store)
            let isPre = state == pre, isPost = state == post
            XCTAssertTrue(isPre || isPost, "k=\(k): state is neither pre nor post")
            outcomes.append(isPre ? "pre" : "post")
            XCTAssertNil(env.disk.rawGet(SK("txn")), "k=\(k): txn cleared by repair")
            let ids = allRecordIds(reloaded.store.state)
            XCTAssertEqual(Set(ids).count, ids.count, "k=\(k): duplicate record ids")
            XCTAssertTrue(ok(reloaded.store.commit("judge-2", judgeMutation(cTian))))
            let ids2 = allRecordIds(reloaded.store.state)
            XCTAssertEqual(Set(ids2).count, ids2.count, "k=\(k): new id collides")
            let da = reloaded.store.state["records"]!["2026-10"]!.arrayValue!.filter { $0["char"] == .string(cDa) }.count
            XCTAssertEqual(da, isPost ? 1 : 0, "k=\(k): no double record")
        }
        XCTAssertEqual(outcomes.first, "pre")
        XCTAssertEqual(outcomes[N - 1], "post", "interrupt after the final txn removal = committed")
        XCTAssertTrue(outcomes.prefix(N - 1).allSatisfy { $0 == "pre" }, "any interruption before txn removal rolls back")
    }

    // test/store/store.test.mjs: interruption during repair (double crash) still converges to pre-state
    static func doubleCrash(_ B: TestBackend) throws {
        let env = seeded(B)
        let pre = plainState(env.store)
        env.storage.interruptAfterWrite(4) // localStorage：txn + 3 数据键；原生：落在一个事务之内 = 没提交
        _ = env.store.commit("judge", judgeMutation(cDa))
        let second = StoreStorage(env.disk.open(), now: { STORE_NOW })
        second.interruptAfterWrite(1) // 回滚写了一个键就又「崩溃」
        if B.native {
            XCTAssertEqual(try second.repair()["txn"], .string("none"))
        } else {
            XCTAssertThrowsError(try second.repair()) { XCTAssertEqual(($0 as? StoreJSError)?.kind, "interrupted") }
        }
        let third = freshStore(B, disk: env.disk)
        XCTAssertEqual(plainState(third.store), pre)
    }

    // test/store/store.test.mjs: mock-level interruption (backend dies mid-write) is repaired the same way
    static func mockLevelInterruption(_ B: TestBackend) {
        let env = seeded(B)
        let pre = plainState(env.store)
        env.disk.interruptAfterWrites(3)
        let r = env.store.commit("judge", judgeMutation(cDa))
        XCTAssertFalse(ok(r))
        env.disk.resume()
        let reloaded = freshStore(B, disk: env.disk)
        XCTAssertEqual(reloaded.store.lastRepair?["txn"], .string(B.native ? "none" : "rolled-back"))
        if B.native { XCTAssertEqual(errKind(r), "blocked", "native: outcome unknown → blocked until restart") }
        XCTAssertEqual(plainState(reloaded.store), pre)
    }

    // test/store/store.test.mjs: rollback failure → keys quarantined, store blocked (R-B09), commits refused
    // test/store/store.test.mjs: outcome unknown (native timeout after commit) → store blocked (R-B09), commits refused; restart trusts the database
    static func rollbackFailureOrOutcomeUnknown(_ B: TestBackend) {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        if !B.native {
            var schedSets = 0
            backend.failWhen { w in
                if w.op == "set" && w.key == SK("sched") { schedSets += 1; return schedSets >= 2 ? .quota : nil }
                if w.op == "set" && w.key == SK("sessions") { return .quota }
                return nil
            }
            let r = store.commit("judge", judgeMutation(cDa))
            backend.failWhen(nil)
            XCTAssertFalse(ok(r))
            XCTAssertEqual(errKind(r), "blocked")
            XCTAssertNotNil(store.blocked)
            XCTAssertNotNil(backend.rawGet("shizi.corrupt." + SK("sched")))
            let again = store.commit("settings", settingsMutation([("sound", .bool(false))]))
            XCTAssertEqual(errKind(again), "blocked")
            return
        }
        (backend as! FakeNativeDisk).failOp("apply", "E_TIMEOUT", after: true) // 原生已提交，但回复超时
        let r = store.commit("judge", judgeMutation(cDa))
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "blocked")
        XCTAssertEqual(store.blocked?["reason"], .string("uncertain"))
        XCTAssertNil(store.state["records"]!["2026-10"], "not published: the page does not know the outcome")
        let again = store.commit("settings", settingsMutation([("sound", .bool(false))]))
        XCTAssertEqual(errKind(again), "blocked")
        let reloaded = freshStore(B, disk: backend)
        XCTAssertNil(reloaded.store.blocked, "restart: not blocked any more")
        XCTAssertEqual(reloaded.store.state["records"]!["2026-10"]!.arrayValue!.count, 1, "the database is the truth")
    }

    // test/store/store.test.mjs: bad stored values: quarantined at boot, original removed, notice flag set once (not on next boot)
    static func badStoredValues(_ B: TestBackend) {
        let backend = B.make()
        backend.rawSet(SK("settings"), #"{"appearance":"neon"}"#)
        backend.rawSet(SK("sched"), "not json")
        let first = freshStore(B, disk: backend)
        XCTAssertEqual(UTF16Order.sorted((first.store.corruptNotice?["keys"]?.arrayValue ?? []).map { $0.stringValue! }), UTF16Order.sorted([SK("sched"), SK("settings")]))
        XCTAssertEqual(first.store.state["settings"], .null)
        XCTAssertNil(backend.rawGet(SK("settings")))
        XCTAssertEqual(backend.rawGet("shizi.corrupt." + SK("settings")), #"{"appearance":"neon"}"#)
        first.store.ackCorruptNotice()
        XCTAssertNil(first.store.corruptNotice)
        first.store.reload() // 同一次运行里再加载也不会重新置位
        XCTAssertNil(first.store.corruptNotice)
        let second = freshStore(B, disk: backend)
        XCTAssertNil(second.store.corruptNotice, "next boot: no second notice")
        XCTAssertEqual(backend.rawGet("shizi.corrupt." + SK("sched")), "not json", "quarantined copy kept for export")
    }

    // test/store/store.test.mjs: storage unavailable (SecurityError) → status.available=false, commits refused with kind unavailable
    static func storageUnavailable(_ B: TestBackend) {
        let backend = B.make()
        backend.failReads("security")
        let storage = StoreStorage(backend.open(), now: { STORE_NOW })
        let store = Store(storage: storage, now: { STORE_NOW }, dates: shanghai)
        let report = store.load()
        XCTAssertEqual(report["available"], .bool(false))
        XCTAssertEqual(report["kind"], .string(B.native ? "unknown" : "security"))
        let r = store.commit("x") { draft, _ in draft["settings"] = J(#"{"sound":true}"#) }
        XCTAssertEqual(errKind(r), "unavailable")
    }

    // test/store/store.test.mjs: quota hit → budget recovery (ink by §9 priority) → one retry succeeds; latest-per-char ink kept
    static func quotaHitRecoveryRetry(_ B: TestBackend) {
        let state = inkHeavyState(24)
        let probeEnv = freshStore(B)
        XCTAssertTrue(ok(probeEnv.store.seed(.object(state))))
        // 先在不限额的副本上量出这次提交的峰值占用，再把配额设在峰值之下 1 字节
        let dry = probeEnv.disk.cloneDisk()
        var peak = 0.0
        dry.failWhen { w in
            if w.op == "set" {
                let cur = dry.rawGet(w.key)
                peak = max(peak, dry.usedBytes() - (cur.map { Budget.entryBytes(w.key, $0) } ?? 0) + Budget.entryBytes(w.key, w.value))
            }
            return nil
        }
        let dryEnv = freshStore(B, disk: dry)
        XCTAssertTrue(ok(dryEnv.store.commit("judge", judgeMutation(cDa))))
        let quota = peak - 1
        let backend = probeEnv.disk.cloneDisk()
        backend.quotaBytes = quota
        let store = freshStore(B, disk: backend).store
        XCTAssertTrue(allRecordIds(store.state).contains("r34"), "fixture has r34 as the latest water")
        var quotaErrors = 0
        backend.failWhen { w in
            guard w.op == "set" else { return nil }
            let cur = backend.rawGet(w.key)
            let next = backend.usedBytes() - (cur.map { Budget.entryBytes(w.key, $0) } ?? 0) + Budget.entryBytes(w.key, w.value)
            if next > quota { quotaErrors += 1 }
            return nil // 真正的配额判断由磁盘自己做；这里只计数
        }
        let r = store.commit("judge", judgeMutation(cDa))
        XCTAssertTrue(ok(r), str(r))
        XCTAssertGreaterThanOrEqual(quotaErrors, 1, "first attempt really hit the quota")
        XCTAssertTrue((r["recovered"]?.arrayValue ?? []).contains { $0["type"] == .string("evictInk") }, "recovery evicted ink")
        let ink = flatInk(store.state["ink"])
        XCTAssertNotNil(ink["r34"], "latest judged ink of water is never evicted")
        let newId = store.state["records"]!["2026-10"]!.arrayValue![0]["id"]!.stringValue!
        XCTAssertEqual(newId, "r35")
        XCTAssertNotNil(ink[newId], "the ink written by this commit is kept")
        XCTAssertLessThan(ink.count, 26, "older ink was evicted")
        XCTAssertNotNil(ink["r2"], "latest ink of ren kept")
        XCTAssertLessThanOrEqual(backend.usedBytes(), quota)
        backend.failWhen(nil)
        let reloaded = freshStore(B, disk: backend.cloneDisk())
        XCTAssertEqual(plainState(reloaded.store), plainState(store), "disk == memory after side recovery")
    }

    // test/store/store.test.mjs: quota side recovery: evicted old ink months are persisted even if the retried commit still fails
    static func quotaSideRecoveryPersisted(_ B: TestBackend) {
        let backend = B.make()
        let store = freshStore(B, disk: backend).store
        XCTAssertTrue(ok(store.seed(.object(inkHeavyState(24)))))
        let before = flatInk(store.state["ink"])
        backend.quotaBytes = backend.usedBytes() + 2000
        var seen: JSObject? = nil
        store.subscribe { _, info in if info["type"] == .string("recover") { seen = info } }
        let r = store.commit("huge", settingsMutation([("library", .string(String(repeating: "x", count: 200_000)))]))
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "quota")
        let after = flatInk(store.state["ink"])
        XCTAssertLessThan(after.count, before.count, "some old ink evicted")
        XCTAssertTrue(seen != nil && (seen!["keys"]?.arrayValue ?? []).allSatisfy { $0.stringValue!.hasPrefix("shizi.v2.ink.") || $0.stringValue!.hasPrefix("shizi.v2.records.") }, "recover notice lists month keys")
        XCTAssertTrue(after["r34"] != nil && after["r2"] != nil, "latest-per-char kept")
        XCTAssertEqual(store.state["settings"]!["library"], .string("common"), "the failed commit itself is not published")
        let reloaded = freshStore(B, disk: backend.cloneDisk())
        XCTAssertEqual(plainState(reloaded.store), plainState(store), "disk == memory")
    }

    // test/store/store.test.mjs: commit {reclaim:false} (I2): quota hit → {ok:false, kind:quota}, no side recovery, every key unchanged, nothing published
    static func reclaimFalseQuotaHit(_ B: TestBackend) {
        let backend = B.make()
        let store = freshStore(B, disk: backend).store
        XCTAssertTrue(ok(store.seed(.object(inkHeavyState(24)))))
        let keysBefore = diskMap(backend)
        let before = str(.object(store.state))
        backend.quotaBytes = backend.usedBytes() + 2000
        var seen: [JSObject] = []
        store.subscribe { _, info in seen.append(info) }
        var writes = 0
        backend.failWhen { w in
            if w.op == "set" && w.key != SK("txn") { writes += 1 }
            return nil
        }
        let r = store.commit("huge", reclaim: false, settingsMutation([("library", .string(String(repeating: "x", count: 200_000)))]))
        backend.failWhen(nil)
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "quota")
        XCTAssertEqual(r["error"]?["recoveredAttempted"], .bool(false), "no recovery attempted")
        XCTAssertTrue(seen.isEmpty, "no recover / commit notification")
        XCTAssertEqual(str(.object(store.state)), before, "nothing published")
        XCTAssertEqual(diskMap(backend), keysBefore, "every key byte-equal")
        XCTAssertGreaterThanOrEqual(writes, 1, "the write was really attempted")
    }

    // test/store/store.test.mjs: commit {reclaim:false} (I2): pre-write over-budget estimate does not recover; the commit writes as-is
    static func reclaimFalsePreWrite(_ B: TestBackend) {
        let store = freshStore(B, budgets: JSObject([("inkBudgetBytes", .number(20000))])).store
        XCTAssertTrue(ok(store.seed(.object(inkHeavyState(24)))))
        let inkBefore = str(store.state["ink"]!)
        let r = store.commit("safety-like", reclaim: false, settingsMutation([("sound", .bool(false))]))
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["recovered"], .array([]))
        XCTAssertEqual(str(store.state["ink"]!), inkBefore, "ink untouched although over budget")
        let d = store.commit("judge", judgeMutation(cDa))
        XCTAssertTrue(ok(d) && !(d["recovered"]?.arrayValue ?? []).isEmpty, "the default commit still recovers")
    }

    // test/store/store.test.mjs: commit {replace:true} tags the notification as a whole-state replacement
    static func replaceTag(_ B: TestBackend) {
        let store = seeded(B).store
        var seen: [Bool] = []
        store.subscribe { _, info in seen.append(Store.isReplacement(.object(info))) }
        XCTAssertTrue(ok(store.commit("x", reclaim: false, replace: true) { draft, _ in draft["settings"] = J(#"{"sound":false}"#) }))
        XCTAssertEqual(seen, [true])
    }

    // test/store/store.test.mjs: quota hit with nothing recoverable → {ok:false, kind:quota}, nothing published
    static func quotaNothingRecoverable(_ B: TestBackend) {
        let backend = B.make()
        let store = freshStore(B, disk: backend).store
        XCTAssertTrue(ok(store.seed(.object(storeBaseline()))))
        backend.quotaBytes = backend.usedBytes() + 50
        let before = str(.object(store.state))
        let r = store.commit("big", settingsMutation([("library", .string(String(repeating: "x", count: 4000)))]))
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "quota")
        XCTAssertEqual(str(.object(store.state)), before)
    }

    // test/store/store.test.mjs: pre-write estimate over budget → recover first (ink budget), then write
    static func preWriteOverBudget(_ B: TestBackend) {
        let store = freshStore(B, budgets: JSObject([("inkBudgetBytes", .number(20000))])).store
        XCTAssertTrue(ok(store.seed(.object(inkHeavyState(24)))), "seed does not recover")
        let r = store.commit("judge", judgeMutation(cDa))
        XCTAssertTrue(ok(r))
        XCTAssertFalse((r["recovered"]?.arrayValue ?? []).isEmpty)
        let inkState = store.state["ink"]!.objectValue!
        let inkTotal = inkState.entries.reduce(0.0) { $0 + Double(UTF16Order.length(Schema.inkKey($1.key)) + UTF16Order.length(str($1.value))) * 2 }
        XCTAssertTrue(inkTotal <= 20000 || flatInk(.object(inkState)).count <= 3, "ink within budget or only protected entries left")
        XCTAssertNotNil(flatInk(.object(inkState))["r34"], "latest water kept")
    }

    // test/store/store.test.mjs: pre-write: months older than 400 days are folded (P28); current month never folded
    static func agedMonthsFolded(_ B: TestBackend) {
        var s = storeBaseline()
        var recs = s["records"]!.objectValue!
        recs["2025-01"] = .array([srec(1, cShan, day: "2025-01-05", session: 1)])
        s["records"] = .object(recs)
        var meta = s["meta"]!.objectValue!
        meta["months"] = J(#"["2025-01","2026-09"]"#)
        s["meta"] = .object(meta)
        let store = freshStore(B).store
        XCTAssertTrue(ok(store.seed(.object(s))))
        XCTAssertTrue(ok(store.commit("judge", judgeMutation(cDa))))
        let folded = store.state["records"]!["2025-01"]!
        XCTAssertEqual(folded["folded"], .bool(true))
        XCTAssertEqual(folded["chars"], .array([.string(cShan)]))
        XCTAssertEqual(folded["kept"]!.arrayValue!.count, 1, "its latest judged record is kept")
        XCTAssertNotNil(store.state["records"]!["2026-10"]!.arrayValue)
    }

    // test/store/store.test.mjs: usage estimate is refreshed and exposed on status
    static func usageOnStatus(_ B: TestBackend) {
        let env = seeded(B)
        let usage = env.store.usage!
        XCTAssertEqual(usage["total"], .number(env.disk.usedBytes()))
        XCTAssertEqual(usage["level"], .string("ok"))
    }

    // test/store/store.test.mjs: seed replaces every v2 domain (missing domains deleted) and validates shapes first
    static func seedReplaces(_ B: TestBackend) {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        var bad = storeBaseline()
        bad["sched"] = J(#"{"base:人":{"fsrs":null}}"#)
        let snapshot = diskObject(backend)
        let r = store.seed(.object(bad))
        XCTAssertFalse(ok(r))
        XCTAssertEqual(errKind(r), "shape")
        XCTAssertEqual(diskObject(backend), snapshot, "nothing written")
        XCTAssertTrue(ok(store.seed(J(#"{"meta":{"schema":2,"serial":0,"createdAt":1789434000000,"months":[]}}"#))))
        XCTAssertNil(backend.rawGet(SK("sched")))
        XCTAssertNil(backend.rawGet(Schema.recordsKey("2026-09")))
        XCTAssertEqual(store.state["sessions"], .null)
        XCTAssertFalse(ok(store.seed(J(#"{"nope":1}"#))))
    }

    // test/store/store.test.mjs: backup v2: any bad key → whole file rejected and writeAll never called
    static func backupAnyBadKey(_ B: TestBackend) {
        let env = seeded(B)
        let (store, backend) = (env.store, env.disk)
        let good = backupFrom(storeBaseline())
        var writes = 0
        backend.failWhen { _ in writes += 1; return nil }
        let snapshot = diskObject(backend)
        for key in good["data"]!.objectValue!.keys {
            var broken = good.objectValue!
            var data = broken["data"]!.objectValue!
            data[key] = .string(key == SK("meta") ? #"{"schema":1}"# : #"{"x":[1,2,{"bad":true}]}"#)
            broken["data"] = .object(data)
            let r = store.replaceWithBackup(.object(broken))
            XCTAssertFalse(ok(r), key)
            XCTAssertEqual(errKind(r), "invalid")
            XCTAssertEqual(r["error"]?["key"], .string(key))
        }
        backend.failWhen(nil)
        XCTAssertEqual(writes, 0, "writeAll must not be called for a rejected backup")
        XCTAssertEqual(diskObject(backend), snapshot)
    }

    // test/store/store.test.mjs: backup v2: good file replaces whitelisted keys, leaves sessions alone, clears shizi.corrupt.*
    static func backupGoodFile(_ B: TestBackend) throws {
        let env = seeded(B)
        let (store, storage, backend) = (env.store, env.storage, env.disk)
        try storage.writeOne("shizi.corrupt.shizi.v2.sched", "junk")
        var other = storeBaseline()
        other["records"] = .object(JSObject([("2026-08", .array([srec(7, cHuo, day: "2026-08-02")]))]))
        var meta = other["meta"]!.objectValue!
        meta["serial"] = .number(7)
        meta["months"] = J(#"["2026-08"]"#)
        other["meta"] = .object(meta)
        other["ink"] = .object(JSObject([("2026-08", .object(JSObject([("r7", inkEntry())])))]))
        let sessionsBefore = backend.rawGet(SK("sessions"))
        let r = store.replaceWithBackup(backupFrom(other))
        XCTAssertTrue(ok(r), str(r))
        XCTAssertNil(backend.rawGet(Schema.recordsKey("2026-09")), "month absent from backup removed")
        XCTAssertNil(backend.rawGet(Schema.inkRecordKey("2026-09", "r2")), "ink absent from backup removed")
        XCTAssertNotNil(backend.rawGet(Schema.inkRecordKey("2026-08", "r7")), "ink from the backup month table written one key per record")
        XCTAssertNil(backend.rawGet(Schema.inkKey("2026-08")), "never as a month key")
        XCTAssertEqual(store.getInk(store.state["records"]!["2026-08"]!.arrayValue![0]), inkEntry())
        XCTAssertNotNil(backend.rawGet(Schema.recordsKey("2026-08")))
        XCTAssertEqual(backend.rawGet(SK("sessions")), sessionsBefore)
        XCTAssertNil(backend.rawGet("shizi.corrupt.shizi.v2.sched"))
        XCTAssertGreaterThanOrEqual(store.serial, 7)
    }

    // test/store/store.test.mjs: deriveSerial takes the max over meta.serial, records (incl. folded kept), sessions and ink ids
    static func deriveSerialMax(_ B: TestBackend) {
        var s = storeBaseline()
        var meta = s["meta"]!.objectValue!
        meta["serial"] = .number(1)
        s["meta"] = .object(meta)
        var recs = s["records"]!.objectValue!
        recs["2025-01"] = .object(JSObject([("folded", .bool(true)), ("month", .string("2025-01")), ("byDay", .object(JSObject())), ("chars", .array([])),
                                            ("kept", .array([srec(40, cShan, day: "2025-01-02")]))]))
        s["records"] = .object(recs)
        XCTAssertEqual(Store.deriveSerial(s), 40)
        var ink = s["ink"]!.objectValue!
        var t = ink["2026-09"]!.objectValue!
        t["r77"] = inkEntry()
        ink["2026-09"] = .object(t)
        s["ink"] = .object(ink)
        XCTAssertEqual(Store.deriveSerial(s), 77)
        var sessions = s["sessions"]!.objectValue!
        var B2 = sessions["A"]!.objectValue!
        B2["id"] = .string("s90")
        B2["slot"] = .string("B")
        B2["kind"] = .string("picked")
        sessions["lastEnded"] = .object(JSObject([("B", .object(B2))]))
        s["sessions"] = .object(sessions)
        XCTAssertEqual(Store.deriveSerial(s), 90)
    }

    // test/store/store.test.mjs: replacement notifications (G1): load / seed are tagged as whole-state replacements, commit is not
    static func replacementNotifications(_ B: TestBackend) {
        let store = freshStore(B).store
        var seen: [JSObject] = []
        store.subscribe { _, info in seen.append(info) }
        XCTAssertTrue(ok(store.seed(.object(storeBaseline()))))
        XCTAssertTrue(ok(store.commit("judge", judgeMutation(cDa))))
        store.reload()
        let got = seen.map { [$0["type"]!.stringValue!, $0["label"]?.stringValue ?? "null", Store.isReplacement(.object($0)) ? "true" : "false"] }
        XCTAssertEqual(got, [["commit", "test-seed", "true"], ["commit", "judge", "false"], ["load", "null", "true"]])
        XCTAssertFalse(Store.isReplacement(.null))
        XCTAssertFalse(Store.isReplacement(J(#"{"type":"recover","label":"x"}"#)))
    }
}

final class StoreContractLocalTests: XCTestCase {
    let B = TestBackend.local
    func testLocalStorageCommitSuccessPublishesNewStateNotifiesSubscribersAllocatesIdsFromDerivedSerial() { StoreContract.commitSuccess(B) }
    func testLocalStorageInkV3P78LegacyV2InkOnDiskStillLoadsAndDecodesV2AndV3SideBySide() throws { try StoreContract.inkV3LegacyV2Loads(B) }
    func testLocalStorageInkHelpersGetSetDeleteInkAddressRecordMonthOneKeyPerRecord() throws { try StoreContract.inkHelpers(B) }
    func testLocalStorageWriteFailureDoesNotPublishRetrySucceedsWithoutDoubleCount() { StoreContract.writeFailureDoesNotPublish(B) }
    func testLocalStorageVerifyMismatchRollbackNotPublished() { StoreContract.verifyMismatch(B) }
    func testLocalStorageMutatorErrorsAndShapeErrorsNeverReachStorage() { StoreContract.mutatorAndShapeErrors(B) }
    func testLocalStorageInterruptAfterWriteMatrixStateIsExactlyPreOrPost() { StoreContract.interruptMatrix(B) }
    func testLocalStorageInterruptionDuringRepairDoubleCrashConvergesToPreState() throws { try StoreContract.doubleCrash(B) }
    func testLocalStorageMockLevelInterruptionIsRepairedTheSameWay() { StoreContract.mockLevelInterruption(B) }
    func testLocalStorageRollbackFailureKeysQuarantinedStoreBlockedCommitsRefused() { StoreContract.rollbackFailureOrOutcomeUnknown(B) }
    func testLocalStorageBadStoredValuesQuarantinedAtBootNoticeFlagSetOnce() { StoreContract.badStoredValues(B) }
    func testLocalStorageStorageUnavailableCommitsRefusedWithKindUnavailable() { StoreContract.storageUnavailable(B) }
    func testLocalStorageQuotaHitBudgetRecoveryOneRetrySucceedsLatestPerCharInkKept() { StoreContract.quotaHitRecoveryRetry(B) }
    func testLocalStorageQuotaSideRecoveryEvictedOldInkPersistedEvenIfRetryFails() { StoreContract.quotaSideRecoveryPersisted(B) }
    func testLocalStorageCommitReclaimFalseQuotaHitNoSideRecoveryEveryKeyUnchanged() { StoreContract.reclaimFalseQuotaHit(B) }
    func testLocalStorageCommitReclaimFalsePreWriteOverBudgetDoesNotRecover() { StoreContract.reclaimFalsePreWrite(B) }
    func testLocalStorageCommitReplaceTrueTagsTheNotificationAsReplacement() { StoreContract.replaceTag(B) }
    func testLocalStorageQuotaHitWithNothingRecoverableNothingPublished() { StoreContract.quotaNothingRecoverable(B) }
    func testLocalStoragePreWriteEstimateOverBudgetRecoverFirstThenWrite() { StoreContract.preWriteOverBudget(B) }
    func testLocalStoragePreWriteMonthsOlderThan400DaysAreFoldedCurrentMonthNeverFolded() { StoreContract.agedMonthsFolded(B) }
    func testLocalStorageUsageEstimateIsRefreshedAndExposedOnStatus() { StoreContract.usageOnStatus(B) }
    func testLocalStorageSeedReplacesEveryV2DomainAndValidatesShapesFirst() { StoreContract.seedReplaces(B) }
    func testLocalStorageBackupV2AnyBadKeyWholeFileRejectedAndWriteAllNeverCalled() { StoreContract.backupAnyBadKey(B) }
    func testLocalStorageBackupV2GoodFileReplacesWhitelistedKeysLeavesSessionsAloneClearsCorrupt() throws { try StoreContract.backupGoodFile(B) }
    func testLocalStorageDeriveSerialTakesTheMaxOverMetaRecordsSessionsAndInkIds() { StoreContract.deriveSerialMax(B) }
    func testLocalStorageReplacementNotificationsLoadSeedAreReplacementsCommitIsNot() { StoreContract.replacementNotifications(B) }
}

final class StoreContractNativeTests: XCTestCase {
    let B = TestBackend.native
    func testNativeCommitSuccessPublishesNewStateNotifiesSubscribersAllocatesIdsFromDerivedSerial() { StoreContract.commitSuccess(B) }
    func testNativeInkV3P78LegacyV2InkOnDiskStillLoadsAndDecodesV2AndV3SideBySide() throws { try StoreContract.inkV3LegacyV2Loads(B) }
    func testNativeInkHelpersGetSetDeleteInkAddressRecordMonthOneKeyPerRecord() throws { try StoreContract.inkHelpers(B) }
    func testNativeWriteFailureDoesNotPublishRetrySucceedsWithoutDoubleCount() { StoreContract.writeFailureDoesNotPublish(B) }
    func testNativeVerifyMismatchRollbackNotPublished() { StoreContract.verifyMismatch(B) }
    func testNativeMutatorErrorsAndShapeErrorsNeverReachStorage() { StoreContract.mutatorAndShapeErrors(B) }
    func testNativeInterruptAfterWriteMatrixStateIsExactlyPreOrPost() { StoreContract.interruptMatrix(B) }
    func testNativeInterruptionDuringRepairDoubleCrashConvergesToPreState() throws { try StoreContract.doubleCrash(B) }
    func testNativeMockLevelInterruptionIsRepairedTheSameWay() { StoreContract.mockLevelInterruption(B) }
    func testNativeOutcomeUnknownStoreBlockedCommitsRefusedRestartTrustsTheDatabase() { StoreContract.rollbackFailureOrOutcomeUnknown(B) }
    func testNativeBadStoredValuesQuarantinedAtBootNoticeFlagSetOnce() { StoreContract.badStoredValues(B) }
    func testNativeStorageUnavailableCommitsRefusedWithKindUnavailable() { StoreContract.storageUnavailable(B) }
    func testNativeQuotaHitBudgetRecoveryOneRetrySucceedsLatestPerCharInkKept() { StoreContract.quotaHitRecoveryRetry(B) }
    func testNativeQuotaSideRecoveryEvictedOldInkPersistedEvenIfRetryFails() { StoreContract.quotaSideRecoveryPersisted(B) }
    func testNativeCommitReclaimFalseQuotaHitNoSideRecoveryEveryKeyUnchanged() { StoreContract.reclaimFalseQuotaHit(B) }
    func testNativeCommitReclaimFalsePreWriteOverBudgetDoesNotRecover() { StoreContract.reclaimFalsePreWrite(B) }
    func testNativeCommitReplaceTrueTagsTheNotificationAsReplacement() { StoreContract.replaceTag(B) }
    func testNativeQuotaHitWithNothingRecoverableNothingPublished() { StoreContract.quotaNothingRecoverable(B) }
    func testNativePreWriteEstimateOverBudgetRecoverFirstThenWrite() { StoreContract.preWriteOverBudget(B) }
    func testNativePreWriteMonthsOlderThan400DaysAreFoldedCurrentMonthNeverFolded() { StoreContract.agedMonthsFolded(B) }
    func testNativeUsageEstimateIsRefreshedAndExposedOnStatus() { StoreContract.usageOnStatus(B) }
    func testNativeSeedReplacesEveryV2DomainAndValidatesShapesFirst() { StoreContract.seedReplaces(B) }
    func testNativeBackupV2AnyBadKeyWholeFileRejectedAndWriteAllNeverCalled() { StoreContract.backupAnyBadKey(B) }
    func testNativeBackupV2GoodFileReplacesWhitelistedKeysLeavesSessionsAloneClearsCorrupt() throws { try StoreContract.backupGoodFile(B) }
    func testNativeDeriveSerialTakesTheMaxOverMetaRecordsSessionsAndInkIds() { StoreContract.deriveSerialMax(B) }
    func testNativeReplacementNotificationsLoadSeedAreReplacementsCommitIsNot() { StoreContract.replacementNotifications(B) }
}
