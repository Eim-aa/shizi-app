import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// 清单页只建看得见的行（ShiziLazyCells）：与全部建出来（materializeAll = 以前一次建完的做法，同一套配置代码）逐项相同。
//   框的模型 = 视图上的框（行首尾相接、清单框的高）；行内排版的记忆 = 每次现算；
//   整窗截图逐字节相同（顶 / 中 / 底，浅 / 深）；一步步滚过整个清单，每步建出来的行 = 逐个判断相交的那些、状态 = 新建一行配出来的；
//   渲染之后、排版之前先滚一下（那时建的行按旧数据配）也一样；勾着的行滚走再滚回来仍是勾着的；底栏提示的字数不看建了几行。
// 量测：BENCH library-list <ink|glyph|ink-all|glyph-all> n=300/1500/5000 …；BENCH library-list scroll …（同 LibraryBenchTests 的口径）。

@MainActor
enum LibraryListVirtual {
    static func make(all: Bool) -> LibraryListScreen {
        let vc = LibraryListScreen(screen: "library-list", entryId: all ? "eq-all" : "eq-virtual", params: ["kind": "due"])
        vc.rows.materializeAll = all
        return vc
    }

    /// 回包：n 行（LibraryBench.listPayload 的形状），各种行都有：没有笔迹小图的、没有词语的、不能勾的、小字长到折行的。
    /// selected = 勾着的行（nil = 前 5 行）；alt = 换一份（同样的序号、不同的字 / 小字 / 勾选），对照「序号重叠的另一份回包」。
    static func payload(_ n: Int, ink: Bool, selected: Set<Int>? = nil, alt: Bool = false) -> [String: Any] {
        var p = LibraryBench.listPayload(n, ink: ink)
        guard var view = p["view"] as? [String: Any], var rows = view["rows"] as? [Any] else { return p }
        var count = 0
        for i in rows.indices {
            guard var r = rows[i] as? [String: Any] else { continue }
            if alt, i % 2 == 0 { r["char"] = "永"; r["meta"] = "换过的一行 · 第 \(i) 行" }
            if i % 7 == 2 { r["noThumb"] = true; r["thumbCaption"] = "" }
            if i % 11 == 5 { r["word"] = ["pre": "", "tg": "", "post": "", "has": false] as [String: Any] }
            if i % 17 == 9 { r["meta"] = "写过 \(i % 9 + 1) 次 · 上次 \(i % 30 + 1) 天前 · 最近一次写错在很久以前的某一个下雨天" }
            let selectable = i % 13 != 8
            r["selectable"] = selectable
            let want = selected.map { $0.contains(i) } ?? (i < 5)
            let on = selectable && (alt ? !want : want)
            r["selected"] = on
            if on { count += 1 }
            rows[i] = r
        }
        view["rows"] = rows
        view["selectedCount"] = LibraryBench.num(Double(count))
        view["hint"] = ["copy": "R-E02.selected", "params": ["n": LibraryBench.num(Double(count))]] as [String: Any]
        p["view"] = view
        return p
    }

    static func find(_ v: UIView, _ id: String) -> UIView? {
        if v.accessibilityIdentifier == id { return v }
        for s in v.subviews { if let hit = find(s, id) { return hit } }
        return nil
    }

    static func text(_ v: UIView?) -> String {
        if let l = v as? UILabel { return l.attributedText?.string ?? l.text ?? "" }
        if let b = v as? UIButton { return b.currentTitle ?? b.titleLabel?.text ?? "" }
        return ""
    }

    static func imageBytes(_ img: UIImage?) -> Data? { img?.cgImage?.dataProvider?.data as Data? }

    /// 一行的状态摘要：每一样 configureRowContent / configureRowLayout 配的（藏着的子视图只记藏着）。
    struct Digest: Equatable, CustomStringConvertible {
        var frame: CGRect
        var ids: [String?]
        var selectLabel: String?
        var selectEnabled: Bool
        var selectAlpha: CGFloat
        var selectFrame: CGRect
        var check: Data?
        var dot: String
        var openComposed: String
        var openFrame: CGRect
        var glyph: Data?
        var word: String
        var wordFrame: CGRect
        var meta: String
        var metaFrame: CGRect
        var thumb: String
        var noInk: String
        var caption: String
        var ink: String
        var strokes: [[LibraryInkView.Point]]
        var chevron: String
        var separator: String

