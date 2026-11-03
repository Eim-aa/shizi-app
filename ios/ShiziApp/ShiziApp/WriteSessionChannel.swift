import QuartzCore
import UIKit

// 原生写字页 / 结果页 → 写字会话 API（B2.0 起；docs/engineering/v10/B2-原生写字架构.md §3）。B4.9 起由 SwiftEngine 答（EngineRoute → SessionRuntime 的 write.*；
// 导航助手 back / cover / fence 由 SwiftNavigator 答），B2 时经 WKWebView 的那座桥（NativeWriteBridge）已删除。
// 规则照旧：写字中途（落笔 / 画 / 抬笔 / 撤销 / 清空）不等回包——strokes / phase 是「发出去不等」（P52 不阻断）；只有 judge 等回包（D07：成功才推进）。
// 调用按发出顺序答（SwiftEngine 排在同一条主线程任务队列上），所以 strokes 一定先于随后的 judge 落库。

struct NativeWriteReply {
    let ok: Bool
    let body: [String: Any]
    let wallMs: Double // 原生发出 → 收到回包
    var jsMs: Double { (body["ms"] as? NSNumber)?.doubleValue ?? 0 }
    var errorKind: String? { (body["error"] as? [String: Any])?["kind"] as? String }
    var snapshot: [String: Any]? { body["snapshot"] as? [String: Any] }
}

final class WriteSessionChannel {
    init() {}

    /// 调用一个会话操作。引擎不在 / 回包不是对象 → ok:false、error.kind = unavailable（对 judge 而言 = 「没保存上」三段式）。
    func call(_ op: String, _ args: [String: Any], completion: @escaping (NativeWriteReply) -> Void) {
        #if DEBUG
        if Self.qaDelay(op, { self.callNow(op, args, completion: completion) }) { return }
        #endif
        callNow(op, args, completion: completion)
    }

    #if DEBUG
    /// R12 测试钩子（只在 DEBUG）：启动参数 -shizi-qa-bridge-delay <ms> 让每个写字 / 导航 op 晚这么久才交给引擎（模拟引擎忙、回包慢），
    /// 发出顺序不变（每个 op 的出发时刻不早于前一个）。返回是否已改为延后发出。
    private static let qaDelayMs: Double = {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-shizi-qa-bridge-delay"), i + 1 < a.count else { return 0 }
        return Double(a[i + 1]) ?? 0
    }()
    private static var qaNextAt: DispatchTime = .now()
    private static var qaDelayed = false
    private static func qaDelay(_ op: String, _ go: @escaping () -> Void) -> Bool {
        guard qaDelayMs > 0, !qaDelayed else { return false }
        let at = max(DispatchTime.now() + qaDelayMs / 1000, qaNextAt)
        qaNextAt = at
        DispatchQueue.main.asyncAfter(deadline: at) {
            qaDelayed = true
            defer { qaDelayed = false }
            go()
        }
        return true
    }
    #endif

    private func callNow(_ op: String, _ args: [String: Any], completion: @escaping (NativeWriteReply) -> Void) {
        EngineRoute.evaluate(function: EngineOps.write, op: op, args: args) { body, wall in
            let reply = NativeWriteReply(ok: (body["ok"] as? Bool) == true, body: body, wallMs: wall)
            #if DEBUG
            NativeWriteMetrics.shared.bridge(op: op, reply: reply)
            #endif
            completion(reply)
        }
    }

    /// 导航助手（back / cover / fence；不写 store）。与 call 同一条队列，所以和随后的写字 op 按发出顺序执行。
    func callNav(_ op: String, _ args: [String: Any] = [:], completion: @escaping (NativeWriteReply) -> Void) {
        #if DEBUG
        if Self.qaDelay(op, { self.callNavNow(op, args, completion: completion) }) { return }
        #endif
        callNavNow(op, args, completion: completion)
    }

    private func callNavNow(_ op: String, _ args: [String: Any], completion: @escaping (NativeWriteReply) -> Void) {
        EngineRoute.evaluate(function: EngineOps.nav, op: op, args: args) { body, wall in
            completion(NativeWriteReply(ok: (body["ok"] as? Bool) == true, body: body, wallMs: wall))
        }
    }

    /// 发出去不等（strokes / phase）。失败只记进量测，不打扰书写（P52）。
    func send(_ op: String, _ args: [String: Any]) {
        call(op, args) { reply in
            if !reply.ok { ShiziProbe.log("native-write \(op) failed: \(reply.errorKind ?? "?")") }
        }
    }
}
