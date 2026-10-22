import Foundation
import ShiziCore

// shizi-core-cli：ShiziCore 的 JSON 行协议外壳（B4.0）。stdin 一行一个请求，stdout 一行一个回包（协议见 ../../README.md）。
//   shizi-core-cli [--tz <IANA 时区>]     时区缺省取环境变量 TZ，再缺省取系统时区（与 node 侧 process.env.TZ 对齐）
// 空行忽略；EOF 退出 0。stderr 只在启动参数错时写。

var tzName = ProcessInfo.processInfo.environment["TZ"]
var argv = CommandLine.arguments.dropFirst()
while let a = argv.first {
    argv = argv.dropFirst()
    if a == "--tz", let v = argv.first {
        tzName = v
        argv = argv.dropFirst()
    } else {
        FileHandle.standardError.write("usage: shizi-core-cli [--tz <zone>]\n".data(using: .utf8)!)
        exit(2)
    }
}

var timeZone = TimeZone.current
if let name = tzName, !name.isEmpty {
    guard let tz = TimeZone(identifier: name) else {
        FileHandle.standardError.write("unknown time zone: \(name)\n".data(using: .utf8)!)
        exit(2)
    }
    timeZone = tz
}

setvbuf(stdout, nil, _IOLBF, 0)
let engine = CoreEngine(timeZone: timeZone)
while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    print(engine.handle(line: line))
}
