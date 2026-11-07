import UIKit

// 原生结果页（B2.7；docs/engineering/v10/B2-原生写字架构.md §11 B2.7 / §20；写字流程确认单 §8；D19 / D20 / D46 ⑥ / D49 / D51 ② / D66 ③ ④ ⑮ / D70）。
// 只在 DEBUG、原生写字页开关打开时出现（与原生写字页同一开关）。标准答案是原先的网页结果页。
//
// 数据：页面的结果条目挂载时（宿主 NativeResultHost）随 result-open 消息推来「视图」（网页结果页同一批函数算好的作品格、
//   落款与印、没放进图里的行、复现句、提醒邀请、底栏、交接来的撤销机会、落印要不要演）与外观（resultLook：文案、颜色、字阶、动效时刻）；
//   之后每次写入（放进图里、改判）的回包带新视图。原生只排版与绘制，不另算规则；文案一律取自页面（本文件没有用户可见的字）。
// 版式（逐项照原网页结果页）：
//   页头：左「×」（44 框，图标外缘落在 20pt 页边线：左移 16.25）、右「分享」（右移 15.25）；页标题只给读屏。
//   正文（页头下 12 起，左右页边 20，下内边 32；有撤销条时多一个 32 的组间距）：内容不满时在正文区里竖向居中（margin:auto 0），超出时贴顶滚动；
//     结果区末尾 5vh 内边。从上到下：首练标题（宋 22 / 30）/ 中途结束一行（13 / 20 ink3）→ 24 → 作品（格 c × 列 × 行、居中；笺底、格框 1pt、格间 0.75 guide；
//     格内墨在 12% 内边的方框里；写错放进来的字带朱点；看后写的格内底边小注 11 / 16）→ 14 → 落款（宋 13 / 20 ink2，右对齐；印 24pt 在末格右侧底齐，
//     末字在最右列时印在落款右边）→ 28 → 没放进图里的行（每行 52：36 的字 + 12 + 状态 17；右侧「修改 ›」13 ink1 与「放进图里」15 ink2）→ 20 → 复现句（15 / 22 ink2）
//     → 28 → 提醒邀请（发丝线 + 16：问句 17 / 500、说明 13 / 20、[开启提醒（描边） | 先不用]；粘在正文可视区底部，非 AX 档）。
//   底栏：主按钮下沿 = 屏底 − max(24, 下安全区)；文字按钮行在主按钮上方 12 + 8（「重写错字」，首练「再写一组」「重写错字」）；底栏上内边 12。
// 显现（D51 ② / D53）：第一次呈现这一组时格依次淡入 → 落款淡入 → 印落下（1.25 → 0.92 着纸 → 回弹 1）；着纸那一帧 rigid 触觉 + 页面放盖章声（resultSealed，同时记 sealedAt）；
//   其余（标题、各行、复现句、底栏）在印落下后淡入；点一下直接到终态；减少动态效果 / 已落过印（冷启动恢复）直接终态。邀请在落定后 600ms 淡入（8pt 上移）。
// 出口：「×」与左缘右滑 = 离开（滑出后 resultExit leave，页面 leaveTo）；「再写一组」= resultAgain（页面就地换成写字页，D70 之后返回回首页）；
//   「重写错字」/「看这个字 ›」/「分享」= resultExit（页面推入 / 打开网页弹层，结果条目留在栈里，宿主关掉原生页；回来时再盖上）。
// 撤销条：写字页交过来的跳过撤销机会（剩余时长照旧，S4），R10-B 浮条样式（NativeUndoBarView）；撤销 = resultUndoSkip，页面就地换回写字页。

/// 原生结果页的协调者（NativeStage，NativeStage.swift）。
protocol NativeResultCoordinating: AnyObject {
    /// 写入成功后页面会导航走（再写一组 / 撤销跳过 / 推入重写错字 / 字详情 / 分享）：原生页等宿主的 result-close 再让开。
    func nativeResultWillNavigate(_ vc: NativeResultViewController)
    /// B2.8：「×」/ 底栏离开——协调者问页面回去的路（纸缩回 / 右滑出 / 安静淡出），放完转场后收起（viewDidDisappear 发 resultExit leave）。
    func nativeResultLeave(_ vc: NativeResultViewController)
}

// MARK: - 结果页视图模型里多处读的几块（resultView 回包的 view 对象；其余键仍按字典读）
// cast 与默认值与原来逐处写的一致；整块缺失或不是对象 = 各字段取默认。

/// 底栏（view.footer）。
struct NativeResultFooter {
    /// first（完成）/ again（再写一组）/ 其余 = 离开（按钮字取 leave）；缺键 = "again"。
    let kind: String
    /// 显示「重写错字」：只有 true 才算。
    let redo: Bool
    /// 离开按钮的字；缺键 = ""。
    let leave: String

    init(_ raw: Any?) {
        let f = raw as? [String: Any] ?? [:]
        kind = f["kind"] as? String ?? "again"
        redo = (f["redo"] as? Bool) == true
        leave = f["leave"] as? String ?? ""
    }
}

/// 提醒邀请（view.invite）。
struct NativeResultInvite {
    /// 这次要问：只有 true 才算。
    let show: Bool
    let title: String
    let titleEvening: String
    /// 正文（带时刻的几段）。
    let body: NativeInviteBody

    init(_ raw: Any?) {
        let i = raw as? [String: Any] ?? [:]
        show = (i["show"] as? Bool) == true
        title = i["title"] as? String ?? ""
        titleEvening = i["titleEvening"] as? String ?? ""
        body = NativeInviteBody(i["body"])
    }
}

/// 邀请正文（view.invite.body）：整句 plain，或 pre + word（逐字，blanks[i] 为真的那一位画成空框）+ post。
/// 整块缺失或不是对象 = 各字段取默认（与原来 `?? [:]` 一致）。
struct NativeInviteBody {
    /// 有它就整句照排（不画空框）；缺键 = nil。
    let plain: String?
    /// 缺键 = ""。
    let pre: String
    let post: String
    /// 缺键或不是字符串数组 = []。
    let word: [String]
    /// 缺键或不是 Bool 数组 = []。
    let blanks: [Bool]

    init(_ raw: Any?) {
        let b = raw as? [String: Any] ?? [:]
        plain = b["plain"] as? String
        pre = b["pre"] as? String ?? ""
        post = b["post"] as? String ?? ""
        word = b["word"] as? [String] ?? []
        blanks = b["blanks"] as? [Bool] ?? []
    }
}

/// 写字页交过来的跳过撤销机会（view.undo；写字页 NativeSkipUndoHandoff.wire 经引擎带回）。
/// recordId 是字符串、remainingMs 是数且 > 0 才算，否则 nil（与原来 render 里的条件一致）。
struct NativeResultUndo {
    /// 缺键 = nil（用的地方回退到本页的 sessionId）。
    let sessionId: String?
    let recordId: String
    /// 缺键 = ""。
    let char: String
    /// 原值（撤销时原样带回 resultUndoSkip）。
    let strokes: Any?
    let remainingMs: Double

    init?(_ raw: Any?) {
        guard let u = raw as? [String: Any], let rid = u["recordId"] as? String, let remaining = (u["remainingMs"] as? NSNumber)?.doubleValue, remaining > 0 else { return nil }
        sessionId = u["sessionId"] as? String
        recordId = rid
        char = u["char"] as? String ?? ""
        strokes = u["strokes"]
        remainingMs = remaining
    }
}

/// 显现与落印（view.reveal）。
struct NativeResultReveal {
    /// 这组已落过印（冷启动后看 sealedAt）：只有 true 才算。
    let sealed: Bool
    /// 显现的时刻编排（reveal.plan）。
    let plan: NativeResultRevealPlan

    init(_ raw: Any?) {
        let r = raw as? [String: Any]
        sealed = (r?["sealed"] as? Bool) == true
        plan = NativeResultRevealPlan(r?["plan"])
    }
}

/// 显现的时刻编排（view.reveal.plan）：线上是 ms（NSNumber 按键取），这里换成 s；缺键 / plan 整块缺失 = 0。
struct NativeResultRevealPlan {
    let stagger: TimeInterval
    let cellMs: TimeInterval
    let kuanDelay: TimeInterval
    let kuanMs: TimeInterval
    let sealDelay: TimeInterval
    /// 键名是 contactMs：印落到着纸的时长。
    let contact: TimeInterval

    init(_ raw: Any?) {
        let plan = raw as? [String: Any] ?? [:]
        func p(_ k: String) -> TimeInterval { ((plan[k] as? NSNumber)?.doubleValue ?? 0) / 1000 }
        stagger = p("stagger")
        cellMs = p("cellMs")
        kuanDelay = p("kuanDelay")
        kuanMs = p("kuanMs")
        sealDelay = p("sealDelay")
        contact = p("contactMs")
    }
}

// MARK: - 作品与没放进图里的行（view.work / view.rows；NativeWorkView、NativeResultRowView 读）
// 每个字段的 cast 与默认值与原来逐处写的一致；strokes 仍是原值，由 NativeInkWire.rawStrokes 在用的地方读（与原来同一时机）。

/// 朱点（作品格 / 行的 dot）：相对字格的中心 cx / cy、直径 d；各键按 NSNumber 取，缺键 = 0。
struct NativeResultDot {
    let cx: CGFloat
    let cy: CGFloat
    let d: CGFloat

    init(_ raw: [String: Any]) {
        func v(_ k: String) -> CGFloat { CGFloat((raw[k] as? NSNumber)?.doubleValue ?? 0) }
        cx = v("cx")
        cy = v("cy")
        d = v("d")
    }
}

/// 作品里的一格（view.work.cells[i]）。
struct NativeResultCell {
    /// 点开对照弹层时原样带给 resultCell（缺键 = nil = 不带这个参数）。
    let recordId: String?
    let kind: String?
    let char: String?
    let label: String?
    /// 空作品格下的状态；缺键 = ""。
    let status: String
    /// 格内底边小注（「看后写的」）。
    let cap: String?
    /// 写错放进来的字带朱点；没有 dot 对象 = nil。
    let dot: NativeResultDot?
    let strokes: Any?

    init(_ raw: [String: Any]) {
        recordId = raw["recordId"] as? String
        kind = raw["kind"] as? String
        char = raw["char"] as? String
        label = raw["label"] as? String
        status = raw["status"] as? String ?? ""
        cap = raw["cap"] as? String
        dot = (raw["dot"] as? [String: Any]).map(NativeResultDot.init)
        strokes = raw["strokes"]
    }
}

/// 落款旁的印（view.work.seal）：整块缺失或不是对象 = 各字段取默认。
struct NativeResultSeal {
    /// 印在落款右边（末字在最右列）：只有 true 才算。
    let below: Bool
    /// 缺键 = 24。
    let size: CGFloat
    /// 不在下面时相对作品左缘的位置；缺键 = 0。
    let x: CGFloat
    let y: CGFloat

    init(_ raw: Any?) {
        let s = raw as? [String: Any] ?? [:]
        below = (s["below"] as? Bool) == true
        size = CGFloat((s["size"] as? NSNumber)?.doubleValue ?? 24)
        x = CGFloat((s["x"] as? NSNumber)?.doubleValue ?? 0)
        y = CGFloat((s["y"] as? NSNumber)?.doubleValue ?? 0)
    }
}

/// 作品（view.work）。
struct NativeResultWork {
    /// 空作品（一格墨都没有）：只有 true 才算。
    let empty: Bool
    /// 格边长；缺键 = 0。
    let c: CGFloat
    /// 缺键或不是 Int = 1。
    let cols: Int
    let rows: Int
    /// 缺键或不是对象数组 = []。
    let cells: [NativeResultCell]
    let label: String?
    /// 笺（x / y / w / h，NSNumber 取，缺键 = 0）；缺键或不是对象数组 = []。
    let frames: [CGRect]
    /// 格内边比；缺键 = 0.12。
    let pad: CGFloat
    /// 墨宽倍数；缺键 = 1。
    let widthScale: Double
    /// 印文路径（页面给的单位方块内的段）；缺键 = []。
    let sealPath: [[Any]]
    /// 落款文字。
    let kuan: String?
    let seal: NativeResultSeal

