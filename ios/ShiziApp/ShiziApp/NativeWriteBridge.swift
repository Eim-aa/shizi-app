#if DEBUG
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
    func call(_ op: String, _ args: [String: Any], completion: @escaping (NativeWriteReply) -> Void) {
        let t0 = CACurrentMediaTime()
        guard let webView else {
            completion(NativeWriteReply(ok: false, body: ["error": ["kind": "transport"]], wallMs: 0))
            return
        }
        webView.callAsyncJavaScript(
            "if (typeof window.shiziNativeWrite !== 'function') return {ok:false, error:{kind:'unavailable'}}; return await window.shiziNativeWrite(op, args);",
            arguments: ["op": op, "args": args],
            in: nil,
            in: .page
        ) { result in
            let wall = (CACurrentMediaTime() - t0) * 1000
            var body: [String: Any] = ["error": ["kind": "transport"]]
            if case .success(let value) = result, let dict = value as? [String: Any] { body = dict }
            if case .failure(let error) = result { body = ["ok": false, "error": ["kind": "transport", "reason": error.localizedDescription]] }
            let reply = NativeWriteReply(ok: (body["ok"] as? Bool) == true, body: body, wallMs: wall)
            NativeWriteMetrics.shared.bridge(op: op, reply: reply)
            completion(reply)
        }
    }

    /// 发出去不等（strokes / phase）。失败只记进量测，不打扰书写（P52）。
    /// B2.8：页面的导航助手 window.shiziNativeNav（back / cover / fence；不写 store）。与 call 同一条 callAsyncJavaScript 队列，所以和随后的写字 op 按发出顺序执行。
    func callNav(_ op: String, _ args: [String: Any] = [:], completion: @escaping (NativeWriteReply) -> Void) {
        let t0 = CACurrentMediaTime()
        guard let webView else {
            completion(NativeWriteReply(ok: false, body: ["error": ["kind": "transport"]], wallMs: 0))
            return
        }
        webView.callAsyncJavaScript(
            "if (typeof window.shiziNativeNav !== 'function') return {ok:false, error:{kind:'unavailable'}}; return await window.shiziNativeNav(op, args);",
            arguments: ["op": op, "args": args],
            in: nil,
            in: .page
        ) { result in
            var body: [String: Any] = ["ok": false, "error": ["kind": "transport"]]
            if case .success(let value) = result, let dict = value as? [String: Any] { body = dict }
            completion(NativeWriteReply(ok: (body["ok"] as? Bool) == true, body: body, wallMs: (CACurrentMediaTime() - t0) * 1000))
        }
    }

    func send(_ op: String, _ args: [String: Any]) {
        call(op, args) { reply in
            if !reply.ok { NSLog("[shizi] native-write %@ failed: %@", op, reply.errorKind ?? "?") }
        }
    }
}

/// 纵切量测：页面打开、每个桥操作的往返、落笔到上屏（取自 NativeInkView.latency）。写 Documents/shizi-native-write-metrics.json。
final class NativeWriteMetrics {
    static let shared = NativeWriteMetrics()
    static let fileName = "shizi-native-write-metrics.json"

    private(set) var opens: [[String: Double]] = [] // {postToReceiveMs, receiveToAppearMs, postToAppearMs}
    private(set) var ops: [String: [Double]] = [:] // op → 往返 ms
    private(set) var jsOps: [String: [Double]] = [:] // op → 页面内执行 ms
    var inkSummary: [String: Any] = [:]
    /// 全部原生写字页共用一份落笔→上屏量测（每次打开都是新的书写面）。
    let inkLatency = NativeInkLatency()

    func open(sentAtEpochMs: Double, receivedAt: CFTimeInterval, appearedAt: CFTimeInterval, receivedEpochMs: Double) {
        let postToReceive = max(0, receivedEpochMs - sentAtEpochMs)
        let receiveToAppear = (appearedAt - receivedAt) * 1000
        opens.append(["postToReceiveMs": postToReceive, "receiveToAppearMs": receiveToAppear, "postToAppearMs": postToReceive + receiveToAppear])
        NSLog("[shizi] native-write open: post→receive %.1fms, receive→appear %.1fms", postToReceive, receiveToAppear)
        save()
    }

    private(set) var firstLayouts: [Double] = [] // 收到 open → 原生页首次排版完成（内容就绪、转场开始前）

    /// 页面里执行、不经原生往返的操作（open 随消息推来）的页面内耗时。
    func recordJs(_ op: String, ms: Double) { jsOps[op, default: []].append(ms) }

    func firstLayout(ms: Double) {
        firstLayouts.append(ms)
        NSLog("[shizi] native-write first layout %.1fms after open", ms)
    }

    func bridge(op: String, reply: NativeWriteReply) {
        ops[op, default: []].append(reply.wallMs)
        jsOps[op, default: []].append(reply.jsMs)
        if op == "judge" {
            NSLog("[shizi] native-write judge %@: wall %.1fms (js %.1fms)", reply.ok ? "ok" : (reply.errorKind ?? "fail"), reply.wallMs, reply.jsMs)
        }
    }

    var summary: [String: Any] {
        var out: [String: Any] = [:]
        out["open"] = [
            "postToAppearMs": NativeInkLatency.stats(opens.compactMap { $0["postToAppearMs"] }),
            "receiveToAppearMs": NativeInkLatency.stats(opens.compactMap { $0["receiveToAppearMs"] }),
            "postToReceiveMs": NativeInkLatency.stats(opens.compactMap { $0["postToReceiveMs"] }),
            "receiveToFirstLayoutMs": NativeInkLatency.stats(firstLayouts),
        ]
        out["bridgeWallMs"] = ops.mapValues { NativeInkLatency.stats($0) }
        out["bridgeJsMs"] = jsOps.mapValues { NativeInkLatency.stats($0) }
        out["ink"] = inkSummary
        out["device"] = [
            "model": UIDevice.current.model,
            "system": UIDevice.current.systemVersion,
            "simulator": ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "",
            "maxFps": UIScreen.main.maximumFramesPerSecond,
        ]
        out["savedAt"] = ISO8601DateFormatter().string(from: Date())
        return out
    }

    func save() {
        guard let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let data = try? JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: dir.appendingPathComponent(Self.fileName), options: .atomic)
    }
}
#endif
