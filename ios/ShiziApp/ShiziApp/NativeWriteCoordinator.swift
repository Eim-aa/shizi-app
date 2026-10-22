import UIKit
import WebKit

// 原生写字页的导航协调（B2.0；docs/engineering/v10/B2-原生写字架构.md §4；B2.8 转场整合 §23）。
//
// 开关：启动参数 -shizi-native-write（或 SHIZI_NATIVE_WRITE=1），默认关（B3.1 起 Release 也编进来、同一个开关；B3.F 去掉开关）。开着时：
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
    /// 带 `-shizi-native-write-off` 启动一次即关闭。B3.1 起 Release 同样有这一套（默认关；TestFlight / App Store 安装带不了启动参数，所以那里一直是网页版），B3.F 去掉。
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
            ShiziProbe.note("close")
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
            ShiziProbe.log("native-write open without an active session (slot \(slot))")
            // 宿主还在、组已经没了（重载后恢复出的写字条目，组已作废）：盖着的同槽原生页收起，不留一张写不了的页
            if let top = nativeWriteTop, top.slot == slot, !top.exitHandled, !top.redo {
                top.exitHandled = true
                ShiziProbe.note("close")
                stepAsideLeavingCover(top)
            }
            return
        }
        NativeNavState.shared.heard()
        NativeNavMotion.update(payload: payload)
        #if DEBUG
        NativeWriteMetrics.shared.recordJs("open", ms: (payload["ms"] as? NSNumber)?.doubleValue ?? 0)
        #endif
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
        ShiziProbe.note("open via=\(via) animate=\(animate)") // QA-H1 测试钩子：转场核对（NF-01）
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
        ShiziProbe.note("yield:\(what)")
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
            ShiziProbe.log("native-result open without a group (slot \(slot))")
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
        ShiziProbe.note("result:open via=\(via) animate=\(animate)")
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
        ShiziProbe.note("result:close away=\(away)")
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
            ShiziProbe.note("reload:unclaimed")
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
                ShiziProbe.note("cover:fade")
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
                ShiziProbe.note("close")
                stepAsideLeavingCover(top)
            }
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        guard (payload["ok"] as? Bool) == true, payload["snapshot"] is [String: Any] else {
            ShiziProbe.log("native-redo open without chars")
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
        ShiziProbe.note("redo:open via=\(via) animate=\(animate)")
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
