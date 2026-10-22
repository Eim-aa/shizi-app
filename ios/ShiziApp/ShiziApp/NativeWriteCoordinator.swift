#if DEBUG
import UIKit
import WebKit

// 原生写字页的导航协调（B2.0；docs/engineering/v10/B2-原生写字架构.md §4；B2.8 转场整合 §23）。
//
// 开关：DEBUG 启动参数 -shizi-native-write（或 SHIZI_NATIVE_WRITE=1），默认关。开着时：
//   - 文档开始注入 window.__shiziNativeWrite = true；网页写字条目照常入栈（网页路由仍是真相源），渲染成「原生宿主」，
//     挂载时发来 nativeWrite op:'open'（带快照与进来时的转场计划），本协调者据此把原生写字页**盖在** WebViewController 上；宿主卸载时 op:'close'。
//   - 盖法 = 全屏覆盖呈现（.overFullScreen），**不用导航栈 push**：push 完成后底下的 WKWebView 会被移出窗口，
//     WebKit 把不在窗口里的网页降速，判断往返从 p50 ≈ 20ms 变成 50–100ms（B2.0 模拟器实测，见架构文档 §7）。覆盖呈现时网页一直在窗口里、只是被盖住。
//   - 转场（B2.8）：全部在 NativeWriteTransitions 一个对象里（交互规范 T0 / T0-6 / D62）——首页入口 T-paper（纸从被点按钮展开、返回缩回，矩形随 open 带来、
//     返回前向页面问被点元素此刻的位置）、其他点按入口 T-push（300ms 自右推入、下层视差 −30%）、通知 / 无来源入口 T-quiet、冷启动恢复与「回来」不带转场、
//     写完最后一字 T-phase 淡成结果页、减少动态效果一律 150ms 淡化；点「‹」/「×」与左缘右滑（跟手，阈值 BackGestureThreshold）是同一个 frame(s)。
//     网页对宿主条目不再播自己的纸展开 / 推入（root.js nativeMoves），同一时刻只有一个转场在跑。
// 返回：原生页离开（‹ / 左缘滑回）→ 转场放完 → 发 exit {to:'back'} → 页面 nav.back()；写完最后一字 → exit {to:'result'} → 页面就地换成结果页 → 原生结果页淡入。
// 让开：原生页为网页页面让开（写字页「看这个字 ›」进字详情、结果页进重写错字 / 字详情 / 分享）时，网页先换好页（写字页的样子以截图留在宿主层上），
//   等页面画完一帧（shiziNativeNav fence）再收起原生页——推入 / 左缘滑回都由网页自己播，露出的是原生页的样子；回来时等网页转场放完，原生不带转场盖上。
// 冷启动 / 页面重载：路由恢复出写字条目 → 宿主再发 open → 已有同槽写字页时只重新同步快照，否则不带动画直接盖上；
//   重载后宿主不再认领（页面没有恢复出这一页）：原生页原样留住截图、等页面画好后淡出（NativeNavState）。
// 深链换组 / 跨天作废 / 阻断页 / store 整体替换：宿主被卸掉（close / result-close）→ 原生页的样子留在原处，有新的原生页接着盖上就压在它上面，
//   否则等页面画好再 T-fade 淡出（不闪、不留残影）。

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
    /// B2.9a：原生重写错字页（与写字页同一个类，redo 模式）。
    var nativeRedoTop: NativeWriteViewController? { nativeWriteTop.flatMap { $0.redo ? $0 : nil } }
    /// B2.7：原生结果页（与写字页同一种覆盖呈现）。
    var nativeResultTop: NativeResultViewController? { presentedViewController as? NativeResultViewController }

    func handleNativeWriteMessage(_ body: [String: Any]) {
        guard Self.nativeWriteEnabled else { return }
        let op = body["op"] as? String ?? ""
        let slot = body["slot"] as? String == "B" ? "B" : "A"
        switch op {
        case "open":
            handleWriteOpen(body, slot: slot)
        case "result-open":
            handleResultOpen(body)
        case "result-close":
            handleResultClose(body, slot: slot)
        case "redo-open", "redo-close":
            handleRedoMessage(op, body) // B2.9a 原生重写错字页（本文件末尾；B2.8 起转场走 NativeWriteTransitions）
        case "close":
            // 宿主条目被别处卸掉（深链换组、跨天作废、阻断页、store 整体替换）：原生页跟着离开，不再发 exit。
            // 样子留在原处：紧接着有新的原生页（深链换组）就压在它上面推入 / 淡入，否则等页面画好再淡出（不闪、不留残影）。
            guard let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo else { return }
            top.exitHandled = true
            QATrace.note("close")
            stepAsideLeavingCover(top)
        default:
            break
        }
    }

    private func handleWriteOpen(_ body: [String: Any], slot: String) {
        let receivedAt = CACurrentMediaTime()
        let receivedEpochMs = Date().timeIntervalSince1970 * 1000
        let payload = body["payload"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, let snap = payload["snapshot"] as? [String: Any], (snap["active"] as? Bool) == true else {
            NSLog("[shizi] native-write open without an active session (slot %@)", slot)
            // 宿主还在、组已经没了（重载后恢复出的写字条目，组已作废）：盖着的同槽原生页收起，不留一张写不了的页
            if let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo {
                top.exitHandled = true
                QATrace.note("close")
                stepAsideLeavingCover(top)
            }
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: payload)
        NativeWriteMetrics.shared.recordJs("open", ms: (payload["ms"] as? NSNumber)?.doubleValue ?? 0)
        let via = body["via"] as? String ?? ""
        if let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo {
            top.resync(payload: payload)
            return
        }
        let vc = NativeWriteViewController(slot: slot, payload: payload, bridge: NativeWriteBridge(webView: webView))
        vc.coordinator = self
        vc.openTiming = ((body["sentAt"] as? NSNumber)?.doubleValue ?? receivedEpochMs, receivedAt, receivedEpochMs)
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.transitions
        let animate = body["animate"] as? Bool ?? true
        QATrace.note("open via=\(via) animate=\(animate)") // QA-H1 测试钩子：转场核对（NF-01）
        let plan = NativeNavPlan(body["plan"] as? [String: Any])
        // D62：首页入口纸展开（home）、无来源入口安静淡入（quiet）、其他点按入口推入（push / again：结果页「再写一组」/ 撤销跳过）；
        // 冷启动恢复（restore）与从字详情回来（return：网页已播完字详情滑出，露出的就是这一页的样子）不带转场。
        let kind: NativeNavKind = !animate || via == "restore" || via == "return" ? .none
            : via == "home" ? .paper : via == "quiet" ? .quiet : .push
        prepareTransitions(vc.transitions, plan: kind == .none ? NativeNavPlan(kind: .push) : plan.with(kind: kind))
        let show: () -> Void = { [weak self] in // vc 强引用：旧页收起之后才呈现，局部变量那时已出作用域
            guard let self else { return }
            vc.transitions.under = NativeResultCover.adopt()
            vc.transitions.present(vc, over: self, kind: kind) { NativeResultCover.clear() }
        }
        if let other = presentedViewController {
            // 结果页「再写一组」/ 撤销跳过 → 新写字页（或深链换组）：旧页的样子留在原处，新写字页推入盖在它上面（D62：同一层换内容也是普通推入）
            (other as? NativeWriteViewController)?.exitHandled = true
            (other as? NativeResultViewController)?.exitHandled = true
            if NativeResultCover.current == nil { NativeResultCover.cover(other.view, in: view) }
            (other as? NativeTransitionPage)?.transitions.finishNow()
            Self.dismissWhenSettled(other, then: show)
        } else {
            show()
        }
    }

    /// 页面问一次「顶层原生页回去时怎么走」（paper 带被点元素此刻的矩形）；返回前与左缘起手时各问一次（结果在 planProvider 回调里）。
    private func prepareTransitions(_ t: NativeWriteTransitions, plan: NativeNavPlan) {
        t.plan = plan
        t.host = view
        let bridge = NativeWriteBridge(webView: webView)
        t.planProvider = { done in
            bridge.callNav("back") { reply in done(reply.ok ? NativeNavPlan(reply.body["plan"] as? [String: Any]) : nil) }
        }
    }

    /// 原生页被别处卸掉（close / 结果条目被移出页面栈）：样子留在原处、原生页立即收起；若没有新的原生页接手，等页面画好再 T-fade 淡出。
    private func stepAsideLeavingCover(_ page: UIViewController) {
        (page as? NativeTransitionPage)?.transitions.finishNow()
        NativeResultCover.cover(page.view, in: view)
        Self.dismissWhenSettled(page) { [weak self] in
            guard let self else { return }
            NativeResultCover.fadeLater(bridge: NativeWriteBridge(webView: self.webView))
        }
    }

    // MARK: NativeWriteCoordinating

    func nativeWriteDidRequestBack(_ vc: NativeWriteViewController) {
        // 现场在抬笔 / 撤销 / 清空时已发出（P52）；这里只离开。转场放完、收起后（viewDidDisappear）发 exit back。
        leave(vc, vc.transitions)
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
        // 先让页面把写字条目就地换成结果页（D20 无中间页）；B2.7 起结果页是原生的：页面的结果宿主随即发 result-open，
        // 由 handleResultOpen 把写字页淡成原生结果页（T-phase）。页面没请原生结果页（找不到这一组）时保底：等页面画好，原生页淡出露出网页。
        NativeWriteBridge(webView: webView).call("exit", args) { [weak self, weak vc] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + NativeNavState.handoffWait) {
                guard let self, let vc, self.presentedViewController === vc, !vc.transitions.isLeaving else { return }
                self.stepAsideLeavingCover(vc)
            }
        }
    }

    /// R9-B / B2.8：改判弹层「看这个字 ›」（D66 ⑮）：写字条目留在网页栈里，字详情推入在它上面。原生页的样子先以截图交给宿主层（字详情推入 / 左缘滑回时露出的是它），
    /// 页面推入字详情、画好一帧后原生页直接收起（推入由网页播）；详情返回时宿主等网页转场放完再请原生盖上（open via 'return'，不带转场）。
    func nativeWriteOpenDetail(_ vc: NativeWriteViewController, char: String) {
        guard !vc.exitHandled else { return }
        vc.exitHandled = true // 交给页面导航中（失败时放回）
        let bridge = NativeWriteBridge(webView: webView)
        let slot = vc.slot
        vc.transitions.finishNow()
        let url = Self.snapshotURL(vc.view)
        // 截图先交给宿主层并等页面解码好（cover 回包），再请页面推入字详情——推入的第一帧下面就是原生页的样子
        bridge.callNav("cover", url.map { ["slot": slot, "url": $0] } ?? ["slot": slot]) { [weak self, weak vc] _ in
            guard let self, let vc else { return }
            self.openDetailAfterCover(vc, char: char, bridge: bridge)
        }
    }

    private func openDetailAfterCover(_ vc: NativeWriteViewController, char: String, bridge: NativeWriteBridge) {
        let slot = vc.slot
        bridge.call("exit", ["slot": slot, "to": "detail", "char": char]) { [weak self, weak vc] reply in
            guard let self, let vc else { return }
            guard reply.ok else {
                vc.exitHandled = false
                bridge.callNav("cover", ["slot": slot]) { _ in }
                return
            }
            vc.saveMetrics()
            vc.endUndo()
            self.yield(vc, bridge: bridge, what: "detail")
        }
    }

    /// 让开：等页面画完一帧（网页已换好页，推入从第一帧起），原生页不带转场收起。
    private func yield(_ page: UIViewController, bridge: NativeWriteBridge, what: String) {
        QATrace.note("yield:\(what)")
        bridge.callNav("fence") { [weak page] _ in
            guard let page, page.presentingViewController != nil else { return }
            (page as? NativeTransitionPage)?.transitions.finishNow()
            Self.dismissWhenSettled(page)
        }
    }

    /// 返回（‹ / ×）：先向页面问一次回去的路（纸缩回时被点元素此刻的位置与字），再放转场；问不到（超时）就按进来时记下的计划走。
    private func leave(_ page: UIViewController, _ t: NativeWriteTransitions) {
        guard page.presentingViewController != nil, !t.isLeaving else { return }
        t.isLeaving = true
        var done = false
        let go: (NativeNavPlan?) -> Void = { [weak page, weak t] plan in
            guard !done, let page, let t else { return }
            done = true
            if let plan { t.plan = plan }
            t.leave(page)
        }
        if let ask = t.planProvider {
            ask { plan in go(plan) }
            DispatchQueue.main.asyncAfter(deadline: .now() + NativeNavState.planWait) { go(nil) }
        } else {
            go(nil)
        }
    }

    // MARK: B2.7 原生结果页

    /// 不带动画收起一张覆盖页；它还在 UIKit 呈现转场里时等转场完再收（UIKit 转场中途 dismiss 会被忽略）。
    static func dismissWhenSettled(_ vc: UIViewController, then: (() -> Void)? = nil) {
        if vc.isBeingPresented || vc.isBeingDismissed, let tc = vc.transitionCoordinator {
            tc.animate(alongsideTransition: nil) { _ in
                if vc.presentingViewController != nil { vc.dismiss(animated: false, completion: then) } else { then?() }
            }
            return
        }
        if vc.presentingViewController == nil { then?(); return }
        vc.dismiss(animated: false, completion: then)
    }

    private func handleResultOpen(_ body: [String: Any]) {
        let slot = body["slot"] as? String == "B" ? "B" : "A"
        let sid = body["sessionId"] as? String ?? ""
        let payload = body["payload"] as? [String: Any] ?? [:]
        let look = body["look"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, let v = payload["view"] as? [String: Any], (v["found"] as? Bool) == true else {
            NSLog("[shizi] native-result open without a group (slot %@)", slot)
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: look)
        let via = body["via"] as? String ?? ""
        if let top = nativeResultTop, top.slot == slot, top.sessionId == sid, !top.exitHandled {
            top.apply(view: v)
            return
        }
        let vc = NativeResultViewController(slot: slot, sessionId: sid, look: look, view: v, bridge: NativeWriteBridge(webView: webView))
        vc.coordinator = self
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.transitions
        let animate = (body["animate"] as? Bool) ?? true
        QATrace.note("result:open via=\(via) animate=\(animate)")
        // 结果页回去的路由页面定（写字页从首页纸展开进来的：纸缩回；推入进来的：右滑出；安静淡入进来的：安静淡出），返回前再问
        prepareTransitions(vc.transitions, plan: NativeNavPlan(kind: .push))
        if let w = nativeWriteTop {
            // 写完最后一字（或结束这组有判断）：写字页的样子留在原处，原生结果页在它上面淡入（D20 无中间页，T-phase）
            w.exitHandled = true
            w.transitions.finishNow()
            NativeResultCover.cover(w.view, in: view)
            Self.dismissWhenSettled(w) { [weak self] in
                guard let self else { return }
                vc.transitions.present(vc, over: self, kind: .phase) { NativeResultCover.clear() }
            }
            return
        }
        // 从重写错字 / 字详情 / 分享回来（return：网页已播完返回转场，露出的是网页结果页本身）与冷启动恢复：不带转场直接盖上
        let kind: NativeNavKind = !animate || via == "return" || via == "restore" ? .none : via == "write" ? .phase : .push
        let show: () -> Void = { [weak self] in // vc 强引用：旧页收起之后才呈现，局部变量那时已出作用域
            guard let self else { return }
            vc.transitions.under = NativeResultCover.adopt()
            vc.transitions.present(vc, over: self, kind: kind) { NativeResultCover.clear() }
        }
        if let other = presentedViewController {
            (other as? NativeResultViewController)?.exitHandled = true
            (other as? NativeWriteViewController)?.exitHandled = true
            (other as? NativeTransitionPage)?.transitions.finishNow()
            Self.dismissWhenSettled(other, then: show)
        } else {
            show()
        }
    }

    /// 结果条目被移出页面栈（离开 / 再写一组 / 撤销跳过 / 跨天作废等），或为重写错字 / 字详情 / 网页分享弹层让开（away）。
    private func handleResultClose(_ body: [String: Any], slot: String) {
        guard let top = nativeResultTop, top.slot == slot, !top.transitions.isLeaving else { return }
        if let sid = body["sessionId"] as? String, sid != top.sessionId { return }
        let away = (body["away"] as? Bool) == true
        QATrace.note("result:close away=\(away)")
        top.exitHandled = true
        if away {
            // 让开：网页此刻显示网页结果页本身（推入 / 弹层盖在它上面），画好一帧后原生页直接收起
            yield(top, bridge: NativeWriteBridge(webView: webView), what: "result")
        } else {
            // 再写一组 / 撤销跳过：结果页的样子留在原处，新写字页推入盖在它上面（handleWriteOpen 接手）；没有新页接手时淡出
            stepAsideLeavingCover(top)
        }
    }
}

