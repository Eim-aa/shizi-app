import Foundation

// 1:1 移植自原 JS 版：时间段视图取「某一次」笔迹的共用口径（D42，解 03 P122；01 §3.5 / §12；D27 / D31）。
// 在时间段内、按偏好顺序找留有墨迹的那一次；一份都没有才如实显示没有笔迹，不拿时间段外的墨迹冒充。
// 有没有墨迹由调用方注入（hasInk）；抛错按没有。

public enum InkPick {
    public typealias HasInk = (JSValue) throws -> Bool

    /// 偏好方向：'first' = 从早到晚找；其余一律按 'last'（从晚到早）。
    public static func normalizePrefer(_ prefer: JSValue?) -> String { JSX.eq(prefer, "first") ? "first" : "last" }

    /// 一条存下的墨迹里有没有笔画（不解码）：v4 {r:[打包串…]} / v3 {s:[base64…]} / 旧 v2 {s:[[…]]}，只看有没有非空的一笔。
    public static func inkHasStrokes(_ ink: JSValue?) -> Bool {
        guard let ink = ink, JSX.truthy(ink) else { return false }
        switch ink {
        case .object, .array: break
        default: return false
        }
        if case .array(let r)? = ink["r"] {
            return r.contains { if case .string(let s) = $0 { return !s.isEmpty }; return false }
        }
        guard case .array(let s)? = ink["s"] else { return false }
        return s.contains { row in
            guard JSX.truthy(row) else { return false }
            switch row {
            case .string(let t): return !t.isEmpty
            case .array(let a): return !a.isEmpty
            default: return false
            }
        }
    }

    /// 这条记录在 state.ink（按月分键的墨迹表）里有没有存下的墨迹：一次查找，不解码。
    public static func storedInkPresent(_ state: JSValue?, _ record: JSValue?, timeZone: TimeZone) -> Bool {
        guard let state = state, JSX.truthy(state), let table = state["ink"], JSX.truthy(table), case .object = table else { return false }
        guard let record = record, let month = Schema.inkMonthOf(record, timeZone: timeZone), let id = Schema.inkIdOf(record) else { return false }
        guard let months = table[month], JSX.truthy(months), case .object(let m) = months, let ink = m[id] else { return false }
        return inkHasStrokes(ink)
    }

    /// 在一个时间段内某个字的记录序列里，按偏好顺序找留有墨迹的那一条；一条都没有返回 nil。
    public static func pickInkRecord(_ records: [JSValue], prefer: JSValue? = nil, hasInk: HasInk?) -> JSValue? {
        guard !records.isEmpty, let hasInk = hasInk else { return nil }
        let forward = normalizePrefer(prefer) == "first"
        for k in 0..<records.count {
            let record = records[forward ? k : records.count - 1 - k]
            if !JSX.truthy(record) { continue }
            if (try? hasInk(record)) ?? false { return record }
        }
        return nil
    }

    /// pickInkRecord + 段内全无墨迹时的兜底：兜底取偏好方向上的那一条。records 为空时 record 为 nil。
    public static func pickRecordInPeriod(_ records: [JSValue], prefer: JSValue? = nil, hasInk: HasInk?) -> (record: JSValue?, inked: Bool) {
        guard !records.isEmpty else { return (nil, false) }
        if let found = pickInkRecord(records, prefer: prefer, hasInk: hasInk) { return (found, true) }
        return (normalizePrefer(prefer) == "first" ? records[0] : records[records.count - 1], false)
    }
}
