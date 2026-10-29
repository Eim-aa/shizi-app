// B4.10 等价性测试：pack.data(for: 字) 与 data/<字>.json 逐字节相同（docs/engineering/v10/B4.10-笔顺打包.md）。
//
// pack 的来源：本测试读仓库根的 build/strokes.pack（由 node scripts/stroke-pack/build.mjs 预先构建），
// **不在测试里调 node**；文件缺失时 XCTSkip 并写明生成命令。
// data/ 里哪些文件算笔顺文件：与构建器同一规则——文件名去掉 .json 后恰好一个 Unicode 码点
// （src/data/strokes.js 的 strokesURL / isSingleChar 与 NativeGlyph.swift 同一命名）。

import XCTest
import Foundation
@testable import ShiziStrokePack

final class StrokePackTests: XCTestCase {
    // <仓库根>/ios/ShiziCore/Tests/ShiziStrokePackTests/本文件 → 上推 4 层到仓库根。
    private static let repoRoot = URL(fileURLWithPath: (#filePath as NSString).deletingLastPathComponent)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    private static let dataDirectory = repoRoot.appendingPathComponent("data", isDirectory: true)
    private static let packURL = repoRoot.appendingPathComponent("build/strokes.pack")

    /// data/ 里的每字笔顺文件（与 scripts/stroke-pack/build.mjs 的 isStrokeFileName 同一规则）。
    private static var characterFiles: [(char: String, url: URL)] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dataDirectory.path)) ?? []
        return names.filter { name in
            guard name.hasSuffix(".json") else { return false }
            return name.dropLast(".json".count).unicodeScalars.count == 1
        }
        .sorted()
        .map { name in (String(name.dropLast(5)), dataDirectory.appendingPathComponent(name)) }
    }

    /// 打开现成的 pack；缺文件时 XCTSkip（先 `node scripts/stroke-pack/build.mjs`）。
    private func makePack(file: StaticString = #filePath, line: UInt = #line) throws -> StrokePack {
        guard FileManager.default.fileExists(atPath: Self.packURL.path) else {
            throw XCTSkip("build/strokes.pack 不存在——先运行 node scripts/stroke-pack/build.mjs 再跑本测试（本测试读现成 pack，不在测试里调 node）")
        }
        guard let pack = StrokePack(url: Self.packURL) else {
            XCTFail("build/strokes.pack 打不开或格式不对", file: file, line: line)
            throw XCTSkip("pack 无法打开")
        }
        return pack
    }

    func testPackCountMatchesCharacterFileCount() throws {
        let pack = try makePack()
        XCTAssertEqual(pack.count, Self.characterFiles.count)
        XCTAssertEqual(pack.count, 7218)
    }

    /// 主门禁：**每一个**字 pack.data(for:) == data/<字>.json，逐字节。
    func testEveryCharacterFileRoundTripsByteForByte() throws {
        let pack = try makePack()
        let files = Self.characterFiles
        XCTAssertEqual(files.count, pack.count)
        var mismatches: [String] = []
        for (char, url) in files {
            let fileData = try Data(contentsOf: url)
            guard let packData = pack.data(for: char) else {
                mismatches.append("\(char): pack 查不到")
                continue
            }
            if packData != fileData {
                mismatches.append("\(char): \(packData.count) B ≠ 文件 \(fileData.count) B")
            }
        }
        XCTAssertTrue(mismatches.isEmpty, "round-trip 不一致 \(mismatches.count) 处：\(mismatches.prefix(10))")
    }

    func testSupplementaryPlaneCharactersRoundTrip() throws {
        let pack = try makePack()
        for char in ["𬇕", "𬜯"] {
            let url = Self.dataDirectory.appendingPathComponent("\(char).json")
            let fileData = try Data(contentsOf: url)
            XCTAssertEqual(pack.data(for: char), fileData, char)
        }
    }

    func testUnknownCharactersReturnNil() throws {
        let pack = try makePack()
        // 不在库里的单码点（建 pack 时核实过 data/ 没有这些文件）、空串、多码点、双字。
        for char in ["A", "Z", "?", "龥", "㐀", "𠀀", "", "一二", "e\u{301}"] {
            XCTAssertNil(pack.data(for: char), "「\(char)」应无数据")
        }
    }

    /// 1,000 个随机字的查找计时（打印供文档记录；不做紧的时间断言，只查所有命中）。
    func testLookupTimingFor1000RandomCharacters() throws {
        let pack = try makePack()
        let chars = Self.characterFiles.map(\.char)
        XCTAssertEqual(chars.count, pack.count)
        var state: UInt64 = 0x2026_1030 // 固定种子，可复现
        func next() -> Int {
            state &*= 0x9E37_79B9_7F4A_7C15
            state ^= state >> 29
            state &*= 0xBF58_476D_1CE4_E5B9
            return Int(state >> 33) % chars.count
        }
        _ = pack.data(for: chars[0]) // 预热
        let start = Date()
        for _ in 0..<1000 {
            XCTAssertNotNil(pack.data(for: chars[next()]))
        }
        let elapsed = Date().timeIntervalSince(start)
        print(String(format: "B4.10 timing: 1000 random lookups in %.2f ms (%.2f µs per lookup)",
                     elapsed * 1000, elapsed * 1000))
        XCTAssertLessThan(elapsed, 5.0, "1,000 次二分查找不应需要秒级")
    }

    /// 并发读：struct 不可变 + 只读映射，多线程同时取不同字应全部正确。
    /// （concurrentPerform 本身等全部迭代结束才返回，无需 expectation。）
    func testConcurrentReadsReturnCorrectBytes() throws {
        let pack = try makePack()
        let files = Self.characterFiles
        DispatchQueue.concurrentPerform(iterations: 256) { i in
            let (char, url) = files[i % files.count]
            guard let fileData = try? Data(contentsOf: url) else {
                XCTFail("读 \(char) 失败")
                return
            }
            if pack.data(for: char) != fileData {
                XCTFail("并发读 \(char) 不一致")
            }
        }
    }

    // ---- 打不开的 pack：init?(url:) 返回 nil ----

    private static func header(count: UInt32, dataOffset: UInt32) -> Data {
        var data = Data()
        data.append(contentsOf: StrokePack.magic)           // 0..4
        data.append(contentsOf: [0x01, 0x00])               // version 1
        data.append(contentsOf: [20, 0])                    // entrySize 20
        data.append(contentsOf: [UInt8(truncatingIfNeeded: count),
                                 UInt8(truncatingIfNeeded: count >> 8),
                                 UInt8(truncatingIfNeeded: count >> 16),
                                 UInt8(truncatingIfNeeded: count >> 24)])
        data.append(contentsOf: [UInt8(truncatingIfNeeded: dataOffset),
                                 UInt8(truncatingIfNeeded: dataOffset >> 8),
                                 UInt8(truncatingIfNeeded: dataOffset >> 16),
                                 UInt8(truncatingIfNeeded: dataOffset >> 24)])
        return data
    }

    /// 一条索引：key（右补 0 到 8 字节）+ offset（u64le）+ length（u32le）。
    private static func entry(_ char: String, offset: UInt64, length: UInt32) -> Data {
        var bytes = Array(char.utf8)
        bytes.append(contentsOf: [UInt8](repeating: 0, count: StrokePack.keyBytes - bytes.count))
        for shift in stride(from: 0, through: 56, by: 8) { // 小端：低字节在前
            bytes.append(UInt8(truncatingIfNeeded: offset >> UInt64(shift)))
        }
        for shift in stride(from: 0, through: 24, by: 8) {
            bytes.append(UInt8(truncatingIfNeeded: length >> UInt32(shift)))
        }
        return Data(bytes)
    }

    /// 两条目的 pack：数据区 "12345678"，第一条 offset 56 len 2（"12"），第二条 offset 58 len 2（"34"）。
    private static func twoEntryPack(first: String, second: String) -> Data {
        var data = header(count: 2, dataOffset: 56)
        data.append(entry(first, offset: 56, length: 2))
        data.append(entry(second, offset: 58, length: 2))
        data.append(contentsOf: Array("12345678".utf8))
        return data
    }

    private func writeTemp(_ data: Data) -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("stroke-pack-\(UUID().uuidString)")
        try? data.write(to: url)
        return url
    }

    private func withTempPack(_ data: Data, _ body: (URL) -> Void) {
        let url = writeTemp(data)
        defer { try? FileManager.default.removeItem(at: url) }
        body(url)
    }

    func testWellFormedTinyPackOpens() {
        withTempPack(Self.twoEntryPack(first: "一", second: "丁")) { url in
            let pack = StrokePack(url: url)
            XCTAssertEqual(pack?.count, 2)
            XCTAssertEqual(pack?.data(for: "一"), Data("12".utf8))
            XCTAssertEqual(pack?.data(for: "丁"), Data("34".utf8))
            XCTAssertNil(pack?.data(for: "丄"))
            XCTAssertNil(pack?.data(for: "A"))
        }
    }

    func testMalformedPacksFailToOpen() {
        let good = Self.twoEntryPack(first: "一", second: "丁")

        var bad = good
        bad[0] = 0x58 // magic 错
        withTempPack(bad) { XCTAssertNil(StrokePack(url: $0), "magic 错应返回 nil") }

        bad = good
        bad[4] = 0x02 // version 2
        withTempPack(bad) { XCTAssertNil(StrokePack(url: $0), "版本不认识应返回 nil") }

        bad = good
        bad[6] = 0 // entrySize 0
        withTempPack(bad) { XCTAssertNil(StrokePack(url: $0), "entrySize 0 应返回 nil") }

        bad = good
        bad[8] = 5 // count 5，dataOffset 不再一致、文件也装不下
        withTempPack(bad) { XCTAssertNil(StrokePack(url: $0), "count 与文件不符应返回 nil") }

        bad = good
        bad[24] = 0xFF // 第一条的 offset 越过文件尾（文件只有 64 字节，offset 变 255）
        withTempPack(bad) { XCTAssertNil(StrokePack(url: $0), "offset 越界应返回 nil") }

        withTempPack(Data([0x53, 0x5A])) { XCTAssertNil(StrokePack(url: $0), "截断文件应返回 nil") }

        XCTAssertNil(StrokePack(url: FileManager.default.temporaryDirectory
            .appendingPathComponent("stroke-pack-不存在-\(UUID().uuidString)")), "文件不存在应返回 nil")
    }

    /// 索引乱序（二分的前提被破坏）应拒绝打开；同一结构正序则能打开。
    func testIndexOrderValidation() {
        withTempPack(Self.twoEntryPack(first: "丁", second: "一")) { url in
            XCTAssertNil(StrokePack(url: url), "索引乱序应返回 nil")
        }
        withTempPack(Self.twoEntryPack(first: "一", second: "丁")) { url in
            XCTAssertEqual(StrokePack(url: url)?.count, 2)
        }
    }
}
