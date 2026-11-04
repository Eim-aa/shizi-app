import Photos
import UIKit
import UserNotifications

// 拾字的窗口根（B4.9：原来的 WKWebView 宿主 WebViewController 换成纯原生）。
// 它只持有原生层的协调者 NativeStage（tab 根页、推入的原生页、写字 / 结果页、引擎 SwiftEngine），再管几件平台的事：
//   · 冷启动：首帧画首页静态版（stage.bootFrame），随即做冷启动判定（stage.start → route.plan；不再等网页 pageReady）；
//   · 提醒深链：点通知 → openReminderTarget → 栈重建好之后 deeplink.reminder（SwiftNavigator 答）；
//   · 存相册（图片预览「保存」：SwiftEngine 的 image.persist → saveCard）；
//   · 系统通知（SwiftEngine 的 ReminderController 要同步 / 要权限 / 查权限）；
//   · 声音预载（SoundPlayer，首帧之后）。
// 面向用户的文字都在 ShiziCore 的文案表（原生不弹 alert）。

/// 左缘返回的阈值（R4-G1 / P270 / P272）：原生写字 / 结果页 / 通用原生页的跟手返回共用（与 JS 参考的 BACK_COMMIT_RATIO /
/// BACK_COMMIT_VELOCITY / BACK_RETURN_VELOCITY 一致）。
enum BackGestureThreshold {
    /// 位移过三分之一个宽（D36 时为 0.5）。
    static let commitRatio: CGFloat = 1.0 / 3.0
    /// pt/s：向右甩过这个速度，不看位移。
    static let commitVelocity: CGFloat = 500
    /// pt/s：位移过阈值后若向左回拉快过这个速度，视为取消。
    static let returnVelocity: CGFloat = -200

    static func commits(distance: CGFloat, velocity: CGFloat, width: CGFloat) -> Bool {
        velocity > commitVelocity || (distance > width * commitRatio && velocity > returnVelocity)
    }
}

final class RootViewController: UIViewController {
    /// B3.2：原生层的协调者（写字 / 结果页 + 通用原生屏 + 引擎；NativeStage.swift）。
    lazy var stage = NativeStage(host: self)
    private var reminderSyncGeneration = 0
    private(set) var pendingReminderCardKey: String?
    private var reminderDispatchInFlight = false

    init() {
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        // 纸色取 Assets 的 Paper 颜色集（浅 #F4F0E7 / 深 #221E1A，由 scripts/generate-paper-colorset.mjs 从 --p 生成），
        // 与启动屏 UILaunchScreen.UIColorName 同源，冷启动到首帧没有底色跳变（A7 / G19）。
        let container = UIView(frame: .zero)
        container.backgroundColor = UIColor(named: "Paper") ?? .systemBackground
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        stage.bootFrame() // B3.F：先画首页静态版（「拾」+ 日期），route.plan 回来时同一张根页认领
        #if DEBUG
        applyQALaunchArguments() // 测试宿主的启动参数（QA 时钟往后拨、冷 / 热启动的提醒深链），冷启动判定之前
        #endif
        // B4.9：引擎就在进程里，不再等网页就绪——下一轮主线程做冷启动判定（首帧先上屏）
        DispatchQueue.main.async { [weak self] in self?.startEngine() }
        // 首帧之后再做的杂事（声音预载）：首帧不等它们
        stage.afterBootFrame { SoundPlayer.shared.preload() }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .default
    }

    /// 冷启动判定（route.plan：守卫 / 过期 / 深链 / 坏值 / 阻断优先）→ 无转场重建栈；之后派发提醒深链、QA 设施。
    private func startEngine() {
        stage.start()
        stage.whenPlanned { [weak self] in
            self?.dispatchPendingReminderTargetIfReady() // 提醒深链：栈重建好之后派发（冷启动判定先看到它：深链优先）
            #if DEBUG
            self?.runQAHarnessIfNeeded() // QA-H1（状态注入 / 逐屏取证 / 探针，只在启动参数 -shizi-qa* 下）：栈重建好之后再动导航
            #endif
        }
    }

    // MARK: - 系统字号

    /// 此刻的系统字号档位。视图还没进窗口时（冷启动 loadView / viewDidLoad）traitCollection 不可靠，改读 UIApplication
    /// （它也反映控制中心「单个 App 文字大小」）。
    var currentContentSizeCategory: UIContentSizeCategory {
        let category = isViewLoaded && view.window != nil
            ? view.traitCollection.preferredContentSizeCategory
            : UIApplication.shared.preferredContentSizeCategory
        return category == .unspecified ? .large : category
    }

    /// 档位 → 短名（与 JS 参考 CONTENT_SIZE_CATEGORIES 一致）；未知档位（将来 iOS 新增）原样给 rawValue。
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

