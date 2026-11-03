import Foundation

// src/core/backup.js 的 1:1 移植（B4.4）：备份文件的构造 / 解析报告、记录签名、丢失范围、状态句，以及保护副本编排
// （写副本 → 替换 → 撤销 / 清空 / 导出记账，全部经 Store 的公开原语，且不做预算回收）。回包形状与 JS 逐字段相同。
// 文件格式不变（{app:'shizi', version:2, date, data:{'shizi.v2.<键>': JSON 字串}}，墨迹按月分组）：Swift 导出的备份 JS 能导入，反之亦然。

public enum Backup {
    /// 备份文件大小上限（字节），与 iOS 原生预检同口径。
    public static let maxBytes = 64.0 * 1024 * 1024
    public static let safetyVersion = 2.0

    public static let labels: [String: String] = [
        "safety": "backup:safety", "safetyDrop": "backup:safety-drop", "restore": "backup:restore",
        "clear": "backup:clear", "undo": "backup:undo", "exported": "backup:exported",
    ]

    // MARK: 记录口径

    static func monthList(_ v: JSValue?) -> [JSValue] { Budget.monthRecords(v) }
    static func isFoldedMonth(_ v: JSValue?) -> Bool { Budget.isFolded(v) }

    /// records 域里有 judged 记录的字（含折叠月的 chars 与 kept）。
    public static func judgedCharsOf(_ records: JSValue?) -> KeySet {
        var out = KeySet()
        for (_, value) in records?.objectValue?.entries ?? [] {
            if isFoldedMonth(value), case .array(let chars)? = value["chars"] {
                for c in chars { if case .string(let s) = c { out.insert(s) } }
            }
            for r in monthList(value) where r["kind"] == .string("judged") {
                if case .string(let ch)? = r["char"] { out.insert(ch) }
            }
        }
        return out
    }

    /// 有 judged 记录的本地日（升序去重；含折叠月的 byDay）。
    public static func judgedDaysOf(_ records: JSValue?) -> [String] {
        var days = KeySet()
        for (_, value) in records?.objectValue?.entries ?? [] {
            if isFoldedMonth(value), case .object(let byDay)? = value["byDay"] {
                for d in byDay.keys where Schema.isLocalDay(d) { days.insert(d) }
            }
            for r in monthList(value) where r["kind"] == .string("judged") {
                if let d = r["localDay"], Schema.isLocalDay(d), case .string(let s) = d { days.insert(s) }
            }
        }
        return UTF16Order.sorted(days.items)
    }

    /// 「现在的记录」的签名：`${judged 条数}:${FNV-1a 32}`（按 UTF-16 码元喂）。
    public static func recordsSignature(_ records: JSValue?) -> String {
        let obj = records?.objectValue ?? JSObject()
        let months = UTF16Order.sorted(obj.keys)
        var count = 0
        var hash: UInt32 = 0x811c9dc5
        func feed(_ text: String) {
            for u in text.utf16 {
                hash ^= UInt32(u)
                hash = hash &* 0x01000193
            }
        }
        for month in months {
            let value = obj[month]
            if isFoldedMonth(value) {
                let n = value?["chars"]?.arrayValue?.count ?? 0
                feed("F" + month + ":" + String(n) + ";")
            }
            for r in monthList(value) {
                guard case .object = r, r["kind"] == .string("judged") else { continue }
                count += 1
                feed(JS.string(r["id"]) + (r["judgment"] == .string("wrong") ? "W" : "R") + ";")
            }
        }
        return String(count) + ":" + NativeChecksum.hex8(hash)
    }

    // MARK: 状态 → 备份条目 / 文件