extension WebViewController: NativeResultCoordinating {
    func nativeResultWillNavigate(_ vc: NativeResultViewController) {}

    /// 「×」/ 底栏离开（N3-5）：回来源的转场由页面定（来源是首页且写字页从首页纸展开进来的 = 纸缩回；其余推入倒放 / 安静淡出），放完后发 resultExit leave。
    func nativeResultLeave(_ vc: NativeResultViewController) {
        leave(vc, vc.transitions)
    }
}

/// 有 NativeWriteTransitions 的原生页（写字页、结果页、B2.9a 重写错字页）。
protocol NativeTransitionPage: UIViewController {
    var transitions: NativeWriteTransitions { get }
}

extension NativeWriteViewController: NativeTransitionPage {}
extension NativeResultViewController: NativeTransitionPage {}

extension WebViewController {
    /// 原生页的样子（JPEG data URL，2 倍）：让开时交给宿主层（网页推入 / 左缘滑回时露出）。
    static func snapshotURL(_ v: UIView) -> String? {
        guard v.bounds.width > 0, v.bounds.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = min(2, v.window?.screen.scale ?? 2)
        format.opaque = true
        let image = UIGraphicsImageRenderer(bounds: v.bounds, format: format).image { _ in
            v.drawHierarchy(in: v.bounds, afterScreenUpdates: false)
        }
        guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    /// 页面重新加载（WebContent 进程被回收 / 新文档）：原生页先留在屏上（本地笔画在内存里），等页面就绪后看宿主是否认领。
    func nativePageWillReload() {
        guard Self.nativeWriteEnabled, presentedViewController is NativeTransitionPage else { return }
        NativeNavState.shared.awaitReattach()
    }

    /// 页面就绪：重载前盖着的原生页，若页面在等待时间内没有再发 open / result-open（路由没有恢复出这一页），样子留着、原生页收起、等页面画好再淡出。
    func nativePageDidBecomeReady() {
        guard Self.nativeWriteEnabled, NativeNavState.shared.awaitingReattach else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + NativeNavState.reattachWait) { [weak self] in
            guard let self, NativeNavState.shared.takeUnclaimed(), let page = self.presentedViewController as? NativeTransitionPage else { return }
            (page as? NativeWriteViewController)?.exitHandled = true
            (page as? NativeResultViewController)?.exitHandled = true
            QATrace.note("reload:unclaimed")
            self.stepAsideLeavingCover(page)
        }
    }
}

