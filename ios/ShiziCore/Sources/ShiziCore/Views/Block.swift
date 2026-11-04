import Foundation

public enum BlockView {
    public static func blockReasonOf(_ status: JSValue?, migration: JSValue? = nil) -> JSValue {
        func reason(_ kind: String, _ detail: JSValue?) -> JSValue {
            var o = JSObject([("kind", .string(kind))]); o["detail"] = detail; return .object(o)
        }
        guard JS.truthy(status) else { return reason("unavailable", .string("no-store")) }
        if !JS.truthy(status?["available"]) { return reason("unavailable", JS.truthy(status?["unavailableKind"]) ? status?["unavailableKind"] : .string("unknown")) }
        if JS.truthy(status?["blocked"]) { return reason("blocked", JS.truthy(status?["blocked"]?["reason"]) ? status?["blocked"]?["reason"] : .string("blocked")) }
        if JS.truthy(migration) { return reason("migration", migration?["reason"]) }
        return .null
    }
    public static func hasJudged(_ state: JSValue?) -> Bool { !Backup.judgedCharsOf(state?["records"]).isEmpty }
    public static func blockView(_ a: JSObject = JSObject()) throws -> JSValue {
        let kind = a["kind"] ?? .string("unavailable")
        let body = try Copy.t("R-B09.body")
        let count = body.arrayValue?.count ?? 1
        return ViewSupport.obj([
            ("kind", kind), ("title", ViewSupport.ref("R-B09.title")), ("body", ViewSupport.ref("R-B09.body")),
            ("migration", kind == .string("migration") ? ViewSupport.ref("X-SYS.blockMigration") : .null),
            ("still", JS.truthy(a["still"]) ? ViewSupport.ref("X-SYS.blockStill") : .null), ("retry", ViewSupport.ref("R-B09.retry")),
            ("export", JS.truthy(a["canExport"]) ? ViewSupport.ref("R-B02.export") : .null),
            ("exportFail", JS.truthy(a["exportFail"]) ? ViewSupport.obj([("text", ViewSupport.ref("X-BACKUP.exportFailed")), ("cancel", ViewSupport.ref("X-BACKUP.exportStay")), ("retry", ViewSupport.ref("R-B09.retry"))]) : .null),
            ("lines", ViewSupport.obj([("body", .array((body.arrayValue ?? [body]).map { ViewMeasurement.measure($0,variant:"block-line") })), ("migration",kind == .string("migration") ? ViewMeasurement.measure(try? Copy.t("X-SYS.blockMigration"),variant:"block-line") : .null), ("still",JS.truthy(a["still"]) ? ViewMeasurement.measure(try? Copy.t("X-SYS.blockStill"),variant:"block-line") : .null)])),
        ])
    }
    public static func blockBackup(_ state: JSObject, serial: Double = 0, now: Double, dates: Dates) throws -> JSValue {
        ViewSupport.obj([("name", .string(try Backup.backupFileName(now, dates: dates))), ("text", .string(Backup.serializeBackup(.object(try Backup.buildBackupV2(state, now: now, serial: serial)))))])
    }
}
