import UIKit

/// 只建看得见的格子（虚拟化）：页面先把全部格子的框排好（纯几何，便宜），本组件只为与「可见框 ± overscan」相交的格子
/// 取出一个格子视图（Slot），滚动 / 重排时只增删、重配差的那几格；移出去的格子回收进按种类分开的池子，下次再用。
///
/// 页面给四个动作（都在主线程调，按下面的顺序）：
///   make(kind)                    新建一格（池子里没有这种的时候）
///   attach(slot, index, following) 把这一格放进视图树：following = 下一个已建好的格子（序号比它大的里面最小的那个；没有就是 nil），
///                                 页面据此把它插在 following 前面，视图树里的先后（读屏 / 取证的文档顺序）始终按序号排
///   detach(slot)                  移出视图树（进池子之前）
///   configure(slot, index)        按第 index 格的数据把这一格配好（必须把这一格配的每一样状态都重设：池子里拿出来的格子带着上一格的状态）
///
/// 框的坐标与 update(visible:) 给的可见框同一个坐标系（例：滚动区的内容坐标）。只按竖向判断相交（开区间：框的下沿 > 上界、上沿 < 下界）。
/// 框按序号的上沿、下沿都不减（一般的网格：一行一行往下排）时用二分找出相交的那一段；否则逐个判断（结果相同，只是慢）。
///
/// setItems 换了一份框（重排一次）之后，下一次 update 把留下来的格子都重新 attach（降序；位置已对的由页面自己跳过）+ configure（升序）；
/// 只是滚动（框没换）时只动新进来 / 移出去的格子。
@MainActor
final class ShiziLazyCells<Slot: AnyObject> {
    /// 可见框上下各多建这么多（pt）。
    var overscan: CGFloat = 0
    /// 测试用：全部格子都建出来（= 以前一次建完的做法，同一套配置代码），用来对照。
    var materializeAll = false

    private let make: (Int) -> Slot
    private let attach: (Slot, Int, Slot?) -> Void
    private let detach: (Slot) -> Void
    private let configure: (Slot, Int) -> Void

    private var frames: [CGRect] = []
    private var kinds: [Int] = []
    private var monotone = true
    private var dirty = false
    /// 已建好的格子：序号 → (格子, 种类)；liveSorted = 它们的序号，升序。
    private var live: [Int: (slot: Slot, kind: Int)] = [:]
    private var liveSorted: [Int] = []
    private var pool: [Int: [Slot]] = [:]

    init(make: @escaping (Int) -> Slot, attach: @escaping (Slot, Int, Slot?) -> Void,
         detach: @escaping (Slot) -> Void, configure: @escaping (Slot, Int) -> Void) {
        self.make = make
        self.attach = attach
        self.detach = detach
        self.configure = configure
    }

    // MARK: 框

    /// 换一份框（kinds 缺省 = 全是种类 0）。下一次 update 把留下来的格子都重配一遍。
    func setItems(_ frames: [CGRect], kinds: [Int]? = nil) {
        self.frames = frames
        self.kinds = kinds ?? []
        var ok = true
        var i = 1
        while ok && i < frames.count {
            ok = frames[i].minY >= frames[i - 1].minY && frames[i].maxY >= frames[i - 1].maxY
            i += 1
        }
        monotone = ok
        dirty = true
    }

    var count: Int { frames.count }

    func frame(at i: Int) -> CGRect { frames[i] }

    func kind(at i: Int) -> Int { i < kinds.count ? kinds[i] : 0 }

    // MARK: 建 / 收