/// 页面重载 / 宿主交接的等待时间（不是动效：动效时长一律取页面给的 motion.nav）。
final class NativeNavState {
    static let shared = NativeNavState()
    /// 写完最后一字交给结果页：页面没请原生结果页时多久后保底让开。
    static let handoffWait: TimeInterval = 1.0
    /// 返回前向页面问路：最多等这么久，问不到按进来时的计划走。
    static let planWait: TimeInterval = 0.25
    /// 页面重载后等宿主认领的时间。
    static let reattachWait: TimeInterval = 1.5

    private(set) var awaitingReattach = false
    private var heardSinceReload = false

    func awaitReattach() {
        awaitingReattach = true
        heardSinceReload = false
    }

    func heard() {
        heardSinceReload = true
    }

    /// 等待结束：没有认领时为 true（只回答一次）。
    func takeUnclaimed() -> Bool {
        guard awaitingReattach else { return false }
        awaitingReattach = false
        return !heardSinceReload
    }
}

/// 换页时的「旧页样子」（B2.7 / B2.8）：原生页换成另一张原生页 / 让给网页时，先把旧页的截图留在原处，新页盖上（或网页就位）后再收掉，不露出中间的网页层。
enum NativeResultCover {
    private(set) static weak var current: UIView?
    private static var token = 0