    /// 状态里的白名单键 → [(key, JSON 字串)]（空月份、null 域不出现）。
    public static func backupEntries(_ state: JSObject) -> [(String, String)] {
        var out: [(String, String)] = []
        for domain in Schema.backupWhitelist {
            guard let value = state[domain] else { continue }
            if Schema.isMonthlyDomain(domain) {
                guard case .object(let o) = value else { continue }
                for month in UTF16Order.sorted(o.keys) {
                    let v = o[month]!
                    if v.isNull { continue }
                    if case .array(let a) = v, a.isEmpty { continue }
                    if case .object(let x) = v, x["folded"] != .bool(true), x.isEmpty { continue }
                    out.append(((try? Schema.keyForDomain(domain, month: month)) ?? "", JSONWriter.stringify(v)))
                }
            } else if !value.isNull {
                out.append(((try? Schema.keyForDomain(domain, month: nil)) ?? "", JSONWriter.stringify(value)))
            }
        }
        return out
    }

    static func recordMonths(_ state: JSObject) -> [String] {
        let records = state["records"]?.objectValue ?? JSObject()
        return UTF16Order.sorted(records.keys.filter { m in
            Schema.isMonthKey(m) && monthList(records[m]).count + (isFoldedMonth(records[m]) ? 1 : 0) > 0
        })
    }

    /// v2 备份文件对象。state.meta 缺失时补一份。
    public static func buildBackupV2(_ state: JSObject, now at: Double, serial: Double = 0) throws -> JSObject {
        var data = JSObject()
        for (k, raw) in backupEntries(state) { data[k] = .string(raw) }
        if data[Schema.metaKey] == nil {
            let s = serial.isFinite && serial.rounded(.towardZero) == serial && serial >= 0 ? serial : 0
            data[Schema.metaKey] = .string(JSONWriter.stringify(.object(JSObject([
                ("schema", .number(Double(Schema.schemaVersion))), ("serial", .number(s)), ("createdAt", .number(at)),
                ("months", .array(recordMonths(state).map { .string($0) })),
            ]))))
        }
        return JSObject([("app", .string(Schema.appID)), ("version", .number(Double(Schema.backupVersion))), ("date", .string(try JSDate.isoString(at))), ("data", .object(data))])
    }

    /// 文件文本（JSON.stringify(obj, null, 1)）。
    public static func serializeBackup(_ obj: JSValue) -> String {
        var out = ""
        pretty(obj, indent: "", into: &out)
        return out
    }

    static func pretty(_ v: JSValue, indent: String, into out: inout String) {
        switch v {
        case .array(let a):
            if a.isEmpty { out += "[]"; return }
            let inner = indent + " "
            out += "[\n"
            for (i, e) in a.enumerated() {
                out += inner
                pretty(e, indent: inner, into: &out)
                out += i == a.count - 1 ? "\n" : ",\n"
            }
            out += indent + "]"
        case .object(let o):
            if o.isEmpty { out += "{}"; return }
            let inner = indent + " "
            out += "{\n"
            let entries = o.entries
            for (i, e) in entries.enumerated() {
                out += inner
                JSONWriter.quote(e.key, into: &out)
                out += ": "
                pretty(e.value, indent: inner, into: &out)
                out += i == entries.count - 1 ? "\n" : ",\n"
            }
            out += indent + "}"
        default:
            out += JSONWriter.stringify(v)
        }
    }

    /// 文件名「拾字备份-YYYY-MM-DD.json」。
    public static func backupFileName(_ now: Double, dates: Dates) throws -> String {
        try Copy.text("X-BACKUP.fileName", JSObject([("ymd", .string(try dates.localDay(.number(now))))]))
    }

    // MARK: v1 备份文件

    /// v1 → v2 的备份转换器（store/migrate.js 在 JS 里加载时注册；Swift 缺省就是 Migrate.legacyBackupToV2）。nil = 未注册（v1-unsupported）。
    public static var legacyImporter: ((JSObject, Double?) -> JSValue)? = { obj, now in Migrate.legacyBackupToV2(.object(obj), now: now) }

