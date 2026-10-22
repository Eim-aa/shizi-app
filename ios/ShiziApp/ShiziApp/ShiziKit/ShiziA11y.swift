import UIKit

/// B2.9b：原生写字流程（写字页 / 判断页 / 结果页 / 弹层 / 确认框）的读屏通知一律经这里发：换字 / 换阶段 screenChanged、弹层内换内容 layoutChanged、
/// 状态变化播报 announcement（排队播，不打断上一句——网页 aria-live=polite 同义）。每一条同时记下（探针 a11y，XCUITest 核对播报队列）。
enum NativeA11y {
    private(set) static var events: [String] = []
    /// 发过的通知总数（只增；events 只留最近 40 条）。
    private(set) static var total = 0

    private static func note(_ kind: String, _ arg: Any?) {
        var text = ""
        if let s = arg as? String { text = s }
        else if let l = arg as? UILabel { text = l.accessibilityLabel ?? l.text ?? "" }
        else if let v = arg as? UIView { text = v.accessibilityLabel ?? v.accessibilityIdentifier ?? String(describing: type(of: v)) }
        events.append("\(kind):\(text)")
        total += 1
        if events.count > 40 { events.removeFirst(events.count - 40) }
    }

    static func screenChanged(_ focus: Any?) {
        note("screen", focus)
        UIAccessibility.post(notification: .screenChanged, argument: focus)
    }

    static func layoutChanged(_ focus: Any?) {
        note("layout", focus)
        UIAccessibility.post(notification: .layoutChanged, argument: focus)
    }

    static func announce(_ text: String?) {
        guard let text, !text.isEmpty else { return }
        note("announce", text)
        UIAccessibility.post(notification: .announcement, argument: NSAttributedString(string: text, attributes: [.accessibilitySpeechQueueAnnouncement: true]))
    }
}
