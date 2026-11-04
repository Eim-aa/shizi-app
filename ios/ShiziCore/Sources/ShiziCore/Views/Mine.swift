import Foundation

extension ViewSupport {
    struct RecordIndex {
        var judged: [JSValue]; var folded: JSObject; var days: KeySet; var ink: JSValue; var afterSeen: [JSValue]; var dates: Dates
        var works: [JSValue] {
            let all = afterSeen.isEmpty ? judged : Records.sortById(judged + afterSeen)
            return all.filter { WorkMembers.isWorkMember($0, hasInk: { InkPick.storedInkPresent(.object(JSObject([("ink", ink)])), $0, timeZone: dates.timeZone) }) }
        }
        var js: JSValue { ViewSupport.obj([("judged", .array(judged)), ("folded", .object(folded)), ("days", .array(days.items.map(JSValue.string))), ("ink", ink), ("afterSeen", .array(afterSeen))]) }
    }
    static func recordIndex(_ state: JSValue, dates: Dates) -> RecordIndex {
        let records = Query.flattenRecords(state["records"]), judged = Records.sortById(records.filter(Records.isJudged))
        var folded = JSObject(), days = KeySet()
        for (month, value) in state["records"]?.objectValue?.entries ?? [] where value["folded"] == .bool(true) {
            var byDay = JSObject()
            for (day, chars) in value["byDay"]?.objectValue?.entries ?? [] where dates.isValidDay(.string(day)) && !(chars.arrayValue ?? []).isEmpty { byDay[day] = chars; days.insert(day) }
            var f = JSObject([("byDay", .object(byDay)), ("chars", .array(value["chars"]?.arrayValue ?? []))])
            for key in ["paperOnly", "work", "workJudged"] { if let v = value[key], v.objectValue != nil || v.arrayValue != nil { f[key] = v } }
            if let kept = value["kept"]?.arrayValue { f["kept"] = .array(kept) }; folded[month] = .object(f)
        }
        for r in judged where dates.isValidDay(r["localDay"] ?? .null) { days.insert(JS.string(r["localDay"])) }
        let ink = state["ink"]?.objectValue != nil ? state["ink"]! : .null
        let seen = Records.sortById(records.filter { $0["kind"] == .string("answer-seen") && Records.isAfterSeenWork($0, { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }) })
        return RecordIndex(judged: judged, folded: folded, days: days, ink: ink, afterSeen: seen, dates: dates)
    }
}

