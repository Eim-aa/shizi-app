import Foundation

extension CoreEngine {
    static let sessionRawOps: [String: Op] = [
        "session.environment": { e,a in
            let store = try e.session().store!, hooks = SessionActionHooks();var loads = 0
            let provider = EtymologyProvider { loads += 1; let value = a["loads"]?.arrayValue.flatMap { loads <= $0.count ? $0[loads-1] : nil }; if value == .string("throw") { throw CoreError.error("fetch") };return value }
            hooks.charData = provider
            if let build = a["build"] { hooks.build = { if a["buildThrows"] == .bool(true) { throw CoreError.error("host-build") };return build } }
            hooks.native = a["native"] == .bool(true)
            if a["image"] == .bool(true) { hooks.set("detail.image") { _ in .null } }
            for name in ["s02Body","cardAction"] { if let value = a["layout"] { hooks.queryLayout[name] = { _ in if a["layoutThrows"] == .bool(true) { throw CoreError.error("host-layout") };return value } } }
            if let value = a["breaker"] { hooks.lineBreaker = { _,_ in if a["breakerThrows"] == .bool(true) { throw CoreError.error("host-breaker") };return value } }
            let done = DispatchSemaphore(value:0);var replies: [JSValue] = []
            Task { for request in a["requests"]?.arrayValue ?? [] { replies.append(await PageAPI.callAsync(JS.string(request["op"]),store:store,args:request["args"]?.objectValue ?? JSObject(),hooks:hooks)) };done.signal() };done.wait()
            return JS.obj([("replies",.array(replies)),("loads",.number(Double(loads)))])
        },
        "session.queryHost": { e,a in queryHost(try e.session().store,a) },
        "session.pageRegistered": { e,a in
            let store = try e.session().store!, hooks = SessionActionHooks(), pages = PageRegisteredActions(store: store)
            pages.clockNow = { e.clock }; pages.handoffLeaveUndo(a["undo"]); pages.install(on: hooks)
            let reply = PageAPI.call(JS.string(a["op"]), store: store, args: a["args"]?.objectValue ?? JSObject(), hooks: hooks)
            return JS.obj([("reply", reply), ("undo", pages.leaveUndoView())])
        },
        "session.imageRegistered": { e,a in
            let store = try e.session().store!, hooks = SessionActionHooks(), image = ImageRegisteredActions(store: store)
            if let palette = a["palette"] { image.palette = { palette } }
            image.saveFile = { _ in JS.obj([("ok", .bool(a["save"] == .bool(true))), ("via", .string("download"))]) }; image.install(on: hooks)
            if a["op"] == .string("persist") {
                let semaphore = DispatchSemaphore(value: 0); var reply: JSValue = .null
                Task { reply = await PageAPI.callAsync("image.persist", store: store, args: a["args"]?.objectValue ?? JSObject(), hooks: hooks); semaphore.signal() }; semaphore.wait(); return reply
            }
            return PageAPI.call("image." + JS.string(a["op"]), store: store, args: a["args"]?.objectValue ?? JSObject(), hooks: hooks)
        },
        "session.hintHelper": { _,a in try SessionHints.helper(JS.string(a["name"]), a["input"]?.objectValue ?? JSObject()) },
        "session.rememberInk": { _,a in RecentInk.page.rememberInk(a["recordId"], a["strokes"]); return .null },
        "session.recalledInk": { _,a in RecentInk.page.recalledInk(a["recordId"], policy: a["policy"] ?? Config.policy) },
        "session.forgetRecentInk": { _,_ in .number(Double(RecentInk.page.forgetRecentInk())) },
        "session.sheet": { e,a in try WriteModels.sheet(e.session().store, a["record"] ?? .null, policy: a["policy"] ?? Config.policy) },
        "session.writeHost": { e,a in try writeHost(e.session().store, a) },
        "session.resultModel": { e,a in try ResultModels.model(a["state"]?.objectValue ?? e.session().store.state, a, dates: e.dates) },
        "session.resultLeave": { _,a in try ResultModels.leaveOf(a["source"]) },
        "session.firstExtras": { e,a in try ResultModels.firstExtras(a, dates: e.dates) },
        "session.daysLaterOf": { e,a in try ResultModels.daysLaterOf(a, dates: e.dates) },
        "session.strokes": { e,a in SessionWrites.commitStrokes(try e.session().store, a) },
        "session.recover": { e,a in try SessionWrites.commitRecover(e.session().store, a) },
        "session.phase": { e,a in try SessionWrites.commitComparePhase(e.session().store, a) },
        "session.answerSeen": { e,a in SessionWrites.commitAnswerSeen(try e.session().store, a) },
        "session.answerPhase": { e,a in try SessionWrites.commitAnswerPhase(e.session().store, a) },
        "session.answerNext": { e,a in SessionWrites.commitAnswerNext(try e.session().store, a) },
        "session.judge": { e,a in SessionWrites.commitJudgment(try e.session().store, a) },
        "session.skip": { e,a in SessionWrites.commitSkip(try e.session().store, a) },
        "session.undoSkip": { e,a in SessionWrites.commitUndoSkip(try e.session().store, a) },
        "session.end": { e,a in SessionWrites.commitEndGroup(try e.session().store, a) },
        "session.firstTip": { e,_ in SessionWrites.commitFlag(try e.session().store, key: "firstTipSeen", label: "write:first-tip") },
        "session.answerNote": { e,_ in SessionWrites.commitFlag(try e.session().store, key: "answerNoteSeen", label: "write:answer-note") },
        "write.open": { e,a in WriteAPI.call("open", try e.session().store, a) },
        "write.strokes": { e,a in WriteAPI.call("strokes", try e.session().store, a) },
        "write.phase": { e,a in WriteAPI.call("phase", try e.session().store, a) },
        "write.judge": { e,a in WriteAPI.call("judge", try e.session().store, a) },
        "write.showAnswer": { e,a in WriteAPI.call("showAnswer", try e.session().store, a) },
        "write.answerPhase": { e,a in WriteAPI.call("answerPhase", try e.session().store, a) },
        "write.answerNext": { e,a in WriteAPI.call("answerNext", try e.session().store, a) },
        "write.skip": { e,a in WriteAPI.call("skip", try e.session().store, a) },
        "write.undoSkip": { e,a in WriteAPI.call("undoSkip", try e.session().store, a) },
        "write.end": { e,a in WriteAPI.call("end", try e.session().store, a) },
        "write.firstTip": { e,a in WriteAPI.call("firstTip", try e.session().store, a) },
        "write.correct": { e,a in WriteAPI.call("correct", try e.session().store, a) },
        "write.hint": { e,a in WriteAPI.call("hint", try e.session().store, a) },
        "write.copy": { e,a in WriteAPI.call("copy", try e.session().store, a) },
        "write.refLabel": { e,a in WriteAPI.call("refLabel", try e.session().store, a) },
        "write.resultLook": { e,a in WriteAPI.call("resultLook", try e.session().store, a) },
        "write.redoOpen": { e,a in WriteAPI.call("redoOpen", try e.session().store, a) },
        "write.redoNext": { e,a in WriteAPI.call("redoNext", try e.session().store, a) },
        "write.redoExit": { e,a in WriteAPI.call("redoExit", try e.session().store, a) },
        "write.exit": { e,a in WriteAPI.call("exit", try e.session().store, a) },
        "write.result": { e,a in WriteAPI.call("result", try e.session().store, a) },
        "write.resultCell": { e,a in WriteAPI.call("resultCell", try e.session().store, a) },
        "write.resultCorrect": { e,a in WriteAPI.call("resultCorrect", try e.session().store, a) },
        "write.resultAdd": { e,a in WriteAPI.call("resultAdd", try e.session().store, a) },
        "write.resultSealed": { e,a in WriteAPI.call("resultSealed", try e.session().store, a) },
        "write.resultUndoSkip": { e,a in WriteAPI.call("resultUndoSkip", try e.session().store, a) },
        "write.resultAgain": { e,a in WriteAPI.call("resultAgain", try e.session().store, a) },
        "write.resultExit": { e,a in WriteAPI.call("resultExit", try e.session().store, a) },
        "write.resultInvite": { e,a in WriteAPI.call("resultInvite", try e.session().store, a) },
        "session.start": { e,a in
            let store = try e.session().store!, rules = ScheduleRules(dates: e.dates)
            switch a["kind"] {
            case .string("first"): return try rules.startFirst(store, now: e.clock, source: a["source"])
            case .string("picked"): return try rules.startPicked(store, keys: a["keys"]?.arrayValue ?? [], source: a["source"], deck: .real)
            default: return try rules.startDaily(store, now: e.clock, deck: .real, source: a["source"])
            }
        },
        "session.expire": { e,_ in try ScheduleRules(dates: e.dates).expireStale(e.session().store, now: e.clock) },
        "session.resume": { e,a in try ScheduleRules(dates: e.dates).resumeSlot(e.session().store, slot: string(a,"slot"), now: e.clock) },
        "session.endStartPicked": { e,a in try ScheduleRules(dates: e.dates).endOldAndStartPicked(e.session().store, keys: a["keys"]?.arrayValue ?? [], source: a["source"], deck: .real) },
        "session.deferSpecial": { e,_ in try ScheduleRules(dates: e.dates).deferSpecial(e.session().store, now: e.clock) },
        "session.correct": { e,a in SessionResults.correct(try e.session().store, a, mode: "write") },
        "session.resultCorrect": { e,a in SessionResults.correct(try e.session().store, a, mode: "result") },
        "session.finish": { e,a in SessionResults.finish(try e.session().store, a) },
        "session.leave": { e,a in SessionResults.leave(try e.session().store, a) },
        "session.added": { e,a in SessionResults.added(try e.session().store, a) },
        "session.sealed": { e,a in SessionResults.sealed(try e.session().store, a) },
        "session.resultUndoSkip": { e,a in SessionResults.undoSkip(try e.session().store, a) },
        "session.hint": { e,a in SessionHints.commitHint(try e.session().store, a, label: a["label"]?.stringValue ?? "hint") },
        "session.hintStep": { e,a in SessionHints.commitStep(try e.session().store, a) },
        "session.hintInitial": { _,a in HintViewState.initial(a["key"] ?? .null, stored: a["stored"], written: a["written"]) },
        "session.hintReduce": { _,a in HintViewState.reduce(a["view"] ?? .null, a["action"] ?? .null) },
        "session.hintRemaining": { _,a in JS.obj([("remaining", .array(HintViewState.remaining(a["view"]))), ("visible", .bool(HintViewState.visible(a["view"])))]) },
        "session.hintMatch": { _,a in HintViewState.match(a) },
        "session.hintTimeline": { _,a in HintViewState.timeline(a["count"], motion: a["motion"]) },
    ]
    static let sessionOps: [String: Op] = sessionRawOps.mapValues { fn in
        { e,a in e.storeSession?.notices = []; return try fn(e,a) }
    }
}