    init(_ raw: [String: Any]) {
        empty = (raw["empty"] as? Bool) == true
        c = CGFloat((raw["c"] as? NSNumber)?.doubleValue ?? 0)
        cols = (raw["cols"] as? Int) ?? 1
        rows = (raw["rows"] as? Int) ?? 1
        cells = (raw["cells"] as? [[String: Any]] ?? []).map(NativeResultCell.init)
        label = raw["label"] as? String
        frames = (raw["frames"] as? [[String: Any]] ?? []).map(NativeResultWork.frame)
        pad = CGFloat((raw["pad"] as? NSNumber)?.doubleValue ?? 0.12)
        widthScale = (raw["widthScale"] as? NSNumber)?.doubleValue ?? 1
        sealPath = raw["sealPath"] as? [[Any]] ?? []
        kuan = raw["kuan"] as? String
        seal = NativeResultSeal(raw["seal"])
    }

    private static func frame(_ f: [String: Any]) -> CGRect {
        func v(_ k: String) -> CGFloat { CGFloat((f[k] as? NSNumber)?.doubleValue ?? 0) }
        return CGRect(x: v("x"), y: v("y"), width: v("w"), height: v("h"))
    }
}

/// 没放进图里的一行（view.rows[i]）。
struct NativeResultRow {
    /// 点开对照弹层时原样带给 resultCell；「放进图里」要有它才发。
    let recordId: String?
    let kind: String?
    let char: String?
    /// 显示「修改 ›」/「放进图里」：只有 true 才算。
    let change: Bool
    let add: Bool
    /// 「修改 ›」的字；缺键 = ""。
    let changeLabel: String
    let changeAria: String?
    let addAria: String?
    let label: String?
    /// 状态；缺键 = ""。
    let text: String
    /// 状态后的小字（「· 纸上」）；缺键 = ""。
    let tag: String
    /// hand = 画本人墨，其余画衬底参考字。
    let mode: String?
    let strokes: Any?
    /// 墨宽倍数；缺键 = 1。
    let widthScale: Double
    let dot: NativeResultDot?

    init(_ raw: [String: Any]) {
        recordId = raw["recordId"] as? String
        kind = raw["kind"] as? String
        char = raw["char"] as? String
        change = (raw["change"] as? Bool) == true
        add = (raw["add"] as? Bool) == true
        changeLabel = raw["changeLabel"] as? String ?? ""
        changeAria = raw["changeAria"] as? String
        addAria = raw["addAria"] as? String
        label = raw["label"] as? String
        text = raw["text"] as? String ?? ""
        tag = raw["tag"] as? String ?? ""
        mode = raw["mode"] as? String
        strokes = raw["strokes"]
        widthScale = (raw["widthScale"] as? NSNumber)?.doubleValue ?? 1
        dot = (raw["dot"] as? [String: Any]).map(NativeResultDot.init)
    }
}

final class NativeResultViewController: UIViewController, UIGestureRecognizerDelegate, UIScrollViewDelegate {
    let slot: String
    let sessionId: String
    private let bridge: WriteSessionChannel
    weak var coordinator: NativeResultCoordinating?
    let transitions = NativeWriteTransitions()
    /// 已交给页面导航（离开 / 让开）：之后的 viewDidDisappear 不再发 leave。
    var exitHandled = false

    private var copy: [String: String] = [:]
    private var colors: [String: UIColor] = [:]
    private var rawColors: [String: String] = [:]
    private var inkTint: SIMD4<Float>?
    private var textType = NativeType()
    private var overlaySpec = NativeOverlaySpec()
    private var motion: [String: Double] = [:]
    private var rmotion: [String: Double] = [:]
    private var easeOut: [Double]?
    private var skipUndoParams = NativeSkipUndoParams()
    private(set) var model: [String: Any] = [:]

    // 页头
    private let backButton = UIButton(type: .custom)
    private let shareButton = UIButton(type: .custom)
    private let headerLabel = UILabel()
    // 正文
    private let scroll = UIScrollView()
    /// 内容滚到底栏下面时底栏上沿的发丝线（网页 .sz-page__foot[data-under]，D49）
    private let footHair = UIView()
    private let titleLabel = UILabel()
    private let subLabel = UILabel()
    private let workView = NativeWorkView()
    private var rowViews: [NativeResultRowView] = []
    private let previewLabel = UILabel()
    private let inviteSlot = UIView()
    private let inviteView = NativeInviteView()
    // 底栏
    private let redoButton = NativeTextButton(type: .system)
    private let againTextButton = NativeTextButton(type: .system)
    private let primaryButton = UIButton(type: .system)
    private let failNote = UILabel()
    private let failCancel = NativeTextButton(type: .system)
    private let failRetry = UIButton(type: .system)
    private let edgeBack = UIScreenEdgePanGestureRecognizer()
    private lazy var sealHaptic = UIImpactFeedbackGenerator(style: .rigid)
    private lazy var lightHaptic = UIImpactFeedbackGenerator(style: .light)

    // 状态
    private var againFailed = false
    private var busy = false
    private var landed = true
    private var revealToken = 0
    private var revealing = false
    private(set) var invitePhase = "wait"
    private(set) var sealedForTesting = false
    private var undoInfo: (sessionId: String, recordId: String, char: String, strokes: Any?)?
    private var undoBar: NativeUndoBarView?
    private var undoLife: NativeUndoLifetime?
    private var stateChangedAt: CFTimeInterval = -.infinity
    /// 本次进程里已演过落印的组（网页 revealed 同义；冷启动后看 sealedAt）。
    private static var revealed: Set<String> = []

