import Foundation

// ts-fsrs 5.2.0（FSRS-6.0，vendor/fsrs6.min.js）的 Swift 移植（B4.2）。只移植拾字用到的那条路径，但逐行同序：
//   · 参数：generatorParameters({request_retention, maximum_interval, enable_fuzz, enable_short_term: true, learning_steps: [], relearning_steps: []})
//     → w = clipParameters(default_w, 0)；调度器 = BasicLearningStepsScheduler（enable_short_term）；
//   · next(card, now, grade)：init（elapsed_days、reps+1、种子）→ New / Learning / Relearning / Review 各自的状态转移；
//   · fuzz：种子 = `${review_time}_${reps}_${difficulty*stability}`（DefaultInitSeedStrategy），Alea（Mash）取第一个随机数；
//   · get_retrievability(card, now, false)。
// 数值运算的先后与 JS 源码一致（浮点结果逐位相同）；Math.exp / log 走 JSMath（V8 的 fdlibm），toFixed(8) 走 JSMath.toFixedNumber。
// 库里的常数（default_w、fuzz 区间表、S_MIN …）是 ts-fsrs 算法本身的一部分，不是拾字的产品规则，照抄库源码。

public enum FSRSState: Double {
    case new = 0, learning = 1, review = 2, relearning = 3
}

public enum FSRSRating: Double {
    case manual = 0, again = 1, hard = 2, good = 3, easy = 4

    /// lib.Rating[name]（'Again' | 'Hard' | 'Good' | 'Easy'）。
    public init?(name: String) {
        switch name {
        case "Manual": self = .manual
        case "Again": self = .again
        case "Hard": self = .hard
        case "Good": self = .good
        case "Easy": self = .easy
        default: return nil
        }
    }
}

/// 库里的卡（TypeConvert.card 之后）：时间是 ms（NaN = Invalid Date），lastReview nil = undefined。
public struct FSRSCard: Equatable {
    public var due: Double
    public var stability: Double
    public var difficulty: Double
    public var elapsedDays: Double
    public var scheduledDays: Double
    public var learningSteps: Double
    public var reps: Double
    public var lapses: Double
    public var state: Double
    public var lastReview: Double?
}