        var description: String {
            "frame=\(frame) select=\(selectLabel ?? "-")/\(check?.count ?? -1)B open=\(openComposed) word=\(word) meta=\(meta) thumb=\(thumb) ink=\(ink)/\(strokes.count) caption=\(caption)"
        }
    }

    static func digest(_ rv: LibraryListRowView, _ traits: UITraitCollection) -> Digest {
        func key(_ c: UIColor?) -> String { libraryColorKey(c?.resolvedColor(with: traits)) }
        func cg(_ c: CGColor?) -> String { c.map { libraryColorKey(UIColor(cgColor: $0)) } ?? "-" }
        func shown(_ v: UIView, _ more: String = "") -> String { v.isHidden ? "hidden" : "\(v.frame) \(more)" }
        return Digest(
            frame: rv.frame,
            ids: [rv.accessibilityIdentifier, rv.select.accessibilityIdentifier, rv.open.accessibilityIdentifier],
            selectLabel: rv.select.accessibilityLabel, selectEnabled: rv.select.isEnabled, selectAlpha: rv.select.alpha, selectFrame: rv.select.frame,
            check: imageBytes(rv.select.image(for: .normal)),
            dot: "\(rv.dot.frame) bw=\(rv.dot.layer.borderWidth) bc=\(cg(rv.dot.layer.borderColor)) bg=\(key(rv.dot.backgroundColor))",
            openComposed: rv.open.composed, openFrame: rv.open.frame,
            glyph: imageBytes(rv.open.image(for: .normal)),
            word: text(rv.word), wordFrame: rv.word.frame,
            meta: text(rv.meta), metaFrame: rv.meta.frame,
            thumb: shown(rv.thumb, "bg=\(key(rv.thumb.backgroundColor)) bw=\(rv.thumb.layer.borderWidth) bc=\(cg(rv.thumb.layer.borderColor))"),
            noInk: shown(rv.noInk, text(rv.noInk)),
            caption: shown(rv.caption, text(rv.caption)),
            ink: shown(rv.inkView, key(rv.inkView.ink)),
            strokes: rv.inkView.isHidden ? [] : rv.inkView.strokes,
            chevron: "\(rv.chevron.frame) \(imageBytes(rv.chevron.image)?.count ?? -1)",
            separator: "\(rv.separator.frame) hidden=\(rv.separator.isHidden) bg=\(cg(rv.separator.backgroundColor))")
    }

    /// 视图树：content 里的行 = 建出来的行（按序号），连成一段、紧挨在 bodyMarker 前面；别处没有行。
    static func hierarchyProblems(_ vc: LibraryListScreen) -> [String] {
        let subs = vc.content.subviews
        let have = subs.compactMap { $0 as? LibraryListRowView }
        let want = vc.rows.liveIndices.compactMap { vc.rows.slot(at: $0) }
        var out: [String] = []
        if have.count != want.count || zip(have, want).contains(where: { $0 !== $1 }) {
            out.append("content has \(have.count) rows, expected \(want.count) in index order")
        }
        if let first = have.first, let start = subs.firstIndex(where: { $0 === first }) {
            let block = subs[start..<min(subs.count, start + have.count)]
            if block.contains(where: { !($0 is LibraryListRowView) }) { out.append("rows are not contiguous") }
            let after = start + have.count
            if after >= subs.count || subs[after].accessibilityIdentifier != "native-library-list-body" { out.append("rows are not right before bodyMarker") }
        }
        for v in subs where !(v is LibraryListRowView) {
            if find(v, "native-library-list-row") != nil { out.append("a row outside content's row block") }
        }
        return out
    }

    /// 滚到 y（夹在内容范围里；不靠 UIScrollView 自己夹），排版提交。
    static func scroll(_ vc: LibraryListScreen, _ w: UIWindow, to y: CGFloat) {
        vc.scroll.contentOffset = CGPoint(x: 0, y: min(max(0, y), bottomOffset(vc)))
        LibraryBench.settle(w)
    }

    static func bottomOffset(_ vc: LibraryListScreen) -> CGFloat { max(0, vc.scroll.contentSize.height - vc.scroll.bounds.height) }

    /// 建出来的行 = 逐个判断相交的那些、没有一格用两处、每行状态 = 新建一行配出来的（按本页外观配 / 比）。
    static func check(_ vc: LibraryListScreen) -> [String] {
        let traits = vc.traitCollection
        var problems: [String] = []
        traits.performAsCurrent {
            problems = vc.rows.check(visible: vc.scroll.bounds) { digest($0, traits) }
        }
        return problems
    }