    // MARK: - 提醒深链（只在 deeplink.reminder 答 ok 后清 key）

    func openReminderTarget(cardKey: String) {
        guard !cardKey.isEmpty else { return }
        pendingReminderCardKey = cardKey
        dispatchPendingReminderTargetIfReady()
    }

    /// 提醒深链（deeplink.reminder op——SwiftNavigator 答；去哪 / 要不要先回首页 / 要不要弹 S02 由它定）。冷启动判定之前到的先存着。
    private func dispatchPendingReminderTargetIfReady() {
        guard stage.planned, !reminderDispatchInFlight, let cardKey = pendingReminderCardKey else { return }
        reminderDispatchInFlight = true
        stage.engine.raw("deeplink.reminder", ["cardKey": cardKey]) { [weak self] reply in
            guard let self else { return }
            self.reminderDispatchInFlight = false
            let accepted = (reply["ok"] as? Bool) == true
            if accepted, self.pendingReminderCardKey == cardKey {
                self.pendingReminderCardKey = nil
            }
            // 派发期间又来了新 key：立刻再派发一次。
            if accepted, self.pendingReminderCardKey != nil {
                self.dispatchPendingReminderTargetIfReady()
            }
        }
    }
}

// MARK: - 图片存相册（图片预览「保存」：SwiftEngine 的 image.persist；成功与否回给引擎，提示文案在文案表 R-B10）
extension RootViewController {
    /// 导出图：JPEG（交接 §6.5，quality 0.92）或 PNG。只认 `data:image/jpeg|png;base64,` 且文件头与声明一致、≤ 12MB。
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

    /// 文件名的扩展名跟着实际格式走：去掉给的 .jpg / .jpeg / .png 再补上真实扩展名。
    static func fileName(_ stem: String, forExtension ext: String) -> String {
        var base = stem
        for suffix in [".jpeg", ".jpg", ".png"] where base.lowercased().hasSuffix(suffix) {
            base = String(base.dropLast(suffix.count))
            break
        }
        return "\(base.isEmpty ? "shizi-card" : base).\(ext)"
    }

    #if DEBUG
    /// B4.9c：存相册的 QA 桩（夹具 op stubSave / stubNative，QAOps.swift）：reply = 立刻回 success；false = 一直等着（保存中）。
    static var qaSaveStub: (success: Bool, reply: Bool)?
    static var qaSaveCalls = 0
    #endif

    /// 存相册：完成（主线程）回成功与否；timeout 秒内没结果算失败（NATIVE_SAVE_TIMEOUT_MS）。
    func saveCard(dataURL: String, timeout: TimeInterval? = nil, completion: @escaping (Bool) -> Void) {
        var done = false
        let finish: (Bool) -> Void = { ok in
            DispatchQueue.main.async {
                guard !done else { return }
                done = true
                completion(ok)
            }
        }
        if let timeout { DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { finish(false) } }
        #if DEBUG
        // 取证 / 流程测试不能弹相册权限框
        if let stub = Self.qaSaveStub {
            Self.qaSaveCalls += 1
            if stub.reply { finish(stub.success) }
            return
        }
        #endif
        guard let card = Self.imageData(fromDataURL: dataURL), UIImage(data: card.data) != nil else {
            finish(false)
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                finish(false)
                return
            }
            PHPhotoLibrary.shared().performChanges({
                // 按原始字节写入（JPEG 不再经 UIImage 转码一遍）。
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: card.data, options: nil)
            }) { success, _ in
                finish(success)
            }
        }
    }
}

// MARK: - 练习提醒（系统通知）：开关 / 时间 / 已练状态 / 题目由 SwiftEngine 的 ReminderController 算好下发，这里只排期、要权限、查权限
extension RootViewController {
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

    func syncReminder(body: [String: Any]) {
        let request = ReminderRequest(body: body)
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
                        // 库里的 permission 可能来自换机恢复的备份，调度前以本机授权状态为准
                        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
                        #if DEBUG
                        let now = RootViewController.nativeTestHostEnabled ? QAClock.date() : Date() // B2.9b：QA 时钟
                        #else
                        let now = Date()
                        #endif
                        Self.scheduleReminderWindow(Self.reminderPlan(request, now: now))
                    }
                }
            }
        }
    }

    /// 从今天起最多排 7 道题；今天已练或时刻已过则跳过今天；没有题目的日期不发送。纯函数。
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

    func requestReminderPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                self?.stage.engine.receiveReminderStatus(granted ? "granted" : "denied")
            }
        }
    }

    func sendReminderStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let status = Self.permissionName(settings.authorizationStatus)
            DispatchQueue.main.async {
                self?.stage.engine.receiveReminderStatus(status)
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
}