public struct FSRS6 {
    // MARK: 库常数（ts-fsrs 5.2.0）
    static let sMin = 0.001
    static let sMax = 36500.0
    static let defaultW: [Double] = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614,
                                     0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]
    static let initSMax = 100.0
    static let w17w18Ceiling = 2.0
    static let fuzzRanges: [(start: Double, end: Double, factor: Double)] = [(2.5, 7, 0.15), (7, 20, 0.1), (20, .infinity, 0.05)]

    public let requestRetention: Double
    public let maximumInterval: Double
    public let enableFuzz: Bool
    public let w: [Double]
    let decay: Double
    let factor: Double
    public let intervalModifier: Double

    /// generatorParameters + new FSRS（relearning_steps 为空）。
    public init(requestRetention: Double, maximumInterval: Double, enableFuzz: Bool) throws {
        // `(i==null?void 0:i.request_retention)||K`：0 / NaN 落回缺省
        self.requestRetention = requestRetention == 0 || requestRetention.isNaN ? 0.9 : requestRetention
        self.maximumInterval = maximumInterval == 0 || maximumInterval.isNaN ? 36500 : maximumInterval
        self.enableFuzz = enableFuzz
        w = FSRS6.clipParameters(FSRS6.defaultW, numRelearningSteps: 0)
        let (d, f) = FSRS6.decayFactor(w)
        decay = d
        factor = f
        let r = self.requestRetention
        if r <= 0 || r > 1 { throw CoreError.error("Requested retention rate should be in the range (0,1]") }
        intervalModifier = JSMath.toFixedNumber((JSMath.pow(r, 1 / d) - 1) / f, 8)
    }

    static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { jsMin(jsMax(x, lo), hi) }

    static func clipParameters(_ p: [Double], numRelearningSteps: Double) -> [Double] {
        var w17w18 = w17w18Ceiling
        if jsMax(0, numRelearningSteps) > 1 {
            let r = -(JSMath.log(p[11]) + JSMath.log(JSMath.pow(2, p[13]) - 1) + p[14] * 0.3) / numRelearningSteps
            w17w18 = clamp(JSMath.toFixedNumber(r, 8), 0.01, 2)
        }
        let bounds: [(Double, Double)] = [
            (sMin, initSMax), (sMin, initSMax), (sMin, initSMax), (sMin, initSMax), (1, 10), (0.001, 4), (0.001, 4), (0.001, 0.75), (0, 4.5), (0, 0.8),
            (0.001, 3.5), (0.001, 5), (0.001, 0.25), (0.001, 0.9), (0, 4), (0, 1), (1, 6), (0, w17w18), (0, w17w18), (0, 0.8), (0.1, 0.8),
        ]
        return bounds.enumerated().map { clamp(p[$0.offset], $0.element.0, $0.element.1) }
    }

    /// computeDecayFactor(w)。
    static func decayFactor(_ w: [Double]) -> (Double, Double) {
        let t = -w[20]
        let e = JSMath.schedExp(JSMath.pow(t, -1) * JSMath.log(0.9)) - 1
        return (t, JSMath.toFixedNumber(e, 8))
    }

    // MARK: 算法（FSRSAlgorithm）

    func forgettingCurve(_ elapsed: Double, _ stability: Double) -> Double {
        JSMath.toFixedNumber(JSMath.pow(1 + factor * elapsed / stability, decay), 8)
    }

    func initStability(_ g: Double) -> Double { jsMax(w[Int(g) - 1], 0.1) }

    func initDifficulty(_ g: Double) -> Double { JSMath.toFixedNumber(w[4] - JSMath.schedExp((g - 1) * w[5]) + 1, 8) }

    func applyFuzz(_ ivl: Double, _ elapsed: Double, seed: String) -> Double {
        if !enableFuzz || ivl < 2.5 { return JSMath.round(ivl) }
        var alea = Alea(seed: seed)
        let r = alea.next()
        let (a, s) = FSRS6.fuzzRange(ivl, elapsed, maximumInterval)
        return (r * (s - a + 1) + a).rounded(.down)
    }

    /// get_fuzz_range。
    static func fuzzRange(_ i0: Double, _ t: Double, _ e: Double) -> (Double, Double) {
        var r = 1.0
        for n in fuzzRanges { r += n.factor * jsMax(jsMin(i0, n.end) - n.start, 0) }
        let i = jsMin(i0, e)
        var a = jsMax(2, JSMath.round(i - r))
        let s = jsMin(JSMath.round(i + r), e)
        if i > t { a = jsMax(a, t + 1) }
        a = jsMin(a, s)
        return (a, s)
    }

    func nextInterval(_ s: Double, _ elapsed: Double, seed: String) -> Double {
        let r = jsMin(jsMax(1, JSMath.round(s * intervalModifier)), maximumInterval)
        return applyFuzz(r, elapsed, seed: seed)
    }

    func linearDamping(_ t: Double, _ e: Double) -> Double { JSMath.toFixedNumber(t * (10 - e) / 9, 8) }

    func nextDifficulty(_ d: Double, _ g: Double) -> Double {
        let r = -w[6] * (g - 3)
        let a = d + linearDamping(r, d)
        return FSRS6.clamp(meanReversion(initDifficulty(FSRSRating.easy.rawValue), a), 1, 10)
    }

    func meanReversion(_ t: Double, _ e: Double) -> Double { JSMath.toFixedNumber(w[7] * t + (1 - w[7]) * e, 8) }

    func nextRecallStability(_ d: Double, _ s: Double, _ r: Double, _ g: Double) -> Double {
        let hard = g == FSRSRating.hard.rawValue ? w[15] : 1
        let easy = g == FSRSRating.easy.rawValue ? w[16] : 1
        let v = s * (1 + JSMath.schedExp(w[8]) * (11 - d) * JSMath.pow(s, -w[9]) * (JSMath.schedExp((1 - r) * w[10]) - 1) * hard * easy)
        return JSMath.toFixedNumber(FSRS6.clamp(v, FSRS6.sMin, 36500), 8)
    }

    func nextForgetStability(_ d: Double, _ s: Double, _ r: Double) -> Double {
        let v = w[11] * JSMath.pow(d, -w[12]) * (JSMath.pow(s + 1, w[13]) - 1) * JSMath.schedExp((1 - r) * w[14])
        return JSMath.toFixedNumber(FSRS6.clamp(v, FSRS6.sMin, 36500), 8)
    }

    func nextShortTermStability(_ s: Double, _ g: Double) -> Double {
        let r = JSMath.pow(s, -w[19]) * JSMath.schedExp(w[17] * (g - 3 + w[18]))
        let a = g >= 3 ? jsMax(r, 1) : r
        return JSMath.toFixedNumber(FSRS6.clamp(s * a, FSRS6.sMin, 36500), 8)
    }

    // MARK: 调度（BasicLearningStepsScheduler，学习步骤为空）

    static let dayMs = 86_400_000.0

    /// dateDiffInDays(a, b)：两刻的 UTC 日差（floor）。
    static func utcDayDiff(_ a: Double, _ b: Double) -> Double {
        guard a.isFinite, b.isFinite else { return .nan }
        let e = (a / dayMs).rounded(.down) * dayMs
        let r = (b / dayMs).rounded(.down) * dayMs
        return ((r - e) / dayMs).rounded(.down)
    }

    /// date_scheduler(now, t, isDay)。
    static func schedule(_ now: Double, _ t: Double, days: Bool) -> Double {
        let v = days ? now + t * 24 * 60 * 60 * 1000 : now + t * 60 * 1000
        return JSDate.timeClip(v) ?? .nan
    }

    /// fsrs.next(card, now, grade).card。
    public func next(_ card: FSRSCard, now reviewTime0: Double, grade: FSRSRating) throws -> FSRSCard {
        if grade == .manual { throw CoreError.error("Cannot review a manual rating") }
        let reviewTime = JSDate.timeClip(reviewTime0) ?? .nan
        let last = card
        var current = card
        // init()
        var elapsed = 0.0
        if current.state != FSRSState.new.rawValue, let lr = current.lastReview { elapsed = FSRS6.utcDayDiff(lr, reviewTime) }
        current.lastReview = reviewTime
        current.elapsedDays = elapsed
        current.reps += 1
        let seed = JSNumber.toString(reviewTime) + "_" + JSNumber.toString(current.reps) + "_" + JSNumber.toString(current.difficulty * current.stability)
        let g = grade.rawValue
        guard g.isFinite, g >= 0, g <= 4 else { throw CoreError.error("Invalid grade") }

        func applyLearningSteps(_ t: inout FSRSCard) {
            // 学习 / 重学步骤都为空 → scheduled_minutes = 0 → 直接进复习
            if current.learningSteps.isNaN || current.learningSteps == 0 { current.learningSteps = 0 }
            t.state = FSRSState.review.rawValue
            t.learningSteps = 0
            let n = nextInterval(t.stability, elapsed, seed: seed)
            t.scheduledDays = n
            t.due = FSRS6.schedule(reviewTime, n, days: true)
        }

        switch last.state {
        case FSRSState.new.rawValue:
            var r = current
            r.difficulty = FSRS6.clamp(initDifficulty(g), 1, 10)
            r.stability = initStability(g)
            applyLearningSteps(&r)
            return r
        case FSRSState.learning.rawValue, FSRSState.relearning.rawValue:
            var n = current
            n.difficulty = nextDifficulty(last.difficulty, g)
            n.stability = nextShortTermStability(last.stability, g)
            applyLearningSteps(&n)
            return n
        case FSRSState.review.rawValue:
            let d = last.difficulty, s = last.stability
            let rr = forgettingCurve(elapsed, s)
            var u = current, h = current, f = current, e = current
            // next_ds
            u.difficulty = nextDifficulty(d, FSRSRating.again.rawValue)
            let h0 = s / JSMath.schedExp(w[17] * w[18])
            let f0 = nextForgetStability(d, s, rr)
            u.stability = FSRS6.clamp(JSMath.toFixedNumber(h0, 8), FSRS6.sMin, f0)
            h.difficulty = nextDifficulty(d, FSRSRating.hard.rawValue)
            h.stability = nextRecallStability(d, s, rr, FSRSRating.hard.rawValue)
            f.difficulty = nextDifficulty(d, FSRSRating.good.rawValue)
            f.stability = nextRecallStability(d, s, rr, FSRSRating.good.rawValue)
            e.difficulty = nextDifficulty(d, FSRSRating.easy.rawValue)
            e.stability = nextRecallStability(d, s, rr, FSRSRating.easy.rawValue)
            // next_interval（Hard / Good / Easy）
            var si = nextInterval(h.stability, elapsed, seed: seed)
            var ni = nextInterval(f.stability, elapsed, seed: seed)
            si = jsMin(si, ni)
            ni = jsMax(ni, si + 1)
            let ui = jsMax(nextInterval(e.stability, elapsed, seed: seed), ni + 1)
            h.scheduledDays = si; h.due = FSRS6.schedule(reviewTime, si, days: true)
            f.scheduledDays = ni; f.due = FSRS6.schedule(reviewTime, ni, days: true)
            e.scheduledDays = ui; e.due = FSRS6.schedule(reviewTime, ui, days: true)
            for i in [0, 1, 2] {
                switch i {
                case 0: h.state = FSRSState.review.rawValue; h.learningSteps = 0
                case 1: f.state = FSRSState.review.rawValue; f.learningSteps = 0
                default: e.state = FSRSState.review.rawValue; e.learningSteps = 0
                }
            }
            applyLearningSteps(&u)
            u.lapses += 1
            switch grade {
            case .again: return u
            case .hard: return h
            case .good: return f
            default: return e
            }
        default:
            // 未知状态：库返回 undefined，调用方读 .card 时 TypeError
            throw CoreError.type("Cannot read properties of undefined (reading 'card')")
        }
    }

    /// get_retrievability(card, now, false)。
    public func retrievability(_ card: FSRSCard, now: Double) throws -> Double {
        if card.state == FSRSState.new.rawValue { return 0 }
        guard let lr = card.lastReview else { throw CoreError.error("Invalid date") }
        let n = JSDate.timeClip(now) ?? .nan
        let days = ((n - lr) / FSRS6.dayMs).rounded(.down)
        let s = jsMax(days, 0)
        return forgettingCurve(s, JSMath.toFixedNumber(card.stability, 8))
    }
}