    /// v1 备份 → {ok:true, backup, report} | {ok:false, reason, key?, detail?}。
    public static func importLegacyBackup(_ input: JSValue, now: Double? = nil) -> JSValue {
        func bad(_ reason: String) -> JSValue { .object(JSObject([("ok", .bool(false)), ("reason", .string(reason))])) }
        var obj = input
        if case .string(let text) = input {
            guard let v = try? JSONParser.parse(text) else { return bad("json") }
            obj = v
        }
        guard case .object(let o) = obj, JS.isString(o["app"], Schema.appID), o["version"] == .number(1), case .object = o["data"] else { return bad("format") }
        guard let importer = legacyImporter else { return bad("v1-unsupported") }
        let result = importer(o, now)
        guard result["ok"] == .bool(true), case .object? = result["backup"] else {
            var out = JSObject([("ok", .bool(false))])
            if let r = result["reason"], JSX.truthy(r) { out["reason"] = r } else { out["reason"] = .string("v1-failed") }
            if case .string(let k)? = result["key"] { out["key"] = .string(k) }
            return .object(out)
        }
        let report: JSValue = { if case .object? = result["report"] { return result["report"]! }; return .null }()
        return .object(JSObject([("ok", .bool(true)), ("backup", result["backup"]!), ("report", report)]))
    }

    // MARK: 导入校验报告

    /// 失败原因 → 界面口径（R-B06）。
    public static func failureKind(_ reason: String) -> String {
        ["json", "format", "tooLarge", "invalid"].contains(reason) ? "notBackup" : "restoreFailed"
    }

    static func daysOfIso(_ iso: JSValue?, _ dates: Dates) -> String? {
        guard case .string(let s)? = iso else { return nil }
        let t = JSDate.parse(s, dates.timeZone)
        return t.isFinite ? try? dates.localDay(.number(t)) : nil
    }

    /// entries（已通过形状校验）→ 状态片段（只含白名单域）。
    public static func stateOfEntries(_ entries: [JSValue]) -> JSObject {
        var out = JSObject([("records", .object(JSObject())), ("ink", .object(JSObject()))])
        for e in entries {
            guard let pair = e.arrayValue, let key = pair.first?.stringValue, let raw = pair.last?.stringValue,
                  let spec = Schema.specForKey(key), let d = spec.domain, let value = try? JSONParser.parse(raw) else { continue }
            if Schema.isMonthlyDomain(d) {
                var m = out[d]?.objectValue ?? JSObject()
                m[Schema.monthOfKey(key)!] = value
                out[d] = .object(m)
            } else {
                out[d] = value
            }
        }
        return out
    }

    static func byteLength(_ text: String) -> Double { Double(text.utf8.count) }

    /// JS 正则 `\s`（WhiteSpace + LineTerminator）。
    static func isJSSpace(_ u: UInt16) -> Bool {
        switch u {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return (0x2000...0x200A).contains(u)
        }
    }

    /// `/"app"\s*:\s*"shizi"/.test(text)`。
    static func looksLikeShizi(_ text: String) -> Bool {
        let u = Array(text.utf16)
        let app = Array("\"app\"".utf16), shizi = Array("\"shizi\"".utf16)
        var i = 0
        while i + app.count <= u.count {
            if Array(u[i..<(i + app.count)]) == app {
                var j = i + app.count
                while j < u.count, isJSSpace(u[j]) { j += 1 }
                if j < u.count, u[j] == 0x3A {
                    j += 1
                    while j < u.count, isJSSpace(u[j]) { j += 1 }
                    if j + shizi.count <= u.count, Array(u[j..<(j + shizi.count)]) == shizi { return true }
                }
            }
            i += 1
        }
        return false
    }

