import Foundation

// src/session/views/annual.js. Maps/Sets are serialized only at the op boundary.
public enum AnnualView {
    typealias V = ViewSupport
    struct Slice {
        var year: Int; var judged: [JSValue]; var works: [JSValue]; var days: [String]; var chars: [String]; var folded: JSObject; var firstSeen: JSObject; var state: JSValue
        var js: JSValue { V.obj([("year", .number(Double(year))), ("judged", .array(judged)), ("works", .array(works)), ("days", .array(days.map(JSValue.string))), ("chars", .array(chars.map(JSValue.string))), ("firstSeen", .array(firstSeen.entries.map { .array([.string($0.key), $0.value]) })), ("folded", .object(folded)), ("ink", state["ink"] ?? .null)]) }
    }
    static func yearOfDay(_ day: String, dates: Dates) -> Int? { dates.isValidDay(.string(day)) ? Int(day.prefix(4)) : nil }
    static func yearSlice(_ state: JSValue, year: Int, dates: Dates) -> Slice {
        let index = V.recordIndex(state, dates: dates), prefix = String(year) + "-"
        let judged = index.judged.filter { WorkMembers.isWorkMember($0) && JS.string($0["localDay"]).hasPrefix(prefix) && dates.isValidDay($0["localDay"] ?? .null) }
        let works = index.works.filter { JS.string($0["localDay"]).hasPrefix(prefix) && dates.isValidDay($0["localDay"] ?? .null) }
        var folded = JSObject(), days = KeySet(works.map { JS.string($0["localDay"]) })
        for (month, f) in index.folded.entries where month.hasPrefix(prefix) {
            var fold = f.objectValue!; let raw = state["records"]?[month] ?? .null
            fold["byDay"] = .object(Records.foldWorkByDay(raw)); fold["judgedByDay"] = .object(Records.foldWorkByDay(raw, judgedOnly: true)); folded[month] = .object(fold)
        }
        var events: [(String, String, Int)] = []
        for (_, f) in folded.entries {
            let byDay = f["byDay"]?.objectValue ?? JSObject()
            for day in byDay.keys.sorted() { days.insert(day); for c in byDay[day]?.arrayValue ?? [] { events.append((day, JS.string(c), events.count)) } }
        }
        for r in works { events.append((JS.string(r["localDay"]), JS.string(r["char"]), events.count)) }
        events.sort { $0.0 == $1.0 ? $0.2 < $1.2 : $0.0 < $1.0 }
        var firstSeen = JSObject()
        for (day, char, _) in events where firstSeen[char] == nil { firstSeen[char] = .string(day) }
        return Slice(year: year, judged: judged, works: works, days: days.items.sorted(), chars: firstSeen.keys, folded: folded, firstSeen: firstSeen, state: state)
    }
    public static func annualYears(_ state: JSValue, dates: Dates) -> [Int] {
        let index = V.recordIndex(state, dates: dates)
        var years = Set<Int>()
        for r in index.judged + index.works { if let y = yearOfDay(JS.string(r["localDay"]), dates: dates) { years.insert(y) } }
        for m in index.folded.keys { if let y = Int(m.prefix(4)) { years.insert(y) } }
        return years.filter { let s = yearSlice(state, year: $0, dates: dates); return !s.days.isEmpty || !s.chars.isEmpty }.sorted()
    }
    public static func annualDefaultYear(_ state: JSValue, today: String, dates: Dates) -> JSValue {
        guard let cur = yearOfDay(today, dates: dates) else { return annualYears(state, dates: dates).first.map { .number(Double($0)) } ?? .null }
        let years = annualYears(state, dates: dates)
        return .number(Double(years.isEmpty || years.contains(cur) ? cur : years.filter { $0 <= cur }.last ?? years[0]))
    }
    static func firstOfYear(_ s: Slice, hasInk: InkPick.HasInk?, dates: Dates) -> JSValue {
        let r0 = s.judged.first
        var fold: (day: String, char: JSValue)?
        for (_, f) in s.folded.entries {
            let byDay = (f["judgedByDay"] ?? f["byDay"])?.objectValue ?? JSObject()
            for day in byDay.keys.sorted() {
                guard let c = byDay[day]?.arrayValue?.first else { continue }
                if fold == nil || day < fold!.day { fold = (day, c) }; break
            }
        }
        var base: JSValue = .null
        if let r0, fold == nil || JS.string(r0["localDay"]) < fold!.day || (r0["localDay"] == .string(fold!.day) && r0["char"] == fold!.char) {
            base = V.obj([("char", r0["char"]!), ("day", r0["localDay"]!), ("record", r0)])
        } else if let fold { base = V.obj([("char", fold.char), ("day", .string(fold.day)), ("record", .null)]) }
        else if let w = s.works.first { base = V.obj([("char", w["char"]!), ("day", w["localDay"]!), ("record", w)]) }
        guard JS.truthy(base) else { return .null }
        let has: InkPick.HasInk = hasInk ?? { InkPick.storedInkPresent(s.state, $0, timeZone: dates.timeZone) }
        if let found = InkPick.pickInkRecord(s.works.filter { $0["char"] == base["char"] }, prefer: .string("first"), hasInk: has) { return V.obj([("char", found["char"]!), ("day", found["localDay"]!), ("record", found)]) }
        return base
    }
    static func twiceOfYear(_ s: Slice, hasInk: InkPick.HasInk?, dates: Dates) throws -> JSValue {
        let has: InkPick.HasInk = hasInk ?? { InkPick.storedInkPresent(s.state, $0, timeZone: dates.timeZone) }
        var byChar = OMap<[JSValue]>()
        for r in s.works where (try? has(r)) ?? false { let c = JS.string(r["char"]); byChar[c] = (byChar[c] ?? []) + [r] }
        var best: JSValue = .null
        for c in s.chars {
            guard let list = byChar[c], list.count >= 2 else { continue }
            let first = list[0], last = list.last!, gap = try dates.diffDays(first["localDay"]!, last["localDay"]!)
            if gap >= 1 && (!JS.truthy(best) || gap > JS.number(best["gap"])) {
                best = V.obj([("char", .string(c)), ("first", V.obj([("record", first), ("day", first["localDay"]!)])), ("last", V.obj([("record", last), ("day", last["localDay"]!)])), ("gap", .number(gap))])
            }
        }
        return best
    }
    static func yearMonths(_ state: JSValue, _ s: Slice, policy: JSValue, dates: Dates) throws -> [JSValue] {
        let months = Set(s.works.map { String(JS.string($0["localDay"]).prefix(7)) } + s.folded.keys)
        return try months.sorted().compactMap { m in
            let n = try ImageSelection.monthMembers(state, month: m, pick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)["members"]!.arrayValue!.count
            return n > 0 ? V.obj([("month", .string(m)), ("monthNum", .number(Double(Int(m.suffix(2))!))), ("n", .number(Double(n)))]) : nil
        }
    }
    public static func annualModel(_ state: JSValue, today: String, year: JSValue? = nil, policy: JSValue = Config.policy, hasInk: InkPick.HasInk? = nil, dates: Dates) throws -> JSValue {
        let wanted = year?.numberValue.flatMap { $0.isFinite && $0.rounded(.towardZero) == $0 ? Int($0) : nil } ?? yearOfDay(today, dates: dates)
        let y = wanted ?? 0
        let years = annualYears(state, dates: dates), at = years.firstIndex(of: y), s = yearSlice(state, year: y, dates: dates), empty = s.days.isEmpty && s.chars.isEmpty
        return V.obj([("today", .string(today)), ("year", wanted.map { .number(Double($0)) } ?? .null), ("years", .array(years.map { .number(Double($0)) })), ("prevYear", at != nil && at! > 0 ? .number(Double(years[at!-1])) : .null), ("nextYear", at != nil && at! < years.count-1 ? .number(Double(years[at!+1])) : .null), ("empty", .bool(empty)), ("count", .number(Double(s.chars.count))), ("chars", .array(s.chars.map(JSValue.string))), ("days", .number(Double(s.days.count))), ("first", empty ? .null : firstOfYear(s, hasInk: hasInk, dates: dates)), ("months", .array(empty ? [] : try yearMonths(state, s, policy: policy, dates: dates))), ("twice", empty ? .null : try twiceOfYear(s, hasInk: hasInk, dates: dates))])
    }
    public static func annualPlan(_ state: JSValue, today: String, year: JSValue?, policy: JSValue, dates: Dates) throws -> JSValue {
        let model = try annualModel(state, today: today, year: year, policy: policy, dates: dates)
        if JS.truthy(model["empty"]) || !JS.truthy(model["first"]) { return V.obj([("status", .string("empty")), ("model", model), ("cover", .null), ("months", .array([])), ("tail", .null), ("pages", .array([]))]) }
        func cell(_ c: JSValue, _ r: JSValue?) throws -> JSValue {
            let ink = try QueryView.inkPointsOf(V.obj([("latest", r ?? .null)]), state: state, dates: dates)
            return V.obj([("ch", c), ("ink", ink), ("mode", .string(JS.truthy(ink) ? "hand" : "under")), ("dot", .bool(false)), ("tag", .string("")), ("record", r ?? .null)])
        }
        var months: [JSValue] = [], pages = [V.obj([("type", .string("cover"))])]
        for m in model["months"]!.arrayValue! {
            let month = JS.string(m["month"])
            let plan = try ImageSelection.imagePlan(state, scope: V.obj([("kind", .string("month")), ("month", .string(month))]), inkOf: { r in try QueryView.inkPointsOf(V.obj([("latest", r)]), state: state, dates: dates) }, maxChars: Int(JS.number(policy["imageMaxChars"])), monthPick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)
            let cells = plan["cells"]?.arrayValue ?? []
            let parts = ImageLayout.paginate(cells, max: Int(JS.number(policy["imageMaxChars"]))).map(ImageLayout.withDayTags)
            months.append(V.obj([("month", .string(month)), ("monthNum", m["monthNum"]!), ("cells", .array(cells)), ("pages", .array(parts.map(JSValue.array)))]))
            for (i, p) in parts.enumerated() { pages.append(V.obj([("type", .string("month")), ("month", .string(month)), ("cells", .array(p)), ("part", .number(Double(i+1))), ("of", .number(Double(parts.count)))])) }
        }
        var tail: JSValue = .null
        if let t = model["twice"], JS.truthy(t) { tail = try V.obj([("first", cell(t["char"]!, t["first"]?["record"])), ("last", cell(t["char"]!, t["last"]?["record"])), ("firstDay", t["first"]!["day"]!), ("lastDay", t["last"]!["day"]!)]); pages.append(V.obj([("type", .string("tail"))])) }
        return try V.obj([("status", .string("ready")), ("model", model), ("first", cell(model["first"]!["char"]!, model["first"]?["record"])), ("months", .array(months)), ("tail", tail), ("pages", .array(pages))])
    }
}
