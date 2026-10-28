import UIKit
import WebKit

// 原生写字页（B2.0 纵切 → B2.2 回忆阶段完整版 + 提示；docs/engineering/v10/B2-原生写字架构.md §6、§11；确认单 2、3）。
// B3.1 起是 Release 组件（与 ShiziKit 一起进包）；只在开关 -shizi-native-write 打开时出现（默认关，B3.F 翻转导航真相源时去掉开关）。
//
// 版式（A7 / D57；01 §6.1；NativeWriteLayout 与网页 layout.js 同一组公式）：
//   页头：左「‹」（44 × 44，图标外缘落在 20pt 页边线）、中间「n / 总数」（回忆阶段没有可见标题，读屏「第 n 个字，共 m 个」）、右上「跳过」与「结束这组」的位置
//         （按钮在 B2.6 接上功能前不显示）；
//   题面（词语 + 拼音，要写的字是空格；有提示行时在格下一行）→ 16 → 书写格（边长只由视口决定，258–400）→ 格下：撤销（贴格左沿）/ 清空（贴格右沿），
//   再下面是说明位：「上一个字」结果行（D19：落笔后收起；「修改 ›」由 B2.5 接）与提示说明（没有笔顺数据时一句）；
//   底栏：求助行（主按钮正上方 20 的凹面按钮：提示 / 看答案——看答案在 B2.4 接上前不显示，提示占满一行）+ 主按钮「写好了」（没写时不能点），
//   主按钮下沿 = 屏底 − max(24, 下安全区)。书写格顶边在同一张卡的所有阶段不动（D53 ②）。
//   字号：全部系统字体 + adjustsFontForContentSizeCategory，按量到的行高排；书写格边长与字号无关（D36）。AX 档的专门排法在 B2.9。
// 判断（B2.5 完整版；确认单 5、D46 ⑪、D49、D55）：书写格收成上格（你写的）、下格标准写法，同一顶边、同一中线、共用一条 1pt 格线（第二格上移 1pt）；
//   页头「‹」（读屏「接着写」）/ 中间标题 / 右侧计数；题面与写字页相同、目标格不显示答案；两键「写错了 / 写对了」在主按钮的位置，同一个样式、
//   无预选、无着色；两键按时刻编排出现（0–judgeAppear 不显示，之后 60% 且不可点，judgeReady 变实可点；减少动态效果与读屏直接可点）；没有本人笔画时上格「这次没写」；
//   进判断页时读屏焦点落在页标题。回忆 → 判断：本人墨以顶边中点为原点纯缩放（inkFlip，ease.out），参考格 fade 后淡入（T-phase）；
//   「‹ 接着写」与左缘右滑是同一个动作：判断 → 回忆的 T-phase 倒放（phaseReverse，左缘滑回跟手，过阈值才完成），书写格与笔迹原样回来。
//   判断落定（M23，NativeJudge.swift）：提交成功后本人笔迹离纸、收进页头计数，触觉与第一帧同帧；失败走三段式（说明 → 先不保存 → 再试一次）。
//   改判（D19）：回忆阶段的结果行「修改 ›」→ 改判弹层（NativeChangeSheetViewController）→ correct op。
// 提交：judge 经桥由页面 store.commit 完成；成功才推进（D07），失败留在判断页三段式（R-W16）。现场：抬笔 / 撤销 / 清空后发 strokes（P52 不等）。
// 提示（D64 ①，NativeHint.swift）：每点一次经 hint op 多给一段（规则在页面），淡朱实填画在本人墨下面、整组淡入；写过哪笔收哪笔、撤销回来；
//   整字给完 = 看过答案（同一次写入），按钮留着变灰；读屏播报给出了哪几笔（页面给的那句）。
// 换字 / 换阶段（交互规范 T0 / T-phase；确认单 2）：按钮 0.4s 不响应（网页 markStateChange 同一个值，返回键除外）；换字后 250ms 内落下的笔先持住、到点补画
//   （P227）；换字转场：内容变了的文字区旧的 0–75ms 淡出、新的 75–150ms 淡入，书写格 / 墨 / 提示 / 参考格这些非文字的旧样子 150ms 淡出；
//   减少动态效果下一律 150ms 交叉淡化。转场中落笔或点按：动画一帧到终态，这次输入照常生效（T0 规则 3）。
// 看答案 / 描一遍 / 凭记忆写（B2.4，NativeTrace.swift；确认单 4；D64 ②、D66 ①、D68 ②）：「看答案」经 showAnswer op 直接进描一遍——标准写法淡显在格子里（当前一笔实心、其余双钩、
//   写过的被墨盖住，D53 ①），每字第一次先快放一遍笔顺（≤ 1.6s，落笔即跳过）；主按钮「凭记忆写」（answerPhase：清空、只算练习）、求助行「下一个」（answerNext）；
//   凭记忆写：求助行「再描一遍」、主按钮「下一个」；格下说明「记为看过答案。」/ 「这个字看过答案了，再写只算练习。」。提示给完整字（看过答案、留在回忆阶段）底栏同口径：主按钮「下一个」、
//   求助行「看答案」+ 不可点的「提示」。页头：描一遍 / 凭记忆写中间是阶段标题、右边是进度 + 「结束这组」，「‹」读作「离开」。
// 跳过 / 撤销 / 结束这组（B2.6，NativeSkipEnd.swift；确认单 6、7；D68 ③ ④）：页头右上 [结束这组][跳过]；跳过直接生效（skip op），底部「已跳过「X」· 撤销」5 秒（按住暂停、读屏不自动收起、
//   下一字落笔 / 点提示 / 点看答案 / 开结束确认框就收起），撤销 = undoSkip（字、提示次数、笔画放回）；最后一字跳过 / 带着撤销条离开时，剩余的撤销机会随 exit 交给结果页 / 来源页（S4）。
//   「结束这组」经 end op 取数字（counts）弹居中确认框（不预选、点遮罩 = 接着写），确认后：有判断 → exit result 换成结果页，零判断 → 回来源。看答案 / 跳过 / 结束写入失败：就地三段式（R-W16）。
// 重写错字（B2.9a；确认单 §9、D66 ③）：同一个页面换成只练习的模式（redo）——页面给字表与每个字的快照（redoOpen / redoNext，网页 write/redo.js 同一份字表与题面）；
//   写：题面 → 书写格（同一套书写面、撤销 / 清空、格外起笔、手掌规则）→ 格下说明「再写一遍，只算练习。」→ 求助行「看答案」（无图标，直接去对照）+ 主按钮「写好了」；
//   对照：判断页的两格版式、没有判断键 → 求助行「再写一次」（空格重写这个字）+ 主按钮「下一个」（最后一个「完成」：滑出回到结果页）。
//   页头：「‹」整页离开（左缘右滑同义，对照阶段也是离开）、中间「n / 总数」。不发任何写入 op（现场 / 阶段 / 提示 / 判断 / 首练提示），离开发 redoExit。
// 文案：全部取自页面 src/config/copy（open 回包的 copy 字典与 hint op 的回包），本文件不写任何用户可见的字。

protocol NativeWriteCoordinating: AnyObject {
    func nativeWriteDidRequestBack(_ vc: NativeWriteViewController)
    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String)
    /// undo：跳过最后一字后 5 秒撤销机会还在时，随 exit 交给结果页（B2.6）。
    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String, undo: [String: Any]?)
    /// B2.8：改判弹层「看这个字 ›」——协调者把原生页的样子交给宿主层、请页面推入字详情、页面画好后收起原生页（推入由网页播）。
    func nativeWriteOpenDetail(_ vc: NativeWriteViewController, char: String)
}

final class NativeWriteViewController: UIViewController {
    /// recall / compare 是 B2.0 起的两个阶段；trace（描一遍）/ retrace（凭记忆写）是看答案流程（B2.4）。看过答案后回到的回忆阶段仍是 recall（answerSeen 为真）。
    enum Phase { case recall, compare, trace, retrace }

    /// 看答案流程 / 跳过里「没保存上」要重做的那一步（就地三段式：主按钮「再试一次」、求助行「先不保存」）。
    enum FlowAction: Equatable {
        case showAnswer
        case answerPhase(String)
        case answerNext
        case skip
    }

    let slot: String
    /// B2.9a：重写错字页（只练习、不记录；见文件头）。字表随 redoOpen 给出，当前第几个字在快照的 cursor 里。
    let redo: Bool
    private var redoChars: [String] = []
    private var redoBusy = false
    private let bridge: NativeWriteBridge
    weak var coordinator: NativeWriteCoordinating?
    let transitions = NativeWriteTransitions()

    private(set) var snapshot: [String: Any]
    private var copy: [String: String]
    private var colors: [String: UIColor] = [:]
    /// 页面令牌原串（颜色以外的令牌，如 toast-shadow 的 box-shadow 串）。
    private var rawColors: [String: String] = [:]
    private var inkTint: SIMD4<Float>?
    private(set) var phase: Phase = .recall
    private(set) var strokes: [[InkRawPoint]] = []
    private var cleared: [[InkRawPoint]]?
    private var submitting = false
    private var failed = false
    /// 页面给的时刻（s；open 回包 timing，单一来源 src/session/write-api.js writeTiming）。
    private var penArm: TimeInterval = 0
    private var judgeAppear: TimeInterval = 0
    private var judgeReady: TimeInterval = 0
    private var pressGuard: TimeInterval = 0
    /// 页面给的动效时长（ms；writeMotion）与版式常量（writeLayoutConstants）。
    private var motion: [String: Double] = [:]
    private var layoutK = NativeWriteLayoutConstants()
    private var judgeKeysReady = true
    private var judgeArmToken = 0
    /// 回忆 ⇄ 判断的缓动与判断落定的时刻（页面给的 motion.easeOut / motion.settle，原生不自带默认值）。
    private var easeOut: [Double]?
    private var settleSpec: NativeSettleSpec?
    /// 格框线宽（tokens.css --frame-w = 1，网页同一值）。
    private let frameW: CGFloat = 1
    /// 判断 → 回忆的 T-phase 倒放进行中（版式里书写格 / 参考格的 frame 由动画驱动，viewDidLayoutSubviews 不覆盖）。
    private var reversing = false
    private var reverseAnimator: UIViewPropertyAnimator?
    private var reverseFinished = false
    /// 书写格（回忆版式）的位置：判断 → 回忆倒放的终点。
    private var recallGridRect = CGRect.zero
    /// 上一次按「换字」设门限的字（含进页面的第一个字）。
    private var armedCard: String?
    /// 已经交给协调者离开（返回 / 结果页），之后的 viewDidDisappear 不再发 exit。
    var exitHandled = false
    /// 页面打开量测：消息到达时刻（CACurrentMediaTime）与页面发出时刻（epoch ms）。
    var openTiming: (sentAtEpochMs: Double, receivedAt: CFTimeInterval, receivedEpochMs: Double)?

    // 0.4s 防误点（确认单 2；网页 Button.js createPressGuard 同口径：新状态后 pressGuard 内不响应；同一按钮两次按下也隔 pressGuard，撤销 / 清空除外）
    private var stateChangedAt: CFTimeInterval = -.infinity
    private var lastPress: [String: CFTimeInterval] = [:]

    // 本字：落过笔（结果行收起，D19）、提示
    private var penDown = false
    private var glyph: NativeGlyphData?
    private var medians: [[CGPoint]]?
    private(set) var hint: NativeHintView?
    private var hintButton: [String: Any] = [:]
    private var hintNoteText: String?
    private var hintBusy = false
    private var hintCleared = false
    private var answerSeen = false

    // 看答案流程（B2.4）
    private var trace: [String: Double] = [:]
    private var flowBusy = false
    private(set) var flowFail: FlowAction?
    private var traceNeedsPlay = false
    private static var previewedTrace: [String] = []
    private var traceMissing: Bool { glyph == nil }

    // 跳过撤销 / 结束这组（B2.6）
    private var skipUndoParams = (ms: 5000.0, pauseWhileHeld: true, keepOpen: true)
    private var skipBusy = false
    private var undoInfo: (sessionId: String, recordId: String, char: String, strokes: [[InkRawPoint]])?
    private var undoBar: NativeUndoBarView?
    private var undoLife: NativeUndoLifetime?
    private var endDialog: NativeEndDialogView?
    private var endBusy = false
    private var a11yObserver: NSObjectProtocol?
    /// R9-B：网页字阶（open 回包 type）与弹层 / 确认框时刻（motion.overlay）。
    private var textType = NativeType()
    private var overlaySpec = NativeOverlaySpec()

    // MARK: 视图

    private let backButton = NativeIconTextButton(type: .system)
    private let centerLabel = UILabel()
    /// B2.9b：页标题只给读屏（网页 Page hideTitle 的 h1：回忆阶段「凭记忆写」、重写错字页「重写错字」；中间显示的是进度）。读屏顺序在「‹」之后、进度之前，换字 / 换阶段焦点落在它上面。
    private let srTitleLabel = UILabel()
    /// B2.9b：读屏播报区（网页 write-sr-status，aria-live=polite）：最近一句状态播报留在这里，读屏可以摸回来再听；换字 / 换阶段清空。
    private let srStatusLabel = UILabel()
    /// B2.9b：描一遍底栏里只给读屏的答案字（网页 write-answer-char：与判断页参考卡同一句名称）。
    private let srAnswerLabel = UILabel()
    /// 参考字形的读屏名称（页面 refLabel op，网页 refCardLabel 同一句）：字 → 名称。
    private var refLabels: [String: String] = [:]
    private let progressLabel = UILabel() // 判断页页头右侧的计数（回忆阶段计数在中间）
    private let noInkLabel = UILabel() // 没有本人笔画时上格「这次没写」
    private let changeButton = UIButton(type: .system) // 结果行「修改 ›」
    private let lineDot = UILabel()
    private let failRetry = UIButton(type: .system)
    private let skipButton = NativeIconTextButton(type: .system)
    private let endButton = NativeIconTextButton(type: .system)
    private let promptView = UIView()
    private let promptRow = UIView()
    private let promptHint = UILabel()
    private var promptCells: [UIView] = []
    private let gridFrame = UIView()
    private let hintLayer = NativeHintLayerView()
    private let traceLayer = NativeTraceLayerView()
    private let stepsView = UIView()
    private let stepDots = [UIView(), UIView()]
    private let headProgress = UILabel()
    private var ink: NativeInkView!
    private let refFrame = UIView()
    private let refGlyph = NativeGlyphView()
    private let undoButton = NativeIconTextButton(type: .system)
    private let clearButton = NativeIconTextButton(type: .system)
    private let noteView = NativeOverflowView() // 结果行「修改 ›」的 44pt 热区伸出说明位上沿也点得到（NP-01）
    private let lineLabel = UILabel()
    private let noteDot = UIView()
    private let noteLabel = UILabel()
    private let footView = UIView()
    private let hintButtonView = NativeIconTextButton(type: .system)
    private let answerButton = NativeIconTextButton(type: .system)
    private let retraceButton = NativeIconTextButton(type: .system)
    private let nextHelpButton = NativeIconTextButton(type: .system)
    private let flowCancelButton = NativeIconTextButton(type: .system)
    // B2.9a 重写错字页的求助行：写的时候「看答案」（网页 LinkButton 不带图标）、对照时「再写一次」
    private let redoAnswerButton = NativeIconTextButton(type: .system)
    private let redoAgainButton = NativeIconTextButton(type: .system)
    private let doneButton = UIButton(type: .system)
    private let wrongButton = UIButton(type: .system)
    private let correctButton = UIButton(type: .system)
    private let failNote = UILabel()
    private let failCancel = UIButton(type: .system)
    private let edgeBack = UIScreenEdgePanGestureRecognizer()
    private let bodyScroll = NativeWriteScrollView()
    private let bodyContent = NativeWritePageView()
    private let overflowHairline = UIView()
    private var bodyViews: [UIView] {
        [stepsView, promptView, gridFrame, noInkLabel, hintLayer, traceLayer, ink,
         refFrame, undoButton, clearButton, noteView]
    }

