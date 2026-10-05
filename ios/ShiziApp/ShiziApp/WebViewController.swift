import AVFoundation
import Photos
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

// 拾字 iOS 壳：单个 WKWebView 加载随包的 Web 资源（shizi-resource://app/…）。
// 原生是无状态执行器（01-架构设计 §8.1 / §8.2）：
//   JS→iOS  window.webkit.messageHandlers.shiziNative.postMessage({type, …})：
//           pageReady、haptic、sound、shareBackup、pickBackup、sharePracticeCard、savePracticeCard、syncReminder、
//           requestReminderPermission、openAppSettings、queryReminderStatus、backGestureEnabled；soundscape 是 no-op（P07）。
//   iOS→JS  bridge.js 在模块顶层同步定义的全局：shiziOpenReminderTarget、shiziBackupPicked、shiziBackupRejected、
//           markBackupExported、shiziCardSaved、shiziReminderStatus、shiziShareFailed（P96 过渡，M6-6）、
//           shiziAccessibilityStatus（P116：读屏 / 切换控制状态，pageReady 与状态变化时）、
//           shiziContentSize（P130 / D29：系统字号档位与正文倍率，pageReady 与系统字号变化时；P1-E6b：文档开始时另有
//           WKUserScript 注入 window.__shiziInitialContentSize，冷启动首帧即目标字号）；
//           事件 shizi-native-back / shizi-native-back-progress / shizi-native-escape（读屏两指 Z 形，A2-05：关最上层弹层）。
// 面向用户的文字一律在 Web 侧（src/config/copy/）：原生不弹 alert、不 reload（导入桥只交付文本或拒绝原因）。

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

final class WebViewController: UIViewController {
    private static let temporarySharePrefix = "shizi-share-"
    /// 备份导入的原生预检上限（01 §8.1；与 src/core/backup.js BACKUP_MAX_BYTES 相同）。
    static let backupMaxBytes = 10 * 1024 * 1024

    private let schemeHandler: LocalWebSchemeHandler
    var webView: WKWebView!
    // 用户脚本（文档开始时注入的系统字号；DEBUG 冒烟标记）挂在这个控制器上；每次加载前重建（见「系统字号」一节）。
    private var scriptController: WKUserContentController!
    var practiceBackGesture: UIScreenEdgePanGestureRecognizer!
    // 01 §7：页面通过 postMessage({type:'backGestureEnabled', value}) 告知能否开始边缘返回
    // （写字页整页期间、阻断页为 false）。每次新文档提交时复位为 true，由新页面重新告知。
    var backGestureEnabled = true
    private var reminderSyncGeneration = 0
    // 01 §8.2：pageReady 由页面在 bridge.markReady 之后 postMessage 触发（不是 didFinish）；新文档提交时复位。
    private(set) var pageReady = false
    private(set) var pendingReminderCardKey: String?
    private var reminderDispatchInFlight = false
    #if DEBUG
    /// 冒烟专用：下一次 pickBackup 不弹系统选择器，改用这里指定的测试文件（NativeSmoke.swift）。
    var smokeNextPick: String?
    /// 冒烟专用：原生侧事件（导出、选文件、提醒同步、深链派发、边缘返回），同步给页面的 window.__shiziSmokeEvents。
    var smokeEvents: [[String: Any]] = []
    /// 原生书写面 spike（P1-S2，NativeInkSpike.swift）：启动参数 -shizi-native-ink 时才创建，默认 nil。
    var nativeInkSpike: NativeInkSpike?
    #endif
    private lazy var stampHaptic = UIImpactFeedbackGenerator(style: .medium)
    private lazy var undoHaptic = UIImpactFeedbackGenerator(style: .light)
    private lazy var actionHaptic = UIImpactFeedbackGenerator(style: .light)
    private lazy var selectionHaptic = UISelectionFeedbackGenerator()
    private lazy var milestoneHaptic = UINotificationFeedbackGenerator()
    /// 判断声三个变体与落款声（assets/sound/*.caf，S1 / D50 ⑦）：文件名 → 预载好的播放器；`preloadSounds()` 在 viewDidLoad 填满。
    private var soundPlayers: [String: AVAudioPlayer] = [:]

    init() {
        guard let webRoot = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            fatalError("Missing bundled Web assets. Build the app through Xcode so the sync-web-assets phase runs.")
        }

