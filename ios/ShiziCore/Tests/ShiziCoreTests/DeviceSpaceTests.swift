import Foundation
import XCTest
@testable import ShiziCore

// 原生的存储压力看设备真实剩余空间（P57，DeviceSpaceRule / Budget.deviceUsage / Store.deviceAvailableBytes）：
//   · 阈值来自 policy.nativeStorage（< 500MiB warn、< 100MiB full），边界与「量不到 = 没有压力」；
//   · 真写盘撞满（原生替身 E_FULL = SQLITE_FULL）→ full，之后提交写成功就收回；
//   · 没挂读数的 Store（网页 / JS 金样 / 夹具）照旧按估算总量 / quotaBytes，逐字段不变；QA 的 usageOverride 照原样报。

private let mib = 1024.0 * 1024.0
private let roomy = 10_000.0 * mib

/// 原生替身上的 Store；deviceAvailableBytes 在 load 之前挂上（与 App 的 SwiftEngine 同序）。
private func deviceStore(_ disk: FakeNativeDisk, budgets: JSObject? = Budgets.native.js, available: (() -> Double?)?) -> Store {
    let storage = StoreStorage(disk.open(), now: { STORE_NOW })
    let store = Store(storage: storage, now: { STORE_NOW }, budgets: budgets, dates: shanghai)
    store.deviceAvailableBytes = available
    store.load()
    return store
}

/// quotaBytes 很小的原生预算：旧口径一定报 full，用来证明原生口径不再看它。
private func tinyQuotaBudgets() -> JSObject {
    var b = Budgets.native
    b.quotaBytes = 1000
    return b.js
}

final class DeviceSpaceTests: XCTestCase {
    func testPolicyThresholds() {
        XCTAssertEqual(Config.policyNumber("nativeStorage.freeSpaceWarnBytes"), 500 * mib)
        XCTAssertEqual(Config.policyNumber("nativeStorage.freeSpaceFullBytes"), 100 * mib)
        XCTAssertEqual(DeviceSpaceRule.policy, DeviceSpaceRule(warnBelowBytes: 500 * mib, fullBelowBytes: 100 * mib))
        XCTAssertLessThan(DeviceSpaceRule.policy.fullBelowBytes, DeviceSpaceRule.policy.warnBelowBytes)
    }

    func testLevelBoundaries() {
        let rule = DeviceSpaceRule.policy
        XCTAssertEqual(rule.level(availableBytes: roomy, writeFull: false), "ok")
        XCTAssertEqual(rule.level(availableBytes: 500 * mib, writeFull: false), "ok", "exactly the warn line is not yet a warning")
        XCTAssertEqual(rule.level(availableBytes: 500 * mib - 1, writeFull: false), "warn")
        XCTAssertEqual(rule.level(availableBytes: 100 * mib, writeFull: false), "warn", "exactly the full line is still warn")
        XCTAssertEqual(rule.level(availableBytes: 100 * mib - 1, writeFull: false), "full")
        XCTAssertEqual(rule.level(availableBytes: 1, writeFull: false), "full")
        // 量不到 = 没有压力
        XCTAssertEqual(rule.level(availableBytes: nil, writeFull: false), "ok")
        XCTAssertEqual(rule.level(availableBytes: 0, writeFull: false), "ok", "0 is an unreadable volume, not a full one (a real full write reports writeFull)")
        XCTAssertEqual(rule.level(availableBytes: -5, writeFull: false), "ok")
        XCTAssertEqual(rule.level(availableBytes: .nan, writeFull: false), "ok")
        XCTAssertEqual(rule.level(availableBytes: .infinity, writeFull: false), "ok")
        // 真写盘撞满：不管读数
        XCTAssertEqual(rule.level(availableBytes: roomy, writeFull: true), "full")
        XCTAssertEqual(rule.level(availableBytes: nil, writeFull: true), "full")
        // 阈值可注入
        let custom = DeviceSpaceRule(warnBelowBytes: 10, fullBelowBytes: 5)
        XCTAssertEqual(custom.level(availableBytes: 9, writeFull: false), "warn")
        XCTAssertEqual(custom.level(availableBytes: 4, writeFull: false), "full")
        XCTAssertEqual(custom.level(availableBytes: 10, writeFull: false), "ok")
    }

