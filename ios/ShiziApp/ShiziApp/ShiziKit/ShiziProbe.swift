import Foundation

// ShiziKit（B3.1）：测试探针的钩子。原生页面（Release 组件）只经这里留记录 / 读测试开关；实现在 DEBUG 测试宿主
// （NativeQAHarness.swift 的 QATrace、-shizi-qa-* 启动参数），Release 里全部是空操作、读不到任何测试参数
// （verify-archive.sh 断言 Release 可执行文件不含 -shizi-qa / qa-probe 等标记）。
enum ShiziProbe {
    /// 转场 / 宿主事件记录（QA-H1 探针 transitions：present:<种类>、dismiss:…、drag:…、close、cover:fade、overlap …）。
    static func note(_ event: @autoclosure () -> String) {
        #if DEBUG
        QATrace.note(event())
        #endif
    }

    /// 开发日志（Release 不打）。
    static func log(_ message: @autoclosure () -> String) {
        #if DEBUG
        NSLog("[shizi] %@", message())
        #endif
    }

    /// 测试里强制「减少动态效果」（-shizi-qa-reduce-motion，DEBUG）。
    static var forceReduceMotion: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("-shizi-qa-reduce-motion")
        #else
        return false
        #endif
    }

    /// 转场放慢倍数（-shizi-qa-nav-slow <倍数>，逐帧截图核对画面，DEBUG）；没有 → nil。
    static var navSlowFactor: Double? {
        #if DEBUG
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-shizi-qa-nav-slow"), i + 1 < a.count, let f = Double(a[i + 1]), f > 0 { return f }
        #endif
        return nil
    }
}
