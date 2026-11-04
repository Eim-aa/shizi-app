import Foundation
import XCTest
@testable import ShiziCore
@testable import ShiziCoreEngine

// 备份双向往返（B4.4；计划 §4.4）：夹具 Fixtures/backup-roundtrip.json 当年由 JS 参考引擎生成，D84 起冻结、不再重生成。
// 每一步 Swift 的回包（含 store 状态快照：整份状态、磁盘上每个键的原始字串、status）校验和必须与 JS 相同：
//   · JS → Swift：backup.restore 的输入是 JS 导出的文件（v2 的 24 份状态，含 v2 / v3 / v4 墨迹、折叠月；另有 v1 旧备份 300 字）；
//   · Swift → JS：Swift backup.export 的文本与 JS 导出的逐字节相同（JS 恢复它 = JS 恢复自己的文件，夹具里的第 2 步就是 JS 跑的结果）。

final class BackupRoundTripTests: XCTestCase {
    func testBackupRoundTripFixturesBothWays() throws {
        let doc = try loadFixture("backup-roundtrip")
        let cases = doc["cases"]!.arrayValue!
        XCTAssertGreaterThanOrEqual(cases.count, 26)
        var exports = 0, restores = 0
        for c in cases {
            let label = c["label"]!.stringValue!
            let fileText = try c["inputFile"]?.stringValue.map { try readRepoFile($0) }
            let engine = CoreEngine(timeZone: shanghaiTZ)
            var lastExport: JSValue = .null
            for step in c["steps"]!.arrayValue! {
                var req = step["req"]!.objectValue!
                if case .object(var args)? = req["args"] {
                    if args["input"] == .string("@file") { args["input"] = .string(fileText!) }
                    if args["input"] == .string("@export") { args["input"] = lastExport }
                    req["args"] = .object(args)
                }
                let line = engine.handle(line: JSONWriter.stringify(.object(req)))
                let res = J(line)
                let op = req["op"]!.stringValue!
                if op == "backup.export" {
                    XCTAssertEqual(res["reply"]?.stringValue, step["reply"]?.stringValue, "\(label): Swift export == JS export (byte-equal)")
                    lastExport = res["reply"] ?? .null
                    exports += 1
                }
                if op == "backup.restore" {
                    XCTAssertEqual(str(res["reply"] ?? .null), str(step["result"]!), "\(label): restore result")
                    restores += 1
                }
                XCTAssertEqual(NativeChecksum.checksum(line), step["resSum"]!.stringValue!, "\(label) \(op): reply + state snapshot")
            }
        }
        XCTAssertGreaterThanOrEqual(exports, 50)
        XCTAssertGreaterThanOrEqual(restores, 26)
    }
}
