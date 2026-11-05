import Foundation

extension PageAPI {
    static func mineSub(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
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
            view = try MineSubView.annualView(state, today: today, year: year, policy: Config.policy, inkWire: true, dates: store.dates, index: index)
        }; return JS.obj([("ok", .bool(true)), ("view", view)])
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
/// App 解这份 view 的结果与以前相同（以前这样的 view 解不了，现在也一样）。
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
        guard let record, JS.truthy(record), let decoded = try InkMath.decodeInk(QueryView.inkOf(state, record, dates: dates)), !decoded.isEmpty else { return nil }
        let resampled = InkMath.resampleForReplay(decoded)
        return resampled.contains { !$0.isEmpty } ? points(resampled) : nil
    }
}
