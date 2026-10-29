import Foundation

extension CoreEngine {
    static let sessionOps: [String: Op] = {
        let ops: [String: Op] = [
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
        ]
        var all = ops
        for name in ["open", "strokes", "phase", "judge", "showAnswer", "answerPhase", "answerNext", "skip", "undoSkip", "end", "firstTip", "correct", "hint", "copy", "refLabel", "resultLook", "redoOpen", "redoNext", "redoExit", "exit"] {
            all["write." + name] = { e,a in WriteAPI.call(name, try e.session().store, a) }
        }
        all["session.hint"] = { e,a in SessionHints.commitHint(try e.session().store, a, label: a["label"]?.stringValue ?? "hint") }
        all["session.hintStep"] = { e,a in SessionHints.commitStep(try e.session().store, a) }
        return all.mapValues { fn in { e,a in e.storeSession?.notices = []; return try fn(e,a) } }
    }()
}