    func testDeviceUsageShape() {
        let estimate = JSObject([("total", .number(300)), ("byBucket", .object(JSObject([("records", .number(300))]))), ("ratio", .number(0.3)), ("level", .string("warn"))])
        let u = Budget.deviceUsage(estimate, availableBytes: 700, writeFull: false, rule: DeviceSpaceRule(warnBelowBytes: 500, fullBelowBytes: 100))
        XCTAssertEqual(u.keys, ["total", "byBucket", "ratio", "level", "availableBytes", "source"])
        XCTAssertEqual(u["total"], .number(300))
        XCTAssertEqual(u["byBucket"], estimate["byBucket"])
        XCTAssertEqual(u["ratio"], .number(0.3), "total / (total + available)")
        XCTAssertEqual(u["level"], .string("ok"), "the estimate's quota level is replaced")
        XCTAssertEqual(u["availableBytes"], .number(700))
        XCTAssertEqual(u["source"], .string("device"))
        let unknown = Budget.deviceUsage(estimate, availableBytes: nil, writeFull: false)
        XCTAssertEqual(unknown["availableBytes"], .null)
        XCTAssertEqual(unknown["ratio"], .number(0))
        XCTAssertEqual(unknown["level"], .string("ok"))
        let full = Budget.deviceUsage(estimate, availableBytes: nil, writeFull: true)
        XCTAssertEqual(full["ratio"], .number(1))
        XCTAssertEqual(full["level"], .string("full"))
        XCTAssertEqual(Budget.deviceUsage(JSObject(), availableBytes: 0, writeFull: false)["availableBytes"], .null, "0 reads as unknown")
    }

    // 旧口径的 64MiB 假上限不再报警：同一份数据、同一个 quotaBytes，没挂读数 full，挂了读数按剩余空间
    func testNativeStoreIgnoresTheQuotaAndFollowsFreeSpace() {
        let legacy = deviceStore(FakeNativeDisk(), budgets: tinyQuotaBudgets(), available: nil)
        XCTAssertTrue(ok(legacy.seed(.object(storeBaseline()))))
        XCTAssertEqual(legacy.usage?["level"], .string("full"), "without a reading the old quota rule still applies (web / golden path)")
        XCTAssertNil(legacy.usage?["source"])

        var free: Double? = roomy
        let store = deviceStore(FakeNativeDisk(), budgets: tinyQuotaBudgets(), available: { free })
        XCTAssertTrue(ok(store.seed(.object(storeBaseline()))))
        XCTAssertEqual(store.usage?["level"], .string("ok"), "far over quotaBytes, plenty of free space: no pressure")
        XCTAssertEqual(store.usage?["source"], .string("device"))
        XCTAssertEqual(store.usage?["total"], legacy.usage?["total"], "the estimate itself is unchanged")
        XCTAssertEqual(store.usage?["byBucket"], legacy.usage?["byBucket"])
        XCTAssertEqual(Budget.storagePressureOf(store.status["usage"]), .null)

        free = 300 * mib
        store.refreshUsage()
        XCTAssertEqual(store.usage?["level"], .string("warn"))
        XCTAssertEqual(Budget.storagePressureOf(store.status["usage"])["level"], .string("warn"))
        free = 50 * mib
        XCTAssertTrue(ok(store.commit("judge", judgeMutation(cDa))), "a commit republishes usage with a fresh reading")
        XCTAssertEqual(store.usage?["level"], .string("full"))
        XCTAssertEqual(Budget.storagePressureOf(store.status["usage"])["level"], .string("full"))
        free = nil
        store.refreshUsage()
        XCTAssertEqual(store.usage?["level"], .string("ok"), "an unreadable volume is no pressure")
        XCTAssertEqual(store.usage?["availableBytes"], .null)
    }

