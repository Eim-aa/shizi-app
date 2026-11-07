import Foundation

extension PageAPI {
    static func mineSub(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        // 按需取墨迹：不用 today / 索引，先答（不为它算本地日）
        if op == "view.annual.ink" { return annualInk(.object(store.state), a) }
        let today = try store.dates.localDay(.number(store.now())), state = JSValue.object(store.state)
        let view: JSValue
        if op == "view.records" {
            var args = JSObject(); for key in ["month", "day"] { if let v = a[key]?.stringValue, !v.isEmpty { args[key] = .string(v) } }
            view = try MineSubView.recordsView(state, today: today, args, dates: store.dates)
        } else if op == "view.month" {
            let candidate = a["month"]?.stringValue ?? "", month = candidate.range(of: #"^\d{4}-\d{2}$"#, options: .regularExpression) != nil ? candidate : String(today.prefix(7))
            view = try MineSubView.monthView(state, month: month, policy: Config.policy, dates: store.dates)
        } else {
            // 一个 recordIndex 给缺省年份、年份列表与这一年的切片共用（原先缺省年份与年报模型各算一遍年份列表，每个候选年份各建一次索引）
            let index = ViewSupport.recordIndex(state, dates: store.dates)
            let year: JSValue? = SessionWrites.integer(a["year"]) ? a["year"] : ViewSupport.annualDefaultYear(state, today: today, index: index)
            // lazyInk: true（App 年报页）：月段的格不带墨迹、只带 inkKey，页面按需用 view.annual.ink 取；不带 = 整份（每格都带墨迹）
            view = try MineSubView.annualView(state, today: today, year: year, policy: Config.policy, inkWire: true, lazyInk: a["lazyInk"] == .bool(true), dates: store.dates, index: index)
        }; return JS.obj([("ok", .bool(true)), ("view", view)])
    }

    /// view.annual.ink {keys: [墨迹键, …]}：年报页按需取的月段格墨迹（view.annual 带 lazyInk 时月段的格只给 inkKey）。
    /// 回 {ok, ink: {键: ink.points | null}}；每个键的值 = 不带 lazyInk 的 view.annual 里同一格的 ink.points（AnnualInkWire.built，逐位相同）。
    /// keys 不是字串数组、或多于 AnnualInkWire.maxBatch 个 → invalid；认不得的键（格式不对、state.ink 里没有、解不出可画的笔）→ null；重复的键只算一次。
    static func annualInk(_ state: JSValue, _ a: JSObject) -> JSValue {
        guard let keys = a["keys"]?.arrayValue, keys.count <= AnnualInkWire.maxBatch else { return SessionWrites.failure("invalid") }
        var out = JSObject()
        for k in keys {
            guard case .string(let key) = k else { return SessionWrites.failure("invalid") }
            if out[key] != nil { continue }
            // 抛错（存的墨迹坏到 decodeInk 抛）→ null：不带 lazyInk 的 view.annual 在同一格整份抛错，带 lazyInk 的元数据回包也一样抛，所以这样的键不会被发出来
            let points: JSValue? = (try? AnnualInkWire.built(state, key: key)) ?? nil
            out[key] = points ?? .null
        }
        return JS.obj([("ok", .bool(true)), ("ink", .object(out))])
    }
}

/// 年报回包（view.annual）里每格墨迹 ink = {points: [笔, …]} 的形状，App 端 AnnualScreen.decodeView 读。
///
/// 一笔同字库页（LibraryInkWire.stroke）：每点都有 w → [3, x, y, w, …]，每点都没有 w → [2, x, y, …]，有的有有的没有 → 每点一个 {x, y, w?}，
/// 没有点 → []。数原样放（同一个 Double）。以前（DetailView.builtInk）每点一个 InkPoint.js 对象 {x, y, t, p?, w?}：
/// t / p 画墨用不到（App ShiziPointsInkView 只按 x / y / w 拼三角形），不再发；x / y / w 逐位不变。
///
/// 一格里只要有一个点不是 faithful（x / y / t / p / w 有不是有限数的：存储校验只要求整数，过大的 v2 坐标在 Catmull-Rom 里会溢出成 ±∞ / NaN；
/// 或 InkPoint.js 会漏掉 x / y / w：键序 order 里没有它），这一格整格照旧发（每点一个 InkPoint.js），
/// 整份回包（不带 lazyInk）时，App 解这份 view 的结果与以前相同（以前这样的 view 解不了，现在也一样）。
/// 带 lazyInk 时月段的格不在 view 里：view 照常解得出来，这样的一格由 view.annual.ink 单独取回，App 解不了它（AnnualInkDecode.strokes）
/// 就只这一格不画（墨视图在、没有点）；今年首字 / 卷尾两格仍在 view 里，同整份回包（解不了则整份解不了）。
public enum AnnualInkWire {
    /// 一格的回放点（resampleForReplay 之后）→ ink.points。legacy = 旧形状（只给测试 / 量测对照）。
    public static func points(_ resampled: [[InkPoint]], legacy: Bool = false) -> JSValue {
        if legacy || !resampled.allSatisfy({ $0.allSatisfy(faithful) }) { return .array(resampled.map { .array($0.map(\.js)) }) }
        return .array(resampled.map(LibraryInkWire.stroke))
    }

