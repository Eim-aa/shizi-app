// 笔顺数据只读打包读取器（B4.10，docs/engineering/v10/B4.10-笔顺打包.md）。
//
// data/<字>.json（7,218 个小文件，hanzi-writer 格式）原样拼进一个 pack 文件 + 排序索引；
// 构建器是 node scripts/stroke-pack/build.mjs（--check 守逐字节等价）。本卡只交付读取器与等价性证明，
// App 接入（Bundle 里放 pack、NativeGlyph / Web 换读取路径）是后续卡。
//
// 格式（版本 1）：
//   头部 16 字节：magic "SZPK"｜version u16le＝1｜entrySize u16le＝20｜count u32le｜dataOffset u32le
//   索引 count 条、每条 entrySize 字节、按 key 的 UTF-8 字节升序（UTF-8 字节序＝码点序，
//   且单码点 key 互不为前缀）：key 8 字节（UTF-8，右侧 0 填充——合法 UTF-8 不含 0x00，
//   填充不改字节序与相等性）｜offset u64le（数据区绝对偏移）｜length u32le
//   数据区：各 JSON 文件的原始字节逐文件拼接（不重编码）。
//
// 线程安全：struct 全部字段 init 后不可变，文件按 .alwaysMapped 只读映射，
// data(for:) 只做二分 + 只读范围拷贝，多线程并发读无需加锁。

import Foundation

public struct StrokePack {
    /// 布局常量（版本 1 定死；init 里与头部字段逐一对账）。
    static let magic: [UInt8] = Array("SZPK".utf8)
    static let version: UInt16 = 1
    static let headerBytes = 16
    static let keyBytes = 8 // 单个码点的 UTF-8 最长 4 字节
    static let entryBytes = keyBytes + 8 + 4

    private let file: Data // .alwaysMapped，只读
    private let countValue: Int
    private let entrySize: Int

    public var count: Int { countValue }

    /// 打开一个 pack。文件缺失、magic / 版本 / 布局对不上、索引越界或乱序都返回 nil
    /// （索引校验是 init 时一次 O(count) 扫描，之后每次查找只需二分）。
    public init?(url: URL) {
        guard let file = try? Data(contentsOf: url, options: .alwaysMapped),
              file.count >= Self.headerBytes
        else { return nil }
        let header = Self.bytes(file, 0, Self.headerBytes)
        guard Self.elementsEqual(header[0..<4], Self.magic),
              Self.u16le(header, 4) == Self.version,
              let entrySize = Self.u16intle(header, 6), entrySize >= Self.entryBytes,
              let count = Self.u32intle(header, 8),
              let dataOffset = Self.u32intle(header, 12),
              dataOffset == Self.headerBytes + count * entrySize,
              file.count >= dataOffset
        else { return nil }
        // 索引自检：key 严格升序（二分正确性的前提）、每条数据区落在文件内。
        var previousKey: [UInt8]?
        for i in 0..<count {
            let at = Self.headerBytes + i * entrySize
            let key = Self.bytes(file, at, Self.keyBytes)
            guard let offset = Self.readU64(file, at + Self.keyBytes),
                  let length = Self.readU32(file, at + Self.keyBytes + 8),
                  offset >= dataOffset, length <= file.count - offset
            else { return nil }
            if let previousKey, !Self.lexicographic(previousKey, key) { return nil }
            previousKey = key
        }
        self.file = file
        self.countValue = count
        self.entrySize = entrySize
    }

    /// 取一个字的原始 JSON 字节（与 data/<字>.json 逐字节相同）。非单个码点的输入返回 nil。
    public func data(for char: String) -> Data? {
        guard let key = Self.key(for: char) else { return nil }
        var lower = 0
        var upper = countValue
        while lower < upper {
            let mid = lower + (upper - lower) / 2
            let at = Self.headerBytes + mid * entrySize
            switch Self.compare(file, at, to: key) {
            case .equal:
                guard let offset = Self.readU64(file, at + Self.keyBytes),
                      let length = Self.readU32(file, at + Self.keyBytes + 8),
                      length <= file.count - offset else { return nil }
                return file.subdata(in: offset..<(offset + length))
            case .before: // 索引条目 < 查询 key
                lower = mid + 1
            case .after:
                upper = mid
            }
        }
        return nil
    }

    // ---- 字节读取（显式小端，不依赖主机字节序） ----

    enum Ordering { case before, equal, after }

    static func bytes(_ data: Data, _ at: Int, _ n: Int) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: n)
        data.withUnsafeBytes { raw in
            for i in 0..<n { out[i] = raw[raw.startIndex + at + i] }
        }
        return out
    }

    static func u16le(_ bytes: [UInt8], _ at: Int) -> UInt16 {
        UInt16(bytes[at]) | UInt16(bytes[at + 1]) << 8
    }

    static func u16intle(_ bytes: [UInt8], _ at: Int) -> Int? {
        let value = u16le(bytes, at)
        return value > 0 ? Int(value) : nil
    }

    // 条目字段直接从文件读（内部先拷出对应字节再解析）。
    static func readU32(_ data: Data, _ at: Int) -> Int? { u32intle(bytes(data, at, 4), 0) }
    static func readU64(_ data: Data, _ at: Int) -> Int? { u64intle(bytes(data, at, 8), 0) }

    static func u32intle(_ bytes: [UInt8], _ at: Int) -> Int? {
        let value = UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8
            | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24
        return Int(exactly: value)
    }

    static func u64intle(_ bytes: [UInt8], _ at: Int) -> Int? {
        var value: UInt64 = 0
        for i in (0..<8).reversed() { value = value << 8 | UInt64(bytes[at + i]) }
        return Int(exactly: value)
    }

    /// 单个码点 → 右侧 0 填充到 keyBytes 的 UTF-8 key；输入不是恰好一个码点时为 nil。
    static func key(for char: String) -> [UInt8]? {
        guard char.unicodeScalars.count == 1 else { return nil }
        var bytes = Array(char.utf8)
        guard bytes.count <= keyBytes, !bytes.contains(0) else { return nil }
        bytes.append(contentsOf: repeatElement(0, count: keyBytes - bytes.count))
        return bytes
    }

    /// 文件内第 at 字节起的 keyBytes 字节与查询 key 的字节序。
    static func compare(_ data: Data, _ at: Int, to key: [UInt8]) -> Ordering {
        var order: Ordering = .equal
        data.withUnsafeBytes { raw in
            for i in 0..<Self.keyBytes {
                let a = raw[raw.startIndex + at + i]
                let b = key[i]
                if a != b {
                    order = a < b ? .before : .after
                    return
                }
            }
        }
        return order
    }

    static func elementsEqual(_ lhs: ArraySlice<UInt8>, _ rhs: [UInt8]) -> Bool {
        lhs.count == rhs.count && zip(lhs, rhs).allSatisfy(==)
    }

    static func lexicographic(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        for i in 0..<min(a.count, b.count) {
            if a[i] != b[i] { return a[i] < b[i] }
        }
        return a.count <= b.count
    }
}