    var variant: String { model["variant"] as? String ?? "" }
    var workCellCount: Int { work?.cells.count ?? 0 }
    var rowCount: Int { rows.count }
    var undoBarForTesting: NativeUndoBarView? { undoBar }
    /// view.work 是对象才有。
    private var work: NativeResultWork? { (model["work"] as? [String: Any]).map(NativeResultWork.init) }
    /// 有作品且不是空作品（work.empty 不是 true）：要显现 / 落印。
    private var hasWork: Bool {
        guard let work else { return false }
        return !work.empty
    }
    private var footerModel: NativeResultFooter { NativeResultFooter(model["footer"]) }
    private var inviteModel: NativeResultInvite { NativeResultInvite(model["invite"]) }
    private var revealModel: NativeResultReveal { NativeResultReveal(model["reveal"]) }
    private var rows: [NativeResultRow] { (model["rows"] as? [[String: Any]] ?? []).map(NativeResultRow.init) }
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }
    private var ts: NativeTypeScale { NativeTypeScale(type: textType, ax: traitCollection.preferredContentSizeCategory.isAccessibilityCategory) }

    init(slot: String, sessionId: String, look: [String: Any], view model: [String: Any], bridge: WriteSessionChannel) {
        self.slot = slot
        self.sessionId = sessionId
        self.bridge = bridge
        self.model = model
        super.init(nibName: nil, bundle: nil)
        applyLook(look)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: 文案 / 颜色 / 时刻（单一来源：页面）

    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
        var s = copy[key] ?? ""
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v.description) }
        return s
    }

    private func applyLook(_ raw: [String: Any]) {
        // B3.1：颜色 / 字阶 / 文案 / 动效取 ShiziKit 生成值（ShiziLook），look 只给主题、AX 量值与 policy 参数
        let look = ShiziLook.resolve(raw, page: .result)
        copy = look["copy"] as? [String: String] ?? [:]
        rawColors = look["colors"] as? [String: String] ?? [:]
        for (k, v) in rawColors where !k.hasSuffix("-shadow") {
            if let c = NativeInkWire.uiColor(v) { colors[k] = c }
        }
        if let h = NativeInkWire.parseColor(rawColors["hand"]) { inkTint = SIMD4(h.x, h.y, h.z, 1) }
        if look["type"] != nil { textType = NativeType(look["type"]) }
        // R11-A（D72 ②）：墨与网页同一算法，参数是页面下发的 ink 表（结果页可能是冷启动后第一张原生页，自己也设）
        if let k = WebInkParams(look["ink"]) { WebInkParams.current = k }
        if let m = look["motion"] as? [String: Any] {
            motion = m.compactMapValues { ($0 as? NSNumber)?.doubleValue }
            rmotion = (m["result"] as? [String: Any] ?? [:]).compactMapValues { ($0 as? NSNumber)?.doubleValue }
            easeOut = (m["easeOut"] as? [NSNumber])?.map { $0.doubleValue }
            overlaySpec = NativeOverlaySpec(motion: m)
        }
        if let u = look["skipUndo"] as? [String: Any] { skipUndoParams = NativeSkipUndoParams(u) }
    }

    private func color(_ name: String, _ fallback: UIColor) -> UIColor { colors[name] ?? fallback }
    private func ms(_ key: String) -> TimeInterval { (rmotion[key] ?? 0) / 1000 }

    private func toastStyle() -> NativeToastStyle {
        let bg = color("toast-bg", color("elev", .secondarySystemBackground))
        let fg = color("toast-fg", color("ink1", .label))
        return NativeToastStyle(background: bg, foreground: fg, action: color("toast-act", fg), line: colors["toast-line"] ?? colors["line"],
                                shadow: NativeInkWire.shadow(rawColors["toast-shadow"]), radius: textType.value("r-box"))
    }

    private var style: NativeJudgeStyle {
        var s = NativeJudgeStyle(tr: { [weak self] k, v in self?.tr(k, v) ?? "" }, color: { [weak self] n, f in self?.color(n, f) ?? f }, inkTint: inkTint)
        s.type = textType
        s.overlay = overlaySpec
        return s
    }

    // MARK: 生命周期

    override func loadView() {
        let v = UIView()
        v.backgroundColor = color("paper", UIColor(named: "Paper") ?? .systemBackground)
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let ink1 = color("ink1", .label)
        for (b, icon, id, label) in [(backButton, NativeWriteIcon.close, "native-result-close", tr("X-COMMON.close")), (shareButton, NativeWriteIcon.share, "native-result-share", tr("X-WORK.shareAria"))] {
            b.setImage(icon.image(ink1), for: .normal)
            b.setTitleColor(ink1, for: .normal)
            b.titleLabel?.font = ts.font(15)
            b.accessibilityIdentifier = id
            b.accessibilityLabel = label
            view.addSubview(b)
        }
        backButton.addAction(UIAction { [weak self] _ in self?.tapLeave() }, for: .touchUpInside)
        shareButton.addAction(UIAction { [weak self] _ in self?.openImagePreview() }, for: .touchUpInside)
        headerLabel.isAccessibilityElement = true
        headerLabel.accessibilityTraits = [.header]
        headerLabel.alpha = 0.011
        headerLabel.accessibilityIdentifier = "native-result-header"
        view.addSubview(headerLabel)

        scroll.delegate = self
        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.delaysContentTouches = false
        view.addSubview(scroll)
        footHair.backgroundColor = color("line", .separator)
        footHair.isUserInteractionEnabled = false
        footHair.isHidden = true
        view.addSubview(footHair)
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-result-title"
        subLabel.numberOfLines = 0
        subLabel.accessibilityIdentifier = "native-result-sub"
        previewLabel.numberOfLines = 0
        previewLabel.accessibilityIdentifier = "native-result-preview"
        workView.onOpen = { [weak self] cell in self?.openCell(cell) }
        inviteSlot.backgroundColor = color("paper", .systemBackground)
        inviteSlot.addSubview(inviteView)
        inviteView.onYes = { [weak self] in self?.inviteYes() }
        inviteView.onNo = { [weak self] in self?.inviteNo() }
        inviteView.onTime = { [weak self] h, m in self?.inviteTime(hour: h, minute: m) }
        inviteView.onDismissFail = { [weak self] in self?.inviteView.failed = false; self?.layoutAll() }
        [titleLabel, subLabel, workView, previewLabel, inviteSlot].forEach { scroll.addSubview($0) }

        configureText(redoButton, title: tr("X-REDO.title"), id: "native-result-redo")
        redoButton.addAction(UIAction { [weak self] _ in self?.press { $0.go("redo") } }, for: .touchUpInside)
        configureText(againTextButton, title: tr("X-RESULT.again"), id: "native-result-again-text")
        againTextButton.addAction(UIAction { [weak self] _ in self?.press { $0.again() } }, for: .touchUpInside)
        configurePrimary(primaryButton, id: "native-result-primary")
        primaryButton.addAction(UIAction { [weak self] _ in self?.press { $0.tapPrimary() } }, for: .touchUpInside)
        configurePrimary(failRetry, id: "native-result-again-retry")
        failRetry.setTitle(tr("X-RESULT.againRetry"), for: .normal)
        failRetry.addAction(UIAction { [weak self] _ in self?.press { $0.again() } }, for: .touchUpInside)
        configureText(failCancel, title: tr("X-RESULT.againCancel"), id: "native-result-again-cancel")
        failCancel.addAction(UIAction { [weak self] _ in self?.cancelAgainFail() }, for: .touchUpInside)
        failNote.numberOfLines = 0
        failNote.accessibilityIdentifier = "native-result-again-note"
        [redoButton, againTextButton, primaryButton, failNote, failCancel, failRetry].forEach { view.addSubview($0) }

        edgeBack.edges = .left
        edgeBack.delegate = self
        edgeBack.addTarget(self, action: #selector(handleEdgeBack(_:)))
        view.addGestureRecognizer(edgeBack)
        let tapAnywhere = UITapGestureRecognizer(target: self, action: #selector(skipReveal))
        tapAnywhere.cancelsTouchesInView = false
        tapAnywhere.delegate = self
        view.addGestureRecognizer(tapAnywhere)

        render(fresh: true)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NativeA11y.screenChanged(headerLabel)
        transitions.whenSettled { [weak self] in self?.startRevealIfNeeded() } // T0 规则 4：进场转场放完再显现
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isBeingDismissed || presentingViewController == nil else { return }
        stopUndo()
        if !exitHandled {
            exitHandled = true
            bridge.call("resultExit", ["slot": slot, "sessionId": sessionId, "to": "leave"]) { _ in }
        }
    }

    override func accessibilityPerformEscape() -> Bool {
        tapLeave()
        return true
    }

    // MARK: 视图数据

    /// 换上新视图（放进图里 / 改判之后的回包、从字详情回来时的重新同步）：不重演显现。
    func apply(view next: [String: Any]) {
        model = next
        render(fresh: false)
    }

    private func render(fresh: Bool) {
        let ink1 = color("ink1", .label), ink2 = color("ink2", .secondaryLabel), ink3 = color("ink3", .secondaryLabel)
        headerLabel.text = model["header"] as? String
        headerLabel.accessibilityLabel = headerLabel.text
        shareButton.isHidden = (model["share"] as? Bool) != true
        let lines = model["lines"] as? [String: Any] ?? [:]
        let title = Self.broken(model["title"] as? String ?? "", lines["title"])
        titleLabel.isHidden = title.isEmpty
        NativeType.set(titleLabel, title, font: NativeType.song(size: ts.size(22), weight: .medium), color: ink1, line: ts.lineHeight(22))
        Self.fixLineBox(titleLabel, line: ts.lineHeight(22))
        let sub = Self.broken(model["sub"] as? String ?? "", lines["sub"])
        subLabel.isHidden = sub.isEmpty
        NativeType.set(subLabel, sub, font: ts.font(13), color: ink3, line: ts.lineHeight(13))
        workView.configure(work: work, look: NativeWorkView.Look(
            sheet: color("sheet", .systemBackground), frame: color("frame", .separator), guide: color("guide", .separator), hand: inkTint,
            under: color("under", .secondaryLabel), zhu: color("zhu", .systemRed), seal: color("seal", .systemRed), onSeal: color("on-seal", .white),
            ink1: ink1, ink2: ink2, ink3: ink3, field: color("field", .secondarySystemFill), type: ts))
        workView.accessibilityIdentifier = "native-result-work"
        // 没放进图里的行（复用同一批视图，按序号对上）
        let list = rows
        while rowViews.count > list.count { rowViews.removeLast().removeFromSuperview() }
        while rowViews.count < list.count {
            let r = NativeResultRowView()
            r.onOpen = { [weak self] row in self?.openRow(row) }
            r.onChange = { [weak self] row in self?.openRow(row) }
            r.onAdd = { [weak self] row in self?.addRow(row) }
            scroll.addSubview(r)
            rowViews.append(r)
        }
        for (i, r) in rowViews.enumerated() {
            r.configure(row: list[i], glyph: CGFloat((model["rowGlyph"] as? NSNumber)?.doubleValue ?? 36), pad: CGFloat((model["rowPad"] as? NSNumber)?.doubleValue ?? 0.03),
                        look: .init(ink1: ink1, ink2: ink2, ink3: ink3, under: color("under", .secondaryLabel), zhu: color("zhu", .systemRed), hand: inkTint, field: color("field", .secondarySystemFill), type: ts,
                                    addIn: tr("X-FIRST.addIn")))
        }
        let preview = Self.broken(model["preview"] as? String ?? "", lines["preview"])
        previewLabel.isHidden = preview.isEmpty
        NativeType.set(previewLabel, preview, font: ts.font(15), color: ink2, line: ts.lineHeight(15))
        // 邀请
        let inv = inviteModel
        inviteView.look = .init(ink1: ink1, ink2: ink2, ink3: ink3, ink4: color("ink4", .tertiaryLabel), line: color("line", .separator), frame: color("frame", .separator), field: color("field", .secondarySystemFill), type: ts)
        inviteView.bodyBreaks = (lines["inviteBody"] as? [NSNumber])?.map { $0.intValue } ?? []
        inviteView.strings = .init(title: inv.title, titleEvening: inv.titleEvening, body: inv.body,
                                   yes: tr("X-INVITE.yes"), no: tr("X-INVITE.no"), changeTime: tr("X-INVITE.changeTime"), blank: tr("X-INVITE.blankLabel"),
                                   saveFailed: tr("X-SETTINGS.saveFailed"), cancel: tr("X-SETTINGS.cancel"), retry: tr("R-W16.retry"))
        // 底栏
        let foot = footerModel
        let kind = foot.kind
        redoButton.isHidden = !foot.redo
        againTextButton.isHidden = kind != "first"
        primaryButton.setTitle(kind == "first" ? tr("X-RESULT.done") : kind == "again" ? tr("X-RESULT.again") : foot.leave, for: .normal)
        if fresh {
            if let u = NativeResultUndo(model["undo"]) {
                beginUndo(sessionId: u.sessionId ?? sessionId, recordId: u.recordId, char: u.char, strokes: u.strokes, remainingMs: u.remainingMs)
            }
            prepareReveal()
        }
        renderFail()
        layoutAll()
    }

    private func configureText(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = ts.font(15)
        b.setTitleColor(color("ink2", .secondaryLabel), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        b.contentHorizontalAlignment = .left // 字左缘 = 盒左缘 + 4（网页 .sz-btn--text padding 0 4；盒宽按字宽排，左对齐不受字距舍入影响）
        b.accessibilityIdentifier = id
    }

    private func configurePrimary(_ b: UIButton, id: String) {
        b.titleLabel?.font = ts.font(17, .medium)
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24) // 网页 .sz-btn--primary padding 0 24（AX 档折行时同宽）
        b.backgroundColor = color("btn-bg", .label)
        b.setTitleColor(color("btn-fg", .systemBackground), for: .normal)
        b.layer.cornerRadius = 12
        b.layer.cornerCurve = .continuous
        b.accessibilityIdentifier = id
    }

    /// 按网页的折行点换行（webLineStarts：网页 text-wrap: pretty 折出来的每一行从第几个字开始）。
    static func broken(_ text: String, _ starts: Any?) -> String {
        guard let starts = (starts as? [NSNumber])?.map({ $0.intValue }), !starts.isEmpty else { return text }
        var out = ""
        for (i, ch) in text.enumerated() {
            if starts.contains(i) { out.append("\n") }
            out.append(ch)
        }
        return out
    }

    /// 段落盒高 = 行数 × 网页行高；行按网页给的折行点断开（每段再按宽度折，原生字比网页窄时不会再折）。
    static func paraHeight(_ label: UILabel, width: CGFloat, line: CGFloat) -> CGFloat {
        guard let a = label.attributedText ?? label.text.map({ NSAttributedString(string: $0, attributes: [.font: label.font as Any]) }), a.length > 0 else { return 0 }
        var lines = 0
        let ns = a.string as NSString
        var start = 0
        while start <= ns.length {
            let r = ns.range(of: "\n", range: NSRange(location: start, length: ns.length - start))
            let end = r.location == NSNotFound ? ns.length : r.location
            let seg = a.attributedSubstring(from: NSRange(location: start, length: end - start))
            let w = seg.boundingRect(with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).width
            lines += max(1, Int(ceil((w - 0.5) / max(1, width))))
            if r.location == NSNotFound { break }
            start = end + 1
        }
        return CGFloat(lines) * line
    }

    /// 宋体标题的行盒 = 网页行高（lh22 = 30）：单行时也按行高排（minimum / maximumLineHeight），字在行盒里竖向居中（网页半行距）。
    static func fixLineBox(_ label: UILabel, line: CGFloat) {
        guard let a = label.attributedText, a.length > 0 else { return }
        let m = NSMutableAttributedString(attributedString: a)
        let f = (m.attribute(.font, at: 0, effectiveRange: nil) as? UIFont) ?? label.font ?? .systemFont(ofSize: 17)
        let p = ((m.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
        p.minimumLineHeight = line
        p.maximumLineHeight = line
        p.lineSpacing = 0
        m.addAttribute(.paragraphStyle, value: p, range: NSRange(location: 0, length: m.length))
        m.addAttribute(.baselineOffset, value: (line - f.lineHeight) / 4, range: NSRange(location: 0, length: m.length))
        label.attributedText = m
    }

    // MARK: 版式

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutAll()
    }

    /// 底栏上沿（网页 .sz-page__foot 的上内边 12 之上）。
    private var footTop: CGFloat = 0

    private func layoutAll() {
        guard isViewLoaded else { return }
        let w = view.bounds.width, h = view.bounds.height
        guard w > 0 else { return }
        let safe = view.safeAreaInsets
        let gutter: CGFloat = 20
        let inner = w - 2 * gutter
        // 页头（44；左「×」、右「分享」，图标外缘对页边线）
        backButton.frame = ShiziPageHeader.leadFrame(.close, gutter: gutter, y: safe.top)
        shareButton.frame = ShiziPageHeader.trailFrame(.share, width: w, gutter: gutter, y: safe.top)
        headerLabel.frame = ShiziPageHeader.screenReaderTitleFrame(gutter: gutter, top: safe.top)

        // 底栏：主按钮下沿 = 屏底 − max(24, 下安全区)；文字按钮行（44 + 下外边 8）在主按钮上方，间 12；底栏上内边 12
        let ts = self.ts
        let tt = textType
        [primaryButton, redoButton, againTextButton, failCancel, failRetry].forEach { NativeType.trackTitle($0) } // 中文字距同网页（B2.9b）
        // AX 档主按钮：min-height --btn-h、上下内边距 6、字按行数长高
        let primaryH = tt.axButtonHeight("resultFoot", sub: "r3", title: primaryButton.title(for: .normal), font: primaryButton.titleLabel?.font, width: inner - 48)
            ?? max(ts.buttonHeight, ts.lh17s)
        let primaryY = h - max(24, safe.bottom) - primaryH
        primaryButton.frame = CGRect(x: gutter, y: primaryY, width: inner, height: primaryH)
        failRetry.frame = primaryButton.frame
        var top = primaryY
        let textRow = [againTextButton, redoButton].filter { !$0.isHidden }
        if againFailed {
            // 再写一组失败：底栏就地三段式（说明 → [先不写 | 再试一次]，FailBlock foot）
            let half = (inner - 12) / 2
            failRetry.frame = CGRect(x: gutter + half + 12, y: primaryY, width: half, height: primaryH)
            let fw = NativeType.width(failCancel.titleLabel ?? UILabel()) + 8
            failCancel.frame = CGRect(x: gutter + (half - fw) / 2, y: primaryY + (primaryH - 44) / 2, width: fw, height: 44)
            let nh = NativeType.height(failNote, width: inner, line: ts.lineHeight(13))
            failNote.frame = CGRect(x: gutter, y: primaryY - 12 - nh, width: inner, height: nh)
            top = failNote.frame.minY
        } else if !textRow.isEmpty {
            // 文字按钮行（.sz-result__textrow：flex-wrap、gap 0 20、下外边 8）：放不下一行时第二枚折到下一行；AX 档按钮按字号长高（量到的 min-height）
            let bh = max(44, tt.role("resultFoot", "minH") ?? 44)
            let colGap = tt.role("resultFoot", "colGap", sub: "r2") ?? 20
            let widths = textRow.map { NativeType.titleWidth($0) + 8 }
            var lines: [[Int]] = [[]]
            var used: CGFloat = 0
            for (i, bw) in widths.enumerated() {
                let need = (lines[lines.count - 1].isEmpty ? 0 : colGap) + (bw - 8)
                if !lines[lines.count - 1].isEmpty, used + need > inner + 0.5 { lines.append([]); used = 0 }
                used += (lines[lines.count - 1].isEmpty ? 0 : colGap) + (bw - 8)
                lines[lines.count - 1].append(i)
            }
            let rowY = primaryY - 12 - 8 - bh * CGFloat(lines.count)
            for (li, line) in lines.enumerated() {
                var x = gutter - 4
                for i in line {
                    textRow[i].frame = CGRect(x: x, y: rowY + CGFloat(li) * bh, width: widths[i], height: bh)
                    x += widths[i] - 8 + colGap // 字与字之间 20
                }
            }
            top = rowY
        }
        footTop = top - 12
        // B2.9b：读屏顺序同网页 DOM（页头：×、只给读屏的页标题、分享；正文；撤销条；底栏），只放显示着的
        let order: [UIView?] = [backButton, headerLabel, shareButton, scroll, undoBar, failNote, againTextButton, redoButton, failCancel, primaryButton, failRetry]
        view.accessibilityElements = order.compactMap { $0 }.filter { !$0.isHidden }

        // 撤销条：贴底栏上方 8（网页 SkipUndoDock bottom = 底栏高 + 8）
        if let bar = undoBar {
            let bh = bar.height(for: inner)
            bar.frame = CGRect(x: gutter, y: footTop - 8 - bh, width: inner, height: bh)
        }

        // 正文：页头下 12 起；下内边 32（+ 撤销条占的组间距 32）
        let bodyTop = safe.top + 44
        let padTop: CGFloat = 12
        let padBottom: CGFloat = 32 + (undoBar != nil ? 32 : 0)
        scroll.frame = CGRect(x: 0, y: bodyTop, width: w, height: max(0, footTop - bodyTop))
        let content = layoutContent(width: inner, x: gutter, originY: 0, layout: false)
        let tail = (h * 0.05) // .sz-result 下内边 5vh
        let total = content + tail
        let avail = scroll.bounds.height - padTop - padBottom
        let offset = total < avail ? (avail - total) / 2 : 0
        _ = layoutContent(width: inner, x: gutter, originY: padTop + offset, layout: true)
        scroll.contentSize = CGSize(width: w, height: padTop + max(total, avail) + padBottom)
        // 网页（WebKit）滚动高不含放不下时的下内边距：padTop + 内容高（含 5vh 尾）；放得下时 = 视口高
        webScrollHeight = max(scroll.bounds.height, padTop + total)
        footHair.backgroundColor = color("line", .separator)
        footHair.frame = CGRect(x: 0, y: footTop - 0.5, width: w, height: 0.5)
        updateFootHair()
        placeInviteSticky()
    }

    private var webScrollHeight: CGFloat = 0

    private func updateFootHair() {
        footHair.isHidden = !(webScrollHeight - scroll.contentOffset.y - scroll.bounds.height > 1)
    }

    /// 正文结果区（不含 5vh 尾）的高；layout = true 时同时排好。
    @discardableResult
    private func layoutContent(width W: CGFloat, x: CGFloat, originY: CGFloat, layout: Bool) -> CGFloat {
        let ts = self.ts
        var y = originY
        var head = false
        if !titleLabel.isHidden {
            let th = Self.paraHeight(titleLabel, width: W, line: ts.lineHeight(22))
            if layout { titleLabel.frame = CGRect(x: x, y: y, width: W, height: th) }
            y += th
            head = true
        }
        if !subLabel.isHidden {
            let sh = Self.paraHeight(subLabel, width: W, line: ts.lineHeight(13))
            if layout { subLabel.frame = CGRect(x: x, y: y, width: W, height: sh) }
            y += sh
            head = true
        }
        if head { y += 24 } else if work != nil { y += 4 }
        if work != nil {
            let wh = workView.height(for: W)
            if layout { workView.frame = CGRect(x: x, y: y, width: W, height: wh) }
            y += wh
        }
        if !rowViews.isEmpty {
            y += 28
            for r in rowViews {
                let rh = r.height(for: W)
                if layout { r.frame = CGRect(x: x, y: y, width: W, height: rh) }
                y += rh
            }
        }
        if !previewLabel.isHidden {
            y += 20
            let ph = Self.paraHeight(previewLabel, width: W, line: ts.lineHeight(15))
            if layout { previewLabel.frame = CGRect(x: x, y: y, width: W, height: ph) }
            y += ph
        }
        let inviteShown = invitePhase != "wait" && invitePhase != "gone"
        inviteSlot.isHidden = !inviteShown
        if inviteShown {
            y += 28
            let ih = inviteView.height(for: W)
            let slotH = ih + (ts.ax ? 0 : 8)
            if layout {
                inviteSlot.frame = CGRect(x: x, y: y, width: W, height: slotH)
                inviteView.frame = CGRect(x: 0, y: 0, width: W, height: ih)
                inviteNaturalY = y
            }
            y += slotH
        }
        return y - originY
    }

    private var inviteNaturalY: CGFloat = 0

    /// D66 ⑯：邀请粘在正文可视区底部（position: sticky; bottom: 0，非 AX 档），滚到底时回到自然位置。
    private func placeInviteSticky() {
        guard !inviteSlot.isHidden, !ts.ax else { return }
        let padBottom: CGFloat = 32 + (undoBar != nil ? 32 : 0)
        let visibleBottom = scroll.contentOffset.y + scroll.bounds.height - padBottom
        let y = min(inviteNaturalY, visibleBottom - inviteSlot.bounds.height)
        inviteSlot.frame.origin.y = y
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { placeInviteSticky(); updateFootHair() }

    // MARK: 显现与落印（D51 ② / D53）

    private var sealKey: String { "\(slot):\(sessionId)" }

    private func shouldReveal() -> Bool {
        guard hasWork else { return false }
        let sealed = revealModel.sealed
        return !sealed && !Self.revealed.contains(sealKey) && !reduceMotion
    }

    /// 打开时：要演就先只显示作品（其余隐藏、底栏隐藏），否则直接终态（没落过印的组照样发一次触觉与盖章声、记 sealedAt）。
    private func prepareReveal() {
        let hasSeal = hasWork
        let sealed = revealModel.sealed
        sealedForTesting = sealed
        if shouldReveal() {
            landed = false
            revealing = true
            setLate(hidden: true)
            workView.prepareReveal()
        } else {
            landed = true
            if hasSeal && !sealed && !Self.revealed.contains(sealKey) {
                // 减少动态效果：不演，触觉与盖章声照发（同一帧）
                DispatchQueue.main.async { [weak self] in self?.sealMoment() }
            }
            scheduleInvite()
        }
    }

    private func startRevealIfNeeded() {
        guard revealing else { return }
        revealToken += 1
        let token = revealToken
        let plan = revealModel.plan
        workView.playReveal(stagger: plan.stagger, cellMs: plan.cellMs, kuanDelay: plan.kuanDelay, kuanMs: plan.kuanMs, sealDelay: plan.sealDelay,
                            fall: plan.contact, rebound: ms("rebound"), sealFrom: CGFloat(rmotion["sealFrom"] ?? 1.25), contact: CGFloat(rmotion["sealContact"] ?? 0.92),
                            onContact: { [weak self] in
                                guard let self, self.revealToken == token else { return }
                                self.sealMoment()
                            }, onLand: { [weak self] in
                                guard let self, self.revealToken == token else { return }
                                self.land()
                            })
    }

    /// 点一下直接到终态（网页 pointerdown 捕获）。
    @objc private func skipReveal() {
        guard revealing else { return }
        revealToken += 1
        workView.finishReveal()
        sealMoment()
        land()
    }

    private func sealMoment() {
        guard !Self.revealed.contains(sealKey) else { return }
        Self.revealed.insert(sealKey)
        sealHaptic.impact("seal", 0.8) // F1 seal：.rigid 0.8，与印着纸同一帧（声音由页面放，resultSealed）
        sealedForTesting = true
        bridge.call("resultSealed", ["slot": slot, "sessionId": sessionId]) { _ in }
    }

    private func land() {
        guard !landed else { return }
        landed = true
        revealing = false
        let d = reduceMotion ? (motion["reduce"] ?? 150) / 1000 : ms("lateIn")
        UIView.animate(withDuration: d, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) { self.setLate(hidden: false) }
        scheduleInvite()
    }

    /// 印落下之前只显示作品（I3-04）：标题、各行、复现句、邀请与底栏隐藏（读屏也摸不到）。
    private func setLate(hidden: Bool) {
        let views: [UIView] = [titleLabel, subLabel, previewLabel, inviteSlot, redoButton, againTextButton, primaryButton] + rowViews
        for v in views {
            v.alpha = hidden ? 0 : 1
            v.accessibilityElementsHidden = hidden
            v.isUserInteractionEnabled = !hidden
        }
    }

    // MARK: 提醒邀请（D35 / D46 ③；网页 useReminderInvite）

    private func scheduleInvite() {
        guard inviteModel.show, invitePhase == "wait" else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + ms("inviteDelay")) { [weak self] in
            guard let self, self.invitePhase == "wait" else { return }
            self.bridge.call("resultInvite", ["slot": self.slot, "sessionId": self.sessionId, "action": "shown"]) { [weak self] reply in
                guard let self, reply.ok, self.invitePhase == "wait" else { return } // 写不进去就不问（不让「问了几次」失真）
                self.inviteView.evening = NativeInviteReply(reply.body).evening
                self.invitePhase = "invite"
                self.inviteView.phase = .invite
                self.layoutAll()
                self.animateInviteIn()
            }
        }
    }

    private func animateInviteIn() {
        if reduceMotion {
            inviteSlot.alpha = 0
            UIView.animate(withDuration: (motion["reduce"] ?? 150) / 1000) { self.inviteSlot.alpha = 1 }
            return
        }
        inviteView.alpha = 0
        inviteView.transform = CGAffineTransform(translationX: 0, y: 8)
        let a = UIViewPropertyAnimator(duration: ms("inviteIn"), timingParameters: NativeBezier.timing(easeOut))
        a.addAnimations { self.inviteView.alpha = 1; self.inviteView.transform = .identity }
        a.startAnimation()
    }

    private func inviteYes() {
        guard invitePhase == "invite" else { return }
        invitePhase = "pending"
        inviteView.phase = .pending
        bridge.call("resultInvite", ["slot": slot, "sessionId": sessionId, "action": "yes"]) { [weak self] reply in
            guard let self else { return }
            let r = NativeInviteReply(reply.body)
            if !reply.ok || r.phase == "failed" {
                self.invitePhase = "invite"
                self.inviteView.phase = .invite
                self.inviteView.failed = true
                NativeA11y.announce(self.tr("X-SETTINGS.saveFailed"))
            } else if r.phase == "denied" {
                self.invitePhase = "denied"
                self.inviteView.phase = .line(r.text ?? self.tr("X-INVITE.denied"), time: nil)
            } else {
                self.invitePhase = "accepted"
                self.inviteView.phase = .line(r.text ?? "", time: (r.hour ?? 20, r.minute ?? 30))
            }
            self.layoutAll()
        }
    }

    private func inviteNo() {
        guard invitePhase == "invite" else { return }
        bridge.call("resultInvite", ["slot": slot, "sessionId": sessionId, "action": "no"]) { _ in }
        invitePhase = "gone"
        inviteView.phase = .gone
        layoutAll()
    }

    private func inviteTime(hour: Int, minute: Int) {
        bridge.call("resultInvite", ["slot": slot, "sessionId": sessionId, "action": "time", "hour": hour, "minute": minute]) { [weak self] reply in
            guard let self else { return }
            let r = NativeInviteReply(reply.body)
            self.inviteView.phase = .line(r.text ?? "", time: (r.hour ?? hour, r.minute ?? minute))
            self.inviteView.timeFailed = !reply.ok
            self.layoutAll()
        }
    }

    // MARK: 撤销条（写字页交接来的，S4；R10-B 浮条样式）

    private func beginUndo(sessionId sid: String, recordId: String, char: String, strokes: Any?, remainingMs: Double) {
        stopUndo()
        undoInfo = (sid, recordId, char, strokes)
        let bar = NativeUndoBarView(style: toastStyle(), type: textType)
        bar.strings = .init(text: tr("R-W20.skippedToast", ["char": char]), undo: tr("R-W20.undo"), failed: tr("R-W16.saveFailed"), cancel: tr("R-W16.cancel"), retry: tr("R-W16.retry"))
        bar.onUndo = { [weak self] in self?.tapUndoSkip() }
        bar.onCancelFail = { [weak self] in self?.endUndo() }
        bar.onHold = { [weak self] in self?.undoLife?.hold() }
        bar.onRelease = { [weak self] in self?.undoLife?.release() }
        view.addSubview(bar)
        undoBar = bar
        let life = NativeUndoLifetime(ms: remainingMs, pauseWhileHeld: skipUndoParams.pauseWhileHeld, keepOpenWithAssistiveTech: skipUndoParams.keepOpen) { [weak self] in
            guard let self, let b = self.undoBar, !b.isFailed else { return }
            self.endUndo()
        }
        undoLife = life
        life.start()
    }

    private func stopUndo() {
        undoLife?.stop()
        undoLife = nil
    }

    /// 撤销机会结束（到点 / 点了别的）：收起（T-fade 原位淡出），正文区不再给它留组间距。
    private func endUndo() {
        stopUndo()
        undoInfo = nil
        guard let bar = undoBar else { return }
        undoBar = nil
        UIView.animate(withDuration: reduceMotion ? (motion["reduce"] ?? 150) / 1000 : 0.15, delay: 0, options: [.curveLinear]) { bar.alpha = 0 } completion: { _ in bar.removeFromSuperview() }
        layoutAll()
    }

    private func tapUndoSkip() {
        guard let u = undoInfo, !busy else { return }
        busy = true
        var args: [String: Any] = ["slot": slot, "sessionId": sessionId, "recordId": u.recordId]
        if let s = u.strokes, !(s is NSNull) { args["strokes"] = s }
        exitHandled = true // 成功后页面就地换回写字页（宿主 result-close），不再发离开
        coordinator?.nativeResultWillNavigate(self)
        bridge.call("resultUndoSkip", args) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            if reply.ok {
                self.lightHaptic.impact("light", 0.5)
                self.stopUndo()
                return
            }
            self.exitHandled = false
            if reply.errorKind == "stale" { self.endUndo(); return }
            self.stopUndo()
            self.undoBar?.setFailed(true)
            self.layoutAll()
            NativeA11y.announce(self.tr("R-W16.saveFailed"))
        }
    }

    // MARK: 动作

    /// 0.4s 防误点（网页：新状态后 pressGuard 内不响应）。
    private func press(_ action: (NativeResultViewController) -> Void) {
        let guardS = (motion["pressGuard"] ?? 0) / 1000
        if CACurrentMediaTime() - stateChangedAt < guardS { return }
        action(self)
    }

    private func dismissUndoForAction() {
        if undoBar != nil, undoBar?.isFailed != true { endUndo() }
    }

    private func tapPrimary() {
        if footerModel.kind == "again" { again() } else { tapLeave() }
    }

    @objc private func tapLeave() {
        guard presentingViewController != nil, !isBeingDismissed else { return }
        dismissUndoForAction()
        if let coordinator { coordinator.nativeResultLeave(self) } else { dismiss(animated: true) } // 转场放完收起后 viewDidDisappear 发 resultExit leave
    }

    /// 「再写一组」（网页 again）：成功后页面就地换成写字页；失败就地三段式。
    private func again() {
        guard !busy else { return }
        dismissUndoForAction()
        busy = true
        exitHandled = true
        coordinator?.nativeResultWillNavigate(self)
        bridge.call("resultAgain", ["slot": slot, "sessionId": sessionId]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            if reply.ok { self.againFailed = false; return }
            self.exitHandled = false
            self.againFailed = true
            self.stateChangedAt = CACurrentMediaTime()
            self.renderFail()
            self.layoutAll()
            NativeA11y.announce(self.tr("X-RESULT.againFailed"))
        }
    }

    private func cancelAgainFail() {
        againFailed = false
        stateChangedAt = CACurrentMediaTime()
        renderFail()
        layoutAll()
    }

    private func renderFail() {
        NativeType.set(failNote, tr("X-RESULT.againFailed"), font: ts.font(13), color: color("ink3", .secondaryLabel), align: .center, line: ts.lineHeight(13))
        failNote.isHidden = !againFailed
        failCancel.isHidden = !againFailed
        failRetry.isHidden = !againFailed
        primaryButton.isHidden = againFailed
        if againFailed { redoButton.isHidden = true; againTextButton.isHidden = true }
    }

    /// 只导航：重写错字 / 分享 / 看这个字（结果条目留在栈里，宿主关掉原生页；回来时再盖上）。
    /// B3.11：右上「分享」→ 原生图片预览弹层（网页的弹层不再打开；图与文案由页面用同一批函数给，image.render op）。
    private func openImagePreview() {
        guard !busy else { return }
        guard let engine = (coordinator as? NativeStage)?.engine else {
            go("share") // 没有引擎（老通道）：仍走网页弹层
            return
        }
        dismissUndoForAction()
        let scope: [String: Any] = ["kind": "session", "slot": slot, "sessionId": sessionId]
        Task { @MainActor [weak self] in
            guard let self else { return }
            let sheet = NativeImagePreviewController(engine: engine, scope: scope)
            guard await sheet.prepare() else { return }
            self.present(sheet, animated: true)
        }
    }

    private func go(_ to: String, char: String? = nil) {
        guard !busy else { return }
        dismissUndoForAction()
        var args: [String: Any] = ["slot": slot, "sessionId": sessionId, "to": to]
        if let char { args["char"] = char }
        exitHandled = true
        coordinator?.nativeResultWillNavigate(self)
        bridge.call("resultExit", args) { [weak self] reply in
            if !reply.ok { self?.exitHandled = false }
        }
    }

    // MARK: 对照与改判弹层（与写字页改判弹层同一组件，R9-B）

    private func openCell(_ cell: NativeResultCell) {
        guard !revealing else { return }
        openSheet(recordId: cell.recordId, kind: cell.kind, char: cell.char)
    }

    private func openRow(_ row: NativeResultRow) {
        openSheet(recordId: row.recordId, kind: row.kind, char: row.char)
    }

    private func openSheet(recordId: String?, kind: String?, char: String?) {
        guard presentedViewController == nil, !busy else { return }
        dismissUndoForAction()
        var args: [String: Any] = ["slot": slot, "sessionId": sessionId]
        if let recordId { args["recordId"] = recordId }
        if let kind { args["kind"] = kind }
        if let char { args["char"] = char }
        bridge.call("resultCell", args) { [weak self] reply in
            guard let self, self.presentedViewController == nil, let m = NativeChangeSheetViewController.Model(result: reply.body) else { return }
            let sheet = NativeChangeSheetViewController(slot: self.slot, model: m, bridge: self.bridge, style: self.style) { [weak self] _ in
                self?.stateChangedAt = CACurrentMediaTime()
            }
            sheet.applyCall = { [weak self] to, done in
                guard let self else { return }
                var a: [String: Any] = ["slot": self.slot, "sessionId": self.sessionId, "recordId": m.recordId, "to": to, "width": self.view.bounds.width]
                a["ax"] = self.ts.ax
                self.bridge.call("resultCorrect", a) { [weak self] reply in
                    if reply.ok, let v = reply.body["view"] as? [String: Any] { self?.apply(view: v) }
                    done(reply)
                }
            }
            sheet.onViewChar = { [weak self] c in self?.go("detail", char: c) }
            self.present(sheet, animated: true)
        }
    }

    private func addRow(_ row: NativeResultRow) {
        guard let rid = row.recordId, !busy else { return }
        dismissUndoForAction()
        busy = true
        bridge.call("resultAdd", ["slot": slot, "sessionId": sessionId, "recordId": rid, "width": view.bounds.width, "ax": ts.ax]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            if reply.ok, let v = reply.body["view"] as? [String: Any] {
                self.selectionHaptic.select()
                self.apply(view: v)
            }
        }
    }

    private lazy var selectionHaptic = UISelectionFeedbackGenerator()

    // MARK: 左缘右滑 = 「×」（N3）

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if g === edgeBack { return presentedViewController == nil }
        return true
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { g !== edgeBack }

    @objc private func handleEdgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        switch g.state {
        case .began:
            if revealing { skipReveal() }
            dismissUndoForAction()
            transitions.drag(g, page: self)
        default:
            // B2.8：跟手画回来源的那种转场倒放（同「×」），阈值 BackGestureThreshold；完成后收起，viewDidDisappear 发 resultExit leave
            transitions.drag(g, page: self)
        }
    }
}

