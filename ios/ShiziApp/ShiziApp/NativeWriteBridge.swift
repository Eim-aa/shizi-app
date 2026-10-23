import QuartzCore
import UIKit
import WebKit

// 原生写字页 → 页面里的「写字会话 API」（B2.0；docs/engineering/v10/B2-原生写字架构.md §3）。
// 页面侧：src/ui/screens/write/native-session.js 装的 window.shiziNativeWrite(op, args) → Promise<结果>。
// 原生侧用 callAsyncJavaScript（iOS 14+）调用：参数按值传（不拼脚本字符串），结果是 JSON 形状的字典。
// 规则：写字中途（落笔 / 画 / 抬笔 / 撤销 / 清空）不等桥——strokes / phase 是「发出去不等」（P52 不阻断）；
// 只有 judge 等回包（D07：成功才推进）。调用在 WebKit 里按发出顺序执行，所以 strokes 一定先于随后的 judge 落库。

struct NativeWriteReply {
    let ok: Bool
    let body: [String: Any]
    let wallMs: Double // 原生发出 → 收到回包
    var jsMs: Double { (body["ms"] as? NSNumber)?.doubleValue ?? 0 }
    var errorKind: String? { (body["error"] as? [String: Any])?["kind"] as? String }
    var snapshot: [String: Any]? { body["snapshot"] as? [String: Any] }
}

final class NativeWriteBridge {
    weak var webView: WKWebView?

    init(webView: WKWebView?) {
        self.webView = webView
    }

    /// 调用一个会话操作。webView 不在 / JS 抛错 / 回包不是对象 → ok:false、error.kind = transport（对 judge 而言 = 「没保存上」三段式）。
    /// B3.2：与 App API 同一条通道（WebEngine.evaluate，函数 window.shiziNativeWrite）。
    func call(_ op: String, _ args: [String: Any], completion: @escaping (NativeWriteReply) -> Void) {
        #if DEBUG
        if Self.qaDelay(op, { self.callNow(op, args, completion: completion) }) { return }
        #endif
        callNow(op, args, completion: completion)
    }

    #if DEBUG
    /// R12 测试钩子（只在 DEBUG）：启动参数 -shizi-qa-bridge-delay <ms> 让每个写字 / 导航 op 晚这么久才交给 WebKit（模拟页面忙、桥慢），
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
        WebEngine.evaluate(webView, function: "shiziNativeWrite", op: op, args: args) { body, wall in
            let reply = NativeWriteReply(ok: (body["ok"] as? Bool) == true, body: body, wallMs: wall)
            #if DEBUG
            NativeWriteMetrics.shared.bridge(op: op, reply: reply)
            #endif
            completion(reply)
        }
    }

    /// 发出去不等（strokes / phase）。失败只记进量测，不打扰书写（P52）。
    /// B2.8：页面的导航助手 window.shiziNativeNav（back / cover / fence；不写 store）。与 call 同一条 callAsyncJavaScript 队列，所以和随后的写字 op 按发出顺序执行。
    func callNav(_ op: String, _ args: [String: Any] = [:], completion: @escaping (NativeWriteReply) -> Void) {
        #if DEBUG
        if Self.qaDelay(op, { self.callNavNow(op, args, completion: completion) }) { return }
        #endif
        callNavNow(op, args, completion: completion)
    }

    private func callNavNow(_ op: String, _ args: [String: Any], completion: @escaping (NativeWriteReply) -> Void) {
        WebEngine.evaluate(webView, function: "shiziNativeNav", op: op, args: args) { body, wall in
            completion(NativeWriteReply(ok: (body["ok"] as? Bool) == true, body: body, wallMs: wall))
        }
    }

    func send(_ op: String, _ args: [String: Any]) {
        call(op, args) { reply in
            if !reply.ok { ShiziProbe.log("native-write \(op) failed: \(reply.errorKind ?? "?")") }
        }
    }
}