    /// 校验一份备份文件（文本或已解析对象）并给出报告。不碰存储。
    public static func inspectBackup(_ input: JSValue, maxBytes limit: Double = maxBytes, dates: Dates) -> JSObject {
        func bad(_ reason: String, _ extra: [(String, JSValue)] = []) -> JSObject {
            JSObject([("ok", .bool(false)), ("reason", .string(reason)), ("kind", .string(failureKind(reason)))] + extra)
        }
        var obj = input
        if case .string(let text) = input {
            if Double(UTF16Order.length(text)) > limit || byteLength(text) > limit { return bad("tooLarge") }
            guard let v = try? JSONParser.parse(text) else { return looksLikeShizi(text) ? bad("damaged") : bad("json") }
            obj = v
        }
        guard case .object(let o0) = obj, JS.isString(o0["app"], Schema.appID), case .object = o0["data"] else { return bad("format") }
        var fromLegacy = false
        if o0["version"] == .number(1) {
            let legacy = importLegacyBackup(obj)
            guard legacy["ok"] == .bool(true) else { return bad(JS.string(legacy["reason"])) }
            obj = legacy["backup"]!
            fromLegacy = true
        }
        let parsed = Schema.parseBackupV2(obj)
        guard parsed["ok"] == .bool(true) else {
            var extra: [(String, JSValue)] = []
            if let k = parsed["key"], JSX.truthy(k) {
                let d = parsed["detail"]
                extra = [("key", k), ("detail", d.flatMap { JSX.truthy($0) ? $0 : nil } ?? .null)]
            }
            return bad(JS.string(parsed["reason"]), extra)
        }
        let entries = parsed["entries"]?.arrayValue ?? []
        let part = stateOfEntries(entries)
        let days = judgedDaysOf(part["records"])
        let latestDay = days.last
        var day = daysOfIso(obj["date"], dates)
        if day == nil { day = latestDay }
        if day == nil, case .number(let c)? = part["meta"]?["createdAt"], c.isFinite { day = try? dates.localDay(.number(c)) }
        return JSObject([
            ("ok", .bool(true)), ("version", obj["version"] ?? .null), ("backup", obj), ("entries", .array(entries)), ("ignored", parsed["ignored"] ?? .array([])),
            ("day", Store.opt(day)), ("count", .number(Double(judgedCharsOf(part["records"]).count))), ("days", .array(days.map { .string($0) })),
            ("latestDay", Store.opt(latestDay)), ("fromLegacy", .bool(fromLegacy)),
        ])
    }

    // MARK: 替换确认

    /// 替换会丢掉哪段日子：现在的 judged 记录里晚于备份日期的那些天；没有 → null。
    public static func lossRange(_ records: JSValue?, _ backupDay: JSValue?) -> JSValue {
        guard let bd = backupDay, Schema.isLocalDay(bd), case .string(let b) = bd else { return .null }
        let later = judgedDaysOf(records).filter { UTF16Order.less(b, $0) }
        guard let first = later.first, let last = later.last else { return .null }
        return .object(JSObject([("from", .string(first)), ("to", .string(last)), ("days", .number(Double(later.count)))]))
    }

    /// 确认框模型 {mode, day, n, m, loss}。
    public static func confirmModel(_ state: JSValue?, _ report: JSValue, showLoss: Bool = true) -> JSObject {
        let m = judgedCharsOf(state?["records"]).count
        return JSObject([
            ("mode", .string(m > 0 ? "replace" : "restore")), ("day", report["day"] ?? .null), ("n", report["count"] ?? .null), ("m", .number(Double(m))),
            ("loss", m > 0 && showLoss ? lossRange(state?["records"], report["day"]) : .null),
        ])
    }

    // MARK: 状态句

    static func restoreConclusion(_ c: JSValue) -> JSValue {
        let day: JSValue = { if let d = c["date"], JSX.truthy(d) { return d }; return .null }()
        let n: JSValue = { if case .number(let d)? = c["count"], d.isFinite, d.rounded(.towardZero) == d { return .number(d) }; return .number(0) }()
        return .object(JSObject([("key", .string("R-B01.conclusionRestore")), ("vars", .object(JSObject([("day", day), ("n", n)])))]))
    }