// MARK: - 作品（WorkPaper / PlainRow 的原生版）

final class NativeWorkView: UIView {
    struct Look {
        var sheet: UIColor, frame: UIColor, guide: UIColor, hand: SIMD4<Float>?, under: UIColor, zhu: UIColor, seal: UIColor, onSeal: UIColor
        var ink1: UIColor, ink2: UIColor, ink3: UIColor, field: UIColor, type: NativeTypeScale
    }

    var onOpen: ((NativeResultCell) -> Void)?
    private var work = NativeResultWork([:])
    private var look: Look?
    private var cells: [NativeResultCell] = []
    private var sheets: [UIView] = []
    private var cellButtons: [NativeWorkCellButton] = []
    private var statusLabels: [UILabel] = []
    private let framesLayer = CAShapeLayer()
    private let seal = NativeSealView()
    private let kuanLabel = UILabel()
    private var empty: Bool { work.empty }
    private var c: CGFloat { work.c }
    private var cols: Int { work.cols }
    private var rows: Int { work.rows }

    override init(frame: CGRect) {
        super.init(frame: frame)
        framesLayer.fillColor = UIColor.clear.cgColor
        framesLayer.lineWidth = 1
        kuanLabel.accessibilityIdentifier = "native-result-kuan"
        kuanLabel.isAccessibilityElement = false
        seal.accessibilityIdentifier = "native-result-seal"
        isAccessibilityElement = false
        shouldGroupAccessibilityChildren = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(work w: NativeResultWork?, look l: Look) {
        work = w ?? NativeResultWork([:])
        look = l
        cells = work.cells
        subviews.forEach { $0.removeFromSuperview() }
        sheets = []
        cellButtons = []
        statusLabels = []
        framesLayer.removeFromSuperlayer()
        guard w != nil else { isHidden = true; return }
        isHidden = false
        accessibilityLabel = work.label
        if empty {
            for cell in cells {
                let box = UIView()
                box.backgroundColor = l.sheet
                box.layer.borderColor = l.frame.cgColor
                box.layer.borderWidth = 1
                addSubview(box)
                sheets.append(box)
                let b = NativeWorkCellButton(cell: cell, side: c - 2, mode: "under", look: l, pad: 0.12)
                b.addAction(UIAction { [weak self] _ in self?.onOpen?(cell) }, for: .touchUpInside)
                addSubview(b)
                cellButtons.append(b)
                let s = UILabel()
                NativeType.set(s, cell.status, font: l.type.font(13), color: l.ink3, align: .center, line: l.type.lineHeight(13))
                s.isHidden = cell.status.isEmpty
                addSubview(s)
                statusLabels.append(s)
            }
            return
        }
        for _ in work.frames {
            let s = UIView()
            s.backgroundColor = l.sheet
            s.isUserInteractionEnabled = false
            addSubview(s)
            sheets.append(s)
        }
        for (i, cell) in cells.enumerated() {
            let b = NativeWorkCellButton(cell: cell, side: c, mode: "hand", look: l, pad: work.pad, inkScale: work.widthScale)
            b.lastCol = (i + 1) % cols == 0 || i == cells.count - 1
            b.lastRow = i + cols >= cells.count
            b.addAction(UIAction { [weak self] _ in self?.onOpen?(cell) }, for: .touchUpInside)
            addSubview(b)
            cellButtons.append(b)
        }
        framesLayer.strokeColor = l.frame.cgColor
        layer.addSublayer(framesLayer)
        seal.configure(path: work.sealPath, fill: l.seal, glyph: l.onSeal)
        addSubview(seal)
        // 落款是图形：宋 13 / 20 固定，不随系统字号（D49）
        let kfont = NativeType.song(size: 13, weight: .regular)
        kuanLabel.font = kfont
        kuanLabel.textColor = l.ink2
        kuanLabel.text = work.kuan
        addSubview(kuanLabel)
    }

    private var sealBelow: Bool { work.seal.below }

    func height(for width: CGFloat) -> CGFloat {
        guard !cells.isEmpty || !empty else { return 0 }
        if empty {
            let perLine = max(1, Int(width / max(1, c)))
            let lines = Int(ceil(Double(cells.count) / Double(perLine)))
            let statusH = statusLabels.contains { !$0.isHidden } ? 6 + (look?.type.lineHeight(13) ?? 20) : 0
            return CGFloat(lines) * (c + statusH)
        }
        return CGFloat(rows) * c + 14 + (sealBelow ? 24 : 20)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let l = look else { return }
        let W = bounds.width
        if empty {
            let perLine = max(1, min(cells.count, Int(W / max(1, c))))
            let statusH = statusLabels.contains { !$0.isHidden } ? 6 + l.type.lineHeight(13) : 0
            for (i, b) in cellButtons.enumerated() {
                let line = i / perLine, col = i % perLine
                let inLine = min(perLine, cells.count - line * perLine)
                let x0 = (W - CGFloat(inLine) * c) / 2
                let x = x0 + CGFloat(col) * c, y = CGFloat(line) * (c + statusH)
                sheets[i].frame = CGRect(x: x, y: y, width: c, height: c)
                b.frame = CGRect(x: x + 1, y: y + 1, width: c - 2, height: c - 2)
                statusLabels[i].frame = CGRect(x: x, y: y + c + 6, width: c, height: l.type.lineHeight(13))
            }
            return
        }
        let gw = CGFloat(cols) * c
        let sx = (W - gw) / 2
        for (i, f) in work.frames.enumerated() where i < sheets.count {
            sheets[i].frame = f.offsetBy(dx: sx, dy: 0)
        }
        for (i, b) in cellButtons.enumerated() {
            b.frame = CGRect(x: sx + CGFloat(i % cols) * c, y: CGFloat(i / cols) * c, width: c, height: c)
        }
        let path = UIBezierPath()
        for f in work.frames { path.append(UIBezierPath(rect: f.offsetBy(dx: sx, dy: 0).insetBy(dx: 0.5, dy: 0.5))) }
        framesLayer.frame = bounds
        framesLayer.path = path.cgPath
        let gridH = CGFloat(rows) * c
        let signY = gridH + 14
        let kw = ceil(kuanLabel.sizeThatFits(CGSize(width: W, height: 20)).width)
        let s = work.seal
        let sealSize = s.size
        if sealBelow {
            seal.frame = CGRect(x: sx + gw - sealSize, y: signY, width: sealSize, height: sealSize)
            kuanLabel.frame = CGRect(x: sx + gw - sealSize - 8 - kw, y: signY + 2, width: kw, height: 20)
        } else {
            seal.frame = CGRect(x: sx + s.x, y: s.y, width: sealSize, height: sealSize)
            kuanLabel.frame = CGRect(x: sx + gw - kw, y: signY, width: kw, height: 20)
        }
    }

    // 显现
    func prepareReveal() {
        cellButtons.forEach { $0.alpha = 0; $0.transform = CGAffineTransform(translationX: 0, y: 2) }
        kuanLabel.alpha = 0
        seal.alpha = 0
    }

    private var timers: [DispatchWorkItem] = []

    func playReveal(stagger: TimeInterval, cellMs: TimeInterval, kuanDelay: TimeInterval, kuanMs: TimeInterval, sealDelay: TimeInterval, fall: TimeInterval, rebound: TimeInterval,
                    sealFrom: CGFloat, contact: CGFloat, onContact: @escaping () -> Void, onLand: @escaping () -> Void) {
        for (i, b) in cellButtons.enumerated() {
            UIView.animate(withDuration: cellMs, delay: Double(i) * stagger, options: [.curveEaseOut, .allowUserInteraction]) { b.alpha = 1; b.transform = .identity }
        }
        UIView.animate(withDuration: kuanMs, delay: kuanDelay, options: [.curveEaseOut]) { self.kuanLabel.alpha = 1 }
        seal.transform = CGAffineTransform(scaleX: sealFrom, y: sealFrom)
        let start = DispatchWorkItem { [weak self] in
            guard let self else { return }
            UIView.animate(withDuration: fall, delay: 0, options: [.curveEaseOut]) {
                self.seal.alpha = 1
                self.seal.transform = CGAffineTransform(scaleX: contact, y: contact)
            } completion: { _ in
                onContact() // 着纸那一帧：触觉与盖章声
                UIView.animate(withDuration: rebound, delay: 0, options: [.curveEaseOut]) { self.seal.transform = .identity } completion: { _ in onLand() }
            }
        }
        timers.append(start)
        DispatchQueue.main.asyncAfter(deadline: .now() + sealDelay, execute: start)
    }

    func finishReveal() {
        timers.forEach { $0.cancel() }
        timers = []
        for v in cellButtons + [kuanLabel, seal] as [UIView] {
            v.layer.removeAllAnimations()
            v.alpha = 1
            v.transform = .identity
        }
    }
}

/// 作品里的一格（按钮：点开对照弹层）：本人墨（画墨接口）或衬底参考字、写错放进来的朱点、格内底边小注；格间 0.75 guide 线画在右 / 下边（末列 / 末行不画）。
final class NativeWorkCellButton: UIButton {
    var lastCol = true { didSet { setNeedsLayout() } }
    var lastRow = true { didSet { setNeedsLayout() } }
    private let right = UIView()
    private let bottom = UIView()
    private var ink: UIView?
    private let glyph = NativeGlyphView()
    private let dot = UIView()
    private let cap = UILabel()
    private let cell: NativeResultCell
    private let pad: CGFloat
    private let mode: String