    static func cover(_ v: UIView, in host: UIView) {
        clear()
        guard let snap = v.snapshotView(afterScreenUpdates: false) else { return }
        snap.frame = host.bounds
        snap.isUserInteractionEnabled = false
        host.addSubview(snap)
        current = snap
    }

    /// 没有新的原生页接手：留一个 T-phase 时长（紧接着的 open 可以接手压在它上面），再等页面画好一帧，T-fade 原位淡出。
    static func fadeLater(bridge: NativeWriteBridge) {
        guard let snap = current else { return }
        token += 1
        let mine = token
        let fade = (NativeNavMotion.current?.phaseMs ?? 0) / 1000
        DispatchQueue.main.asyncAfter(deadline: .now() + fade) {
            guard current === snap, token == mine else { return }
            bridge.callNav("fence") { _ in
                guard current === snap, token == mine else { return }
                QATrace.note("cover:fade")
                UIView.animate(withDuration: fade, delay: 0, options: [.curveLinear]) { snap.alpha = 0 } completion: { _ in
                    snap.removeFromSuperview()
                    if current === snap { current = nil }
                }
            }
        }
    }

    /// 新的原生页接手旧页的样子（当它的下层；视差画在它上面）：不再淡出，等新页进场放完由 clear 收掉。
    static func adopt() -> UIView? {
        token += 1
        return current
    }

    static func clear() {
        token += 1
        current?.removeFromSuperview()
        current = nil
    }
}

// MARK: - B2.8 转场

/// 交互规范 T0 的转场种类（原生这一侧）：paper = T-paper（B1 纸展开 / 缩回）、push = T-push、quiet = T-quiet（B3）、phase = 同一层换内容的 T-phase 淡化、
/// fade = 减少动态效果的 150ms 淡化、none = 不带转场（冷启动恢复、从网页页面回来）。
enum NativeNavKind: String {
    case paper, push, quiet, phase, fade, none
}

/// 页面给的「这一页怎么进来 / 怎么回去」（paper-transition.js nativePlanShape）：paper 带被点元素的矩形、圆角、字、底色与下层 tab 内容区矩形。
struct NativeNavPlan {
    struct Source {
        var rect: CGRect
        var radius: CGFloat
        var label: String
        var bg: UIColor?
        var fg: UIColor?
        var solid: Bool
        var gone: Bool
    }

    var kind: NativeNavKind
    var source: Source?
    var panel: CGRect?

    init(kind: NativeNavKind) {
        self.kind = kind
    }

    init(_ d: [String: Any]?) {
        let mode = d?["mode"] as? String ?? "push"
        kind = mode == "paper" ? .paper : mode == "quiet" ? .quiet : .push
        if let s = d?["source"] as? [String: Any], let r = Self.rect(s["rect"]) {
            source = Source(rect: r, radius: CGFloat((s["radius"] as? NSNumber)?.doubleValue ?? 0), label: s["label"] as? String ?? "",
                            bg: NativeInkWire.uiColor(s["bg"] as? String), fg: NativeInkWire.uiColor(s["fg"] as? String),
                            solid: (s["solid"] as? Bool) ?? true, gone: (s["gone"] as? Bool) ?? false)
        }
        panel = Self.rect(d?["panel"])
        if kind == .paper, source == nil { kind = .quiet } // 没有来源矩形的纸 = 屏上没有来源元素（B3）
    }

    func with(kind k: NativeNavKind) -> NativeNavPlan {
        var p = self
        p.kind = k == .paper && source == nil ? .quiet : k
        return p
    }

    static func rect(_ any: Any?) -> CGRect? {
        guard let d = any as? [String: Any], let x = (d["x"] as? NSNumber)?.doubleValue, let y = (d["y"] as? NSNumber)?.doubleValue,
              let w = (d["w"] as? NSNumber)?.doubleValue, let h = (d["h"] as? NSNumber)?.doubleValue, w > 0, h > 0 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }
}

/// 缓动曲线（页面给的 cubic-bezier 四个控制点；求值用判断页同一个 NativeBezier.value）。
struct NativeNavEase {
    let p: [Double]

    init(_ any: Any?) {
        let a = (any as? [NSNumber])?.map(\.doubleValue) ?? []
        p = a.count == 4 ? a : []
    }

    func callAsFunction(_ t: Double) -> Double {
        p.count == 4 ? NativeBezier.value(t, p) : min(1, max(0, t))
    }
}

/// 转场参数（open 回包 motion.nav / 结果页 look motion.nav = write-api.js writeNavMotion；src/config/motion.js 与 policy.paperTransition 单一来源，Swift 不写数值）。
struct NativeNavMotion {
    var pushMs = 0.0, pushOutMs = 0.0, pushGestureMinMs = 0.0, pushSnapMs = 0.0, parallax = 0.0
    var pushEase = NativeNavEase(nil)
    var paperOpenMs = 0.0, paperCloseMs = 0.0, paperFullMs = 0.0, paperMinFinishMs = 0.0, paperCancelMs = 0.0
    var paperOpenEase = NativeNavEase(nil), paperCloseEase = NativeNavEase(nil)
    var dragLeanPt = 0.0, dragRadiusPt = 0.0, contentFadeFrom = 0.0, veilTo = 0.0
    var quietOpenMs = 0.0, quietCloseMs = 0.0, quietScaleFrom = 0.0, quietDragPt = 0.0
    var reduceMs = 0.0, phaseMs = 0.0
    /// 页面令牌（纸色、格线色、浮起阴影、按钮字号）：纸的边、来源按钮的字。
    var colors: [String: String] = [:]
    var labelSize: CGFloat = 0

    /// 最近一次 open / result-open 带来的参数；还没有时一律不带转场（直接到终态）。
    static var current: NativeNavMotion?