        self.schemeHandler = LocalWebSchemeHandler(rootDirectory: webRoot)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "shiziNative")
    }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: ShiziWebResource.scheme)

        let userContentController = WKUserContentController()
        userContentController.add(WeakScriptMessageHandler(delegate: self), name: "shiziNative")
        installUserScripts(on: userContentController)
        scriptController = userContentController
        configuration.userContentController = userContentController

        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        // 纸色取 Assets 的 Paper 颜色集（浅 #F4F0E7 / 深 #221E1A，由 scripts/generate-paper-colorset.mjs 从 tokens.css 的 --p 生成），
        // 与启动屏 UILaunchScreen.UIColorName 同源，冷启动到页面首帧没有底色跳变（A7 / G19）。
        let paper = UIColor(named: "Paper") ?? .systemBackground
        webView.backgroundColor = paper
        webView.scrollView.backgroundColor = paper
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // 页面不能被双指缩放（缩放后界面没有恢复入口，Q2-14，复测 simC D11）。这只管页面的捏合缩放；系统「辅助功能 › 缩放」是系统层的屏幕放大镜、
        // 「更大字体」走 shiziContentSize，都不受影响。
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false

        let practiceBackGesture = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handlePracticeBackGesture(_:)))
        practiceBackGesture.edges = .left
        practiceBackGesture.maximumNumberOfTouches = 1
        practiceBackGesture.delegate = self
        webView.addGestureRecognizer(practiceBackGesture)

        self.webView = webView
        self.practiceBackGesture = practiceBackGesture
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        cleanupTemporaryShareFiles()
        preloadSounds()
        #if DEBUG
        applySmokeLaunchArguments()
        startNativeInkSpikeIfNeeded()
        #endif
        observeAccessibilityStatus()
        observeContentSize()
        loadApp()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .default
    }

    // MARK: - 左缘返回（01 §7：Swift 是手势唯一所有者）

    @objc private func handlePracticeBackGesture(_ gesture: UIScreenEdgePanGestureRecognizer) {
        let phase: String
        switch gesture.state {
        case .began: phase = "began"
        case .changed: phase = "changed"
        case .ended: phase = "ended"
        case .cancelled, .failed: phase = "cancelled"
        default: return
        }
        let distance = max(0, gesture.translation(in: webView).x)
        let velocity = gesture.velocity(in: webView).x
        dispatchBackGesture(phase: phase, distance: distance, velocity: velocity)
    }

    /// 每个阶段派发 shizi-native-back-progress {phase, translationX, progress, velocityX}；
    /// ended 且满足 `velocity > 500 || (distance > 50% 宽 && velocity > -200)`（P103 / D36，与 src/ui/router.js
    /// backGestureCommits 一致）时再派发 shizi-native-back。返回是否派发了 shizi-native-back。
    @discardableResult
    func dispatchBackGesture(phase: String, distance: CGFloat, velocity: CGFloat) -> Bool {
        let width = max(webView.bounds.width, 1)
        let progress = min(1, distance / width)
        let detail = String(
            format: "{phase:'%@',translationX:%.2f,progress:%.4f,velocityX:%.2f}",
            phase, Double(distance), Double(progress), Double(velocity)
        )
        #if DEBUG
        if phase != "changed" {
            NSLog("[shizi] native back gesture %@ %@", phase, detail)
        }
        #endif
        var script = "window.dispatchEvent(new CustomEvent('shizi-native-back-progress',{detail:\(detail)}));"
        let fired = phase == "ended" && (velocity > 500 || (distance > width * 0.5 && velocity > -200))
        if fired {
            script += " window.dispatchEvent(new CustomEvent('shizi-native-back',{detail:\(detail)}));"
        }
        webView.evaluateJavaScript(script + " void 0;")
        return fired
    }

    // MARK: - 读屏退出手势（A2-05）

    /// VoiceOver 两指 Z 形：页面里关最上层弹层（没有弹层时页面什么都不做）。原生不判断页面状态，只派发 shizi-native-escape。
    override func accessibilityPerformEscape() -> Bool {
        dispatchAccessibilityEscape()
        return true
    }

    func dispatchAccessibilityEscape() {
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('shizi-native-escape')); void 0;")
    }

    // MARK: - 加载与就绪

    private func loadApp() {
        pageReady = false
        reminderDispatchInFlight = false
        backGestureEnabled = true
        // 首次加载、WebContent 进程被回收后的重载、阻断页「再试一次」都经这里：脚本按此刻的系统字号重建，不会重放旧档位。
        refreshUserScripts()
        var components = URLComponents()
        components.scheme = ShiziWebResource.scheme
        components.host = ShiziWebResource.host
        components.path = "/index.html"

        var query: [URLQueryItem] = []
        if Self.devModeEnabled {
            query.append(URLQueryItem(name: "dev", value: "1"))
        }
        #if DEBUG
        // 01 §11：-shizi-smoke / -shizi-dev 下追加 test=1，配合 documentStart 注入的 __shiziNativeDev 挂测试钩子（Release 不编译）。
        if Self.nativeTestHostEnabled {
            query.append(URLQueryItem(name: "test", value: "1"))
        }
        #endif
        components.queryItems = query.isEmpty ? nil : query

        guard let url = components.url else {
            assertionFailure("Unable to build local app URL")
            return
        }

        webView.load(URLRequest(url: url))
    }

    private func handlePageReady() {
        pageReady = true
        #if DEBUG
        recordSmokeEvent("pageReady", ["href": webView.url?.absoluteString ?? ""])
        #endif
        dispatchPendingReminderTargetIfReady()
        sendAccessibilityStatus()
        sendContentSize(currentContentSizeCategory)
        #if DEBUG
        runNativeSmokeIfNeeded()
        #endif
    }

    // MARK: - 读屏状态（阶段 0 B2 / D36 / P116）

    // 页面据此决定跳过撤销条要不要自动收起：VoiceOver 或切换控制运行时不自动收起（src/platform/accessibility.js）。
    // pageReady 时发一次当前状态，之后系统状态变化时再发；只传布尔值，没有面向用户的文字。
    private func observeAccessibilityStatus() {
        let names: [Notification.Name] = [
            UIAccessibility.voiceOverStatusDidChangeNotification,
            UIAccessibility.switchControlStatusDidChangeNotification,
        ]
        for name in names {
            NotificationCenter.default.addObserver(self, selector: #selector(accessibilityStatusDidChange), name: name, object: nil)
        }
    }

    @objc private func accessibilityStatusDidChange() {
        guard pageReady else { return }
        sendAccessibilityStatus()
    }

    func sendAccessibilityStatus() {
        let voiceOver = UIAccessibility.isVoiceOverRunning ? "true" : "false"
        let switchControl = UIAccessibility.isSwitchControlRunning ? "true" : "false"
        webView.evaluateJavaScript(
            "if (typeof shiziAccessibilityStatus === 'function') shiziAccessibilityStatus({voiceOver:\(voiceOver),switchControl:\(switchControl)}); void 0;"
        )
    }

    // MARK: - 系统字号（阶段 1 P1-E6 / D29 / P130）

    // 页面字号跟随系统 Dynamic Type（含控制中心「单个 App 文字大小」，它改的也是本 App 的 preferredContentSizeCategory）：
    // pageReady 时发一次当前档位，系统字号变化时再发；页面（src/platform/text-size.js）按 policy.contentSizeScale 换成 --k。
    // 不会双重放大：WKWebView 只对 CSS 里写了 `font: -apple-system-body` 这类系统文字样式的元素按 Dynamic Type 缩放，
    // 页面字号一律是 px × --k（test/platform/text-size.test.mjs 扫源码保证不出现 -apple-system-<样式>）；pageZoom 保持 1、
    // 也不改 WKPreferences.minimumFontSize，所以放大只经这一条桥。
    private func observeContentSize() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(contentSizeDidChange(_:)), name: UIContentSizeCategory.didChangeNotification, object: nil
        )
    }

    @objc private func contentSizeDidChange(_ notification: Notification) {
        // 通知到达时 traitCollection 可能还没更新，优先用通知里的新值。
        let category = (notification.userInfo?[UIContentSizeCategory.newValueUserInfoKey] as? UIContentSizeCategory) ?? currentContentSizeCategory
        // 页面还没就绪（正在加载 / 重载）时也要更新注入脚本：这次加载的文档开始脚本已按旧档位跑过的话，pageReady 会再发一次当前档位。
        refreshUserScripts(category: category)
        guard pageReady else { return }
        sendContentSize(category)
    }

    /// 此刻的系统字号档位。视图还没进窗口时（冷启动 loadView / viewDidLoad、进程回收后的重载）traitCollection 不可靠，改读 UIApplication
    /// （它也反映控制中心「单个 App 文字大小」）。
    var currentContentSizeCategory: UIContentSizeCategory {
        let category = isViewLoaded && view.window != nil
            ? view.traitCollection.preferredContentSizeCategory
            : UIApplication.shared.preferredContentSizeCategory
        return category == .unspecified ? .large : category
    }

    /// 文档开始时注入的脚本：只写一个 window 变量（载荷与 shiziContentSize 同形），页面 src/platform/text-size.js 在模块求值时读到就立即写 <html>。
    /// 档位 → --k 的换算只在页面的 policy 里（原生不抄表）；脚本不碰 DOM，所以也不涉及页面 CSP 的 style-src。
    static func initialContentSizeScript(_ category: UIContentSizeCategory) -> String? {
        guard let literal = jsonLiteral(contentSizeName(category)) else { return nil }
        let scale = String(format: "%.4f", contentSizeScale(category))
        return "window.__shiziInitialContentSize = {category:\(literal),scale:\(scale)};"
    }

    /// 重建全部用户脚本（WKUserContentController 不能单独删一条）：先清空，再装 DEBUG 冒烟标记与当前字号。
    private func installUserScripts(on controller: WKUserContentController, category: UIContentSizeCategory? = nil) {
        controller.removeAllUserScripts()
        #if DEBUG
        installNativeDevUserScriptIfNeeded(controller)
        installNativeInkUserScriptIfNeeded(controller)
        #endif
        if let source = Self.initialContentSizeScript(category ?? currentContentSizeCategory) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    private func refreshUserScripts(category: UIContentSizeCategory? = nil) {
        guard let controller = scriptController else { return }
        installUserScripts(on: controller, category: category)
    }

    /// 档位 → 页面认的短名（与 src/platform/text-size.js CONTENT_SIZE_CATEGORIES 一致）；未知档位（将来 iOS 新增）原样传 rawValue。
    static func contentSizeName(_ category: UIContentSizeCategory) -> String {
        switch category {
        case .extraSmall: return "xS"
        case .small: return "S"
        case .medium: return "M"
        case .large: return "L"
        case .extraLarge: return "XL"
        case .extraExtraLarge: return "XXL"
        case .extraExtraExtraLarge: return "XXXL"
        case .accessibilityMedium: return "AX1"
        case .accessibilityLarge: return "AX2"
        case .accessibilityExtraLarge: return "AX3"
        case .accessibilityExtraExtraLarge: return "AX4"
        case .accessibilityExtraExtraExtraLarge: return "AX5"
        case .unspecified: return "L"
        default: return category.rawValue
        }
    }

    /// 该档位下 iOS 正文字号与默认 17pt 之比（连续值；页面只在表里没有该档位时用它）。
    static func contentSizeScale(_ category: UIContentSizeCategory) -> Double {
        let traits = UITraitCollection(preferredContentSizeCategory: category == .unspecified ? .large : category)
        let body = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits).pointSize
        return Double(body / 17)
    }

    func sendContentSize(_ category: UIContentSizeCategory) {
        let name = Self.contentSizeName(category)
        guard let literal = Self.jsonLiteral(name) else { return }
        let scale = String(format: "%.4f", Self.contentSizeScale(category))
        webView.evaluateJavaScript(
            "if (typeof shiziContentSize === 'function') shiziContentSize({category:\(literal),scale:\(scale)}); void 0;"
        )
    }

    private static var devModeEnabled: Bool {
        let process = ProcessInfo.processInfo
        return process.arguments.contains("-shizi-dev") || process.environment["SHIZI_DEV"] == "1"
    }

    // MARK: - 提醒深链（01 §8.2：只在 evaluate 返回 true 后清 key；WebContent 进程终止时保留 key）

    func openReminderTarget(cardKey: String) {
        guard !cardKey.isEmpty else { return }
        pendingReminderCardKey = cardKey
        dispatchPendingReminderTargetIfReady()
    }

    private func dispatchPendingReminderTargetIfReady() {
        guard pageReady, !reminderDispatchInFlight, let cardKey = pendingReminderCardKey else { return }
        guard let literal = Self.jsonLiteral(cardKey) else {
            pendingReminderCardKey = nil
            return
        }
        reminderDispatchInFlight = true
        let script = "typeof shiziOpenReminderTarget === 'function' && shiziOpenReminderTarget(\(literal)) === true;"
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self else { return }
            self.reminderDispatchInFlight = false
            let accepted = error == nil && (result as? Bool) == true
            if accepted, self.pendingReminderCardKey == cardKey {
                self.pendingReminderCardKey = nil
            }
            #if DEBUG
            self.recordSmokeEvent("reminderDispatch", [
                "cardKey": cardKey,
                "accepted": accepted,
                "cleared": self.pendingReminderCardKey == nil,
            ])
            #endif
            // 没被接收：key 留着，下一次 pageReady 再派发。派发期间又来了新 key：立刻再派发一次。
            if accepted, self.pendingReminderCardKey != nil {
                self.dispatchPendingReminderTargetIfReady()
            }
        }
    }

    static func jsonLiteral(_ value: Any) -> String? {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value], options: [.fragmentsAllowed]),
            let array = String(data: data, encoding: .utf8),
            array.hasPrefix("["), array.hasSuffix("]")
        else {
            return nil
        }
        return String(array.dropFirst().dropLast())
    }

    // MARK: - 分享与备份

    private func cleanupTemporaryShareFiles() {
        let manager = FileManager.default
        guard let files = try? manager.contentsOfDirectory(at: manager.temporaryDirectory, includingPropertiesForKeys: nil) else {
            return
        }
        files.filter { $0.lastPathComponent.hasPrefix(Self.temporarySharePrefix) }.forEach { try? manager.removeItem(at: $0) }
    }

    /// 分享 / 导出用的临时文件。每次放在各自独立的临时目录（shizi-share-<UUID>/）里，文件名就是页面给的名字
    /// （如「拾字备份-2026-10-04.json」）：用户在分享面板、存到「文件」时看到的是可认的名字，不带 UUID（Q2-7，复测 simA）。
    /// 目录名带 shizi-share- 前缀，启动时 cleanupTemporaryShareFiles 一并清掉没删干净的。
    func temporaryShareURL(filename: String) -> URL {
        let manager = FileManager.default
        let directory = manager.temporaryDirectory
            .appendingPathComponent("\(Self.temporarySharePrefix)\(UUID().uuidString)", isDirectory: true)
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        return Self.uniqueShareURL(in: directory, name: filename)
    }

    /// 文件名里的 / : \ 换成 -；空名字退回 shizi。
    static func safeShareName(_ filename: String) -> String {
        let name = filename
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "shizi" : name
    }

    /// directory 里 name 的落点；同名已存在时在扩展名前加序号（「拾字备份-2026-10-04 2.json」）。
    static func uniqueShareURL(in directory: URL, name: String, manager: FileManager = .default) -> URL {
        let safe = safeShareName(name)
        let first = directory.appendingPathComponent(safe)
        guard manager.fileExists(atPath: first.path) else { return first }
        let stem = (safe as NSString).deletingPathExtension
        let ext = (safe as NSString).pathExtension
        var n = 2
        while true {
            let candidate = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
            let url = directory.appendingPathComponent(candidate)
            if !manager.fileExists(atPath: url.path) { return url }
            n += 1
        }
    }

    /// 删掉临时分享文件；它所在的独立目录（shizi-share- 前缀）一并删掉。
    func removeTemporaryShareFile(_ url: URL) {
        let manager = FileManager.default
        try? manager.removeItem(at: url)
        let parent = url.deletingLastPathComponent()
        if parent.lastPathComponent.hasPrefix(Self.temporarySharePrefix) {
            try? manager.removeItem(at: parent)
        }
    }

    private func shareBackup(filename: String, payload: String) {
        #if DEBUG
        if smokeInterceptShareBackup(filename: filename, payload: payload) { return }
        #endif
        guard presentedViewController == nil else { return }
        let fileURL = temporaryShareURL(filename: filename)

        do {
            try Data(payload.utf8).write(to: fileURL, options: .atomic)
        } catch {
            // 不弹原生提示（文案在 Web 侧）：页面收不到 markBackupExported，就不会记成已导出，可以再点一次；
            // P96：告诉页面分享没打开，由页面轻提示。
            logNative("shareBackup could not write temporary file: \(error.localizedDescription)")
            notifyShareFailed(kind: "backup", reason: "write")
            return
        }

        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activity.completionWithItemsHandler = { [weak self] _, completed, _, activityError in
            defer { self?.removeTemporaryShareFile(fileURL) }
            if activityError != nil {
                self?.notifyShareFailed(kind: "backup", reason: "activity")
                return
            }
            guard completed else { return } // 用户取消：不记导出、不提示
            self?.notifyBackupExported()
        }
        presentCentered(activity)
    }

    func notifyBackupExported() {
        webView.evaluateJavaScript("if (typeof markBackupExported === 'function') markBackupExported(); void 0;")
    }

    /// P96（M6-6 过渡）：原生分享 / 打开外链失败时交给页面 shiziShareFailed({kind, reason})，由页面轻提示
    /// （文案在 Web 侧 X-SHARE，Swift 不含面向用户的文字）。kind: backup / card / link；
    /// reason: write / payload / activity / refused / open（只作诊断，页面按 kind 取文案）。用户取消不算失败。
    func notifyShareFailed(kind: String, reason: String) {
        DispatchQueue.main.async { [weak self] in
            #if DEBUG
            self?.recordSmokeEvent("shareFailed", ["kind": kind, "reason": reason])
            #endif
            self?.webView.evaluateJavaScript(
                "if (typeof window.shiziShareFailed === 'function') window.shiziShareFailed({kind:'\(kind)',reason:'\(reason)'}); void 0;"
            )
        }
    }

    private func sharePracticeCard(filename: String, dataURL: String) {
        guard presentedViewController == nil else { return }
        guard let image = Self.imageData(fromDataURL: dataURL) else {
            logNative("sharePracticeCard rejected a payload that is not a JPEG / PNG data URL")
            notifyShareFailed(kind: "card", reason: "payload")
            return
        }
        let data = image.data

        let safeStem = filename
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
        let safeName = Self.fileName(safeStem, forExtension: image.fileExtension)
        let fileURL = temporaryShareURL(filename: safeName)
        do {
            try data.write(to: fileURL, options: .atomic)
        } catch {
            logNative("sharePracticeCard could not write temporary file: \(error.localizedDescription)")
            notifyShareFailed(kind: "card", reason: "write")
            return
        }

        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activity.completionWithItemsHandler = { [weak self] _, _, _, activityError in
            self?.removeTemporaryShareFile(fileURL)
            if activityError != nil {
                self?.notifyShareFailed(kind: "card", reason: "activity")
            }
        }
        presentCentered(activity)
    }

    private func presentCentered(_ controller: UIViewController) {
        if let popover = controller.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        present(controller, animated: true)
    }

    private func presentBackupPicker() {
        #if DEBUG
        if smokeInterceptPickBackup() { return }
        #endif
        guard presentedViewController == nil else { return }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    enum BackupRejection: String, Error {
        case tooLarge
        case invalid
        case cancelled
    }

    /// 01 §8.1：原生只做 10MB 上限与 JSON 外壳预检（app=="shizi"、data 是非空对象、键全部 `shizi.` 前缀；v1/v2 都放行），
    /// 通过则把文件文本交给 shiziBackupPicked(text)，否则 shiziBackupRejected({reason})；校验、页内确认、保护副本、替换、
    /// 撤销全部在 JS。原生不 reload、不弹 alert。
    func importBackup(from url: URL) {
        let hasSecurityScope = url.startAccessingSecurityScopedResource()
        let path = url.standardizedFileURL.path
        let shouldRemoveCopy = path.hasPrefix(FileManager.default.temporaryDirectory.standardizedFileURL.path + "/") || path.contains("/Documents/Inbox/")
        defer {
            if hasSecurityScope {
                url.stopAccessingSecurityScopedResource()
            }
            if shouldRemoveCopy {
                removeTemporaryShareFile(url)
            }
        }

        switch Self.precheckBackupFile(at: url) {
        case .success(let text):
            deliverBackupText(text)
        case .failure(let rejection):
            deliverBackupRejection(rejection)
        }
    }

    static func precheckBackupFile(at url: URL) -> Result<String, BackupRejection> {
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > backupMaxBytes {
            return .failure(.tooLarge)
        }
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            return .failure(.invalid)
        }
        guard data.count <= backupMaxBytes else {
            return .failure(.tooLarge)
        }
        guard
            let text = String(data: data, encoding: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            object["app"] as? String == "shizi",
            let backupData = object["data"] as? [String: Any],
            !backupData.isEmpty,
            backupData.keys.allSatisfy({ $0.hasPrefix("shizi.") })
        else {
            return .failure(.invalid)
        }
        return .success(text)
    }

    private func deliverBackupText(_ text: String) {
        guard let literal = Self.jsonLiteral(text) else {
            deliverBackupRejection(.invalid)
            return
        }
        let script = "typeof shiziBackupPicked === 'function' && shiziBackupPicked(\(literal)) === true;"
        webView.evaluateJavaScript(script) { [weak self] result, error in
            let accepted = error == nil && (result as? Bool) == true
            if !accepted {
                self?.logNative("shiziBackupPicked was not accepted by the page")
            }
            #if DEBUG
            self?.recordSmokeEvent("backupDelivered", ["accepted": accepted, "bytes": text.utf8.count])
            #endif
        }
    }

    func deliverBackupRejection(_ rejection: BackupRejection) {
        #if DEBUG
        recordSmokeEvent("backupRejected", ["reason": rejection.rawValue])
        #endif
        webView.evaluateJavaScript(
            "if (typeof shiziBackupRejected === 'function') shiziBackupRejected({reason:'\(rejection.rawValue)'}); void 0;"
        )
    }

    private func openExternally(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else {
            logNative("refused to open external URL with scheme \(url.scheme ?? "nil")")
            notifyShareFailed(kind: "link", reason: "refused")
            return
        }
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            if !opened {
                self?.logNative("system could not open \(scheme) link")
                self?.notifyShareFailed(kind: "link", reason: "open")
            }
        }
    }

    /// 01 §8.1 openAppSettings：提醒被拒时跳到本 App 的系统设置页（P86）。
    private func openAppSettings() {
        #if DEBUG
        if Self.nativeSmokeEnabled {
            recordSmokeEvent("openAppSettings", [:])
            return
        }
        #endif
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    func logNative(_ message: String) {
        #if DEBUG
        NSLog("[shizi] %@", message)
        #endif
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.scheme == ShiziWebResource.scheme, url.host == ShiziWebResource.host {
            decisionHandler(.allow)
            return
        }

        if navigationAction.targetFrame?.isMainFrame != false {
            openExternally(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // 新文档（首次加载、页面自己 reload、阻断页「再试一次」整页重载）：等新页面重新 postMessage pageReady。
        pageReady = false
        reminderDispatchInFlight = false
        backGestureEnabled = true
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // 提醒深链的 key 保留，重载后页面发 pageReady 时再派发（01 §8.2）。
        pageReady = false
        loadApp()
    }
}

extension WebViewController: WKUIDelegate {
    // v10 页面不用 window.alert / confirm / prompt（确认框都在页内，文案在 src/config/copy/）：
    // 不实现这三个面板，WebKit 按默认处理（alert 直接返回、confirm 返回 false、prompt 返回 null），原生不再带面向用户的文案。

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "shiziNative",
            message.frameInfo.isMainFrame,
            let body = message.body as? [String: Any],
            let type = body["type"] as? String
        else {
            return
        }

        switch type {
        case "pageReady":
            handlePageReady()
        case "shareBackup":
            let name = body["name"] as? String ?? "shizi-backup.json"
            let payload = body["payload"] as? String ?? "{}"
            shareBackup(filename: name, payload: payload)
        case "sharePracticeCard":
            let name = body["name"] as? String ?? "shizi-card.jpg"
            let dataURL = body["dataURL"] as? String ?? ""
            sharePracticeCard(filename: name, dataURL: dataURL)
        case "savePracticeCard":
            let dataURL = body["dataURL"] as? String ?? ""
            savePracticeCard(dataURL: dataURL)
        case "pickBackup":
            presentBackupPicker()
        #if DEBUG
        case "nativeSmokeResult":
            let payload = body["payload"] as? String ?? #"{"error":"Missing native smoke payload"}"#
            writeNativeSmokeResult(payload)
        case "nativeSmokeControl":
            handleNativeSmokeControl(body)
        case "nativeInk":
            handleNativeInkMessage(body)
        #endif
        case "haptic":
            playHaptic(kind: body["kind"] as? String ?? "")
        case "sound":
            playSound(kind: body["kind"] as? String ?? "", gain: body["gain"] as? Double ?? 1)
        case "soundscape":
            // P07：练字背景音已删；旧页面若还发这条消息，原生什么都不做。
            break
        case "syncReminder":
            syncReminder(body: body)
        case "requestReminderPermission":
            requestReminderPermission()
        case "queryReminderStatus":
            sendReminderStatus()
        case "openAppSettings":
            openAppSettings()
        case "backGestureEnabled":
            backGestureEnabled = (body["value"] as? Bool) ?? true
            #if DEBUG
            NSLog("[shizi] backGestureEnabled=%@", backGestureEnabled ? "true" : "false")
            #endif
        default:
            break
        }
    }
}

extension WebViewController: UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === practiceBackGesture else { return true }
        #if DEBUG
        if !backGestureEnabled {
            NSLog("[shizi] native back gesture refused: backGestureEnabled=false")
        }
        #endif
        return backGestureEnabled
    }
}

