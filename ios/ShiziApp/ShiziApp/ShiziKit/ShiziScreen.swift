import UIKit

// ShiziKit（B3.2）：B3 原生页面的底座（计划 §3.2 ShiziPage / §3.3 段 1）。
//
// 每张原生页 = ShiziScreenViewController 的一个子类，ObjC 名按约定 `ShiziScreen_<屏名，- 换 _>`（@objc(ShiziScreen_about_privacy)）。
// NativeStage 用 NSClassFromString 找类（不设共享登记表）：页面卡只新增自己的 Swift 文件，并在自己的 JS 屏文件里给 registerScreen 加 native:true。
// 页面不持有业务状态：open 回包（view.<屏名>，宿主挂载时随消息带来，首帧不等桥）、changed 推送或引擎重新就绪时重拉同一个 view op。
//
// 页面骨架 = 网页 components/Page.js：44 页头（左「‹」图标按钮外缘对页边线、中间标题 17 / 500、右槽）+ 竖向滚动的正文（上 s4、左右页边、下 s8）。
// 颜色 / 字号 / 间距 / 时长一律取 ShiziTokens（构建期从 tokens.json / tokens.css 生成），文案取 ShiziCopy；本文件不写数值与汉字。

/// 当前系统字号档位的长度令牌（pt；= 网页 --名 在该档位的计算值）与字体（系统字体，中文接苹方 UI 正文款 = NativeType.compose）。
struct ShiziMetrics {
    let category: UIContentSizeCategory
    private let values: [String: CGFloat]

    init(_ category: UIContentSizeCategory = UIApplication.shared.preferredContentSizeCategory) {
        self.category = category
        values = ShiziTokens.lengths(category) ?? ShiziTokens.lengths(.large) ?? [:]
    }

    func value(_ name: String) -> CGFloat { values[name] ?? 0 }
    /// 行高（WebKit 把小数行高取整到整 pt，同 NativeType.line）。
    func line(_ name: String) -> CGFloat { floor(value(name)) }
    func font(_ base: Int, _ weight: UIFont.Weight = .regular) -> UIFont { NativeType.compose(size: value("fs\(base)"), weight: weight) }

    var gutter: CGFloat { value("gutter") }
    var groupGap: CGFloat { value("group-gap") }
    var hit: CGFloat { value("hit") }
    func space(_ n: Int) -> CGFloat { value("s\(n)") }
}

enum ShiziFonts {
    /// 楷（ShiziKai，网页 --kai；包里 Web/fonts 的 woff2，CoreText 直接读，同 NativeType.song）。读不到时退回系统字体。
    static func kai(size: CGFloat) -> UIFont {
        if kaiDescriptor == nil, let url = Bundle.main.url(forResource: "Web", withExtension: nil)?.appendingPathComponent("fonts/ShiziKai-Regular.woff2"),
           let data = try? Data(contentsOf: url), let d = CTFontManagerCreateFontDescriptorFromData(data as CFData) {
            kaiDescriptor = d
        }
        guard let d = kaiDescriptor else { return .systemFont(ofSize: size) }
        return CTFontCreateWithFontDescriptor(d, size, nil) as UIFont
    }

    private static var kaiDescriptor: CTFontDescriptor?

    /// 宋 / 楷的字不补苹方的字距（NativeType.set 按苹方 UI 的 trak 表给中文补字距，只对系统字体对；网页宋 / 楷没有这一步）。
    static func untrack(_ l: UILabel) {
        guard let a = l.attributedText, a.length > 0 else { return }
        let m = NSMutableAttributedString(attributedString: a)
        m.addAttribute(.kern, value: 0, range: NSRange(location: 0, length: m.length))
        l.attributedText = m
    }
}