    /// Preserve the existing page-coordinate layout inside the scrolling body. Only
    /// overflow enters this hierarchy; fitting layouts keep their original parents.
    private func layoutOverflowBody(head: CGFloat, foot: CGFloat, bottom: CGFloat, enabled: Bool) {
        let overflow = enabled && bottom > foot + 0.5
        if overflow {
            if bodyScroll.superview == nil {
                view.insertSubview(bodyScroll, belowSubview: footView)
                bodyScroll.addSubview(bodyContent)
                bodyViews.forEach { bodyContent.addSubview($0) }
            }
            bodyScroll.frame = CGRect(x: 0, y: head, width: view.bounds.width, height: max(0, foot - head))
            bodyContent.frame = CGRect(x: 0, y: -head, width: view.bounds.width, height: bottom)
            bodyScroll.contentSize = CGSize(width: view.bounds.width, height: bottom - head)
            if overflowHairline.superview == nil { footView.addSubview(overflowHairline) }
            overflowHairline.backgroundColor = color("line", .separator)
            overflowHairline.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: 1 / UIScreen.main.scale)
            bodyScroll.onLayout = { [weak self] in
                guard let self else { return }
                self.overflowHairline.isHidden = self.bodyScroll.contentOffset.y + self.bodyScroll.bounds.height >= self.bodyScroll.contentSize.height - 1
            }
        } else if bodyScroll.superview != nil {
            bodyViews.forEach { view.insertSubview($0, belowSubview: footView) }
            overflowHairline.removeFromSuperview()
            bodyScroll.removeFromSuperview()
            bodyScroll.contentOffset = .zero
        }
    }
    private lazy var judgeHaptic = UIImpactFeedbackGenerator(style: .soft)
    private lazy var lightHaptic = UIImpactFeedbackGenerator(style: .light)
    private lazy var selectHaptic = UISelectionFeedbackGenerator()
    /// 换字转场的旧样子（替身视图，不接收触摸）。
    private var transitionOverlay: UIView?
    /// 书写格里的十字虚线（网页 ink-canvas GUIDES：var(--guide)、0.75、虚线 4 4，345 单位；判断页两格没有）。
    private let guideLayer = CAShapeLayer()
    /// 首练第 1 字格下的一次性提示（R9-A NP-02；网页 first-tip.js：落笔 / 用了提示 / 离开回忆阶段后收起，不再回来）。
    private var firstTipDue = false
    private var firstTipGone = false
    private var firstTipSent = false
    /// 字阶（网页 --fsN / --lhN 同值，R9-A）。
    private var type: NativeTypeScale { NativeTypeScale(type: textType, ax: traitCollection.preferredContentSizeCategory.isAccessibilityCategory) }
    /// B2.9b：AX 档逐元素取值（页面 typeBundle roles = 网页写字页 / 判断页同一组 :root[data-ax] 规则量出的字号 / 行高 / 尺寸）。
    private var axOn: Bool { textType.ax }
    private func axFont(_ role: String, sub: String? = nil, _ weight: UIFont.Weight = .regular, else fallback: @autoclosure () -> UIFont) -> UIFont {
        (axOn ? textType.roleFont(role, sub: sub, weight: weight) : nil) ?? fallback()
    }
    private func axValue(_ role: String, _ key: String, sub: String? = nil) -> CGFloat? { axOn ? textType.role(role, key, sub: sub) : nil }
    /// AX 档格下实际高度只增不减（同一张卡同一阶段；网页 useWriteLayout noteKey，R3-K1 P241）。
    private var axBelowMemo: (key: String, h: CGFloat)?
    /// AX 档书写格放不下下限（P278 tight）：底栏收紧（求助行 48、间距 6、主按钮 34pt），网页 data-compact / data-tight。
    private var axTight = false
    private var axTightKey = ""

    init(slot: String, payload raw: [String: Any], bridge: NativeWriteBridge, redo: Bool = false) {
        // B3.1：颜色 / 字阶 / 文案 / 动效取 ShiziKit 生成值，回包只给快照、主题、AX 量值与 policy 参数（ShiziLook）
        let payload = ShiziLook.resolve(raw, page: .write)
        self.slot = slot
        self.redo = redo
        self.redoChars = redo ? (payload["chars"] as? [String] ?? []) : []
        self.bridge = bridge
        self.snapshot = payload["snapshot"] as? [String: Any] ?? [:]
        self.copy = (payload["copy"] as? [String: String]) ?? [:]
        super.init(nibName: nil, bundle: nil)
        applyColors(payload["colors"] as? [String: String])
        applyTiming(payload)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: 文案 / 颜色 / 时刻（单一来源：页面）

    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
        var s = copy[key] ?? ""
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v.description) }
        return s
    }

    private func applyColors(_ raw: [String: String]?) {
        rawColors = raw ?? [:]
        for (k, v) in raw ?? [:] {
            if k.hasSuffix("-shadow") { continue } // box-shadow 串（toast-shadow），不是颜色：toastStyle 用 NativeInkWire.shadow 解析
            if let c = NativeInkWire.uiColor(v) { colors[k] = c }
        }
        if let h = NativeInkWire.parseColor(raw?["hand"]) { inkTint = SIMD4(h.x, h.y, h.z, 1) }
    }

    private func color(_ name: String, _ fallback: UIColor) -> UIColor { colors[name] ?? fallback }

    /// L4 浮条（撤销条）外观：全取页面令牌 toast-bg / toast-fg / toast-act / toast-line / toast-shadow 与圆角 r-box（R10-B，D71 ③）；
    /// 回退值只在令牌缺失时用，取弹层面 / 正文墨（浮起的浅面），不用主按钮的实心色。
    private func toastStyle() -> NativeToastStyle {
        let bg = color("toast-bg", color("elev", .secondarySystemBackground))
        let fg = color("toast-fg", color("ink1", .label))
        return NativeToastStyle(background: bg, foreground: fg, action: color("toast-act", fg), line: colors["toast-line"] ?? colors["line"],
                                shadow: NativeInkWire.shadow(rawColors["toast-shadow"]), radius: textType.value("r-box"))
    }

    private func applyTiming(_ payload: [String: Any]) {
        let raw = payload["timing"] as? [String: Any]
        let ms = { (k: String) in ((raw?[k] as? NSNumber)?.doubleValue ?? 0) / 1000 }
        penArm = ms("penArmMs")
        judgeAppear = ms("judgeAppearMs")
        judgeReady = ms("judgeReadyMs")
        pressGuard = ms("pressGuardMs")
        if let m = payload["motion"] as? [String: Any] {
            motion = m.compactMapValues { ($0 as? NSNumber)?.doubleValue }
            easeOut = (m["easeOut"] as? [NSNumber])?.map { $0.doubleValue }
            settleSpec = NativeSettleSpec(motion: m)
            overlaySpec = NativeOverlaySpec(motion: m)
        }
        if payload["type"] != nil { textType = NativeType(payload["type"]) }
        if let l = payload["layout"] as? [String: Any] { layoutK = NativeWriteLayoutConstants(l) }
        // R11-A（D72 ②）：墨与网页同一算法，参数随 open 下发（policy.ink + INK_SPEC）；判断弹层等另建的书写面也读 WebInkParams.current
        if let k = WebInkParams(payload["ink"]) {
            WebInkParams.current = k
            ink?.params = k
        }
        if let t = payload["trace"] as? [String: Any] {
            trace = t.compactMapValues { ($0 as? NSNumber)?.doubleValue }
            traceLayer.hookWidthPt = CGFloat(trace["hookWidthPt"] ?? 0.75)
            traceLayer.hookWidthMoreContrastPt = CGFloat(trace["hookWidthMoreContrastPt"] ?? 1.5)
        }
        if let u = payload["skipUndo"] as? [String: Any] {
            skipUndoParams = (ms: (u["ms"] as? NSNumber)?.doubleValue ?? 5000,
                              pauseWhileHeld: (u["pauseWhileHeld"] as? NSNumber)?.boolValue ?? true,
                              keepOpen: (u["keepOpenWithAssistiveTech"] as? NSNumber)?.boolValue ?? true)
        }
    }

    /// 动效时长（s）：减少动态效果时一律 reduce（150ms，D58 ②）。
    private func dur(_ key: String) -> TimeInterval { (motion[key] ?? 0) / 1000 }
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    // MARK: 生命周期

    override func loadView() {
        let v = NativeWritePageView()
        v.backgroundColor = color("paper", UIColor(named: "Paper") ?? .systemBackground)
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let inkView = NativeInkView.make(frame: .zero) else {
            ShiziProbe.log("native-write: Metal unavailable")
            return
        }
        ink = inkView
        bodyScroll.ink = inkView
        bodyScroll.onBegin = { [weak self] in self?.settleAnimations() }
        bodyContent.ink = inkView
        bodyContent.approachRoot = view
        bodyScroll.accessibilityIdentifier = "native-write-scroll"
        bodyScroll.contentInsetAdjustmentBehavior = .never
        bodyScroll.delaysContentTouches = false
        bodyScroll.panGestureRecognizer.maximumNumberOfTouches = 1
        bodyScroll.panGestureRecognizer.require(toFail: edgeBack)
        (view as? NativeWritePageView)?.ink = inkView
        #if DEBUG
        ink.latency = NativeWriteMetrics.shared.inkLatency
        #endif
        ink.delegate = self
        ink.isAccessibilityElement = true
        ink.accessibilityTraits = [.allowsDirectInteraction]
        ink.accessibilityIdentifier = "native-write-grid"
        if let c = inkTint { ink.inkColor = c }

        backButton.iconSize = NativeWriteIcon.back.size
        backButton.spacing = 0
        backButton.tintColor = color("ink1", .label)
        backButton.accessibilityIdentifier = "native-write-back"
        wire(backButton, id: "back", state: false) { $0.tapBack() }

        centerLabel.textAlignment = .center
        centerLabel.lineBreakMode = .byTruncatingTail
        centerLabel.accessibilityIdentifier = "native-write-progress"
        centerLabel.accessibilityTraits = [.header]
        srTitleLabel.accessibilityTraits = [.header]
        srTitleLabel.accessibilityIdentifier = "native-write-title"
        srTitleLabel.clipsToBounds = true
        srTitleLabel.textColor = .clear
        for l in [srStatusLabel, srAnswerLabel] {
            l.clipsToBounds = true
            l.textColor = .clear
        }
        srStatusLabel.accessibilityIdentifier = "native-write-sr-status"
        srStatusLabel.accessibilityTraits = [.updatesFrequently]
        srAnswerLabel.accessibilityIdentifier = "native-write-answer-char"
        srAnswerLabel.accessibilityTraits = [.image]
        progressLabel.textAlignment = .right
        progressLabel.textColor = color("ink3", .secondaryLabel)
        progressLabel.accessibilityIdentifier = "native-write-count"
        progressLabel.isHidden = true
        noInkLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
        noInkLabel.adjustsFontForContentSizeCategory = true
        noInkLabel.textAlignment = .center
        noInkLabel.numberOfLines = 0
        noInkLabel.textColor = color("ink3", .secondaryLabel)
        noInkLabel.text = tr("R-W17.noInk")
        noInkLabel.accessibilityIdentifier = "native-write-noink"
        noInkLabel.isHidden = true

        // 页头右上：跳过 / 结束这组（文字按钮；B2.6 接上功能前不显示，位置已留）
        configureTextButton(skipButton, title: tr("R-W14.btnSkip"), icon: nil, id: "native-write-skip")
        configureTextButton(endButton, title: tr("R-W15.end"), icon: nil, id: "native-write-end")
        wire(skipButton, id: "skip") { $0.tapSkip() }
        wire(endButton, id: "end") { $0.tapEnd() }
        headProgress.textColor = color("ink3", .secondaryLabel)
        headProgress.textAlignment = .right
        headProgress.isHidden = true
        headProgress.accessibilityIdentifier = "native-write-head-progress"
        for d in stepDots {
            d.layer.cornerRadius = 2.5
            d.layer.borderWidth = 1
            d.layer.borderColor = color("ink3", .secondaryLabel).cgColor
            stepsView.addSubview(d)
        }
        stepsView.isAccessibilityElement = true
        stepsView.isHidden = true
        stepsView.accessibilityIdentifier = "native-write-steps"
        traceLayer.color = color("danzhu", .systemRed)
        traceLayer.refColor = color("ref", .label)

        promptHint.textColor = color("ink2", .secondaryLabel)
        promptHint.textAlignment = .center
        promptHint.numberOfLines = 0
        promptView.addSubview(promptRow)
        promptView.addSubview(promptHint)
        promptView.isAccessibilityElement = false
        promptView.shouldGroupAccessibilityChildren = true

        // 书写格 / 对照格：方角（--r-work 0）、笺色填充（--sheet）、frameW 格线（网页 .sz-inkgrid；R9-A NP-05）
        for f in [gridFrame, refFrame] {
            f.layer.borderWidth = frameW
            f.layer.borderColor = color("frame", .separator).cgColor
            f.layer.cornerRadius = 0 // --r-work 0：书写格、对照卡方角（D46 ⑪，NP-13）
            f.backgroundColor = color("sheet", .clear) // 笺底（--sheet）
            f.isUserInteractionEnabled = false
        }
        guideLayer.fillColor = nil
        guideLayer.strokeColor = color("guide", .separator).cgColor
        gridFrame.layer.addSublayer(guideLayer)
        hintLayer.color = color("danzhu", .systemRed)
        refFrame.addSubview(refGlyph)
        refGlyph.color = color("ref", .label)
        refGlyph.isAccessibilityElement = true
        refFrame.isHidden = true

        configureTextButton(undoButton, title: tr("R-W18.btnUndo"), icon: .undo, id: "native-write-undo")
        configureTextButton(clearButton, title: tr("R-W18.btnClear"), icon: .clear, id: "native-write-clear")
        wire(undoButton, id: "undo", rapid: true) { $0.tapUndo() }
        wire(clearButton, id: "clear", rapid: true) { $0.tapClear() }

        for l in [lineLabel, noteLabel] {
            l.font = UIFont.preferredFont(forTextStyle: .footnote)
            l.adjustsFontForContentSizeCategory = true
            l.textColor = color("ink3", .secondaryLabel)
            l.numberOfLines = 0
            noteView.addSubview(l)
        }
        lineLabel.accessibilityIdentifier = "native-write-line"
        noteLabel.accessibilityIdentifier = "native-write-note"
        lineDot.isAccessibilityElement = false
        lineDot.textAlignment = .center
        noteView.addSubview(lineDot)
        // 结果行「修改 ›」：文字按钮 13 号 ink1，热区 44（D19 / D46 ⑭）；文字来自页面（line.action），读屏名称去掉 ›
        changeButton.setTitleColor(color("ink1", .label), for: .normal)
        // 网页 .sz-line__change：按钮盒 44 高、比行高多出的 4 全部伸向上面，左右各 4 的内边距，字左对齐
        changeButton.contentHorizontalAlignment = .left
        changeButton.contentEdgeInsets = UIEdgeInsets(top: 4, left: 4, bottom: 0, right: 4)
        changeButton.accessibilityIdentifier = "native-write-line-change"
        wire(changeButton, id: "change") { $0.tapChange() }
        noteView.addSubview(changeButton)
        noteDot.backgroundColor = color("danzhu", .systemRed)
        noteDot.layer.cornerRadius = 3
        noteDot.isAccessibilityElement = false
        noteView.addSubview(noteDot)

        configureHelp(hintButtonView, title: tr("R-W05.hintLabel"), icon: .hint, id: "native-write-hint")
        configureHelp(answerButton, title: tr("R-W07.btnShowAnswer"), icon: .answer, id: "native-write-show-answer")
        configureHelp(retraceButton, title: tr("X-ANSWER.btnRetrace"), icon: nil, id: "native-write-retrace")
        configureHelp(nextHelpButton, title: tr("R-W07.btnNext"), icon: nil, id: "native-write-answer-next")
        configureHelp(flowCancelButton, title: tr("R-W16.cancel"), icon: nil, id: "native-write-flow-cancel")
        wire(answerButton, id: "answer") { $0.tapShowAnswer() }
        wire(retraceButton, id: "retrace") { $0.runFlow(.answerPhase("trace")) }
        wire(nextHelpButton, id: "nextHelp") { $0.runFlow(.answerNext) }
        wire(flowCancelButton, id: "flowCancel") { $0.tapFlowCancel() }
        [answerButton, retraceButton, nextHelpButton, flowCancelButton].forEach { $0.isHidden = true }
        configureHelp(redoAnswerButton, title: tr("R-W07.btnShowAnswer"), icon: nil, id: "native-redo-show-answer")
        configureHelp(redoAgainButton, title: tr("X-REDO.again"), icon: nil, id: "native-redo-again")
        wire(redoAnswerButton, id: "redoAnswer") { $0.tapRedoAnswer() }
        wire(redoAgainButton, id: "redoAgain") { $0.tapRedoAgain() }
        [redoAnswerButton, redoAgainButton].forEach { $0.isHidden = true }
        wire(hintButtonView, id: "hint") { $0.tapHint() }
        configurePrimary(doneButton, title: tr("R-W29.btnDone"), id: "native-write-done")
        wire(doneButton, id: "done") { $0.tapPrimary() }
        configureOutline(wrongButton, title: tr("R-W09.btnWrong"), id: "native-write-wrong")
        configureOutline(correctButton, title: tr("R-W09.btnCorrect"), id: "native-write-correct")
        wire(wrongButton, id: "wrong") { $0.tapWrong() }
        wire(correctButton, id: "correct") { $0.tapCorrect() }
        // 保存失败三段式（S1，D07）：说明 → 求助行「先不保存」（凹面）→ 主按钮「再试一次」（满宽墨底）；写字流程同一写法
        configureHelp(failCancel, title: tr("R-W16.cancel"), icon: nil, id: "native-write-fail-cancel")
        configurePrimary(failRetry, title: tr("R-W16.retry"), id: "native-write-fail-retry")
        wire(failCancel, id: "failCancel") { $0.tapFailCancel() }
        wire(failRetry, id: "retry") { $0.tapRetry() }
        failNote.text = tr("R-W16.saveFailed")
        failNote.font = UIFont.preferredFont(forTextStyle: .subheadline)
        failNote.adjustsFontForContentSizeCategory = true
        failNote.textColor = color("ink2", .secondaryLabel)
        failNote.textAlignment = .center
        failNote.numberOfLines = 0
        [hintButtonView, answerButton, retraceButton, nextHelpButton, flowCancelButton, redoAnswerButton, redoAgainButton, doneButton, wrongButton, correctButton, failNote, failCancel, failRetry].forEach { footView.addSubview($0) }

        [backButton, srTitleLabel, srStatusLabel, srAnswerLabel, centerLabel, progressLabel, headProgress, endButton, skipButton, stepsView, promptView, gridFrame, noInkLabel, hintLayer, traceLayer, ink, refFrame, undoButton, clearButton, noteView, footView]
            .forEach { view.addSubview($0) }

        // 左缘右滑 = 左上「‹」：回忆阶段跟手滑回上一页（交互式转场），判断阶段 = 接着写（D58 ① / 确认单 2）。
        // R10-A（D71 ②）：系统左缘识别器的起手区（UIKit _edgeRegionSize 40.2pt，真机还按手指接触半径放宽）伸进书写格左侧约 20pt——
        // 那里起笔向右写（横）会被它认成返回手势：这一笔被取消、交互式返回又回弹，看上去就是「写完的笔画突然消失」。
        // 规则：书写格里起手一律归书写，边缘返回只在格外（页边 20pt）生效（与网页起手带只占页边 12px、不压书写格同一口径）。
        edgeBack.delegate = self
        edgeBack.edges = .left
        edgeBack.addTarget(self, action: #selector(handleEdgeBack(_:)))
        view.addGestureRecognizer(edgeBack)

        styleResultLine()
        applyType()
        apply(snapshot: snapshot, keepLocal: false)
        NotificationCenter.default.addObserver(self, selector: #selector(contentSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
        // 读屏 / 切换控制状态变了：撤销条被钉住后关掉读屏要重新给一整段（write/skip.js onAccessibilityStatus）
        a11yObserver = NotificationCenter.default.addObserver(forName: UIAccessibility.voiceOverStatusDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.undoLife?.assistiveChanged(NativeUndoLifetime.systemAssistive)
        }
    }

    deinit {
        if let a11yObserver { NotificationCenter.default.removeObserver(a11yObserver) }
        undoLife?.stop()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let t = openTiming {
            #if DEBUG
            NativeWriteMetrics.shared.open(sentAtEpochMs: t.sentAtEpochMs, receivedAt: t.receivedAt, appearedAt: CACurrentMediaTime(), receivedEpochMs: t.receivedEpochMs)
            #endif
            _ = t
            openTiming = nil
        }
        NativeA11y.screenChanged(screenFocus)
        scheduleAutoStep()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isBeingDismissed || presentingViewController == nil else { return }
        commitBeforeLeaving() // R12：exit 之前（同一条桥队列，按发出顺序执行）
        saveMetrics()
        if !exitHandled, redo {
            // B2.9a：重写错字页离开（‹ / 左缘 / 完成）→ 页面 nav.back 回到结果页；什么都不写
            exitHandled = true
            bridge.call("redoExit", [:]) { _ in }
            return
        }
        if !exitHandled {
            exitHandled = true
            var args: [String: Any] = ["slot": slot, "to": "back"]
            if let u = undoHandoff() { args["undo"] = u } // 撤销条还在时离开：剩余的撤销机会交给来源页（S4）
            endUndo()
            bridge.call("exit", args) { _ in
                #if DEBUG
                NativeWriteMetrics.shared.save()
                #endif
            }
        }
    }

    var inkViewForTesting: NativeInkView? { ink }
    var hintLayerForTesting: NativeHintLayerView { hintLayer }
    var hintButtonKindForTesting: String? { hintButton["kind"] as? String }
    var lineShownForTesting: Bool { !lineLabel.isHidden }

    func saveMetrics() {
        #if DEBUG
        NativeWriteMetrics.shared.inkSummary = ink?.latency.summary ?? [:]
        NativeWriteMetrics.shared.save()
        #endif
    }

    /// 读屏两指 Z 形 = 左上「‹」（回忆阶段离开，判断阶段接着写；R5-I2）。
    override func accessibilityPerformEscape() -> Bool {
        tapBack()
        return true
    }

    @objc private func contentSizeChanged() {
        styleResultLine()
        applyType()
        rebuildPrompt()
        refresh()
        view.setNeedsLayout()
    }

    // MARK: 按钮与防误点

    /// 按钮动作（UIAction）：先过 0.4s 防误点，再调动作函数（动作函数本身可直接调用：测试与自动驾驶用 perform 走同一个函数）。
    /// state = false：不看「新状态后 0.4s」（返回键，T0-3）；rapid = true：不看同一按钮上一次按下（撤销 / 清空）。
    private func wire(_ b: UIButton, id: String, state: Bool = true, rapid: Bool = false, _ action: @escaping (NativeWriteViewController) -> Void) {
        b.addAction(UIAction { [weak self] _ in
            guard let self, self.acceptPress(id, at: CACurrentMediaTime(), state: state, rapid: rapid) else { return }
            self.settleAnimations()
            action(self)
        }, for: .touchUpInside)
    }

    /// 网页 createPressGuard 的同一判据。
    func acceptPress(_ id: String, at t: CFTimeInterval, state: Bool = true, rapid: Bool = false) -> Bool {
        if state, t < stateChangedAt + pressGuard { return false }
        if !rapid, let last = lastPress[id], t < last + pressGuard { return false }
        lastPress[id] = t
        return true
    }

    /// 换字 / 换阶段 = 新状态：按钮 0.4s 不响应。
    private func markStateChange() { stateChangedAt = CACurrentMediaTime() }

    // MARK: 快照

    var cardKey: String? { snapshot["cardKey"] as? String }
    private var char: String { snapshot["char"] as? String ?? "" }

    /// 用快照刷新页面。keepLocal：同一个字时保留本地笔画与提示（页面重载后的重新同步）。
    func apply(snapshot next: [String: Any], keepLocal: Bool) {
        let sameCard = (next["cardKey"] as? String) == cardKey
        let prevPhase = phase
        snapshot = next
        if !(keepLocal && sameCard) {
            strokes = NativeInkWire.rawStrokes(next["strokes"])
            cleared = nil
            switch next["answerPhase"] as? String {
            case "trace": phase = .trace
            case "retrace": phase = .retrace
            default: phase = (next["phase"] as? String) == "compare" && !strokes.isEmpty ? .compare : .recall
            }
            penDown = false
            flowFail = nil
            firstTipDue = next["firstTip"] as? Bool ?? false
            firstTipGone = false
            firstTipSent = false
            loadHint()
            loadTrace()
        }
        // 换字（含进页面）：门限内落下的笔先持住、到点补画（P227）；判断回包前持住的笔在这里接上新字
        if cardKey != armedCard || ink?.acceptFrom == .infinity {
            armedCard = cardKey
            ink?.acceptFrom = CACurrentMediaTime() + penArm
            markStateChange()
        } else if phase != prevPhase {
            markStateChange()
        }
        failed = false
        ink?.syncPageStrokes(strokes)
        refGlyph.char = char
        if !(keepLocal && sameCard) || phase != prevPhase { srStatusLabel.text = nil } // 换字 / 换阶段：上一句播报作废（网页 setMessage('')）
        requestRefLabel()
        rebuildPrompt()
        refresh()
        view.setNeedsLayout()
        // 进入描一遍：读一次参考字形画出了哪几笔（网页 sr-live.js traceAnnouncement；每个字一次）
        if phase == .trace, traceAnnouncedKey != cardKey {
            traceAnnouncedKey = cardKey
            let n = glyph?.strokes.count ?? 0
            if n <= 0 {
                say(tr("X-WRITE.liveTraceWhole"))
            } else {
                let range = n == 1 ? tr("X-WRITE.liveRangeOne", ["a": 1]) : tr("X-WRITE.liveRangeMany", ["a": 1, "b": n])
                say(tr("X-WRITE.liveTrace", ["range": range]))
            }
        }
    }

    private var traceAnnouncedKey: String?

    /// 笔数变化的播报（网页 sr-live.js strokeAnnouncement 同一套句子）：多一笔「已写 n 笔」、撤销恢复「恢复了，现在是 n 笔」、撤销「撤销了一笔，还有 n 笔」、
    /// 撤到空「撤销了一笔，格子是空的」、清空「已清空」。只在书写格可写时（判断页不播）。
    private func announceStrokes(from prev: Int) {
        let next = strokes.count
        guard prev != next, ink?.drawable == true else { return }
        let text: String
        if next > prev {
            text = next - prev == 1 ? tr("X-WRITE.liveStroke", ["n": next]) : tr("X-WRITE.liveRestored", ["n": next])
        } else if next == 0 {
            text = prev == 1 ? tr("X-WRITE.liveUndoEmpty") : tr("X-WRITE.liveCleared")
        } else {
            text = tr("X-WRITE.liveUndo", ["n": next])
        }
        say(text)
    }

    /// 页面重载（WebContent 进程被回收）后宿主重新发 open：用新的文案 / 颜色 / 快照重新同步。
    func resync(payload raw: [String: Any]) {
        let payload = ShiziLook.resolve(raw, page: .write)
        if let c = payload["copy"] as? [String: String] { copy = c }
        applyColors(payload["colors"] as? [String: String])
        applyTiming(payload)
        applyType()
        // B2.9a：重写错字页第几个字只在原生（页面重新发 redoOpen 给的是第一个字），只换外观
        if !redo, let s = payload["snapshot"] as? [String: Any] { apply(snapshot: s, keepLocal: true) }
    }

    private func rebuildPrompt() {
        promptCells.forEach { $0.removeFromSuperview() }
        promptCells = []
        let prompt = snapshot["prompt"] as? [String: Any] ?? [:]
        let cells = prompt["cells"] as? [[String: Any]] ?? []
        promptRow.accessibilityLabel = tr("X-PROMPT.groupLabel")
        let hintText = prompt["hint"] as? String ?? ""
        let ts = type
        // 提示行：t15 ink2、行高 lh15、居中（网页 .sz-prompt__hint）
        let para = NSMutableParagraphStyle()
        // AX 档：提示行 17 / 22pt、拼音 22 / 28pt（网页 prompt.js :root[data-ax] 分层封顶）
        let hintLine = (axOn ? textType.roleLine("prompt", sub: "r5") : nil) ?? ts.lineHeight(15)
        para.minimumLineHeight = hintLine
        para.maximumLineHeight = hintLine
        para.alignment = .center
        promptHint.attributedText = NSAttributedString(string: hintText, attributes: [.font: axFont("prompt", sub: "r5", else: ts.font(15)), .foregroundColor: color("ink2", .secondaryLabel), .paragraphStyle: para])
        promptHint.isHidden = hintText.isEmpty
        for c in cells {
            let kind = c["kind"] as? String ?? "text"
            let text = c["text"] as? String ?? ""
            let cell = UIView()
            switch kind {
            case "blank":
                cell.layer.borderWidth = frameW
                cell.layer.borderColor = color("frame", .separator).cgColor
                let py = UILabel()
                py.text = text
                py.font = axFont("prompt", sub: "r3", else: ts.font(15)) // 拼音 t15 ink2（网页 .sz-prompt__py；AX 档 22 / 28pt）
                py.textColor = color("ink2", .secondaryLabel)
                py.textAlignment = .center
                py.tag = 1
                cell.addSubview(py)
                // 看答案 · 描一遍：目标字填回空格（网页 REVEAL_PHASES，字面占格 80%；R9-A NP-03）
                if let fill = c["fill"] as? String, !fill.isEmpty {
                    let g = NativeGlyphView()
                    g.char = fill
                    g.padRatio = 0
                    g.color = color("ink1", .label)
                    g.tag = 3
                    cell.addSubview(g)
                }
                cell.accessibilityIdentifier = "native-write-blank"
                if let label = c["label"] as? String, !label.isEmpty {
                    cell.isAccessibilityElement = true
                    cell.accessibilityLabel = label // 只有位置与拼音，不含答案字（D16）
                } else {
                    // 描一遍（答案已揭晓、格子没有名称）：读拼音、再读填回的字（网页这一格的拼音与字各自出现在读屏里）
                    cell.isAccessibilityElement = false
                    let fillView = cell.subviews.first { $0.tag == 3 }
                    fillView?.isAccessibilityElement = true
                    fillView?.accessibilityLabel = c["fill"] as? String
                    cell.accessibilityElements = [py, fillView].compactMap { $0 }
                }
            case "repeatBlank":
                cell.layer.borderWidth = frameW
                cell.layer.borderColor = color("frame", .separator).cgColor
                let l = UILabel()
                l.text = text
                l.font = ts.font(28) // 「□」t28 ink3（网页 .sz-prompt__cell[data-kind=repeatBlank]）
                l.textAlignment = .center
                l.textColor = color("ink3", .tertiaryLabel)
                l.tag = 2
                cell.addSubview(l)
                cell.isAccessibilityElement = true
                cell.accessibilityLabel = c["label"] as? String
            default:
                let g = NativeGlyphView()
                g.char = text
                g.padRatio = 0
                g.color = color("ink1", .label)
                g.tag = 3
                cell.addSubview(g)
                cell.isAccessibilityElement = true
                cell.accessibilityLabel = text
            }
            promptRow.addSubview(cell)
            promptCells.append(cell)
        }
    }

    // MARK: 描一遍（B2.4；NativeTrace.swift）

    private var traceChar: String?
    private var previewKey: String { "\(snapshot["sessionId"] as? String ?? "")|\(cardKey ?? "")" }

    /// 换字 / 换阶段：描红层读这个字的字形；这个字第一次进描一遍（会话 id + 字，只记在本次运行里）要先快放一遍笔顺，等版式定了再播。
    private func loadTrace() {
        if traceChar != char {
            traceLayer.setGlyph(glyph, char: char)
            traceChar = char
        }
        traceLayer.setWritten(strokes.count)
        traceNeedsPlay = phase == .trace && glyph != nil && !Self.previewedTrace.contains(previewKey) && !reduceMotion
    }

    /// 版式定了以后开始快放（每字只播一次；总时长 ≤ stepPlayMax，落笔 / 点一下即到终态）。
    private func startStepPlayIfNeeded() {
        guard traceNeedsPlay, phase == .trace, let g = glyph, traceLayer.bounds.width > 0 else { return }
        traceNeedsPlay = false
        let key = previewKey
        Self.previewedTrace.removeAll { $0 == key }
        Self.previewedTrace.append(key)
        if Self.previewedTrace.count > 200 { Self.previewedTrace.removeFirst(Self.previewedTrace.count - 200) }
        let plan = NativeTrace.plan(medians: g.medians, strokeCount: g.strokes.count, maxMs: trace["maxMs"] ?? 1600, speed: trace["speed"] ?? 1.6,
                                    delay: trace["gapMs"] ?? 180, fade: trace["fadeMs"] ?? 220)
        traceLayer.play(plan: plan)
    }

    var traceLayerForTesting: NativeTraceLayerView { traceLayer }

    // MARK: 提示（D64 ①；规则在页面 hint op，这里只有视图）

    private var hintActive: Bool {
        phase == .recall && (!answerSeen || (hintButton["kind"] as? String) == "exhausted")
    }

    /// 换字：读字形、恢复提示现场（open 时已有 hintRange → 静态显示，按已写笔数推出哪些已收掉），再问页面按钮状态。
    private func loadHint() {
        glyph = char.isEmpty ? nil : NativeGlyphData.load(char)
        medians = glyph.map { NativeHintMatch.medians345($0, padRatio: hintLayer.padRatio) }
        hintLayer.setGlyph(glyph)
        let used = snapshot["hints"] as? Int ?? 0
        var range: Range<Int>?
        if let r = snapshot["hintRange"] as? [String: Any], let a = r["from"] as? Int, let b = r["to"] as? Int, b > a, a >= 0 { range = a..<b }
        hint = NativeHintView(used: used, range: range, written: strokes.count)
        hintCleared = false
        hintBusy = false
        answerSeen = snapshot["answerSeen"] as? Bool ?? false
        hintButton = ["kind": "loading", "text": tr("R-W05.hintLabel"), "label": tr("R-W05.hintLabel"), "disabled": true]
        hintNoteText = nil
        renderHint(fadeIn: false)
        requestHintState()
    }

    /// 字形的总笔数交给页面（没有数据 = 0：这个字没有分步提示）。
    private var totalStrokes: Int { glyph?.medians.count ?? 0 }

    private func hintArgs(_ action: String) -> [String: Any] {
        var a: [String: Any] = ["slot": slot, "cardKey": cardKey ?? "", "action": action, "totalStrokes": totalStrokes, "used": hint?.used ?? 0, "written": strokes.count]
        if let r = hint?.range { a["range"] = ["from": r.lowerBound, "to": r.upperBound] }
        return a
    }

    private func requestHintState() {
        guard !redo, let key = cardKey else { return } // 重写错字页没有提示（网页同）
        bridge.call("hint", hintArgs("state")) { [weak self] reply in
            guard let self, self.cardKey == key, reply.ok else { return }
            self.applyHintModel(reply.body)
        }
    }

    private func applyHintModel(_ body: [String: Any]) {
        if let b = body["button"] as? [String: Any] { hintButton = b }
        hintNoteText = (body["note"] as? [String: Any])?["text"] as? String
        refresh()
        view.setNeedsLayout()
    }

    @objc private func tapHint() {
        guard phase == .recall, !submitting, !hintBusy, (hintButton["kind"] as? String) == "available", let key = cardKey else { return }
        endUndo() // 点提示：跳过的撤销机会结束（G3）
        hintBusy = true
        bridge.call("hint", hintArgs("give")) { [weak self] reply in
            guard let self, self.cardKey == key else { return }
            self.hintBusy = false
            // 写入失败也照常显示（P52）：本地次数保留，下次写入带上
            guard let given = reply.body["given"] as? [String: Any], let a = given["from"] as? Int, let b = given["to"] as? Int, b > a,
                  let merged = reply.body["hintRange"] as? [String: Any], let ma = merged["from"] as? Int, let mb = merged["to"] as? Int, mb > ma else {
                self.applyHintModel(reply.body)
                return
            }
            self.settleAnimations()
            self.hint?.give(segment: a..<b, merged: ma..<mb, used: reply.body["used"] as? Int ?? 0, written: self.strokes.count)
            self.hintCleared = false
            if (reply.body["whole"] as? Bool) == true { self.answerSeen = true }
            self.applyHintModel(reply.body)
            self.renderHint(fadeIn: true)
            self.selectHaptic.selectionChanged() // F1 haptic.select：提示显影，与第一帧同帧
            self.checkHintCleared()
            if let text = reply.body["announce"] as? String, !text.isEmpty { self.say(text) }
        }
    }

    private func renderHint(fadeIn: Bool) {
        let ms = fadeIn ? (reduceMotion ? dur("hintReduced") : dur("hintIn")) * 1000 : 0
        hintLayer.render(hint, visible: hintActive && glyph != nil, fadeInMs: ms)
    }

    /// 本人写完第 index 笔：收掉与它匹配的那一笔提示（只那一笔淡出，D53 ⑧）。
    private func absorbHint(index: Int, raw: [InkRawPoint]) {
        guard hintActive, var h = hint, h.range != nil else { return }
        guard let m = NativeHintMatch.match(remaining: h.remaining, index: index, points: raw, medians: medians, maxDist: layoutK.hintMatchMaxDist),
              h.absorb(user: index, hint: m) else { return }
        hint = h
        let out = (reduceMotion ? dur("hintReduced") : dur("hintOut"))
        hintLayer.fadeOut(m, ms: out * 1000)
        let key = cardKey
        DispatchQueue.main.asyncAfter(deadline: .now() + out) { [weak self] in
            guard let self, self.cardKey == key, var v = self.hint, v.fading.contains(m) else { return }
            v.faded(m)
            self.hint = v
            self.renderHint(fadeIn: false)
            self.checkHintCleared()
        }
    }

    /// 撤销 / 清空：笔数退到 n，这些笔收掉的提示笔回来（整组重新淡入）。
    private func restoreHint(toCount n: Int) {
        guard hintActive, var h = hint, h.restore(fromUser: n) else { return }
        hint = h
        renderHint(fadeIn: true)
        checkHintCleared()
    }

    /// 提示笔全部收掉（淡完）→ 页面写 hintRange:null；撤销让它们回来 → 写回范围（网页 'hint-fade'，P52 不等）。
    private func checkHintCleared() {
        guard let h = hint, let r = h.range, let key = cardKey else { return }
        if h.remaining.isEmpty, h.fading.isEmpty, !hintCleared {
            hintCleared = true
            bridge.send("hint", ["slot": slot, "cardKey": key, "action": "range", "hints": h.used, "hintRange": NSNull()])
        } else if !h.remaining.isEmpty, hintCleared {
            hintCleared = false
            bridge.send("hint", ["slot": slot, "cardKey": key, "action": "range", "hints": h.used, "hintRange": ["from": r.lowerBound, "to": r.upperBound]])
        }
    }

    // MARK: 状态 → 控件

    private var cursorNumber: Int { (snapshot["cursor"] as? Int ?? 0) + 1 }
    private var totalCount: Int { snapshot["total"] as? Int ?? 0 }
    private var canEnd: Bool { snapshot["canEnd"] as? Bool ?? false }
    /// 看过答案后留在回忆阶段（提示给完整字 / 恢复现场）：底栏同看答案流程。
    private var recallSeen: Bool { phase == .recall && answerSeen }
    private var inFlowPhase: Bool { phase == .trace || phase == .retrace }

    private func refresh() {
        let n = cursorNumber, total = totalCount
        let compare = phase == .compare
        let flow = inFlowPhase
        let progressText = tr("R-W01.progress", ["n": n, "total": total])
        let progressSpoken = tr("R-W01.progressLabel", ["n": n, "total": total])
        switch redo ? .recall : phase {
        case .recall:
            // 重写错字页两个阶段页头中间都是进度（网页 Page center = progress、hideTitle），「‹」读「返回」
            centerLabel.text = progressText
            centerLabel.accessibilityLabel = progressSpoken
            backButton.accessibilityLabel = tr("X-COMMON.back")
        case .trace, .retrace:
            // 描一遍 / 凭记忆写：中间是阶段标题，进度与「结束这组」在右边，「‹」读作「离开」（write/index.js trailing / backLabel 'leave'）
            centerLabel.text = tr(phase == .trace ? "X-ANSWER.titleTrace" : "R-W03.titleSelf")
            centerLabel.accessibilityLabel = nil
            backButton.accessibilityLabel = tr("X-COMMON.leave")
        case .compare:
            // 判断页页头：左「‹」（读屏「接着写」）/ 中间标题 / 右计数
            centerLabel.text = tr("R-W03.titleCompare")
            centerLabel.accessibilityLabel = nil
            backButton.accessibilityLabel = tr("R-W09.continueWriting")
            progressLabel.text = tr("R-W01.progress", ["n": n, "total": total])
            progressLabel.accessibilityLabel = tr("R-W01.progressLabel", ["n": n, "total": total])
        }
        progressLabel.isHidden = !compare || redo
        // 只给读屏的页标题：中间显示进度的阶段（回忆 / 重写错字页）才有；其余阶段标题就是中间那一行（AX 档判断页的也只给读屏，见版式）
        srTitleLabel.text = redo ? tr("X-REDO.title") : tr("R-W03.titleRecall")
        srTitleLabel.isHidden = !(phase == .recall || redo)
        // 页头中间：回忆阶段是进度（t15 ink3 等宽数字，网页 .sz-write__progress），其余阶段是标题（17 / 500 ink1，网页 .sz-page__title；R9-A NP-08）
        let ts = type
        if phase == .recall || redo {
            centerLabel.font = Self.tabular(axFont("progress", else: ts.font(15)))
            centerLabel.textColor = color("ink3", .secondaryLabel)
            centerLabel.numberOfLines = 1
        } else {
            // AX 档页头标题可折两行（网页 -webkit-line-clamp:2，R3-K1）
            centerLabel.numberOfLines = axOn ? 2 : 1
            NativeType.set(centerLabel, centerLabel.text, font: axFont("title", .medium, else: ts.font(17, .medium)), color: color("ink1", .label), align: .center)
        }
        // 没有本人笔画时上格「这次没写」（R-W17；正常流程到不了：没有笔画进不了判断页）
        noInkLabel.isHidden = !compare || !strokes.isEmpty
        headProgress.text = flow ? progressText : nil
        headProgress.accessibilityLabel = progressSpoken
        headProgress.isHidden = !flow
        stepsView.isHidden = !flow
        stepsView.accessibilityLabel = tr(phase == .trace ? "R-W04.stepTrace" : "R-W04.stepSelf")
        stepDots[0].backgroundColor = phase == .trace ? color("ink1", .label) : .clear
        stepDots[0].layer.borderWidth = phase == .trace ? 0 : 1
        stepDots[1].backgroundColor = phase == .retrace ? color("ink1", .label) : .clear
        stepDots[1].layer.borderWidth = phase == .retrace ? 0 : 1
        // 判断提交中也接收落笔（持住，等回包推进到下一个字；见 judge）
        ink?.drawable = compare ? submitting : !submitting
        ink?.accessibilityLabel = !compare
            ? (strokes.isEmpty ? tr("X-WRITE.gridLabel") : tr("X-WRITE.gridLabelCount", ["n": strokes.count]))
            : tr("R-W09.mineCardLabel", ["n": strokes.count])
        refFrame.isHidden = !compare
        traceLayer.setWritten(strokes.count)
        traceLayer.render(visible: phase == .trace)
        hintLayer.isHidden = flow
        // 撤销 / 清空：判断阶段不显示；无墨时 ink4 且不可点（禁用的控件仍在原位）
        undoButton.isHidden = compare
        clearButton.isHidden = compare
        undoButton.isEnabled = !strokes.isEmpty || cleared != nil
        clearButton.isEnabled = !strokes.isEmpty
        // 说明位：结果行（D19：回忆阶段、没看过答案、没有本人笔画、本字没落过笔）+ 提示说明 / 看答案流程的说明 / 没保存上
        let line = snapshot["line"] as? [String: Any]
        let lineText = line?["text"] as? String ?? ""
        let lineOn = phase == .recall && !answerSeen && flowFail == nil && strokes.isEmpty && !penDown && !lineText.isEmpty
        NativeType.set(lineLabel, lineOn ? lineText : nil, font: axFont("note", sub: "r2", else: textType.font("fs13")), color: color("ink3", .secondaryLabel))
        lineLabel.isHidden = !lineOn
        // 「修改 ›」只对可改的记录开放（sessions.canCorrect → line.canChange；看过答案 / 跳过不可改）
        let action = line?["action"] as? String ?? ""
        let changeOn = lineOn && (line?["canChange"] as? Bool) == true && !action.isEmpty
        changeButton.isHidden = !changeOn
        lineDot.isHidden = !changeOn
        if changeOn {
            changeButton.setTitle(action, for: .normal)
            changeButton.accessibilityLabel = action.replacingOccurrences(of: "\u{203A}", with: "").trimmingCharacters(in: .whitespaces)
        }
        let flowNote: String?
        if redo {
            flowNote = phase == .recall ? tr("X-REDO.note") : nil // 「再写一遍，只算练习。」（网页 redo-note，写的时候一直在）
        } else if flowFail != nil {
            flowNote = tr("R-W16.saveFailed")
        } else if phase == .trace {
            flowNote = tr(traceMissing ? "R-W08.answerNote" : "R-W07.answerNote") // 「记为看过答案」只在这一处说
        } else if phase == .retrace || recallSeen {
            flowNote = tr("R-W07.selfNote")
        } else {
            flowNote = nil
        }
        let hintNoteOn = phase == .recall && !answerSeen && flowNote == nil && !(hintNoteText ?? "").isEmpty
        // 首练第 1 字的一次性提示（网页 useFirstTip：回忆阶段、0 笔、没用过提示；一旦收起不再回来；出现即记一次 firstTipSeen）
        let firstTipOn = firstTipDue && !firstTipGone && phase == .recall && !answerSeen && flowNote == nil && strokes.isEmpty && !penDown
            && (hint?.used ?? 0) == 0 && !lineOn
        if firstTipDue && !firstTipOn && firstTipSent { firstTipGone = true }
        if firstTipOn && !firstTipSent && !redo {
            firstTipSent = true
            bridge.send("firstTip", ["slot": slot])
        }
        // 说明句一律左起（网页 .sz-write__note align-items:flex-start；R9-A NP-11）；含全角标点的句子按 NativeType.set 的苹方 UI 排（与网页同宽）
        let noteText = flowNote ?? (hintNoteOn ? hintNoteText : (firstTipOn ? tr("X-WRITE.firstTip") : nil))
        NativeType.set(noteLabel, noteText, font: axFont("note", sub: "r2", else: type.font(13)), color: color("ink3", .secondaryLabel),
                       line: (axOn ? textType.roleLine("note", sub: "r2") : nil) ?? type.lineHeight(13))
        noteLabel.isHidden = noteText == nil
        noteDot.isHidden = !hintNoteOn
        noteView.isHidden = compare
        // 页头右上：跳过（回忆阶段、没看过答案）/ 结束这组（除判断页外各阶段；底栏被保存失败占住时不显示）
        skipButton.isHidden = redo || !(phase == .recall && !answerSeen && cardKey != nil && flowFail != .skip)
        endButton.isHidden = !(!compare && canEnd && cardKey != nil && flowFail == nil)
        // 求助行：回忆 [提示][看答案]；看过答案后的回忆 [看答案][提示（不可点）]；描一遍 [下一个]；凭记忆写 [再描一遍]；没保存上 [先不保存]
        let kind = hintButton["kind"] as? String ?? "loading"
        let noFail = flowFail == nil
        let hintShown = !redo && noFail && phase == .recall && !(answerSeen && kind != "exhausted")
        hintButtonView.isHidden = !hintShown
        if kind == "unavailable" {
            // 没有笔顺数据：灰字「暂时没有提示」，不是按钮（M1-2 NoHintLabel）
            hintButtonView.setTitle(hintButton["label"] as? String ?? "", for: .normal)
            hintButtonView.setImage(nil, for: .normal)
            hintButtonView.setImage(nil, for: .disabled)
            hintButtonView.isEnabled = false
            hintButtonView.backgroundColor = .clear
            hintButtonView.accessibilityTraits = [.staticText]
        } else {
            hintButtonView.setTitle(hintButton["text"] as? String ?? tr("R-W05.hintLabel"), for: .normal)
            if hintButtonView.image(for: .normal) == nil { setIcon(hintButtonView, .hint) }
            hintButtonView.isEnabled = (hintButton["disabled"] as? Bool) != true && !hintBusy
            hintButtonView.backgroundColor = color("field", .secondarySystemFill)
            hintButtonView.accessibilityTraits = [.button]
        }
        hintButtonView.accessibilityLabel = hintButton["label"] as? String
        answerButton.isHidden = redo || !(noFail && phase == .recall)
        redoAnswerButton.isHidden = !(redo && phase == .recall)
        redoAgainButton.isHidden = !(redo && compare)
        retraceButton.isHidden = !(noFail && phase == .retrace)
        nextHelpButton.isHidden = !(noFail && phase == .trace)
        flowCancelButton.isHidden = noFail
        // 主按钮：写好了 / 凭记忆写 / 下一个 / 再试一次（没保存上）
        doneButton.isHidden = compare && !redo
        let primary = primaryModel()
        doneButton.setTitle(primary.title, for: .normal)
        doneButton.accessibilityIdentifier = primary.id
        doneButton.isEnabled = primary.enabled
        doneButton.backgroundColor = primary.enabled ? color("btn-bg", .label) : color("field", .secondarySystemFill) // 网页 .sz-btn--primary：--btn-bg（R9-A NP-12）
        wrongButton.isHidden = !compare || failed || redo
        correctButton.isHidden = !compare || failed || redo
        failNote.isHidden = !(compare && failed)
        failCancel.isHidden = !(compare && failed)
        failRetry.isHidden = !(compare && failed)
        wrongButton.isEnabled = !submitting && judgeKeysReady
        correctButton.isEnabled = !submitting && judgeKeysReady
        failRetry.isEnabled = !submitting
        trackTitles()
    }

    /// B2.9b：读屏顺序 = 网页 DOM 顺序（页头：‹、页标题、中间、右槽；正文：步骤点、题面、书写格 / 对照两格、撤销 / 清空、格下说明；撤销条；底栏），
    /// 不按几何位置排（UIKit 默认先读位置靠上的右槽按钮，进度就落到了「跳过」后面）。确认框开着时它是模态，只读框里的。
    private func updateAccessibilityOrder() {
        var order: [UIView] = [backButton, srTitleLabel, centerLabel, progressLabel, headProgress, endButton, skipButton]
        var body: [UIView] = [stepsView, promptView, noInkLabel]
        if let ink { body.append(ink) }
        body += [refFrame, undoButton, clearButton, noteView]
        if bodyScroll.superview != nil {
            bodyScroll.accessibilityElements = body.filter { !$0.isHidden }
            order.append(bodyScroll)
        } else {
            order += body
        }
        order.append(srStatusLabel)
        if let bar = undoBar { order.append(bar) }
        order += [srAnswerLabel, footView]
        if let d = endDialog { order.append(d) }
        // 明示的顺序表里藏起来的视图读屏仍摸得到：只放此刻显示着的（空的播报区不放，网页空的 aria-live 区读屏不停留）
        view.accessibilityElements = order.filter { !$0.isHidden && !(($0 as? UILabel).map { ($0.text ?? "").isEmpty } ?? false) }
        noteView.accessibilityElements = [lineLabel, changeButton, noteLabel].filter { !$0.isHidden } // 结果行：正文在前、「修改」在后（网页 DOM 顺序），「·」不读
    }

    /// 状态播报（网页 sr-live.js：经 aria-live=polite 区域读；那一句留在区域里）。
    private func say(_ text: String) {
        guard !text.isEmpty else { return }
        srStatusLabel.text = text
        srStatusLabel.accessibilityLabel = text
        NativeA11y.announce(text)
        view.setNeedsLayout()
    }

    /// 参考字形的读屏名称（页面 refLabel op：字、拼音、笔画数、结构，网页 refCardLabel 同一句）；回来前先用「标准写法：字」。
    private func requestRefLabel() {
        let c = char
        guard !c.isEmpty else { return }
        if let l = refLabels[c] { applyRefLabel(l, for: c); return }
        applyRefLabel(tr("R-W09.refCardLabelChar", ["char": c]), for: c)
        bridge.call("refLabel", ["char": c, "cardKey": cardKey ?? ""]) { [weak self] reply in
            guard let self, let l = reply.body["label"] as? String, !l.isEmpty else { return }
            self.refLabels[c] = l
            self.applyRefLabel(l, for: c)
        }
    }

    private func applyRefLabel(_ label: String, for c: String) {
        guard c == char else { return }
        refGlyph.accessibilityLabel = label
        srAnswerLabel.text = label
        srAnswerLabel.accessibilityLabel = label
    }

    /// 换字 / 换阶段时读屏焦点落在页标题（网页推入后焦点在 h1；回忆阶段那是只给读屏的标题）。
    private var screenFocus: UIView { srTitleLabel.isHidden ? centerLabel : srTitleLabel }

    /// 按钮标题的中文字距与网页一致（NativeType.trackTitle：WebKit 按实际字号取 trak 字距）。标题 / 字体变了之后调用。
    private func trackTitles() {
        for b in [skipButton, endButton, undoButton, clearButton, hintButtonView, answerButton, retraceButton, nextHelpButton, flowCancelButton,
                  redoAnswerButton, redoAgainButton, doneButton, wrongButton, correctButton, failCancel, failRetry] as [UIButton] {
            NativeType.trackTitle(b)
        }
        // 「修改 ›」：网页是「修改」+ 4 的间距（按钮 inline-flex gap）+「›」，原生标题里的空格按 4 排
        NativeType.linkTitle(changeButton)
    }

    private func primaryModel() -> (title: String, id: String, enabled: Bool) {
        if redo {
            // 重写错字：写好了（没落笔不可点）/ 下一个（最后一个字「完成」）
            if phase == .compare { return (redoLast ? tr("X-RESULT.done") : tr("R-W07.btnNext"), "native-redo-next", !redoBusy) }
            return (tr("R-W29.btnDone"), "native-redo-done", !strokes.isEmpty)
        }
        if flowFail != nil { return (tr("R-W16.retry"), "native-write-retry", true) }
        switch phase {
        case .trace: return (tr("X-ANSWER.btnTraceDone"), "native-write-trace-done", true)
        case .retrace: return (tr("R-W07.btnNext"), "native-write-next", true)
        case .recall: return answerSeen ? (tr("R-W07.btnNext"), "native-write-next", true) : (tr("R-W29.btnDone"), "native-write-done", !strokes.isEmpty)
        case .compare: return (tr("R-W29.btnDone"), "native-write-done", false)
        }
    }

    // MARK: 版式（A7；NativeWriteLayout = 网页 layout.js；AX 档专门排法在 B2.9）

    private var firstLayoutDone = false

    private static func scaled(_ style: UIFont.TextStyle, _ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        defer {
            if !firstLayoutDone, let t = openTiming {
                firstLayoutDone = true
                #if DEBUG
                NativeWriteMetrics.shared.firstLayout(ms: (CACurrentMediaTime() - t.receivedAt) * 1000)
                #endif
                _ = t
            }
        }
        let k = layoutK
        let safe = view.safeAreaInsets
        let w = view.bounds.width, h = view.bounds.height
        let gutter = k.sideMargin
        let ax = axOn
        let compare = phase == .compare
        // 页头中间是标题（描一遍 / 凭记忆写 / 判断），回忆阶段与重写错字页是进度；AX 档判断页的标题只留给读屏（网页 hideTitle，D49 ⑧）
        let titleMode = !(phase == .recall || redo)
        let srTitle = ax && titleMode && compare

        // 页头：名义 44，大字号下按量到的行高长高（多出的部分从组顶扣掉，书写格在页面上的 y 不变）；AX 档按标题实际行数（至多两行）
        var headH = ax ? k.nominalHead : max(k.nominalHead, ceil(centerLabel.font.lineHeight) + 16)
        // 页头（网页 Page.js .sz-page__head + write/index.js headtools；R9-A）：左槽 [页边, 页边 + 44]，「‹」44 × 44 左移 17.75（箭头描边外缘落在页边线上）；
        // 右槽贴页边、至少 44 宽；中间（进度或标题）在两槽之间、各让 8 居中。
        // 右槽内容：回忆 [结束这组][16][跳过]，描一遍 / 凭记忆写 [进度 +4][结束这组]，判断 [进度 +4]。「结束这组」左右各有 4 的内边距，「跳过」没有（字形外缘贴页边）。
        func layoutHead(_ headH: CGFloat) -> CGFloat {
            let headY = safe.top + (headH - 44) / 2
            backButton.frame = ShiziPageHeader.leadFrame(.back, gutter: gutter, y: headY)
            var right = w - gutter
            // 文字按钮按字的实宽排（不取整，网页同），框取整后左右各让出一半，字仍落在实宽的位置上
            let place = { (b: NativeIconTextButton, right: CGFloat, pad: CGFloat) -> CGFloat in
                let tw = b.textWidth, bw = tw + 2 * pad, fw = ceil(tw) + 2 * pad
                b.frame = CGRect(x: right - bw - (fw - bw) / 2, y: headY, width: fw, height: 44)
                return bw
            }
            let progressW = { (l: UILabel) in ceil(l.sizeThatFits(CGSize(width: w / 3, height: headH)).width) }
            if phase == .recall || redo {
                if !skipButton.isHidden {
                    right -= place(skipButton, right, 0) + 16
                }
                if !endButton.isHidden {
                    right -= place(endButton, right, 4)
                } else if !skipButton.isHidden {
                    right += 16
                }
            } else if compare {
                let pw = progressW(progressLabel)
                progressLabel.frame = CGRect(x: right - 4 - pw, y: safe.top, width: pw, height: headH)
                right -= pw + 4
            } else {
                if !endButton.isHidden {
                    right -= place(endButton, right, 4)
                }
                if !headProgress.isHidden {
                    let pw = progressW(headProgress)
                    headProgress.frame = CGRect(x: right - 4 - pw, y: safe.top, width: pw, height: headH)
                    right -= pw + 4
                }
            }
            return min(right, w - gutter - 44)
        }
        var trailLeft = layoutHead(headH)
        let centerX = ShiziPageHeader.centerLeft(gutter: gutter)
        centerLabel.clipsToBounds = srTitle
        if srTitle {
            // 只给读屏（网页 .sz-page__title--hidden：1 × 1、裁掉）：读屏名称与 screenChanged 落点照旧
            centerLabel.frame = ShiziPageHeader.screenReaderTitleFrame(gutter: gutter, top: safe.top)
        } else if !titleMode {
            // 回忆阶段（与重写错字页两个阶段）中间是进度：框 = 字宽 × lh15，在两槽之间居中（网页 .sz-page__center 里的 .sz-write__progress）
            let tw = ceil(centerLabel.sizeThatFits(CGSize(width: w, height: headH)).width)
            let lh = (ax ? textType.roleLine("progress") : nil) ?? type.lineHeight(15)
            let mid = (centerX + trailLeft - 8) / 2
            centerLabel.frame = CGRect(x: mid - tw / 2, y: safe.top + (headH - lh) / 2, width: tw, height: lh)
        } else if ax {
            // AX 档标题：两槽之间、左右各 4 的内边距，至多两行（网页 -webkit-line-clamp:2），页头随之长高、两侧按钮竖向居中
            let tw = max(0, trailLeft - 8 - centerX - 8)
            let lh = textType.roleLine("title") ?? ceil(centerLabel.font.lineHeight)
            let fit = centerLabel.sizeThatFits(CGSize(width: tw, height: .greatestFiniteMagnitude)).height
            let lines = min(2, max(1, (fit / max(1, centerLabel.font.lineHeight)).rounded()))
            let th = lines * lh
            if th > headH {
                headH = th
                trailLeft = layoutHead(headH)
            }
            centerLabel.frame = CGRect(x: centerX + 4, y: safe.top + (headH - th) / 2, width: max(0, trailLeft - 8 - centerX - 8), height: th)
        } else {
            centerLabel.frame = CGRect(x: centerX, y: safe.top, width: max(0, trailLeft - 8 - centerX), height: headH)
        }
        let headExtra = ax ? 0 : headH - k.nominalHead

        // 底栏：主按钮下沿 = 屏底 − max(24, 下安全区)；求助行在主按钮正上方 20（AX 档：网页 foot.js / components/ax.js 量到的行高、最小高与间距；放不下 220 时收紧，P278）
        let footBottom = max(k.footBottomMin, safe.bottom)
        // 主按钮高 = max(--btn-h, lh17s)、求助行高 = max(48, lh17)（网页 .sz-btn--primary / .sz-write__links）
        let ts = type
        let helpRole = axTight ? "helpTight" : "help"
        var primaryH = max(ts.buttonHeight, ts.lh17s)
        var helpH = ts.ax ? max(56, ceil(hintButtonView.titleLabel?.font.lineHeight ?? 22) + 26) : max(48, ts.lineHeight(17))
        var footGap: CGFloat = 20
        if ax {
            // 主按钮：min-height calc(1.3em + 20px)（写字页底栏），字折行时按行数 × 行高 + 上下内边距
            let lh5 = textType.roleLine(helpRole, sub: "r5") ?? ts.lh17s
            let pad5 = axValue(helpRole, "padTop", sub: "r5") ?? 0
            let avail = w - 2 * gutter - 32
            let titleW = ceil((doneButton.currentTitle as NSString? ?? "").size(withAttributes: [.font: doneButton.titleLabel?.font as Any]).width)
            let lines = max(1, ceil(titleW / max(1, avail)))
            primaryH = max(axValue(helpRole, "minH", sub: "r5") ?? primaryH, lines * lh5 + 2 * pad5)
            // 求助行：行的最小高（.sz-write__links 56 / 收紧 48）撑满按钮（align-items:stretch）
            helpH = max(axValue(helpRole, "minH", sub: "r4") ?? 0, axValue(helpRole, "minH") ?? helpH, textType.roleLine(helpRole) ?? 0)
            footGap = axValue(helpRole, "gap", sub: "r3") ?? footGap
        }
        let primaryY = h - footBottom - primaryH
        let helpY = primaryY - footGap - helpH
        // AX 档判断两键上下排（网页 components/ax.js：.sz-judge__btns 一列，键高 calc(1.3em + 28px)，间距 12），求助行的留空行不占位（.sz-write__links--ghost display:none）
        let judgeStack = ax && compare && !redo && (axValue("judge", "cols", sub: "r2") ?? 2) == 1
        let judgeH = ax ? max(axValue("judge", "minH") ?? primaryH, primaryH) : primaryH
        let judgeGap = axValue("judge", "gap", sub: "r2") ?? 12
        // 保存失败：说明句在求助行上面一行，底栏比平时高出这一截（网页底栏同一结构：说明 → 20 → 求助行 → 20 → 主按钮，说明 margin-bottom 6）
        let noteH = failed ? ceil(failNote.sizeThatFits(CGSize(width: w - 2 * gutter, height: .greatestFiniteMagnitude)).height) : 0
        let noteExtra = failed ? noteH + 26 : 0
        let recallFootTop = helpY - 12
        let footTopBase = judgeStack && !failed ? h - footBottom - 2 * judgeH - judgeGap - 12 : recallFootTop
        let footTop = footTopBase - noteExtra
        footView.frame = CGRect(x: 0, y: footTop, width: w, height: h - footTop)
        let fy = { (y: CGFloat) in y - footTop }
        doneButton.frame = CGRect(x: gutter, y: fy(primaryY), width: w - 2 * gutter, height: primaryH)
        if judgeStack {
            correctButton.frame = CGRect(x: gutter, y: fy(h - footBottom - judgeH), width: w - 2 * gutter, height: judgeH)
            wrongButton.frame = CGRect(x: gutter, y: correctButton.frame.minY - judgeGap - judgeH, width: w - 2 * gutter, height: judgeH)
        } else {
            let half = (w - 2 * gutter - 12) / 2
            wrongButton.frame = CGRect(x: gutter, y: fy(primaryY), width: half, height: primaryH)
            correctButton.frame = CGRect(x: gutter + half + 12, y: fy(primaryY), width: half, height: primaryH)
        }
        let helpOrder: [UIButton] = recallSeen ? [answerButton, hintButtonView] : [hintButtonView, answerButton, retraceButton, nextHelpButton, flowCancelButton, redoAnswerButton, redoAgainButton]
        let helps = helpOrder.filter { !$0.isHidden }
        let slotW = helps.count > 1 ? (w - 2 * gutter - 12) / 2 : w - 2 * gutter
        for (i, b) in helps.enumerated() {
            b.frame = CGRect(x: gutter + CGFloat(i) * (slotW + 12), y: fy(helpY), width: slotW, height: helpH)
        }
        failRetry.frame = doneButton.frame
        failCancel.frame = CGRect(x: gutter, y: fy(helpY), width: w - 2 * gutter, height: helpH)
        failNote.frame = CGRect(x: gutter, y: fy(helpY) - 26 - noteH, width: w - 2 * gutter, height: noteH)

        // 题面：拼音行 + 4 + 52 的格（有提示行时下面再一行）；P = 量到的整个题面高
        // AX 档（网页 prompt.js）：格 = 52 × min(--k, 1.6)，拼音上方留白 34 / 40，拼音 22 / 28pt，提示行离格 8（提示行元素 AX 档总有 8 的上外边距）
        let cell: CGFloat = axValue("prompt", "w", sub: "r2") ?? 52
        // 拼音行：max(24, lh15)，与格间 4（网页 .sz-prompt__wordwrap padding-top）
        let pyLine = (ax ? textType.roleLine("prompt", sub: "r3") : nil) ?? (ts.ax ? ceil(ts.font(15).lineHeight) : ts.lineHeight(15))
        let pyH = ax ? (axValue("prompt", "padTop") ?? pyLine + 8) - 4 : (ts.ax ? pyLine + 4 : max(24, pyLine))
        let count = CGFloat(max(1, promptCells.count))
        let rowW = min(w - 2 * gutter, cell * count)
        let cw = rowW / count
        let hintGap: CGFloat = ax ? (axValue("prompt", "marginTop", sub: "r5") ?? 8) : 10 // 提示行离格 10（AX 档 8）
        let hintText = promptHint.isHidden ? 0 : ceil(promptHint.sizeThatFits(CGSize(width: w - 2 * gutter, height: .greatestFiniteMagnitude)).height)
        let hintH = ax ? hintGap + hintText : (promptHint.isHidden ? 0 : hintText + hintGap)
        let promptH = pyH + 4 + cw + hintH

        // 格下说明位的内容（结果行 / 说明）：先排内容，AX 档格下高度要用（axWriteLayout 的 N）
        let noteW = w - 2 * gutter // 说明位取内容宽（网页 .sz-write__below 与正文同宽，r7-W3）
        var ny: CGFloat = 0
        if !lineLabel.isHidden {
            // 网页 .sz-line（R9-B，NP-14）：13 / 20 一行「正文 · 修改 ›」，列间 8、折行时行间 4；「修改 ›」按钮盒 = 文字宽 + 8（至少 44）× 44，
            // 盒子左缘比字左缘外伸 4，下沿对齐行底再 +（说明位 40 − 行高）/ 2，比行多出的高度全部伸向上面（点击区整块 44，NP-01）
            // AX 档：行高取格下字的行高（30），「修改 ›」的外边距盒 40 撑起这一行（网页 flex align-items:center）
            let rowH = (ax ? textType.roleLine("note", sub: "r2") : nil) ?? textType.line("lh13")
            let lh = NativeType.height(lineLabel, width: noteW, line: rowH)
            if changeButton.isHidden {
                lineLabel.frame = CGRect(x: 0, y: 0, width: noteW, height: lh)
                lineDot.frame = .zero
                ny = lh
            } else {
                let lw = NativeType.width(lineLabel)
                let dotW = NativeType.width(lineDot)
                let cw = NativeType.titleWidth(changeButton)
                let bw = max(44, cw + 8)
                if ax {
                    let rowBox = max(rowH, 40)
                    let inset = (rowBox - rowH) / 2
                    if lw + 8 + dotW + 8 + cw <= noteW {
                        lineLabel.frame = CGRect(x: 0, y: inset, width: lw, height: rowH)
                        lineDot.frame = CGRect(x: lw + 8, y: inset, width: dotW, height: rowH)
                        changeButton.frame = CGRect(x: lw + 8 + dotW + 8 - 4, y: (rowBox - 40) / 2 - 4, width: bw, height: 44)
                        ny = rowBox
                    } else {
                        lineLabel.frame = CGRect(x: 0, y: 0, width: noteW, height: lh)
                        let y2 = lh + 4
                        lineDot.frame = CGRect(x: 0, y: y2 + inset, width: dotW, height: rowH)
                        changeButton.frame = CGRect(x: dotW + 8 - 4, y: y2 + (rowBox - 40) / 2 - 4, width: bw, height: 44)
                        ny = y2 + rowBox
                    }
                } else {
                    let below = max(0, (k.noteHeight - rowH) / 2) // 行下沿到说明位下沿
                    if lw + 8 + dotW + 8 + cw <= noteW {
                        lineLabel.frame = CGRect(x: 0, y: 0, width: lw, height: rowH)
                        lineDot.frame = CGRect(x: lw + 8, y: 0, width: dotW, height: rowH)
                        changeButton.frame = CGRect(x: lw + 8 + dotW + 8 - 4, y: rowH + below - 44, width: bw, height: 44)
                        ny = rowH
                    } else {
                        // 折行：正文占满一行（可多行），「· 修改 ›」接在下一行行首（flex-wrap，行间 4）
                        lineLabel.frame = CGRect(x: 0, y: 0, width: noteW, height: lh)
                        let y2 = lh + 4
                        lineDot.frame = CGRect(x: 0, y: y2, width: dotW, height: rowH)
                        changeButton.frame = CGRect(x: dotW + 8 - 4, y: y2 + rowH / 2 - 24, width: bw, height: 44)
                        ny = y2 + rowH
                    }
                }
                // 字的竖向中线对齐行中线：按钮盒上内边距 = 2 ×（行中线 − 盒顶）− 44
                let rowMid = lineDot.frame.midY
                changeButton.contentEdgeInsets = UIEdgeInsets(top: max(0, 2 * (rowMid - changeButton.frame.minY) - 44), left: 4, bottom: 0, right: 4)
            }
        }
        if !noteLabel.isHidden {
            let nw = noteW - (noteDot.isHidden ? 0 : 14)
            // AX 档：盒高 = 行数 × 网页行高（字在行里竖向居中，同网页半行距）
            let nh = ax ? NativeType.height(noteLabel, width: nw, line: textType.roleLine("note", sub: "r2") ?? noteLabel.font.lineHeight)
                : ceil(noteLabel.sizeThatFits(CGSize(width: nw, height: .greatestFiniteMagnitude)).height)
            let dx: CGFloat = noteDot.isHidden ? 0 : 14 // 提示说明有朱点；看答案流程的说明 / 没保存上居中、无点
            noteLabel.frame = CGRect(x: dx, y: ny, width: noteW - dx, height: nh)
            noteDot.frame = CGRect(x: 0, y: ny + (noteLabel.font.lineHeight - 6) / 2, width: 6, height: 6)
            ny = noteLabel.frame.maxY
        }
        // AX 档格下：撤销 / 清空行（离格 4 + 44；收紧时贴格）+ 说明位（上内边距 8、至少两行高，网页 .sz-write__note；收紧时去掉内边距）
        let noteRole = axTight ? "noteTight" : "note"
        let notePad: CGFloat = ax ? (axValue(noteRole, "padTop") ?? 8) : 0
        let noteBox: CGFloat = ax ? max(axValue(noteRole, "minH") ?? k.axNoteHeight, notePad + ny) : k.noteHeight
        let toolGap: CGFloat = ax && axTight ? 0 : 4
        let toolRow: CGFloat = ax ? 44 + toolGap : k.toolRowHeight
        var belowH = (toolRow + noteBox).rounded()
        if ax {
            let key = "\(cardKey ?? "")|\(phase)"
            if let m = axBelowMemo, m.key == key { belowH = max(belowH, m.h) }
            axBelowMemo = (key, belowH)
        }

        let headBottom = safe.top + headH
        let mainH = footTopBase - headBottom
        var top: CGFloat
        var g: CGFloat
        var promptScale: CGFloat = 1
        var compareSide = false
        var compareS: CGFloat = 0
        var recallTop: CGFloat
        var recallG: CGFloat
        if ax {
            // AX 档（layout.js axWriteLayout / judgeAxLayout）：按实际主区高排（网页量的是 clientHeight / offsetHeight，整数）
            let P = promptH.rounded()
            let recallMain = (recallFootTop - headBottom).rounded()
            let A = NativeWriteLayout.axWrite(width: w, mainHeight: recallMain, promptHeight: P, noteHeight: belowH, k)
            recallTop = A.top
            recallG = A.g
            top = A.top
            g = A.g
            promptScale = A.promptScale
            // P278：书写格放不下 220 → 底栏收紧（封顶后同一字号 / 尺寸不再放回，网页 footCompactKey）
            let viewKey = "\(textType.axLevel)|\(w)|\(h)"
            if A.tight, !axTight || axTightKey != viewKey {
                axTight = true
                axTightKey = viewKey
                applyType()
                view.setNeedsLayout()
            } else if axTight, axTightKey != viewKey {
                axTight = false
                applyType()
                view.setNeedsLayout()
            }
            if compare {
                let J = NativeWriteLayout.judgeAx(width: w, mainHeight: (mainH - noteExtra).rounded(), promptHeight: P * promptScale, gap: 12, k)
                top = J.top
                compareSide = J.side
                compareS = J.s
            }
        } else {
            let nominal = NativeWriteLayout.nominalMainHeight(pageHeight: h, safeTop: safe.top, footBottom: footBottom, k)
            let L = NativeWriteLayout.write(width: w, nominalHeight: nominal, promptHeight: promptH, headExtra: headExtra, k)
            // 大字号下页头 / 底栏比名义高：组超出主区时整体上移（不与底栏重叠），书写格边长不变（D36）
            let overflow = max(0, L.top + promptH + k.promptGap + L.g + k.toolsHeight - mainH)
            top = max(0, L.top - overflow)
            g = L.g
            recallTop = top
            recallG = g
        }
        promptView.transform = .identity
        promptView.frame = CGRect(x: 0, y: headBottom + top, width: w, height: promptH)
        promptRow.frame = CGRect(x: (w - rowW) / 2, y: pyH + 4, width: rowW, height: cw)
        promptHint.frame = CGRect(x: gutter, y: promptRow.frame.maxY + hintGap, width: w - 2 * gutter, height: hintText)
        for (i, c) in promptCells.enumerated() {
            c.frame = CGRect(x: CGFloat(i) * cw, y: 0, width: cw, height: cw)
            for sub in c.subviews {
                switch sub.tag {
                case 1: // 拼音：字宽、在格上方居中（网页 .sz-prompt__py left:50% translateX(-50%)、行高 lh15、离格 4）
                    let tw = ceil(sub.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: pyLine)).width)
                    sub.frame = CGRect(x: (cw - tw) / 2, y: -4 - pyLine, width: tw, height: pyLine)
                case 2: sub.frame = c.bounds
                default: sub.frame = c.bounds.insetBy(dx: cw * 0.1, dy: cw * 0.1)
                }
            }
        }
        if promptScale < 1 {
            // P299：题面整体按可用高度缩小（网页 transform scale，原点上边中点；量到的题面高不受影响）
            let f = promptView.frame
            promptView.transform = CGAffineTransform(translationX: 0, y: -f.height * (1 - promptScale) / 2).scaledBy(x: promptScale, y: promptScale)
        }
        let shownPrompt = promptH * promptScale

        // 书写格：边长与顶边由名义版式定（同一张卡的所有阶段不动；AX 档按实际主区高）
        let gridGap: CGFloat = ax && axTight ? 8 : k.promptGap
        let gridTop = headBottom + top + shownPrompt + gridGap
        let recallGridTop = headBottom + recallTop + shownPrompt + gridGap
        let gridRect = CGRect(x: (w - recallG) / 2, y: recallGridTop, width: recallG, height: recallG)
        _ = g
        // 格下：撤销贴格左沿、清空贴格右沿（离格 4、高 44），说明位在它下面
        let toolW = max(88, gridRect.width / 2 - 8)
        undoButton.frame = CGRect(x: gridRect.minX, y: gridRect.maxY + toolGap, width: toolW, height: 44)
        clearButton.frame = CGRect(x: gridRect.maxX - toolW, y: gridRect.maxY + toolGap, width: toolW, height: 44)
        undoButton.contentHorizontalAlignment = .leading
        clearButton.contentHorizontalAlignment = .trailing
        let noteTop = gridRect.maxY + toolRow
        if ax {
            noteView.frame = CGRect(x: gutter, y: noteTop + notePad, width: noteW, height: max(ny, 1))
        } else {
            noteView.frame = CGRect(x: gutter, y: noteTop + max(0, (k.noteHeight - ny) / 2), width: noteW, height: max(ny, 1))
        }

        recallGridRect = gridRect
        if !reversing { // 判断 → 回忆倒放中：书写格 / 参考格的位置由动画驱动（版式不覆盖）
            if !compare {
                gridFrame.frame = gridRect
            } else if ax {
                // AX 档判断页（judgeAxLayout）：并排（间距 12）或上下排（共用一条格线）
                let s = compareS
                if compareSide {
                    gridFrame.frame = CGRect(x: gutter, y: gridTop, width: s, height: s)
                    refFrame.frame = CGRect(x: w - gutter - s, y: gridTop, width: s, height: s)
                } else {
                    gridFrame.frame = CGRect(x: (w - s) / 2, y: gridTop, width: s, height: s)
                    refFrame.frame = CGRect(x: (w - s) / 2, y: gridTop + s - frameW, width: s, height: s)
                }
                refGlyph.frame = refFrame.bounds
            } else {
                // 判断：上下两格（同一顶边、同一中线，共用一条格线 = 第二格上移 frameW；D46 ⑪）。边长按「主区高 − 说明句」算（保存失败时底栏长高）
                let s = min(g, NativeWriteLayout.judgePair(width: w, mainHeight: mainH - noteExtra, gridTop: gridTop - headBottom, k))
                gridFrame.frame = CGRect(x: (w - s) / 2, y: gridTop, width: s, height: s)
                refFrame.frame = CGRect(x: (w - s) / 2, y: gridTop + s - frameW, width: s, height: s)
                refGlyph.frame = refFrame.bounds
            }
            ink?.frame = gridFrame.frame.insetBy(dx: frameW, dy: frameW)
        }
        layoutGuides()
        noInkLabel.frame = gridFrame.frame.insetBy(dx: 8, dy: 8)
        hintLayer.frame = gridRect.insetBy(dx: frameW, dy: frameW)
        traceLayer.frame = gridRect.insetBy(dx: frameW, dy: frameW)
        // 两个小点（第 1 步 / 第 2 步）在题面上方一行（write/index.js StepDots：高 5、上移 8）
        stepsView.frame = CGRect(x: 0, y: promptView.frame.minY - 8, width: w, height: 5)
        stepDots[0].frame = CGRect(x: w / 2 - 7.5, y: 0, width: 5, height: 5)
        stepDots[1].frame = CGRect(x: w / 2 + 2.5, y: 0, width: 5, height: 5)
        if let bar = undoBar {
            let bw = w - 2 * gutter
            let bh = bar.height(for: bw)
            // 网页 SkipUndoDock：贴在底栏上方 8（底栏 = 求助行上方 12 起；保存失败时底栏更高，条跟着上移）
            bar.frame = CGRect(x: gutter, y: footTop - 8 - bh, width: bw, height: bh)
        }
        endDialog?.frame = view.bounds
        srTitleLabel.frame = CGRect(x: gutter - 1, y: safe.top + 21.5, width: 1, height: 1)
        srStatusLabel.frame = CGRect(x: gutter - 1, y: safe.top + 43, width: 1, height: 1)
        srAnswerLabel.frame = CGRect(x: gutter - 1, y: footTop, width: 1, height: 1)
        srAnswerLabel.isHidden = phase != .trace
        // Same final fallback as Page.js: header/footer stay fixed, only body
        // overflow scrolls after fitGridMin/promptFitMin have been exhausted.
        layoutOverflowBody(head: headBottom, foot: footTopBase,
                           bottom: max(gridRect.maxY + belowH, noteView.frame.maxY),
                           enabled: ax && !compare)
        updateAccessibilityOrder()
        startStepPlayIfNeeded()
    }

    // MARK: 控件样式（设计系统：文字按钮 15 ink2；凹面求助 field 底 17/500；主按钮墨底 17/500 圆角 12）

    /// 文字按钮（网页 .sz-btn--text / .sz-write__tool：17 号常规 ink2，禁用 ink4；图标 20、与字间距 6；字号在 applyType）。
    private func configureTextButton(_ b: NativeIconTextButton, title: String, icon: NativeWriteIcon?, id: String) {
        b.setTitle(title, for: .normal)
        b.toolIcon = icon
        b.spacing = 6
        b.tintColor = color("ink2", .secondaryLabel)
        b.setTitleColor(color("ink2", .secondaryLabel), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.accessibilityIdentifier = id
    }

    /// 求助行的凹面按钮（网页 .sz-write__links .sz-btn--text：field 底、17 / 500 ink1；图标 18 ink2、在字前、间距 8；字号在 applyType）。
    private func configureHelp(_ b: UIButton, title: String, icon: NativeWriteIcon?, id: String) {
        b.setTitle(title, for: .normal)
        if let ib = b as? NativeIconTextButton {
            ib.toolIcon = icon
            ib.spacing = 8
        }
        b.titleLabel?.numberOfLines = 2
        b.titleLabel?.textAlignment = .center
        b.tintColor = color("ink2", .secondaryLabel)
        b.setTitleColor(color("ink1", .label), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.backgroundColor = color("field", .secondarySystemFill)
        b.layer.cornerRadius = 12
        b.accessibilityIdentifier = id
    }

    /// 主按钮（网页 .sz-btn--primary：--btn-bg 底、--btn-fg 字、17 / 500、圆角 12；禁用 field 底 ink4 字；字号在 applyType）。
    private func configurePrimary(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24) // 网页 .sz-btn--primary padding 0 24（AX 档折行时同宽）
        b.backgroundColor = color("btn-bg", .label)
        b.setTitleColor(color("btn-fg", .systemBackground), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.layer.cornerRadius = 12
        b.accessibilityIdentifier = id
    }

    /// 图标的两张图：可点 / 禁用（网页 currentColor：可点时文字按钮 ink2、求助行图标 ink2，禁用 ink4）。AX 档放大（撤销 / 清空 24、求助 22，B2.9 前的近似）。
    private func setIcon(_ b: NativeIconTextButton, _ icon: NativeWriteIcon) {
        let ax = type.ax
        // AX 档的图标尺寸取网页同一条规则量到的值（.sz-write__tool svg 24、.sz-write__ic 22）；页面没给时按 B2.9 前的近似
        let size: CGFloat = icon == .undo || icon == .clear ? (axValue("tool", "w", sub: "r2") ?? (ax ? 24 : 20))
            : (icon == .back ? 22 : (axValue("help", "w", sub: "r2") ?? (ax ? 22 : 18)))
        let on = icon == .back ? color("ink1", .label) : color("ink2", .secondaryLabel)
        b.iconSize = size
        b.setImage(icon.image(on, size: size), for: .normal)
        b.setImage(icon.image(color("ink4", .tertiaryLabel), size: size), for: .disabled)
    }

    /// 字阶与图标（R9-A：网页 --fsN 同值，非 AX 档 = 基准 × k；图标固定尺寸不随字号放大，NP-09 / NP-18）。进页面、系统字号变化、页面重载时调用。
    private func applyType() {
        let ts = type
        setIcon(backButton, .back)
        backButton.titleLabel?.font = ts.font(15) // 页头按钮继承正文 t15（网页 button font:inherit）；「‹」没有字
        for l in [progressLabel, headProgress] {
            l.font = Self.tabular(axFont("progress", else: ts.font(15)))
            l.adjustsFontForContentSizeCategory = false
            l.textColor = color("ink3", .secondaryLabel)
        }
        centerLabel.adjustsFontForContentSizeCategory = false
        // AX 档（B2.9b）：页头文字按钮 / 格下撤销清空 / 求助行 / 说明位各按网页的分层封顶取值（17 / 22pt），不是 --fs17 本身
        for b in [skipButton, endButton] {
            b.titleLabel?.font = axFont("headAct", else: ts.font(17))
            b.titleLabel?.adjustsFontForContentSizeCategory = false
        }
        for b in [undoButton, clearButton] {
            b.titleLabel?.font = axFont("tool", else: ts.font(17))
            b.titleLabel?.adjustsFontForContentSizeCategory = false
            if let icon = b.toolIcon { setIcon(b, icon) }
        }
        let helpFont = axFont(axTight ? "helpTight" : "help", .medium, else: ts.font(17, .medium))
        for b in [hintButtonView, answerButton, retraceButton, nextHelpButton, flowCancelButton, redoAnswerButton, redoAgainButton] {
            b.titleLabel?.font = helpFont
            b.titleLabel?.adjustsFontForContentSizeCategory = false
            if let icon = b.toolIcon { setIcon(b, icon) }
        }
        failCancel.titleLabel?.font = helpFont
        failCancel.titleLabel?.adjustsFontForContentSizeCategory = false
        for b in [doneButton, failRetry] {
            b.titleLabel?.font = axFont(axTight ? "helpTight" : "help", sub: "r5", .medium, else: ts.font(17, .medium))
            b.titleLabel?.adjustsFontForContentSizeCategory = false
            b.titleLabel?.numberOfLines = axOn ? 0 : 1
            b.titleLabel?.textAlignment = .center
        }
        noteLabel.font = axFont("note", sub: "r2", else: ts.font(13))
        noteLabel.adjustsFontForContentSizeCategory = false
        promptHint.adjustsFontForContentSizeCategory = false
        guideLayer.strokeColor = color("guide", .separator).cgColor
        for f in [gridFrame, refFrame] { f.backgroundColor = color("sheet", .secondarySystemBackground) }
        trackTitles()
        view.setNeedsLayout()
    }

    /// 等宽数字（网页 font-variant-numeric: tabular-nums）。
    static func tabular(_ f: UIFont) -> UIFont {
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
        return UIFont(descriptor: d, size: f.pointSize)
    }

    /// 十字虚线：线宽 0.75、虚线 4 4（345 单位，随格子缩放）；判断页不画（网页对照卡没有）。
    private func layoutGuides() {
        let b = gridFrame.bounds
        guideLayer.isHidden = phase == .compare || reversing
        guard b.width > 0 else { return }
        let u = b.width / 345
        let p = UIBezierPath()
        p.move(to: CGPoint(x: b.midX, y: 0)); p.addLine(to: CGPoint(x: b.midX, y: b.height))
        p.move(to: CGPoint(x: 0, y: b.midY)); p.addLine(to: CGPoint(x: b.width, y: b.midY))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        guideLayer.frame = b
        guideLayer.path = p.cgPath
        guideLayer.lineWidth = 0.75 * u
        guideLayer.lineDashPattern = [NSNumber(value: Double(4 * u)), NSNumber(value: Double(4 * u))]
        CATransaction.commit()
    }

    private func configureOutline(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = Self.scaled(.body, 17, .medium)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.setTitleColor(color("ink1", .label), for: .normal)
        b.layer.cornerRadius = 12
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4", .separator).cgColor
        b.accessibilityIdentifier = id
        // 按下的底是 field（网页 .sz-judge__btn[data-pressed]）；只有按下态，没有选中 / 预选 / 判定着色（D03）
        b.addAction(UIAction { [weak b, weak self] _ in b?.backgroundColor = self?.color("field", .secondarySystemFill) }, for: [.touchDown, .touchDragEnter])
        b.addAction(UIAction { [weak b] _ in b?.backgroundColor = .clear }, for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    }

    // MARK: 动作

    private var currentPhaseName: String { phase == .compare ? "compare" : "recall" }

    private func persistStrokes() {
        guard !redo, let key = cardKey else { return } // 重写错字只算练习：笔画不写回（D66 ③）
        bridge.send("strokes", ["slot": slot, "cardKey": key, "strokes": NativeInkWire.wire(strokes), "phase": currentPhaseName])
    }

    /// R12（规则：写完的笔离开前一定交到页面）：页面要离开时——换字门限内持住、已抬笔的笔现在交出（不等门限、不随页面丢），
    /// 再把本字的现场整份写回一次（strokes op，页面无差别时 noop）。抬笔时已经发过（P52），这一次补上抬笔那次没送到 / 没写上的情况
    /// （页面重载中、写入失败）。经同一条 callAsyncJavaScript 队列，一定先于随后的 exit 执行。
    /// 不交：正在写、还没抬笔的一笔（没写完，左缘 / 系统取消照旧丢弃）；提交中（判断 / 跳过 / 看答案回包前，门限 .infinity）持住的笔属于下一个字（D07）。
    /// 重写错字页只算练习，什么都不写。每次离开都调用：‹、左缘、结束这组（零判断回来源）、页面收起（close）、viewDidDisappear 兜底。
    func commitBeforeLeaving() {
        guard !redo else { return }
        ink?.flushHeld()
        guard !submitting, phase != .compare else { return } // 判断页的现场由 phase op 写过；提交中不和 judge 抢
        persistStrokes()
    }

    @objc private func tapBack() {
        if endDialog != nil { dismissEndDialog(); return } // 确认框开着：读屏 Z 形 / 返回 = 接着写
        if phase == .compare && !redo { continueWriting(); return } // 重写错字页的对照阶段「‹」= 整页离开（网页 Page 返回）
        commitBeforeLeaving()
        coordinator?.nativeWriteDidRequestBack(self)
    }

    @objc private func tapUndo() {
        let prev = strokes.count
        defer { announceStrokes(from: prev) }
        if !strokes.isEmpty { strokes.removeLast() } else if let c = cleared { strokes = c; cleared = nil } else { return }
        ink.syncPageStrokes(strokes)
        restoreHint(toCount: strokes.count)
        refresh()
        view.setNeedsLayout()
        persistStrokes()
    }

    @objc private func tapClear() {
        guard !strokes.isEmpty else { return }
        let prev = strokes.count
        defer { announceStrokes(from: prev) }
        cleared = strokes
        strokes = []
        ink.syncPageStrokes(strokes)
        restoreHint(toCount: 0)
        refresh()
        view.setNeedsLayout()
        persistStrokes()
    }

    @objc private func tapDone() {
        guard phase == .recall, !answerSeen, !strokes.isEmpty, let key = cardKey else { return }
        lightHaptic.impactOccurred(intensity: 0.5)
        if redo { enterCompare(); return } // 重写错字：本地进对照，不写阶段
        bridge.send("phase", ["slot": slot, "cardKey": key, "phase": "compare", "strokes": NativeInkWire.wire(strokes)])
        enterCompare()
    }

    // MARK: 看答案 / 描一遍 / 凭记忆写（B2.4）

    /// 主按钮：写好了 / 凭记忆写 / 下一个 / 再试一次，按当前模式。
    @objc private func tapPrimary() {
        if redo {
            if phase == .compare { tapRedoNext() } else { tapDone() }
            return
        }
        if let f = flowFail { runFlow(f); return }
        switch phase {
        case .recall: if answerSeen { runFlow(.answerNext) } else { tapDone() }
        case .trace: runFlow(.answerPhase("retrace"))
        case .retrace: runFlow(.answerNext)
        case .compare: break
        }
    }

    /// 求助行「看答案」：回忆阶段直接看（没有确认框，D51 ⑧）；看过答案后的回忆阶段 = 回描一遍。
    @objc private func tapShowAnswer() {
        guard phase == .recall, flowFail == nil else { return }
        endUndo() // 点看答案：跳过的撤销机会结束（G3）
        runFlow(answerSeen ? .answerPhase("trace") : .showAnswer)
    }

    @objc private func tapFlowCancel() {
        guard flowFail != nil else { return }
        flowFail = nil
        markStateChange()
        refresh()
        view.setNeedsLayout()
    }

    /// 提交看答案流程的一步（showAnswer / answerPhase / answerNext），D07：成功才切换 / 推进；没保存上留在原处，就地三段式（说明在格下、「先不保存」在求助行、主按钮「再试一次」）。
    /// 回包之前落下的笔先持住（同判断），到下一个状态接着画。
    func runFlow(_ action: FlowAction) {
        if action == .skip { runSkip(); return }
        guard !flowBusy, !submitting, !skipBusy, let key = cardKey else { return }
        flowBusy = true
        flowFail = nil
        ink?.acceptFrom = .infinity
        var args: [String: Any] = ["slot": slot, "cardKey": key]
        let op: String
        switch action {
        case .showAnswer: op = "showAnswer"
        case .answerPhase(let p):
            op = "answerPhase"
            args["phase"] = p
            args["strokes"] = NativeInkWire.wire(strokes)
        case .answerNext:
            op = "answerNext"
            args["strokes"] = NativeInkWire.wire(strokes)
        case .skip: return
        }
        bridge.call(op, args) { [weak self] reply in
            guard let self else { return }
            self.flowBusy = false
            if reply.ok, let fin = reply.body["finished"] as? [String: Any], let sid = fin["sessionId"] as? String {
                self.coordinator?.nativeWriteDidFinish(self, sessionId: sid, undo: nil)
                return
            }
            if reply.ok, let snap = reply.snapshot {
                self.advance(to: snap)
                self.scheduleAutoStep()
                return
            }
            if reply.errorKind == "stale", let snap = reply.snapshot {
                self.reconcile(with: snap)
                return
            }
            self.flowFailed(action)
        }
    }

    /// 结果未知后重发 / 连点：页面回 stale 且快照已经变了 → 以快照为准（已不是这个字，或这组已经写完）。
    private func reconcile(with snap: [String: Any]) {
        if (snap["active"] as? Bool) != true || (snap["done"] as? Bool) == true {
            coordinator?.nativeWriteDidFinish(self, sessionId: snapshot["sessionId"] as? String ?? "", undo: nil)
        } else {
            advance(to: snap)
            scheduleAutoStep()
        }
    }

    private func flowFailed(_ action: FlowAction) {
        ink?.dropHeld()
        ink?.acceptFrom = 0
        flowFail = action
        markStateChange()
        refresh()
        view.setNeedsLayout()
        NativeA11y.announce(tr("R-W16.saveFailed"))
    }

    // MARK: 跳过与撤销（B2.6）

    @objc private func tapSkip() {
        guard phase == .recall, !answerSeen, cardKey != nil else { return }
        runSkip()
    }

    private func runSkip() {
        guard !skipBusy, !flowBusy, !submitting, let key = cardKey else { return }
        skipBusy = true
        flowFail = nil
        ink?.acceptFrom = .infinity
        let held = strokes
        let hints = max(snapshot["hints"] as? Int ?? 0, hint?.used ?? 0)
        bridge.call("skip", ["slot": slot, "cardKey": key, "hints": hints]) { [weak self] reply in
            guard let self else { return }
            self.skipBusy = false
            if reply.ok {
                self.lightHaptic.impactOccurred(intensity: 0.5)
                let u = reply.body["undo"] as? [String: Any]
                let info = u.flatMap { b -> (String, String, String)? in
                    guard let sid = b["sessionId"] as? String, let rid = b["recordId"] as? String else { return nil }
                    return (sid, rid, b["char"] as? String ?? "")
                }
                if let fin = reply.body["finished"] as? [String: Any], let sid = fin["sessionId"] as? String {
                    // 最后一字跳过：这组结束，撤销机会随 exit 交给结果页（网页 handoffSkipUndo）
                    var handoff: [String: Any]?
                    if let info { handoff = ["sessionId": info.0, "recordId": info.1, "char": info.2, "strokes": NativeInkWire.wire(held), "remainingMs": self.skipUndoParams.ms] }
                    self.coordinator?.nativeWriteDidFinish(self, sessionId: sid, undo: handoff)
                    return
                }
                if let snap = reply.snapshot {
                    self.advance(to: snap)
                    self.scheduleAutoStep()
                }
                if let info { self.beginUndo(sessionId: info.0, recordId: info.1, char: info.2, strokes: held) }
                return
            }
            if reply.errorKind == "stale", let snap = reply.snapshot {
                self.reconcile(with: snap)
                return
            }
            self.flowFailed(.skip)
        }
    }

    /// 跳过成功：底部「已跳过「X」· 撤销」（5 秒；按住暂停；读屏时不自动收起）。
    private func beginUndo(sessionId: String, recordId: String, char: String, strokes held: [[InkRawPoint]]) {
        endUndo()
        undoInfo = (sessionId, recordId, char, held)
        let bar = NativeUndoBarView(style: toastStyle(), type: textType)
        bar.strings = .init(text: tr("R-W20.skippedToast", ["char": char]), undo: tr("R-W20.undo"), failed: tr("R-W16.saveFailed"), cancel: tr("R-W16.cancel"), retry: tr("R-W16.retry"))
        bar.onUndo = { [weak self] in self?.tapUndoSkip() }
        bar.onCancelFail = { [weak self] in self?.endUndo() }
        bar.onHold = { [weak self] in self?.undoLife?.hold() }
        bar.onRelease = { [weak self] in self?.undoLife?.release() }
        bar.alpha = 0
        if let d = endDialog { view.insertSubview(bar, belowSubview: d) } else { view.addSubview(bar) }
        undoBar = bar
        let life = NativeUndoLifetime(ms: skipUndoParams.ms, pauseWhileHeld: skipUndoParams.pauseWhileHeld, keepOpenWithAssistiveTech: skipUndoParams.keepOpen) { [weak self] in
            self?.expireUndo()
        }
        undoLife = life
        life.start()
        view.setNeedsLayout()
        view.layoutIfNeeded()
        UIView.animate(withDuration: reduceMotion ? dur("reduce") : (dur("fade") > 0 ? dur("fade") : 0.15), delay: 0, options: [.curveLinear, .allowUserInteraction]) { bar.alpha = 1 }
        NativeA11y.announce(bar.strings.text)
    }

    private func expireUndo() {
        guard let bar = undoBar, !bar.isFailed else { return }
        endUndo()
    }

    /// 撤销机会结束（到点 / 下一字一开始操作 / 离开）：收起底栏（T-fade 150ms，原位淡出）。
    func endUndo() {
        undoLife?.stop()
        undoLife = nil
        undoInfo = nil
        guard let bar = undoBar else { return }
        undoBar = nil
        UIView.animate(withDuration: reduceMotion ? dur("reduce") : 0.15, delay: 0, options: [.curveLinear]) { bar.alpha = 0 } completion: { _ in bar.removeFromSuperview() }
    }

    private func tapUndoSkip() {
        guard let u = undoInfo else { return }
        bridge.call("undoSkip", ["slot": slot, "sessionId": u.sessionId, "recordId": u.recordId, "strokes": NativeInkWire.wire(u.strokes)]) { [weak self] reply in
            guard let self, self.undoInfo?.recordId == u.recordId else { return }
            if reply.ok || reply.errorKind == "stale" {
                self.endUndo()
                if reply.ok, let snap = reply.snapshot {
                    self.lightHaptic.impactOccurred(intensity: 0.5)
                    self.advance(to: snap) // 跳过的字回来（提示次数、笔画一并放回）
                }
                return
            }
            // 撤销没保存上：不自动消失，直到重试成功或「先不保存」
            self.undoLife?.stop()
            self.undoBar?.setFailed(true)
            self.view.setNeedsLayout()
            self.markStateChange()
            NativeA11y.announce(self.tr("R-W16.saveFailed"))
        }
    }

    /// 离开时还没用掉的撤销机会（剩余时长 + 笔画）：交给来源页 / 结果页接着显示（S4）。失败态不交。
    func undoHandoff() -> [String: Any]? {
        guard let u = undoInfo, let life = undoLife, undoBar?.isFailed != true, life.remainingMs > 0 else { return nil }
        return ["sessionId": u.sessionId, "recordId": u.recordId, "char": u.char, "strokes": NativeInkWire.wire(u.strokes), "remainingMs": life.remainingMs]
    }

    var undoBarForTesting: NativeUndoBarView? { undoBar }
    var endDialogForTesting: NativeEndDialogView? { endDialog }
    var skipButtonHiddenForTesting: Bool { skipButton.isHidden }
    var endButtonHiddenForTesting: Bool { endButton.isHidden }

    // MARK: 结束这组（B2.6）

    @objc private func tapEnd() {
        guard phase != .compare, canEnd, !endBusy, endDialog == nil, let sid = snapshot["sessionId"] as? String else { return }
        endUndo() // 打开确认框即结束跳过的撤销机会
        endBusy = true
        bridge.call("end", ["slot": slot, "sessionId": sid, "action": "counts"]) { [weak self] reply in
            guard let self else { return }
            self.endBusy = false
            guard reply.ok else { return }
            self.showEndDialog(n: reply.body["n"] as? Int ?? 0, m: reply.body["m"] as? Int ?? 0, sessionId: sid)
        }
    }

    private func showEndDialog(n: Int, m: Int, sessionId: String) {
        guard endDialog == nil else { return }
        let strings = NativeEndDialogView.Strings(
            // 判断过 0 个用 confirmBodyNone（只带 n），有判断用 confirmBody（n、m）；两句都由页面给（R9-C）
            body: m > 0 ? tr("R-W15.confirmBody", ["n": n, "m": m]) : tr("R-W15.confirmBodyNone", ["n": n]), end: tr("R-W15.end"), cont: tr("R-W15.continue"),
            failed: tr("R-W16.saveFailed"), cancel: tr("R-W16.cancel"), retry: tr("R-W16.retry"))
        var pal = NativeEndDialogView.Palette()
        pal.scrim = color("scrim", pal.scrim)
        pal.panel = color("elev", pal.panel)
        pal.ink1 = color("ink1", pal.ink1)
        pal.ink2 = color("ink2", pal.ink2)
        pal.ink4 = color("ink4", pal.ink4)
        pal.paper = color("paper", pal.paper)
        pal.primary = colors["btn-bg"]
        pal.primaryText = colors["btn-fg"]
        let d = NativeEndDialogView(frame: view.bounds, strings: strings, palette: pal, type: textType)
        d.onContinue = { [weak self] in self?.dismissEndDialog() }
        d.onCancelFail = { [weak self] in self?.dismissEndDialog() }
        d.onEnd = { [weak self] in self?.commitEnd(sessionId: sessionId) }
        view.addSubview(d)
        endDialog = d
        d.frame = view.bounds
        d.layoutIfNeeded()
        d.animateIn(overlaySpec, reduce: reduceMotion) // T-confirm（R9-B）
        NativeA11y.screenChanged(d)
    }

    func dismissEndDialog() {
        guard let d = endDialog else { return }
        endDialog = nil
        d.animateOut(overlaySpec, reduce: reduceMotion)
    }

    /// 「结束这组」= 一次 end 提交；成功：有判断 → 换成结果页，零判断 → 回来源；失败留在框里（三段式）；stale = 会话已不是它。
    private func commitEnd(sessionId: String) {
        guard !endBusy else { return }
        endBusy = true
        bridge.call("end", ["slot": slot, "sessionId": sessionId]) { [weak self] reply in
            guard let self else { return }
            self.endBusy = false
            if reply.ok {
                let judged = reply.body["judgedCount"] as? Int ?? 0
                self.dismissEndDialog()
                if judged > 0 {
                    self.lightHaptic.impactOccurred(intensity: 0.5) // F1：结束这组确认、换成结果页
                    self.coordinator?.nativeWriteDidFinish(self, sessionId: sessionId, undo: nil)
                } else {
                    self.coordinator?.nativeWriteDidRequestBack(self) // 回到来源本身就是反馈，不弹提示（D58 / I3 P0-11）
                }
                return
            }
            if reply.errorKind == "stale" {
                self.dismissEndDialog()
                return
            }
            self.endDialog?.setFailed(true)
        }
    }

    // MARK: 回忆 ⇄ 判断（T-phase；交互规范 T0 / N3-3；时长与缓动取页面 motion：inkFlip / phaseReverse / easeOut / fade / reduce）

    /// 「写好了」→ 判断页：本人墨以顶边中点为原点纯缩放（inkFlip，ease.out）进上格；参考格在 fade 之后淡入（inkFlip 长）；两键按时刻编排出现。
    /// 减少动态效果：不缩放，整页 150ms 交叉淡化，两键直接可点（T0-3）。
    private func enterCompare() {
        phase = .compare
        srStatusLabel.text = nil // 换阶段：上一句播报作废（网页 sr-live.js 换 key 清空）
        markStateChange()
        reverseFinished = false
        if reduceMotion {
            crossfade {
                self.refFrame.alpha = 1
                self.refresh()
                self.renderHint(fadeIn: false)
                self.view.setNeedsLayout()
                self.view.layoutIfNeeded()
            }
            disarmJudgeKeys()
            NativeA11y.screenChanged(screenFocus)
            return
        }
        // 参考格先就位（不从零尺寸长出来），随两格版式一起出现
        UIView.performWithoutAnimation {
            view.setNeedsLayout()
            view.layoutIfNeeded()
            refFrame.alpha = 0
        }
        phase = .recall
        view.setNeedsLayout()
        view.layoutIfNeeded() // 书写格回到动画起点
        phase = .compare
        if redo { disarmJudgeKeys() } else { armJudgeKeys() } // 重写错字的对照页没有判断键
        refresh()
        renderHint(fadeIn: false)
        // .allowUserInteraction：动画进行中落笔照常生效（T0 规则 3；落笔时 settleAnimations 让动画一帧到终态）
        let a = UIViewPropertyAnimator(duration: dur("inkFlip"), timingParameters: NativeBezier.timing(easeOut))
        a.addAnimations {
            self.view.setNeedsLayout()
            self.view.layoutIfNeeded()
        }
        a.isUserInteractionEnabled = true
        a.startAnimation()
        UIView.animate(withDuration: dur("inkFlip"), delay: dur("fade"), options: [.curveLinear, .allowUserInteraction]) {
            self.refFrame.alpha = 1
        }
        NativeA11y.screenChanged(screenFocus) // 焦点落在页标题，不落在任何判断键上（D03）
    }

    /// 「‹ 接着写」（点按）：判断 → 回忆的 T-phase 倒放（phaseReverse，ease.out）。
    private func continueWriting() {
        guard phase == .compare, !submitting, !reversing else { return }
        startReverse(interactive: false)
    }

    /// 倒放的起点。interactive = 左缘右滑跟手（暂停在 0，由手指决定进度）；否则直接播放。
    /// 画面：上格（本人书写）以顶边中点为原点长回书写格的大小与位置，参考格与两键淡出，题面与页头不动；结束后文字区 150ms 交叉淡化换成回忆阶段的内容。
    private func startReverse(interactive: Bool) {
        guard phase == .compare, !submitting, !reversing, cardKey != nil else { return }
        if failed {
            failed = false
            refresh()
            view.layoutIfNeeded()
        }
        disarmJudgeKeys()
        if reduceMotion {
            // 减少动态效果：不缩放，整页 150ms 交叉淡化（点按立即；手势在松手时由 handleEdgeBack 调用）
            crossfade { self.completeReverse() }
            return
        }
        settleAnimations()
        let target = recallGridRect
        reversing = true
        reverseFinished = false
        ink?.drawable = true // 倒放进行中落笔：动画一帧到终态，这一笔照常生效（T0 规则 3）
        let timing: UITimingCurveProvider = interactive ? UICubicTimingParameters(animationCurve: .linear) : NativeBezier.timing(easeOut)
        let a = UIViewPropertyAnimator(duration: max(0.01, dur("phaseReverse")), timingParameters: timing)
        a.addAnimations {
            self.gridFrame.frame = target
            self.ink?.frame = target.insetBy(dx: self.frameW, dy: self.frameW)
            self.refFrame.alpha = 0
            self.setJudgeKeysAlpha(0)
            self.noInkLabel.alpha = 0
        }
        a.addCompletion { [weak self] pos in self?.reverseEnded(at: pos) }
        a.isUserInteractionEnabled = true
        reverseAnimator = a
        if interactive { a.pauseAnimation() } else { a.startAnimation() }
    }

    /// 左缘右滑的判断阶段三步（手势识别器与测试同一条路）：开始 / 跟手（progress = 位移 ÷ 屏宽，与网页同一口径）/ 松手（commit = 过阈值）。
    func edgeReverseBegan() {
        guard phase == .compare, !submitting, !reversing else { return }
        startReverse(interactive: true)
    }

    func edgeReverseChanged(progress: CGFloat) {
        reverseAnimator?.fractionComplete = min(1, max(0, progress))
    }

    func edgeReverseEnded(commit: Bool) {
        guard let a = reverseAnimator, reversing else { return }
        if commit {
            a.isReversed = false
            a.continueAnimation(withTimingParameters: NativeBezier.timing(easeOut), durationFactor: max(0.25, 1 - a.fractionComplete))
        } else {
            a.isReversed = true
            a.continueAnimation(withTimingParameters: nil, durationFactor: 0.5)
        }
    }

    private func reverseEnded(at pos: UIViewAnimatingPosition) {
        guard reverseAnimator != nil || reversing else { return }
        reverseAnimator = nil
        reversing = false
        if pos == .end {
            finishReverse()
        } else {
            // 手势没过阈值：回到判断页（上格 / 参考格 / 两键回到原样）
            refFrame.alpha = 1
            noInkLabel.alpha = 1
            setJudgeKeysAlpha(1)
            ink?.drawable = submitting
            UIView.performWithoutAnimation {
                view.setNeedsLayout()
                view.layoutIfNeeded()
            }
        }
    }

    /// 倒放走完 → 回忆阶段：文字区交叉淡化（内容变了的旧的 0–75ms 淡出、新的 75–150ms 淡入），现场写回 phase recall（P52 不阻断）。
    private func finishReverse() {
        guard !reverseFinished, phase == .compare else { return }
        reverseFinished = true
        swapText { self.completeReverse() }
    }

    /// 回忆阶段的状态切换本身（无动画）。
    private func completeReverse() {
        guard phase == .compare, let key = cardKey else { return }
        failed = false
        phase = .recall
        srStatusLabel.text = nil
        markStateChange()
        bridge.send("phase", ["slot": slot, "cardKey": key, "phase": "recall"])
        refFrame.alpha = 1
        noInkLabel.alpha = 1
        setJudgeKeysAlpha(1)
        refresh()
        renderHint(fadeIn: false)
        view.setNeedsLayout()
        view.layoutIfNeeded()
        NativeA11y.screenChanged(screenFocus)
    }

    /// 倒放进行中被打断（落笔 / 点按）：一帧到终态，状态切到回忆（T0 规则 3）。
    private func settleReverse() {
        guard let a = reverseAnimator else { return }
        a.stopAnimation(false)
        a.finishAnimation(at: .end)
        if reverseAnimator != nil { reverseEnded(at: .end) }
    }

    /// 减少动态效果的整页交叉淡化：旧页的替身 reduce（150ms）线性淡出，新状态在它下面（D58 ②）。
    private func crossfade(_ change: () -> Void) {
        settleAnimations()
        let ghost = view.snapshotView(afterScreenUpdates: false)
        ghost?.isUserInteractionEnabled = false
        ghost?.accessibilityElementsHidden = true
        change()
        guard let ghost else { return }
        ghost.frame = view.bounds
        view.addSubview(ghost)
        transitionOverlay = ghost
        UIView.animate(withDuration: dur("reduce"), delay: 0, options: [.curveLinear, .allowUserInteraction]) {
            ghost.alpha = 0
        } completion: { [weak self, weak ghost] _ in
            ghost?.removeFromSuperview()
            if self?.transitionOverlay === ghost { self?.transitionOverlay = nil }
        }
    }

    private func ghostOf(_ v: UIView, in overlay: UIView) -> UIView? {
        guard !v.isHidden, v.alpha > 0, let s = v.snapshotView(afterScreenUpdates: false) else { return nil }
        s.frame = v.convert(v.bounds, to: view)
        if v.isDescendant(of: bodyContent), bodyScroll.superview != nil {
            let clip = UIView(frame: bodyScroll.frame)
            clip.clipsToBounds = true
            s.frame = s.frame.offsetBy(dx: -clip.frame.minX, dy: -clip.frame.minY)
            clip.addSubview(s)
            overlay.addSubview(clip)
            return clip
        }
        overlay.addSubview(s)
        return s
    }

    /// 文字类区域（页头标题 / 计数 / 格下说明 / 底栏）的状态切换：内容变了的旧的 0–textOut 淡出、新的 textOut–fade 淡入，不叠字；内容没变的不动。
    /// 减少动态效果：整页交叉淡化（不走这里）。
    private func swapText(_ change: () -> Void) {
        if reduceMotion {
            crossfade(change)
            return
        }
        let fade = dur("fade") > 0 ? dur("fade") : 0.15
        let textOut = dur("textOut") > 0 ? dur("textOut") : fade / 2
        let regions: [UIView] = [centerLabel, progressLabel, noteView, footView]
        let oldKeys = regions.map(textKey)
        let overlay = UIView(frame: view.bounds)
        overlay.isUserInteractionEnabled = false
        overlay.accessibilityElementsHidden = true
        let ghosts = regions.map { ghostOf($0, in: overlay) }
        change()
        view.layoutIfNeeded()
        view.addSubview(overlay)
        transitionOverlay = overlay
        for (i, v) in regions.enumerated() {
            guard let g = ghosts[i] else { continue }
            if textKey(v) == oldKeys[i] { g.removeFromSuperview(); continue }
            v.alpha = 0
            UIView.animate(withDuration: textOut, delay: 0, options: [.curveLinear, .allowUserInteraction]) { g.alpha = 0 }
            UIView.animate(withDuration: fade - textOut, delay: textOut, options: [.curveLinear, .allowUserInteraction]) { v.alpha = 1 } completion: { [weak self, weak overlay] _ in
                overlay?.removeFromSuperview()
                if self?.transitionOverlay === overlay { self?.transitionOverlay = nil }
            }
        }
        if !regions.indices.contains(where: { ghosts[$0] != nil && textKey(regions[$0]) != oldKeys[$0] }) { overlay.removeFromSuperview(); transitionOverlay = nil }
    }

    // MARK: 换字转场（T-phase；交互规范 T0：文字类先出后进，非文字 150ms 淡出；减少动态效果 150ms 交叉淡化）

    /// 文字类区域此刻的内容（内容没变的区域不动：「‹」、不变的题面不闪）。
    private func textKey(_ v: UIView) -> String {
        switch v {
        case centerLabel: return centerLabel.text ?? ""
        case progressLabel: return progressLabel.isHidden ? "" : progressLabel.text ?? ""
        case promptView: return (promptCells.map { $0.accessibilityLabel ?? "" } + [promptHint.text ?? ""]).joined(separator: "|")
        case noteView: return [lineLabel.isHidden ? "" : lineLabel.text ?? "", changeButton.isHidden ? "" : "c", noteLabel.isHidden ? "" : noteLabel.text ?? ""].joined(separator: "|")
        case footView: return ([hintButtonView, answerButton, retraceButton, nextHelpButton, flowCancelButton, redoAnswerButton, redoAgainButton, doneButton, wrongButton, correctButton, failCancel, failRetry].map { $0.isHidden ? "" : ($0.title(for: .normal) ?? "") } + [failNote.isHidden ? "" : "n"]).joined(separator: "|")
        default: return ""
        }
    }

    private func advance(to next: [String: Any]) {
        settleAnimations()
        let reduce = reduceMotion
        let fade = dur("fade") > 0 ? dur("fade") : 0.15
        let textOut = reduce ? fade : (dur("textOut") > 0 ? dur("textOut") : fade / 2)
        let textRegions: [UIView] = [centerLabel, progressLabel, promptView, noteView, footView]
        let oldKeys = textRegions.map(textKey)
        let oldFrames = [gridFrame.frame, refFrame.frame]
        // 旧样子的替身（渲染服务器的副本，含书写面的 Metal 内容）：书写格、参考格、本人墨、提示层、各文字区
        let overlay = UIView(frame: view.bounds)
        overlay.isUserInteractionEnabled = false
        overlay.accessibilityElementsHidden = true
        var textGhosts: [Int: UIView] = [:]
        var shapeGhosts: [UIView] = []
        func ghost(_ v: UIView) -> UIView? { ghostOf(v, in: overlay) }
        for v in [gridFrame, refFrame, hintLayer, traceLayer] { if let g = ghost(v) { shapeGhosts.append(g) } }
        if let ink, !strokes.isEmpty, let g = ghost(ink) { shapeGhosts.append(g) }
        for (i, v) in textRegions.enumerated() { textGhosts[i] = ghost(v) }

        apply(snapshot: next, keepLocal: false)
        view.layoutIfNeeded()

        view.addSubview(overlay)
        transitionOverlay = overlay
        // 文字类：内容变了的旧的先出（0–textOut），新的后进（textOut–fade）；减少动态效果：同时 150ms 交叉淡化
        for (i, v) in textRegions.enumerated() {
            let changed = textKey(v) != oldKeys[i]
            guard let g = textGhosts[i] else { continue }
            if !changed { g.removeFromSuperview(); continue }
            v.alpha = 0
            UIView.animate(withDuration: textOut, delay: 0, options: [.curveLinear, .allowUserInteraction]) { g.alpha = 0 }
            UIView.animate(withDuration: reduce ? fade : fade - textOut, delay: reduce ? 0 : textOut, options: [.curveLinear, .allowUserInteraction]) { v.alpha = 1 }
        }
        // 非文字：旧的 150ms 淡出；书写格框位置 / 大小变了的（判断两格 → 回忆一格）新的同时淡入，没变的不动
        if gridFrame.frame != oldFrames[0] {
            gridFrame.alpha = 0
            UIView.animate(withDuration: fade, delay: 0, options: [.curveLinear, .allowUserInteraction]) { self.gridFrame.alpha = 1 }
        } else if let first = shapeGhosts.first, first.frame == gridFrame.frame {
            first.removeFromSuperview() // 同一个格框：只留真的那一个（不做两层半透明）
        }
        UIView.animate(withDuration: fade, delay: 0, options: [.curveLinear, .allowUserInteraction]) {
            shapeGhosts.forEach { $0.alpha = 0 }
        } completion: { [weak self, weak overlay] _ in
            overlay?.removeFromSuperview()
            if self?.transitionOverlay === overlay { self?.transitionOverlay = nil }
        }
        NativeA11y.screenChanged(screenFocus)
    }

    // MARK: 重写错字（B2.9a；只练习：本地换阶段，换字经 redoNext 取页面给的下一个字快照，离开发 redoExit）

    /// 这是本组最后一个要重写的字（对照页主按钮是「完成」）。
    private var redoLast: Bool { (snapshot["last"] as? Bool) ?? (cursorNumber >= totalCount) }

    /// 写的时候「看答案」：直接去对照（网页 toCheck，没写也能看；没写时上格「这次没写」）。
    @objc private func tapRedoAnswer() {
        guard redo, phase == .recall else { return }
        enterCompare()
    }

    /// 对照时「再写一次」：回到这个字的空书写格（网页 again：笔画清空、撤销不能找回）。换阶段走 T-phase 换字转场。
    @objc private func tapRedoAgain() {
        guard redo, phase == .compare else { return }
        var next = snapshot
        next["strokes"] = [Any]()
        next["phase"] = "recall"
        armedCard = cardKey // 同一个字：不重新设落笔门限（网页 armRef 按字）
        advance(to: next)
    }

    /// 对照时「下一个 / 完成」：redoNext 给下一个字的快照；最后一个 → 滑出回到结果页（离开时 redoExit）。
    @objc private func tapRedoNext() {
        guard redo, phase == .compare, !redoBusy else { return }
        redoBusy = true
        refresh()
        bridge.call("redoNext", ["chars": redoChars, "index": snapshot["cursor"] as? Int ?? 0]) { [weak self] reply in
            guard let self else { return }
            self.redoBusy = false
            guard reply.ok else { self.refresh(); return }
            if (reply.body["done"] as? Bool) == true {
                self.coordinator?.nativeWriteDidRequestBack(self)
                return
            }
            if let snap = reply.snapshot { self.advance(to: snap) } else { self.refresh() }
        }
    }

    var redoIndexForTesting: Int { snapshot["cursor"] as? Int ?? -1 }
    var redoTotalForTesting: Int { totalCount }

    // MARK: 判断两键的出现与就绪（时刻编排 M1：0–judgeAppear 不显示，之后 60% 且不可点，judgeReady 变实可点；取代看不见的锁）

    private func armJudgeKeys() {
        judgeArmToken += 1
        let token = judgeArmToken
        // 减少动态效果 / 读屏：直接可点、不淡入（T0-3：不留看不见的锁）
        guard judgeReady > 0, !UIAccessibility.isReduceMotionEnabled, !UIAccessibility.isVoiceOverRunning else {
            disarmJudgeKeys()
            return
        }
        judgeKeysReady = false
        setJudgeKeysAlpha(0)
        DispatchQueue.main.asyncAfter(deadline: .now() + judgeAppear) { [weak self] in
            guard let self, self.judgeArmToken == token else { return }
            self.setJudgeKeysAlpha(0.6)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + judgeReady) { [weak self] in
            guard let self, self.judgeArmToken == token else { return }
            self.judgeKeysReady = true
            self.setJudgeKeysAlpha(1)
            self.refresh()
        }
    }

    private func disarmJudgeKeys() {
        judgeArmToken += 1
        judgeKeysReady = true
        setJudgeKeysAlpha(1)
    }

    private func setJudgeKeysAlpha(_ a: CGFloat) {
        wrongButton.alpha = a
        correctButton.alpha = a
    }

    /// 落笔 / 点按时正在进行的版式动画与换字转场一帧到终态（T0 规则 3：动画不挡输入，这次输入照常生效）。
    private func settleAnimations() {
        transitions.finishNow() // 进场转场还在跑：一帧到终态（B2.8，T0 规则 3）
        settleReverse()
        view.layer.removeAllAnimations()
        for v in view.subviews {
            v.layer.removeAllAnimations()
            if v !== transitionOverlay, v.alpha < 1, !(v === refFrame && phase != .compare) { v.alpha = 1 }
        }
        refFrame.alpha = 1
        transitionOverlay?.removeFromSuperview()
        transitionOverlay = nil
        hintLayer.settle()
        traceLayer.skipPlay() // 落笔 / 点一下：笔顺快放一帧到终态（D68 ②）
    }

    @objc private func tapWrong() { judge("wrong") }
    @objc private func tapCorrect() { judge("correct") }
    /// 保存失败三段式的「再试一次」：重发上一次的判断（commit 是原子事务，失败不留半条记录，重试不重复计数，D07）。
    @objc private func tapRetry() { judge(lastJudgment) }
    @objc private func tapFailCancel() {
        // 「先不保存」：回到判断前（两键），笔迹仍在（R-W16）；失败态到判断态是新状态（0.4s 不响应，走查 W08）
        failed = false
        markStateChange()
        refresh()
        view.setNeedsLayout()
    }

    // MARK: 结果行「修改 ›」与改判弹层（D19）

    /// 结果行字阶（网页 .sz-line：13 / 20，正文 ink3、「·」ink4、「修改 ›」ink1；R9-B）与判断两键字阶（17 / 500）。
    private func styleResultLine() {
        lineLabel.adjustsFontForContentSizeCategory = false
        let lineFont = axFont("note", sub: "r2", else: textType.font("fs13")) // AX 档：格下一律 17 / 22pt（网页 .sz-write__below *）
        NativeType.set(lineDot, "\u{00B7}", font: lineFont, color: color("ink4", .tertiaryLabel), align: .center)
        changeButton.titleLabel?.adjustsFontForContentSizeCategory = false
        changeButton.titleLabel?.font = lineFont
        if !lineLabel.isHidden, let t = lineLabel.text {
            NativeType.set(lineLabel, t, font: lineFont, color: color("ink3", .secondaryLabel))
        }
        for b in [wrongButton, correctButton] {
            b.titleLabel?.adjustsFontForContentSizeCategory = false
            b.titleLabel?.font = axFont("judge", .medium, else: textType.font("fs17", weight: .medium))
            b.titleLabel?.numberOfLines = axOn ? 0 : 1
            b.titleLabel?.textAlignment = .center
        }
        trackTitles()
        view.setNeedsLayout()
    }

    @objc private func tapChange() {
        guard phase == .recall, !submitting, let line = snapshot["line"] as? [String: Any], (line["canChange"] as? Bool) == true,
              let rid = line["recordId"] as? String else { return }
        bridge.call("correct", ["slot": slot, "recordId": rid, "action": "state"]) { [weak self] reply in
            guard let self else { return }
            guard reply.ok, let model = NativeChangeSheetViewController.Model(reply.body) else {
                // 结果行已不是这条记录（stale）：按回包快照刷新，「修改 ›」随之收起
                if let snap = reply.snapshot { self.apply(snapshot: snap, keepLocal: true) }
                return
            }
            self.presentChangeSheet(model)
        }
    }

    func presentChangeSheet(_ model: NativeChangeSheetViewController.Model) {
        guard presentedViewController == nil else { return }
        let style = NativeJudgeStyle(tr: { [weak self] k, v in self?.tr(k, v) ?? "" }, color: { [weak self] n, f in self?.color(n, f) ?? f }, inkTint: inkTint,
                                     type: textType, overlay: overlaySpec)
        let vc = NativeChangeSheetViewController(slot: slot, model: model, bridge: bridge, style: style) { [weak self] snap in
            // 改判成功：结果行换成「已改为……」，当前字的笔迹 / 提示 / 阶段原样（只改这一次，D19）
            if let snap, (snap["cardKey"] as? String) == self?.cardKey { self?.apply(snapshot: snap, keepLocal: true) }
        }
        vc.onViewChar = { [weak self] char in self?.openCharDetail(char) }
        present(vc, animated: true)
    }

    /// 改判弹层「看这个字 ›」（D66 ⑮，R9-B NP-04）：写字条目留在网页栈里，字详情推入在它上面；原生页淡出让开（不发 exit back），
    /// 详情返回时宿主重新请原生盖上（open via 'return'，笔画 / 结果行从快照恢复）。
    func openCharDetail(_ char: String) {
        guard !exitHandled else { return }
        if let coordinator {
            coordinator.nativeWriteOpenDetail(self, char: char)
            return
        }
        bridge.call("exit", ["slot": slot, "to": "detail", "char": char]) { [weak self] reply in
            guard let self, reply.ok else { return }
            self.exitHandled = true
            self.saveMetrics()
            self.endUndo()
            self.transitions.fadeNext = true
            self.dismiss(animated: true)
        }
    }

    /// 测试：没有本人笔画的判断页（正常流程到不了，R-W17）。
    func forceCompareWithoutInkForTesting() {
        strokes = []
        ink?.syncPageStrokes([])
        phase = .compare
        refresh()
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    var gridFrameLineWidthForTesting: CGFloat { gridFrame.layer.borderWidth }
    var noInkTextForTesting: String? { noInkLabel.text }
    var failNoteTextForTesting: String? { failNote.isHidden ? nil : failNote.text }
    var failNoteFrameForTesting: CGRect { failNote.convert(failNote.bounds, to: view) }
    var lineTextForTesting: String? { lineLabel.isHidden ? nil : lineLabel.text }
    /// 题面里能被读到 / 看到的全部文字（题面不含答案字，D16）。
    var promptTextsForTesting: [String] {
        promptCells.flatMap { c -> [String] in
            [c.accessibilityLabel ?? ""] + c.subviews.flatMap { sub -> [String] in
                if let l = sub as? UILabel { return [l.text ?? ""] }
                if let g = sub as? NativeGlyphView { return [g.char] }
                return []
            }
        }
    }

    var changeSheetForTesting: NativeChangeSheetViewController? { presentedViewController as? NativeChangeSheetViewController }
    var changeShownForTesting: Bool { !changeButton.isHidden }
    var failShownForTesting: Bool { phase == .compare && failed }
    var reversingForTesting: Bool { reversing }
    var settlePlayedForTesting = 0
    var noInkShownForTesting: Bool { !noInkLabel.isHidden }
    var judgeKeysForTesting: (wrong: UIButton, correct: UIButton) { (wrongButton, correctButton) }
    var failRetryForTesting: UIButton { failRetry }
    var failCancelForTesting: UIButton { failCancel }
    var progressTextForTesting: String? { progressLabel.isHidden ? nil : progressLabel.text }
    var titleTextForTesting: String? { centerLabel.text }
    var judgeKeysReadyForTesting: Bool { judgeKeysReady }
    var gridFramesForTesting: (mine: CGRect, ref: CGRect) { (gridFrame.frame, refFrame.frame) }

    private var lastJudgment = "correct"

    private func judge(_ judgment: String) {
        guard phase == .compare, !submitting, !reversing, let key = cardKey, !strokes.isEmpty else { return }
        submitting = true
        lastJudgment = judgment
        // 回包之前落下的笔先持住（不画、不交出），推进到下一个字后接着画（P227 同语义：这一笔不丢）
        ink?.acceptFrom = .infinity
        refresh()
        judgeHaptic.prepare()
        // D66 ②：提示次数取本地与已存的较大者（提示写入失败时本地多于已存，P52）
        let hints = max(snapshot["hints"] as? Int ?? 0, hint?.used ?? 0)
        bridge.call("judge", ["slot": slot, "cardKey": key, "judgment": judgment, "strokes": NativeInkWire.wire(strokes), "hints": hints]) { [weak self] reply in
            guard let self else { return }
            self.submitting = false
            // 结果未知后重发（或连点）：页面回 stale 且快照已经不是这个字 → 上一次其实已提交，按成功对账（不多记，D07）
            let advanced = !reply.ok && reply.errorKind == "stale" && reply.snapshot.map { ($0["cardKey"] as? String) != key } == true
            guard reply.ok || advanced else {
                // D07：没保存上——留在判断页，笔迹还在；两键换成「先不保存 / 再试一次」。这期间持住的笔不属于任何一个字，丢掉
                self.ink?.dropHeld()
                self.ink?.acceptFrom = 0
                self.failed = true
                self.refresh()
                self.view.setNeedsLayout()
                NativeA11y.announce(self.failNote.text)
                return
            }
            self.failed = false
            let finished = reply.body["finished"] as? [String: Any]
            if let finished, let sid = finished["sessionId"] as? String {
                self.judgeHaptic.impactOccurred(intensity: 0.7)
                self.coordinator?.nativeWriteDidFinish(self, sessionId: sid)
                return
            }
            if advanced, let snap = reply.snapshot, (snap["active"] as? Bool) != true || (snap["done"] as? Bool) == true {
                // 已提交的是最后一个字：这组已结束，交给结果页
                self.judgeHaptic.impactOccurred(intensity: 0.7)
                self.coordinator?.nativeWriteDidFinish(self, sessionId: self.snapshot["sessionId"] as? String ?? "")
                return
            }
            if let next = reply.snapshot {
                // M23 判断落定：commit 成功后本人笔迹离纸、收进页头计数，触觉与第一帧同帧（F1：成功后才发，失败三段式不发）
                let plan = self.settlePlan()
                self.ink?.isHidden = plan != nil // 墨在第 0 帧离开纸面：这一层由落定叠层接着画
                self.advance(to: next)
                self.ink?.isHidden = false
                if let plan, !self.playSettle(plan) { self.judgeHaptic.impactOccurred(intensity: 0.7) }
                if plan == nil { self.judgeHaptic.impactOccurred(intensity: 0.7) }
                self.scheduleAutoStep()
            }
        }
    }

    // MARK: 判断落定（M23；时刻与曲线来自页面 motion.settle，NativeSettle 只负责画）

    private struct SettlePlan {
        let from: CGRect
        let to: CGRect?
        let strokes: [[InkRawPoint]]
    }

    /// 落定前的记录：上格墨的位置、页头计数的位置、本人笔画。没有笔画 / 页面没给时刻（没有 settle 参数）/ 没有书写面 → nil（不做落定动画）。
    private func settlePlan() -> SettlePlan? {
        guard settleSpec != nil, let ink, !strokes.isEmpty, ink.window != nil else { return nil }
        return SettlePlan(from: ink.convert(ink.bounds, to: view), to: progressLabel.isHidden ? nil : progressLabel.frame, strokes: strokes)
    }

    private func playSettle(_ plan: SettlePlan) -> Bool {
        guard let spec = settleSpec, let ink else { return false }
        let played = NativeSettle.play(in: view, from: plan.from, to: plan.to, strokes: plan.strokes, params: ink.params, color: ink.inkColor, spec: spec,
                                       reduceMotion: reduceMotion) { [weak self] in
            self?.judgeHaptic.impactOccurred(intensity: 0.7)
        }
        if played != nil { settlePlayedForTesting += 1 }
        return played != nil
    }

    // MARK: 量测用自动驾驶（DEBUG：SHIZI_NW_AUTO=1；每个字写一笔合成笔画 →「写好了」→ 判断，写错 / 写对交替；Release 恒关）

    static var autoDrive: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["SHIZI_NW_AUTO"] == "1"
        #else
        return false
        #endif
    }
    private var autoCount = 0

    func scheduleAutoStep() {
        guard Self.autoDrive, !redo else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.autoStep() }
    }

    private func autoStep() {
        guard !exitHandled, !submitting, cardKey != nil else { return }
        if phase == .recall {
            let t0 = CACurrentMediaTime() * 1000
            let stroke = (0..<12).map { i in InkRawPoint(x: 60 + Double(i) * 20, y: 170 + Double(i % 3), t: t0 + Double(i) * 16) }
            nativeInkDidEndStroke(ink, raw: stroke)
            tapDone()
            scheduleAutoStep()
        } else {
            autoCount += 1
            judge(autoCount % 2 == 0 ? "wrong" : "correct")
        }
    }

    @objc private func handleEdgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        #if DEBUG
        if g.state != .changed { NSLog("[shizi] native write edge back state=%d x=%.1f", g.state.rawValue, Double(g.location(in: view).x)) }
        #endif
        guard endDialog == nil else { return }
        let x = max(0, g.translation(in: view).x), v = g.velocity(in: view).x
        let width = max(1, view.bounds.width)
        if phase == .compare && !redo {
            // 判断阶段：左缘右滑 = 「‹ 接着写」，跟手画面是 T-phase 倒放（上格长回书写格、参考格与两键淡出）；过阈值才完成，否则回弹（N3-3）。
            // 减少动态效果：不跟手，松手按同一阈值判定，完成后 150ms 淡化。
            let commit = BackGestureThreshold.commits(distance: x, velocity: v, width: width)
            if reduceMotion {
                if g.state == .ended, commit { continueWriting() }
                return
            }
            switch g.state {
            case .began: edgeReverseBegan()
            case .changed: edgeReverseChanged(progress: x / width)
            case .ended: edgeReverseEnded(commit: commit)
            case .cancelled, .failed: edgeReverseEnded(commit: false)
            default: break
            }
            return
        }
        switch g.state {
        case .began:
            guard !submitting else { return }
            settleAnimations()
            ink?.cancelStroke(reason: "edge-back", notify: false) // 落笔中被手势打断：这一笔丢弃（与网页 pointercancel 同语义）
            commitBeforeLeaving() // R12：已抬笔、持住的笔先交出（左缘松手回弹时也无害：到点本来就交）
            transitions.drag(g, page: self)
        default:
            // B2.8：跟手画的是这一页进来时的那种转场倒放（纸缩回 / 右滑出 / 安静淡出），阈值 BackGestureThreshold；完成后收起，viewDidDisappear 发 exit back
            transitions.drag(g, page: self)
        }
    }
}