// MARK: - 图片存相册：成功与否回 shiziCardSaved({success})，提示文案在 Web 侧（R-B10）
extension WebViewController {
    /// 页面发来的导出图：JPEG（交接 §6.5，quality 0.92）或 PNG（旧页面）。只认 `data:image/jpeg|png;base64,` 且文件头与声明一致、≤ 12MB。
    struct CardImage {
        let data: Data
        let fileExtension: String
    }

    static func imageData(fromDataURL dataURL: String) -> CardImage? {
        let kinds: [(prefix: String, magic: [UInt8], ext: String)] = [
            ("data:image/jpeg;base64,", [0xFF, 0xD8, 0xFF], "jpg"),
            ("data:image/png;base64,", [0x89, 0x50, 0x4E, 0x47], "png"),
        ]
        guard let kind = kinds.first(where: { dataURL.hasPrefix($0.prefix) }),
              let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              data.count <= 12 * 1024 * 1024,
              data.starts(with: kind.magic)
        else {
            return nil
        }
        return CardImage(data: data, fileExtension: kind.ext)
    }

    /// 文件名的扩展名跟着实际格式走：去掉页面给的 .jpg / .jpeg / .png 再补上真实扩展名。
    static func fileName(_ stem: String, forExtension ext: String) -> String {
        var base = stem
        for suffix in [".jpeg", ".jpg", ".png"] where base.lowercased().hasSuffix(suffix) {
            base = String(base.dropLast(suffix.count))
            break
        }
        return "\(base.isEmpty ? "shizi-card" : base).\(ext)"
    }