    static func update(payload: [String: Any]) {
        guard let nav = (payload["motion"] as? [String: Any])?["nav"] as? [String: Any] else { return }
        var m = NativeNavMotion()
        let num: ([String: Any]?, String) -> Double = { d, k in (d?[k] as? NSNumber)?.doubleValue ?? 0 }
        let push = nav["push"] as? [String: Any], paper = nav["paper"] as? [String: Any], quiet = nav["quiet"] as? [String: Any]
        m.pushMs = num(push, "ms"); m.pushOutMs = num(push, "outMs"); m.pushGestureMinMs = num(push, "gestureMinMs"); m.pushSnapMs = num(push, "snapMs")
        m.parallax = num(push, "parallax"); m.pushEase = NativeNavEase(push?["ease"])
        m.paperOpenMs = num(paper, "openMs"); m.paperCloseMs = num(paper, "closeMs"); m.paperFullMs = num(paper, "fullMs")
        m.paperMinFinishMs = num(paper, "minFinishMs"); m.paperCancelMs = num(paper, "cancelMs")
        m.paperOpenEase = NativeNavEase(paper?["openEase"]); m.paperCloseEase = NativeNavEase(paper?["closeEase"])
        m.dragLeanPt = num(paper, "dragLeanPt"); m.dragRadiusPt = num(paper, "dragRadiusPt"); m.contentFadeFrom = num(paper, "contentFadeFrom"); m.veilTo = num(paper, "veilTo")
        m.quietOpenMs = num(quiet, "openMs"); m.quietCloseMs = num(quiet, "closeMs"); m.quietScaleFrom = num(quiet, "scaleFrom"); m.quietDragPt = num(quiet, "dragPt")
        m.reduceMs = num(nav, "reduceMs"); m.phaseMs = num(nav, "phaseMs")
        // QA：-shizi-qa-nav-slow <倍数> 把转场放慢（逐帧截图核对画面用，只在 DEBUG）
        if let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-shizi-qa-nav-slow"), i + 1 < ProcessInfo.processInfo.arguments.count,
           let f = Double(ProcessInfo.processInfo.arguments[i + 1]), f > 0 {
            for kp in [\NativeNavMotion.pushMs, \.pushOutMs, \.pushGestureMinMs, \.pushSnapMs, \.paperOpenMs, \.paperCloseMs, \.paperFullMs, \.paperMinFinishMs,
                       \.paperCancelMs, \.quietOpenMs, \.quietCloseMs, \.reduceMs, \.phaseMs] as [WritableKeyPath<NativeNavMotion, Double>] {
                m[keyPath: kp] *= f
            }
        }
        m.colors = payload["colors"] as? [String: String] ?? current?.colors ?? [:]
        let fs17 = ((payload["type"] as? [String: Any])?["fs17"] as? NSNumber).map { CGFloat($0.doubleValue) }
        m.labelSize = fs17 ?? current?.labelSize ?? UIFont.preferredFont(forTextStyle: .body).pointSize
        current = m
    }

    func color(_ name: String) -> UIColor? { NativeInkWire.uiColor(colors[name]) }
}

/// 原生页的转场：一个对象、一个 frame(s)（s = 1 整屏，0 = 来源按钮 / 屏外 / 透明），点按（进 / 出）与左缘右滑（跟手、松手完成 / 回弹）走同一条路径。
/// 呈现与收起都是 UIKit 不带动画的 present / dismiss，画面由本对象逐帧画（CADisplayLink）——这样纸缩回时被点元素的位置可以中途更新，
/// 落笔 / 点按可以让转场一帧到终态（T0 规则 3，finishNow）。全局计数 running 只允许同一时刻一个在跑（第二个开始时记 overlap，探针核对）。
final class NativeWriteTransitions: NSObject, UIViewControllerTransitioningDelegate {
    /// 正在跑的转场数（探针 / 逐屏取证等它归零）。
    private(set) static var running = 0
    /// 减少动态效果（系统设置；QA 启动参数 -shizi-qa-reduce-motion 可在测试里打开）。
    static var reduceMotion: Bool {
        ProcessInfo.processInfo.arguments.contains("-shizi-qa-reduce-motion") || UIAccessibility.isReduceMotionEnabled
    }

    /// 这一页怎么进来、回去怎么走（页面给的；返回前再问一次）。
    var plan = NativeNavPlan(kind: .push)
    /// 下层：WebViewController 的根视图（推入视差、纸展开时 tab 内容区淡出、安静淡入时下层淡出都画在它上面）。
    weak var host: UIView?
    /// 下层若是一张刚换走的原生页的样子（再写一组：结果页的截图；重写错字：结果页本身），视差画在它上面。
    weak var under: UIView?
    /// 向页面问「回去怎么走」（协调者设置）。
    var planProvider: ((@escaping (NativeNavPlan?) -> Void) -> Void)?
    /// 兼容旧调用：下一次转场用淡化。
    var fadeNext = false
    /// 已经在回去（点按或松手完成）：不再接受第二次返回。
    var isLeaving = false

    private weak var page: UIViewController?
    private var kind: NativeNavKind = .none
    private var s: CGFloat = 1
    private var dragging = false
    private var dragFollows = false
    private var run: Run?
    private var link: CADisplayLink?
    private var settledWaiters: [() -> Void] = []
    private var fx = Effects()

    private struct Run {
        let from: CGFloat
        let to: CGFloat
        let ms: Double
        let ease: (Double) -> Double
        let t0: CFTimeInterval
        let done: () -> Void
    }

    /// 转场里临时加的东西（收尾全部拿掉）。
    private final class Effects {
        var moved: UIView?
        var veil: UIView?
        var panelVeil: UIView?
        var back: UIView?
        var edge: UIView?
        var ink: UIView?
        var label: UILabel?
        var blank: UIView?
        var mask: CALayer?
    }

    /// 已经叫 UIKit 盖上、第一帧还没画（present 的完成回调之前）：页面的 viewDidAppear 在这之间，也算在跑。
    private var presenting = false

    var isRunning: Bool { run != nil || dragging || presenting }

    deinit {
        // 页面在转场中途被收走（被别处卸掉 / 测试直接收起）：计数还回去，显示链接停掉
        link?.invalidate()
        if run != nil { Self.end() }
        if dragging, dragFollows { Self.end() }
    }

    /// 转场放完后调用（没有在跑：立即）。T0 规则 4：页面的时刻（结果页作品显现）等进场转场放完再开始。
    func whenSettled(_ fn: @escaping () -> Void) {
        if isRunning { settledWaiters.append(fn) } else { fn() }
    }