/// 写字页根视图（D72 ③ 格外起笔、滑进书写格）：页面空白处起手的触摸（UIKit 命中根视图，或命中不接触摸的说明 / 题面 / 底栏底板、
/// 由响应链转上来）交给书写面「待进入」，滑进可写的书写格时在进入点开始这一笔（NativeInkView approach*）。
/// 不抢按钮：起手命中按钮 / 可点控件（或它们里面）的触摸 UIKit 交给控件，到不了这里；保险起见这里再按命中视图链排除 UIControl。
/// 不抢返回：左缘返回起手区（edgeBackZone）里起手的不跟踪，仍归左缘返回（R10-A 规则不变）；返回识别成功时 UIKit 发 touchesCancelled，正在写的这笔丢弃。
/// 进入时要格就在手指下（hitTest 落到书写面）：判断页等不可写阶段书写面不接触摸、弹层盖住时命中的是弹层，都不开始。
final class NativeWritePageView: UIView {
    weak var ink: NativeInkView?
    weak var approachRoot: UIView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true // 掌托与 Pencil 可能同时在格外落下：每个触点都要收到
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 这个触摸能不能当「格外起笔」跟踪：不在左缘返回起手区，不在书写面里（格内起手归书写面自己），命中视图链上没有可点控件。
    static func approachStarts(at p: CGPoint, hitView: UIView?, root: UIView, inkFrame: CGRect) -> Bool {
        guard p.x >= NativeWriteViewController.edgeBackZone, !inkFrame.contains(p) else { return false }
        var v = hitView
        while let cur = v, cur !== root {
            if cur is UIControl { return false }
            v = cur.superview
        }
        return true
    }