    private func savePracticeCard(dataURL: String) {
        guard let card = Self.imageData(fromDataURL: dataURL), UIImage(data: card.data) != nil else {
            sendPracticeCardSaveResult(false)
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard status == .authorized || status == .limited else {
                self?.sendPracticeCardSaveResult(false)
                return
            }
            PHPhotoLibrary.shared().performChanges({
                // 按原始字节写入（JPEG 不再经 UIImage 转码一遍）。
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: card.data, options: nil)
            }) { success, _ in
                self?.sendPracticeCardSaveResult(success)
            }
        }
    }

    private func sendPracticeCardSaveResult(_ success: Bool) {
        DispatchQueue.main.async { [weak self] in
            #if DEBUG
            self?.recordSmokeEvent("cardSaved", ["success": success])
            #endif
            self?.webView.evaluateJavaScript(
                "if (typeof window.shiziCardSaved === 'function') window.shiziCardSaved({success:\(success ? "true" : "false")}); void 0;"
            )
        }
    }
}

// MARK: - 声音：判断「收进」的纸页落定（三个变体，页面轮换）与落款的木印盖章（S1，D50 ⑦）
// 素材是打进包里的 CAF（线性 PCM 16bit，无编码、无 priming 补零，起音从第 0 个采样开始；assets/sound/，scripts/sound/gen.mjs 程序合成）。
// AVAudioSession 用 .ambient + .mixWithOthers：遵守静音键（静音时完全无声），与后台音乐混音——不打断、不压低（不用 duckOthers）。
// 书写与描红没有声音；设置里「按键音」关着时页面根本不发 sound 消息。页面决定播哪个文件（kind = 文件名，不含扩展名）与增益 gain。
extension WebViewController {
    private static let soundNames = ["j1_page_settle", "j1_page_settle_b", "j1_page_settle_c", "s1_wood_muted"]

