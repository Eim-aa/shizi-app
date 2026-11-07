import ShiziCore
import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        NativeStage.launchedAt = Date().timeIntervalSince1970 // B3.F 冷启动量测：didFinishLaunching 时刻
        // 冷启动预热：deck.json（≈2MB）等只读资源在后台先解析，与主线程的建窗口 / 读库（SwiftEngine.init 的 core.load）并行；
        // 主线程碰到还在初始化的 static let 会等它做完（只初始化一次），碰到已做完的直接用。只改加载时机（ShiziCore Config/Warmup.swift）。
        DispatchQueue.global(qos: .userInitiated).async { CoreWarmup.warmLaunchResources() }
        UNUserNotificationCenter.current().delegate = self
        let window = UIWindow(frame: UIScreen.main.bounds)
        ShiziTheme.boot(window: window)
        window.rootViewController = RootViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // 人已经在 App 里，前台不弹提醒横幅
        completionHandler([])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard
            let targetCardKey = response.notification.request.content.userInfo["targetCardKey"] as? String,
            !targetCardKey.isEmpty,
            let controller = window?.rootViewController as? RootViewController
        else {
            return
        }
        controller.openReminderTarget(cardKey: targetCardKey)
    }
}
