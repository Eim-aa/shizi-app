import Foundation

// B4.5c / B4.7：选哪一个引擎（计划 B3B4-原生化架构与计划.md §4.3 ⑥、§6.2 B4.5 / B4.7）。
//
//   web     缺省：WebEngine（WKWebView 里的 JS）是写入者，页面的 op 全由它答。
//   swift   SwiftEngine（ShiziCore 的 SessionRuntime，同一个 SQLite 库）答它移植了的 op；导航 / 宿主状态类 op 仍交 JS（清单见 SwiftEngine.swift EngineOps）。
//   shadow  WebEngine 照旧是写入者、照旧答页面；每个 op 同时在后台用同一前态的内存副本让 SwiftEngine 再算一遍，回包与后态逐值比对（ShadowEngine.swift）。
//
// 只有 DEBUG 包认启动参数 `-shizi-engine swift|web|shadow`（UserDefaults 参数域，与其它 -shizi-* 一样）；Release 恒为 web，
// 选择与影子代码不编进去（verify-archive 核对可执行文件里没有 -shizi-engine）。
enum ShiziEngineMode: String {
    case web
    case swift
    case shadow

    static let current: ShiziEngineMode = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-shizi-engine"), i + 1 < args.count, let mode = ShiziEngineMode(rawValue: args[i + 1]) { return mode }
        #endif
        return .web
    }()
}
