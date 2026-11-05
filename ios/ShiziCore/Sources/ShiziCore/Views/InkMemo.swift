import Foundation

/// 一次回答之内，按记录的墨迹位置（Schema.inkMonthOf + Schema.inkIdOf，即 state.ink[月][id]）记下某个「解墨迹」函数的结果。
///
/// 只拿来记只取决于 state.ink[月][id] 的函数（state / dates / policy 由调用方固定）：
///   · DetailView.builtInk：inkOf(state, record:) 先看 JS.truthy(record)——有墨迹位置的记录是对象，恒为真——再解 QueryView.inkOf
///     （= state.ink[月][id]，月与 id 正是这里的键）、回放重采样；recalled 为 nil，不看记录的别的字段；
///   · QueryView.inkPointsOf({latest: record})：同样只解 state.ink[月][id]（policy 用缺省的 Config.policy）。
///   · AnnualInkWire.built：同 builtInk，只解 QueryView.inkOf（= state.ink[月][id]），点列换成平铺的形状（年报 view.annual 回包）。
/// 所以同一位置的两条记录结果相同，记下来与每次现算的相同。键按逐码点比（JSKey，与 JSObject 取 state.ink[月][id] 时的判等相同）。
/// 抛错不记：下次照样现算、照样抛同一个错（与原来每次都抛相同）。没有墨迹位置的记录（nil / 非对象 / 缺合法 id）不记，直接现算。
///
/// 用处：月报格、年报每月的格、记录页选中日的格里，同一条记录的墨迹原先要解两到三遍（imagePlan 的 hasInk 为挑「有墨迹的那一次」解一遍、
/// cellOfMember 取点再解一遍、年报页给每格配点又解一遍），每遍都是解码 + 两轮 Catmull-Rom + 每点一个 JS 对象。
final class RecordInkMemo {
    typealias Compute = (JSValue?) throws -> JSValue?
    private struct Key: Hashable {
        let month: JSKey
        let id: JSKey
    }
    private let timeZone: TimeZone
    private let compute: Compute
    private var cache: [Key: JSValue?] = [:]

    init(timeZone: TimeZone, _ compute: @escaping Compute) {
        self.timeZone = timeZone
        self.compute = compute
    }

    func get(_ record: JSValue?) throws -> JSValue? {
        guard let r = record, let month = Schema.inkMonthOf(r, timeZone: timeZone), let id = Schema.inkIdOf(r) else { return try compute(record) }
        let key = Key(month: JSKey(s: month), id: JSKey(s: id))
        if let hit = cache[key] { return hit }
        let value = try compute(record)
        cache.updateValue(value, forKey: key)
        return value
    }

    /// DetailView.builtInk(state, record:, dates:) 的记忆版。
    static func builtInk(_ state: JSValue, dates: Dates) -> RecordInkMemo {
        RecordInkMemo(timeZone: dates.timeZone) { (r: JSValue?) throws -> JSValue? in try DetailView.builtInk(state, record: r, dates: dates) }
    }
}