    /// 平铺这个点不改 App 读到的 x / y / w：有的数都是有限数（x / y 必有；t / p / w 缺省不算），
    /// 且 InkPoint.js 会写出 x、y 与（有的话）w（键序里有）。回放点的键序是 orderXYTPW / orderXYWTP（同一个数组，== 先比缓冲区，很快）。
    public static func faithful(_ q: InkPoint) -> Bool {
        guard q.x.isFinite, q.y.isFinite, q.t?.isFinite ?? true, q.p?.isFinite ?? true, q.w?.isFinite ?? true else { return false }
        let o = q.order
        if o == InkPoint.orderXYTPW || o == InkPoint.orderXYWTP { return true }
        return o.contains("x") && o.contains("y") && (q.w == nil || o.contains("w"))
    }

    /// 一条记录的 ink.points；没有墨迹 → nil。有没有、什么时候 throw 都同 DetailView.builtInk（inkOf 不带 recalled）。
    static func built(_ state: JSValue, record: JSValue?, dates: Dates) throws -> JSValue? {
        guard let record, JS.truthy(record) else { return nil }
        return try built(stored: QueryView.inkOf(state, record, dates: dates))
    }

    /// 一份存着的墨迹（state.ink[月][id]）→ ink.points；没有可画的笔 → nil。
    static func built(stored: JSValue?) throws -> JSValue? {
        guard let decoded = try InkMath.decodeInk(stored), !decoded.isEmpty else { return nil }
        let resampled = InkMath.resampleForReplay(decoded)
        return resampled.contains { !$0.isEmpty } ? points(resampled) : nil
    }

    // MARK: 按需取（view.annual 带 lazyInk + view.annual.ink）

    /// lazyInk 的月段格在 monthCells 里记的「有墨迹」占位（一笔一个点：ImageSelection.points 认它非空；值不进回包）。
    static let presentMark: JSValue = .array([.array([.number(0)])])

    /// 一次 view.annual.ink 最多取几个键（App 一次排版 / 滚动按这个数分批）。
    public static let maxBatch = 256

    /// 墨迹键：「月|id」（= state.ink[月][id]，Schema.inkMonthOf + Schema.inkIdOf，RecordInkMemo 的键）。
    /// 月是 YYYY-MM（或 at 推出来的 年-月 / NaN-NaN），id 是 r + 数字：都没有「|」，按第一个「|」拆回去不会错。
    public static func key(month: String, id: String) -> String { month + "|" + id }

    /// 一条记录的墨迹键；记录没有墨迹位置（不是对象、缺合法 id、没有日子与时间）→ nil。
    static func key(_ record: JSValue?, timeZone: TimeZone) -> String? {
        guard let r = record, let month = Schema.inkMonthOf(r, timeZone: timeZone), let id = Schema.inkIdOf(r) else { return nil }
        return key(month: month, id: id)
    }

    /// 墨迹键 → ink.points（= built(state, record:) 对任何墨迹键是它的记录：built 只读 state.ink[月][id]）。键里没有「|」→ nil。
    static func built(_ state: JSValue, key: String) throws -> JSValue? {
        guard let bar = key.firstIndex(of: "|") else { return nil }
        let month = String(key[..<bar]), id = String(key[key.index(after: bar)...])
        return try built(stored: state["ink"]?[month]?[id])
    }
}