    private func preloadSounds() {
        guard let webRoot = Bundle.main.url(forResource: "Web", withExtension: nil) else { return }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        let directory = webRoot.appendingPathComponent("assets/sound", isDirectory: true)
        for name in Self.soundNames {
            let url = directory.appendingPathComponent("\(name).caf")
            guard let player = try? AVAudioPlayer(contentsOf: url) else { continue }
            player.prepareToPlay()
            soundPlayers[name] = player
        }
    }

    private func playSound(kind: String, gain: Double) {
        guard let player = soundPlayers[kind] else { return } // 未知名字忽略（旧的 stamp / paper 已不存在）
        player.volume = Float(min(max(gain, 0), 1))
        player.currentTime = 0
        player.play()
    }
}

// MARK: - 触觉反馈：按记账、过程完成、选择切换分层；未知值忽略
extension WebViewController {
    private func playHaptic(kind: String) {
        switch kind {
        case "stamp":
            stampHaptic.impactOccurred()
            stampHaptic.prepare()
        case "undo":
            undoHaptic.impactOccurred()
            undoHaptic.prepare()
        case "action":
            actionHaptic.impactOccurred()
            actionHaptic.prepare()
        case "select":
            selectionHaptic.selectionChanged()
            selectionHaptic.prepare()
        case "milestone":
            milestoneHaptic.notificationOccurred(.success)
            milestoneHaptic.prepare()
        default:
            break
        }
    }
}