    /// 这一行看起来是勾着的：勾的图、读屏名「取消选择」、圆点实心。
    static func isChecked(_ rv: LibraryListRowView, char: String) -> Bool {
        rv.select.image(for: .normal) != nil && rv.select.accessibilityLabel == ShiziCopy.t("X-QUERY.unselectAria", ["char": char])
            && rv.dot.layer.borderWidth == 0
    }
}

@MainActor
final class LibraryListVirtualTests: XCTestCase {
    private typealias V = LibraryListVirtual

    /// 排版的框（list）= 视图上的框：行首尾相接（第一行在顶线下面）、清单框的高 = 行高之和 + 1；两种建法同一份框；
    /// 行内排版的记忆 = 现算；建出来的行的框 = 它那一行的框；底栏提示 / 主按钮 / 标题两种建法相同。
    func testFrameModelMatchesTheViews() throws {
        for n in [12, 300, 1500] {
            let payload = V.payload(n, ink: true)
            let all = V.make(all: true), virt = V.make(all: false)
            let wa = LibraryBench.host(all), wv = LibraryBench.host(virt)
            defer { LibraryBench.unhost(wa); LibraryBench.unhost(wv) }
            all.apply(payload: payload)
            virt.apply(payload: payload)
            LibraryBench.settle(wa)
            LibraryBench.settle(wv)
            let list = all.list
            XCTAssertEqual(list.frames.count, n, "n=\(n)")
            XCTAssertEqual(all.rows.liveIndices, Array(0..<n), "n=\(n): materialize-all builds every row")
            XCTAssertEqual(virt.list.frames, list.frames, "n=\(n): same frame model on both pages")
            XCTAssertEqual(virt.list.boxes, list.boxes)
            if n >= 300 { XCTAssertLessThan(virt.rows.liveIndices.count, n, "n=\(n): only part of the list is built") }
            XCTAssertEqual(virt.rows.liveIndices.first, 0, "n=\(n): the top rows are built at open")
            var y = list.top + 1
            for (i, f) in list.frames.enumerated() {
                XCTAssertEqual(f.minY, y, "n=\(n) row \(i) starts where the previous ends")
                XCTAssertEqual(f.height, list.boxes[i].rowHeight)
                y = f.maxY
            }
            XCTAssertEqual(list.height, list.boxes.reduce(0) { $0 + $1.rowHeight } + 1)
            all.traitCollection.performAsCurrent {
                for i in list.data.indices { XCTAssertEqual(list.boxes[i], all.rowBox(list.data[i], width: list.frames[i].width), "n=\(n) row \(i): memo = fresh") }
            }
            for vc in [all, virt] {
                let marker = try XCTUnwrap(V.find(vc.content, "native-library-list-rows"))
                XCTAssertEqual(marker.frame, CGRect(x: list.frames[0].minX, y: list.top, width: list.frames[0].width, height: list.height), "n=\(n) rows marker")
                for i in vc.rows.liveIndices {
                    let rv = try XCTUnwrap(vc.rows.slot(at: i))
                    XCTAssertEqual(rv.frame, list.frames[i], "n=\(n) row \(i)")
                    XCTAssertEqual(rv.open.frame, CGRect(x: 39, y: 0, width: list.frames[i].width - 39, height: list.boxes[i].openHeight))
                }
                XCTAssertEqual(V.hierarchyProblems(vc), [], "n=\(n)")
            }
            for id in ["native-library-list-hint", "native-library-list-go", "native-library-list-head", "native-library-list-note"] {
                XCTAssertEqual(V.text(V.find(virt.view, id)), V.text(V.find(all.view, id)), "n=\(n) \(id)")
            }
            XCTAssertEqual(all.scroll.contentSize, virt.scroll.contentSize)
        }
    }