    // MARK: UIKit 兜底（不带转场之外的 present / dismiss(animated: true) 一律淡化）

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeFadeAnimator(presenting: true)
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeFadeAnimator(presenting: false)
    }

    // MARK: 进

    /// 盖上一张原生页并播进场转场（none：直接盖上）。
    func present(_ vc: UIViewController, over presenter: UIViewController, kind requested: NativeNavKind, completion: (() -> Void)? = nil) {
        let k = effective(requested)
        page = vc
        isLeaving = false
        QATrace.note("present:\(k.rawValue)")
        guard k != .none else {
            presenter.present(vc, animated: false) { [weak self] in
                completion?()
                self?.refreshPlan()
            }
            return
        }
        vc.loadViewIfNeeded()
        vc.view.alpha = 0 // 第一帧画好之前不露出整屏
        presenting = true
        presenter.present(vc, animated: false) { [weak self, weak vc] in
            guard let self, let vc else { return }
            self.presenting = false
            self.setup(k, vc)
            let spec = self.openSpec(k)
            self.animate(from: 0, to: 1, ms: spec.ms, ease: spec.ease) { [weak self] in
                self?.teardown()
                completion?()
                self?.refreshPlan()
            }
        }
    }

    // MARK: 出

    /// 播退场转场（按 plan），放完后不带动画收起；收起后页面的 viewDidDisappear 照常发 exit / resultExit。
    func leave(_ vc: UIViewController, completion: (() -> Void)? = nil) {
        guard vc.presentingViewController != nil else { return }
        if run != nil { finishNow() }
        isLeaving = true
        page = vc
        let k = effective(plan.kind)
        QATrace.note("dismiss:\(k.rawValue)")
        guard k != .none, NativeNavMotion.current != nil else {
            vc.dismiss(animated: false, completion: completion)
            return
        }
        setup(k, vc)
        let spec = closeSpec(k)
        animate(from: 1, to: 0, ms: spec.ms, ease: spec.ease) { [weak self, weak vc] in
            guard let vc, vc.presentingViewController != nil else { self?.teardown(); return }
            vc.dismiss(animated: false) {
                self?.teardown()
                completion?()
            }
        }
    }

    /// 左缘右滑（N3：= 点左上）：跟手画同一个 frame(s)，s = 1 − 位移 / 屏宽；松手按 BackGestureThreshold 完成（从此刻接着收，时长按剩余进度）或回弹。
    /// 减少动态效果：不跟手，松手按同一阈值判定，完成后 150ms 淡化。完成后页面收起，viewDidDisappear 发 exit。
    func drag(_ g: UIScreenEdgePanGestureRecognizer, page vc: UIViewController) {
        let space = vc.view.window
        let x = max(0, g.translation(in: space).x), v = g.velocity(in: space).x
        let width = max(1, space?.bounds.width ?? vc.view.bounds.width)
        switch g.state {
        case .began:
            guard vc.presentingViewController != nil, !isLeaving else { return }
            if run != nil { finishNow() }
            page = vc
            dragging = true
            refreshPlan()
            dragFollows = !Self.reduceMotion && NativeNavMotion.current != nil
            guard dragFollows else { return }
            kind = plan.kind
            Self.begin()
            QATrace.note("drag:\(kind.rawValue)")
            setup(kind, vc, counted: true)
            frame(1, drag: true)
        case .changed:
            guard dragging, dragFollows else { return }
            frame(1 - min(1, x / width), drag: true)
        case .ended, .cancelled, .failed:
            guard dragging else { return }
            dragging = false
            let commit = g.state == .ended && BackGestureThreshold.commits(distance: x, velocity: v, width: width)
            guard dragFollows else {
                if commit { leave(vc) }
                return
            }
            Self.end()
            if commit {
                isLeaving = true
                QATrace.note("dismiss:\(kind.rawValue):interactive")
                let spec = finishSpec(kind, from: s)
                animate(from: s, to: 0, ms: spec.ms, ease: spec.ease) { [weak self, weak vc] in
                    guard let vc, vc.presentingViewController != nil else { self?.teardown(); return }
                    vc.dismiss(animated: false) { self?.teardown() }
                }
            } else {
                let spec = cancelSpec(kind)
                animate(from: s, to: 1, ms: spec.ms, ease: spec.ease) { [weak self] in self?.teardown() }
            }
        default:
            break
        }
    }

    /// T0 规则 3：转场进行中落笔 / 点按——剩余动画一帧到终态，这次输入照常生效（跟手中不动）。
    func finishNow() {
        guard let r = run else { return }
        frame(r.to)
        complete()
    }

    // MARK: 内部

    private func effective(_ k: NativeNavKind) -> NativeNavKind {
        defer { fadeNext = false }
        if k == .none || NativeNavMotion.current == nil { return .none }
        if Self.reduceMotion || fadeNext { return .fade }
        return k
    }

    private func refreshPlan() {
        planProvider? { [weak self] p in
            guard let self, let p else { return }
            // 跟手中只更新来源矩形（纸缩回的落点），不换种类
            if self.dragging || self.run != nil {
                if p.kind == self.plan.kind { self.plan.source = p.source ?? self.plan.source; self.plan.panel = p.panel ?? self.plan.panel }
            } else {
                self.plan = p
            }
        }
    }

    private static func begin() {
        running += 1
        if running > 1 { QATrace.note("overlap") }
    }

    private static func end() {
        running = max(0, running - 1)
    }

    private func animate(from: CGFloat, to: CGFloat, ms: Double, ease: @escaping (Double) -> Double, done: @escaping () -> Void) {
        cancelRun()
        Self.begin()
        run = Run(from: from, to: to, ms: ms, ease: ease, t0: CACurrentMediaTime(), done: done)
        frame(from, drag: dragFollows)
        let l = CADisplayLink(target: NativeLinkProxy(self), selector: #selector(NativeLinkProxy.tick(_:)))
        l.add(to: .main, forMode: .common)
        link = l
    }

    fileprivate func tick() {
        guard let r = run else { return }
        let u = r.ms <= 0 ? 1 : min(1, (CACurrentMediaTime() - r.t0) * 1000 / r.ms)
        frame(r.from + (r.to - r.from) * CGFloat(r.ease(u)), drag: dragFollows)
        if u >= 1 { complete() }
    }

    private func complete() {
        guard let r = run else { return }
        link?.invalidate()
        link = nil
        run = nil
        dragFollows = false
        Self.end()
        r.done()
        if !isRunning {
            let w = settledWaiters
            settledWaiters = []
            w.forEach { $0() }
        }
    }

    private func cancelRun() {
        guard run != nil else { return }
        link?.invalidate()
        link = nil
        run = nil
        Self.end()
    }

    private typealias Spec = (ms: Double, ease: (Double) -> Double)
    private static let linear: (Double) -> Double = { min(1, max(0, $0)) }

    private func openSpec(_ k: NativeNavKind) -> Spec {
        guard let m = NativeNavMotion.current else { return (0, Self.linear) }
        switch k {
        case .push: return (m.pushMs, m.pushEase.callAsFunction)
        case .paper: return (m.paperOpenMs, m.paperOpenEase.callAsFunction)
        case .quiet: return (m.quietOpenMs, Self.linear)
        case .phase: return (m.phaseMs, Self.linear)
        case .fade: return (m.reduceMs, Self.linear)
        case .none: return (0, Self.linear)
        }
    }

    private func closeSpec(_ k: NativeNavKind) -> Spec {
        guard let m = NativeNavMotion.current else { return (0, Self.linear) }
        switch k {
        case .push: return (m.pushOutMs, m.pushEase.callAsFunction)
        case .paper: return (m.paperCloseMs, m.paperCloseEase.callAsFunction)
        case .quiet: return (m.quietCloseMs, Self.linear)
        case .phase: return (m.phaseMs, Self.linear)
        case .fade: return (m.reduceMs, Self.linear)
        case .none: return (0, Self.linear)
        }
    }

    /// 松手完成：从此刻的 s 接着收（推入：按剩余距离缩短、不短于 gestureMin；纸：fullMs × s、不短于 minFinish；安静：退出时长）。
    private func finishSpec(_ k: NativeNavKind, from s: CGFloat) -> Spec {
        guard let m = NativeNavMotion.current else { return (0, Self.linear) }
        switch k {
        case .push: return (max(m.pushGestureMinMs, m.pushOutMs * Double(s)), m.pushEase.callAsFunction)
        case .paper: return (max(m.paperMinFinishMs, m.paperFullMs * Double(s)), m.paperCloseEase.callAsFunction)
        case .quiet: return (m.quietCloseMs, Self.linear)
        default: return closeSpec(k)
        }
    }

    /// 松手取消：回弹到整屏（推入：gestureSnap；纸 / 安静：cancel，退出曲线）。
    private func cancelSpec(_ k: NativeNavKind) -> Spec {
        guard let m = NativeNavMotion.current else { return (0, Self.linear) }
        switch k {
        case .push: return (m.pushSnapMs, m.pushEase.callAsFunction)
        default: return (m.paperCancelMs, m.paperCloseEase.callAsFunction)
        }
    }

    /// 准备这次转场要的临时视图（counted：跟手开始时已经计过数）。
    private func setup(_ k: NativeNavKind, _ vc: UIViewController, counted: Bool = false) {
        teardown()
        kind = k
        page = vc
        let v = vc.view!
        let m = NativeNavMotion.current
        let paperColor = host?.backgroundColor ?? v.backgroundColor ?? .systemBackground
        switch k {
        case .push:
            fx.moved = under ?? host
            v.layer.shadowColor = UIColor.black.cgColor
            v.layer.shadowRadius = 12
            v.layer.shadowOffset = CGSize(width: -4, height: 0)
            v.layer.shadowOpacity = 0.12
        case .quiet:
            if let host {
                let veil = UIView(frame: host.bounds)
                veil.backgroundColor = paperColor
                veil.isUserInteractionEnabled = false
                host.addSubview(veil)
                fx.veil = veil
            }
        case .paper:
            guard let src = plan.source, let container = v.superview else { kind = .quiet; setup(.quiet, vc, counted: counted); return }
            let line = m?.color("line") ?? .separator
            let back = UIView()
            back.backgroundColor = v.backgroundColor ?? paperColor
            back.isUserInteractionEnabled = false
            if let sh = NativeInkWire.shadow(m?.colors["toast-shadow"]) {
                back.layer.shadowColor = sh.color.cgColor
                back.layer.shadowOpacity = 1
                back.layer.shadowRadius = sh.blur / 2
                back.layer.shadowOffset = CGSize(width: sh.dx, height: sh.dy)
            }
            container.insertSubview(back, belowSubview: v)
            fx.back = back
            let edge = UIView()
            edge.backgroundColor = .clear
            edge.isUserInteractionEnabled = false
            edge.layer.borderColor = line.cgColor
            edge.layer.borderWidth = 1
            container.addSubview(edge)
            fx.edge = edge
            let blank = UIView(frame: v.bounds)
            blank.backgroundColor = v.backgroundColor ?? paperColor
            blank.isUserInteractionEnabled = false
            v.addSubview(blank)
            fx.blank = blank
            let mask = CALayer()
            mask.backgroundColor = UIColor.black.cgColor
            v.layer.mask = mask
            fx.mask = mask
            if src.solid, !src.gone {
                let ink = UIView()
                ink.backgroundColor = src.bg ?? m?.color("btn-bg")
                ink.isUserInteractionEnabled = false
                ink.clipsToBounds = true
                let label = UILabel()
                label.text = src.label
                label.textAlignment = .center
                label.textColor = src.fg ?? m?.color("btn-fg")
                label.font = .systemFont(ofSize: m?.labelSize ?? UIFont.labelFontSize, weight: .medium)
                ink.addSubview(label)
                container.addSubview(ink)
                fx.ink = ink
                fx.label = label
            }
            if let panel = plan.panel, let host {
                let pv = UIView(frame: panel)
                pv.backgroundColor = paperColor
                pv.isUserInteractionEnabled = false
                host.addSubview(pv)
                fx.panelVeil = pv
            }
        case .phase, .fade, .none:
            break
        }
        v.alpha = 1
    }

    /// 画一帧（s：1 = 整屏，0 = 来源 / 屏外 / 透明；drag = 跟手中）。网页 paper-transition.js createPaper 的 apply 与 root.js 推入 / B3 的同一套几何。
    private func frame(_ sIn: CGFloat, drag: Bool = false) {
        guard let v = page?.view, let m = NativeNavMotion.current else { return }
        let s = min(1, max(0, sIn))
        self.s = s
        let W = v.superview?.bounds.width ?? v.bounds.width
        let H = v.superview?.bounds.height ?? v.bounds.height
        let clamp: (CGFloat) -> CGFloat = { min(1, max(0, $0)) }
        switch kind {
        case .push:
            v.transform = CGAffineTransform(translationX: (1 - s) * W, y: 0)
            fx.moved?.transform = CGAffineTransform(translationX: -CGFloat(m.parallax) * W * s, y: 0)
        case .quiet:
            let u = clamp((s - 0.4) / 0.6)
            v.alpha = u
            let scale = CGFloat(m.quietScaleFrom) + (1 - CGFloat(m.quietScaleFrom)) * CGFloat(m.paperCloseEase(Double(u)))
            v.transform = CGAffineTransform(translationX: drag ? (1 - s) * CGFloat(m.quietDragPt) : 0, y: 0).scaledBy(x: scale, y: scale)
            fx.veil?.alpha = clamp(s / 0.4)
        case .paper:
            guard let src = plan.source else { return }
            let B = host.map { $0.convert(src.rect, to: v.superview) } ?? src.rect
            let e = 1 - s
            let lean = drag ? sin(.pi * e) * CGFloat(m.dragLeanPt) : 0
            let x = B.minX * e + lean, y = B.minY * e
            let w = W + (B.width - W) * e, h = H + (B.height - H) * e
            let r0 = src.radius, rd = CGFloat(m.dragRadiusPt)
            let r = e < 0.0005 ? 0 : drag ? rd + (r0 - rd) * e : r0 * e + rd * sin(.pi * e) * 0.5
            let k = max(0.0001, w / W)
            v.transform = CGAffineTransform(a: k, b: 0, c: 0, d: k, tx: x - W / 2 * (1 - k), ty: y - H / 2 * (1 - k))
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            fx.mask?.frame = CGRect(x: 0, y: 0, width: W, height: h / k)
            fx.mask?.cornerRadius = r / k
            CATransaction.commit()
            let box = CGRect(x: x, y: y, width: w, height: h)
            let veil = !src.solid || src.gone
            let lift = clamp(e / 0.12) * (1 - clamp((e - 0.8) / 0.2))
            for d in [fx.back, fx.edge] {
                d?.frame = box
                d?.layer.cornerRadius = r
            }
            fx.edge?.isHidden = e < 0.0005 || (veil && e > 0.8)
            fx.back?.layer.shadowOpacity = lift > 0.02 ? Float(lift) : 0
            let paperAlpha = veil ? clamp(s / CGFloat(m.veilTo)) : 1
            v.alpha = paperAlpha
            fx.back?.alpha = paperAlpha
            fx.edge?.alpha = paperAlpha
            fx.blank?.alpha = 1 - clamp((s - CGFloat(m.contentFadeFrom)) / (1 - CGFloat(m.contentFadeFrom)))
            if let ink = fx.ink, let label = fx.label {
                ink.frame = box
                ink.layer.cornerRadius = r
                ink.alpha = clamp((e - 0.8) / 0.2)
                label.text = src.label
                label.frame = ink.bounds
                label.alpha = clamp((e - 0.9) / 0.1)
            }
            fx.panelVeil?.alpha = clamp((s - 0.2) / 0.5)
        case .phase, .fade:
            v.alpha = s
        case .none:
            break
        }
    }

    /// 收尾：拿掉临时视图，页面与下层回到原样。
    private func teardown() {
        if let v = page?.view {
            v.transform = .identity
            v.alpha = 1
            v.layer.mask = nil
            v.layer.shadowOpacity = 0
        }
        fx.moved?.transform = .identity
        [fx.veil, fx.panelVeil, fx.back, fx.edge, fx.ink, fx.blank].forEach { $0?.removeFromSuperview() }
        fx = Effects()
    }
}