    // 真写盘撞满（原生替身的 E_FULL，App 里是 SQLITE_FULL）：剩余空间读数再大也报 full；之后一次提交写成功就收回
    func testARealFullWriteReportsFullUntilAWriteSucceeds() {
        let disk = FakeNativeDisk()
        let store = deviceStore(disk, available: { roomy })
        XCTAssertTrue(ok(store.seed(.object(storeBaseline()))))
        XCTAssertEqual(store.usage?["level"], .string("ok"))
        XCTAssertFalse(store.writeFull)

        disk.quotaBytes = disk.usedBytes()
        let failed = store.commit("judge", judgeMutation(cDa))
        XCTAssertFalse(ok(failed))
        XCTAssertEqual(errKind(failed), "quota")
        XCTAssertTrue(store.writeFull)
        XCTAssertEqual(store.usage?["level"], .string("full"))
        XCTAssertEqual(Budget.storagePressureOf(store.status["usage"])["level"], .string("full"))

        disk.quotaBytes = .infinity
        XCTAssertTrue(ok(store.commit("judge", judgeMutation(cDa))))
        XCTAssertFalse(store.writeFull)
        XCTAssertEqual(store.usage?["level"], .string("ok"))
    }

    // 旧口径（网页 / JS 金样）：撞满只影响那次提交的结果，usage 照估算算，没有 source / availableBytes
    func testWithoutAReadingAFullWriteLeavesTheEstimateAlone() {
        for B in TestBackend.allCases {
            let env = seeded(B)
            let before = env.store.usage
            env.disk.quotaBytes = env.disk.usedBytes()
            XCTAssertFalse(ok(env.store.commit("judge", judgeMutation(cDa))), B.name)
            XCTAssertEqual(env.store.usage?["level"], .string("ok"), B.name)
            XCTAssertNil(env.store.usage?["source"], B.name)
            XCTAssertEqual(env.store.usage.map { str(.object($0)) }, before.map { str(.object($0)) }, "\(B.name): usage is the plain estimate")
        }
    }

    // QA 夹具 setUsage（usageOverride）在原生口径下照原样报：界面取证还能造出 warn / full
    func testUsageOverrideWinsOverTheReading() {
        let store = deviceStore(FakeNativeDisk(), available: { roomy })
        let override = JSObject([("level", .string("warn")), ("ratio", .number(0.86)), ("total", .number(1)), ("byBucket", .object(JSObject()))])
        store.storage.usageOverride = override
        store.refreshUsage()
        XCTAssertEqual(store.usage, override)
        XCTAssertEqual(Budget.storagePressureOf(store.status["usage"]), .object(JSObject([("level", .string("warn")), ("ratio", .number(0.86))])))
        store.storage.usageOverride = nil
        store.refreshUsage()
        XCTAssertEqual(store.usage?["level"], .string("ok"))
    }

    // 网页 / 金样口径的计算不变（BudgetTests 的 80% / 100% 阈值之外再钉一次：同一份数据、缺省预算）
    func testWebPathIsUnchanged() {
        let b = Budgets.resolve(JSObject([("quotaBytes", .number(1000))]))
        func mk(_ total: Int) -> [(String, String)] { [("x", String(repeating: "y", count: total / 2 - 1))] }
        XCTAssertEqual(Budget.estimateUsage(mk(800), b).keys, ["total", "byBucket", "ratio", "level"])
        XCTAssertEqual(Budget.estimateUsage(mk(802), b)["level"], .string("warn"))
        XCTAssertEqual(Budget.estimateUsage(mk(1000), b)["level"], .string("full"))
        XCTAssertEqual(Budgets.defaults.quotaBytes, Config.policyNumber("assumedQuotaBytes"))
        XCTAssertEqual(Budgets.native.quotaBytes, Config.policyNumber("nativeStorage.quotaBytes"), "still read (estimate ratio, benchmarks); no longer drives native pressure")
        let env = seeded(.native)
        XCTAssertNil(env.store.deviceAvailableBytes, "default: no reading")
        XCTAssertEqual(env.store.usage?["level"], .string("ok"))
        XCTAssertEqual(env.store.usage?.keys, ["total", "byBucket", "ratio", "level"])
    }
}
