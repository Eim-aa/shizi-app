#if DEBUG
import UIKit
import WebKit

// 原生写字页的导航协调（B2.0；docs/engineering/v10/B2-原生写字架构.md §4）。
//
// 开关：DEBUG 启动参数 -shizi-native-write（或 SHIZI_NATIVE_WRITE=1），默认关。开着时：
//   - 文档开始注入 window.__shiziNativeWrite = true；网页写字条目照常入栈（网页路由仍是真相源），渲染成「原生宿主」，
//     挂载时发来 nativeWrite op:'open'（带快照），本协调者据此把原生写字页**盖在** WebViewController 上；宿主卸载时 op:'close'。
//   - 盖法 = 全屏覆盖呈现（.overFullScreen + 自定义转场），**不用导航栈 push**：push 完成后底下的 WKWebView 会被移出窗口，
//     WebKit 把不在窗口里的网页降速，判断往返从 p50 ≈ 20ms 变成 50–100ms（B2.0 模拟器实测，见架构文档 §7）。覆盖呈现时网页一直在窗口里、只是被盖住。
//   - 转场：推入（自右滑入）/ 滑出，左缘交互式滑回（UIPercentDrivenInteractiveTransition）；减少动态效果 150ms 淡化。
//     D62 首页入口的「纸展开 / 缩回」在 B2.8 换进这个转场对象（同一处）。
// 返回：原生写字页离开（‹ / 左缘滑回）→ 发 exit {to:'back'} → 页面 nav.back()；写完最后一字 → exit {to:'result'} → 页面就地换成结果页 → 原生淡出。
// 冷启动 / 页面重载：路由恢复出写字条目 → 宿主再发 open → 已有同槽写字页时只重新同步快照，否则不带动画直接盖上。

extension WebViewController: NativeWriteCoordinating {
    /// 真机试用：带 `-shizi-native-write` 启动一次后记在 UserDefaults，之后从主屏打开也保持开启；
    /// 带 `-shizi-native-write-off` 启动一次即关闭（仍只在 DEBUG 构建里有这一套）。
    static var nativeWriteEnabled: Bool {
        let p = ProcessInfo.processInfo
        let key = "shizi.debug.nativeWrite"
        if p.arguments.contains("-shizi-native-write-off") {
            UserDefaults.standard.set(false, forKey: key)
            return false
        }
        if p.arguments.contains("-shizi-native-write") || p.environment["SHIZI_NATIVE_WRITE"] == "1" {
            UserDefaults.standard.set(true, forKey: key)
            return true
        }
        return UserDefaults.standard.bool(forKey: key)
    }