    private func enters(_ pInInk: CGPoint) -> Bool {
        guard let ink else { return false }
        let root = approachRoot ?? self
        return root.hitTest(ink.convert(pInInk, to: root), with: nil) === ink
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let ink, ink.drawable, !ink.isHidden else { return }
        let ok = touches.filter { Self.approachStarts(at: $0.location(in: self), hitView: $0.view, root: self, inkFrame: ink.convert(ink.bounds, to: self)) }
        if !ok.isEmpty { ink.approachBegan(ok) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        ink?.approachMoved(touches, with: event, enters: enters)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        ink?.approachEnded(touches, with: event, enters: enters)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        ink?.approachCancelled(touches)
    }
}

extension NativeWriteViewController: UIGestureRecognizerDelegate {
    /// 左缘返回起手区宽（pt）：UIKit 系统左缘识别器的起手区（_edgeRegionSize，iOS 26.5 实读 40.2pt，R10-A）。
    /// 书写格以外、这一条里起手的触摸归左缘返回，不当格外起笔（D72 ③）。
    static let edgeBackZone: CGFloat = 40.2

    /// 左缘返回只收书写格以外起手的触摸：能落笔时（书写面可写、没隐藏）格里按下的触摸归书写（R10-A）。
    static func edgeBackReceives(touchAt p: CGPoint, inkFrame: CGRect, inkDrawable: Bool) -> Bool {
        !(inkDrawable && inkFrame.contains(p))
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer === edgeBack, let ink else { return true }
        let p = touch.location(in: view)
        let ok = Self.edgeBackReceives(touchAt: p, inkFrame: ink.convert(ink.bounds, to: view), inkDrawable: ink.drawable && !ink.isHidden && ink.window != nil)
        #if DEBUG
        if !ok, p.x < 48 { ink.logStroke("edge-back yields to ink") } // 只记系统起手区（40.2pt）以内的
        #endif
        return ok
    }
}

extension NativeWriteViewController: NativeInkViewDelegate {
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval) {
        settleAnimations()
        guard phase != .compare else { return }
        endUndo() // 下一字一开始操作（落笔）：跳过的撤销机会结束（G3）
        // 落笔：上一字的结果行收起（D19，本字内不再出现）
        if !penDown {
            penDown = true
            refresh()
            self.view.setNeedsLayout()
        }
    }

    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint]) {
        guard phase != .compare else { return }
        let prev = strokes.count
        defer { announceStrokes(from: prev) }
        strokes.append(raw)
        cleared = nil
        penDown = true
        view.syncPageStrokes(strokes)
        absorbHint(index: strokes.count - 1, raw: raw)
        refresh()
        self.view.setNeedsLayout()
        persistStrokes()
    }

    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String) {}

    /// Apple Pencil 双击（按系统偏好映射，NativeInkPencilAction）：与格下「撤销 / 清空」同一个动作，只在回忆阶段。
    func nativeInk(_ view: NativeInkView, didRequest action: NativeInkPencilAction) {
        guard phase != .compare, !submitting else { return }
        switch action {
        case .undo: tapUndo()
        case .clear: tapClear()
        }
    }
}

/// A touch that begins on the writing surface belongs to ink for its entire
/// lifetime, including fast vertical strokes and strokes that leave the grid.
/// The page edge recognizer remains independent and has priority outside ink.
final class NativeWriteScrollView: UIScrollView {
    weak var ink: NativeInkView?
    var onLayout: (() -> Void)?
    var onBegin: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === panGestureRecognizer {
            let now = gestureRecognizer.location(in: self)
            let delta = panGestureRecognizer.translation(in: self)
            let p = CGPoint(x: now.x - delta.x, y: now.y - delta.y)
            if p.x < NativeWriteViewController.edgeBackZone { return false }
            if let ink, ink.drawable, !ink.isHidden,
               ink.convert(ink.bounds, to: self).contains(p) { return false }
        }
        let allowed = super.gestureRecognizerShouldBegin(gestureRecognizer)
        if allowed, gestureRecognizer === panGestureRecognizer { onBegin?() }
        return allowed
    }
}