/// CADisplayLink 的弱引用目标（不让显示链接留住转场对象）。
private final class NativeLinkProxy: NSObject {
    weak var owner: NativeWriteTransitions?

    init(_ owner: NativeWriteTransitions) {
        self.owner = owner
    }

    @objc func tick(_ link: CADisplayLink) {
        guard let owner else { link.invalidate(); return }
        owner.tick()
    }
}

/// UIKit 兜底转场（只有不经 NativeWriteTransitions 的 present / dismiss(animated: true) 会用到）：减少动态效果的淡化时长。
final class NativeFadeAnimator: NSObject, UIViewControllerAnimatedTransitioning {
    let presenting: Bool

    init(presenting: Bool) {
        self.presenting = presenting
    }

    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval {
        (NativeNavMotion.current?.reduceMs ?? 0) / 1000
    }

    func animateTransition(using ctx: UIViewControllerContextTransitioning) {
        let key: UITransitionContextViewKey = presenting ? .to : .from
        guard let v = ctx.view(forKey: key) else { ctx.completeTransition(false); return }
        if presenting {
            v.frame = ctx.containerView.bounds
            ctx.containerView.addSubview(v)
        }
        v.alpha = presenting ? 0 : 1
        UIView.animate(withDuration: transitionDuration(using: ctx), delay: 0, options: [.curveLinear]) {
            v.alpha = self.presenting ? 1 : 0
        } completion: { _ in
            v.alpha = 1
            ctx.completeTransition(!ctx.transitionWasCancelled)
        }
    }
}
// MARK: - B2.9a 原生重写错字页（B2.8：转场换进 NativeWriteTransitions）