    func installNativeWriteUserScriptIfNeeded(_ controller: WKUserContentController) {
        guard Self.nativeWriteEnabled else { return }
        controller.addUserScript(WKUserScript(source: "window.__shiziNativeWrite = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    var nativeWriteTop: NativeWriteViewController? { presentedViewController as? NativeWriteViewController }

    func handleNativeWriteMessage(_ body: [String: Any]) {
        guard Self.nativeWriteEnabled else { return }
        let op = body["op"] as? String ?? ""
        let slot = body["slot"] as? String == "B" ? "B" : "A"
        switch op {
        case "open":
            let receivedAt = CACurrentMediaTime()
            let receivedEpochMs = Date().timeIntervalSince1970 * 1000
            let payload = body["payload"] as? [String: Any] ?? [:]
            guard (payload["ok"] as? Bool) == true, let snap = payload["snapshot"] as? [String: Any], (snap["active"] as? Bool) == true else {
                NSLog("[shizi] native-write open without an active session (slot %@)", slot)
                return
            }
            NativeWriteMetrics.shared.recordJs("open", ms: (payload["ms"] as? NSNumber)?.doubleValue ?? 0)
            if let top = nativeWriteTop, top.slot == slot, !top.exitHandled {
                top.resync(payload: payload)
                return
            }
            if let other = presentedViewController {
                (other as? NativeWriteViewController)?.exitHandled = true
                other.dismiss(animated: false)
            }
            let vc = NativeWriteViewController(slot: slot, payload: payload, bridge: NativeWriteBridge(webView: webView))
            vc.coordinator = self
            vc.openTiming = ((body["sentAt"] as? NSNumber)?.doubleValue ?? receivedEpochMs, receivedAt, receivedEpochMs)
            vc.modalPresentationStyle = .overFullScreen
            vc.transitioningDelegate = vc.transitions
            let animate = body["animate"] as? Bool ?? true
            QATrace.note("open via=\(body["via"] as? String ?? "") animate=\(animate)") // QA-H1 测试钩子：转场核对（NF-01）
            // D62：首页入口应是「纸展开」、其他入口推入（B2.8 做）；B2.0 一律推入，冷启动恢复不带动画
            present(vc, animated: animate)
        case "close":
            // 宿主条目被别处卸掉（深链换组、跨天作废、store 整体替换）：原生页跟着离开，不再发 exit
            if let top = nativeWriteTop, top.slot == slot, !top.exitHandled {
                top.exitHandled = true
                top.dismiss(animated: false)
            }
        default:
            break
        }
    }

    // MARK: NativeWriteCoordinating

    func nativeWriteDidRequestBack(_ vc: NativeWriteViewController) {
        // 现场在抬笔 / 撤销 / 清空时已发出（P52）；这里只离开。离开完成时（viewDidDisappear）发 exit back。
        vc.dismiss(animated: true)
    }

    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String) {
        nativeWriteDidFinish(vc, sessionId: sessionId, undo: nil)
    }

    /// undo（B2.6）：跳过最后一字后 5 秒撤销机会还在时，剩余时长与笔画随 exit 交给结果页（页面 handoffSkipUndo）。
    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String, undo: [String: Any]?) {
        vc.exitHandled = true
        vc.saveMetrics()
        vc.endUndo()
        var args: [String: Any] = ["slot": vc.slot, "to": "result", "sessionId": sessionId]
        if let undo { args["undo"] = undo }
        // 先让页面把写字条目就地换成结果页（D20 无中间页），再淡出原生页露出它
        NativeWriteBridge(webView: webView).call("exit", args) { _ in
            vc.transitions.fadeNext = true
            vc.dismiss(animated: true)
        }
    }
}

/// 原生写字页的转场：推入 / 滑出 / 淡化，与左缘交互式滑回。
final class NativeWriteTransitions: NSObject, UIViewControllerTransitioningDelegate {
    var interactor: UIPercentDrivenInteractiveTransition?
    /// 下一次转场用淡化（写完最后一字换成结果页、减少动态效果）。
    var fadeNext = false

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeWriteSlide(presenting: true, fade: consumeFade())
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeWriteSlide(presenting: false, fade: consumeFade())
    }

    func interactionControllerForDismissal(using animator: UIViewControllerAnimatedTransitioning) -> UIViewControllerInteractiveTransitioning? {
        interactor
    }

    private func consumeFade() -> Bool {
        defer { fadeNext = false }
        return fadeNext || UIAccessibility.isReduceMotionEnabled
    }
}

final class NativeWriteSlide: NSObject, UIViewControllerAnimatedTransitioning {
    let presenting: Bool
    let fade: Bool

    init(presenting: Bool, fade: Bool) {
        self.presenting = presenting
        self.fade = fade
    }

    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval {
        fade ? 0.15 : 0.35 // 推入 / 返回 300–350ms（交互与动效规范 T0），淡化 150ms（D58 ②）
    }

    func animateTransition(using ctx: UIViewControllerContextTransitioning) {
        QATrace.note("\(presenting ? "present" : "dismiss"):\(fade ? "fade" : "slide")\(ctx.isInteractive ? ":interactive" : "")") // QA-H1 测试钩子
        let key: UITransitionContextViewKey = presenting ? .to : .from
        guard let v = ctx.view(forKey: key) else { ctx.completeTransition(false); return }
        let w = ctx.containerView.bounds.width
        if presenting {
            v.frame = ctx.containerView.bounds
            ctx.containerView.addSubview(v)
        }
        v.layer.shadowColor = UIColor.black.cgColor
        v.layer.shadowOpacity = fade ? 0 : 0.12
        v.layer.shadowRadius = 12
        v.layer.shadowOffset = CGSize(width: -4, height: 0)
        let start: () -> Void = {
            if self.fade { v.alpha = self.presenting ? 0 : 1 } else { v.transform = CGAffineTransform(translationX: self.presenting ? w : 0, y: 0) }
        }
        let end: () -> Void = {
            if self.fade { v.alpha = self.presenting ? 1 : 0 } else { v.transform = CGAffineTransform(translationX: self.presenting ? 0 : w, y: 0) }
        }
        start()
        let curve: UIView.AnimationOptions = ctx.isInteractive ? .curveLinear : .curveEaseOut
        UIView.animate(withDuration: transitionDuration(using: ctx), delay: 0, options: [curve], animations: end) { _ in
            let ok = !ctx.transitionWasCancelled
            v.transform = .identity
            v.alpha = 1
            v.layer.shadowOpacity = 0
            ctx.completeTransition(ok)
        }
    }
}
#endif