    /// 按可见框（与框同一坐标系）把该建的建出来、不该留的收进池子；框换过时留下来的也重配。
    func update(visible: CGRect) {
        let want = indices(visible: visible)
        let wantSet = Set(want)
        var kept: [Int: (slot: Slot, kind: Int)] = [:]
        kept.reserveCapacity(want.count)
        for i in liveSorted {
            guard let e = live[i] else { continue }
            if wantSet.contains(i), e.kind == kind(at: i) {
                kept[i] = e
            } else {
                detach(e.slot)
                pool[e.kind, default: []].append(e.slot)
            }
        }
        var next: [Int: (slot: Slot, kind: Int)] = [:]
        next.reserveCapacity(want.count)
        var fresh = Set<Int>()
        // 降序放进视图树：following（下一个已建好的格子）此刻已经在它该在的位置
        var following: Slot?
        for i in want.reversed() {
            let entry: (slot: Slot, kind: Int)
            if let e = kept[i] {
                entry = e
                if dirty { attach(e.slot, i, following) }
            } else {
                let k = kind(at: i)
                let s = pool[k]?.popLast() ?? make(k)
                entry = (s, k)
                fresh.insert(i)
                attach(s, i, following)
            }
            next[i] = entry
            following = entry.slot
        }
        live = next
        liveSorted = want
        let all = dirty
        dirty = false
        for i in want where all || fresh.contains(i) {
            if let e = live[i] { configure(e.slot, i) }
        }
    }

    /// 全部收掉（格子进池子）。
    func removeAll() {
        for i in liveSorted {
            guard let e = live[i] else { continue }
            detach(e.slot)
            pool[e.kind, default: []].append(e.slot)
        }
        live = [:]
        liveSorted = []
    }

    // MARK: 查

    /// 已建好的格子的序号（升序）。
    var liveIndices: [Int] { liveSorted }

    func slot(at i: Int) -> Slot? { live[i]?.slot }

    /// 已建好的格子里满足条件的那一格的序号（点按时按视图找回是第几格）。
    func index(where match: (Slot) -> Bool) -> Int? {
        for i in liveSorted { if let e = live[i], match(e.slot) { return i } }
        return nil
    }

    /// 该建的序号（升序）：与 visible 上下各扩 overscan 相交的格子；materializeAll 时全部。
    func indices(visible: CGRect) -> [Int] {
        if materializeAll { return Array(0..<frames.count) }
        let top = visible.minY - overscan, bottom = visible.maxY + overscan
        guard monotone else { return (0..<frames.count).filter { frames[$0].maxY > top && frames[$0].minY < bottom } }
        // 第一个下沿 > top 的；第一个上沿 ≥ bottom 的
        var lo = 0, hi = frames.count
        while lo < hi { let mid = (lo + hi) / 2; if frames[mid].maxY > top { hi = mid } else { lo = mid + 1 } }
        let start = lo
        lo = start; hi = frames.count
        while lo < hi { let mid = (lo + hi) / 2; if frames[mid].minY >= bottom { hi = mid } else { lo = mid + 1 } }
        return Array(start..<max(start, lo))
    }

    // MARK: 测试

    /// 对照检查（测试用）：已建好的格子 = 逐个判断相交得出的那些（不靠二分）、没有一个格子用在两处、
    /// 每格的状态摘要 = 新建一格按同一序号配出来的摘要。返回问题（空 = 都对）。
    func check<D: Equatable>(visible: CGRect, digest: (Slot) -> D) -> [String] {
        var problems: [String] = []
        let top = visible.minY - overscan, bottom = visible.maxY + overscan
        let expected = materializeAll ? Array(0..<frames.count) : (0..<frames.count).filter { frames[$0].maxY > top && frames[$0].minY < bottom }
        if expected != liveSorted {
            problems.append("live \(liveSorted.first ?? -1)...\(liveSorted.last ?? -1) (\(liveSorted.count)) != expected \(expected.first ?? -1)...\(expected.last ?? -1) (\(expected.count))")
        }
        var seen = Set<ObjectIdentifier>()
        for i in liveSorted {
            guard let e = live[i] else { problems.append("\(i): missing"); continue }
            if !seen.insert(ObjectIdentifier(e.slot)).inserted { problems.append("\(i): slot used twice") }
            let probe = make(e.kind)
            configure(probe, i)
            let a = digest(e.slot), b = digest(probe)
            if a != b { problems.append("\(i): \(a) != fresh \(b)") }
        }
        return problems
    }
}