    init(cell: NativeResultCell, side: CGFloat, mode: String, look: NativeWorkView.Look, pad: CGFloat, inkScale: Double = 1) {
        self.cell = cell
        self.pad = pad
        self.mode = mode
        super.init(frame: .zero)
        accessibilityLabel = cell.label
        accessibilityIdentifier = "native-result-cell"
        setTitleColor(look.ink1, for: .normal)
        titleLabel?.font = look.type.font(15)
        for g in [right, bottom] {
            g.backgroundColor = look.guide
            g.isUserInteractionEnabled = false
            addSubview(g)
        }
        let inner = side * (1 - 2 * pad)
        let strokes = NativeInkWire.rawStrokes(cell.strokes)
        if mode == "hand", let v = NativeInkPaint.view(strokes: strokes, side: inner, color: look.hand, widthScale: inkScale) {
            ink = v
            addSubview(v)
        } else {
            glyph.char = cell.char ?? ""
            glyph.color = look.under
            glyph.isUserInteractionEnabled = false
            addSubview(glyph)
        }
        if let d = cell.dot {
            dot.frame = CGRect(x: d.cx - d.d / 2, y: d.cy - d.d / 2, width: d.d, height: d.d)
            dot.layer.cornerRadius = d.d / 2
            dot.backgroundColor = look.zhu
            dot.isUserInteractionEnabled = false
            addSubview(dot)
        }
        if let t = cell.cap, !t.isEmpty {
            // 「看后写的」：黑体 11 / 16、500、ink3，格内底边上 4（图形文字，不随字号）
            cap.font = UIFont.systemFont(ofSize: 11, weight: .medium)
            cap.textColor = look.ink3
            cap.textAlignment = .center
            cap.text = t
            cap.isAccessibilityElement = false
            addSubview(cap)
        }
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
        pressColor = look.field
    }