    /// 整窗截图逐字节相同：只建一部分 vs 全部建出来，滚到顶 / 中间 / 底，浅 / 深。两页同时开着，每个位置各截一张就比。
    func testVirtualizedPixelsMatchMaterializeAll() throws {
        for (n, ink) in [(1500, true), (300, false)] {
            let payload = V.payload(n, ink: ink)
            let all = V.make(all: true), virt = V.make(all: false)
            let wa = LibraryBench.host(all), wv = LibraryBench.host(virt)
            defer { LibraryBench.unhost(wa); LibraryBench.unhost(wv) }
            for w in [wa, wv] { w.overrideUserInterfaceStyle = .light }
            all.apply(payload: payload)
            virt.apply(payload: payload)
            LibraryBench.settle(wa)
            LibraryBench.settle(wv)
            let bottom = V.bottomOffset(virt)
            XCTAssertGreaterThan(bottom, virt.scroll.bounds.height, "n=\(n): content is taller than a screen")
            let offsets: [(String, CGFloat)] = [("top", 0), ("middle", (bottom / 2).rounded()), ("bottom", bottom)]
            for style in [UIUserInterfaceStyle.light, .dark] {
                for w in [wa, wv] {
                    w.overrideUserInterfaceStyle = style
                    LibraryBench.settle(w)
                }
                for (name, y) in offsets {
                    V.scroll(all, wa, to: y)
                    V.scroll(virt, wv, to: y)
                    XCTAssertEqual(all.scroll.contentOffset, virt.scroll.contentOffset)
                    let label = "list n=\(n) \(ink ? "ink" : "glyph") \(style == .dark ? "dark" : "light") \(name)"
                    let a = try LibraryEq.stableSnapshot(wa, "\(label) all")
                    let b = try LibraryEq.stableSnapshot(wv, "\(label) virtual")
                    XCTAssertTrue(LibraryEq.same(a, b, label), label)
                    XCTAssertEqual(V.hierarchyProblems(virt), [], label)
                }
            }
        }
    }

    /// 一步一步滚过整个清单（300 行：每步 0.37 屏往下、2.3 屏往上；1500 行：每步 1.3 屏往下、3.1 屏往上，控制步数）：每一步之后建出来的行 = 逐个判断与可见框 ± overscan 相交的那些，
    /// 没有一行用在两处，每行的状态 = 新建一行按同一序号配出来的；视图树按序号。
    /// 中途重收同一份回包、收一份序号重叠的另一份（字 / 小字 / 勾选都换了）、收一份小的（先显式滚回顶：不靠滚动区自己夹回）也一样。
    func testScrollStress() throws {
        for (n, ink) in [(1500, true), (300, false)] {
            let vc = V.make(all: false)
            let w = LibraryBench.host(vc)
            defer { LibraryBench.unhost(w) }
            vc.apply(payload: V.payload(n, ink: ink))
            LibraryBench.settle(w)
            func verify(_ what: String) {
                let h = vc.scroll.bounds.height
                XCTAssertEqual(vc.rows.overscan, max(h * LibraryListScreen.overscanViewports, LibraryListScreen.overscanRows * vc.list.averageRowHeight), what)
                let problems = V.check(vc)
                XCTAssertEqual(Array(problems.prefix(5)), [], "\(what): \(problems.count) problem(s)")
                XCTAssertEqual(V.hierarchyProblems(vc), [], what)
            }
            verify("n=\(n) open")
            let h = vc.scroll.bounds.height, bottom = V.bottomOffset(vc)
            let down: CGFloat = n >= 1500 ? 1.3 : 0.37, up: CGFloat = n >= 1500 ? 3.1 : 2.3
            var y: CGFloat = 0, steps = 0
            while y < bottom {
                y = min(bottom, y + h * down)
                V.scroll(vc, w, to: y)
                steps += 1
                verify("n=\(n) down y=\(y)")
            }
            XCTAssertGreaterThan(steps, 5)
            XCTAssertTrue(vc.rows.liveIndices.contains(n - 1), "n=\(n): the last row is built at the bottom")
            vc.apply(payload: V.payload(n, ink: ink)) // 同一份再收一次（= 勾一下之后重拉），停在底部
            LibraryBench.settle(w)
            verify("n=\(n) reapply at bottom")
            while y > 0 {
                y = max(0, y - h * up)
                V.scroll(vc, w, to: y)
                verify("n=\(n) up y=\(y)")
                if y < bottom / 2, y > 0, steps > 0 { // 中途换一份序号重叠的回包
                    vc.apply(payload: V.payload(n, ink: ink, alt: true))
                    LibraryBench.settle(w)
                    verify("n=\(n) alt payload y=\(y)")
                    steps = 0
                }
            }
            XCTAssertTrue(vc.rows.liveIndices.contains(0))
            V.scroll(vc, w, to: bottom)
            vc.apply(payload: V.payload(12, ink: ink)) // 内容变短
            LibraryBench.settle(w)
            V.scroll(vc, w, to: 0)
            verify("n=\(n) to 12")
            XCTAssertEqual(vc.rows.liveIndices, Array(0..<12))
        }
    }