    /// 备份页顶部状态块的模型 {date, lines, hasRecords, count, canExport, canClear}。
    public static func backupStatus(_ state: JSValue?, conclusion live: JSValue? = nil, dates: Dates) -> JSObject {
        let meta = state?["backupMeta"]?.objectValue ?? JSObject()
        let count = judgedCharsOf(state?["records"]).count
        let hasRecords = count > 0
        var exportedAt: Double? = nil
        if case .number(let d)? = meta["lastExportAt"], d.isFinite { exportedAt = d }
        let date: JSValue = exportedAt == nil ? .object(JSObject([("kind", .string("never"))]))
            : .object(JSObject([("kind", .string("day")), ("day", .string((try? dates.localDay(.number(exportedAt!))) ?? ""))]))
        var conclusion: JSValue? = nil
        if let l = live, JSX.truthy(l) { conclusion = l } else if case .object? = meta["lastConclusion"] { conclusion = meta["lastConclusion"] }
        var lines: [JSValue] = []
        func line(_ k: String) -> JSValue { .object(JSObject([("key", .string(k))])) }
        if !hasRecords {
            if let c = conclusion, c["kind"] == .string("clear") {
                lines.append(line("R-B01.conclusionClear"))
            } else {
                if let c = conclusion, c["kind"] == .string("restore") { lines.append(restoreConclusion(c)) }
                lines.append(line("R-B02.noRecords"))
            }
        } else if let c = conclusion, c["kind"] == .string("restore") {
            lines.append(restoreConclusion(c))
        } else if exportedAt != nil {
            let same: Bool = { if case .string(let s)? = meta["lastExportSig"] { return UTF16Order.eq(s, recordsSignature(state?["records"])) }; return false }()
            lines.append(line(same ? "R-B02.allBackedUp" : "R-B02.changedSince"))
        }
        return JSObject([("date", date), ("lines", .array(lines)), ("hasRecords", .bool(hasRecords)), ("count", .number(Double(count))),
                         ("canExport", .bool(hasRecords)), ("canClear", .bool(hasRecords))])
    }

    // MARK: 保护副本

    /// 保护副本对象（白名单键原始字串 + 现在的 sessions）。
    public static func makeSafety(_ state: JSObject, kind: String, now: Double, backupDate: JSValue? = nil, count: JSValue? = nil) -> JSObject {
        var payload = JSObject()
        for (k, raw) in backupEntries(state) { payload[k] = .string(raw) }
        if case .object? = state["sessions"] { payload[Schema.sessionsKey] = .string(JSONWriter.stringify(state["sessions"]!)) }
        let bd: JSValue = { if case .string? = backupDate { return backupDate! }; return .null }()
        let c: Double = { if case .number(let d)? = count, d.isFinite, d.rounded(.towardZero) == d, d >= 0 { return d }; return 0 }()
        return JSObject([("version", .number(safetyVersion)), ("kind", .string(kind)), ("createdAt", .number(now)), ("backupDate", bd), ("count", .number(c)), ("payload", .object(payload))])
    }

    /// 结束进行中的组（A / B 置 null，lastEnded 清空）；sessions 域不存在时不建。
    public static func endActiveSessions(_ draft: inout JSObject) {
        guard case .object(var s)? = draft["sessions"] else { return }
        let ended = s["lastEnded"]
        let noEnded: Bool = { if case .object(let o)? = ended { return o.isEmpty }; return true }()
        if s["A"] == .null && s["B"] == .null && noEnded { return }
        s["A"] = .null
        s["B"] = .null
        s["lastEnded"] = .object(JSObject())
        draft["sessions"] = .object(s)
    }

    /// 状态里的保护副本（没有 nil）。
    public static func safetyOf(_ state: JSObject) -> JSObject? {
        guard case .object(let s)? = state["safety"], case .object? = s["payload"] else { return nil }
        return s
    }

