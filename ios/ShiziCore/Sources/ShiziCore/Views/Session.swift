import Foundation

public enum SessionView {
    public static func noneView(_ a: JSObject = JSObject()) -> JSValue {
        let exhausted = JS.truthy(a["exhausted"]), pick = JS.truthy(a["pick"])
        let canSwitch = exhausted && JS.truthy(a["libSwitch"])
        func action(_ key: String, _ to: String) -> JSValue { ViewSupport.obj([("label", ViewSupport.ref(key)), ("to", .string(to))]) }
        return ViewSupport.obj([
            ("screen", .string("session-none")), ("exhausted", .bool(exhausted)), ("title", ViewSupport.ref("X-TABS.write")),
            ("empty", ViewSupport.obj([("cell", .bool(true)), ("title", ViewSupport.ref("R-H11.title")), ("body", .array([ViewSupport.ref("R-H11.body")])), ("extra", .array(exhausted ? [ViewSupport.ref("R-H11.noCharsBody")] : [])), ("action", exhausted && JS.truthy(a["wrongList"]) ? action("R-H11.noCharsLink", "wrongList") : .null)])),
            ("primary", canSwitch ? action("X-SESSION.noneLibSwitch", "libSwitch") : pick ? action("X-SESSION.nonePick", "pick") : .null),
            ("secondary", canSwitch && pick ? action("X-SESSION.nonePick", "pick") : .null),
            ("lines", ViewSupport.obj([("title", ViewMeasurement.measure(try? Copy.t("R-H11.title"),variant:"empty-title")), ("body",ViewMeasurement.measure(try? Copy.t("R-H11.body"),variant:"empty-body")), ("extra",exhausted ? ViewMeasurement.measure(try? Copy.t("R-H11.noCharsBody"),variant:"empty-body") : .null)])),
        ])
    }
}