    /// 收了一份新的回包（渲染了、还没排版）就先滚了一下：这时新进来的行按上一版的数据配（序号重叠、内容不同）；
    /// 接着的排版要把它们也按新数据重配（内容的版次在排版时才换，不在渲染时换）。
    func testScrollBetweenRenderAndLayout() throws {
        for (n, ink) in [(300, true), (1500, false)] {
            let vc = V.make(all: false)
            let w = LibraryBench.host(vc)
            defer { LibraryBench.unhost(w) }
            vc.apply(payload: V.payload(n, ink: ink))
            LibraryBench.settle(w)
            let h = vc.scroll.bounds.height
            V.scroll(vc, w, to: vc.list.frames[n / 3].minY)
            let before = Set(vc.rows.liveIndices)
            vc.apply(payload: V.payload(n, ink: ink, selected: [n / 3 + 1, n / 3 + 40], alt: true))
            XCTAssertTrue(vc.view.layer.needsLayout(), "render leaves the layout pending")
            vc.scroll.contentOffset = CGPoint(x: 0, y: vc.scroll.contentOffset.y + h * 1.7) // 滚动回调里建 / 配新进来的行（还是上一版的框与数据）
            let fresh = Set(vc.rows.liveIndices).subtracting(before)
            XCTAssertFalse(fresh.isEmpty, "n=\(n): rows were built by the scroll before the layout")
            LibraryBench.settle(w)
            let problems = V.check(vc)
            XCTAssertEqual(Array(problems.prefix(5)), [], "n=\(n): \(problems.count) problem(s) after layout")
            XCTAssertEqual(V.hierarchyProblems(vc), [])
            for i in fresh where vc.rows.slot(at: i) != nil {
                let rv = try XCTUnwrap(vc.rows.slot(at: i))
                XCTAssertTrue(rv.open.composed.hasPrefix(vc.list.data[i].char + " "), "n=\(n) row \(i): content from the new payload")
                XCTAssertEqual(V.isChecked(rv, char: vc.list.data[i].char), vc.list.data[i].selected, "n=\(n) row \(i): selection from the new payload")
            }
        }
    }

    /// 勾着的行（第 3、12 行在打开时建出来的那段里；第 40 行不在，要滚过去才建）滚走（行收进池子、给别的行用）再滚回来：仍是勾着的；
    /// 拿去用的行按它自己的勾选画。底栏提示的字数（选了 3 个字）与主按钮不看建了几行：滚到哪里都一样，勾着的行一行都没建出来时也一样。
    func testSelectionSurvivesRowReuse() throws {
        let vc = V.make(all: false)
        let w = LibraryBench.host(vc)
        defer { LibraryBench.unhost(w) }
        vc.apply(payload: V.payload(1500, ink: true, selected: [3, 12, 40]))
        LibraryBench.settle(w)
        let hint = V.text(V.find(vc.view, "native-library-list-hint"))
        let go = V.text(V.find(vc.view, "native-library-list-go"))
        XCTAssertTrue(hint.contains("3"), "hint counts the model's selection: \(hint)")
        XCTAssertFalse(vc.rows.liveIndices.contains(40), "row 40 is below the built range at open")
        let row3 = try XCTUnwrap(vc.rows.slot(at: 3))
        let row4 = try XCTUnwrap(vc.rows.slot(at: 4)), row12 = try XCTUnwrap(vc.rows.slot(at: 12))
        XCTAssertTrue(V.isChecked(row3, char: vc.list.data[3].char))
        XCTAssertTrue(V.isChecked(row12, char: vc.list.data[12].char))
        XCTAssertFalse(V.isChecked(row4, char: vc.list.data[4].char))
        V.scroll(vc, w, to: vc.list.frames[700].minY)
        XCTAssertNil(vc.rows.slot(at: 3), "row 3 scrolled away")
        XCTAssertNil(vc.rows.slot(at: 12), "row 12 scrolled away")
        if let j = vc.rows.liveIndices.first(where: { vc.rows.slot(at: $0) === row3 }) {
            XCTAssertEqual(V.isChecked(row3, char: vc.list.data[j].char), vc.list.data[j].selected, "reused for row \(j)")
        }
        for i in vc.rows.liveIndices {
            let rv = try XCTUnwrap(vc.rows.slot(at: i))
            XCTAssertEqual(V.isChecked(rv, char: vc.list.data[i].char), vc.list.data[i].selected, "row \(i)")
        }
        XCTAssertEqual(V.text(V.find(vc.view, "native-library-list-hint")), hint, "hint with neither checked row built")
        XCTAssertEqual(V.text(V.find(vc.view, "native-library-list-go")), go)
        V.scroll(vc, w, to: 0)
        let back3 = try XCTUnwrap(vc.rows.slot(at: 3)), back12 = try XCTUnwrap(vc.rows.slot(at: 12)), back4 = try XCTUnwrap(vc.rows.slot(at: 4))
        XCTAssertTrue(V.isChecked(back3, char: vc.list.data[3].char), "row 3 still checked")
        XCTAssertTrue(V.isChecked(back12, char: vc.list.data[12].char), "row 12 still checked")
        XCTAssertFalse(V.isChecked(back4, char: vc.list.data[4].char))
        XCTAssertEqual(V.text(V.find(vc.view, "native-library-list-hint")), hint)
        V.scroll(vc, w, to: vc.list.frames[40].minY) // 第 40 行要滚过去才建出来
        let back40 = try XCTUnwrap(vc.rows.slot(at: 40))
        XCTAssertTrue(V.isChecked(back40, char: vc.list.data[40].char), "row 40 checked once built")
        XCTAssertEqual(V.text(V.find(vc.view, "native-library-list-hint")), hint)
        // 勾着的三行都在很后面（打开时没建出来）：提示照样是 3 个字
        let far = V.make(all: false)
        let wf = LibraryBench.host(far)
        defer { LibraryBench.unhost(wf) }
        far.apply(payload: V.payload(1500, ink: true, selected: [1400, 1450, 1499]))
        LibraryBench.settle(wf)
        XCTAssertFalse(far.rows.liveIndices.contains(1400))
        XCTAssertEqual(V.text(V.find(far.view, "native-library-list-hint")), hint)
    }
}