    /// 保护副本里的数据是否就是现在的数据。
    public static func safetyMatchesCurrent(_ state: JSObject) -> Bool {
        guard let safety = safetyOf(state), let payload = safety["payload"]?.objectValue else { return false }
        let now = backupEntries(state)
        let keys = payload.keys.filter { !UTF16Order.eq($0, Schema.sessionsKey) }
        if keys.count != now.count { return false }
        for (k, raw) in now { if !JS.isString(payload[k], raw) { return false } }
        return true
    }

    /// 由保护副本推出的结论（撤销底栏在时的状态句）。
    public static func conclusionOfSafety(_ safety: JSObject?, _ state: JSObject) -> JSValue {
        guard let s = safety else { return .null }
        if s["kind"] == .string("clear") { return .object(JSObject([("kind", .string("clear")), ("date", .null), ("count", .number(0))])) }
        if case .object(let meta)? = state["backupMeta"], case .object(let lc)? = meta["lastConclusion"], lc["kind"] == .string("restore") { return .object(lc) }
        let date: JSValue = { if let d = s["backupDate"], JSX.truthy(d) { return d }; return .null }()
        let count: JSValue = { if let c = s["count"], JSX.truthy(c) { return c }; return .number(0) }()
        return .object(JSObject([("kind", .string("restore")), ("date", date), ("count", count)]))
    }

    /// 写若干域且不做预算回收（reclaim:false），通知带 replace:true。
    public static func writeDomains(_ store: Store, _ patch: [(String, JSValue)], _ label: String) throws -> JSValue {
        for (d, _) in patch where !Schema.domains.contains(d) { throw CoreError.error("writeDomains: unknown domain " + d) }
        return store.commit(label, reclaim: false, replace: true) { draft, _ in
            for (d, v) in patch {
                if Schema.isMonthlyDomain(d), case .object = v { draft[d] = v } else if Schema.isMonthlyDomain(d) { draft[d] = .object(JSObject()) } else { draft[d] = v }
            }
        }
    }

    public static func writeSafety(_ store: Store, _ safety: JSObject) -> JSValue {
        (try? writeDomains(store, [("safety", .object(safety))], labels["safety"]!)) ?? .null
    }

    /// 删掉保护副本；没有副本时不写。
    public static func dropSafety(_ store: Store) -> JSValue {
        if safetyOf(store.state) == nil { return .object(JSObject([("ok", .bool(true)), ("keys", .array([]))])) }
        return (try? writeDomains(store, [("safety", .null)], labels["safetyDrop"]!)) ?? .null
    }

    static func errorOf(_ result: JSValue) -> JSValue {
        if let e = result["error"], JSX.truthy(e) { return e }
        return .object(JSObject([("kind", .string("unknown"))]))
    }

    static func backupMetaKeepingExport(_ cur: JSObject, _ conclusion: JSValue) -> JSValue {
        let at: JSValue = { if case .number(let d)? = cur["lastExportAt"], d.isFinite { return .number(d) }; return .null }()
        let sig: JSValue = { if case .string? = cur["lastExportSig"] { return cur["lastExportSig"]! }; return .null }()
        return .object(JSObject([("lastExportAt", at), ("lastExportSig", sig), ("lastConclusion", conclusion)]))
    }

