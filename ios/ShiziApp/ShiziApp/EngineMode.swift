import Foundation

// B4.5c / B4.7 / B4.8：选哪一个引擎（计划 B3B4-原生化架构与计划.md §4.3 ⑥、§4.4、§4.5、§6.2）。
//
//   swift   缺省（B4.8 起）：SwiftEngine（ShiziCore 的 SessionRuntime，同一个 SQLite 库）答它移植了的 op；
//           导航 / 宿主状态类 op 仍交 JS（清单见 SwiftEngineCore.swift EngineOps；WKWebView 仍在后台跑）。
//   web     回退：WebEngine（WKWebView 里的 JS）是写入者，页面的 op 全由它答。Release 里代码还在、没有入口（§4.5 第 1 条，留一版回退）。
//   shadow  WebEngine 写、答；每个 op 同时在后台让 SwiftEngine 用同一前态的内存副本再算一遍并逐值比对（ShadowEngine.swift，只在 DEBUG）。
//
// 只有 DEBUG 包认启动参数 `-shizi-engine swift|web|shadow`（或环境变量 SHIZI_ENGINE，宿主进程里的单元测试用）。
// 首次启动保护（§4.4）：库里的 localStorage → SQLite 迁移还没做完（store_meta 'migration' 不是 done：旧版升级的第一次启动、
// 迁移失败回退到 localStorage、旧数据判不准）时，这一次启动用 WebEngine——迁移只有 JS 一份（native-boot.js）；做完之后下一次启动再切到 SwiftEngine。
// 新装（B4.9b）：确定没有旧数据 → 选引擎前原生直接把迁移记成 done，第一次启动就是 SwiftEngine（LegacyStorage.swift）。
enum ShiziEngineMode: String {
    case web
    case swift
    case shadow

    static let current: ShiziEngineMode = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-shizi-engine"), i + 1 < args.count, let mode = ShiziEngineMode(rawValue: args[i + 1]) { return guarded(mode) }
        if let v = ProcessInfo.processInfo.environment["SHIZI_ENGINE"], let mode = ShiziEngineMode(rawValue: v) { return guarded(mode) }
        #endif
        return guarded(.swift)
    }()

    /// 迁移没做完（或读不出库）→ 这一次用 web。
    private static func guarded(_ mode: ShiziEngineMode) -> ShiziEngineMode {
        guard mode == .swift else { return mode }
        return migrationDone ? .swift : .web
    }

    /// 这次启动时迁移是否已是 done；新装（没有旧数据可迁）在这里由原生直接记成 done（B4.9b，LegacyStorage.swift）。
    static var migrationDone: Bool {
        NativeStoreBridge.shared.settleMigrationForLaunch()
    }
}