// MARK: - 量测

@MainActor
final class LibraryListBenchTests: XCTestCase {
    /// BENCH library-list <ink|glyph> n=300/1500/5000（产品：只建看得见的行）；n = 1500 另量 ink-all / glyph-all（全部行都建出来 = 以前的做法）。
    func testLibraryListVirtualReloadCost() throws {
        for n in [300, 1500, 5000] {
            for ink in [true, false] {
                let payload = LibraryBench.listPayload(n, ink: ink)
                LibraryBench.run("library-list", variant: ink ? "ink" : "glyph", n: n, make: { LibraryListVirtual.make(all: false) }, payload: payload)
                if n == 1500 {
                    LibraryBench.run("library-list", variant: ink ? "ink-all" : "glyph-all", n: n, make: { LibraryListVirtual.make(all: true) }, payload: payload)
                }
            }
        }
    }

    /// BENCH library-list scroll <ink|glyph> n=… steps=… step=…pt median=…ms max=…ms live=<建出来的行数> layers=… backing≈…MB
    /// 从顶滚到底，每步半屏（contentOffset → layoutIfNeeded → flush：新进来的行在这一步里建 / 配 / 画）。
    func testLibraryListScrollCost() throws {
        for n in [1500, 5000] {
            for ink in [true, false] {
                autoreleasepool {
                    let vc = LibraryListVirtual.make(all: false)
                    let w = LibraryBench.host(vc)
                    vc.apply(payload: LibraryBench.listPayload(n, ink: ink))
                    LibraryBench.settle(w)
                    let h = vc.scroll.bounds.height
                    let bottom = max(0, vc.scroll.contentSize.height - h)
                    var times: [Double] = []
                    var y: CGFloat = 0
                    while y < bottom {
                        y = min(bottom, y + h / 2)
                        let t = LibraryBench.now()
                        vc.scroll.contentOffset = CGPoint(x: 0, y: y)
                        LibraryBench.settle(w)
                        times.append(LibraryBench.ms(t, LibraryBench.now()))
                    }
                    let st = LibraryBench.layerStats(w.layer)
                    print(String(format: "BENCH library-list scroll \(ink ? "ink" : "glyph") n=%ld steps=%ld step=%.0fpt median=%.1fms max=%.1fms live=%ld layers=%ld backing≈%.1fMB",
                                 n, times.count, Double(h / 2), LibraryBench.median(times), times.max() ?? 0, vc.rows.liveIndices.count, st.layers, Double(st.backingBytes) / 1e6))
                    LibraryBench.unhost(w)
                }
            }
        }
    }
}