    /// 用一份已校验的备份（inspectBackup 的成功结果）替换现在的记录：副本 → 替换 → {ok:true, conclusion}。
    public static func restoreFromBackup(_ store: Store, _ report: JSObject, now: Double) -> JSValue {
        let state = store.state
        let safety = makeSafety(state, kind: "restore", now: now, backupDate: report["day"], count: report["count"])
        let s = writeSafety(store, safety)
        guard s["ok"] == .bool(true) else { return .object(JSObject([("ok", .bool(false)), ("stage", .string("safety")), ("error", errorOf(s))])) }
        let dayV: JSValue = { if let d = report["day"], JSX.truthy(d) { return d }; return .null }()
        let conclusion = JSValue.object(JSObject([("kind", .string("restore")), ("date", dayV), ("count", report["count"] ?? .null)]))
        let backupMeta = backupMetaKeepingExport(state["backupMeta"]?.objectValue ?? JSObject(), conclusion)
        var data = JSObject()
        for e in report["entries"]?.arrayValue ?? [] {
            if let p = e.arrayValue, p.count == 2, let k = p[0].stringValue { data[k] = p[1] }
        }
        data[Schema.keyNamed("backupMeta")!] = .string(JSONWriter.stringify(backupMeta))
        var file = JSObject([("app", .string(Schema.appID)), ("version", .number(Double(Schema.backupVersion)))])
        if let b = report["backup"], JSX.truthy(b), let d = b["date"] { file["date"] = d }
        file["data"] = .object(data)
        let r = store.replaceWithBackup(.object(file), label: labels["restore"]!, mutate: { endActiveSessions(&$0) })
        guard r["ok"] == .bool(true) else {
            let drop = dropSafety(store)
            return .object(JSObject([("ok", .bool(false)), ("stage", .string("replace")), ("error", errorOf(r)), ("safetyDropped", .bool(JSX.truthy(drop["ok"])))]))
        }
        return .object(JSObject([("ok", .bool(true)), ("conclusion", conclusion)]))
    }

    /// 清空所有记录：副本 → 一次不回收的 commit。
    public static func clearAllRecords(_ store: Store, now: Double) -> JSValue {
        let state = store.state
        let count = Double(judgedCharsOf(state["records"]).count)
        let s = writeSafety(store, makeSafety(state, kind: "clear", now: now, backupDate: nil, count: .number(count)))
        guard s["ok"] == .bool(true) else { return .object(JSObject([("ok", .bool(false)), ("stage", .string("safety")), ("error", errorOf(s))])) }
        let conclusion = JSValue.object(JSObject([("kind", .string("clear")), ("date", .null), ("count", .number(count))]))
        let r = store.commit(labels["clear"]!, reclaim: false, replace: true) { draft, _ in
            draft["records"] = .object(JSObject())
            draft["ink"] = .object(JSObject())
            for d in ["sched", "custom", "wordOff", "photos", "legacy"] { draft[d] = .null }
            draft["backupMeta"] = backupMetaKeepingExport(draft["backupMeta"]?.objectValue ?? JSObject(), conclusion)
            endActiveSessions(&draft)
        }
        guard r["ok"] == .bool(true) else {
            let drop = dropSafety(store)
            return .object(JSObject([("ok", .bool(false)), ("stage", .string("clear")), ("error", errorOf(r)), ("safetyDropped", .bool(JSX.truthy(drop["ok"])))]))
        }
        return .object(JSObject([("ok", .bool(true)), ("conclusion", conclusion)]))
    }

    /// 撤销：用副本 payload 原样写回全部白名单域（及 sessions）并删副本——一次写入。
    public static func undoFromSafety(_ store: Store) -> JSValue {
        guard let safety = safetyOf(store.state), let payload = safety["payload"]?.objectValue else {
            return .object(JSObject([("ok", .bool(false)), ("error", .object(JSObject([("kind", .string("no-safety"))])))]))
        }
        var patch = KeyMap<JSValue>()
        patch["safety"] = .null
        for d in Schema.backupWhitelist { patch[d] = Schema.isMonthlyDomain(d) ? .object(JSObject()) : .null }
        for (key, raw) in payload.entries {
            guard Schema.isBackupKey(key), let spec = Schema.specForKey(key), let d = spec.domain, case .string(let text) = raw,
                  let value = try? JSONParser.parse(text) else { continue }
            if Schema.isMonthlyDomain(d) {
                var m = patch[d]?.objectValue ?? JSObject()
                m[Schema.monthOfKey(key)!] = value
                patch[d] = .object(m)
            } else {
                patch[d] = value
            }
        }
        if case .string(let text)? = payload[Schema.sessionsKey], let v = try? JSONParser.parse(text) { patch["sessions"] = v }
        let r = (try? writeDomains(store, patch.entries.map { ($0.0, $0.1) }, labels["undo"]!)) ?? .null
        if r["ok"] == .bool(true) { return .object(JSObject([("ok", .bool(true)), ("kind", safety["kind"] ?? .null)])) }
        return .object(JSObject([("ok", .bool(false)), ("error", errorOf(r))]))
    }