// MARK: - 练习提醒：native 是无状态执行器，开关/时间/已练状态/题目全部由 web 侧下发
extension WebViewController {
    struct ReminderQuestion {
        let day: String
        let title: String
        let body: String
        let targetCardKey: String

        init?(_ value: [String: Any]) {
            guard
                let day = value["day"] as? String,
                let title = value["title"] as? String,
                let body = value["body"] as? String,
                let targetCardKey = value["targetCardKey"] as? String,
                !day.isEmpty,
                !title.isEmpty,
                !body.isEmpty,
                !targetCardKey.isEmpty
            else {
                return nil
            }
            self.day = day
            self.title = title
            self.body = body
            self.targetCardKey = targetCardKey
        }
    }

    struct ReminderRequest {
        let enabled: Bool
        let hour: Int
        let minute: Int
        let practicedToday: Bool
        let questions: [ReminderQuestion]
        let rawQuestionCount: Int

        init(body: [String: Any]) {
            enabled = body["enabled"] as? Bool ?? false
            hour = (body["hour"] as? NSNumber)?.intValue ?? 20
            minute = (body["minute"] as? NSNumber)?.intValue ?? 0
            practicedToday = body["practicedToday"] as? Bool ?? false
            let raw = body["questions"] as? [[String: Any]] ?? []
            rawQuestionCount = raw.count
            questions = raw.compactMap(ReminderQuestion.init)
        }
    }

