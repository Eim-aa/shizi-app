import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// ShiziWriteTests 的宿主工具（B4.9：App 里没有网页了，原来经页面测试钩子 window.__shiziTest 与网页路由做的准备 / 读回，改成直接用 Swift 的同一批入口）。
//   reset      清写入注入、删全部 shizi.* 键、重读库（test-hooks reset 的 Swift 版：SwiftEngine.qaReset），回首页
//   state      store 状态（getState）
//   startA     首页主按钮开组（home.start，与原生首页同一个 op）
//   startPicked 开「这次选的字」（EngineHost.startPicked，与查字弹层「练这些字」同一个入口）
//   top / tab  路由栈顶 / tab 根（SwiftNavigator 的栈）
@MainActor
final class TestHost {
    let root: RootViewController

    init() throws {
        root = try XCTUnwrap(UIApplication.shared.delegate?.window??.rootViewController as? RootViewController, "root is the native root")
    }

    var engine: SwiftEngine { root.stage.engine }
    /// 冷启动判定做完（原来等网页 pageReady）。
    var ready: Bool { root.stage.planned }

    func reset() {
        if let top = root.nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
        }
        switchTab("home")
        engine.qaReset()
        QAClock.setClock(nil)
    }

    func state() -> [String: Any] { EngineValue.any(.object(engine.core.store.state)) as? [String: Any] ?? [:] }

    func startA() async -> Bool { (await engine.raw("home.start", [:]))["ok"] as? Bool == true }

    @discardableResult func startPicked(_ chars: [String]) -> Bool {
        (try? engine.core.host.startPicked(chars.map { .string($0) }, source: .null))?["ok"] == .bool(true)
    }

    var top: String? { engine.nav.router.top?["n"]?.stringValue }
    var tab: String? { engine.nav.router.stack.first?["n"]?.stringValue }

    func switchTab(_ name: String) { try? engine.nav.router.switchTab(name) }
    func push(_ name: String) { try? engine.nav.push(name, .object(JSObject())) }

    /// 某条记录有没有墨迹（getInk）。
    func hasInk(recordId: String) -> Bool {
        guard let r = Query.flattenRecords(engine.core.store.state["records"]).first(where: { $0["id"] == .string(recordId) }) else { return false }
        return engine.core.store.getInk(r) != nil
    }
}

extension RootViewController {
    /// 下一次写入失败（D07 三段式的测试）：按发出顺序挂在之后的第一个写 op 上。
    @MainActor func qaFailNextWrite() {
        stage.engine.qaFailNextWrite()
    }
}