    /// 导出完成后记账：lastExportAt / lastExportSig，并清掉结论。
    public static func markExported(_ store: Store, at: Double, sig: String? = nil) -> JSValue {
        let signature = sig ?? recordsSignature(store.state["records"])
        return store.commit(labels["exported"]!) { draft, _ in
            draft["backupMeta"] = .object(JSObject([("lastExportAt", .number(at)), ("lastExportSig", .string(signature))]))
        }
    }
}

/// 备份页的文案小工具（src/ui/screens/mine/backup.js：dateText / lineText / undoLines / lossText / backupMenuStatus / NOTE_KEYS）。
public enum BackupText {
    public static let noteKeys: [(String, String)] = [("protectFailed", "R-B04.protectFailed"), ("notBackup", "R-B06.notBackup"), ("restoreFailed", "R-B06.restoreFailed")]

    public static func dateText(_ day: JSValue?, dates: Dates) throws -> String {
        guard let d = day, dates.isValidDay(d) else { return "" }
        return try Copy.text("R-H02.dateFormat", try dates.monthDayParts(d).objectValue)
    }

    public static func lineText(_ line: JSValue?, dates: Dates) throws -> String {
        guard let l = line, JSX.truthy(l), let key = l["key"]?.stringValue else { return "" }
        if key == "R-B01.conclusionRestore" {
            return try Copy.text(key, JSObject([("date", .string(try dateText(l["vars"]?["day"], dates: dates))), ("n", l["vars"].map { $0["n"] ?? .null } ?? .number(0))]))
        }
        return try Copy.text(key, l["vars"]?.objectValue)
    }

    public static func undoLines(_ kind: String, failed: Bool) throws -> [String] {
        if failed { return [try Copy.text(kind == "clear" ? "R-B05.undoFailedClear" : "R-B05.undoFailedRestore"), try Copy.text("R-B05.undoAgain")] }
        return kind == "clear" ? [try Copy.text("R-B01.clearUndoL1"), try Copy.text("R-B01.clearUndoL2")] : [try Copy.text("R-B01.undoL1"), try Copy.text("R-B01.undoL2")]
    }

    public static func lossText(_ loss: JSValue?, dates: Dates) throws -> String {
        guard let l = loss, JSX.truthy(l) else { return "" }
        if JS.strictEquals(l["from"], l["to"]) { return try Copy.text("X-BACKUP.lossDay", JSObject([("date", .string(try dateText(l["from"], dates: dates)))])) }
        return try Copy.text("X-BACKUP.lossRange", JSObject([("from", .string(try dateText(l["from"], dates: dates))), ("to", .string(try dateText(l["to"], dates: dates)))]))
    }

    public static func backupMenuStatus(_ state: JSValue?, dates: Dates) throws -> JSObject {
        let status = Backup.backupStatus(state, dates: dates)
        if status["date"]?["kind"] == .string("never") {
            return JSObject([("kind", .string("never")), ("day", .null), ("text", .string(try Copy.text("R-M03.noBackup")))])
        }
        let day = status["date"]?["day"] ?? .null
        return JSObject([("kind", .string("day")), ("day", day), ("text", .string(try Copy.text("R-M03.lastBackup", JSObject([("date", .string(try dateText(day, dates: dates)))]))))])
    }
}