    private var pressColor: UIColor = .clear
    @objc private func down() { backgroundColor = pressColor }
    @objc private func up() { backgroundColor = .clear }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = bounds.width
        let p = s * pad, inner = s - 2 * p
        ink?.frame = CGRect(x: p, y: p, width: inner, height: inner)
        glyph.frame = CGRect(x: p, y: p, width: inner, height: inner)
        right.isHidden = lastCol || mode == "under"
        bottom.isHidden = lastRow || mode == "under"
        right.frame = CGRect(x: s - 0.75, y: 0, width: 0.75, height: bounds.height)
        bottom.frame = CGRect(x: 0, y: bounds.height - 0.75, width: s, height: 0.75)
        cap.frame = CGRect(x: 0, y: bounds.height - 4 - 16, width: s, height: 16)
    }
}

/// 印（<Seal/>：seal 底、直角；白文「拾」= 小尺寸加粗字形，页面给单位方块内的路径；内缩 7% 一圈 on-seal 细线，透明度 .55）。
final class NativeSealView: UIView {
    private let glyph = CAShapeLayer()
    private let line = CAShapeLayer()
    private var unitPath = UIBezierPath()

    func configure(path: [[Any]], fill: UIColor, glyph glyphColor: UIColor) {
        backgroundColor = fill
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        let p = UIBezierPath()
        for seg in path {
            guard let cmd = seg.first as? String else { continue }
            let n = seg.dropFirst().compactMap { ($0 as? NSNumber).map { CGFloat($0.doubleValue) } }
            switch cmd {
            case "M" where n.count >= 2: p.move(to: CGPoint(x: n[0], y: n[1]))
            case "C" where n.count >= 6: p.addCurve(to: CGPoint(x: n[4], y: n[5]), controlPoint1: CGPoint(x: n[0], y: n[1]), controlPoint2: CGPoint(x: n[2], y: n[3]))
            case "Z": p.close()
            default: break
            }
        }
        unitPath = p
        glyph.fillColor = glyphColor.cgColor
        line.fillColor = UIColor.clear.cgColor
        line.strokeColor = glyphColor.cgColor
        line.lineWidth = 1
        line.opacity = 0.55
        if glyph.superlayer == nil { layer.addSublayer(line); layer.addSublayer(glyph) }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = bounds.width
        let p = unitPath.copy() as! UIBezierPath // swiftlint:disable:this force_cast
        p.apply(CGAffineTransform(scaleX: s, y: s))
        glyph.frame = bounds
        glyph.path = p.cgPath
        line.frame = bounds
        line.path = UIBezierPath(rect: bounds.insetBy(dx: s * 0.07 + 0.5, dy: s * 0.07 + 0.5)).cgPath
    }
}

// MARK: - 没放进图里的一行（WorkRows）

final class NativeResultRowView: UIView {
    struct Look {
        var ink1: UIColor, ink2: UIColor, ink3: UIColor, under: UIColor, zhu: UIColor, hand: SIMD4<Float>?, field: UIColor, type: NativeTypeScale, addIn: String
    }

    var onOpen: ((NativeResultRow) -> Void)?
    var onChange: ((NativeResultRow) -> Void)?
    var onAdd: ((NativeResultRow) -> Void)?
    private(set) var row = NativeResultRow([:])
    private let openButton = NativeRowOpenButton(type: .custom)
    private let changeButton = NativeTextButton(type: .system)
    private let addButton = NativeTextButton(type: .system)
    /// 一行的高（标准 52；AX 档折行后按内容，见 plan）。
    private var type = NativeType()
    private var glyphSide: CGFloat = 36

