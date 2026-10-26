import XCTest

// QA-H1：写字流程确认单（docs/engineering/v10/B2-写字流程确认单.md）2–7 段与恢复，原生写字页上的真实触摸路线。
// 数据：「这次选的字」5 字组（永 和 春 日 月，B 槽，有「跳过」「结束这组」），由 -shizi-qa-seed 注入到指定状态。
// 每步断言：页面（探针 native.shown / route.top）、文案（原生元素名称）、按钮状态（isEnabled）、store（记录条数与种类、会话 cursor / 阶段 / 笔数）。
// 对应 AI 流程报告「已验证正常的路径」1–8、11（KnownIssueTests 里的 VerifiedPathIndex 有编号对照）。

@MainActor
final class WriteFlowTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    // MARK: §2 回忆阶段

    /// §2：页头 ‹ / 进度 / 结束这组 / 跳过；撤销 / 清空；提示 / 看答案；写好了（没写不能点）。落笔、撤销、清空（清空后可撤销一次）。
    func test201_recallLayoutUndoClear() {
        let qa = QA(seed: "recall")
        qa.launch()
        XCTAssertTrue(qa.nativeShown)
        XCTAssertEqual(qa.el("native-write-progress").label, "第 1 个字，共 5 个")
        for id in ["native-write-back", "native-write-end", "native-write-skip", "native-write-undo", "native-write-clear", "native-write-hint", "native-write-show-answer", "native-write-done"] {
            XCTAssertTrue(qa.el(id).exists, "\(id) shown")
        }
        XCTAssertEqual(qa.el("native-write-end").label, "结束这组")
        XCTAssertEqual(qa.el("native-write-skip").label, "跳过")
        XCTAssertEqual(qa.el("native-write-done").label, "写好了")
        XCTAssertFalse(qa.el("native-write-done").isEnabled, "写好了 disabled before any stroke")
        qa.stroke()
        XCTAssertTrue(qa.el("native-write-done").isEnabled, "写好了 enabled after a stroke")
        qa.waitProbe("stroke written back (P52)") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["strokes"] as? Int == 1 }
        qa.stroke(from: CGVector(dx: 0.5, dy: 0.2), to: CGVector(dx: 0.5, dy: 0.8))
        qa.tapNative("native-write-undo")
        XCTAssertEqual(qa.native["strokes"] as? Int, 1, "undo removes one stroke")
        qa.tapNative("native-write-clear")
        qa.waitProbe("cleared") { (($0["native"] as? [String: Any])?["strokes"] as? Int) == 0 }
        XCTAssertFalse(qa.el("native-write-done").isEnabled)
        qa.tapNative("native-write-undo")
        qa.waitProbe("undo after clear restores once") { (($0["native"] as? [String: Any])?["strokes"] as? Int) == 1 }
        XCTAssertEqual(qa.records, 0, "writing records nothing")
    }

    /// §2：左上「‹」= 离开，回到来源（首页），现场在（再进回到同一字、同一笔迹）。
    func test202_recallBackKeepsTheSceneAndReturnsToSource() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.session()["strokes"] as? Int, 2, "strokes kept in the session (P52)")
        XCTAssertEqual(qa.session()["cursor"] as? Int, 0)
        XCTAssertEqual(qa.records, 0)
    }

    /// §2 / N3：左缘右滑 = 左上「‹」（回忆阶段 = 离开）。
    func test203_recallEdgeSwipeLeaves() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        qa.edgeBack()
        qa.waitNative(false)
        qa.waitRouteTop("home")
        // 注入的写字页是程序打开的（T-quiet）：左缘跟手画 T-quiet 倒放（N3-3：看它是怎么进来的）
        XCTAssertTrue(qa.transitions.contains("drag:quiet"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("dismiss:quiet:interactive"), "interactive back: \(qa.transitions)")
        XCTAssertEqual(qa.session()["strokes"] as? Int, 2)
    }

    /// R10-A（D71 ②）：书写格里任意位置起笔，每一笔都保留——笔画数 = 落笔数。九宫格各区与四边内 2–30pt（含左缘附近起笔向右写横，
    /// 系统左缘识别器的起手区会伸进书写格）；每一笔的结局看 DEBUG 笔画日志（探针 native.inkLog：ended / cancel:<谁>）。
    func test204_everyStrokeInTheGridIsKept() {
        let qa = QA(seed: "recall")
        qa.launch()
        let g = qa.el("native-write-grid")
        XCTAssertTrue(g.waitForExistence(timeout: 5))
        let f = g.frame
        var starts: [(String, CGPoint, CGVector)] = [] // 名字、格内起点（pt）、方向（pt）
        for (i, fx) in [0.15, 0.5, 0.85].enumerated() {
            for (j, fy) in [0.15, 0.5, 0.85].enumerated() {
                starts.append(("cell\(i)\(j)", CGPoint(x: f.width * fx, y: f.height * fy), CGVector(dx: f.width * (fx < 0.6 ? 0.12 : -0.12), dy: 0)))
            }
        }
        for d in [2.0, 6, 10, 16, 24, 30] { // 左缘：系统左缘识别器的起手区（40.2pt）盖到格内约 20pt
            starts.append(("left\(Int(d))", CGPoint(x: d, y: f.height * 0.4), CGVector(dx: 90, dy: 0)))
            starts.append(("leftLow\(Int(d))", CGPoint(x: d, y: f.height * 0.8), CGVector(dx: 90, dy: 4)))
        }
        for d in [2.0, 12, 30] {
            starts.append(("right\(Int(d))", CGPoint(x: f.width - d, y: f.height * 0.4), CGVector(dx: -90, dy: 0)))
            starts.append(("top\(Int(d))", CGPoint(x: f.width * 0.5, y: d), CGVector(dx: 0, dy: 90)))
            starts.append(("bottom\(Int(d))", CGPoint(x: f.width * 0.5, y: f.height - d), CGVector(dx: 0, dy: -90)))
            starts.append(("bottomLeft\(Int(d))", CGPoint(x: d, y: f.height - d), CGVector(dx: 80, dy: -40)))
        }
        var expected = 0
        var lost: [String] = []
        for (name, p, v) in starts {
            let before = qa.native["strokes"] as? Int ?? -1
            let a = g.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: p.x, dy: p.y))
            // 慢写与快写（快写的横画最容易被左缘识别器认成返回：它按速度往回推算起手点）
            a.press(forDuration: expected % 2 == 0 ? 0.05 : 0, thenDragTo: a.withOffset(v), withVelocity: expected % 2 == 0 ? 300 : 1200, thenHoldForDuration: 0.02)
            Thread.sleep(forTimeInterval: 0.3)
            let n = qa.native
            let after = n["strokes"] as? Int ?? -1
            if !qa.nativeShown { XCTFail("\(name): left the page"); break }
            let log = n["inkLog"] as? [String] ?? []
            if after != before + 1 || log.last?.hasPrefix("ended") != true {
                lost.append("\(name) \(before)→\(after) log=\(log.suffix(3))")
            }
            // 左缘起手区里的格内起笔：左缘识别器被问到、并把触摸让给了书写（没有这一条 = 规则没接上）
            if p.x + f.minX < 40, !log.suffix(4).contains("edge-back yields to ink") {
                lost.append("\(name): edge-back recognizer was not refused; log=\(log.suffix(4))")
            }
            expected += 1
            if after >= 10 { // 格里画满了：清空接着画（清空不影响要测的东西）
                qa.tapNative("native-write-clear")
                qa.waitProbe("cleared") { (($0["native"] as? [String: Any])?["strokes"] as? Int) == 0 }
            }
        }
        XCTAssertEqual(lost, [], "every stroke started inside the grid is kept (\(starts.count) strokes)")
    }

    /// R10-A：快速连写（笔与笔之间不停）、写完立刻点「写好了」——每一笔都在，判断页与会话的笔数 = 落笔数；
    /// 判断后下一个字（结果行在格下、说明位热区往上伸）第一笔落在格的左下 / 正下 / 右下边缘附近也保留。
    func test205_rapidStrokesThenDoneKeepEveryStroke() {
        let qa = QA(seed: "recall")
        qa.launch()
        let g = qa.el("native-write-grid")
        XCTAssertTrue(g.waitForExistence(timeout: 5))
        let starts: [CGVector] = [CGVector(dx: 0.03, dy: 0.3), CGVector(dx: 0.5, dy: 0.1), CGVector(dx: 0.05, dy: 0.6), CGVector(dx: 0.9, dy: 0.9)]
        for p in starts {
            let a = g.coordinate(withNormalizedOffset: p)
            a.press(forDuration: 0, thenDragTo: a.withOffset(CGVector(dx: p.dx < 0.6 ? 80 : -80, dy: 10)), withVelocity: 1000, thenHoldForDuration: 0)
        }
        qa.el("native-write-done").tap()
        qa.waitProbe("judge page with all strokes") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        XCTAssertEqual(qa.native["strokes"] as? Int, starts.count, "log=\(qa.native["inkLog"] ?? "-")")
        qa.waitProbe("session has every stroke") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["strokes"] as? Int == starts.count }
        // 判断 → 下一个字：结果行出现，第一笔落在格下沿附近
        Thread.sleep(forTimeInterval: 1.0) // 判断两键就绪
        qa.tapNative("native-write-wrong")
        qa.waitProbe("next card") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
        Thread.sleep(forTimeInterval: 0.6)
        let f = g.frame
        var n = 0
        for (dx, dy) in [(4.0, f.height - 4), (f.width / 2, f.height - 3), (f.width - 5, f.height - 6), (3.0, f.height / 2)] {
            let a = g.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: dx, dy: dy))
            a.press(forDuration: 0, thenDragTo: a.withOffset(CGVector(dx: dx < f.width / 2 ? 70 : -70, dy: -50)), withVelocity: 900, thenHoldForDuration: 0)
            n += 1
            Thread.sleep(forTimeInterval: 0.35)
            XCTAssertEqual(qa.native["strokes"] as? Int, n, "stroke \(n) from (\(dx), \(dy)) kept; log=\((qa.native["inkLog"] as? [String] ?? []).suffix(3))")
            XCTAssertFalse(qa.native["sheet"] as? Bool ?? false, "no sheet opened by a stroke")
        }
    }

    /// R11-B（D72 ③）：从格上方 / 右侧 / 下方的页面空白处起手、滑进书写格——出墨、笔数 +1、这一笔从格边开始（日志 enter 点在边上）。
    func test206_strokeStartedOutsideTheGridBeginsAtTheEdge() {
        let qa = QA(seed: "recall")
        qa.launch()
        let g = qa.el("native-write-grid")
        XCTAssertTrue(g.waitForExistence(timeout: 5))
        let f = g.frame
        let origin = qa.app.coordinate(withNormalizedOffset: .zero)
        // 名字、起点（屏幕 pt）、终点（屏幕 pt）、进入点在哪条边上（书写面坐标的 x 或 y）
        let cases: [(String, CGPoint, CGPoint, String)] = [
            ("above", CGPoint(x: f.midX - 30, y: f.minY - 14), CGPoint(x: f.midX - 30, y: f.minY + 120), String(format: "y=%.1f", 0.0)),
            ("right", CGPoint(x: f.maxX + 12, y: f.minY + f.height * 0.4), CGPoint(x: f.maxX - 140, y: f.minY + f.height * 0.4), String(format: "x=%.1f", Double(f.width))),
            ("below", CGPoint(x: f.midX, y: f.maxY + 26), CGPoint(x: f.midX + 10, y: f.maxY - 140), String(format: "y=%.1f", Double(f.height))),
        ]
        for (i, (name, a, b, edge)) in cases.enumerated() {
            let from = origin.withOffset(CGVector(dx: a.x, dy: a.y))
            from.press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: b.x, dy: b.y)), withVelocity: 400, thenHoldForDuration: 0.02)
            Thread.sleep(forTimeInterval: 0.35)
            let n = qa.native
            let log = n["inkLog"] as? [String] ?? []
            XCTAssertTrue(qa.nativeShown, "\(name): still on the page")
            XCTAssertEqual(n["strokes"] as? Int, i + 1, "\(name): one more stroke; log=\(log.suffix(4))")
            XCTAssertEqual(log.last?.hasPrefix("ended"), true, "\(name): stroke kept; log=\(log.suffix(4))")
            let enter = log.suffix(4).first { $0.hasPrefix("enter ") } ?? ""
            XCTAssertTrue(enter.contains(edge), "\(name): stroke starts on the grid edge (\(edge)); got \(enter); log=\(log.suffix(4))")
        }
        qa.waitProbe("session strokes") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["strokes"] as? Int == cases.count }
    }

    /// R11-B（D72 ③）：起手在按钮（撤销）上、滑进书写格——仍是按钮：滑走 = 取消按钮，不出墨、不撤销。
    func test207_strokeStartedOnAButtonStaysTheButton() {
        let qa = QA(seed: "recall")
        qa.launch()
        qa.stroke()
        XCTAssertEqual(qa.native["strokes"] as? Int, 1)
        Thread.sleep(forTimeInterval: 0.5) // 0.4s 防误点之外：按下撤销是有效的按下
        let undo = qa.el("native-write-undo")
        XCTAssertTrue(undo.exists)
        let g = qa.el("native-write-grid")
        let into = g.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.4))
        undo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.05, thenDragTo: into, withVelocity: 400, thenHoldForDuration: 0.02)
        Thread.sleep(forTimeInterval: 0.5)
        let n = qa.native
        XCTAssertEqual(n["strokes"] as? Int, 1, "no ink and no undo; log=\((n["inkLog"] as? [String] ?? []).suffix(4))")
        XCTAssertFalse((n["inkLog"] as? [String] ?? []).suffix(3).contains { $0.hasPrefix("enter ") }, "button touch never becomes a stroke")
    }

    /// R11-B（D72 ③）：起手在屏幕左缘、滑进书写格——仍是左缘返回（R10-A 规则不变）：离开写字页，不出墨。
    func test208_strokeStartedAtTheLeftEdgeIsStillBack() {
        let qa = QA(seed: "recall")
        qa.launch()
        let f = qa.el("native-write-grid").frame
        let origin = qa.app.coordinate(withNormalizedOffset: .zero)
        qa.edgeBack(from: origin.withOffset(CGVector(dx: 2, dy: f.midY)), to: origin.withOffset(CGVector(dx: f.midX + 120, dy: f.midY)))
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.session()["strokes"] as? Int, 0, "the edge swipe wrote nothing")
    }

    // MARK: §3 提示

    /// §3（D64 ①）：每点一次多给一段，可点到整字；整字给完按钮变灰、记看过答案。
    func test301_hintStepsUpToTheWholeChar() {
        let qa = QA(seed: "recall")
        qa.launch()
        let hint = qa.el("native-write-hint")
        qa.tap(hint, "提示")
        qa.waitProbe("1 hint") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["hints"] as? Int == 1 }
        var taps = 1
        while !hint.label.contains("用完") && taps < 10 {
            qa.tap(hint, "提示")
            taps += 1
        }
        XCTAssertTrue(hint.label.contains("用完"), "hint button greyed (提示已用完) after the whole char: \(hint.label)")
        qa.waitProbe("whole char = answer seen") { ($0["kinds"] as? [String: Int])?["answer-seen"] == 1 }
        XCTAssertGreaterThanOrEqual(qa.session()["hints"] as? Int ?? 0, 2)
    }

    // MARK: §4 看答案

    /// §4（D64 ②）：看答案 → 描一遍（记为看过答案。主按钮凭记忆写、另有下一个）→ 凭记忆写（再描一遍 / 下一个）→ 下一个。
    func test401_showAnswerTraceRetraceNext() {
        let qa = QA(seed: "recall")
        qa.launch()
        qa.tapNative("native-write-show-answer")
        qa.waitProbe("trace") { (($0["native"] as? [String: Any])?["phase"] as? String) == "trace" }
        XCTAssertEqual(qa.kinds["answer-seen"], 1)
        XCTAssertTrue(qa.el("native-write-progress").label.contains("描一遍"), qa.el("native-write-progress").label)
        XCTAssertTrue(qa.textContaining("记为看过答案").exists)
        XCTAssertEqual(qa.el("native-write-trace-done").label, "凭记忆写")
        XCTAssertTrue(qa.el("native-write-answer-next").exists, "下一个 in the help row")
        Thread.sleep(forTimeInterval: 1.8) // 笔顺快放 ≤ 1.6s
        qa.stroke()
        qa.tapNative("native-write-trace-done")
        qa.waitProbe("retrace") { (($0["native"] as? [String: Any])?["phase"] as? String) == "retrace" }
        XCTAssertEqual(qa.native["strokes"] as? Int, 0, "凭记忆写 starts on an empty grid")
        XCTAssertEqual(qa.el("native-write-retrace").label, "再描一遍")
        XCTAssertEqual(qa.el("native-write-next").label, "下一个")
        qa.stroke()
        qa.tapNative("native-write-next")
        qa.waitProbe("next card") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
        XCTAssertEqual(qa.kinds["judged"] ?? 0, 0, "看答案 does not judge")
        XCTAssertEqual(qa.el("native-write-progress").label, "第 2 个字，共 5 个")
    }

    /// §4：描一遍阶段杀进程重开，恢复到描一遍（AI 流程报告已验证路径 5）。
    func test402_traceRestoresAfterRelaunch() {
        let qa = QA(seed: "trace")
        qa.launch()
        XCTAssertEqual(qa.native["phase"] as? String, "trace")
        qa.relaunchWithoutSeed()
        qa.waitNative(true, timeout: 15)
        XCTAssertEqual(qa.native["phase"] as? String, "trace", "back in 描一遍 after relaunch")
    }

    // MARK: §5 判断页

    /// §5：写好了 → 判断页（写对了吗？两键）；「‹ 接着写」回到书写格、笔迹原样；左缘滑回同样。
    func test501_judgeBackAndEdgeKeepInk() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        qa.tapNative("native-write-done")
        qa.waitProbe("compare") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        XCTAssertTrue(qa.el("native-write-progress").label.contains("写对了吗"), "title: \(qa.el("native-write-progress").label)")
        XCTAssertEqual(qa.el("native-write-wrong").label, "写错了")
        XCTAssertEqual(qa.el("native-write-correct").label, "写对了")
        qa.tapNative("native-write-back")
        qa.waitProbe("recall again") { (($0["native"] as? [String: Any])?["phase"] as? String) == "recall" }
        XCTAssertEqual(qa.native["strokes"] as? Int, 2, "ink kept")
        qa.tapNative("native-write-done")
        qa.waitProbe("compare 2") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        qa.edgeBack()
        qa.waitProbe("recall via edge") { (($0["native"] as? [String: Any])?["phase"] as? String) == "recall" }
        XCTAssertTrue(qa.nativeShown, "edge in the judge phase = 接着写, not leave")
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
        XCTAssertEqual(qa.records, 0)
    }

    /// §5：判断后直接下一字；格下「「永」记为写错 · 修改 ›」；记录一条、FSRS 写入。
    func test502_judgeAdvancesAndShowsTheLine() {
        let qa = QA(seed: "judge")
        qa.launch()
        qa.tapNative("native-write-wrong")
        qa.waitProbe("advanced") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int, 1)
        XCTAssertEqual(qa.probe["sched"] as? Int, 1)
        XCTAssertEqual(qa.el("native-write-progress").label, "第 2 个字，共 5 个")
        XCTAssertTrue(qa.el("native-write-line").label.contains("记为写错"), "line: \(qa.el("native-write-line").label)")
        XCTAssertTrue(qa.el("native-write-line-change").exists, "修改 › shown")
        XCTAssertEqual(qa.native["phase"] as? String, "recall")
    }

    /// §5（D19）：「修改 ›」改判弹层 → 改为写对：只改这一次，记录条数不变。
    func test503_changeSheetFlipsOnlyThisOnce() {
        let qa = QA(seed: "line")
        qa.launch()
        let change = qa.el("native-write-line-change")
        XCTAssertTrue(change.waitForExistence(timeout: 5))
        change.tap() // 按钮本身（热区）——文字中心那一点见 KnownIssueTests NP-01
        XCTAssertTrue(qa.el("native-change-title").waitForExistence(timeout: 5), "change sheet shown")
        XCTAssertTrue(qa.el("native-change-title").label.contains("永"))
        qa.tapNative("native-change-flip")
        qa.waitProbe("flipped") { ($0["judgedCorrect"] as? Int) == 1 && ($0["judgedWrong"] as? Int) == 0 }
        XCTAssertEqual(qa.records, 1, "no extra record")
        XCTAssertFalse(qa.el("native-change-title").exists, "sheet closed")
        XCTAssertTrue(qa.el("native-write-line").label.contains("写对"), "line: \(qa.el("native-write-line").label)")
    }

    /// D66 ⑮（R9-B，NP-04；B3.7 起字详情是原生页）：改判弹层「看这个字 ›」→ 关弹层、推入这个字的原生详情（T-push，盖在原生写字页上面——不再让开给网页）；
    /// 详情返回 → 写字页就在下面（同一个对象），结果行仍在、不多记。
    func test504_changeSheetViewCharOpensTheDetailAndComesBack() {
        let qa = QA(seed: "line")
        qa.launch()
        qa.tapNative("native-write-line-change")
        XCTAssertTrue(qa.el("native-change-title").waitForExistence(timeout: 5), "change sheet shown")
        qa.tapNative("native-change-detail")
        qa.waitRouteTop("detail")
        XCTAssertTrue(qa.el("native-detail-practice").waitForExistence(timeout: 6), "native detail page on top")
        XCTAssertTrue(qa.transitions.contains("screen:open detail via=push"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("yield:under-native"), "write page stays under the native detail: \(qa.transitions)")
        XCTAssertTrue(qa.webNav.contains("push:native"), "\(qa.webNav)")
        qa.edgeBack()
        qa.waitRouteTop("write")
        XCTAssertTrue(qa.el("native-write-line-change").waitForExistence(timeout: 4), "result line still there")
        XCTAssertTrue(qa.nativeShown, "the same native write page")
        XCTAssertEqual(qa.records, 1, "nothing recorded on the way")
    }

    // MARK: §6 跳过

    /// §6：跳过直接生效；「已跳过「永」· 撤销」；撤销回到被跳过的字。
    func test601_skipAndUndo() {
        let qa = QA(seed: "recall")
        qa.launch()
        // 撤销窗口只有 5 秒：跳过后立刻读撤销条、点撤销，store 断言放在后面
        qa.el("native-write-skip").tap()
        let text = qa.el("native-write-undo-text")
        XCTAssertTrue(text.waitForExistence(timeout: 3), "undo bar shown")
        XCTAssertTrue(text.label.contains("已跳过「永」"), text.label)
        qa.tapUndoBar()
        qa.waitProbe("undone") { ($0["kinds"] as? [String: Int])?["skipped"] == nil && (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 0 }
        XCTAssertEqual(qa.el("native-write-progress").label, "第 1 个字，共 5 个")
        // 再跳过一次、不撤销：记一条 skipped、推进到第 2 字
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-write-skip")
        qa.waitProbe("skipped") { ($0["kinds"] as? [String: Int])?["skipped"] == 1 && (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
    }

    /// §6 / §8：最后一字跳过 → 直接结果页（无中间页），撤销条跟到结果页，5 秒内撤销回到写字页同一字。
    func test602_skipTheLastCharGoesToResultWithUndo() {
        let qa = QA(seed: "last")
        qa.launch()
        XCTAssertEqual(qa.el("native-write-progress").label, "第 5 个字，共 5 个")
        qa.tapNative("native-write-skip")
        // 撤销窗口只有 5 秒：直接等撤销条（原生结果页上），路由与写字页的断言放到撤销之后
        qa.waitProbe("skip undo handed to the result page (S4)") { (($0["result"] as? [String: Any])?["undoBar"] as? Bool) == true } // B2.7：原生结果页的撤销条
        qa.tapUndoBar()
        qa.waitNative(true)
        qa.waitProbe("back on the last char") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 4 }
        XCTAssertEqual(qa.kinds["skipped"] ?? 0, 0)
    }

    // MARK: §7 结束这组

    /// §7：零判断 → 结束 → 回到来源页（首页），不进结果页。
    func test701_endWithZeroJudgedReturnsToSource() {
        let qa = QA(seed: "recall")
        qa.launch()
        qa.tapNative("native-write-end")
        XCTAssertTrue(qa.el("native-write-end-body").waitForExistence(timeout: 3), "confirm dialog")
        XCTAssertEqual(qa.el("native-write-end-confirm").label, "结束这组")
        XCTAssertEqual(qa.el("native-write-end-continue").label, "接着写")
        qa.tapNative("native-write-end-confirm")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.session()["ended"] as? Bool ?? true, true)
    }

    /// §7：有判断 → 结束 → 结果页。
    func test702_endWithJudgedGoesToResult() {
        let qa = QA(seed: "end-dialog")
        qa.launch()
        XCTAssertTrue(qa.el("native-write-end-body").waitForExistence(timeout: 3))
        qa.tapNative("native-write-end-confirm")
        qa.waitNative(false)
        qa.waitRouteTop("result")
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int, 1)
    }

    /// §7：「接着写」关掉确认框，留在原字。
    func test703_endDialogContinueStays() {
        let qa = QA(seed: "end-dialog")
        qa.launch()
        qa.tapNative("native-write-end-continue")
        XCTAssertFalse(qa.el("native-write-end-body").exists)
        XCTAssertTrue(qa.nativeShown)
        XCTAssertEqual(qa.session()["cursor"] as? Int, 1)
    }

    // MARK: §8 写完 → 结果页

    /// §8：最后一字判断后直接换成结果页（淡出，无中间页）；记录 5 条。
    func test801_lastJudgeGoesStraightToResult() {
        let qa = QA(seed: "last-judge")
        qa.launch()
        qa.tapNative("native-write-correct")
        qa.waitNative(false)
        qa.waitRouteTop("result")
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int ?? 0 + (qa.probe["judgedCorrect"] as? Int ?? 0), qa.probe["judgedWrong"] as? Int ?? 0)
        XCTAssertEqual((qa.probe["judgedWrong"] as? Int ?? 0) + (qa.probe["judgedCorrect"] as? Int ?? 0), 5)
        XCTAssertTrue(qa.transitions.contains("present:phase"), "T-phase into the result page: \(qa.transitions)")
    }

    // MARK: 恢复

    /// 杀进程重开：回到原来那个字、原来的笔迹（确认单 §1「写到一半离开」/ Q32）。
    func test901_killAndRelaunchRestoresCardAndInk() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        let key = qa.native["cardKey"] as? String
        qa.relaunchWithoutSeed()
        qa.waitNative(true, timeout: 15)
        XCTAssertEqual(qa.native["cardKey"] as? String, key)
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
        XCTAssertTrue(qa.transitions.contains { $0.contains("animate=false") }, "cold restore without animation: \(qa.transitions)")
    }

    /// 判断页杀进程重开：回到判断页（W10）。
    func test902_killInJudgeRestoresJudge() {
        let qa = QA(seed: "judge")
        qa.launch()
        qa.relaunchWithoutSeed()
        qa.waitNative(true, timeout: 15)
        XCTAssertEqual(qa.native["phase"] as? String, "compare")
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
    }
}