extension ViewSupport {
    static func firstRecordMonth(_ index: RecordIndex) -> String? { index.days.items.min().map { String($0.prefix(7)) } }
    static func recordDaysInMonth(_ index: RecordIndex, month: String) -> [String] { index.days.items.filter { $0.hasPrefix(month+"-") }.sorted() }
    static func weekdayIndex(_ day: String, dates: Dates) throws -> Int {
        let ms = try dates.dayStartMs(.string(day))
        var c = Calendar(identifier: .gregorian); c.timeZone = dates.timeZone
        return (c.component(.weekday, from: Date(timeIntervalSince1970: ms/1000))+5)%7
    }
    static func calendarModel(_ index: RecordIndex, month: String, today: String) throws -> [JSValue] {
        let start = try weekdayIndex(month+"-01", dates: index.dates), y = Double(month.prefix(4))!, m = Double(month.suffix(2))!
        var cells = (0..<start).map { obj([("blank", .bool(true)), ("key", .string("b"+String($0)))]) }
        let total = index.dates.daysInMonth(Int(y), Int(m))
        for d in 1...Int(total) { let day = month+String(format: "-%02d", d); cells.append(obj([("day", .string(day)), ("key", .string(day)), ("n", .number(Double(d))), ("has", .bool(index.days.contains(day))), ("today", .bool(day == today)), ("future", .bool(day > today))])) }
        var k = 0
        while cells.count%7 != 0 { cells.append(obj([("blank", .bool(true)), ("key", .string("t"+String(k)))])); k += 1 }; return cells
    }
    static func retagRecordCells(_ cells: [JSValue]) -> [JSValue] {
        var prev: JSValue? = nil
        return cells.map { cell in var c = cell.objectValue!; c["tag"] = cell["day"] != prev ? cell["day"] : .null; prev = cell["day"]; return .object(c) }
    }
    static func monthSheet(_ index: RecordIndex, month: String, policy: JSValue, hasInk: InkPick.HasInk? = nil) -> JSValue {
        let pick = policy["monthSheetPick"] == .string("last") ? "last" : "first", days = recordDaysInMonth(index, month: month).count, fold = index.folded[month]
        let has: InkPick.HasInk = hasInk ?? { InkPick.storedInkPresent(obj([("ink", index.ink)]), $0, timeZone: index.dates.timeZone) }
        let records = index.works.filter { JS.string($0["localDay"]).hasPrefix(month+"-") }
        var raw: [JSValue] = []
        if let fold {
            let work = Records.foldWorkByDay(fold); var firstDay = JSObject()
            for day in work.keys.sorted() { for c in work[day]?.arrayValue ?? [] where firstDay[JS.string(c)] == nil { firstDay[JS.string(c)] = .string(day) } }
            raw = firstDay.entries.map { c, day in
                let m = WorkMembers.workMembers(records.filter { $0["char"] == .string(c) }, prefer: .string(pick), hasInk: has).first
                return obj([("char", .string(c)), ("day", day), ("record", m?.record ?? .null), ("dot", .bool(m?.dot ?? false))])
            }
        } else { raw = WorkMembers.workMembers(records, prefer: .string(pick), order: .string("first"), hasInk: has).map { m in obj([("char", .string(m.char)), ("day", m.firstDay), ("record", m.record), ("dot", .bool(m.dot))]) } }
        let cells = retagRecordCells(raw)
        return obj([("month", .string(month)), ("cells", .array(cells)), ("days", .number(Double(days))), ("chars", .number(Double(cells.count))), ("folded", .bool(fold != nil)), ("pick", .string(pick))])
    }
    static func sheetPreview(_ sheet: JSValue, cols: Double = 7, rows: Double = 3) -> JSValue {
        let cells = sheet["cells"]?.arrayValue ?? [], total = cells.count, totalRows = ceil(Double(total)/cols)
        let start = totalRows <= rows ? 0 : Int((totalRows-rows)*cols), shown = start > 0 ? retagRecordCells(Array(cells.dropFirst(start))) : cells
        return obj([("cells", .array(shown)), ("truncated", .bool(start > 0)), ("hidden", .number(Double(start))), ("total", .number(Double(total)))])
    }
    static func dayItems(_ index: RecordIndex, day: String, hasInk: InkPick.HasInk? = nil) -> [JSValue] {
        guard index.dates.isValidDay(.string(day)) else { return [] }
        let records = index.works.filter { $0["localDay"] == .string(day) }, has: InkPick.HasInk = hasInk ?? { InkPick.storedInkPresent(obj([("ink", index.ink)]), $0, timeZone: index.dates.timeZone) }
        if let fold = index.folded[String(day.prefix(7))] {
            return (Records.foldWorkByDay(fold, order: "last")[day]?.arrayValue ?? []).map { c in
                let m = WorkMembers.workMembers(records.filter { $0["char"] == c }, prefer: .string("last"), hasInk: has).first
                return obj([("char", c), ("record", m?.record ?? .null), ("dot", .bool(m?.dot ?? false))])
            }
        }
        return WorkMembers.workMembers(records, prefer: .string("last"), order: .string("last"), hasInk: has).map { obj([("char", .string($0.char)), ("record", $0.record), ("dot", .bool($0.dot))]) }
    }
    static func lastBackupDay(_ meta: JSValue?, dates: Dates) throws -> JSValue {
        guard let t = meta?["lastExportAt"]?.numberValue, t.isFinite, t > 0 else { return .null }; return .string(try dates.localDay(.number(t)))
    }
    static func practiceDaySet(_ state: JSValue, index: RecordIndex) -> KeySet {
        var out = index.days
        for day in state["legacy"]?["days"]?.arrayValue ?? [] where index.dates.isValidDay(day) { out.insert(JS.string(day)) }; return out
    }
    static func streakDays(_ days: KeySet, today: String, dates: Dates) throws -> Int {
        var cursor = days.contains(today) ? today : try dates.addDays(.string(today), -1), n = 0
        while days.contains(cursor) { n += 1; cursor = try dates.addDays(.string(cursor), -1) }; return n
    }
    static func overviewModel(_ state: JSValue, today: String, index: RecordIndex) throws -> JSValue {
        let days = KeySet(practiceDaySet(state, index: index).items.filter { $0 <= today })
        return try obj([("streak", .number(Double(streakDays(days, today: today, dates: index.dates)))), ("total", .number(Double(days.count))), ("chars", memoryZones(state, today: today, dates: index.dates)["recorded"]!)])
    }
    static func storagePressureNear(_ v: JSValue?) -> Bool {
        if v == .bool(true) { return true }; if let n = v?.numberValue { return n.isFinite && n >= 0.8 }; if let s = v?.stringValue { return ["near", "high", "warn", "full"].contains(s) }
        if v?.objectValue != nil { if ["near", "high", "full"].contains(where: { v?[$0] == .bool(true) }) { return true }; if v?["level"]?.stringValue != nil { return storagePressureNear(v?["level"]) }; if v?["ratio"]?.numberValue != nil { return storagePressureNear(v?["ratio"]) } }; return false
    }
    static func backupHint(_ state: JSValue, today: String, index: RecordIndex, storagePressure: JSValue?) throws -> JSValue {
        guard !index.days.items.isEmpty else { return .null }; if storagePressureNear(storagePressure ?? state["storagePressure"]) { return obj([("kind", .string("pressure"))]) }
        let meta = state["backupMeta"], last = try lastBackupDay(meta, dates: index.dates)
        if JS.truthy(last), meta?["lastExportSig"]?.stringValue == Backup.recordsSignature(state["records"]) { return .null }
        let since = JS.truthy(last) ? last.stringValue : index.days.items.min()
        guard let since, index.dates.isValidDay(.string(today)) else { return .null }; let days = try index.dates.diffDays(.string(since), .string(today))
        return days >= 30 ? obj([("kind", .string("stale")), ("days", .number(days))]) : .null
    }
    static func mineModel(_ state: JSValue, today: String, policy: JSValue, hasInk: InkPick.HasInk? = nil, storagePressure: JSValue?, dates: Dates) throws -> JSValue {
        let index = recordIndex(state, dates: dates), empty = index.days.count == 0, month = String(today.prefix(7)), sheet = monthSheet(index, month: month, policy: policy, hasInk: hasInk)
        return try obj([("today", .string(today)), ("empty", .bool(empty)), ("overview", overviewModel(state, today: today, index: index)), ("month", .string(month)), ("sheet", sheet), ("preview", sheetPreview(sheet)), ("sheetOn", .bool(!empty && !(sheet["cells"]?.arrayValue ?? []).isEmpty)), ("lastBackup", lastBackupDay(state["backupMeta"], dates: dates)), ("backupHint", backupHint(state, today: today, index: index, storagePressure: storagePressure)), ("year", .number(Double(Int(today.prefix(4))!)))])
    }
    static func clampMonth(_ month: JSValue?, index: RecordIndex, today: String) -> String {
        let current = String(today.prefix(7)), first = firstRecordMonth(index) ?? current, lo = min(first, current)
        guard let m = month?.stringValue, index.dates.isValidMonth(.string(m)) else { return current }; return min(current, max(lo, m))
    }
    static func recordsModel(_ state: JSValue, today: String, month: JSValue?, day: JSValue?, policy: JSValue, hasInk: InkPick.HasInk? = nil, dates: Dates) throws -> JSValue {
        let index = recordIndex(state, dates: dates), current = String(today.prefix(7)), m = clampMonth(month, index: index, today: today), first = firstRecordMonth(index), days = recordDaysInMonth(index, month: m)
        var selected: JSValue = .null
        if let day = day?.stringValue, dates.isValidDay(.string(day)), day.hasPrefix(m+"-"), index.days.contains(day) { selected = obj([("day", .string(day)), ("items", .array(dayItems(index, day: day, hasInk: hasInk)))]) }
        let todayItems = index.days.contains(today) ? dayItems(index, day: today, hasInk: hasInk) : []
        return try obj([("today", .string(today)), ("month", .string(m)), ("year", .number(Double(Int(m.prefix(4))!))), ("monthNum", .number(Double(Int(m.suffix(2))!))), ("current", .bool(m == current)), ("prev", first != nil && m > first! ? .string(dates.addMonths(.string(m), -1)) : .null), ("next", m < current ? .string(dates.addMonths(.string(m), 1)) : .null), ("calendar", .array(calendarModel(index, month: m, today: today))), ("recordDays", .number(Double(days.count))), ("dayList", .array(days.map { d in obj([("day", .string(d)), ("n", .number(Double(dayItems(index, day: d, hasInk: hasInk).count))), ("today", .bool(d == today))]) })), ("sheet", monthSheet(index, month: m, policy: policy, hasInk: hasInk)), ("selected", selected), ("todayRow", m == current && !todayItems.isEmpty ? obj([("day", .string(today)), ("n", .number(Double(todayItems.count))), ("items", .array(todayItems))]) : .null), ("empty", .bool(index.days.count == 0))])
    }
}