    struct ReminderSlot {
        let dayKey: String
        let components: DateComponents
        let question: ReminderQuestion
    }

    static let reminderIdentifierPrefix = "shizi.reminder."
    private static let reminderWindowDays = 7

    private func syncReminder(body: [String: Any]) {
        let request = ReminderRequest(body: body)
        #if DEBUG
        smokeRecordReminderSync(request)
        #endif
        // 世代号防并发交错：快速开关时旧一轮的 remove/schedule 全部作废，只让最新一轮落地
        reminderSyncGeneration += 1
        let generation = reminderSyncGeneration
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { [weak self] requests in
            DispatchQueue.main.async {
                guard let self, generation == self.reminderSyncGeneration else { return }
                let ours = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderIdentifierPrefix) }
                center.removePendingNotificationRequests(withIdentifiers: ours)
                guard request.enabled, !request.questions.isEmpty else { return }
                center.getNotificationSettings { settings in
                    DispatchQueue.main.async {
                        guard generation == self.reminderSyncGeneration else { return }
                        // web 侧的 permission 可能来自换机恢复的备份，调度前以本机授权状态为准
                        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
                        Self.scheduleReminderWindow(Self.reminderPlan(request, now: Date()))
                    }
                }
            }
        }
    }

    /// 从今天起最多排 7 道题；今天已练或时刻已过则跳过今天；没有题目的日期不发送。纯函数（冒烟也用它核对下发内容）。
    static func reminderPlan(_ request: ReminderRequest, now: Date, calendar: Calendar = .current) -> [ReminderSlot] {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let questionsByDay = Dictionary(request.questions.map { ($0.day, $0) }, uniquingKeysWith: { first, _ in first })
        var slots: [ReminderSlot] = []
        for offset in 0...reminderWindowDays {
            if slots.count == reminderWindowDays { break }
            guard
                let day = calendar.date(byAdding: .day, value: offset, to: now),
                let fireDate = calendar.date(bySettingHour: request.hour, minute: request.minute, second: 0, of: day)
            else { continue }
            if offset == 0 && (request.practicedToday || fireDate <= now) { continue }
            let dayKey = formatter.string(from: fireDate)
            guard let question = questionsByDay[dayKey] else { continue }
            let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
            slots.append(ReminderSlot(dayKey: dayKey, components: components, question: question))
        }
        return slots
    }

    private static func scheduleReminderWindow(_ slots: [ReminderSlot]) {
        let center = UNUserNotificationCenter.current()
        for slot in slots {
            let content = UNMutableNotificationContent()
            content.title = slot.question.title
            content.sound = .default
            content.body = slot.question.body
            content.userInfo = ["targetCardKey": slot.question.targetCardKey]
            let trigger = UNCalendarNotificationTrigger(dateMatching: slot.components, repeats: false)
            let identifier = reminderIdentifierPrefix + slot.dayKey
            center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
        }
    }

    private func requestReminderPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                self?.dispatchReminderStatus(granted ? "granted" : "denied")
            }
        }
    }

    private func sendReminderStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let status = Self.permissionName(settings.authorizationStatus)
            DispatchQueue.main.async {
                self?.dispatchReminderStatus(status)
            }
        }
    }

    static func permissionName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return "granted"
        case .denied:
            return "denied"
        case .notDetermined:
            return "unknown"
        @unknown default:
            return "unknown"
        }
    }

    private func dispatchReminderStatus(_ status: String) {
        webView.evaluateJavaScript("if (typeof shiziReminderStatus === 'function') shiziReminderStatus({permission:'\(status)'}); void 0;")
    }
}

extension WebViewController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            deliverBackupRejection(.cancelled)
            return
        }
        importBackup(from: url)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        deliverBackupRejection(.cancelled)
    }
}
