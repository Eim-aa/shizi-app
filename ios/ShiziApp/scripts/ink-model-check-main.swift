// macOS 命令行入口：编译 ShiziApp/InkModel.swift + InkModelCheck.swift，对 vectors.json 跑笔锋模型金标准自检并与参考实现逐值比较。
// 由 ink-model-check.sh 调用；参数：<vectors.json> [reference-dump.json] [--json out.json]
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard let vectorsPath = args.first, let vectors = FileManager.default.contents(atPath: vectorsPath) else {
    FileHandle.standardError.write(Data("usage: ink-model-check <vectors.json> [reference-dump.json] [--json out.json]\n".utf8))
    exit(64)
}
let reference = args.count > 1 && !args[1].hasPrefix("--") ? FileManager.default.contents(atPath: args[1]) : nil
let report = InkModelCheck.run(vectorsData: vectors, referenceData: reference)
for row in report.rows { print(row) }
for f in report.fails { print("FAIL", f) }
for f in report.refMismatches { print("REF ", f) }
print(report.summary)
if let i = args.firstIndex(of: "--json"), i + 1 < args.count,
   let data = try? JSONSerialization.data(withJSONObject: report.json, options: [.prettyPrinted, .sortedKeys]) {
    FileManager.default.createFile(atPath: args[i + 1], contents: data)
}
exit(report.ok ? 0 : 1)
