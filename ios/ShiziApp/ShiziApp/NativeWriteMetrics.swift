#if DEBUG
import QuartzCore
import UIKit

// B3.1：原生写字页的纵切量测（只在 DEBUG：Release 不含 shizi-native-write-metrics.json，verify-archive.sh 断言）。原在 WriteSessionChannel.swift。

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
