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
