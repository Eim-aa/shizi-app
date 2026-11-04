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
    /// body.finished.sessionId：这组已写完（judge / skip / 看答案流程的回包），交给结果页用的会话 id。
    var finishedSessionId: String? { (body["finished"] as? [String: Any])?["sessionId"] as? String }
    /// body.undo：skip 回包给的撤销机会（sessionId、recordId 都在才算）。
    var skipUndo: NativeSkipUndo? { (body["undo"] as? [String: Any]).flatMap(NativeSkipUndo.init) }
    /// end（action: counts）回包：还没写的首练字数 n、已判断数 m；缺键 = 0。
    var endCounts: (n: Int, m: Int) { (body["n"] as? Int ?? 0, body["m"] as? Int ?? 0) }
    /// end 提交回包：这组判断过几个字；缺键 = 0。
    var judgedCount: Int { body["judgedCount"] as? Int ?? 0 }
    /// redoNext 回包：重写错字已到最后（没有下一个字）。
    var done: Bool { (body["done"] as? Bool) == true }
}

/// 回包里共用的小形状的读法。
enum NativeWriteWire {
    /// {from, to} 段（提示的 given / hintRange）→ from..<to：from、to 都是 Int 且 to > from 才算，否则 nil。
    /// 下界不在这里限制（hint 回包的 given / hintRange 原来就不查 ≥ 0；快照的 hintRange 自己再加 from ≥ 0）。
    static func range(_ raw: Any?) -> Range<Int>? {
        guard let r = raw as? [String: Any], let a = r["from"] as? Int, let b = r["to"] as? Int, b > a else { return nil }
        return a..<b
    }
}

/// hint op 回包（action state / give；ShiziCore WriteAPI hint）。
struct NativeHintReply {
    /// 提示按钮的样子（body.button）；没有这个键 = nil（沿用原来的按钮）。
    let button: NativeHintButton?
    /// 格下提示说明（body.note.text）。
    let noteText: String?
    /// give：这次多给的一段。
    let given: Range<Int>?
    /// give：合并后已给出的整段。
    let hintRange: Range<Int>?
    let used: Int?
    /// give：整字给完（= 看过答案）。
    let whole: Bool
    /// give：读屏播报（给出了哪几笔）。
    let announce: String?

    init(_ body: [String: Any]) {
        button = (body["button"] as? [String: Any]).map { NativeHintButton($0) }
        noteText = (body["note"] as? [String: Any])?["text"] as? String
        given = NativeWriteWire.range(body["given"])
        hintRange = NativeWriteWire.range(body["hintRange"])
        used = body["used"] as? Int
        whole = (body["whole"] as? Bool) == true
        announce = body["announce"] as? String
    }
}

/// 提示按钮（hint 回包 body.button）：kind = loading / available / exhausted / unavailable…；缺键 = nil，默认值留在用的地方。
struct NativeHintButton {
    var kind: String? = nil
    var text: String? = nil
    var label: String? = nil
    var disabled: Bool? = nil
}

extension NativeHintButton {
    init(_ raw: [String: Any]) {
        kind = raw["kind"] as? String
        text = raw["text"] as? String
        label = raw["label"] as? String
        disabled = raw["disabled"] as? Bool
    }
}

/// 跳过撤销条的参数（open 回包 skipUndo；写字页与结果页同一份）。缺键用默认：5 秒、按住暂停、读屏不自动收起。
struct NativeSkipUndoParams {
    var ms: Double = 5000
    var pauseWhileHeld = true
    /// 键名是 keepOpenWithAssistiveTech。
    var keepOpen = true
}

extension NativeSkipUndoParams {
    init(_ raw: [String: Any]) {
        ms = (raw["ms"] as? NSNumber)?.doubleValue ?? 5000
        pauseWhileHeld = (raw["pauseWhileHeld"] as? NSNumber)?.boolValue ?? true
        keepOpen = (raw["keepOpenWithAssistiveTech"] as? NSNumber)?.boolValue ?? true
    }
}

