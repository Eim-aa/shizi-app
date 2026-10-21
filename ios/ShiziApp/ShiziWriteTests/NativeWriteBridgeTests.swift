import UIKit
import WebKit
import XCTest
@testable import Shizi

// B2.0 写字会话 API 的宿主测试（scheme ShiziWriteTests：App 作测试宿主，环境 SHIZI_NATIVE_WRITE=1、SHIZI_TEST_HOST=1）。
// 在真的 App 进程里：页面加载真 store（原生 SQLite 后端）→ 首页开组 → 原生写字页盖上 → 经 NativeWriteBridge（与原生写字页同一个类）
// 调写字会话 API → 用页面的公开测试钩子 __shiziTest 读回 store，核对记录 / FSRS / 笔迹 / 会话推进；注入写失败核对 D07。
// 与网页判断路径逐字段一致由 test/ui/native-write.test.mjs 证明（同一批提交函数）；这里证明桥、原生页面、真 store 与 SQLite 这一整条通。

@MainActor
final class NativeWriteBridgeTests: XCTestCase {
    private var web: WebViewController!
    private var bridge: NativeWriteBridge!

    override func setUp() async throws {
        try await super.setUp()
        let root = UIApplication.shared.delegate?.window??.rootViewController
        web = try XCTUnwrap(root as? WebViewController, "root is the web shell")
        try await waitUntil("page ready") { self.web.pageReady }
        try await waitUntil("test hooks") { (try? await self.js("return !!window.__shiziTest && typeof window.shiziNativeWrite === 'function';")) as? Bool == true }
        if let top = web.nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
        }
        _ = try await js("(await import('/src/ui/router.js')).nav.switchTab('home'); return window.__shiziTest.reset();")
        try await waitUntil("no native page") { self.web.nativeWriteTop == nil }
        bridge = NativeWriteBridge(webView: web.webView)
    }

    // MARK: 工具

    @discardableResult
    private func js(_ body: String) async throws -> Any? {
        try await web.webView.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
    }

    private func state() async throws -> [String: Any] {
        let value = try await js("return window.__shiziTest.getState();")
        return try XCTUnwrap(value as? [String: Any])
    }

    private func call(_ op: String, _ args: [String: Any]) async -> NativeWriteReply {
        await withCheckedContinuation { cont in bridge.call(op, args) { cont.resume(returning: $0) } }
    }

    private func waitUntil(_ what: String, timeout: TimeInterval = 15, _ cond: @escaping () async -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await cond() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    /// 首页主入口开一组（与点「开始写字」同一个函数），等原生写字页盖上。
    private func startGroup() async throws -> NativeWriteViewController {
        _ = try await js("const m = await import('/src/ui/screens/session/index.js'); return m.startA({}).ok;")
        try await waitUntil("native write page") { self.web.nativeWriteTop != nil && self.web.presentedViewController?.isBeingPresented == false }
        return try XCTUnwrap(web.nativeWriteTop)
    }

    private static let stroke: [[Double]] = (0..<10).map { (i: Int) -> [Double] in
        let d = Double(i)
        let x: Double = 60 + d * 22
        let y: Double = 170 + Double(i % 2)
        let t: Double = 1_000 + d * 16
        return [x, y, t]
    }

    private func records(_ st: [String: Any]) -> [[String: Any]] {
        ((st["records"] as? [String: Any]) ?? [:]).values.flatMap { ($0 as? [[String: Any]]) ?? [] }
    }

    private func sessionA(_ st: [String: Any]) -> [String: Any]? {
        (st["sessions"] as? [String: Any])?["A"] as? [String: Any]
    }

    // MARK: 测试

    func testOpenPresentsNativePageWithTheStoresCurrentCard() async throws {
        let vc = try await startGroup()
        let st = try await state()
        let s = try XCTUnwrap(sessionA(st))
        let queue = try XCTUnwrap(s["queue"] as? [String])
        XCTAssertEqual(vc.slot, "A")
        XCTAssertEqual(vc.cardKey, queue[s["cursor"] as? Int ?? 0])
        XCTAssertEqual(vc.snapshot["total"] as? Int, queue.count)
        XCTAssertEqual(vc.phase, .recall)
        // 网页路由：顶层是写字条目（原生宿主），下层首页保持可见
        let top = try await js("const r = (await import('/src/ui/router.js')).getRouter().getState(); return r.top.n;") as? String
        XCTAssertEqual(top, "write")
    }

    func testStrokesAndJudgeCommitThroughTheOneStore() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        let strokes = await call("strokes", ["slot": "A", "cardKey": key, "strokes": [Self.stroke], "phase": "recall"])
        let entered = await call("phase", ["slot": "A", "cardKey": key, "phase": "compare", "strokes": [Self.stroke]])
        XCTAssertTrue(strokes.ok)
        let saved = try await state()
        XCTAssertEqual((sessionA(saved)?["current"] as? [String: Any])?["strokes"].map { ($0 as? [Any])?.count ?? 0 }, 1, "strokes persisted (P52)")

        XCTAssertTrue(entered.ok)
        let judged = await call("judge", ["slot": "A", "cardKey": key, "judgment": "wrong", "strokes": [Self.stroke], "hints": 0])
        XCTAssertTrue(judged.ok, "judge ok")
        XCTAssertEqual(judged.snapshot?["cursor"] as? Int, 1, "reply carries the next card")
        XCTAssertLessThan(judged.wallMs, 1000)

        let st = try await state()
        let recs = records(st).filter { ($0["cardKey"] as? String) == key }
        XCTAssertEqual(recs.count, 1)
        let r = try XCTUnwrap(recs.first)
        XCTAssertEqual(r["kind"] as? String, "judged")
        XCTAssertEqual(r["judgment"] as? String, "wrong")
        XCTAssertEqual(r["id"] as? String, judged.body["recordId"] as? String)
        XCTAssertNotNil((st["sched"] as? [String: Any])?[key], "FSRS entry written in the same commit")
        let ink = try await js("const st = window.__shiziTest.getState(); const r = Object.values(st.records).flat().find(x => x.cardKey === \(Self.literal(key))); return !!window.__shiziTest.getInk(r);") as? Bool
        XCTAssertEqual(ink, true, "per-record ink written (perRecordInk)")
        // B2.3 ink schema 2：原生库里这条记录的墨迹是一行 shizi.v2.ink.<月>.<id>，值是 Ink v4 原始点；原生解出来就是写下的点
        let rid = try XCTUnwrap(r["id"] as? String)
        let month = String(try XCTUnwrap(r["localDay"] as? String).prefix(7))
        let rows = try await js("return window.__shiziTest.getRawKeys('shizi.v2.ink.');") as? [String: Any]
        let mine = (rows ?? [:]).keys.filter { $0.hasSuffix(".\(rid)") }
        XCTAssertEqual(mine, ["shizi.v2.ink.\(month).\(rid)"], "one row for this record's ink")
        let body = try XCTUnwrap(rows?["shizi.v2.ink.\(month).\(rid)"] as? String)
        let decoded = try XCTUnwrap(InkStoredInk.decode(json: body), "Ink v4 raw points on the native backend")
        XCTAssertEqual(decoded.first?.count, Self.stroke.count)
        for (q, e) in zip(decoded.first ?? [], Self.stroke) {
            XCTAssertEqual(q.x, e[0], accuracy: 0.05 + 1e-9)
            XCTAssertEqual(q.y, e[1], accuracy: 0.05 + 1e-9)
            XCTAssertEqual(q.t, e[2] - 1_000, accuracy: 0.5 + 1e-9)
        }
        let inkSchema = try await js("return window.__shiziTest.getStatus().inkSchema.schema;") as? Int
        XCTAssertEqual(inkSchema, 2)
        XCTAssertEqual(sessionA(st)?["cursor"] as? Int, 1)
        // 存储后端是原生 SQLite（B1）：同一份数据
        let backend = try await js("return window.__shiziTest.getStatus().backend.kind;") as? String
        XCTAssertEqual(backend, "native")
    }

    func testFailedJudgeDoesNotAdvanceAndRetryRecordsOnce() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        let entered = await call("phase", ["slot": "A", "cardKey": key, "phase": "compare", "strokes": [Self.stroke]])
        XCTAssertTrue(entered.ok)
        let initial = try await state()
        let before = records(initial).count
        _ = try await js("return window.__shiziTest.failNextWrite(1, {kind:'generic'});")
        let failed = await call("judge", ["slot": "A", "cardKey": key, "judgment": "correct", "strokes": [Self.stroke]])
        XCTAssertFalse(failed.ok, "D07: injected write failure is reported")
        let mid = try await state()
        XCTAssertEqual(records(mid).count, before, "nothing recorded")
        XCTAssertEqual(sessionA(mid)?["cursor"] as? Int, 0, "not advanced")

        let ok = await call("judge", ["slot": "A", "cardKey": key, "judgment": "correct", "strokes": [Self.stroke]])
        XCTAssertTrue(ok.ok)
        let again = await call("judge", ["slot": "A", "cardKey": key, "judgment": "correct", "strokes": [Self.stroke]])
        XCTAssertFalse(again.ok)
        XCTAssertEqual(again.errorKind, "stale")
        XCTAssertNotEqual(again.snapshot?["cardKey"] as? String, key, "stale reply lets the native page reconcile")
        let after = try await state()
        XCTAssertEqual(records(after).count, before + 1, "recorded exactly once")
    }

    func testNativePageWritesAGroupAndHandsOverToTheResultPage() async throws {
        let vc = try await startGroup()
        var guardCount = 0
        while web.nativeWriteTop != nil, guardCount < 30 {
            guardCount += 1
            let key = try XCTUnwrap(vc.cardKey)
            // 走原生页面自己的路径：一笔 →「写好了」→「写对了」
            vc.nativeInkDidEndStroke(try XCTUnwrap(vc.inkViewForTesting), raw: Self.stroke.map { InkRawPoint(x: $0[0], y: $0[1], t: $0[2]) })
            vc.perform(Selector(("tapDone")))
            XCTAssertEqual(vc.phase, .compare)
            vc.perform(Selector(("tapCorrect")))
            try await waitUntil("next card or result") { self.web.nativeWriteTop == nil || (vc.cardKey != key && vc.phase == .recall) }
        }
        try await waitUntil("result page") {
            (try? await self.js("return (await import('/src/ui/router.js')).getRouter().getState().top.n;")) as? String == "result"
        }
        let st = try await state()
        XCTAssertNil(sessionA(st), "finished group moved out of slot A")
        XCTAssertNotNil(((st["sessions"] as? [String: Any])?["lastEnded"] as? [String: Any])?["A"])
    }

    private static func literal(_ s: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [s])
        let arr = String(data: data, encoding: .utf8)!
        return String(arr.dropFirst().dropLast())
    }
}
