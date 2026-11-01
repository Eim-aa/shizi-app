import Foundation
import SQLite3

// B4.9b：新装不再回落 WebEngine。
//
// 以前（B4.5c ~ B4.9a）库里的 store_meta 'migration' 不是 done 就整次启动用 WebEngine——新装也算，因为没有「没东西可迁」这一支。
// 结果每台全新模拟器、每个重装的 UI 测试都跑在回退引擎上。规则改在这里：启动选引擎之前先判一次旧数据，
//   旧数据确定没有（库里没有迁移标记、也没有任何行；WKWebView 的本源 localStorage 里没有 shizi.* 键）
//     → 原生走与 JS 同一条路径写「迁移完成」（import 0 行 → commitMigration；字段与 native-boot.js 迁空 localStorage 时一致）→ SwiftEngine；
//   有旧数据，或判不准（目录读不出、文件打不开、没见过的文件形状）→ 一律当作有 → 这一次仍用 WebEngine 迁移（旧版升级路径不变）。
// 判不准按「有」处理：多跑一次 WebEngine 只是慢一点，误判「没有」则会丢用户的旧数据。

enum LegacyStorageVerdict: Equatable {
    case none      // 确定没有
    case present   // 有 shizi.* 键
    case unsure    // 判不准（按有处理）
}

enum LegacyStorageProbe {
    /// WKWebView 的 localStorage 在 App 容器的 Library/WebKit 下，位置随系统版本不同：
    ///   Library/WebKit/<bundleId>/WebsiteData/Default/<hash>/<hash>/LocalStorage/localstorage.sqlite3（现行）
    ///   Library/WebKit/WebsiteData/LocalStorage/<origin>.localstorage（旧布局，也是 sqlite）
    /// 所以不写死路径：整棵 Library/WebKit 里凡是在名为 LocalStorage 的目录下的文件都看。
    static func probe(libraryURL: URL, fileManager fm: FileManager = .default) -> LegacyStorageVerdict {
        let root = libraryURL.appendingPathComponent("WebKit", isDirectory: true)
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: root.path, isDirectory: &isDir) else { return .none }
        guard isDir.boolValue else { return .unsure }
        var failed = false
        guard let walker = fm.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [], errorHandler: { _, _ in failed = true; return true }) else { return .unsure }
        var verdict = LegacyStorageVerdict.none
        for case let url as URL in walker {
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? nil
            if isDirectory != false { continue }
            guard url.pathComponents.dropLast().contains("LocalStorage") else { continue }
            let name = url.lastPathComponent.lowercased()
            if name.hasSuffix("-wal") || name.hasSuffix("-shm") || name.hasSuffix("-journal") { continue } // 由主库文件一并读
            guard name.hasSuffix(".sqlite3") || name.hasSuffix(".localstorage") else { return .unsure } // 没见过的形状
            switch shiziKeyCount(in: url) {
            case let n? where n > 0: return .present
            case 0?: break
            default: verdict = .unsure
            }
        }
        return failed ? .unsure : verdict
    }

    /// 该 localStorage 库里 shizi.* 键的个数；打不开 / 没有 ItemTable / 查不动 → nil（判不准）。
    static func shiziKeyCount(in file: URL) -> Int? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(file.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            sqlite3_close_v2(db)
            return nil
        }
        defer { sqlite3_close_v2(db) }
        sqlite3_busy_timeout(db, 500)
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM ItemTable WHERE key LIKE 'shizi.%'", -1, &stmt, nil) == SQLITE_OK, let stmt else { return nil }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return Int(sqlite3_column_int64(stmt, 0))
    }
}

extension NativeStore {
    /// 启动选引擎前调一次：库的迁移标记是 done → true；没做完时，只有「库里没标记、没行，且旧 localStorage 确定没有」才由原生
    /// 走 import（0 行）→ commitMigration 置 done（与 JS 迁空 localStorage 同一条路径，同样的 count 0 / 空摘要 / source localStorage）→ true；
    /// 其它一律 false（库读不出也是 false，交 WebEngine 那条路去处理）。
    func settleMigrationForLaunch(legacy: () -> LegacyStorageVerdict) -> Bool {
        do {
            if let m = try migration() {
                return m.state == "done"
            }
            guard try digestOfRows().count == 0, legacy() == .none else { return false }
            let empty = Self.digest([])
            _ = try importRows([], count: 0, digest: empty.digest, source: "localStorage")
            return try commitMigration(count: 0, digest: empty.digest).state == "done"
        } catch {
            return false
        }
    }
}