extension WebViewController {
    /// 页面重写错字宿主条目（NativeRedoHost）的消息：redo-open = 原生重写错字页 T-push 推入（结果页的样子留在下面做视差，推入完收掉）；
    /// 回去（「完成」/「‹」/ 左缘右滑）= 同一个对象 T-push 倒放（露出网页结果页本身），收起后发 redoExit → 页面 nav.back，
    /// 结果条目等网页空闲后 result-open via 'return' 不带转场换回原生——只有一段转场。
    /// redo-close = 条目被别处卸掉（深链 / store 整体替换）：原生页的样子留在原处、原生页收起，不发 redoExit，等页面画好淡出。
    func handleRedoMessage(_ op: String, _ body: [String: Any]) {
        if op == "redo-close" {
            if let top = nativeRedoTop, !top.exitHandled, !top.transitions.isLeaving {
                top.exitHandled = true
                QATrace.note("close")
                stepAsideLeavingCover(top)
            }
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, payload["snapshot"] is [String: Any] else {
            NSLog("[shizi] native-redo open without chars")
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: payload)
        if let top = nativeRedoTop, !top.exitHandled {
            top.resync(payload: payload) // 页面重载后同一条目再发：只换外观，第几个字留在原生
            return
        }
        let vc = NativeWriteViewController(slot: "redo", payload: payload, bridge: NativeWriteBridge(webView: webView), redo: true)
        vc.coordinator = self
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.transitions
        let animate = body["animate"] as? Bool ?? true
        let via = body["via"] as? String ?? ""
        QATrace.note("redo:open via=\(via) animate=\(animate)")
        let kind: NativeNavKind = !animate || via == "restore" ? .none : .push
        prepareTransitions(vc.transitions, plan: NativeNavPlan(kind: .push))
        let show: () -> Void = { [weak self] in
            guard let self else { return }
            vc.transitions.under = NativeResultCover.adopt()
            vc.transitions.present(vc, over: self, kind: kind) { NativeResultCover.clear() }
        }
        if let other = presentedViewController {
            // 结果页「重写错字」：结果页的样子留在原处当下层，重写错字页推入盖在它上面（结果页的让开不再另起转场）
            (other as? NativeWriteViewController)?.exitHandled = true
            (other as? NativeResultViewController)?.exitHandled = true
            (other as? NativeTransitionPage)?.transitions.finishNow()
            if NativeResultCover.current == nil { NativeResultCover.cover(other.view, in: view) }
            Self.dismissWhenSettled(other, then: show)
        } else {
            show()
        }
    }
}
#endif
