import QuartzCore
import UIKit

// ShiziKit（B3.1）：原生页转场（B2.8 NativeWriteTransitions，原在 NativeWriteCoordinator.swift）。
// B3.2（计划 §3.3）：推广为全部原生页的转场对象——T-push（下层视差：网页根视图，或下面那张原生页）、T-paper（来源矩形由 open.plan 带来）、
// T-quiet、减少动态效果 150ms 淡化；时长 / 曲线取生成的 motion 令牌（NativeNavMotion.ensure）。原生 ↔ 网页之间的转场由「上面那一层」播：
// 网页页面盖住原生页时原生先截图留在宿主层再让开（NativeStage.yieldToWeb / B2 nativeWriteOpenDetail）。类名 B3.F 前统一改名（ShiziTransitions）。

/// 有 NativeWriteTransitions 的原生页（写字页、结果页、B2.9a 重写错字页）。
protocol NativeTransitionPage: UIViewController {
    var transitions: NativeWriteTransitions { get }
}

extension NativeWriteViewController: NativeTransitionPage {}
extension NativeResultViewController: NativeTransitionPage {}

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

    /// B3.2：通用原生屏（NativeStage）没有 open 回包里的 motion——还没有参数时取 ShiziKit 生成值（= 写字页回包 motion.nav 同一份）。
    static func ensure() {
        guard current == nil else { return }
        update(payload: [:])
    }

    static func update(payload raw: [String: Any]) {
        // B3.1：转场时长 / 曲线、纸边颜色、按钮字号取 ShiziKit 生成值（结果页 look 的 motion 带 result 一组）
        let payload = ShiziLook.resolve(raw, page: (raw["motion"] as? [String: Any])?["result"] != nil ? .result : .write)
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
        // QA：-shizi-qa-nav-slow <倍数> 把转场放慢（逐帧截图核对画面用，只在 DEBUG；ShiziProbe）
        if let f = ShiziProbe.navSlowFactor {
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
        ShiziProbe.forceReduceMotion || UIAccessibility.isReduceMotionEnabled
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
    /// B3.2 量测：进场转场画出第一帧时调用一次（点按 → 转场第一帧，NativeStage.recordLatency）。
    var onFirstFrame: (() -> Void)?

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
        ShiziProbe.note("present:\(k.rawValue)")
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
        ShiziProbe.note("dismiss:\(k.rawValue)")
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
            ShiziProbe.note("drag:\(kind.rawValue)")
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
                ShiziProbe.note("dismiss:\(kind.rawValue):interactive")
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
        if running > 1 { ShiziProbe.note("overlap") }
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
        if let f = onFirstFrame {
            onFirstFrame = nil
            f()
        }
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