/// 列表行按钮（网页「名称 …… 值 ›」行，button 里是两段字 + 可选 chevron）：标题不用按钮自己的 titleLabel，用两个标签；
/// 按钮自身的字号 / 颜色是网页按钮元素继承来的那一份（正文 15、行色），chevron 是按钮图像（与网页 svg 同为按钮的图标）。
final class ShiziRowButton: UIButton {
    let label = UILabel()
    let valueLabel = UILabel()
    /// chevron 的尺寸（网页 .sz-chev 8 × 13）。
    var chevronSize = CGSize.zero
    /// chevron 的框（按钮坐标）；nil = 钉在右缘竖向居中（网页 justify-content:space-between 的行）。
    /// 网页把 › 跟在值后面（inline-flex，AX 档值折到第二行时 › 紧跟在值的右边）时由页面给出。
    var chevronFrame: CGRect? { didSet { setNeedsLayout() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        for l in [label, valueLabel] {
            l.isUserInteractionEnabled = false
            l.isAccessibilityElement = false
            addSubview(l)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func imageRect(forContentRect r: CGRect) -> CGRect {
        guard chevronSize.width > 0 else { return .zero }
        if let f = chevronFrame { return f }
        return CGRect(x: bounds.maxX - chevronSize.width, y: (bounds.height - chevronSize.height) / 2, width: chevronSize.width, height: chevronSize.height)
    }

    override func titleRect(forContentRect r: CGRect) -> CGRect { .zero }

    /// 行里两段字的并集（QA 取证：网页按钮的文字框 = 按钮里全部文字节点的并集）。
    var composedText: String { [label.text, valueLabel.isHidden ? nil : valueLabel.text].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
}

/// 网页 Chevron.js（icons.js chevron：8 × 13 的线形箭头，线宽 1.5、圆端圆角）。
enum ShiziChevron {
    static func image(_ color: UIColor, size: CGSize) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            let p = UIBezierPath()
            let sx = size.width / 8, sy = size.height / 13
            p.move(to: CGPoint(x: 1.5 * sx, y: 1.5 * sy))
            p.addLine(to: CGPoint(x: 6.5 * sx, y: 6.5 * sy))
            p.addLine(to: CGPoint(x: 1.5 * sx, y: 11.5 * sy))
            p.lineWidth = 1.5
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            color.setStroke()
            p.stroke()
        }.withRenderingMode(.alwaysOriginal)
    }
}

/// 原生页的根视图（子类自定义根视图时继承它）：被盖住的页（NativeStage.isCovered：根页上推入 / 呈现了别的页或弹层、原生栈里的下层页）
/// 整页不进无障碍树——读屏摸不到、也划不到盖在下面的东西（R14：`.overFullScreen` 呈现时下层视图留在窗口里，系统不替它藏）。
/// 按此刻的栈动态判断，不在每条呈现 / 收起路径上逐个设置。R16：读屏口径 = NativeStage.isHiddenFromAccessibility（上面有任何模态层——
/// 透明的查字 / S02、选择弹层、底部弹层——也藏）；QA-H1 取证仍按 isCovered 的不透明口径（D75 ②）。
class ShiziScreenView: UIView {
    weak var page: ShiziScreenViewController?

    override var accessibilityElementsHidden: Bool {
        get { super.accessibilityElementsHidden || (page.flatMap { p in p.stage.map { $0.isHiddenFromAccessibility(p) } } ?? false) }
        set { super.accessibilityElementsHidden = newValue }
    }
}

/// B3 原生页的基类。子类实现 render(view:)（解自己的 Codable 视图）与 layoutBody(width:x:top:)（排正文、返回正文底）。
class ShiziScreenViewController: UIViewController, NativeTransitionPage, UIGestureRecognizerDelegate {
    let screen: String
    /// 网页路由里这一页的条目 id（页面重载后重新认领时可能换新 id）。
    var entryId: String
    private(set) var params: [String: Any]
    weak var stage: NativeStage?
    let transitions = NativeWriteTransitions()
    /// 已交给 NativeStage / 网页导航（自己返回、被别处卸掉）：之后的 viewDidDisappear 不再发 nav.back。
    var exitHandled = false
    /// 进来时的转场种类（返回时倒放同一种；冷启动恢复 / 从网页页面回来进来的按推入倒放）。
    var enteredKind: NativeNavKind = .push

    // 页面骨架（成员名是 QA 取证的语义键：backButton ↔ 网页 page-back）
    let backButton = UIButton(type: .custom)
    let titleLabel = UILabel()
    let scroll = UIScrollView()
    let content = UIView()
    /// 整页的框（网页 Page 根元素 <屏名>-screen；透明、不接触摸，只给 QA 取证按语义键比位置）。
    let screenMarker = UIView()
    private let edgeBack = UIScreenEdgePanGestureRecognizer()

    private var stateChangedAt: CFTimeInterval = -.infinity
    private var lastPress: [ObjectIdentifier: CFTimeInterval] = [:]
    private var statusOff: (() -> Void)?
    private var changesTask: Task<Void, Never>?
    /// 最近一次视图回包（重拉失败时保留旧的）。
    private(set) var lastView: Any?

    var metrics = ShiziMetrics()

    required init(screen: String, entryId: String, params: [String: Any]) {
        self.screen = screen
        self.entryId = entryId
        self.params = params
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        transitioningDelegate = transitions
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        statusOff?()
        changesTask?.cancel()
    }

    // MARK: 令牌

    func color(_ name: String) -> UIColor { ShiziTokens.dynamicColor(name) ?? .label }
    func t(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String { ShiziCopy.t(key, vars) }

    // MARK: 子类实现

    /// 解视图（open 回包 / 重拉的 view）并更新子视图的字与状态；不排版（排版在 layoutBody）。
    func render(view: Any) throws {}
    /// 排正文（content 坐标；x = 页边，top = 正文上内边距），返回最后一个元素的底。
    func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat { top }
    /// 这一页关心的域（changed 推送带到其中之一时重拉视图）；nil = 任何变化都重拉。
    var watchedDomains: [String]? { nil }

    // MARK: 视图数据

    /// open 回包（{ok, view}）。回包失败时保留现状（页面重载后认领、changed 重拉失败都一样）。
    func apply(payload: [String: Any]) {
        guard (payload["ok"] as? Bool) == true, let v = payload["view"] else {
            ShiziProbe.log("native screen \(screen): open without a view (\((payload["error"] as? [String: Any])?["kind"] ?? "?"))")
            return
        }
        lastView = v
        if isViewLoaded { renderNow() }
    }

    func update(params next: [String: Any]) { params = next }

    private func renderNow() {
        guard let v = lastView else { return }
        traitCollection.performAsCurrent {
            do {
                try render(view: v)
            } catch {
                ShiziProbe.log("native screen \(screen): view does not decode: \(error)")
            }
        }
        view.setNeedsLayout()
    }

    /// 重拉 view.<屏名>（changed 推送、引擎重新就绪）。
    func reload() {
        guard let engine = stage?.engine else { return }
        let screen = self.screen, params = self.params
        Task { @MainActor [weak self] in
            let body = await engine.raw("view.\(screen)", params)
            self?.apply(payload: body)
        }
    }

    // MARK: 生命周期

    override func loadView() {
        let v = ShiziScreenView()
        v.backgroundColor = color("paper")
        view = v
    }

    override func viewDidLoad() {
        (view as? ShiziScreenView)?.page = self
        super.viewDidLoad()
        backButton.accessibilityIdentifier = "native-page-back"
        backButton.accessibilityLabel = t("X-COMMON.back")
        backButton.addAction(UIAction { [weak self] _ in self?.requestBack() }, for: .touchUpInside)
        view.addSubview(backButton)
        titleLabel.isAccessibilityElement = true
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-page-title"
        titleLabel.lineBreakMode = .byTruncatingTail
        view.addSubview(titleLabel)
        scroll.alwaysBounceVertical = true
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.delaysContentTouches = false
        scroll.addSubview(content)
        view.insertSubview(scroll, at: 0)
        screenMarker.isUserInteractionEnabled = false
        screenMarker.accessibilityIdentifier = "native-\(screen)-screen"
        view.insertSubview(screenMarker, at: 0)
        edgeBack.edges = .left
        edgeBack.delegate = self
        edgeBack.addTarget(self, action: #selector(handleEdgeBack(_:)))
        view.addGestureRecognizer(edgeBack)
        styleChrome()
        renderNow()
        if let engine = stage?.engine {
            statusOff = engine.observeStatus { [weak self] s in self?.engineStatusChanged(s) }
            engineStatusChanged(engine.status)
            let stream = engine.changes
            changesTask = Task { @MainActor [weak self] in
                for await set in stream {
                    guard let self else { return }
                    if let watched = self.watchedDomains, !set.touches(watched) { continue }
                    self.reload()
                }
            }
        }
    }

    private func styleChrome() {
        traitCollection.performAsCurrent { styleChromeNow() }
    }

    private func styleChromeNow() {
        let ink1 = color("ink1")
        backButton.setImage(NativeWriteIcon.back.image(ink1), for: .normal)
        backButton.setTitleColor(ink1, for: .normal)
        backButton.titleLabel?.font = metrics.font(15)
        view.backgroundColor = color("paper")
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        let sizeChanged = previous?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory
        if sizeChanged { metrics = ShiziMetrics(UIApplication.shared.preferredContentSizeCategory) }
        if sizeChanged || previous?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            styleChrome()
            renderNow()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        markStateChange()
        NativeA11y.screenChanged(titleLabel)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isBeingDismissed || presentingViewController == nil else { return }
        if !exitHandled {
            exitHandled = true
            stage?.screenDidLeave(self)
        }
    }

    override func accessibilityPerformEscape() -> Bool {
        requestBack()
        return true
    }

    // MARK: 排版

    /// 页头标题（网页 .sz-page__title：两槽之间居中，17 / 500，单行省略）。
    func setTitle(_ text: String) {
        titleText = text
        if axLayout {
            // AX 档（components/ax.js）：标题单独占页头第二行，左对齐、可折行、行高 lh17
            titleLabel.numberOfLines = 0
            NativeType.set(titleLabel, text, font: metrics.font(17, .medium), color: color("ink1"), line: metrics.line("lh17"))
        } else {
            titleLabel.numberOfLines = 1
            NativeType.set(titleLabel, text, font: metrics.font(17, .medium), color: color("ink1"), align: .center)
        }
        titleLabel.accessibilityLabel = text
    }

    private var titleText = ""
    /// 系统字号在 AX1–AX5（网页 :root[data-ax] 的版式：components/ax.js）。
    var axLayout: Bool { metrics.category.isAccessibilityCategory }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width, h = view.bounds.height
        guard w > 0 else { return }
        screenMarker.frame = view.bounds
        let m = metrics
        let safeTop = view.safeAreaInsets.top
        let gutter = m.gutter
        backButton.frame = ShiziPageHeader.leadFrame(.back, gutter: gutter, y: safeTop)
        let left = ShiziPageHeader.centerLeft(gutter: gutter)
        var top = safeTop + ShiziPageHeader.height
        if axLayout {
            // 页头折成两行：第一行「‹」，第二行标题（外边距 s2 + 内边距 8、下内边距 6，text-wrap:pretty）
            let inset = m.space(2) + 8
            let tw = max(0, w - 2 * gutter - 2 * inset)
            let th = ShiziParagraph.place(titleLabel, titleText, font: m.font(17, .medium), color: color("ink1"), line: m.line("lh17"), x: gutter + inset, y: top, width: tw)
            top += th + 6
        } else {
            let lh = m.line("lh15") // 页头标题的行盒：继承正文行高（网页 h1 没有设 line-height）
            titleLabel.frame = CGRect(x: left, y: safeTop + (ShiziPageHeader.height - lh) / 2, width: max(0, w - 2 * left), height: lh)
        }
        scroll.frame = CGRect(x: 0, y: top, width: w, height: max(0, h - top))
        let bottom = layoutBody(width: w - 2 * gutter, x: gutter, top: m.space(4))
        let contentH = bottom + m.space(8)
        content.frame = CGRect(x: 0, y: 0, width: w, height: contentH)
        scroll.contentSize = CGSize(width: w, height: contentH)
    }

    // MARK: 按钮与防误点（网页 Button.js createPressGuard：新状态后 pressGuard 内不响应；同一按钮两次按下也隔 pressGuard）

    private var pressGuard: CFTimeInterval {
        CFTimeInterval(((ShiziTokens.motion["timing"] as? [String: Any])?["pressGuard"] as? NSNumber)?.doubleValue ?? 0) / 1000
    }

    func markStateChange() { stateChangedAt = CACurrentMediaTime() }

    /// 按钮动作：先过防误点、引擎就绪，再执行。
    func wire(_ b: UIControl, _ action: @escaping (ShiziScreenViewController) -> Void) {
        b.addAction(UIAction { [weak self, weak b] _ in
            guard let self, let b else { return }
            let now = CACurrentMediaTime()
            if now < self.stateChangedAt + self.pressGuard { ShiziProbe.log("press dropped (state guard) \(self.screen)"); return }
            let id = ObjectIdentifier(b)
            if let last = self.lastPress[id], now < last + self.pressGuard { ShiziProbe.log("press dropped (repeat guard) \(self.screen)"); return }
            self.lastPress[id] = now
            action(self)
        }, for: .touchUpInside)
    }

    /// 引擎状态：不就绪时正文里的按钮暂不可点（原生页留在屏上，§3.4）；重新就绪时重拉视图。
    func engineStatusChanged(_ s: ShiziEngineStatus) {
        let ready = s.isReady
        content.isUserInteractionEnabled = ready
        if ready, lastView != nil, isViewLoaded, view.window != nil { reload() }
    }

    // MARK: 导航

    /// 「‹」/ 两指 Z 形 / 左缘右滑完成：播退场转场，收起后（viewDidDisappear）经 NativeStage 发 nav.back。
    func requestBack() {
        stage?.back(self)
    }

    /// 推入下一页（网页路由执行：原生屏 → 宿主挂载回发 open；网页屏 → 先把这一页的样子交给宿主层再让开）。
    func push(_ screen: String, params: [String: Any] = [:]) {
        stage?.navigate(from: self, push: screen, params: params)
    }

    @objc private func handleEdgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        guard let stage, stage.isTop(self) else { return }
        transitions.drag(g, page: self)
    }

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === edgeBack else { return true }
        return stage?.isTop(self) == true && !transitions.isLeaving && presentedViewController == nil
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { false }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        // 左缘起手优先于正文的竖向滚动（同 WebViewController P272）
        g === edgeBack && other.view === scroll
    }
}