    override init(frame: CGRect) {
        super.init(frame: frame)
        openButton.accessibilityIdentifier = "native-result-row-open"
        changeButton.accessibilityIdentifier = "native-result-row-change"
        addButton.accessibilityIdentifier = "native-result-row-add"
        openButton.addAction(UIAction { [weak self] _ in guard let self else { return }; self.onOpen?(self.row) }, for: .touchUpInside)
        changeButton.addAction(UIAction { [weak self] _ in guard let self else { return }; self.onChange?(self.row) }, for: .touchUpInside)
        addButton.addAction(UIAction { [weak self] _ in guard let self else { return }; self.onAdd?(self.row) }, for: .touchUpInside)
        [openButton, changeButton, addButton].forEach { addSubview($0) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(row r: NativeResultRow, glyph: CGFloat, pad: CGFloat, look: Look) {
        row = r
        type = look.type.type
        glyphSide = glyph
        openButton.configure(row: r, glyph: glyph, pad: pad, look: look)
        changeButton.isHidden = !r.change
        addButton.isHidden = !r.add
        // 「修改 ›」：写字页结果行同一个组件（R9-B：13 ink1，盒 = 字宽 + 8，至少 44）
        changeButton.setTitle(r.changeLabel, for: .normal)
        changeButton.titleLabel?.font = look.type.font(13)
        changeButton.setTitleColor(look.ink1, for: .normal)
        changeButton.contentHorizontalAlignment = .left
        changeButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        changeButton.accessibilityLabel = r.changeAria
        addButton.setTitle(look.addIn, for: .normal)
        addButton.titleLabel?.font = look.type.font(15)
        addButton.setTitleColor(look.ink2, for: .normal)
        addButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        addButton.contentHorizontalAlignment = .left
        addButton.accessibilityLabel = r.addAria
        setNeedsLayout()
    }

    /// AX 档（网页 :root[data-ax] .sz-exrow）：行可折——主体占满一行（高 = max(52, 行高)），「修改 ›」「放进图里」各自按字号长高、左让出字宽 + 12，
    /// 一行放不下就折到下一行（行距 / 列距 4），整行上下内边距 6。返回各按钮的框与行高；不在 AX 档 → nil。
    private func axPlan(width: CGFloat) -> (open: CGRect, frames: [(UIButton, CGRect)], height: CGFloat)? {
        guard type.ax, let pad = type.role("exrow", "padTop", sub: "r5") else { return nil }
        let gap = type.role("exrow", "gap", sub: "r5") ?? 4
        let colGap = type.role("exrow", "colGap", sub: "r5") ?? 4
        let openH = max(type.role("exrow", "minH", sub: "r2") ?? 52, type.roleLine("exrow", sub: "r3") ?? 0)
        var items: [(UIButton, CGFloat, CGFloat, CGFloat)] = [] // 按钮、外边距左、宽、高
        if !changeButton.isHidden {
            items.append((changeButton, type.role("exrow", "marginLeft", sub: "r4") ?? glyphSide + 12, max(44, NativeType.titleWidth(changeButton) + 8),
                          max(44, type.role("exrow", "minH", sub: "r4") ?? 44)))
        }
        if !addButton.isHidden {
            items.append((addButton, type.role("exrow", "marginLeft") ?? glyphSide + 12, NativeType.titleWidth(addButton) + 8, max(44, type.role("exrow", "minH") ?? 44)))
        }
        var y = pad + openH
        var frames: [(UIButton, CGRect)] = []
        var line: [(UIButton, CGFloat, CGFloat, CGFloat)] = []
        var used: CGFloat = 0
        func flush() {
            guard !line.isEmpty else { return }
            let lh = line.map { $0.3 }.max() ?? 0
            var x: CGFloat = 0
            for (i, it) in line.enumerated() {
                x += (i == 0 ? 0 : colGap) + it.1
                frames.append((it.0, CGRect(x: x, y: y + gap + (lh - it.3) / 2, width: it.2, height: it.3)))
                x += it.2
            }
            y += gap + lh
            line = []
            used = 0
        }
        for it in items {
            let need = (line.isEmpty ? 0 : colGap) + it.1 + it.2
            if !line.isEmpty, used + need > width + 0.5 { flush() }
            used += (line.isEmpty ? 0 : colGap) + it.1 + it.2
            line.append(it)
        }
        flush()
        return (CGRect(x: 0, y: pad, width: width, height: openH), frames, y + pad)
    }

    func height(for width: CGFloat) -> CGFloat { axPlan(width: width)?.height ?? 52 }

    override func layoutSubviews() {
        super.layoutSubviews()
        NativeType.linkTitle(changeButton) // 「修改 ›」：字与「›」间距 4、中文字距同网页（B2.9b）
        NativeType.trackTitle(addButton)
        if let p = axPlan(width: bounds.width) {
            openButton.frame = p.open
            for (b, f) in p.frames { b.frame = f }
            return
        }
        let height: CGFloat = 52
        var right = bounds.width
        if !addButton.isHidden {
            let aw = NativeType.titleWidth(addButton) + 8
            addButton.frame = CGRect(x: right + 4 - aw, y: (height - 44) / 2, width: aw, height: 44)
            right = addButton.frame.minX
            if !changeButton.isHidden {
                let cw = max(44, NativeType.titleWidth(changeButton) + 8)
                changeButton.frame = CGRect(x: right - cw, y: (height - 44) / 2, width: cw, height: 44)
                right = changeButton.frame.minX - 4
            }
        } else if !changeButton.isHidden {
            let cw = max(44, NativeType.titleWidth(changeButton) + 8)
            changeButton.frame = CGRect(x: right - cw, y: (height - 44) / 2, width: cw, height: 44)
            right = changeButton.frame.minX - 4
        }
        openButton.frame = CGRect(x: 0, y: 0, width: right, height: height)
    }
}

/// 一行的主体（按钮：点开对照弹层）：36 的字（有墨画本人墨，没墨画衬底）+ 写错的朱点 + 12 + 状态（17 / lh17s ink2，「· 纸上」ink3）。
final class NativeRowOpenButton: UIButton {
    private var ink: UIView?
    private let glyph = NativeGlyphView()
    private let dot = UIView()
    private var glyphSide: CGFloat = 36
    private var pad: CGFloat = 0.03
    private var lineH: CGFloat = 22
    private var pressColor: UIColor = .clear

    func configure(row r: NativeResultRow, glyph side: CGFloat, pad p: CGFloat, look: NativeResultRowView.Look) {
        glyphSide = side
        pad = p
        lineH = look.type.lh17s
        accessibilityLabel = r.label
        ink?.removeFromSuperview()
        ink = nil
        let text = r.text
        let tag = r.tag
        let f = look.type.font(17)
        let s = NSMutableAttributedString(string: text, attributes: [.font: f, .foregroundColor: look.ink2, .kern: 0])
        if !tag.isEmpty { s.append(NSAttributedString(string: " " + tag, attributes: [.font: f, .foregroundColor: look.ink3, .kern: 0])) }
        // 中文字距同网页（B2.9b，NativeType.cjkTrack）
        let k = NativeType.cjkTrack(size: f.pointSize, weight: NativeType.weight(of: f))
        if k != 0 {
            var i = 0
            for ch in s.string {
                let n = (String(ch) as NSString).length
                if ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 }) { s.addAttribute(.kern, value: k, range: NSRange(location: i, length: n)) }
                i += n
            }
        }
        setAttributedTitle(s, for: .normal)
        setTitleColor(look.ink2, for: .normal)
        titleLabel?.font = f
        titleLabel?.lineBreakMode = .byTruncatingTail
        contentHorizontalAlignment = .left
        let inner = side * (1 - 2 * p)
        if r.mode == "hand", let v = NativeInkPaint.view(strokes: NativeInkWire.rawStrokes(r.strokes), side: inner, color: look.hand, widthScale: r.widthScale) {
            v.isUserInteractionEnabled = false
            ink = v
            addSubview(v)
            glyph.isHidden = true
        } else {
            glyph.isHidden = false
            glyph.char = r.char ?? ""
            glyph.color = look.under
            glyph.isUserInteractionEnabled = false
            if glyph.superview == nil { addSubview(glyph) }
        }
        if let d = r.dot {
            dotSpec = (d.cx, d.cy, d.d)
            dot.frame = CGRect(x: d.cx - d.d / 2, y: (52 - side) / 2 + d.cy - d.d / 2, width: d.d, height: d.d)
            dot.layer.cornerRadius = d.d / 2
            dot.backgroundColor = look.zhu
            dot.isUserInteractionEnabled = false
            dot.isHidden = false
            if dot.superview == nil { addSubview(dot) }
        } else {
            dot.isHidden = true
            dotSpec = nil
        }
        pressColor = look.field
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
        setNeedsLayout()
    }

    @objc private func down() { backgroundColor = pressColor }
    @objc private func up() { backgroundColor = .clear }

    override func titleRect(forContentRect r: CGRect) -> CGRect {
        let x = glyphSide + 12
        return CGRect(x: x, y: (bounds.height - lineH) / 2, width: max(0, bounds.width - x), height: lineH)
    }

    /// 朱点（相对字格：中心 cx / cy、直径 d）；行高随 AX 档变时跟着字格竖向居中。
    private var dotSpec: (cx: CGFloat, cy: CGFloat, d: CGFloat)?

    override func layoutSubviews() {
        super.layoutSubviews()
        let y = (bounds.height - glyphSide) / 2
        if let d = dotSpec { dot.frame = CGRect(x: d.cx - d.d / 2, y: y + d.cy - d.d / 2, width: d.d, height: d.d) }
        let p = glyphSide * pad, inner = glyphSide - 2 * p
        ink?.frame = CGRect(x: p, y: y + p, width: inner, height: inner)
        glyph.frame = CGRect(x: p, y: y + p, width: inner, height: inner)
    }
}

// MARK: - 提醒邀请（ReminderInvite）

final class NativeInviteView: UIView {
    struct Look {
        var ink1: UIColor, ink2: UIColor, ink3: UIColor, ink4: UIColor, line: UIColor, frame: UIColor, field: UIColor, type: NativeTypeScale
    }
    struct Strings {
        var title = "", titleEvening = "", body = NativeInviteBody(nil), yes = "", no = "", changeTime = "", blank = "", saveFailed = "", cancel = "", retry = ""
    }
    enum Phase: Equatable {
        case wait, invite, pending, gone
        case line(String, time: (Int, Int)?)
        static func == (a: Phase, b: Phase) -> Bool {
            switch (a, b) {
            case (.wait, .wait), (.invite, .invite), (.pending, .pending), (.gone, .gone): return true
            case let (.line(x, _), .line(y, _)): return x == y
            default: return false
            }
        }
    }

    var look: Look? { didSet { render() } }
    var strings = Strings() { didSet { render() } }
    var phase: Phase = .wait { didSet { render() } }
    var evening = false { didSet { render() } }
    var failed = false { didSet { render() } }
    var timeFailed = false { didSet { render() } }
    /// 邀请说明的网页折行点（单位 = 字或被遮住的那一位）。
    var bodyBreaks: [Int] = []
    var onYes: (() -> Void)?
    var onNo: (() -> Void)?
    var onTime: ((Int, Int) -> Void)?
    var onDismissFail: (() -> Void)?