// MARK: - Alea（seedrandom 的 alea，ts-fsrs 内置）

struct Alea {
    var c = 1.0
    var s0: Double, s1: Double, s2: Double

    init(seed: String) {
        var mash = Mash()
        s0 = mash.next(" ")
        s1 = mash.next(" ")
        s2 = mash.next(" ")
        s0 -= mash.next(seed)
        if s0 < 0 { s0 += 1 }
        s1 -= mash.next(seed)
        if s1 < 0 { s1 += 1 }
        s2 -= mash.next(seed)
        if s2 < 0 { s2 += 1 }
    }

    mutating func next() -> Double {
        let t = 2_091_639 * s0 + c * 2.3283064365386963e-10
        s0 = s1
        s1 = s2
        c = JSMath.toInt32(t)
        s2 = t - c
        return s2
    }
}

struct Mash {
    var n = 4_022_871_197.0
    mutating func next(_ data: String) -> Double {
        for u in data.utf16 {
            n += Double(u)
            var h = 0.02519603282416938 * n
            n = JSMath.toUint32(h)
            h -= n
            h *= n
            n = JSMath.toUint32(h)
            h -= n
            n += h * 4_294_967_296
        }
        return JSMath.toUint32(n) * 2.3283064365386963e-10
    }
}

// MARK: - Math.max / Math.min（NaN 传染、±0 区分）

@inline(__always) func jsMax(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == 0 && b == 0 { return a.sign == .minus ? b : a }
    return a > b ? a : b
}

@inline(__always) func jsMin(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == 0 && b == 0 { return a.sign == .minus ? a : b }
    return a < b ? a : b
}
