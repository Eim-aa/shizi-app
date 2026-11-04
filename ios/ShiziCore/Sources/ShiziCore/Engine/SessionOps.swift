import Foundation

extension CoreEngine {
    static let sessionRawOps: [String: Op] = [
        "session.writeHelper": { _,a in WriteWire.helper(a) },
        "session.writeHost": { e,a in try writeHost(e.session().store, a) },
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
        "write.resultInvite": { e,a in WriteAPI.call("resultInvite", try e.session().store, a) },
    ]
    static let sessionOps: [String: Op] = sessionRawOps.mapValues { fn in
        { e,a in e.storeSession?.notices = []; return try fn(e,a) }
    }
}
