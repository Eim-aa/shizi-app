import Foundation

// src/session/api/backup.js. Static copy structure is exported by session-resources.mjs.
extension PageAPI {
    static func dateRef(_ day: JSValue?, _ dates: Dates) throws -> JSValue {
        ViewSupport.ref("R-H02.dateFormat", dates.isValidDay(day ?? .null) ? try dates.monthDayParts(day!) : JS.obj([("month", .string("")), ("day", .string(""))]))
    }
    static func preview(_ store: Store, _ report: JSObject) throws -> JSValue {
        let m = Backup.confirmModel(.object(store.state), .object(report)), replace = m["mode"] == .string("replace"), dates = store.dates
        let day = dates.isValidDay(m["day"] ?? .null) ? try dateRef(m["day"], dates) : .string("")
        var params = JSObject([("date", day), ("n", m["n"]!)]); if replace { params["m"] = m["m"] }
        let loss = m["loss"] ?? .null; var lossText = JSValue.null
        if !loss.isNull {
            lossText = loss["from"] == loss["to"] ? ViewSupport.ref("X-BACKUP.lossDay", JS.obj([("date", try dateRef(loss["from"], dates))])) : ViewSupport.ref("X-BACKUP.lossRange", JS.obj([("from", try dateRef(loss["from"], dates)), ("to", try dateRef(loss["to"], dates))]))
        }
        return JS.obj([("mode", m["mode"]!), ("day", m["day"] ?? .null), ("n", m["n"]!), ("m", m["m"]!), ("loss", loss), ("title", ViewSupport.ref(replace ? "X-BACKUP.replaceTitle" : "R-B03.restoreTitle")), ("body", ViewSupport.ref(replace ? "R-B03.replaceBody" : "R-B03.restoreBody", .object(params))), ("cancel", ViewSupport.ref("X-BACKUP.confirmCancel")), ("ok", ViewSupport.ref(replace ? "X-BACKUP.replaceOk" : "R-B03.restoreBtn")), ("lossText", lossText), ("exportFirst", loss.isNull ? .null : ViewSupport.ref("X-BACKUP.exportFirst"))])
    }
    static func backup(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        func submit(_ r: JSValue) -> JSValue { r["ok"] == .bool(false) && JS.truthy(r["stage"]) ? SessionWrites.patch(reply(r), [("stage", .string(JS.string(r["stage"])))]) : reply(r) }
        switch op {
        case "view.backup":
            let state = store.state, safety = Backup.safetyOf(state), status = Backup.backupStatus(.object(state), conclusion: safety == nil ? nil : Backup.conclusionOfSafety(safety, state), dates: store.dates)
            var view = try SessionResources.ui["backupTemplate"]!.objectValue!
            let day = status["date"]?["kind"] == .string("day") ? status["date"]?["day"] ?? .null : .null
            view["lastDate"] = day.isNull ? ViewSupport.ref("R-B02.noBackup") : try dateRef(day, store.dates); view["lastDay"] = day
            view["statusLines"] = .array(try (status["lines"]?.arrayValue ?? []).map { line in
                if line["key"] == .string("R-B01.conclusionRestore") {
                    let d = line["vars"]?["day"], n = line["vars"]?["n"]
                    return ViewSupport.ref("R-B01.conclusionRestore", JS.obj([("date", store.dates.isValidDay(d ?? .null) ? try dateRef(d, store.dates) : .string("")), ("n", SessionWrites.integer(n) ? n! : .number(0))]))
                }; return ViewSupport.ref(JS.string(line["key"]), line["vars"])
            })
            view["noteKeys"] = .array((status["lines"]?.arrayValue ?? []).map { $0["key"]! }); view["intro"] = ViewSupport.ref(status["hasRecords"] == .bool(true) ? "X-BACKUP.intro" : "X-BACKUP.introEmpty"); view["hasRecords"] = status["hasRecords"]; view["count"] = status["count"]
            view["clearSheet"] = SessionWrites.patch(view["clearSheet"], [("body", ViewSupport.ref("R-B03.clearBody", JS.obj([("n", status["count"]!)])))])
            return JS.obj([("ok", .bool(true)), ("view", .object(view)), ("lines", JS.obj([("intro", SessionTextLines.shared.ref("backup.intro", view["intro"])), ("clearBody", SessionTextLines.shared.ref("backup.confirmBody", view["clearSheet"]?["body"])), ("clearBodyFailed", SessionTextLines.shared.ref("backup.confirmBody", view["clearSheet"]?["failed"]?["body"]))]))])
        case "backup.export":
            let at = store.now(), text = Backup.serializeBackup(.object(try Backup.buildBackupV2(store.state, now: at, serial: store.serial)))
            return JS.obj([("ok", .bool(true)), ("name", .string(try Backup.backupFileName(at, dates: store.dates))), ("text", .string(text)), ("sig", .string(Backup.recordsSignature(store.state["records"]))), ("at", .number(at))])
        case "backup.exportDone": return submit(Backup.markExported(store, at: store.now(), sig: a["sig"]?.stringValue))
        case "backup.picked", "backup.restorePreview", "backup.restore":
            let report = Backup.inspectBackup(.string(a["text"]?.stringValue ?? ""), dates: store.dates)
            if report["ok"] != .bool(true) {
                return op == "backup.picked" ? JS.obj([("ok", .bool(true)), ("note", JS.obj([("kind", report["kind"] ?? .null)]))]) : SessionWrites.failure(JS.string(report["kind"]))
            }
            if op == "backup.restore" { return submit(Backup.restoreFromBackup(store, report, now: store.now())) }
            var out = JSObject([("ok", .bool(true)), ("preview", try preview(store, report))]); if op == "backup.picked" { out["lines"] = JS.obj([("body", SessionTextLines.shared.ref("backup.confirmBody", out["preview"]?["body"]))]) }; return .object(out)
        case "backup.clear": return submit(Backup.clearAllRecords(store, now: store.now()))
        case "backup.undoRestore", "backup.undoClear": return submit(Backup.undoFromSafety(store))
        case "backup.dropSafety": return submit(Backup.dropSafety(store))
        case "backup.undoState":
            let safety = Backup.safetyOf(store.state); return JS.obj([("ok", .bool(true)), ("kind", safety == nil ? .null : .string(safety?["kind"] == .string("clear") ? "clear" : "restore"))])
        default: return SessionWrites.failure("unknown-op")
        }
    }
}