    private let hair = UIView()
    private let titleLabel = UILabel()
    private let bodyLabel = NativeAttachmentLabel()
    private let lineLabel = UILabel()
    private let noteLabel = UILabel()
    private let yesButton = UIButton(type: .system)
    private let noButton = NativeTextButton(type: .system)
    private let timeButton = NativeTextButton(type: .system)
    private let timePicker = UIDatePicker()
    private let failCancel = NativeTextButton(type: .system)
    private let failRetry = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityIdentifier = "native-result-invite-title"
        bodyLabel.numberOfLines = 0
        bodyLabel.accessibilityIdentifier = "native-result-invite-body"
        lineLabel.numberOfLines = 0
        lineLabel.accessibilityIdentifier = "native-result-invite-line"
        noteLabel.numberOfLines = 0
        yesButton.accessibilityIdentifier = "native-result-invite-yes"
        noButton.accessibilityIdentifier = "native-result-invite-no"
        timeButton.accessibilityIdentifier = "native-result-invite-time"
        yesButton.addAction(UIAction { [weak self] _ in self?.onYes?() }, for: .touchUpInside)
        failRetry.addAction(UIAction { [weak self] _ in self?.onYes?() }, for: .touchUpInside)
        noButton.addAction(UIAction { [weak self] _ in self?.onNo?() }, for: .touchUpInside)
        failCancel.addAction(UIAction { [weak self] _ in self?.onDismissFail?() }, for: .touchUpInside)
        // 「改时间」：外观是文字按钮，上面盖一个几乎透明的系统时间选择器（网页同一做法：透明 <input type=time>，点一下直接弹时间轮）
        timePicker.datePickerMode = .time
        timePicker.preferredDatePickerStyle = .compact
        timePicker.alpha = 0.02
        timePicker.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            let c = Calendar.current.dateComponents([.hour, .minute], from: self.timePicker.date)
            self.onTime?(c.hour ?? 0, c.minute ?? 0)
        }, for: .valueChanged)
        [hair, titleLabel, bodyLabel, lineLabel, noteLabel, yesButton, noButton, timeButton, timePicker, failCancel, failRetry].forEach { addSubview($0) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func render() {
        guard let l = look else { return }
        hair.backgroundColor = l.line
        NativeType.set(titleLabel, evening ? strings.titleEvening : strings.title, font: l.type.font(17, .medium), color: l.ink1, line: l.type.lh17s)
        bodyLabel.setBody(strings.body, font: l.type.font(13), color: l.ink3, line: l.type.lineHeight(13), box: l.frame, blankLabel: strings.blank, breaks: bodyBreaks)
        yesButton.setTitle(strings.yes, for: .normal)
        yesButton.titleLabel?.font = l.type.font(15, .medium)
        yesButton.setTitleColor(l.ink1, for: .normal)
        yesButton.setTitleColor(l.ink4, for: .disabled)
        yesButton.layer.cornerRadius = 12
        yesButton.layer.cornerCurve = .continuous
        yesButton.layer.borderWidth = 1
        yesButton.layer.borderColor = l.ink4.cgColor
        noButton.setTitle(strings.no, for: .normal)
        noButton.titleLabel?.font = l.type.font(15)
        noButton.setTitleColor(l.ink2, for: .normal)
        noButton.setTitleColor(l.ink4, for: .disabled)
        noButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        timeButton.setTitle(strings.changeTime, for: .normal)
        timeButton.titleLabel?.font = l.type.font(15)
        timeButton.setTitleColor(l.ink2, for: .normal)
        timeButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        timePicker.accessibilityLabel = strings.changeTime
        failRetry.setTitle(strings.retry, for: .normal)
        failRetry.titleLabel?.font = l.type.font(15, .medium)
        failRetry.setTitleColor(l.ink1, for: .normal)
        failRetry.layer.cornerRadius = 12
        failRetry.layer.borderWidth = 1
        failRetry.layer.borderColor = l.ink4.cgColor
        failCancel.setTitle(strings.cancel, for: .normal)
        failCancel.titleLabel?.font = l.type.font(15)
        failCancel.setTitleColor(l.ink2, for: .normal)
        let inviting = phase == .invite || phase == .pending
        var lineText: String?
        var time: (Int, Int)?
        if case let .line(t, tm) = phase { lineText = t; time = tm }
        titleLabel.isHidden = !inviting
        bodyLabel.isHidden = !inviting
        yesButton.isHidden = !inviting || failed
        noButton.isHidden = !inviting || failed
        yesButton.isEnabled = phase != .pending
        noButton.isEnabled = phase != .pending
        failCancel.isHidden = !(inviting && failed)
        failRetry.isHidden = !(inviting && failed)
        lineLabel.isHidden = lineText == nil
        NativeType.set(lineLabel, lineText ?? "", font: l.type.font(15), color: l.ink2, line: l.type.lineHeight(15))
        timeButton.isHidden = time == nil
        timePicker.isHidden = time == nil
        if let (h, m) = time, let d = Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date()) { timePicker.date = d }
        let note = (inviting && failed) || (time != nil && timeFailed) ? strings.saveFailed : ""
        noteLabel.isHidden = note.isEmpty
        NativeType.set(noteLabel, note, font: l.type.font(13), color: l.ink3, line: l.type.lineHeight(13))
        accessibilityIdentifier = "native-result-invite"
        setNeedsLayout()
    }

    func height(for W: CGFloat) -> CGFloat { layoutAll(width: W, apply: false) }

    override func layoutSubviews() {
        super.layoutSubviews()
        layoutAll(width: bounds.width, apply: true)
    }

    @discardableResult
    private func layoutAll(width W: CGFloat, apply: Bool) -> CGFloat {
        guard let l = look else { return 0 }
        if apply { hair.frame = CGRect(x: 0, y: 0, width: W, height: 0.5) }
        var y: CGFloat = 16
        var first = true
        func add(_ v: UIView, _ h: CGFloat, x: CGFloat = 0, w: CGFloat? = nil, gap: CGFloat = 4) {
            if !first { y += gap }
            first = false
            if apply { v.frame = CGRect(x: x, y: y, width: w ?? W, height: h) }
            y += h
        }
        if !titleLabel.isHidden { add(titleLabel, NativeType.height(titleLabel, width: W, line: l.type.lh17s)) }
        if !bodyLabel.isHidden { add(bodyLabel, NativeResultViewController.paraHeight(bodyLabel, width: W, line: l.type.lineHeight(13))) }
        if !lineLabel.isHidden { add(lineLabel, NativeType.height(lineLabel, width: W, line: l.type.lineHeight(15))) }
        if !noteLabel.isHidden { add(noteLabel, NativeType.height(noteLabel, width: W, line: l.type.lineHeight(13))) }
        // 按钮行：上外边 10、间 8（.sz-invite__acts）
        let rowH: CGFloat = 44
        if !yesButton.isHidden {
            if !first { y += 4 + 10 }
            first = false
            // AX 档（网页 .sz-invite__acts：flex-wrap、gap 8；按钮按字号长高，放不下一行时「先不用」折到下一行）
            let ty = l.type.type
            let isAX = l.type.ax
            let yh = ty.axButtonHeight("invite", title: yesButton.title(for: .normal), font: yesButton.titleLabel?.font, width: W - 44) ?? rowH
            let nMin: CGFloat = ty.role("invite", "minH", sub: "r2") ?? 44
            let nh: CGFloat = isAX ? max(44, nMin) : rowH
            let ywAll = NativeType.width(yesButton.titleLabel ?? UILabel()) + 44
            let nwAll = NativeType.width(noButton.titleLabel ?? UILabel()) + 8
            let rowEnd: CGFloat = ywAll + 8 + nwAll - 4
            let wrap: Bool = isAX && rowEnd > W + 0.5
            let rowsH: CGFloat = wrap ? yh + 8 + nh : max(yh, nh)
            if apply {
                let yw = NativeType.width(yesButton.titleLabel ?? UILabel()) + 44
                let nw = NativeType.width(noButton.titleLabel ?? UILabel()) + 8
                yesButton.frame = CGRect(x: 0, y: wrap ? y : y + (rowsH - yh) / 2, width: yw, height: yh)
                let nx: CGFloat = wrap ? -4 : yw + 4
                let ny: CGFloat = wrap ? y + yh + 8 : y + (rowsH - nh) / 2
                noButton.frame = CGRect(x: nx, y: ny, width: nw, height: nh)
            }
            y += rowsH
        } else if !failRetry.isHidden {
            if !first { y += 4 + 10 }
            first = false
            if apply {
                let half = (W - 12) / 2
                let fw = NativeType.width(failCancel.titleLabel ?? UILabel()) + 8
                failCancel.frame = CGRect(x: (half - fw) / 2, y: y, width: fw, height: rowH)
                failRetry.frame = CGRect(x: half + 12, y: y, width: half, height: rowH)
            }
            y += rowH
        } else if !timeButton.isHidden {
            if !first { y += 4 + 10 }
            first = false
            if apply {
                let tw = NativeType.width(timeButton.titleLabel ?? UILabel()) + 8
                timeButton.frame = CGRect(x: -4, y: y, width: tw, height: rowH)
                timePicker.frame = timeButton.frame
            }
            y += rowH
        }
        return y
    }
}

/// 邀请说明：示例词里被遮住的那一位画成描边小方框（0.9em、格框色 1pt，下沉 0.12em；读屏「空着的字」），不用与「口」难分的 □（N2-13）。
/// 比对与读屏用的文字不含占位符（text 取不带附件字符的那一串）。
final class NativeAttachmentLabel: UILabel, ShiziDrawnLines {
    private var plain = ""
    private var boxColor: UIColor = .clear
    private var boxSide: CGFloat = 0
    private var boxDrop: CGFloat = 0
    private var boxShift: CGFloat = 0

    /// 描边小方框的四条边（取证用：网页是 border 方框，原生画在附件图里，工具看不见）。位置按同宽 TextKit 排版取。
    var drawnLines: [(CGRect, UIColor)] {
        guard let at = attributedText, boxSide > 0, bounds.width > 0 else { return [] }
        let storage = NSTextStorage(attributedString: at)
        let lm = NSLayoutManager()
        let tc = NSTextContainer(size: CGSize(width: bounds.width, height: .greatestFiniteMagnitude))
        tc.lineFragmentPadding = 0
        lm.addTextContainer(tc)
        storage.addLayoutManager(lm)
        lm.ensureLayout(for: tc)
        let used = lm.usedRect(for: tc)
        let dy = max(0, (bounds.height - used.height) / 2)
        var out: [(CGRect, UIColor)] = []
        at.enumerateAttribute(.attachment, in: NSRange(location: 0, length: at.length)) { v, r, _ in
            guard v != nil else { return }
            let g = lm.glyphIndexForCharacter(at: r.location)
            let frag = lm.lineFragmentRect(forGlyphAt: g, effectiveRange: nil)
            let loc = lm.location(forGlyphAt: g)
            let f = (self.font ?? UIFont.systemFont(ofSize: 13)).pointSize
            let x = frag.minX + loc.x + f * 0.06
            let fnt = self.font ?? UIFont.systemFont(ofSize: 13)
            // 钉了行盒（AX 档）：字在行盒里竖向居中，基线 = 行盒顶 + (行盒 − 字高) / 2 + 升部（与 NativeType.set 的居中同口径）；没钉：TextKit 的基线
            let baseline = self.boxShift != 0 ? frag.minY + (frag.height - (fnt.ascender - fnt.descender)) / 2 + fnt.ascender : frag.minY + loc.y
            let bottom = baseline + self.boxDrop + dy
            let top = bottom - self.boxSide
            let s = self.boxSide
            out += [(CGRect(x: x, y: top, width: s, height: 1), self.boxColor), (CGRect(x: x, y: bottom - 1, width: s, height: 1), self.boxColor),
                    (CGRect(x: x, y: top, width: 1, height: s), self.boxColor), (CGRect(x: x + s - 1, y: top, width: 1, height: s), self.boxColor)]
        }
        return out
    }

    override var text: String? {
        get { attributedText == nil ? super.text : plain }
        set { super.text = newValue; plain = newValue ?? "" }
    }

    func setBody(_ body: NativeInviteBody, font: UIFont, color: UIColor, line: CGFloat, box: UIColor, blankLabel: String, breaks: [Int] = []) {
        let f = NativeType.hasCJKPunctuation(body.pre + (body.plain ?? "")) ? NativeType.cjkFont(size: font.pointSize, weight: .regular) : font
        let p = NSMutableParagraphStyle()
        p.lineSpacing = max(0, line - f.lineHeight)
        // 网页行高比字体自然行高小（AX 档苹方）：行盒钉成网页行高，字在行盒里竖向居中（同 NativeType.set）
        boxShift = 0
        if line > 0, line < f.lineHeight - 0.01 {
            p.minimumLineHeight = line
            p.maximumLineHeight = line
            p.lineSpacing = 0
            boxShift = (line - f.lineHeight) / 4
        }
        // 字距同 NativeType.set：先铺显式 0；含全角标点时拉丁 / 数字按 SF 字宽排，中文字补 trak 差（网页是 SF + 苹方 UI）
        var attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: color, .paragraphStyle: p, .kern: 0]
        if boxShift != 0 { attrs[.baselineOffset] = boxShift }
        let allText = body.plain ?? (body.pre + body.word.joined() + body.post)
        let punct = NativeType.hasCJKPunctuation(allText)
        let track = NativeType.hasCJK(allText) ? NativeType.cjkTrack(size: font.pointSize, weight: NativeType.weight(of: font)) : 0
        let sf = UIFont.systemFont(ofSize: font.pointSize, weight: NativeType.weight(of: font))
        let charAttrs = { (ch: Character) -> [NSAttributedString.Key: Any] in
            var a = attrs
            let cjk = ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 })
            if punct, !cjk {
                let want = (String(ch) as NSString).size(withAttributes: [.font: sf]).width
                let have = (String(ch) as NSString).size(withAttributes: [.font: f]).width
                a[.kern] = want - have
            } else if cjk, track != 0 {
                a[.kern] = track
            }
            return a
        }
        let out = NSMutableAttributedString()
        boxSide = 0
        var spoken = ""
        var unit = 0
        let addText = { (t: String) in
            for ch in t {
                if breaks.contains(unit) { out.append(NSAttributedString(string: "\n", attributes: attrs)) }
                out.append(NSAttributedString(string: String(ch), attributes: charAttrs(ch)))
                unit += 1
            }
        }
        if let plainText = body.plain {
            addText(plainText)
            spoken = plainText
        } else {
            let pre = body.pre, post = body.post
            let word = body.word
            let blanks = body.blanks
            addText(pre)
            spoken += pre
            for (i, ch) in word.enumerated() {
                if i < blanks.count, blanks[i] {
                    if breaks.contains(unit) { out.append(NSAttributedString(string: "\n", attributes: attrs)) }
                    unit += 1
                    let side = round(f.pointSize * 0.9 * 10) / 10
                    boxColor = box; boxSide = side; boxDrop = f.pointSize * 0.12
                    let img = UIGraphicsImageRenderer(size: CGSize(width: side + f.pointSize * 0.12, height: side)).image { _ in
                        let r = CGRect(x: f.pointSize * 0.06 + 0.5, y: 0.5, width: side - 1, height: side - 1)
                        box.setStroke()
                        let b = UIBezierPath(rect: r)
                        b.lineWidth = 1
                        b.stroke()
                    }
                    let a = NSTextAttachment()
                    a.image = img
                    a.bounds = CGRect(x: 0, y: -f.pointSize * 0.12, width: img.size.width, height: side)
                    let s = NSMutableAttributedString(attachment: a)
                    s.addAttributes(attrs, range: NSRange(location: 0, length: s.length))
                    out.append(s)
                    spoken += blankLabel
                } else {
                    addText(ch)
                    spoken += ch
                }
            }
            addText(post)
            spoken += post
        }
        self.font = f
        attributedText = out
        plain = out.string.replacingOccurrences(of: "\u{FFFC}", with: "")
        accessibilityLabel = spoken
    }
}