/// 结果页提醒邀请 resultInvite 回包（shown / yes / time）。缺键 = nil，默认值留在用的地方（各 action 不同）。
struct NativeInviteReply {
    /// shown：现在是不是傍晚（问法不同）；只有 true 才算。
    let evening: Bool
    /// yes：failed / denied / 其余 = 已开提醒。
    let phase: String?
    /// yes / time：结果行文字。
    let text: String?
    let hour: Int?
    let minute: Int?

    init(_ body: [String: Any]) {
        evening = (body["evening"] as? Bool) == true
        phase = body["phase"] as? String
        text = body["text"] as? String
        hour = body["hour"] as? Int
        minute = body["minute"] as? Int
    }
}

/// skip 回包里的撤销机会（body.undo）：撤销条 / 交给结果页的 handoff 都用它。
struct NativeSkipUndo {
    let sessionId: String
    let recordId: String
    /// 缺键 = ""（与原来逐处的默认一致）。
    let char: String

    init?(_ raw: [String: Any]) {
        guard let sid = raw["sessionId"] as? String, let rid = raw["recordId"] as? String else { return nil }
        sessionId = sid
        recordId = rid
        char = raw["char"] as? String ?? ""
    }
}

/// 快照里的「上一个字」结果行（snapshot.line；ShiziCore WriteModels 拼出）。
struct NativeWriteLine {
    let text: String?
    /// 「修改 ›」按钮文字；可改的记录才有。
    let action: String?
    /// sessions.canCorrect（看过答案 / 跳过不可改）；缺键或不是 Bool = false。
    let canChange: Bool
    let recordId: String?

    init(_ raw: [String: Any]) {
        text = raw["text"] as? String
        action = raw["action"] as? String
        canChange = (raw["canChange"] as? Bool) == true
        recordId = raw["recordId"] as? String
    }
}

/// 写字会话快照（open 与各 op 回包里的 snapshot 对象，ShiziCore WriteModels.snapshot / WriteAPI redoOpen·redoNext 拼出）的类型化读法。
/// 边界上仍是字典（引擎回的是 JSON 形状的值，原生页把它原样存着、再原样交回去）；这里只把读的字段收成一处。
/// 每个字段的转换与原来逐处写的 `as?` 一字不差（Int / Bool / String 原样 cast，不放宽成 NSNumber），缺键或类型不对 = nil；
/// 缺省值留在用的地方（各处不同，如 cursor 有 `?? 0` 也有 `?? -1`）。strokes 仍由 NativeInkWire.rawStrokes 读原值。
struct NativeWriteSnapshot {
    let sessionId: String?
    let cardKey: String?
    let char: String?
    let cursor: Int?
    let total: Int?
    let canEnd: Bool?
    let hints: Int?
    /// 已给出的提示段 from..<to：只收 from、to 都是 Int 且 to > from ≥ 0 的，否则 nil。
    let hintRange: Range<Int>?
    let answerSeen: Bool?
    /// 重写错字页：这是最后一个字（redoOpen / redoNext 给；正式会话的快照没有这个键）。
    let last: Bool?
    let active: Bool?
    let done: Bool?
    let phase: String?
    let answerPhase: String?
    let firstTip: Bool?
    let prompt: [String: Any]?
    let line: NativeWriteLine?

    init(_ raw: [String: Any]) {
        sessionId = raw["sessionId"] as? String
        cardKey = raw["cardKey"] as? String
        char = raw["char"] as? String
        cursor = raw["cursor"] as? Int
        total = raw["total"] as? Int
        canEnd = raw["canEnd"] as? Bool
        hints = raw["hints"] as? Int
        hintRange = NativeWriteWire.range(raw["hintRange"]).flatMap { r -> Range<Int>? in r.lowerBound >= 0 ? r : nil }
        answerSeen = raw["answerSeen"] as? Bool
        last = raw["last"] as? Bool
        active = raw["active"] as? Bool
        done = raw["done"] as? Bool
        phase = raw["phase"] as? String
        answerPhase = raw["answerPhase"] as? String
        firstTip = raw["firstTip"] as? Bool
        prompt = raw["prompt"] as? [String: Any]
        line = (raw["line"] as? [String: Any]).map(NativeWriteLine.init)
    }

    /// 这组已不在进行（不活跃，或已写完）：stale 对账时据此交给结果页 / 来源。
    var ended: Bool { active != true || done == true }
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
